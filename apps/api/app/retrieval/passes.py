"""How a question turns into a search, and how the budget is divided.

Before this, a store answered every question with the same rows. Neither
backend consulted the question text — both filtered on `entity_types` and
nothing else — so the search budget selected an arbitrary prefix and ranking
could only reorder whatever the database happened to return first. At fifteen
nodes that was invisible, because everything fitted inside the budget. At five
thousand statements a question about risk was answered from a prefix that
contained none.

Three passes, because one query cannot do all three jobs:

**Entity.** Statements whose subject or object *is named* in the question.
"Which suppliers ship to Rotterdam" should reach Rotterdam.

**Vocabulary.** Statements whose type or relationship matches the question.
"Which suppliers have risks" names no entity at all — it names two classes and
one relationship, and only the schema connects them to rows.

**Expansion.** One hop out from whatever the first two anchored on. The
question names a supplier; the answer is usually about what that supplier is
connected to. Without this a match returns the matched fact and nothing that
explains it.

Each pass carries its own budget rather than sharing one. A shared limit is
consumed by whichever pass the database happens to answer first, which in
practice starves expansion completely — the same failure the per-entity budget
comment in `asset-service` warns about.
"""

from dataclasses import dataclass

from . import scoring
from .models import Candidate, RetrievalRequest

#: How the search budget divides. Entity and vocabulary matches are the direct
#: answer to the question; expansion is context for it, and wants less.
ENTITY_SHARE = 0.4
VOCABULARY_SHARE = 0.4
EXPANSION_SHARE = 0.2


@dataclass(frozen=True)
class Budgets:
    entity: int
    vocabulary: int
    expansion: int

    @property
    def total(self) -> int:
        return self.entity + self.vocabulary + self.expansion


def plan(max_candidates: int) -> Budgets:
    """Divides the search budget across the passes.

    Every pass gets at least one row. A pass budgeted zero is a pass that
    silently does not run, which is indistinguishable from a pass that found
    nothing — and the two want very different fixes.
    """
    budget = max(max_candidates, 1)
    return Budgets(
        entity=max(1, int(budget * ENTITY_SHARE)),
        vocabulary=max(1, int(budget * VOCABULARY_SHARE)),
        expansion=max(1, int(budget * EXPANSION_SHARE)),
    )


def keywords_for(request: RetrievalRequest) -> list[str]:
    """The terms to search on.

    `RetrievalRequest.keywords` is a cache the pipeline fills in, not a
    requirement on the caller. A store handed a bare question must still search
    it rather than fall back to returning everything — that fallback is what
    made the search budget arbitrary.
    """
    if request.keywords:
        return request.keywords
    return scoring.extract_keywords(request.query)


def merge(passes: list[list[Candidate]], limit: int) -> list[Candidate]:
    """Combines the passes, keeping the best sighting of each statement.

    The same statement legitimately surfaces in more than one pass — matched by
    name and again by type. Deduping on the candidate key keeps the evidence
    once; keeping the higher relevancy means a fact that matched directly is
    not demoted by having also been reached sideways.
    """
    best: dict[str, Candidate] = {}
    for candidates in passes:
        for candidate in candidates:
            existing = best.get(candidate.key())
            if existing is None or candidate.relevancy > existing.relevancy:
                best[candidate.key()] = candidate
    return list(best.values())[:limit]
