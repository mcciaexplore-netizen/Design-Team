import os
import sqlite3
import subprocess
import sys
import tempfile

import pytest

BACKEND = os.path.dirname(os.path.abspath(__file__))


@pytest.fixture
def db_path():
    fd, path = tempfile.mkstemp(suffix=".db", prefix="dd-seed-")
    os.close(fd)
    yield path
    try:
        os.remove(path)
    except OSError:
        pass


def run_seed(path, **env):
    full = {**os.environ, "DATABASE_URL": "sqlite:///" + path.replace("\\", "/"), **env}
    for k in ("SEED_DEMO_DATA", "ADMIN_EMAIL", "ADMIN_PASSWORD"):
        if k not in env:
            full.pop(k, None)
    r = subprocess.run([sys.executable, "seed.py"], cwd=BACKEND, env=full, capture_output=True, text=True, timeout=180)
    assert r.returncode == 0, r.stderr
    return r.stdout


def query(path, sql):
    con = sqlite3.connect(path)
    try:
        return con.execute(sql).fetchall()
    finally:
        con.close()


def test_production_style_seed_has_design_types_and_admin_but_no_demo_data(db_path):
    run_seed(db_path, SEED_DEMO_DATA="false", ADMIN_EMAIL="Boss@Example.com", ADMIN_PASSWORD="a-long-pass-1")
    assert query(db_path, "select count(*) from design_types")[0][0] >= 1
    assert query(db_path, "select count(*) from tickets")[0][0] == 0
    users = query(db_path, "select email, role, must_change_password from users")
    assert users == [("boss@example.com", "DESIGN_LEAD", 0)]


def test_demo_seed_adds_accounts_and_is_idempotent(db_path):
    run_seed(db_path, SEED_DEMO_DATA="true", ADMIN_EMAIL="boss@example.com", ADMIN_PASSWORD="a-long-pass-1")
    first = query(db_path, "select email from users order by email")
    assert ("lead@mccia.in",) in first and ("boss@example.com",) in first
    assert query(db_path, "select count(*) from tickets")[0][0] == 2
    run_seed(db_path, SEED_DEMO_DATA="true", ADMIN_EMAIL="boss@example.com", ADMIN_PASSWORD="a-long-pass-1")
    assert query(db_path, "select email from users order by email") == first
    assert query(db_path, "select count(*) from tickets")[0][0] == 2


def test_existing_account_is_promoted_to_design_lead(db_path):
    run_seed(db_path, SEED_DEMO_DATA="false")
    con = sqlite3.connect(db_path)
    con.execute("insert into users (email, full_name, hashed_password, role, daily_capacity_hours, is_active, must_change_password) "
                "values ('boss@example.com', 'Boss', 'x', 'REQUESTER', 8, 1, 0)")
    con.commit(); con.close()
    run_seed(db_path, SEED_DEMO_DATA="false", ADMIN_EMAIL="boss@example.com")
    assert query(db_path, "select role from users where email='boss@example.com'") == [("DESIGN_LEAD",)]
