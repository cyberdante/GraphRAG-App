"""Files a question is asked about.

Attachments were collected and thrown away: the composer read the bytes, the
request carried the file *names*, and nothing downstream ever saw the contents.
A question about an attached document was answered from the graph alone, which
is worse than refusing the attachment — it looks like it worked.

Three decisions worth stating, because each rules out a more obvious approach.

**Nothing is written to disk.** Uploads live in memory, capped, with the oldest
evicted first. A demo that writes user files to a temp directory acquires a
cleanup problem, a permissions problem and a disclosure problem, in exchange for
surviving a restart that nobody needs it to survive. The cost is that this is
per-process: run several workers and an upload may land on one and be asked for
on another. That is a real limitation of this design and the reason a deployment
that meant it would use object storage.

**The type allowlist is by content, not by name.** A `.txt` extension is a
claim, not a fact. What matters is whether the bytes decode as text, so that is
what is checked; the extension only decides whether it is worth trying.

**Failures are per file.** Uploading four documents where one is a 90 MB video
should attach three and say why the fourth did not, rather than rejecting the
batch.
"""

from __future__ import annotations

import hashlib
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import UTC, datetime

from .retrieval import scoring
from .retrieval.models import Candidate

#: Per file. Large enough for a contract or a report, small enough that a
#: mis-click does not evict everything else in the store.
MAX_FILE_BYTES = 2 * 1024 * 1024

#: Across every attachment held. The oldest go when a new one does not fit.
MAX_TOTAL_BYTES = 16 * 1024 * 1024

