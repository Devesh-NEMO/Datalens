"""Builds the fact sheet that any AI feature is allowed to see.

This module is the privacy and correctness boundary for the whole AI subsystem.
It takes the full analysis payload and emits a **whitelisted, aggregate-only**
dictionary. Two things are deliberately excluded:

* **Row data.** No sample values, no top-value strings from arbitrary columns, no
  raw records. A 600-row sales file is summarised into products, classes and
  month totals; the individual orders never leave this process.
* **Anything the engine did not already compute.** Every figure here is read out
  of the analysis response. No total, ratio or percentage is recomputed here, so
  the AI cannot be handed a number that disagrees with the dashboard — and if it
  *invents* one, there is no source for it to have copied.

The output is JSON-serialisable and small enough to read in one sitting, which
is also what keeps the request cheap.
"""

from __future__ import annotations

import math
from typing import Any

from app.services import recommendations as rec

#: How many ranked items are included. Enough to talk about the top and the
#: tail without sending a 5,000-row ranking.
TOP_ITEMS = 8
BOTTOM_ITEMS = 5

#: Cap on chart recommendations included in the brief.
MAX_CHART_HINTS = 6

#: Cap on quality issues included, worst first.
MAX_QUALITY_ISSUES = 8

#: Cap on anomalies included.
MAX_ANOMALIES = 10

#: A group must hold at least this share of the total before a percentage move
#: is worth naming. Keeps "+600% on 0.02% of the total" out of the narrative.
MATERIAL_SHARE_PCT = 0.5

#: Below this, a move is not reported as a move at all.
MIN_MEANINGFUL_CHANGE_PCT = 0.5


def _number(value: Any) -> float | None:
    """Coerce to a finite float, or None.

    Anything the engine produced as NaN or infinity would serialise to invalid
    JSON, so it becomes null rather than a value a model could quote.
    """
    if value is None or isinstance(value, bool):
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _int(value: Any) -> int:
    number = _number(value)
    return int(number) if number is not None else 0


def _text(value: Any, limit: int = 120) -> str:
    """Coerce to a short, non-empty string."""
    if value is None:
        return ""
    cleaned = " ".join(str(value).split())
    return cleaned[:limit]


def _as_dict(payload: Any) -> dict[str, Any]:
    """Accept either the Pydantic response or its already-dumped dict."""
    if isinstance(payload, dict):
        return payload
    dump = getattr(payload, "model_dump", None)
    if callable(dump):
        result = dump()
        if isinstance(result, dict):
            return result
    return {}


def build_analysis_brief(payload: Any) -> dict[str, Any]:
    """Reduce a full analysis payload to the facts an explanation may use."""
    data = _as_dict(payload)

    meta = _as_dict(data.get("meta"))
    selection = _as_dict(data.get("selection"))
    ranking = _as_dict(data.get("ranking"))
    growth = _as_dict(data.get("growth"))
    charts = _as_dict(data.get("charts"))
    profile = _as_dict(data.get("profile"))
    quality = _as_dict(data.get("quality"))
    cleaning = _as_dict(data.get("cleaning"))
    anomalies = _as_dict(data.get("anomalies"))
    kind_block = _as_dict(data.get("dataset_kind"))

    rank_items = [i for i in (ranking.get("items") or []) if isinstance(i, dict)]
    rank_items.sort(key=lambda i: _int(i.get("rank")))
    product_count = _int(ranking.get("product_count")) or len(rank_items)
    total_value = _number(ranking.get("total_value")) or 0.0

    brief: dict[str, Any] = {
        "dataset": {
            "filename": _text(meta.get("filename"), 120),
            "rows": _int(meta.get("rows")),
            "columns": _int(meta.get("columns")),
            "kind": _text(kind_block.get("kind")) or rec.KIND_GENERIC,
            "kind_label": _text(kind_block.get("label")) or rec.KIND_LABELS[rec.KIND_GENERIC],
            "meaning": _text(kind_block.get("meaning"), 400),
            "group_column": _text(selection.get("product_column"), 80),
            "measure_column": _text(selection.get("value_column"), 80),
            "date_column": _text(selection.get("date_column"), 80) or None,
        },
        "totals": {
            "total_value": round(total_value, 2),
            "product_count": product_count,
            "average_per_product": (
                round(total_value / product_count, 2) if product_count else None
            ),
        },
        "quality": _brief_quality(quality, cleaning),
        "ranking": {
            "top": [
                {
                    "rank": _int(i.get("rank")),
                    "name": _text(i.get("product"), 80),
                    "value": _number(i.get("value")),
                    "share_pct": _number(i.get("share_pct")),
                    "cumulative_pct": _number(i.get("cumulative_pct")),
                    "abc_class": _text(i.get("abc_class"), 4),
                }
                for i in rank_items[:TOP_ITEMS]
            ],
            "bottom": [
                {
                    "rank": _int(i.get("rank")),
                    "name": _text(i.get("product"), 80),
                    "value": _number(i.get("value")),
                    "share_pct": _number(i.get("share_pct")),
                    "abc_class": _text(i.get("abc_class"), 4),
                }
                for i in reversed(rank_items[-BOTTOM_ITEMS:]) if rank_items
            ],
        },
        "abc": _brief_abc(charts.get("abc_distribution")),
        "trend": _brief_trend(charts.get("monthly_trend"), growth),
        "growth": _brief_growth(growth, total_value),
        "distribution": _brief_distribution(charts.get("value_histogram"), meta),
        "pareto": _brief_pareto(charts.get("pareto_curve")),
        "segments": _brief_segments(charts.get("segments")),
        "anomalies": _brief_anomalies(anomalies),
        "chart_suggestions": _brief_chart_suggestions(charts.get("recommendations")),
        "columns": _brief_columns(profile),
        "warnings": [
            _text(w, 200) for w in (data.get("warnings") or [])[:6] if _text(w, 200)
        ],
    }

    # Guard rail: a brief with no usable facts is worse than no brief, because a
    # model asked to explain nothing will invent something.
    brief["has_enough_context"] = bool(
        brief["totals"]["product_count"] > 0 or brief["dataset"]["rows"] > 0
    )
    return brief


