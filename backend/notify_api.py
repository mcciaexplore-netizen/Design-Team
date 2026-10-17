import os
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

import models
import delivery
import events
from auth import get_current_user, require_lead, require_staff
from common import as_utc, storage_name
from database import get_db

router = APIRouter(tags=["notifications"])


# ── Integration settings (leads) ─────────────────────────────────────────────

def _mask(url: str) -> str:
    return url[:32] + "…" + "•" * 6 if url else ""


def _public_settings(cfg: dict) -> dict:
    return {
        "slack_configured": bool(cfg["slack_webhook"]),
        "slack_webhook_masked": _mask(cfg["slack_webhook"]),
        "slack_channel": cfg["slack_channel"],
        "slack_events": cfg["slack_events"],
        # Email and file storage are set in the hosting environment (SMTP_*, GOOGLE_DRIVE_*), so only shown here.
        "email_configured": delivery.email_configured(),
        "email_from": (os.getenv("SMTP_FROM") or os.getenv("SMTP_USER") or None) if delivery.email_configured() else None,
        "email_host": os.getenv("SMTP_HOST") or None,
        "file_storage": storage_name(),
    }


class SlackEvents(BaseModel):
    breach: bool = True
    escalate: bool = True
    new: bool = True


class IntegrationSettingsUpdate(BaseModel):
    # Omit slack_webhook to keep the stored one; send "" to remove it.
    slack_webhook: Optional[str] = None
    slack_channel: Optional[str] = Field(default=None, max_length=80)
    slack_events: Optional[SlackEvents] = None

    @field_validator("slack_webhook")
    @classmethod
    def _webhook(cls, v):
        if v and not delivery.is_valid_slack_webhook(v):
            raise ValueError("Must be an https://hooks.slack.com/services/... URL")
        return v


@router.get("/api/settings/integrations")
def get_integration_settings(request: Request, db: Session = Depends(get_db), _user: models.User = Depends(require_lead)):
    import drive_connect_api
    return {**_public_settings(delivery.get_integrations(db)), **drive_connect_api.status(request)}


@router.put("/api/settings/integrations")
def update_integration_settings(body: IntegrationSettingsUpdate, db: Session = Depends(get_db),
                                _user: models.User = Depends(require_lead)):
    cfg = delivery.get_integrations(db)
    data = body.model_dump(exclude_unset=True)
    for key, value in data.items():
        if key == "slack_events" and value is not None:
            cfg["slack_events"] = value
        elif value is not None:
            cfg[key] = value
    delivery.set_setting(db, delivery.INTEGRATIONS_KEY, cfg)
    db.commit()
    return _public_settings(cfg)


class SlackTest(BaseModel):
    webhook_url: Optional[str] = None  # Test an unsaved URL from the form
    channel: Optional[str] = None


@router.post("/api/integrations/slack/test")
def test_slack(body: SlackTest = SlackTest(), db: Session = Depends(get_db), user: models.User = Depends(require_lead)):
    cfg = delivery.get_integrations(db)
    url = body.webhook_url or cfg["slack_webhook"]
    if not url:
        raise HTTPException(status_code=422, detail="Enter a Slack webhook URL first")
    if not delivery.is_valid_slack_webhook(url):
        raise HTTPException(status_code=422, detail="Webhook must be an https://hooks.slack.com/services/... URL")
    ok, detail = delivery.send_slack(
        url, f":white_check_mark: DesignDesk test message from {events.slack_escape(user.full_name)}.",
        body.channel if body.channel is not None else cfg["slack_channel"],
    )
    return {"ok": ok, "detail": detail}


@router.post("/api/integrations/email/test")
def test_email(user: models.User = Depends(require_lead)):
    """Send a test email to the signed-in Design Lead, to check the SMTP settings (e.g. Zoho Mail)."""
    if not delivery.email_configured():
        raise HTTPException(status_code=422, detail="Email is not set up: add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD and SMTP_FROM in Vercel.")
    ok, detail = delivery.send_email(user.email, "DesignDesk test email",
                                     f"Hi {user.full_name},\n\nThis is a test from DesignDesk. Email is working.\n\nMCCIA Applied AI Studio\n")
    return {"ok": ok, "detail": f"Sent to {user.email}. Check the inbox (and spam)." if ok else detail}


@router.post("/api/integrations/drive/test")
def test_drive(_lead: models.User = Depends(require_lead)):
    """Check that Google Drive really accepts uploads (signs in and looks at the folder; stores nothing)."""
    import gdrive
    ok, detail = gdrive.check()
    return {"ok": ok, "detail": detail}


# ── Per-user preferences ─────────────────────────────────────────────────────

class PreferencesUpdate(BaseModel):
    in_app_enabled: Optional[bool] = None
    email_enabled: Optional[bool] = None
    muted_events: Optional[List[str]] = None


def _prefs_payload(prefs: Optional[models.UserPreference], user: models.User) -> dict:
    return {
        "in_app_enabled": prefs.in_app_enabled if prefs else True,
        # The team is emailed about assignments, client changes and decisions, new requests and SLA alerts.
        "email_enabled": prefs.email_enabled if prefs else True,
        "email": user.email,
        "email_available": delivery.email_configured(),
        "muted_events": [e for e in (prefs.muted_events or []) if e in events.EVENT_LABELS] if prefs else [],
        "available_events": events.EVENT_LABELS,
    }


