import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AA_LARGE, AA_NORMAL, auditContrast, contrastRatio } from './contrast';
import { buildTheme } from './buildTheme';
import { graphPalette } from './graphPalette';
import { DEFAULT_TENANT_ID, TENANTS, TENANT_IDS, resolveTenant } from './tenants';

const tenants = TENANT_IDS.map((id) => [id, TENANTS[id]!] as const);

describe('tenant selection', () => {
  it('falls back to the default when none is requested', () => {
    expect(resolveTenant('').id).toBe(DEFAULT_TENANT_ID);
  });

  it('falls back rather than breaking on an unknown tenant', () => {
    expect(resolveTenant('?tenant=does-not-exist').id).toBe(DEFAULT_TENANT_ID);
  });

  it('selects a known tenant by id', () => {
    expect(resolveTenant('?tenant=meridian').id).toBe('meridian');
  });
});

describe.each(tenants)('tenant: %s', (_id, tenant) => {
  it('is readable in both modes', () => {
    // The whole point of deriving contrastText rather than declaring it.
    for (const darkMode of [false, true]) {
      const theme = buildTheme(tenant, darkMode);
      const issues = auditContrast([
        {
          label: 'primary button',
          foreground: theme.palette.primary.contrastText,
          background: theme.palette.primary.main,
        },
        {
          label: 'secondary button',
          foreground: theme.palette.secondary.contrastText,
          background: theme.palette.secondary.main,
        },
        {
          label: 'body text on page',
          foreground: theme.palette.text.primary,
          background: theme.palette.background.default,
        },
        {
          label: 'body text on panel',
          foreground: theme.palette.text.primary,
          background: theme.palette.background.paper,
        },
      ]);

      expect(issues, `${tenant.id} ${darkMode ? 'dark' : 'light'}`).toEqual([]);
    }
  });

  it('keeps graph labels legible against its own canvas', () => {
    const theme = buildTheme(tenant, false);
    const palette = graphPalette(theme, tenant);
    expect(contrastRatio(palette.label, palette.canvas)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('keeps every node colour distinguishable from the canvas', () => {
    const theme = buildTheme(tenant, false);
    const palette = graphPalette(theme, tenant);

    for (const type of Object.keys(tenant.graph.nodeColors)) {
      // Nodes are large shapes, so the large-text threshold is the right bar.
      expect(
        contrastRatio(palette.nodeColor(type), palette.canvas),
        `${tenant.id}/${type}`,
      ).toBeGreaterThanOrEqual(AA_LARGE);
    }
  });

  it('expresses its declared shape and density in the theme', () => {
    const theme = buildTheme(tenant, false);
    expect(theme.shape.borderRadius).toBe(tenant.shape.radius);
    expect(theme.spacing(1)).toBe(`${tenant.density.spacing}px`);
    expect(theme.typography.fontFamily).toBe(tenant.typography.fontFamily);
  });

  it('draws shadows only for an elevated surface treatment', () => {
    const theme = buildTheme(tenant, false);
    // shadows[1] is the first real elevation; index 0 is 'none' for everyone.
    const hasShadows = theme.shadows[1] !== 'none';
    expect(hasShadows).toBe(tenant.variants.surface === 'elevated');
  });

  it('applies its declared component variants as defaults', () => {
    const theme = buildTheme(tenant, false);
    const defaults = (name: string) =>
      (theme.components?.[name as 'MuiButton'] as { defaultProps?: Record<string, unknown> })
        ?.defaultProps ?? {};

    expect(defaults('MuiButton')['variant']).toBe(tenant.variants.button);
    expect(defaults('MuiTextField')['variant']).toBe(tenant.variants.input);
    expect(defaults('MuiChip')['variant']).toBe(tenant.variants.chip);
    expect(defaults('MuiButton')['size']).toBe(tenant.variants.controlSize);
    expect(defaults('MuiButtonBase')['disableRipple']).toBe(
      tenant.variants.interaction === 'flat',
    );
  });
});

describe('the tenants are actually different', () => {
  // A white-label claim tested against near-identical themes proves nothing.
  it('differ in shape, density and type, not only colour', () => {
    const radii = new Set(tenants.map(([, t]) => t.shape.radius));
    const spacings = new Set(tenants.map(([, t]) => t.density.spacing));
    const families = new Set(tenants.map(([, t]) => t.typography.fontFamily));

    expect(radii.size).toBe(tenants.length);
    expect(spacings.size).toBe(tenants.length);
    expect(families.size).toBe(tenants.length);
  });

  it('differ in how components are built, not only how they are painted', () => {
    // The step item 75 is about: three distinct design languages, not three
    // colourways of one.
    const surfaces = new Set(tenants.map(([, t]) => t.variants.surface));
    const buttons = new Set(tenants.map(([, t]) => t.variants.button));
    const inputs = new Set(tenants.map(([, t]) => t.variants.input));

    expect(surfaces.size).toBe(tenants.length);
    expect(buttons.size).toBe(tenants.length);
    expect(inputs.size).toBe(tenants.length);
  });

  it('give the graph a different palette each', () => {
    const canvases = new Set(
      tenants.map(([, t]) => graphPalette(buildTheme(t, false), t).canvas),
    );
    expect(canvases.size).toBe(tenants.length);
  });
});

describe('no component overrides a tenant decision', () => {
  // Same failure as the hardcoded colours, one level up: a component that
  // restates variant="outlined" or elevation={2} pins every tenant to that
  // choice, and the declared variant silently does nothing.
  const componentsDir2 = join(__dirname, '..', 'app', 'components');
  const OVERRIDE = /variant="(outlined|contained|text|filled|standard)"|elevation=\{\d+\}/;

  const sources2 = readdirSync(componentsDir2)
    .filter((file) => file.endsWith('.tsx') && !file.includes('.test.'))
    .map((file) => [file, readFileSync(join(componentsDir2, file), 'utf8')] as const);

  it.each(sources2)('%s leaves component variants to the theme', (_file, source) => {
    const offenders = source
      .split('\n')
      .map((line, index) => [index + 1, line] as const)
      .filter(([, line]) => OVERRIDE.test(line));

    expect(offenders).toEqual([]);
  });
});

describe('no component hardcodes a colour', () => {
  // The regression this guards is roadmap item 78: the graph carried 17
  // hardcoded colours and rendered identically under every tenant, so the
  // centrepiece of the product was the one part that could not be branded.
  const componentsDir = join(__dirname, '..', 'app', 'components');
  const COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(/;

  const sources = readdirSync(componentsDir)
    .filter((file) => file.endsWith('.tsx') && !file.includes('.test.'))
    .map((file) => [file, readFileSync(join(componentsDir, file), 'utf8')] as const);

  it.each(sources)('%s takes its colours from the theme', (_file, source) => {
    const offenders = source
      .split('\n')
      .map((line, index) => [index + 1, line] as const)
      .filter(([, line]) => COLOUR.test(line));

    expect(offenders).toEqual([]);
  });
});
