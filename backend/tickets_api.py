"""Tickets: listing, creation, updates, duplication, subtasks and pinpoint comments, plus the lookups the board needs."""
import datetime
import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, joinedload, selectinload

import auth
import capacity_engine
import deletion
import delivery
import events
import integrations
import models
import schemas
from auth import get_current_user, get_ticket_for_user, is_client, require_lead, require_staff
from common import DEFAULT_SCHEDULE, after_status_change, compute_due_at, log_audit, next_ticket_number, track_waiting
from database import get_db
from sla_engine import calculate_due_date

router = APIRouter(tags=["tickets"])
logger = logging.getLogger(__name__)


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
    # Load the people, design type and subtasks up front. Without this every ticket costs its own queries,
    # which is what made the board slow once there were a few hundred tickets.
    query = db.query(models.Ticket).options(
        joinedload(models.Ticket.requester), joinedload(models.Ticket.assignee), joinedload(models.Ticket.design_type),
        selectinload(models.Ticket.subtasks))
    if is_client(user):
        if user.client_org:
            query = query.filter(models.Ticket.client_org == user.client_org)
        else:
            query = query.filter(models.Ticket.requester_id == user.id)
    elif user.role == models.RoleEnum.DESIGNER:
        # A request only a Design Lead can accept or decline; a Designer has nothing to do with it yet.
        query = query.filter(models.Ticket.status.notin_([models.TicketStatus.PENDING_REVIEW, models.TicketStatus.DECLINED]))
    return query.order_by(models.Ticket.created_at.desc()).all()

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
        data.pop("workflow_stage_id", None)
    _check_refs(db, data)

    db_ticket = models.Ticket(
        **data,
        ticket_number=next_ticket_number(db),
        requester_id=requester.id,
        client_org=requester.client_org,
        due_at=compute_due_at(db, design_type, ticket.priority),
    )
    if is_client(requester):
        # A Design Lead must accept the request before it enters the workflow; see accept_ticket below.
        db_ticket.status = models.TicketStatus.PENDING_REVIEW
    elif not db_ticket.assignee_id:
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
    if is_client(requester):
        events.email_request_received(db_ticket)

    return db_ticket


