"""Chart data preparation service generating JSON-ready structures."""

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from app.services.ranking import RankingResult


@dataclass
class TopProductBarItem:
    """Item for top products bar chart."""

    product: str
    value: float


@dataclass
class ParetoCurveItem:
    """Item for Pareto cumulative percentage curve."""

    product: str
    value: float
    cumulative_pct: float


@dataclass
class ABCDistributionItem:
    """Item for ABC breakdown pie/donut chart."""

    abc_class: str
    product_count: int
    value: float
    value_share_pct: float


@dataclass
class MonthlyTrendItem:
    """Item for chronological monthly revenue trend chart."""

    month: str
    value: float


@dataclass
class HistogramBucket:
    """Bucket item for metric value distribution histogram."""

    bucket_min: float
    bucket_max: float
    label: str
    count: int


@dataclass
class ChartDataResult:
    """All chart datasets formatted for frontend visualization."""

    top_products_bar: list[TopProductBarItem] = field(default_factory=list)
    pareto_curve: list[ParetoCurveItem] = field(default_factory=list)
    abc_distribution: list[ABCDistributionItem] = field(default_factory=list)
    monthly_trend: list[MonthlyTrendItem] = field(default_factory=list)
    value_histogram: list[HistogramBucket] = field(default_factory=list)


def build_value_histogram(series: pd.Series, num_buckets: int = 10) -> list[HistogramBucket]:
    """Generate 10-bucket histogram data from a numeric series."""
    clean_series = series.dropna()
    if len(clean_series) == 0:
        return []

    min_val = float(clean_series.min())
    max_val = float(clean_series.max())

    if min_val == max_val:
        return [
            HistogramBucket(
                bucket_min=round(min_val, 2),
                bucket_max=round(max_val, 2),
                label=f"{min_val:g}",
                count=len(clean_series),
            )
        ]

    counts, bin_edges = np.histogram(clean_series, bins=num_buckets)
    buckets: list[HistogramBucket] = []

    for i in range(len(counts)):
        b_min = round(float(bin_edges[i]), 2)
        b_max = round(float(bin_edges[i + 1]), 2)
        label = f"{b_min:g} - {b_max:g}"
        buckets.append(
            HistogramBucket(
                bucket_min=b_min,
                bucket_max=b_max,
                label=label,
                count=int(counts[i]),
            )
        )

    return buckets


def build_monthly_trend(
    df: pd.DataFrame,
    date_col: str | None,
    value_col: str,
) -> list[MonthlyTrendItem]:
    """Generate monthly aggregated trend series if a valid date column is present."""
    if not date_col or date_col not in df.columns or value_col not in df.columns:
        return []

    working = df.dropna(subset=[date_col, value_col]).copy()
    if len(working) == 0:
        return []

    try:
        working["month"] = pd.to_datetime(
            working[date_col],
            errors="coerce",
        ).dt.to_period("M").astype(str)
        valid = working[working["month"] != "NaT"]
        if len(valid) == 0:
            return []

        grouped = valid.groupby("month", as_index=False)[value_col].sum()
        grouped = grouped.sort_values(by="month").reset_index(drop=True)

        return [
            MonthlyTrendItem(
                month=str(row.month),
                value=round(float(getattr(row, value_col)), 2),
            )
            for row in grouped.itertuples()
        ]
    except Exception:
        return []


def generate_charts(
    df: pd.DataFrame,
    ranking_result: RankingResult,
    value_col: str,
    date_col: str | None = None,
) -> ChartDataResult:
    """Assemble all visualization-ready JSON datasets."""
    # 1. Top products bar (from ranking top_n)
    top_bar = [
        TopProductBarItem(product=item.product, value=item.value)
        for item in ranking_result.top_n
    ]

    # 2. Pareto curve
    pareto = [
        ParetoCurveItem(
            product=item.product,
            value=item.value,
            cumulative_pct=item.cumulative_pct,
        )
        for item in ranking_result.items
    ]

    # 3. ABC distribution
    abc_summary = ranking_result.abc_summary
    abc_dist = [
        ABCDistributionItem(
            abc_class="A",
            product_count=abc_summary.class_a_count,
            value=abc_summary.class_a_value,
            value_share_pct=abc_summary.class_a_share_pct,
        ),
        ABCDistributionItem(
            abc_class="B",
            product_count=abc_summary.class_b_count,
            value=abc_summary.class_b_value,
            value_share_pct=abc_summary.class_b_share_pct,
        ),
        ABCDistributionItem(
            abc_class="C",
            product_count=abc_summary.class_c_count,
            value=abc_summary.class_c_value,
            value_share_pct=abc_summary.class_c_share_pct,
        ),
    ]

    # 4. Monthly trend
    monthly_trend = build_monthly_trend(df, date_col, value_col)

    # 5. Value histogram (10 buckets)
    val_series = df[value_col] if value_col in df.columns else pd.Series(dtype=float)
    histogram = build_value_histogram(val_series, num_buckets=10)

    return ChartDataResult(
        top_products_bar=top_bar,
        pareto_curve=pareto,
        abc_distribution=abc_dist,
        monthly_trend=monthly_trend,
        value_histogram=histogram,
    )
