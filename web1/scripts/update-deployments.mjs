#!/usr/bin/env node
import fs from 'node:fs';

const parseJson = (text, fallback) => {
  try {
    return JSON.parse(text);
  } catch (error) {
    return fallback;
  }
};

const readJsonFile = (path, fallback) => {
  try {
    const contents = fs.readFileSync(path, 'utf8');
    return parseJson(contents, fallback);
  } catch (error) {
    return fallback;
  }
};

const toString = (value) => String(value ?? '').trim();

const deriveKey = (entry) => {
  if (!entry || typeof entry !== 'object') {
    return '';
  }

  const candidates = [entry.key, entry.safeName, entry.branch];
  for (const candidate of candidates) {
    const key = toString(candidate);
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

  if (Array.isArray(value)) {
    const result = {};
    for (const entry of value) {
      const key = deriveKey(entry);
      if (!key) {
        continue;
      }
      if (entry && typeof entry === 'object') {
        result[key] = { ...entry, key };
      }
    }
    return result;
  }

  if (typeof value === 'object') {
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      if (!key) {
        continue;
      }
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      const derivedKey = deriveKey(entry) || key;
      result[key] = { ...entry, key: derivedKey };
    }
    return result;
  }

  return {};
};

const deploymentsPath = process.env.DEPLOY_DATA_PATH || 'deployments.json';
const deployments = normaliseDeployments(readJsonFile(deploymentsPath, {}));

const targetKey = toString(process.env.DEPLOY_TARGET_KEY);
const branchName = toString(process.env.DEPLOY_BRANCH);
const safeName = toString(process.env.DEPLOY_SAFE_NAME);
const commit = toString(process.env.DEPLOY_COMMIT);
const message = toString(process.env.DEPLOY_MESSAGE);
const actor = toString(process.env.DEPLOY_ACTOR);
const timestamp = toString(process.env.DEPLOY_TIMESTAMP);
const commitUrl = toString(process.env.DEPLOY_URL);

const activeListRaw = process.env.DEPLOY_ACTIVE;
const activeList = (() => {
  if (!activeListRaw) {
    return [];
  }
  const parsed = parseJson(activeListRaw, []);
  return Array.isArray(parsed) ? parsed : [];
})();

const activeSet = new Set(['main']);
for (const value of activeList) {
  const key = toString(value);
  if (key) {
    activeSet.add(key);
  }
}
if (targetKey) {
  activeSet.add(targetKey);
}
if (safeName) {
  activeSet.add(safeName);
}

if (targetKey) {
  const previous = deployments[targetKey] && typeof deployments[targetKey] === 'object'
    ? deployments[targetKey]
    : {};
  deployments[targetKey] = {
    ...previous,
    key: targetKey,
    branch: branchName || previous.branch || safeName || targetKey,
    safeName: safeName || previous.safeName || (targetKey === 'main' ? '' : targetKey),
    commit: commit || previous.commit || '',
    message: message || previous.message || '',
    actor: actor || previous.actor || '',
    deployedAt: timestamp || previous.deployedAt || '',
    commitUrl: commitUrl || previous.commitUrl || '',
  };
}

const shouldKeep = (key, entry) => {
  if (!key) {
    return false;
  }
  if (key === 'main') {
    return true;
  }
  if (activeSet.has(key)) {
    return true;
  }
  if (entry && typeof entry === 'object') {
    const branch = toString(entry.branch);
    const safe = toString(entry.safeName);
    if (branch && activeSet.has(branch)) {
      return true;
    }
    if (safe && activeSet.has(safe)) {
      return true;
    }
  }
  return false;
};

for (const key of Object.keys(deployments)) {
  const entry = deployments[key];
  if (!shouldKeep(key, entry)) {
    delete deployments[key];
  }
}

const orderedKeys = Object.keys(deployments).sort((a, b) => {
  if (a === 'main') {
    return -1;
  }
  if (b === 'main') {
    return 1;
  }
  return a.localeCompare(b);
});

const output = {};
for (const key of orderedKeys) {
  const entry = deployments[key];
  if (entry && typeof entry === 'object') {
    output[key] = { ...entry, key };
  }
}

fs.writeFileSync(deploymentsPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
