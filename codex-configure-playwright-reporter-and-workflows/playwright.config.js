import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const artifactsDir = path.resolve('artifacts/ui-review');
fs.mkdirSync(artifactsDir, { recursive: true });

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  timeout: 60_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:8000/index.html',
    trace: 'retain-on-failure',
    video: 'on-first-retry',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:8000/index.html',
    reuseExistingServer: !process.env.CI,
  },
  reporter: [
    ['html', { outputFolder: artifactsDir, open: 'never' }],
  ],
  projects: [
    {
      name: 'chromium-desktop',
      use: {
        ...devices['Desktop Chromium'],
      },
    },
    {
      name: 'webkit-mobile',
      use: {
        ...devices['iPhone 12'],
      },
    },
  ],
});
