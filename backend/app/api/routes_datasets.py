"""Dataset library endpoints: save, list, open, rename, re-analyse, delete, export.

Two behaviours are worth stating up front because they are the ones a client can
get wrong:

* **Saving needs the database.** When persistence is off, ``POST /datasets``
  returns a 503 with a reason and the file is *not* stored. Analysis endpoints
  are unaffected — they never needed the database.
* **Reading degrades, writing fails.** ``GET /datasets`` returns an empty list
  with ``persistence_available: false`` rather than a 500, so the library page
  can say "saving is switched off" instead of "an error occurred".

Every dataset-producing endpoint shares :mod:`app.services.pipeline`, so a
dataset opened from the library carries exactly the payload an upload produced.
"""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile, status
from fastapi.responses import Response

from app.api.deps import AuthContext, require_auth
from app.core.errors import AppException
from app.schemas.library import (
    AnalyzeDatasetRequest,
    DatasetDetailResponse,
    DatasetListResponse,
    DatasetSummaryResponse,
    ReanalyzeDatasetRequest,
    RenameDatasetRequest,
    SaveDatasetRequest,
)
from app.services import library

logger = logging.getLogger("data_analyzer.api.datasets")

router = APIRouter(tags=["Datasets"])

#: Rows offered when the caller does not specify a limit. The library list is a
#: list of names and headline figures; it is not a data export.
MAX_LIBRARY_PAGE = 500


@router.post(
    "/datasets",
    response_model=DatasetDetailResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Save an Upload as a Dataset",
    description=(
        "Analyses the upload, stores the bytes in the configured storage provider and "
        "records the dataset, its column profile and the analysis payload. Returns the "
        "full analysis so the caller can render a result page without a second request."
    ),
)
async def save_dataset(
    file: Annotated[UploadFile, File(description="CSV (.csv) or Excel (.xlsx, .xls) file")],
    name: Annotated[str, Form(description="Display name for the dataset")],
    auth: Annotated[AuthContext, Depends(require_auth)],
    product_column: Annotated[
        str | None, Form(description="Grouping column override")
    ] = None,
    value_column: Annotated[
        str | None, Form(description="Measure column override")
    ] = None,
    date_column: Annotated[str | None, Form(description="Date column override")] = None,
    sheet_name: Annotated[str | None, Form(description="Excel sheet to read")] = None,
    table: Annotated[str | None, Form(description="SQLite table to read")] = None,
) -> DatasetDetailResponse:
    content = await file.read()
    detail = library.save_dataset(
        name=name,
        content=content,
        filename=file.filename or "uploaded_data.csv",
        content_type=file.content_type or "application/octet-stream",
        product_column=product_column,
        value_column=value_column,
        date_column=date_column,
        sheet_name=sheet_name,
        table=table,
        user_id=auth.owner_id,
    )
    return DatasetDetailResponse(**detail)


@router.get(
    "/datasets",
    response_model=DatasetListResponse,
    summary="List Saved Datasets",
    description=(
        "Datasets newest first. Returns an empty list with "
        "`persistence_available: false` when no database is reachable, so the client "
        "can distinguish 'nothing saved' from 'saving is switched off'."
    ),
)
async def list_datasets(
    auth: Annotated[AuthContext, Depends(require_auth)],
    search: str | None = Query(default=None, description="Filter by dataset or file name"),
    limit: int = Query(default=100, ge=1, le=MAX_LIBRARY_PAGE, description="Maximum rows"),
) -> DatasetListResponse:
    return DatasetListResponse(
        **library.list_datasets(user_id=auth.owner_id, search=search, limit=limit)
    )


@router.get(
    "/datasets/{dataset_id}",
    response_model=DatasetDetailResponse,
    summary="Open a Saved Dataset",
    description=(
        "The dataset's cached analysis payload and a capped row preview, so a saved "
        "dataset can be re-opened without re-uploading or re-processing the file."
    ),
    responses={404: {"description": "No dataset with that id"}},
)
async def get_dataset(
    dataset_id: str,
    auth: Annotated[AuthContext, Depends(require_auth)],
) -> DatasetDetailResponse:
    detail = library.get_dataset(dataset_id, user_id=auth.owner_id)
    if detail is None:
        status_info = library.library_status()
        if not status_info.available:
            raise library.PersistenceUnavailableError(status_info.reason)
        raise AppException(
            message="That dataset does not exist.",
            code="dataset_not_found",
            hint="It may have been deleted. Upload the file again.",
            status_code=404,
        )
    return DatasetDetailResponse(**detail)


