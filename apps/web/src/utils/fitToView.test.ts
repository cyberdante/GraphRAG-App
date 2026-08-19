import { describe, expect, it } from 'vitest';
import { MAX_SCALE, MIN_SCALE, PADDING, fitToView } from './fitToView';

const VIEWPORT = { width: 800, height: 600 };

/** Where a node lands on screen under a given fit, which is the thing that matters. */
function projected(node: { x: number; y: number }, fit: NonNullable<ReturnType<typeof fitToView>>, viewport = VIEWPORT) {
  return {
    x: viewport.width / 2 + (node.x - fit.centerX) * fit.scale,
    y: viewport.height / 2 + (node.y - fit.centerY) * fit.scale,
  };
}

describe('fitting a graph to its pane', () => {
  it('says nothing when nothing has been laid out', () => {
    expect(fitToView([], VIEWPORT)).toBeNull();
    expect(fitToView([{}, {}], VIEWPORT)).toBeNull();
  });

  it('brings every node inside the pane', () => {
    // The defect this replaces: a graph wider than the viewport was left at
    // scale 1, so its outer nodes sat outside the pane entirely.
    const nodes = [
      { x: -2000, y: -1500 },
      { x: 2000, y: 1500 },
      { x: 0, y: 0 },
      { x: 900, y: -1200 },
    ];

    const fit = fitToView(nodes, VIEWPORT)!;

    for (const node of nodes) {
      const { x, y } = projected(node, fit);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(VIEWPORT.width);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(VIEWPORT.height);
    }
  });

  it('leaves room for the labels the extent does not measure', () => {
    // Labels sit above and beside their nodes. Fitting to the node positions
    // alone clips exactly the text naming the outer nodes — which is what the
    // portfolio screenshots showed.
    const nodes = [
      { x: -1000, y: -1000 },
      { x: 1000, y: 1000 },
    ];

    const fit = fitToView(nodes, VIEWPORT)!;
    const edge = projected(nodes[0]!, fit);

    expect(edge.x).toBeGreaterThan(0);
    expect(edge.y).toBeGreaterThan(0);
  });

  it('does not magnify a small graph to fill the pane', () => {
    // Two nodes blown up until they touch the edges reads as broken rather
    // than as fitted.
    const fit = fitToView([{ x: 0, y: 0 }, { x: 10, y: 10 }], VIEWPORT)!;

    expect(fit.scale).toBe(MAX_SCALE);
  });

  it('survives a single node, which has no extent at all', () => {
    // Without padding this divides by zero and scales to infinity.
    const fit = fitToView([{ x: 42, y: 42 }], VIEWPORT)!;

    expect(Number.isFinite(fit.scale)).toBe(true);
    expect(fit.centerX).toBe(42);
    expect(fit.centerY).toBe(42);
  });

  it('never scales below what the zoom control can undo', () => {
    // A fit that lands outside the zoom behaviour's extent is a frame the
    // buttons cannot get out of.
    const fit = fitToView([{ x: -1e6, y: -1e6 }, { x: 1e6, y: 1e6 }], VIEWPORT)!;

    expect(fit.scale).toBeGreaterThanOrEqual(MIN_SCALE);
  });

  it('centres on the extent rather than on the origin', () => {
    // A graph that settled away from 0,0 was previously centred on the
    // viewport middle regardless, which is how it ended up in a corner.
    const fit = fitToView([{ x: 100, y: 200 }, { x: 300, y: 600 }], VIEWPORT)!;

    expect(fit.centerX).toBe(200);
    expect(fit.centerY).toBe(400);
  });

  it('uses the padding it documents', () => {
    // A wide graph is bounded by width; the scale must account for padding on
    // both sides or the outer nodes touch the edge.
    const fit = fitToView([{ x: 0, y: 0 }, { x: 1000, y: 0 }], VIEWPORT)!;

    expect(fit.scale).toBeCloseTo(VIEWPORT.width / (1000 + PADDING * 2), 5);
  });
});
