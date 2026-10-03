"""Saved board views (per-user or shared) and bulk ticket actions."""
import datetime
from typing import List, Literal, Optional

import pytz
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

import events
import models
from auth import LEAD_ROLES, get_current_user, require_staff
from common import log_audit
from database import get_db

router = APIRouter(tags=["views"])

MAX_VIEWS_PER_USER = 30


# ── Saved views ──────────────────────────────────────────────────────────────

class ViewFilters(BaseModel):
    """What a saved view can store. Unknown keys are rejected so the JSON column stays predictable."""
    model_config = ConfigDict(extra="forbid")
    search: str = Field(default="", max_length=100)
    statuses: List[str] = Field(default_factory=list, max_length=12)
    priorities: List[str] = Field(default_factory=list, max_length=4)
    assignee: Optional[str] = Field(default=None, max_length=40)  # "me", "unassigned" or a user id
    requester: Optional[Literal["me"]] = None
    sla: Literal["any", "overdue", "breaching_soon", "on_track"] = "any"
    tags: List[str] = Field(default_factory=list, max_length=10)


class ViewBody(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    filters: ViewFilters
    is_shared: bool = False


def _view_out(v: models.SavedView, owner_name: str, me: models.User) -> dict:
    return {"id": v.id, "name": v.name, "filters": v.filters, "is_shared": v.is_shared,
            "owner": owner_name, "is_mine": v.user_id == me.id}


@router.get("/api/views")
def list_views(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    q = db.query(models.SavedView, models.User.full_name).join(models.User, models.User.id == models.SavedView.user_id)
    if user.role == models.RoleEnum.REQUESTER:
        q = q.filter(models.SavedView.user_id == user.id)  # Clients never see staff or other clients' views
    else:
        q = q.filter((models.SavedView.user_id == user.id) | (models.SavedView.is_shared == True))
    return [_view_out(v, name, user) for v, name in q.order_by(models.SavedView.name.asc()).all()]


@router.post("/api/views", status_code=201)
def create_view(body: ViewBody, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    if body.is_shared and user.role not in LEAD_ROLES:
        raise HTTPException(status_code=403, detail="Only a Design Lead can share a view with the team")
    if db.query(models.SavedView).filter(models.SavedView.user_id == user.id).count() >= MAX_VIEWS_PER_USER:
        raise HTTPException(status_code=400, detail=f"You can save up to {MAX_VIEWS_PER_USER} views")
    view = models.SavedView(user_id=user.id, name=body.name.strip(), filters=body.filters.model_dump(), is_shared=body.is_shared)
    db.add(view)
    db.commit()
    db.refresh(view)
    return _view_out(view, user.full_name, user)


def _own_view(db: Session, view_id: int, user: models.User, allow_lead_delete: bool = False) -> models.SavedView:
    view = db.query(models.SavedView).filter(models.SavedView.id == view_id).first()
    if not view:
        raise HTTPException(status_code=404, detail="View not found")
    if view.user_id != user.id and not (allow_lead_delete and user.role in LEAD_ROLES and view.is_shared):
        raise HTTPException(status_code=404, detail="View not found")
    return view


@router.put("/api/views/{view_id}")
def update_view(view_id: int, body: ViewBody, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    view = _own_view(db, view_id, user)
    if body.is_shared and user.role not in LEAD_ROLES:
        raise HTTPException(status_code=403, detail="Only a Design Lead can share a view with the team")
    view.name, view.filters, view.is_shared = body.name.strip(), body.filters.model_dump(), body.is_shared
    db.commit()
    return _view_out(view, user.full_name, user)


@router.delete("/api/views/{view_id}", status_code=204)
def delete_view(view_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    view = _own_view(db, view_id, user, allow_lead_delete=True)
    db.delete(view)
    db.commit()
    return Response(status_code=204)


# ── Bulk actions ─────────────────────────────────────────────────────────────

class BulkAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ticket_ids: List[int] = Field(min_length=1, max_length=100)
    status: Optional[models.TicketStatus] = None
    priority: Optional[models.TicketPriority] = None
    assignee_id: Optional[int] = None  # Send null explicitly to unassign
    add_tags: List[str] = Field(default_factory=list, max_length=10)
    remove_tags: List[str] = Field(default_factory=list, max_length=10)


def _clean_tags(tags: List[str]) -> List[str]:
    out = []
    for t in tags:
        t = " ".join(t.split())[:30]
        if t and t not in out:
            out.append(t)
    return out


@router.post("/api/tickets/bulk")
def bulk_update(body: BulkAction, db: Session = Depends(get_db), user: models.User = Depends(require_staff)):
    sent = body.model_fields_set
    wants_assignee = "assignee_id" in sent
    add_tags, remove_tags = _clean_tags(body.add_tags), set(_clean_tags(body.remove_tags))
    if not (body.status or body.priority or wants_assignee or add_tags or remove_tags):
        raise HTTPException(status_code=422, detail="Nothing to change")
    if (body.priority or wants_assignee) and user.role not in LEAD_ROLES:
        raise HTTPException(status_code=403, detail="Only a Design Lead can bulk-change assignee or priority")

    assignee = None
    if wants_assignee and body.assignee_id is not None:
        assignee = db.query(models.User).filter(
            models.User.id == body.assignee_id, models.User.is_active == True,
            models.User.role != models.RoleEnum.REQUESTER).first()
        if not assignee:
            raise HTTPException(status_code=422, detail="Assignee must be an active staff member")

    ids = list(dict.fromkeys(body.ticket_ids))
    tickets = {t.id: t for t in db.query(models.Ticket).filter(models.Ticket.id.in_(ids)).all()}
    updated, failed, moved, assigned = [], [], [], []
    for tid in ids:
        t = tickets.get(tid)
        if not t:
            failed.append({"id": tid, "reason": "Ticket not found"})
            continue
        if t.is_locked:
            failed.append({"id": tid, "reason": "Ticket is locked"})
            continue
        changes = {}
        if body.status and t.status != body.status:
            changes["status"] = {"from": t.status.value, "to": body.status.value}
            t.status = body.status
            if body.status == models.TicketStatus.DELIVERED and t.delivered_at is None:
                t.delivered_at = datetime.datetime.now(pytz.utc)
            moved.append(t)
        if body.priority and t.priority != body.priority:
            changes["priority"] = {"from": t.priority.value, "to": body.priority.value}
            t.priority = body.priority
        if wants_assignee and t.assignee_id != body.assignee_id:
            changes["assignee_id"] = {"from": t.assignee_id, "to": body.assignee_id}
            t.assignee_id = body.assignee_id
            if body.assignee_id:
                assigned.append(t)
        if add_tags or remove_tags:
            current = list(t.tags or [])
            new = [x for x in current if x not in remove_tags] + [x for x in add_tags if x not in current and x not in remove_tags]
            if new != current:
                changes["tags"] = {"from": current, "to": new}
                t.tags = new
        if changes:
            log_audit(db, t.id, user, "Bulk update", changes)
        updated.append(tid)
    db.commit()

    for t in moved:
        events.emit(db, "ticket_moved", t, user, {"to": t.status.value})
    for t in assigned:
        events.emit(db, "ticket_assigned", t, user)
    return {"updated": updated, "failed": failed}
