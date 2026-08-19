import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackendInfo, DomainInfo } from '@ragstone/shared';
import { acme, buildTheme } from '@/theme';
import { GraphQueryConsole } from './GraphQueryConsole';

const THEME = buildTheme(acme, false);

const BACKENDS: BackendInfo[] = [
  { name: 'fixtures', description: 'Bundled sample.', default: true, queryable: false },
  { name: 'cypher', description: 'openCypher over Bolt.', default: false, queryable: true },
];

const DOMAIN: DomainInfo = {
  id: 'supply-chain',
  label: 'Supply chain',
  version: '1.0.0',
  classes: ['Supplier'],
  starters: [],
  presets: [
    { label: 'What is in the store', description: 'Start here.', language: 'cypher', query: 'MATCH (n) RETURN n' },
  ],
  ontology: '/ontology/supply-chain.ttl',
  default: true,
};

function respondWith(body: unknown, ok = true) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok, json: async () => body }));
}

afterEach(() => vi.unstubAllGlobals());

function renderConsole(domain: DomainInfo | null = DOMAIN, backend?: string) {
  render(
    <ThemeProvider theme={THEME}>
      <GraphQueryConsole open onClose={vi.fn()} backends={BACKENDS} domain={domain} backend={backend} />
    </ThemeProvider>,
  );
}

describe('GraphQueryConsole', () => {
  it('opens on a backend that can actually be queried', () => {
    // Defaulting to the deployment default is right only when that default is a
    // database. The fixture store serves a bundled graph, so pointing at it
    // means the first thing a reader sees is a refusal.
    renderConsole();

    expect(screen.getByLabelText('Backend')).toHaveTextContent('cypher');
  });

  it('says which backends cannot be queried rather than letting them be chosen', async () => {
    renderConsole();
    await userEvent.click(screen.getByLabelText('Backend'));

    expect(screen.getByRole('option', { name: /fixtures — no query language/ })).toBeInTheDocument();
  });

  it('starts from a preset rather than an empty box', () => {
    // An empty box assumes the reader already knows the schema, which is the
    // thing they came to find out.
    renderConsole();

    expect(screen.getByLabelText('Query')).toHaveValue('MATCH (n) RETURN n');
  });

  it('reports how many rows and how long', async () => {
    respondWith({ columns: ['type'], rows: [{ type: 'Supplier' }, { type: 'Risk' }], elapsed_ms: 21, truncated: false });
    renderConsole();

    await userEvent.click(screen.getByRole('button', { name: /Run query/ }));

    await waitFor(() => expect(screen.getByText('2 rows in 21 ms')).toBeInTheDocument());
    expect(screen.getByRole('columnheader', { name: 'type' })).toBeInTheDocument();
  });

  it('shows a refusal next to the query that caused it', async () => {
    // Being told DELETE is a write is the console working, not failing.
    respondWith({ detail: 'DELETE changes data, and this console is read-only.' }, false);
    renderConsole();

    await userEvent.click(screen.getByRole('button', { name: /Run query/ }));

    await waitFor(() => expect(screen.getByText(/read-only/)).toBeInTheDocument());
  });

  it('says when the row cap cut the result', async () => {
    // A partial answer that does not say so reads as a complete one.
    respondWith({ columns: ['n'], rows: [{ n: 1 }], elapsed_ms: 5, truncated: true });
    renderConsole();

    await userEvent.click(screen.getByRole('button', { name: /Run query/ }));

    await waitFor(() => expect(screen.getByText(/add a LIMIT/)).toBeInTheDocument());
  });

  it('distinguishes an empty result from a failure', async () => {
    respondWith({ columns: [], rows: [], elapsed_ms: 3, truncated: false });
    renderConsole();

    await userEvent.click(screen.getByRole('button', { name: /Run query/ }));

    await waitFor(() =>
      expect(screen.getByText(/answer about the graph rather than an error/)).toBeInTheDocument(),
    );
  });

  it('states that the service enforces read-only, not the console', () => {
    renderConsole();

    expect(screen.getByText(/refused by the database itself/)).toBeInTheDocument();
  });

  it('keeps the heading and the way out outside the scrolling region', () => {
    renderConsole();

    expect(screen.getByTestId('query-console-scroll')).not.toContainElement(
      screen.getByLabelText('Close graph query'),
    );
  });
});

