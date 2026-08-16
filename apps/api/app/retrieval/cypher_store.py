"""The openCypher backend, over Bolt.

One adapter reaches two destinations. A local Neo4j and a managed Neptune
cluster both speak Bolt and both accept openCypher, so the difference between
developing against a container and pointing at a cluster is the URI — not a
second implementation, and not a code path that only ever runs in production.

What it returns is deliberately the same shape the fixture store returns: a
reified statement per relationship, carrying the labels and types the graph
frame needs so it can be drawn without a second round trip. The conformance
suite holds both stores to that, which is what makes "switchable backends" a
property of the system rather than a claim in a README.

Connection details come from settings, never from a request — see the note in
`store.py`.
"""

import logging
import re
from typing import Any

from .models import Candidate, RetrievalRequest

logger = logging.getLogger(__name__)

#: Relationship types are interpolated into Cypher, because the language has no
#: parameter slot for them. Everything reaching that interpolation is checked
#: against this first.
SAFE_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class CypherGraphStore:
    """Serves candidates from a Bolt-speaking graph."""

    name = "cypher"
    description = "openCypher over Bolt (Neo4j locally, Neptune when deployed)."

    def __init__(self, driver: Any, database: str = "neo4j") -> None:
        self._driver = driver
        self._database = database

    async def retrieve(self, request: RetrievalRequest) -> list[Candidate]:
        # Types are matched in the database rather than filtered afterwards, so
        # the search budget is spent on rows that could actually qualify.
        cypher = """
        MATCH (subject)-[relation]->(object)
        WHERE $types = []
           OR any(label IN labels(subject) WHERE label IN $types)
           OR any(label IN labels(object) WHERE label IN $types)
        RETURN subject.id            AS subject_id,
               subject.label         AS subject_label,
               labels(subject)[0]    AS subject_type,
               type(relation)        AS predicate,
               relation.label        AS relation_label,
               relation.confidence   AS confidence,
               relation.source       AS source,
               object.id             AS object_id,
               object.label          AS object_label,
               labels(object)[0]     AS object_type
        LIMIT $limit
        """

        parameters = {
            "types": list(request.entity_types),
            # A store returns what it found, up to its search budget. The frame
            # cap belongs to the pipeline, which weighs several passes together.
            "limit": max(request.max_candidates, 1),
        }

        async with self._driver.session(database=self._database) as session:
            result = await session.run(cypher, parameters)
            records = [record.data() async for record in result]

        return [self._statement(record) for record in records]

    def _statement(self, record: dict[str, Any]) -> Candidate:
        subject_label = record.get("subject_label") or record["subject_id"]
        object_label = record.get("object_label") or record["object_id"]
        # A relationship carries a readable label when the source graph has one;
        # its type is the fallback, exactly as in the fixture store.
        relation = record.get("relation_label") or record["predicate"]

        return Candidate(
            kind="statement",
            text=f"{subject_label} {relation} {object_label}",
            subject=record["subject_id"],
            predicate=record["predicate"],
            object=record["object_id"],
            subject_label=subject_label,
            object_label=object_label,
            subject_type=record.get("subject_type"),
            object_type=record.get("object_type"),
            confidence=record.get("confidence"),
            source=record.get("source"),
        )

    async def close(self) -> None:
        await self._driver.close()


def build_driver(uri: str, user: str, password: str):
    """Builds the Bolt driver, importing the dependency only when it is used.

    The driver ships in the `graph` extra. Importing it at module load would
    make a service configured for fixtures fail to start over a dependency it
    never touches.
    """
    from neo4j import AsyncGraphDatabase

    return AsyncGraphDatabase.driver(uri, auth=(user, password))
