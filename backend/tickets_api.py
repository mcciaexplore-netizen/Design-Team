"""Tickets: listing, creation, updates, duplication, subtasks and pinpoint comments, plus the lookups the board needs."""
import datetime
from typing import List

import pytz
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

import auth
import capacity_engine
import delivery
import events
import integrations
import models
import schemas
from auth import get_current_user, get_ticket_for_user, is_client, require_lead, require_staff
from common import compute_due_at, log_audit, mark_delivered, next_ticket_number, track_waiting
from database import get_db
from sla_engine import calculate_due_date

router = APIRouter(tags=["tickets"])


@router.get("/api/users", response_model=List[schemas.UserResponse])
def get_users(db: Session = Depends(get_db), _user: models.User = Depends(require_staff)):
    return db.query(models.User).all()

@router.patch("/api/design-types/{design_type_id}", response_model=schemas.DesignTypeResponse)
def update_design_type(design_type_id: int, body: schemas.DesignTypeUpdate, db: Session = Depends(get_db), _user: models.User = Depends(require_lead)):
    """Tune a design type's turnaround, effort estimate and post-delivery edit window."""
    dt = db.query(models.DesignType).filter(models.DesignType.id == design_type_id).first()
    if not dt:
        raise HTTPException(status_code=404, detail="Design type not found")
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(dt, key, value)
    db.commit()
    db.refresh(dt)
    return dt

@router.get("/api/design-types", response_model=List[schemas.DesignTypeResponse])
def get_design_types(db: Session = Depends(get_db), _user: models.User = Depends(get_current_user)):
    return db.query(models.DesignType).filter(models.DesignType.is_active == True).all()

@router.get("/api/tickets", response_model=List[schemas.TicketResponse])
def get_tickets(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    query = db.query(models.Ticket)
    if is_client(user):
        if user.client_org:
            query = query.filter(models.Ticket.client_org == user.client_org)
        else:
            query = query.filter(models.Ticket.requester_id == user.id)
    tickets = query.order_by(models.Ticket.created_at.desc()).all()
    counts = dict(db.query(models.TicketComment.ticket_id, func.count(models.TicketComment.id))
                  .filter(models.TicketComment.ticket_id.in_([t.id for t in tickets] or [0]))
                  .group_by(models.TicketComment.ticket_id).all())
    for t in tickets:
        t.comment_count = counts.get(t.id, 0)
    return tickets

@router.post("/api/tickets", response_model=schemas.TicketResponse, status_code=status.HTTP_201_CREATED)
def create_ticket(ticket: schemas.TicketCreate, db: Session = Depends(get_db), requester: models.User = Depends(get_current_user)):
    design_type = db.query(models.DesignType).filter(
        models.DesignType.id == ticket.design_type_id, models.DesignType.is_active == True
    ).first()
    if not design_type:
        raise HTTPException(status_code=422, detail="Unknown design type")

    data = ticket.model_dump()
    if is_client(requester):
        # Clients can request work but not plan it.
        data.pop("assignee_id", None)
        data.pop("estimate_hours", None)

    db_ticket = models.Ticket(
        **data,
        ticket_number=next_ticket_number(db),
        requester_id=requester.id,
        client_org=requester.client_org,
        due_at=compute_due_at(db, design_type, ticket.priority),
    )
    if not db_ticket.assignee_id:
        designer = capacity_engine.suggest_assignee(db, design_type.id)
        if designer:
            db_ticket.assignee_id = designer.id
            db_ticket.status = models.TicketStatus.ASSIGNED
    db.add(db_ticket)
    db.flush()
    log_audit(db, db_ticket.id, requester, "Created", {"status": db_ticket.status.value, "priority": db_ticket.priority.value})
    db.commit()
    db.refresh(db_ticket)

    events.emit(db, "ticket_created", db_ticket, requester)
    if db_ticket.assignee_id:
        events.emit(db, "ticket_assigned", db_ticket, requester, {"auto": True})

    return db_ticket

@router.patch("/api/tickets/{ticket_id}", response_model=schemas.TicketResponse)
def update_ticket(ticket_id: int, ticket_update: schemas.TicketUpdate, db: Session = Depends(get_db), user: models.User = Depends(require_staff)):
    db_ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
    if not db_ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    update_data = ticket_update.model_dump(exclude_unset=True)

    if user.role not in auth.LEAD_ROLES:
        forbidden = {"assignee_id", "priority"} & update_data.keys()
        if forbidden:
            raise HTTPException(status_code=403, detail="Only a Design Lead can change: " + ", ".join(sorted(forbidden)))

    old_assignee = db_ticket.assignee_id
    old_status = db_ticket.status
    changes = {}
    for key, value in update_data.items():
        old = getattr(db_ticket, key)
        if old != value:
            changes[key] = {"from": getattr(old, "value", old), "to": getattr(value, "value", value)}
        setattr(db_ticket, key, value)

    if "status" in changes:
        track_waiting(db_ticket, old_status, db_ticket.status)
        if db_ticket.status == models.TicketStatus.DELIVERED:
            mark_delivered(db, db_ticket)
        else:
            db_ticket.edit_window_ends_at = None
    if changes:
        log_audit(db, db_ticket.id, user, "Updated", changes)

    db.commit()
    db.refresh(db_ticket)

    if "status" in changes:
        events.emit(db, "ticket_moved", db_ticket, user, {"to": db_ticket.status.value})
        if db_ticket.external_key:
            delivery.run_in_background(integrations.push_status_to_jira, db_ticket.external_key, db_ticket.status.value)
    if db_ticket.assignee_id and db_ticket.assignee_id != old_assignee:
        events.emit(db, "ticket_assigned", db_ticket, user)
    return db_ticket

@router.post("/api/tickets/{ticket_id}/duplicate", response_model=schemas.TicketResponse, status_code=status.HTTP_201_CREATED)
def duplicate_ticket(ticket_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_staff)):
    """Copy a ticket as a fresh New ticket. It stays with the same client, so their portal still shows it."""
    src = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
    if not src:
        raise HTTPException(status_code=404, detail="Ticket not found")
    copy = models.Ticket(
        ticket_number=next_ticket_number(db),
        title=f"{src.title} (Copy)"[:200],
        brief=src.brief,
        design_type_id=src.design_type_id,
        type_specific_fields=src.type_specific_fields,
        priority=src.priority,
        tags=list(src.tags or []),
        figma_url=src.figma_url,
        estimate_hours=src.estimate_hours,
        requester_id=src.requester_id,
        client_org=src.client_org,
        due_at=compute_due_at(db, src.design_type, src.priority),
    )
    db.add(copy)
    db.flush()
    log_audit(db, copy.id, user, "Created", {"duplicated_from": src.ticket_number})
    log_audit(db, src.id, user, "Duplicated", {"copy": copy.ticket_number})
    db.commit()
    db.refresh(copy)
    return copy

