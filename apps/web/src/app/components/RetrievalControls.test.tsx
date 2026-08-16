import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material';
import { describe, expect, it, vi } from 'vitest';
import type { BackendInfo } from '@ragstone/shared';
import { acme, buildTheme } from '@/theme';
import { DEFAULT_SETTINGS, type RetrievalSettings } from '@/utils/retrievalSettings';
import { RetrievalControls } from './RetrievalControls';

const BACKENDS: BackendInfo[] = [
  { name: 'fixtures', description: 'Bundled supply-chain sample.', default: true },
  { name: 'cypher', description: 'openCypher over Bolt.', default: false },
];

const TYPES = ['Supplier', 'Shipment', 'Risk'];

function renderControls(
  settings: RetrievalSettings = DEFAULT_SETTINGS,
  backends: BackendInfo[] = BACKENDS,
) {
  const onChange = vi.fn();
  render(
    <ThemeProvider theme={buildTheme(acme, false)}>
      <RetrievalControls
        open
        onClose={vi.fn()}
        settings={settings}
        onChange={onChange}
        backends={backends}
        entityTypes={TYPES}
      />
    </ThemeProvider>,
  );
  return { onChange };
}

describe('RetrievalControls', () => {
  it('offers every backend the deployment listed', async () => {
    renderControls();
    await userEvent.click(screen.getByLabelText('Backend'));

    expect(screen.getByRole('option', { name: 'cypher' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'fixtures' })).toBeInTheDocument();
  });

  it('names which backend the deployment default is', async () => {
    // An empty row reads as a bug. Saying what it resolves to is the whole
    // point of a control that reports rather than only sets.
    renderControls();
    await userEvent.click(screen.getByLabelText('Backend'));

    expect(screen.getByRole('option', { name: /Deployment default \(fixtures\)/ })).toBeInTheDocument();
  });

  it('reports a chosen backend as unset rather than empty', async () => {
    const { onChange } = renderControls();
    await userEvent.click(screen.getByLabelText('Backend'));
    await userEvent.click(screen.getByRole('option', { name: 'cypher' }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ backend: 'cypher' }));
  });

  it('says so when the service did not list its backends', () => {
    renderControls(DEFAULT_SETTINGS, []);

    expect(screen.getByText(/did not list its backends/)).toBeInTheDocument();
  });

  it('explains that selecting no entity type searches everything', () => {
    // The semantics most likely to be read backwards, so the panel states it.
    renderControls();

    expect(screen.getByText(/searches everything, rather than nothing/)).toBeInTheDocument();
  });

  it('offers the entity types this tenant declares, not a fixed list', () => {
    // Types come from the tenant's own graph palette, so a domain pack swaps
    // them rather than requiring a code change.
    renderControls();

    for (const type of TYPES) {
      expect(screen.getByRole('button', { name: type })).toBeInTheDocument();
    }
  });

  it('toggles an entity type on and back off', async () => {
    const { onChange } = renderControls();
    await userEvent.click(screen.getByRole('button', { name: 'Risk' }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ entityTypes: ['Risk'] }));
  });

  it('removes a type that was already selected', async () => {
    const { onChange } = renderControls({ ...DEFAULT_SETTINGS, entityTypes: ['Risk'] });
    await userEvent.click(screen.getByRole('button', { name: 'Risk' }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ entityTypes: [] }));
  });

  it('says every knob costs something', () => {
    // A number with no consequence attached cannot be tuned by anyone who did
    // not write the retrieval pipeline.
    renderControls();

    expect(screen.getByText(/costs more tokens/)).toBeInTheDocument();
    expect(screen.getByText(/does not change what the model was told/)).toBeInTheDocument();
    expect(screen.getByText(/more context and more noise/)).toBeInTheDocument();
  });

  it('says the settings apply to the next question', () => {
    renderControls();

    expect(screen.getByText(/Applies to the next question/)).toBeInTheDocument();
  });

  it('only offers a reset when something has changed', () => {
    renderControls();
    expect(screen.getByRole('button', { name: /Reset to defaults/ })).toBeDisabled();
  });

  it('resets every knob at once', async () => {
    const { onChange } = renderControls({
      backend: 'cypher',
      maxHops: 5,
      maxNodes: 400,
      topK: 80,
      entityTypes: ['Risk'],
    });
    await userEvent.click(screen.getByRole('button', { name: /Reset to defaults/ }));

    expect(onChange).toHaveBeenCalledWith(DEFAULT_SETTINGS);
  });
});

describe('the panel fits on screen', () => {
  it('keeps the heading and the way out outside the scrolling region', () => {
    // Reported from a screenshot: the heading and close button were hidden
    // behind the app bar, which declares `zIndex.drawer + 1` so that a docked
    // drawer sits under it. This panel is modal and has to sit over it.
    //
    // jsdom does no layout, so this asserts the structure that makes the fix
    // hold rather than the pixels — the controls scroll inside their own
    // container, and the way out is not in it. Item 77 (visual regression) is
    // what would have caught the original.
    renderControls();

    const scroller = screen.getByTestId('retrieval-scroll');
    const close = screen.getByLabelText('Close retrieval settings');

    expect(scroller).not.toContainElement(close);
    expect(scroller).toContainElement(screen.getByLabelText('Hops'));
  });

  it('still shows every control', () => {
    renderControls();

    expect(screen.getByRole('heading', { name: 'Retrieval' })).toBeInTheDocument();
    expect(screen.getByLabelText('Evidence to the model')).toBeInTheDocument();
    expect(screen.getByLabelText('Nodes in the picture')).toBeInTheDocument();
    expect(screen.getByLabelText('Hops')).toBeInTheDocument();
  });
});
