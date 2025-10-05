const { test, expect } = require('@playwright/test');

const APP_URL = 'http://127.0.0.1:8000/index.html';

const BASIC_TEST_PATTERN = {
  name: 'Basic test pattern',
  width: 4,
  height: 4,
  palette: [
    { id: 1, hex: '#e11d48', rgba: [225, 29, 72] },
    { id: 2, hex: '#22c55e', rgba: [34, 197, 94] },
  ],
  regions: [
    { id: 0, colorId: 1, pixels: [0, 1, 4, 5], pixelCount: 4, cx: 0.5, cy: 0.5 },
    { id: 1, colorId: 2, pixels: [2, 3, 6, 7], pixelCount: 4, cx: 2.5, cy: 0.5 },
    { id: 2, colorId: 1, pixels: [8, 9, 12, 13], pixelCount: 4, cx: 0.5, cy: 2.5 },
    { id: 3, colorId: 2, pixels: [10, 11, 14, 15], pixelCount: 4, cx: 2.5, cy: 2.5 },
  ],
  regionMap: [
    0, 0, 1, 1,
    0, 0, 1, 1,
    2, 2, 3, 3,
    2, 2, 3, 3,
  ],
};

async function loadBasicTestPattern(page) {
  await page.evaluate((puzzle) => {
    window.capyGenerator.loadPuzzleFixture(puzzle);
  }, BASIC_TEST_PATTERN);
  await page.waitForSelector('[data-testid="palette-swatch"]');
  await expect(page.locator('[data-testid="start-hint"]')).toHaveClass(/hidden/);
}

async function clickRegionCenter(page, region, puzzle) {
  expect(region.pixels.length).toBeGreaterThan(0);
  const sample = region.pixels[0];
  await page.evaluate(({ pixel, width, height }) => {
    const canvas = document.querySelector('[data-testid="puzzle-canvas"]');
    if (!canvas) return;
    const state = window.capyGenerator.getState();
    if (!state.puzzle) return;
    const pixelX = pixel % width;
    const pixelY = Math.floor(pixel / width);
    const rect = canvas.getBoundingClientRect();
    const clientX = rect.left + ((pixelX + 0.5) / width) * rect.width;
    const clientY = rect.top + ((pixelY + 0.5) / height) * rect.height;
    const event = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
    });
    canvas.dispatchEvent(event);
  }, { pixel: sample, width: puzzle.width, height: puzzle.height });
}

test.describe('Capy image generator', () => {
  test('renders command rail and hidden generator settings on load', async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="start-hint"]');

    const layout = await page.evaluate(() => {
      const progress = document.querySelector('[data-testid="progress-message"]');
      const commandButtons = Array.from(document.querySelectorAll('#commandRail button')).map(
        (el) => el.getAttribute('aria-label') || el.getAttribute('title') || (el.textContent || '').trim()
      );
      const hasSettings = Boolean(document.querySelector('#settingsSheet'));
      const hasSampleButton = Boolean(document.querySelector('[data-testid="sample-art-button"]'));
      return {
        progress: (progress?.textContent || '').trim(),
        commandButtons,
        hasSettings,
        hasSampleButton,
      };
    });

    expect(layout.hasSettings).toBe(true);
    expect(layout.progress).toBe('—');
    expect(layout.hasSampleButton).toBe(true);
    expect(layout.commandButtons).toEqual(
      expect.arrayContaining(['Hint', 'Reset puzzle', 'Show preview', 'Import', 'Save manager', 'Settings'])
    );

    await page.click('#settingsButton');
    const generatorLabels = await page.$$eval(
      '#settingsSheet label span:first-child',
      (nodes) => nodes.map((el) => (el.textContent || '').trim())
    );
    expect(generatorLabels.some((label) => label.includes('Colours'))).toBe(true);
    expect(generatorLabels.some((label) => label.includes('Sample rate'))).toBe(true);
    await page.click('[data-sheet-close="settings"]');
  });

  test('loads the capybara sample scene', async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="sample-art-button"]');
    await page.click('[data-testid="sample-art-button"]');
    await expect(page.locator('[data-testid="start-hint"]')).toHaveClass(/hidden/);
    await page.waitForSelector('[data-testid="palette-swatch"]');

    const progress = page.locator('[data-testid="progress-message"]');
    await expect(progress).toHaveText(/0\/\d+/);

    const state = await page.evaluate(() => {
      const { puzzle, sourceUrl } = window.capyGenerator.getState();
      return {
        hasPuzzle: Boolean(puzzle),
        regionCount: puzzle?.regions?.length || 0,
        paletteCount: puzzle?.palette?.length || 0,
        sourceUrl,
      };
    });

    expect(state.hasPuzzle).toBe(true);
    expect(state.paletteCount).toBeGreaterThan(3);
    expect(state.regionCount).toBeGreaterThan(4);
    expect(state.sourceUrl).toContain('data:image/svg+xml;base64,');
  });

  test('fills the basic test pattern to completion', async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await loadBasicTestPattern(page);

    const palette = page.locator('[data-testid="palette-swatch"]');
    await expect(palette).toHaveCount(BASIC_TEST_PATTERN.palette.length);
    await page.click('#settingsButton');
    await expect(page.locator('#downloadJson')).toBeEnabled();
    await page.click('[data-sheet-close="settings"]');
    await expect(page.locator('#resetButton')).toBeEnabled();

    const progress = page.locator('[data-testid="progress-message"]');
    await expect(progress).toHaveText(`0/${BASIC_TEST_PATTERN.regions.length}`);

    for (let index = 0; index < BASIC_TEST_PATTERN.regions.length; index += 1) {
      const region = BASIC_TEST_PATTERN.regions[index];
      await page.click(`[data-color-id="${region.colorId}"]`);
      await clickRegionCenter(page, region, BASIC_TEST_PATTERN);

      await expect
        .poll(async () =>
          page.evaluate(() => window.capyGenerator.getState().filled.size)
        )
        .toBe(index + 1);

      await expect(progress).toHaveText(`${index + 1}/${BASIC_TEST_PATTERN.regions.length}`);
    }

    await page.click('#resetButton');
    await expect(progress).toHaveText(`0/${BASIC_TEST_PATTERN.regions.length}`);
  });
});
