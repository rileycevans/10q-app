import { test, expect } from '@playwright/test';

test.describe('Home Page', () => {
  test('should load home page', async ({ page }) => {
    await page.goto('/');
    
    // Check for main heading or key element
    await expect(page).toHaveTitle(/10Q/i);
  });

  test('should have play button', async ({ page }) => {
    await page.goto('/');
    
    // Look for play button (could be "PLAY NOW" or similar)
    const playButton = page.getByRole('button', { name: /play/i });
    await expect(playButton).toBeVisible();
  });
});

