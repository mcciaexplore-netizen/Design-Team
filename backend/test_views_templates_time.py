import datetime

import pytest
import pytz

import delivery
import models
import timetracking
from templates_recurring import compute_next_run, render_text, run_due_rules
from test_auth import TestingSessionLocal, auth, client, make_ticket  # noqa: F401

IST = pytz.timezone("Asia/Kolkata")


@pytest.fixture(autouse=True)
def sync_background(monkeypatch):
    monkeypatch.setattr(delivery, "run_in_background", lambda fn, *a: fn(*a))


def ist(y, m, d, h=0, mi=0):
    return IST.localize(datetime.datetime(y, m, d, h, mi)).astimezone(pytz.utc)


# ── Saved views ──────────────────────────────────────────────────────────────

def test_saved_views_crud_and_visibility(client):
    des, lead, cl = auth(client, "des@x.com"), auth(client, "lead@x.com"), auth(client, "a@tata.com")
    body = {"name": "My tickets", "filters": {"assignee": "me", "sla": "breaching_soon", "priorities": ["High", "Urgent"]}}
    r = client.post("/api/views", json=body, headers=des)
    assert r.status_code == 201 and r.json()["filters"]["sla"] == "breaching_soon"
    vid = r.json()["id"]

    assert client.post("/api/views", json={**body, "is_shared": True}, headers=des).status_code == 403  # only leads share
    shared = client.post("/api/views", json={"name": "Team: overdue", "filters": {"sla": "overdue"}, "is_shared": True}, headers=lead).json()

    names = lambda h: sorted(v["name"] for v in client.get("/api/views", headers=h).json())
    assert names(des) == ["My tickets", "Team: overdue"]  # own + shared
    assert names(lead) == ["Team: overdue"]               # lead doesn't see the designer's private view
    assert names(cl) == []                                # clients never see staff views, shared or not

    assert client.put(f"/api/views/{vid}", json={**body, "name": "Renamed"}, headers=lead).status_code == 404
    assert client.put(f"/api/views/{vid}", json={**body, "name": "Renamed"}, headers=des).json()["name"] == "Renamed"
    assert client.delete(f"/api/views/{shared['id']}", headers=des).status_code == 404
    assert client.delete(f"/api/views/{shared['id']}", headers=lead).status_code == 204
    assert client.delete(f"/api/views/{vid}", headers=des).status_code == 204


def test_saved_view_rejects_unknown_filter_keys_and_values(client):
    h = auth(client, "des@x.com")
    for filters in ({"evil": 1}, {"sla": "whenever"}, {"requester": "someone"}, {"tags": ["x"] * 11}):
        assert client.post("/api/views", json={"name": "x", "filters": filters}, headers=h).status_code == 422
    assert client.post("/api/views", json={"name": "", "filters": {}}, headers=h).status_code == 422


def test_saved_view_limit(client):
    h = auth(client, "des@x.com")
    for i in range(30):
        assert client.post("/api/views", json={"name": f"v{i}", "filters": {}}, headers=h).status_code == 201
    assert client.post("/api/views", json={"name": "one too many", "filters": {}}, headers=h).status_code == 400


# ── Bulk actions ─────────────────────────────────────────────────────────────

