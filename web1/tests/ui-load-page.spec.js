import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';

test('web1: loads the legacy app page and opens settings sheet without runtime or console errors', async ({ page }) => {
  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('pageerror', (error) => {
    pageErrors.push(error.stack || error.message);
  });

  await page.goto('index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  // Click settings button to test opening sheet
  await page.click('#settingsButton');
  await page.waitForTimeout(1000);

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('web: loads the updated React web app and opens settings modal without runtime or console errors', async ({ page }) => {
  const webDistIndex = path.resolve(process.cwd(), 'web-dist-test', 'index.html');
  test.skip(!fs.existsSync(webDistIndex), 'Built web/dist bundle not mounted at web1/web-dist-test');

  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('pageerror', (error) => {
    pageErrors.push(error.stack || error.message);
  });

  await page.goto('web-dist-test/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('button[title="Settings and Menu"]', { timeout: 10000 });
  await page.click('button[title="Settings and Menu"]');
  await page.waitForTimeout(1000);

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
