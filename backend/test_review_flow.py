"""Markup on designs, the one-conversation thread, review reminders and the review email."""
import datetime
import shutil
import tempfile
import time

import pytest
import pytz

import delivery
import models
from test_auth import TestingSessionLocal, auth, client, make_ticket  # noqa: F401
from test_workflow_extras import notes, upload_design
from test_workflow_features import db_ticket, set_status, tick


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    path = tempfile.mkdtemp(prefix="dd-uploads-")
    monkeypatch.setenv("UPLOAD_DIR", path)
    monkeypatch.delenv("S3_ENDPOINT_URL", raising=False)
    monkeypatch.delenv("SMTP_HOST", raising=False)
    monkeypatch.setattr(delivery, "run_in_background", lambda fn, *a: fn(*a))
    yield
    shutil.rmtree(path, ignore_errors=True)


def sent_design(client):
    """A ticket with one design out for the client's review. Returns (ticket id, proof id)."""
    t = make_ticket(client, "a@tata.com")
    proof = upload_design(client, t["id"]).json()
    return t["id"], proof["id"]


def sent_design_with_link(client):
    """Like sent_design, but returns (ticket id, the review-link token emailed with that upload)."""
    t = make_ticket(client, "a@tata.com")
    up = upload_design(client, t["id"]).json()
    return t["id"], up["approval"]["review_url"].rsplit("/", 1)[1]


def client_decides(client, tid, decision="approve", comment=None, name="Tata A"):
    """The client's decision on the newest design, made the only way clients can: through an emailed review link."""
    proof = client.get(f"/api/tickets/{tid}/proofs", headers=auth(client, "lead@x.com")).json()[0]
    r = client.post(f"/api/tickets/{tid}/approval-requests", json={"proof_version_id": proof["id"]}, headers=auth(client, "des@x.com"))
    assert r.status_code == 201, r.text
    token = r.json()["review_url"].rsplit("/", 1)[1]
    return client.post(f"/api/public/review/{token}/decision", json={"decision": decision, "name": name, "comment": comment})


def pin(client, tid, proof_id, email="des@x.com", content="Make this bigger", x="40.5", y="22"):
    return client.post(f"/api/tickets/{tid}/pinpoints", json={"image_url": f"proof:{proof_id}", "x_pct": x, "y_pct": y, "content": content},
                       headers=auth(client, email))


# ── Markup ───────────────────────────────────────────────────────────────────

def test_the_team_can_mark_a_spot_on_the_design_and_it_shows_their_name(client):
    tid, proof = sent_design(client)
    r = pin(client, tid, proof)
    assert r.status_code == 201, r.text
    assert r.json()["author_name"] == "Designer" and r.json()["is_resolved"] is False
    seen_by_lead = client.get(f"/api/tickets/{tid}/pinpoints", headers=auth(client, "lead@x.com")).json()
    assert [(p["author_name"], p["content"]) for p in seen_by_lead] == [("Designer", "Make this bigger")]
    # No token: falls back to the shared staff identity, which can see them.
    assert client.get(f"/api/tickets/{tid}/pinpoints").status_code == 200


def test_pins_are_validated(client):
    tid, proof = sent_design(client)
    assert pin(client, tid, proof, content="   ").status_code == 422
    assert pin(client, tid, proof, content="x" * 1001).status_code == 422
    assert pin(client, tid, proof, x="140").status_code == 422
    assert pin(client, tid, proof, y="abc").status_code == 422
    other_tid, other_proof = sent_design(client)
    assert pin(client, tid, other_proof).status_code == 422           # a design from a different ticket
    assert pin(client, tid, 999).status_code == 422


