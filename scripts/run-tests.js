#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const repoRoot = resolve(__dirname, '..');
const testFile = resolve(repoRoot, 'tests', 'ui-review.spec.js');
const configFile = resolve(repoRoot, 'playwright.config.js');

if (!existsSync(testFile) || !existsSync(configFile)) {
  console.log('Playwright smoke tests are currently paused. No Playwright assets found, skipping.');
  process.exit(0);
}

const child = spawn('npx', ['playwright', 'test', `--config=${configFile}`], {
  stdio: 'inherit',
  shell: false
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});
