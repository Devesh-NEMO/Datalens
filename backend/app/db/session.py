"""SQLAlchemy engine/session plumbing with explicit, honest degradation.

Persistence is optional by design. The analysis engine works entirely in memory and
never depends on a database being reachable; when the database is missing or down
the API keeps serving analyses and reports *which* capability is unavailable
instead of returning a 500.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import Engine, create_engine, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings
from app.db.models import Base

logger = logging.getLogger("data_analyzer.db")

_engine: Engine | None = None
_SessionFactory: sessionmaker[Session] | None = None
#: Why the database is unusable, or None when it is fine. Surfaced by /v1/health.
_unavailable_reason: str | None = None
_probed = False


def _build_engine() -> Engine:
    url = settings.effective_database_url
    if not url:
        raise SQLAlchemyError("Persistence is disabled (DATABASE_ENABLED=false).")

    if url.startswith("sqlite"):
        # SQLite needs the directory to exist before it can create the file.
        db_path = url.removeprefix("sqlite:///")
        if db_path and db_path != ":memory:":
            from pathlib import Path

            Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        return create_engine(
            url,
            echo=settings.database_echo,
            future=True,
            connect_args={"check_same_thread": False},
        )

    return create_engine(
        url,
        echo=settings.database_echo,
        future=True,
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=10,
    )


def get_engine() -> Engine:
    """Return the process-wide engine, creating it on first use."""
    global _engine, _SessionFactory
    if _engine is None:
        _engine = _build_engine()
        _SessionFactory = sessionmaker(bind=_engine, expire_on_commit=False, future=True)
    return _engine


def get_session_factory() -> sessionmaker[Session]:
    get_engine()
    assert _SessionFactory is not None  # noqa: S101 - set by get_engine
    return _SessionFactory


@contextmanager
def session_scope() -> Iterator[Session]:
    """A transactional session that always commits or rolls back and closes."""
    session = get_session_factory()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def probe() -> tuple[bool, str | None]:
    """Check the database once and cache the verdict.

    Returns ``(available, reason)``. The reason is a short, non-sensitive
    description safe to show a client; credentials are never included.
    """
    global _unavailable_reason, _probed

    if not settings.database_enabled:
        return False, "Persistence is disabled (DATABASE_ENABLED=false)."
    if not settings.effective_database_url:
        return False, "No DATABASE_URL configured."

    if _probed:
        return _unavailable_reason is None, _unavailable_reason

    try:
        engine = get_engine()
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        # A fresh database has no tables yet; create them so the first request
        # works without the operator having to run a migration first.
        Base.metadata.create_all(engine)
    except SQLAlchemyError as exc:
        # Only the exception class and a scrubbed fragment reach the client.
        detail = str(getattr(exc, "orig", exc)).split("\n")[0]
        logger.warning("Database unavailable: %s", detail)
        _unavailable_reason = f"Database unavailable: {type(exc).__name__}."
        _probed = True
        return False, _unavailable_reason

    _unavailable_reason = None
    _probed = True
    return True, None


def is_available() -> bool:
    """True when persistence is usable right now."""
    return probe()[0]


def unavailable_reason() -> str | None:
    """Why persistence is unusable, or None when it is usable."""
    return probe()[1]


def reset_state() -> None:
    """Drop cached engine/probe state. Used by tests and on reconfiguration."""
    global _engine, _SessionFactory, _unavailable_reason, _probed
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _SessionFactory = None
    _unavailable_reason = None
    _probed = False
