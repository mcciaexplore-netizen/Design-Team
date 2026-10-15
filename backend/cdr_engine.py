import os
import models
from sqlalchemy.orm import Session
from notifications import notify_user

# S3 client for presigned download URLs, made on first use (importing boto3 slows every cold start).
s3_client = None
BUCKET_NAME = os.getenv('S3_BUCKET_NAME', 'designflow')   # the same bucket as every other upload (common.store_bytes)

def create_cdr_request(db: Session, requester_id: int, ticket_id: int = None, library_item_id: int = None):
    req = models.CdrRequest(
        requester_id=requester_id,
        ticket_id=ticket_id,
        library_item_id=library_item_id,
        status=models.CdrRequestStatus.REQUESTED
    )
    db.add(req)
    db.commit()
    db.refresh(req)
    
    # Notify Lead or Assignee
    # In a real app we'd fetch the assignee or lead object.
    # notify_user(db, lead, "New CDR Request!", "CDR_REQUESTED", ticket_id)
    
    return req

def approve_cdr_request(db: Session, request_id: int, approver_id: int):
    req = db.query(models.CdrRequest).filter_by(id=request_id).first()
    if req and req.status == models.CdrRequestStatus.REQUESTED:
        req.status = models.CdrRequestStatus.APPROVED
        req.approver_id = approver_id
        db.commit()
        # notify_user(db, requester, "CDR Request Approved. Waiting for upload.", "CDR_APPROVED", req.ticket_id)
        return req
    return None

def upload_cdr(db: Session, request_id: int, s3_object_key: str, preview_url: str):
    req = db.query(models.CdrRequest).filter_by(id=request_id).first()
    if req and req.status == models.CdrRequestStatus.APPROVED:
        req.status = models.CdrRequestStatus.UPLOADED
        req.s3_object_key = s3_object_key
        req.preview_url = preview_url
        db.commit()
        # notify_user(db, requester, "CDR File is ready for download!", "CDR_UPLOADED", req.ticket_id)
        return req
    return None

def generate_download_link(db: Session, request_id: int, user_id: int):
    req = db.query(models.CdrRequest).filter_by(id=request_id).first()
    if req and req.status == models.CdrRequestStatus.UPLOADED:
        # Generate presigned URL valid for 1 hour (3600s)
        from common import _s3
        client = s3_client or _s3()
        url = client.generate_presigned_url(
            'get_object',
            Params={'Bucket': BUCKET_NAME, 'Key': req.s3_object_key},
            ExpiresIn=3600
        )
        
        # Log the download for audit
        log = models.CdrDownloadLog(
            cdr_request_id=req.id,
            user_id=user_id
        )
        db.add(log)
        db.commit()
        
        return url
    return None


def decline_cdr_request(db: Session, request_id: int, approver_id: int):
    req = db.query(models.CdrRequest).filter_by(id=request_id).first()
    if req and req.status == models.CdrRequestStatus.REQUESTED:
        req.status = models.CdrRequestStatus.DECLINED
        req.approver_id = approver_id
        db.commit()
        return req
    return None


def record_download(db: Session, req: models.CdrRequest, user_id: int) -> None:
    """Audit one download. The file itself is streamed by the API, so no presigned link is involved."""
    db.add(models.CdrDownloadLog(cdr_request_id=req.id, user_id=user_id))
    db.commit()
