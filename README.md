# GraphRAG Application - White Label UI

A production-ready white-label GraphRAG (Graph Retrieval-Augmented Generation) application built with React, Material UI, and TypeScript. This UI demonstrates a complete implementation of a Graph-based RAG system with real-time streaming responses and interactive 3D knowledge graph visualization.

## Features

### 🎯 Core Functionality
- **Natural Language Query Interface** - Ask questions in plain English about supply chain data
- **Streaming HTTP Responses** - Real-time SSE (Server-Sent Events) simulation with typing effect
- **Interactive 3D Graph Visualization** - Explore knowledge graph relationships with Three.js/Force Graph
- **Query History Sidebar** - Track and replay previous queries
- **Multi-Input Support** - Upload files, add URLs, or specify entity IDs

### 🎨 UI/UX Features
- **Dark/Light Theme Toggle** - Fully customizable theming system
- **Responsive Layout** - Works on desktop, tablet, and mobile
- **Clean Material Design** - Professional, sleek interface using Material UI
- **White-Label Ready** - Easy to rebrand with custom colors and logos

### 📊 Data Visualization
- **3D Force-Directed Graph** - Interactive node-edge visualization
- **Real-time Graph Updates** - Graph updates as streaming responses arrive
- **Node Details on Click** - Inspect entities and relationships
- **Zoom/Pan Controls** - Full navigation controls

### 💬 Conversation Features
- **Streaming Text Display** - Typing effect for natural conversation flow
- **Citations & Sources** - Each response includes source attribution with confidence scores
- **Status Indicators** - Real-time feedback on query processing phases
- **Message History** - Full conversation context maintained

## Tech Stack

- **React 18.3** - Modern React with hooks
- **Material UI v7** - Complete component library
- **TypeScript** - Full type safety
- **React Force Graph 3D** - 3D graph visualization
- **Three.js** - WebGL rendering
- **Date-fns** - Date formatting
- **Vite** - Fast build tool

## Architecture

### Event Flow (SSE Streaming)
```
UI → API Request
     ↓
API → Status Event: "Querying knowledge graph..."
     ↓
API → Graph Event: Partial graph data (nodes/edges)
     ↓
API → Status Event: "Analyzing relationships..."
     ↓
API → Graph Event: Complete graph data
     ↓
API → Delta Events: Streaming response text (word by word)
     ↓
API → Done Event: Completion with usage stats & citations
```

### Message Format (OpenAI-Compatible)

**Request:**
```json
{
  "conversation_id": "conv_123",
  "messages": [
    { "role": "user", "content": "Which suppliers are at risk?" }
  ],
  "input": {
    "text": "Which suppliers are at risk?",
    "files": [],
    "urls": [],
    "entityIds": []
  },
  "options": {
    "stream": true,
    "response_format": "markdown"
  },
  "retrieval": {
    "mode": "graph_rag",
    "graph": {
      "max_hops": 2,
      "max_nodes": 150,
      "entity_types": ["Supplier", "Shipment", "RiskSignal"]
    }
  }
}
```

**Response Events:**
```typescript
// Status update
{ type: 'status', data: { phase: 'retrieval', message: '...' } }

// Graph data
{ type: 'graph', data: { nodes: [...], links: [...] } }

// Streaming text
{ type: 'delta', data: { text: '...', citations: [...] } }

// Completion
{ type: 'done', data: { usage: {...}, citations: [...] } }
```

## Mock Data

The application includes comprehensive supply chain mock data:
- **3 Suppliers**: ITAMCO, TechParts Inc, GlobalMfg
- **Risk Factors**: Delivery delays, quality issues, price volatility
- **Shipments**: Active tracking with statuses
- **Warehouses**: Multi-location inventory
- **Risk Signals**: Predictive alerts

## Customization

### Theming
Modify `/src/app/App.tsx` to customize colors:
```typescript
const theme = createTheme({
  palette: {
    primary: { main: '#YOUR_COLOR' },
    secondary: { main: '#YOUR_COLOR' },
  }
});
```

### Logo
Replace logo placeholder in `/src/app/components/Navbar.tsx`:
```typescript
// Replace the Box with bgcolor with your logo image
<img src="/your-logo.png" alt="Logo" />
```

### Mock Backend
Replace mock API in `/src/utils/mockApi.ts` with real backend:
```typescript
// Replace MockStreamingAPI with actual FastAPI endpoint
const response = await fetch('https://your-api.com/v1/kb/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(request)
});
```

## Future Enhancements

- [ ] Real FastAPI backend integration
- [ ] AWS Bedrock LLM integration  
- [ ] Neptune graph database connection
- [ ] Multi-tenancy support
- [ ] User authentication
- [ ] Export conversation history
- [ ] Advanced graph filters
- [ ] Custom entity type visualization
- [ ] WebSocket support for bidirectional communication

## Development Notes

This is a **frontend prototype** demonstrating the UI/UX patterns for a GraphRAG application. For production:

1. Replace mock API with real backend
2. Implement proper authentication
3. Add error boundaries and fallbacks
4. Implement rate limiting
5. Add analytics/monitoring
6. Optimize graph rendering for large datasets
7. Add comprehensive testing

## License

This is a demonstration project. Customize and use as needed for your GraphRAG implementation.
