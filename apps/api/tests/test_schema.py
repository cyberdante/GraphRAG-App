"""The schema is asked of the store, and says when it does not know everything.

`ontology.py` declares the vocabulary this project defines, which is the right
source for an export and the wrong one for retrieval: a deployment points at
whatever graph it was given, and a service that assumes six supply-chain
classes describes someone else's data wrongly.
"""

import pytest

from app.llm.context import render_context
from app.retrieval.fixture_store import FixtureGraphStore
from app.retrieval.models import Candidate
from app.retrieval.schema import GraphSchema, SchemaEdge, render_schema_card


def edge(domain: str, predicate: str, range_: str, count: int = 1) -> SchemaEdge:
    return SchemaEdge(domain=domain, predicate=predicate, range=range_, count=count)


SUPPLY_CHAIN = GraphSchema(
    edges=[
        edge("Supplier", "HAS_RISK", "Risk", 12),
        edge("Supplier", "SHIPS", "Shipment", 9),
        edge("Shipment", "DELIVERED_TO", "Location", 7),
        edge("Risk", "INDICATED_BY", "RiskSignal", 2),
    ]
)


class TestWhatTheSchemaKnows:
    def test_classes_come_from_both_ends_of_a_statement(self):
        # A class that only ever appears as an object still exists. Reading
        # subjects alone would hide every leaf type in the graph.
        assert SUPPLY_CHAIN.classes == [
            "Location",
            "Risk",
            "RiskSignal",
            "Shipment",
            "Supplier",
        ]

    def test_lists_where_you_can_go_from_a_class(self):
        moves = SUPPLY_CHAIN.edges_from("Supplier")

        assert [move.predicate for move in moves] == ["HAS_RISK", "SHIPS"]

    def test_neighbours_ignore_direction(self):
        # Reaching a receipt from a line item takes a direction reversal at the
        # hub. A traversal plan that only follows outgoing edges cannot get
        # there however high the hop limit goes.
        assert SUPPLY_CHAIN.neighbours("Risk") == {"Supplier", "RiskSignal"}

    def test_an_empty_schema_is_empty_rather_than_wrong(self):
        assert GraphSchema().is_empty()
        assert GraphSchema().classes == []


class TestTheSchemaCard:
    def test_describes_each_shape_readably(self):
        card = render_schema_card(SUPPLY_CHAIN)

        assert "Supplier -HAS_RISK-> Risk" in card

    def test_keeps_the_backbone_when_it_has_to_shorten(self):
        # Ordered by frequency upstream, so a truncated card drops the tail
        # rather than something load-bearing.
        card = render_schema_card(SUPPLY_CHAIN, limit=2)

        assert "Supplier -HAS_RISK-> Risk" in card
        assert "Risk -INDICATED_BY-> RiskSignal" not in card

    def test_says_when_it_shortened(self):
        # A silently shortened schema teaches the model that the missing
        # relationships do not exist, which is worse than no schema at all.
        card = render_schema_card(SUPPLY_CHAIN, limit=2)

        assert "2 further relationship types" in card

    def test_says_when_the_store_itself_was_truncated(self):
        card = render_schema_card(GraphSchema(edges=SUPPLY_CHAIN.edges, truncated=True))

        assert "more relationship types than were read" in card

    def test_an_empty_schema_renders_nothing_rather_than_a_heading(self):
        assert render_schema_card(GraphSchema()) == ""


class TestTheSchemaReachesTheModel:
    FACTS = [Candidate(kind="statement", text="ITAMCO affected by Delivery Delay")]

    def test_the_card_sits_above_the_facts(self):
        context = render_context(self.FACTS, SUPPLY_CHAIN)

        assert context.index("Supplier -HAS_RISK-> Risk") < context.index("ITAMCO")

    def test_the_facts_stay_numbered_and_citable(self):
        context = render_context(self.FACTS, SUPPLY_CHAIN)

        assert "[1] ITAMCO affected by Delivery Delay" in context

    def test_the_schema_is_labelled_as_not_being_evidence(self):
        # The model is told to answer only from numbered facts. An unlabelled
        # schema invites it to cite the schema, or to answer from what the
        # graph could say rather than what it does.
        context = render_context(self.FACTS, SUPPLY_CHAIN)

        assert "Facts retrieved for this question:" in context

    def test_no_schema_leaves_the_context_exactly_as_it_was(self):
        # The card is an addition, not a rewrite: a store that cannot describe
        # itself must not change what the model is told about the evidence.
        assert render_context(self.FACTS, None) == render_context(self.FACTS)
        assert render_context(self.FACTS, GraphSchema()) == render_context(self.FACTS)


class TestTheFixtureStoreDescribesItself:
    @pytest.mark.anyio
    async def test_reports_the_shapes_its_own_graph_takes(self):
        schema = await FixtureGraphStore().schema()

        assert "Supplier" in schema.classes
        assert "HAS_RISK" in schema.predicates
        assert not schema.truncated

    @pytest.mark.anyio
    async def test_orders_shapes_by_how_common_they_are(self):
        schema = await FixtureGraphStore().schema()
        counts = [edge.count for edge in schema.edges]

        assert counts == sorted(counts, reverse=True)

    @pytest.mark.anyio
    async def test_describes_only_shapes_that_are_really_there(self):
        # Introspected, not declared. A shape in the vocabulary but absent from
        # the data would tell the model to ask for something that returns
        # nothing.
        schema = await FixtureGraphStore().schema()

        assert all(edge.count > 0 for edge in schema.edges)
