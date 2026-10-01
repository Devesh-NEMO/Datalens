"""Column detection service for identifying product, value, and date columns."""

import re
from dataclasses import dataclass, field

import pandas as pd

from app.core.errors import UnprocessableDataError

PRODUCT_KEYWORDS = [
    ("product", 0.95),
    ("item", 0.90),
    ("sku", 0.85),
    ("article", 0.80),
    ("title", 0.75),
    ("name", 0.70),
    ("category", 0.65),
    ("description", 0.60),
    ("type", 0.55),
    ("model", 0.50),
]

VALUE_KEYWORDS = [
    ("revenue", 0.95),
    ("sales", 0.90),
    ("amount", 0.85),
    ("total", 0.80),
    ("turnover", 0.75),
    ("profit", 0.70),
    ("net", 0.65),
    ("gross", 0.60),
    ("quantity", 0.55),
    ("price", 0.50),
    ("value", 0.45),
    ("cost", 0.40),
]

DATE_KEYWORDS = [
    ("date", 0.95),
    ("order_date", 0.95),
    ("timestamp", 0.90),
    ("created_at", 0.85),
    ("time", 0.80),
    ("period", 0.75),
    ("month", 0.60),
    ("day", 0.55),
    ("year", 0.50),
]

METRIC_KEYWORDS_SET = {
    "revenue",
    "sales",
    "price",
    "amount",
    "quantity",
    "cost",
    "total",
    "profit",
    "margin",
    "unit_price",
    "qty",
}


@dataclass
class ColumnCandidate:
    """A candidate column with associated detection confidence score."""

    name: str
    confidence: float
    reason: str


@dataclass
class ColumnSelection:
    """Selected target columns and alternative candidates."""

    product_column: str
    product_confidence: float
    product_candidates: list[ColumnCandidate]

    value_column: str
    value_confidence: float
    value_candidates: list[ColumnCandidate]

    date_column: str | None = None
    date_confidence: float | None = None
    date_candidates: list[ColumnCandidate] = field(default_factory=list)

    derived_revenue_created: bool = False
    notes: list[str] = field(default_factory=list)


def score_product_column(col: str, series: pd.Series) -> tuple[float, str]:
    """Calculate confidence score that a column represents the product/item entity."""
    col_lower = col.lower().strip()

    # Numeric or datetime columns are not product entities
    if pd.api.types.is_numeric_dtype(series) or pd.api.types.is_datetime64_any_dtype(series):
        return 0.0, "Non-text / numeric column"

    if any(
        m == col_lower or f"_{m}" in col_lower or f"{m}_" in col_lower
        for m in METRIC_KEYWORDS_SET
    ):
        return 0.0, "Identified as metric/value keyword"

    score = 0.2
    reasons = []
    matched_keyword = False

    for kw, weight in PRODUCT_KEYWORDS:
        if kw == col_lower:
            score = max(score, weight)
            reasons.append(f"Exact match on keyword '{kw}'")
            matched_keyword = True
            break
        if re.search(rf"\b{kw}\b", col_lower) or kw in col_lower:
            score = max(score, weight * 0.85)
            reasons.append(f"Name contains '{kw}'")
            matched_keyword = True
            break

    non_null = series.dropna()
    total_len = len(non_null)
    if total_len > 0:
        unique_ratio = non_null.nunique() / total_len
        is_explicit_id = (
            "order_id" in col_lower
            or "uuid" in col_lower
            or (col_lower.endswith("_id") and not matched_keyword)
        )
        if is_explicit_id:
            score = 0.05
            reasons.append("Row-level ID column")
        elif total_len > 20 and unique_ratio > 0.98 and not matched_keyword:
            score = 0.05
            reasons.append("High cardinality row-level ID")
        elif 0.01 <= unique_ratio <= 0.95:
            score = min(1.0, score + 0.05)
            reasons.append("Good grouping cardinality")

    reason_str = ", ".join(reasons) if reasons else "Categorical text column"
    return round(score, 2), reason_str


def score_value_column(col: str, series: pd.Series) -> tuple[float, str]:
    """Calculate confidence score that a column represents the numeric value/revenue metric."""
    col_lower = col.lower().strip()

    is_numeric = pd.api.types.is_numeric_dtype(series)
    if not is_numeric or pd.api.types.is_datetime64_any_dtype(series):
        return 0.0, "Non-numeric column"

    score = 0.3
    reasons = ["Numeric data type"]

    # Check keyword matches
    for kw, weight in VALUE_KEYWORDS:
        if kw == col_lower:
            score = max(score, weight)
            reasons.append(f"Exact match on keyword '{kw}'")
            break
        if re.search(rf"\b{kw}\b", col_lower) or kw in col_lower:
            score = max(score, weight * 0.85)
            reasons.append(f"Name contains '{kw}'")
            break

    non_null = series.dropna()
    if len(non_null) > 0 and (non_null > 0).all():
        score = min(1.0, score + 0.05)
        reasons.append("All positive values")

    return round(score, 2), ", ".join(reasons)


