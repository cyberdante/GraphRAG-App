import React, { useState, useEffect } from 'react';
import {
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Typography,
  Box,
  IconButton,
  Divider,
  Chip,
  Stack
} from '@mui/material';
import { 
  Close as CloseIcon, 
  History as HistoryIcon,
  Chat as ChatIcon,
  Delete as DeleteIcon
} from '@mui/icons-material';
import { QueryHistoryItem } from '@/types';
import { format } from 'date-fns';

interface QueryHistoryProps {
  open: boolean;
  onClose: () => void;
  history: QueryHistoryItem[];
  onSelectQuery: (query: string) => void;
  onConversationLoad: (conversationId: string) => void;
}

interface ConversationGroup {
  id: string;
  queries: QueryHistoryItem[];
  firstQuery: string;
  timestamp: Date;
}

export const QueryHistory: React.FC<QueryHistoryProps> = ({
  open,
  onClose,
  history,
  onSelectQuery,
  onConversationLoad
}) => {
  const [conversations, setConversations] = useState<ConversationGroup[]>([]);

  useEffect(() => {
    // Get all unique conversation IDs from localStorage
    const convGroups: ConversationGroup[] = [];
    const keys = Object.keys(localStorage);
    
    keys.forEach(key => {
      if (key.startsWith('graphrag-conversation-')) {
        const conversationId = key.replace('graphrag-conversation-', '');
        const messagesStr = localStorage.getItem(key);
        if (messagesStr) {
          const messages = JSON.parse(messagesStr);
          const userMessages = messages.filter((m: any) => m.role === 'user');
          if (userMessages.length > 0) {
            convGroups.push({
              id: conversationId,
              queries: userMessages.map((m: any, idx: number) => ({
                id: `${conversationId}-${idx}`,
                query: m.content,
                timestamp: new Date(m.timestamp || Date.now())
              })),
              firstQuery: userMessages[0].content,
              timestamp: new Date(userMessages[0].timestamp || Date.now())
            });
          }
        }
      }
    });

    // Sort by timestamp descending
    convGroups.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    setConversations(convGroups);
  }, [open, history]);

  const handleDeleteConversation = (conversationId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Delete this conversation?')) {
      localStorage.removeItem(`graphrag-conversation-${conversationId}`);
      localStorage.removeItem(`graphrag-graph-${conversationId}`);
      setConversations(prev => prev.filter(c => c.id !== conversationId));
    }
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: { xs: '100%', sm: 360 },
          mt: 8
        }
      }}
    >
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <HistoryIcon color="primary" />
          <Typography variant="h6">Conversation History</Typography>
        </Box>
        <IconButton onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </Box>
      <Divider />
      
      <List sx={{ px: 1, overflow: 'auto' }}>
        {conversations.length === 0 ? (
          <Box sx={{ p: 3, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              No conversations yet. Start by asking a question!
            </Typography>
          </Box>
        ) : (
          conversations.map((conv) => (
            <ListItem key={conv.id} disablePadding sx={{ mb: 1 }}>
              <ListItemButton
                onClick={() => {
                  onConversationLoad(conv.id);
                  onClose();
                }}
                sx={{
                  borderRadius: 1,
                  border: 1,
                  borderColor: 'divider',
                  p: 1.5,
                  '&:hover': {
                    bgcolor: 'action.hover',
                    borderColor: 'primary.main'
                  }
                }}
              >
                <Box sx={{ width: '100%' }}>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                    <ChatIcon fontSize="small" color="primary" />
                    <Chip 
                      label={`${conv.queries.length} ${conv.queries.length === 1 ? 'query' : 'queries'}`}
                      size="small" 
                      variant="outlined"
                    />
                  </Stack>
                  <Typography 
                    variant="body2" 
                    sx={{ 
                      fontWeight: 500,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      mb: 0.5
                    }}
                  >
                    {conv.firstQuery}
                  </Typography>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="caption" color="text.secondary">
                      {format(conv.timestamp, 'MMM d, yyyy HH:mm')}
                    </Typography>
                    <IconButton 
                      size="small" 
                      onClick={(e) => handleDeleteConversation(conv.id, e)}
                      sx={{ ml: 1 }}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                </Box>
              </ListItemButton>
            </ListItem>
          ))
        )}
      </List>
    </Drawer>
  );
};