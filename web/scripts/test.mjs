/**
 * Unified Engine, Codec, Security, Workflow & Browser E2E Test Orchestrator.
 *
 * Usage:
 *   npm run test:unit   -> node scripts/test.mjs --unit   (Part 1: headless Vite SSR unit suite)
 *   npm test            -> node scripts/test.mjs          (Part 1 + Part 2: 28 sequential Chromium E2E stages)
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

import { runEngineCodecTests } from './tests/unit/engine-codec.test.mjs';
import { runReleaseChangelogTests, runSanityChangelogTests } from './tests/unit/sanity-changelog.test.mjs';
import { runCiCleanupScriptsTests, runCiPagesWorkflowTests } from './tests/unit/ci-public-scripts.test.mjs';
import { runServicesGameplayTests } from './tests/unit/services-gameplay.test.mjs';
import { runCoopSharePwaTests } from './tests/unit/coop-share-pwa.test.mjs';
import { runCrdtNativeBridgeTests } from './tests/unit/crdt-native-bridge.test.mjs';
/* capy-dev-only:start */
import { runCiDevWorkflowTests, runRebrandPersonaTests } from './tests/unit/ci-dev-gates.test.mjs';
import { runCiReviewGateTests } from './tests/unit/ci-review-gate.test.mjs';
/* capy-dev-only:end */
import { runAndroidManifestTests } from './tests/unit/android-manifest.test.mjs';
import { runStorageDurabilityTests } from './tests/unit/storage-durability.test.mjs';
import { runByocCloudSyncTests } from './tests/unit/byoc-cloud-sync.test.mjs';
import { runInfiniteZoomUnitTests } from './tests/unit/infinite-zoom.test.mjs';

import { runReleaseSafetyHardeningTests } from './release-safety-hardening.test.mjs';
import { runStorageGatewayTests } from './storage-gateway.test.mjs';
import { runStorageAnalyzerTests } from './storage-analyzer.test.mjs';
import { runProviderDomainHardeningTests } from './provider-domain-hardening.test.mjs';
import { runSettingsDecompositionTests } from './settings-decomposition.test.mjs';
import { runWorkerCoopSecurityTests } from './worker-coop-security.test.mjs';
import { runEngineCanvasPerfTests } from './engine-canvas-perf.test.mjs';
import { runAppHooksQuickwinTests } from './app-hooks-quickwin.test.mjs';
import { runSessionRestorePipelineTests } from './session-restore-pipeline.test.mjs';
import { runUndoReplayHooksTests } from './undo-replay-hooks.test.mjs';
import { runCoopSessionHookTests } from './coop-session-hook.test.mjs';
import { runCloudSyncControllerHookTests } from './cloud-sync-controller-hook.test.mjs';
import { runTutorialSnapshotHooksTests } from './tutorial-snapshot-hooks.test.mjs';

import { E2E_SUITES, runBrowserBasicsSuite } from './tests/e2e/runner.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const EXPLICIT_TEST_URL = (process.env.CAPY_TEST_URL || '').trim().replace(/\/+$/, '');
const webPkgJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));

function parseCliArgs(argv) {
  let unitOnly = false;
  let e2eOnly = false;
  let smoke = false;
  let listSuites = false;
  let workers = null;
  let shard = null;
  const suites = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--unit') {
      unitOnly = true;
    } else if (arg === '--e2e' || arg === '--e2e-only') {
      e2eOnly = true;
    } else if (arg === '--smoke') {
      smoke = true;
    } else if (arg === '--list-suites') {
      listSuites = true;
    } else if (arg.startsWith('--suite=') || arg.startsWith('--only=')) {
      const raw = arg.slice(arg.indexOf('=') + 1);
      for (const item of raw.split(',')) {
        if (item.trim()) suites.push(item.trim());
      }
    } else if ((arg === '--suite' || arg === '--only') && argv[i + 1]) {
      for (const item of argv[++i].split(',')) {
        if (item.trim()) suites.push(item.trim());
      }
    } else if (arg.startsWith('--workers=')) {
      const n = Number.parseInt(arg.slice('--workers='.length), 10);
      if (!Number.isInteger(n) || n < 1) throw new Error(`Invalid --workers value: ${arg}`);
      workers = n;
    } else if (arg === '--workers' && argv[i + 1]) {
      const n = Number.parseInt(argv[++i], 10);
      if (!Number.isInteger(n) || n < 1) throw new Error(`Invalid --workers value: ${n}`);
      workers = n;
    } else if (arg.startsWith('--shard=')) {
      const raw = arg.slice('--shard='.length);
      const m = raw.match(/^(\d+)\/(\d+)$/);
      if (!m) throw new Error(`Invalid --shard format "${raw}" (expected i/n, e.g. 1/2)`);
      const index = Number.parseInt(m[1], 10);
      const total = Number.parseInt(m[2], 10);
      if (index < 1 || total < 1 || index > total) {
        throw new Error(`Invalid --shard bounds "${raw}" (require 1 <= i <= n)`);
      }
      shard = { index, total };
    } else if (arg === '--shard' && argv[i + 1]) {
      const raw = argv[++i];
      const m = raw.match(/^(\d+)\/(\d+)$/);
      if (!m) throw new Error(`Invalid --shard format "${raw}" (expected i/n, e.g. 1/2)`);
      const index = Number.parseInt(m[1], 10);
      const total = Number.parseInt(m[2], 10);
      if (index < 1 || total < 1 || index > total) {
        throw new Error(`Invalid --shard bounds "${raw}" (require 1 <= i <= n)`);
      }
      shard = { index, total };
    }
  }

  // Targeted E2E flags (--smoke, --suite, --shard) skip Part 1 unit tests unless --unit is also requested
  const hasTargetedE2eFlags = smoke || suites.length > 0 || shard !== null;
  if (hasTargetedE2eFlags && !unitOnly) {
    e2eOnly = true;
  }

  return { unitOnly, e2eOnly, smoke, suites, workers, shard, listSuites };
}

