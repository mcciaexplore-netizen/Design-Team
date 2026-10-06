"""Public design request form: anyone can submit it and a ticket is created and assigned automatically."""
import datetime
import json
import os
import re
from typing import Optional
from urllib.parse import urlparse

import pytz
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy.orm import Session

import auth
import capacity_engine
import delivery
import events
import models
import ratelimit
from auth import get_current_user
from common import MAX_UPLOAD_BYTES, compute_due_at, log_audit, next_ticket_number, read_upload, store_bytes
from database import get_db
from tracking import tracking_url

router = APIRouter(tags=["request-form"])

OTHER = "Other"
IST = pytz.timezone("Asia/Kolkata")

# Form choice -> (design type name, SLA hours, effort hours). Missing design types are created on first use.
REQUIREMENTS = {
    "Flyer (Email/Whatsapp)": ("Flyer", 24, 3),
    "Social Media Post (Insta, LinkedIn, Twitter)": ("Social Post", 48, 3),
    "Flex/Banner/Standee": ("Banner", 24, 4),
    "Digital Backdrop & Slides": ("Digital Backdrop & Slides", 48, 6),
    "Directory": ("Directory", 96, 16),
    "2 pages Brochure": ("Brochure", 72, 8),
    "4 pages Brochure": ("Brochure", 96, 12),
    "Photo/Video/Reel": ("Photo/Video/Reel", 72, 8),
    OTHER: ("Other", 48, 4),
}

MAX_FILES = 5
MAX_REFERENCE_LINKS = 5
MAX_LINK_LENGTH = 500
MAX_ANSWER_LENGTH = 200


def _q(id: str, label: str, type: str = "text", options: Optional[list] = None, required: bool = False) -> dict:
    return {"id": id, "label": label, "type": type, "options": options or [], "required": required}


# Extra questions per design requirement. The form renders whatever is listed here, and answers are stored
# in type_specific_fields["details"] by question id. type is "text", "select", "multiselect" or "number".
QUESTIONS = {
    "Flyer (Email/Whatsapp)": [
        _q("size", "Size", "select", ["A4", "A5", "Square", "Custom"], required=True),
        _q("custom_size", "Custom size (if Custom)"),
        _q("channel", "Where will it be shared?", "select", ["Email", "WhatsApp", "Print"], required=True),
    ],
    "Social Media Post (Insta, LinkedIn, Twitter)": [
        _q("platforms", "Platforms", "multiselect", ["Instagram", "LinkedIn", "Twitter"], required=True),
        _q("size", "Size", "select", ["Square (1:1)", "Portrait (4:5)", "Landscape (16:9)", "Story (9:16)"]),
    ],
    "Flex/Banner/Standee": [
        _q("size", "Size (width x height)", required=True),
        _q("medium", "Print or digital?", "select", ["Print", "Digital"], required=True),
        _q("quantity", "Quantity", "number"),
    ],
    "Digital Backdrop & Slides": [
        _q("slides", "Number of slides", "number", required=True),
        _q("aspect_ratio", "Aspect ratio", "select", ["16:9", "4:3"], required=True),
    ],
    "Directory": [
        _q("pages", "Number of pages", "number", required=True),
        _q("content_ready", "Is the content ready?", "select", ["Yes, all of it", "Partly", "No"], required=True),
    ],
    "2 pages Brochure": [
        _q("copy", "Copy", "select", ["Copy provided", "Needs writing"], required=True),
        _q("language", "Language", required=True),
    ],
    "4 pages Brochure": [
        _q("copy", "Copy", "select", ["Copy provided", "Needs writing"], required=True),
        _q("language", "Language", required=True),
    ],
    "Photo/Video/Reel": [
        _q("duration", "Duration (if video or reel)"),
        _q("platform", "Platform"),
        _q("shoot", "Shoot date and location"),
    ],
    OTHER: [],
}

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# Unauthenticated endpoint, so cap submissions per client address (stored in the database, shared by all instances).
RATE_LIMIT, RATE_WINDOW = 5, 3600


