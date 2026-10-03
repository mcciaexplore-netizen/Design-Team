import models
from sqlalchemy import func
from typing import Optional

def suggest_assignee(db, ticket_design_type_id: int) -> Optional[models.User]:
    """
    Suggests the best designer for a new ticket based on capacity.
    Excludes users on leave today.
    Finds the designer with the lowest sum of SLA hours in NEW/IN_PROGRESS.
    """
    designers = db.query(models.User).filter(models.User.role == models.RoleEnum.DESIGNER).all()
    if not designers:
        return None
        
    import datetime
    today = datetime.datetime.now().date()
    
    # Exclude those on leave
    leaves = db.query(models.UserLeave).filter(
        models.UserLeave.start_date <= today,
        models.UserLeave.end_date >= today
    ).all()
    on_leave_ids = {leave.user_id for leave in leaves}
    
    available_designers = [d for d in designers if d.id not in on_leave_ids]
    if not available_designers:
        return None # Everyone is on leave
        
    # Calculate current load
    # Load = Sum of SLA hours for active tickets
    open_statuses = [models.TicketStatus.NEW, models.TicketStatus.ASSIGNED, models.TicketStatus.IN_PROGRESS]
    
    best_designer = None
    lowest_load_ratio = float('inf')
    
    for designer in available_designers:
        tickets = db.query(models.Ticket).filter(
            models.Ticket.assignee_id == designer.id,
            models.Ticket.status.in_(open_statuses)
        ).all()
        
        load_hours = 0
        for t in tickets:
            load_hours += getattr(t.design_type, 'default_sla_hours', 24)
            
        capacity = designer.daily_capacity_hours * 5 # Weekly capacity approximation
        ratio = load_hours / max(1, capacity)
        
        if ratio < lowest_load_ratio:
            lowest_load_ratio = ratio
            best_designer = designer
            
    return best_designer
