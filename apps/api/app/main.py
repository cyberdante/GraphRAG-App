import logging
from functools import lru_cache

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .config import Settings, get_settings
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


@lru_cache
def _registry() -> BackendRegistry:
    """Built once from settings, never from a request."""
    return build_registry(get_settings())


def get_registry() -> BackendRegistry:
    return _registry()


@app.get("/health")
async def health(
    settings: Settings = Depends(get_settings),
    registry: BackendRegistry = Depends(get_registry),
) -> dict[str, object]:
    return {
        "status": "ok",
        "environment": settings.environment,
        "backends": registry.names(),
        "default_backend": registry.default,
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
        stream_answer(request, settings, registry),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            # Nginx and friends buffer event streams unless told not to.
            "X-Accel-Buffering": "no",
        },
    )
