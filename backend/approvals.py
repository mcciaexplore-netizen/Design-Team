import datetime
import hashlib
import io
import secrets
import zipfile
from typing import Literal, Optional

import pytz
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

import delivery
import events
import revision_engine
import models
import ratelimit
from auth import get_current_user, get_ticket_for_user, require_staff
from common import as_utc, user_app_url, ensure_changes_allowed, load_bytes, mark_delivered, stored_file_response, log_audit, read_upload, store_bytes
from database import get_db

router = APIRouter(tags=["approvals"])

# The client has two days to approve or ask for changes; after that the cron tick closes the ticket.
DEFAULT_TTL_HOURS = 2 * 24
MAX_TTL_HOURS = 2 * 24


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _now() -> datetime.datetime:
    return datetime.datetime.now(pytz.utc)


def _proof_out(p: models.ProofVersion) -> dict:
    return {"id": p.id, "ticket_id": p.ticket_id, "version": p.version, "file_name": p.file_name,
            "content_type": p.content_type, "size_bytes": p.size_bytes, "note": p.note,
            "created_by_id": p.created_by_id, "created_at": as_utc(p.created_at).isoformat() if p.created_at else None}


def _request_out(r: models.ApprovalRequest, version: Optional[int] = None) -> dict:
    expired = r.status == "pending" and as_utc(r.expires_at) < _now()
    return {"id": r.id, "ticket_id": r.ticket_id, "proof_version_id": r.proof_version_id, "proof_version": version,
            "status": "expired" if expired else r.status,
            "expires_at": as_utc(r.expires_at).isoformat(), "decided_at": as_utc(r.decided_at).isoformat() if r.decided_at else None,
            "decided_by_name": r.decided_by_name, "decision_comment": r.decision_comment,
            "created_at": as_utc(r.created_at).isoformat() if r.created_at else None}


# ── Proof versions (staff upload; anyone with ticket access can view) ────────

def _email_review(ticket: models.Ticket, version: int, link: str) -> Optional[str]:
    """Tell the client by email (if SMTP is configured) and return the address it went to, else None. The link opens
    the review page: it asks for a name and a confirming click, so a mail scanner opening the link can't approve anything."""
    if not delivery.email_configured() or not ticket.requester:
        return None
    done = (f"The changes you asked for are done: version {version} of your design \"{ticket.title}\" ({ticket.ticket_number}) "
            "is complete and needs your approval." if version > 1 else
            f"Your design \"{ticket.title}\" ({ticket.ticket_number}) is complete and needs your approval.")
    body = "\n".join([
        f"Hi {ticket.requester.full_name},", "",
        done, "",
        "Open it, then approve it or tell us what to change:", link, "",
        "MCCIA Applied AI Studio",
    ])
    delivery.run_in_background(delivery.send_email, ticket.requester.email,
                               f"Design ready for your approval: {ticket.ticket_number}", body)
    return ticket.requester.email


def _open_review(db: Session, ticket: models.Ticket, proof: models.ProofVersion, user: models.User, ttl_hours: int):
    """Put a proof in front of the client: supersede any open request, move the ticket to In Review and return
    (request, one-time review link). Clients have no account: the link is how they review it."""
    db.query(models.ApprovalRequest).filter(
        models.ApprovalRequest.ticket_id == ticket.id, models.ApprovalRequest.status == "pending").update({"status": "revoked"})
    token = secrets.token_urlsafe(32)
    req = models.ApprovalRequest(ticket_id=ticket.id, proof_version_id=proof.id, token_hash=_hash(token),
                                 expires_at=_now() + datetime.timedelta(hours=ttl_hours), created_by_id=user.id)
    db.add(req)
    if ticket.status not in (models.TicketStatus.IN_REVIEW, models.TicketStatus.DELIVERED):
        ticket.status = models.TicketStatus.IN_REVIEW
    db.flush()
    log_audit(db, ticket.id, user, "Sent for approval", {"proof_version": proof.version, "expires_in_hours": ttl_hours})
    return req, f"{user_app_url()}/review/{token}"


