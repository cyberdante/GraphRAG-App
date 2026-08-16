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

export interface QueryInputPayload {
  text: string;
  /** File names only — bytes are uploaded separately. */
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
