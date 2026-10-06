"""Source-file (CDR) requests: a client asks for the editable file, a lead approves, a designer uploads, the client downloads."""
from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

import cdr_engine
import events
import models
from auth import LEAD_ROLES, can_access_ticket, get_current_user, get_ticket_for_user, require_lead, require_staff
from common import MAX_CDR_BYTES, file_response_headers, load_bytes, log_audit, read_upload, store_bytes
from database import get_db

router = APIRouter(tags=["cdr"])

# A source file is only released once the design has been signed off.
RELEASABLE = (models.TicketStatus.DELIVERED, models.TicketStatus.CLOSED, models.TicketStatus.CLOSED_WITHOUT_APPROVAL)


class CdrCreate(BaseModel):
    ticket_id: int


def _out(db: Session, req: models.CdrRequest) -> dict:
    ids = [i for i in (req.requester_id, req.approver_id) if i]
    users = {u.id: u for u in db.query(models.User).filter(models.User.id.in_(ids)).all()}
    return {
        "id": req.id, "ticket_id": req.ticket_id, "status": req.status.value,
        "requested_by": users[req.requester_id].full_name if req.requester_id in users else None,
        "decided_by": users[req.approver_id].full_name if req.approver_id in users else None,
        "has_file": bool(req.s3_object_key),
        "created_at": req.created_at.isoformat() if req.created_at else None,
    }


def _get(db: Session, request_id: int, user: models.User) -> tuple[models.CdrRequest, models.Ticket]:
    req = db.query(models.CdrRequest).filter(models.CdrRequest.id == request_id).first()
    ticket = db.query(models.Ticket).filter(models.Ticket.id == req.ticket_id).first() if req and req.ticket_id else None
    if not req or not ticket or not can_access_ticket(user, ticket):
        raise HTTPException(status_code=404, detail="Request not found")
    return req, ticket


def _notify_requester(db: Session, req: models.CdrRequest, content: str, event: str) -> None:
    requester = db.query(models.User).filter(models.User.id == req.requester_id).first()
    if requester:
        ticket = db.query(models.Ticket).filter(models.Ticket.id == req.ticket_id).first()
        events.notify(db, requester, content, event, ticket)


@router.post("/api/cdr-requests", status_code=201)
def request_cdr(body: CdrCreate, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    ticket = get_ticket_for_user(db, body.ticket_id, user)
    if ticket.status not in RELEASABLE:
        raise HTTPException(status_code=409, detail="The source file can be requested once the design is approved.")
    open_req = db.query(models.CdrRequest).filter(
        models.CdrRequest.ticket_id == ticket.id, models.CdrRequest.requester_id == user.id,
        models.CdrRequest.status.in_([models.CdrRequestStatus.REQUESTED, models.CdrRequestStatus.APPROVED]),
    ).first()
    if open_req:
        return _out(db, open_req)
    req = cdr_engine.create_cdr_request(db, user.id, ticket_id=ticket.id)
    log_audit(db, ticket.id, user, "Source file requested", {"request_id": req.id})
    for lead in db.query(models.User).filter(models.User.role.in_(LEAD_ROLES), models.User.is_active == True).all():
        events.notify(db, lead, f"{user.full_name} requested the source file for {ticket.ticket_number}", "cdr_requested")
    db.commit()
    return _out(db, req)


@router.get("/api/tickets/{ticket_id}/cdr-requests")
def list_cdr_requests(ticket_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    ticket = get_ticket_for_user(db, ticket_id, user)
    q = db.query(models.CdrRequest).filter(models.CdrRequest.ticket_id == ticket.id)
    return [_out(db, r) for r in q.order_by(models.CdrRequest.id.desc()).all()]


@router.post("/api/cdr-requests/{request_id}/approve")
def approve(request_id: int, db: Session = Depends(get_db), lead: models.User = Depends(require_lead)):
    req, ticket = _get(db, request_id, lead)
    if not cdr_engine.approve_cdr_request(db, req.id, lead.id):
        raise HTTPException(status_code=409, detail="This request has already been decided.")
    log_audit(db, ticket.id, lead, "Source file request approved", {"request_id": req.id})
    _notify_requester(db, req, f"Your source file request for {ticket.ticket_number} was approved; the design team will upload it.", "cdr_approved")
    db.commit()
    return _out(db, req)


@router.post("/api/cdr-requests/{request_id}/decline")
def decline(request_id: int, db: Session = Depends(get_db), lead: models.User = Depends(require_lead)):
    req, ticket = _get(db, request_id, lead)
    if not cdr_engine.decline_cdr_request(db, req.id, lead.id):
        raise HTTPException(status_code=409, detail="This request has already been decided.")
    log_audit(db, ticket.id, lead, "Source file request declined", {"request_id": req.id})
    _notify_requester(db, req, f"Your source file request for {ticket.ticket_number} was declined.", "cdr_declined")
    db.commit()
    return _out(db, req)


@router.post("/api/cdr-requests/{request_id}/upload")
async def upload(request_id: int, file: UploadFile = File(...), db: Session = Depends(get_db), user: models.User = Depends(require_staff)):
    req, ticket = _get(db, request_id, user)
    if req.status != models.CdrRequestStatus.APPROVED:
        raise HTTPException(status_code=409, detail="A lead must approve the request before the file is uploaded.")
    data, name, _ = await read_upload(file, MAX_CDR_BYTES)
    key = store_bytes(data, name.rsplit(".", 1)[-1].lower())
    if not cdr_engine.upload_cdr(db, req.id, key, ""):
        raise HTTPException(status_code=409, detail="This request is no longer waiting for a file.")
    log_audit(db, ticket.id, user, "Source file uploaded", {"request_id": req.id, "file_name": name})
    _notify_requester(db, req, f"The source file for {ticket.ticket_number} is ready to download.", "cdr_uploaded")
    db.commit()
    return _out(db, req)


@router.get("/api/cdr-requests/{request_id}/download")
def download(request_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    req, ticket = _get(db, request_id, user)
    if req.status != models.CdrRequestStatus.UPLOADED or not req.s3_object_key:
        raise HTTPException(status_code=409, detail="The file is not ready yet.")
    data = load_bytes(req.s3_object_key)
    cdr_engine.record_download(db, req, user.id)
    ext = req.s3_object_key.rsplit(".", 1)[-1]
    return Response(content=data, media_type="application/octet-stream",
                    headers=file_response_headers(f"{ticket.ticket_number}-source.{ext}", "application/octet-stream"))
