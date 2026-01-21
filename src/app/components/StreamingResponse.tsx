import React, { useEffect, useRef } from 'react';
import {
  Box,
  Paper,
  Typography,
  LinearProgress,
  Chip,
  Stack,
  Card,
  CardContent,
  Divider
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  Source as SourceIcon,
  Psychology as PsychologyIcon
} from '@mui/icons-material';
import { Citation } from '@/types';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  status?: string;
  citations?: Citation[];
}

interface StreamingResponseProps {
  messages: Message[];
  isStreaming: boolean;
  currentStatus?: string;
}

export const StreamingResponse: React.FC<StreamingResponseProps> = ({
  messages,
  isStreaming,
  currentStatus
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Messages Container */}
      <Box
        sx={{
          flexGrow: 1,
          overflow: 'auto',
          p: 3,
          display: 'flex',
          flexDirection: 'column',
          gap: 2
        }}
      >
        {messages.length === 0 && !isStreaming && (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              gap: 2,
              color: 'text.secondary'
            }}
          >
            <PsychologyIcon sx={{ fontSize: 80, opacity: 0.3 }} />
            <Typography variant="h6" align="center">
              Welcome to GraphRAG Console
            </Typography>
            <Typography variant="body2" align="center" sx={{ maxWidth: 500 }}>
              Ask questions about your supply chain data. I'll analyze the knowledge graph
              and provide insights with citations and visual representations.
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap', justifyContent: 'center', gap: 1 }}>
              <Chip label="Try: Which suppliers are at risk?" size="small" variant="outlined" />
              <Chip label="Try: Show shipment status" size="small" variant="outlined" />
              <Chip label="Try: What are the inventory levels?" size="small" variant="outlined" />
            </Stack>
          </Box>
        )}

        {messages.map((message, index) => (
          <MessageBubble key={index} message={message} />
        ))}

        {isStreaming && currentStatus && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {currentStatus}
            </Typography>
          </Box>
        )}

        <div ref={messagesEndRef} />
      </Box>

      {/* Streaming Progress */}
      {isStreaming && (
        <Box sx={{ px: 3, pb: 2 }}>
          <LinearProgress />
        </Box>
      )}
    </Box>
  );
};

const MessageBubble: React.FC<{ message: Message }> = ({ message }) => {
  const isUser = message.role === 'user';

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start'
      }}
    >
      <Paper
        elevation={1}
        sx={{
          maxWidth: '85%',
          p: 2,
          bgcolor: isUser ? 'primary.main' : 'background.paper',
          color: isUser ? 'primary.contrastText' : 'text.primary',
          borderRadius: 2,
          ...(isUser && {
            borderBottomRightRadius: 4
          }),
          ...(!isUser && {
            borderBottomLeftRadius: 4
          })
        }}
      >
        <Typography
          variant="body1"
          sx={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word'
          }}
        >
          {message.content}
        </Typography>

        {!isUser && message.status && (
          <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <CheckCircleIcon fontSize="small" color="success" />
            <Typography variant="caption" color="text.secondary">
              {message.status}
            </Typography>
          </Box>
        )}

        {!isUser && message.citations && message.citations.length > 0 && (
          <>
            <Divider sx={{ my: 2 }} />
            <Box sx={{ mt: 2 }}>
              <Typography variant="caption" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
                <SourceIcon fontSize="small" />
                Sources ({message.citations.length})
              </Typography>
              <Stack spacing={1}>
                {message.citations.map((citation) => (
                  <Card
                    key={citation.id}
                    variant="outlined"
                    sx={{
                      bgcolor: 'background.default',
                      borderRadius: 1
                    }}
                  >
                    <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                      <Typography variant="caption" fontWeight="bold">
                        {citation.source}
                      </Typography>
                      <Typography variant="caption" display="block" color="text.secondary">
                        {citation.text}
                      </Typography>
                      {citation.confidence && (
                        <Chip
                          label={`${Math.round(citation.confidence * 100)}% confidence`}
                          size="small"
                          sx={{ mt: 0.5, height: 20, fontSize: '0.7rem' }}
                        />
                      )}
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            </Box>
          </>
        )}
      </Paper>
    </Box>
  );
};
