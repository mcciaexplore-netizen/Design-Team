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


# ── Connected from Settings ("Connect Google Drive") ─────────────────────────
# GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET name the OAuth client; the sign-in itself (refresh token, folder,
# when, by whom) is kept in app_settings under this key, so nobody pastes tokens into Vercel. While the Google project
# is in "Testing", Google ends the sign-in after 7 days: Settings shows when, leads get a reminder, and once it has
# lapsed new uploads go to the database until someone reconnects.
CONNECTION_KEY = "google_drive_connection"
CONNECTION_DAYS = 7
_cache: dict = {"value": None, "at": 0.0}


def oauth_client() -> Optional[tuple[str, str]]:
    cid, secret = os.getenv("GOOGLE_OAUTH_CLIENT_ID", "").strip(), os.getenv("GOOGLE_OAUTH_CLIENT_SECRET", "").strip()
    return (cid, secret) if cid and secret else None


def _session():
    from database import SessionLocal   # tests swap this for their own database
    return SessionLocal()


def _fernet():
    """The refresh token is kept encrypted with a key derived from SECRET_KEY, so a copy of the database alone doesn't
    give access to the Drive. Changing SECRET_KEY means connecting Drive again."""
    import hashlib
    from cryptography.fernet import Fernet
    from auth import SECRET_KEY
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(f"google-drive:{SECRET_KEY}".encode()).digest()))


def _sealed(value: dict) -> dict:
    stored = {k: v for k, v in value.items() if k != "refresh_token"}
    if value.get("refresh_token"):
        stored["refresh_token_enc"] = _fernet().encrypt(value["refresh_token"].encode()).decode()
    return stored


def _opened(stored: dict) -> dict:
    from cryptography.fernet import InvalidToken
    value = {k: v for k, v in stored.items() if k != "refresh_token_enc"}
    if stored.get("refresh_token_enc"):
        try:
            value["refresh_token"] = _fernet().decrypt(stored["refresh_token_enc"].encode()).decode()
        except InvalidToken:   # SECRET_KEY changed since it was saved: treat it as ended, so Settings asks to reconnect
            value["lapsed"] = True
    return value


def connection(fresh: bool = False) -> Optional[dict]:
    """The sign-in saved from Settings, or None. Cached for 30 seconds: it is read on every upload."""
    if not oauth_client():
        return None
    if fresh or time.time() - _cache["at"] > 30:
        import models
        db = _session()
        try:
            row = db.query(models.AppSetting).filter(models.AppSetting.key == CONNECTION_KEY).first()
            _cache.update(value=_opened(row.value) if row and row.value else None, at=time.time())
        finally:
            db.close()
    return dict(_cache["value"]) if _cache["value"] else None   # a copy: callers change it before saving


def save_connection(value: Optional[dict]) -> None:
    import models
    db = _session()
    try:
        row = db.query(models.AppSetting).filter(models.AppSetting.key == CONNECTION_KEY).first()
        if row is None:
            row = models.AppSetting(key=CONNECTION_KEY)
            db.add(row)
        row.value = _sealed(value) if value else value
        db.commit()
    finally:
        db.close()
    _cache.update(value=dict(value) if value else None, at=time.time())
    _token.update(value=None, expires=0.0)   # the next request signs in with the new refresh token


def _usable_connection() -> Optional[dict]:
    c = connection()
    return c if c and c.get("refresh_token") and c.get("folder_id") and not c.get("lapsed") else None


def _env_json(name: str) -> Optional[dict]:
    """The JSON object in a setting, forgiving the usual paste slips: surrounding quotes, the whole `NAME = {...}` line,
    or base64. None when it is unset or still unreadable."""
    raw = os.getenv(name, "").strip()
    if raw.startswith(name):
        raw = raw[len(name):].strip().lstrip("=").strip()
    if raw.startswith('"'):   # the JSON pasted as a quoted, escaped string: "{\"client_id\": …}"
        try:
            inner = json.loads(raw)
            raw = inner.strip() if isinstance(inner, str) else raw
        except ValueError:
            pass
    if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in "'\"":
        raw = raw[1:-1].strip()
    if not raw:
        return None
    try:
        if not raw.startswith("{"):
            raw = base64.b64decode(raw, validate=True).decode()
        value = json.loads(raw)
    except ValueError:   # also covers bad base64 and UnicodeDecodeError
        return None
    return value if isinstance(value, dict) else None


def _env_oauth() -> Optional[dict]:
    """GOOGLE_DRIVE_OAUTH, when it is the line drive_connect.py printed."""
    value = _env_json("GOOGLE_DRIVE_OAUTH")
    return value if value and all(value.get(k) for k in ("client_id", "client_secret", "refresh_token")) else None


def _env_credentials() -> Optional[dict]:
    """GOOGLE_DRIVE_CREDENTIALS, when it is a service account's JSON key."""
    value = _env_json("GOOGLE_DRIVE_CREDENTIALS")
    return value if value and value.get("client_email") and value.get("private_key") else None


