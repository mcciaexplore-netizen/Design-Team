import os
import secrets
from fastapi import FastAPI, Depends, HTTPException, status, Header, WebSocket, WebSocketDisconnect, BackgroundTasks, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func
from sqlalchemy.orm import Session
from typing import List, Dict

import models, schemas, auth, events
import realtime
import notify_api, collab, views_bulk, templates_recurring, timetracking, approvals, reports
from common import log_audit, compute_due_at, next_ticket_number
from auth import get_current_user, require_staff, require_lead, is_client, get_ticket_for_user
from database import engine, get_db
from sla_engine import calculate_due_date
import datetime
import pytz

import forecasting
from integrations import handle_incoming_jira_webhook, notify_slack_high_priority_ticket, notify_slack_last_minute_change
import io
import csv

app = FastAPI(title="DesignFlow API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(notify_api.router)
app.include_router(collab.router)
app.include_router(views_bulk.router)
app.include_router(templates_recurring.router)
app.include_router(timetracking.router)
app.include_router(approvals.router)
app.include_router(reports.router)
app.include_router(forecasting.router, dependencies=[Depends(require_staff)])

# --- WebSocket Manager ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[int, List[WebSocket]] = {} # ticket_id -> list of connections

    async def connect(self, websocket: WebSocket, ticket_id: int):
        await websocket.accept()
        if ticket_id not in self.active_connections:
            self.active_connections[ticket_id] = []
        self.active_connections[ticket_id].append(websocket)

    def disconnect(self, websocket: WebSocket, ticket_id: int):
        if ticket_id in self.active_connections:
            self.active_connections[ticket_id].remove(websocket)
            if not self.active_connections[ticket_id]:
                del self.active_connections[ticket_id]

    async def broadcast_to_ticket(self, ticket_id: int, message: dict):
        if ticket_id in self.active_connections:
            for connection in self.active_connections[ticket_id]:
                await connection.send_json(message)

manager = ConnectionManager()

CRON_SECRET = os.getenv("CRON_SECRET", "default_secret")

@app.get("/")
def read_root():
    return {"message": "Welcome to DesignFlow API"}

@app.get("/health")
def health_check():
    return {"status": "ok"}

@app.post("/internal/tick")
def internal_tick(x_cron_secret: str = Header(None), db: Session = Depends(get_db)):
    if x_cron_secret != CRON_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden")

    from cron_jobs import run_all_cron_jobs
    run_all_cron_jobs(db)
    return {"status": "tick_processed"}

@app.get("/api/users", response_model=List[schemas.UserResponse])
def get_users(db: Session = Depends(get_db), _user: models.User = Depends(require_staff)):
    return db.query(models.User).all()

@app.get("/api/design-types", response_model=List[schemas.DesignTypeResponse])
def get_design_types(db: Session = Depends(get_db), _user: models.User = Depends(get_current_user)):
    return db.query(models.DesignType).filter(models.DesignType.is_active == True).all()

@app.get("/api/tickets", response_model=List[schemas.TicketResponse])
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

@app.post("/api/tickets", response_model=schemas.TicketResponse, status_code=status.HTTP_201_CREATED)
def create_ticket(ticket: schemas.TicketCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db), requester: models.User = Depends(get_current_user)):
    design_type = db.query(models.DesignType).filter(
        models.DesignType.id == ticket.design_type_id, models.DesignType.is_active == True
    ).first()
    if not design_type:
        raise HTTPException(status_code=422, detail="Unknown design type")

    data = ticket.dict()
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
    db.add(db_ticket)
    db.flush()
    log_audit(db, db_ticket.id, requester, "Created", {"status": db_ticket.status.value, "priority": db_ticket.priority.value})
    db.commit()
    db.refresh(db_ticket)

    events.emit(db, "ticket_created", db_ticket, requester)

    # Feature 14: Slack Integration for high priority tickets
    if db_ticket.priority == models.TicketPriority.URGENT:
        background_tasks.add_task(notify_slack_high_priority_ticket, db_ticket)

    return db_ticket

@app.patch("/api/tickets/{ticket_id}", response_model=schemas.TicketResponse)
def update_ticket(ticket_id: int, ticket_update: schemas.TicketUpdate, db: Session = Depends(get_db), user: models.User = Depends(require_staff)):
    db_ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
    if not db_ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    update_data = ticket_update.dict(exclude_unset=True)

    if user.role not in auth.LEAD_ROLES:
        forbidden = {"assignee_id", "priority"} & update_data.keys()
        if forbidden:
            raise HTTPException(status_code=403, detail="Only a Design Lead can change: " + ", ".join(sorted(forbidden)))

    old_assignee = db_ticket.assignee_id
    changes = {}
    for key, value in update_data.items():
        old = getattr(db_ticket, key)
        if old != value:
            changes[key] = {"from": getattr(old, "value", old), "to": getattr(value, "value", value)}
        setattr(db_ticket, key, value)

    if "status" in changes and db_ticket.status == models.TicketStatus.DELIVERED and db_ticket.delivered_at is None:
        db_ticket.delivered_at = datetime.datetime.now(pytz.utc)
    if changes:
        log_audit(db, db_ticket.id, user, "Updated", changes)

    db.commit()
    db.refresh(db_ticket)

    if "status" in changes:
        events.emit(db, "ticket_moved", db_ticket, user, {"to": db_ticket.status.value})
    if db_ticket.assignee_id and db_ticket.assignee_id != old_assignee:
        events.emit(db, "ticket_assigned", db_ticket, user)
    return db_ticket

