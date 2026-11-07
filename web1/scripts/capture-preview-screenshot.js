#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const previewBaseUrl = process.env.PLAYWRIGHT_BASE_URL?.trim() || 'http://127.0.0.1:8000/';
const targetUrl = new URL('index.html', previewBaseUrl).toString();

const artifactsDir = path.resolve(__dirname, '..', 'artifacts', 'ui-review');
const screenshotPath = path.join(artifactsDir, 'preview.png');

async function main() {
  await fs.mkdir(artifactsDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  await page.goto(targetUrl, { waitUntil: 'networkidle' });
  await page.screenshot({ path: screenshotPath, fullPage: true });

  await browser.close();

  console.log(`Saved preview screenshot to ${screenshotPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
