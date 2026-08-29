import { test, expect } from '@playwright/test';

test.describe('Recorded Test', () => {
  test('should complete recorded Test successfully', async ({ page }) => {
    // Select Sat, 22 Aug in the Choose a date
    await page.getByLabel('Choose a date').fill('Sat, 22 Aug')

    // Fill "Bengaluru" in the Type a city
    await page.getByLabel('Type a city').fill('Bengaluru')

    // Click the Plan trip
    await page.getByLabel('Plan trip').click()
    await expect.soft(page.locator('#app')).toContainText('Planningâ€¦')
  });
});
