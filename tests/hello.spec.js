const { test, expect } = require('@playwright/test');
const nodePath = require('path');
const { pathToFileURL } = require('url');

const appUrl = pathToFileURL(nodePath.join(__dirname, '..', 'index.html')).href;

async function waitForAppReady(page) {
  await page.goto(appUrl);
  await page.waitForSelector('header span[aria-live="polite"]', { state: 'visible' });
  await page.waitForLoadState('networkidle');
}

test.describe('Capybooper app smoke tests', () => {
  test.beforeEach(async ({ page }) => {
    await waitForAppReady(page);
  });

  test('renders the application shell', async ({ page }) => {
    await expect(page).toHaveTitle('Color-by-Number Demo');
    await expect(page.locator('header')).toBeVisible();
    await expect(page.locator('#artframe svg')).toBeVisible();
  });

  test('shows artwork and palette elements', async ({ page }) => {
    const cellPaths = page.locator('svg path[data-cell-id]');
    await cellPaths.first().waitFor();
    const cellCount = await cellPaths.count();
    expect(cellCount).toBeGreaterThan(20);

    const paletteButtons = page.locator('footer button');
    await expect(paletteButtons).toHaveCount(7);
    await expect(paletteButtons.first()).toContainText('Cells');
  });

  test('fills a cell and updates progress', async ({ page }) => {
    const progressLabel = page.locator('header span[aria-live="polite"]');
    await expect(progressLabel).toHaveText(/Progress: 0%/);

    const targetCell = page.locator('path[data-color-id="1"][data-cell-id]').first();
    await targetCell.waitFor({ state: 'visible' });
    await targetCell.click({ force: true });

    await page.waitForFunction(() => {
      const span = document.querySelector('header span[aria-live="polite"]');
      if (!span) return false;
      const match = span.textContent.match(/Progress: (\d+)%/);
      return match ? Number(match[1]) > 0 : false;
    });

    await expect(progressLabel).not.toHaveText(/Progress: 0%/);
  });
});
