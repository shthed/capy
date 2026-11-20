# Project Management & Release Governance Guide -- Capy Monorepo (`PROJECT.md`)

Canonical project management manual for **Capy** ([`web/`](./web/), [`app/`](./app/), and [`worker/`](./worker/)). Defines contributor roles, Lean Agile backlog governance across [`ROADMAP.md`](./ROADMAP.md), GitHub Epics, and [`TODO.md`](./TODO.md), sprint execution cadence, pull request lifecycle and description sync, release promotion (`beta -> main`), [`CHANGELOG.md`](./CHANGELOG.md) channel markers, documentation sync, and continuous process improvement.

**Related Guides**: [`README.md`](./README.md) | [`CONTRIBUTING.md`](./CONTRIBUTING.md) | [`SUPPORT.md`](./SUPPORT.md) | [`SECURITY.md`](./SECURITY.md) | [`ROADMAP.md`](./ROADMAP.md) | [`TODO.md`](./TODO.md) | [`DEV.md`](./DEV.md) | [`WEB.md`](./WEB.md) | [`PUZZLE.md`](./PUZZLE.md) | [`APP.md`](./APP.md) | [`CLOUD.md`](./CLOUD.md) | [`TESTING.md`](./TESTING.md) | [`CHANGELOG.md`](./CHANGELOG.md) | [`LICENSE.md`](./LICENSE.md)

