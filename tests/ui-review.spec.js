const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const APP_URL = 'http://127.0.0.1:8000/index.html';
const REVIEW_DIR = path.join(__dirname, '..', 'artifacts', 'ui-review');

test.describe('Capybooper visual review', () => {
  test.beforeAll(async () => {
    await fs.promises.mkdir(REVIEW_DIR, { recursive: true });
  });

  test('renders the home page, captures a screenshot, and logs key details', async ({ page }, testInfo) => {
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
    await page.waitForSelector('[data-testid="palette-dock"] button', {
      timeout: 60_000,
      state: 'attached',
    });
    await page.waitForSelector('path[data-cell-id]', {
      timeout: 60_000,
      state: 'attached',
    });

    const details = await page.evaluate(() => {
      const paletteButtons = document.querySelectorAll('[data-testid="palette-dock"] button');
      const cellPaths = document.querySelectorAll('path[data-cell-id]');

      return {
        title: document.title,
        paletteCount: paletteButtons.length,
        cellCount: cellPaths.length,
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
    await testInfo.attach('ui-review screenshot', {
      path: screenshotPath,
      contentType: 'image/png',
    });

    const summary = {
      ...details,
      timestamp: new Date().toISOString(),
      consoleErrors,
      screenshot: path.relative(path.join(__dirname, '..'), screenshotPath),
    };

    await fs.promises.writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf8');

    expect(buffer.length).toBeGreaterThan(10_000);
    expect(consoleErrors).toHaveLength(0);
    expect(details.title).toContain('Color-by-Number');
    expect(details.paletteCount).toBeGreaterThan(0);
    expect(details.cellCount).toBeGreaterThan(0);
  });
});
