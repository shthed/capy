# Agent Instructions

## Project Summary
Capybooper is a browser-based color-by-number experience. The `index.html` document carries the entire application,
including the built-in sample artwork, responsive command rail, palette controls, and the Playwright-driven UI review harness.
The repository has been trimmed to the core runtime, Playwright tests, and supporting configuration files, and now expects
contributors to follow a lightweight but automated feedback loop when shipping changes.

## Scope
These instructions apply to the entire repository unless a nested `AGENTS.md` overrides them.

## Code & Content Style
- Preserve the existing two-space indentation in HTML, CSS, and JavaScript.
- Keep inline `<style>` blocks organized with section comments when adding large groups of rules.
- Keep iconography and menu button labels synchronized between the header markup, README illustrations, and UI review tests.

## Testing
- Run `npm test --silent` after making changes that can affect functionality. If the command cannot be executed, explain the limitation in the final response.
- The UI review spec (`tests/ui-review.spec.js`) is expected to pass on both desktop and mobile viewports; update the assertions if the UI flow changes.
- Capture the Playwright report artifacts (`artifacts/ui-review/`) as attachments when validating major UI updates so asynchronous reviewers can audit diffs.

## Automation loop
- Open a short-lived branch per change and name it `automation/<feature>` so the continuous Playwright run history stays searchable.
- For every branch push, trigger the CI pipeline that runs `npm test --silent`, publishes Playwright artifacts, and records the outcome in the team dashboard.
- After review, merge via a fast-forward with `--ff-only` so the automation history remains linear; if conflicts occur, rebase the branch and rerun the tests before retrying.
- Schedule a weekly "Automation Sync" issue summarising failing runs, flake investigations, and TODO updates; link to the issue from the PR body when the work is related.

## Documentation & Notes
- Update the repository report and TODO sections in `README.md` when the workflow or UI meaningfully changes.
- When adjusting the UI review harness, refresh README/test docs to mention new metadata captured (e.g., header button ARIA labels or library controls).
- Note responsive header or palette adjustments directly in `README.md` so contributors understand current UX expectations.

## Git Preferences
- Configure git with `git config user.name "Codex"` and `git config user.email "codex@openai.com"` before committing.
- Keep `core.pager` set to `cat` so command output remains deterministic in logs.
- Run `git fetch --all --prune` at the start of a task to ensure local refs match the remote state before making changes.
- After committing, always push the working branch and update the corresponding PR so remote history stays in sync.

## PR / Final Response
- Summaries should call out both UI and workflow changes when present.
- Reference the tests that were run (or why they were skipped) in the final response.
