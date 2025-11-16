#!/usr/bin/env node
import process from 'node:process';

const repository = process.env.GITHUB_REPOSITORY ?? '';
const [owner, repo] = repository.split('/');

if (!owner || !repo) {
  console.error('cleanup-branches: GITHUB_REPOSITORY must be set to "owner/repo".');
  process.exitCode = 1;
  process.exit();
}

const token = process.env.GITHUB_TOKEN ?? '';
if (!token) {
  console.error('cleanup-branches: GITHUB_TOKEN is required.');
  process.exitCode = 1;
  process.exit();
}

const baseUrl = `https://api.github.com/repos/${owner}/${repo}`;
const fetchHeaders = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'capy-branch-cleanup-script'
};

if (token) {
  fetchHeaders.Authorization = `Bearer ${token}`;
}

const cutoffDays = Number.parseInt(process.env.BRANCH_CLEANUP_CUTOFF_DAYS ?? '30', 10);
const cutoffMillis = Number.isFinite(cutoffDays) && cutoffDays > 0 ? cutoffDays * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
const cutoffDate = new Date(Date.now() - cutoffMillis);
const dryRun = (process.env.BRANCH_CLEANUP_DRY_RUN ?? 'false').toLowerCase() === 'true';

const includePrefixes = (() => {
  const raw = process.env.BRANCH_CLEANUP_PREFIXES ?? 'automation/';
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
})();

const sleep = async (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  const { params, method = 'GET', body, retries = 2 } = options;
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
    const response = await fetch(requestUrl, {
      method,
      headers: fetchHeaders,
      body
    });

    if (response.ok) {
      if (method === 'DELETE' || response.status === 204) {
        return { data: null, response };
      }
      const json = await response.json();
      const linkHeader = response.headers.get('link');
      return { data: json, response, links: parseLinkHeader(linkHeader ?? '') };
    }

    if (response.status === 403 && attempt < retries) {
      const reset = response.headers.get('x-ratelimit-reset');
      if (reset) {
        const resetTime = Number.parseInt(reset, 10) * 1000;
        const delay = Math.max(resetTime - Date.now(), 1000);
        await sleep(delay);
        continue;
      }
    }

    const text = await response.text();
    throw new Error(`GitHub request failed with ${response.status}: ${text || response.statusText}`);
  }

  throw new Error('GitHub request failed after retries.');
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

const fetchRepository = async () => {
  const { data } = await request(`${baseUrl}`);
  return data;
};

const fetchBranches = async () => paginate('branches');

const fetchOpenPulls = async () => paginate('pulls', { state: 'open', sort: 'updated', direction: 'desc' });

const branchMatchesPrefix = (name) => {
  if (!name) {
    return false;
  }
  if (includePrefixes.length === 0) {
    return true;
  }
  return includePrefixes.some((prefix) => name.startsWith(prefix));
};

const parseCommitDate = (branch) => {
  const commit = branch?.commit?.commit;
  const authorDate = commit?.author?.date;
  const committerDate = commit?.committer?.date;
  const date = committerDate || authorDate || '';
  const parsed = date ? new Date(date) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
};

const encodeRefPath = (ref) => ref.split('/')
  .filter((segment) => segment.length > 0)
  .map((segment) => encodeURIComponent(segment))
  .join('/');

const main = async () => {
  const repoInfo = await fetchRepository();
  const defaultBranch = repoInfo?.default_branch ?? 'main';

  const pulls = await fetchOpenPulls();
  const activeBranches = new Set();
  for (const pull of pulls) {
    const branch = pull?.head?.ref;
    if (branch) {
      activeBranches.add(branch);
    }
  }

  const branches = await fetchBranches();
  const deletions = [];

  for (const branch of branches) {
    const name = branch?.name ?? '';
    if (!name) {
      continue;
    }
    if (name === defaultBranch) {
      continue;
    }
    if (branch.protected) {
      continue;
    }
    if (!branchMatchesPrefix(name)) {
      continue;
    }
    if (activeBranches.has(name)) {
      continue;
    }

    const lastCommitDate = parseCommitDate(branch);
    if (!lastCommitDate) {
      continue;
    }

    if (lastCommitDate >= cutoffDate) {
      continue;
    }

    deletions.push({ name, lastCommitDate });
  }

  if (deletions.length === 0) {
    console.log('cleanup-branches: no branches matched cleanup criteria.');
    return;
  }

  deletions.sort((a, b) => a.lastCommitDate - b.lastCommitDate);

  let deletedCount = 0;

  for (const entry of deletions) {
    const branchName = entry.name;
    const dateIso = entry.lastCommitDate.toISOString();
    if (dryRun) {
      console.log(`cleanup-branches: dry run – would delete ${branchName} (last commit ${dateIso}).`);
      continue;
    }

    console.log(`cleanup-branches: deleting ${branchName} (last commit ${dateIso}).`);
    await request(`${baseUrl}/git/refs/heads/${encodeRefPath(branchName)}`, { method: 'DELETE', retries: 0 });
    deletedCount += 1;
  }

  if (dryRun) {
    console.log(`cleanup-branches: dry run completed for ${deletions.length} branch(es).`);
  } else {
    console.log(`cleanup-branches: deleted ${deletedCount} branch(es).`);
  }
};

main().catch((error) => {
  console.error('cleanup-branches: failed to clean up branches');
  if (error && error.stack) {
    console.error(error.stack);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
