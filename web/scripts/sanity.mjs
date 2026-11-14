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

// M3B strict defaults:
const DEFAULT_REQUIRE_PROJECT_MD = true;
const DEFAULT_ENFORCE_CHANNEL_ORDER = true;
const DEFAULT_ENFORCE_EPIC_NAMING = true;
const DEFAULT_ENFORCE_PR_READINESS_SPEC = true;

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

function stripHtmlDevOnlyForSanity(text) {
  let out = text;
  /* capy-dev-only:start */
  out = out.replace(/<!-- capy-dev-only:start -->[\s\S]*?<!-- capy-dev-only:end -->/g, '');
  /* capy-dev-only:end */
  return out;
}

function compareSemverParts(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

export function validateChangelogChannelOrder(
  changelogText,
  packageVersion,
  { enforceChannelOrder = true } = {}
) {
  const pkgMatch = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(packageVersion || '').trim());
  assert.ok(pkgMatch, `Invalid web/package.json version: ${packageVersion}`);
  const pkgMajor = Number(pkgMatch[1]);
  const pkgMinor = Number(pkgMatch[2]);
  const pkgPatch = Number(pkgMatch[3]);
  const cleanPkgVersion = `${pkgMajor}.${pkgMinor}.${pkgPatch}`;

  const headingLines = String(changelogText || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => line.startsWith('#'));
  assert.equal(headingLines.length > 0, true, 'CHANGELOG.md must contain at least one ### heading');

  const headingRe =
    /^### (\d+)\.(\d+)(?:\.(\d+))? - (\d{4}-\d{2}-\d{2})(?: \((Alpha|Beta|Production|Production, Beta)\))?$/;

  let productionHeadingCount = 0;
  let betaHeadingCount = 0;
  let alphaHeadingCount = 0;
  const parsed = [];

  for (const line of headingLines) {
    const m = headingRe.exec(line);
    assert.ok(m, `Invalid CHANGELOG heading: ${line}`);
    const major = Number(m[1]);
    const minor = Number(m[2]);
    const hasPatch = m[3] !== undefined;
    const patch = hasPatch ? Number(m[3]) : 0;
    const versionLabel = hasPatch ? `${major}.${minor}.${patch}` : `${major}.${minor}`;
    const date = m[4];
    const tag = m[5] ?? null;

    if (tag === 'Production' || tag === 'Production, Beta') productionHeadingCount++;
    if (tag === 'Beta' || tag === 'Production, Beta') betaHeadingCount++;
    if (tag === 'Alpha') alphaHeadingCount++;

    parsed.push({ line, major, minor, patch, hasPatch, versionLabel, date, tag });
  }

  for (let i = 1; i < parsed.length; i++) {
    const prev = parsed[i - 1];
    const curr = parsed[i];
    assert.equal(
      compareSemverParts(curr, prev) < 0,
      true,
      `CHANGELOG headings must be strictly descending by version: "${prev.line}" before "${curr.line}"`
    );
    assert.equal(
      curr.date <= prev.date,
      true,
      `CHANGELOG headings must be non-increasing by date: "${prev.line}" (${prev.date}) before "${curr.line}" (${curr.date})`
    );
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

  const matchesPackageVersion = (entry) =>
    entry.versionLabel === cleanPkgVersion ||
    (!entry.hasPatch && entry.versionLabel === `${pkgMajor}.${pkgMinor}`);

  assert.equal(
    parsed.some((entry) => entry.tag !== null && matchesPackageVersion(entry)) &&
      matchesPackageVersion(parsed[0]),
    true,
    `CHANGELOG.md missing active channel heading for ${cleanPkgVersion}`
  );

  const alphaIdx = parsed.findIndex((h) => h.tag === 'Alpha');
  const betaIdx = parsed.findIndex((h) => h.tag === 'Beta' || h.tag === 'Production, Beta');
  const prodIdx = parsed.findIndex((h) => h.tag === 'Production' || h.tag === 'Production, Beta');

  if (enforceChannelOrder) {
    assert.notEqual(parsed[0].tag, null, `Top CHANGELOG heading must carry a channel tag: ${parsed[0].line}`);

    if (alphaIdx !== -1) {
      assert.equal(alphaIdx, 0, `Alpha heading must appear first when present: ${parsed[alphaIdx].line}`);
      assert.equal(
        alphaIdx < prodIdx,
        true,
        `Alpha heading must appear before Production heading (${parsed[alphaIdx].line} vs ${parsed[prodIdx].line})`
      );
      if (betaIdx !== -1) {
        assert.equal(
          alphaIdx < betaIdx,
          true,
          `Alpha heading must appear before Beta heading (${parsed[alphaIdx].line} vs ${parsed[betaIdx].line})`
        );
      }
    }

    if (betaIdx !== -1) {
      assert.equal(
        betaIdx <= prodIdx,
        true,
        `Beta heading must appear at or before Production heading (${parsed[betaIdx].line} vs ${parsed[prodIdx].line})`
      );
      if (alphaIdx === -1) {
        assert.equal(betaIdx, 0, `Beta heading must appear first when Alpha is absent: ${parsed[betaIdx].line}`);
      }
    }

    if (alphaIdx === -1 && betaIdx === -1) {
      assert.equal(prodIdx, 0, `Production heading must appear first when Alpha and Beta are absent: ${parsed[prodIdx].line}`);
    }

    for (let i = prodIdx + 1; i < parsed.length; i++) {
      assert.equal(
        parsed[i].tag,
        null,
        `CHANGELOG heading after Production must be untagged: ${parsed[i].line}`
      );
    }

    const activeHeadIdx = alphaIdx !== -1 ? alphaIdx : betaIdx !== -1 ? betaIdx : prodIdx;
    assert.equal(
      matchesPackageVersion(parsed[activeHeadIdx]),
      true,
      `Active channel heading "${parsed[activeHeadIdx].line}" must match package version ${cleanPkgVersion}`
    );
  }

  return {
    headingsCount: parsed.length,
    alphaIdx,
    betaIdx,
    prodIdx,
    activeVersion: parsed[0].versionLabel,
  };
}

export function validateEpicNaming(markdownText, relFile = 'markdown.md') {
  const hint = `Use [EPIC-N](https://github.com/<owner>/capy/issues/<num>) instead of #NNN for Epic issues in ${relFile}`;
  assert.equal(/#47[6-9]\b|#480\b/.test(markdownText), false, hint);
  assert.equal(
    /\[#\d+\]\(https:\/\/github\.com\/[^/\s]+\/capy\/issues\/\d+/.test(markdownText),
    false,
    hint
  );
  assert.equal(/\[EPIC-\d+\s*\(#\d+\)\]/i.test(markdownText), false, hint);
}

const URL_STRIP_RE = /https?:\/\/[^\s)>\]"']+/gi;
const MARKDOWN_NUMBERED_POINTS_BULLET_RE = /^[ \t]*-(?=[ \t]+\d+[ \t]+points?\b)/gm;
const LEGACY_PR_RUBRIC_RULES = [
  { label: 'legacy 5-Pillar phrasing', re: /\b5[- ]+pillars?\b/i },
  { label: 'legacy numbered Pillar item', re: /\bpillar\s+[1-9]\d*\b/i },
  { label: 'legacy Pillar breakdown phrasing', re: /\bpillars?\s+breakdown\b/i },
  { label: 'legacy Rubric phrasing', re: /\b(?:5[- ]*pillars?|pr|readiness)?\s*rubrics?\b/i },
  { label: 'legacy 5 x 20 scoring math', re: /\b5\s*[x×*]\s*20\b/i },
  {
    label: 'legacy 20 pts scoring unit',
    re: /(?<![a-zA-Z0-9_./-])[*`_]{0,3}20[*`_]{0,3}(?:-[ \t]*|\s*)(?:pts?|points?)\b/i,
  },
  {
    label: 'legacy -N point delta unit',
    re: /(?:^|[\s(`*"'])-[ \t]*(?:\d+|N)[*`]{0,2}[ \t]*(?:pts?|points?)\b/i,
    preprocess: (text) => text.replace(MARKDOWN_NUMBERED_POINTS_BULLET_RE, '*'),
  },
  {
    label: 'legacy /100 or /20 denominator',
    re: /(?:(?<![a-zA-Z0-9_./-])(?:\d+(?:\.\d+)?|<[a-zA-Z]+>|[NX])\s*|(?:^|[\s(`[*:,;>|]))\/\s*(?:100|20)\b(?![/])/i,
  },
];

const CHECKLIST_PERCENT_LINE_RE =
  /^(?:[-*]|\d+\.)\s+(?:\[[xX ]\]\s+)?[*`_]{0,4}(\d{1,3}(?:\.\d+)?)%[*`_]{0,4}(?=\s|[:\-—–,;])[\s:*`_\-—–,;]*[^\s:*`_\-—–,;]/;
const DETAILS_BLOCK_RE =
  /<details(?=[>\s])[^>]*>\s*<summary(?=[>\s])[^>]*>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/i;

function stripHtmlComments(text) {
  const str = String(text || '');
  const lastCloseIdx = str.lastIndexOf('-->');
  if (lastCloseIdx === -1) return str;
  const end = lastCloseIdx + 3;
  return `${str.slice(0, end).replace(/<!--[\s\S]*?-->/g, '')}${str.slice(end)}`;
}

function extractNonThresholdPercentages(text) {
  return [
    ...String(text || '').matchAll(
      /(?:^|[\s:(*`])(?<![<>≤≥]=?[\s*`]*)(\d{1,3}(?:\.\d+)?)%(?=$|[\s).,;:*`])/gm
    ),
  ];
}

export function validateNoLegacyPrRubric(text, relFile = 'document.md') {
  const withoutUrls = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(URL_STRIP_RE, 'URL');
  for (const rule of LEGACY_PR_RUBRIC_RULES) {
    const target = rule.preprocess ? rule.preprocess(withoutUrls) : withoutUrls;
    const match = rule.re.exec(target);
    assert.equal(
      match,
      null,
      `Forbidden ${rule.label} ("${match ? match[0] : ''}") in ${relFile}; use %-first PR Readiness Checklist format`
    );
  }
}

export function validatePrReadinessChecklist(markdown, label = 'PR Readiness') {
  const normalized = String(markdown || '').replace(/\r\n/g, '\n');
  const headingMatches = [
    ...normalized.matchAll(/^(?:#{1,6}\s+[^\n]*\bPR Readiness\b|\*{2}PR Readiness\b)[^\n]*$/gim),
  ];
  assert.equal(
    headingMatches.length > 0,
    true,
    `${label} must include a PR Readiness section heading`
  );

  let selectedHeading = headingMatches[headingMatches.length - 1];
  let sectionText = normalized.slice(selectedHeading.index);
  let visibleSection = stripHtmlComments(sectionText);
  let detailsMatch = DETAILS_BLOCK_RE.exec(visibleSection);
  if (!detailsMatch && /<details/i.test(normalized.slice(headingMatches[0].index))) {
    for (let i = headingMatches.length - 2; i >= 0; i--) {
      const candidateText = normalized.slice(headingMatches[i].index);
      const candidateVisible = stripHtmlComments(candidateText);
      const candidateDetails = DETAILS_BLOCK_RE.exec(candidateVisible);
      if (candidateDetails) {
        selectedHeading = headingMatches[i];
        sectionText = candidateText;
        visibleSection = candidateVisible;
        detailsMatch = candidateDetails;
        break;
      }
    }
  }

  validateNoLegacyPrRubric(sectionText, label);

  assert.ok(
    detailsMatch,
    `${label} must include a <details><summary>...</summary>...</details> checklist block`
  );

  const beforeDetails = visibleSection.slice(0, detailsMatch.index);
  const headingLine = beforeDetails.split('\n')[0];
  const summaryText = detailsMatch[1].trim();
  assert.equal(summaryText.length > 0, true, `${label} <summary> must not be empty`);

  const headingOverallMatches = extractNonThresholdPercentages(headingLine);
  let overallScore;
  if (headingOverallMatches.length > 0) {
    overallScore = Number(headingOverallMatches[0][1]);
  } else {
    const beforeDetailsMatches = extractNonThresholdPercentages(beforeDetails);
    assert.equal(
      beforeDetailsMatches.length > 0,
      true,
      `${label} must include an overall percentage score (e.g. "98%")`
    );
    overallScore = Number(beforeDetailsMatches[beforeDetailsMatches.length - 1][1]);
  }
  assert.equal(
    Number.isFinite(overallScore) && overallScore >= 0 && overallScore <= 100,
    true,
    `${label} overall percentage score out of [0..100]: ${overallScore}%`
  );

  const itemLines = detailsMatch[2]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  assert.equal(
    itemLines.length >= 1,
    true,
    `${label} <details> checklist must contain at least 1 item`
  );

  const itemScores = [];
  for (const line of itemLines) {
    const match = CHECKLIST_PERCENT_LINE_RE.exec(line);
    assert.ok(
      match,
      `${label} checklist line must start with % (e.g. "- **100%** ..."): "${line}"`
    );
    const pct = Number(match[1]);
    assert.equal(
      Number.isFinite(pct) && pct >= 0 && pct <= 100,
      true,
      `${label} checklist item percentage out of [0..100]: ${pct}%`
    );
    itemScores.push(pct);
  }

  return {
    overallScore,
    itemCount: itemScores.length,
    itemScores,
    summary: summaryText,
  };
}

function collectGithubTextFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectGithubTextFiles(fullPath, out);
    } else if (entry.isFile() && /\.(?:ya?ml|md)$/i.test(entry.name)) {
      out.push(fullPath);
    }
  }
  return out;
}

export function validatePrReadinessSpec(
  root,
  {
    requireProjectMd = DEFAULT_REQUIRE_PROJECT_MD,
    enforcePrReadinessSpec = DEFAULT_ENFORCE_PR_READINESS_SPEC,
  } = {}
) {
  const resolvedRoot = path.resolve(root);
  const governanceRelFiles = ['AGENTS.md', 'PROJECT.md', 'DEV.md', 'TESTING.md', 'README.md'];
  const scannedFiles = [];

  for (const relFile of governanceRelFiles) {
    const absPath = path.join(resolvedRoot, relFile);
    if (!fs.existsSync(absPath)) {
      if (relFile === 'PROJECT.md' && !requireProjectMd) continue;
      assert.fail(`Required governance doc missing: ${relFile}`);
    }
    const raw = fs.readFileSync(absPath, 'utf8');
    validateNoLegacyPrRubric(raw, relFile);
    scannedFiles.push(relFile);

    if (!enforcePrReadinessSpec) continue;
    const publicText = stripHtmlDevOnlyForSanity(raw);

    if (relFile === 'AGENTS.md') {
      assert.match(publicText, /pr readiness/i, 'AGENTS.md must document PR Readiness format');
      assert.match(publicText, /<details>/i, 'AGENTS.md must document <details> PR Readiness block');
      assert.match(publicText, /95%/, 'AGENTS.md must specify >= 95% PR Readiness threshold');
      assert.match(
        publicText,
        /(?:start of each|at the start|%\s*-first)/i,
        'AGENTS.md must specify putting % at the start of each checklist line'
      );
      assert.match(
        publicText,
        /(?:as many|flexible|variable|not (?:capped|limited|fixed)|any number|scope-relevant)/i,
        'AGENTS.md must allow variable PR Readiness checklist item counts'
      );
    } else if (relFile === 'PROJECT.md') {
      assert.match(publicText, /pr readiness/i, 'PROJECT.md must document PR Readiness format');
      assert.match(publicText, /checklist/i, 'PROJECT.md must name PR Readiness Checklist');
      assert.match(publicText, /<details>/i, 'PROJECT.md must document <details> PR Readiness block');
      assert.match(publicText, /95%/, 'PROJECT.md must specify >= 95% PR Readiness threshold');
      assert.match(
        publicText,
        /(?:start of each|at the start|%\s*-first)/i,
        'PROJECT.md must specify putting % at the start of each checklist line'
      );
      assert.match(
        publicText,
        /(?:as many|flexible|variable|not (?:capped|limited|fixed)|any number|scope-relevant)/i,
        'PROJECT.md must allow variable PR Readiness checklist item counts'
      );
    } else if (relFile === 'DEV.md') {
      assert.match(publicText, /pr readiness/i, 'DEV.md must reference PR Readiness');
      assert.match(publicText, /95%/, 'DEV.md must reference >= 95% PR Readiness threshold');
    }
  }

  for (const absPath of collectGithubTextFiles(path.join(resolvedRoot, '.github'))) {
    const relFile = path.relative(resolvedRoot, absPath).replace(/\\/g, '/');
    validateNoLegacyPrRubric(fs.readFileSync(absPath, 'utf8'), relFile);
    scannedFiles.push(relFile);
  }

  return { scannedFiles };
}

export function validateRootGuideIndex(root, { requireProjectMd = DEFAULT_REQUIRE_PROJECT_MD } = {}) {
  const resolvedRoot = path.resolve(root);
  const rootMdFiles = fs
    .readdirSync(resolvedRoot, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md'))
    .map((e) => e.name)
    .sort();

  const hasProjectMd = rootMdFiles.includes('PROJECT.md');
  if (requireProjectMd) {
    assert.equal(hasProjectMd, true, 'PROJECT.md must exist at repository root');
  }

  const readmeText = stripHtmlDevOnlyForSanity(
    fs.readFileSync(path.join(resolvedRoot, 'README.md'), 'utf8')
  );
  const devText = stripHtmlDevOnlyForSanity(
    fs.readFileSync(path.join(resolvedRoot, 'DEV.md'), 'utf8')
  );

  for (const f of rootMdFiles) {
    if (f !== 'README.md') {
      assert.equal(
        readmeText.includes(`./${f}`),
        true,
        `README.md must link ./${f} in a public section`
      );
    }
    if (f !== 'LICENSE.md') {
      assert.equal(
        devText.includes(`./${f}`),
        true,
        `DEV.md must link ./${f} in a public section`
      );
    }
  }

  if (hasProjectMd) {
    const projectText = stripHtmlDevOnlyForSanity(
      fs.readFileSync(path.join(resolvedRoot, 'PROJECT.md'), 'utf8')
    );
    for (const f of rootMdFiles) {
      if (f !== 'LICENSE.md' && f !== 'PROJECT.md') {
        assert.equal(
          projectText.includes(`./${f}`),
          true,
          `PROJECT.md must link ./${f} in a public section`
        );
      }
    }
  }

  return { rootMdFiles, hasProjectMd };
}

export function parseChangelogFragment(rawContent, relFile = '.changelog/fragment.md') {
  const normalized = String(rawContent || '').replace(/\r\n/g, '\n');
  const fmMatch = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(normalized);
  assert.ok(fmMatch, `Invalid changelog fragment frontmatter in ${relFile}: expected --- YAML --- block`);

  const metaLines = fmMatch[1].split('\n');
  const meta = {};
  for (const line of metaLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const kv = /^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/.exec(trimmed);
    assert.ok(kv, `Invalid frontmatter line in ${relFile}: "${line}"`);
    const key = kv[1].toLowerCase();
    const val = kv[2].trim().replace(/^["']|["']$/g, '');
    meta[key] = val;
  }

  const bump = (meta.bump || '').toLowerCase();
  assert.equal(
    bump === 'patch' || bump === 'minor' || bump === 'major',
    true,
    `Invalid or missing "bump" in ${relFile}: expected patch|minor|major`
  );

  let pr = null;
  if (meta.pr !== undefined && meta.pr !== '') {
    assert.match(meta.pr, /^[1-9]\d*$/, `Invalid "pr" number in ${relFile}: ${meta.pr}`);
    pr = Number(meta.pr);
  }

  if (meta.epic !== undefined && meta.epic !== '') {
    assert.match(
      meta.epic,
      /^(?:EPIC-[1-9]\d*|[1-9]\d*)$/i,
      `Invalid "epic" value in ${relFile}: ${meta.epic}`
    );
  }

  const body = fmMatch[2].trim();
  assert.equal(body.length > 0, true, `Changelog fragment ${relFile} must have a non-empty summary`);
  assert.equal(body.includes('\n'), false, `Changelog fragment ${relFile} summary must be a single line`);
  assert.equal(
    /^#{1,6}\s|^-\s/.test(body),
    false,
    `Changelog fragment ${relFile} summary must be plain text without headings or list prefixes`
  );

  return {
    bump,
    pr,
    epic: meta.epic || null,
    task: meta.task || null,
    summary: body,
  };
}

export function validateChangelogFragments(root) {
  const dir = path.join(path.resolve(root), '.changelog');
  if (!fs.existsSync(dir)) return 0;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let count = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name.toLowerCase() === 'readme.md') continue;
    assert.equal(
      entry.name.toLowerCase().endsWith('.md'),
      true,
      `Unexpected non-Markdown file in .changelog/: ${entry.name}`
    );
    const fullPath = path.join(dir, entry.name);
    const raw = fs.readFileSync(fullPath, 'utf8');
    parseChangelogFragment(raw, `.changelog/${entry.name}`);
    count++;
  }
  return count;
}

export function runSanityChecks({
  repoRoot = DEFAULT_REPO_ROOT,
  requireProjectMd = DEFAULT_REQUIRE_PROJECT_MD,
  enforceChannelOrder = DEFAULT_ENFORCE_CHANNEL_ORDER,
  enforceEpicNaming = DEFAULT_ENFORCE_EPIC_NAMING,
  enforcePrReadinessSpec = DEFAULT_ENFORCE_PR_READINESS_SPEC,
} = {}) {
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
  const changelogText = fs.readFileSync(changelogPath, 'utf8').replace(/\r\n/g, '\n');
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

  validateChangelogChannelOrder(changelogText, pkg.version, { enforceChannelOrder });
  validateChangelogFragments(root);

  const bulletLines = changelogText.split('\n').filter((line) => line.startsWith('- '));
  assert.equal(bulletLines.length >= 398, true, `Expected >= 398 bullets, got ${bulletLines.length}`);
  let bulletRe = /\s(?:\[#\d+\]\(https:\/\/github\.com\/[^/\s]+\/capy\/pull\/\d+\)|#\d+)$/;
  /* capy-dev-only:start */
  bulletRe = /\s\[#\d+\]\(https:\/\/github\.com\/shthed\/capy\/pull\/\d+\)$/;
  /* capy-dev-only:end */
  for (const b of bulletLines) {
    assert.match(b, bulletRe, `Invalid CHANGELOG bullet suffix: ${b}`);
  }

  // 3. Markdown hygiene & portable relative links across all .md files
  validateRootGuideIndex(root, { requireProjectMd });
  validatePrReadinessSpec(root, { requireProjectMd, enforcePrReadinessSpec });

  const mdFiles = collectMarkdownFiles(root);
  assert.equal(mdFiles.length >= 10, true, 'Expected >= 10 repository .md files');

  for (const mdPath of mdFiles) {
    const relFile = path.relative(root, mdPath).replace(/\\/g, '/');
    const rawText = fs.readFileSync(mdPath, 'utf8');
    if (enforceEpicNaming) {
      validateEpicNaming(rawText, relFile);
    }

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
