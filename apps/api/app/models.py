"""Pydantic mirrors of packages/shared/src/index.ts.

Field names match the TypeScript exactly, including the snake_case ones that
already existed on the wire. When one side changes, change the other.
"""

from typing import Any, Literal

from pydantic import BaseModel, Field

Role = Literal["user", "assistant", "system"]
MessageStatus = Literal["streaming", "complete", "stopped", "error"]
RetrievalPhase = Literal["retrieval", "processing", "generation"]


class Citation(BaseModel):
    id: str
    source: str
    text: str
    confidence: float | None = None
    nodeIds: list[str] | None = None


class Message(BaseModel):
    id: str
    role: Role
    content: str
    timestamp: str
    citations: list[Citation] | None = None
    status: MessageStatus | None = None
    error: str | None = None


class GraphNode(BaseModel):
    id: str
    label: str
    type: str
    group: int
    color: str | None = None
    properties: dict[str, Any] | None = None


class GraphEdge(BaseModel):
    source: str
    target: str
    type: str
    label: str | None = None


class GraphData(BaseModel):
    nodes: list[GraphNode]
    links: list[GraphEdge]
    jsonLD: Any | None = None


class GraphRetrieval(BaseModel):
    max_hops: int = Field(default=2, ge=1, le=6)
    max_nodes: int = Field(default=150, ge=1, le=5000)
    entity_types: list[str] = Field(default_factory=list)


class RetrievalOptions(BaseModel):
    mode: Literal["graph_rag"] = "graph_rag"
    graph: GraphRetrieval = Field(default_factory=GraphRetrieval)
    #: Names a backend the deployment offers. Never an endpoint — see
    #: app/retrieval/registry.py for why that distinction is load-bearing.
    backend: str | None = None
    top_k: int | None = Field(default=None, ge=1)


class BackendInfo(BaseModel):
    """One retrieval backend this deployment can answer with."""

    name: str
    description: str
    default: bool


class QueryInputPayload(BaseModel):
    text: str
    files: list[str] | None = None
    urls: list[str] | None = None
    entityIds: list[str] | None = None


class QueryOptions(BaseModel):
    stream: bool = True
    response_format: Literal["markdown", "text"] = "markdown"


class QueryRequest(BaseModel):
    conversation_id: str
    messages: list[Message] = Field(default_factory=list)
    input: QueryInputPayload
    options: QueryOptions = Field(default_factory=QueryOptions)
    retrieval: RetrievalOptions = Field(default_factory=RetrievalOptions)


class StatusPayload(BaseModel):
    phase: RetrievalPhase
    message: str


class DeltaPayload(BaseModel):
    """The new text only. The client appends it to what it already has."""

    text: str


class UsagePayload(BaseModel):
    input_tokens: int
    output_tokens: int


class DonePayload(BaseModel):
    usage: UsagePayload | None = None
    citations: list[Citation] | None = None
    #: What did the work, so the trace panel reports fact rather than guess.
    model: str | None = None
    backend: str | None = None
    #: Retrieved before ranking, so the trace shows what was considered.
    candidates: int | None = None


class ErrorPayload(BaseModel):
    code: str
    message: str
