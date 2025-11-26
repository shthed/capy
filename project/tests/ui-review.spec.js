import { test, expect } from '@playwright/test';
const BASE_URL = 'index.html';

test.describe('Capy basic UI smoke check', () => {
  test('loads the page and opens settings', async ({ page }) => {
    const consoleErrors = [];
    const pageErrors = [];

    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });

    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

    const settingsButton = page.getByTestId('settings-button');
    await expect(settingsButton).toBeVisible();

    const settingsSheet = page.locator('#settingsSheet');
    await expect(settingsSheet).toHaveAttribute('aria-hidden', 'true');

    await page.evaluate(() => {
      if (window.capySettingsBootstrap?.setOpen) {
        window.capySettingsBootstrap.setOpen(true);
      }
    });

    await expect(settingsSheet).toBeVisible();
    await expect(settingsSheet).toHaveAttribute('aria-hidden', 'false');

    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });
});
