import { expect, test } from '@playwright/test';
import { askAQuestion, openConsole, settle } from './support';

/**
 * "Fit to view" has to actually frame the graph.
 *
 * It used to reset to scale 1 and translate to the middle of the viewport,
 * ignoring where the nodes were — so on a graph larger than the pane it cut the
 * outer nodes off, which is the opposite of fitting, and on a small one it left
 * the drawing in a corner.
 *
 * The arithmetic is unit-tested, but only a browser can say whether the result
 * is on screen: jsdom does no layout, and the numbers being right is not the
 * same claim as the picture being right. This runs anywhere — it compares
 * positions rather than pixels, so it needs no baseline and no container.
 */

const GRAPH = 'svg[width]';

test.describe('fitting the graph', () => {
  test('brings every node inside the pane', async ({ page }) => {
    await openConsole(page, 'acme', 'light');
    await askAQuestion(page, 'Which suppliers are at risk?');

    const svg = page.locator(GRAPH);
    await expect(svg).toBeVisible();

    await page.getByLabel('Fit to view').click();
    // The fit animates over 750ms; settling avoids reading a frame mid-flight.
    await settle(page);
    await page.waitForTimeout(1000);

    const outside = await page.evaluate((selector) => {
      const element = document.querySelector(selector) as SVGSVGElement | null;
      if (!element) return -1;
      const pane = element.getBoundingClientRect();

      return [...element.querySelectorAll('circle')].filter((node) => {
        const box = node.getBoundingClientRect();
        // Centres, not bounding boxes: a node exactly on the edge is framed,
        // and asking for its whole radius would fail on a legitimate fit.
        const x = box.left + box.width / 2;
        const y = box.top + box.height / 2;
        return x < pane.left || x > pane.right || y < pane.top || y > pane.bottom;
      }).length;
    }, GRAPH);

    expect(outside).toBe(0);
  });

  test('does not blow a small graph up to fill the pane', async ({ page }) => {
    // Two nodes magnified until they touch the edges reads as broken rather
    // than as fitted, so the fit is capped at 1.
    await openConsole(page, 'acme', 'light');
    await askAQuestion(page, 'Which suppliers are at risk?');

    await page.getByLabel('Fit to view').click();
    await settle(page);
    await page.waitForTimeout(1000);

    const scale = await page.evaluate((selector) => {
      const element = document.querySelector(selector);
      const transform = element?.querySelector('g')?.getAttribute('transform') ?? '';
      const match = /scale\(([\d.]+)\)/.exec(transform);
      return match ? Number(match[1]) : 1;
    }, GRAPH);

    expect(scale).toBeLessThanOrEqual(1.0001);
  });
});
