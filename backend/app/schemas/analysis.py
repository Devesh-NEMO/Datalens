"""Pydantic v2 schemas for API responses and data contracts."""

from pydantic import BaseModel, Field


class MetaResponse(BaseModel):
    """Metadata about the processed file and request timing."""

    filename: str = Field(description="Name of the uploaded file", examples=["sales_clean.csv"])
    rows: int = Field(description="Total row count after initial load", examples=[600])
    columns: int = Field(description="Total column count after initial load", examples=[8])
    processing_ms: float = Field(
        description="Time taken to process and analyze data in milliseconds",
        examples=[45.2],
    )
    delimiter: str | None = Field(
        default=None,
        description="Detected CSV delimiter (if applicable)",
        examples=[","],
    )
    sheet_name: str | None = Field(
        default=None,
        description="Excel sheet parsed (if applicable)",
        examples=["Sheet1"],
    )


class CleaningReportResponse(BaseModel):
    """Report detailing data cleaning and type coercion results."""

    rows_before: int = Field(description="Number of rows before cleaning", examples=[619])
    rows_after: int = Field(
        description="Number of rows after cleaning and dropping empty rows",
        examples=[600],
    )
    rows_dropped: int = Field(description="Count of empty rows removed", examples=[19])
    columns_dropped: list[str] = Field(
        default_factory=list,
        description="List of empty column names removed",
        examples=[[]],
    )
    conversions_performed: list[str] = Field(
        default_factory=list,
        description="Summary descriptions of column type conversions",
        examples=[["Converted column 'revenue' to numeric (600 valid values)"]],
    )
    failed_numeric_conversions: int = Field(
        description="Count of individual cells that failed numeric parsing",
        examples=[0],
    )
    failed_date_conversions: int = Field(
        description="Count of individual cells that failed date parsing",
        examples=[0],
    )
    null_like_values_converted: int = Field(
        description="Count of placeholder tokens (e.g., 'NA', '-') converted to missing",
        examples=[12],
    )


class ValueCountResponse(BaseModel):
    """Categorical value frequency item."""

    value: str = Field(description="Categorical value label", examples=["Electronics"])
    count: int = Field(description="Frequency occurrence count", examples=[120])


class ColumnProfileResponse(BaseModel):
    """Statistical summary for an individual dataset column."""

    name: str = Field(description="Column name", examples=["revenue"])
    detected_type: str = Field(
        description=(
            "Inferred data type (numeric, integer, date, categorical, text, boolean, id-like)"
        ),
        examples=["numeric"],
    )
    missing_count: int = Field(
        description="Count of missing/null cells in this column",
        examples=[0],
    )
    missing_percent: float = Field(
        description="Percentage of missing cells in this column",
        examples=[0.0],
    )
    unique_count: int = Field(
        description="Number of distinct values in this column",
        examples=[450],
    )
    sample_values: list[str] = Field(
        description="Sample representative values",
        examples=[["2499.0", "698.0", "4998.0"]],
    )
    min: float | None = Field(default=None, description="Minimum numeric value", examples=[19.0])
    max: float | None = Field(default=None, description="Maximum numeric value", examples=[24990.0])
    mean: float | None = Field(
        default=None,
        description="Mean numeric value",
        examples=[1245.50],
    )
    median: float | None = Field(
        default=None,
        description="Median numeric value",
        examples=[698.0],
    )
    std: float | None = Field(
        default=None,
        description="Standard deviation",
        examples=[850.25],
    )
    top_values: list[ValueCountResponse] | None = Field(
        default=None,
        description="Top 5 most frequent values for categorical/text columns",
    )


class QualityScoreResponse(BaseModel):
    """Overall dataset data quality evaluation score."""

    score: float = Field(description="Data quality score from 0.0 to 100.0", examples=[98.5])
    status: str = Field(
        description="Quality rating level (Excellent, Good, Fair, Poor)",
        examples=["Excellent"],
    )
    duplicate_row_count: int = Field(
        description="Count of exact duplicate rows detected",
        examples=[0],
    )
    total_missing_cells: int = Field(
        description="Total count of missing cells across all columns",
        examples=[5],
    )
    description: str = Field(
        description="Explanation of quality score based on penalties",
        examples=["Dataset demonstrates high completeness and integrity."],
    )


class DatasetProfileResponse(BaseModel):
    """Comprehensive dataset summary and per-column profile."""

    row_count: int = Field(description="Total valid rows profiled", examples=[600])
    column_count: int = Field(description="Total columns profiled", examples=[8])
    duplicate_row_count: int = Field(description="Number of duplicate rows", examples=[0])
    total_missing_cells: int = Field(
        description="Total missing values across the dataset",
        examples=[5],
    )
    data_quality_score: float = Field(description="Dataset quality score (0-100)", examples=[98.5])
    columns: list[ColumnProfileResponse] = Field(
        description="Profiles for every column in the dataset",
    )


