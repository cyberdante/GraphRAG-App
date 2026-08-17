import React, { useEffect, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';

export type PromptKind = 'url' | 'entity';

interface AttachmentPromptProps {
  kind: PromptKind | null;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}

/**
 * Asking for a URL or an entity id, in the app rather than in the browser.
 *
 * These were the last two `window.prompt()` calls in the product. A native
 * prompt cannot be branded, cannot be styled, cannot say why a value was
 * rejected, is suppressed outright by some browsers and by every embedded
 * webview, and blocks the whole page while it is open. In a console whose
 * proposition is that it carries the client's identity, it is also the one
 * dialog that is unmistakably not theirs.
 *
 * Validation happens here as well as on the service. The service is the
 * authority — it has to be, since anything can call it — but a mistyped URL
 * should be caught while the person is still looking at it rather than after a
 * round trip that ends in a refusal.
 */
export const AttachmentPrompt: React.FC<AttachmentPromptProps> = ({
  kind,
  onCancel,
  onConfirm,
}) => {
  const [value, setValue] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  // Cleared on open rather than on close, so the field is empty when it appears
  // and the previous value is not briefly visible on the way out.
  useEffect(() => {
    if (kind) {
      setValue('');
      setProblem(null);
    }
  }, [kind]);

  const copy =
    kind === 'url'
      ? {
          title: 'Attach a page',
          label: 'URL',
          placeholder: 'https://example.com/report',
          help: 'The page is fetched and its text becomes evidence, cited alongside the graph. Only http and https, and only public addresses.',
        }
      : {
          title: 'Attach an entity',
          label: 'Entity ID',
          placeholder: 'sup_88',
          help: 'Names a node in the graph directly, so retrieval starts there rather than searching for it.',
        };

  const validate = (candidate: string): string | null => {
    const trimmed = candidate.trim();
    if (!trimmed) return `Enter ${kind === 'url' ? 'a URL' : 'an entity ID'}.`;

    if (kind === 'entity') return null;

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return 'That is not a URL. It needs a scheme, like https://example.com.';
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return 'Only http and https URLs can be fetched.';
    }
    if (parsed.username || parsed.password) {
      return 'URLs carrying credentials are not fetched.';
    }
    return null;
  };

  const submit = () => {
    const failure = validate(value);
    if (failure) {
      setProblem(failure);
      return;
    }
    onConfirm(value.trim());
  };

  return (
    <Dialog open={kind !== null} onClose={onCancel} fullWidth maxWidth="sm">
      <DialogTitle>{copy.title}</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          label={copy.label}
          placeholder={copy.placeholder}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setProblem(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          }}
          error={problem !== null}
          helperText={problem ?? copy.help}
          sx={{ mt: 1 }}
        />
        {kind === 'url' && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
            Private, loopback and link-local addresses are refused by the service, whatever
            hostname points at them.
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button onClick={submit}>Attach</Button>
      </DialogActions>
    </Dialog>
  );
};
