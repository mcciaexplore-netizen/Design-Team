"""Scheduled jobs run off ordinary traffic every few minutes, because Vercel's cron only runs once a day."""
import datetime

import pytest

import cron_jobs
import database
import models
from test_auth import TestingSessionLocal, client  # noqa: F401  (shared fixture)


@pytest.fixture
def runs(monkeypatch):
    calls = []
    monkeypatch.setattr(database, "SessionLocal", TestingSessionLocal)
    monkeypatch.setattr(cron_jobs, "run_all_cron_jobs", lambda db: calls.append(1))
    monkeypatch.setattr(cron_jobs, "_next_check", 0.0)
    monkeypatch.setenv("AUTO_TICK", "on")
    return calls


def test_a_request_runs_the_jobs_once_then_not_again_for_five_minutes(client, runs):
    client.get("/health")
    assert runs == [1]
    cron_jobs._next_check = 0.0          # another server instance: no local shortcut, the database says it just ran
    client.get("/health")
    assert runs == [1]

    db = TestingSessionLocal()           # five minutes later
    db.query(models.RateLimitHit).filter(models.RateLimitHit.key == cron_jobs.AUTO_TICK_KEY).update(
        {"created_at": datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=cron_jobs.AUTO_TICK_SECONDS + 1)})
    db.commit()
    db.close()
    cron_jobs._next_check = 0.0
    client.get("/health")
    assert runs == [1, 1]


def test_off_unless_enabled_and_a_failing_job_never_breaks_the_request(client, runs, monkeypatch):
    monkeypatch.setenv("AUTO_TICK", "off")
    client.get("/health")
    assert runs == []

    monkeypatch.setenv("AUTO_TICK", "on")
    monkeypatch.setattr(cron_jobs, "run_all_cron_jobs", lambda db: 1 / 0)
    assert client.get("/health").status_code == 200
