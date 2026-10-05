"""Schemas for the dataset library, explorer, comparison and AI endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

# --- explorer ------------------------------------------------------------------


class ExploreFilterRequest(BaseModel):
    """One filter condition.

    Operators are a fixed enum rather than free text, so a filter string can
    never be interpreted as an expression.
    """

    column: str = Field(description="Column to filter on", examples=["region"])
    operator: str = Field(
        description=(
            "One of: eq, ne, gt, gte, lt, lte, contains, not_contains, starts_with, "
            "ends_with, is_empty, is_not_empty"
        ),
        examples=["eq"],
    )
    value: Any | None = Field(
        default=None,
        description="Value to compare against. Ignored for is_empty / is_not_empty",
        examples=["North America"],
    )


class ExploreRequest(BaseModel):
    """A page request against an uploaded file."""

    product_column: str | None = Field(default=None, description="Grouping column used for ranking")
    value_column: str | None = Field(default=None, description="Numeric column used for measures")
    date_column: str | None = Field(default=None, description="Date column used for trends")
    sheet_name: str | None = Field(default=None, description="Excel sheet to read")
    table: str | None = Field(default=None, description="Database table to read")
    page: int = Field(default=1, ge=1, description="1-based page number", examples=[1])
    page_size: int | None = Field(default=None, ge=1, le=200, description="Rows per page")
    sort: str | None = Field(default=None, description="Column to sort by", examples=["revenue"])
    direction: str = Field(default="asc", description="Sort direction: 'asc' or 'desc'")
    search: str | None = Field(default=None, description="Case-insensitive substring to search for")
    search_columns: list[str] | None = Field(
        default=None,
        description="Columns to search. Defaults to every text column",
    )
    filters: list[ExploreFilterRequest] = Field(
        default_factory=list,
        description="Conditions combined with AND",
    )


class ExplorerColumnResponse(BaseModel):
    """A column as the explorer table header needs it."""

    name: str = Field(description="Column name", examples=["revenue"])
    dtype: str = Field(description="pandas dtype as a string", examples=["float64"])
    kind: str = Field(
        description="One of: numeric, date, text — drives formatting and filter operators",
        examples=["numeric"],
    )
    missing_count: int = Field(description="Rows with no value", examples=[16])
    distinct_count: int = Field(description="Distinct values", examples=[132])
    min: float | None = Field(default=None, description="Smallest numeric value")
    max: float | None = Field(default=None, description="Largest numeric value")
    distinct_values: list[Any] = Field(
        default_factory=list,
        description="Values offered in the filter dropdown, when few enough to list",
    )


class ExploreResponse(BaseModel):
    """One page of rows plus everything needed to render the table around them."""

    columns: list[ExplorerColumnResponse] = Field(description="Columns in display order")
    rows: list[list[Any]] = Field(
        description="Row values, in column order",
        examples=[[1, "2025-01-15", "MacBook Pro 16", 12499.0]],
    )
    total_rows: int = Field(description="Rows matching the filters", examples=[614])
    page: int = Field(description="Page returned, 1-based", examples=[1])
    page_size: int = Field(description="Rows per page actually used", examples=[100])
    page_count: int = Field(description="Total pages", examples=[7])
    sort_column: str | None = Field(default=None, description="Column currently sorted")
    sort_direction: str = Field(description="Current sort direction", examples=["asc"])
    search: str = Field(default="", description="Active search term")
    search_columns: list[str] = Field(
        default_factory=list,
        description="Columns the term was matched against, so the UI can show the scope",
    )
    filters: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Filters that were applied, echoed back",
    )
    filtered_out: int = Field(
        default=0,
        description="Rows hidden by the filters, so the UI can say '12 of 614 rows'",
    )
    distinct_values: dict[str, list[Any]] = Field(
        default_factory=dict,
        description="Filter dropdown values per column",
    )
    rejected: list[str] = Field(
        default_factory=list,
        description="Sort/filter expressions that were ignored, with the reason",
    )


# --- dataset library -----------------------------------------------------------


class DatasetColumnSummary(BaseModel):
    """One column of a stored dataset."""

    name: str = Field(description="Column name", examples=["revenue"])
    position: int = Field(description="Column order", examples=[7])
    detected_type: str = Field(description="Inferred type", examples=["float64"])
    missing_percent: float = Field(default=0.0, description="Percentage of empty rows")
    unique_count: int = Field(default=0, description="Distinct values")


class DatasetSummaryResponse(BaseModel):
    """A row in the library list."""

    id: str = Field(description="Stable dataset identifier", examples=["ds_7f3a"])
    name: str = Field(description="Dataset name", examples=["December sales"])
    original_filename: str = Field(description="Uploaded filename", examples=["sales_dec.csv"])
    created_at: str = Field(description="ISO timestamp of upload")
    updated_at: str = Field(description="ISO timestamp of the last change")
    status: str = Field(description="ready or failed", examples=["ready"])
    status_detail: str | None = Field(
        default=None,
        description="Why the dataset is in its current state",
    )
    row_count: int = Field(default=0, description="Rows analysed", examples=[614])
    column_count: int = Field(default=0, description="Columns analysed", examples=[8])
    total_value: float | None = Field(
        default=None,
        description="Total of the measure column, cached for the library list",
    )
    quality_score: float | None = Field(
        default=None,
        description="Data quality score, cached for the library list",
    )
    dataset_kind: str | None = Field(
        default=None,
        description="Recognised dataset kind",
        examples=["sales"],
    )
    product_column: str | None = Field(default=None, description="Grouping column used")
    value_column: str | None = Field(default=None, description="Measure column used")
    date_column: str | None = Field(default=None, description="Date column used")
    storage_bytes: int | None = Field(
        default=None,
        description="Size of the stored file",
    )


class DatasetDetailResponse(DatasetSummaryResponse):
    """A library entry with the stored analysis and preview."""

    columns: list[DatasetColumnSummary] = Field(
        default_factory=list,
        description="Per-column summary captured at upload",
    )
    #: Cached analysis result. Present so re-opening a dataset does not re-read
    #: the file; always regenerable by re-analysing.
    analysis: dict[str, Any] | None = Field(
        default=None,
        description="The full analysis payload as computed at upload",
    )
    #: A capped sample of rows, so a client can show a table immediately instead
    #: of waiting for the explorer round trip. Always treat it as a sample.
    preview_rows: list[Any] | None = Field(
        default=None,
        description="A stored sample of rows, in column order",
    )
    preview_total_rows: int = Field(
        default=0,
        description="Rows in the dataset, which may exceed the stored preview",
    )
    #: True when the preview is a sample rather than the whole dataset.
    preview_truncated: bool = Field(
        default=False,
        description="True when more rows exist than were previewed",
    )
    #: Set by the re-analyse endpoint. False means the stored file was unavailable
    #: and the last saved analysis was returned instead — an honest downgrade
    #: rather than a silent one.
    reanalyzed: bool = Field(
        default=True,
        description="False when the cached analysis was returned without re-reading the file",
    )
    note: str | None = Field(
        default=None,
        description="An explanation to show the reader, when something was degraded",
    )


class DatasetListResponse(BaseModel):
    """The library page."""

    datasets: list[DatasetSummaryResponse] = Field(
        default_factory=list,
        description="Saved datasets, newest first",
    )
    total: int = Field(default=0, description="How many datasets exist")
    #: False when persistence is unavailable, so the UI can explain an empty
    #: list as "saving is switched off" rather than "you have no datasets".
    persistence_available: bool = Field(default=True, description="Whether saving works at all")
    unavailable_reason: str | None = Field(
        default=None,
        description="Why saving is unavailable, when it is",
    )


class SaveDatasetRequest(BaseModel):
    """Store an upload as a named dataset."""

    name: str = Field(min_length=1, max_length=120, description="Name to show in the library")
    file: Any = Field(description="The uploaded file content")
    product_column: str | None = Field(default=None, description="Grouping column override")
    value_column: str | None = Field(default=None, description="Measure column override")
    date_column: str | None = Field(default=None, description="Date column override")
    sheet_name: str | None = Field(default=None, description="Excel sheet to read")
    table: str | None = Field(default=None, description="Database table to read")


class RenameDatasetRequest(BaseModel):
    """Change a dataset's display name."""

    name: str = Field(min_length=1, max_length=120, description="New name")


