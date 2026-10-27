"""Two-day windows and the 12-hour change cut-off before the event (or, without an event date, the deadline)."""
import datetime

import pytz

import approvals
import models
from test_auth import TestingSessionLocal, auth, client, make_ticket  # noqa: F401
from test_review_flow import client_decides, isolated, sent_design  # noqa: F401  (upload dir + inline delivery)
from test_workflow_features import db_ticket, set_status

IST = pytz.timezone("Asia/Kolkata")


def update_ticket(tid, **values):
    db = TestingSessionLocal()
    db.query(models.Ticket).filter_by(id=tid).update(values)
    db.commit()
    db.close()


def ask_for_changes(client, tid):
    return client.post(f"/api/tickets/{tid}/revisions", json={"reason_for_change": "Bigger logo"}, headers=auth(client, "lead@x.com"))


def event_in(hours):
    """type_specific_fields whose event day starts `hours` from now (the cut-off is 12 hours before that)."""
    start = datetime.datetime.now(IST) + datetime.timedelta(hours=hours)
    return {"event_date": start.date().isoformat()}, IST.localize(datetime.datetime.combine(start.date(), datetime.time()))


def test_review_link_and_edit_window_last_two_days(client):
    tid, _ = sent_design(client)
    req = TestingSessionLocal().query(models.ApprovalRequest).filter_by(ticket_id=tid).one()
    assert abs((req.expires_at - req.created_at).total_seconds() - 48 * 3600) < 60
    assert approvals.MAX_TTL_HOURS == 48

    t = make_ticket(client, "a@tata.com")
    set_status(client, t["id"], "Delivered")
    ticket = db_ticket(t["id"])
    left = ticket.edit_window_ends_at.replace(tzinfo=pytz.utc) - datetime.datetime.now(pytz.utc)
    assert datetime.timedelta(hours=47, minutes=55) < left <= datetime.timedelta(hours=48)


def test_changes_blocked_within_12_hours_of_the_event(client):
    t = make_ticket(client, "a@tata.com")
    set_status(client, t["id"], "Delivered")
    fields, _ = event_in(5 * 24)
    update_ticket(t["id"], type_specific_fields=fields)
    assert ask_for_changes(client, t["id"]).status_code == 201          # days away: fine

    t2 = make_ticket(client, "a@tata.com", title="Tomorrow's workshop")
    set_status(client, t2["id"], "Delivered")
    fields, _ = event_in(6)                                              # event day starts in 6 h: past the cut-off
    update_ticket(t2["id"], type_specific_fields=fields, due_at=datetime.datetime.now(pytz.utc) + datetime.timedelta(days=9))
    r = ask_for_changes(client, t2["id"])
    assert r.status_code == 409 and "within 12 hours of the event" in r.json()["detail"]
    assert db_ticket(t2["id"]).status == models.TicketStatus.DELIVERED  # nothing changed


def test_without_an_event_date_the_deadline_is_used(client):
    t = make_ticket(client, "a@tata.com")
    set_status(client, t["id"], "Delivered")
    update_ticket(t["id"], type_specific_fields={}, due_at=datetime.datetime.now(pytz.utc) + datetime.timedelta(hours=11))
    assert ask_for_changes(client, t["id"]).status_code == 409

    t2 = make_ticket(client, "a@tata.com", title="Later")
    set_status(client, t2["id"], "Delivered")
    update_ticket(t2["id"], type_specific_fields={}, due_at=datetime.datetime.now(pytz.utc) + datetime.timedelta(hours=13))
    assert ask_for_changes(client, t2["id"]).status_code == 201


def test_review_page_refuses_changes_after_the_cut_off_but_still_allows_approval(client):
    tid, _ = sent_design(client)
    fields, _ = event_in(3)
    update_ticket(tid, type_specific_fields=fields)
    r = client_decides(client, tid, "request_changes", "Change the colour")
    assert r.status_code == 409 and "12 hours" in r.json()["detail"]
    assert client_decides(client, tid, "approve").status_code == 200


def test_a_late_delivery_can_still_be_corrected(client):
    t = make_ticket(client, "a@tata.com", title="Delivered late")
    set_status(client, t["id"], "Delivered")
    update_ticket(t["id"], type_specific_fields={}, due_at=datetime.datetime.now(pytz.utc) - datetime.timedelta(hours=3))
    assert ask_for_changes(client, t["id"]).status_code == 201
