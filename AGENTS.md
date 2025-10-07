# Agent Instructions

game: https://shthed.github.io/capy/
repo: https://github.com/shthed/capy

## Project Overview
Capybooper is a static, browser-based color-by-number playground. Everything —
markup, styles, generator logic, fixtures, and onboarding copy — lives inside
`index.html`. Users can drop images (or load the bundled Capybara Springs
sample), let the k-means pipeline quantize colours, and immediately paint. The
repository intentionally avoids build tooling: npm is only used to install the
Playwright test runner and a lightweight `http-server` for local previews.

## Repository Map
- `index.html` – Single-page application containing DOM structure, inline styles,
  generator code, autosave helpers, and developer-map comments segmenting the
  script.
- `README.md` – Contributor handbook that documents UX features, presets, and
  architecture details; keep it synchronized with meaningful UI or workflow
  changes.
- `tests/ui-review.spec.js` – Playwright smoke test that boots the app, exercises
  onboarding, palette interactions, and sample reload flows across desktop &
  mobile viewports.
- `playwright.config.js` – Spins up `http-server` on port 8000 for tests and
  reuses any running instance to speed up local iterations.
- `docs/automation-loop.md` & `docs/branch-deployments.md` – Deep dives on the
  CI/deployment expectations referenced below.
- `package.json` – npm scripts for local preview (`npm run dev`), Playwright test
  variants, and automatic dependency provisioning via `postinstall`.
- `artifacts/ui-review/` – Expected location for Playwright reports and
  screenshots when you capture them locally; include relevant artifacts with major
  UI updates.

## Environment Setup
1. Install Node.js 18 LTS or newer.
2. Run `npm install` once; this triggers Playwright's `postinstall` hook to fetch
   browsers and dependencies.
3. Launch a local preview with `npm run dev` (serves the repo root at
   http://localhost:8000 via `http-server`).
4. Tests and docs assume the app is reachable at port 8000; update
   `playwright.config.js` if you change this, and reflect the change in the
   README plus this guide.

## Development & Testing
- Primary test command: `npm test --silent` (Playwright suite across desktop &
  mobile viewports). Mention in the final response if you cannot run it.
- Targeted smoke run: `npm run test:smoke` for quick iterations on
  `tests/ui-review.spec.js`.
- UI verification: Keep the Playwright expectations aligned with UI markup,
  palette labels, and README imagery when making visual changes.
- Artifacts: When validating significant UI updates, capture the generated
  Playwright report under `artifacts/ui-review/` and surface the location or
  attach files for reviewers.
- Manual QA: The app exposes `window.capyGenerator` helpers (`loadPuzzleFixture`,
  `togglePreview`, etc.) for ad-hoc scripting in DevTools; note any new helpers
  in the README and tests.

## Code & Content Style
- Preserve two-space indentation across HTML, CSS, and JavaScript blocks.
- When introducing sizeable groups of inline styles, bracket them with section
  comments to maintain navigability.
- Keep iconography, labels, and shortcut glyphs synchronized between the UI,
  README screenshots/illustrations, and Playwright assertions.
- Document responsive or accessibility changes directly in `README.md` so future
  contributors understand the intended UX.

## Workflow & Automation
- Create short-lived branches named `automation/<feature>` so CI history and
  GitHub Pages previews remain searchable.
- Every branch push deploys to GitHub Pages under a path matching the branch name
  and triggers CI (`npm test --silent`). Share the live preview URL in PRs when
  available.
- Merge via `--ff-only` after rebasing onto `main` and rerunning tests to keep
  history linear and bisectable.
- Maintain a weekly "Automation Sync" issue summarizing flaky runs and follow-up
  actions; link to it from related PRs.

## Git Preferences
- Configure git before committing: `git config user.name "Codex"` and
  `git config user.email "codex@openai.com"`.
- Keep `core.pager` set to `cat` for consistent command output.
- Start work with `git fetch --all --prune` to align local refs with remote.
- After each commit, push the branch so remote history mirrors local progress.

## Final Response & PR Expectations
- Summaries should highlight UI and workflow changes, noting live preview URLs if
  applicable.
- Explicitly state which tests were run (or why they were skipped) in the final
  message.
- Capture and link Playwright artifacts for major UI adjustments.
- Follow repository-wide and nested `AGENTS.md` guidance for any files you touch.
