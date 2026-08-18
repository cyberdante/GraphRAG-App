/**
 * Wire contract shared by the web app and the FastAPI service.
 *
 * These types are the single definition of a message, a graph and a stream
 * event. The Pydantic models in `apps/api/app/models.py` mirror them field for
 * field; when this file changes, that one changes with it.
 */

export type Role = 'user' | 'assistant' | 'system';

/** Lifecycle of an assistant turn, from first token to whatever ended it. */
export type MessageStatus = 'streaming' | 'complete' | 'stopped' | 'error';

export interface Citation {
  id: string;
  source: string;
  text: string;
  confidence?: number;
  /** Graph nodes this citation was drawn from, for highlighting later. */
  nodeIds?: string[];
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  /**
   * ISO 8601. Deliberately a string, not a Date: messages round-trip through
   * JSON on the way to storage and to the API, and a Date does not survive it.
   */
  timestamp: string;
  citations?: Citation[];
  status?: MessageStatus;
  /** Present only when status is 'error'; shown to the user verbatim. */
  error?: string;
  /**
   * What the pipeline did to produce this answer. Recorded client-side because
   * latency is only measurable where it is felt. Shape lives in
   * apps/web/src/api/trace.ts; typed loosely here so the wire contract does not
   * depend on a UI concern.
   */
  trace?: unknown;
}

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  group: number;
  color?: string;
  properties?: Record<string, unknown>;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
  label?: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphEdge[];
  jsonLD?: unknown;
}

export interface RetrievalOptions {
  mode: 'graph_rag';
  graph: {
    max_hops: number;
    max_nodes: number;
    entity_types: string[];
  };
  /**
   * Names a retrieval backend the deployment offers, from GET /api/backends.
   *
   * A name, never an endpoint. Letting a client describe a destination would
   * make the service an SSRF vector into whatever its network can reach, so
   * the server resolves this against a registry built from its own settings.
   */
  backend?: string;
  top_k?: number;
}

/** One retrieval backend, as listed by GET /api/backends. */
export interface BackendInfo {
  name: string;
  description: string;
  default: boolean;
}

/** One subject this deployment can hold a graph about, from GET /api/domains. */
export interface DomainInfo {
  id: string;
  label: string;
  version: string;
  /**
   * Node types this domain declares.
   *
   * The console offers these rather than reading the keys of its own colour
   * map: a type is a property of the subject, not of the branding.
   */
  classes: string[];
  /** Questions worth asking of this shape, before anyone has typed. */
  starters: string[];
  /** Where the vocabulary is served. */
  ontology: string;
  default: boolean;
}

/** One uploaded document, or one refusal, as reported by POST /api/attachments. */
export interface AttachmentInfo {
  id: string;
  name: string;
  bytes: number;
  characters: number;
  status: 'ready' | 'rejected';
  /** Why it was refused, in words a person can act on. Absent when ready. */
  detail?: string;
}

export interface QueryInputPayload {
  text: string;
  /**
   * Attachment ids from POST /api/attachments, not file names.
   *
   * Names were what this carried before, which is why an attached document
   * never reached the answer: the service had nothing to read.
   */
  files?: string[];
  urls?: string[];
  entityIds?: string[];
}

export interface QueryRequest {
  conversation_id: string;
  /** Full conversation so far, oldest first. The model needs all of it. */
  messages: Message[];
  input: QueryInputPayload;
  options: {
    stream: boolean;
    response_format: 'markdown' | 'text';
  };
  retrieval: RetrievalOptions;
}

export type RetrievalPhase = 'retrieval' | 'processing' | 'generation';

export interface StatusPayload {
  phase: RetrievalPhase;
  message: string;
}

export interface DeltaPayload {
  /**
   * The new text only, not the running total. The client appends it. This
   * matches how Bedrock's ConverseStream emits, so the service can forward
   * chunks straight through without buffering.
   */
  text: string;
}

export interface UsagePayload {
  input_tokens: number;
  output_tokens: number;
}

export interface DonePayload {
  usage?: UsagePayload;
  citations?: Citation[];
  /** The model that wrote the answer, or "fixtures" when none did. */
  model?: string;
  /** The retrieval backend the evidence came from. */
  backend?: string;
  /** How many candidates were retrieved before ranking cut them down. */
  candidates?: number;
  /**
   * Things the pipeline declined to do, and why — a URL it would not fetch,
   * most often. Reported rather than only logged: a refusal the person who
   * attached the thing never sees is the same as not checking.
   */
  notes?: string[];
}

export interface ErrorPayload {
  code: string;
  message: string;
}

export type StreamEvent =
  | { type: 'status'; data: StatusPayload }
  | { type: 'graph'; data: GraphData }
  | { type: 'delta'; data: DeltaPayload }
  | { type: 'done'; data: DonePayload }
  | { type: 'error'; data: ErrorPayload };

export interface QueryHistoryItem {
  id: string;
  query: string;
  timestamp: string;
  conversationId: string;
}

/** Every client that can answer a query, mock or real. */
export interface GraphRagClient {
  streamQuery(
    request: QueryRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent>;
}

export * from './ontology';

export * from './tenant';
