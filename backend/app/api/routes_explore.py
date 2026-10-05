"""Data Explorer endpoint: one page of rows, filtered and sorted server-side.

The explorer exists because "show me the rows" is the first question anyone asks
of a file, and answering it by sending the whole file to the browser is how a
50,000-row upload turns into a multi-megabyte JSON payload and a frozen tab.
Here the browser sends a page number, a sort, a search term and a set of typed
filters, and gets back at most ``page_size`` rows.

Design choices that are visible from the outside:

* **Bad input is reported, not fatal.** A sort on a dropped column, or a filter
  on a column that holds no numbers, comes back in ``rejected`` with the table
  still rendered. Failing the request instead would cost the user their table
  over one dropdown they misconfigured.
* **Page size is capped in code**, not only in the request schema. The schema
  documents the contract; this enforces it for any caller.
* **Filters travel as a JSON string in a form field.** An upload is
  ``multipart/form-data``, so the filters cannot be a typed request body
  alongside the file. They are parsed and validated here, which keeps one upload
  endpoint rather than two nearly identical ones.
"""

from __future__ import annotations

import json
import logging
from typing import Annotated, Any

import pandas as pd
from fastapi import APIRouter, Body, Depends, File, Form, UploadFile

from app.api.deps import AuthContext, require_auth
from app.core.errors import AppException
from app.schemas.library import ExploreFilterRequest, ExploreRequest, ExploreResponse
from app.services import library
from app.services.explorer import explore_frame
from app.services.pipeline import analyze_bytes

logger = logging.getLogger("data_analyzer.api.explore")

router = APIRouter(tags=["Explore"])

#: Hard ceiling on rows in one page, independent of what the schema allows.
MAX_PAGE_SIZE = 200


@router.post(
    "/explore",
    response_model=ExploreResponse,
    summary="Browse Rows of an Upload",
    description=(
        "Uploads a file and returns one page of its rows, with per-column metadata, the "
        "distinct values a filter needs, and the counts needed to render a pager. "
        "Filtering, sorting and pagination all happen server-side. Send `filters` as a "
        "JSON array of {column, operator, value} objects; an unparsable one is reported "
        "in `rejected` and ignored."
    ),
)
async def explore_upload(
    file: Annotated[UploadFile, File(description="CSV (.csv) or Excel (.xlsx, .xls) file")],
    product_column: Annotated[
        str | None,
        Form(description="Optional override column name for the product/item entity"),
    ] = None,
    value_column: Annotated[
        str | None,
        Form(description="Optional override column name for the metric/revenue"),
    ] = None,
    date_column: Annotated[
        str | None,
        Form(description="Optional override column name for the date/timestamp"),
    ] = None,
    page: Annotated[int, Form(ge=1, description="1-based page number")] = 1,
    page_size: Annotated[
        int | None,
        Form(ge=1, le=MAX_PAGE_SIZE, description=f"Rows per page, capped at {MAX_PAGE_SIZE}"),
    ] = None,
    sort: Annotated[str | None, Form(description="Column to sort by")] = None,
    direction: Annotated[str, Form(description="Sort direction: 'asc' or 'desc'")] = "asc",
    search: Annotated[str | None, Form(description="Case-insensitive substring")] = None,
    search_columns: Annotated[
        str | None,
        Form(description="JSON array of columns to search. Defaults to every text column"),
    ] = None,
    filters: Annotated[
        str | None,
        Form(description='JSON array of {"column", "operator", "value"} objects'),
    ] = None,
    sheet_name: Annotated[
        str | None,
        Form(description="Optional specific sheet name for Excel/ODS workbooks"),
    ] = None,
    table: Annotated[
        str | None,
        Form(description="Optional table name for SQLite databases"),
    ] = None,
) -> ExploreResponse:
    content = await file.read()
    # The pipeline is reused rather than reimplemented: the explorer's rows are the
    # cleaned rows, so they must be the same rows every other feature reports.
    result = analyze_bytes(
        content,
        filename=file.filename or "uploaded_data.csv",
        product_column=product_column,
        value_column=value_column,
        date_column=date_column,
        sheet_name=sheet_name,
        table=table,
    )

    rejected: list[str] = []
    page_data = explore_frame(
        result.detected_df,
        page=page,
        page_size=page_size,
        sort=sort,
        direction=direction,
        search=search,
        search_columns=_parse_names(search_columns, rejected, "search_columns"),
        filters=_parse_filters(filters, rejected),
    )
    rejected.extend(page_data.rejected)
    return ExploreResponse(**{**page_data.to_dict(), "rejected": rejected})


