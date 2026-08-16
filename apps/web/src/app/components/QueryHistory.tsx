import React, { useEffect, useState } from 'react';
import {
  Box,
  Chip,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  Stack,
  Typography,
} from '@mui/material';
import {
  Chat as ChatIcon,
  Close as CloseIcon,
  Delete as DeleteIcon,
  History as HistoryIcon,
} from '@mui/icons-material';
import { format } from 'date-fns';
import type { Message, QueryHistoryItem } from '@/types';
import { keys, readJson } from '@/utils/storage';

interface QueryHistoryProps {
  open: boolean;
  onClose: () => void;
  history: QueryHistoryItem[];
  currentConversationId: string;
  onConversationLoad: (conversationId: string) => void;
  onConversationDelete: (conversationId: string) => void;
}

interface ConversationSummary {
  id: string;
  firstQuery: string;
  queryCount: number;
  timestamp: Date;
}

const CONVERSATION_PREFIX = 'ragstone-conversation-';

/** Reads the stored conversations back into a list for the drawer. */
function loadConversations(): ConversationSummary[] {
  const summaries: ConversationSummary[] = [];

  for (const key of keys()) {
    if (!key.startsWith(CONVERSATION_PREFIX)) continue;

    const messages = readJson<Message[]>(key, []);
    const userMessages = messages.filter((message) => message.role === 'user');
    const first = userMessages[0];
    if (!first) continue;

    summaries.push({
      id: key.slice(CONVERSATION_PREFIX.length),
      firstQuery: first.content,
      queryCount: userMessages.length,
      timestamp: new Date(first.timestamp),
    });
  }

  return summaries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}

export const QueryHistory: React.FC<QueryHistoryProps> = ({
  open,
  onClose,
  history,
  currentConversationId,
  onConversationLoad,
  onConversationDelete,
}) => {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  useEffect(() => {
    if (open) setConversations(loadConversations());
  }, [open, history]);

  const confirmDelete = (conversationId: string, event: React.MouseEvent) => {
    event.stopPropagation();

    // Two clicks instead of a blocking confirm(): the first arms it, the
    // second commits.
    if (pendingDelete !== conversationId) {
      setPendingDelete(conversationId);
      return;
    }

    onConversationDelete(conversationId);
    setConversations((prev) => prev.filter((conversation) => conversation.id !== conversationId));
    setPendingDelete(null);
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{ paper: { sx: { width: { xs: '100%', sm: 360 }, mt: 8 } } }}
    >
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <HistoryIcon color="primary" />
          <Typography variant="h6">Conversation History</Typography>
        </Box>
        <IconButton onClick={onClose} size="small" aria-label="Close history">
          <CloseIcon />
        </IconButton>
      </Box>
      <Divider />

      <List sx={{ px: 1, overflow: 'auto' }}>
        {conversations.length === 0 ? (
          <Box sx={{ p: 3, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              No conversations yet. Start by asking a question.
            </Typography>
          </Box>
        ) : (
          conversations.map((conversation) => {
            const isCurrent = conversation.id === currentConversationId;
            const isArmed = pendingDelete === conversation.id;

            return (
              <ListItem key={conversation.id} disablePadding sx={{ mb: 1 }}>
                <ListItemButton
                  selected={isCurrent}
                  onClick={() => {
                    onConversationLoad(conversation.id);
                    onClose();
                  }}
                  sx={{
                    borderRadius: 1,
                    border: 1,
                    borderColor: isCurrent ? 'primary.main' : 'divider',
                    p: 1.5,
                    '&:hover': { bgcolor: 'action.hover', borderColor: 'primary.main' },
                  }}
                >
                  <Box sx={{ width: '100%' }}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                      <ChatIcon fontSize="small" color="primary" />
                      <Chip
                        label={`${conversation.queryCount} ${
                          conversation.queryCount === 1 ? 'query' : 'queries'
                        }`}
                        size="small"
                        variant="outlined"
                      />
                      {isCurrent && <Chip label="Current" size="small" color="primary" />}
                    </Stack>
                    <Typography
                      variant="body2"
                      sx={{
                        fontWeight: 500,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        mb: 0.5,
                      }}
                    >
                      {conversation.firstQuery}
                    </Typography>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Typography variant="caption" color="text.secondary">
                        {format(conversation.timestamp, 'MMM d, yyyy HH:mm')}
                      </Typography>
                      <Stack direction="row" alignItems="center" spacing={0.5}>
                        {isArmed && (
                          <Typography variant="caption" color="error">
                            Click again to delete
                          </Typography>
                        )}
                        <IconButton
                          size="small"
                          color={isArmed ? 'error' : 'default'}
                          aria-label={`Delete conversation: ${conversation.firstQuery}`}
                          onClick={(event) => confirmDelete(conversation.id, event)}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Stack>
                    </Stack>
                  </Box>
                </ListItemButton>
              </ListItem>
            );
          })
        )}
      </List>
    </Drawer>
  );
};
