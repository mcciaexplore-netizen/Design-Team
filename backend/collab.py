"""File attachments on tickets, and Figma link previews."""
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile
from sqlalchemy.orm import Session

import models
from auth import can_access_ticket, get_current_user, get_ticket_for_user
from common import as_utc, stored_file_response, log_audit, parse_figma_url, read_upload, store_bytes
from database import get_db

router = APIRouter(tags=["collaboration"])

@router.get("/api/figma/preview")
def figma_preview(url: str = Query(..., max_length=500), _user: models.User = Depends(get_current_user)):
    info = parse_figma_url(url)
    if not info:
        return {"valid": False, "detail": "Not a Figma file, design, prototype or board link"}
    return info


def _att(a: models.Attachment) -> dict:
    return {"id": a.id, "file_name": a.file_name, "content_type": a.content_type, "size_bytes": a.size_bytes,
            "uploaded_by_id": a.uploaded_by_id,
            "uploaded_at": as_utc(a.uploaded_at).isoformat() if a.uploaded_at else None}


# ── Attachments ──────────────────────────────────────────────────────────────

@router.get("/api/tickets/{ticket_id}/attachments")
def list_attachments(ticket_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    get_ticket_for_user(db, ticket_id, user)
    rows = db.query(models.Attachment).filter(models.Attachment.ticket_id == ticket_id) \
        .order_by(models.Attachment.uploaded_at.asc(), models.Attachment.id.asc()).all()
    return [_att(a) for a in rows]


@router.post("/api/tickets/{ticket_id}/attachments", status_code=201)
async def upload_attachment(
    ticket_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    ticket = get_ticket_for_user(db, ticket_id, user)
    data, name, content_type = await read_upload(file)
    key = store_bytes(data, name.rsplit(".", 1)[-1].lower(), name)
    att = models.Attachment(ticket_id=ticket.id, file_name=name, file_url=key,
                            content_type=content_type, size_bytes=len(data), uploaded_by_id=user.id)
    db.add(att)
    db.flush()
    log_audit(db, ticket.id, user, "Attached file", {"attachment_id": att.id, "file_name": name, "size_bytes": len(data)})
    db.commit()
    db.refresh(att)
    return _att(att)


def _get_attachment(db: Session, attachment_id: int, user: models.User) -> models.Attachment:
    att = db.query(models.Attachment).filter(models.Attachment.id == attachment_id).first()
    ticket = db.query(models.Ticket).filter(models.Ticket.id == att.ticket_id).first() if att else None
    if not att or not ticket or not can_access_ticket(user, ticket):
        raise HTTPException(status_code=404, detail="Attachment not found")
    return att


@router.get("/api/attachments/{attachment_id}/download")
def download_attachment(attachment_id: int, request: Request, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    att = _get_attachment(db, attachment_id, user)
    content_type = att.content_type or "application/octet-stream"
    return stored_file_response(request, att.file_url, att.file_name, content_type)


@router.delete("/api/attachments/{attachment_id}", status_code=204)
def delete_attachment(attachment_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    att = _get_attachment(db, attachment_id, user)
    is_lead = user.role in (models.RoleEnum.DESIGN_LEAD, models.RoleEnum.ADMIN)
    if att.uploaded_by_id != user.id and not is_lead:
        raise HTTPException(status_code=403, detail="Only the uploader or a Design Lead can delete this file")
    log_audit(db, att.ticket_id, user, "Removed file", {"attachment_id": att.id, "file_name": att.file_name})
    db.delete(att)
    db.commit()
    return Response(status_code=204)
