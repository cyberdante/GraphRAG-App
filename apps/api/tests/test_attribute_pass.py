"""Questions about state that lives on a node rather than on an edge.

"Which shipments are held at customs" names no entity, no class and no
relationship. It names a value sitting on a node, and the entity and vocabulary
passes cannot see one however large their budget — so before this pass the
question retrieved suppliers and shipments in general and nothing about customs
in particular.

Measured against the seeded graph rather than argued: asking which suppliers are
in Vietnam returned no evidence touching a Vietnamese supplier at all, and now
returns nine. The sample graph cannot show this — at fifteen nodes everything is
reachable from everything, which is the same reason volume was needed to expose
the original single-pass defect.
"""

import pytest

from app.retrieval.fixture_store import FixtureGraphStore
from app.retrieval.issued import QueryRecorder
from app.retrieval.models import RetrievalRequest
from app.retrieval.passes import plan
from app.retrieval.scoring import extract_keywords


def a_request(question: str, **overrides) -> RetrievalRequest:
    fields = {
        "query": question,
        "keywords": extract_keywords(question),
        "max_candidates": 60,
        "max_nodes": 60,
        "max_hops": 2,
        "entity_types": [],
        "entity_ids": [],
        "top_k": 10,
    }
    fields.update(overrides)
    return RetrievalRequest(**fields)


class TestTheBudget:
    def test_every_pass_can_spend_something(self):
        # A pass budgeted zero does not run, and a pass that does not run is
        # indistinguishable from one that found nothing — two very different
        # problems with two very different fixes.
        budgets = plan(60)

        assert budgets.entity > 0
        assert budgets.vocabulary > 0
        assert budgets.attribute > 0
        assert budgets.expansion > 0

    def test_attribute_takes_the_smallest_direct_share(self):
        # A property match is the narrowest of the three direct passes: a
        # question naming a status names one value, where a question naming a
        # class names a whole population.
        budgets = plan(200)

        assert budgets.attribute < budgets.entity
        assert budgets.attribute < budgets.vocabulary

    def test_does_not_starve_expansion_to_pay_for_it(self):
        # Expansion was already the pass a shared limit starved first. The new
        # share came out of the two direct passes, not out of it.
        assert plan(200).expansion == 40

    def test_the_shares_still_spend_the_whole_budget(self):
        assert plan(200).total == 200


class TestTheFixtureStore:
    @pytest.mark.anyio
    async def test_finds_a_statement_by_a_property_on_its_endpoint(self):
        # Shipment #2401 carries status "Customs Hold". Nothing in the graph
        # says "customs" anywhere else.
        candidates = await FixtureGraphStore().retrieve(
            a_request("which shipments are held at customs?")
        )

        assert any("#2401" in candidate.text for candidate in candidates)

    @pytest.mark.anyio
    async def test_a_property_nothing_carries_finds_nothing_by_that_route(self):
        # The negative control for the matcher: a value no node holds must not
        # match, or the pass is matching something other than the property.
        store = FixtureGraphStore()
        candidates = await store.retrieve(a_request("which shipments are in Antarctica?"))

        assert not any("Antarctica" in candidate.text for candidate in candidates)

    @pytest.mark.anyio
    async def test_does_not_spend_its_budget_re_finding_entity_hits(self):
        # id and label are excluded from the scan. Including label would make
        # this pass a second entity pass wearing a different name, and the
        # budget would buy nothing.
        store = FixtureGraphStore()
        by_name = await store.retrieve(a_request("ITAMCO"))

        assert by_name


class TestAgainstARealDatabase:
    """The sample graph is too small to show the difference; this is not."""

    @pytest.mark.anyio
    async def test_the_pass_runs_and_reports_itself(self, cypher_store):
        recorder = QueryRecorder()
        await cypher_store.retrieve(a_request("which suppliers are in Vietnam?"), recorder)

        assert "attribute" in [query.pass_name for query in recorder.queries]

    @pytest.mark.anyio
    async def test_answers_a_question_the_other_passes_cannot(self, cypher_store):
        # No node is *labelled* Vietnam, so the entity pass returns nothing and
        # the vocabulary pass returns suppliers in general. Only a property scan
        # reaches the suppliers actually in Vietnam.
        async with cypher_store._driver.session(database="neo4j") as session:
            result = await session.run(
                "MATCH (n) WHERE n.country = $country RETURN n.id AS id", {"country": "Vietnam"}
            )
            in_vietnam = {record["id"] async for record in result}
        assert in_vietnam, "seed the graph first: scripts/seed_neo4j.py --scale 500"

        candidates = await cypher_store.retrieve(a_request("which suppliers are in Vietnam?"))
        touching = [c for c in candidates if c.subject in in_vietnam or c.object in in_vietnam]

        assert touching, "a question about a property returned no evidence carrying it"
