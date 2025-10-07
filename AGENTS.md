# Agent Handbook

## Changelog
- **v1 (2025-02-20)** – Consolidated repository guidance from existing documentation, captured current branch status, and documented the standing build/test process alongside the latest regression results.

## Agent Development Instructions

### Code & Content Style
- Preserve the existing two-space indentation in HTML, CSS, and JavaScript.
- Keep inline `<style>` blocks organized with section comments when adding large groups of rules.
- When editing SVG assets, ensure elements remain human-readable (indent nested groups, keep attributes on a single line when short).
- Keep iconography and menu button labels synchronized between the header markup, README illustrations, and UI review tests.

### Environment & Setup
- Use Node.js 18+ with npm 9+; `npm install` also triggers the Playwright browser download hook.
- Optionally refresh browsers with `npx playwright install --with-deps`.
- Serve the app locally with `npm run dev` (or `npm run start`), which hosts the repository root on port 8000.

### Daily Workflow
- Launch the app (`npm run dev`) before UI verification or gameplay walkthroughs.
- Execute the Playwright UI review harness via `npm test` for smoke coverage.
- Inspect `playwright-report/index.html` or run `npm run show-report` after tests for detailed traces.
- Review automation artifacts in `artifacts/ui-review/*.json` to confirm palette counts, cell totals, header button ARIA labels, and art-library availability.
- Confirm the handheld viewport run keeps the header pinned, the menu toggle enumerates every command, and palette swatches remain compact with inline labels.
- Keep vendored React/ReactDOM/Babel copies in `vendor/` synchronized with `package.json` when upgrading dependencies.

### Artwork Import Workflow
- Import artwork through the in-app Art Library using pasted JSON or uploaded `.json`/`.svg` files.
- Tag SVG regions with `data-cell-id` and `data-color-id`; optionally include `data-color-name`, `data-color-hex`, or `data-color-rgba` for palette seeding.
- The importer merges multi-path regions, generates palette entries for every referenced color ID, and slugifies the SVG title or filename when no explicit artwork ID exists.
- Successful imports persist to localStorage with autosave progress and can be renamed or removed within the library UI.

### Quality & Accessibility Checklist
- Keep Playwright tests green (`npm test`).
- Manually verify keyboard shortcuts (W/A/S/D panning, hints, toggles) whenever interaction code changes.
- Confirm bundled assets remain current when updating React/Babel versions.
- Validate accessibility: ensure hint icons, menu toggles, and option dialogs surface appropriate ARIA announcements.
- Update `SEGMENTATION_GUIDE.md`, `ui-review.md`, `README.md`, and `docs/gameplay-session.md` whenever workflows, HUD layouts, or responsive expectations change.

### Git Preferences
- Configure git with `git config user.name "Codex"` and `git config user.email "codex@openai.com"` before committing.
- Keep `core.pager` set to `cat` for deterministic command output.
- Run `git fetch --all --prune` at the start of each task to sync remote refs.
- After committing, push the working branch and refresh the associated PR to keep remote history aligned.

### PR / Final Response Expectations
- Summaries must call out UI and workflow changes when present.
- Cite the tests that were run (or justify why they were skipped) in the final response.

## Repository Status
- Active branch: `work`; no outstanding merge conflicts detected in prior reviews.
- Shipped feature highlights: onboarding detail presets (low/medium/high) that drive generator sliders, command rail with icon-only controls and fullscreen toggle, public `window.capyGenerator` API, autosave with cloud sync channel, and refreshed help sheet with live debug logging.
- Gameplay validation (2025-10-04 log) confirms palette highlighting, canvas pan/zoom responsiveness, fullscreen handling, and background/custom HUD scale controls operate smoothly on desktop and handheld viewports.
- Follow-up noted during earlier reviews: restore a remote default branch once upstream access returns.

## Build & Test Plan
- Install dependencies with `npm install` (triggers Playwright browser downloads).
- Primary regression coverage uses Playwright via `npm test` targeting `tests/ui-review.spec.js` across desktop and mobile viewports.
- Review generated reports with `npm run show-report` and inspect JSON artifacts for palette/count verification when adjusting gameplay logic or HUD layout.

## Test Results
- **2025-02-20:** `npm test --silent` – Pass in 40.6s (Playwright UI review suite across 5 scenarios).
