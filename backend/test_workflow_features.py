"""Auto-close window, revisions, public request form, source-file (CDR) flow and Jira sync."""
import datetime
import json
import shutil
import tempfile

import pytest
import pytz

import delivery
import integrations
import models
import request_form
from test_auth import TestingSessionLocal, auth, client, make_ticket  # noqa: F401

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    path = tempfile.mkdtemp(prefix="dd-uploads-")
    monkeypatch.setenv("UPLOAD_DIR", path)
    monkeypatch.delenv("S3_ENDPOINT_URL", raising=False)
    monkeypatch.setattr(delivery, "run_in_background", lambda fn, *a: fn(*a))
    yield
    shutil.rmtree(path, ignore_errors=True)


def clear_hits():
    db = TestingSessionLocal()
    db.query(models.RateLimitHit).delete()
    db.commit()
    db.close()


def set_status(client, tid, status, email="lead@x.com"):
    r = client.patch(f"/api/tickets/{tid}", json={"status": status}, headers=auth(client, email))
    assert r.status_code == 200, r.text
    return r.json()


def db_ticket(tid):
    db = TestingSessionLocal()
    try:
        t = db.query(models.Ticket).filter_by(id=tid).first()
        db.expunge(t)
        return t
    finally:
        db.close()


def upload_proof(client, tid, email="des@x.com"):
    r = client.post(f"/api/tickets/{tid}/proofs", files={"file": ("v.png", PNG, "image/png")}, headers=auth(client, email))
    assert r.status_code == 201, r.text


def tick(client):
    return client.post("/internal/tick", headers={"X-Cron-Secret": "default_secret"})


# ── Auto-close ───────────────────────────────────────────────────────────────

def test_delivering_opens_the_edit_window_and_the_tick_closes_it(client):
    t = make_ticket(client, "a@tata.com")
    set_status(client, t["id"], "Delivered")
    ends = db_ticket(t["id"]).edit_window_ends_at
    assert ends is not None

    assert tick(client).status_code == 200
    assert db_ticket(t["id"]).status == models.TicketStatus.DELIVERED   # window still open

    db = TestingSessionLocal()
    db.query(models.Ticket).filter_by(id=t["id"]).update({"edit_window_ends_at": datetime.datetime.now(pytz.utc) - datetime.timedelta(hours=1)})
    db.commit()
    db.close()
    assert tick(client).status_code == 200
    closed = db_ticket(t["id"])
    assert closed.status == models.TicketStatus.CLOSED_WITHOUT_APPROVAL and closed.is_locked


def test_leaving_delivered_clears_the_window(client):
    t = make_ticket(client, "a@tata.com")
    set_status(client, t["id"], "Delivered")
    set_status(client, t["id"], "In Progress")
    assert db_ticket(t["id"]).edit_window_ends_at is None


# ── Revisions ────────────────────────────────────────────────────────────────

def test_changes_open_the_next_version_for_the_last_proof_submitter(client):
    t = make_ticket(client, "a@tata.com")
    upload_proof(client, t["id"])
    set_status(client, t["id"], "Delivered")
    r = client.post(f"/api/tickets/{t['id']}/revisions", json={"reason_for_change": "Bigger logo"}, headers=auth(client, "a@tata.com"))
    assert r.status_code == 201, r.text
    v2 = r.json()
    assert v2["id"] != t["id"] and v2["ticket_number"] == f"{t['ticket_number']}-V2" and v2["version_number"] == 2
    assert v2["parent_id"] == t["id"] and v2["reason_for_change"] == "Bigger logo"
    assert v2["status"] == "Assigned" and v2["assignee"]["email"] == "des@x.com"       # straight to the designer
    v1 = db_ticket(t["id"])
    assert v1.status == models.TicketStatus.REVISION_REQUESTED and v1.is_locked        # V1 is finished