class ReanalyzeDatasetRequest(BaseModel):
    """Re-run the analysis with different column choices."""

    product_column: str | None = Field(default=None, description="New grouping column")
    value_column: str | None = Field(default=None, description="New measure column")
    date_column: str | None = Field(default=None, description="New date column")
    top_n: int | None = Field(default=None, ge=1, le=100, description="Top/bottom N")


class AnalyzeDatasetRequest(BaseModel):
    """Analyse a stored dataset by id, without re-uploading the file."""

    dataset_id: str = Field(description="Dataset to analyse")
    product_column: str | None = Field(default=None, description="Grouping column override")
    value_column: str | None = Field(default=None, description="Measure column override")
    date_column: str | None = Field(default=None, description="Date column override")
    top_n: int | None = Field(default=None, ge=1, le=100, description="Top/bottom N")


# --- comparison ----------------------------------------------------------------


class CompareRequest(BaseModel):
    """Compare two stored datasets."""

    baseline_id: str = Field(description="Dataset to compare against")
    comparison_id: str = Field(description="Dataset to compare")
    limit: int | None = Field(
        default=None,
        ge=1,
        le=500,
        description="Maximum groups to return in the ranked list",
    )


class CompareRequestUpload(BaseModel):
    """Compare a stored dataset against a freshly uploaded file."""

    baseline_id: str = Field(description="Dataset to compare against")
    file: Any = Field(description="The file to compare")
    product_column: str | None = Field(default=None, description="Grouping column override")
    value_column: str | None = Field(default=None, description="Measure column override")
    date_column: str | None = Field(default=None, description="Date column override")
    sheet_name: str | None = Field(default=None, description="Excel sheet to read")
    table: str | None = Field(default=None, description="Database table to read")
    limit: int | None = Field(default=None, ge=1, le=500, description="Maximum groups to return")


