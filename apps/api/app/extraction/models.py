"""What an extractor proposes, and what a reviewer does with it.

The unit here is a *proposal*, not a statement. Nothing an extractor produces
reaches the graph on its own: a model reading a contract will assert things the
contract does not say, and a graph that quietly accepts them is worse than no
graph, because every answer built on it inherits the error while still citing a
source. So extraction proposes and a person disposes, and the shape below exists
to make that judgement possible rather than to record a decision already made.

Two commitments follow from that, and both cost something:

**A proposal names labels, not identifiers.** A document says "ITAMCO", not
`sup_88`. Resolving that to a node — or deciding it is a new one — is a separate
step with its own failure modes, and folding it into extraction would hide the
moment where a document's "Acme Ltd" silently became an existing "ACME Limited".

**A proposal carries the words it came from.** A reviewer asked to accept
`ITAMCO --SUPPLIES--> Component A` with no source is being asked to trust the
extractor, which is the thing under review. The quote is what makes the answer
checkable in the second it takes to read it.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum


class ProposalStatus(StrEnum):
    """Where a proposal is in review.

    `PROPOSED` is the only state an extractor may produce. The other two are a
    person's, and the distinction is the point of the whole module.
    """

    PROPOSED = "proposed"
    ACCEPTED = "accepted"
    REJECTED = "rejected"


@dataclass
class Proposal:
    """One statement an extractor believes a document asserts."""

    #: Labels as the document wrote them. Resolution to node ids happens at
    #: commit, where it can be seen and argued with.
    subject: str
    predicate: str
    object: str

    #: The passage this came from. Provenance a reviewer can read, not a
    #: character offset they would have to go and look up.
    quote: str

    #: Which document, so an accepted statement can say where it came from long
    #: after the review.
    source: str

    #: Classes, when the extractor is confident enough to name them. `None` is
    #: honest and common: a document says "Rotterdam" without saying whether it
    #: means a port, a city or a warehouse.
    subject_type: str | None = None
    object_type: str | None = None

    #: How much the extractor backs this. Extractors that cannot really tell
    #: should report one flat number rather than invent a spread — a varying
    #: confidence that is not measuring anything is worse than a constant,
    #: because a reviewer will sort by it.
    confidence: float = 0.5

    status: ProposalStatus = ProposalStatus.PROPOSED

    #: Why a reviewer rejected it. Kept, because "we looked at this and said no"
    #: is information the next extraction run should not have to rediscover.
    note: str | None = None

    proposed_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    @property
    def id(self) -> str:
        """Stable across runs, derived from the statement and its source.

        Re-extracting the same document must not produce a second copy of every
        proposal a reviewer has already judged. Deriving the id from the content
        means a rerun collides with the earlier decision instead of burying it.
        """
        material = f"{self.source}|{self.subject}|{self.predicate}|{self.object}"
        return hashlib.sha256(material.encode()).hexdigest()[:16]

    def as_statement(self) -> str:
        """The proposal as a person reads it, which is also what a test asserts."""
        return f"{self.subject} {self.predicate} {self.object}"


@dataclass
class Extraction:
    """One document's worth of proposals, with what was skipped and why."""

    source: str
    proposals: list[Proposal] = field(default_factory=list)

    #: Passages the extractor looked at and declined to turn into statements.
    #: Reported rather than dropped: an extraction that returns two proposals
    #: from a forty-page contract has either found very little or gone very
    #: wrong, and silence cannot tell a reader which.
    skipped: int = 0

    #: What did the work, so a reviewer knows whether they are reading a model's
    #: output or a pattern match — those deserve very different scepticism.
    extractor: str = "unknown"

    def __len__(self) -> int:
        return len(self.proposals)
