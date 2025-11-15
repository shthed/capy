#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const workspaceRoot = resolve(__dirname, '..');
const configFile = resolve(workspaceRoot, 'playwright.config.js');

const child = spawn('npx', ['playwright', 'test', `--config=${configFile}`], {
  cwd: workspaceRoot,
  stdio: 'inherit',
  shell: false,
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});
