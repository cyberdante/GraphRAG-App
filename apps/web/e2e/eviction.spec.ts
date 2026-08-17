import { expect, test } from '@playwright/test';
import { askAQuestion, openConsole } from './support';

/**
 * Storage does not fill up silently any more.
 *
 * A conversation with a full graph costs about 35 KB and browsers allow roughly
 * 5 MB, so a hundred and fifty conversations fill it. What used to happen then
 * was not a warning: `setItem` threw, the write was lost, and the conversation
 * that failed to save was the newest one.
 *
 * Asserted in a browser rather than against a fake Storage because the unit
 * tests already cover the policy, and what they cannot cover is whether the app
 * actually invokes it on the path a real query takes.
 */
test.describe('storage eviction', () => {
  /** Fills storage with stale conversations, oldest first, then reloads. */
  async function seedStaleHistory(page: import('@playwright/test').Page, count: number) {
    await page.goto('/?tenant=acme');
    await page.evaluate((howMany) => {
      localStorage.clear();
      for (let index = 0; index < howMany; index += 1) {
        const id = `old${index}`;
        const timestamp = new Date(Date.UTC(2025, 0, 1 + index)).toISOString();
        localStorage.setItem(
          `ragstone:acme:conversation:${id}`,
          JSON.stringify([
            { id: 'm', role: 'user', content: 'x'.repeat(1200), timestamp },
          ]),
        );
        localStorage.setItem(
          `ragstone:acme:graph:${id}`,
          JSON.stringify({ pad: 'x'.repeat(22_000) }),
        );
      }
    }, count);
  }

  const summarise = (page: import('@playwright/test').Page) =>
    page.evaluate(() => {
      const keys = Object.keys(localStorage);
      const current = localStorage.getItem('ragstone:acme:current-conversation');
      return {
        conversations: keys.filter((key) => key.includes(':conversation:')).length,
        graphs: keys.filter((key) => key.includes(':graph:')).length,
        bytes: keys.reduce((sum, key) => sum + (localStorage.getItem(key)?.length ?? 0) + key.length, 0),
        currentSaved: Boolean(localStorage.getItem(`ragstone:acme:conversation:${current}`)),
        oldestGone: !keys.includes('ragstone:acme:conversation:old0'),
        newestStaleKept: keys.includes('ragstone:acme:conversation:old119'),
        settingsKept: keys.includes('ragstone:theme') && keys.includes('ragstone:acme:retrieval'),
      };
    });

  test('answering a question prunes a history that has grown too long', async ({ page }) => {
    await seedStaleHistory(page, 120);
    await openConsole(page, 'acme', 'light');
    await askAQuestion(page, 'Which suppliers are at risk?');

    const after = await summarise(page);

    // The cap is 50, plus the conversation on screen.
    expect(after.conversations).toBeLessThanOrEqual(51);
    expect(after.bytes).toBeLessThan(2_000_000);

    // What survives is chosen, not incidental.
    expect(after.currentSaved, 'the conversation on screen must never be evicted').toBe(true);
    expect(after.oldestGone, 'the oldest should go first').toBe(true);
    expect(after.newestStaleKept, 'the newest stale conversation should outlive the oldest').toBe(true);
    expect(after.settingsKept, 'theme and retrieval preferences are not worth reclaiming').toBe(true);
  });

  test('a query still saves when storage was nearly full', async ({ page }) => {
    // The failure this replaces: the newest conversation was the one lost.
    await seedStaleHistory(page, 120);
    await openConsole(page, 'acme', 'light');
    await askAQuestion(page, 'Which suppliers are at risk?');

    await expect(page.getByText(/browser storage is full/i)).toBeHidden();
    expect((await summarise(page)).currentSaved).toBe(true);
  });

  test('a short history is left entirely alone', async ({ page }) => {
    await seedStaleHistory(page, 3);
    await openConsole(page, 'acme', 'light');
    await askAQuestion(page, 'Which suppliers are at risk?');

    const after = await summarise(page);
    expect(after.oldestGone).toBe(false);
    expect(after.conversations).toBe(4);
  });
});

/**
 * Tenant-scoped keys are only as good as the closures that use them.
 *
 * The storage keys carry the tenant, which makes isolation structural — but a
 * callback created with `[]` dependencies keeps the keys it was built with. So
 * loading a conversation after switching brand read the *previous* tenant's
 * storage: the leak the keys exist to prevent, reintroduced by a stale closure
 * and invisible to every unit test, because a unit test never switches tenant
 * and then clicks something.
 */
test.describe('settings and history survive a tenant switch', () => {
  test('a retrieval setting persists on its own, without a query', async ({ page }) => {
    // Listing only `queryHistory` in the dependencies meant a changed setting
    // was written when a query happened to be recorded, and not otherwise.
    await openConsole(page, 'acme', 'light');
    await page.getByLabel('Retrieval settings').click();
    await page.getByRole('button', { name: 'Risk', exact: true }).click();
    await page.getByLabel('Close retrieval settings').click();

    await page.reload();

    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('ragstone:acme:retrieval') ?? '{}'),
    );
    expect(stored.entityTypes).toEqual(['Risk']);
  });

  test('a new chat is recorded under the tenant on screen', async ({ page }) => {
    await openConsole(page, 'meridian', 'light');
    await page.getByRole('button', { name: 'New Chat' }).click();

    const pointers = await page.evaluate(() => ({
      meridian: localStorage.getItem('ragstone:meridian:current-conversation'),
      acme: localStorage.getItem('ragstone:acme:current-conversation'),
    }));

    expect(pointers.meridian).toBeTruthy();
    expect(pointers.acme).toBeNull();
  });
});
