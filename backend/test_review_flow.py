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


def pin(client, tid, proof_id, email="a@tata.com", content="Make this bigger", x="40.5", y="22"):
    return client.post(f"/api/tickets/{tid}/pinpoints", json={"image_url": f"proof:{proof_id}", "x_pct": x, "y_pct": y, "content": content},
                       headers=auth(client, email))


# ── Markup ───────────────────────────────────────────────────────────────────

def test_a_client_can_mark_a_spot_on_the_design_and_it_shows_their_name(client):
    tid, proof = sent_design(client)
    r = pin(client, tid, proof)
    assert r.status_code == 201, r.text
    assert r.json()["author_name"] == "Tata A" and r.json()["author_role"] == "Requester" and r.json()["is_resolved"] is False
    seen_by_designer = client.get(f"/api/tickets/{tid}/pinpoints", headers=auth(client, "des@x.com")).json()
    assert [(p["author_name"], p["content"]) for p in seen_by_designer] == [("Tata A", "Make this bigger")]
    assert client.get(f"/api/tickets/{tid}/pinpoints", headers=auth(client, "b@acme.com")).status_code == 404


def test_pins_are_validated(client):
    tid, proof = sent_design(client)
    assert pin(client, tid, proof, content="   ").status_code == 422
    assert pin(client, tid, proof, content="x" * 1001).status_code == 422
    assert pin(client, tid, proof, x="140").status_code == 422
    assert pin(client, tid, proof, y="abc").status_code == 422
    other_tid, other_proof = sent_design(client)
    assert pin(client, tid, other_proof).status_code == 422           # a design from a different ticket
    assert pin(client, tid, 999).status_code == 422


def test_clients_can_only_mark_up_a_design_that_is_out_for_review(client):
    t = make_ticket(client, "a@tata.com")
    proof = upload_design(client, t["id"], send_for_approval="false").json()        # a draft: still Assigned
    assert pin(client, t["id"], proof["id"]).status_code == 403
    assert pin(client, t["id"], proof["id"], email="des@x.com").status_code == 201      # the designer can


def test_either_side_can_tick_a_marked_spot_off(client):
    tid, proof = sent_design(client)
    pid = pin(client, tid, proof).json()["id"]
    r = client.patch(f"/api/tickets/{tid}/pinpoints/{pid}", params={"resolved": "true"}, headers=auth(client, "des@x.com"))
    assert r.status_code == 200 and r.json()["is_resolved"] is True and r.json()["author_name"] == "Tata A"
    r = client.patch(f"/api/tickets/{tid}/pinpoints/{pid}", params={"resolved": "false"}, headers=auth(client, "a@tata.com"))
    assert r.json()["is_resolved"] is False


# ── One conversation ─────────────────────────────────────────────────────────

def test_the_thread_merges_comments_designs_marks_and_decisions_in_order(client):
    tid, proof = sent_design(client)
    cl, des = auth(client, "a@tata.com"), auth(client, "des@x.com")
    time.sleep(1.1)   # SQLite keeps timestamps to the second; space the steps so their order is unambiguous
    pin(client, tid, proof, content="Logo too small")
    time.sleep(1.1)
    client.post(f"/api/tickets/{tid}/comments", json={"content": "Also the date is wrong"}, headers=cl)
    time.sleep(1.1)
    client.post(f"/api/tickets/{tid}/comments", json={"content": "On it"}, headers=des)
    time.sleep(1.1)
    pending = [r for r in client.get(f"/api/tickets/{tid}/approval-requests", headers=cl).json() if r["status"] == "pending"][0]
    client.post(f"/api/approval-requests/{pending['id']}/decision", json={"decision": "request_changes", "comment": "Please fix both"}, headers=cl)

    thread = client.get(f"/api/tickets/{tid}/thread", headers=cl).json()
    assert [(i["kind"], i.get("version")) for i in thread] == [
        ("design_sent", 1), ("pin", 1), ("comment", None), ("comment", None), ("decision", 1)]
    sent, mark, c1, c2, decision = thread
    assert sent["by"] == "Designer" and mark["content"] == "Logo too small" and mark["by"] == "Tata A"
    assert c1["author"]["full_name"] == "Tata A" and c2["content"] == "On it"
    assert decision["decision"] == "changes_requested" and decision["comment"] == "Please fix both" and decision["by"] == "Tata A"
    # the designer sees the very same conversation, and other organisations can't see it at all
    assert [i["kind"] for i in client.get(f"/api/tickets/{tid}/thread", headers=des).json()] == [i["kind"] for i in thread]
    assert client.get(f"/api/tickets/{tid}/thread", headers=auth(client, "b@acme.com")).status_code == 404