def test_bulk_status_and_tags_for_designer_but_not_priority_or_assignee(client):
    ids = [make_ticket(client, "a@tata.com", f"T{i}")["id"] for i in range(3)]
    des = auth(client, "des@x.com")
    r = client.post("/api/tickets/bulk", json={"ticket_ids": ids, "status": "In Progress", "add_tags": ["Q3", " Q3 ", "Social"]}, headers=des)
    assert r.status_code == 200 and r.json()["updated"] == ids and r.json()["failed"] == []
    listing = {t["id"]: t for t in client.get("/api/tickets", headers=des).json()}
    assert all(listing[i]["status"] == "In Progress" and listing[i]["tags"] == ["Q3", "Social"] for i in ids)
    assert client.post("/api/tickets/bulk", json={"ticket_ids": ids, "priority": "Urgent"}, headers=des).status_code == 403
    assert client.post("/api/tickets/bulk", json={"ticket_ids": ids, "assignee_id": 2}, headers=des).status_code == 403
    client.post("/api/tickets/bulk", json={"ticket_ids": ids[:1], "remove_tags": ["Q3"]}, headers=des)
    listing = {t["id"]: t for t in client.get("/api/tickets", headers=des).json()}
    assert listing[ids[0]]["tags"] == ["Social"] and listing[ids[1]]["tags"] == ["Q3", "Social"]


def test_bulk_lead_assigns_unassigns_and_reports_failures(client):
    t1 = make_ticket(client, "a@tata.com")["id"]
    t2 = make_ticket(client, "a@tata.com")["id"]
    lead = auth(client, "lead@x.com")
    db = TestingSessionLocal()
    db.query(models.Ticket).filter_by(id=t2).update({"is_locked": True})
    db.commit()
    db.close()
    r = client.post("/api/tickets/bulk", json={"ticket_ids": [t1, t2, 9999], "assignee_id": 2, "priority": "High"}, headers=lead).json()
    assert r["updated"] == [t1]
    assert {f["id"]: f["reason"] for f in r["failed"]} == {t2: "Ticket is locked", 9999: "Ticket not found"}
    tk = [t for t in client.get("/api/tickets", headers=lead).json() if t["id"] == t1][0]
    assert tk["assignee_id"] == 2 and tk["priority"] == "High"
    # explicit null unassigns; omitting the key leaves the assignee alone
    client.post("/api/tickets/bulk", json={"ticket_ids": [t1], "add_tags": ["x"]}, headers=lead)
    assert [t for t in client.get("/api/tickets", headers=lead).json() if t["id"] == t1][0]["assignee_id"] == 2
    client.post("/api/tickets/bulk", json={"ticket_ids": [t1], "assignee_id": None}, headers=lead)
    assert [t for t in client.get("/api/tickets", headers=lead).json() if t["id"] == t1][0]["assignee_id"] is None


def test_bulk_validation_and_permissions(client):
    t = make_ticket(client, "a@tata.com")["id"]
    lead, cl = auth(client, "lead@x.com"), auth(client, "a@tata.com")
    assert client.post("/api/tickets/bulk", json={"ticket_ids": [t], "status": "Closed"}, headers=cl).status_code == 403
    assert client.post("/api/tickets/bulk", json={"ticket_ids": [t]}, headers=lead).status_code == 422  # nothing to change
    assert client.post("/api/tickets/bulk", json={"ticket_ids": [], "status": "Closed"}, headers=lead).status_code == 422
    assert client.post("/api/tickets/bulk", json={"ticket_ids": list(range(101)), "status": "Closed"}, headers=lead).status_code == 422
    assert client.post("/api/tickets/bulk", json={"ticket_ids": [t], "assignee_id": 3}, headers=lead).status_code == 422  # a client can't be assignee
    assert client.post("/api/tickets/bulk", json={"ticket_ids": [t], "status": "Bogus"}, headers=lead).status_code == 422
    assert client.post("/api/tickets/bulk", json={"ticket_ids": [t], "status": "Closed", "delete": True}, headers=lead).status_code == 422


def test_bulk_writes_audit_entries(client):
    t = make_ticket(client, "a@tata.com")["id"]
    lead = auth(client, "lead@x.com")
    client.post("/api/tickets/bulk", json={"ticket_ids": [t], "status": "In Progress"}, headers=lead)
    trail = client.get(f"/api/tickets/{t}/audit", headers=lead).json()
    assert [a["action"] for a in trail] == ["Created", "Bulk update"] and trail[1]["actor"] == "Lead"


