"""Vercel entry point: serves the FastAPI backend as a serverless function under /api.

vercel.json rewrites /api/* here; the frontend is built with VITE_API_URL=/api, so the browser calls the API on the
same origin (no CORS). Every backend route keeps its own path below that prefix.
"""
import logging
import os
import sys

BACKEND = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend")
sys.path.insert(0, BACKEND)

# The Vercel / Neon Postgres integration names the variable POSTGRES_URL; the backend reads DATABASE_URL.
if not os.getenv("DATABASE_URL") and os.getenv("POSTGRES_URL"):
    os.environ["DATABASE_URL"] = os.environ["POSTGRES_URL"]
if not os.getenv("DATABASE_URL"):
    raise RuntimeError("DATABASE_URL is not set. Add a Postgres database (e.g. Neon) to the Vercel project.")
if not os.getenv("SECRET_KEY"):
    # Each serverless instance would invent its own key and sign people out at random.
    raise RuntimeError("SECRET_KEY is not set. Add a long random string to the Vercel project's environment.")

from fastapi import FastAPI  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
from sqlalchemy import text  # noqa: E402

from database import engine  # noqa: E402
from main import app as backend  # noqa: E402

logger = logging.getLogger(__name__)


STARTUP_ERROR: str | None = None


def _at_head() -> bool:
    """One cheap query: is the database already on the newest migration?"""
    from alembic.config import Config
    from alembic.script import ScriptDirectory
    cfg = Config(os.path.join(BACKEND, "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(BACKEND, "alembic"))
    head = ScriptDirectory.from_config(cfg).get_current_head()
    try:
        with engine.connect() as conn:
            return conn.execute(text("SELECT version_num FROM alembic_version")).scalar() == head
    except Exception:
        return False   # no alembic_version table yet: a brand-new database


def _prepare_database() -> None:
    """Render ran `python seed.py` before starting; Vercel has no start command, so cold starts do it. When the
    schema is already current only the quick seeding runs. The transaction-scoped advisory lock stops parallel cold
    starts from migrating at the same time (and works through a pgbouncer-style pooler)."""
    global STARTUP_ERROR
    import seed
    try:
        if _at_head():
            seed.seed(migrate_first=False)
            return
        with engine.begin() as conn:
            if conn.dialect.name == "postgresql":
                conn.execute(text("SELECT pg_advisory_xact_lock(4207311)"))
            seed.seed()
    except Exception as exc:
        STARTUP_ERROR = f"{exc.__class__.__name__}: {str(exc)[:200]}"
        logger.exception("Startup migration/seed failed")


_prepare_database()

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/api/health")
def health():
    """Says so when the database could not be prepared, instead of every other request failing unexplained."""
    if STARTUP_ERROR:
        return JSONResponse({"status": "error", "detail": "Database setup failed; see the function logs."}, status_code=503)
    return {"status": "ok"}


app.mount("/api", backend)
