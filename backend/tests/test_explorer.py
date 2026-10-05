"""Tests for the server-side data explorer.

The explorer's contract has three parts worth pinning down, and each corresponds
to a decision that is easy to regress:

* **Pagination is real.** Asking for page 3 of a 10-row-per-page table returns
  rows 21–30, and asking past the end returns the last page rather than nothing.
* **Bad input degrades, it does not fail.** An unknown column or a nonsensical
  operator comes back in ``rejected`` with the table still rendered, because the
  alternative costs the user their table over one misconfigured dropdown.
* **Sorts are stable.** Paging through a column with many ties must not show or
  skip rows between requests.
"""

from __future__ import annotations

import pandas as pd
import pytest

from app.services.explorer import (
    MAX_PAGE_SIZE,
    describe_columns,
    explore_frame,
)


@pytest.fixture
def frame() -> pd.DataFrame:
    """A frame with the awkward cases: ties, blanks, mixed types, duplicates."""
    return pd.DataFrame(
        {
            "order_id": [f"O-{n:03d}" for n in range(1, 13)],
            "date": pd.date_range("2025-01-31", periods=12, freq="ME").tolist(),
            "product": ["Widget"] * 3 + ["Gadget"] * 3 + ["Gizmo"] * 3 + ["Doodad"] * 3,
            "region": ["North", "South", "", "North", "South", "East", None, "North", "", "West", "North", "South"],
            "quantity": [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4],
            "revenue": [100.0, 100.0, 100.0, 250.0, 250.0, 250.0, 90.0, 90.0, 90.0, 40.0, 40.0, 40.0],
        }
    )


# --- columns --------------------------------------------------------------------


def test_describe_columns_reports_kind_and_counts(frame: pd.DataFrame) -> None:
    metas = {m.name: m for m in describe_columns(frame)}
    assert metas["revenue"].kind == "numeric"
    assert metas["date"].kind == "date"
    assert metas["product"].kind == "text"
    assert metas["quantity"].distinct_count == 4
    assert metas["revenue"].minimum == 40.0
    assert metas["revenue"].maximum == 250.0
    # Only the None cell is *missing*; the "" cell holds a value that happens to
    # be blank. The filters treat both as blank, but the column profile reports
    # what is literally absent — a spreadsheet shows them differently too.
    assert metas["region"].missing_count == 1


def test_describe_columns_caps_the_filter_dropdown(frame: pd.DataFrame) -> None:
    """A high-cardinality column offers no dropdown rather than a huge one."""
    many = pd.DataFrame({"id": [f"v{n}" for n in range(500)]})
    meta = describe_columns(many)[0]
    assert meta.distinct_count == 500
    assert meta.distinct_values == []


def test_describe_columns_orders_numeric_dropdowns(frame: pd.DataFrame) -> None:
    meta = {m.name: m for m in describe_columns(frame)}["quantity"]
    assert meta.distinct_values == [1, 2, 3, 4]


# --- pagination -----------------------------------------------------------------


def test_pages_do_not_overlap_and_cover_everything(frame: pd.DataFrame) -> None:
    first = explore_frame(frame, page=1, page_size=5, sort="revenue", direction="desc")
    second = explore_frame(frame, page=2, page_size=5, sort="revenue", direction="desc")
    third = explore_frame(frame, page=3, page_size=5, sort="revenue", direction="desc")

    assert first.page_count == 3
    assert first.total_rows == 12
    # 12 rows over pages of 5 is 5 / 5 / 2 — the last page is short, not padded,
    # because inventing five phantom rows would break every column sum below it.
    assert [len(p.rows) for p in (first, second, third)] == [5, 5, 2]

    revenue = frame.columns.tolist().index("revenue")
    ids = frame.columns.tolist().index("order_id")
    seen = [row[revenue] for page in (first, second, third) for row in page.rows]
    assert sorted(seen) == sorted(frame["revenue"].tolist())

    # The stronger property: every row id exactly once. Value multiset equality
    # alone would pass even if one row were served twice and another dropped.
    served = [row[ids] for page in (first, second, third) for row in page.rows]
    assert sorted(served) == sorted(frame["order_id"].tolist())


def test_page_past_the_end_lands_on_the_last_page(frame: pd.DataFrame) -> None:
    """Deleting rows while on page 9 must not blank the table."""
    result = explore_frame(frame, page=99, page_size=5)
    assert result.page == result.page_count == 3
    assert len(result.rows) == 2


def test_page_size_is_capped_in_code(frame: pd.DataFrame) -> None:
    """The schema documents the limit; this enforces it for any caller."""
    assert explore_frame(frame, page_size=100_000).page_size == MAX_PAGE_SIZE
    assert explore_frame(frame, page_size=0).page_size >= 1


