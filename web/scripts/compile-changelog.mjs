#!/usr/bin/env node
/**
 * Lane A `.changelog/*.md` fragment compiler & Release Channel promoter.
 *
 * Usage:
 *   node scripts/compile-changelog.mjs [--promote] [--date YYYY-MM-DD] [--pr-map '{"slug":495}'] [--repo-root <dir>] [--dry-run]
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseChangelogFragment, validateChangelogChannelOrder } from './sanity.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(__dirname, '../..');
const BUMP_RANK = { patch: 1, minor: 2, major: 3 };
const REPO_URL = 'https://github.com/shthed/capy';

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function computeNextSemVer(currentVersion, bump) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(currentVersion || '').trim());
  assert.ok(match, `Invalid SemVer version: ${currentVersion}`);
  let major = Number(match[1]);
  let minor = Number(match[2]);
  let patch = Number(match[3]);

  const normalizedBump = String(bump || '').toLowerCase();
  if (normalizedBump === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (normalizedBump === 'minor') {
    minor += 1;
    patch = 0;
  } else if (normalizedBump === 'patch') {
    patch += 1;
  } else {
    throw new Error(`Invalid bump type "${bump}". Expected patch, minor, or major.`);
  }

  assert.equal(minor >= 0 && minor <= 99, true, `MINOR overflow (${minor}) exceeds Android versionCode capacity (0..99)`);
  assert.equal(patch >= 0 && patch <= 99, true, `PATCH overflow (${patch}) exceeds Android versionCode capacity (0..99)`);

  const version = `${major}.${minor}.${patch}`;
  const versionCode = major * 10000 + minor * 100 + patch;
  return { major, minor, patch, version, versionCode };
}

export function pickHighestBump(bumps) {
  let best = 'patch';
  let bestRank = 0;
  for (const b of bumps) {
    const normalized = String(b || '').toLowerCase();
    const rank = BUMP_RANK[normalized] || 0;
    assert.ok(rank > 0, `Unsupported bump "${b}"`);
    if (rank > bestRank) {
      best = normalized;
      bestRank = rank;
    }
  }
  return best;
}

export function resolvePrNumberForFragment({ fragment, filename, slug, prMap = {}, repoRoot }) {
  const fromMap = prMap[filename] ?? prMap[slug];
  if (fromMap !== undefined && fromMap !== null) {
    const num = Number(fromMap);
    assert.ok(Number.isInteger(num) && num > 0, `Invalid PR mapping for ${filename}: ${fromMap}`);
    return num;
  }

  if (fragment.pr !== null && fragment.pr !== undefined) {
    assert.ok(Number.isInteger(fragment.pr) && fragment.pr > 0, `Invalid fragment pr: ${fragment.pr}`);
    return fragment.pr;
  }

  try {
    const subject = execFileSync(
      'git',
      ['-C', repoRoot, 'log', '-n', '1', '--format=%s', '--', `.changelog/${filename}`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
    const prMatch = /\(#(\d+)\)/.exec(subject) || /#(\d+)\b/.exec(subject);
    if (prMatch) {
      return Number(prMatch[1]);
    }
  } catch {
    // Ignore git invocation failure when outside a git repo or uncommitted fixture
  }

  throw new Error(
    `Unable to resolve PR number for .changelog/${filename}. Add "pr: <num>" in frontmatter or pass --pr-map.`
  );
}

export function removeTaskSectionsFromTodo(todoText, taskIds) {
  if (!taskIds || taskIds.length === 0) return todoText;
  let updated = String(todoText || '').replace(/\r\n/g, '\n');

  for (const rawTaskId of taskIds) {
    const taskId = String(rawTaskId || '').trim();
    if (!taskId) continue;
    const lines = updated.split('\n');
    const out = [];
    const headerRe = new RegExp(`^###\\s+${escapeRegExp(taskId)}(?:[:\\s]|$)`, 'i');
    let skipping = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!skipping && headerRe.test(line)) {
        skipping = true;
        continue;
      }
      if (skipping) {
        if (/^###\s+/.test(line) || /^##\s+/.test(line) || /^---\s*$/.test(line)) {
          skipping = false;
          out.push(line);
        }
        continue;
      }
      out.push(line);
    }

    updated = out.join('\n').replace(/\n{3,}/g, '\n\n');
  }

  return `${updated.trimEnd()}\n`;
}

function stripBetaTagFromLine(line) {
  if (!line.startsWith('### ')) return line;
  return line
    .replace(/\s+\(Production, Beta\)$/, ' (Production)')
    .replace(/\s+\(Beta\)$/, '');
}

function stripReleaseTagsFromLine(line) {
  if (!line.startsWith('### ')) return line;
  return line
    .replace(/\s+\(Production, Beta\)$/, '')
    .replace(/\s+\(Production\)$/, '')
    .replace(/\s+\(Beta\)$/, '');
}

function headingMatchesVersion(headingLine, semver) {
  const m = /^### (\d+)\.(\d+)(?:\.(\d+))? - \d{4}-\d{2}-\d{2}(?: \((Alpha|Beta|Production|Production, Beta)\))?$/.exec(
    headingLine
  );
  if (!m) return false;
  const parsedVer = m[3] !== undefined ? `${m[1]}.${m[2]}.${m[3]}` : `${m[1]}.${m[2]}`;
  const parts = semver.split('.');
  const shortVer = `${parts[0]}.${parts[1]}`;
  return parsedVer === semver || (m[3] === undefined && parsedVer === shortVer);
}

export function compileChangelog({
  repoRoot = DEFAULT_REPO_ROOT,
  promote = false,
  dateStr = new Date().toISOString().slice(0, 10),
  prMap = {},
  dryRun = false,
} = {}) {
  const root = path.resolve(repoRoot);
  assert.match(dateStr, /^\d{4}-\d{2}-\d{2}$/, `Invalid --date "${dateStr}", expected YYYY-MM-DD`);

  const pkgPath = path.join(root, 'web/package.json');
  const pkgRaw = fs.readFileSync(pkgPath, 'utf8');
  const pkg = JSON.parse(pkgRaw);
  let activeVersion = String(pkg.version || '').trim();
  const changelogPath = path.join(root, 'CHANGELOG.md');
  let changelogText = fs.readFileSync(changelogPath, 'utf8').replace(/\r\n/g, '\n');

  const fragmentsDir = path.join(root, '.changelog');
  const fragmentFiles = fs.existsSync(fragmentsDir)
    ? fs
        .readdirSync(fragmentsDir, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isFile() &&
            entry.name.toLowerCase().endsWith('.md') &&
            entry.name.toLowerCase() !== 'readme.md'
        )
        .map((entry) => entry.name)
        .sort()
    : [];

  const parsedFragments = fragmentFiles.map((filename) => {
    const fullPath = path.join(fragmentsDir, filename);
    const raw = fs.readFileSync(fullPath, 'utf8');
    const parsed = parseChangelogFragment(raw, `.changelog/${filename}`);
    const slug = filename.replace(/\.md$/i, '');
    const pr = resolvePrNumberForFragment({
      fragment: parsed,
      filename,
      slug,
      prMap,
      repoRoot: root,
    });
    return { filename, fullPath, slug, ...parsed, pr };
  });

  let nextVerInfo = null;
  const removedTasks = [];

  if (parsedFragments.length > 0) {
    const highestBump = pickHighestBump(parsedFragments.map((f) => f.bump));
    nextVerInfo = computeNextSemVer(activeVersion, highestBump);
    activeVersion = nextVerInfo.version;

    const bullets = parsedFragments.map((f) => {
      const cleanedSummary = f.summary
        .replace(/\s+\[#\d+\]\(https:\/\/github\.com\/[^/\s]+\/capy\/pull\/\d+\)$/, '')
        .replace(/\s+#\d+$/, '')
        .trim();
      return `- ${cleanedSummary} [#${f.pr}](${REPO_URL}/pull/${f.pr})`;
    });

    const linesWithoutPriorBeta = changelogText.split('\n').map(stripBetaTagFromLine);
    const newSection = `### ${activeVersion} - ${dateStr} (Beta)\n\n${bullets.join('\n')}\n\n`;
    changelogText = `${newSection}${linesWithoutPriorBeta.join('\n').replace(/^\n+/, '')}`;

    for (const f of parsedFragments) {
      if (f.task) removedTasks.push(f.task);
    }
  }

  if (promote) {
    const lines = changelogText.split('\n');
    const topLine = lines[0] || '';
    assert.equal(
      topLine.startsWith('### '),
      true,
      `CHANGELOG.md must start with a ### heading to promote (got "${topLine}")`
    );
    assert.equal(
      topLine.endsWith(' (Alpha)'),
      false,
      `Cannot promote an (Alpha) CHANGELOG heading to Production: "${topLine}"`
    );
    assert.equal(
      headingMatchesVersion(topLine, activeVersion),
      true,
      `Top CHANGELOG heading "${topLine}" must match web/package.json version ${activeVersion}`
    );

    const strippedLines = lines.map(stripReleaseTagsFromLine);
    strippedLines[0] = `${strippedLines[0]} (Production, Beta)`;
    changelogText = strippedLines.join('\n');
  }

  validateChangelogChannelOrder(changelogText, activeVersion, { enforceChannelOrder: true });

  if (!dryRun) {
    if (nextVerInfo) {
      pkg.version = activeVersion;
      fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

      const versionTsPath = path.join(root, 'web/src/version.ts');
      if (fs.existsSync(versionTsPath)) {
        const versionTs = fs.readFileSync(versionTsPath, 'utf8');
        const staticVerRe = /(export const APP_VERSION(?:\s*:\s*string)?\s*=\s*['"])(\d+\.\d+\.\d+)(['"])/;
        if (staticVerRe.test(versionTs)) {
          fs.writeFileSync(versionTsPath, versionTs.replace(staticVerRe, `$1${activeVersion}$3`), 'utf8');
        }
      }

      const gradlePath = path.join(root, 'app/build.gradle.kts');
      if (fs.existsSync(gradlePath)) {
        let gradleText = fs.readFileSync(gradlePath, 'utf8');
        let gradleChanged = false;
        if (/(versionName\s*=\s*")\d+\.\d+\.\d+(")/.test(gradleText)) {
          gradleText = gradleText.replace(/(versionName\s*=\s*")\d+\.\d+\.\d+(")/, `$1${activeVersion}$2`);
          gradleChanged = true;
        }
        if (/(versionCode\s*=\s*)\d+/.test(gradleText)) {
          gradleText = gradleText.replace(/(versionCode\s*=\s*)\d+/, `$1${nextVerInfo.versionCode}`);
          gradleChanged = true;
        }
        if (gradleChanged) {
          fs.writeFileSync(gradlePath, gradleText, 'utf8');
        }
      }
    }

    if (parsedFragments.length > 0 || promote) {
      fs.writeFileSync(changelogPath, `${changelogText.trimEnd()}\n`, 'utf8');
    }

    const todoPath = path.join(root, 'TODO.md');
    if (removedTasks.length > 0 && fs.existsSync(todoPath)) {
      const prevTodo = fs.readFileSync(todoPath, 'utf8');
      const nextTodo = removeTaskSectionsFromTodo(prevTodo, removedTasks);
      if (nextTodo !== prevTodo) {
        fs.writeFileSync(todoPath, nextTodo, 'utf8');
      }
    }

    for (const f of parsedFragments) {
      fs.rmSync(f.fullPath, { force: true });
    }
  }

  return {
    version: activeVersion,
    compiledCount: parsedFragments.length,
    promoted: Boolean(promote),
    removedTasks,
    changelogText,
  };
}

function parseCliArgs(argv) {
  const opts = {
    promote: false,
    dryRun: false,
    repoRoot: DEFAULT_REPO_ROOT,
    dateStr: new Date().toISOString().slice(0, 10),
    prMap: {},
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--promote') {
      opts.promote = true;
    } else if (arg === '--dry-run') {
      opts.dryRun = true;
    } else if (arg === '--repo-root' && i + 1 < argv.length) {
      opts.repoRoot = path.resolve(argv[++i]);
    } else if (arg === '--date' && i + 1 < argv.length) {
      opts.dateStr = argv[++i];
    } else if (arg === '--pr-map' && i + 1 < argv.length) {
      const raw = argv[++i];
      opts.prMap = raw.startsWith('{') ? JSON.parse(raw) : JSON.parse(fs.readFileSync(path.resolve(raw), 'utf8'));
    }
  }
  return opts;
}

const isCliEntry = Boolean(
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
);

if (isCliEntry) {
  const opts = parseCliArgs(process.argv.slice(2));
  const res = compileChangelog(opts);
  console.log(
    `[changelog:compile] version=${res.version} compiled=${res.compiledCount} promoted=${res.promoted} removedTasks=${res.removedTasks.length}`
  );
}
