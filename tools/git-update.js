#!/usr/bin/env node
const { spawnSync } = require('node:child_process');

const steps = [
  {
    title: 'Fetching remote refs',
    command: ['git', 'fetch', '--all', '--prune']
  },
  {
    title: 'Current branch status',
    command: ['git', 'status', '-sb']
  }
];

function runStep(step) {
  console.log(`\n==> ${step.title}\n`);
  const result = spawnSync(step.command[0], step.command.slice(1), {
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    console.error(`\nCommand failed: ${step.command.join(' ')}`);
    process.exit(result.status ?? 1);
  }
}

steps.forEach(runStep);

console.log('\nGit update complete.');
