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
VOCAB = "https://ragstone.dev/ontology/supply-chain#"

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


#: The version of the vocabulary this build declares. Bumped when a class or a
#: property changes meaning, so a consumer holding an older export can tell.
VERSION = "1.0.0"

#: Where the Turtle document is served. Relative on purpose: the deployment's
#: own origin serves it, and hardcoding a host would name somebody else's.
ONTOLOGY_PATH = "/ontology/supply-chain.ttl"

#: What each property connects, declared rather than observed.
#:
#: The mapping above says a predicate exists and gives it an IRI. It does not say
#: what it joins, which is the part retrieval needs: knowing that HAS_RISK goes
#: from a Supplier to a Risk is what lets a traversal be planned instead of
#: walked. Item 68 currently infers this by counting what the data happens to
#: contain, which cannot describe a path the data has not taken yet — a graph
#: with no risks recorded still *has* a risk relationship.
#:
#: Declared as (domain, predicate, range). `tests/test_ontology.py` holds these
#: to the fixture graph in both directions, so a declaration that does not match
#: the data is a failing test rather than a comment nobody reads.
SHAPES: tuple[tuple[str, str, str], ...] = (
    ("Supplier", "HAS_RISK", "Risk"),
    ("Supplier", "SHIPS", "Shipment"),
    ("Supplier", "SUPPLIES", "Product"),
    ("Product", "IN_SHIPMENT", "Shipment"),
    ("Shipment", "DELIVERED_TO", "Location"),
    ("Shipment", "IN_TRANSIT", "Location"),
    ("Risk", "INDICATED_BY", "RiskSignal"),
    ("Location", "HAS_SIGNAL", "RiskSignal"),
)


def domain_of(predicate: str) -> str | None:
    """The class a predicate starts from, when the vocabulary declares one."""
    return next((domain for domain, term, _ in SHAPES if term == predicate), None)


def range_of(predicate: str) -> str | None:
    """The class a predicate points at, when the vocabulary declares one."""
    return next((target for _, term, target in SHAPES if term == predicate), None)


def to_turtle() -> str:
    """The vocabulary as a Turtle document, served rather than inlined.

    An ontology that exists only as a Python dictionary is not an ontology
    anybody else can use. This is the artifact: fetchable, versioned, and
    referenced by the exports, so a consumer holding a JSON-LD graph can resolve
    what its terms mean instead of guessing from their names.

    Generated from the declarations above rather than maintained alongside them,
    because two files describing one vocabulary is how the original defect
    happened — the export declared `hasRisk` while the graph emitted `HAS_RISK`,
    and nothing noticed because nothing compared them.
    """
    lines = [
        "# The Ragstone supply-chain vocabulary.",
        "#",
        "# Generated from app/ontology.py. Do not edit by hand: the Python",
        "# declarations are the source, and tests hold both to the data.",
        "",
        "@prefix owl:   <http://www.w3.org/2002/07/owl#> .",
        "@prefix rdfs:  <http://www.w3.org/2000/01/rdf-schema#> .",
        "@prefix schema: <https://schema.org/> .",
        f"@prefix sc:    <{VOCAB}> .",
        "",
        f"<{VOCAB.rstrip('#')}> a owl:Ontology ;",
        f'    owl:versionInfo "{VERSION}" ;',
        '    rdfs:label "Ragstone supply chain" .',
        "",
        "# ── Classes ──",
    ]

    for term in sorted(CLASSES):
        label = _spaced(term)
        lines.append(f'sc:{term} a owl:Class ; rdfs:label "{label}" .')

    lines += ["", "# ── Object properties, with what they connect ──"]

    for domain, predicate, target in SHAPES:
        iri = PROPERTIES[predicate]
        local = iri.rsplit("#", 1)[-1]
        lines.append(
            f"sc:{local} a owl:ObjectProperty ; "
            f"rdfs:domain sc:{domain} ; rdfs:range sc:{target} ; "
            f'rdfs:label "{_spaced(local)}" .'
        )

    unshaped = sorted(set(PROPERTIES) - {predicate for _, predicate, _ in SHAPES})
    if unshaped:
        lines += ["", "# ── Properties with no declared domain or range ──"]
        for predicate in unshaped:
            local = PROPERTIES[predicate].rsplit("#", 1)[-1]
            lines.append(f'sc:{local} a owl:ObjectProperty ; rdfs:label "{_spaced(local)}" .')

    return "\n".join(lines) + "\n"


def _spaced(term: str) -> str:
    """`HAS_RISK` and `RiskSignal` both become something a person would read."""
    if "_" in term:
        return term.replace("_", " ").title()
    return "".join(
        f" {char}" if char.isupper() and index else char for index, char in enumerate(term)
    ).strip()


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

    return {
        "@context": jsonld_context(),
        # Names the vocabulary this document is written in, and the version of
        # it, so a consumer can fetch the definitions instead of inferring them
        # from term names — which is exactly what went wrong when the export
        # declared `hasRisk` and the graph emitted `HAS_RISK`.
        "@id": VOCAB.rstrip("#"),
        "isDefinedBy": ONTOLOGY_PATH,
        "version": VERSION,
        "@graph": entities,
    }
