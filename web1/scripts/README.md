# Scripts Overview (`web1/scripts/`)

This directory collects helper scripts that support the GitHub Pages deployment
pipeline and local Playwright automation runners in `web1/`.

## `build-pages-site.mjs`

Renders Markdown (e.g., `README.md` or `AGENTS.md`) to a styled HTML page using
GitHub's Markdown API. The result is written to the output path provided on the
command line and wrapped in a layout that matches the GitHub Pages preview
style.

```bash
node web1/scripts/build-pages-site.mjs \
  --source README.md \
  --output dist/README/index.html \
  --mode gfm \
  --context owner/repo
```

## `generate_readme_html.py`

Wraps a pre-rendered README HTML fragment in the same layout used by
`build-pages-site.mjs`.

```bash
python3 web1/scripts/generate_readme_html.py temp.html README/index.html
```

## `run-tests.js`

Runs the Playwright smoke test suite (`web1/tests/ui-load-page.spec.js`) with `web1/playwright.config.js`.

```bash
cd web1
node ./scripts/run-tests.js
```

## `cleanup-branches.mjs` & `cleanup-gh-pages-previews.mjs`

Used by `.github/workflows/cleanup-branches.yml` and `.github/workflows/cleanup-closed-pr.yml` to prune merged branches and remove closed PR preview directories (`pull/<number>/`) from `gh-pages` while preserving root assets (`assets/`, `web1/`).
