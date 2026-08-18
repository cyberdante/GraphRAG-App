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

from .domains import DEFAULT_DOMAIN_ID, Domain
from .domains import get as get_domain
from .models import GraphData

SCHEMA = "https://schema.org/"


def classes_of(domain: Domain) -> dict[str, str]:
    """Node `type` values, mapped to the class IRI each denotes."""
    return {term: f"{domain.vocab}{term}" for term in domain.classes}


def properties_of(domain: Domain) -> dict[str, str]:
    """Edge `type` values, mapped to the property IRI each denotes.

    The keys are SCREAMING_SNAKE because that is what the graph stores; the IRIs
    are lowerCamelCase because that is the convention for RDF properties.
    """
    return {term: domain.iri(term) for term in domain.properties}


def domain_of(predicate: str, domain: Domain) -> str | None:
    """The class a predicate starts from, when the vocabulary declares one."""
    return next((start for start, term, _ in domain.shapes if term == predicate), None)


def range_of(predicate: str, domain: Domain) -> str | None:
    """The class a predicate points at, when the vocabulary declares one."""
    return next((target for _, term, target in domain.shapes if term == predicate), None)


def to_turtle(domain: Domain) -> str:
    """The vocabulary as a Turtle document, served rather than inlined.

    An ontology that exists only as a Python dictionary is not an ontology
    anybody else can use. This is the artifact: fetchable, versioned, and
    referenced by the exports, so a consumer holding a JSON-LD graph can resolve
    what its terms mean instead of guessing from their names.

    Generated from the declarations rather than maintained alongside them,
    because two files describing one vocabulary is how the original defect
    happened — the export declared `hasRisk` while the graph emitted `HAS_RISK`,
    and nothing noticed because nothing compared them.
    """
    properties = properties_of(domain)
    lines = [
        f"# The Ragstone {domain.label.lower()} vocabulary.",
        "#",
        "# Generated from app/domains.py. Do not edit by hand: the declarations",
        "# there are the source, and tests hold both to the data.",
        "",
        "@prefix owl:   <http://www.w3.org/2002/07/owl#> .",
        "@prefix rdfs:  <http://www.w3.org/2000/01/rdf-schema#> .",
        "@prefix schema: <https://schema.org/> .",
        f"@prefix sc:    <{domain.vocab}> .",
        "",
        f"<{domain.vocab.rstrip('#')}> a owl:Ontology ;",
        f'    owl:versionInfo "{domain.version}" ;',
        f'    rdfs:label "{domain.label}" .',
        "",
        "# ── Classes ──",
    ]

    for term in sorted(domain.classes):
        lines.append(f'sc:{term} a owl:Class ; rdfs:label "{_spaced(term)}" .')

    lines += ["", "# ── Object properties, with what they connect ──"]

    for start, predicate, target in domain.shapes:
        local = properties[predicate].rsplit("#", 1)[-1]
        lines.append(
            f"sc:{local} a owl:ObjectProperty ; "
            f"rdfs:domain sc:{start} ; rdfs:range sc:{target} ; "
            f'rdfs:label "{_spaced(local)}" .'
        )

    unshaped = sorted(set(domain.properties) - {term for _, term, _ in domain.shapes})
    if unshaped:
        lines += ["", "# ── Properties with no declared domain or range ──"]
        for predicate in unshaped:
            local = properties[predicate].rsplit("#", 1)[-1]
            lines.append(f'sc:{local} a owl:ObjectProperty ; rdfs:label "{_spaced(local)}" .')

    return "\n".join(lines) + "\n"


def _spaced(term: str) -> str:
    """`HAS_RISK` and `RiskSignal` both become something a person would read."""
    if "_" in term:
        return term.replace("_", " ").title()
    return "".join(
        f" {char}" if char.isupper() and index else char for index, char in enumerate(term)
    ).strip()


def jsonld_context(domain: Domain) -> dict[str, Any]:
    """The `@context` for exported graphs.

    `@vocab` points at our own namespace rather than schema.org, so an
    undeclared term degrades to an undefined term *here* instead of falsely
    claiming one over there.
    """
    context: dict[str, Any] = {
        "@vocab": domain.vocab,
        "schema": SCHEMA,
        # The one borrowed term, and it is borrowed correctly.
        "name": "schema:name",
    }
    context.update(classes_of(domain))
    # Property values are IRI references, not strings; declaring that lets a
    # consumer follow them without inspecting each value.
    context.update(
        {term: {"@id": iri, "@type": "@id"} for term, iri in properties_of(domain).items()}
    )
    return context


def graph_to_jsonld(graph: GraphData, domain: Domain | None = None) -> dict[str, Any]:
    """Render a graph as a JSON-LD document under the declared vocabulary."""
    domain = domain or get_domain(DEFAULT_DOMAIN_ID)
    properties = properties_of(domain)
    entities: list[dict[str, Any]] = []

    for node in graph.nodes:
        relationships: dict[str, list[str]] = {}
        for link in graph.links:
            if link.source != node.id:
                continue
            term = link.type if link.type in properties else "relatedTo"
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
        "@context": jsonld_context(domain),
        # Names the vocabulary this document is written in, and the version of
        # it, so a consumer can fetch the definitions instead of inferring them
        # from term names — which is exactly what went wrong when the export
        # declared `hasRisk` and the graph emitted `HAS_RISK`.
        "@id": domain.vocab.rstrip("#"),
        "isDefinedBy": domain.ontology_path,
        "version": domain.version,
        "@graph": entities,
    }
