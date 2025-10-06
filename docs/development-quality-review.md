# Development Quality Review

## Purpose
This report captures how Capycolour's history has evolved, highlights the
current development practices surfaced in repository docs, and proposes a
repeatable feedback loop so future changes stay stable even with the
single-file architecture.

## Git history snapshot
- `98143a0` (PR #20) introduced the single-page image generator, establishing the
  monolithic `index.html` structure that continues to host the full UI and
  generator pipeline.
- `f7af674` (PR #23) refactored the command rail, save workflow, and Playwright
  coverage, reinforcing the practice of shipping large UI and logic updates in a
  single HTML diff.
- `15ea747` (PR #26) merged additional prompt and testing harness work, again as
  a broad update that touched generator code, tests, and docs simultaneously.
- `38b0d53` documented git sync routines after a sequence of conflict-resolution
  tasks, underscoring how often long-lived branches drift from `main`.

Collectively these commits show a cadence of sweeping updates where functional
changes, telemetry instrumentation, and documentation all land together. The
pattern increases the likelihood of conflicts and makes it harder to isolate
regressions during review.

## Development practice observations
- Capycolour's entire application—including markup, styles, logic, and ChatGPT
  orchestration—lives in `index.html`, which keeps onboarding simple but yields
  very large diffs for even modest tweaks. The README reiterates this
  single-file architecture so contributors expect broad surface area changes
  from each commit.
- The repository already emphasises Playwright coverage and logging, yet several
  recent tasks focused on resolving conflicts rather than shipping new
  functionality, which slows iteration and risks stale telemetry wiring.
- PR review guidance stresses maintaining palette counts and screenshot
  artifacts, confirming that reviewers rely on deterministic outputs from the UI
  harness rather than ad-hoc manual checks.

## Prior PR takeaways
- `PR_REVIEW.md` documents past reviewer feedback that insisted on explicit
  Playwright assertions for palette and cell counts, reinforcing how automated
  coverage guards against silent regressions.
- Documentation updates such as `docs/testing-feedback-loop.md` already outline
  recommended commands, but they assume contributors remember to run them.
  Embedding the routine into a structured feedback loop ensures the steps happen
  consistently.

## Quality improvement feedback loop
1. **Daily sync and planning.** Begin each session with `git fetch --all --prune`
   and `git status -sb`, then record the intended scope (UI polish, telemetry,
   docs) so the next commit remains focused.
2. **Branch hygiene.** Create topic branches per feature, rebasing on `main`
   after significant commits land (especially after merges like PRs #20, #23,
   and #26) to minimise conflict churn.
3. **Incremental implementation.** When touching `index.html`, stage logical
   sections separately (prompt bar, telemetry tray, persistence helpers) and run
   targeted scripts (`npm run test:prompt`, `npm run test:loop`) before moving to
   the next area.
4. **Observability check.** Capture screenshots and verify the footer telemetry
   plus Help log severity pills after each major change so reviewers see the
   same evidence highlighted in prior PRs.
5. **Comprehensive verification.** Finish with `npm test --silent` and archive
   the artifacts directory when sharing context on the PR. Document any known
   trade-offs directly in the PR description.
6. **Retrospective.** After merge, update this review doc (and the gameplay log)
   with notable learnings so the institutional memory of debugging steps, merge
   friction, and harness coverage continues to improve.

## Suggested process guardrails
- Adopt a lightweight PR template that requires authors to list targeted files,
  tests run, and any responsive design considerations so reviews stay focused.
- Schedule a weekly ten-minute async review of open branches to catch drift
  early, especially when multiple people are editing telemetry or prompt logic
  at once.
- Track the number of merge-conflict resolutions per branch; flag any branch
  that hits more than two manual merges as a candidate for splitting or
  rebasing.
- Encourage maintainers to leave quick notes in `PR_REVIEW.md` when significant
  verification steps are added so new contributors know which checks are
  non-negotiable.

## Next steps
- Share this report with the team during the next planning session and agree on
  the cadence for the retrospective step.
- Update onboarding docs to link here so new contributors understand why the
  feedback loop matters before they tackle `index.html`.
- Revisit the loop quarterly, folding in new automation or telemetry that lands
  through future PRs.