@router.patch(
    "/datasets/{dataset_id}",
    response_model=DatasetSummaryResponse,
    summary="Rename a Dataset",
    description="Changes the display name only. The stored file and its analysis are untouched.",
)
async def rename_dataset(
    dataset_id: str,
    body: RenameDatasetRequest,
    auth: Annotated[AuthContext, Depends(require_auth)],
) -> DatasetSummaryResponse:
    summary = library.rename_dataset(dataset_id, body.name, user_id=auth.owner_id)
    return DatasetSummaryResponse(**summary)


@router.post(
    "/datasets/{dataset_id}/analyze",
    response_model=DatasetDetailResponse,
    summary="Re-analyse a Saved Dataset",
    description=(
        "Re-runs the analysis over the stored bytes, optionally with different column "
        "choices. If the stored file is no longer available the last saved analysis is "
        "returned with `reanalyzed: false` and an explanation, rather than an error."
    ),
)
async def reanalyze_dataset(
    dataset_id: str,
    auth: Annotated[AuthContext, Depends(require_auth)],
    body: ReanalyzeDatasetRequest | None = None,
) -> DatasetDetailResponse:
    payload = body or ReanalyzeDatasetRequest()
    detail = library.reanalyze_dataset(
        dataset_id,
        product_column=payload.product_column,
        value_column=payload.value_column,
        date_column=payload.date_column,
        top_n=payload.top_n,
        user_id=auth.owner_id,
    )
    return DatasetDetailResponse(**detail)


@router.post(
    "/analyze-dataset",
    response_model=DatasetDetailResponse,
    summary="Analyse a Saved Dataset by Id",
    description=(
        "Analyses a stored dataset without re-uploading it. Distinct from "
        "`/datasets/{id}/analyze`, which also records a new analysis run; this one "
        "returns the existing payload."
    ),
)
async def analyze_saved_dataset(
    body: AnalyzeDatasetRequest,
    auth: Annotated[AuthContext, Depends(require_auth)],
) -> DatasetDetailResponse:
    detail = library.get_dataset(body.dataset_id, user_id=auth.owner_id)
    if detail is None:
        raise AppException(
            message="That dataset does not exist.",
            code="dataset_not_found",
            hint="Upload the file again, or check the dataset id.",
            status_code=404,
        )
    return DatasetDetailResponse(**detail)


@router.get(
    "/datasets/{dataset_id}/export",
    summary="Download a Saved Dataset's File",
    description=(
        "Returns the original bytes. This is the only route by which stored uploads "
        "leave the server: the storage directory is never mounted as static files, so "
        "an uploaded CSV cannot be fetched by guessing a key."
    ),
    responses={
        200: {"content": {"application/octet-stream": {}}, "description": "The stored file"},
        404: {"description": "Dataset or stored file is gone"},
    },
)
async def export_dataset(
    dataset_id: str,
    auth: Annotated[AuthContext, Depends(require_auth)],
) -> Response:
    content, content_type, filename = library.read_dataset_file(
        dataset_id, user_id=auth.owner_id
    )
    # RFC 5987 form, so a filename with non-ASCII characters survives the header.
    from urllib.parse import quote

    return Response(
        content=content,
        media_type=content_type or "application/octet-stream",
        headers={
            "Content-Disposition": (
                f"attachment; filename=\"{_ascii_stem(filename)}\"; "
                f"filename*=UTF-8''{quote(filename)}"
            )
        },
    )


@router.delete(
    "/datasets/{dataset_id}",
    summary="Delete a Saved Dataset",
    description=(
        "Removes the dataset, its analyses and its stored bytes. Succeeds even when the "
        "bytes were already gone, and reports which of the two happened so the UI can "
        "warn about a leftover object."
    ),
    responses={404: {"description": "No dataset with that id"}},
)
async def delete_dataset(
    dataset_id: str,
    auth: Annotated[AuthContext, Depends(require_auth)],
) -> dict[str, object]:
    return library.delete_dataset(dataset_id, user_id=auth.owner_id)


def _ascii_stem(filename: str) -> str:
    """A filename safe for the plain ``filename=`` header parameter."""
    safe = "".join(c if 32 < ord(c) < 127 and c not in '"\\' else "_" for c in filename)
    return safe or "dataset"


__all__ = ["SaveDatasetRequest", "router"]