@router.post("/api/tickets/{ticket_id}/proofs", status_code=201)
async def upload_proof(ticket_id: int, file: UploadFile = File(...), note: Optional[str] = Form(default=None, max_length=1000),
                       send_for_approval: Optional[str] = Form(default=None),
                       db: Session = Depends(get_db), user: models.User = Depends(require_staff)):
    """Upload a design version. By default it is sent to the client for approval in the same step. The field is read as
    text: newer FastAPI treats a missing bool form field like an unticked checkbox (False), so a missing field must not
    be a bool to mean "send"."""
    send = (send_for_approval or "").strip().lower() not in ("false", "0", "no", "off")
    ticket = get_ticket_for_user(db, ticket_id, user)
    if ticket.is_locked:
        raise HTTPException(status_code=409, detail="This version is closed. Upload the design on the newest version of the request.")
    data, name, content_type = await read_upload(file)
    key = store_bytes(data, name.rsplit(".", 1)[-1].lower(), name)
    last = db.query(models.ProofVersion).filter(models.ProofVersion.ticket_id == ticket.id) \
        .order_by(models.ProofVersion.version.desc()).first()
    proof = models.ProofVersion(ticket_id=ticket.id, version=(last.version + 1) if last else 1, file_name=name,
                                storage_key=key, content_type=content_type, size_bytes=len(data), note=note, created_by_id=user.id)
    db.add(proof)
    db.flush()
    log_audit(db, ticket.id, user, "Uploaded proof", {"version": proof.version, "file_name": name})
    approval = None
    if send:
        req, link = _open_review(db, ticket, proof, user, DEFAULT_TTL_HOURS)
        approval = (req, link)
    db.commit()
    db.refresh(proof)
    out = _proof_out(proof)
    if approval:
        db.refresh(approval[0])
        events.emit(db, "approval_requested", ticket, user, {"version": proof.version})
        emailed = _email_review(ticket, proof.version, approval[1])
        out["approval"] = {**_request_out(approval[0], proof.version), "review_url": approval[1], "emailed_to": emailed}
    else:
        out["approval"] = None
    return out


