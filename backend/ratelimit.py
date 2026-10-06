"""Database-backed rate limiting, so limits survive restarts and are shared by every server instance."""
import datetime

import pytz
from fastapi import HTTPException, Request
from sqlalchemy.orm import Session

import models


def client_ip(request: Request) -> str:
    """The caller's address. Behind a proxy the first X-Forwarded-For hop is the real client."""
    forwarded = request.headers.get("x-forwarded-for", "")
    return forwarded.split(",")[0].strip() or (request.client.host if request.client else "unknown")


def check(db: Session, key: str, limit: int, window_seconds: int, message: str = "Too many requests. Please try again later.") -> None:
    """Record one hit for `key`; raise 429 if it already has `limit` hits inside the window."""
    now = datetime.datetime.now(pytz.utc)
    cutoff = now - datetime.timedelta(seconds=window_seconds)
    db.query(models.RateLimitHit).filter(models.RateLimitHit.created_at < cutoff).delete(synchronize_session=False)
    recent = db.query(models.RateLimitHit).filter(
        models.RateLimitHit.key == key, models.RateLimitHit.created_at >= cutoff).count()
    if recent >= limit:
        db.commit()
        raise HTTPException(status_code=429, detail=message)
    db.add(models.RateLimitHit(key=key, created_at=now))
    db.commit()
