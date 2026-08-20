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

import hashlib
import logging
import re
import time
from datetime import UTC, datetime
from typing import Any

from . import passes, query_guard, scoring
from .issued import QueryRecorder
from .models import Candidate, RetrievalRequest
from .schema import MAX_SHAPES, GraphSchema, SchemaEdge

logger = logging.getLogger(__name__)

#: Labels and relationship types are interpolated into Cypher on the write path,
#: because the language has no parameter slot for either. Everything reaching
#: that interpolation is checked against this first — and, before that, against
#: the domain's declared vocabulary in `extraction/commit.py`, so a term has to
#: be both declared and syntactically an identifier.
#:
#: The read path interpolates nothing from data: its queries are module
#: constants and every value they use is bound. This constant sat here unused
#: for a while, next to a comment claiming a check that nothing performed, which
#: is worse than no comment — a reader assumes the protection is there.
SAFE_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class CypherGraphStore:
    """Serves candidates from a Bolt-speaking graph."""

    name = "cypher"
    description = "openCypher over Bolt (Neo4j locally, Neptune when deployed)."

    def __init__(self, driver: Any, database: str = "neo4j") -> None:
        self._driver = driver
        self._database = database
        self._schema: GraphSchema | None = None

    async def retrieve(
        self, request: RetrievalRequest, recorder: QueryRecorder | None = None
    ) -> list[Candidate]:
        keywords = passes.keywords_for(request)
        budgets = passes.plan(request.max_candidates)
        types = list(request.entity_types)

        async with self._driver.session(database=self._database) as session:
            if not keywords:
                # Nothing to search on, so there is no relevance to select by.
                rows = await self._run(
                    session,
                    _UNFILTERED,
                    {"types": types, "limit": budgets.total},
                    recorder=recorder,
                    pass_name="unfiltered",
                )
                return [self._statement(record) for record in rows]

            # The keyword filters run in the database. Filtering after the fact
            # would spend the whole budget before relevance was consulted,
            # which is the defect this replaces.
            entity_rows = await self._run(
                session,
                _BY_ENTITY,
                {"types": types, "keywords": keywords, "limit": budgets.entity},
                recorder=recorder,
                pass_name="entity",
            )

            # Ids the asker named outright. They are not searched for, they are
            # looked up: someone who attached `sup_88` has told us exactly what
            # the question is about, and matching that against keywords would be
            # throwing the information away.
            if request.entity_ids:
                entity_rows += await self._run(
                    session,
                    _BY_ID,
                    {"types": types, "ids": list(request.entity_ids), "limit": budgets.entity},
                    recorder=recorder,
                    pass_name="named ids",
                )
            # Properties the question names. A question about shipments held at
            # customs names no entity, no class and no relationship — the state
            # it asks about is a value on a node, which the two passes above
            # cannot see however large their budget.
            attribute_rows = await self._run(
                session,
                _BY_ATTRIBUTE,
                {"types": types, "keywords": keywords, "limit": budgets.attribute},
                recorder=recorder,
                pass_name="attribute",
            )
            vocabulary_rows = await self._run(
                session,
                _BY_VOCABULARY,
                {"types": types, "keywords": keywords, "limit": budgets.vocabulary},
                recorder=recorder,
                pass_name="vocabulary",
            )

            direct = entity_rows + attribute_rows + vocabulary_rows
            anchors = sorted(
                {row["subject_id"] for row in direct} | {row["object_id"] for row in direct}
            )

            # Expansion follows the relationships the schema says are worth
            # following, in that order (item 68). Without it, expansion walks
            # every edge from an anchor and spends its budget on whichever the
            # database returns first — a question about risk expands a supplier
            # into its shipments, because there are more of them.
            graph_schema = await self._cached_schema(session, recorder=recorder)
            predicates = passes.relevant_predicates(graph_schema, keywords)

            expansion_rows = (
                await self._run(
                    session,
                    _BY_EXPANSION,
                    {
                        "types": types,
                        "anchors": anchors,
                        "predicates": predicates,
                        "limit": budgets.expansion,
                    },
                    recorder=recorder,
                    pass_name="expansion",
                )
                if anchors
                else []
            )

        return passes.merge(
            [
                self._scored(entity_rows, keywords),
                self._scored(attribute_rows, keywords),
                self._scored(vocabulary_rows, keywords),
                self._scored(expansion_rows, keywords),
            ],
            budgets.total,
        )

    async def _cached_schema(self, session, recorder: QueryRecorder | None = None) -> GraphSchema:
        """The schema, read once and kept.

        Introspection is a distinct-triple scan. Running it per query would put
        a full pass over the graph in front of every question to save a few
        rows of expansion, which is a poor trade at any size.

        Cached for the life of the store, not with a clock: the registry builds
        one store per deployment, a schema changes when the data model changes,
        and a restart is already what that implies. A wrong assumption here
        costs a stale traversal plan, not a stale answer — the evidence itself
        is always read fresh.
        """
        if self._schema is None:
            # Recorded only when it actually runs. A cached schema issued no
            # query this request, and listing one would be reporting work
            # that did not happen.
            self._schema = await self._read_schema(session, recorder=recorder)
        return self._schema

    async def schema(self) -> GraphSchema:
        """Asks the store which shapes its data actually takes.

        Counted and ordered by frequency, so a card built from this leads with
        the graph's backbone rather than its rarest corner — and so a cap, if
        one is hit, drops the tail rather than something load-bearing.

        Read one over the cap on purpose: that is how truncation is *detected*
        rather than assumed, and a partial schema that does not say so is worse
        than none, because it teaches the model that the missing relationships
        do not exist.
        """
        async with self._driver.session(database=self._database) as session:
            return await self._read_schema(session)

    async def _read_schema(self, session, recorder: QueryRecorder | None = None) -> GraphSchema:
        rows = await self._run(
            session,
            _SCHEMA_SHAPES,
            {"limit": MAX_SHAPES + 1},
            recorder=recorder,
            pass_name="schema",
        )

        truncated = len(rows) > MAX_SHAPES
        edges = [
            SchemaEdge(
                domain=row["domain"],
                predicate=row["predicate"],
                range=row["range"],
                count=row["total"],
            )
            for row in rows[:MAX_SHAPES]
            if row["domain"] and row["range"]
        ]

        if truncated:
            logger.warning(
                "Graph schema hit the %d-shape cap; the rarest relationships are "
                "not described. Raise MAX_SHAPES if this store is genuinely that wide.",
                MAX_SHAPES,
            )

        return GraphSchema(edges=edges, truncated=truncated)

    async def run_readonly(
        self,
        query: str,
        *,
        parameters: dict[str, Any] | None = None,
        limit: int = 200,
        timeout: float = 10.0,
    ) -> tuple[list[str], list[dict[str, Any]]]:
        """Runs a query somebody typed, and cannot let it change anything.

        `default_access_mode=READ` is the guarantee: the server refuses a write
        whatever the phrasing, including phrasings `query_guard` has never heard
        of. The guard runs first only so a person who typed a write is told they
        typed a write, rather than handed an access-mode exception.

        The row cap is applied here rather than trusted to the query, because a
        console is exactly where somebody forgets the LIMIT.

        `parameters` exists so the queries the pipeline issued can be replayed
        as they ran. Those queries carry `$keywords`, `$types` and `$limit`, and
        the alternative — pasting the values into the text to make it
        self-contained — would both misreport what ran and hand a console user a
        worked example of building a query by concatenation. They go into the
        driver's parameter slots, which is the same reason relationship types
        are the only thing in this module ever interpolated, and only after
        `SAFE_IDENTIFIER`.
        """
        query_guard.check(query)

        async with self._driver.session(
            database=self._database, default_access_mode="READ"
        ) as session:
            result = await session.run(query, parameters or {}, timeout=timeout)

            rows: list[dict[str, Any]] = []
            async for record in result:
                rows.append(_readable(record.data()))
                if len(rows) >= limit:
                    break

            # `keys()` is synchronous on this driver, and awaiting it raises
            # rather than returning the columns. The path only runs when a query
            # matched nothing, which is why it survived: every console query
            # anyone had tried returned rows. A query with no results is the
            # ordinary case the console most needs to report clearly.
            columns = list(rows[0]) if rows else list(result.keys())

        return columns, rows

    async def commit(
        self, statements: list[Any], committed_at: datetime | None = None
    ) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
        """Writes accepted statements, resolving their endpoints by label.

        The only write path in the service, and deliberately the narrowest thing
        that works: it takes typed statements the planner has already checked,
        never a query, so the read-only guarantees the console is built on are
        not quietly handed back by a second door.

        Resolution refuses rather than guesses. A label matching two existing
        nodes of the right class is the moment a silent choice becomes a wrong
        graph that still cites its source, so it comes back as a refusal for a
        person to settle. A label matching none creates a node — that is the
        point of ingestion — and the new node is marked with the document it
        came from.

        Writing is idempotent. Both the nodes and the statement are MERGEd, so
        committing the same proposal twice leaves one of each rather than
        building a duplicate every time somebody presses the button again.
        """
        written: list[dict[str, Any]] = []
        refused: list[dict[str, str]] = []
        stamp = committed_at or datetime.now(UTC)

        async with self._driver.session(database=self._database) as session:
            for statement in statements:
                # Checked once more at the boundary that does the interpolating.
                # The planner has already done this; a write path should not
                # depend on a caller having been careful.
                terms = (statement.subject_type, statement.object_type, statement.predicate)
                if not all(SAFE_IDENTIFIER.match(term) for term in terms):
                    refused.append(
                        {"proposal_id": statement.proposal_id, "reason": "Unsafe identifier."}
                    )
                    continue

                subject = await self._resolve(session, statement.subject, statement.subject_type)
                obj = await self._resolve(session, statement.object, statement.object_type)

                ambiguous = [
                    (label, found)
                    for label, found in (
                        (statement.subject, subject),
                        (statement.object, obj),
                    )
                    if found is None
                ]
                if ambiguous:
                    refused.append(
                        {
                            "proposal_id": statement.proposal_id,
                            "reason": (
                                f"{ambiguous[0][0]!r} matches more than one node. "
                                "Say which one it is; this will not choose."
                            ),
                        }
                    )
                    continue

                result = await session.run(
                    _COMMIT_STATEMENT.format(
                        subject_label=statement.subject_type,
                        object_label=statement.object_type,
                        predicate=statement.predicate,
                    ),
                    {
                        "subject_id": subject["id"],
                        "subject_name": statement.subject,
                        "object_id": obj["id"],
                        "object_name": statement.object,
                        "source": statement.source,
                        "extractor": statement.extractor,
                        "confidence": statement.confidence,
                        "committed_at": stamp,
                    },
                )
                record = await result.single()
                written.append(
                    {
                        "proposal_id": statement.proposal_id,
                        "subject_id": subject["id"],
                        "object_id": obj["id"],
                        "created_nodes": [
                            found["id"] for found in (subject, obj) if found["created"]
                        ],
                        "statement": record["statement"] if record else None,
                    }
                )

        return written, refused

    async def _resolve(self, session, label: str, node_type: str) -> dict[str, Any] | None:
        """Finds the node this label means, or makes one. None means ambiguous.

        Matched case-insensitively on the exact label within the expected class.
        Not fuzzily: "Acme Ltd" and "ACME Limited" are the same company to a
        person and two strings here, and a matcher confident enough to join them
        is confident enough to join two that should not be.
        """
        result = await session.run(_FIND_BY_LABEL.format(label=node_type), {"name": label})
        rows = [record.data() async for record in result]

        if len(rows) > 1:
            return None
        if rows:
            return {"id": rows[0]["id"], "created": False}

        # New to the graph. The id says where it came from, which is the one
        # thing a reader of a generated id most wants to know.
        node_id = f"ext_{hashlib.sha256(f'{node_type}|{label}'.encode()).hexdigest()[:12]}"
        return {"id": node_id, "created": True}

    async def _run(
        self,
        session,
        cypher: str,
        parameters: dict[str, Any],
        recorder: QueryRecorder | None = None,
        pass_name: str = "query",
    ) -> list[dict[str, Any]]:
        """Runs one pass, and records it when somebody is listening.

        Timed and recorded here rather than at each call site, so a pass added
        later cannot be the one that quietly goes unreported.
        """
        started = time.perf_counter()
        result = await session.run(cypher, parameters)
        rows = [record.data() async for record in result]

        if recorder is not None:
            recorder.record(
                pass_name=pass_name,
                language="cypher",
                text=cypher,
                parameters=parameters,
                rows=len(rows),
                elapsed_ms=int((time.perf_counter() - started) * 1000),
            )
        return rows

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

