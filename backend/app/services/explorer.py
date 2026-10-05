"""Server-side row browsing for Data Explorer.

Sending a whole file to the browser and paginating with JavaScript means a
50,000-row upload either freezes the tab or arrives as several megabytes of JSON.
This module does the work server-side instead: the client sends a page number,
a sort, a search term and a set of filters, and receives at most
``page_size`` rows plus the counts needed to render the pager.

Two things it deliberately does not do:

* **No arbitrary expression evaluation.** Filters are matched by column name
  against a fixed set of typed comparisons, so a filter string can never become
  code.
* **No unbounded memory.** Sorting and filtering run over the frame the caller
  passes, and the *response* is capped. Callers above this module are
  responsible for not holding a frame larger than ``settings.max_rows``; see
  :func:`explore_frame`.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

import pandas as pd

from app.config import settings

#: Hard ceiling on rows in a single response, whatever page size was asked for.
MAX_PAGE_SIZE = 200

#: Search terms longer than this are truncated: nobody pastes a novel into a
#: table filter, and an unbounded term is a cheap way to burn CPU.
MAX_SEARCH_CHARS = 200

#: Filter operators accepted from the client.
OPERATORS = {
    "eq", "ne", "gt", "gte", "lt", "lte", "contains", "not_contains",
    "starts_with", "ends_with", "is_empty", "is_not_empty",
}

SORT_DIRECTIONS = {"asc", "desc"}


@dataclass
class ColumnMeta:
    """One column as the explorer needs it to render a header."""

    name: str
    dtype: str
    #: "numeric", "date" or "text" — drives client-side formatting and which
    #: filter operators are offered.
    kind: str
    missing_count: int
    distinct_count: int
    minimum: float | None = None
    maximum: float | None = None
    distinct_values: list[Any] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "dtype": self.dtype,
            "kind": self.kind,
            "missing_count": self.missing_count,
            "distinct_count": self.distinct_count,
            "min": self.minimum,
            "max": self.maximum,
            "distinct_values": self.distinct_values,
        }


@dataclass
class ExploreResult:
    """One page of rows, with everything a table needs around them."""

    columns: list[ColumnMeta]
    rows: list[list[Any]]
    #: Rows matching the filters, before pagination.
    total_rows: int
    page: int
    page_size: int
    page_count: int
    sort_column: str | None
    sort_direction: str
    search: str
    filters: list[dict[str, Any]]
    #: Rows dropped by filters, so the UI can say "12 of 614 rows".
    filtered_out: int
    #: Distinct values offered for the filter dropdowns, per column.
    distinct_values: dict[str, list[Any]]
    #: Sort/filter expressions that were rejected, with the reason.
    rejected: list[str] = field(default_factory=list)
    #: Columns the search term was matched against. Echoed so the UI can say
    #: "searched 3 text columns" instead of leaving the scope implicit.
    search_columns: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "columns": [c.to_dict() for c in self.columns],
            "rows": self.rows,
            "total_rows": self.total_rows,
            "page": self.page,
            "page_size": self.page_size,
            "page_count": self.page_count,
            "sort_column": self.sort_column,
            "sort_direction": self.sort_direction,
            "search": self.search,
            "search_columns": self.search_columns,
            "filters": self.filters,
            "filtered_out": self.filtered_out,
            "distinct_values": self.distinct_values,
            "rejected": self.rejected,
        }


def describe_columns(df: pd.DataFrame) -> list[ColumnMeta]:
    """Column metadata plus the distinct values a filter needs.

    Distinct values are capped hard. A column with 5,000 distinct values would
    produce a multi-megabyte dropdown, which is worse than no dropdown.
    """
    metas: list[ColumnMeta] = []
    for column in df.columns:
        series = df[column]
        kind = _kind_of(series)
        distinct = int(series.nunique(dropna=True))

        values: list[Any] = []
        if 1 < distinct <= settings.explorer_distinct_values:
            # Sorted for numeric columns so the dropdown is ordered; text stays
            # in frequency order, which is what a reader scanning it expects.
            ordered = (
                series.dropna().sort_values().unique()
                if kind == "numeric"
                else series.dropna().value_counts().index
            )
            values = [_json_safe(v) for v in list(ordered)[: settings.explorer_distinct_values]]

        metas.append(
            ColumnMeta(
                name=str(column),
                dtype=str(series.dtype),
                kind=kind,
                missing_count=int(series.isna().sum()),
                distinct_count=distinct,
                minimum=_scalar(series.min()) if kind == "numeric" else None,
                maximum=_scalar(series.max()) if kind == "numeric" else None,
                distinct_values=values,
            )
        )
    return metas


def explore_frame(
    df: pd.DataFrame,
    *,
    page: int = 1,
    page_size: int | None = None,
    sort: str | None = None,
    direction: str = "asc",
    search: str | None = None,
    search_columns: list[str] | None = None,
    filters: list[dict[str, Any]] | None = None,
) -> ExploreResult:
    """Filter, sort and paginate a frame.

    Invalid input is reported through ``rejected`` rather than raising: a client
    that sends a sort on a dropped column should still get its table, with a
    note about the part that was ignored.
    """
    rejected: list[str] = []
    original_rows = len(df)

    size = page_size or settings.explorer_page_size
    size = max(1, min(int(size), MAX_PAGE_SIZE))

    columns = df.columns.tolist()
    known = {str(c) for c in columns}

    # --- search ---------------------------------------------------------------
    term = " ".join(str(search or "").split())[:MAX_SEARCH_CHARS]
    working = df
    scanned: list[str] = []
    if term:
        working, scanned = _apply_search(working, term, search_columns, known, rejected)
    elif term != (search or ""):
        rejected.append("Search text was empty after trimming.")

    # --- filters --------------------------------------------------------------
    active: list[dict[str, Any]] = []
    for raw in filters or []:
        applied, note = _apply_filter(working, raw, known, rejected)
        if applied is None:
            continue
        working = applied
        active.append(note)

    # --- sort -----------------------------------------------------------------
    sort_column = str(sort) if sort in known else None
    if sort and sort not in known:
        rejected.append(f"Cannot sort by '{sort}': no such column.")
    sort_direction = "desc" if str(direction).lower() == "desc" else "asc"
    if sort_column:
        working = _apply_sort(working, sort_column, sort_direction, rejected)

    # --- paginate -------------------------------------------------------------
    total_rows = len(working)
    page_count = max(1, math.ceil(total_rows / size)) if total_rows else 0
    current = max(1, int(page))
    # A page past the end shows the last page rather than nothing, so deleting
    # rows while on page 9 does not blank the table.
    if page_count and current > page_count:
        current = page_count

    start = (current - 1) * size
    window = working.iloc[start : start + size]

    return ExploreResult(
        columns=describe_columns(df),
        rows=[[_json_safe(v) for v in row] for row in window.itertuples(index=False)],
        total_rows=total_rows,
        page=current,
        page_size=size,
        page_count=page_count,
        sort_column=sort_column,
        sort_direction=sort_direction,
        search=term,
        search_columns=scanned,
        filters=active,
        filtered_out=original_rows - total_rows,
        distinct_values=_distinct_values_map(df),
        rejected=rejected,
    )


# --- filtering -----------------------------------------------------------------


def _apply_search(
    df: pd.DataFrame,
    term: str,
    columns: list[str] | None,
    known: set[str],
    rejected: list[str],
) -> tuple[pd.DataFrame, list[str]]:
    """Case-insensitive substring match. Returns the frame and the columns scanned.

    The columns actually scanned are returned rather than assumed, because the
    choice is silent otherwise: someone types an order id, gets nothing, and
    cannot tell whether the id is absent or simply not a searched column.
    """
    targets = [c for c in (columns or []) if c in known]
    if columns:
        missing = [c for c in columns if c not in known]
        if missing:
            rejected.append(f"Search skipped unknown column(s): {', '.join(missing)}.")

    if not targets:
        # Searching every column would silently include identifiers and dates,
        # which is rarely what someone typing into a table filter wants, but
        # searching nothing would be useless. Text columns only.
        targets = [str(c) for c in df.columns if _kind_of(df[c]) == "text"]

    if not targets:
        rejected.append("This dataset has no text column to search.")
        return df, []

    needle = term.lower()
    mask = pd.Series(False, index=df.index)
    for column in targets:
        # NaN-safe: `astype("string")` turns NaN into <NA>, and `.str.contains`
        # yields NA there, which would poison the OR.
        text = df[column].astype("string").str.lower()
        mask = mask | text.fillna("").str.contains(needle, regex=False)
    return df[mask], targets


def _apply_filter(
    df: pd.DataFrame,
    raw: dict[str, Any],
    known: set[str],
    rejected: list[str],
) -> tuple[pd.DataFrame | None, dict[str, Any]]:
    """Apply one filter. Returns ``(frame_or_None, echo_of_the_filter)``."""
    if not isinstance(raw, dict):
        rejected.append("Ignored a filter that was not an object.")
        return None, {}

    column = str(raw.get("column") or "")
    operator = str(raw.get("operator") or "eq")
    value = raw.get("value")

    if column not in known:
        rejected.append(f"Ignored a filter on unknown column '{column}'.")
        return None, {}
    if operator not in OPERATORS:
        rejected.append(f"Ignored unknown filter operator '{operator}'.")
        return None, {}

    series = df[column]

    if operator == "is_empty":
        masked = series.isna() | (series.astype("string").str.strip() == "")
    elif operator == "is_not_empty":
        masked = ~(series.isna() | (series.astype("string").str.strip() == ""))
    elif operator in ("contains", "not_contains", "starts_with", "ends_with"):
        if value is None or str(value) == "":
            rejected.append(f"Ignored a text filter on '{column}' with no value.")
            return None, {}
        text = series.astype("string").str.lower()
        needle = str(value).strip().lower()
        if operator == "contains":
            masked = text.fillna("").str.contains(needle, regex=False)
        elif operator == "not_contains":
            masked = ~text.fillna("").str.contains(needle, regex=False)
        elif operator == "starts_with":
            masked = text.fillna("").str.startswith(needle)
        else:
            masked = text.fillna("").str.endswith(needle)
    elif operator in ("eq", "ne") and _kind_of(series) != "numeric":
        # Equality has to read the column the way it holds its values. "eq" on a
        # text column means string equality; coercing 'North America' to a float
        # would silently match nothing and report the filter as having run.
        if value is None:
            masked = series.isna() if operator == "eq" else series.notna()
        elif operator == "eq":
            masked = series.astype("string").str.strip().fillna("") == str(value).strip()
        else:
            # "Not equal" is scoped to rows that hold a value, using the same
            # definition of blank as `is_empty`. Otherwise every empty cell in a
            # region column appears under "not North America", and `eq` + `ne`
            # no longer partitions the non-blank rows the way a reader expects.
            blank = series.isna() | (series.astype("string").str.strip() == "")
            masked = ~blank & (series.astype("string").str.strip() != str(value).strip())
    else:
        # Numeric comparison. A non-numeric bound is rejected rather than
        # coerced, because "greater than abc" has no honest reading.
        bound = _to_number(value)
        if bound is None:
            rejected.append(f"Ignored a numeric filter on '{column}' with a non-numeric value.")
            return None, {}
        numeric = pd.to_numeric(series, errors="coerce")
        if operator == "eq":
            masked = numeric == bound
        elif operator == "ne":
            masked = numeric != bound
        elif operator == "gt":
            masked = numeric > bound
        elif operator == "gte":
            masked = numeric >= bound
        elif operator == "lt":
            masked = numeric < bound
        else:
            masked = numeric <= bound
        # A numeric filter on a text column with no numeric values matches
        # nothing, which is correct but unhelpful; say so.
        if masked.isna().all() or numeric.notna().sum() == 0:
            rejected.append(f"'{column}' holds no numeric values, so it was not filtered.")
            return None, {}

    return df[masked.fillna(False)], {
        "column": column,
        "operator": operator,
        "value": value,
    }


def _apply_sort(
    df: pd.DataFrame,
    column: str,
    direction: str,
    rejected: list[str],
) -> pd.DataFrame:
    """Sort by one column, falling back to the first column for ties.

    Without a stable tiebreak, paging through a sorted table can show or skip
    rows arbitrarily when many share the sort value — a quantity of 1 appearing
    40 times would shuffle between requests.
    """
    ascending = direction == "asc"
    work = df.copy()
    if str(work[column].dtype) == "object":
        # Mixed types cannot be compared; sort them as strings rather than
        # raising, which is what a reader would expect to see.
        work[column] = work[column].astype("string")

    tiebreak = next(
        (c for c in work.columns if str(c) != column and _kind_of(work[c]) != "constant"),
        None,
    )
    by = [column, tiebreak] if tiebreak else [column]
    try:
        return work.sort_values(by=by, ascending=ascending, kind="mergesort", na_position="last")
    except TypeError:
        rejected.append(f"Could not sort by '{column}'; rows are in their original order.")
        return df


# --- helpers -------------------------------------------------------------------


def _distinct_values_map(df: pd.DataFrame) -> dict[str, list[Any]]:
    """Per-column distinct values for the filter controls, capped per column."""
    result: dict[str, list[Any]] = {}
    limit = settings.explorer_distinct_values
    for column in df.columns:
        series = df[column]
        distinct = int(series.nunique(dropna=True))
        if not 1 < distinct <= limit:
            continue
        ordered = (
            series.dropna().sort_values().unique()
            if _kind_of(series) == "numeric"
            else series.dropna().value_counts().index
        )
        result[str(column)] = [_json_safe(v) for v in list(ordered)[:limit]]
    return result


def _kind_of(series: pd.Series) -> str:
    """One of ``numeric``, ``date``, ``text`` — what the client formats on."""
    if bool(pd.api.types.is_datetime64_any_dtype(series)):
        return "date"
    if bool(pd.api.types.is_numeric_dtype(series)) and not bool(
        pd.api.types.is_bool_dtype(series)
    ):
        return "numeric"
    return "text"


def _to_number(value: Any) -> float | None:
    """Parse a client-supplied bound, tolerating thousands separators."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        result = float(value)
        return result if result == result else None
    text = str(value).strip().replace(",", "").replace(" ", "")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _scalar(value: Any) -> float | None:
    """A single numeric value as a plain float, or None."""
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _json_safe(value: Any) -> Any:
    """Coerce a cell into something ``json.dumps`` accepts.

    Shared with the pipeline so a saved dataset's preview and a live explorer
    page encode missing values the same way.
    """
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, str)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if pd.isna(value):
        return None
    # Dates are sent as ISO strings: JSON has no date type, and a string is what
    # `new Date()` in the browser can actually parse.
    if isinstance(value, (pd.Timestamp,)):
        return None if pd.isna(value) else value.isoformat()
    to_pydatetime = getattr(value, "to_pydatetime", None)
    if callable(to_pydatetime):
        try:
            return to_pydatetime().isoformat()
        except (TypeError, ValueError):  # pragma: no cover - defensive
            return str(value)
    try:
        item = getattr(value, "item", None)
        if callable(item):
            return _json_safe(item())
    except (TypeError, ValueError):  # pragma: no cover - defensive
        pass
    return str(value)