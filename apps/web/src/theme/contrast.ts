/**
 * WCAG contrast, for palettes we do not control.
 *
 * A tenant supplies a brand colour. If we put white text on a pale yellow
 * primary, the product is inaccessible in that client's brand through no fault
 * of theirs, and nobody notices until someone tries to read it. So the
 * foreground is derived rather than assumed, and the result is checkable in a
 * test rather than by eye.
 *
 * Ratios follow WCAG 2.1: relative luminance per the sRGB formula, contrast as
 * (L1 + 0.05) / (L2 + 0.05).
 */

/** WCAG AA for normal text. */
export const AA_NORMAL = 4.5;
/** WCAG AA for large text (18.66px bold, or 24px). */
export const AA_LARGE = 3;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Accepts #rgb, #rrggbb and rgb()/rgba() notation. */
export function parseColor(color: string): Rgb {
  const value = color.trim();

  const rgbMatch = value.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (rgbMatch) {
    return {
      r: Number(rgbMatch[1]),
      g: Number(rgbMatch[2]),
      b: Number(rgbMatch[3]),
    };
  }

  const hex = value.replace('#', '');
  const expanded =
    hex.length === 3
      ? hex
          .split('')
          .map((char) => char + char)
          .join('')
      : hex;

  if (!/^[0-9a-f]{6}$/i.test(expanded)) {
    throw new Error(`Cannot parse colour: ${color}`);
  }

  return {
    r: parseInt(expanded.slice(0, 2), 16),
    g: parseInt(expanded.slice(2, 4), 16),
    b: parseInt(expanded.slice(4, 6), 16),
  };
}

/** Relative luminance, WCAG 2.1 sRGB formula. */
export function luminance(color: string): number {
  const { r, g, b } = parseColor(color);

  const channel = (value: number): number => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contrast ratio between two colours, from 1 (identical) to 21 (black on white). */
export function contrastRatio(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * The readable foreground for a background, chosen rather than assumed.
 *
 * This is what stops a pale brand colour producing unreadable buttons. MUI's
 * `getContrastText` does the same job for its own palette; this exists so the
 * graph — which is drawn on a canvas MUI knows nothing about — gets the same
 * guarantee, and so the choice can be asserted in a test.
 */
export function readableOn(background: string, light = '#FFFFFF', dark = '#111111'): string {
  return contrastRatio(light, background) >= contrastRatio(dark, background) ? light : dark;
}

export interface ContrastIssue {
  label: string;
  foreground: string;
  background: string;
  ratio: number;
  required: number;
}

/**
 * Checks a set of foreground/background pairings, returning what fails.
 *
 * Used by the tenant tests. A tenant that cannot pass this is a bug report to
 * the client, not something to render anyway and hope.
 */
export function auditContrast(
  pairs: Array<{ label: string; foreground: string; background: string; required?: number }>,
): ContrastIssue[] {
  return pairs
    .map(({ label, foreground, background, required = AA_NORMAL }) => ({
      label,
      foreground,
      background,
      ratio: contrastRatio(foreground, background),
      required,
    }))
    .filter((result) => result.ratio < result.required);
}
