import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  Drawer,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { Close as CloseIcon, PlayArrow as RunIcon } from '@mui/icons-material';
import type { BackendInfo, DomainInfo, GraphQueryResult, IssuedQuery } from '@ragstone/shared';
import { runGraphQuery } from '@/api/graphQuery';

interface GraphQueryConsoleProps {
  open: boolean;
  onClose: () => void;
  backends: readonly BackendInfo[];
  domain: DomainInfo | null;
  /** The backend the answers are coming from, so the console asks the same store. */
  backend: string | undefined;
  /**
   * A query the pipeline issued, sent here from the trace panel. Loading it
   * rather than a preset is the difference between "here is the kind of thing
   * we ask" and "here is what we asked for the answer you just read".
   */
  loaded?: IssuedQuery | null;
}

/**
 * Asking the graph directly.
 *
 * The trace says how many candidates were considered and where the time went. A
 * reader is entitled to ask what was actually *asked* — and a graph nobody can
 * query is a claim rather than a component. This is the part of the product that
 * can be checked rather than believed.
 *
 * Read-only, and the service enforces it: the session runs in READ mode, so a
 * write fails at the database whatever the phrasing. The refusal shown here is
 * the service explaining, not the console deciding.
 */
export const GraphQueryConsole: React.FC<GraphQueryConsoleProps> = ({
  open,
  onClose,
  backends,
  domain,
  backend,
  loaded,
}) => {
  const [chosenBackend, setChosenBackend] = useState<string | undefined>(backend);
  const [query, setQuery] = useState('');
  // Held beside the text rather than folded into it. The pipeline's queries
  // bind `$keywords` and `$limit`, and pasting the values in would run a
  // different query from the one the trace reported.
  const [parameters, setParameters] = useState<Record<string, unknown> | undefined>();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<GraphQueryResult | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  // The presets are the domain's, so a console opened on clinical trials does
  // not offer supply-chain questions.
  const presets = domain?.presets ?? [];

  // A deployment can have nothing to query: the fixture store serves a bundled
  // graph, and a service with no database configured offers only that. Letting
  // someone type a query and press Run to find that out is a worse answer than
  // saying so before they start.
  const queryable = backends.filter((entry) => entry.queryable);
  const nothingToQuery = backends.length > 0 && queryable.length === 0;

  // Opens on a backend that can actually be queried. The console defaulting to
  // the deployment default is right only when that default is a database; the
  // fixture store serves a bundled graph, so pointing at it means the first
  // thing a reader sees is a refusal.
  useEffect(() => {
    if (!open) return;
    const current = queryable.find((entry) => entry.name === backend);
    setChosenBackend(current?.name ?? queryable[0]?.name ?? backend);
  }, [open, backend, backends]);

  // A query handed over from the trace wins over the preset: somebody who
  // clicked "open this query" has asked for that one specifically. Keyed on the
  // query itself so re-opening the console does not overwrite an edit in
  // progress.
  useEffect(() => {
    if (!open || !loaded) return;
    setQuery(loaded.text);
    setParameters(loaded.parameters);
    setResult(null);
    setRefusal(null);
  }, [open, loaded]);

  // Opening on an empty box assumes the reader already knows the schema, which
  // is the thing they came to find out.
  useEffect(() => {
    if (open && !query && !loaded && presets.length > 0) setQuery(presets[0]!.query);
  }, [open, query, loaded, presets]);

  const run = async () => {
    setRunning(true);
    setRefusal(null);
    const outcome = await runGraphQuery(query, chosenBackend, parameters);
    setRunning(false);

    if (outcome.status === 'ok' && outcome.result) {
      setResult(outcome.result);
    } else {
      setResult(null);
      setRefusal(outcome.detail ?? 'The query could not be run.');
    }
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      sx={{ zIndex: (theme) => theme.zIndex.drawer + 2 }}
      slotProps={{
        paper: {
          sx: {
            width: { xs: '100vw', md: 720 },
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
          },
        },
      }}
    >
      <Box sx={{ p: 2, pb: 0, flexShrink: 0 }} role="group" aria-label="Graph query">
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Typography variant="h6">Graph query</Typography>
          <IconButton onClick={onClose} aria-label="Close graph query" size="small">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Runs against the same store the answers come from. Read-only: the service opens the
          session in read mode, so a query that writes is refused by the database itself.
        </Typography>
        <Divider />
      </Box>

      <Box sx={{ px: 2, pt: 2, pb: 3, overflowY: 'auto', flexGrow: 1 }} data-testid="query-console-scroll">
        {nothingToQuery && (
          <Alert severity="info" sx={{ mb: 2 }}>
            This deployment has no backend that can be queried. The fixture store serves a bundled
            graph rather than a database — configure a store and it will appear here.
          </Alert>
        )}

        <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
          <FormControl size="small" sx={{ minWidth: 160 }} disabled={backends.length === 0}>
            <InputLabel id="query-backend">Backend</InputLabel>
            <Select
              labelId="query-backend"
              label="Backend"
              value={chosenBackend ?? ''}
              onChange={(event) => setChosenBackend(event.target.value || undefined)}
            >
              <MenuItem value="">Deployment default</MenuItem>
              {backends.map((entry) => (
                <MenuItem key={entry.name} value={entry.name} disabled={!entry.queryable}>
                  {entry.name}
                  {entry.queryable ? '' : ' — no query language'}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ flexGrow: 1 }} disabled={presets.length === 0}>
            <InputLabel id="query-preset">Start from</InputLabel>
            <Select
              labelId="query-preset"
              label="Start from"
              value=""
              onChange={(event) => {
                const preset = presets.find((entry) => entry.label === event.target.value);
                if (preset) {
                  setQuery(preset.query);
                  // A preset binds nothing. Carrying the pipeline's parameters
                  // into it would send values the query has no slots for.
                  setParameters(undefined);
                }
              }}
            >
              {presets.map((preset) => (
                <MenuItem key={preset.label} value={preset.label}>
                  {preset.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>

        {presets[0] && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
            {presets[0].description}
          </Typography>
        )}

        {parameters && Object.keys(parameters).length > 0 && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              Bound to this query, as the pipeline bound them. Sent as values, not pasted into the
              text — so this runs what ran.
            </Typography>
            <Box
              component="pre"
              sx={{
                m: 0,
                p: 1,
                borderRadius: 1,
                bgcolor: 'action.hover',
                fontSize: '0.75rem',
                overflowX: 'auto',
              }}
            >
              {JSON.stringify(parameters, null, 2)}
            </Box>
          </Box>
        )}

        <TextField
          fullWidth
          multiline
          minRows={6}
          label="Query"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          slotProps={{ input: { sx: { fontFamily: 'monospace', fontSize: '0.8125rem' } } }}
          sx={{ mb: 2 }}
        />

        <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
          <Button
            onClick={() => void run()}
            disabled={running || nothingToQuery || !query.trim()}
            startIcon={running ? <CircularProgress size={16} /> : <RunIcon />}
          >
            {running ? 'Running' : 'Run query'}
          </Button>
          {result && (
            <Typography variant="caption" color="text.secondary">
              {result.rows.length} {result.rows.length === 1 ? 'row' : 'rows'} in{' '}
              {result.elapsed_ms} ms
            </Typography>
          )}
        </Stack>

        {refusal && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {refusal}
          </Alert>
        )}

        {result?.truncated && (
          <Alert severity="info" sx={{ mb: 2 }}>
            Showing the first {result.rows.length} rows. There are more — add a LIMIT to say which
            ones you meant.
          </Alert>
        )}

        {result && result.rows.length > 0 && (
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  {result.columns.map((column) => (
                    <TableCell key={column}>{column}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {result.rows.map((row, index) => (
                  <TableRow key={index}>
                    {result.columns.map((column) => (
                      <TableCell key={column} sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                        {render(row[column])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}

        {result && result.rows.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            The query ran and matched nothing. That is an answer about the graph rather than an
            error.
          </Typography>
        )}
      </Box>
    </Drawer>
  );
};

/** A cell, for values a graph returns that are not strings. */
function render(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
