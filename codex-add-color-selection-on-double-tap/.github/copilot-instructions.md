# GitHub Copilot Instructions

## Project Context
Capybooper is a static, browser-based color-by-number puzzle generator. The entire application lives in a single `index.html` file with inline styles and scripts—no build tools required. Users drop images, and the k-means clustering pipeline creates paintable puzzles.

## Key Architectural Principles
- **Single-file architecture**: All markup, styles, and logic live in `index.html`
- **No build tooling**: npm is only for Playwright tests and `http-server` local preview
- **Browser-native**: Runs entirely in the browser without backend dependencies
- **Inline everything**: Styles, scripts, and fixtures are embedded directly

## Code Style & Patterns
- Preserve the inline architecture—don't suggest splitting into separate files
- Match existing code style: ES6+ features, template literals, arrow functions
- Keep DOM manipulation explicit and direct (no framework abstractions)
- Use descriptive variable names that match the puzzle domain (regions, palette, etc.)

## Testing Requirements
- Primary test command: `npm test --silent` (Playwright suite)
- Smoke test: `npm run test:smoke` for quick validation
- **Always run tests after changes** to catch regressions
- Manual QA required: Test in desktop and mobile browsers before committing

## Development Workflow
- Create branches named `automation/<descriptor>`
- Run `npm install` once to fetch dependencies
- Start dev server: `npm run dev` (http://localhost:8000)
- Every branch auto-deploys to GitHub Pages for live preview

## Git Conventions
- Configure: `git config user.name "Codex"` and `git config user.email "codex@openai.com"`
- Keep `core.pager` set to `cat` for consistent output
- Sync with `git fetch --all --prune` before starting work
- Use fast-forward merges (`--ff-only`) to maintain linear history

## Important Files
- `index.html` – The entire application
- `README.md` – Contributor handbook with UX features and architecture
- `AGENTS.md` – Detailed agent instructions and workflow guidance
- `tests/ui-review.spec.js` – Playwright smoke tests
- `docs/automation-loop.md` – CI/deployment expectations

## What to Avoid
- Don't add build tools, bundlers, or transpilation
- Don't split the single-file architecture into modules
- Don't modify working code unnecessarily
- Don't skip tests or manual verification
- Don't remove or edit unrelated tests

## When Making Changes
1. Understand existing patterns before modifying
2. Make minimal, surgical changes
3. Run tests immediately after changes
4. Verify in browser (especially for UI changes)
5. Update README if behavior changes
6. Capture Playwright artifacts for UI updates

## Documentation Standards
- Keep README synchronized with UI and workflow changes
- Update AGENTS.md when guidance changes
- Reference live preview URLs in PRs
- Note which tests were run in final responses
