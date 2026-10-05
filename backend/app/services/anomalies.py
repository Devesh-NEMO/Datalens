"""Deterministic anomaly detection.

Design rules this module holds itself to:

* **Nothing is called fraud, wrong, or invalid.** Every finding is a
  *potential* anomaly: a value that sits far from its column's own distribution,
  or a period that moved far from the one before it. The data is evidence of
  something worth looking at, not proof of a mistake.
* **Every number is computed from the frame in front of us.** No thresholds are
  invented per dataset and no figure is carried over from a previous run.
* **A method that cannot be applied says so.** Each finding records which method
  produced it and why, so the UI can show the reason rather than a bare number.
* **Output is bounded.** One pathological column cannot flood the response.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import pandas as pd

from app.config import settings

SEVERITY_HIGH = "high"
SEVERITY_MEDIUM = "medium"
SEVERITY_LOW = "low"

SEVERITY_ORDER = {SEVERITY_HIGH: 0, SEVERITY_MEDIUM: 1, SEVERITY_LOW: 2}

#: Method identifiers, exposed to the client so the UI can label a finding.
METHOD_IQR = "iqr"
METHOD_ZSCORE = "zscore"
METHOD_MISSING = "missing_spike"
METHOD_GROWTH = "growth"

#: A product has to be worth at least this share of the total before a large
#: percentage move is interesting. Without it, a product going 0 -> 300 looks
#: like a 30,000% story and drowns out a real fall in a top earner.
MATERIAL_SHARE_PCT = 0.5
#: Absolute move that makes a material product worth listing.
MATERIAL_CHANGE_PCT = 25.0
#: A column must be this much emptier than the typical column before it counts.
MISSING_SPIKE_RATIO = 2.0
MISSING_SPIKE_FLOOR_PCT = 5.0


@dataclass
class Anomaly:
    """One potential anomaly worth a human's attention."""

    column: str
    value: str
    reason: str
    severity: str
    method: str
    #: How far out the value sits, in units the method defines (IQR widths or
    #: standard deviations). None when the finding is not about a single value.
    distance: float | None = None
    #: Rows carrying this value. 1 for a finding about a group total.
    occurrences: int = 1

    def to_dict(self) -> dict[str, object]:
        return {
            "column": self.column,
            "value": self.value,
            "reason": self.reason,
            "severity": self.severity,
            "method": self.method,
            "distance": round(self.distance, 2) if self.distance is not None else None,
            "occurrences": self.occurrences,
        }


@dataclass
class AnomalyResult:
    """All findings for one dataset, plus whether the scan was meaningful."""

    #: False when the dataset was too small for statistical methods to say
    #: anything. The UI shows an explanation instead of "0 anomalies".
    detected: bool
    count: int
    items: list[Anomaly] = field(default_factory=list)
    #: Free text explaining scope: how many rows/columns were scanned, and what
    #: was skipped. Never empty when ``detected`` is False.
    notes: list[str] = field(default_factory=list)
    #: Rows actually analysed, which may be fewer than the dataset's rows.
    rows_scanned: int = 0
    #: True when the frame was too large and was sampled.
    sampled: bool = False

    def to_dict(self) -> dict[str, object]:
        return {
            "detected": self.detected,
            "count": self.count,
            "items": [a.to_dict() for a in self.items],
            "notes": list(self.notes),
            "rows_scanned": self.rows_scanned,
            "sampled": self.sampled,
        }


def _fmt(value: float) -> str:
    """Compact, readable rendering of a number for a reason string."""
    if not math.isfinite(value):
        return "non-finite"
    magnitude = abs(value)
    if magnitude >= 1_000_000:
        return f"{value:,.0f}"
    if magnitude >= 1000:
        return f"{value:,.1f}".removesuffix(".0")
    if magnitude >= 1:
        return f"{value:,.2f}".removesuffix("0").removesuffix(".")
    return f"{value:,.4g}"


