import datetime
from typing import Optional

import models

# Open work that still needs a designer's hands. In Review and Waiting on Requester don't consume their time.
ACTIVE = (models.TicketStatus.NEW, models.TicketStatus.ASSIGNED, models.TicketStatus.IN_PROGRESS)
HORIZON_DAYS = 7
DEFAULT_WORKING_DAYS = {0, 1, 2, 3, 4}  # Mon-Fri when no schedule has been configured


def _working_weekdays(db) -> set:
    rows = db.query(models.WorkingSchedule).all()
    return {r.day_of_week for r in rows if r.is_working_day} if rows else DEFAULT_WORKING_DAYS


def _available_hours(designer: models.User, days: list, leaves: list) -> float:
    """Hours the designer can work across `days` (already limited to working, non-holiday days), minus leave."""
    free = [d for d in days if not any(l.start_date.date() <= d <= l.end_date.date() for l in leaves)]
    return len(free) * (designer.daily_capacity_hours or 8)


def _remaining_effort(ticket: models.Ticket) -> float:
    """Hours of work left: the estimate (or the design type's typical effort) minus time already logged."""
    planned = ticket.estimate_hours or (ticket.design_type.default_effort_hours if ticket.design_type else None) or 4
    return max(0.5, planned - (ticket.time_spent_seconds or 0) / 3600)


def suggest_assignee(db, ticket_design_type_id: int) -> Optional[models.User]:
    """The active designer with the most spare capacity over the next week.

    Load is the remaining effort on their open tickets (not SLA hours); capacity is their daily hours across
    the working days that aren't holidays or their own leave. Designers with no available days are skipped.
    """
    designers = db.query(models.User).filter(
        models.User.role == models.RoleEnum.DESIGNER, models.User.is_active == True).all()
    if not designers:
        return None

    today = datetime.date.today()
    weekdays = _working_weekdays(db)
    holidays = {h.date.date() for h in db.query(models.Holiday).all()}
    days = [d for d in (today + datetime.timedelta(n) for n in range(HORIZON_DAYS))
            if d.weekday() in weekdays and d not in holidays]

    best, best_ratio = None, float("inf")
    for designer in designers:
        leaves = db.query(models.UserLeave).filter(models.UserLeave.user_id == designer.id).all()
        capacity = _available_hours(designer, days, leaves)
        if capacity <= 0:
            continue
        open_tickets = db.query(models.Ticket).filter(
            models.Ticket.assignee_id == designer.id, models.Ticket.status.in_(ACTIVE)).all()
        load = sum(_remaining_effort(t) for t in open_tickets)
        ratio = load / capacity
        if ratio < best_ratio:
            best, best_ratio = designer, ratio
    return best