class ColumnCandidateResponse(BaseModel):
    """Candidate column considered for role selection."""

    name: str = Field(description="Column name", examples=["revenue"])
    confidence: float = Field(
        description="Selection confidence score from 0.0 to 1.0",
        examples=[0.95],
    )
    reason: str = Field(
        description="Explanation of detection heuristic",
        examples=["Exact match on keyword 'revenue'"],
    )


class ColumnSelectionResponse(BaseModel):
    """Identified entity, metric, and time columns with alternatives."""

    product_column: str = Field(description="Selected product/entity column", examples=["product"])
    product_confidence: float = Field(
        description="Confidence in product column selection",
        examples=[0.95],
    )
    product_candidates: list[ColumnCandidateResponse] = Field(
        description="Candidate product columns evaluated",
    )

    value_column: str = Field(
        description="Selected numeric value/metric column",
        examples=["revenue"],
    )
    value_confidence: float = Field(
        description="Confidence in value column selection",
        examples=[0.95],
    )
    value_candidates: list[ColumnCandidateResponse] = Field(
        description="Candidate value columns evaluated",
    )

    date_column: str | None = Field(
        default=None,
        description="Selected date column if available",
        examples=["date"],
    )
    date_confidence: float | None = Field(
        default=None,
        description="Confidence in date column selection",
        examples=[0.95],
    )
    date_candidates: list[ColumnCandidateResponse] = Field(
        default_factory=list,
        description="Candidate date columns evaluated",
    )

    derived_revenue_created: bool = Field(
        default=False,
        description="True if revenue was automatically calculated from quantity * price",
        examples=[False],
    )
    notes: list[str] = Field(
        default_factory=list,
        description="Column selection notes and derivation logs",
    )


class ProductRankItemResponse(BaseModel):
    """Individual ranked product item with ABC classification."""

    rank: int = Field(description="Descending rank position", examples=[1])
    product: str = Field(
        description="Product name (canonical casing)",
        examples=["MacBook Pro 16"],
    )
    value: float = Field(description="Total aggregated metric value", examples=[450000.0])
    share_pct: float = Field(description="Percentage share of total value", examples=[35.5])
    cumulative_pct: float = Field(
        description="Cumulative value percentage including this item",
        examples=[35.5],
    )
    abc_class: str = Field(
        description="ABC classification (A: <=80%, B: <=95%, C: >95%)",
        examples=["A"],
    )


class ABCSummaryResponse(BaseModel):
    """Summary metrics per ABC category."""

    class_a_count: int = Field(description="Number of Class A products", examples=[3])
    class_a_value: float = Field(
        description="Total monetary value of Class A products",
        examples=[750000.0],
    )
    class_a_share_pct: float = Field(
        description="Percentage share of total value for Class A",
        examples=[78.5],
    )

    class_b_count: int = Field(description="Number of Class B products", examples=[5])
    class_b_value: float = Field(
        description="Total monetary value of Class B products",
        examples=[160000.0],
    )
    class_b_share_pct: float = Field(
        description="Percentage share of total value for Class B",
        examples=[16.5],
    )

    class_c_count: int = Field(description="Number of Class C products", examples=[7])
    class_c_value: float = Field(
        description="Total monetary value of Class C products",
        examples=[50000.0],
    )
    class_c_share_pct: float = Field(
        description="Percentage share of total value for Class C",
        examples=[5.0],
    )


class RankingResponse(BaseModel):
    """Comprehensive product ranking, ABC classification, and Pareto summary."""

    total_value: float = Field(
        description="Total summed metric value across all products",
        examples=[960000.0],
    )
    product_count: int = Field(description="Total distinct product count", examples=[15])
    items: list[ProductRankItemResponse] = Field(
        description="All ranked products sorted descending by value",
    )
    top_n: list[ProductRankItemResponse] = Field(description="Top N performing products")
    bottom_n: list[ProductRankItemResponse] = Field(description="Bottom N performing products")
    pareto_summary: str = Field(
        description="Pareto summary sentence",
        examples=["3 of 15 products (20.0%) generate 80% of the value"],
    )
    abc_summary: ABCSummaryResponse = Field(
        description="Aggregated summary counts and shares by ABC class",
    )
    missing_value_rows_count: int = Field(
        description="Count of rows where value was missing/zero",
        examples=[0],
    )
    variants_merged_count: int = Field(
        description="Count of product name casing/whitespace variants merged",
        examples=[0],
    )
    negative_value_products_count: int = Field(
        description="Count of products with net negative values",
        examples=[0],
    )


