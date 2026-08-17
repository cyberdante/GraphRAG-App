"""What retrieval returns, independent of where it came from.

A candidate is one piece of evidence a store handed back. Every backend
produces these, so scoring, ranking, prompting and the graph frame are written
once rather than per store.

The shape is a reified statement: it carries
subject, predicate and object, which is what lets the graph frame be projected
from the answer's own evidence rather than fetched separately (item 57).
"""

from dataclasses import dataclass, field
from datetime import datetime
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
    #: Display labels, so the graph frame can be drawn without a second lookup.
    subject_label: str | None = None
    object_label: str | None = None

    #: When the underlying fact was extracted, when the store knows.
    extracted_at: datetime | None = None

    #: Lexical overlap with the question, set during scoring.
    relevancy: float = 0.0
    #: Final rank score, set during scoring.
    score: float = 0.0

    @property
    def searchable(self) -> str:
        """Everything a question could plausibly match against.

        The prose alone is not enough: a question about "risk" should reach a
        statement whose text names two entities but whose *types* are Supplier
        and Risk. Matching the types and the predicate too is what connects the
        vocabulary of the question to the vocabulary of the graph.
        """
        parts = [self.text, self.predicate, self.subject_type, self.object_type]
        return " ".join(part for part in parts if part)

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

    #: How much evidence to gather. Distinct from max_nodes on purpose: that
    #: caps the picture, this caps the search. Conflating them means the store
    #: truncates before ranking runs, so ranking can only reorder whatever
    #: arbitrary prefix came back — which silently defeats the whole pipeline.
    max_candidates: int = 200
    #: Caps the graph frame drawn from the ranked result.
    max_nodes: int = 150
    max_hops: int = 2
    entity_types: list[str] = field(default_factory=list)
    top_k: int = 30
