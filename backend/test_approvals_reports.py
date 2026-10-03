import datetime
import hashlib
import shutil
import tempfile

import pytest
import pytz

import approvals
import delivery
import models
from test_auth import TestingSessionLocal, auth, client, make_ticket  # noqa: F401

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    path = tempfile.mkdtemp(prefix="dd-uploads-")
    monkeypatch.setenv("UPLOAD_DIR", path)
    monkeypatch.delenv("S3_ENDPOINT_URL", raising=False)
    monkeypatch.delenv("SMTP_HOST", raising=False)
    monkeypatch.setattr(delivery, "run_in_background", lambda fn, *a: fn(*a))
    approvals._attempts.clear()
    yield
    shutil.rmtree(path, ignore_errors=True)


def upload_proof(client, tid, email="des@x.com", data=PNG, name="v.png", note=None):
    return client.post(f"/api/tickets/{tid}/proofs", files={"file": (name, data, "image/png")},
                       data={"note": note} if note else {}, headers=auth(client, email))


def setup_review(client, **body):
    t = make_ticket(client, "a@tata.com", "Brand banner")
    proof = upload_proof(client, t["id"]).json()
    r = client.post(f"/api/tickets/{t['id']}/approval-requests", json={"proof_version_id": proof["id"], **body}, headers=auth(client, "des@x.com"))
    assert r.status_code == 201, r.text
    return t, proof, r.json(), r.json()["review_url"].rsplit("/", 1)[1]


def decide(client, token, decision="approve", name="Rhea", comment=None):
    return client.post(f"/api/public/review/{token}/decision", json={"decision": decision, "name": name, "comment": comment})


def lead_notes():
    db = TestingSessionLocal()
    try:
        return [n.content for n in db.query(models.Notification).filter_by(user_id=1).all()]
    finally:
        db.close()


# ── Proof versions ───────────────────────────────────────────────────────────

def test_proof_versions_increment_and_are_scoped(client):
    t = make_ticket(client, "a@tata.com")
    assert upload_proof(client, t["id"]).json()["version"] == 1
    v2 = upload_proof(client, t["id"], note="Round 2").json()
    assert v2["version"] == 2 and v2["note"] == "Round 2"
    assert [p["version"] for p in client.get(f"/api/tickets/{t['id']}/proofs", headers=auth(client, "a@tata.com")).json()] == [2, 1]
    assert upload_proof(client, t["id"], email="a@tata.com").status_code == 403           # clients can't upload proofs
    assert client.get(f"/api/tickets/{t['id']}/proofs", headers=auth(client, "b@acme.com")).status_code == 404
    f = client.get(f"/api/proofs/{v2['id']}/file", headers=auth(client, "a@tata.com"))
    assert f.content == PNG and f.headers["x-content-type-options"] == "nosniff"
    assert client.get(f"/api/proofs/{v2['id']}/file", headers=auth(client, "b@acme.com")).status_code == 404
    assert upload_proof(client, t["id"], data=b"nope", name="x.exe").status_code == 415


# ── Approval requests ────────────────────────────────────────────────────────

def test_request_returns_link_once_and_stores_only_a_hash(client):
    t, proof, req, token = setup_review(client)
    assert len(token) >= 40 and req["status"] == "pending" and req["proof_version"] == 1
    db = TestingSessionLocal()
    row = db.query(models.ApprovalRequest).first()
    assert row.token_hash == hashlib.sha256(token.encode()).hexdigest() and token not in str(row.__dict__)
    db.close()
    listing = client.get(f"/api/tickets/{t['id']}/approval-requests", headers=auth(client, "a@tata.com")).json()
    assert len(listing) == 1 and "review_url" not in listing[0] and token not in str(listing)
    ticket = [x for x in client.get("/api/tickets", headers=auth(client, "lead@x.com")).json() if x["id"] == t["id"]][0]
    assert ticket["status"] == "In Review"


