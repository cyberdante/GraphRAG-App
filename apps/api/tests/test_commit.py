"""Writing accepted proposals into the graph.

The only write path in the service. Two properties carry the weight, and both
are about what it refuses rather than what it does.

**Identifiers cannot come from a document.** Cypher has no parameter slot for a
label or a relationship type, so those are interpolated — and they are therefore
taken only from the declared vocabulary and checked against a strict pattern
first. A proposal naming a class the graph does not model, or carrying Cypher in
its predicate, must not reach the query text.

**Ambiguity is a question, not a decision.** A label matching two existing nodes
is the moment a silent choice becomes a wrong graph that still cites a source.
"""

import pytest

from app.domains import SUPPLY_CHAIN
from app.extraction.commit import SAFE_IDENTIFIER, plan
from app.extraction.models import Proposal, ProposalStatus


def accepted(subject="ITAMCO", predicate="SUPPLIES", obj="Component A", **overrides) -> Proposal:
    fields = dict(
        subject=subject,
        predicate=predicate,
        object=obj,
        quote=f"{subject} {predicate.lower()} {obj}.",
        source="notes.md",
        status=ProposalStatus.ACCEPTED,
    )
    fields.update(overrides)
    return Proposal(**fields)


class TestWhatIsPlanned:
    def test_types_come_from_the_vocabulary_not_the_extractor(self):
        # A pattern matcher knows the relationship and not the classes. The
        # vocabulary declares that SUPPLIES runs Supplier to Product, which is
        # what `shapes` has been for since item 68 — and it means a document
        # cannot introduce a class the graph does not model.
        planned = plan([accepted()], SUPPLY_CHAIN).planned[0]

        assert planned.subject_type == "Supplier"
        assert planned.object_type == "Product"

    def test_only_accepted_proposals_are_written(self):
        for status in (ProposalStatus.PROPOSED, ProposalStatus.REJECTED):
            result = plan([accepted(status=status)], SUPPLY_CHAIN)

            assert result.planned == []
            assert "Not accepted" in result.refused[0].reason

    def test_an_undeclared_relationship_is_refused(self):
        result = plan([accepted(predicate="ENDORSES")], SUPPLY_CHAIN)

        assert result.planned == []
        assert "not a relationship this vocabulary declares" in result.refused[0].reason

    def test_a_relationship_with_no_declared_shape_is_refused_rather_than_written_untyped(self):
        # An untyped node is invisible to every pass that filters on class, so
        # it would be a statement that is present and unfindable — worse than a
        # refusal, because nothing reports it.
        result = plan([accepted(predicate="relatedTo")], SUPPLY_CHAIN)

        assert result.planned == []
        assert "cannot be typed" in result.refused[0].reason

    def test_a_type_the_vocabulary_does_not_declare_is_refused(self):
        # The proposal may carry its own types; they are still checked.
        result = plan([accepted(subject_type="Wormhole")], SUPPLY_CHAIN)

        assert result.planned == []
        assert "Undeclared class" in result.refused[0].reason

    def test_the_rest_of_a_batch_still_lands(self):
        # A refusal is an outcome, not an error. One bad proposal must not cost
        # the nine good ones beside it.
        result = plan([accepted(predicate="ENDORSES"), accepted()], SUPPLY_CHAIN)

        assert len(result.planned) == 1
        assert len(result.refused) == 1


class TestNothingFromADocumentReachesTheQuery:
    """The injection shape, blocked twice over."""

    @pytest.mark.parametrize(
        "predicate",
        [
            "SUPPLIES]->(x) DETACH DELETE x //",
            "SUPPLIES` OR 1=1 //",
            "MATCH (n) DETACH DELETE n",
            "Supplier {id: 'x'})-[:OWNS",
        ],
    )
    def test_a_predicate_carrying_cypher_is_refused(self, predicate):
        # Refused as undeclared, before the identifier check is even reached —
        # the vocabulary is the first gate and the pattern is the second.
        result = plan([accepted(predicate=predicate)], SUPPLY_CHAIN)

        assert result.planned == []

    @pytest.mark.parametrize(
        "node_type",
        ["Supplier) DETACH DELETE (n", "Supplier`", "Sup plier", "Supplier;DROP"],
    )
    def test_a_type_carrying_cypher_is_refused(self, node_type):
        result = plan([accepted(subject_type=node_type)], SUPPLY_CHAIN)

        assert result.planned == []

    def test_the_identifier_pattern_rejects_what_the_vocabulary_check_would_miss(self):
        # The second gate on its own, because it is the one that has to still
        # work if a domain is ever declared carelessly.
        for hostile in ("a b", "a-b", "a`b", "a)b", "1abc", "", "a;b"):
            assert not SAFE_IDENTIFIER.match(hostile)

        for legitimate in ("Supplier", "HAS_RISK", "relatedTo", "_private"):
            assert SAFE_IDENTIFIER.match(legitimate)

    def test_a_label_may_contain_anything_because_it_is_bound(self):
        # The distinction that makes this safe rather than paranoid: the *label*
        # is data and goes through the driver's parameter slot, so a company
        # legitimately called "O'Brien & Sons (Ltd.)" commits fine.
        planned = plan([accepted(subject="O'Brien & Sons (Ltd.)")], SUPPLY_CHAIN).planned

        assert planned[0].subject == "O'Brien & Sons (Ltd.)"


