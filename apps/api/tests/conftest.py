import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import app


@pytest.fixture
def settings() -> Settings:
    """Settings with the fixture stream's pacing removed, so tests do not sleep."""
    return Settings(fixture_token_delay=0.0)


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