#: Statements whose endpoints carry a property the question names — a shipment
#: whose status is "Customs Hold", a supplier whose country is named, a risk
#: whose severity is asked about.
#:
#: `properties(node)` is scanned rather than a fixed list of keys, because the
#: keys are the deployment's and not ours: a store pointed at somebody else's
#: graph has properties this project has never heard of, and naming the ones we
#: happen to generate would search our own fixtures well and their data not at
#: all. The label is excluded because the entity pass already matches it, and
#: counting it here would spend the attribute budget re-finding entity hits.
_BY_ATTRIBUTE = f"""
    MATCH (subject)-[relation]->(object)
    WHERE {_TYPE_FILTER}
      AND any(keyword IN $keywords
              WHERE any(key IN keys(subject)
                        WHERE key <> 'label' AND key <> 'id'
                          AND toLower(toString(subject[key])) CONTAINS keyword)
                 OR any(key IN keys(object)
                        WHERE key <> 'label' AND key <> 'id'
                          AND toLower(toString(object[key])) CONTAINS keyword))
    {_PROJECTION}
"""

#: One hop out from what the direct passes anchored on: the fact that explains
#: the match, rather than only the match.
#:
#: Ordered by the schema's plan rather than by whatever the database returns
#: first. An unranked expansion under a tight budget is indistinguishable from
#: an arbitrary one. An empty plan orders by nothing and still expands, which
#: is the right answer when the question names nothing this graph has.
_BY_EXPANSION = f"""
    MATCH (subject)-[relation]->(object)
    WHERE {_TYPE_FILTER}
      AND (subject.id IN $anchors OR object.id IN $anchors)
    WITH subject, relation, object,
         [i IN range(0, size($predicates) - 1)
          WHERE $predicates[i] = type(relation) | i] AS position
    WITH subject, relation, object,
         CASE WHEN size(position) > 0 THEN position[0] ELSE size($predicates) END AS rank
    ORDER BY rank
    {_PROJECTION}
"""


