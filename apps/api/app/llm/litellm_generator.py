"""Answers from a model, through litellm.

One interface covers Anthropic, OpenAI and Bedrock, which is what the
bring-your-own-key panel needs: a tenant picks a provider and the call site does
not change. The cost is an abstraction between us and each provider's own SDK —
a deliberate trade for provider neutrality, not an oversight.

litellm is imported lazily so the service starts, and the test suite runs,
without it installed. Nothing but this module depends on it.
"""

import logging
from collections.abc import AsyncIterator

from ..models import Message

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """\
You answer questions using only the numbered facts provided as context.

Every claim you make must be grounded in those facts, and you cite them inline
like [1] or [2, 3]. If the facts do not support an answer, say so plainly rather
than filling the gap — an honest "the graph does not contain this" is more
useful than a confident guess.

Write in markdown. Be direct: lead with the answer, then the supporting detail."""


class LiteLLMAnswerGenerator:
    """Streams an answer from whichever provider the deployment configured."""

    name = "model"

    def __init__(
        self,
        *,
        model: str,
        api_key: str | None = None,
        max_tokens: int = 4096,
        timeout: float = 60.0,
        temperature: float | None = None,
    ) -> None:
        self._model = model
        #: Reported in the done frame so the trace panel names the real model.
        self.model_name = model
        self._api_key = api_key
        self._max_tokens = max_tokens
        self._timeout = timeout
        self._temperature = temperature

    def _build_messages(
        self, question: str, context: str, history: list[Message]
    ) -> list[dict[str, str]]:
        """System prompt, prior turns, then the question with its evidence.

        Earlier turns are included so follow-ups resolve ("what about the second
        one?"), but the evidence rides with the current question rather than
        being restated per turn.
        """
        messages: list[dict[str, str]] = [{"role": "system", "content": SYSTEM_PROMPT}]

        # The final user message is this turn's question; it is rebuilt below
        # with the context attached, so it is dropped here.
        for message in history[:-1]:
            if message.role in {"user", "assistant"} and message.content:
                messages.append({"role": message.role, "content": message.content})

        messages.append(
            {
                "role": "user",
                "content": f"Facts:\n{context}\n\nQuestion: {question}",
            }
        )
        return messages

    def _request_kwargs(self) -> dict[str, object]:
        kwargs: dict[str, object] = {
            "model": self._model,
            "max_tokens": self._max_tokens,
            "timeout": self._timeout,
            "stream": True,
            # Ask for usage on the final chunk; without this most providers
            # stream tokens and report nothing.
            "stream_options": {"include_usage": True},
        }
        if self._api_key:
            kwargs["api_key"] = self._api_key

        # Sampling parameters are omitted unless a deployment asks for them.
        # The Claude 5 family rejects `temperature` outright with a 400, so
        # sending a default would break the recommended model rather than
        # tuning it.
        if self._temperature is not None:
            kwargs["temperature"] = self._temperature

        return kwargs

    async def stream(
        self,
        question: str,
        context: str,
        history: list[Message],
        usage: dict[str, int],
    ) -> AsyncIterator[str]:
        import litellm  # lazy: keeps the dependency optional

        response = await litellm.acompletion(
            messages=self._build_messages(question, context, history),
            **self._request_kwargs(),
        )

        async for chunk in response:
            chunk_usage = getattr(chunk, "usage", None)
            if chunk_usage:
                usage["input_tokens"] = getattr(chunk_usage, "prompt_tokens", 0) or 0
                usage["output_tokens"] = getattr(chunk_usage, "completion_tokens", 0) or 0

            choices = getattr(chunk, "choices", None)
            if not choices:
                continue
            delta = getattr(choices[0], "delta", None)
            text = getattr(delta, "content", None) if delta else None
            if text:
                yield text