def test_duplicate_keeps_client_and_resets_state(client):
    src = make_ticket(client, "a@tata.com", "Original")
    lead = auth(client, "lead@x.com")
    client.patch(f"/api/tickets/{src['id']}", json={"status": "In Progress", "assignee_id": 2}, headers=lead)
    r = client.post(f"/api/tickets/{src['id']}/duplicate", headers=auth(client, "des@x.com"))
    assert r.status_code == 201
    copy = r.json()
    assert copy["title"] == "Original (Copy)" and copy["status"] == "New" and copy["assignee_id"] is None
    assert copy["client_org"] == "TATA" and copy["requester_id"] == src["requester_id"] and copy["ticket_number"] != src["ticket_number"]
    assert [t["title"] for t in client.get("/api/tickets", headers=auth(client, "a@tata.com")).json()].count("Original (Copy)") == 1
    assert client.post(f"/api/tickets/{src['id']}/duplicate", headers=auth(client, "a@tata.com")).status_code == 403
    assert client.post("/api/tickets/9999/duplicate", headers=lead).status_code == 404


# ── Templates & recurring ────────────────────────────────────────────────────

def test_compute_next_run_weekly_and_monthly():
    # Monday 9:00 IST rule, asked on Sunday -> next day; asked exactly at fire time -> next week
    assert compute_next_run("weekly", 0, 9, ist(2026, 1, 4, 12)) == ist(2026, 1, 5, 9)
    assert compute_next_run("weekly", 0, 9, ist(2026, 1, 5, 9)) == ist(2026, 1, 12, 9)
    assert compute_next_run("weekly", 6, 9, ist(2026, 1, 5, 9)) == ist(2026, 1, 11, 9)
    assert compute_next_run("monthly", 15, 9, ist(2026, 1, 10)) == ist(2026, 1, 15, 9)
    assert compute_next_run("monthly", 15, 9, ist(2026, 1, 20)) == ist(2026, 2, 15, 9)
    assert compute_next_run("monthly", 1, 9, ist(2026, 12, 20)) == ist(2027, 1, 1, 9)
    assert compute_next_run("monthly", 28, 23, ist(2026, 2, 1)) == ist(2026, 2, 28, 23)
    with pytest.raises(ValueError):
        compute_next_run("daily", 1, 9, ist(2026, 1, 1))


def test_render_text_placeholders_are_plain_substitution():
    out = render_text("{client} pack {month} {year} {0} {__class__}", ist(2026, 3, 2), "TATA")
    assert out == "TATA pack March 2026 {0} {__class__}"


PACK = {"name": "Monthly social pack", "description": "4 posts", "items": [
    {"title": "{client} {month} post 1", "brief": "First post for {month}", "design_type_id": 1, "tags": ["Social"], "estimate_hours": 3},
    {"title": "{client} {month} post 2", "brief": "Second post", "design_type_id": 1, "priority": "High"},
]}


def test_template_crud_and_permissions(client):
    lead, des = auth(client, "lead@x.com"), auth(client, "des@x.com")
    assert client.post("/api/templates", json=PACK, headers=des).status_code == 403
    r = client.post("/api/templates", json=PACK, headers=lead)
    assert r.status_code == 201 and len(r.json()["items"]) == 2
    tid = r.json()["id"]
    assert [t["name"] for t in client.get("/api/templates", headers=des).json()] == ["Monthly social pack"]
    assert client.get("/api/templates", headers=auth(client, "a@tata.com")).status_code == 403
    bad = {**PACK, "items": [{**PACK["items"][0], "design_type_id": 999}]}
    assert client.post("/api/templates", json=bad, headers=lead).status_code == 422
    assert client.post("/api/templates", json={**PACK, "items": []}, headers=lead).status_code == 422
    assert client.delete(f"/api/templates/{tid}", headers=lead).status_code == 204
    assert client.get("/api/templates", headers=lead).json() == []


