"""DesignDesk is for MCCIA only: addresses outside @mcciapune.com can't submit a request or be given an account."""
import pytest

from test_auth import auth, client, login  # noqa: F401  (shared fixture)
from test_workflow_features import clear_hits, form, isolated  # noqa: F401

OUTSIDER = "someone@gmail.com"
MCCIA = "Priya@MCCIAPune.com"


@pytest.fixture(autouse=True)
def mccia_only(monkeypatch):
    monkeypatch.delenv("ALLOWED_EMAIL_DOMAINS")   # the real default, not the suite's "*"


def test_only_mccia_addresses_can_submit_the_public_form(client):
    r = client.post("/api/public/requests", data=form(email=OUTSIDER))
    assert r.status_code == 403 and "@mcciapune.com" in r.json()["detail"]
    clear_hits()
    assert client.post("/api/public/requests", data=form(email=MCCIA)).status_code == 201


def test_staff_cannot_give_an_account_to_an_outside_address(client):
    lead = auth(client, "lead@x.com")
    r = client.post("/api/admin/users", headers=lead, json={"full_name": "Outsider", "email": OUTSIDER, "role": "Designer"})
    assert r.status_code == 403
    r = client.post("/api/admin/users", headers=lead, json={"full_name": "Priya", "email": MCCIA, "role": "Designer"})
    assert r.status_code == 201
    uid = r.json()["user"]["id"]
    assert client.patch(f"/api/admin/users/{uid}", headers=lead, json={"email": OUTSIDER}).status_code == 403


def test_existing_staff_accounts_still_sign_in_with_their_password(client):
    """The rule guards new ways in; it doesn't lock out staff accounts that already exist."""
    assert login(client, "des@x.com").status_code == 200


def test_more_domains_can_be_allowed_by_configuration(client, monkeypatch):
    monkeypatch.setenv("ALLOWED_EMAIL_DOMAINS", "mcciapune.com, @mccia.in")
    assert client.post("/api/public/requests", data=form(email="team@mccia.in")).status_code == 201
