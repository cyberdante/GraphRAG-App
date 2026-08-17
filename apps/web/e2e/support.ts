import { expect, type Page } from '@playwright/test';

/** The brands the demo ships. Every check runs against all of them. */
export const TENANTS = ['acme', 'meridian', 'lumen'] as const;
export type TenantId = (typeof TENANTS)[number];

export const MODES = ['light', 'dark'] as const;
export type Mode = (typeof MODES)[number];

/**
 * Opens the console as one tenant, in one mode, ready to be looked at.
 *
 * `?tenant=` resolves without the switcher, which is demo-gated — so these
 * checks exercise the same path a client deployment uses rather than a
 * developer affordance.
 */
export async function openConsole(page: Page, tenant: TenantId, mode: Mode): Promise<void> {
  await page.goto(`/?tenant=${tenant}`);
  await expect(page.getByRole('button', { name: 'New Chat' })).toBeVisible();

  if (mode === 'dark') {
    await page.getByLabel('toggle theme').click();
  }

  await settle(page);
}

/**
 * Waits for the things that move to stop moving.
 *
 * Fonts first: a screenshot taken mid-swap catches fallback metrics and differs
 * from every other run. Then transitions, which `animations: 'disabled'` freezes
 * but does not rewind.
 */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
}

/**
 * Asks a question and waits for the whole answer.
 *
 * The mock client streams a canned response on a fixed script, so the finished
 * state is identical every run. Waiting for the trace summary rather than a
 * timeout means the check is tied to the answer being complete rather than to
 * how fast the machine is.
 */
export async function askAQuestion(page: Page, question: string): Promise<void> {
  await page.getByRole('textbox').first().fill(question);
  await page.getByLabel('Send query').click();
  await expect(page.getByLabel(/query trace/i).first()).toBeVisible({ timeout: 30_000 });
  await settle(page);
}
