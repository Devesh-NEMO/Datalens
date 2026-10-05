"""Compare two analyses, and explain clearly when they cannot be compared.

Comparing two datasets is only meaningful when they measure the same thing. A
November sales file and a December sales file can be compared row by row on
product. A sales file and an HR file cannot, and neither can a sales file whose
rows are individual orders against one whose rows are monthly totals — the totals
would look comparable and mean different things.

So this module checks compatibility *first* and refuses when the check fails,
naming the specific column or grain that differs. A comparison that quietly
subtracts two incompatible numbers is worse than no comparison, because the
result looks like an answer.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

#: Group names whose value moves by less than this percentage are reported as
#: "flat" rather than as a rise or fall. A change that rounds to the same number
#: is not a movement worth explaining.
FLAT_CHANGE_PCT = 0.05

#: Groups whose share of either total is below this are listed separately as
#: new/disappeared rather than ranked against everything else.
MIN_SHARE_PCT = 0.01


@dataclass
class GroupChange:
    """One group's movement between the two datasets."""

    name: str
    #: 0 when the group is absent from the left dataset, which is not the same
    #: as a value of zero and must not be turned into -100%.
    baseline_value: float
    comparison_value: float
    absolute_change: float
    #: None when the group is new, because there is no baseline to divide by.
    change_pct: float | None
    status: str  # "grew", "fell", "flat", "new", "gone"
    baseline_share_pct: float | None = None
    comparison_share_pct: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "baseline_value": round(self.baseline_value, 2),
            "comparison_value": round(self.comparison_value, 2),
            "absolute_change": round(self.absolute_change, 2),
            "change_pct": round(self.change_pct, 2) if self.change_pct is not None else None,
            "status": self.status,
            "baseline_share_pct": (
                round(self.baseline_share_pct, 2)
                if self.baseline_share_pct is not None
                else None
            ),
            "comparison_share_pct": (
                round(self.comparison_share_pct, 2)
                if self.comparison_share_pct is not None
                else None
            ),
        }


@dataclass
class Incompatibility:
    """One reason two datasets cannot be compared, in plain language."""

    code: str
    field: str
    explanation: str
    #: How to make them comparable.
    suggestion: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "field": self.field,
            "explanation": self.explanation,
            "suggestion": self.suggestion,
        }


@dataclass
class ComparisonResult:
    """A comparison, or the reasons one is impossible."""

    compatible: bool
    incompatibilities: list[Incompatibility] = field(default_factory=list)
    #: True when the datasets match closely enough that the answer is stable.
    reliable: bool = True
    #: Why the answer may be less than trustworthy even though it is comparable.
    reliability_notes: list[str] = field(default_factory=list)

    baseline_total: float = 0.0
    comparison_total: float = 0.0
    total_change: float = 0.0
    #: None only when the baseline total is zero.
    total_change_pct: float | None = None
    baseline_group_count: int = 0
    comparison_group_count: int = 0

    groups: list[GroupChange] = field(default_factory=list)
    grew: list[GroupChange] = field(default_factory=list)
    fell: list[GroupChange] = field(default_factory=list)
    added: list[GroupChange] = field(default_factory=list)
    removed: list[GroupChange] = field(default_factory=list)
    flat: list[GroupChange] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "compatible": self.compatible,
            "incompatibilities": [i.to_dict() for i in self.incompatibilities],
            "reliable": self.reliable,
            "reliability_notes": list(self.reliability_notes),
            "baseline_total": round(self.baseline_total, 2),
            "comparison_total": round(self.comparison_total, 2),
            "total_change": round(self.total_change, 2),
            "total_change_pct": (
                round(self.total_change_pct, 2) if self.total_change_pct is not None else None
            ),
            "baseline_group_count": self.baseline_group_count,
            "comparison_group_count": self.comparison_group_count,
            "groups": [g.to_dict() for g in self.groups],
            "grew": [g.to_dict() for g in self.grew],
            "fell": [g.to_dict() for g in self.fell],
            "added": [g.to_dict() for g in self.added],
            "removed": [g.to_dict() for g in self.removed],
            "flat": [g.to_dict() for g in self.flat],
        }