def _severity_for_z(distance: float) -> str:
    if distance >= settings.anomaly_zscore_threshold * 2:
        return SEVERITY_HIGH
    if distance >= settings.anomaly_zscore_threshold:
        return SEVERITY_MEDIUM
    return SEVERITY_LOW


def _numeric_outliers(series: pd.Series, column: str) -> list[Anomaly]:
    """IQR and z-score outliers for one numeric column.

    IQR is the primary method because it does not assume a distribution: a column
    of order values is nothing like normal, and IQR still finds the tail. z-score
    is kept as a second opinion on the same values so a finding can be labelled
    with the stronger of the two distances.

    One finding is emitted per *distinct* value, with an occurrence count. A
    column where the same order quantity appears 40 times would otherwise
    produce 40 identical findings, which buries the rest of the list.
    """
    numeric = pd.to_numeric(series, errors="coerce").dropna()
    count = len(numeric)
    if count < settings.anomaly_min_rows:
        return []

    mean = float(numeric.mean())
    std = float(numeric.std())

    # A column with few distinct values has no meaningful quartiles: "outside the
    # middle 50%" is a statement about a shape that does not exist yet. The
    # z-score path below still runs, because frequency-weighting is meaningful
    # however few distinct values there are.
    enough_distinct = numeric.nunique() >= settings.anomaly_min_distinct_values

    multiplier = settings.anomaly_iqr_multiplier
    q1 = float(numeric.quantile(0.25))
    q3 = float(numeric.quantile(0.75))
    iqr = q3 - q1

    # A constant column has no spread; every value is the same, so nothing is out
    # of place. Dividing by it would produce infinities.
    if std <= 0 or not math.isfinite(std):
        return []

    if enough_distinct and iqr > 0:
        low_fence = q1 - multiplier * iqr
        high_fence = q3 + multiplier * iqr
    else:
        # Degenerate IQR, or too few distinct values for the fences to describe a
        # shape. Use the standard deviation fences, which are a statement about
        # individual values and hold up on small discrete columns.
        low_fence = mean - settings.anomaly_zscore_threshold * std
        high_fence = mean + settings.anomaly_zscore_threshold * std
        iqr = 0.0

    outliers = numeric[(numeric < low_fence) | (numeric > high_fence)]
    if outliers.empty:
        return []

    findings: list[Anomaly] = []
    for value, occurrences in outliers.value_counts().sort_index().items():
        value_f = float(value)
        if iqr > 0:
            iqr_distance = (
                (high_fence - value_f) / iqr
                if value_f > high_fence
                else (low_fence - value_f) / iqr
            )
        else:
            iqr_distance = float("inf")

        z_distance = abs(value_f - mean) / std if std > 0 and math.isfinite(std) else 0.0
        times = _occurrence_phrase(int(occurrences), count)

        if std > 0 and math.isfinite(std) and z_distance >= settings.anomaly_zscore_threshold:
            distance = z_distance
            method = METHOD_ZSCORE
            reason = (
                f"{_fmt(value_f)} sits {distance:.1f} standard deviations from the column "
                f"mean of {_fmt(mean)} ({times}, n={count:,})."
            )
            severity = _severity_for_z(distance)
        else:
            distance = iqr_distance
            method = METHOD_IQR
            reason = (
                f"{_fmt(value_f)} falls outside the middle 50% of '{column}' "
                f"({_fmt(q1)} to {_fmt(q3)}), the usual range being {_fmt(low_fence)} to "
                f"{_fmt(high_fence)} ({times}, n={count:,})."
            )
            severity = SEVERITY_MEDIUM if distance > multiplier * 2 else SEVERITY_LOW

        findings.append(
            Anomaly(
                column=column,
                value=_fmt(value_f),
                reason=reason,
                severity=severity,
                method=method,
                distance=distance,
                occurrences=int(occurrences),
            )
        )

    return findings


def _occurrence_phrase(occurrences: int, total: int) -> str:
    """How many rows carry this value, phrased for a reason string."""
    if occurrences == 1:
        return "1 row"
    share = occurrences / total * 100.0 if total else 0.0
    return f"{occurrences:,} rows" + (f" ({share:.0f}% of the column)" if share >= 1.0 else "")


