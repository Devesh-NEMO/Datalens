"""Classified data-quality findings for the Data Quality Center.

The quality score is a single number, which is not much use to somebody deciding
whether they can trust a number. This module turns the same underlying facts into
a list of findings a person can act on, each carrying five things:

* what happened, in plain language;
* how many rows or cells it affects;
* what Datalens already did about it;
* what a person might still want to do;
* how serious it is.

Severity is *not* an opinion about the data owner. ``critical`` means the
figures in this analysis should not be used without a look first; ``info`` means
something worth knowing that does not change the numbers.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

SEVERITY_CRITICAL = "critical"
SEVERITY_WARNING = "warning"
SEVERITY_INFO = "info"

SEVERITY_ORDER = {SEVERITY_CRITICAL: 0, SEVERITY_WARNING: 1, SEVERITY_INFO: 2}

#: Percentage of missing values in a column above which it is called out.
MISSING_COLUMN_WARN_PCT = 20.0
#: Percentage above which it escalates to critical.
MISSING_COLUMN_CRITICAL_PCT = 60.0
#: Duplicates at or above this share of the file stop being a curiosity.
DUPLICATE_CRITICAL_SHARE_PCT = 5.0


@dataclass
class QualityIssue:
    """One classified finding about the uploaded data."""

    id: str
    severity: str
    title: str
    what_happened: str
    #: Rows/cells/columns affected. 0 when the finding is not countable.
    count: int
    action_taken: str
    recommendation: str
    #: Optional grouping key so the UI can group by category.
    category: str = "general"

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "severity": self.severity,
            "title": self.title,
            "what_happened": self.what_happened,
            "count": self.count,
            "action_taken": self.action_taken,
            "recommendation": self.recommendation,
            "category": self.category,
        }


def _pct(part: int, whole: int) -> float:
    return (part / whole * 100.0) if whole else 0.0


def build_quality_issues(
    *,
    cleaning: Any,
    profile: Any,
    quality: Any,
    rows: int,
    warnings: list[str] | None = None,
) -> list[QualityIssue]:
    """Assemble the classified findings for one analysis.

    Takes the already-computed cleaning report and profile rather than the raw
    frame, so the quality page and the numbers on the dashboard are guaranteed to
    agree with each other.
    """
    issues: list[QualityIssue] = []
    warnings = warnings or []

    def get(obj: Any, name: str, default: Any = None) -> Any:
        return getattr(obj, name, default) if obj is not None else default

    rows_dropped = int(get(cleaning, "rows_dropped", 0) or 0)
    rows_before = int(get(cleaning, "rows_before", 0) or 0)
    columns_dropped = list(get(cleaning, "columns_dropped", []) or [])
    null_like = int(get(cleaning, "null_like_values_converted", 0) or 0)
    failed_dates = int(get(cleaning, "failed_date_conversions", 0) or 0)
    failed_numbers = int(get(cleaning, "failed_numeric_conversions", 0) or 0)
    conversions = list(get(cleaning, "conversions_performed", []) or [])

    duplicate_rows = int(get(profile, "duplicate_row_count", 0) or 0)
    total_missing = int(get(profile, "total_missing_cells", 0) or 0)
    score = float(get(quality, "score", 0.0) or 0.0)

    # --- empty rows -----------------------------------------------------------
    if rows_dropped > 0:
        share = _pct(rows_dropped, rows_before or rows_dropped)
        issues.append(
            QualityIssue(
                id="empty_rows",
                severity=SEVERITY_CRITICAL if share >= 10 else SEVERITY_WARNING,
                title=f"{rows_dropped:,} completely empty {self_word(rows_dropped)} removed",
                what_happened=(
                    f"{rows_dropped:,} of {rows_before:,} rows had nothing in any column "
                    f"({share:.1f}% of the file). They are kept out of every figure in this "
                    "analysis."
                ),
                count=rows_dropped,
                action_taken=f"Removed {rows_dropped:,} empty {self_word(rows_dropped)}.",
                recommendation=(
                    "Nothing to fix in your source system — but if these rows were meant to "
                    "carry data, the export is incomplete."
                ),
                category="completeness",
            )
        )

    # --- duplicate rows -------------------------------------------------------
    if duplicate_rows > 0:
        share = _pct(duplicate_rows, rows or duplicate_rows)
        severity = SEVERITY_CRITICAL if share >= DUPLICATE_CRITICAL_SHARE_PCT else SEVERITY_WARNING
        # Duplicates are *found*, never removed: they may be genuine repeat
        # business (two orders on one day), so quietly deleting them would change
        # the totals the user is trying to explain.
        issues.append(
            QualityIssue(
                id="duplicate_rows",
                severity=severity,
                title=f"{duplicate_rows:,} duplicate {self_word(duplicate_rows)} found",
                what_happened=(
                    f"{duplicate_rows:,} {self_word(duplicate_rows)} are exact copies of another "
                    f"row ({share:.1f}% of the file). They are still counted in every total here."
                ),
                count=duplicate_rows,
                action_taken="Left in place and counted. Nothing was removed.",
                recommendation=(
                    "Check whether these are genuine repeat transactions. If they are, no change "
                    "is needed. If they are an export artefact, de-duplicate in the source before "
                    "re-uploading."
                ),
                category="uniqueness",
            )
        )

    # --- missing values -------------------------------------------------------
    if total_missing > 0:
        cell_count = rows * max(int(get(profile, "column_count", 0) or 0), 1)
        share = _pct(total_missing, cell_count)
        issues.append(
            QualityIssue(
                id="missing_values",
                severity=SEVERITY_CRITICAL if share >= 25 else SEVERITY_WARNING,
                title=f"{total_missing:,} cells have no value",
                what_happened=(
                    f"{total_missing:,} of {cell_count:,} cells are empty ({share:.1f}% of the "
                    "file). Sums, averages and rankings ignore empty cells rather than treating "
                    "them as zero."
                ),
                count=total_missing,
                action_taken="Excluded empty cells from every calculation.",
                recommendation=(
                    "Totals are unaffected, but averages are computed over fewer rows than the row "
                    "count suggests. Filter to the affected column in Data Explorer to see which "
                    "rows they are."
                ),
                category="completeness",
            )
        )

    # --- null-like text -------------------------------------------------------
    if null_like > 0:
        issues.append(
            QualityIssue(
                id="null_like_values",
                severity=SEVERITY_INFO,
                title=f"{null_like:,} placeholder values treated as empty",
                what_happened=(
                    f"{null_like:,} cells contained text such as 'N/A', 'null' or '-' instead of "
                    "being blank. Counting them as real numbers would have skewed every total."
                ),
                count=null_like,
                action_taken=(
                    f"Converted {null_like:,} placeholder values into genuine empty cells."
                ),
                recommendation=(
                    "No action needed. Listed here so the row counts in the export line up with "
                    "what you see in Data Explorer."
                ),
                category="validity",
            )
        )

    # --- failed conversions ---------------------------------------------------
    if failed_numbers > 0:
        issues.append(
            QualityIssue(
                id="numeric_conversions",
                severity=SEVERITY_CRITICAL,
                title=f"{failed_numbers:,} values could not be read as numbers",
                what_happened=(
                    f"{failed_numbers:,} cells in numeric columns could not be parsed. They are "
                    "excluded from sums and averages."
                ),
                count=failed_numbers,
                action_taken=f"Excluded {failed_numbers:,} unreadable values from calculations.",
                recommendation=(
                    "These cells hold something other than a number (text, a stray unit). Sorting "
                    "the column in Data Explorer will show which rows."
                ),
                category="validity",
            )
        )

    if failed_dates > 0:
        issues.append(
            QualityIssue(
                id="date_conversions",
                severity=SEVERITY_WARNING,
                title=f"{failed_dates:,} dates could not be read",
                what_happened=(
                    f"{failed_dates:,} cells in the date column are not in a format Datalens can "
                    "interpret. Those rows still count toward totals, but they are excluded from "
                    "time-based figures such as the monthly trend and period-over-period growth."
                ),
                count=failed_dates,
                action_taken=f"Left the {failed_dates:,} unreadable dates out of trend analysis.",
                recommendation=(
                    "If the trend looks lower than expected, this is usually why. Standardise the "
                    "date format (ISO 'YYYY-MM-DD' is safest) and re-upload, or pick a different "
                    "date column in Settings."
                ),
                category="validity",
            )
        )

    # --- dropped columns ------------------------------------------------------
    if columns_dropped:
        shown = ", ".join(columns_dropped[:5])
        if len(columns_dropped) > 5:
            shown += f" and {len(columns_dropped) - 5} more"
        issues.append(
            QualityIssue(
                id="columns_dropped",
                severity=SEVERITY_WARNING,
                title=f"{len(columns_dropped)} unused {self_word(len(columns_dropped))} ignored",
                what_happened=f"{shown} contained no usable data and were set aside.",
                count=len(columns_dropped),
                action_taken="Excluded them from the analysis.",
                recommendation=(
                    "If any of these should be in the analysis, check whether the column was empty "
                    "or unreadable in the source file."
                ),
                category="structure",
            )
        )

    # --- columns that are mostly empty ---------------------------------------
    if rows > 0:
        for column in list(get(profile, "columns", []) or []):
            missing_pct = float(get(column, "missing_percent", 0.0) or 0.0)
            if missing_pct < MISSING_COLUMN_WARN_PCT:
                continue
            missing_count = int(get(column, "missing_count", 0) or 0)
            severity = (
                SEVERITY_CRITICAL
                if missing_pct >= MISSING_COLUMN_CRITICAL_PCT
                else SEVERITY_WARNING
            )
            issues.append(
                QualityIssue(
                    id=f"column_missing::{get(column, 'name', '')}",
                    severity=severity,
                    title=f"'{get(column, 'name', 'Column')}' is {missing_pct:.0f}% empty",
                    what_happened=(
                        f"{missing_count:,} of {rows:,} rows have no value in this column "
                        f"({missing_pct:.1f}%)."
                    ),
                    count=missing_count,
                    action_taken="Excluded empty cells from any figure using this column.",
                    recommendation=(
                        "Anything grouped or filtered by this column covers fewer rows than the "
                        "file has. Grouped figures for it are labelled with the row count."
                    ),
                    category="completeness",
                )
            )

    # --- types that were changed ---------------------------------------------
    if conversions:
        issues.append(
            QualityIssue(
                id="type_conversions",
                severity=SEVERITY_INFO,
                title=f"{len(conversions)} column {self_word(len(conversions), 'type')} normalised",
                what_happened=(
                    "Some columns held mixed formats — for example a mix of '2.499,00' and "
                    "'2499.0'. Values were rewritten into one consistent numeric or date format so "
                    "they could be compared."
                ),
                count=len(conversions),
                action_taken=f"Normalised {len(conversions)} column types.",
                recommendation=(
                    "No action needed. The values themselves are unchanged; only their format is."
                ),
                category="validity",
            )
        )

    # --- score band -----------------------------------------------------------
    if score < 60:
        issues.append(
            QualityIssue(
                id="score_low",
                severity=SEVERITY_CRITICAL,
                title="Overall quality score is below 60",
                what_happened=(
                    "Several problems in this file add up to a quality score of "
                    f"{score:.1f} out of 100. Totals are still calculated, but the underlying "
                    "data needs review."
                ),
                count=0,
                action_taken="Calculated everything that could be calculated and listed the rest.",
                recommendation=(
                    "Work through the critical items above before circulating any figure from this "
                    "analysis."
                ),
                category="summary",
            )
        )
    elif score < 90:
        issues.append(
            QualityIssue(
                id="score_fair",
                severity=SEVERITY_INFO,
                title=f"Quality score is {score:.1f} out of 100",
                what_happened=(
                    "The file is usable but has a few rough edges listed above. None of them "
                    "change the ranking of products."
                ),
                count=0,
                action_taken="Continued with the analysis and flagged each rough edge.",
                recommendation=(
                    "Read the warning items above; they are usually worth fixing at the source."
                ),
                category="summary",
            )
        )

    # --- analysis-level warnings ----------------------------------------------
    # Only warnings with no dedicated finding above. A reader seeing both
    # "15 dates could not be read" and "15 date cells failed parsing" learns
    # nothing the first one did not already say.
    covered = {issue.id for issue in issues}
    for index, warning in enumerate(warnings):
        if _already_covered(warning, covered):
            continue
        issues.append(
            QualityIssue(
                id=f"warning::{index}",
                severity=SEVERITY_WARNING,
                title=_shorten(warning, 70),
                what_happened=warning,
                count=0,
                action_taken="Reported it here rather than failing the analysis.",
                recommendation="Review the setting this warning refers to on the Settings page.",
                category="analysis",
            )
        )

    issues.sort(key=lambda i: (SEVERITY_ORDER[i.severity], -i.count, i.title))
    return issues


#: A warning whose text matches one of these markers is already represented by a
#: dedicated finding above, so it is not added a second time. The markers match
#: the strings ``app.services.pipeline`` produces.
_COVERED_WARNING_MARKERS: tuple[tuple[str, str], ...] = (
    ("completely empty rows", "empty_rows"),
    ("could not be parsed as numbers", "numeric_conversions"),
    ("date cells failed parsing", "date_conversions"),
    ("rows had missing values in", "missing_values"),
)


def _already_covered(warning: str, covered: set[str]) -> bool:
    """True when a dedicated finding already explains this warning."""
    lowered = str(warning).lower()
    return any(
        marker in lowered and issue_id in covered for marker, issue_id in _COVERED_WARNING_MARKERS
    )


def self_word(count: int, singular: str = "row", plural: str | None = None) -> str:
    """Pluralisation helper for the phrases above."""
    if plural is None:
        plural = f"{singular}s"
    return singular if count == 1 else plural


def _shorten(text: str, limit: int) -> str:
    """Trim a long warning down to a heading-length summary."""
    cleaned = " ".join(text.split())
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[: limit - 1].rstrip() + "…"
