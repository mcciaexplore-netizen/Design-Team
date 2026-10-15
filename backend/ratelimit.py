"""Database-backed rate limiting, so limits survive restarts and are shared by every server instance."""
import datetime
import os

import pytz
from fastapi import HTTPException, Request
from sqlalchemy.orm import Session

import models


def client_ip(request: Request) -> str:
    """The caller's address. Vercel puts it in x-real-ip (which a caller can't set); behind other proxies the first
    X-Forwarded-For hop is the real client."""
    if os.getenv("VERCEL") and request.headers.get("x-real-ip"):
        return request.headers["x-real-ip"].strip()
    forwarded = request.headers.get("x-forwarded-for", "")
    return forwarded.split(",")[0].strip() or (request.client.host if request.client else "unknown")


def check(db: Session, key: str, limit: int, window_seconds: int, message: str = "Too many requests. Please try again later.") -> None:
    """Record one hit for `key`; raise 429 if it already has `limit` hits inside the window."""
    now = datetime.datetime.now(pytz.utc)
    cutoff = now - datetime.timedelta(seconds=window_seconds)
    # Tidy old hits. Limits use different windows, so only remove what is older than any of them could need.
    stale = now - datetime.timedelta(seconds=max(window_seconds, 86400))
    db.query(models.RateLimitHit).filter(models.RateLimitHit.created_at < stale).delete(synchronize_session=False)
    recent = db.query(models.RateLimitHit).filter(
        models.RateLimitHit.key == key, models.RateLimitHit.created_at >= cutoff).count()
    if recent >= limit:
        db.commit()
        raise HTTPException(status_code=429, detail=message)
    db.add(models.RateLimitHit(key=key, created_at=now))
    db.commit()
