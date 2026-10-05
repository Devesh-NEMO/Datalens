"""Tests for comparing two analyses.

Comparison is where a wrong number does the most damage: the reader sees
"revenue grew 40%" and has no way to check it. So most of what is pinned down
here is *refusing to say something*:

* **Absence is not a collapse.** A group missing from one file gets no change
  percentage at all. Turning it into −100% fabricates a measurement.
* **Name variants are not churn.** The same product spelled two ways must
  compare as one group, or every comparison reports phantom additions.
* **A group at zero in both files is flat, not new.** It was measured in both.
* **Incompatibility is explained.** Each reason names the field at fault and what
  would fix it.
* **The total's change is measured, not averaged.** The mean of per-group
  percentages is not the change in the total whenever group sizes differ.
"""

from __future__ import annotations

import copy

import pytest

from app.services.compare import check_compatible, compare_analyses


def analysis(
    *,
    groups: dict[str, float],
    kind: str = "sales",
    group_column: str = "product",
    value_column: str = "revenue",
    rows: int = 100,
    score: float = 100.0,
    period: str | None = "2025-12",
    other_period: str | None = "2025-11",
    column_names: list[str] | None = None,
) -> dict:
    """A minimal payload holding only the fields ``compare_analyses`` reads.

    Written to mirror the real response shape (``meta.rows``,
    ``growth.latest_period``, ``dataset_kind.kind``) because a fixture that
    invents its own shape tests the fixture, not the code.
    """
    total = sum(groups.values())
    items = [
        {
            "product": name,
            "value": value,
            "rank": index + 1,
            "value_share_pct": round(value / total * 100, 2) if total else 0.0,
            "cumulative_pct": 0.0,
            "abc_class": "A" if index < 2 else "B",
        }
        for index, (name, value) in enumerate(sorted(groups.items(), key=lambda kv: -kv[1]))
    ]
    payload = {
        "dataset_kind": {"kind": kind, "label": kind},
        "selection": {
            "product_column": group_column,
            "value_column": value_column,
            "date_column": "date" if period else None,
        },
        "meta": {"rows": rows},
        "profile": {
            "row_count": rows,
            "column_count": 5,
            "columns": [{"name": n} for n in (column_names or [group_column, value_column, "date"])],
        },
        "quality": {"score": score, "issues": []},
        "ranking": {"total_value": total, "product_count": len(groups), "items": items},
        "growth": {"latest_period": period, "previous_period": other_period, "items": []},
    }
    return payload


@pytest.fixture
def baseline() -> dict:
    return analysis(groups={"Alpha": 600.0, "Beta": 300.0, "Gamma": 100.0}, period="2025-11")


@pytest.fixture
def later() -> dict:
    return analysis(groups={"Alpha": 660.0, "Beta": 300.0, "Gamma": 90.0}, period="2025-12", rows=110)


# --- movement -------------------------------------------------------------------


def test_an_unchanged_group_is_flat(baseline: dict, later: dict) -> None:
    flat = {item.name: item for item in compare_analyses(baseline, later).flat}
    assert flat["Beta"].status == "flat"
    assert flat["Beta"].change_pct == 0.0


def test_a_rise_and_a_fall_are_separated(baseline: dict, later: dict) -> None:
    result = compare_analyses(baseline, later)
    assert {i.name: i.change_pct for i in result.grew} == {"Alpha": pytest.approx(10.0)}
    assert {i.name: i.change_pct for i in result.fell} == {"Gamma": pytest.approx(-10.0)}
    assert len(result.flat) == 1


def test_the_total_change_is_measured_not_averaged(baseline: dict) -> None:
    """Averaging per-group percentages would report +33% here. The truth is +20%.

    Alpha moved 500→900 (+80%), Beta and Gamma unchanged, so the mean of the
    three group percentages is +26.7% while the total moved 1000→1300.
    """
    result = compare_analyses(
        baseline, analysis(groups={"Alpha": 900.0, "Beta": 300.0, "Gamma": 100.0}, period="2025-12")
    )
    assert result.total_change == pytest.approx(300.0)
    assert result.total_change_pct == pytest.approx(30.0)


