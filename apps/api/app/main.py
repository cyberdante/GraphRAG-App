import logging
import time

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, StreamingResponse

from . import domains, ontology
from .attachments import AttachmentRejected, AttachmentStore
from .config import Settings, get_settings
from .extraction import commit as extraction_commit
from .extraction import registry as extraction_registry
from .extraction.models import Proposal, ProposalStatus
from .extraction.review import ReviewQueue
from .llm.generator import AnswerGenerator
from .llm.registry import build_generator
from .models import (
    AttachmentInfo,
    BackendInfo,
    CommitRefusal,
    CommitRequest,
    CommitResult,
    CommittedStatement,
    DomainInfo,
    ExtractionResult,
    GraphQueryRequest,
    GraphQueryResult,
    ProposalDecision,
    ProposalInfo,
    QueryPresetInfo,
    QueryRequest,
)
from .retrieval.query_guard import QueryRejected
from .retrieval.registry import BackendRegistry, build_registry
from .retrieval.store import UnknownBackendError
from .streaming import stream_answer

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

#: One store for the process, deliberately not per request. Attachments outlive
#: the upload that created them — a question is asked about them afterwards —
#: and holding them in memory means nothing lands on disk. Per-process is the
#: trade: with several workers an upload may land on one and be asked for on
#: another. A deployment that meant it would use object storage.
attachment_store = AttachmentStore()
#: Proposals waiting for a person. In memory and per process, with the same
#: limitation the attachment store states: a deployment that meant it would put
#: these in a database.
review_queue = ReviewQueue()

