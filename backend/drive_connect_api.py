"""Connect Google Drive from Settings: a Design Lead signs in to Google on the website and DesignDesk keeps the sign-in.

Needs GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET (an OAuth client of type "Web application" whose
authorized redirect URIs include redirect_uri() below). Asks only for drive.file, so DesignDesk sees just the files it
creates, in a folder "DesignDesk files" it makes in that person's Drive. While the Google project is in "Testing",
Google ends the sign-in after 7 days (it says so in refresh_token_expires_in): Settings shows when, cron_jobs reminds
the leads a day ahead, and gdrive stops using Drive once it has lapsed, so uploads go to the database meanwhile.

Reconnecting must use the same Google account: with drive.file another account can't open the files saved so far.
Moving to another account is a separate, confirmed choice ("Switch Google account")."""
import datetime
import logging
import os
import time
import urllib.parse
from typing import Optional

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

import gdrive
import models
from auth import ALGORITHM, LEAD_ROLES, SECRET_KEY, require_lead
from common import app_url
from database import get_db

logger = logging.getLogger(__name__)
router = APIRouter(tags=["drive"])

AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
SCOPES = "openid email https://www.googleapis.com/auth/drive.file"
CALLBACK = "/api/integrations/drive/callback"
STATE_SECONDS = 600


def redirect_uri(request: Request) -> str:
    """Where Google sends the person back. On Vercel the API sits under /api, so the path is /api/api/…"""
    if os.getenv("GOOGLE_OAUTH_REDIRECT_URI"):
        return os.environ["GOOGLE_OAUTH_REDIRECT_URI"]
    if os.getenv("VERCEL"):
        return f"{app_url()}/api{CALLBACK}"
    return str(request.base_url).rstrip("/") + CALLBACK


def status(request: Request) -> dict:
    """For Settings: can Drive be connected here, and how is the saved sign-in doing."""
    c = gdrive.connection(fresh=True) or {}
    return {
        "drive_connect_ready": gdrive.oauth_client() is not None,
        "drive_redirect_uri": redirect_uri(request),
        "drive_connected_as": c.get("email"),
        "drive_connected_at": c.get("connected_at"),
        "drive_expires_at": c.get("expires_at"),
        "drive_lapsed": bool(c.get("lapsed")),
    }


@router.post("/api/integrations/drive/connect")
def start(request: Request, switch: bool = False, lead: models.User = Depends(require_lead)):
    """switch=true: the lead confirmed moving to another Google account (files saved so far stop opening)."""
    client = gdrive.oauth_client()
    if not client:
        raise HTTPException(status_code=422, detail="Add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in Vercel, then redeploy.")
    now = int(time.time())
    state = jwt.encode({"sub": str(lead.id), "purpose": "drive-connect", "switch": switch, "iat": now,
                        "exp": now + STATE_SECONDS}, SECRET_KEY, algorithm=ALGORITHM)
    url = AUTH + "?" + urllib.parse.urlencode({
        "client_id": client[0], "redirect_uri": redirect_uri(request), "response_type": "code", "scope": SCOPES,
        "access_type": "offline", "prompt": "consent", "include_granted_scopes": "true", "state": state,
    })
    return {"url": url}


def _back(result: str) -> RedirectResponse:
    return RedirectResponse(f"{app_url()}/settings?drive={urllib.parse.quote(result)}", status_code=303)


def _read_state(state: str, db: Session) -> Optional[tuple[models.User, bool]]:
    """The lead who started this sign-in and whether they chose to switch accounts, if the signed state is genuine and
    they are still an active lead."""
    try:
        claims = jwt.decode(state, SECRET_KEY, algorithms=[ALGORITHM])
        if claims.get("purpose") != "drive-connect":
            return None
        user = db.query(models.User).filter(models.User.id == int(claims["sub"])).first()
    except (jwt.PyJWTError, KeyError, ValueError):
        return None
    if not user or not user.is_active or user.role not in LEAD_ROLES:
        return None
    return user, bool(claims.get("switch"))


@router.get(CALLBACK)
def callback(request: Request, state: str = "", code: str = "", error: str = "", db: Session = Depends(get_db)):
    """Google sends the person here after they allow (or refuse) access. The signed state proves a lead started it."""
    started = _read_state(state, db)
    if started is None:
        return _back("expired")
    if error or not code:
        return _back("refused")
    client = gdrive.oauth_client()
    if not client:
        return _back("not-set-up")
    lead, switch = started
    try:
        result = _finish(request, client, code, lead, switch)
    except (httpx.HTTPError, ValueError, KeyError):   # Google unreachable, or an answer we can't read
        logger.exception("Drive connect: could not finish the sign-in")
        result = "failed"
    return _back(result)


def _id_email(tokens: dict) -> Optional[str]:
    """The account's email from the id_token, straight from Google over TLS, so its signature needn't be checked here."""
    if not tokens.get("id_token"):
        return None
    try:
        return jwt.decode(tokens["id_token"], options={"verify_signature": False}).get("email")
    except jwt.PyJWTError:
        return None


def _finish(request: Request, client: tuple[str, str], code: str, lead: models.User, switch: bool) -> str:
    """Swap the code for tokens, check the account, find or make the folder, and save the sign-in. Returns the result."""
    with gdrive._client() as http:
        r = http.post(gdrive.TOKEN_URI, data={"code": code, "client_id": client[0], "client_secret": client[1],
                                              "redirect_uri": redirect_uri(request), "grant_type": "authorization_code"})
        tokens = r.json() if r.status_code == 200 else {}
        if not tokens.get("refresh_token"):
            logger.warning("Drive connect: token exchange failed (%s): %s", r.status_code, r.text[:200])
            return "failed"
        email = _id_email(tokens)
        old = gdrive.connection(fresh=True) or {}
        if old.get("email") and email and old["email"].lower() != email.lower() and not switch:
            logger.info("Drive connect: refused %s, Drive is connected as %s", email, old["email"])
            return "other-account"
        folder_id = _folder(http, {"Authorization": f"Bearer {tokens['access_token']}"}, old.get("folder_id"))
        if not folder_id:
            return "no-folder"

    now = datetime.datetime.now(datetime.timezone.utc)
    lasts = tokens.get("refresh_token_expires_in")   # only sent when Google limits the sign-in (project in Testing)
    gdrive.save_connection({
        "refresh_token": tokens["refresh_token"], "folder_id": folder_id, "email": email,
        "connected_by": lead.id, "connected_at": now.isoformat(),
        "expires_at": (now + datetime.timedelta(seconds=int(lasts))).isoformat() if lasts else None,
    })
    logger.info("Google Drive connected as %s by user %s", email, lead.id)
    return "connected"


def _folder(http: httpx.Client, auth: dict, old_id: Optional[str]) -> Optional[str]:
    """Keep the folder from an earlier connection when this sign-in can still open it; otherwise make a new one."""
    if old_id:
        r = http.get(f"{gdrive.API}/{old_id}?fields=id,trashed", headers=auth)
        if r.status_code == 200 and not r.json().get("trashed"):
            return old_id
    made = http.post(f"{gdrive.API}?fields=id", headers=auth,
                     json={"name": "DesignDesk files", "mimeType": "application/vnd.google-apps.folder"})
    if made.status_code != 200:
        logger.warning("Drive connect: could not make the folder (%s): %s", made.status_code, made.text[:200])
        return None
    return made.json()["id"]
