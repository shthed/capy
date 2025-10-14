# Automation Loop Blueprint

This blueprint describes how the Capybooper team handles branching, manual
testing, merging, and feedback collection so that single-file updates stay
trustworthy.

> **Note:** This project relies on manual smoke testing. Automated test
> infrastructure has been retired to keep the single-file architecture simple.

## Branching strategy

1. **Create automation branches.** Every change starts on a branch named
   `automation/<descriptor>` so logs, dashboards, and preview deployments link
   back to the specific feature under review.
2. **Sync before work.** Fetch and rebase against `main` before pushing to keep
   the fast-forward merge policy intact.
3. **Advertise intent.** Open a draft PR immediately so deployment history and
   reviewer notes accumulate in a single thread.
4. **Preview deployments.** Every push to any branch automatically deploys to
   GitHub Pages under a subfolder named after the branch (e.g.,
   `automation/feature` → `/automation-feature/`), letting reviewers test the live
   app without cloning the repository.

## Testing cadence

1. **Execute manual smoke tests.** Before requesting review, follow the manual
   checklist in the README to cover palette selection, painting, and save/load
   flows across at least one desktop and one mobile browser.
2. **Document verification.** Record your testing outcomes (browsers tested,
   issues found, screenshots of UI changes) in the PR description or comments so
   reviewers can validate your findings.
3. **Gate merges.** Require a completed manual test run and reviewer approval
   before merging. If the change affects UI or core gameplay, request testing
   from a second contributor.

## Merge policy

1. **Rebase and retest.** Once review is green, rebase the branch onto the
   latest `main` and repeat the manual smoke checks to confirm no regressions
   were introduced by upstream changes.
2. **Fast-forward only.** Merge with `--ff-only` to keep the history linear and
   make bisects against `index.html` manageable.
3. **Tag checkpoints.** When a feature materially changes the UI or deployment
   pipeline, create a lightweight tag (e.g., `ui-v2`) so future audits can
   correlate feature milestones with the commit history.

## Feedback loop

1. **Record outcomes.** Append manual verification notes (browsers tested, test
   cases covered, screenshots of changes), deployment status, and live preview
   URL to the PR description before requesting review.
2. **Triage weekly.** File an "Automation Sync" issue every Friday summarising
   test findings, UX issues, and backlog items harvested from TODO checklists.
3. **Close the loop.** After merging, add a comment to the originating issue or
   task noting the automation branch, preview URL, and tag (if applicable) so
   the knowledge base stays searchable.

Following this playbook keeps the single-page app nimble while guaranteeing that
UI regressions and workflow changes surface quickly to both maintainers and
contributors.
