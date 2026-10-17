"""Google Drive storage, against a fake Google: sign-in, resumable upload, ranged download and delete."""
import json
import re

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

import common
import gdrive
import models
from test_auth import TestingSessionLocal, auth, client  # noqa: F401  (shared fixture)
from test_workflow_features import PNG, clear_hits, form, isolated  # noqa: F401

KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
PEM = KEY.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()


class FakeDrive:
    """Just enough of Google's token, upload, files.get and files.update endpoints."""

    def __init__(self):
        self.files, self.names, self.trashed, self.sign_ins = {}, {}, set(), 0

    def __call__(self, req: httpx.Request) -> httpx.Response:
        url = str(req.url)
        if url.startswith("https://oauth2.googleapis.com/token"):
            claims = jwt.decode(dict(httpx.QueryParams(req.content.decode()))["assertion"], KEY.public_key(),
                                algorithms=["RS256"], audience="https://oauth2.googleapis.com/token")
            assert claims["iss"] == "dd@proj.iam.gserviceaccount.com" and claims["scope"].endswith("/auth/drive")
            self.sign_ins += 1
            return httpx.Response(200, json={"access_token": "tok", "expires_in": 3600})
        assert req.headers.get("authorization") == "Bearer tok" or "upload_id=" in url
        if "uploadType=resumable" in url:
            meta = json.loads(req.content)
            assert meta["parents"] == ["FOLDER123"] and "supportsAllDrives=true" in url
            fid = f"file{len(self.files) + 1:012d}"
            self.names[fid] = meta["name"]
            return httpx.Response(200, headers={"location": f"https://www.googleapis.com/upload/drive/v3/files?upload_id={fid}"})
        if "upload_id=" in url:
            fid = url.rsplit("=", 1)[1]
            self.files[fid] = req.content
            return httpx.Response(200, json={"id": fid})
        m = re.search(r"/files/([^?]+)", url)
        fid = m.group(1)
        if req.method == "PATCH":
            self.trashed.add(fid)
            return httpx.Response(200 if fid in self.files else 404, json={})
        if fid not in self.files or fid in self.trashed:
            return httpx.Response(404)
        data, rng = self.files[fid], req.headers.get("range")
        if not rng:
            return httpx.Response(200, content=data)
        a, b = re.fullmatch(r"bytes=(\d+)-(\d*)", rng).groups()
        a, b = int(a), min(int(b) if b else len(data) - 1, len(data) - 1)
        if a >= len(data):
            return httpx.Response(416, headers={"content-range": f"bytes */{len(data)}"})
        return httpx.Response(206, content=data[a:b + 1], headers={"content-range": f"bytes {a}-{b}/{len(data)}"})


@pytest.fixture
def drive(monkeypatch):
    fake = FakeDrive()
    creds = {"client_email": "dd@proj.iam.gserviceaccount.com", "private_key": PEM, "token_uri": "https://oauth2.googleapis.com/token"}
    monkeypatch.setenv("GOOGLE_DRIVE_CREDENTIALS", json.dumps(creds))
    monkeypatch.setenv("GOOGLE_DRIVE_FOLDER_ID", "FOLDER123")
    monkeypatch.setattr(gdrive, "_client", lambda: httpx.Client(transport=httpx.MockTransport(fake)))
    monkeypatch.setattr(gdrive, "_token", {"value": None, "expires": 0.0})
    return fake


def test_files_go_to_drive_under_their_own_name_and_come_back_in_ranges(client, drive):
    r = client.post("/api/public/requests", data=form(), files={"files": ("Event Circular.png", PNG + b"x" * 5000, "image/png")})
    assert r.status_code == 201, r.text
    clear_hits()
    db = TestingSessionLocal()
    att = db.query(models.Attachment).one()
    db.close()
    assert att.file_url.startswith("gd-file") and att.file_url.endswith(".png")
    assert list(drive.names.values()) == ["Event Circular.png"]

    lead = auth(client, "lead@x.com")
    url = f"/api/attachments/{att.id}/download"
    whole = client.get(url, headers=lead)
    assert whole.status_code == 200 and whole.content == PNG + b"x" * 5000
    part = client.get(url, headers={**lead, "Range": "bytes=0-99"})
    assert part.status_code == 206 and part.content == whole.content[:100]
    assert part.headers["content-range"] == f"bytes 0-99/{len(whole.content)}"
    assert client.get(url, headers={**lead, "Range": "bytes=999999-"}).status_code == 416
    assert drive.sign_ins == 1   # the token is reused


def test_files_from_before_drive_keep_working_and_deletes_go_to_drive_trash(client, drive, monkeypatch):
    monkeypatch.delenv("GOOGLE_DRIVE_CREDENTIALS")
    old_key = common.store_bytes(b"old bytes", "txt")                 # stored before Drive was switched on
    monkeypatch.setenv("GOOGLE_DRIVE_CREDENTIALS", json.dumps({"client_email": "dd@proj.iam.gserviceaccount.com", "private_key": PEM}))
    assert common.load_bytes(old_key) == b"old bytes"

    new_key = common.store_bytes(b"new bytes", "txt", "notes.txt")
    assert new_key.startswith("gd-") and common.load_bytes(new_key) == b"new bytes"
    common.delete_stored_file(new_key)
    assert drive.trashed == {new_key[3:-4]}


def test_a_drive_failure_is_a_clear_error_not_a_lost_file(client, drive, monkeypatch):
    monkeypatch.setattr(gdrive, "_client", lambda: httpx.Client(transport=httpx.MockTransport(lambda req: httpx.Response(500))))
    r = client.post("/api/public/requests", data=form(), files={"files": ("brief.png", PNG, "image/png")})
    assert r.status_code == 502 and "Google Drive" in r.json()["detail"]
    db = TestingSessionLocal()
    assert db.query(models.Ticket).count() == 0
    db.close()
