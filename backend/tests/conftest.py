"""Shared test fixtures.

Two things every suite needs and neither should build twice:

* **Sample data.** The repository's own `sample-data/*.csv`, used when present so
  tests exercise real-world files. Suites that need a specific shape build their
  own small frame instead — the sample files are for realism, not for precision.
* **An isolated database.** Tests that touch persistence get a fresh SQLite file
  per test and a reset module cache. Sharing the development database would make
  a passing test suite depend on whatever happened to be in `var/`.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import pandas as pd
import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SAMPLE_DIR = REPO_ROOT / "sample-data"

__all__ = [
    "fresh_database",
    "no_ai_key",
    "no_database",
    "settings_override",
    "tmp_database",
    "tmp_storage",
]


@pytest.fixture(scope="session")
def sample_dir() -> Path:
    """The repository's sample-data directory."""
    return SAMPLE_DIR


@pytest.fixture(scope="session")
def clean_csv() -> bytes:
    """sales_clean.csv, the well-formed sample."""
    path = SAMPLE_DIR / "sales_clean.csv"
    if not path.exists():
        pytest.skip("sample-data/sales_clean.csv does not exist.")
    return path.read_bytes()


@pytest.fixture(scope="session")
def messy_csv() -> bytes:
    """sales_messy.csv, the deliberately flawed sample."""
    path = SAMPLE_DIR / "sales_messy.csv"
    if not path.exists():
        pytest.skip("sample-data/sales_messy.csv does not exist.")
    return path.read_bytes()


@pytest.fixture
def sales_frame() -> pd.DataFrame:
    """A small, exact frame for tests that assert on specific figures.

    Deliberately not the sample file: assertions here should fail when the code
    changes and never because a sample file was regenerated with different data.
    """
    return pd.DataFrame(
        {
            "order_id": [f"O-{n:03d}" for n in range(1, 13)],
            "date": pd.date_range("2025-01-31", periods=12, freq="ME").tolist(),
            "product": ["Widget"] * 4 + ["Gadget"] * 4 + ["Doohickey"] * 4,
            "category": ["Tools"] * 8 + ["Parts"] * 4,
            "region": ["North"] * 6 + ["South"] * 6,
            "quantity": [1, 2, 3, 1, 5, 1, 2, 1, 1, 1, 1, 1],
            "unit_price": [100.0, 50.0, 30.0, 100.0, 20.0, 100.0, 50.0, 100.0, 10.0, 5.0, 8.0, 5.0],
            "revenue": [100.0, 100.0, 90.0, 100.0, 100.0, 100.0, 100.0, 100.0, 10.0, 5.0, 8.0, 5.0],
        }
    )


@pytest.fixture
def messy_frame() -> pd.DataFrame:
    """A frame with the defects the quality engine is meant to catch.

    Covers each finding type on purpose: casing variants, an unreadable date, a
    fully empty row, a blank cell, a duplicate, and a placeholder string.
    """
    return pd.DataFrame(
        {
            "order_id": ["O-1", "O-2", "O-2", "O-3", "", "O-4", "O-5"],
            "date": [
                "2025-01-15",
                "2025-01-20",
                "not a date",
                "2025-02-10",
                "",
                "2025-02-14",
                "2025-02-20",
            ],
            "product": ["Alpha", "  alpha  ", "Beta", "Gamma", "Delta", "n/a", "Alpha"],
            "region": ["North", "North", "", "South", "South", "South", "North"],
            "quantity": [1, 2, 1, 3, 1, 1, 4],
            "revenue": [100.0, 200.0, 200.0, 90.0, 50.0, 60.0, 400.0],
        }
    )


@contextmanager
def settings_override(**overrides: object) -> Iterator[None]:
    """Replace settings fields **in place** for the duration of a block.

    Every module does ``from app.config import settings``, which binds the object
    at import time. Assigning ``config.settings = Settings(...)`` therefore leaves
    those modules pointing at the original, so the override silently does nothing
    and the suite quietly shares one database. ``Settings`` is a mutable
    pydantic model, so writing the attributes is what actually takes effect.
    """
    from app import config

    previous = {key: getattr(config.settings, key) for key in overrides}
    for key, value in overrides.items():
        object.__setattr__(config.settings, key, value)
    try:
        yield
    finally:
        for key, value in previous.items():
            object.__setattr__(config.settings, key, value)


@contextmanager
def fresh_database(url: str) -> Iterator[None]:
    """Point the database at ``url`` and reset the cached engine and probe."""
    from app.db.session import reset_state

    with settings_override(database_url=url, database_enabled=True):
        reset_state()
        try:
            yield
        finally:
            reset_state()


@pytest.fixture
def tmp_database(tmp_path: Path) -> Iterator[str]:
    """A private SQLite database for the duration of one test.

    Points ``DATABASE_URL`` at a file inside ``tmp_path``, so no test can see
    another's rows and the development database is never written to.
    """
    url = f"sqlite:///{tmp_path / 'test.db'}"
    previous = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = url
    with fresh_database(url):
        yield url
    if previous is None:
        os.environ.pop("DATABASE_URL", None)
    else:
        os.environ["DATABASE_URL"] = previous


@pytest.fixture
def tmp_storage(tmp_path: Path) -> Iterator[Path]:
    """A private storage root for the duration of one test."""
    root = tmp_path / "storage"
    with settings_override(storage_root=root):
        yield root


@pytest.fixture
def no_database() -> Iterator[None]:
    """Persistence switched off entirely, for the degradation tests."""
    with settings_override(database_url="", database_enabled=False):
        from app.db.session import reset_state

        reset_state()
        try:
            yield
        finally:
            reset_state()


@pytest.fixture
def no_ai_key() -> Iterator[None]:
    """Guarantee the deterministic local narrator is used.

    Tests that assert on *fallback* behaviour need this; tests that exercise the
    model path should skip instead of relying on a key being present.
    """
    with settings_override(ai_api_key=None):
        yield
