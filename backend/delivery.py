"""Outbound delivery: Slack (incoming webhook) and email (SMTP). Never raises; returns (ok, detail)."""
import logging
import os
import smtplib
import threading
from email.message import EmailMessage
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


# ── Email ────────────────────────────────────────────────────────────────────

def email_configured() -> bool:
    return bool(os.getenv("SMTP_HOST"))


def send_email(to: str, subject: str, body: str) -> tuple[bool, str]:
    """Send a plain-text email through SMTP_HOST (SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM, SMTP_SSL)."""
    host = os.getenv("SMTP_HOST")
    if not host:
        return False, "Email is not configured"
    port = int(os.getenv("SMTP_PORT", "587"))
    user, password = os.getenv("SMTP_USER", ""), os.getenv("SMTP_PASSWORD", "")
    try:
        msg = EmailMessage()  # rejects newlines in headers, so user text can't inject extra headers
        msg["From"] = os.getenv("SMTP_FROM") or user
        msg["To"] = to
        msg["Subject"] = subject
        msg.set_content(body)
        if os.getenv("SMTP_SSL", "").lower() in ("1", "true", "yes"):
            server = smtplib.SMTP_SSL(host, port, timeout=10)
        else:
            server = smtplib.SMTP(host, port, timeout=10)
            server.starttls()
        with server:
            if user:
                server.login(user, password)
            server.send_message(msg)
        return True, "Sent"
    except (smtplib.SMTPException, OSError, ValueError) as exc:
        logger.warning("Email to %s failed: %s", to, exc.__class__.__name__)
        return False, f"Could not send email: {exc.__class__.__name__}"


# ── CAPTCHA (Cloudflare Turnstile) ───────────────────────────────────────────

TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


def turnstile_enabled() -> bool:
    return bool(os.getenv("TURNSTILE_SECRET_KEY"))


def verify_turnstile(token: str, remote_ip: str = "") -> bool:
    """True if Cloudflare confirms the token. Fails closed: any error counts as a failed check."""
    secret = os.getenv("TURNSTILE_SECRET_KEY", "")
    if not secret or not token:
        return False
    try:
        res = httpx.post(TURNSTILE_VERIFY_URL, data={"secret": secret, "response": token, "remoteip": remote_ip}, timeout=6.0)
        return res.status_code == 200 and bool(res.json().get("success"))
    except (httpx.HTTPError, ValueError):
        return False


# ── Fire-and-forget ──────────────────────────────────────────────────────────

def run_in_background(fn: Callable, *args) -> None:
    """Network sends must not slow down or break the request that triggered them."""
    def runner():
        try:
            fn(*args)
        except Exception:
            logger.exception("Background delivery failed")
    threading.Thread(target=runner, daemon=True).start()
