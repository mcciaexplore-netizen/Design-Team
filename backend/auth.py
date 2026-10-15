import hashlib
import hmac
import os
import secrets
import datetime
import logging

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, status, WebSocket
from pydantic import BaseModel, Field
from sqlalchemy import func
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from passlib.context import CryptContext
from sqlalchemy.orm import Session

import models
from common import Email
from database import get_db

logger = logging.getLogger(__name__)

def _dev_secret_key() -> str:
    """Local development only: keep one generated key in a git-ignored file so `uvicorn --reload` restarts
    don't sign everyone out. Falls back to a per-process key if the file can't be used."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".dev_secret_key")
    try:
        with open(path, encoding="utf-8") as fh:
            key = fh.read().strip()
        if len(key) >= 32:
            return key
    except OSError:
        pass  # no key file yet
    key = secrets.token_urlsafe(48)
    try:
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(key)
    except OSError:
        pass  # read-only checkout: this process still works, sessions just reset on restart
    return key


SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    if os.getenv("DATABASE_URL", "sqlite").startswith("sqlite"):
        SECRET_KEY = _dev_secret_key()
        logger.info("SECRET_KEY is not set; using the local development key in backend/.dev_secret_key.")
    else:
        # Random per process: tokens stop working on restart. Set SECRET_KEY in any real deployment.
        SECRET_KEY = secrets.token_urlsafe(48)
        logger.warning("SECRET_KEY is not set; using a temporary key. Sessions reset on restart.")

ALGORITHM = "HS256"
TOKEN_TTL = datetime.timedelta(hours=int(os.getenv("TOKEN_TTL_HOURS", "12")))

# bcrypt cost is 12 by default; the test suite lowers it (BCRYPT_ROUNDS) because every login hashes.
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=int(os.getenv("BCRYPT_ROUNDS", "12")))
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token")

STAFF_ROLES = (models.RoleEnum.DESIGNER, models.RoleEnum.DESIGN_LEAD, models.RoleEnum.ADMIN)
LEAD_ROLES = (models.RoleEnum.DESIGN_LEAD, models.RoleEnum.ADMIN)

# Dummy hash so a missing user costs the same as a wrong password (no user enumeration by timing).
_DUMMY_HASH = pwd_context.hash("not-a-real-password")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def _password_fingerprint(user: models.User) -> str:
    """Changes whenever the password changes, so a reset or change signs out every older session."""
    return hashlib.sha256(f"{SECRET_KEY}:{user.hashed_password}".encode()).hexdigest()[:16]


def generate_temp_password() -> str:
    """Readable temporary password (no look-alike characters) for admin-issued resets."""
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"
    return "".join(secrets.choice(alphabet) for _ in range(12))


def create_access_token(user: models.User) -> str:
    now = datetime.datetime.now(datetime.timezone.utc)
    payload = {"sub": str(user.id), "role": user.role.value, "pwf": _password_fingerprint(user), "iat": now, "exp": now + TOKEN_TTL}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def _user_from_token(token: str, db: Session) -> models.User:
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise credentials_error
    if payload.get("purpose"):
        raise credentials_error  # a password-reset link is not a session
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user or not user.is_active:
        raise credentials_error
    if not hmac.compare_digest(str(payload.get("pwf", "")), _password_fingerprint(user)):
        raise credentials_error  # password changed since this token was issued
    return user


# A user holding a temporary password may only change it (and read who they are) until they do.
_ALLOWED_WHILE_MUST_CHANGE = ("/api/auth/change-password", "/api/auth/me")


def get_current_user(request: Request, token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> models.User:
    user = _user_from_token(token, db)
    if user.must_change_password and request.url.path not in _ALLOWED_WHILE_MUST_CHANGE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You must change your temporary password first.")
    return user


def require_roles(*roles: models.RoleEnum):
    def checker(user: models.User = Depends(get_current_user)) -> models.User:
        if user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have permission to do this")
        return user
    return checker


require_staff = require_roles(*STAFF_ROLES)
require_lead = require_roles(*LEAD_ROLES)


def is_client(user: models.User) -> bool:
    return user.role == models.RoleEnum.REQUESTER


def can_access_ticket(user: models.User, ticket: models.Ticket) -> bool:
    """Staff see everything. Clients see only tickets belonging to their own organisation
    (or, if they have no organisation, only tickets they raised themselves)."""
    if not is_client(user):
        return True
    if user.client_org:
        return ticket.client_org == user.client_org
    return ticket.requester_id == user.id


def get_ticket_for_user(db: Session, ticket_id: int, user: models.User) -> models.Ticket:
    """404 (not 403) when a client asks for someone else's ticket, so IDs can't be probed."""
    ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
    if not ticket or not can_access_ticket(user, ticket):
        raise HTTPException(status_code=404, detail="Ticket not found")
    return ticket


async def authenticate_websocket(websocket: WebSocket, db: Session) -> models.User | None:
    token = websocket.query_params.get("token")
    if not token:
        return None
    try:
        return _user_from_token(token, db)
    except HTTPException:
        return None


# Frontend role names
def frontend_role(role: models.RoleEnum) -> str:
    if role == models.RoleEnum.REQUESTER:
        return "Client"
    if role == models.RoleEnum.ADMIN:
        return "Design Lead"
    return role.value


def user_payload(user: models.User) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "role": frontend_role(user.role),
        "client_org": user.client_org,
        "must_change_password": bool(user.must_change_password),
    }


router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/token")
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == form.username.strip().lower()).first()
    hashed = user.hashed_password if user else _DUMMY_HASH
    password_ok = pwd_context.verify(form.password, hashed)
    if not user or not password_ok or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return {"access_token": create_access_token(user), "token_type": "bearer", "user": user_payload(user)}


@router.get("/me")
def me(user: models.User = Depends(get_current_user)):
    return user_payload(user)


class RegisterRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=80)
    email: Email
    company: str = Field(min_length=2, max_length=80)
    password: str = Field(min_length=8, max_length=128)


@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(body: RegisterRequest, db: Session = Depends(get_db)):
    """Self-service sign-up. Only ever creates a Client (requester) account.

    Clients are scoped to their company's tickets, so the company must be new:
    joining an existing company would expose its tickets, and staff must add those users.
    """
    email = body.email.strip().lower()
    company = " ".join(body.company.split())
    if db.query(models.User).filter(func.lower(models.User.email) == email).first():
        raise HTTPException(status_code=409, detail="An account with this email already exists.")
    if db.query(models.User).filter(func.lower(models.User.client_org) == company.lower()).first():
        raise HTTPException(status_code=409, detail="That company already has an account. Ask your design team to add you.")
    user = models.User(
        email=email,
        full_name=" ".join(body.full_name.split()),
        role=models.RoleEnum.REQUESTER,
        client_org=company,
        hashed_password=hash_password(body.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"access_token": create_access_token(user), "token_type": "bearer", "user": user_payload(user)}


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


@router.post("/change-password")
def change_password(body: ChangePasswordRequest, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not pwd_context.verify(body.current_password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Your current password is incorrect.")
    if body.new_password == body.current_password:
        raise HTTPException(status_code=400, detail="Choose a password different from the current one.")
    user.hashed_password = hash_password(body.new_password)
    user.must_change_password = False
    db.commit()
    db.refresh(user)
    # The old token is now invalid (password fingerprint changed), so hand back a fresh one.
    return {"access_token": create_access_token(user), "token_type": "bearer", "user": user_payload(user)}


# ── Forgot password ──────────────────────────────────────────────────────────

RESET_TTL = datetime.timedelta(minutes=30)
RESET_SENT = "If that email has an account, a reset link is on its way. It works once, for 30 minutes."


def _app_url() -> str:
    """Where reset links point. Never taken from the request, so a forged Host/Origin can't redirect the link."""
    url = os.getenv("PUBLIC_APP_URL") or (
        f"https://{os.environ['VERCEL_PROJECT_PRODUCTION_URL']}" if os.getenv("VERCEL_PROJECT_PRODUCTION_URL") else "")
    return (url or "http://localhost:5173").rstrip("/")


