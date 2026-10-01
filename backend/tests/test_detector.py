"""Unit tests for column detection service (detector.py)."""

from pathlib import Path

import pandas as pd
import pytest

from app.core.errors import UnprocessableDataError
from app.loaders import load_file
from app.services.cleaner import clean_dataset
from app.services.detector import detect_columns


def test_detect_columns_clean_sample() -> None:
    """Test column auto-detection on clean sample dataset."""
    sample_path = Path(__file__).resolve().parent.parent.parent / "sample-data" / "sales_clean.csv"
    if not sample_path.exists():
        pytest.skip("sales_clean.csv does not exist yet.")

    loaded = load_file(sample_path.read_bytes(), "sales_clean.csv")
    cleaned, _ = clean_dataset(loaded.df)
    _, selection = detect_columns(cleaned)

    assert selection.product_column == "product"
    assert selection.value_column == "revenue"
    assert selection.date_column == "date"
    assert selection.product_confidence >= 0.8
    assert selection.value_confidence >= 0.8

    # Ensure candidates only contain appropriate columns
    prod_cand_names = [c.name for c in selection.product_candidates]
    assert "product" in prod_cand_names
    assert "revenue" not in prod_cand_names
    assert "date" not in prod_cand_names

    val_cand_names = [c.name for c in selection.value_candidates]
    assert "revenue" in val_cand_names
    assert "product" not in val_cand_names

    date_cand_names = [c.name for c in selection.date_candidates]
    assert "date" in date_cand_names
    assert "revenue" not in date_cand_names


def test_detect_columns_messy_sample() -> None:
    """Test column auto-detection on messy sample dataset."""
    sample_path = Path(__file__).resolve().parent.parent.parent / "sample-data" / "sales_messy.csv"
    if not sample_path.exists():
        pytest.skip("sales_messy.csv does not exist yet.")

    loaded = load_file(sample_path.read_bytes(), "sales_messy.csv")
    cleaned, _ = clean_dataset(loaded.df)
    _, selection = detect_columns(cleaned)

    assert selection.product_column == "product"
    assert selection.value_column == "revenue"
    assert selection.date_column == "date"


def test_detect_columns_overrides() -> None:
    """Test manual overrides for product, value, and date columns."""
    df = pd.DataFrame({
        "item_name": ["A", "B"],
        "category_name": ["Cat1", "Cat2"],
        "price_val": [10.0, 20.0],
        "created_on": [pd.Timestamp("2025-01-01"), pd.Timestamp("2025-01-02")],
    })

    _, selection = detect_columns(
        df,
        product_override="category_name",
        value_override="price_val",
        date_override="created_on",
    )
    assert selection.product_column == "category_name"
    assert selection.product_confidence == 1.0
    assert selection.value_column == "price_val"
    assert selection.date_column == "created_on"


def test_detect_columns_invalid_override() -> None:
    """Test specifying non-existent override column raises UnprocessableDataError."""
    df = pd.DataFrame({"product": ["A", "B"], "sales": [10.0, 20.0]})

    with pytest.raises(UnprocessableDataError) as exc:
        detect_columns(df, product_override="non_existent")
    assert "not found" in exc.value.message


def test_detect_columns_derived_revenue() -> None:
    """Test derived revenue generation when only quantity and price exist."""
    df = pd.DataFrame({
        "item": ["A", "B"],
        "quantity": [2.0, 3.0],
        "price": [50.0, 100.0],
    })

    derived_df, selection = detect_columns(df)
    assert selection.derived_revenue_created is True
    assert "derived_revenue" in derived_df.columns
    assert derived_df["derived_revenue"].tolist() == [100.0, 300.0]
    assert selection.value_column == "derived_revenue"


def test_detect_columns_missing_product_raises() -> None:
    """Test dataset without any text/categorical column raises 422 error."""
    # A dataset with no columns candidate
    df = pd.DataFrame()
    with pytest.raises(UnprocessableDataError):
        detect_columns(df)
