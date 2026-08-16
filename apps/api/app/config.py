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
    #: How much evidence retrieval may gather before ranking. Larger than
    #: top_k so ranking has something to choose between.
    max_candidates: int = 200

    top_k_default: int = 30
    top_k_max: int = 90

    # How the three ranking signals trade off. Weights are renormalised over
    # whichever signals a candidate actually carries, so a store that records
    # no confidence is ranked on what it does know rather than dragged toward
    # a default.
    weight_relevancy: float = 0.5
    weight_confidence: float = 0.3
    weight_recency: float = 0.2
    recency_half_life_days: float = 365.0

    # Repetition penalties applied during rerank. Without them the top of the
    # list is one entity restated, and a context window full of one thing
    # cannot answer a question about two.
    same_subject_penalty: float = 0.3
    same_source_penalty: float = 0.1

    # --- answer generation ---
    #: anthropic | openai | bedrock. Which provider litellm talks to.
    llm_provider: str = "anthropic"
    #: Full litellm model id. Empty means the provider's default.
    llm_model: str = ""
    #: Overrides the provider's usual environment variable when set.
    llm_api_key: str | None = None
    answer_max_tokens: int = 4096
    llm_timeout: float = 60.0
    #: Left unset deliberately. The Claude 5 family rejects `temperature` with
    #: a 400, so a default here would break the recommended model rather than
    #: tune it. Set it only for a provider known to accept it.
    llm_temperature: float | None = None

    # The real retrieval path.
    aws_region: str = "us-east-1"
    bedrock_model_id: str = "anthropic.claude-sonnet-5"
    neptune_endpoint: str | None = None

    # Pacing for the fixture stream, in seconds. Set to 0 in tests.
    fixture_token_delay: float = 0.03


@lru_cache
def get_settings() -> Settings:
    return Settings()
