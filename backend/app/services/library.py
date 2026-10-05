"""The dataset library: saving uploads, listing them, re-opening and re-analysing.

Everything that touches the database goes through here so the degradation policy
lives in one place:

* A missing or unreachable database never raises. Listing returns an empty list
  plus ``persistence_available=False`` and a reason, because "you have no
  datasets" and "saving is switched off" are different messages and the UI has to
  be able to tell them apart.
* Writing genuinely cannot degrade — there is nowhere else to put the row — so it
  raises a 503 with a reason the operator can act on.
* Deleting always succeeds from the client's point of view. If the storage object
  cannot be removed the database row still goes, because a library entry pointing
  at bytes that are already gone is worse than a leaked file.

What is stored is metadata, the structured analysis payload and a capped row
preview. The cells themselves stay in the file: a 200k-row dataset is millions of
values, and writing them row by row turns a fast analysis into a slow one.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.config import settings
from app.core.errors import AppException
from app.db.models import Analysis, AnalysisResult, Dataset, DatasetColumn, User
from app.db.session import probe, session_scope
from app.services.pipeline import PipelineResult, analyze_bytes
from app.storage.base import StorageNotFoundError, get_storage_provider

logger = logging.getLogger("data_analyzer.library")

#: Refuse to store a file larger than this even if the loader would accept it.
#: The library keeps a preview and a JSON analysis alongside the file, so an
#: enormous upload costs several times its own size in the database.
MAX_LIBRARY_BYTES = settings.max_upload_bytes


class PersistenceUnavailableError(AppException):
    """Raised when a write is attempted but no database is reachable."""

    def __init__(self, reason: str | None = None) -> None:
        super().__init__(
            message="Datasets cannot be saved right now.",
            code="persistence_unavailable",
            hint=reason
            or (
                "The database is not reachable. Check DATABASE_URL, or continue without "
                "saving — the analysis itself still works."
            ),
            status_code=503,
        )


@dataclass
class LibraryStatus:
    """Whether saving works, and why not when it does not."""

    available: bool
    reason: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "persistence_available": self.available,
            "unavailable_reason": self.reason,
        }


def library_status() -> LibraryStatus:
    """Probe the database and translate the verdict into UI-facing copy."""
    available, reason = probe()
    return LibraryStatus(available=available, reason=reason)


# --- users ---------------------------------------------------------------------


def ensure_local_user(session: Session) -> User:
    """The owner for datasets uploaded without signing in.

    When auth is disabled there is no real identity to attach a dataset to, so
    one local user is provisioned on demand. Without it every upload would need
    a nullable ``user_id`` and the library could not be scoped at all.
    """
    email = settings.auth_default_email.strip().lower()
    existing = session.scalar(select(User).where(User.email == email))
    if existing is not None:
        return existing

    from app.core.security import hash_password

    user = User(
        email=email,
        display_name="Local user",
        password_hash=hash_password(settings.auth_default_password),
    )
    session.add(user)
    try:
        # A concurrent request may have inserted the same email between the
        # read and the write; the unique constraint decides, not this code.
        session.flush()
    except SQLAlchemyError:
        session.rollback()
        again = session.scalar(select(User).where(User.email == email))
        if again is None:
            raise
        return again
    return user


def resolve_owner(session: Session, user_id: str | None) -> User | None:
    """The user datasets should be filed under for this request.

    A presented-but-unknown id returns None rather than creating a user: an
    unknown token is an authentication failure, not a new account.
    """
    if user_id:
        return session.get(User, user_id)
    return ensure_local_user(session)


# --- saving --------------------------------------------------------------------


def save_dataset(
    *,
    name: str,
    content: bytes,
    filename: str,
    content_type: str = "application/octet-stream",
    product_column: str | None = None,
    value_column: str | None = None,
    date_column: str | None = None,
    sheet_name: str | None = None,
    table: str | None = None,
    user_id: str | None = None,
) -> dict[str, Any]:
    """Analyse an upload, store the bytes and record the result.

    The order matters. The analysis runs first because a file that cannot be
    parsed should not leave an object in storage or a row in the database — the
    client gets a real error instead of an empty dataset it will later open.
    """
    status = library_status()
    if not status.available:
        raise PersistenceUnavailableError(status.reason)

    if len(content) > MAX_LIBRARY_BYTES:
        raise AppException(
            message="This file is too large to save.",
            code="payload_too_large",
            hint=(
                f"The library accepts files up to {settings.max_upload_mb} MB. "
                "You can still analyse a larger file without saving it."
            ),
            status_code=413,
        )

    result = analyze_bytes(
        content,
        filename=filename,
        product_column=product_column,
        value_column=value_column,
        date_column=date_column,
        sheet_name=sheet_name,
        table=table,
    )

    stored = None
    try:
        stored = get_storage_provider().save(content, filename=filename, content_type=content_type)
    except AppException:
        # The analysis already succeeded, so a storage failure must not lose it
        # and must not be reported as an analysis failure. The dataset is saved
        # without bytes and says so.
        logger.warning("Dataset stored without file bytes: storage unavailable")

    with session_scope() as session:
        owner = resolve_owner(session, user_id)
        dataset = Dataset(
            name=_clean_name(name, filename),
            original_filename=filename,
            content_type=content_type,
            size_bytes=len(content),
            storage_key=stored.key if stored else None,
            status="ready",
            status_detail=None if stored else "File bytes were not stored; re-upload to analyse.",
            user_id=owner.id if owner else None,
        )
        _apply_counts(dataset, result)
        session.add(dataset)
        session.flush()

        _write_columns(session, dataset, result)
        _write_analysis(session, dataset, result, user_id=owner.id if owner else None)
        session.flush()
        # Serialised before the session closes: the caller gets plain data, not a
        # detached ORM instance whose lazy attributes would fail on access.
        return _detail_from(dataset, session, _latest_analysis(session, dataset.id))


def _escape_like(value: str) -> str:
    """Escape the SQL LIKE wildcards so a search term is matched literally.

    Paired with ``escape="\\\\"`` on the comparison. Without this, searching for
    ``100%`` or ``a_b`` returns rows the user did not ask for, which reads as a
    broken filter rather than as a pattern.
    """
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _clean_name(name: str | None, filename: str) -> str:
    """A display name that is never blank and never absurdly long."""
    cleaned = " ".join(str(name or "").split())
    if not cleaned:
        cleaned = str(filename or "Dataset").rsplit("/", 1)[-1]
    return cleaned[:120]


def _apply_counts(dataset: Dataset, result: PipelineResult) -> None:
    """Copy the headline figures out of the analysis onto the dataset row.

    Duplicated deliberately: the library list shows a dozen datasets, and loading
    every analysis payload to render four numbers would defeat the point of
    caching them here.
    """
    response = result.response
    dataset.product_column = response.selection.product_column
    dataset.value_column = response.selection.value_column
    dataset.date_column = response.selection.date_column
    dataset.row_count = int(response.profile.row_count or 0)
    dataset.column_count = len(response.profile.columns)
    dataset.quality_score = float(response.quality.score or 0.0)


def _write_columns(session: Session, dataset: Dataset, result: PipelineResult) -> None:
    """Persist the per-column profile as real rows, for library filtering."""
    for position, column in enumerate(result.response.profile.columns):
        session.add(
            DatasetColumn(
                dataset_id=dataset.id,
                name=column.name,
                position=position,
                detected_type=str(column.detected_type)[:32],
                missing_count=int(column.missing_count),
                missing_percent=float(column.missing_percent),
                unique_count=int(column.unique_count),
                sample_values=[str(v) for v in (column.sample_values or [])][:5],
                min_value=_number(column.min),
                max_value=_number(column.max),
                mean_value=_number(column.mean),
                median_value=_number(column.median),
                std_value=_number(column.std),
                top_values=[
                    {"value": str(v.value), "count": int(v.count)}
                    for v in (column.top_values or [])[:5]
                ] or None,
            )
        )


def _write_analysis(
    session: Session,
    dataset: Dataset,
    result: PipelineResult,
    *,
    user_id: str | None = None,
) -> Analysis:
    """Record this run of the engine, with its payload and a capped preview."""
    response = result.response
    analysis = Analysis(
        dataset_id=dataset.id,
        user_id=user_id,
        product_column=response.selection.product_column,
        value_column=response.selection.value_column,
        date_column=response.selection.date_column,
        top_n=len(response.ranking.top_n) or settings.default_top_n,
        processing_ms=float(response.meta.processing_ms or 0.0),
        status="ready",
    )
    session.add(analysis)
    session.flush()

    # The preview exists so the explorer can page through a re-opened dataset
    # without re-reading the file. It is capped hard; above the cap the explorer
    # reports that it is showing a sample and offers a full re-analysis instead.
    preview = result.preview_rows

    session.add(
        AnalysisResult(
            analysis_id=analysis.id,
            payload=response.model_dump(),
            preview_rows=preview,
            preview_total_rows=result.preview_total_rows,
            preview_truncated=bool(result.preview_truncated),
        )
    )
    return analysis


# --- reading -------------------------------------------------------------------


def _latest_analysis(session: Session, dataset_id: str) -> Analysis | None:
    return session.scalar(
        select(Analysis)
        .where(Analysis.dataset_id == dataset_id)
        .order_by(Analysis.created_at.desc(), Analysis.id.desc())
        .limit(1)
    )


def get_dataset(dataset_id: str, *, user_id: str | None = None) -> dict[str, Any] | None:
    """One library entry with its cached analysis, or None when absent."""
    status = library_status()
    if not status.available:
        return None
    try:
        with session_scope() as session:
            dataset = session.get(Dataset, dataset_id)
            if dataset is None:
                return None
            return _detail_from(dataset, session, _latest_analysis(session, dataset_id))
    except SQLAlchemyError as exc:
        logger.warning("Could not read dataset %s: %s", dataset_id, type(exc).__name__)
        return None


def list_datasets(
    *,
    user_id: str | None = None,
    search: str | None = None,
    limit: int = 100,
) -> dict[str, Any]:
    """The library page. Never raises for an unreachable database."""
    status = library_status()
    if not status.available:
        return {"datasets": [], "total": 0, **status.to_dict()}

    try:
        with session_scope() as session:
            query = select(Dataset).order_by(Dataset.created_at.desc(), Dataset.id)
            term = " ".join(str(search or "").split())
            if term:
                # The LIKE wildcards are escaped by hand. SQLAlchemy's
                # `autoescape=True` exists only for the `contains`/`startswith`
                # operators, not for a raw `ilike` pattern, so relying on it
                # silently raised — and without escaping, a `%` typed into the
                # search box would match every dataset.
                escaped = _escape_like(term)
                pattern = f"%{escaped}%"
                query = query.where(
                    Dataset.name.ilike(pattern, escape="\\")
                    | Dataset.original_filename.ilike(pattern, escape="\\")
                )
            rows = list(session.scalars(query.limit(max(1, min(int(limit), 500)))))
            # The true number of matches, counted separately: `total` is what a
            # paginator needs, and it must not shrink to the page size.
            total_matches = session.scalar(
                select(func.count()).select_from(query.order_by(None).subquery())
            )
            summaries = []
            for dataset in rows:
                # Per-dataset isolation: one unreadable analysis blob blanks one
                # row's figures instead of failing the whole list.
                try:
                    analysis = _latest_analysis(session, dataset.id)
                    payload = (
                        analysis.result.payload
                        if analysis is not None and analysis.result is not None
                        else None
                    )
                except SQLAlchemyError:  # pragma: no cover - defensive
                    payload = None
                summaries.append(_summary_from(dataset, payload))
            return {"datasets": summaries, "total": int(total_matches or 0), **status.to_dict()}
    except SQLAlchemyError as exc:
        logger.warning("Could not list datasets: %s", type(exc).__name__)
        degraded = LibraryStatus(
            available=False,
            reason=f"The dataset list could not be read ({type(exc).__name__}).",
        )
        return {"datasets": [], "total": 0, **degraded.to_dict()}


def rename_dataset(dataset_id: str, name: str, *, user_id: str | None = None) -> dict[str, Any]:
    """Change a dataset's display name without touching the stored file.

    Checks the database first, for the same reason the write paths do: without
    the probe the tables may not exist yet on a fresh install, and the failure
    would surface as an opaque SQL error instead of an explanation.
    """
    status = library_status()
    if not status.available:
        raise PersistenceUnavailableError(status.reason)

    cleaned = _clean_name(name, "Dataset")
    with session_scope() as session:
        dataset = session.get(Dataset, dataset_id)
        if dataset is None:
            raise _not_found(dataset_id)
        dataset.name = cleaned
        session.flush()
        return _summary_from(dataset)


def reanalyze_dataset(
    dataset_id: str,
    *,
    product_column: str | None = None,
    value_column: str | None = None,
    date_column: str | None = None,
    top_n: int | None = None,
    user_id: str | None = None,
) -> dict[str, Any]:
    """Re-run the engine over stored bytes with different column choices.

    When the bytes are gone the stored payload is promoted to be the answer
    rather than failing: a dataset whose file was cleared from disk should still
    open, and the response says the columns were not re-read.
    """
    status = library_status()
    if not status.available:
        raise PersistenceUnavailableError(status.reason)

    with session_scope() as session:
        dataset = session.get(Dataset, dataset_id)
        if dataset is None:
            raise _not_found(dataset_id)

        content: bytes | None = None
        if dataset.storage_key:
            try:
                content, _meta = get_storage_provider().read(dataset.storage_key)
            except StorageNotFoundError:
                logger.info(
                    "Dataset %s has no stored bytes; reusing the cached analysis", dataset_id
                )
                content = None
            except AppException:
                content = None

        if content is None:
            cached = _detail_from(dataset, session, _latest_analysis(session, dataset_id))
            cached["reanalyzed"] = False
            cached["note"] = (
                "The stored file is no longer available, so the last saved analysis was "
                "shown instead. Re-upload the file to change the columns."
            )
            return cached

        result = analyze_bytes(
            content,
            filename=dataset.original_filename,
            product_column=product_column,
            value_column=value_column,
            date_column=date_column,
            top_n=top_n,
        )
        _apply_counts(dataset, result)
        _write_analysis(session, dataset, result, user_id=user_id or dataset.user_id)
        session.flush()
        detail = _detail_from(dataset, session, _latest_analysis(session, dataset_id))
        detail["reanalyzed"] = True
        return detail


def delete_dataset(dataset_id: str, *, user_id: str | None = None) -> dict[str, Any]:
    """Remove a dataset and its stored bytes.

    Returns a report rather than raising on a missing file: the row is gone,
    which is what the client asked for, and a leftover object is an operator
    problem worth naming rather than a client failure.
    """
    status = library_status()
    if not status.available:
        raise PersistenceUnavailableError(status.reason)

    removed_bytes = False
    with session_scope() as session:
        dataset = session.get(Dataset, dataset_id)
        if dataset is None:
            raise _not_found(dataset_id)
        key = dataset.storage_key
        session.delete(dataset)
        session.flush()

    if key:
        try:
            removed_bytes = bool(get_storage_provider().delete(key))
        except AppException:
            removed_bytes = False

    return {"id": dataset_id, "deleted": True, "file_removed": removed_bytes}


def read_dataset_file(dataset_id: str, *, user_id: str | None = None) -> tuple[bytes, str, str]:
    """``(bytes, content_type, filename)`` for a stored dataset.

    The only path by which stored bytes leave the server. There is no static
    mount, so an upload cannot be fetched by guessing a key.
    """
    with session_scope() as session:
        dataset = session.get(Dataset, dataset_id)
        if dataset is None:
            raise _not_found(dataset_id)
        key = dataset.storage_key
        filename = dataset.original_filename
        content_type = dataset.content_type

    if not key:
        raise AppException(
            message="This dataset has no stored file.",
            code="file_not_stored",
            hint="Only the analysis was saved. Re-upload the file to download it.",
            status_code=404,
        )

    try:
        data, meta = get_storage_provider().read(key)
    except StorageNotFoundError as exc:
        # The row says there should be bytes and there are none. That is the
        # same user-visible situation as never having stored them, so it gets
        # the same message and code rather than a bare "not found" the UI cannot
        # distinguish from a wrong dataset id.
        raise AppException(
            message="This dataset has no stored file.",
            code="file_not_stored",
            hint="Only the analysis was saved. Re-upload the file to download it.",
            status_code=404,
        ) from exc

    return data, meta.content_type or content_type, filename


def dataset_analysis(dataset_id: str) -> dict[str, Any] | None:
    """The cached analysis payload for a dataset, or None."""
    status = library_status()
    if not status.available:
        return None
    try:
        with session_scope() as session:
            dataset = session.get(Dataset, dataset_id)
            if dataset is None:
                return None
            analysis = _latest_analysis(session, dataset_id)
            if analysis is None:
                return None
            result = analysis.result
            return result.payload if result is not None else None
    except SQLAlchemyError as exc:
        logger.warning("Could not read analysis for %s: %s", dataset_id, type(exc).__name__)
        return None


# --- serialisation --------------------------------------------------------------


def _summary_from(dataset: Dataset, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    """A library list row.

    ``payload`` is the newest analysis for this dataset when the caller already
    has it in hand. It is optional so the library list can render every dataset
    even if one dataset's analysis blob turns out to be unreadable — the missing
    piece is a blank cell, not a whole missing row.
    """
    ranking = payload.get("ranking") if isinstance(payload, dict) else None
    kind = payload.get("dataset_kind") if isinstance(payload, dict) else None
    return {
        "id": dataset.id,
        "name": dataset.name,
        "original_filename": dataset.original_filename,
        "created_at": _iso(dataset.created_at),
        "updated_at": _iso(dataset.updated_at),
        "status": dataset.status,
        "status_detail": dataset.status_detail,
        "row_count": dataset.row_count,
        "column_count": dataset.column_count,
        "total_value": (ranking or {}).get("total_value"),
        "quality_score": dataset.quality_score,
        "dataset_kind": (kind or {}).get("kind"),
        "product_column": dataset.product_column,
        "value_column": dataset.value_column,
        "date_column": dataset.date_column,
        "storage_bytes": dataset.size_bytes,
    }


def _detail_from(
    dataset: Dataset,
    session: Session,
    analysis: Analysis | None,
) -> dict[str, Any]:
    payload: dict[str, Any] | None = None
    preview_rows: list[Any] | None = None
    preview_total = 0
    preview_truncated = False

    if analysis is not None and analysis.result is not None:
        result = analysis.result
        payload = result.payload
        preview_rows = result.preview_rows
        preview_total = result.preview_total_rows
        preview_truncated = bool(result.preview_truncated)

    detail = _summary_from(dataset, payload)
    detail["columns"] = [
        {
            "name": c.name,
            "position": c.position,
            "detected_type": c.detected_type,
            "missing_percent": round(float(c.missing_percent or 0.0), 2),
            "unique_count": c.unique_count,
        }
        for c in sorted(dataset.columns, key=lambda c: c.position)
    ]
    detail["analysis"] = payload
    detail["preview_rows"] = preview_rows
    detail["preview_total_rows"] = preview_total
    detail["preview_truncated"] = preview_truncated
    return detail


# --- helpers --------------------------------------------------------------------


def _not_found(dataset_id: str) -> AppException:
    return AppException(
        message="That dataset does not exist.",
        code="dataset_not_found",
        hint="It may have been deleted. Upload the file again.",
        status_code=404,
    )


def _number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if result == result else None


def _iso(value: datetime | None) -> str:
    """ISO timestamp, normalised to UTC so two servers agree on the format."""
    if value is None:
        return datetime.now(UTC).isoformat()
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat()


__all__ = [
    "MAX_LIBRARY_BYTES",
    "LibraryStatus",
    "PersistenceUnavailableError",
    "dataset_analysis",
    "delete_dataset",
    "ensure_local_user",
    "get_dataset",
    "library_status",
    "list_datasets",
    "read_dataset_file",
    "reanalyze_dataset",
    "rename_dataset",
    "resolve_owner",
    "save_dataset",
]