def test_request_validation_and_permissions(client):
    t = make_ticket(client, "a@tata.com")
    other = make_ticket(client, "b@acme.com")
    foreign = upload_proof(client, other["id"]).json()
    des = auth(client, "des@x.com")
    assert client.post(f"/api/tickets/{t['id']}/approval-requests", json={"proof_version_id": foreign["id"]}, headers=des).status_code == 422
    mine = upload_proof(client, t["id"]).json()
    assert client.post(f"/api/tickets/{t['id']}/approval-requests", json={"proof_version_id": mine["id"]}, headers=auth(client, "a@tata.com")).status_code == 403
    assert client.post(f"/api/tickets/{t['id']}/approval-requests", json={"proof_version_id": mine["id"], "ttl_hours": 0}, headers=des).status_code == 422
    assert client.post(f"/api/tickets/{t['id']}/approval-requests", json={"proof_version_id": mine["id"], "ttl_hours": 9999}, headers=des).status_code == 422


def test_new_request_supersedes_old_link(client):
    t, proof, _, old_token = setup_review(client)
    r = client.post(f"/api/tickets/{t['id']}/approval-requests", json={"proof_version_id": proof["id"]}, headers=auth(client, "des@x.com"))
    assert r.status_code == 201
    assert decide(client, old_token).status_code == 409
    assert client.get(f"/api/public/review/{old_token}").json()["status"] == "revoked"
    assert decide(client, r.json()["review_url"].rsplit("/", 1)[1]).status_code == 200


def test_staff_can_revoke(client):
    t, _, req, token = setup_review(client)
    assert client.post(f"/api/approval-requests/{req['id']}/revoke", headers=auth(client, "a@tata.com")).status_code == 403
    assert client.post(f"/api/approval-requests/{req['id']}/revoke", headers=auth(client, "des@x.com")).status_code == 200
    assert decide(client, token).status_code == 409
    assert client.post(f"/api/approval-requests/{req['id']}/revoke", headers=auth(client, "des@x.com")).status_code == 409
    assert client.get(f"/api/public/review/{token}/file").status_code == 410


# ── Public review ────────────────────────────────────────────────────────────

def test_public_review_needs_no_login_and_shows_only_what_the_reviewer_needs(client):
    t, _, _, token = setup_review(client)
    r = client.get(f"/api/public/review/{token}")
    assert r.status_code == 200
    body = r.json()
    assert body["ticket"]["title"] == "Brand banner" and body["proof"]["version"] == 1 and body["status"] == "pending"
    assert set(body["ticket"]) == {"ticket_number", "title", "brief"}  # nothing about assignees, org, time, internals
    assert client.get(f"/api/public/review/{token}/file").content == PNG
    assert client.get("/api/public/review/not-a-real-token").status_code == 404
    assert client.get("/api/public/review/not-a-real-token/file").status_code == 404
    assert decide(client, "x" * 43).status_code == 404


def test_approve_delivers_ticket_notifies_and_audits(client):
    t, _, _, token = setup_review(client)
    r = decide(client, token, "approve", name="Rhea Kapoor", comment="Love it")
    assert r.status_code == 200 and r.json()["status"] == "approved"
    ticket = [x for x in client.get("/api/tickets", headers=auth(client, "lead@x.com")).json() if x["id"] == t["id"]][0]
    assert ticket["status"] == "Delivered"
    trail = client.get(f"/api/tickets/{t['id']}/audit", headers=auth(client, "lead@x.com")).json()
    last = trail[-1]
    assert last["action"] == "Client approved" and last["actor"] == "Rhea Kapoor (via review link)" and last["details"]["comment"] == "Love it"
    assert any("Rhea Kapoor approved" in n for n in lead_notes())
    assert client.get(f"/api/public/review/{token}").json()["status"] == "approved"


def test_a_decision_is_final_even_on_double_submit(client):
    _, _, _, token = setup_review(client)
    assert decide(client, token, "approve").status_code == 200
    again = decide(client, token, "request_changes", comment="actually no")
    assert again.status_code == 409 and "already approved" in again.json()["detail"]


