import os
import secrets
import datetime
import logging

import jwt
from fastapi import APIRouter, Depends, HTTPException, status, WebSocket
from pydantic import BaseModel, Field
from sqlalchemy import func
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from passlib.context import CryptContext
from sqlalchemy.orm import Session

import models
from common import Email
from database import get_db

logger = logging.getLogger(__name__)

SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    # Random per process: tokens stop working on restart. Set SECRET_KEY in any real deployment.
    SECRET_KEY = secrets.token_urlsafe(48)
    logger.warning("SECRET_KEY is not set; using a temporary key. Sessions reset on restart.")

ALGORITHM = "HS256"
TOKEN_TTL = datetime.timedelta(hours=int(os.getenv("TOKEN_TTL_HOURS", "12")))

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token")

STAFF_ROLES = (models.RoleEnum.DESIGNER, models.RoleEnum.DESIGN_LEAD, models.RoleEnum.ADMIN)
LEAD_ROLES = (models.RoleEnum.DESIGN_LEAD, models.RoleEnum.ADMIN)

# Dummy hash so a missing user costs the same as a wrong password (no user enumeration by timing).
_DUMMY_HASH = pwd_context.hash("not-a-real-password")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def create_access_token(user: models.User) -> str:
    now = datetime.datetime.now(datetime.timezone.utc)
    payload = {"sub": str(user.id), "role": user.role.value, "iat": now, "exp": now + TOKEN_TTL}
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
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user or not user.is_active:
        raise credentials_error
    return user


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> models.User:
    return _user_from_token(token, db)


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
