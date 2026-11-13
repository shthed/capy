#!/usr/bin/env node
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const sanitize = (value) => (value || '').replace(/[^a-zA-Z0-9._-]/g, '-').trim();
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createHeaders = (token) => ({
  Accept: 'application/vnd.github+json',
  'User-Agent': 'capy-gh-pages-cleanup-script',
  Authorization: `Bearer ${token}`
});

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

const parseRetryAfterMs = (headerValue, nowMs = Date.now()) => {
  if (!headerValue) {
    return null;
  }
  const trimmed = String(headerValue).trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    return Math.max(0, Math.round(Number.parseFloat(trimmed) * 1000));
  }
  const parsedDate = Date.parse(trimmed);
  if (Number.isFinite(parsedDate)) {
    return Math.max(0, parsedDate - nowMs);
  }
  return null;
};

const computeRetryDelayMs = (response, attempt, baseDelayMs, nowMs = Date.now()) => {
  const retryAfterMs = parseRetryAfterMs(response?.headers?.get?.('retry-after'), nowMs);
  if (retryAfterMs !== null) {
    return Math.min(60000, Math.max(0, retryAfterMs));
  }
  const status = response?.status;
  if (status === 403 || status === 429) {
    const resetHeader = response?.headers?.get?.('x-ratelimit-reset');
    if (resetHeader && /^\d+$/.test(String(resetHeader).trim())) {
      const resetMs = Number.parseInt(resetHeader, 10) * 1000;
      return Math.min(60000, Math.max(1000, resetMs - nowMs));
    }
  }
  const safeBase = Math.max(0, Number.isFinite(baseDelayMs) ? baseDelayMs : 1000);
  const exp = Math.min(30000, safeBase * (2 ** attempt));
  const jitterBound = Math.min(250, Math.max(1, Math.floor(safeBase)));
  const jitter = safeBase > 0 ? Math.floor(Math.random() * jitterBound) : 0;
  return Math.min(30000, exp + jitter);
};

const isRetryableResponse = (response) => {
  const status = response?.status;
  if (status === 429 || (status >= 500 && status <= 599)) {
    return true;
  }
  if (status === 403) {
    const remaining = response.headers?.get?.('x-ratelimit-remaining');
    const retryAfter = response.headers?.get?.('retry-after');
    return remaining === '0' || Boolean(retryAfter);
  }
  return false;
};

export const requestWithRetry = async (url, options = {}) => {
  const {
    params,
    method = 'GET',
    body,
    headers = {},
    retries = 4,
    timeoutMs = 30000,
    baseDelayMs = 1000,
    fetchImpl = globalThis.fetch,
    sleepImpl = defaultSleep,
  } = options;

  const requestUrl = new URL(url);

  if (params && typeof params === 'object') {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') {
        continue;
      }
      requestUrl.searchParams.set(key, value);
    }
  }

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let response;
    try {
      const signal =
        typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
          ? AbortSignal.timeout(timeoutMs)
          : undefined;
      response = await fetchImpl(requestUrl, {
        method,
        headers,
        body,
        ...(signal ? { signal } : {})
      });
    } catch (error) {
      if (attempt < retries) {
        const safeBase = Math.max(0, Number.isFinite(baseDelayMs) ? baseDelayMs : 1000);
        const exp = Math.min(30000, safeBase * (2 ** attempt));
        const jitter = safeBase > 0 ? Math.floor(Math.random() * Math.min(250, Math.max(1, Math.floor(safeBase)))) : 0;
        await sleepImpl(Math.min(30000, exp + jitter));
        continue;
      }
      throw new Error(`GitHub request failed after ${attempt + 1} attempt(s): ${error?.message || error}`, {
        cause: error
      });
    }

    if (response.ok) {
      const linkHeader = response.headers?.get?.('link');
      const links = parseLinkHeader(linkHeader ?? '');
      if (method === 'DELETE' || response.status === 204) {
        return { data: null, response, links };
      }
      return { data: await response.json(), response, links };
    }

    if (attempt < retries && isRetryableResponse(response)) {
      const delay = computeRetryDelayMs(response, attempt, baseDelayMs);
      await response.text().catch(() => {});
      await sleepImpl(delay);
      continue;
    }

    const text = await response.text().catch(() => '');
    const err = new Error(`GitHub request failed with ${response.status}: ${text || response.statusText}`);
    err.status = response.status;
    throw err;
  }

  throw new Error('GitHub request failed after retries.');
};

const paginate = async (baseUrl, reqPath, initialParams = {}, requestOptions = {}) => {
  const perPage = Math.min(Math.max(Number.parseInt(initialParams.per_page ?? '100', 10) || 100, 1), 100);
  const params = { ...initialParams, per_page: perPage };
  let page = Number.parseInt(params.page ?? '1', 10) || 1;
  const results = [];

  while (true) {
    const { data, links } = await requestWithRetry(`${baseUrl}/${reqPath}`, {
      ...requestOptions,
      params: { ...params, page }
    });
    if (!Array.isArray(data)) {
      throw new Error(`Expected array response from ${reqPath}, received ${typeof data}`);
    }

    results.push(...data);

    if (!links.next || data.length < perPage) {
      break;
    }

    page += 1;
  }

  return results;
};

