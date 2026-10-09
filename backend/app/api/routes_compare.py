"""Dataset comparison endpoints.

The whole point of this module is that comparing two datasets is only meaningful
when they measure the same thing, and the interesting case is when they are not.
:mod:`app.services.compare` does the checking; this exposes it.

So the response has one shape for "here is the difference" and another for "these
cannot be compared", and the second one is *useful*: each reason names the field
at fault, explains what differs, and says what would make them comparable. A bare
``compatible: false`` would tell the reader nothing to act on.
"""

from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, UploadFile, status

from app.api.deps import AuthContext, require_auth
from app.core.errors import AppException
from app.schemas.library import CompareRequest
from app.services import library
from app.services.compare import compare_analyses
from app.services.compare_explainer import explain_comparison
from app.services.pipeline import analyze_bytes

logger = logging.getLogger("data_analyzer.api.compare")

router = APIRouter(tags=["Compare"])


def _comparison_payload(detail: dict[str, Any]) -> dict[str, Any]:
    """The cached analysis for a dataset, or a clear error if there is none."""
    payload = detail.get("analysis")
    if payload:
        return payload
    raise AppException(
        message=f"The analysis for '{detail.get('name', 'this dataset')}' is not available.",
        code="analysis_unavailable",
        hint="Re-analyse the dataset, or upload the file again, before comparing.",
        status_code=409,
    )


@router.post(
    "/compare",
    summary="Compare Two Saved Datasets",
    description=(
        "Diffs two saved datasets group by group, with absolute and percentage changes "
        "and a grew/fell/added/removed/flat classification. When the two cannot be "
        "compared the response carries `compatible: false` plus a specific reason and "
        "suggested fix for each one — a comparison that silently subtracted two "
        "incompatible numbers would look like an answer."
    ),
)
async def compare_datasets(
    body: CompareRequest,
    auth: Annotated[AuthContext, Depends(require_auth)],
) -> dict[str, Any]:
    baseline = library.get_dataset(body.baseline_id, user_id=auth.owner_id)
    if baseline is None:
        raise _missing(body.baseline_id, "baseline")
    comparison = library.get_dataset(body.comparison_id, user_id=auth.owner_id)
    if comparison is None:
        raise _missing(body.comparison_id, "comparison")
    if body.baseline_id == body.comparison_id:
        raise AppException(
            message="A dataset cannot be compared with itself.",
            code="compare_same_dataset",
            hint="Pick two different datasets to compare.",
            status_code=400,
        )

    result = compare_analyses(
        _comparison_payload(baseline),
        _comparison_payload(comparison),
        limit=body.limit,
    )
    return {
        **result.to_dict(),
        "baseline": _side(baseline),
        "comparison": _side(comparison),
        "explanation": explain_comparison(result.to_dict()),
    }


@router.post(
    "/compare/upload",
    summary="Compare a Saved Dataset with an Upload",
    description=(
        "The same comparison against a freshly uploaded file, for when the second "
        "dataset has not been saved. The upload is analysed but not stored."
    ),
)
async def compare_with_upload(
    baseline_id: Annotated[str, Form(description="Saved dataset to compare against")],
    file: Annotated[UploadFile, File(description="CSV (.csv) or Excel (.xlsx, .xls) file")],
    auth: Annotated[AuthContext, Depends(require_auth)],
    product_column: Annotated[str | None, Form(description="Grouping column override")] = None,
    value_column: Annotated[str | None, Form(description="Measure column override")] = None,
    date_column: Annotated[str | None, Form(description="Date column override")] = None,
    sheet_name: Annotated[str | None, Form(description="Excel sheet to read")] = None,
    table: Annotated[str | None, Form(description="SQLite table to read")] = None,
    limit: Annotated[
        int | None,
        Form(ge=1, le=500, description="Maximum groups to return in the ranked list"),
    ] = None,
) -> dict[str, Any]:
    baseline = library.get_dataset(baseline_id, user_id=auth.owner_id)
    if baseline is None:
        raise _missing(baseline_id, "baseline")

    content = await file.read()
    incoming = analyze_bytes(
        content,
        filename=file.filename or "uploaded_data.csv",
        product_column=product_column,
        value_column=value_column,
        date_column=date_column,
        sheet_name=sheet_name,
        table=table,
    )

    result = compare_analyses(
        _comparison_payload(baseline),
        incoming.response.model_dump(),
        limit=limit,
    )
    return {
        **result.to_dict(),
        "baseline": _side(baseline),
        "comparison": {
            "id": None,
            "name": file.filename or "Uploaded file",
            "stored": False,
            "row_count": incoming.response.profile.row_count,
            "column_count": len(incoming.response.profile.columns),
            "quality_score": incoming.response.quality.score,
            "dataset_kind": incoming.response.dataset_kind.kind,
            "latest_period": incoming.response.growth.latest_period,
        },
        "explanation": explain_comparison(result.to_dict()),
    }


def _missing(dataset_id: str, role: str) -> AppException:
    return AppException(
        message=f"The {role} dataset does not exist.",
        code="dataset_not_found",
        hint="Check the dataset id, or upload the file again.",
        status_code=status.HTTP_404_NOT_FOUND,
    )


def _side(detail: dict[str, Any]) -> dict[str, Any]:
    """Identify one side of the comparison in the response."""
    analysis = detail.get("analysis") or {}
    growth = analysis.get("growth") or {}
    return {
        "id": detail.get("id"),
        "name": detail.get("name"),
        "stored": True,
        "row_count": detail.get("row_count"),
        "column_count": detail.get("column_count"),
        "quality_score": detail.get("quality_score"),
        "dataset_kind": detail.get("dataset_kind"),
        "latest_period": growth.get("latest_period"),
    }


__all__ = ["router"]
