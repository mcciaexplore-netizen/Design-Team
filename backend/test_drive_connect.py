"""Connect Google Drive from Settings: sign in on the website, keep the sign-in, remind before Google ends it, and keep
uploads working (in the database) once it has ended."""
import datetime
import json
import urllib.parse

import httpx
import jwt
import pytest

import common
import cron_jobs
import gdrive
import models
from test_auth import TestingSessionLocal, auth, client  # noqa: F401  (shared fixture)
from test_workflow_features import isolated  # noqa: F401


class FakeGoogle:
    """Google's token endpoint (code and refresh-token grants), folder create/get and resumable upload."""

    def __init__(self):
        self.refresh_ok, self.folders, self.files, self.lasts = True, {}, {}, 604799
        self.email, self.down, self.garbled = "studio@gmail.com", False, False

    def __call__(self, req: httpx.Request) -> httpx.Response:
        url = str(req.url)
        if self.down:
            raise httpx.ConnectError("Google is unreachable", request=req)
        if url.startswith(gdrive.TOKEN_URI):
            form = dict(httpx.QueryParams(req.content.decode()))
            assert (form["client_id"], form["client_secret"]) == ("cid", "csecret")
            if form["grant_type"] == "authorization_code":
                assert form["code"] == "good-code" and form["redirect_uri"].endswith("/api/integrations/drive/callback")
                if self.garbled:
                    return httpx.Response(200, text="<html>Service Unavailable</html>")
                id_token = jwt.encode({"email": self.email}, "k" * 32, algorithm="HS256")
                return httpx.Response(200, json={"access_token": "at", "refresh_token": "rt-1", "id_token": id_token,
                                                 **({"refresh_token_expires_in": self.lasts} if self.lasts else {})})
            if not self.refresh_ok:
                return httpx.Response(400, json={"error": "invalid_grant", "error_description": "Token has been expired or revoked."})
            return httpx.Response(200, json={"access_token": "at", "expires_in": 3600})
        if "uploadType=resumable" in url:
            assert json.loads(req.content)["parents"] == ["F1"]
            return httpx.Response(200, headers={"location": "https://www.googleapis.com/upload/drive/v3/files?upload_id=x"})
        if "upload_id=" in url:
            self.files["D1"] = req.content
            return httpx.Response(200, json={"id": "D1"})
        if req.method == "POST" and url.startswith(gdrive.API):
            assert json.loads(req.content)["name"] == "DesignDesk files"
            self.folders["F1"] = False
            return httpx.Response(200, json={"id": "F1"})
        fid = url.split("/files/")[1].split("?")[0]
        if fid in self.folders:
            return httpx.Response(200, json={"id": fid, "trashed": self.folders[fid], "name": "DesignDesk files",
                                             "mimeType": "application/vnd.google-apps.folder",
                                             "capabilities": {"canAddChildren": True}})
        return httpx.Response(404)


@pytest.fixture
def google(monkeypatch):
    fake = FakeGoogle()
    for name in ("GOOGLE_DRIVE_CREDENTIALS", "GOOGLE_DRIVE_OAUTH", "GOOGLE_DRIVE_FOLDER_ID", "VERCEL"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "cid")
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_SECRET", "csecret")
    monkeypatch.setattr(gdrive, "_client", lambda: httpx.Client(transport=httpx.MockTransport(fake)))
    monkeypatch.setattr(gdrive, "_session", TestingSessionLocal)
    monkeypatch.setattr(gdrive, "_token", {"value": None, "expires": 0.0})
    monkeypatch.setattr(gdrive, "_cache", {"value": None, "at": 0.0})
    return fake


def connect(client, lead, switch=False):
    url = client.post(f"/api/integrations/drive/connect?switch={str(switch).lower()}", headers=lead).json()["url"]
    q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(url).query))
    assert "drive.file" in q["scope"] and q["access_type"] == "offline" and q["client_id"] == "cid"
    return client.get(f"/api/integrations/drive/callback?code=good-code&state={q['state']}", follow_redirects=False)


def settings(client, lead):
    return client.get("/api/settings/integrations", headers=lead).json()


def test_connect_from_settings_then_uploads_go_to_that_drive(client, google):
    lead = auth(client, "lead@x.com")
    before = settings(client, lead)
    assert before["drive_connect_ready"] is True and before["drive_connected_at"] is None
    assert before["file_storage"] != "Google Drive"

    r = connect(client, lead)
    assert r.status_code == 303 and r.headers["location"].endswith("/settings?drive=connected")
    after = settings(client, lead)
    assert after["file_storage"] == "Google Drive" and after["drive_connected_as"] == "studio@gmail.com"
    assert after["drive_expires_at"] and not after["drive_lapsed"]
    assert common.store_bytes(b"logo", "png", "logo.png") == "gd-D1.png" and google.files["D1"] == b"logo"
    check = client.post("/api/integrations/drive/test", headers=lead).json()
    assert check == {"ok": True, "detail": 'Connected. New uploads go to the folder "DesignDesk files" as studio@gmail.com.'}


