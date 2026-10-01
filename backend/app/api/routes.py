"""FastAPI API routes definition including health check and data analysis endpoints."""

import time
from typing import Annotated

from fastapi import APIRouter, File, Form, UploadFile, status

from app.config import settings
from app.loaders import LoadOptions, load_file
from app.schemas.analysis import (
    ABCDistributionItemResponse,
    ABCSummaryResponse,
    AnalysisResponse,
    ChartsResponse,
    CleaningReportResponse,
    ColumnCandidateResponse,
    ColumnProfileResponse,
    ColumnSelectionResponse,
    DatasetProfileResponse,
    GrowthResponse,
    HistogramBucketResponse,
    MetaResponse,
    MonthlyTrendItemResponse,
    ParetoCurveItemResponse,
    ProductGrowthItemResponse,
    ProductRankItemResponse,
    QualityScoreResponse,
    RankingResponse,
    TopProductBarItemResponse,
    ValueCountResponse,
)
from app.services.charts import generate_charts
from app.services.cleaner import clean_dataset
from app.services.detector import detect_columns
from app.services.profiler import profile_dataset
from app.services.ranking import compute_growth, compute_ranking

router = APIRouter()

#: Versioned surface. Every endpoint is registered on both ``router`` (legacy,
#: unversioned alias kept until the frontend is switched) and ``v1_router``.
v1_router = APIRouter(prefix="/v1")