class TestAgainstARealDatabase:
    """A write path is not verified by unit tests."""

    async def cleanup(self, store, labels):
        async with store._driver.session(database="neo4j") as session:
            await session.run(
                "MATCH (n) WHERE n.label IN $labels DETACH DELETE n", {"labels": labels}
            )

    @pytest.mark.anyio
    async def test_matches_an_existing_node_and_creates_a_missing_one(self, cypher_store):
        # ITAMCO is in the seeded graph; this product is not.
        product = "Test Widget For Commit"
        try:
            planned = plan([accepted(obj=product)], SUPPLY_CHAIN).planned
            written, refused = await cypher_store.commit(planned)

            assert refused == []
            assert written[0]["subject_id"] == "sup_88"
            # Exactly one node came into existence: the product.
            assert len(written[0]["created_nodes"]) == 1
        finally:
            await self.cleanup(cypher_store, [product])

    @pytest.mark.anyio
    async def test_committing_twice_writes_one_statement(self, cypher_store):
        # Pressing the button again is the ordinary case, not an error.
        product = "Test Widget Idempotent"
        try:
            planned = plan([accepted(obj=product)], SUPPLY_CHAIN).planned
            await cypher_store.commit(planned)
            await cypher_store.commit(planned)

            async with cypher_store._driver.session(database="neo4j") as session:
                result = await session.run(
                    "MATCH ()-[r:SUPPLIES]->(p:Product {label: $label}) RETURN count(r) AS n",
                    {"label": product},
                )
                record = await result.single()

            assert record["n"] == 1
        finally:
            await self.cleanup(cypher_store, [product])

    @pytest.mark.anyio
    async def test_carries_the_provenance_onto_the_statement(self, cypher_store):
        # A fact in the graph has to be able to say which document said so.
        product = "Test Widget Provenance"
        try:
            planned = plan([accepted(obj=product)], SUPPLY_CHAIN, extractor="reference").planned
            await cypher_store.commit(planned)

            async with cypher_store._driver.session(database="neo4j") as session:
                result = await session.run(
                    "MATCH ()-[r:SUPPLIES]->(p:Product {label: $label}) "
                    "RETURN r.source AS source, r.extractor AS extractor",
                    {"label": product},
                )
                record = await result.single()

            assert record["source"] == "notes.md"
            assert record["extractor"] == "reference"
        finally:
            await self.cleanup(cypher_store, [product])

    @pytest.mark.anyio
    async def test_an_ambiguous_label_is_refused_rather_than_guessed(self, cypher_store):
        # Two suppliers with the same name. Choosing one silently is how a
        # document's "Acme Ltd" becomes somebody else's "ACME Limited".
        twin = "Test Ambiguous Supplier"
        try:
            async with cypher_store._driver.session(database="neo4j") as session:
                await session.run(
                    "CREATE (:Supplier {id: 'test_twin_a', label: $label}), "
                    "(:Supplier {id: 'test_twin_b', label: $label})",
                    {"label": twin},
                )

            planned = plan([accepted(subject=twin)], SUPPLY_CHAIN).planned
            written, refused = await cypher_store.commit(planned)

            assert written == []
            assert "matches more than one" in refused[0]["reason"]
        finally:
            await self.cleanup(cypher_store, [twin])

    @pytest.mark.anyio
    async def test_writes_nothing_when_everything_is_refused(self, cypher_store):
        # The negative control for the whole path: a batch of refusals must
        # leave the graph exactly as it was.
        async with cypher_store._driver.session(database="neo4j") as session:
            before = (await (await session.run("MATCH (n) RETURN count(n) AS n")).single())["n"]

        planned = plan([accepted(predicate="ENDORSES")], SUPPLY_CHAIN).planned
        await cypher_store.commit(planned)

        async with cypher_store._driver.session(database="neo4j") as session:
            after = (await (await session.run("MATCH (n) RETURN count(n) AS n")).single())["n"]

        assert before == after


class TestTheCommitEndpoint:
    def test_takes_proposal_ids_and_not_a_query(self, client):
        # The shape is the point. There is no field here that accepts Cypher,
        # so the read-only guarantees the console rests on are not handed back
        # through a second door.
        response = client.post(
            "/api/extraction/commit", json={"query": "MATCH (n) DETACH DELETE n"}
        )

        assert response.status_code == 422

    def test_a_backend_that_cannot_be_written_to_says_so(self, client):
        # The fixture store serves a bundled graph. Better said than discovered
        # by pressing commit and watching nothing happen.
        response = client.post("/api/extraction/commit", json={"proposal_ids": ["anything"]})

        assert response.status_code == 400
        assert "cannot be written to" in response.json()["detail"]

    def test_an_unknown_backend_is_refused(self, client):
        response = client.post(
            "/api/extraction/commit",
            json={"proposal_ids": [], "backend": "not-a-backend"},
        )

        assert response.status_code == 400
        assert "Unknown retrieval backend" in response.json()["detail"]
