/**
 * What a tenant may change about the product.
 *
 * This is the white-label contract. If a property is not here, a tenant cannot
 * change it — so the shape of this type is the honest answer to "how
 * white-label is it?", and the answer should not be "the colours".
 *
 * Deliberately serialisable: a tenant is a JSON document, so it can be fetched
 * at runtime and one build can serve every client (roadmap item 73).
 */

/** Where a colour lands on the interface. */
export interface TenantPalette {
  primary: string;
  secondary: string;
  /** Page background, behind everything. */
  background: string;
  /** Panels, cards, the composer. */
  surface: string;
  divider: string;
  /** Semantic colours, kept apart from brand so meaning survives rebranding. */
  success: string;
  warning: string;
  error: string;
}

/** Corner treatment, in pixels. 0 is square, 999 is a pill. */
export interface TenantShape {
  radius: number;
  /** Border width for outlined surfaces. Thicker reads more industrial. */
  borderWidth: number;
  /**
   * Replace elevation shadows with borders. Material's stacked shadows are one
   * of its strongest tells, so this is a per-tenant variant in the sense of
   * roadmap item 75, not a cosmetic toggle.
   */
  flat: boolean;
}

/**
 * Spacing base in pixels. Everything else is a multiple, so this alone moves
 * the whole interface between airy and dense.
 */
export interface TenantDensity {
  spacing: number;
  /** Multiplies the type scale; below 1 tightens the whole interface. */
  fontScale: number;
}

export interface TenantTypography {
  /** CSS font-family stack. Must be self-hosted or a system stack — see ADR 0001 on CSP. */
  fontFamily: string;
  /** Optional display face for headings; falls back to fontFamily. */
  displayFamily?: string;
  headingWeight: number;
  /** Material's uppercase buttons are one of its loudest tells. */
  buttonTextTransform: 'none' | 'uppercase';
  letterSpacing: string;
}

export interface TenantBrand {
  /** Shown in the navbar and the document title. */
  name: string;
  /** Two or three characters for the mark when no logo is supplied. */
  initials: string;
  /** Self-hosted or data URI. Absent means the initials mark is used. */
  logoUrl?: string;
  footerText?: string;
}

/**
 * How graph entities are coloured. Keyed by node type, so colour follows
 * meaning rather than being carried on each datum — which is what let the
 * graph ignore the theme entirely (roadmap items 78 and 69).
 */
export interface TenantGraph {
  /** Node type to colour. Types absent here fall back to `defaultNode`. */
  nodeColors: Record<string, string>;
  defaultNode: string;
  /** Canvas behind the graph. Absent means the theme's surface colour. */
  background?: string;
}

export interface Tenant {
  id: string;
  brand: TenantBrand;
  palette: TenantPalette;
  shape: TenantShape;
  density: TenantDensity;
  typography: TenantTypography;
  graph: TenantGraph;
}
