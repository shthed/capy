# Agent Instructions

Capy lives at https://shthed.github.io/capy/ (repo: https://github.com/shthed/capy).

This file focuses on how we work. For technical architecture, UI behaviour, and
file-by-file references, consult [`TECH.md`](./TECH.md) and keep it in sync with
any feature or workflow changes you ship.

## Development Workflow

- **Branch naming.** Create short-lived branches named `automation/<change>` so
  QA notes and preview URLs map directly to the experiment under review.
- **Draft PRs early.** Open a draft PR as soon as you push. CI logs, manual QA
  notes, and preview links stay centralised, which matters once the automation
  suite returns.
- **Branch deployments.** Branches with open PRs deploy automatically to GitHub
  Pages under `/automation-<slug>/`; `main` deploys to the root. See "Branch
  Deployments" below for the full workflow and maintenance details.
- **Manual smoke tests.** Exercise puzzle load, palette selection, painting, and
  save/load flows in at least one desktop and one mobile browser before
  requesting review.
- **Automation discipline.** Record which tests ran, link the latest preview,
  and attach Playwright artifacts (when available) before handing off for
  review. Capture outcomes in the PR description so history remains searchable.
- **Fast-forward merges.** Rebase onto `main`, rerun the quick manual checks,
  and merge with `--ff-only` so history stays linear for the single-file
  runtime.
- **Weekly automation sync.** Summarise flaky runs, TODO updates, and follow-up
  work in the standing Friday issue to keep the automation backlog visible.

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
  UI updates and surface them in PRs once the automated suite is reinstated.
- Manual QA: `window.capyGenerator` exposes helpers (e.g.
  `loadPuzzleFixture`, `togglePreview`). Document any new helpers in `TECH.md`
  plus relevant tests.
- Merge gates: Until automation returns, block merges on a recorded manual
  smoke run. Once the suite is live again, require the automated check to pass
  before landing.

## Documentation Hygiene

- Update `TECH.md` alongside changes that affect gameplay, tooling, or release
  workflows.
- Add or refresh screenshots, segmentation guides, and UI walkthroughs when
  you alter major flows.

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

## Branch Deployments

- Workflow: `.github/workflows/deploy-branch.yml` builds from every push.
  Branches without open PRs exit early; `main` always deploys.
- Destinations: `main` publishes to the root of GitHub Pages. Other branches
  land in `/automation-<slug>/` directories using sanitised branch names (e.g.,
  `automation/feature` → `/automation-feature/`).
- Contents: Each deployment ships `index.html`, `puzzle-generation.js`,
  `capy.json`, and a generated `/README/index.html` so documentation mirrors the
  branch.
- Index: `branch.html` lists `main` plus every deployed branch with preview,
  PR, commit, and timestamp metadata rendered in the viewer’s local timezone.
- Cleanup: When a PR closes, the workflow prunes its corresponding deployment on
  the next run—manual intervention is rarely needed.
