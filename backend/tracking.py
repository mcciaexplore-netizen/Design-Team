"""Public ticket tracking: a signed link lets a requester follow their request without logging in."""
import datetime
import hashlib
import hmac
import os

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

import models
from auth import SECRET_KEY
from common import as_utc, user_app_url
from database import get_db

router = APIRouter(tags=["tracking"])

# The steps a requester sees, in order. Anything else (e.g. Waiting on Requester) maps onto the nearest one.
STEPS = ["Received", "Assigned", "In progress", "In review", "Delivered"]
STATUS_STEP = {
    "New": 0, "Assigned": 1, "In Progress": 2, "Waiting on Requester": 2, "In Review": 3, "Delivered": 4,
    "Closed": 4, "Closed without approval": 4, "Revision Requested": 2,
}

def _sign(ticket_number: str) -> str:
    return hmac.new(SECRET_KEY.encode(), f"track:{ticket_number}".encode(), hashlib.sha256).hexdigest()[:24]


def tracking_token(ticket_number: str) -> str:
    return f"{ticket_number}.{_sign(ticket_number)}"


def tracking_url(ticket_number: str) -> str:
    return f"{user_app_url()}/track/{tracking_token(ticket_number)}"


def _ticket_for(token: str, db: Session) -> models.Ticket:
    number, _, sig = token.rpartition(".")
    if not number or not hmac.compare_digest(sig, _sign(number)):
        raise HTTPException(status_code=404, detail="This tracking link is not valid.")
    ticket = db.query(models.Ticket).filter(models.Ticket.ticket_number == number).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="This tracking link is not valid.")
    return ticket


@router.get("/api/public/track/{token}")
def track(token: str, db: Session = Depends(get_db)):
    t = _ticket_for(token, db)
    history = [{"at": as_utc(t.created_at).isoformat() if t.created_at else None, "text": "Request received"}]
    logs = db.query(models.AuditLog).filter(models.AuditLog.ticket_id == t.id).order_by(models.AuditLog.timestamp, models.AuditLog.id).all()
    for log in logs:
        details = log.details or {}
        status = details.get("status")
        if log.action == "Updated" and isinstance(status, dict) and status.get("to"):
            history.append({"at": as_utc(log.timestamp).isoformat() if log.timestamp else None, "text": f"Status changed to {status['to']}"})
        elif log.action in ("Client approved", "Client requested changes", "Superseded"):
            history.append({"at": as_utc(log.timestamp).isoformat() if log.timestamp else None,
                            "text": {"Client approved": "Design approved", "Client requested changes": "Changes requested",
                                     "Superseded": "A new version was opened"}[log.action]})
    return {
        "ticket_number": t.ticket_number,
        "title": t.title,
        "status": t.status.value,
        "steps": STEPS,
        "current_step": STATUS_STEP.get(t.status.value, 0),
        "design_type": t.design_type.name if t.design_type else None,
        "due_at": as_utc(t.due_at).isoformat() if t.due_at else None,
        "created_at": as_utc(t.created_at).isoformat() if t.created_at else None,
        "history": history,
    }


# ── Public board: every request and where it stands ──────────────────────────
# Anyone can open it, so it carries only what a tracking link already shows: no brief, names, emails or files.
# PUBLIC_BOARD=off turns it off.

BOARD_FINISHED_DAYS = 90   # finished requests stay on the board this long
FINISHED = (models.TicketStatus.DELIVERED, models.TicketStatus.CLOSED, models.TicketStatus.CLOSED_WITHOUT_APPROVAL)
# Anyone can type anyone's email (and any title) on the public form, so a request reaches the board, under
# the board, only once a Design Lead has accepted it.
NOT_ON_BOARD = (models.TicketStatus.PENDING_REVIEW, models.TicketStatus.DECLINED)


@router.get("/api/public/requests-board")
def requests_board(db: Session = Depends(get_db)):
    if os.getenv("PUBLIC_BOARD", "on").strip().lower() in ("off", "false", "0", "no"):
        raise HTTPException(status_code=404, detail="The public requests board is turned off.")
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=BOARD_FINISHED_DAYS)
    tickets = db.query(models.Ticket).options(joinedload(models.Ticket.design_type)) \
        .filter(models.Ticket.status.notin_(NOT_ON_BOARD)) \
        .filter(or_(models.Ticket.status.notin_(FINISHED),
                    func.coalesce(models.Ticket.delivered_at, models.Ticket.updated_at) >= cutoff)) \
        .order_by(models.Ticket.created_at.desc(), models.Ticket.id.desc()).limit(500).all()
    return {
        "steps": STEPS,
        "finished_days": BOARD_FINISHED_DAYS,
        "requests": [{
            "ticket_number": t.ticket_number,
            "title": t.title,
            "design_type": t.design_type.name if t.design_type else None,
            "status": t.status.value,
            "current_step": STATUS_STEP.get(t.status.value, 0),
            "finished": t.status in FINISHED,
            "due_at": as_utc(t.due_at).isoformat() if t.due_at else None,
            "delivered_at": as_utc(t.delivered_at).isoformat() if t.delivered_at else None,
            "created_at": as_utc(t.created_at).isoformat() if t.created_at else None,
        } for t in tickets],
    }
