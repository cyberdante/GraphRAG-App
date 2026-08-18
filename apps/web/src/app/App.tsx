import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, CssBaseline, Snackbar, ThemeProvider } from '@mui/material';
import {
  availableTenants,
  buildTheme,
  loadTenant,
  reportResolution,
  switcherEnabled,
} from '@/theme';
import { Navbar } from './components/Navbar';
import { QueryInput } from './components/QueryInput';
import { StreamingResponse } from './components/StreamingResponse';
import { D3GraphVisualization } from './components/D3GraphVisualization';
import { QueryHistory } from './components/QueryHistory';
import { TenantSwitcher } from './components/TenantSwitcher';
import { createClient } from '@/api/client';
import { TraceRecorder } from '@/api/trace';
import {
  exportConversationToPDF,
  exportConversationToCSV,
  exportGraphToPDF,
  exportGraphToCSV,
  exportGraphToJsonLD,
} from '@/utils/exportUtils';
import { readJson, readString, remove, writeJson, writeString } from '@/utils/storage';
import { evict, saveWithRoom } from '@/utils/eviction';
import { fetchBackends } from '@/api/backends';
import { fetchDomains, resolveDomain } from '@/api/domains';
import { RetrievalControls } from './components/RetrievalControls';
import {
  DEFAULT_SETTINGS,
  parseSettings,
  reconcileBackend,
  toRetrievalOptions,
  type RetrievalSettings,
} from '@/utils/retrievalSettings';
import { THEME_KEY, keysFor, purgeLegacyKeys } from '@/utils/conversationStore';
import type { Tenant, BackendInfo, DomainInfo
} from '@ragstone/shared';
import type { GraphData, Message, QueryHistoryItem, QueryRequest } from '@/types';

const api = createClient();

const EMPTY_GRAPH: GraphData = { nodes: [], links: [] };

/** Keeps the history sidebar from growing without bound. */
const MAX_HISTORY_ITEMS = 200;

const newId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

