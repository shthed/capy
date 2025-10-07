# Agent Handbook

## Changelog
- **v2 (2025-02-21)** – Replaced the Playwright UI review dependency with a lightweight Node smoke test, refreshed setup instructions, and recorded the first run on the new harness.
- **v1 (2025-02-20)** – Consolidated repository guidance from existing documentation, captured current branch status, and documented the standing build/test process alongside the latest regression results.

## Agent Development Instructions

### Code & Content Style
- Preserve the existing two-space indentation in HTML, CSS, and JavaScript.
- Keep inline `<style>` blocks organized with section comments when adding large groups of rules.
- When editing SVG assets, ensure elements remain human-readable (indent nested groups, keep attributes on a single line when short).
- Keep iconography and menu button labels synchronized between the header markup, README illustrations, and UI review docs.

### Environment & Setup
- Use Node.js 18+ with npm 9+; `npm install` hydrates the local dependencies.
- Serve the app locally with `npm run dev` (or `npm run start`), which hosts the repository root on port 8000.

### Daily Workflow
- Launch the app (`npm run dev`) before UI verification or gameplay walkthroughs.
- Execute the Node-based smoke harness via `npm test` to confirm the mount point, public API, and handbook guidance remain intact.
- Perform manual UI spot-checks to validate palette interactions, viewport controls, and autosave flows after gameplay-affecting changes.
- Keep vendored React/ReactDOM/Babel copies in `vendor/` synchronized with `package.json` when upgrading dependencies.

### Artwork Import Workflow
- Import artwork through the in-app Art Library using pasted JSON or uploaded `.json`/`.svg` files.
- Tag SVG regions with `data-cell-id` and `data-color-id`; optionally include `data-color-name`, `data-color-hex`, or `data-color-rgba` for palette seeding.
- The importer merges multi-path regions, generates palette entries for every referenced color ID, and slugifies the SVG title or filename when no explicit artwork ID exists.
- Successful imports persist to localStorage with autosave progress and can be renamed or removed within the library UI.

### Quality & Accessibility Checklist
- Keep the smoke test harness green (`npm test`).
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
- Install dependencies with `npm install`.
- Execute `npm test` to run `tools/run-basic-tests.js`, which verifies the DOM mount point, the exposed generator API, and the presence of the handbook test guidance.
- Follow manual exploratory testing for UI or gameplay changes, capturing notes in the docs when workflows or expectations shift.

## Test Results
- **2025-02-21:** `npm test --silent` – Pass in 0.4s (Node smoke harness validating handbook and index.html scaffolding).
