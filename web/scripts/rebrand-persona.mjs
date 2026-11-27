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

// Includes retired dev-only paths (CLAUDE.md, GEMINI.md, capy.prompt.yml, sync-agile-tracker.yml,
// etc.) so historical commit replay stays zero-leak when scrubbing older commits.
export const DEV_ONLY_RELATIVE_PATHS = new Set([
  'AGENTS.md',
  'CAPYBOOP.md',
  'CLAUDE.md',
  'GEMINI.md',
  'capy.prompt.yml',
  'docs/ai',
  'web/scripts/rebrand-persona.mjs',
  'web/scripts/tests/unit/ci-dev-gates.test.mjs',
  'web/scripts/tests/unit/ci-review-gate.test.mjs',
  '.github/copilot-instructions.md',
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
  /shthed|hairy[\s_-]*dog[\s_-]*trumpet|381055\+|CAPYBOOP_SYNC_TOKEN|rebrand-persona|publish-capyboop|pr-review-gate|open-pr\.yml|open-issue\.yml|persona:capyboop|capy-dev-only|sync-beta-from-main|sync-agile-tracker|regenerate-puzzles|dependabot\.ya?ml|AGENTS\.md|CAPYBOOP\.md|CLAUDE\.md|GEMINI\.md|capy\.prompt\.yml|copilot-instructions\.md|docs\/ai(?:\/|$|\b)|\.agents\b|antigravity|conversation:\/\/|\bgemini\s+(?:3\.8|4(?:\s+(?:argon|carbon))?|2\.5(?:\s+(?:flash-lite|flash|pro))?)\b|GEMINI_API_KEY|MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API|\bclaude\b|\bcodex\b|\bchatgpt\b|\bcopilot\b|pr[_ -]?readiness|clean[- ]room|\bWHITEBOARD\b|\/(?:grill-me|teamwork|goal|plan)\b|automation\/|ai\s+contributors?|bot[- ]authored|owner\s+directive|review:ai-approved|ai[- ]approved|ai[- ]agent|coding[- ]agent|ai[- ]?dev\b|ai\s+reviews?\b|ai\s+approvals?\b|ai\s+marker\b|ai\s+auto[- ]?merge\b|dual\s+ai\b|ai\s+studio\s+dev\b|ai\s+github\s+actions\b|(?<!user-)\b(?:sub)?agents?\b|docs\(agents\)|update-agents|invoke_subagent|ci\(mirror\)|chore\(mirror\)|public\s+mirror|mirror\s+sync|mirror\s+retargeting|full\s+replay|open\s+bot\s+issue|free\s+bot|1-click\s+bot|bot\s+prs?\b|review[- ]gate|gate\s+readiness|\bpersonas?\b|issue\s*#607\b|capyboop\/capy/i;

export const FORBIDDEN_COMMIT_LOG_REGEX =
  /github-actions\[bot\]|#612\b|#607\b|during\s+replay|replay\s+full\b|readiness\s+checklist\b|ci\(gate\)|scrub\s+dev\s+tokens\s+in\s+historical\s+commit\s+messages/i;
export const FORBIDDEN_COMMIT_LOG_CASE_SENSITIVE_REGEX =
  /\bCAPYBOOP(?=\s*[,&]|\s+(?:and|doc|guide|playbook)\b)/;

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

function applyForbiddenTextReplacements(text) {
  return text
    .replace(/pr-review-gate/gi, 'review workflow')
    .replace(/publish-capyboop/gi, 'release sync')
    .replace(/rebrand-persona/gi, 'export script')
    .replace(/open-pr\.yml|open-issue\.yml/gi, 'GitHub workflow')
    .replace(/sync-beta-from-main/gi, 'branch sync')
    .replace(/sync-agile-tracker/gi, 'roadmap sync')
    .replace(/regenerate-puzzles(?:\.yml)?/gi, 'asset generation')
    .replace(/persona:capyboop/gi, 'export check')
    .replace(/capy-dev-only/gi, 'internal-only')
    .replace(/dependabot\.ya?ml/gi, 'dependency config')
    .replace(/CAPYBOOP_SYNC_TOKEN/gi, 'release token')
    .replace(/\.github\/copilot-instructions\.md|copilot-instructions\.md/gi, 'project docs')
    .replace(/\bcapy\.prompt\.yml\b/gi, 'workflow config')
    .replace(/AGENTS\.md|CAPYBOOP\.md|CLAUDE\.md|GEMINI\.md|docs\/ai(?:\/[^\s,)]*)?/gi, 'project docs')
    .replace(/\.agents\/environment\.json|\.agents\/[^\s,)]*|\.agents\b/gi, 'dev environment config')
    .replace(/antigravity/gi, 'dev environment')
    .replace(/conversation:\/\/[^\s)]*/gi, 'session link')
    .replace(/MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API/gi, 'legacy capability')
    .replace(/GEMINI_API_KEY/gi, 'CI_API_KEY')
    .replace(
      /\bgemini\s+(?:3\.8|4(?:\s+(?:argon|carbon))?|2\.5(?:\s+(?:flash-lite|flash|pro))?)\b/gi,
      'CI'
    )
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
    .replace(/ai\s+github\s+actions\b/gi, 'automated GitHub Actions')
    .replace(/ai[- ]?dev\b/gi, 'internal dev')
    .replace(/ai\s+reviews?\b/gi, 'CI review')
    .replace(/ai\s+approvals?\b/gi, (m) => (m.toLowerCase().endsWith('s') ? 'CI approvals' : 'CI approval'))
    .replace(/ai\s+marker\b/gi, 'CI marker')
    .replace(/ai\s+auto[- ]?merge\b/gi, 'CI auto-merge')
    .replace(/dual\s+ai\b/gi, 'automated')
    .replace(/ai\s+studio\s+dev\b/gi, 'studio')
    .replace(/docs\(agents\)/gi, 'docs')
    .replace(/update-agents/gi, 'update-docs')
    .replace(/invoke_subagent/gi, 'background task')
    .replace(/(?<!user-)\b(?:sub)?agents?\b/gi, 'contributor')
    .replace(/ci\(mirror\)/gi, 'ci(release)')
    .replace(/chore\(mirror\)/gi, 'chore(release)')
    .replace(/public\s+mirror/gi, 'public repository')
    .replace(/mirror\s+sync/gi, 'release sync')
    .replace(/mirror\s+retargeting/gi, 'repository alignment')
    .replace(/during\s+full\s+replay/gi, 'during release sync')
    .replace(/full\s+replay/gi, 'history sync')
    .replace(/open\s+bot\s+issue/gi, 'issue automation')
    .replace(/free\s+bot/gi, 'automated')
    .replace(/1-click\s+bot/gi, 'one-click')
    .replace(/bot\s+prs?\b/gi, (m) => (m.toLowerCase().endsWith('s') ? 'automated PRs' : 'automated PR'))
    .replace(/review[- ]gate/gi, 'review workflow')
    .replace(/gate\s+readiness/gi, 'PR checks')
    .replace(/\bpersonas?\b/gi, (m) => (m.toLowerCase().endsWith('s') ? 'releases' : 'release'))
    .replace(/\s*\(\s*issue\s*#607\s*\)/gi, '')
    .replace(/\bissue\s*#607\b/gi, 'cleanup')
    .replace(/hairy[\s_-]*dog[\s_-]*trumpet|381055\+/gi, 'capyboop');
}

function scrubHistoricalContent(content, relPath) {
  let out = content;
  if (relPath === 'web/metadata.json') {
    try {
      const parsed = JSON.parse(out);
      if (Array.isArray(parsed.majorCapabilities)) {
        parsed.majorCapabilities = parsed.majorCapabilities.filter(
          (cap) => cap !== 'MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API'
        );
      }
      out = `${JSON.stringify(parsed, null, 2)}\n`;
    } catch {
      // Fall through to text-level scrub if historical JSON is malformed
    }
  }
  out = applyForbiddenTextReplacements(out);
  if (FORBIDDEN_PERSONA_REGEX.test(out)) {
    out = out.replace(new RegExp(FORBIDDEN_PERSONA_REGEX.source, 'gi'), 'redacted');
  }
  return out;
}

function findForbiddenLogToken(text) {
  const personaMatch = text.match(FORBIDDEN_PERSONA_REGEX);
  if (personaMatch) return personaMatch[0];
  const logMatch = text.match(FORBIDDEN_COMMIT_LOG_REGEX);
  if (logMatch) return logMatch[0];
  const caseMatch = text.match(FORBIDDEN_COMMIT_LOG_CASE_SENSITIVE_REGEX);
  if (caseMatch) return caseMatch[0];
  return null;
}

export function sanitizeCommitMessage(rawMessage, { fallback = null } = {}) {
  const firstLine =
    String(rawMessage || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) || 'Update Capy Paint';

  const withoutPrSuffix = firstLine.replace(/\s*\(#\d+\)\s*$/, '').trim();
  const scrubbed = applyForbiddenTextReplacements(transformPersonaContent(withoutPrSuffix))
    .replace(new RegExp(FORBIDDEN_COMMIT_LOG_CASE_SENSITIVE_REGEX.source, 'g'), 'project docs')
    .replace(/github-actions\[bot\]/gi, 'CI automation')
    .replace(/replay\s+full(?:\s+(?:public|clean[- ]room))?\s+commit\s+history/gi, 'sync public release history')
    .replace(/replay\s+full\b/gi, 'sync')
    .replace(/during\s+replay/gi, 'during sync')
    .replace(/\bcompile\s+#612\b/gi, 'Compile')
    .replace(/#612\b/gi, 'release')
    .replace(/\s*\(\s*#607\s*\)/gi, '')
    .replace(/#607\b/gi, 'cleanup')
    .replace(/readiness\s+checklist\b/gi, 'PR checklist')
    .replace(/ci\(gate\)/gi, 'ci(checks)')
    .replace(/scrub\s+dev\s+tokens\s+in\s+historical\s+commit\s+messages/gi, 'normalize release commit history')
    .replace(/\s+/g, ' ')
    .trim();
  const result = scrubbed.length > 0 ? scrubbed : 'Update Capy Paint';

  if (findForbiddenLogToken(result)) {
    if (typeof fallback === 'string' && fallback.length > 0 && !findForbiddenLogToken(fallback)) {
      return fallback;
    }
    throw new Error(`Sanitized commit message still contains forbidden persona identifier: ${result}`);
  }
  return result;
}

export function verifyLogFile(logPath) {
  const raw = fs.readFileSync(path.resolve(logPath)).toString('latin1');
  const match = findForbiddenLogToken(raw);
  if (match) {
    return { clean: false, match };
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

export function exportCleanPersonaStage({ repoRoot = REPO_ROOT, stageDir, historicalScrub = false }) {
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
      if (historicalScrub && FORBIDDEN_PERSONA_REGEX.test(relPath)) continue;

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
        let serialized = transformPersonaContent(`${JSON.stringify(pkg, null, 2)}\n`);
        if (historicalScrub) {
          serialized = scrubHistoricalContent(serialized, relPath);
        }
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
        if (historicalScrub) {
          after = scrubHistoricalContent(after, relPath);
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
