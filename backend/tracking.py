"""Public ticket tracking: a signed link lets a requester follow their request without logging in."""
import hashlib
import hmac
import os

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
from auth import SECRET_KEY
from common import as_utc
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
    return f"{os.getenv('PUBLIC_APP_URL', 'http://localhost:5173').rstrip('/')}/track/{tracking_token(ticket_number)}"


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