def enabled() -> bool:
    # A setting that can't be read doesn't count: uploads then go to the next storage instead of all failing, and
    # Check Google Drive in Settings says what is wrong with it (_env_problem).
    if os.getenv("GOOGLE_DRIVE_FOLDER_ID", "").strip() and (_env_oauth() or _env_credentials()):
        return True
    return _usable_connection() is not None


def _env_problem() -> Optional[str]:
    """What is wrong with GOOGLE_DRIVE_OAUTH / GOOGLE_DRIVE_CREDENTIALS, when GOOGLE_DRIVE_FOLDER_ID says they are meant
    to be used and neither can be."""
    if not os.getenv("GOOGLE_DRIVE_FOLDER_ID", "").strip() or _env_oauth() or _env_credentials():
        return None
    from common import storage_name
    meanwhile = f" Until then new uploads go to: {storage_name()}."
    if os.getenv("GOOGLE_DRIVE_OAUTH", "").strip():
        pasted = _env_json("GOOGLE_DRIVE_OAUTH") or {}
        if "installed" in pasted or "web" in pasted:
            return ("GOOGLE_DRIVE_OAUTH holds the OAuth client file downloaded from Google, not the line drive_connect.py "
                    "printed. Run python drive_connect.py with that file and paste the line it prints, from { to }." + meanwhile)
        return "GOOGLE_DRIVE_OAUTH is not what drive_connect.py printed. Paste that whole line again, from { to }." + meanwhile
    if os.getenv("GOOGLE_DRIVE_CREDENTIALS", "").strip():
        return "GOOGLE_DRIVE_CREDENTIALS is not the service account's JSON key. Paste the whole .json file, from { to }." + meanwhile
    return None


def _personal() -> Optional[dict]:
    """client_id, client_secret and refresh_token for a person's own Drive, when that way is set up."""
    env = _env_oauth()
    if env:
        return env
    c = _usable_connection() if not _env_credentials() else None
    if c:
        cid, secret = oauth_client()
        return {"client_id": cid, "client_secret": secret, "refresh_token": c["refresh_token"], "saved": True}
    return None


def _folder_id() -> str:
    """The folder id, also when the whole folder link was pasted (…/folders/<id>?usp=sharing)."""
    raw = os.getenv("GOOGLE_DRIVE_FOLDER_ID", "").strip()
    if not raw:
        return (_usable_connection() or {}).get("folder_id", "")
    if "/folders/" in raw:
        raw = raw.split("/folders/", 1)[1]
    return raw.split("?", 1)[0].strip("/")


def _credentials() -> dict:
    creds = _env_credentials()
    if not creds:
        raise ValueError("GOOGLE_DRIVE_CREDENTIALS is not a service account's JSON key")
    return creds


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
            if personal and personal.get("saved") and "invalid_grant" in r.text:
                # The saved sign-in has run out: stop using Drive (uploads go to the database) until someone reconnects.
                current = connection(fresh=True)
                if current and not current.get("lapsed"):
                    save_connection({**current, "lapsed": True})
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
    problem = _env_problem()
    if problem:
        return False, problem
    if not enabled():
        c = connection(fresh=True)
        if c and c.get("lapsed"):
            return False, "Google ended the Drive sign-in. Click Reconnect Google Drive; until then new uploads go to the database."
        if oauth_client():
            return False, "Google Drive is not connected yet. Click Connect Google Drive."
        return False, ("Google Drive is not set up: add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in Vercel "
                       "and redeploy, then click Connect Google Drive here (DEPLOY.md has the steps).")
    personal = _personal()   # enabled() and _env_problem() above mean the settings in use can be read
    if personal:
        who = personal.get("email") or (connection() or {}).get("email") or "your Google account"
    else:
        who = _credentials()["client_email"]
    try:
        with _client() as http:
            headers = _auth(http)
            r = http.get(f"{API}/{_folder_id()}?supportsAllDrives=true&fields=name,mimeType,driveId,capabilities(canAddChildren)",
                         headers=headers)
    except DriveError:
        if personal and personal.get("saved"):
            return False, "Google ended the Drive sign-in. Click Reconnect Google Drive; until then new uploads go to the database."
        if personal:
            return False, "Google no longer accepts the sign-in in GOOGLE_DRIVE_OAUTH. Run drive_connect.py again and paste the new line."
        return False, f"Google refused the key for {who}. Make a new JSON key for it and paste the whole file again."
    except httpx.HTTPError as exc:
        return False, f"Could not reach Google: {exc.__class__.__name__}"
    if r.status_code == 404:
        if personal:
            if personal.get("saved"):
                return False, "DesignDesk can't open its Drive folder any more (deleted?). Click Reconnect Google Drive to make a new one."
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