function AppContent({ tenant: initialTenant }: { tenant: Tenant }) {
  const [darkMode, setDarkMode] = useState(() => readString(THEME_KEY) === 'dark');
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

  // The tenant is state, not a constant: switching brands must re-theme in
  // place. A reload would also work, but rebranding without one is the whole
  // claim being demonstrated.
  const [tenant, setTenant] = useState(initialTenant);
  const [switchingTenant, setSwitchingTenant] = useState(false);
  const theme = useMemo(() => buildTheme(tenant, darkMode), [tenant, darkMode]);
  // Storage is namespaced per tenant, so no path can surface one tenant's
  // conversations under another's branding.
  const keys = useMemo(() => keysFor(tenant.id), [tenant.id]);
  const [retrievalOpen, setRetrievalOpen] = useState(false);
  const [retrieval, setRetrieval] = useState<RetrievalSettings>(DEFAULT_SETTINGS);
  const [backends, setBackends] = useState<BackendInfo[]>([]);
  const [domains, setDomains] = useState<DomainInfo[]>([]);
  // Which subject this tenant is about, resolved from what the deployment holds.
  const domain = useMemo(() => resolveDomain(domains, tenant.domain), [domains, tenant.domain]);


  const handleTenantChange = useCallback(async (id: string) => {
    setSwitchingTenant(true);
    try {
      const resolution = await loadTenant(id);
      reportResolution(resolution);

      // Clear before the brand changes, not after. Storage is namespaced per
      // tenant so nothing can be written to the wrong place, but the answer
      // and the subgraph on screen belong to the tenant that asked for them
      // and must not survive even a frame under someone else's branding.
      abortRef.current?.abort();
      setIsStreaming(false);
      setCurrentStatus('');
      setMessages([]);
      setGraphData(EMPTY_GRAPH);
      setQueryHistory([]);

      setTenant(resolution.tenant);

      // Keep the URL honest, so the current view stays shareable. replaceState
      // rather than push: brand previews are not navigation history.
      const url = new URL(window.location.href);
      url.searchParams.set('tenant', id);
      window.history.replaceState({}, '', url);
    } finally {
      setSwitchingTenant(false);
    }
  }, []);


  // What this deployment can hold a graph about. Entity types come from here
  // rather than from the keys of the tenant's colour map, where a type existed
  // because somebody had given it a colour.
  useEffect(() => {
    const controller = new AbortController();
    void fetchDomains('', controller.signal).then(setDomains);
    return () => controller.abort();
  }, []);

  // What this deployment can retrieve from. The list is the server's to give;
  // a request names a backend and never an endpoint.
  useEffect(() => {
    const controller = new AbortController();
    void fetchBackends('', controller.signal).then((offered) => {
      setBackends(offered);
      setRetrieval((previous) =>
        reconcileBackend(
          previous,
          offered.map((backend) => backend.name),
        ),
      );
    });
    return () => controller.abort();
  }, []);

  // Clear anything written under the old unscoped schema, once, before the
  // first tenant hydrates.
  useEffect(() => {
    purgeLegacyKeys(window.localStorage);
  }, []);

  // Load this tenant's own session — on mount, and again whenever the tenant
  // changes. Keyed on `keys` rather than run once, so switching brand can
  // never leave the previous tenant's conversation on screen.
  useEffect(() => {
    hydrated.current = false;

    setQueryHistory(readJson<QueryHistoryItem[]>(keys.history, []));
    setRetrieval(parseSettings(readJson<unknown>(keys.retrieval, null)));
    const savedConversationId = readString(keys.current);

    if (savedConversationId) {
      setCurrentConversationId(savedConversationId);
      setMessages(readJson<Message[]>(keys.conversation(savedConversationId), []));
      setGraphData(readJson<GraphData>(keys.graph(savedConversationId), EMPTY_GRAPH));
    } else {
      const id = newId('conv');
      setCurrentConversationId(id);
      setMessages([]);
      setGraphData(EMPTY_GRAPH);
      writeString(keys.current, id);
    }

    hydrated.current = true;
  }, [keys]);

  // Abandon any in-flight request when the app goes away.
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!hydrated.current || !currentConversationId || messages.length === 0) return;

    // The conversation on screen is never a candidate for eviction: it is the
    // one thing the reader is definitely still using.
    const protect = [
      keys.conversation(currentConversationId),
      keys.graph(currentConversationId),
    ];

    // Trim before writing, so the common case is a write with room already
    // made; `saveWithRoom` covers the case the estimate got wrong, because the
    // browser counts the quota differently and other tabs share the origin.
    evict(window.localStorage, { protect });

    const saved = saveWithRoom(
      window.localStorage,
      () =>
        writeJson(keys.conversation(currentConversationId), messages) &&
        writeJson(keys.graph(currentConversationId), graphData),
      { protect },
    );

    if (!saved) {
      setNotice('This conversation could not be saved — browser storage is full.');
    }
  }, [messages, graphData, currentConversationId, keys]);

  // Both values, and the keys they are written under, belong in the
  // dependencies. Listing only `queryHistory` meant a changed retrieval setting
  // was persisted whenever a *query* happened to be recorded and not otherwise —
  // so a knob turned and then left alone was silently forgotten on reload.
  useEffect(() => {
    if (!hydrated.current) return;
    writeJson(keys.retrieval, retrieval);
    writeJson(keys.history, queryHistory);
  }, [queryHistory, retrieval, keys]);

  useEffect(() => {
    writeString(THEME_KEY, darkMode ? 'dark' : 'light');
  }, [darkMode]);

  // The browser tab is the most-seen piece of branding, and index.html cannot
  // know which tenant is rendering.
  useEffect(() => {
    document.title = tenant.brand.name;
  }, [tenant]);

  const handleNewChat = useCallback(() => {
    abortRef.current?.abort();
    const id = newId('conv');
    setCurrentConversationId(id);
    setMessages([]);
    setGraphData(EMPTY_GRAPH);
    setCurrentStatus('');
    setIsStreaming(false);
    writeString(keys.current, id);
    // Same reason as the others: without `keys`, starting a new chat after a
    // tenant switch records it under the previous tenant's pointer.
  }, [keys]);

  const handleLoadConversation = useCallback((conversationId: string) => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setCurrentStatus('');
    setCurrentConversationId(conversationId);
    writeString(keys.current, conversationId);
    setMessages(readJson<Message[]>(keys.conversation(conversationId), []));
    setGraphData(readJson<GraphData>(keys.graph(conversationId), EMPTY_GRAPH));
    setSidebarOpen(false);
    // `keys` belongs in the dependencies: without it this callback keeps the
    // keys it was created with, so loading a conversation after a tenant switch
    // reads the previous tenant's storage. That is the leak the scoped keys
    // exist to prevent, reintroduced by a stale closure.
  }, [keys]);

  const handleDeleteConversation = useCallback(
    (conversationId: string) => {
      remove(keys.conversation(conversationId));
      remove(keys.graph(conversationId));
      setQueryHistory((prev) => prev.filter((item) => item.conversationId !== conversationId));

      if (conversationId === currentConversationId) {
        handleNewChat();
      }
    },
    [currentConversationId, handleNewChat, keys],
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleQuery = useCallback(
    // `files` is attachment ids now, not File objects: the composer uploads on
    // selection so a rejection is visible while there is still time to act, and
    // only what actually arrived reaches the request.
    async (query: string, files?: string[], urls?: string[], entityIds?: string[]) => {
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
          files,
          urls,
          entityIds,
        },
        options: { stream: true, response_format: 'markdown' },
        retrieval: toRetrievalOptions(retrieval),
      };

      let answer = '';
      const recorder = new TraceRecorder();

      try {
        for await (const event of api.streamQuery(request, controller.signal)) {
          switch (event.type) {
            case 'status':
              setCurrentStatus(event.data.message);
              recorder.startPhase(event.data.phase, event.data.message);
              break;

            case 'graph':
              setGraphData(event.data);
              break;

            case 'delta':
              // Deltas are increments; the running answer lives here.
              recorder.markFirstToken();
              answer += event.data.text;
              patchAssistant({ content: answer });
              break;

            case 'done':
              recorder.finish(event.data);
              patchAssistant({
                status: 'complete',
                citations: event.data.citations,
                trace: recorder.snapshot(),
              });
              break;

            case 'error':
              patchAssistant({ status: 'error', error: event.data.message });
              break;
          }
        }
      } catch (error) {
        recorder.abandon();
        if (controller.signal.aborted) {
          patchAssistant({
            trace: recorder.snapshot(),
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
    [currentConversationId, isStreaming, messages, retrieval],
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
    exportConversationToPDF(messages, currentConversationId, tenant.brand.name),
  );
  const handleExportCSV = guard(noMessages, 'There is no conversation to export yet.', () =>
    exportConversationToCSV(messages, currentConversationId),
  );
  const handleExportGraphPDF = guard(noGraph, 'There is no graph to export yet.', () =>
    exportGraphToPDF(graphData, currentConversationId, tenant.brand.name),
  );
  const handleExportGraphCSV = guard(noGraph, 'There is no graph to export yet.', () =>
    exportGraphToCSV(graphData, currentConversationId),
  );
  const handleExportGraphJsonLD = guard(noGraph, 'There is no graph to export yet.', () =>
    exportGraphToJsonLD(graphData, currentConversationId),
  );


  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100%' }}>
        <RetrievalControls
          open={retrievalOpen}
          onClose={() => setRetrievalOpen(false)}
          settings={retrieval}
          onChange={setRetrieval}
          backends={backends}
          // The domain is the source; the tenant's own colour keys are the
          // fallback for a build with no service behind it — VITE_USE_MOCK
          // runs the console with no API at all, and offering no types there
          // would be a worse answer than offering the ones it does know.
          entityTypes={domain?.classes ?? Object.keys(tenant.graph.nodeColors)}
          disabled={isStreaming}
        />

        <Navbar
          brand={tenant.brand}
          switcher={
            switcherEnabled() ? (
              <TenantSwitcher
                options={availableTenants()}
                currentId={tenant.id}
                onSelect={(id) => void handleTenantChange(id)}
                busy={switchingTenant}
              />
            ) : undefined
          }
          onMenuClick={() => setSidebarOpen(true)}
          onRetrievalClick={() => setRetrievalOpen(true)}
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
                  brand={tenant.brand}
                  // A tenant's own phrasing wins; the domain supplies starters
                  // when a tenant declares none, which is what makes a subject
                  // usable before anyone has written copy for it.
                  copy={
                    tenant.copy.starters.length > 0 || !domain
                      ? tenant.copy
                      : { ...tenant.copy, starters: domain.starters }
                  }
                />
              </Box>
              <QueryInput
                onSubmit={handleQuery}
                onStop={handleStop}
                isStreaming={isStreaming}
                placeholder={tenant.copy.inputPlaceholder}
              />
            </Box>

            <Box sx={{ flex: 1, minHeight: { xs: '50vh', lg: 'auto' } }}>
              <D3GraphVisualization data={graphData} tenant={tenant} />
            </Box>
          </Box>
        </Box>

        <QueryHistory
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          history={queryHistory}
          currentConversationId={currentConversationId}
          conversationPrefix={keys.conversationPrefix}
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

interface AppProps extends React.ComponentProps<'div'> {
  /** Resolved before render in main.tsx — see loadTenant. */
  tenant: Tenant;
}

function App({ tenant, ...props }: AppProps) {
  // Explicitly consume all props (including Figma's data-fg-* attributes)
  // but don't pass them to child components. This prevents React warnings
  // about unsupported props on Material UI components.
  void props;
  return <AppContent tenant={tenant} />;
}

export default App;