async function runCodecAndEngineTests() {
  console.log('=== PART 1: Unified Engine, Codec, Relay, Security & Workflow Unit Suite ===');
  const unitPublicTotal = 12;
  let unitDevTotal = 0;
  /* capy-dev-only:start */
  unitDevTotal = 5;
  /* capy-dev-only:end */
  const unitTotal = unitPublicTotal + unitDevTotal;
  const padUnit = (n) => String(n).padStart(2, '0');
  let unitStep = 0;
  const logUnitStart = (label) => {
    unitStep += 1;
    console.log(`[Unit ${padUnit(unitStep)}/${padUnit(unitTotal)}] ${label}`);
  };
  const logUnitPass = (label) => {
    console.log(`   PASS [Unit ${padUnit(unitStep)}/${padUnit(unitTotal)}]: ${label}`);
  };

  const vite = await createServer({
    root: projectRoot,
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true },
    appType: 'custom',
    logLevel: 'error',
  });

  const ctx = {
    vite,
    projectRoot,
    webPkgJson,
    logUnitStart,
    logUnitPass,
    shared: {},
    devShared: {},
  };

  try {
    await runEngineCodecTests(ctx);
    await runSanityChangelogTests(ctx);
    await runCiCleanupScriptsTests(ctx);
    await runServicesGameplayTests(ctx);
    await runCoopSharePwaTests(ctx);
    await runCrdtNativeBridgeTests(ctx);
    /* capy-dev-only:start */
    await runRebrandPersonaTests(ctx);
    await runCiReviewGateTests(ctx);
    await runCiDevWorkflowTests(ctx);
    /* capy-dev-only:end */
    await runAndroidManifestTests(ctx);
    await runCiPagesWorkflowTests(ctx);
    await runReleaseChangelogTests(ctx);

    await runStorageDurabilityTests(ctx);
    await runReleaseSafetyHardeningTests(vite);
    await runStorageGatewayTests(vite);
    await runStorageAnalyzerTests(vite);
    await runProviderDomainHardeningTests(vite);
    await runSettingsDecompositionTests(vite);
    await runWorkerCoopSecurityTests(vite);
    await runEngineCanvasPerfTests(vite);
    await runAppHooksQuickwinTests(vite);
    await runSessionRestorePipelineTests(vite);
    await runUndoReplayHooksTests(vite);
    await runCoopSessionHookTests(vite);
    await runCloudSyncControllerHookTests(vite);
    await runTutorialSnapshotHooksTests(vite);
    logUnitPass(
      '.changelog fragments, compile-changelog.mjs, StorageNamespace, UserSettings, FeatureOffersService, StorageService, Storage Gateway, Browser Storage Analyzer, Provider Domain Hardening, SettingsModal Decomposition, Worker Co-op Security, Engine/Canvas Perf, App Hooks Quick-Win, Session Restore Pipeline, Undo/Redo & Replay Controller Hooks, Co-op Session Hook, Cloud Sync Controller Hook, Tutorial/Viewport/Paint/Snapshot Hooks & M1 release safety hardening verified.'
    );

    await runByocCloudSyncTests(ctx);
    await runInfiniteZoomUnitTests(ctx);

    assert.equal(
      unitStep,
      unitTotal,
      `Expected ${unitTotal} unit test groups to run, executed ${unitStep}`
    );
    console.log(`\nALL ${unitTotal} UNIT SUITES PASSED!`);
  } finally {
    await vite.close();
  }
}

async function main() {
  const cli = parseCliArgs(process.argv.slice(2));
  if (cli.listSuites) {
    console.log('Available E2E suites (--suite=<csv> | --smoke):');
    for (const s of E2E_SUITES) {
      const tag = s.smoke ? ' [smoke]' : '';
      console.log(`  - ${s.name.padEnd(14)} (${s.stages} stage${s.stages === 1 ? '' : 's'})${tag}: ${s.description}`);
    }
    return;
  }

  if (!cli.e2eOnly) {
    await runCodecAndEngineTests();
  }
  if (cli.unitOnly) {
    console.log('\n--unit mode complete (skipped Chromium E2E suite).');
    return;
  }
  await runBrowserBasicsSuite({
    projectRoot,
    webPkgJson,
    explicitTestUrl: EXPLICIT_TEST_URL,
    smoke: cli.smoke,
    suites: cli.suites,
    workers: cli.workers,
    shard: cli.shard,
  });
}

main().catch((err) => {
  console.error('\nTEST SUITE FAILED:', err);
  process.exit(1);
});
