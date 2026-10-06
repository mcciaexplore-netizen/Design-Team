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

def test_changes_open_the_next_version_and_close_the_old_one(db):
    v1 = db.query(Ticket).filter_by(ticket_number="DF-0001").first()
    v2 = request_changes(db, v1, reason="Make it bluer")
    db.commit()

    assert v2.id != v1.id and v2.parent_id == v1.id
    assert v2.ticket_number == "DF-0001-V2" and v2.version_number == 2
    assert v2.reason_for_change == "Make it bluer" and v2.title == v1.title and v2.status == TicketStatus.NEW
    assert v2.due_at is not None
    assert v1.status == TicketStatus.REVISION_REQUESTED and v1.is_locked      # V1 is finished; V2 carries on

    v3 = request_changes(db, v2, reason="Again")
    assert v3.ticket_number == "DF-0001-V3" and v3.parent_id == v2.id          # the number grows, it doesn't pile up suffixes


def test_versions_past_the_free_allowance_are_tagged(db):
    v = db.query(Ticket).filter_by(ticket_number="DF-0001").first()
    seen = []
    for _ in range(4):                                       # V2, V3, V4, V5 with two free revisions
        v = request_changes(db, v)
        seen.append((v.ticket_number, "Extra revision" in (v.tags or [])))
    assert seen == [("DF-0001-V2", False), ("DF-0001-V3", False), ("DF-0001-V4", True), ("DF-0001-V5", True)]


def test_a_closed_version_cannot_be_changed_again(db):
    v1 = db.query(Ticket).filter_by(ticket_number="DF-0001").first()
    request_changes(db, v1)
    with pytest.raises(ValueError):
        request_changes(db, v1, reason="Second try on the same version")
    assert db.query(Ticket).count() == 2
