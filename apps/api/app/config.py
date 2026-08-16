from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Service configuration. Everything overridable from the environment."""

    model_config = SettingsConfigDict(env_file=".env", env_prefix="RAGSTONE_", extra="ignore")

    environment: str = "development"

    # Origins allowed to call the API. The Vite dev server lives on 5173.
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    # Which store answers when a request does not name one. A request may
    # only name a backend the deployment already offers; it can never supply
    # an endpoint, which would make this service an SSRF vector into the VPC.
    default_backend: str = "fixtures"

    # Retrieval shaping.
    top_k_default: int = 30
    top_k_max: int = 90

    # The real retrieval path.
    aws_region: str = "us-east-1"
    bedrock_model_id: str = "anthropic.claude-sonnet-5"
    neptune_endpoint: str | None = None

    # Pacing for the fixture stream, in seconds. Set to 0 in tests.
    fixture_token_delay: float = 0.03


@lru_cache
def get_settings() -> Settings:
    return Settings()
