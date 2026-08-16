import type { GraphRagClient, QueryRequest, StreamEvent } from '@/types';
import { MockStreamingAPI } from '@/utils/mockApi';
import { readSseStream } from './sse';

const STREAM_EVENT_TYPES = new Set(['status', 'graph', 'delta', 'done', 'error']);

/** Talks to the FastAPI service in apps/api over Server-Sent Events. */
export class HttpStreamingAPI implements GraphRagClient {
  constructor(private readonly baseUrl: string = '') {}

  async *streamQuery(
    request: QueryRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    const response = await fetch(`${this.baseUrl}/api/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(request),
      signal,
    });

    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        `The service returned ${response.status}. ${detail}`.trim(),
      );
    }

    for await (const frame of readSseStream(response.body, signal)) {
      if (!STREAM_EVENT_TYPES.has(frame.event)) continue;

      let data: unknown;
      try {
        data = JSON.parse(frame.data);
      } catch {
        // A truncated frame is not worth killing the stream over.
        continue;
      }

      yield { type: frame.event, data } as StreamEvent;
    }
  }
}

/**
 * Picks the client for this build. The real service is the default; set
 * VITE_USE_MOCK=true to run the demo with no Python process at all.
 */
export function createClient(): GraphRagClient {
  const useMock = import.meta.env.VITE_USE_MOCK === 'true';
  return useMock
    ? new MockStreamingAPI()
    : new HttpStreamingAPI(import.meta.env.VITE_API_BASE_URL ?? '');
}