@router.get("/api/me/preferences")
def get_preferences(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    prefs = db.query(models.UserPreference).filter(models.UserPreference.user_id == user.id).first()
    return _prefs_payload(prefs, user)


@router.put("/api/me/preferences")
def update_preferences(body: PreferencesUpdate, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    prefs = db.query(models.UserPreference).filter(models.UserPreference.user_id == user.id).first()
    if not prefs:
        prefs = models.UserPreference(user_id=user.id, muted_events=[])
        db.add(prefs)
    data = body.model_dump(exclude_unset=True)
    if "muted_events" in data and data["muted_events"] is not None:
        unknown = set(data["muted_events"]) - set(events.EVENT_LABELS)
        if unknown:
            raise HTTPException(status_code=422, detail=f"Unknown events: {', '.join(sorted(unknown))}")
    for key, value in data.items():
        setattr(prefs, key, value)
    db.commit()
    db.refresh(prefs)
    return _prefs_payload(prefs, user)


# ── Activity feed ────────────────────────────────────────────────────────────
# What just happened across the studio (Design Lead dashboard) or on one designer's tickets (their dashboard), from
# each ticket's history. The pages poll it, so new requests and changes show up within seconds.

QUIET_ACTIONS = {"Logged time", "Deleted time entry"}


def _activity_text(action: str, details: dict) -> tuple[str, str]:
    """(kind, sentence) for one history entry. kind: new, status, client, design or other."""
    details = details or {}
    status = details.get("status")
    if action == "Created":
        return "new", "New request" + (" from the request form" if details.get("via") == "request form" else "")
    if action in ("Client approved",):
        return "client", "The client approved the design"
    if action in ("Client requested changes", "Changes requested"):
        reason = details.get("reason") or details.get("comment") or ""
        return "client", "The client asked for changes" + (f": {reason}" if reason else "")
    if action == "Client changes added":
        return "client", f"Changes from the client: {details.get('text', '')}"
    if action in ("Uploaded proof", "Sent for approval"):
        version = details.get("version") or details.get("proof_version")
        return "design", f"{action}{f' (version {version})' if version else ''}"
    if action in ("Updated", "Bulk update") and isinstance(status, dict) and status.get("to"):
        return "status", f"Moved to {status['to']}"
    if action in ("Updated", "Bulk update") and "assignee_id" in details:
        return "status", "Assigned to someone new"
    if action == "Auto-closed":
        return "status", f"Closed automatically ({details.get('reason', 'time ran out')})"
    return "other", action


@router.get("/api/activity")
def activity(mine: bool = False, limit: int = 40, db: Session = Depends(get_db), user: models.User = Depends(require_staff)):
    q = db.query(models.AuditLog, models.Ticket).join(models.Ticket, models.Ticket.id == models.AuditLog.ticket_id)         .filter(models.AuditLog.action.notin_(QUIET_ACTIONS))
    if mine:
        q = q.filter(models.Ticket.assignee_id == user.id)
    rows = q.order_by(models.AuditLog.timestamp.desc(), models.AuditLog.id.desc()).limit(max(1, min(limit, 100))).all()
    names = {u.id: u.full_name for u in db.query(models.User).filter(
        models.User.id.in_({log.changed_by_id for log, _ in rows if log.changed_by_id} or {0}))}
    out = []
    for log, ticket in rows:
        kind, text = _activity_text(log.action, log.details)
        out.append({"id": log.id, "at": as_utc(log.timestamp).isoformat() if log.timestamp else None, "kind": kind, "text": text,
                    "by": log.actor_label or names.get(log.changed_by_id) or "System",
                    "ticket_id": ticket.id, "ticket_number": ticket.ticket_number, "title": ticket.title})
    return out


# ── In-app notifications ─────────────────────────────────────────────────────

@router.get("/api/notifications")
def list_notifications(unread_only: bool = False, limit: int = 50, db: Session = Depends(get_db),
                       user: models.User = Depends(get_current_user)):
    q = db.query(models.Notification).filter(models.Notification.user_id == user.id)
    if unread_only:
        q = q.filter(models.Notification.is_read == False)
    rows = q.order_by(models.Notification.created_at.desc(), models.Notification.id.desc()).limit(min(max(limit, 1), 200)).all()
    unread = db.query(models.Notification).filter(
        models.Notification.user_id == user.id, models.Notification.is_read == False).count()
    return {
        "unread": unread,
        "items": [{"id": n.id, "content": n.content, "type": n.type, "ticket_id": n.ticket_id, "is_read": n.is_read,
                   "created_at": as_utc(n.created_at).isoformat() if n.created_at else None} for n in rows],
    }


@router.post("/api/notifications/read-all")
def mark_all_read(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    db.query(models.Notification).filter(
        models.Notification.user_id == user.id, models.Notification.is_read == False
    ).update({"is_read": True})
    db.commit()
    return {"ok": True}


@router.post("/api/notifications/{notification_id}/read")
def mark_read(notification_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    n = db.query(models.Notification).filter(
        models.Notification.id == notification_id, models.Notification.user_id == user.id).first()
    if not n:
        raise HTTPException(status_code=404, detail="Notification not found")
    n.is_read = True
    db.commit()
    return {"ok": True}
