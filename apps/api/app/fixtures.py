"""Supply-chain fixture data.

The same graph and canned answers the web app used to hold in
`src/utils/mockData.ts`. It lives here now so the stream contract can be
exercised end to end before Bedrock and Neptune are wired up in Sprint 2.
"""

from .models import Citation, GraphData, GraphEdge, GraphNode

#: Provenance the sample graph carries. The edges themselves record no
#: confidence, so every store that serves this graph must attribute it the same
#: way — otherwise the same fact ranks differently depending on which backend
#: answered, which is precisely what switchable backends must not mean.
SAMPLE_SOURCE = "Supply chain graph"
SAMPLE_CONFIDENCE = 0.9

SUPPLY_CHAIN_GRAPH = GraphData(
    nodes=[
        GraphNode(
            id="sup_88",
            label="ITAMCO",
            type="Supplier",
            group=1,
            color="#4CAF50",
            properties={"country": "Germany", "tier": "Tier 1"},
        ),
        GraphNode(
            id="sup_45",
            label="TechParts Inc",
            type="Supplier",
            group=1,
            color="#4CAF50",
            properties={"country": "Taiwan", "tier": "Tier 2"},
        ),
        GraphNode(
            id="sup_23",
            label="GlobalMfg",
            type="Supplier",
            group=1,
            color="#4CAF50",
            properties={"country": "Mexico", "tier": "Tier 2"},
        ),
        GraphNode(
            id="risk_12",
            label="Delivery Delay",
            type="Risk",
            group=2,
            color="#F44336",
            properties={"severity": "Critical"},
        ),
        GraphNode(
            id="risk_34",
            label="Quality Issues",
            type="Risk",
            group=2,
            color="#F44336",
            properties={"severity": "High"},
        ),
        GraphNode(
            id="risk_56",
            label="Price Volatility",
            type="Risk",
            group=2,
            color="#FF9800",
            properties={"severity": "Moderate"},
        ),
        GraphNode(
            id="ship_01",
            label="Shipment #2401",
            type="Shipment",
            group=3,
            color="#2196F3",
            properties={"status": "Customs Hold", "carrier": "Maersk"},
        ),
        GraphNode(
            id="ship_02",
            label="Shipment #2402",
            type="Shipment",
            group=3,
            color="#2196F3",
            properties={"status": "In Transit", "carrier": "DHL Freight"},
        ),
        GraphNode(
            id="ship_03",
            label="Shipment #2403",
            type="Shipment",
            group=3,
            color="#2196F3",
            properties={"status": "Delivered", "carrier": "Maersk"},
        ),
        GraphNode(id="prod_10", label="Component A", type="Product", group=4, color="#9C27B0"),
        GraphNode(id="prod_11", label="Component B", type="Product", group=4, color="#9C27B0"),
        GraphNode(
            id="warehouse_1", label="Warehouse CA", type="Location", group=5, color="#607D8B"
        ),
        GraphNode(
            id="warehouse_2", label="Warehouse TX", type="Location", group=5, color="#607D8B"
        ),
        GraphNode(
            id="signal_1", label="Late Shipments", type="RiskSignal", group=6, color="#FF5722"
        ),
        GraphNode(
            id="signal_2", label="Low Stock Alert", type="RiskSignal", group=6, color="#FF5722"
        ),
    ],
    links=[
        GraphEdge(source="sup_88", target="risk_12", type="HAS_RISK", label="affected by"),
        GraphEdge(source="sup_88", target="ship_01", type="SHIPS", label="shipped"),
        GraphEdge(source="sup_45", target="risk_34", type="HAS_RISK", label="affected by"),
        GraphEdge(source="sup_45", target="ship_02", type="SHIPS", label="shipped"),
        GraphEdge(source="sup_23", target="risk_56", type="HAS_RISK", label="affected by"),
        GraphEdge(
            source="ship_01", target="warehouse_1", type="DELIVERED_TO", label="delivered to"
        ),
        GraphEdge(
            source="ship_02", target="warehouse_2", type="DELIVERED_TO", label="delivered to"
        ),
        GraphEdge(source="ship_03", target="warehouse_1", type="IN_TRANSIT", label="in transit to"),
        GraphEdge(source="prod_10", target="ship_01", type="IN_SHIPMENT", label="included in"),
        GraphEdge(source="prod_11", target="ship_02", type="IN_SHIPMENT", label="included in"),
        GraphEdge(source="risk_12", target="signal_1", type="INDICATED_BY", label="indicated by"),
        GraphEdge(source="warehouse_1", target="signal_2", type="HAS_SIGNAL", label="has signal"),
        GraphEdge(source="sup_88", target="prod_10", type="SUPPLIES", label="supplies"),
        GraphEdge(source="sup_45", target="prod_11", type="SUPPLIES", label="supplies"),
    ],
)


SUPPLIERS_AT_RISK = """\
Based on the current supply chain analysis, the following suppliers are at risk in Q1 2026:

**1. ITAMCO (Supplier ID: sup_88)**
- **Risk Level**: High
- **Primary Risk**: Delivery delays averaging 5-7 days
- **Impact**: Affects Component A production timeline
- **Mitigation**: Alternative supplier identified (TechParts Inc)

**2. TechParts Inc (Supplier ID: sup_45)**
- **Risk Level**: Medium
- **Primary Risk**: Quality control issues reported in last 3 shipments
- **Impact**: 12% rejection rate on Component B
- **Mitigation**: Enhanced QA protocol implemented

**3. GlobalMfg (Supplier ID: sup_23)**
- **Risk Level**: Medium-Low
- **Primary Risk**: Price volatility due to raw material costs
- **Impact**: 8-15% cost increase projected
- **Mitigation**: Long-term contract negotiation in progress

**Recommendations:**

| Supplier | Action | Owner |
| --- | --- | --- |
| ITAMCO | Diversify Component A sourcing | Procurement |
| TechParts Inc | Real-time quality monitoring | Quality |
| GlobalMfg | Lock pricing before Q2 2026 | Finance |"""