def test_reminder_a_day_ahead_then_uploads_fall_back_to_the_database_until_reconnected(client, google):
    lead = auth(client, "lead@x.com")
    connect(client, lead)
    db = TestingSessionLocal()
    start = datetime.datetime.now(datetime.timezone.utc)
    cron_jobs.drive_sign_in(db, start + datetime.timedelta(days=3))
    assert db.query(models.Notification).count() == 0
    for _ in range(2):   # once only
        cron_jobs.drive_sign_in(db, start + datetime.timedelta(days=6, hours=2))
    texts = [n.content for n in db.query(models.Notification).all()]
    assert len(texts) == 1 and "Google Drive disconnects on" in texts[0]   # only the lead in the fixture

    # Google ends the sign-in early: the upload that finds out is kept in the database, and so are the next ones.
    google.refresh_ok = False
    gdrive._token.update(value=None, expires=0.0)
    key = common.store_bytes(b"poster", "png", "poster.png")
    assert not key.startswith("gd-") and common.load_bytes(key) == b"poster"
    assert settings(client, lead)["drive_lapsed"] is True and settings(client, lead)["file_storage"] != "Google Drive"
    assert "Reconnect" in client.post("/api/integrations/drive/test", headers=lead).json()["detail"]
    cron_jobs.drive_sign_in(db, start + datetime.timedelta(days=8))
    assert any("disconnected" in n.content for n in db.query(models.Notification).all())

    # Reconnecting keeps the same folder and clears the lapse.
    google.refresh_ok = True
    connect(client, lead)
    again = settings(client, lead)
    assert again["file_storage"] == "Google Drive" and not again["drive_lapsed"] and google.folders == {"F1": False}
    db.close()


def test_without_a_limit_there_is_no_reminder(client, google):
    google.lasts = None   # project In production / Internal: Google doesn't end the sign-in
    lead = auth(client, "lead@x.com")
    connect(client, lead)
    assert settings(client, lead)["drive_expires_at"] is None
    db = TestingSessionLocal()
    cron_jobs.drive_sign_in(db, datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=30))
    assert db.query(models.Notification).count() == 0
    db.close()


def test_only_a_lead_can_connect_and_a_forged_return_does_nothing(client, google):
    assert client.post("/api/integrations/drive/connect", headers=auth(client, "des@x.com")).status_code == 403
    r = client.get("/api/integrations/drive/callback?code=good-code&state=forged", follow_redirects=False)
    assert r.headers["location"].endswith("drive=expired") and gdrive.connection(fresh=True) is None
    lead = auth(client, "lead@x.com")
    url = client.post("/api/integrations/drive/connect", headers=lead).json()["url"]
    state = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(url).query))["state"]
    r = client.get(f"/api/integrations/drive/callback?error=access_denied&state={state}", follow_redirects=False)
    assert r.headers["location"].endswith("drive=refused") and gdrive.connection(fresh=True) is None


def test_reconnecting_with_another_account_is_refused_unless_the_lead_chose_to_switch(client, google):
    lead = auth(client, "lead@x.com")
    connect(client, lead)
    google.email = "someone-else@gmail.com"   # their files can't be opened with this account (drive.file)
    r = connect(client, lead)
    assert r.headers["location"].endswith("drive=other-account")
    assert settings(client, lead)["drive_connected_as"] == "studio@gmail.com"

    google.email = "STUDIO@gmail.com"   # the same account, however Google cases it
    assert connect(client, lead).headers["location"].endswith("drive=connected")

    google.email = "someone-else@gmail.com"
    assert connect(client, lead, switch=True).headers["location"].endswith("drive=connected")
    assert settings(client, lead)["drive_connected_as"] == "someone-else@gmail.com"


@pytest.mark.parametrize("trouble", ["down", "garbled"])
def test_google_unreachable_or_unreadable_returns_to_settings_with_a_message(client, google, trouble):
    lead = auth(client, "lead@x.com")
    setattr(google, trouble, True)
    r = connect(client, lead)
    assert r.status_code == 303 and r.headers["location"].endswith("drive=failed")
    assert gdrive.connection(fresh=True) is None


def test_the_refresh_token_is_stored_encrypted(client, google, monkeypatch):
    lead = auth(client, "lead@x.com")
    connect(client, lead)
    db = TestingSessionLocal()
    stored = db.query(models.AppSetting).filter(models.AppSetting.key == gdrive.CONNECTION_KEY).first().value
    db.close()
    assert "refresh_token" not in stored and "rt-1" not in json.dumps(stored)
    assert gdrive.connection(fresh=True)["refresh_token"] == "rt-1"

    import auth as auth_module   # SECRET_KEY changed: the saved sign-in can't be read, so Settings asks to reconnect
    monkeypatch.setattr(auth_module, "SECRET_KEY", "a-different-secret-key-for-this-test")
    assert gdrive.connection(fresh=True)["lapsed"] is True
    assert settings(client, auth(client, "lead@x.com"))["drive_lapsed"] is True


def test_a_lead_deactivated_during_the_sign_in_does_not_connect_drive(client, google):
    lead = auth(client, "lead@x.com")
    url = client.post("/api/integrations/drive/connect", headers=lead).json()["url"]
    state = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(url).query))["state"]
    db = TestingSessionLocal()
    db.query(models.User).filter(models.User.email == "lead@x.com").update({"is_active": False})
    db.commit()
    db.close()
    r = client.get(f"/api/integrations/drive/callback?code=good-code&state={state}", follow_redirects=False)
    assert r.headers["location"].endswith("drive=expired") and gdrive.connection(fresh=True) is None
