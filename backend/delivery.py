"""Outbound delivery: Slack (incoming webhook). Never raises; returns (ok, detail)."""
import logging
import os
import threading
from typing import Callable, Optional
from urllib.parse import urlparse

import httpx
from sqlalchemy.orm import Session

import models

logger = logging.getLogger(__name__)

INTEGRATIONS_KEY = "integrations"

DEFAULT_INTEGRATIONS = {
    "slack_webhook": "",
    "slack_channel": "",
    "slack_events": {"breach": True, "escalate": True, "new": True},
}


# ── Settings storage ─────────────────────────────────────────────────────────

def get_setting(db: Session, key: str, default=None):
    row = db.query(models.AppSetting).filter(models.AppSetting.key == key).first()
    return row.value if row and row.value is not None else default


def set_setting(db: Session, key: str, value) -> None:
    row = db.query(models.AppSetting).filter(models.AppSetting.key == key).first()
    if row:
        row.value = value
    else:
        db.add(models.AppSetting(key=key, value=value))


def get_integrations(db: Session) -> dict:
    stored = get_setting(db, INTEGRATIONS_KEY, {}) or {}
    merged = {**DEFAULT_INTEGRATIONS, **stored}
    merged["slack_events"] = {**DEFAULT_INTEGRATIONS["slack_events"], **(stored.get("slack_events") or {})}
    return merged


# ── Slack ────────────────────────────────────────────────────────────────────

def is_valid_slack_webhook(url: str) -> bool:
    """Only Slack's own webhook host over https, so a stored URL can't be used to probe internal services."""
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    return parsed.scheme == "https" and parsed.hostname == "hooks.slack.com" and parsed.path.startswith("/services/")


def send_slack(webhook_url: str, text: str, channel: str = "") -> tuple[bool, str]:
    if not webhook_url:
        return False, "Slack webhook is not configured"
    if not is_valid_slack_webhook(webhook_url):
        return False, "Webhook must be an https://hooks.slack.com/services/... URL"
    payload = {"text": text}
    if channel:
        payload["channel"] = channel
    try:
        res = httpx.post(webhook_url, json=payload, timeout=6.0, follow_redirects=False)
    except httpx.HTTPError as exc:
        logger.warning("Slack delivery failed: %s", exc)
        return False, f"Could not reach Slack: {exc.__class__.__name__}"
    if res.status_code == 200:
        return True, "Delivered to Slack"
    return False, f"Slack rejected the message (HTTP {res.status_code}: {res.text[:80]})"


# ── Fire-and-forget ──────────────────────────────────────────────────────────

def run_in_background(fn: Callable, *args) -> None:
    """Network sends must not slow down or break the request that triggered them."""
    def runner():
        try:
            fn(*args)
        except Exception:
            logger.exception("Background delivery failed")
    threading.Thread(target=runner, daemon=True).start()
