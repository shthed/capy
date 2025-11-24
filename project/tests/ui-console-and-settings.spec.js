import { test, expect } from '@playwright/test';
import { clearStorage } from './utils/fixtures.js';

const BASE_URL = 'index.html';

test.describe('Startup console and settings persistence', () => {
  test('loads cleanly and reloads theme settings', async ({ page }) => {
    const consoleEvents = [];

    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleEvents.push({ type: 'console', text: message.text() });
      }
    });
    page.on('pageerror', (error) => {
      consoleEvents.push({ type: 'pageerror', text: error.message });
    });

    await page.route('https://shthed.github.io/capy/README', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><title>README</title><p>Stub README for tests.</p>',
      })
    );

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await clearStorage(page);
    consoleEvents.length = 0;

    await page.reload({ waitUntil: 'networkidle' });

    await expect(consoleEvents).toEqual([]);

    const settingsButton = page.getByTestId('settings-button');
    await settingsButton.click();

    const themeSelect = page.locator('#uiTheme');
    await expect(themeSelect).toBeVisible();
    await themeSelect.selectOption('light');
    await expect(themeSelect).toHaveValue('light');

    await page.reload({ waitUntil: 'networkidle' });

    await expect(themeSelect).toHaveValue('light');
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'light');
    await expect(consoleEvents).toEqual([]);

    await clearStorage(page);
  });
});
