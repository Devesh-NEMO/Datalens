"""Dataset profiling service calculating column-level and dataset-level statistics."""

import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd


@dataclass
class ValueCount:
    """Frequency count for a categorical value."""

    value: str
    count: int


@dataclass
class ColumnProfile:
    """Statistical profile for an individual column."""

    name: str
    detected_type: str
    missing_count: int
    missing_percent: float
    unique_count: int
    sample_values: list[str] = field(default_factory=list)
    min: float | None = None
    max: float | None = None
    mean: float | None = None
    median: float | None = None
    std: float | None = None
    top_values: list[ValueCount] | None = None


@dataclass
class DatasetProfile:
    """Complete dataset profile including dataset-level quality scores."""

    row_count: int
    column_count: int
    duplicate_row_count: int
    total_missing_cells: int
    data_quality_score: float
    columns: list[ColumnProfile] = field(default_factory=list)


def detect_column_type(name: str, series: pd.Series) -> str:
    """Classify column data type into standard profiling categories."""
    non_null = series.dropna()
    total = len(series)

    if pd.api.types.is_datetime64_any_dtype(series):
        return "date"

    if pd.api.types.is_bool_dtype(series):
        return "boolean"

    if pd.api.types.is_numeric_dtype(series):
        # Distinguish integer vs float
        if len(non_null) > 0:
            is_all_int = bool(np.all(np.equal(np.mod(non_null, 1), 0)))
            if is_all_int:
                name_lower = name.lower()
                is_id_name = any(k in name_lower for k in ["id", "code", "key", "sku"])
                if is_id_name and non_null.nunique() > total * 0.8:
                    return "id-like"
                return "integer"
        return "numeric"

    # String / Categorical / ID-like classification
    unique_cnt = non_null.nunique()
    name_lower = name.lower()
    is_id_name = any(k in name_lower for k in ["id", "code", "sku", "uuid", "key"])

    if len(non_null) > 0 and (unique_cnt / len(non_null) > 0.95 or is_id_name):
        return "id-like"

    if len(non_null) > 0 and (unique_cnt <= 30 or (unique_cnt / len(non_null)) < 0.25):
        return "categorical"

    return "text"


def calculate_quality_score(
    row_count: int,
    col_count: int,
    total_missing_cells: int,
    duplicate_row_count: int,
) -> float:
    """Calculate an overall dataset quality score from 0 to 100.

    Formula:
      Score = 100.0 - Completeness_Penalty - Duplication_Penalty

      Where:
      - Completeness_Penalty = min(50.0, (total_missing / total_cells) * 100)
      - Duplication_Penalty = min(30.0, (duplicate_rows / row_count) * 100)
    Result is clamped to [0.0, 100.0] and rounded to 1 decimal place.
    """
    if row_count == 0 or col_count == 0:
        return 0.0

    total_cells = row_count * col_count
    missing_ratio = total_missing_cells / total_cells
    completeness_penalty = min(50.0, missing_ratio * 100.0)

    duplicate_ratio = duplicate_row_count / row_count
    duplication_penalty = min(30.0, duplicate_ratio * 100.0)

    raw_score = 100.0 - completeness_penalty - duplication_penalty
    return max(0.0, min(100.0, round(raw_score, 1)))


def profile_dataset(df: pd.DataFrame) -> DatasetProfile:
    """Generate a comprehensive statistical profile of the given DataFrame."""
    row_count = len(df)
    col_count = len(df.columns)
    duplicate_count = int(df.duplicated().sum()) if row_count > 0 else 0
    total_missing = int(df.isna().sum().sum())

    quality_score = calculate_quality_score(
        row_count=row_count,
        col_count=col_count,
        total_missing_cells=total_missing,
        duplicate_row_count=duplicate_count,
    )

    column_profiles: list[ColumnProfile] = []

    for col in df.columns:
        series = df[col]
        non_null = series.dropna()
        missing_cnt = int(series.isna().sum())
        missing_pct = round((missing_cnt / row_count) * 100.0, 2) if row_count > 0 else 0.0
        unique_cnt = int(non_null.nunique())

        col_type = detect_column_type(col, series)

        # Sample values (up to 4 unique values converted to string)
        sample_vals = [str(x) for x in non_null.unique()[:4]]

        min_val: float | None = None
        max_val: float | None = None
        mean_val: float | None = None
        median_val: float | None = None
        std_val: float | None = None
        top_vals: list[ValueCount] | None = None

        if col_type in ("numeric", "integer") and len(non_null) > 0:
            min_val = round(float(non_null.min()), 2)
            max_val = round(float(non_null.max()), 2)
            mean_val = round(float(non_null.mean()), 2)
            median_val = round(float(non_null.median()), 2)
            std = float(non_null.std()) if len(non_null) > 1 else 0.0
            std_val = round(std, 2) if not math.isnan(std) else None

        if col_type in ("categorical", "text"):
            value_counts = non_null.value_counts().head(5)
            top_vals = [
                ValueCount(value=str(k), count=int(v))
                for k, v in value_counts.items()
            ]

        column_profiles.append(
            ColumnProfile(
                name=str(col),
                detected_type=col_type,
                missing_count=missing_cnt,
                missing_percent=missing_pct,
                unique_count=unique_cnt,
                sample_values=sample_vals,
                min=min_val,
                max=max_val,
                mean=mean_val,
                median=median_val,
                std=std_val,
                top_values=top_vals,
            )
        )

    return DatasetProfile(
        row_count=row_count,
        column_count=col_count,
        duplicate_row_count=duplicate_count,
        total_missing_cells=total_missing,
        data_quality_score=quality_score,
        columns=column_profiles,
    )
