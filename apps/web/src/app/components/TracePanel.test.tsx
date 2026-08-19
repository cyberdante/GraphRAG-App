import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material';
import { describe, expect, it, vi } from 'vitest';
import type { IssuedQuery } from '@ragstone/shared';
import { acme, buildTheme } from '@/theme';
import type { QueryTrace } from '@/api/trace';
import { TracePanel } from './TracePanel';

const THEME = buildTheme(acme, false);

const ENTITY_QUERY: IssuedQuery = {
  pass_name: 'entity',
  language: 'cypher',
  text: 'MATCH (subject)-[relation]->(object)\nWHERE any(k IN $keywords ...)\nRETURN subject.id',
  parameters: { keywords: ['supplier', 'risk'], limit: 12 },
  rows: 9,
  elapsed_ms: 21,
};

function aTrace(overrides: Partial<QueryTrace> = {}): QueryTrace {
  return {
    phases: [{ phase: 'retrieval', label: 'Querying graph', startedAt: 0, durationMs: 40 }],
    totalMs: 100,
    backend: 'cypher',
    candidates: 14,
    ...overrides,
  };
}

function renderPanel(trace: QueryTrace, onOpenQuery?: (query: IssuedQuery) => void) {
  render(
    <ThemeProvider theme={THEME}>
      <TracePanel trace={trace} onOpenQuery={onOpenQuery} />
    </ThemeProvider>,
  );
}

async function expand() {
  await userEvent.click(screen.getByLabelText('Show query trace'));
}

/**
 * The trace could say how much was considered and where the time went, but not
 * what was asked. For a product claiming the graph is real rather than
 * decorative, the query is the evidence and the counts are the summary.
 */
describe('the queries the pipeline issued', () => {
  it('shows the query text, its pass, and what it returned', async () => {
    renderPanel(aTrace({ queries: [ENTITY_QUERY] }));
    await expand();

    expect(screen.getByText('entity')).toBeInTheDocument();
    expect(screen.getByText(/MATCH \(subject\)/)).toBeInTheDocument();
    expect(screen.getByText(/9 rows/)).toBeInTheDocument();
  });

  it('does not paste the bound values into the query text', async () => {
    // The text must be what ran. A version with the values spliced in is a
    // string that never reached the driver, and it teaches the reader to build
    // queries by concatenation.
    renderPanel(aTrace({ queries: [ENTITY_QUERY] }));
    await expand();

    expect(screen.getByText(/MATCH \(subject\)/).textContent).toContain('$keywords');
    expect(screen.getByText(/MATCH \(subject\)/).textContent).not.toContain('supplier');
  });

  it('hands the query and its parameters to the console', async () => {
    const onOpenQuery = vi.fn();
    renderPanel(aTrace({ queries: [ENTITY_QUERY] }), onOpenQuery);
    await expand();
    await userEvent.click(screen.getByRole('button', { name: 'Run this query' }));

    // Both halves, or the replay runs a different query from the one shown.
    expect(onOpenQuery).toHaveBeenCalledWith(ENTITY_QUERY);
  });

  it('offers no button when there is no console to hand it to', async () => {
    renderPanel(aTrace({ queries: [ENTITY_QUERY] }));
    await expand();

    expect(screen.queryByRole('button', { name: 'Run this query' })).not.toBeInTheDocument();
  });

  it('says nothing at all when the backend issues no query', async () => {
    // The fixture store filters in memory. An empty section headed "Asked of
    // the store" would imply something was asked and returned nothing.
    renderPanel(aTrace({ queries: [] }));
    await expand();

    expect(screen.queryByText('Asked of the store')).not.toBeInTheDocument();
  });

  it('still reports the phases it always did', async () => {
    // The new section sits among existing ones; a regression here would be
    // invisible in the tests above.
    renderPanel(aTrace({ queries: [ENTITY_QUERY] }));
    await expand();

    expect(screen.getByText('Querying graph')).toBeInTheDocument();
    expect(screen.getByText('14 candidates')).toBeInTheDocument();
  });
});
