#!/usr/bin/env node
/**
 * Release Safety & Hardening verification suite (M1).
 * Thin orchestrator delegating to modular domain suites under `web/scripts/tests/unit/`.
 * Can run standalone (`node scripts/release-safety-hardening.test.mjs`) or be imported by `test.mjs`.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runHardeningCspSecurityTests } from './tests/unit/hardening-csp-security.test.mjs';
import { runHardeningWorkerSwTests } from './tests/unit/hardening-worker-sw.test.mjs';
import { runHardeningCloudProvidersTests } from './tests/unit/hardening-cloud-providers.test.mjs';
import { runHardeningStorageCodecTests } from './tests/unit/hardening-storage-codec.test.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, '..');

export async function runReleaseSafetyHardeningTests(vite) {
  await runHardeningCspSecurityTests(vite);
  await runHardeningWorkerSwTests(vite);
  await runHardeningCloudProvidersTests(vite);
  await runHardeningStorageCodecTests(vite);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { createServer } = await import('vite');
  const vite = await createServer({
    root: WEB_ROOT,
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true },
    appType: 'custom',
    logLevel: 'silent',
  });
  try {
    await runReleaseSafetyHardeningTests(vite);
    console.log('[release-safety-hardening] OK: all M1 security & hardening tests passed.');
  } finally {
    await vite.close();
  }
}