def test_instantiate_bundle_creates_all_tickets_for_the_client(client):
    lead = auth(client, "lead@x.com")
    tid = client.post("/api/templates", json=PACK, headers=lead).json()["id"]
    r = client.post(f"/api/templates/{tid}/instantiate", json={"requester_id": 3, "assignee_id": 2}, headers=lead)
    assert r.status_code == 201
    created = r.json()["created"]
    assert len(created) == 2 and len({c["ticket_number"] for c in created}) == 2
    tickets = client.get("/api/tickets", headers=auth(client, "a@tata.com")).json()  # visible to the TATA client
    assert sorted(t["title"].split(" ")[0] for t in tickets) == ["TATA", "TATA"]
    assert all(t["assignee_id"] == 2 and t["due_at"] for t in tickets)
    assert client.get("/api/tickets", headers=auth(client, "b@acme.com")).json() == []
    assert client.post(f"/api/templates/{tid}/instantiate", json={"assignee_id": 2}, headers=auth(client, "des@x.com")).status_code == 403
    assert client.post(f"/api/templates/{tid}/instantiate", json={"requester_id": 999}, headers=lead).status_code == 422


def test_recurring_rule_validation(client):
    lead = auth(client, "lead@x.com")
    tid = client.post("/api/templates", json=PACK, headers=lead).json()["id"]
    rule = {"name": "Monthly", "template_id": tid, "frequency": "monthly", "day": 1, "hour": 9, "requester_id": 3}
    assert client.post("/api/recurring", json={**rule, "day": 31}, headers=lead).status_code == 422
    assert client.post("/api/recurring", json={**rule, "frequency": "weekly", "day": 7}, headers=lead).status_code == 422
    assert client.post("/api/recurring", json={**rule, "template_id": 999}, headers=lead).status_code == 404
    assert client.post("/api/recurring", json={**rule, "requester_id": 999}, headers=lead).status_code == 422
    assert client.post("/api/recurring", json=rule, headers=auth(client, "des@x.com")).status_code == 403
    r = client.post("/api/recurring", json=rule, headers=lead)
    assert r.status_code == 201 and r.json()["template_name"] == "Monthly social pack"
    assert datetime.datetime.fromisoformat(r.json()["next_run_at"]) > datetime.datetime.now(pytz.utc)


def test_due_rules_fire_once_and_reschedule(client):
    lead = auth(client, "lead@x.com")
    tid = client.post("/api/templates", json=PACK, headers=lead).json()["id"]
    rid = client.post("/api/recurring", json={"name": "Monthly", "template_id": tid, "frequency": "monthly", "day": 1, "hour": 9,
                                              "requester_id": 3, "assignee_id": 2}, headers=lead).json()["id"]
    db = TestingSessionLocal()
    now = datetime.datetime.now(pytz.utc)
    db.query(models.RecurringRule).filter_by(id=rid).update({"next_run_at": now - datetime.timedelta(days=45)})
    db.commit()
    assert run_due_rules(db, now) == 2                      # missed 45 days: one catch-up run, not a backlog
    assert run_due_rules(db, now) == 0                      # idempotent
    rule = db.query(models.RecurringRule).filter_by(id=rid).first()
    assert rule.next_run_at.replace(tzinfo=pytz.utc) > now and rule.last_run_at is not None
    assert db.query(models.Ticket).count() == 2
    audit = db.query(models.AuditLog).filter(models.AuditLog.action.like("Created from recurring%")).first()
    assert audit.actor_label == "Recurring schedule"
    db.close()


