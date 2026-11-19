from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def normalize_db_url(url: str) -> str:
    """Name the PostgreSQL driver explicitly. Without it SQLAlchemy 2.1 picks psycopg 3, while this app
    ships psycopg2, so a plain postgresql:// URL (what Neon and Render hand out) would fail to start."""
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg2://" + url[len(prefix):]
    return url


class Settings(BaseSettings):
    """All settings come from environment variables prefixed with FK_."""

    model_config = SettingsConfigDict(env_prefix="FK_", env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./dev.db"

    @field_validator("database_url")
    @classmethod
    def _driver(cls, v: str) -> str:
        return normalize_db_url(v)

    # Set true in production (HTTPS only).
    cookie_secure: bool = False
    cookie_name: str = "fk_session"
    session_days: int = 30
    reset_minutes: int = 60
    # Printed under the shop name on PDF bills, e.g. "Main Road, Biratnagar · Ph 98XXXXXXXX · PAN 123456789".
    bill_address: str = ""  # fallback only
    brand_url: str = "https://hisabkhata-c6nn.onrender.com"
    # Used in password-reset links.
    app_base_url: str = "http://localhost:5173"
    # Platform admin (the person who runs Hisab). The admin page is at /admin.
    admin_cookie_name: str = "fk_admin"
    admin_session_hours: int = 12
    # If set, a short email is sent here whenever someone asks for access.
    admin_notify_email: str = ""
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
