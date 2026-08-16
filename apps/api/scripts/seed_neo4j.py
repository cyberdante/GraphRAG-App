"""Loads a supply-chain graph into a Bolt-speaking store.

Idempotent: every write is a MERGE keyed on the node id, so running it twice
leaves the same graph rather than a doubled one. That matters more than it
sounds — a seed you cannot re-run is a seed you stop trusting, and then you
start dropping the database instead, which loses whatever you were debugging.

    docker compose up -d neo4j
    python scripts/seed_neo4j.py                 # the bundled sample
    python scripts/seed_neo4j.py --scale 500     # sample plus generated volume
    python scripts/seed_neo4j.py --clear         # drop generated data first

The sample is always loaded. It is the graph the conformance suite makes exact
assertions against, so removing it to make room for volume would trade a
guarantee for a number. Generated nodes carry their own id prefix and sit
alongside it.

Reads connection details from settings, so it seeds whatever the service would
query.
"""

import argparse
import asyncio
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import fixtures, generator  # noqa: E402
from app.config import Settings  # noqa: E402
from app.retrieval.cypher_store import SAFE_IDENTIFIER, build_driver  # noqa: E402

#: Rows per write. Large enough that seeding 100k relationships is a wait
#: rather than an afternoon, small enough not to build a transaction the server
#: has to hold in memory all at once.
BATCH = 5_000

#: Records what this store holds, so a test can ask rather than guess. The
#: conformance suite asserts exact equality against the sample and must know
#: when it is looking at a store that also holds generated volume.
MARKER_LABEL = "RagstoneDataset"


def _checked(identifier: str, kind: str) -> str:
    """Guards the one place Cypher forces string interpolation.

    Node labels and relationship types cannot be passed as parameters, so they
    are formatted into the query. These come from our own data today, but a
    seeder is exactly the kind of script that later gets pointed at someone
    else's export.
    """
    if not SAFE_IDENTIFIER.match(identifier):
        raise ValueError(f"Unsafe {kind} in source data: {identifier!r}")
    return identifier


def _batched(rows: list[dict[str, Any]]):
    for start in range(0, len(rows), BATCH):
        yield rows[start : start + BATCH]


async def _write_nodes(session, by_label: dict[str, list[dict[str, Any]]]) -> int:
    """One UNWIND per class.

    Cypher has no parameter slot for a label, so a single query cannot write
    mixed types — but there are six classes and any number of nodes, so
    grouping by label costs six queries rather than one per node.
    """
    written = 0
    for node_type, rows in sorted(by_label.items()):
        label = _checked(node_type, "node label")
        await session.run(f"CREATE CONSTRAINT IF NOT EXISTS FOR (n:{label}) REQUIRE n.id IS UNIQUE")

        for batch in _batched(rows):
            await session.run(
                f"""
                UNWIND $rows AS row
                MERGE (n:{label} {{id: row.id}})
                SET n.label = row.label, n.group = row.group
                """,
                {"rows": batch},
            )
            written += len(batch)
    return written


async def _write_edges(session, by_type: dict[str, list[dict[str, Any]]]) -> int:
    written = 0
    for relation_type, rows in sorted(by_type.items()):
        predicate = _checked(relation_type, "relationship type")

        for batch in _batched(rows):
            await session.run(
                f"""
                UNWIND $rows AS row
                MATCH (subject {{id: row.source}})
                MATCH (object {{id: row.target}})
                MERGE (subject)-[relation:{predicate}]->(object)
                SET relation.label = row.label,
                    relation.source = row.source_name,
                    relation.confidence = row.confidence,
                    relation.extracted_at = row.extracted_at
                """,
                {"rows": batch},
            )
            written += len(batch)
    return written


async def _clear_generated(session) -> int:
    """Removes generated data, leaving the sample.

    Re-seeding at a smaller scale otherwise leaves the larger run's nodes
    behind, and the store quietly holds a graph nobody generated.
    """
    result = await session.run(
        """
        MATCH (n) WHERE n.id STARTS WITH $prefix
        CALL (n) { DETACH DELETE n } IN TRANSACTIONS OF 10000 ROWS
        RETURN count(*) AS removed
        """,
        {"prefix": f"{generator.GENERATED_PREFIX}_"},
    )
    record = await result.single()
    return record["removed"] if record else 0


async def seed(
    settings: Settings, scale: int = 0, seed_value: int = 20260816, clear: bool = False
) -> tuple[int, int]:
    if not settings.neo4j_uri or not settings.neo4j_password:
        raise SystemExit(
            "No Bolt endpoint configured. Set NEO4J_URI and NEO4J_PASSWORD, or "
            "copy .env.example to .env.local."
        )

    sample = fixtures.SUPPLY_CHAIN_GRAPH

    nodes_by_label: dict[str, list[dict[str, Any]]] = defaultdict(list)
    edges_by_type: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for node in sample.nodes:
        nodes_by_label[node.type].append({"id": node.id, "label": node.label, "group": node.group})
    for link in sample.links:
        edges_by_type[link.type].append(
            {
                "source": link.source,
                "target": link.target,
                "label": link.label,
                "source_name": fixtures.SAMPLE_SOURCE,
                "confidence": fixtures.SAMPLE_CONFIDENCE,
                # The sample records no extraction date. Writing one would
                # invent provenance the source graph does not have, and the
                # scoring reads a missing signal correctly already.
                "extracted_at": None,
            }
        )

    generated = generator.generate(scale, seed=seed_value)
    for node in generated.nodes:
        nodes_by_label[node.type].append({"id": node.id, "label": node.label, "group": node.group})
    for edge in generated.edges:
        edges_by_type[edge.type].append(
            {
                "source": edge.source,
                "target": edge.target,
                "label": edge.label,
                "source_name": "generated-supply-chain",
                "confidence": edge.confidence,
                "extracted_at": edge.extracted_at,
            }
        )

    driver = build_driver(settings.neo4j_uri, settings.neo4j_user, settings.neo4j_password)
    try:
        async with driver.session(database=settings.neo4j_database) as session:
            if clear:
                removed = await _clear_generated(session)
                if removed:
                    print(f"Removed {removed} generated nodes.")

            node_count = await _write_nodes(session, nodes_by_label)
            edge_count = await _write_edges(session, edges_by_type)

            # Written last: if the run dies partway, the store does not claim a
            # scale it does not hold.
            await session.run(
                f"MERGE (d:{MARKER_LABEL} {{id: 'dataset'}}) SET d.scale = $scale, d.seed = $seed",
                {"scale": scale, "seed": seed_value},
            )
    finally:
        await driver.close()

    return node_count, edge_count


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--scale",
        type=int,
        default=0,
        help="Suppliers to generate on top of the sample. 0 seeds the sample alone.",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=20260816,
        help="Generator seed. The same scale and seed produce the same graph.",
    )
    parser.add_argument(
        "--clear",
        action="store_true",
        help="Remove previously generated data first. The sample is never removed.",
    )
    args = parser.parse_args()

    nodes, edges = asyncio.run(
        seed(Settings(), scale=args.scale, seed_value=args.seed, clear=args.clear)
    )
    detail = f" (sample + scale {args.scale})" if args.scale else " (sample)"
    print(f"Seeded {nodes} nodes and {edges} relationships{detail}.")


if __name__ == "__main__":
    main()
