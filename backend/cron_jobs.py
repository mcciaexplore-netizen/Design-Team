import datetime
import logging

import pytz
from sqlalchemy.orm import Session, joinedload

import delivery
import events
import models
from notifications import handle_overdue_escalations, notify_user

logger = logging.getLogger(__name__)
IST = pytz.timezone("Asia/Kolkata")


def _utc(dt: datetime.datetime) -> datetime.datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=pytz.UTC)


def _each(db: Session, items, step: str, fn) -> None:
    """Run fn on every item, committing each one. A failure is logged and rolled back, and the rest carry on:
    one bad ticket must never stop the reminders and auto-closing for everyone else."""
    for item in items:
        try:
            fn(item)
            db.commit()
        except Exception:
            db.rollback()
            logger.exception("Cron step %s failed for %r", step, getattr(item, "id", item))


def run_all_cron_jobs(db: Session):
    now = datetime.datetime.now(pytz.UTC)

    # 1. Edit window over: close and lock the ticket. "Closed" when the client approved the design,
    #    "Closed without approval" when they never answered.
    def close_after_edit_window(ticket):
        if now < _utc(ticket.edit_window_ends_at):
            return
        approved = db.query(models.ApprovalRequest.id).filter(
            models.ApprovalRequest.ticket_id == ticket.id, models.ApprovalRequest.status == "approved").first()
        ticket.status = models.TicketStatus.CLOSED if approved else models.TicketStatus.CLOSED_WITHOUT_APPROVAL
        ticket.is_locked = True
        db.add(models.AuditLog(ticket_id=ticket.id, changed_by_id=None, actor_label="System", action="Auto-closed",
                               details={"status": ticket.status.value, "reason": "Edit window ended"}))
        if ticket.assignee:
            notify_user(db, ticket.assignee, f"Ticket {ticket.ticket_number} auto-closed", "TICKET_AUTO_CLOSED", ticket.id)

    delivered = db.query(models.Ticket).options(joinedload(models.Ticket.assignee)).filter(
        models.Ticket.status == models.TicketStatus.DELIVERED, models.Ticket.edit_window_ends_at != None).all()
    _each(db, delivered, "edit-window", close_after_edit_window)

    # 2. SLA: warn 6 hours ahead, then flag and escalate once overdue.
    def check_sla(ticket):
        due_at = _utc(ticket.due_at)
        if now > due_at:
            if not ticket.is_overdue:   # first time it is seen overdue: flag it and alert leads / Slack once
                ticket.is_overdue = True
                db.commit()
                events.emit(db, "sla_breach", ticket)
            handle_overdue_escalations(db, ticket, int((now - due_at).total_seconds() // 3600))
        elif (due_at - now).total_seconds() <= 6 * 3600 and ticket.assignee:
            notify_user(db, ticket.assignee, f"Ticket {ticket.ticket_number} due in <6 hrs", "6_HR_WARNING", ticket.id)

    open_statuses = [models.TicketStatus.NEW, models.TicketStatus.ASSIGNED, models.TicketStatus.IN_PROGRESS]
    open_tickets = db.query(models.Ticket).options(joinedload(models.Ticket.assignee)).filter(
        models.Ticket.status.in_(open_statuses), models.Ticket.due_at != None).all()
    _each(db, open_tickets, "sla", check_sla)

    # 3. Waiting on requester: remind them daily (at most three times) until they respond.
    def remind_waiting(ticket):
        since = _utc(ticket.paused_at)
        day = int((now - since).total_seconds() // 86400)
        if day < 1 or not ticket.requester:
            return
        text = f"{ticket.ticket_number} is waiting for your reply: the design team needs your input to continue."
        # The wait's start time is part of the key, so a later wait on the same ticket reminds again.
        if notify_user(db, ticket.requester, text, f"WAITING_REMINDER_{int(since.timestamp())}_{min(day, 3)}", ticket.id) is not False \
                and delivery.email_configured():
            delivery.run_in_background(delivery.send_email, ticket.requester.email, f"Action needed: {ticket.ticket_number}",
                                       f"Hi {ticket.requester.full_name},\n\n{text}\n\nMCCIA Applied AI Studio")

    waiting = db.query(models.Ticket).options(joinedload(models.Ticket.requester)).filter(
        models.Ticket.status == models.TicketStatus.WAITING_ON_REQUESTER, models.Ticket.paused_at != None).all()
    _each(db, waiting, "waiting-reminder", remind_waiting)

    # 4. Designs out for the client's review. The review closes after two days: remind once after the first day,
    #    and when it runs out with no answer, close and lock the ticket (silence counts as acceptance).
    def review_step(pair):
        req, ticket = pair
        created, expires = _utc(req.created_at), _utc(req.expires_at)
        if expires <= now:
            req.status = "expired"   # settled, so later ticks stop looking at it
            ticket.status = models.TicketStatus.CLOSED_WITHOUT_APPROVAL
            ticket.is_locked = True
            db.add(models.AuditLog(ticket_id=ticket.id, changed_by_id=None, actor_label="System", action="Auto-closed",
                                   details={"status": ticket.status.value, "reason": "No reply to the review within 2 days"}))
            if ticket.assignee:
                notify_user(db, ticket.assignee, f"{ticket.ticket_number} closed: the client did not reply to the review within 2 days",
                            "REVIEW_AUTO_CLOSED", ticket.id)
            return
        if now - created < datetime.timedelta(days=1) or not ticket.requester:
            return
        text = (f"{ticket.ticket_number} is still waiting for your review. Please approve it or tell us what to change "
                f"before {expires.astimezone(IST):%d %b, %I:%M %p} IST, when it closes.")
        if notify_user(db, ticket.requester, text, f"REVIEW_REMINDER_{req.id}_1", ticket.id) is not False and delivery.email_configured():
            delivery.run_in_background(delivery.send_email, ticket.requester.email, f"Your review is needed: {ticket.ticket_number}",
                                       f"Hi {ticket.requester.full_name},\n\n{text}\n\nMCCIA Applied AI Studio")

    # Only reviews whose ticket is still waiting on the client; others are settled elsewhere.
    pending = db.query(models.ApprovalRequest, models.Ticket).join(models.Ticket, models.Ticket.id == models.ApprovalRequest.ticket_id) \
        .filter(models.ApprovalRequest.status == "pending", models.Ticket.status == models.TicketStatus.IN_REVIEW,
                models.Ticket.is_locked == False).all()  # noqa: E712
    _each(db, pending, "review", review_step)

    # 5. Recurring tickets (idempotent per tick)
    from templates_recurring import run_due_rules
    try:
        run_due_rules(db, now)
    except Exception:
        db.rollback()
        logger.exception("Recurring rules failed")
