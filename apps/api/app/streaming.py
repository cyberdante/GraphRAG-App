"""Server-Sent Events plumbing.

One helper turns a payload into a wire frame; one generator produces the whole
answer for a query. When Sprint 2 replaces fixtures with Bedrock and Neptune,
only `stream_answer` changes — the frames stay identical.
"""

import asyncio
import json
import logging
from collections.abc import AsyncGenerator

from .config import Settings
from .fixtures import SUPPLY_CHAIN_GRAPH, answer_for, graph_to_jsonld, subgraph
from .models import (
    DeltaPayload,
    DonePayload,
    ErrorPayload,
    QueryRequest,
    StatusPayload,
    UsagePayload,
)

logger = logging.getLogger(__name__)


def frame(event: str, data: object) -> str:
    """One SSE frame. `data` is JSON on a single line, per the spec."""
    if hasattr(data, "model_dump"):
        payload = data.model_dump(exclude_none=True)  # type: ignore[attr-defined]
    else:
        payload = data
    return f"event: {event}\ndata: {json.dumps(payload, separators=(',', ':'))}\n\n"


async def stream_answer(
    request: QueryRequest,
    settings: Settings,
) -> AsyncGenerator[str, None]:
    """Yield the full event sequence for one query.

    The contract, in order: `status`, one or more `graph`, many `delta`, then a
    single `done`. Any failure ends the stream with `error` instead.
    """
    try:
        max_nodes = request.retrieval.graph.max_nodes
        query_text = request.input.text

        yield frame(
            "status",
            StatusPayload(phase="retrieval", message="Querying knowledge graph..."),
        )
        await asyncio.sleep(settings.fixture_token_delay * 8)

        # A first pass at the subgraph, so the visualization has something to
        # draw while the rest of the retrieval runs.
        partial = subgraph(min(8, max_nodes))
        yield frame("graph", {**partial.model_dump(exclude_none=True), "jsonLD": graph_to_jsonld(partial)})
        await asyncio.sleep(settings.fixture_token_delay * 6)

        yield frame(
            "status",
            StatusPayload(phase="processing", message="Analyzing relationships..."),
        )

        full = subgraph(max_nodes) if max_nodes < len(SUPPLY_CHAIN_GRAPH.nodes) else SUPPLY_CHAIN_GRAPH
        yield frame("graph", {**full.model_dump(exclude_none=True), "jsonLD": graph_to_jsonld(full)})
        await asyncio.sleep(settings.fixture_token_delay * 4)

        yield frame(
            "status",
            StatusPayload(phase="generation", message="Generating response..."),
        )

        text, citations = answer_for(query_text)

        # Emit increments, not a running total — the same way ConverseStream
        # will once it is wired in.
        chunks = text.split(" ")
        for index, chunk in enumerate(chunks):
            piece = chunk if index == 0 else f" {chunk}"
            yield frame("delta", DeltaPayload(text=piece))
            if settings.fixture_token_delay:
                await asyncio.sleep(settings.fixture_token_delay)

        # Rough stand-in until real usage comes back from Bedrock.
        prompt_words = sum(len(message.content.split()) for message in request.messages)
        yield frame(
            "done",
            DonePayload(
                usage=UsagePayload(
                    input_tokens=int(prompt_words * 1.3),
                    output_tokens=int(len(chunks) * 1.2),
                ),
                citations=citations,
            ),
        )

    except asyncio.CancelledError:
        # The client hung up or pressed Stop. Nothing to report.
        logger.info("stream cancelled by client for conversation %s", request.conversation_id)
        raise
    except Exception:
        logger.exception("stream failed for conversation %s", request.conversation_id)
        yield frame(
            "error",
            ErrorPayload(
                code="stream_failed",
                message="The query could not be completed. Please try again.",
            ),
        )
