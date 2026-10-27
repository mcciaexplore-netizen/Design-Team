"""Live dashboards: an activity feed of what just happened, and the team emailed about what matters to them."""
import pytest

import delivery
from test_approvals_reports import isolated  # noqa: F401  (keeps uploads in a temp folder)
from test_auth import auth, client, make_ticket  # noqa: F401  (shared fixture)


@pytest.fixture
def outbox(monkeypatch):
    sent = []
    monkeypatch.setenv("SMTP_HOST", "smtp.zoho.in")
    monkeypatch.setattr(delivery, "run_in_background", lambda fn, *a: fn(*a))
    monkeypatch.setattr(delivery, "send_email", lambda to, subject, body: sent.append((to, subject, body)) or (True, "Sent"))
    return sent


def test_the_feed_shows_new_requests_and_changes_newest_first(client):
    lead, des = auth(client, "lead@x.com"), auth(client, "des@x.com")
    mine, other = make_ticket(client, "a@tata.com", "Expo"), make_ticket(client, "b@acme.com", "Summit")
    client.patch(f"/api/tickets/{mine['id']}", json={"assignee_id": 2}, headers=lead)
    client.patch(f"/api/tickets/{other['id']}", json={"assignee_id": 1}, headers=lead)
    client.post(f"/api/tickets/{mine['id']}/client-changes", json={"text": "Use the blue logo"}, headers=lead)
    client.patch(f"/api/tickets/{mine['id']}", json={"status": "In Progress"}, headers=des)

    feed = client.get("/api/activity", headers=lead).json()
    assert feed[0]["text"] == "Moved to In Progress" and feed[0]["by"] == "Designer" and feed[0]["ticket_number"] == mine["ticket_number"]
    assert feed[1]["kind"] == "client" and feed[1]["text"] == "Changes from the client: Use the blue logo"
    assert {"new"} <= {f["kind"] for f in feed} and {mine["ticket_number"], other["ticket_number"]} <= {f["ticket_number"] for f in feed}

    just_mine = client.get("/api/activity", params={"mine": True}, headers=des).json()
    assert just_mine and {f["ticket_number"] for f in just_mine} == {mine["ticket_number"]}


def test_designers_are_emailed_about_their_work_and_can_turn_it_off(client, outbox):
    lead, des = auth(client, "lead@x.com"), auth(client, "des@x.com")
    t = make_ticket(client, "a@tata.com", "Expo")
    client.patch(f"/api/tickets/{t['id']}", json={"assignee_id": None}, headers=lead)   # undo the automatic assignment
    outbox.clear()
    client.patch(f"/api/tickets/{t['id']}", json={"assignee_id": 2}, headers=lead)
    client.post(f"/api/tickets/{t['id']}/client-changes", json={"text": "Bigger title"}, headers=lead)
    to_designer = [(subject, body) for to, subject, body in outbox if to == "des@x.com"]
    assert len(to_designer) == 2
    assert "assigned you" in to_designer[0][0] and f"/tickets/{t['id']}" in to_designer[0][1]
    assert "Bigger title" in to_designer[1][1]

    prefs = client.get("/api/me/preferences", headers=des).json()
    assert prefs["email_enabled"] is True and prefs["email"] == "des@x.com" and prefs["email_available"] is True
    assert client.put("/api/me/preferences", json={"email_enabled": False}, headers=des).json()["email_enabled"] is False
    outbox.clear()
    client.post(f"/api/tickets/{t['id']}/client-changes", json={"text": "And blue"}, headers=lead)
    assert [to for to, _, _ in outbox] == []
    assert client.get("/api/notifications", headers=des).json()["unread"] >= 3   # still told in the app


def test_a_form_request_tells_the_client_their_number_and_the_leads_who_asked_then_the_assignee(client, outbox):
    from test_workflow_features import clear_hits, form
    clear_hits()
    lead = auth(client, "lead@x.com")
    r = client.post("/api/public/requests", data=form())
    assert r.status_code == 201, r.text
    number = r.json()["ticket_number"]

    [(subject, body)] = [(s, b) for to, s, b in outbox if to == "meera@example.com"]
    assert number in subject and f"Your ticket number is {number}" in body
    [(subject, body)] = [(s, b) for to, s, b in outbox if to == "lead@x.com"]
    assert subject.startswith(f"DesignDesk: New request {number}") and "from Meera Joshi" in subject and "Someone" not in subject
    assert f"Ticket: {number}" in body and "Requested by: Meera Joshi <meera@example.com>" in body
    assert "Event: AI Workshop" in body and "Assigned to: Not assigned yet" in body
    assert "des@x.com" not in [to for to, _, _ in outbox]   # waits for a lead to accept it

    tid = next(t["id"] for t in client.get("/api/tickets", headers=lead).json() if t["ticket_number"] == number)
    outbox.clear()
    assert client.post(f"/api/tickets/{tid}/accept", json={"assignee_id": 2}, headers=lead).status_code == 200
    [(subject, body)] = [(s, b) for to, s, b in outbox if to == "des@x.com"]
    assert "assigned you" in subject and "A ticket was raised and you are assigned to it." in body
    assert "Requested by: Meera Joshi <meera@example.com>" in body and "Assigned to: Designer" in body


def test_a_designer_preset_on_a_template_is_emailed_about_each_ticket(client, outbox):
    from test_views_templates_time import PACK
    lead = auth(client, "lead@x.com")
    tid = client.post("/api/templates", json=PACK, headers=lead).json()["id"]
    outbox.clear()
    assert client.post(f"/api/templates/{tid}/instantiate", json={"requester_id": 3, "assignee_id": 2}, headers=lead).status_code == 201
    to_designer = [s for to, s, _ in outbox if to == "des@x.com"]
    assert len(to_designer) == 2 and all("assigned you" in s for s in to_designer)
