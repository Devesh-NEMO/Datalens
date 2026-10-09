"""A plain-language explanation of a dataset comparison.

Deterministic on purpose, exactly like the analysis narrative: every sentence is
assembled from the comparison's own computed numbers, so the explanation cannot
diverge from the diff it accompanies. The response flags ``is_ai: false`` so the
UI never implies a model was involved.
"""

from __future__ import annotations

from typing import Any

_MISSING_LABEL = "—"


def _fmt(value: Any) -> str:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return _MISSING_LABEL
    return f"{number:,.0f}" if number == int(number) else f"{number:,.2f}"


def _fmt_pct(value: Any) -> str:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return _MISSING_LABEL
    return f"{number:+.1f}%" if number > 0 or number < 0 else "0.0%"


def _groups(result: dict[str, Any], key: str, limit: int = 3) -> list[dict[str, Any]]:
    return (result.get(key) or [])[:limit]


def explain_comparison(result: dict[str, Any]) -> dict[str, Any]:
    """A concise, grounded explanation of one comparison result."""
    if not result.get("compatible", True):
        reasons = result.get("incompatibilities") or []
        text = "These datasets cannot be compared directly.\n\n"
        for reason in reasons[:4]:
            explanation = str(reason.get("explanation") or "")
            suggestion = str(reason.get("suggestion") or "")
            if explanation:
                text += f"* {explanation}\n"
            if suggestion:
                text += f"  Suggested fix: {suggestion}\n"
        return {
            "text": text.strip(),
            "is_ai": False,
            "source": "local",
            "reliability": "incompatible",
        }

    parts: list[str] = []
    baseline = _fmt(result.get("baseline_total"))
    comparison = _fmt(result.get("comparison_total"))
    delta = _fmt(result.get("total_change"))
    delta_pct = _fmt_pct(result.get("total_change_pct"))

    parts.append(
        f"The total moved from {baseline} to {comparison} — a change of "
        f"{delta} ({delta_pct})."
    )

    grew = _groups(result, "grew")
    fell = _groups(result, "fell")
    added = _groups(result, "added")
    removed = _groups(result, "removed")

    if grew:
        first = grew[0]
        parts.append(
            f"Largest gainer: {first.get('name') or _MISSING_LABEL}, up "
            f"{first.get('change_pct', 0) or 0:+.1f}% "
            f"({_fmt(first.get('baseline_value'))} → {_fmt(first.get('comparison_value'))})."
        )
    if fell:
        first = fell[0]
        parts.append(
            f"Largest decline: {first.get('name') or _MISSING_LABEL}, down "
            f"{abs(float(first.get('change_pct') or 0)):.1f}% "
            f"({_fmt(first.get('baseline_value'))} → {_fmt(first.get('comparison_value'))})."
        )

    note_parts: list[str] = []
    if added:
        note_parts.append(f"{len(added)} group(s) are new")
    if removed:
        note_parts.append(f"{len(removed)} group(s) disappeared")
    if note_parts:
        parts.append(" and ".join(note_parts) + ".")

    if fell or grew:
        parts.append(
            "Investigate the biggest movers first — check whether volume, mix or a "
            "single group explains the difference before drawing conclusions."
        )

    for note in (result.get("reliability_notes") or [])[:3]:
        parts.append(f"Note: {note}")

    return {
        "text": "\n\n".join(parts),
        "is_ai": False,
        "source": "local",
        "reliability": "ok" if result.get("reliable", True) else "limited",
    }