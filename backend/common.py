"""Helpers shared by several feature modules: audit trail, file storage, SLA due dates."""
import datetime
import os
import re
import uuid
from urllib.parse import quote
import logging
from typing import Annotated, Optional

import pytz
from pydantic import StringConstraints
from fastapi import HTTPException, UploadFile
from sqlalchemy.orm import Session

import models
from sla_engine import calculate_due_date

# Plain-string email address: trimmed, lower-cased, basic shape check (no email-validator dependency).
Email = Annotated[str, StringConstraints(strip_whitespace=True, to_lower=True, min_length=3, max_length=254,
                                         pattern=r"^[^@\s]+@[^@\s]+$")]

logger = logging.getLogger(__name__)


# ── Audit trail ──────────────────────────────────────────────────────────────

def log_audit(db: Session, ticket_id: int, user: Optional[models.User], action: str,
              details: Optional[dict] = None, actor_label: Optional[str] = None) -> None:
    """Add an audit row. The caller commits, so the audit entry lands atomically with the change."""
    db.add(models.AuditLog(
        ticket_id=ticket_id,
        changed_by_id=user.id if user else None,
        actor_label=actor_label or (user.full_name if user else None),
        action=action,
        details=details or {},
    ))


# ── Delivery ─────────────────────────────────────────────────────────────────

def mark_delivered(db: Session, ticket: models.Ticket) -> None:
    """Stamp a ticket as delivered and open its edit window; the cron tick auto-closes it when the window ends."""
    now = datetime.datetime.now(pytz.utc)
    if ticket.delivered_at is None:
        ticket.delivered_at = now
    if ticket.edit_window_ends_at is None:
        settings = db.query(models.SystemSettings).first()
        own = ticket.design_type.edit_window_hours if ticket.design_type else None
        hours = own or (settings.edit_window_hours if settings else DEFAULT_EDIT_WINDOW_HOURS)
        ticket.edit_window_ends_at = now + datetime.timedelta(hours=hours)


DEFAULT_EDIT_WINDOW_HOURS = 48
CHANGE_CUTOFF = datetime.timedelta(hours=12)
IST = pytz.timezone("Asia/Kolkata")


def change_cutoff(ticket: models.Ticket) -> Optional[datetime.datetime]:
    """Changes stop 12 hours before the event (counted from the start of the event day, IST). Tickets without an
    event date (made inside the app) use their delivery deadline instead."""
    event = (ticket.type_specific_fields or {}).get("event_date")
    if event:
        try:
            day = datetime.date.fromisoformat(str(event)[:10])
            return IST.localize(datetime.datetime.combine(day, datetime.time())) - CHANGE_CUTOFF
        except ValueError:
            pass
    return as_utc(ticket.due_at) - CHANGE_CUTOFF if ticket.due_at else None


def ensure_changes_allowed(ticket: models.Ticket) -> None:
    cutoff = change_cutoff(ticket)
    if cutoff and datetime.datetime.now(pytz.utc) >= cutoff:
        when = cutoff.astimezone(IST).strftime("%d %b %Y, %I:%M %p")
        raise HTTPException(status_code=409, detail=(
            f"Changes can't be requested within 12 hours of the event (the cut-off was {when} IST). "
            "Please contact the design team directly."))


def after_status_change(db: Session, ticket: models.Ticket) -> None:
    """Bookkeeping every status change needs, wherever it happens (ticket page, bulk edit): the edit window opens on
    Delivered and closes otherwise, and a review link still open is withdrawn once the ticket is no longer waiting on
    the client, so a late click on it cannot move the ticket."""
    if ticket.status == models.TicketStatus.DELIVERED:
        mark_delivered(db, ticket)
    else:
        ticket.edit_window_ends_at = None
    if ticket.status not in (models.TicketStatus.IN_REVIEW, models.TicketStatus.DELIVERED):
        db.query(models.ApprovalRequest).filter(models.ApprovalRequest.ticket_id == ticket.id,
                                                models.ApprovalRequest.status == "pending").update({"status": "revoked"})


def track_waiting(ticket: models.Ticket, old: models.TicketStatus, new: models.TicketStatus) -> None:
    """While a ticket waits on the requester its clock is paused; record when that started and how long it lasted."""
    now = datetime.datetime.now(pytz.utc)
    if new == models.TicketStatus.WAITING_ON_REQUESTER and old != new:
        ticket.paused_at = now
    elif old == models.TicketStatus.WAITING_ON_REQUESTER and new != old and ticket.paused_at:
        ticket.total_paused_seconds = (ticket.total_paused_seconds or 0) + int((now - as_utc(ticket.paused_at)).total_seconds())
        ticket.paused_at = None


