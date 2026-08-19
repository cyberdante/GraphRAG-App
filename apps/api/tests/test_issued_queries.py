"""What the pipeline asked, reported back.

The trace could say how many candidates were considered, how long each phase
took, which model answered and which backend served it — everything except the
question behind the numbers. For a repository whose claim is that the graph is
real rather than decorative, that was the missing evidence.

Two properties matter more than the plumbing. A store that issues queries must
report every one of them, or the trace understates the work and a reader
comparing row counts to budgets gets nonsense. And a store that issues none must
report none — the fixture store filters a list in Python, and a query string
invented to fill the panel would be read as something a database ran.
"""

import pytest

from app.config import Settings
from app.retrieval.fixture_store import FixtureGraphStore
from app.retrieval.issued import QueryRecorder
from app.retrieval.models import RetrievalRequest
from app.streaming import issued_queries


def a_request(**overrides) -> RetrievalRequest:
    fields = {
        "query": "which suppliers are at risk?",
        "max_candidates": 30,
        "max_nodes": 60,
        "max_hops": 2,
        "entity_types": [],
        "entity_ids": [],
        "top_k": 10,
    }
    fields.update(overrides)
    return RetrievalRequest(**fields)


class TestABackendThatIssuesNothing:
    """The fixture store must not invent a query to look busy."""

    @pytest.mark.anyio
    async def test_records_nothing(self):
        recorder = QueryRecorder()
        candidates = await FixtureGraphStore().retrieve(a_request(), recorder)

        # It answered — so an empty recording is a claim about *how*, not a
        # sign that retrieval did not run.
        assert candidates
        assert recorder.queries == []

    @pytest.mark.anyio
    async def test_still_answers_without_a_recorder(self):
        # The recorder is optional, and a store must not require one. This is
        # the call every existing caller makes.
        assert await FixtureGraphStore().retrieve(a_request())


class TestWhatReachesTheClient:
    def test_reports_each_recorded_query(self):
        recorder = QueryRecorder()
        recorder.record(
            "entity", "cypher", "  MATCH (n) RETURN n  ", {"limit": 5}, rows=3, elapsed_ms=7
        )

        reported = issued_queries(recorder, Settings(_env_file=None))

        assert len(reported) == 1
        assert reported[0].pass_name == "entity"
        assert reported[0].language == "cypher"
        # Trimmed, because the module constants are triple-quoted and would
        # otherwise arrive wrapped in the indentation of the file they live in.
        assert reported[0].text == "MATCH (n) RETURN n"
        assert reported[0].parameters == {"limit": 5}
        assert reported[0].rows == 3
        assert reported[0].elapsed_ms == 7

    def test_a_deployment_can_turn_it_off(self):
        # The query text names labels, relationship types and properties. A
        # deployment that treats its schema as non-public needs a way to decline.
        recorder = QueryRecorder()
        recorder.record("entity", "cypher", "MATCH (n) RETURN n")

        assert issued_queries(recorder, Settings(_env_file=None, expose_issued_queries=False)) == []

    def test_keeps_text_and_values_apart(self):
        # Not cosmetic. Folding the values into the text would report a string
        # that never ran, and would demonstrate query-building by concatenation
        # to the audience most likely to copy it.
        recorder = QueryRecorder()
        recorder.record(
            "entity", "cypher", "MATCH (n) WHERE n.id IN $ids RETURN n", {"ids": ["sup_1"]}
        )

        reported = issued_queries(recorder, Settings(_env_file=None))[0]

        assert "sup_1" not in reported.text
        assert reported.parameters["ids"] == ["sup_1"]


class TestTheRecorder:
    def test_copies_the_parameters_it_was_given(self):
        # The store passes the same dict it hands the driver. Keeping a
        # reference would let a later mutation rewrite history — and the
        # cypher store does reuse parameter dicts between passes.
        recorder = QueryRecorder()
        parameters = {"limit": 5}
        recorder.record("entity", "cypher", "MATCH (n) RETURN n", parameters)
        parameters["limit"] = 999

        assert recorder.queries[0].parameters == {"limit": 5}

    def test_hands_back_a_copy_of_its_list(self):
        recorder = QueryRecorder()
        recorder.record("entity", "cypher", "MATCH (n) RETURN n")
        recorder.queries.clear()

        assert len(recorder) == 1


