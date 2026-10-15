"""Files kept in the database (Vercel without S3): an upload survives with no disk, and downloads come back intact."""
import os

import database
import models
from test_auth import TestingSessionLocal, auth, client  # noqa: F401
from test_workflow_features import PNG, form, isolated  # noqa: F401


def test_uploads_are_stored_in_the_database_when_configured(client, monkeypatch):
    monkeypatch.setenv("FILE_STORAGE", "database")
    monkeypatch.setattr(database, "SessionLocal", TestingSessionLocal)
    r = client.post("/api/public/requests", data=form(), files=[("files", ("brief.png", PNG, "image/png"))])
    assert r.status_code == 201, r.text
    assert os.listdir(os.environ["UPLOAD_DIR"]) == []                      # nothing written to disk

    db = TestingSessionLocal()
    att = db.query(models.Attachment).one()
    stored = db.query(models.StoredFile).filter_by(key=att.file_url).one()
    assert bytes(stored.data) == PNG
    db.close()

    got = client.get(f"/api/attachments/{att.id}/download", headers=auth(client, "lead@x.com"))
    assert got.status_code == 200 and got.content == PNG


def test_vercel_defaults_to_the_database_unless_s3_is_set(monkeypatch):
    import common
    monkeypatch.delenv("FILE_STORAGE", raising=False)
    monkeypatch.delenv("S3_ENDPOINT_URL", raising=False)
    monkeypatch.setattr(common, "_ON_VERCEL", True)
    assert common._db_storage() is True
    monkeypatch.setenv("S3_ENDPOINT_URL", "https://s3.example.com")
    assert common._db_storage() is False
    monkeypatch.delenv("S3_ENDPOINT_URL")
    monkeypatch.setattr(common, "_ON_VERCEL", False)
    assert common._db_storage() is False