SHIPMENT_STATUS = """**Current Shipment Status Overview:**

**Shipment #2401** — In Transit
- Supplier: ITAMCO
- Destination: Warehouse CA
- ETA: January 24, 2026
- Contents: Component A (500 units)
- Status: Delayed, 2 days behind schedule

**Shipment #2402** — Delivered
- Supplier: TechParts Inc
- Destination: Warehouse TX
- Delivered: January 20, 2026
- Contents: Component B (750 units)

**Shipment #2403** — Scheduled
- Supplier: GlobalMfg
- Destination: Warehouse CA
- ETA: January 28, 2026
- Contents: Mixed components (1,200 units)

**Overall health**: 67% on-time performance this week."""


INVENTORY_LEVELS = """**Current Inventory Status by Location:**

**Warehouse CA** (California)
- Component A: 2,450 units — below reorder point
- Component B: 3,800 units — optimal
- Space: 65% utilized, updated 2 hours ago

**Warehouse TX** (Texas)
- Component A: 4,200 units — optimal
- Component B: 1,850 units — low stock alert
- Space: 78% utilized, updated 30 minutes ago

**Alerts**
- Component A at Warehouse CA needs replenishment; roughly 5 days until stockout
- Component B at Warehouse TX is approaching its minimum threshold

**Action items**
- Expedite Shipment #2401 to Warehouse CA
- Schedule an emergency order for Component B to Warehouse TX"""


FIXTURE_ANSWERS: dict[str, tuple[str, list[Citation]]] = {
    "risk": (
        SUPPLIERS_AT_RISK,
        [
            Citation(
                id="c1",
                source="Risk Assessment DB",
                text="Delivery delay pattern identified",
                confidence=0.92,
                nodeIds=["sup_88", "risk_12"],
            ),
            Citation(
                id="c2",
                source="Quality Reports",
                text="Component B rejection rate data",
                confidence=0.88,
                nodeIds=["sup_45", "risk_34"],
            ),
            Citation(
                id="c3",
                source="Market Analysis",
                text="Raw material price trends",
                confidence=0.85,
                nodeIds=["sup_23", "risk_56"],
            ),
        ],
    ),
    "shipment": (
        SHIPMENT_STATUS,
        [
            Citation(
                id="c4",
                source="Logistics System",
                text="Real-time shipment tracking",
                confidence=0.95,
                nodeIds=["ship_01", "ship_02", "ship_03"],
            ),
            Citation(
                id="c5",
                source="Warehouse Management",
                text="Delivery confirmations",
                confidence=0.98,
                nodeIds=["warehouse_1", "warehouse_2"],
            ),
        ],
    ),
    "inventory": (
        INVENTORY_LEVELS,
        [
            Citation(
                id="c6",
                source="Inventory Management System",
                text="Real-time stock levels",
                confidence=0.96,
                nodeIds=["warehouse_1", "warehouse_2"],
            ),
            Citation(
                id="c7",
                source="Predictive Analytics",
                text="Stockout probability calculations",
                confidence=0.87,
                nodeIds=["signal_2"],
            ),
        ],
    ),
}


def answer_for(query: str) -> tuple[str, list[Citation]]:
    """Pick a canned answer the way the old TypeScript mock did."""
    lowered = query.lower()

    if "risk" in lowered or "supplier" in lowered:
        return FIXTURE_ANSWERS["risk"]
    if "shipment" in lowered or "delivery" in lowered:
        return FIXTURE_ANSWERS["shipment"]
    if "inventory" in lowered or "stock" in lowered:
        return FIXTURE_ANSWERS["inventory"]

    node_count = len(SUPPLY_CHAIN_GRAPH.nodes)
    text = f"""I looked at "{query}" against the supply chain knowledge graph.

The graph holds {node_count} entities across suppliers, shipments, products, locations and risk
indicators. What is in there right now:

- **3 suppliers**: ITAMCO, TechParts Inc, GlobalMfg
- **3 shipments**: in transit, delivered and scheduled
- **3 risk factors**: delivery delays, quality issues, price volatility
- **2 warehouses**: California and Texas

Ask about supplier risk, shipment status, inventory levels, or mitigation strategies for something
more specific."""

    return text, [
        Citation(
            id="c_default",
            source="Knowledge Graph",
            text="Entity relationship data",
            confidence=0.90,
        )
    ]


def subgraph(limit: int) -> GraphData:
    """First N nodes plus only the links whose endpoints both survive."""
    nodes = graph_nodes_capped(limit)
    node_ids = {node.id for node in nodes}
    links = [
        link
        for link in SUPPLY_CHAIN_GRAPH.links
        if link.source in node_ids and link.target in node_ids
    ]
    return GraphData(nodes=nodes, links=links)


def graph_nodes_capped(limit: int) -> list[GraphNode]:
    return SUPPLY_CHAIN_GRAPH.nodes[: max(0, limit)]