def test_empty_frame_reports_no_pages() -> None:
    result = explore_frame(pd.DataFrame({"a": []}))
    assert result.total_rows == 0
    assert result.page_count == 0
    assert result.rows == []


# --- sorting --------------------------------------------------------------------


def test_sort_is_stable_across_repeated_requests(frame: pd.DataFrame) -> None:
    """Four rows share quantity 1; paging must not shuffle them between calls."""
    first = explore_frame(frame, page=1, page_size=4, sort="quantity")
    again = explore_frame(frame, page=1, page_size=4, sort="quantity")
    assert first.rows == again.rows


def test_nulls_sort_last_in_both_directions(frame: pd.DataFrame) -> None:
    region = frame.columns.tolist().index("region")
    ascending = explore_frame(frame, page_size=12, sort="region", direction="asc")
    descending = explore_frame(frame, page_size=12, sort="region", direction="desc")
    assert ascending.rows[-1][region] is None
    assert descending.rows[-1][region] is None


def test_unknown_sort_column_is_reported_not_fatal(frame: pd.DataFrame) -> None:
    result = explore_frame(frame, page_size=3, sort="does_not_exist")
    assert len(result.rows) == 3
    assert any("does_not_exist" in note for note in result.rejected)
    assert result.sort_column is None


# --- filtering ------------------------------------------------------------------


def test_equality_on_a_text_column(frame: pd.DataFrame) -> None:
    """`eq` on text must compare strings; coercing to float would match nothing."""
    region = frame.columns.tolist().index("region")
    result = explore_frame(frame, page_size=20, filters=[{"column": "region", "operator": "eq", "value": "North"}])
    assert result.total_rows == 4
    assert {row[region] for row in result.rows} == {"North"}


def test_inequality_excludes_blanks(frame: pd.DataFrame) -> None:
    """`ne` a region must not list every empty cell as "not that region".

    The frame holds 4 North, 3 South, 1 East, 1 West, and 2 blanks, so the
    answer is 5 — and crucially ``eq`` + ``ne`` equals ``is_not_empty``, which is
    the arithmetic a reader expects when they build those filters themselves.
    """
    result = explore_frame(frame, page_size=20, filters=[{"column": "region", "operator": "ne", "value": "North"}])
    eq = explore_frame(frame, page_size=20, filters=[{"column": "region", "operator": "eq", "value": "North"}])
    filled = explore_frame(frame, page_size=20, filters=[{"column": "region", "operator": "is_not_empty"}])

    assert eq.total_rows == 4
    assert result.total_rows == 5
    assert eq.total_rows + result.total_rows == filled.total_rows


def test_numeric_comparisons(frame: pd.DataFrame) -> None:
    """revenue holds 100 and 250 three times each, then 90 and 40 three times each."""
    above = explore_frame(frame, page_size=20, filters=[{"column": "revenue", "operator": "gt", "value": 100}])
    at_least = explore_frame(frame, page_size=20, filters=[{"column": "revenue", "operator": "gte", "value": 100}])
    below = explore_frame(frame, page_size=20, filters=[{"column": "revenue", "operator": "lt", "value": 100}])
    assert above.total_rows == 3  # 250
    assert at_least.total_rows == 6  # 100 and 250
    assert below.total_rows == 6  # 90 and 40
    # `gt` and `lte` must partition; a gap here would silently drop rows.
    lte = explore_frame(frame, page_size=20, filters=[{"column": "revenue", "operator": "lte", "value": 100}])
    assert above.total_rows + lte.total_rows == len(frame)


def test_empty_and_not_empty(frame: pd.DataFrame) -> None:
    empty = explore_frame(frame, page_size=20, filters=[{"column": "region", "operator": "is_empty"}])
    filled = explore_frame(frame, page_size=20, filters=[{"column": "region", "operator": "is_not_empty"}])
    assert empty.total_rows == 3
    assert filled.total_rows == 9
    assert empty.total_rows + filled.total_rows == len(frame)


def test_text_predicates(frame: pd.DataFrame) -> None:
    """Widget/Gadget/Gizmo/Doodad, three rows each."""
    contains = explore_frame(frame, page_size=20, filters=[{"column": "product", "operator": "contains", "value": "idg"}])
    starts = explore_frame(frame, page_size=20, filters=[{"column": "product", "operator": "starts_with", "value": "d"}])
    ends = explore_frame(frame, page_size=20, filters=[{"column": "product", "operator": "ends_with", "value": "t"}])
    not_contains = explore_frame(
        frame, page_size=20, filters=[{"column": "product", "operator": "not_contains", "value": "i"}]
    )
    assert contains.total_rows == 3  # Gadget
    assert starts.total_rows == 3  # Doodad
    assert ends.total_rows == 6  # Widget + Gadget
    assert not_contains.total_rows == 6  # Gadget + Doodad
    # `starts_with "d"` must not match "Doodad" via a substring search, and
    # `contains "ad"` must not match case-sensitively by accident.
    assert (
        explore_frame(
            frame, page_size=20, filters=[{"column": "product", "operator": "contains", "value": "Dood"}]
        ).total_rows
        == 3
    )


