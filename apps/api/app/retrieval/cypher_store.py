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
from datetime import datetime
from typing import Any

from . import passes, scoring
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
        keywords = passes.keywords_for(request)
        budgets = passes.plan(request.max_candidates)
        types = list(request.entity_types)

        async with self._driver.session(database=self._database) as session:
            if not keywords:
                # Nothing to search on, so there is no relevance to select by.
                rows = await self._run(
                    session, _UNFILTERED, {"types": types, "limit": budgets.total}
                )
                return [self._statement(record) for record in rows]

            # The keyword filters run in the database. Filtering after the fact
            # would spend the whole budget before relevance was consulted,
            # which is the defect this replaces.
            entity_rows = await self._run(
                session, _BY_ENTITY, {"types": types, "keywords": keywords, "limit": budgets.entity}
            )
            vocabulary_rows = await self._run(
                session,
                _BY_VOCABULARY,
                {"types": types, "keywords": keywords, "limit": budgets.vocabulary},
            )

            anchors = sorted(
                {row["subject_id"] for row in entity_rows + vocabulary_rows}
                | {row["object_id"] for row in entity_rows + vocabulary_rows}
            )
            expansion_rows = (
                await self._run(
                    session,
                    _BY_EXPANSION,
                    {"types": types, "anchors": anchors, "limit": budgets.expansion},
                )
                if anchors
                else []
            )

        return passes.merge(
            [
                self._scored(entity_rows, keywords),
                self._scored(vocabulary_rows, keywords),
                self._scored(expansion_rows, keywords),
            ],
            budgets.total,
        )

    async def _run(self, session, cypher: str, parameters: dict[str, Any]) -> list[dict[str, Any]]:
        result = await session.run(cypher, parameters)
        return [record.data() async for record in result]

    def _scored(self, rows: list[dict[str, Any]], keywords: list[str]) -> list[Candidate]:
        candidates = []
        for record in rows:
            candidate = self._statement(record)
            candidate.relevancy = scoring.overlap_relevancy(keywords, candidate.searchable)
            candidates.append(candidate)
        return candidates

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
            extracted_at=_as_datetime(record.get("extracted_at")),
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


def _as_datetime(value: Any) -> datetime | None:
    """Neo4j temporals are its own type; scoring wants a stdlib datetime."""
    if value is None:
        return None
    to_native = getattr(value, "to_native", None)
    return to_native() if callable(to_native) else value


#: The columns every pass returns. One projection, so a field added for one
#: pass cannot go missing from another — a candidate lacking `subject_type`
#: draws an uncoloured node, and nothing reports it.
_PROJECTION = """
    RETURN subject.id            AS subject_id,
           subject.label         AS subject_label,
           labels(subject)[0]    AS subject_type,
           type(relation)        AS predicate,
           relation.label        AS relation_label,
           relation.confidence   AS confidence,
           relation.source       AS source,
           relation.extracted_at AS extracted_at,
           object.id             AS object_id,
           object.label          AS object_label,
           labels(object)[0]     AS object_type
    LIMIT $limit
"""

_TYPE_FILTER = """
    ($types = []
     OR any(label IN labels(subject) WHERE label IN $types)
     OR any(label IN labels(object) WHERE label IN $types))
"""

#: No question to be relevant to, so this is the honest fallback rather than a
#: silent empty answer.
_UNFILTERED = f"""
    MATCH (subject)-[relation]->(object)
    WHERE {_TYPE_FILTER}
    {_PROJECTION}
"""

#: Statements whose endpoints are *named* in the question. Substring rather
#: than equality because the question is stemmed and the graph is not.
_BY_ENTITY = f"""
    MATCH (subject)-[relation]->(object)
    WHERE {_TYPE_FILTER}
      AND any(keyword IN $keywords
              WHERE toLower(coalesce(subject.label, '')) CONTAINS keyword
                 OR toLower(coalesce(object.label, '')) CONTAINS keyword)
    {_PROJECTION}
"""

#: Statements the question describes by class or relationship rather than by
#: name. "Which suppliers have risks" names no entity at all.
_BY_VOCABULARY = f"""
    MATCH (subject)-[relation]->(object)
    WHERE {_TYPE_FILTER}
      AND any(keyword IN $keywords
              WHERE toLower(labels(subject)[0]) CONTAINS keyword
                 OR toLower(labels(object)[0]) CONTAINS keyword
                 OR toLower(type(relation)) CONTAINS keyword
                 OR toLower(coalesce(relation.label, '')) CONTAINS keyword)
    {_PROJECTION}
"""

#: One hop out from what the direct passes anchored on: the fact that explains
#: the match, rather than only the match.
_BY_EXPANSION = f"""
    MATCH (subject)-[relation]->(object)
    WHERE {_TYPE_FILTER}
      AND (subject.id IN $anchors OR object.id IN $anchors)
    {_PROJECTION}
"""
