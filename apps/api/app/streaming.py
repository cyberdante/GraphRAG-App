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
from .fixtures import answer_for
from .models import (
    DeltaPayload,
    DonePayload,
    ErrorPayload,
    QueryRequest,
    StatusPayload,
    UsagePayload,
)
from .ontology import graph_to_jsonld
from .retrieval import scoring
from .retrieval.graph_frame import graph_from_candidates
from .retrieval.models import RetrievalRequest
from .retrieval.registry import BackendRegistry

logger = logging.getLogger(__name__)


def _graph_payload(graph: object) -> dict:
    """A graph frame carries its JSON-LD so an export needs no second request."""
    payload = graph.model_dump(exclude_none=True)  # type: ignore[attr-defined]
    payload["jsonLD"] = graph_to_jsonld(graph)  # type: ignore[arg-type]
    return payload


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
    registry: BackendRegistry,
) -> AsyncGenerator[str, None]:
    """Yield the full event sequence for one query.

    The contract, in order: `status`, one or more `graph`, many `delta`, then a
    single `done`. Any failure ends the stream with `error` instead.
    """
    try:
        max_nodes = request.retrieval.graph.max_nodes
        query_text = request.input.text

        # Raises before the stream opens if the backend is unknown, so the
        # caller gets a 400 rather than an error frame mid-answer.
        store = registry.get(request.retrieval.backend)

        yield frame(
            "status",
            StatusPayload(
                phase="retrieval",
                message=f"Querying knowledge graph via {store.name}...",
            ),
        )
        await asyncio.sleep(settings.fixture_token_delay * 4)

        keywords = scoring.extract_keywords(query_text)
        top_k = min(request.retrieval.top_k or settings.top_k_default, settings.top_k_max)

        candidates = await store.retrieve(
            RetrievalRequest(
                query=query_text,
                keywords=keywords,
                max_candidates=settings.max_candidates,
                max_nodes=max_nodes,
                max_hops=request.retrieval.graph.max_hops,
                entity_types=request.retrieval.graph.entity_types,
                top_k=top_k,
            )
        )

        # A first frame from what came back unranked, so the visualization has
        # something to draw while ranking runs.
        yield frame(
            "graph",
            _graph_payload(graph_from_candidates(candidates, max_nodes=min(8, max_nodes))),
        )
        await asyncio.sleep(settings.fixture_token_delay * 6)

        yield frame(
            "status",
            StatusPayload(
                phase="processing",
                message=f"Ranking {len(candidates)} candidates...",
            ),
        )

        scoring.score_candidates(
            candidates,
            keywords,
            weight_relevancy=settings.weight_relevancy,
            weight_confidence=settings.weight_confidence,
            weight_recency=settings.weight_recency,
            recency_half_life_days=settings.recency_half_life_days,
        )
        top = scoring.rerank(
            candidates,
            top_k=top_k,
            same_subject_penalty=settings.same_subject_penalty,
            same_source_penalty=settings.same_source_penalty,
        )
        logger.debug("ranked %d candidates, kept %d", len(candidates), len(top))

        # The graph the user sees is the evidence the answer stands on, not a
        # separate query that could disagree with it.
        yield frame("graph", _graph_payload(graph_from_candidates(top, max_nodes=max_nodes)))
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