@router.post("/api/tickets/recalculate-sla")
def recalculate_sla(db: Session = Depends(get_db), _user: models.User = Depends(require_lead)):
    # 1. Grab working schedules
    schedules = db.query(models.WorkingSchedule).all()
    schedule_dict = {
        s.day_of_week: {'is_working': s.is_working_day, 'start': s.start_hour, 'end': s.end_hour}
        for s in schedules
    }

    # 2. Grab holidays
    holidays = db.query(models.Holiday).all()
    holiday_set = {h.date.date() for h in holidays}

    # 3. Iterate over open tickets
    open_statuses = [
        models.TicketStatus.NEW, models.TicketStatus.ASSIGNED,
        models.TicketStatus.IN_PROGRESS, models.TicketStatus.WAITING_ON_REQUESTER,
        models.TicketStatus.IN_REVIEW
    ]
    tickets = db.query(models.Ticket).filter(models.Ticket.status.in_(open_statuses)).all()

    for ticket in tickets:
        sla_hours = ticket.design_type.default_sla_hours
        if ticket.priority == models.TicketPriority.URGENT:
            sla_hours = max(2, sla_hours // 2) # Configurable short SLA

        ticket.due_at = calculate_due_date(
            start_time=ticket.created_at,
            sla_hours=sla_hours,
            working_schedules=schedule_dict,
            holidays=holiday_set,
            paused_seconds=ticket.total_paused_seconds
        )

    db.commit()
    return {"message": f"Recalculated SLA for {len(tickets)} open tickets."}


# --- Pinpoint Comments ---
def _pins_out(db: Session, pins: List[models.PinpointComment]) -> List[schemas.PinpointCommentResponse]:
    """Pins with the author's name, so the UI can show who marked each spot."""
    people = {u.id: u for u in db.query(models.User).filter(models.User.id.in_({p.author_id for p in pins} or {0})).all()}
    out = []
    for p in pins:
        item = schemas.PinpointCommentResponse.model_validate(p)
        author = people.get(p.author_id)
        item.author_name = author.full_name if author else None
        item.author_role = author.role.value if author else None
        out.append(item)
    return out


@router.get("/api/tickets/{ticket_id}/pinpoints", response_model=List[schemas.PinpointCommentResponse])
def get_pinpoints(ticket_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    get_ticket_for_user(db, ticket_id, user)
    pins = db.query(models.PinpointComment).filter(models.PinpointComment.ticket_id == ticket_id) \
        .order_by(models.PinpointComment.created_at.asc(), models.PinpointComment.id.asc()).all()
    return _pins_out(db, pins)

@router.post("/api/tickets/{ticket_id}/pinpoints", response_model=schemas.PinpointCommentResponse, status_code=status.HTTP_201_CREATED)
def create_pinpoint(ticket_id: int, pinpoint: schemas.PinpointCommentCreate, db: Session = Depends(get_db), requester: models.User = Depends(get_current_user)):
    db_ticket = get_ticket_for_user(db, ticket_id, requester)

    if db_ticket.status not in [models.TicketStatus.IN_REVIEW, models.TicketStatus.DELIVERED]:
        if requester.role not in auth.STAFF_ROLES:
            raise HTTPException(status_code=403, detail="Comments are only allowed when the design is in review or delivered.")

    data = pinpoint.model_dump()
    data["content"] = data["content"].strip()
    if not data["content"] or len(data["content"]) > 1000:
        raise HTTPException(status_code=422, detail="Write a short note (up to 1000 characters) for this spot")
    try:
        x, y = float(data["x_pct"]), float(data["y_pct"])
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid position")
    if not (0 <= x <= 100 and 0 <= y <= 100):
        raise HTTPException(status_code=422, detail="The spot must be inside the design")
    key = data["image_url"]
    if key.startswith("proof:"):  # a design on this ticket, not someone else's
        proof_id = int(key[6:]) if key[6:].isdigit() else -1
        if not db.query(models.ProofVersion).filter(models.ProofVersion.id == proof_id, models.ProofVersion.ticket_id == ticket_id).first():
            raise HTTPException(status_code=422, detail="That design does not belong to this ticket")

    db_pinpoint = models.PinpointComment(**data, ticket_id=ticket_id, author_id=requester.id)
    db.add(db_pinpoint)
    db.commit()
    db.refresh(db_pinpoint)
    return _pins_out(db, [db_pinpoint])[0]

@router.patch("/api/tickets/{ticket_id}/pinpoints/{pinpoint_id}", response_model=schemas.PinpointCommentResponse)
def update_pinpoint(ticket_id: int, pinpoint_id: int, resolved: bool, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    get_ticket_for_user(db, ticket_id, user)
    db_pinpoint = db.query(models.PinpointComment).filter(models.PinpointComment.id == pinpoint_id, models.PinpointComment.ticket_id == ticket_id).first()
    if not db_pinpoint:
        raise HTTPException(status_code=404, detail="Pinpoint not found")

    db_pinpoint.is_resolved = resolved
    db.commit()
    db.refresh(db_pinpoint)
    return _pins_out(db, [db_pinpoint])[0]


# --- Subtasks ---
@router.post("/api/tickets/{ticket_id}/subtasks", response_model=schemas.SubtaskResponse, status_code=status.HTTP_201_CREATED)
def create_subtask(ticket_id: int, subtask: schemas.SubtaskCreate, db: Session = Depends(get_db), _user: models.User = Depends(require_staff)):
    db_ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
    if not db_ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    db_subtask = models.Subtask(**subtask.model_dump(), ticket_id=ticket_id)
    db.add(db_subtask)
    db.commit()
    db.refresh(db_subtask)
    return db_subtask

@router.patch("/api/tickets/{ticket_id}/subtasks/{subtask_id}", response_model=schemas.SubtaskResponse)
def update_subtask(ticket_id: int, subtask_id: int, subtask_update: schemas.SubtaskUpdate, db: Session = Depends(get_db), _user: models.User = Depends(require_staff)):
    db_subtask = db.query(models.Subtask).filter(models.Subtask.id == subtask_id, models.Subtask.ticket_id == ticket_id).first()
    if not db_subtask:
        raise HTTPException(status_code=404, detail="Subtask not found")

    update_data = subtask_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_subtask, key, value)

    db.commit()
    db.refresh(db_subtask)
    return db_subtask

@router.delete("/api/tickets/{ticket_id}/subtasks/{subtask_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_subtask(ticket_id: int, subtask_id: int, db: Session = Depends(get_db), _user: models.User = Depends(require_staff)):
    db_subtask = db.query(models.Subtask).filter(models.Subtask.id == subtask_id, models.Subtask.ticket_id == ticket_id).first()
    if not db_subtask:
        raise HTTPException(status_code=404, detail="Subtask not found")

    db.delete(db_subtask)
    db.commit()
    return None
