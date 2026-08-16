import logging

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .config import Settings, get_settings
from .llm.generator import AnswerGenerator
from .llm.registry import build_generator
from .models import BackendInfo, QueryRequest
from .retrieval.registry import BackendRegistry, build_registry
from .retrieval.store import UnknownBackendError
from .streaming import stream_answer

logging.basicConfig(level=logging.INFO)

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
        stream_answer(request, settings, registry, generator),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            # Nginx and friends buffer event streams unless told not to.
            "X-Accel-Buffering": "no",
        },
    )
