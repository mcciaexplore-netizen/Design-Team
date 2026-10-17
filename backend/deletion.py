"""Deleting tickets and removing people, without leaving broken links behind.

A ticket is deleted together with everything that only exists for it (designs, approvals, comments, time, history,
notifications). Stored files are removed when nothing else still points at them; the same file can be attached to
several tickets made from one request.

A person is erased outright when nothing refers to them. Someone with past work can't be erased without wiping or
breaking that history, so they are removed instead: they can never sign in again, their email is wiped, they are
taken off open work, and their name stays on old records marked "(removed)".
"""
import logging
import secrets

from sqlalchemy.orm import Session

import models
from auth import hash_password
from common import delete_stored_file

logger = logging.getLogger(__name__)

REMOVED_DOMAIN = "deleted.invalid"
OPEN = (models.TicketStatus.NEW, models.TicketStatus.ASSIGNED, models.TicketStatus.IN_PROGRESS,
        models.TicketStatus.WAITING_ON_REQUESTER, models.TicketStatus.IN_REVIEW)


def is_removed(user: models.User) -> bool:
    return user.email.endswith("@" + REMOVED_DOMAIN)


def _file_in_use(db: Session, key: str) -> bool:
    return any(db.query(col).filter(col == key).first() for col in (
        models.Attachment.file_url, models.ProofVersion.storage_key, models.CdrRequest.s3_object_key,
        models.SocialPost.image_key, models.LibraryItemVersion.file_url))


def delete_ticket(db: Session, ticket: models.Ticket) -> None:
    """Delete one ticket and what belongs to it. Commits."""
    tid = ticket.id
    keys = {a.file_url for a in db.query(models.Attachment).filter(models.Attachment.ticket_id == tid)}
    keys |= {p.storage_key for p in db.query(models.ProofVersion).filter(models.ProofVersion.ticket_id == tid)}
    cdr_ids = [c.id for c in db.query(models.CdrRequest).filter(models.CdrRequest.ticket_id == tid)]
    keys |= {c.s3_object_key for c in db.query(models.CdrRequest).filter(models.CdrRequest.ticket_id == tid) if c.s3_object_key}

    def gone(model, *conditions):
        db.query(model).filter(*conditions).delete(synchronize_session=False)

    # Children before parents: approvals point at proofs, attachments at comments, download logs at CDR requests.
    gone(models.ApprovalRequest, models.ApprovalRequest.ticket_id == tid)
    gone(models.Attachment, models.Attachment.ticket_id == tid)
    for model in (models.TicketComment, models.PinComment, models.PinpointComment, models.Subtask, models.TimeEntry,
                  models.AuditLog, models.NotificationLog, models.Notification, models.ProofVersion):
        gone(model, model.ticket_id == tid)
    if cdr_ids:
        gone(models.CdrDownloadLog, models.CdrDownloadLog.cdr_request_id.in_(cdr_ids))
        gone(models.CdrRequest, models.CdrRequest.id.in_(cdr_ids))
    # Things that only mention the ticket keep existing without the link.
    db.query(models.LibraryItem).filter(models.LibraryItem.ticket_source_id == tid).update(
        {"ticket_source_id": None}, synchronize_session=False)
    db.query(models.Ticket).filter(models.Ticket.parent_id == tid).update({"parent_id": None}, synchronize_session=False)
    gone(models.Ticket, models.Ticket.id == tid)
    db.commit()

    for key in keys:
        if not _file_in_use(db, key):
            try:
                delete_stored_file(key)
            except Exception:
                logger.exception("Could not delete stored file %s", key)


def _has_history(db: Session, uid: int) -> bool:
    refs = (
        models.Ticket.requester_id, models.Ticket.assignee_id, models.AuditLog.changed_by_id, models.ProofVersion.created_by_id,
        models.ApprovalRequest.created_by_id, models.Attachment.uploaded_by_id, models.TicketComment.author_id,
        models.PinComment.author_id, models.PinpointComment.author_id, models.TimeEntry.user_id, models.Campaign.created_by_id,
        models.SocialPost.created_by_id, models.CdrRequest.requester_id, models.CdrRequest.approver_id,
        models.CdrDownloadLog.user_id, models.LibraryItemVersion.uploaded_by_id, models.RecurringRule.requester_id,
        models.RecurringRule.assignee_id, models.TicketTemplate.created_by_id,
    )
    return any(db.query(col).filter(col == uid).first() for col in refs)


