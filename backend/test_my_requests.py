"""'My requests' without signing in: an emailed link lists everything one person has asked for, and nothing else."""
import json
import re

import pytest

import delivery
from test_auth import client, login  # noqa: F401  (shared fixture)
from test_workflow_features import clear_hits, form, isolated  # noqa: F401


@pytest.fixture
def outbox(monkeypatch):
    sent = []
    monkeypatch.setenv("SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("PUBLIC_APP_URL", "https://app.example.com")
    monkeypatch.setattr(delivery, "send_email", lambda to, subject, body: sent.append((to, subject, body)) or (True, "Sent"))
    return sent


def to(outbox, email):
    """The emails sent to one address (the design team is emailed too)."""
    return [m for m in outbox if m[0] == email]


def link_token(body):
    return re.search(r"https://app\.example\.com/client/(\S+)", body).group(1)


def submit(client, email, event):
    data = form(email=email, event_name=event)
    data["design_requirement"] = ["Flyer (Email / Print)", "Instagram post"]
    data["details"] = json.dumps({"Flyer (Email / Print)": {"size": "A4", "channel": "Print"}, "Instagram post": {"format": "Carousel"}})
    r = client.post("/api/public/requests", data=data)
    assert r.status_code == 201, r.text
    return [t["ticket_number"] for t in r.json()["tickets"]]


def ask_for_link(client, outbox, email):
    outbox.clear()
    assert client.post("/api/public/client-link", json={"email": email}).status_code == 200
    return link_token(to(outbox, email)[0][2])


def test_confirmation_email_points_to_my_requests_without_a_sign_in_link(client, outbox):
    submit(client, "meera@example.com", "Expo")
    body = to(outbox, "meera@example.com")[0][2]
    assert "https://app.example.com/my-requests" in body and "/client/" not in body


def test_my_requests_link_shows_only_that_persons_requests(client, outbox):
    mine = submit(client, "meera@example.com", "Expo") + submit(client, "Meera@Example.com", "Open Day")
    clear_hits()
    theirs = submit(client, "someone.else@example.com", "Other event")
    token = ask_for_link(client, outbox, "meera@example.com")

    r = client.get("/api/public/my-requests", params={"token": token})
    assert r.status_code == 200, r.text
    numbers = [x["ticket_number"] for x in r.json()["requests"]]
    assert sorted(numbers) == sorted(mine) and not set(numbers) & set(theirs)
    first = r.json()["requests"][0]
    assert first["tracking_url"].startswith("https://app.example.com/track/") and first["status"] in ("Pending Review", "New", "Assigned")


def test_asking_for_the_link_by_email_gives_the_same_answer_for_anyone(client, outbox):
    submit(client, "meera@example.com", "Expo")
    outbox.clear()
    known = client.post("/api/public/client-link", json={"email": " MEERA@example.com "})
    unknown = client.post("/api/public/client-link", json={"email": "nobody@example.com"})
    assert known.status_code == unknown.status_code == 200 and known.json() == unknown.json()
    assert [to for to, _, _ in outbox] == ["meera@example.com"]
    assert client.get("/api/public/my-requests", params={"token": link_token(to(outbox, "meera@example.com")[0][2])}).status_code == 200


def test_bad_or_wrong_purpose_tokens_are_refused(client, outbox):
    assert client.get("/api/public/my-requests", params={"token": "nonsense"}).status_code == 404
    session = login(client, "a@tata.com").json()["access_token"]
    assert client.get("/api/public/my-requests", params={"token": session}).status_code == 404
    submit(client, "meera@example.com", "Expo")
    token = ask_for_link(client, outbox, "meera@example.com")
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401   # not a session


def test_a_link_expires_and_a_newer_one_replaces_it(client, outbox):
    import datetime
    import models
    from test_auth import TestingSessionLocal
    from tracking import _hash_token
    submit(client, "meera@example.com", "Expo")
    old = ask_for_link(client, outbox, "meera@example.com")
    new = ask_for_link(client, outbox, "meera@example.com")
    assert client.get("/api/public/my-requests", params={"token": old}).status_code == 404   # replaced
    assert client.get("/api/public/my-requests", params={"token": new}).status_code == 200

    db = TestingSessionLocal()
    try:
        assert not db.query(models.ClientLinkToken).filter(models.ClientLinkToken.token_hash == new).first()   # raw token never stored
        row = db.query(models.ClientLinkToken).filter(models.ClientLinkToken.token_hash == _hash_token(new)).one()
        row.expires_at = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=1)
        db.commit()
    finally:
        db.close()
    assert client.get("/api/public/my-requests", params={"token": new}).status_code == 404
    assert client.post("/api/public/client-link/exchange", json={"token": new}).status_code == 404


def test_link_requests_are_rate_limited_and_need_email_set_up(client, outbox, monkeypatch):
    codes = [client.post("/api/public/client-link", json={"email": "x@example.com"}).status_code for _ in range(4)]
    assert codes == [200, 200, 200, 429]
    monkeypatch.delenv("SMTP_HOST")
    assert client.post("/api/public/client-link", json={"email": "y@example.com"}).status_code == 503
