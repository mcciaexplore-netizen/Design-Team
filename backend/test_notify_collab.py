import datetime
import os
import shutil
import tempfile
import types

import pytest
import pytz

import common
import delivery
import digest
import models
from test_auth import TestingSessionLocal, auth, client, login, make_ticket  # noqa: F401

SLACK_URL = "https://hooks.slack.com/services/T000/B000/XXXX"


@pytest.fixture(autouse=True)
def sync_background(monkeypatch):
    """Run 'background' deliveries inline so tests can observe them."""
    monkeypatch.setattr(delivery, "run_in_background", lambda fn, *a: fn(*a))
    monkeypatch.delenv("SMTP_HOST", raising=False)


def fake_post(status=200, text="ok", calls=None):
    def post(url, json=None, **kw):
        if calls is not None:
            calls.append((url, json))
        return types.SimpleNamespace(status_code=status, text=text)
    return post


# ── Slack / email delivery ───────────────────────────────────────────────────

def test_slack_test_reports_success_and_failure(client, monkeypatch):
    lead = auth(client, "lead@x.com")
    calls = []
    monkeypatch.setattr(delivery.httpx, "post", fake_post(200, "ok", calls))
    r = client.post("/api/integrations/slack/test", json={"webhook_url": SLACK_URL}, headers=lead)
    assert r.status_code == 200 and r.json()["ok"] is True
    assert calls[0][0] == SLACK_URL

    monkeypatch.setattr(delivery.httpx, "post", fake_post(404, "no_service"))
    r = client.post("/api/integrations/slack/test", json={"webhook_url": SLACK_URL}, headers=lead)
    assert r.json()["ok"] is False and "404" in r.json()["detail"]


def test_slack_test_rejects_non_slack_urls_and_non_leads(client):
    lead = auth(client, "lead@x.com")
    for bad in ("http://hooks.slack.com/services/a", "https://evil.example.com/services/a", "https://hooks.slack.com.evil.io/services/a",
                "https://169.254.169.254/latest"):
        assert client.post("/api/integrations/slack/test", json={"webhook_url": bad}, headers=lead).status_code == 422
    assert client.post("/api/integrations/slack/test", json={}, headers=lead).status_code == 422  # nothing saved yet
    assert client.post("/api/integrations/slack/test", json={"webhook_url": SLACK_URL}, headers=auth(client, "des@x.com")).status_code == 403


def test_integration_settings_mask_secret_and_keep_it_on_partial_update(client):
    lead = auth(client, "lead@x.com")
    r = client.put("/api/settings/integrations", json={"slack_webhook": SLACK_URL, "slack_channel": "#design"}, headers=lead)
    assert r.status_code == 200
    body = r.json()
    assert body["slack_configured"] is True and SLACK_URL not in str(body)
    r = client.put("/api/settings/integrations", json={"email_on_breach": False}, headers=lead)
    assert r.json()["slack_configured"] is True and r.json()["email_on_breach"] is False
    assert client.put("/api/settings/integrations", json={"slack_webhook": "https://x.com/y"}, headers=lead).status_code == 422
    assert client.get("/api/settings/integrations", headers=auth(client, "des@x.com")).status_code == 403


def test_email_test_without_smtp_explains_why(client):
    r = client.post("/api/integrations/email/test", json={}, headers=auth(client, "lead@x.com"))
    assert r.status_code == 200 and r.json()["ok"] is False and "SMTP" in r.json()["detail"]


def test_email_test_sends_via_smtp(client, monkeypatch):
    sent = []

    class FakeSMTP:
        def __init__(self, host, port, timeout=None): sent.append(("connect", host, port))
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def starttls(self): sent.append("tls")
        def login(self, u, p): sent.append(("login", u))
        def send_message(self, msg): sent.append(("msg", msg["To"], msg["Subject"]))

    monkeypatch.setenv("SMTP_HOST", "smtp.test")
    monkeypatch.setenv("SMTP_USER", "me")
    monkeypatch.setattr(delivery.smtplib, "SMTP", FakeSMTP)
    r = client.post("/api/integrations/email/test", json={"to": "someone@x.com"}, headers=auth(client, "lead@x.com"))
    assert r.json()["ok"] is True
    assert ("msg", "someone@x.com", "DesignDesk test email") in sent and "tls" in sent


def test_email_header_injection_is_refused():
    ok, detail = delivery.send_email("a@b.com\nBcc: evil@x.com", "s", "b") if False else (False, "")
    import os
    os.environ["SMTP_HOST"] = "smtp.test"
    try:
        ok, detail = delivery.send_email("a@b.com\nBcc: evil@x.com", "s", "b")
    finally:
        del os.environ["SMTP_HOST"]
    assert ok is False and "Invalid recipient" in detail


