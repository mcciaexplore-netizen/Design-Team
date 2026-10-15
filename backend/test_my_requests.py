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


def link_token(body):
    return re.search(r"https://app\.example\.com/my-requests\?token=(\S+)", body).group(1)


def submit(client, email, event):
    data = form(email=email, event_name=event)
    data["design_requirement"] = ["Flyer (Email / Print)", "Instagram post"]
    data["details"] = json.dumps({"Flyer (Email / Print)": {"size": "A4", "channel": "Print"}, "Instagram post": {"format": "Carousel"}})
    r = client.post("/api/public/requests", data=data)
    assert r.status_code == 201, r.text
    return [t["ticket_number"] for t in r.json()["tickets"]]


def test_confirmation_email_links_to_all_requests_and_shows_only_that_persons(client, outbox):
    mine = submit(client, "meera@example.com", "Expo") + submit(client, "Meera@Example.com", "Open Day")
    clear_hits()
    theirs = submit(client, "someone.else@example.com", "Other event")
    token = link_token(outbox[0][2])

    r = client.get("/api/public/my-requests", params={"token": token})
    assert r.status_code == 200, r.text
    numbers = [x["ticket_number"] for x in r.json()["requests"]]
    assert sorted(numbers) == sorted(mine) and not set(numbers) & set(theirs)
    first = r.json()["requests"][0]
    assert first["tracking_url"].startswith("https://app.example.com/track/") and first["status"] in ("New", "Assigned")


def test_asking_for_the_link_by_email_gives_the_same_answer_for_anyone(client, outbox):
    submit(client, "meera@example.com", "Expo")
    outbox.clear()
    known = client.post("/api/public/my-requests/link", json={"email": " MEERA@example.com "})
    unknown = client.post("/api/public/my-requests/link", json={"email": "nobody@example.com"})
    assert known.status_code == unknown.status_code == 200 and known.json() == unknown.json()
    assert [to for to, _, _ in outbox] == ["meera@example.com"]
    assert client.get("/api/public/my-requests", params={"token": link_token(outbox[0][2])}).status_code == 200


def test_bad_or_wrong_purpose_tokens_are_refused(client, outbox):
    assert client.get("/api/public/my-requests", params={"token": "nonsense"}).status_code == 404
    session = login(client, "a@tata.com").json()["access_token"]
    assert client.get("/api/public/my-requests", params={"token": session}).status_code == 404
    submit(client, "meera@example.com", "Expo")
    token = link_token(outbox[0][2])
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401   # not a session


def test_link_requests_are_rate_limited_and_need_email_set_up(client, outbox, monkeypatch):
    codes = [client.post("/api/public/my-requests/link", json={"email": "x@example.com"}).status_code for _ in range(4)]
    assert codes == [200, 200, 200, 429]
    monkeypatch.delenv("SMTP_HOST")
    assert client.post("/api/public/my-requests/link", json={"email": "y@example.com"}).status_code == 503
