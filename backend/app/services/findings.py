"""Structured, evidence-backed findings built from a completed analysis.

Every finding is computed from the deterministic analysis payload — the same
figures the dashboard shows — and carries the exact columns, entities and counts
it refers to. No language model decides what is worth reporting here; a model may
*explain* a finding, but it never creates one, and no figure is estimated.

``confidence`` is deliberately left as ``None`` rather than guessed: each finding
is an exact computation over the file, so there is no sampling uncertainty to
quote. Where a numerical confidence would be meaningful (an anomaly's distance
from its column's normal range), the raw measure is already part of ``evidence``.
"""

from __future__ import annotations

import hashlib
from typing import Any

CATEGORY_TREND = "trend"
CATEGORY_OPPORTUNITY = "opportunity"
CATEGORY_ANOMALY = "anomaly"
CATEGORY_CONCENTRATION = "concentration"
CATEGORY_DATA_QUALITY = "data quality"
CATEGORY_COMPARISON = "comparison"
CATEGORY_OBSERVATION = "general observation"

_CATEGORY_KEYS = {
    CATEGORY_TREND: "trend",
    CATEGORY_OPPORTUNITY: "opportunity",
    CATEGORY_ANOMALY: "anomaly",
    CATEGORY_CONCENTRATION: "concentration",
    CATEGORY_DATA_QUALITY: "quality",
    CATEGORY_COMPARISON: "comparison",
    CATEGORY_OBSERVATION: "observation",
}

_CONCENTRATION_HIGH_SHARE = 50.0
_CONCENTRATION_MEDIUM_SHARE = 30.0

_TREND_HIGH_PCT = 25.0
_TREND_MEDIUM_PCT = 10.0

_ANOMALY_SEVERITY = {"high": "high", "medium": "medium", "low": "low"}
_QUALITY_SEVERITY = {"critical": "high", "warning": "medium", "info": "low"}

_ANOMALY_LIMITATION = (
    "Statistical outliers are candidates, not confirmed problems; inspect the "
    "affected rows before acting."
)
_QUALITY_LIMITATION = "Affected counts are computed; the underlying cause of the pattern is not."


def _empty_findings() -> list[dict[str, Any]]:
    return []


def _finding_id(category: str, *parts: Any) -> str:
    """Stable identifier so the same finding keeps the same id across runs."""
    raw = "|".join(str(p) for p in parts if p not in (None, ""))
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:8]
    return f"{_CATEGORY_KEYS.get(category, 'finding')}-{digest}"


def _finding(
    category: str,
    title: str,
    summary: str,
    severities: list[str],
    evidence: list[str],
    *,
    affected_columns: list[str] | None = None,
    affected_entities: list[str] | None = None,
    recommended_action: str = "",
    limitations: list[str] | None = None,
) -> dict[str, Any]:
    """One finding. Stores worst severity, all evidence, an action and limits."""
    # Worst severity wins, in the order high > medium > low.
    for level in ("high", "medium", "low"):
        if level in severities:
            severity = level
            break
    else:
        severity = "low"

    return {
        "id": _finding_id(category, title, evidence[0] if evidence else ""),
        "title": title,
        "summary": summary,
        "category": category,
        "severity": severity,
        "confidence": None,
        "evidence": evidence,
        "affected_columns": affected_columns or [],
        "affected_entities": affected_entities or [],
        "recommended_action": recommended_action,
        "limitations": limitations or [],
    }


def _as_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _fmt(value: Any) -> str:
    """Format a number without locale thrash — thousands separated, 2dp."""
    number = _as_float(value)
    if number is None:
        return "0"
    return f"{number:,.0f}" if number == int(number) else f"{number:,.2f}"


def build_findings(payload: Any) -> list[dict[str, Any]]:
    """The evidence-backed findings for one analysis, in display order.

    Categories are mapped from real signal: data quality from the profiler's
    issues, anomaly from the IQR/z-score scan, concentration from ABC shares,
    and trend from period-over-period moves. Nothing here is invented, and
    findings with nothing to report are simply absent.
    """
    if payload is None:
        return _empty_findings()
    if not isinstance(payload, dict):
        payload = getattr(payload, "model_dump", lambda: {})() or {}

    findings: list[dict[str, Any]] = []

    findings.extend(_quality_findings(payload))
    findings.extend(_anomaly_findings(payload))
    findings.extend(_concentration_findings(payload))
    findings.extend(_trend_findings(payload))

    return findings


