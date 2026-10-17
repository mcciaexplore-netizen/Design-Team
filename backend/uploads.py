"""Large files in pieces. Vercel refuses any request body over 4.5 MB, so the browser sends a big file here in parts
first, then submits the usual form with a small placeholder in the file's place (see common.read_upload, which swaps
the joined file back in). Every upload endpoint keeps working unchanged."""
import datetime
import re

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

import models
import ratelimit
from common import MAX_CDR_BYTES, PART_BYTES
from database import get_db

router = APIRouter(tags=["uploads"])

MAX_PARTS = -(-MAX_CDR_BYTES // PART_BYTES)           # enough for the largest file allowed anywhere
MAX_STAGED_BYTES = 300 * 1024 * 1024                  # everything waiting to be joined, across all uploads
STALE_AFTER = datetime.timedelta(hours=6)


@router.put("/api/uploads/{upload_id}/parts/{part}", status_code=204)
async def put_part(upload_id: str, part: int, request: Request, db: Session = Depends(get_db)):
    if not re.fullmatch(r"[0-9a-f]{32}", upload_id) or not 0 <= part < MAX_PARTS:
        raise HTTPException(status_code=404, detail="Not found")
    data = await request.body()
    if not data or len(data) > PART_BYTES:
        raise HTTPException(status_code=413, detail="Each piece must be between 1 byte and 3 MB")
    # Anyone can send a request with files (the public form), so cap how much one network and everyone together
    # can park here.
    ratelimit.check(db, f"upload-parts:{ratelimit.client_ip(request)}", 40, 3600,
                    "Too many large files from your network. Please try again in an hour.")
    staged = db.query(func.coalesce(func.sum(func.length(models.UploadPart.data)), 0)).scalar()
    if staged + len(data) > MAX_STAGED_BYTES:
        raise HTTPException(status_code=503, detail="The server is busy receiving files. Please try again in a few minutes.")
    mine = db.query(func.coalesce(func.sum(func.length(models.UploadPart.data)), 0)) \
        .filter(models.UploadPart.upload_id == upload_id, models.UploadPart.part != part).scalar()
    if mine + len(data) > MAX_CDR_BYTES:
        raise HTTPException(status_code=413, detail=f"The file is larger than {MAX_CDR_BYTES // (1024 * 1024)} MB")
    db.query(models.UploadPart).filter(models.UploadPart.upload_id == upload_id, models.UploadPart.part == part) \
        .delete(synchronize_session=False)   # a retried piece replaces the first try
    db.add(models.UploadPart(upload_id=upload_id, part=part, data=data))
    db.commit()


def clear_stale_parts(db: Session) -> None:
    """Pieces of uploads nobody finished (a closed tab, a failed form)."""
    cutoff = datetime.datetime.now(datetime.timezone.utc) - STALE_AFTER
    db.query(models.UploadPart).filter(models.UploadPart.created_at < cutoff).delete(synchronize_session=False)
    db.commit()