def test_versions_past_the_free_allowance_are_flagged_but_still_just_versions(client):
    t = make_ticket(client, "a@tata.com")
    upload_proof(client, t["id"])
    db = TestingSessionLocal()
    db.add(models.SystemSettings(max_free_revisions=0))
    db.commit()
    db.close()
    set_status(client, t["id"], "Delivered")
    v2 = client.post(f"/api/tickets/{t['id']}/revisions", json={"reason_for_change": "Rework"}, headers=auth(client, "a@tata.com")).json()
    assert "Extra revision" in v2["tags"]
    tickets = client.get("/api/tickets", headers=auth(client, "lead@x.com")).json()
    assert sorted(x["ticket_number"] for x in tickets) == [t["ticket_number"], f"{t['ticket_number']}-V2"]


def test_a_closed_ticket_cannot_be_reopened_through_the_api(client):
    t = make_ticket(client, "a@tata.com")
    set_status(client, t["id"], "Delivered")
    db = TestingSessionLocal()
    db.query(models.Ticket).filter_by(id=t["id"]).update({"is_locked": True})
    db.commit()
    db.close()
    r = client.post(f"/api/tickets/{t['id']}/revisions", json={"reason_for_change": "More"}, headers=auth(client, "a@tata.com"))
    assert r.status_code == 409


def test_client_approval_changes_go_to_the_last_submitter_on_the_next_version(client):
    t = make_ticket(client, "a@tata.com")
    upload_proof(client, t["id"])
    proofs = client.get(f"/api/tickets/{t['id']}/proofs", headers=auth(client, "a@tata.com")).json()
    req = client.post(f"/api/tickets/{t['id']}/approval-requests", json={"proof_version_id": proofs[0]["id"]}, headers=auth(client, "des@x.com")).json()
    token = req["review_url"].rsplit("/", 1)[1]
    r = client.post(f"/api/public/review/{token}/decision", json={"decision": "request_changes", "name": "Rhea", "comment": "Change colours"})
    assert r.status_code == 200, r.text
    new = db_ticket(r.json()["new_ticket"]["id"])
    assert new.ticket_number.endswith("-V2") and new.status == models.TicketStatus.ASSIGNED and new.assignee_id is not None
    assert new.reason_for_change == "Change colours"
    assert db_ticket(t["id"]).status == models.TicketStatus.REVISION_REQUESTED


# ── Public request form ──────────────────────────────────────────────────────

def form(**over):
    tomorrow = datetime.date.today() + datetime.timedelta(days=7)
    data = {"name": "Meera Joshi", "email": "Meera@Example.com", "event_name": "AI Workshop", "event_date": "2030-01-10",
            "design_requirement": "Flyer (Email / Print)", "delivery_date": tomorrow.isoformat(), "num_creatives": "2",
            "details": json.dumps({"size": "A4", "channel": "Email"})}   # the Flyer questions marked required
    data.update(over)
    return data


def test_request_form_creates_an_assigned_ticket_with_the_attachment(client):
    r = client.post("/api/public/requests", data=form(content="Please use the blue theme"), files={"file": ("brief.png", PNG, "image/png")})
    assert r.status_code == 201, r.text
    number = r.json()["ticket_number"]
    db = TestingSessionLocal()
    try:
        t = db.query(models.Ticket).filter_by(ticket_number=number).first()
        assert t.title == "AI Workshop - Flyer (Email / Print)" and "blue theme" in t.brief
        assert t.type_specific_fields["number_of_creatives"] == 2
        assert t.assignee.email == "des@x.com" and t.status == models.TicketStatus.ASSIGNED   # inactive designer is skipped
        assert t.requester.email == "meera@example.com" and t.requester.role == models.RoleEnum.REQUESTER
        assert db.query(models.Attachment).filter_by(ticket_id=t.id).count() == 1
    finally:
        db.close()
    # the same person submitting again reuses their account
    assert client.post("/api/public/requests", data=form()).status_code == 201
    db = TestingSessionLocal()
    assert db.query(models.User).filter_by(email="meera@example.com").count() == 1
    db.close()


