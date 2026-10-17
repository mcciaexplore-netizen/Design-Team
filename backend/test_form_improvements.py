"""Request form: per-type questions, several files, reference links, due-date estimate."""
import datetime
import json

import models
import request_form
from test_auth import TestingSessionLocal, auth, client  # noqa: F401
from test_workflow_features import PNG, clear_hits, form, isolated  # noqa: F401


def post(client, **over):
    return client.post("/api/public/requests", data=form(**over))


def ticket(number):
    db = TestingSessionLocal()
    try:
        t = db.query(models.Ticket).filter_by(ticket_number=number).one()
        db.expunge(t)
        return t
    finally:
        db.close()


def test_options_list_questions_and_limits(client):
    o = client.get("/api/public/request-form").json()
    assert o["max_files"] == 5 and o["max_reference_links"] == 5
    assert set(o["questions"]) == set(o["design_requirements"]) and o["questions"]["Other"] == []
    size = next(q for q in o["questions"]["Flyer (Email / Print)"] if q["id"] == "size")
    assert size["type"] == "select" and size["required"] and "A4" in size["options"]


def test_required_per_type_answers_are_enforced_and_stored(client):
    assert post(client, details="").status_code == 422
    assert post(client, details=json.dumps({"size": "A9", "channel": "Email"})).status_code == 422
    assert post(client, details="not json").status_code == 422
    answers = {"size": "Custom", "custom_size": "10x10 cm", "channel": "Print", "ignored": "x"}
    r = post(client, details=json.dumps(answers), content="Blue theme")
    assert r.status_code == 201, r.text
    t = ticket(r.json()["ticket_number"])
    assert t.type_specific_fields["details"] == {"size": "Custom", "custom_size": "10x10 cm", "channel": "Print"}
    assert t.type_specific_fields["content"] == "Blue theme"
    assert "Size: Custom" in t.brief and "Where will it be shared?: Print" in t.brief


def test_multiselect_and_number_questions(client, monkeypatch):
    # No built-in choice uses a multi-select today, so exercise that question type with a temporary one.
    monkeypatch.setitem(request_form.QUESTIONS, "Other", [request_form._q("tags", "Tags", "multiselect", ["a", "b"], required=True)])
    other = {"design_requirement": "Other", "other_details": "A mascot"}
    assert post(client, **other, details=json.dumps({"tags": []})).status_code == 422
    assert post(client, **other, details=json.dumps({"tags": ["zzz"]})).status_code == 422
    r = post(client, **other, details=json.dumps({"tags": ["a", "b"]}))
    assert r.status_code == 201
    assert ticket(r.json()["ticket_number"]).type_specific_fields["details"]["tags"] == ["a", "b"]
    slides = "Digital Backdrop & Slides"
    assert post(client, design_requirement=slides, details=json.dumps({"slides": "abc", "aspect_ratio": "16:9"})).status_code == 422
    r = post(client, design_requirement=slides, details=json.dumps({"slides": "12", "aspect_ratio": "16:9"}))
    assert ticket(r.json()["ticket_number"]).type_specific_fields["details"]["slides"] == 12


def test_several_files_become_attachments_and_the_limit_holds(client):
    files = [("files", (f"p{i}.png", PNG, "image/png")) for i in range(3)]
    r = client.post("/api/public/requests", data=form(), files=files + [("file", ("old.png", PNG, "image/png"))])
    assert r.status_code == 201, r.text
    db = TestingSessionLocal()
    t = db.query(models.Ticket).filter_by(ticket_number=r.json()["ticket_number"]).one()
    assert db.query(models.Attachment).filter_by(ticket_id=t.id).count() == 4
    db.close()
    clear_hits()
    too_many = [("files", (f"p{i}.png", PNG, "image/png")) for i in range(6)]
    r = client.post("/api/public/requests", data=form(), files=too_many)
    assert r.status_code == 422 and "5 files" in r.json()["detail"]
    bad = client.post("/api/public/requests", data=form(), files=[("files", ("ok.png", PNG, "image/png")), ("files", ("x.exe", b"MZ", "application/octet-stream"))])
    assert bad.status_code == 415


