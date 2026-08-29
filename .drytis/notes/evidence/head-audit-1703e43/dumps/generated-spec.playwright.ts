import { test, expect } from '@playwright/test';

test.describe('Recorded Test', () => {
  test('should complete recorded Test successfully', async ({ page }) => {
    // Fill "headphones" in the Search products
    await page.locator('#q').fill('headphones')
    await expect.soft(page.locator('#results > *')).toHaveCount(3)
    await expect.soft(page.locator('#results')).toBeAttached()

    // Click the Go
    await page.locator('#go').click()
    await expect.soft(page.locator('#results > *')).toHaveCount(3)
    await expect.soft(page.locator('#results')).toBeAttached()

    // Navigate to http://127.0.0.1:8121/cart
    await page.goto('http://127.0.0.1:8121/cart')
    await expect.soft(page.locator('#cart-count')).toContainText('0 items')

    // Click the Add to cart
    await page.locator('#add1').click()
    await expect.soft(page.locator('#cart-count')).toContainText('2 items')
    await expect.soft(page.locator('#cart-items > *')).toHaveCount(2)
  });
});
