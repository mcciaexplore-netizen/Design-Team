import datetime
import pytz
import models
from sqlalchemy.orm import Session
from notifications import handle_overdue_escalations, notify_user

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
            # Overdue
            diff_hours = (now - due_at).total_seconds() / 3600
            # Simplify working hours overdue to absolute hours for this endpoint
            handle_overdue_escalations(db, ticket, int(diff_hours))
        elif (due_at - now).total_seconds() <= 6 * 3600:
            # 6 hour warning
            if ticket.assignee:
                notify_user(db, ticket.assignee, f"Ticket {ticket.ticket_number} due in <6 hrs", "6_HR_WARNING", ticket.id)
            
    db.commit()
