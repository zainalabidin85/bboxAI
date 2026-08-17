import os
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    storage_path: str = "./storage"
    weights_path: str = "./weights"
    database_url: str = "postgresql://bboxai:password@localhost:5432/bboxai"
    secret_key: str = "change-this-to-a-random-secret-key-in-production"
    access_token_expire_minutes: int = 60 * 24 * 7  # 7 days
    cors_origins: str = "http://localhost:5173"

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()

PROJECTS_DIR = os.path.join(settings.storage_path, "projects")
WEIGHTS_DIR = os.path.abspath(settings.weights_path)
CORS_ORIGINS = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
