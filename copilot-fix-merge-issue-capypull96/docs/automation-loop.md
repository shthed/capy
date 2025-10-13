# Automation Loop Blueprint

This blueprint describes how the Capybooper team can automate branching, testing,
merging, and feedback collection so that single-file updates stay trustworthy.

> **Note:** The Playwright workflow outlined below is currently paused while the
> colour palette UI stabilises. Lean on manual smoke checks until the suite is
> rebuilt.

## Branching strategy

1. **Create automation branches.** Every change starts on a branch named
   `automation/<descriptor>` so logs, dashboards, and automation artifacts link
   back to the exact experiment once the suite returns.
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
2. **Execute UI smoke tests.** Until automation returns, lean on the manual
   checklist in the README to cover palette selection, painting, and
   save/load flows across desktop and mobile browsers.
3. **Collect artifacts.** Once the Playwright review spec is reinstated, publish
   the `artifacts/ui-review/` directory as a CI artifact so reviewers can
   inspect DOM snapshots without rerunning the suite.
4. **Gate merges.** Block the PR on the automated job once it comes back online;
   in the interim, require a recorded manual run before merging.

## Merge policy

1. **Rebase and replay.** Once review is green, rebase the branch onto the
   latest `main` and rerun `npm test --silent` locally (or via CI) to confirm no
   regressions were introduced.
2. **Fast-forward only.** Merge with `--ff-only` to keep the history linear and
   make bisects against `index.html` manageable.
3. **Tag checkpoints.** When a feature materially changes the UI or automation
   pipeline, create a lightweight tag (e.g., `automation-v1`) so future audits
   can correlate infrastructure improvements with test behaviour.

## Feedback loop

1. **Record outcomes.** Append the CI job result, manual verification notes, and
   live preview URL to the PR description before requesting review. Once
   Playwright returns, include the suite summary as well.
2. **Triage weekly.** File an "Automation Sync" issue every Friday summarising
   failures, flakes, and backlog items harvested from TODO checklists.
3. **Close the loop.** After merging, add a comment to the originating issue or
   task noting the automation branch, test run link, preview URL, and tag so the
   knowledge base stays searchable.

Following this playbook keeps the single-page app nimble while guaranteeing that
UI regressions and workflow changes surface quickly to both maintainers and
contributors.
