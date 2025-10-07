const { test, expect } = require('@playwright/test');

const APP_URL = 'http://127.0.0.1:8000/index.html';

test.describe('Capy smoke tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  });

  test('shows the palette and hides the onboarding hint after load', async ({ page }) => {
    await page.waitForSelector('[data-testid="palette-swatch"]');
    await expect(page.locator('[data-testid="start-hint"]')).toHaveClass(/hidden/);

    const state = await page.evaluate(() => {
      const generator = window.capyGenerator?.getState?.();
      return {
        hasPuzzle: Boolean(generator?.puzzle),
        paletteCount: generator?.puzzle?.palette?.length ?? 0,
      };
    });

    expect(state.hasPuzzle).toBe(true);
    expect(state.paletteCount).toBeGreaterThan(0);
  });

  test('opens and closes the help and settings sheets', async ({ page }) => {
    await page.click('#helpButton');
    const helpSheet = page.locator('#helpSheet');
    await expect(helpSheet).toBeVisible();
    await page.click('[data-sheet-close="help"]');
    await expect(helpSheet).toHaveClass(/hidden/);

    await page.click('#settingsButton');
    const settingsSheet = page.locator('#settingsSheet');
    await expect(settingsSheet).toBeVisible();
    await page.click('[data-sheet-close="settings"]');
    await expect(settingsSheet).toHaveClass(/hidden/);
  });
});
