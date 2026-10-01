"""Comprehensive API tests for /health, /analyze, and error responses."""

import io
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app


@pytest.fixture
def client() -> TestClient:
    """FastAPI TestClient fixture."""
    return TestClient(app)


def test_health_check(client: TestClient) -> None:
    """Test GET /health returns status ok and version."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "version" in data
    assert "X-Process-Time" in response.headers


def test_analyze_clean_csv(client: TestClient) -> None:
    """Test POST /analyze with sales_clean.csv."""
    sample_path = Path(__file__).resolve().parent.parent.parent / "sample-data" / "sales_clean.csv"
    if not sample_path.exists():
        pytest.skip("sales_clean.csv does not exist.")

    with open(sample_path, "rb") as f:
        response = client.post(
            "/analyze",
            files={"file": ("sales_clean.csv", f, "text/csv")},
            data={"top_n": 10},
        )

    assert response.status_code == 200
    data = response.json()

    # 1. Verify root keys
    for key in [
        "meta",
        "cleaning",
        "profile",
        "quality",
        "selection",
        "ranking",
        "growth",
        "charts",
        "warnings",
    ]:
        assert key in data, f"Key '{key}' missing from /analyze response"

    # 2. Meta verification
    assert data["meta"]["filename"] == "sales_clean.csv"
    assert data["meta"]["rows"] == 600
    assert data["meta"]["columns"] == 8
    assert data["meta"]["delimiter"] == ","

    # 3. Selection & candidate isolation
    assert data["selection"]["product_column"] == "product"
    assert data["selection"]["value_column"] == "revenue"
    assert data["selection"]["date_column"] == "date"
    assert data["selection"]["derived_revenue_created"] is False
    assert data["selection"]["notes"] == []

    prod_cands = [c["name"] for c in data["selection"]["product_candidates"]]
    assert "product" in prod_cands
    assert "revenue" not in prod_cands

    val_cands = [c["name"] for c in data["selection"]["value_candidates"]]
    assert "revenue" in val_cands
    assert "product" not in val_cands

    date_cands = [c["name"] for c in data["selection"]["date_candidates"]]
    assert "date" in date_cands
    assert "revenue" not in date_cands

    # 4. Profiler column isolation
    col_profiles = {c["name"]: c for c in data["profile"]["columns"]}
    assert col_profiles["revenue"]["detected_type"] == "numeric"
    assert col_profiles["revenue"]["top_values"] is None
    assert col_profiles["revenue"]["min"] is not None

    assert col_profiles["product"]["detected_type"] == "categorical"
    assert col_profiles["product"]["top_values"] is not None
    assert col_profiles["product"]["min"] is None

    # 5. Ranking & ABC classification for all 15 products
    assert data["ranking"]["product_count"] == 15
    assert len(data["ranking"]["items"]) == 15
    assert len(data["ranking"]["top_n"]) == 10
    assert len(data["ranking"]["bottom_n"]) == 10
    assert data["ranking"]["total_value"] > 0
    assert "generate 80% of the value" in data["ranking"]["pareto_summary"]

    # Verify shares sum to ~100%
    total_share = sum(item["share_pct"] for item in data["ranking"]["items"])
    assert 99.0 <= total_share <= 101.0

    # 6. Growth analysis across all products
    assert data["growth"]["has_growth_data"] is True
    assert data["growth"]["warning"] is None
    assert len(data["growth"]["items"]) == 15

    # 7. Charts data lengths
    assert len(data["charts"]["top_products_bar"]) == 10
    assert len(data["charts"]["pareto_curve"]) == 15
    assert len(data["charts"]["abc_distribution"]) == 3
    assert len(data["charts"]["monthly_trend"]) == 12
    assert len(data["charts"]["value_histogram"]) == 10

    # 8. Warnings should be empty on clean dataset
    assert data["warnings"] == []


def test_analyze_messy_csv_with_warnings(client: TestClient) -> None:
    """Test POST /analyze with sales_messy.csv and verify cleaning & warnings."""
    sample_path = Path(__file__).resolve().parent.parent.parent / "sample-data" / "sales_messy.csv"
    if not sample_path.exists():
        pytest.skip("sales_messy.csv does not exist.")

    with open(sample_path, "rb") as f:
        response = client.post(
            "/analyze",
            files={"file": ("sales_messy.csv", f, "text/csv")},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["meta"]["delimiter"] == ";"
    assert len(data["warnings"]) > 0
    assert data["cleaning"]["rows_dropped"] > 0
    assert data["ranking"]["variants_merged_count"] > 0


def test_analyze_overrides(client: TestClient) -> None:
    """Test POST /analyze with column overrides and top_n."""
    csv_content = (
        "sku_code,sale_amount,trx_date\n"
        "SKU-001,500.0,2025-01-01\n"
        "SKU-002,300.0,2025-01-02\n"
        "SKU-003,150.0,2025-02-01\n"
    )
    response = client.post(
        "/analyze",
        files={"file": ("test.csv", io.BytesIO(csv_content.encode("utf-8")), "text/csv")},
        data={
            "product_column": "sku_code",
            "value_column": "sale_amount",
            "date_column": "trx_date",
            "top_n": 2,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["selection"]["product_column"] == "sku_code"
    assert data["selection"]["value_column"] == "sale_amount"
    assert len(data["ranking"]["top_n"]) == 2


def test_analyze_unsupported_file_type(client: TestClient) -> None:
    """Test 415 error for unsupported file extension."""
    response = client.post(
        "/analyze",
        files={"file": ("test.pdf", io.BytesIO(b"%PDF-1.4..."), "application/pdf")},
    )
    assert response.status_code == 415
    data = response.json()
    assert data["error"]["code"] == "unsupported_format"
    assert "hint" in data["error"]


def test_analyze_oversized_file(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Test 413 error for oversized file upload."""
    monkeypatch.setattr(settings, "max_upload_mb", 1)
    huge_bytes = b"product,revenue\n" + (b"Widget,10\n" * 200000)
    response = client.post(
        "/analyze",
        files={"file": ("huge.csv", io.BytesIO(huge_bytes), "text/csv")},
    )
    assert response.status_code == 413
    data = response.json()
    assert data["error"]["code"] == "payload_too_large"