def _quality_findings(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Data-quality issues, translated 1:1 from the profiler."""
    quality = payload.get("quality") or {}
    issues = quality.get("issues") or []

    findings: list[dict[str, Any]] = []
    for issue in issues:
        if not isinstance(issue, dict):
            continue
        severity = _QUALITY_SEVERITY.get(str(issue.get("severity", "")).lower(), "low")
        count = int(issue.get("count") or 0)
        column = str(issue.get("column") or "")  # not set by the profiler today
        if not column and str(issue.get("id", "")).startswith("column_missing:"):
            column = str(issue.get("id", "")).split(":", 1)[1]

        summary_parts = [str(issue.get("what_happened") or "").strip()]
        if count:
            summary_parts.append(f"Affects {count:,} rows/cells.")
        evidence = [str(issue.get("what_happened") or "").strip()]
        if count:
            evidence.append(f"{count:,} rows or cells affected.")
            if quality.get("score") is not None:
                evidence.append(f"Overall quality score: {quality['score']}.")

        findings.append(
            _finding(
                CATEGORY_DATA_QUALITY,
                str(issue.get("title") or "Data quality issue"),
                " ".join(p for p in summary_parts if p),
                [severity],
                [e for e in evidence if e],
                affected_columns=[column] if column else [],
                recommended_action=str(
                    issue.get("recommendation")
                    or issue.get("action_taken")
                    or ""
                ).strip(),
                limitations=[_QUALITY_LIMITATION],
            )
        )
    return findings


def _anomaly_findings(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Potential anomalies, always labelled as candidates."""
    anomalies = payload.get("anomalies") or {}
    items = anomalies.get("items") or []
    findings: list[dict[str, Any]] = []
    for item in items[:10]:
        if not isinstance(item, dict):
            continue
        column = str(item.get("column") or "")
        value = str(item.get("value") or "")
        reason = str(item.get("reason") or "")
        occurrences = int(item.get("occurrences") or 1)
        severity = _ANOMALY_SEVERITY.get(str(item.get("severity") or "").lower(), "low")

        findings.append(
            _finding(
                CATEGORY_ANOMALY,
                f"Potential anomaly in {column or 'a column'}",
                f"{reason or f'A value sits outside the normal range of {column}.'} "
                f"Reported for {occurrences:,} row(s).",
                [severity],
                [reason, f"Value: {value}. Rows carrying it: {occurrences:,}."],
                affected_columns=[column] if column else [],
                affected_entities=[value] if value else [],
                recommended_action=(
                    f"Open the data explorer filtered to {column} and inspect the "
                    f"flagged value before drawing conclusions."
                ),
                limitations=[_ANOMALY_LIMITATION],
            )
        )
    return findings


def _concentration_findings(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Value concentration from the ABC summary and top items."""
    ranking = payload.get("ranking") or {}
    abc = ranking.get("abc_summary") or {}
    top_n = ranking.get("top_n") or []
    total_value = _as_float(ranking.get("total_value"))
    if not total_value:
        return []

    share = _as_float(abc.get("class_a_share_pct"))
    _as_float(abc.get("class_a_share_pct"))
    top_value = _as_float(abc.get("class_a_value"))
    top_count = int(abc.get("class_a_count") or 0)

    if share is None:
        return []

    top_names = [
        str(item.get("name") or "")
        for item in top_n[:5]
        if isinstance(item, dict) and item.get("name")
    ]
    if share >= _CONCENTRATION_MEDIUM_SHARE:
        severity = "high" if share >= _CONCENTRATION_HIGH_SHARE else "medium"
        findings = [
            _finding(
                CATEGORY_CONCENTRATION,
                f"Value is concentrated in {top_count} group(s)",
                (
                    f"{top_count} group(s) hold {share:.1f}% of the total "
                    f"({_fmt(top_value)} of {_fmt(total_value)}). Decisions about "
                    "these groups move the whole total."
                ),
                [severity],
                [
                    f"Class A holds {share:.1f}% of value across {top_count} group(s).",
                    f"Total value: {_fmt(total_value)}.",
                ],
                affected_entities=top_names,
                recommended_action=(
                    "Review whether relying on this small set of groups is acceptable, "
                    "and what happens to the total if the largest one changes."
                ),
                limitations=[
                    "Concentration is a structural fact of the file, not a judgment "
                    "about whether it is a problem."
                ],
            )
        ]
        return findings
    return []


def _trend_findings(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Largest period-over-period moves from the growth engine."""
    growth = payload.get("growth") or {}
    items = growth.get("items") or []
    if not growth.get("has_growth_data") or not items:
        return []

    best: dict[str, Any] | None = None
    best_abs = 0.0
    for item in items:
        if not isinstance(item, dict):
            continue
        change = _as_float(item.get("change_pct")) or 0.0
        if abs(change) > best_abs and item.get("product"):
            best_abs = abs(change)
            best = item
    if best is None or best_abs < _TREND_MEDIUM_PCT:
        return []

    name = str(best.get("product") or "")
    change = _as_float(best.get("change_pct")) or 0.0
    previous = _fmt(best.get("previous_value"))
    latest = _fmt(best.get("latest_value"))
    period = str(best.get("latest_period") or "the latest period")
    direction = "rose" if change > 0 else "fell"
    severity = "high" if abs(change) >= _TREND_HIGH_PCT else "medium"

    return [
        _finding(
            CATEGORY_TREND,
            f"Largest move: {name} {direction} {abs(change):.1f}%",
            (
                f"{name} {direction} {abs(change):.1f}% going into {period}, from "
                f"{previous} to {latest}. This is the largest period-over-period "
                "move Datalens detected."
            ),
            [severity],
            [
                f"{name}: {previous} → {latest} ({change:+.1f}%) in {period}.",
            ],
            affected_entities=[name],
            recommended_action=(
                f"Investigate what drove the {direction} in {name} before the next "
                "period — volume, mix or a one-off event."
            ),
            limitations=[
                "A period-over-period move is a computed change, not an explanation. "
                "Causation would require additional columns and analysis."
            ],
        )
    ]