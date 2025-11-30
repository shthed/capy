#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
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

function warnSkipPlaywright(details) {
  console.warn(
    'Skipping Playwright tests: Chromium is not installed. Run `npm run setup:playwright` to enable the UI smoke suite.'
  );
  if (details) {
    console.warn(details);
  }
}

async function main() {
  let executablePath = '';
  try {
    executablePath = chromium.executablePath();
  } catch (error) {
    warnSkipPlaywright(error?.message);
    return;
  }

  const hasBrowser = executablePath && existsSync(executablePath);
  if (!hasBrowser) {
    const missingMessage = executablePath
      ? `Chromium executable not found at expected path: ${executablePath}`
      : 'Chromium executable path was not returned.';
    warnSkipPlaywright(missingMessage);
    return;
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
