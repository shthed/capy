import { test, expect } from '@playwright/test';

const BASE_URL = '/';

const ALMOST_COMPLETE_SAVE = {
  id: 'fixture-nearly-done',
  title: 'Twilight Twins',
  timestamp: 1_700_000_000_000,
  data: {
    format: 'capy-puzzle@2',
    title: 'Twilight Twins',
    width: 2,
    height: 2,
    backgroundColor: '#0f172a',
    activeColor: 2,
    palette: [
      { id: 1, hex: '#ff6b6b', rgba: [255, 107, 107], name: 'Sunset Rose' },
      { id: 2, hex: '#4ecdc4', rgba: [78, 205, 196], name: 'Lagoon' },
      { id: 3, hex: '#ffe66d', rgba: [255, 230, 109], name: 'Sunbeam' },
      { id: 4, hex: '#1a535c', rgba: [26, 83, 92], name: 'Deep Sea' },
    ],
    regions: [
      { id: 1, colorId: 1, pixelCount: 1, cx: 0, cy: 0, pixels: [0] },
      { id: 2, colorId: 2, pixelCount: 1, cx: 1, cy: 0, pixels: [1] },
      { id: 3, colorId: 3, pixelCount: 1, cx: 0, cy: 1, pixels: [2] },
      { id: 4, colorId: 4, pixelCount: 1, cx: 1, cy: 1, pixels: [3] },
    ],
    regionMap: [1, 2, 3, 4],
    filled: [1, 3],
    options: {},
    settings: {
      autoAdvance: false,
      animateHints: true,
      hintFadeDuration: 0.65,
      hintIntensity: 0.6,
      difficulty: 'normal',
      uiScale: 1,
      artPrompt: '',
      imageDescription: '',
    },
  },
};

async function waitForPuzzleReady(page) {
  await page.waitForFunction(() => {
    const state = window.capyGenerator?.getState?.();
    return Boolean(state?.puzzle?.regions?.length);
  });
}

async function clickRegionCenter(page, regionId) {
  const target = await page.evaluate((targetRegionId) => {
    const state = window.capyGenerator?.getState?.();
    if (!state?.puzzle) return null;
    const region = state.puzzle.regions.find((entry) => entry.id === targetRegionId);
    if (!region) return null;
    const canvas = document.getElementById('puzzleCanvas');
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const width = state.puzzle.width || 1;
    const scaleX = rect.width / width;
    const scaleY = rect.height / (state.puzzle.height || 1);
    const firstPixel = Array.isArray(region.pixels) && region.pixels.length > 0 ? region.pixels[0] : null;
    if (firstPixel == null) {
      return null;
    }
    const pixelX = firstPixel % width;
    const pixelY = Math.floor(firstPixel / width);
    return {
      x: rect.left + (pixelX + 0.5) * scaleX,
      y: rect.top + (pixelY + 0.5) * scaleY,
    };
  }, regionId);

  if (!target) {
    throw new Error(`Unable to resolve click target for region ${regionId}`);
  }

  await page.mouse.click(target.x, target.y);
}

async function nextUnfilledRegion(page) {
  return page.evaluate(() => {
    const state = window.capyGenerator?.getState?.();
    if (!state?.puzzle) return null;
    for (const region of state.puzzle.regions) {
      if (!state.filled?.has?.(region.id)) {
        return { id: region.id, colorId: region.colorId };
      }
    }
    return null;
  });
}

test.describe('capy colour-by-number', () => {
  test('records loading animation and first paint stroke', async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForPuzzleReady(page);

    // Allow the intro animation to settle for the recording.
    await page.waitForTimeout(500);

    const region = await nextUnfilledRegion(page);
    expect(region).not.toBeNull();

    const swatch = page.locator(`[data-testid="palette-swatch"][data-color-id="${region.colorId}"]`);
    await swatch.click();

    await clickRegionCenter(page, region.id);

    await page.waitForFunction((regionId) => {
      const state = window.capyGenerator?.getState?.();
      return state?.filled?.has?.(regionId);
    }, region.id);

    // Hold the final frame momentarily for the captured animation.
    await page.waitForTimeout(300);
  });

  test('loads an almost-complete save and finishes the puzzle', async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForPuzzleReady(page);

    await page.waitForFunction(() => Boolean(window.capyGameSaveManager?.persist));
    await page.evaluate((entry) => {
      window.capyGameSaveManager.persist([entry]);
    }, ALMOST_COMPLETE_SAVE);

    const savesButton = page.getByTestId('save-manager-button');
    await savesButton.click();

    const saveManagerSheet = page.locator('#saveManagerSheet');
    await expect(saveManagerSheet).toBeVisible();

    const saveEntry = saveManagerSheet.locator('[data-save-id="fixture-nearly-done"]');
    await expect(saveEntry).toBeVisible();

    await saveEntry.getByRole('button', { name: 'Load' }).click();

    await page.waitForFunction((saveId) => {
      const state = window.capyGenerator?.getState?.();
      return state?.loadedSaveId === saveId;
    }, ALMOST_COMPLETE_SAVE.id);

    await saveManagerSheet.getByRole('button', { name: 'Close' }).click();
    await expect(saveManagerSheet).toBeHidden();

    // Paint the remaining regions.
    while (true) {
      const region = await nextUnfilledRegion(page);
      if (!region) {
        break;
      }
      const swatch = page.locator(`[data-testid="palette-swatch"][data-color-id="${region.colorId}"]`);
      await swatch.click();
      await clickRegionCenter(page, region.id);
      await page.waitForFunction((regionId) => {
        const state = window.capyGenerator?.getState?.();
        return state?.filled?.has?.(regionId);
      }, region.id);
    }

    await page.waitForFunction(() => {
      const state = window.capyGenerator?.getState?.();
      if (!state?.puzzle) return false;
      return state.filled?.size === state.puzzle.regions.length;
    });

    await expect(page.locator('[data-testid="palette-swatch"]')).toHaveCount(0);
  });
});
