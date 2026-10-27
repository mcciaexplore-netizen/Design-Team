"""Public ticket tracking: a signed link lets a requester follow their request without logging in."""
import datetime
import hashlib
import hmac
import logging
import os
import secrets
from typing import Optional

import jwt
import pytz
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

import models
import ratelimit
from auth import ALGORITHM, SECRET_KEY
from common import PUBLIC_EMAIL_DOMAINS, app_url, as_utc, match_existing_company_name, require_allowed_email
from database import get_db

logger = logging.getLogger(__name__)
router = APIRouter(tags=["tracking"])

# The steps a requester sees, in order. Anything else (e.g. Waiting on Requester) maps onto the nearest one.
STEPS = ["Received", "Assigned", "In progress", "In review", "Delivered"]
STATUS_STEP = {
    "New": 0, "Assigned": 1, "In Progress": 2, "Waiting on Requester": 2, "In Review": 3, "Delivered": 4,
    "Closed": 4, "Closed without approval": 4, "Revision Requested": 2,
}

# H2: Short-lived client link tokens (15-60 minutes, single-use via server-side tracking)
CLIENT_LINK_TTL_MINUTES = int(os.getenv("CLIENT_LINK_TTL_MINUTES", "30"))
CLIENT_LINK_TTL = datetime.timedelta(minutes=max(15, min(60, CLIENT_LINK_TTL_MINUTES)))


def _sign(ticket_number: str) -> str:
    return hmac.new(SECRET_KEY.encode(), f"track:{ticket_number}".encode(), hashlib.sha256).hexdigest()[:24]


def _hash_token(token: str) -> str:
    """Hash a raw token for server-side storage (SHA256 hex, 64 chars)."""
    return hashlib.sha256(token.encode()).hexdigest()


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


# ── A client's one-time sign-in link, instead of a password ──────────────────
# The link is emailed and carries a raw single-use token. Redeeming it via exchange_client_link()
# marks it used and issues a normal 12-hour session. Read-only access via /my-requests doesn't use it up.

LINK_SENT = "If we can match that email (plus a company name, for a first link), one is on its way."


def client_link_url(user: models.User, db: Session) -> str:
    """Generate a new single-use client link token. Invalidates older unused tokens for this user."""
    token = secrets.token_urlsafe(32)
    token_hash = _hash_token(token)
    now = datetime.datetime.now(pytz.utc)
    expires_at = now + CLIENT_LINK_TTL

    # Mark older unused tokens as used so only the newest one works
    db.query(models.ClientLinkToken).filter(
        models.ClientLinkToken.user_id == user.id,
        models.ClientLinkToken.purpose == "client",
        models.ClientLinkToken.used_at.is_(None),
    ).update({"used_at": now}, synchronize_session=False)

    # Store the new token hash
    db.add(models.ClientLinkToken(
        user_id=user.id,
        token_hash=token_hash,
        purpose="client",
        expires_at=expires_at,
    ))
    db.commit()
    return f"{app_url()}/client/{token}"


def redeem_client_link(token: str, db: Session) -> models.User:
    """Redeem a single-use client link token for a session. Token is marked used atomically."""
    invalid = HTTPException(status_code=404, detail="This link is not valid or has expired. Ask for a new one.")

    token_hash = _hash_token(token)
    now = datetime.datetime.now(pytz.utc)

    # Atomic update: mark as used only if it exists, is unused, and not expired
    claimed = db.query(models.ClientLinkToken).filter(
        models.ClientLinkToken.token_hash == token_hash,
        models.ClientLinkToken.purpose == "client",
        models.ClientLinkToken.used_at.is_(None),
        models.ClientLinkToken.expires_at > now,
    ).update({"used_at": now}, synchronize_session=False)

    if not claimed:
        db.commit()
        raise invalid

    # Load the user and verify active
    token_row = db.query(models.ClientLinkToken).filter(
        models.ClientLinkToken.token_hash == token_hash,
    ).first()

    user = db.query(models.User).filter(models.User.id == token_row.user_id).first()
    if not user or not user.is_active:
        raise invalid

    db.commit()
    return user


def client_user_for_token(token: str, db: Session) -> models.User:
    """Shared identity check for read-only passwordless access (e.g., /my-requests).
    Does NOT mark the token as used, so the link stays valid for the user."""
    invalid = HTTPException(status_code=404, detail="This link is not valid or has expired. Ask for a new one.")

    token_hash = _hash_token(token)
    now = datetime.datetime.now(pytz.utc)

    # Check token is valid (unused, not expired)
    token_row = db.query(models.ClientLinkToken).filter(
        models.ClientLinkToken.token_hash == token_hash,
        models.ClientLinkToken.purpose == "client",
        models.ClientLinkToken.used_at.is_(None),
        models.ClientLinkToken.expires_at > now,
    ).first()

    if not token_row:
        raise invalid

    user = db.query(models.User).filter(models.User.id == token_row.user_id).first()
    if not user or not user.is_active:
        raise invalid

    return user


class ClientLinkRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    # Only needed the first time: it creates or joins a company so Campaigns has somewhere to scope to.
    company: Optional[str] = Field(default=None, min_length=2, max_length=80)


