"""Data cleaning and type normalization service."""

import re
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd

NULL_VALUES_SET = {
    "",
    "na",
    "n/a",
    "null",
    "none",
    "nan",
    "-",
    "--",
    "nil",
    "undefined",
    "#n/a",
    "#na",
}

CURRENCY_SYMBOLS = ["$", "€", "£", "¥", "₹", "CHF", "EUR", "USD", "GBP"]
VALUE_METRIC_KEYWORDS = {
    "revenue",
    "sales",
    "price",
    "amount",
    "quantity",
    "cost",
    "total",
    "profit",
    "margin",
    "unit_price",
    "qty",
}


@dataclass
class CleaningReport:
    """Summary report of all data cleaning transformations performed."""

    rows_before: int
    rows_after: int
    rows_dropped: int
    columns_dropped: list[str] = field(default_factory=list)
    conversions_performed: list[str] = field(default_factory=list)
    failed_numeric_conversions: int = 0
    failed_date_conversions: int = 0
    null_like_values_converted: int = 0


def clean_numeric_string(val: Any) -> float | None:
    """Parse numeric strings with currencies, European formatting, percentages, and parentheses."""
    if pd.isna(val) or val is None:
        return None

    if isinstance(val, (int, float, np.integer, np.floating)):
        return float(val) if not np.isnan(val) else None

    s = str(val).strip()
    if not s or s.lower() in NULL_VALUES_SET:
        return None

    # Handle negative represented with parentheses: (123.45) -> -123.45
    is_negative = False
    if s.startswith("(") and s.endswith(")"):
        is_negative = True
        s = s[1:-1].strip()

    if s.startswith("-"):
        is_negative = True
        s = s[1:].strip()

    # Remove currency symbols and codes
    for curr in CURRENCY_SYMBOLS:
        s = s.replace(curr, "")
    s = s.strip()

    # Check and remove percentage sign
    if s.endswith("%"):
        s = s[:-1].strip()

    if not s:
        return None

    # Handle thousand and decimal separators:
    # Case 1: Both '.' and ',' present
    if "." in s and "," in s:
        first_dot = s.find(".")
        first_comma = s.find(",")
        s = (
            s.replace(".", "").replace(",", ".")
            if first_dot < first_comma
            else s.replace(",", "")
        )
    elif "," in s:
        # Only comma present
        # If it matches standard thousand groupings: 1,000 or 12,345,678
        if re.match(r"^\d{1,3}(,\d{3})+$", s):
            s = s.replace(",", "")
        # If it has 1 or 2 digits after comma: 1234,50 or 45,5 -> decimal comma
        elif re.match(r"^\d+,\d{1,2}$", s):
            s = s.replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "." in s:
        # Only dot present: if multiple dots like 1.234.567 -> European thousands
        if s.count(".") > 1 and re.match(r"^\d{1,3}(\.\d{3})+$", s):
            s = s.replace(".", "")

    try:
        num = float(s)
        return -num if is_negative else num
    except (ValueError, TypeError):
        return None


def is_likely_numeric_series(series: pd.Series, threshold: float = 0.6) -> bool:
    """Determine if a series contains mostly numeric or parseable numeric values."""
    if pd.api.types.is_numeric_dtype(series):
        return True

    non_null = series.dropna()
    if len(non_null) == 0:
        return False

    success_count = 0
    for val in non_null:
        if clean_numeric_string(val) is not None:
            success_count += 1

    return (success_count / len(non_null)) >= threshold


