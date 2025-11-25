#!/usr/bin/env node
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const sanitize = (value) => (value || '').replace(/[^a-zA-Z0-9._-]/g, '-').trim();

const repository = process.env.GITHUB_REPOSITORY ?? '';
const [owner, repo] = repository.split('/');

if (!owner || !repo) {
  console.error('cleanup-gh-pages: GITHUB_REPOSITORY must be set to "owner/repo".');
  process.exitCode = 1;
  process.exit();
}

const token = process.env.GITHUB_TOKEN ?? '';
if (!token) {
  console.error('cleanup-gh-pages: GITHUB_TOKEN is required.');
  process.exitCode = 1;
  process.exit();
}

const baseUrl = `https://api.github.com/repos/${owner}/${repo}`;
const fetchHeaders = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'capy-gh-pages-cleanup-script',
  Authorization: `Bearer ${token}`
};

const parseLinkHeader = (value) => {
  if (!value) {
    return {};
  }

  return value.split(',').reduce((acc, part) => {
    const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (!match) {
      return acc;
    }
    const [, url, rel] = match;
    acc[rel] = url;
    return acc;
  }, {});
};

const request = async (url, options = {}) => {
  const { params, method = 'GET', body } = options;
  const requestUrl = new URL(url);

  if (params && typeof params === 'object') {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') {
        continue;
      }
      requestUrl.searchParams.set(key, value);
    }
  }

  const response = await fetch(requestUrl, {
    method,
    headers: fetchHeaders,
    body
  });

  if (response.ok) {
    const linkHeader = response.headers.get('link');
    const links = parseLinkHeader(linkHeader ?? '');
    if (method === 'DELETE' || response.status === 204) {
      return { data: null, response, links };
    }
    return { data: await response.json(), response, links };
  }

  const text = await response.text();
  throw new Error(`GitHub request failed with ${response.status}: ${text || response.statusText}`);
};

const paginate = async (path, initialParams = {}) => {
  const perPage = Math.min(Math.max(Number.parseInt(initialParams.per_page ?? '100', 10) || 100, 1), 100);
  const params = { ...initialParams, per_page: perPage };
  let page = Number.parseInt(params.page ?? '1', 10) || 1;
  const results = [];

  while (true) {
    const { data, links } = await request(`${baseUrl}/${path}`, { params: { ...params, page } });
    if (!Array.isArray(data)) {
      throw new Error(`Expected array response from ${path}, received ${typeof data}`);
    }

    results.push(...data);

    if (!links.next || data.length < perPage) {
      break;
    }

    page += 1;
  }

  return results;
};

const fetchPullRequests = async () => paginate('pulls', { state: 'all', sort: 'updated', direction: 'desc' });

const runCommand = (command) => {
  const output = execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return output.trim();
};

const resolveDefaultBranch = () => {
  try {
    const headRef = runCommand('git symbolic-ref refs/remotes/origin/HEAD');
    const match = headRef.match(/refs\/remotes\/origin\/(.+)$/);
    return match?.[1] ?? 'main';
  } catch (error) {
    console.warn('cleanup-gh-pages: unable to resolve origin/HEAD; defaulting to main.');
    return 'main';
  }
};

const fetchRemoteBranches = () => {
  const raw = runCommand("git for-each-ref --format='%(refname:short)' refs/remotes/origin");
  return raw
    .split('\n')
    .map((line) => line.trim().replace(/^origin\//, ''))
    .filter((name) => name && name !== 'HEAD');
};

const parseArguments = () => {
  const args = process.argv.slice(2);
  const options = { pagesDir: 'gh-pages', targetPr: null, ignoreRecency: false };

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--pages-dir') {
      options.pagesDir = args[index + 1] ?? options.pagesDir;
      index += 1;
    } else if (value === '--target-pr') {
      const raw = args[index + 1];
      const parsed = raw ? Number.parseInt(raw, 10) : NaN;
      options.targetPr = Number.isFinite(parsed) ? parsed : null;
      index += 1;
    } else if (value === '--ignore-recency') {
      options.ignoreRecency = true;
    }
  }

  return options;
};

