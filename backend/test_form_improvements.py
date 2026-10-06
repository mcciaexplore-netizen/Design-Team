"""Request form: per-type questions, several files, reference links, due-date estimate."""
import datetime
import json

import models
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
    size = next(q for q in o["questions"]["Flyer (Email/Whatsapp)"] if q["id"] == "size")
    assert size["type"] == "select" and size["required"] and "A4" in size["options"]


def test_required_per_type_answers_are_enforced_and_stored(client):
    assert post(client, details="").status_code == 422
    assert post(client, details=json.dumps({"size": "A9", "channel": "Email"})).status_code == 422
    assert post(client, details="not json").status_code == 422
    answers = {"size": "Custom", "custom_size": "10x10 cm", "channel": "WhatsApp", "ignored": "x"}
    r = post(client, details=json.dumps(answers), content="Blue theme")
    assert r.status_code == 201, r.text
    t = ticket(r.json()["ticket_number"])
    assert t.type_specific_fields["details"] == {"size": "Custom", "custom_size": "10x10 cm", "channel": "WhatsApp"}
    assert t.type_specific_fields["content"] == "Blue theme"
    assert "Size: Custom" in t.brief and "Where will it be shared?: WhatsApp" in t.brief


def test_multiselect_and_number_questions(client):
    social = "Social Media Post (Insta, LinkedIn, Twitter)"
    assert post(client, design_requirement=social, details=json.dumps({"platforms": []})).status_code == 422
    assert post(client, design_requirement=social, details=json.dumps({"platforms": ["MySpace"]})).status_code == 422
    r = post(client, design_requirement=social, details=json.dumps({"platforms": ["Instagram", "LinkedIn"]}))
    assert r.status_code == 201
    assert ticket(r.json()["ticket_number"]).type_specific_fields["details"]["platforms"] == ["Instagram", "LinkedIn"]
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
    r = client.get("/api/public/request-form/estimate", params={"design_requirement": "Directory", "delivery_date": far})
    assert r.status_code == 200, r.text
    body = r.json()
    ready = datetime.date.fromisoformat(body["standard_ready_by"])
    assert ready > today and body["rush"] is False and body["priority"] == "Low"
    soon = client.get("/api/public/request-form/estimate",
                      params={"design_requirement": "Directory", "delivery_date": today.isoformat()}).json()
    assert soon["rush"] is True and soon["priority"] == "Urgent"
    assert client.get("/api/public/request-form/estimate", params={"design_requirement": "Directory"}).json()["rush"] is False
    assert client.get("/api/public/request-form/estimate", params={"design_requirement": "Nope"}).status_code == 422
    db = TestingSessionLocal()
    assert db.query(models.DesignType).filter_by(name="Directory").count() == 0   # an estimate creates nothing
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
