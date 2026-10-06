"""Management reports: SLA trends, per-client revision analytics, turnaround and hours, with CSV and PDF export."""
import csv
import datetime
import io
from collections import defaultdict
from typing import Dict, List, Optional
from xml.sax.saxutils import escape

import pytz
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

import models
from auth import require_lead
from common import as_utc, csv_safe
from database import get_db

router = APIRouter(prefix="/api/reports", tags=["reports"])
IST = pytz.timezone("Asia/Kolkata")
DONE = {models.TicketStatus.DELIVERED, models.TicketStatus.CLOSED, models.TicketStatus.CLOSED_WITHOUT_APPROVAL,
        models.TicketStatus.REVISION_REQUESTED}
UNASSIGNED_ORG = "(No organisation)"


def _range(date_from: Optional[datetime.date], date_to: Optional[datetime.date]):
    today = datetime.datetime.now(IST).date()
    end = date_to or today
    start = date_from or (end - datetime.timedelta(days=89))
    if start > end:
        raise HTTPException(status_code=422, detail="'from' must be on or before 'to'")
    if (end - start).days > 366:
        raise HTTPException(status_code=422, detail="Choose a range of one year or less")
    lo = IST.localize(datetime.datetime.combine(start, datetime.time.min)).astimezone(pytz.utc)
    hi = IST.localize(datetime.datetime.combine(end + datetime.timedelta(days=1), datetime.time.min)).astimezone(pytz.utc)
    return start, end, lo, hi


def _completed_at(t: models.Ticket) -> Optional[datetime.datetime]:
    if t.delivered_at:
        return as_utc(t.delivered_at)
    return as_utc(t.updated_at) if t.status in DONE and t.updated_at else None


def _week_start(d: datetime.datetime) -> datetime.date:
    local = as_utc(d).astimezone(IST).date()
    return local - datetime.timedelta(days=local.weekday())


def build_report(db: Session, date_from=None, date_to=None, client_org: Optional[str] = None) -> dict:
    start, end, lo, hi = _range(date_from, date_to)
    now = datetime.datetime.now(pytz.utc)
    q = db.query(models.Ticket).filter(models.Ticket.created_at >= lo, models.Ticket.created_at < hi)
    if client_org:
        q = q.filter(models.Ticket.client_org == client_org)
    tickets = q.all()
    ids = [t.id for t in tickets]

    hours_by_ticket: Dict[int, float] = defaultdict(float)
    if ids:
        for tid, secs in db.query(models.TimeEntry.ticket_id, models.TimeEntry.seconds).filter(
                models.TimeEntry.ticket_id.in_(ids), models.TimeEntry.ended_at != None).all():
            hours_by_ticket[tid] += secs / 3600
    # Tickets with tracked time from before entries existed
    for t in tickets:
        hours_by_ticket[t.id] = max(hours_by_ticket[t.id], (t.time_spent_seconds or 0) / 3600)

    # Revisions: counter on the ticket plus child (V2, V3...) tickets raised from it.
    children = defaultdict(int)
    for (parent_id,) in db.query(models.Ticket.parent_id).filter(models.Ticket.parent_id.in_(ids or [0])).all():
        children[parent_id] += 1

    def revisions_of(t: models.Ticket) -> int:
        return (t.revision_count or 0) + children.get(t.id, 0)

    weeks: Dict[datetime.date, dict] = defaultdict(lambda: {"due": 0, "on_time": 0, "late": 0, "overdue_open": 0})
    clients: Dict[str, dict] = defaultdict(lambda: {"tickets": 0, "revisions": 0, "with_3plus": 0, "delivered": 0, "on_time": 0,
                                                    "turnaround_hours": [], "hours_logged": 0.0})
    types: Dict[str, dict] = defaultdict(lambda: {"tickets": 0, "revisions": 0, "delivered": 0, "on_time": 0,
                                                  "turnaround_hours": [], "hours_logged": 0.0})
    categories: Dict[str, int] = defaultdict(int)
    delivered_total = on_time_total = 0
    turnarounds: List[float] = []

    for t in tickets:
        org = t.client_org or UNASSIGNED_ORG
        c = clients[org]
        c["tickets"] += 1
        c["hours_logged"] += hours_by_ticket[t.id]
        if t.parent_id is None:
            rev = revisions_of(t)
            c["revisions"] += rev
            c["with_3plus"] += rev >= 3
        if t.revision_category:
            categories[t.revision_category] += 1
        ty = types[t.design_type.name if t.design_type else "(Unknown)"]
        ty["tickets"] += 1
        ty["hours_logged"] += hours_by_ticket[t.id]
        if t.parent_id is None:
            ty["revisions"] += revisions_of(t)

        done_at, due = _completed_at(t), as_utc(t.due_at)
        if done_at:
            c["delivered"] += 1
            ty["delivered"] += 1
            delivered_total += 1
            hrs = (done_at - as_utc(t.created_at)).total_seconds() / 3600
            c["turnaround_hours"].append(hrs)
            ty["turnaround_hours"].append(hrs)
            turnarounds.append(hrs)
        if due:
            w = weeks[_week_start(due)]
            w["due"] += 1
            if done_at:
                if done_at <= due:
                    w["on_time"] += 1
                    c["on_time"] += 1
                    ty["on_time"] += 1
                    on_time_total += 1
                else:
                    w["late"] += 1
            elif due < now:
                w["overdue_open"] += 1

    def pct(a, b):
        return round(a / b * 100, 1) if b else None

    originals = [t for t in tickets if t.parent_id is None]
    total_revs = sum(revisions_of(t) for t in originals)
    return {
        "range": {"from": start.isoformat(), "to": end.isoformat(), "client_org": client_org},
        "kpis": {
            "tickets_created": len(tickets),
            "tickets_delivered": delivered_total,
            "on_time_rate_pct": pct(on_time_total, sum(1 for t in tickets if _completed_at(t) and t.due_at)),
            "avg_turnaround_hours": round(sum(turnarounds) / len(turnarounds), 1) if turnarounds else None,
            "avg_revisions_per_ticket": round(total_revs / len(originals), 2) if originals else None,
            "hours_logged": round(sum(hours_by_ticket.values()), 1),
        },
        "sla_trend": [
            {"week_start": wk.isoformat(), **v, "on_time_rate_pct": pct(v["on_time"], v["on_time"] + v["late"])}
            for wk, v in sorted(weeks.items())
        ],
        "by_client": sorted([
            {"client": org, "tickets": c["tickets"], "revisions": c["revisions"],
             "avg_revisions": round(c["revisions"] / max(1, c["tickets"]), 2), "tickets_with_3plus_revisions": c["with_3plus"],
             "delivered": c["delivered"], "on_time_rate_pct": pct(c["on_time"], c["delivered"]),
             "avg_turnaround_hours": round(sum(c["turnaround_hours"]) / len(c["turnaround_hours"]), 1) if c["turnaround_hours"] else None,
             "hours_logged": round(c["hours_logged"], 1)}
            for org, c in clients.items()
        ], key=lambda r: (-r["revisions"], r["client"])),
        "by_design_type": sorted([
            {"design_type": name, "tickets": v["tickets"], "revisions": v["revisions"],
             "avg_revisions": round(v["revisions"] / max(1, v["tickets"]), 2), "delivered": v["delivered"],
             "on_time_rate_pct": pct(v["on_time"], v["delivered"]),
             "avg_turnaround_hours": round(sum(v["turnaround_hours"]) / len(v["turnaround_hours"]), 1) if v["turnaround_hours"] else None,
             "hours_logged": round(v["hours_logged"], 1)}
            for name, v in types.items()
        ], key=lambda r: (-r["tickets"], r["design_type"])),
        "revision_categories": sorted([{"category": k, "count": v} for k, v in categories.items()], key=lambda r: -r["count"]),
        "_tickets": tickets, "_hours": hours_by_ticket, "_revs": revisions_of, "_done": _completed_at,
    }