def _missing_spikes(df: pd.DataFrame) -> list[Anomaly]:
    """Columns that are far emptier than the rest of the file."""
    total_cells = int(df.shape[0] * df.shape[1])
    if total_cells == 0:
        return []

    per_column = df.isna().mean() * 100.0
    if per_column.empty:
        return []

    median_pct = float(per_column.median())
    findings: list[Anomaly] = []

    for column, pct in per_column.items():
        if pct < MISSING_SPIKE_FLOOR_PCT:
            continue
        if median_pct > 0 and pct < median_pct * MISSING_SPIKE_RATIO:
            continue
        if median_pct == 0 and pct <= 0:
            continue

        missing = int(round(pct / 100.0 * df.shape[0]))
        comparison = (
            f"the file's median column is {median_pct:.1f}% empty"
            if median_pct > 0
            else "every other column is complete"
        )
        findings.append(
            Anomaly(
                column=str(column),
                value=f"{pct:.1f}% empty",
                reason=(
                    f"{missing:,} of {df.shape[0]:,} rows have no value here, while "
                    f"{comparison}."
                ),
                severity=SEVERITY_MEDIUM if pct >= 25 else SEVERITY_LOW,
                method=METHOD_MISSING,
                distance=round(pct, 2),
            )
        )

    return findings


def _growth_anomalies(
    growth_items: list[object],
    total_value: float,
) -> list[Anomaly]:
    """Products whose latest period moved sharply *and* matter to the total.

    Both conditions are required. A percentage alone is misleading when the base
    is trivial, and a large product moving 2% is not a story.
    """
    findings: list[Anomaly] = []
    if total_value <= 0:
        return findings

    for item in growth_items:
        product = getattr(item, "product", None)
        change_pct = getattr(item, "change_pct", None)
        latest_value = getattr(item, "latest_value", None)
        if not product or change_pct is None or latest_value is None:
            continue

        try:
            change = float(change_pct)
            latest = float(latest_value)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(change) or not math.isfinite(latest):
            continue

        share = latest / total_value * 100.0
        if share < MATERIAL_SHARE_PCT:
            continue
        if abs(change) < MATERIAL_CHANGE_PCT:
            continue

        direction = "rose" if change > 0 else "fell"
        severity = SEVERITY_HIGH if abs(change) >= 100 else SEVERITY_MEDIUM
        findings.append(
            Anomaly(
                column="growth",
                value=str(product),
                reason=(
                    f"{product} {direction} {abs(change):.1f}% in the latest period and "
                    f"holds {share:.1f}% of total value, so the move shifts the total."
                ),
                severity=severity,
                method=METHOD_GROWTH,
                distance=round(change, 2),
            )
        )

    return findings


def _product_value_outliers(ranking_items: list[object], measure_column: str) -> list[Anomaly]:
    """Groups whose own total is far outside the spread of all group totals.

    Reported against the real measure column rather than a synthetic label, so
    the finding points at something the reader can actually open.
    """
    values: list[tuple[str, float]] = []
    for item in ranking_items:
        product = getattr(item, "product", None)
        value = getattr(item, "value", None)
        if not product or value is None:
            continue
        try:
            value_f = float(value)
        except (TypeError, ValueError):
            continue
        if math.isfinite(value_f):
            values.append((str(product), value_f))

    if len(values) < settings.anomaly_min_rows:
        return []

    series = pd.Series([v for _, v in values], dtype=float)
    q1 = float(series.quantile(0.25))
    q3 = float(series.quantile(0.75))
    iqr = q3 - q1
    if iqr <= 0:
        return []

    multiplier = settings.anomaly_iqr_multiplier
    high_fence = q3 + multiplier * iqr
    findings: list[Anomaly] = []
    for product, value in values:
        if value <= high_fence:
            continue
        distance = (value - high_fence) / iqr
        noun = _group_noun(measure_column)
        findings.append(
            Anomaly(
                column=measure_column,
                value=product,
                reason=(
                    f"{product} totals {_fmt(value)}, above the {_fmt(high_fence)} upper "
                    f"fence for the spread of all {len(values)} {noun} "
                    f"({_fmt(q1)} to {_fmt(q3)} for the middle 50%). This is the group "
                    "total, not a single row."
                ),
                severity=SEVERITY_MEDIUM,
                method=METHOD_IQR,
                distance=round(distance, 2),
            )
        )
    return findings


