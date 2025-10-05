const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const APP_URL = 'http://127.0.0.1:8000/index.html';
const REVIEW_DIR = path.join(__dirname, '..', 'artifacts', 'ui-review');

test.describe('Capybooper visual review', () => {
  test.beforeAll(async () => {
    await fs.promises.mkdir(REVIEW_DIR, { recursive: true });
  });

  test('keeps the header anchored and palette compact on mobile viewports', async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width: 414, height: 896 });
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('header[role="banner"]', { timeout: 60_000 });
    await page.waitForSelector('[data-testid="palette-dock"] button', { timeout: 60_000 });

    const layout = await page.evaluate(() => {
      const header = document.querySelector('header[role="banner"]');
      const paletteButtons = Array.from(
        document.querySelectorAll('[data-testid="palette-dock"] button')
      );
      if (!header || paletteButtons.length === 0) {
        return null;
      }
      const headerRect = header.getBoundingClientRect();
      const buttonMetrics = paletteButtons.map((btn) => {
        const rect = btn.getBoundingClientRect();
        return {
          text: btn.textContent || '',
          width: rect.width,
          height: rect.height,
        };
      });
      return {
        headerLeft: headerRect.left,
        headerTop: headerRect.top,
        headerRightInset: window.innerWidth - headerRect.right,
        buttonMetrics,
      };
    });

    expect(layout).not.toBeNull();
    if (!layout) return;

    expect(layout.headerTop).toBeGreaterThanOrEqual(4);
    expect(layout.headerRightInset).toBeLessThanOrEqual(24);
    expect(layout.headerLeft).toBeGreaterThanOrEqual(0);

    const normalizedTexts = layout.buttonMetrics.map((entry) =>
      entry.text.replace(/\s+/g, ' ').trim().toLowerCase()
    );
    expect(normalizedTexts[0]).toMatch(/sky/);
    normalizedTexts.forEach((text) => {
      expect(text).not.toMatch(/\d+\s+left\b/);
    });

    layout.buttonMetrics.forEach((metric) => {
      expect(metric.width).toBeLessThanOrEqual(90);
      expect(metric.height).toBeLessThanOrEqual(90);
    });

    const menuToggle = page.locator('[data-testid="command-menu-toggle"]');
    if ((await menuToggle.count()) > 0) {
      await menuToggle.click();
      await page.waitForSelector('[aria-label="Canvas command menu"]', {
        timeout: 10_000,
        state: 'visible',
      });
    }
    await page.click('[data-testid="open-art-library"]');
    const cardCount = await page.locator("[data-testid=\"art-library-card\"]").count();
    expect(cardCount).toBeGreaterThan(0);
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
      const progressEl = document.querySelector('[data-testid="progress-indicator"]');
      const libraryButton = document.querySelector('[data-testid="open-art-library"]');

      const progressText = progressEl ? progressEl.textContent.trim() : null;

      return {
        title: document.title,
        paletteCount: paletteButtons.length,
        cellCount: cellPaths.length,
        progressText,
        progressLabel: progressEl ? progressEl.getAttribute('aria-label')?.trim() ?? null : null,
        hasLibraryButton: Boolean(libraryButton),
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
    expect(details.hasLibraryButton).toBe(true);
    expect(details.progressText).toMatch(/\d+%/);
    expect(details.progressLabel).toMatch(/% complete$/);
  });
});
