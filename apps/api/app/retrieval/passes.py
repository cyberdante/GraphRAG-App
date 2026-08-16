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
from .schema import GraphSchema

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


def anchor_classes(schema: GraphSchema, keywords: list[str]) -> set[str]:
    """Which classes the question is about, by name.

    Matched as substrings against the class name, for the same reason the
    passes are: the question is stemmed and the graph is not, so "suppliers"
    has to reach `Supplier`.
    """
    return {cls for cls in schema.classes if any(keyword in cls.lower() for keyword in keywords)}


def relevant_predicates(schema: GraphSchema, keywords: list[str]) -> list[str]:
    """Which relationships to expand along, and in what order.

    Expansion without this walks every edge from an anchor and spends its
    budget on whichever the database returns first. That is the same defect the
    passes fixed one level up, one hop further out: a question about risk
    expands a supplier into its shipments because there are more of them.

    Two things make a predicate worth following:

    - the question names it, or names a class at either end of it
    - it connects a class the question named to anything else

    Ordered so the ones the question actually points at come first, and the
    graph's own frequency breaks ties — the backbone before the long tail.
    """
    if schema.is_empty():
        return []

    anchors = anchor_classes(schema, keywords)

    def score(edge) -> tuple[int, int]:
        named = any(keyword in edge.predicate.lower() for keyword in keywords)
        touches = edge.domain in anchors or edge.range in anchors
        # Naming the relationship is a stronger signal than naming something it
        # connects, which is stronger than neither.
        return (2 if named else 1 if touches else 0, edge.count)

    ranked = sorted(schema.edges, key=score, reverse=True)
    wanted = [edge for edge in ranked if score(edge)[0] > 0]

    # Nothing matched: the question names no class and no relationship this
    # graph has. Returning every predicate is right — an unguided expansion
    # beats no expansion, and pretending to a plan we do not have would be
    # worse than admitting there isn't one.
    chosen = wanted or ranked

    seen: set[str] = set()
    ordered: list[str] = []
    for edge in chosen:
        if edge.predicate not in seen:
            seen.add(edge.predicate)
            ordered.append(edge.predicate)
    return ordered


def second_hop_classes(schema: GraphSchema, keywords: list[str]) -> set[str]:
    """Classes worth a second hop, when the request allows one.

    The worked example from `asset-service`: the receiver number for an order
    is an attribute of the *receipt*, not the order, so a one-hop search cannot
    reach it however high the limit goes. Knowing the shape of the graph is
    what tells retrieval when to keep walking.

    Direction is deliberately ignored. The hub-and-spoke shape that makes a
    second hop necessary usually requires reversing direction at the hub, so
    following only outgoing edges would never arrive.
    """
    anchors = anchor_classes(schema, keywords)
    if not anchors:
        return set()

    reachable: set[str] = set()
    for cls in anchors:
        reachable |= schema.neighbours(cls)
    return reachable - anchors
