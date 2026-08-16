"""Choosing which generator answers.

A model-backed generator is built only when the deployment has a key for the
configured provider. Without one the fixtures answer — so the app works with
nothing configured, which is what makes the public demo instant and free
(roadmap item 62) rather than a broken page asking for credentials.
"""

import logging
import os

from ..config import Settings
from .fixture import FixtureAnswerGenerator
from .generator import AnswerGenerator
from .litellm_generator import LiteLLMAnswerGenerator

logger = logging.getLogger(__name__)

#: Where each provider's key lives, using the names the providers' own tools use
#: so an existing shell environment works untouched.
PROVIDER_KEY_ENV: dict[str, str] = {
    "anthropic": "ANTHROPIC_API_KEY",
    "openai": "OPENAI_API_KEY",
}

#: A sensible model per provider when the deployment does not name one.
PROVIDER_DEFAULT_MODEL: dict[str, str] = {
    "anthropic": "anthropic/claude-opus-5",
    "openai": "openai/gpt-5",
}


def provider_key(provider: str, settings: Settings) -> str | None:
    """The key for a provider: explicit setting first, then the environment."""
    if settings.llm_api_key:
        return settings.llm_api_key
    env_name = PROVIDER_KEY_ENV.get(provider)
    return os.environ.get(env_name) if env_name else None


def resolve_model(settings: Settings) -> str:
    if settings.llm_model:
        return settings.llm_model
    return PROVIDER_DEFAULT_MODEL.get(settings.llm_provider, "")


def build_generator(settings: Settings) -> AnswerGenerator:
    """The generator this deployment can actually run."""
    provider = settings.llm_provider
    key = provider_key(provider, settings)
    model = resolve_model(settings)

    if not key or not model:
        logger.info(
            "No %s credentials configured; answering from fixtures.",
            provider,
        )
        return FixtureAnswerGenerator(token_delay=settings.fixture_token_delay)

    logger.info("Answering with %s via litellm.", model)
    return LiteLLMAnswerGenerator(
        model=model,
        api_key=key,
        max_tokens=settings.answer_max_tokens,
        timeout=settings.llm_timeout,
        temperature=settings.llm_temperature,
    )
