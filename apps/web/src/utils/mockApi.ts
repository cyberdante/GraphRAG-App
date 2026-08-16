import type { GraphRagClient, QueryRequest, StreamEvent } from '@/types';
import { generateMockResponse, supplyChainGraphData } from './mockData';
import { graphToJsonLD } from './jsonLdConverter';

/**
 * Offline stand-in for the FastAPI service. It emits exactly the events
 * `apps/api` emits, so switching between them changes nothing downstream.
 */
export class MockStreamingAPI implements GraphRagClient {
  async *streamQuery(
    request: QueryRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    await this.delay(500, signal);

    yield {
      type: 'status',
      data: { phase: 'retrieval', message: 'Querying knowledge graph...' },
    };

    await this.delay(800, signal);

    // A first subgraph, keeping only links whose endpoints both survive the cut.
    const partialNodes = supplyChainGraphData.nodes.slice(0, 8);
    const partialNodeIds = new Set(partialNodes.map((node) => node.id));
    const partialGraphData = {
      nodes: partialNodes,
      links: supplyChainGraphData.links.filter(
        (link) => partialNodeIds.has(link.source) && partialNodeIds.has(link.target),
      ),
    };

    yield {
      type: 'graph',
      data: { ...partialGraphData, jsonLD: graphToJsonLD(partialGraphData) },
    };

    await this.delay(600, signal);

    yield {
      type: 'status',
      data: { phase: 'processing', message: 'Analyzing relationships...' },
    };

    await this.delay(700, signal);

    yield {
      type: 'graph',
      data: { ...supplyChainGraphData, jsonLD: graphToJsonLD(supplyChainGraphData) },
    };

    await this.delay(400, signal);

    yield {
      type: 'status',
      data: { phase: 'generation', message: 'Generating response...' },
    };

    const { text, citations } = generateMockResponse(request.input.text);
    const words = text.split(' ');

    for (let index = 0; index < words.length; index += 1) {
      // Increments, not the running total — same as the service.
      yield {
        type: 'delta',
        data: { text: index === 0 ? words[index]! : ` ${words[index]}` },
      };
      await this.delay(Math.random() * 40 + 20, signal);
    }

    await this.delay(300, signal);

    const promptWords = request.messages.reduce(
      (total, message) => total + message.content.split(' ').length,
      0,
    );

    yield {
      type: 'done',
      data: {
        usage: {
          input_tokens: Math.round(promptWords * 1.3),
          output_tokens: Math.round(words.length * 1.2),
        },
        citations,
      },
    };
  }

  /** Sleeps, but rejects the moment the caller aborts. */
  private delay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }

      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);

      const onAbort = () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      };

      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}

export const mockAPI = new MockStreamingAPI();
