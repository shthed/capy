#!/usr/bin/env node
import fs from 'node:fs';

const repository = process.env.GITHUB_REPOSITORY ?? '';
const [owner, repo] = repository.split('/');

if (!owner || !repo) {
  console.error('prepare-deploy-metadata: GITHUB_REPOSITORY must be set to "owner/repo".');
  process.exitCode = 1;
  process.exit();
}

const token = process.env.GITHUB_TOKEN ?? '';
const perPageDefault = Number.parseInt(process.env.DEPLOY_METADATA_PER_PAGE ?? '100', 10) || 100;
const commitsPerBranch = Number.parseInt(process.env.DEPLOY_METADATA_COMMITS_PER_BRANCH ?? '4', 10) || 4;
const outputPath = process.env.DEPLOY_METADATA_PATH ?? 'deployment-metadata.json';
const baseUrl = `https://api.github.com/repos/${owner}/${repo}`;

const baseHeaders = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'capy-deploy-metadata-script'
};
if (token) {
  baseHeaders.Authorization = `Bearer ${token}`;
}

const toInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

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

const request = async (url, { params = {}, retries = 2 } = {}) => {
  const requestUrl = new URL(url);
  for (const [key, rawValue] of Object.entries(params)) {
    if (rawValue === undefined || rawValue === null || rawValue === '') {
      continue;
    }
    requestUrl.searchParams.set(key, rawValue);
  }

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const response = await fetch(requestUrl, { headers: baseHeaders });
    if (response.ok) {
      const json = await response.json();
      const linkHeader = response.headers.get('link');
      return { data: json, links: parseLinkHeader(linkHeader ?? '') };
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

const paginate = async (path, initialParams = {}, { perPageOverride, maxItems } = {}) => {
  const perPage = toInteger(perPageOverride ?? initialParams.per_page, perPageDefault);
  const params = { ...initialParams, per_page: Math.min(perPage, 100) };
  let page = toInteger(params.page, 1);
  const results = [];

  while (true) {
    const { data, links } = await request(`${baseUrl}/${path}`, { params: { ...params, page } });

    if (!Array.isArray(data)) {
      throw new Error(`Expected array response from ${path}, received ${typeof data}`);
    }

    results.push(...data);

    if (maxItems && results.length >= maxItems) {
      return results.slice(0, maxItems);
    }

    const hasNext = Boolean(links.next);
    if (!hasNext && data.length < params.per_page) {
      break;
    }

    if (!hasNext) {
      break;
    }

    page += 1;
  }

  return results;
};

const fetchBranch = async (name) => {
  const { data } = await request(`${baseUrl}/branches/${encodeURIComponent(name)}`);
  return data;
};

const fetchPulls = async () => {
  const pulls = await paginate('pulls', {
    state: 'open',
    sort: 'updated',
    direction: 'desc'
  });
  return pulls;
};

const fetchCommits = async (sha, { limit = commitsPerBranch } = {}) => {
  const perPage = Math.min(Math.max(limit, 1), 100);
  const commits = await paginate('commits', { sha }, { perPageOverride: perPage, maxItems: limit });
  return commits.slice(0, limit);
};

const toString = (value) => (value == null ? '' : String(value));

const safeBranchName = (branch) => toString(branch).replace(/[^a-zA-Z0-9._-]/g, '-');

const firstLine = (value) => {
  const text = toString(value);
  const newline = text.indexOf('\n');
  return newline === -1 ? text : text.slice(0, newline);
};

const summarisePull = (pull) => {
  if (!pull || typeof pull !== 'object') {
    return {
      number: null,
      title: '',
      branch: '',
      safeName: '',
      url: '',
      draft: false,
      updatedAt: null,
      createdAt: null,
      headSha: ''
    };
  }

  const branch = pull.head?.ref ?? '';
  const summary = {
    number: pull.number ?? null,
    title: firstLine(pull.title ?? ''),
    branch,
    safeName: safeBranchName(branch),
    url: pull.html_url ?? '',
    draft: Boolean(pull.draft),
    updatedAt: pull.updated_at ?? null,
    createdAt: pull.created_at ?? null,
    headSha: pull.head?.sha ?? ''
  };

  if (pull.user && typeof pull.user === 'object') {
    summary.author = {
      login: pull.user.login ?? '',
      htmlUrl: pull.user.html_url ?? '',
      avatarUrl: pull.user.avatar_url ?? ''
    };
  } else {
    summary.author = {
      login: '',
      htmlUrl: '',
      avatarUrl: ''
    };
  }

  return summary;
};

const summariseCommit = (commit, { pr = null } = {}) => {
  const commitData = commit && typeof commit === 'object' ? commit : {};
  const commitInfo = commitData.commit && typeof commitData.commit === 'object' ? commitData.commit : {};
  const authorInfo = commitInfo.author && typeof commitInfo.author === 'object' ? commitInfo.author : {};
  const committerInfo = commitInfo.committer && typeof commitInfo.committer === 'object' ? commitInfo.committer : {};
  const authorName = authorInfo.name || committerInfo.name || '';
  const authorDate = authorInfo.date || committerInfo.date || '';

  const summary = {
    sha: commitData.sha ?? '',
    shortSha: commitData.sha ? String(commitData.sha).slice(0, 7) : '',
    message: firstLine(commitInfo.message ?? ''),
    author: authorName,
    date: authorDate,
    htmlUrl: commitData.html_url ?? commitData.url ?? '',
    prs: []
  };

  if (pr && typeof pr === 'object') {
    summary.prs = [
      {
        number: pr.number ?? null,
        title: pr.title ?? '',
        url: pr.url ?? pr.htmlUrl ?? pr.html_url ?? '',
        branch: pr.branch ?? pr.safeName ?? '',
        safeName: pr.safeName ?? safeBranchName(pr.branch ?? '')
      }
    ];
  }

  return summary;
};

const listCommits = async (ref, { limit = commitsPerBranch, pr = null } = {}) => {
  const rawCommits = await fetchCommits(ref, { limit });
  return rawCommits.map((commit) => summariseCommit(commit, { pr }));
};

const normaliseCommitArray = (value) => (Array.isArray(value) ? value : []);

const main = async () => {
  const pulls = await fetchPulls();
  const pullSummaries = pulls.map(summarisePull);

  const mainBranchData = await fetchBranch('main');
  const mainCommits = await listCommits('main', { limit: commitsPerBranch });
  const mainSummary = {
    name: mainBranchData?.name ?? 'main',
    protected: Boolean(mainBranchData?.protected),
    head: summariseCommit(mainBranchData?.commit),
    commits: mainCommits,
    lastCommitDate: mainCommits[0]?.date ?? null,
    fetchedAt: new Date().toISOString()
  };

  const branchCommits = {};
  for (const pull of pullSummaries) {
    const branch = pull.branch ?? '';
    if (!branch) {
      continue;
    }

    const commits = await listCommits(branch, { limit: commitsPerBranch, pr: pull });
    branchCommits[branch] = normaliseCommitArray(commits);
    if (pull.safeName && pull.safeName !== branch) {
      branchCommits[pull.safeName] = normaliseCommitArray(commits);
    }
  }

  const metadata = {
    repository: {
      owner,
      name: repo,
      fullName: `${owner}/${repo}`
    },
    generatedAt: new Date().toISOString(),
    pullRequests: pullSummaries,
    mainBranch: mainSummary,
    branchCommits
  };

  fs.writeFileSync(outputPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
};

main().catch((error) => {
  console.error('prepare-deploy-metadata: failed to build metadata');
  if (error && error.stack) {
    console.error(error.stack);
  } else {
    console.error(error);
  }
  if (error && error.cause) {
    console.error('Cause:', error.cause);
  }
  process.exitCode = 1;
});
