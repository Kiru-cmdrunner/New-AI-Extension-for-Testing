import { test, expect } from '@playwright/test';

test.describe('Recorded Test', () => {
  test('should complete recorded Test successfully', async ({ page }) => {
    // Fill "invoice" in the Keyword
    await page.locator('#q').fill('invoice')
    await expect.soft(page.locator('#q')).toHaveValue('invoice')

    // Select "High" from the Priority
    await page.locator('#prio').selectOption('High')

    // Click the Search
    await page.locator('#btn-search').click()
    await expect.soft(page.locator('#results > *')).toHaveCount(2)
  });
});