#: Every shape the data takes, commonest first. One row per distinct
#: (class, predicate, class), so the result is the size of the schema rather
#: than the size of the graph.
_SCHEMA_SHAPES = """
    MATCH (subject)-[relation]->(object)
    WITH labels(subject)[0] AS domain,
         type(relation)     AS predicate,
         labels(object)[0]  AS range,
         count(*)           AS total
    RETURN domain, predicate, range, total
    ORDER BY total DESC
    LIMIT $limit
"""


#: Statements touching a node the asker named by id. No keyword filter: an id is
#: not a guess, so nothing about it needs to be matched.
_BY_ID = f"""
    MATCH (subject)-[relation]->(object)
    WHERE {_TYPE_FILTER}
      AND (subject.id IN $ids OR object.id IN $ids)
    {_PROJECTION}
"""


#: Finds a node of a known class by its label, case-insensitively.
#:
#: The class is interpolated because Cypher cannot bind a label; the label being
#: searched for is bound, because it comes from a document.
_FIND_BY_LABEL = """
    MATCH (n:{label})
    WHERE toLower(n.label) = toLower($name)
    RETURN n.id AS id
"""

#: Writes one statement, creating either endpoint if it is new.
#:
#: MERGE throughout, so pressing commit twice leaves one statement rather than a
#: second copy. The provenance goes on the relationship: which document said so,
#: what read it, how sure it was, and when a person let it in. `ON CREATE` for
#: the node's own fields so a re-commit cannot overwrite a label somebody has
#: since corrected in the graph.
_COMMIT_STATEMENT = """
    MERGE (subject:{subject_label} {{id: $subject_id}})
      ON CREATE SET subject.label = $subject_name, subject.source = $source
    MERGE (object:{object_label} {{id: $object_id}})
      ON CREATE SET object.label = $object_name, object.source = $source
    MERGE (subject)-[relation:{predicate}]->(object)
      ON CREATE SET relation.source = $source,
                    relation.extractor = $extractor,
                    relation.confidence = $confidence,
                    relation.extracted_at = $committed_at
    RETURN subject.id + ' ' + type(relation) + ' ' + object.id AS statement
"""


def _readable(row: dict[str, Any]) -> dict[str, Any]:
    """Values a JSON response can carry.

    A driver row may hold nodes, relationships, paths and temporals, none of
    which serialise. Rendering them as their properties keeps the console
    useful — a node is worth seeing — while never claiming a shape the wire
    cannot carry.
    """

    def render(value: Any) -> Any:
        to_native = getattr(value, "to_native", None)
        if callable(to_native):
            return str(to_native())
        if hasattr(value, "items") and not isinstance(value, dict):
            return dict(value.items())
        if isinstance(value, dict):
            return {key: render(item) for key, item in value.items()}
        if isinstance(value, (list, tuple)):
            return [render(item) for item in value]
        if isinstance(value, (str, int, float, bool)) or value is None:
            return value
        return str(value)

    return {key: render(value) for key, value in row.items()}
