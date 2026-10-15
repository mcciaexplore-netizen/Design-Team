import os
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

def _normalise(url: str) -> str:
    """Hosting providers hand out postgres:// or postgresql:// URLs; this app uses the psycopg 3 driver."""
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


SQLALCHEMY_DATABASE_URL = _normalise(os.getenv("DATABASE_URL", "sqlite:///./designflow.db"))

_is_sqlite = SQLALCHEMY_DATABASE_URL.startswith("sqlite")
_serverless = bool(os.getenv("VERCEL"))

if _is_sqlite:
    _engine_args = {"connect_args": {"check_same_thread": False}}
elif _serverless:
    # Serverless instances come and go, so leave pooling to the database's pooler (e.g. Neon's -pooler host), which
    # cannot carry server-side prepared statements between transactions.
    _engine_args = {"poolclass": NullPool, "connect_args": {"prepare_threshold": None}}
else:
    _engine_args = {"pool_pre_ping": True}  # Free-tier Postgres drops idle connections

engine = create_engine(SQLALCHEMY_DATABASE_URL, **_engine_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
