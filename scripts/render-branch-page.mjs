#!/usr/bin/env node
const headerLines = [
  '          <!DOCTYPE html>',
  '          <html lang="en">',
  '          <head>',
  '            <meta charset="utf-8">',
  '            <meta name="viewport" content="width=device-width, initial-scale=1">',
  '            <title>Capy Branch Deployments</title>',
  '            <style>',
  '              body {',
  '                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans", sans-serif;',
  '                max-width: 960px;',
  '                margin: 40px auto;',
  '                padding: 0 20px 40px;',
  '                line-height: 1.6;',
  '                color: #24292e;',
  '                background: #f6f8fa;',
  '              }',
  '              h1 {',
  '                margin-bottom: 16px;',
  '              }',
  '              ul.deployments {',
  '                list-style: none;',
  '                padding: 0;',
  '                margin: 0;',
  '                display: grid;',
  '                gap: 16px;',
  '              }',
  '              li.card {',
  '                background: #fff;',
  '                border: 1px solid #d0d7de;',
  '                border-radius: 8px;',
  '                padding: 16px;',
  '                box-shadow: 0 1px 0 rgba(31,35,40,0.04);',
  '              }',
  '              li.card.main {',
  '                border-color: #4c8eda;',
  '                box-shadow: 0 4px 12px rgba(76,142,218,0.12);',
  '              }',
  '              .branch-title {',
  '                display: flex;',
  '                flex-wrap: wrap;',
  '                align-items: baseline;',
  '                gap: 8px;',
  '                margin-bottom: 12px;',
  '              }',
  '              .branch-name {',
  '                font-size: 1.1em;',
  '                font-weight: 600;',
  '                color: #1f2328;',
  '              }',
  '              .branch-name a {',
  '                color: inherit;',
  '                text-decoration: none;',
  '              }',
  '              .branch-name a:hover {',
  '                text-decoration: underline;',
  '              }',
  '              .commit-list {',
  '                list-style: none;',
  '                margin: 0;',
  '                padding: 0;',
  '                display: grid;',
  '                gap: 10px;',
  '              }',
  '              .commit-item {',
  '                font-size: 0.95em;',
  '                color: #1f2328;',
  '                display: flex;',
  '                flex-wrap: wrap;',
  '                align-items: baseline;',
  '                gap: 10px;',
  '              }',
  '              .commit-item > * {',
  '                flex-shrink: 0;',
  '              }',
  '              .commit-time {',
  '                color: #57606a;',
  '                font-weight: 600;',
  '                font-variant-numeric: tabular-nums;',
  '              }',
  '              .commit-time time {',
  '                color: inherit;',
  '              }',
  '              .commit-pr,',
  '              .commit-branch,',
  '              .commit-sha {',
  "                font-family: ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace;",
  '                font-size: 0.9em;',
  '                font-weight: 600;',
  '                text-decoration: none;',
  '              }',
  '              .commit-pr {',
  '                color: #8250df;',
  '              }',
  '              .commit-pr:hover {',
  '                text-decoration: underline;',
  '              }',
  '              .commit-branch {',
  '                color: #1f2328;',
  '              }',
  '              .commit-branch:hover {',
  '                text-decoration: underline;',
  '              }',
  '              .commit-sha {',
  '                color: #0969da;',
  '              }',
  '              .commit-sha:hover {',
  '                text-decoration: underline;',
  '              }',
  '              .commit-message {',
  '                font-weight: 500;',
  '                color: #1f2328;',
  '                flex: 1 1 220px;',
  '                min-width: 200px;',
  '              }',
  '            </style>',
  '          </head>',
  '          <body>',
  '            <h1>Capy Branch Deployments</h1>',
  '            <ul class="deployments">',
];
const footerLines = [
  '            </ul>',
  '            <script>',
  '              (() => {',
  '                const baseOptions = {',
  "                  weekday: 'short',",
  "                  year: 'numeric',",
  "                  month: 'short',",
  "                  day: '2-digit',",
  "                  hour: 'numeric',",
  "                  minute: '2-digit',",
  '                  hour12: true',
  '                };',
  '',
  '                let zoneFormatter = null;',
  '                try {',
  "                  zoneFormatter = new Intl.DateTimeFormat(undefined, { ...baseOptions, timeZoneName: 'short' });",
  '                } catch (error) {',
  '                  zoneFormatter = null;',
  '                }',
  '',
  '                const fallbackFormatter = new Intl.DateTimeFormat(undefined, baseOptions);',
  '',
  '                const formatParts = (formatter, date) => {',
  '                  if (!formatter) {',
  '                    return null;',
  '                  }',
  '',
  '                  try {',
  '                    const parts = formatter.formatToParts(date);',
  '                    const find = (type) => {',
  '                      const entry = parts.find((part) => part.type === type);',
  "                      return entry ? entry.value : '';",
  '                    };',
  '',
  "                    const month = find('month');",
  "                    const rawDay = find('day');",
  "                    const day = rawDay ? rawDay.padStart(2, '0') : '';",
  "                    const year = find('year');",
  "                    const hour = find('hour');",
  "                    const minute = find('minute');",
  "                    const period = find('dayPeriod');",
  "                    const weekday = find('weekday');",
  "                    const zone = find('timeZoneName');",
  '',
  '                    if (!month || !day || !year || !hour || !minute || !period || !weekday) {',
  '                      return null;',
  '                    }',
  '',
  '                    const time = `${hour}:${minute}${period.toLowerCase()}`;',
  '                    const base = `${time} ${weekday} ${month} ${day}, ${year}`;',
  "                    const zoneSuffix = zone ? ` ${zone}` : '';",
  '                    return `${base}${zoneSuffix}`;',
  '                  } catch (error) {',
  '                    return null;',
  '                  }',
  '                };',
  '',
  "                const elements = document.querySelectorAll('[data-local-datetime]');",
  '                for (const element of elements) {',
  "                  const iso = element.getAttribute('data-local-datetime');",
  '                  if (!iso) {',
  '                    continue;',
  '                  }',
  '',
  '                  const date = new Date(iso);',
  '                  if (Number.isNaN(date.getTime())) {',
  '                    continue;',
  '                  }',
  '',
  '                  const display = formatParts(zoneFormatter, date) ?? formatParts(fallbackFormatter, date);',
  '                  if (display) {',
  '                    element.textContent = display;',
  '                  }',
  '                }',
  '              })();',
  '            </script>',
  '          </body>',
  '          </html>',
];
import fs from 'node:fs';

