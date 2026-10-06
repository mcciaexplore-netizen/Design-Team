"""Revision requests: reopen a ticket within the free allowance, otherwise supersede it with a versioned child."""
import datetime

import pytz
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

import events
import models
import revision_engine
import schemas
from auth import get_current_user, get_ticket_for_user
from common import assign_to_last_submitter, log_audit
from database import get_db

router = APIRouter(tags=["revisions"])


# --- Revisions ---
class RevisionRequest(BaseModel):
    reason_for_change: str

@router.post("/api/tickets/{ticket_id}/revisions", response_model=schemas.TicketResponse, status_code=status.HTTP_201_CREATED)
def request_revision(ticket_id: int, request: RevisionRequest, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Ask for changes. Within the free-revision allowance the same ticket is reopened; beyond it a V2 child ticket
    is opened and the original is closed as superseded. Either way the work goes back to whoever last submitted a proof."""
    parent = get_ticket_for_user(db, ticket_id, user)

    if parent.status not in [models.TicketStatus.DELIVERED, models.TicketStatus.IN_REVIEW]:
        raise HTTPException(status_code=400, detail="Can only request revisions on IN_REVIEW or DELIVERED tickets")

    settings = db.query(models.SystemSettings).first()
    free_left = parent.revision_count < (settings.max_free_revisions if settings else 2)

    if free_left and not parent.is_locked:
        revision_engine.request_changes(db, parent, request.reason_for_change)
        log_audit(db, parent.id, user, "Changes requested", {"reason": request.reason_for_change, "revision": parent.revision_count})
        db.commit()
        db.refresh(parent)
        events.emit(db, "ticket_moved", parent, user, {"to": parent.status.value})
        if parent.assignee_id:
            events.emit(db, "ticket_assigned", parent, user)
        return parent

    # Allowance used up (or ticket locked): the original is superseded by a new versioned ticket.
    base_number = parent.ticket_number.split('-V')[0]
    new_version = parent.version_number + 1

    tags = list(parent.tags) if parent.tags else []
    if parent.due_at:
        due_utc = parent.due_at if parent.due_at.tzinfo else parent.due_at.replace(tzinfo=pytz.utc)
        if (due_utc - datetime.datetime.now(pytz.utc)).total_seconds() < 12 * 3600:
            if "Last-Minute Change" not in tags:
                tags.append("Last-Minute Change")
            events.post_slack_event(db, "escalate", f":rotating_light: *Last-minute change* on {events.slack_escape(parent.ticket_number)} — {events.slack_escape(parent.title)} (due {parent.due_at:%d %b %H:%M})")

    parent.status = models.TicketStatus.REVISION_REQUESTED
    parent.is_locked = True
    parent.edit_window_ends_at = None

    child = models.Ticket(
        ticket_number=f"{base_number}-V{new_version}",
        title=parent.title,
        brief=parent.brief,
        design_type_id=parent.design_type_id,
        type_specific_fields=parent.type_specific_fields,
        priority=parent.priority,
        status=models.TicketStatus.NEW,
        requester_id=parent.requester_id,
        client_org=parent.client_org,
        parent_id=parent.id,
        version_number=new_version,
        reason_for_change=request.reason_for_change,
        tags=tags,
        figma_url=parent.figma_url,
        external_key=None,
    )
    db.add(child)
    db.flush()
    assign_to_last_submitter(db, parent)
    child.assignee_id = parent.assignee_id
    log_audit(db, parent.id, user, "Superseded", {"new_version": child.ticket_number, "reason": request.reason_for_change})
    log_audit(db, child.id, user, "Created", {"revision_of": parent.ticket_number})
    db.commit()
    db.refresh(child)
    events.emit(db, "ticket_created", child, user)
    if child.assignee_id:
        events.emit(db, "ticket_assigned", child, user)
    return child
