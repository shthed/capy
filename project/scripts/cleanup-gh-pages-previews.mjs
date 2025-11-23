#!/usr/bin/env node
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const sanitize = (value) => (value || '').replace(/[^a-zA-Z0-9._-]/g, '-').trim();

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
  const options = { pagesDir: 'gh-pages' };

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--pages-dir') {
      options.pagesDir = args[index + 1] ?? options.pagesDir;
      index += 1;
    }
  }

  return options;
};

const findPreviewDirectories = (rootDir) => {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .filter((entry) => entry.name !== '.git' && entry.name !== 'README')
    .filter((entry) => entry.name === sanitize(entry.name))
    .map((entry) => ({ name: entry.name, absolutePath: path.join(rootDir, entry.name) }));
};

const deleteDirectory = (targetPath) => {
  fs.rmSync(targetPath, { recursive: true, force: true });
};

const main = () => {
  const { pagesDir } = parseArguments();
  const resolvedPagesDir = path.resolve(process.cwd(), pagesDir);

  if (!fs.existsSync(resolvedPagesDir) || !fs.statSync(resolvedPagesDir).isDirectory()) {
    console.error(`cleanup-gh-pages: pages directory not found at ${resolvedPagesDir}`);
    process.exitCode = 1;
    return;
  }

  const defaultBranch = resolveDefaultBranch();
  const remoteBranches = fetchRemoteBranches();

  const liveBranchSlugs = new Set(remoteBranches.map((name) => sanitize(name)).filter((name) => name.length > 0));
  if (defaultBranch) {
    liveBranchSlugs.add(sanitize(defaultBranch));
  }

  const previewDirectories = findPreviewDirectories(resolvedPagesDir);

  if (previewDirectories.length === 0) {
    console.log('cleanup-gh-pages: no preview directories detected.');
    return;
  }

  const deletions = previewDirectories.filter((dir) => !liveBranchSlugs.has(dir.name));

  if (deletions.length === 0) {
    console.log('cleanup-gh-pages: all preview directories map to live branches.');
    return;
  }

  console.log('cleanup-gh-pages: removing orphaned preview directories:');
  for (const entry of deletions) {
    console.log(`- ${entry.name}`);
    deleteDirectory(entry.absolutePath);
  }
};

main();
