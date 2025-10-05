const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const APP_URL = 'http://127.0.0.1:8000/index.html';
const REVIEW_DIR = path.join(__dirname, '..', 'artifacts', 'ui-review');

async function uploadFixtureImage(page) {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 96;
    const ctx = canvas.getContext('2d');
    const colors = ['#1d4ed8', '#f97316', '#16a34a', '#facc15'];
    ctx.fillStyle = colors[0];
    ctx.fillRect(0, 0, 48, 48);
    ctx.fillStyle = colors[1];
    ctx.fillRect(48, 0, 48, 48);
    ctx.fillStyle = colors[2];
    ctx.fillRect(0, 48, 48, 48);
    ctx.fillStyle = colors[3];
    ctx.fillRect(48, 48, 48, 48);
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#111827';
    ctx.strokeRect(0, 0, 96, 96);
    return canvas.toDataURL('image/png');
  });
  const buffer = Buffer.from(dataUrl.split(',')[1], 'base64');
  await page.setInputFiles('#fileInput', {
    name: 'ui-review-fixture.png',
    mimeType: 'image/png',
    buffer,
  });
  await page.waitForFunction(
    () => {
      const summary = window.__capy?.getSummary?.();
      return summary?.paletteCount > 0 && summary?.regionCount > 0;
    },
    null,
    { timeout: 60_000 }
  );
  await page.waitForSelector('#paletteScroller .swatch', { timeout: 60_000 });
}

test.describe('Color-by-number single page review', () => {
  test.beforeAll(async () => {
    await fs.promises.mkdir(REVIEW_DIR, { recursive: true });
  });

  test('fits the fullscreen canvas layout on mobile viewports', async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width: 414, height: 896 });
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await uploadFixtureImage(page);

    const layout = await page.evaluate(() => {
      const viewport = document.getElementById('canvasViewport');
      const paletteDock = document.getElementById('paletteDock');
      const scroller = document.getElementById('paletteScroller');
      const swatches = Array.from(scroller.querySelectorAll('.swatch'));
      const menu = document.querySelector('[data-testid="menu-toggle"]');
      const startHintHidden = document
        .getElementById('startHint')
        ?.classList.contains('hidden');
      const menuRect = menu?.getBoundingClientRect() || null;
      const paletteRect = paletteDock?.getBoundingClientRect() || null;
      const viewportRect = viewport?.getBoundingClientRect() || null;
      const distanceFromBottom = paletteRect ? window.innerHeight - paletteRect.bottom : null;
      return {
        startHintHidden,
        menuRect,
        paletteRect,
        viewportRect,
        distanceFromBottom,
        swatchCount: swatches.length,
        swatchMetrics: swatches.slice(0, 4).map((el) => {
          const rect = el.getBoundingClientRect();
          return {
            width: rect.width,
            height: rect.height,
            label: (el.textContent || '').replace(/\s+/g, ' ').trim(),
          };
        }),
        scrollWidth: scroller.scrollWidth,
        clientWidth: scroller.clientWidth,
      };
    });

    expect(layout.startHintHidden).toBe(true);
    expect(layout.menuRect).not.toBeNull();
    expect(layout.menuRect.top).toBeGreaterThanOrEqual(8);
    expect(layout.menuRect.left).toBeGreaterThanOrEqual(8);
    expect(layout.paletteRect).not.toBeNull();
    expect(layout.viewportRect).not.toBeNull();
    expect(layout.distanceFromBottom).not.toBeNull();
    expect(layout.distanceFromBottom).toBeLessThanOrEqual(48);
    expect(layout.swatchCount).toBeGreaterThan(0);
    layout.swatchMetrics.forEach((metric) => {
      expect(metric.label.toLowerCase()).toContain('colour');
      expect(metric.width).toBeGreaterThanOrEqual(120);
      expect(metric.height).toBeLessThanOrEqual(120);
    });
    expect(layout.scrollWidth).toBeGreaterThan(layout.clientWidth);
  });

  test('fills a region via tap without console errors', async ({ page }) => {
    test.setTimeout(120000);
    const consoleErrors = [];

    page.on('pageerror', (error) => {
      consoleErrors.push(`pageerror: ${error.message}`);
    });

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(`console error: ${msg.text()}`);
      }
    });

    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await uploadFixtureImage(page);

    const before = await page.evaluate(() => {
      const summary = window.__capy.getSummary();
      const region = window.__capy.getFirstPlayableRegion();
      return {
        filled: summary.filledCount,
        activeColor: summary.activeColor,
        regionId: region?.id ?? null,
      };
    });

    expect(before.regionId).not.toBeNull();

    await page.evaluate((regionId) => {
      window.__capy.tapRegion(regionId);
    }, before.regionId);

    await page.waitForFunction(
      (filledBefore) => {
        const summary = window.__capy?.getSummary?.();
        return summary && summary.filledCount > filledBefore;
      },
      before.filled,
      { timeout: 10_000 }
    );

    const after = await page.evaluate(() => window.__capy.getSummary());

    expect(after.filledCount).toBeGreaterThan(before.filled);
    expect(after.activeColor).not.toBeNull();
    expect(consoleErrors).toHaveLength(0);
  });

  test('captures a regression screenshot and summary', async ({ page }, testInfo) => {
    test.setTimeout(120000);
    const consoleErrors = [];

    page.on('pageerror', (error) => {
      consoleErrors.push(`pageerror: ${error.message}`);
    });

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(`console error: ${msg.text()}`);
      }
    });

    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await uploadFixtureImage(page);

    await page.click('[data-testid="menu-toggle"]');
    await page.waitForSelector('#optionsDrawer.open', { timeout: 10_000 });

    const optionsState = await page.evaluate(() => ({
      colors: Number(document.getElementById('colorCount')?.value || 0),
      regions: Number(document.getElementById('minRegion')?.value || 0),
      detail: Number(document.getElementById('detailLevel')?.value || 0),
      status: document.getElementById('statusMessage')?.textContent?.trim() || '',
      progress: document.getElementById('progressDetail')?.textContent?.trim() || '',
    }));

    await page.click('#closeOptions');
    await page.waitForSelector('#optionsDrawer.open', { state: 'detached', timeout: 10_000 });

    const details = await page.evaluate(() => {
      const summary = window.__capy.getSummary();
      const paletteLabels = Array.from(
        document.querySelectorAll('#paletteScroller .swatch strong')
      ).map((node) => node.textContent?.replace(/\s+/g, ' ').trim() || '');
      return {
        title: document.title,
        summary,
        paletteLabels,
      };
    });

    const safeName =
      testInfo.title
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase() || 'ui-review';

    const screenshotPath = path.join(REVIEW_DIR, `${safeName}.png`);
    const summaryPath = path.join(REVIEW_DIR, `${safeName}.json`);

    const buffer = await page.screenshot({ path: screenshotPath, fullPage: true });

    const summary = {
      title: details.title,
      timestamp: new Date().toISOString(),
      consoleErrors,
      screenshot: path.relative(path.join(__dirname, '..'), screenshotPath),
      paletteLabels: details.paletteLabels,
      options: optionsState,
      puzzle: details.summary,
    };

    await fs.promises.writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf8');

    expect(details.summary.paletteCount).toBeGreaterThan(0);
    expect(details.summary.regionCount).toBeGreaterThan(0);
    expect(buffer.length).toBeGreaterThan(5000);
    expect(consoleErrors).toHaveLength(0);
  });
});