class DeclineBody(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


class AcceptBody(BaseModel):
    assignee_id: int | None = Field(default=None)


class ClarificationBody(BaseModel):
    question: str = Field(min_length=1, max_length=1000)


@router.post("/api/tickets/{ticket_id}/accept", response_model=schemas.TicketResponse)
def accept_ticket(ticket_id: int, body: AcceptBody | None = None, db: Session = Depends(get_db), lead: models.User = Depends(require_lead)):
    """A Design Lead accepts a Pending Review request: it becomes a real ticket, optionally assigned to a specific staff member or auto-assigned."""
    ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if ticket.status != models.TicketStatus.PENDING_REVIEW:
        raise HTTPException(status_code=409, detail="This request has already been reviewed.")

    ticket.status = models.TicketStatus.NEW
    chosen_assignee_id = body.assignee_id if body else None

    if chosen_assignee_id:
        assignee = db.query(models.User).filter(
            models.User.id == chosen_assignee_id,
            models.User.is_active == True,
            models.User.role != models.RoleEnum.REQUESTER
        ).first()
        if not assignee:
            raise HTTPException(status_code=422, detail="Assignee must be an active staff member")
        ticket.assignee_id = assignee.id
        ticket.status = models.TicketStatus.ASSIGNED
    else:
        designer = capacity_engine.suggest_assignee(db, ticket.design_type_id)
        if designer:
            ticket.assignee_id = designer.id
            ticket.status = models.TicketStatus.ASSIGNED

    log_audit(db, ticket.id, lead, "Accepted", {"status": ticket.status.value, "assignee_id": ticket.assignee_id})
    db.commit()
    db.refresh(ticket)

    events.emit(db, "ticket_moved", ticket, lead, {"to": ticket.status.value})
    if ticket.assignee_id:
        events.emit(db, "ticket_assigned", ticket, lead, {"auto": chosen_assignee_id is None})
    if ticket.requester_id:
        events.notify(db, ticket.requester, f"Your request {ticket.ticket_number} was accepted and is now in progress.",
                      "ticket_accepted", ticket)
        db.commit()
    return ticket


@router.post("/api/tickets/{ticket_id}/clarify", response_model=schemas.TicketResponse)
def request_clarification(ticket_id: int, body: ClarificationBody, db: Session = Depends(get_db), lead: models.User = Depends(require_lead)):
    """A Design Lead asks the requester for clarification on a request, moving it to Waiting on Requester without declining."""
    ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    old_status = ticket.status
    ticket.status = models.TicketStatus.WAITING_ON_REQUESTER
    question_text = body.question.strip()
    log_audit(db, ticket.id, lead, "Clarification Requested", {"from": old_status.value, "question": question_text})
    db.commit()
    db.refresh(ticket)

    events.emit(db, "ticket_moved", ticket, lead, {"from": old_status.value, "to": ticket.status.value})
    if ticket.requester_id:
        msg = f"The design team has a question about {ticket.ticket_number}: {question_text}"
        events.notify(db, ticket.requester, msg, "ticket_clarification", ticket)
        db.commit()
    return ticket


@router.post("/api/tickets/{ticket_id}/decline", response_model=schemas.TicketResponse)
def decline_ticket(ticket_id: int, body: DeclineBody, db: Session = Depends(get_db), lead: models.User = Depends(require_lead)):
    """A Design Lead declines a Pending Review request: it never enters the workflow."""
    ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if ticket.status != models.TicketStatus.PENDING_REVIEW:
        raise HTTPException(status_code=409, detail="This request has already been reviewed.")

    ticket.status = models.TicketStatus.DECLINED
    ticket.decline_reason = (body.reason or "").strip() or None
    log_audit(db, ticket.id, lead, "Declined", {"reason": ticket.decline_reason})
    db.commit()
    db.refresh(ticket)

    events.emit(db, "ticket_moved", ticket, lead, {"to": ticket.status.value})
    if ticket.requester_id:
        message = f"Your request {ticket.ticket_number} was declined."
        if ticket.decline_reason:
            message += f" {ticket.decline_reason}"
        events.notify(db, ticket.requester, message, "ticket_declined", ticket)
        db.commit()
    return ticket


NOT_BLANK = {"title", "brief", "type_specific_fields", "priority", "status", "tags"}


@router.delete("/api/tickets/{ticket_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_ticket(ticket_id: int, db: Session = Depends(get_db), lead: models.User = Depends(require_lead)):
    """Design Leads only: delete a ticket with its designs, files, approvals and history. Other versions stay."""
    ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    number = ticket.ticket_number
    deletion.delete_ticket(db, ticket)
    logger.info("ticket_deleted by=%s ticket=%s", lead.email, number)


def _check_refs(db: Session, data: dict) -> None:
    """An assignee must be active staff and a workflow stage must exist (Postgres would otherwise fail with a 500,
    and assigning a client would show them another company's ticket in a notification)."""
    if data.get("assignee_id") is not None and not db.query(models.User.id).filter(
            models.User.id == data["assignee_id"], models.User.is_active == True,  # noqa: E712
            models.User.role != models.RoleEnum.REQUESTER).first():
        raise HTTPException(status_code=422, detail="Assignee must be an active staff member")
    if data.get("workflow_stage_id") is not None and not db.query(models.WorkflowStage.id).filter(
            models.WorkflowStage.id == data["workflow_stage_id"]).first():
        raise HTTPException(status_code=422, detail="Unknown workflow stage")


@router.patch("/api/tickets/{ticket_id}", response_model=schemas.TicketResponse)
def update_ticket(ticket_id: int, ticket_update: schemas.TicketUpdate, db: Session = Depends(get_db), user: models.User = Depends(require_staff)):
    db_ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
    if not db_ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    update_data = ticket_update.model_dump(exclude_unset=True)
    _check_refs(db, update_data)
    blanked = sorted(k for k in NOT_BLANK if k in update_data and update_data[k] is None)
    if blanked:   # a stored null here would break every ticket list for everyone
        raise HTTPException(status_code=422, detail="These can't be empty: " + ", ".join(blanked))

    if user.role not in auth.LEAD_ROLES:
        forbidden = {"assignee_id", "priority"} & update_data.keys()
        if forbidden:
            raise HTTPException(status_code=403, detail="Only a Design Lead can change: " + ", ".join(sorted(forbidden)))

    old_assignee = db_ticket.assignee_id
    old_status = db_ticket.status
    # Giving a New ticket to someone makes it Assigned, as automatic assignment does.
    if update_data.get("assignee_id") and "status" not in update_data and db_ticket.status == models.TicketStatus.NEW:
        update_data["status"] = models.TicketStatus.ASSIGNED
    changes = {}
    for key, value in update_data.items():
        old = getattr(db_ticket, key)
        if old != value:
            changes[key] = {"from": getattr(old, "value", old), "to": getattr(value, "value", value)}
        setattr(db_ticket, key, value)

    if "status" in changes:
        track_waiting(db_ticket, old_status, db_ticket.status)
        after_status_change(db, db_ticket)
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

class ClientChange(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


@router.post("/api/tickets/{ticket_id}/client-changes", response_model=schemas.TicketResponse, status_code=status.HTTP_201_CREATED)
def add_client_change(ticket_id: int, body: ClientChange, db: Session = Depends(get_db), user: models.User = Depends(require_staff)):
    """Note down a change the client asked for (by phone, email, in person). Kept on the ticket in
    type_specific_fields["client_changes"], shown to everyone on it, and sent to the assigned designer."""
    ticket = db.query(models.Ticket).options(joinedload(models.Ticket.assignee)).filter(models.Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if ticket.is_locked:
        raise HTTPException(status_code=409, detail="This request is closed. Raise a new request for further changes.")
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="Write what the client wants changed.")
    entry = {"text": text, "at": datetime.datetime.now(datetime.timezone.utc).isoformat(), "by": user.full_name}
    fields = dict(ticket.type_specific_fields or {})
    fields["client_changes"] = [*fields.get("client_changes", []), entry]
    ticket.type_specific_fields = fields   # a new dict, so the JSON column is saved
    log_audit(db, ticket.id, user, "Client changes added", {"text": text})
    if ticket.assignee and ticket.assignee.id != user.id:
        events.notify(db, ticket.assignee, f"{user.full_name} added changes from the client on {ticket.ticket_number}: "
                      f"{text[:140]}{'…' if len(text) > 140 else ''}", "client_changes", ticket)
    db.commit()
    db.refresh(ticket)
    return ticket


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
    } or DEFAULT_SCHEDULE   # with no rows every day was "not working" and the due-date search never ended

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


