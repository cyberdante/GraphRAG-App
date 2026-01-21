// GraphRAG Types

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

export interface QueryRequest {
  conversation_id: string;
  messages: Message[];
  input: {
    text: string;
    files?: File[];
    urls?: string[];
    entityIds?: string[];
  };
  options: {
    stream: boolean;
    response_format: 'markdown' | 'text';
  };
  retrieval: {
    mode: 'graph_rag';
    graph: {
      max_hops: number;
      max_nodes: number;
      entity_types: string[];
    };
  };
}

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  group: number;
  color?: string;
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
}

export interface StreamEvent {
  type: 'status' | 'graph' | 'delta' | 'done' | 'error';
  data: any;
}

export interface QueryHistoryItem {
  id: string;
  query: string;
  timestamp: Date;
  response?: string;
}

export interface Citation {
  id: string;
  source: string;
  text: string;
  confidence?: number;
}
