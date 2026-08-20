"""Turning accepted proposals into statements a graph can hold.

This is the only path in the service that writes to a store, and it is built to
be narrow rather than general. Three rules shape it, each ruling out something
easier.

**A request names proposals, never a query.** The console goes to lengths to
stay read-only — a session opened in READ mode, a clause guard on top — and a
write endpoint that accepted a string would hand back everything those buy. What
crosses the wire here is a list of ids the service already holds decisions for.

**Identifiers are interpolated; everything else is bound.** Cypher has no
parameter slot for a label or a relationship type, so those are the one thing
that must be built into the query text. They are therefore taken only from the
domain's declared vocabulary and checked against a strict pattern before they go
anywhere near it — never from a document, and never from a request. Labels,
values and provenance are bound by the driver as always.

**Ambiguity is refused, not resolved.** A document's "Acme Ltd" matching two
existing nodes is exactly the moment a silent choice becomes a wrong graph that
still cites a source. The reviewer is asked; nothing is guessed.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from ..domains import Domain
from ..ontology import domain_of, range_of
from .models import Proposal, ProposalStatus

#: What may be interpolated into Cypher. Belt and braces over the vocabulary
#: check: a term is both declared *and* syntactically an identifier before it is
#: built into a query.
SAFE_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


@dataclass(frozen=True)
class Planned:
    """One accepted proposal, typed and ready to write."""

    proposal_id: str
    subject: str
    subject_type: str
    predicate: str
    object: str
    object_type: str
    #: Carried onto the statement, so a fact in the graph can say which document
    #: it came from and what read it, long after the review.
    source: str
    extractor: str
    confidence: float


@dataclass(frozen=True)
class Refused:
    """A proposal that will not be written, and what a person must do about it."""

    proposal_id: str
    reason: str


@dataclass
class CommitPlan:
    planned: list[Planned] = field(default_factory=list)
    refused: list[Refused] = field(default_factory=list)


def plan(proposals: list[Proposal], domain: Domain, extractor: str = "unknown") -> CommitPlan:
    """Decides what can be written, and says why the rest cannot.

    Types come from the vocabulary rather than from the extractor. A pattern
    matcher reading "ITAMCO supplies Component A" knows the relationship and not
    the classes, but the vocabulary declares that SUPPLIES runs from Supplier to
    Product — so the shape the graph already promises is what types the new
    nodes. That is what `shapes` has been for since item 68, and it means a
    document cannot introduce a class the graph does not model.

    A predicate with no declared shape is refused rather than written untyped.
    An untyped node is invisible to every pass that filters on class, so it
    would be a statement that is present and unfindable — worse than a refusal,
    because nothing reports it.
    """
    result = CommitPlan()

    for proposal in proposals:
        if proposal.status is not ProposalStatus.ACCEPTED:
            result.refused.append(
                Refused(proposal.id, "Not accepted. Only accepted proposals commit.")
            )
            continue

        if proposal.predicate not in domain.properties:
            result.refused.append(
                Refused(
                    proposal.id,
                    f"{proposal.predicate!r} is not a relationship this vocabulary declares.",
                )
            )
            continue

        subject_type = proposal.subject_type or domain_of(proposal.predicate, domain)
        object_type = proposal.object_type or range_of(proposal.predicate, domain)

        missing = [
            name
            for name, value in (("subject", subject_type), ("object", object_type))
            if value is None
        ]
        if missing:
            result.refused.append(
                Refused(
                    proposal.id,
                    (
                        f"The vocabulary does not say what {proposal.predicate} connects, so the "
                        f"{' and '.join(missing)} cannot be typed. Declare a shape for it, or set "
                        "the types on the proposal."
                    ),
                )
            )
            continue

        unknown = [t for t in (subject_type, object_type) if t not in domain.classes]
        if unknown:
            result.refused.append(Refused(proposal.id, f"Undeclared class {unknown[0]!r}."))
            continue

        terms = (subject_type, object_type, proposal.predicate)
        if not all(SAFE_IDENTIFIER.match(term) for term in terms):
            # Unreachable while the terms come from the vocabulary, which is the
            # point: this is the check that has to still be here if that ever
            # stops being true.
            result.refused.append(
                Refused(proposal.id, "A term in this statement is not a safe identifier.")
            )
            continue

        result.planned.append(
            Planned(
                proposal_id=proposal.id,
                subject=proposal.subject,
                subject_type=subject_type,
                predicate=proposal.predicate,
                object=proposal.object,
                object_type=object_type,
                source=proposal.source,
                extractor=extractor,
                confidence=proposal.confidence,
            )
        )

    return result
