"""Fixes from the code review: cron robustness, closing labels, stale review links, bad PATCH values, form identity."""
import datetime

import pytz

import models
from test_auth import TestingSessionLocal, auth, client, make_ticket  # noqa: F401
from test_review_flow import isolated, sent_design  # noqa: F401
from test_workflow_features import db_ticket, form, set_status, tick


def update(model, row_id, **values):
    db = TestingSessionLocal()
    db.query(model).filter_by(id=row_id).update(values)
    db.commit()
    db.close()


def test_an_unassigned_overdue_ticket_does_not_stop_the_tick(client):
    t = make_ticket(client, "a@tata.com")
    update(models.Ticket, t["id"], assignee_id=None, status=models.TicketStatus.NEW,
           due_at=datetime.datetime.now(pytz.utc) - datetime.timedelta(hours=5))
    later = make_ticket(client, "a@tata.com", title="Delivered earlier")
    set_status(client, later["id"], "Delivered")
    update(models.Ticket, later["id"], edit_window_ends_at=datetime.datetime.now(pytz.utc) - datetime.timedelta(hours=1))

    assert tick(client).status_code == 200
    assert db_ticket(t["id"]).is_overdue
    assert db_ticket(later["id"]).is_locked          # the other steps still ran


def test_an_approved_design_closes_as_closed_not_without_approval(client):
    tid, _ = sent_design(client)
    cl = auth(client, "a@tata.com")
    pending = client.get(f"/api/tickets/{tid}/approval-requests", headers=cl).json()[0]
    assert client.post(f"/api/approval-requests/{pending['id']}/decision", json={"decision": "approve"}, headers=cl).status_code == 200
    update(models.Ticket, tid, edit_window_ends_at=datetime.datetime.now(pytz.utc) - datetime.timedelta(hours=1))
    tick(client)
    assert db_ticket(tid).status == models.TicketStatus.CLOSED


def test_an_old_review_link_cannot_move_a_ticket_that_moved_on(client):
    tid, _ = sent_design(client)
    cl = auth(client, "a@tata.com")
    pending = client.get(f"/api/tickets/{tid}/approval-requests", headers=cl).json()[0]
    set_status(client, tid, "In Progress")             # the designer pulled it back
    r = client.post(f"/api/approval-requests/{pending['id']}/decision", json={"decision": "approve"}, headers=cl)
    assert r.status_code == 409
    assert db_ticket(tid).status == models.TicketStatus.IN_PROGRESS


def test_blank_values_and_bad_ids_are_refused(client):
    t = make_ticket(client, "a@tata.com")
    lead = auth(client, "lead@x.com")
    assert client.patch(f"/api/tickets/{t['id']}", json={"tags": None}, headers=lead).status_code == 422
    assert client.patch(f"/api/tickets/{t['id']}", json={"status": None}, headers=lead).status_code == 422
    assert client.patch(f"/api/tickets/{t['id']}", json={"assignee_id": 9999}, headers=lead).status_code == 422
    client_id = TestingSessionLocal().query(models.User).filter_by(email="a@tata.com").one().id
    assert client.patch(f"/api/tickets/{t['id']}", json={"assignee_id": client_id}, headers=lead).status_code == 422
    assert client.get("/api/tickets", headers=lead).status_code == 200


def test_bulk_delivery_opens_the_edit_window(client):
    t = make_ticket(client, "a@tata.com")
    r = client.post("/api/tickets/bulk", json={"ticket_ids": [t["id"]], "status": "Delivered"}, headers=auth(client, "lead@x.com"))
    assert r.status_code == 200, r.text
    assert db_ticket(t["id"]).edit_window_ends_at is not None


def test_public_form_cannot_post_as_staff_or_into_a_company_portal(client):
    assert client.post("/api/public/requests", data=form(email="des@x.com")).status_code == 409
    r = client.post("/api/public/requests", data=form(email="a@tata.com"))
    assert r.status_code == 201, r.text
    db = TestingSessionLocal()
    t = db.query(models.Ticket).filter_by(ticket_number=r.json()["ticket_number"]).one()
    db.close()
    assert t.client_org is None        # not shown in TATA's portal just because someone typed that email


def test_a_client_link_for_a_company_name_still_on_old_tickets_joins_it(client, monkeypatch):
    import re
    import delivery
    sent = []
    monkeypatch.setenv("SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("PUBLIC_APP_URL", "https://app.example.com")
    monkeypatch.setattr(delivery, "send_email", lambda to, subject, body: sent.append((to, subject, body)) or (True, "Sent"))

    t = make_ticket(client, "a@tata.com")
    update(models.Ticket, t["id"], client_org="Old Co")
    # Same domain as the ticket's own requester (a@tata.com): a real colleague, so the join is allowed.
    r = client.post("/api/public/client-link", json={"full_name": "New Person", "email": "new@tata.com", "company": "old co"})
    assert r.status_code == 200
    mail = next(m for m in sent if m[0] == "new@tata.com")
    token = re.search(r"https://app\.example\.com/client/(\S+)", mail[2]).group(1)
    exchanged = client.post("/api/public/client-link/exchange", json={"token": token})
    assert exchanged.json()["user"]["client_org"] == "Old Co"   # joins using the ticket's existing casing, not the typed one


def test_a_shared_free_mail_domain_is_not_proof_of_membership(client, monkeypatch):
    import delivery
    sent = []
    monkeypatch.setenv("SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("PUBLIC_APP_URL", "https://app.example.com")
    monkeypatch.setattr(delivery, "send_email", lambda to, subject, body: sent.append((to, subject, body)) or (True, "Sent"))

    db = TestingSessionLocal()
    db.add(models.User(email="member@gmail.com", full_name="Member", role=models.RoleEnum.REQUESTER,
                       client_org="Gmail Team Co", hashed_password="x"))
    db.commit()
    db.close()
    r = client.post("/api/public/client-link", json={"email": "Stranger@GMAIL.com", "company": "gmail team co"})
    assert r.status_code == 200
    assert sent == []   # sharing gmail.com with a member must not let anyone join the company


def test_a_different_domain_cannot_claim_someone_elses_company(client, monkeypatch):
    """Company names are public (the requests board shows them), so knowing one must never be enough to see
    its tickets: only an email on the same domain as an existing member may join it."""
    import delivery
    sent = []
    monkeypatch.setenv("SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("PUBLIC_APP_URL", "https://app.example.com")
    monkeypatch.setattr(delivery, "send_email", lambda to, subject, body: sent.append((to, subject, body)) or (True, "Sent"))

    make_ticket(client, "a@tata.com")   # client_org "TATA" from the shared fixture
    sent.clear()
    r = client.post("/api/public/client-link", json={"email": "attacker@evil.com", "company": "tata"})
    assert r.status_code == 200
    assert sent == []   # no account created, no link sent: the attempt is silently refused, not just unprivileged
