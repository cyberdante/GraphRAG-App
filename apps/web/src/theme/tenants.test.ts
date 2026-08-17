import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AA_LARGE, AA_NORMAL, auditContrast, contrastRatio, luminance } from './contrast';
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

  // These originally ran in light mode only, which is how a dark-mode bug
  // shipped: meridian's light parchment canvas was kept in dark mode and drawn
  // on with white ink at 1.17:1, so the edges were invisible.
  describe.each([false, true])('in %s mode', (darkMode) => {
    const theme = () => buildTheme(tenant, darkMode);

    it('keeps graph labels legible against its own canvas', () => {
      const palette = graphPalette(theme(), tenant);
      expect(contrastRatio(palette.label, palette.canvas)).toBeGreaterThanOrEqual(AA_NORMAL);
    });

    it('keeps graph edges visible against its own canvas', () => {
      const palette = graphPalette(theme(), tenant);
      // Links are drawn at 40% ink; check the ink itself clears the large bar,
      // since a translucent stroke can only be worse than its source colour.
      expect(contrastRatio(palette.label, palette.canvas)).toBeGreaterThanOrEqual(AA_LARGE);
    });

    it('keeps every node colour distinguishable from the canvas', () => {
      const palette = graphPalette(theme(), tenant);

      for (const type of Object.keys(tenant.graph.nodeColors)) {
        // Nodes are large shapes, so the large-text threshold is the right bar.
        expect(
          contrastRatio(palette.nodeColor(type), palette.canvas),
          `${tenant.id}/${type} (${darkMode ? 'dark' : 'light'})`,
        ).toBeGreaterThanOrEqual(AA_LARGE);
      }
    });

    it('never puts a light canvas in a dark app, or the reverse', () => {
      const palette = graphPalette(theme(), tenant);
      const canvasIsDark = luminance(palette.canvas) < 0.5;
      expect(canvasIsDark).toBe(darkMode);
    });

    it('keeps brand colours usable as text and borders, not just as fills', () => {
      // The gap that let the unreadable "14 Relationships" chip through: the
      // audit only checked contrastText *on* a filled brand colour, never the
      // brand colour used as ink on a surface, which is what an outlined chip
      // does. Meridian's slate secondary sat at 1.65:1 on the dark panel.
      const built = theme();
      for (const role of ['primary', 'secondary'] as const) {
        expect(
          contrastRatio(built.palette[role].main, built.palette.background.paper),
          `${tenant.id} ${role} on panel (${darkMode ? 'dark' : 'light'})`,
        ).toBeGreaterThanOrEqual(AA_LARGE);
      }
    });
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

describe('no component overrides a derived foreground', () => {
  /**
   * The regression, found from a screenshot: Navbar set `color: 'text.primary'`
   * on two `<Button>`s. The theme's default button variant is contained, so
   * those sit on `primary.main` — and naming a foreground defeats the
   * `contrastText` that item 74 derives from the tenant's own brand colour.
   *
   * The result was near-black on a mid blue at 4.19:1, on Meridian's amber at
   * 3.86:1, and on Lumen's violet at 1.84:1. All three below AA, in a product
   * whose selling point is that any brand colour stays readable.
   *
   * The existing guards did not catch it: it hardcodes no hex, and names no
   * `variant`. It overrides the *foreground* instead.
   */
  const componentsDir3 = join(__dirname, '..', 'app', 'components');
  const BUTTON_WITH_COLOUR = /<Button\b[\s\S]{0,400}?color:\s*'(text|common)\./;

  const sources3 = readdirSync(componentsDir3)
    .filter((file) => file.endsWith('.tsx') && !file.includes('.test.'))
    .map((file) => [file, readFileSync(join(componentsDir3, file), 'utf8')] as const);

  it.each(sources3)('%s lets buttons take the derived foreground', (_file, source) => {
    expect(BUTTON_WITH_COLOUR.test(source)).toBe(false);
  });
});

describe('what a tenant actually reads', () => {
  // Computed from the built theme rather than from a list of colours someone
  // remembered to add, so a new tenant is covered the day it is declared.
  const pairs = (theme: ReturnType<typeof buildTheme>) => [
    ['button label on a primary button', theme.palette.primary.contrastText, theme.palette.primary.main],
    ['button label on a secondary button', theme.palette.secondary.contrastText, theme.palette.secondary.main],
    ['body text on the page', theme.palette.text.primary, theme.palette.background.default],
    ['body text on a card', theme.palette.text.primary, theme.palette.background.paper],
  ];

  /**
   * Brand colours used *as text*, which only dark mode is held to.
   *
   * The pair the first list missed, and the one that failed: a tenant may
   * declare text or outlined buttons, and MUI then renders `primary.main` as
   * the label itself rather than as a fill. Checking contrastText-on-main
   * covered the contained case alone, and meridian's amber sat at 3.40:1 on the
   * dark bar.
   *
   * Asserted in dark mode only, matching the stance the theme already takes:
   * dark surfaces are our derivation, so adapting the colour there is our job,
   * while a tenant's light-mode values are used exactly as authored. Acme's own
   * #1976d2 is 4.25:1 as text on its page background — a fact about the colour
   * they chose, not a defect we introduced, and one the rendered-contrast check
   * in e2e/accessibility.spec.ts catches if a component ever puts it there.
   */
  const textPairs = (theme: ReturnType<typeof buildTheme>) => [
    ['brand as text on a card', theme.palette.primary.main, theme.palette.background.paper],
    ['brand as text on the page', theme.palette.primary.main, theme.palette.background.default],
    ['secondary as text on a card', theme.palette.secondary.main, theme.palette.background.paper],
  ];

  for (const [id, tenant] of tenants) {
    for (const dark of [false, true]) {
      it(`${id} in ${dark ? 'dark' : 'light'} mode meets AA everywhere`, () => {
        const theme = buildTheme(tenant, dark);
        const checked = dark ? [...pairs(theme), ...textPairs(theme)] : pairs(theme);
        const failures = checked
          .map(([what, fg, bg]) => [what, contrastRatio(fg as string, bg as string)] as const)
          .filter(([, ratio]) => ratio < AA_NORMAL)
          .map(([what, ratio]) => `${what}: ${ratio.toFixed(2)}`);

        expect(failures).toEqual([]);
      });
    }
  }
});

describe('a chip that reports is not a chip that acts', () => {
  /**
   * Reported from a screenshot: "55 Nodes" was a solid blue pill sitting beside
   * a solid blue "New Chat" button. Same fill, same weight, same radius — but
   * one is a control and the other is a read-only count, so the only way to
   * learn the chip does nothing was to click it.
   *
   * The distinction is drawn from whether the chip is interactive, so it holds
   * for every tenant and every caller rather than depending on each one
   * remembering.
   */
  const chipStyle = (
    theme: ReturnType<typeof buildTheme>,
    ownerState: { color?: string; clickable?: boolean; onClick?: () => void },
  ) => {
    const root = theme.components?.MuiChip?.styleOverrides?.root;
    return typeof root === 'function'
      ? (root as (arg: { ownerState: unknown }) => Record<string, unknown>)({ ownerState })
      : (root as Record<string, unknown>);
  };

  for (const [id, tenant] of tenants) {
    for (const dark of [false, true]) {
      const mode = dark ? 'dark' : 'light';

      it(`${id} in ${mode} draws a read-only chip differently from a control`, () => {
        const theme = buildTheme(tenant, dark);
        const readOnly = chipStyle(theme, { color: 'primary' });
        const control = chipStyle(theme, { color: 'primary', clickable: true });

        expect(readOnly.backgroundColor).toBe('transparent');
        expect(readOnly.border).toBeDefined();
        // The interactive one keeps whatever fill the tenant declared.
        expect(control.backgroundColor).toBeUndefined();
      });

      it(`${id} in ${mode} keeps read-only chip text readable`, () => {
        // An outlined chip takes its colour from a brand value authored as a
        // fill. Legible on a button is not legible as text.
        const theme = buildTheme(tenant, dark);

        for (const colour of ['primary', 'secondary']) {
          const style = chipStyle(theme, { color: colour });
          const ratio = contrastRatio(
            style.color as string,
            theme.palette.background.paper,
          );
          expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL);
        }
      });
    }
  }

  it('leaves a chip with no brand colour alone', () => {
    // The entity-type chips in the retrieval panel are unselected `default`
    // chips. Nothing here should touch them.
    const style = chipStyle(buildTheme(TENANTS[DEFAULT_TENANT_ID]!, false), {});

    expect(style.backgroundColor).toBeUndefined();
  });
});