def last_proof_submitter(db: Session, ticket: models.Ticket) -> Optional[models.User]:
    """Whoever submitted the latest proof, if they are still an active member of the team."""
    proof = db.query(models.ProofVersion).filter(models.ProofVersion.ticket_id == ticket.id) \
        .order_by(models.ProofVersion.version.desc()).first()
    user = db.query(models.User).filter(models.User.id == proof.created_by_id).first() if proof else None
    if not user or not user.is_active or user.role == models.RoleEnum.REQUESTER:
        return None
    return user


# ── File storage ─────────────────────────────────────────────────────────────

# Vercel rejects request bodies over 4.5 MB before they reach the app, so default below that there.
_ON_VERCEL = bool(os.getenv("VERCEL"))
_MB_CAP = 4 if _ON_VERCEL else 1024
MAX_UPLOAD_BYTES = min(int(os.getenv("MAX_UPLOAD_MB", "10")), _MB_CAP) * 1024 * 1024
# Source files (CDR, PSD, AI...) are routinely larger than proofs and attachments.
MAX_CDR_BYTES = min(int(os.getenv("MAX_CDR_UPLOAD_MB", "50")), _MB_CAP) * 1024 * 1024

ALLOWED_EXTENSIONS = {
    "png", "jpg", "jpeg", "gif", "webp", "pdf", "txt", "csv",
    "doc", "docx", "xls", "xlsx", "ppt", "pptx", "zip", "psd", "ai", "fig", "cdr", "eps", "indd",
}
# PDFs are downloaded, not shown inline: the sandbox CSP we send stops browsers' built-in PDF viewers.
INLINE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp"}

_MAGIC = {
    "png": (b"\x89PNG\r\n\x1a\n",),
    "jpg": (b"\xff\xd8\xff",),
    "jpeg": (b"\xff\xd8\xff",),
    "gif": (b"GIF87a", b"GIF89a"),
    "pdf": (b"%PDF-",),
    "webp": (b"RIFF",),
}
_CONTENT_TYPES = {
    "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif",
    "webp": "image/webp", "pdf": "application/pdf", "txt": "text/plain", "csv": "text/csv",
}


def _upload_dir() -> str:
    # Local disk: development and servers with a lasting disk (Vercel uses the database instead; see _db_storage).
    default = "/tmp/uploads" if _ON_VERCEL else os.path.join(os.path.dirname(__file__), "uploads")
    path = os.getenv("UPLOAD_DIR", default)
    os.makedirs(path, exist_ok=True)
    return path


def safe_filename(name: str) -> str:
    base = os.path.basename(name or "file").replace("\x00", "")
    base = re.sub(r"[^\w.\- ]", "_", base).strip(" .") or "file"
    return base[:120]


async def read_upload(file: UploadFile, max_bytes: Optional[int] = None) -> tuple[bytes, str, str]:
    """Validate an upload and return (data, safe_name, content_type). Raises HTTPException on bad input."""
    limit = max_bytes or MAX_UPLOAD_BYTES
    name = safe_filename(file.filename or "")
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=415, detail=f"File type .{ext or '?'} is not allowed")
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(status_code=413, detail=f"File is larger than {limit // (1024 * 1024)} MB")
    if not data:
        raise HTTPException(status_code=400, detail="File is empty")
    magic = _MAGIC.get(ext)
    if magic and not data.startswith(magic):
        raise HTTPException(status_code=415, detail="File contents do not match its extension")
    return data, name, _CONTENT_TYPES.get(ext, "application/octet-stream")


def _s3():
    if not os.getenv("S3_ENDPOINT_URL"):
        return None
    import boto3
    return boto3.client(
        "s3",
        endpoint_url=os.getenv("S3_ENDPOINT_URL"),
        aws_access_key_id=os.getenv("S3_ACCESS_KEY_ID"),
        aws_secret_access_key=os.getenv("S3_SECRET_ACCESS_KEY"),
        region_name=os.getenv("S3_REGION_NAME", "auto"),
    )


def _db_storage() -> bool:
    """Keep file contents in the database when S3 is not set up and the disk does not last (Vercel), or when
    FILE_STORAGE=database is set explicitly."""
    if os.getenv("S3_ENDPOINT_URL"):
        return False
    mode = os.getenv("FILE_STORAGE", "").strip().lower()
    return mode == "database" or (mode != "disk" and _ON_VERCEL)


def store_bytes(data: bytes, ext: str) -> str:
    """Persist bytes under a random key (S3, the database or local disk; see _db_storage) and return the key."""
    key = f"{uuid.uuid4().hex}.{ext}"
    client = _s3()
    if client:
        client.put_object(Bucket=os.getenv("S3_BUCKET_NAME", "designflow"), Key=key, Body=data)
    elif _db_storage():
        from database import SessionLocal   # its own short session: the caller's transaction may still roll back
        db = SessionLocal()
        try:
            db.add(models.StoredFile(key=key, data=data))
            db.commit()
        finally:
            db.close()
    else:
        with open(os.path.join(_upload_dir(), key), "wb") as fh:
            fh.write(data)
    return key


