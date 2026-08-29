import { test, expect } from '@playwright/test';

test.describe('Recorded Test', () => {
  test('should complete recorded Test successfully', async ({ page }) => {
    // NOTE: No assertions generated — assertion derivation is not available. This test replays actions only.

    // Fill "invoice" in the Keyword
    await page.locator('#q').fill('invoice')

    // Select "Low" from the Priority
    await page.locator('#prio').selectOption('Low')

    // Click the Search
    await page.locator('#btn-search').click()
  });
});
