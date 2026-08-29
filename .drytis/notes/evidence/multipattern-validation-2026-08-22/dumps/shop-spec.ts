import { test, expect } from '@playwright/test';

test.describe('Recorded Test', () => {
  test('should complete recorded Test successfully', async ({ page }) => {
    // Click the Increase quantity of Notebook
    await page.getByLabel('Increase quantity of Notebook').click()
    await expect.soft(page.locator('[aria-label="Cart items"]')).toContainText('3')
    await expect.soft(page.locator('[data-sku="SKU-A"]')).toBeAttached()
    await expect.soft(page.locator('[data-sku="SKU-B"]')).toBeAttached()

    // Click the Increase quantity of Notebook
    await page.getByLabel('Increase quantity of Notebook').click()
    await expect.soft(page.locator('[aria-label="Cart items"]')).toContainText('4')
    await expect.soft(page.locator('[data-sku="SKU-A"]')).toBeAttached()
    await expect.soft(page.locator('[data-sku="SKU-B"]')).toBeAttached()

    // Click the Increase quantity of Pen set
    await page.getByLabel('Increase quantity of Pen set').click()
    await expect.soft(page.locator('[aria-label="Cart items"]')).toContainText('5')
    await expect.soft(page.locator('[data-sku="SKU-A"]')).toBeAttached()
    await expect.soft(page.locator('[data-sku="SKU-B"]')).toBeAttached()
  });
});
