# Capy Active Sprint Backlog -- Ready-for-Dev Tasks (`TODO.md`)

Focused **Sprint 1 Execution Queue** ([Milestone #2](https://github.com/shthed/capy/milestone/2) | `EPIC-2: v3.0.1 Critical Bugfixes` Tracking Issue [#477](https://github.com/shthed/capy/issues/477)) for the **Capy** monorepo ([`web/`](./web/) and [`app/`](./app/)). Only approved, unblocked, codebase-verified critical bugfixes (`BUG-*`) belong in `v3.0.1` right now; all feature work (`EPIC-3` [#478](https://github.com/shthed/capy/issues/478), including deferred `US-2.1`, `US-2.3b`, `US-2.4`, and `US-3.1`--`US-3.5`) stays in [`ROADMAP.md`](./ROADMAP.md) **awaiting Owner review and approval**. Daily bugfix PRs branch from and target **`beta`** (`--base beta`, deploying to `https://shthed.github.io/capy/beta/`) so live production players on `main` are never disrupted.

**Related Guides**: [`README.md`](./README.md) | [`ROADMAP.md`](./ROADMAP.md) | [`DEV.md`](./DEV.md) | [`AGENTS.md`](./AGENTS.md) | [`WEB.md`](./WEB.md) | [`PUZZLE.md`](./PUZZLE.md) | [`APP.md`](./APP.md) | [`CLOUD.md`](./CLOUD.md) | [`TESTING.md`](./TESTING.md) | [`CHANGELOG.md`](./CHANGELOG.md)

**Table of Contents**:
1. [Quick-Win Ready Queue (`v3.0.1` Critical Bugfixes Only)](#1-quick-win-ready-queue-v301-critical-bugfixes-only)
2. [Sprint 1 Priority 0: `EPIC-2` `v3.0.1` Critical Bugfixes (`BUG-1`--`BUG-3`)](#2-sprint-1-priority-0-epic-2-v301-critical-bugfixes-bug-1--bug-3)

<details>
<summary>Sprint 1 Entry Gate, GitHub Agile Tracking, Hybrid Execution & Totals</summary>

- **Strict Ready-for-Dev Gate (`v3.0.1` Critical Bugfixes Only)**:
  - `EPIC-2` (`v3.0.1`) accepts **only** critical reliability, lifecycle, security, and CI bugfixes (`BUG-*`).
  - Feature stories (`US-2.1`, `US-2.3b`, `US-2.4`, and `US-3.1`--`US-3.5`) reside in `EPIC-3` ([#478](https://github.com/shthed/capy/issues/478)) inside [`ROADMAP.md`](./ROADMAP.md) **awaiting Owner review and approval** and must not be added here until explicitly approved.
  - Future Epics (`EPIC-4` [#479](https://github.com/shthed/capy/issues/479)), externally blocked cloud/AI stories (`EPIC-5` [#480](https://github.com/shthed/capy/issues/480)), and `ICE-*` (no GitHub Issues until chartered) remain in [`ROADMAP.md`](./ROADMAP.md).
- **GitHub Issue & Milestone Attribution (`1 Issue = 1 Epic`)**:
  - **`v3.0.1` Critical Bugfixes (`BUG-*`)**: Attach [Sprint 1 Milestone `#2`](https://github.com/shthed/capy/milestone/2) + `epic:2` + `fix` + subsystem labels (`web`, `android`, `ci`, `testing`) and reference `Tracked in #477` at the top of the PR (**never** write `Closes #477` or `Fixes #477` on partial PRs).
- **Hybrid Automated Sprint Execution (`feature/* -> beta -> main`)**:
  - **Single-Task Chat (`1-Task = 1-PR` -> `beta`)**: Pick one `BUG-*` item in a fresh `#NNN` chat branched off `origin/beta`, run full local verification (`npm run lint && npm run build && npm test`), open the PR with `--base beta`, and wait for human merge approval.
  - **Beta Soak & Production Promotion (`beta -> main`)**: Once `v3.0.0` (`#485`) and any follow-up `v3.0.1` critical fixes pass human verification on `https://shthed.github.io/capy/beta/`, promote `beta -> main`.
- **Definition of Done (Immediate Deletion & Epic Issue Sync)**:
  - Never leave `[x]` checkboxes in `TODO.md`. Delete finished `BUG-*` items (and their Section 1 pointers) when their fix reaches Production `main`, and update [#477](https://github.com/shthed/capy/issues/477) via `gh issue edit 477`.
- **Sprint 1 Rollup (`3` `v3.0.1` Critical Bugfixes -- Staged on `beta` in `#484` / `#485`)**:
  - **Priority 0 Bugs (`BUG-1`--`BUG-3`)**: `~42k tokens` | `~21--31 min agent` (`~5--8 hrs human` -- fixes staged on `beta`, awaiting Production merge & human QA).

</details>

---

## 1. Quick-Win Ready Queue (`v3.0.1` Critical Bugfixes Only)

Priority 0 critical bugfixes scoped to `EPIC-2` / `v3.0.1` (all three fixes are currently staged on `beta` in PR `#484` / `#485` pending human QA and merge to `main`):

1. **`BUG-1`** ([Section 2](#bug-1-co-op-welcome-session-persistence--replay-rewind-unfill-sync)): Persist `StorageService.saveActiveState` on Co-op `WELCOME_STATE`, emit `'UNFILL'` on Replay Scrubber rewind, and add 2-peer replay-rewind E2E coverage *(staged on `beta` in `#484` / `#485`)*.
2. **`BUG-2`** ([Section 2](#bug-2-ci-cloud-variable-injection--fast--2s-sanity-gate)): Wire `vars.VITE_GOOGLE_CLIENT_ID` & `vars.CAPY_PLAY_GAMES_APP_ID` in `deploy-branch.yml` and add a `< 2s` `npm run test:sanity` check *(staged on `beta` in `#485`)*.
3. **`BUG-3`** ([Section 2](#bug-3-android-webview-pause--resume-lifecycle-guard-in-mainactivitykt)): Override `onPause()` / `onResume()` in `MainActivity.kt` calling `webView?.onPause()` / `webView?.onResume()` to suspend background timers and audio cleanly *(staged on `beta` in `#484` / `#485`)*.

---

## 2. Sprint 1 Priority 0: `EPIC-2` `v3.0.1` Critical Bugfixes (`BUG-1`--`BUG-3`)

### BUG-1: Co-op Welcome Session Persistence & Replay Rewind `UNFILL` Sync

- **Status**: `Staged on beta (#484 / #485) -- Pending Production Merge & Human QA`
- **Description**: Fix two remaining Co-op state-synchronization gaps in [`App.tsx`](./web/src/App.tsx) (building on single-step `'UNFILL_EVENT'` undo sync shipped in [#475](https://github.com/shthed/capy/pull/475)): (1) `ProviderRegistry.realtimeRoom.onWelcomeState` updates snapshot progress on join but omits `StorageService.saveActiveState(...)`, and (2) `handleResumeFromReplayStep` rewinds `undoneRegionIds` locally when clicking **Resume Here** on the Replay Scrubber without broadcasting `'UNFILL'` to room peers.
- **Value**: Prevents joining Co-op peers from losing synced progress if they reload before painting a region, and keeps collaborator canvases 100% consistent after a Replay Scrubber timeline rewind.
- **Why Now**: Critical multiplayer data-loss/desync bug with zero external dependencies; completes full timeline-rewind parity alongside `#475`'s single-step Undo sync.
- **Tasks**:
  - **BUG-1** `[quick-win]`: Persist `StorageService.saveActiveState` inside `onWelcomeState`, broadcast `'UNFILL'` for `undoneRegionIds` inside `handleResumeFromReplayStep`, and add a 2-peer `BroadcastChannel` Replay Scrubber `Resume Here` rewind assertion in `web/scripts/test.mjs`.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Bug` | `EPIC-2 (v3.0.1)` ([Milestone #2](https://github.com/shthed/capy/milestone/2)) | `priority: critical` | `domain: multiplayer, storage, testing`
- **Complexity & Model**: `low` / `moderate` | **Recommended Model**: `Gemini 4 Argon`
- **Effort Estimate**: `~16,000 tokens` | `~8--12 min agent` (`~2--3 hrs human`)
- **Target Files**: [`web/src/App.tsx`](./web/src/App.tsx), [`web/scripts/test.mjs`](./web/scripts/test.mjs), [`TESTING.md`](./TESTING.md)
- **Acceptance Criteria**:
  - Reloading a peer tab immediately after receiving `WELCOME_STATE` retains all merged regions in `capy_active_session_v8`.
  - 2-peer Playwright `BroadcastChannel` E2E test verifies that scrubbing backward and clicking `Resume Here` un-fills rewound regions on both peers' canvases.

</details>

### BUG-2: CI Cloud Variable Injection & Fast `< 2s` Sanity Gate

- **Status**: `Staged on beta (#485) -- Pending Production Merge`
- **Description**: Wire `VITE_GOOGLE_CLIENT_ID` and `CAPY_PLAY_GAMES_APP_ID` from GitHub Repository Variables (`vars.*`) into [`.github/workflows/deploy-branch.yml`](./.github/workflows/deploy-branch.yml) (matching [`CLOUD.md`](./CLOUD.md) documentation), and add a sub-2-second `npm run test:sanity` Node check (`version.ts`, `CHANGELOG.md` contract, markdown relative links, and zero-emoji/box-drawing guard) to `deploy-branch.yml` without launching Playwright Chromium in daily `feature/* -> beta` CI.
- **Value**: Ensures repository cloud variables actually reach Web and Android builds when configured, and gives GitHub Actions an instant `< 2s` hygiene/changelog sanity check on daily Beta PRs without slowing down Alpha preview deployments.
- **Why Now**: Prevents broken release builds and doc/version drift prior to `v3.0.0` / `v3.0.1` rollout.
- **Tasks**:
  - **BUG-2** `[quick-win]`: Add `env:` bindings for `vars.VITE_GOOGLE_CLIENT_ID` and `vars.CAPY_PLAY_GAMES_APP_ID` in `deploy-branch.yml`, create `web/scripts/sanity.mjs` (`npm run test:sanity`), and invoke it during the `Build & typecheck web app` CI step.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Bug` | `EPIC-2 (v3.0.1)` ([Milestone #2](https://github.com/shthed/capy/milestone/2)) | `priority: high` | `domain: ci, testing`
- **Complexity & Model**: `low` / `easy` | **Recommended Model**: `Gemini 3.8 Flash` or `Gemini 4 Argon`
- **Effort Estimate**: `~14,000 tokens` | `~7--10 min agent` (`~1.5--2.5 hrs human`)
- **Target Files**: [`.github/workflows/deploy-branch.yml`](./.github/workflows/deploy-branch.yml), `web/scripts/sanity.mjs`, [`web/package.json`](./web/package.json), [`TESTING.md`](./TESTING.md), [`CLOUD.md`](./CLOUD.md)
- **Acceptance Criteria**:
  - `npm run test:sanity` completes in `< 2s` with zero browser startup, verifying `APP_VERSION` / `APP_VERSION_CODE`, `CHANGELOG.md` channel-marker formatting, relative `.md` links, and zero emojis/box-drawing characters.
  - `deploy-branch.yml` builds cleanly when `vars.VITE_GOOGLE_CLIENT_ID` and `vars.CAPY_PLAY_GAMES_APP_ID` are unset (empty-string fallback) and injects them when set.

</details>

### BUG-3: Android WebView Pause / Resume Lifecycle Guard in `MainActivity.kt`

- **Status**: `Staged on beta (#484 / #485) -- Pending Production Merge & Human QA`
- **Description**: Override `onPause()` and `onResume()` alongside `onDestroy()` in [`MainActivity.kt`](./app/src/main/java/com/capypaint/capy/MainActivity.kt) to call `webView?.onPause()` and `webView?.onResume()` with unit verification in `CapyAndroidBridgeTest.kt`.
- **Value**: Guarantees Android WebView rendering, `requestAnimationFrame` loops, and Web Audio (`SoundService.ts`, shipped in `#472`) suspend cleanly at the native OS layer whenever the app is backgrounded or the screen locks.
- **Why Now**: `SoundService.ts` is live in production, so background audio/timer battery drain on Android must be guarded at the native lifecycle layer.
- **Tasks**:
  - **BUG-3** `[quick-win]`: Add `onPause()` / `onResume()` WebView lifecycle forwarding in `MainActivity.kt` and update `APP.md` lifecycle documentation.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Bug` | `EPIC-2 (v3.0.1)` ([Milestone #2](https://github.com/shthed/capy/milestone/2)) | `priority: high` | `domain: android`
- **Complexity & Model**: `low` / `easy` | **Recommended Model**: `Gemini 3.8 Flash` or `Gemini 4 Argon`
- **Effort Estimate**: `~12,000 tokens` | `~6--9 min agent` (`~1.5--2.5 hrs human`)
- **Target Files**: [`app/src/main/java/com/capypaint/capy/MainActivity.kt`](./app/src/main/java/com/capypaint/capy/MainActivity.kt), [`app/src/test/java/com/capypaint/capy/CapyAndroidBridgeTest.kt`](./app/src/test/java/com/capypaint/capy/CapyAndroidBridgeTest.kt), [`APP.md`](./APP.md)
- **Acceptance Criteria**:
  - `./gradlew app:testDebugUnitTest` and `./gradlew app:assembleDebug` pass cleanly (locally or via GitHub Actions `Build & Test`), and foreground resume restores responsive canvas input and audio playback.

</details>