def test_request_changes_requires_comment_and_reopens_work(client):
    t, _, req, token = setup_review(client)
    assert decide(client, token, "request_changes").status_code == 422
    assert decide(client, token, "request_changes", comment="   ").status_code == 422
    assert client.get(f"/api/public/review/{token}").json()["status"] == "pending"   # failed attempts don't consume the link
    assert decide(client, token, "request_changes", comment="Make the logo bigger").status_code == 200
    ticket = [x for x in client.get("/api/tickets", headers=auth(client, "lead@x.com")).json() if x["id"] == t["id"]][0]
    assert ticket["status"] == "In Progress" and ticket["revision_count"] == 1
    listing = client.get(f"/api/tickets/{t['id']}/approval-requests", headers=auth(client, "des@x.com")).json()[0]
    assert listing["status"] == "changes_requested" and listing["decision_comment"] == "Make the logo bigger" and listing["decided_by_name"] == "Rhea"
    assert any("requested changes" in n for n in lead_notes())


def test_expired_link_cannot_be_used(client):
    t, _, req, token = setup_review(client)
    db = TestingSessionLocal()
    db.query(models.ApprovalRequest).update({"expires_at": datetime.datetime.now(pytz.utc) - datetime.timedelta(minutes=1)})
    db.commit()
    db.close()
    assert client.get(f"/api/public/review/{token}").json()["status"] == "expired"
    assert decide(client, token).status_code == 410
    assert client.get(f"/api/tickets/{t['id']}/approval-requests", headers=auth(client, "des@x.com")).json()[0]["status"] == "expired"


def test_decision_input_is_validated(client):
    _, _, _, token = setup_review(client)
    assert client.post(f"/api/public/review/{token}/decision", json={"decision": "maybe", "name": "x"}).status_code == 422
    assert client.post(f"/api/public/review/{token}/decision", json={"decision": "approve", "name": ""}).status_code == 422
    assert client.post(f"/api/public/review/{token}/decision", json={"decision": "approve", "name": "x" * 81}).status_code == 422


def test_public_endpoints_are_throttled(client):
    codes = [client.get("/api/public/review/guess-%d" % i).status_code for i in range(40)]
    assert codes[:30] == [404] * 30 and 429 in codes[30:]


# ── Portal decisions (signed-in clients) ─────────────────────────────────────

def test_signed_in_client_can_approve_from_portal(client):
    t, _, req, token = setup_review(client)
    other, staff, cl = auth(client, "b@acme.com"), auth(client, "des@x.com"), auth(client, "a@tata.com")
    assert client.post(f"/api/approval-requests/{req['id']}/decision", json={"decision": "approve"}, headers=staff).status_code == 403
    assert client.post(f"/api/approval-requests/{req['id']}/decision", json={"decision": "approve"}, headers=other).status_code == 404
    assert client.post(f"/api/approval-requests/{req['id']}/decision", json={"decision": "request_changes"}, headers=cl).status_code == 422
    r = client.post(f"/api/approval-requests/{req['id']}/decision", json={"decision": "approve", "comment": "Great"}, headers=cl)
    assert r.status_code == 200 and r.json()["status"] == "approved"
    trail = client.get(f"/api/tickets/{t['id']}/audit", headers=auth(client, "lead@x.com")).json()
    assert trail[-1]["actor"] == "Tata A (signed in)"
    assert decide(client, token).status_code == 409                       # the emailed link is now spent too
    assert client.post(f"/api/approval-requests/{req['id']}/decision", json={"decision": "approve"}, headers=cl).status_code == 409


# ── Audit trail ──────────────────────────────────────────────────────────────

