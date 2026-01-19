import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('should show sign in button when not authenticated', async ({ page }) => {
    await page.goto('/');
    
    // Look for sign in button
    const signInButton = page.getByRole('button', { name: /sign in/i });
    await expect(signInButton).toBeVisible();
  });

  test('should allow anonymous sign in', async ({ page }) => {
    await page.goto('/');
    
    // Click anonymous sign in
    const signInButton = page.getByRole('button', { name: /sign in.*anonymous/i });
    await signInButton.click();
    
    // Wait for sign out button to appear (indicates successful sign in)
    await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible({ timeout: 10000 });
  });
});