# --- AI ------------------------------------------------------------------------


class GroundingResponse(BaseModel):
    """How the generated text was checked against the computed analysis."""

    figure_count: int = Field(
        default=0,
        description="Distinct figures in the fact sheet the writer was allowed to use",
        examples=[48],
    )
    rule: str = Field(
        description="What was enforced, in words the UI can show",
        examples=[
            "Every number in the text above was checked against the computed analysis "
            "and rejected if it did not appear there."
        ],
    )


class InsightSectionResponse(BaseModel):
    """One written section."""

    key: str = Field(description="Stable section identifier", examples=["executive"])
    title: str = Field(description="Section heading", examples=["Executive summary"])
    body: str = Field(description="The section text", examples=["Total value reached ..."])
    available: bool = Field(description="Whether this dataset supports the section")
    source: str = Field(
        description="Source of the text: ai, local or none",
        examples=["local"],
    )
    bullets: list[str] = Field(default_factory=list, description="Supporting points")
    fell_back: bool = Field(
        default=False,
        description="True when the provider failed and the computed text was used instead",
    )
    fallback_reason: str | None = Field(
        default=None,
        description="Why the provider's wording was not used, when it was not",
    )


class InsightsResponse(BaseModel):
    """Every insight section, plus enough provenance for the UI to label them."""

    provider: str = Field(description="Provider name", examples=["local"])
    model: str = Field(description="Model name, or 'local-analysis'", examples=["local-analysis"])
    #: False when the text came from Datalens' own computation. Not an error state:
    #: it is the default and correct configuration with no API key.
    is_ai: bool = Field(description="True when a model provider wrote the text")
    fell_back: bool = Field(
        default=False,
        description="True when a configured provider failed and computed text was used",
    )
    fallback_reason: str | None = Field(
        default=None,
        description="Why the provider's wording was discarded, when it was",
    )
    disclaimer: str = Field(description="Shown alongside local text")
    status: dict[str, Any] = Field(description="Provider status, without secrets")
    sections: list[InsightSectionResponse] = Field(
        default_factory=list,
        description="The written sections, in display order",
    )
    grounding: GroundingResponse | None = Field(
        default=None,
        description="How the text was checked against the analysis",
    )


class AskResponse(BaseModel):
    """One answer to one question."""

    question: str = Field(description="The question as understood", examples=["What changed?"])
    answer: str = Field(description="The answer text")
    source: str = Field(description="Where the answer came from: ai or local", examples=["local"])
    provider: str = Field(description="Provider name", examples=["local"])
    model: str = Field(description="Model name, or 'local-analysis'", examples=["local-analysis"])
    is_ai: bool = Field(description="True when a model provider wrote the answer")
    fell_back: bool = Field(default=False, description="True when the provider failed")
    fallback_reason: str | None = Field(default=None, description="Why it fell back")
    disclaimer: str = Field(description="Shown alongside local answers")
    intent: str = Field(description="Matched intent, or 'unknown'", examples=["trend"])
    #: False when the engine did not recognise the question. The UI says so rather
    #: than letting a loosely-related answer pass as an answer.
    intent_matched: bool = Field(description="Whether the intent was recognised")
    status: dict[str, Any] = Field(description="Provider status, without secrets")
    suggestions: list[str] = Field(
        default_factory=list,
        description="Questions this engine can actually answer",
    )


