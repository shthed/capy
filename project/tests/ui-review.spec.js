import { test, expect } from '@playwright/test';
import {
  clearStorage,
  fillRegion,
  getActiveRenderer,
  getFilledCount,
  getPerformanceMetrics,
  loadTestPuzzle,
  resetPerformanceMetrics,
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

  test('toggles the settings sheet visibility immediately', async ({ page }) => {
    const settingsSheet = page.locator('#settingsSheet');
    const settingsButton = page.getByTestId('settings-button');

    await expect(settingsSheet).toHaveAttribute('aria-hidden', 'true');
    await expect(settingsSheet).toHaveClass(/hidden/);

    await settingsButton.click();

    await expect(settingsSheet).toBeVisible();
    await expect(settingsSheet).toHaveAttribute('aria-hidden', 'false');

    await settingsButton.click();

    await expect(settingsSheet).not.toBeVisible();
    await expect(settingsSheet).toHaveAttribute('aria-hidden', 'true');
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

  test('records performance metrics around puzzle interactions', async ({ page }) => {
    await loadTestPuzzle(page);

    const bootSnapshot = await getPerformanceMetrics(page);
    expect(bootSnapshot?.durations?.['app:boot']?.count ?? 0).toBeGreaterThan(0);
    expect(bootSnapshot?.durations?.['puzzle:hydrate']?.count ?? 0).toBeGreaterThan(0);

    await resetPerformanceMetrics(page);
    await loadTestPuzzle(page);

    await fillRegion(page, TEST_REGION_IDS.sunlitBloom[0]);
    await fillRegion(page, TEST_REGION_IDS.sunlitBloom[1]);

    const metrics = await getPerformanceMetrics(page);
    expect(metrics).not.toBeNull();

    const durations = metrics?.durations ?? {};
    expect(durations['puzzle:hydrate']?.count ?? 0).toBeGreaterThan(0);
    expect(durations['render:frame']?.count ?? 0).toBeGreaterThan(0);
    expect(durations['interaction:fill']?.count ?? 0).toBeGreaterThan(0);

    const fillStats = durations['interaction:fill'];
    expect(fillStats?.last?.metadata?.regionId).toBe(TEST_REGION_IDS.sunlitBloom[1]);
    expect(fillStats?.last?.metadata?.result).toBe('filled');
    expect(fillStats?.last?.metadata?.filledCount ?? 0).toBeGreaterThan(0);
  });
});
