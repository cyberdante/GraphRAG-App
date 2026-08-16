import logging

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .config import Settings, get_settings
from .models import QueryRequest
from .streaming import stream_answer

logging.basicConfig(level=logging.INFO)

app = FastAPI(
    title="GraphRAG API",
    version="0.1.0",
    description="Streams answers grounded in a Neptune knowledge graph.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health(settings: Settings = Depends(get_settings)) -> dict[str, object]:
    return {
        "status": "ok",
        "environment": settings.environment,
        "fixtures": settings.use_fixtures,
    }


@app.post("/api/query")
async def query(
    request: QueryRequest,
    settings: Settings = Depends(get_settings),
) -> StreamingResponse:
    """Answer a query as a Server-Sent Events stream.

    Frames are `status`, `graph`, `delta`, `done` and `error`, matching
    `StreamEvent` in packages/shared.
    """
    return StreamingResponse(
        stream_answer(request, settings),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            # Nginx and friends buffer event streams unless told not to.
            "X-Accel-Buffering": "no",
        },
    )