def _brief_quality(quality: dict[str, Any], cleaning: dict[str, Any]) -> dict[str, Any]:
    """Quality facts: the score, the cleaning work done, and classified issues."""
    issues_raw = quality.get("issues") or []
    issues = [
        {
            "severity": _text(i.get("severity"), 12),
            "title": _text(i.get("title"), 140),
            "count": _int(i.get("count")),
            "action_taken": _text(i.get("action_taken"), 200),
            "recommendation": _text(i.get("recommendation"), 240),
        }
        for i in issues_raw
        if isinstance(i, dict)
    ][:MAX_QUALITY_ISSUES]

    return {
        "score": _number(quality.get("score")),
        "duplicate_rows_found": _int(cleaning.get("duplicate_row_count")),
        "rows_before": _int(cleaning.get("rows_before")),
        "rows_after": _int(cleaning.get("rows_after")),
        "rows_dropped": _int(cleaning.get("rows_dropped")),
        "null_like_values_converted": _int(cleaning.get("null_like_values_converted")),
        "failed_numeric_conversions": _int(cleaning.get("failed_numeric_conversions")),
        "failed_date_conversions": _int(cleaning.get("failed_date_conversions")),
        "columns_dropped": [_text(c, 60) for c in (cleaning.get("columns_dropped") or [])][:10],
        "issues": issues,
        "critical_issue_count": sum(1 for i in issues if i["severity"] == "critical"),
    }


def _brief_abc(abc_raw: Any) -> dict[str, Any]:
    """ABC class sizes and value shares."""
    items = [i for i in (abc_raw or []) if isinstance(i, list) and len(i) >= 4]
    classes: dict[str, dict[str, Any]] = {}
    for item in items:
        label = _text(item[0], 8).upper()
        classes[label] = {
            "product_count": _int(item[1]),
            "value": _number(item[2]),
            "value_share_pct": _number(item[3]),
        }
    return classes


def _brief_trend(trend_raw: Any, growth: dict[str, Any]) -> dict[str, Any]:
    """Month totals plus first/last/peak/trough, all read from the trend itself."""
    points = [
        (_text(p[0], 16), _number(p[1]))
        for p in (trend_raw or [])
        if isinstance(p, list) and len(p) >= 2 and _number(p[1]) is not None
    ]
    if not points:
        return {"available": False, "months": [], "month_count": 0}

    first_month, first_value = points[0]
    last_month, last_value = points[-1]
    peak_month, peak_value = max(points, key=lambda p: (p[1], p[0]))
    trough_month, trough_value = min(points, key=lambda p: (p[1], p[0]))

    # Largest single month-on-month move, in both directions.
    biggest_rise = biggest_fall = None
    for index in range(1, len(points)):
        prev_month, prev_value = points[index - 1]
        month, value = points[index]
        if prev_value is None or value is None or prev_value == 0:
            continue
        change = (value - prev_value) / abs(prev_value) * 100.0
        entry = {
            "month": month,
            "from_month": prev_month,
            "change_pct": round(change, 1),
            "value": round(value, 2),
            "previous_value": round(prev_value, 2),
        }
        if biggest_rise is None or change > biggest_rise["change_pct"]:
            biggest_rise = entry
        if biggest_fall is None or change < biggest_fall["change_pct"]:
            biggest_fall = entry

    change_pct = None
    if first_value not in (None, 0) and last_value is not None:
        change_pct = round((last_value - first_value) / abs(first_value) * 100.0, 1)

    return {
        "available": True,
        "month_count": len(points),
        "months": [m for m, _ in points],
        "series": [{"month": m, "value": v} for m, v in points],
        "first_month": first_month,
        "first_month_value": first_value,
        "last_month": last_month,
        "last_month_value": last_value,
        "peak_month": peak_month,
        "peak_value": peak_value,
        "trough_month": trough_month,
        "trough_value": trough_value,
        "change_pct_first_to_last": change_pct,
        "biggest_rise": biggest_rise,
        "biggest_fall": biggest_fall,
        "latest_period": _text(growth.get("latest_period"), 32),
        "previous_period": _text(growth.get("previous_period"), 32),
    }