def _group_noun(measure_column: str) -> str:
    """Plural noun for what is being summed, from the column name."""
    name = str(measure_column or "group").lower()
    if "revenue" in name or "sales" in name or "value" in name or "amount" in name:
        return "groups"
    return name if name.endswith("s") else f"{name} values"


def detect_anomalies(
    df: pd.DataFrame,
    *,
    value_column: str | None = None,
    ranking_items: list[object] | None = None,
    growth_items: list[object] | None = None,
    total_value: float = 0.0,
) -> AnomalyResult:
    """Scan a cleaned frame plus the derived tables for potential anomalies.

    ``value_column`` is analysed as a row-level numeric column *and* is skipped in
    the generic pass, because the derived tables already cover it at the product
    level and the reader does not need both stories.
    """
    row_count = len(df)
    notes: list[str] = []

    if row_count == 0:
        return AnomalyResult(
            detected=False,
            count=0,
            items=[],
            notes=["The dataset has no rows, so there is nothing to compare against."],
            rows_scanned=0,
        )

    sampled = False
    scanned = df
    if row_count > settings.anomaly_max_rows:
        sampled = True
        # A deterministic stride sample: no RNG, so the same file always produces
        # the same findings and a rerun cannot look like a different result.
        step = math.ceil(row_count / settings.anomaly_max_rows)
        scanned = df.iloc[::step]
        notes.append(
            f"Scanned every {step}th row ({len(scanned):,} of {row_count:,}) to keep the "
            "check fast. Percentages below refer to the scanned rows."
        )

    if len(scanned) < settings.anomaly_min_rows:
        notes.append(
            f"Only {len(scanned):,} rows available; at least {settings.anomaly_min_rows} "
            "are needed before a spread-based comparison means anything."
        )
        return AnomalyResult(
            detected=False,
            count=0,
            items=[],
            notes=notes,
            rows_scanned=len(scanned),
            sampled=sampled,
        )

    findings: list[Anomaly] = []
    numeric_columns = 0
    skipped = 0

    for column in scanned.columns:
        series = scanned[column]
        if not pd.api.types.is_numeric_dtype(series):
            continue
        if column == value_column:
            # Covered at product level below; skipping avoids telling the same
            # story twice with different framing.
            skipped += 1
            continue
        numeric_columns += 1
        try:
            findings.extend(_numeric_outliers(series, str(column)))
        except (ValueError, TypeError, FloatingPointError):
            # A single unusable column must not lose the other columns' findings.
            continue

    findings.extend(_missing_spikes(scanned))

    if ranking_items:
        findings.extend(_product_value_outliers(ranking_items, value_column or "value"))
    if growth_items:
        findings.extend(_growth_anomalies(growth_items, total_value))

    if numeric_columns == 0:
        notes.append(
            "No numeric columns were available for a spread comparison, so only "
            "missing-value and period-over-period checks were run."
        )
    if skipped:
        notes.append(
            f"'{value_column}' was checked at the product level instead of row by row."
        )

    # Highest severity first, then the most extreme, then alphabetical so the
    # order never depends on dict iteration.
    findings.sort(
        key=lambda a: (
            SEVERITY_ORDER[a.severity],
            -(a.distance or 0.0),
            a.column,
            a.value,
        )
    )
    capped = findings[: settings.anomaly_max_results]
    if len(findings) > len(capped):
        notes.append(
            f"{len(findings)} potential anomalies were found; the {len(capped)} most "
            "extreme are listed."
        )

    return AnomalyResult(
        detected=True,
        count=len(findings),
        items=capped,
        notes=notes,
        rows_scanned=len(scanned),
        sampled=sampled,
    )
