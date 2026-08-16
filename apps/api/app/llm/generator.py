"""The port every answer generator implements.

Same shape as the retrieval port, for the same reason: the pipeline should not
know whether an answer came from a model or from a fixture, so both can be
exercised by the same tests and the demo can run with no credentials at all.
"""

from collections.abc import AsyncIterator
from typing import Protocol, runtime_checkable

from ..models import Message


@runtime_checkable
class AnswerGenerator(Protocol):
    """Writes an answer from a question and the evidence for it."""

    name: str

    async def stream(
        self,
        question: str,
        context: str,
        history: list[Message],
        usage: dict[str, int],
    ) -> AsyncIterator[str]:
        """Yields answer fragments, filling `usage` when the source reports it."""
        ...