def test_reference_links_must_be_https_and_are_stored(client):
    for bad in (["http://insecure.example.com"], ["ftp://x.example.com"], ["https://"], ["https://a b.example.com"],
                [f"https://example.com/{'a' * 600}"], [f"https://example.com/{i}" for i in range(6)]):
        clear_hits()   # the public form allows only 5 submissions an hour
        assert post(client, reference_links=json.dumps(bad)).status_code == 422, bad
    clear_hits()
    links = ["https://www.canva.com/design/abc", "https://drive.google.com/file/d/1", ""]
    r = post(client, reference_links=json.dumps(links))
    assert r.status_code == 201, r.text
    t = ticket(r.json()["ticket_number"])
    assert t.type_specific_fields["reference_links"] == links[:2]
    assert "Reference links:" in t.brief and "- https://www.canva.com/design/abc" in t.brief


def test_estimate_reports_standard_date_rush_and_priority(client):
    today = datetime.date.today()
    far = (today + datetime.timedelta(days=60)).isoformat()
    r = client.get("/api/public/request-form/estimate", params={"design_requirement": "Book", "delivery_date": far})
    assert r.status_code == 200, r.text
    body = r.json()
    ready = datetime.date.fromisoformat(body["standard_ready_by"])
    assert ready > today and body["rush"] is False and body["priority"] == "Low"
    soon = client.get("/api/public/request-form/estimate",
                      params={"design_requirement": "Book", "delivery_date": today.isoformat()}).json()
    assert soon["rush"] is True and soon["priority"] == "Urgent"
    assert client.get("/api/public/request-form/estimate", params={"design_requirement": "Book"}).json()["rush"] is False
    assert client.get("/api/public/request-form/estimate", params={"design_requirement": "Nope"}).status_code == 422
    db = TestingSessionLocal()
    assert db.query(models.DesignType).filter_by(name="Book").count() == 0   # an estimate creates nothing
    db.close()


def test_portal_request_stores_details_and_links(client):
    d = (datetime.date.today() + datetime.timedelta(days=9)).isoformat()
    data = {"event_name": "Summit", "event_date": "2030-02-01", "design_requirement": "Flex/Banner/Standee", "delivery_date": d,
            "details": json.dumps({"size": "6x3 ft", "medium": "Print", "quantity": "2"}),
            "reference_links": json.dumps(["https://www.figma.com/file/x"])}
    r = client.post("/api/requests", data=data, files=[("files", ("a.png", PNG, "image/png"))], headers=auth(client, "a@tata.com"))
    assert r.status_code == 201, r.text
    db = TestingSessionLocal()
    t = db.query(models.Ticket).get(r.json()["id"])
    assert t.type_specific_fields["details"]["quantity"] == 2 and t.type_specific_fields["reference_links"] == ["https://www.figma.com/file/x"]
    db.close()
    missing = dict(data, details=json.dumps({"medium": "Print"}))
    assert client.post("/api/requests", data=missing, headers=auth(client, "a@tata.com")).status_code == 422


# ── One choice per channel ───────────────────────────────────────────────────

def test_whatsapp_instagram_and_linkedin_are_separate_choices_with_their_own_questions(client):
    o = client.get("/api/public/request-form").json()
    choices = o["design_requirements"]
    for name in ("Flyer (Email / Print)", "WhatsApp creative", "Instagram post", "LinkedIn post", "Twitter / X post"):
        assert name in choices
    assert "Flyer (Email/Whatsapp)" not in choices and not any("Insta, LinkedIn" in c for c in choices)   # no more bundles
    for c in ("WhatsApp creative", "Instagram post", "LinkedIn post", "Twitter / X post"):   # free text, not a fixed list
        q = next(q for q in o["questions"][c] if q["id"] == "format")
        assert (q["label"], q["type"], q["required"]) == ("Format details", "text", False)


def test_each_channel_creates_its_own_design_type(client):
    seen = {}
    for choice, details in (("WhatsApp creative", {"format": "Status (9:16)"}), ("Instagram post", {"format": "Carousel"}),
                            ("LinkedIn post", {"format": "Single image (1:1)"})):
        clear_hits()
        r = post(client, design_requirement=choice, details=json.dumps(details))
        assert r.status_code == 201, (choice, r.text)
        t = ticket(r.json()["ticket_number"])
        db = TestingSessionLocal()
        seen[choice] = db.query(models.DesignType).filter_by(id=t.design_type_id).one().name
        db.close()
        assert t.title.endswith(choice) and t.type_specific_fields["details"] == details
    assert seen == {"WhatsApp creative": "WhatsApp Creative", "Instagram post": "Instagram Post", "LinkedIn post": "LinkedIn Post"}


