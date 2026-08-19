import React, { useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Collapse,
  Divider,
  LinearProgress,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { ExpandMore as ExpandMoreIcon } from '@mui/icons-material';
import type { IssuedQuery } from '@ragstone/shared';
import { formatDuration, formatTokens, type QueryTrace } from '@/api/trace';

interface TracePanelProps {
  trace: QueryTrace;
  /**
   * Hands a query the pipeline issued to the console. Absent when there is no
   * console to hand it to, which is why the buttons are conditional rather than
   * always rendered and inert.
   */
  onOpenQuery?: (query: IssuedQuery) => void;
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
export const TracePanel: React.FC<TracePanelProps> = ({ trace, onOpenQuery }) => {
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
        {/* No opacity on the summary. The enclosing text is already
            `text.secondary`, which is translucent; multiplying the two put it
            at 3.69:1 — de-emphasis is not free once the colour is muted. */}
        {!open && summary.length > 0 && (
          <Typography variant="caption">
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

          {trace.queries?.length ? (
            <Box sx={{ mb: 1.5 }}>
              {/* The evidence the rest of this panel was missing. Counts and
                  timings describe the work; only the query says what was asked,
                  and that is the difference between a graph being real and
                  being claimed. */}
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                Asked of the store
              </Typography>

              {trace.queries.map((query, index) => (
                <Box
                  key={`${query.pass_name}-${index}`}
                  sx={{ mb: 1, p: 1, borderRadius: 1, bgcolor: 'action.hover' }}
                >
                  <Box
                    sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}
                  >
                    <Typography variant="caption" sx={{ fontWeight: 600 }}>
                      {query.pass_name}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ fontVariantNumeric: 'tabular-nums' }}
                    >
                      {query.rows} {query.rows === 1 ? 'row' : 'rows'} ·{' '}
                      {formatDuration(query.elapsed_ms)}
                    </Typography>
                  </Box>

                  <Box
                    component="pre"
                    sx={{
                      m: 0,
                      mt: 0.5,
                      fontSize: '0.7rem',
                      // The query is wider than the panel and must scroll in
                      // its own box; a trace that widens the conversation is a
                      // worse regression than one that is hard to read.
                      overflowX: 'auto',
                      whiteSpace: 'pre',
                    }}
                  >
                    {query.text}
                  </Box>

                  {onOpenQuery && (
                    <Button
                      size="small"
                      onClick={() => onOpenQuery(query)}
                      sx={{ mt: 0.5, px: 0.5, minWidth: 0 }}
                    >
                      Run this query
                    </Button>
                  )}
                </Box>
              ))}
            </Box>
          ) : null}

          {trace.notes?.length ? (
            <Box sx={{ mb: 1.5 }}>
              {/* A refusal belongs with the answer, not only in a log. Someone
                  who attached a URL and got an answer without it needs to know
                  the answer does not include it. */}
              {trace.notes.map((note) => (
                <Typography key={note} variant="caption" color="warning.main" sx={{ display: 'block' }}>
                  {note}
                </Typography>
              ))}
            </Box>
          ) : null}

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
