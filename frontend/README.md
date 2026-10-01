# Datalens — Frontend

Next.js (App Router) frontend for **Datalens**, an in-memory sales data analysis app.
Renders the API response as a single-column editorial report: profiling, ABC/Pareto
ranking, growth trends, and chart-ready visualisations.

---

## Setup

Requires Node.js 20+ and a running Datalens backend on port 8000.

```bash
cd frontend
npm install
```

### Environment variables

Create `frontend/.env.local` (see `.env.example`):

| Variable | Default | Description |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | Base URL of the backend API |

---

## Generate API types

The backend publishes an OpenAPI schema. Regenerate the TypeScript types whenever the
backend response models change:

```bash
npm run gen:types
```

This fetches `http://localhost:8000/openapi.json` and writes
`src/types/api.d.ts`. All API data flows through `src/lib/api.ts`, which re-exports
typed aliases from those generated types — no hand-written response types.

---

## Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Running both apps together

Two terminals, from the repo root:

```bash
# Terminal 1 — backend
cd backend
uv run python -m uvicorn app.main:app --reload --port 8000

# Terminal 2 — frontend
cd frontend
npm run dev
```

---

## CORS

The browser calls the backend directly, so the backend must allow the frontend origin.
The backend default is `["http://localhost:3000"]` in `backend/app/config.py`.

If you see a CORS error in the browser console, confirm the backend's
`ALLOWED_ORIGINS` includes `http://localhost:3000`:

```bash
# backend/.env
ALLOWED_ORIGINS=["http://localhost:3000"]
```

---

## Scripts

| Command | Purpose |
| :--- | :--- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript strict check |
| `npm run test` | Vitest + React Testing Library |
| `npm run gen:types` | Regenerate `src/types/api.d.ts` from the running backend |

---

## Project structure

```
src/
  app/
    layout.tsx          # Metadata, theme provider
    page.tsx            # Empty state / results story
    globals.css         # Design tokens, dark + light themes
  components/
    ui/                 # Button, ClassBadge, StatNumber, Chapter,
                        # Spinner, ErrorBanner, EmptyState
    upload/             # Dropzone, SampleButtons
    dashboard/          # Hero, QualityPanel, ColumnSelector,
                        # TopList/BottomList, RankingTable
    charts/             # ParetoChart, TopProductsChart, AbcPieChart,
                        # AbcBarChart, HistogramChart, TrendChart
  hooks/
    useAnalyze.ts       # useMutation wrapper for POST /analyze
    useTheme.tsx        # Theme provider, no flash on load
  lib/
    api.ts              # Typed API calls
    format.ts           # Number / percent / date formatting
    constants.ts        # Limits, colours, ABC mapping
    cn.ts               # clsx + tailwind-merge
  types/
    api.d.ts            # Generated — do not edit by hand
tests/                  # Vitest + RTL
__fixtures__/           # Captured real API responses
```

---

## Design system

Dark by default, light theme available, respects `prefers-color-scheme`, toggle
persists in `localStorage`.

| Token | Dark | Light |
| :--- | :--- | :--- |
| Page | `#0E0E10` | `#F7F4EC` |
| Text | `#ECE9E2` | `#1A1916` |
| Muted text | `#8B877E` | `#6B675E` |
| Rule | `#2A2926` | `#DCD7CA` |
| Class A | `#7EE0B0` | `#2E9E6E` |
| Class B | `#F2C66B` | `#B98A1E` |
| Class C | `#F08A7E` | `#C4584B` |

Editorial single-column layout, max width 760px, hairline rules, no cards or
drop shadows. Serif headings and large numbers, system sans for UI. ABC classes are
always shown as a coloured dot **plus** the letter, never colour alone.

---

## The report structure

| Chapter | Contents |
| :--- | :--- |
| Hero | Pareto summary as the headline, A/B/C counts, 4 stat numbers |
| 01 Your data | Quality score, missing cells, duplicates, cleaning report, warnings |
| 02 Settings | Detected columns with confidence, override dropdowns, Top N selector |
| 03 The shape | Pareto curve — bars plus cumulative line, 80% / 95% reference lines |
| 04 The leaders | Horizontal top-products bars, "Most important" list |
| 05 The split | ABC pie + value-share vs product-count-share bar |
| 06 The long tail | "Least important" list, value histogram |
| 07 Over time | Monthly trend (only when the API returns trend data) |
| 08 The data | Full ranking table: search, A/B/C filters, sorting, pagination, CSV export |

Changing a column or Top N re-runs the analysis against the same in-memory file —
no re-upload required.

---

## Accessibility

- Semantic HTML with a labelled `header`, `main`, and `section` per chapter
- Visible 2px focus rings on all interactive elements
- Keyboard-operable upload and table controls, sortable column headers
- `aria-live` loading and error regions
- Every chart has a text alternative; the pie chart states each class share
- `prefers-reduced-motion` disables transitions and animations
- Tables scroll inside their own container so the page never scrolls sideways