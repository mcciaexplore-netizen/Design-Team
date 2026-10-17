import logging
import os
import secrets

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

import approvals, auth, campaigns_api, cdr_api, collab, cron_jobs, forecasting, integrations, live, notify_api, reports, request_form
import revisions_api, templates_recurring, tickets_api, timetracking, tracking, uploads, users_admin, views_bulk
from auth import require_staff
from database import get_db

logger = logging.getLogger(__name__)

app = FastAPI(title="DesignFlow API", version="1.0.0")


@app.middleware("http")
async def json_errors(request: Request, call_next):
    """Turn an unexpected crash into a JSON 500 *inside* the CORS layer. Without this the browser sees a response
    with no CORS headers and reports a misleading "blocked by CORS" / "cannot reach the server"."""
    try:
        return await call_next(request)
    except Exception:
        logger.exception("Unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse({"detail": "The server had a problem. Please try again."}, status_code=500)


@app.middleware("http")
async def scheduled_jobs(request: Request, call_next):
    """Run the reminders, SLA checks and auto-closing every few minutes off normal traffic (see cron_jobs.run_if_due)."""
    response = await call_next(request)
    if cron_jobs.auto_tick_enabled() and not request.url.path.endswith("/internal/tick"):
        await run_in_threadpool(cron_jobs.run_if_due)
    return response


class SelectiveGZip(GZipMiddleware):
    """Compress JSON and text responses. Image and file downloads are skipped: they are already compressed and
    squeezing them again only burns CPU on a small server."""

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["path"].endswith(("/file", "/download", "/image")):
            await self.app(scope, receive, send)
            return
        await super().__call__(scope, receive, send)


app.add_middleware(SelectiveGZip, minimum_size=1024)

# Production sets ALLOWED_ORIGINS. Without it (local development) any localhost port is allowed, so it doesn't matter
# which port Vite picks.
_origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_origin_regex=None if _origins else r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "Content-Range"],   # file names and ranged downloads, when cross-origin
)

for module in (auth, campaigns_api, users_admin, tickets_api, revisions_api, notify_api, collab, views_bulk, templates_recurring,
               timetracking, approvals, reports, request_form, cdr_api, tracking, uploads, live):
    app.include_router(module.router)
app.include_router(forecasting.router, dependencies=[Depends(require_staff)])

# Local development (SQLite) gets a default; anywhere else the tick is refused until CRON_SECRET is set.
CRON_SECRET = os.getenv("CRON_SECRET") or (
    "default_secret" if os.getenv("DATABASE_URL", "sqlite").startswith("sqlite") else None)

@app.get("/")
def read_root():
    return {"message": "Welcome to DesignFlow API"}

@app.get("/health")
def health_check():
    return {"status": "ok"}

@app.post("/internal/tick")
@app.get("/internal/tick")  # Vercel Cron sends a GET with "Authorization: Bearer $CRON_SECRET"
def internal_tick(x_cron_secret: str = Header(None), authorization: str = Header(None), db: Session = Depends(get_db)):
    bearer = authorization[7:] if authorization and authorization.startswith("Bearer ") else None
    if not CRON_SECRET or not any(s and secrets.compare_digest(s, CRON_SECRET) for s in (x_cron_secret, bearer)):
        raise HTTPException(status_code=403, detail="Forbidden")

    from cron_jobs import run_all_cron_jobs
    run_all_cron_jobs(db)
    return {"status": "tick_processed"}


@app.post("/api/webhooks/jira")
def jira_webhook_receiver(payload: dict, x_webhook_secret: str = Header(None), db: Session = Depends(get_db)):
    """
    Receives payloads from Jira for 2-Way Sync.
    """
    expected = os.getenv("JIRA_WEBHOOK_SECRET")
    if not expected or not x_webhook_secret or not secrets.compare_digest(x_webhook_secret, expected):
        raise HTTPException(status_code=403, detail="Forbidden")
    return integrations.handle_incoming_jira_webhook(payload, db)
