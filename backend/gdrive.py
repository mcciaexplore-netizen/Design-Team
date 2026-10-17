"""Google Drive file storage, in one folder (GOOGLE_DRIVE_FOLDER_ID: its id from the URL, or the whole link). Two ways in:

* A person's own Drive (My Drive works): GOOGLE_DRIVE_OAUTH, the JSON that `python drive_connect.py` prints after that
  person signs in to Google once, with the folder that script makes (it only grants access to DesignDesk's own files).
  Files count against that person's storage.
* A Workspace Shared Drive: GOOGLE_DRIVE_CREDENTIALS, a service account's JSON key (as-is or base64-encoded); the service
  account must be a member of the Shared Drive as Content manager. It cannot use a My Drive: Google gives service
  accounts no storage of their own.

Talks to the Drive REST API directly with httpx. A service account signs a JWT with its key (RS256, via cryptography);
the personal way swaps its refresh token for an access token."""
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


TOKEN_URI = "https://oauth2.googleapis.com/token"


def enabled() -> bool:
    return bool((os.getenv("GOOGLE_DRIVE_OAUTH") or os.getenv("GOOGLE_DRIVE_CREDENTIALS")) and os.getenv("GOOGLE_DRIVE_FOLDER_ID"))


def _personal() -> Optional[dict]:
    """client_id, client_secret and refresh_token for a person's own Drive, when that way is set up."""
    raw = os.getenv("GOOGLE_DRIVE_OAUTH", "").strip()
    return json.loads(raw) if raw else None


def _folder_id() -> str:
    """The folder id, also when the whole folder link was pasted (…/folders/<id>?usp=sharing)."""
    raw = os.environ["GOOGLE_DRIVE_FOLDER_ID"].strip()
    if "/folders/" in raw:
        raw = raw.split("/folders/", 1)[1]
    return raw.split("?", 1)[0].strip("/")


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
        personal = _personal()
        if personal:
            r = http.post(TOKEN_URI, data={"grant_type": "refresh_token", "refresh_token": personal["refresh_token"],
                                           "client_id": personal["client_id"], "client_secret": personal["client_secret"]})
        else:
            creds = _credentials()
            now = int(time.time())
            token_uri = creds.get("token_uri", TOKEN_URI)
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
                          json={"name": name, "parents": [_folder_id()]})
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


def check() -> tuple[bool, str]:
    """Sign in and look at the folder, without storing anything: is Drive really ready for uploads? (Settings)"""
    if not enabled():
        return False, ("Google Drive is not set up: add GOOGLE_DRIVE_OAUTH (or GOOGLE_DRIVE_CREDENTIALS) and "
                       "GOOGLE_DRIVE_FOLDER_ID in Vercel, then redeploy.")
    try:
        personal = _personal()
        if personal:
            who = "your Google account"
            personal["client_id"], personal["client_secret"], personal["refresh_token"]
        else:
            creds = _credentials()
            who = creds["client_email"]
            creds["private_key"]
    except (ValueError, KeyError, TypeError):
        if os.getenv("GOOGLE_DRIVE_OAUTH"):
            return False, "GOOGLE_DRIVE_OAUTH is not what drive_connect.py printed. Paste that whole line again, from { to }."
        return False, "GOOGLE_DRIVE_CREDENTIALS is not the service account's JSON key. Paste the whole .json file, from { to }."
    try:
        with _client() as http:
            headers = _auth(http)
            r = http.get(f"{API}/{_folder_id()}?supportsAllDrives=true&fields=name,mimeType,driveId,capabilities(canAddChildren)",
                         headers=headers)
    except DriveError:
        if personal:
            return False, "Google no longer accepts the sign-in in GOOGLE_DRIVE_OAUTH. Run drive_connect.py again and paste the new line."
        return False, f"Google refused the key for {who}. Make a new JSON key for it and paste the whole file again."
    except httpx.HTTPError as exc:
        return False, f"Could not reach Google: {exc.__class__.__name__}"
    if r.status_code == 404:
        if personal:
            return False, (f"DesignDesk can't open the folder {_folder_id()}. With your own Drive it can only use the folder "
                           "drive_connect.py made: put the GOOGLE_DRIVE_FOLDER_ID it printed in Vercel.")
        return False, (f"The folder {_folder_id()} was not found, or {who} is not a member of its Shared Drive. "
                       "In Drive: the Shared Drive > Manage members > add that address as Content manager.")
    if r.status_code != 200:
        return False, f"Google answered {r.status_code}: {r.text[:200]}"
    folder = r.json()
    name = folder.get("name")
    if folder.get("mimeType") != "application/vnd.google-apps.folder":
        return False, "GOOGLE_DRIVE_FOLDER_ID points to a file, not a folder."
    if not personal and not folder.get("driveId"):
        return False, (f"\"{name}\" is in a My Drive, which a service account can't save to. Use a folder inside a Shared "
                       "Drive, or connect your own Drive with drive_connect.py (see DEPLOY.md).")
    if not folder.get("capabilities", {}).get("canAddChildren"):
        return False, f"{who} can see \"{name}\" but may not add files to it. Give it edit access."
    return True, f"Connected. New uploads go to the folder \"{name}\" as {who}."
