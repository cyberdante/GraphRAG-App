import React, { useState, useCallback, useEffect } from 'react';
import { ThemeProvider, createTheme, CssBaseline, Box } from '@mui/material';
import { Navbar } from './components/Navbar';
import { QueryInput } from './components/QueryInput';
import { StreamingResponse } from './components/StreamingResponse';
import { GraphVisualization } from './components/GraphVisualization';
import { QueryHistory } from './components/QueryHistory';
import { MockStreamingAPI } from '@/utils/mockApi';
import { 
  exportConversationToPDF, 
  exportConversationToCSV, 
  exportGraphToPDF, 
  exportGraphToCSV,
  exportGraphToJsonLD 
} from '@/utils/exportUtils';
import { Message, GraphData, QueryHistoryItem } from '@/types';

const api = new MockStreamingAPI();

function AppContent() {
  const [darkMode, setDarkMode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentStatus, setCurrentStatus] = useState<string>('');
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [queryHistory, setQueryHistory] = useState<QueryHistoryItem[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string>('');

  // Load from localStorage on mount
  useEffect(() => {
    const savedHistory = localStorage.getItem('graphrag-query-history');
    if (savedHistory) {
      setQueryHistory(JSON.parse(savedHistory));
    }

    const savedConversationId = localStorage.getItem('graphrag-current-conversation-id');
    if (savedConversationId) {
      setCurrentConversationId(savedConversationId);
      const savedMessages = localStorage.getItem(`graphrag-conversation-${savedConversationId}`);
      if (savedMessages) {
        setMessages(JSON.parse(savedMessages));
      }
      const savedGraph = localStorage.getItem(`graphrag-graph-${savedConversationId}`);
      if (savedGraph) {
        setGraphData(JSON.parse(savedGraph));
      }
    } else {
      // Start a new conversation
      const newId = generateConversationId();
      setCurrentConversationId(newId);
      localStorage.setItem('graphrag-current-conversation-id', newId);
    }
  }, []);

  // Save to localStorage when messages or graph changes
  useEffect(() => {
    if (currentConversationId && messages.length > 0) {
      localStorage.setItem(`graphrag-conversation-${currentConversationId}`, JSON.stringify(messages));
      localStorage.setItem(`graphrag-graph-${currentConversationId}`, JSON.stringify(graphData));
    }
  }, [messages, graphData, currentConversationId]);

  // Save query history to localStorage
  useEffect(() => {
    if (queryHistory.length > 0) {
      localStorage.setItem('graphrag-query-history', JSON.stringify(queryHistory));
    }
  }, [queryHistory]);

  const generateConversationId = () => {
    return `conv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  };

  const handleNewChat = useCallback(() => {
    const newId = generateConversationId();
    setCurrentConversationId(newId);
    setMessages([]);
    setGraphData({ nodes: [], links: [] });
    setCurrentStatus('');
    localStorage.setItem('graphrag-current-conversation-id', newId);
  }, []);

  const handleLoadConversation = useCallback((conversationId: string) => {
    setCurrentConversationId(conversationId);
    localStorage.setItem('graphrag-current-conversation-id', conversationId);
    
    const savedMessages = localStorage.getItem(`graphrag-conversation-${conversationId}`);
    if (savedMessages) {
      setMessages(JSON.parse(savedMessages));
    } else {
      setMessages([]);
    }
    
    const savedGraph = localStorage.getItem(`graphrag-graph-${conversationId}`);
    if (savedGraph) {
      setGraphData(JSON.parse(savedGraph));
    } else {
      setGraphData({ nodes: [], links: [] });
    }
    
    setSidebarOpen(false);
  }, []);

  const handleQuery = useCallback(
    async (query: string, files?: File[], urls?: string[], entityIds?: string[]) => {
      if (!query.trim()) return;

      // Add user message
      setMessages((prev) => [
        ...prev,
        {
          role: 'user',
          content: query,
          timestamp: new Date()
        },
      ]);

      // Add to history
      setQueryHistory((prev) => [
        {
          id: `q-${Date.now()}`,
          query,
          timestamp: new Date(),
        },
        ...prev,
      ]);

      setIsStreaming(true);
      setCurrentStatus('Initializing query...');

      let assistantMessage: Message = {
        role: 'assistant',
        content: '',
      };

      try {
        const request = {
          conversation_id: currentConversationId,
          messages: [{ role: 'user' as const, content: query, timestamp: new Date() }],
          input: {
            text: query,
            files,
            urls,
            entityIds,
          },
          options: {
            stream: true,
            response_format: 'markdown' as const,
          },
          retrieval: {
            mode: 'graph_rag' as const,
            graph: {
              max_hops: 2,
              max_nodes: 150,
              entity_types: ['Supplier', 'Shipment', 'RiskSignal'],
            },
          },
        };

        for await (const event of api.streamQuery(request)) {
          switch (event.type) {
            case 'status':
              setCurrentStatus(event.data.message);
              break;

            case 'graph':
              setGraphData(event.data);
              break;

            case 'delta':
              assistantMessage = {
                ...assistantMessage,
                content: event.data.text,
                citations: event.data.citations,
              };
              setMessages((prev) => {
                const newMessages = [...prev];
                if (newMessages[newMessages.length - 1]?.role === 'assistant') {
                  newMessages[newMessages.length - 1] = assistantMessage;
                } else {
                  newMessages.push(assistantMessage);
                }
                return newMessages;
              });
              break;

            case 'done':
              assistantMessage = {
                ...assistantMessage,
                status: 'Complete',
                citations: event.data.citations,
              };
              setMessages((prev) => {
                const newMessages = [...prev];
                if (newMessages[newMessages.length - 1]?.role === 'assistant') {
                  newMessages[newMessages.length - 1] = assistantMessage;
                }
                return newMessages;
              });
              setIsStreaming(false);
              setCurrentStatus('');
              break;

            case 'error':
              console.error('Stream error:', event.data);
              setIsStreaming(false);
              setCurrentStatus('');
              break;
          }
        }
      } catch (error) {
        console.error('Query error:', error);
        setIsStreaming(false);
        setCurrentStatus('');
      }
    },
    [currentConversationId]
  );

  // Export handlers
  const handleExportPDF = useCallback(() => {
    if (messages.length === 0) {
      alert('No conversation to export');
      return;
    }
    exportConversationToPDF(messages, currentConversationId);
  }, [messages, currentConversationId]);

  const handleExportCSV = useCallback(() => {
    if (messages.length === 0) {
      alert('No conversation to export');
      return;
    }
    exportConversationToCSV(messages, currentConversationId);
  }, [messages, currentConversationId]);

  const handleExportGraphPDF = useCallback(() => {
    if (graphData.nodes.length === 0) {
      alert('No graph data to export');
      return;
    }
    exportGraphToPDF(graphData, currentConversationId);
  }, [graphData, currentConversationId]);

  const handleExportGraphCSV = useCallback(() => {
    if (graphData.nodes.length === 0) {
      alert('No graph data to export');
      return;
    }
    exportGraphToCSV(graphData, currentConversationId);
  }, [graphData, currentConversationId]);

  const handleExportGraphJsonLD = useCallback(() => {
    if (graphData.nodes.length === 0) {
      alert('No graph data to export');
      return;
    }
    exportGraphToJsonLD(graphData, currentConversationId);
  }, [graphData, currentConversationId]);

  const theme = createTheme({
    palette: {
      mode: darkMode ? 'dark' : 'light',
      primary: {
        main: '#1976d2',
      },
      secondary: {
        main: '#dc004e',
      },
    },
  });

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100%' }}>
        {/* Navbar */}
        <Navbar
          onMenuClick={() => setSidebarOpen(true)}
          darkMode={darkMode}
          onThemeToggle={() => setDarkMode(!darkMode)}
          onNewChat={handleNewChat}
          onExportPDF={handleExportPDF}
          onExportCSV={handleExportCSV}
          onExportGraphPDF={handleExportGraphPDF}
          onExportGraphCSV={handleExportGraphCSV}
          onExportGraphJsonLD={handleExportGraphJsonLD}
        />

        {/* Main Content */}
        <Box
          sx={{
            flexGrow: 1,
            mt: 8,
            p: 2,
            overflow: 'hidden',
            bgcolor: 'background.default',
          }}
        >
          <Box
            sx={{
              display: 'flex',
              gap: 2,
              height: '100%',
              flexDirection: { xs: 'column', lg: 'row' }
            }}
          >
            {/* Left Panel - Chat */}
            <Box
              sx={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                minHeight: { xs: '50vh', lg: 'auto' }
              }}
            >
              <Box sx={{ flexGrow: 1, overflow: 'hidden', mb: 2 }}>
                <StreamingResponse
                  messages={messages}
                  isStreaming={isStreaming}
                  currentStatus={currentStatus}
                />
              </Box>
              <QueryInput onSubmit={handleQuery} disabled={isStreaming} />
            </Box>

            {/* Right Panel - Graph */}
            <Box
              sx={{
                flex: 1,
                minHeight: { xs: '50vh', lg: 'auto' }
              }}
            >
              <GraphVisualization data={graphData} darkMode={darkMode} />
            </Box>
          </Box>
        </Box>

        {/* Query History Sidebar */}
        <QueryHistory
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          history={queryHistory}
          onSelectQuery={(query) => handleQuery(query)}
          onConversationLoad={handleLoadConversation}
        />
      </Box>
    </ThemeProvider>
  );
}

function App(_props: any) {
  // Explicitly ignore all props including Figma data attributes
  return <AppContent />;
}

export default App;