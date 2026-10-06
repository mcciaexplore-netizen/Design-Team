"""Change requests become a new version of the ticket: DF-0001 (V1) -> DF-0001-V2 -> DF-0001-V3 ..."""
import datetime

import pytz

import events
import models
from common import compute_due_at, last_proof_submitter

EXTRA_TAG = "Extra revision"
LAST_MINUTE_TAG = "Last-Minute Change"


def request_changes(db, parent, reason=""):
    """Close `parent` as superseded and open the next version for the design team.

    The new ticket copies the request, links back to its parent, and goes straight to whoever last submitted a
    proof on the parent (or the parent's assignee). The caller commits and announces the new ticket.
    """
    if parent.is_locked:
        raise ValueError("This version is already closed.")

    base = parent.ticket_number.split("-V")[0]
    version = parent.version_number + 1
    designer = last_proof_submitter(db, parent)
    assignee_id = designer.id if designer else parent.assignee_id

    tags = [t for t in (parent.tags or []) if t not in (EXTRA_TAG, LAST_MINUTE_TAG)]
    settings = db.query(models.SystemSettings).first()
    if version - 1 > (settings.max_free_revisions if settings else 2):
        tags.append(EXTRA_TAG)   # past the free allowance: visible to the leads, but still just the next version
    if parent.due_at:
        due = parent.due_at if parent.due_at.tzinfo else parent.due_at.replace(tzinfo=pytz.utc)
        if (due - datetime.datetime.now(pytz.utc)).total_seconds() < 12 * 3600:
            tags.append(LAST_MINUTE_TAG)
            events.post_slack_event(db, "escalate", f":rotating_light: *Last-minute change* on {events.slack_escape(parent.ticket_number)} — {events.slack_escape(parent.title)}")

    child = models.Ticket(
        ticket_number=f"{base}-V{version}",
        title=parent.title,
        brief=parent.brief,
        design_type_id=parent.design_type_id,
        type_specific_fields=parent.type_specific_fields,
        priority=parent.priority,
        status=models.TicketStatus.ASSIGNED if assignee_id else models.TicketStatus.NEW,
        assignee_id=assignee_id,
        requester_id=parent.requester_id,
        client_org=parent.client_org,
        parent_id=parent.id,
        version_number=version,
        reason_for_change=reason,
        tags=tags,
        figma_url=parent.figma_url,
        estimate_hours=parent.estimate_hours,
        due_at=compute_due_at(db, parent.design_type, parent.priority),
    )
    db.add(child)
    db.flush()

    # The client's original files travel with the request (same stored file, no copy).
    for att in db.query(models.Attachment).filter(models.Attachment.ticket_id == parent.id, models.Attachment.comment_id == None).all():
        db.add(models.Attachment(ticket_id=child.id, file_name=att.file_name, file_url=att.file_url, content_type=att.content_type,
                                 size_bytes=att.size_bytes, uploaded_by_id=att.uploaded_by_id))

    parent.status = models.TicketStatus.REVISION_REQUESTED
    parent.is_locked = True
    parent.edit_window_ends_at = None

    db.add(models.AuditLog(ticket_id=parent.id, changed_by_id=None, actor_label="System", action="Superseded",
                           details={"new_version": child.ticket_number, "reason": reason}))
    db.add(models.AuditLog(ticket_id=child.id, changed_by_id=None, actor_label="System", action="Created",
                           details={"revision_of": parent.ticket_number, "reason": reason}))
    return child


def announce(db, child, actor=None):
    """Tell people about the new version: leads hear about the new ticket, the designer that it is theirs."""
    events.emit(db, "ticket_created", child, actor)
    if child.assignee_id:
        events.emit(db, "ticket_assigned", child, actor, {"auto": True})
