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

async function getStageFlashValue(page) {
  return page.evaluate(() => {
    const stage = document.querySelector('#canvasStage');
    return stage?.dataset.flashingColor || null;
  });
}

test.describe('Capy image generator', () => {
  test('renders command rail and hidden generator settings on load', async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="palette-swatch"]');
    await expect(page.locator('[data-testid="start-hint"]')).toHaveClass(/hidden/);

    const layout = await page.evaluate(() => {
      const progress = document.querySelector('[data-testid="progress-message"]');
      const commandButtons = Array.from(document.querySelectorAll('#commandRail button')).map(
        (el) => el.getAttribute('aria-label') || el.getAttribute('title') || (el.textContent || '').trim()
      );
      const hasSettings = Boolean(document.querySelector('#settingsSheet'));
      const hasSampleButton = Boolean(document.querySelector('[data-testid="sample-art-button"]'));
      const viewportMeta = document
        .querySelector('meta[name="viewport"]')
        ?.getAttribute('content');
      const zoomGuardActive =
        typeof window.capyGenerator?.isBrowserZoomSuppressed === 'function' &&
        window.capyGenerator.isBrowserZoomSuppressed();
      return {
        progress: (progress?.textContent || '').trim(),
        commandButtons,
        hasSettings,
        hasSampleButton,
        orientation: document.body?.dataset.orientation || null,
        viewportMeta,
        zoomGuardActive,
      };
    });

    expect(layout.hasSettings).toBe(true);
    expect(layout.progress).toMatch(/^0\/\d+/);
    expect(layout.hasSampleButton).toBe(true);
    expect(layout.orientation).toMatch(/landscape|portrait/);
    expect(layout.viewportMeta || '').toMatch(/user-scalable=no/);
    expect(layout.zoomGuardActive).toBe(true);
    expect(layout.commandButtons).toEqual(
      expect.arrayContaining([
        'Hint',
        'Reset puzzle',
        'Show preview',
        expect.stringContaining('Reload Capybara Springs'),
        'Enter fullscreen',
        'Import',
        'Save manager',
        'Help & shortcuts',
        'Settings',
      ])
    );

    await expect(page.locator('#detailCycleButton')).toBeVisible();
    const detailAria = await page.locator('#detailCycleButton').getAttribute('aria-label');
    expect(detailAria || '').toMatch(/Next:/);

    const paletteToggle = page.locator('#toggleCompletedColors');
    await expect(paletteToggle).toBeVisible();
    await expect(paletteToggle).toHaveAttribute('aria-pressed', 'false');
    await expect(paletteToggle).toHaveText(/Hide finished colours/i);

    await expect(page.locator('#activeColorBadge')).toHaveAttribute('data-has-colour', 'true');

    await paletteToggle.click();
    await expect(paletteToggle).toHaveAttribute('aria-pressed', 'true');
    await expect(paletteToggle).toHaveText(/Show all colours/i);
    await paletteToggle.click();
    await expect(paletteToggle).toHaveAttribute('aria-pressed', 'false');
    await expect(paletteToggle).toHaveText(/Hide finished colours/i);

    await page.click('#helpButton');
    await expect(page.locator('#helpSheet')).toBeVisible();

    const helpLegend = await page.$$eval('#helpSheet .command-list dt', (nodes) =>
      nodes.map((node) => (node.textContent || '').trim())
    );
    expect(helpLegend).toEqual(
      expect.arrayContaining(['? Hint', '🖼 Preview', '🐹 Sample', '🎚 Detail', '⛶ Fullscreen', 'ℹ Help', '⚙ Settings'])
    );

    const logMessages = await page.$$eval('#debugLog .log-entry span', (nodes) =>
      nodes.map((el) => (el.textContent || '').trim())
    );
    expect(logMessages.some((message) => message.includes('Session started'))).toBe(true);
    expect(logMessages.some((message) => message.includes('Orientation changed'))).toBe(true);

    await page.click('[data-sheet-close="help"]');

    await page.click('#settingsButton');
    const generatorLabels = await page.$$eval(
      '#settingsSheet label span:first-child',
      (nodes) => nodes.map((el) => (el.textContent || '').trim())
    );
    expect(generatorLabels.some((label) => label.includes('Colours'))).toBe(true);
    expect(generatorLabels.some((label) => label.includes('Sample rate'))).toBe(true);
    expect(generatorLabels.some((label) => label.includes('Background colour'))).toBe(true);
    expect(generatorLabels.some((label) => label.includes('Interface scale'))).toBe(true);
    await expect(page.locator('#hideCompletedToggle')).toBeVisible();

    const artPrompt = page.locator('#artPrompt');
    await expect(artPrompt).toBeHidden();
    await page.click('#generatorAdvanced summary');
    await expect(artPrompt).toBeVisible();
    await page.click('#generatorAdvanced summary');
    await expect(artPrompt).toBeHidden();
    await page.click('[data-sheet-close="settings"]');
  });

  test('auto loads and reloads the capybara sample scene', async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="palette-swatch"]');
    await expect(page.locator('[data-testid="start-hint"]')).toHaveClass(/hidden/);

    const detailButtons = page.locator('[data-detail-level]');
    await expect(detailButtons).toHaveCount(6);
    await expect(page.locator('#startHint [data-detail-level]')).toHaveCount(3);
    await expect(page.locator('#settingsSheet [data-detail-level]')).toHaveCount(3);
    await expect(page.locator('#startHint [data-detail-level="high"]')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(page.locator('#settingsSheet [data-detail-level="high"]')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    const detailCaption = page.locator('[data-detail-caption]').first();
    await expect(detailCaption).toHaveText(/High detail/i);
    const progress = page.locator('[data-testid="progress-message"]');
    await expect(progress).toHaveText(/0\/\d+/);

    const state = await page.evaluate(() => {
      const { puzzle, sourceUrl, sampleDetailLevel, lastOptions } = window.capyGenerator.getState();
      return {
        hasPuzzle: Boolean(puzzle),
        regionCount: puzzle?.regions?.length || 0,
        paletteCount: puzzle?.palette?.length || 0,
        sourceUrl,
        detailLevel: sampleDetailLevel,
        targetColors: lastOptions?.targetColors || null,
      };
    });

    expect(state.hasPuzzle).toBe(true);
    expect(state.paletteCount).toBe(32);
    expect(state.regionCount).toBeGreaterThanOrEqual(120);
    expect(state.regionCount).toBeLessThanOrEqual(190);
    expect(state.sourceUrl).toContain('data:image/svg+xml;base64,');
    expect(state.detailLevel).toBe('high');
    expect(state.targetColors).toBe(32);

    const badgeState = await page.evaluate(() => {
      const badge = document.querySelector('#activeColorBadge');
      return {
        hasColour: badge?.dataset.hasColour || null,
        remaining: badge?.querySelector('[data-active-color-remaining]')?.textContent?.trim() || '',
      };
    });
    expect(badgeState.hasColour).toBe('true');
    expect(badgeState.remaining).toMatch(/regions/);

    await page.click('[data-testid="sample-art-button"]');
    await expect
      .poll(async () => {
        const messages = await page.$$eval('#debugLog .log-entry span', (nodes) =>
          nodes.map((el) => (el.textContent || '').trim())
        );
        return messages.some((message) => /Loading high detail sample puzzle/.test(message));
      })
      .toBe(true);
    await expect
      .poll(async () => {
        const messages = await page.$$eval('#debugLog .log-entry span', (nodes) =>
          nodes.map((el) => (el.textContent || '').trim())
        );
        return messages.some((message) => /High detail sample puzzle ready/.test(message));
      })
      .toBe(true);

    await page.click('#settingsButton');
    await expect(page.locator('#settingsSheet')).toBeVisible();

    await page.click('#settingsSheet [data-detail-level="medium"]');
    await expect.poll(() =>
      page.evaluate(() => window.capyGenerator.getState().sampleDetailLevel)
    ).toBe('medium');
    await expect
      .poll(async () => {
        const messages = await page.$$eval('#debugLog .log-entry span', (nodes) =>
          nodes.map((el) => (el.textContent || '').trim())
        );
        return messages.some((message) => /Loading medium detail sample puzzle/.test(message));
      })
      .toBe(true);
    await expect
      .poll(async () => {
        const messages = await page.$$eval('#debugLog .log-entry span', (nodes) =>
          nodes.map((el) => (el.textContent || '').trim())
        );
        return messages.some((message) => /Medium detail sample puzzle ready/.test(message));
      })
      .toBe(true);
    await expect
      .poll(() =>
        page.evaluate(() => window.capyGenerator.getState().puzzle?.palette?.length || 0)
      )
      .toBeGreaterThan(0);
    const mediumState = await page.evaluate(() => {
      const { puzzle, sampleDetailLevel, lastOptions } = window.capyGenerator.getState();
      return {
        detailLevel: sampleDetailLevel,
        paletteCount: puzzle?.palette?.length || 0,
        regionCount: puzzle?.regions?.length || 0,
        targetColors: lastOptions?.targetColors || null,
      };
    });
    expect(mediumState.detailLevel).toBe('medium');
    expect(mediumState.paletteCount).toBe(26);
    expect(mediumState.targetColors).toBe(26);
    expect(mediumState.regionCount).toBeGreaterThanOrEqual(38);
    expect(mediumState.regionCount).toBeLessThanOrEqual(60);

    await page.click('#settingsSheet [data-detail-level="high"]');
    await expect.poll(() =>
      page.evaluate(() => window.capyGenerator.getState().sampleDetailLevel)
    ).toBe('high');
    await expect
      .poll(async () => {
        const messages = await page.$$eval('#debugLog .log-entry span', (nodes) =>
          nodes.map((el) => (el.textContent || '').trim())
        );
        return messages.some((message) => /Loading high detail sample puzzle/.test(message));
      })
      .toBe(true);
    await expect
      .poll(async () => {
        const messages = await page.$$eval('#debugLog .log-entry span', (nodes) =>
          nodes.map((el) => (el.textContent || '').trim())
        );
        return messages.some((message) => /High detail sample puzzle ready/.test(message));
      })
      .toBe(true);
    await expect
      .poll(() =>
        page.evaluate(() => window.capyGenerator.getState().puzzle?.palette?.length || 0)
      )
      .toBeGreaterThan(0);
    const highState = await page.evaluate(() => {
      const { puzzle, sampleDetailLevel, lastOptions } = window.capyGenerator.getState();
      return {
        detailLevel: sampleDetailLevel,
        paletteCount: puzzle?.palette?.length || 0,
        regionCount: puzzle?.regions?.length || 0,
        targetColors: lastOptions?.targetColors || null,
      };
    });
    expect(highState.detailLevel).toBe('high');
    expect(highState.paletteCount).toBe(32);
    expect(highState.targetColors).toBe(32);
    expect(highState.regionCount).toBeGreaterThanOrEqual(120);
    expect(highState.regionCount).toBeLessThanOrEqual(190);

    await page.click('#settingsSheet [data-detail-level="low"]');
    await expect.poll(() =>
      page.evaluate(() => window.capyGenerator.getState().sampleDetailLevel)
    ).toBe('low');
    await expect
      .poll(async () => {
        const messages = await page.$$eval('#debugLog .log-entry span', (nodes) =>
          nodes.map((el) => (el.textContent || '').trim())
        );
        return messages.some((message) => /Loading low detail sample puzzle/.test(message));
      })
      .toBe(true);
    await expect
      .poll(async () => {
        const messages = await page.$$eval('#debugLog .log-entry span', (nodes) =>
          nodes.map((el) => (el.textContent || '').trim())
        );
        return messages.some((message) => /Low detail sample puzzle ready/.test(message));
      })
      .toBe(true);
    await expect
      .poll(() =>
        page.evaluate(() => window.capyGenerator.getState().puzzle?.palette?.length || 0)
      )
      .toBeGreaterThan(0);
    const lowState = await page.evaluate(() => {
      const { puzzle, sampleDetailLevel, lastOptions } = window.capyGenerator.getState();
      return {
        detailLevel: sampleDetailLevel,
        paletteCount: puzzle?.palette?.length || 0,
        regionCount: puzzle?.regions?.length || 0,
        targetColors: lastOptions?.targetColors || null,
      };
    });
    expect(lowState.detailLevel).toBe('low');
    expect(lowState.paletteCount).toBe(18);
    expect(lowState.targetColors).toBe(18);
    expect(lowState.regionCount).toBeGreaterThanOrEqual(20);
    expect(lowState.regionCount).toBeLessThanOrEqual(40);

    await page.click('[data-sheet-close="settings"]');
  });

  test('flashes matching regions and supports zoom controls', async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await loadBasicTestPattern(page);

    await expect.poll(() => getStageFlashValue(page)).toBeNull();

    await page.click('[data-color-id="1"]');
    await expect.poll(() => getStageFlashValue(page)).toBe('1');
    await expect.poll(() => getStageFlashValue(page)).toBeNull();

    const zoomValue = () =>
      page.evaluate(() =>
        parseFloat(
          getComputedStyle(document.querySelector('#canvasTransform')).getPropertyValue('--zoom')
        )
      );

    const initialZoom = await zoomValue();
    await page.evaluate(() => {
      const canvas = document.querySelector('[data-testid="puzzle-canvas"]');
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const event = new WheelEvent('wheel', {
        deltaX: 0,
        deltaY: -240,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        bubbles: true,
        cancelable: true,
      });
      canvas.dispatchEvent(event);
    });
    await expect.poll(zoomValue).toBeGreaterThan(initialZoom);
    const afterWheel = await zoomValue();

    await page.keyboard.press('Minus');
    await expect.poll(zoomValue).toBeLessThan(afterWheel);
    const afterMinus = await zoomValue();

    await page.keyboard.press('Shift+=');
    await expect.poll(zoomValue).toBeGreaterThan(afterMinus);

    await page.click('#helpButton');
    const logMessages = await page.$$eval('#debugLog .log-entry span', (nodes) =>
      nodes.map((el) => (el.textContent || '').trim())
    );
    expect(logMessages.length).toBeGreaterThan(0);
    expect(logMessages[0]).toMatch(/Zoom set to/);
    expect(logMessages.some((message) => message.includes('colour #1'))).toBe(true);
    await page.click('[data-sheet-close="help"]');
  });

  test('allows adjusting the canvas background colour', async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await loadBasicTestPattern(page);

    await page.evaluate(() => {
      window.capyGenerator.setBackgroundColor('#1e293b');
      window.capyGenerator.setUiScale(1.2);
      window.capyGenerator.setArtPrompt('Capybara springs remake');
    });

    const state = await page.evaluate(() => window.capyGenerator.getState());
    expect(state.settings.backgroundColor).toBe('#1e293b');
    expect(state.settings.uiScale).toBeCloseTo(1.2, 2);
    expect(state.settings.artPrompt).toBe('Capybara springs remake');

    const pixel = await page.evaluate(() => {
      const canvas = document.querySelector('[data-testid="puzzle-canvas"]');
      if (!canvas) return null;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      return Array.from(ctx.getImageData(0, 0, 1, 1).data);
    });
    expect(pixel).not.toBeNull();
    expect(pixel.slice(0, 3)).not.toEqual([248, 250, 252]);

    const dataPixel = await page.evaluate(() => {
      const state = window.capyGenerator.getState();
      if (!state.puzzleImageData) return null;
      return Array.from(state.puzzleImageData.data.slice(0, 3));
    });
    expect(dataPixel).toEqual([30, 41, 59]);

    await page.click('#helpButton');
    const logMessages = await page.$$eval('#debugLog .log-entry span', (nodes) =>
      nodes.map((el) => (el.textContent || '').trim())
    );
    expect(logMessages.some((message) => /Background colour set to #1E293B/.test(message))).toBe(true);
    expect(logMessages.some((message) => /Interface scale set to 120%/.test(message))).toBe(true);
    expect(logMessages.some((message) => /Art prompt updated \(\d+ characters\)/.test(message))).toBe(true);
    await page.click('[data-sheet-close="help"]');
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

    await page.click('#helpButton');
    await expect(page.locator('#debugLog .log-entry span').first()).toHaveText(/Reset puzzle progress/);
    await page.click('[data-sheet-close="help"]');
  });
});
