"""Product ranking, ABC classification, Pareto analysis, and period-over-period growth."""

import re
from collections import Counter
from dataclasses import dataclass, field

import pandas as pd

from app.config import settings


@dataclass
class ProductRankItem:
    """Detailed ranking and ABC classification for a single product."""

    rank: int
    product: str
    value: float
    share_pct: float
    cumulative_pct: float
    abc_class: str


@dataclass
class ABCSummary:
    """Summary counts and value totals grouped by ABC classification."""

    class_a_count: int
    class_a_value: float
    class_a_share_pct: float

    class_b_count: int
    class_b_value: float
    class_b_share_pct: float

    class_c_count: int
    class_c_value: float
    class_c_share_pct: float


@dataclass
class RankingResult:
    """Complete product ranking and Pareto analysis results."""

    total_value: float
    product_count: int
    items: list[ProductRankItem]
    top_n: list[ProductRankItem]
    bottom_n: list[ProductRankItem]
    pareto_summary: str
    abc_summary: ABCSummary
    missing_value_rows_count: int = 0
    variants_merged_count: int = 0
    negative_value_products_count: int = 0


@dataclass
class ProductGrowthItem:
    """Month-over-month growth metrics for an individual product."""

    product: str
    previous_period: str
    latest_period: str
    previous_value: float
    latest_value: float
    change_pct: float
    direction: str  # "rising", "falling", "flat"


@dataclass
class GrowthResult:
    """Complete product growth analysis across latest time periods."""

    has_growth_data: bool
    previous_period: str | None = None
    latest_period: str | None = None
    items: list[ProductGrowthItem] = field(default_factory=list)
    warning: str | None = None


def normalize_product_name(name: object) -> str:
    """Collapse whitespace and convert to lowercase for deduplication."""
    if pd.isna(name) or name is None:
        return "Unknown"
    s = str(name).strip()
    s = re.sub(r"\s+", " ", s)
    return s.lower() if s else "Unknown"


def canonical_name_map(df: pd.DataFrame, product_col: str) -> tuple[pd.Series, dict[str, str], int]:
    """Map a product column onto its canonical spelling.

    Returns ``(normalised_key_series, normalised_key -> display_name, variants
    merged)``. The display name for a group is its most frequent spelling, so
    " macbook pro 16 " and "MacBook Pro 16" collapse onto the casing that
    actually appears most in the file.

    Shared by :func:`compute_ranking`, :func:`compute_growth` and the segment
    builder, so every surface groups by exactly the same set of products. If
    these disagreed, Products would list 15 rows while a chart of the same
    column showed 48 groups.
    """
    raw = df[product_col].fillna("Unknown").astype(str).str.strip()
    norm = raw.apply(normalize_product_name)

    # Group the *raw* spellings by the normalised key, so each group holds every
    # casing that appeared rather than the lowercase form repeated.
    grouped = pd.DataFrame({"_key": norm.to_numpy(), "_raw": raw.to_numpy()}).groupby("_key")[
        "_raw"
    ].apply(list)

    canonical: dict[str, str] = {}
    variants_merged = 0
    for norm_key, raw_list in grouped.items():
        counts = Counter(raw_list)
        canonical[norm_key] = counts.most_common(1)[0][0]
        if len(counts) > 1:
            variants_merged += len(counts) - 1

    return norm, canonical, variants_merged


