import { test, expect } from '@playwright/test';

test.describe('Home Page', () => {
  test('should load home page', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/10Q/i);
  });

  test('should have play link', async ({ page }) => {
    await page.goto('/');
    const playLink = page.getByRole('link', { name: /play/i });
    await expect(playLink).toBeVisible();
  });
});