def priority_for(delivery_date: datetime.date) -> models.TicketPriority:
    """Priority follows how soon the creative is needed: the form never asks for it."""
    days = (delivery_date - datetime.date.today()).days
    if days <= 1:
        return models.TicketPriority.URGENT
    if days <= 3:
        return models.TicketPriority.HIGH
    if days <= 10:
        return models.TicketPriority.NORMAL
    return models.TicketPriority.LOW


def clean_details(requirement: str, raw: str) -> dict:
    """Validate the per-type answers (a JSON object keyed by question id). Returns only known, non-empty answers."""
    try:
        sent = json.loads(raw) if raw.strip() else {}
    except ValueError:
        sent = None
    if not isinstance(sent, dict):
        raise HTTPException(status_code=422, detail="The extra details could not be read")
    answers = {}
    for q in QUESTIONS.get(requirement, []):
        label, value = q["label"], sent.get(q["id"])
        if q["type"] == "multiselect":
            value = value if isinstance(value, list) else []
            if any(v not in q["options"] for v in value):
                raise HTTPException(status_code=422, detail=f"{label}: please choose from the list")
        else:
            value = "" if value is None else str(value).strip()
            if value and q["type"] == "select" and value not in q["options"]:
                raise HTTPException(status_code=422, detail=f"{label}: please choose from the list")
            if value and q["type"] == "number":
                try:
                    number = float(value)
                except ValueError:
                    raise HTTPException(status_code=422, detail=f"{label} must be a number")
                if not 0 < number < 100000:
                    raise HTTPException(status_code=422, detail=f"{label} must be a number above 0")
                value = int(number) if number == int(number) else number
            elif len(value) > MAX_ANSWER_LENGTH:
                raise HTTPException(status_code=422, detail=f"{label} is too long")
        if value in ("", []):
            if q["required"]:
                raise HTTPException(status_code=422, detail=f"{label} is required")
            continue
        answers[q["id"]] = value
    return answers


def clean_links(raw: str) -> list:
    """Reference links: a JSON list of up to 5 https:// URLs. Blank rows are ignored."""
    try:
        sent = json.loads(raw) if raw.strip() else []
    except ValueError:
        sent = None
    if not isinstance(sent, list):
        raise HTTPException(status_code=422, detail="The reference links could not be read")
    links = [str(x).strip() for x in sent if str(x).strip()]
    if len(links) > MAX_REFERENCE_LINKS:
        raise HTTPException(status_code=422, detail=f"Reference links: add at most {MAX_REFERENCE_LINKS}")
    for link in links:
        if len(link) > MAX_LINK_LENGTH:
            raise HTTPException(status_code=422, detail=f"Reference links: a link is longer than {MAX_LINK_LENGTH} characters")
        if not link.startswith("https://") or not urlparse(link).netloc or re.search(r"\s", link):
            raise HTTPException(status_code=422, detail=f"Reference links: {link[:60]} must be a valid https:// link")
    return links


def _design_type(db: Session, option: str) -> models.DesignType:
    name, sla, effort = REQUIREMENTS[option]
    dt = db.query(models.DesignType).filter(models.DesignType.name == name).first()
    if not dt:
        dt = models.DesignType(name=name, default_sla_hours=sla, default_effort_hours=effort, required_fields=[], is_active=True)
        db.add(dt)
        db.flush()
    return dt


def _requester(db: Session, name: str, email: str) -> models.User:
    """The person's account if they have one; otherwise a login-less client account an admin can later enable."""
    user = db.query(models.User).filter(models.User.email == email).first()
    if user:
        return user
    user = models.User(email=email, full_name=name, role=models.RoleEnum.REQUESTER,
                       hashed_password=auth.hash_password(auth.generate_temp_password()), must_change_password=True)
    db.add(user)
    db.flush()
    return user