def create_reset_token(user: models.User) -> str:
    """Bound to the current password, so it stops working once used (or once the password changes some other way)."""
    now = datetime.datetime.now(datetime.timezone.utc)
    payload = {"sub": str(user.id), "purpose": "reset", "pwf": _password_fingerprint(user), "iat": now, "exp": now + RESET_TTL}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


class ForgotPasswordRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)


@router.post("/forgot-password")
def forgot_password(body: ForgotPasswordRequest, request: Request, db: Session = Depends(get_db)):
    """Email a reset link. The answer is the same whether or not the account exists (no account discovery)."""
    import delivery
    import ratelimit
    if not delivery.email_configured():
        raise HTTPException(status_code=503, detail="Password reset by email is not set up yet. Ask your Design Lead to reset it.")
    email = body.email.strip().lower()
    ratelimit.check(db, f"forgot-ip:{ratelimit.client_ip(request)}", 10, 3600)
    ratelimit.check(db, f"forgot-email:{email}", 3, 3600)
    user = db.query(models.User).filter(models.User.email == email).first()
    if user and user.is_active:
        link = f"{_app_url()}/reset-password?token={create_reset_token(user)}"
        delivery.run_in_background(delivery.send_email, user.email, "Reset your MCCIA DesignDesk password", (
            f"Hi {user.full_name},\n\n"
            "Someone asked to reset the password for your MCCIA DesignDesk account. To choose a new one, open:\n\n"
            f"{link}\n\n"
            "The link works once, for 30 minutes. If you didn't ask for this, ignore this email; your password stays the same.\n"
        ))
    return {"detail": RESET_SENT}


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=10, max_length=2000)
    new_password: str = Field(min_length=8, max_length=128)


@router.post("/reset-password")
def reset_password(body: ResetPasswordRequest, db: Session = Depends(get_db)):
    invalid = HTTPException(status_code=400, detail="This reset link is invalid or has expired. Ask for a new one.")
    try:
        payload = jwt.decode(body.token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise invalid
    if payload.get("purpose") != "reset":
        raise invalid
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user or not user.is_active or not hmac.compare_digest(str(payload.get("pwf", "")), _password_fingerprint(user)):
        raise invalid
    user.hashed_password = hash_password(body.new_password)
    user.must_change_password = False
    db.commit()  # the new password changes the fingerprint: this link and every existing session stop working
    return {"detail": "Your password has been changed. You can sign in now."}