@router.get("/api/tickets/{ticket_id}/proofs")
def list_proofs(ticket_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    get_ticket_for_user(db, ticket_id, user)
    rows = db.query(models.ProofVersion).filter(models.ProofVersion.ticket_id == ticket_id) \
        .order_by(models.ProofVersion.version.desc()).all()
    return [_proof_out(p) for p in rows]


@router.get("/api/proofs/{proof_id}/file")
def proof_file(proof_id: int, request: Request, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    proof = db.query(models.ProofVersion).filter(models.ProofVersion.id == proof_id).first()
    if not proof:
        raise HTTPException(status_code=404, detail="Proof not found")
    get_ticket_for_user(db, proof.ticket_id, user)
    ct = proof.content_type or "application/octet-stream"
    return stored_file_response(request, proof.storage_key, proof.file_name, ct)


@router.get("/api/tickets/{ticket_id}/download-bundle")
def download_ticket_bundle(ticket_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Downloads all proofs, source files, and attachments for a ticket bundled into a single ZIP archive."""
    ticket = get_ticket_for_user(db, ticket_id, user)
    proofs = db.query(models.ProofVersion).filter(models.ProofVersion.ticket_id == ticket_id).order_by(models.ProofVersion.version.asc()).all()
    attachments = db.query(models.Attachment).filter(models.Attachment.ticket_id == ticket_id).all()
    cdrs = db.query(models.CdrAsset).filter(models.CdrAsset.ticket_id == ticket_id).all()

    if not proofs and not attachments and not cdrs:
        raise HTTPException(status_code=404, detail="No files found to bundle for this ticket.")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        seen = set()
        for p in proofs:
            try:
                data = load_bytes(p.storage_key)
                fname = f"proofs/v{p.version}_{p.file_name}"
                while fname in seen:
                    fname = f"proofs/v{p.version}_{secrets.token_hex(2)}_{p.file_name}"
                seen.add(fname)
                zf.writestr(fname, data)
            except Exception:
                pass
        for a in attachments:
            try:
                data = load_bytes(a.storage_key)
                fname = f"attachments/{a.file_name}"
                while fname in seen:
                    fname = f"attachments/{secrets.token_hex(2)}_{a.file_name}"
                seen.add(fname)
                zf.writestr(fname, data)
            except Exception:
                pass
        for c in cdrs:
            try:
                data = load_bytes(c.storage_key)
                fname = f"source_files/{c.file_name}"
                while fname in seen:
                    fname = f"source_files/{secrets.token_hex(2)}_{c.file_name}"
                seen.add(fname)
                zf.writestr(fname, data)
            except Exception:
                pass

    buf.seek(0)
    zip_bytes = buf.getvalue()
    safe_title = "".join(ch if ch.isalnum() or ch in "._- " else "_" for ch in ticket.title)[:40].strip() or "assets"
    filename = f"{ticket.ticket_number}_{safe_title}.zip"
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


# ── Approval requests (staff) ────────────────────────────────────────────────

class ApprovalCreate(BaseModel):
    proof_version_id: int
    ttl_hours: int = Field(default=DEFAULT_TTL_HOURS, ge=1, le=MAX_TTL_HOURS)


@router.post("/api/tickets/{ticket_id}/approval-requests", status_code=201)
def create_approval_request(ticket_id: int, body: ApprovalCreate, db: Session = Depends(get_db), user: models.User = Depends(require_staff)):
    ticket = get_ticket_for_user(db, ticket_id, user)
    proof = db.query(models.ProofVersion).filter(
        models.ProofVersion.id == body.proof_version_id, models.ProofVersion.ticket_id == ticket.id).first()
    if not proof:
        raise HTTPException(status_code=422, detail="Choose a proof that belongs to this ticket")
    if ticket.is_locked:
        raise HTTPException(status_code=409, detail="This version is closed. Send the design from the newest version of the request.")
    # A new request supersedes any still-open one for this ticket, so only one link is ever live.
    req, link = _open_review(db, ticket, proof, user, body.ttl_hours)
    db.commit()
    db.refresh(req)
    events.emit(db, "approval_requested", ticket, user, {"version": proof.version})
    emailed = _email_review(ticket, proof.version, link)
    # The link is returned exactly once; only its hash is stored.
    return {**_request_out(req, proof.version), "review_url": link, "emailed_to": emailed}


@router.get("/api/tickets/{ticket_id}/approval-requests")
def list_approval_requests(ticket_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    get_ticket_for_user(db, ticket_id, user)
    versions = {p.id: p.version for p in db.query(models.ProofVersion).filter(models.ProofVersion.ticket_id == ticket_id).all()}
    rows = db.query(models.ApprovalRequest).filter(models.ApprovalRequest.ticket_id == ticket_id) \
        .order_by(models.ApprovalRequest.created_at.desc(), models.ApprovalRequest.id.desc()).all()
    return [_request_out(r, versions.get(r.proof_version_id)) for r in rows]


@router.post("/api/approval-requests/{request_id}/revoke")
def revoke_approval_request(request_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_staff)):
    req = db.query(models.ApprovalRequest).filter(models.ApprovalRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    if req.status != "pending":
        raise HTTPException(status_code=409, detail=f"Request is already {req.status}")
    req.status = "revoked"
    log_audit(db, req.ticket_id, user, "Revoked approval link", {"request_id": req.id})
    db.commit()
    return {"ok": True}


# ── Public review (no login; protected by the unguessable single-use link) ───

THROTTLE_WINDOW, THROTTLE_MAX = 60, 30
# After a decision the reviewer can still download what they approved for this long.
REVIEW_FILE_GRACE = datetime.timedelta(days=7)


def _throttle(request: Request, db: Session) -> None:
    """Against token guessing. Shared by every server instance and keyed on the real client IP."""
    ratelimit.check(db, f"review:{ratelimit.client_ip(request)}", THROTTLE_MAX, THROTTLE_WINDOW,
                    "Too many requests. Please wait a minute and try again.")


def _review_file_allowed(req: models.ApprovalRequest) -> bool:
    now = _now()
    if req.status == "pending":
        return as_utc(req.expires_at) > now
    if req.status in ("approved", "changes_requested") and req.decided_at:
        return as_utc(req.decided_at) + REVIEW_FILE_GRACE > now
    return False


def _load_request(db: Session, token: str) -> models.ApprovalRequest:
    req = db.query(models.ApprovalRequest).filter(models.ApprovalRequest.token_hash == _hash(token)).first()
    if not req:
        raise HTTPException(status_code=404, detail="This review link is not valid")
    return req


@router.get("/api/public/review/{token}")
def public_review(token: str, request: Request, db: Session = Depends(get_db)):
    _throttle(request, db)
    req = _load_request(db, token)
    ticket = db.query(models.Ticket).filter(models.Ticket.id == req.ticket_id).first()
    proof = db.query(models.ProofVersion).filter(models.ProofVersion.id == req.proof_version_id).first()
    out = _request_out(req, proof.version if proof else None)
    return {
        "status": out["status"], "expires_at": out["expires_at"], "decided_at": out["decided_at"],
        "decision_comment": out["decision_comment"],
        "ticket": {"ticket_number": ticket.ticket_number, "title": ticket.title, "brief": ticket.brief},
        "proof": {"version": proof.version, "file_name": proof.file_name, "content_type": proof.content_type,
                  "note": proof.note} if proof else None,
    }


@router.get("/api/public/review/{token}/file")
def public_review_file(token: str, request: Request, db: Session = Depends(get_db)):
    _throttle(request, db)
    req = _load_request(db, token)
    if req.status == "revoked":
        raise HTTPException(status_code=410, detail="This review link has been withdrawn")
    if not _review_file_allowed(req):
        raise HTTPException(status_code=410, detail="This review link has expired")
    proof = db.query(models.ProofVersion).filter(models.ProofVersion.id == req.proof_version_id).first()
    if not proof:
        raise HTTPException(status_code=404, detail="File not found")
    ct = proof.content_type or "application/octet-stream"
    return stored_file_response(request, proof.storage_key, proof.file_name, ct)


class Decision(BaseModel):
    decision: Literal["approve", "request_changes"]
    name: str = Field(min_length=1, max_length=80)
    comment: Optional[str] = Field(default=None, max_length=2000)


def _apply_decision(db: Session, req: models.ApprovalRequest, body: "Decision", via: str) -> dict:
    """Record a client's decision on an approval request. Shared by the emailed link and the logged-in portal."""
    if req.status != "pending":
        raise HTTPException(status_code=409, detail={"approved": "This design was already approved.",
                                                     "changes_requested": "Changes were already requested.",
                                                     "revoked": "This review link has been withdrawn.",
                                                     "expired": "This review has closed."}.get(req.status, "Already decided"))
    if as_utc(req.expires_at) < _now():
        raise HTTPException(status_code=410, detail="This review has expired. Ask the design team for a new one.")
    if body.decision == "request_changes" and not (body.comment and body.comment.strip()):
        raise HTTPException(status_code=422, detail="Please describe the changes you would like")

    current = db.query(models.Ticket).filter(models.Ticket.id == req.ticket_id).first()
    if not current or current.is_locked or current.status not in (models.TicketStatus.IN_REVIEW, models.TicketStatus.DELIVERED):
        raise HTTPException(status_code=409, detail="This design is no longer waiting for your review.")
    if body.decision == "request_changes" and current:
        ensure_changes_allowed(current)

    # Compare-and-set so a double-click or two reviewers cannot both record a decision.
    new_status = "approved" if body.decision == "approve" else "changes_requested"
    claimed = db.query(models.ApprovalRequest).filter(
        models.ApprovalRequest.id == req.id, models.ApprovalRequest.status == "pending"
    ).update({"status": new_status, "decided_at": _now(), "decided_by_name": body.name.strip(),
              "decision_comment": (body.comment or "").strip() or None}, synchronize_session=False)
    if not claimed:
        db.rollback()
        raise HTTPException(status_code=409, detail="A decision has already been recorded")

    ticket = db.query(models.Ticket).filter(models.Ticket.id == req.ticket_id).first()
    proof = db.query(models.ProofVersion).filter(models.ProofVersion.id == req.proof_version_id).first()
    child = None
    if body.decision == "approve":
        ticket.status = models.TicketStatus.DELIVERED
        mark_delivered(db, ticket)
    else:
        child = revision_engine.request_changes(db, ticket, (body.comment or "").strip())

    log_audit(db, ticket.id, None, "Client approved" if body.decision == "approve" else "Client requested changes",
              {"proof_version": proof.version if proof else None, "comment": (body.comment or "").strip() or None},
              actor_label=f"{body.name.strip()} ({via})")
    db.commit()
    db.refresh(ticket)
    events.emit(db, "approval_decision", ticket, None, {"decision": new_status, "by": body.name.strip()})
    out = {"ok": True, "status": new_status}
    if child:
        db.refresh(child)
        revision_engine.announce(db, child)
        out["new_ticket"] = {"id": child.id, "ticket_number": child.ticket_number}
    return out


@router.post("/api/public/review/{token}/decision")
def public_review_decision(token: str, body: Decision, request: Request, db: Session = Depends(get_db)):
    _throttle(request, db)
    return _apply_decision(db, _load_request(db, token), body, "via review link")


# ── Audit trail ──────────────────────────────────────────────────────────────

@router.get("/api/tickets/{ticket_id}/audit")
def ticket_audit(ticket_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    get_ticket_for_user(db, ticket_id, user)
    rows = db.query(models.AuditLog).filter(models.AuditLog.ticket_id == ticket_id) \
        .order_by(models.AuditLog.timestamp.asc(), models.AuditLog.id.asc()).all()
    names = {u.id: u.full_name for u in db.query(models.User).filter(
        models.User.id.in_({r.changed_by_id for r in rows if r.changed_by_id} or {0})).all()}
    is_staff = user.role != models.RoleEnum.REQUESTER
    return [{
        "id": r.id, "action": r.action,
        "actor": r.actor_label or names.get(r.changed_by_id) or "System",
        "details": r.details if is_staff else {},  # Internal field-level details stay staff-only
        "timestamp": as_utc(r.timestamp).isoformat() if r.timestamp else None,
    } for r in rows]
