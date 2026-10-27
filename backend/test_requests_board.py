"""The public requests board: everyone's requests without signing in, grouped by organisation, nothing personal."""
import datetime

import models
import tracking
from test_auth import TestingSessionLocal, client  # noqa: F401  (shared fixture)
from test_workflow_features import clear_hits, form, isolated  # noqa: F401


def submit(client, **over):
    r = client.post("/api/public/requests", data=form(**over))
    assert r.status_code == 201, r.text
    clear_hits()
    return r.json()["ticket_number"]


def board(client):
    r = client.get("/api/public/requests-board")
    assert r.status_code == 200, r.text
    return {row["ticket_number"]: row for row in r.json()["requests"]}


def test_board_lists_every_request_with_its_organisation_and_nothing_personal(client):
    tata = submit(client, email="a@tata.com", event_name="Tata Expo")        # a client account the team put in TATA
    walk_in = submit(client, email="new.person@example.com", event_name="Open Day")

    rows = board(client)
    assert rows[tata]["organisation"] == "TATA"
    assert rows[walk_in]["organisation"] is None
    assert rows[tata]["title"].startswith("Tata Expo")
    assert "tracking_url" not in rows[tata]   # tracking links are private to the requester
    text = str(rows)
    for private in ("a@tata.com", "new.person@example.com", "Meera", "brief", "requester"):
        assert private not in text


def test_finished_requests_are_marked_and_drop_off_after_the_window(client):
    recent, old = submit(client), submit(client, event_name="Last year's fair")
    assert board(client)[recent]["finished"] is False
    db = TestingSessionLocal()
    now = datetime.datetime.now(datetime.timezone.utc)
    for number, delivered in ((recent, now), (old, now - datetime.timedelta(days=tracking.BOARD_FINISHED_DAYS + 1))):
        t = db.query(models.Ticket).filter(models.Ticket.ticket_number == number).one()
        t.status, t.delivered_at = models.TicketStatus.CLOSED, delivered
    db.commit()
    db.close()
    rows = board(client)
    assert rows[recent]["finished"] is True
    assert old not in rows   # edited just now, but delivered too long ago


def test_board_can_be_turned_off(client, monkeypatch):
    monkeypatch.setenv("PUBLIC_BOARD", "off")
    assert client.get("/api/public/requests-board").status_code == 404
