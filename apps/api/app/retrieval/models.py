"""What retrieval returns, independent of where it came from.

A candidate is one piece of evidence a store handed back. Every backend
produces these, so scoring, ranking, prompting and the graph frame are written
once rather than per store.

The shape follows asset-service's NliCandidate: a reified statement carries
subject, predicate and object, which is what lets the graph frame be projected
from the answer's own evidence rather than fetched separately (item 57).
"""

from dataclasses import dataclass, field
from typing import Literal

from ..models import Citation

CandidateKind = Literal["statement", "entity", "chunk", "attribute"]


@dataclass
class Candidate:
    """One retrieved piece of evidence."""

    kind: CandidateKind
    text: str

    # A statement is a triple. An attribute reuses the same three fields for
    # the owning entity, the property and the value, so dedupe and citation
    # rendering stay uniform.
    subject: str | None = None
    predicate: str | None = None
    object: str | None = None

    #: Extraction confidence carried by the source graph, when it has one.
    confidence: float | None = None
    source: str | None = None
    #: Human-readable type of the subject, used to colour the graph frame.
    subject_type: str | None = None
    object_type: str | None = None

    #: Lexical overlap with the question, set during scoring.
    relevancy: float = 0.0
    #: Final rank score, set during scoring.
    score: float = 0.0

    def key(self) -> str:
        """Dedupe key across retrieval passes."""
        return f"{self.kind}|{self.subject}|{self.predicate}|{self.object}|{self.text}"

    def to_citation(self, index: int) -> Citation:
        return Citation(
            id=f"c{index}",
            source=self.source or self.kind,
            text=self.text,
            confidence=self.confidence,
            nodeIds=[value for value in (self.subject, self.object) if value],
        )


@dataclass
class RetrievalRequest:
    """What a store is asked for.

    Deliberately carries no connection details. A store is configured by the
    deployment; a request names which configured store to use and nothing more.
    """

    query: str
    keywords: list[str] = field(default_factory=list)
    max_nodes: int = 150
    max_hops: int = 2
    entity_types: list[str] = field(default_factory=list)
    top_k: int = 30
