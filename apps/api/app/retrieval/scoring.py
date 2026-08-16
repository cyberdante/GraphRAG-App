"""Deciding which evidence the answer gets to stand on.

Retrieval returns more than fits in a prompt, so something has to choose. That
choice is the difference between an answer grounded in the right facts and one
grounded in whatever the store happened to return first, which makes this the
most consequential hundred lines in the service.

Three signals, weighted: how well a candidate matches the question, how
confident the graph is in it, and how recent it is. Then a rerank pass that
penalises repetition, because the top of a purely score-ordered list tends to
be the same fact restated — and a context window filled with one entity cannot
answer a question about two.
"""

import math
import re
from datetime import UTC, datetime

from .models import Candidate

#: Words that match everything and therefore distinguish nothing.
STOPWORDS = frozenset(
    """
    a an and are as at be by can could do does for from has have how i in is it
    its me my of on or please show that the their them there these this to was
    were what when where which who whom why will with would you your
    """.split()
)

_WORD = re.compile(r"[a-z0-9#]+")


def normalize(token: str) -> str:
    """Folds the plural forms a question uses onto the singular a graph stores.

    People ask about "suppliers" and "shipments"; a graph types its nodes
    Supplier and Shipment. Without this the two vocabularies never meet, every
    candidate scores zero, and ranking silently degrades to whatever order the
    store returned — which is exactly what happened before this existed.

    Three rules, applied in order, and each one earns its place:

    - "-ies" to "-y", so policies finds policy.
    - "-ches/-shes/-xes/-zes" lose both letters, so batches finds batch. Only
      these endings, because "-ses" is genuinely ambiguous: buses is bus plus
      es, warehouses is warehouse plus s, and nothing in the surface form
      distinguishes them.
    - Otherwise a trailing "s" goes, unless the word ends in -ss, -us or -is.
      Those guards exist because status, analysis and address are not plurals,
      and stemming them produced statu, analysi and addres.

    Crude on purpose, and it will mis-stem words a dictionary would catch. Real
    lemmatisation arrives with the spaCy pass in the retrieval port and belongs
    there rather than being approximated further here.
    """
    if len(token) > 3 and token.endswith("ies"):
        return f"{token[:-3]}y"
    if len(token) > 4 and token.endswith(("ches", "shes", "xes", "zes")):
        return token[:-2]
    if len(token) > 3 and token.endswith("s") and not token.endswith(("ss", "us", "is")):
        return token[:-1]
    return token


def tokenize(text: str) -> set[str]:
    return {normalize(token) for token in _WORD.findall(text.lower()) if token not in STOPWORDS}


def extract_keywords(question: str) -> list[str]:
    """The question's content words, in order, without repeats.

    Order is kept because it is occasionally useful for display; scoring treats
    the list as a set.
    """
    seen: set[str] = set()
    keywords: list[str] = []
    for token in _WORD.findall(question.lower()):
        if token in STOPWORDS:
            continue
        stem = normalize(token)
        if stem in seen:
            continue
        seen.add(stem)
        keywords.append(stem)
    return keywords


def overlap_relevancy(keywords: list[str], text: str) -> float:
    """Fraction of the question's content words this text accounts for.

    Deliberately measured against the question rather than the candidate: a
    long candidate should not be penalised for saying more than was asked, and
    a short one should not win by saying almost nothing.
    """
    if not keywords:
        return 0.0
    tokens = tokenize(text)
    matched = sum(1 for keyword in keywords if keyword in tokens)
    return matched / len(keywords)


def recency_factor(extracted_at: datetime | None, half_life_days: float) -> float | None:
    """Exponential decay by age, or None when the store keeps no timestamp.

    None rather than a neutral default on purpose: inventing a middle value
    would let an unknown age quietly outrank a known-recent fact.
    """
    if extracted_at is None or half_life_days <= 0:
        return None

    reference = extracted_at
    if reference.tzinfo is None:
        reference = reference.replace(tzinfo=UTC)

    age_days = max((datetime.now(UTC) - reference).total_seconds() / 86400, 0.0)
    return math.pow(0.5, age_days / half_life_days)


def score_candidates(
    candidates: list[Candidate],
    keywords: list[str],
    *,
    weight_relevancy: float = 0.5,
    weight_confidence: float = 0.3,
    weight_recency: float = 0.2,
    recency_half_life_days: float = 365.0,
) -> None:
    """Scores in place, combining whichever signals a candidate actually has.

    Signals that are absent are dropped and the remaining weights renormalised,
    rather than being filled in with a default. A store that records no
    confidence should not have every candidate dragged toward the same middle
    value; it should simply be ranked on what it does know.
    """
    for candidate in candidates:
        candidate.relevancy = overlap_relevancy(keywords, candidate.searchable)

        signals: list[tuple[float, float]] = [(weight_relevancy, candidate.relevancy)]

        if candidate.confidence is not None:
            signals.append((weight_confidence, candidate.confidence))

        recency = recency_factor(candidate.extracted_at, recency_half_life_days)
        if recency is not None:
            signals.append((weight_recency, recency))

        total_weight = sum(weight for weight, _ in signals)
        candidate.score = (
            sum(weight * value for weight, value in signals) / total_weight
            if total_weight > 0
            else 0.0
        )


def dedupe(candidates: list[Candidate]) -> list[Candidate]:
    """Removes candidates several passes found, keeping the first seen."""
    seen: set[str] = set()
    unique: list[Candidate] = []
    for candidate in candidates:
        key = candidate.key()
        if key in seen:
            continue
        seen.add(key)
        unique.append(candidate)
    return unique


def rerank(
    candidates: list[Candidate],
    *,
    top_k: int,
    same_subject_penalty: float = 0.3,
    same_source_penalty: float = 0.1,
) -> list[Candidate]:
    """Takes the best candidates while discouraging repetition.

    A purely score-ordered list clusters: the highest-scoring entity supplies
    the top several rows, and the context ends up describing one thing
    thoroughly. Each time a subject or source repeats, the next candidate from
    it is discounted, so breadth wins ties against depth.

    The penalty is applied to a working copy — scores stay as computed, because
    they are reported and would otherwise mean something different depending on
    what happened to be selected first.
    """
    if top_k <= 0:
        return []

    remaining = sorted(dedupe(candidates), key=lambda item: item.score, reverse=True)
    chosen: list[Candidate] = []
    subject_counts: dict[str, int] = {}
    source_counts: dict[str, int] = {}

    while remaining and len(chosen) < top_k:
        best_index = 0
        best_value = float("-inf")

        for index, candidate in enumerate(remaining):
            penalty = same_subject_penalty * subject_counts.get(candidate.subject or "", 0)
            penalty += same_source_penalty * source_counts.get(candidate.source or "", 0)
            adjusted = candidate.score - penalty
            if adjusted > best_value:
                best_value = adjusted
                best_index = index

        candidate = remaining.pop(best_index)
        chosen.append(candidate)
        subject_counts[candidate.subject or ""] = subject_counts.get(candidate.subject or "", 0) + 1
        source_counts[candidate.source or ""] = source_counts.get(candidate.source or "", 0) + 1

    return chosen
