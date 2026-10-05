"""Deterministic writing of the explanations, straight from the fact brief.

This module is what Datalens uses when no ``AI_API_KEY`` is configured, and it
is also the fallback when a model call fails. It is not a language model and does
not pretend to be one — it assembles sentences from figures that
:mod:`app.services.ai.brief` already computed, which is why it can be trusted to
be correct and why it always works offline.

The hard rule, enforced by construction: **every number here is read out of the
brief.** No arithmetic beyond formatting, no estimates, no "roughly". A sentence
that would need a figure the brief does not contain is simply not written.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

# --- formatting helpers ---------------------------------------------------------

_MAX_NAME = 60

#: Month keys arrive as ISO-ish strings ("2025-12", "2025-12-01"). Rendered for
#: prose so a sentence says "Dec 2025" rather than "2025-12".
_MONTH_NAMES = (
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
)
_PERIOD_RE = re.compile(
    r"^(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?(?:[T ].*)?$"
)


def humanise_period(raw: str) -> str:
    """Turn a date or month key into something readable in a sentence.

    ``2025-12`` becomes ``Dec 2025`` and ``2025-12-01`` becomes ``1 Dec 2025``.
    Anything unrecognised is returned unchanged, so a period column of free text
    is never mangled.
    """
    text = str(raw or "").strip()
    match = _PERIOD_RE.match(text)
    if not match:
        return text
    year, month, day = match.group(1), int(match.group(2)), match.group(3)
    if not 1 <= month <= 12:
        return text
    name = _MONTH_NAMES[month - 1]
    return f"{int(day)} {name} {year}" if day else f"{name} {year}"


def _get(mapping: Any, *path: str, default: Any = None) -> Any:
    """Read a nested key path without raising on a missing intermediate."""
    current = mapping
    for key in path:
        if not isinstance(current, dict):
            return default
        current = current.get(key)
        if current is None:
            return default
    return current


def name_of(text: str) -> str:
    """Render an identifier as something readable in a sentence.

    Dates get prettified; a snake_case column name becomes spaced words;
    ``nan`` and friends become a dash rather than leaking through as text.
    """
    cleaned = " ".join(str(text or "").strip().split())
    if not cleaned or cleaned.lower() in {"nan", "none", "nat", "<na>"}:
        return "—"
    if _PERIOD_RE.match(cleaned):
        return humanise_period(cleaned)
    return cleaned.replace("_", " ")[:_MAX_NAME]


def fmt_number(value: Any, decimals: int = 2) -> str:
    """Thousands-separated number, or an em dash when absent."""
    if value is None or isinstance(value, bool):
        return "—"
    try:
        number = float(value)
    except (TypeError, ValueError):
        return "—"
    if decimals == 0:
        return f"{number:,.0f}"
    return f"{number:,.{decimals}f}".rstrip("0").rstrip(".")


def fmt_pct(value: Any, decimals: int = 1) -> str:
    """Percentage with an explicit sign-neutral percent sign."""
    if value is None or isinstance(value, bool):
        return "—"
    try:
        return f"{float(value):,.{decimals}f}%"
    except (TypeError, ValueError):
        return "—"


def fmt_signed_pct(value: Any, decimals: int = 1) -> str:
    """Percentage carrying its direction, e.g. ``-10.5%``."""
    text = fmt_pct(value, decimals)
    if text == "—":
        return text
    try:
        return f"{'+' if float(value) > 0 else ''}{text}"
    except (TypeError, ValueError):
        return text


def _direction_word(value: Any) -> str:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return "changed"
    if number > 0:
        return "up"
    if number < 0:
        return "down"
    return "flat"


def _sentence(text: str) -> str:
    """One sentence: trimmed, single-spaced, with a full stop."""
    cleaned = " ".join(str(text or "").split())
    if not cleaned:
        return ""
    return cleaned if cleaned.endswith((".", "!", "?", ":")) else cleaned + "."


# --- insight sections -----------------------------------------------------------

SECTION_EXECUTIVE = "executive_summary"
SECTION_FINDINGS = "key_findings"
SECTION_RECOMMENDATIONS = "recommendations"
SECTION_ANOMALIES = "anomalies"
SECTION_QUALITY = "data_quality"
SECTION_PRODUCTS = "product_recommendations"
SECTION_TREND = "trend_explanation"

#: Display order and headings. The UI renders these in this order.
INSIGHT_SECTIONS: list[tuple[str, str]] = [
    (SECTION_EXECUTIVE, "Executive summary"),
    (SECTION_FINDINGS, "Key findings"),
    (SECTION_PRODUCTS, "Where to act"),
    (SECTION_TREND, "What changed"),
    (SECTION_ANOMALIES, "Potential anomalies"),
    (SECTION_QUALITY, "Data quality"),
    (SECTION_RECOMMENDATIONS, "Recommendations"),
]

SECTION_TITLES = dict(INSIGHT_SECTIONS)

#: What each section is allowed to focus on. Sent to the model provider as part
#: of the system prompt so a model does not drift into another section's job.
SECTION_FOCUS: dict[str, str] = {
    SECTION_EXECUTIVE: (
        "3-5 sentences summarising the dataset for an executive. What the file is, how big "
        "the total is, how many groups there are, and the single most important thing to "
        "know. No recommendations yet."
    ),
    SECTION_FINDINGS: (
        "4-6 short findings, one per line, each starting with a bold phrase then a colon. "
        "Cover concentration, the largest mover, distribution and any standout class. Only "
        "state figures that appear in the brief."
    ),
    SECTION_PRODUCTS: (
        "Which groups deserve attention, split into 'protect', 'watch' and 'consider'. Name "
        "the groups and give their figures."
    ),
    SECTION_TREND: (
        "Explain the period-over-period movement. State the direction, the size of the "
        "change, and which group moved most. Say plainly if there is not enough history."
    ),
    SECTION_ANOMALIES: (
        "Describe the potential anomalies. Use the word 'potential'. Never suggest fraud, "
        "error or wrongdoing — the data cannot establish that. If none were found, say the "
        "scan found nothing unusual and explain what it compared."
    ),
    SECTION_QUALITY: (
        "Explain the data quality in plain language: the score, the specific problems found, "
        "how many rows or cells each affects, what was corrected automatically, and what the "
        "reader should still check."
    ),
    SECTION_RECOMMENDATIONS: (
        "3-5 concrete next steps. Each must follow from a figure in the brief. No generic "
        "advice such as 'clean your data' without specifics."
    ),
}


@dataclass
class Narrative:
    """One written section."""

    key: str
    title: str
    body: str
    #: Empty when the section had nothing to report, so the UI can hide it.
    available: bool = True
    #: Short bullets supporting the paragraph, all real figures.
    bullets: list[str] | None = None


def compose_insights(brief: dict[str, Any]) -> dict[str, Narrative]:
    """Write every insight section from the brief, with no model involved."""
    composers = {
        SECTION_EXECUTIVE: _executive_summary,
        SECTION_FINDINGS: _key_findings,
        SECTION_PRODUCTS: _product_recommendations,
        SECTION_TREND: _trend_explanation,
        SECTION_ANOMALIES: _anomaly_explanation,
        SECTION_QUALITY: _quality_explanation,
        SECTION_RECOMMENDATIONS: _recommendations,
    }
    result: dict[str, Narrative] = {}
    for key, title in INSIGHT_SECTIONS:
        body, bullets = composers[key](brief)
        result[key] = Narrative(
            key=key,
            title=title,
            body=body,
            available=bool(body.strip()),
            bullets=[b for b in (bullets or []) if b.strip()] or None,
        )
    return result


# --- section writers ------------------------------------------------------------


def _executive_summary(brief: dict[str, Any]) -> tuple[str, list[str] | None]:
    rows = _get(brief, "dataset", "rows", default=0) or 0
    columns = _get(brief, "dataset", "columns", default=0) or 0
    total = _get(brief, "totals", "total_value")
    count = _get(brief, "totals", "product_count", default=0) or 0
    score = _get(brief, "quality", "score")
    group = name_of(_get(brief, "dataset", "group_column", default="") or "row group")
    measure = name_of(_get(brief, "dataset", "measure_column", default="") or "value")
    kind_label = _get(brief, "dataset", "kind_label", default="dataset")

    if rows == 0 or count == 0:
        return (
            _sentence(
                f"This file has {rows:,} rows and {columns:,} columns, but no group could be "
                f"identified in it, so there is nothing to rank. Pick the grouping column on the "
                "Settings page and run the analysis again."
            ),
            None,
        )

    measure = name_of(_get(brief, "dataset", "measure_column", default="") or "value")
    parts = [
        _sentence(
            f"A {kind_label.lower()} file of {rows:,} rows and {columns:,} columns, ranked "
            f"across {count:,} {group}{'s' if count != 1 else ''}"
        )
    ]
    parts.append(
        _sentence(
            f"Total {measure} is {fmt_number(total)}, an average of "
            f"{fmt_number(_get(brief, 'totals', 'average_per_product'))} per {group}"
        )
    )

    concentration = _concentration_clause(brief)
    if concentration:
        parts.append(_sentence(concentration))

    mover = _mover_clause(brief)
    if mover:
        parts.append(_sentence(mover))

    if score is not None:
        parts.append(
            _sentence(
                f"Data quality scores {fmt_number(score, 1)} out of 100"
                + _quality_tail(brief)
            )
        )

    return " ".join(p for p in parts if p), None


def _key_findings(brief: dict[str, Any]) -> tuple[str, list[str] | None]:
    bullets: list[str] = []

    concentration = _concentration_clause(brief)
    if concentration:
        bullets.append(f"**Concentration:** {_sentence(concentration)}")

    abc_line = _abc_clause(brief)
    if abc_line:
        bullets.append(f"**ABC split:** {_sentence(abc_line)}")

    mover = _mover_clause(brief)
    if mover:
        bullets.append(f"**Largest move:** {_sentence(mover)}")

    tail_line = _tail_clause(brief)
    if tail_line:
        bullets.append(f"**The tail:** {_sentence(tail_line)}")

    spread = _spread_clause(brief)
    if spread:
        bullets.append(f"**Spread:** {_sentence(spread)}")

    segment_line = _segment_clause(brief)
    if segment_line:
        bullets.append(f"**Breakdown:** {_sentence(segment_line)}")

    quality_line = _quality_problem_clause(brief)
    if quality_line:
        bullets.append(f"**Data quality:** {_sentence(quality_line)}")

    if not bullets:
        return (
            _sentence(
                "There is not enough variation in this file for a finding to stand out yet."
            ),
            None,
        )

    body = _sentence(
        f"{len(bullets)} finding{'s' if len(bullets) != 1 else ''} from the analysis:"
    )
    return body, bullets


def _product_recommendations(brief: dict[str, Any]) -> tuple[str, list[str] | None]:
    top = _get(brief, "ranking", "top", default=[]) or []
    if not top:
        return (
            _sentence(
                "No ranked groups are available, so there is nothing to prioritise. Check that "
                "the grouping column is set on the Settings page."
            ),
            None,
        )

    bullets: list[str] = []
    leader = top[0]
    total = _get(brief, "totals", "total_value") or 0.0

    if len(top) >= 1 and leader.get("share_pct") is not None:
        others = top[1:]
        runner_up = others[0] if others else None
        measure_name = name_of(
            _get(brief, "dataset", "measure_column", default="") or "value"
        )
        text = (
            f"**Protect — {name_of(leader.get('name'))}:** it holds "
            f"{fmt_pct(leader.get('share_pct'))} of total {measure_name}"
        )
        if runner_up and leader.get("value") and runner_up.get("value"):
            ratio = float(leader["value"]) / float(runner_up["value"])
            if ratio >= 1.5:
                text += (
                    f", and brings in {ratio:.1f}× what the next group does"
                    f" ({name_of(runner_up.get('name'))}). Losing it would cost more than any "
                    "other single change."
                )
        bullets.append(text)

    # Watch: the largest fall among the groups big enough to matter.
    fall = _get(brief, "growth", "largest_fall")
    if fall and fall.get("name") and fall.get("change_pct") is not None:
        try:
            share = float(fall.get("latest_value") or 0.0) / total * 100.0 if total else 0.0
        except (TypeError, ValueError):
            share = 0.0
        if share >= 0.5:
            bullets.append(
                f"**Watch — {name_of(fall['name'])}:** down "
                f"{fmt_pct(abs(float(fall['change_pct'])))} in "
                f"{name_of(_get(brief, 'growth', 'latest_period'))} to "
                f"{fmt_number(fall.get('latest_value'))}. At {fmt_pct(share, 1)} of the total, "
                "that is enough to move the whole figure."
            )

    consider = _get(brief, "ranking", "bottom")
    if consider:
        names = [name_of(c.get("name")) for c in consider[:3]]
        combined = sum(
            float(c.get("value") or 0.0) for c in consider if c.get("value") is not None
        )
        bullets.append(
            f"**Consider — {len(consider)} lowest groups ({', '.join(names)}):** together "
            f"{fmt_number(combined)}, or {fmt_pct(combined / total * 100.0 if total else 0.0, 1)} "
            "of the total. Deciding whether to keep, bundle or retire them is a lower-effort "
            "question than chasing another percent from the leaders."
        )

    thin = _thin_class_clause(brief)
    if thin:
        bullets.append(f"**Coverage risk:** {_sentence(thin)}")

    body = _sentence(
        "Grouped by what the figures suggest, ordered by how much each line is worth."
    )
    return body, bullets


def _trend_explanation(brief: dict[str, Any]) -> tuple[str, list[str] | None]:
    trend = _get(brief, "trend", default={}) or {}
    if not trend.get("available"):
        return (
            _sentence(
                "No usable date column was found, so there is no period-over-period movement to "
                "explain. Totals are still calculated across the whole file."
            ),
            None,
        )

    month_count = trend.get("month_count") or 0
    latest = name_of(trend.get("latest_month") or "")
    latest_value = trend.get("last_month_value")
    change = trend.get("change_pct_first_to_last")

    if month_count < 2:
        return (
            _sentence(
                f"Only {month_count} period is present ({latest}), so there is no change to "
                "report. A second period would make a trend chart worth drawing."
            ),
            None,
        )

    parts = [
        _sentence(
            f"The file covers {month_count} periods, ending with {fmt_number(latest_value)} in "
            f"{latest}"
        )
    ]

    overall_change = _get(brief, "growth", "change_pct")
    reference = _get(brief, "growth", "previous_period")
    if overall_change is not None and reference:
        parts.append(
            _sentence(
                f"{latest} was {fmt_signed_pct(overall_change)} against {name_of(reference)}"
            )
        )
    elif change is not None:
        parts.append(
            _sentence(
                f"Across the whole span the total moved {fmt_signed_pct(change)}"
            )
        )

    rise = trend.get("biggest_rise")
    if rise and rise.get("change_pct") is not None and abs(float(rise["change_pct"])) >= 5:
        parts.append(
            _sentence(
                f"the sharpest rise was {name_of(rise.get('from_month'))} to "
                f"{name_of(rise.get('month'))}, up {fmt_pct(abs(float(rise['change_pct'])))} "
                f"to {fmt_number(rise.get('value'))}"
            )
        )

    fall = trend.get("biggest_fall")
    if fall and fall.get("change_pct") is not None and abs(float(fall["change_pct"])) >= 5:
        parts.append(
            _sentence(
                f"the sharpest fall was {name_of(fall.get('from_month'))} to "
                f"{name_of(fall.get('month'))}, down {fmt_pct(abs(float(fall['change_pct'])))} "
                f"to {fmt_number(fall.get('value'))}"
            )
        )

    bullets: list[str] | None = None
    peak = trend.get("peak_month")
    trough = trend.get("trough_month")
    if peak and trough and peak != trough:
        bullets = [
            f"**Peak:** {fmt_number(trend.get('peak_value'))} in {name_of(peak)}.",
            f"**Low:** {fmt_number(trend.get('trough_value'))} in {name_of(trough)}.",
            f"**Latest:** {fmt_number(latest_value)} in {latest}"
            + (
                f" ({fmt_signed_pct(change)} across the span)."
                if change is not None
                else "."
            ),
        ]

    return " ".join(p for p in parts if p), bullets

def _anomaly_explanation(brief: dict[str, Any]) -> tuple[str, list[str] | None]:
    anomalies = _get(brief, "anomalies", default={}) or {}
    items = anomalies.get("items") or []
    count = anomalies.get("count") or 0
    scanned = anomalies.get("rows_scanned") or 0

    if not anomalies.get("detected"):
        notes = anomalies.get("notes") or []
        return (
            _sentence(
                "The anomaly scan did not run, because "
                + (notes[0][0].lower() + notes[0][1:] if notes else "there was too little data")
                + ". Nothing is being reported as unusual."
            ),
            None,
        )

    if count == 0:
        return (
            _sentence(
                f"No potential anomalies stood out. The scan compared {scanned:,} rows against "
                "each column's own spread and checked every group against the one before it; "
                "nothing sat far enough outside to be worth a look."
            ),
            None,
        )

    high = [i for i in items if i.get("severity") == "high"]
    medium = [i for i in items if i.get("severity") == "medium"]

    lead = (
        _sentence(
            f"{count:,} potential anomal{'y' if count == 1 else 'ies'} across {scanned:,} scanned "
            "rows"
        )
        + ". "
        + _sentence(
            "These are values sitting far from the rest of their own column, not conclusions "
            "about the records — the scan compares numbers and cannot tell a mistake from a "
            "genuinely unusual transaction."
        )
    )

    bullets: list[str] = []
    for item in (high + medium)[:6]:
        label = name_of(item.get("column"))
        value = item.get("value")
        reason = " ".join(str(item.get("reason") or "").split())
        bullets.append(f"**{label} — {value}:** {_sentence(reason)}")

    notes = anomalies.get("notes") or []
    for note in notes[:2]:
        bullets.append(f"**Scope:** {_sentence(note)}")

    if count > len(items):
        bullets.append(
            f"**Scope:** the {len(items)} most extreme of {count:,} are listed here; the rest are "
            "in the Data Quality Center."
        )

    return lead, bullets


def _quality_explanation(brief: dict[str, Any]) -> tuple[str, list[str, Any] | None]:
    quality = _get(brief, "quality", default={}) or {}
    score = quality.get("score")
    issues = quality.get("issues") or []

    if score is None:
        return _sentence("No quality score was produced for this file."), None

    dropped = quality.get("rows_dropped") or 0
    duplicates = quality.get("duplicate_rows_found") or 0
    rows = _get(brief, "dataset", "rows", default=0) or 0
    columns = _get(brief, "dataset", "columns", default=0) or 0
    parts = [
        _sentence(
            f"Quality scores {fmt_number(score, 1)} out of 100, from "
            f"{fmt_number(rows)} rows and {fmt_number(columns)} columns"
        )
    ]
    if dropped:
        parts.append(
            _sentence(f"{dropped:,} completely empty rows were removed before anything was counted")
        )
    if duplicates:
        parts.append(
            _sentence(
                f"{duplicates:,} duplicate rows were found and left in place, since a repeated "
                "row can be a real second transaction"
            )
        )

    bullets: list[str] = []
    for issue in issues[:6]:
        severity = str(issue.get("severity") or "").lower()
        title = str(issue.get("title") or "").strip()
        if not title:
            continue
        tag = {"critical": "Critical", "warning": "Warning", "info": "Note"}.get(
            severity, severity.title()
        )
        action = str(issue.get("action_taken") or "").strip()
        line = f"**{tag} — {title}.**"
        if action:
            line += f" {_sentence(action)}"
        bullets.append(line)

    critical = quality.get("critical_issue_count") or 0
    if critical:
        bullets.insert(
            0,
            f"**Read this first:** {critical} issue{'s' if critical != 1 else ''} "
            f"{'are' if critical != 1 else 'is'} marked critical, meaning figures taken from "
            "this file should be checked before they are circulated.",
        )

    return " ".join(p for p in parts if p), bullets


def _recommendations(brief: dict[str, Any]) -> tuple[str, list[str] | None]:
    bullets: list[str] = []

    abc = _get(brief, "abc", default={}) or {}
    class_a = abc.get("A") or {}
    if class_a.get("product_count") and class_a.get("value_share_pct") is not None:
        a_count = class_a["product_count"]
        total_groups = _get(brief, "totals", "product_count", default=0) or 0
        pct_of_groups = a_count / total_groups * 100.0 if total_groups else 0.0
        bullets.append(
            f"**Put your effort behind {a_count} {name_of(_get(brief, 'dataset', 'group_column'))}"
            f"{'s' if a_count != 1 else ''}.** That is {fmt_pct(pct_of_groups)} of the "
            f"{total_groups:,} in the file holding {fmt_pct(class_a['value_share_pct'])} of the "
            "value. Effort spent there has the most effect on the total."
        )

    fall = _get(brief, "growth", "largest_fall")
    if fall and fall.get("name") and abs(float(fall.get("change_pct") or 0)) >= 15:
        bullets.append(
            f"**Ask why {name_of(fall['name'])} moved {fmt_signed_pct(fall.get('change_pct'))}.** "
            "It is the largest single move among the groups that matter, so the reason is more "
            "likely to be findable than most."
        )

    failed_dates = _get(brief, "quality", "failed_date_conversions") or 0
    if failed_dates:
        bullets.append(
            f"**Fix {failed_dates:,} unreadable dates at the source.** They are excluded from "
            "every trend figure, so the time charts currently understate the total. ISO "
            "`YYYY-MM-DD` is the safest format."
        )

    duplicates = _get(brief, "quality", "duplicate_rows_found") or 0
    rows = _get(brief, "dataset", "rows", default=0) or 0
    if duplicates and rows and duplicates / rows > 0.02:
        bullets.append(
            f"**Confirm what the {duplicates:,} duplicate rows are.** They are "
            f"{fmt_pct(duplicates / rows * 100.0)} of the file and are counted, so if they are "
            "an export artefact every figure here is overstated."
        )

    critical = _get(brief, "quality", "critical_issue_count") or 0
    if critical:
        bullets.append(
            f"**Resolve the {critical} critical data issue"
            f"{'s' if critical != 1 else ''} before sharing any figure.** They are listed in the "
            "Data Quality Center with the rows affected."
        )

    anomalies = _get(brief, "anomalies", default={}) or {}
    if anomalies.get("count"):
        bullets.append(
            f"**Look at {anomalies['count']:,} flagged value"
            f"{'s' if anomalies['count'] != 1 else ''}.** Each one names the column and the "
            "figure that sits outside the rest. Confirm or dismiss them individually."
        )

    concentration = _get(brief, "pareto", "groups_covering_80pct")
    total_groups = _get(brief, "totals", "product_count", default=0) or 0
    if concentration and total_groups:
        bullets.append(
            f"**Watch the {concentration} group{'s' if concentration != 1 else ''} that carry "
            f"80% of the value.** They are {fmt_pct(concentration / total_groups * 100.0)} of "
            "the file, so a small change in one of them is a large change in the total."
        )

    if not bullets:
        return (
            _sentence(
                "Nothing in this file stands out enough to need a specific next step. The "
                "figures on the Overview page are the result."
            ),
            None,
        )

    return (
        _sentence(
            f"{len(bullets)} step{'s' if len(bullets) != 1 else ''}, each tied to a figure "
            "from this analysis."
        ),
        bullets,
    )


# --- shared clauses -------------------------------------------------------------


def _concentration_clause(brief: dict[str, Any]) -> str:
    top = _get(brief, "ranking", "top", default=[]) or []
    if not top:
        return ""
    leader = top[0]
    share = leader.get("share_pct")
    if share is None:
        return ""
    group = name_of(_get(brief, "dataset", "group_column", default="") or "group")
    count = _get(brief, "totals", "product_count", default=0) or 0

    text = f"{name_of(leader.get('name'))} alone accounts for {fmt_pct(share)} of the total"
    if len(top) >= 3:
        combined = sum(float(t.get("share_pct") or 0.0) for t in top[:3])
        text += f", and the top three {group}s for {fmt_pct(combined)}"
    if count > len(top):
        text += f" of the {count:,} in the file"
    return text


def _abc_clause(brief: dict[str, Any]) -> str:
    abc = _get(brief, "abc", default={}) or {}
    parts = []
    for label in ("A", "B", "C"):
        entry = abc.get(label)
        if not entry:
            continue
        count = entry.get("product_count") or 0
        share = entry.get("value_share_pct")
        if count == 0:
            continue
        plural = "group" if count == 1 else "groups"
        parts.append(
            f"Class {label} is {count:,} {plural} at {fmt_pct(share)} of value"
        )
    return "; ".join(parts)


def _mover_clause(brief: dict[str, Any]) -> str:
    latest = name_of(_get(brief, "growth", "latest_period", default="") or "the latest period")
    fall = _get(brief, "growth", "largest_fall")
    rise = _get(brief, "growth", "largest_rise")

    candidates = []
    for entry, verb in ((fall, "fell"), (rise, "rose")):
        if entry and entry.get("name") and entry.get("change_pct") is not None:
            candidates.append((abs(float(entry["change_pct"])), entry, verb))
    if not candidates:
        overall = _get(brief, "growth", "change_pct")
        if overall is None:
            return ""
        if float(overall) > 0:
            direction = "rose"
        elif float(overall) < 0:
            direction = "fell"
        else:
            direction = "held"
        return f"the total {direction} {fmt_signed_pct(overall)} in {latest}"

    candidates.sort(key=lambda c: c[0], reverse=True)
    _, entry, verb = candidates[0]
    change = float(entry["change_pct"])

    text = (
        f"{name_of(entry['name'])} {verb} {fmt_pct(abs(change))} in {latest}, "
        "the largest change among the groups in the file"
    )
    # When nothing in the file holds a meaningful share, the biggest percentage
    # belongs to a trivial group. Say so, or the reader will chase it.
    if entry.get("material") is False and entry.get("share_of_total_pct") is not None:
        text += (
            f". Note it is only {fmt_pct(entry['share_of_total_pct'])} of the total, so the "
            "percentage is large only because the starting point was near zero"
        )
    return text


def _tail_clause(brief: dict[str, Any]) -> str:
    bottom = _get(brief, "ranking", "bottom", default=[]) or []
    top = _get(brief, "ranking", "top", default=[]) or []
    total = _get(brief, "totals", "total_value") or 0.0
    if not bottom or not total or not top:
        return ""
    combined = sum(float(c.get("value") or 0.0) for c in bottom)
    share = combined / total * 100.0
    names = [name_of(c.get("name")) for c in bottom[:3]]
    leader = name_of(top[0].get("name"))
    text = (
        f"the {len(bottom)} smallest together hold {fmt_pct(share)}, less than {leader} on its own"
    )
    if names:
        text += f" — for example {', '.join(names)}"
    return text


def _spread_clause(brief: dict[str, Any]) -> str:
    distribution = _get(brief, "distribution", default={}) or {}
    lowest = distribution.get("lowest_band") or {}
    highest = distribution.get("highest_band") or {}
    if not lowest or not highest or lowest.get("count") is None:
        return ""

    covered = distribution.get("rows_covered") or 0
    share = distribution.get("lowest_band_share_pct")
    if share is not None:
        lead = (
            f"{fmt_number(lowest['count'])} of {fmt_number(covered)} rows ({fmt_pct(share)}) sit "
            f"in the lowest value band ({fmt_number(lowest.get('min'))} to "
            f"{fmt_number(lowest.get('max'))})"
        )
    else:
        lead = (
            f"{fmt_number(lowest['count'])} of {fmt_number(covered)} rows sit in the lowest "
            f"value band ({fmt_number(lowest.get('min'))} to {fmt_number(lowest.get('max'))})"
        )

    high_count = highest.get("count") or 0
    if high_count <= (lowest.get("count") or 0):
        tail = (
            f", while the highest band holds {fmt_number(high_count)} — the file is heavily "
            "weighted towards small values"
        )
    else:
        tail = f", and the highest band holds {fmt_number(high_count)}"
    return lead + tail


def _segment_clause(brief: dict[str, Any]) -> str:
    segments = _get(brief, "segments", default=[]) or []
    if not segments:
        return ""
    segment = segments[0]
    items = segment.get("items") or []
    if not items:
        return ""
    leader = items[0]
    column = name_of(segment.get("column"))
    return (
        f"by {column}, {name_of(leader.get('label'))} is largest at "
        f"{fmt_number(leader.get('value'))} ({fmt_pct(leader.get('share_pct'))})"
    )


def _quality_problem_clause(brief: dict[str, Any]) -> str:
    quality = _get(brief, "quality", default={}) or {}
    issues = quality.get("issues") or []
    for severity in ("critical", "warning"):
        matching = [i for i in issues if i.get("severity") == severity]
        if matching:
            titles = [str(i.get("title") or "").rstrip(".") for i in matching[:2]]
            noun = "issue" if len(matching) == 1 else "issues"
            return f"{len(matching)} {severity} {noun} ({'; '.join(titles)})"
    return ""


def _quality_tail(brief: dict[str, Any]) -> str:
    quality = _get(brief, "quality", default={}) or {}
    critical = quality.get("critical_issue_count") or 0
    if critical:
        return (
            f", with {critical} critical issue{'s' if critical != 1 else ''} listed in the Data "
            "Quality Center"
        )
    return ""


def _thin_class_clause(brief: dict[str, Any]) -> str:
    abc = _get(brief, "abc", default={}) or {}
    class_a = abc.get("A") or {}
    count = class_a.get("product_count") or 0
    if count == 1:
        return (
            "the whole Class A is a single group, so the total depends on one line and any "
            "change to it is a large change to the total"
        )
    if count == 0:
        return ""
    return ""


# --- question answering ---------------------------------------------------------

#: The nine questions offered on the Ask page. Each maps to an intent below.
SUGGESTED_QUESTIONS: list[str] = [
    "Which products should I focus on?",
    "Which products are underperforming?",
    "What changed in the most recent period?",
    "How is the total value distributed?",
    "What are the biggest data quality problems?",
    "Are there any potential anomalies?",
    "What is the overall summary of this dataset?",
    "Which category or region contributes the most?",
    "How many groups are in each ABC class?",
]


#: intent -> keyword sets. Matched case-insensitively on the question, with a
#: score for each keyword hit so a longer, more specific question wins.
INTENT_KEYWORDS: dict[str, list[tuple[str, float]]] = {
    "focus": [
        ("focus", 3.0), ("priorit", 3.0), ("concentrat", 2.0), ("best", 2.0),
        ("top", 2.0), ("should i invest", 2.0), ("attend to", 2.0),
        ("where to act", 2.0), ("matter most", 2.0), ("most important", 1.5),
    ],
    "underperforming": [
        ("underperform", 4.0), ("worst", 3.0), ("losing", 3.0), ("declining", 3.0),
        ("dropped", 2.0), ("falling", 2.5), ("weak", 2.0), ("bottom", 2.5),
        ("should i drop", 3.0), ("stop selling", 2.5), ("retire", 2.0),
        ("not doing well", 2.5),
    ],
    "trend": [
        ("changed", 3.0), ("change", 2.0), ("trend", 3.0), ("recent", 2.5),
        ("latest", 3.0), ("last month", 3.0), ("most recent", 3.0), ("growth", 2.5),
        ("compared", 2.0), ("rising", 2.0), ("movement", 2.0), ("over time", 2.5),
    ],
    "distribution": [
        ("distribut", 3.5), ("spread", 2.5), ("concentrat", 2.0), ("histogram", 2.5),
        ("how many rows", 2.0), ("bucket", 2.0), ("range", 1.5), ("typical", 1.5),
        ("skew", 2.5), ("outlier", 1.5),
    ],
    "quality": [
        ("quality", 3.5), ("clean", 3.0), ("missing", 2.5), ("duplicat", 3.0),
        ("problem", 2.0), ("wrong", 2.0), ("null", 2.5), ("blank", 2.5),
        ("reliable", 2.0), ("trust", 2.0), ("issue", 1.5), ("data health", 2.5),
    ],
    "anomalies": [
        ("anomal", 4.0), ("unusual", 3.0), ("outlier", 3.0), ("weird", 2.0),
        ("strange", 2.5), ("suspicious", 3.0), ("anomaly", 4.0), ("off", 1.0),
        ("stand out", 2.0), ("flagged", 2.0),
    ],
    "summary": [
        ("summary", 3.5), ("overview", 3.0), ("summar", 3.0), ("tell me about", 2.5),
        ("what is this", 2.5), ("high level", 2.5), ("describe", 2.0),
        ("big picture", 2.5), ("in general", 2.0),
    ],
    "breakdown": [
        ("category", 3.0), ("region", 3.0), ("segment", 2.5), ("breakdown", 3.0),
        ("break down", 3.0), ("by group", 2.5), ("channel", 2.5), ("contributes", 2.0),
        ("contribute", 2.0), ("which category", 3.0), ("where does", 2.0),
    ],
    "abc": [
        ("abc", 4.0), ("class", 3.0), ("classification", 2.5), ("a class", 3.0),
        ("b class", 3.0), ("c class", 3.0), ("pareto", 2.0),
    ],
}

_STOPWORDS = {
    "what", "which", "how", "is", "are", "the", "a", "an", "of", "in", "to", "for", "my",
    "me", "i", "do", "does", "did", "should", "would", "can", "you", "dataset", "data",
    "this", "that", "it", "there", "any", "about", "on", "and", "or", "with", "be",
    "please", "tell", "give", "show", "know", "so", "at", "by", "from", "than", "then",
}


def _tokenise(question: str) -> list[str]:
    return [t for t in re.findall(r"[a-z0-9_]+", str(question or "").lower()) if t]


def classify_question(question: str) -> tuple[str, float]:
    """Pick the best intent for a question.

    Returns ``(intent, confidence)``. Confidence is the winning keyword score; a
    question with no keyword hits scores 0.0 and should be answered as a general
    summary rather than guessed at.
    """
    text = str(question or "").lower()
    scores: dict[str, float] = {}
    matched_terms: dict[str, list[str]] = {}

    for intent, keywords in INTENT_KEYWORDS.items():
        total = 0.0
        hits: list[str] = []
        for keyword, weight in keywords:
            # Phrases first (longer = more specific), then single tokens.
            if " " in keyword:
                if keyword in text:
                    total += weight
                    hits.append(keyword)
                continue
            if keyword in _STOPWORDS:
                continue
            if keyword in text:
                total += weight
                hits.append(keyword)
        if total > 0:
            scores[intent] = total
            matched_terms[intent] = hits

    if not scores:
        return "summary", 0.0

    best = max(scores.items(), key=lambda kv: (kv[1], kv[0]))
    return best[0], best[1]


def answer_question(brief: dict[str, Any], question: str) -> tuple[str, str]:
    """Answer one question from the brief. Returns ``(answer, intent)``."""
    intent, confidence = classify_question(question)

    handlers = {
        "focus": _answer_focus,
        "underperforming": _answer_underperforming,
        "trend": _answer_trend,
        "distribution": _answer_distribution,
        "quality": _answer_quality,
        "anomalies": _answer_anomalies,
        "summary": _answer_summary,
        "breakdown": _answer_breakdown,
        "abc": _answer_abc,
    }
    handler = handlers.get(intent, _answer_summary)

    prefix = ""
    if confidence == 0.0:
        prefix = (
            "I could not match that to a specific figure, so here is the overall picture. "
            "Try one of the suggested questions for a precise answer.\n\n"
        )

    answer = handler(brief, question)
    return f"{prefix}{answer}" if prefix else answer, intent


def _answer_focus(brief: dict[str, Any], question: str) -> str:
    top = _get(brief, "ranking", "top", default=[]) or []
    if not top:
        return "There are no ranked groups in this analysis, so there is nothing to focus on yet."

    group = name_of(_get(brief, "dataset", "group_column", default="") or "group")
    lines = []
    for item in top[:5]:
        lines.append(
            f"{item.get('rank')}. {name_of(item.get('name'))} — {fmt_number(item.get('value'))} "
            f"({fmt_pct(item.get('share_pct'))}, Class {_get(item, 'abc_class', default='—')})"
        )

    abc = _get(brief, "abc", "A", default={}) or {}
    tail = ""
    if abc.get("product_count") and abc.get("value_share_pct") is not None:
        total_groups = _get(brief, "totals", "product_count", default=0) or 0
        tail = (
            f"\n\nClass A is {abc['product_count']:,} {group}"
            f"{'s' if abc['product_count'] != 1 else ''} "
            f"— {fmt_pct(abc['product_count'] / total_groups * 100.0 if total_groups else 0.0)} "
            f"of the file — holding {fmt_pct(abc['value_share_pct'])} of the value. Time spent "
            f"anywhere else moves the total far less."
        )

    return "The groups carrying the most value, highest first:\n\n" + "\n".join(lines) + tail


def _answer_underperforming(brief: dict[str, Any], question: str) -> str:
    bottom = _get(brief, "ranking", "bottom", default=[]) or []
    fall = _get(brief, "growth", "largest_fall")
    total = _get(brief, "totals", "total_value") or 0.0

    if not bottom and not fall:
        return "Nothing in this file is underperforming — there are too few groups to rank."

    lines = []
    if fall and fall.get("name") and fall.get("change_pct") is not None:
        latest = name_of(_get(brief, "growth", "latest_period", default="") or "the latest period")
        lines.append(
            f"**Biggest decline:** {name_of(fall['name'])} fell "
            f"{fmt_pct(abs(float(fall['change_pct'])))} in {latest}, from "
            f"{fmt_number(fall.get('previous_value'))} to {fmt_number(fall.get('latest_value'))}."
        )

    if bottom:
        listed = "\n".join(
            f"- {name_of(c.get('name'))} — {fmt_number(c.get('value'))} "
            f"({fmt_pct(c.get('share_pct'))})"
            for c in bottom[:5]
        )
        lines.append(f"**Smallest by value:**\n\n{listed}")
        combined = sum(float(c.get("value") or 0.0) for c in bottom)
        if total:
            lines.append(
                f"Together these {len(bottom)} hold {fmt_number(combined)}, "
                f"{fmt_pct(combined / total * 100.0)} of the total."
            )

    lines.append(
        "A small group is not automatically a problem — if a group barely moves the total, "
        "deciding whether to keep it costs less than chasing growth elsewhere."
    )
    return "\n\n".join(lines)


def _answer_trend(brief: dict[str, Any], question: str) -> str:
    trend = _get(brief, "trend", default={}) or {}
    if not trend.get("available"):
        return (
            "There is no usable date column in this file, so period-over-period movement cannot "
            "be calculated. Totals across the whole file are still available."
        )

    latest = name_of(trend.get("last_month") or "")
    lines = [
        f"The file covers {trend.get('month_count')} periods, ending with "
        f"{fmt_number(trend.get('last_month_value'))} in {latest}."
    ]

    growth = _get(brief, "growth", default={}) or {}
    if growth.get("change_pct") is not None and growth.get("previous_period"):
        lines.append(
            f"**Most recent movement:** {latest} was "
            f"{fmt_signed_pct(growth['change_pct'])} against "
            f"{name_of(growth['previous_period'])} "
            f"({fmt_number(growth.get('previous_total'))} → "
            f"{fmt_number(growth.get('latest_total'))})."
        )

    if trend.get("change_pct_first_to_last") is not None:
        lines.append(
            f"**Across the whole span:** {fmt_signed_pct(trend['change_pct_first_to_last'])} "
            f"from {name_of(trend.get('first_month'))} "
            f"({fmt_number(trend.get('first_month_value'))}) to {latest}."
        )

    rise = trend.get("biggest_rise")
    fall = trend.get("biggest_fall")
    if rise and fall:
        lines.append(
            f"**Sharpest moves:** up {fmt_pct(abs(float(rise['change_pct'])))} "
            f"({name_of(rise['from_month'])} → {name_of(rise['month'])}), down "
            f"{fmt_pct(abs(float(fall['change_pct'])))} "
            f"({name_of(fall['from_month'])} → {name_of(fall['month'])})."
        )

    lines.append(f"Peak was {fmt_number(trend.get('peak_value'))} in "
                 f"{name_of(trend.get('peak_month'))}; low was "
                 f"{fmt_number(trend.get('trough_value'))} in "
                 f"{name_of(trend.get('trough_month'))}.")
    return "\n\n".join(lines)


def _answer_distribution(brief: dict[str, Any], question: str) -> str:
    distribution = _get(brief, "distribution", default={}) or {}
    buckets = distribution.get("buckets") or []
    if not buckets:
        return "This file has no measure to distribute — there is no numeric value to group."

    rows = distribution.get("rows_covered") or 0
    lines = [
        f"The measure falls into {len(buckets)} bands across {fmt_number(rows)} rows:"
    ]
    for bucket in buckets:
        lines.append(
            f"- {bucket.get('label')} — {fmt_number(bucket.get('count'))} rows "
            f"({fmt_pct((bucket.get('count') or 0) / rows * 100.0 if rows else 0)})"
        )

    share = distribution.get("lowest_band_share_pct")
    if share is not None:
        lines.append(
            f"The lowest band alone holds {fmt_pct(share)} of rows, so the file is weighted "
            "towards small values rather than large ones."
        )
    return "\n".join(lines)


def _answer_quality(brief: dict[str, Any], question: str) -> str:
    quality = _get(brief, "quality", default={}) or {}
    score = quality.get("score")
    if score is None:
        return "No quality score was produced for this file."

    lines = [f"**Quality score: {fmt_number(score, 1)} / 100.**"]

    issues = quality.get("issues") or []
    if not issues:
        lines.append(
            "No data quality issues were found — no empty rows, no duplicates, no unreadable "
            "values."
        )
    else:
        lines.append("")
        for issue in issues[:7]:
            severity = str(issue.get("severity") or "").lower()
            tag = {"critical": "Critical", "warning": "Warning", "info": "Note"}.get(
                severity, severity.title()
            )
            action = str(issue.get("action_taken") or "").strip()
            recommendation = str(issue.get("recommendation") or "").strip()
            line = f"- **{tag}:** {issue.get('title')}"
            if action:
                line += f". Datalens: {action.rstrip('.')}"
            if recommendation:
                line += f". Suggested: {recommendation.rstrip('.')}"
            lines.append(line)

    return "\n".join(lines)


def _answer_anomalies(brief: dict[str, Any], question: str) -> str:
    anomalies = _get(brief, "anomalies", default={}) or {}
    if not anomalies.get("detected"):
        notes = anomalies.get("notes") or []
        return (
            "The scan could not run. "
            + (notes[0] if notes else "There was not enough data to compare against.")
        )
    if not anomalies.get("count"):
        return (
            f"No potential anomalies stood out. The scan compared "
            f"{fmt_number(anomalies.get('rows_scanned'))} rows against each column's own spread "
            "and every group against the period before it."
        )

    items = anomalies.get("items") or []
    lines = [
        f"**{fmt_number(anomalies.get('count'))} potential anomalies** across "
        f"{fmt_number(anomalies.get('rows_scanned'))} scanned rows. These are values sitting "
        "outside the rest of their own column, not conclusions about the records.",
        "",
    ]
    for item in items[:6]:
        lines.append(
            f"- **{name_of(item.get('column'))} · {item.get('value')}** "
            f"({str(item.get('severity') or '').lower()}): {item.get('reason')}"
        )
    if len(items) < int(anomalies.get("count") or 0):
        lines.append("")
        lines.append(
            f"The rest are listed in the Data Quality Center — {anomalies['count']} in total."
        )
    return "\n".join(lines)


def _answer_summary(brief: dict[str, Any], question: str) -> str:
    narrative = compose_insights(brief)
    executive = narrative[SECTION_EXECUTIVE].body
    findings = narrative[SECTION_FINDINGS].bullets or []
    quality = narrative[SECTION_QUALITY].body

    parts = [executive]
    if findings:
        parts.append("**Key findings**\n\n" + "\n".join(f"- {f}" for f in findings[:4]))
    parts.append(quality)
    return "\n\n".join(p for p in parts if p.strip())


def _answer_breakdown(brief: dict[str, Any], question: str) -> str:
    segments = _get(brief, "segments", default=[]) or []
    if not segments:
        return (
            "This file has no column that can be broken down into groups — every column is "
            "either numeric or unique per row. Add a category, region or channel column to "
            "compare groups."
        )

    question_text = str(question or "").lower()
    # Answer the column the question actually asked about when there is a choice.
    chosen = None
    for segment in segments:
        column = name_of(segment.get("column")).lower()
        if column and column in question_text:
            chosen = segment
            break
    if chosen is None:
        chosen = segments[0]

    items = chosen.get("items") or []
    total = _get(brief, "totals", "total_value") or 0.0
    lines = [
        f"**By {name_of(chosen.get('column'))}** (measured on "
        f"{name_of(chosen.get('measure'))}, {fmt_number(total)} in total):"
    ]
    for item in items:
        lines.append(
            f"- {name_of(item.get('label'))} — {fmt_number(item.get('value'))} "
            f"({fmt_pct(item.get('share_pct'))}, {fmt_number(item.get('count'))} rows)"
        )
    if chosen.get("truncated"):
        lines.append("")
        lines.append(
            f"The file has {fmt_number(chosen.get('groups_total'))} distinct values in this "
            "column; the largest are listed and the rest are grouped as Other."
        )
    if len(segments) > 1:
        lines.append("")
        lines.append(
            "Other columns that can be broken down the same way: "
            + ", ".join(name_of(s.get("column")) for s in segments[1:4])
            + "."
        )
    return "\n".join(lines)


def _answer_abc(brief: dict[str, Any], question: str) -> str:
    abc = _get(brief, "abc", default={}) or {}
    if not abc:
        return "No ABC classification is available for this file."

    total_groups = _get(brief, "totals", "product_count", default=0) or 0
    lines = [f"**ABC split across {fmt_number(total_groups)} groups:**"]
    for label in ("A", "B", "C"):
        entry = abc.get(label)
        if not entry:
            continue
        count = entry.get("product_count") or 0
        share = entry.get("value_share_pct")
        description = {
            "A": "the groups that carry most of the value",
            "B": "the middle",
            "C": "the long tail",
        }.get(label, "")
        lines.append(
            f"- **Class {label}:** {fmt_number(count)} groups holding {fmt_pct(share)} of the "
            f"value ({fmt_number(entry.get('value'))}) — {description}"
        )

    covering = _get(brief, "pareto", "groups_covering_80pct")
    if covering and total_groups:
        lines.append("")
        lines.append(
            f"{covering} of {total_groups:,} groups reach 80% of the value, so concentration "
            "rather than breadth is what this file shows."
        )

    threshold_note = (
        "\n\nClass boundaries follow the standard cumulative thresholds: A up to 80% of value, "
        "B to 95%, C beyond. Both are configurable on the server."
    )
    return "\n".join(lines) + threshold_note


def answer_suggested_questions(brief: dict[str, Any]) -> list[dict[str, str]]:
    """The nine starter questions with a one-line description of what each returns.

    ``brief`` is accepted so a caller can pass the facts if it needs to; the
    questions themselves are fixed, which is what makes them useful as a
    starting point rather than a lottery.
    """
    del brief  # the question set is fixed; see SUGGESTED_QUESTIONS
    descriptions = {
        "focus": "The groups carrying the most value, with their share.",
        "underperforming": "The largest decline, and the smallest groups by value.",
        "trend": "Period-over-period movement, the sharpest rises and falls.",
        "distribution": "How the measure is spread across its bands.",
        "quality": "The quality score, each issue, and what Datalens did about it.",
        "anomalies": "Values outside their column's own spread.",
        "summary": "An overall picture of the dataset.",
        "breakdown": "Totals per category, region or channel.",
        "abc": "How many groups sit in each ABC class.",
    }
    questions: list[dict[str, str]] = []
    for question in SUGGESTED_QUESTIONS:
        intent, _confidence = classify_question(question)
        questions.append(
            {
                "question": question,
                "intent": intent,
                "covers": descriptions.get(intent, ""),
            }
        )
    return questions
