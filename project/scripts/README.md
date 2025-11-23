# Scripts Overview

This directory collects helper scripts that support the GitHub Pages deployment
pipeline and local automation runners. Each script is intended to be invoked
from CI workflows, but they can also be useful when iterating locally.

## `build-pages-site.mjs`

Renders Markdown (e.g., `README.md` or `AGENTS.md`) to a styled HTML page using
GitHub's Markdown API. The result is written to the output path provided on the
command line and wrapped in a layout that matches the GitHub Pages preview
style. Optional `--title` and `--source-label` flags customise the page title
and footer source label when rendering non-README docs.

```
node project/scripts/build-pages-site.mjs \
  --source README.md \
  --output dist/README/index.html \
  --mode gfm \
  --context owner/repo
```

Environment variables such as `GITHUB_TOKEN` are read automatically to support
authenticated calls to the Markdown API.

## `generate_readme_html.py`

Wraps a pre-rendered README HTML fragment in the same layout used by
`build-pages-site.mjs`. The script indents the provided markup, stamps the
output with the current UTC time, and writes the finished page to the given
path.

```
python project/scripts/generate_readme_html.py temp.html README/index.html
```

## `run-tests.js`

Runs the Playwright suite with the repository's configuration file.

```
node project/scripts/run-tests.js
```

## `update-deployments.mjs`

Normalises and updates the `deployments.json` manifest used by branch previews.
The script records the latest deployment metadata and prunes stale entries
unless they are listed in the `DEPLOY_ACTIVE` environment variable.

Key environment variables:

- `DEPLOY_DATA_PATH`
- `DEPLOY_TARGET_KEY`, `DEPLOY_BRANCH`, `DEPLOY_SAFE_NAME`
- `DEPLOY_COMMIT`, `DEPLOY_MESSAGE`, `DEPLOY_ACTOR`
- `DEPLOY_TIMESTAMP`, `DEPLOY_URL`
- `DEPLOY_ACTIVE`
