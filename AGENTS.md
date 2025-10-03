# Agent Instructions

## Scope
These instructions apply to the entire repository unless a nested `AGENTS.md` overrides them.

## Code & Content Style
- Preserve the existing two-space indentation in HTML, CSS, and JavaScript.
- Keep inline `<style>` blocks organized with section comments when adding large groups of rules.
- When editing SVG assets, ensure elements remain human-readable (indent nested groups, keep attributes on a single line when short).

## Testing
- Run `npm test --silent` after making changes that can affect functionality. If the command cannot be executed, explain the limitation in the final response.

## Documentation & Notes
- Update `SEGMENTATION_GUIDE.md`, `ui-review.md`, or other relevant docs whenever the workflow or UI meaningfully changes.

## PR / Final Response
- Summaries should call out both UI and workflow changes when present.
- Reference the tests that were run (or why they were skipped) in the final response.
