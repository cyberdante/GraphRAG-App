"""Loads the sample supply-chain graph into a Bolt-speaking store.

Idempotent: every write is a MERGE keyed on the node id, so running it twice
leaves the same graph rather than a doubled one. That matters more than it
sounds — a seed you cannot re-run is a seed you stop trusting, and then you
start dropping the database instead, which loses whatever you were debugging.

    docker compose up -d neo4j
    python scripts/seed_neo4j.py

Reads connection details from settings, so it seeds whatever the service would
query.
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import fixtures  # noqa: E402
from app.config import Settings  # noqa: E402
from app.retrieval.cypher_store import SAFE_IDENTIFIER, build_driver  # noqa: E402


def _checked(identifier: str, kind: str) -> str:
    """Guards the one place Cypher forces string interpolation.

    Node labels and relationship types cannot be passed as parameters, so they
    are formatted into the query. These come from our own fixtures today, but a
    seeder is exactly the kind of script that later gets pointed at someone
    else's export.
    """
    if not SAFE_IDENTIFIER.match(identifier):
        raise ValueError(f"Unsafe {kind} in source data: {identifier!r}")
    return identifier


async def seed(settings: Settings) -> tuple[int, int]:
    if not settings.neo4j_uri or not settings.neo4j_password:
        raise SystemExit(
            "No Bolt endpoint configured. Set NEO4J_URI and NEO4J_PASSWORD, or "
            "copy .env.example to .env.local."
        )

    graph = fixtures.SUPPLY_CHAIN_GRAPH
    driver = build_driver(settings.neo4j_uri, settings.neo4j_user, settings.neo4j_password)

    try:
        async with driver.session(database=settings.neo4j_database) as session:
            # One constraint per type, so re-seeding matches rather than
            # duplicates, and so lookups by id do not scan.
            for node_type in sorted({node.type for node in graph.nodes}):
                label = _checked(node_type, "node label")
                await session.run(
                    f"CREATE CONSTRAINT IF NOT EXISTS FOR (n:{label}) REQUIRE n.id IS UNIQUE"
                )

            for node in graph.nodes:
                label = _checked(node.type, "node label")
                await session.run(
                    f"MERGE (n:{label} {{id: $id}}) SET n.label = $label, n.group = $group",
                    {"id": node.id, "label": node.label, "group": node.group},
                )

            for link in graph.links:
                predicate = _checked(link.type, "relationship type")
                await session.run(
                    "MATCH (subject {id: $source}), (object {id: $target}) "
                    f"MERGE (subject)-[relation:{predicate}]->(object) "
                    "SET relation.label = $label, "
                    "relation.source = $source_name, "
                    "relation.confidence = $confidence",
                    {
                        "source": link.source,
                        "target": link.target,
                        "label": link.label,
                        "source_name": fixtures.SAMPLE_SOURCE,
                        "confidence": fixtures.SAMPLE_CONFIDENCE,
                    },
                )
    finally:
        await driver.close()

    return len(graph.nodes), len(graph.links)


if __name__ == "__main__":
    nodes, links = asyncio.run(seed(Settings()))
    print(f"Seeded {nodes} nodes and {links} relationships.")
