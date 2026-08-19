"""The vocabulary and the data have to agree.

The bug these guard: the old context declared `hasRisk`, `ships` and
`suppliesTo` while the graph emitted `HAS_RISK`, `SHIPS` and `SUPPLIES`. Nothing
matched, so every predicate fell through to `@vocab: https://schema.org/` and
resolved to an IRI that does not exist. The document was valid JSON, valid
JSON-LD, and asserted nothing true.

Checking agreement in both directions is what makes that unrepeatable: a new
relationship cannot go undeclared, and a declared term cannot quietly rot.
"""

import re

from app import fixtures, ontology
from app.domains import SUPPLY_CHAIN
from app.fixtures import SUPPLY_CHAIN_GRAPH
from app.models import GraphData, GraphEdge, GraphNode
from app.ontology import classes_of, graph_to_jsonld, jsonld_context, properties_of

# The default domain's vocabulary, resolved once so the assertions below read as
# they did when it was the only one there could be.
CLASSES = classes_of(SUPPLY_CHAIN)
PROPERTIES = properties_of(SUPPLY_CHAIN)
VOCAB = SUPPLY_CHAIN.vocab


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
        assert jsonld_context(SUPPLY_CHAIN)["@vocab"] == VOCAB

    def test_properties_are_declared_as_iri_references(self) -> None:
        context = jsonld_context(SUPPLY_CHAIN)
        assert context["HAS_RISK"] == {"@id": f"{VOCAB}hasRisk", "@type": "@id"}

    def test_borrowed_terms_come_from_a_real_vocabulary(self) -> None:
        assert jsonld_context(SUPPLY_CHAIN)["name"] == "schema:name"


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

        attributes = set(ontology.attributes_of(SUPPLY_CHAIN))

        for entity in doc["@graph"]:
            for term, value in entity.items():
                # Attribute values are literals — "Customs Hold" is a string to
                # read, not an id to resolve. Only the relationship terms point
                # at nodes, and mixing the two is what the context declares
                # differently for each.
                if term in {"@id", "@type", "name"} or term in attributes:
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


class TestTheDeclaredShape:
    """`domain` and `range`, held to the data in both directions.

    The mapping of terms to IRIs says a predicate exists. It does not say what
    it joins, which is the part retrieval needs: item 68 infers it by counting
    what the fixture graph happens to contain, and counting cannot describe a
    path the data has not taken — a graph with no risks recorded still has a
    risk relationship.

    Declaring it only helps if the declaration is true, so these compare it with
    the graph rather than trusting it.
    """

    def observed(self) -> set[tuple[str, str, str]]:
        graph = fixtures.SUPPLY_CHAIN_GRAPH
        nodes = {node.id: node for node in graph.nodes}
        return {
            (nodes[link.source].type, link.type, nodes[link.target].type)
            for link in graph.links
            if link.source in nodes and link.target in nodes
        }

    def test_every_declared_shape_appears_in_the_data(self):
        # A declaration the data contradicts is worse than no declaration: it
        # would send retrieval down a path that returns nothing.
        undeclared = set(SUPPLY_CHAIN.shapes) - self.observed()

        assert undeclared == set(), f"declared but never seen: {sorted(undeclared)}"

    def test_every_shape_in_the_data_is_declared(self):
        # The other direction, and the one the original defect lived in: a
        # relationship the vocabulary does not describe is one no consumer can
        # resolve and no traversal can plan around.
        missing = self.observed() - set(SUPPLY_CHAIN.shapes)

        assert missing == set(), f"in the data but undeclared: {sorted(missing)}"

    def test_every_shape_uses_declared_classes_and_properties(self):
        for domain, predicate, target in SUPPLY_CHAIN.shapes:
            assert domain in CLASSES, f"{domain} is not a declared class"
            assert target in CLASSES, f"{target} is not a declared class"
            assert predicate in PROPERTIES, f"{predicate} is not a declared property"

    def test_domain_and_range_are_reported_for_a_declared_predicate(self):
        assert ontology.domain_of("HAS_RISK", SUPPLY_CHAIN) == "Supplier"
        assert ontology.range_of("HAS_RISK", SUPPLY_CHAIN) == "Risk"

    def test_an_undeclared_predicate_reports_neither(self):
        # `relatedTo` is the fallback for a relationship we have not named, so
        # it deliberately has no shape.
        assert ontology.domain_of("relatedTo", SUPPLY_CHAIN) is None
        assert ontology.range_of("relatedTo", SUPPLY_CHAIN) is None


