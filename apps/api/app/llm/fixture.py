"""The offline generator: canned answers, no credentials, no network.

Implements the same port as the model-backed generator, so the pipeline runs
end to end with nothing configured. That is what lets the public demo work in
five seconds and the tests assert behaviour rather than mocks.
"""

import asyncio
from collections.abc import AsyncIterator

from ..fixtures import answer_for
from ..models import Message


class FixtureAnswerGenerator:
    name = "fixtures"
    model_name = "fixtures"

    def __init__(self, token_delay: float = 0.0) -> None:
        self._token_delay = token_delay

    async def stream(
        self,
        question: str,
        context: str,
        history: list[Message],
        usage: dict[str, int],
    ) -> AsyncIterator[str]:
        del context  # the canned answers were written without one
        text, _ = answer_for(question)
        words = text.split(" ")

        for index, word in enumerate(words):
            yield word if index == 0 else f" {word}"
            if self._token_delay:
                await asyncio.sleep(self._token_delay)

        prompt_words = sum(len(message.content.split()) for message in history)
        usage["input_tokens"] = int(prompt_words * 1.3)
        usage["output_tokens"] = int(len(words) * 1.2)
