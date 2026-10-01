"""Application configuration and settings."""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment or defaults."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Datalens API"
    app_version: str = "0.1.0"
    debug: bool = False

    # Limits
    max_upload_mb: int = Field(default=25, description="Max allowed upload file size in megabytes")
    max_rows: int = Field(default=200_000, description="Max allowed rows in uploaded dataset")
    max_columns: int = Field(default=200, description="Max allowed columns in uploaded dataset")

    # CORS
    allowed_origins: list[str] = Field(
        default=["http://localhost:3000"],
        description="Allowed CORS origins",
    )

    # ABC Analysis Thresholds (cumulative percentages)
    abc_a_threshold: float = Field(
        default=80.0,
        description="Threshold percentage for Class A products (inclusive: cumulative_pct <= 80)",
    )
    abc_b_threshold: float = Field(
        default=95.0,
        description="Threshold percentage for Class B products (inclusive: cumulative_pct <= 95)",
    )

    # Ranking defaults
    default_top_n: int = Field(
        default=10,
        description="Default number of top/bottom items to return",
    )
    max_top_n: int = Field(
        default=50,
        description="Max allowed value for top_n parameter",
    )

    @property
    def max_upload_bytes(self) -> int:
        """Max upload size converted to bytes."""
        return self.max_upload_mb * 1024 * 1024


settings = Settings()