def test_a_choice_must_match_its_own_questions_and_old_bundled_names_are_rejected(client):
    assert post(client, design_requirement="Instagram post", details=json.dumps({})).status_code == 201                     # format is optional
    assert post(client, design_requirement="Instagram post", details=json.dumps({"format": "Story, 9:16, with a swipe-up"})).status_code == 201   # any wording
    assert post(client, design_requirement="Flyer (Email / Print)", details=json.dumps({"size": "A4", "channel": "WhatsApp"})).status_code == 422
    assert post(client, design_requirement="Flyer (Email/Whatsapp)").status_code == 422
    assert post(client, design_requirement="Social Media Post (Insta, LinkedIn, Twitter)").status_code == 422


# ── Several designs in one request ───────────────────────────────────────────

FLYER, INSTA, OTHER = "Flyer (Email / Print)", "Instagram post", "Other"


def test_ticking_several_designs_creates_one_ticket_each(client, monkeypatch):
    sent = []
    monkeypatch.setenv("SMTP_HOST", "smtp.example.com")
    monkeypatch.setattr(request_form.delivery, "send_email", lambda to, subject, body: sent.append((to, subject, body)) or (True, "Sent"))
    details = {FLYER: {"size": "A4", "channel": "Print"}, INSTA: {"format": "Story (9:16)"}, OTHER: {}}
    data = form(details=json.dumps(details), other_details="A mascot")
    data["design_requirement"] = [FLYER, INSTA, OTHER, FLYER]   # a repeat is ignored
    r = client.post("/api/public/requests", data=data, files=[("files", ("brief.png", PNG, "image/png"))])
    assert r.status_code == 201, r.text
    out = r.json()["tickets"]
    assert [t["design"] for t in out] == [FLYER, INSTA, "A mascot"]
    assert r.json()["ticket_number"] == out[0]["ticket_number"]

    flyer, insta, other = (ticket(t["ticket_number"]) for t in out)
    assert flyer.type_specific_fields["details"] == {"size": "A4", "channel": "Print"}
    assert insta.type_specific_fields["details"] == {"format": "Story (9:16)"} and insta.title == "AI Workshop - Instagram post"
    assert other.type_specific_fields["other_details"] == "A mascot" and flyer.type_specific_fields["other_details"] is None
    assert flyer.design_type_id != insta.design_type_id
    assert f"- {insta.ticket_number}: Instagram post" in flyer.brief and flyer.ticket_number not in flyer.brief.split("also asked for")[1]

    db = TestingSessionLocal()
    atts = db.query(models.Attachment).filter(models.Attachment.ticket_id.in_([flyer.id, insta.id, other.id])).all()
    db.close()
    assert len(atts) == 3 and len({a.file_url for a in atts}) == 1   # one stored file, attached to each ticket

    to_client = [m for m in sent if m[0] == "meera@example.com"]   # the team is emailed separately
    assert len(to_client) == 1 and all(t["ticket_number"] in to_client[0][2] for t in out)   # one confirmation listing all


def test_each_design_must_answer_its_own_required_questions(client):
    data = form(details=json.dumps({FLYER: {"size": "A4", "channel": "Print"}, "Book": {"content_ready": "Partly"}}))
    data["design_requirement"] = [FLYER, "Book"]
    r = client.post("/api/public/requests", data=data)
    assert r.status_code == 422 and r.json()["detail"] == "Book – Number of pages is required"
    flat = form(details=json.dumps({"size": "A4", "channel": "Print"}))   # ungrouped answers only fit one design
    flat["design_requirement"] = [FLYER, INSTA]
    assert client.post("/api/public/requests", data=flat).status_code == 422
    db = TestingSessionLocal()
    assert db.query(models.Ticket).count() == 0   # nothing half-created
    db.close()


def test_portal_request_with_several_designs(client):
    data = form(details=json.dumps({FLYER: {"size": "A5", "channel": "Email"}, INSTA: {"format": "Carousel"}}))
    data["design_requirement"] = [FLYER, INSTA]
    del data["name"], data["email"]
    r = client.post("/api/requests", data=data, headers=auth(client, "a@tata.com"))
    assert r.status_code == 201, r.text
    assert len(r.json()["tickets"]) == 2 and r.json()["id"] == r.json()["tickets"][0]["id"]


def test_estimate_for_several_designs_uses_the_slowest(client):
    soon = (datetime.date.today() + datetime.timedelta(days=2)).isoformat()
    one = client.get("/api/public/request-form/estimate", params={"design_requirement": FLYER}).json()
    both = client.get("/api/public/request-form/estimate", params=[("design_requirement", FLYER), ("design_requirement", "Book"),
                                                                   ("delivery_date", soon)]).json()
    assert both["standard_ready_by"] > one["standard_ready_by"] and both["rush"] is True