def test_groups_are_ranked_by_the_size_of_the_move(baseline: dict) -> None:
    """The top row must be the change that moved the total, not the alphabetically first."""
    result = compare_analyses(
        baseline,
        analysis(groups={"Alpha": 601.0, "Beta": 300.0, "Gamma": 100.0, "Zeta": 500.0}, period="2025-12"),
    )
    assert result.groups[0].name == "Zeta"


def test_shares_are_reported_on_both_sides(baseline: dict, later: dict) -> None:
    alpha = next(i for i in compare_analyses(baseline, later).grew)
    assert alpha.baseline_share_pct == pytest.approx(60.0, abs=0.01)
    assert alpha.comparison_share_pct is not None


# --- absence --------------------------------------------------------------------


def test_a_vanished_group_gets_no_percentage(baseline: dict) -> None:
    """Gamma left the file. Saying −100% would assert a collapse nobody measured."""
    removed = {i.name: i for i in compare_analyses(
        baseline, analysis(groups={"Alpha": 600.0, "Beta": 300.0}, period="2025-12")
    ).removed}
    assert "Gamma" in removed
    assert removed["Gamma"].change_pct is None
    assert removed["Gamma"].baseline_value == pytest.approx(100.0)


def test_a_new_group_gets_no_percentage(baseline: dict) -> None:
    added = {i.name: i for i in compare_analyses(
        baseline,
        analysis(groups={"Alpha": 600.0, "Beta": 300.0, "Gamma": 100.0, "Delta": 50.0}, period="2025-12"),
    ).added}
    assert "Delta" in added
    assert added["Delta"].change_pct is None


def test_a_group_present_in_both_is_never_reported_as_new(baseline: dict, later: dict) -> None:
    result = compare_analyses(baseline, later)
    assert result.added == []
    assert result.removed == []


def test_a_group_at_zero_in_both_files_is_flat() -> None:
    """It was measured in both. Reporting it as "new" invents an addition."""
    zero = {"Alpha": 600.0, "Beta": 300.0, "Gamma": 0.0}
    result = compare_analyses(
        analysis(groups=zero, period="2025-11"), analysis(groups=zero, period="2025-12")
    )
    flat = {i.name: i for i in result.flat}
    assert "Gamma" in flat
    assert result.added == []
    assert result.grew == []


def test_a_group_falling_to_zero_is_a_fall_not_a_removal() -> None:
    """0 was a measured value here, so this is a collapse to nothing, not the
    group disappearing from the file."""
    result = compare_analyses(
        analysis(groups={"Alpha": 600.0, "Gamma": 100.0}, period="2025-11"),
        analysis(groups={"Alpha": 600.0, "Gamma": 0.0}, period="2025-12"),
    )
    gamma = next(i for i in result.fell if i.name == "Gamma")
    assert gamma.change_pct == pytest.approx(-100.0)
    assert result.removed == []


def test_a_group_rising_from_zero_is_a_growth_with_no_percentage(baseline: dict) -> None:
    """0 → 100 is not +infinity%. The UI shows the absolute move and says why."""
    result = compare_analyses(
        baseline, analysis(groups={"Alpha": 600.0, "Beta": 300.0, "Gamma": 100.0}, period="2025-12")
    )
    zero_before = compare_analyses(
        analysis(groups={"Alpha": 600.0, "Beta": 300.0, "Gamma": 0.0}, period="2025-11"),
        analysis(groups={"Alpha": 600.0, "Beta": 300.0, "Gamma": 100.0}, period="2025-12"),
    )
    gamma = next(i for i in zero_before.grew if i.name == "Gamma")
    assert gamma.baseline_value == 0.0
    assert gamma.change_pct is None
    assert gamma.absolute_change == pytest.approx(100.0)
    assert result.compatible


# --- name canonicalisation ------------------------------------------------------


def test_case_and_padding_variants_compare_as_one_group() -> None:
    """The same product spelled three ways in two files is not one group added
    and one removed."""
    result = compare_analyses(
        analysis(groups={"MacBook Pro 16": 500.0, "Beta": 100.0}, period="2025-11"),
        analysis(groups={"  macbook pro 16  ": 550.0, "beta": 100.0}, period="2025-12"),
    )
    assert result.added == []
    assert result.removed == []
    assert len(result.grew) == 1
    assert result.grew[0].change_pct == pytest.approx(10.0)


