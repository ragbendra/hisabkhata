import os
from pathlib import Path
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_DIR = Path(__file__).resolve().parent.parent
_DEFAULT_DB = f"sqlite:///{(_BACKEND_DIR / 'dev.db').as_posix()}"


class Settings(BaseSettings):
    """All settings come from environment variables prefixed with FK_."""

    model_config = SettingsConfigDict(
        env_prefix="FK_",
        env_file=(".env", str(_BACKEND_DIR / ".env")),
        extra="ignore",
    )

    database_url: str = _DEFAULT_DB

    @field_validator("database_url", mode="before")
    @classmethod
    def normalize_database_url(cls, v: str | None) -> str:
        url = v or os.environ.get("FK_DATABASE_URL") or os.environ.get("DATABASE_URL") or _DEFAULT_DB
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql+psycopg2://", 1)
        elif url.startswith("postgresql://") and not url.startswith("postgresql+"):
            url = url.replace("postgresql://", "postgresql+psycopg2://", 1)
        return url

    # Set true in production (HTTPS only).
    cookie_secure: bool = False
    cookie_name: str = "fk_session"
    session_days: int = 30
    reset_minutes: int = 60
    # Used in password-reset links.
    app_base_url: str = "http://localhost:5173"

    @field_validator("app_base_url", mode="before")
    @classmethod
    def normalize_app_base_url(cls, v: str | None) -> str:
        url = v or os.environ.get("FK_APP_BASE_URL") or os.environ.get("RENDER_EXTERNAL_URL") or "http://localhost:5173"
        return url.rstrip("/")
    # Comma-separated list of allowed browser origins (only needed if the frontend is on another origin).
    cors_origins: str = ""

    # Email (SMTP). If smtp_host is empty, emails are logged instead of sent.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "Hisab <no-reply@example.com>"

    # Backups
    backup_dir: str = "./backups"
    backup_keep_days: int = 30
    # Off-site copy (S3-compatible object storage at a different provider/region).
    offsite_bucket: str = ""
    offsite_endpoint_url: str = ""
    offsite_access_key: str = ""
    offsite_secret_key: str = ""
    offsite_prefix: str = "fruit-khata/"


settings = Settings()
