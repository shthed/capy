import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  timeout: 60_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: 'http://localhost:8000',
    viewport: { width: 1280, height: 720 },
    video: 'on',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx http-server -c-1 . -p 8000',
    url: 'http://localhost:8000',
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
