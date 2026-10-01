"""Unit tests for product ranking, ABC analysis, and growth calculations (ranking.py)."""

import pandas as pd

from app.services.ranking import compute_growth, compute_ranking


def test_ranking_exact_spec_dataset() -> None:
    """Test standard 50/30/15/5 dataset against ABC threshold rules."""
    df = pd.DataFrame({
        "product": ["Product A", "Product B", "Product C", "Product D"],
        "revenue": [50.0, 30.0, 15.0, 5.0],
    })

    result = compute_ranking(
        df,
        product_col="product",
        value_col="revenue",
        a_threshold=80.0,
        b_threshold=95.0,
    )

    assert result.total_value == 100.0
    assert result.product_count == 4

    # Assert shares
    assert [item.share_pct for item in result.items] == [50.0, 30.0, 15.0, 5.0]

    # Assert cumulative percentages
    assert [item.cumulative_pct for item in result.items] == [50.0, 80.0, 95.0, 100.0]

    # Assert ABC classes
    assert [item.abc_class for item in result.items] == ["A", "A", "B", "C"]

    # Assert Pareto summary
    assert "2 of 4 products (50.0%) generate 80% of the value" in result.pareto_summary

    # Assert ABC Summary
    assert result.abc_summary.class_a_count == 2
    assert result.abc_summary.class_a_value == 80.0
    assert result.abc_summary.class_a_share_pct == 80.0
    assert result.abc_summary.class_b_count == 1
    assert result.abc_summary.class_b_value == 15.0
    assert result.abc_summary.class_b_share_pct == 15.0
    assert result.abc_summary.class_c_count == 1
    assert result.abc_summary.class_c_value == 5.0
    assert result.abc_summary.class_c_share_pct == 5.0

    # Assert top_n and bottom_n
    assert len(result.top_n) == 4
    assert len(result.bottom_n) == 4
    assert result.top_n[0].product == "Product A"
    assert result.bottom_n[-1].product == "Product D"


def test_ranking_ties_and_alphabetical_tiebreaker() -> None:
    """Test that equal values sort alphabetically by product name."""
    df = pd.DataFrame({
        "product": ["Zebra", "Apple", "Mango"],
        "sales": [100.0, 100.0, 50.0],
    })

    result = compute_ranking(df, product_col="product", value_col="sales")
    assert result.items[0].product == "Apple"
    assert result.items[1].product == "Zebra"
    assert result.items[2].product == "Mango"


def test_ranking_single_product() -> None:
    """Test ranking with only 1 product."""
    df = pd.DataFrame({"product": ["Solo"], "sales": [500.0]})
    result = compute_ranking(df, product_col="product", value_col="sales")
    assert result.product_count == 1
    assert result.items[0].share_pct == 100.0
    assert result.items[0].cumulative_pct == 100.0
    assert result.items[0].abc_class == "A"


def test_ranking_negative_values() -> None:
    """Test ranking with net negative products."""
    df = pd.DataFrame({
        "product": ["Good Item", "Returned Item"],
        "profit": [200.0, -50.0],
    })
    result = compute_ranking(df, product_col="product", value_col="profit")
    assert result.negative_value_products_count == 1
    assert result.items[0].product == "Good Item"
    assert result.items[1].product == "Returned Item"
    assert result.items[1].value == -50.0


def test_ranking_zero_total() -> None:
    """Test zero total value does not produce NaN or ZeroDivisionError."""
    df = pd.DataFrame({
        "product": ["A", "B"],
        "sales": [0.0, 0.0],
    })
    result = compute_ranking(df, product_col="product", value_col="sales")
    assert result.total_value == 0.0
    assert result.items[0].share_pct == 0.0
    assert result.items[0].cumulative_pct == 0.0


def test_ranking_product_name_variants_merged() -> None:
    """Test case and whitespace variants are merged."""
    df = pd.DataFrame({
        "product": ["MacBook Pro", "  macbook pro  ", "MACBOOK PRO", "Dell XPS"],
        "sales": [100.0, 50.0, 50.0, 200.0],
    })
    result = compute_ranking(df, product_col="product", value_col="sales")
    assert result.variants_merged_count == 2
    assert result.product_count == 2
    # MacBook Pro total should be 200.0, Dell XPS 200.0
    prod_names = [i.product for i in result.items]
    assert "Dell XPS" in prod_names
    assert "MacBook Pro" in prod_names


def test_ranking_missing_values_handled() -> None:
    """Test rows with missing value columns are treated as 0 and reported."""
    df = pd.DataFrame({
        "product": ["A", "A", "B"],
        "sales": [100.0, None, 50.0],
    })
    result = compute_ranking(df, product_col="product", value_col="sales")
    assert result.missing_value_rows_count == 1
    assert result.total_value == 150.0


def test_growth_calculation() -> None:
    """Test month-over-month growth directions."""
    df = pd.DataFrame({
        "product": ["Laptop", "Laptop", "Mouse", "Mouse"],
        "sales": [100.0, 150.0, 50.0, 25.0],
        "date": ["2025-01-15", "2025-02-15", "2025-01-10", "2025-02-10"],
    })
    growth = compute_growth(df, product_col="product", value_col="sales", date_col="date")
    assert growth.has_growth_data is True
    assert growth.previous_period == "2025-01"
    assert growth.latest_period == "2025-02"

    growth_map = {item.product: item for item in growth.items}
    assert growth_map["Laptop"].direction == "rising"
    assert growth_map["Laptop"].change_pct == 50.0
    assert growth_map["Mouse"].direction == "falling"
    assert growth_map["Mouse"].change_pct == -50.0


def test_growth_insufficient_periods() -> None:
    """Test growth returns warning when less than 2 months available."""
    df = pd.DataFrame({
        "product": ["Laptop"],
        "sales": [100.0],
        "date": ["2025-01-15"],
    })
    growth = compute_growth(df, product_col="product", value_col="sales", date_col="date")
    assert growth.has_growth_data is False
    assert growth.warning is not None
