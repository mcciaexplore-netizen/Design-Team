"""Big files in pieces: Vercel refuses request and response bodies over 4.5 MB, so files go up in parts and come down
as byte ranges."""
import datetime
import os
import uuid

import pytest

import common
import cron_jobs
import database
import models
import uploads
from test_auth import TestingSessionLocal, auth, client  # noqa: F401  (shared fixture)
from test_workflow_features import PNG, clear_hits, form, isolated  # noqa: F401

BIG = PNG + os.urandom(common.PART_BYTES + 1000)   # a valid PNG just over one piece


@pytest.fixture(autouse=True)
def shared_sessions(monkeypatch):
    monkeypatch.setattr(database, "SessionLocal", TestingSessionLocal)


def stage(client, data, size=common.PART_BYTES):
    upload_id = uuid.uuid4().hex
    pieces = [data[i:i + size] for i in range(0, len(data), size)]
    for n, piece in enumerate(pieces):
        r = client.put(f"/api/uploads/{upload_id}/parts/{n}", content=piece)
        assert r.status_code == 204, r.text
    return upload_id, common.STAGED_PREFIX + f"{upload_id}:{len(pieces)}".encode()


def a_ticket(client):
    r = client.post("/api/public/requests", data=form())
    assert r.status_code == 201, r.text
    clear_hits()
    return client.get("/api/tickets", headers=auth(client, "lead@x.com")).json()[0]["id"]


def parts_left(upload_id):
    db = TestingSessionLocal()
    try:
        return db.query(models.UploadPart).filter(models.UploadPart.upload_id == upload_id).count()
    finally:
        db.close()


def test_a_file_sent_in_pieces_is_joined_and_downloads_in_ranges(client):
    tid = a_ticket(client)
    upload_id, marker = stage(client, BIG)
    lead = auth(client, "lead@x.com")
    r = client.post(f"/api/tickets/{tid}/attachments", files={"file": ("poster.png", marker, "image/png")}, headers=lead)
    assert r.status_code == 201, r.text
    assert r.json()["size_bytes"] == len(BIG)
    assert parts_left(upload_id) == 0

    url = f"/api/attachments/{r.json()['id']}/download"
    assert client.get(url, headers=lead).content == BIG
    first = client.get(url, headers={**lead, "Range": f"bytes=0-{common.PART_BYTES - 1}"})
    assert first.status_code == 206
    assert first.headers["content-range"] == f"bytes 0-{common.PART_BYTES - 1}/{len(BIG)}"
    rest = client.get(url, headers={**lead, "Range": f"bytes={common.PART_BYTES}-"})
    assert first.content + rest.content == BIG
    assert client.get(url, headers={**lead, "Range": f"bytes={len(BIG)}-"}).status_code == 416


def test_the_public_form_takes_a_file_sent_in_pieces(client):
    _, marker = stage(client, BIG)
    r = client.post("/api/public/requests", data=form(), files={"files": ("brief.png", marker, "image/png")})
    assert r.status_code == 201, r.text
    db = TestingSessionLocal()
    assert db.query(models.Attachment).one().size_bytes == len(BIG)
    db.close()


def test_a_missing_piece_or_bad_input_is_refused(client):
    tid = a_ticket(client)
    upload_id, marker = stage(client, BIG)
    db = TestingSessionLocal()
    db.query(models.UploadPart).filter(models.UploadPart.part == 1).delete()
    db.commit()
    db.close()
    r = client.post(f"/api/tickets/{tid}/attachments", files={"file": ("poster.png", marker, "image/png")}, headers=auth(client, "lead@x.com"))
    assert r.status_code == 400

    assert client.put("/api/uploads/not-an-id/parts/0", content=b"x").status_code == 404
    assert client.put(f"/api/uploads/{upload_id}/parts/{uploads.MAX_PARTS}", content=b"x").status_code == 404
    assert client.put(f"/api/uploads/{upload_id}/parts/0", content=b"x" * (common.PART_BYTES + 1)).status_code == 413
    # The joined file still has to pass the usual checks: a .png that isn't a PNG is refused.
    _, fake = stage(client, b"not a png at all")
    r = client.post(f"/api/tickets/{tid}/attachments", files={"file": ("x.png", fake, "image/png")}, headers=auth(client, "lead@x.com"))
    assert r.status_code == 415


def test_unfinished_pieces_are_cleared_by_the_scheduled_jobs(client):
    upload_id, _ = stage(client, b"abc")
    db = TestingSessionLocal()
    db.query(models.UploadPart).update({"created_at": datetime.datetime.now(datetime.timezone.utc) - uploads.STALE_AFTER * 2})
    db.commit()
    cron_jobs.run_all_cron_jobs(db)
    db.close()
    assert parts_left(upload_id) == 0