def test_analyze_no_numeric_column_raises_422(client: TestClient) -> None:
    """Test 422 error for file with no numeric columns."""
    csv_content = "name,category,region\nItem A,Cat1,North\nItem B,Cat2,South\n"
    response = client.post(
        "/analyze",
        files={"file": ("nonumeric.csv", io.BytesIO(csv_content.encode("utf-8")), "text/csv")},
    )
    assert response.status_code == 422
    data = response.json()
    assert data["error"]["code"] == "unprocessable_entity"
    assert "numeric" in data["error"]["message"] or "value" in data["error"]["message"]


def test_validation_error_handler(client: TestClient) -> None:
    """Test request validation error returns 422 with structured JSON."""
    response = client.post(
        "/analyze",
        data={"top_n": -5},  # top_n must be >= 1, missing file
    )
    assert response.status_code == 422
    data = response.json()
    assert data["error"]["code"] == "validation_error"
    assert "hint" in data["error"]


def test_openapi_schema_contains_analyze_and_health(client: TestClient) -> None:
    """Test OpenAPI specification exposes /health and /analyze on both surfaces."""
    response = client.get("/openapi.json")
    assert response.status_code == 200
    schema = response.json()
    paths = schema.get("paths", {})
    assert "/health" in paths
    assert "/analyze" in paths
    assert "post" in paths["/analyze"]

    # Versioned surface
    assert "/v1/analyze" in paths
    assert "post" in paths["/v1/analyze"]
    assert "/v1/health" in paths

    # Check that schema contains the full response definitions
    components = schema.get("components", {}).get("schemas", {})
    assert "AnalysisResponse" in components
    assert "RankingResponse" in components
    assert "ChartsResponse" in components


# --- /v1 versioning ----------------------------------------------------------


def test_v1_analyze_matches_legacy_response_shape(client: TestClient) -> None:
    """The /v1 route must return exactly the same payload as the legacy alias."""
    csv_bytes = (Path(__file__).resolve().parent.parent.parent
                 / "sample-data" / "sales_clean.csv")
    if not csv_bytes.exists():
        pytest.skip("sales_clean.csv does not exist yet.")
    content = csv_bytes.read_bytes()

    files = {"file": ("s.csv", io.BytesIO(content), "text/csv")}
    legacy = client.post("/analyze", files=files)
    versioned = client.post("/v1/analyze", files=files)

    assert legacy.status_code == versioned.status_code == 200
    assert set(legacy.json().keys()) == set(versioned.json().keys())
    assert versioned.json()["meta"]["rows"] == legacy.json()["meta"]["rows"]
    assert versioned.json()["ranking"] == legacy.json()["ranking"]


def test_v1_health(client: TestClient) -> None:
    """Test the versioned health endpoint."""
    response = client.get("/v1/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_unsupported_format_error_body_has_no_stack_trace(client: TestClient) -> None:
    """Error bodies must never leak internals."""
    response = client.post(
        "/v1/analyze",
        files={"file": ("evil.pkl", io.BytesIO(b"\x80\x04pickled"), "application/octet-stream")},
    )
    assert response.status_code == 415
    body = response.text
    assert "Traceback" not in body
    assert "File \"" not in body
    assert response.json()["error"]["code"] == "unsupported_format"
