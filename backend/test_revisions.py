import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from models import Base, Ticket, TicketStatus, SystemSettings, User, RoleEnum, DesignType
from revision_engine import request_changes

SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

@pytest.fixture
def db():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    
    # Setup base data
    user = User(email="test@test.com", full_name="Test", hashed_password="pw", role=RoleEnum.REQUESTER)
    dt = DesignType(name="Banner", default_sla_hours=24, required_fields=[])
    db.add_all([user, dt])
    db.commit()
    
    settings = SystemSettings(max_free_revisions=2)
    db.add(settings)
    
    ticket = Ticket(
        ticket_number="DF-0001",
        title="Test Banner",
        brief="Testing",
        design_type_id=dt.id,
        type_specific_fields={},
        status=TicketStatus.DELIVERED,
        requester_id=user.id,
        revision_count=0
    )
    db.add(ticket)
    db.commit()
    
    yield db
    
    db.close()
    Base.metadata.drop_all(bind=engine)

def test_free_revision_counts(db):
    ticket = db.query(Ticket).filter_by(ticket_number="DF-0001").first()
    
    # First revision (allowed)
    request_changes(db, ticket)
    assert ticket.status == TicketStatus.IN_PROGRESS
    assert ticket.revision_count == 1
    
    # Simulate delivery again
    ticket.status = TicketStatus.DELIVERED
    db.commit()
    
    # Second revision (allowed)
    request_changes(db, ticket)
    assert ticket.status == TicketStatus.IN_PROGRESS
    assert ticket.revision_count == 2
    
    # Simulate delivery again
    ticket.status = TicketStatus.DELIVERED
    db.commit()
    
    # Third revision (NOT allowed, must spawn child)
    new_ticket = request_changes(db, ticket, reason="Missed the mark")
    
    assert new_ticket.id != ticket.id
    assert new_ticket.parent_id == ticket.id
    assert new_ticket.ticket_number == "DF-0001-v2"
    assert new_ticket.version_number == 2
    assert new_ticket.reason_for_change == "Missed the mark"
    assert new_ticket.status == TicketStatus.NEW

def test_locked_ticket_forces_child(db):
    ticket = db.query(Ticket).filter_by(ticket_number="DF-0001").first()
    ticket.is_locked = True
    db.commit()
    
    # Even with 0 revisions, locked forces a child duplicate
    new_ticket = request_changes(db, ticket, reason="New campaign phase")
    
    assert new_ticket.id != ticket.id
    assert new_ticket.parent_id == ticket.id
    assert new_ticket.ticket_number == "DF-0001-v2"
