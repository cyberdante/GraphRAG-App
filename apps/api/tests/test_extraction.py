"""Extraction proposes; a person disposes. See docs/adr/0005.

A wrong statement written into a graph is different in kind from a wrong answer.
It persists, it is retrieved as evidence, and every answer built on it inherits
the error while still citing a source. So the property under test throughout is
that nothing here asserts anything — and that the things this extractor gets
wrong are recorded as tests rather than left to be discovered by a user.
"""

import pytest

from app.config import Settings
from app.domains import CLINICAL_TRIALS, SUPPLY_CHAIN
from app.extraction.models import Extraction, Proposal, ProposalStatus
from app.extraction.reference import ReferenceExtractor
from app.extraction.registry import UnknownExtractorError, build
from app.extraction.review import ReviewQueue

NOTES = """ITAMCO supplies Component A to the Hamburg plant.
Shipment #2401 delivered to Warehouse CA last Tuesday.
TechParts Inc has risk Quality Issues after three failed inspections.
The weather was poor all week and morale was low.
"""


async def extract(text: str, source: str = "notes.md", domain=SUPPLY_CHAIN) -> Extraction:
    return await ReferenceExtractor(domain).extract(text, source)


class TestWhatTheReferenceExtractorProposes:
    @pytest.mark.anyio
    async def test_reads_statements_the_vocabulary_has_words_for(self):
        result = await extract(NOTES)
        statements = {p.as_statement() for p in result.proposals}

        assert "ITAMCO SUPPLIES Component A" in statements
        assert "Shipment #2401 DELIVERED_TO Warehouse CA" in statements
        assert "TechParts Inc HAS_RISK Quality Issues" in statements

    @pytest.mark.anyio
    async def test_reports_what_it_passed_over(self):
        # An extraction returning two proposals from a long document has either
        # found very little or gone very wrong, and a bare list cannot say which.
        result = await extract(NOTES)

        assert result.skipped == 1

    @pytest.mark.anyio
    async def test_cannot_propose_a_term_the_graph_has_no_word_for(self):
        # The property that makes a pattern matcher safe to ship: it is built
        # from the vocabulary, so it has no vocabulary of its own to invent from.
        result = await extract(NOTES)

        assert all(p.predicate in SUPPLY_CHAIN.properties for p in result.proposals)

    @pytest.mark.anyio
    async def test_follows_the_domain_it_is_given(self):
        # A clinical extractor must not propose supply-chain relationships. The
        # forms come from the domain, so this is structural rather than a filter.
        result = await extract(NOTES, domain=CLINICAL_TRIALS)

        assert all(p.predicate in CLINICAL_TRIALS.properties for p in result.proposals)

    @pytest.mark.anyio
    async def test_carries_the_words_it_came_from(self):
        # A reviewer judging a statement without its source is being asked to
        # trust the extractor, which is the thing under review.
        result = await extract(NOTES)
        proposal = next(p for p in result.proposals if p.subject == "ITAMCO")

        assert "ITAMCO supplies Component A" in proposal.quote

    @pytest.mark.anyio
    async def test_names_itself_so_a_reviewer_knows_what_to_doubt(self):
        # "A model said so" and "a regular expression said so" deserve different
        # scepticism.
        assert (await extract(NOTES)).extractor == "reference"

    @pytest.mark.anyio
    async def test_proposes_nothing_as_accepted(self):
        # The whole contract in one assertion. An extractor may only propose.
        result = await extract(NOTES)

        assert all(p.status is ProposalStatus.PROPOSED for p in result.proposals)


