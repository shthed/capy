/**
 * Unified Engine, Codec, Security, Workflow & Browser E2E Test Orchestrator.
 *
 * Usage:
 *   npm run test:unit   -> node scripts/test.mjs --unit   (Part 1: headless Vite SSR unit suite)
 *   npm test            -> node scripts/test.mjs          (Part 1 + Part 2: 24 sequential Chromium E2E stages)
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

import { runReleaseSafetyHardeningTests } from './release-safety-hardening.test.mjs';
import { runStorageGatewayTests } from './storage-gateway.test.mjs';
import { runStorageAnalyzerTests } from './storage-analyzer.test.mjs';
import { runProviderDomainHardeningTests } from './provider-domain-hardening.test.mjs';
import { runSettingsDecompositionTests } from './settings-decomposition.test.mjs';
import { runWorkerCoopSecurityTests } from './worker-coop-security.test.mjs';
import { runEngineCanvasPerfTests } from './engine-canvas-perf.test.mjs';
import { runAppHooksQuickwinTests } from './app-hooks-quickwin.test.mjs';

import { runBrowserBasicsSuite } from './tests/e2e/runner.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const EXPLICIT_TEST_URL = (process.env.CAPY_TEST_URL || '').trim().replace(/\/+$/, '');
const webPkgJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));

async function runCodecAndEngineTests() {
  console.log('=== PART 1: Unified Engine, Codec, Relay, Security & Workflow Unit Suite ===');
  const unitPublicTotal = 11;
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
    logUnitPass(
      '.changelog fragments, compile-changelog.mjs, StorageNamespace, UserSettings, FeatureOffersService, StorageService, Storage Gateway, Browser Storage Analyzer, Provider Domain Hardening, SettingsModal Decomposition, Worker Co-op Security, Engine/Canvas Perf, App Hooks Quick-Win & M1 release safety hardening verified.'
    );

    await runByocCloudSyncTests(ctx);

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

const UNIT_ONLY = process.argv.includes('--unit');

async function main() {
  await runCodecAndEngineTests();
  if (UNIT_ONLY) {
    console.log('\n--unit mode complete (skipped Chromium E2E suite).');
    return;
  }
  await runBrowserBasicsSuite({
    projectRoot,
    webPkgJson,
    explicitTestUrl: EXPLICIT_TEST_URL,
  });
}

main().catch((err) => {
  console.error('\nTEST SUITE FAILED:', err);
  process.exit(1);
});
