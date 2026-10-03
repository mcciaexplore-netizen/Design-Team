"""Time entries (timers + manual logging), timesheet export, and the workload/capacity calculation."""
import csv
import datetime
import io
from typing import Dict, List, Optional

import pytz
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

import models
from auth import LEAD_ROLES, require_lead, require_staff
from common import as_utc, csv_safe, log_audit
from database import get_db

router = APIRouter(tags=["time"])
IST = pytz.timezone("Asia/Kolkata")
PLANNED_STATUSES = [models.TicketStatus.NEW, models.TicketStatus.ASSIGNED, models.TicketStatus.IN_PROGRESS]


def _now() -> datetime.datetime:
    return datetime.datetime.now(pytz.utc)


def _ticket(db: Session, ticket_id: int) -> models.Ticket:
    t = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return t


def _entry_out(e: models.TimeEntry, name: Optional[str]) -> dict:
    return {"id": e.id, "ticket_id": e.ticket_id, "user_id": e.user_id, "user_name": name,
            "started_at": as_utc(e.started_at).isoformat(), "ended_at": as_utc(e.ended_at).isoformat() if e.ended_at else None,
            "seconds": e.seconds, "note": e.note, "source": e.source}


# ── Timers ───────────────────────────────────────────────────────────────────

def _close_entry(db: Session, entry: models.TimeEntry, now: datetime.datetime) -> int:
    seconds = max(0, int((now - as_utc(entry.started_at)).total_seconds()))
    entry.ended_at, entry.seconds = now, seconds
    ticket = db.query(models.Ticket).filter(models.Ticket.id == entry.ticket_id).first()
    if ticket:
        ticket.time_spent_seconds += seconds
        ticket.timer_started_at = None
    return seconds


@router.post("/api/tickets/{ticket_id}/timer/start")
def start_timer(ticket_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_staff)):
    ticket = _ticket(db, ticket_id)
    if ticket.timer_started_at is not None:
        raise HTTPException(status_code=400, detail="Timer is already running")
    now = _now()
    # One running timer per person: starting here stops their timer elsewhere.
    stopped = None
    other = db.query(models.TimeEntry).filter(models.TimeEntry.user_id == user.id, models.TimeEntry.ended_at == None).first()
    if other:
        _close_entry(db, other, now)
        stopped = other.ticket_id
    db.add(models.TimeEntry(ticket_id=ticket.id, user_id=user.id, started_at=now, source="timer"))
    ticket.timer_started_at = now
    db.commit()
    return {"message": "Timer started", "timer_started_at": ticket.timer_started_at, "stopped_ticket_id": stopped}


@router.post("/api/tickets/{ticket_id}/timer/stop")
def stop_timer(ticket_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_staff)):
    ticket = _ticket(db, ticket_id)
    entry = db.query(models.TimeEntry).filter(
        models.TimeEntry.ticket_id == ticket_id, models.TimeEntry.ended_at == None).first()
    if ticket.timer_started_at is None and not entry:
        raise HTTPException(status_code=400, detail="Timer is not running")
    if entry and entry.user_id != user.id and user.role not in LEAD_ROLES:
        raise HTTPException(status_code=403, detail="Only the person timing this ticket, or a Design Lead, can stop it")
    if entry:
        _close_entry(db, entry, _now())
    else:
        # Legacy timer with no entry (started before time entries existed): keep old behaviour.
        elapsed = int((_now() - as_utc(ticket.timer_started_at)).total_seconds())
        ticket.time_spent_seconds += max(0, elapsed)
        ticket.timer_started_at = None
    db.commit()
    return {"message": "Timer stopped", "time_spent_seconds": ticket.time_spent_seconds}


# ── Manual entries ───────────────────────────────────────────────────────────

class ManualEntry(BaseModel):
    seconds: int = Field(ge=60, le=16 * 3600)
    started_at: Optional[datetime.datetime] = None
    note: Optional[str] = Field(default=None, max_length=200)
    user_id: Optional[int] = None  # Leads can log time on behalf of someone


