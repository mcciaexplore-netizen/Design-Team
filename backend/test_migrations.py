import os
import subprocess
import sys
import tempfile

import pytest

from database import _normalise

BACKEND = os.path.dirname(os.path.abspath(__file__))


def alembic(*args, db_url):
    env = {**os.environ, "DATABASE_URL": db_url}
    return subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BACKEND, env=env, capture_output=True, text=True, timeout=120)


@pytest.fixture
def sqlite_url():
    fd, path = tempfile.mkstemp(suffix=".db", prefix="dd-mig-")
    os.close(fd)
    yield "sqlite:///" + path.replace("\\", "/")
    try:
        os.remove(path)
    except OSError:
        pass


def test_migrations_apply_and_match_models(sqlite_url):
    up = alembic("upgrade", "head", db_url=sqlite_url)
    assert up.returncode == 0, up.stderr
    # `check` fails if a model change has no migration, so forgetting to generate one fails CI.
    check = alembic("check", db_url=sqlite_url)
    assert check.returncode == 0, check.stdout + check.stderr


def test_migrations_roll_back_and_forward(sqlite_url):
    assert alembic("upgrade", "head", db_url=sqlite_url).returncode == 0
    assert alembic("downgrade", "base", db_url=sqlite_url).returncode == 0
    assert alembic("upgrade", "head", db_url=sqlite_url).returncode == 0


def test_postgres_ddl_generates_without_a_server():
    r = alembic("upgrade", "head", "--sql", db_url="postgres://user:p%40ss@db.example.com:5432/designdesk")
    assert r.returncode == 0, r.stderr
    assert "CREATE TYPE roleenum AS ENUM" in r.stdout and "CREATE TABLE approval_requests" in r.stdout


@pytest.mark.parametrize("given,expected", [
    ("postgres://u:p@h:5432/d", "postgresql+psycopg://u:p@h:5432/d"),
    ("postgresql://u:p@h/d", "postgresql+psycopg://u:p@h/d"),
    ("postgresql+psycopg://u:p@h/d", "postgresql+psycopg://u:p@h/d"),
    ("sqlite:///./x.db", "sqlite:///./x.db"),
])
def test_database_url_normalisation(given, expected):
    assert _normalise(given) == expected
