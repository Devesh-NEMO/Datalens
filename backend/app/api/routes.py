"""System and analysis endpoints.

The analysis endpoint is a thin adapter: read the upload, hand it to
:mod:`app.services.pipeline`, return the result. All the logic lives in the
pipeline so that uploads, saved datasets and comparisons share one definition of
an analysis.

This module declares a prefix-free :data:`router`; :mod:`app.api` mounts it on
both the versioned ``/v1`` surface and the unversioned alias from the same
handler objects, so the two cannot drift apart.
"""

from typing import Annotated

from fastapi import APIRouter, File, Form, UploadFile, status

from app.config import settings
from app.schemas.analysis import AnalysisResponse
from app.services.pipeline import analyze_bytes

router = APIRouter()


async def health_check() -> dict[str, object]:
    """Liveness plus which optional capabilities are actually available.

    Every optional subsystem reports honestly rather than being assumed present,
    because the frontend shows different UI depending on these.
    """
    from app.db import probe as db_probe
    from app.services.ai import ai_status
    from app.storage import get_storage_provider

    storage_ok, storage_detail = True, "local"
    try:
        storage_ok = get_storage_provider() is not None
    except Exception as exc:  # noqa: BLE001 - never fail health on this
        storage_ok, storage_detail = False, type(exc).__name__

    database_ok, database_detail = db_probe()
    ai = ai_status()

    return {
        "status": "ok",
        "version": settings.app_version,
        "app_name": settings.app_name,
        "capabilities": {
            "database": {
                "available": database_ok,
                "detail": database_detail
                or ("SQLite (development)" if settings.is_sqlite else "PostgreSQL"),
                "required": False,
            },
            "storage": {
                "available": storage_ok,
                "detail": storage_detail,
                "required": True,
            },
            "ai": {
                "available": ai.enabled,
                "configured": ai.configured,
                "detail": ai.provider,
                "required": False,
            },
            "auth": {
                "available": True,
                "detail": "enforced" if settings.auth_enabled else "optional",
                "required": False,
            },
        },
    }


async def analyze_data(
    file: Annotated[UploadFile, File(description="CSV (.csv) or Excel (.xlsx, .xls) file")],
    product_column: Annotated[
        str | None,
        Form(description="Optional override column name for product/item entity"),
    ] = None,
    value_column: Annotated[
        str | None,
        Form(description="Optional override column name for metric/revenue"),
    ] = None,
    date_column: Annotated[
        str | None,
        Form(description="Optional override column name for date/timestamp"),
    ] = None,
    top_n: Annotated[
        int,
        Form(
            description=f"Number of top and bottom ranked products (1 to {settings.max_top_n})",
            ge=1,
            le=settings.max_top_n,
        ),
    ] = settings.default_top_n,
    sheet_name: Annotated[
        str | None,
        Form(description="Optional specific sheet name for Excel/ODS workbooks"),
    ] = None,
    table: Annotated[
        str | None,
        Form(description="Optional table name for SQLite databases"),
    ] = None,
) -> AnalysisResponse:
    """Analyze uploaded dataset in memory and return complete profiling and ranking report."""
    content = await file.read()
    filename = file.filename or "uploaded_data.csv"

    result = analyze_bytes(
        content,
        filename=filename,
        product_column=product_column,
        value_column=value_column,
        date_column=date_column,
        top_n=top_n,
        sheet_name=sheet_name,
        table=table,
    )
    return result.response


router.add_api_route(
    "/health",
    health_check,
    methods=["GET"],
    summary="Health Check",
    description=(
        "Returns liveness, the API version, and which optional capabilities "
        "(database, storage, AI, auth) are currently available."
    ),
    tags=["System"],
)

router.add_api_route(
    "/analyze",
    analyze_data,
    methods=["POST"],
    response_model=AnalysisResponse,
    status_code=status.HTTP_200_OK,
    summary="Analyze a Dataset",
    description=(
        "Upload a tabular file to generate in-memory data profiling, ABC/Pareto ranking, "
        "period growth trends, dataset-kind detection, chart recommendations, potential "
        "anomalies, classified data-quality findings, and chart-ready JSON."
    ),
    tags=["Analysis"],
)
