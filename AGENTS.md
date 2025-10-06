# Agent Instructions

## Project Summary
Capycolour is a single-file, browser-based colour-by-number experience with a ChatGPT-powered art prompt flow. The `index.html`
document hosts the entire application, including the prompt bar, responsive command rail, palette controls, segmentation
pipeline, and the Playwright-driven UI review harness. Supporting documentation lives under `docs/`, while helper scripts and
bundled starter art reside in `tools/` and `art/` respectively.

## Scope
These instructions apply to the entire repository unless a nested `AGENTS.md` overrides them.

## Code & Content Style
- Preserve the existing two-space indentation in HTML, CSS, and JavaScript.
- Keep inline `<style>` blocks organized with section comments when adding large groups of rules.
- When editing SVG assets, ensure elements remain human-readable (indent nested groups, keep attributes on a single line when short).
- Keep iconography and menu button labels synchronized between the header markup, README illustrations, and UI review tests.

## Testing
- Run `npm test --silent` after making changes that can affect functionality. If the command cannot be executed, explain the limitation in the final response.
- The UI review spec (`tests/ui-review.spec.js`) is expected to pass on both desktop and mobile viewports; update the assertions if the UI flow changes.

## Documentation & Notes
- Update `SEGMENTATION_GUIDE.md`, `ui-review.md`, or other relevant docs whenever the workflow or UI meaningfully changes.
- When adjusting the UI review harness, also refresh README/test docs to mention new metadata captured (e.g., header button ARIA labels, prompt state, or library controls).
- Note responsive header, prompt, or palette adjustments in `README.md` and `docs/gameplay-session.md` so contributors understand current UX expectations.
- Document ChatGPT prompt/key handling whenever the generation flow changes.

## Detailed File Summary
- `index.html` – Single-page Capycolour application containing markup, styles, the segmentation/rendering pipeline, ChatGPT prompt handling, the in-app API key manager, sample fallback logic, and exported harness helpers.
- `README.md` – High-level overview covering ChatGPT integration, gameplay features, developer workflow, and setup guidance.
- `AGENTS.md` – Repository-wide instructions (this document) plus a full file inventory.
- `.github/workflows/ci.yml` – Runs the Playwright smoke suite in CI to guard the prompt flow and responsive HUD.
- `.github/workflows/static.yml` – Deploys the single-page app to GitHub Pages when `main` updates.
- `PR_REVIEW.md` – Latest reviewer notes summarising prior feedback, regression expectations, and verification context.
- `coloring_screen_requirements.md` – Product requirements for the colouring experience (layout, interactions, accessibility, telemetry, QA scenarios).
- `ui-review.md` – Explanation of the automated visual capture process, positive observations, and improvement ideas.
- `capy.prompt.yml` – GPT prompt template used when generating starter SVG art assets.
- `playwright.config.js` – Shared Playwright configuration for local and CI runs.
- `package.json` / `package-lock.json` – Node metadata, npm scripts (`dev`, `start`, `test`, etc.), dependency versions, and the Playwright postinstall hook.
- `docs/` – Supplemental documentation:
  - `development_guide.md` – Setup checklist, daily workflow (including ChatGPT key usage), and asset guidelines.
-  - `gameplay-session.md` – Logged play session with observations about prompt fallbacks and canvas interactions.
-  - `svg-art-file-spec.md` – Specification for segmented SVG inputs consumed by the generator.
-  - `test-run-2025-10-04.md` – Historical Playwright run output with scenario breakdown.
-  - `testing-feedback-loop.md` – Commands and observability tips for keeping the mocked prompt and gameplay loop tight.
- `tests/` – Playwright suites:
  - `ui-review.spec.js` – Smoke/regression coverage for prompt availability, sample fallback, palette behaviour, zoom, and save helpers.
  - `prompt-flow.spec.js` – Mocks the ChatGPT image endpoint to assert successful imports and sample fallbacks during generation.
- `tools/` – Build utilities:
  - `build-starter-fallbacks.js` – Converts source SVGs into the inline `starter-fallbacks.js` payload used for offline bundling.
- `art/` – Bundled artwork:
  - `capybara-forest.svg`, `capybara-lagoon.svg`, `capybara-terraced-market.svg` – Segmented starter scenes.
  - `starter-fallbacks.js` – Prebuilt inline SVG payloads used when filesystem assets are unavailable.
- `artifacts/` – Playwright output directory containing screenshots, JSON manifests, and log files from recent UI review runs.
- `vendor/` – Vendored runtime dependencies (React, ReactDOM, Babel) referenced directly by `index.html`.
- `node_modules/` – Installed npm dependencies supporting the dev server and Playwright (auto-generated, not manually edited).
- `artifacts/ui-review/` – Per-run visual regression artifacts produced by `npm test`.

## Git Preferences
- Configure git with `git config user.name "Codex"` and `git config user.email "codex@openai.com"` before committing.
- Keep `core.pager` set to `cat` so command output remains deterministic in logs.
- Run `git fetch --all --prune` at the start of a task to ensure local refs match the remote state before making changes.
- After committing, always push the working branch and update the corresponding PR so remote history stays in sync.

## PR / Final Response
- Summaries should call out both UI and workflow changes when present.
- Reference the tests that were run (or why they were skipped) in the final response.