def remove_user(db: Session, user: models.User) -> str:
    """Erase the account, or remove it when it has history. Returns "erased" or "removed". Commits."""
    uid = user.id
    # Personal things nobody else needs.
    for model in (models.Notification, models.UserPreference, models.SavedView, models.UserLeave):
        db.query(model).filter(model.user_id == uid).delete(synchronize_session=False)

    if not _has_history(db, uid):
        db.delete(user)
        db.commit()
        return "erased"

    # Open work goes back to the queue instead of waiting on someone who has left.
    db.query(models.Ticket).filter(models.Ticket.assignee_id == uid, models.Ticket.status.in_(OPEN)).update(
        {"assignee_id": None}, synchronize_session=False)
    db.query(models.RecurringRule).filter(models.RecurringRule.assignee_id == uid).update(
        {"assignee_id": None}, synchronize_session=False)
    if not user.full_name.endswith("(removed)"):
        user.full_name = f"{user.full_name} (removed)"[:120]
    user.email = f"removed-{uid}-{secrets.token_hex(4)}@{REMOVED_DOMAIN}"
    user.hashed_password = hash_password(secrets.token_urlsafe(32))   # the old password, and every session, stop working
    user.is_active = False
    user.must_change_password = False
    db.commit()
    return "removed"


# ── Starting afresh ──────────────────────────────────────────────────────────

FILE_DELETE_BUDGET_SECONDS = 40   # stay inside the host's time limit; files left over are only unused copies


def delete_all_past_data(db: Session, remove_clients: bool = False) -> dict:
    """Delete every request and everything that exists because of one: designs, approvals, attachments, source files,
    time, history, notifications, campaigns and social posts. Keeps the team, design types, settings, templates,
    recurring rules and the library. With remove_clients, client accounts go too. Commits. Returns counts."""
    import time

    tickets = db.query(models.Ticket.id).count()
    keys = {k for (k,) in db.query(models.Attachment.file_url)} | {k for (k,) in db.query(models.ProofVersion.storage_key)}
    keys |= {k for (k,) in db.query(models.CdrRequest.s3_object_key) if k}
    keys |= {k for (k,) in db.query(models.SocialPost.image_key) if k}
    highest = db.query(models.Ticket.id).order_by(models.Ticket.id.desc()).first()

    # Children before parents, as in delete_ticket, but for everything at once.
    for model in (models.ApprovalRequest, models.Attachment, models.TicketComment, models.PinComment, models.PinpointComment,
                  models.Subtask, models.TimeEntry, models.AuditLog, models.NotificationLog, models.Notification,
                  models.ProofVersion, models.CdrDownloadLog, models.CdrRequest, models.SocialPost, models.Campaign,
                  models.UploadPart):
        db.query(model).delete(synchronize_session=False)
    db.query(models.LibraryItem).update({"ticket_source_id": None}, synchronize_session=False)
    db.query(models.Ticket).update({"parent_id": None}, synchronize_session=False)
    db.query(models.Ticket).delete(synchronize_session=False)
    # New tickets carry on from the highest number used, so an old tracking link never opens a new request.
    settings = db.query(models.SystemSettings).first() or models.SystemSettings()
    settings.ticket_number_floor = max(settings.ticket_number_floor or 0, highest[0] if highest else 0)
    db.add(settings)
    db.commit()

    clients = 0
    if remove_clients:
        for user in db.query(models.User).filter(models.User.role == models.RoleEnum.REQUESTER).all():
            if not is_removed(user):
                remove_user(db, user)
                clients += 1

    deadline, left = time.monotonic() + FILE_DELETE_BUDGET_SECONDS, 0
    for key in keys:
        if time.monotonic() > deadline or _file_in_use(db, key):
            left += time.monotonic() > deadline
            continue
        try:
            delete_stored_file(key)
        except Exception:
            logger.exception("Could not delete stored file %s", key)
    return {"tickets": tickets, "files": len(keys) - left, "clients_removed": clients}
