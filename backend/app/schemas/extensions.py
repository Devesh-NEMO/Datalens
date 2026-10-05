"""Schemas for the analysis extensions: dataset kind, quality issues, anomalies,
segments and chart recommendations.

These are additive to :mod:`app.schemas.analysis` — every field is new, so an
existing client that reads the original payload keeps working unchanged.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class DatasetKindResponse(BaseModel):
    """What Datalens believes the dataset is about.

    Read from column names, never assumed. It drives the wording of the
    executive summary and which breakdowns are offered, so a file of marketing
    spend is described as marketing spend rather than as sales.
    """

    kind: str = Field(
        description="Machine-readable dataset kind",
        examples=["sales", "marketing", "finance", "inventory", "hr", "customer", "generic"],
    )
    label: str = Field(
        description="Human-readable label for the kind",
        examples=["Sales / transactions"],
    )
    meaning: str = Field(
        description=(
            "One sentence explaining how the analysis interprets this kind of file"
        ),
        examples=[
            "Rows are individual transactions. Products are ranked by the value column "
            "and compared period over period.",
        ],
    )
    #: Columns whose names drove the decision, for the "why" disclosure.
    matched_keywords: list[str] = Field(
        default_factory=list,
        description="Column-name keywords that led to this classification",
    )
    confident: bool = Field(
        default=False,
        description=(
            "False when the file has no distinguishing column names and the generic "
            "reading was used"
        ),
    )


class QualityIssueResponse(BaseModel):
    """One classified data-quality finding."""

    id: str = Field(description="Stable identifier for this finding", examples=["empty_rows"])
    severity: str = Field(
        description="Severity: 'critical', 'warning' or 'info'",
        examples=["warning"],
    )
    title: str = Field(
        description="Short headline for the finding",
        examples=["5 completely empty rows removed"],
    )
    what_happened: str = Field(
        description="Plain-language description of the problem",
    )
    count: int = Field(
        description="Number of rows, cells or columns affected. 0 when not countable",
        examples=[5],
    )
    action_taken: str = Field(
        description="What Datalens did about it",
        examples=["Removed 5 empty rows."],
    )
    recommendation: str = Field(
        description="What a person may still want to do",
    )
    category: str = Field(
        default="general",
        description="Grouping key: completeness, validity, uniqueness, structure, "
        "analysis or summary",
        examples=["completeness"],
    )


class AnomalyResponse(BaseModel):
    """One potential anomaly.

    Named "potential" deliberately: the check compares numbers and cannot
    establish that a record is wrong.
    """

    column: str = Field(description="Column the anomaly sits in", examples=["revenue"])
    value: str = Field(description="The value itself, formatted", examples=["1,250,000"])
    reason: str = Field(
        description="Why this value was flagged, with the figures behind the comparison",
    )
    severity: str = Field(description="Severity: 'high', 'medium' or 'low'", examples=["medium"])
    method: str = Field(
        description="Detection method: 'iqr', 'zscore', 'missing_spike' or 'growth'",
        examples=["iqr"],
    )
    distance: float | None = Field(
        default=None,
        description="How far outside the normal range, in IQR widths or standard deviations",
        examples=[2.4],
    )
    occurrences: int = Field(
        default=1,
        description=(
            "Rows carrying this value. Distinct values are reported once, so a value "
            "repeating 40 times is one finding rather than 40."
        ),
        examples=[1],
    )


class AnomalySummaryResponse(BaseModel):
    """The anomaly scan as a whole, including why it may have been skipped."""

    detected: bool = Field(
        description="False when the scan could not run meaningfully for this dataset",
        examples=[True],
    )
    count: int = Field(description="Total potential anomalies found", examples=[7])
    items: list[AnomalyResponse] = Field(
        default_factory=list,
        description="Flagged anomalies, most severe first, bounded in number",
    )
    notes: list[str] = Field(
        default_factory=list,
        description="Scope notes: sampling, skipped columns, truncation",
    )
    rows_scanned: int = Field(
        default=0,
        description="Rows actually analysed, which may be fewer than the dataset's rows",
        examples=[614],
    )
    sampled: bool = Field(
        default=False,
        description="True when a large frame was sampled deterministically",
        examples=[False],
    )


class SegmentItemResponse(BaseModel):
    """One group within a breakdown."""

    label: str = Field(description="Group value", examples=["North America"])
    value: float = Field(description="Measure summed for this group", examples=[412000.0])
    count: int = Field(description="Rows in this group", examples=[148])
    share_pct: float = Field(description="Share of the segment total", examples=[26.4])


class SegmentResponse(BaseModel):
    """Totals for one groupable column, summed by one measure."""

    column: str = Field(description="Column that was grouped by", examples=["region"])
    measure: str = Field(description="Measure that was summed", examples=["revenue"])
    total: float = Field(description="Sum of the measure across all groups", examples=[1560000.0])
    row_count: int = Field(description="Rows included in the breakdown", examples=[600])
    items: list[SegmentItemResponse] = Field(
        default_factory=list,
        description="Groups, largest first",
    )
    truncated: bool = Field(
        default=False,
        description="True when only the largest groups are listed and the rest grouped as Other",
    )
    groups_total: int = Field(default=0, description="Distinct values in the column", examples=[5])


class ChartRecommendationResponse(BaseModel):
    """A suggested chart plus the reason it suits this dataset."""

    chart_type: str = Field(
        description="Chart type key",
        examples=[
            "bar", "horizontal_bar", "line", "area", "pie", "donut",
            "histogram", "scatter", "pareto", "stacked_bar", "table",
        ],
    )
    title: str = Field(description="Suggested chart title", examples=["Revenue by region"])
    reason: str = Field(
        description="Why this chart suits the columns present",
        examples=["'region' has 5 distinct values, which reads better side-on."],
    )
    category_column: str | None = Field(
        default=None,
        description="Column supplying categories or x values",
    )
    measure_column: str | None = Field(default=None, description="Column supplying the numbers")
    second_category_column: str | None = Field(
        default=None,
        description="Second category column, for stacked charts",
    )
    priority: int = Field(default=50, description="Sort order, lower first", examples=[10])
    caveat: str | None = Field(
        default=None,
        description="Note when the chart is a weaker fit for this data",
    )


class ColumnRoleResponse(BaseModel):
    """How Datalens can use one column."""

    name: str = Field(description="Column name", examples=["region"])
    role: str = Field(
        description="One of: numeric, date, text, boolean, constant, identifier",
        examples=["text"],
    )
    dtype: str = Field(description="pandas dtype as a string", examples=["object"])
    non_null: int = Field(description="Rows with a value", examples=[600])
    unique: int = Field(description="Distinct values", examples=[5])
    missing_percent: float = Field(description="Percentage of rows with no value", examples=[0.0])
    numeric: bool = Field(description="True when the column holds numbers")
    datetime: bool = Field(description="True when the column holds dates")
    categorical: bool = Field(description="True when the column can group rows")
    longest_label: int = Field(default=0, description="Longest label in characters", examples=[13])


class ShapeResponse(BaseModel):
    """A compact description of what the file contains.

    Every field defaults, so an empty ``ShapeResponse()`` is a valid
    placeholder for a response built before this block existed.
    """

    row_count: int = Field(default=0, description="Rows analysed", examples=[614])
    column_count: int = Field(default=0, description="Columns analysed", examples=[8])
    categorical_columns: list[str] = Field(default_factory=list, description="Groupable columns")
    numeric_columns: list[str] = Field(default_factory=list, description="Numeric columns")
    date_columns: list[str] = Field(default_factory=list, description="Date columns")
    constant_columns: list[str] = Field(
        default_factory=list,
        description="Columns with a single distinct value",
    )
    identifier_columns: list[str] = Field(
        default_factory=list,
        description="Columns that look like row identifiers rather than groupings",
    )
