from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

import models
import delivery
import events
from auth import get_current_user, require_lead
from common import as_utc
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
def get_integration_settings(db: Session = Depends(get_db), _user: models.User = Depends(require_lead)):
    return _public_settings(delivery.get_integrations(db))


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


# ── Per-user preferences ─────────────────────────────────────────────────────

class PreferencesUpdate(BaseModel):
    in_app_enabled: Optional[bool] = None
    muted_events: Optional[List[str]] = None


def _prefs_payload(prefs: Optional[models.UserPreference]) -> dict:
    return {
        "in_app_enabled": prefs.in_app_enabled if prefs else True,
        "muted_events": (prefs.muted_events or []) if prefs else [],
        "available_events": events.EVENT_LABELS,
    }


@router.get("/api/me/preferences")
def get_preferences(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    prefs = db.query(models.UserPreference).filter(models.UserPreference.user_id == user.id).first()
    return _prefs_payload(prefs)


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
    return _prefs_payload(prefs)


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
        "items": [{"id": n.id, "content": n.content, "type": n.type, "is_read": n.is_read,
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
