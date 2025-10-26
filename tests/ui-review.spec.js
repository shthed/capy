import { test, expect } from '@playwright/test';

const BASE_URL = 'index.html';

test.describe('Capy UI smoke check', () => {
  test('loads the site in Chromium', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveTitle('Image to Color-by-Number');
  });
});
