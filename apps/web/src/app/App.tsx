import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  CssBaseline,
  Snackbar,
  ThemeProvider,
  createTheme,
} from '@mui/material';
import { Navbar } from './components/Navbar';
import { QueryInput } from './components/QueryInput';
import { StreamingResponse } from './components/StreamingResponse';
import { D3GraphVisualization } from './components/D3GraphVisualization';
import { QueryHistory } from './components/QueryHistory';
import { createClient } from '@/api/client';
import {
  exportConversationToPDF,
  exportConversationToCSV,
  exportGraphToPDF,
  exportGraphToCSV,
  exportGraphToJsonLD,
} from '@/utils/exportUtils';
import { readJson, readString, remove, writeJson, writeString } from '@/utils/storage';
import type { GraphData, Message, QueryHistoryItem, QueryRequest } from '@/types';

const api = createClient();

const CURRENT_CONVERSATION_KEY = 'graphrag-current-conversation-id';
const HISTORY_KEY = 'graphrag-query-history';
const conversationKey = (id: string) => `graphrag-conversation-${id}`;
const graphKey = (id: string) => `graphrag-graph-${id}`;

const EMPTY_GRAPH: GraphData = { nodes: [], links: [] };

/** Keeps the history sidebar from growing without bound. */
const MAX_HISTORY_ITEMS = 200;

const newId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

