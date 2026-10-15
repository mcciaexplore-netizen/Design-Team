"""Client dashboard overview: newest design and open review per request, scoped like the ticket list."""
from test_auth import auth, client, make_ticket  # noqa: F401
from test_review_flow import isolated, sent_design  # noqa: F401
from test_workflow_extras import upload_design


def test_overview_shows_latest_design_and_open_review_for_own_requests_only(client):
    tid, _ = sent_design(client)                       # a TATA request with version 1 out for review
    upload_design(client, tid)                         # version 2 replaces the open review
    other = make_ticket(client, "b@acme.com", title="ACME only")

    mine = client.get("/api/portal/overview", headers=auth(client, "a@tata.com")).json()
    assert str(other["id"]) not in mine                # another company's request is never listed
    entry = mine[str(tid)]
    assert entry["latest_proof"]["version"] == 2
    assert entry["review"] and entry["review"]["expires_at"]
    assert entry["delivered_at"] is None

    theirs = client.get("/api/portal/overview", headers=auth(client, "b@acme.com")).json()
    assert list(theirs) == [str(other["id"])] and theirs[str(other["id"])]["latest_proof"] is None