def test_inactive_rule_and_deleted_template_do_not_fire(client):
    lead = auth(client, "lead@x.com")
    tid = client.post("/api/templates", json=PACK, headers=lead).json()["id"]
    rid = client.post("/api/recurring", json={"name": "M", "template_id": tid, "frequency": "weekly", "day": 0, "hour": 9,
                                              "requester_id": 3}, headers=lead).json()["id"]
    db = TestingSessionLocal()
    past = datetime.datetime.now(pytz.utc) - datetime.timedelta(days=1)
    db.query(models.RecurringRule).filter_by(id=rid).update({"next_run_at": past, "is_active": False})
    db.commit()
    assert run_due_rules(db) == 0
    db.query(models.RecurringRule).filter_by(id=rid).update({"is_active": True})
    db.commit()
    client.delete(f"/api/templates/{tid}", headers=lead)  # soft-deletes the template and disables its rules
    assert run_due_rules(db) == 0 and db.query(models.Ticket).count() == 0
    db.close()


def test_run_now_does_not_touch_schedule(client):
    lead = auth(client, "lead@x.com")
    tid = client.post("/api/templates", json=PACK, headers=lead).json()["id"]
    rule = client.post("/api/recurring", json={"name": "M", "template_id": tid, "frequency": "weekly", "day": 0, "hour": 9, "requester_id": 3}, headers=lead).json()
    r = client.post(f"/api/recurring/{rule['id']}/run-now", headers=lead)
    assert r.status_code == 200 and len(r.json()["created"]) == 2
    assert client.get("/api/recurring", headers=lead).json()[0]["next_run_at"] == rule["next_run_at"]


# ── Time tracking ────────────────────────────────────────────────────────────

class Clock:
    def __init__(self, start): self.now = start
    def __call__(self): return self.now
    def advance(self, **kw): self.now += datetime.timedelta(**kw)


@pytest.fixture
def clock(monkeypatch):
    c = Clock(datetime.datetime(2026, 1, 5, 4, 0, tzinfo=pytz.utc))
    monkeypatch.setattr(timetracking, "_now", c)
    return c


def test_timer_creates_entry_and_updates_ticket(client, clock):
    t = make_ticket(client, "a@tata.com")["id"]
    des = auth(client, "des@x.com")
    assert client.post(f"/api/tickets/{t}/timer/start", headers=des).status_code == 200
    assert client.post(f"/api/tickets/{t}/timer/start", headers=des).status_code == 400
    clock.advance(minutes=90)
    r = client.post(f"/api/tickets/{t}/timer/stop", headers=des)
    assert r.json()["time_spent_seconds"] == 5400
    entries = client.get(f"/api/tickets/{t}/time", headers=des).json()
    assert len(entries) == 1 and entries[0]["seconds"] == 5400 and entries[0]["user_name"] == "Designer" and entries[0]["source"] == "timer"
    assert client.post(f"/api/tickets/{t}/timer/stop", headers=des).status_code == 400


def test_starting_a_second_timer_stops_the_first(client, clock):
    a, b = make_ticket(client, "a@tata.com")["id"], make_ticket(client, "a@tata.com")["id"]
    des = auth(client, "des@x.com")
    client.post(f"/api/tickets/{a}/timer/start", headers=des)
    clock.advance(minutes=30)
    r = client.post(f"/api/tickets/{b}/timer/start", headers=des)
    assert r.json()["stopped_ticket_id"] == a
    tk = {t["id"]: t for t in client.get("/api/tickets", headers=des).json()}
    assert tk[a]["time_spent_seconds"] == 1800 and tk[a]["timer_started_at"] is None and tk[b]["timer_started_at"]


def test_only_timer_owner_or_lead_can_stop(client, clock):
    t = make_ticket(client, "a@tata.com")["id"]
    db = TestingSessionLocal()
    db.add(models.User(email="d2@x.com", full_name="D2", role=models.RoleEnum.DESIGNER, hashed_password="x"))
    db.commit()
    db.close()
    client.post(f"/api/tickets/{t}/timer/start", headers=auth(client, "des@x.com"))
    clock.advance(minutes=10)
    assert client.post(f"/api/tickets/{t}/timer/stop", headers=auth(client, "lead@x.com")).status_code == 200


