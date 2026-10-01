# DataLens Backend

FastAPI backend service for tabular sales analysis, data profiling, and ABC/Pareto classification.

See the root [README.md](../README.md) for full project documentation and usage examples.

### Quick Commands

```bash
# Install dependencies
uv sync --extra dev

# Run dev server
uv run python -m uvicorn app.main:app --reload --port 8000

# Run tests
uv run pytest --cov=app --cov-report=term-missing

# Run linter
uv run ruff check .
```