def compare_analyses(
    baseline: Any,
    comparison: Any,
    *,
    limit: int | None = None,
) -> ComparisonResult:
    """Compare two analysis payloads, or explain why they cannot be compared.

    Takes the same response objects ``/v1/analyze`` returns, so the comparison
    page can be handed two saved analyses without re-reading either file.
    """
    base = _as_dict(baseline)
    other = _as_dict(comparison)

    problems = check_compatible(base, other)

    base_total = _number(_dig(base, "ranking", "total_value")) or 0.0
    other_total = _number(_dig(other, "ranking", "total_value")) or 0.0

    base_groups = _group_totals(base)
    other_groups = _group_totals(other)

    notes: list[str] = []
    reliable = True

    if problems:
        return ComparisonResult(
            compatible=False,
            incompatibilities=problems,
            reliable=False,
            baseline_total=base_total,
            comparison_total=other_total,
            baseline_group_count=len(base_groups),
            comparison_group_count=len(other_groups),
        )

    # A comparison across very different row counts is arithmetically fine but
    # rarely what someone means, so it is flagged rather than presented as a
    # like-for-like result.
    base_rows = _number(_dig(base, "meta", "rows")) or 0.0
    other_rows = _number(_dig(other, "meta", "rows")) or 0.0
    if base_rows and other_rows:
        ratio = max(base_rows, other_rows) / min(base_rows, other_rows)
        if ratio >= 1.5:
            reliable = False
            notes.append(
                f"These files hold {int(base_rows):,} and {int(other_rows):,} rows. The "
                "per-group figures are still comparable, but the difference may be the number "
                "of rows recorded rather than a real change in performance."
            )

    quality_gap = abs(
        (_number(_dig(base, "quality", "score")) or 0.0)
        - (_number(_dig(other, "quality", "score")) or 0.0)
    )
    if quality_gap >= 20:
        reliable = False
        notes.append(
            f"The two files differ in data quality by {quality_gap:.0f} points, so part of "
            "the difference may come from how each was parsed."
        )

    period_a = _dig(base, "growth", "latest_period")
    period_b = _dig(other, "growth", "latest_period")
    if not period_a or not period_b:
        notes.append(
            "One of these files has no usable date column, so this compares whole-file "
            "totals rather than matched periods."
        )
    elif str(period_a) == str(period_b):
        reliable = False
        notes.append(
            f"Both files end in the same period ({period_a}). If one is meant to be an "
            "updated export rather than a different period, they may overlap and the "
            "difference will understate the change."
        )

    changes = _diff_groups(base_groups, other_groups, base_total, other_total)
    # One label per group across both files, preferring the baseline's spelling.
    labels: dict[str, str] = {}
    for key, (_total, name) in other_groups.items():
        labels.setdefault(key, name)
    for key, (_total, name) in base_groups.items():
        labels[key] = name
    for change in changes:
        change.name = labels.get(change.name, change.name)

    # Ordered by the size of the absolute move, so the top of the list is the
    # change that actually moved the total rather than the alphabetically first.
    ranked = sorted(
        changes,
        key=lambda c: (-abs(c.absolute_change), c.name.lower()),
    )
    if limit is not None and limit > 0:
        ranked = ranked[:limit]

    grew = [c for c in ranked if c.status == "grew"]
    fell = [c for c in ranked if c.status == "fell"]
    added = sorted(
        (c for c in ranked if c.status == "new"),
        key=lambda c: -c.comparison_value,
    )
    removed = sorted(
        (c for c in ranked if c.status == "gone"),
        key=lambda c: -c.baseline_value,
    )
    flat = [c for c in ranked if c.status == "flat"]

    total_change = other_total - base_total
    return ComparisonResult(
        compatible=True,
        reliable=reliable,
        reliability_notes=notes,
        baseline_total=base_total,
        comparison_total=other_total,
        total_change=total_change,
        total_change_pct=(
            total_change / abs(base_total) * 100.0 if base_total else None
        ),
        baseline_group_count=len(base_groups),
        comparison_group_count=len(other_groups),
        groups=ranked,
        grew=grew,
        fell=fell,
        added=added,
        removed=removed,
        flat=flat,
    )


