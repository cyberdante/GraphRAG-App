# White-Label GraphRAG Application

A professional white-label GraphRAG application that uses natural language queries to communicate with a FastAPI Python backend, retrieves information from AWS Bedrock, and represents data as triples using Neptune.

## Features

### Core Functionality
- **Natural Language Query Interface**: Clean Material Design UI for natural language input
- **Multiple Input Types**: Support for text queries, file uploads, URLs, and entity IDs
- **Streaming HTTP Communication**: Real-time SSE (Server-Sent Events) streaming responses
- **Interactive 3D Graph Visualization**: Custom D3.js-based knowledge graph visualization
- **Persistent Conversation History**: localStorage-based conversation management
- **Export Capabilities**: 
  - Conversations: PDF, CSV formats
  - Graph data: PDF, CSV, JSON-LD (semantic web compatible)

### UI Components
- **Top Navbar**: Logo placeholder, hamburger menu, theme toggle, export options
- **Query Input**: Multi-modal input supporting text, files, URLs, and entity IDs
- **Streaming Response Display**: Real-time typing effects with citations
- **Interactive Graph Visualization**: 
  - D3.js force-directed layout
  - Zoom, pan, drag interactions
  - Label toggle
  - Node selection with info panel
  - Dark/light theme support
- **Query History Sidebar**: Conversation history with load functionality

### Theme Support
- Light/Dark mode toggle
- Material Design components
- Responsive layout (mobile/desktop)

## Technology Stack

- **Frontend Framework**: React 18.3.1 with TypeScript
- **UI Library**: Material-UI (@mui/material 7.3.5)
- **Graph Visualization**: D3.js 7.9.0 (custom implementation)
- **Build Tool**: Vite 6.3.5
- **Styling**: Tailwind CSS 4.1.12 + Material-UI theme system
- **State Management**: React hooks + localStorage
- **Export Libraries**: jsPDF, jspdf-autotable

## Project Structure

```
src/
├── app/
│   ├── App.tsx                      # Main application component
│   └── components/
│       ├── D3GraphVisualization.tsx # Custom D3.js graph visualization
│       ├── Navbar.tsx               # Top navigation bar
│       ├── QueryHistory.tsx         # Conversation history sidebar
│       ├── QueryInput.tsx           # Multi-modal query input
│       └── StreamingResponse.tsx    # Streaming chat interface
├── utils/
│   ├── mockApi.ts                   # Mock streaming API with SSE
│   ├── mockData.ts                  # Supply chain demo data
│   ├── exportUtils.ts               # PDF/CSV/JSON-LD export functions
│   └── jsonLdConverter.ts           # JSON-LD semantic web conversion
├── types/
│   └── index.ts                     # TypeScript type definitions
└── styles/
    ├── index.css                    # Global styles
    ├── tailwind.css                 # Tailwind imports
    └── theme.css                    # Custom theme tokens
```

## Recent Updates

### January 27, 2026

#### Custom D3.js Graph Visualization
- Replaced `react-force-graph-3d` with fully custom D3.js implementation
- Features:
  - Properly sized nodes (15px radius) for better visibility
  - Visible relationship links with directional arrows
  - Working label toggle functionality
  - Optimized force simulation parameters
  - Interactive drag, zoom, and pan
  - Dark/light theme support
  - Node selection with info panel
  - Auto-fit zoom on initial load

#### Figma Data Attribute Fix
- Resolved React warnings about unsupported props on Material UI components
- Implemented proper prop consumption at App component boundary
- Prevents Figma's `data-fg-*` attributes from propagating to Material UI

#### Export Functionality
- Complete conversation export (PDF, CSV)
- Graph data export (PDF, CSV, JSON-LD)
- JSON-LD export with proper semantic web formatting for compatibility with other tools

#### Persistence
- localStorage-based conversation management
- Query history tracking
- Auto-save on conversation updates
- Conversation switching with state preservation

## Mock Data

The application currently uses supply chain data for demonstration:
- **Entities**: Suppliers, Shipments, Risk Signals, Products, Locations
- **Relationships**: ships_to, located_in, supplies, has_risk, etc.
- **Sample Queries**: 
  - "Show me all suppliers in China"
  - "What are the risk signals for Acme Corporation?"
  - "Show shipment routes from Vietnam"

## Development

### Installation

```bash
npm install
# or
pnpm install
```

### Build

```bash
npm run build
# or
pnpm run build
```

### Key Dependencies

- React 18.3.1
- Material-UI 7.3.5
- D3.js 7.9.0
- Vite 6.3.5
- TypeScript (via @vitejs/plugin-react)
- Tailwind CSS 4.1.12

## Architecture Notes

### Streaming API
The mock API (`utils/mockApi.ts`) demonstrates the expected backend interface:
- SSE-based streaming responses
- Event types: `status`, `graph`, `delta`, `done`, `error`
- Graph data returned as JSON with nodes and links

### Graph Visualization
The D3.js implementation uses:
- Force-directed layout with collision detection
- SVG rendering for performance
- Zoom behavior with programmatic controls
- Dynamic theme switching
- Efficient tick updates

### Export System
- PDF exports use jsPDF with autotable plugin
- CSV exports use simple text/csv generation
- JSON-LD exports follow semantic web standards with proper @context

## Future Enhancements

- [ ] Backend integration with FastAPI
- [ ] AWS Bedrock connection
- [ ] Neptune database integration
- [ ] Real authentication/authorization
- [ ] Advanced graph filtering and search
- [ ] Graph analytics and metrics
- [ ] Custom branding/white-labeling interface
- [ ] Multi-language support

## White-Labeling

This application is designed to be easily white-labeled:
- Material-UI theming system for colors and typography
- Logo placeholder in navbar (easily replaceable)
- Configurable theme tokens in `src/styles/theme.css`
- No hardcoded branding elements

## License

Private - All rights reserved

## Contact

For questions or support, please contact the repository owner.