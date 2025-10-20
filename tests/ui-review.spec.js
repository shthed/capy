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

async function readGeneratorState(page) {
  return page.evaluate(() => window.capyGenerator?.getState?.() ?? null);
}

async function waitForPuzzleReady(page) {
  await page.waitForFunction(() => {
    const state = window.capyGenerator?.getState?.();
    return Boolean(state?.puzzle?.regions?.length);
  });
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

async function fillRegion(page, regionId, options = {}) {
  const status = await page.evaluate((payload) => {
    const generator = window.capyGenerator;
    if (!generator?.fillRegion) {
      return 'missing-helper';
    }
    return generator.fillRegion(payload.regionId, payload.options);
  }, { regionId, options });

  if (status !== 'filled') {
    throw new Error(`Unable to fill region ${regionId}; received status: ${status}`);
  }
}

test.describe('Capy UI review', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await expect(page.getByTestId('puzzle-canvas')).toBeVisible();
    await waitForPuzzleReady(page);

    await expect
      .poll(async () =>
        page.evaluate(() => {
          const state = window.capyGenerator?.getState?.();
          if (!state?.puzzle) {
            return null;
          }
          const paletteCount = Array.isArray(state.puzzle.palette)
            ? state.puzzle.palette.length
            : 0;
          const regionCount = Array.isArray(state.puzzle.regions)
            ? state.puzzle.regions.length
            : 0;
          if (paletteCount === 0 || regionCount === 0) {
            return null;
          }
          return {
            paletteCount,
            regionCount,
          };
        })
      )
      .not.toBeNull();
  });

  test('command rail buttons enable once the default puzzle loads', async ({ page }) => {
    const commandButtons = [
      'preview-toggle',
      'generator-button',
      'settings-button',
      'import-button',
      'save-manager-button',
      'help-button',
    ];

    for (const testId of commandButtons) {
      await expect(page.getByTestId(testId)).toBeEnabled();
    }
  });

  test('preview toggle updates the rendered preview state', async ({ page }) => {
    const previewToggle = page.getByTestId('preview-toggle');
    await expect(previewToggle).toBeEnabled();

    const initialState = await readGeneratorState(page);
    expect(initialState?.previewVisible).toBeFalsy();

    await previewToggle.click();
    await expect
      .poll(async () => page.evaluate(() => window.capyGenerator?.getState?.()?.previewVisible ?? false))
      .toBe(true);

    await previewToggle.click();
    await expect
      .poll(async () => page.evaluate(() => window.capyGenerator?.getState?.()?.previewVisible ?? true))
      .toBe(false);
  });

  test('generator presets adjust the sample detail level', async ({ page }) => {
    const generatorButton = page.getByTestId('generator-button');
    await generatorButton.click();

    const generatorSheet = page.locator('#generatorSheet');
    await expect(generatorSheet).toBeVisible();

    const mediumPreset = generatorSheet.locator('[data-detail-level="medium"]');
    const highPreset = generatorSheet.locator('[data-detail-level="high"]');

    await mediumPreset.click();
    await expect
      .poll(async () =>
        page.evaluate(() => window.capyGenerator?.getState?.()?.sampleDetailLevel ?? ''))
      .toBe('medium');

    await highPreset.click();
    await expect
      .poll(async () =>
        page.evaluate(() => window.capyGenerator?.getState?.()?.sampleDetailLevel ?? ''))
      .toBe('high');
  });

  test('selecting palette swatches updates the active color', async ({ page }) => {
    const paletteDock = page.getByTestId('palette-dock');
    const swatches = paletteDock.locator('[data-testid="palette-swatch"]');

    const swatchCount = await swatches.count();
    expect(swatchCount).toBeGreaterThan(1);

    const initialActiveColor = await page.evaluate(
      () => window.capyGenerator?.getState?.()?.activeColor ?? null
    );

    let firstIndex = 0;
    let firstColorId = initialActiveColor;
    for (let index = 0; index < swatchCount; index += 1) {
      const rawId = await swatches.nth(index).getAttribute('data-color-id');
      const parsedId = rawId != null ? Number(rawId) : NaN;
      if (Number.isFinite(parsedId) && parsedId !== initialActiveColor) {
        firstIndex = index;
        firstColorId = parsedId;
        break;
      }
    }

    if (firstColorId === initialActiveColor || firstColorId == null) {
      throw new Error('Expected to find a palette colour different from the initial active colour.');
    }

    await swatches.nth(firstIndex).click();
    await expect
      .poll(async () => page.evaluate(() => window.capyGenerator?.getState?.()?.activeColor ?? null))
      .toBe(firstColorId);

    let secondIndex = (firstIndex + 1) % swatchCount;
    let secondColorId = firstColorId;
    for (let offset = 0; offset < swatchCount; offset += 1) {
      const index = (firstIndex + 1 + offset) % swatchCount;
      const rawId = await swatches.nth(index).getAttribute('data-color-id');
      const parsedId = rawId != null ? Number(rawId) : NaN;
      if (Number.isFinite(parsedId) && parsedId !== firstColorId) {
        secondIndex = index;
        secondColorId = parsedId;
        break;
      }
    }

    if (secondColorId === firstColorId || secondColorId == null) {
      throw new Error('Expected to find a second unique palette colour for selection.');
    }

    await swatches.nth(secondIndex).click();
    await expect
      .poll(async () => page.evaluate(() => window.capyGenerator?.getState?.()?.activeColor ?? null))
      .toBe(secondColorId);
  });
});

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

    await fillRegion(page, region.id, { ensureColor: false, label: 'ui-review-first-stroke' });

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
      await fillRegion(page, region.id, { label: 'ui-review-finish-puzzle' });
    }

    await page.waitForFunction(() => {
      const state = window.capyGenerator?.getState?.();
      if (!state?.puzzle) return false;
      return state.filled?.size === state.puzzle.regions.length;
    });

    await expect(page.locator('[data-testid="palette-swatch"]')).toHaveCount(0);
  });
});