class RequestFields:
    """The design-request fields shared by the public form and the signed-in portal form."""

    def __init__(
        self,
        event_name: str = Form(..., min_length=1, max_length=200),
        event_date: datetime.date = Form(...),
        design_requirement: str = Form(...),
        delivery_date: datetime.date = Form(...),
        num_creatives: int = Form(default=1, ge=1, le=100),
        other_details: str = Form(default="", max_length=1000),
        content: str = Form(default="", max_length=5000),
        details: str = Form(default="", max_length=5000),          # JSON object: answers to the per-type questions
        reference_links: str = Form(default="", max_length=5000),  # JSON list of https:// links
        file: Optional[UploadFile] = File(default=None),           # the older single-file field
        files: list[UploadFile] = File(default=[]),
    ):
        self.event_name, self.event_date, self.design_requirement = event_name.strip(), event_date, design_requirement
        self.delivery_date, self.num_creatives = delivery_date, num_creatives
        self.other_details, self.content = other_details.strip(), content.strip()
        self.raw_details, self.raw_links = details, reference_links
        self.files = [f for f in [file, *files] if f is not None and f.filename]
        self.details: dict = {}
        self.links: list = []

    async def validated_uploads(self) -> list:
        """Check the fields and files before anything is created. Returns a list of (data, name, content_type)."""
        if self.design_requirement not in REQUIREMENTS:
            raise HTTPException(status_code=422, detail="Please choose a design requirement")
        if self.design_requirement == OTHER and not self.other_details:
            raise HTTPException(status_code=422, detail="Please describe the design you need")
        if self.delivery_date < datetime.date.today():
            raise HTTPException(status_code=422, detail="Expected delivery date cannot be in the past")
        self.details = clean_details(self.design_requirement, self.raw_details)
        self.links = clean_links(self.raw_links)
        if len(self.files) > MAX_FILES:
            raise HTTPException(status_code=422, detail=f"You can attach up to {MAX_FILES} files")
        return [await read_upload(f) for f in self.files]


def create_ticket_from_form(db: Session, requester: models.User, f: RequestFields, uploads: list, via: str) -> models.Ticket:
    """Create, auto-assign and announce a ticket from the request form fields."""
    design_type = _design_type(db, f.design_requirement)
    label = f.other_details if f.design_requirement == OTHER else f.design_requirement

    due_at = datetime.datetime.combine(f.delivery_date, datetime.time(12, 30), tzinfo=pytz.utc)  # 18:00 IST
    priority = priority_for(f.delivery_date)
    fields = {
        "requester_name": requester.full_name, "requester_email": requester.email, "event_name": f.event_name,
        "event_date": f.event_date.isoformat(), "design_requirement": f.design_requirement,
        "expected_delivery_date": f.delivery_date.isoformat(), "number_of_creatives": f.num_creatives,
        "other_details": f.other_details or None, "content": f.content or None,
        "details": f.details, "reference_links": f.links,
    }
    labels = {q["id"]: q["label"] for q in QUESTIONS[f.design_requirement]}
    detail_lines = [f"{labels[k]}: {', '.join(v) if isinstance(v, list) else v}" for k, v in f.details.items()]
    brief = "\n".join(filter(None, [
        f"Event: {f.event_name} ({f.event_date:%d %b %Y})",
        f"Requirement: {label}",
        *detail_lines,
        f"Creatives needed: {f.num_creatives}",
        f"Expected delivery: {f.delivery_date:%d %b %Y}",
        f"Requested by: {requester.full_name} <{requester.email}>",
        "\nReference links:\n" + "\n".join(f"- {u}" for u in f.links) if f.links else None,
        f"\nContent / notes:\n{f.content}" if f.content else None,
    ]))

    ticket = models.Ticket(
        ticket_number=next_ticket_number(db),
        title=f"{f.event_name} - {label}"[:200],
        brief=brief,
        design_type_id=design_type.id,
        type_specific_fields=fields,
        priority=priority,
        requester_id=requester.id,
        client_org=requester.client_org,
        due_at=due_at,
        tags=["request-form"],
    )
    designer = capacity_engine.suggest_assignee(db, design_type.id)
    if designer:
        ticket.assignee_id = designer.id
        ticket.status = models.TicketStatus.ASSIGNED
    db.add(ticket)
    db.flush()
    log_audit(db, ticket.id, None, "Created", {"via": via, "event": f.event_name},
              actor_label=f"{requester.full_name} ({via})")
    for data, fname, ctype in uploads:
        db.add(models.Attachment(ticket_id=ticket.id, file_name=fname, file_url=store_bytes(data, fname.rsplit(".", 1)[-1].lower()),
                                 content_type=ctype, size_bytes=len(data), uploaded_by_id=requester.id))
    db.commit()
    db.refresh(ticket)

    events.emit(db, "ticket_created", ticket, requester if via == "portal form" else None)
    if designer:
        events.emit(db, "ticket_assigned", ticket, None, {"auto": True})
    _send_confirmation(requester, ticket, f)
    return ticket