def test_manual_time_entry_rules(client, clock):
    t = make_ticket(client, "a@tata.com")["id"]
    des, lead = auth(client, "des@x.com"), auth(client, "lead@x.com")
    r = client.post(f"/api/tickets/{t}/time", json={"seconds": 7200, "note": "Concepts"}, headers=des)
    assert r.status_code == 201 and r.json()["source"] == "manual" and r.json()["seconds"] == 7200
    assert client.post(f"/api/tickets/{t}/time", json={"seconds": 30}, headers=des).status_code == 422          # under a minute
    assert client.post(f"/api/tickets/{t}/time", json={"seconds": 99999}, headers=des).status_code == 422       # over 16h
    future = (clock.now + datetime.timedelta(hours=2)).isoformat()
    assert client.post(f"/api/tickets/{t}/time", json={"seconds": 600, "started_at": future}, headers=des).status_code == 422
    assert client.post(f"/api/tickets/{t}/time", json={"seconds": 600, "user_id": 1}, headers=des).status_code == 403
    r = client.post(f"/api/tickets/{t}/time", json={"seconds": 3600, "user_id": 2}, headers=lead)
    assert r.status_code == 201 and r.json()["user_name"] == "Designer"
    assert client.post(f"/api/tickets/{t}/time", json={"seconds": 600, "user_id": 3}, headers=lead).status_code == 422  # clients don't log time
    assert client.post(f"/api/tickets/{t}/time", json={"seconds": 600}, headers=auth(client, "a@tata.com")).status_code == 403
    total = [x for x in client.get("/api/tickets", headers=des).json() if x["id"] == t][0]["time_spent_seconds"]
    assert total == 10800


def test_delete_time_entry_adjusts_total_and_enforces_ownership(client, clock):
    t = make_ticket(client, "a@tata.com")["id"]
    des, lead = auth(client, "des@x.com"), auth(client, "lead@x.com")
    e = client.post(f"/api/tickets/{t}/time", json={"seconds": 3600}, headers=des).json()
    client.post(f"/api/tickets/{t}/time", json={"seconds": 1800}, headers=lead)
    other = client.get(f"/api/tickets/{t}/time", headers=lead).json()
    lead_entry = [x for x in other if x["user_name"] == "Lead"][0]
    assert client.delete(f"/api/time/{lead_entry['id']}", headers=des).status_code == 403
    assert client.delete(f"/api/time/{e['id']}", headers=des).status_code == 204
    assert [x for x in client.get("/api/tickets", headers=des).json() if x["id"] == t][0]["time_spent_seconds"] == 1800
    client.post(f"/api/tickets/{t}/timer/start", headers=des)
    running = [x for x in client.get(f"/api/tickets/{t}/time", headers=des).json() if x["ended_at"] is None][0]
    assert client.delete(f"/api/time/{running['id']}", headers=des).status_code == 409


def test_timesheet_export_is_lead_only_and_formula_safe(client, clock):
    t = make_ticket(client, "a@tata.com", "=HYPERLINK(\"http://evil\")")["id"]
    client.post(f"/api/tickets/{t}/time", json={"seconds": 5400, "note": "+cmd"}, headers=auth(client, "des@x.com"))
    assert client.get("/api/timesheets/export", headers=auth(client, "des@x.com")).status_code == 403
    r = client.get("/api/timesheets/export", headers=auth(client, "lead@x.com"))
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    lines = r.text.strip().splitlines()
    assert lines[0].startswith("Date (IST),Ticket") and "'=HYPERLINK" in lines[1] and "1.5" in lines[1] and "'+cmd" in lines[1]


# ── Workload / forecasting ───────────────────────────────────────────────────

