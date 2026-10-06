"""Revision requests: asking for changes opens the next version of the ticket (V2, V3, ...)."""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

import models
import revision_engine
import schemas
from auth import get_current_user, get_ticket_for_user
from common import log_audit
from database import get_db

router = APIRouter(tags=["revisions"])


# --- Revisions ---
class RevisionRequest(BaseModel):
    reason_for_change: str

@router.post("/api/tickets/{ticket_id}/revisions", response_model=schemas.TicketResponse, status_code=status.HTTP_201_CREATED)
def request_revision(ticket_id: int, request: RevisionRequest, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Ask for changes. The current version is closed as superseded and the next one (V2, V3, ...) is opened and
    sent to whoever last submitted a proof. Returns the new ticket."""
    ticket = get_ticket_for_user(db, ticket_id, user)

    if ticket.status not in [models.TicketStatus.DELIVERED, models.TicketStatus.IN_REVIEW]:
        raise HTTPException(status_code=400, detail="Can only request revisions on IN_REVIEW or DELIVERED tickets")
    if ticket.is_locked:
        raise HTTPException(status_code=409, detail="This request is closed. Please raise a new request.")

    child = revision_engine.request_changes(db, ticket, request.reason_for_change)
    log_audit(db, ticket.id, user, "Changes requested", {"reason": request.reason_for_change, "new_version": child.ticket_number})
    db.commit()
    db.refresh(child)
    revision_engine.announce(db, child, user)
    return child
