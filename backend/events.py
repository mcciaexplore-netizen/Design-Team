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
    "client_changes": "Changes from the client are added to my ticket",
    "approval_requested": "A design is sent to me for review",
    "approval_decision": "A client approves or requests changes",
    "ticket_created": "A new ticket is created (leads)",
    "sla_breach": "A ticket breaches its SLA",
}


def slack_escape(text: str) -> str:
    """Slack treats &, < and > specially; escaping stops user text from injecting @channel pings or links."""
    return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


# What the design team is also emailed about (clients get their own emails: confirmation, review links, reminders).
STAFF_EMAIL_EVENTS = {"ticket_assigned", "client_changes", "approval_decision", "sla_breach", "ticket_created"}


def ticket_details(ticket: models.Ticket) -> str:
    """The ticket at a glance for the team's emails: number, who asked, priority, due date, assignee, and the brief
    (which, for form requests, already lists the event, the designs and the requested delivery date)."""
    import pytz
    from common import as_utc
    requester = ticket.requester
    who = f"{requester.full_name} <{requester.email}>" if requester else "Unknown"
    org = ticket.client_org or (requester.client_org if requester else None)
    due = as_utc(ticket.due_at).astimezone(pytz.timezone("Asia/Kolkata")).strftime("%d %b %Y, %I:%M %p IST") if ticket.due_at else None
    lines = [
        f"Ticket: {ticket.ticket_number}",
        f"Title: {ticket.title}",
        f"Requested by: {who}" + (f" ({org})" if org else ""),
        f"Priority: {ticket.priority.value}",
        f"Status: {ticket.status.value}",
        f"Due: {due}" if due else None,
        f"Assigned to: {ticket.assignee.full_name if ticket.assignee else 'Not assigned yet'}",
        "",
        "Brief:",
        (ticket.brief or "").strip()[:3000] or "(none)",
    ]
    return "\n".join(line for line in lines if line is not None)


def email_staff(db: Session, user: models.User, content: str, ticket: Optional[models.Ticket] = None,
                prefs: Optional[models.UserPreference] = None, details: Optional[str] = None) -> None:
    """Email a team member (designer or lead) at their account address, unless they turned email off or email
    isn't set up. Clients are never emailed from here. `details` (e.g. ticket_details) goes under the message."""
    from common import app_url
    if user.role == models.RoleEnum.REQUESTER or not user.is_active or not delivery.email_configured():
        return
    if prefs is None:
        prefs = db.query(models.UserPreference).filter(models.UserPreference.user_id == user.id).first()
    if prefs is not None and not prefs.email_enabled:
        return
    link = f"{app_url()}/tickets/{ticket.id}" if ticket else app_url()
    extra = f"\n\n{details}" if details else ""
    body = (f"Hi {user.full_name.split(' ')[0]},\n\n{content}{extra}\n\nOpen it in DesignDesk: {link}\n\n"
            "You get these emails because you are on the design team. Turn them off on your My Dashboard page.\n")
    subject = f"DesignDesk: {content}"[:150].replace("\n", " ")
    delivery.run_in_background(delivery.send_email, user.email, subject, body)


def notify(db: Session, user: models.User, content: str, event: str, ticket: Optional[models.Ticket] = None,
           details: Optional[str] = None) -> None:
    """Deliver one notification to one user according to their preferences: in the app, and by email for the
    team's important events (with `details` added to the email only). Caller commits."""
    prefs = db.query(models.UserPreference).filter(models.UserPreference.user_id == user.id).first()
    if prefs and event in (prefs.muted_events or []):
        return
    if prefs is None or prefs.in_app_enabled:
        db.add(models.Notification(user_id=user.id, content=content, type=event, ticket_id=ticket.id if ticket else None))
    if event in STAFF_EMAIL_EVENTS:
        email_staff(db, user, content, ticket, prefs, details)


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
    elif event == "sla_breach":
        realtime.publish({"type": "sla_breach", **base}, ticket)
    elif event in ("ticket_assigned", "approval_decision", "approval_requested"):
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
            # Name who asked for it: a public form request has no signed-in actor, which used to read "Someone created".
            asked_by = ticket.requester.full_name if ticket.requester else actor_name
            msg = f"New request {ref} from {asked_by}" if not actor or actor_id == ticket.requester_id \
                else f"{actor_name} created {ref} for {asked_by}"
            details = ticket_details(ticket)
            for lead in _leads(db):
                if lead.id != actor_id:
                    notify(db, lead, msg, event, ticket, details)
            post_slack_event(db, "new", f":inbox_tray: *New ticket* {slack_escape(ref)} ({ticket.priority.value}) from {slack_escape(asked_by)}")

        elif event == "ticket_assigned":
            if ticket.assignee and ticket.assignee.id != actor_id:
                who = f"{ref} was assigned to you" if extra.get("auto") else f"{actor_name} assigned you {ref}"
                details = f"A ticket was raised and you are assigned to it.\n\n{ticket_details(ticket)}"
                notify(db, ticket.assignee, who, event, ticket, details)

        elif event == "ticket_moved":
            to = extra.get("to", ticket.status.value)
            if ticket.requester and ticket.requester.id != actor_id and to in ("In Review", "Delivered", "Closed"):
                notify(db, ticket.requester, f"{ref} moved to {to}", event, ticket)

        elif event == "approval_requested":
            if ticket.requester and ticket.requester.id != actor_id:
                version = extra.get("version", 1)
                if version > 1:
                    notify(db, ticket.requester, f"{actor_name} finished the changes on {ref}: version {version} is ready for your review", event, ticket)
                else:
                    notify(db, ticket.requester, f"{actor_name} sent a design for your review: {ref}", event, ticket)

        elif event == "approval_decision":
            verb = "approved" if extra.get("decision") == "approved" else "requested changes on"
            msg = f"{extra.get('by', 'Client')} {verb} {ref}"
            targets = {u.id: u for u in _leads(db)}
            if ticket.assignee:
                targets[ticket.assignee.id] = ticket.assignee
            for user in targets.values():
                notify(db, user, msg, event, ticket)
            post_slack_event(db, "escalate" if extra.get("decision") != "approved" else "new", f":white_check_mark: {slack_escape(msg)}")

        elif event == "sla_breach":
            msg = f"SLA breached: {ref}"
            for lead in _leads(db):
                notify(db, lead, msg, event, ticket)
            post_slack_event(db, "breach", f":warning: *SLA breach* {slack_escape(ref)}")

        db.commit()
    except Exception:
        logger.exception("Failed to dispatch event %s", event)
        db.rollback()
