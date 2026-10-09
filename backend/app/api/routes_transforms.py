"""Data-quality transformation endpoints for saved datasets.

Two-step on purpose: ``preview`` reports the exact effect of the requested
operations on an in-memory copy and writes nothing; ``apply`` repeats the same
work only after an explicit ``confirm=true`` and records a new analysis entry.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends

from app.api.deps import AuthContext, require_auth
from app.schemas.library import TransformApplyRequest, TransformPreviewRequest
from app.services import transforms

router = APIRouter(tags=["Data Quality"])


@router.post(
    "/datasets/{dataset_id}/transform/preview",
    summary="Preview Data-Quality Corrections",
    description=(
        "Applies the requested operations to an in-memory copy of the stored file "
        "and reports what would change: affected rows per operation, before/after "
        "samples, and row totals. Nothing is written to disk or to the analysis "
        "history."
    ),
)
async def preview_transform(
    dataset_id: str,
    body: TransformPreviewRequest,
    auth: Annotated[AuthContext, Depends(require_auth)] = ...,
) -> dict[str, Any]:
    return transforms.preview_transform(
        dataset_id, body, user_id=auth.owner_id
    )


@router.post(
    "/datasets/{dataset_id}/transform",
    summary="Apply Confirmed Data-Quality Corrections",
    description=(
        "Applies the operations to a copy of the stored file, re-runs the analysis "
        "engine over it and saves the result as a new analysis entry. The stored "
        "file itself is never modified in place; the change is a new, reproducible "
        "analysis version."
    ),
)
async def apply_transform(
    dataset_id: str,
    body: TransformApplyRequest,
    auth: Annotated[AuthContext, Depends(require_auth)] = ...,
) -> dict[str, Any]:
    return transforms.apply_transform(
        dataset_id, body, user_id=auth.owner_id
    )


__all__ = ["router"]