export const fetchPullRequests = async ({
  baseUrl,
  headers,
  targetPr = null,
  fetchImpl = globalThis.fetch,
  sleepImpl = defaultSleep,
  baseDelayMs = 1000,
  timeoutMs = 30000,
  retries = 4,
} = {}) => {
  const reqOpts = { headers, fetchImpl, sleepImpl, baseDelayMs, timeoutMs, retries };
  const pulls = await paginate(
    baseUrl,
    'pulls',
    { state: 'open', sort: 'updated', direction: 'desc' },
    reqOpts
  );

  if (targetPr !== null && targetPr !== undefined && !pulls.some((pr) => pr?.number === targetPr)) {
    try {
      const { data } = await requestWithRetry(`${baseUrl}/pulls/${targetPr}`, reqOpts);
      if (data && typeof data === 'object' && data.number) {
        pulls.push(data);
      }
    } catch (error) {
      if (error?.status !== 404) {
        throw error;
      }
    }
  }

  return pulls;
};

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
    .filter((entry) => !['.git', 'pull', 'beta', 'assets', 'web1'].includes(entry.name))
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

export const buildPullRequestIndex = (pulls) => {
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

export const buildPullRequestNumberIndex = (pulls) => {
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

export const runCleanupGhPagesPreviews = async (rawOptions = {}) => {
  const repository = rawOptions.repository ?? process.env.GITHUB_REPOSITORY ?? '';
  const [owner, repo] = repository.split('/');
  if (!owner || !repo) {
    throw new Error('cleanup-gh-pages: GITHUB_REPOSITORY must be set to "owner/repo".');
  }

  const token = rawOptions.token ?? process.env.GITHUB_TOKEN ?? '';
  if (!token) {
    throw new Error('cleanup-gh-pages: GITHUB_TOKEN is required.');
  }

  const cliOptions = rawOptions.pagesDir !== undefined ? {} : parseArguments();
  const options = {
    pagesDir: rawOptions.pagesDir ?? cliOptions.pagesDir ?? 'gh-pages',
    targetPr: rawOptions.targetPr !== undefined ? rawOptions.targetPr : (cliOptions.targetPr ?? null),
    ignoreRecency: rawOptions.ignoreRecency ?? cliOptions.ignoreRecency ?? false,
  };
  const { pagesDir } = options;
  const resolvedPagesDir = path.resolve(rawOptions.cwd ?? process.cwd(), pagesDir);

  if (!fs.existsSync(resolvedPagesDir) || !fs.statSync(resolvedPagesDir).isDirectory()) {
    console.error(`cleanup-gh-pages: pages directory not found at ${resolvedPagesDir}`);
    process.exitCode = 1;
    return { deleted: [], evaluated: 0 };
  }

  const legacyReadme = path.join(resolvedPagesDir, 'README');
  if (fs.existsSync(legacyReadme)) {
    console.log('cleanup-gh-pages: removing legacy README/ directory.');
    deleteDirectory(legacyReadme);
  }

  const defaultBranch = rawOptions.defaultBranch ?? resolveDefaultBranch();
  const remoteBranches = rawOptions.remoteBranches ?? fetchRemoteBranches();

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

  const baseUrl = `https://api.github.com/repos/${owner}/${repo}`;
  const headers = createHeaders(token);
  const pulls = await fetchPullRequests({
    baseUrl,
    headers,
    targetPr: options.targetPr,
    fetchImpl: rawOptions.fetchImpl ?? globalThis.fetch,
    sleepImpl: rawOptions.sleepImpl ?? defaultSleep,
    baseDelayMs: rawOptions.baseDelayMs ?? 1000,
    timeoutMs: rawOptions.timeoutMs ?? 30000,
    retries: rawOptions.retries ?? 4,
  });
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
    return { deleted: [], evaluated: 0 };
  }

  const now = rawOptions.nowMs ?? Date.now();
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

  const deletions = selectPreviewDeletions(inventory, options);

  if (deletions.length === 0) {
    if (options.targetPr !== null) {
      console.log(`cleanup-gh-pages: no preview directories matched PR #${options.targetPr} for removal.`);
    } else {
      console.log('cleanup-gh-pages: no preview directories met cleanup criteria.');
    }
    return { deleted: [], evaluated: inventory.length };
  }

  const removalReason = options.targetPr !== null
    ? `targeted removal for PR #${options.targetPr}`
    : 'closed or non-open pull request preview directories';

  console.log(`cleanup-gh-pages: removing ${removalReason}:`);
  const deleted = [];
  for (const entry of deletions) {
    const label = entry.kind === 'pull' ? `pull/${entry.name}` : entry.name;
    console.log(`- ${label}`);
    deleteDirectory(entry.absolutePath);
    deleted.push(label);
  }
  return { deleted, evaluated: inventory.length };
};

export const selectPreviewDeletions = (inventory, options = {}) => {
  const { targetPr = null, ignoreRecency = false } = options;
  return inventory.filter((entry) => {
    const hasOpenPr = entry.pull?.state === 'open' || entry.prs.some((pr) => pr.state === 'open');
    const matchesTargetPr = targetPr !== null && entry.prNumber === targetPr;

    if (hasOpenPr) {
      return false;
    }

    if (targetPr !== null) {
      return matchesTargetPr;
    }

    if (entry.kind === 'legacy') {
      if (entry.hasLiveBranch) {
        return false;
      }
      return ignoreRecency || !entry.isRecent;
    }

    // For pull/ directories: only deployments for open pull requests are kept.
    return true;
  });
};

const isCliEntry = Boolean(
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
);

if (isCliEntry) {
  runCleanupGhPagesPreviews().catch((error) => {
    console.error('cleanup-gh-pages: failed to prune previews');
    if (error && error.stack) {
      console.error(error.stack);
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  });
}
