import logging
import time

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, StreamingResponse

from . import domains, ontology
from .attachments import AttachmentRejected, AttachmentStore
from .config import Settings, get_settings
from .llm.generator import AnswerGenerator
from .llm.registry import build_generator
from .models import (
    AttachmentInfo,
    BackendInfo,
    DomainInfo,
    GraphQueryRequest,
    GraphQueryResult,
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
    """
    try:
        store = registry.get(request.backend)
    except UnknownBackendError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

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
        columns, rows = await runner(query=request.query, limit=settings.max_query_rows)
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