function AppContent() {
  const [darkMode, setDarkMode] = useState(() => readString('graphrag-theme') === 'dark');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentStatus, setCurrentStatus] = useState('');
  const [graphData, setGraphData] = useState<GraphData>(EMPTY_GRAPH);
  const [queryHistory, setQueryHistory] = useState<QueryHistoryItem[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const hydrated = useRef(false);

  // Restore the last session.
  useEffect(() => {
    setQueryHistory(readJson<QueryHistoryItem[]>(HISTORY_KEY, []));

    const savedConversationId = readString(CURRENT_CONVERSATION_KEY);
    if (savedConversationId) {
      setCurrentConversationId(savedConversationId);
      setMessages(readJson<Message[]>(conversationKey(savedConversationId), []));
      setGraphData(readJson<GraphData>(graphKey(savedConversationId), EMPTY_GRAPH));
    } else {
      const id = newId('conv');
      setCurrentConversationId(id);
      writeString(CURRENT_CONVERSATION_KEY, id);
    }

    hydrated.current = true;
  }, []);

  // Abandon any in-flight request when the app goes away.
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!hydrated.current || !currentConversationId || messages.length === 0) return;

    const saved =
      writeJson(conversationKey(currentConversationId), messages) &&
      writeJson(graphKey(currentConversationId), graphData);

    if (!saved) {
      setNotice('This conversation could not be saved — browser storage is full.');
    }
  }, [messages, graphData, currentConversationId]);

  useEffect(() => {
    if (!hydrated.current) return;
    writeJson(HISTORY_KEY, queryHistory);
  }, [queryHistory]);

  useEffect(() => {
    writeString('graphrag-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  const handleNewChat = useCallback(() => {
    abortRef.current?.abort();
    const id = newId('conv');
    setCurrentConversationId(id);
    setMessages([]);
    setGraphData(EMPTY_GRAPH);
    setCurrentStatus('');
    setIsStreaming(false);
    writeString(CURRENT_CONVERSATION_KEY, id);
  }, []);

  const handleLoadConversation = useCallback((conversationId: string) => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setCurrentStatus('');
    setCurrentConversationId(conversationId);
    writeString(CURRENT_CONVERSATION_KEY, conversationId);
    setMessages(readJson<Message[]>(conversationKey(conversationId), []));
    setGraphData(readJson<GraphData>(graphKey(conversationId), EMPTY_GRAPH));
    setSidebarOpen(false);
  }, []);

  const handleDeleteConversation = useCallback(
    (conversationId: string) => {
      remove(conversationKey(conversationId));
      remove(graphKey(conversationId));
      setQueryHistory((prev) => prev.filter((item) => item.conversationId !== conversationId));

      if (conversationId === currentConversationId) {
        handleNewChat();
      }
    },
    [currentConversationId, handleNewChat],
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleQuery = useCallback(
    async (query: string, files?: File[], urls?: string[], entityIds?: string[]) => {
      if (!query.trim() || isStreaming) return;

      const controller = new AbortController();
      abortRef.current = controller;

      const userMessage: Message = {
        id: newId('msg'),
        role: 'user',
        content: query,
        timestamp: new Date().toISOString(),
      };

      const assistantId = newId('msg');
      const conversationId = currentConversationId;

      // The history the model needs: every turn so far, plus this one. This is
      // what the request carries — sending only the latest message was why the
      // assistant could never remember anything.
      const history = [...messages, userMessage];

      const assistantPlaceholder: Message = {
        id: assistantId,
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
        status: 'streaming',
      };

      setMessages([...history, assistantPlaceholder]);

      setQueryHistory((prev) =>
        [
          { id: newId('q'), query, timestamp: userMessage.timestamp, conversationId },
          ...prev,
        ].slice(0, MAX_HISTORY_ITEMS),
      );

      setIsStreaming(true);
      setCurrentStatus('Initializing query...');

      const patchAssistant = (patch: Partial<Message>) => {
        setMessages((prev) =>
          prev.map((message) =>
            message.id === assistantId ? { ...message, ...patch } : message,
          ),
        );
      };

      const request: QueryRequest = {
        conversation_id: conversationId,
        messages: history,
        input: {
          text: query,
          files: files?.map((file) => file.name),
          urls,
          entityIds,
        },
        options: { stream: true, response_format: 'markdown' },
        retrieval: {
          mode: 'graph_rag',
          graph: {
            max_hops: 2,
            max_nodes: 150,
            entity_types: ['Supplier', 'Shipment', 'RiskSignal'],
          },
        },
      };

      let answer = '';

      try {
        for await (const event of api.streamQuery(request, controller.signal)) {
          switch (event.type) {
            case 'status':
              setCurrentStatus(event.data.message);
              break;

            case 'graph':
              setGraphData(event.data);
              break;

            case 'delta':
              // Deltas are increments; the running answer lives here.
              answer += event.data.text;
              patchAssistant({ content: answer });
              break;

            case 'done':
              patchAssistant({
                status: 'complete',
                citations: event.data.citations,
              });
              break;

            case 'error':
              patchAssistant({ status: 'error', error: event.data.message });
              break;
          }
        }
      } catch (error) {
        if (controller.signal.aborted) {
          patchAssistant({
            status: 'stopped',
            error: answer ? undefined : 'Stopped before the answer started.',
          });
        } else {
          const message =
            error instanceof Error ? error.message : 'The query could not be completed.';
          console.error('Query failed', error);
          patchAssistant({ status: 'error', error: message });
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setIsStreaming(false);
        setCurrentStatus('');
      }
    },
    [currentConversationId, isStreaming, messages],
  );

  const handleRetry = useCallback(() => {
    const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user');
    if (lastUserMessage) void handleQuery(lastUserMessage.content);
  }, [messages, handleQuery]);

  const guard = useCallback(
    (isEmpty: boolean, emptyMessage: string, run: () => void) => () => {
      if (isEmpty) {
        setNotice(emptyMessage);
        return;
      }
      run();
    },
    [],
  );

  const noMessages = messages.length === 0;
  const noGraph = graphData.nodes.length === 0;

  const handleExportPDF = guard(noMessages, 'There is no conversation to export yet.', () =>
    exportConversationToPDF(messages, currentConversationId),
  );
  const handleExportCSV = guard(noMessages, 'There is no conversation to export yet.', () =>
    exportConversationToCSV(messages, currentConversationId),
  );
  const handleExportGraphPDF = guard(noGraph, 'There is no graph to export yet.', () =>
    exportGraphToPDF(graphData, currentConversationId),
  );
  const handleExportGraphCSV = guard(noGraph, 'There is no graph to export yet.', () =>
    exportGraphToCSV(graphData, currentConversationId),
  );
  const handleExportGraphJsonLD = guard(noGraph, 'There is no graph to export yet.', () =>
    exportGraphToJsonLD(graphData, currentConversationId),
  );

  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          mode: darkMode ? 'dark' : 'light',
          primary: { main: '#1976d2' },
          secondary: { main: '#dc004e' },
        },
      }),
    [darkMode],
  );

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100%' }}>
        <Navbar
          onMenuClick={() => setSidebarOpen(true)}
          darkMode={darkMode}
          onThemeToggle={() => setDarkMode((previous) => !previous)}
          onNewChat={handleNewChat}
          onExportPDF={handleExportPDF}
          onExportCSV={handleExportCSV}
          onExportGraphPDF={handleExportGraphPDF}
          onExportGraphCSV={handleExportGraphCSV}
          onExportGraphJsonLD={handleExportGraphJsonLD}
        />

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
              flexDirection: { xs: 'column', lg: 'row' },
            }}
          >
            <Box
              sx={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                minHeight: { xs: '50vh', lg: 'auto' },
              }}
            >
              <Box sx={{ flexGrow: 1, overflow: 'hidden', mb: 2 }}>
                <StreamingResponse
                  messages={messages}
                  isStreaming={isStreaming}
                  currentStatus={currentStatus}
                  onRetry={handleRetry}
                />
              </Box>
              <QueryInput
                onSubmit={handleQuery}
                onStop={handleStop}
                isStreaming={isStreaming}
              />
            </Box>

            <Box sx={{ flex: 1, minHeight: { xs: '50vh', lg: 'auto' } }}>
              <D3GraphVisualization data={graphData} darkMode={darkMode} />
            </Box>
          </Box>
        </Box>

        <QueryHistory
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          history={queryHistory}
          currentConversationId={currentConversationId}
          onConversationLoad={handleLoadConversation}
          onConversationDelete={handleDeleteConversation}
        />

        <Snackbar
          open={notice !== null}
          autoHideDuration={5000}
          onClose={() => setNotice(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          <Alert severity="info" variant="filled" onClose={() => setNotice(null)}>
            {notice}
          </Alert>
        </Snackbar>
      </Box>
    </ThemeProvider>
  );
}

function App({ ...props }: React.ComponentProps<'div'>) {
  // Explicitly consume all props (including Figma's data-fg-* attributes)
  // but don't pass them to child components. This prevents React warnings
  // about unsupported props on Material UI components.
  void props;
  return <AppContent />;
}

export default App;
