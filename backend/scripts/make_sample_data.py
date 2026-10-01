"""Script to generate clean and messy sample sales datasets for testing and demos."""

import csv
import random
from datetime import date, timedelta
from pathlib import Path

# Fixed seed for deterministic generation
RANDOM_SEED = 42

PRODUCTS = [
    {
        "name": "MacBook Pro 16",
        "category": "Electronics",
        "base_price": 2499.00,
        "weight": 0.25,
    },
    {
        "name": "Dell XPS 15",
        "category": "Electronics",
        "base_price": 1899.00,
        "weight": 0.20,
    },
    {
        "name": "27-inch 4K Monitor",
        "category": "Electronics",
        "base_price": 499.00,
        "weight": 0.15,
    },
    {
        "name": "Standing Desk",
        "category": "Furniture",
        "base_price": 599.00,
        "weight": 0.12,
    },
    {
        "name": "Ergonomic Chair",
        "category": "Furniture",
        "base_price": 349.00,
        "weight": 0.10,
    },
    {
        "name": "Noise-Cancelling Headphones",
        "category": "Electronics",
        "base_price": 299.00,
        "weight": 0.08,
    },
    {
        "name": "External SSD 1TB",
        "category": "Electronics",
        "base_price": 129.00,
        "weight": 0.04,
    },
    {
        "name": "Laser Printer",
        "category": "Electronics",
        "base_price": 249.00,
        "weight": 0.02,
    },
    {
        "name": "Mechanical Keyboard",
        "category": "Electronics",
        "base_price": 119.00,
        "weight": 0.015,
    },
    {
        "name": "Smart Speaker",
        "category": "Electronics",
        "base_price": 89.00,
        "weight": 0.01,
    },
    {
        "name": "Webcam HD",
        "category": "Electronics",
        "base_price": 69.00,
        "weight": 0.005,
    },
    {
        "name": "Laptop Stand",
        "category": "Office Supplies",
        "base_price": 49.00,
        "weight": 0.004,
    },
    {
        "name": "USB-C Hub",
        "category": "Office Supplies",
        "base_price": 39.00,
        "weight": 0.003,
    },
    {
        "name": "Wireless Mouse",
        "category": "Office Supplies",
        "base_price": 29.00,
        "weight": 0.002,
    },
    {
        "name": "Desk Pad",
        "category": "Office Supplies",
        "base_price": 19.00,
        "weight": 0.001,
    },
]

REGIONS = ["North America", "Europe", "Asia-Pacific", "Latin America"]


def generate_clean_dataset(num_rows: int = 600) -> list[dict[str, object]]:
    """Generate a clean dataset of sales records spanning 12 months in 2025."""
    random.seed(RANDOM_SEED)
    records = []
    start_date = date(2025, 1, 1)
    end_date = date(2025, 12, 31)
    days_range = (end_date - start_date).days

    prod_names = [p["name"] for p in PRODUCTS]
    prod_weights = [p["weight"] for p in PRODUCTS]
    prod_map = {p["name"]: p for p in PRODUCTS}

    for i in range(1, num_rows + 1):
        order_id = f"ORD-2025-{i:05d}"
        random_days = random.randint(0, days_range)
        order_date = start_date + timedelta(days=random_days)

        chosen_product = random.choices(prod_names, weights=prod_weights, k=1)[0]
        meta = prod_map[chosen_product]
        region = random.choice(REGIONS)

        # Quantity and slight price variation
        quantity = random.choices([1, 2, 3, 4, 5, 8, 10], weights=[50, 25, 12, 6, 4, 2, 1], k=1)[0]
        discount = random.choice([0.0, 0.05, 0.10, 0.15]) if random.random() < 0.3 else 0.0
        unit_price = round(meta["base_price"] * (1 - discount), 2)
        revenue = round(quantity * unit_price, 2)

        records.append({
            "order_id": order_id,
            "date": order_date.isoformat(),
            "product": chosen_product,
            "category": meta["category"],
            "region": region,
            "quantity": quantity,
            "unit_price": unit_price,
            "revenue": revenue,
        })

    return records