# ── Events, preferences, notifications ───────────────────────────────────────

def notes_for(email):
    db = TestingSessionLocal()
    try:
        u = db.query(models.User).filter_by(email=email).first()
        return [n.content for n in db.query(models.Notification).filter_by(user_id=u.id).all()]
    finally:
        db.close()


def test_new_ticket_notifies_leads_and_posts_to_slack_when_enabled(client, monkeypatch):
    calls = []
    monkeypatch.setattr(delivery.httpx, "post", fake_post(200, "ok", calls))
    client.put("/api/settings/integrations", json={"slack_webhook": SLACK_URL}, headers=auth(client, "lead@x.com"))
    make_ticket(client, "a@tata.com", "Poster <!channel> & more")
    assert any("Poster" in n for n in notes_for("lead@x.com"))
    assert notes_for("des@x.com") == []  # designers are not told about every new ticket
    text = calls[-1][1]["text"]
    assert "&lt;!channel&gt;" in text and "<!channel>" not in text  # user text can't ping the channel


def test_slack_event_toggle_is_respected(client, monkeypatch):
    calls = []
    monkeypatch.setattr(delivery.httpx, "post", fake_post(200, "ok", calls))
    lead = auth(client, "lead@x.com")
    client.put("/api/settings/integrations", json={"slack_webhook": SLACK_URL, "slack_events": {"new": False}}, headers=lead)
    make_ticket(client, "a@tata.com")
    assert calls == []


def test_preferences_roundtrip_and_validation(client):
    h = auth(client, "des@x.com")
    r = client.get("/api/me/preferences", headers=h).json()
    assert r["in_app_enabled"] is True and r["digest_enabled"] is False and "mention" in r["available_events"]
    r = client.put("/api/me/preferences", json={"digest_enabled": True, "quiet_hours_start": 22, "quiet_hours_end": 7,
                                                "muted_events": ["ticket_assigned"]}, headers=h)
    assert r.status_code == 200 and r.json()["digest_enabled"] is True and r.json()["muted_events"] == ["ticket_assigned"]
    assert client.put("/api/me/preferences", json={"muted_events": ["nope"]}, headers=h).status_code == 422
    assert client.put("/api/me/preferences", json={"quiet_hours_start": 25}, headers=h).status_code == 422


def test_muted_event_and_disabled_in_app_suppress_notifications(client):
    t = make_ticket(client, "a@tata.com")
    lead, des = auth(client, "lead@x.com"), auth(client, "des@x.com")
    client.put("/api/me/preferences", json={"muted_events": ["ticket_assigned"]}, headers=des)
    client.patch(f"/api/tickets/{t['id']}", json={"assignee_id": 2}, headers=lead)
    assert notes_for("des@x.com") == []
    client.put("/api/me/preferences", json={"muted_events": [], "in_app_enabled": False}, headers=des)
    client.patch(f"/api/tickets/{t['id']}", json={"assignee_id": 1}, headers=lead)
    client.patch(f"/api/tickets/{t['id']}", json={"assignee_id": 2}, headers=lead)
    assert notes_for("des@x.com") == []
    client.put("/api/me/preferences", json={"in_app_enabled": True}, headers=des)
    client.patch(f"/api/tickets/{t['id']}", json={"assignee_id": 1}, headers=lead)
    client.patch(f"/api/tickets/{t['id']}", json={"assignee_id": 2}, headers=lead)
    assert any("assigned you" in n for n in notes_for("des@x.com"))


def test_notifications_api_list_and_mark_read(client):
    make_ticket(client, "a@tata.com", "Needs attention")
    lead = auth(client, "lead@x.com")
    data = client.get("/api/notifications", headers=lead).json()
    assert data["unread"] >= 1 and data["items"][0]["is_read"] is False
    nid = data["items"][0]["id"]
    assert client.post(f"/api/notifications/{nid}/read", headers=lead).status_code == 200
    assert client.post(f"/api/notifications/{nid}/read", headers=auth(client, "des@x.com")).status_code == 404  # not theirs
    client.post("/api/notifications/read-all", headers=lead)
    assert client.get("/api/notifications", params={"unread_only": True}, headers=lead).json()["unread"] == 0