@router.post("/api/tickets/{ticket_id}/time", status_code=201)
def add_time(ticket_id: int, body: ManualEntry, db: Session = Depends(get_db), user: models.User = Depends(require_staff)):
    ticket = _ticket(db, ticket_id)
    owner = user
    if body.user_id and body.user_id != user.id:
        if user.role not in LEAD_ROLES:
            raise HTTPException(status_code=403, detail="Only a Design Lead can log time for someone else")
        owner = db.query(models.User).filter(models.User.id == body.user_id, models.User.is_active == True,
                                             models.User.role != models.RoleEnum.REQUESTER).first()
        if not owner:
            raise HTTPException(status_code=422, detail="User must be an active staff member")
    now = _now()
    started = as_utc(body.started_at) if body.started_at else now - datetime.timedelta(seconds=body.seconds)
    if started > now:
        raise HTTPException(status_code=422, detail="Time cannot be logged in the future")
    entry = models.TimeEntry(ticket_id=ticket.id, user_id=owner.id, started_at=started,
                             ended_at=started + datetime.timedelta(seconds=body.seconds),
                             seconds=body.seconds, note=body.note, source="manual")
    db.add(entry)
    ticket.time_spent_seconds += body.seconds
    db.flush()
    log_audit(db, ticket.id, user, "Logged time", {"seconds": body.seconds, "for": owner.full_name})
    db.commit()
    db.refresh(entry)
    return _entry_out(entry, owner.full_name)


@router.get("/api/tickets/{ticket_id}/time")
def list_time(ticket_id: int, db: Session = Depends(get_db), _user: models.User = Depends(require_staff)):
    _ticket(db, ticket_id)
    rows = db.query(models.TimeEntry, models.User.full_name).join(models.User, models.User.id == models.TimeEntry.user_id) \
        .filter(models.TimeEntry.ticket_id == ticket_id).order_by(models.TimeEntry.started_at.desc()).all()
    return [_entry_out(e, n) for e, n in rows]