@router.post(
    "/datasets/{dataset_id}/explore",
    response_model=ExploreResponse,
    summary="Browse Rows of a Saved Dataset",
    description=(
        "Pages through a saved dataset with the same filters and sorting as the upload "
        "endpoint. The stored file is re-read when it is available, so every row is "
        "reachable. If the bytes are gone the stored preview is used instead and the "
        "response says the table is a sample rather than silently truncating it."
    ),
    responses={404: {"description": "No dataset with that id"}},
)
async def explore_dataset(
    dataset_id: str,
    auth: Annotated[AuthContext, Depends(require_auth)],
    body: Annotated[ExploreRequest | None, Body()] = None,
) -> ExploreResponse:
    request = body or ExploreRequest()
    detail = library.get_dataset(dataset_id, user_id=auth.owner_id)
    if detail is None:
        info = library.library_status()
        if not info.available:
            raise library.PersistenceUnavailableError(info.reason)
        raise AppException(
            message="That dataset does not exist.",
            code="dataset_not_found",
            hint="It may have been deleted. Upload the file again.",
            status_code=404,
        )

    rejected: list[str] = []
    frame, source_note = _frame_for_dataset(detail)
    if frame is None:
        raise AppException(
            message="No rows are stored for this dataset.",
            code="preview_unavailable",
            hint=(
                "Re-upload the file to browse its rows. The analytics pages work from the "
                "saved analysis and are not affected."
            ),
            status_code=409,
        )

    page_data = explore_frame(
        frame,
        page=request.page,
        page_size=request.page_size,
        sort=request.sort,
        direction=request.direction,
        search=request.search,
        search_columns=request.search_columns,
        filters=[f.model_dump() for f in request.filters],
    )
    rejected.extend(page_data.rejected)
    rejected.extend(source_note)
    return ExploreResponse(**{**page_data.to_dict(), "rejected": rejected})


def _frame_for_dataset(detail: dict[str, Any]) -> tuple[pd.DataFrame | None, list[str]]:
    """Rows to browse, preferring the stored file over the cached preview.

    Re-reading the file costs one parse but returns every row, whereas the preview
    is a capped sample. The preview is the fallback for when the bytes are gone,
    and the difference is reported either way so the table cannot quietly look
    complete when it is not.
    """
    dataset_id = detail.get("id")
    notes: list[str] = []
    filename = str(detail.get("original_filename") or "dataset.csv")

    if dataset_id:
        try:
            content, _ctype, _name = library.read_dataset_file(str(dataset_id))
            result = analyze_bytes(
                content,
                filename=filename,
                product_column=detail.get("product_column"),
                value_column=detail.get("value_column"),
                date_column=detail.get("date_column"),
            )
            return result.detected_df, notes
        except AppException:
            # Storage is unavailable or the object is gone. The preview may still
            # serve the table, so this is a downgrade rather than a failure.
            notes.append(
                "The stored file could not be read, so this is the saved preview. "
                "Re-upload the file to browse every row."
            )
        except Exception:  # noqa: BLE001 - a parse failure must not 500 the explorer
            notes.append(
                "The stored file could not be re-read, so this is the saved preview."
            )

    rows = detail.get("preview_rows") or []
    if not rows:
        return None, notes
    if detail.get("preview_truncated"):
        notes.append(
            "This is a saved sample of the rows, not the whole dataset. "
            "Re-upload the file to browse every row."
        )
    return _rows_to_frame(rows, [c["name"] for c in detail.get("columns", [])]), notes


# --- form field parsing ---------------------------------------------------------


def _parse_filters(raw: str | None, rejected: list[str]) -> list[dict[str, Any]]:
    """Parse the ``filters`` form field into validated filter objects.

    A malformed field never fails the request: the table is still worth showing
    without the filter the client meant to send.
    """
    if not raw or not raw.strip():
        return []

    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        rejected.append("Filters were not valid JSON and were ignored.")
        return []

    if not isinstance(parsed, list):
        rejected.append("Filters must be a JSON array and were ignored.")
        return []

    filters: list[dict[str, Any]] = []
    for index, item in enumerate(parsed):
        try:
            filters.append(ExploreFilterRequest(**item).model_dump())
        except (TypeError, ValueError) as exc:
            # Report the position and the kind of problem, not the internal
            # pydantic message: the client needs something it can act on.
            rejected.append(
                f"Filter {index + 1} was invalid and was ignored "
                f"({exc.__class__.__name__})."
            )
    return filters


def _parse_names(raw: str | None, rejected: list[str], field: str) -> list[str] | None:
    """Parse a JSON array of column names."""
    if not raw or not raw.strip():
        return None
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        rejected.append(f"{field} was not valid JSON and was ignored.")
        return None
    if not isinstance(parsed, list) or not all(isinstance(item, str) for item in parsed):
        rejected.append(f"{field} must be a JSON array of column names and was ignored.")
        return None
    return parsed


def _rows_to_frame(rows: list[Any], columns: list[str]) -> pd.DataFrame:
    """Rebuild a frame from the stored preview.

    Column names come from the saved column list; anything the preview has beyond
    that is named positionally. The names matter: ``explore_frame`` matches
    filters and sorts by name, so an unnamed frame would reject every one of them.
    """
    if not rows:
        return pd.DataFrame(columns=columns or ["value"])

    width = max(len(r) if isinstance(r, (list, tuple)) else 1 for r in rows)
    names = [str(c) for c in columns][:width]
    while len(names) < width:
        names.append(f"column_{len(names) + 1}")

    normalised: list[list[Any]] = []
    for row in rows:
        cells = list(row) if isinstance(row, (list, tuple)) else [row]
        normalised.append(cells[:width] + [None] * (width - len(cells)))
    return pd.DataFrame(normalised, columns=names)


__all__ = ["MAX_PAGE_SIZE", "router"]
