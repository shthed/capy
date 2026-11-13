# Project Management & Release Governance Guide -- Capy Monorepo (`PROJECT.md`)

Canonical project management manual for **Capy** ([`web/`](./web/), [`app/`](./app/), and [`worker/`](./worker/)). Defines contributor roles, Lean Agile backlog governance across [`ROADMAP.md`](./ROADMAP.md), GitHub Epics, and [`TODO.md`](./TODO.md), sprint execution cadence, pull request lifecycle and description sync, release promotion (`beta -> main`), [`CHANGELOG.md`](./CHANGELOG.md) channel markers, documentation sync, and continuous process improvement.

**Related Guides**: [`README.md`](./README.md) | [`ROADMAP.md`](./ROADMAP.md) | [`TODO.md`](./TODO.md) | [`DEV.md`](./DEV.md) | [`AGENTS.md`](./AGENTS.md) | [`WEB.md`](./WEB.md) | [`PUZZLE.md`](./PUZZLE.md) | [`APP.md`](./APP.md) | [`CLOUD.md`](./CLOUD.md) | [`TESTING.md`](./TESTING.md) | [`CHANGELOG.md`](./CHANGELOG.md) | [`LICENSE.md`](./LICENSE.md)

**Table of Contents**:
1. [Roles, Ownership and Multi-Session Coordination](#1-roles-ownership-and-multi-session-coordination)
2. [Lean Agile Lifecycle and Backlog Governance](#2-lean-agile-lifecycle-and-backlog-governance)
3. [Sprint Cadence and Hybrid Automated Execution](#3-sprint-cadence-and-hybrid-automated-execution)
4. [Pull Request Lifecycle and Readiness Gates](#4-pull-request-lifecycle-and-readiness-gates)
5. [Release Promotion and Changelog Governance](#5-release-promotion-and-changelog-governance)
6. [Documentation Sync and Markdown Hygiene Matrix](#6-documentation-sync-and-markdown-hygiene-matrix)
7. [Continuous Improvement and Retro Log](#7-continuous-improvement-and-retro-log)

> [!IMPORTANT]
> **Division Between `PROJECT.md`, `DEV.md`, and `AGENTS.md`**:
> - [`PROJECT.md`](./PROJECT.md) (this file) is the **canonical Project Management manual** governing backlog lifecycle, Epic triage, PR metadata sync, release promotion, `CHANGELOG.md` channel markers, and process retrospectives.
> - [`DEV.md`](./DEV.md) is the **engineering & co-development manual** covering Gemini model selection, Antigravity session hygiene, Section 5 technical guardrails, local build/test CLI, CI/CD workflow architecture, SemVer/dependencies/assets, and troubleshooting.
> - [`AGENTS.md`](./AGENTS.md) is the **auto-loaded AI operational contract** injected into every agent turn, enforcing non-negotiable per-turn guardrails and pointing to `PROJECT.md` (PM) and `DEV.md` (code/CI).

---

## 1. Roles, Ownership and Multi-Session Coordination

- **Human Project Owner**: Sets product vision and Epic priority in [`ROADMAP.md`](./ROADMAP.md), approves unblocked work entering [`TODO.md`](./TODO.md), resolves architectural and UX trade-offs during `/grill-me` and `/plan`, validates subjective tactile/visual feel on Alpha `/PR/<number>/` and Beta `/beta/` previews, and holds sole final merge authority into `beta` and `main`.
- **AI Contributors & Agents**: Execute approved `TODO.md` slices or documentation updates on clean linear branches off `origin/beta`, keep PR titles/bodies/backlog docs synchronized on every push, run full local verification before marking PRs ready, and pause for explicit Owner approval prior to any merge.
- **Worktree & Diff Hygiene**: Never share one dirty working tree across concurrent sessions or tasks, never stage untracked local agent/scratch files via blind `git add -A`, and verify `git status` plus `git show --stat HEAD` before every push.

<!-- capy-dev-only:start -->
### Multi-Manager Team Charter (`PM <-> Dev Manager` on `shthed/capy`)

- **Project Manager (`PM`) Ownership**:
  - Owns [`PROJECT.md`](./PROJECT.md), [`ROADMAP.md`](./ROADMAP.md), [`TODO.md`](./TODO.md), GitHub Parent Epic Tracking Issues ([EPIC-1](https://github.com/shthed/capy/issues/476)--[EPIC-5](https://github.com/shthed/capy/issues/480)), `epic:*` label descriptions, GitHub Sprint Milestones, PR description/title/label/milestone audits, and `beta -> main` Release Promotion readiness verification.
- **Development Manager (`Dev Manager`) Ownership**:
  - Owns application source (`web/`, `app/`, `worker/`), test & hygiene tooling ([`web/scripts/test.mjs`](./web/scripts/test.mjs), [`web/scripts/sanity.mjs`](./web/scripts/sanity.mjs), [`web/scripts/rebrand-persona.mjs`](./web/scripts/rebrand-persona.mjs)), subsystem technical docs (`WEB.md`, `TESTING.md`, `APP.md`, `PUZZLE.md`, `CLOUD.md`) when modified alongside code/CI PRs, `.github/workflows/*`, GitHub branch rulesets (mutated only with explicit Owner sign-off), [`web/package.json`](./web/package.json) SemVer bumps, technical PR conflict rebases, and engineering sprint execution.
- **Shared-Touchpoint Coordination Contract**:
  - Before opening or updating parallel PRs that touch [`DEV.md`](./DEV.md), [`AGENTS.md`](./AGENTS.md), [`CHANGELOG.md`](./CHANGELOG.md), [`web/scripts/sanity.mjs`](./web/scripts/sanity.mjs), or open PR metadata, PM and Dev Manager coordinate explicitly (via `send_message` / Sentinel relay or PR comments) so **only one active PR** edits [`CHANGELOG.md`](./CHANGELOG.md) or any single shared doc at a time and `web/package.json` patch numbers never collide.
- **Strict Git Worktree Isolation**:
  - Concurrent PM, Dev Manager, and feature sessions must **never** edit files or switch branches inside the shared primary checkout (`/home/antigravity/shthed/capy`). Always run `git fetch --all --prune`, create isolated worktrees off updated `origin/beta` (e.g., `/tmp/wt-pm-*` for PM docs, `/tmp/wt-dev-*` for Dev Manager code/CI), symlink `web/node_modules` from the primary checkout for fast local checks, and remove finished worktrees cleanly without abandoning uncommitted edits on disk.
- **Per-Campaign `.agents/teamwork/` Namespacing**:
  - Concurrent Teamwork teams must isolate all team metadata (`ORIGINAL_REQUEST.md`, `STATUS.md`, `sentinel_*`, `orchestrator_*`, specialist folders) inside dedicated team directories (e.g., `.agents/teamwork/sentinel_2/ORIGINAL_REQUEST.md` for PM vs. `.agents/teamwork/dev_manager/ORIGINAL_REQUEST.md` for Dev Manager). Never overwrite root `.agents/teamwork/ORIGINAL_REQUEST.md` across independent campaigns, and never commit `.agents/` files to Git.
<!-- capy-dev-only:end -->

---

## 2. Lean Agile Lifecycle and Backlog Governance

Capy separates strategic multi-sprint planning from day-to-day execution across the **3-Artefact Agile Triad** ([`ROADMAP.md`](./ROADMAP.md) <-> GitHub Epic Issues & Milestones <-> [`TODO.md`](./TODO.md)).

### Plain-English Agile & Release Terminology

- **Epic (`EPIC-1`..`EPIC-5`)**: A multi-week product theme grouping related player capabilities (planned in [`ROADMAP.md`](./ROADMAP.md), tracked `1:1` by one Parent GitHub Tracking Issue, and filtered via `epic:1`..`epic:5` GitHub Labels). Never bundle an entire Epic into one mega-PR.
- **User Story (`US-X.Y`)**: A cohesive, player-visible outcome inside an Epic written around player value.
- **Task / Subtask (`TASK-X.Ya`)**: An independently testable `1-PR` coding slice (`~10--30 min` agent effort) implementing part or all of a User Story. Active-sprint slices live in [`TODO.md`](./TODO.md) and are deleted immediately upon merge.
- **Bug (`BUG-N`)**: A verified defect, lifecycle guard, or CI reliability fix scheduled at Priority 0 in a Sprint.
- **Sprint (`Sprint 0`..`Sprint 3`)**: A focused batch of `~8--10` unblocked Tasks and Bugs pulled into [`TODO.md`](./TODO.md), integrated onto `beta`, play-tested on `/beta/`, and promoted to `main`.
- **GitHub Milestone (`Sprint N: ...`)**: Native Sprint progress bar (`closed PRs / total PRs %`) assigned to every PR and Epic issue in that Sprint.
- **GitHub Label (`epic:*`, `web`, `android`, `feature`, `fix`, `ui`, `testing`, `ci`, `docs`, `deps`)**: Taxonomy tags allowing PR titles to remain clean and prefix-free.
- **Channels (`Alpha` / `Beta` / `Production`)**: Isolated PR previews at `/PR/<number>/` (`Alpha`, indexed under `/PR`), integration soak branch `beta` at `/beta/` (`Beta`), and live stable `main` at `/` (`Production`).
- **Git Tag (`vX.Y.Z`) & GitHub Release**: Immutable release tag triggering [`release.yml`](./.github/workflows/release.yml) for APK, Play Store `.aab`, `.tgz`, and release notes.

### Canonical Reference Formatting (Epics vs. PRs)

- **PR References Always Use Clickable `#NNN` Links**: Always write PR numbers across docs (`PROJECT.md`, `ROADMAP.md`, `TODO.md`, `CHANGELOG.md`), PR descriptions, PR comments, GitHub Issues, and chat updates as clickable Markdown links `[#NNN](https://github.com/shthed/capy/pull/NNN)` (never plain `#NNN` or backticked `` `#NNN` ``).
- **Epic References Always Use `[EPIC-N](...)` Links**: Whenever referring to an Epic Tracking Issue in prose, docs, PR bodies, or chat, ALWAYS use `[EPIC-N](https://github.com/shthed/capy/issues/<num>)` (or `EPIC-N` when unlinked)—for example [EPIC-1](https://github.com/shthed/capy/issues/476), [EPIC-2](https://github.com/shthed/capy/issues/477), [EPIC-3](https://github.com/shthed/capy/issues/478), [EPIC-4](https://github.com/shthed/capy/issues/479), [EPIC-5](https://github.com/shthed/capy/issues/480)—never bare/backticked `#<epic-issue>` or `[#<epic-issue>](https://github.com/shthed/capy/issues/<num>)` (even in examples or notes), so Epics are strictly distinguished from PR links.
- **Epic Issue PR-List Formatting Standard**: Inside GitHub Epic Tracking Issue bodies ([EPIC-1](https://github.com/shthed/capy/issues/476)--[EPIC-5](https://github.com/shthed/capy/issues/480)), keep items **grouped under Story/Theme subheadings**, put **one entry per line**, place `#NNN` at the **start** of the link text so numbers line up neatly down the left edge (`- [x] [#NNN — Title/Summary](https://github.com/shthed/capy/pull/NNN)`), and **sort numerically by PR number within each group**.

### 3-Artefact Agile Triad & Triage Rules

1. **[`ROADMAP.md`](./ROADMAP.md) (*Strategic Epics, Stories, Icebox & Shipped Archive*)**:
   - Owns all Epics (`EPIC-2`..`EPIC-5`), User Stories (`US-N.M`), readiness status (`Active in Sprint N`, `Ready for Next Sprint`, `Awaiting Owner Review & Approval`, or `Blocked -- External Infra`), Platform Icebox (`ICE-1`..`ICE-3`), and the collapsed `<details>` **Shipped Epics & Stories** archive in Section 6.
   - Blocked items (OAuth/Play Console secrets, hosted WebSocket relays, paid AI endpoints) remain in `ROADMAP.md` with explicit **Unblock Prerequisite** notes until ready.
2. **GitHub Parent Epic Tracking Issues (`1 Issue = 1 Epic`) & Milestones**:
   - Strictly one GitHub Issue per Epic: [EPIC-1](https://github.com/shthed/capy/issues/476) (`CLOSED`), [EPIC-2](https://github.com/shthed/capy/issues/477) (Sprint 1), [EPIC-3](https://github.com/shthed/capy/issues/478) (Sprint 2), [EPIC-4](https://github.com/shthed/capy/issues/479) (Sprint 3), [EPIC-5](https://github.com/shthed/capy/issues/480) (Blocked).
   - **Zero Sub-Issue Sprawl**: Never open separate GitHub Issues for `TASK-*` slices, Sprint `BUG-*` fixes, or `ICE-*` items unless explicitly requested. Charter a new `EPIC-N` issue only when promoting an `ICE-*` item or new product theme into active scheduling.
   - **Epic Triage (`EPIC-2` vs. `EPIC-3..5`)**: Keep [EPIC-2](https://github.com/shthed/capy/issues/477) (`v3.0.1` Critical Bugfixes & Release) scoped strictly to priority bugfixes, explicitly Owner-approved stabilization polish, and Android Play release (`TASK-2.5`). Route unapproved or post-stabilization feature work to [EPIC-3](https://github.com/shthed/capy/issues/478)--[EPIC-5](https://github.com/shthed/capy/issues/480); never attach `epic:2` to unapproved features.
3. **[`TODO.md`](./TODO.md) (*Focused 1-Sprint Ready Queue*)**:
   - Holds **only** active-sprint approved items (`~8--10` max). Separate **agent-ready `1-PR` dev slices** (`[quick-win]` for `<= 15 min`, `1--3` file slices) clearly from any **Release & Human Ops Gates** subsection (DNS cutover, Play Store keystore/console uploads) so agents never treat manual infrastructure ops as code tasks.
4. **Definition of Ready (Anti-Busywork Gate)**:
   - A task enters [`TODO.md`](./TODO.md) only when it delivers concrete player or reliability value (`Why Now`), satisfies all external prerequisites, and verifies exact file/symbol paths against `origin/beta`/`origin/main`. Reject zero-impact housekeeping chores or premature dummy credential configs.
5. **Definition of Done**:
   - **Delete from `TODO.md` Immediately**: Never leave `[x]` items in [`TODO.md`](./TODO.md); delete shipped `BUG-*` / `TASK-*` items in the PR that completes them.
   - **Check Off Parent Epic Issue**: Mark `- [x] [#NNN — Title](https://github.com/shthed/capy/pull/NNN)` inside the matching Epic Issue (`gh issue edit`).
   - **Archive in `ROADMAP.md`**: Move completed Stories/Epics into Section 6 `<details>` with clickable `[#NNN](https://github.com/shthed/capy/pull/NNN)` links; close the Epic Issue and Sprint Milestone only once `100%` of its scope ships to Production `main`.
6. **Never Auto-Close an Incomplete Epic (`Tracked in` vs. `Closes`)**:
   - Never use `Closes #...`, `Fixes #...`, or `Resolves #...` on partial Epic PRs. Write `**Agile Scope**: Tracked in [EPIC-N](https://github.com/shthed/capy/issues/<num>) (US-X.Y: TASK-X.Ya)` so GitHub cross-references the PR while keeping the Epic `OPEN`. Standalone P0 `BUG-*` PRs attach the Sprint Milestone + `fix` + subsystem labels without an unrelated `epic:*` label.
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
   <summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

   - **Type & Priority**: `Story` | `EPIC-X` | `priority: high` | `domain: canvas, ui`
   - **Complexity & Model**: `medium` | **Recommended Model**: `Gemini 3.8 Flash` (`X.Ya`), `Gemini 4 Argon` (`X.Yb`)
   - **Effort Estimate**: `~35,000 tokens` | `~16--22 min agent` (`~4--6 hrs human`)
   - **Target Files**: `./web/src/...`
   - **Acceptance Criteria**:
     - Concrete, testable invariants verified by `npm test` or `./gradlew app:testDebugUnitTest`.

   </details>
   ````
8. **Standard Epic & Milestone `gh` CLI Playbook** *(announce GitHub writes before running)*:
   ```bash
   # Inspect open Epic Tracking Issues and Sprint Milestones
   gh issue list -R shthed/capy --label epic --state open --json number,title,milestone,labels
   gh api repos/shthed/capy/milestones?state=open --jq '.[] | {number, title, open_issues, closed_issues}'

   # Check off a shipped slice (- [ ] -> - [x] [#NNN — Title](...)) on its Parent Epic Issue
   gh issue view <epic-issue> -R shthed/capy --json body --jq .body > /tmp/epic_<epic-issue>.md
   gh issue edit <epic-issue> -R shthed/capy --body-file /tmp/epic_<epic-issue>.md

   # Close a 100%-shipped Epic Issue & Sprint Milestone after beta -> main promotion
   gh issue close <epic-issue> -R shthed/capy --comment "Completed in [#NNN](https://github.com/shthed/capy/pull/NNN) (vX.Y.Z Production release)."
   gh api -X PATCH repos/shthed/capy/milestones/<milestone-num> -f state=closed
   ```
<!-- capy-dev-only:start -->
   - **Bot-Opened PRs on `shthed/capy` (`open-pr.yml`)**: Once [`open-pr.yml`](./.github/workflows/open-pr.yml) is active on `main`, agents open Draft PRs via `gh workflow run open-pr.yml -f head=feature/<short-topic> -f base=beta -f title="..." -f draft=true ...` (falling back to `gh pr create` only beforehand) and then run `gh pr ready <num>` (or push follow-up commits / dispatch `deploy-branch.yml`) to trigger CI and unlock 1-click Owner native **Approve**.
<!-- capy-dev-only:end -->

---

## 3. Sprint Cadence and Hybrid Automated Execution

- **Mode 1 -- Atomic Single-Task PRs (`1-Task = 1-PR` -> `beta`, Default)**: Start a fresh `#NNN` chat for one ready `BUG-*` or `TASK-*` on `feature/*`, `fix/*`, or `docs/*` branched from updated `origin/beta`, verify locally, open a Draft PR targeting `beta`, mark ready after checks pass, and wait for Owner merge approval.
- **Mode 2 -- Cohesive Story / Sprint-Slice PRs (`/goal` or `/teamwork` -> `beta`)**: Execute a cohesive Story or P0 batch on one `automation/sprint-*` or `feature/*` branch off `origin/beta` with atomic per-task commits, non-overlapping file ownership across workers, and full local `npm run test:sanity && npm run lint && npm run build && npm test` verification before opening one PR targeting `beta`.
- **Sprint Replenishment**: When dev-ready items in [`TODO.md`](./TODO.md) drain (`<= 2` dev tasks remaining), open a lightweight `docs/*` sprint-planning PR pulling the next approved Stories from [`ROADMAP.md`](./ROADMAP.md) and opening the next GitHub Sprint Milestone.

---

## 4. Pull Request Lifecycle and Readiness Gates

- **Linear Branching & Clean Titles**:
  - Always `git fetch --all --prune` and branch linearly from `origin/beta` (`feature/`, `automation/`, `fix/`, `docs/`, `ci/`, `deps/`, `chore/`). Rebase promptly (`git fetch origin beta && git rebase origin/beta`) whenever `origin/beta` advances.
  - Write clean, prefix-free action-oriented PR titles (e.g., `Add floating precision loupe magnifier for micro-regions`). Never put `feat():`, `EPIC-*`, `US-*`, version tags, or comma-separated laundry lists in titles.
- **Labels, Milestones & Top-of-PR Header**:
  - Attach `epic:*` (only for scoped Epic slices; omit on standalone P0 `BUG-*`), subsystem labels (`web`, `android`), and work-type labels (`feature`, `fix`, `docs`, `ui`, `testing`, `ci`, `deps`), plus the active Sprint Milestone.
  - Place the Alpha preview URL (`https://shthed.github.io/capy/PR/<number>/`, when [`deploy-branch.yml`](./.github/workflows/deploy-branch.yml) deploys; skipped cleanly on pure-docs `isDocsOnlyPr` PRs), preview APK URL when applicable, and `**Agile Scope**: Tracked in [EPIC-N](https://github.com/shthed/capy/issues/<num>) ... | **Sprint**: Sprint N` at the top of the PR body, followed by scannable plain-English overview bullets explaining *what* changed and *why*, plus commit-SHA-pinned code links (`blob/<40-char-sha>/<path>#L<start>-L<end>`—never drifting `blob/main/...` or deleted branch links).
- **Mandatory PR Sync-on-Every-Push & Rebase Rule**:
  - Whenever follow-up commits are pushed, a PR is rebased, `origin/beta` advances, or scope/version changes, **immediately** synchronize:
    1. PR title, labels, and Sprint Milestone (`gh pr edit`).
    2. PR body overview bullets, target version, verification test list, and SHA-pinned line references (never leave stale `MERGEABLE` or old-SHA claims in the body or Development Summary comment).
    3. `gh pr view <num> --json mergeable,mergeStateStatus` confirming `MERGEABLE` / `CLEAN` before requesting review.
- **End-of-PR 5-Pillar Readiness Rubric (`>= 95%`)**:
  - **Pillar 1 -- Functionality & Edge Cases (`20` pts)**: Gestures, persistence, modal back-stack, viewport clamping, and fallbacks verified.
  - **Pillar 2 -- Automated Tests (`20` pts)**: `npm run test:sanity && npm run lint && npm run build && npm test` (plus `./gradlew app:testDebugUnitTest app:assembleDebug` for Android/bridge work) run locally in the VM.
  - **Pillar 3 -- Performance & Golden Invariants (`20` pts)**: Zero per-frame heap allocations, worker-only segmentation, `./assets/...` relative paths, and safe `NativeBridge` fallbacks per [`DEV.md` Section 5](./DEV.md#5-core-technical-guardrails-web--app).
  - **Pillar 4 -- Docs & Changelog Sync (`20` pts)**: SemVer bumped on code PRs, [`CHANGELOG.md`](./CHANGELOG.md) entry with active channel marker and clickable `[#NNN](https://github.com/shthed/capy/pull/NNN)` link, completed `TODO.md` items deleted, Epics/`ROADMAP.md` synced, mobile-safe zero-emoji formatting verified.
  - **Pillar 5 -- CI, Mergeability & Preview Verification (`20` pts)**: `MERGEABLE` / `CLEAN` atop target base, CI checks green, live preview URL and overview bullets present.
  - Place `### PR Readiness & Perfection Confidence Score: <N>% (<N> / 100)` at the **end** of the PR body and Development Summary comment inside `<details><summary>...</summary> ... </details>` (with blank lines after `</summary>` and before `</details>`), followed by a concise closing rationale (and append `- [ ]` subtasks *only* if `< 100%` complete for tasks scoped inside that PR).
- **Reopening Closed Unmerged PRs**: Recover `refs/pull/<number>/head` onto the original head branch name, push to `origin`, run `gh pr reopen <number>`, rebase onto `origin/beta`, and `git push --force-with-lease`. Merged PRs are immutable—always open a new PR off `origin/beta`.
<!-- capy-dev-only:start -->
- **Bot-Authored Draft PRs (`open-pr.yml`) & Dual Review Gate (`pr-review-gate.yml`)**:
  - Open Draft PRs via `gh workflow run open-pr.yml` once live on `main` (falling back to `gh pr create` beforehand), verify locally, run `gh pr ready <num>` FIRST (emitting `ready_for_review` to trigger CI + previews), then post an independent read-only AI Reviewer comment containing `<!-- capy-review: actor=ai-agent verdict=APPROVED sha=<40_CHAR_HEAD_SHA> score=<SCORE>% -->` (`score >= 95`) and apply `review:ai-approved`.
  - On `github-actions[bot]`-opened PRs, only the Project Owner's 1-click native GitHub **Approve** on current `HEAD` satisfies [`pr-review-gate.yml`](./.github/workflows/pr-review-gate.yml) (`capy/review-gate`); never apply `review:owner-approved` or post human approval comments unprompted.
<!-- capy-dev-only:end -->

---

## 5. Release Promotion and Changelog Governance

- **Pre-Promotion (`beta -> main`) Checklist**:
  1. Play-test `https://shthed.github.io/capy/beta/` (and `/beta/capy.apk`).
  2. Reconcile [`CHANGELOG.md`](./CHANGELOG.md) top headings and channel markers:
     - Promote current `(Beta)` heading to `(Production, Beta)` when `main` and `beta` serve the identical version, and remove `(Production)` from the superseded prior Production release (`sanity.mjs` requires `exactly 1` Production heading, `<= 1` Beta heading, `<= 1` Alpha heading, and line 1 starting with `### `).
     - **Same-Day Patch Heading Split Rule**: Consecutive `+0.0.1` Beta patches on the same UTC date may roll under `### MAJOR.MINOR - YYYY-MM-DD (Beta)` ONLY while `main` and `beta` do not carry distinct patch releases under the same `MAJOR.MINOR`. Whenever `main` and `beta` diverge on patch versions (e.g., `main` serves `3.0.1` while `beta` advances through `3.0.2` -> `3.0.3`), split into distinct `### MAJOR.MINOR.PATCH - YYYY-MM-DD` headings (`### 3.0.1 - YYYY-MM-DD (Production)`, `### 3.0.2 - YYYY-MM-DD` untagged once superseded, and `### 3.0.3 - YYYY-MM-DD (Beta)` as the single newest Beta head) so Production and Beta releases stay unambiguous—keep `(Beta)` **only** on the single newest Beta patch heading and drop `(Beta)` from superseded same-day Beta patch headings (`sanity.mjs` enforces `betaHeadingCount <= 1`).
     - **Clickable PR Link Bullet Contract**: Every bullet begins with `- ` (zero nested bullets, zero category subheadings) and ends with a clickable `[#NNN](https://github.com/shthed/capy/pull/NNN)` link (never unlinked `#NNN` or `(PR #NNN)`).
  3. Open the Draft `beta -> main` Release Promotion PR, mark ready (`gh pr ready <num>`) so `Playwright E2E Release Gate` in [`deploy-branch.yml`](./.github/workflows/deploy-branch.yml) executes, verify `MERGEABLE`, and wait for explicit Owner approval.
- **Post-Merge Release Actions** *(after Owner merges `beta -> main`)*:
  1. `git fetch origin main`, tag `v<MAJOR.MINOR.PATCH>` on `origin/main`, and push the tag to trigger [`release.yml`](./.github/workflows/release.yml).
  2. Re-align `origin/beta` to `origin/main` (`git push --force-with-lease origin origin/main:refs/heads/beta`) whenever no unpromoted `beta`-only PRs sit ahead, preventing history divergence on subsequent `beta` PRs.
  3. Close 100%-shipped GitHub Epic Issues and Sprint Milestones.
<!-- capy-dev-only:start -->
- **Clean-Room Public Mirror (`publish-capyboop.yml`)**: Every push to `shthed/capy` `main` triggers [`publish-capyboop.yml`](./.github/workflows/publish-capyboop.yml) -> [`web/scripts/rebrand-persona.mjs`](./web/scripts/rebrand-persona.mjs), stripping `capy-dev-only` blocks and internal workflows and asserting zero source persona leaks before pushing to `capyboop/capy`. Always verify `npm run persona:capyboop -- --dry-run` whenever editing docs or scripts.
<!-- capy-dev-only:end -->

---

## 6. Documentation Sync and Markdown Hygiene Matrix

- **Canonical 13 Root `.md` Files** (indexed in [`README.md`](./README.md), [`DEV.md`](./DEV.md), and this guide):
  - **Product & Governance**: [`README.md`](./README.md), [`PROJECT.md`](./PROJECT.md), [`DEV.md`](./DEV.md), [`AGENTS.md`](./AGENTS.md), [`ROADMAP.md`](./ROADMAP.md), [`TODO.md`](./TODO.md), [`CHANGELOG.md`](./CHANGELOG.md), [`LICENSE.md`](./LICENSE.md).
  - **Technical Subsystem Guides**: [`WEB.md`](./WEB.md), [`PUZZLE.md`](./PUZZLE.md), [`APP.md`](./APP.md), [`CLOUD.md`](./CLOUD.md), [`TESTING.md`](./TESTING.md).
  - **Storefront Privacy Policy**: [`web/public/privacy-policy.html`](./web/public/privacy-policy.html).
- **Automated Hygiene Rules ([`web/scripts/sanity.mjs`](./web/scripts/sanity.mjs))**:
  - Zero unicode emojis, zero box-drawing characters (`U+2500`--`U+257F`), zero `>=3`-column Markdown tables (mobile-first bullet lists preferred), zero `file://` URIs, zero broken relative links, strict `CHANGELOG.md` structure, and complete root `.md` indexing.
- **Docs-Only CI Fast-Path**: PRs modifying exclusively `.md`, `docs/**`, `notes/**`, `.gitignore`, or `LICENSE` pass `Build & Test` via `isDocsOnlyPr` in `< 2s` and do **not** bump [`web/package.json`](./web/package.json); run `npm run test:sanity` locally before pushing.

---

## 7. Continuous Improvement and Retro Log

Whenever a process collision, stale PR state, merge conflict, CI surprise, or verification miss occurs, append a concise entry here (Root Cause -> New Guardrail) in the same or immediate follow-up PR so operational lessons stay codified.

- **Staging `.agents/` Metadata via `git add -A` ([#485](https://github.com/shthed/capy/pull/485) Iteration 2, `4e7f6ee`)**: Blind `git add -A` committed 35 untracked agent teamwork files into a code branch -> *Guardrail*: Always inspect `git status`, stage explicit file paths, and verify `git show --stat HEAD` prior to push.
- **Shared Primary Checkout & Version Collisions (PR [#489](https://github.com/shthed/capy/pull/489) vs. PR [#490](https://github.com/shthed/capy/pull/490))**: Concurrent streams shared the single primary checkout and both claimed `3.0.2` in `web/package.json` and `CHANGELOG.md`, leaving [#489](https://github.com/shthed/capy/pull/489) `CONFLICTING`/`DIRTY` with uncommitted `web/scripts/test.mjs` edits on disk -> *Guardrail*: Isolate every concurrent session in its own `/tmp/wt-*` worktree off fresh `origin/beta` and coordinate `CHANGELOG.md` / SemVer patch assignments before editing.
- **Stacked PRs & `beta` vs. `main` Divergence (PRs [#481](https://github.com/shthed/capy/pull/481)/[#482](https://github.com/shthed/capy/pull/482)/[#484](https://github.com/shthed/capy/pull/484) & [#487](https://github.com/shthed/capy/pull/487)/[#488](https://github.com/shthed/capy/pull/488)/[#490](https://github.com/shthed/capy/pull/490))**: Merging `beta -> main` ([#488](https://github.com/shthed/capy/pull/488)) without re-aligning `origin/beta` (and merging [#487](https://github.com/shthed/capy/pull/487) 47s after [#488](https://github.com/shthed/capy/pull/488)) left `main` and `beta` diverged (`ahead_by: 2, behind_by: 2`) -> *Guardrail*: Check `git ls-remote origin` before branching, keep stacked PRs rebased, and sync `origin/beta` after clean `beta -> main` promotions.
- **Out-of-Sync PR Descriptions, Stale Review SHAs & `EPIC-2` Scope Creep (PR [#489](https://github.com/shthed/capy/pull/489))**: Pushing follow-up commits left PR [#489](https://github.com/shthed/capy/pull/489)'s AI review SHA stale (`c46496f` vs `8a2ccc9`), body still claimed `MERGEABLE`, `milestone` stayed `None`, title used a prefixed laundry list, and unapproved features attached `epic:2` -> *Guardrail*: Enforce sync-on-every-push PR metadata updates, strict `EPIC-2` vs. `EPIC-3` triage, and clickable `[EPIC-N]` / `[#NNN]` naming.
- **`CHANGELOG.md` Same-Day Patch Rollup Collision & Stale Channel Suffixes (PRs [#485](https://github.com/shthed/capy/pull/485)--[#490](https://github.com/shthed/capy/pull/490))**: Rolling `3.0.0`--`3.0.2` under one `### 3.0` heading failed once `main` (`3.0.1`) and `beta` (`3.0.2`) diverged, while superseded `(Production)` and `(Alpha)` suffixes remained stale -> *Guardrail*: Apply the Same-Day Patch Heading Split rule (`3.0.1` vs `3.0.2`/`3.0.3`), immediately strip superseded channel markers, and enforce clickable `[#NNN](...)` bullets.
- **Brittle Fixed `waitForTimeout` E2E Waits (PR [#486](https://github.com/shthed/capy/pull/486) Review)**: Fixed sleeps around `replay-controls-window` flaked intermittently under VM load -> *Guardrail*: Replace timing-sensitive waits in [`web/scripts/test.mjs`](./web/scripts/test.mjs) with deterministic DOM state polling/dismissal.
<!-- capy-dev-only:start -->
- **Shared Root `.agents/teamwork/ORIGINAL_REQUEST.md` Overwrite (`2026-11-13T06:46:57Z`)**: A concurrent [EPIC-1](https://github.com/shthed/capy/issues/476) task (`sentinel_1`) overwrote root `.agents/teamwork/ORIGINAL_REQUEST.md` while the PM campaign (`orchestrator_4`) was active -> *Guardrail*: Record per-campaign requests in dedicated team paths (`.agents/teamwork/sentinel_2/ORIGINAL_REQUEST.md`, `.agents/teamwork/dev_manager/ORIGINAL_REQUEST.md`) and never mutate another team's folder.
- **Default-Branch Activation Delay for `workflow_dispatch` Workflows ([`open-pr.yml`](./.github/workflows/open-pr.yml) in PR [#490](https://github.com/shthed/capy/pull/490))**: Merging `open-pr.yml` to `beta` does not register `workflow_dispatch` on GitHub Actions until promoted to default branch `main` -> *Guardrail*: Document `gh pr create` explicitly as fallback until the workflow lands on `main`, and unit-test extracted workflow scripts inside [`web/scripts/test.mjs`](./web/scripts/test.mjs).
<!-- capy-dev-only:end -->
