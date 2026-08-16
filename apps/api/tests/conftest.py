import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import app

#: Provider keys the service reads from the ambient environment.
PROVIDER_KEY_VARS = ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "RAGSTONE_LLM_API_KEY")


def isolated_settings(**overrides: object) -> Settings:
    """Settings that ignore the developer's .env and .env.local.

    Without `_env_file=None` the suite reads whatever key happens to be on the
    machine, so it calls a real provider: slow, non-deterministic, billed, and
    green or red depending on whose laptop ran it.
    """
    return Settings(_env_file=None, **overrides)  # type: ignore[arg-type]


@pytest.fixture(autouse=True)
def no_ambient_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    """Belt and braces: a key exported in the shell must not reach a test.

    `_env_file=None` covers the files; this covers the process environment,
    which the registry also consults.
    """
    for name in PROVIDER_KEY_VARS:
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def settings() -> Settings:
    """Settings with the fixture stream's pacing removed, so tests do not sleep."""
    return isolated_settings(fixture_token_delay=0.0)


@pytest.fixture
def client(settings: Settings) -> TestClient:
    app.dependency_overrides[get_settings] = lambda: settings
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def query_body() -> dict:
    return {
        "conversation_id": "conv-1",
        "messages": [
            {
                "id": "m1",
                "role": "user",
                "content": "which suppliers are at risk?",
                "timestamp": "2026-08-16T00:00:00Z",
            }
        ],
        "input": {"text": "which suppliers are at risk?"},
        "options": {"stream": True, "response_format": "markdown"},
        "retrieval": {
            "mode": "graph_rag",
            "graph": {"max_hops": 2, "max_nodes": 150, "entity_types": []},
        },
    }


@pytest.fixture
def anyio_backend() -> str:
    """Run async tests on asyncio; trio is not a dependency here."""
    return "asyncio"