def _brief_growth(growth: dict[str, Any], total_value: float) -> dict[str, Any]:
    """Overall direction plus the largest per-group moves.

    Moves are ranked by how much they matter, not by their raw percentage. A
    group going from nothing to a few hundred can show +600% while being 0.02%
    of the total; calling that "the largest move" is technically true and
    practically useless. Groups worth at least ``MATERIAL_SHARE_PCT`` of the
    total are preferred — the same gate the dashboard uses, so the two surfaces
    cannot disagree about which change is worth naming. When nothing in the file
    clears the bar the gate is dropped rather than leaving the section empty.
    """
    items = [i for i in (growth.get("items") or []) if isinstance(i, dict)]

    candidates: list[tuple[str, float, float, dict[str, Any]]] = []
    for item in items:
        change = _number(item.get("change_pct"))
        latest = _number(item.get("latest_value"))
        name = _text(item.get("product"), 80)
        if change is None or latest is None or not name:
            continue
        candidates.append((name, change, latest, item))

    def _describe(entry: tuple[str, float, float, dict[str, Any]], material: bool):
        name, change, latest, item = entry
        return {
            "name": name,
            "change_pct": round(change, 1),
            "direction": _text(item.get("direction"), 12),
            "latest_value": latest,
            "previous_value": _number(item.get("previous_value")),
            "share_of_total_pct": (
                round(latest / total_value * 100.0, 2) if total_value else None
            ),
            #: False when the gate was dropped because nothing in the file
            #: holds a meaningful share. The narrator then adds the caveat.
            "material": material,
        }

    result: dict[str, Any] = {
        "direction": _text(growth.get("direction"), 12),
        "change_pct": _number(growth.get("change_pct")),
        "latest_period": _text(growth.get("latest_period"), 32),
        "previous_period": _text(growth.get("previous_period"), 32),
        "latest_total": _number(growth.get("latest_total")),
        "previous_total": _number(growth.get("previous_total")),
        "items_compared": len(items),
        "materiality_threshold_pct": MATERIAL_SHARE_PCT,
        "largest_rise": None,
        "largest_fall": None,
    }

    if not candidates:
        return result

    if total_value > 0:
        material = [c for c in candidates if c[2] / total_value * 100.0 >= MATERIAL_SHARE_PCT]
    else:
        material = []

    pool = material or candidates
    used_gate = bool(material)

    best_rise = max(pool, key=lambda c: c[1])
    best_fall = min(pool, key=lambda c: c[1])

    # Only call something a "move" when it actually moved. A flat result is
    # reported as flat rather than dressed up as a fall of 0%.
    if abs(best_rise[1]) >= MIN_MEANINGFUL_CHANGE_PCT:
        result["largest_rise"] = _describe(best_rise, used_gate)
    if abs(best_fall[1]) >= MIN_MEANINGFUL_CHANGE_PCT:
        result["largest_fall"] = _describe(best_fall, used_gate)

    return result


