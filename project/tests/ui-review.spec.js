import { test, expect } from '@playwright/test';
import {
  clearStorage,
  fillRegion,
  getActiveRenderer,
  getFilledCount,
  loadTestPuzzle,
  TEST_COLOR_IDS,
  TEST_REGION_IDS,
} from './utils/fixtures.js';

const BASE_URL = 'index.html';

test.describe('Capy UI smoke check', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await clearStorage(page);
  });

  test('loads the site in Chromium', async ({ page }) => {
    await expect(page).toHaveTitle('Image to Color-by-Number');
  });

  test('allows switching renderer modes', async ({ page }) => {
    await loadTestPuzzle(page);
    await expect.poll(() => getActiveRenderer(page)).toBe('canvas2d');

    await page.getByTestId('settings-button').click();
    await page.locator('[data-settings-tab="appearance"]').click();

    const rendererSelect = page.locator('#rendererMode');
    await expect(rendererSelect).toBeVisible();

    await rendererSelect.selectOption('svg');
    await expect.poll(() => getActiveRenderer(page)).toBe('svg');
    await expect(page.locator('#canvasStage')).toHaveAttribute('data-renderer', 'svg');

    await rendererSelect.selectOption('canvas2d');
    await expect.poll(() => getActiveRenderer(page)).toBe('canvas2d');
    await expect(page.locator('#canvasStage')).toHaveAttribute('data-renderer', 'canvas2d');
  });

  test('updates palette selection feedback after painting', async ({ page }) => {
    await loadTestPuzzle(page);

    const paletteSwatches = page.locator('[data-testid="palette-swatch"]');
    await expect(paletteSwatches).toHaveCount(3);

    const lagoonSwatch = page.locator(
      `[data-testid="palette-swatch"][data-color-id="${TEST_COLOR_IDS.coolLagoon}"]`
    );
    await lagoonSwatch.click();
    await expect(lagoonSwatch).toHaveClass(/active/);
    await expect(lagoonSwatch).toHaveAttribute('data-remaining', '2');
    await expect(lagoonSwatch.locator('.swatch-tooltip')).toHaveText('2 regions left');

    await fillRegion(page, TEST_REGION_IDS.coolLagoon[0]);
    await expect.poll(() => getFilledCount(page)).toBe(1);

    const lagoonAfterFill = page.locator(
      `[data-testid="palette-swatch"][data-color-id="${TEST_COLOR_IDS.coolLagoon}"]`
    );
    await expect(lagoonAfterFill).toHaveAttribute('data-remaining', '1');
    await expect(lagoonAfterFill.locator('.swatch-tooltip')).toHaveText('1 region left');
    await expect(lagoonAfterFill).toHaveClass(/active/);
  });

  test('saves and restores puzzle progress', async ({ page }) => {
    await loadTestPuzzle(page);

    await fillRegion(page, TEST_REGION_IDS.warmClay[0]);
    const filledBeforeSave = await getFilledCount(page);
    await expect(filledBeforeSave).toBeGreaterThan(0);

    await page.getByTestId('settings-button').click();
    await page.locator('[data-settings-tab="saves"]').click();

    const saveButton = page.locator('[data-save-snapshot]');
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    const saveEntry = page.locator('[data-save-list] .save-entry').first();
    await expect(saveEntry).toBeVisible();
    const saveId = await saveEntry.getAttribute('data-save-id');
    await expect(saveId).not.toBeNull();

    await fillRegion(page, TEST_REGION_IDS.warmClay[1]);
    await expect.poll(() => getFilledCount(page)).toBeGreaterThan(filledBeforeSave);

    await saveEntry.locator('[data-action="load"]').click();
    await expect.poll(() => getFilledCount(page)).toBe(filledBeforeSave);
    await expect(saveEntry).toHaveAttribute('data-loaded', 'true');
  });
});
