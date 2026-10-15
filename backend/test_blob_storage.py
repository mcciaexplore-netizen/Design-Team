"""Vercel Blob storage: store_bytes/load_bytes send the same requests as the @vercel/blob SDK (network faked)."""
import httpx
import pytest
from fastapi import HTTPException

import common

TOKEN = "vercel_blob_rw_AbC123store_s3cr3tpart"


@pytest.fixture
def blob(monkeypatch):
    monkeypatch.delenv("S3_ENDPOINT_URL", raising=False)
    monkeypatch.delenv("BLOB_ACCESS", raising=False)
    monkeypatch.setenv("BLOB_READ_WRITE_TOKEN", TOKEN)
    files, calls = {}, []

    def fake_put(url, content, headers, timeout):
        calls.append(("PUT", url, headers))
        files[url.split("pathname=")[1]] = content
        return httpx.Response(200, json={"url": "x"})

    def fake_get(url, headers, timeout):
        calls.append(("GET", url, headers))
        key = url.rsplit("/", 1)[1]
        req = httpx.Request("GET", url)
        return httpx.Response(200, content=files[key], request=req) if key in files else httpx.Response(404, request=req)

    monkeypatch.setattr(common.httpx, "put", fake_put)
    monkeypatch.setattr(common.httpx, "get", fake_get)
    return files, calls


def test_round_trip_uses_private_blob_store(blob):
    files, calls = blob
    key = common.store_bytes(b"hello", "png")
    assert common.load_bytes(key) == b"hello"

    method, url, headers = calls[0]
    assert method == "PUT" and url == f"https://vercel.com/api/blob/?pathname={key}"
    assert headers["authorization"] == f"Bearer {TOKEN}"
    assert headers["x-vercel-blob-access"] == "private"
    assert headers["x-vercel-blob-store-id"] == "AbC123store"
    assert headers["x-add-random-suffix"] == "0"
    assert calls[1][1] == f"https://AbC123store.private.blob.vercel-storage.com/{key}"
    assert calls[1][2]["authorization"] == f"Bearer {TOKEN}"


def test_missing_blob_is_404(blob):
    with pytest.raises(HTTPException) as exc:
        common.load_bytes("0" * 32 + ".png")
    assert exc.value.status_code == 404


def test_s3_takes_precedence(blob, monkeypatch):
    monkeypatch.setenv("S3_ENDPOINT_URL", "https://s3.example.com")
    assert common._blob_token() is None
