from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

#: apps/api — env files are resolved from here rather than the working
#: directory, so the service reads the same configuration however it is started.
SERVICE_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    """Service configuration. Everything overridable from the environment."""

    model_config = SettingsConfigDict(
        # .env.local last so it wins, matching the convention Vite uses on the
        # web side: .env is the shared checked-in-shaped defaults, .env.local is
        # the developer's own and is gitignored.
        env_file=(SERVICE_ROOT / ".env", SERVICE_ROOT / ".env.local"),
        env_prefix="RAGSTONE_",
        extra="ignore",
        populate_by_name=True,
    )

    environment: str = "development"

    # Origins allowed to call the API. The Vite dev server lives on 5173.
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    # Which store answers when a request does not name one. A request may
    # only name a backend the deployment already offers; it can never supply
    # an endpoint, which would make this service an SSRF vector into the VPC.
    default_backend: str = "fixtures"

    #: Which subject this deployment is about when nothing names one. A domain
    #: declares the classes and properties a graph uses; a tenant declares how
    #: they look.
    default_domain: str = "supply-chain"

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

    # Declared with their own names rather than under the RAGSTONE_ prefix, so
    # an existing shell environment or a provider's own tooling works untouched
    # — and so they are read from .env.local, not only from the process
    # environment. Never log these; use redacted() to dump settings.
    anthropic_api_key: str | None = Field(default=None, alias="ANTHROPIC_API_KEY")
    openai_api_key: str | None = Field(default=None, alias="OPENAI_API_KEY")
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

    # openCypher over Bolt. The same adapter addresses a local Neo4j and a
    # managed Neptune cluster, which both speak Bolt — only the URI differs.
    # Absent URI means the backend is simply not offered, rather than offered
    # and broken.
    # Aliased to the driver's own variable names rather than the RAGSTONE_
    # prefix, so the values compose.yaml sets and the ones every Neo4j tool
    # already reads are the same values.
    neo4j_uri: str | None = Field(default=None, alias="NEO4J_URI")
    neo4j_user: str = Field(default="neo4j", alias="NEO4J_USER")
    neo4j_password: str | None = Field(default=None, alias="NEO4J_PASSWORD")
    neo4j_database: str = Field(default="neo4j", alias="NEO4J_DATABASE")

    # How many URLs one question may pull in. Each is a fetch the service makes
    # on a client's behalf, so the cap is a rate limit as much as a budget.
    max_urls_per_query: int = 3

    #: Rows one typed query may return. A console is exactly where somebody
    #: forgets the LIMIT, and the answer to that is a cap rather than a browser
    #: holding a million rows.
    max_query_rows: int = 200

    #: How many parameter slots a replayed query may bind. Values are bound by
    #: the driver rather than interpolated, so this is a size bound and not an
    #: injection one — a console request should not be able to hand the driver
    #: an arbitrarily large map.
    max_query_parameters: int = 32

    #: Whether the trace reports the queries retrieval issued. On, because
    #: showing the query is the point of the trace. A deployment that treats its
    #: schema as non-public should turn this off: the text names labels,
    #: relationship types and properties.
    expose_issued_queries: bool = True

    # Pacing for the fixture stream, in seconds. Set to 0 in tests.
    fixture_token_delay: float = 0.03

    def redacted(self) -> dict[str, object]:
        """Settings safe to log: every secret replaced with a presence flag.

        A key that reaches a log line is a leaked key — logs get shipped,
        aggregated and retained far more widely than anyone intends.
        """
        SECRETS = {
            "llm_api_key",
            "anthropic_api_key",
            "openai_api_key",
            "neo4j_password",
        }
        dumped = self.model_dump(mode="json")
        return {
            key: ("<set>" if value else None) if key in SECRETS else value
            for key, value in dumped.items()
        }


@lru_cache
def get_settings() -> Settings:
    return Settings()
