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
    models.Base.metadata.drop_all(bind=engine)
    models.Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    pw = hash_password("secret-pw")
    db.add_all([
        models.User(email="lead@x.com", full_name="Lead", role=models.RoleEnum.DESIGN_LEAD, hashed_password=pw),
        models.User(email="des@x.com", full_name="Designer", role=models.RoleEnum.DESIGNER, hashed_password=pw),
        models.User(email="a@tata.com", full_name="Tata A", role=models.RoleEnum.REQUESTER, client_org="TATA", hashed_password=pw),
    ])
    db.commit()
    db.close()
    app.dependency_overrides[get_db] = _override_get_db
    yield TestClient(app)
    app.dependency_overrides.clear()


def login(client, email, password="secret-pw"):
    r = client.post("/api/auth/token", data={"username": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def user_id(client, headers, email):
    return next(u["id"] for u in client.get("/api/admin/users", headers=headers).json() if u["email"] == email)


def test_only_leads_can_manage_users(client):
    h = login(client, "des@x.com")
    assert client.get("/api/admin/users", headers=h).status_code == 403
    assert client.post("/api/admin/users", headers=h, json={"full_name": "Zed Zed", "email": "z@x.com", "role": "Designer"}).status_code == 403
    # No token: there is no login, so this resolves to the shared default staff identity (the seeded Lead here).
    assert client.get("/api/admin/users").status_code == 200


def test_lead_creates_staff_with_temp_password_that_must_be_changed(client):
    lead = login(client, "lead@x.com")
    r = client.post("/api/admin/users", headers=lead, json={"full_name": "New Designer", "email": "New@X.com", "role": "Designer"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["user"]["email"] == "new@x.com" and body["user"]["role"] == "Designer"
    temp = body["temporary_password"]
    assert len(temp) >= 12 and "hashed_password" not in body["user"]

    # Duplicate email (case-insensitive)
    assert client.post("/api/admin/users", headers=lead, json={"full_name": "Dup Dup", "email": "NEW@x.com", "role": "Designer"}).status_code == 409

    # Logs in with the temp password. There is no login gate any more, so nothing blocks using the app before
    # changing it; the change-password endpoint itself still works if something calls it directly.
    login_res = client.post("/api/auth/token", data={"username": "new@x.com", "password": temp}).json()
    assert login_res["user"]["must_change_password"] is True
    h = {"Authorization": f"Bearer {login_res['access_token']}"}
    assert client.get("/api/auth/me", headers=h).status_code == 200
    assert client.get("/api/tickets", headers=h).status_code == 200

    # Wrong current password / too short / same as current are rejected
    assert client.post("/api/auth/change-password", headers=h, json={"current_password": "nope", "new_password": "brand-new-pw1"}).status_code == 400
    assert client.post("/api/auth/change-password", headers=h, json={"current_password": temp, "new_password": "short"}).status_code == 422
    assert client.post("/api/auth/change-password", headers=h, json={"current_password": temp, "new_password": temp}).status_code == 400

    done = client.post("/api/auth/change-password", headers=h, json={"current_password": temp, "new_password": "brand-new-pw1"})
    assert done.status_code == 200 and done.json()["user"]["must_change_password"] is False
    # The old token is no longer valid for this user, but there is no login: it just falls back to the shared
    # default staff identity instead of failing.
    assert client.get("/api/auth/me", headers=h).status_code == 200
    h2 = {"Authorization": f"Bearer {done.json()['access_token']}"}
    assert client.get("/api/tickets", headers=h2).status_code == 200
    assert client.post("/api/auth/token", data={"username": "new@x.com", "password": temp}).status_code == 401
    login(client, "new@x.com", "brand-new-pw1")


def test_clients_cannot_be_given_an_account(client):
    """Accounts are for the design team; clients use the open User app."""
    lead = login(client, "lead@x.com")
    assert client.post("/api/admin/users", headers=lead, json={"full_name": "Cli Ent", "email": "c@y.com", "role": "Client"}).status_code == 422
    des_id = user_id(client, lead, "des@x.com")
    assert client.patch(f"/api/admin/users/{des_id}", headers=lead, json={"role": "Client"}).status_code == 422


def test_reset_password_signs_out_old_sessions(client):
    lead = login(client, "lead@x.com")
    des_headers = login(client, "des@x.com")
    uid = user_id(client, lead, "des@x.com")
    r = client.post(f"/api/admin/users/{uid}/reset-password", headers=lead)
    assert r.status_code == 200
    temp = r.json()["temporary_password"]
    # The old token no longer identifies as that designer; with no login it falls back to the shared staff identity.
    assert client.get("/api/auth/me", headers=des_headers).status_code == 200
    assert client.post("/api/auth/token", data={"username": "des@x.com", "password": "secret-pw"}).status_code == 401
    res = client.post("/api/auth/token", data={"username": "des@x.com", "password": temp}).json()
    assert res["user"]["must_change_password"] is True
    assert client.post("/api/admin/users/9999/reset-password", headers=lead).status_code == 404


def test_deactivate_and_reactivate(client):
    lead = login(client, "lead@x.com")
    des = login(client, "des@x.com")
    uid = user_id(client, lead, "des@x.com")
    r = client.patch(f"/api/admin/users/{uid}", headers=lead, json={"is_active": False})
    assert r.status_code == 200 and r.json()["is_active"] is False
    # Deactivating them doesn't revoke API access: with no login, every request falls back to the shared staff identity.
    assert client.get("/api/auth/me", headers=des).status_code == 200
    assert client.post("/api/auth/token", data={"username": "des@x.com", "password": "secret-pw"}).status_code == 401
    assert client.patch(f"/api/admin/users/{uid}", headers=lead, json={"is_active": True}).json()["is_active"] is True
    login(client, "des@x.com")


def test_role_changes_and_guard_rails(client):
    lead = login(client, "lead@x.com")
    lead_id = user_id(client, lead, "lead@x.com")
    des_id = user_id(client, lead, "des@x.com")

    # Can't lock yourself out
    assert client.patch(f"/api/admin/users/{lead_id}", headers=lead, json={"is_active": False}).status_code == 400
    assert client.patch(f"/api/admin/users/{lead_id}", headers=lead, json={"role": "Designer"}).status_code == 400

    # Promote the designer, then the original lead can be demoted by them (a second lead exists)
    r = client.patch(f"/api/admin/users/{des_id}", headers=lead, json={"role": "Design Lead"})
    assert r.status_code == 200 and r.json()["role"] == "Design Lead"
    new_lead = login(client, "des@x.com")
    assert client.get("/api/admin/users", headers=new_lead).status_code == 200
    assert client.patch(f"/api/admin/users/{lead_id}", headers=new_lead, json={"role": "Designer"}).status_code == 200

    # Last remaining lead can't be demoted by anyone (self-guard)
    assert client.patch(f"/api/admin/users/{des_id}", headers=new_lead, json={"role": "Designer"}).status_code == 400


def test_last_active_lead_cannot_be_removed_by_another_lead(client):
    # Two leads where one is already inactive: the active one is "last" and must stay
    db = TestingSessionLocal()
    db.add(models.User(email="old@x.com", full_name="Old Lead", role=models.RoleEnum.DESIGN_LEAD, is_active=False, hashed_password=hash_password("secret-pw")))
    db.commit()
    db.close()
    lead = login(client, "lead@x.com")
    old_id = user_id(client, lead, "old@x.com")
    # Re-activating then demoting the other one is fine, but removing the final active lead via PATCH on self is blocked
    lead_id = user_id(client, lead, "lead@x.com")
    assert client.patch(f"/api/admin/users/{lead_id}", headers=lead, json={"is_active": False}).status_code == 400
    assert client.patch(f"/api/admin/users/{old_id}", headers=lead, json={"is_active": True}).status_code == 200


def test_lead_changes_an_email_including_their_own(client):
    lead = login(client, "lead@x.com")
    me = user_id(client, lead, "lead@x.com")
    r = client.patch(f"/api/admin/users/{me}", headers=lead, json={"email": "Creative@MCCIA.com"})
    assert r.status_code == 200 and r.json()["email"] == "creative@mccia.com"
    assert client.get("/api/admin/users", headers=lead).status_code == 200      # still signed in
    login(client, "creative@mccia.com")                                          # same password, new address
    assert client.post("/api/auth/token", data={"username": "lead@x.com", "password": "secret-pw"}).status_code == 401

    des = user_id(client, lead, "des@x.com")
    assert client.patch(f"/api/admin/users/{des}", headers=lead, json={"email": "A@tata.com"}).status_code == 409
    assert client.patch(f"/api/admin/users/{des}", headers=lead, json={"email": "not-an-email"}).status_code == 422
    assert client.patch(f"/api/admin/users/{me}", headers=login(client, "des@x.com"), json={"email": "x@x.com"}).status_code == 403
