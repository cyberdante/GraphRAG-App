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
    #: Whether this backend can run a typed query. The fixture store serves a
    #: bundled graph rather than a database, so a console pointed at it has
    #: nothing to run — better said here than discovered by running one.
    queryable: bool = False


class QueryPresetInfo(BaseModel):
    """A query worth starting from, tagged with the language it is written in."""

    label: str
    description: str
    language: str
    query: str


class IssuedQueryInfo(BaseModel):
    """One query the pipeline issued, as it was sent.

    Text and parameters stay apart, because that is how the driver received
    them. Folding the values in would produce a string that reads as what ran
    and is not, and would demonstrate query-building by concatenation to the one
    audience most likely to copy it.
    """

    pass_name: str
    language: str
    text: str
    parameters: dict[str, object] = Field(default_factory=dict)
    rows: int = 0
    elapsed_ms: int = 0


class GraphQueryRequest(BaseModel):
    """A query somebody typed.

    Names a backend the deployment offers, never an endpoint — the same rule the
    retrieval request follows, and for the same reason.
    """

    query: str
    backend: str | None = None
    #: Values for the query's parameter slots, so a query the pipeline issued can
    #: be replayed as it ran rather than rewritten to be self-contained. Bound by
    #: the driver, never interpolated.
    parameters: dict[str, object] | None = None


class GraphQueryResult(BaseModel):
    columns: list[str]
    rows: list[dict[str, object]]
    #: Milliseconds the store took, so a slow query reads as slow rather than broken.
    elapsed_ms: int
    #: True when the row cap cut the result. Silence here would let a partial
    #: answer read as a complete one.
    truncated: bool


class ProposalInfo(BaseModel):
    """One proposed statement, as a reviewer sees it."""

    id: str
    subject: str
    predicate: str
    object: str
    #: The passage it came from. A reviewer asked to judge a statement without
    #: its source is being asked to trust the extractor, which is the thing
    #: under review.
    quote: str
    source: str
    subject_type: str | None = None
    object_type: str | None = None
    confidence: float
    status: str
    note: str | None = None


class ExtractionResult(BaseModel):
    """What one document produced, and what was passed over."""

    source: str
    proposals: list[ProposalInfo]
    #: Passages looked at and not turned into statements. Reported because an
    #: extraction returning two proposals from a long document has either found
    #: very little or gone very wrong, and a bare list cannot say which.
    skipped: int
    #: Which extractor did it. "A model said so" and "a regular expression said
    #: so" deserve different scepticism.
    extractor: str


class ProposalDecision(BaseModel):
    """A person accepting or rejecting a proposal."""

    status: Literal["accepted", "rejected"]
    #: Why, for a rejection. Kept, because "we looked at this and said no" is
    #: information the next extraction run should not have to rediscover.
    note: str | None = None


class DomainInfo(BaseModel):
    """One subject this deployment can hold a graph about."""

    id: str
    label: str
    version: str
    #: Node types this domain declares. The console offers these rather than
    #: inferring them from a colour map.
    classes: list[str]
    #: Questions worth asking of this shape, before anyone has typed.
    starters: list[str]
    #: Queries worth starting from.
    presets: list[QueryPresetInfo] = []
    #: Where the vocabulary is served.
    ontology: str
    default: bool


class AttachmentInfo(BaseModel):
    """One uploaded document, or one refusal.

    A rejection is reported here rather than as a 4xx: uploading four files
    where one is a video should attach three and say why the fourth did not.
    """

    id: str
    name: str
    bytes: int
    characters: int
    status: Literal["ready", "rejected"]
    #: Why it was refused, in words a person can act on. Absent when ready.
    detail: str | None = None


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
    #: What was actually asked of the store. The trace could report how much
    #: was considered and how long it took, but not the question behind the
    #: numbers — which is the part that shows the graph is real rather than
    #: decorative. Empty for a backend that issues no query.
    queries: list[IssuedQueryInfo] | None = None
    #: Things the pipeline declined to do, and why — a URL it would not fetch,
    #: most often. Collected and never reported is the same as not checking:
    #: the refusal has to reach the person who attached the thing.
    notes: list[str] | None = None


class ErrorPayload(BaseModel):
    code: str
    message: str
