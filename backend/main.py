import logging
import os
import secrets

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

import approvals, auth, cdr_api, collab, forecasting, integrations, live, notify_api, reports, request_form
import revisions_api, templates_recurring, thread, tickets_api, timetracking, tracking, users_admin, views_bulk
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
)

for module in (auth, users_admin, tickets_api, revisions_api, notify_api, collab, views_bulk, templates_recurring,
               timetracking, approvals, reports, request_form, cdr_api, tracking, thread, live):
    app.include_router(module.router)
app.include_router(forecasting.router, dependencies=[Depends(require_staff)])

CRON_SECRET = os.getenv("CRON_SECRET", "default_secret")

@app.get("/")
def read_root():
    return {"message": "Welcome to DesignFlow API"}

@app.get("/health")
def health_check():
    return {"status": "ok"}

@app.post("/internal/tick")
def internal_tick(x_cron_secret: str = Header(None), db: Session = Depends(get_db)):
    if x_cron_secret != CRON_SECRET:
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
