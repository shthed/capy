import { test, expect } from '@playwright/test';

test('loads the app page without runtime or console errors', async ({ page }) => {
  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('pageerror', (error) => {
    pageErrors.push(error.stack || error.message);
  });

  await page.goto('index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
