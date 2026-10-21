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
    for k in ("ADMIN_EMAIL", "ADMIN_PASSWORD", "ADMIN_RESET_PASSWORD"):
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


def test_seed_has_design_types_and_admin_but_no_demo_data(db_path):
    run_seed(db_path, ADMIN_EMAIL="Boss@Example.com", ADMIN_PASSWORD="a-long-pass-1")
    assert query(db_path, "select count(*) from design_types")[0][0] >= 1
    assert query(db_path, "select count(*) from tickets")[0][0] == 0
    users = query(db_path, "select email, role, must_change_password from users")
    assert users == [("boss@example.com", "DESIGN_LEAD", 0)]


def test_existing_account_is_promoted_to_design_lead(db_path):
    run_seed(db_path)
    con = sqlite3.connect(db_path)
    con.execute("insert into users (email, full_name, hashed_password, role, daily_capacity_hours, is_active, must_change_password) "
                "values ('boss@example.com', 'Boss', 'x', 'REQUESTER', 8, 1, 0)")
    con.commit(); con.close()
    run_seed(db_path, ADMIN_EMAIL="boss@example.com")
    assert query(db_path, "select role from users where email='boss@example.com'") == [("DESIGN_LEAD",)]


def test_admin_password_reset_applies_once(db_path):
    run_seed(db_path, ADMIN_EMAIL="boss@example.com", ADMIN_PASSWORD="first-pass-123")
    before = query(db_path, "SELECT hashed_password FROM users WHERE email='boss@example.com'")[0][0]
    con = sqlite3.connect(db_path); con.execute("UPDATE users SET is_active=0"); con.commit(); con.close()

    out = run_seed(db_path, ADMIN_EMAIL="boss@example.com", ADMIN_RESET_PASSWORD="reset-pass-456")
    assert "Reset the password" in out
    reset_hash, active, must_change = query(
        db_path, "SELECT hashed_password, is_active, must_change_password FROM users WHERE email='boss@example.com'")[0]
    assert reset_hash != before and active == 1 and must_change == 1

    # The admin then picks a new password; restarting with the same variable must not undo that.
    con = sqlite3.connect(db_path); con.execute("UPDATE users SET hashed_password='chosen'"); con.commit(); con.close()
    out = run_seed(db_path, ADMIN_EMAIL="boss@example.com", ADMIN_RESET_PASSWORD="reset-pass-456")
    assert "Reset the password" not in out
    assert query(db_path, "SELECT hashed_password FROM users")[0][0] == "chosen"
