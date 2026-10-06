"""Two-way Jira sync.

Outbound: a DesignDesk ticket's status change is mirrored onto its linked Jira issue as a workflow transition.
Inbound: a Jira webhook for an issue labelled "DesignNeeded" creates a DesignDesk ticket linked to that issue.

Configure with JIRA_BASE_URL (https://your-domain.atlassian.net), JIRA_EMAIL and JIRA_API_TOKEN for outbound
sync, and JIRA_WEBHOOK_SECRET for inbound. Anything not configured is skipped quietly.
"""
import logging
import os
import re
from typing import Optional

import httpx
from sqlalchemy.orm import Session

import events
import models
from common import compute_due_at, log_audit, mark_delivered, next_ticket_number, track_waiting

logger = logging.getLogger(__name__)

ISSUE_KEY_RE = re.compile(r"^[A-Z][A-Z0-9_]*-\d+$")

# DesignDesk status -> Jira transition / target-status names to try, in order (matched case-insensitively).
STATUS_TO_JIRA = {
    "New": ["To Do", "Open", "Backlog"],
    "Assigned": ["To Do", "Open"],
    "In Progress": ["In Progress"],
    "Waiting on Requester": ["Waiting for customer", "Waiting for support", "Waiting"],
    "In Review": ["In Review", "Review"],
    "Delivered": ["Done", "Resolved"],
    "Closed": ["Done", "Closed", "Resolved"],
    "Closed without approval": ["Done", "Closed", "Won't Do"],
}


# Jira status names (lower case) -> the DesignDesk status they mean when Jira moves an issue.
JIRA_TO_STATUS = {
    "in progress": models.TicketStatus.IN_PROGRESS,
    "in review": models.TicketStatus.IN_REVIEW, "review": models.TicketStatus.IN_REVIEW,
    "waiting for customer": models.TicketStatus.WAITING_ON_REQUESTER, "waiting for support": models.TicketStatus.WAITING_ON_REQUESTER,
    "waiting": models.TicketStatus.WAITING_ON_REQUESTER,
    "done": models.TicketStatus.DELIVERED, "resolved": models.TicketStatus.DELIVERED, "closed": models.TicketStatus.DELIVERED,
    "to do": models.TicketStatus.ASSIGNED, "open": models.TicketStatus.ASSIGNED, "backlog": models.TicketStatus.ASSIGNED,
}


def _config() -> Optional[tuple[str, tuple[str, str]]]:
    base = os.getenv("JIRA_BASE_URL", "").rstrip("/")
    email, token = os.getenv("JIRA_EMAIL", ""), os.getenv("JIRA_API_TOKEN", "")
    if not (base.startswith("https://") and email and token):
        return None
    return base, (email, token)


def push_status_to_jira(issue_key: str, status: str) -> bool:
    """Move the linked Jira issue to the workflow state matching `status`. Never raises; returns True if moved."""
    cfg = _config()
    if not cfg or not ISSUE_KEY_RE.match(issue_key or ""):
        return False
    base, auth = cfg
    wanted = [n.lower() for n in STATUS_TO_JIRA.get(status, [])]
    if not wanted:
        return False
    try:
        with httpx.Client(auth=auth, timeout=8.0, headers={"Accept": "application/json"}) as client:
            res = client.get(f"{base}/rest/api/3/issue/{issue_key}/transitions")
            res.raise_for_status()
            transitions = res.json().get("transitions", [])
            for name in wanted:
                for t in transitions:
                    if name in (str(t.get("name", "")).lower(), str((t.get("to") or {}).get("name", "")).lower()):
                        client.post(f"{base}/rest/api/3/issue/{issue_key}/transitions",
                                    json={"transition": {"id": t["id"]}}).raise_for_status()
                        logger.info("Moved Jira %s to '%s'", issue_key, t.get("name"))
                        return True
        logger.info("Jira %s has no transition matching %s", issue_key, wanted)
    except (httpx.HTTPError, ValueError, KeyError):
        logger.exception("Could not sync %s to Jira", issue_key)
    return False