def compute_ranking(
    df: pd.DataFrame,
    product_col: str,
    value_col: str,
    top_n_count: int | None = None,
    a_threshold: float | None = None,
    b_threshold: float | None = None,
) -> RankingResult:
    """Compute product rankings, ABC classes, and Pareto summary."""
    n_limit = top_n_count if top_n_count is not None else settings.default_top_n
    n_limit = max(1, min(n_limit, settings.max_top_n))

    thresh_a = a_threshold if a_threshold is not None else settings.abc_a_threshold
    thresh_b = b_threshold if b_threshold is not None else settings.abc_b_threshold

    working_df = df.copy()

    # Track missing values
    missing_val_mask = working_df[value_col].isna()
    missing_val_rows = int(missing_val_mask.sum())

    # Fill NaN values with 0.0 for aggregation
    working_df[value_col] = pd.to_numeric(working_df[value_col], errors="coerce").fillna(0.0)

    # Clean product names and resolve canonical casing
    norm_series, canonical_names, variants_merged_count = canonical_name_map(
        working_df, product_col
    )
    working_df["_norm_prod"] = norm_series

    # Group by normalized product and sum values
    aggregated = working_df.groupby("_norm_prod", as_index=False)[value_col].sum()
    aggregated["product"] = aggregated["_norm_prod"].map(canonical_names)

    # Sort descending by value, then ascending alphabetically by product name
    aggregated = aggregated.sort_values(
        by=[value_col, "product"],
        ascending=[False, True],
    ).reset_index(drop=True)

    total_value = float(aggregated[value_col].sum())
    product_count = len(aggregated)

    items: list[ProductRankItem] = []
    cum_pct = 0.0
    neg_count = 0

    class_a_items: list[ProductRankItem] = []
    class_b_items: list[ProductRankItem] = []
    class_c_items: list[ProductRankItem] = []

    for rank_idx, row in enumerate(aggregated.itertuples(), start=1):
        val = float(getattr(row, value_col))
        prod_name = row.product

        if val < 0:
            neg_count += 1

        if total_value > 0:
            share = (val / total_value) * 100.0
            cum_pct = min(100.0, cum_pct + share)
        else:
            share = 0.0
            cum_pct = 0.0

        # ABC Classification (Inclusive <= thresholds)
        if product_count == 1 or cum_pct <= thresh_a:
            abc_class = "A"
        elif cum_pct <= thresh_b:
            abc_class = "B"
        else:
            abc_class = "C"

        item = ProductRankItem(
            rank=rank_idx,
            product=prod_name,
            value=round(val, 2),
            share_pct=round(share, 2),
            cumulative_pct=round(cum_pct, 2),
            abc_class=abc_class,
        )
        items.append(item)

        if abc_class == "A":
            class_a_items.append(item)
        elif abc_class == "B":
            class_b_items.append(item)
        else:
            class_c_items.append(item)

    # Count products generating ~80% of value
    products_to_80 = 0
    for idx, it in enumerate(items, 1):
        if it.cumulative_pct >= thresh_a:
            products_to_80 = idx
            break
    if products_to_80 == 0:
        products_to_80 = len(class_a_items) or (1 if product_count > 0 else 0)

    pareto_pct = (products_to_80 / product_count * 100.0) if product_count > 0 else 0.0
    pareto_summary = (
        f"{products_to_80} of {product_count} products ({pareto_pct:.1f}%) "
        f"generate {thresh_a:g}% of the value"
    )

    # ABC Summary calculation
    def calc_group_stats(group_items: list[ProductRankItem]) -> tuple[int, float, float]:
        cnt = len(group_items)
        grp_val = sum(i.value for i in group_items)
        grp_share = (grp_val / total_value * 100.0) if total_value > 0 else 0.0
        return cnt, round(grp_val, 2), round(grp_share, 2)

    a_cnt, a_val, a_share = calc_group_stats(class_a_items)
    b_cnt, b_val, b_share = calc_group_stats(class_b_items)
    c_cnt, c_val, c_share = calc_group_stats(class_c_items)

    abc_summary = ABCSummary(
        class_a_count=a_cnt,
        class_a_value=a_val,
        class_a_share_pct=a_share,
        class_b_count=b_cnt,
        class_b_value=b_val,
        class_b_share_pct=b_share,
        class_c_count=c_cnt,
        class_c_value=c_val,
        class_c_share_pct=c_share,
    )

    actual_n = min(n_limit, product_count)
    top_items = items[:actual_n]
    bottom_items = items[-actual_n:] if product_count > 0 else []

    return RankingResult(
        total_value=round(total_value, 2),
        product_count=product_count,
        items=items,
        top_n=top_items,
        bottom_n=bottom_items,
        pareto_summary=pareto_summary,
        abc_summary=abc_summary,
        missing_value_rows_count=missing_val_rows,
        variants_merged_count=variants_merged_count,
        negative_value_products_count=neg_count,
    )