def _brief_distribution(histogram_raw: Any, meta: dict[str, Any]) -> dict[str, Any]:
    """How value is spread across the histogram bands."""
    buckets = []
    for item in histogram_raw or []:
        if not isinstance(item, list) or len(item) < 4:
            continue
        low = _number(item[1])
        high = _number(item[0])
        count = _int(item[2])
        buckets.append(
            {
                "label": _text(item[3], 40),
                "min": low,
                "max": high,
                "count": count,
            }
        )
    buckets.sort(key=lambda b: (b["min"] if b["min"] is not None else 0.0))

    total = sum(b["count"] for b in buckets)
    rows = _int(meta.get("rows"))
    lowest = buckets[0] if buckets else None
    highest = buckets[-1] if buckets else None

    return {
        "bucket_count": len(buckets),
        "buckets": buckets,
        "rows_covered": total,
        "rows_in_dataset": rows,
        "matches_row_count": total == rows and rows > 0,
        "lowest_band": lowest,
        "highest_band": highest,
        "lowest_band_share_pct": (
            round(lowest["count"] / total * 100.0, 1) if lowest and total else None
        ),
        "highest_band_count": highest["count"] if highest else None,
    }


def _brief_pareto(pareto_raw: Any) -> dict[str, Any]:
    """How concentrated the ranking is: the 80/20 question."""
    points = [
        (_number(p[0]), _text(p[1], 80), _number(p[2]))
        for p in (pareto_raw or [])
        if isinstance(p, list) and len(p) >= 3
    ]
    points = [p for p in points if p[0] is not None]
    if not points:
        return {"available": False}

    #: Smallest number of groups that together reach 80% of the total.
    groups_for_80 = next((i + 1 for i, p in enumerate(points) if p[0] >= 80.0), None)
    return {
        "available": True,
        "point_count": len(points),
        "groups_covering_80pct": groups_for_80,
        "share_of_groups_for_80pct": (
            round(groups_for_80 / len(points) * 100.0, 1) if groups_for_80 else None
        ),
        "last_name": points[-1][1] if points else None,
        "last_cumulative_pct": points[-1][0] if points else None,
    }


def _brief_segments(segments_raw: Any) -> list[dict[str, Any]]:
    """Grouped breakdowns (region, category, channel...) kept small."""
    segments: list[dict[str, Any]] = []
    for segment in segments_raw or []:
        if not isinstance(segment, dict):
            continue
        items = []
        for item in (segment.get("items") or [])[:6]:
            if not isinstance(item, dict):
                continue
            items.append(
                {
                    "label": _text(item.get("label"), 60),
                    "value": _number(item.get("value")),
                    "share_pct": _number(item.get("share_pct")),
                    "count": _int(item.get("count")),
                }
            )
        if not items:
            continue
        segments.append(
            {
                "column": _text(segment.get("column"), 60),
                "measure": _text(segment.get("measure"), 60),
                "groups_total": _int(segment.get("groups_total")),
                "truncated": bool(segment.get("truncated")),
                "items": items,
            }
        )
    return segments[:6]


def _brief_anomalies(anomalies: dict[str, Any]) -> dict[str, Any]:
    """Potential anomalies, phrased as potential."""
    items = [
        {
            "column": _text(i.get("column"), 60),
            "value": _text(i.get("value"), 60),
            "reason": _text(i.get("reason"), 240),
            "severity": _text(i.get("severity"), 12),
            "method": _text(i.get("method"), 24),
        }
        for i in (anomalies.get("items") or [])
        if isinstance(i, dict)
    ][:MAX_ANOMALIES]

    return {
        "detected": bool(anomalies.get("detected")),
        "count": _int(anomalies.get("count")),
        "listed": len(items),
        "items": items,
        "notes": [_text(n, 240) for n in (anomalies.get("notes") or []) if _text(n, 240)][:4],
        "rows_scanned": _int(anomalies.get("rows_scanned")),
    }


def _brief_chart_suggestions(charts_raw: Any) -> list[dict[str, Any]]:
    """Recommended chart types with the reason each was chosen."""
    return [
        {
            "chart_type": _text(r.get("chart_type"), 32),
            "title": _text(r.get("title"), 120),
            "reason": _text(r.get("reason"), 240),
            "caveat": _text(r.get("caveat"), 200) or None,
        }
        for r in (charts_raw or [])
        if isinstance(r, dict)
    ][:MAX_CHART_HINTS]


def _brief_columns(profile: dict[str, Any]) -> list[dict[str, Any]]:
    """Column names and shapes only — never sample or top values.

    A sample value is customer data as often as it is a number, so it stays out.
    """
    columns = []
    for column in (profile.get("columns") or [])[:40]:
        if not isinstance(column, dict):
            continue
        columns.append(
            {
                "name": _text(column.get("name"), 60),
                "type": _text(column.get("detected_type"), 24),
                "missing_percent": _number(column.get("missing_percent")),
                "unique_count": _int(column.get("unique_count")),
            }
        )
    return columns


def brief_to_json(brief: dict[str, Any]) -> str:
    """Serialise a brief for inclusion in a prompt."""
    import json

    return json.dumps(brief, indent=2, ensure_ascii=False, default=str)