def check_compatible(baseline: dict[str, Any], comparison: dict[str, Any]) -> list[Incompatibility]:
    """Return every reason the two datasets cannot be compared.

    An empty list means the comparison is meaningful. Each problem names the
    field at fault and says what would fix it, because "incompatible" on its own
    tells the reader nothing about what to do next.
    """
    problems: list[Incompatibility] = []

    base_kind = str(_dig(baseline, "dataset_kind", "kind") or "generic")
    other_kind = str(_dig(comparison, "dataset_kind", "kind") or "generic")
    if base_kind != other_kind and "generic" not in (base_kind, other_kind):
        problems.append(
            Incompatibility(
                code="dataset_kind",
                field="dataset_kind",
                explanation=(
                    f"The first file is recognised as "
                    f"{_dig(baseline, 'dataset_kind', 'label')} and the second as "
                    f"{_dig(comparison, 'dataset_kind', 'label')}. They describe different "
                    "kinds of record, so their totals do not measure the same thing."
                ),
                suggestion=(
                    "Compare two files of the same kind — two periods of sales, or two "
                    "quarters of marketing spend."
                ),
            )
        )

    base_group = str(_dig(baseline, "selection", "product_column") or "")
    other_group = str(_dig(comparison, "selection", "product_column") or "")
    if base_group and other_group and base_group != other_group:
        problems.append(
            Incompatibility(
                code="group_column",
                field="selection.product_column",
                explanation=(
                    f"The first file groups by '{base_group}' and the second by "
                    f"'{other_group}'. A group named the same way in both files is not "
                    "necessarily the same thing."
                ),
                suggestion=(
                    "Select the same grouping column in both files on the Columns page "
                    "before comparing."
                ),
            )
        )

    base_measure = str(_dig(baseline, "selection", "value_column") or "")
    other_measure = str(_dig(comparison, "selection", "value_column") or "")
    if base_measure and other_measure and base_measure != other_measure:
        problems.append(
            Incompatibility(
                code="measure_column",
                field="selection.value_column",
                explanation=(
                    f"The first file is measured on '{base_measure}' and the second on "
                    f"'{other_measure}'. Adding up revenue and adding up headcount both "
                    "produce a total, but the two totals cannot be subtracted."
                ),
                suggestion="Measure both files on the same column.",
            )
        )

    base_col_names = _column_names(baseline)
    other_col_names = _column_names(comparison)
    if base_col_names and other_col_names and not (base_col_names & other_col_names):
        problems.append(
            Incompatibility(
                code="no_shared_columns",
                field="profile.columns",
                explanation=(
                    "The two files share no column names at all, so there is nothing that "
                    "can be lined up between them."
                ),
                suggestion="Check that both files came from the same source system.",
            )
        )

    return problems


def _column_names(payload: dict[str, Any]) -> set[str]:
    """Column names from a profile, for the shared-column check."""
    profile = payload.get("profile") if isinstance(payload.get("profile"), dict) else {}
    columns = profile.get("columns") or []
    return {
        str(c.get("name"))
        for c in columns
        if isinstance(c, dict) and c.get("name") is not None
    }


# --- internals ----------------------------------------------------------------


