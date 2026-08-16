"""Turning ranked evidence into something a model can cite.

Facts are numbered so the model has a handle to reference, and the answer is
required to use those handles. That is what makes a citation checkable after
the fact: [2] means the second fact it was given, not a claim about a document
nobody can find.
"""

import re

from ..retrieval.models import Candidate

#: Matches the inline markers the system prompt asks for: [1], [2, 3], [4][5].
_CITATION = re.compile(r"\[(\d+(?:\s*,\s*\d+)*)\]")


def render_context(candidates: list[Candidate]) -> str:
    """Numbers the evidence, best first, one fact per line."""
    lines = []
    for index, candidate in enumerate(candidates, start=1):
        confidence = (
            f" (confidence {candidate.confidence:.2f})" if candidate.confidence is not None else ""
        )
        lines.append(f"[{index}] {candidate.text}{confidence}")
    return "\n".join(lines)


def cited_indices(answer: str) -> list[int]:
    """The one-based fact numbers an answer actually referenced, in order."""
    seen: set[int] = set()
    ordered: list[int] = []
    for match in _CITATION.finditer(answer):
        for part in match.group(1).split(","):
            number = int(part.strip())
            if number not in seen:
                seen.add(number)
                ordered.append(number)
    return ordered


def citations_for(answer: str, candidates: list[Candidate]) -> list[Candidate]:
    """The candidates an answer leaned on.

    Only what was cited, so the sources panel reflects the answer rather than
    the retrieval. An answer that cites nothing gets everything it was given:
    that is a prompt or model failure, and hiding the evidence would make it
    harder to see, not better.
    """
    indices = [index for index in cited_indices(answer) if 1 <= index <= len(candidates)]
    if not indices:
        return candidates
    return [candidates[index - 1] for index in indices]
