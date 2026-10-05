"""Dataset understanding: what kind of file this is, what can be grouped, and
which charts suit it.

The point of this module is that *nothing* here assumes the file is a sales
report. A file of marketing spend, headcount, stock levels or customer records
gets the same treatment: look at the columns that exist, work out which ones are
categorical and which are numeric, then recommend the charts that those columns
can honestly support.

Every recommendation carries a reason naming the columns it is based on, so the
UI never shows a chart the reader has to justify themselves.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

import pandas as pd

# --- dataset kinds -------------------------------------------------------------

KIND_SALES = "sales"
KIND_MARKETING = "marketing"
KIND_FINANCE = "finance"
KIND_INVENTORY = "inventory"
KIND_HR = "hr"
KIND_CUSTOMER = "customer"
KIND_GENERIC = "generic"

#: Column keyword sets per kind. A kind wins when it matches the most columns;
#: ties break on the order of this list, so the more specific reading wins.
_KIND_KEYWORDS: list[tuple[str, dict[str, float]]] = [
    (
        KIND_SALES,
        {
            "order": 3.0, "orders": 3.0, "sales": 3.0, "revenue": 3.0, "quantity": 2.0,
            "unit_price": 2.0, "sku": 2.0, "product": 1.5, "cart": 1.5, "invoice": 2.0,
            "transaction": 2.0, "gross": 1.5, "discount": 1.0,
        },
    ),
    (
        KIND_MARKETING,
        {
            "campaign": 3.0, "impressions": 3.0, "clicks": 2.5, "ctr": 2.5, "cpc": 2.0,
            "cpa": 2.0, "spend": 2.0, "ad": 1.0, "channel": 1.5, "leads": 2.0,
            "conversions": 2.0, "roas": 3.0, "engagement": 2.0, "bounce": 2.0,
        },
    ),
    (
        KIND_FINANCE,
        {
            "account": 2.0, "balance": 3.0, "debit": 3.0, "credit": 3.0, "ledger": 3.0,
            "journal": 2.5, "budget": 2.5, "forecast": 2.5, "expense": 2.5,
            "cashflow": 3.0, "ebitda": 3.0, "fiscal": 2.0, "gl": 1.5, "tax": 2.0,
        },
    ),
    (
        KIND_INVENTORY,
        {
            "stock": 3.0, "inventory": 3.0, "warehouse": 3.0, "sku": 2.0, "on_hand": 3.0,
            "reorder": 2.5, "backorder": 2.5, "supplier": 2.0, "lead_time": 2.0,
            "shelf": 2.0, "batch": 2.0, "bin": 1.5,
        },
    ),
    (
        KIND_HR,
        {
            "employee": 3.0, "headcount": 3.0, "staff": 2.5, "salary": 3.0, "hire": 2.0,
            "tenure": 2.5, "department": 2.0, "manager": 2.0, "attrition": 3.0,
            "performance": 1.5, "payroll": 3.0, "fte": 2.5, "role": 1.5,
        },
    ),
    (
        KIND_CUSTOMER,
        {
            "customer": 3.0, "client": 2.5, "account_id": 2.0, "churn": 3.0,
            "lifetime": 3.0, "ltv": 3.0, "retention": 3.0, "segment": 2.0,
            "cohort": 2.5, "signup": 2.0, "tenure_months": 2.0, "nps": 2.0, "signup_date": 2.0,
        },
    ),
]

KIND_LABELS = {
    KIND_SALES: "Sales / transactions",
    KIND_MARKETING: "Marketing performance",
    KIND_FINANCE: "Finance / accounting",
    KIND_INVENTORY: "Inventory / supply",
    KIND_HR: "People / HR",
    KIND_CUSTOMER: "Customers",
    KIND_GENERIC: "General tabular data",
}

#: How a dataset of each kind should be described in the UI.
KIND_MEANING = {
    KIND_SALES: (
        "Rows are individual transactions. Products are ranked by the value column and "
        "compared period over period."
    ),
    KIND_MARKETING: (
        "Rows are campaign or channel performance records. Channels are ranked by the "
        "measure you choose and compared period over period."
    ),
    KIND_FINANCE: (
        "Rows are accounting entries. Accounts are ranked by the measure you choose and "
        "compared period over period."
    ),
    KIND_INVENTORY: (
        "Rows are stock positions. Items are ranked by the measure you choose and "
        "compared period over period."
    ),
    KIND_HR: (
        "Rows are per-person or per-team records. Groups are ranked by the measure you "
        "choose and compared period over period."
    ),
    KIND_CUSTOMER: (
        "Rows are customer records. Customers are ranked by the measure you choose and "
        "compared period over period."
    ),
    KIND_GENERIC: (
        "Rows are records of unknown type. The first text column is treated as the group "
        "and the first numeric column as the measure — change both in Settings if that is "
        "wrong."
    ),
}

# --- chart types ---------------------------------------------------------------

CHART_BAR = "bar"
CHART_HORIZONTAL_BAR = "horizontal_bar"
CHART_LINE = "line"
CHART_AREA = "area"
CHART_PIE = "pie"
CHART_DONUT = "donut"
CHART_HISTOGRAM = "histogram"
CHART_SCATTER = "scatter"
CHART_PARETO = "pareto"
CHART_STACKED_BAR = "stacked_bar"

#: Beyond this many distinct values a column is an identifier, not a grouping, so
#: no chart that groups by it is offered.
MAX_CATEGORY_CARDINALITY = 60
#: Above this, even a histogram stops being readable.
MAX_HISTOGRAM_BUCKETS = 60

_SPLIT_WORDS = re.compile(r"[_\-.\s]+")


def _tokens(name: str) -> set[str]:
    """Split a column name into lowercase word tokens."""
    return {t for t in _SPLIT_WORDS.split(str(name).lower()) if t}


def _tokens_for_key(value: object) -> str:
    """Normalised grouping key for a cell, matching the ranking's own rule.

    Imported lazily so :mod:`app.services.recommendations` does not depend on
    :mod:`app.services.ranking` at import time — ranking imports nothing from
    here, and keeping the graph one-directional avoids a cycle.
    """
    from app.services.ranking import normalize_product_name

    return normalize_product_name(value)


def detect_dataset_kind(column_names: list[str]) -> str:
    """Guess what a dataset is about from its column names.

    Ties are broken by the order of ``_KIND_KEYWORDS``, so a file with both
    'order' and 'campaign' reads as sales (the earlier, more specific kind).
    """
    names = " ".join(str(n).lower() for n in column_names)
    tokens = set()
    for column in column_names:
        tokens |= _tokens(column)

    best_kind = KIND_GENERIC
    best_score = 0.0
    for kind, keywords in _KIND_KEYWORDS:
        score = 0.0
        for keyword, weight in keywords.items():
            if keyword in tokens or keyword in names:
                score += weight
        if score > best_score:
            best_kind = kind
            best_score = score
    return best_kind


def matched_keywords(column_names: list[str], kind: str) -> list[str]:
    """The keywords that led to ``kind``, for the "why" disclosure.

    Returns an empty list for the generic reading, because "no keyword matched"
    is the honest explanation and there is nothing to list.
    """
    keywords = next((k for k in _KIND_KEYWORDS if k[0] == kind), (kind, {}))[1]
    haystack = " ".join(str(n).lower() for n in column_names)
    tokens: set[str] = set()
    for column in column_names:
        tokens |= _tokens(column)

    hits = sorted(
        keyword
        for keyword in keywords
        if keyword in tokens or keyword in haystack
    )
    return hits


# --- column classification ------------------------------------------------------

TEXT = "text"
NUMERIC = "numeric"
DATE = "date"
BOOLEAN = "boolean"
CONSTANT = "constant"
IDENTIFIER = "identifier"

_DATE_HINTS = {"date", "time", "timestamp", "period", "month", "year", "day", "week", "quarter"}
_ID_HINTS = {"id", "code", "uuid", "key", "ref", "number", "no", "sku"}
_BOOL_HINTS = {"is", "has", "flag", "active", "enabled", "valid"}


@dataclass
class ColumnRole:
    """One column described in terms of what it can be *used* for."""

    name: str
    role: str
    dtype: str
    non_null: int
    unique: int
    missing_percent: float
    numeric: bool = False
    datetime: bool = False
    categorical: bool = False
    #: Longest label in characters. Drives the "names are too long for a vertical
    #: axis" caveat without needing the frame at recommendation time.
    longest_label: int = 0

    @property
    def is_usable_category(self) -> bool:
        return self.categorical and 1 < self.unique <= MAX_CATEGORY_CARDINALITY

    @property
    def is_numeric_measure(self) -> bool:
        return self.numeric and self.unique > 1

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "role": self.role,
            "dtype": self.dtype,
            "non_null": self.non_null,
            "unique": self.unique,
            "missing_percent": round(self.missing_percent, 2),
            "numeric": self.numeric,
            "datetime": self.datetime,
            "categorical": self.categorical,
            "longest_label": self.longest_label,
        }


def classify_columns(df: pd.DataFrame) -> list[ColumnRole]:
    """Describe every column's role: groupable, measurable, or neither."""
    rows = len(df)
    roles: list[ColumnRole] = []

    for column in df.columns:
        series = df[column]
        name = str(column)
        non_null = int(series.notna().sum())
        unique = int(series.nunique(dropna=True))
        missing_pct = (rows - non_null) / rows * 100.0 if rows else 0.0

        is_numeric = bool(pd.api.types.is_numeric_dtype(series)) and not bool(
            pd.api.types.is_bool_dtype(series)
        )
        is_datetime = bool(pd.api.types.is_datetime64_any_dtype(series))
        is_bool = bool(pd.api.types.is_bool_dtype(series))

        text = series.astype("string") if not is_numeric else None
        looks_like_date = False
        if text is not None and non_null:
            # A string column that parses as a date for most of its values is a
            # date column that cleaning could not convert — worth knowing about.
            sample = text.dropna().head(200)
            if not sample.empty:
                parsed = pd.to_datetime(sample, errors="coerce", format="mixed")
                looks_like_date = bool(parsed.notna().mean() > 0.9)

        tokens = _tokens(name)

        if unique == 0:
            role = CONSTANT
        elif is_datetime or looks_like_date:
            role = DATE
        elif is_numeric:
            role = NUMERIC
        elif is_bool or (tokens & _BOOL_HINTS) and unique <= 2:
            role = BOOLEAN
        elif unique == rows and rows > 5 and unique > MAX_CATEGORY_CARDINALITY:
            role = IDENTIFIER
        elif unique > MAX_CATEGORY_CARDINALITY and is_numeric:
            role = NUMERIC
        elif unique == 1:
            role = CONSTANT
        elif (tokens & _ID_HINTS) and unique > MAX_CATEGORY_CARDINALITY:
            role = IDENTIFIER
        elif looks_like_date or (tokens & _DATE_HINTS) and unique > MAX_CATEGORY_CARDINALITY:
            role = DATE
        else:
            role = TEXT

        roles.append(
            ColumnRole(
                name=name,
                role=role,
                dtype=str(series.dtype),
                non_null=non_null,
                unique=unique,
                missing_percent=missing_pct,
                numeric=is_numeric,
                datetime=is_datetime,
                categorical=role in (TEXT, BOOLEAN),
                longest_label=_longest_label(series, is_numeric),
            )
        )

    return roles


