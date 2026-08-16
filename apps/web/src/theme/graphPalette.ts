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
import { AA_LARGE, ensureContrast, luminance, readableOn } from './contrast';

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

/** Whether a colour belongs on this side of the light/dark divide. */
const suitsMode = (color: string, darkMode: boolean): boolean =>
  darkMode ? luminance(color) < 0.5 : luminance(color) >= 0.5;

export function graphPalette(theme: Theme, tenant: Tenant): GraphPalette {
  const darkMode = theme.palette.mode === 'dark';
  const declared = tenant.graph.background;

  // A tenant declares one canvas, authored against one mode. Meridian's
  // #EFEDE8 is a light parchment; using it in dark mode left a bright panel
  // in a dark app, drawn on with white ink at 1.17:1 — the edges vanished.
  // A declared canvas is honoured only when it suits the mode in play.
  const canvas =
    declared && suitsMode(declared, darkMode) ? declared : theme.palette.background.default;

  // Every mark is derived from the canvas rather than from the theme's text
  // colour. That is what makes the two impossible to disagree: whatever the
  // canvas turns out to be, the ink is chosen to be readable on it.
  const ink = readableOn(canvas);

  return {
    canvas,
    link: alpha(ink, 0.4),
    arrow: alpha(ink, 0.5),
    nodeStroke: canvas,
    label: ink,
    sublabel: alpha(ink, 0.7),
    // Node colours are authored against the tenant's own light canvas. On the
    // derived dark canvas several of them dropped below 3:1 and became hard to
    // separate from the background. Adapted in dark mode for the same reason
    // the brand colours are: dark mode is ours, not theirs. In light mode they
    // are used exactly as declared, and the document audit reports failures
    // rather than quietly changing what a client asked for.
    nodeColor: (type: string) => {
      const declaredColor = tenant.graph.nodeColors[type] ?? tenant.graph.defaultNode;
      return darkMode ? ensureContrast(declaredColor, canvas, AA_LARGE) : declaredColor;
    },
  };
}