def _adf_text(node) -> str:
    """Jira Cloud descriptions are Atlassian Document Format trees; flatten one to plain text."""
    if isinstance(node, str):
        return node
    if isinstance(node, dict):
        if node.get("type") == "text":
            return node.get("text", "")
        sep = "\n" if node.get("type") in ("paragraph", "heading", "listItem") else ""
        return sep.join(filter(None, (_adf_text(c) for c in node.get("content", []))))
    if isinstance(node, list):
        return "\n".join(filter(None, (_adf_text(c) for c in node)))
    return ""


def _incoming_status_name(payload: dict, fields: dict) -> Optional[str]:
    """The Jira status the issue just moved to: from the changelog if present, else the issue's current status."""
    for item in (payload.get("changelog") or {}).get("items", []):
        if str(item.get("field", "")).lower() == "status" and item.get("toString"):
            return str(item["toString"])
    if str(payload.get("webhookEvent", "")).endswith("issue_updated"):
        return str((fields.get("status") or {}).get("name") or "") or None
    return None


def _sync_status_from_jira(db: Session, ticket: models.Ticket, jira_status: str) -> dict:
    """Apply a Jira workflow move to the linked ticket. Skipped if DesignDesk already maps to that Jira state,
    so the two systems don't echo each other's changes."""
    name = jira_status.strip().lower()
    new = JIRA_TO_STATUS.get(name)
    if new is None or new == ticket.status:
        return {"status": "unchanged", "ticket": ticket.ticket_number}
    if name in [n.lower() for n in STATUS_TO_JIRA.get(ticket.status.value, [])]:
        return {"status": "unchanged", "ticket": ticket.ticket_number}
    if ticket.is_locked:
        return {"status": "ignored", "ticket": ticket.ticket_number}

    old = ticket.status
    ticket.status = new
    track_waiting(ticket, old, new)
    if new == models.TicketStatus.DELIVERED:
        mark_delivered(db, ticket)
    else:
        ticket.edit_window_ends_at = None
    log_audit(db, ticket.id, None, "Updated", {"status": {"from": old.value, "to": new.value}}, actor_label="Jira")
    db.commit()
    db.refresh(ticket)
    events.emit(db, "ticket_moved", ticket, None, {"to": new.value})
    return {"status": "synced", "ticket": ticket.ticket_number, "to": new.value}


def handle_incoming_jira_webhook(payload: dict, db: Session) -> dict:
    """Jira -> DesignDesk. A new issue labelled DesignNeeded becomes a ticket (once); later status moves on a
    linked issue update that ticket."""
    issue = payload.get("issue") or {}
    fields = issue.get("fields") or {}
    key = str(issue.get("key", ""))
    if not ISSUE_KEY_RE.match(key):
        return {"status": "ignored"}

    existing = db.query(models.Ticket).filter(models.Ticket.external_key == key).first()
    if existing:
        jira_status = _incoming_status_name(payload, fields)
        if jira_status:
            return _sync_status_from_jira(db, existing, jira_status)
        return {"status": "exists", "ticket": existing.ticket_number}
    if "DesignNeeded" not in (fields.get("labels") or []):
        return {"status": "ignored"}

    owner = db.query(models.User).filter(
        models.User.role.in_([models.RoleEnum.DESIGN_LEAD, models.RoleEnum.ADMIN]),
        models.User.is_active == True,
    ).order_by(models.User.id).first()
    design_type = db.query(models.DesignType).filter(models.DesignType.is_active == True).order_by(models.DesignType.id).first()
    if not owner or not design_type:
        logger.warning("Jira webhook for %s ignored: no active lead or design type", key)
        return {"status": "ignored"}

    ticket = models.Ticket(
        ticket_number=next_ticket_number(db),
        title=str(fields.get("summary") or f"Jira {key}")[:200],
        brief=_adf_text(fields.get("description")).strip() or f"Imported from Jira {key}.",
        design_type_id=design_type.id,
        type_specific_fields={},
        requester_id=owner.id,
        external_key=key,
        tags=["jira"],
        due_at=compute_due_at(db, design_type, models.TicketPriority.NORMAL),
    )
    db.add(ticket)
    db.flush()
    db.add(models.AuditLog(ticket_id=ticket.id, changed_by_id=None, actor_label="Jira",
                           action="Created", details={"jira_issue": key}))
    db.commit()
    db.refresh(ticket)
    events.emit(db, "ticket_created", ticket, None)
    logger.info("Created %s from Jira issue %s", ticket.ticket_number, key)
    return {"status": "created", "ticket": ticket.ticket_number}
