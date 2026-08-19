"""What the pipeline actually asked the database.

The trace already reported how many candidates were considered, how long each
phase took, which model answered and which backend served it — everything except
the one thing a sceptical reader most wants to see. A graph nobody can watch
being queried is a claim about the architecture rather than evidence of it.

Recording happens in the store, because only the store knows its own query
language. A recorder is passed in per call rather than kept on the store: one
store instance serves every concurrent request, so anything remembered on `self`
belongs to whichever question finished last.

A backend that issues no query records none. The fixture store filters a bundled
graph in Python, and inventing a query string to describe that would be the
worst outcome here — a reader would take it for something a database ran.
"""

from dataclasses import dataclass, field


@dataclass(frozen=True)
class IssuedQuery:
    """One query, as sent, with what it cost."""

    #: Which pass issued it — entity, vocabulary, expansion, and so on. The
    #: budget is divided per pass, so which pass asked is what makes a row count
    #: readable.
    pass_name: str

    #: The query language, so a reader knows what they are looking at and the
    #: console knows whether it can run it.
    language: str

    #: The query text, exactly as the driver received it.
    text: str

    #: Values bound to the query's parameter slots. Kept apart from the text
    #: rather than folded into it: this is what the driver was actually handed,
    #: and interpolating them to make a copy-pasteable string would both
    #: misreport what ran and teach the reader to build queries by concatenation.
    parameters: dict[str, object] = field(default_factory=dict)

    #: Rows the store returned, before merging and ranking.
    rows: int = 0

    elapsed_ms: int = 0


class QueryRecorder:
    """Collects the queries one retrieval issued.

    Deliberately not a store attribute. Deliberately not global. It is created
    per request and handed down, which is the only arrangement that survives two
    people asking questions at once.
    """

    def __init__(self) -> None:
        self._queries: list[IssuedQuery] = []

    def record(
        self,
        pass_name: str,
        language: str,
        text: str,
        parameters: dict[str, object] | None = None,
        rows: int = 0,
        elapsed_ms: int = 0,
    ) -> None:
        self._queries.append(
            IssuedQuery(
                pass_name=pass_name,
                language=language,
                text=text.strip(),
                parameters=dict(parameters or {}),
                rows=rows,
                elapsed_ms=elapsed_ms,
            )
        )

    @property
    def queries(self) -> list[IssuedQuery]:
        return list(self._queries)

    def __len__(self) -> int:
        return len(self._queries)
