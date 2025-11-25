#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const workspaceRoot = resolve(__dirname, '..');
const configFile = resolve(workspaceRoot, 'playwright.config.js');

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: workspaceRoot,
      stdio: 'inherit',
      shell: false,
    });
    child.on('exit', (code) => {
      resolve(code ?? 1);
    });
  });
}

async function main() {
  const nodeTestCode = await run(process.execPath, [
    '--test',
    'tests/generator.spec.js',
    'tests/smoothing.spec.mjs',
    'tests/service-worker-cache.spec.js',
    'tests/render-controller.spec.js',
    'tests/svg-renderer.spec.js',
  ]);
  if (nodeTestCode !== 0) {
    process.exit(nodeTestCode);
  }

  const playwrightCode = await run('npx', [
    'playwright',
    'test',
    `--config=${configFile}`,
  ]);
  process.exit(playwrightCode);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
