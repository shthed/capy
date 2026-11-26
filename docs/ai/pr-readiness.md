# AI PR Readiness, Bot Workflows & Review Gate (`docs/ai/pr-readiness.md`)

Private specification for AI-authored Pull Requests, Issues, `PR Readiness Score`, `PR Readiness Checklist`, and automated review-gate enforcement. Excluded wholesale from public `capyboop/paint` clean-room exports via [`rebrand-persona.mjs`](../../web/scripts/rebrand-persona.mjs).

**Related Guides**: [`AGENTS.md`](../../AGENTS.md) | [`CAPYBOOP.md`](../../CAPYBOOP.md) | [`workflow-and-models.md`](./workflow-and-models.md) | [`cross-repo-guardrail.md`](./cross-repo-guardrail.md) | [`PROJECT.md`](../../PROJECT.md) | [`DEV.md`](../../DEV.md)

---

## 1. Bot-Authored PRs (`open-pr.yml`) & Issues (`open-issue.yml`)

All AI-performed GitHub actions MUST execute as `github-actions[bot]` via repository workflows rather than running `gh pr create` or `gh pr review` as the human repository owner:

- **Bot-Authored Pull Requests ([`open-pr.yml`](../../.github/workflows/open-pr.yml))**:
  - Open and update PRs via `gh workflow run open-pr.yml -f head=<branch> -f base=beta -f title="..." -f body="..." -f draft=true -f labels="..." -f milestone="..."`.
  - New PRs are created as `draft=true` so running `gh pr ready <num>` emits `pull_request: ready_for_review` and triggers `CI` (`Build & Test`, `Android APK`, `Playwright E2E`, `Deploy Pages`) and `Gate`.
  - **WIP Draft vs. Locally-Verified Ready PRs**:
    - **WIP Draft PRs** (unfinished work staying in Draft) MUST include at least one `- [ ] <item>` checklist entry describing what work remains before marking Ready; resolve and remove all `- [ ]` items before running `gh pr ready <num>`.
    - **Locally-Verified Ready PRs** (all code, docs, and local checks already complete) may pass the finalized `100%` PR body directly on the first `open-pr.yml` dispatch and immediately run `gh pr ready <num>` without a throwaway Draft body.
  - **Version-Agnostic `beta` Titles & Fragments**: Never include `vX.Y.Z` version numbers in regular `beta` PR titles or `.changelog/` fragment filenames (if a release ships before merge, the squash commit history becomes misleading). Reserve version numbers strictly for `changelog:compile` and `beta -> main` Release Promotion PRs.
  - Note: `open-pr.yml` searches `state: 'open'` PRs; to fix a typo or broken link in an already-merged PR body as `github-actions[bot]`, dispatch `open-issue.yml -f issue_number=<num> -f body="..."`.
- **Bot-Authored Issues ([`open-issue.yml`](../../.github/workflows/open-issue.yml))**:
  - Whenever an AI agent finishes a **plan ready for Owner review** (e.g., an implementation plan) or produces a **code/product review or audit document**, log it as a bot-authored GitHub Issue via `gh workflow run open-issue.yml` with a structured summary and checklist.
- **Link Formatting & Creating Session Attribution**:
  - **Always use full `https://github.com/shthed/capy/...` URLs** inside GitHub PR descriptions, Issue bodies, PR/Issue comments, and chat responses (for example, `[README.md](https://github.com/shthed/capy/blob/<40-char-sha>/README.md)` or `[#NNN — PR Title](https://github.com/shthed/capy/pull/NNN)`). Never use `./`, `../`, or `../../pull/NNN` inside GitHub PR/Issue text—GitHub resolves those relative to `/pull/` and returns 404.
  - Include a clickable creating-session web URL `` `[<Role> (<short-id>)](https://antigravity.google.com/remote/<session-id>?project=<project-id>)` `` when the project ID is available in the environment; otherwise note the short session ID with `(session link unavailable locally)` rather than guessing.
  - Both `open-pr.yml` and `open-issue.yml` enforce [`cross-repo-guardrail.md`](./cross-repo-guardrail.md) automatically.

---

## 2. Strict `100%` PR Readiness Score & Checklist Spec

Every AI-managed PR description (and Development Summary comment) must place `### PR Readiness Score: <N>%` at the **end** of the body, wrapping the detailed **PR Readiness Checklist** inside `<details><summary>PR Readiness Checklist</summary>...</details>`:

