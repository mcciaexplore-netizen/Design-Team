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
    r = client.post(
        "/api/tickets",
        json={"title": title, "brief": "b", "design_type_id": 1, "type_specific_fields": {}},
        headers=auth(client, email),
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_login_success_and_role_mapping(client):
    r = login(client, "a@tata.com")
    assert r.status_code == 200
    assert r.json()["user"]["role"] == "Client"
    assert login(client, "lead@x.com").json()["user"]["role"] == "Design Lead"


def test_login_rejects_bad_password_unknown_user_and_inactive(client):
    assert login(client, "lead@x.com", "wrong").status_code == 401
    assert login(client, "nobody@x.com").status_code == 401
    assert login(client, "off@x.com").status_code == 401


def test_endpoints_require_token(client):
    assert client.get("/api/tickets").status_code == 401
    assert client.get("/api/users").status_code == 401
    assert client.get("/api/tickets", headers={"Authorization": "Bearer garbage"}).status_code == 401


def test_client_only_sees_own_org_tickets(client):
    t = make_ticket(client, "a@tata.com", "tata work")
    make_ticket(client, "b@acme.com", "acme work")

    tata_view = client.get("/api/tickets", headers=auth(client, "a@tata.com")).json()
    assert [x["title"] for x in tata_view] == ["tata work"]

    staff_view = client.get("/api/tickets", headers=auth(client, "des@x.com")).json()
    assert len(staff_view) == 2

    # Another org can't touch it, and gets 404 rather than 403 so IDs can't be probed.
    other = auth(client, "b@acme.com")
    assert client.get(f"/api/tickets/{t['id']}/pinpoints", headers=other).status_code == 404
    assert client.post(f"/api/tickets/{t['id']}/revisions", json={"reason_for_change": "x"}, headers=other).status_code == 404


def test_clients_cannot_use_staff_endpoints(client):
    t = make_ticket(client, "a@tata.com")
    h = auth(client, "a@tata.com")
    assert client.get("/api/users", headers=h).status_code == 403
    assert client.patch(f"/api/tickets/{t['id']}", json={"title": "hax"}, headers=h).status_code == 403
    assert client.post(f"/api/tickets/{t['id']}/timer/start", headers=h).status_code == 403
    assert client.get("/api/timesheets/export", headers=h).status_code == 403
    assert client.get("/api/forecasting/capacity", headers=h).status_code == 403


def test_designer_cannot_reassign_or_reprioritise_but_lead_can(client):
    t = make_ticket(client, "a@tata.com")
    d = auth(client, "des@x.com")
    assert client.patch(f"/api/tickets/{t['id']}", json={"assignee_id": 2}, headers=d).status_code == 403
    assert client.patch(f"/api/tickets/{t['id']}", json={"priority": "High"}, headers=d).status_code == 403
    assert client.patch(f"/api/tickets/{t['id']}", json={"title": "renamed"}, headers=d).status_code == 200
    lead = auth(client, "lead@x.com")
    assert client.patch(f"/api/tickets/{t['id']}", json={"assignee_id": 2}, headers=lead).status_code == 200
    assert client.get("/api/timesheets/export", headers=lead).status_code == 200


def test_client_cannot_self_assign_on_create(client):
    r = client.post(
        "/api/tickets",
        json={"title": "T", "brief": "b", "design_type_id": 1, "type_specific_fields": {}, "assignee_id": 2},
        headers=auth(client, "a@tata.com"),
    )
    assert r.status_code == 201
    assert r.json()["assignee_id"] is None


def test_ticket_requester_and_org_come_from_token(client):
    t = make_ticket(client, "a@tata.com")
    assert t["requester_id"] == 3


def test_jira_webhook_rejects_without_secret(client):
    assert client.post("/api/webhooks/jira", json={}).status_code == 403
    assert client.post("/api/webhooks/jira", json={}, headers={"X-Webhook-Secret": "guess"}).status_code == 403


# ── Live event feed ──────────────────────────────────────────────────────────

def test_live_feed_requires_a_valid_token(client):
    from starlette.websockets import WebSocketDisconnect
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/anyone"):
            pass
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/anyone?token=garbage"):
            pass


def test_live_feed_delivers_events_only_to_people_who_may_see_them(client):
    tata = login(client, "a@tata.com").json()["access_token"]
    acme = login(client, "b@acme.com").json()["access_token"]
    lead = login(client, "lead@x.com").json()["access_token"]
    with client.websocket_connect(f"/ws/x?token={tata}") as ws_tata, \
         client.websocket_connect(f"/ws/x?token={acme}") as ws_acme, \
         client.websocket_connect(f"/ws/x?token={lead}") as ws_lead:
        make_ticket(client, "a@tata.com", "Tata poster")
        msg = ws_lead.receive_json()
        assert msg["type"] == "ticket_created" and msg["title"] == "Tata poster" and msg["by"] == "Tata A"
        assert ws_tata.receive_json()["ticketNumber"] == msg["ticketNumber"]
        # The ACME client must not hear about TATA's ticket: send ACME's own, and it should be the first thing they get.
        make_ticket(client, "b@acme.com", "Acme flyer")
        assert ws_acme.receive_json()["title"] == "Acme flyer"


def test_register_creates_scoped_client_only(client):
    c = client
    body = {"full_name": "New Client", "email": "NewClient@Example.com", "company": "Zeta Corp Test", "password": "longenough1"}
    r = c.post("/api/auth/register", json=body)
    assert r.status_code == 201
    assert r.json()["user"]["role"] == "Client" and r.json()["user"]["client_org"] == "Zeta Corp Test"
    assert c.post("/api/auth/register", json=body).status_code == 409
    assert c.post("/api/auth/register", json={**body, "email": "other@example.com", "company": "zeta corp test"}).status_code == 409
    assert c.post("/api/auth/register", json={**body, "email": "q@example.com", "company": "tata"}).status_code == 409
    assert c.post("/api/auth/register", json={**body, "email": "x@example.com", "company": "Y Co", "password": "short"}).status_code == 422
    assert c.post("/api/auth/register", json={**body, "email": "z@example.com", "company": "Z Co", "role": "ADMIN"}).json()["user"]["role"] == "Client"
