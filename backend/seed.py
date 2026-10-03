import sys
from sqlalchemy.orm import Session
from passlib.context import CryptContext
from database import SessionLocal, engine
import models

models.Base.metadata.create_all(bind=engine)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def seed():
    db: Session = SessionLocal()
    
    # Check if users already exist
    if db.query(models.User).first():
        print("Database already seeded.")
        return
        
    print("Seeding database...")
    
    # Users
    users = [
        models.User(email="requester@designflow.local", full_name="Alice Requester", role=models.RoleEnum.REQUESTER, hashed_password=pwd_context.hash("password")),
        models.User(email="designer@designflow.local", full_name="Bob Designer", role=models.RoleEnum.DESIGNER, hashed_password=pwd_context.hash("password")),
        models.User(email="lead@designflow.local", full_name="Charlie Lead", role=models.RoleEnum.DESIGN_LEAD, hashed_password=pwd_context.hash("password")),
        models.User(email="admin@designflow.local", full_name="Diana Admin", role=models.RoleEnum.ADMIN, hashed_password=pwd_context.hash("password")),
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
        requester_id=users[0].id,
        tags=["Marketing", "Spring2026"]
    )
    db.add(ticket1)
    db.commit()
    
    print("Database seeding completed.")

if __name__ == "__main__":
    seed()
