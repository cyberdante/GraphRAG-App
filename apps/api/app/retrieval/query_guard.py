"""Letting somebody type a query, without letting them change anything.

A console that relays whatever it is handed is a write endpoint wearing a query
label. openCypher has `CREATE`, `MERGE`, `DELETE`, `SET` and `REMOVE`; SPARQL
has `UPDATE`, `INSERT` and `DROP`. A read-only console has to mean it.

Two mechanisms, and they do different jobs.

**The driver enforces.** A Neo4j session opened with `default_access_mode=READ`
refuses a write at the server, and no phrasing gets past it — not string
tricks, not a procedure call, not something this module has never heard of.
That is the guarantee.

**This module explains.** A driver refusal is an exception about access mode; a
person who typed `MATCH (n) DELETE n` deserves to be told they typed a write,
not handed a stack trace. So the clause check runs first, to produce a legible
refusal, and the driver stands behind it for everything the check does not know
about.

Ordering them the other way round — trusting the check and skipping the driver
mode — would be the mistake. A regex over a query language is a guess, and a
guess is not an access control.
"""

from __future__ import annotations

import re

#: Clauses that change data, in the languages this service speaks. Matched as
#: whole words so `MATCH (c:Created)` is not mistaken for a `CREATE`.
WRITE_CLAUSES = (
    # openCypher
    "CREATE",
    "MERGE",
    "DELETE",
    "DETACH",
    "SET",
    "REMOVE",
    "DROP",
    "FOREACH",
    "LOAD CSV",
    # SPARQL Update, for when the SPARQL adapter lands
    "INSERT",
    "CLEAR",
    "COPY",
    "MOVE",
    "ADD",
)

#: Procedure namespaces that write, or reach outside the database entirely.
#: `apoc.load.json` fetches a URL, which is the SSRF the rest of this service
#: takes care to prevent; `dbms.*` reaches administration.
FORBIDDEN_PROCEDURES = (
    "apoc.load",
    "apoc.periodic",
    "apoc.trigger",
    "dbms.",
    "db.index",
    "db.create",
)

_COMMENTS = re.compile(r"//[^\n]*|/\*.*?\*/", re.S)
_STRINGS = re.compile(r"'[^']*'|\"[^\"]*\"|`[^`]*`")


class QueryRejected(ValueError):
    """Why a query was not run, in words the person who typed it can act on."""

    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__(reason)


def _bare(query: str) -> str:
    """The query with comments and string literals removed.

    Both are places a clause keyword can appear innocently — a node named
    'DELETE ME', a comment explaining why something was removed — and both are
    places a keyword cannot *do* anything. Stripping them first is what stops
    the check refusing a legitimate query for a word inside a quoted string.
    """
    return _STRINGS.sub("''", _COMMENTS.sub(" ", query))


def check(query: str) -> None:
    """Raises if the query is not obviously a read.

    Deliberately conservative: it refuses anything it does not recognise as safe
    rather than allowing anything it does not recognise as dangerous. The cost of
    the first is a query someone has to rephrase; the cost of the second is a
    console that can edit the graph.
    """
    if not query.strip():
        raise QueryRejected("Enter a query.")

    bare = _bare(query).upper()

    for clause in WRITE_CLAUSES:
        if re.search(rf"(?<![A-Z0-9_]){re.escape(clause)}(?![A-Z0-9_])", bare):
            raise QueryRejected(
                f"{clause} changes data, and this console is read-only. "
                "Queries that read are run; queries that write are refused here "
                "and would be refused by the database as well."
            )

    lowered = _bare(query).lower()
    for procedure in FORBIDDEN_PROCEDURES:
        if procedure in lowered:
            raise QueryRejected(
                f"Procedures under {procedure} are not available here: they write, "
                "administer, or reach outside the database."
            )

    # A read has to start somewhere recognisable. Without this, anything the
    # clause list has not heard of would reach the driver — which would refuse a
    # write, but only after a round trip and with a worse message.
    if not re.match(
        r"\s*(MATCH|WITH|UNWIND|RETURN|CALL|SELECT|ASK|DESCRIBE|CONSTRUCT|PREFIX|EXPLAIN|PROFILE)\b",
        bare,
    ):
        raise QueryRejected(
            "A query has to begin with a reading clause — MATCH, WITH, UNWIND, "
            "CALL, RETURN, or the SPARQL equivalents."
        )