def test_audit_trail_is_ordered_scoped_and_hides_internals_from_clients(client):
    t = make_ticket(client, "a@tata.com")
    lead, des, cl = auth(client, "lead@x.com"), auth(client, "des@x.com"), auth(client, "a@tata.com")
    client.patch(f"/api/tickets/{t['id']}", json={"status": "In Progress", "assignee_id": 2}, headers=lead)
    client.post(f"/api/tickets/{t['id']}/comments", json={"content": "hello"}, headers=des)
    client.post(f"/api/tickets/{t['id']}/time", json={"seconds": 600}, headers=des)
    staff_view = client.get(f"/api/tickets/{t['id']}/audit", headers=lead).json()
    assert [a["action"] for a in staff_view] == ["Created", "Updated", "Commented", "Logged time"]
    assert staff_view[1]["details"]["status"] == {"from": "New", "to": "In Progress"}
    client_view = client.get(f"/api/tickets/{t['id']}/audit", headers=cl).json()
    assert [a["action"] for a in client_view] == ["Created", "Updated", "Commented", "Logged time"]
    assert all(a["details"] == {} for a in client_view)
    assert client.get(f"/api/tickets/{t['id']}/audit", headers=auth(client, "b@acme.com")).status_code == 404
    assert client.get(f"/api/tickets/{t['id']}/audit").status_code == 401


# ── Reports ──────────────────────────────────────────────────────────────────

def add_ticket(db, number, org, created, due, delivered=None, rev=0, parent=None, status=None, category=None):
    t = models.Ticket(ticket_number=number, title=f"{org} {number}", brief="b", design_type_id=1, type_specific_fields={},
                      requester_id=3 if org == "TATA" else 4, client_org=org, created_at=created, updated_at=created, due_at=due,
                      delivered_at=delivered, revision_count=rev, parent_id=parent, revision_category=category,
                      status=status or (models.TicketStatus.DELIVERED if delivered else models.TicketStatus.IN_PROGRESS))
    db.add(t)
    db.flush()
    return t


@pytest.fixture
def report_data(client):
    now = datetime.datetime.now(pytz.utc)
    d = lambda days: now - datetime.timedelta(days=days)
    db = TestingSessionLocal()
    t1 = add_ticket(db, "R-1", "TATA", d(9), d(7), delivered=d(8), rev=1)             # on time
    t2 = add_ticket(db, "R-2", "TATA", d(9), d(7), delivered=d(6), rev=3, category="Scope Change")  # late
    add_ticket(db, "R-3", "ACME", d(9), d(2))                                         # open and overdue
    add_ticket(db, "R-4", "TATA", d(5), d(1), parent=t1.id, category="Missing Asset")  # a V2 child of R-1
    db.add(models.TimeEntry(ticket_id=t1.id, user_id=2, started_at=d(8), ended_at=d(8), seconds=7200, source="manual"))
    db.commit()
    db.close()


def test_summary_kpis_and_client_analytics(client, report_data):
    r = client.get("/api/reports/summary", headers=auth(client, "lead@x.com"))
    assert r.status_code == 200
    k = r.json()["kpis"]
    assert k["tickets_created"] == 4 and k["tickets_delivered"] == 2
    assert k["on_time_rate_pct"] == 50.0                      # one of two delivered tickets met its due date
    assert k["hours_logged"] == 2.0
    assert k["avg_revisions_per_ticket"] == 1.67              # (R-1: 1 + 1 child, R-2: 3, R-3: 0) / 3 originals
    clients = {c["client"]: c for c in r.json()["by_client"]}
    assert clients["TATA"]["revisions"] == 5 and clients["TATA"]["tickets"] == 3 and clients["TATA"]["tickets_with_3plus_revisions"] == 1
    assert clients["ACME"]["revisions"] == 0 and clients["ACME"]["on_time_rate_pct"] is None
    assert r.json()["by_client"][0]["client"] == "TATA"       # most revisions first
    assert {c["category"]: c["count"] for c in r.json()["revision_categories"]} == {"Scope Change": 1, "Missing Asset": 1}


