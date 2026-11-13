#!/usr/bin/env node
/**
 * Clean-room public persona exporter for `capyboop/capy`.
 *
 * Exports a clean, standalone copy of the repository where `capyboop` is the sole
 * author and owner with zero trace of `shthed`, dev-only mirror/review workflows, or
 * rebrand scripts anywhere in the exported tree.
 *
 * Usage:
 *   node web/scripts/rebrand-persona.mjs --stage-dir /tmp/capyboop-stage
 *   node web/scripts/rebrand-persona.mjs --dry-run
 *   node web/scripts/rebrand-persona.mjs --verify-clean /tmp/capyboop-stage
 *   git log -1 --format=%s | node web/scripts/rebrand-persona.mjs --sanitize-message
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

export const DEV_ONLY_RELATIVE_PATHS = new Set([
  'web/scripts/rebrand-persona.mjs',
  '.github/workflows/publish-capyboop.yml',
  '.github/workflows/pr-review-gate.yml',
  '.github/workflows/open-pr.yml',
  '.github/workflows/sync-beta-from-main.yml',
  '.github/dependabot.yml',
]);

export const SKIP_COPY_DIR_NAMES = new Set([
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

const TEXT_EXTENSIONS = new Set([
  '.md',
  '.html',
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.jsonc',
  '.kt',
  '.kts',
  '.xml',
  '.yml',
  '.yaml',
  '.css',
  '.svg',
  '.txt',
  '.pro',
  '.properties',
  '.webmanifest',
]);

const TEXT_FILENAMES = new Set([
  '.gitignore',
  'gradlew',
  'gradlew.bat',
  'LICENSE',
  '_redirects',
  '_headers',
]);

export const FORBIDDEN_PERSONA_REGEX =
  /shthed|hairy\s*dog\s*trumpet|rebrand-persona|publish-capyboop|pr-review-gate|open-pr\.yml|persona:capyboop|capy-dev-only|sync-beta-from-main|dependabot\.ya?ml/i;

export function stripDevOnlyBlocks(content) {
  return content
    .replace(/\n?<!-- capy-dev-only:start -->[\s\S]*?<!-- capy-dev-only:end -->\n?/g, '\n')
    .replace(/\n?\/\* capy-dev-only:start \*\/[\s\S]*?\/\* capy-dev-only:end \*\/\n?/g, '\n');
}

export function transformPersonaContent(content) {
  return stripDevOnlyBlocks(content)
    .replace(
      /\[([^\]]+)\]\(https:\/\/github\.com\/(?:shthed|capyboop)\/capy\/(?:pull|issues|milestone)\/\d+(?:[/?#][^\s)]*)?\)/g,
      '$1'
    )
    .replace(
      /https:\/\/(?:shthed|capyboop)\.github\.io\/capy\/(?:alpha|PR|pull)\/\d+\/?/g,
      'https://capypaint.com/'
    )
    .replaceAll('https://github.com/shthed/capy', 'https://github.com/capyboop/capy')
    .replaceAll('github.com/shthed/capy', 'github.com/capyboop/capy')
    .replaceAll('github.com/shthed', 'github.com/capyboop')
    .replaceAll('https://shthed.github.io/capy', 'https://capyboop.github.io/capy')
    .replaceAll('shthed.github.io', 'capyboop.github.io')
    .replaceAll('shthed/capy', 'capyboop/capy')
    .replace(/shthed/gi, (match) => (match === match.toUpperCase() ? 'CAPYBOOP' : 'capyboop'));
}

export function sanitizeCommitMessage(rawMessage) {
  const firstLine =
    String(rawMessage || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) || 'Update Capy Paint';

  const withoutPrSuffix = firstLine.replace(/\s*\(#\d+\)\s*$/, '').trim();
  const sanitized = transformPersonaContent(withoutPrSuffix).replace(/\s+/g, ' ').trim();
  const result = sanitized.length > 0 ? sanitized : 'Update Capy Paint';

  if (FORBIDDEN_PERSONA_REGEX.test(result)) {
    throw new Error(`Sanitized commit message still contains forbidden persona identifier: ${result}`);
  }
  return result;
}

function isTextFile(filePath) {
  const base = path.basename(filePath);
  if (TEXT_FILENAMES.has(base)) return true;
  return TEXT_EXTENSIONS.has(path.extname(base).toLowerCase());
}

export function assertZeroSourcePersonaLeak(stageDir) {
  for (const devOnlyRel of DEV_ONLY_RELATIVE_PATHS) {
    const devOnlyAbs = path.join(stageDir, devOnlyRel);
    if (fs.existsSync(devOnlyAbs)) {
      throw new Error(`Dev-only file must not exist in clean public export: ${devOnlyRel}`);
    }
  }

  let scannedFiles = 0;
  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (SKIP_COPY_DIR_NAMES.has(entry.name)) continue;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      scannedFiles++;
      const rawBytes = fs.readFileSync(fullPath);
      const latin1 = rawBytes.toString('latin1');
      const match = latin1.match(FORBIDDEN_PERSONA_REGEX);
      if (match) {
        const rel = path.relative(stageDir, fullPath).replace(/\\/g, '/');
        throw new Error(`Forbidden persona token "${match[0]}" leaked in ${rel}`);
      }
    }
  }

  walk(stageDir);
  return scannedFiles;
}

export function exportCleanPersonaStage({ repoRoot = REPO_ROOT, stageDir }) {
  if (!stageDir) {
    throw new Error('exportCleanPersonaStage requires a target stageDir');
  }
  const resolvedRoot = path.resolve(repoRoot);
  const resolvedStage = path.resolve(stageDir);
  if (resolvedStage === resolvedRoot || resolvedStage.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error('stageDir must be outside repoRoot');
  }

  fs.rmSync(resolvedStage, { recursive: true, force: true });
  fs.mkdirSync(resolvedStage, { recursive: true });

  let filesCopied = 0;
  let filesTransformed = 0;

  function copyWalk(srcDir, dstDir) {
    fs.mkdirSync(dstDir, { recursive: true });
    const entries = fs.readdirSync(srcDir, { withFileTypes: true });
    for (const entry of entries) {
      if (SKIP_COPY_DIR_NAMES.has(entry.name)) continue;
      const srcPath = path.join(srcDir, entry.name);
      const relPath = path.relative(resolvedRoot, srcPath).replace(/\\/g, '/');
      if (DEV_ONLY_RELATIVE_PATHS.has(relPath)) continue;

      const dstPath = path.join(dstDir, entry.name);
      if (entry.isDirectory()) {
        copyWalk(srcPath, dstPath);
        continue;
      }
      if (!entry.isFile()) continue;

      filesCopied++;
      if (relPath === 'web/package.json') {
        const pkg = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
        if (pkg.scripts && 'persona:capyboop' in pkg.scripts) {
          delete pkg.scripts['persona:capyboop'];
        }
        const serialized = transformPersonaContent(`${JSON.stringify(pkg, null, 2)}\n`);
        fs.writeFileSync(dstPath, serialized, 'utf8');
        filesTransformed++;
        continue;
      }

      if (isTextFile(srcPath)) {
        const before = fs.readFileSync(srcPath, 'utf8');
        const after = transformPersonaContent(before);
        fs.writeFileSync(dstPath, after, { encoding: 'utf8', mode: fs.statSync(srcPath).mode });
        if (after !== before) filesTransformed++;
      } else {
        fs.copyFileSync(srcPath, dstPath);
      }
    }
  }

  copyWalk(resolvedRoot, resolvedStage);
  const verifiedFiles = assertZeroSourcePersonaLeak(resolvedStage);
  return { filesCopied, filesTransformed, verifiedFiles };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);

  if (args.includes('--sanitize-message')) {
    const stdinText = fs.readFileSync(0, 'utf8');
    process.stdout.write(`${sanitizeCommitMessage(stdinText)}\n`);
    process.exit(0);
  }

  const verifyIdx = args.indexOf('--verify-clean');
  if (verifyIdx !== -1 && args[verifyIdx + 1]) {
    const count = assertZeroSourcePersonaLeak(path.resolve(args[verifyIdx + 1]));
    console.log(`Verified ${count} clean files with zero source-persona leaks.`);
    process.exit(0);
  }

  const stageIdx = args.indexOf('--stage-dir');
  if (stageIdx !== -1 && args[stageIdx + 1]) {
    const targetDir = path.resolve(args[stageIdx + 1]);
    const stats = exportCleanPersonaStage({ stageDir: targetDir });
    console.log(
      `Exported clean capyboop repository to ${targetDir} (${stats.filesCopied} files copied, ${stats.filesTransformed} transformed, ${stats.verifiedFiles} verified zero-leak).`
    );
    process.exit(0);
  }

  const tmpStage = fs.mkdtempSync(path.join(os.tmpdir(), 'capyboop-dryrun-'));
  try {
    const stats = exportCleanPersonaStage({ stageDir: tmpStage });
    console.log(
      `[dry-run] Clean capyboop export verified (${stats.filesCopied} files copied, ${stats.filesTransformed} transformed, ${stats.verifiedFiles} verified zero-leak).`
    );
  } finally {
    fs.rmSync(tmpStage, { recursive: true, force: true });
  }
}
