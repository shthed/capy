#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_ENDPOINT = 'https://api.github.com/markdown';

const getAuthToken = () => {
  const candidates = [
    process.env.GITHUB_TOKEN,
    process.env.GITHUB_AUTH_TOKEN,
    process.env.GH_TOKEN,
    process.env.GITHUB_PAT,
  ];
  for (const candidate of candidates) {
    if (candidate && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
};

export const renderMarkdownWithGitHub = async (
  markdown,
  { mode = 'gfm', context, endpoint = DEFAULT_ENDPOINT } = {}
) => {
  const body = { text: String(markdown ?? '') };
  if (mode) {
    body.mode = mode;
  }
  if (context) {
    body.context = context;
  }

  const headers = new Headers({
    'Content-Type': 'application/json',
    Accept: 'application/vnd.github+json',
    'User-Agent': 'capy-pages-build-script',
  });

  const token = getAuthToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(
      `GitHub markdown rendering failed with ${response.status} ${response.statusText}: ${message}`
    );
  }

  return response.text();
};

const indentHtml = (html) => {
  const normalised = String(html ?? '').replace(/\r\n?/g, '\n');
  if (!normalised) {
    return '';
  }

  const hasTrailingNewline = normalised.endsWith('\n');
  const slice = hasTrailingNewline ? normalised.slice(0, -1) : normalised;
  const lines = slice.split('\n');
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines.map((line) => `    ${line}`).join('\n');
};

const formatUtcTimestamp = (date = new Date()) => {
  const iso = date.toISOString();
  const datePart = iso.slice(0, 10);
  const timePart = iso.slice(11, 16);
  return `${datePart} ${timePart} UTC`;
};

export const generateReadmeHtml = (
  renderedHtml,
  {
    generatedAt = new Date(),
    pageTitle = 'Capy README',
    sourceLabel = 'README.md',
  } = {}
) => {
  const stamped = formatUtcTimestamp(generatedAt);
  const indentedHtml = indentHtml(renderedHtml);
  const contentBlock = `        ${indentedHtml}`;
  return `<!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>${pageTitle}</title>
          <style>
            :root {
              color-scheme: light dark;
            }
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans", sans-serif;
              margin: 0 auto;
              padding: 32px 16px 48px;
              max-width: 920px;
              line-height: 1.6;
              background: #f6f8fa;
              color: #1f2328;
            }
            a {
              color: #0969da;
            }
            .markdown-body {
              background: #fff;
              border-radius: 12px;
              padding: 32px;
              box-shadow: 0 16px 40px rgba(15, 23, 42, 0.08);
              border: 1px solid #d0d7de;
            }
            .page-meta {
              margin-top: 24px;
              font-size: 0.85em;
              color: #57606a;
              text-align: center;
            }
            pre {
              background: #0d1117;
              color: #f0f6fc;
              padding: 16px;
              border-radius: 8px;
              overflow-x: auto;
            }
            code {
              font-family: SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace;
            }
            @media (max-width: 720px) {
              .markdown-body {
                padding: 24px 20px;
              }
            }
          </style>
        </head>
        <body>
          <main class="markdown-body">
${contentBlock}

          </main>
          <footer class="page-meta">Generated from ${sourceLabel} · ${stamped}</footer>
        </body>
        </html>
`;
};

const printUsage = () => {
  console.error(
    'Usage: build-pages-site.mjs --source <readme.md> --output <output.html> [--mode gfm] [--context owner/repo] [--title "Capy README"] [--source-label README.md]'
  );
};

const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) {
      continue;
    }
    const value = argv[index + 1];
    switch (key) {
      case '--source':
      case '--input':
      case '--readme':
        args.source = value;
        index += 1;
        break;
      case '--output':
        args.output = value;
        index += 1;
        break;
      case '--mode':
        args.mode = value;
        index += 1;
        break;
      case '--context':
        args.context = value;
        index += 1;
        break;
      case '--title':
        args.title = value;
        index += 1;
        break;
      case '--source-label':
        args.sourceLabel = value;
        index += 1;
        break;
      default:
        break;
    }
  }
  return args;
};

const ensureAbsolutePath = (filePath) => {
  if (!filePath) {
    return filePath;
  }
  return path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
};

const main = async () => {
  const argv = parseArgs(process.argv.slice(2));
  if (!argv.source || !argv.output) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const sourcePath = ensureAbsolutePath(argv.source);
  const outputPath = ensureAbsolutePath(argv.output);

  const sourceLabel = argv.sourceLabel || path.basename(sourcePath);
  const defaultTitle =
    argv.title ||
    (sourceLabel.toLowerCase() === 'readme.md'
      ? 'Capy README'
      : `Capy ${sourceLabel.replace(/\.md$/i, '')}`);

  let markdown;
  try {
    markdown = await fs.readFile(sourcePath, 'utf8');
  } catch (error) {
    console.error(`Failed to read markdown source ${sourcePath}:`, error.message);
    process.exitCode = 1;
    return;
  }

  let rendered;
  try {
    rendered = await renderMarkdownWithGitHub(markdown, {
      mode: argv.mode || 'gfm',
      context: argv.context || process.env.GITHUB_REPOSITORY || undefined,
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  const html = generateReadmeHtml(rendered, {
    generatedAt: new Date(),
    pageTitle: defaultTitle,
    sourceLabel,
  });

  try {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${html}\n`, 'utf8');
  } catch (error) {
    console.error(`Failed to write README HTML to ${outputPath}:`, error.message);
    process.exitCode = 1;
  }
};

if (import.meta.url === `file://${path.resolve(process.argv[1])}`) {
  main();
}