#: Extensions worth attempting to decode. Not a security boundary — the decode
#: below is — but it avoids reading a 2 MB binary to discover it is binary.
TEXT_SUFFIXES = frozenset({".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".log", ".rst"})

#: How much of one document reaches the prompt, per chunk.
CHUNK_CHARS = 800


class AttachmentRejected(ValueError):
    """Why one file could not be attached, in words a person can act on."""

    def __init__(self, name: str, reason: str) -> None:
        self.name = name
        self.reason = reason
        super().__init__(f"{name}: {reason}")


@dataclass
class Attachment:
    id: str
    name: str
    bytes_: int
    text: str
    uploaded_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    @property
    def characters(self) -> int:
        return len(self.text)

    def chunks(self, size: int = CHUNK_CHARS) -> list[str]:
        """Splits on blank lines first, so a paragraph is not cut mid-sentence.

        A fixed character window is simpler and worse: it reliably severs the
        one sentence that answered the question. Paragraphs that are themselves
        longer than the window still get cut, because something has to be.
        """
        paragraphs = [block.strip() for block in self.text.split("\n\n") if block.strip()]

        chunks: list[str] = []
        current = ""
        for paragraph in paragraphs:
            if len(paragraph) > size:
                if current:
                    chunks.append(current)
                    current = ""
                chunks.extend(
                    paragraph[start : start + size] for start in range(0, len(paragraph), size)
                )
                continue

            if len(current) + len(paragraph) + 2 > size and current:
                chunks.append(current)
                current = paragraph
            else:
                current = f"{current}\n\n{paragraph}" if current else paragraph

        if current:
            chunks.append(current)
        return chunks


def decode(name: str, raw: bytes) -> str:
    """The bytes as text, or a refusal that says why.

    Checked in this order on purpose: size before decode, because decoding 90 MB
    to discover it is too large is work nobody asked for; and decode before
    trusting the extension, because the extension is a claim.
    """
    if not raw:
        raise AttachmentRejected(name, "the file is empty")

    if len(raw) > MAX_FILE_BYTES:
        limit = MAX_FILE_BYTES // (1024 * 1024)
        raise AttachmentRejected(name, f"larger than {limit} MB")

    suffix = name[name.rfind(".") :].lower() if "." in name else ""
    if suffix not in TEXT_SUFFIXES:
        allowed = ", ".join(sorted(TEXT_SUFFIXES))
        raise AttachmentRejected(name, f"unsupported type — this service reads {allowed}")

    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise AttachmentRejected(
            name, "not valid UTF-8 text, whatever the extension says"
        ) from None

    # A NUL byte decodes happily and means the file is not really text.
    if "\x00" in text:
        raise AttachmentRejected(name, "not valid UTF-8 text, whatever the extension says")

    if not text.strip():
        raise AttachmentRejected(name, "contains no readable text")

    return text


class AttachmentStore:
    """Attachments held in memory, oldest evicted first."""

    def __init__(
        self,
        max_total_bytes: int = MAX_TOTAL_BYTES,
        max_file_bytes: int = MAX_FILE_BYTES,
    ) -> None:
        self._items: OrderedDict[str, Attachment] = OrderedDict()
        self._max_total = max_total_bytes
        self._max_file = max_file_bytes

    def add(self, name: str, raw: bytes) -> Attachment:
        if len(raw) > self._max_file:
            limit = self._max_file // (1024 * 1024)
            raise AttachmentRejected(name, f"larger than {limit} MB")

        text = decode(name, raw)

        # Content-addressed, so attaching the same document twice costs nothing
        # and the id says nothing about the uploader or the filename.
        identifier = hashlib.sha256(raw).hexdigest()[:16]
        attachment = Attachment(id=identifier, name=name, bytes_=len(raw), text=text)

        self._items.pop(identifier, None)
        self._items[identifier] = attachment
        self._evict()
        return attachment

    def get(self, identifier: str) -> Attachment | None:
        item = self._items.get(identifier)
        if item is not None:
            # Asking for it counts as using it, so an attachment a conversation
            # keeps referring to is not the one reclaimed.
            self._items.move_to_end(identifier)
        return item

    def resolve(self, identifiers: list[str]) -> list[Attachment]:
        """The attachments still held, in the order asked for.

        Silently skips what is gone. An id that has been evicted is not an
        error the person asking can do anything about, and failing the whole
        question because one attachment expired would be worse than answering
        from the rest.
        """
        found = [self.get(identifier) for identifier in identifiers]
        return [item for item in found if item is not None]

    def total_bytes(self) -> int:
        return sum(item.bytes_ for item in self._items.values())

    def _evict(self) -> None:
        while self.total_bytes() > self._max_total and len(self._items) > 1:
            self._items.popitem(last=False)

    def __len__(self) -> int:
        return len(self._items)


def as_candidates(attachments: list[Attachment], keywords: list[str]) -> list[Candidate]:
    """Attached documents, as evidence the pipeline already knows how to rank.

    Emitted as `chunk` candidates, which the `Candidate` model has carried since
    it was written and nothing has produced until now. They then go through the
    same scoring, the same rerank and the same citation numbering as a statement
    from the graph — so an answer can cite a document and the graph in one
    breath, and the person reading it can see which is which from the source.

    Only chunks that match something in the question are returned. A whole
    document dumped into the prompt is how an attachment stops being evidence
    and starts being noise: sixty statements ranked against two hundred
    paragraphs of unrelated contract text is a worse answer than no attachment
    at all.
    """
    candidates: list[Candidate] = []

    for attachment in attachments:
        for index, chunk in enumerate(attachment.chunks()):
            relevancy = scoring.overlap_relevancy(keywords, chunk)
            if keywords and relevancy <= 0:
                continue

            candidates.append(
                Candidate(
                    kind="chunk",
                    text=chunk,
                    # The document is the subject, so a citation points at the
                    # file rather than at an anonymous fragment.
                    subject=f"attachment:{attachment.id}",
                    predicate="mentions",
                    object=f"attachment:{attachment.id}#{index}",
                    subject_label=attachment.name,
                    object_label=f"{attachment.name} (part {index + 1})",
                    subject_type="Document",
                    object_type="Document",
                    source=attachment.name,
                    # No confidence: the text is quoted rather than extracted, so
                    # there is nothing to be uncertain about. Scoring
                    # renormalises over the signals a candidate actually
                    # carries, so absent is the honest value.
                    extracted_at=attachment.uploaded_at,
                    relevancy=relevancy,
                )
            )

    return candidates
