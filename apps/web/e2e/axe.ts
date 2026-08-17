import { AxeBuilder } from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/**
 * Fails on any WCAG A or AA violation, and says which element and why.
 *
 * axe's default report is a wall of JSON. A failure nobody can read is a
 * failure that gets skipped, so this renders the rule, the impact and the
 * offending selector — the three things needed to go and fix it.
 */
export async function expectNoAccessibilityViolations(
  page: Page,
  context: string,
): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const readable = results.violations.map((violation) => {
    const where = violation.nodes
      .slice(0, 3)
      .map((node) =>
        [
          `      at ${node.target.join(' ')}`,
          // The element itself, because a generated class name locates nothing:
          // hunting one down cost more than the fix it pointed at.
          `      html: ${node.html.replace(/\s+/g, ' ').slice(0, 160)}`,
          `      why: ${node.failureSummary?.split('\n').join(' ')}`,
        ].join('\n'),
      )
      .join('\n');
    return `  [${violation.impact}] ${violation.id}: ${violation.help}\n${where}`;
  });

  expect(readable, `${context}\n${readable.join('\n')}`).toEqual([]);
}
