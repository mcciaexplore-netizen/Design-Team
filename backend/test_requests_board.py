"""The public requests board: everyone's requests without signing in, nothing personal."""
import datetime

import models
import tracking
from test_auth import TestingSessionLocal, client  # noqa: F401  (shared fixture)
from test_workflow_features import clear_hits, form, isolated  # noqa: F401


def set_status(number, status):
    db = TestingSessionLocal()
    db.query(models.Ticket).filter(models.Ticket.ticket_number == number).update({"status": status})
    db.commit()
    db.close()


def submit(client, accept=True, **over):
    r = client.post("/api/public/requests", data=form(**over))
    assert r.status_code == 201, r.text
    clear_hits()
    number = r.json()["ticket_number"]
    if accept:   # what a Design Lead accepting it does to the status
        set_status(number, models.TicketStatus.NEW)
    return number


def test_unreviewed_and_declined_requests_stay_off_the_board(client):
    """Anyone can put a client's email and any title on the public form: nothing shows publicly,
    under that client's organisation, until a Design Lead has accepted it."""
    pending = submit(client, accept=False, email="a@tata.com", event_name="Forged")
    declined = submit(client, accept=False, email="a@tata.com", event_name="Spam")
    set_status(declined, models.TicketStatus.DECLINED)
    rows = board(client)
    assert pending not in rows and declined not in rows


def board(client):
    r = client.get("/api/public/requests-board")
    assert r.status_code == 200, r.text
    return {row["ticket_number"]: row for row in r.json()["requests"]}


def test_board_lists_every_request_and_nothing_personal(client):
    tata = submit(client, email="a@tata.com", event_name="Tata Expo")        # a client account the team put in TATA
    walk_in = submit(client, email="new.person@example.com", event_name="Open Day")

    rows = board(client)
    assert walk_in in rows
    assert "organisation" not in rows[tata]   # one organisation (MCCIA): no grouping or company names
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
