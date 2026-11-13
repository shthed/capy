#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractReleaseNotes(changelogText, tagName) {
  const normalizedTag = String(tagName || '').trim();
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(normalizedTag);
  if (!match) {
    throw new Error(`Invalid release tag "${tagName}". Expected vMAJOR.MINOR.PATCH.`);
  }

  const [, major, minor, patch] = match;
  const fullVer = `${major}.${minor}.${patch}`;
  const shortVer = `${major}.${minor}`;
  const normalizedText = String(changelogText || '').replace(/\r\n/g, '\n');

  for (const candidate of [fullVer, shortVer]) {
    const pattern = new RegExp(
      `^### ${escapeRegExp(candidate)} - [^\\n]+\\n+([\\s\\S]*?)(?=^#{1,3}\\s|(?![\\s\\S]))`,
      'm'
    );
    const found = pattern.exec(normalizedText);
    if (found && found[1] && found[1].trim().length > 0) {
      return found[1].trim();
    }
  }

  return `- Release ${normalizedTag}`;
}

export function formatReleaseNotesMarkdown(changelogText, tagName) {
  const normalizedTag = String(tagName || '').trim();
  const section = extractReleaseNotes(changelogText, normalizedTag);
  return `### What's New in \`${normalizedTag}\`\n\n${section}\n`;
}

function parseArgs(argv) {
  const opts = {
    tag: process.env.TAG_NAME || '',
    changelog: 'CHANGELOG.md',
    out: 'release-notes.md',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--tag' && i + 1 < argv.length) {
      opts.tag = argv[i + 1];
      i += 1;
    } else if (arg === '--changelog' && i + 1 < argv.length) {
      opts.changelog = argv[i + 1];
      i += 1;
    } else if (arg === '--out' && i + 1 < argv.length) {
      opts.out = argv[i + 1];
      i += 1;
    }
  }
  if (!opts.tag) {
    throw new Error('Missing required --tag <tag> argument (or TAG_NAME env var).');
  }
  return opts;
}

const isCliEntry = Boolean(
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
);

if (isCliEntry) {
  const opts = parseArgs(process.argv.slice(2));
  const changelogText = fs.readFileSync(path.resolve(opts.changelog), 'utf8');
  const markdown = formatReleaseNotesMarkdown(changelogText, opts.tag);
  fs.writeFileSync(path.resolve(opts.out), markdown, 'utf8');
  console.log(`Extracted release notes for ${opts.tag} to ${opts.out}`);
}