- **Strict Percentage Scoring (`0%--100%`)**: Score overall readiness strictly as a percentage (`100%` required before merge approval) without fixed-weight fractions.
- **Flexible / Variable Criteria Count**: Include as many or as few scope-relevant criteria lines as the PR requires (no fixed 5-item cap—e.g., 3--4 criteria for docs-only PRs, or 5--9+ criteria for multi-platform Web, Worker, Cloud, Accessibility, Android, or CI changes).
- **`%`-First Line Items**: Put `%` at the start of each checklist bullet (`- **<N>%** — **<Criterion>**: <Verification summary>`), drawing from core checks (**Functionality & Edge Cases**, **Automated Tests**, **Performance & Golden Invariants**, **Docs & Changelog Sync**, **CI, Mergeability & Preview Verification**) plus domain checks (**Accessibility & Mobile Layout**, **Android / Bridge Parity**, **Cloud Sync / Worker Safety**, **CI / Workflow Hygiene**).
- **Blank Lines & Closing Rationale**: Include blank lines immediately after `</summary>` and before `</details>`, followed by a concise closing rationale explaining why the PR is ready (or stating the exact `-N%` gap if `< 100%`, plus a `- [ ]` checklist *only* when `< 100%` for remaining work scoped inside *this* PR).

```markdown
### PR Readiness Score: 100%

<details>
<summary>PR Readiness Checklist</summary>

- **100%** — **Functionality & Edge Cases**: Behavior, persistence, and edge-case fallbacks verified.
- **100%** — **Automated Tests**: `npm run test:sanity && npm run lint && npm run build && npm test` passed locally.
- **100%** — **Performance & Golden Invariants**: Zero per-frame allocations, worker-only segmentation, and relative asset paths preserved.
- **100%** — **Docs & Changelog Sync**: `.changelog/` fragment added (or daily `CHANGELOG.md` compiled with leading relative PR links) and docs synced cleanly.
- **100%** — **CI, Mergeability & Preview Verification**: `MERGEABLE` / `CLEAN` atop target base, CI checks green, clickable Test Results and preview links present.

</details>

All scoped requirements, local tests, CI checks, and docs updates are complete with zero open gaps.
```

---

## 3. Strict `100%` AI Review Gate & Major-UI Hold ([`pr-review-gate.yml`](../../.github/workflows/pr-review-gate.yml))

1. After local verification passes and any Draft `- [ ]` items are resolved, run `gh pr ready <num>` FIRST.
2. An independent read-only Reviewer agent inspects the PR and submits its verdict as `github-actions[bot]` via:
   `gh workflow run pr-review-gate.yml -f pr_number=<num> -f head_sha=<40_CHAR_HEAD_SHA> -f ai_verdict=APPROVED -f ai_score=100 -f ai_summary="..."`
3. `ai-review` verifies `head_sha === pr.head.sha`, enforces the cross-repo reference guardrail on `ai_summary`, posts `<!-- capy-review: actor=ai-agent verdict=APPROVED sha=<40_CHAR_HEAD_SHA> score=100% -->`, and applies `review:ai-approved`.
4. `review-gate` verifies valid `## Summary`, `### PR Readiness Score: 100%`, zero `< 100%` items, zero unchecked `- [ ]` tasks, zero forbidden `capyboop/paint` cross-references in PR title/body, and zero active Owner holds (`CHANGES_REQUESTED`, `HOLD`, `DO NOT MERGE`, `review:changes-requested`).
5. **Major UI Hold (`review:owner-required`)**: PRs introducing major UI changes (layout overhauls, new or reorganized modals, settings, navigation, visual redesigns, or tutorial flows) MUST carry the `review:owner-required` label. When present, `capy/review-gate` holds at `pending` and disables auto-merge until explicit Human Project Owner approval (`APPROVED` review on current HEAD or `review:owner-approved`).
6. All other PRs targeting `beta` or `main` pass `capy/review-gate` and auto-merge automatically once required CI checks are green (`--squash` on standard `beta` PRs; `--merge` on `main` and `sync/beta-from-main`). Never apply `review:owner-approved` or post human `APPROVED`/`LGTM` comments on behalf of the Project Owner unless explicitly instructed.

---

## 4. Closing Reports & Owner Questions

- Always close status reports, handoffs, and review updates with an explicit **Needs Your Testing / Approval** summary listing any clickable PRs (`[#NNN — PR Title](https://github.com/shthed/capy/pull/NNN)`) or preview/Beta links awaiting Project Owner action (noting any holds), or explicitly confirming when nothing needs Owner testing or approval yet.
- Whenever you have a question that needs the Project Owner's answer, repeat the question clearly at the end of your response so it is never missed.
