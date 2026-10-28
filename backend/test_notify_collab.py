import datetime
import os
import shutil
import tempfile
import types

import pytest
import pytz

import common
import delivery
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
    r = client.put("/api/settings/integrations", json={"slack_channel": "#ops"}, headers=lead)
    assert r.json()["slack_configured"] is True and r.json()["slack_channel"] == "#ops"
    assert client.put("/api/settings/integrations", json={"slack_webhook": "https://x.com/y"}, headers=lead).status_code == 422
    assert client.get("/api/settings/integrations", headers=auth(client, "des@x.com")).status_code == 403


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
    make_ticket(client, "des@x.com", "Poster <!channel> & more")
    assert any("Poster" in n for n in notes_for("lead@x.com"))
    assert notes_for("des@x.com") == []   # the designer raised it (and got it) themselves: nothing to tell them
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
    assert r["in_app_enabled"] is True and "ticket_assigned" in r["available_events"]
    r = client.put("/api/me/preferences", json={"muted_events": ["ticket_assigned"]}, headers=h)
    assert r.status_code == 200 and r.json()["muted_events"] == ["ticket_assigned"]
    assert client.put("/api/me/preferences", json={"muted_events": ["nope"]}, headers=h).status_code == 422


def test_muted_event_and_disabled_in_app_suppress_notifications(client):
    lead, des = auth(client, "lead@x.com"), auth(client, "des@x.com")
    client.put("/api/me/preferences", json={"muted_events": ["ticket_assigned"]}, headers=des)
    t = make_ticket(client, "a@tata.com")  # auto-assigned to the designer, who has muted assignments
    assert notes_for("des@x.com") == []
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
    make_ticket(client, "des@x.com", "Needs attention")
    lead = auth(client, "lead@x.com")
    data = client.get("/api/notifications", headers=lead).json()
    assert data["unread"] >= 1 and data["items"][0]["is_read"] is False
    nid = data["items"][0]["id"]
    assert client.post(f"/api/notifications/{nid}/read", headers=lead).status_code == 200
    assert client.post(f"/api/notifications/{nid}/read", headers=auth(client, "des@x.com")).status_code == 404  # not theirs
    client.post("/api/notifications/read-all", headers=lead)
    assert client.get("/api/notifications", params={"unread_only": True}, headers=lead).json()["unread"] == 0


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
    r = upload(client, t["id"], "lead@x.com")
    assert r.status_code == 201 and r.json()["file_name"] == "mock.png" and r.json()["size_bytes"] == len(PNG)
    got = client.get(f"/api/attachments/{r.json()['id']}/download", headers=auth(client, "des@x.com"))
    assert got.content == PNG
    assert got.headers["x-content-type-options"] == "nosniff" and "sandbox" in got.headers["content-security-policy"]
    assert len(client.get(f"/api/tickets/{t['id']}/attachments", headers=auth(client, "des@x.com")).json()) == 1


def test_attachment_validation(client, monkeypatch):
    t = make_ticket(client, "a@tata.com")
    assert upload(client, t["id"], "lead@x.com", "evil.exe", b"MZ").status_code == 415
    assert upload(client, t["id"], "lead@x.com", "logo.svg", b"<svg onload=alert(1)>").status_code == 415
    assert upload(client, t["id"], "lead@x.com", "fake.png", b"not a png at all").status_code == 415
    assert upload(client, t["id"], "lead@x.com", "empty.png", b"").status_code in (400, 415)
    monkeypatch.setattr(common, "MAX_UPLOAD_BYTES", 16)
    assert upload(client, t["id"], "lead@x.com", "big.png", PNG).status_code == 413


def test_attachment_path_traversal_in_filename_is_neutralised(client):
    t = make_ticket(client, "a@tata.com")
    r = upload(client, t["id"], "lead@x.com", "../../etc/passwd.png", PNG)
    assert r.status_code == 201 and "/" not in r.json()["file_name"] and ".." not in r.json()["file_name"].replace("passwd", "")


def test_attachment_access_is_scoped_and_delete_rules(client):
    t = make_ticket(client, "a@tata.com")
    att = upload(client, t["id"], "lead@x.com").json()
    # No token: falls back to the shared staff identity, which can download it.
    assert client.get(f"/api/attachments/{att['id']}/download").status_code == 200
    assert client.delete(f"/api/attachments/{att['id']}", headers=auth(client, "des@x.com")).status_code == 403
    assert client.delete(f"/api/attachments/{att['id']}", headers=auth(client, "lead@x.com")).status_code == 204
    assert client.get(f"/api/attachments/{att['id']}/download", headers=auth(client, "lead@x.com")).status_code == 404


# ── Figma ────────────────────────────────────────────────────────────────────

def test_figma_preview_and_ticket_validation(client):
    h = auth(client, "des@x.com")
    ok = client.get("/api/figma/preview", params={"url": "https://www.figma.com/design/AbCdEfGh12345/Spring-Sale-Banner?node-id=1-2"}, headers=h).json()
    assert ok["valid"] is True and ok["name"] == "Spring Sale Banner" and ok["embed_url"].startswith("https://www.figma.com/embed?")
    for bad in ("https://evil.com/design/AbCdEfGh12345/x", "http://www.figma.com/design/AbCdEfGh12345/x", "javascript:alert(1)",
                "https://www.figma.com.evil.io/design/AbCdEfGh12345/x"):
        assert client.get("/api/figma/preview", params={"url": bad}, headers=h).json()["valid"] is False
    body = {"title": "T", "brief": "b", "design_type_id": 1, "type_specific_fields": {}}
    r = client.post("/api/tickets", json={**body, "figma_url": "javascript:alert(1)"}, headers=h)
    assert r.status_code == 422
    r = client.post("/api/tickets", json={**body, "figma_url": "https://www.figma.com/file/AbCdEfGh12345/Thing"}, headers=h)
    assert r.status_code == 201 and r.json()["figma_url"].startswith("https://www.figma.com/")
