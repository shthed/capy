import { test, expect } from '@playwright/test';

const BASE_URL = 'index.html';

async function waitForPuzzleReady(page) {
  await page.waitForFunction(() => {
    const state = window.capyGenerator?.getState?.();
    return Boolean(state?.puzzle?.regions?.length);
  });
}

test.describe('Capy UI smoke check', () => {
  test('loads the default puzzle', async ({ page }) => {
    await page.goto(BASE_URL);

    const puzzleCanvas = page.getByTestId('puzzle-canvas');
    await expect(puzzleCanvas).toBeVisible();

    await waitForPuzzleReady(page);

    const regionCount = await page.evaluate(
      () => window.capyGenerator?.getState?.()?.puzzle?.regions?.length ?? 0
    );
    expect(regionCount).toBeGreaterThan(0);
  });
});