def _public(report: dict) -> dict:
    return {k: v for k, v in report.items() if not k.startswith("_")}


@router.get("/summary")
def summary(date_from: Optional[datetime.date] = Query(default=None, alias="from"),
            date_to: Optional[datetime.date] = Query(default=None, alias="to"),
            client_org: Optional[str] = Query(default=None, max_length=80),
            db: Session = Depends(get_db), _user: models.User = Depends(require_lead)):
    return _public(build_report(db, date_from, date_to, client_org))


@router.get("/clients")
def client_orgs(db: Session = Depends(get_db), _user: models.User = Depends(require_lead)):
    rows = db.query(models.Ticket.client_org).filter(models.Ticket.client_org != None).distinct().order_by(models.Ticket.client_org).all()
    return [r[0] for r in rows]


def _csv_response(name: str, header: List[str], rows: List[list]) -> Response:
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(header)
    w.writerows(rows)
    return Response(content=out.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{name}.csv"'})


@router.get("/export.csv")
def export_csv(report: str = Query(default="tickets", pattern="^(tickets|sla|clients|design_types)$"),
               date_from: Optional[datetime.date] = Query(default=None, alias="from"),
               date_to: Optional[datetime.date] = Query(default=None, alias="to"),
               client_org: Optional[str] = Query(default=None, max_length=80),
               db: Session = Depends(get_db), _user: models.User = Depends(require_lead)):
    r = build_report(db, date_from, date_to, client_org)
    name = f"designdesk_{report}_{r['range']['from']}_{r['range']['to']}"
    if report == "sla":
        return _csv_response(name, ["Week starting", "Due", "On time", "Late", "Overdue & open", "On-time rate %"],
                             [[w["week_start"], w["due"], w["on_time"], w["late"], w["overdue_open"], w["on_time_rate_pct"] if w["on_time_rate_pct"] is not None else ""] for w in r["sla_trend"]])
    if report == "design_types":
        return _csv_response(name, ["Design type", "Tickets", "Revisions", "Avg revisions", "Delivered", "On-time rate %",
                                    "Avg turnaround (h)", "Hours logged"],
                             [[csv_safe(d["design_type"]), d["tickets"], d["revisions"], d["avg_revisions"], d["delivered"],
                               d["on_time_rate_pct"] if d["on_time_rate_pct"] is not None else "",
                               d["avg_turnaround_hours"] if d["avg_turnaround_hours"] is not None else "", d["hours_logged"]] for d in r["by_design_type"]])
    if report == "clients":
        return _csv_response(name, ["Client", "Tickets", "Revisions", "Avg revisions", "Tickets with 3+ revisions", "Delivered",
                                    "On-time rate %", "Avg turnaround (h)", "Hours logged"],
                             [[csv_safe(c["client"]), c["tickets"], c["revisions"], c["avg_revisions"], c["tickets_with_3plus_revisions"], c["delivered"],
                               c["on_time_rate_pct"] if c["on_time_rate_pct"] is not None else "",
                               c["avg_turnaround_hours"] if c["avg_turnaround_hours"] is not None else "", c["hours_logged"]] for c in r["by_client"]])
    rows = []
    for t in sorted(r["_tickets"], key=lambda x: x.id):
        done, due = r["_done"](t), as_utc(t.due_at)
        rows.append([t.ticket_number, csv_safe(t.title), csv_safe(t.client_org or ""), t.status.value, t.priority.value,
                     csv_safe(t.assignee.full_name if t.assignee else ""), as_utc(t.created_at).astimezone(IST).strftime("%Y-%m-%d"),
                     due.astimezone(IST).strftime("%Y-%m-%d %H:%M") if due else "",
                     done.astimezone(IST).strftime("%Y-%m-%d %H:%M") if done else "",
                     ("yes" if done <= due else "no") if (done and due) else "", r["_revs"](t), round(r["_hours"][t.id], 2)])
    return _csv_response(name, ["Ticket", "Title", "Client", "Status", "Priority", "Assignee", "Created", "Due", "Delivered",
                                "On time", "Revisions", "Hours logged"], rows)


@router.get("/export.pdf")
def export_pdf(date_from: Optional[datetime.date] = Query(default=None, alias="from"),
               date_to: Optional[datetime.date] = Query(default=None, alias="to"),
               client_org: Optional[str] = Query(default=None, max_length=80),
               db: Session = Depends(get_db), _user: models.User = Depends(require_lead)):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    r = _public(build_report(db, date_from, date_to, client_org))
    styles = getSampleStyleSheet()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm, topMargin=15 * mm, bottomMargin=15 * mm,
                            title="DesignDesk report")

    def table(header, rows):
        head = [Paragraph(f"<b>{escape(str(h))}</b>", styles["BodyText"]) for h in header]
        body = [[Paragraph(escape(str("" if v is None else v)), styles["BodyText"]) for v in row] for row in rows]
        t = Table([head] + body, repeatRows=1)
        t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e8eef7")),
                               ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#cbd5e1")), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
        return t

    rng = r["range"]
    k = r["kpis"]
    fmt = lambda v, suffix="": "n/a" if v is None else f"{v}{suffix}"
    story = [
        Paragraph("DesignDesk performance report", styles["Title"]),
        Paragraph(escape(f"{rng['from']} to {rng['to']}" + (f" • client: {rng['client_org']}" if rng["client_org"] else "")), styles["Normal"]),
        Spacer(1, 8 * mm),
        table(["Tickets created", "Delivered", "On-time rate", "Avg turnaround", "Avg revisions / ticket", "Hours logged"],
              [[k["tickets_created"], k["tickets_delivered"], fmt(k["on_time_rate_pct"], "%"), fmt(k["avg_turnaround_hours"], " h"),
                fmt(k["avg_revisions_per_ticket"]), k["hours_logged"]]]),
        Spacer(1, 6 * mm), Paragraph("SLA trend by week", styles["Heading2"]),
        table(["Week starting", "Due", "On time", "Late", "Overdue & open", "On-time %"],
              [[w["week_start"], w["due"], w["on_time"], w["late"], w["overdue_open"], fmt(w["on_time_rate_pct"])] for w in r["sla_trend"]]),
        Spacer(1, 6 * mm), Paragraph("Revisions and turnaround by client", styles["Heading2"]),
        table(["Client", "Tickets", "Revisions", "Avg rev.", "3+ rev.", "On-time %", "Avg turnaround (h)", "Hours"],
              [[c["client"], c["tickets"], c["revisions"], c["avg_revisions"], c["tickets_with_3plus_revisions"], fmt(c["on_time_rate_pct"]),
                fmt(c["avg_turnaround_hours"]), c["hours_logged"]] for c in r["by_client"]]),
    ]
    doc.build(story)
    return Response(content=buf.getvalue(), media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="designdesk_report_{rng["from"]}_{rng["to"]}.pdf"'})
