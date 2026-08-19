"""Ranking behaviour.

These assert properties rather than exact numbers. A weighting is a judgement
that will be tuned; that a more relevant fact outranks a less relevant one is
not, and a test that pins the arithmetic would have to be rewritten every time
someone adjusts a weight.
"""

from datetime import UTC, datetime, timedelta

from app.retrieval.models import Candidate
from app.retrieval.scoring import (
    dedupe,
    extract_keywords,
    overlap_relevancy,
    recency_factor,
    rerank,
    score_candidates,
    tokenize,
)


def statement(
    text: str,
    *,
    subject: str = "s",
    obj: str = "o",
    confidence: float | None = 0.9,
    source: str = "graph",
    extracted_at: datetime | None = None,
) -> Candidate:
    return Candidate(
        kind="statement",
        text=text,
        subject=subject,
        predicate="RELATES_TO",
        object=obj,
        confidence=confidence,
        source=source,
        extracted_at=extracted_at,
    )


class TestTokenizing:
    def test_drops_words_that_distinguish_nothing(self) -> None:
        assert tokenize("what are the suppliers") == {"supplier"}

    def test_folds_plurals_onto_the_form_a_graph_stores(self) -> None:
        # People ask about "suppliers"; a graph types its nodes Supplier. The
        # two vocabularies have to meet or every candidate scores zero and
        # ranking degrades to whatever order the store returned.
        assert tokenize("suppliers shipments warehouses") == {
            "supplier",
            "shipment",
            "warehouse",
        }

    def test_folds_the_awkward_english_plurals_too(self) -> None:
        # The stem is a shared prefix rather than a dictionary word, because
        # nothing normalises the graph: matching is a substring test against raw
        # labels, and "policy" does not occur in "policies".
        assert tokenize("policies") == tokenize("policy")
        assert tokenize("batches") == {"batch"}

    def test_folds_verb_forms_onto_the_noun_a_graph_stores(self) -> None:
        # The gap that made this worth changing. A question asking which
        # shipments are *delayed* found nothing against a risk labelled
        # "Delivery Delay": the stemmer knew plurals and no other inflection.
        assert tokenize("delayed") == tokenize("delay") == tokenize("delays")
        assert tokenize("shipping") == tokenize("shipped") == tokenize("ships")

    def test_folds_the_forms_that_only_agree_on_a_prefix(self) -> None:
        # supplies, supplied and supply share no dictionary form that occurs in
        # all three. A lemmatiser returns "supply", which is not a substring of
        # "supplies" — it would have made this case worse while looking like the
        # more sophisticated choice.
        assert tokenize("supplies") == tokenize("supplied") == tokenize("supply")

    def test_a_stem_still_occurs_in_the_words_it_came_from(self) -> None:
        # The property the whole design rests on: whatever a question is stemmed
        # to must survive a substring test against the graph's own text. This
        # fails the moment a rule cuts to a form rather than a prefix.
        for word in ("suppliers", "supplied", "shipments", "shipping", "delayed", "policies"):
            stem = next(iter(tokenize(word)))
            assert stem in word, f"{stem!r} is not a prefix of {word!r}"

    def test_does_not_stem_a_word_into_nearly_nothing(self) -> None:
        # Over-stemming does not fail loudly. It fills the search budget with
        # everything, which reads as bad ranking rather than as a bad stem.
        for word in ("day", "days", "risk", "risks", "bus", "ship"):
            assert len(next(iter(tokenize(word)))) >= 3

    def test_leaves_words_that_only_look_plural(self) -> None:
        assert tokenize("status") == {"status"}

    def test_keeps_identifiers_with_digits_and_hashes(self) -> None:
        # "#2401" is exactly the kind of token a question is most specific about.
        assert "#2401" in tokenize("where is shipment #2401")

    def test_keywords_keep_order_and_drop_repeats(self) -> None:
        assert extract_keywords("risk and risk and suppliers") == ["risk", "supplier"]

    def test_singular_and_plural_count_as_one_keyword(self) -> None:
        assert extract_keywords("supplier and suppliers") == ["supplier"]


