#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
let failures = 0;

const report = (message, isFailure, error) => {
  const symbol = isFailure ? '✗' : '✓';
  const output = `${symbol} ${message}`;
  if (isFailure) {
    console.error(output);
    if (error) {
      console.error(error instanceof Error ? error.message : String(error));
    }
  } else {
    console.log(output);
  }
};

const run = (name, fn) => {
  try {
    fn();
    report(name, false);
  } catch (error) {
    failures += 1;
    report(name, true, error);
  }
};

const requireFile = (relativePath) => {
  const fullPath = path.join(projectRoot, relativePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Expected ${relativePath} to exist at ${fullPath}`);
  }
  return fs.readFileSync(fullPath, 'utf8');
};

run('index.html exposes the app mount point', () => {
  const html = requireFile('index.html');
  if (!html.includes('id="app"')) {
    throw new Error('Missing #app element for the React app to mount.');
  }
});

run('window.capyGenerator API remains documented in index.html', () => {
  const html = requireFile('index.html');
  if (!html.includes('window.capyGenerator')) {
    throw new Error('window.capyGenerator assignment is missing from index.html.');
  }
});

run('Agent handbook records the test results section', () => {
  const handbook = requireFile('AGENTS.md');
  if (!handbook.includes('## Test Results')) {
    throw new Error('AGENTS.md must include the Test Results section.');
  }
});

if (failures > 0) {
  console.error(`\n${failures} test${failures === 1 ? '' : 's'} failed.`);
  process.exit(1);
}

console.log('\nAll tests passed.');
