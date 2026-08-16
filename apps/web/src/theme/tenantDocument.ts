/**
 * Parsing a tenant document that arrived over the network.
 *
 * A fetched document is not trusted input. It may be stale, hand-edited, or
 * written against an older shape. The response to that is not to reject it —
 * refusing to render because a client mistyped one hex value would be worse
 * than the typo. Every field falls back to the base tenant independently, and
 * what was repaired is reported.
 *
 * This is also where roadmap item 74's validation half lives: a palette that
 * cannot be read is caught here rather than shipped to a client's users.
 */

import type { Tenant } from '@ragstone/shared';
import { AA_LARGE, AA_NORMAL, contrastRatio, readableOn } from './contrast';

export type IssueLevel = 'repaired' | 'warning';

export interface TenantIssue {
  level: IssueLevel;
  /** Dotted path into the document, e.g. `palette.primary`. */
  path: string;
  message: string;
}

export interface ParsedTenant {
  tenant: Tenant;
  issues: TenantIssue[];
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

// The variant vocabulary, repeated here as values so a document can be checked
// against it at runtime — a TypeScript union alone proves nothing about JSON
// that arrived over the network.
const SURFACES = ['elevated', 'outlined', 'flat'] as const;
const BUTTONS = ['contained', 'outlined', 'text'] as const;
const INPUTS = ['outlined', 'filled', 'standard'] as const;
const CHIPS = ['filled', 'outlined'] as const;
const CONTROL_SIZES = ['medium', 'small'] as const;
const INTERACTIONS = ['ripple', 'flat'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Reads one field, falling back to the base and recording why.
 *
 * Curried over a shared issue list so callers read as a list of fields rather
 * than a pile of if-statements.
 */
function reader(source: Record<string, unknown>, issues: TenantIssue[], prefix: string) {
  const note = (path: string, message: string) =>
    issues.push({ level: 'repaired', path: `${prefix}${path}`, message });

  return {
    color(key: string, fallback: string): string {
      const value = source[key];
      if (typeof value !== 'string') {
        if (value !== undefined) note(key, `expected a colour string, got ${typeof value}`);
        else note(key, 'missing');
        return fallback;
      }
      if (!HEX.test(value)) {
        note(key, `"${value}" is not a hex colour`);
        return fallback;
      }
      return value;
    },

    text(key: string, fallback: string): string {
      const value = source[key];
      if (typeof value !== 'string' || value.trim() === '') {
        if (value !== undefined) note(key, 'expected a non-empty string');
        return fallback;
      }
      return value;
    },

    number(key: string, fallback: number, min: number, max: number): number {
      const value = source[key];
      if (typeof value !== 'number' || Number.isNaN(value)) {
        if (value !== undefined) note(key, 'expected a number');
        return fallback;
      }
      if (value < min || value > max) {
        note(key, `${value} is outside ${min}–${max}`);
        return fallback;
      }
      return value;
    },

    boolean(key: string, fallback: boolean): boolean {
      const value = source[key];
      if (typeof value !== 'boolean') {
        if (value !== undefined) note(key, 'expected a boolean');
        return fallback;
      }
      return value;
    },

    oneOf<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
      const value = source[key];
      if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) {
        return value as T;
      }
      if (value !== undefined) note(key, `expected one of ${allowed.join(', ')}`);
      return fallback;
    },

    strings(key: string, fallback: string[]): string[] {
      const value = source[key];
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
        if (value !== undefined) note(key, 'expected an array of strings');
        return fallback;
      }
      return value.length > 0 ? (value as string[]) : fallback;
    },
  };
}

const section = (source: Record<string, unknown>, key: string): Record<string, unknown> =>
  isRecord(source[key]) ? (source[key] as Record<string, unknown>) : {};

/**
 * Merges a document over a base tenant, repairing anything unusable.
 *
 * Always returns a renderable tenant. `issues` is what the deployment should
 * be told about — an empty list means the document was taken as written.
 */
