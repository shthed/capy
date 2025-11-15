#!/usr/bin/env node
import fs from 'node:fs';

const header = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Capy Branch Overview</title>
  <style>
    :root {
      color-scheme: light;
    }
    body {
      margin: 0;
      padding: 24px 16px 40px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans", sans-serif;
      line-height: 1.6;
      color: #1f2328;
      background: #f6f8fa;
    }
    main {
      max-width: 960px;
      margin: 0 auto;
    }
    h1 {
      font-size: 1.8rem;
      margin: 0 0 12px;
    }
    p.description {
      margin: 0 0 24px;
      color: #57606a;
    }
    section.branch {
      background: #fff;
      border: 1px solid #d0d7de;
      border-radius: 10px;
      padding: 16px 20px;
      margin-bottom: 20px;
    }
    section.branch.main {
      border-color: #1f6feb;
      box-shadow: 0 6px 18px rgba(15, 76, 129, 0.12);
    }
    section.branch h2 {
      margin: 0 0 8px;
      font-size: 1.2rem;
    }
    section.branch h2 a {
      color: inherit;
      text-decoration: none;
    }
    section.branch h2 a:hover {
      text-decoration: underline;
    }
    .branch-meta {
      margin: 0 0 12px;
      color: #57606a;
      font-size: 0.92rem;
    }
    .branch-meta span + span::before {
      content: "•";
      margin: 0 6px;
      color: #8c959f;
    }
    ul.commit-list {
      margin: 0;
      padding-left: 1.25rem;
    }
    ul.commit-list li {
      margin: 0 0 8px;
    }
    .commit-sha {
      font-family: ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace;
      font-weight: 600;
      color: #0969da;
      text-decoration: none;
    }
    .commit-sha:hover {
      text-decoration: underline;
    }
    .commit-meta {
      color: #57606a;
      font-size: 0.85rem;
    }
  </style>
</head>
<body>
  <main>
    <h1>Capy Branch Overview</h1>
    <p class="description">This page lists every deployment branch alongside the commits captured when the metadata was generated.</p>
`;

const footer = `  </main>
</body>
</html>
`;

const htmlEscape = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const firstLine = (value) => {
  const text = String(value ?? '');
  const newlineIndex = text.indexOf('\n');
  return newlineIndex === -1 ? text : text.slice(0, newlineIndex);
};

const readJson = (path, fallback) => {
  if (!path) {
    return fallback;
  }

  try {
    const data = fs.readFileSync(path, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return fallback;
  }
};

const toKey = (value) => String(value ?? '').trim();

const deriveDeploymentKey = (entry) => {
  if (!entry || typeof entry !== 'object') {
    return '';
  }

  const candidates = [entry.key, entry.safeName, entry.branch];
  for (const candidate of candidates) {
    const key = toKey(candidate);
    if (key) {
      return key;
    }
  }

  return '';
};

const normaliseDeployments = (value) => {
  if (!value) {
    return {};
  }

  const result = {};
  const addEntry = (key, entry) => {
    const trimmed = toKey(key);
    if (!trimmed || !entry || typeof entry !== 'object') {
      return;
    }
    result[trimmed] = {
      ...entry,
      key: entry.key ?? trimmed,
    };
  };

  if (Array.isArray(value)) {
    for (const entry of value) {
      const key = deriveDeploymentKey(entry);
      addEntry(key, entry);
    }
    return result;
  }

  if (typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      addEntry(key, entry);
    }
    return result;
  }

  return {};
};

const deployments = normaliseDeployments(readJson(process.env.DEPLOY_DATA_PATH, {}));
const prList = readJson(process.env.PR_DATA_PATH, []);
const mainData = readJson(process.env.MAIN_DATA_PATH, { commits: [] });
const branchCommits = readJson(process.env.BRANCH_COMMITS_PATH, {});
const repoSlug = process.env.GITHUB_REPOSITORY ?? '';
const githubBaseUrl = repoSlug ? `https://github.com/${repoSlug}` : '';

const githubBranchUrl = (branch) => {
  const name = toKey(branch);
  return name && githubBaseUrl ? `${githubBaseUrl}/tree/${encodeURIComponent(name)}` : '';
};

const prByBranch = new Map();
const prBySafe = new Map();

for (const pr of Array.isArray(prList) ? prList : []) {
  if (!pr || typeof pr !== 'object') {
    continue;
  }
  if (pr.branch) {
    prByBranch.set(pr.branch, pr);
  }
  if (pr.safeName) {
    prBySafe.set(pr.safeName, pr);
  }
}

const branchPr = (entry) => {
  const value = entry?.value ?? {};
  return prByBranch.get(value.branch) ?? prBySafe.get(value.safeName) ?? null;
};

const uniqueCommits = (lists) => {
  const results = [];
  const seen = new Set();

  const push = (commit) => {
    if (!commit || typeof commit !== 'object') {
      return;
    }
    const key = commit.sha || commit.shortSha || commit.htmlUrl || commit.message;
    if (key && seen.has(key)) {
      return;
    }
    if (key) {
      seen.add(key);
    }
    results.push(commit);
  };

  for (const list of lists) {
    if (!Array.isArray(list)) {
      continue;
    }
    for (const commit of list) {
      push(commit);
    }
  }

  return results;
};