const readJson = (path, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch (error) {
    return fallback;
  }
};

const deployments = readJson(process.env.DEPLOY_DATA_PATH, {});
const prList = readJson(process.env.PR_DATA_PATH, []);
const mainData = readJson(process.env.MAIN_DATA_PATH, { commits: [] });
const branchCommits = readJson(process.env.BRANCH_COMMITS_PATH, {});
const repoSlug = process.env.GITHUB_REPOSITORY ?? '';
const githubBaseUrl = repoSlug ? `https://github.com/${repoSlug}` : '';
const githubBranchUrl = (branch) => {
  if (!githubBaseUrl) {
    return '';
  }

  const name = String(branch ?? '').trim();
  if (!name) {
    return '';
  }

  return `${githubBaseUrl}/tree/${encodeURIComponent(name)}`;
};

const htmlEscape = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const firstLine = (text) => {
  const str = String(text ?? '');
  const newlineIndex = str.indexOf('\n');
  return newlineIndex === -1 ? str : str.slice(0, newlineIndex);
};

const formatDate = (value) => {
  if (!value) {
    return { text: '', iso: '' };
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { text: '', iso: '' };
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).formatToParts(date);

  const get = (type) => {
    const part = parts.find((entry) => entry.type === type);
    return part ? part.value : '';
  };

  const month = get('month');
  const rawDay = get('day');
  const day = rawDay ? rawDay.padStart(2, '0') : '';
  const year = get('year');
  const hour = get('hour');
  const minute = get('minute');
  const period = get('dayPeriod');
  const weekday = get('weekday');

  if (!month || !day || !year || !hour || !minute || !period || !weekday) {
    return { text: '', iso: '' };
  }

  const time = `${hour}:${minute}${period.toLowerCase()}`;
  const text = `${time} ${weekday} ${month} ${day}, ${year}`;
  return { text, iso: date.toISOString() };
};

const renderDate = (value, className = 'commit-time') => {
  const { text, iso } = formatDate(value);
  if (iso) {
    return `<time class="${htmlEscape(className)}" datetime="${htmlEscape(iso)}" data-local-datetime="${htmlEscape(iso)}">${htmlEscape(text)}</time>`;
  }
  if (text) {
    return `<span class="${htmlEscape(className)}">${htmlEscape(text)}</span>`;
  }
  return '';
};

const prByBranch = new Map();
const prBySafe = new Map();

for (const pr of prList) {
  if (pr && typeof pr === 'object') {
    if (pr.branch) {
      prByBranch.set(pr.branch, pr);
    }
    if (pr.safeName) {
      prBySafe.set(pr.safeName, pr);
    }
  }
}

const branchPr = (entry) => {
  const value = entry.value ?? {};
  return prByBranch.get(value.branch) ?? prBySafe.get(value.safeName) ?? null;
};

