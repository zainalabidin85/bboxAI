from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "sqlite:///./relay.db"
    secret_key: str = "change-this-to-a-random-relay-secret-key-in-production"
    pairing_code_expire_minutes: int = 10
    session_token_expire_days: int = 365
    request_timeout_seconds: int = 60
    max_message_bytes: int = 300 * 1024 * 1024  # 300MB, matches bbox-agent

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
