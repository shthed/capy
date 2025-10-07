# Development Guide

## Prerequisites
- Node.js 18 or newer (Playwright currently targets Node 18 in CI).
- npm 9+ (ships with recent Node releases).
- The bundled Playwright browsers (run `npm install` once to trigger `playwright install`).
- (Optional) An OpenAI API key saved through the in-app **Help → ChatGPT access** form (or via `window.capyGenerator.setChatGPTKey('sk-...')`) if you want to exercise the ChatGPT prompt bar locally.

## Initial Setup
1. Install dependencies:
   ```bash
   npm install
   ```
   The `postinstall` hook will fetch Playwright browsers.
2. (Optional) Install browsers manually:
   ```bash
   npx playwright install --with-deps
   ```
3. Launch a local dev server:
   ```bash
   npm run dev
   ```
   The app serves static assets from the repository root on port 8000.

## Daily Workflow
- **Start the app:** `npm run dev` (or `npm run start`).
- **Load a prompt:** Before relying on the ChatGPT workflow, open **Help → ChatGPT access** to paste your OpenAI key (or call `window.capyGenerator.setChatGPTKey('sk-...')`) so the prompt bar can reach the API. Without a key the runtime logs the omission and falls back to the bundled sample.
- **Run smoke tests:** `npm test` executes the Playwright UI review harness in `tests/ui-review.spec.js` and the mocked prompt
  flow checks in `tests/prompt-flow.spec.js`.
- **Tight loop:** Use `npm run test:loop` to open Playwright's UI runner for fast re-runs while iterating on UI or prompt code.
- **Prompt-only checks:** `npm run test:prompt` focuses on the ChatGPT handshake without invoking the full suite.
- **Inspect reports:** After a test run, open `playwright-report/index.html` or run `npm run show-report`.
- **Review UI artifacts:** Check `artifacts/ui-review/*.json` for palette counts, cell totals, header button ARIA labels, and prompt/button state alongside the captured screenshot.
- **Watch the status tray:** The footer streams generator updates (file reads, clustering passes, segmentation totals) with a live progress bar, severity badges that mirror the Help log, and a telemetry grid covering the active mode/prompt, source and target sizes, palette counts, region totals, the current background, live progress percentages, and the active pipeline step so you can confirm each stage without digging through the console. On portrait or sub-768px layouts the tray hides automatically to prioritise palette space—open the Help sheet if you need to monitor logs while testing on a phone.
- **Mobile HUD check:** The UI review suite now boots a handheld viewport to ensure the header hugs the top-right edge, the menu toggle exposes every command, and the palette swatches stay compact with their inline labels/badges.
- **Static assets:** React, ReactDOM, and Babel live under `vendor/`. Update them with `npx playwright` or direct downloads and keep versions in sync with `package.json`.
- **Editor tasks:** VS Code tasks (`.vscode/tasks.json`) expose a "Start http-server" background task that mirrors `npm run dev`.

## Project Structure
- `index.html` - single-file Capycolour application (markup, styles, generator logic, and ChatGPT integration live here).
- `vendor/` - vendored runtime dependencies required for offline execution.
- `tests/` - Playwright suites (`ui-review.spec.js`, `prompt-flow.spec.js`).
- `.github/workflows/ci.yml` - Playwright smoke suite executed in CI to guard the prompt bar, telemetry tray, and responsive
  layout.
- `.github/workflows/static.yml` - GitHub Pages deployment workflow that publishes the single-page app when `main` updates.
- `docs/` - Project documentation (this guide, requirements, etc.).
  - `testing-feedback-loop.md` - Suggested commands and observability tips for keeping the prompt/gameplay loop tight.

## Importing Artwork
- Open the in-app Art Library and use the import section to paste JSON payloads or upload `.json`/`.svg` files.
- Annotated SVGs must tag each paintable region with `data-cell-id` and `data-color-id`; optional `data-color-name`, `data-color-hex`, or `data-color-rgba` metadata is used to seed palette entries (otherwise fills or defaults supply the swatch color).
- The importer merges multiple `<path>` elements within a region, generates palette entries for every referenced color ID, and slugifies the SVG title or filename when an explicit artwork ID is absent.
- Successful imports are saved to localStorage alongside autosave progress and can be removed or renamed from the library UI.

## Quality Checklist
- Keep Playwright tests green (`npm test`).
- Manually verify keyboard shortcuts (W/A/S/D panning, hints, toggles) when touching interaction code.
- Confirm bundled assets remain up to date if upgrading React/Babel.
- Review accessibility: confirm the hint icon and menu toggle announce their actions and the Options button exposes dialog affordances.

## Git hygiene

- Start each session with `npm run git:update` so local refs mirror the remote repository and the working tree status is shown
  automatically (run `git fetch --all --prune` and `git status -sb` manually if you do not want to rely on the helper script).
- Confirm the working tree is clean before branching or installing dependencies; `npm run git:update` prints the same
  short-status output you would normally inspect for untracked files or conflicts.
- When synchronising with `main`, prefer `git pull --rebase` (or an explicit `git merge origin/main` if the workflow demands a
  merge commit) so the single-file app avoids needless conflict rounds.
- After landing changes, push the branch and re-run `npm test --silent` if the merge introduced new code.

Update this guide when workflows change.

