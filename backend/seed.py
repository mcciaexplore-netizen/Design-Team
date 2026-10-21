import os
import sys
from sqlalchemy.orm import Session
from passlib.context import CryptContext
from database import SessionLocal, engine
import models

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def migrate():
    """Apply pending migrations so seeding works even if the start command skipped `alembic upgrade head`."""
    from alembic import command
    from alembic.config import Config
    here = os.path.dirname(os.path.abspath(__file__))
    cfg = Config(os.path.join(here, "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(here, "alembic"))
    command.upgrade(cfg, "head")


def ensure_admin(db: Session):
    """Promote (or create) the ADMIN_EMAIL account as Design Lead. Runs on every deploy, so it is idempotent."""
    email = os.getenv("ADMIN_EMAIL", "").strip().lower()
    if not email:
        return
    user = db.query(models.User).filter(models.User.email == email).first()
    if user:
        if user.role != models.RoleEnum.DESIGN_LEAD:
            user.role = models.RoleEnum.DESIGN_LEAD
            user.client_org = None
            db.commit()
            print(f"Promoted {email} to Design Lead.")
        return
    password = os.getenv("ADMIN_PASSWORD")
    if not password:
        print(f"ADMIN_EMAIL={email} has no account yet; set ADMIN_PASSWORD to create it (or register it in the app, then redeploy).")
        return
    db.add(models.User(email=email, full_name=os.getenv("ADMIN_NAME", "MCCIA Admin"), role=models.RoleEnum.DESIGN_LEAD,
                       hashed_password=pwd_context.hash(password)))
    db.commit()
    print(f"Created admin account {email}.")


RESET_MARKER = "admin_password_reset"


def reset_admin_password(db: Session):
    """Recovery for a locked-out admin: ADMIN_RESET_PASSWORD becomes ADMIN_EMAIL's temporary password (the account is
    created or reactivated if needed). Each value is applied once, so a password the admin picks afterwards is not
    overwritten on the next start; the admin must replace it at sign-in."""
    email = os.getenv("ADMIN_EMAIL", "").strip().lower()
    password = os.getenv("ADMIN_RESET_PASSWORD", "")
    if not email or not password:
        return
    marker = db.query(models.AppSetting).filter(models.AppSetting.key == RESET_MARKER).first()
    if marker and marker.value and pwd_context.verify(password, marker.value.get("hash", "")):
        return
    user = db.query(models.User).filter(models.User.email == email).first()
    if not user:
        user = models.User(email=email, full_name=os.getenv("ADMIN_NAME", "MCCIA Admin"), role=models.RoleEnum.DESIGN_LEAD)
        db.add(user)
    user.hashed_password = pwd_context.hash(password)
    user.is_active = True
    user.must_change_password = True
    user.role, user.client_org = models.RoleEnum.DESIGN_LEAD, None
    value = {"hash": pwd_context.hash(password)}
    if marker:
        marker.value = value
    else:
        db.add(models.AppSetting(key=RESET_MARKER, value=value))
    db.commit()
    print(f"Reset the password for {email}; remove ADMIN_RESET_PASSWORD now.")


def ensure_design_types(db: Session) -> dict[str, models.DesignType]:
    """Reference data every environment needs (ticket creation requires a design type)."""
    if not db.query(models.DesignType).first():
        db.add_all([
            models.DesignType(
                name="Banner",
                default_sla_hours=24,
                required_fields=[
                    {"name": "platform", "label": "Platform", "type": "select", "options": ["Web", "Mobile"]},
                    {"name": "copy_text", "label": "Copy Text", "type": "text"},
                ],
            ),
            models.DesignType(
                name="Social Post",
                default_sla_hours=48,
                required_fields=[
                    {"name": "platform", "label": "Social Platform", "type": "select", "options": ["Instagram", "LinkedIn", "Twitter"]},
                    {"name": "brand_assets", "label": "Brand Assets Link", "type": "string"},
                ],
            ),
        ])
        db.commit()
        print("Created default design types.")
    return {d.name: d for d in db.query(models.DesignType).all()}


def seed(migrate_first: bool = True):
    if migrate_first:
        migrate()
    db: Session = SessionLocal()
    try:
        ensure_design_types(db)
        ensure_admin(db)
        reset_admin_password(db)
    finally:
        db.close()


if __name__ == "__main__":
    seed()
