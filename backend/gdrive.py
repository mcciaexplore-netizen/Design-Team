"""Google Drive file storage: a folder in a Google Workspace Shared Drive, reached with a service account.

Set GOOGLE_DRIVE_CREDENTIALS (the service account's JSON key, as-is or base64-encoded) and GOOGLE_DRIVE_FOLDER_ID (the
folder's id from its URL, or the Shared Drive's own id). The service account must be a member of that Shared Drive as
Content manager. A plain My Drive does not work: Google gives service accounts no storage of their own.

Talks to the Drive REST API directly with httpx; the token is a JWT signed with the key (RS256, via cryptography)."""
import base64
import json
import os
import threading
import time
from typing import Optional

import httpx
import jwt

SCOPE = "https://www.googleapis.com/auth/drive"
API = "https://www.googleapis.com/drive/v3/files"
UPLOAD = "https://www.googleapis.com/upload/drive/v3/files"
TIMEOUT = httpx.Timeout(50.0, connect=10.0)

_token: dict = {"value": None, "expires": 0.0}
_lock = threading.Lock()


class DriveError(Exception):
    pass


def enabled() -> bool:
    return bool(os.getenv("GOOGLE_DRIVE_CREDENTIALS") and os.getenv("GOOGLE_DRIVE_FOLDER_ID"))


def _credentials() -> dict:
    raw = os.environ["GOOGLE_DRIVE_CREDENTIALS"].strip()
    if not raw.startswith("{"):
        raw = base64.b64decode(raw).decode()
    return json.loads(raw)


def _client() -> httpx.Client:
    """One place to build the HTTP client, so tests can swap in a fake Google."""
    return httpx.Client(timeout=TIMEOUT)


def _access_token(http: httpx.Client) -> str:
    with _lock:
        if _token["value"] and time.time() < _token["expires"] - 60:
            return _token["value"]
        creds = _credentials()
        now = int(time.time())
        token_uri = creds.get("token_uri", "https://oauth2.googleapis.com/token")
        assertion = jwt.encode({"iss": creds["client_email"], "scope": SCOPE, "aud": token_uri, "iat": now, "exp": now + 3600},
                               creds["private_key"], algorithm="RS256")
        r = http.post(token_uri, data={"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": assertion})
        if r.status_code != 200:
            raise DriveError(f"Google sign-in failed ({r.status_code}): {r.text[:200]}")
        body = r.json()
        _token.update(value=body["access_token"], expires=time.time() + int(body.get("expires_in", 3600)))
        return _token["value"]


def _auth(http: httpx.Client) -> dict:
    return {"Authorization": f"Bearer {_access_token(http)}"}


def upload(data: bytes, name: str, content_type: str = "application/octet-stream") -> str:
    """Store the bytes as a new file in the folder and return its Drive file id. Resumable upload, so size is no issue."""
    with _client() as http:
        start = http.post(f"{UPLOAD}?uploadType=resumable&supportsAllDrives=true&fields=id",
                          headers={**_auth(http), "X-Upload-Content-Type": content_type, "X-Upload-Content-Length": str(len(data))},
                          json={"name": name, "parents": [os.environ["GOOGLE_DRIVE_FOLDER_ID"]]})
        if start.status_code != 200 or "location" not in start.headers:
            raise DriveError(f"Drive refused the upload ({start.status_code}): {start.text[:200]}")
        done = http.put(start.headers["location"], content=data, headers={"Content-Type": content_type})
        if done.status_code not in (200, 201):
            raise DriveError(f"Drive upload failed ({done.status_code}): {done.text[:200]}")
        return done.json()["id"]


def download(file_id: str, start: Optional[int] = None, end: Optional[int] = None) -> tuple[bytes, int]:
    """The file's bytes (or bytes start..end inclusive) and the file's total size. Raises FileNotFoundError."""
    with _client() as http:
        headers = _auth(http)
        if start is not None:
            headers["Range"] = f"bytes={start}-{'' if end is None else end}"
        r = http.get(f"{API}/{file_id}?alt=media&supportsAllDrives=true", headers=headers)
        if r.status_code == 404:
            raise FileNotFoundError(file_id)
        if r.status_code == 416:
            return b"", int(r.headers.get("content-range", "*/0").rsplit("/", 1)[-1] or 0)
        if r.status_code not in (200, 206):
            raise DriveError(f"Drive download failed ({r.status_code}): {r.text[:200]}")
        total = int(r.headers["content-range"].rsplit("/", 1)[-1]) if r.status_code == 206 else len(r.content)
        return r.content, total


def delete(file_id: str) -> None:
    """Move the file to the Shared Drive's trash (recoverable for 30 days). A missing file is not an error."""
    with _client() as http:
        r = http.patch(f"{API}/{file_id}?supportsAllDrives=true", headers=_auth(http), json={"trashed": True})
        if r.status_code not in (200, 404):
            raise DriveError(f"Drive delete failed ({r.status_code}): {r.text[:200]}")