def test_the_baseline_spelling_wins_for_the_label() -> None:
    result = compare_analyses(
        analysis(groups={"MacBook Pro 16": 500.0}, period="2025-11"),
        analysis(groups={"macbook pro 16": 550.0}, period="2025-12"),
    )
    assert result.grew[0].name == "MacBook Pro 16"


def test_a_shouted_variant_is_not_chosen_as_the_label() -> None:
    result = compare_analyses(
        analysis(groups={"Ergonomic Chair": 500.0}, period="2025-11"),
        analysis(groups={"ERGONOMIC CHAIR": 550.0}, period="2025-12"),
    )
    assert result.grew[0].name == "Ergonomic Chair"


def test_canonicalisation_survives_the_truncated_top_n() -> None:
    """`items` is used, not `top_n` — comparing truncated lists would invent
    changes simply because one file asked for fewer rows."""
    before = analysis(groups={f"G{n}": float(n) for n in range(1, 21)}, period="2025-11")
    after = analysis(groups={f"G{n}": float(n) for n in range(1, 21)}, period="2025-12")
    before["ranking"]["top_n"] = before["ranking"]["items"][:3]
    result = compare_analyses(before, after)
    assert result.added == [] and result.removed == []
    assert result.baseline_group_count == 20


# --- incompatibility ------------------------------------------------------------


def test_mismatched_kinds_are_incompatible() -> None:
    problems = check_compatible(
        analysis(groups={"A": 1.0}, kind="sales"), analysis(groups={"A": 1.0}, kind="inventory")
    )
    assert [p.code for p in problems] == ["dataset_kind"]
    assert problems[0].explanation
    assert problems[0].suggestion


def test_generic_does_not_conflict_with_a_recognised_kind() -> None:
    """Old payloads have no `dataset_kind`; they must not all become
    incomparable with each other the moment the field exists."""
    old = analysis(groups={"A": 1.0}, kind="sales")
    old.pop("dataset_kind")
    assert check_compatible(old, analysis(groups={"A": 2.0})) == []


def test_mismatched_group_columns_are_incompatible() -> None:
    problems = check_compatible(
        analysis(groups={"A": 1.0}, group_column="product"),
        analysis(groups={"A": 1.0}, group_column="customer"),
    )
    assert [p.code for p in problems] == ["group_column"]
    assert "customer" in problems[0].explanation
    assert problems[0].field == "selection.product_column"


def test_mismatched_measure_columns_are_incompatible() -> None:
    problems = check_compatible(
        analysis(groups={"A": 1.0}, value_column="revenue"),
        analysis(groups={"A": 1.0}, value_column="cost"),
    )
    assert [p.code for p in problems] == ["measure_column"]
    assert "revenue" in problems[0].explanation


def test_files_sharing_no_column_names_are_incompatible() -> None:
    problems = check_compatible(
        analysis(groups={"A": 1.0}, group_column="widget", value_column="amount", column_names=["widget", "amount"]),
        analysis(groups={"B": 1.0}, group_column="sprocket", value_column="cost", column_names=["sprocket", "cost"]),
    )
    assert "no_shared_columns" in [p.code for p in problems]


def test_a_compatible_pair_raises_nothing() -> None:
    assert check_compatible(analysis(groups={"A": 1.0}), analysis(groups={"A": 2.0})) == []


def test_every_reason_says_how_to_fix_it() -> None:
    """A refusal with no next step is just a dead end for the reader."""
    problems = check_compatible(
        analysis(groups={"A": 1.0}, kind="sales", group_column="product"),
        analysis(groups={"A": 1.0}, kind="inventory", group_column="customer", value_column="cost"),
    )
    assert len(problems) >= 2
    for problem in problems:
        assert problem.suggestion.strip()
        assert problem.explanation.strip()


