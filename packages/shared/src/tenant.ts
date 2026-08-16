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
}

/**
 * How components are built, as opposed to what colour they are.
 *
 * This is the step from "our colours" to "our design language": a client can
 * say their buttons are outlined, their inputs underlined and their surfaces
 * flat, and get exactly that.
 *
 * Deliberately a closed vocabulary rather than free-form style overrides.
 * Enumerated choices can be validated, tested and rendered predictably, and
 * they do not weld the tenant contract to one component library's internals.
 * Letting a tenant post arbitrary CSS is a different and much larger decision
 * — see the L4 discussion in the roadmap — not an extension of this one.
 */
export interface TenantVariants {
  /** How panels separate from the page. Shadows are a strong Material tell. */
  surface: 'elevated' | 'outlined' | 'flat';
  button: 'contained' | 'outlined' | 'text';
  /** 'standard' is underlined; the notched outline is distinctly Material. */
  input: 'outlined' | 'filled' | 'standard';
  chip: 'filled' | 'outlined';
  /** Control sizing, separate from the spacing scale in TenantDensity. */
  controlSize: 'medium' | 'small';
  /** The ripple is Material's most recognisable behaviour. */
  interaction: 'ripple' | 'flat';
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

/**
 * User-facing copy that is not the product's to write.
 *
 * A tenant in pharma should not be asked about supply chains, and no client
 * should be welcomed to somebody else's product name. Colour was the obvious
 * white-label surface; wording is the one that gets missed, and it is the more
 * embarrassing of the two when it leaks into an export.
 */
export interface TenantCopy {
  /** Composer placeholder. Names the tenant's domain, not ours. */
  inputPlaceholder: string;
  /** One line under the welcome heading on an empty conversation. */
  welcome: string;
  /** Example questions offered before anything has been asked. */
  starters: string[];
}

export interface Tenant {
  id: string;
  brand: TenantBrand;
  palette: TenantPalette;
  shape: TenantShape;
  density: TenantDensity;
  typography: TenantTypography;
  variants: TenantVariants;
  copy: TenantCopy;
  graph: TenantGraph;
}
