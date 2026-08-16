import React, { useState } from 'react';
import {
  Box,
  TextField,
  IconButton,
  Paper,
  Chip,
  Stack,
  Tooltip,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText
} from '@mui/material';
import {
  Send as SendIcon,
  AttachFile as AttachFileIcon,
  Link as LinkIcon,
  Tag as TagIcon,
  MoreVert as MoreVertIcon,
  Stop as StopIcon
} from '@mui/icons-material';

interface QueryInputProps {
  placeholder: string;
  onSubmit: (query: string, files?: File[], urls?: string[], entityIds?: string[]) => void;
  /** Cancels the answer in flight. */
  onStop?: () => void;
  isStreaming?: boolean;
}

export const QueryInput: React.FC<QueryInputProps> = ({ onSubmit, onStop, isStreaming, placeholder }) => {
  const disabled = isStreaming;
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [urls, setUrls] = useState<string[]>([]);
  const [entityIds, setEntityIds] = useState<string[]>([]);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  const handleSubmit = () => {
    if (query.trim() || files.length > 0 || urls.length > 0 || entityIds.length > 0) {
      onSubmit(query, files, urls, entityIds);
      setQuery('');
      setFiles([]);
      setUrls([]);
      setEntityIds([]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(prev => [...prev, ...Array.from(e.target.files!)]);
    }
  };

  const handleAddUrl = () => {
    const url = prompt('Enter URL:');
    if (url) {
      setUrls(prev => [...prev, url]);
    }
    setAnchorEl(null);
  };

  const handleAddEntityId = () => {
    const id = prompt('Enter Entity ID:');
    if (id) {
      setEntityIds(prev => [...prev, id]);
    }
    setAnchorEl(null);
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const removeUrl = (index: number) => {
    setUrls(prev => prev.filter((_, i) => i !== index));
  };

  const removeEntityId = (index: number) => {
    setEntityIds(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <Paper
      elevation={2}
      sx={{
        p: 2,
        borderRadius: 2,
        bgcolor: 'background.paper'
      }}
    >
      {/* Attachments Display */}
      {(files.length > 0 || urls.length > 0 || entityIds.length > 0) && (
        <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
          {files.map((file, index) => (
            <Chip
              key={`file-${index}`}
              label={file.name}
              onDelete={() => removeFile(index)}
              size="small"
              icon={<AttachFileIcon />}
              color="primary"
              variant="outlined"
            />
          ))}
          {urls.map((url, index) => (
            <Chip
              key={`url-${index}`}
              label={url}
              onDelete={() => removeUrl(index)}
              size="small"
              icon={<LinkIcon />}
              color="secondary"
              variant="outlined"
            />
          ))}
          {entityIds.map((id, index) => (
            <Chip
              key={`entity-${index}`}
              label={id}
              onDelete={() => removeEntityId(index)}
              size="small"
              icon={<TagIcon />}
              color="success"
              variant="outlined"
            />
          ))}
        </Stack>
      )}

      {/* Input Area */}
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
        <TextField
          fullWidth
          multiline
          maxRows={4}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          variant="outlined"
          sx={{
            '& .MuiOutlinedInput-root': {
              borderRadius: 2
            }
          }}
        />

        {/* Actions */}
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <Tooltip title="More options">
            <span>
              <IconButton
                onClick={(e) => setAnchorEl(e.currentTarget)}
                disabled={disabled}
                color="primary"
              >
                <MoreVertIcon />
              </IconButton>
            </span>
          </Tooltip>

          {isStreaming ? (
            <Tooltip title="Stop generating">
              <span>
                <IconButton
                  onClick={onStop}
                  aria-label="Stop generating"
                  sx={{
                    bgcolor: 'error.main',
                    color: 'white',
                    '&:hover': { bgcolor: 'error.dark' }
                  }}
                >
                  <StopIcon />
                </IconButton>
              </span>
            </Tooltip>
          ) : (
            <Tooltip title="Send query">
              <span>
                <IconButton
                  onClick={handleSubmit}
                  aria-label="Send query"
                  disabled={!query.trim() && files.length === 0 && urls.length === 0 && entityIds.length === 0}
                  color="primary"
                  sx={{
                    bgcolor: 'primary.main',
                    color: 'white',
                    '&:hover': {
                      bgcolor: 'primary.dark'
                    },
                    '&.Mui-disabled': {
                      bgcolor: 'action.disabledBackground'
                    }
                  }}
                >
                  <SendIcon />
                </IconButton>
              </span>
            </Tooltip>
          )}
        </Box>
      </Box>

      {/* Options Menu */}
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
      >
        <MenuItem component="label">
          <ListItemIcon>
            <AttachFileIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Upload File</ListItemText>
          <input
            type="file"
            hidden
            multiple
            onChange={handleFileSelect}
          />
        </MenuItem>
        <MenuItem onClick={handleAddUrl}>
          <ListItemIcon>
            <LinkIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Add URL</ListItemText>
        </MenuItem>
        <MenuItem onClick={handleAddEntityId}>
          <ListItemIcon>
            <TagIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Add Entity ID</ListItemText>
        </MenuItem>
      </Menu>
    </Paper>
  );
};