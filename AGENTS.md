# Agent Instructions

## Project Summary
Capybooper is a browser-based color-by-number experience. The `index.html` document hosts the entire application, including
embedded SVG art, a responsive command rail, palette controls, and the Playwright-driven UI review harness. Supporting
documentation lives under `docs/`, while helper scripts and generated starter art bundles reside in `tools/` and `art/`
respectively.

## Repository Remotes
- `origin`: https://github.com/shthed/capy (primary upstream repository).

## File Inventory
- `AGENTS.md`: Contributor instructions and repository overview (this document).
- `README.md`: Project introduction, setup guidance, and gameplay overview.
- `PR_REVIEW.md`: Checklist for reviewing pull requests in this repository.
- `ui-review.md`: Notes describing the UI review harness and expected behaviors.
- `coloring_screen_requirements.md`: Product requirements for the coloring screen experience.
- `capy.prompt.yml`: Prompt configuration for automated agents contributing to the project.
- `index.html`: Main single-page application delivering the Capybooper experience with embedded SVG and UI logic.
- `package.json`: Node.js project manifest defining scripts, dependencies, and metadata.
- `package-lock.json`: Locked dependency graph for deterministic installs.
- `playwright.config.js`: Playwright test runner configuration targeting the UI review spec.
- `test.txt`: Placeholder test content file.
- `art/SEGMENTATION_GUIDE.md`: Instructions for segmenting SVG art assets.
- `art/capybara-forest.svg`, `art/capybara-lagoon.svg`, `art/capybara-terraced-market.svg`, `art/capybara-twilight.svg`,
  `art/lush-green-forest.svg`: Playable SVG art scenes used by the application.
- `art/starter-fallbacks.js`: Generated helper defining starter palettes and fallback color data for art assets.
- `artifacts/app.png`: Reference screenshot of the application UI.
- `docs/development_guide.md`: Contributor workflow guidance and tooling instructions.
- `docs/gameplay-session.md`: Narrative walkthrough of a gameplay session and UX expectations.
- `docs/svg-art-file-spec.md`: Specification describing the expected structure of SVG art files.
- `docs/test-run-2025-10-04.md`: Logged results from an October 2025 test run.
- `node_modules/`: Installed third-party dependencies required for development and testing.
- `tests/ui-review.spec.js`: Playwright UI regression test covering core flows.
- `tools/build-starter-fallbacks.js`: Script used to build the starter fallback palette bundle.
- `vendor/babel.min.js`, `vendor/babel.min.js.map`, `vendor/react.development.js`, `vendor/react-dom.development.js`: Bundled
  vendor libraries served directly by the application.

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
- When adjusting the UI review harness, also refresh README/test docs to mention new metadata captured (e.g., header button ARIA labels or library controls).
- Note responsive header or palette adjustments in `README.md` and `docs/gameplay-session.md` so contributors understand current UX expectations.

## Git Preferences
- Configure git with `git config user.name "Codex"` and `git config user.email "codex@openai.com"` before committing.
- Keep `core.pager` set to `cat` so command output remains deterministic in logs.
- Run `git fetch --all --prune` at the start of a task to ensure local refs match the remote state before making changes.
- After committing, always push the working branch and update the corresponding PR so remote history stays in sync.

## PR / Final Response
- Summaries should call out both UI and workflow changes when present.
- Reference the tests that were run (or why they were skipped) in the final response.
