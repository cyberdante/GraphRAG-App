"""Knowing the shape of the graph is what tells retrieval where to walk.

Expansion without a plan follows every edge from an anchor and spends its
budget on whichever the database returns first. On a skewed graph that means a
question about risk expands a hub supplier into its shipments, because there
are far more of them — the budget is consumed by the commonest relationship
rather than the relevant one.
"""

import pytest

from app.retrieval import passes
from app.retrieval.fixture_store import FixtureGraphStore
from app.retrieval.models import RetrievalRequest
from app.retrieval.schema import GraphSchema, SchemaEdge


def edge(domain: str, predicate: str, range_: str, count: int) -> SchemaEdge:
    return SchemaEdge(domain=domain, predicate=predicate, range=range_, count=count)


#: Deliberately skewed: shipments outnumber risks, so an unguided expansion
#: from a supplier reaches shipments first.
SCHEMA = GraphSchema(
    edges=[
        edge("Supplier", "SHIPS", "Shipment", 900),
        edge("Shipment", "DELIVERED_TO", "Location", 800),
        edge("Supplier", "SUPPLIES", "Product", 400),
        edge("Supplier", "HAS_RISK", "Risk", 40),
        edge("Risk", "INDICATED_BY", "RiskSignal", 20),
    ]
)


class TestWhichClassesTheQuestionIsAbout:
    def test_matches_a_stemmed_question_to_a_class_name(self):
        # "suppliers" stems to "supplier" and has to reach `Supplier`.
        assert "Supplier" in passes.anchor_classes(SCHEMA, ["supplier"])

    def test_a_term_reaches_every_class_it_names_part_of(self):
        # "risk" anchors on RiskSignal as well as Risk. That is the substring
        # matching doing its job rather than overreaching: it is the same rule
        # that lets "risk" reach `HAS_RISK`, and a question about risk
        # plausibly wants risk signals too.
        assert passes.anchor_classes(SCHEMA, ["risk"]) == {"Risk", "RiskSignal"}

    def test_names_nothing_when_the_question_is_about_nothing_here(self):
        assert passes.anchor_classes(SCHEMA, ["clinical", "trial"]) == set()


class TestWhatToExpandAlong:
    def test_puts_a_named_relationship_first(self):
        # The question says "risk"; HAS_RISK is 22x rarer than SHIPS and must
        # still lead, or frequency decides the answer.
        plan = passes.relevant_predicates(SCHEMA, ["risk"])

        assert plan[0] == "HAS_RISK"

    def test_is_a_preference_order_not_a_filter(self):
        """Unlisted relationships rank last; they are not excluded.

        Both consumers read a missing predicate as `len(plan)`, so it sorts
        behind everything named and still gets expanded if budget remains.
        Filtering here instead would make the schema able to *hide* evidence,
        which is a much worse failure than ordering it badly.
        """
        plan = passes.relevant_predicates(SCHEMA, ["risk"])
        rank = {predicate: index for index, predicate in enumerate(plan)}

        assert plan == ["HAS_RISK", "INDICATED_BY"]
        assert rank.get("DELIVERED_TO", len(plan)) == len(plan)

    def test_ranks_what_the_question_names_ahead_of_what_it_does_not(self):
        plan = passes.relevant_predicates(SCHEMA, ["risk"])

        # SHIPS is 22x commoner than HAS_RISK. Frequency must not decide a
        # question that named the rarer relationship.
        assert plan[0] == "HAS_RISK"
        assert "SHIPS" not in plan

    def test_frequency_breaks_ties_within_a_tier(self):
        # Among relationships the question points at equally, the graph's
        # backbone should come before its long tail.
        plan = passes.relevant_predicates(SCHEMA, ["supplier"])

        assert plan.index("SHIPS") < plan.index("HAS_RISK")

    def test_falls_back_to_every_relationship_when_nothing_matches(self):
        # An unguided expansion beats no expansion. Returning nothing would
        # silently disable the pass for any question phrased in words this
        # graph does not use.
        plan = passes.relevant_predicates(SCHEMA, ["clinical"])

        assert set(plan) == set(SCHEMA.predicates)

    def test_plans_nothing_when_there_is_no_schema(self):
        assert passes.relevant_predicates(GraphSchema(), ["risk"]) == []

    def test_lists_each_relationship_once(self):
        plan = passes.relevant_predicates(SCHEMA, ["supplier"])

        assert len(plan) == len(set(plan))


class TestWhenToKeepWalking:
    def test_names_the_classes_a_second_hop_would_reach(self):
        # The hub case: a receiver number is an attribute of the receipt, not
        # of the order, so one hop cannot reach it however high the limit goes.
        assert passes.second_hop_classes(SCHEMA, ["supplier"]) == {
            "Shipment",
            "Product",
            "Risk",
        }

    def test_follows_relationships_backwards_too(self):
        # The hub shape that makes a second hop necessary usually needs a
        # direction reversal at the hub. Following only outgoing edges never
        # arrives.
        assert "Supplier" in passes.second_hop_classes(SCHEMA, ["risk"])

    def test_suggests_nothing_when_the_question_anchors_nowhere(self):
        assert passes.second_hop_classes(SCHEMA, ["clinical"]) == set()

    def test_does_not_suggest_walking_back_to_where_it_started(self):
        assert "Risk" not in passes.second_hop_classes(SCHEMA, ["risk"])


class TestItChangesWhatComesBack:
    """The plan has to alter retrieval, or it is decoration."""

    @pytest.mark.anyio
    async def test_a_tight_expansion_budget_spends_itself_on_the_question(self):
        store = FixtureGraphStore()

        # Small enough that the expansion pass must choose, which is the only
        # condition under which ordering can be observed at all.
        got = await store.retrieve(
            RetrievalRequest(query="risk", max_candidates=8, keywords=["risk"])
        )

        assert got
        assert any("Risk" in {c.subject_type, c.object_type} for c in got)

    @pytest.mark.anyio
    async def test_the_plan_is_derived_from_the_store_not_from_a_constant(self):
        # The schema comes from the graph the store actually serves, so a
        # deployment pointed at different data gets a different plan.
        schema = await FixtureGraphStore().schema()
        plan = passes.relevant_predicates(schema, ["risk"])

        assert plan
        assert set(plan) <= set(schema.predicates)
