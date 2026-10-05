"""The deterministic analysis pipeline, in one place.

Every path into Datalens runs through :func:`run_analysis`: the upload
endpoint, re-analysing a saved dataset, and dataset comparison. Keeping it here
means there is exactly one definition of what a Datalens analysis *is*, so the
dashboard, the library, a re-opened dataset and a report can never disagree
about a number.

The pipeline is deliberately sequential and explicit rather than clever:

1. load  → 2. clean → 3. profile → 4. detect columns → 5. rank + classify
→ 6. period growth → 7. chart data → 8. dataset kind, shape and chart
recommendations → 9. segments → 10. quality issues → 11. anomalies

Steps 8-11 are additive and cannot change the figures in 1-7, so a regression in
them cannot alter an existing result.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

import pandas as pd

from app.config import settings
from app.core.errors import UnprocessableDataError
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
from app.schemas.extensions import (
    AnomalyResponse,
    AnomalySummaryResponse,
    ChartRecommendationResponse,
    ColumnRoleResponse,
    DatasetKindResponse,
    QualityIssueResponse,
    SegmentResponse,
    ShapeResponse,
)
from app.services import recommendations as rec
from app.services.anomalies import detect_anomalies
from app.services.charts import generate_charts
from app.services.cleaner import clean_dataset
from app.services.detector import detect_columns
from app.services.profiler import profile_dataset
from app.services.quality_issues import (
    SEVERITY_CRITICAL,
    SEVERITY_INFO,
    SEVERITY_WARNING,
    build_quality_issues,
)
from app.services.ranking import canonical_name_map, compute_growth, compute_ranking

#: Rows kept in the preview stored alongside an analysis, so a saved dataset can
#: be explored without re-reading the file. Deliberately small.
PREVIEW_ROWS = 200

#: Above this the preview is not stored at all: it would bloat the database and
#: a saved dataset that large should be re-read rather than trusted to a copy.
PREVIEW_MAX_ROWS = 5000


@dataclass
class PipelineResult:
    """An analysis plus the intermediates other features need.

    Keeping the frames and services here is what lets the dataset library store
    a preview and an explorer page without re-running the pipeline.
    """

    response: AnalysisResponse
    #: The frame after cleaning, before column detection (no derived columns).
    cleaned_df: pd.DataFrame
    #: The frame after detection, including any derived value column.
    detected_df: pd.DataFrame
    #: A small sample of rows, for the explorer on a re-opened dataset.
    preview_rows: list[list[Any]]
    preview_total_rows: int
    preview_truncated: bool
    warnings: list[str]


def analyze_bytes(
    content: bytes,
    *,
    filename: str,
    product_column: str | None = None,
    value_column: str | None = None,
    date_column: str | None = None,
    top_n: int | None = None,
    sheet_name: str | None = None,
    table: str | None = None,
) -> PipelineResult:
    """Load raw bytes and run the whole pipeline over them."""
    loaded = load_file(
        content,
        filename=filename,
        options=LoadOptions(sheet=sheet_name, table=table),
    )
    return run_analysis(
        loaded.df,
        filename=filename,
        product_column=product_column,
        value_column=value_column,
        date_column=date_column,
        top_n=top_n,
        sheet_name=loaded.metadata.sheet_name or loaded.metadata.table_name,
        delimiter=loaded.metadata.delimiter,
        load_warnings=list(loaded.warnings),
        rows_reported=loaded.metadata.rows,
        columns_reported=loaded.metadata.columns,
    )


def run_analysis(
    df: pd.DataFrame,
    *,
    filename: str,
    product_column: str | None = None,
    value_column: str | None = None,
    date_column: str | None = None,
    top_n: int | None = None,
    sheet_name: str | None = None,
    delimiter: str | None = None,
    load_warnings: list[str] | None = None,
    rows_reported: int | None = None,
    columns_reported: int | None = None,
) -> PipelineResult:
    """Run every stage over an already-loaded frame."""
    start_time = time.perf_counter()
    effective_top_n = top_n if top_n is not None else settings.default_top_n
    effective_top_n = max(1, min(int(effective_top_n), settings.max_top_n))

    # --- 2. clean -------------------------------------------------------------
    cleaned_df, cleaning_report = clean_dataset(df)

    # --- 3. profile -----------------------------------------------------------
    profile = profile_dataset(cleaned_df)

    # --- 4. detect columns ----------------------------------------------------
    detected_df, selection = detect_columns(
        cleaned_df,
        product_override=product_column,
        value_override=value_column,
        date_override=date_column,
    )

    # --- 5. ranking and ABC ---------------------------------------------------
    ranking_res = compute_ranking(
        detected_df,
        product_col=selection.product_column,
        value_col=selection.value_column,
        top_n_count=effective_top_n,
        a_threshold=settings.abc_a_threshold,
        b_threshold=settings.abc_b_threshold,
    )

    # --- 6. period growth -----------------------------------------------------
    growth_res = compute_growth(
        detected_df,
        product_col=selection.product_column,
        value_col=selection.value_column,
        date_col=selection.date_column,
    )

    # --- 7. chart data --------------------------------------------------------
    charts_res = generate_charts(
        detected_df,
        ranking_result=ranking_res,
        value_col=selection.value_column,
        date_col=selection.date_column,
    )

    # --- 8. dataset kind, shape, chart recommendations -------------------------
    roles = rec.classify_columns(detected_df)
    kind = rec.detect_dataset_kind([str(c) for c in detected_df.columns])
    recommendations = rec.recommend_charts(
        roles,
        row_count=len(detected_df),
        preferred_measure=selection.value_column,
    )

    # --- 9. segments ----------------------------------------------------------
    # The grouping column is canonicalised the same way the ranking does, so a
    # breakdown of "Revenue by Product" lists the same 15 products Products does
    # rather than one row per casing variant.
    segments = rec.build_segments(
        detected_df,
        roles,
        selection.value_column,
        canonical_columns=_canonical_columns(detected_df, selection),
    )

    # --- warnings -------------------------------------------------------------
    warnings = _collect_warnings(
        load_warnings=load_warnings or [],
        cleaning_report=cleaning_report,
        ranking_res=ranking_res,
        growth_res=growth_res,
        selection=selection,
        segments=segments,
        roles=roles,
    )

    # --- 10. quality issues ---------------------------------------------------
    quality = QualityScoreResponse(
        score=profile.data_quality_score,
        status=_quality_status(profile.data_quality_score),
        duplicate_row_count=profile.duplicate_row_count,
        total_missing_cells=profile.total_missing_cells,
        description=_quality_description(profile.data_quality_score),
    )
    issues = build_quality_issues(
        cleaning=cleaning_report,
        profile=profile,
        quality=quality,
        rows=profile.row_count,
        warnings=warnings,
    )
    quality = quality.model_copy(
        update={
            "issues": [QualityIssueResponse(**i.to_dict()) for i in issues],
            "critical_count": sum(1 for i in issues if i.severity == SEVERITY_CRITICAL),
            "warning_count": sum(1 for i in issues if i.severity == SEVERITY_WARNING),
            "info_count": sum(1 for i in issues if i.severity == SEVERITY_INFO),
        }
    )

    # --- 11. anomalies --------------------------------------------------------
    anomaly_res = detect_anomalies(
        detected_df,
        value_column=selection.value_column,
        ranking_items=ranking_res.items,
        growth_items=growth_res.items,
        total_value=ranking_res.total_value,
    )

    processing_ms = round((time.perf_counter() - start_time) * 1000, 2)

    shape = rec.summarise_shape(roles, row_count=len(detected_df))

    response = AnalysisResponse(
        meta=MetaResponse(
            filename=filename,
            rows=rows_reported if rows_reported is not None else len(df),
            columns=columns_reported if columns_reported is not None else int(df.shape[1]),
            processing_ms=processing_ms,
            delimiter=delimiter,
            sheet_name=sheet_name,
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
                        [
                            ValueCountResponse(value=tv.value, count=tv.count)
                            for tv in c.top_values
                        ]
                        if c.top_values is not None
                        else None
                    ),
                )
                for c in profile.columns
            ],
        ),
        quality=quality,
        selection=_selection_response(selection),
        ranking=RankingResponse(
            total_value=ranking_res.total_value,
            product_count=ranking_res.product_count,
            items=[_rank_item(item) for item in ranking_res.items],
            top_n=[_rank_item(item) for item in ranking_res.top_n],
            bottom_n=[_rank_item(item) for item in ranking_res.bottom_n],
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
            segments=[
                SegmentResponse(
                    column=s.column,
                    measure=s.measure,
                    total=s.total,
                    row_count=s.row_count,
                    groups_total=s.groups_total,
                    truncated=s.truncated,
                    items=[
                        {
                            "label": i.label,
                            "value": round(i.value, 4),
                            "count": i.count,
                            "share_pct": round(i.share_pct, 2),
                        }
                        for i in s.items
                    ],
                )
                for s in segments
            ],
            recommendations=[
                ChartRecommendationResponse(**r.to_dict()) for r in recommendations
            ],
        ),
        dataset_kind=DatasetKindResponse(
            kind=kind,
            label=rec.KIND_LABELS.get(kind, rec.KIND_LABELS[rec.KIND_GENERIC]),
            meaning=rec.KIND_MEANING.get(kind, rec.KIND_MEANING[rec.KIND_GENERIC]),
            matched_keywords=rec.matched_keywords([str(c) for c in detected_df.columns], kind),
            confident=kind != rec.KIND_GENERIC,
        ),
        anomalies=AnomalySummaryResponse(
            detected=anomaly_res.detected,
            count=anomaly_res.count,
            items=[AnomalyResponse(**a.to_dict()) for a in anomaly_res.items],
            notes=list(anomaly_res.notes),
            rows_scanned=anomaly_res.rows_scanned,
            sampled=anomaly_res.sampled,
        ),
        shape=ShapeResponse(**shape),
        columns=[ColumnRoleResponse(**r.to_dict()) for r in roles],
        warnings=warnings,
    )

    return PipelineResult(
        response=response,
        cleaned_df=cleaned_df,
        detected_df=detected_df,
        preview_rows=_preview(detected_df),
        preview_total_rows=int(detected_df.shape[0]),
        # True whenever the preview is shorter than the dataset. The old form of
        # this excluded very large frames, which reported a 200-row sample of a
        # 200k-row dataset as complete — exactly backwards.
        preview_truncated=bool(detected_df.shape[0] > PREVIEW_ROWS),
        warnings=warnings,
    )


# --- helpers -------------------------------------------------------------------


def _canonical_columns(df: pd.DataFrame, selection: Any) -> dict[str, dict[str, str]]:
    """The grouping column's normalised-key → display-name mapping.

    Only the grouping column is canonicalised. Re-casing region or category
    values would change groups the reader can see in the raw file, which is a
    different and much more surprising transformation.
    """
    column = selection.product_column
    if not column or column not in df.columns:
        return {}
    try:
        _norm, mapping, _variants = canonical_name_map(df, column)
    except (TypeError, ValueError):  # pragma: no cover - defensive
        return {}
    return {column: mapping} if mapping else {}


def _rank_item(item: Any) -> ProductRankItemResponse:
    return ProductRankItemResponse(
        rank=item.rank,
        product=item.product,
        value=item.value,
        share_pct=item.share_pct,
        cumulative_pct=item.cumulative_pct,
        abc_class=item.abc_class,
    )


def _selection_response(selection: Any) -> ColumnSelectionResponse:
    def candidates(items: Any) -> list[ColumnCandidateResponse]:
        return [
            ColumnCandidateResponse(name=c.name, confidence=c.confidence, reason=c.reason)
            for c in (items or [])
        ]

    return ColumnSelectionResponse(
        product_column=selection.product_column,
        product_confidence=selection.product_confidence,
        product_candidates=candidates(selection.product_candidates),
        value_column=selection.value_column,
        value_confidence=selection.value_confidence,
        value_candidates=candidates(selection.value_candidates),
        date_column=selection.date_column,
        date_confidence=selection.date_confidence,
        date_candidates=candidates(selection.date_candidates),
        derived_revenue_created=selection.derived_revenue_created,
        notes=selection.notes,
    )


def _preview(df: pd.DataFrame) -> list[list[Any]]:
    """A small, JSON-safe sample of rows for a saved dataset.

    Values are coerced to plain JSON types: numpy scalars and ``NaT`` would
    otherwise serialise as ``NaN``, which is not valid JSON and breaks the
    strict parsers some clients use.
    """
    if df.empty or df.shape[0] > PREVIEW_MAX_ROWS:
        return []
    return [[_json_safe(v) for v in row] for row in df.head(PREVIEW_ROWS).itertuples(index=False)]


def _json_safe(value: Any) -> Any:
    """Coerce a single cell into something ``json.dumps`` accepts."""
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, str)):
        return value
    if isinstance(value, float):
        # NaN and infinity are not valid JSON.
        return value if value == value and abs(value) != float("inf") else None
    if pd.isna(value):
        return None
    try:
        item = getattr(value, "item", None)
        if callable(item):
            return _json_safe(item())
    except (TypeError, ValueError):  # pragma: no cover - defensive
        pass
    return str(value)


def _quality_status(score: float) -> str:
    if score >= 90.0:
        return "Excellent"
    if score >= 75.0:
        return "Good"
    if score >= 50.0:
        return "Fair"
    return "Poor"


def _quality_description(score: float) -> str:
    if score >= 90.0:
        return "High dataset integrity with negligible missing or duplicate records."
    if score >= 75.0:
        return "Good dataset quality with minor missing or duplicate values."
    if score >= 50.0:
        return (
            "Moderate data quality; several missing values or duplicate rows detected."
        )
    return "Low data quality score; significant missing data or duplicate entries."


def _collect_warnings(
    *,
    load_warnings: list[str],
    cleaning_report: Any,
    ranking_res: Any,
    growth_res: Any,
    selection: Any,
    segments: list[rec.Segment],
    roles: list[rec.ColumnRole],
) -> list[str]:
    """Every notice the analysis should surface, in a fixed order."""
    warnings: list[str] = list(load_warnings)

    def add(condition: bool, message: str) -> None:
        if condition:
            warnings.append(message)

    add(
        cleaning_report.rows_dropped > 0,
        f"Dropped {cleaning_report.rows_dropped} completely empty rows.",
    )
    add(
        cleaning_report.failed_numeric_conversions > 0,
        f"{cleaning_report.failed_numeric_conversions} cell values could not be parsed "
        "as numbers.",
    )
    add(
        cleaning_report.failed_date_conversions > 0,
        f"{cleaning_report.failed_date_conversions} date cells failed parsing and were "
        "treated as NaT. Those rows are excluded from the monthly trend and growth figures.",
    )
    add(
        ranking_res.variants_merged_count > 0,
        f"Merged {ranking_res.variants_merged_count} product name casing/spacing variants "
        "into canonical names.",
    )
    add(
        ranking_res.negative_value_products_count > 0,
        f"Found {ranking_res.negative_value_products_count} products with negative net values.",
    )
    add(
        ranking_res.missing_value_rows_count > 0,
        f"{ranking_res.missing_value_rows_count} rows had missing values in "
        f"'{selection.value_column}' (treated as 0.0).",
    )
    if growth_res.warning:
        warnings.append(growth_res.warning)
    warnings.extend(selection.notes)

    # Explain a dataset that produced no chart, rather than leaving the page blank.
    usable = [r for r in roles if r.role not in ("constant",)]
    if not segments and len(usable) <= 1:
        warnings.append(
            "This file has no column that can group rows, so no breakdown charts are "
            "available. Only whole-file figures can be reported."
        )
    return warnings


def require_rows(df: pd.DataFrame) -> None:
    """Raise the standard 422 when a frame has nothing in it."""
    if df.empty:
        raise UnprocessableDataError(
            "The file contained no usable rows.",
            hint="Check that the data starts in the first row after the header.",
        )
