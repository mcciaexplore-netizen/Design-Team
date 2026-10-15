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
from sqlalchemy import text  # noqa: E402

from database import engine  # noqa: E402
from main import app as backend  # noqa: E402

logger = logging.getLogger(__name__)


def _prepare_database() -> None:
    """Render ran `python seed.py` before starting; Vercel has no start command, so each cold start does it.
    Migrations and seeding are idempotent; the transaction-scoped advisory lock stops parallel cold starts from
    migrating at the same time (and works through a pgbouncer-style pooler)."""
    import seed
    try:
        with engine.begin() as conn:
            if conn.dialect.name == "postgresql":
                conn.execute(text("SELECT pg_advisory_xact_lock(4207311)"))
            seed.seed()
    except Exception:
        logger.exception("Startup migration/seed failed")


_prepare_database()

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
app.mount("/api", backend)