def _longest_label(series: pd.Series, is_numeric: bool) -> int:
    """Longest displayed label for a column, 0 when it has no text form."""
    if series.empty or is_numeric:
        return 0
    try:
        lengths = series.astype("string").dropna().str.len()
    except (TypeError, ValueError):
        return 0
    return int(lengths.max()) if not lengths.empty else 0


# --- segment breakdowns ---------------------------------------------------------

@dataclass
class SegmentItem:
    label: str
    value: float
    count: int
    share_pct: float


@dataclass
class Segment:
    """Totals for one groupable column, summed by one measure."""

    column: str
    measure: str
    total: float
    row_count: int
    items: list[SegmentItem] = field(default_factory=list)
    #: True when only the largest groups are shown and the rest are grouped.
    truncated: bool = False
    groups_total: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "column": self.column,
            "measure": self.measure,
            "total": round(self.total, 4),
            "row_count": self.row_count,
            "groups_total": self.groups_total,
            "truncated": self.truncated,
            "items": [
                {
                    "label": i.label,
                    "value": round(i.value, 4),
                    "count": i.count,
                    "share_pct": round(i.share_pct, 2),
                }
                for i in self.items
            ],
        }


def build_segments(
    df: pd.DataFrame,
    roles: list[ColumnRole],
    measure: str,
    *,
    max_items: int = 20,
    canonical_columns: dict[str, dict[str, str]] | None = None,
) -> list[Segment]:
    """Group by every usable categorical column, summed by ``measure``.

    Returns one :class:`Segment` per column, sorted by total descending, so a
    page can offer "break down by region / category / channel" without any
    per-dataset code.

    ``canonical_columns`` maps a column name to a normalised-key → display-name
    mapping, so the grouping column produces the same group count as the ranking
    does. Without it a file with " macbook pro 16 " and "MacBook Pro 16" would
    show two segments while the ranking showed one.
    """
    if measure not in df.columns:
        return []

    working = df
    canonical_columns = canonical_columns or {}
    if canonical_columns:
        # Never mutate the caller's frame; ranking and charts still read theirs.
        working = df.copy()
        for column, mapping in canonical_columns.items():
            if column not in working.columns or not mapping:
                continue
            keys = working[column].apply(_tokens_for_key)
            working[column] = keys.map(mapping).fillna(keys)

    numeric_measure = pd.to_numeric(working[measure], errors="coerce")
    segments: list[Segment] = []

    for role in roles:
        if not role.is_usable_category:
            continue

        grouped = working.assign(__value=numeric_measure).dropna(subset=[role.name])
        if grouped.empty:
            continue

        totals = grouped.groupby(role.name, dropna=True)["__value"].agg(["sum", "count"])
        totals = totals.sort_values("sum", ascending=False)
        grand_total = float(totals["sum"].sum())
        groups_total = int(len(totals))

        truncated = groups_total > max_items
        head = totals.head(max_items)
        if truncated:
            tail = totals.iloc[max_items:]
            head = pd.concat(
                [
                    head,
                    pd.DataFrame(
                        [{"sum": float(tail["sum"].sum()), "count": int(tail["count"].sum())}],
                        index=["Other"],
                    ),
                ]
            )

        items = [
            SegmentItem(
                label=str(label),
                value=float(row["sum"]),
                count=int(row["count"]),
                share_pct=(float(row["sum"]) / grand_total * 100.0) if grand_total else 0.0,
            )
            for label, row in head.iterrows()
        ]

        segments.append(
            Segment(
                column=role.name,
                measure=measure,
                total=grand_total,
                row_count=int(grouped.shape[0]),
                items=items,
                truncated=truncated,
                groups_total=groups_total,
            )
        )

    segments.sort(key=lambda s: (-len(s.items), s.column.lower()))
    return segments