export function parseTenant(input: unknown, base: Tenant): ParsedTenant {
  const issues: TenantIssue[] = [];

  if (!isRecord(input)) {
    return {
      tenant: base,
      issues: [
        { level: 'warning', path: '', message: 'document is not an object; using the bundled tenant' },
      ],
    };
  }

  const root = reader(input, issues, '');
  const brandSource = section(input, 'brand');
  const brand = reader(brandSource, issues, 'brand.');
  const paletteSource = section(input, 'palette');
  const palette = reader(paletteSource, issues, 'palette.');
  const shapeSource = section(input, 'shape');
  const shape = reader(shapeSource, issues, 'shape.');
  const densitySource = section(input, 'density');
  const density = reader(densitySource, issues, 'density.');
  const typeSource = section(input, 'typography');
  const type = reader(typeSource, issues, 'typography.');
  const variantSource = section(input, 'variants');
  const variant = reader(variantSource, issues, 'variants.');
  const copySource = section(input, 'copy');
  const copy = reader(copySource, issues, 'copy.');
  const graphSource = section(input, 'graph');
  const graph = reader(graphSource, issues, 'graph.');

  const transform = typeSource['buttonTextTransform'];
  const buttonTextTransform =
    transform === 'none' || transform === 'uppercase'
      ? transform
      : (() => {
          if (transform !== undefined) {
            issues.push({
              level: 'repaired',
              path: 'typography.buttonTextTransform',
              message: 'expected "none" or "uppercase"',
            });
          }
          return base.typography.buttonTextTransform;
        })();

  // Node colours are open-ended: a domain pack may define types we do not know.
  const nodeColors: Record<string, string> = { ...base.graph.nodeColors };
  const declaredColors = section(graphSource, 'nodeColors');
  for (const [type_, value] of Object.entries(declaredColors)) {
    if (typeof value === 'string' && HEX.test(value)) {
      nodeColors[type_] = value;
    } else {
      issues.push({
        level: 'repaired',
        path: `graph.nodeColors.${type_}`,
        message: 'not a hex colour',
      });
    }
  }

  const backgroundRaw = graphSource['background'];
  const background =
    typeof backgroundRaw === 'string' && HEX.test(backgroundRaw) ? backgroundRaw : undefined;
  if (backgroundRaw !== undefined && background === undefined) {
    issues.push({ level: 'repaired', path: 'graph.background', message: 'not a hex colour' });
  }

  const tenant: Tenant = {
    id: root.text('id', base.id),
    brand: {
      name: brand.text('name', base.brand.name),
      initials: brand.text('initials', base.brand.initials),
      ...(typeof brandSource['logoUrl'] === 'string'
        ? { logoUrl: brandSource['logoUrl'] as string }
        : {}),
      ...(typeof brandSource['footerText'] === 'string'
        ? { footerText: brandSource['footerText'] as string }
        : {}),
    },
    palette: {
      primary: palette.color('primary', base.palette.primary),
      secondary: palette.color('secondary', base.palette.secondary),
      background: palette.color('background', base.palette.background),
      surface: palette.color('surface', base.palette.surface),
      divider: palette.color('divider', base.palette.divider),
      success: palette.color('success', base.palette.success),
      warning: palette.color('warning', base.palette.warning),
      error: palette.color('error', base.palette.error),
    },
    shape: {
      radius: shape.number('radius', base.shape.radius, 0, 999),
      borderWidth: shape.number('borderWidth', base.shape.borderWidth, 0, 8),
    },
    variants: {
      surface: variant.oneOf('surface', SURFACES, base.variants.surface),
      button: variant.oneOf('button', BUTTONS, base.variants.button),
      input: variant.oneOf('input', INPUTS, base.variants.input),
      chip: variant.oneOf('chip', CHIPS, base.variants.chip),
      controlSize: variant.oneOf('controlSize', CONTROL_SIZES, base.variants.controlSize),
      interaction: variant.oneOf('interaction', INTERACTIONS, base.variants.interaction),
    },
    density: {
      spacing: density.number('spacing', base.density.spacing, 2, 24),
      fontScale: density.number('fontScale', base.density.fontScale, 0.5, 2),
    },
    typography: {
      fontFamily: type.text('fontFamily', base.typography.fontFamily),
      ...(typeof typeSource['displayFamily'] === 'string'
        ? { displayFamily: typeSource['displayFamily'] as string }
        : {}),
      headingWeight: type.number('headingWeight', base.typography.headingWeight, 100, 900),
      buttonTextTransform,
      letterSpacing: type.text('letterSpacing', base.typography.letterSpacing),
    },
    copy: {
      inputPlaceholder: copy.text('inputPlaceholder', base.copy.inputPlaceholder),
      welcome: copy.text('welcome', base.copy.welcome),
      starters: copy.strings('starters', base.copy.starters),
    },
    graph: {
      nodeColors,
      defaultNode: graph.color('defaultNode', base.graph.defaultNode),
      ...(background ? { background } : {}),
    },
  };

  issues.push(...auditTenantContrast(tenant));

  return { tenant, issues };
}

/**
 * Contrast problems a tenant cannot see in their own brand guidelines.
 *
 * Reported rather than repaired: silently altering a client's brand colour is
 * worse than telling them it is unreadable. The one thing derived for them is
 * the text *on* their colour, which they never specified.
 */
export function auditTenantContrast(tenant: Tenant): TenantIssue[] {
  const issues: TenantIssue[] = [];

  const check = (path: string, foreground: string, background: string, required: number) => {
    const ratio = contrastRatio(foreground, background);
    if (ratio < required) {
      issues.push({
        level: 'warning',
        path,
        message: `contrast ${ratio.toFixed(2)}:1 is below ${required}:1`,
      });
    }
  };

  check(
    'palette.primary',
    readableOn(tenant.palette.primary),
    tenant.palette.primary,
    AA_NORMAL,
  );
  check(
    'palette.secondary',
    readableOn(tenant.palette.secondary),
    tenant.palette.secondary,
    AA_NORMAL,
  );
  check('palette.surface', readableOn(tenant.palette.surface), tenant.palette.surface, AA_NORMAL);

  const canvas = tenant.graph.background ?? tenant.palette.background;
  for (const [type, color] of Object.entries(tenant.graph.nodeColors)) {
    check(`graph.nodeColors.${type}`, color, canvas, AA_LARGE);
  }

  return issues;
}