def _send_confirmation(requester: models.User, ticket: models.Ticket, f: "RequestFields") -> None:
    """Email the requester their ticket number and a link to follow progress (only if SMTP is configured)."""
    if not delivery.email_configured():
        return
    body = "\n".join([
        f"Hi {requester.full_name},",
        "",
        f'We have received your design request for "{f.event_name}".',
        "",
        f"Ticket number: {ticket.ticket_number}",
        f"Expected delivery: {f.delivery_date:%d %b %Y}",
        "",
        "Follow its progress any time, no login needed:",
        tracking_url(ticket.ticket_number),
        "",
        "MCCIA Applied AI Studio",
    ])
    delivery.run_in_background(delivery.send_email, requester.email, f"Design request received: {ticket.ticket_number}", body)


@router.get("/api/public/request-form")
def form_options():
    return {"design_requirements": list(REQUIREMENTS), "other_label": OTHER, "max_upload_mb": MAX_UPLOAD_BYTES // (1024 * 1024),
            "max_files": MAX_FILES, "max_reference_links": MAX_REFERENCE_LINKS, "questions": QUESTIONS,
            "turnstile_site_key": os.getenv("TURNSTILE_SITE_KEY") if delivery.turnstile_enabled() else None}


@router.get("/api/public/request-form/estimate")
def estimate(design_requirement: str, delivery_date: Optional[datetime.date] = None, db: Session = Depends(get_db)):
    """When this kind of request is normally ready, and whether (and how urgently) the requested date beats that."""
    if design_requirement not in REQUIREMENTS:
        raise HTTPException(status_code=422, detail="Please choose a design requirement")
    name, sla, _ = REQUIREMENTS[design_requirement]
    # A throwaway design type, so an estimate never creates database rows.
    ready = compute_due_at(db, models.DesignType(name=name, default_sla_hours=sla), models.TicketPriority.NORMAL)
    ready_on = ready.astimezone(IST).date()
    out = {"standard_ready_by": ready_on.isoformat(), "rush": False, "priority": None}
    if delivery_date:
        out["rush"] = delivery_date < ready_on
        out["priority"] = priority_for(delivery_date).value
    return out


@router.post("/api/public/requests", status_code=201)
async def submit_request(
    request: Request,
    fields: RequestFields = Depends(),
    name: str = Form(..., min_length=1, max_length=120),
    email: str = Form(..., max_length=254),
    website: str = Form(default=""),  # honeypot: real people never see or fill this
    captcha: str = Form(default="", alias="cf-turnstile-response"),
    db: Session = Depends(get_db),
):
    if website:
        return {"ticket_number": None, "message": "Request received."}
    ip = ratelimit.client_ip(request)
    ratelimit.check(db, f"request-form:{ip}", RATE_LIMIT, RATE_WINDOW, "Too many requests from your network. Please try again later.")
    if delivery.turnstile_enabled() and not delivery.verify_turnstile(captcha, ip):
        raise HTTPException(status_code=400, detail="Please complete the verification check and try again.")
    name, email = name.strip(), email.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(status_code=422, detail="Please enter a valid email address")
    uploads = await fields.validated_uploads()
    ticket = create_ticket_from_form(db, _requester(db, name, email), fields, uploads, "request form")
    return {"ticket_number": ticket.ticket_number, "tracking_url": tracking_url(ticket.ticket_number),
            "message": "Request received. The design team has been notified."}


@router.post("/api/requests", status_code=201)
async def submit_portal_request(fields: RequestFields = Depends(), db: Session = Depends(get_db),
                                user: models.User = Depends(get_current_user)):
    """The same form for signed-in users (the portal's New Request dialog)."""
    uploads = await fields.validated_uploads()
    ticket = create_ticket_from_form(db, user, fields, uploads, "portal form")
    return {"id": ticket.id, "ticket_number": ticket.ticket_number}