def generate_messy_dataset(clean_records: list[dict[str, object]]) -> list[dict[str, object]]:
    """Transform clean records into a realistic messy dataset."""
    random.seed(RANDOM_SEED + 100)
    messy_records = []

    null_tokens = ["", "NA", "N/A", "null", "-", "None"]

    for idx, r in enumerate(clean_records):
        item = dict(r)

        # 1. Messy product names: inconsistent casing and extra spaces
        prod = str(item["product"])
        case_roll = random.random()
        if case_roll < 0.25:
            prod = prod.lower()
        elif case_roll < 0.50:
            prod = prod.upper()
        elif case_roll < 0.70:
            prod = f"  {prod}   "
        elif case_roll < 0.85:
            parts = prod.split(" ")
            prod = "   ".join(parts)
        item["product"] = prod

        # 2. Messy dates: mixed formats, some bad strings
        d_str = str(item["date"])
        year, month, day = d_str.split("-")
        date_roll = random.random()
        if date_roll < 0.30:
            item["date"] = f"{day}/{month}/{year}"
        elif date_roll < 0.55:
            item["date"] = f"{month}-{day}-{year}"
        elif date_roll < 0.75:
            item["date"] = f"{year}/{month}/{day}"
        elif date_roll < 0.80:
            item["date"] = random.choice(null_tokens)
        elif date_roll < 0.83:
            item["date"] = "invalid-date-2025"

        # 3. Messy numbers & currencies: $1,299.00, 1.299,00 €, (300), etc.
        unit_price = float(item["unit_price"])
        rev = float(item["revenue"])

        num_roll = random.random()
        if num_roll < 0.35:
            item["unit_price"] = f"${unit_price:,.2f}"
            item["revenue"] = f"${rev:,.2f}"
        elif num_roll < 0.55:
            # European format: 1.234,50
            eur_price = f"{unit_price:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
            eur_rev = f"{rev:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
            item["unit_price"] = f"{eur_price} €"
            item["revenue"] = f"{eur_rev} €"
        elif num_roll < 0.65:
            item["revenue"] = f"${rev:,.2f}"

        # 4. Injected missing values
        if random.random() < 0.04:
            item["region"] = random.choice(null_tokens)
        if random.random() < 0.02:
            item["quantity"] = random.choice(null_tokens)

        messy_records.append(item)

        # 5. Add duplicate rows occasionally
        if idx % 45 == 0:
            messy_records.append(dict(item))

        # 6. Add completely empty rows occasionally
        if idx % 120 == 0:
            empty_row = {k: "" for k in item}
            messy_records.append(empty_row)

    return messy_records


def save_csv(
    data: list[dict[str, object]],
    file_path: Path,
    delimiter: str = ",",
) -> None:
    """Save records to CSV file."""
    if not data:
        return
    file_path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = list(data[0].keys())
    with open(file_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, delimiter=delimiter)
        writer.writeheader()
        writer.writerows(data)


def main() -> None:
    """Generate and write clean and messy sample files."""
    base_dir = Path(__file__).resolve().parent.parent.parent
    sample_dir = base_dir / "sample-data"

    print(f"Generating sample data into {sample_dir}...")
    clean_data = generate_clean_dataset(num_rows=600)
    save_csv(clean_data, sample_dir / "sales_clean.csv", delimiter=",")
    print(f"  -> Created sales_clean.csv ({len(clean_data)} rows)")

    messy_data = generate_messy_dataset(clean_data)
    save_csv(messy_data, sample_dir / "sales_messy.csv", delimiter=";")
    print(f"  -> Created sales_messy.csv ({len(messy_data)} rows, semicolon delimited)")


if __name__ == "__main__":
    main()
