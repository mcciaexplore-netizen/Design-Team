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


def seed():
    migrate()
    if not os.getenv("DATABASE_URL", "sqlite").startswith("sqlite") and not (os.getenv("SEED_STAFF_PASSWORD") and os.getenv("SEED_CLIENT_PASSWORD")):
        print("Refusing to seed a non-SQLite database with default passwords. Set SEED_STAFF_PASSWORD and SEED_CLIENT_PASSWORD.")
        return
    db: Session = SessionLocal()

    ensure_admin(db)

    # Check if users already exist
    if db.query(models.User).first():
        print("Database already seeded.")
        return
        
    print("Seeding database...")
    
    # Users
    users = [
        models.User(email="lead@mccia.in", full_name="Priya Sharma", role=models.RoleEnum.DESIGN_LEAD, hashed_password=pwd_context.hash(os.getenv("SEED_STAFF_PASSWORD", "mccia123"))),
        models.User(email="alice@mccia.in", full_name="Alice Fernandez", role=models.RoleEnum.DESIGNER, hashed_password=pwd_context.hash(os.getenv("SEED_STAFF_PASSWORD", "mccia123"))),
        models.User(email="bob@mccia.in", full_name="Bob Mehta", role=models.RoleEnum.DESIGNER, hashed_password=pwd_context.hash(os.getenv("SEED_STAFF_PASSWORD", "mccia123"))),
        models.User(email="client@tata.com", full_name="Client (TATA)", role=models.RoleEnum.REQUESTER, client_org="TATA", hashed_password=pwd_context.hash(os.getenv("SEED_CLIENT_PASSWORD", "client123"))),
        models.User(email="client@acme.com", full_name="Client (ACME)", role=models.RoleEnum.REQUESTER, client_org="ACME", hashed_password=pwd_context.hash(os.getenv("SEED_CLIENT_PASSWORD", "client123"))),
    ]
    db.add_all(users)
    db.commit()
    
    # Design Types
    dt_banner = models.DesignType(
        name="Banner",
        default_sla_hours=24,
        required_fields=[
            {"name": "size", "label": "Banner Size (e.g., 1024x768)", "type": "string"},
            {"name": "platform", "label": "Platform", "type": "select", "options": ["Web", "Mobile"]},
            {"name": "copy_text", "label": "Copy Text", "type": "text"}
        ]
    )
    dt_social = models.DesignType(
        name="Social Post",
        default_sla_hours=48,
        required_fields=[
            {"name": "platform", "label": "Social Platform", "type": "select", "options": ["Instagram", "LinkedIn", "Twitter"]},
            {"name": "brand_assets", "label": "Brand Assets Link", "type": "string"}
        ]
    )
    db.add_all([dt_banner, dt_social])
    db.commit()
    
    # Ticket
    ticket1 = models.Ticket(
        ticket_number="DF-0001",
        title="Spring Sale Homepage Banner",
        brief="We need a vibrant banner for the upcoming spring sale. It should feature floral patterns and our brand colors.",
        design_type_id=dt_banner.id,
        type_specific_fields={
            "size": "1920x1080",
            "platform": "Web",
            "copy_text": "Spring Into Savings! Up to 50% Off."
        },
        priority=models.TicketPriority.NORMAL,
        status=models.TicketStatus.NEW,
        requester_id=users[3].id,
        client_org="TATA",
        tags=["Marketing", "Spring2026"]
    )
    ticket2 = models.Ticket(
        ticket_number="DF-0002",
        title="ACME Launch Social Post",
        brief="Announcement post for the ACME product launch.",
        design_type_id=dt_social.id,
        type_specific_fields={"platform": "LinkedIn", "brand_assets": "https://example.com/acme"},
        priority=models.TicketPriority.NORMAL,
        status=models.TicketStatus.NEW,
        requester_id=users[4].id,
        client_org="ACME",
        tags=["Launch"]
    )
    db.add_all([ticket1, ticket2])
    db.commit()
    
    print("Database seeding completed.")

if __name__ == "__main__":
    seed()