def test_request_form_validation_honeypot_and_rate_limit(client):
    past = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
    assert client.post("/api/public/requests", data=form(delivery_date=past)).status_code == 422
    assert client.post("/api/public/requests", data=form(email="not-an-email")).status_code == 422
    assert client.post("/api/public/requests", data=form(design_requirement="Other", details="")).status_code == 422
    assert client.post("/api/public/requests", data=form(design_requirement="Other", other_details="A mascot", details="")).status_code == 201
    assert client.post("/api/public/requests", data=form(), files={"file": ("x.exe", b"MZ", "application/octet-stream")}).status_code == 415
    bot = client.post("/api/public/requests", data=form(website="http://spam"))
    assert bot.status_code == 201 and bot.json()["ticket_number"] is None
    clear_hits()
    codes = [client.post("/api/public/requests", data=form()).status_code for _ in range(6)]
    assert codes[:5] == [201] * 5 and codes[5] == 429


def test_form_options_are_public(client):
    r = client.get("/api/public/request-form")
    assert r.status_code == 200 and "Flex/Banner/Standee" in r.json()["design_requirements"]


# ── Source files (CDR) ───────────────────────────────────────────────────────

def test_cdr_flow_request_approve_upload_download(client):
    t = make_ticket(client, "a@tata.com")
    cl, lead, des = auth(client, "a@tata.com"), auth(client, "lead@x.com"), auth(client, "des@x.com")
    assert client.post("/api/cdr-requests", json={"ticket_id": t["id"]}, headers=cl).status_code == 409   # not approved yet
    set_status(client, t["id"], "Delivered")
    req = client.post("/api/cdr-requests", json={"ticket_id": t["id"]}, headers=cl)
    assert req.status_code == 201 and req.json()["status"] == "Requested"
    rid = req.json()["id"]
    assert client.post("/api/cdr-requests", json={"ticket_id": t["id"]}, headers=cl).json()["id"] == rid   # no duplicates

    assert client.post(f"/api/cdr-requests/{rid}/approve", headers=des).status_code == 403
    assert client.post(f"/api/cdr-requests/{rid}/upload", files={"file": ("a.cdr", b"CDRDATA", "application/octet-stream")}, headers=des).status_code == 409
    assert client.post(f"/api/cdr-requests/{rid}/approve", headers=lead).json()["status"] == "Approved"
    assert client.post(f"/api/cdr-requests/{rid}/approve", headers=lead).status_code == 409
    assert client.get(f"/api/cdr-requests/{rid}/download", headers=cl).status_code == 409
    assert client.post(f"/api/cdr-requests/{rid}/upload", files={"file": ("a.cdr", b"CDRDATA", "application/octet-stream")}, headers=des).json()["status"] == "Uploaded"

    assert client.get(f"/api/cdr-requests/{rid}/download", headers=auth(client, "b@acme.com")).status_code == 404
    dl = client.get(f"/api/cdr-requests/{rid}/download", headers=cl)
    assert dl.status_code == 200 and dl.content == b"CDRDATA" and "attachment" in dl.headers["content-disposition"]
    db = TestingSessionLocal()
    assert db.query(models.CdrDownloadLog).count() == 1
    db.close()


def test_cdr_decline(client):
    t = make_ticket(client, "a@tata.com")
    set_status(client, t["id"], "Delivered")
    rid = client.post("/api/cdr-requests", json={"ticket_id": t["id"]}, headers=auth(client, "a@tata.com")).json()["id"]
    assert client.post(f"/api/cdr-requests/{rid}/decline", headers=auth(client, "lead@x.com")).json()["status"] == "Declined"
    listed = client.get(f"/api/tickets/{t['id']}/cdr-requests", headers=auth(client, "a@tata.com")).json()
    assert [r["status"] for r in listed] == ["Declined"]


# ── Automatic assignment and priority ────────────────────────────────────────

def test_new_tickets_are_assigned_automatically(client):
    t = make_ticket(client, "a@tata.com")
    assert t["assignee"]["email"] == "des@x.com" and t["status"] == "Assigned"


def test_request_form_priority_follows_the_delivery_date(client):
    def priority_for_days(days):
        d = (datetime.date.today() + datetime.timedelta(days=days)).isoformat()
        number = client.post("/api/public/requests", data=form(delivery_date=d)).json()["ticket_number"]
        clear_hits()
        db = TestingSessionLocal()
        try:
            return db.query(models.Ticket).filter_by(ticket_number=number).one().priority.value
        finally:
            db.close()
    assert [priority_for_days(n) for n in (0, 1, 3, 10, 30)] == ["Urgent", "Urgent", "High", "Normal", "Low"]


