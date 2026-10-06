"""Tracking page, CAPTCHA, confirmation email, Jira status sync, edit windows, waiting reminders, capacity, reports."""
import datetime
import shutil
import tempfile

import pytest
import pytz

import delivery
import models
from auth import hash_password
from test_auth import TestingSessionLocal, auth, client, make_ticket  # noqa: F401
from test_workflow_features import PNG, clear_hits, db_ticket, form, set_status, tick


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    path = tempfile.mkdtemp(prefix="dd-uploads-")
    monkeypatch.setenv("UPLOAD_DIR", path)
    monkeypatch.delenv("S3_ENDPOINT_URL", raising=False)
    for var in ("SMTP_HOST", "TURNSTILE_SECRET_KEY", "TURNSTILE_SITE_KEY"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setattr(delivery, "run_in_background", lambda fn, *a: fn(*a))
    yield
    shutil.rmtree(path, ignore_errors=True)


def submit(client, **over):
    r = client.post("/api/public/requests", data=form(**over))
    assert r.status_code == 201, r.text
    return r.json()


# ── Tracking page ────────────────────────────────────────────────────────────

def test_tracking_link_shows_progress_without_login_and_rejects_tampering(client):
    out = submit(client)
    token = out["tracking_url"].rsplit("/track/", 1)[1]
    assert token.startswith(out["ticket_number"] + ".")
    t = db_ticket(1)
    set_status(client, t.id, "In Progress")
    r = client.get(f"/api/public/track/{token}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "In Progress" and body["current_step"] == 2 and body["title"].startswith("AI Workshop")
    assert [h["text"] for h in body["history"]] == ["Request received", "Status changed to In Progress"]
    assert "requester" not in str(body).lower() and "meera@example.com" not in str(body)   # nothing personal is exposed
    assert client.get(f"/api/public/track/{token[:-1]}0").status_code == 404
    assert client.get(f"/api/public/track/DF-9999.{token.split('.')[1]}").status_code == 404
    assert client.get("/api/public/track/garbage").status_code == 404


# ── CAPTCHA and email ────────────────────────────────────────────────────────

def test_turnstile_is_enforced_only_when_configured(client, monkeypatch):
    assert client.get("/api/public/request-form").json()["turnstile_site_key"] is None
    monkeypatch.setenv("TURNSTILE_SECRET_KEY", "secret")
    monkeypatch.setenv("TURNSTILE_SITE_KEY", "site")
    seen = []
    monkeypatch.setattr(delivery, "verify_turnstile", lambda token, ip="": seen.append(token) or token == "good")
    assert client.get("/api/public/request-form").json()["turnstile_site_key"] == "site"
    assert client.post("/api/public/requests", data=form()).status_code == 400
    assert client.post("/api/public/requests", data={**form(), "cf-turnstile-response": "bad"}).status_code == 400
    assert client.post("/api/public/requests", data={**form(), "cf-turnstile-response": "good"}).status_code == 201
    assert seen == ["", "bad", "good"]


def test_confirmation_email_has_the_ticket_number_and_tracking_link(client, monkeypatch):
    sent = []
    monkeypatch.setattr(delivery, "send_email", lambda to, subject, body: sent.append((to, subject, body)) or (True, "ok"))
    submit(client)
    assert sent == []   # SMTP not configured: nothing is sent
    monkeypatch.setenv("SMTP_HOST", "smtp.example.com")
    out = submit(client)
    to, subject, body = sent[0]
    assert to == "meera@example.com" and out["ticket_number"] in subject
    assert out["tracking_url"] in body and "AI Workshop" in body


def test_send_email_never_raises_when_unconfigured_or_unreachable(monkeypatch):
    assert delivery.send_email("a@b.com", "s", "b") == (False, "Email is not configured")
    monkeypatch.setenv("SMTP_HOST", "127.0.0.1")
    monkeypatch.setenv("SMTP_PORT", "1")
    ok, detail = delivery.send_email("a@b.com", "s", "b")
    assert ok is False and "Could not send" in detail


# ── Jira → DesignDesk status ─────────────────────────────────────────────────

def link_jira(tid, key="DES-5"):
    db = TestingSessionLocal()
    db.query(models.Ticket).filter_by(id=tid).update({"external_key": key})
    db.commit()
    db.close()


def jira_move(client, to, key="DES-5"):
    r = client.post("/api/webhooks/jira", headers={"X-Webhook-Secret": "s3cret"},
                    json={"webhookEvent": "jira:issue_updated", "issue": {"key": key, "fields": {}},
                          "changelog": {"items": [{"field": "status", "toString": to}]}})
    assert r.status_code == 200, r.text
    return r.json()


def test_jira_status_moves_update_the_linked_ticket(client, monkeypatch):
    monkeypatch.setenv("JIRA_WEBHOOK_SECRET", "s3cret")
    t = make_ticket(client, "a@tata.com")      # auto-assigned, so "Assigned"
    link_jira(t["id"])
    assert jira_move(client, "To Do")["status"] == "unchanged"                  # Jira's To Do already means Assigned
    assert jira_move(client, "In Progress") == {"status": "synced", "ticket": t["ticket_number"], "to": "In Progress"}
    assert db_ticket(t["id"]).status == models.TicketStatus.IN_PROGRESS
    assert jira_move(client, "In Progress")["status"] == "unchanged"            # an echo changes nothing
    assert jira_move(client, "Some Custom State")["status"] == "unchanged"
    assert jira_move(client, "Done")["to"] == "Delivered"
    delivered = db_ticket(t["id"])
    assert delivered.edit_window_ends_at is not None and delivered.delivered_at is not None
    trail = client.get(f"/api/tickets/{t['id']}/audit", headers=auth(client, "lead@x.com")).json()
    assert trail[-1]["actor"] == "Jira"
    assert jira_move(client, "In Progress", key="DES-404")["status"] == "ignored"   # unknown issue, no label


# ── Edit window per design type ──────────────────────────────────────────────

def test_design_type_edit_window_overrides_the_global_default(client):
    lead = auth(client, "lead@x.com")
    assert client.patch("/api/design-types/1", json={"edit_window_hours": 2}, headers=auth(client, "des@x.com")).status_code == 403
    assert client.patch("/api/design-types/1", json={"edit_window_hours": 0}, headers=lead).status_code == 422
    assert client.patch("/api/design-types/99", json={"edit_window_hours": 2}, headers=lead).status_code == 404
    r = client.patch("/api/design-types/1", json={"edit_window_hours": 2, "default_effort_hours": 6}, headers=lead)
    assert r.status_code == 200 and r.json()["edit_window_hours"] == 2 and r.json()["default_effort_hours"] == 6

    a = make_ticket(client, "a@tata.com")
    set_status(client, a["id"], "Delivered")
    t = db_ticket(a["id"])
    hours = (t.edit_window_ends_at - t.delivered_at.replace(tzinfo=None)).total_seconds() / 3600 if t.edit_window_ends_at.tzinfo is None \
        else (t.edit_window_ends_at - t.delivered_at).total_seconds() / 3600
    assert 1.9 < hours < 2.1

    client.patch("/api/design-types/1", json={"edit_window_hours": None}, headers=lead)   # back to the global 12 h
    b = make_ticket(client, "a@tata.com")
    set_status(client, b["id"], "Delivered")
    t = db_ticket(b["id"])
    hours = (t.edit_window_ends_at - t.delivered_at).total_seconds() / 3600
    assert 11.9 < hours < 12.1


# ── Waiting on requester ─────────────────────────────────────────────────────

def notes(email):
    db = TestingSessionLocal()
    try:
        u = db.query(models.User).filter_by(email=email).first()
        return [n.content for n in db.query(models.Notification).filter_by(user_id=u.id).all()]
    finally:
        db.close()


def test_waiting_tickets_pause_their_clock_and_the_requester_is_reminded_daily(client):
    t = make_ticket(client, "a@tata.com")
    set_status(client, t["id"], "Waiting on Requester")
    assert db_ticket(t["id"]).paused_at is not None
    tick(client)
    assert not any("waiting for your reply" in n for n in notes("a@tata.com"))      # too early

    db = TestingSessionLocal()
    db.query(models.Ticket).filter_by(id=t["id"]).update({"paused_at": datetime.datetime.now(pytz.utc) - datetime.timedelta(hours=26)})
    db.commit()
    db.close()
    tick(client)
    tick(client)                                                                        # idempotent
    assert sum("waiting for your reply" in n for n in notes("a@tata.com")) == 1

    set_status(client, t["id"], "In Progress")
    after = db_ticket(t["id"])
    assert after.paused_at is None and 25 * 3600 < after.total_paused_seconds < 27 * 3600


# ── Capacity-based assignment ────────────────────────────────────────────────

def add_designer(email="des2@x.com"):
    db = TestingSessionLocal()
    db.add(models.User(email=email, full_name="Designer Two", role=models.RoleEnum.DESIGNER, hashed_password=hash_password("secret-pw")))
    db.commit()
    db.close()


def test_assignment_weighs_remaining_effort_and_skips_unavailable_designers(client):
    add_designer()
    lead = auth(client, "lead@x.com")
    first = make_ticket(client, "a@tata.com")                 # both idle: the first designer
    assert first["assignee"]["email"] == "des@x.com"
    client.patch(f"/api/tickets/{first['id']}", json={"assignee_id": 2}, headers=lead)
    big = client.patch(f"/api/tickets/{first['id']}", json={"status": "In Progress"}, headers=lead)
    assert big.status_code == 200
    second = make_ticket(client, "a@tata.com")                # des is loaded, des2 is idle
    assert second["assignee"]["email"] == "des2@x.com"

    # On leave for the whole horizon: not eligible even though idle.
    db = TestingSessionLocal()
    des2 = db.query(models.User).filter_by(email="des2@x.com").one()
    today = datetime.datetime.now()
    db.add(models.UserLeave(user_id=des2.id, start_date=today - datetime.timedelta(days=1), end_date=today + datetime.timedelta(days=10)))
    db.commit()
    db.close()
    third = make_ticket(client, "a@tata.com")
    assert third["assignee"]["email"] == "des@x.com"


# ── Reports ──────────────────────────────────────────────────────────────────

def test_report_breaks_down_by_design_type_and_exports_csv(client):
    t = make_ticket(client, "a@tata.com")
    set_status(client, t["id"], "Delivered")
    lead = auth(client, "lead@x.com")
    r = client.get("/api/reports/summary", headers=lead).json()
    row = r["by_design_type"][0]
    assert row["design_type"] == "Banner" and row["tickets"] == 1 and row["delivered"] == 1
    csv = client.get("/api/reports/export.csv", params={"report": "design_types"}, headers=lead)
    assert csv.status_code == 200 and csv.text.splitlines()[0].startswith("Design type,Tickets") and "Banner" in csv.text


# ── Larger source files ──────────────────────────────────────────────────────

def test_source_files_may_be_larger_than_ordinary_uploads(client):
    t = make_ticket(client, "a@tata.com")
    set_status(client, t["id"], "Delivered")
    rid = client.post("/api/cdr-requests", json={"ticket_id": t["id"]}, headers=auth(client, "a@tata.com")).json()["id"]
    client.post(f"/api/cdr-requests/{rid}/approve", headers=auth(client, "lead@x.com"))
    big = b"C" * (11 * 1024 * 1024)
    ok = client.post(f"/api/cdr-requests/{rid}/upload", files={"file": ("big.cdr", big, "application/octet-stream")}, headers=auth(client, "des@x.com"))
    assert ok.status_code == 200, ok.text
    # ...while ordinary attachments keep the 10 MB cap.
    att = client.post(f"/api/tickets/{t['id']}/attachments", files={"file": ("big.zip", b"PK" + big, "application/zip")}, headers=auth(client, "des@x.com"))
    assert att.status_code == 413


# ── Error handling and CORS ──────────────────────────────────────────────────

def test_unexpected_errors_return_json_with_cors_headers(client):
    from fastapi.testclient import TestClient
    from main import app

    @app.get("/api/_boom")
    def boom():
        raise RuntimeError("kaboom")

    quiet = TestClient(app, raise_server_exceptions=False)
    r = quiet.get("/api/_boom", headers={"Origin": "http://localhost:5173"})
    assert r.status_code == 500 and r.json()["detail"].startswith("The server had a problem")
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"   # the browser can read the error


def test_local_development_allows_any_localhost_port_but_not_other_sites(client):
    for origin, allowed in (("http://localhost:5175", True), ("http://127.0.0.1:4000", True), ("https://evil.example.com", False)):
        r = client.options("/api/public/request-form", headers={"Origin": origin, "Access-Control-Request-Method": "GET"})
        assert (r.headers.get("access-control-allow-origin") == origin) is allowed, origin


# ── Upload = send for approval ───────────────────────────────────────────────

def upload_design(client, tid, email="des@x.com", **data):
    return client.post(f"/api/tickets/{tid}/proofs", files={"file": ("design.png", PNG, "image/png")}, data=data, headers=auth(client, email))


def test_uploading_a_design_sends_it_to_the_client_for_approval(client):
    t = make_ticket(client, "a@tata.com")
    r = upload_design(client, t["id"])
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["version"] == 1 and body["approval"]["status"] == "pending" and body["approval"]["review_url"].startswith("http")
    assert db_ticket(t["id"]).status == models.TicketStatus.IN_REVIEW                  # no separate click, no comment needed
    assert any("sent a design for your review" in n for n in notes("a@tata.com"))     # the client is told
    feed = client.get("/api/notifications", headers=auth(client, "a@tata.com")).json()["items"]
    assert feed[0]["type"] == "approval_requested" and feed[0]["ticket_id"] == t["id"]   # and the notification opens the request
    cl = auth(client, "a@tata.com")
    pending = [x for x in client.get(f"/api/tickets/{t['id']}/approval-requests", headers=cl).json() if x["status"] == "pending"]
    assert len(pending) == 1 and pending[0]["proof_version"] == 1                      # visible in their portal

    # They approve right there in the portal.
    d = client.post(f"/api/approval-requests/{pending[0]['id']}/decision", json={"decision": "approve"}, headers=cl)
    assert d.status_code == 200, d.text
    assert db_ticket(t["id"]).status == models.TicketStatus.DELIVERED


def test_client_reply_opens_the_next_version_and_its_upload_goes_out_automatically(client):
    t = make_ticket(client, "a@tata.com")
    upload_design(client, t["id"])
    cl = auth(client, "a@tata.com")
    first = [x for x in client.get(f"/api/tickets/{t['id']}/approval-requests", headers=cl).json() if x["status"] == "pending"][0]
    r = client.post(f"/api/approval-requests/{first['id']}/decision", json={"decision": "request_changes", "comment": "Make the logo bigger"}, headers=cl)
    assert r.status_code == 200, r.text
    v2_id = r.json()["new_ticket"]["id"]
    v2 = db_ticket(v2_id)
    assert v2.ticket_number == f"{t['ticket_number']}-V2" and v2.assignee_id is not None          # straight to the designer
    assert db_ticket(t["id"]).is_locked

    assert upload_design(client, t["id"]).status_code == 409                                     # V1 takes no more designs
    sent = upload_design(client, v2_id).json()                                                    # the redo goes on V2
    assert sent["version"] == 1 and sent["approval"]["status"] == "pending"
    assert db_ticket(v2_id).status == models.TicketStatus.IN_REVIEW
    reqs = client.get(f"/api/tickets/{v2_id}/approval-requests", headers=cl).json()
    assert [x["status"] for x in reqs] == ["pending"]
    assert any("sent a design for your review" in n and f"{t['ticket_number']}-V2" in n for n in notes("a@tata.com"))   # the client hears about it
    assert any("was assigned to you" in n and f"{t['ticket_number']}-V2" in n for n in notes("des@x.com"))      # and the designer gets the new ticket


def test_a_new_upload_replaces_the_open_review(client):
    t = make_ticket(client, "a@tata.com")
    upload_design(client, t["id"])
    upload_design(client, t["id"])
    reqs = client.get(f"/api/tickets/{t['id']}/approval-requests", headers=auth(client, "a@tata.com")).json()
    assert sorted((x["proof_version"], x["status"]) for x in reqs) == [(1, "revoked"), (2, "pending")]   # only the latest is live


def test_a_draft_upload_is_not_sent(client):
    t = make_ticket(client, "a@tata.com")
    r = upload_design(client, t["id"], send_for_approval="false")
    assert r.status_code == 201 and r.json()["approval"] is None
    assert db_ticket(t["id"]).status == models.TicketStatus.ASSIGNED
    assert client.get(f"/api/tickets/{t['id']}/approval-requests", headers=auth(client, "a@tata.com")).json() == []
    assert not any("sent a design" in n for n in notes("a@tata.com"))
