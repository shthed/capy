import { test, expect } from '@playwright/test';

const BASE_URL = 'index.html';

function formatLog(entry) {
  return `[${entry.type}] ${entry.text}`;
}

function formatDebug(entry) {
  const timestamp = entry.display || entry.iso || '';
  const message = entry.message || entry.text || '';
  return `[debug] ${timestamp ? `${timestamp} ` : ''}${message}`.trim();
}

function formatPageError(entry) {
  return [entry.message, entry.stack].filter(Boolean).join('\n');
}

function buildLogReport({ debugLogs, consoleLogs, pageErrors }) {
  const parts = [
    'Debug logs:',
    debugLogs.length ? debugLogs.map(formatDebug).join('\n') : '(none)',
    '',
    'Console logs:',
    consoleLogs.length ? consoleLogs.map(formatLog).join('\n') : '(none)',
    '',
    'Page errors:',
    pageErrors.length ? pageErrors.map(formatPageError).join('\n\n') : '(none)',
  ];
  return parts.join('\n');
}

test('loads the game without console or debug errors', async ({ page }) => {
  const consoleLogs = [];
  const consoleErrors = [];
  const debugLogs = [];
  const debugLogKeys = new Set();
  const pageErrors = [];

  const recordDebugEntry = (entry) => {
    if (!entry) return;
    const key = `${entry.iso || ''}|${entry.message || entry.text || ''}`;
    if (debugLogKeys.has(key)) return;
    debugLogKeys.add(key);
    debugLogs.push(entry);
  };

  await page.exposeBinding('recordDebugLog', (_, entry) => {
    recordDebugEntry(entry);
  });

  await page.addInitScript(() => {
    const handler = (event) => {
      const entry = event?.detail;
      if (!entry || typeof window.recordDebugLog !== 'function') return;
      window.recordDebugLog(entry);
    };
    window.addEventListener('capy:debug-log', handler);
  });

  page.on('console', (message) => {
    const entry = { type: message.type(), text: message.text() };
    consoleLogs.push(entry);

    if (message.type() === 'error') {
      consoleErrors.push(entry);
    }
  });

  page.on('pageerror', (error) => {
    pageErrors.push({ message: error.message, stack: error.stack });
  });

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  const initialDebug = await page.evaluate(() => window.__capyDebugLogEntries || []);
  initialDebug.forEach(recordDebugEntry);

  await page.waitForFunction(
    () => Array.isArray(window.__capyDebugLogEntries) && window.__capyDebugLogEntries.length > 0,
    null,
    { timeout: 10000 }
  );

  await page.waitForSelector('[data-testid="puzzle-canvas"]');
  await page.waitForFunction(() => document.querySelectorAll('#palette [role="listitem"]').length > 0, undefined, {
    timeout: 10000,
  });

  const canvas = page.getByTestId('puzzle-canvas');
  const firstPaletteEntry = page.locator('#palette [role="listitem"]').first();

  await firstPaletteEntry.click();
  await canvas.click({ position: { x: 10, y: 10 }, force: true });

  const debugErrorLogs = debugLogs.filter(({ message }) => /error/i.test(message));

  const report = buildLogReport({ debugLogs, consoleLogs, pageErrors });

  console.info('Runtime log report:\n' + report);
  await test.info().attach('runtime-logs', {
    body: report,
    contentType: 'text/plain',
  });

  expect(pageErrors, report).toEqual([]);
  expect(consoleErrors, report).toEqual([]);
  expect(debugErrorLogs, report).toEqual([]);
});

test('autosaves a loaded puzzle and renders the save entry', async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  await page.waitForSelector('[data-testid="puzzle-canvas"]');
  await page.waitForFunction(
    () => document.querySelectorAll('#palette [role="listitem"]').length > 0,
    undefined,
    { timeout: 10000 }
  );

  await page.click('#settingsButton');

  const saveList = page.locator('[data-save-list]');
  await expect(saveList).toBeVisible({ timeout: 10000 });

  const saveEntry = saveList.locator('[data-save-id]');
  await page.waitForFunction(
    () => document.querySelectorAll('[data-save-list] [data-save-id]').length > 0,
    undefined,
    { timeout: 15000 }
  );

  const saveCount = await saveEntry.count();
  expect(saveCount).toBeGreaterThan(0);
  await expect(saveEntry.first()).toBeVisible();
});
