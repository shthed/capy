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

    const gameplayPanel = page.locator('[data-settings-panel="gameplay"]');
    const inactivePanels = page.locator('[data-settings-panel]:not([data-settings-panel="gameplay"])');

    await expect(gameplayPanel).toBeVisible();
    await expect(gameplayPanel).toHaveJSProperty('hidden', false);

    const inactiveCount = await inactivePanels.count();
    for (let index = 0; index < inactiveCount; index += 1) {
      const panel = inactivePanels.nth(index);
      await expect(panel).toBeHidden();
      await expect(panel).toHaveJSProperty('hidden', true);
    }

    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });
});