def seed_load(estimate, due, assignee=2, status=models.TicketStatus.IN_PROGRESS, logged=0):
    db = TestingSessionLocal()
    t = models.Ticket(ticket_number=f"DF-{db.query(models.Ticket).count() + 1:04d}", title="Work", brief="b", design_type_id=1,
                      type_specific_fields={}, requester_id=3, assignee_id=assignee, status=status, estimate_hours=estimate,
                      due_at=due, time_spent_seconds=logged)
    db.add(t)
    db.commit()
    db.close()


MONDAY = datetime.date(2026, 1, 5)


def workload(days=7):
    db = TestingSessionLocal()
    try:
        return timetracking.compute_workload(db, days, today=MONDAY)
    finally:
        db.close()


def designer(data, name="Designer"):
    return [d for d in data["designers"] if d["designer_name"] == name][0]


def test_workload_flags_overload_when_effort_exceeds_capacity_by_deadline(client):
    seed_load(20, ist(2026, 1, 6, 18))                       # 20h due Tuesday; only 16h available Mon+Tue
    d = designer(workload())
    assert d["is_overloaded"] and d["overload_date"] == "2026-01-06"
    assert d["capacity_hours"] == 40 and d["planned_hours"] == 20 and d["utilization_pct"] == 50   # weekends excluded


def test_workload_not_overloaded_when_work_fits(client):
    seed_load(12, ist(2026, 1, 6, 18))
    d = designer(workload())
    assert not d["is_overloaded"] and d["overload_date"] is None


def test_logged_time_reduces_remaining_effort(client):
    seed_load(20, ist(2026, 1, 6, 18), logged=6 * 3600)
    d = designer(workload())
    assert d["planned_hours"] == 14 and not d["is_overloaded"]


def test_leave_and_holidays_reduce_capacity(client):
    db = TestingSessionLocal()
    db.add(models.UserLeave(user_id=2, start_date=datetime.datetime(2026, 1, 7), end_date=datetime.datetime(2026, 1, 8)))
    db.add(models.Holiday(date=datetime.datetime(2026, 1, 9), name="Holiday"))
    db.commit()
    db.close()
    d = designer(workload())
    assert d["capacity_hours"] == 16     # Mon+Tue only: Wed/Thu on leave, Fri holiday, weekend off


def test_overdue_and_undated_work_are_placed_sensibly(client):
    seed_load(10, ist(2025, 12, 1))     # overdue -> due "now" (Monday: 8h available)
    d = designer(workload())
    assert d["is_overloaded"] and d["overload_date"] == "2026-01-05"
    seed_load(6, None, assignee=1)      # undated work lands at the end of the window, so it never trips early
    assert not designer(workload(), "Lead")["is_overloaded"]


def test_unassigned_and_finished_work(client):
    seed_load(5, ist(2026, 1, 6), assignee=None)
    seed_load(50, ist(2026, 1, 6), status=models.TicketStatus.DELIVERED)
    seed_load(50, ist(2026, 1, 6), status=models.TicketStatus.WAITING_ON_REQUESTER)
    data = workload()
    assert data["unassigned_hours"] == 5 and data["unassigned_tickets"] == 1 and designer(data)["planned_hours"] == 0


def test_forecasting_endpoint_uses_real_data_with_widget_shape(client):
    seed_load(200, datetime.datetime.now(pytz.utc) + datetime.timedelta(days=1))
    r = client.get("/api/forecasting/capacity", headers=auth(client, "lead@x.com"))
    assert r.status_code == 200
    row = [f for f in r.json()["forecast"] if f["designer_name"] == "Designer"][0]
    assert set(row) >= {"designer_id", "designer_name", "daily_capacity_hours", "is_overloaded_next_7_days", "overload_date", "projected_capacity_percentage"}
    assert row["is_overloaded_next_7_days"] is True and row["projected_capacity_percentage"] > 100
    assert client.get("/api/forecasting/capacity", headers=auth(client, "a@tata.com")).status_code == 403
    assert client.get("/api/workload", params={"days": 99}, headers=auth(client, "lead@x.com")).status_code == 422
