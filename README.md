# Datalens

A data analysis monorepo: upload a CSV or Excel sales file, get a data profile, an
important-vs-least-important product ranking, and chart-ready JSON.

| Folder | Stack | Purpose |
| :--- | :--- | :--- |
| `backend/` | FastAPI, Pydantic v2, Pandas | In-memory profiling, ABC/Pareto ranking, chart JSON |
| `frontend/` | Next.js (App Router), TypeScript, Tailwind, Recharts | Single-column editorial report of the analysis |
| `sample-data/` | — | Generated demo CSVs |

**Stack:** FastAPI, Pydantic v2, Pandas, NumPy, OpenPyXL · Next.js 16, React 19, Tailwind CSS 4, Recharts, TanStack Query, react-dropzone. Dependencies managed with `uv` (backend) and `npm` (frontend).

> **Pareto** and **ABC** are the analysis techniques used throughout, not the product
> name — the app is **Datalens**.

---

## Quick start

Two terminals, from the repo root:

```bash
# Terminal 1 — backend API
cd backend
uv sync --extra dev
uv run python -m uvicorn app.main:app --reload --port 8000
```

```bash
# Terminal 2 — frontend
cd frontend
npm install
npm run dev
```

Then open **http://localhost:3000**. The API docs are at **http://localhost:8000/docs**.

Click "Try sales_clean.csv" or "Try sales_messy.csv" to see the report immediately,
or upload your own `.csv` / `.xlsx` / `.xls` file.

