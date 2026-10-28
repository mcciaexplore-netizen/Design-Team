import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import models
from auth import hash_password
from database import get_db
from main import app

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture
def client():
    models.Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    pw = hash_password("secret-pw")
    db.add_all([
        models.User(email="lead@x.com", full_name="Lead", role=models.RoleEnum.DESIGN_LEAD, hashed_password=pw),
        models.User(email="des@x.com", full_name="Designer", role=models.RoleEnum.DESIGNER, hashed_password=pw),
        models.User(email="a@tata.com", full_name="Tata A", role=models.RoleEnum.REQUESTER, client_org="TATA", hashed_password=pw),
        models.User(email="b@acme.com", full_name="Acme B", role=models.RoleEnum.REQUESTER, client_org="ACME", hashed_password=pw),
        models.User(email="off@x.com", full_name="Off", role=models.RoleEnum.DESIGNER, is_active=False, hashed_password=pw),
        models.DesignType(name="Banner", default_sla_hours=24, required_fields=[]),
    ])
    db.commit()
    db.close()
    app.dependency_overrides[get_db] = _override_get_db
    yield TestClient(app)
    app.dependency_overrides.clear()
    models.Base.metadata.drop_all(bind=engine)


def login(client, email, password="secret-pw"):
    return client.post("/api/auth/token", data={"username": email, "password": password})


def auth(client, email):
    token = login(client, email).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def make_ticket(client, email, title="T"):
    """A ticket in the workflow. For a client email (clients can't sign in) a lead raises it, then the client is
    recorded as its requester: what a public-form request looks like once a lead has accepted it."""
    db = TestingSessionLocal()
    try:
        person = db.query(models.User).filter(models.User.email == email).one()
        is_requester, person_id, org = person.role == models.RoleEnum.REQUESTER, person.id, person.client_org
    finally:
        db.close()
    r = client.post(
        "/api/tickets",
        json={"title": title, "brief": "b", "design_type_id": 1, "type_specific_fields": {}},
        headers=auth(client, "lead@x.com" if is_requester else email),
    )
    assert r.status_code == 201, r.text
    ticket = r.json()
    if is_requester:
        db = TestingSessionLocal()
        try:
            db.query(models.Ticket).filter(models.Ticket.id == ticket["id"]).update({"requester_id": person_id, "client_org": org})
            db.commit()
        finally:
            db.close()
        ticket = {**ticket, "requester_id": person_id, "client_org": org}
    return ticket


def test_login_success_and_role_mapping(client):
    assert login(client, "lead@x.com").json()["user"]["role"] == "Design Lead"
    assert login(client, "des@x.com").json()["user"]["role"] == "Designer"


def test_clients_have_no_accounts(client):
    """A client (requester) is only a record: they can't sign in, and a token issued before this change doesn't
    grant client-level access either — there is no login any more, so it falls back to the shared staff identity."""
    r = login(client, "a@tata.com")
    assert r.status_code == 401 and r.json()["detail"] == "Invalid email or password"
    from auth import create_access_token
    db = TestingSessionLocal()
    old_token = create_access_token(db.query(models.User).filter(models.User.email == "a@tata.com").one())
    db.close()
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {old_token}"})
    assert me.status_code == 200 and me.json()["email"] != "a@tata.com"


def test_login_rejects_bad_password_unknown_user_and_inactive(client):
    assert login(client, "lead@x.com", "wrong").status_code == 401
    assert login(client, "nobody@x.com").status_code == 401
    assert login(client, "off@x.com").status_code == 401


def test_endpoints_work_without_a_token(client):
    """There is no login: every request (no header, or a garbage one) is resolved to the shared staff identity."""
    assert client.get("/api/tickets").status_code == 200
    assert client.get("/api/users").status_code == 200
    assert client.get("/api/tickets", headers={"Authorization": "Bearer garbage"}).status_code == 200


def test_designer_cannot_reassign_or_reprioritise_but_lead_can(client):
    t = make_ticket(client, "a@tata.com")
    d = auth(client, "des@x.com")
    assert client.patch(f"/api/tickets/{t['id']}", json={"assignee_id": 2}, headers=d).status_code == 403
    assert client.patch(f"/api/tickets/{t['id']}", json={"priority": "High"}, headers=d).status_code == 403
    assert client.patch(f"/api/tickets/{t['id']}", json={"title": "renamed"}, headers=d).status_code == 200
    lead = auth(client, "lead@x.com")
    assert client.patch(f"/api/tickets/{t['id']}", json={"assignee_id": 2}, headers=lead).status_code == 200
    assert client.get("/api/timesheets/export", headers=lead).status_code == 200


def test_ticket_requester_comes_from_token(client):
    r = client.post("/api/tickets", json={"title": "T", "brief": "b", "design_type_id": 1, "type_specific_fields": {}},
                    headers=auth(client, "des@x.com"))
    assert r.status_code == 201 and r.json()["requester_id"] == 2


def test_jira_webhook_rejects_without_secret(client):
    assert client.post("/api/webhooks/jira", json={}).status_code == 403
    assert client.post("/api/webhooks/jira", json={}, headers={"X-Webhook-Secret": "guess"}).status_code == 403


# ── Live event feed ──────────────────────────────────────────────────────────

def test_live_feed_works_without_a_token(client):
    """There is no login: the live feed accepts a connection with no token, or a garbage one, as the shared staff identity."""
    with client.websocket_connect("/ws/anyone"):
        pass
    with client.websocket_connect("/ws/anyone?token=garbage"):
        pass


def test_live_feed_delivers_events_to_the_team(client):
    lead = login(client, "lead@x.com").json()["access_token"]
    with client.websocket_connect(f"/ws/x?token={lead}") as ws_lead:
        make_ticket(client, "des@x.com", "Poster")
        msg = ws_lead.receive_json()
        assert msg["type"] == "ticket_created" and msg["title"] == "Poster" and msg["by"] == "Designer"
