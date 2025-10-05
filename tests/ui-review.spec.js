const { test, expect } = require('@playwright/test');

const APP_URL = 'http://127.0.0.1:8000/index.html';

async function createTestImageDataUrl(page) {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1d4ed8';
    ctx.fillRect(0, 0, 32, 32);
    ctx.fillStyle = '#22c55e';
    ctx.fillRect(0, 16, 16, 16);
    ctx.fillStyle = '#f97316';
    ctx.fillRect(16, 0, 16, 16);
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(8, 8, 16, 16);
    return canvas.toDataURL('image/png');
  });
}

async function loadGeneratorWithSample(page) {
  const dataUrl = await createTestImageDataUrl(page);
  await page.evaluate((url) => {
    window.capyGenerator.loadFromDataUrl(url);
  }, dataUrl);
  await page.waitForSelector('[data-testid="palette-swatch"]', { timeout: 60_000 });
  await expect
    .poll(async () => {
      const text = await page.locator('[data-testid="status-bar"]').textContent();
      return (text || '').trim();
    }, { timeout: 60_000 })
    .toContain('Generated');
}

test.describe('Capy image generator', () => {
  test('renders drag hint and options on load', async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="start-hint"]');

    const layout = await page.evaluate(() => {
      const optionsPanel = document.querySelector('[data-testid="options-panel"]');
      const status = document.querySelector('[data-testid="status-bar"]');
      const progress = document.querySelector('[data-testid="progress-message"]');
      const controls = Array.from(
        optionsPanel?.querySelectorAll('label span:first-child') ?? []
      ).map((el) => (el.textContent || '').trim());
      return {
        hasOptions: Boolean(optionsPanel),
        status: (status?.textContent || '').trim(),
        progress: (progress?.textContent || '').trim(),
        controlLabels: controls,
      };
    });

    expect(layout.hasOptions).toBe(true);
    expect(layout.status).toContain('Drop an image');
    expect(layout.progress).toContain('Drop an image');
    expect(layout.controlLabels.length).toBeGreaterThanOrEqual(3);
  });

  test('generates a puzzle and enables palette + downloads', async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await loadGeneratorWithSample(page);

    const summary = await page.evaluate(() => {
      const state = window.capyGenerator.getState();
      return {
        paletteCount: state.puzzle?.palette.length ?? 0,
        regionCount: state.puzzle?.regions.length ?? 0,
        status: document.querySelector('[data-testid="status-bar"]').textContent.trim(),
        progress: document.querySelector('[data-testid="progress-message"]').textContent.trim(),
        downloadEnabled: !document.getElementById('downloadJson').disabled,
        resetEnabled: !document.getElementById('resetPuzzle').disabled,
        applyDisabled: document.getElementById('applyOptions').disabled,
      };
    });

    expect(summary.paletteCount).toBeGreaterThan(0);
    expect(summary.regionCount).toBeGreaterThan(0);
    expect(summary.status).toMatch(/Generated/);
    expect(summary.progress).toMatch(/Filled 0/);
    expect(summary.downloadEnabled).toBe(true);
    expect(summary.resetEnabled).toBe(true);
    expect(summary.applyDisabled).toBe(true);

    await page.locator('#colorCount').evaluate((input) => {
      input.value = '6';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator('#applyOptions')).toBeEnabled();

    await page.click('#applyOptions');
    await expect(page.locator('#applyOptions')).toBeDisabled();
    await expect
      .poll(async () => {
        const text = await page.locator('[data-testid="status-bar"]').textContent();
        return (text || '').trim();
      }, { timeout: 60_000 })
      .toContain('Generated');

    const optionsState = await page.evaluate(() => {
      const state = window.capyGenerator.getState();
      return {
        targetColors: state.lastOptions?.targetColors ?? null,
        paletteCount: state.puzzle?.palette.length ?? 0,
      };
    });

    expect(optionsState.targetColors).toBe(6);
    expect(optionsState.paletteCount).toBeGreaterThan(0);
  });

  test('fills a region and can reset progress', async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await loadGeneratorWithSample(page);

    const target = await page.evaluate(() => {
      const state = window.capyGenerator.getState();
      const puzzle = state.puzzle;
      if (!puzzle) return null;
      const region = puzzle.regions.find((entry) => entry.pixelCount > 0);
      if (!region) return null;
      return {
        colorId: region.colorId,
        cx: region.cx,
        cy: region.cy,
        width: puzzle.width,
        height: puzzle.height,
      };
    });

    expect(target).not.toBeNull();
    if (!target) return;

    const paletteIds = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid="palette-swatch"]')).map((el) =>
        el.getAttribute('data-color-id')
      )
    );
    await page.click(`[data-color-id="${target.colorId}"]`);
    const activeColor = await page.evaluate(
      () => window.capyGenerator.getState().activeColor
    );
    const canvasBox = await page.locator('[data-testid="puzzle-canvas"]').boundingBox();
    expect(canvasBox).not.toBeNull();
    if (!canvasBox) return;

    const offsetX = (target.cx / target.width) * canvasBox.width;
    const offsetY = (target.cy / target.height) * canvasBox.height;
    const clickX = canvasBox.x + offsetX;
    const clickY = canvasBox.y + offsetY;
    const regionAtPoint = await page.evaluate(({ x, y }) => {
      const canvas = document.querySelector('[data-testid="puzzle-canvas"]');
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const px = Math.floor((x - rect.left) * scaleX);
      const py = Math.floor((y - rect.top) * scaleY);
      const state = window.capyGenerator.getState();
      if (!state.puzzle) return null;
      const idx = py * state.puzzle.width + px;
      return {
        px,
        py,
        regionId: state.puzzle.regionMap[idx],
      };
    }, { x: clickX, y: clickY });
    expect(regionAtPoint?.regionId ?? -1).toBeGreaterThanOrEqual(0);
    await page.evaluate(({ x, y }) => {
      const canvas = document.querySelector('[data-testid="puzzle-canvas"]');
      if (!canvas) return;
      const event = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
      });
      canvas.dispatchEvent(event);
    }, { x: clickX, y: clickY });

    await expect
      .poll(async () => {
        return page.evaluate(() => window.capyGenerator.getState().filled.size);
      }, { timeout: 10_000 })
      .toBe(1);
    await expect(page.locator('[data-testid="progress-message"]')).toHaveText(/Filled 1 of/);

    await page.click('#resetPuzzle');
    await expect
      .poll(async () => {
        return page.evaluate(() => window.capyGenerator.getState().filled.size);
      }, { timeout: 10_000 })
      .toBe(0);
    await expect(page.locator('[data-testid="progress-message"]')).toHaveText(/Filled 0 of/);
  });
});

