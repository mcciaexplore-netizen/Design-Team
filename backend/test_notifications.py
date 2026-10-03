import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from models import Base, Ticket, User, RoleEnum, NotificationLog, Notification, UserPreference
from notifications import notify_user, handle_overdue_escalations
import datetime

SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

@pytest.fixture
def db():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    
    designer = User(email="d@t.com", full_name="D", hashed_password="pw", role=RoleEnum.DESIGNER)
    lead = User(email="l@t.com", full_name="L", hashed_password="pw", role=RoleEnum.DESIGN_LEAD)
    admin = User(email="a@t.com", full_name="A", hashed_password="pw", role=RoleEnum.ADMIN)
    db.add_all([designer, lead, admin])
    db.commit()
    
    ticket = Ticket(ticket_number="DF-0001", title="T", brief="B", design_type_id=1, type_specific_fields={}, requester_id=lead.id, assignee_id=designer.id)
    db.add(ticket)
    db.commit()
    
    yield db
    db.close()
    Base.metadata.drop_all(bind=engine)

def test_deduplication(db):
    ticket = db.query(Ticket).first()
    designer = db.query(User).filter_by(role=RoleEnum.DESIGNER).first()
    
    # First send works
    sent1 = notify_user(db, designer, "Warning 6hr", "6_HR_WARNING", ticket.id)
    assert sent1 == True
    assert db.query(NotificationLog).count() == 1
    
    # Second send fails (deduped)
    sent2 = notify_user(db, designer, "Warning 6hr", "6_HR_WARNING", ticket.id)
    assert sent2 == False
    assert db.query(NotificationLog).count() == 1

def test_escalation_ladder(db):
    ticket = db.query(Ticket).first()
    
    # 2 hours overdue -> Only Designer
    handle_overdue_escalations(db, ticket, working_hours_overdue=2)
    logs = db.query(NotificationLog).all()
    events = [l.event_type for l in logs]
    assert "OVERDUE_DESIGNER_0" in events
    assert "OVERDUE_LEAD" not in events
    
    # 5 hours overdue -> Designer cycle 1 + Lead
    handle_overdue_escalations(db, ticket, working_hours_overdue=5)
    logs = db.query(NotificationLog).all()
    events = [l.event_type for l in logs]
    assert "OVERDUE_DESIGNER_1" in events
    assert "OVERDUE_LEAD" in events
    assert "OVERDUE_ADMIN" not in events
    
    # 13 hours overdue -> Admin
    handle_overdue_escalations(db, ticket, working_hours_overdue=13)
    logs = db.query(NotificationLog).all()
    events = [l.event_type for l in logs]
    assert "OVERDUE_ADMIN" in events
