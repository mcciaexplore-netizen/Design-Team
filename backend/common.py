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


# ── File storage ─────────────────────────────────────────────────────────────

MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_MB", "10")) * 1024 * 1024

ALLOWED_EXTENSIONS = {
    "png", "jpg", "jpeg", "gif", "webp", "pdf", "txt", "csv",
    "doc", "docx", "xls", "xlsx", "ppt", "pptx", "zip", "psd", "ai", "fig",
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
    path = os.getenv("UPLOAD_DIR", os.path.join(os.path.dirname(__file__), "uploads"))
    os.makedirs(path, exist_ok=True)
    return path


def safe_filename(name: str) -> str:
    base = os.path.basename(name or "file").replace("\x00", "")
    base = re.sub(r"[^\w.\- ]", "_", base).strip(" .") or "file"
    return base[:120]


async def read_upload(file: UploadFile) -> tuple[bytes, str, str]:
    """Validate an upload and return (data, safe_name, content_type). Raises HTTPException on bad input."""
    name = safe_filename(file.filename or "")
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=415, detail=f"File type .{ext or '?'} is not allowed")
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"File is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)} MB")
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


def store_bytes(data: bytes, ext: str) -> str:
    """Persist bytes under a random key (S3 when configured, else local disk) and return the key."""
    key = f"{uuid.uuid4().hex}.{ext}"
    client = _s3()
    if client:
        client.put_object(Bucket=os.getenv("S3_BUCKET_NAME", "designflow"), Key=key, Body=data)
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
