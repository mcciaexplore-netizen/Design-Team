import pytest
import datetime
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from models import Base, Ticket, TicketStatus, User, RoleEnum, DesignType, SystemSettings
from revision_engine import request_changes
from cron_jobs import run_all_cron_jobs

SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

@pytest.fixture
def db():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    
    req = User(email="req@test.com", full_name="Requester", hashed_password="x", role=RoleEnum.REQUESTER)
    des = User(email="des@test.com", full_name="Designer", hashed_password="x", role=RoleEnum.DESIGNER)
    dt = DesignType(name="Banner", default_sla_hours=24, required_fields=[])
    sett = SystemSettings(edit_window_hours=12, max_free_revisions=1)
    db.add_all([req, des, dt, sett])
    db.commit()
    
    yield db
    db.close()
    Base.metadata.drop_all(bind=engine)

def test_full_e2e_flow(db, monkeypatch):
    req = db.query(User).filter_by(role=RoleEnum.REQUESTER).first()
    des = db.query(User).filter_by(role=RoleEnum.DESIGNER).first()
    
    # 1. Create Ticket
    ticket = Ticket(
        ticket_number="DF-0001", title="Launch Banner", brief="Test", 
        design_type_id=1, type_specific_fields={}, 
        requester_id=req.id, assignee_id=des.id, status=TicketStatus.NEW
    )
    db.add(ticket)
    db.commit()
    
    # 2. Deliver Ticket
    ticket.status = TicketStatus.DELIVERED
    # Mock the edit window to expire IN THE PAST so we can test auto-close immediately
    past = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=1)
    ticket.edit_window_ends_at = past
    db.commit()
    
    # 3. Request Changes: V1 is closed as superseded and V2 is opened
    v2 = request_changes(db, ticket, "Make it bluer")
    db.commit()
    assert v2.ticket_number == "DF-0001-V2" and v2.parent_id == ticket.id and v2.status == TicketStatus.ASSIGNED
    assert ticket.status == TicketStatus.REVISION_REQUESTED and ticket.is_locked
    assert ticket.edit_window_ends_at is None

    # 4. V2 is delivered, then asked to change again (past the free allowance of one): V3, flagged for the leads
    v2.status = TicketStatus.DELIVERED
    db.commit()
    v3 = request_changes(db, v2, "Still not right")
    db.commit()
    assert v3.ticket_number == "DF-0001-V3" and "Extra revision" in v3.tags
    assert db.query(Ticket).count() == 3

    # 5. V3 is delivered and then left alone: auto-close (the cron job replaces Celery)
    v3.status = TicketStatus.DELIVERED
    v3.edit_window_ends_at = past
    db.commit()
    ticket = v3


    run_all_cron_jobs(db)
    
    # Re-fetch ticket from DB using a new session
    db_new = TestingSessionLocal()
    closed_ticket = db_new.query(Ticket).filter_by(id=ticket.id).first()
    assert closed_ticket.status == TicketStatus.CLOSED_WITHOUT_APPROVAL
    assert closed_ticket.is_locked == True
    db_new.close()