def test_portal_request_uses_the_signed_in_user(client):
    d = (datetime.date.today() + datetime.timedelta(days=5)).isoformat()
    r = client.post("/api/requests", data={"event_name": "Open Day", "event_date": "2030-02-01", "design_requirement": "4 pages Brochure",
                                           "delivery_date": d, "num_creatives": "1",
                                           "details": json.dumps({"copy": "Copy provided", "language": "English"})},
                    files={"file": ("brief.png", PNG, "image/png")}, headers=auth(client, "a@tata.com"))
    assert r.status_code == 201, r.text
    t = client.get("/api/tickets", headers=auth(client, "a@tata.com")).json()
    assert t[0]["id"] == r.json()["id"] and t[0]["client_org"] == "TATA" and t[0]["assignee"]["email"] == "des@x.com"
    assert client.post("/api/requests", data={"event_name": "x", "event_date": "2030-02-01", "design_requirement": "Flyer (Email / Print)", "delivery_date": d}).status_code == 401


# ── Jira ─────────────────────────────────────────────────────────────────────

def jira_payload(key="DES-7", labels=("DesignNeeded",)):
    return {"issue": {"key": key, "fields": {"summary": "Poster for launch", "labels": list(labels),
            "description": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Need an A3 poster"}]}]}}}}


def test_jira_webhook_creates_one_linked_ticket(client, monkeypatch):
    monkeypatch.setenv("JIRA_WEBHOOK_SECRET", "s3cret")
    h = {"X-Webhook-Secret": "s3cret"}
    r = client.post("/api/webhooks/jira", json=jira_payload(), headers=h)
    assert r.status_code == 200 and r.json()["status"] == "created"
    assert client.post("/api/webhooks/jira", json=jira_payload(), headers=h).json()["status"] == "exists"
    assert client.post("/api/webhooks/jira", json=jira_payload("DES-8", labels=()), headers=h).json()["status"] == "ignored"
    db = TestingSessionLocal()
    t = db.query(models.Ticket).filter_by(external_key="DES-7").one()
    assert t.title == "Poster for launch" and t.brief == "Need an A3 poster"
    db.close()


class FakeJira:
    calls = []

    def __init__(self, *a, **k):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def _resp(self, data=None):
        class R:
            def raise_for_status(s):
                pass

            def json(s):
                return data or {}
        return R()

    def get(self, url):
        FakeJira.calls.append(("GET", url))
        return self._resp({"transitions": [{"id": "11", "name": "Start", "to": {"name": "In Progress"}}, {"id": "31", "name": "Done", "to": {"name": "Done"}}]})

    def post(self, url, json=None):
        FakeJira.calls.append(("POST", url, json))
        return self._resp()


def test_status_change_is_pushed_to_the_linked_jira_issue(client, monkeypatch):
    monkeypatch.setenv("JIRA_BASE_URL", "https://x.atlassian.net")
    monkeypatch.setenv("JIRA_EMAIL", "bot@x.com")
    monkeypatch.setenv("JIRA_API_TOKEN", "tok")
    monkeypatch.setattr(integrations.httpx, "Client", FakeJira)
    FakeJira.calls.clear()
    t = make_ticket(client, "a@tata.com")
    db = TestingSessionLocal()
    db.query(models.Ticket).filter_by(id=t["id"]).update({"external_key": "DES-9"})
    db.commit()
    db.close()
    set_status(client, t["id"], "In Progress")
    assert ("POST", "https://x.atlassian.net/rest/api/3/issue/DES-9/transitions", {"transition": {"id": "11"}}) in FakeJira.calls


def test_jira_push_skips_unconfigured_and_malformed_keys(monkeypatch):
    monkeypatch.delenv("JIRA_BASE_URL", raising=False)
    assert integrations.push_status_to_jira("DES-1", "Done") is False
    monkeypatch.setenv("JIRA_BASE_URL", "https://x.atlassian.net")
    monkeypatch.setenv("JIRA_EMAIL", "bot@x.com")
    monkeypatch.setenv("JIRA_API_TOKEN", "tok")
    assert integrations.push_status_to_jira("../../etc", "Done") is False
