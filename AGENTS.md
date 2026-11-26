# AI Agent Operational Playbook — Capy Monorepo (`web/`, `app/`, `worker/`)

Capy is a multi-platform color-by-number suite (`https://github.com/shthed/capy`, production at `https://capypaint.com/`, previews at `https://shthed.github.io/capy/`). This file is auto-loaded every AI turn—keep it concise (`< 16 KB`) so zero rules are ever truncated.

- **Technical Guardrails & CI**: [`DEV.md`](./DEV.md) (read [`DEV.md` Section 2](./DEV.md#2-core-technical-guardrails-web--app) before editing code).
- **PM, Backlog & Releases**: [`PROJECT.md`](./PROJECT.md).
- **Private AI Specs**: [`docs/ai/pr-readiness.md`](./docs/ai/pr-readiness.md) | [`docs/ai/workflow-and-models.md`](./docs/ai/workflow-and-models.md) | [`docs/ai/cross-repo-guardrail.md`](./docs/ai/cross-repo-guardrail.md) | [`CAPYBOOP.md`](./CAPYBOOP.md).

---

## 1. AI Golden Invariants (Non-Negotiable Agent Guardrails)

1. **Bot-only GitHub actions (`shthed` strictly for personal human actions), `beta`-first pipeline & strict `100%` AI auto-merge**:
   - Execute all AI PRs, issues, reviews, merges, and post-merge workflow dispatches strictly as `github-actions[bot]` via `GITHUB_TOKEN` ([`open-pr.yml`](./.github/workflows/open-pr.yml), [`open-issue.yml`](./.github/workflows/open-issue.yml), [`pr-review-gate.yml`](./.github/workflows/pr-review-gate.yml))—never run `gh pr create` / `gh pr review` as `shthed` and never use a personal `shthed` PAT in workflows. `shthed` must ONLY appear on actions performed personally by the human Project Owner.
   - Daily feature/bugfix PRs branch from and target **`beta`** (`--squash`); only Release Promotions (`beta -> main`, `--merge`) target `main`. Never push product code or `web/scripts/` directly to `main` or `beta`.
   - **Major UI changes** (layout overhauls, new/reorganized modals, settings, navigation, visual redesigns, tutorial flows) MUST carry `review:owner-required` and hold until explicit Human Project Owner approval (`APPROVED` on HEAD or `review:owner-approved`). All other `beta`/`main` PRs auto-merge once strict `100%` independent AI approval, green `Build & Test` (plus `Playwright E2E` and `Android APK` on `main`), and zero active Owner holds pass.
   - On every PR open/update, verify `MERGEABLE` via `gh pr view <num> --json mergeable,mergeStateStatus` (rebasing immediately if behind base) and keep PR title, `## Summary`, labels, and links synced.
2. **Build Android freely; never install unprompted**: Run `./gradlew app:testDebugUnitTest`, `./gradlew app:buildWeb`, and `./gradlew app:assembleDebug` freely; never run `./gradlew app:installDebug` unless asked.
3. **Visible status updates & thoughts**: Briefly explain what file/system is inspected, why, and what was learned in present-participle chat updates ("Inspecting...", "Verifying...", "Updating...").
4. **Enforce [`DEV.md` Section 2](./DEV.md#2-core-technical-guardrails-web--app) & verify builds**: Pass `npm run test:sanity`, `npm run lint`, and `npm run build` before pushing code PRs.
5. **Doc hygiene, `ROADMAP.md` & mandatory Issue logging for plans/audits**:
   - Zero emojis and zero box-drawing ASCII art in `.md` files; verify symbol/file names before documenting (avoid unpinned `#L...` line numbers in `.md` guides).
   - GitHub Epics and `TODO.md` are retired—keep [`ROADMAP.md`](./ROADMAP.md) concise (`Now / Next / Later`) and track active work in focused GitHub Issues.
   - Whenever finishing an Owner-review plan or a code/product review or audit, log it as a bot-authored GitHub Issue via `open-issue.yml`.
   - Whenever the Project Owner establishes a rule or we decide on a process/design change, immediately update the relevant living documentation (`AGENTS.md`, `docs/ai/*`, `PROJECT.md`, `DEV.md`, or subsystem guides).
   - Sync relevant subsystem docs ([`PROJECT.md`](./PROJECT.md), [`DEV.md`](./DEV.md), [`ROADMAP.md`](./ROADMAP.md), [`WEB.md`](./WEB.md), [`PUZZLE.md`](./PUZZLE.md), [`APP.md`](./APP.md), [`CLOUD.md`](./CLOUD.md), [`TESTING.md`](./TESTING.md), [`CHANGELOG.md`](./CHANGELOG.md), [`README.md`](./README.md)) whenever behavior or architecture changes.
6. **Report `100%` PR Readiness Score at the end of PRs**:
   - Place `### PR Readiness Score: <N>%` at the **end** of every PR description and summary comment, wrapping a variable-length, scope-relevant **PR Readiness Checklist** inside `<details><summary>PR Readiness Checklist</summary>...</details>` (blank lines after `</summary>` and before `</details>`, with `%` at the start of each bullet: `- **100%** — **<Criterion>**: <summary>`), followed by a brief closing rationale (and `- [ ]` subtasks *only* when `< 100%`). Full spec: [`docs/ai/pr-readiness.md`](./docs/ai/pr-readiness.md).
7. **Mobile-first formatting (no wide tables)**: Use compact bullet lists in chat, artifacts, PRs, and `.md` files; reserve tables strictly for `<= 2` narrow columns.
8. **Sync live GitHub state (and whiteboard in multi-chat studio mode) & close cleanly**:
   - Check live GitHub (`gh pr list --state open`, `gh run list`, active PR checks/comments, open Issues) at task start and before handoffs or release decisions. When running in multi-chat studio mode with an existing `~/.gemini/WHITEBOARD.md`, read it and update only your own role section with a UTC timestamp (skip when `~/.gemini/WHITEBOARD.md` does not exist in isolated single-chat cloud VMs).
   - Close status reports, handoffs, and reviews with **Needs Your Testing / Approval** listing clickable pending items (or confirming nothing is blocked). Ask clarifying design questions via `/grill-me` (`ask_question`, recommended option first) and repeat any open question at the end of your response.
9. **Clickable links everywhere & zero cross-repo `capyboop/paint` leaks**:
   - Format all web URLs/domains as `[Label](https://...)` (never backticked).
   - **Committed `.md` files**: use relative links (`./FILE.md`, `[#NNN](../../pull/NNN)`, `[#NNN — Issue Title](../../issues/NNN)`).
   - **GitHub PRs, Issues, comments & chat**: ALWAYS use full `https://github.com/shthed/capy/...` URLs (commit-SHA `blob/<sha>/...` for files, `/pull/NNN` with title `[#NNN — PR Title](https://github.com/shthed/capy/pull/NNN)`)—never relative `./` or `../../` links, which 404 on GitHub PR/Issue pages.
   - **Critical persona guardrail**: Inside `shthed/capy` PRs, issues, comments, and commit messages, NEVER write live `https://github.com/capyboop/paint/issues/N` URLs or `capyboop/paint#N` shorthand (write plain text like `` `capyboop/paint` public issue 3 ``; full spec in [`docs/ai/cross-repo-guardrail.md`](./docs/ai/cross-repo-guardrail.md)).
   - **Agent/session links**: Locally in chat/whiteboards/artifacts, link known agents as `` `[<Agent>](conversation://<id>)` ``. On GitHub PRs, Issues, and comments, ALWAYS link the creating Antigravity session as `[Session <short-id>](https://antigravity.google.com/remote/<session-uuid>?project=ec566d37-5975-45ad-93ae-80e6e32daaa5)` (using Capy project ID `ec566d37-5975-45ad-93ae-80e6e32daaa5`). Keep committed repo docs free of ephemeral session UUIDs.
10. **Push approved living docs & CI workflow fixes directly to `main` (no PR noise)**:
    - Push document-owner-approved living docs ([`AGENTS.md`](./AGENTS.md), [`CAPYBOOP.md`](./CAPYBOOP.md), [`PROJECT.md`](./PROJECT.md), [`DEV.md`](./DEV.md), `docs/ai/*`) and Owner/Dev-Manager-approved `.github/workflows/` fixes directly to `main` after verifying `npm run test:sanity`, relevant `npm run test:unit` checks, and `npm run persona:capyboop -- --dry-run`. Confirm `sync-beta-from-main.yml` cleanly back-merges `main -> beta` via `--merge`. All game code and `web/scripts/` changes go through PRs targeting `beta`.
11. **Errored/`429`/`503` cloud-session recovery**: If a remote session hits `RESOURCE_EXHAUSTED (code 429)` or `UNAVAILABLE (code 503)`, stop retrying remote containers immediately and recover locally per [`CAPYBOOP.md` Section 3.5](./CAPYBOOP.md#35-errored-hung-503-or-quota-exhausted-429-cloud-session-respawn-protocol).

---

## 2. Token Efficiency & Context Discipline

- **On-Demand Loading**: Load [`PROJECT.md`](./PROJECT.md) or [`DEV.md`](./DEV.md) plus only the subsystem `.md` needed for the task—never all guides upfront.
- **Search Before Sliced Reads**: Run `rg` first, then `view_file` narrow ranges (`<= 150` lines). Batch independent reads/edits in parallel.
- **Subagent Isolation**: Delegate broad multi-file surveys (5+ files) and independent PR reviews to `research` subagents (`Model: 'inherit'`, `Workspace: 'inherit'`); do 1--3 file lookups directly.
- **Fast Local Verification**: Run the base check (`npm run test:sanity && npm run lint && npm run build && npm run test:unit`) plus targeted `npm run test:e2e -- --suite=<affected>` or `npm run test:e2e:smoke` (`~20s`) for `beta` PRs (reserving full `npm run test:e2e` for cross-cutting UI/state changes or `beta -> main` promotions). Pure `.md` PRs pass CI in `< 2s` (`npm run test:sanity`).

---

## 3. Task Routing & Core Commands

Base web check (`cd web`): `npm run test:sanity && npm run lint && npm run build && npm run test:unit`. Always sync [`DEV.md`](./DEV.md), [`ROADMAP.md`](./ROADMAP.md) (if priorities shift), and drop a `.changelog/` fragment (compiled into [`CHANGELOG.md`](./CHANGELOG.md) on release).

- **UI & Controls** (`web/src/components/*`, `index.css`): Base check + `npm run test:e2e -- --suite=<affected>` (or `test:e2e:smoke`; `+ gallery:capture` if visual). Sync [`WEB.md`](./WEB.md).
- **Puzzle Worker** (`web/src/engine/*`, `puzzle.worker.ts`): Base check + `npm run test:e2e:smoke`. Sync [`PUZZLE.md`](./PUZZLE.md).
- **Cloud, Worker & Codec** (`web/src/services/*Cloud*`, `CapyCodec.ts`, `worker/*`, `wrangler.jsonc`): Base check + `npm run test:e2e -- --suite=coop,accessibility` (unit-only if `worker/`-only). Sync [`CLOUD.md`](./CLOUD.md).
- **Android (`:app`)** (`app/src/main/*`, `NativeBridge.ts`): Base check + `./gradlew app:testDebugUnitTest app:assembleDebug` (`+ test:e2e -- --suite=offers` if bridge UI changed). Sync [`APP.md`](./APP.md).
- **Tests & CI/CD** (`web/scripts/*`, `.github/workflows/*`): Base check (`+ npm run test:e2e` when editing `web/scripts/tests/e2e/`). Sync [`TESTING.md`](./TESTING.md).
- **Docs & Governance** (`*.md`, `docs/*`): `npm run test:sanity && npm run persona:capyboop -- --dry-run`. Sync affected guides.
- **Web CLI (`cd web`)**: `npm ci` | `npm run test:sanity` | `npm run lint` | `npm run build` | `npm run test:unit` | `npm run test:e2e:smoke` | `npm run test:e2e` | `npm test` | `npm run changelog:compile` | `npm run persona:capyboop` | `npm run preview` | `npm run gallery:capture` | `npm run generate:samples`.
- **Android CLI (root)**: `./gradlew app:buildWeb` | `./gradlew app:testDebugUnitTest` | `./gradlew app:assembleDebug`.

---

## 4. PR Lifecycle, Summaries & Review Gate

Full specification and copy-paste checklist template live in [`docs/ai/pr-readiness.md`](./docs/ai/pr-readiness.md):

- **Branching & Isolation**: Always `git fetch --all --prune` and branch linearly onto `origin/beta` (use isolated worktrees across concurrent sessions). Keep diffs minimal; never commit secrets or `.agents/` files.
- **Opening Bot PRs ([`open-pr.yml`](./.github/workflows/open-pr.yml))**:
  - Dispatch `gh workflow run open-pr.yml -f head=<branch> -f base=beta -f title="..." -f body="..." -f draft=true -f labels="..."` (never `gh pr create` as `shthed`).
  - Keep regular `beta` PR titles and `.changelog/` filenames **version-agnostic** (reserve `vX.Y.Z` strictly for `changelog:compile` and `beta -> main` Release Promotion PRs).
  - **WIP Draft PRs** (unfinished work staying in Draft) MUST include `- [ ]` items for remaining work; resolve all `- [ ]` items before marking Ready.
  - **Locally-verified ready PRs** may pass the finalized `100%` body directly on the first `open-pr.yml` dispatch and immediately run `gh pr ready <num>` (triggering CI + Gate in one pass without a throwaway Draft body).
- **Line-1 Plain-English `## Summary` & Metadata**: Start every PR body on line 1 with `## Summary` (`1--3` non-technical sentences for players/reviewers), followed underneath by preview links (`https://shthed.github.io/capy/alpha/<num>/`), **Test Results** links, issue links (`Closes #NNN` / `Refs #NNN`), technical bullets with full SHA-pinned `https://github.com/shthed/capy/blob/<sha>/...` links, and `### PR Readiness Score: 100%` at the end. Bookmark actionable PRs as `PR_<num>.url.json` (`UserFacing: true`).
- **Independent Review & Auto-Merge ([`pr-review-gate.yml`](./.github/workflows/pr-review-gate.yml))**: After `gh pr ready <num>`, an independent read-only Reviewer inspects the PR and submits `gh workflow run pr-review-gate.yml -f pr_number=<num> -f head_sha=<40_CHAR_SHA> -f ai_verdict=APPROVED -f ai_score=100 -f ai_summary="..."`. Never apply `review:owner-approved` or post human approvals on the Owner's behalf.
- **Changelog Fragments**: Drop a single-line (`<= 320` chars, no trailing period) [`.changelog/`](./.changelog/README.md) fragment on `beta` PRs instead of bumping `web/package.json` per PR; batch via `npm run changelog:compile` (or `--promote` on `beta -> main`).
