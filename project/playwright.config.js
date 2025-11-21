import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const artifactsDir = path.resolve('artifacts/ui-review');
const previewBaseUrl = process.env.PLAYWRIGHT_BASE_URL?.trim() || 'http://127.0.0.1:8000/';
const resolvedBaseUrl = new URL('index.html', previewBaseUrl).toString();
const shouldStartWebServer = !process.env.PLAYWRIGHT_BASE_URL;

if (!fs.existsSync(artifactsDir)) {
  fs.mkdirSync(artifactsDir, { recursive: true });
}

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/ui-*.spec.js'],
  fullyParallel: false,
  timeout: 60_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: resolvedBaseUrl,
    trace: 'retain-on-failure',
    video: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: shouldStartWebServer
    ? {
        command: 'npm run dev',
        url: resolvedBaseUrl,
        reuseExistingServer: !process.env.CI,
      }
    : undefined,
  reporter: [
    ['html', { outputFolder: artifactsDir, open: 'never' }],
  ],
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chromium'],
      },
    },
  ],
});
