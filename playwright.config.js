const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'tests',
  use: {
    browserName: 'chromium',
    headless: true,
  },
  webServer: {
    command: 'npx http-server . -p 8000 -c-1',
    port: 8000,
    timeout: 120 * 1000,
    reuseExistingServer: true,
  },
});