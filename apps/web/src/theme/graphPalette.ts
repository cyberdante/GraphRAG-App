/**
 * Colours for the graph canvas, resolved from the tenant and the MUI theme.
 *
 * D3 draws to an SVG that MUI knows nothing about, so it cannot inherit
 * anything. Before this existed the component carried seventeen hardcoded
 * colours and rendered identically under every tenant — the centrepiece of the
 * product was the one part that could not be branded (roadmap item 78).
 *
 * Node colour is keyed by entity type rather than carried on each datum, so it
 * follows meaning and a domain pack can restyle a whole graph (item 69).
 */

import { alpha, type Theme } from '@mui/material';
import type { Tenant } from '@ragstone/shared';

export interface GraphPalette {
  canvas: string;
  link: string;
  arrow: string;
  nodeStroke: string;
  label: string;
  sublabel: string;
  /** Resolves a node's colour from its type. */
  nodeColor: (type: string) => string;
}

export function graphPalette(theme: Theme, tenant: Tenant): GraphPalette {
  const ink = theme.palette.text.primary;

  return {
    canvas: tenant.graph.background ?? theme.palette.background.default,
    link: alpha(ink, 0.35),
    arrow: alpha(ink, 0.45),
    nodeStroke: theme.palette.background.paper,
    label: ink,
    sublabel: theme.palette.text.secondary,
    nodeColor: (type: string) => tenant.graph.nodeColors[type] ?? tenant.graph.defaultNode,
  };
}
