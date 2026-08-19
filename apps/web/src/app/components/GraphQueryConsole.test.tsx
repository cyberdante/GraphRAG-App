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