const branchCommitsFor = (entry) => {
  const value = entry.value ?? {};
  const branchName = value.branch ?? '';
  const safeName = value.safeName ?? '';
  const commits = branchCommits?.[branchName] ?? branchCommits?.[safeName] ?? [];
  return Array.isArray(commits) ? commits : [];
};

const baseData = (entry) => {
  const value = entry.value ?? {};

  return {
    branch: value.branch ?? '',
    safe: value.safeName ?? '',
    deployed: value.deployedAt ?? 'unknown',
    actor: value.actor ?? 'unknown',
    commit: value.commit ?? '',
    message: value.message ?? '',
    url: value.commitUrl ?? '#'
  };
};

const uniqueCommits = (commits) => {
  const seen = new Set();
  const results = [];

  for (const commit of Array.isArray(commits) ? commits : []) {
    const sha = commit?.sha ?? commit?.shortSha ?? commit?.htmlUrl ?? commit?.message ?? null;
    const key = sha ? String(sha) : null;
    if (key && seen.has(key)) {
      continue;
    }
    if (key) {
      seen.add(key);
    }
    results.push(commit);
  }

  return results;
};

const normalizeSha = (value) => String(value ?? '').trim().toLowerCase();

const commitMatchesSha = (commit, target) => {
  const normalizedTarget = normalizeSha(target);
  if (!normalizedTarget) {
    return false;
  }

  const candidates = [
    normalizeSha(commit?.sha),
    normalizeSha(commit?.shortSha)
  ].filter(Boolean);

  return candidates.some((candidate) => normalizedTarget.startsWith(candidate) || candidate.startsWith(normalizedTarget));
};

const excludeCommitBySha = (commits, target) => (Array.isArray(commits) ? commits : []).filter((commit) => !commitMatchesSha(commit, target));

const firstPullRequest = (commit) => {
  const list = Array.isArray(commit?.prs) ? commit.prs : [];
  for (const pr of list) {
    if (pr && typeof pr === 'object') {
      return pr;
    }
  }
  return null;
};

const commitItem = (commit, { fallbackPr = null, fallbackBranch = '', fallbackMessage = '', fallbackSha = '', fallbackUrl = '' } = {}) => {
  if (!commit || typeof commit !== 'object') {
    commit = {};
  }

  const message = firstLine(commit.message ?? fallbackMessage ?? '');
  const resolvedSha = commit.sha ?? fallbackSha ?? '';
  const shortSha = commit.shortSha ?? (resolvedSha ? String(resolvedSha).slice(0, 7) : '');
  const commitUrl = commit.htmlUrl ?? fallbackUrl ?? '';
  const dateMarkup = renderDate(commit.date ?? '');
  const pr = firstPullRequest(commit) ?? fallbackPr;
  const prNumber = pr?.number != null ? String(pr.number) : '';
  const prUrl = pr?.url ?? '';

  const branchName = (() => {
    const fromPr = pr?.branch ? String(pr.branch).trim() : '';
    if (fromPr) {
      return fromPr;
    }
    if (fallbackBranch) {
      return String(fallbackBranch).trim();
    }
    return '';
  })();
  const branchUrl = branchName ? githubBranchUrl(branchName) : '';

  const segments = [];

  if (dateMarkup) {
    segments.push(dateMarkup);
  }

  if (prNumber) {
    const label = `#${htmlEscape(prNumber)}`;
    if (prUrl) {
      segments.push(`<a class="commit-pr" href="${htmlEscape(prUrl)}">${label}</a>`);
    } else {
      segments.push(`<span class="commit-pr">${label}</span>`);
    }
  }

  if (branchName) {
    const branchLabel = htmlEscape(branchName);
    if (branchUrl) {
      segments.push(`<a class="commit-branch" href="${htmlEscape(branchUrl)}">${branchLabel}</a>`);
    } else {
      segments.push(`<span class="commit-branch">${branchLabel}</span>`);
    }
  }

  if (shortSha) {
    if (commitUrl) {
      segments.push(`<a class="commit-sha" href="${htmlEscape(commitUrl)}">${htmlEscape(shortSha)}</a>`);
    } else {
      segments.push(`<span class="commit-sha">${htmlEscape(shortSha)}</span>`);
    }
  }

  if (message) {
    segments.push(`<span class="commit-message">${htmlEscape(message)}</span>`);
  }

  if (segments.length === 0) {
    return '';
  }

  return `<li class="commit-item">${segments.join(' ')}</li>`;
};

