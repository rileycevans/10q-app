import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('should load home page without errors', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/10Q/i);
  });
});
