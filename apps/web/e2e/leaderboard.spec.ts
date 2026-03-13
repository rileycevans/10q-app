import { test, expect } from '@playwright/test';

test.describe('Leaderboard', () => {
  test('should load leaderboard page', async ({ page }) => {
    await page.goto('/leaderboard');
    const heading = page.getByText(/leaderboard/i);
    await expect(heading).toBeVisible();
  });
});
