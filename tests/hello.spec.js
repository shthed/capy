const { test, expect } = require('@playwright/test');
const nodePath = require('path');
const { pathToFileURL } = require('url');

const appUrl = pathToFileURL(nodePath.join(__dirname, '..', 'index.html')).href;

async function waitForAppReady(page) {
  await page.goto(appUrl);
  await page.waitForSelector('svg path[data-cell-id]', { state: 'visible' });
  await page.waitForLoadState('networkidle');
}

test.describe('Capybooper app smoke tests', () => {
  test.beforeEach(async ({ page }) => {
    await waitForAppReady(page);
  });

  test('renders the application shell', async ({ page }) => {
    await expect(page).toHaveTitle('Color-by-Number Demo');
    await expect(page.locator('svg')).toBeVisible();
    await expect(page.locator('[data-testid="palette-dock"]')).toBeVisible();
  });

  test('shows artwork and palette elements', async ({ page }) => {
    const cellPaths = page.locator('svg path[data-cell-id]');
    expect(await cellPaths.count()).toBeGreaterThan(20);

    const paletteButtons = page.locator('[data-testid="palette-dock"] button');
    await expect(paletteButtons).toHaveCount(11);
    await expect(paletteButtons.first()).toHaveText('1');
  });

  test('fills a cell and updates progress', async ({ page }) => {
    const progressBadge = page.locator('[data-testid="progress-indicator"]');
    await progressBadge.waitFor();
    await expect(progressBadge).toHaveText('0%');

    const paletteButtons = page.locator('[data-testid="palette-dock"] button');
    await paletteButtons.first().click();

    const targetCell = page.locator('path[data-cell-id="c1"]');
    await targetCell.click({ force: true });

    await expect(progressBadge).not.toHaveText('0%');
  });
});