@app.post("/api/tickets/{ticket_id}/duplicate", response_model=schemas.TicketResponse, status_code=status.HTTP_201_CREATED)
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

@app.post("/api/tickets/recalculate-sla")
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

# --- Revisions (Parent-Child) ---
from pydantic import BaseModel
class RevisionRequest(BaseModel):
    reason_for_change: str

@app.post("/api/tickets/{ticket_id}/revisions", response_model=schemas.TicketResponse, status_code=status.HTTP_201_CREATED)
def request_revision(ticket_id: int, request: RevisionRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    parent_ticket = get_ticket_for_user(db, ticket_id, user)

    if parent_ticket.status not in [models.TicketStatus.DELIVERED, models.TicketStatus.IN_REVIEW]:
        raise HTTPException(status_code=400, detail="Can only request revisions on IN_REVIEW or DELIVERED tickets")

    # Lock the parent ticket
    parent_ticket.status = models.TicketStatus.CLOSED_WITHOUT_APPROVAL # Or a specific "REVISION_REQUESTED" status if we added it
    parent_ticket.is_locked = True

    # Generate new ticket number (e.g. DF-0001-V2)
    base_number = parent_ticket.ticket_number.split('-V')[0]
    new_version = parent_ticket.version_number + 1
    new_ticket_number = f"{base_number}-V{new_version}"

    # Check for last-minute change
    tags = list(parent_ticket.tags) if parent_ticket.tags else []
    is_last_minute = False
    if parent_ticket.due_at:
        now_utc = datetime.datetime.now(pytz.utc)
        due_utc = parent_ticket.due_at
        if due_utc.tzinfo is None:
            due_utc = due_utc.replace(tzinfo=pytz.utc)
        if (due_utc - now_utc).total_seconds() < 12 * 3600:
            is_last_minute = True
            if "Last-Minute Change" not in tags:
                tags.append("Last-Minute Change")

    # Spin up the Child V2 Ticket
    child_ticket = models.Ticket(
        ticket_number=new_ticket_number,
        title=parent_ticket.title,
        brief=parent_ticket.brief,
        design_type_id=parent_ticket.design_type_id,
        type_specific_fields=parent_ticket.type_specific_fields,
        priority=parent_ticket.priority,
        status=models.TicketStatus.NEW,
        requester_id=parent_ticket.requester_id,
        client_org=parent_ticket.client_org,
        parent_id=parent_ticket.id,
        version_number=new_version,
        reason_for_change=request.reason_for_change,
        tags=tags
    )

    db.add(child_ticket)
    db.commit()
    db.refresh(child_ticket)

    if is_last_minute:
        background_tasks.add_task(notify_slack_last_minute_change, child_ticket)

    return child_ticket

@app.post("/api/webhooks/jira")
async def jira_webhook_receiver(payload: dict, x_webhook_secret: str = Header(None), db: Session = Depends(get_db)):
    """
    Receives payloads from Jira for 2-Way Sync.
    """
    expected = os.getenv("JIRA_WEBHOOK_SECRET")
    if not expected or not x_webhook_secret or not secrets.compare_digest(x_webhook_secret, expected):
        raise HTTPException(status_code=403, detail="Forbidden")
    result = await handle_incoming_jira_webhook(payload, db)
    return result

# --- Pinpoint Comments ---
@app.get("/api/tickets/{ticket_id}/pinpoints", response_model=List[schemas.PinpointCommentResponse])
def get_pinpoints(ticket_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    get_ticket_for_user(db, ticket_id, user)
    return db.query(models.PinpointComment).filter(models.PinpointComment.ticket_id == ticket_id).order_by(models.PinpointComment.created_at.asc()).all()

@app.post("/api/tickets/{ticket_id}/pinpoints", response_model=schemas.PinpointCommentResponse, status_code=status.HTTP_201_CREATED)
def create_pinpoint(ticket_id: int, pinpoint: schemas.PinpointCommentCreate, db: Session = Depends(get_db), requester: models.User = Depends(get_current_user)):
    db_ticket = get_ticket_for_user(db, ticket_id, requester)

    if db_ticket.status not in [models.TicketStatus.IN_REVIEW, models.TicketStatus.DELIVERED]:
        if requester.role not in auth.STAFF_ROLES:
            raise HTTPException(status_code=403, detail="Comments are only allowed when the design is in review or delivered.")

    db_pinpoint = models.PinpointComment(
        **pinpoint.dict(),
        ticket_id=ticket_id,
        author_id=requester.id
    )
    db.add(db_pinpoint)
    db.commit()
    db.refresh(db_pinpoint)
    return db_pinpoint

@app.patch("/api/tickets/{ticket_id}/pinpoints/{pinpoint_id}", response_model=schemas.PinpointCommentResponse)
def update_pinpoint(ticket_id: int, pinpoint_id: int, resolved: bool, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    get_ticket_for_user(db, ticket_id, user)
    db_pinpoint = db.query(models.PinpointComment).filter(models.PinpointComment.id == pinpoint_id, models.PinpointComment.ticket_id == ticket_id).first()
    if not db_pinpoint:
        raise HTTPException(status_code=404, detail="Pinpoint not found")

    db_pinpoint.is_resolved = resolved
    db.commit()
    db.refresh(db_pinpoint)
    return db_pinpoint

# --- WebSockets ---
def _ws_session():
    """A short-lived DB session for WebSocket handshakes (honours dependency overrides, e.g. in tests)."""
    return (app.dependency_overrides.get(get_db) or get_db)()


@app.websocket("/ws/{user_ref}")
async def live_events(websocket: WebSocket, user_ref: str):
    """Live feed of ticket events for the signed-in user. The path segment is ignored; identity comes from the token."""
    gen = _ws_session()
    db = next(gen)
    try:
        user = await auth.authenticate_websocket(websocket, db)
    finally:
        gen.close()
    if not user:
        await websocket.close(code=4401)
        return
    await websocket.accept()
    sub = await realtime.register(websocket, user)
    try:
        while True:
            await websocket.receive_text()  # We only push; this just notices the client leaving.
    except WebSocketDisconnect:
        pass
    finally:
        realtime.unregister(sub)



@app.websocket("/api/tickets/{ticket_id}/ws")
async def websocket_endpoint(websocket: WebSocket, ticket_id: int):
    gen = _ws_session()
    db = next(gen)
    try:
        user = await auth.authenticate_websocket(websocket, db)
        ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
        allowed = bool(user and ticket and auth.can_access_ticket(user, ticket))
        sender = user.full_name if user else "User"
    finally:
        gen.close()
    if not allowed:
        await websocket.close(code=4401)
        return
    await manager.connect(websocket, ticket_id)
    try:
        while True:
            data = await websocket.receive_text()
            # Here we could save the received text as a TicketComment in the DB
            # For now, just broadcast it back to everyone viewing this ticket
            await manager.broadcast_to_ticket(ticket_id, {"sender": sender, "message": data, "timestamp": datetime.datetime.now().isoformat()})
    except WebSocketDisconnect:
        manager.disconnect(websocket, ticket_id)


# --- Subtasks ---
@app.post("/api/tickets/{ticket_id}/subtasks", response_model=schemas.SubtaskResponse, status_code=status.HTTP_201_CREATED)
def create_subtask(ticket_id: int, subtask: schemas.SubtaskCreate, db: Session = Depends(get_db), _user: models.User = Depends(require_staff)):
    db_ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
    if not db_ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    db_subtask = models.Subtask(**subtask.dict(), ticket_id=ticket_id)
    db.add(db_subtask)
    db.commit()
    db.refresh(db_subtask)
    return db_subtask

@app.patch("/api/tickets/{ticket_id}/subtasks/{subtask_id}", response_model=schemas.SubtaskResponse)
def update_subtask(ticket_id: int, subtask_id: int, subtask_update: schemas.SubtaskUpdate, db: Session = Depends(get_db), _user: models.User = Depends(require_staff)):
    db_subtask = db.query(models.Subtask).filter(models.Subtask.id == subtask_id, models.Subtask.ticket_id == ticket_id).first()
    if not db_subtask:
        raise HTTPException(status_code=404, detail="Subtask not found")

    update_data = subtask_update.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_subtask, key, value)

    db.commit()
    db.refresh(db_subtask)
    return db_subtask

@app.delete("/api/tickets/{ticket_id}/subtasks/{subtask_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_subtask(ticket_id: int, subtask_id: int, db: Session = Depends(get_db), _user: models.User = Depends(require_staff)):
    db_subtask = db.query(models.Subtask).filter(models.Subtask.id == subtask_id, models.Subtask.ticket_id == ticket_id).first()
    if not db_subtask:
        raise HTTPException(status_code=404, detail="Subtask not found")

    db.delete(db_subtask)
    db.commit()
    return None