@router.delete("/api/time/{entry_id}", status_code=204)
def delete_time(entry_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_staff)):
    entry = db.query(models.TimeEntry).filter(models.TimeEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    if entry.user_id != user.id and user.role not in LEAD_ROLES:
        raise HTTPException(status_code=403, detail="You can only delete your own time entries")
    if entry.ended_at is None:
        raise HTTPException(status_code=409, detail="Stop the timer before deleting this entry")
    ticket = _ticket(db, entry.ticket_id)
    ticket.time_spent_seconds = max(0, ticket.time_spent_seconds - entry.seconds)
    log_audit(db, ticket.id, user, "Deleted time entry", {"seconds": entry.seconds})
    db.delete(entry)
    db.commit()
    return Response(status_code=204)


# ── Timesheet export ─────────────────────────────────────────────────────────

@router.get("/api/timesheets/export")
def export_timesheets(
    date_from: Optional[datetime.date] = Query(default=None, alias="from"),
    date_to: Optional[datetime.date] = Query(default=None, alias="to"),
    db: Session = Depends(get_db), _user: models.User = Depends(require_lead),
):
    q = db.query(models.TimeEntry, models.Ticket, models.User).join(models.Ticket, models.Ticket.id == models.TimeEntry.ticket_id) \
        .join(models.User, models.User.id == models.TimeEntry.user_id).filter(models.TimeEntry.ended_at != None)
    if date_from:
        q = q.filter(models.TimeEntry.started_at >= IST.localize(datetime.datetime.combine(date_from, datetime.time.min)))
    if date_to:
        q = q.filter(models.TimeEntry.started_at < IST.localize(datetime.datetime.combine(date_to + datetime.timedelta(days=1), datetime.time.min)))
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["Date (IST)", "Ticket", "Title", "Client", "Person", "Hours", "Source", "Note"])
    for e, t, u in q.order_by(models.TimeEntry.started_at.asc()).all():
        w.writerow([as_utc(e.started_at).astimezone(IST).strftime("%Y-%m-%d"), t.ticket_number, csv_safe(t.title),
                    csv_safe(t.client_org or ""), csv_safe(u.full_name), round(e.seconds / 3600, 2), e.source, csv_safe(e.note or "")])
    return Response(content=out.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": "attachment; filename=timesheet_export.csv"})


# ── Workload / capacity ──────────────────────────────────────────────────────

def _working_days(db: Session, start: datetime.date, days: int) -> Dict[datetime.date, bool]:
    schedule = {s.day_of_week: s.is_working_day for s in db.query(models.WorkingSchedule).all()}
    holidays = {h.date.date() for h in db.query(models.Holiday).all()}
    out = {}
    for i in range(days):
        d = start + datetime.timedelta(days=i)
        out[d] = schedule.get(d.weekday(), d.weekday() < 5) and d not in holidays
    return out


def compute_workload(db: Session, days: int = 7, today: Optional[datetime.date] = None) -> dict:
    """Earliest-deadline-first feasibility: for each designer, would the effort due by day D fit in the capacity available by day D?"""
    days = max(1, min(days, 30))
    today = today or datetime.datetime.now(IST).date()
    window = _working_days(db, today, days)
    day_list = list(window)
    last_day = day_list[-1]
    people = db.query(models.User).filter(
        models.User.is_active == True,
        models.User.role.in_([models.RoleEnum.DESIGNER, models.RoleEnum.DESIGN_LEAD])).order_by(models.User.full_name).all()

    leaves = db.query(models.UserLeave).all()
    logged_rows = db.query(models.TimeEntry.ticket_id, models.TimeEntry.seconds).filter(models.TimeEntry.ended_at != None).all()
    logged_by_ticket: Dict[int, int] = {}
    for tid, secs in logged_rows:
        logged_by_ticket[tid] = logged_by_ticket.get(tid, 0) + secs

    open_tickets = db.query(models.Ticket).filter(models.Ticket.status.in_(PLANNED_STATUSES), models.Ticket.is_locked == False).all()

    def remaining_hours(t: models.Ticket) -> float:
        estimate = t.estimate_hours if t.estimate_hours is not None else (t.design_type.default_effort_hours if t.design_type else 4)
        logged = max(logged_by_ticket.get(t.id, 0), t.time_spent_seconds or 0) / 3600
        return max(0.0, float(estimate) - logged)

    def bucket(t: models.Ticket) -> datetime.date:
        due = as_utc(t.due_at)
        d = due.astimezone(IST).date() if due else last_day
        return min(max(d, today), last_day)  # Overdue work is due "now"; undated work lands at the end of the window

    designers, overloaded_count = [], 0
    for p in people:
        on_leave = set()
        for lv in leaves:
            if lv.user_id == p.id:
                d = lv.start_date.date()
                while d <= lv.end_date.date():
                    on_leave.add(d)
                    d += datetime.timedelta(days=1)
        cap_per_day = {d: (p.daily_capacity_hours if window[d] and d not in on_leave else 0) for d in day_list}
        planned_per_day = {d: 0.0 for d in day_list}
        mine = [t for t in open_tickets if t.assignee_id == p.id]
        for t in mine:
            planned_per_day[bucket(t)] += remaining_hours(t)

        cum_cap = cum_plan = 0.0
        overload_date = None
        for d in day_list:
            cum_cap += cap_per_day[d]
            cum_plan += planned_per_day[d]
            if overload_date is None and cum_plan > cum_cap + 1e-9:
                overload_date = d
        total_cap, total_plan = sum(cap_per_day.values()), sum(planned_per_day.values())
        pct = round(total_plan / total_cap * 100) if total_cap else (999 if total_plan else 0)
        if overload_date:
            overloaded_count += 1
        window_start = IST.localize(datetime.datetime.combine(today, datetime.time.min)).astimezone(pytz.utc)
        logged_week = sum(
            e.seconds for e in db.query(models.TimeEntry).filter(
                models.TimeEntry.user_id == p.id, models.TimeEntry.ended_at != None,
                models.TimeEntry.started_at >= window_start - datetime.timedelta(days=7), models.TimeEntry.started_at < window_start).all()
        ) / 3600
        designers.append({
            "designer_id": p.id, "designer_name": p.full_name, "daily_capacity_hours": p.daily_capacity_hours,
            "capacity_hours": round(total_cap, 1), "planned_hours": round(total_plan, 1), "open_tickets": len(mine),
            "logged_hours_prev_7_days": round(logged_week, 1),
            "utilization_pct": pct, "is_overloaded": overload_date is not None,
            "overload_date": overload_date.isoformat() if overload_date else None,
            "days": [{"date": d.isoformat(), "capacity": cap_per_day[d], "planned": round(planned_per_day[d], 1)} for d in day_list],
        })

    unassigned = [t for t in open_tickets if t.assignee_id is None]
    return {
        "window": {"start": today.isoformat(), "end": last_day.isoformat(), "days": days},
        "designers": designers,
        "overloaded_count": overloaded_count,
        "unassigned_hours": round(sum(remaining_hours(t) for t in unassigned), 1),
        "unassigned_tickets": len(unassigned),
    }


@router.get("/api/workload")
def workload(days: int = Query(default=7, ge=1, le=30), db: Session = Depends(get_db), _user: models.User = Depends(require_staff)):
    return compute_workload(db, days)