def test_filters_combine_with_and(frame: pd.DataFrame) -> None:
    both = explore_frame(
        frame,
        page_size=20,
        filters=[
            {"column": "region", "operator": "eq", "value": "North"},
            {"column": "revenue", "operator": "gt", "value": 100},
        ],
    )
    assert both.total_rows == 1


def test_numeric_filter_on_a_text_column_is_reported(frame: pd.DataFrame) -> None:
    result = explore_frame(frame, page_size=3, filters=[{"column": "region", "operator": "gt", "value": "abc"}])
    assert len(result.rows) == 3
    assert any("region" in note for note in result.rejected)


def test_numeric_filter_accepts_a_formatted_bound(frame: pd.DataFrame) -> None:
    """A bound pasted out of a spreadsheet arrives as "1,234.50", not 1234.5."""
    plain = explore_frame(frame, page_size=20, filters=[{"column": "revenue", "operator": "gt", "value": 100}])
    formatted = explore_frame(frame, page_size=20, filters=[{"column": "revenue", "operator": "gt", "value": "100.00"}])
    grouped = explore_frame(frame, page_size=20, filters=[{"column": "revenue", "operator": "gt", "value": "1,00"}])
    assert plain.total_rows == formatted.total_rows == grouped.total_rows == 3


def test_filter_on_an_unknown_column_is_ignored(frame: pd.DataFrame) -> None:
    result = explore_frame(frame, page_size=3, filters=[{"column": "nope", "operator": "eq", "value": 1}])
    assert result.total_rows == 12
    assert any("nope" in note for note in result.rejected)


def test_unknown_operator_is_ignored(frame: pd.DataFrame) -> None:
    result = explore_frame(frame, page_size=3, filters=[{"column": "revenue", "operator": "sql_injection"}])
    assert result.total_rows == 12
    assert any("sql_injection" in note for note in result.rejected)


def test_filtered_out_reports_what_the_filters_hid(frame: pd.DataFrame) -> None:
    result = explore_frame(frame, page_size=20, filters=[{"column": "region", "operator": "eq", "value": "North"}])
    assert result.total_rows == 4
    assert result.filtered_out == 8


# --- search ---------------------------------------------------------------------


def test_search_matches_text_columns_case_insensitively(frame: pd.DataFrame) -> None:
    result = explore_frame(frame, page_size=20, search="gadget")
    assert result.total_rows == 3
    assert result.search == "gadget"


def test_search_defaults_to_text_columns_only(frame: pd.DataFrame) -> None:
    """Default search covers text columns, not numbers or dates.

    Searching every column would make "250" match a price nobody can see, and
    make an empty result look like a data problem rather than a wrong query.
    """
    by_number = explore_frame(frame, page_size=20, search="250")
    assert by_number.total_rows == 0

    # ...and a text column is still reachable without naming it.
    assert explore_frame(frame, page_size=20, search="doodad").total_rows == 3


def test_search_names_the_columns_it_scanned(frame: pd.DataFrame) -> None:
    """A user who searched three columns and got nothing needs to know which."""
    result = explore_frame(frame, page_size=20, search="widget")
    assert set(result.search_columns) >= {"product"}
    assert "revenue" not in result.search_columns


def test_search_can_target_named_columns(frame: pd.DataFrame) -> None:
    result = explore_frame(frame, page_size=20, search="O-001", search_columns=["order_id"])
    assert result.total_rows == 1


def test_search_on_an_unknown_column_is_reported(frame: pd.DataFrame) -> None:
    result = explore_frame(frame, page_size=3, search="x", search_columns=["nope"])
    assert any("nope" in note for note in result.rejected)


def test_search_term_is_trimmed(frame: pd.DataFrame) -> None:
    assert explore_frame(frame, search="   gadget  ").search == "gadget"


# --- safety ---------------------------------------------------------------------


def test_page_rows_are_json_safe(frame: pd.DataFrame) -> None:
    """NaT and NaN must not reach the client as invalid JSON tokens."""
    import json

    result = explore_frame(frame, page_size=12, sort="date")
    # Raises if a NaN or NaT leaked through.
    json.dumps(result.to_dict(), allow_nan=False)


def test_values_arriving_as_text_still_sort(frame: pd.DataFrame) -> None:
    """Mixed types cannot be compared; sorting as text beats raising."""
    mixed = pd.DataFrame({"a": [1, "two", 3.0, None], "b": [1, 2, 3, 4]})
    result = explore_frame(mixed, page_size=10, sort="a")
    assert result.total_rows == 4