app = FastAPI(
    title="Ragstone API",
    version="0.1.0",
    description="Streams answers grounded in a knowledge graph.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_registry(settings: Settings = Depends(get_settings)) -> BackendRegistry:
    """Built from the settings this request resolved.

    Deliberately not cached on the module: an lru_cache reading the global
    settings ignores dependency overrides, so tests silently exercised the
    deployment's configuration instead of their own. Both objects are cheap
    to construct and hold no connection state.
    """
    return build_registry(settings)


def get_generator(settings: Settings = Depends(get_settings)) -> AnswerGenerator:
    """Falls back to fixtures when the deployment has no credentials."""
    return build_generator(settings)


@app.get("/health")
async def health(
    settings: Settings = Depends(get_settings),
    registry: BackendRegistry = Depends(get_registry),
    generator: AnswerGenerator = Depends(get_generator),
) -> dict[str, object]:
    return {
        "status": "ok",
        "environment": settings.environment,
        "backends": registry.names(),
        "default_backend": registry.default,
        "answers": generator.name,
    }


@app.get("/api/backends", response_model=list[BackendInfo])
async def backends(registry: BackendRegistry = Depends(get_registry)) -> list[BackendInfo]:
    """The retrieval backends a request may name.

    Exposed so the UI can offer them without hardcoding a list that would drift
    from what the deployment actually has.
    """
    return [
        BackendInfo(
            name=store.name,
            description=store.description,
            default=store.name == registry.default,
            queryable=hasattr(store, "run_readonly"),
        )
        for store in registry.available()
    ]


@app.get("/api/domains", response_model=list[DomainInfo])
async def list_domains(settings: Settings = Depends(get_settings)) -> list[DomainInfo]:
    """The subjects this deployment can hold a graph about.

    Offered so the console takes its entity types from what the deployment
    declares rather than from the keys of its own colour map — which is how a
    type came to exist because somebody had given it a colour.
    """
    return [
        DomainInfo(
            id=domain.id,
            label=domain.label,
            version=domain.version,
            classes=list(domain.classes),
            starters=list(domain.starters),
            presets=[
                QueryPresetInfo(
                    label=preset.label,
                    description=preset.description,
                    language=preset.language,
                    query=preset.query,
                )
                for preset in domain.presets
            ],
            ontology=domain.ontology_path,
            default=domain.id == settings.default_domain,
        )
        for domain in domains.DOMAINS.values()
    ]


def _as_info(proposal: Proposal) -> ProposalInfo:
    return ProposalInfo(
        id=proposal.id,
        subject=proposal.subject,
        predicate=proposal.predicate,
        object=proposal.object,
        quote=proposal.quote,
        source=proposal.source,
        subject_type=proposal.subject_type,
        object_type=proposal.object_type,
        confidence=proposal.confidence,
        status=str(proposal.status),
        note=proposal.note,
    )


# Under /documents/ rather than at /api/extraction/{id} directly: a single
# path segment collides with every literal route beside it, and it did —
# /api/extraction/commit was read as an attachment called "commit" and answered
# 404 from the wrong handler. Declaration order would have fixed that instance
# and left the next one waiting.
@app.post("/api/extraction/documents/{attachment_id}", response_model=ExtractionResult)
async def propose_statements(
    attachment_id: str,
    settings: Settings = Depends(get_settings),
) -> ExtractionResult:
    """Read an uploaded document and propose statements, asserting none.

    Nothing here reaches the graph. Extraction proposes and a person disposes,
    which is not ceremony: a model reading a contract will assert things the
    contract does not say, and a graph that accepts them quietly is worse than
    no graph — every answer built on it inherits the error while still citing a
    source.

    Re-reading a document is safe. Proposal ids come from their content, so a
    second run collides with the decisions already made rather than reopening
    them.
    """
    attachment = attachment_store.get(attachment_id)
    if attachment is None:
        raise HTTPException(
            status_code=404,
            detail=(
                "No such attachment. Uploads are held in memory and the oldest are "
                "evicted, so one from an earlier session may be gone."
            ),
        )

    domain = domains.get(settings.default_domain)
    extractor = extraction_registry.build(settings, domain)
    extraction = await extractor.extract(attachment.text, attachment.name)
    queued = review_queue.add(extraction)

    return ExtractionResult(
        source=extraction.source,
        proposals=[_as_info(proposal) for proposal in queued],
        skipped=extraction.skipped,
        extractor=extraction.extractor,
    )


@app.get("/api/extraction", response_model=list[ProposalInfo])
async def list_proposals(status: str | None = None) -> list[ProposalInfo]:
    """Everything waiting for a person, or everything in one state."""
    if status is None:
        proposals = review_queue.all()
    elif status == "proposed":
        proposals = review_queue.pending()
    elif status == "accepted":
        proposals = review_queue.accepted()
    else:
        proposals = [p for p in review_queue.all() if str(p.status) == status]

    return [_as_info(proposal) for proposal in proposals]


@app.post("/api/extraction/proposals/{proposal_id}", response_model=ProposalInfo)
async def decide_proposal(proposal_id: str, decision: ProposalDecision) -> ProposalInfo:
    """Accept or reject one proposal.

    Accepting does not write to the graph yet — committing accepted statements
    is a separate step with a separate set of failure modes, chiefly resolving
    "ITAMCO" to a node that may or may not already exist. Saying so here rather
    than implying otherwise: an endpoint named accept that silently wrote would
    make the review a formality.
    """
    updated = review_queue.decide(
        proposal_id,
        ProposalStatus(decision.status),
        decision.note,
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="No such proposal.")

    return _as_info(updated)


@app.post("/api/extraction/commit", response_model=CommitResult)
async def commit_proposals(
    request: CommitRequest,
    settings: Settings = Depends(get_settings),
    registry: BackendRegistry = Depends(get_registry),
) -> CommitResult:
    """Write accepted proposals into the graph.

    The only endpoint in the service that writes. It takes proposal ids the
    service already holds decisions for — never a query — so the read-only
    guarantees the console rests on are not handed back through a second door.

    Types come from the declared vocabulary rather than from the extractor, so a
    document cannot introduce a class the graph does not model. Ambiguous labels
    are refused for a person to settle rather than resolved by guessing, which
    is the moment a silent choice would become a wrong graph that still cites
    its source.
    """
    try:
        store = registry.get(request.backend)
    except UnknownBackendError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    writer = getattr(store, "commit", None)
    if writer is None:
        raise HTTPException(
            status_code=400,
            detail=(
                f"The {store.name} backend cannot be written to: it serves a bundled graph "
                "rather than a database. Choose a backend that can."
            ),
        )

    proposals = [review_queue.get(identifier) for identifier in request.proposal_ids]
    found = [proposal for proposal in proposals if proposal is not None]
    missing = [
        CommitRefusal(proposal_id=identifier, reason="No such proposal.")
        for identifier, proposal in zip(request.proposal_ids, proposals, strict=True)
        if proposal is None
    ]

    domain = domains.get(settings.default_domain)
    extractor = extraction_registry.build(settings, domain)
    planned = extraction_commit.plan(found, domain, extractor=extractor.name)

    try:
        written, refused = await writer(planned.planned)
    except Exception as error:  # noqa: BLE001 - the store's own complaint is the useful part
        logger.info("Commit failed: %s", error)
        raise HTTPException(status_code=400, detail=_readable_failure(error)) from error

    return CommitResult(
        written=[CommittedStatement(**entry) for entry in written],
        refused=missing
        + [CommitRefusal(proposal_id=r.proposal_id, reason=r.reason) for r in planned.refused]
        + [CommitRefusal(**entry) for entry in refused],
    )


@app.post("/api/graph/query", response_model=GraphQueryResult)
async def graph_query(
    request: GraphQueryRequest,
    settings: Settings = Depends(get_settings),
    registry: BackendRegistry = Depends(get_registry),
) -> GraphQueryResult:
    """Run a query somebody typed, against a store that will not let it write.

    The point of this endpoint is evidence. The trace reports how many
    candidates were considered and how long each phase took, and a reader is
    entitled to ask what was actually *asked* — a graph nobody can query is a
    claim rather than a component.

    Read-only twice over: the session is opened in READ mode, which is what
    stops a write whatever its phrasing, and the guard runs first so a person
    who typed a write is told so rather than handed an access-mode error.

    Parameters are accepted so a query the pipeline issued can be run again as
    it ran. They are values in the driver's parameter slots, never text spliced
    into the query, so they widen no injection surface — only a size one, which
    is what the cap below is for.
    """
    try:
        store = registry.get(request.backend)
    except UnknownBackendError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    parameters = request.parameters or {}
    if len(parameters) > settings.max_query_parameters:
        raise HTTPException(
            status_code=400,
            detail=(
                f"A query may bind at most {settings.max_query_parameters} parameters; "
                f"this one binds {len(parameters)}."
            ),
        )

    runner = getattr(store, "run_readonly", None)
    if runner is None:
        raise HTTPException(
            status_code=400,
            detail=(
                f"The {store.name} backend has no query language: it serves a bundled "
                "graph rather than a database. Choose a backend that does."
            ),
        )

    started = time.perf_counter()
    try:
        columns, rows = await runner(
            query=request.query,
            parameters=parameters,
            limit=settings.max_query_rows,
        )
    except QueryRejected as rejected:
        raise HTTPException(status_code=400, detail=rejected.reason) from rejected
    except Exception as error:  # noqa: BLE001 - the store's own complaint is the useful part
        logger.info("Query failed: %s", error)
        raise HTTPException(status_code=400, detail=_readable_failure(error)) from error

    elapsed = int((time.perf_counter() - started) * 1000)
    return GraphQueryResult(
        columns=columns,
        rows=rows,
        elapsed_ms=elapsed,
        truncated=len(rows) >= settings.max_query_rows,
    )


def _readable_failure(error: Exception) -> str:
    """The database's complaint, without the driver's framing around it."""
    message = str(error)
    if "{message: " in message:
        message = message.split("{message: ", 1)[1].rstrip("}")
    return message.strip() or "The query could not be run."


@app.get("/ontology/{domain_id}.ttl", response_class=PlainTextResponse)
async def ontology_document(domain_id: str) -> PlainTextResponse:
    """One vocabulary, as a document somebody else can fetch.

    An ontology that exists only as a Python dictionary is not an ontology
    anyone can use. The JSON-LD exports name this URL, so a consumer holding a
    graph can resolve what its terms mean rather than guessing from their names.

    A domain this deployment does not hold is a 404 rather than a fallback: an
    unknown *tenant* should still render, but an unknown *document* that quietly
    returns a different vocabulary would be worse than not answering.
    """
    if domain_id not in domains.DOMAINS:
        raise HTTPException(status_code=404, detail=f"No domain named {domain_id!r}.")

    return PlainTextResponse(
        content=ontology.to_turtle(domains.DOMAINS[domain_id]),
        media_type="text/turtle; charset=utf-8",
        headers={"Cache-Control": "public, max-age=3600"},
    )


@app.post("/api/attachments", response_model=list[AttachmentInfo])
async def upload_attachments(files: list[UploadFile] = File(...)) -> list[AttachmentInfo]:
    """Accept documents a question can then be asked about.

    Each file is reported on individually. Uploading four documents where one is
    a video should attach three and say why the fourth did not, rather than
    rejecting the batch — so a rejection is a 200 with a status, not a 4xx.
    """
    results: list[AttachmentInfo] = []

    for upload in files:
        name = upload.filename or "unnamed"
        try:
            raw = await upload.read()
            stored = attachment_store.add(name, raw)
        except AttachmentRejected as rejected:
            logger.info("Rejected attachment %r: %s", rejected.name, rejected.reason)
            results.append(
                AttachmentInfo(
                    id="",
                    name=name,
                    bytes=0,
                    characters=0,
                    status="rejected",
                    detail=rejected.reason,
                )
            )
            continue
        finally:
            await upload.close()

        results.append(
            AttachmentInfo(
                id=stored.id,
                name=stored.name,
                bytes=stored.bytes_,
                characters=stored.characters,
                status="ready",
            )
        )

    return results


@app.post("/api/query")
async def query(
    request: QueryRequest,
    settings: Settings = Depends(get_settings),
    registry: BackendRegistry = Depends(get_registry),
    generator: AnswerGenerator = Depends(get_generator),
) -> StreamingResponse:
    """Answer a query as a Server-Sent Events stream.

    Frames are `status`, `graph`, `delta`, `done` and `error`, matching
    `StreamEvent` in packages/shared.
    """
    # Resolved here rather than inside the generator: once a StreamingResponse
    # has sent 200 the status cannot be taken back, so a bad request has to
    # fail before the stream opens.
    try:
        registry.get(request.retrieval.backend)
    except UnknownBackendError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    return StreamingResponse(
        stream_answer(request, settings, registry, generator, attachment_store),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            # Nginx and friends buffer event streams unless told not to.
            "X-Accel-Buffering": "no",
        },
    )
