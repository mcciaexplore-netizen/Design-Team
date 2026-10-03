"""Ticket templates (single tickets or bundles) and recurring rules that raise them on a schedule."""
import datetime
import logging
from typing import Dict, List, Any, Literal, Optional

import pytz
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

import events
import models
from auth import get_current_user, require_lead, require_staff
from common import as_utc, compute_due_at, log_audit, next_ticket_number
from database import get_db

logger = logging.getLogger(__name__)
router = APIRouter(tags=["templates"])
IST = pytz.timezone("Asia/Kolkata")


# ── Schedule maths (pure) ────────────────────────────────────────────────────

def compute_next_run(frequency: str, day: int, hour: int, after: datetime.datetime) -> datetime.datetime:
    """First scheduled run strictly after `after`, in IST, returned as UTC."""
    local = after.astimezone(IST)
    if frequency == "weekly":
        candidate = local.replace(hour=hour, minute=0, second=0, microsecond=0) + datetime.timedelta(days=(day - local.weekday()) % 7)
        if candidate <= local:
            candidate += datetime.timedelta(days=7)
    elif frequency == "monthly":
        candidate = local.replace(day=day, hour=hour, minute=0, second=0, microsecond=0)
        if candidate <= local:
            year, month = (local.year + 1, 1) if local.month == 12 else (local.year, local.month + 1)
            candidate = candidate.replace(year=year, month=month, day=day)
    else:
        raise ValueError(f"Unknown frequency {frequency}")
    # Re-localise so a DST change (none in IST, but be safe) cannot shift the wall-clock hour.
    candidate = IST.localize(datetime.datetime(candidate.year, candidate.month, candidate.day, hour))
    return candidate.astimezone(pytz.utc)


def render_text(text: str, now: datetime.datetime, client: Optional[str]) -> str:
    """Plain placeholder substitution ({month}, {year}, {date}, {client}). Not str.format, so stray braces are safe."""
    local = now.astimezone(IST)
    return (text.replace("{month}", local.strftime("%B")).replace("{year}", str(local.year))
            .replace("{date}", local.strftime("%d %b %Y")).replace("{client}", client or ""))


# ── Instantiation ────────────────────────────────────────────────────────────

def instantiate_template(db: Session, template: models.TicketTemplate, requester: models.User,
                         assignee: Optional[models.User], actor: Optional[models.User],
                         now: Optional[datetime.datetime] = None, source: str = "template") -> List[models.Ticket]:
    now = now or datetime.datetime.now(pytz.utc)
    created: List[models.Ticket] = []
    for item in template.items:
        dt = db.query(models.DesignType).filter(
            models.DesignType.id == item.get("design_type_id"), models.DesignType.is_active == True).first()
        if not dt:
            logger.warning("Template %s skipped an item: design type %s is gone", template.id, item.get("design_type_id"))
            continue
        priority = models.TicketPriority(item.get("priority", "Normal"))
        ticket = models.Ticket(
            ticket_number=next_ticket_number(db),
            title=render_text(item["title"], now, requester.client_org or requester.full_name)[:200],
            brief=render_text(item["brief"], now, requester.client_org or requester.full_name),
            design_type_id=dt.id,
            type_specific_fields=item.get("type_specific_fields") or {},
            priority=priority,
            tags=list(item.get("tags") or []),
            estimate_hours=item.get("estimate_hours"),
            requester_id=requester.id,
            client_org=requester.client_org,
            assignee_id=assignee.id if assignee else None,
            due_at=compute_due_at(db, dt, priority, now),
        )
        db.add(ticket)
        db.flush()
        log_audit(db, ticket.id, actor, f"Created from {source}",
                  {"template_id": template.id, "template": template.name}, actor_label=None if actor else "Recurring schedule")
        created.append(ticket)
    return created


def run_due_rules(db: Session, now: Optional[datetime.datetime] = None) -> int:
    """Raise tickets for every rule whose time has come. Safe to call repeatedly (e.g. every cron tick)."""
    now = now or datetime.datetime.now(pytz.utc)
    rules = db.query(models.RecurringRule).filter(
        models.RecurringRule.is_active == True, models.RecurringRule.next_run_at <= now).all()
    total = 0
    for rule in rules:
        old_next = rule.next_run_at
        new_next = compute_next_run(rule.frequency, rule.day, rule.hour, now)
        # Claim this run atomically so two overlapping ticks cannot both create the tickets.
        claimed = db.query(models.RecurringRule).filter(
            models.RecurringRule.id == rule.id, models.RecurringRule.next_run_at == old_next
        ).update({"next_run_at": new_next, "last_run_at": now}, synchronize_session=False)
        db.commit()
        if not claimed:
            continue
        db.refresh(rule)
        template = db.query(models.TicketTemplate).filter(models.TicketTemplate.id == rule.template_id).first()
        requester = db.query(models.User).filter(models.User.id == rule.requester_id, models.User.is_active == True).first()
        if not template or not template.is_active or not requester:
            logger.warning("Recurring rule %s skipped: template or requester unavailable", rule.id)
            continue
        assignee = db.query(models.User).filter(models.User.id == rule.assignee_id, models.User.is_active == True).first() if rule.assignee_id else None
        tickets = instantiate_template(db, template, requester, assignee, None, now, source="recurring rule")
        db.commit()
        for t in tickets:
            events.emit(db, "ticket_created", t, requester)
        total += len(tickets)
    return total


