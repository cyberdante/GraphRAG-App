import type { ReactElement } from 'react';
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

/** Stable across rerenders, exactly as App's useMemo keeps it. */
const STABLE_THEME = buildTheme(acme, false);

describe('the layout survives a redraw', () => {
  /**
   * The pipeline sends two graph frames per query: a provisional one so there
   * is something to look at while ranking runs, then the real one. The effect
   * used to open with `selectAll('*').remove()` and build a fresh simulation,
   * so every answer detonated the layout halfway through and any node the
   * reader had dragged went back where the simulation wanted it.
   *
   * Asserted through element identity and retained coordinates, because jsdom
   * runs no animation frames — the simulation never ticks here, so the visible
   * settling cannot be observed. What can be observed is whether the drawing
   * was rebuilt, which is the thing that was wrong.
   */
  const GRAPH_PLUS_ONE: GraphData = {
    nodes: [
      ...GRAPH.nodes,
      { id: 'ship_01', label: 'Shipment #2401', type: 'Shipment', group: 3 },
    ],
    links: [
      ...GRAPH.links,
      { source: 'sup_88', target: 'ship_01', type: 'SHIPS', label: 'shipped' },
    ],
  };

  const groupFor = (container: HTMLElement, id: string) =>
    [...container.querySelectorAll('.nodes g')].find(
      (element) => (element as SVGGElement & { __data__?: { id: string } }).__data__?.id === id,
    );

  const rerenderWith = (rerender: (ui: ReactElement) => void, data: GraphData) =>
    rerender(
      <ThemeProvider theme={STABLE_THEME}>
        <D3GraphVisualization data={data} tenant={acme} />
      </ThemeProvider>,
    );

  const renderStable = (data: GraphData) =>
    render(
      <ThemeProvider theme={STABLE_THEME}>
        <D3GraphVisualization data={data} tenant={acme} />
      </ThemeProvider>,
    );

  it('keeps the very same element for a node that is still present', () => {
    const { container, rerender } = renderStable(GRAPH);
    const before = groupFor(container, 'sup_88');

    rerenderWith(rerender, GRAPH_PLUS_ONE);

    // A new element here means the node was torn down and re-placed, which is
    // exactly what reset the layout.
    expect(groupFor(container, 'sup_88')).toBe(before);
  });

  it('carries a node position across the redraw', () => {
    const { container, rerender } = renderStable(GRAPH);
    const datum = (groupFor(container, 'sup_88') as SVGGElement & {
      __data__: { x?: number; y?: number };
    }).__data__;
    datum.x = 123;
    datum.y = 456;

    rerenderWith(rerender, GRAPH_PLUS_ONE);

    const after = (groupFor(container, 'sup_88') as SVGGElement & {
      __data__: { x?: number; y?: number };
    }).__data__;
    expect([after.x, after.y]).toEqual([123, 456]);
  });

  it('adds the new node without disturbing the others', () => {
    const { container, rerender } = renderStable(GRAPH);
    expect(container.querySelectorAll('.nodes g')).toHaveLength(2);

    rerenderWith(rerender, GRAPH_PLUS_ONE);

    expect(container.querySelectorAll('.nodes g')).toHaveLength(3);
    expect(groupFor(container, 'ship_01')).toBeDefined();
  });

  it('starts a new node near the graph rather than at the origin', () => {
    // d3 places an unpositioned node on a ring around the origin, visibly a
    // long way from the graph it belongs to — it then flies across the canvas
    // and drags its neighbours with it.
    const { container, rerender } = renderStable(GRAPH);
    for (const id of ['sup_88', 'risk_12']) {
      const datum = (groupFor(container, id) as SVGGElement & {
        __data__: { x?: number; y?: number };
      }).__data__;
      datum.x = 500;
      datum.y = 500;
    }

    rerenderWith(rerender, GRAPH_PLUS_ONE);

    const added = (groupFor(container, 'ship_01') as SVGGElement & {
      __data__: { x?: number; y?: number };
    }).__data__;
    expect(added.x).toBeGreaterThan(400);
    expect(added.y).toBeGreaterThan(400);
  });

  it('removes a node that is no longer in the data', () => {
    const { container, rerender } = renderStable(GRAPH_PLUS_ONE);
    expect(container.querySelectorAll('.nodes g')).toHaveLength(3);

    rerenderWith(rerender, GRAPH);

    expect(container.querySelectorAll('.nodes g')).toHaveLength(2);
    expect(groupFor(container, 'ship_01')).toBeUndefined();
  });

  it('forgets positions once the graph is emptied', () => {
    // A cleared conversation should not seed the next one's layout with
    // wherever the last one happened to settle.
    const { container, rerender } = renderStable(GRAPH);
    rerenderWith(rerender, EMPTY);
    rerenderWith(rerender, GRAPH);

    expect(container.querySelectorAll('.nodes g')).toHaveLength(2);
  });
});