class TestTheTurtleDocument:
    def test_declares_every_class(self):
        turtle = ontology.to_turtle(SUPPLY_CHAIN)

        for term in CLASSES:
            assert f"sc:{term} a owl:Class" in turtle

    def test_declares_every_property_with_its_shape(self):
        turtle = ontology.to_turtle(SUPPLY_CHAIN)

        for domain, predicate, target in SUPPLY_CHAIN.shapes:
            local = PROPERTIES[predicate].rsplit("#", 1)[-1]
            assert f"sc:{local} a owl:ObjectProperty" in turtle
            assert f"rdfs:domain sc:{domain}" in turtle
            assert f"rdfs:range sc:{target}" in turtle

    def test_mentions_no_term_it_has_not_declared(self):
        # The generated document is the artifact consumers read; a term in it
        # that the vocabulary does not define is the original bug in a new place.
        turtle = ontology.to_turtle(SUPPLY_CHAIN)
        referenced = set(re.findall(r"\bsc:(\w+)\b", turtle))
        known = (
            set(CLASSES)
            | {iri.rsplit("#", 1)[-1] for iri in PROPERTIES.values()}
            | set(ontology.attributes_of(SUPPLY_CHAIN))
        )

        assert referenced - known == set()

    def test_carries_its_own_version(self):
        assert f'owl:versionInfo "{SUPPLY_CHAIN.version}"' in ontology.to_turtle(SUPPLY_CHAIN)

    def test_is_generated_rather_than_maintained(self):
        # Two files describing one vocabulary is how the original defect
        # happened. The document says so, to whoever opens it next.
        assert "Do not edit by hand" in ontology.to_turtle(SUPPLY_CHAIN)


class TestExportsNameTheVocabulary:
    def test_a_graph_export_points_at_the_served_document(self):
        document = ontology.graph_to_jsonld(fixtures.SUPPLY_CHAIN_GRAPH)

        assert document["isDefinedBy"] == SUPPLY_CHAIN.ontology_path
        assert document["version"] == SUPPLY_CHAIN.version

    def test_the_document_is_served(self, client):
        response = client.get(SUPPLY_CHAIN.ontology_path)

        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/turtle")
        assert "owl:Ontology" in response.text

    def test_what_is_served_is_what_is_declared(self):
        # No drift possible: one generator, one document.
        from fastapi.testclient import TestClient

        from app.main import app

        with TestClient(app) as client:
            assert client.get(SUPPLY_CHAIN.ontology_path).text == ontology.to_turtle(SUPPLY_CHAIN)


class TestAttributesAreDeclaredLikeEverythingElse:
    """State on a node, held to the vocabulary in both directions.

    The attribute pass searches node properties, so a property the vocabulary
    has not declared is a shape in the data that the document claiming to
    describe the data does not mention — the original defect wearing different
    clothes. Checking both ways is what makes it unrepeatable: a new attribute
    cannot go undeclared, and a declared one cannot quietly rot.
    """

    def observed(self) -> set[tuple[str, str]]:
        """(class, property) pairs the sample graph actually carries."""
        return {
            (node.type, name)
            for node in fixtures.SUPPLY_CHAIN_GRAPH.nodes
            for name in (node.properties or {})
        }

    def declared(self) -> set[tuple[str, str]]:
        return {(start, name) for start, name, _ in SUPPLY_CHAIN.attributes}

    def test_every_attribute_in_the_data_is_declared(self):
        undeclared = self.observed() - self.declared()

        assert undeclared == set(), f"in the data but undeclared: {sorted(undeclared)}"

    def test_every_declared_attribute_appears_in_the_data(self):
        # The other direction. A declaration nothing carries is a promise the
        # graph does not keep, and retrieval would plan around it.
        missing = self.declared() - self.observed()

        assert missing == set(), f"declared but never seen: {sorted(missing)}"

    def test_the_generated_graph_declares_its_attributes_too(self):
        # The generator is the other source of data, and it is the one that
        # fills a real store. A property it emits and the vocabulary omits would
        # be invisible here and present in every seeded deployment.
        from app import generator

        emitted = {
            (node.type, name)
            for node in generator.generate(6, seed=3).nodes
            for name in node.attributes
        }

        assert emitted - self.declared() == set(), f"generated but undeclared: {emitted}"

    def test_every_attribute_hangs_off_a_declared_class(self):
        for start, name, _ in SUPPLY_CHAIN.attributes:
            assert start in SUPPLY_CHAIN.classes, f"{name} is declared on unknown class {start}"

    def test_an_undeclared_property_never_reaches_the_export(self):
        # The negative control. A node carrying something the vocabulary does
        # not define must not put an undefined term into the document.
        graph = SUPPLY_CHAIN_GRAPH.model_copy(deep=True)
        graph.nodes[0].properties = {"nonsenseField": "value"}

        document = graph_to_jsonld(graph)
        entity = next(e for e in document["@graph"] if e["@id"] == graph.nodes[0].id)

        assert "nonsenseField" not in entity

    def test_an_attribute_is_a_literal_and_a_relationship_is_a_reference(self):
        # The distinction the context exists to make: "Customs Hold" is a string
        # to read, "warehouse_1" is an id to resolve. Declaring both the same way
        # would tell a consumer to dereference a status.
        context = ontology.jsonld_context(SUPPLY_CHAIN)

        assert context["status"] == f"{SUPPLY_CHAIN.vocab}status"
        assert context["DELIVERED_TO"]["@type"] == "@id"
