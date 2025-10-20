import { test, expect } from '@playwright/test';

async function readGeneratorState(page) {
  return page.evaluate(() => window.capyGenerator?.getState?.() ?? null);
}

test.describe('Capy UI review', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('puzzle-canvas')).toBeVisible();

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
