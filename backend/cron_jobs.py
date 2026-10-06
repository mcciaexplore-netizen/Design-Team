import datetime
import pytz
import models
from sqlalchemy.orm import Session
from notifications import handle_overdue_escalations, notify_user
import delivery
import events

def run_all_cron_jobs(db: Session):
    now = datetime.datetime.now(pytz.UTC)
    
    # 1. Edit Window Auto-Close
    delivered_tickets = db.query(models.Ticket).filter(
        models.Ticket.status == models.TicketStatus.DELIVERED,
        models.Ticket.edit_window_ends_at != None
    ).all()
    
    for ticket in delivered_tickets:
        edit_end = ticket.edit_window_ends_at
        if edit_end.tzinfo is None:
            edit_end = edit_end.replace(tzinfo=pytz.UTC)
            
        if now >= edit_end:
            # After 12 hours, the ticket automatically moves to APPROVED
            # Then we can check for the 36 hour auto-close limit
            ticket.status = models.TicketStatus.CLOSED_WITHOUT_APPROVAL
            # We'll use CLOSED_WITHOUT_APPROVAL to signify the 12 hour window expired without requester action.
            ticket.is_locked = True
            
            # The 36 hour global auto-close logic can just permanently lock it.
            
            audit = models.AuditLog(
                ticket_id=ticket.id,
                changed_by_id=ticket.requester_id,
                action="Auto-closed",
                details={"status": ticket.status.value, "reason": "Edit window expired"}
            )
            db.add(audit)
            
            if ticket.assignee:
                notify_user(db, ticket.assignee, f"Ticket {ticket.ticket_number} auto-closed", "TICKET_AUTO_CLOSED", ticket.id)

    # 2. SLA Overdue & Escalations
    open_statuses = [models.TicketStatus.NEW, models.TicketStatus.ASSIGNED, models.TicketStatus.IN_PROGRESS]
    open_tickets = db.query(models.Ticket).filter(
        models.Ticket.status.in_(open_statuses),
        models.Ticket.due_at != None
    ).all()
    
    for ticket in open_tickets:
        due_at = ticket.due_at
        if due_at.tzinfo is None:
            due_at = due_at.replace(tzinfo=pytz.UTC)
            
        if now > due_at:
            # First time we see it overdue: flag it and alert leads / Slack once.
            if not ticket.is_overdue:
                ticket.is_overdue = True
                db.commit()
                events.emit(db, "sla_breach", ticket)
            # Overdue
            diff_hours = (now - due_at).total_seconds() / 3600
            # Simplify working hours overdue to absolute hours for this endpoint
            handle_overdue_escalations(db, ticket, int(diff_hours))
        elif (due_at - now).total_seconds() <= 6 * 3600:
            # 6 hour warning
            if ticket.assignee:
                notify_user(db, ticket.assignee, f"Ticket {ticket.ticket_number} due in <6 hrs", "6_HR_WARNING", ticket.id)
            
    db.commit()

    # 3. Waiting on requester: remind them daily (at most three times) until they respond
    waiting = db.query(models.Ticket).filter(
        models.Ticket.status == models.TicketStatus.WAITING_ON_REQUESTER, models.Ticket.paused_at != None).all()
    for ticket in waiting:
        since = ticket.paused_at if ticket.paused_at.tzinfo else ticket.paused_at.replace(tzinfo=pytz.UTC)
        day = int((now - since).total_seconds() // 86400)
        if day < 1 or not ticket.requester:
            continue
        reminder = min(day, 3)
        text = f"{ticket.ticket_number} is waiting for your reply: the design team needs your input to continue."
        # The wait's start time is part of the key, so a later wait on the same ticket reminds again.
        if notify_user(db, ticket.requester, text, f"WAITING_REMINDER_{int(since.timestamp())}_{reminder}", ticket.id) is not False and delivery.email_configured():
            delivery.run_in_background(delivery.send_email, ticket.requester.email, f"Action needed: {ticket.ticket_number}",
                                       f"Hi {ticket.requester.full_name},\n\n{text}\n\nMCCIA Applied AI Studio")
    db.commit()

    # 4. Designs waiting for the client's review: remind every two days, at most three times per request
    pending = db.query(models.ApprovalRequest).filter(models.ApprovalRequest.status == "pending").all()
    for req in pending:
        created = req.created_at if req.created_at.tzinfo else req.created_at.replace(tzinfo=pytz.UTC)
        expires = req.expires_at if req.expires_at.tzinfo else req.expires_at.replace(tzinfo=pytz.UTC)
        ticket = db.query(models.Ticket).filter(models.Ticket.id == req.ticket_id).first()
        step = int((now - created).total_seconds() // (2 * 86400))
        if step < 1 or expires < now or not ticket or ticket.status != models.TicketStatus.IN_REVIEW or not ticket.requester:
            continue
        text = f"{ticket.ticket_number} is still waiting for your review. Please approve it or tell us what to change."
        if notify_user(db, ticket.requester, text, f"REVIEW_REMINDER_{req.id}_{min(step, 3)}", ticket.id) is not False and delivery.email_configured():
            delivery.run_in_background(delivery.send_email, ticket.requester.email, f"Your review is needed: {ticket.ticket_number}",
                                       f"Hi {ticket.requester.full_name},\n\n{text}\n\nMCCIA Applied AI Studio")
    db.commit()

    # 5. Recurring tickets (idempotent per tick)
    from templates_recurring import run_due_rules
    try:
        run_due_rules(db, now)
    except Exception:
        import logging
        logging.getLogger(__name__).exception("Recurring rules failed")
