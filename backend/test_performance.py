"""Guards against slow pages: the ticket list must not run a query per ticket, and big responses are compressed."""
import models
from sqlalchemy import event

from test_auth import TestingSessionLocal, auth, client, engine, make_ticket  # noqa: F401


def count_queries(fn):
    seen = []

    def listener(conn, cursor, statement, params, context, executemany):
        seen.append(statement)

    event.listen(engine, "before_cursor_execute", listener)
    try:
        result = fn()
    finally:
        event.remove(engine, "before_cursor_execute", listener)
    return result, len(seen)


def add_tickets(n):
    db = TestingSessionLocal()
    start = db.query(models.Ticket).count()          # keep ticket numbers unique across calls
    for i in range(start, start + n):
        t = models.Ticket(ticket_number=f"DF-9{i:04d}", title=f"T{i}", brief="b", design_type_id=1, type_specific_fields={},
                          requester_id=3, client_org="TATA", assignee_id=2, tags=["a"])
        db.add(t)
        db.flush()
        for k in range(3):
            db.add(models.Subtask(ticket_id=t.id, title=f"s{k}"))
    db.commit()
    db.close()


def test_the_ticket_list_costs_the_same_number_of_queries_however_many_tickets_there_are(client):
    headers = auth(client, "lead@x.com")
    add_tickets(3)
    few, q_few = count_queries(lambda: client.get("/api/tickets", headers=headers))
    add_tickets(60)
    many, q_many = count_queries(lambda: client.get("/api/tickets", headers=headers))
    assert few.status_code == many.status_code == 200
    assert len(few.json()) == 3 and len(many.json()) == 63
    assert q_many == q_few                      # 60 more tickets, not one more query
    assert q_many <= 10
    assert all(len(t["subtasks"]) == 3 for t in many.json())   # eager loading still returns the subtasks


def test_clients_get_the_same_cheap_list(client):
    add_tickets(40)
    r, queries = count_queries(lambda: client.get("/api/tickets", headers=auth(client, "a@tata.com")))
    assert r.status_code == 200 and len(r.json()) == 40 and queries <= 10


def test_large_json_is_compressed_but_downloads_are_not(client):
    add_tickets(40)
    headers = auth(client, "lead@x.com")
    r = client.get("/api/tickets", headers=headers)
    assert r.headers.get("content-encoding") == "gzip" and len(r.json()) == 40

    t = make_ticket(client, "a@tata.com")
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 4096
    up = client.post(f"/api/tickets/{t['id']}/proofs", files={"file": ("p.png", png, "image/png")}, data={"send_for_approval": "false"}, headers=headers)
    file = client.get(f"/api/proofs/{up.json()['id']}/file", headers=headers)
    assert file.status_code == 200 and "content-encoding" not in file.headers and file.content == png
