const { test, expect } = require('@playwright/test');
const nodePath = require('path');
const { pathToFileURL } = require('url');

const appUrl = pathToFileURL(nodePath.join(__dirname, '..', 'index.html')).href;

async function waitForAppReady(page) {
  await page.goto(appUrl);
  await page.waitForSelector('svg path[data-cell-id]', { state: 'visible' });
  await page.waitForLoadState('networkidle');
}

test.describe('Capybooper app smoke tests', () => {
  test.beforeEach(async ({ page }) => {
    await waitForAppReady(page);
  });

  test('renders the application shell', async ({ page }) => {
    await expect(page).toHaveTitle('Color-by-Number Demo');
    await expect(page.locator('svg').first()).toBeVisible();
    await expect(page.locator('[data-testid="palette-dock"]')).toBeVisible();
  });

  test('shows artwork and palette elements', async ({ page }) => {
    const cellPaths = page.locator('svg path[data-cell-id]');
    expect(await cellPaths.count()).toBeGreaterThan(20);

    const paletteButtons = page.locator('[data-testid="palette-dock"] button');
    await expect(paletteButtons).toHaveCount(11);
    await expect(paletteButtons.first()).toHaveText('1');
  });

  test('opens the art library and lists bundled scenes', async ({ page }) => {
    await page.locator('[data-testid="open-art-library"]').click();

    const dialog = page.locator('[data-testid="art-library-dialog"]');
    await expect(dialog).toBeVisible();

    const cards = dialog.locator('[data-testid="art-library-card"]');
    await expect(cards).toHaveCount(3);
    await expect(cards).toContainText([
      'Capybara Lagoon Sunrise',
      'Lush Green Forest Walk',
      'Twilight Marsh Study',
    ]);

    await dialog.locator('[data-testid="close-art-library"]').click();
    await expect(page.locator('[data-testid="art-library-dialog"]')).toHaveCount(0);
  });

  test('fills a cell and updates progress', async ({ page }) => {
    const progressBadge = page.locator('[data-testid="progress-indicator"]');
    await progressBadge.waitFor();
    await expect(progressBadge).toHaveText('0%');

    const paletteButtons = page.locator('[data-testid="palette-dock"] button');
    await paletteButtons.first().click();

    const targetCell = page.locator('path[data-cell-id="c1"]');
    await targetCell.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => window.__capyTestHooks?.fillCell);
    await page.evaluate(() => {
      window.__capyTestHooks?.fillCell('c1');
    });

    await expect(progressBadge).not.toHaveText('0%');
  });

  test('merges stored artworks with bundled starters on boot', async ({ page }) => {
    await page.evaluate(() => {
      const stored = [
        {
          id: 'custom-art',
          title: 'Custom Scene',
          width: 100,
          height: 100,
          palette: [{ id: 1, name: 'One', rgba: '#ffffff' }],
          cells: [{ id: 'c1', colorId: 1, d: 'M0 0 L100 0 L100 100 L0 100 Z' }],
        },
      ];
      localStorage.setItem('capybooper_artworks_v1', JSON.stringify(stored));
      localStorage.setItem('capybooper_active_art', 'custom-art');
    });

    await page.reload();
    await page.waitForSelector('svg path[data-cell-id]', { state: 'visible' });
    await page.waitForLoadState('networkidle');

    await page.locator('[data-testid="open-art-library"]').click();
    const dialog = page.locator('[data-testid="art-library-dialog"]');
    await expect(dialog).toBeVisible();

    const cards = dialog.locator('[data-testid="art-library-card"]');
    await expect(cards).toHaveCount(4);
    await expect(cards).toContainText([
      'Capybara Lagoon Sunrise',
      'Custom Scene',
      'Lush Green Forest Walk',
      'Twilight Marsh Study',
    ]);
  });

  test('preserves stored titles when merging starters', async ({ page }) => {
    await page.waitForFunction(() => {
      const raw = localStorage.getItem('capybooper_artworks_v1');
      if (!raw) return false;
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) && parsed.length >= 3;
      } catch (err) {
        return false;
      }
    });

    const renamedId = await page.evaluate(() => {
      const raw = localStorage.getItem('capybooper_artworks_v1');
      const list = raw ? JSON.parse(raw) : [];
      let targetId = null;
      const renamed = list.map((art) => {
        if ((art.title || '').trim() === 'Capybara Lagoon Sunrise') {
          targetId = art.id;
          return { ...art, title: 'Lagoon Custom' };
        }
        return art;
      });
      localStorage.setItem('capybooper_artworks_v1', JSON.stringify(renamed));
      if (targetId) {
        localStorage.setItem('capybooper_active_art', targetId);
      }
      return targetId;
    });
    expect(renamedId).not.toBeNull();

    await page.reload();
    await page.waitForSelector('svg path[data-cell-id]', { state: 'visible' });
    await page.waitForLoadState('networkidle');

    const storedTitle = await page.evaluate((targetId) => {
      const raw = localStorage.getItem('capybooper_artworks_v1');
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        const entry = parsed.find((art) => art.id === targetId);
        return entry ? entry.title : null;
      } catch (err) {
        return null;
      }
    }, renamedId);
    expect(storedTitle).toBe('Lagoon Custom');

    await page.locator('[data-testid="open-art-library"]').click();
    const dialog = page.locator('[data-testid="art-library-dialog"]');
    await expect(dialog).toBeVisible();

    const cards = dialog.locator('[data-testid="art-library-card"]');
    await expect(cards).toHaveCount(3);
    await expect(cards.filter({ hasText: 'Lagoon Custom' })).toHaveCount(1);
    await expect(cards.filter({ hasText: 'Capybara Lagoon Sunrise' })).toHaveCount(0);
  });
});
