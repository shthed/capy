#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const PROTECTED_BRANCH_NAMES = new Set(['main', 'beta', 'gh-pages']);

const defaultSleep = async (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createHeaders = (token) => ({
  Accept: 'application/vnd.github+json',
  'User-Agent': 'capy-branch-cleanup-script',
  ...(token ? { Authorization: `Bearer ${token}` } : {})
});

const parseNonNegativeDays = (raw, fallback) => {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return fallback;
  }
  const parsed = Number.parseFloat(String(raw));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const parsePrefixes = (raw) =>
  String(raw ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

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
      const resetTime = Number.parseInt(resetHeader, 10) * 1000;
      return Math.min(60000, Math.max(1000, resetTime - nowMs));
    }
  }
  const safeBase = Math.max(0, Number.isFinite(baseDelayMs) ? baseDelayMs : 1000);
  const exp = Math.min(30000, safeBase * (2 ** attempt));
  const jitter = safeBase > 0 ? Math.floor(Math.random() * Math.min(250, Math.max(1, Math.floor(safeBase)))) : 0;
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
      const json = await response.json();
      return { data: json, response, links };
    }

    if (method === 'DELETE' && response.status === 404 && attempt > 0) {
      await response.text().catch(() => {});
      return { data: null, response, links: {} };
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

const branchMatchesPrefix = (name, includePrefixes) => {
  if (!name) {
    return false;
  }
  if (includePrefixes.length === 0) {
    return false; // Safe default: require explicit prefix configuration before deleting any branch
  }
  if (includePrefixes.includes('*')) {
    return true; // Explicit wildcard if user specifically requests all branches
  }
  return includePrefixes.some((prefix) => name.startsWith(prefix));
};

const encodeRefPath = (ref) =>
  ref
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/');

const resolveCommitTimestampMs = async (branch, getCommitTimestampMs) => {
  const commitSha = branch?.commit?.sha;
  if (!commitSha) {
    return 0;
  }
  try {
    const commitMs = await getCommitTimestampMs(commitSha);
    return Number.isFinite(commitMs) && commitMs > 0 ? commitMs : 0;
  } catch {
    return 0;
  }
};

export const evaluateBranchesForCleanup = async ({
  branches = [],
  defaultBranch = 'main',
  includePrefixes = [],
  activeBranches = new Set(),
  mergedBranches = new Map(),
  closedUnmergedBranches = new Map(),
  getCommitTimestampMs = async () => 0,
  minAgeDays = 1,
  unmergedMinAgeDays = minAgeDays,
  nowMs = Date.now(),
} = {}) => {
  const minAgeMs = minAgeDays * 24 * 60 * 60 * 1000;
  const unmergedMinAgeMs = unmergedMinAgeDays * 24 * 60 * 60 * 1000;
  const deletions = [];
  const diagnostics = [];

  for (const branch of branches) {
    const name = branch?.name ?? '';
    if (!name) {
      continue;
    }

    if (name === defaultBranch || PROTECTED_BRANCH_NAMES.has(name)) {
      diagnostics.push({ name, detail: 'skipped default or protected channel branch' });
      continue;
    }
    if (branch.protected) {
      diagnostics.push({ name, detail: 'skipped protected branch' });
      continue;
    }
    if (includePrefixes.length === 0) {
      diagnostics.push({ name, detail: 'skipped: no allowed prefixes configured in BRANCH_CLEANUP_PREFIXES (safe mode)' });
      continue;
    }
    if (!branchMatchesPrefix(name, includePrefixes)) {
      diagnostics.push({ name, detail: `skipped unmatched prefix (allowed: ${includePrefixes.join(', ')})` });
      continue;
    }
    if (activeBranches.has(name)) {
      diagnostics.push({ name, detail: 'skipped branch with open pull request' });
      continue;
    }

    const mergedAt = mergedBranches.get(name);
    if (mergedAt) {
      const mergedAgeMs = nowMs - mergedAt;
      if (mergedAgeMs < minAgeMs) {
        const ageHours = Math.max(0, Math.round(mergedAgeMs / (1000 * 60 * 60)));
        diagnostics.push({ name, detail: `skipped: merged recently (${ageHours}h ago < ${minAgeDays * 24}h threshold)` });
        continue;
      }

      const commitMs = await resolveCommitTimestampMs(branch, getCommitTimestampMs);
      if (commitMs <= 0) {
        diagnostics.push({ name, detail: 'skipped: unable to determine commit timestamp' });
        continue;
      }

      const effectiveActivityMs = Math.max(mergedAt, commitMs);
      const ageMs = nowMs - effectiveActivityMs;
      if (ageMs < minAgeMs) {
        const ageHours = Math.max(0, Math.round(ageMs / (1000 * 60 * 60)));
        diagnostics.push({
          name,
          detail: `skipped: merged branch has newer commit within minAgeDays (${ageHours}h ago < ${minAgeDays * 24}h threshold)`
        });
      } else {
        const ageDays = Math.max(0, Math.round(ageMs / (1000 * 60 * 60 * 24)));
        deletions.push({ name, reason: 'merged' });
        diagnostics.push({ name, detail: `eligible for deletion (merged ${ageDays}d ago)` });
      }
      continue;
    }

    const commitMs = await resolveCommitTimestampMs(branch, getCommitTimestampMs);
    if (commitMs <= 0) {
      diagnostics.push({ name, detail: 'skipped: unable to determine commit timestamp' });
      continue;
    }

    const closedUnmergedAt = closedUnmergedBranches.get(name) ?? 0;
    if (closedUnmergedAt > 0) {
      const activityMs = Math.max(closedUnmergedAt, commitMs);
      const ageMs = nowMs - activityMs;
      if (ageMs < minAgeMs) {
        const ageHours = Math.max(0, Math.round(ageMs / (1000 * 60 * 60)));
        diagnostics.push({
          name,
          detail: `skipped: closed unmerged PR branch recent (${ageHours}h ago < ${minAgeDays * 24}h threshold)`
        });
      } else {
        const ageDays = Math.max(0, Math.round(ageMs / (1000 * 60 * 60 * 24)));
        deletions.push({ name, reason: 'closed-unmerged' });
        diagnostics.push({ name, detail: `eligible for deletion (closed unmerged PR ${ageDays}d ago)` });
      }
      continue;
    }

    const ageMs = nowMs - commitMs;
    if (ageMs < unmergedMinAgeMs) {
      const ageHours = Math.max(0, Math.round(ageMs / (1000 * 60 * 60)));
      diagnostics.push({
        name,
        detail: `skipped: unmerged branch active recently (${ageHours}h ago < ${unmergedMinAgeDays * 24}h threshold)`
      });
    } else {
      const ageDays = Math.max(0, Math.round(ageMs / (1000 * 60 * 60 * 24)));
      deletions.push({ name, reason: 'stale-unmerged' });
      diagnostics.push({ name, detail: `eligible for deletion (unmerged stale ${ageDays}d ago)` });
    }
  }

  return { deletions, diagnostics };
};

export const runCleanupBranches = async (rawOptions = {}) => {
  const repository = rawOptions.repository ?? process.env.GITHUB_REPOSITORY ?? '';
  const [owner, repo] = repository.split('/');

  if (!owner || !repo) {
    throw new Error('cleanup-branches: GITHUB_REPOSITORY must be set to "owner/repo".');
  }

  const token = rawOptions.token ?? process.env.GITHUB_TOKEN ?? '';
  if (!token) {
    throw new Error('cleanup-branches: GITHUB_TOKEN is required.');
  }

  const dryRun =
    rawOptions.dryRun !== undefined
      ? Boolean(rawOptions.dryRun)
      : (process.env.BRANCH_CLEANUP_DRY_RUN ?? 'false').toLowerCase() === 'true';

  const minAgeDays = parseNonNegativeDays(
    rawOptions.minAgeDays ?? process.env.BRANCH_CLEANUP_MIN_AGE_DAYS,
    1
  );
  const unmergedMinAgeDays = parseNonNegativeDays(
    rawOptions.unmergedMinAgeDays ?? process.env.BRANCH_CLEANUP_UNMERGED_MIN_AGE_DAYS,
    minAgeDays
  );

  const includePrefixes = Array.isArray(rawOptions.includePrefixes)
    ? rawOptions.includePrefixes
    : parsePrefixes(process.env.BRANCH_CLEANUP_PREFIXES ?? '');

  const baseUrl = `https://api.github.com/repos/${owner}/${repo}`;
  const headers = createHeaders(token);
  const reqOpts = {
    headers,
    fetchImpl: rawOptions.fetchImpl ?? globalThis.fetch,
    sleepImpl: rawOptions.sleepImpl ?? defaultSleep,
    baseDelayMs: rawOptions.baseDelayMs ?? 1000,
    timeoutMs: rawOptions.timeoutMs ?? 30000,
    retries: rawOptions.retries ?? 4,
  };

  const { data: repoInfo } = await requestWithRetry(`${baseUrl}`, reqOpts);
  const defaultBranch = repoInfo?.default_branch ?? 'main';

  console.log('cleanup-branches: starting cleanup with configuration:');
  console.log(`- repository: ${owner}/${repo}`);
  console.log(`- dry run: ${dryRun}`);
  console.log(`- allowed prefixes: ${includePrefixes.length > 0 ? includePrefixes.join(', ') : 'none configured (safe mode: skipping all)'}`);
  console.log(`- minimum age (merged/closed PR): ${minAgeDays} day(s)`);
  console.log(`- minimum age (stale unmerged): ${unmergedMinAgeDays} day(s)`);

  const pulls = await paginate(baseUrl, 'pulls', { state: 'open', sort: 'updated', direction: 'desc' }, reqOpts);
  const activeBranches = new Set();
  for (const pull of pulls) {
    const branch = pull?.head?.ref;
    if (branch) {
      activeBranches.add(branch);
    }
  }

  const closedPulls = await paginate(baseUrl, 'pulls', { state: 'closed', sort: 'updated', direction: 'desc' }, reqOpts);
  const mergedBranches = new Map();
  const closedUnmergedBranches = new Map();
  for (const pull of closedPulls) {
    const branch = pull?.head?.ref;
    const headRepo = pull?.head?.repo?.full_name;
    if (!branch || headRepo !== repository) {
      continue;
    }
    const merged = pull?.merged_at;
    if (merged) {
      const mergedTime = new Date(merged).getTime();
      const existing = mergedBranches.get(branch) ?? 0;
      if (Number.isFinite(mergedTime) && mergedTime > existing) {
        mergedBranches.set(branch, mergedTime);
      }
    } else {
      const closed = pull?.closed_at || pull?.updated_at;
      if (closed) {
        const closedTime = new Date(closed).getTime();
        const existing = closedUnmergedBranches.get(branch) ?? 0;
        if (Number.isFinite(closedTime) && closedTime > existing) {
          closedUnmergedBranches.set(branch, closedTime);
        }
      }
    }
  }

  const branches = await paginate(baseUrl, 'branches', {}, reqOpts);
  const getCommitTimestampMs = async (sha) => {
    const { data: commitData } = await requestWithRetry(`${baseUrl}/commits/${encodeURIComponent(sha)}`, reqOpts);
    const isoDate = commitData?.commit?.committer?.date || commitData?.commit?.author?.date || '';
    const parsed = Date.parse(isoDate);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const { deletions, diagnostics } = await evaluateBranchesForCleanup({
    branches,
    defaultBranch,
    includePrefixes,
    activeBranches,
    mergedBranches,
    closedUnmergedBranches,
    getCommitTimestampMs,
    minAgeDays,
    unmergedMinAgeDays,
    nowMs: rawOptions.nowMs ?? Date.now(),
  });

  console.log(`cleanup-branches: evaluated ${branches.length} branch(es); ${deletions.length} eligible for deletion.`);

  if (diagnostics.length > 0) {
    console.log('cleanup-branches: branch diagnostics:');
    for (const entry of diagnostics) {
      console.log(`- ${entry.name}: ${entry.detail}`);
    }
  }

  if (deletions.length === 0) {
    console.log('cleanup-branches: no branches matched cleanup criteria.');
    return { deleted: [], evaluated: branches.length, diagnostics };
  }

  deletions.sort((a, b) => a.name.localeCompare(b.name));

  let deletedCount = 0;
  const deleted = [];

  for (const entry of deletions) {
    const branchName = entry.name;
    if (dryRun) {
      console.log(`cleanup-branches: dry run - would delete ${branchName}.`);
      continue;
    }

    console.log(`cleanup-branches: deleting ${branchName}.`);
    await requestWithRetry(`${baseUrl}/git/refs/heads/${encodeRefPath(branchName)}`, {
      ...reqOpts,
      method: 'DELETE',
      retries: rawOptions.deleteRetries ?? 2,
    });
    deletedCount += 1;
    deleted.push(branchName);
  }

  if (dryRun) {
    console.log(`cleanup-branches: dry run completed for ${deletions.length} branch(es).`);
  } else {
    console.log(`cleanup-branches: deleted ${deletedCount} branch(es).`);
  }

  return { deleted, evaluated: branches.length, diagnostics };
};

const isCliEntry = Boolean(
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
);

if (isCliEntry) {
  runCleanupBranches().catch((error) => {
    console.error('cleanup-branches: failed to clean up branches');
    if (error && error.stack) {
      console.error(error.stack);
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  });
}
