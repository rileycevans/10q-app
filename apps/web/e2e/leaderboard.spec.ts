import { test, expect } from '@playwright/test';

test.describe('Leaderboard', () => {
  test('should load leaderboard page', async ({ page }) => {
    await page.goto('/leaderboard');
    
    // Check for leaderboard heading
    const heading = page.getByRole('heading', { name: /leaderboard/i });
    await expect(heading).toBeVisible();
  });

  test('should have time window controls', async ({ page }) => {
    await page.goto('/leaderboard');
    
    // Check for time window buttons
    const todayButton = page.getByRole('button', { name: /today/i });
    await expect(todayButton).toBeVisible();
  });
});