**Table of Contents**:
1. [Roles, Ownership and Coordination](#1-roles-ownership-and-coordination)
2. [Lean Agile Lifecycle and Backlog Governance](#2-lean-agile-lifecycle-and-backlog-governance)
3. [Sprint Cadence and Execution](#3-sprint-cadence-and-execution)
4. [Pull Request Lifecycle and Review Standards](#4-pull-request-lifecycle-and-review-standards)
5. [Release Promotion and Changelog Governance](#5-release-promotion-and-changelog-governance)
6. [Documentation Sync and Markdown Hygiene Matrix](#6-documentation-sync-and-markdown-hygiene-matrix)
7. [Continuous Improvement and Retro Log](#7-continuous-improvement-and-retro-log)

> [!IMPORTANT]
> **Division Between `PROJECT.md` and `DEV.md`**:
> - [`PROJECT.md`](./PROJECT.md) (this file) is the **canonical Project Management manual** governing backlog lifecycle, Epic triage, PR metadata sync, release promotion, `CHANGELOG.md` channel markers, and process retrospectives.
> - [`DEV.md`](./DEV.md) is the **engineering manual** covering Section 2 technical guardrails, local build/test CLI, CI/CD workflow architecture, SemVer/dependencies/assets, and troubleshooting.

---

## 1. Roles, Ownership and Coordination

- **Project Maintainers**: Set product vision and Epic priority in [`ROADMAP.md`](./ROADMAP.md), approve unblocked work entering [`TODO.md`](./TODO.md), evaluate tactile and visual feel on Alpha `/alpha/<number>/` and Beta `/beta/` previews, and hold final merge authority into `beta` and `main`.
- **External / Public Contributors**: Open bug reports, feature requests, puzzle ideas, and community pull requests on [`capyboop/paint`](https://github.com/capyboop/paint) following [`CONTRIBUTING.md`](./CONTRIBUTING.md), [`SUPPORT.md`](./SUPPORT.md), and [`SECURITY.md`](./SECURITY.md).
- **Worktree & Diff Hygiene**: Keep concurrent feature branches isolated in clean working trees, avoid blind `git add -A` over untracked scratch files, and verify `git status` plus `git show --stat HEAD` before every push.

<!-- capy-dev-only:start -->
### Multi-Manager Team Charter (`PM <-> Dev Manager` on `shthed/capy`)

- **Private AI Operational Docs**: AI-assisted workflow, model routing, session hygiene, PR Readiness Checklist specs, and cross-repo guardrails live in [`AGENTS.md`](./AGENTS.md), [`CAPYBOOP.md`](./CAPYBOOP.md), [`docs/ai/workflow-and-models.md`](./docs/ai/workflow-and-models.md), [`docs/ai/pr-readiness.md`](./docs/ai/pr-readiness.md), and [`docs/ai/cross-repo-guardrail.md`](./docs/ai/cross-repo-guardrail.md).
- **Project Manager (`PM`) Ownership**:
  - Owns [`PROJECT.md`](./PROJECT.md), [`ROADMAP.md`](./ROADMAP.md), [`TODO.md`](./TODO.md), GitHub Parent Epic Tracking Issues ([EPIC-1](../../issues/476)--[EPIC-5](../../issues/480)), `epic:*` label descriptions, GitHub Sprint Milestones, continuous **PR Description Stewardship** across all open PRs, and `beta -> main` Release Promotion readiness verification.
- **Development Manager (`Dev Manager`) Ownership**:
  - Owns application source (`web/`, `app/`, `worker/`), test & hygiene tooling ([`web/scripts/test.mjs`](./web/scripts/test.mjs), [`web/scripts/sanity.mjs`](./web/scripts/sanity.mjs), [`web/scripts/rebrand-persona.mjs`](./web/scripts/rebrand-persona.mjs)), subsystem technical docs when modified alongside code/CI PRs, `.github/workflows/*`, [`web/package.json`](./web/package.json) SemVer bumps, technical PR conflict rebases, and engineering sprint execution.
- **Strict Git Worktree Isolation**:
  - Concurrent sessions must **never** edit files or switch branches inside the shared primary checkout. Create isolated worktrees off updated `origin/beta`, namespace `.agents/teamwork/` per campaign, and never commit `.agents/` files to Git.
<!-- capy-dev-only:end -->

---

## 2. Lean Agile Lifecycle and Backlog Governance

Capy separates strategic multi-sprint planning from day-to-day execution across the **3-Artefact Agile Triad** ([`ROADMAP.md`](./ROADMAP.md) <-> GitHub Epic Issues & Milestones <-> [`TODO.md`](./TODO.md)).

### Plain-English Agile & Release Terminology

- **Epic (`EPIC-1`..`EPIC-5`)**: A multi-week product theme grouping related player capabilities (planned in [`ROADMAP.md`](./ROADMAP.md), tracked `1:1` by one Parent GitHub Tracking Issue, and filtered via `epic:1`..`epic:5` GitHub Labels). Never bundle an entire Epic into one mega-PR.
- **User Story (`US-X.Y`)**: A cohesive, player-visible outcome inside an Epic written around player value.
- **Task / Subtask (`TASK-X.Ya`)**: An independently testable `1-PR` coding slice implementing part or all of a User Story. Active-sprint slices live in [`TODO.md`](./TODO.md) and are deleted immediately upon merge.
- **Bug (`BUG-N`)**: A verified defect, lifecycle guard, or CI reliability fix scheduled at Priority 0 in a Sprint.
- **Sprint (`Sprint 0`..`Sprint 3`)**: A focused batch of `~8--10` unblocked Tasks and Bugs pulled into [`TODO.md`](./TODO.md), integrated onto `beta`, play-tested on `/beta/`, and promoted to `main`.
- **GitHub Milestone (`Sprint N: ...`)**: Native Sprint progress bar (`closed PRs / total PRs %`) assigned to every PR and Epic issue in that Sprint.
- **GitHub Label (`epic:*`, `web`, `android`, `feature`, `fix`, `ui`, `testing`, `ci`, `docs`, `deps`)**: Taxonomy tags allowing PR titles to remain clean and prefix-free.
- **Channels (`Alpha` / `Beta` / `Production`)**: Isolated PR previews at `/alpha/<number>/` (`Alpha`, indexed under `/alpha/`), integration soak branch `beta` at `/beta/` (`Beta`), and live stable `main` at `/` (`Production`).
- **Git Tag (`vX.Y.Z`) & GitHub Release**: Immutable release tag triggering [`release.yml`](./.github/workflows/release.yml) for APK, Play Store `.aab`, `.tgz`, and release notes.

### Canonical Reference Formatting (Epics vs. PRs)

- **PR References Always Use Clickable `#NNN` Links**: Always write PR numbers across docs (`PROJECT.md`, `ROADMAP.md`, `TODO.md`, `CHANGELOG.md`) as relative clickable Markdown links `[#NNN](../../pull/NNN)` (never plain `#NNN` or backticked `` `#NNN` ``, and without hardcoded repository owner URLs).
- **Epic References Always Use `[EPIC-N](...)` Links**: Whenever referring to an Epic Tracking Issue in prose or docs, ALWAYS use relative links `[EPIC-N](../../issues/<num>)` (or `EPIC-N` when unlinked)—for example [EPIC-1](../../issues/476), [EPIC-2](../../issues/477), [EPIC-3](../../issues/478), [EPIC-4](../../issues/479), [EPIC-5](../../issues/480)—never bare/backticked `#<epic-issue>` or `[#<epic-issue>](../../issues/<num>)` (even in examples or notes), so Epics are strictly distinguished from PR links.
- **Epic Issue PR-List Formatting Standard**: Inside GitHub Epic Tracking Issue bodies ([EPIC-1](../../issues/476)--[EPIC-5](../../issues/480)), keep items **grouped under Story/Theme subheadings**, put **one entry per line**, place `#NNN` at the **start** of the link text so numbers line up neatly down the left edge (`- [x] [#NNN — Title/Summary](../../pull/NNN)`), and **sort numerically by PR number within each group**.

### 3-Artefact Agile Triad & Triage Rules

1. **[`ROADMAP.md`](./ROADMAP.md) (*Strategic Epics, Stories, Icebox & Shipped Archive*)**:
   - Owns all Epics (`EPIC-2`..`EPIC-5`), User Stories (`US-N.M`), readiness status (`Active in Sprint N`, `Ready for Next Sprint`, `Awaiting Review & Approval`, or `Blocked -- External Infra`), Platform Icebox (`ICE-1`..`ICE-3`), and the collapsed `<details>` **Shipped Epics & Stories** archive in Section 6.
   - Blocked items (OAuth/Play Console secrets, hosted WebSocket relays, paid AI endpoints) remain in `ROADMAP.md` with explicit **Unblock Prerequisite** notes until ready.
2. **GitHub Parent Epic Tracking Issues (`1 Issue = 1 Epic`) & Milestones**:
   - Strictly one GitHub Issue per Epic: [EPIC-1](../../issues/476) (`CLOSED`), [EPIC-2](../../issues/477) (Sprint 1), [EPIC-3](../../issues/478) (Sprint 2), [EPIC-4](../../issues/479) (Sprint 3), [EPIC-5](../../issues/480) (Blocked).
   - **Zero Sub-Issue Sprawl**: Never open separate GitHub Issues for `TASK-*` slices, Sprint `BUG-*` fixes, or `ICE-*` items unless explicitly requested. Charter a new `EPIC-N` issue only when promoting an `ICE-*` item or new product theme into active scheduling.
<!-- capy-dev-only:start -->
   - **Owner-Review Plans & Review/Audit Documents (Explicit Issue Exception)**: Alongside Epics and Ops issues, whenever an AI agent finishes a **plan ready for Owner review** (e.g., an implementation plan) or produces a **code/product review or audit document**, it MUST log that plan or review as a bot-authored GitHub Issue on the private development repository via `open-issue.yml` (as `github-actions[bot]`, including a clickable Antigravity web session URL `` `[<Role> (<short-id>)](https://antigravity.google.com/remote/<session-id>?project=<project-id>)` `` and a structured summary/checklist) so the Project Owner can review, coordinate, and comment directly on GitHub.
<!-- capy-dev-only:end -->
   - **Epic Triage (`EPIC-2` vs. `EPIC-3..5`)**: Keep [EPIC-2](../../issues/477) (`v3.0.x` Critical Bugfixes & Stabilization) scoped strictly to priority bugfixes and approved stabilization polish. Route post-stabilization feature work and Android Play release (`TASK-2.5`) to [EPIC-3](../../issues/478)--[EPIC-5](../../issues/480); never attach `epic:2` to unapproved features.
3. **[`TODO.md`](./TODO.md) (*Focused 1-Sprint Ready Queue*)**:
   - Holds **only** active-sprint approved items (`~8--10` max). Separate **dev slices** (`[quick-win]` for `1--3` file slices) clearly from any **Release & Ops Gates** subsection (DNS cutover, Play Store keystore/console uploads).
4. **Definition of Ready (Anti-Busywork Gate)**:
   - A task enters [`TODO.md`](./TODO.md) only when it delivers concrete player or reliability value (`Why Now`), satisfies all external prerequisites, and verifies exact file/symbol paths against `origin/beta`/`origin/main`.
5. **Definition of Done**:
   - **Delete from `TODO.md` Immediately**: Never leave `[x]` items in [`TODO.md`](./TODO.md); delete shipped `BUG-*` / `TASK-*` items in the PR that completes them.
   - **Check Off Parent Epic Issue**: Mark `- [x] [#NNN — Title](../../pull/NNN)` inside the matching Epic Issue (`gh issue edit`).
   - **Archive in `ROADMAP.md`**: Move completed Stories/Epics into Section 6 `<details>` with clickable `[#NNN](../../pull/NNN)` links; close the Epic Issue and Sprint Milestone only once `100%` of its scope ships to Production `main`.
6. **Never Auto-Close an Incomplete Epic (`Tracked in` vs. `Closes`)**:
   - Never use `Closes #...`, `Fixes #...`, or `Resolves #...` on partial Epic PRs. Write `**Agile Scope**: Tracked in [EPIC-N](../../issues/<num>) (US-X.Y: TASK-X.Ya)` so GitHub cross-references the PR while keeping the Epic `OPEN`. Standalone P0 `BUG-*` PRs attach the Sprint Milestone + `fix` + subsystem labels without an unrelated `epic:*` label.
7. **Canonical Mobile-First Card & `<details>` Template**:
   - Keep **Description**, **Value**, **Why Now**, and 1-line **Tasks** visible; wrap verbose metadata inside `<details><summary>...</summary></details>` with blank lines after `</summary>` and before `</details>`:
   ````markdown
   ### US-X.Y: Concise Outcome-Focused Title

   - **Description**: Plain-English summary of what is built or fixed.
   - **Value**: Concrete benefit to player experience, accessibility, or reliability.
   - **Why Now**: Justification for why this item earns its current sprint priority.
   - **Tasks**:
     - **TASK-X.Ya** `[quick-win]`: Independently mergeable 1-PR slice summary.
     - **TASK-X.Yb**: Follow-up 1-PR slice summary.

   <details>
   <summary>Engineering Metadata, Files & Acceptance Criteria</summary>

   - **Type & Priority**: `Story` | `EPIC-X` | `priority: high` | `domain: canvas, ui`
   - **Complexity**: `medium`
   - **Target Files**: `./web/src/...`
   - **Acceptance Criteria**:
     - Concrete, testable invariants verified by `npm test` or `./gradlew app:testDebugUnitTest`.

   </details>
   ````
8. **Standard Epic & Milestone `gh` CLI Playbook**:
   ```bash
   # Inspect open Epic Tracking Issues and Sprint Milestones
   gh issue list --label epic --state open --json number,title,milestone,labels
   gh api repos/{owner}/{repo}/milestones?state=open --jq '.[] | {number, title, open_issues, closed_issues}'

   # Check off a shipped slice (- [ ] -> - [x] [#NNN — Title](...)) on its Parent Epic Issue
   gh issue view <epic-issue> --json body --jq .body > /tmp/epic_<epic-issue>.md
   gh issue edit <epic-issue> --body-file /tmp/epic_<epic-issue>.md

   # Close a 100%-shipped Epic Issue & Sprint Milestone after beta -> main promotion
   gh issue close <epic-issue> --comment "Completed in [#NNN](../../pull/NNN) (vX.Y.Z Production release)."
   gh api -X PATCH repos/{owner}/{repo}/milestones/<milestone-num> -f state=closed
   ```
<!-- capy-dev-only:start -->
   - **Bot-Opened PRs on `shthed/capy` (`open-pr.yml`)**: Agents **MUST** open and update PRs as `github-actions[bot]` via `gh workflow run open-pr.yml` per [`docs/ai/pr-readiness.md`](./docs/ai/pr-readiness.md).
<!-- capy-dev-only:end -->

---

## 3. Sprint Cadence and Execution

- **Atomic Single-Task PRs (`1-Task = 1-PR` -> `beta`, Default)**: Branch cleanly from updated `origin/beta` (`feature/*`, `fix/*`, or `docs/*`), verify locally with `npm run test:sanity && npm run lint && npm run build && npm test`, open a PR targeting `beta`, and merge once checks and review pass.
- **Cohesive Story / Sprint-Slice PRs**: Group atomic per-task commits for a cohesive Story or P0 bug batch on one `feature/*` branch off `origin/beta` with full local verification before opening one PR targeting `beta`.
- **Sprint Replenishment**: When dev-ready items in [`TODO.md`](./TODO.md) drain (`<= 2` dev tasks remaining), open a lightweight `docs/*` sprint-planning PR pulling the next approved Stories from [`ROADMAP.md`](./ROADMAP.md) and opening the next GitHub Sprint Milestone.

---

## 4. Pull Request Lifecycle and Review Standards

- **Linear Branching & Clean Titles**:
  - Always `git fetch --all --prune` and branch linearly from `origin/beta` (`feature/`, `fix/`, `docs/`, `ci/`, `deps/`, `chore/`). Rebase promptly (`git fetch origin beta && git rebase origin/beta`) whenever `origin/beta` advances.
  - Write clean, prefix-free action-oriented PR titles (e.g., `Add floating precision loupe magnifier for micro-regions`). For standard PRs targeting `beta`, avoid `feat():`, `EPIC-*`, `US-*`, version tags, or comma-separated laundry lists in titles; **Release Promotion PRs merging `beta -> main` include the target version number** (e.g., `Promote Capy Paint v3.0.8 to main`) in both the PR title and PR description.
- **Labels, Milestones & Top-of-PR Ordering**:
  - Attach `epic:*` (only for scoped Epic slices; omit on standalone P0 `BUG-*`), subsystem labels (`web`, `android`), and work-type labels (`feature`, `fix`, `docs`, `ui`, `testing`, `ci`, `deps`), plus the active Sprint Milestone.
  - **Line 1 Plain-English `## Summary` First**: Start every PR description on **line 1** with a concise, plain-English `## Summary` (`1`--`3` everyday sentences or bullets for non-technical readers—no commit SHAs, file paths, symbol names, or CLI flags).
  - **Links, Agile Scope & Technical Overview Underneath**: Directly below `## Summary`, place preview links (when [`deploy-branch.yml`](./.github/workflows/deploy-branch.yml) deploys), clickable **Test Results** links, and `**Agile Scope**: Tracked in [EPIC-N](../../issues/<num>) ... | **Sprint**: Sprint N`, followed by scannable technical overview bullets explaining *what* changed and *why*, plus commit-SHA-pinned code links (`blob/<40-char-sha>/<path>#L<start>-L<end>`).
- **PR Sync-on-Push**:
  - Whenever follow-up commits are pushed, a PR is rebased, or scope/version changes, update the PR title, top `## Summary`, overview bullets, target version, verification test list, SHA-pinned line references, labels, and Milestone so reviewers always see accurate state.
- **Reopening Closed Unmerged PRs**: Recover `refs/pull/<number>/head` onto the original head branch name, push to `origin`, run `gh pr reopen <number>`, rebase onto `origin/beta`, and `git push --force-with-lease`. Merged PRs are immutable—always open a new PR off `origin/beta`.
<!-- capy-dev-only:start -->
- **Private Bot PRs, PR Readiness Checklist & Auto-Merge Gate**: Full `open-pr.yml`, `open-issue.yml`, `PR Readiness Score: 100%` / `PR Readiness Checklist`, `pr-review-gate.yml`, `sync-agile-tracker.yml`, and `Needs Your Testing / Approval` protocols live in [`docs/ai/pr-readiness.md`](./docs/ai/pr-readiness.md).
<!-- capy-dev-only:end -->

---

## 5. Release Promotion and Changelog Governance

- **Pre-Promotion (`beta -> main`) Checklist**:
  1. Play-test the Beta build and APK.
  2. Compile any pending [`.changelog/`](./.changelog/README.md) fragments via `npm run changelog:compile -- --promote` (or reconcile [`CHANGELOG.md`](./CHANGELOG.md) top headings manually):
     - Compiles `.changelog/*.md` (`bump: patch|minor|major`, `<= 320` chars) into `### <ver> - <YYYY-MM-DD> (Beta)` (or appends into an existing same-day `(Beta)` heading without double-bumping), syncs [`web/package.json`](./web/package.json) and `web/package-lock.json`, removes finished `task` sections from [`TODO.md`](./TODO.md), promotes the current `(Beta)` heading to `(Production, Beta)` when `main` and `beta` serve the identical version, and removes `(Production)` from the superseded prior Production release (`sanity.mjs` requires `exactly 1` Production heading, `<= 1` Beta heading, `<= 1` Alpha heading, and line 1 starting with `### `).
     - **Daily / Promotion Release Batching**: Prefer dropping a `.changelog/<slug>.md` fragment on feature/bugfix PRs targeting `beta` and compiling once per day (or per `beta -> main` promotion) via `npm run changelog:compile` so version numbers stay cleanly batched (~1 release per day) rather than creating one version per PR. Whenever `main` and `beta` diverge on patch versions (e.g., `main` serves `3.0.7` while `beta` advances to `3.0.8`), use distinct `### MAJOR.MINOR.PATCH - YYYY-MM-DD` headings (`(Production)` on `main`, `(Beta)` **only** on the single newest Beta head, untagged on superseded releases; `sanity.mjs` enforces `betaHeadingCount <= 1`).
     - **Relative Clickable PR Link Bullet Contract**: Every entry must be a single flat bullet (`- [#NNN](../../pull/NNN) <summary>`) starting with the relative clickable Markdown PR link followed by **1--2 concise plain-English sentences** with no trailing period (zero nested bullets, zero category subheadings, never unlinked `#NNN` or `(PR #NNN)`).
  3. Open the `beta -> main` Release Promotion PR **with the target version number (`v<MAJOR.MINOR.PATCH>`) included in both the PR title and PR description** (e.g., `Promote Capy Paint v3.0.8 to main`) so `Build & Test` and async `Playwright E2E` in [`deploy-branch.yml`](./.github/workflows/deploy-branch.yml) execute cleanly.
- **Post-Merge Release Actions & GitHub Releases Cadence** *(after `beta -> main` merges)*:
  1. `git fetch origin main`, tag `v<MAJOR.MINOR.PATCH>` on `origin/main`, and push the tag (`git tag -a v<ver> -m "v<ver>" && git push origin v<ver>`) to trigger [`release.yml`](./.github/workflows/release.yml) on every Production promotion. [`release.yml`](./.github/workflows/release.yml) builds signed `capy-<tag>.apk`, unversioned `capy.apk` (backing `https://capypaint.com/capy.apk`), Play Store `capy-<tag>.aab`, and `capy-web-<tag>.tgz`, attaching notes extracted from [`CHANGELOG.md`](./CHANGELOG.md) via [`.github/scripts/compile-changelog.mjs`](./.github/scripts/compile-changelog.mjs).
  2. Re-align `origin/beta` to `origin/main` (`git push --force-with-lease origin origin/main:refs/heads/beta`) whenever no unpromoted `beta`-only PRs sit ahead, preventing history divergence on subsequent `beta` PRs.
  3. Close 100%-shipped GitHub Epic Issues and Sprint Milestones.
<!-- capy-dev-only:start -->
- **Clean-Room Public Mirror & Tag-Gated Release Sync (`publish-capyboop.yml`)**: Every push to `shthed/capy` `main` triggers [`publish-capyboop.yml`](./.github/workflows/publish-capyboop.yml) -> [`web/scripts/rebrand-persona.mjs`](./web/scripts/rebrand-persona.mjs), stripping `capy-dev-only` blocks, dev-only docs (`AGENTS.md`, `CAPYBOOP.md`, `docs/ai/`), and internal workflows and asserting zero persona/AI-dev leaks before pushing to `capyboop/paint`. `publish-capyboop.yml` only pushes tag `v<version>` to `capyboop/paint` when a matching `v<version>` tag already exists on `shthed/capy`. Always verify `npm run persona:capyboop -- --dry-run` whenever editing docs or scripts.
<!-- capy-dev-only:end -->

---

## 6. Documentation Sync and Markdown Hygiene Matrix

- **Canonical Root `.md` Files** (indexed in [`README.md`](./README.md), [`DEV.md`](./DEV.md), and this guide):
  - **Product & Community**: [`README.md`](./README.md), [`CONTRIBUTING.md`](./CONTRIBUTING.md), [`SUPPORT.md`](./SUPPORT.md), [`SECURITY.md`](./SECURITY.md), [`ROADMAP.md`](./ROADMAP.md), [`TODO.md`](./TODO.md), [`CHANGELOG.md`](./CHANGELOG.md), [`LICENSE.md`](./LICENSE.md).
  - **Governance & Engineering**: [`PROJECT.md`](./PROJECT.md), [`DEV.md`](./DEV.md)<!-- capy-dev-only:start -->, [`CAPYBOOP.md`](./CAPYBOOP.md), [`AGENTS.md`](./AGENTS.md)<!-- capy-dev-only:end -->.
  - **Technical Subsystem Guides**: [`WEB.md`](./WEB.md), [`PUZZLE.md`](./PUZZLE.md), [`APP.md`](./APP.md), [`CLOUD.md`](./CLOUD.md), [`TESTING.md`](./TESTING.md).
  - **Storefront Privacy Policy**: [`web/public/privacy-policy.html`](./web/public/privacy-policy.html).
- **Automated Hygiene Rules ([`web/scripts/sanity.mjs`](./web/scripts/sanity.mjs))**:
  - Zero unicode emojis, zero box-drawing characters (`U+2500`--`U+257F`), zero `>=3`-column Markdown tables (mobile-first bullet lists preferred), zero `file://` URIs, zero broken relative links, strict `CHANGELOG.md` structure, and complete root `.md` indexing.
- **Docs-Only CI Fast-Path**: PRs modifying exclusively `.md`, `docs/**`, `notes/**`, `.gitignore`, or `LICENSE` pass `Build & Test` via `isDocsOnlyPr` in `< 2s` and do **not** bump [`web/package.json`](./web/package.json); run `npm run test:sanity` locally before pushing.

---

## 7. Continuous Improvement and Retro Log

Whenever a process collision, stale PR state, merge conflict, CI surprise, or verification miss occurs, append a concise entry here (Root Cause -> New Guardrail) in the same or immediate follow-up PR so operational lessons stay codified.

- **Shared Primary Checkout & Version Collisions (PR [#489](../../pull/489) vs. PR [#490](../../pull/490))**: Concurrent streams shared the single primary checkout and both claimed `3.0.2` in `web/package.json` and `CHANGELOG.md`, leaving [#489](../../pull/489) `CONFLICTING`/`DIRTY` -> *Guardrail*: Isolate concurrent feature streams in separate worktrees off fresh `origin/beta` and use `.changelog/` fragments to avoid `CHANGELOG.md` / `web/package.json` collisions.
- **Stacked PRs & `beta` vs. `main` Divergence (PRs [#481](../../pull/481)/[#482](../../pull/482)/[#484](../../pull/484) & [#487](../../pull/487)/[#488](../../pull/488)/[#490](../../pull/490))**: Merging `beta -> main` ([#488](../../pull/488)) without re-aligning `origin/beta` left `main` and `beta` diverged -> *Guardrail*: Check `git ls-remote origin` before branching, keep stacked PRs rebased, and sync `origin/beta` after clean `beta -> main` promotions.
- **Out-of-Sync PR Descriptions & `EPIC-2` Scope Creep (PR [#489](../../pull/489))**: Follow-up pushes left PR metadata stale and unapproved features attached `epic:2` -> *Guardrail*: Keep PR titles, summaries, labels, and milestones synced on every push, enforce strict `EPIC-2` vs. `EPIC-3` triage, and use clickable `[EPIC-N]` / `[#NNN]` naming.
- **`CHANGELOG.md` Same-Day Patch Rollup Collision & Stale Channel Suffixes (PRs [#485](../../pull/485)--[#490](../../pull/490))**: Rolling `3.0.0`--`3.0.2` under one `### 3.0` heading failed once `main` (`3.0.1`) and `beta` (`3.0.2`) diverged -> *Guardrail*: Apply the Same-Day Patch Heading Split rule (`3.0.1` vs `3.0.2`/`3.0.3`), immediately strip superseded channel markers, and enforce clickable `[#NNN](...)` bullets.
- **Brittle Fixed `waitForTimeout` E2E Waits (PR [#486](../../pull/486) Review)**: Fixed sleeps around `replay-controls-window` flaked intermittently under VM load -> *Guardrail*: Replace timing-sensitive waits in [`web/scripts/test.mjs`](./web/scripts/test.mjs) with deterministic DOM state polling/dismissal.
<!-- capy-dev-only:start -->
- **Staging `.agents/` Metadata via `git add -A` ([#485](../../pull/485) Iteration 2, `4e7f6ee`)**: Blind `git add -A` committed 35 untracked agent teamwork files into a code branch -> *Guardrail*: Always inspect `git status`, stage explicit file paths, and verify `git show --stat HEAD` prior to push.
- **Shared Root `.agents/teamwork/ORIGINAL_REQUEST.md` Overwrite (`2026-11-13T06:46:57Z`)**: A concurrent [EPIC-1](../../issues/476) task (`sentinel_1`) overwrote root `.agents/teamwork/ORIGINAL_REQUEST.md` while the PM campaign (`orchestrator_4`) was active -> *Guardrail*: Record per-campaign requests in dedicated team paths and never mutate another team's folder.
- **Default-Branch Activation Delay for `workflow_dispatch` Workflows ([`open-pr.yml`](./.github/workflows/open-pr.yml) in PR [#490](../../pull/490))**: Merging `open-pr.yml` to `beta` does not register `workflow_dispatch` on GitHub Actions until promoted to default branch `main` -> *Guardrail*: Unit-test extracted workflow scripts inside [`web/scripts/test.mjs`](./web/scripts/test.mjs).
<!-- capy-dev-only:end -->