The browser talks to the backend directly, so the backend must allow the frontend
origin. The default `ALLOWED_ORIGINS` is `["http://localhost:3000"]`; see
[Backend configuration](#backend-configuration) if you hit a CORS error.

---

## Backend

High-performance, in-memory data analysis and profiling backend built with FastAPI, Pandas, and Pydantic v2.

Processes uploaded CSV and Excel sales datasets in-memory to deliver statistical profiling, ABC/Pareto classification, period-over-period growth analysis, and chart-ready JSON structures without saving any user files to disk.

Processes uploaded CSV and Excel sales datasets in-memory to deliver statistical profiling, ABC/Pareto classification, period-over-period growth analysis, and chart-ready JSON structures without saving any user files to disk.

---

## Features

- **In-Memory Tabular Processing**: Supports `.csv`, `.xlsx`, and `.xls` formats with zero disk writes.
- **Smart Delimiter & Encoding Detection**: Automatically sniffs CSV delimiters (`,`, `;`, `\t`, `|`) and handles UTF-8, UTF-8-SIG (BOM), and Latin-1 fallbacks.
- **Data Cleaning & Normalization**:
  - Handles international currencies (`$`, `€`, `£`, `¥`, `₹`), European number formats (`1.234,50`), percentages (`12%`), and accounting negatives (`(300)`).
  - Normalizes null tokens (`"NA"`, `"N/A"`, `"null"`, `"-"`, `""`) to `NaN`.
  - Parses mixed datetime strings and counts conversion failures.
  - Drops fully empty rows and columns without mutating original inputs.
- **Automated Column Detection**:
  - Heuristically identifies `product_column`, `value_column` (revenue/sales), and `date_column`.
  - Automatically computes `derived_revenue = quantity * price` if revenue is missing but price and quantity exist.
  - Supports explicit manual overrides (`product_column`, `value_column`, `date_column`).
- **ABC / Pareto Product Ranking**:
  - Aggregates by product and resolves casing/whitespace variants (e.g., `MacBook Pro`, `macbook pro`).
  - Classifies products into Class A (cumulative <= 80%), Class B (cumulative <= 95%), and Class C (> 95%).
  - Configurable thresholds via environment/settings.
  - Stable sort with alphabetical tie-breakers; handles single products, negative values, and zero-total datasets.
- **Period Growth Analysis**: Calculates month-over-month growth percentage and trends (`rising`, `falling`, `flat`).
- **Chart-Ready JSON**: Produces pre-computed data for top product bar charts, Pareto cumulative curves, ABC distribution, monthly trends, and 10-bucket value histograms.
- **Structured Error Handling**: All errors return a predictable contract:
  ```json
  {
    "error": {
      "code": "UNPROCESSABLE_ENTITY",
      "message": "...",
      "hint": "..."
    }
  }
  ```

---

## Backend setup

### Prerequisites

- Python 3.12 or 3.13
- [`uv`](https://docs.astral.sh/uv/) package manager

### 1. Installation

From the `backend/` directory:

```bash
cd backend
uv sync --extra dev
```

### 2. Run the Development Server

```bash
uv run python -m uvicorn app.main:app --reload --port 8000
```

The API will be live at `http://localhost:8000`.

- **Interactive API Documentation (Swagger UI)**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **OpenAPI Schema (JSON)**: [http://localhost:8000/openapi.json](http://localhost:8000/openapi.json)

---

## API Endpoints

### 1. Health Check
```http
GET /health
```
**Response:**
```json
{
  "status": "ok",
  "version": "0.1.0"
}
```

---

### 2. Analyze Dataset
```http
POST /analyze
```

Accepts `multipart/form-data`:

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `file` | File (`.csv`, `.xlsx`, `.xls`) | **Yes** | Tabular dataset to analyze |
| `product_column` | String | No | Override product/entity column name |
| `value_column` | String | No | Override numeric metric/revenue column name |
| `date_column` | String | No | Override date/timestamp column name |
| `top_n` | Integer (1-50) | No | Number of top/bottom items to return (default: `10`) |
| `sheet_name` | String | No | Specific sheet name for Excel files (default: first sheet) |

#### Example `curl` Request

```bash
curl -X POST \
  -F "file=@../sample-data/sales_clean.csv" \
  -F "top_n=10" \
  http://localhost:8000/analyze
```

With overrides:
```bash
curl -X POST \
  -F "file=@../sample-data/sales_messy.csv" \
  -F "product_column=product" \
  -F "value_column=revenue" \
  -F "top_n=5" \
  http://localhost:8000/analyze
```

---

## Response Structure

```json
{
  "meta": {
    "filename": "sales_clean.csv",
    "rows": 600,
    "columns": 8,
    "processing_ms": 32.5,
    "delimiter": ",",
    "sheet_name": null
  },
  "cleaning": {
    "rows_before": 600,
    "rows_after": 600,
    "rows_dropped": 0,
    "columns_dropped": [],
    "conversions_performed": [
      "Parsed column 'date' as datetime (600 valid dates)",
      "Converted column 'revenue' to numeric (600 valid values)"
    ],
    "failed_numeric_conversions": 0,
    "failed_date_conversions": 0,
    "null_like_values_converted": 0
  },
  "profile": {
    "row_count": 600,
    "column_count": 8,
    "duplicate_row_count": 0,
    "total_missing_cells": 0,
    "data_quality_score": 100.0,
    "columns": [...]
  },
  "quality": {
    "score": 100.0,
    "status": "Excellent",
    "duplicate_row_count": 0,
    "total_missing_cells": 0,
    "description": "High dataset integrity with negligible missing or duplicate records."
  },
  "selection": {
    "product_column": "product",
    "product_confidence": 0.95,
    "product_candidates": [...],
    "value_column": "revenue",
    "value_confidence": 0.95,
    "value_candidates": [...],
    "date_column": "date",
    "date_confidence": 0.95,
    "date_candidates": [...],
    "derived_revenue_created": false,
    "notes": []
  },
  "ranking": {
    "total_value": 724850.0,
    "product_count": 15,
    "items": [...],
    "top_n": [...],
    "bottom_n": [...],
    "pareto_summary": "4 of 15 products (26.7%) generate 80% of the value",
    "abc_summary": {
      "class_a_count": 4,
      "class_a_value": 580000.0,
      "class_a_share_pct": 80.0,
      "class_b_count": 5,
      "class_b_value": 108000.0,
      "class_b_share_pct": 14.9,
      "class_c_count": 6,
      "class_c_value": 36850.0,
      "class_c_share_pct": 5.1
    },
    "missing_value_rows_count": 0,
    "variants_merged_count": 0,
    "negative_value_products_count": 0
  },
  "growth": {
    "has_growth_data": true,
    "previous_period": "2025-11",
    "latest_period": "2025-12",
    "items": [...],
    "warning": null
  },
  "charts": {
    "top_products_bar": [...],
    "pareto_curve": [...],
    "abc_distribution": [...],
    "monthly_trend": [...],
    "value_histogram": [...]
  },
  "warnings": []
}
```

---

## Configuration & Limits

Configured in `app/config.py` and overrideable via environment variables (`.env`):

| Variable | Default | Description |
| :--- | :--- | :--- |
| `MAX_UPLOAD_MB` | `10` | Maximum file upload size in megabytes |
| `MAX_ROWS` | `200000` | Maximum allowed rows |
| `MAX_COLUMNS` | `100` | Maximum allowed columns |
| `ALLOWED_ORIGINS` | `["http://localhost:3000"]` | Allowed CORS origins for frontend |
| `ABC_A_THRESHOLD` | `80.0` | Class A cumulative threshold percentage (`<= 80.0%`) |
| `ABC_B_THRESHOLD` | `95.0` | Class B cumulative threshold percentage (`<= 95.0%`) |
| `DEFAULT_TOP_N` | `10` | Default top/bottom items count |
| `MAX_TOP_N` | `50` | Maximum allowed value for `top_n` |
| `AUTH_ENABLED` | `false` | Require sign-in (`Authorization: Bearer <token>`) on `/v1` writes |
| `AUTH_SECRET` | — | Token signing secret. Required (refused loudly when missing) if `AUTH_ENABLED` is on. Generate with `python -c "import secrets; print(secrets.token_urlsafe(48))"` |
| `AUTH_TOKEN_TTL_HOURS` | `24` | Session token lifetime in hours |

---

## Authentication

Auth is **off by default** — a fresh clone runs and analyses files with no
configuration. Turning it on is one variable:

```bash
AUTH_ENABLED=true
AUTH_SECRET="$(python -c 'import secrets; print(secrets.token_urlsafe(48))')"
```

### Endpoints

| Endpoint | Purpose |
| :--- | :--- |
| `GET /v1/auth/session` | Who am I — safe with no token; also reports `auth_required` |
| `POST /v1/auth/register` | Create an account → 201 with a session token |
| `POST /v1/auth/login` | Exchange credentials for a session token |
| `POST /v1/auth/logout` | Stateless: the client discards the token |
| `GET /v1/auth/me` | The signed-in user (requires a token) |

Errors are always `{"error": {"code", "message", "hint"}}`. Login returns the
same sentence for an unknown email and a wrong password, so the endpoint is not
an account-existence oracle; deactivated accounts are a distinct `403`.

### How the frontend keeps the session

The session token is a bearer token held in `localStorage` ("Remember me") or
`sessionStorage` (single tab) and sent as `Authorization: Bearer <token>` on
every API request. Expired tokens are treated as signed out locally, without a
network round trip; there is no server-side session record, so logout is purely
a client-side discard.

**The tradeoff, stated plainly:** anything that can run JavaScript on the app's
origin can read the token, so XSS becomes full account compromise. The current
mitigations are hygiene — no tokens in URLs, no tokens in the DOM, no logging of
secrets — not a cure. The planned hardening step is a Next.js route handler that
proxies `/v1/auth/*`, sets the token in an **httpOnly + SameSite cookie**, and
has `apiFetch` send requests cookie-first: the token then never lives where an
injected script can read it. That is deliberately *not* implemented here.

**Rate limiting is left to the deployment.** In-process limits are trivially
bypassed by running more than one worker and would give a false sense of
protection; put a real limiter in front of `/v1/auth/*` before exposing a
public deployment.

---

## ABC & Pareto Analysis Logic

1. **Aggregation**: Data is grouped by canonical product name (merging case and whitespace variations) and values are summed.
2. **Sorting**: Products are sorted in descending order of value, using canonical product name as a secondary tie-breaker.
3. **Cumulative Share Calculation**: For each product $i$, `cumulative_pct` is computed including product $i$'s share:
   $$\text{share\_pct}_i = \frac{\text{value}_i}{\text{total\_value}} \times 100$$
   $$\text{cumulative\_pct}_i = \sum_{k=1}^i \text{share\_pct}_k$$
4. **Classification**:
   - **Class A**: $\text{cumulative\_pct} \le 80.0\%$ (Top drivers of value)
   - **Class B**: $80.0\% < \text{cumulative\_pct} \le 95.0\%$ (Moderate contributors)
   - **Class C**: $\text{cumulative\_pct} > 95.0\%$ (Long tail / low volume)

---

## Generating Sample Data

To recreate the clean and messy sales CSV fixtures:

```bash
uv run python scripts/make_sample_data.py
```

This generates:
- `sample-data/sales_clean.csv`: 600 rows, 15 products, 12 months in 2025.
- `sample-data/sales_messy.csv`: 619 rows with semicolon delimiters, currency symbols (`$`, `€`), messy casing, missing values, and duplicate rows.

---

## Backend tests & linting

```bash
cd backend

# Unit & API tests
uv run pytest

# With coverage
uv run pytest --cov=app --cov-report=term-missing

# Lint
uv run ruff check .
```

---

## Frontend

Next.js App Router app that renders the analysis as a single-column editorial report.

Full documentation, design tokens, and accessibility notes are in
[`frontend/README.md`](frontend/README.md).

### Run

```bash
cd frontend
npm install
npm run dev      # http://localhost:3000
```

### Generate API types from the running backend

```bash
npm run gen:types   # http://localhost:8000/openapi.json -> src/types/api.d.ts
```

Re-run this whenever the backend response models change. All API data flows through
`src/lib/api.ts`, which re-exports typed aliases from the generated types.

### Frontend tests & linting

```bash
npm run test        # Vitest + React Testing Library
npm run lint        # ESLint
npm run typecheck   # TypeScript strict check
npm run build       # Production build
```
