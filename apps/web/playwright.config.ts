import { defineConfig, devices } from '@playwright/test';

/**
 * The suite that runs in a browser, because the one that does not cannot see.
 *
 * Four defects reached a person before they reached a test: a settings drawer
 * opening behind the app bar, near-black button text at 4.19:1, a read-only
 * chip styled as a control, and shipped-versus-blocking encoded in red against
 * green. Every one passed the unit suite and always would have — jsdom does no
 * layout and has no opinion about perception.
 *
 * Runs against the built app with `VITE_USE_MOCK=true`, so it needs no Python,
 * no database and no key: the answers are canned and the same every run, which
 * is what makes a screenshot comparable to yesterday's.
 */
export default defineConfig({
  testDir: './e2e',
  // Snapshots are compared against images generated on Linux; see e2e/README.md.
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: 'http://127.0.0.1:4173',
    // A failure here is visual by definition, so keep the evidence.
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },

  expect: {
    toHaveScreenshot: {
      // Font hinting and antialiasing differ slightly even between runs on the
      // same machine. Zero tolerance produces failures nobody can act on, which
      // is how a visual suite gets switched off.
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    },
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 900 },
      },
    },
  ],

  webServer: {
    // Serves the production build rather than the dev server: the bundle the
    // tests look at should be the bundle a reader gets.
    // --host 127.0.0.1 explicitly: vite preview otherwise binds "localhost",
    // which on this machine resolved to IPv6 only, so a check against
    // 127.0.0.1 was refused and the server looked as though it never started.
    command: 'pnpm build:mock && pnpm preview --port 4173 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
