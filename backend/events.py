"""Turns application events into in-app notifications and Slack posts, honouring each user's preferences."""
import logging
from typing import Optional

from sqlalchemy.orm import Session

import models
import delivery
import realtime

logger = logging.getLogger(__name__)

# Events users can mute individually (shown in the preferences UI).
EVENT_LABELS = {
    "ticket_assigned": "A ticket is assigned to me",
    "ticket_moved": "A ticket I raised changes stage",
    "comment_added": "Someone comments on my ticket",
    "mention": "I am @mentioned",
    "approval_decision": "A client approves or requests changes",
    "ticket_created": "A new ticket is created (leads)",
    "sla_breach": "A ticket breaches its SLA",
}


def slack_escape(text: str) -> str:
    """Slack treats &, < and > specially; escaping stops user text from injecting @channel pings or links."""
    return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def notify(db: Session, user: models.User, content: str, event: str) -> None:
    """Deliver one notification to one user according to their preferences. Caller commits."""
    prefs = db.query(models.UserPreference).filter(models.UserPreference.user_id == user.id).first()
    if prefs and event in (prefs.muted_events or []):
        return
    if prefs is None or prefs.in_app_enabled:
        db.add(models.Notification(user_id=user.id, content=content, type=event))


def post_slack_event(db: Session, kind: str, text: str) -> None:
    """Post to the shared Slack channel if configured and this kind of event is enabled."""
    cfg = delivery.get_integrations(db)
    if not cfg["slack_webhook"] or not cfg["slack_events"].get(kind, False):
        return
    delivery.run_in_background(delivery.send_slack, cfg["slack_webhook"], text, cfg["slack_channel"])


def _leads(db: Session):
    return db.query(models.User).filter(
        models.User.role.in_([models.RoleEnum.DESIGN_LEAD, models.RoleEnum.ADMIN]),
        models.User.is_active == True,
    ).all()


def _broadcast(event: str, ticket: models.Ticket, actor_name: str, extra: dict) -> None:
    """Tell connected browsers something changed (they refresh and may show a toast)."""
    base = {"ticketNumber": ticket.ticket_number, "title": ticket.title, "by": actor_name}
    if event == "ticket_created":
        realtime.publish({"type": "ticket_created", **base}, ticket)
    elif event == "ticket_moved":
        realtime.publish({"type": "ticket_moved", "to": extra.get("to", ticket.status.value), **base}, ticket)
    elif event in ("comment_added", "mention"):
        realtime.publish({"type": "comment_added", **base}, ticket)
    elif event == "sla_breach":
        realtime.publish({"type": "sla_breach", **base}, ticket)
    elif event in ("ticket_assigned", "approval_decision"):
        realtime.publish({"type": "ticket_updated", **base}, ticket)


def emit(db: Session, event: str, ticket: models.Ticket, actor: Optional[models.User] = None,
         extra: Optional[dict] = None) -> None:
    extra = extra or {}
    actor_id = actor.id if actor else None
    actor_name = actor.full_name if actor else "Someone"
    ref = f"{ticket.ticket_number} — {ticket.title}"
    _broadcast(event, ticket, actor_name, extra)
    try:
        if event == "ticket_created":
            for lead in _leads(db):
                if lead.id != actor_id:
                    notify(db, lead, f"{actor_name} created {ref}", event)
            post_slack_event(db, "new", f":inbox_tray: *New ticket* {slack_escape(ref)} ({ticket.priority.value}) from {slack_escape(actor_name)}")

        elif event == "ticket_assigned":
            if ticket.assignee and ticket.assignee.id != actor_id:
                notify(db, ticket.assignee, f"{actor_name} assigned you {ref}", event)

        elif event == "ticket_moved":
            to = extra.get("to", ticket.status.value)
            if ticket.requester and ticket.requester.id != actor_id and to in ("In Review", "Delivered", "Closed"):
                notify(db, ticket.requester, f"{ref} moved to {to}", event)

        elif event == "comment_added":
            for person in {ticket.assignee, ticket.requester}:
                if person and person.id != actor_id:
                    notify(db, person, f"{actor_name} commented on {ref}: {extra.get('excerpt', '')}", event)

        elif event == "mention":
            for user in extra.get("users", []):
                if user.id != actor_id:
                    notify(db, user, f"{actor_name} mentioned you on {ref}: {extra.get('excerpt', '')}", "mention")

        elif event == "approval_decision":
            verb = "approved" if extra.get("decision") == "approved" else "requested changes on"
            msg = f"{extra.get('by', 'Client')} {verb} {ref}"
            targets = {u.id: u for u in _leads(db)}
            if ticket.assignee:
                targets[ticket.assignee.id] = ticket.assignee
            for user in targets.values():
                notify(db, user, msg, event)
            post_slack_event(db, "escalate" if extra.get("decision") != "approved" else "new", f":white_check_mark: {slack_escape(msg)}")

        elif event == "sla_breach":
            msg = f"SLA breached: {ref}"
            for lead in _leads(db):
                notify(db, lead, msg, event)
            post_slack_event(db, "breach", f":warning: *SLA breach* {slack_escape(ref)}")

        db.commit()
    except Exception:
        logger.exception("Failed to dispatch event %s", event)
        db.rollback()