def score_date_column(col: str, series: pd.Series) -> tuple[float, str]:
    """Calculate confidence score that a column represents a date/time dimension."""
    col_lower = col.lower().strip()

    if pd.api.types.is_numeric_dtype(series):
        return 0.0, "Numeric column"

    if any(m in col_lower for m in METRIC_KEYWORDS_SET):
        return 0.0, "Metric/value column"

    is_dt = pd.api.types.is_datetime64_any_dtype(series)
    if not is_dt:
        return 0.0, "Non-datetime column"

    score = 0.80
    reasons = ["Parsed datetime type"]

    for kw, weight in DATE_KEYWORDS:
        if kw == col_lower:
            score = max(score, weight)
            reasons.append(f"Exact match on keyword '{kw}'")
            break
        if kw in col_lower:
            score = max(score, weight * 0.90)
            reasons.append(f"Name contains '{kw}'")
            break

    return round(score, 2), ", ".join(reasons)


def detect_columns(
    df: pd.DataFrame,
    product_override: str | None = None,
    value_override: str | None = None,
    date_override: str | None = None,
) -> tuple[pd.DataFrame, ColumnSelection]:
    """Detect or validate product, value, and date columns, deriving revenue if needed."""
    working_df = df.copy()
    available_cols = list(working_df.columns)
    derived_revenue = False
    notes: list[str] = []

    # 1. Check for quantity and price if no explicit value_override is given
    has_revenue_like = any(
        kw in c.lower() for c in available_cols for kw in ["revenue", "sales", "turnover", "total"]
    )
    if not has_revenue_like and not value_override:
        qty_col = next(
            (c for c in available_cols if "quantity" in c.lower() or "qty" in c.lower()),
            None,
        )
        price_col = next(
            (c for c in available_cols if "price" in c.lower() or "cost" in c.lower()),
            None,
        )

        if (
            qty_col
            and price_col
            and pd.api.types.is_numeric_dtype(working_df[qty_col])
            and pd.api.types.is_numeric_dtype(working_df[price_col])
        ):
            working_df["derived_revenue"] = working_df[qty_col] * working_df[price_col]
            available_cols.append("derived_revenue")
            derived_revenue = True
            notes.append(
                f"Derived revenue column created by multiplying '{qty_col}' * '{price_col}'."
            )

    # 2. Product column selection & candidates
    product_candidates: list[ColumnCandidate] = []
    for col in available_cols:
        conf, reason = score_product_column(col, working_df[col])
        if conf >= 0.20:
            product_candidates.append(ColumnCandidate(name=col, confidence=conf, reason=reason))

    product_candidates.sort(key=lambda c: c.confidence, reverse=True)

    if product_override:
        if product_override not in available_cols:
            raise UnprocessableDataError(
                message=f"Specified product_column '{product_override}' was not found in dataset.",
                hint=f"Available columns: {', '.join(available_cols)}",
            )
        chosen_product = product_override
        product_conf = 1.0
    elif product_candidates:
        chosen_product = product_candidates[0].name
        product_conf = product_candidates[0].confidence
    else:
        cols_str = ", ".join(available_cols)
        raise UnprocessableDataError(
            message="No suitable product column could be detected in the dataset.",
            hint=(
                "Please specify a product column manually using 'product_column'. "
                f"Found columns: {cols_str}"
            ),
        )

    # 3. Value column selection & candidates
    value_candidates: list[ColumnCandidate] = []
    for col in available_cols:
        conf, reason = score_value_column(col, working_df[col])
        if conf >= 0.20:
            value_candidates.append(ColumnCandidate(name=col, confidence=conf, reason=reason))

    value_candidates.sort(key=lambda c: c.confidence, reverse=True)

    if value_override:
        if value_override not in available_cols:
            raise UnprocessableDataError(
                message=f"Specified value_column '{value_override}' was not found in dataset.",
                hint=f"Available columns: {', '.join(available_cols)}",
            )
        if not pd.api.types.is_numeric_dtype(working_df[value_override]):
            raise UnprocessableDataError(
                message=f"Specified value_column '{value_override}' is not numeric.",
                hint="Please choose a numeric column for analysis.",
            )
        chosen_value = value_override
        value_conf = 1.0
    elif value_candidates:
        chosen_value = value_candidates[0].name
        value_conf = value_candidates[0].confidence
    else:
        cols_str = ", ".join(available_cols)
        raise UnprocessableDataError(
            message="No suitable numeric value or revenue column could be detected in the dataset.",
            hint=(
                "Please provide a numeric column or specify 'value_column'. "
                f"Found columns: {cols_str}"
            ),
        )

    # 4. Date column selection & candidates (optional)
    date_candidates: list[ColumnCandidate] = []
    for col in available_cols:
        conf, reason = score_date_column(col, working_df[col])
        if conf >= 0.40:
            date_candidates.append(ColumnCandidate(name=col, confidence=conf, reason=reason))

    date_candidates.sort(key=lambda c: c.confidence, reverse=True)

    chosen_date: str | None = None
    date_conf: float | None = None

    if date_override:
        if date_override not in available_cols:
            raise UnprocessableDataError(
                message=f"Specified date_column '{date_override}' was not found in dataset.",
                hint=f"Available columns: {', '.join(available_cols)}",
            )
        chosen_date = date_override
        date_conf = 1.0
    elif date_candidates:
        chosen_date = date_candidates[0].name
        date_conf = date_candidates[0].confidence

    selection = ColumnSelection(
        product_column=chosen_product,
        product_confidence=product_conf,
        product_candidates=product_candidates,
        value_column=chosen_value,
        value_confidence=value_conf,
        value_candidates=value_candidates,
        date_column=chosen_date,
        date_confidence=date_conf,
        date_candidates=date_candidates,
        derived_revenue_created=derived_revenue,
        notes=notes,
    )

    return working_df, selection
