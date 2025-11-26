import { test, expect } from '@playwright/test';
const BASE_URL = 'index.html';

test.describe('Capy basic UI smoke check', () => {
  test('loads the page and opens settings', async ({ page }) => {
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
  });
});