class TestWhatItGetsWrong:
    """Known failures, recorded as tests.

    The difference between a limitation and a bug waiting to be found by a user
    is whether it is written down. Each of these is why the review step is not
    ceremony.
    """

    @pytest.mark.anyio
    @pytest.mark.parametrize(
        "sentence",
        [
            "ITAMCO no longer supplies Component A.",
            "It is false that ITAMCO supplies Component A.",
            "Nobody believes ITAMCO supplies Component A.",
        ],
    )
    async def test_negation_produces_a_confidently_wrong_proposal(self, sentence):
        # It matches the surface form and proposes the opposite of what the
        # document says. The clearest single reason a person decides.
        result = await extract(sentence)

        assert any(p.as_statement() == "ITAMCO SUPPLIES Component A" for p in result.proposals)

    @pytest.mark.anyio
    async def test_a_negation_in_a_different_tense_is_missed_instead(self):
        # "does not supply" is not "supplies", so this one is lost rather than
        # inverted. Both failure modes are real and they are not the same: one
        # asks a reviewer to catch a wrong statement, the other never reaches
        # them at all.
        assert (await extract("ITAMCO does not supply Component A.")).proposals == []

    @pytest.mark.anyio
    async def test_an_abbreviation_costs_the_whole_sentence(self):
        # The sentence splitter has no abbreviation list, so "Acme Ltd." ends a
        # sentence and the statement is cut in half. The trade was chosen: over-
        # splitting loses a proposal rather than inventing one.
        assert (await extract("Acme Ltd. supplies Component B.")).proposals == []

    @pytest.mark.anyio
    async def test_cannot_resolve_a_pronoun(self):
        result = await extract("They also ship Component B.")

        assert result.proposals == []

    @pytest.mark.anyio
    async def test_punctuation_does_not_split_one_statement_into_two(self):
        # The name pattern allows a full stop so "Ltd." survives, which means it
        # also swallowed the one ending the sentence — and "Component A." and
        # "Component A" are different ids, so the same statement arrived twice
        # and was reviewed twice.
        with_stop = await extract("ITAMCO supplies Component A.")
        without = await extract("ITAMCO supplies Component A to the plant.")

        assert with_stop.proposals[0].id == without.proposals[0].id

    @pytest.mark.anyio
    async def test_reports_one_flat_confidence_because_it_cannot_tell(self):
        # A spread that is not measuring anything is worse than a constant: a
        # reviewer will sort by it and believe the order means something.
        result = await extract(NOTES)

        assert len({p.confidence for p in result.proposals}) == 1


class TestProposalIdentity:
    def test_the_same_statement_from_the_same_document_is_the_same_proposal(self):
        # What stops a rerun burying the decisions already made.
        first = Proposal(subject="A", predicate="SUPPLIES", object="B", quote="x", source="d.md")
        again = Proposal(
            subject="A", predicate="SUPPLIES", object="B", quote="different", source="d.md"
        )

        assert first.id == again.id

    def test_the_same_statement_from_a_different_document_is_not(self):
        # Provenance is part of the identity: the same claim in two documents is
        # two pieces of evidence, not one.
        first = Proposal(subject="A", predicate="SUPPLIES", object="B", quote="x", source="one.md")
        other = Proposal(subject="A", predicate="SUPPLIES", object="B", quote="x", source="two.md")

        assert first.id != other.id


class TestTheReviewQueue:
    def a_proposal(self, subject: str = "ITAMCO") -> Proposal:
        return Proposal(
            subject=subject,
            predicate="SUPPLIES",
            object="Component A",
            quote=f"{subject} supplies Component A.",
            source="notes.md",
        )

    def test_a_decision_survives_re_reading_the_document(self):
        # Without this a rerun quietly reopens every rejection, and the next
        # reviewer makes the same decisions again with no sign of the first.
        queue = ReviewQueue()
        proposal = self.a_proposal()
        queue.add(Extraction(source="notes.md", proposals=[proposal]))
        queue.decide(proposal.id, ProposalStatus.REJECTED, "the document says the opposite")

        queue.add(Extraction(source="notes.md", proposals=[self.a_proposal()]))

        assert queue.get(proposal.id).status is ProposalStatus.REJECTED
        assert queue.get(proposal.id).note == "the document says the opposite"

    def test_an_undecided_proposal_is_refreshed_rather_than_duplicated(self):
        queue = ReviewQueue()
        queue.add(Extraction(source="notes.md", proposals=[self.a_proposal()]))
        queue.add(Extraction(source="notes.md", proposals=[self.a_proposal()]))

        assert len(queue) == 1

    def test_separates_what_is_waiting_from_what_is_settled(self):
        queue = ReviewQueue()
        first, second = self.a_proposal("ITAMCO"), self.a_proposal("TechParts Inc")
        queue.add(Extraction(source="notes.md", proposals=[first, second]))
        queue.decide(first.id, ProposalStatus.ACCEPTED)

        assert [p.id for p in queue.pending()] == [second.id]
        assert [p.id for p in queue.accepted()] == [first.id]

    def test_deciding_something_that_is_not_there_says_so(self):
        assert ReviewQueue().decide("nope", ProposalStatus.ACCEPTED) is None

    def test_drops_the_oldest_when_it_overflows(self):
        queue = ReviewQueue(capacity=2)
        proposals = [self.a_proposal(f"Supplier {n}") for n in range(3)]
        queue.add(Extraction(source="notes.md", proposals=proposals))

        assert len(queue) == 2
        assert queue.get(proposals[0].id) is None


