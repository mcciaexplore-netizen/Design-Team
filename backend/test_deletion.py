"""Deleting tickets and people: leads only, nothing left dangling, shared files kept, history kept for people."""
import json
import os

import models
from test_auth import TestingSessionLocal, auth, client, login, make_ticket  # noqa: F401
from test_review_flow import client_decides, isolated, sent_design  # noqa: F401
from test_workflow_features import PNG, form


def count(model, **filters):
    db = TestingSessionLocal()
    try:
        return db.query(model).filter_by(**filters).count()
    finally:
        db.close()


def test_only_a_lead_can_delete_a_ticket_and_everything_it_owns_goes(client):
    tid, _ = sent_design(client)
    assert client.delete(f"/api/tickets/{tid}", headers=auth(client, "des@x.com")).status_code == 403
    files_before = set(os.listdir(os.environ["UPLOAD_DIR"]))
    assert files_before

    assert client.delete(f"/api/tickets/{tid}", headers=auth(client, "lead@x.com")).status_code == 204
    for model in (models.Ticket, models.ProofVersion, models.ApprovalRequest, models.AuditLog):
        assert count(model, **({"id": tid} if model is models.Ticket else {"ticket_id": tid})) == 0
    assert set(os.listdir(os.environ["UPLOAD_DIR"])) == set()      # its design file is gone too
    assert client.get("/api/tickets", headers=auth(client, "lead@x.com")).status_code == 200
    assert client.delete(f"/api/tickets/{tid}", headers=auth(client, "lead@x.com")).status_code == 404


def test_a_file_shared_with_another_ticket_is_kept(client):
    import common
    first = make_ticket(client, "a@tata.com", "First")
    second = make_ticket(client, "a@tata.com", "Second")
    key = common.store_bytes(PNG, "png", "brief.png")
    db = TestingSessionLocal()
    db.add_all([
        models.Attachment(ticket_id=first["id"], file_name="brief.png", file_url=key, content_type="image/png", size_bytes=len(PNG), uploaded_by_id=first["requester_id"]),
        models.Attachment(ticket_id=second["id"], file_name="brief.png", file_url=key, content_type="image/png", size_bytes=len(PNG), uploaded_by_id=second["requester_id"]),
    ])
    db.commit()
    db.close()

    assert client.delete(f"/api/tickets/{first['id']}", headers=auth(client, "lead@x.com")).status_code == 204
    assert len(os.listdir(os.environ["UPLOAD_DIR"])) == 1                 # still attached to the other ticket
    att = TestingSessionLocal().query(models.Attachment).filter_by(ticket_id=second["id"]).one()
    assert client.get(f"/api/attachments/{att.id}/download", headers=auth(client, "lead@x.com")).status_code == 200


def test_deleting_an_original_keeps_its_newer_version(client):
    tid, _ = sent_design(client)
    out = client_decides(client, tid, "request_changes", "Bigger").json()
    v2 = out["new_ticket"]["id"]
    assert client.delete(f"/api/tickets/{tid}", headers=auth(client, "lead@x.com")).status_code == 204
    assert count(models.Ticket, id=v2) == 1 and count(models.Ticket, id=tid) == 0


def test_a_person_with_no_history_is_erased(client):
    lead = auth(client, "lead@x.com")
    made = client.post("/api/admin/users", json={"full_name": "Temp Person", "email": "temp@x.com", "role": "Designer"}, headers=lead).json()
    uid = made["user"]["id"]
    assert client.delete(f"/api/admin/users/{uid}", headers=lead).json() == {"outcome": "erased"}
    assert count(models.User, id=uid) == 0


def test_a_person_with_history_is_removed_but_their_work_stays(client):
    lead = auth(client, "lead@x.com")
    t = make_ticket(client, "a@tata.com")
    des_id = TestingSessionLocal().query(models.User).filter_by(email="des@x.com").one().id
    client.patch(f"/api/tickets/{t['id']}", json={"assignee_id": des_id}, headers=lead)

    assert client.delete(f"/api/admin/users/{des_id}", headers=lead).json() == {"outcome": "removed"}
    assert login(client, "des@x.com").status_code == 401                  # can't sign in, email no longer known
    db = TestingSessionLocal()
    gone = db.query(models.User).filter_by(id=des_id).one()
    ticket = db.query(models.Ticket).filter_by(id=t["id"]).one()
    db.close()
    assert gone.full_name.endswith("(removed)") and not gone.is_active
    assert ticket.assignee_id is None                                       # open work back in the queue
    assert all(u["id"] != des_id for u in client.get("/api/admin/users", headers=lead).json())


def test_guard_rails(client):
    lead = auth(client, "lead@x.com")
    me = TestingSessionLocal().query(models.User).filter_by(email="lead@x.com").one().id
    assert client.delete(f"/api/admin/users/{me}", headers=lead).status_code == 400
    other = TestingSessionLocal().query(models.User).filter_by(email="a@tata.com").one().id
    assert client.delete(f"/api/admin/users/{other}", headers=auth(client, "des@x.com")).status_code == 403
