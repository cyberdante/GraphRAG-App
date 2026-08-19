/**
 * Framing a whole graph inside its pane.
 *
 * The control that does this used to reset to scale 1 and translate to the
 * middle of the viewport, ignoring where the nodes actually were. On a graph
 * larger than the pane that left most of it outside — pressing "fit" on a
 * fifty-node graph cut the outer nodes off — and on a small one it left the
 * drawing stranded in a corner.
 *
 * The maths lives here rather than in the component because jsdom does no
 * layout: a test there can assert that a transform was applied but not that it
 * frames anything. Here the question "does this fit" is arithmetic, and the
 * cases worth holding — one node, a wide graph, a graph smaller than its pane —
 * are all reachable.
 */

export interface Placed {
  x?: number;
  y?: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface Fit {
  scale: number;
  /** Centre of the graph's extent, in graph coordinates. */
  centerX: number;
  centerY: number;
}

/**
 * Padding around the extent, in graph units.
 *
 * Labels are drawn above and beside their nodes and are not part of the node
 * positions this measures, so without this a fitted graph clips exactly the
 * text saying what the outer nodes are.
 */
export const PADDING = 90;

/** Never magnify past this: a two-node graph filling the pane looks broken. */
export const MAX_SCALE = 1;

/** Matches the zoom behaviour's own extent, so a fit cannot land somewhere the buttons cannot leave. */
export const MIN_SCALE = 0.1;

export function fitToView(nodes: readonly Placed[], viewport: Viewport): Fit | null {
  const placed = nodes.filter(
    (node): node is { x: number; y: number } =>
      Number.isFinite(node.x) && Number.isFinite(node.y),
  );
  // Nothing has been laid out yet. Returning null rather than a default keeps
  // the caller from animating to a frame that means nothing.
  if (placed.length === 0) return null;

  const xs = placed.map((node) => node.x);
  const ys = placed.map((node) => node.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  // The padding is also what stops a single node — which has no extent at all —
  // from dividing by zero and scaling to infinity.
  const width = maxX - minX + PADDING * 2;
  const height = maxY - minY + PADDING * 2;

  const scale = Math.min(
    MAX_SCALE,
    Math.max(MIN_SCALE, Math.min(viewport.width / width, viewport.height / height)),
  );

  return { scale, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 };
}
