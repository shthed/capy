#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

function parseArgs(argv) {
  let pagesDir = '';
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--pages-dir' && i + 1 < argv.length) {
      pagesDir = argv[i + 1];
      i += 1;
    }
  }
  if (!pagesDir) {
    throw new Error('Missing required --pages-dir <path> argument');
  }
  return { pagesDir: path.resolve(pagesDir) };
}

export function generatePrManifest({ pagesDir }) {
  const resolved = path.resolve(pagesDir);
  const isPrSubdir = path.basename(resolved) === 'PR';
  const prDir = isPrSubdir ? resolved : path.join(resolved, 'PR');
  const rootPagesDir = isPrSubdir ? path.dirname(resolved) : resolved;

  fs.mkdirSync(prDir, { recursive: true });

  const entries = fs.readdirSync(prDir, { withFileTypes: true });
  const prs = entries
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => {
      const prNumber = Number(entry.name);
      const hasApk = fs.existsSync(path.join(prDir, entry.name, 'capy.apk'));
      return {
        number: prNumber,
        path: `/capy/PR/${entry.name}/`,
        hasApk,
      };
    })
    .sort((a, b) => b.number - a.number);

  const manifest = {
    prs,
    updatedAt: new Date().toISOString(),
  };

  const manifestPath = path.join(prDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  const prIndexSrc = path.join(__dirname, 'pr-index.html');
  const prIndexDest = path.join(prDir, 'index.html');
  if (fs.existsSync(prIndexSrc)) {
    fs.copyFileSync(prIndexSrc, prIndexDest);
  }

  const notFoundSrc = path.join(repoRoot, 'web', 'public', '404.html');
  const notFoundDest = path.join(rootPagesDir, '404.html');
  if (fs.existsSync(notFoundSrc) && !fs.existsSync(notFoundDest)) {
    fs.copyFileSync(notFoundSrc, notFoundDest);
  }

  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const args = parseArgs(process.argv.slice(2));
  const manifest = generatePrManifest(args);
  console.log(`Generated PR manifest with ${manifest.prs.length} open PR(s).`);
}