def _company_domain_matches(db: Session, company: str, email: str) -> bool:
    """Whether anyone already on `company` shares this email's domain: the only evidence, short of a staff
    invite, that a new signup actually belongs there rather than just knowing (or guessing) the name."""
    domain = email.rsplit("@", 1)[-1].lower()
    if not domain or domain in PUBLIC_EMAIL_DOMAINS:
        return False
    members = {e for (e,) in db.query(models.User.email).filter(func.lower(models.User.client_org) == company.lower())}
    members |= {e for (e,) in db.query(models.User.email).join(models.Ticket, models.Ticket.requester_id == models.User.id)
                .filter(func.lower(models.Ticket.client_org) == company.lower())}
    return any(m.rsplit("@", 1)[-1] == domain for m in members)


@router.post("/api/public/client-link")
def email_client_link(body: ClientLinkRequest, request: Request, db: Session = Depends(get_db)):
    """Email one link to a client's requests and campaigns. The answer never says whether the email is
    known, so it can't be used to probe for one."""
    import auth
    import delivery
    import ratelimit
    if not delivery.email_configured():
        raise HTTPException(status_code=503, detail="Sending links by email is not set up yet. Use the tracking link from your confirmation, or contact the design team.")
    email = body.email.strip().lower()
    require_allowed_email(email)
    ratelimit.check(db, f"client-link-ip:{ratelimit.client_ip(request)}", 10, 3600)
    ratelimit.check(db, f"client-link-email:{email}", 3, 3600)
    company = " ".join(body.company.split()) if body.company else None
    user = db.query(models.User).filter(models.User.email == email).first()
    if user and user.role != models.RoleEnum.REQUESTER:
        return {"detail": LINK_SENT}   # a staff email: say nothing, same as an unknown one
    if company:
        existing = match_existing_company_name(db, company)
        # An existing company only gets joined by an email on the same domain as someone already there; a
        # name match alone (company names are public, on the requests board) must never grant its tickets.
        company = existing if existing and _company_domain_matches(db, existing, email) else (None if existing else company)
    if not user and company:
        user = models.User(email=email, full_name=email.split("@")[0], role=models.RoleEnum.REQUESTER,
                           client_org=company, hashed_password=auth.hash_password(auth.generate_temp_password()))
        db.add(user)
        db.commit()
        db.refresh(user)
    elif user and company and not user.client_org:
        user.client_org = company
        db.commit()
    if user and user.is_active:
        link = client_link_url(user, db)
        delivery.run_in_background(delivery.send_email, user.email, "Your DesignDesk sign-in link", (
            f"Hi {user.full_name},\n\nOpen this link to see your design requests and campaigns (no password needed):\n\n{link}\n\n"
            f"The link works once, for {CLIENT_LINK_TTL_MINUTES} minutes. Don't forward it: anyone with it can sign in as you.\n"
            f"Need another? Go to {app_url()}/my-requests to request one.\n"))
    return {"detail": LINK_SENT}


class ClientLinkExchange(BaseModel):
    token: str = Field(min_length=1, max_length=200)


@router.post("/api/public/client-link/exchange")
def exchange_client_link(body: ClientLinkExchange, request: Request, db: Session = Depends(get_db)):
    """Redeem an emailed client-link token into a normal session, the one time the link is opened.
    The token travels in the body, not the query string, so it stays out of access logs."""
    import auth
    ratelimit.check(db, f"client-exchange-ip:{ratelimit.client_ip(request)}", limit=30, window_seconds=3600)
    user = redeem_client_link(body.token, db)
    return {"access_token": auth.create_access_token(user), "token_type": "bearer", "user": auth.user_payload(user)}


# ── Public board: every request, grouped by organisation ─────────────────────
# Anyone can open it, so it carries only what a tracking link already shows: no brief, names, emails or files.
# PUBLIC_BOARD=off turns it off.

BOARD_FINISHED_DAYS = 90   # finished requests stay on the board this long
FINISHED = (models.TicketStatus.DELIVERED, models.TicketStatus.CLOSED, models.TicketStatus.CLOSED_WITHOUT_APPROVAL)
# Anyone can type anyone's email (and any title) on the public form, so a request reaches the board, under
# its requester's organisation, only once a Design Lead has accepted it.
NOT_ON_BOARD = (models.TicketStatus.PENDING_REVIEW, models.TicketStatus.DECLINED)


@router.get("/api/public/requests-board")
def requests_board(db: Session = Depends(get_db)):
    if os.getenv("PUBLIC_BOARD", "on").strip().lower() in ("off", "false", "0", "no"):
        raise HTTPException(status_code=404, detail="The public requests board is turned off.")
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=BOARD_FINISHED_DAYS)
    tickets = db.query(models.Ticket).options(joinedload(models.Ticket.requester), joinedload(models.Ticket.design_type)) \
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
            # A public-form ticket has no organisation of its own; use the one the team set on the account.
            "organisation": t.client_org or (t.requester.client_org if t.requester else None),
            "design_type": t.design_type.name if t.design_type else None,
            "status": t.status.value,
            "current_step": STATUS_STEP.get(t.status.value, 0),
            "finished": t.status in FINISHED,
            "due_at": as_utc(t.due_at).isoformat() if t.due_at else None,
            "delivered_at": as_utc(t.delivered_at).isoformat() if t.delivered_at else None,
            "created_at": as_utc(t.created_at).isoformat() if t.created_at else None,
        } for t in tickets],
    }


@router.get("/api/public/my-requests")
def my_requests(token: str, db: Session = Depends(get_db)):
    user = client_user_for_token(token, db)
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