describe('when the deployment has nothing to query', () => {
  const ONLY_FIXTURES: BackendInfo[] = [
    { name: 'fixtures', description: 'Bundled sample.', default: true, queryable: false },
  ];

  function renderWithout() {
    render(
      <ThemeProvider theme={THEME}>
        <GraphQueryConsole
          open
          onClose={vi.fn()}
          backends={ONLY_FIXTURES}
          domain={DOMAIN}
          backend={undefined}
        />
      </ThemeProvider>,
    );
  }

  it('says so before anything is typed', () => {
    // Reported from a screenshot: a service with no database configured offers
    // only the fixture store, so the picker sat empty and the reason arrived
    // only after pressing Run.
    renderWithout();

    expect(screen.getByText(/no backend that can be queried/)).toBeInTheDocument();
  });

  it('does not offer to run a query that cannot go anywhere', () => {
    renderWithout();

    expect(screen.getByRole('button', { name: /Run query/ })).toBeDisabled();
  });
});

const PIPELINE_QUERY = {
  pass_name: 'entity',
  language: 'cypher',
  text: 'MATCH (s)-[r]->(o) WHERE any(k IN $keywords WHERE s.label CONTAINS k) RETURN s.id',
  parameters: { keywords: ['supplier'], limit: 12 },
  rows: 9,
  elapsed_ms: 21,
};

function renderWithLoaded(loaded = PIPELINE_QUERY) {
  render(
    <ThemeProvider theme={THEME}>
      <GraphQueryConsole
        open
        onClose={vi.fn()}
        backends={BACKENDS}
        domain={DOMAIN}
        backend="cypher"
        loaded={loaded}
      />
    </ThemeProvider>,
  );
}

/**
 * Replaying the query the pipeline issued. The presets show the kind of thing
 * this service asks; this shows what it asked for the answer just read, which
 * is a different and stronger claim.
 */
describe('a query handed over from the trace', () => {
  it('loads it instead of the preset', () => {
    renderWithLoaded();

    expect(screen.getByLabelText('Query')).toHaveValue(PIPELINE_QUERY.text);
  });

  it('shows the values bound to it', () => {
    // A query full of $keywords with nothing saying what they hold is not
    // evidence of anything.
    renderWithLoaded();

    expect(screen.getByText(/"supplier"/)).toBeInTheDocument();
  });

  it('sends the parameters, so it runs what ran', async () => {
    respondWith({ columns: ['id'], rows: [{ id: 'sup_1' }], elapsed_ms: 4, truncated: false });
    renderWithLoaded();

    await userEvent.click(screen.getByRole('button', { name: /run/i }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse(init.body);
    expect(body.query).toBe(PIPELINE_QUERY.text);
    expect(body.parameters).toEqual(PIPELINE_QUERY.parameters);
  });

  it('drops the parameters when a preset is chosen instead', async () => {
    // A preset binds nothing. Carrying the pipeline's values into it would send
    // values the query has no slots for.
    respondWith({ columns: ['n'], rows: [], elapsed_ms: 2, truncated: false });
    renderWithLoaded();

    await userEvent.click(screen.getByLabelText('Start from'));
    await userEvent.click(screen.getByRole('option', { name: 'What is in the store' }));
    await userEvent.click(screen.getByRole('button', { name: /run/i }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse(init.body);
    expect(body.query).toBe('MATCH (n) RETURN n');
    expect(body.parameters).toBeUndefined();
  });
});
