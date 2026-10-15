"""Public ticket tracking: a signed link lets a requester follow their request without logging in."""
import datetime
import hashlib
import hmac

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

import models
from auth import ALGORITHM, SECRET_KEY
from common import app_url, as_utc
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
    return f"{app_url()}/track/{tracking_token(ticket_number)}"


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


# ── All of a requester's requests, without signing in ────────────────────────
# The link is emailed, so only the inbox owner can open it. It is a signed token with its own purpose, which the
# sign-in code refuses as a session.

MY_REQUESTS_TTL = datetime.timedelta(days=30)
LINK_SENT = "If that email has sent us requests, a link to see them all is on its way."


def my_requests_url(user: models.User) -> str:
    now = datetime.datetime.now(datetime.timezone.utc)
    token = jwt.encode({"sub": str(user.id), "purpose": "my-requests", "iat": now, "exp": now + MY_REQUESTS_TTL},
                       SECRET_KEY, algorithm=ALGORITHM)
    return f"{app_url()}/my-requests?token={token}"


class MyRequestsLink(BaseModel):
    email: str = Field(min_length=3, max_length=254)


@router.post("/api/public/my-requests/link")
def email_my_requests_link(body: MyRequestsLink, request: Request, db: Session = Depends(get_db)):
    """Email a link to the list of this person's requests. The answer never says whether the email is known."""
    import delivery
    import ratelimit
    if not delivery.email_configured():
        raise HTTPException(status_code=503, detail="Sending links by email is not set up yet. Use the tracking link from your confirmation, or contact the design team.")
    email = body.email.strip().lower()
    ratelimit.check(db, f"my-requests-ip:{ratelimit.client_ip(request)}", 10, 3600)
    ratelimit.check(db, f"my-requests-email:{email}", 3, 3600)
    user = db.query(models.User).filter(models.User.email == email).first()
    if user and user.is_active and db.query(models.Ticket.id).filter(models.Ticket.requester_id == user.id).first():
        delivery.run_in_background(delivery.send_email, user.email, "Your MCCIA design requests", (
            f"Hi {user.full_name},\n\nSee all your design requests and where each one stands:\n\n{my_requests_url(user)}\n\n"
            "The link works for 30 days. Don't forward it: anyone with it can see your requests.\n\nMCCIA Applied AI Studio\n"))
    return {"detail": LINK_SENT}


@router.get("/api/public/my-requests")
def my_requests(token: str, db: Session = Depends(get_db)):
    invalid = HTTPException(status_code=404, detail="This link is not valid or has expired. Ask for a new one.")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise invalid
    if payload.get("purpose") != "my-requests":
        raise invalid
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user or not user.is_active:
        raise invalid
    tickets = db.query(models.Ticket).filter(models.Ticket.requester_id == user.id) \
        .order_by(models.Ticket.created_at.desc(), models.Ticket.id.desc()).limit(200).all()
    return {
        "name": user.full_name.split(" ")[0],
        "steps": STEPS,
        "requests": [{
            "ticket_number": t.ticket_number,
            "title": t.title,
            "design_type": t.design_type.name if t.design_type else None,
            "status": t.status.value,
            "current_step": STATUS_STEP.get(t.status.value, 0),
            "awaiting_review": t.status == models.TicketStatus.IN_REVIEW,
            "due_at": as_utc(t.due_at).isoformat() if t.due_at else None,
            "created_at": as_utc(t.created_at).isoformat() if t.created_at else None,
            "tracking_url": tracking_url(t.ticket_number),
        } for t in tickets],
    }
