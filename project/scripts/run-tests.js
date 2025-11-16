#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative } from 'node:path';
import { readdir } from 'node:fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const workspaceRoot = resolve(__dirname, '..');
const configFile = resolve(workspaceRoot, 'playwright.config.js');
const testsRoot = resolve(workspaceRoot, 'tests');

const NODE_TEST_PATTERN = /\.(?:spec|test)\.(?:cjs|mjs|js)$/i;

async function collectNodeTests(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectNodeTests(fullPath)));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (!NODE_TEST_PATTERN.test(entry.name)) {
      continue;
    }
    if (entry.name.includes('.pw.')) {
      continue;
    }
    files.push(relative(workspaceRoot, fullPath));
  }
  return files;
}

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
  let nodeTests = [];
  try {
    nodeTests = await collectNodeTests(testsRoot);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }

  if (nodeTests.length > 0) {
    nodeTests.sort((a, b) => a.localeCompare(b));
    const nodeTestCode = await run(process.execPath, ['--test', ...nodeTests]);
    if (nodeTestCode !== 0) {
      process.exit(nodeTestCode);
    }
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
