"""Turning ranked evidence into something a model can cite.

Facts are numbered so the model has a handle to reference, and the answer is
required to use those handles. That is what makes a citation checkable after
the fact: [2] means the second fact it was given, not a claim about a document
nobody can find.
"""

import re

from ..retrieval.models import Candidate
from ..retrieval.schema import GraphSchema, render_schema_card

#: Matches the inline markers the system prompt asks for: [1], [2, 3], [4][5].
_CITATION = re.compile(r"\[(\d+(?:\s*,\s*\d+)*)\]")


def render_context(candidates: list[Candidate], schema: GraphSchema | None = None) -> str:
    """Numbers the evidence, best first, one fact per line.

    A schema card goes above it when the store could describe itself (item 67).
    It is separated and labelled with some care: the model is told to answer
    only from numbered facts, and the schema is not one — it is background
    about what the graph can express. Left unlabelled, the obvious failure is a
    model citing the schema as evidence, or answering from what the graph
    *could* say rather than what it does.
    """
    lines = []
    for index, candidate in enumerate(candidates, start=1):
        confidence = (
            f" (confidence {candidate.confidence:.2f})" if candidate.confidence is not None else ""
        )
        lines.append(f"[{index}] {candidate.text}{confidence}")

    facts = "\n".join(lines)
    card = render_schema_card(schema) if schema else ""
    if not card:
        return facts

    return f"{card}\n\nFacts retrieved for this question:\n{facts}"


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
