# Automation Loop Blueprint

This blueprint describes how the Capybooper team can automate branching, testing,
merging, and feedback collection so that single-file updates stay trustworthy.

## Branching strategy

1. **Create automation branches.** Every change starts on a branch named
   `automation/<descriptor>` so logs, dashboards, and Playwright artifacts link
   back to the exact experiment.
2. **Sync before work.** Fetch and rebase against `main` before pushing to keep
   the fast-forward merge policy intact.
3. **Advertise intent.** Open a draft PR immediately so CI history and reviewer
   notes accumulate in a single thread.

## Testing cadence

1. **Install dependencies.** Run `npm install` in a fresh workspace or CI job.
2. **Execute UI smoke tests.** Invoke `npm test --silent` to drive the
   Playwright review spec on both desktop and mobile breakpoints.
3. **Collect artifacts.** Publish the `artifacts/ui-review/` directory as a CI
   artifact so reviewers can inspect DOM snapshots without rerunning the suite.
4. **Gate merges.** Block the PR until the Playwright job succeeds on the latest
   commit; flaky runs should be investigated and retried rather than ignored.

## Merge policy

1. **Rebase and replay.** Once review is green, rebase the branch onto the
   latest `main` and rerun `npm test --silent` locally (or via CI) to confirm no
   regressions were introduced.
2. **Fast-forward only.** Merge with `--ff-only` to keep the history linear and
   make bisects against `index.html` manageable.
3. **Tag checkpoints.** When a feature materially changes the UI or automation
   pipeline, create a lightweight tag (e.g., `automation-v1`) so future audits
   can correlate infrastructure improvements with test behaviour.

### Conflict handling

1. **Pause and inspect.** The moment a merge or rebase surfaces markers, run `git status` to list every conflicted file before
   making any other edits so you understand the full scope.
2. **Merge both intents.** Open each conflicted file—especially `AGENTS.md`, `README.md`, and this blueprint—and weave the
   competing guidance together, updating headings or links if they moved.
3. **Synchronise wording.** After resolving one document, cross-check the other workflow guides so terminology, numbering, and
   references stay identical across the set.
4. **Validate before continuing.** Stage the fixes, run `npm test --silent`, and only resume the merge or rebase once the suite
   passes on the reconciled state.
5. **Finish cleanly.** Complete the merge or rebase, push the reconciled branch, and update or close the PR so automation and
   reviewers acknowledge the final guidance.

## Feedback loop

1. **Record outcomes.** Append the CI job result, Playwright summary, and any
   manual verification notes to the PR description before requesting review.
2. **Triage weekly.** File an "Automation Sync" issue every Friday summarising
   failures, flakes, and backlog items harvested from TODO checklists.
3. **Close the loop.** After merging, add a comment to the originating issue or
   task noting the automation branch, test run link, and tag so the knowledge
   base stays searchable.

Following this playbook keeps the single-page app nimble while guaranteeing that
UI regressions and workflow changes surface quickly to both maintainers and
contributors.
