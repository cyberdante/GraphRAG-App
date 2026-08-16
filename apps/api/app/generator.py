"""A supply-chain graph at whatever size the question needs.

The bundled sample is fifteen nodes. Every question reaches every fact, so
ranking cannot be wrong in a way anyone would notice, the frame cap never
binds, and the layout has nothing to struggle with. Two of the three ranking
signals are not merely untested but inert: no store sets `extracted_at`, so the
recency weight is renormalised away on every candidate, and `confidence` is the
same constant everywhere. Only relevancy discriminates. A rerank pass built for
three signals has been running on one.

This generates a graph large enough to falsify that. It uses the same six
classes and eight properties as the sample — see `ontology.py`, which the tests
hold to agreement in both directions — so nothing downstream changes: the
export, the vocabulary and the graph frame all still apply.

Three properties matter more than volume:

**Deterministic.** Same scale and seed, same graph, byte for byte. A dataset
that changes per run cannot be asserted against, and a bug that appears only on
someone else's data is a bug nobody can reproduce.

**Skewed.** A few suppliers carry many shipments and most carry one or two.
Uniform graphs make every ranking look correct, because there is nothing for
ranking to get wrong.

**Provenanced.** Every statement carries its own confidence and extraction
date, spread over years. That is what brings the other two thirds of the
ranking to life.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from datetime import datetime, timedelta

#: Node ids carry this prefix so generated data is distinguishable from the
#: bundled sample in a store that holds both. Tests rely on it to tell whether
#: they are looking at a graph they can make exact assertions about.
GENERATED_PREFIX = "gen"

#: Fixed so the generator is reproducible without a clock. Callers that want
#: data which reads as current pass their own.
DEFAULT_REFERENCE = datetime(2026, 8, 16)

#: How far back extraction dates reach. Wider than the 365-day recency
#: half-life on purpose: if every fact is newer than the half-life, the recency
#: signal has range but no discrimination.
HISTORY_DAYS = 1095

_SUPPLIER_PREFIXES = (
    "Nord",
    "Vertex",
    "Kaisen",
    "Orbit",
    "Ferro",
    "Lumen",
    "Cascade",
    "Tamar",
    "Helio",
    "Quill",
    "Basalt",
    "Meridian",
    "Arda",
    "Pelagic",
    "Corvid",
)
_SUPPLIER_STEMS = ("tech", "works", "forge", "supply", "logistics", "components", "systems")
_SUPPLIER_SUFFIXES = ("Inc", "Ltd", "GmbH", "SA", "Co", "Group", "Partners")

_PRODUCT_HEADS = (
    "Bearing",
    "Actuator",
    "Housing",
    "Coupler",
    "Rotor",
    "Gasket",
    "Manifold",
    "Bracket",
    "Spindle",
    "Valve",
    "Harness",
    "Impeller",
)
_PRODUCT_GRADES = ("A2", "M4", "X9", "T1", "S7", "V3", "K5")

_CITIES = (
    "Rotterdam",
    "Long Beach",
    "Hamburg",
    "Busan",
    "Santos",
    "Felixstowe",
    "Valencia",
    "Durban",
    "Manzanillo",
    "Gdansk",
    "Tangier",
    "Callao",
)

_RISK_KINDS = (
    "Delivery Delay",
    "Quality Deviation",
    "Single Source Exposure",
    "Customs Hold",
    "Capacity Shortfall",
    "Currency Exposure",
    "Sanctions Screening",
    "Labour Dispute",
)

_SIGNAL_KINDS = (
    "Late Shipments",
    "Low Stock Alert",
    "Inspection Failures",
    "Port Congestion",
    "Rising Lead Time",
    "Order Cancellations",
)


@dataclass(frozen=True)
class GeneratedNode:
    id: str
    label: str
    type: str
    group: int


@dataclass(frozen=True)
class GeneratedEdge:
    """A statement, with the provenance the sample graph never carried."""

    source: str
    target: str
    type: str
    label: str
    confidence: float
    extracted_at: datetime


@dataclass(frozen=True)
class GeneratedGraph:
    nodes: list[GeneratedNode]
    edges: list[GeneratedEdge]

    def __len__(self) -> int:
        return len(self.nodes)


#: Which group number each class draws with, matching the sample so the graph
#: legend and the tenant palette keep meaning the same thing.
_GROUPS = {
    "Supplier": 1,
    "Risk": 2,
    "Shipment": 3,
    "Product": 4,
    "Location": 5,
    "RiskSignal": 6,
}

#: Base credence per relationship type, before per-statement variation. A
#: shipment's destination is a matter of record; a risk attribution is a
#: judgement. Flattening those to one constant is what made the confidence
#: signal useless.
_BASE_CONFIDENCE = {
    "SUPPLIES": 0.94,
    "SHIPS": 0.93,
    "IN_SHIPMENT": 0.9,
    "DELIVERED_TO": 0.96,
    "IN_TRANSIT": 0.88,
    "HAS_RISK": 0.72,
    "INDICATED_BY": 0.68,
    "HAS_SIGNAL": 0.7,
}


def generate(
    scale: int,
    *,
    seed: int = 20260816,
    reference: datetime | None = None,
) -> GeneratedGraph:
    """Builds a supply chain of roughly `scale` suppliers.

    `scale` counts suppliers rather than nodes, because it is the quantity the
    rest of the graph hangs off: everything else is generated per supplier, so
    doubling it doubles the graph without changing its shape.
    """
    if scale < 1:
        return GeneratedGraph(nodes=[], edges=[])

    rng = random.Random(seed)
    reference = reference or DEFAULT_REFERENCE

    nodes: list[GeneratedNode] = []
    edges: list[GeneratedEdge] = []

    def add_edge(source: str, target: str, relation: str, label: str) -> None:
        base = _BASE_CONFIDENCE[relation]
        # Jitter, then clamp: a confidence above 1 is not a stronger claim, it
        # is a broken one, and the scoring would happily rank on it.
        confidence = min(0.99, max(0.35, rng.gauss(base, 0.08)))
        extracted_at = reference - timedelta(
            days=rng.randint(0, HISTORY_DAYS),
            hours=rng.randint(0, 23),
        )
        edges.append(
            GeneratedEdge(
                source=source,
                target=target,
                type=relation,
                label=label,
                confidence=round(confidence, 3),
                extracted_at=extracted_at,
            )
        )

    # Shared pools. Locations and signals are referenced by many suppliers,
    # which is what makes the graph a graph rather than a stack of disjoint
    # stars — and what gives multi-hop retrieval somewhere to walk.
    location_count = max(3, scale // 8)
    locations = [
        GeneratedNode(
            id=f"{GENERATED_PREFIX}_loc_{index:05d}",
            label=f"{_CITIES[index % len(_CITIES)]} DC{index // len(_CITIES) + 1}",
            type="Location",
            group=_GROUPS["Location"],
        )
        for index in range(location_count)
    ]
    nodes.extend(locations)

    signal_count = max(3, scale // 12)
    signals = [
        GeneratedNode(
            id=f"{GENERATED_PREFIX}_sig_{index:05d}",
            label=_SIGNAL_KINDS[index % len(_SIGNAL_KINDS)],
            type="RiskSignal",
            group=_GROUPS["RiskSignal"],
        )
        for index in range(signal_count)
    ]
    nodes.extend(signals)

    for location in locations:
        # Not every site is reporting something. A signal on every one would
        # make the relationship meaningless.
        if rng.random() < 0.35:
            add_edge(location.id, rng.choice(signals).id, "HAS_SIGNAL", "has signal")

    # A minority of suppliers carry most of the volume. Retrieval that looks
    # good on a uniform graph frequently falls apart here, which is the point.
    hub_cutoff = max(1, round(scale * 0.05))

    for index in range(scale):
        is_hub = index < hub_cutoff
        supplier_id = f"{GENERATED_PREFIX}_sup_{index:05d}"
        nodes.append(
            GeneratedNode(
                id=supplier_id,
                label=_supplier_name(rng, index),
                type="Supplier",
                group=_GROUPS["Supplier"],
            )
        )

        product_count = rng.randint(4, 9) if is_hub else rng.randint(1, 3)
        products = []
        for offset in range(product_count):
            product = GeneratedNode(
                id=f"{GENERATED_PREFIX}_prod_{index:05d}_{offset}",
                label=f"{rng.choice(_PRODUCT_HEADS)} {rng.choice(_PRODUCT_GRADES)}",
                type="Product",
                group=_GROUPS["Product"],
            )
            products.append(product)
            nodes.append(product)
            add_edge(supplier_id, product.id, "SUPPLIES", "supplies")

        shipment_count = rng.randint(6, 14) if is_hub else rng.randint(1, 4)
        for offset in range(shipment_count):
            shipment_id = f"{GENERATED_PREFIX}_ship_{index:05d}_{offset}"
            nodes.append(
                GeneratedNode(
                    id=shipment_id,
                    label=f"Shipment #{index:05d}-{offset:02d}",
                    type="Shipment",
                    group=_GROUPS["Shipment"],
                )
            )
            add_edge(supplier_id, shipment_id, "SHIPS", "shipped")
            add_edge(rng.choice(products).id, shipment_id, "IN_SHIPMENT", "included in")

            destination = rng.choice(locations).id
            if rng.random() < 0.25:
                add_edge(shipment_id, destination, "IN_TRANSIT", "in transit to")
            else:
                add_edge(shipment_id, destination, "DELIVERED_TO", "delivered to")

        # Risks concentrate on the hubs, which is both realistic and the case
        # that matters: the questions worth asking are about the suppliers a
        # lot depends on.
        risk_count = rng.randint(1, 3) if is_hub else (1 if rng.random() < 0.3 else 0)
        for offset in range(risk_count):
            risk_id = f"{GENERATED_PREFIX}_risk_{index:05d}_{offset}"
            nodes.append(
                GeneratedNode(
                    id=risk_id,
                    label=rng.choice(_RISK_KINDS),
                    type="Risk",
                    group=_GROUPS["Risk"],
                )
            )
            add_edge(supplier_id, risk_id, "HAS_RISK", "affected by")
            add_edge(risk_id, rng.choice(signals).id, "INDICATED_BY", "indicated by")

    return GeneratedGraph(nodes=nodes, edges=edges)


def _supplier_name(rng: random.Random, index: int) -> str:
    """A company name, not 'Supplier 41'.

    Retrieval scores lexical overlap against the question, so entity labels are
    part of what is being tested. Names drawn from one template share every
    token and would make the graph easier to search than any real one.
    """
    prefix = rng.choice(_SUPPLIER_PREFIXES)
    if rng.random() < 0.45:
        return f"{prefix}{rng.choice(_SUPPLIER_STEMS)} {rng.choice(_SUPPLIER_SUFFIXES)}"
    return f"{prefix} {rng.choice(_SUPPLIER_SUFFIXES)}"
