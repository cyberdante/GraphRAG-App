"""A plain extractor, so the port has something behind it out of the box.

This exists to make the loop runnable with nothing configured — no key, no
model, no network — in the same way the fixture store and the fixture generator
do. It is deliberately simple, and the simplicity is the point: a reader can see
exactly what it does in one sitting, and a deployment that needs better replaces
it without touching anything else.

How it works: a sentence is a candidate when it contains the readable form of a
relationship the domain declares. "ITAMCO supplies Component A" contains
"supplies", which the vocabulary maps to SUPPLIES, so the spans either side
become the subject and the object. Nothing is invented that the vocabulary has
not declared, which is a real property — this extractor cannot propose a
relationship the graph has no term for.

What it cannot do, stated because a reviewer needs to know what they are
checking rather than discovering it from a wrong answer:

- **Negation.** "ITAMCO does not supply Component A" proposes that ITAMCO
  supplies Component A. This is the clearest reason the review step is not
  optional.
- **Coreference.** "They also ship to Rotterdam" has no subject it can resolve.
- **Anything implied rather than written.** It matches surface forms, so a
  document that conveys a relationship without naming it conveys nothing here.

Its confidence is one flat number for every proposal, because it genuinely
cannot tell them apart. A spread that is not measuring anything is worse than a
constant: a reviewer will sort by it and believe the order means something.
"""

from __future__ import annotations

import re

from ..domains import Domain
from .models import Extraction, Proposal

#: What a pattern match is worth. Low, and the same for everything, because this
#: extractor has no way to distinguish a clean sentence from a mangled one.
REFERENCE_CONFIDENCE = 0.4

#: Sentence-ish. Splitting properly needs an abbreviation list this does not
#: have, and over-splitting costs a proposal rather than inventing one.
_SENTENCE = re.compile(r"(?<=[.!?])\s+|\n+")

#: A name as documents write them: capitalised words, possibly several, possibly
#: with a digit or a hash in them the way an identifier is written.
_NAME = re.compile(r"([A-Z][\w&.'-]*(?:\s+(?:[A-Z][\w&.'-]*|#?\d[\w-]*))*)")


def readable_forms(domain: Domain) -> dict[str, str]:
    """Each declared predicate, mapped from the phrase a document would use.

    Built from the vocabulary rather than from a list here, so a domain that
    declares a new relationship gains extraction for it without this file
    changing — and so this extractor cannot propose a term the graph has never
    heard of.
    """
    forms: dict[str, str] = {}
    for term, local in domain.properties.items():
        # HAS_RISK -> "has risk"; suppliesTo -> "supplies to".
        spaced = re.sub(r"(?<!^)(?=[A-Z])", " ", local).replace("_", " ").lower()
        forms[spaced] = term
        forms[term.replace("_", " ").lower()] = term
    return forms


class ReferenceExtractor:
    """Proposes statements by matching the vocabulary's own words."""

    name = "reference"
    description = "Pattern match against the declared vocabulary. No model, no network."

    def __init__(self, domain: Domain) -> None:
        self._domain = domain
        # Longest first: "has signal" must win over "has" if a domain ever
        # declares both, or the shorter phrase eats the longer one's sentences.
        self._forms = sorted(readable_forms(domain).items(), key=lambda pair: -len(pair[0]))

    async def extract(self, text: str, source: str) -> Extraction:
        proposals: list[Proposal] = []
        skipped = 0

        for sentence in (part.strip() for part in _SENTENCE.split(text)):
            if not sentence:
                continue

            proposal = self._from_sentence(sentence, source)
            if proposal is None:
                skipped += 1
            else:
                proposals.append(proposal)

        return Extraction(
            source=source,
            proposals=proposals,
            skipped=skipped,
            extractor=self.name,
        )

    def _from_sentence(self, sentence: str, source: str) -> Proposal | None:
        lowered = sentence.lower()

        for phrase, term in self._forms:
            position = lowered.find(phrase)
            if position < 0:
                continue

            subject = _trailing_name(sentence[:position])
            obj = _leading_name(sentence[position + len(phrase) :])
            if not subject or not obj:
                continue

            return Proposal(
                subject=subject,
                predicate=term,
                object=obj,
                quote=sentence,
                source=source,
                confidence=REFERENCE_CONFIDENCE,
            )
        return None


def _trailing_name(text: str) -> str | None:
    """The last capitalised span before the relationship phrase."""
    matches = _NAME.findall(text.strip())
    return _tidy(matches[-1]) if matches else None


def _leading_name(text: str) -> str | None:
    """The first capitalised span after it."""
    match = _NAME.search(text.strip())
    return _tidy(match.group(1)) if match else None


def _tidy(name: str) -> str | None:
    """Trims the sentence's punctuation off the end of a name.

    The name pattern allows a full stop so that "Ltd." and "Inc." survive, which
    means it also swallows the one ending the sentence. Left in, "Component A."
    and "Component A" are two different names and therefore two different
    proposal ids — so the same statement, written once with a full stop and once
    without, would arrive twice and be reviewed twice.
    """
    trimmed = name.strip().rstrip(".,;:")
    return trimmed or None
