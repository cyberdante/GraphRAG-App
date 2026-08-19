import React, { useMemo, useState } from 'react';
import { AttachmentPrompt, type PromptKind } from './AttachmentPrompt';
import { describeSensitive, findSensitive } from '@/utils/sensitive';
import {
  nextLocalId,
  readyIds,
  uploadAttachments,
  type AttachmentState,
} from '@/api/attachments';
import {
  Alert,
  Box,
  CircularProgress,
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
  Stop as StopIcon,
  ErrorOutline as ErrorOutlineIcon,
  PrivacyTip as PrivacyTipIcon,
} from '@mui/icons-material';

interface QueryInputProps {
  placeholder: string;
  /** `files` carries attachment ids from the upload, not names. */
  onSubmit: (query: string, files?: string[], urls?: string[], entityIds?: string[]) => void;
  /** Cancels the answer in flight. */
  onStop?: () => void;
  isStreaming?: boolean;
}

export const QueryInput: React.FC<QueryInputProps> = ({ onSubmit, onStop, isStreaming, placeholder }) => {
  const disabled = isStreaming;
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState<AttachmentState[]>([]);
  const [urls, setUrls] = useState<string[]>([]);
  const [entityIds, setEntityIds] = useState<string[]>([]);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [prompting, setPrompting] = useState<PromptKind | null>(null);

  // Personal data is noticed, not removed. The question goes exactly as typed;
  // what changes is that the person knows what is in it before it leaves the
  // browser. Cheap enough per keystroke at the length of a question.
  const sensitive = useMemo(() => describeSensitive(findSensitive(query)), [query]);

  // Only what actually arrived. Sending an id for a rejected file would ask
  // the service to answer from a document it never received.
  const attached = readyIds(files);
  const uploading = files.some((file) => file.status === 'uploading');

  const handleSubmit = () => {
    if (query.trim() || attached.length > 0 || urls.length > 0 || entityIds.length > 0) {
      onSubmit(query, attached, urls, entityIds);
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

  // Uploaded on selection rather than on submit, so a rejection is visible
  // while there is still time to do something about it.
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = Array.from(e.target.files ?? []).map((file) => ({
      file,
      localId: nextLocalId(),
    }));
    if (chosen.length === 0) return;

    // Reset the input so choosing the same file twice still fires a change.
    e.target.value = '';

    setFiles((prev) => [
      ...prev,
      ...chosen.map(({ file, localId }) => ({
        status: 'uploading' as const,
        name: file.name,
        localId,
      })),
    ]);

    const results = await uploadAttachments(chosen);
    setFiles((prev) =>
      prev.map((item) => results.find((result) => result.localId === item.localId) ?? item),
    );
  };

  // Was `window.prompt()`, which cannot be branded, cannot explain a rejection,
  // and is suppressed entirely by some browsers and every embedded webview.
  const handleAddUrl = () => {
    setPrompting('url');
    setAnchorEl(null);
  };

  const handleAddEntityId = () => {
    setPrompting('entity');
    setAnchorEl(null);
  };

  const handlePromptConfirm = (value: string) => {
    if (prompting === 'url') setUrls((prev) => [...prev, value]);
    else if (prompting === 'entity') setEntityIds((prev) => [...prev, value]);
    setPrompting(null);
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
      sx={{
        p: 2,
        borderRadius: 2,
        bgcolor: 'background.paper'
      }}
    >
      <AttachmentPrompt
        kind={prompting}
        onCancel={() => setPrompting(null)}
        onConfirm={handlePromptConfirm}
      />

      {/* Attachments Display */}
      {(files.length > 0 || urls.length > 0 || entityIds.length > 0) && (
        <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
          {files.map((file, index) => (
            <Tooltip
              key={file.localId}
              title={
                file.status === 'rejected'
                  ? file.detail
                  : file.status === 'ready'
                    ? `${file.characters.toLocaleString()} characters attached`
                    : 'Uploading…'
              }
              describeChild
            >
              <Chip
                label={file.status === 'rejected' ? `${file.name} — not attached` : file.name}
                onDelete={() => removeFile(index)}
                // The icon carries the state as well as the colour: a reader who
                // cannot separate the hues still sees a spinner, a paperclip or
                // a warning.
                icon={
                  file.status === 'uploading' ? (
                    <CircularProgress size={14} sx={{ ml: 1 }} />
                  ) : file.status === 'rejected' ? (
                    <ErrorOutlineIcon />
                  ) : (
                    <AttachFileIcon />
                  )
                }
                color={file.status === 'rejected' ? 'error' : 'primary'}
              />
            </Tooltip>
          ))}
          {urls.map((url, index) => (
            <Chip
              key={`url-${index}`}
              label={url}
              onDelete={() => removeUrl(index)}
              icon={<LinkIcon />}
              color="secondary"
            />
          ))}
          {entityIds.map((id, index) => (
            <Chip
              key={`entity-${index}`}
              label={id}
              onDelete={() => removeEntityId(index)}
              icon={<TagIcon />}
              color="success"
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
          sx={{
            '& .MuiOutlinedInput-root': {
              borderRadius: 2
            }
          }}
        />

        {/* Actions */}
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <Tooltip title="More options" describeChild>
            <span>
              <IconButton
                onClick={(e) => setAnchorEl(e.currentTarget)}
                disabled={disabled}
                color="primary"
                aria-label="More options"
              >
                <MoreVertIcon />
              </IconButton>
            </span>
          </Tooltip>

          {isStreaming ? (
            <Tooltip title="Stop generating" describeChild>
              <span>
                <IconButton
                  onClick={onStop}
                  aria-label="Stop generating"
                  sx={{
                    bgcolor: 'error.main',
                    color: 'error.contrastText',
                    '&:hover': { bgcolor: 'error.dark' }
                  }}
                >
                  <StopIcon />
                </IconButton>
              </span>
            </Tooltip>
          ) : (
            <Tooltip title="Send query" describeChild>
              <span>
                <IconButton
                  onClick={handleSubmit}
                  aria-label="Send query"
                  disabled={
                    uploading ||
                    (!query.trim() &&
                      attached.length === 0 &&
                      urls.length === 0 &&
                      entityIds.length === 0)
                  }
                  color="primary"
                  sx={{
                    bgcolor: 'primary.main',
                    color: 'primary.contrastText',
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

      {sensitive && (
        <Alert
          severity="warning"
          icon={<PrivacyTipIcon fontSize="inherit" />}
          // Announced rather than interrupting: the question is still valid and
          // still sendable, and a modal here would train people to dismiss it.
          role="status"
          sx={{ mt: 1.5, alignItems: 'center' }}
        >
          {sensitive}
        </Alert>
      )}

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