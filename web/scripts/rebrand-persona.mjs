#!/usr/bin/env node
/**
 * Idempotent persona rebrand helper for the long-lived `capyboop/capy` production repository.
 * Replaces `github.com/shthed` -> `github.com/capyboop`, `shthed.github.io` -> `capyboop.github.io`,
 * and `shthed` project-owner attribution across documentation, license, and changelog files while
 * preserving backward-compatible multi-host Android App Link allowlists in `app/` and `worker/`.
 *
 * Usage:
 *   node web/scripts/rebrand-persona.mjs            # Apply in-place
 *   node web/scripts/rebrand-persona.mjs --dry-run  # Preview changed files without writing
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

const TARGET_FILES = [
  'AGENTS.md',
  'APP.md',
  'CHANGELOG.md',
  'CLOUD.md',
  'DEV.md',
  'LICENSE.md',
  'PUZZLE.md',
  'README.md',
  'ROADMAP.md',
  'TESTING.md',
  'TODO.md',
  'WEB.md',
  'web/public/privacy-policy.html',
];

export function transformPersonaContent(content) {
  return content
    .replaceAll('https://github.com/shthed/capy', 'https://github.com/capyboop/capy')
    .replaceAll('github.com/shthed/capy', 'github.com/capyboop/capy')
    .replaceAll('github.com/shthed', 'github.com/capyboop')
    .replaceAll('https://shthed.github.io/capy', 'https://capyboop.github.io/capy')
    .replaceAll('shthed.github.io', 'capyboop.github.io')
    .replaceAll('`shthed/capy`', '`capyboop/capy`')
    .replaceAll('(`shthed`)', '(`capyboop`)');
}

export function runPersonaRebrand({ repoRoot = REPO_ROOT, dryRun = false } = {}) {
  const modified = [];
  for (const relPath of TARGET_FILES) {
    const absPath = path.join(repoRoot, relPath);
    if (!fs.existsSync(absPath)) continue;
    const before = fs.readFileSync(absPath, 'utf8');
    const after = transformPersonaContent(before);
    if (after !== before) {
      modified.push(relPath);
      if (!dryRun) {
        fs.writeFileSync(absPath, after, 'utf8');
      }
    }
  }
  return modified;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dryRun = process.argv.includes('--dry-run');
  const modified = runPersonaRebrand({ dryRun });
  if (dryRun) {
    console.log(`[dry-run] ${modified.length} file(s) would be updated for capyboop persona:`, modified);
  } else {
    console.log(`Updated ${modified.length} file(s) for capyboop persona:`, modified);
  }
}
