import os
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    storage_path: str = "./storage"
    weights_path: str = "./weights"
    web_dist_path: str = ""
    # Opt-in, unset by default. When set (by the bboxai-desktop installers
    # only — a plain self-hosted bbox-api leaves this empty), a successful
    # /auth/register writes {"username","password"} here for bbox-agent to
    # pick up, so remote access via bboxai-remote activates automatically
    # without a separate manual "enable remote" step. See routers/auth.py.
    agent_credentials_path: str = ""
    database_url: str = "postgresql://bboxai:password@localhost:5432/bboxai"
    secret_key: str = "change-this-to-a-random-secret-key-in-production"
    access_token_expire_minutes: int = 60 * 24 * 7  # 7 days
    cors_origins: str = "http://localhost:5173"

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()

PROJECTS_DIR = os.path.abspath(os.path.join(settings.storage_path, "projects"))
WEIGHTS_DIR = os.path.abspath(settings.weights_path)
CORS_ORIGINS = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
WEB_DIST_DIR = os.path.abspath(settings.web_dist_path) if settings.web_dist_path else None
