"""Accounts and sample tickets used only by the Playwright E2E suite (frontend/e2e/start-backend.mjs).
Never run against production — seed.py no longer creates this data."""
from passlib.context import CryptContext

import models
from database import SessionLocal
from seed import ensure_design_types, migrate

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def run():
    db = SessionLocal()
    try:
        types = ensure_design_types(db)
        staff_pw, client_pw = "mccia123", "client123"
        users = [
            models.User(email="lead@mccia.in", full_name="Demo Lead", role=models.RoleEnum.DESIGN_LEAD, hashed_password=pwd_context.hash(staff_pw)),
            models.User(email="alice@mccia.in", full_name="Alice Fernandez", role=models.RoleEnum.DESIGNER, hashed_password=pwd_context.hash(staff_pw)),
            models.User(email="bob@mccia.in", full_name="Bob Mehta", role=models.RoleEnum.DESIGNER, hashed_password=pwd_context.hash(staff_pw)),
            models.User(email="client@tata.com", full_name="Client (TATA)", role=models.RoleEnum.REQUESTER, client_org="TATA", hashed_password=pwd_context.hash(client_pw)),
            models.User(email="client@acme.com", full_name="Client (ACME)", role=models.RoleEnum.REQUESTER, client_org="ACME", hashed_password=pwd_context.hash(client_pw)),
        ]
        existing = {e for (e,) in db.query(models.User.email).all()}
        db.add_all([u for u in users if u.email not in existing])
        db.commit()
        users = [db.query(models.User).filter_by(email=u.email).one() for u in users]

        if db.query(models.Ticket).first():
            return
        dt_banner, dt_social = types["Banner"], types["Social Post"]
        db.add_all([
            models.Ticket(
                ticket_number="DF-0001",
                title="Spring Sale Homepage Banner",
                brief="We need a vibrant banner for the upcoming spring sale. It should feature floral patterns and our brand colors.",
                design_type_id=dt_banner.id,
                type_specific_fields={"size": "1920x1080", "platform": "Web", "copy_text": "Spring Into Savings! Up to 50% Off."},
                priority=models.TicketPriority.NORMAL,
                status=models.TicketStatus.NEW,
                requester_id=users[3].id,
                client_org="TATA",
                tags=["Marketing", "Spring2026"],
            ),
            models.Ticket(
                ticket_number="DF-0002",
                title="ACME Launch Social Post",
                brief="Announcement post for the ACME product launch.",
                design_type_id=dt_social.id,
                type_specific_fields={"platform": "LinkedIn", "brand_assets": "https://example.com/acme"},
                priority=models.TicketPriority.NORMAL,
                status=models.TicketStatus.NEW,
                requester_id=users[4].id,
                client_org="ACME",
                tags=["Launch"],
            ),
        ])
        db.commit()
    finally:
        db.close()


if __name__ == "__main__":
    migrate()
    run()
