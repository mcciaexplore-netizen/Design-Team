"""Starting afresh: a Design Lead deletes every past request and what belongs to it, keeping the team and settings."""
import models
from test_approvals_reports import isolated, upload_proof  # noqa: F401  (keeps uploads in a temp folder)
from test_auth import TestingSessionLocal, auth, client, make_ticket  # noqa: F401  (shared fixture)

GO = {"confirm": "DELETE ALL DATA", "password": "secret-pw"}


def count(model):
    db = TestingSessionLocal()
    try:
        return db.query(model).count()
    finally:
        db.close()


def test_everything_from_past_requests_goes_and_the_team_stays(client):
    lead = auth(client, "lead@x.com")
    a, b = make_ticket(client, "a@tata.com", "Expo"), make_ticket(client, "b@acme.com", "Summit")
    assert upload_proof(client, a["id"]).status_code == 201
    client.post(f"/api/tickets/{b['id']}/client-changes", json={"text": "bigger logo"}, headers=lead)
    users_before = count(models.User)

    r = client.post("/api/admin/delete-all-data", json=GO, headers=lead)
    assert r.status_code == 200, r.text
    assert r.json()["tickets"] == 2 and r.json()["files"] == 1 and r.json()["clients_removed"] == 0
    for model in (models.Ticket, models.ProofVersion, models.ApprovalRequest, models.AuditLog, models.Notification):
        assert count(model) == 0, model
    assert count(models.User) == users_before and count(models.DesignType) >= 1
    assert client.get("/api/tickets", headers=lead).json() == []

    # Numbering carries on, so an old tracking link never opens someone else's new request.
    fresh = make_ticket(client, "a@tata.com", "New start")
    assert int(fresh["ticket_number"].split("-")[1]) > max(int(a["ticket_number"][3:]), int(b["ticket_number"][3:]))


def test_client_accounts_can_go_too(client):
    make_ticket(client, "a@tata.com")
    r = client.post("/api/admin/delete-all-data", json={**GO, "remove_clients": True}, headers=auth(client, "lead@x.com"))
    assert r.json()["clients_removed"] == 2
    assert client.post("/api/auth/token", data={"username": "a@tata.com", "password": "secret-pw"}).status_code == 401
    assert client.post("/api/auth/token", data={"username": "des@x.com", "password": "secret-pw"}).status_code == 200


def test_it_needs_the_phrase_the_password_and_a_design_lead(client):
    make_ticket(client, "a@tata.com")
    lead = auth(client, "lead@x.com")
    assert client.post("/api/admin/delete-all-data", json={**GO, "confirm": "delete"}, headers=lead).status_code == 422
    assert client.post("/api/admin/delete-all-data", json={**GO, "password": "wrong"}, headers=lead).status_code == 403
    assert client.post("/api/admin/delete-all-data", json=GO, headers=auth(client, "des@x.com")).status_code == 403
    assert client.post("/api/admin/delete-all-data", json=GO).status_code == 401
    assert count(models.Ticket) == 1
