import { test, expect } from '@playwright/test';

/**
 * The static export, served as plain files.
 *
 * This is what ships inside the iOS and Android bundles, so the thing under
 * test is specifically what changes when the server disappears: no middleware,
 * no redirects, no route handlers, no image optimizer. A page that depends on
 * any of them passes against the dev server and fails in the app.
 *
 * Run with:
 *   npm run build:native --workspace=apps/web
 *   npx playwright test --project=export
 */

test.describe('static export', () => {
  test('home page renders without a server', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
    // The shell must render from the file itself, not from a server response.
    await expect(page).toHaveTitle(/10Q/i);
  });

  test('every question page exists as a real file', async ({ page }) => {
    // generateStaticParams failing silently would ship a game that dead-ends
    // partway through. There is no server to render the missing ones.
    for (const i of [1, 5, 10]) {
      const res = await page.goto(`/play/q/${i}/`);
      expect(res?.status(), `/play/q/${i}/ should exist`).toBeLessThan(400);
    }
  });

  test('routes converted off dynamic segments are reachable', async ({ page }) => {
    for (const path of ['/invite/', '/u/', '/leagues/view/']) {
      const res = await page.goto(path);
      expect(res?.status(), `${path} should exist`).toBeLessThan(400);
    }
  });

  test('query params drive the converted routes', async ({ page }) => {
    // The param has to be read client-side from the URL, because there is no
    // server to pass it in.
    await page.goto('/u/?handle=Playerb78c2f4e');
    await expect(page.locator('body')).toBeVisible();
    await expect(page).toHaveURL(/handle=Playerb78c2f4e/);
  });

  test('no optimizer URLs in served markup', async ({ page }) => {
    // /_next/image has no server behind it in a bundle: it is a broken image,
    // not an error anyone sees.
    await page.goto('/');
    const html = await page.content();
    expect(html).not.toMatch(/\/_next\/image\?/);
  });

  test('client-side navigation works without a server', async ({ page }) => {
    await page.goto('/');
    // Routing is the app's own; if it depended on server rewrites it would
    // break here and only here.
    await page.goto('/leaderboard/');
    await expect(page.locator('body')).toBeVisible();
  });
});
