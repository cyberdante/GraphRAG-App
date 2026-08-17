import logging

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .attachments import AttachmentRejected, AttachmentStore
from .config import Settings, get_settings
from .llm.generator import AnswerGenerator
from .llm.registry import build_generator
from .models import AttachmentInfo, BackendInfo, QueryRequest
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
        )
        for store in registry.available()
    ]


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
