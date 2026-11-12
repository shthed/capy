#!/usr/bin/env node
/**
 * Fast (< 2s) pure-Node repository sanity gate (`npm run test:sanity`).
 *
 * Verifies without starting Vite or Chromium:
 * 1. `web/package.json` SemVer (`MAJOR.MINOR.PATCH`), `version.ts`, and `app/build.gradle.kts` formula parity.
 * 2. `CHANGELOG.md` compact mobile-first contract, channel marker invariants, and PR bullet links.
 * 3. Markdown hygiene across all repository `.md` files (zero emojis, zero ASCII/Unicode box-drawing art,
 *    zero >=3-column wide tables, and zero broken relative intra-repo file links).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(__dirname, '../..');

const SKIP_DIRS = new Set([
  '.git',
  '.agents',
  '.kotlin',
  '.artifacts',
  '.idea',
  '.vscode',
  'inspect',
  'project',
  'node_modules',
  'dist',
  '.wrangler',
  '.gradle',
  'build',
]);

function collectMarkdownFiles(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectMarkdownFiles(fullPath, out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      out.push(fullPath);
    }
  }
  return out;
}

export function runSanityChecks({ repoRoot = DEFAULT_REPO_ROOT } = {}) {
  const t0 = performance.now();
  const root = path.resolve(repoRoot);

  // 1. SemVer & Android versionCode parity
  const webPkgPath = path.join(root, 'web/package.json');
  const pkg = JSON.parse(fs.readFileSync(webPkgPath, 'utf8'));
  const semverMatch = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(pkg.version || '').trim());
  assert.ok(semverMatch, `Invalid web/package.json version: ${pkg.version}`);
  const major = Number(semverMatch[1]);
  const minor = Number(semverMatch[2]);
  const patch = Number(semverMatch[3]);
  assert.equal(minor >= 0 && minor <= 99, true, `MINOR out of [0..99]: ${minor}`);
  assert.equal(patch >= 0 && patch <= 99, true, `PATCH out of [0..99]: ${patch}`);
  const versionCode = major * 10000 + minor * 100 + patch;
  assert.equal(versionCode > 0, true);

  const versionTs = fs.readFileSync(path.join(root, 'web/src/version.ts'), 'utf8');
  assert.equal(
    versionTs.includes('major * 10000 + minor * 100 + patch'),
    true,
    'web/src/version.ts must compute major * 10000 + minor * 100 + patch'
  );

  const gradleKts = fs.readFileSync(path.join(root, 'app/build.gradle.kts'), 'utf8');
  assert.equal(
    gradleKts.includes('(verMajor * 10000) + (verMinor * 100) + verPatch'),
    true,
    'app/build.gradle.kts must compute (verMajor * 10000) + (verMinor * 100) + verPatch'
  );

  // 2. CHANGELOG.md contract
  const changelogPath = path.join(root, 'CHANGELOG.md');
  const changelogText = fs.readFileSync(changelogPath, 'utf8');
  assert.equal(
    changelogText.startsWith('### '),
    true,
    'CHANGELOG.md must start on line 1 with ### heading'
  );
  assert.equal(
    /^#{1,2}\s+/m.test(changelogText),
    false,
    'CHANGELOG.md must not contain # or ## headings'
  );
  assert.equal(
    /^[ \t]+-\s+/m.test(changelogText),
    false,
    'CHANGELOG.md must not contain indented sub-bullets'
  );
  assert.equal(
    changelogText.includes('### 0.1.0 - '),
    true,
    'CHANGELOG.md must retain 0.1.0 history'
  );

  const escapedFull = pkg.version.replace(/\./g, '\\.');
  const escapedMajorMinor = `${major}\\.${minor}`;
  const currentHeadingRe = new RegExp(
    `^### (?:${escapedFull}|${escapedMajorMinor}) - \\d{4}-\\d{2}-\\d{2} \\((?:Alpha|Beta|Production|Production, Beta)\\)$`,
    'm'
  );
  assert.equal(
    currentHeadingRe.test(changelogText),
    true,
    `CHANGELOG.md missing active channel heading for ${pkg.version}`
  );

  const headingLines = changelogText.split('\n').filter((line) => line.startsWith('#'));
  let productionHeadingCount = 0;
  let betaHeadingCount = 0;
  let alphaHeadingCount = 0;
  for (const h of headingLines) {
    assert.match(
      h,
      /^### \d+\.\d+(?:\.\d+)? - \d{4}-\d{2}-\d{2}(?: \((?:Alpha|Beta|Production|Production, Beta)\))?$/,
      `Invalid CHANGELOG heading: ${h}`
    );
    if (h.endsWith('(Production)') || h.endsWith('(Production, Beta)')) productionHeadingCount++;
    if (h.endsWith('(Beta)') || h.endsWith('(Production, Beta)')) betaHeadingCount++;
    if (h.endsWith('(Alpha)')) alphaHeadingCount++;
  }
  assert.equal(
    productionHeadingCount,
    1,
    `Expected exactly 1 Production heading in CHANGELOG.md, got ${productionHeadingCount}`
  );
  assert.equal(
    betaHeadingCount <= 1,
    true,
    `Expected <= 1 Beta heading in CHANGELOG.md, got ${betaHeadingCount}`
  );
  assert.equal(
    alphaHeadingCount <= 1,
    true,
    `Expected <= 1 Alpha heading in CHANGELOG.md, got ${alphaHeadingCount}`
  );

  const bulletLines = changelogText.split('\n').filter((line) => line.startsWith('- '));
  assert.equal(bulletLines.length >= 398, true, `Expected >= 398 bullets, got ${bulletLines.length}`);
  const bulletRe = /\s(?:\[#\d+\]\(https:\/\/github\.com\/[^/\s]+\/capy\/pull\/\d+\)|#\d+)$/;
  for (const b of bulletLines) {
    assert.match(b, bulletRe, `Invalid CHANGELOG bullet suffix: ${b}`);
  }

  // 3. Markdown hygiene & portable relative links across all .md files
  const mdFiles = collectMarkdownFiles(root);
  assert.equal(mdFiles.length >= 10, true, 'Expected >= 10 repository .md files');

  for (const mdPath of mdFiles) {
    const relFile = path.relative(root, mdPath).replace(/\\/g, '/');
    const rawText = fs.readFileSync(mdPath, 'utf8');

    const boxMatch = rawText.match(/[\u2500-\u257F]/);
    assert.equal(
      boxMatch,
      null,
      `Forbidden box-drawing character in ${relFile}: U+${boxMatch ? boxMatch[0].codePointAt(0).toString(16).toUpperCase() : ''}`
    );

    const emojiMatch = rawText.match(/\p{Extended_Pictographic}/u);
    assert.equal(
      emojiMatch,
      null,
      `Forbidden emoji character in ${relFile}: U+${emojiMatch ? emojiMatch[0].codePointAt(0).toString(16).toUpperCase() : ''}`
    );

    const withoutFences = rawText.replace(/```[\s\S]*?```/g, (m) =>
      '\n'.repeat(m.split('\n').length - 1)
    );
    const lines = withoutFences.split('\n');
    for (let idx = 0; idx < lines.length; idx++) {
      const trimmed = lines[idx].trim();
      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        const masked = trimmed.replace(/`[^`]*`/g, 'CODE').replace(/\\\|/g, 'PIPE');
        const colCount = masked.slice(1, -1).split('|').length;
        assert.equal(
          colCount <= 2,
          true,
          `Wide >=3-column Markdown table (${colCount} cols) in ${relFile}:${idx + 1}`
        );
      }
    }

    const withoutInlineCode = withoutFences.replace(/`[^`\n]*`/g, '');
    const targets = [];
    for (const m of withoutInlineCode.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
      targets.push(m[1].trim());
    }
    for (const m of withoutInlineCode.matchAll(/<(?:img|a)\b[^>]*\b(?:src|href)=["']([^"']+)["']/gi)) {
      targets.push(m[1].trim());
    }

    for (const rawTarget of targets) {
      if (!rawTarget) continue;
      const cleanTarget = rawTarget.split(/\s+/)[0];
      assert.equal(
        cleanTarget.toLowerCase().startsWith('file:'),
        false,
        `Forbidden machine-local file:// link in ${relFile}: ${cleanTarget}`
      );
      if (
        cleanTarget.startsWith('http://') ||
        cleanTarget.startsWith('https://') ||
        cleanTarget.startsWith('mailto:') ||
        cleanTarget.startsWith('tel:') ||
        cleanTarget.startsWith('data:') ||
        cleanTarget.startsWith('#')
      ) {
        continue;
      }
      const pathPart = decodeURIComponent(cleanTarget.split('#')[0].split('?')[0]);
      if (!pathPart) continue;
      const resolvedTarget = path.resolve(path.dirname(mdPath), pathPart);
      assert.equal(
        fs.existsSync(resolvedTarget),
        true,
        `Broken relative link in ${relFile}: "${rawTarget}" -> ${resolvedTarget}`
      );
    }
  }

  const elapsedMs = performance.now() - t0;
  assert.equal(elapsedMs < 2000, true, `Sanity gate exceeded 2000ms budget (${elapsedMs.toFixed(1)}ms)`);
  return {
    version: pkg.version,
    versionCode,
    markdownFilesChecked: mdFiles.length,
    elapsedMs,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const res = runSanityChecks();
  console.log(
    `[sanity] OK v${res.version} (versionCode=${res.versionCode}, ${res.markdownFilesChecked} .md files) in ${res.elapsedMs.toFixed(1)}ms`
  );
}
