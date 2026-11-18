# Capy Product Roadmap -- Strategic Epics & Archive (`ROADMAP.md`)

Strategic product horizon for **Capy** ([`web/`](./web/) and [`app/`](./app/)). **Role split**: `ROADMAP.md` owns Epics (`EPIC-*`), User Stories (`US-*`), external blockers, Platform Icebox (`ICE-*`), and shipped archives; **GitHub Issues ([EPIC-1](https://github.com/shthed/capy/issues/476)--[EPIC-5](https://github.com/shthed/capy/issues/480))** hold live `- [x]` / `- [ ]` progress checklists; and [`TODO.md`](./TODO.md) holds the active sprint's `BUG-*` / `TASK-*` execution specs (governance & CLI rules in [`PROJECT.md`](./PROJECT.md#2-lean-agile-lifecycle-and-backlog-governance)).

**Related Guides**: [`README.md`](./README.md) | [`PROJECT.md`](./PROJECT.md) | [`DEV.md`](./DEV.md) | [`AGENTS.md`](./AGENTS.md) | [`TODO.md`](./TODO.md) | [`WEB.md`](./WEB.md) | [`PUZZLE.md`](./PUZZLE.md) | [`APP.md`](./APP.md) | [`CLOUD.md`](./CLOUD.md) | [`TESTING.md`](./TESTING.md) | [`CHANGELOG.md`](./CHANGELOG.md)

**Table of Contents**:
1. [`EPIC-2`: `v3.0.x` Critical Bugfixes & Stabilization (`Active in Sprint 1`)](#1-epic-2-v30x-critical-bugfixes--stabilization-active-in-sprint-1)
2. [`EPIC-3`: Touch Assist, Sensory Polish, Retention, Accessibility & Replays (`Awaiting Owner Review & Approval`)](#2-epic-3-touch-assist-sensory-polish-retention-accessibility--replays-awaiting-owner-review--approval)
3. [`EPIC-4`: Serverless Infinite Zoom, Printable Art & Local Co-op Polish (`Ready After EPIC-3`)](#3-epic-4-serverless-infinite-zoom-printable-art--local-co-op-polish-ready-after-epic-3)
4. [`EPIC-5`: Production Cloud Auth, Cross-Network Co-op & Optional AI Creation (`Blocked on External Infra`)](#4-epic-5-production-cloud-auth-cross-network-co-op--optional-ai-creation-blocked-on-external-infra)
5. [Unscheduled Platform Icebox (`ICE-1`--`ICE-3`)](#5-unscheduled-platform-icebox-ice-1--ice-3)
6. [Shipped Epics & Stories (`EPIC-1` & Completed Stories)](#6-shipped-epics--stories-epic-1--completed-stories)

<details>
<summary>Roadmap Rollup (`18` Stories + `TASK-2.5` & Active `v3.0.x` Queue across `4` Epics)</summary>

- [EPIC-2](https://github.com/shthed/capy/issues/477) (*`v3.0.x` Stabilization & Live Cutover -- [Sprint 1 (`#2`)](https://github.com/shthed/capy/milestone/2)*): [#543 — Production capypaint.com DNS, Cloudflare Worker & /env-setup cutover](https://github.com/shthed/capy/issues/543) (`ops` Human Cloudflare & DNS Cutover in [`TODO.md`](./TODO.md)) and [#561 — Harden Cloudflare](https://github.com/shthed/capy/issues/561) (`ops` / security hardening under [EPIC-2](https://github.com/shthed/capy/issues/477)); `v3.0.19`--`v3.0.20` (Android TV Leanback manifest/banner + ad-free privacy policy [#545](https://github.com/shthed/capy/pull/545), `.agents/environment.json` & cutover tracking [#544](https://github.com/shthed/capy/pull/544), and `v3.0.20` Google Play Store launch prep [#547](https://github.com/shthed/capy/pull/547)) promoted to `main` via [#549](https://github.com/shthed/capy/pull/549), `v3.0.21`--`v3.0.24` (stacked merge-async review-gate fallback & Draft checklist gate [#553](https://github.com/shthed/capy/pull/553), compact replay scrubber [#554](https://github.com/shthed/capy/pull/554), Detail/Hue colour defaults [#555](https://github.com/shthed/capy/pull/555), and Preset Style Gallery [#557](https://github.com/shthed/capy/pull/557)) promoted via [#556](https://github.com/shthed/capy/pull/556), `v3.0.25`--`v3.0.29` (Cloudflare Workers deploy [#550](https://github.com/shthed/capy/pull/550) and direct blocked-PR merge fallback [#560](https://github.com/shthed/capy/pull/560) promoted via [#562](https://github.com/shthed/capy/pull/562); E2E/unit log standardization [#563](https://github.com/shthed/capy/pull/563), pre-generated Max sample/daily archives [#565](https://github.com/shthed/capy/pull/565), `lintVitalRelease` Android Fragment fix [#566](https://github.com/shthed/capy/pull/566), and changelog retag [#568](https://github.com/shthed/capy/pull/568) promoted via [#567](https://github.com/shthed/capy/pull/567)) promoted to `main`, and `v3.0.30`--`v3.0.35` (Play Daily E2E fix [#569](https://github.com/shthed/capy/pull/569), Max-detail puzzle refreshes [#570](https://github.com/shthed/capy/pull/570), [#572](https://github.com/shthed/capy/pull/572), `v3.0.31` Play Store remediation [#571](https://github.com/shthed/capy/pull/571), `O(R log R)` `maxRegions <= 2000` cap & Network-First SW caching [#573](https://github.com/shthed/capy/pull/573), public [capyboop/capy](https://github.com/capyboop/capy/issues) tracker links [#575](https://github.com/shthed/capy/pull/575), clean-room export & Co-op origin hardening [#576](https://github.com/shthed/capy/pull/576), `StorageService.ts` backup recency & empty-overwrite durability [#577](https://github.com/shthed/capy/pull/577), and `v3.0.35` release prep & `(Production, Beta)` changelog retag [#578](https://github.com/shthed/capy/pull/578)) staged on `beta` for [#574](https://github.com/shthed/capy/pull/574) alongside `v3.0.2`--`v3.0.18` (`v3.0.2`--`v3.0.8` via [#501](https://github.com/shthed/capy/pull/501); `v3.0.9`--`v3.0.13` via [#517](https://github.com/shthed/capy/pull/517)--[#532](https://github.com/shthed/capy/pull/532); `v3.0.14`--`v3.0.18` via [#538](https://github.com/shthed/capy/pull/538))
- [EPIC-3](https://github.com/shthed/capy/issues/478) (*9 Stories + `TASK-2.5` -- [Sprint 2 (`#3`)](https://github.com/shthed/capy/milestone/3), Awaiting Owner Review*): `~314k tokens` (`~149--214 min agent`)
- [EPIC-4](https://github.com/shthed/capy/issues/479) (*4 Stories -- [Sprint 3 (`#4`)](https://github.com/shthed/capy/milestone/4), Ready After [EPIC-3](https://github.com/shthed/capy/issues/478)*): `~113k tokens` (`~52--76 min agent`)
- [EPIC-5](https://github.com/shthed/capy/issues/480) (*5 Stories -- Blocked on External Infra*): `~245k tokens` (`~113--165 min agent`)
- **Total Strategic Horizon**: `~672k tokens` (`~5.2--7.6 hrs agent` | `~89--129 hrs human`; agent totals exclude [#543 — Production capypaint.com DNS, Cloudflare Worker & /env-setup cutover](https://github.com/shthed/capy/issues/543) `ops`)

</details>

---

## 1. `EPIC-2`: `v3.0.x` Critical Bugfixes & Stabilization (`Active in Sprint 1`)

**Epic Goal**: Stabilize `v3.0.x` with critical reliability fixes, explicitly Owner-approved UX polish, and [capypaint.com](https://capypaint.com/) live cutover plus [capyboop/capy](https://github.com/capyboop/capy/issues) public issue tracker setup ([#543 — Production capypaint.com DNS, Cloudflare Worker & /env-setup cutover](https://github.com/shthed/capy/issues/543)). Unapproved feature stories (`US-2.1`, `US-2.3b`, `US-2.4`) and Play Store release ops (`TASK-2.5`) live in [EPIC-3](https://github.com/shthed/capy/issues/478); [capyboop.com](https://capyboop.com/) cutover is explicitly deferred out of active Sprint 1 scope. *(Tracking: [EPIC-2](https://github.com/shthed/capy/issues/477) | [Sprint 1 (`#2`)](https://github.com/shthed/capy/milestone/2)).*

- **Active Execution Queue**: See [`TODO.md`](./TODO.md) for [#543 — Production capypaint.com DNS, Cloudflare Worker & /env-setup cutover](https://github.com/shthed/capy/issues/543) ([capypaint.com](https://capypaint.com/) apex is live; remaining Human Ops cover `www` `301` edge redirect and HTTPS enforcement; live Pages channel at [Capy Production](https://shthed.github.io/capy/)) while [#561 — Harden Cloudflare](https://github.com/shthed/capy/issues/561) remains open under [EPIC-2](https://github.com/shthed/capy/issues/477). `v3.0.2`--`v3.0.29` stabilization, Play Store launch prep, Preset Style Gallery, Detail/Hue colour defaults, compact replay scrubber, `.agents/environment.json`, Leanback manifest/banner, ad-free privacy policy, Cloudflare Worker deployment, pre-generated Max sample/daily archives, and `lintVitalRelease` Android Fragment fix (`v3.0.14`--`v3.0.18` via [#538](https://github.com/shthed/capy/pull/538); `v3.0.19`--`v3.0.20` via [#549](https://github.com/shthed/capy/pull/549); `v3.0.21`--`v3.0.24` via [#556](https://github.com/shthed/capy/pull/556); `v3.0.25`--`v3.0.26` via [#562](https://github.com/shthed/capy/pull/562); `v3.0.27`--`v3.0.29` via [#567](https://github.com/shthed/capy/pull/567)) are promoted to `main` (`beta -> main`), while `v3.0.30`--`v3.0.35` ([#569](https://github.com/shthed/capy/pull/569)--[#573](https://github.com/shthed/capy/pull/573), [#575](https://github.com/shthed/capy/pull/575)--[#578](https://github.com/shthed/capy/pull/578)) are staged on `beta` for [#574](https://github.com/shthed/capy/pull/574); zero active agent dev tasks remain in `TODO.md`.
<!-- capy-dev-only:start -->
  - **Beta Channel & Mirror Sync Ops**: Live Beta Pages channel at [Capy Beta](https://shthed.github.io/capy/beta/); configure `CAPYBOOP_SYNC_TOKEN` on `shthed/capy` for automated clean-room [capyboop/capy](https://github.com/capyboop/capy/issues) export via [`.github/workflows/publish-capyboop.yml`](./.github/workflows/publish-capyboop.yml).
<!-- capy-dev-only:end -->
- **Shipped & Re-Scoped History**:
  - **Staged on `beta` for `main` promotion (`v3.0.30`--`v3.0.35` via [#574](https://github.com/shthed/capy/pull/574))**: `v3.0.35` release prep, Play Store guide & `(Production, Beta)` changelog retag ([#578](https://github.com/shthed/capy/pull/578)); `StorageService.ts` backup recency & empty-overwrite durability + `[Unit 15]` tests ([#577](https://github.com/shthed/capy/pull/577)); clean-room export, release workflow signing guard & dual-origin Co-op hardening ([#576](https://github.com/shthed/capy/pull/576)); public [capyboop/capy](https://github.com/capyboop/capy/issues) issue templates, About **Report Bug / Ideas** button & privacy policy links ([#575](https://github.com/shthed/capy/pull/575)); `O(R log R)` `maxRegions <= 2000` cap, Network-First `.capy` SW caching (`SW_ASSETS_DIGEST`) & Create tab hints ([#573](https://github.com/shthed/capy/pull/573)); `v3.0.31` Google Play Store remediation removing Android ad hooks, fake idea votes & startup Play Games sign-in leaks ([#571](https://github.com/shthed/capy/pull/571)); automated Max-detail sample/daily puzzle refreshes ([#570](https://github.com/shthed/capy/pull/570), [#572](https://github.com/shthed/capy/pull/572)); and `[E2E 12]` Play Daily snapshot race fix ([#569](https://github.com/shthed/capy/pull/569)).
  - **Promoted to `main` (`v3.0.27`--`v3.0.29` via [#567](https://github.com/shthed/capy/pull/567))**: `v3.0.29` release notes retag ([#568](https://github.com/shthed/capy/pull/568)); `androidx.fragment:fragment-ktx` `1.8.9` pin fixing signed Android `lintVitalRelease` ([#566](https://github.com/shthed/capy/pull/566)); pre-generated `2048p` Max-settings `sample_saves.capy` & `daily_saves.capy` + scheduled `regenerate-puzzles.yml` ([#565](https://github.com/shthed/capy/pull/565)); and standardized sequential `[Unit]`/`[E2E]` test logging & isolated subprocess checks ([#563](https://github.com/shthed/capy/pull/563)).
  - **Promoted to `main` (`v3.0.25`--`v3.0.26` via [#562](https://github.com/shthed/capy/pull/562))**: direct merge fallback when `blocked` `100%` AI-approved PRs pass head `Build & Test` ([#560](https://github.com/shthed/capy/pull/560)) and direct Cloudflare Workers deploy + `_redirects` cleanup ([#550](https://github.com/shthed/capy/pull/550)).
  - **Promoted to `main` (`v3.0.21`--`v3.0.24` via [#556](https://github.com/shthed/capy/pull/556))**: visual Preset Style Gallery & Puzzle Styles tutorial step ([#557](https://github.com/shthed/capy/pull/557)); Original Detail colour mode and Rainbow / Hue sort defaults ([#555](https://github.com/shthed/capy/pull/555)); compact single-row replay scrubber ([#554](https://github.com/shthed/capy/pull/554)); stacked-PR merge-async fallback and mandatory Draft outstanding-work checklist gate ([#553](https://github.com/shthed/capy/pull/553)).
  - **Promoted to `main` (`v3.0.19`--`v3.0.20` via [#549](https://github.com/shthed/capy/pull/549))**: Google Play Store launch prep gating unfinished Cloud/Co-op hub UI (`cloud-coop-hub`, `topbar-coop-btn`, and `cloud_coop` tutorial step/offer) behind opt-in `isCloudCoopUiEnabled()` while preserving clean `saves-share-print-bar` (`Share Progress Link` + `Printable SVG`) plus `512x512` icon, `1024x500` feature graphic, Phone/Tablet screenshots, and [`PLAY_STORE_LISTING.md`](./docs/play-store/PLAY_STORE_LISTING.md) ([#547](https://github.com/shthed/capy/pull/547)); repo-scoped `.agents/environment.json` environment setup & cutover issue tracking ([#544](https://github.com/shthed/capy/pull/544)); Android TV Leanback manifest declarations (`LEANBACK_LAUNCHER`, `touchscreen`/`leanback` `required="false"`), `320x180` `drawable-xhdpi/tv_banner.png`, `privacy-policy.html` 100% ad-free alignment, `AndroidTvManifestAndBridgeTest.kt` + Node TV static checks, and CI review-gate `gemini-3.8-flash`/`gemini-4-argon`/`ACTIONS_GITHUB_TOKEN`/`synchronize` unit tests ([#545](https://github.com/shthed/capy/pull/545)).
  - **Promoted to `main` (`v3.0.14`--`v3.0.18` via [#538](https://github.com/shthed/capy/pull/538))**: Fail-closed non-string PR body guard, human PR body edit review re-evaluation & auto-merge disarming, Pages `include-hidden-files: true` (`.well-known/assetlinks.json`), clean-room mirror `GIT_ASKPASS`/`ls-remote`/`SIGPIPE`/tag-reset hardening, and expanded workflow unit tests ([#534](https://github.com/shthed/capy/pull/534)); web storage durability (`preview_${id}` IndexedDB offload, `flushPendingBackups`, `QuotaExceededError` toast), `PuzzleCanvas` hot-path/throttling optimization, `App.tsx` O(1) lookup, and Co-op Worker SQLite checkpointing ([#535](https://github.com/shthed/capy/pull/535)); Android API 36 edge-to-edge/IME insets, WebView URL allowlisting, `cacheDir/shared/` 24h cleanup, release signing fail-closed guards, and Play Games cold-start buffering ([#537](https://github.com/shthed/capy/pull/537)); deterministic Playwright DOM/canvas/IndexedDB/hash-wait E2E hardening ([#539](https://github.com/shthed/capy/pull/539)); and viewport-save reload race fix ([#540](https://github.com/shthed/capy/pull/540)).
  - **Shipped to `main` (`Production`)**: `BUG-1` & `BUG-3` ([#484](https://github.com/shthed/capy/pull/484), [#485](https://github.com/shthed/capy/pull/485)), `BUG-2` ([#485](https://github.com/shthed/capy/pull/485)), and `BUG-5` mobile `GameTopBar` overlap & `99%` progress cap ([#486](https://github.com/shthed/capy/pull/486), promoted to `main` in [#488](https://github.com/shthed/capy/pull/488)).
  - **Promoted to `main` (`v3.0.2`--`v3.0.13`, `v3.0.2`--`v3.0.8` via [#501](https://github.com/shthed/capy/pull/501); `v3.0.9`--`v3.0.11` via [#526](https://github.com/shthed/capy/pull/526); `v3.0.12`--`v3.0.13` via [#532](https://github.com/shthed/capy/pull/532))**: Prebaked sample `1x` viewport reset & 1-click bot PR approval workflow ([#490](https://github.com/shthed/capy/pull/490)), prior `TASK-2.5` Play Store backlog sync ([#487](https://github.com/shthed/capy/pull/487), later moved to [EPIC-3](https://github.com/shthed/capy/issues/478)), CI/CD & governance hardening ([#491](https://github.com/shthed/capy/pull/491), [#492](https://github.com/shthed/capy/pull/492), [#493](https://github.com/shthed/capy/pull/493), [#494](https://github.com/shthed/capy/pull/494)), `TASK-2.6` post-load replay controls, `Capy Forest` default, interactive first-run tutorial & `About` tab ([#489](https://github.com/shthed/capy/pull/489)), `v3.0.7` storage sandbox isolation, fractional DPR & settings/import/Play Games fixes + `.changelog/` compiler & Epic tracker sync ([#495](https://github.com/shthed/capy/pull/495)), cross-chat `WHITEBOARD.md` coordination rule ([#496](https://github.com/shthed/capy/pull/496)), `v3.0.8` zoom pill badge removal & 360px `SettingsModal` tab clipping fix ([#497](https://github.com/shthed/capy/pull/497)), backlog/roadmap & `%`-first PR readiness governance ([#502](https://github.com/shthed/capy/pull/502), [#509](https://github.com/shthed/capy/pull/509)), `main -> beta` `AGENTS.md` syncs ([#499](https://github.com/shthed/capy/pull/499), [#500](https://github.com/shthed/capy/pull/500), [#504](https://github.com/shthed/capy/pull/504), [#505](https://github.com/shthed/capy/pull/505), [#507](https://github.com/shthed/capy/pull/507), [#508](https://github.com/shthed/capy/pull/508)), `v3.0.9` `PaletteDock` replay visibility & `Saves` tab `Thumbnails` list-first layout ([#517](https://github.com/shthed/capy/pull/517)), `v3.0.10` Low-Vision Large Text mode, sorted/centered `PaletteDock` & default Undo ([#518](https://github.com/shthed/capy/pull/518)), `v3.0.11` 14-step `OnboardingTutorial`, 9 `FeatureOfferBanner` quick tips & 100% PR/review gates ([#519](https://github.com/shthed/capy/pull/519)), `100%` PR readiness & `beta` syncs ([#520](https://github.com/shthed/capy/pull/520), [#522](https://github.com/shthed/capy/pull/522), [#524](https://github.com/shthed/capy/pull/524), [#526](https://github.com/shthed/capy/pull/526)), CapyBoop handbook ([#521](https://github.com/shthed/capy/pull/521)), `v3.0.12` tutorial target spotlight ring, replay auto-dismissal & mobile badge polish ([#523](https://github.com/shthed/capy/pull/523)), and `v3.0.13` viewport-save progress preservation, async Android/E2E/Pages CI speedup & strict `100%` AI auto-merge ([#528](https://github.com/shthed/capy/pull/528), [#530](https://github.com/shthed/capy/pull/530), [#531](https://github.com/shthed/capy/pull/531), [#532](https://github.com/shthed/capy/pull/532)).
  - **Moved to [EPIC-3](https://github.com/shthed/capy/issues/478)**: Shipped pre-re-scope touch/audio slices `US-2.2` & `TASK-2.3a` ([#472](https://github.com/shthed/capy/pull/472), archived under [EPIC-3](https://github.com/shthed/capy/issues/478) in [Section 6](#6-shipped-epics--stories-epic-1--completed-stories)), unapproved feature stories `US-2.1`, `US-2.3b`, and `US-2.4`, and deferred Android Play deployment `TASK-2.5` ([Section 2](#2-epic-3-touch-assist-sensory-polish-retention-accessibility--replays-awaiting-owner-review--approval)).

---

## 2. `EPIC-3`: Touch Assist, Sensory Polish, Retention, Accessibility & Replays (`Awaiting Owner Review & Approval`)

**Epic Goal**: Forgive near-miss mobile taps, deliver owner-approved tactile/audio/loupe polish, build daily return habits, ensure colorblind accessibility, and enable shareable video replays—`100%` client-side with zero backend. *(GitHub Tracking Issue: [EPIC-3](https://github.com/shthed/capy/issues/478) | Milestone: [Sprint 2](https://github.com/shthed/capy/milestone/3) | All unshipped feature stories below await explicit Owner review and approval before entering [`TODO.md`](./TODO.md)).*

### US-3.1: Daily Featured Puzzle Streak & Completion Medals

- **Readiness**: `Awaiting Owner Review & Approval` *(base UTC `DailyPuzzleService.ts` & **Create** hero card `TASK-3.1a` shipped in [#474](https://github.com/shthed/capy/pull/474))*
- **Description**: Persist daily completion history (`capy_daily_streak_v1`), consecutive-day streak counter, and Relaxed vs. Zero-Hint completion medals on top of `DailyPuzzleService.ts`.
- **Value**: Turns one-off daily puzzle launches into a rewarding consecutive-day coloring habit completely offline.
- **Why Now**: `DailyPuzzleService.ts` ([#474](https://github.com/shthed/capy/pull/474)) already rotates featured artworks deterministically by UTC date; adding streak persistence completes the retention loop once approved.
- **Planned Sprint Slices**:
  - **TASK-3.1b**: Persist daily completion history (`capy_daily_streak_v1`), consecutive-day streak counter, and Relaxed vs. Zero-Hint medal badges.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | [EPIC-3](https://github.com/shthed/capy/issues/478) | `priority: high` | `domain: ui`
- **Complexity & Model**: `medium` / `moderate` | **Recommended Model**: `Gemini 4 Argon`
- **Effort Estimate**: `~20,000 tokens` | `~9--13 min agent` (`~2.5--3.5 hrs human`)
- **Target Files**: [`web/src/services/DailyPuzzleService.ts`](./web/src/services/DailyPuzzleService.ts), [`web/src/components/SettingsModal.tsx`](./web/src/components/SettingsModal.tsx), [`web/src/App.tsx`](./web/src/App.tsx), [`web/src/types/index.ts`](./web/src/types/index.ts), [`WEB.md`](./WEB.md)
- **Acceptance Criteria**:
  - Consecutive UTC-day completions increment streak accurately while preserving Relaxed vs. Zero-Hint medal badges offline, covered by Playwright E2E assertions.

</details>

### US-3.2: Inclusive Accessibility -- Colorblind Geometric Region Patterns

- **Readiness**: `Awaiting Owner Review & Approval` *(base `reducedMotion` `TASK-3.2a` & desktop keyboard shortcuts `TASK-3.2b` shipped in [#474](https://github.com/shthed/capy/pull/474))*
- **Description**: Add geometric `CanvasPattern` hatch overlays (`colorblindPatternMode`) for active and hinted regions alongside existing `reducedMotion` and desktop keyboard gameplay shortcuts.
- **Value**: Ensures players with deuteranopia, protanopia, or tritanopia can distinguish similar palette shades comfortably without relying solely on hue contrast.
- **Why Now**: `reducedMotion` and desktop keyboard shortcuts (`1`--`9`, `+`/`-`, `0`, Arrow/WASD) are live ([#474](https://github.com/shthed/capy/pull/474)); adding cached `CanvasPattern` textures finishes full visual accessibility once approved.
- **Planned Sprint Slices**:
  - **TASK-3.2c**: Add `colorblindPatternMode: boolean` rendering cached `CanvasPattern` geometric textures (dots, stripes, crosshatch, checkerboard) over active and hinted regions.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | [EPIC-3](https://github.com/shthed/capy/issues/478) | `priority: high` | `domain: a11y, canvas, ui`
- **Complexity & Model**: `high` / `hard` | **Recommended Model**: `Gemini 4 Argon`
- **Effort Estimate**: `~17,000 tokens` | `~8--12 min agent` (`~2--3 hrs human`)
- **Target Files**: [`web/src/components/PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx), [`web/src/components/SettingsModal.tsx`](./web/src/components/SettingsModal.tsx), [`web/src/types/index.ts`](./web/src/types/index.ts), [`WEB.md`](./WEB.md)
- **Acceptance Criteria**:
  - `CanvasPattern` tiles are generated once at setup/theme change—zero per-frame pattern creation inside `requestAnimationFrame`.

</details>

### US-3.3: Shareable Timelapse Replay Video (`.mp4` / `.webm`) Export

- **Readiness**: `Awaiting Owner Review & Approval`
- **Description**: Add an "Export Timelapse Video" button in `ReplayControls.tsx` recording the puzzle's chronological fill animation via `HTMLCanvasElement.captureStream(60)` + `MediaRecorder` and sharing via `NativeBridge.exportOrShareFile`.
- **Value**: Turns Capy's YouTube-style replay scrubber into a one-tap shareable timelapse video for friends and social feeds, driving organic word-of-mouth discovery.
- **Why Now**: Chronological `replaySequence` playback and `NativeBridge.exportOrShareFile` binary sharing already exist; adding `MediaRecorder` export unlocks sharing with zero server encoding cost once approved.
- **Planned Sprint Slices**:
  - **TASK-3.3a**: Build `web/src/services/ReplayVideoExporter.ts` (`MediaRecorder` `video/mp4` / `video/webm` fallback + progress bar + clean cancellation) rendering locked-frame timelapse playback.
  - **TASK-3.3b**: Wire an Export Video button in `ReplayControls.tsx` and completion banner to `NativeBridge.exportOrShareFile` with feature-detection fallback.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | [EPIC-3](https://github.com/shthed/capy/issues/478) | `priority: high` | `domain: export, canvas`
- **Complexity & Model**: `high` / `hard` | **Recommended Model**: `Gemini 4 Argon`
- **Effort Estimate**: `~45,000 tokens` | `~22--30 min agent` (`~6--9 hrs human`)
- **Target Files**: `web/src/services/ReplayVideoExporter.ts`, [`web/src/components/ReplayControls.tsx`](./web/src/components/ReplayControls.tsx), [`web/src/components/PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx), [`web/src/services/NativeBridge.ts`](./web/src/services/NativeBridge.ts), [`WEB.md`](./WEB.md)
- **Acceptance Criteria**:
  - Prefers `video/mp4;codecs=avc1` where supported with automatic `video/webm;codecs=vp9` fallback, releasing all `MediaStreamTrack` handles on finish or cancel.

</details>

### US-3.4: Milestone Achievement Toasts & CRDT Lifetime Stats Sync

- **Readiness**: `Awaiting Owner Review & Approval` *(local `PlayerStatsService.ts` & Settings **Lifetime Stats** card `TASK-3.4a` shipped in [#474](https://github.com/shthed/capy/pull/474))*
- **Description**: Layer non-blocking milestone achievement unlock toasts, monotonic CRDT cloud stat sync, and optional Play Games hooks onto `PlayerStatsService.ts` (`capy_player_stats_v1`).
- **Value**: Rewards long-term mastery across Easy, Hard, Free Colour, and Co-op modes and keeps lifetime totals synced monotonically across devices.
- **Why Now**: Local `PlayerStatsService.ts` (`mergeLifetimeStats`) and the Settings **Lifetime Stats** card are live ([#474](https://github.com/shthed/capy/pull/474)); wiring milestone unlock toasts and cloud/Play Games bridges completes cross-device progression once approved.
- **Planned Sprint Slices**:
  - **TASK-3.4b**: Add milestone achievement unlock toasts, monotonic CRDT stat merging in `ProviderRegistry.ts` / `CloudProviderDrivers.ts`, and defensive no-op `NativeBridge.unlockAchievement` hooks.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | [EPIC-3](https://github.com/shthed/capy/issues/478) | `priority: high` | `domain: ui, cloud, android`
- **Complexity & Model**: `high` / `moderate` | **Recommended Model**: `Gemini 4 Argon`
- **Effort Estimate**: `~32,000 tokens` | `~14--20 min agent` (`~4--6 hrs human`)
- **Target Files**: [`web/src/services/PlayerStatsService.ts`](./web/src/services/PlayerStatsService.ts), [`web/src/components/SettingsModal.tsx`](./web/src/components/SettingsModal.tsx), [`web/src/services/providers/ProviderRegistry.ts`](./web/src/services/providers/ProviderRegistry.ts), [`web/src/services/providers/CloudProviderDrivers.ts`](./web/src/services/providers/CloudProviderDrivers.ts), [`web/src/services/NativeBridge.ts`](./web/src/services/NativeBridge.ts), [`WEB.md`](./WEB.md)
- **Acceptance Criteria**:
  - Stat counters merge monotonically (`Math.max` / set-count union) across devices so syncing an older offline tab never decrements lifetime totals.

</details>

### US-3.5: Fat-Finger Mode (Near-Miss Tap Assist) & Finger Reach Radius

- **Readiness**: `Awaiting Owner Review & Approval`
- **Description**: Add an independent **Fat-Finger Tap Assist** toggle (`fatFingerAssist`, enabled by default in `EASY` difficulty and optional in `NORMAL` / Precise difficulty) paired with a configurable **Finger Size / Touch Reach Radius** setting (`touchReachRadiusPx`, `8px`--`40px` screen CSS pixels with `Compact 12px` / `Standard 22px` / `Large 34px` presets) that snaps near-miss mobile taps onto intended tiny micro-regions without requiring pixel-perfect landing.
- **Value**: Eliminates frustrating dead taps when a fingertip lands `2`--`8px` off a `< 50px` micro-region onto a `borderMap` pixel (`rId <= 0`), an already-filled neighbor, or an adjacent wrong-color region—complementing the planned Precision Loupe (`US-2.1`) for quick one-handed single-tap play.
- **Why Now**: Currently `PuzzleCanvas.tsx` (`puzzle.regionMap[ly * puzzle.width + lx]` single-tap hit-test) checks only the exact `1x1` pixel under the pointer; adding screen-space radial tolerance makes Easy and mobile play dramatically more forgiving once approved.
- **Planned Sprint Slices**:
  - **TASK-3.5a**: Implement zero-allocation radial near-tap hit-testing (`resolveNearTapRegionId` in `PuzzleCanvas.tsx`) scaling `touchReachRadiusPx / totalScreenScale` dynamically across zoom levels, prioritizing the nearest unfilled `activeColorId` region first and falling back in `EASY` mode to the nearest unfilled region of any color when exact `(lx, ly)` hits a filled neighbor or border.
  - **TASK-3.5b** `[quick-win]`: Add `fatFingerAssist: boolean` and `touchReachRadiusPx: number` (`Compact 12px` / `Standard 22px` / `Large 34px` presets + `8px`--`40px` slider) under `Difficulty (Tap Forgiveness)` in `SettingsModal.tsx` with Playwright E2E near-miss micro-region tap tests.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | [EPIC-3](https://github.com/shthed/capy/issues/478) | `priority: high` | `domain: canvas, gestures, ui`
- **Complexity & Model**: `medium` / `moderate` | **Recommended Model**: `Gemini 4 Argon` (`3.5a`), `Gemini 3.8 Flash` (`3.5b`)
- **Effort Estimate**: `~38,000 tokens` (`~22k` + `~16k`) | `~18--25 min agent` (`~5--7 hrs human`)
- **Target Files**: [`web/src/components/PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx), [`web/src/components/SettingsModal.tsx`](./web/src/components/SettingsModal.tsx), [`web/src/services/StorageService.ts`](./web/src/services/StorageService.ts), [`web/src/types/index.ts`](./web/src/types/index.ts), [`web/scripts/test.mjs`](./web/scripts/test.mjs), [`WEB.md`](./WEB.md)
- **Acceptance Criteria**:
  - Direct hits on playable unfilled regions remain `O(1)`; radial fallback scans integer offsets inside `Math.min(64, touchReachRadiusPx / totalScreenScale)` using scalar distance registers with zero heap allocations.
  - In `NORMAL` difficulty with `fatFingerAssist: true`, near-miss taps snap strictly to unfilled `activeColorId` regions; in `EASY` difficulty, near-miss taps on filled/border pixels prefer `activeColorId` first and otherwise snap to the closest unfilled micro-region of any color.

</details>

### US-2.1: Floating Precision Loupe Magnifier for Micro-Regions *(Moved from [EPIC-2](https://github.com/shthed/capy/issues/477))*

- **Readiness**: `Awaiting Owner Review & Approval`
- **Description**: Render an optional floating circular `2.5x` magnifier cutout with center crosshair (`showMagnifierLoupe`) offset `72px` above the active finger during press-and-hold or Paint Mode drags on [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx), flipping cleanly below near top HUD edges.
- **Value**: Eliminates mobile thumb occlusion on tiny `< 50px` micro-regions without forcing repeated manual zooming to `12x` and back out.
- **Why Pushed to [EPIC-3](https://github.com/shthed/capy/issues/478)**: Held out of `v3.0.1` (bugfixes only) so the Project Owner can review visual cutout styling, crosshair ergonomics, horizontal edge clamping, and hold-vs-pan gesture thresholds prior to implementation.
- **Planned Sprint Slices**:
  - **TASK-2.1a**: Render a zero-allocation `2.5x` magnified `baseCanvasRef` cutout + crosshair lens in `PuzzleCanvas.tsx`.
  - **TASK-2.1b** `[quick-win]`: Add `showMagnifierLoupe: boolean` setting toggle in `SettingsModal.tsx` Controls and Playwright E2E touch-hold verification.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | [EPIC-3](https://github.com/shthed/capy/issues/478) | `priority: medium` | `domain: canvas, gestures, ui`
- **Complexity & Model**: `high` / `hard` | **Recommended Model**: `Gemini 4 Carbon` (`/plan`) + `Gemini 4 Argon` (`2.1b`)
- **Effort Estimate**: `~40,000 tokens` | `~18--26 min agent` (`~5--7 hrs human`)
- **Target Files**: [`web/src/components/PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx), [`web/src/components/SettingsModal.tsx`](./web/src/components/SettingsModal.tsx), [`web/src/services/StorageService.ts`](./web/src/services/StorageService.ts), [`web/src/types/index.ts`](./web/src/types/index.ts), [`WEB.md`](./WEB.md)
- **Acceptance Criteria**:
  - Reuses existing offscreen `baseCanvasRef` (plus `highlightCanvasRef` / `borderCanvasRef`) via `ctx.drawImage` circular clip with zero per-frame `OffscreenCanvas` or heap allocations inside `requestAnimationFrame`, scaling cleanly for `devicePixelRatio`.
  - Repositions below the finger within `96px` of the top viewport edge, clamps horizontally (`>= loupeRadius + 12px` from left/right edges), and activates via hold threshold or Paint Mode drag without conflicting with pan or double-tap-drag zoom.

</details>

### US-2.3: Zero-Asset Procedural ASMR Web Audio Engine -- Melodic Layer *(Moved from [EPIC-2](https://github.com/shthed/capy/issues/477))*

- **Readiness**: `Awaiting Owner Review & Approval` *(base woodblock tap synth `TASK-2.3a` shipped in [#472](https://github.com/shthed/capy/pull/472))*
- **Description**: Extend [`SoundService.ts`](./web/src/services/SoundService.ts) with rising pentatonic Paint Mode streak notes, warm swatch-completion chord arpeggios, and `100%` puzzle-completion chimes.
- **Value**: Adds zero-KB offline harmonic reward to continuous painting and color completions while pairing cleanly with LRA haptics.
- **Why Pushed to [EPIC-3](https://github.com/shthed/capy/issues/478)**: Held out of `v3.0.1` (bugfixes only) for Project Owner review of musical scale, instrument tone, voice-polyphony limits, and completion chime pacing.
- **Planned Sprint Slices**:
  - **TASK-2.3b** `[quick-win]`: Layer harmonic pentatonic streak progression during Paint Mode drags, warm swatch-clear arpeggios, and `100%` puzzle completion chimes into `SoundService.ts` and `App.tsx`.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | [EPIC-3](https://github.com/shthed/capy/issues/478) | `priority: medium` | `domain: audio, ui`
- **Complexity & Model**: `medium` / `moderate` | **Recommended Model**: `Gemini 4 Argon`
- **Effort Estimate**: `~22,000 tokens` | `~10--15 min agent` (`~2.5--3.5 hrs human`)
- **Target Files**: [`web/src/services/SoundService.ts`](./web/src/services/SoundService.ts), [`web/src/App.tsx`](./web/src/App.tsx), [`web/scripts/test.mjs`](./web/scripts/test.mjs), [`WEB.md`](./WEB.md)
- **Acceptance Criteria**:
  - Zero bundled audio assets (`0 KB`), streak resets cleanly after gesture idle (`> 450ms`), does not advance on `UNFILL` / Undo, caps simultaneous oscillators (max 3--4 voices) during fast drags, and respects `soundEnabled`, `soundVolume`, and `document.hidden` auto-suspend.

</details>

### US-2.4: Zero-Allocation Region Fill Bloom & Swatch Shimmer *(Moved from [EPIC-2](https://github.com/shthed/capy/issues/477))*

- **Readiness**: `Awaiting Owner Review & Approval`
- **Description**: Animate region fills with a `180ms` radial ink-bloom and highlight newly completed palette swatches with a `400ms` shimmer wave across matching regions in [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx).
- **Value**: Gives clear, tactile visual feedback on fills and color completions using a zero-allocation typed-array ring buffer.
- **Why Pushed to [EPIC-3](https://github.com/shthed/capy/issues/478)**: Held out of `v3.0.1` (bugfixes only) so the Project Owner can review visual subtlety, `reducedMotion` behavior, and battery impact before implementation.
- **Planned Sprint Slices**:
  - **TASK-2.4a**: Create a pre-allocated typed-array fill-animation ring buffer (mirroring `CoopRippleBuffer.ts`) driving a `180ms` radial clip bloom in `PuzzleCanvas.tsx`.
  - **TASK-2.4b**: Trigger a `400ms` celebratory highlight pulse across completed-swatch centroids when a palette color reaches `0` remaining regions.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | [EPIC-3](https://github.com/shthed/capy/issues/478) | `priority: medium` | `domain: canvas`
- **Complexity & Model**: `high` / `hard` | **Recommended Model**: `Gemini 4 Carbon` (`2.4a`), `Gemini 4 Argon` (`2.4b`)
- **Effort Estimate**: `~42,000 tokens` | `~20--28 min agent` (`~5--7 hrs human`)
- **Target Files**: [`web/src/components/PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx), [`web/src/engine/CoopRippleBuffer.ts`](./web/src/engine/CoopRippleBuffer.ts), [`web/scripts/test.mjs`](./web/scripts/test.mjs), [`WEB.md`](./WEB.md)
- **Acceptance Criteria**:
  - Zero heap allocations (`Float32Array` / `Int32Array` fixed ring buffer) during `requestAnimationFrame`, overwriting the oldest slot cleanly on overflow, bypassing bloom/shimmer when `reducedMotion` is enabled, and returning to `0%` CPU idle once the `180ms` / `400ms` window expires.

</details>

### TASK-2.5: Android App Verification & Google Play Store Deployment *(Moved from [EPIC-2](https://github.com/shthed/capy/issues/477))*

- **Readiness**: `Ready for Release Ops (Store-Clean v3.0.35 Build, Phone/Tablet Store Listing, Graphics & Privacy Policy Staged; Keystore Secrets Configured, Awaiting Tag & Play Console Upload)`
- **Description**: Verify release signing secrets (`CAPY_KEYSTORE_BASE64`, `CAPY_KEYSTORE_PASSWORD`, `CAPY_KEY_ALIAS`, `CAPY_KEY_PASSWORD`, already configured in repository Actions secrets), verify `./gradlew app:testDebugUnitTest app:assembleRelease app:bundleRelease` (plus `MainActivity` `onPause`/`onResume` lifecycle & hardware back navigation), tag `v3.0.35` from `main` to trigger [`.github/workflows/release.yml`](./.github/workflows/release.yml), and publish the Play-signed `.aab` to Google Play Console using [`docs/play-store/PLAY_STORE_LISTING.md`](./docs/play-store/PLAY_STORE_LISTING.md) (Phone & Tablet form factors only; Android TV form factor remains unchecked until `US-3.6` ships post-launch).
- **Value**: Ships the unified Android wrapper (`com.capypaint.capy`) to Google Play Store alongside the web release.
- **Why Pushed to [EPIC-3](https://github.com/shthed/capy/issues/478)**: Moved out of [EPIC-2](https://github.com/shthed/capy/issues/477) (`v3.0.x` bugfixes & stabilization) by the Project Owner so Play Store signing and release operations track alongside Sprint 2 readiness.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Task` | [EPIC-3](https://github.com/shthed/capy/issues/478) ([Milestone #3](https://github.com/shthed/capy/milestone/3)) | `priority: high` | `domain: android, ci`
- **Complexity & Model**: `medium` | **Recommended Model**: `Gemini 4 Argon` + Owner Play Console / Keystore Setup
- **Effort Estimate**: `~18,000 tokens` | `~10--15 min agent`
- **Target Files**: [`app/build.gradle.kts`](./app/build.gradle.kts), [`app/src/main/java/com/capypaint/capy/MainActivity.kt`](./app/src/main/java/com/capypaint/capy/MainActivity.kt), [`.github/workflows/release.yml`](./.github/workflows/release.yml), [`APP.md`](./APP.md), [`docs/play-store/PLAY_STORE_LISTING.md`](./docs/play-store/PLAY_STORE_LISTING.md)
- **Acceptance Criteria**:
  - `release.yml` builds a Play-signed `.aab` and `.apk` matching [`web/package.json`](./web/package.json) SemVer and `versionCode` cleanly.
  - Release Android build passes on-device smoke QA (launch, coloring, save/resume, lifecycle `onPause`/`onResume`, hardware back navigation) and is uploaded to Google Play Console.

</details>

### US-3.6: Android TV `1920x1080` Overscan Layout, D-Pad Focus & Reticle Fill

- **Readiness**: `Deferred Until Post-Play-Store Launch (Per Owner Directive)` *(Dormant `LEANBACK_LAUNCHER` manifest & `320x180` `tv_banner.png` staged in `v3.0.19`; do NOT opt into Android TV form factor in Play Console yet)*
- **Description**: Add `1920x1080` television `5%` overscan-safe HUD margins, visible `focus-visible` D-pad arrow traversal without canvas focus traps, and a virtual TV canvas reticle supporting `DPAD_CENTER` / `Enter` region fills across Web and Android TV.
- **Value**: Turns big-screen Android TV and living-room browser play into a comfortable couch-ready experience with a standard TV remote.
- **Why Deferred**: Deferred by the Project Owner until after the initial Phone & Tablet Google Play Store release (`TASK-2.5` / `v3.0.35`) is live.
- **Planned Sprint Slices**:
  - **TASK-3.6a**: Add `1920x1080` TV overscan-safe inset CSS + additive native safe-area variables and D-pad arrow focus traversal across `GameTopBar`, `PaletteDock`, `FloatingActions`, and `SettingsModal`.
  - **TASK-3.6b**: Add virtual TV canvas reticle (`DPAD_CENTER` / `Enter` / `Space` tap-to-fill) and `MainActivity.kt` D-pad key forwarding with `1920x1080` Playwright E2E coverage.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | [EPIC-3](https://github.com/shthed/capy/issues/478) | `priority: medium-high` | `domain: tv, ui, android`
- **Complexity & Model**: `high` / `moderate` | **Recommended Model**: `Gemini 4 Argon`
- **Effort Estimate**: `~40,000 tokens` | `~20--28 min agent` (`~5--7 hrs human`)
- **Target Files**: [`web/src/App.tsx`](./web/src/App.tsx), [`web/src/components/PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx), [`web/src/index.css`](./web/src/index.css), [`app/src/main/java/com/capypaint/capy/MainActivity.kt`](./app/src/main/java/com/capypaint/capy/MainActivity.kt), [`web/scripts/test.mjs`](./web/scripts/test.mjs), [`APP.md`](./APP.md)
- **Acceptance Criteria**:
  - Interactive HUD controls stay within `1920x1080` `5%` TV overscan safe bounds without regressing `360x780` mobile layout, and D-pad arrow keys traverse HUD controls and canvas reticle without focus traps.

</details>

---

## 3. `EPIC-4`: Serverless Infinite Zoom, Printable Art & Local Co-op Polish (`Ready After EPIC-3`)

**Epic Goal**: Complete Capy's signature offline creative workflows—focal-point sub-tile exploration, physical paper coloring sheets, and expressive local Co-op—before introducing external backend infrastructure. *(GitHub Tracking Issue: [EPIC-4](https://github.com/shthed/capy/issues/479) | Milestone: [Sprint 3](https://github.com/shthed/capy/milestone/4)).*

### US-4.1: Focal-Point Quadtree Sub-Tiles & Parent Breadcrumbs

- **Readiness**: `Ready for Sprint 3` (Zero external blockers; `InfiniteZoomTileSpec` already defined in `web/src/services/providers/types.ts`; `parentSnapshotId` & top-bar breadcrumb `TASK-4.1a` shipped in [#475](https://github.com/shthed/capy/pull/475))
- **Description**: Upgrade `handleZoomIntoDetailTile` (`App.tsx`) from a fixed `2x` center crop to generate detail sub-tiles centered on the player's active `(focusX, focusY)` viewport focus on top of the live "Back to Parent Puzzle" breadcrumb pill in `GameTopBar.tsx`.
- **Value**: Makes Infinite Zoom genuinely exploratory—players can dive into any interesting corner of an artwork and jump right back to the parent canvas without hunting through the Saves list.
- **Why Now**: `parentSnapshotId` and `topbar-parent-puzzle-btn` ([#475](https://github.com/shthed/capy/pull/475)) already preserve and restore parent viewports; adding focal-point `(focusX, focusY)` cropping completes multi-depth Infinite Zoom navigation.
- **Planned Sprint Slices**:
  - **TASK-4.1b**: Upgrade `handleZoomIntoDetailTile` to crop around the active `(focusX, focusY)` viewport center with persisted `subTileBounds` for multi-depth navigation.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | [EPIC-4](https://github.com/shthed/capy/issues/479) | `priority: medium-high` | `domain: canvas, engine, ui`
- **Complexity & Model**: `high` / `hard` | **Recommended Model**: `Gemini 4 Argon` (`4.1b`)
- **Effort Estimate**: `~26,000 tokens` | `~12--18 min agent` (`~3.5--5 hrs human`)
- **Target Files**: [`web/src/App.tsx`](./web/src/App.tsx), [`web/src/components/GameTopBar.tsx`](./web/src/components/GameTopBar.tsx), [`web/src/components/PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx), [`web/src/types/index.ts`](./web/src/types/index.ts), [`WEB.md`](./WEB.md)
- **Acceptance Criteria**:
  - Cropping around arbitrary `(focusX, focusY)` clamps cleanly inside source image bounds across repeated `2x` sub-tile depths while preserving parent breadcrumb restoration.

</details>

### US-4.2: Printable Vector SVG / PDF Coloring Sheet Layout Options

- **Readiness**: `Ready for Sprint 3` (Zero external blockers; monochrome vector `.svg` exporter [`SvgPrintExporter.ts`](./web/src/services/SvgPrintExporter.ts) `TASK-4.2a` shipped in [#475](https://github.com/shthed/capy/pull/475))
- **Description**: Add print sheet framing and styling controls in `SettingsModal.tsx` on top of `SvgPrintExporter.ts` so players can tailor exported `.svg` / browser-printed PDF coloring sheets for A4 vs. Letter paper, stroke weight, and optional numberless freehand coloring.
- **Value**: Bridges digital and physical play—parents, teachers, and artists can customize page margins, stroke thickness, and number visibility before printing on home printers.
- **Why Now**: `SvgPrintExporter.ts` ([#475](https://github.com/shthed/capy/pull/475)) already exports crisp collinear-merged vector `.svg` sheets; adding print framing options completes physical paper support with zero server infrastructure.
- **Planned Sprint Slices**:
  - **TASK-4.2b**: Add print sheet layout options in `SettingsModal.tsx` (A4 vs. Letter aspect framing, line thickness, optional number hiding for freehand coloring, and browser Print/PDF trigger).

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | [EPIC-4](https://github.com/shthed/capy/issues/479) | `priority: medium-high` | `domain: export, engine`
- **Complexity & Model**: `medium` / `moderate` | **Recommended Model**: `Gemini 4 Argon`
- **Effort Estimate**: `~22,000 tokens` | `~12--16 min agent` (`~3.5--5.5 hrs human`)
- **Target Files**: [`web/src/services/SvgPrintExporter.ts`](./web/src/services/SvgPrintExporter.ts), [`web/src/components/SettingsModal.tsx`](./web/src/components/SettingsModal.tsx), [`web/src/services/NativeBridge.ts`](./web/src/services/NativeBridge.ts), [`WEB.md`](./WEB.md)
- **Acceptance Criteria**:
  - A4 and US Letter aspect framing, configurable stroke widths, and optional number hiding render cleanly in Chrome/Firefox/Safari print preview without dark UI backgrounds.

</details>

### US-4.3: Co-op Collaborator Region Ping Beacon

- **Readiness**: `Ready for Sprint 3` *(Single-step Co-op `UNFILL_EVENT` / `UNFILL` sync & 2-peer `BroadcastChannel` E2E shipped in [#475](https://github.com/shthed/capy/pull/475); replay-rewind `UNFILL` + `WELCOME_STATE` session persistence shipped in [#484](https://github.com/shthed/capy/pull/484)).*
- **Description**: Add a tap-and-hold or toolbar `'PING'` beacon message over `CoopRoomWireMessage` (`HybridCoopRoomAdapter`) rendered as an expanding dual-ring beacon via `CoopRippleBuffer.ts` on `PuzzleCanvas.tsx`.
- **Value**: Lets Co-op partners point out tiny hard-to-find micro-regions visually on shared puzzles without verbal coordinates.
- **Why Now**: Works immediately over same-device `BroadcastChannel` Co-op today with zero server changes and carries forward automatically when the WebSocket relay (`US-5.2`) goes live.
- **Planned Sprint Slices**:
  - **TASK-4.3b**: Add `'PING'` wire message to `CoopMessageType` (`web/src/services/providers/types.ts`), relay via `HybridCoopRoomAdapter`, and render expanding dual-ring beacons in `CoopRippleBuffer.ts` and `PuzzleCanvas.tsx`.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | [EPIC-4](https://github.com/shthed/capy/issues/479) | `priority: medium-high` | `domain: multiplayer, canvas`
- **Complexity & Model**: `medium` / `moderate` | **Recommended Model**: `Gemini 4 Argon`
- **Effort Estimate**: `~20,000 tokens` | `~8--12 min agent` (`~2--3 hrs human`)
- **Target Files**: [`web/src/services/providers/types.ts`](./web/src/services/providers/types.ts), [`web/src/services/providers/ProviderRegistry.ts`](./web/src/services/providers/ProviderRegistry.ts), [`web/src/engine/CoopRippleBuffer.ts`](./web/src/engine/CoopRippleBuffer.ts), [`web/src/components/PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx), [`CLOUD.md`](./CLOUD.md)
- **Acceptance Criteria**:
  - Zero per-frame heap allocations in `CoopRippleBuffer.ts`, verified by a 2-peer Playwright `BroadcastChannel` ping E2E test.

</details>

### US-4.4: TV Screen + Phone/Remote Co-op Companion (QR Pairing & Touchpad)

- **Readiness**: `Deferred Until Post-Play-Store Launch (Depends on US-3.6 & EPIC-3/EPIC-5 Cloud/Co-op Hub Promotion)`
- **Description**: Add `REMOTE_CURSOR` and `REMOTE_ACTION` frames in `worker/coopRoomProtocol.ts`, zero-dependency inline SVG QR pairing (`#room=<CODE>&ctrl=1`) alongside 6-char room codes, and a mobile touchpad/palette controller view driving the TV canvas in real time once TV support ships after Google Play Store deployment (`cloud-coop-hub` remains gated behind `isCloudCoopUiEnabled()` in `v3.0.35`).
- **Value**: Lets family and friends turn any smartphone into a responsive wireless painting controller for a living-room TV without installing a separate companion app.
- **Why Deferred**: Deferred by Owner directive until after Google Play Store launch (`TASK-2.5` / `v3.0.35`); `CoopRoomDurableObject` (`worker/`) and `HybridCoopRoomAdapter` stay ready underneath `isCloudCoopUiEnabled()` (`?coop=1` / `?room=...`).
- **Planned Sprint Slices**:
  - **TASK-4.4a**: Extend `worker/coopRoomProtocol.ts` and `worker/index.ts` with validated `REMOTE_CURSOR` / `REMOTE_ACTION` frames and rate limits, and clean up unconfigured OAuth clutter in `SettingsModal.tsx` `Saves`.
  - **TASK-4.4b**: Add inline SVG QR pairing (`#room=<CODE>&ctrl=1`) and dedicated phone touchpad controller UI with 2-context Playwright E2E cursor, paint, and undo verification.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | [EPIC-4](https://github.com/shthed/capy/issues/479) | `priority: medium-high` | `domain: multiplayer, tv, ui`
- **Complexity & Model**: `high` / `hard` | **Recommended Model**: `Gemini 4 Carbon` (`/plan`) + `Gemini 4 Argon`
- **Effort Estimate**: `~45,000 tokens` | `~20--30 min agent` (`~6--8 hrs human`)
- **Target Files**: [`worker/coopRoomProtocol.ts`](./worker/coopRoomProtocol.ts), [`worker/index.ts`](./worker/index.ts), [`web/src/services/ShareLinkService.ts`](./web/src/services/ShareLinkService.ts), [`web/src/components/SettingsModal.tsx`](./web/src/components/SettingsModal.tsx), [`web/src/App.tsx`](./web/src/App.tsx), [`CLOUD.md`](./CLOUD.md)
- **Acceptance Criteria**:
  - Ephemeral `REMOTE_CURSOR` moves broadcast cleanly without overwriting SQLite `room_state` or starving `PAINT_EVENT` / `UNFILL_EVENT` frames, and `#room=<CODE>&ctrl=1` pairs from phone to `1920x1080` TV with `0px` mobile horizontal overflow.

</details>

---

## 4. `EPIC-5`: Production Cloud Auth, Cross-Network Co-op & Optional AI Creation (`Blocked on External Infra`)

**Epic Goal**: Connect Capy's hexagonal cloud, room-sync, and AI provider interfaces (`ProviderRegistry.ts`) to live production credentials and lightweight serverless endpoints when ready for public store and cross-network scale. *(GitHub Tracking Issue: [EPIC-5](https://github.com/shthed/capy/issues/480) | Do not pull `EPIC-5` stories into `TODO.md` until their stated **Unblock Prerequisite** is satisfied).*

### US-5.1: Production Google OAuth, Play Games IDs & Verified App Links

- **Readiness**: `Blocked -- External Console Credentials & Root Domain Hosting`
- **Unblock Prerequisite**: Human provisioning of Google Cloud Web OAuth Client ID (`VITE_GOOGLE_CLIENT_ID`), 12-digit Play Games Project ID (`CAPY_PLAY_GAMES_APP_ID`), release keystore SHA-256 fingerprint, and write access to root `https://shthed.github.io/.well-known/assetlinks.json` (Android `autoVerify="true"` queries domain root rather than `/capy/.well-known/`).
- **Description**: Configure live Google Cloud OAuth and Play Games repository variables and publish verified Digital Asset Links for `com.capypaint.capy`.
- **Value**: Unlocks live one-tap Google Drive cross-device save sync on web, native Play Games `SnapshotsClient` sync on Android, and seamless Android App Link opening for `#s=<token>` links.
- **Why Now**: Client drivers (`GoogleCloudDriver`, `PlayGamesAndroidDriver`, `privacy-policy.html`) are already complete; CI variable wiring from [EPIC-2](https://github.com/shthed/capy/issues/477) (`BUG-2`) shipped to `main` in [#485](https://github.com/shthed/capy/pull/485).

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | [EPIC-5](https://github.com/shthed/capy/issues/480) | `priority: medium` | `domain: android, cloud`
- **Complexity & Model**: `low` / `easy` | **Recommended Model**: `Gemini 3.8 Flash` + Human Console Setup
- **Effort Estimate**: `~20,000 tokens` | `~10--15 min agent` (`~2--4 hrs human`)
- **Target Files**: [`app/build.gradle.kts`](./app/build.gradle.kts), [`app/src/main/AndroidManifest.xml`](./app/src/main/AndroidManifest.xml), [`CLOUD.md`](./CLOUD.md)
- **Acceptance Criteria**:
  - `https://shthed.github.io/.well-known/assetlinks.json` (or custom domain) validates against `pm get-app-links com.capypaint.capy` and Google OAuth sign-in succeeds without sandbox overrides.

</details>

### US-5.2: Hosted Hibernating WebSocket Co-op Room Relay (`VITE_CAPY_ROOM_WS_URL`)

- **Readiness**: `Blocked -- External Cloudflare Workers / Durable Objects Account`
- **Unblock Prerequisite**: Cloudflare Workers + Durable Objects deployment target and live `VITE_CAPY_ROOM_WS_URL` domain.
- **Description**: Deploy a lightweight stateless/hibernating WebSocket room relay ([`worker/`](./worker/) Cloudflare Worker + Durable Objects) backing `HybridCoopRoomAdapter` for 6-character `?room=ABC123` codes.
- **Value**: Lets friends and family color the same puzzle together in real time across separate phones, tablets, and laptops over the internet—not just tabs on the same browser.
- **Why Now**: `HybridCoopRoomAdapter` already implements the full WebSocket room protocol (`HELLO`, `WELCOME_STATE`, `PAINT_EVENT`, `HEARTBEAT`, `LEAVE`).

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | [EPIC-5](https://github.com/shthed/capy/issues/480) | `priority: medium` | `domain: multiplayer, cloud`
- **Complexity & Model**: `high` / `hard` | **Recommended Model**: `Gemini 4 Carbon` (`/plan`) + `Gemini 4 Argon`
- **Effort Estimate**: `~50,000 tokens` | `~25--35 min agent` (`~8--12 hrs human`)
- **Target Files**: [`worker/index.ts`](./worker/index.ts), [`worker/coopRoomProtocol.ts`](./worker/coopRoomProtocol.ts), [`wrangler.jsonc`](./wrangler.jsonc), [`web/src/services/providers/ProviderRegistry.ts`](./web/src/services/providers/ProviderRegistry.ts), [`CLOUD.md`](./CLOUD.md)
- **Acceptance Criteria**:
  - Hibernates between strokes (`0` billable CPU ms while idle via C++ `PING`/`PONG`), enforces `<= 6 KB` frame caps, strict `Origin` validation, `40 frames / 5s` rate limiting, and write-once initial `seed_token` persistence, and automatically falls back to `BroadcastChannel` when offline or on `localhost`/`github.io`.

</details>

### US-5.3: Ephemeral Encrypted Blob Relay for Custom Photo Share Links

- **Readiness**: `Blocked -- External Ephemeral Blob Storage Endpoint`
- **Unblock Prerequisite**: Provisioned object/KV storage endpoint supporting `<= 200 KB` blobs with `30`-day automatic TTL expiration.
- **Description**: Add opt-in client-side AES-GCM encrypted `.capy` v2 blob upload (decryption key kept exclusively inside the URL `#` fragment) so `#s=<token>` share links work across devices for custom uploaded photos.
- **Value**: Removes the current limitation where `#s=<token>` links work across devices only for built-in Gallery artworks while keeping user photos zero-knowledge encrypted.
- **Why Now**: Custom photo puzzles (`45--95 KB` `.capy` v2) exceed `< 2 KB` URL hash limits; an encrypted ephemeral relay completes universal link sharing privately.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | [EPIC-5](https://github.com/shthed/capy/issues/480) | `priority: medium` | `domain: cloud, security`
- **Complexity & Model**: `medium` / `hard` | **Recommended Model**: `Gemini 4 Carbon`
- **Effort Estimate**: `~40,000 tokens` | `~18--26 min agent` (`~6--8 hrs human`)
- **Target Files**: [`web/src/services/ShareLinkService.ts`](./web/src/services/ShareLinkService.ts), [`web/public/privacy-policy.html`](./web/public/privacy-policy.html), [`CLOUD.md`](./CLOUD.md)
- **Acceptance Criteria**:
  - Decryption key stays strictly inside `#s=...` (never transmitted in HTTP requests), and built-in Gallery `#s=` links continue using zero network calls.

</details>

### US-5.4: Live Prompt-to-Puzzle & Seam-Locked Sub-Tile AI Artwork Endpoint

- **Readiness**: `Blocked -- External Paid Image-Generation API & Rate-Limit Budget`
- **Unblock Prerequisite**: Provisioned serverless image-generation proxy (`VITE_CAPY_AI_API_URL`), API billing cap, and moderation policy sign-off.
- **Description**: Connect `DefaultAiArtworkAdapter` (`VITE_CAPY_AI_API_URL`) to a serverless image-generation endpoint supporting both "Create Puzzle from Text Prompt" and seam-locked detail inpainting (`buildSeamLockedInfillPrompt`) for Infinite Zoom sub-tiles.
- **Value**: Gives players an endless supply of custom coloring-book illustrations from imagination and synthesizes crisp new micro-details when zooming deep into sub-tiles.
- **Why Now**: Sequenced behind zero-cost client features because live image synthesis incurs per-request API cost (`AiCreditLedger`).

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | [EPIC-5](https://github.com/shthed/capy/issues/480) | `priority: medium-low` | `domain: ai, engine, ui`
- **Complexity & Model**: `high` / `hard` | **Recommended Model**: `Gemini 4 Carbon` (`/plan`) + `Gemini 4 Argon`
- **Effort Estimate**: `~90,000 tokens` (`~42k` + `~48k`) | `~40--60 min agent` (`~12--18 hrs human`)
- **Target Files**: [`web/src/services/providers/ProviderRegistry.ts`](./web/src/services/providers/ProviderRegistry.ts), [`web/src/components/SettingsModal.tsx`](./web/src/components/SettingsModal.tsx), [`web/src/App.tsx`](./web/src/App.tsx), [`CLOUD.md`](./CLOUD.md)
- **Acceptance Criteria**:
  - Enforces family-friendly prompt moderation prior to API dispatch and degrades cleanly when offline or unconfigured.

</details>

### US-5.5: Moderated Global Community Ideas & Automated `.capy` Pack Publisher

- **Readiness**: `Blocked -- Depends on Shared Moderation API & US-5.4 AI Pipeline`
- **Unblock Prerequisite**: Shared community voting/moderation endpoint and live `US-5.4` artwork synthesis credentials.
- **Description**: Back `StaticAndCommunityCatalogAdapter` (`capy_community_ideas_v1`) with a moderated shared API so player puzzle ideas and upvotes sync globally, paired with a scheduled workflow that pre-bakes top-voted ideas into `.capy` v2 gallery packs.
- **Value**: Turns the local-only Community Puzzle Ideas box into a living, player-curated artwork catalog where popular requests automatically become playable zero-wait puzzles.
- **Why Now**: Sequenced last in [EPIC-5](https://github.com/shthed/capy/issues/480) because automated pack publishing builds directly on `US-5.4`.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | [EPIC-5](https://github.com/shthed/capy/issues/480) | `priority: medium-low` | `domain: cloud, engine`
- **Complexity & Model**: `high` / `hard` | **Recommended Model**: `Gemini 4 Argon`
- **Effort Estimate**: `~45,000 tokens` | `~20--30 min agent` (`~6--8 hrs human`)
- **Target Files**: [`web/src/services/providers/ProviderRegistry.ts`](./web/src/services/providers/ProviderRegistry.ts), `.github/workflows/`, [`CLOUD.md`](./CLOUD.md)
- **Acceptance Criteria**:
  - Client continues working 100% offline with bundled + cached catalog entries if the community API is unreachable.

</details>

---

## 5. Unscheduled Platform Icebox (`ICE-1`--`ICE-3`)

Parked native desktop/mobile store wrappers awaiting completion of [EPIC-2](https://github.com/shthed/capy/issues/477)--[EPIC-4](https://github.com/shthed/capy/issues/479) Web/Android stabilization before active chartering *(intentionally excluded from open GitHub Issues until promoted to `EPIC-6+` so the Issue tracker stays strictly scoped to chartered Epics)*:

<details>
<summary>Expand Unscheduled Multi-Platform Shell Epics (Steam, iOS/iPadOS, Microsoft/Xbox)</summary>

- **`ICE-1`: Steam Desktop Wrapper (`desktop/` Tauri v2) & `SteamCloudDriver` Bindings**:
  - *Value*: Packages `web/dist/` for Windows/macOS/Linux Steam Deck & desktop players with `ISteamRemoteStorage` Cloud Saves, Steam Achievements, and Steam Overlay (`SteamCloudDriver` in [`CloudProviderDrivers.ts`](./web/src/services/providers/CloudProviderDrivers.ts) is already modularly stubbed).
  - *Activation Trigger*: Promote to an active Epic after [EPIC-2](https://github.com/shthed/capy/issues/477)--[EPIC-4](https://github.com/shthed/capy/issues/479) desktop keyboard, audio, and achievement contracts stabilize (`~60k tokens`, `Gemini 4 Argon`).
- **`ICE-2`: iOS & iPadOS Native Wrapper (`ios/` Swift `WKWebView`) & `AppleCloudDriver` Bindings**:
  - *Value*: Delivers App Store distribution with Apple Pencil hover/tilt ergonomics, CoreHaptics, GameKit (`GKLocalPlayer`), and CloudKit save sync (`window.webkit.messageHandlers.CapyIOS` + `AppleCloudDriver`).
  - *Activation Trigger*: Promote when Apple Developer Storefront distribution and macOS Xcode signing are scheduled (`~65k tokens`, `Gemini 4 Argon`).
- **`ICE-3`: Microsoft Store / Xbox Wrapper & `MicrosoftCloudDriver` Bindings**:
  - *Value*: Connects `MicrosoftCloudDriver` to live Entra ID / MSA OAuth 2.0 PKCE credentials for OneDrive `special/approot` and Xbox Connected Storage sync.
  - *Activation Trigger*: Promote alongside desktop/console storefront packaging (`~45k tokens`, `Gemini 4 Argon`).

</details>

<!-- capy-dev-only:start -->
- **Public Issue Tracker Mapping ([capyboop/capy](https://github.com/capyboop/capy/issues))**: Public player issues [`capyboop/capy#2` (Tutorial Improvements)](https://github.com/capyboop/capy/issues/2), [`capyboop/capy#3` (Account login & Cloud Sync)](https://github.com/capyboop/capy/issues/3), [`capyboop/capy#4` (In-game Feedback & Puzzle Ideas)](https://github.com/capyboop/capy/issues/4), and [`capyboop/capy#5` (Puzzle Generation Algorithm)](https://github.com/capyboop/capy/issues/5) map onto [EPIC-3](https://github.com/shthed/capy/issues/478), [EPIC-4](https://github.com/shthed/capy/issues/479), and [EPIC-5](https://github.com/shthed/capy/issues/480). Companion [capyboop.com](https://capyboop.com/) cutover is parked until Owner reprioritization.
<!-- capy-dev-only:end -->

---

## 6. Shipped Epics & Stories (`EPIC-1` & Completed Stories)

Completed Epics and User Stories archived upon merge to `main` (full granular PR history lives in [`CHANGELOG.md`](./CHANGELOG.md)):

<details>
<summary>Expand Shipped Epics & Stories (EPIC-1 & Shipped/Staged Slices -- PRs #431--#578)</summary>

- **Sprint 1 `v3.0.0`--`v3.0.35` Bugfix, Onboarding, Mobile UI, Durability & Play Store Launch Prep Slices (`BUG-1`--`BUG-3`, `BUG-5`, `TASK-2.6`, PR Workflows & Governance)**:
  - **`v3.0.35` Release Promotion Prep (`v3.0.30`--`v3.0.35` Staged on `beta` for [#574 — Promote Capy Beta release to main](https://github.com/shthed/capy/pull/574))** -- [#578 — Sync v3.0.35 release prep, Play Store guide, and CI check titles](https://github.com/shthed/capy/pull/578)
  - **`v3.0.35` `StorageService.ts` Local/Backup Recency & Empty-Overwrite Durability** -- [#577 — Harden local save backup recency and empty-overwrite protection](https://github.com/shthed/capy/pull/577)
  - **`v3.0.34` Clean-Room Export, Release Signing Guard & Dual-Origin Co-op Hardening** -- [#576 — Harden CapyBoop clean-room export, release workflow, and Co-op origins](https://github.com/shthed/capy/pull/576)
  - **`v3.0.33` Public `capyboop/capy` Issue Tracker, Templates & About-Tab Link** -- [#575 — Wire capypaint.com and templates to public capyboop/capy issue tracker](https://github.com/shthed/capy/pull/575)
  - **`v3.0.32` `O(R log R)` `maxRegions <= 2000` Cap, Network-First `.capy` SW Caching & Create Hints** -- [#573 — Fix Max-detail region limits and offline caching with clearer Create hints](https://github.com/shthed/capy/pull/573)
  - **`v3.0.31` Google Play Store Remediation (Ad-Free UI, Private Puzzle Idea Notebook & Deferred Play Games Sign-In)** -- [#571 — Remove Android ad hooks, fake idea votes, and default Co-op/login leaks for Play Store](https://github.com/shthed/capy/pull/571)
  - **`v3.0.30` Play Daily Snapshot Race Fix & Max-Detail Sample/Daily Refreshes** -- [#569 — Fix intermittent Play Daily end-to-end test failure](https://github.com/shthed/capy/pull/569), [#570 — Regenerate Max-settings sample and daily puzzles](https://github.com/shthed/capy/pull/570), [#572 — Regenerate Max-settings sample and daily puzzles](https://github.com/shthed/capy/pull/572)
  - **`v3.0.29` Production Promotion (`v3.0.27`--`v3.0.29` E2E/Unit Logs, Pre-Baked Max Dailies & `lintVitalRelease` Fix Bundle)** -- [#567 — Promote v3.0.29 beta release to main](https://github.com/shthed/capy/pull/567), [#568 — Retag release notes for v3.0.29 Production promotion](https://github.com/shthed/capy/pull/568)
  - **`v3.0.29` Signed Android Release `lintVitalRelease` Fragment Pin** -- [#566 — Fix signed Android release build lint failure](https://github.com/shthed/capy/pull/566)
  - **`v3.0.28` Pre-Generated Max-Detail Sample/Daily Archives & `regenerate-puzzles.yml`** -- [#565 — Pre-generate Max-settings daily/sample puzzles and surface Create tab hints](https://github.com/shthed/capy/pull/565)
  - **`v3.0.27` Standardized `[Unit]`/`[E2E]` Logs & Isolated Subprocess Test Checks** -- [#563 — Standardize E2E and unit test logs and guard temp screenshot writes](https://github.com/shthed/capy/pull/563)
  - **`v3.0.26` Production Promotion (`v3.0.25`--`v3.0.26` Cloudflare Workers & Direct Blocked-PR Merge Bundle)** -- [#562 — Beta](https://github.com/shthed/capy/pull/562), [#550 — Prepare Cloudflare Worker cutover, redirects, and token docs](https://github.com/shthed/capy/pull/550), [#560 — Merge approved PRs directly when auto-merge is stuck blocked](https://github.com/shthed/capy/pull/560)
  - **`v3.0.24` Production Promotion (`v3.0.21`--`v3.0.24` Preset Gallery, Colour Defaults, Replay Scrubber & Review-Gate Bundle)** -- [#556 — Beta](https://github.com/shthed/capy/pull/556), [#559 — Prepare v3.0.24 release changelog and roadmap for main promotion](https://github.com/shthed/capy/pull/559)
  - **`v3.0.24` Visual Preset Style Gallery & Puzzle Styles Tutorial Step** -- [#557 — Add visual Preset Style Gallery, sync Detail/Colour controls, and add Puzzle Styles tutorial step](https://github.com/shthed/capy/pull/557)
  - **`v3.0.23` Original Detail Colour Mode & Hue Sort Defaults** -- [#555 — Set default colour mode to detail and colour sort order to hue](https://github.com/shthed/capy/pull/555)
  - **`v3.0.22` Compact Replay Scrubber** -- [#554 — Remove expandable replay window and keep compact scrubber bar](https://github.com/shthed/capy/pull/554)
  - **`v3.0.21` Stacked Merge-Async Fallback & Draft Checklist Gate** -- [#553 — Add stacked merge-async fallback and Draft PR checklist gate](https://github.com/shthed/capy/pull/553)
  - **`v3.0.20` Production Promotion (`v3.0.19`--`v3.0.20` Play Store Prep, Leanback Manifest/Banner & Ad-Free Privacy Bundle)** -- [#549 — Promote v3.0.20 beta release to main](https://github.com/shthed/capy/pull/549), [#548 — Prepare v3.0.20 release changelog and roadmap for main promotion](https://github.com/shthed/capy/pull/548)
  - **`v3.0.20` Google Play Store Launch Prep (`Saves` Q1 Cleanup + `docs/play-store/` Graphics, Screenshots & Listing Guide)** -- [#547 — Prepare v3.0.20 Play Store Saves cleanup, store graphics, and listing guide](https://github.com/shthed/capy/pull/547)
  - **`v3.0.19` Android TV Leanback Manifest/Banner, Ad-Free Privacy Policy & Review-Gate Tests** -- [#545 — Add Android TV launcher banner, ad-free privacy policy, and review-gate tests (v3.0.19)](https://github.com/shthed/capy/pull/545)
  - **`.agents/environment.json` Setup & `capypaint.com` / `capyboop.com` Cutover Tracking** -- [#544 — Add repo-scoped environment setup and link capypaint.com and capyboop.com cutovers](https://github.com/shthed/capy/pull/544)
  - **`v3.0.18` Production Promotion (`v3.0.14`--`v3.0.18` Stabilization & CI Bundle)** -- [#538 — Promote v3.0.18 beta release to main](https://github.com/shthed/capy/pull/538)
  - **`v3.0.18` Viewport-Save Reload Race Fix** -- [#540 — Fix beforeunload viewport save race in Playwright E2E suite](https://github.com/shthed/capy/pull/540)
  - **`v3.0.17` Deterministic Playwright E2E Wait Hardening** -- [#539 — Harden E2E waits in test suite and sync beta docs](https://github.com/shthed/capy/pull/539)
  - **`v3.0.16` Android API 36 Edge-to-Edge, WebView Allowlisting, Release Signing & Bridge Parity** -- [#537 — Harden Android API 36 WebView security, release signing, and bridge parity](https://github.com/shthed/capy/pull/537)
  - **`v3.0.15` Web Storage Durability, `PuzzleCanvas` Optimization & Co-op Worker SQLite Checkpoints** -- [#535 — Harden web storage durability, canvas performance, and Co-op Worker state](https://github.com/shthed/capy/pull/535)
  - **`v3.0.14` Fail-Closed Review Gate, Pages Hidden Dotfiles & Mirror Sync Hardening** -- [#534 — Harden PR review gate, Pages dotfiles, and mirror sync](https://github.com/shthed/capy/pull/534)
  - **`v3.0.13` Viewport-Save Progress Preservation, Async Android/E2E/Pages CI Speedup & Strict `100%` AI Auto-Merge** -- [#528](https://github.com/shthed/capy/pull/528), [#530](https://github.com/shthed/capy/pull/530), [#531](https://github.com/shthed/capy/pull/531), [#532](https://github.com/shthed/capy/pull/532)
  - **`v3.0.12` Non-Blocking Tutorial Target Spotlight, Replay Auto-Dismissal & Mobile Badge Polish** -- [#523](https://github.com/shthed/capy/pull/523)
  - **`v3.0.11` Production Promotion (`v3.0.9`--`v3.0.11` Bundle & `beta` Syncs)** -- [#521](https://github.com/shthed/capy/pull/521), [#522](https://github.com/shthed/capy/pull/522), [#524](https://github.com/shthed/capy/pull/524), [#526](https://github.com/shthed/capy/pull/526)
  - **Enforce `100%` PR Readiness Gate & Harden GitHub Actions Workflows** -- [#520](https://github.com/shthed/capy/pull/520)
  - **`v3.0.11` 14-Step Interactive `OnboardingTutorial`, 9 `FeatureOfferBanner` Quick Tips & `100%` PR/Review Gates** -- [#519](https://github.com/shthed/capy/pull/519)
  - **`v3.0.10` Low-Vision Large Text Mode, Sorted/Centered `PaletteDock` & Default Undo** -- [#518](https://github.com/shthed/capy/pull/518)
  - **`v3.0.9` `PaletteDock` Replay Visibility & `Saves` Tab `Thumbnails` List-First Layout** -- [#517](https://github.com/shthed/capy/pull/517)
  - **`v3.0.8` Production Promotion (`v3.0.2`--`v3.0.8` Stabilization, Governance & CI/CD Bundle)** -- [#501](https://github.com/shthed/capy/pull/501)
  - **PR Readiness `%`-First Checklist Format, `sanity.mjs` Validation & `ROADMAP.md` / `TODO.md` Governance Sync** -- [#502](https://github.com/shthed/capy/pull/502), [#509](https://github.com/shthed/capy/pull/509)
  - **Main-to-Beta `AGENTS.md` Sync (Whiteboard/Checks, Line-1 Summary, `%`-First Checklist, Testing/Approval & Clickable Links)** -- [#499](https://github.com/shthed/capy/pull/499), [#500](https://github.com/shthed/capy/pull/500), [#504](https://github.com/shthed/capy/pull/504), [#505](https://github.com/shthed/capy/pull/505), [#507](https://github.com/shthed/capy/pull/507), [#508](https://github.com/shthed/capy/pull/508)
  - **Remove Topbar Zoom Pill Badge, Fix 360px Mobile `SettingsModal` Tab Clipping & E2E Overflow Guard (`v3.0.8`)** -- [#497](https://github.com/shthed/capy/pull/497)
  - **Cross-Chat `WHITEBOARD.md` Coordination Rule in `AGENTS.md`** -- [#496](https://github.com/shthed/capy/pull/496)
  - **Channel Storage Sandbox Isolation (`StorageNamespace`), Fractional DPR & Settings/Import/Play Games Fixes, `.changelog/` Compiler & Automated Epic Tracker Sync (`v3.0.7`)** -- [#495](https://github.com/shthed/capy/pull/495)
  - **`TASK-2.6`: Post-Load Replay Controls, `Capy Forest` Default, Interactive 5-Step Onboarding Tutorial & `About` Tab (`v3.0.6`)** -- [#489](https://github.com/shthed/capy/pull/489)
  - **Preview Index Manifest, Lowercase `/capy/alpha/<num>/` Routing, CI/CD Hardening & `PROJECT.md` Charter (`v3.0.2`--`v3.0.5`)** -- [#491](https://github.com/shthed/capy/pull/491), [#492](https://github.com/shthed/capy/pull/492), [#493](https://github.com/shthed/capy/pull/493), [#494](https://github.com/shthed/capy/pull/494)
  - **1-Click GitHub PR Approval Workflow via Bot-Opened PRs, Native Review Gate Tests & Prebaked Sample `1x` Viewport Reset (`v3.0.2`)** -- [#490](https://github.com/shthed/capy/pull/490)
  - **`v3.0.1` Production Promotion (`BUG-5` Mobile `GameTopBar` Two-Lane Layout & `99%` Incomplete Progress Cap)** -- [#486](https://github.com/shthed/capy/pull/486), [#488](https://github.com/shthed/capy/pull/488)
  - **Android Play Store Release Scope (`TASK-2.5`, later moved to [EPIC-3](https://github.com/shthed/capy/issues/478)) & Shipped Bugfix Queue Prune** -- [#487](https://github.com/shthed/capy/pull/487)
  - **`v3.0.0` Production Promotion (`BUG-2` CI Cloud Variable Injection & `< 2s` `sanity.mjs` Gate + Sprint 1 Bundle)** -- [#485](https://github.com/shthed/capy/pull/485)
  - **Co-op `WELCOME_STATE` Reload Persistence, Replay Scrubber `Resume Here` & `Reset Progress` `'UNFILL_EVENT'` Sync, Compact Mobile `ReplayControls` Pill Fit & Save-Load `replayLoop` Auto-Disable/Auto-Resume, Monotonic CRDT `resetEpoch`, `> 180 KB` Chunked Play Games Binary Sync, and Android `MainActivity` `onPause` / `onResume` WebView Lifecycle Guard** -- [#484](https://github.com/shthed/capy/pull/484)
- **Shipped Slices from [EPIC-5](https://github.com/shthed/capy/issues/480) (*Production Cloud Auth, Cross-Network Co-op & Optional AI Creation*)**:
  - **`capypaint.com` Cloudflare Workers Static Assets, Hibernating `CoopRoomDurableObject` Relay (`US-5.2`) & Root `assetlinks.json` App Links (`US-5.1`)** -- [#482](https://github.com/shthed/capy/pull/482)
- **Shipped Slices from [EPIC-4](https://github.com/shthed/capy/issues/479) (*Serverless Infinite Zoom, Printable Art & Local Co-op Polish*)**:
  - **Infinite Zoom Parent Breadcrumbs (`TASK-4.1a`), Printable Vector `.svg` Coloring Sheets (`TASK-4.2a`) & Co-op `UNFILL_EVENT` Undo Sync (`TASK-4.3a`)** -- [#475](https://github.com/shthed/capy/pull/475)
- **Shipped Slices from [EPIC-3](https://github.com/shthed/capy/issues/478) (*Touch Assist, Sensory Polish, Retention, Accessibility & Replays*)**:
  - **Daily Featured Puzzle (`TASK-3.1a`), Reduced Motion (`TASK-3.2a`), Desktop Keyboard Shortcuts (`TASK-3.2b`) & Lifetime Player Stats (`TASK-3.4a`)** -- [#474](https://github.com/shthed/capy/pull/474)
  - **`US-2.2`: Custom Zoom Sensitivity, Top-Bar Scale Pill & Magnetic Scale Detents** (plus `TASK-2.3a` Web Audio woodblock tap synth, archived from pre-re-scope [EPIC-2](https://github.com/shthed/capy/issues/477)) -- [#472](https://github.com/shthed/capy/pull/472)
- **[EPIC-1](https://github.com/shthed/capy/issues/476): Unified Web + Android Monorepo, Gesture Engine, `.capy` v2 Codec, Replay Scrubber & Cloud/Co-op Foundation (`Shipped v1.0--v2.5` | [Sprint 0](https://github.com/shthed/capy/milestone/1))**:
  - **`US-1.1`: Unified Single-Codebase Monorepo (`web/`, `app/`) & Automated Pages Preview CI** -- [#431](https://github.com/shthed/capy/pull/431), [#432](https://github.com/shthed/capy/pull/432), [#434](https://github.com/shthed/capy/pull/434), [#436](https://github.com/shthed/capy/pull/436), [#438](https://github.com/shthed/capy/pull/438), [#440](https://github.com/shthed/capy/pull/440), [#452](https://github.com/shthed/capy/pull/452)
  - **`US-1.2`: 6-Mode Touch Gesture Engine, Free Colour Mode & Live Segmentation Telemetry** -- [#433](https://github.com/shthed/capy/pull/433), [#439](https://github.com/shthed/capy/pull/439), [#442](https://github.com/shthed/capy/pull/442), [#444](https://github.com/shthed/capy/pull/444), [#454](https://github.com/shthed/capy/pull/454), [#455](https://github.com/shthed/capy/pull/455), [#456](https://github.com/shthed/capy/pull/456), [#457](https://github.com/shthed/capy/pull/457)
  - **`US-1.3`: Chronological Undo/Redo & YouTube-Style Interactive Replay Scrubber** -- [#446](https://github.com/shthed/capy/pull/446), [#447](https://github.com/shthed/capy/pull/447), [#448](https://github.com/shthed/capy/pull/448), [#463](https://github.com/shthed/capy/pull/463), [#464](https://github.com/shthed/capy/pull/464)
  - **`US-1.4`: Saves Gallery Modernization, `.capy` v2 Binary Archive & Instant Pre-Baked Startup** -- [#449](https://github.com/shthed/capy/pull/449), [#458](https://github.com/shthed/capy/pull/458), [#459](https://github.com/shthed/capy/pull/459), [#462](https://github.com/shthed/capy/pull/462)
  - **`US-1.5`: Modular `CloudProviderDriver` Sync (`GoogleCloudDriver`, `PlayGamesAndroidDriver`), `#s=<token>` Links & Simultaneous Co-op** -- [#460](https://github.com/shthed/capy/pull/460), [#461](https://github.com/shthed/capy/pull/461)
  - **`US-1.6`: Core Reliability Audit Fixes, Pixel API 33+ Haptics, 3-Tier `Alpha -> Beta -> Production` Pipeline & Lean Agile Foundation** -- [#465](https://github.com/shthed/capy/pull/465), [#466](https://github.com/shthed/capy/pull/466), [#467](https://github.com/shthed/capy/pull/467), [#468](https://github.com/shthed/capy/pull/468), [#469](https://github.com/shthed/capy/pull/469), [#470](https://github.com/shthed/capy/pull/470), [#471](https://github.com/shthed/capy/pull/471), [#473](https://github.com/shthed/capy/pull/473), [#481](https://github.com/shthed/capy/pull/481), [#483](https://github.com/shthed/capy/pull/483)

</details>
