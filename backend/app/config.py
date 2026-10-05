"""Application configuration and settings.

Every tunable lives here and is read from the environment (or a local ``.env``).
Nothing in this file contains a credential: secrets arrive through the
environment, and a value that is missing simply turns the corresponding feature
off rather than crashing the app.
"""

from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    """Application settings loaded from environment or defaults."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Datalens API"
    app_version: str = "1.0.0"
    debug: bool = False

    # --- limits ---------------------------------------------------------------
    max_upload_mb: int = Field(default=25, description="Max allowed upload file size in megabytes")
    max_rows: int = Field(default=200_000, description="Max allowed rows in uploaded dataset")
    max_columns: int = Field(default=200, description="Max allowed columns in uploaded dataset")

    # Rows returned per page by the data-explorer endpoint. The browser never
    # receives more than this, so a large file cannot be pulled into memory whole.
    explorer_page_size: int = Field(default=100, description="Default rows per data-explorer page")
    explorer_max_page_size: int = Field(
        default=1000, description="Hard ceiling on rows per data-explorer page"
    )
    #: Distinct values listed per column for the explorer's filter controls. Above
    #: this a column offers a text search instead of a dropdown: a 5,000-entry
    #: dropdown is slower and less usable than typing three characters.
    explorer_distinct_values: int = Field(
        default=50,
        ge=5,
        le=500,
        description="Distinct values listed per column in the explorer filters",
    )
    #: Rows scanned for anomaly detection. Above this the frame is sampled so a
    #: 200k-row upload does not turn a stats call into a multi-second request.
    anomaly_max_rows: int = Field(default=100_000, description="Max rows scanned for anomalies")

    # --- CORS -----------------------------------------------------------------
    allowed_origins: list[str] = Field(
        default=["http://localhost:3000"],
        description="Allowed CORS origins",
    )

    # --- ABC analysis thresholds (cumulative percentages) ---------------------
    abc_a_threshold: float = Field(
        default=80.0,
        description="Threshold percentage for Class A products (inclusive: cumulative_pct <= 80)",
    )
    abc_b_threshold: float = Field(
        default=95.0,
        description="Threshold percentage for Class B products (inclusive: cumulative_pct <= 95)",
    )

    # --- ranking defaults -----------------------------------------------------
    default_top_n: int = Field(
        default=10,
        description="Default number of top/bottom items to return",
    )
    max_top_n: int = Field(
        default=50,
        description="Max allowed value for top_n parameter",
    )

    # --- anomaly detection ----------------------------------------------------
    #: Multiplier on the interquartile range. 1.5 is the textbook Tukey fence.
    anomaly_iqr_multiplier: float = Field(default=1.5, description="IQR fence multiplier")
    #: Standard deviations from the mean for the z-score method.
    anomaly_zscore_threshold: float = Field(default=3.0, description="z-score threshold")
    #: Minimum rows in a numeric column before outlier detection is meaningful.
    anomaly_min_rows: int = Field(default=8, description="Minimum rows before IQR detection runs")
    #: Minimum distinct values before IQR detection runs.
    #:
    #: "Outside the middle 50%" only means something when there are enough distinct
    #: values for the quartiles to describe a shape. On an order-quantity column
    #: with six distinct values, IQR flags every order of 4 or more as an outlier
    #: purely because most orders are 1 — which buries the genuine 40-unit order
    #: under dozens of noise findings. The z-score method still runs, because it
    #: weights by frequency and does catch that.
    anomaly_min_distinct_values: int = Field(
        default=12,
        ge=4,
        description="Minimum distinct values before IQR detection runs",
    )
    #: Hard cap on returned anomalies, so one pathological column cannot emit 50k rows.
    anomaly_max_results: int = Field(default=200, description="Max anomalies returned")

    # --- persistence ----------------------------------------------------------
    database_url: str | None = Field(
        default=None,
        description=(
            "SQLAlchemy connection URL. Defaults to a local SQLite file in development; "
            "set to a PostgreSQL DSN in production."
        ),
    )
    database_enabled: bool = Field(
        default=True,
        description="Master switch for persistence. False runs fully in-memory.",
    )
    database_echo: bool = Field(default=False, description="Log every SQL statement")

    # --- file storage ---------------------------------------------------------
    storage_backend: str = Field(
        default="local",
        description="Storage provider name: 'local' today; 's3' is reserved for a future adapter.",
    )
    storage_root: Path = Field(
        default=BACKEND_ROOT / "var" / "storage",
        description="Directory for the local storage provider. Never served statically.",
    )
    storage_public_base_url: str | None = Field(
        default=None,
        description=(
            "Optional public base URL for object storage. Uploads are never exposed "
            "publicly by the local provider regardless of this setting."
        ),
    )

    # --- authentication -------------------------------------------------------
    auth_enabled: bool = Field(default=False, description="Require a bearer token on /v1 writes")
    auth_secret: str | None = Field(
        default=None,
        description=(
            "Secret used to sign session tokens. Required when auth_enabled is true. "
            "Generate with: python -c \"import secrets; print(secrets.token_urlsafe(48))\""
        ),
    )
    auth_token_ttl_hours: int = Field(default=24, description="Session token lifetime in hours")
    auth_default_email: str = Field(
        default="local@datalens.dev",
        description="Email of the auto-provisioned local user when auth is disabled.",
    )
    auth_default_password: str = Field(
        default="datalens",
        description="Password of the auto-provisioned local user when auth is disabled.",
    )
    password_min_length: int = Field(default=8, description="Minimum accepted password length")

    # --- AI -------------------------------------------------------------------
    ai_enabled: bool = Field(default=True, description="Master switch for AI features")
    ai_api_key: str | None = Field(default=None, description="API key for the AI provider")
    ai_base_url: str = Field(
        default="https://api.openai.com/v1",
        description="Base URL for any OpenAI-compatible chat completions endpoint",
    )
    ai_model: str = Field(default="gpt-4o-mini", description="Chat completion model name")
    ai_timeout_seconds: float = Field(default=30.0, description="Per-request AI timeout")
    ai_max_tokens: int = Field(default=1200, description="Max tokens per AI response")
    ai_temperature: float = Field(default=0.2, description="Sampling temperature")
    #: When true and no key is configured, the deterministic local narrator answers
    #: instead of the AI. Set false to make missing configuration a visible error.
    ai_allow_local_fallback: bool = Field(
        default=True,
        description="Answer from the deterministic engine when no API key is configured",
    )

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        """Accept a JSON array or a comma-separated string for CORS origins."""
        if isinstance(value, str) and not value.strip().startswith("["):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @field_validator("database_url")
    @classmethod
    def _normalise_database_url(cls, value: str | None) -> str | None:
        """Accept the bare ``postgres://`` form some hosts hand out."""
        if not value:
            return value
        if value.startswith("postgres://"):
            return value.replace("postgres://", "postgresql://", 1)
        return value

    @property
    def max_upload_bytes(self) -> int:
        """Max upload size converted to bytes."""
        return self.max_upload_mb * 1024 * 1024

    @property
    def effective_database_url(self) -> str | None:
        """The URL actually used, or None when persistence is switched off.

        Defaults to a SQLite file under ``var/`` so a fresh clone runs with no
        configuration at all. Production sets ``DATABASE_URL`` to PostgreSQL.
        """
        if not self.database_enabled:
            return None
        if self.database_url:
            return self.database_url
        return f"sqlite:///{(BACKEND_ROOT / 'var' / 'datalens.db')}"

    @property
    def is_sqlite(self) -> bool:
        url = self.effective_database_url
        return bool(url and url.startswith("sqlite"))

    @property
    def ai_is_configured(self) -> bool:
        """True when a real provider is reachable (a key is present)."""
        return bool(self.ai_enabled and self.ai_api_key and self.ai_api_key.strip())


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached settings accessor.

    Cached so that repeated imports in one process do not re-parse the
    environment, and so tests can clear the cache to pick up overrides.
    """
    return Settings()


settings = get_settings()
