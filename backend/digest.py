"""Daily digest: a per-person summary of open work, sent by email."""
import datetime
import html
import logging

import pytz
from sqlalchemy.orm import Session

import models
import delivery
from common import as_utc

logger = logging.getLogger(__name__)

OPEN_STATUSES = [
    models.TicketStatus.NEW, models.TicketStatus.ASSIGNED, models.TicketStatus.IN_PROGRESS,
    models.TicketStatus.WAITING_ON_REQUESTER, models.TicketStatus.IN_REVIEW,
]
IST = pytz.timezone("Asia/Kolkata")
DIGEST_HOUR_IST = 9


def build_digest(db: Session, user: models.User, now: datetime.datetime | None = None) -> dict:
    now = now or datetime.datetime.now(pytz.utc)
    q = db.query(models.Ticket).filter(models.Ticket.status.in_(OPEN_STATUSES))
    if user.role == models.RoleEnum.REQUESTER:
        q = q.filter(models.Ticket.client_org == user.client_org) if user.client_org else q.filter(models.Ticket.requester_id == user.id)
    elif user.role == models.RoleEnum.DESIGNER:
        q = q.filter(models.Ticket.assignee_id == user.id)
    tickets = q.all()

    overdue, due_soon, in_review, rest = [], [], [], []
    for t in tickets:
        due = as_utc(t.due_at)
        row = {"number": t.ticket_number, "title": t.title, "status": t.status.value,
               "due_at": due.isoformat() if due else None}
        if due and due < now:
            overdue.append(row)
        elif due and (due - now) <= datetime.timedelta(hours=24):
            due_soon.append(row)
        elif t.status == models.TicketStatus.IN_REVIEW:
            in_review.append(row)
        else:
            rest.append(row)
    return {
        "user": user.full_name,
        "date": now.astimezone(IST).strftime("%a %d %b %Y"),
        "overdue": overdue, "due_soon": due_soon, "in_review": in_review, "other_open": rest,
        "total_open": len(tickets),
    }


def render_digest(d: dict) -> tuple[str, str, str]:
    """Return (subject, plain text, html)."""
    sections = [("Overdue", d["overdue"]), ("Due in the next 24 hours", d["due_soon"]),
                ("Waiting for review", d["in_review"]), ("Other open work", d["other_open"])]
    subject = f"[DesignDesk] Your daily digest — {len(d['overdue'])} overdue, {len(d['due_soon'])} due soon"
    text_lines = [f"Hi {d['user']}, here is your DesignDesk summary for {d['date']}.", ""]
    html_parts = [f"<p>Hi {html.escape(d['user'])}, here is your DesignDesk summary for {html.escape(d['date'])}.</p>"]
    for title, rows in sections:
        if not rows:
            continue
        text_lines.append(f"{title} ({len(rows)})")
        html_parts.append(f"<h3>{html.escape(title)} ({len(rows)})</h3><ul>")
        for r in rows:
            text_lines.append(f"  - {r['number']}  {r['title']}  [{r['status']}]")
            html_parts.append(f"<li><b>{html.escape(r['number'])}</b> {html.escape(r['title'])} <i>({html.escape(r['status'])})</i></li>")
        text_lines.append("")
        html_parts.append("</ul>")
    if d["total_open"] == 0:
        text_lines.append("Nothing open. Enjoy the quiet.")
        html_parts.append("<p>Nothing open. Enjoy the quiet.</p>")
    return subject, "\n".join(text_lines), "".join(html_parts)


def send_digest_to(db: Session, user: models.User) -> tuple[bool, str]:
    subject, text, body_html = render_digest(build_digest(db, user))
    return delivery.send_email(user.email, subject, text, body_html)


def send_daily_digests(db: Session, now: datetime.datetime | None = None, force: bool = False) -> dict:
    """Send digests to opted-in users. Runs from the cron tick; guarded so each IST day sends at most once."""
    now = now or datetime.datetime.now(pytz.utc)
    ist_now = now.astimezone(IST)
    today = ist_now.date().isoformat()
    if not force:
        if ist_now.hour < DIGEST_HOUR_IST or delivery.get_setting(db, "last_digest_date") == today:
            return {"sent": 0, "skipped": "not due"}
    if not delivery.smtp_configured():
        return {"sent": 0, "skipped": "smtp not configured"}

    sent, failed = 0, 0
    # Claim the day first so overlapping ticks cannot double-send.
    delivery.set_setting(db, "last_digest_date", today)
    db.commit()
    users = (
        db.query(models.User)
        .join(models.UserPreference, models.UserPreference.user_id == models.User.id)
        .filter(models.UserPreference.digest_enabled == True, models.User.is_active == True)
        .all()
    )
    for user in users:
        ok, detail = send_digest_to(db, user)
        sent += ok
        failed += not ok
        if not ok:
            logger.warning("Digest to %s failed: %s", user.email, detail)
    return {"sent": sent, "failed": failed}