class ProductGrowthItemResponse(BaseModel):
    """Product performance comparison between recent time periods."""

    product: str = Field(description="Product name", examples=["MacBook Pro 16"])
    previous_period: str = Field(
        description="Previous period label (YYYY-MM)",
        examples=["2025-11"],
    )
    latest_period: str = Field(description="Latest period label (YYYY-MM)", examples=["2025-12"])
    previous_value: float = Field(description="Value in previous period", examples=[35000.0])
    latest_value: float = Field(description="Value in latest period", examples=[42000.0])
    change_pct: float = Field(description="Percentage growth or decline", examples=[20.0])
    direction: str = Field(
        description="Direction ('rising', 'falling', 'flat')",
        examples=["rising"],
    )


class GrowthResponse(BaseModel):
    """Period-over-period growth trends per product."""

    has_growth_data: bool = Field(
        description="True if sufficient time range was available to compute growth",
        examples=[True],
    )
    previous_period: str | None = Field(
        default=None,
        description="Previous comparison period",
        examples=["2025-11"],
    )
    latest_period: str | None = Field(
        default=None,
        description="Latest comparison period",
        examples=["2025-12"],
    )
    items: list[ProductGrowthItemResponse] = Field(
        default_factory=list,
        description="Per-product growth metrics",
    )
    warning: str | None = Field(
        default=None,
        description="Warning if growth could not be calculated",
    )


class TopProductBarItemResponse(BaseModel):
    """Top product chart data item."""

    product: str = Field(description="Product name", examples=["MacBook Pro 16"])
    value: float = Field(description="Total value", examples=[450000.0])


class ParetoCurveItemResponse(BaseModel):
    """Pareto curve chart data item."""

    product: str = Field(description="Product name", examples=["MacBook Pro 16"])
    value: float = Field(description="Product value", examples=[450000.0])
    cumulative_pct: float = Field(
        description="Cumulative percentage of total value",
        examples=[35.5],
    )


class ABCDistributionItemResponse(BaseModel):
    """ABC distribution breakdown item."""

    abc_class: str = Field(description="ABC Class (A, B, or C)", examples=["A"])
    product_count: int = Field(description="Number of products in class", examples=[3])
    value: float = Field(description="Total monetary value for class", examples=[750000.0])
    value_share_pct: float = Field(
        description="Percentage share of total value",
        examples=[78.5],
    )


class MonthlyTrendItemResponse(BaseModel):
    """Chronological monthly trend item."""

    month: str = Field(description="Month (YYYY-MM)", examples=["2025-01"])
    value: float = Field(description="Total metric value for month", examples=[85000.0])


class HistogramBucketResponse(BaseModel):
    """Histogram bucket item."""

    bucket_min: float = Field(description="Lower bound of bucket", examples=[0.0])
    bucket_max: float = Field(description="Upper bound of bucket", examples=[2500.0])
    label: str = Field(description="Bucket display label", examples=["0 - 2500"])
    count: int = Field(description="Count of rows falling into this bucket", examples=[450])


class ChartsResponse(BaseModel):
    """JSON-ready visualization datasets for charting libraries."""

    top_products_bar: list[TopProductBarItemResponse] = Field(
        description="Top products and their values for bar chart",
    )
    pareto_curve: list[ParetoCurveItemResponse] = Field(
        description="Ordered products with cumulative percentage for Pareto chart",
    )
    abc_distribution: list[ABCDistributionItemResponse] = Field(
        description="Product count and value share per ABC class",
    )
    monthly_trend: list[MonthlyTrendItemResponse] = Field(
        description="Monthly value trend across time",
    )
    value_histogram: list[HistogramBucketResponse] = Field(
        description="10-bucket distribution histogram of the value metric",
    )


class AnalysisResponse(BaseModel):
    """Complete response payload for POST /analyze."""

    meta: MetaResponse = Field(description="Upload and processing metadata")
    cleaning: CleaningReportResponse = Field(description="Data cleaning report")
    profile: DatasetProfileResponse = Field(description="Dataset statistical profile")
    quality: QualityScoreResponse = Field(description="Overall dataset quality evaluation")
    selection: ColumnSelectionResponse = Field(
        description="Selected analysis columns and candidates",
    )
    ranking: RankingResponse = Field(description="Product ranking and ABC/Pareto analysis")
    growth: GrowthResponse = Field(description="Period-over-period growth metrics")
    charts: ChartsResponse = Field(description="Chart-ready structured JSON data")
    warnings: list[str] = Field(
        default_factory=list,
        description="Warnings and informational notices",
    )