def _diff_groups(
    base_groups: dict[str, tuple[float, str]],
    other_groups: dict[str, tuple[float, str]],
    base_total: float,
    other_total: float,
) -> list[GroupChange]:
    """One entry per group present in either dataset.

    Groups are keyed by the normalised name, so ``GroupChange.name`` holds that
    key rather than a display spelling; the caller relabels afterwards.
    """
    changes: list[GroupChange] = []
    for name in set(base_groups) | set(other_groups):
        base_entry = base_groups.get(name)
        other_entry = other_groups.get(name)
        base_value = base_entry[0] if base_entry else None
        other_value = other_entry[0] if other_entry else None

        base_share = (
            (base_value / base_total * 100.0)
            if base_total and base_value is not None
            else None
        )
        other_share = (
            (other_value / other_total * 100.0) if other_total and other_value is not None else None
        )

        # "Absent" is not "zero". A group missing from the baseline file was
        # never measured there, so there is no change to report and turning it
        # into -100% would be a fabrication.
        if base_value is None:
            changes.append(
                GroupChange(
                    name=name,
                    baseline_value=0.0,
                    comparison_value=other_value or 0.0,
                    absolute_change=other_value or 0.0,
                    change_pct=None,
                    status="new",
                    baseline_share_pct=None,
                    comparison_share_pct=other_share,
                )
            )
            continue
        if other_value is None:
            changes.append(
                GroupChange(
                    name=name,
                    baseline_value=base_value,
                    comparison_value=0.0,
                    absolute_change=-base_value,
                    change_pct=None,
                    status="gone",
                    baseline_share_pct=base_share,
                    comparison_share_pct=None,
                )
            )
            continue

        absolute = other_value - base_value
        # Percentage change against a zero baseline is undefined — not infinite,
        # and not zero. The percentage is reported as None and the UI shows the
        # absolute change instead.
        if base_value == 0.0:
            # Both sides were measured and both are zero: nothing happened. Only
            # the new-group branch above reports a group as absent, so anything
            # reaching here is present in both datasets and must not be listed
            # as "added".
            status = "flat" if other_value == 0.0 else "grew"
            pct = None
        else:
            pct = absolute / abs(base_value) * 100.0
            status = "flat" if abs(pct) < FLAT_CHANGE_PCT else "grew" if pct > 0 else "fell"

        changes.append(
            GroupChange(
                name=name,
                baseline_value=base_value,
                comparison_value=other_value,
                absolute_change=absolute,
                change_pct=pct,
                status=status,
                baseline_share_pct=base_share,
                comparison_share_pct=other_share,
            )
        )
    return changes


def _group_totals(payload: dict[str, Any]) -> dict[str, tuple[float, str]]:
    """Canonical key → (total, best display name) for every ranked group.

    Keys are normalised with the ranking's own rule, so "ERGONOMIC CHAIR" and
    "Ergonomic Chair" — the same product spelled differently in two files —
    match here rather than reading as one group added and another removed. The
    comparison needs this more than either analysis does: within one file the
    ranking already merged the variants, but across two files each got its own
    canonical spelling.

    Uses ``ranking.items`` rather than ``ranking.top_n`` because ``top_n`` is
    truncated; comparing two truncated lists would invent groups that changed
    simply because the second file asked for more rows.
    """
    ranking = payload.get("ranking") if isinstance(payload.get("ranking"), dict) else {}
    items = [i for i in (ranking.get("items") or []) if isinstance(i, dict)]

    totals: dict[str, float] = {}
    display: dict[str, str] = {}

    for item in items:
        raw = str(item.get("product") or "").strip()
        if not raw:
            continue
        value = _number(item.get("value"))
        if value is None:
            continue

        key = _canonical_key(raw)
        totals[key] = totals.get(key, 0.0) + value
        # The best-spelled name wins: prefer sentence case over SHOUTING, then
        # the shorter one. Deterministic, and matches how a person would write
        # the label.
        if key not in display or _better_name(raw, display[key]):
            display[key] = raw

    return {key: (totals[key], display.get(key, key)) for key in totals}


def _canonical_key(name: str) -> str:
    """Normalised grouping key, matching ``ranking.normalize_product_name``."""
    from app.services.ranking import normalize_product_name

    return normalize_product_name(name)


def _better_name(candidate: str, current: str) -> bool:
    """Whether ``candidate`` is a better label than ``current``.

    SHOUTED names are the ones a source system produced, not ones a person typed,
    so sentence case is preferred; among equals the shorter spelling reads better.
    """
    def shouting(text: str) -> bool:
        letters = [c for c in text if c.isalpha()]
        return bool(letters) and all(c.isupper() for c in letters)

    candidate_shouted = shouting(candidate)
    current_shouted = shouting(current)
    if candidate_shouted != current_shouted:
        return current_shouted
    return len(candidate) < len(current)


def _dig(payload: dict[str, Any], *path: str) -> Any:
    """Read a nested key path, tolerating missing intermediates."""
    current: Any = payload
    for key in path:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
        if current is None:
            return None
    return current


def _number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result


def _as_dict(payload: Any) -> dict[str, Any]:
    if isinstance(payload, dict):
        return payload
    dump = getattr(payload, "model_dump", None)
    if callable(dump):
        result = dump()
        if isinstance(result, dict):
            return result
    return {}