const renderMain = (entry) => {
  const data = baseData(entry);
  const commits = uniqueCommits(mainData.commits);
  const items = [];

  const findMatchingCommit = () => {
    const targetSha = data.commit ? String(data.commit) : '';
    if (!targetSha) {
      return null;
    }

    const targetShort = targetSha.slice(0, 7);
    for (const commit of commits) {
      const sha = commit?.sha ? String(commit.sha) : '';
      const shortSha = commit?.shortSha ? String(commit.shortSha) : sha.slice(0, 7);
      if (sha && sha === targetSha) {
        return commit;
      }
      if (shortSha && targetShort && shortSha === targetShort) {
        return commit;
      }
    }
    return null;
  };

  const matchingCommit = findMatchingCommit();
  if (matchingCommit) {
    const enriched = {
      ...matchingCommit,
      date: data.deployed || matchingCommit.date || '',
      message: data.message || matchingCommit.message || '',
      sha: matchingCommit.sha || data.commit || '',
      shortSha: matchingCommit.shortSha || (data.commit ? String(data.commit).slice(0, 7) : ''),
      htmlUrl: data.url || matchingCommit.htmlUrl || ''
    };
    items.push(commitItem(enriched));
  } else {
    const fallback = {
      date: data.deployed || '',
      message: data.message || '',
      sha: data.commit || '',
      shortSha: data.commit ? String(data.commit).slice(0, 7) : '',
      htmlUrl: data.url || ''
    };
    const markup = commitItem(fallback);
    if (markup) {
      items.push(markup);
    }
  }

  let remaining = commits;
  if (matchingCommit) {
    remaining = commits.filter((commit) => commit?.sha !== matchingCommit.sha);
  }

  for (const commit of remaining) {
    if (items.length >= 3) {
      break;
    }
    const markup = commitItem(commit);
    if (markup) {
      items.push(markup);
    }
  }

  const previewHref = data.safe ? `./${data.safe}/` : './';
  const branchLabel = previewHref ? `<a href="${htmlEscape(previewHref)}">main</a>` : 'main';

  let html = `<li class="card main">`;
  html += `<div class="branch-title"><span class="branch-name">${branchLabel}</span></div>`;
  html += `<ul class="commit-list">${items.join('')}</ul>`;
  html += `</li>\n`;
  return html;
};

const renderBranch = (entry) => {
  const data = baseData(entry);
  const pr = branchPr(entry);
  const branchName = firstLine(data.branch ?? '') || 'unknown branch';
  const commits = uniqueCommits(branchCommitsFor(entry));
  const items = [];

  const fallbackPr = pr ? {
    ...pr,
    branch: pr.branch ?? data.branch ?? ''
  } : null;

  const previewHref = data.safe ? `./${data.safe}/` : './';
  const displayName = htmlEscape(branchName);
  const branchTitle = previewHref ? `<a href="${htmlEscape(previewHref)}">${displayName}</a>` : displayName;

  const deploymentCommit = {
    date: data.deployed || '',
    message: data.message || '',
    sha: data.commit || '',
    shortSha: data.commit ? String(data.commit).slice(0, 7) : '',
    htmlUrl: data.url || '',
    prs: fallbackPr ? [fallbackPr] : []
  };

  const deploymentMarkup = commitItem(deploymentCommit, { fallbackPr, fallbackBranch: data.branch });
  if (deploymentMarkup) {
    items.push(deploymentMarkup);
  }

  for (const commit of commits) {
    if (items.length >= 3) {
      break;
    }
    const markup = commitItem(commit, { fallbackPr, fallbackBranch: data.branch });
    if (markup) {
      items.push(markup);
    }
  }

  let html = `<li class="card">`;
  html += `<div class="branch-title"><span class="branch-name">${branchTitle}</span></div>`;
  html += `<ul class="commit-list">${items.join('')}</ul>`;
  html += `</li>\n`;
  return html;
};

const toTimestamp = (value) => {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const entries = Object.entries(deployments ?? {}).map(([key, value]) => ({ key, value }));
let output = '';

const mainEntry = entries.find((entry) => entry.key === 'main' && entry.value);
if (mainEntry) {
  output += renderMain(mainEntry);
}

const branchEntries = entries
  .filter((entry) => entry.key !== 'main')
  .filter((entry) => branchPr(entry));

branchEntries.sort((a, b) => toTimestamp(b.value?.deployedAt) - toTimestamp(a.value?.deployedAt));

for (const entry of branchEntries) {
  output += renderBranch(entry);
}

const dynamicHtml = output;

const header = `${headerLines.join('\n')}\n`;
const footer = `${footerLines.join('\n')}\n`;
const branchHtmlPath = process.env.BRANCH_HTML_PATH ?? 'branch.html';
fs.writeFileSync(branchHtmlPath, `${header}${dynamicHtml}${footer}`, 'utf8');
