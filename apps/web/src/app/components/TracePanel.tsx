import React, { useState } from 'react';
import {
  Box,
  Chip,
  Collapse,
  Divider,
  LinearProgress,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { ExpandMore as ExpandMoreIcon } from '@mui/icons-material';
import { formatDuration, formatTokens, type QueryTrace } from '@/api/trace';

interface TracePanelProps {
  trace: QueryTrace;
}

/**
 * What the pipeline actually did, for the answer above it.
 *
 * For a product whose claim is "grounded in a knowledge graph", this is the
 * evidence that the graph was used rather than decorative: which backend was
 * queried, how many candidates it returned, which model wrote the answer, what
 * it cost in tokens, and where the time went.
 *
 * Collapsed by default. Someone reading an answer does not want telemetry;
 * someone doubting one wants all of it.
 */
export const TracePanel: React.FC<TracePanelProps> = ({ trace }) => {
  const [open, setOpen] = useState(false);
  const total = trace.totalMs ?? 0;

  const summary = [
    trace.totalMs !== undefined ? formatDuration(trace.totalMs) : null,
    trace.usage ? `${formatTokens(trace.usage.output_tokens)} out` : null,
    // Qualified, because the store and the answer generator can both be
    // called "fixtures": an unlabelled name here reads as the backend, so
    // changing backend looked like it had done nothing until the panel was
    // expanded.
    trace.backend ? `via ${trace.backend}` : null,
    trace.model,
  ].filter(Boolean);

  return (
    <Box sx={{ mt: 1 }}>
      <Box
        component="button"
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        aria-label={open ? 'Hide query trace' : 'Show query trace'}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          px: 0,
          py: 0.5,
          border: 0,
          background: 'none',
          cursor: 'pointer',
          color: 'text.secondary',
          font: 'inherit',
        }}
      >
        <ExpandMoreIcon
          fontSize="small"
          sx={{
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 120ms',
            '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
          }}
        />
        <Typography variant="caption">Trace</Typography>
        {!open && summary.length > 0 && (
          <Typography variant="caption" sx={{ opacity: 0.8 }}>
            · {summary.join(' · ')}
          </Typography>
        )}
      </Box>

      <Collapse in={open} unmountOnExit>
        <Box sx={{ pt: 1 }}>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
            {trace.backend && <Chip size="small" label={`retrieved via ${trace.backend}`} />}
            {trace.model && <Chip size="small" label={trace.model} />}
            {trace.candidates !== undefined && (
              <Chip size="small" label={`${trace.candidates} candidates`} />
            )}
          </Stack>

          {trace.phases.map((phase) => {
            // Bars are proportional to the whole query, so a long silence
            // reads as a long bar rather than a number to interpret.
            const share = total > 0 ? ((phase.durationMs ?? 0) / total) * 100 : 0;

            return (
              <Box key={`${phase.phase}-${phase.startedAt}`} sx={{ mb: 1 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                  <Typography variant="caption" color="text.secondary">
                    {phase.label}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {phase.durationMs === undefined
                      ? '—'
                      : formatDuration(phase.durationMs)}
                  </Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={Math.min(share, 100)}
                  aria-hidden
                  sx={{ height: 4, borderRadius: 2 }}
                />
              </Box>
            );
          })}

          <Divider sx={{ my: 1.5 }} />

          <Stack spacing={0.5}>
            {trace.firstTokenMs !== undefined && (
              <Row
                label="First token"
                value={formatDuration(trace.firstTokenMs)}
                hint="Time until the answer started arriving. A reasoning model thinks before it writes, so this is usually the longest wait."
              />
            )}
            {trace.totalMs !== undefined && (
              <Row label="Total" value={formatDuration(trace.totalMs)} />
            )}
            {trace.usage && (
              <>
                <Row label="Input tokens" value={formatTokens(trace.usage.input_tokens)} />
                <Row
                  label="Output tokens"
                  value={formatTokens(trace.usage.output_tokens)}
                  hint="Includes reasoning the model did before writing, which is why this can exceed the visible answer."
                />
              </>
            )}
          </Stack>
        </Box>
      </Collapse>
    </Box>
  );
};

const Row: React.FC<{ label: string; value: string; hint?: string }> = ({
  label,
  value,
  hint,
}) => {
  const content = (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
    </Box>
  );

  return hint ? (
    <Tooltip title={hint} placement="left">
      <Box sx={{ cursor: 'help' }}>{content}</Box>
    </Tooltip>
  ) : (
    content
  );
};