def test_daily_digest_content_and_once_per_day(client, monkeypatch):
    t = make_ticket(client, "a@tata.com", "Late one")
    db = TestingSessionLocal()
    db.query(models.Ticket).filter_by(id=t["id"]).update(
        {"assignee_id": 2, "due_at": datetime.datetime.now(pytz.utc) - datetime.timedelta(hours=3), "status": models.TicketStatus.IN_PROGRESS})
    db.add(models.UserPreference(user_id=2, digest_enabled=True, muted_events=[]))
    db.commit()
    des = db.query(models.User).filter_by(id=2).first()
    d = digest.build_digest(db, des)
    assert [r["title"] for r in d["overdue"]] == ["Late one"]
    subject, text, html = digest.render_digest(d)
    assert "1 overdue" in subject and "Late one" in text

    sent = []
    monkeypatch.setenv("SMTP_HOST", "smtp.test")
    monkeypatch.setattr(delivery, "send_email", lambda to, s, b, h=None: (sent.append(to) or (True, "ok")))
    nine_am = IST9()
    assert digest.send_daily_digests(db, nine_am)["sent"] == 1
    assert digest.send_daily_digests(db, nine_am)["skipped"] == "not due"  # already sent today
    assert sent == ["des@x.com"]
    db.close()


def IST9():
    ist = pytz.timezone("Asia/Kolkata")
    return ist.localize(datetime.datetime(2026, 1, 14, 9, 30)).astimezone(pytz.utc)


def test_digest_not_sent_before_9am_ist_or_without_smtp(client, monkeypatch):
    db = TestingSessionLocal()
    early = pytz.timezone("Asia/Kolkata").localize(datetime.datetime(2026, 1, 14, 7, 0)).astimezone(pytz.utc)
    monkeypatch.setenv("SMTP_HOST", "smtp.test")
    assert digest.send_daily_digests(db, early)["skipped"] == "not due"
    monkeypatch.delenv("SMTP_HOST")
    assert digest.send_daily_digests(db, IST9())["skipped"] == "smtp not configured"
    db.close()


def test_digest_html_escapes_ticket_titles():
    d = {"user": "<b>x</b>", "date": "d", "overdue": [{"number": "DF-1", "title": "<script>alert(1)</script>", "status": "New", "due_at": None}],
         "due_soon": [], "in_review": [], "other_open": [], "total_open": 1}
    _, _, html = digest.render_digest(d)
    assert "<script>" not in html and "&lt;script&gt;" in html


# ── Comments & mentions ──────────────────────────────────────────────────────

def test_comment_with_mention_notifies_and_is_listed(client):
    t = make_ticket(client, "a@tata.com")
    des = auth(client, "des@x.com")
    r = client.post(f"/api/tickets/{t['id']}/comments", json={"content": "Please look @Lead", "mentioned_user_ids": [1]}, headers=des)
    assert r.status_code == 201 and r.json()["mentions"] == [{"id": 1, "full_name": "Lead"}]
    assert any("mentioned you" in n for n in notes_for("lead@x.com"))
    listing = client.get(f"/api/tickets/{t['id']}/comments", headers=auth(client, "a@tata.com")).json()
    assert [c["content"] for c in listing] == ["Please look @Lead"]
    assert any("commented" in n for n in notes_for("a@tata.com"))  # requester is told


def test_cannot_mention_people_without_access_or_empty_comment(client):
    t = make_ticket(client, "a@tata.com")
    des = auth(client, "des@x.com")
    # user 4 is an ACME client: no access to a TATA ticket, so mentioning would leak the ticket's title
    assert client.post(f"/api/tickets/{t['id']}/comments", json={"content": "hi", "mentioned_user_ids": [4]}, headers=des).status_code == 422
    assert client.post(f"/api/tickets/{t['id']}/comments", json={"content": "hi", "mentioned_user_ids": [5]}, headers=des).status_code == 422  # inactive
    assert client.post(f"/api/tickets/{t['id']}/comments", json={"content": "   "}, headers=des).status_code == 422
    assert notes_for("b@acme.com") == []


def test_comments_are_scoped_to_client_org(client):
    t = make_ticket(client, "a@tata.com")
    other = auth(client, "b@acme.com")
    assert client.get(f"/api/tickets/{t['id']}/comments", headers=other).status_code == 404
    assert client.post(f"/api/tickets/{t['id']}/comments", json={"content": "x"}, headers=other).status_code == 404
    assert client.get(f"/api/tickets/{t['id']}/mentionable", headers=other).status_code == 404
    names = [p["full_name"] for p in client.get(f"/api/tickets/{t['id']}/mentionable", headers=auth(client, "a@tata.com")).json()]
    assert "Acme B" not in names and "Lead" in names


# ── Attachments ──────────────────────────────────────────────────────────────

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


@pytest.fixture(autouse=True)
def upload_dir(monkeypatch):
    path = tempfile.mkdtemp(prefix="dd-uploads-")
    monkeypatch.setenv("UPLOAD_DIR", path)
    monkeypatch.delenv("S3_ENDPOINT_URL", raising=False)
    yield path
    shutil.rmtree(path, ignore_errors=True)


