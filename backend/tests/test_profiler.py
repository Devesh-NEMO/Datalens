"""Unit tests for dataset profiling service (profiler.py)."""

import pandas as pd

from app.services.profiler import calculate_quality_score, profile_dataset


def test_profile_dataset_numeric_and_categorical() -> None:
    """Test profiling of numeric and categorical statistics."""
    df = pd.DataFrame({
        "product": ["Widget", "Widget", "Gadget", "Gizmo"],
        "price": [10.0, 20.0, 30.0, 40.0],
        "quantity": [1, 2, 1, 5],
    })

    profile = profile_dataset(df)
    assert profile.row_count == 4
    assert profile.column_count == 3
    assert profile.duplicate_row_count == 0
    assert profile.total_missing_cells == 0
    assert profile.data_quality_score == 100.0

    # Check column profiles
    col_map = {c.name: c for c in profile.columns}
    assert "product" in col_map
    assert col_map["product"].detected_type in ("categorical", "text")
    assert col_map["product"].top_values is not None
    assert col_map["product"].top_values[0].value == "Widget"
    assert col_map["product"].top_values[0].count == 2
    assert col_map["product"].min is None
    assert col_map["product"].max is None
    assert col_map["product"].mean is None

    # Check numeric price stats
    assert col_map["price"].min == 10.0
    assert col_map["price"].max == 40.0
    assert col_map["price"].mean == 25.0
    assert col_map["price"].median == 25.0
    assert col_map["price"].std is not None
    assert col_map["price"].top_values is None


def test_profile_column_isolation() -> None:
    """Ensure statistics and top values are calculated purely per-column."""
    df = pd.DataFrame({
        "category": ["Electronics", "Electronics", "Furniture"],
        "revenue": [1000.0, 2000.0, 500.0],
    })
    profile = profile_dataset(df)
    col_map = {c.name: c for c in profile.columns}

    # Category must not receive revenue numbers
    assert col_map["category"].min is None
    assert col_map["category"].top_values is not None
    assert col_map["category"].top_values[0].value == "Electronics"

    # Revenue must not receive category top values
    assert col_map["revenue"].top_values is None
    assert col_map["revenue"].min == 500.0
    assert col_map["revenue"].max == 2000.0


def test_profile_dataset_duplicates_and_missing() -> None:
    """Test quality score penalties for duplicates and missing cells."""
    df = pd.DataFrame({
        "item": ["A", "A", "B", None],
        "sales": [100.0, 100.0, None, 50.0],
    })

    profile = profile_dataset(df)
    assert profile.duplicate_row_count == 1
    assert profile.total_missing_cells == 2
    assert profile.data_quality_score < 100.0


def test_quality_score_edge_cases() -> None:
    """Test quality score boundary values."""
    assert calculate_quality_score(0, 0, 0, 0) == 0.0
    assert calculate_quality_score(100, 5, 0, 0) == 100.0
    # Heavy missing & duplicate penalties
    score = calculate_quality_score(100, 5, 250, 50)
    assert score <= 50.0