async def health_check() -> dict[str, str]:
    """Return health check status and API version."""
    return {"status": "ok", "version": settings.app_version}


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
    start_time = time.perf_counter()

    # Read uploaded file completely in memory
    content = await file.read()
    filename = file.filename or "uploaded_data.csv"

    # 1. Load tabular data safely into memory
    loaded = load_file(
        content,
        filename=filename,
        options=LoadOptions(sheet=sheet_name, table=table),
    )

    # 2. Clean data, parse numbers/dates, strip text, drop empty rows/cols
    cleaned_df, cleaning_report = clean_dataset(loaded.df)

    # 3. Profile dataset and per-column distributions
    profile = profile_dataset(cleaned_df)

    # 4. Detect product, value, and date columns (deriving revenue if quantity & price present)
    detected_df, selection = detect_columns(
        cleaned_df,
        product_override=product_column,
        value_override=value_column,
        date_override=date_column,
    )

    # 5. Compute ABC classification and Pareto ranking
    ranking_res = compute_ranking(
        detected_df,
        product_col=selection.product_column,
        value_col=selection.value_column,
        top_n_count=top_n,
        a_threshold=settings.abc_a_threshold,
        b_threshold=settings.abc_b_threshold,
    )

    # 6. Compute period-over-period growth
    growth_res = compute_growth(
        detected_df,
        product_col=selection.product_column,
        value_col=selection.value_column,
        date_col=selection.date_column,
    )

    # 7. Generate chart-ready JSON structures
    charts_res = generate_charts(
        detected_df,
        ranking_result=ranking_res,
        value_col=selection.value_column,
        date_col=selection.date_column,
    )

    processing_ms = round((time.perf_counter() - start_time) * 1000, 2)

    # Collect all warnings and notices
    warnings: list[str] = list(loaded.warnings)

    if cleaning_report.rows_dropped > 0:
        warnings.append(f"Dropped {cleaning_report.rows_dropped} completely empty rows.")

    if cleaning_report.failed_numeric_conversions > 0:
        warnings.append(
            f"{cleaning_report.failed_numeric_conversions} cell values could not be "
            "parsed as numbers."
        )

    if cleaning_report.failed_date_conversions > 0:
        warnings.append(
            f"{cleaning_report.failed_date_conversions} date cells failed parsing "
            "and were treated as NaT."
        )

    if ranking_res.variants_merged_count > 0:
        warnings.append(
            f"Merged {ranking_res.variants_merged_count} product name casing/spacing "
            "variants into canonical names."
        )

    if ranking_res.negative_value_products_count > 0:
        warnings.append(
            f"Found {ranking_res.negative_value_products_count} products with negative net values."
        )

    if ranking_res.missing_value_rows_count > 0:
        warnings.append(
            f"{ranking_res.missing_value_rows_count} rows had missing values in "
            f"'{selection.value_column}' (treated as 0.0)."
        )

    if growth_res.warning:
        warnings.append(growth_res.warning)

    warnings.extend(selection.notes)

    # Determine overall data quality status label
    score = profile.data_quality_score
    if score >= 90.0:
        quality_status = "Excellent"
        quality_desc = "High dataset integrity with negligible missing or duplicate records."
    elif score >= 75.0:
        quality_status = "Good"
        quality_desc = "Good dataset quality with minor missing or duplicate values."
    elif score >= 50.0:
        quality_status = "Fair"
        quality_desc = "Moderate data quality; several missing values or duplicate rows detected."
    else:
        quality_status = "Poor"
        quality_desc = "Low data quality score; significant missing data or duplicate entries."

    # Map internal dataclasses to Pydantic response models
    return AnalysisResponse(
        meta=MetaResponse(
            filename=filename,
            rows=loaded.metadata.rows,
            columns=loaded.metadata.columns,
            processing_ms=processing_ms,
            delimiter=loaded.metadata.delimiter,
            sheet_name=loaded.metadata.sheet_name or loaded.metadata.table_name,
        ),
        cleaning=CleaningReportResponse(
            rows_before=cleaning_report.rows_before,
            rows_after=cleaning_report.rows_after,
            rows_dropped=cleaning_report.rows_dropped,
            columns_dropped=cleaning_report.columns_dropped,
            conversions_performed=cleaning_report.conversions_performed,
            failed_numeric_conversions=cleaning_report.failed_numeric_conversions,
            failed_date_conversions=cleaning_report.failed_date_conversions,
            null_like_values_converted=cleaning_report.null_like_values_converted,
        ),
        profile=DatasetProfileResponse(
            row_count=profile.row_count,
            column_count=profile.column_count,
            duplicate_row_count=profile.duplicate_row_count,
            total_missing_cells=profile.total_missing_cells,
            data_quality_score=profile.data_quality_score,
            columns=[
                ColumnProfileResponse(
                    name=c.name,
                    detected_type=c.detected_type,
                    missing_count=c.missing_count,
                    missing_percent=c.missing_percent,
                    unique_count=c.unique_count,
                    sample_values=c.sample_values,
                    min=c.min,
                    max=c.max,
                    mean=c.mean,
                    median=c.median,
                    std=c.std,
                    top_values=(
                        [ValueCountResponse(value=tv.value, count=tv.count) for tv in c.top_values]
                        if c.top_values is not None
                        else None
                    ),
                )
                for c in profile.columns
            ],
        ),
        quality=QualityScoreResponse(
            score=profile.data_quality_score,
            status=quality_status,
            duplicate_row_count=profile.duplicate_row_count,
            total_missing_cells=profile.total_missing_cells,
            description=quality_desc,
        ),
        selection=ColumnSelectionResponse(
            product_column=selection.product_column,
            product_confidence=selection.product_confidence,
            product_candidates=[
                ColumnCandidateResponse(
                    name=cand.name,
                    confidence=cand.confidence,
                    reason=cand.reason,
                )
                for cand in selection.product_candidates
            ],
            value_column=selection.value_column,
            value_confidence=selection.value_confidence,
            value_candidates=[
                ColumnCandidateResponse(
                    name=cand.name,
                    confidence=cand.confidence,
                    reason=cand.reason,
                )
                for cand in selection.value_candidates
            ],
            date_column=selection.date_column,
            date_confidence=selection.date_confidence,
            date_candidates=[
                ColumnCandidateResponse(
                    name=cand.name,
                    confidence=cand.confidence,
                    reason=cand.reason,
                )
                for cand in selection.date_candidates
            ],
            derived_revenue_created=selection.derived_revenue_created,
            notes=selection.notes,
        ),
        ranking=RankingResponse(
            total_value=ranking_res.total_value,
            product_count=ranking_res.product_count,
            items=[
                ProductRankItemResponse(
                    rank=item.rank,
                    product=item.product,
                    value=item.value,
                    share_pct=item.share_pct,
                    cumulative_pct=item.cumulative_pct,
                    abc_class=item.abc_class,
                )
                for item in ranking_res.items
            ],
            top_n=[
                ProductRankItemResponse(
                    rank=item.rank,
                    product=item.product,
                    value=item.value,
                    share_pct=item.share_pct,
                    cumulative_pct=item.cumulative_pct,
                    abc_class=item.abc_class,
                )
                for item in ranking_res.top_n
            ],
            bottom_n=[
                ProductRankItemResponse(
                    rank=item.rank,
                    product=item.product,
                    value=item.value,
                    share_pct=item.share_pct,
                    cumulative_pct=item.cumulative_pct,
                    abc_class=item.abc_class,
                )
                for item in ranking_res.bottom_n
            ],
            pareto_summary=ranking_res.pareto_summary,
            abc_summary=ABCSummaryResponse(
                class_a_count=ranking_res.abc_summary.class_a_count,
                class_a_value=ranking_res.abc_summary.class_a_value,
                class_a_share_pct=ranking_res.abc_summary.class_a_share_pct,
                class_b_count=ranking_res.abc_summary.class_b_count,
                class_b_value=ranking_res.abc_summary.class_b_value,
                class_b_share_pct=ranking_res.abc_summary.class_b_share_pct,
                class_c_count=ranking_res.abc_summary.class_c_count,
                class_c_value=ranking_res.abc_summary.class_c_value,
                class_c_share_pct=ranking_res.abc_summary.class_c_share_pct,
            ),
            missing_value_rows_count=ranking_res.missing_value_rows_count,
            variants_merged_count=ranking_res.variants_merged_count,
            negative_value_products_count=ranking_res.negative_value_products_count,
        ),
        growth=GrowthResponse(
            has_growth_data=growth_res.has_growth_data,
            previous_period=growth_res.previous_period,
            latest_period=growth_res.latest_period,
            items=[
                ProductGrowthItemResponse(
                    product=gi.product,
                    previous_period=gi.previous_period,
                    latest_period=gi.latest_period,
                    previous_value=gi.previous_value,
                    latest_value=gi.latest_value,
                    change_pct=gi.change_pct,
                    direction=gi.direction,
                )
                for gi in growth_res.items
            ],
            warning=growth_res.warning,
        ),
        charts=ChartsResponse(
            top_products_bar=[
                TopProductBarItemResponse(product=tp.product, value=tp.value)
                for tp in charts_res.top_products_bar
            ],
            pareto_curve=[
                ParetoCurveItemResponse(
                    product=pc.product,
                    value=pc.value,
                    cumulative_pct=pc.cumulative_pct,
                )
                for pc in charts_res.pareto_curve
            ],
            abc_distribution=[
                ABCDistributionItemResponse(
                    abc_class=ad.abc_class,
                    product_count=ad.product_count,
                    value=ad.value,
                    value_share_pct=ad.value_share_pct,
                )
                for ad in charts_res.abc_distribution
            ],
            monthly_trend=[
                MonthlyTrendItemResponse(month=mt.month, value=mt.value)
                for mt in charts_res.monthly_trend
            ],
            value_histogram=[
                HistogramBucketResponse(
                    bucket_min=hb.bucket_min,
                    bucket_max=hb.bucket_max,
                    label=hb.label,
                    count=hb.count,
                )
                for hb in charts_res.value_histogram
            ],
        ),
        warnings=warnings,
    )


# --- route registration ------------------------------------------------------
#
# Endpoints are defined once above and registered on two routers: the versioned
# ``/v1`` surface and the unversioned alias kept for backwards compatibility.
# Registering the *same* handler object twice means one implementation, two
# OpenAPI entries, and no risk of the two drifting apart.

_HEALTH_ROUTE = {
    "summary": "Health Check",
    "description": "Returns the health status and current version of the API.",
    "tags": ["System"],
    "deprecated": False,
}

_ANALYZE_ROUTE = {
    "response_model": AnalysisResponse,
    "status_code": status.HTTP_200_OK,
    "summary": "Analyze Sales & Product Data",
    "description": (
        "Upload a tabular file to generate in-memory data profiling, "
        "ABC/Pareto product ranking, period growth trends, and chart-ready JSON."
    ),
    "tags": ["Analysis"],
}

for _api_router in (router, v1_router):
    _api_router.add_api_route("/health", health_check, methods=["GET"], **_HEALTH_ROUTE)
    _api_router.add_api_route("/analyze", analyze_data, methods=["POST"], **_ANALYZE_ROUTE)
