"""Forgot password: emailed single-use reset link, no account discovery, reset links are not sessions."""
import re

import pytest

import delivery
from test_auth import client, login  # noqa: F401  (shared fixture)


@pytest.fixture
def outbox(monkeypatch):
    sent = []
    monkeypatch.setenv("SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("PUBLIC_APP_URL", "https://app.example.com")
    monkeypatch.setattr(delivery, "run_in_background", lambda fn, *args: fn(*args))
    monkeypatch.setattr(delivery, "send_email", lambda to, subject, body: sent.append((to, body)) or (True, "Sent"))
    return sent


def reset_token(body):
    return re.search(r"https://app\.example\.com/reset-password\?token=(\S+)", body).group(1)


def test_reset_flow_is_single_use(client, outbox):
    r = client.post("/api/auth/forgot-password", json={"email": " Lead@X.com "})
    assert r.status_code == 200
    assert [to for to, _ in outbox] == ["lead@x.com"]
    token = reset_token(outbox[0][1])

    old_session = login(client, "lead@x.com").json()["access_token"]
    r = client.post("/api/auth/reset-password", json={"token": token, "new_password": "brand-new-pw"})
    assert r.status_code == 200, r.text
    assert login(client, "lead@x.com", "brand-new-pw").status_code == 200
    assert login(client, "lead@x.com").status_code == 401
    # The old token no longer identifies as lead@x.com; with no login it falls back to the shared staff identity.
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {old_session}"}).status_code == 200

    again = client.post("/api/auth/reset-password", json={"token": token, "new_password": "another-pw-1"})
    assert again.status_code == 400


def test_same_answer_for_unknown_or_inactive_accounts(client, outbox):
    known = client.post("/api/auth/forgot-password", json={"email": "des@x.com"}).json()
    unknown = client.post("/api/auth/forgot-password", json={"email": "nobody@x.com"}).json()
    inactive = client.post("/api/auth/forgot-password", json={"email": "off@x.com"}).json()
    assert known == unknown == inactive
    assert [to for to, _ in outbox] == ["des@x.com"]


def test_reset_token_is_not_a_session(client, outbox):
    client.post("/api/auth/forgot-password", json={"email": "lead@x.com"})
    token = reset_token(outbox[0][1])
    # A reset token is still rejected as a session (auth._user_from_token checks payload["purpose"]); with no
    # login that rejection now falls back to the shared staff identity instead of failing outright.
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 200


def test_session_token_cannot_reset(client, outbox):
    session = login(client, "lead@x.com").json()["access_token"]
    r = client.post("/api/auth/reset-password", json={"token": session, "new_password": "brand-new-pw"})
    assert r.status_code == 400


def test_rate_limited_per_email(client, outbox):
    codes = [client.post("/api/auth/forgot-password", json={"email": "lead@x.com"}).status_code for _ in range(4)]
    assert codes == [200, 200, 200, 429]


def test_without_email_setup_says_so(client, monkeypatch):
    monkeypatch.delenv("SMTP_HOST", raising=False)
    r = client.post("/api/auth/forgot-password", json={"email": "lead@x.com"})
    assert r.status_code == 503


def test_links_use_the_vercel_domain_when_public_app_url_is_unset(monkeypatch):
    import common
    from tracking import tracking_url
    monkeypatch.delenv("PUBLIC_APP_URL", raising=False)
    monkeypatch.setenv("VERCEL_PROJECT_PRODUCTION_URL", "design-team.example.vercel.app")
    assert common.app_url() == "https://design-team.example.vercel.app"
    assert tracking_url("DF-0004").startswith("https://design-team.example.vercel.app/track/DF-0004.")
    monkeypatch.setenv("PUBLIC_APP_URL", "https://studio.mccia.in/")
    assert common.app_url() == "https://studio.mccia.in"
