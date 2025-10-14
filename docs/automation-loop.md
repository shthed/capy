# Automation Loop Blueprint

This blueprint describes how the Capybooper team automates branching, testing,
merging, and feedback collection so that single-file updates stay trustworthy.

> **Note:** The project uses a lightweight automated testing system that quickly
> loads the game and captures screenshots to verify basic functionality.

## Branching strategy

1. **Create automation branches.** Every change starts on a branch named
   `automation/<descriptor>` so logs, dashboards, and test artifacts link back
   to the exact experiment.
2. **Sync before work.** Fetch and rebase against `main` before pushing to keep
   the fast-forward merge policy intact.
3. **Advertise intent.** Open a draft PR immediately so CI history and reviewer
   notes accumulate in a single thread.
4. **Preview deployments.** Every push to any branch automatically deploys to
   GitHub Pages under a subfolder named after the branch (e.g.,
   `automation/feature` → `/automation-feature/`), letting reviewers test the live
   app without cloning the repository.

## Testing cadence

1. **Install dependencies.** Run `npm install` in a fresh workspace or CI job.
2. **Execute automated smoke tests.** Run `npm test` to launch the game in
   headless Chrome, verify key elements load, and capture screenshots for both
   desktop (1920x1080) and mobile (375x667) viewports. Tests complete in under
   30 seconds.
3. **Review screenshots.** Check `artifacts/game-loaded-desktop.png` and
   `artifacts/game-loaded-mobile.png` to verify the game rendered correctly.
4. **Gate merges.** Block the PR on passing automated tests; for UI-heavy
   changes, also perform manual validation across real browsers.

## Merge policy

1. **Rebase and replay.** Once review is green, rebase the branch onto the
   latest `main` and rerun `npm test` locally (or via CI) to confirm no
   regressions were introduced.
2. **Fast-forward only.** Merge with `--ff-only` to keep the history linear and
   make bisects against `index.html` manageable.
3. **Tag checkpoints.** When a feature materially changes the UI or automation
   pipeline, create a lightweight tag (e.g., `v1.0`) so future audits can
   correlate infrastructure improvements with test behaviour.

## Feedback loop

1. **Record outcomes.** Append the test results, captured screenshots from
   `artifacts/`, and live preview URL to the PR description before requesting
   review.
2. **Triage weekly.** File an "Automation Sync" issue every Friday summarising
   test failures, flakes, and backlog items harvested from TODO checklists.
3. **Close the loop.** After merging, add a comment to the originating issue or
   task noting the automation branch, test run status, preview URL, and tag so
   the knowledge base stays searchable.

Following this playbook keeps the single-page app nimble while guaranteeing that
UI regressions and workflow changes surface quickly to both maintainers and
contributors.
