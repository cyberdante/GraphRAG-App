"""The vocabulary and the data have to agree.

The bug these guard: the old context declared `hasRisk`, `ships` and
`suppliesTo` while the graph emitted `HAS_RISK`, `SHIPS` and `SUPPLIES`. Nothing
matched, so every predicate fell through to `@vocab: https://schema.org/` and
resolved to an IRI that does not exist. The document was valid JSON, valid
JSON-LD, and asserted nothing true.

Checking agreement in both directions is what makes that unrepeatable: a new
relationship cannot go undeclared, and a declared term cannot quietly rot.
"""

from app.fixtures import SUPPLY_CHAIN_GRAPH
from app.models import GraphData, GraphEdge, GraphNode
from app.ontology import CLASSES, PROPERTIES, VOCAB, graph_to_jsonld, jsonld_context


class TestVocabularyCoversTheData:
    def test_every_emitted_node_type_is_a_declared_class(self) -> None:
        emitted = {node.type for node in SUPPLY_CHAIN_GRAPH.nodes}
        assert emitted <= set(CLASSES), f"undeclared node types: {emitted - set(CLASSES)}"

    def test_every_emitted_edge_type_is_a_declared_property(self) -> None:
        emitted = {link.type for link in SUPPLY_CHAIN_GRAPH.links}
        assert emitted <= set(PROPERTIES), f"undeclared edge types: {emitted - set(PROPERTIES)}"

    def test_no_declared_class_is_unused(self) -> None:
        emitted = {node.type for node in SUPPLY_CHAIN_GRAPH.nodes}
        assert set(CLASSES) <= emitted, f"declared but never used: {set(CLASSES) - emitted}"

    def test_no_declared_property_is_unused(self) -> None:
        emitted = {link.type for link in SUPPLY_CHAIN_GRAPH.links}
        # relatedTo is the deliberate fallback for an unmodelled relationship.
        declared = set(PROPERTIES) - {"relatedTo"}
        assert declared <= emitted, f"declared but never used: {declared - emitted}"


class TestContext:
    def test_undeclared_terms_stay_in_our_namespace(self) -> None:
        # Pointing @vocab at schema.org was the root cause: it made every
        # unmatched term silently claim a schema.org IRI.
        assert jsonld_context()["@vocab"] == VOCAB

    def test_properties_are_declared_as_iri_references(self) -> None:
        context = jsonld_context()
        assert context["HAS_RISK"] == {"@id": f"{VOCAB}hasRisk", "@type": "@id"}

    def test_borrowed_terms_come_from_a_real_vocabulary(self) -> None:
        assert jsonld_context()["name"] == "schema:name"


class TestDocument:
    def test_every_node_becomes_one_entity(self) -> None:
        doc = graph_to_jsonld(SUPPLY_CHAIN_GRAPH)
        assert len(doc["@graph"]) == len(SUPPLY_CHAIN_GRAPH.nodes)

    def test_every_term_used_in_the_document_is_defined_by_the_context(self) -> None:
        doc = graph_to_jsonld(SUPPLY_CHAIN_GRAPH)
        context = doc["@context"]
        structural = {"@id", "@type"}

        for entity in doc["@graph"]:
            for term in entity:
                if term in structural:
                    continue
                assert term in context, f"term {term!r} used but not defined"
            assert entity["@type"] in context, f"class {entity['@type']!r} not defined"

    def test_relationships_point_at_node_ids(self) -> None:
        doc = graph_to_jsonld(SUPPLY_CHAIN_GRAPH)
        ids = {node.id for node in SUPPLY_CHAIN_GRAPH.nodes}

        for entity in doc["@graph"]:
            for term, value in entity.items():
                if term in {"@id", "@type", "name"}:
                    continue
                assert set(value) <= ids

    def test_outgoing_edges_land_on_their_subject(self) -> None:
        doc = graph_to_jsonld(SUPPLY_CHAIN_GRAPH)
        itamco = next(e for e in doc["@graph"] if e["@id"] == "sup_88")

        assert itamco["@type"] == "Supplier"
        assert itamco["name"] == "ITAMCO"
        assert itamco["HAS_RISK"] == ["risk_12"]
        assert sorted(itamco["SHIPS"]) == ["ship_01"]

    def test_an_unmodelled_relationship_falls_back_rather_than_inventing_a_term(self) -> None:
        graph = GraphData(
            nodes=[
                GraphNode(id="a", label="A", type="Supplier", group=1),
                GraphNode(id="b", label="B", type="Product", group=2),
            ],
            links=[GraphEdge(source="a", target="b", type="SOMETHING_NEW")],
        )
        entity = next(e for e in graph_to_jsonld(graph)["@graph"] if e["@id"] == "a")

        assert "SOMETHING_NEW" not in entity
        assert entity["relatedTo"] == ["b"]
