"""Server-Sent Events plumbing.

One helper turns a payload into a wire frame; one generator produces the whole
answer for a query. When Sprint 2 replaces fixtures with Bedrock and Neptune,
only `stream_answer` changes — the frames stay identical.
"""

import asyncio
import json
import logging
from collections.abc import AsyncGenerator

from . import domains
from .attachments import Attachment, AttachmentStore
from .attachments import as_candidates as attachment_candidates
from .config import Settings
from .fetching import FetchRejected
from .fetching import fetch as fetch_url
from .llm.context import citations_for, render_context
from .llm.generator import AnswerGenerator
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
from .retrieval.graph_frame import graph_from_candidates, grounded_in
from .retrieval.models import RetrievalRequest
from .retrieval.registry import BackendRegistry
from .retrieval.schema import with_declared

logger = logging.getLogger(__name__)


def _graph_payload(graph: object, domain: domains.Domain) -> dict:
    """A graph frame carries its JSON-LD so an export needs no second request.

    The domain is passed rather than defaulted: an export names the vocabulary
    it is written in, and a deployment holding clinical trials must not hand out
    a document claiming to be supply chain.
    """
    payload = graph.model_dump(exclude_none=True)  # type: ignore[attr-defined]
    payload["jsonLD"] = graph_to_jsonld(graph, domain)  # type: ignore[arg-type]
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
    generator: AnswerGenerator,
    attachments: AttachmentStore | None = None,
) -> AsyncGenerator[str, None]:
    """Yield the full event sequence for one query.

    The contract, in order: `status`, one or more `graph`, many `delta`, then a
    single `done`. Any failure ends the stream with `error` instead.
    """
    try:
        domain = domains.get(settings.default_domain)
        max_nodes = request.retrieval.graph.max_nodes
        query_text = request.input.text

        # The fixture path paces itself so the demo reads like a live pipeline.
        # A real one has its own latency and needs no help; adding these delays
        # would inflate every phase in the trace panel with invented work.
        pacing = settings.fixture_token_delay if generator.name == "fixtures" else 0.0

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
        await asyncio.sleep(pacing * 4)

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
                entity_ids=request.input.entityIds or [],
                top_k=top_k,
            )
        )

        # Attached documents join the same candidate pool as the graph, so they
        # go through the same scoring, the same rerank and the same citation
        # numbering. Appended rather than prepended: an attachment does not
        # outrank the graph by virtue of being attached, it competes.
        notes: list[str] = []
        attached = attachments.resolve(request.input.files or []) if attachments else []
        if attached:
            candidates.extend(attachment_candidates(attached, keywords))

        # Pages a question was asked about, fetched under the SSRF guard in
        # `fetching.py`. A URL that cannot be fetched is reported and skipped
        # rather than failing the question: the graph can usually still answer,
        # and a refusal is more useful attached to the answer than instead of it.
        for url in (request.input.urls or [])[: settings.max_urls_per_query]:
            try:
                page = await fetch_url(url)
            except FetchRejected as rejected:
                logger.info("Refused URL %r: %s", rejected.url, rejected.reason)
                notes.append(f"{rejected.url} was not fetched: {rejected.reason}")
                continue

            candidates.extend(
                attachment_candidates(
                    [
                        Attachment(
                            id=page.url, name=page.title, bytes_=len(page.text), text=page.text
                        )
                    ],
                    keywords,
                )
            )

        # A first frame from what came back unranked, so the visualization has
        # something to draw while ranking runs.
        yield frame(
            "graph",
            _graph_payload(graph_from_candidates(candidates, max_nodes=min(8, max_nodes)), domain),
        )
        await asyncio.sleep(pacing * 6)

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
        # separate query that could disagree with it. The frame is built first
        # and the evidence narrowed to what it holds, so the prompt, the
        # citations and the drawing all describe the same set.
        graph = graph_from_candidates(top, max_nodes=max_nodes)
        top = grounded_in(graph, top)
        yield frame("graph", _graph_payload(graph, domain))
        await asyncio.sleep(pacing * 4)

        yield frame(
            "status",
            StatusPayload(phase="generation", message="Generating response..."),
        )

        # The evidence, numbered so the model has a handle to cite.
        # Asked of the store, not compiled in: a deployment's graph is whatever
        # it points at, and a service that assumes our six classes describes
        # someone else's data wrongly. Failure here costs the card, not the
        # answer — retrieval already worked.
        try:
            graph_schema = with_declared(await store.schema(), domain.shapes)
        except Exception:
            logger.warning("Could not read the schema from %s.", store.name, exc_info=True)
            graph_schema = None

        context = render_context(top, graph_schema)
        usage: dict[str, int] = {}
        answer = ""

        async for piece in generator.stream(query_text, context, request.messages, usage):
            answer += piece
            yield frame("delta", DeltaPayload(text=piece))

        # A reasoning model can spend the entire token budget thinking and
        # return no text at all — the stream succeeds, usage looks healthy, and
        # the user gets an empty bubble. Say what happened instead.
        if not answer.strip():
            logger.warning(
                "empty answer from %s; %s output tokens spent",
                generator.name,
                usage.get("output_tokens", 0),
            )
            yield frame(
                "error",
                ErrorPayload(
                    code="empty_answer",
                    message=(
                        "The model returned no text. It likely spent the whole "
                        "token budget reasoning — raise RAGSTONE_ANSWER_MAX_TOKENS "
                        "and try again."
                    ),
                ),
            )
            return

        # Citations come from what the answer actually cited, so the sources
        # panel reflects the answer rather than the retrieval.
        cited = citations_for(answer, top)
        yield frame(
            "done",
            DonePayload(
                usage=UsagePayload(
                    input_tokens=usage.get("input_tokens", 0),
                    output_tokens=usage.get("output_tokens", 0),
                ),
                citations=[
                    candidate.to_citation(index) for index, candidate in enumerate(cited, start=1)
                ],
                # Who actually did the work, so the trace panel reports fact
                # rather than inferring it from the shape of the response.
                model=getattr(generator, "model_name", generator.name),
                backend=store.name,
                candidates=len(candidates),
                notes=notes or None,
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
