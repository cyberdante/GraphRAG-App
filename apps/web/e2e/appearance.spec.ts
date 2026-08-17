import { expect, test } from '@playwright/test';
import { MODES, TENANTS, askAQuestion, openConsole, settle } from './support';

/**
 * What the console looks like, held to what it looked like yesterday.
 *
 * Two of the four escaped defects were pure layout — a drawer opening behind
 * the app bar, and a read-only chip wearing a filled brand pill identical to
 * the button beside it. Neither is a contrast failure, so no amount of axe
 * would have found them; both are obvious in a picture.
 *
 * The graph is masked out of every shot. d3's force layout is seeded from
 * positions that depend on arrival order and jiggles coincident nodes with
 * `Math.random()`, so its pixels differ between runs for reasons that are not
 * regressions. Its structure is asserted in the unit suite by element count and
 * identity, and its colours by the contrast checks — the parts a screenshot
 * cannot judge are covered where they can be.
 */

/** The drawing surface, excluded from comparison but not from the page. */
const GRAPH = 'svg[width]';

test.describe('appearance', () => {
  for (const tenant of TENANTS) {
    for (const mode of MODES) {
      test(`${tenant} in ${mode} — empty state`, async ({ page }) => {
        await openConsole(page, tenant, mode);

        await expect(page).toHaveScreenshot(`${tenant}-${mode}-empty.png`, {
          mask: [page.locator(GRAPH)],
          fullPage: false,
        });
      });
    }
  }

  test('answered, with citations and the trace summary', async ({ page }) => {
    // The state that carries the most chrome: message list, citation cards,
    // the collapsed trace, and the graph toolbar with its counts.
    await openConsole(page, 'acme', 'light');
    await askAQuestion(page, 'Which suppliers are at risk?');

    await expect(page).toHaveScreenshot('acme-light-answered.png', {
      mask: [page.locator(GRAPH)],
    });
  });

  test('the trace panel, expanded', async ({ page }) => {
    await openConsole(page, 'acme', 'light');
    await askAQuestion(page, 'Which suppliers are at risk?');
    await page.getByLabel('Show query trace').first().click();
    await settle(page);

    await expect(page).toHaveScreenshot('acme-light-trace-open.png', {
      mask: [page.locator(GRAPH)],
    });
  });

  test('the retrieval drawer', async ({ page }) => {
    // The defect that started this: the heading and close button sat behind the
    // app bar, and the panel scrolled as one block so the way out could scroll
    // away. Both are visible here and in nothing else.
    await openConsole(page, 'acme', 'light');
    await page.getByLabel('Retrieval settings').click();
    await settle(page);

    await expect(page).toHaveScreenshot('acme-light-retrieval-drawer.png', {
      mask: [page.locator(GRAPH)],
    });
  });

  test('the retrieval drawer in a short window', async ({ page }) => {
    // Where clipping bites: a panel taller than the viewport must still show
    // its own heading and its own way out.
    await page.setViewportSize({ width: 900, height: 420 });
    await openConsole(page, 'acme', 'light');
    await page.getByLabel('Retrieval settings').click();
    await settle(page);

    await expect(page).toHaveScreenshot('acme-light-retrieval-short.png', {
      mask: [page.locator(GRAPH)],
    });
  });

  test('the history drawer', async ({ page }) => {
    await openConsole(page, 'acme', 'light');
    await askAQuestion(page, 'Which suppliers are at risk?');
    await page.getByLabel('menu').click();
    await settle(page);

    await expect(page).toHaveScreenshot('acme-light-history.png', {
      mask: [page.locator(GRAPH)],
    });
  });
});