const normaliseCommit = (commit) => {
  if (!commit || typeof commit !== 'object') {
    return {
      sha: '',
      shortSha: '',
      message: '',
      date: '',
      htmlUrl: '',
      prs: []
    };
  }

  const message = firstLine(commit.message ?? '');
  const sha = String(commit.sha ?? '').trim();
  const shortSha = commit.shortSha ? String(commit.shortSha) : (sha ? sha.slice(0, 7) : '');
  const date = commit.date ? new Date(commit.date) : null;
  const isoDate = date && !Number.isNaN(date.getTime()) ? date.toISOString() : String(commit.date ?? '').trim();

  const prs = Array.isArray(commit.prs) ? commit.prs : [];

  return {
    sha,
    shortSha,
    message,
    date: isoDate,
    htmlUrl: commit.htmlUrl ?? commit.url ?? '',
    prs
  };
};

const renderCommit = (commit) => {
  const info = normaliseCommit(commit);
  const shaLabel = info.shortSha || info.sha || 'commit';
  const shaMarkup = info.htmlUrl
    ? `<a class="commit-sha" href="${htmlEscape(info.htmlUrl)}">${htmlEscape(shaLabel)}</a>`
    : `<span class="commit-sha">${htmlEscape(shaLabel)}</span>`;

  const segments = [shaMarkup];

  const pr = info.prs.find((entry) => entry && typeof entry === 'object' && entry.number != null);
  if (pr) {
    const label = `PR #${pr.number}`;
    if (pr.url) {
      segments.push(`<a href="${htmlEscape(pr.url)}">${htmlEscape(label)}</a>`);
    } else {
      segments.push(htmlEscape(label));
    }
  }

  if (info.message) {
    segments.push(htmlEscape(info.message));
  }

  if (info.date) {
    segments.push(`<span class="commit-meta">${htmlEscape(info.date)}</span>`);
  }

  return `<li>${segments.join(' – ')}</li>`;
};

const renderCommitList = (commits) => {
  if (!Array.isArray(commits) || commits.length === 0) {
    return '<li>No commits were recorded for this branch.</li>';
  }
  return commits.map((commit) => renderCommit(commit)).join('\n');
};

const renderBranchSection = (entry, { isMain = false } = {}) => {
  const value = entry?.value ?? {};
  const branchKey = toKey(value.branch);
  const entryKey = toKey(entry?.key);
  const safeName = toKey(value.safeName);
  const displayName = branchKey || (isMain ? 'main' : entryKey || 'unknown branch');
  const previewHref = isMain ? './' : (safeName ? `./${safeName}/` : '');
  const branchUrl = githubBranchUrl(branchKey || (isMain ? 'main' : ''));
  const pr = branchPr(entry);

  const metaPieces = [];
  if (previewHref) {
    metaPieces.push(`<span>Preview: <a href="${htmlEscape(previewHref)}">open</a></span>`);
  }
  if (branchUrl) {
    metaPieces.push(`<span>GitHub: <a href="${htmlEscape(branchUrl)}">${htmlEscape(branchKey || displayName)}</a></span>`);
  }
  if (pr) {
    const label = pr.number != null ? `PR #${pr.number}` : (pr.title ? firstLine(pr.title) : 'Pull request');
    const prLabel = pr.number != null ? label : firstLine(label);
    const prText = pr.url ? `<a href="${htmlEscape(pr.url)}">${htmlEscape(prLabel)}</a>` : htmlEscape(prLabel);
    metaPieces.push(`<span>${prText}</span>`);
  }
  if (value.deployedAt) {
    const deployedDate = new Date(value.deployedAt);
    const deployedText = !Number.isNaN(deployedDate.getTime())
      ? deployedDate.toISOString()
      : String(value.deployedAt);
    metaPieces.push(`<span>Last deployed: ${htmlEscape(deployedText)}</span>`);
  }
  if (value.actor) {
    metaPieces.push(`<span>Actor: ${htmlEscape(value.actor)}</span>`);
  }

  const deploymentCommit = value.commit || value.message || value.commitUrl || value.deployedAt
    ? [{
        sha: value.commit ?? '',
        shortSha: value.commit ? String(value.commit).slice(0, 7) : '',
        message: firstLine(value.message ?? ''),
        date: value.deployedAt ?? '',
        htmlUrl: value.commitUrl ?? '',
        prs: pr ? [pr] : []
      }]
    : [];

  const relatedCommits = uniqueCommits([
    deploymentCommit,
    isMain ? (Array.isArray(mainData.commits) ? mainData.commits : []) : [],
    branchKey ? branchCommits[branchKey] : [],
    safeName && safeName !== branchKey ? branchCommits[safeName] : [],
    !branchKey && entryKey ? branchCommits[entryKey] : []
  ]);

  const commitListMarkup = renderCommitList(relatedCommits);
  const indentedCommitList = commitListMarkup
    .split('\n')
    .map((line) => `        ${line}`)
    .join('\n');
  const sectionClass = isMain ? 'branch main' : 'branch';
  const title = previewHref ? `<a href="${htmlEscape(previewHref)}">${htmlEscape(displayName)}</a>` : htmlEscape(displayName);

  return `    <section class="${sectionClass}">
      <h2>${title}</h2>
      ${metaPieces.length ? `<p class="branch-meta">${metaPieces.join(' ')}</p>` : ''}
      <ul class="commit-list">
${indentedCommitList}
      </ul>
    </section>`;
};

const entries = Object.entries(deployments).map(([key, value]) => ({ key, value }));
entries.sort((a, b) => {
  if (a.key === 'main') {
    return -1;
  }
  if (b.key === 'main') {
    return 1;
  }
  return a.key.localeCompare(b.key);
});

let output = header;

for (const entry of entries) {
  const isMain = entry.key === 'main';
  output += `${renderBranchSection(entry, { isMain })}\n`;
}

output += footer;

const branchHtmlPath = process.env.BRANCH_HTML_PATH ?? 'branch.html';
fs.writeFileSync(branchHtmlPath, output, 'utf8');
