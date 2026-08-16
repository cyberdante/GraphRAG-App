import { render } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { describe, expect, it } from 'vitest';
import type { GraphData } from '@/types';
import { acme, buildTheme } from '@/theme';
import { D3GraphVisualization } from './D3GraphVisualization';

const GRAPH: GraphData = {
  nodes: [
    { id: 'sup_88', label: 'ITAMCO', type: 'Supplier', group: 1 },
    { id: 'risk_12', label: 'Delivery Delay', type: 'Risk', group: 2 },
  ],
  links: [{ source: 'sup_88', target: 'risk_12', type: 'HAS_RISK', label: 'has risk' }],
};

const EMPTY: GraphData = { nodes: [], links: [] };

function renderGraph(data: GraphData) {
  return render(
    <ThemeProvider theme={buildTheme(acme, false)}>
      <D3GraphVisualization data={data} tenant={acme} />
    </ThemeProvider>,
  );
}

/** The drawing surface, as opposed to the icons in the toolbar. */
const canvas = (container: HTMLElement) => container.querySelector('svg[width]');

describe('D3GraphVisualization', () => {
  it('draws a node per datum and a line per link', () => {
    const { container } = renderGraph(GRAPH);
    const svg = canvas(container);

    expect(svg?.querySelectorAll('circle')).toHaveLength(2);
    expect(svg?.querySelectorAll('line')).toHaveLength(1);
  });

  it('reports the counts alongside the drawing', () => {
    const { getByText } = renderGraph(GRAPH);
    expect(getByText('2 Nodes')).toBeInTheDocument();
    expect(getByText('1 Relationships')).toBeInTheDocument();
  });

  it('clears the canvas when the graph is emptied', () => {
    // The bug this guards: deleting a conversation reset the counts to zero
    // while the previous drawing stayed on screen, so the panel claimed
    // nothing and showed something. The clear sat after an early return.
    const { container, rerender, getByText } = renderGraph(GRAPH);
    expect(canvas(container)?.querySelectorAll('circle').length).toBeGreaterThan(0);

    rerender(
      <ThemeProvider theme={buildTheme(acme, false)}>
        <D3GraphVisualization data={EMPTY} tenant={acme} />
      </ThemeProvider>,
    );

    expect(canvas(container)?.querySelectorAll('circle')).toHaveLength(0);
    expect(canvas(container)?.querySelectorAll('line')).toHaveLength(0);
    expect(getByText('0 Nodes')).toBeInTheDocument();
  });

  it('redraws when a new graph replaces an old one', () => {
    const { container, rerender } = renderGraph(GRAPH);

    rerender(
      <ThemeProvider theme={buildTheme(acme, false)}>
        <D3GraphVisualization
          data={{
            nodes: [{ id: 'only', label: 'Only', type: 'Product', group: 1 }],
            links: [],
          }}
          tenant={acme}
        />
      </ThemeProvider>,
    );

    // Replaced, not appended — a stale node left behind is the same class of
    // bug as a stale drawing.
    expect(canvas(container)?.querySelectorAll('circle')).toHaveLength(1);
  });

  it('renders an empty graph without drawing anything', () => {
    const { container } = renderGraph(EMPTY);
    expect(canvas(container)?.querySelectorAll('circle')).toHaveLength(0);
  });
});
