"""One conversation per request: comments, designs sent for review, client decisions and marked-up spots, in time order."""
from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

import models
from auth import get_current_user, get_ticket_for_user
from collab import _serialize
from common import as_utc
from database import get_db

router = APIRouter(tags=["thread"])


def proof_id_of(image_key: str):
    """Pins store which design they sit on as "proof:<id>"."""
    if image_key.startswith("proof:") and image_key[6:].isdigit():
        return int(image_key[6:])
    return None


@router.get("/api/tickets/{ticket_id}/thread")
def thread(ticket_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    ticket = get_ticket_for_user(db, ticket_id, user)

    comments = db.query(models.TicketComment).filter(models.TicketComment.ticket_id == ticket.id).all()
    proofs = {p.id: p for p in db.query(models.ProofVersion).filter(models.ProofVersion.ticket_id == ticket.id).all()}
    requests = db.query(models.ApprovalRequest).filter(models.ApprovalRequest.ticket_id == ticket.id).all()
    pins = db.query(models.PinpointComment).filter(models.PinpointComment.ticket_id == ticket.id).all()

    user_ids = {r.created_by_id for r in requests} | {p.author_id for p in pins}
    people = {u.id: u for u in db.query(models.User).filter(models.User.id.in_(user_ids or {0})).all()}

    items: List[dict] = []
    for c in _serialize(db, comments):
        items.append({"kind": "comment", "at": c["created_at"], **c})

    for r in requests:
        proof = proofs.get(r.proof_version_id)
        sender = people.get(r.created_by_id)
        items.append({"kind": "design_sent", "id": f"sent-{r.id}", "at": as_utc(r.created_at).isoformat() if r.created_at else None,
                      "by": sender.full_name if sender else "The design team", "version": proof.version if proof else None,
                      "request_id": r.id, "status": r.status})
        if r.status in ("approved", "changes_requested") and r.decided_at:
            items.append({"kind": "decision", "id": f"decision-{r.id}", "at": as_utc(r.decided_at).isoformat(),
                          "by": r.decided_by_name or "The client", "decision": r.status,
                          "version": proof.version if proof else None, "comment": r.decision_comment})

    for p in pins:
        author = people.get(p.author_id)
        proof = proofs.get(proof_id_of(p.image_url) or -1)
        items.append({"kind": "pin", "id": p.id, "at": as_utc(p.created_at).isoformat() if p.created_at else None,
                      "by": author.full_name if author else "Someone", "role": author.role.value if author else None,
                      "version": proof.version if proof else None, "content": p.content, "is_resolved": p.is_resolved,
                      "x_pct": p.x_pct, "y_pct": p.y_pct})

    order = {"design_sent": 0, "pin": 1, "comment": 2, "decision": 3}
    items.sort(key=lambda i: (i["at"] or "", order.get(i["kind"], 9)))
    return items