def compute_growth(
    df: pd.DataFrame,
    product_col: str,
    value_col: str,
    date_col: str | None,
) -> GrowthResult:
    """Compute period-over-period monthly growth for all products.

    Uses the same canonical product name normalization as compute_ranking
    so that case/whitespace variants of a product name are merged before
    period-over-period aggregation.
    """
    if not date_col or date_col not in df.columns:
        return GrowthResult(
            has_growth_data=False,
            warning="No date column detected or specified for growth analysis.",
        )

    # 1. Drop rows with no readable date, then canonicalize product names using
    #    the same mapping as compute_ranking.
    working_df = df.dropna(subset=[date_col]).copy()
    if len(working_df) == 0:
        return GrowthResult(
            has_growth_data=False,
            warning="Date column contains no valid timestamps.",
        )

    norm_series, canonical_names, _variants = canonical_name_map(working_df, product_col)
    working_df["_norm_prod"] = norm_series

    # Format period as YYYY-MM
    try:
        working_df["_period"] = pd.to_datetime(
            working_df[date_col],
            errors="coerce",
        ).dt.to_period("M").astype(str)
    except Exception:
        return GrowthResult(
            has_growth_data=False,
            warning="Could not parse dates into monthly periods.",
        )

    working_df = working_df[working_df["_period"] != "NaT"]
    periods = sorted(working_df["_period"].unique())

    if len(periods) < 2:
        return GrowthResult(
            has_growth_data=False,
            warning=(
                "Insufficient date range to calculate period-over-period growth "
                "(need at least 2 distinct months)."
            ),
        )

    prev_period = periods[-2]
    curr_period = periods[-1]

    # Apply canonical product name
    working_df["product"] = working_df["_norm_prod"].map(canonical_names)

    # Filter to the two comparison periods
    p_df = working_df[working_df["_period"].isin([prev_period, curr_period])]

    # Get all unique canonical product names
    all_products = sorted(working_df["product"].dropna().unique())

    # Group by canonical product and period
    grouped = p_df.groupby(["product", "_period"])[value_col].sum().unstack(fill_value=0.0)

    growth_items: list[ProductGrowthItem] = []
    for prod_name in all_products:
        has_entry = prod_name in grouped.index
        has_prev = has_entry and prev_period in grouped.columns
        has_curr = has_entry and curr_period in grouped.columns
        prev_val = float(grouped.loc[prod_name, prev_period]) if has_prev else 0.0
        curr_val = float(grouped.loc[prod_name, curr_period]) if has_curr else 0.0

        if prev_val == 0.0 and curr_val == 0.0:
            change_pct = 0.0
            direction = "flat"
        elif prev_val == 0.0:
            change_pct = 100.0
            direction = "rising"
        elif curr_val == 0.0:
            change_pct = -100.0
            direction = "falling"
        else:
            change_pct = round(((curr_val - prev_val) / abs(prev_val)) * 100.0, 2)
            if change_pct > 0.01:
                direction = "rising"
            elif change_pct < -0.01:
                direction = "falling"
            else:
                direction = "flat"

        growth_items.append(
            ProductGrowthItem(
                product=prod_name,
                previous_period=prev_period,
                latest_period=curr_period,
                previous_value=round(prev_val, 2),
                latest_value=round(curr_val, 2),
                change_pct=change_pct,
                direction=direction,
            )
        )

    # Sort items by latest value descending, then product name
    growth_items.sort(key=lambda x: (x.latest_value, x.previous_value), reverse=True)

    return GrowthResult(
        has_growth_data=True,
        previous_period=prev_period,
        latest_period=curr_period,
        items=growth_items,
        warning=None,
    )
