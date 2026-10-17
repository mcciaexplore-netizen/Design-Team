"""Settings shows how email and file storage are set up, and a Design Lead can send themselves a test email."""
import delivery
from test_auth import auth, client  # noqa: F401  (shared fixture)


def test_settings_show_email_and_storage_and_the_test_email_goes_to_the_lead(client, monkeypatch):
    lead = auth(client, "lead@x.com")
    monkeypatch.delenv("SMTP_HOST", raising=False)
    off = client.get("/api/settings/integrations", headers=lead).json()
    assert off["email_configured"] is False and off["file_storage"]
    assert client.post("/api/integrations/email/test", headers=lead).status_code == 422

    sent = []
    monkeypatch.setenv("SMTP_HOST", "smtp.zoho.in")
    monkeypatch.setenv("SMTP_FROM", "design@mcciapune.com")
    monkeypatch.setattr(delivery, "send_email", lambda to, subject, body: sent.append(to) or (True, "Sent"))
    on = client.get("/api/settings/integrations", headers=lead).json()
    assert (on["email_configured"], on["email_from"], on["email_host"]) == (True, "design@mcciapune.com", "smtp.zoho.in")
    r = client.post("/api/integrations/email/test", headers=lead).json()
    assert r["ok"] is True and sent == ["lead@x.com"]
    assert client.post("/api/integrations/email/test", headers=auth(client, "des@x.com")).status_code == 403