def test_approval_shows_in_the_thread(client):
    tid, _ = sent_design(client)
    cl = auth(client, "a@tata.com")
    pending = client.get(f"/api/tickets/{tid}/approval-requests", headers=cl).json()[0]
    client.post(f"/api/approval-requests/{pending['id']}/decision", json={"decision": "approve"}, headers=cl)
    last = client.get(f"/api/tickets/{tid}/thread", headers=cl).json()[-1]
    assert last["kind"] == "decision" and last["decision"] == "approved" and last["by"] == "Tata A"


# ── Reminders ────────────────────────────────────────────────────────────────

def age_request(tid, days):
    db = TestingSessionLocal()
    db.query(models.ApprovalRequest).filter_by(ticket_id=tid, status="pending").update(
        {"created_at": datetime.datetime.now(pytz.utc) - datetime.timedelta(days=days)})
    db.commit()
    db.close()


def reminders(email="a@tata.com"):
    return [n for n in notes(email) if "still waiting for your review" in n]


def test_a_review_left_for_two_days_triggers_one_reminder_then_more_every_two_days(client):
    tid, _ = sent_design(client)
    tick(client)
    assert reminders() == []                         # fresh: no nagging
    age_request(tid, 1.5)
    tick(client)
    assert reminders() == []                         # under two days
    age_request(tid, 2.5)
    tick(client)
    tick(client)
    assert len(reminders()) == 1                     # one reminder, however often the tick runs
    age_request(tid, 4.5)
    tick(client)
    assert len(reminders()) == 2                     # and another two days later


def test_no_reminder_once_the_client_has_decided_or_the_ticket_moved_on(client):
    tid, _ = sent_design(client)
    age_request(tid, 3)
    cl = auth(client, "a@tata.com")
    pending = client.get(f"/api/tickets/{tid}/approval-requests", headers=cl).json()[0]
    client.post(f"/api/approval-requests/{pending['id']}/decision", json={"decision": "approve"}, headers=cl)
    tick(client)
    assert reminders() == []

    t2, _ = sent_design(client)
    age_request(t2, 3)
    set_status(client, t2, "In Progress")           # the designer pulled it back
    tick(client)
    assert reminders() == []


def test_a_resent_design_is_reminded_about_afresh(client):
    tid, _ = sent_design(client)
    age_request(tid, 3)
    tick(client)
    assert len(reminders()) == 1
    upload_design(client, tid)                      # version 2 replaces the open review
    age_request(tid, 3)
    tick(client)
    assert len(reminders()) == 2


def test_muting_review_notifications_silences_the_reminder_too(client):
    client.put("/api/me/preferences", json={"muted_events": ["approval_requested"]}, headers=auth(client, "a@tata.com"))
    tid, _ = sent_design(client)
    age_request(tid, 3)
    tick(client)
    assert reminders() == [] and not any("sent a design" in n for n in notes("a@tata.com"))


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
    to, subject, body = sent[0]
    assert to == "a@tata.com" and t["ticket_number"] in subject
    assert out["approval"]["review_url"] in body and "/review/" in body

    sent.clear()
    upload_design(client, t["id"], send_for_approval="false")      # a draft sends nothing
    assert sent == []