def upload(client, tid, email, name="mock.png", data=PNG, **form):
    return client.post(f"/api/tickets/{tid}/attachments", files={"file": (name, data, "application/octet-stream")}, data=form, headers=auth(client, email))


def test_attachment_upload_download_roundtrip_with_safe_headers(client):
    t = make_ticket(client, "a@tata.com")
    r = upload(client, t["id"], "a@tata.com")
    assert r.status_code == 201 and r.json()["file_name"] == "mock.png" and r.json()["size_bytes"] == len(PNG)
    got = client.get(f"/api/attachments/{r.json()['id']}/download", headers=auth(client, "des@x.com"))
    assert got.content == PNG
    assert got.headers["x-content-type-options"] == "nosniff" and "sandbox" in got.headers["content-security-policy"]
    assert len(client.get(f"/api/tickets/{t['id']}/attachments", headers=auth(client, "a@tata.com")).json()) == 1


def test_attachment_validation(client, monkeypatch):
    t = make_ticket(client, "a@tata.com")
    assert upload(client, t["id"], "a@tata.com", "evil.exe", b"MZ").status_code == 415
    assert upload(client, t["id"], "a@tata.com", "logo.svg", b"<svg onload=alert(1)>").status_code == 415
    assert upload(client, t["id"], "a@tata.com", "fake.png", b"not a png at all").status_code == 415
    assert upload(client, t["id"], "a@tata.com", "empty.png", b"").status_code in (400, 415)
    monkeypatch.setattr(common, "MAX_UPLOAD_BYTES", 16)
    assert upload(client, t["id"], "a@tata.com", "big.png", PNG).status_code == 413


def test_attachment_path_traversal_in_filename_is_neutralised(client):
    t = make_ticket(client, "a@tata.com")
    r = upload(client, t["id"], "a@tata.com", "../../etc/passwd.png", PNG)
    assert r.status_code == 201 and "/" not in r.json()["file_name"] and ".." not in r.json()["file_name"].replace("passwd", "")


def test_attachment_access_is_scoped_and_delete_rules(client):
    t = make_ticket(client, "a@tata.com")
    att = upload(client, t["id"], "a@tata.com").json()
    assert client.get(f"/api/attachments/{att['id']}/download", headers=auth(client, "b@acme.com")).status_code == 404
    assert upload(client, t["id"], "b@acme.com").status_code == 404
    assert client.delete(f"/api/attachments/{att['id']}", headers=auth(client, "des@x.com")).status_code == 403
    assert client.delete(f"/api/attachments/{att['id']}", headers=auth(client, "a@tata.com")).status_code == 204
    assert client.get(f"/api/attachments/{att['id']}/download", headers=auth(client, "lead@x.com")).status_code == 404


def test_attachment_can_hang_off_own_comment_only(client):
    t = make_ticket(client, "a@tata.com")
    c = client.post(f"/api/tickets/{t['id']}/comments", json={"content": "see file"}, headers=auth(client, "a@tata.com")).json()
    assert upload(client, t["id"], "a@tata.com", comment_id=str(c["id"])).status_code == 201
    assert upload(client, t["id"], "des@x.com", comment_id=str(c["id"])).status_code == 422  # someone else's comment
    listing = client.get(f"/api/tickets/{t['id']}/comments", headers=auth(client, "a@tata.com")).json()
    assert listing[0]["attachments"][0]["file_name"] == "mock.png"


# ── Figma ────────────────────────────────────────────────────────────────────

def test_figma_preview_and_ticket_validation(client):
    h = auth(client, "des@x.com")
    ok = client.get("/api/figma/preview", params={"url": "https://www.figma.com/design/AbCdEfGh12345/Spring-Sale-Banner?node-id=1-2"}, headers=h).json()
    assert ok["valid"] is True and ok["name"] == "Spring Sale Banner" and ok["embed_url"].startswith("https://www.figma.com/embed?")
    for bad in ("https://evil.com/design/AbCdEfGh12345/x", "http://www.figma.com/design/AbCdEfGh12345/x", "javascript:alert(1)",
                "https://www.figma.com.evil.io/design/AbCdEfGh12345/x"):
        assert client.get("/api/figma/preview", params={"url": bad}, headers=h).json()["valid"] is False
    body = {"title": "T", "brief": "b", "design_type_id": 1, "type_specific_fields": {}}
    r = client.post("/api/tickets", json={**body, "figma_url": "javascript:alert(1)"}, headers=auth(client, "a@tata.com"))
    assert r.status_code == 422
    r = client.post("/api/tickets", json={**body, "figma_url": "https://www.figma.com/file/AbCdEfGh12345/Thing"}, headers=auth(client, "a@tata.com"))
    assert r.status_code == 201 and r.json()["figma_url"].startswith("https://www.figma.com/")
