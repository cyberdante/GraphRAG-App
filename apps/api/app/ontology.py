"""The supply-chain vocabulary, and the JSON-LD context built from it.

Why this file exists: the exported JSON-LD previously declared terms in
lowerCamelCase (`hasRisk`, `ships`, `suppliesTo`) while the graph emitted
SCREAMING_SNAKE edge types (`HAS_RISK`, `SHIPS`, `SUPPLIES`). None of the
emitted predicates matched a declared term, so all of them fell through to
`@vocab: https://schema.org/` and resolved to IRIs like
`https://schema.org/HAS_RISK`, which does not exist. The document parsed as RDF
and asserted nothing.

The fix is a declared vocabulary that the data is checked against. Edge and node
types are the *terms*; this module maps each to a real IRI. `tests/test_ontology.py`
asserts the mapping and the fixture graph agree in both directions, so neither a
new relationship nor a renamed one can silently go undeclared again.
"""

from typing import Any

from .models import GraphData

#: Namespace for classes and properties this project defines itself.
VOCAB = "https://graphrag.dev/ontology/supply-chain#"

SCHEMA = "https://schema.org/"

#: Node `type` values, mapped to the class IRI each denotes.
CLASSES: dict[str, str] = {
    "Supplier": f"{VOCAB}Supplier",
    "Shipment": f"{VOCAB}Shipment",
    "Product": f"{VOCAB}Product",
    "Location": f"{VOCAB}Location",
    "Risk": f"{VOCAB}Risk",
    "RiskSignal": f"{VOCAB}RiskSignal",
}

#: Edge `type` values, mapped to the property IRI each denotes. The keys are
#: SCREAMING_SNAKE because that is what the graph stores; the IRIs are
#: lowerCamelCase because that is the convention for RDF properties. Aliasing
#: one to the other is exactly what a JSON-LD context is for.
PROPERTIES: dict[str, str] = {
    "HAS_RISK": f"{VOCAB}hasRisk",
    "HAS_SIGNAL": f"{VOCAB}hasSignal",
    "INDICATED_BY": f"{VOCAB}indicatedBy",
    "SHIPS": f"{VOCAB}ships",
    "SUPPLIES": f"{VOCAB}supplies",
    "DELIVERED_TO": f"{VOCAB}deliveredTo",
    "IN_TRANSIT": f"{VOCAB}inTransitTo",
    "IN_SHIPMENT": f"{VOCAB}inShipment",
    # Fallback for an edge whose type is not in the vocabulary. Emitting a term
    # in our own namespace is honest: it says "a relationship we have not
    # named", rather than borrowing someone else's IRI to say it.
    "relatedTo": f"{VOCAB}relatedTo",
}


def jsonld_context() -> dict[str, Any]:
    """The `@context` for exported graphs.

    `@vocab` points at our own namespace rather than schema.org, so an
    undeclared term degrades to an undefined term *here* instead of falsely
    claiming one over there.
    """
    context: dict[str, Any] = {
        "@vocab": VOCAB,
        "schema": SCHEMA,
        # The one borrowed term, and it is borrowed correctly.
        "name": "schema:name",
    }
    context.update(CLASSES)
    # Property values are IRI references, not strings; declaring that lets a
    # consumer follow them without inspecting each value.
    context.update({term: {"@id": iri, "@type": "@id"} for term, iri in PROPERTIES.items()})
    return context


def graph_to_jsonld(graph: GraphData) -> dict[str, Any]:
    """Render a graph as a JSON-LD document under the declared vocabulary."""
    entities: list[dict[str, Any]] = []

    for node in graph.nodes:
        relationships: dict[str, list[str]] = {}
        for link in graph.links:
            if link.source != node.id:
                continue
            term = link.type if link.type in PROPERTIES else "relatedTo"
            relationships.setdefault(term, []).append(link.target)

        entities.append(
            {
                "@id": node.id,
                "@type": node.type,
                "name": node.label,
                **relationships,
            }
        )

    return {"@context": jsonld_context(), "@graph": entities}
