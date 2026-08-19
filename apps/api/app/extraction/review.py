"""Where proposals wait for a person.

Held in memory, per process, for the same reasons the attachment store is and
with the same limitation stated: a deployment that meant it would put these in a
database, and running several workers means a proposal made on one is invisible
on another. A demo that writes a review queue to disk acquires a migration
problem in exchange for surviving a restart nobody needs it to survive.

The one rule this enforces is that a decision is not silently overwritten. Re-
extracting a document produces proposals with the same ids — that is what
deriving the id from the content buys — and a proposal a person has already
judged keeps their judgement. Without that, a rerun would quietly reopen every
rejection, and the second reviewer would make the same decisions again with no
sign the first ever happened.
"""

from __future__ import annotations

from collections import OrderedDict

from .models import Extraction, Proposal, ProposalStatus

#: Enough for a working session over a handful of documents. Oldest first when
#: it overflows, matching the attachment store.
MAX_PROPOSALS = 2000


class ReviewQueue:
    """Proposals, and the decisions made about them."""

    def __init__(self, capacity: int = MAX_PROPOSALS) -> None:
        self._proposals: OrderedDict[str, Proposal] = OrderedDict()
        self._capacity = capacity

    def add(self, extraction: Extraction) -> list[Proposal]:
        """Files an extraction's proposals, keeping any decision already made.

        Returns what is now queued for this source, judged and unjudged alike,
        so a caller can show the whole picture rather than only the new part.
        """
        for proposal in extraction.proposals:
            existing = self._proposals.get(proposal.id)
            if existing is not None and existing.status is not ProposalStatus.PROPOSED:
                # Judged already. The rerun does not get to reopen it.
                continue
            self._proposals[proposal.id] = proposal

        while len(self._proposals) > self._capacity:
            self._proposals.popitem(last=False)

        return self.for_source(extraction.source)

    def all(self) -> list[Proposal]:
        return list(self._proposals.values())

    def for_source(self, source: str) -> list[Proposal]:
        return [p for p in self._proposals.values() if p.source == source]

    def pending(self) -> list[Proposal]:
        return [p for p in self._proposals.values() if p.status is ProposalStatus.PROPOSED]

    def accepted(self) -> list[Proposal]:
        return [p for p in self._proposals.values() if p.status is ProposalStatus.ACCEPTED]

    def get(self, proposal_id: str) -> Proposal | None:
        return self._proposals.get(proposal_id)

    def decide(
        self, proposal_id: str, status: ProposalStatus, note: str | None = None
    ) -> Proposal | None:
        """Records a person's decision. Returns None if there is nothing to decide."""
        proposal = self._proposals.get(proposal_id)
        if proposal is None:
            return None

        proposal.status = status
        proposal.note = note
        return proposal

    def __len__(self) -> int:
        return len(self._proposals)
