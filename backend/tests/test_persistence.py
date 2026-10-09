"""Tests for persistence: the dataset library and the storage provider.

Two rules dominate this module.

**Never store millions of cells.** A dataset is stored once, its columns are
described, and its analysis is cached. The rows are not. A user who uploads a
large file must not find the database grew by the same amount, and the tests
below assert the stored payload stays bounded however large the input is.

**Reads degrade, writes refuse.** A missing database means
``persistence_available: false`` and a scrubbed reason — never a 500, because
the analysis pages still work. A *write* raises, because silently dropping the
dataset a user just uploaded is worse than refusing it.

The service functions here take keyword-only arguments and open their own
sessions; the tests use them directly rather than through HTTP so a routing
change cannot make a storage bug look like a routing bug.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from app.core.errors import AppException
from app.services import library
from app.services.pipeline import PREVIEW_ROWS
from app.storage import LocalStorageProvider
from tests.conftest import fresh_database


def make_csv(rows: int = 40) -> bytes:
    """A small but real CSV: a date, a grouping column and a measure."""
    frame = pd.DataFrame(
        {
            "date": pd.date_range("2025-01-31", periods=rows, freq="ME").strftime("%Y-%m-%d").tolist(),
            "product": [f"Item {n % 5}" for n in range(rows)],
            "revenue": [100.0 + n for n in range(rows)],
        }
    )
    return frame.to_csv(index=False).encode()


def save(tmp_storage: Path, name: str = "Sales", rows: int = 40, **kwargs) -> dict:
    """Save a small dataset, keeping the test bodies about the assertion."""
    return library.save_dataset(
        name=name, content=make_csv(rows), filename="sales.csv", **kwargs
    )


def storage_key_of(dataset_id: str) -> str | None:
    """Read the storage key from the table.

    Deliberately not taken from the API response: the key is an internal handle
    and no response exposes it, so the tests reach for it the way the service
    does rather than wishing the response carried it.
    """
    from app.db.models import Dataset
    from app.db.session import session_scope

    with session_scope() as session:
        return session.get(Dataset, dataset_id).storage_key


# --- status ---------------------------------------------------------------------


def test_a_fresh_database_reports_available(tmp_database: str) -> None:
    info = library.library_status()
    assert info.available is True
    assert info.reason is None
    assert info.to_dict()["persistence_available"] is True


def test_a_disabled_database_is_reported_not_raised(no_database: None) -> None:
    """The library page must render "no database", not a 500."""
    info = library.library_status()
    assert info.available is False
    assert info.reason
    # Reads degrade to an honest empty answer rather than failing.
    listed = library.list_datasets()
    assert listed["datasets"] == []
    assert listed["persistence_available"] is False
    assert library.get_dataset("anything") is None


def test_a_write_without_a_database_refuses_loudly(no_database: None) -> None:
    """A silently dropped upload is worse than an error the user can read."""
    with pytest.raises(library.PersistenceUnavailableError) as excinfo:
        library.save_dataset(name="X", content=make_csv(5), filename="x.csv")
    assert excinfo.value.status_code == 503
    assert excinfo.value.hint


def test_the_reason_never_leaks_a_password() -> None:
    """A DSN with a password in it must not reach a browser inside an error."""
    with fresh_database("postgresql://user:hunter2@127.0.0.1:5999/nope"):
        info = library.library_status()
        # Either outcome must be safe: if it connected there is nothing to check.
        if not info.available:
            assert "hunter2" not in info.reason
            assert "hunter2" not in str(info.to_dict())


# --- saving ---------------------------------------------------------------------


def test_saving_returns_the_analysis_and_the_counts(tmp_database: str, tmp_storage: Path) -> None:
    saved = save(tmp_storage, "Sales", rows=40)
    assert saved["name"] == "Sales"
    assert saved["row_count"] == 40
    assert saved["quality_score"] > 0
    assert saved["analysis"]["ranking"]["product_count"] == 5


def test_a_short_dataset_is_not_called_a_sample(tmp_database: str, tmp_storage: Path) -> None:
    saved = save(tmp_storage, rows=40)
    assert saved["preview_total_rows"] == 40
    assert len(saved["preview_rows"]) == 40
    assert saved["preview_truncated"] is False


def test_a_large_dataset_keeps_a_bounded_preview(tmp_database: str, tmp_storage: Path) -> None:
    """Rows are capped, and both the true count and the cap are reported so the
    table can never present a sample as the whole dataset."""
    saved = save(tmp_storage, rows=500)
    assert saved["preview_total_rows"] == 500
    assert len(saved["preview_rows"]) == PREVIEW_ROWS
    assert saved["preview_truncated"] is True


def test_columns_are_summarised_not_stored_cell_by_cell(
    tmp_database: str, tmp_storage: Path
) -> None:
    saved = save(tmp_storage, rows=30)
    assert [c["name"] for c in saved["columns"]] == ["date", "product", "revenue"]
    for column in saved["columns"]:
        assert set(column) <= {
            "name", "position", "detected_type", "missing_count", "missing_percent",
            "unique_count", "min", "max", "mean", "median", "std", "top_values",
            "sample_values",
        }, f"column summary carries unexpected keys: {sorted(column)}"


def test_columns_are_real_rows_not_a_json_blob(tmp_database: str, tmp_storage: Path) -> None:
    """Stored as rows so the library can filter on them without a JSON scan."""
    from sqlalchemy import select

    from app.db.models import DatasetColumn
    from app.db.session import session_scope

    saved = save(tmp_storage, rows=20)
    with session_scope() as session:
        rows = list(
            session.scalars(select(DatasetColumn).where(DatasetColumn.dataset_id == saved["id"]))
        )
    assert {c.name for c in rows} == {"date", "product", "revenue"}
    assert [c.position for c in sorted(rows, key=lambda c: c.position)] == [0, 1, 2]


def test_a_blank_name_falls_back_to_the_filename(tmp_database: str, tmp_storage: Path) -> None:
    saved = library.save_dataset(name="   ", content=make_csv(5), filename="q4_sales.csv")
    assert saved["name"] == "q4_sales.csv"


def test_an_overlong_name_is_truncated(tmp_database: str, tmp_storage: Path) -> None:
    saved = library.save_dataset(name="x" * 500, content=make_csv(5), filename="a.csv")
    assert len(saved["name"]) <= 120


def test_a_file_too_large_to_save_is_refused_with_the_limit(
    tmp_database: str, tmp_storage: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.services import library as lib

    monkeypatch.setattr(lib, "MAX_LIBRARY_BYTES", 100)
    with pytest.raises(Exception) as excinfo:
        lib.save_dataset(name="Big", content=make_csv(200), filename="big.csv")
    assert "large" in str(excinfo.value).lower()


def test_saving_twice_creates_two_datasets(tmp_database: str, tmp_storage: Path) -> None:
    first = save(tmp_storage, "A")
    second = save(tmp_storage, "A")
    assert first["id"] != second["id"]
    assert len(library.list_datasets()["datasets"]) == 2


# --- reading --------------------------------------------------------------------


def test_listing_is_newest_first(tmp_database: str, tmp_storage: Path) -> None:
    first = save(tmp_storage, "First")
    second = save(tmp_storage, "Second")
    ids = [d["id"] for d in library.list_datasets()["datasets"]]
    assert ids[0] == second["id"]
    assert ids.index(first["id"]) == 1


def test_listing_searches_the_name(tmp_database: str, tmp_storage: Path) -> None:
    save(tmp_storage, "Q1 revenue")
    save(tmp_storage, "Q2 revenue")
    found = library.list_datasets(search="q1")["datasets"]
    assert [d["name"] for d in found] == ["Q1 revenue"]


def test_a_wildcard_in_the_search_is_literal(tmp_database: str, tmp_storage: Path) -> None:
    """`%` must not match everything; otherwise the search box lies."""
    save(tmp_storage, "Plain")
    save(tmp_storage, "100% done")
    found = library.list_datasets(search="%")["datasets"]
    assert [d["name"] for d in found] == ["100% done"]


def test_an_empty_search_is_trimmed(tmp_database: str, tmp_storage: Path) -> None:
    save(tmp_storage, "Anything")
    assert len(library.list_datasets(search="   ")["datasets"]) == 1


def test_listing_respects_a_limit_but_reports_the_true_total(
    tmp_database: str, tmp_storage: Path
) -> None:
    for n in range(5):
        save(tmp_storage, f"Set {n}", rows=5)
    result = library.list_datasets(limit=2)
    assert len(result["datasets"]) == 2
    assert result["total"] == 5


def test_an_empty_library_is_an_empty_list(tmp_database: str) -> None:
    result = library.list_datasets()
    assert result["datasets"] == []
    assert result["total"] == 0


def test_listing_carries_the_headline_figures_without_the_whole_payload(
    tmp_database: str, tmp_storage: Path
) -> None:
    """A list of twenty datasets must not drag twenty analysis payloads along."""
    save(tmp_storage, rows=10)
    summary = library.list_datasets()["datasets"][0]
    assert "analysis" not in summary
    assert summary["row_count"] == 10
    assert summary["quality_score"] is not None


def test_an_unknown_id_is_none_not_an_exception(tmp_database: str) -> None:
    assert library.get_dataset("does-not-exist") is None


def test_an_unknown_id_on_a_write_raises_not_found(tmp_database: str) -> None:
    from app.core.errors import AppException

    with pytest.raises(AppException) as excinfo:
        library.rename_dataset("does-not-exist", "New")
    assert excinfo.value.status_code == 404


# --- updating -------------------------------------------------------------------


def test_renaming_leaves_everything_else_alone(tmp_database: str, tmp_storage: Path) -> None:
    saved = save(tmp_storage, "Old", rows=20)
    renamed = library.rename_dataset(saved["id"], "New name")
    assert renamed["name"] == "New name"
    assert renamed["row_count"] == saved["row_count"]
    assert renamed["id"] == saved["id"]


def test_reanalysing_applies_the_new_top_n(tmp_database: str, tmp_storage: Path) -> None:
    saved = save(tmp_storage, rows=40)
    result = library.reanalyze_dataset(saved["id"], top_n=2)
    assert result["reanalyzed"] is True
    assert len(result["analysis"]["ranking"]["top_n"]) == 2


def test_reanalysing_falls_back_to_the_cache_when_the_file_is_gone(
    tmp_database: str, tmp_storage: Path
) -> None:
    """Losing the bytes is a downgrade, and it is labelled as one rather than
    silently returning stale figures as if they were fresh."""
    saved = save(tmp_storage, rows=30)
    original = saved["analysis"]["ranking"]["total_value"]
    LocalStorageProvider(tmp_storage).delete(storage_key_of(saved["id"]))

    result = library.reanalyze_dataset(saved["id"], top_n=2)
    assert result["reanalyzed"] is False
    assert result["note"]
    assert result["analysis"]["ranking"]["total_value"] == original
    # The request was not silently honoured either: top_n could not be applied.
    assert len(result["analysis"]["ranking"]["top_n"]) != 2


# --- deleting -------------------------------------------------------------------


def test_deleting_removes_the_row_and_the_file(tmp_database: str, tmp_storage: Path) -> None:
    saved = save(tmp_storage, "Doomed", rows=10)
    result = library.delete_dataset(saved["id"])
    assert result["deleted"] is True
    assert result["file_removed"] is True
    assert library.get_dataset(saved["id"]) is None
    assert not list(tmp_storage.rglob("*.csv"))


def test_deleting_a_dataset_whose_file_vanished_still_succeeds(
    tmp_database: str, tmp_storage: Path
) -> None:
    """A missing object is an operator problem to report, not a client failure:
    the row the user asked to remove is gone, which is the outcome they wanted.
    The report says so rather than claiming a file it could not find."""
    saved = save(tmp_storage, "Doomed", rows=10)
    LocalStorageProvider(tmp_storage).delete(storage_key_of(saved["id"]))

    result = library.delete_dataset(saved["id"])
    assert result["deleted"] is True
    assert result["file_removed"] is False
    assert library.get_dataset(saved["id"]) is None


def test_deleting_twice_is_a_404_the_second_time(tmp_database: str, tmp_storage: Path) -> None:
    """Idempotent deletion is a guess; reporting "no such dataset" is a fact.
    A client can retry the list and see it is gone either way."""
    saved = save(tmp_storage, "Doomed", rows=10)
    assert library.delete_dataset(saved["id"])["deleted"] is True
    with pytest.raises(AppException) as excinfo:
        library.delete_dataset(saved["id"])
    assert excinfo.value.status_code == 404


def test_deleting_a_dataset_that_never_existed_raises(tmp_database: str) -> None:
    from app.core.errors import AppException

    with pytest.raises(AppException) as excinfo:
        library.delete_dataset("nope")
    assert excinfo.value.status_code == 404


# --- reading the bytes back -----------------------------------------------------


def test_reading_a_file_returns_the_original_bytes(
    tmp_database: str, tmp_storage: Path
) -> None:
    saved = save(tmp_storage, rows=10)
    data, content_type, filename = library.read_dataset_file(saved["id"])
    assert data == make_csv(10)
    assert filename == "sales.csv"
    assert content_type


def test_reading_a_deleted_dataset_raises(tmp_database: str, tmp_storage: Path) -> None:
    from app.core.errors import AppException

    saved = save(tmp_storage, rows=10)
    library.delete_dataset(saved["id"])
    with pytest.raises(AppException) as excinfo:
        library.read_dataset_file(saved["id"])
    assert excinfo.value.status_code == 404


def test_a_dataset_stored_without_bytes_says_so(tmp_database: str, tmp_storage: Path) -> None:
    """A storage failure must not lose the analysis; the dataset opens without
    its file and the export endpoint says why."""
    saved = save(tmp_storage, rows=10)
    LocalStorageProvider(tmp_storage).delete(storage_key_of(saved["id"]))
    from app.core.errors import AppException

    with pytest.raises(AppException) as excinfo:
        library.read_dataset_file(saved["id"])
    assert excinfo.value.code == "file_not_stored"
    assert excinfo.value.status_code == 404


# --- storage provider -----------------------------------------------------------


def test_storage_round_trips_bytes(tmp_storage: Path) -> None:
    provider = LocalStorageProvider(tmp_storage)
    payload = b"a,b\n1,2\n"
    stored = provider.save(payload, filename="x.csv", content_type="text/csv")
    assert provider.read(stored.key)[0] == payload
    assert provider.read(stored.key)[1].content_type == "text/csv"


def test_storage_writes_inside_its_root(tmp_storage: Path) -> None:
    provider = LocalStorageProvider(tmp_storage)
    stored = provider.save(b"x", filename="x.csv", content_type="text/csv")
    assert (tmp_storage / stored.key).resolve().is_relative_to(tmp_storage.resolve())


def test_storage_never_uses_the_uploaded_name_as_the_key(tmp_storage: Path) -> None:
    """The key is pure random, so nothing an attacker types survives into it."""
    provider = LocalStorageProvider(tmp_storage)
    stored = provider.save(b"x", filename="../../etc/passwd.csv", content_type="text/csv")
    assert "/" not in stored.key
    assert ".." not in stored.key
    assert "passwd" not in stored.key
    assert (tmp_storage / stored.key).resolve().is_relative_to(tmp_storage.resolve())
    # The display name is still preserved — for the UI, not for the path.
    assert stored.original_filename == "passwd.csv"


def test_storage_refuses_to_read_outside_its_root(tmp_storage: Path) -> None:
    """A crafted key is an attack, not a typo, so it raises rather than
    returning whatever it found."""
    from app.storage.base import StorageNotFoundError

    provider = LocalStorageProvider(tmp_storage)
    with pytest.raises(StorageNotFoundError):
        provider.read("../../etc/passwd")
    with pytest.raises(StorageNotFoundError):
        provider.read("/etc/passwd")
    # Absolute paths can't escape either.
    with pytest.raises(StorageNotFoundError):
        provider.read(str(Path.home() / ".ssh" / "id_rsa"))


def test_storage_uses_a_unique_key_per_upload(tmp_storage: Path) -> None:
    provider = LocalStorageProvider(tmp_storage)
    keys = {
        provider.save(b"same bytes", filename="x.csv", content_type="text/csv").key
        for _ in range(3)
    }
    assert len(keys) == 3


def test_two_uploads_of_the_same_name_do_not_overwrite_each_other(
    tmp_storage: Path,
) -> None:
    provider = LocalStorageProvider(tmp_storage)
    first = provider.save(b"first", filename="x.csv", content_type="text/csv")
    second = provider.save(b"second", filename="x.csv", content_type="text/csv")
    assert provider.read(first.key)[0] == b"first"
    assert provider.read(second.key)[0] == b"second"


def test_storage_leaves_no_partial_file_behind(tmp_storage: Path) -> None:
    """Writes go to `.part` and are renamed, so a reader never sees half a file."""
    provider = LocalStorageProvider(tmp_storage)
    provider.save(b"complete", filename="x.csv", content_type="text/csv")
    assert not list(tmp_storage.rglob("*.part"))


def test_a_corrupt_sidecar_costs_metadata_not_the_file(tmp_storage: Path) -> None:
    """Metadata is a convenience; the bytes are the data."""
    provider = LocalStorageProvider(tmp_storage)
    stored = provider.save(b"still here", filename="x.csv", content_type="text/csv")
    (tmp_storage / f"{stored.key}.meta.json").write_text("{not json")
    data, meta = provider.read(stored.key)
    assert data == b"still here"
    assert meta.content_type == "application/octet-stream"


def test_deleting_reports_whether_there_was_anything_to_delete(tmp_storage: Path) -> None:
    provider = LocalStorageProvider(tmp_storage)
    stored = provider.save(b"x", filename="x.csv", content_type="text/csv")
    assert provider.delete(stored.key) is True
    assert provider.delete(stored.key) is False


def test_reading_a_missing_key_raises_a_distinct_error(tmp_storage: Path) -> None:
    """The caller needs to tell "no such file" from "storage is broken"."""
    from app.storage.base import StorageNotFoundError

    provider = LocalStorageProvider(tmp_storage)
    with pytest.raises(StorageNotFoundError):
        provider.read("no-such-key.csv")


# --- helpers --------------------------------------------------------------------
