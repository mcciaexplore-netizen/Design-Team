"""Database-backed rate limiting, so limits survive restarts and are shared by every server instance."""
import datetime
import logging
import os

import pytz
from fastapi import HTTPException, Request
from sqlalchemy.orm import Session

import models

logger = logging.getLogger(__name__)


def client_ip(request: Request) -> str:
    """The caller's address. Vercel puts it in x-real-ip (which a caller can't set); behind other proxies use
    X-Forwarded-For only when it comes from a trusted proxy (TRUSTED_PROXY_COUNT hops away).

    IMPORTANT: On non-Vercel deployments, set TRUSTED_PROXY_COUNT to the number of proxies between
    the internet and your app (1 for single reverse proxy, 2 for CDN → reverse proxy). Without it,
    all users behind the proxy share one IP for rate-limiting, causing shared IP limits to block everyone
    after one user exceeds them."""
    if os.getenv("VERCEL") and request.headers.get("x-real-ip"):
        return request.headers["x-real-ip"].strip()

    try:
        trusted_proxy_count = int(os.getenv("TRUSTED_PROXY_COUNT", "0"))
    except ValueError:
        logger.error("TRUSTED_PROXY_COUNT is not a valid integer; treating as 0 (X-Forwarded-For disabled)")
        trusted_proxy_count = 0

    if trusted_proxy_count > 0:
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            hops = [h.strip() for h in forwarded.split(",")]
            if len(hops) >= trusted_proxy_count:
                return hops[-trusted_proxy_count]

    return request.client.host if request.client else "unknown"


def is_limited(db: Session, key: str, limit: int, window_seconds: int) -> bool:
    """Check if `key` already has `limit` hits inside the window. Doesn't record a hit."""
    now = datetime.datetime.now(pytz.utc)
    cutoff = now - datetime.timedelta(seconds=window_seconds)
    recent = db.query(models.RateLimitHit).filter(
        models.RateLimitHit.key == key, models.RateLimitHit.created_at >= cutoff).count()
    return recent >= limit


def record(db: Session, key: str) -> None:
    """Record one hit for `key`. Call is_limited() first if you want to check before recording."""
    now = datetime.datetime.now(pytz.utc)
    # Tidy old hits; keeps table size bounded. Max window is 24 hours (tracked separately in email/form limits).
    MAX_HIT_AGE_SECONDS = 86400
    stale = now - datetime.timedelta(seconds=MAX_HIT_AGE_SECONDS)
    db.query(models.RateLimitHit).filter(models.RateLimitHit.created_at < stale).delete(synchronize_session=False)
    db.add(models.RateLimitHit(key=key, created_at=now))
    db.commit()


def check(db: Session, key: str, limit: int, window_seconds: int, message: str = "Too many requests. Please try again later.") -> None:
    """Record one hit for `key`; raise 429 if it already has `limit` hits inside the window."""
    if is_limited(db, key, limit, window_seconds):
        raise HTTPException(status_code=429, detail=message)
    record(db, key)
