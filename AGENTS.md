# Agent Instructions

Capy lives at https://shthed.github.io/capy/ (repo: https://github.com/shthed/capy).

This file focuses on how we work. For technical architecture, UI behaviour, and
file-by-file references, consult [`TECH.md`](./TECH.md) and keep it in sync with
any feature or workflow changes you ship.

## Development Workflow

- **Branch naming.** Create short-lived branches named `automation/<change>` so
  QA notes and preview URLs map directly to the experiment under review.
- **Branch deployments.** Branches with open PRs deploy automatically to GitHub
  Pages under `/automation-<slug>/`; `main` deploys to the root.
- **Manual smoke tests.** Exercise puzzle load, palette selection, painting, and
  save/load flows in at least one desktop and one mobile browser before
  requesting review.
- **Fast-forward merges.** Rebase onto `main`, re-run the quick manual checks,
  and merge with `--ff-only` so history stays linear for the single-file
  runtime.
- **Weekly automation sync.** Summarise flaky runs, TODO updates, and follow-up
  work in the standing Friday issue to keep the automation backlog visible.
- **Close the loop.** Update PR descriptions and linked issues with branch
  names, CI run URLs, artifact locations, and live preview URLs so automation
  history remains searchable.

## Environment Setup

1. Install Node.js 18 LTS or newer.
2. Run `npm install` once to provision Playwright browsers and the lightweight
   `http-server` used by local previews.
3. Launch the site with `npm run dev` (serves the repo root at
   http://localhost:8000).
4. Tests and docs assume the app is reachable at port 8000; if you change it,
   update configuration files plus `TECH.md`.

## Testing Expectations

- Primary test command: `npm test --silent` (currently prints a skip notice
  while the Playwright suite is offline). Mention in the final response if you
  cannot run it.
- Targeted smoke run: `npm run test:smoke` for iterating on
  `tests/ui-review.spec.js`.
- UI verification: Keep Playwright expectations aligned with UI markup, palette
  labels, and README imagery when making visual changes.
- Artifacts: Capture Playwright reports under `artifacts/ui-review/` for major
  UI updates and surface them in PRs.
- Manual QA: `window.capyGenerator` exposes helpers (e.g.
  `loadPuzzleFixture`, `togglePreview`). Document any new helpers in `TECH.md`
  plus relevant tests.

## Documentation Hygiene

- Update `TECH.md`, `docs/automation-loop.md`, and `docs/branch-deployments.md`
  alongside changes that affect gameplay, tooling, or release workflows.
- Note responsive header or palette adjustments in `TECH.md` and
  `docs/gameplay-session.md` (create if missing) so contributors understand the
  current UX expectations.
- Keep screenshots, segmentation guides, and UI walkthroughs current when you
  alter major flows.

## Automation & Git Preferences

- Sync with `main` (`git fetch --all --prune`) before starting work.
- Configure git identity locally if needed:
  ```bash
  git config user.name "Codex"
  git config user.email "codex@openai.com"
  ```
- Keep `core.pager` set to `cat` for predictable output.
- Push after each commit so remote history mirrors local progress.
- Prefer rebasing feature branches onto `origin/main`; merge only when you must
  avoid rewriting history. Recommended one-time configuration:
  ```bash
  git config --global pull.rebase true
  git config --global rebase.autoStash true
  git config --global rerere.enabled true
  ```
- Standard rebase flow:
  ```bash
  git fetch --all --prune
  git switch <feature-branch>
  git rebase origin/main
  # resolve conflicts
  git push --force-with-lease
  ```
- Conflict shortcuts:
  ```bash
  git checkout --theirs package-lock.json yarn.lock pnpm-lock.yaml
  git checkout --ours .editorconfig .eslintrc.* .prettierrc*
  git add -A && git rebase --continue   # or: git merge --continue
  ```
- Abort a bad resolution with `git rebase --abort` (or `git merge --abort`).

## Final Response & PR Expectations

- Summaries should spotlight UI and workflow changes plus live preview URLs when
  available.
- Explicitly list which tests ran (or why they were skipped) in the final
  message.
- Follow repository-wide and nested `AGENTS.md` guidance for any files you
  touch.
