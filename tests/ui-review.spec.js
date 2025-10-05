const { test, expect } = require('@playwright/test');

const APP_URL = 'http://127.0.0.1:8000/index.html';

const FIXTURE_PUZZLE = {
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

async function loadFixturePuzzle(page) {
  await page.evaluate((puzzle) => {
    window.capyGenerator.loadPuzzleFixture(puzzle);
  }, FIXTURE_PUZZLE);
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
      const status = document.querySelector('[data-testid="status-bar"]');
      const progress = document.querySelector('[data-testid="progress-message"]');
      const commandButtons = Array.from(
        document.querySelectorAll('#commandRail button')
      ).map((el) => (el.textContent || '').trim());
      const hasSettings = Boolean(document.querySelector('#settingsSheet'));
      return {
        status: (status?.textContent || '').trim(),
        progress: (progress?.textContent || '').trim(),
        commandButtons,
        hasSettings,
      };
    });

    expect(layout.hasSettings).toBe(true);
    expect(layout.status).toContain('Drop an image');
    expect(layout.progress).toContain('Drop an image');
    expect(layout.commandButtons.length).toBeGreaterThanOrEqual(5);

    await page.click('#settingsButton');
    const generatorLabels = await page.$$eval(
      '#settingsSheet label span:first-child',
      (nodes) => nodes.map((el) => (el.textContent || '').trim())
    );
    expect(generatorLabels.some((label) => label.includes('Colours'))).toBe(true);
    expect(generatorLabels.some((label) => label.includes('Sample rate'))).toBe(true);
    await page.click('[data-sheet-close="settings"]');
  });

  test('lets players fill a puzzle to completion', async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await loadFixturePuzzle(page);

    const palette = page.locator('[data-testid="palette-swatch"]');
    await expect(palette).toHaveCount(2);
    await page.click('#settingsButton');
    await expect(page.locator('#downloadJson')).toBeEnabled();
    await page.click('[data-sheet-close="settings"]');
    await expect(page.locator('#resetButton')).toBeEnabled();

    const progress = page.locator('[data-testid="progress-message"]');
    await expect(progress).toHaveText(`Filled 0 of ${FIXTURE_PUZZLE.regions.length} regions.`);

    for (let index = 0; index < FIXTURE_PUZZLE.regions.length; index += 1) {
      const region = FIXTURE_PUZZLE.regions[index];
      await page.click(`[data-color-id="${region.colorId}"]`);
      await clickRegionCenter(page, region, FIXTURE_PUZZLE);

      await expect
        .poll(async () =>
          page.evaluate(() => window.capyGenerator.getState().filled.size)
        )
        .toBe(index + 1);

      if (index + 1 < FIXTURE_PUZZLE.regions.length) {
        await expect(progress).toHaveText(
          `Filled ${index + 1} of ${FIXTURE_PUZZLE.regions.length} regions.`
        );
      } else {
        await expect(progress).toHaveText(
          'Puzzle complete! Download the data or try another image.'
        );
      }
    }

    await page.click('#resetButton');
    await expect(progress).toHaveText(`Filled 0 of ${FIXTURE_PUZZLE.regions.length} regions.`);
  });
});
