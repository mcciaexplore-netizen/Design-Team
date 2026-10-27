"""Assigning from the ticket page, and the team noting down changes a client asked for."""
from test_auth import auth, client, make_ticket  # noqa: F401  (shared fixture)
from test_workflow_features import isolated  # noqa: F401


def notes_for(client, email):
    return [n["content"] for n in client.get("/api/notifications", headers=auth(client, email)).json()["items"]]


def test_assigning_a_new_ticket_makes_it_assigned(client):
    t = make_ticket(client, "a@tata.com")
    lead = auth(client, "lead@x.com")
    client.patch(f"/api/tickets/{t['id']}", json={"assignee_id": None}, headers=lead)
    client.patch(f"/api/tickets/{t['id']}", json={"status": "New"}, headers=lead)

    r = client.patch(f"/api/tickets/{t['id']}", json={"assignee_id": 2}, headers=lead)
    assert r.status_code == 200 and r.json()["assignee_id"] == 2 and r.json()["status"] == "Assigned"
    assert client.patch(f"/api/tickets/{t['id']}", json={"assignee_id": 1}, headers=auth(client, "des@x.com")).status_code == 403


def test_bulk_assign_also_moves_new_tickets_to_assigned(client):
    t = make_ticket(client, "a@tata.com")
    lead = auth(client, "lead@x.com")
    client.patch(f"/api/tickets/{t['id']}", json={"assignee_id": None, "status": "New"}, headers=lead)
    r = client.post("/api/tickets/bulk", json={"ticket_ids": [t["id"]], "assignee_id": 2}, headers=lead)
    assert r.status_code == 200, r.text
    after = [x for x in client.get("/api/tickets", headers=lead).json() if x["id"] == t["id"]][0]
    assert after["assignee_id"] == 2 and after["status"] == "Assigned"


def test_staff_note_client_changes_and_the_designer_is_told(client):
    t = make_ticket(client, "a@tata.com")
    lead = auth(client, "lead@x.com")
    client.patch(f"/api/tickets/{t['id']}", json={"assignee_id": 2}, headers=lead)

    r = client.post(f"/api/tickets/{t['id']}/client-changes", json={"text": "  Use the new logo and move the date to 25 Oct  "}, headers=lead)
    assert r.status_code == 201, r.text
    changes = r.json()["type_specific_fields"]["client_changes"]
    assert [c["text"] for c in changes] == ["Use the new logo and move the date to 25 Oct"] and changes[0]["by"] == "Lead"
    assert any("added changes from the client" in n for n in notes_for(client, "des@x.com"))

    client.post(f"/api/tickets/{t['id']}/client-changes", json={"text": "Also make it blue"}, headers=auth(client, "des@x.com"))
    seen = [x for x in client.get("/api/tickets", headers=auth(client, "lead@x.com")).json() if x["id"] == t["id"]][0]
    assert [c["text"] for c in seen["type_specific_fields"]["client_changes"]] == [
        "Use the new logo and move the date to 25 Oct", "Also make it blue"]


def test_client_changes_are_for_the_team_only_and_not_blank(client):
    t = make_ticket(client, "a@tata.com")
    assert client.post(f"/api/tickets/{t['id']}/client-changes", json={"text": "   "}, headers=auth(client, "lead@x.com")).status_code == 422
    assert client.post("/api/tickets/9999/client-changes", json={"text": "x"}, headers=auth(client, "lead@x.com")).status_code == 404
