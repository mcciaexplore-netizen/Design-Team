import models
from copy import deepcopy

def request_changes(db, ticket, reason=""):
    settings = db.query(models.SystemSettings).first()
    max_revisions = settings.max_free_revisions if settings else 2
    
    if ticket.revision_count < max_revisions and not ticket.is_locked:
        # Free revision inside the window
        ticket.status = models.TicketStatus.IN_PROGRESS
        ticket.revision_count += 1
        ticket.edit_window_ends_at = None
        
        audit = models.AuditLog(
            ticket_id=ticket.id,
            changed_by_id=ticket.requester_id,
            action="Revision Requested",
            details={"revision": ticket.revision_count}
        )
        db.add(audit)
        db.commit()
        return ticket
    else:
        # Limit reached OR locked -> Create DUPLICATE child ticket
        base_number = ticket.ticket_number.split('-v')[0]
        new_version = ticket.version_number + 1
        
        new_ticket = models.Ticket(
            title=ticket.title,
            brief=ticket.brief,
            design_type_id=ticket.design_type_id,
            type_specific_fields=deepcopy(ticket.type_specific_fields),
            priority=ticket.priority,
            status=models.TicketStatus.NEW,
            requester_id=ticket.requester_id,
            parent_id=ticket.id,
            version_number=new_version,
            reason_for_change=reason,
            ticket_number=f"{base_number}-v{new_version}"
        )
        db.add(new_ticket)
        db.commit()
        db.refresh(new_ticket)
        return new_ticket
