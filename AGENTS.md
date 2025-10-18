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

## Repository Report

- **Core application**
  - `index.html` – Single-file UI, styles, and generator logic powering the coloring experience.
  - `README.md` – Usage guide and architecture reference for contributors.
  - `capy.json` – Bundled Capybara Springs puzzle fixture used for previews and branch deployments alongside the single-page runtime.
  - `puzzle-generation.js` – Worker-ready generator module that handles colour quantization, segmentation, and metadata assembly off the main thread.
- **Testing & QA**
  - Automated Playwright smoke tests have been retired for now. Run quick manual passes in desktop and mobile browsers before pushing.
  - `npm test --silent` prints a skip notice while the Playwright suite is offline so CI still tracks the placeholder hook.
- **Tooling & metadata**
  - `package.json` – npm scripts plus the http-server dependency required to run the app locally.
  - `package-lock.json` – Locked dependency tree that keeps local installs and CI runs deterministic.
  - `.gitignore` – Ignores dependency installs, legacy automation artifacts, and transient reports.
- **CI & Deployment**
  - `.github/workflows/ci.yml` – Placeholder workflow that currently checks installs while the automated test suite is offline.
  - `.github/workflows/deploy-branch.yml` – Deploys branches with open PRs to GitHub Pages under subfolders; `main` always deploys to root.
- **Process notes**
  - `AGENTS.md` – Repository guidelines covering style, testing expectations, and contribution workflow.
  - `docs/automation-loop.md` – Blueprint for the automated branching, testing, merging, and feedback loop.
  - `docs/branch-deployments.md` – Detailed guide to the multi-branch GitHub Pages deployment system.

## Development Workflow

- **Automation branches.** Create short-lived branches named `automation/<change>` so QA notes and preview URLs map directly to the experiment under review.
- **Branch deployments.** Every push to a branch with an open PR automatically deploys to GitHub Pages under a subfolder named after the branch (e.g., `automation/feature` deploys to `/automation-feature/`). This lets reviewers preview changes in a live environment without local setup. The `main` branch always deploys to the root path.
- **Manual smoke tests.** Exercise the puzzle load, palette selection, painting, and save/load flows in at least one desktop and one mobile browser before requesting review.
- **Fast-forward merges.** Rebase onto `main`, repeat the quick manual checks, and merge with `--ff-only` to preserve a linear history that keeps bisects practical for the single-file runtime.
- **Weekly automation sync.** Summarise flaky runs, TODO updates, and follow-up work in a standing Friday issue so the team has a shared backlog of automation improvements.
- **Close the loop.** Update PR descriptions and linked issues with branch names, CI run URLs, artifact locations, and live preview URLs so the automation history remains searchable.

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

## Tooling
- Use the repository ripgrep defaults (`.ripgreprc` and `.rgignore`) so large fixture dumps do not overflow the terminal. Pass `--no-ignore` or `--max-columns` overrides explicitly if you need raw output.

## Documentation & Notes
- Update `SEGMENTATION_GUIDE.md`, `ui-review.md`, or other relevant docs whenever the workflow or UI meaningfully changes.
- When adjusting the UI review harness, also refresh README/test docs to mention new metadata captured (e.g., header button ARIA labels or library controls).
- Note responsive header or palette adjustments in `README.md` and `docs/gameplay-session.md` so contributors understand current UX expectations.

## Automation Workflow
- Sync with the latest `main` (fetch + merge or rebase) before starting work so local changes incorporate upstream automation updates.
- Capture any conflict resolutions in commit messages and PR summaries, especially when guidance files such as `AGENTS.md` or `README.md` change.
- Run `npm test --silent` after resolving conflicts to confirm the workflow still passes the automation checks before pushing.

## Git Preferences
- Configure git before committing: `git config user.name "Codex"` and
  `git config user.email "codex@openai.com"`.
- Keep `core.pager` set to `cat` for consistent command output.
- Start work with `git fetch --all --prune` to align local refs with remote.
- After each commit, push the branch so remote history mirrors local progress.
- Add the upstream remote if missing: `git remote add origin https://github.com/shthed/capy.git`.

### Branch Update Procedure
- Prefer rebasing feature branches onto the latest `origin/main` to preserve a
  linear history. Merging is acceptable only when you intentionally avoid
  rewriting history.
- Recommended one-time git configuration:
  ```bash
  git config --global pull.rebase true
  git config --global rebase.autoStash true
  git config --global rerere.enabled true
  ```
- Standard rebase workflow:
  ```bash
  git fetch --all --prune
  git switch <feature-branch>
  git rebase origin/main
  # resolve conflicts
  git push --force-with-lease
  ```
- If you must merge instead, follow the same fetch/switch cadence, run
  `git merge origin/main`, resolve conflicts, and finish with a regular
  `git push`.
- During rebases, remember `ours` = the commit being replayed (your feature
  work) and `theirs` = upstream (`origin/main`). For merges, `ours` = your
  feature branch and `theirs` = the target branch.
- Common conflict shortcuts:
  ```bash
  git checkout --theirs package-lock.json yarn.lock pnpm-lock.yaml
  git checkout --ours .editorconfig .eslintrc.* .prettierrc*
  git add -A && git rebase --continue   # or: git merge --continue
  ```
- Abort a bad resolution with `git rebase --abort` (or `git merge --abort`).
- After rebasing, always push with `--force-with-lease` to avoid clobbering
  collaborators.

## Final Response & PR Expectations
- Summaries should highlight UI and workflow changes, noting live preview URLs if
  applicable.
- Explicitly state which tests were run (or why they were skipped) in the final
  message.
- Capture and link Playwright artifacts for major UI adjustments.
- Follow repository-wide and nested `AGENTS.md` guidance for any files you touch.