class TestRelevancy:
    def test_measures_coverage_of_the_question(self) -> None:
        assert overlap_relevancy(["supplier", "risk"], "supplier affected by risk") == 1.0
        assert overlap_relevancy(["supplier", "risk"], "supplier ships product") == 0.5

    def test_a_long_candidate_is_not_penalised_for_saying_more(self) -> None:
        # Measured against the question, not the candidate, so extra detail
        # never costs a candidate its place.
        terse = overlap_relevancy(["risk"], "risk")
        verbose = overlap_relevancy(["risk"], "risk affecting deliveries across three suppliers")
        assert terse == verbose == 1.0

    def test_no_keywords_means_no_signal_rather_than_a_crash(self) -> None:
        assert overlap_relevancy([], "anything") == 0.0

    def test_matches_the_entity_type_not_only_the_prose(self) -> None:
        # A question about "risk" must reach a statement naming two entities
        # whose *types* are Supplier and Risk.
        candidate = Candidate(
            kind="statement",
            text="ITAMCO affected by Delivery Delay",
            subject_type="Supplier",
            object_type="Risk",
        )
        assert overlap_relevancy(["risk"], candidate.searchable) == 1.0


class TestRecency:
    def test_decays_by_half_over_one_half_life(self) -> None:
        year_ago = datetime.now(UTC) - timedelta(days=365)
        assert recency_factor(year_ago, 365.0) == __import__("pytest").approx(0.5, abs=0.01)

    def test_is_absent_rather_than_neutral_when_unknown(self) -> None:
        # A middle value would let an unknown age outrank a known-recent fact.
        assert recency_factor(None, 365.0) is None


class TestScoring:
    def test_a_better_match_outranks_a_worse_one(self) -> None:
        candidates = [
            statement("supplier ships product"),
            statement("supplier affected by risk"),
        ]
        score_candidates(candidates, ["supplier", "risk"])
        assert candidates[1].score > candidates[0].score

    def test_confidence_breaks_a_relevancy_tie(self) -> None:
        candidates = [
            statement("supplier at risk", confidence=0.5),
            statement("supplier at risk", confidence=0.99, obj="o2"),
        ]
        score_candidates(candidates, ["supplier", "risk"])
        assert candidates[1].score > candidates[0].score

    def test_a_store_without_confidence_is_ranked_on_what_it_knows(self) -> None:
        # Weights renormalise over the signals present, so a missing signal
        # does not drag every candidate toward the same value.
        with_confidence = [statement("supplier at risk", confidence=1.0)]
        without = [statement("supplier at risk", confidence=None)]

        score_candidates(with_confidence, ["supplier", "risk"])
        score_candidates(without, ["supplier", "risk"])

        assert with_confidence[0].score == 1.0
        assert without[0].score == 1.0

    def test_scores_stay_within_range(self) -> None:
        candidates = [statement("supplier at risk"), statement("unrelated")]
        score_candidates(candidates, ["supplier", "risk"])
        assert all(0.0 <= candidate.score <= 1.0 for candidate in candidates)


class TestRerank:
    def test_returns_the_best_first(self) -> None:
        candidates = [statement("unrelated", subject="a"), statement("supplier risk", subject="b")]
        score_candidates(candidates, ["supplier", "risk"])
        assert rerank(candidates, top_k=2)[0].subject == "b"

    def test_honours_top_k(self) -> None:
        candidates = [statement(f"s{i}", subject=str(i)) for i in range(10)]
        score_candidates(candidates, ["s1"])
        assert len(rerank(candidates, top_k=3)) == 3

    def test_top_k_of_zero_returns_nothing_rather_than_everything(self) -> None:
        assert rerank([statement("x")], top_k=5, same_subject_penalty=0) != []
        assert rerank([statement("x")], top_k=0) == []

    def test_breaks_up_a_run_of_one_subject(self) -> None:
        # The failure this prevents: a context window describing one entity
        # thoroughly and unable to answer a question about two.
        candidates = [
            statement("supplier risk one", subject="itamco", obj="r1"),
            statement("supplier risk two", subject="itamco", obj="r2"),
            statement("supplier risk three", subject="itamco", obj="r3"),
            statement("supplier risk four", subject="techparts", obj="r4"),
        ]
        score_candidates(candidates, ["supplier", "risk"])
        subjects = [candidate.subject for candidate in rerank(candidates, top_k=2)]

        assert subjects == ["itamco", "techparts"]

    def test_reported_scores_are_not_altered_by_selection_order(self) -> None:
        # The penalty applies to selection, not to the score, which is reported.
        candidates = [
            statement("supplier risk", subject="a", obj="1"),
            statement("supplier risk", subject="a", obj="2"),
        ]
        score_candidates(candidates, ["supplier", "risk"])
        before = [candidate.score for candidate in candidates]
        rerank(candidates, top_k=2)

        assert [candidate.score for candidate in candidates] == before

    def test_removes_duplicates_found_by_several_passes(self) -> None:
        duplicate = statement("same", subject="a", obj="b")
        assert len(dedupe([duplicate, statement("same", subject="a", obj="b")])) == 1
