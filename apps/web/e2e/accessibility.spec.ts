import { expect, test } from '@playwright/test';
import { expectNoAccessibilityViolations } from './axe';
import { MODES, TENANTS, askAQuestion, openConsole, settle } from './support';

/**
 * The checks that would have caught what a person caught instead.
 *
 * Two of the four escaped defects were contrast failures, and neither was
 * visible to a screenshot diff — a pixel comparison has no opinion about
 * 4.19:1. They need a machine that computes ratios, which is what axe does.
 */
test.describe('accessibility', () => {
  for (const tenant of TENANTS) {
    for (const mode of MODES) {
      test(`${tenant} in ${mode} has no WCAG A or AA violations`, async ({ page }) => {
        await openConsole(page, tenant, mode);
        await expectNoAccessibilityViolations(page, `${tenant}/${mode}: empty state`);
      });
    }
  }

  test('an answered question is accessible', async ({ page }) => {
    // The state most of the interface only reaches after a query: the message
    // list, the citations, the trace panel and the graph toolbar.
    await openConsole(page, 'acme', 'light');
    await askAQuestion(page, 'Which suppliers are at risk?');

    await expectNoAccessibilityViolations(page, 'acme/light: answered');
  });

  test('the retrieval drawer is accessible', async ({ page }) => {
    await openConsole(page, 'acme', 'light');
    await page.getByLabel('Retrieval settings').click();
    await settle(page);

    await expectNoAccessibilityViolations(page, 'acme/light: retrieval drawer');
  });
});

/**
 * Contrast, asserted where it is actually rendered.
 *
 * The theme tests compute ratios from the palette, which is necessary and was
 * not sufficient: the failing button took its colour from an `sx` override the
 * palette knew nothing about. This reads the colours off the live element.
 */
test.describe('contrast as rendered', () => {
  for (const tenant of TENANTS) {
    for (const mode of MODES) {
      test(`${tenant} in ${mode} renders readable primary actions`, async ({ page }) => {
        await openConsole(page, tenant, mode);

        const failures = await page.evaluate(() => {
          const channel = (value: number) => {
            const scaled = value / 255;
            return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
          };
          const luminance = ([r, g, b]: number[]) =>
            0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

          /** rgb, plus the alpha — dropping it is how a translucent overlay
           *  gets measured as the colour it is painted with rather than the
           *  colour it produces. */
          const parse = (value: string): { rgb: number[]; alpha: number } => {
            const parts = (value.match(/[\d.]+/g) ?? []).map(Number);
            return { rgb: parts.slice(0, 3), alpha: parts.length > 3 ? parts[3] : 1 };
          };

          const over = (front: { rgb: number[]; alpha: number }, back: number[]) =>
            front.rgb.map((value, index) => front.alpha * value + (1 - front.alpha) * back[index]);

          /** The colour actually behind an element: walk up, compositing every
           *  translucent layer, until something opaque is reached. */
          const effectiveBackground = (element: Element): number[] => {
            const layers: { rgb: number[]; alpha: number }[] = [];
            let current: Element | null = element;
            while (current) {
              const parsed = parse(getComputedStyle(current).backgroundColor);
              if (parsed.rgb.length === 3 && parsed.alpha > 0) {
                layers.push(parsed);
                if (parsed.alpha >= 1) break;
              }
              current = current.parentElement;
            }
            let result = [255, 255, 255];
            for (const layer of layers.reverse()) result = over(layer, result);
            return result;
          };

          const ratio = (a: number[], b: number[]) => {
            const [x, y] = [luminance(a), luminance(b)];
            return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
          };

          const problems: string[] = [];
          for (const button of document.querySelectorAll('button')) {
            // WCAG 1.4.3 exempts inactive controls, and a disabled send button
            // renders its label in the same tone as its own greyed fill.
            if (button.disabled || button.getAttribute('aria-disabled') === 'true') continue;

            const style = getComputedStyle(button);
            const background = effectiveBackground(button);
            const foreground = over(parse(style.color), background);

            // Text is held to 1.4.3 at 4.5:1; an icon carries no text and is
            // held to 1.4.11 non-text contrast at 3:1. Judging a glyph by the
            // text threshold reports failures that are not failures.
            const hasText = (button.textContent ?? '').trim().length > 0;
            const threshold = hasText ? 4.5 : 3;

            const value = ratio(foreground, background);
            if (value < threshold) {
              const name = (button.textContent || button.ariaLabel || '?').trim().slice(0, 24);
              problems.push(`${name}: ${value.toFixed(2)} (needs ${threshold})`);
            }
          }
          return problems;
        });

        expect(failures, 'controls below their WCAG threshold').toEqual([]);
      });
    }
  }
});

/**
 * Status must survive the loss of colour.
 *
 * The defect this exists for: shipped and blocking were both filled discs
 * differing only in hue, on exactly the axis red-green colour blindness
 * removes. axe cannot catch that — it is about meaning, not contrast — and a
 * screenshot diff cannot either. Rendering in greyscale and asserting the
 * distinction survives is the only check that would have.
 */
test.describe('meaning does not depend on colour', () => {
  test('graph node types remain distinguishable without hue', async ({ page }) => {
    await openConsole(page, 'acme', 'light');
    await askAQuestion(page, 'Which suppliers are at risk?');

    const distinctInGrey = await page.evaluate(() => {
      const luminance = (value: string) => {
        const [r, g, b] = (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };

      const byType = new Map<string, number>();
      for (const circle of document.querySelectorAll('svg[width] .nodes circle')) {
        const type = (circle.parentElement as SVGGElement & { __data__?: { type: string } })
          ?.__data__?.type;
        if (type) byType.set(type, luminance(getComputedStyle(circle).fill));
      }
      return [...byType.entries()];
    });

    expect(distinctInGrey.length, 'no typed nodes were drawn').toBeGreaterThan(1);

    // Node colour is not the only cue — every node carries its type as text
    // beneath it — so this asserts the weaker, honest property: the palette is
    // not *entirely* flat once hue is removed.
    const greys = distinctInGrey.map(([, value]) => value);
    expect(Math.max(...greys) - Math.min(...greys)).toBeGreaterThan(10);
  });

  test('every node states its type in text, not only in colour', async ({ page }) => {
    // The guarantee that actually carries the meaning: a reader who cannot
    // separate the fills can still read what each node is.
    await openConsole(page, 'acme', 'light');
    await askAQuestion(page, 'Which suppliers are at risk?');

    const { circles, typeLabels } = await page.evaluate(() => ({
      circles: document.querySelectorAll('svg[width] .nodes circle').length,
      typeLabels: [...document.querySelectorAll('svg[width] .nodes .node-type')].filter(
        (node) => (node.textContent ?? '').trim().length > 0,
      ).length,
    }));

    expect(circles).toBeGreaterThan(0);
    expect(typeLabels).toBe(circles);
  });
});