def is_likely_date_column(col_name: str, series: pd.Series, threshold: float = 0.5) -> bool:
    """Determine if a column represents dates based on name heuristic and formatted date strings."""
    # Numeric types (float, int) are never date columns in tabular sales data
    if pd.api.types.is_numeric_dtype(series):
        return False

    if pd.api.types.is_datetime64_any_dtype(series):
        return True

    name_lower = str(col_name).lower().strip()

    # Metric/value columns should never be parsed as dates
    if any(kw in name_lower for kw in VALUE_METRIC_KEYWORDS):
        return False

    date_keywords = ["date", "time", "timestamp", "created_at", "month", "day", "year", "period"]
    has_date_name = any(kw in name_lower for kw in date_keywords)

    non_null = series.dropna()
    if len(non_null) == 0:
        return has_date_name

    # Check for date formatting patterns in text (e.g., 2025-01-15, 15/01/2025, 2025.01.15)
    date_regex = re.compile(
        r"(\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4})|(\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b)",
        re.IGNORECASE,
    )

    sample = [str(x).strip() for x in non_null.head(30)]
    date_like_strings = [s for s in sample if date_regex.search(s)]

    if not date_like_strings:
        return False

    parsed = pd.to_datetime(date_like_strings, format="mixed", errors="coerce")
    parse_ratio = parsed.notna().sum() / len(sample)

    if has_date_name and parse_ratio >= 0.3:
        return True
    return parse_ratio >= threshold


def clean_dataset(df: pd.DataFrame) -> tuple[pd.DataFrame, CleaningReport]:
    """Clean DataFrame by stripping text, converting types, dropping empty rows/columns."""
    cleaned = df.copy()
    rows_before = len(cleaned)

    # 1. Normalize text cells: strip whitespace & replace null-like tokens with np.nan
    null_like_count = 0
    for col in cleaned.columns:
        if cleaned[col].dtype == object or isinstance(cleaned[col].dtype, pd.StringDtype):
            def clean_text_cell(val: Any) -> Any:
                nonlocal null_like_count
                if pd.isna(val) or val is None:
                    return np.nan
                s = str(val).strip()
                if not s or s.lower() in NULL_VALUES_SET:
                    null_like_count += 1
                    return np.nan
                return s

            cleaned[col] = cleaned[col].apply(clean_text_cell)

    # 2. Drop completely empty rows
    cleaned = cleaned.dropna(how="all").reset_index(drop=True)
    rows_dropped = rows_before - len(cleaned)

    # 3. Drop completely empty columns
    cols_before = list(cleaned.columns)
    cleaned = cleaned.dropna(axis=1, how="all")
    columns_dropped = [c for c in cols_before if c not in cleaned.columns]

    conversions: list[str] = []
    failed_numeric = 0
    failed_date = 0

    # 4. Type conversions per column
    for col in cleaned.columns:
        # Check if column looks like a Date
        if is_likely_date_column(col, cleaned[col]):
            non_null_before = cleaned[col].notna().sum()
            parsed_dates = pd.to_datetime(cleaned[col], format="mixed", errors="coerce")
            non_null_after = parsed_dates.notna().sum()
            col_failed = int(non_null_before - non_null_after)
            if col_failed > 0:
                failed_date += col_failed
            cleaned[col] = parsed_dates
            conversions.append(
                f"Parsed column '{col}' as datetime ({non_null_after} valid dates)"
            )
            continue

        # Check if column is numeric or numeric-looking
        if is_likely_numeric_series(cleaned[col]):
            non_null_before = cleaned[col].notna().sum()
            converted_series = cleaned[col].apply(clean_numeric_string)
            non_null_after = converted_series.notna().sum()
            col_failed = int(non_null_before - non_null_after)
            if col_failed > 0:
                failed_numeric += col_failed
            cleaned[col] = pd.to_numeric(converted_series, errors="coerce")
            conversions.append(
                f"Converted column '{col}' to numeric ({non_null_after} valid values)"
            )

    report = CleaningReport(
        rows_before=rows_before,
        rows_after=len(cleaned),
        rows_dropped=rows_dropped,
        columns_dropped=columns_dropped,
        conversions_performed=conversions,
        failed_numeric_conversions=failed_numeric,
        failed_date_conversions=failed_date,
        null_like_values_converted=null_like_count,
    )

    return cleaned, report