def test_sla_trend_counts_late_and_overdue(client, report_data):
    trend = client.get("/api/reports/summary", headers=auth(client, "lead@x.com")).json()["sla_trend"]
    assert sum(w["on_time"] for w in trend) == 1 and sum(w["late"] for w in trend) == 1 and sum(w["overdue_open"] for w in trend) == 2  # R-3 and the open V2 child R-4
    assert sum(w["due"] for w in trend) == 4


def test_client_filter_and_range(client, report_data):
    lead = auth(client, "lead@x.com")
    acme = client.get("/api/reports/summary", params={"client_org": "ACME"}, headers=lead).json()
    assert acme["kpis"]["tickets_created"] == 1 and [c["client"] for c in acme["by_client"]] == ["ACME"]
    empty = client.get("/api/reports/summary", params={"from": "2020-01-01", "to": "2020-01-31"}, headers=lead).json()
    assert empty["kpis"]["tickets_created"] == 0 and empty["kpis"]["on_time_rate_pct"] is None and empty["sla_trend"] == []
    assert client.get("/api/reports/summary", params={"from": "2026-02-01", "to": "2026-01-01"}, headers=lead).status_code == 422
    assert client.get("/api/reports/summary", params={"from": "2020-01-01", "to": "2026-01-01"}, headers=lead).status_code == 422
    assert client.get("/api/reports/clients", headers=lead).json() == ["ACME", "TATA"]


def test_reports_are_lead_only(client, report_data):
    for h in (auth(client, "des@x.com"), auth(client, "a@tata.com")):
        for path in ("/api/reports/summary", "/api/reports/export.csv", "/api/reports/export.pdf", "/api/reports/clients"):
            assert client.get(path, headers=h).status_code == 403
    assert client.get("/api/reports/summary").status_code == 401


def test_csv_exports(client, report_data):
    lead = auth(client, "lead@x.com")
    tickets = client.get("/api/reports/export.csv", params={"report": "tickets"}, headers=lead)
    assert tickets.headers["content-type"].startswith("text/csv") and "attachment" in tickets.headers["content-disposition"]
    rows = tickets.text.strip().splitlines()
    assert rows[0].startswith("Ticket,Title,Client") and len(rows) == 5
    r1 = [r for r in rows if r.startswith("R-1")][0]
    assert ",yes," in r1 and r1.endswith(",2,2.0")            # on time, 2 revisions (1 + child), 2h logged
    assert ",no," in [r for r in rows if r.startswith("R-2")][0]
    clients = client.get("/api/reports/export.csv", params={"report": "clients"}, headers=lead).text.splitlines()
    assert clients[0].startswith("Client,Tickets,Revisions") and clients[1].startswith("TATA,3,5")
    assert client.get("/api/reports/export.csv", params={"report": "sla"}, headers=lead).text.startswith("Week starting")
    assert client.get("/api/reports/export.csv", params={"report": "bogus"}, headers=lead).status_code == 422


def test_csv_export_neutralises_formulas(client):
    now = datetime.datetime.now(pytz.utc)
    db = TestingSessionLocal()
    t = add_ticket(db, "R-9", "=cmd|' /C calc'!A0", now, now)
    t.title = "@SUM(1+1)"
    db.commit()
    db.close()
    text = client.get("/api/reports/export.csv", params={"report": "tickets"}, headers=auth(client, "lead@x.com")).text
    assert "'@SUM(1+1)" in text and "'=cmd" in text


def test_pdf_export_is_a_pdf_and_handles_markup_in_names(client):
    now = datetime.datetime.now(pytz.utc)
    db = TestingSessionLocal()
    add_ticket(db, "R-8", "<b>Evil</b> & Co", now, now)
    db.commit()
    db.close()
    r = client.get("/api/reports/export.pdf", headers=auth(client, "lead@x.com"))
    assert r.status_code == 200 and r.content.startswith(b"%PDF") and r.headers["content-type"] == "application/pdf"