const findLegacyPreviewDirectories = (rootDir) => {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .filter((entry) => !['.git', 'README', 'pull'].includes(entry.name))
    .filter((entry) => entry.name === sanitize(entry.name))
    .map((entry) => {
      const absolutePath = path.join(rootDir, entry.name);
      const stats = fs.statSync(absolutePath);
      return { name: entry.name, absolutePath, stats };
    });
};

const findPullPreviewDirectories = (rootDir) => {
  const pullRoot = path.join(rootDir, 'pull');
  if (!fs.existsSync(pullRoot) || !fs.statSync(pullRoot).isDirectory()) {
    return [];
  }

  const entries = fs.readdirSync(pullRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .filter((entry) => entry.name === sanitize(entry.name))
    .map((entry) => {
      const absolutePath = path.join(pullRoot, entry.name);
      const stats = fs.statSync(absolutePath);
      return { name: entry.name, absolutePath, stats };
    });
};

const deleteDirectory = (targetPath) => {
  fs.rmSync(targetPath, { recursive: true, force: true });
};

const DAY_IN_MS = 24 * 60 * 60 * 1000;

const buildPullRequestIndex = (pulls) => {
  const index = new Map();
  for (const pull of pulls) {
    const branch = pull?.head?.ref;
    const slug = sanitize(branch);
    if (!slug) {
      continue;
    }

    const prInfo = {
      number: pull.number,
      state: pull.state,
      title: pull.title ?? '',
      mergedAt: pull.merged_at ?? null,
      updatedAt: pull.updated_at ?? null,
      url: pull.html_url ?? ''
    };

    if (!index.has(slug)) {
      index.set(slug, []);
    }
    index.get(slug).push(prInfo);
  }
  return index;
};

const buildPullRequestNumberIndex = (pulls) => {
  const index = new Map();
  for (const pull of pulls) {
    if (!pull?.number) {
      continue;
    }

    const info = {
      number: pull.number,
      state: pull.state,
      title: pull.title ?? '',
      mergedAt: pull.merged_at ?? null,
      updatedAt: pull.updated_at ?? null,
      url: pull.html_url ?? '',
      headRef: pull?.head?.ref ?? ''
    };

    index.set(pull.number, info);
  }
  return index;
};

const formatPrSummary = (prs) => {
  if (!prs || prs.length === 0) {
    return 'no pull requests found';
  }

  return prs
    .map((pr) => {
      const mergedMarker = pr.mergedAt ? 'merged' : pr.state;
      return `#${pr.number} (${mergedMarker})`;
    })
    .join(', ');
};

const main = async () => {
  const options = parseArguments();
  const { pagesDir } = options;
  const resolvedPagesDir = path.resolve(process.cwd(), pagesDir);

  if (!fs.existsSync(resolvedPagesDir) || !fs.statSync(resolvedPagesDir).isDirectory()) {
    console.error(`cleanup-gh-pages: pages directory not found at ${resolvedPagesDir}`);
    process.exitCode = 1;
    return;
  }

  const defaultBranch = resolveDefaultBranch();
  const remoteBranches = fetchRemoteBranches();

  const liveBranchSlugs = new Set();

  const addBranchTargets = (branchName) => {
    const slug = sanitize(branchName);
    if (!slug) {
      return;
    }

    liveBranchSlugs.add(slug);
  };

  remoteBranches.forEach(addBranchTargets);
  if (defaultBranch) {
    addBranchTargets(defaultBranch);
  }

  const pulls = await fetchPullRequests();
  const pullIndex = buildPullRequestIndex(pulls);
  const pullNumberIndex = buildPullRequestNumberIndex(pulls);

  const pullPreviewDirectories = findPullPreviewDirectories(resolvedPagesDir).map((entry) => ({
    ...entry,
    kind: 'pull'
  }));
  const legacyPreviewDirectories = findLegacyPreviewDirectories(resolvedPagesDir).map((entry) => ({
    ...entry,
    kind: 'legacy'
  }));

  const previewDirectories = [...pullPreviewDirectories, ...legacyPreviewDirectories];

  if (previewDirectories.length === 0) {
    console.log('cleanup-gh-pages: no preview directories detected.');
    return;
  }

  const now = Date.now();
  const inventory = previewDirectories.map((entry) => {
    const prs = entry.kind === 'pull' ? [] : pullIndex.get(entry.name) ?? [];
    const prNumber = entry.kind === 'pull' ? Number.parseInt(entry.name, 10) : null;
    const pull = Number.isFinite(prNumber) ? pullNumberIndex.get(prNumber) : null;
    const hasLiveBranch = (() => {
      if (entry.kind === 'pull') {
        const headRef = pull?.headRef;
        const slug = sanitize(headRef);
        return slug ? liveBranchSlugs.has(slug) : false;
      }
      return liveBranchSlugs.has(entry.name);
    })();
    const ageMs = Math.max(0, now - entry.stats.mtimeMs);
    const isRecent = ageMs < DAY_IN_MS;

    return {
      name: entry.name,
      absolutePath: entry.absolutePath,
      kind: entry.kind,
      hasLiveBranch,
      prs,
      pull,
      prNumber,
      isRecent,
      lastUpdated: entry.stats.mtime ?? entry.stats.mtimeMs
    };
  });

  console.log('::debug::cleanup-gh-pages: currently deployed previews:');
  for (const entry of inventory) {
    const prSummary = (() => {
      if (entry.pull) {
        const mergedMarker = entry.pull.mergedAt ? 'merged' : entry.pull.state;
        return `#${entry.pull.number} (${mergedMarker})`;
      }
      return formatPrSummary(entry.prs);
    })();

    const freshness = entry.isRecent ? '<1 day old' : '>=1 day old';
    const branchState = entry.hasLiveBranch ? 'live branch detected' : 'no matching branch';
    const updatedLabel = entry.lastUpdated instanceof Date ? entry.lastUpdated.toISOString() : new Date(entry.lastUpdated).toISOString();
    const label = entry.kind === 'pull' ? `pull/${entry.name}` : entry.name;

    console.log(`::debug::- ${label}: ${branchState}; last updated ${updatedLabel}; ${freshness}; PRs: ${prSummary}`);
  }

  const deletions = inventory.filter((entry) => {
    const hasOpenPr = entry.pull?.state === 'open' || entry.prs.some((pr) => pr.state === 'open');
    const matchesTargetPr = options.targetPr !== null && entry.prNumber === options.targetPr;

    if (hasOpenPr) {
      return false;
    }

    if (entry.kind === 'legacy' && entry.hasLiveBranch) {
      return false;
    }

    if (matchesTargetPr && options.ignoreRecency) {
      return true;
    }

    return !entry.isRecent;
  });

  if (deletions.length === 0) {
    if (options.targetPr !== null) {
      console.log(`cleanup-gh-pages: no preview directories matched PR #${options.targetPr} for removal.`);
    } else {
      console.log('cleanup-gh-pages: no preview directories met cleanup criteria (requires no branch match and age >= 1 day).');
    }
    return;
  }

  const removalReason = options.ignoreRecency && options.targetPr !== null
    ? `targeted removal for PR #${options.targetPr}`
    : 'orphaned preview directories older than 1 day';

  console.log(`cleanup-gh-pages: removing ${removalReason}:`);
  for (const entry of deletions) {
    const label = entry.kind === 'pull' ? `pull/${entry.name}` : entry.name;
    console.log(`- ${label}`);
    deleteDirectory(entry.absolutePath);
  }
};

main().catch((error) => {
  console.error('cleanup-gh-pages: failed to prune previews');
  if (error && error.stack) {
    console.error(error.stack);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
