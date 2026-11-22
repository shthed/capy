/**
 * Part 2 Browser E2E Suite Orchestrator ([E2E 01/24]..[E2E 24/24]).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { isServerListening } from './helpers.mjs';
import { runBootOnboardingE2e } from './boot-onboarding.e2e.mjs';
import { runGameplaySettingsReplayE2e } from './gameplay-settings-replay.e2e.mjs';
import { runCoopCloudOfflineE2e } from './coop-cloud-offline.e2e.mjs';
import { runSvgCoopChannelsE2e } from './svg-coop-channels.e2e.mjs';
import { runMobileResilienceIsolationE2e } from './mobile-resilience-isolation.e2e.mjs';
import { runAccessibilityByocStorageE2e } from './accessibility-byoc-storage.e2e.mjs';

export async function runBrowserBasicsSuite({ projectRoot, webPkgJson, explicitTestUrl = '' }) {
  console.log('\n=== PART 2: Full Browser, PWA, Gesture, Co-op, Replay & Offline E2E Suite ===');
  let previewServer = null;
  let BASE_URL = explicitTestUrl;
  if (!BASE_URL || !(await isServerListening(BASE_URL))) {
    const requestedPort = Number.parseInt(process.env.CAPY_TEST_PORT || '0', 10);
    const previewPort = Number.isInteger(requestedPort) && requestedPort > 0 ? requestedPort : 0;
    console.log(`Starting local Vite preview server from dist/ (port ${previewPort || 'ephemeral'})...`);
    previewServer = await preview({
      root: projectRoot,
      preview: { port: previewPort, strictPort: previewPort > 0, host: '0.0.0.0' },
    });
    const addr = previewServer.httpServer?.address();
    const resolvedPort = typeof addr === 'object' && addr ? addr.port : previewPort;
    BASE_URL = `http://127.0.0.1:${resolvedPort}`;
    console.log(`Vite preview server listening at ${BASE_URL}`);
  } else {
    console.log(`Using existing server at ${BASE_URL}`);
  }

  const executablePath =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const consoleErrors = [];
  const attachErrorListeners = (p, label) => {
    p.on('pageerror', (err) => consoleErrors.push(`[${label}:pageerror] ${err.message}`));
  };

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 860 },
      hasTouch: true,
      acceptDownloads: true,
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    await context.addInitScript(() => {
      try {
        window.localStorage.setItem('capy_dev_debug', '1');
      } catch {
        // Ignore on opaque origins
      }
    });
    const page = await context.newPage();
    attachErrorListeners(page, 'main');

    const e2eTotal = 24;
    const padE2e = (n) => String(n).padStart(2, '0');
    let e2eStep = 0;
    const logE2eStart = (label) => {
      e2eStep += 1;
      console.log(`[E2E ${padE2e(e2eStep)}/${padE2e(e2eTotal)}] ${label}`);
    };
    const logE2ePass = (label) => {
      console.log(`   PASS [E2E ${padE2e(e2eStep)}/${padE2e(e2eTotal)}]: ${label}`);
    };

    const ctx = {
      browser,
      context,
      page,
      BASE_URL,
      projectRoot,
      webPkgJson,
      consoleErrors,
      attachErrorListeners,
      logE2eStart,
      logE2ePass,
    };

    await runBootOnboardingE2e(ctx);
    await runGameplaySettingsReplayE2e(ctx);
    await runCoopCloudOfflineE2e(ctx);
    await runSvgCoopChannelsE2e(ctx);
    await runMobileResilienceIsolationE2e(ctx);
    await runAccessibilityByocStorageE2e(ctx);

    assert.equal(
      e2eStep,
      e2eTotal,
      `Expected ${e2eTotal} E2E test groups to run, executed ${e2eStep}`
    );
    assert.equal(consoleErrors.length, 0, `Unexpected page errors: ${consoleErrors.join('; ')}`);
    console.log(`\nALL ${e2eTotal} E2E BROWSER, PWA, CO-OP, REPLAY & OFFLINE SUITES PASSED!\n`);
  } finally {
    await browser.close();
    if (previewServer) {
      await new Promise((resolve) => previewServer.httpServer.close(resolve));
    }
  }
}
