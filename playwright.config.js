import { defineConfig, devices } from '@playwright/test';

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
