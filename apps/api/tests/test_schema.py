"""The schema is asked of the store, and says when it does not know everything.

`ontology.py` declares the vocabulary this project defines, which is the right
source for an export and the wrong one for retrieval: a deployment points at
whatever graph it was given, and a service that assumes six supply-chain
classes describes someone else's data wrongly.
"""

import pytest

from app import ontology
from app.llm.context import render_context
from app.retrieval.fixture_store import FixtureGraphStore
from app.retrieval.models import Candidate
from app.retrieval.schema import (
    GraphSchema,
    SchemaEdge,
    render_schema_card,
    with_declared,
)


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


class TestDeclaredShapesFillTheGaps:
    """Introspection reports what is there; a vocabulary knows what can be.

    A graph with no risks recorded still has a risk relationship, and a traversal
    planned purely from counts cannot follow a path the data has not taken —
    which is exactly when a question returns nothing for a reason nobody can see.
    """

    OBSERVED = GraphSchema(
        edges=[
            edge("Supplier", "SHIPS", "Shipment", 40),
            edge("Shipment", "DELIVERED_TO", "Location", 30),
        ]
    )

    def test_adds_a_declared_shape_the_data_has_not_exhibited(self):
        # Supplier and Risk both exist below, so HAS_RISK is plannable even
        # though no such edge has been recorded.
        merged = with_declared(
            GraphSchema(edges=[*self.OBSERVED.edges, edge("Supplier", "SUPPLIES", "Risk", 5)]),
            (("Supplier", "HAS_RISK", "Risk"),),
        )

        assert ("Supplier", "HAS_RISK", "Risk") in [
            (item.domain, item.predicate, item.range) for item in merged.edges
        ]

    def test_will_not_invent_a_shape_for_classes_the_store_does_not_have(self):
        # The assumption item 66 removed: that a deployment's graph looks like
        # ours. Absent classes are evidence it does not.
        merged = with_declared(self.OBSERVED, (("Supplier", "HAS_RISK", "Risk"),))

        assert "Risk" not in merged.classes

    def test_declared_shapes_rank_behind_observed_ones(self):
        # A path the data has never taken is a fallback, not a recommendation.
        merged = with_declared(
            GraphSchema(edges=[*self.OBSERVED.edges, edge("Supplier", "SUPPLIES", "Risk", 5)]),
            (("Supplier", "HAS_RISK", "Risk"),),
        )
        added = next(item for item in merged.edges if item.predicate == "HAS_RISK")

        assert added.count == 0

    def test_does_not_duplicate_a_shape_already_observed(self):
        merged = with_declared(self.OBSERVED, (("Supplier", "SHIPS", "Shipment"),))

        assert len(merged.edges) == len(self.OBSERVED.edges)

    def test_leaves_an_empty_schema_empty(self):
        # Nothing to reason from, so nothing to add: a store that could not
        # describe itself should not be described for it.
        assert with_declared(GraphSchema(), (("Supplier", "HAS_RISK", "Risk"),)).is_empty()

    def test_the_projects_own_vocabulary_fills_its_own_graph(self):
        # End to end with the real declarations: every shape the vocabulary
        # names is plannable against a store that holds those classes.
        merged = with_declared(
            GraphSchema(
                edges=[
                    edge(domain, predicate, target, 1)
                    for domain, predicate, target in ontology.SHAPES[:1]
                ]
                + [edge(cls, "SEEN", cls, 1) for cls in ontology.CLASSES]
            ),
            ontology.SHAPES,
        )
        planned = {(item.domain, item.predicate, item.range) for item in merged.edges}

        assert set(ontology.SHAPES) <= planned