class TestChoosingAnExtractor:
    def test_the_reference_one_runs_with_nothing_configured(self):
        assert build(Settings(_env_file=None), SUPPLY_CHAIN).name == "reference"

    def test_naming_one_that_is_not_installed_fails_loudly(self):
        # A deployment believing its documents were read by a model, and getting
        # a regular expression, would trust the output far more than it deserves.
        with pytest.raises(UnknownExtractorError):
            build(Settings(_env_file=None, extractor="not-installed"), SUPPLY_CHAIN)


@pytest.fixture(autouse=True)
def empty_review_queue():
    """A queue nobody else has written to.

    The queue is module-level state on the app, so without this a test asserting
    "these are the accepted proposals" passes only while it is the only test
    that accepts one — green today, and order-dependent the moment somebody adds
    another. The attachment store beside it has the same shape and is cleared
    for the same reason.
    """
    from app.main import attachment_store, review_queue

    review_queue._proposals.clear()
    attachment_store._items.clear()
    yield
    review_queue._proposals.clear()
    attachment_store._items.clear()


class TestTheReviewEndpoints:
    """The loop as a client drives it."""

    def upload(self, client) -> str:
        response = client.post(
            "/api/attachments",
            files={"files": ("notes.md", NOTES.encode(), "text/markdown")},
        )
        assert response.status_code == 200
        return response.json()[0]["id"]

    def test_reads_an_uploaded_document_and_proposes(self, client):
        attachment = self.upload(client)

        body = client.post(f"/api/extraction/{attachment}").json()

        assert body["extractor"] == "reference"
        assert body["skipped"] == 1
        assert {p["subject"] for p in body["proposals"]} >= {"ITAMCO", "TechParts Inc"}
        # Nothing is asserted by reading. Every proposal arrives undecided.
        assert {p["status"] for p in body["proposals"]} == {"proposed"}

    def test_every_proposal_carries_its_source_text(self, client):
        attachment = self.upload(client)

        body = client.post(f"/api/extraction/{attachment}").json()

        assert all(p["quote"] for p in body["proposals"])
        assert all(p["source"] == "notes.md" for p in body["proposals"])

    def test_a_document_that_is_gone_says_so(self, client):
        # Uploads are in memory and evicted oldest first, so this is ordinary
        # rather than exceptional.
        response = client.post("/api/extraction/missing-id")

        assert response.status_code == 404
        assert "evicted" in response.json()["detail"]

    def test_a_decision_is_recorded_and_survives_re_reading(self, client):
        attachment = self.upload(client)
        proposal = client.post(f"/api/extraction/{attachment}").json()["proposals"][0]

        rejected = client.post(
            f"/api/extraction/proposals/{proposal['id']}",
            json={"status": "rejected", "note": "the document says the opposite"},
        ).json()
        assert rejected["status"] == "rejected"

        # Reading the document again must not reopen it.
        again = client.post(f"/api/extraction/{attachment}").json()
        same = next(p for p in again["proposals"] if p["id"] == proposal["id"])

        assert same["status"] == "rejected"
        assert same["note"] == "the document says the opposite"

    def test_deciding_something_that_is_not_there_says_so(self, client):
        response = client.post("/api/extraction/proposals/nope", json={"status": "accepted"})

        assert response.status_code == 404

    def test_a_decision_must_be_one_of_the_two(self, client):
        # "committed" is not a decision a person makes here, and accepting a
        # free-form status would let a client invent states the queue cannot
        # reason about.
        response = client.post("/api/extraction/proposals/anything", json={"status": "committed"})

        assert response.status_code == 422

    def test_lists_what_is_waiting_separately_from_what_is_settled(self, client):
        attachment = self.upload(client)
        proposals = client.post(f"/api/extraction/{attachment}").json()["proposals"]
        client.post(f"/api/extraction/proposals/{proposals[0]['id']}", json={"status": "accepted"})

        accepted = client.get("/api/extraction", params={"status": "accepted"}).json()
        pending = client.get("/api/extraction", params={"status": "proposed"}).json()

        assert [p["id"] for p in accepted] == [proposals[0]["id"]]
        assert proposals[0]["id"] not in {p["id"] for p in pending}
