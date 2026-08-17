"""Attachments were collected and thrown away.

The composer read the bytes, the request carried the file *names*, and nothing
downstream ever saw the contents — so a question about an attached document was
answered from the graph alone. That is worse than refusing the attachment,
because it looks like it worked.
"""

import pytest

from app.attachments import (
    Attachment,
    AttachmentRejected,
    AttachmentStore,
    as_candidates,
    decode,
)


class TestWhatIsAccepted:
    def test_reads_a_text_document(self):
        assert decode("notes.md", b"# Heading\n\nSome prose.") == "# Heading\n\nSome prose."

    def test_refuses_a_type_it_cannot_read(self):
        with pytest.raises(AttachmentRejected) as raised:
            decode("scan.pdf", b"%PDF-1.7 ...")

        # The message names what it *can* read, so the answer is actionable
        # rather than just a refusal.
        assert "unsupported type" in raised.value.reason
        assert ".md" in raised.value.reason

    def test_refuses_bytes_that_are_not_text_whatever_the_name_says(self):
        # The extension is a claim; the decode is the check. A .txt full of
        # JPEG is exactly the case an extension allowlist alone lets through.
        with pytest.raises(AttachmentRejected) as raised:
            decode("photo.txt", b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01")

        assert "UTF-8" in raised.value.reason

    def test_refuses_text_with_embedded_nulls(self):
        # A NUL byte decodes happily and means the file is not really text.
        with pytest.raises(AttachmentRejected):
            decode("binary.txt", b"header\x00\x00payload")

    def test_refuses_an_empty_file(self):
        with pytest.raises(AttachmentRejected) as raised:
            decode("empty.txt", b"")

        assert "empty" in raised.value.reason

    def test_refuses_a_file_of_only_whitespace(self):
        # Nothing to answer from, and it would otherwise attach "successfully".
        with pytest.raises(AttachmentRejected) as raised:
            decode("blank.txt", b"   \n\n\t  ")

        assert "no readable text" in raised.value.reason

    def test_refuses_a_file_that_is_too_large(self):
        with pytest.raises(AttachmentRejected) as raised:
            decode("huge.txt", b"x" * (3 * 1024 * 1024))

        assert "larger than" in raised.value.reason

    def test_checks_the_size_before_trying_to_decode(self):
        # Decoding 90 MB to discover it is too large is work nobody asked for,
        # and the reason given should be the size rather than the encoding.
        with pytest.raises(AttachmentRejected) as raised:
            decode("huge.bin", b"\xff" * (3 * 1024 * 1024))

        assert "larger than" in raised.value.reason


class TestChunking:
    def test_keeps_a_short_document_in_one_piece(self):
        attachment = Attachment(id="a", name="n.txt", bytes_=10, text="One short paragraph.")

        assert attachment.chunks() == ["One short paragraph."]

    def test_splits_on_blank_lines_rather_than_mid_sentence(self):
        text = "\n\n".join(["para " + "x" * 300 for _ in range(4)])
        chunks = Attachment(id="a", name="n.txt", bytes_=1, text=text).chunks(size=700)

        assert len(chunks) > 1
        # Every chunk is whole paragraphs, so no sentence was severed.
        for chunk in chunks:
            assert chunk.startswith("para ")

    def test_still_splits_a_paragraph_longer_than_the_window(self):
        # Something has to give when one paragraph exceeds the window.
        text = "y" * 2_000
        chunks = Attachment(id="a", name="n.txt", bytes_=1, text=text).chunks(size=800)

        assert len(chunks) == 3
        assert "".join(chunks) == text

    def test_loses_nothing(self):
        text = "alpha\n\nbeta\n\ngamma"
        chunks = Attachment(id="a", name="n.txt", bytes_=1, text=text).chunks(size=10)

        for word in ("alpha", "beta", "gamma"):
            assert any(word in chunk for chunk in chunks)


class TestTheStore:
    def test_holds_and_returns_a_document(self):
        store = AttachmentStore()
        stored = store.add("notes.txt", b"Supplier risk notes.")

        assert store.get(stored.id) is stored

    def test_the_same_document_twice_costs_nothing(self):
        # Content-addressed, so re-attaching is free and the id says nothing
        # about the uploader or the filename.
        store = AttachmentStore()
        first = store.add("a.txt", b"identical")
        second = store.add("b.txt", b"identical")

        assert first.id == second.id
        assert len(store) == 1

    def test_evicts_the_oldest_when_it_runs_out_of_room(self):
        store = AttachmentStore(max_total_bytes=2_000, max_file_bytes=1_000)
        first = store.add("first.txt", b"a" * 900)
        store.add("second.txt", b"b" * 900)
        store.add("third.txt", b"c" * 900)

        assert store.get(first.id) is None
        assert store.total_bytes() <= 2_000

    def test_using_an_attachment_keeps_it(self):
        # An attachment a conversation keeps referring to should not be the one
        # reclaimed, however long ago it was uploaded.
        store = AttachmentStore(max_total_bytes=2_000, max_file_bytes=1_000)
        first = store.add("first.txt", b"a" * 900)
        store.add("second.txt", b"b" * 900)

        store.get(first.id)
        store.add("third.txt", b"c" * 900)

        assert store.get(first.id) is not None

    def test_resolves_what_it_still_holds_and_skips_what_it_does_not(self):
        # An evicted id is not something the person asking can act on, and
        # failing the whole question over it would be worse than answering from
        # the rest.
        store = AttachmentStore()
        stored = store.add("here.txt", b"present")

        assert [item.name for item in store.resolve([stored.id, "gone", ""])] == ["here.txt"]

    def test_rejects_an_oversized_file_without_storing_it(self):
        store = AttachmentStore(max_file_bytes=100)

        with pytest.raises(AttachmentRejected):
            store.add("big.txt", b"x" * 200)
        assert len(store) == 0


class TestAsEvidence:
    # Long enough to chunk. Relevance is chosen per chunk, so a document that
    # fits in one chunk cannot have its irrelevant half filtered out — the
    # granularity of the filter is the granularity of the split, and testing it
    # on two short paragraphs tests nothing.
    NOTES = Attachment(
        id="abc123",
        name="supplier-review.md",
        bytes_=2_000,
        text=(
            "ITAMCO has repeatedly missed delivery windows this quarter. "
            + "Detail about the delivery schedule. " * 20
            + "\n\n"
            + "The office coffee machine is also broken. "
            + "Notes about the kitchen refurbishment. " * 20
        ),
    )

    def test_emits_chunks_the_pipeline_already_understands(self):
        # `chunk` has been a CandidateKind since the model was written and
        # nothing produced one until now.
        candidates = as_candidates([self.NOTES], ["delivery"])

        assert candidates
        assert {candidate.kind for candidate in candidates} == {"chunk"}

    def test_keeps_only_what_the_question_touches(self):
        # A whole document in the prompt is how an attachment stops being
        # evidence and starts being noise.
        candidates = as_candidates([self.NOTES], ["delivery"])

        assert candidates
        assert any("delivery windows" in candidate.text for candidate in candidates)
        assert all("coffee machine" not in candidate.text for candidate in candidates)

    def test_returns_everything_when_there_is_nothing_to_match_on(self):
        # No keywords means no basis for choosing, so the honest answer is the
        # whole document rather than silence.
        everything = as_candidates([self.NOTES], [])
        relevant = as_candidates([self.NOTES], ["delivery"])

        assert len(everything) == len(self.NOTES.chunks())
        assert len(everything) > len(relevant)

    def test_cites_the_document_by_name(self):
        candidate = as_candidates([self.NOTES], ["delivery"])[0]

        assert candidate.source == "supplier-review.md"
        assert candidate.subject_label == "supplier-review.md"

    def test_carries_no_confidence(self):
        # The text is quoted rather than extracted, so there is nothing to be
        # uncertain about — and scoring renormalises over the signals a
        # candidate actually carries, so absent is the honest value.
        candidate = as_candidates([self.NOTES], ["delivery"])[0]

        assert candidate.confidence is None

    def test_is_dated_so_recency_can_rank_it(self):
        candidate = as_candidates([self.NOTES], ["delivery"])[0]

        assert candidate.extracted_at is not None

    def test_survives_a_document_with_nothing_relevant_in_it(self):
        assert as_candidates([self.NOTES], ["zeppelin"]) == []

    def test_produces_distinct_keys_per_chunk(self):
        # Retrieval merges passes on the candidate key; two fragments of one
        # document sharing a key would silently drop evidence.
        candidates = as_candidates([self.NOTES], [])
        keys = [candidate.key() for candidate in candidates]

        assert len(keys) == len(set(keys))


class TestTheEndpoint:
    """Uploading is reported per file, not per batch."""

    def test_accepts_a_document_and_reports_it_ready(self, client):
        response = client.post(
            "/api/attachments",
            files=[("files", ("notes.md", b"Supplier risk notes.", "text/markdown"))],
        )

        assert response.status_code == 200
        [item] = response.json()
        assert item["status"] == "ready"
        assert item["name"] == "notes.md"
        assert item["characters"] == len("Supplier risk notes.")
        assert item["id"]

    def test_a_refusal_is_a_status_not_an_error_code(self, client):
        # Uploading four files where one is a video should attach three and say
        # why the fourth did not, so a rejection cannot be a 4xx.
        response = client.post(
            "/api/attachments",
            files=[
                ("files", ("good.txt", b"readable text", "text/plain")),
                ("files", ("bad.pdf", b"%PDF-1.7", "application/pdf")),
            ],
        )

        assert response.status_code == 200
        statuses = {item["name"]: item["status"] for item in response.json()}
        assert statuses == {"good.txt": "ready", "bad.pdf": "rejected"}

    def test_a_rejection_says_why(self, client):
        response = client.post(
            "/api/attachments",
            files=[("files", ("photo.txt", b"\xff\xd8\xff\xe0JFIF", "text/plain"))],
        )

        [item] = response.json()
        assert item["status"] == "rejected"
        assert "UTF-8" in item["detail"]

    def test_an_uploaded_document_can_then_be_asked_about(self, client, query_body):
        # The whole point: the text has to reach the answer. Before this, the
        # request carried the file name and nothing else.
        upload = client.post(
            "/api/attachments",
            files=[
                (
                    "files",
                    (
                        "review.md",
                        b"ITAMCO has repeatedly missed its delivery windows.",
                        "text/markdown",
                    ),
                )
            ],
        )
        [attached] = upload.json()

        body = {**query_body, "input": {"text": "delivery windows", "files": [attached["id"]]}}
        response = client.post("/api/query", json=body)

        assert response.status_code == 200
        assert "ITAMCO has repeatedly missed its delivery windows." in response.text

    def test_an_unknown_attachment_id_does_not_fail_the_question(self, client, query_body):
        # An evicted id is not something the asker can act on.
        body = {**query_body, "input": {"text": "supplier risk", "files": ["nosuchid"]}}
        response = client.post("/api/query", json=body)

        assert response.status_code == 200
        assert "event: done" in response.text