class AskRequest(BaseModel):
    """One question about one dataset."""

    dataset_id: str | None = Field(
        default=None,
        description="Saved dataset to answer about. Omit when using an inline analysis.",
    )
    question: str = Field(min_length=1, max_length=1000, description="The question")
    history: list[dict[str, str]] = Field(
        default_factory=list,
        description="Prior exchanges, bounded server-side",
    )


class AskInlineRequest(BaseModel):
    """Ask a question about a file being analysed without saving it."""

    question: str = Field(min_length=1, max_length=1000, description="The question")
    product_column: str | None = Field(default=None, description="Grouping column override")
    value_column: str | None = Field(default=None, description="Measure column override")
    date_column: str | None = Field(default=None, description="Date column override")
    sheet_name: str | None = Field(default=None, description="Excel sheet to read")
    table: str | None = Field(default=None, description="Database table to read")
    history: list[dict[str, str]] = Field(default_factory=list, description="Prior exchanges")


class AskPayloadRequest(BaseModel):
    """A question about an analysis the caller already holds.

    The analysis is embedded in the body rather than passed as a second body
    parameter: a request has one body, so this is the only shape that both
    validates and documents itself.
    """

    question: str = Field(min_length=1, max_length=1000, description="The question")
    analysis: dict[str, Any] = Field(
        description="The analysis payload from POST /analyze or from a saved dataset",
    )
    history: list[dict[str, str]] = Field(default_factory=list, description="Prior exchanges")


class InsightsInlineRequest(BaseModel):
    """Generate insights for a file being analysed without saving it."""

    product_column: str | None = Field(default=None, description="Grouping column override")
    value_column: str | None = Field(default=None, description="Measure column override")
    date_column: str | None = Field(default=None, description="Date column override")
    sheet_name: str | None = Field(default=None, description="Excel sheet to read")
    table: str | None = Field(default=None, description="Database table to read")


class InsightsPayloadRequest(BaseModel):
    """Insights for an analysis the caller already holds.

    ``analysis`` is a plain dict rather than ``AnalysisResponse`` so a payload
    round-tripped through the frontend's stored JSON validates even if a field
    the AI layer does not read is missing. The brief builder is defensive about
    exactly that, and requiring the full schema here would reject input the rest
    of the pipeline handles without complaint.
    """

    analysis: dict[str, Any] = Field(
        description="The analysis payload from POST /analyze or from a saved dataset",
    )


class SuggestionResponse(BaseModel):
    """A starter question and what it returns."""

    question: str = Field(
        description="The question",
        examples=["Which products should I focus on?"],
    )
    intent: str = Field(description="Which question shape it matches", examples=["focus"])
    covers: str = Field(description="One line on what the answer contains")


# --- auth ----------------------------------------------------------------------


class RegisterRequest(BaseModel):
    """Create an account."""

    email: str = Field(min_length=3, max_length=254, description="Email address")
    password: str = Field(
        min_length=8,
        max_length=200,
        description="Password. 8 characters minimum; length beats symbols.",
    )
    display_name: str | None = Field(default=None, max_length=80, description="Shown in the UI")


class LoginRequest(BaseModel):
    """Exchange credentials for a session token."""

    email: str = Field(min_length=3, max_length=254, description="Email address")
    password: str = Field(min_length=1, max_length=200, description="Password")


class UserResponse(BaseModel):
    """The signed-in user."""

    id: str = Field(description="User identifier", examples=["u_2b19"])
    email: str = Field(description="Email address", examples=["analyst@example.com"])
    display_name: str | None = Field(default=None, description="Display name")
    created_at: str = Field(description="ISO timestamp of registration")


class AuthResponse(BaseModel):
    """A session token plus the user it belongs to."""

    token: str = Field(description="Session token. Send as 'Authorization: Bearer <token>'")
    expires_at: str = Field(description="ISO timestamp when the token stops working")
    user: UserResponse = Field(description="The authenticated user")


class SessionResponse(BaseModel):
    """Whether the current request is authenticated, and as whom."""

    authenticated: bool = Field(description="True when a valid token was presented")
    user: UserResponse | None = Field(default=None, description="The user, when authenticated")
    #: False when auth is optional and no token was presented. The frontend uses
    #: this to decide whether to show a sign-in prompt at all.
    auth_required: bool = Field(
        default=False,
        description="True when requests without a token are rejected",
    )
    message: str = Field(description="Explanation of the current auth state")