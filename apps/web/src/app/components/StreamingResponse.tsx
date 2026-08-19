import React, { useEffect, useRef } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  Psychology as PsychologyIcon,
  Source as SourceIcon,
  StopCircle as StopCircleIcon,
} from '@mui/icons-material';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { IssuedQuery, TenantBrand, TenantCopy } from '@ragstone/shared';
import type { QueryTrace } from '@/api/trace';
import type { Message } from '@/types';
import { TracePanel } from './TracePanel';

interface StreamingResponseProps {
  messages: Message[];
  isStreaming: boolean;
  currentStatus?: string;
  onRetry?: () => void;
  brand: TenantBrand;
  copy: TenantCopy;
  /** Hands a query the pipeline issued to the console, via the trace panel. */
  onOpenQuery?: (query: IssuedQuery) => void;
}

export const StreamingResponse: React.FC<StreamingResponseProps> = ({
  messages,
  isStreaming,
  currentStatus,
  onRetry,
  brand,
  copy,
  onOpenQuery,
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box
        sx={{
          flexGrow: 1,
          overflow: 'auto',
          p: 3,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        {messages.length === 0 && !isStreaming && <EmptyState brand={brand} copy={copy} />}

        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            onRetry={onRetry}
            onOpenQuery={onOpenQuery}
          />
        ))}

        {isStreaming && currentStatus && (
          <Typography variant="body2" color="text.secondary">
            {currentStatus}
          </Typography>
        )}

        <div ref={messagesEndRef} />
      </Box>

      {isStreaming && (
        <Box sx={{ px: 3, pb: 2 }}>
          <LinearProgress />
        </Box>
      )}
    </Box>
  );
};

const EmptyState: React.FC<{ brand: TenantBrand; copy: TenantCopy }> = ({ brand, copy }) => (
  <Box
    sx={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      gap: 2,
      color: 'text.secondary',
    }}
  >
    <PsychologyIcon sx={{ fontSize: 80, opacity: 0.3 }} />
    <Typography variant="h6" align="center">
      Welcome to {brand.name}
    </Typography>
    <Typography variant="body2" align="center" sx={{ maxWidth: 500 }}>
      {copy.welcome}
    </Typography>
    <Stack
      direction="row"
      spacing={1}
      sx={{ mt: 2, flexWrap: 'wrap', justifyContent: 'center', gap: 1 }}
    >
      {copy.starters.map((starter) => (
        <Chip key={starter} label={starter} />
      ))}
    </Stack>
  </Box>
);

/**
 * Styling for rendered markdown. Answers arrive as markdown and used to be
 * printed raw, so headings and tables showed up as punctuation.
 */
const markdownSx = {
  '& > *:first-of-type': { mt: 0 },
  '& > *:last-child': { mb: 0 },
  '& p': { my: 1 },
  '& h1, & h2, & h3, & h4': { mt: 2, mb: 1, fontWeight: 600, lineHeight: 1.3 },
  '& h1': { fontSize: '1.35rem' },
  '& h2': { fontSize: '1.2rem' },
  '& h3': { fontSize: '1.05rem' },
  '& ul, & ol': { my: 1, pl: 3 },
  '& li': { mb: 0.5 },
  '& code': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '0.875em',
    bgcolor: 'action.hover',
    px: 0.5,
    py: 0.25,
    borderRadius: 0.5,
  },
  '& pre': {
    my: 1,
    p: 1.5,
    bgcolor: 'action.hover',
    borderRadius: 1,
    overflowX: 'auto',
  },
  '& pre code': { bgcolor: 'transparent', p: 0 },
  '& blockquote': {
    my: 1,
    ml: 0,
    pl: 2,
    borderLeft: 3,
    borderColor: 'divider',
    color: 'text.secondary',
  },
  // Tables can be wider than the bubble; let them scroll on their own.
  '& .markdown-table-wrap': { overflowX: 'auto', my: 1.5 },
  '& table': { borderCollapse: 'collapse', width: '100%', fontSize: '0.875rem' },
  '& th, & td': { border: 1, borderColor: 'divider', px: 1, py: 0.5, textAlign: 'left' },
  '& th': { fontWeight: 600, bgcolor: 'action.hover' },
  '& a': { color: 'primary.main' },
  '& hr': { my: 2, border: 0, borderTop: 1, borderColor: 'divider' },
} as const;

const markdownComponents = {
  // Wrapped so a wide table scrolls instead of stretching the layout.
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="markdown-table-wrap">
      <table>{children}</table>
    </div>
  ),
};

const MessageBubble: React.FC<{
  message: Message;
  onRetry?: () => void;
  onOpenQuery?: (query: IssuedQuery) => void;
}> = ({ message, onRetry, onOpenQuery }) => {
  const isUser = message.role === 'user';
  const hasFailed = message.status === 'error';
  const wasStopped = message.status === 'stopped';

  return (
    <Box sx={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
      <Paper
        sx={{
          maxWidth: '85%',
          minWidth: hasFailed ? '60%' : undefined,
          p: 2,
          bgcolor: isUser ? 'primary.main' : 'background.paper',
          color: isUser ? 'primary.contrastText' : 'text.primary',
          borderRadius: 2,
          ...(isUser ? { borderBottomRightRadius: 4 } : { borderBottomLeftRadius: 4 }),
        }}
      >
        {isUser ? (
          <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {message.content}
          </Typography>
        ) : (
          message.content && (
            <Box sx={markdownSx}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {message.content}
              </ReactMarkdown>
            </Box>
          )
        )}

        {hasFailed && (
          <Alert
            severity="error"
            sx={{ mt: message.content ? 2 : 0 }}
            action={
              onRetry && (
                <Button color="inherit" onClick={onRetry}>
                  Try again
                </Button>
              )
            }
          >
            {message.error ?? 'Something went wrong.'}
          </Alert>
        )}

        {wasStopped && (
          <Box sx={{ mt: message.content ? 1 : 0, display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <StopCircleIcon fontSize="small" color="disabled" />
            <Typography variant="caption" color="text.secondary">
              {message.error ?? 'Stopped'}
            </Typography>
          </Box>
        )}

        {message.status === 'complete' && (
          <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <CheckCircleIcon fontSize="small" color="success" />
            <Typography variant="caption" color="text.secondary">
              Complete
            </Typography>
          </Box>
        )}

        {!isUser && message.trace ? (
          <TracePanel trace={message.trace as QueryTrace} onOpenQuery={onOpenQuery} />
        ) : null}

        {!isUser && message.citations && message.citations.length > 0 && (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography
              variant="caption"
              sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}
            >
              <SourceIcon fontSize="small" />
              Sources ({message.citations.length})
            </Typography>
            <Stack spacing={1}>
              {message.citations.map((citation) => (
                <Card
                  key={citation.id}
                  sx={{ bgcolor: 'background.default', borderRadius: 1 }}
                >
                  <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                    <Typography variant="caption" fontWeight="bold">
                      {citation.source}
                    </Typography>
                    <Typography variant="caption" display="block" color="text.secondary">
                      {citation.text}
                    </Typography>
                    {citation.confidence !== undefined && (
                      <Chip
                        label={`${Math.round(citation.confidence * 100)}% confidence`}
                        sx={{ mt: 0.5, height: 20, fontSize: '0.7rem' }}
                      />
                    )}
                  </CardContent>
                </Card>
              ))}
            </Stack>
          </>
        )}
      </Paper>
    </Box>
  );
};
