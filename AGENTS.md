# Agent Instructions

## Project Summary
Capybooper is a browser-based color-by-number experience. The `index.html` document hosts the entire application, including
embedded SVG art, a responsive command rail, palette controls, and the Playwright-driven UI review harness. Supporting
documentation lives under `docs/`, while helper scripts and generated starter art bundles reside in `tools/` and `art/`
respectively.

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
- Configure git with `git config user.name "Codex"` and `git config user.email "codex@openai.com"` before committing.
- Keep `core.pager` set to `cat` so command output remains deterministic in logs.
- Run `git fetch --all --prune` at the start of a task to ensure local refs match the remote state before making changes.
- After committing, always push the working branch and update the corresponding PR so remote history stays in sync.

## PR / Final Response
- Summaries should call out both UI and workflow changes when present.
- Reference the tests that were run (or why they were skipped) in the final response.