# ── Schemas ──────────────────────────────────────────────────────────────────

class TemplateItem(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    brief: str = Field(min_length=1, max_length=5000)
    design_type_id: int
    priority: models.TicketPriority = models.TicketPriority.NORMAL
    tags: List[str] = Field(default_factory=list, max_length=10)
    type_specific_fields: Dict[str, Any] = Field(default_factory=dict)
    estimate_hours: Optional[float] = Field(default=None, ge=0, le=200)


class TemplateBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: Optional[str] = Field(default=None, max_length=500)
    items: List[TemplateItem] = Field(min_length=1, max_length=30)


def _template_out(t: models.TicketTemplate) -> dict:
    return {"id": t.id, "name": t.name, "description": t.description, "items": t.items,
            "is_active": t.is_active, "created_at": as_utc(t.created_at).isoformat() if t.created_at else None}


def _check_design_types(db: Session, items: List[TemplateItem]) -> None:
    ids = {i.design_type_id for i in items}
    found = {d.id for d in db.query(models.DesignType).filter(models.DesignType.id.in_(ids), models.DesignType.is_active == True).all()}
    if ids - found:
        raise HTTPException(status_code=422, detail=f"Unknown design type id(s): {sorted(ids - found)}")


@router.get("/api/templates")
def list_templates(db: Session = Depends(get_db), _user: models.User = Depends(require_staff)):
    return [_template_out(t) for t in db.query(models.TicketTemplate).filter(models.TicketTemplate.is_active == True)
            .order_by(models.TicketTemplate.name.asc()).all()]


@router.post("/api/templates", status_code=201)
def create_template(body: TemplateBody, db: Session = Depends(get_db), user: models.User = Depends(require_lead)):
    _check_design_types(db, body.items)
    t = models.TicketTemplate(name=body.name.strip(), description=body.description,
                              items=[i.model_dump(mode="json") for i in body.items], created_by_id=user.id)
    db.add(t)
    db.commit()
    db.refresh(t)
    return _template_out(t)


def _get_template(db: Session, template_id: int) -> models.TicketTemplate:
    t = db.query(models.TicketTemplate).filter(models.TicketTemplate.id == template_id, models.TicketTemplate.is_active == True).first()
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    return t


@router.put("/api/templates/{template_id}")
def update_template(template_id: int, body: TemplateBody, db: Session = Depends(get_db), _user: models.User = Depends(require_lead)):
    t = _get_template(db, template_id)
    _check_design_types(db, body.items)
    t.name, t.description, t.items = body.name.strip(), body.description, [i.model_dump(mode="json") for i in body.items]
    db.commit()
    return _template_out(t)


@router.delete("/api/templates/{template_id}", status_code=204)
def delete_template(template_id: int, db: Session = Depends(get_db), _user: models.User = Depends(require_lead)):
    t = _get_template(db, template_id)
    t.is_active = False
    db.query(models.RecurringRule).filter(models.RecurringRule.template_id == t.id).update({"is_active": False})
    db.commit()
    return Response(status_code=204)


class InstantiateBody(BaseModel):
    requester_id: Optional[int] = None  # Raise on behalf of a client user; defaults to the caller
    assignee_id: Optional[int] = None


def _resolve_people(db: Session, caller: models.User, requester_id: Optional[int], assignee_id: Optional[int]):
    requester = caller
    if requester_id and requester_id != caller.id:
        requester = db.query(models.User).filter(models.User.id == requester_id, models.User.is_active == True).first()
        if not requester:
            raise HTTPException(status_code=422, detail="Requester not found")
    assignee = None
    if assignee_id:
        assignee = db.query(models.User).filter(
            models.User.id == assignee_id, models.User.is_active == True, models.User.role != models.RoleEnum.REQUESTER).first()
        if not assignee:
            raise HTTPException(status_code=422, detail="Assignee must be an active staff member")
    return requester, assignee


@router.post("/api/templates/{template_id}/instantiate", status_code=201)
def instantiate(template_id: int, body: InstantiateBody = InstantiateBody(), db: Session = Depends(get_db),
                user: models.User = Depends(require_staff)):
    template = _get_template(db, template_id)
    if body.assignee_id and user.role == models.RoleEnum.DESIGNER:
        raise HTTPException(status_code=403, detail="Only a Design Lead can assign tickets")
    requester, assignee = _resolve_people(db, user, body.requester_id, body.assignee_id)
    tickets = instantiate_template(db, template, requester, assignee, user)
    if not tickets:
        raise HTTPException(status_code=422, detail="None of the template's design types are available any more")
    db.commit()
    for t in tickets:
        events.emit(db, "ticket_created", t, user)
    return {"created": [{"id": t.id, "ticket_number": t.ticket_number, "title": t.title} for t in tickets]}


# ── Recurring rules ──────────────────────────────────────────────────────────

class RuleBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    template_id: int
    frequency: Literal["weekly", "monthly"]
    day: int
    hour: int = Field(default=9, ge=0, le=23)
    requester_id: int
    assignee_id: Optional[int] = None
    is_active: bool = True

    @model_validator(mode="after")
    def _day_range(self):
        # Monthly capped at 28 so the rule fires every month, February included.
        lo, hi = (0, 6) if self.frequency == "weekly" else (1, 28)
        if not lo <= self.day <= hi:
            raise ValueError(f"day must be {lo}-{hi} for {self.frequency} rules")
        return self


def _rule_out(r: models.RecurringRule) -> dict:
    iso = lambda d: as_utc(d).isoformat() if d else None
    return {"id": r.id, "name": r.name, "template_id": r.template_id, "template_name": r.template.name if r.template else None,
            "frequency": r.frequency, "day": r.day, "hour": r.hour, "requester_id": r.requester_id,
            "assignee_id": r.assignee_id, "is_active": r.is_active, "next_run_at": iso(r.next_run_at), "last_run_at": iso(r.last_run_at)}


@router.get("/api/recurring")
def list_rules(db: Session = Depends(get_db), _user: models.User = Depends(require_staff)):
    return [_rule_out(r) for r in db.query(models.RecurringRule).order_by(models.RecurringRule.next_run_at.asc()).all()]


def _apply_rule(db: Session, rule: models.RecurringRule, body: RuleBody, caller: models.User):
    _get_template(db, body.template_id)
    _resolve_people(db, caller, body.requester_id, body.assignee_id)
    rule.name, rule.template_id, rule.frequency, rule.day, rule.hour = body.name.strip(), body.template_id, body.frequency, body.day, body.hour
    rule.requester_id, rule.assignee_id, rule.is_active = body.requester_id, body.assignee_id, body.is_active
    rule.next_run_at = compute_next_run(body.frequency, body.day, body.hour, datetime.datetime.now(pytz.utc))


@router.post("/api/recurring", status_code=201)
def create_rule(body: RuleBody, db: Session = Depends(get_db), user: models.User = Depends(require_lead)):
    rule = models.RecurringRule(next_run_at=datetime.datetime.now(pytz.utc))
    _apply_rule(db, rule, body, user)
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return _rule_out(rule)


@router.put("/api/recurring/{rule_id}")
def update_rule(rule_id: int, body: RuleBody, db: Session = Depends(get_db), user: models.User = Depends(require_lead)):
    rule = db.query(models.RecurringRule).filter(models.RecurringRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    _apply_rule(db, rule, body, user)
    db.commit()
    return _rule_out(rule)


@router.delete("/api/recurring/{rule_id}", status_code=204)
def delete_rule(rule_id: int, db: Session = Depends(get_db), _user: models.User = Depends(require_lead)):
    rule = db.query(models.RecurringRule).filter(models.RecurringRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    db.delete(rule)
    db.commit()
    return Response(status_code=204)


@router.post("/api/recurring/{rule_id}/run-now")
def run_rule_now(rule_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_lead)):
    """Raise the rule's tickets immediately without touching its schedule (handy for checking a template)."""
    rule = db.query(models.RecurringRule).filter(models.RecurringRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    template = _get_template(db, rule.template_id)
    requester, assignee = _resolve_people(db, user, rule.requester_id, rule.assignee_id)
    tickets = instantiate_template(db, template, requester, assignee, user, source="recurring rule (manual run)")
    db.commit()
    for t in tickets:
        events.emit(db, "ticket_created", t, user)
    return {"created": [{"id": t.id, "ticket_number": t.ticket_number} for t in tickets]}
