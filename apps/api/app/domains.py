"""What a graph is *about*, declared rather than compiled in.

The vocabulary lived as module constants in `ontology.py`: six supply-chain
classes and eight properties, reachable only by editing Python. That is fine for
one domain and wrong for the product, whose claim is that a client's graph —
pharmaceutical, financial, whatever they have — is configuration.

Two things were tangled together and are separated here.

**A domain declares which types exist.** Classes, the properties that join them,
and the questions worth asking of that shape. This is knowledge about the
subject: "Which suppliers are at risk?" is a supply-chain question, not a piece
of branding.

**A tenant declares how those types look.** Palette, shape, typography. Two
tenants can hold the same supply chain and want different colours for the same
Supplier; one tenant cannot hold clinical trials and keep supply-chain classes.

Before this the web app inferred its entity types from the *keys of a colour
map*, which conflated the two: a type existed because somebody had given it a
colour, and changing the palette changed what could be searched for.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class QueryPreset:
    """A query worth starting from.

    Orientation rather than shortcut. The first one a newcomer runs should
    answer "what is actually in this store", in words rather than identifiers —
    a console that opens on an empty box assumes you already know the schema,
    which is the thing you came to find out.

    Tagged with its language because a preset is not portable: the same question
    is different text in Cypher and in SPARQL, and offering the wrong one is
    worse than offering none.
    """

    label: str
    description: str
    language: str
    query: str


@dataclass(frozen=True)
class Domain:
    """One subject a deployment can hold a graph about."""

    id: str
    label: str
    version: str
    #: Namespace for classes and properties. Owned by us, so an undeclared term
    #: degrades to an undefined term here rather than falsely claiming one at
    #: schema.org.
    vocab: str
    #: Node types. Order is display order; the graph legend follows it.
    classes: tuple[str, ...]
    #: Predicate names as the graph stores them, mapped to the lowerCamelCase
    #: local name RDF convention wants. Aliasing one to the other is exactly
    #: what a JSON-LD context is for.
    properties: dict[str, str]
    #: What each property connects: (domain class, predicate, range class).
    #: Declared rather than observed, so a traversal can be planned for a path
    #: the data has not taken yet.
    shapes: tuple[tuple[str, str, str], ...] = ()
    #: State a node carries rather than a relationship it has: (class, property,
    #: what the values mean). The attribute pass searches these, so leaving them
    #: undeclared would put shapes in the data that the vocabulary — whose whole
    #: claim is that the data is checked against it — has never heard of.
    #:
    #: Values are strings throughout. A typed literal would need a comparison
    #: this pipeline does not do, and declaring xsd:date on a field nothing ever
    #: compares as a date would be a claim about rigour rather than rigour.
    attributes: tuple[tuple[str, str, str], ...] = ()
    #: Questions worth asking of this shape, offered before anyone has typed.
    starters: tuple[str, ...] = ()
    #: Whether this project ships a sample graph for the domain. Only a domain
    #: with data can have its declarations checked against any, and pretending
    #: otherwise would make the agreement tests vacuous for the others.
    #: Queries worth starting from, per language.
    presets: tuple[QueryPreset, ...] = ()
    has_sample_graph: bool = False

    def iri(self, term: str) -> str:
        return f"{self.vocab}{self.properties.get(term, term)}"

    @property
    def ontology_path(self) -> str:
        return f"/ontology/{self.id}.ttl"


NAMESPACE = "https://ragstone.dev/ontology"


SUPPLY_CHAIN = Domain(
    id="supply-chain",
    label="Supply chain",
    version="1.0.0",
    vocab=f"{NAMESPACE}/supply-chain#",
    classes=("Supplier", "Shipment", "Product", "Location", "Risk", "RiskSignal"),
    properties={
        "HAS_RISK": "hasRisk",
        "HAS_SIGNAL": "hasSignal",
        "INDICATED_BY": "indicatedBy",
        "SHIPS": "ships",
        "SUPPLIES": "supplies",
        "DELIVERED_TO": "deliveredTo",
        "IN_TRANSIT": "inTransitTo",
        "IN_SHIPMENT": "inShipment",
        # Fallback for a relationship we have not named. Emitting a term in our
        # own namespace is honest: it says "a relationship we have not named",
        # rather than borrowing someone else's IRI to say it.
        "relatedTo": "relatedTo",
    },
    attributes=(
        ("Supplier", "country", "Where the supplier is based."),
        ("Supplier", "tier", "How far from the buyer this supplier sits."),
        ("Shipment", "status", "Where the shipment is in its journey."),
        ("Shipment", "carrier", "Who is moving it."),
        ("Risk", "severity", "How serious the risk is judged to be."),
    ),
    shapes=(
        ("Supplier", "HAS_RISK", "Risk"),
        ("Supplier", "SHIPS", "Shipment"),
        ("Supplier", "SUPPLIES", "Product"),
        ("Product", "IN_SHIPMENT", "Shipment"),
        ("Shipment", "DELIVERED_TO", "Location"),
        ("Shipment", "IN_TRANSIT", "Location"),
        ("Risk", "INDICATED_BY", "RiskSignal"),
        ("Location", "HAS_SIGNAL", "RiskSignal"),
    ),
    presets=(
        QueryPreset(
            label="What is in the store",
            description=(
                "Every class and how many of each. Start here — it answers what this "
                "graph holds in words rather than identifiers."
            ),
            language="cypher",
            query="MATCH (n)\nRETURN labels(n)[0] AS type, count(*) AS count\nORDER BY count DESC",
        ),
        QueryPreset(
            label="How things connect",
            description="Every shape the data actually takes, which is what retrieval plans from.",
            language="cypher",
            query=(
                "MATCH (a)-[r]->(b)\n"
                "RETURN labels(a)[0] AS from, type(r) AS relationship, labels(b)[0] AS to,\n"
                "       count(*) AS count\n"
                "ORDER BY count DESC"
            ),
        ),
        QueryPreset(
            label="Suppliers and their risks",
            description="The question the demo asks, as the query behind it.",
            language="cypher",
            query=(
                "MATCH (s:Supplier)-[:HAS_RISK]->(r:Risk)\n"
                "RETURN s.label AS supplier, r.label AS risk\n"
                "ORDER BY supplier\n"
                "LIMIT 25"
            ),
        ),
    ),
    starters=(
        "Which suppliers are at risk?",
        "Show shipment status",
        "What are the inventory levels?",
    ),
    has_sample_graph=True,
)


#: A second domain, and the only honest test of the claim that a subject is
#: configuration: if adding one needs a code change, it was never configuration.
#: Vocabulary only — this project ships no clinical data, and inventing some to
#: make a test pass would be worse than the test not existing.
CLINICAL_TRIALS = Domain(
    id="clinical-trials",
    label="Clinical trials",
    version="1.0.0",
    vocab=f"{NAMESPACE}/clinical-trials#",
    classes=("Trial", "Site", "Investigator", "Participant", "AdverseEvent", "Sponsor"),
    properties={
        "CONDUCTED_AT": "conductedAt",
        "LED_BY": "ledBy",
        "SPONSORED_BY": "sponsoredBy",
        "ENROLLED": "enrolled",
        "REPORTED": "reported",
        "OCCURRED_AT": "occurredAt",
        "WITHDREW_FROM": "withdrewFrom",
        "SUPERSEDES": "supersedes",
        "relatedTo": "relatedTo",
    },
    shapes=(
        ("Trial", "CONDUCTED_AT", "Site"),
        ("Trial", "SPONSORED_BY", "Sponsor"),
        ("Site", "LED_BY", "Investigator"),
        ("Site", "ENROLLED", "Participant"),
        ("Participant", "REPORTED", "AdverseEvent"),
        ("Participant", "WITHDREW_FROM", "Trial"),
        ("AdverseEvent", "OCCURRED_AT", "Site"),
        ("Trial", "SUPERSEDES", "Trial"),
    ),
    presets=(
        QueryPreset(
            label="What is in the store",
            description=(
                "Every class and how many of each. Start here — it answers what this "
                "graph holds in words rather than identifiers."
            ),
            language="cypher",
            query="MATCH (n)\nRETURN labels(n)[0] AS type, count(*) AS count\nORDER BY count DESC",
        ),
    ),
    starters=(
        "Which sites reported the most adverse events?",
        "Show enrolment by site",
        "Which trials share an investigator?",
    ),
)


DOMAINS: dict[str, Domain] = {domain.id: domain for domain in (SUPPLY_CHAIN, CLINICAL_TRIALS)}

DEFAULT_DOMAIN_ID = SUPPLY_CHAIN.id


def get(domain_id: str | None) -> Domain:
    """Resolves a domain, falling back rather than failing.

    A tenant naming a domain this deployment does not hold should render the
    default rather than an error page: the wrong vocabulary degrades the answers,
    a failure to boot degrades everything.
    """
    if not domain_id:
        return DOMAINS[DEFAULT_DOMAIN_ID]
    return DOMAINS.get(domain_id, DOMAINS[DEFAULT_DOMAIN_ID])
