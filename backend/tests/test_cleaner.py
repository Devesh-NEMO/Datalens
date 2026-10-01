"""Unit tests for data cleaning service (cleaner.py)."""

import pandas as pd

from app.services.cleaner import clean_dataset, clean_numeric_string


def test_clean_numeric_string_formats() -> None:
    """Test various currency, European, percentage, and negative formats."""
    assert clean_numeric_string("$1,234.50") == 1234.50
    assert clean_numeric_string("1.234,50") == 1234.50
    assert clean_numeric_string("1.299,00 €") == 1299.00
    assert clean_numeric_string("£45.99") == 45.99
    assert clean_numeric_string("12%") == 12.0
    assert clean_numeric_string("(300)") == -300.0
    assert clean_numeric_string("( $1,500.50 )") == -1500.50
    assert clean_numeric_string("- $20.50") == -20.50
    assert clean_numeric_string(" 500 ") == 500.0
    assert clean_numeric_string(42) == 42.0
    assert clean_numeric_string(3.14) == 3.14
    assert clean_numeric_string("NA") is None
    assert clean_numeric_string("-") is None
    assert clean_numeric_string("") is None
    assert clean_numeric_string("Not a number") is None


def test_clean_dataset_null_like_tokens() -> None:
    """Test normalization of null-like strings to NaN and whitespace stripping."""
    raw_df = pd.DataFrame({
        "product": ["  Laptop  ", "Mouse", "NA", "-", "Keyboard"],
        "price": ["$1,000", "25", "10", "50", "None"],
    })

    cleaned, report = clean_dataset(raw_df)
    assert report.null_like_values_converted >= 3
    assert cleaned["product"].iloc[0] == "Laptop"
    assert pd.isna(cleaned["product"].iloc[2])
    assert pd.isna(cleaned["product"].iloc[3])
    assert cleaned["product"].iloc[4] == "Keyboard"
    assert cleaned["price"].iloc[0] == 1000.0
    assert cleaned["price"].iloc[1] == 25.0
    assert cleaned["price"].iloc[2] == 10.0
    assert cleaned["price"].iloc[3] == 50.0
    assert pd.isna(cleaned["price"].iloc[4])


def test_clean_dataset_date_parsing() -> None:
    """Test date column parsing and counting of invalid dates."""
    raw_df = pd.DataFrame({
        "order_date": ["2025-01-15", "15/02/2025", "03-20-2025", "invalid-date", None],
        "value": ["100", "200", "300", "400", "500"],
    })

    cleaned, report = clean_dataset(raw_df)
    assert pd.api.types.is_datetime64_any_dtype(cleaned["order_date"])
    assert report.failed_date_conversions == 1
    assert cleaned["order_date"].iloc[0].year == 2025


def test_clean_dataset_drops_empty_rows_and_cols() -> None:
    """Test that completely empty rows and columns are dropped."""
    raw_df = pd.DataFrame({
        "product": ["Laptop", None, "Mouse", ""],
        "empty_col": [None, None, "", "-"],
        "price": ["1000", None, "25", ""],
    })

    cleaned, report = clean_dataset(raw_df)
    assert "empty_col" in report.columns_dropped
    assert report.rows_dropped >= 1
    assert len(cleaned) == 2


def test_clean_dataset_does_not_mutate_original() -> None:
    """Test immutability of the original input DataFrame."""
    raw_df = pd.DataFrame({
        "product": ["  Laptop  "],
        "price": ["$1,000"],
    })
    original_product = raw_df["product"].iloc[0]
    original_price = raw_df["price"].iloc[0]

    cleaned, _ = clean_dataset(raw_df)
    assert raw_df["product"].iloc[0] == original_product
    assert raw_df["price"].iloc[0] == original_price
    assert cleaned["product"].iloc[0] == "Laptop"
    assert cleaned["price"].iloc[0] == 1000.0
