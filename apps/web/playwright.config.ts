import { defineConfig, devices } from '@playwright/test';

/**
 * See https://playwright.dev/docs/test-configuration.
 */

const EXPORT_PORT = 4173;
const EXPORT_URL = `http://localhost:${EXPORT_PORT}`;
const IS_EXPORT = process.argv.includes('--project=export');
export default defineConfig({
  testDir: './e2e',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:3000',
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  /*
   * Two targets.
   *
   *   chromium — the dev server, i.e. what web users get.
   *   export   — apps/web/out served as plain files, i.e. what ships inside
   *              the iOS and Android bundles.
   *
   * They are not interchangeable. The export has no server: no middleware, no
   * redirects, no route handlers. A page that quietly depends on any of those
   * passes against the dev server and 404s in the app, which is why the export
   * needs its own run rather than an assumption that "the build succeeded" is
   * enough.
   *
   * Run one or the other:
   *   npx playwright test --project=chromium
   *   npm run build:native --workspace=apps/web && npx playwright test --project=export
   */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /export\.spec\.ts/,
    },
    {
      name: 'export',
      use: { ...devices['Desktop Chrome'], baseURL: EXPORT_URL },
      testMatch: /export\.spec\.ts/,
    },
  ],

  /*
   * `--project=export` serves the built directory; everything else starts the
   * dev server. Playwright starts every configured webServer regardless of
   * project, so this picks one rather than declaring both.
   */
  webServer: IS_EXPORT
    ? {
        // -s rewrites unknown paths to index.html, which is what a static host
        // does. Without it, trailing-slash routes 404 and the run tests
        // nothing useful.
        command: `npx serve -s out -l ${EXPORT_PORT}`,
        url: EXPORT_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120 * 1000,
      }
    : {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120 * 1000,
      },
});

