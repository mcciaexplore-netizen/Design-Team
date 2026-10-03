"""Ticket comments with @mentions, file attachments, and Figma link previews."""
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

import events
import models
from auth import can_access_ticket, get_current_user, get_ticket_for_user
from common import as_utc, file_response_headers, load_bytes, log_audit, parse_figma_url, read_upload, store_bytes
from database import get_db

router = APIRouter(tags=["collaboration"])

@router.get("/api/figma/preview")
def figma_preview(url: str = Query(..., max_length=500), _user: models.User = Depends(get_current_user)):
    info = parse_figma_url(url)
    if not info:
        return {"valid": False, "detail": "Not a Figma file, design, prototype or board link"}
    return info


# ── Mentionable people ───────────────────────────────────────────────────────

def _people_for(db: Session, ticket: models.Ticket) -> List[models.User]:
    staff = db.query(models.User).filter(
        models.User.role != models.RoleEnum.REQUESTER, models.User.is_active == True).all()
    q = db.query(models.User).filter(models.User.role == models.RoleEnum.REQUESTER, models.User.is_active == True)
    if ticket.client_org:
        q = q.filter(models.User.client_org == ticket.client_org)
    else:
        q = q.filter(models.User.id == ticket.requester_id)
    return staff + q.all()


@router.get("/api/tickets/{ticket_id}/mentionable")
def mentionable(ticket_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    ticket = get_ticket_for_user(db, ticket_id, user)
    return [{"id": u.id, "full_name": u.full_name, "role": u.role.value} for u in _people_for(db, ticket)]


# ── Comments ─────────────────────────────────────────────────────────────────

class CommentCreate(BaseModel):
    content: str = Field(min_length=1, max_length=5000)
    mentioned_user_ids: List[int] = Field(default_factory=list, max_length=20)


def _serialize(db: Session, comments: List[models.TicketComment]) -> list:
    user_ids = {c.author_id for c in comments}
    for c in comments:
        user_ids.update(c.mentioned_user_ids or [])
    users = {u.id: u for u in db.query(models.User).filter(models.User.id.in_(user_ids or {0})).all()}
    atts = {}
    for a in db.query(models.Attachment).filter(models.Attachment.comment_id.in_([c.id for c in comments] or [0])).all():
        atts.setdefault(a.comment_id, []).append(a)
    out = []
    for c in comments:
        author = users.get(c.author_id)
        out.append({
            "id": c.id,
            "content": c.content,
            "created_at": as_utc(c.created_at).isoformat() if c.created_at else None,
            "author": {"id": c.author_id, "full_name": author.full_name if author else "Unknown",
                       "role": author.role.value if author else None},
            "mentions": [{"id": i, "full_name": users[i].full_name} for i in (c.mentioned_user_ids or []) if i in users],
            "attachments": [_att(a) for a in atts.get(c.id, [])],
        })
    return out


def _att(a: models.Attachment) -> dict:
    return {"id": a.id, "file_name": a.file_name, "content_type": a.content_type, "size_bytes": a.size_bytes,
            "comment_id": a.comment_id, "uploaded_by_id": a.uploaded_by_id,
            "uploaded_at": as_utc(a.uploaded_at).isoformat() if a.uploaded_at else None}


@router.get("/api/tickets/{ticket_id}/comments")
def list_comments(ticket_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    get_ticket_for_user(db, ticket_id, user)
    rows = db.query(models.TicketComment).filter(models.TicketComment.ticket_id == ticket_id) \
        .order_by(models.TicketComment.created_at.asc(), models.TicketComment.id.asc()).all()
    return _serialize(db, rows)


@router.post("/api/tickets/{ticket_id}/comments", status_code=201)
def add_comment(ticket_id: int, body: CommentCreate, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    ticket = get_ticket_for_user(db, ticket_id, user)
    content = body.content.strip()
    if not content:
        raise HTTPException(status_code=422, detail="Comment cannot be empty")

    ids = list(dict.fromkeys(body.mentioned_user_ids))
    mentioned = db.query(models.User).filter(models.User.id.in_(ids or [0]), models.User.is_active == True).all() if ids else []
    allowed = {u.id for u in _people_for(db, ticket)}
    bad = [i for i in ids if i not in allowed or i not in {m.id for m in mentioned}]
    if bad:
        raise HTTPException(status_code=422, detail="You can only mention people who have access to this ticket")

    comment = models.TicketComment(ticket_id=ticket_id, author_id=user.id, content=content, mentioned_user_ids=ids)
    db.add(comment)
    db.flush()
    log_audit(db, ticket_id, user, "Commented", {"comment_id": comment.id, "mentions": ids})
    db.commit()
    db.refresh(comment)

    excerpt = content[:140] + ("…" if len(content) > 140 else "")
    events.emit(db, "comment_added", ticket, user, {"excerpt": excerpt})
    if mentioned:
        events.emit(db, "mention", ticket, user, {"users": mentioned, "excerpt": excerpt})
    return _serialize(db, [comment])[0]


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
    comment_id: Optional[int] = Form(default=None),
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    ticket = get_ticket_for_user(db, ticket_id, user)
    if comment_id is not None:
        comment = db.query(models.TicketComment).filter(
            models.TicketComment.id == comment_id, models.TicketComment.ticket_id == ticket_id).first()
        if not comment or comment.author_id != user.id:
            raise HTTPException(status_code=422, detail="Attachments can only be added to your own comments on this ticket")
    data, name, content_type = await read_upload(file)
    key = store_bytes(data, name.rsplit(".", 1)[-1].lower())
    att = models.Attachment(ticket_id=ticket.id, file_name=name, file_url=key, comment_id=comment_id,
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
def download_attachment(attachment_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    att = _get_attachment(db, attachment_id, user)
    content_type = att.content_type or "application/octet-stream"
    return Response(content=load_bytes(att.file_url), media_type=content_type,
                    headers=file_response_headers(att.file_name, content_type))


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
