# Capy Active Sprint Execution Queue (`TODO.md`)

Focused **Sprint 1 Queue** ([EPIC-2](https://github.com/shthed/capy/issues/477) | [Milestone #2](https://github.com/shthed/capy/milestone/2)). Holds **only** approved, unblocked `1-PR` slices for the active sprint (`--base beta`). Strategic Epics, unapproved features ([EPIC-3](https://github.com/shthed/capy/issues/478)), and shipped archives live in [`ROADMAP.md`](./ROADMAP.md); workflow & GitHub CLI rules live in [`PROJECT.md`](./PROJECT.md#2-lean-agile-lifecycle-and-backlog-governance).

**Related Guides**: [`README.md`](./README.md) | [`PROJECT.md`](./PROJECT.md) | [`ROADMAP.md`](./ROADMAP.md) | [`DEV.md`](./DEV.md) | [`AGENTS.md`](./AGENTS.md) | [`WEB.md`](./WEB.md) | [`PUZZLE.md`](./PUZZLE.md) | [`APP.md`](./APP.md) | [`CLOUD.md`](./CLOUD.md) | [`TESTING.md`](./TESTING.md) | [`CHANGELOG.md`](./CHANGELOG.md)

---

## Sprint 1 Dev Queue (`v3.0.x` Stabilization)

Zero active agent dev tasks remain in `TODO.md`—`v3.0.19`--`v3.0.20` (`Saves` Q1 Play Store cleanup gating `cloud-coop-hub`/`topbar-coop-btn`/`cloud_coop` behind `isCloudCoopUiEnabled()` + [`docs/play-store/`](./docs/play-store/) graphics/screenshots & `PLAY_STORE_LISTING.md` [#547](https://github.com/shthed/capy/pull/547), Android TV Leanback manifest/banner & ad-free `privacy-policy.html` [#545](https://github.com/shthed/capy/pull/545), and `.agents/environment.json` & cutover tracking [#544](https://github.com/shthed/capy/pull/544), with explicit post-launch deferral of Android TV D-pad `US-3.6` & TV Party `US-4.4`) plus all prior Sprint 1 stabilization and UI slices (`v3.0.2`--`v3.0.18`: [#501](https://github.com/shthed/capy/pull/501), [#517](https://github.com/shthed/capy/pull/517)--[#532](https://github.com/shthed/capy/pull/532), [#538](https://github.com/shthed/capy/pull/538)) are promoted to `main` (`Production`, via [#549](https://github.com/shthed/capy/pull/549)), followed by `v3.0.21`--`v3.0.24` (Preset Style Gallery [#557](https://github.com/shthed/capy/pull/557), Detail/Hue colour defaults [#555](https://github.com/shthed/capy/pull/555), compact replay scrubber [#554](https://github.com/shthed/capy/pull/554), and review-gate merge-async & Draft checklist gate [#553](https://github.com/shthed/capy/pull/553)) via [#556](https://github.com/shthed/capy/pull/556), ready for Human Ops `TASK-2.5` Play Console release upload (uploading Phone & Tablet builds/screenshots only; keep Android TV form factor unchecked until post-launch). Earlier `v3.0.0`--`v3.0.1` Production slices: `BUG-1` & `BUG-3` ([#484](https://github.com/shthed/capy/pull/484), [#485](https://github.com/shthed/capy/pull/485)), `BUG-2` ([#485](https://github.com/shthed/capy/pull/485)), and `BUG-5` mobile `GameTopBar` overlap & `99%` progress cap ([#486](https://github.com/shthed/capy/pull/486), promoted to `main` in [#488](https://github.com/shthed/capy/pull/488)). `TASK-2.5` (Play Console Keystore/Tag/Upload Ops) is tracked in [EPIC-3](https://github.com/shthed/capy/issues/478) in [`ROADMAP.md`](./ROADMAP.md#2-epic-3-touch-assist-sensory-polish-retention-accessibility--replays-awaiting-owner-review--approval). Delete [#543 — Production capypaint.com DNS, Cloudflare Worker & /env-setup cutover](https://github.com/shthed/capy/issues/543) below once shipped to Production.

## Release & Human Ops Gates

### [#543 — Production capypaint.com DNS, Cloudflare Worker & /env-setup cutover](https://github.com/shthed/capy/issues/543)

- **Status**: `Open -- Human Ops Gate (Cloudflare Nameservers Active; Awaiting Dashboard DNS Cleanup & Workers Builds Cutover)`
- **Live & Target Links**: [capypaint.com](https://capypaint.com/) | [www.capypaint.com](https://www.capypaint.com/) | [capypaint.com/api/health](https://capypaint.com/api/health) | [Capy Production (GitHub Pages)](https://shthed.github.io/capy/) | [Capy Beta (GitHub Pages)](https://shthed.github.io/capy/beta/)
- **Action**: Delete the legacy Squarespace `A`/`CNAME` records on `@` and `www` in [Cloudflare Dashboard](https://dash.cloudflare.com/) (nameservers `guy.ns.cloudflare.com` and `maleah.ns.cloudflare.com` are already active, with zero `MX` records), connect [shthed/capy](https://github.com/shthed/capy) (`main`) to Cloudflare Workers Builds per [`CLOUD.md` Section 4](./CLOUD.md#4-step-by-step-developer-guide-deploying-capypaintcom-and-capyboopcom-on-cloudflare-workers), and add the [www.capypaint.com](https://www.capypaint.com/) to [capypaint.com](https://capypaint.com/) edge `301` Redirect Rule.
- **Value**: Replaces the Squarespace placeholder on [capypaint.com](https://capypaint.com/) with the live `v3.0.x` production SPA, `/api/health`, and `CoopRoomDurableObject` WebSocket relay.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Environment & Ops` (supersedes legacy `BUG-4`) | [EPIC-2](https://github.com/shthed/capy/issues/477) ([Milestone #2](https://github.com/shthed/capy/milestone/2)) | `priority: critical` | `domain: cloud, ci`
- **Model & Estimate**: `ops` (Human Cloudflare Dashboard Cutover)
- **Target Files**: `.agents/environment.json`, [`wrangler.jsonc`](./wrangler.jsonc), [`worker/index.ts`](./worker/index.ts), [`.github/workflows/deploy-cloudflare.yml`](./.github/workflows/deploy-cloudflare.yml), [`CLOUD.md`](./CLOUD.md)
- **Acceptance Criteria**:
  - [capypaint.com](https://capypaint.com/) serves the live Capy Paint SPA and [www.capypaint.com](https://www.capypaint.com/) `301`-redirects to [capypaint.com](https://capypaint.com/).
  - [capypaint.com/api/health](https://capypaint.com/api/health) returns `{"ok":true,"service":"capy-paint",...}` and `wss://capypaint.com/api/room?room=<ROOM6>` upgrades to `CoopRoomDurableObject`.

</details>

### Companion Studio Domain: [capyboop.com](https://capyboop.com/) (`CapyGame 3D` Cloudflare Workers & Non-Fork Mirror)

- **Status**: `Open -- Human Ops Gate (Currently serving stale unbuilt v2.5.11 source HTML; awaiting clean-room Cloudflare Workers cutover)`
- **Live & Target Links**: [capyboop.com](https://capyboop.com/) | [www.capyboop.com](https://www.capyboop.com/) | [CapyGame (GitHub Pages)](https://shthed.github.io/capygame/) | [capyboop/capygame](https://github.com/capyboop/capygame) | [shthed/capygame](https://github.com/shthed/capygame)
- **Action**: Connect [CapyGame](https://github.com/shthed/capygame) directly via Cloudflare Workers Builds (`npm run build` -> `./dist/`, retaining `public/_headers` `COOP`/`COEP` headers for `SharedArrayBuffer` in `physics.worker.ts`) and attach [capyboop.com](https://capyboop.com/) / [www.capyboop.com](https://www.capyboop.com/) in **Domains & Routes** (until `capygame` adds declarative `routes` + `workers_dev: false` in its `wrangler.jsonc`), or apply a temporary `301` redirect to [capypaint.com](https://capypaint.com/) / [CapyGame GitHub Pages](https://shthed.github.io/capygame/) per [`CLOUD.md` Section 4](./CLOUD.md#4-step-by-step-developer-guide-deploying-capypaintcom-and-capyboopcom-on-cloudflare-workers), plus a [www.capyboop.com](https://www.capyboop.com/) to [capyboop.com](https://capyboop.com/) edge `301` Single Redirect rule (optional [capyboop/capygame](https://github.com/capyboop/capygame) non-fork recreation is decoupled).
- **Value**: Replaces the stale unbuilt `v2.5.11` `/src/main.tsx` placeholder on [capyboop.com](https://capyboop.com/) with the compiled **CapyGame 3D** production bundle cleanly alongside [capypaint.com](https://capypaint.com/).