# --- chart recommendations ------------------------------------------------------

@dataclass
class ChartRecommendation:
    """One suggested chart plus the reason it suits this dataset."""

    chart_type: str
    title: str
    reason: str
    #: Which column supplies the categories/x values.
    category_column: str | None = None
    #: Which column supplies the numbers/y values.
    measure_column: str | None = None
    #: Second category column, for stacked charts.
    second_category_column: str | None = None
    #: Ordering hint for the UI, lower first.
    priority: int = 50
    #: Small note when the chart is a weaker fit, e.g. very few rows.
    caveat: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "chart_type": self.chart_type,
            "title": self.title,
            "reason": self.reason,
            "category_column": self.category_column,
            "measure_column": self.measure_column,
            "second_category_column": self.second_category_column,
            "priority": self.priority,
            "caveat": self.caveat,
        }


def recommend_charts(
    roles: list[ColumnRole],
    *,
    row_count: int,
    preferred_measure: str | None = None,
) -> list[ChartRecommendation]:
    """Suggest charts from the columns actually present.

    Only combinations the file can support are returned. A dataset with one
    numeric column and no dates gets no line chart; a dataset with no usable
    categorical column gets no pie chart. The result is always safe to render.
    """
    recommendations: list[ChartRecommendation] = []

    dates = [r for r in roles if r.role == DATE and r.non_null > 1]
    numerics = [
        r for r in roles if r.role == NUMERIC and r.unique > 1 and r.non_null > 1
    ]
    categories = [r for r in roles if r.is_usable_category]

    measures = numerics
    if preferred_measure and any(r.name == preferred_measure for r in numerics):
        measures = sorted(
            numerics, key=lambda r: (r.name != preferred_measure, r.name.lower())
        )

    primary_measure = next((r.name for r in measures), None)

    if row_count < 3:
        return [
            ChartRecommendation(
                chart_type="table",
                title="Table view",
                reason=(
                    "This file has "
                    f"{row_count:,} row{'s' if row_count != 1 else ''}, which is too few for a "
                    "chart to show anything a table does not show better."
                ),
                priority=1,
            )
        ]

    # --- time series ----------------------------------------------------------
    for date_role in dates[:2]:
        for measure_role in measures[:1]:
            span_note = ""
            if date_role.unique <= 2:
                caveat = (
                    "Only two periods are present, so this is a comparison rather than a trend."
                )
            elif date_role.unique < 4:
                caveat = f"Only {date_role.unique} periods are present; the line will be short."
            else:
                caveat = None

            recommendations.append(
                ChartRecommendation(
                    chart_type=CHART_LINE,
                    title=f"{measure_role.name.replace('_', ' ').title()} over "
                    f"{date_role.name.replace('_', ' ').title()}",
                    reason=(
                        f"'{date_role.name}' holds {date_role.unique:,} distinct dates and "
                        f"'{measure_role.name}' is numeric, so the two form a time series"
                        f"{span_note}."
                    ),
                    category_column=date_role.name,
                    measure_column=measure_role.name,
                    priority=10,
                    caveat=caveat,
                )
            )
            recommendations.append(
                ChartRecommendation(
                    chart_type=CHART_AREA,
                    title=f"{measure_role.name.replace('_', ' ').title()} over time "
                    f"(filled)",
                    reason=(
                        "Same series as the line chart, with the area filled — easier to read "
                        "when the values stay above zero."
                    ),
                    category_column=date_role.name,
                    measure_column=measure_role.name,
                    priority=25,
                    caveat=caveat,
                )
            )

    # --- category vs measure --------------------------------------------------
    for category_role in categories[:6]:
        if primary_measure is None:
            break
        measure_role = next(r for r in measures if r.name == primary_measure)
        groups = category_role.unique
        longest_label = category_role.longest_label

        if groups <= 1:
            continue

        long_labels = bool(longest_label > 14)
        recommendations.append(
            ChartRecommendation(
                chart_type=CHART_HORIZONTAL_BAR,
                title=f"{measure_role.name.replace('_', ' ').title()} by "
                f"{category_role.name.replace('_', ' ').title()}",
                reason=(
                    f"'{category_role.name}' has {groups:,} distinct values, which reads better "
                    "side-on than standing up when names are long."
                ),
                category_column=category_role.name,
                measure_column=measure_role.name,
                priority=15 if groups > 4 else 30,
                caveat=(
                    f"The longest '{category_role.name}' label is {longest_label} characters, so "
                    "the axis is trimmed; the full names are in Products."
                    if long_labels
                    else None
                ),
            )
        )

        if 2 <= groups <= 8:
            recommendations.append(
                ChartRecommendation(
                    chart_type=CHART_DONUT,
                    title=f"Share of {measure_role.name.replace('_', ' ').lower()} by "
                    f"{category_role.name.replace('_', ' ').title()}",
                    reason=(
                        f"{groups} groups — few enough for the share to be readable as a single "
                        "shape, which answers 'where does it all go?' at a glance."
                    ),
                    category_column=category_role.name,
                    measure_column=measure_role.name,
                    priority=20,
                    caveat=(
                        "Shares are only meaningful if the groups do not overlap; check the "
                        "category definition."
                    ),
                )
            )

        recommendations.append(
            ChartRecommendation(
                chart_type=CHART_PARETO,
                title=f"Pareto of {measure_role.name.replace('_', ' ').title()} by "
                f"{category_role.name.replace('_', ' ').title()}",
                reason=(
                    f"Sorted with a cumulative line, so it shows how few of the {groups:,} groups "
                    "carry most of the total."
                ),
                category_column=category_role.name,
                measure_column=measure_role.name,
                priority=35,
            )
        )

    # --- stacked --------------------------------------------------------------
    if len(categories) >= 2 and primary_measure:
        primary_category = categories[0]
        secondary = next(
            (c for c in categories[1:] if 1 < c.unique <= 12 and c.name != primary_category.name),
            None,
        )
        if secondary:
            recommendations.append(
                ChartRecommendation(
                    chart_type=CHART_STACKED_BAR,
                    title=f"{primary_measure.replace('_', ' ').title()} split by "
                    f"{secondary.name.replace('_', ' ').title()}",
                    reason=(
                        f"'{secondary.name}' has {secondary.unique:,} values that fit inside "
                        f"'{primary_category.name}' ({primary_category.unique:,} values), so each "
                        "bar splits into a composition."
                    ),
                    category_column=primary_category.name,
                    measure_column=primary_measure,
                    second_category_column=secondary.name,
                    priority=45,
                )
            )

    # --- numeric shapes -------------------------------------------------------
    for measure_role in measures[:3]:
        recommendations.append(
            ChartRecommendation(
                chart_type=CHART_HISTOGRAM,
                title=f"Distribution of {measure_role.name.replace('_', ' ').lower()}",
                reason=(
                    f"'{measure_role.name}' is numeric with {measure_role.unique:,} distinct "
                    "values across "
                    f"{measure_role.non_null:,} rows, so its shape can be binned."
                ),
                measure_column=measure_role.name,
                priority=50,
                caveat=(
                    "Fewer than 8 usable rows, so the bins are rough."
                    if measure_role.non_null < 8
                    else None
                ),
            )
        )

    # --- relationships --------------------------------------------------------
    if len(numerics) >= 2:
        for index, x_role in enumerate(numerics[:3]):
            y_role = next((r for r in numerics if r.name != x_role.name), None)
            if y_role is None:
                break
            recommendations.append(
                ChartRecommendation(
                    chart_type=CHART_SCATTER,
                    title=f"{x_role.name.replace('_', ' ').title()} vs "
                    f"{y_role.name.replace('_', ' ').title()}",
                    reason=(
                        "Two numeric columns — a scatter shows whether one moves with the other "
                        "or whether the points sit in separate clusters."
                    ),
                    category_column=x_role.name,
                    measure_column=y_role.name,
                    priority=60,
                    caveat=(
                        f"Up to {measure_row_note(row_count)}, so a dense cloud may be sampled."
                        if row_count > 2000
                        else None
                    ),
                )
            )
            if index >= 1:
                break

    # --- nothing to plot ------------------------------------------------------
    if not recommendations:
        recommendations.append(
            ChartRecommendation(
                chart_type="table",
                title="Table view",
                reason=(
                    "This file has no column pair that supports a chart — no dates and no "
                    "numeric measure to compare against a grouping. The full data is still "
                    "available in Data Explorer."
                ),
                priority=1,
            )
        )

    recommendations.sort(key=lambda r: (r.priority, r.title.lower()))
    seen: set[tuple[str, str | None, str | None]] = set()
    unique: list[ChartRecommendation] = []
    for rec in recommendations:
        key = (rec.chart_type, rec.category_column, rec.measure_column)
        if key in seen:
            continue
        seen.add(key)
        unique.append(rec)

    return unique


def measure_row_note(row_count: int) -> str:
    """Wording used in scatter caveats."""
    return f"{row_count:,} rows"


def summarise_shape(
    roles: list[ColumnRole],
    *,
    row_count: int,
) -> dict[str, Any]:
    """A compact description of what the file contains, for the UI."""
    categorical = [r for r in roles if r.is_usable_category]
    return {
        "row_count": row_count,
        "column_count": len(roles),
        "categorical_columns": [r.name for r in categorical],
        "numeric_columns": [r.name for r in roles if r.role == NUMERIC],
        "date_columns": [r.name for r in roles if r.role == DATE],
        "constant_columns": [r.name for r in roles if r.role == CONSTANT],
        "identifier_columns": [r.name for r in roles if r.role == IDENTIFIER],
    }