class TestAgainstARealDatabase:
    """The claim only means something if a database is on the other end."""

    @pytest.mark.anyio
    async def test_records_every_pass_it_ran(self, cypher_store):
        recorder = QueryRecorder()
        await cypher_store.retrieve(a_request(), recorder)

        passes = [query.pass_name for query in recorder.queries]

        # Entity, vocabulary and expansion are the three the pipeline is built
        # on. Asserting the set rather than the order, because expansion only
        # runs when the direct passes anchored on something.
        assert "entity" in passes
        assert "vocabulary" in passes
        assert all(query.language == "cypher" for query in recorder.queries)

    @pytest.mark.anyio
    async def test_reports_what_each_pass_returned(self, cypher_store):
        recorder = QueryRecorder()
        candidates = await cypher_store.retrieve(a_request(), recorder)

        assert candidates
        # Row counts are per pass and pre-merge, so their sum is at least the
        # number of candidates that survived deduplication.
        assert sum(query.rows for query in recorder.queries) >= len(candidates)
        assert all(query.elapsed_ms >= 0 for query in recorder.queries)

    @pytest.mark.anyio
    async def test_the_recorded_query_runs_again_as_recorded(self, cypher_store):
        # The whole point of the item: what the trace shows must be replayable.
        # Text and parameters, exactly as recorded, handed back to the store.
        recorder = QueryRecorder()
        await cypher_store.retrieve(a_request(), recorder)

        entity = next(query for query in recorder.queries if query.pass_name == "entity")
        columns, rows = await cypher_store.run_readonly(entity.text, parameters=entity.parameters)

        assert "subject_id" in columns
        # Same query, same parameters, same database: the row count must match
        # what the pass reported. A mismatch means the trace is describing
        # something other than what ran.
        assert len(rows) == entity.rows

    @pytest.mark.anyio
    async def test_a_parameterised_query_without_its_parameters_fails(self, cypher_store):
        # The negative control for the parameter channel. If this passed, the
        # values would be coming from somewhere other than where we think.
        recorder = QueryRecorder()
        await cypher_store.retrieve(a_request(), recorder)
        entity = next(query for query in recorder.queries if query.pass_name == "entity")

        from neo4j.exceptions import ClientError

        with pytest.raises(ClientError) as refused:
            await cypher_store.run_readonly(entity.text)

        # Named rather than caught blind: the point is that the values came from
        # the parameter channel, and only ParameterMissing shows that. Any
        # exception would also be raised by a typo in the query text.
        assert "ParameterMissing" in str(refused.value)


class TestAQueryThatMatchesNothing:
    """Found by replaying a pass that legitimately returned no rows."""

    @pytest.mark.anyio
    async def test_reports_columns_rather_than_raising(self, cypher_store):
        # `keys()` is synchronous on this driver, and the empty-result path
        # awaited it. Every query anyone had run by hand returned rows, so the
        # one branch that names the columns from the result rather than from a
        # row had never executed.
        columns, rows = await cypher_store.run_readonly(
            "MATCH (n:NoSuchLabelAnywhere) RETURN n.id AS id, n.label AS label"
        )

        assert rows == []
        assert columns == ["id", "label"]


class TestTheReplayEndpoint:
    def test_bounds_how_many_parameters_it_will_bind(self, client):
        # Values are bound by the driver rather than spliced into the text, so
        # this is a size bound and not an injection one. Checked before the
        # backend is consulted: malformed input is rejected before any work.
        response = client.post(
            "/api/graph/query",
            json={"query": "MATCH (n) RETURN n", "parameters": {str(n): n for n in range(64)}},
        )

        assert response.status_code == 400
        assert "at most" in response.json()["detail"]

    def test_a_query_needs_no_parameters(self, client):
        # The ordinary console case: somebody typed a query. Omitting the field
        # must not become a way to fail.
        response = client.post("/api/graph/query", json={"query": "MATCH (n) RETURN n"})

        # The fixture backend has no query language, which is a different
        # refusal and the one this deployment should give.
        assert response.status_code == 400
        assert "no query language" in response.json()["detail"]