def load_bytes(key: str) -> bytes:
    if not re.fullmatch(r"[0-9a-f]{32}\.[a-z0-9]{1,5}", key):
        raise HTTPException(status_code=404, detail="File not found")
    client = _s3()
    try:
        if client:
            return client.get_object(Bucket=os.getenv("S3_BUCKET_NAME", "designflow"), Key=key)["Body"].read()
        if _db_storage():
            from database import SessionLocal
            db = SessionLocal()
            try:
                row = db.query(models.StoredFile).filter(models.StoredFile.key == key).first()
            finally:
                db.close()
            if row:
                return bytes(row.data)
            raise FileNotFoundError(key)
        with open(os.path.join(_upload_dir(), key), "rb") as fh:
            return fh.read()
    except (FileNotFoundError, OSError):
        raise HTTPException(status_code=404, detail="File not found")
    except Exception:
        logger.exception("Storage read failed for %s", key)
        raise HTTPException(status_code=502, detail="File storage is unavailable")


def file_response_headers(name: str, content_type: str) -> dict:
    inline = content_type in INLINE_TYPES
    disposition = "inline" if inline else "attachment"
    return {
        "Content-Disposition": f'{disposition}; filename="{safe_filename(name)}"',
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
        "Cache-Control": "private, max-age=0, no-store",
    }


# ── SLA ──────────────────────────────────────────────────────────────────────

DEFAULT_SCHEDULE = {d: {"is_working": d < 5, "start": 10, "end": 19} for d in range(7)}


def compute_due_at(db: Session, design_type: models.DesignType, priority: models.TicketPriority,
                   start: Optional[datetime.datetime] = None) -> datetime.datetime:
    schedules = db.query(models.WorkingSchedule).all()
    schedule = {
        s.day_of_week: {"is_working": s.is_working_day, "start": s.start_hour, "end": s.end_hour}
        for s in schedules
    } or DEFAULT_SCHEDULE
    holidays = {h.date.date() for h in db.query(models.Holiday).all()}
    sla_hours = design_type.default_sla_hours
    if priority == models.TicketPriority.URGENT:
        sla_hours = max(2, sla_hours // 2)
    return calculate_due_date(start or datetime.datetime.now(pytz.utc), sla_hours, schedule, holidays)


def next_ticket_number(db: Session) -> str:
    last = db.query(models.Ticket).order_by(models.Ticket.id.desc()).first()
    return f"DF-{(last.id + 1 if last else 1):04d}"


def app_url() -> str:
    """The site's public address, for links in emails, review and tracking pages: PUBLIC_APP_URL, else on Vercel the
    project's production domain. Never taken from the request, so a forged Host/Origin can't redirect a link."""
    url = os.getenv("PUBLIC_APP_URL") or (
        f"https://{os.environ['VERCEL_PROJECT_PRODUCTION_URL']}" if os.getenv("VERCEL_PROJECT_PRODUCTION_URL") else "")
    return (url or "http://localhost:5173").rstrip("/")


def as_utc(dt: Optional[datetime.datetime]) -> Optional[datetime.datetime]:
    """SQLite returns naive datetimes; treat them as UTC."""
    if dt is None:
        return None
    return dt.replace(tzinfo=pytz.utc) if dt.tzinfo is None else dt.astimezone(pytz.utc)


# ── Figma ────────────────────────────────────────────────────────────────────

FIGMA_RE = re.compile(r"^https://(?:www\.)?figma\.com/(file|design|proto|board|slides)/([A-Za-z0-9]{10,40})(?:/([^/?#]*))?(?:[?#].*)?$")


def parse_figma_url(url: str) -> Optional[dict]:
    m = FIGMA_RE.match((url or "").strip())
    if not m:
        return None
    kind, key, slug = m.group(1), m.group(2), m.group(3) or ""
    name = re.sub(r"[-_]+", " ", slug).strip() or "Untitled"
    clean = url.strip()
    return {
        "valid": True,
        "kind": kind,
        "file_key": key,
        "name": name[:120],
        "open_url": clean,
        "embed_url": "https://www.figma.com/embed?embed_host=designdesk&url=" + quote(clean, safe=""),
    }


# ── CSV safety ───────────────────────────────────────────────────────────────

def csv_safe(value) -> str:
    """Stop spreadsheet apps treating user text as a formula (=, +, -, @ at the start of a cell)."""
    text = "" if value is None else str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text
