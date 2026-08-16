"""The backend port, and the boundary a request may not cross.

The security property under test is narrow and load-bearing: a request selects
among backends the deployment already offers, and has no way to describe a new
destination. Everything else here is about that selection behaving predictably.
"""

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.retrieval.fixture_store import FixtureGraphStore
from app.retrieval.models import RetrievalRequest
from app.retrieval.registry import build_registry
from app.retrieval.store import GraphStore, UnknownBackendError


class TestRegistry:
    def test_offers_the_fixture_store_out_of_the_box(self, settings: Settings) -> None:
        assert "fixtures" in build_registry(settings).names()

    def test_resolves_the_default_when_none_is_named(self, settings: Settings) -> None:
        registry = build_registry(settings)
        assert registry.get(None).name == registry.default

    def test_rejects_an_unknown_backend_and_says_what_is_available(
        self, settings: Settings
    ) -> None:
        registry = build_registry(settings)
        with pytest.raises(UnknownBackendError) as error:
            registry.get("neo4j-in-my-basement")

        assert "fixtures" in str(error.value)

    def test_falls_back_when_the_configured_default_is_unavailable(self) -> None:
        # A deployment misconfiguration should degrade, not refuse to start.
        registry = build_registry(Settings(default_backend="not-installed"))
        assert registry.default == "fixtures"

    def test_a_store_that_cannot_reach_anything_is_absent_rather_than_broken(self) -> None:
        # Registering a Neptune store without an adapter would make the backend
        # listing a promise the service cannot keep.
        registry = build_registry(Settings(neptune_endpoint="wss://example.invalid:8182"))
        assert registry.names() == ["fixtures"]


class TestFixtureStore:
    @pytest.fixture
    def store(self) -> FixtureGraphStore:
        return FixtureGraphStore()

    def test_satisfies_the_port(self, store: FixtureGraphStore) -> None:
        assert isinstance(store, GraphStore)

    @pytest.mark.anyio
    async def test_returns_statements_carrying_a_triple(self, store: FixtureGraphStore) -> None:
        candidates = await store.retrieve(RetrievalRequest(query="suppliers at risk"))

        assert candidates
        for candidate in candidates:
            assert candidate.kind == "statement"
            # The triple is what lets the graph frame be projected from the
            # answer's own evidence rather than fetched separately.
            assert candidate.subject and candidate.predicate and candidate.object

    @pytest.mark.anyio
    async def test_respects_the_node_cap(self, store: FixtureGraphStore) -> None:
        candidates = await store.retrieve(RetrievalRequest(query="x", max_nodes=3))
        assert len(candidates) <= 3

    @pytest.mark.anyio
    async def test_filters_by_entity_type_when_asked(self, store: FixtureGraphStore) -> None:
        candidates = await store.retrieve(RetrievalRequest(query="x", entity_types=["Location"]))

        assert candidates
        for candidate in candidates:
            assert "Location" in {candidate.subject_type, candidate.object_type}

    @pytest.mark.anyio
    async def test_candidates_dedupe_by_key(self, store: FixtureGraphStore) -> None:
        candidates = await store.retrieve(RetrievalRequest(query="x"))
        keys = [candidate.key() for candidate in candidates]
        assert len(keys) == len(set(keys))


class TestBackendsEndpoint:
    def test_lists_what_a_request_may_name(self, client: TestClient) -> None:
        body = client.get("/api/backends").json()

        assert [entry["name"] for entry in body] == ["fixtures"]
        assert sum(entry["default"] for entry in body) == 1

    def test_selecting_an_offered_backend_streams_normally(
        self, client: TestClient, query_body: dict
    ) -> None:
        query_body["retrieval"]["backend"] = "fixtures"
        assert client.post("/api/query", json=query_body).status_code == 200

    def test_an_unknown_backend_fails_before_the_stream_opens(
        self, client: TestClient, query_body: dict
    ) -> None:
        # A 200 cannot be taken back once the stream starts, so this has to be
        # a status code rather than an error frame.
        query_body["retrieval"]["backend"] = "http://169.254.169.254/latest/meta-data/"
        response = client.post("/api/query", json=query_body)

        assert response.status_code == 400
        assert "fixtures" in response.json()["detail"]

    def test_a_request_cannot_describe_a_destination(
        self, client: TestClient, query_body: dict
    ) -> None:
        # The SSRF boundary: extra fields naming an endpoint are ignored by the
        # model, and the named backend still has to be one the server offers.
        query_body["retrieval"]["endpoint"] = "wss://attacker.example/gremlin"
        query_body["retrieval"]["backend"] = "fixtures"

        assert client.post("/api/query", json=query_body).status_code == 200
