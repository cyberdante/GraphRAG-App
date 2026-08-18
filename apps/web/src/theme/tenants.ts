/**
 * Bundled tenants.
 *
 * These live in code for now. Item 73 moves them to a fetched document; the
 * shape is already the serialisable `Tenant`, so that move is a loader change
 * and not a rewrite.
 *
 * They exist to be genuinely far apart. A white-label claim tested only against
 * near-identical themes proves nothing, which is how a product ends up
 * "themeable" in every respect except the one a client asks about.
 */

import type { Tenant } from '@ragstone/shared';

/** Semantic colours are shared: meaning should survive rebranding. */
const SEMANTIC = {
  success: '#2E7D32',
  warning: '#ED6C02',
  error: '#C62828',
} as const;

/**
 * The default look: Material, blue, familiar.
 *
 * Named as an obvious placeholder on purpose. The product has no name a user
 * can see — the one in the navbar always belongs to a tenant — so the default
 * tenant should announce that it is a sample rather than quietly look like the
 * product's own branding.
 */
export const acme: Tenant = {
  id: 'acme',
  brand: { name: 'Acme Corp', initials: 'AC' },
  palette: {
    primary: '#1976d2',
    secondary: '#dc004e',
    background: '#F4F6F8',
    surface: '#FFFFFF',
    divider: '#E0E0E0',
    ...SEMANTIC,
  },
  shape: { radius: 8, borderWidth: 1 },
  variants: {
    surface: 'elevated',
    button: 'contained',
    input: 'outlined',
    chip: 'filled',
    controlSize: 'medium',
    interaction: 'ripple',
  },
  density: { spacing: 8, fontScale: 1 },
  typography: {
    fontFamily: '"Helvetica Neue", Arial, sans-serif',
    headingWeight: 600,
    buttonTextTransform: 'none',
    letterSpacing: '0',
  },
  copy: {
    inputPlaceholder: 'Ask a question about your supply chain...',
    welcome:
      'Ask questions about your supply chain data. Answers are grounded in the knowledge graph, with citations and the subgraph they came from.',
    starters: [
      'Which suppliers are at risk?',
      'Show shipment status',
      'What are the inventory levels?',
    ],
  },
  graph: {
    nodeColors: {
      Supplier: '#2E7D32',
      Shipment: '#1565C0',
      Product: '#6A1B9A',
      Location: '#455A64',
      Risk: '#C62828',
      RiskSignal: '#E64A19',
    },
    defaultNode: '#78909C',
  },
};

/** Industrial: square, flat, dense, tracked uppercase. */
export const meridian: Tenant = {
  id: 'meridian',
  brand: { name: 'Meridian Supply', initials: 'MS' },
  palette: {
    primary: '#B45309',
    secondary: '#334155',
    background: '#F6F5F2',
    surface: '#FFFFFF',
    divider: '#D6D3CE',
    ...SEMANTIC,
  },
  shape: { radius: 0, borderWidth: 2 },
  variants: {
    surface: 'outlined',
    button: 'outlined',
    input: 'standard',
    chip: 'outlined',
    controlSize: 'small',
    interaction: 'flat',
  },
  density: { spacing: 6, fontScale: 0.94 },
  typography: {
    fontFamily: '"IBM Plex Sans", "Helvetica Neue", Arial, sans-serif',
    headingWeight: 700,
    buttonTextTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  copy: {
    inputPlaceholder: 'Ask about suppliers, shipments or risk...',
    welcome:
      'Interrogate the logistics graph. Every answer cites the records it was drawn from.',
    starters: [
      'Which suppliers are behind schedule?',
      'Where is shipment #2401?',
      'What is driving the delay risk?',
    ],
  },
  graph: {
    nodeColors: {
      Supplier: '#B45309',
      Shipment: '#0F766E',
      Product: '#4338CA',
      Location: '#57534E',
      Risk: '#B91C1C',
      RiskSignal: '#EA580C',
    },
    defaultNode: '#78716C',
    background: '#EFEDE8',
  },
};

/** Editorial: serif, soft, generous. */
export const lumen: Tenant = {
  id: 'lumen',
  // A different subject, which is what makes domain packs visible rather
  // than only asserted: switching to this brand changes the entity types the
  // console offers, not just its colours.
  domain: 'clinical-trials',
  brand: { name: 'Lumen Intelligence', initials: 'LI' },
  palette: {
    primary: '#4C1D95',
    secondary: '#B91C1C',
    background: '#FBF7F4',
    surface: '#FFFFFF',
    divider: '#E8DFD8',
    ...SEMANTIC,
  },
  shape: { radius: 18, borderWidth: 1 },
  variants: {
    surface: 'flat',
    button: 'text',
    input: 'filled',
    chip: 'filled',
    controlSize: 'medium',
    interaction: 'flat',
  },
  density: { spacing: 10, fontScale: 1.05 },
  typography: {
    fontFamily: '"Iowan Old Style", "Palatino Linotype", Georgia, serif',
    headingWeight: 600,
    buttonTextTransform: 'none',
    letterSpacing: '0',
  },
  copy: {
    inputPlaceholder: 'Ask a question about your trials...',
    welcome:
      'A research assistant over your knowledge graph. Ask in plain language; every claim is traceable to its source.',
    starters: [
      'Which sites reported the most adverse events?',
      'Show enrolment by site',
      'Which trials share an investigator?',
    ],
  },
  graph: {
    nodeColors: {
      Trial: '#4C1D95',
      Site: '#0E7490',
      Investigator: '#9D174D',
      Participant: '#78716C',
      AdverseEvent: '#B91C1C',
      Sponsor: '#C2410C',
    },
    defaultNode: '#A8A29E',
    background: '#F5F0EC',
  },
};

export const TENANTS: Record<string, Tenant> = { acme, meridian, lumen };

export const DEFAULT_TENANT_ID = 'acme';

export const TENANT_IDS = Object.keys(TENANTS);

/**
 * Which tenant to render. `?tenant=` wins so the demo can be linked directly at
 * a brand; item 73 will add the deployed default and item 76 the switcher.
 */
export function resolveTenant(search: string = window.location.search): Tenant {
  const requested = new URLSearchParams(search).get('tenant');
  return TENANTS[requested ?? ''] ?? TENANTS[DEFAULT_TENANT_ID]!;
}
