# Capy Active Sprint Execution Queue (`TODO.md`)

Focused **Sprint 1 Queue** ([EPIC-2](../../issues/477) | [Milestone #2](../../milestone/2)). Holds **only** approved, unblocked `1-PR` slices for the active sprint (`--base beta`). Strategic Epics, unapproved features ([EPIC-3](../../issues/478)), and shipped archives live in [`ROADMAP.md`](./ROADMAP.md); workflow & GitHub CLI rules live in [`PROJECT.md`](./PROJECT.md#2-lean-agile-lifecycle-and-backlog-governance).

**Related Guides**: [`README.md`](./README.md) | [`CONTRIBUTING.md`](./CONTRIBUTING.md) | [`SUPPORT.md`](./SUPPORT.md) | [`SECURITY.md`](./SECURITY.md) | [`PROJECT.md`](./PROJECT.md) | [`ROADMAP.md`](./ROADMAP.md) | [`DEV.md`](./DEV.md) | [`AGENTS.md`](./AGENTS.md) | [`WEB.md`](./WEB.md) | [`PUZZLE.md`](./PUZZLE.md) | [`APP.md`](./APP.md) | [`CLOUD.md`](./CLOUD.md) | [`TESTING.md`](./TESTING.md) | [`CHANGELOG.md`](./CHANGELOG.md)

---

## Sprint 1 Dev Queue (`v3.0.x` Stabilization)

Zero active agent dev tasks remain in `TODO.md`—all Sprint 1 stabilization, onboarding, Play Store prep, Fat-Finger Mode (`US-3.5`, [#602](../../pull/602), [#605](../../pull/605)), anonymous in-game feedback ([#603](../../pull/603)), BYOC Cloud Sync ([#604](../../pull/604)), and completed-region borderless rendering ([#608](../../pull/608)) slices have shipped to `main` (`v3.0.2`--`v3.0.8`; full history in [`CHANGELOG.md`](./CHANGELOG.md) and [`ROADMAP.md`](./ROADMAP.md#6-shipped-epics--stories-epic-1--completed-stories)). `TASK-2.5` (Play Console Keystore/Tag/Upload Ops for `v3.0.8`, Phone & Tablet only with Android TV form factor unchecked until post-launch `US-3.6`) is tracked in [EPIC-3](../../issues/478) in [`ROADMAP.md`](./ROADMAP.md#2-epic-3-touch-assist-sensory-polish-retention-accessibility--replays-awaiting-owner-review--approval); [#561 — Harden Cloudflare](../../issues/561) remains open under [EPIC-2](../../issues/477). Delete [#543 — Production capypaint.com DNS, Cloudflare Worker & /env-setup cutover](../../issues/543) below once remaining Cloudflare dashboard ops complete.

## Release & Human Ops Gates

### [#543 — Production capypaint.com DNS, Cloudflare Worker & /env-setup cutover](../../issues/543)

- **Status**: `In Progress -- Apex, paint.capyboop.com & /api/health LIVE; Awaiting www 301 Edge Redirect & HTTPS Toggle`
- **Live & Target Links**: [capypaint.com](https://capypaint.com/) | [paint.capyboop.com](https://paint.capyboop.com/) | [www.capypaint.com](https://www.capypaint.com/) | [capypaint.com/api/health](https://capypaint.com/api/health) | [capyboop/paint Issues](https://github.com/capyboop/paint/issues) | [Capy Production (GitHub Pages)](https://shthed.github.io/capy/)<!-- capy-dev-only:start --> | [Capy Beta (GitHub Pages)](https://shthed.github.io/capy/beta/)<!-- capy-dev-only:end -->
- **Action**: [capypaint.com](https://capypaint.com/) and [paint.capyboop.com](https://paint.capyboop.com/) (`capy-paint` Worker + `CoopRoomDurableObject`), public [capyboop/paint](https://github.com/capyboop/paint/issues) issue templates/links ([#575](../../pull/575), [#596](../../pull/596)), and automated clean-room mirror sync are live on `main`. Remaining Human Ops: add the [www.capypaint.com](https://www.capypaint.com/) to [capypaint.com](https://capypaint.com/) edge `301` Single Redirect rule and enable **Always Use HTTPS** in [Cloudflare Dashboard](https://dash.cloudflare.com/) ([capyboop.com](https://capyboop.com/) apex deferred out of active Sprint 1 scope per Owner directive).
- **Value**: Completes canonical HTTPS routing on [capypaint.com](https://capypaint.com/) alongside [paint.capyboop.com](https://paint.capyboop.com/).

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Environment & Ops` (supersedes legacy `BUG-4`) | [EPIC-2](../../issues/477) ([Milestone #2](../../milestone/2)) | `priority: critical` | `domain: cloud, ci`
- **Model & Estimate**: `ops` (Human Cloudflare Dashboard Config)
- **Target Files**: `.agents/environment.json`, `.github/ISSUE_TEMPLATE/`, [`wrangler.jsonc`](./wrangler.jsonc), [`worker/index.ts`](./worker/index.ts), [`.github/workflows/deploy-cloudflare.yml`](./.github/workflows/deploy-cloudflare.yml), [`CLOUD.md`](./CLOUD.md)
- **Acceptance Criteria**:
  - [capypaint.com](https://capypaint.com/) serves the live Capy Paint SPA and [www.capypaint.com](https://www.capypaint.com/) `301`-redirects to [capypaint.com](https://capypaint.com/).
  - [capypaint.com/api/health](https://capypaint.com/api/health) returns `{"ok":true,"service":"capy-paint",...}` and `wss://capypaint.com/api/room?room=<ROOM6>` upgrades to `CoopRoomDurableObject`.
  - [capyboop/paint](https://github.com/capyboop/paint/issues) serves as the clean public-facing issue tracker (`Bug Report`, `Feature Request`, `Puzzle Idea` forms + automated clean-room mirror sync).

</details>