def test_a_marked_spot_can_be_ticked_off_and_reopened(client):
    tid, proof = sent_design(client)
    pid = pin(client, tid, proof).json()["id"]
    r = client.patch(f"/api/tickets/{tid}/pinpoints/{pid}", params={"resolved": "true"}, headers=auth(client, "des@x.com"))
    assert r.status_code == 200 and r.json()["is_resolved"] is True and r.json()["author_name"] == "Designer"
    r = client.patch(f"/api/tickets/{tid}/pinpoints/{pid}", params={"resolved": "false"}, headers=auth(client, "lead@x.com"))
    assert r.json()["is_resolved"] is False


# ── Reminders ────────────────────────────────────────────────────────────────

def age_request(tid, days):
    db = TestingSessionLocal()
    created = datetime.datetime.now(pytz.utc) - datetime.timedelta(days=days)
    db.query(models.ApprovalRequest).filter_by(ticket_id=tid, status="pending").update(
        {"created_at": created, "expires_at": created + datetime.timedelta(days=2)})
    db.commit()
    db.close()


def reminders(email="a@tata.com"):
    return [n for n in notes(email) if "still waiting for your review" in n]


def test_a_review_is_reminded_once_after_a_day_then_closes_after_two(client):
    tid, _ = sent_design(client)
    tick(client)
    assert reminders() == []                         # fresh: no nagging
    age_request(tid, 0.5)
    tick(client)
    assert reminders() == []                         # under a day
    age_request(tid, 1.2)
    tick(client)
    tick(client)
    assert len(reminders()) == 1                     # one reminder, however often the tick runs
    age_request(tid, 2.1)
    tick(client)
    t = db_ticket(tid)
    assert t.status == models.TicketStatus.CLOSED_WITHOUT_APPROVAL and t.is_locked   # no answer in 2 days: closed
    assert len(reminders()) == 1


def test_no_reminder_once_the_client_has_decided_or_the_ticket_moved_on(client):
    tid, _ = sent_design(client)
    age_request(tid, 1.5)
    client_decides(client, tid, "approve")
    tick(client)
    assert reminders() == []

    t2, _ = sent_design(client)
    age_request(t2, 1.5)
    set_status(client, t2, "In Progress")           # the designer pulled it back
    tick(client)
    assert reminders() == []


def test_a_resent_design_is_reminded_about_afresh(client):
    tid, _ = sent_design(client)
    age_request(tid, 1.5)
    tick(client)
    assert len(reminders()) == 1
    upload_design(client, tid)                      # version 2 replaces the open review
    age_request(tid, 1.5)
    tick(client)
    assert len(reminders()) == 2


def test_a_second_wait_on_the_same_ticket_is_reminded_too(client):
    t = make_ticket(client, "a@tata.com")

    def wait_and_age(hours):
        set_status(client, t["id"], "Waiting on Requester")
        db = TestingSessionLocal()
        db.query(models.Ticket).filter_by(id=t["id"]).update({"paused_at": datetime.datetime.now(pytz.utc) - datetime.timedelta(hours=hours)})
        db.commit()
        db.close()
        tick(client)

    wait_and_age(30)
    set_status(client, t["id"], "In Progress")
    wait_and_age(40)
    assert sum("waiting for your reply" in n for n in notes("a@tata.com")) == 2


# ── Email ────────────────────────────────────────────────────────────────────

def test_the_client_is_emailed_the_review_link_when_a_design_is_sent(client, monkeypatch):
    sent = []
    monkeypatch.setattr(delivery, "send_email", lambda to, subject, body: sent.append((to, subject, body)) or (True, "ok"))
    monkeypatch.setenv("SMTP_HOST", "smtp.example.com")
    t = make_ticket(client, "a@tata.com")
    out = upload_design(client, t["id"]).json()
    # The team is emailed too, and the client already had the request confirmation: pick the review email.
    to, subject, body = next(m for m in sent if m[0] == "a@tata.com" and "approval" in m[1])
    assert to == "a@tata.com" and t["ticket_number"] in subject
    assert out["approval"]["review_url"] in body and "/review/" in body

    sent.clear()
    upload_design(client, t["id"], send_for_approval="false")      # a draft sends nothing
    assert sent == []
