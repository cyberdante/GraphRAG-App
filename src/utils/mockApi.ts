import { StreamEvent, QueryRequest } from '@/types';
import { generateMockResponse, supplyChainGraphData } from './mockData';
import { graphToJsonLD } from './jsonLdConverter';

export class MockStreamingAPI {
  async *streamQuery(request: QueryRequest): AsyncGenerator<StreamEvent> {
    // Simulate network delay
    await this.delay(500);

    // Status: Retrieving from graph
    yield {
      type: 'status',
      data: { phase: 'retrieval', message: 'Querying knowledge graph...' }
    };

    await this.delay(800);

    // Send a valid subgraph with matching nodes and links
    const partialNodes = supplyChainGraphData.nodes.slice(0, 8);
    const partialNodeIds = new Set(partialNodes.map(n => n.id));
    const partialLinks = supplyChainGraphData.links.filter(
      link => partialNodeIds.has(link.source as string) && partialNodeIds.has(link.target as string)
    );

    const partialGraphData = {
      nodes: partialNodes,
      links: partialLinks
    };

    yield {
      type: 'graph',
      data: {
        ...partialGraphData,
        jsonLD: graphToJsonLD(partialGraphData)
      }
    };

    await this.delay(600);

    // Status: Processing
    yield {
      type: 'status',
      data: { phase: 'processing', message: 'Analyzing relationships and generating response...' }
    };

    await this.delay(700);

    // Send full graph
    yield {
      type: 'graph',
      data: {
        ...supplyChainGraphData,
        jsonLD: graphToJsonLD(supplyChainGraphData)
      }
    };

    await this.delay(400);

    // Generate response based on query
    const queryText = request.input.text;
    const { text, citations } = generateMockResponse(queryText);

    // Stream response text with typing effect
    const words = text.split(' ');
    let currentText = '';

    for (let i = 0; i < words.length; i++) {
      currentText += (i > 0 ? ' ' : '') + words[i];
      
      yield {
        type: 'delta',
        data: { text: currentText, citations }
      };

      // Variable delay for more natural typing
      await this.delay(Math.random() * 50 + 30);
    }

    await this.delay(500);

    // Done event with usage stats
    yield {
      type: 'done',
      data: {
        usage: {
          input_tokens: queryText.split(' ').length * 1.3,
          output_tokens: words.length * 1.2
        },
        citations
      }
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const mockAPI = new MockStreamingAPI();