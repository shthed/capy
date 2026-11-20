#!/usr/bin/env node
/**
 * Clean-room public persona exporter for `capyboop/paint`.
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
  'AGENTS.md',
  'CAPYBOOP.md',
  'docs/ai',
  'web/scripts/rebrand-persona.mjs',
  '.github/workflows/publish-capyboop.yml',
  '.github/workflows/pr-review-gate.yml',
  '.github/workflows/open-pr.yml',
  '.github/workflows/open-issue.yml',
  '.github/workflows/sync-beta-from-main.yml',
  '.github/workflows/sync-agile-tracker.yml',
  '.github/workflows/regenerate-puzzles.yml',
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
  /shthed|hairy[\s_-]*dog[\s_-]*trumpet|381055\+|CAPYBOOP_SYNC_TOKEN|rebrand-persona|publish-capyboop|pr-review-gate|open-pr\.yml|open-issue\.yml|persona:capyboop|capy-dev-only|sync-beta-from-main|sync-agile-tracker|regenerate-puzzles|dependabot\.ya?ml|AGENTS\.md|CAPYBOOP\.md|docs\/ai(?:\/|$|\b)|\.agents\b|antigravity|conversation:\/\/|\bgemini\b|MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API|\bclaude\b|\bcodex\b|\bchatgpt\b|\bcopilot\b|pr[_ -]?readiness|clean[- ]room|\bWHITEBOARD\b|\/(?:grill-me|teamwork|goal|plan)\b|automation\/|ai\s+contributors?|bot[- ]authored|owner\s+directive|review:ai-approved|ai[- ]approved|ai[- ]agent|coding[- ]agent|capyboop\/capy/i;

export function stripDevOnlyBlocks(content) {
  return content
    .replace(/\n?<!-- capy-dev-only:start -->[\s\S]*?<!-- capy-dev-only:end -->\n?/g, '\n')
    .replace(/\n?\/\* capy-dev-only:start \*\/[\s\S]*?\/\* capy-dev-only:end \*\/\n?/g, '\n');
}

export function transformPersonaContent(content) {
  return stripDevOnlyBlocks(content)
    .replace(/\s*\|\s*\[`?(?:AGENTS|CAPYBOOP)\.md`?\]\(\.\/(?:AGENTS|CAPYBOOP)\.md(?:#[^)\s]*)?\)/g, '')
    .replace(/\[`?(?:AGENTS|CAPYBOOP)\.md`?\]\(\.\/(?:AGENTS|CAPYBOOP)\.md(?:#[^)\s]*)?\)\s*\|\s*/g, '')
    .replace(/\[([^\[\]\r\n]+)\]\(\.\/(?:AGENTS|CAPYBOOP)\.md(?:#[^)\s]*)?\)/g, '$1')
    .replace(/\s*\|\s*\[([^\[\]\r\n]+)\]\((?:\.\/)?docs\/ai(?:\/[^)\s]*)?\)/g, '')
    .replace(/\[([^\[\]\r\n]+)\]\((?:\.\/)?docs\/ai(?:\/[^)\s]*)?\)\s*\|\s*/g, '')
    .replace(/\[([^\[\]\r\n]+)\]\((?:\.\/)?docs\/ai(?:\/[^)\s]*)?\)/g, '$1')
    .replace(
      /\[([^\[\]\r\n]+)\]\((?:https:\/\/github\.com\/(?:shthed\/capy\/(?:pull|issues|milestone)\/\d+|capyboop\/(?:capy|paint)\/(?:(?:pull|milestone)\/\d+|issues\/(?!(?:2|3|4|5)(?:[/?#)]|$))\d+))|(?:\.\.\/){2,}(?:pull|issues|milestone)\/\d+)(?:[/?#][^\s)]*)?\)/g,
      '$1'
    )
    .replace(
      /https:\/\/(?:shthed|capyboop)\.github\.io\/capy\/(?:alpha|PR|pull)\/\d+\/?/g,
      'https://capypaint.com/'
    )
    .replaceAll('https://github.com/shthed/capy', 'https://github.com/capyboop/paint')
    .replaceAll('github.com/shthed/capy', 'github.com/capyboop/paint')
    .replaceAll('github.com/shthed', 'github.com/capyboop')
    .replaceAll('https://shthed.github.io/capy', 'https://capyboop.github.io/capy')
    .replaceAll('shthed.github.io', 'capyboop.github.io')
    .replaceAll('shthed/capy', 'capyboop/paint')
    .replace(/capyboop\/capy/gi, 'capyboop/paint')
    .replace(/shthed/gi, (match) =>
      match === match.toUpperCase()
        ? 'CAPYBOOP'
        : match[0] === match[0].toUpperCase()
          ? 'Capyboop'
          : 'capyboop'
    );
}

export function sanitizeCommitMessage(rawMessage, { fallback = null } = {}) {
  const firstLine =
    String(rawMessage || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) || 'Update Capy Paint';

  const withoutPrSuffix = firstLine.replace(/\s*\(#\d+\)\s*$/, '').trim();
  const scrubbed = transformPersonaContent(withoutPrSuffix)
    .replace(/pr-review-gate/gi, 'review workflow')
    .replace(/publish-capyboop/gi, 'release mirror')
    .replace(/rebrand-persona/gi, 'export script')
    .replace(/open-pr\.yml|open-issue\.yml/gi, 'GitHub workflow')
    .replace(/sync-beta-from-main/gi, 'branch sync')
    .replace(/sync-agile-tracker/gi, 'roadmap sync')
    .replace(/regenerate-puzzles(?:\.yml)?/gi, 'asset generation')
    .replace(/persona:capyboop/gi, 'export check')
    .replace(/capy-dev-only/gi, 'internal-only')
    .replace(/dependabot\.ya?ml/gi, 'dependency config')
    .replace(/CAPYBOOP_SYNC_TOKEN/gi, 'mirror token')
    .replace(/AGENTS\.md|CAPYBOOP\.md|docs\/ai(?:\/[^\s,)]*)?/gi, 'project docs')
    .replace(/\.agents\/environment\.json|\.agents\/[^\s,)]*|\.agents\b/gi, 'dev environment config')
    .replace(/antigravity/gi, 'dev environment')
    .replace(/conversation:\/\/[^\s)]*/gi, 'session link')
    .replace(/MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API/gi, 'legacy capability')
    .replace(/GEMINI_API_KEY/gi, 'CI_API_KEY')
    .replace(/\bgemini(?:\s+[\d.]+\s*(?:carbon|argon|flash-lite|flash|pro)?)?\b/gi, 'CI')
    .replace(/\bclaude(?:\s+(?:opus|sonnet|haiku)(?:\s+[\d.]+)?)?\b/gi, 'automation')
    .replace(/\bcodex\//gi, 'feature/')
    .replace(/\bcodex\b/gi, 'feature')
    .replace(/automation\//gi, 'feature/')
    .replace(/\bchatgpt\b/gi, 'prompt')
    .replace(/\bgithub\s+copilot\b/gi, 'contributor')
    .replace(/\bcopilot\b/gi, 'contributor')
    .replace(/pr[_ -]?readiness(?:\s+(?:score|checklist))?/gi, 'PR checklist')
    .replace(/clean[- ]room/gi, 'public')
    .replace(/\bWHITEBOARD(?:\.md)?\b/gi, 'status notes')
    .replace(/\/(?:grill-me|teamwork|goal|plan)\b/gi, 'workflow')
    .replace(/ai\s+contributors?/gi, 'contributors')
    .replace(/bot[- ]authored/gi, 'automated')
    .replace(/owner\s+directive/gi, 'project guideline')
    .replace(/review:ai-approved|ai[- ]approved/gi, 'CI-approved')
    .replace(/ai[- ]agent|coding[- ]agent/gi, 'contributor')
    .replace(/hairy[\s_-]*dog[\s_-]*trumpet|381055\+/gi, 'capyboop')
    .replace(/\s+/g, ' ')
    .trim();
  const result = scrubbed.length > 0 ? scrubbed : 'Update Capy Paint';

  if (FORBIDDEN_PERSONA_REGEX.test(result)) {
    if (typeof fallback === 'string' && fallback.length > 0 && !FORBIDDEN_PERSONA_REGEX.test(fallback)) {
      return fallback;
    }
    throw new Error(`Sanitized commit message still contains forbidden persona identifier: ${result}`);
  }
  return result;
}

export function verifyLogFile(logPath) {
  const raw = fs.readFileSync(path.resolve(logPath)).toString('latin1');
  const match = raw.match(FORBIDDEN_PERSONA_REGEX);
  if (match) {
    return { clean: false, match: match[0] };
  }
  return { clean: true, match: null };
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
      const rel = path.relative(stageDir, fullPath).replace(/\\/g, '/');
      const pathMatch = rel.match(FORBIDDEN_PERSONA_REGEX);
      if (pathMatch) {
        throw new Error(`Forbidden persona token "${pathMatch[0]}" leaked in path ${rel}`);
      }
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
        let after = transformPersonaContent(before);
        if (relPath === '.gitignore') {
          after = after
            .replace(/\n?# AI Agent Coordination[^\n]*\n(?:!?\.agents\/[^\n]*\n?)*/gi, '\n')
            .replace(/^!?\.agents\/[^\n]*\n?/gm, '')
            .replace(/\n{3,}/g, '\n\n');
        } else if (relPath === '.github/workflows/cleanup-branches.yml') {
          after = after.replace(
            /(BRANCH_CLEANUP_PREFIXES:\s*')([^']*)(')/g,
            (_, pre, val, post) =>
              `${pre}${val
                .split(',')
                .filter((p) => p !== 'codex/' && p !== 'automation/')
                .join(',')}${post}`
          );
        }
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

const isCliEntrypoint = (() => {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  }
})();

if (isCliEntrypoint) {
  const args = process.argv.slice(2);

  if (args.includes('--sanitize-message')) {
    const stdinText = fs.readFileSync(0, 'utf8');
    process.stdout.write(`${sanitizeCommitMessage(stdinText)}\n`);
    process.exit(0);
  }

  const verifyLogIdx = args.indexOf('--verify-log');
  if (verifyLogIdx !== -1) {
    const logArg = args[verifyLogIdx + 1];
    if (!logArg || logArg.startsWith('--')) {
      console.error('--verify-log requires a file path argument.');
      process.exit(1);
    }
    const res = verifyLogFile(logArg);
    if (!res.clean) {
      console.error(`Forbidden persona token "${res.match}" detected in log file.`);
      process.exit(2);
    }
    console.log('Verified git log with zero forbidden persona tokens.');
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
