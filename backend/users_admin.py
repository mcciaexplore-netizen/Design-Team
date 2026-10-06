"""Admin user management: list, create, edit/deactivate, and issue temporary passwords.

Design Leads only. Passwords are never returned except as a one-time temporary password
in the response that creates or resets an account.
"""
import logging
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

import models
from auth import frontend_role, generate_temp_password, hash_password, require_lead
from common import Email
from database import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/users", tags=["admin-users"])

UiRole = Literal["Design Lead", "Designer", "Client"]
_ROLE_TO_ENUM = {
    "Design Lead": models.RoleEnum.DESIGN_LEAD,
    "Designer": models.RoleEnum.DESIGNER,
    "Client": models.RoleEnum.REQUESTER,
}
_LEAD_ROLES = (models.RoleEnum.DESIGN_LEAD, models.RoleEnum.ADMIN)


def _row(u: models.User) -> dict:
    return {
        "id": u.id,
        "email": u.email,
        "full_name": u.full_name,
        "role": frontend_role(u.role),
        "client_org": u.client_org,
        "is_active": u.is_active,
        "must_change_password": bool(u.must_change_password),
        "created_at": u.created_at.isoformat() if u.created_at else None,
    }


def _active_leads(db: Session) -> int:
    return db.query(models.User).filter(models.User.role.in_(_LEAD_ROLES), models.User.is_active.is_(True)).count()


def _get(db: Session, user_id: int) -> models.User:
    u = db.query(models.User).filter(models.User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    return u


@router.get("")
def list_users(db: Session = Depends(get_db), _lead: models.User = Depends(require_lead)):
    users = db.query(models.User).order_by(models.User.is_active.desc(), models.User.full_name).all()
    return [_row(u) for u in users]


class CreateUser(BaseModel):
    full_name: str = Field(min_length=2, max_length=80)
    email: Email
    role: UiRole
    client_org: Optional[str] = Field(default=None, max_length=80)


@router.post("", status_code=201)
def create_user(body: CreateUser, db: Session = Depends(get_db), lead: models.User = Depends(require_lead)):
    email = body.email.strip().lower()
    if db.query(models.User).filter(func.lower(models.User.email) == email).first():
        raise HTTPException(status_code=409, detail="An account with this email already exists.")
    org = " ".join((body.client_org or "").split()) or None
    if body.role == "Client" and not org:
        raise HTTPException(status_code=422, detail="Clients need a company name.")
    if body.role != "Client":
        org = None
    temp = generate_temp_password()
    user = models.User(
        email=email,
        full_name=" ".join(body.full_name.split()),
        role=_ROLE_TO_ENUM[body.role],
        client_org=org,
        hashed_password=hash_password(temp),
        must_change_password=True,
    )
    db.add(user)
    db.flush()
    db.commit()
    db.refresh(user)
    logger.info("admin_user_created by=%s email=%s role=%s", lead.email, email, body.role)
    return {"user": _row(user), "temporary_password": temp}


class UpdateUser(BaseModel):
    full_name: Optional[str] = Field(default=None, min_length=2, max_length=80)
    role: Optional[UiRole] = None
    client_org: Optional[str] = Field(default=None, max_length=80)
    is_active: Optional[bool] = None


@router.patch("/{user_id}")
def update_user(user_id: int, body: UpdateUser, db: Session = Depends(get_db), lead: models.User = Depends(require_lead)):
    user = _get(db, user_id)
    changes = []

    new_role = _ROLE_TO_ENUM[body.role] if body.role else user.role
    new_active = user.is_active if body.is_active is None else body.is_active

    # Guard rails: nobody locks themselves or the whole team out of admin.
    if user.id == lead.id and (not new_active or new_role not in _LEAD_ROLES):
        raise HTTPException(status_code=400, detail="You can't deactivate or demote your own account.")
    loses_lead = user.role in _LEAD_ROLES and user.is_active and (not new_active or new_role not in _LEAD_ROLES)
    if loses_lead and _active_leads(db) <= 1:
        raise HTTPException(status_code=400, detail="At least one active Design Lead is required.")

    # Clients are scoped by company, so one without a company would see nothing (or the wrong tickets).
    new_org = user.client_org
    if new_role == models.RoleEnum.REQUESTER:
        if body.client_org is not None:
            new_org = " ".join(body.client_org.split()) or None
        if not new_org:
            raise HTTPException(status_code=422, detail="Clients need a company name.")

    if body.full_name is not None and " ".join(body.full_name.split()) != user.full_name:
        user.full_name = " ".join(body.full_name.split())
        changes.append("name")
    if body.role is not None and new_role != user.role:
        # Keep ADMIN rows as they are unless the role genuinely changes.
        user.role = new_role
        changes.append(f"role to {body.role}")
        if new_role != models.RoleEnum.REQUESTER:
            user.client_org = None
    if new_role == models.RoleEnum.REQUESTER and new_org != user.client_org:
        user.client_org = new_org
        changes.append("company")
    if body.is_active is not None and new_active != user.is_active:
        user.is_active = new_active
        changes.append("activated" if new_active else "deactivated")

    db.commit()
    db.refresh(user)
    if changes:
        logger.info("admin_user_updated by=%s email=%s changes=%s", lead.email, user.email, ", ".join(changes))
    return _row(user)


@router.post("/{user_id}/reset-password")
def reset_password(user_id: int, db: Session = Depends(get_db), lead: models.User = Depends(require_lead)):
    user = _get(db, user_id)
    temp = generate_temp_password()
    user.hashed_password = hash_password(temp)
    user.must_change_password = True
    db.commit()
    db.refresh(user)
    logger.info("admin_password_reset by=%s email=%s", lead.email, user.email)
    return {"user": _row(user), "temporary_password": temp}
