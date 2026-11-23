/**
 * Part 2 Browser E2E Suite Orchestrator ([E2E 01/28]..[E2E 28/28]).
 *
 * Runs 11 self-contained E2E suites in parallel across isolated BrowserContexts,
 * with support for --smoke, --suite=<csv>, --workers=<n>, and --shard=<i>/<n>.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { isServerListening } from './helpers.mjs';
import { runBootE2e, runOnboardingE2e, runOffersE2e } from './boot-onboarding.e2e.mjs';
import { runGameplaySettingsReplayE2e } from './gameplay-settings-replay.e2e.mjs';
import { runCoopCloudOfflineE2e } from './coop-cloud-offline.e2e.mjs';
import { runSvgCoopChannelsE2e } from './svg-coop-channels.e2e.mjs';
import { runMobileLayoutE2e, runResilienceIsolationE2e } from './mobile-resilience-isolation.e2e.mjs';
import { runAccessibilityByocE2e, runStorageAnalyzerE2e } from './accessibility-byoc-storage.e2e.mjs';
import { runInfiniteZoomE2e } from './infinite-zoom.e2e.mjs';

export const E2E_SUITES = [
  {
    name: 'boot',
    stages: 1,
    smoke: true,
    estimatedWeight: 13,
    description: 'PWA manifest, Digital Asset Links, privacy policy, Service Worker & instant 4-sample boot',
    run: runBootE2e,
  },
  {
    name: 'onboarding',
    stages: 1,
    smoke: false,
    estimatedWeight: 44,
    description: '12-step OnboardingTutorial tour, modal-docked Settings/Hints spotlight & rapid Ctrl+Z burst',
    run: runOnboardingE2e,
  },
  {
    name: 'offers',
    stages: 1,
    smoke: false,
    estimatedWeight: 48,
    description: 'FeatureOfferBanner 8-offer queue, ?capy_channel=beta isolation, #s= DoS & Play Store gating',
    run: runOffersE2e,
  },
  {
    name: 'gameplay',
    stages: 4,
    smoke: true,
    estimatedWeight: 46,
    description: 'Palette/tap coloring, double-tap zoom, pan momentum, 5-tab SettingsModal, Undo/Redo/Replay & Create gallery',
    run: runGameplaySettingsReplayE2e,
  },
  {
    name: 'coop',
    stages: 5,
    smoke: false,
    estimatedWeight: 75,
    description: '#s= share link, 2-peer BroadcastChannel Co-op, Drive CRDT, offline PWA reload, BF-2/BF-6 & Daily/Stats',
    run: runCoopCloudOfflineE2e,
  },
  {
    name: 'svg-coop',
    stages: 3,
    smoke: false,
    estimatedWeight: 87,
    description: 'Printable SVG export, Sub-Tile breadcrumbs, Release Channels & Co-op WELCOME_STATE/Replay rewind/Reset Epoch',
    run: runSvgCoopChannelsE2e,
  },
  {
    name: 'mobile',
    stages: 3,
    smoke: false,
    estimatedWeight: 48,
    description: '360x780 mobile layout bounds, viewport-save flush races, tap-burst non-starvation & BETA pill containment',
    run: runMobileLayoutE2e,
  },
  {
    name: 'resilience',
    stages: 3,
    smoke: false,
    estimatedWeight: 46,
    description: 'Atomic malformed .capy import, ErrorBoundary, fractional DPR, StorageNamespace isolation & IDB quota durability',
    run: runResilienceIsolationE2e,
  },
  {
    name: 'accessibility',
    stages: 2,
    smoke: false,
    estimatedWeight: 46,
    description: 'Large Text UI scaling (360/412/640/1280), Fat-Finger coupling, Paint/Free-Colour & BYOC multi-provider UI',
    run: runAccessibilityByocE2e,
  },
  {
    name: 'storage',
    stages: 1,
    smoke: false,
    estimatedWeight: 18,
    description: 'Browser Storage Analyzer modal, 360x780 layout, 4 targeted cleanups & oversized photo upload compression',
    run: runStorageAnalyzerE2e,
  },
  {
    name: 'infinite-zoom',
    stages: 4,
    smoke: false,
    estimatedWeight: 60,
    description: 'Bidirectional local AI Infinite Zoom (in-place split, deep cutout, directional borders, guards, mobile)',
    run: runInfiniteZoomE2e,
  },
];

export function selectE2eSuites({ smoke = false, suites = [], shard = null } = {}) {
  let selected = E2E_SUITES;
  if (Array.isArray(suites) && suites.length > 0) {
    const requested = new Set(suites.map((s) => String(s).trim().toLowerCase()).filter(Boolean));
    const known = new Set(E2E_SUITES.map((s) => s.name));
    const unknown = [...requested].filter((name) => !known.has(name));
    if (unknown.length > 0) {
      throw new Error(
        `Unknown E2E suite(s): ${unknown.join(', ')}. Valid suites: ${E2E_SUITES.map((s) => s.name).join(', ')}`
      );
    }
    selected = E2E_SUITES.filter((s) => requested.has(s.name));
  } else if (smoke) {
    selected = E2E_SUITES.filter((s) => s.smoke);
  }

  if (shard && Number.isInteger(shard.index) && Number.isInteger(shard.total) && shard.total > 1) {
    // Weight-balanced greedy LPT assignment so every shard finishes in similar wall-clock time
    const ordered = [...selected].sort((a, b) => b.estimatedWeight - a.estimatedWeight);
    const buckets = Array.from({ length: shard.total }, () => ({ weight: 0, items: [] }));
    for (const suite of ordered) {
      buckets.sort((a, b) => a.weight - b.weight);
      buckets[0].items.push(suite);
      buckets[0].weight += suite.estimatedWeight;
    }
    const chosen = new Set(buckets[shard.index - 1]?.items.map((s) => s.name) || []);
    selected = selected.filter((s) => chosen.has(s.name));
  }

  return selected;
}

export function resolveChromiumExecutablePath() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }
  try {
    const bundled = chromium.executablePath();
    if (bundled && fs.existsSync(bundled)) {
      return bundled;
    }
  } catch {
    // Fall through to system browser discovery
  }
  if (fs.existsSync('/usr/bin/chromium')) return '/usr/bin/chromium';
  if (fs.existsSync('/usr/bin/google-chrome')) return '/usr/bin/google-chrome';
  return undefined;
}

export async function runBrowserBasicsSuite({
  projectRoot,
  webPkgJson,
  explicitTestUrl = '',
  smoke = false,
  suites = [],
  workers = null,
  shard = null,
}) {
  const selectedSuites = selectE2eSuites({ smoke, suites, shard });
  const expectedStageTotal = selectedSuites.reduce((sum, s) => sum + s.stages, 0);
  if (selectedSuites.length === 0) {
    console.log('\nNo E2E suites matched the requested filter/shard; nothing to run.');
    return;
  }

  const cpuCount = Math.max(1, os.cpus()?.length || 1);
  const envWorkers = Number.parseInt(process.env.CAPY_E2E_WORKERS || '', 10);
  const requestedWorkers =
    Number.isInteger(workers) && workers > 0
      ? workers
      : Number.isInteger(envWorkers) && envWorkers > 0
        ? envWorkers
        : Math.min(4, cpuCount);
  const concurrency = Math.max(1, Math.min(requestedWorkers, selectedSuites.length));

  const modeLabel = smoke
    ? 'Smoke'
    : suites.length > 0
      ? `Targeted (${selectedSuites.map((s) => s.name).join(', ')})`
      : shard
        ? `Shard ${shard.index}/${shard.total}`
        : 'Full';

  console.log(
    `\n=== PART 2: ${modeLabel} Browser E2E Suite (${selectedSuites.length} suites, ${expectedStageTotal} stages, workers=${concurrency}) ===`
  );

  const suiteStartMs = Date.now();
  let previewServer = null;
  let BASE_URL = explicitTestUrl;
  if (!BASE_URL || !(await isServerListening(BASE_URL))) {
    const requestedPort = Number.parseInt(process.env.CAPY_TEST_PORT || '0', 10);
    const previewPort = Number.isInteger(requestedPort) && requestedPort > 0 ? requestedPort : 0;
    console.log(`Starting local Vite preview server from dist/ (port ${previewPort || 'ephemeral'})...`);
    previewServer = await preview({
      root: projectRoot,
      preview: { port: previewPort, strictPort: previewPort > 0, host: '0.0.0.0' },
      logLevel: 'error',
    });
    const addr = previewServer.httpServer?.address();
    const resolvedPort = typeof addr === 'object' && addr ? addr.port : previewPort;
    BASE_URL = `http://127.0.0.1:${resolvedPort}`;
    console.log(`Vite preview server listening at ${BASE_URL}`);
  } else {
    console.log(`Using existing server at ${BASE_URL}`);
  }

  const executablePath = resolveChromiumExecutablePath();
  const browserLaunchStart = Date.now();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-background-networking',
      '--disable-extensions',
      '--disable-default-apps',
      '--disable-sync',
      '--metrics-recording-only',
      '--no-first-run',
    ],
  });
  const browserLaunchSec = ((Date.now() - browserLaunchStart) / 1000).toFixed(1);
  console.log(`Chromium launched in ${browserLaunchSec}s${executablePath ? ` (${executablePath})` : ''}`);

  const consoleErrors = [];
  const attachErrorListeners = (p, label) => {
    p.on('pageerror', (err) => consoleErrors.push(`[${label}:pageerror] ${err.message}`));
  };

  const padE2e = (n) => String(n).padStart(2, '0');
  let completedStages = 0;
  let startedStages = 0;
  const suiteTimings = [];

  try {
    // Longest-estimated-suite-first scheduling minimizes parallel tail latency
    const queue = [...selectedSuites].sort((a, b) => b.estimatedWeight - a.estimatedWeight);
    let firstError = null;

    const runWorker = async () => {
      while (queue.length > 0 && !firstError) {
        const suite = queue.shift();
        if (!suite) break;
        const laneStartMs = Date.now();
        let laneStages = 0;
        let currentStageStartMs = laneStartMs;

        const logE2eStart = (label) => {
          startedStages += 1;
          laneStages += 1;
          currentStageStartMs = Date.now();
          const idx = startedStages;
          console.log(`[E2E ${padE2e(idx)}/${padE2e(expectedStageTotal)}] [${suite.name}] ${label}`);
        };
        const logE2ePass = (label) => {
          completedStages += 1;
          const dtSec = ((Date.now() - currentStageStartMs) / 1000).toFixed(1);
          console.log(
            `   PASS [${suite.name}] (${dtSec}s, ${completedStages}/${expectedStageTotal}): ${label}`
          );
        };

        const ctx = {
          browser,
          BASE_URL,
          projectRoot,
          webPkgJson,
          consoleErrors,
          attachErrorListeners: (p, lbl) => attachErrorListeners(p, `${suite.name}:${lbl}`),
          logE2eStart,
          logE2ePass,
        };

        try {
          await suite.run(ctx);
          assert.equal(
            laneStages,
            suite.stages,
            `Suite "${suite.name}" expected ${suite.stages} stage(s), executed ${laneStages}`
          );
          suiteTimings.push({
            name: suite.name,
            stages: suite.stages,
            durationSec: (Date.now() - laneStartMs) / 1000,
          });
        } catch (err) {
          const wrapped =
            err instanceof Error
              ? new Error(`[E2E suite "${suite.name}"] ${err.message}`, { cause: err })
              : new Error(`[E2E suite "${suite.name}"] ${String(err)}`);
          if (!firstError) firstError = wrapped;
          throw wrapped;
        }
      }
    };

    const workerPromises = Array.from({ length: concurrency }, () => runWorker());
    await Promise.all(workerPromises);

    assert.equal(
      completedStages,
      expectedStageTotal,
      `Expected ${expectedStageTotal} E2E test stages to pass, completed ${completedStages}`
    );
    assert.equal(consoleErrors.length, 0, `Unexpected page errors: ${consoleErrors.join('; ')}`);

    const wallSec = ((Date.now() - suiteStartMs) / 1000).toFixed(1);
    const timingSummary = [...suiteTimings]
      .sort((a, b) => b.durationSec - a.durationSec)
      .map((t) => `${t.name}=${t.durationSec.toFixed(1)}s`)
      .join(', ');
    console.log(`\nE2E Timing Summary (wall=${wallSec}s, workers=${concurrency}): ${timingSummary}`);
    console.log(
      `ALL ${expectedStageTotal} ${modeLabel.toUpperCase()} E2E BROWSER STAGES PASSED!\n`
    );
  } finally {
    await browser.close();
    if (previewServer) {
      await new Promise((resolve) => previewServer.httpServer.close(resolve));
    }
  }
}