def test_incompatible_datasets_report_no_movement() -> None:
    """Totals are still shown so the reader can see what they gave up, but no
    per-group comparison is fabricated."""
    result = compare_analyses(
        analysis(groups={"A": 100.0}, kind="sales"), analysis(groups={"A": 500.0}, kind="inventory")
    )
    assert result.compatible is False
    assert result.groups == []
    assert result.grew == [] and result.fell == []
    assert result.baseline_total == pytest.approx(100.0)
    assert result.comparison_total == pytest.approx(500.0)


# --- reliability ----------------------------------------------------------------


def test_two_files_ending_in_the_same_period_are_flagged() -> None:
    """Comparing December against December answers a question nobody asked."""
    result = compare_analyses(analysis(groups={"A": 100.0}, period="2025-12"), analysis(groups={"A": 100.0}, period="2025-12"))
    assert result.reliable is False
    assert any("same period" in note for note in result.reliability_notes)


def test_different_periods_are_reliable(baseline: dict, later: dict) -> None:
    result = compare_analyses(baseline, later)
    assert result.reliable is True
    assert result.reliability_notes == []


def test_a_missing_date_column_is_explained() -> None:
    result = compare_analyses(analysis(groups={"A": 100.0}, period=None), analysis(groups={"A": 100.0}, period="2025-12"))
    assert any("date" in note for note in result.reliability_notes)


def test_a_row_count_jump_is_noted() -> None:
    result = compare_analyses(
        analysis(groups={"A": 100.0}, rows=100, period="2025-11"),
        analysis(groups={"A": 100.0}, rows=1000, period="2025-12"),
    )
    assert result.reliable is False
    assert any("rows" in note for note in result.reliability_notes)


def test_a_small_row_count_difference_is_silent() -> None:
    result = compare_analyses(
        analysis(groups={"A": 100.0}, rows=100, period="2025-11"),
        analysis(groups={"A": 100.0}, rows=110, period="2025-12"),
    )
    assert not any("rows" in note for note in result.reliability_notes)


def test_a_large_quality_gap_is_noted() -> None:
    result = compare_analyses(
        analysis(groups={"A": 100.0}, score=100.0, period="2025-11"),
        analysis(groups={"A": 100.0}, score=70.0, period="2025-12"),
    )
    assert result.reliable is False
    assert any("quality" in note for note in result.reliability_notes)


def test_a_small_quality_difference_is_silent() -> None:
    result = compare_analyses(
        analysis(groups={"A": 100.0}, score=100.0, period="2025-11"),
        analysis(groups={"A": 100.0}, score=96.0, period="2025-12"),
    )
    assert result.reliable is True


# --- limits and safety ----------------------------------------------------------


def test_the_ranked_list_respects_a_limit(baseline: dict) -> None:
    many = {f"G{n}": float(n) for n in range(1, 30)}
    result = compare_analyses(
        baseline, analysis(groups=many, period="2025-12"), limit=10
    )
    assert len(result.groups) == 10


def test_a_zero_baseline_total_yields_no_percentage() -> None:
    """0 → 500 has no meaningful percentage; the totals still tell the story."""
    result = compare_analyses(analysis(groups={"A": 0.0}, period="2025-11"), analysis(groups={"A": 500.0}, period="2025-12"))
    assert result.total_change == pytest.approx(500.0)
    assert result.total_change_pct is None


def test_a_comparison_never_mutates_its_inputs() -> None:
    """These payloads are cached and re-read for the dashboard; corrupting one
    would silently change what every other page shows."""
    before = analysis(groups={"Alpha": 600.0, "Beta": 300.0}, period="2025-11")
    after = analysis(groups={"Alpha": 660.0, "Beta": 300.0}, period="2025-12")
    snapshot = copy.deepcopy((before, after))
    compare_analyses(before, after)
    assert (before, after) == snapshot


def test_the_result_is_json_safe(baseline: dict, later: dict) -> None:
    import json

    json.dumps(compare_analyses(baseline, later).to_dict(), allow_nan=False)


def test_a_missing_ranking_section_degrades_quietly() -> None:
    """An old payload with no ranking must not raise from a comparison page."""
    empty = {"selection": {"product_column": "product", "value_column": "revenue"}}
    result = compare_analyses(empty, empty)
    assert result.compatible is True
    assert result.groups == []
    assert result.baseline_total == 0.0