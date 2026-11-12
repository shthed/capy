# Capy Active Sprint Execution Queue (`TODO.md`)

Focused **Sprint 1 Queue** ([`EPIC-2: v3.0.1 Critical Bugfixes`](https://github.com/shthed/capy/issues/477) | [Milestone #2](https://github.com/shthed/capy/milestone/2)). Holds **only** approved, unblocked `1-PR` slices for the active sprint (`--base beta`). Strategic Epics, unapproved features (`EPIC-3`), and shipped archives live in [`ROADMAP.md`](./ROADMAP.md); workflow & GitHub CLI rules live in [`DEV.md`](./DEV.md#capy-lean-agile-backlog--todomd-entry-standard).

**Related Guides**: [`README.md`](./README.md) | [`ROADMAP.md`](./ROADMAP.md) | [`DEV.md`](./DEV.md) | [`AGENTS.md`](./AGENTS.md) | [`WEB.md`](./WEB.md) | [`PUZZLE.md`](./PUZZLE.md) | [`APP.md`](./APP.md) | [`CLOUD.md`](./CLOUD.md) | [`TESTING.md`](./TESTING.md) | [`CHANGELOG.md`](./CHANGELOG.md)

---

## Sprint 1 Priority 0: `v3.0.1` Critical Bugfixes (`BUG-1`--`BUG-3`)

Total Sprint 1 scope: `~42k tokens` (`~21--31 min agent`). Delete each item here once its fix is merged to Production `main`.

### BUG-1: Co-op Welcome Session Persistence & Replay Rewind `UNFILL` Sync

- **Status**: `Staged on beta (#484 / #485) -- Pending Production Merge & Human QA`
- **Action**: Persist `StorageService.saveActiveState(...)` inside `ProviderRegistry.realtimeRoom.onWelcomeState`, broadcast `'UNFILL'` for `undoneRegionIds` inside `handleResumeFromReplayStep` ([`App.tsx`](./web/src/App.tsx)), and verify with a 2-peer `BroadcastChannel` Replay Scrubber rewind test in [`web/scripts/test.mjs`](./web/scripts/test.mjs).
- **Value**: Prevents joining Co-op peers from losing synced progress on reload before painting, and keeps collaborator canvases synchronized on timeline rewind.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Bug` `[quick-win]` | `EPIC-2` ([Milestone #2](https://github.com/shthed/capy/milestone/2)) | `priority: critical` | `domain: multiplayer, storage, testing`
- **Model & Estimate**: `Gemini 4 Argon` | `~16,000 tokens` (`~8--12 min agent`)
- **Target Files**: [`web/src/App.tsx`](./web/src/App.tsx), [`web/scripts/test.mjs`](./web/scripts/test.mjs), [`TESTING.md`](./TESTING.md)
- **Acceptance Criteria**:
  - Reloading a peer tab immediately after receiving `WELCOME_STATE` retains all merged regions in `capy_active_session_v8`.
  - 2-peer Playwright `BroadcastChannel` E2E test verifies that scrubbing backward and clicking `Resume Here` un-fills rewound regions on both peers' canvases.

</details>

### BUG-2: CI Cloud Variable Injection & Fast `< 2s` Sanity Gate

- **Status**: `Staged on beta (#485) -- Pending Production Merge`
- **Action**: Bind `vars.VITE_GOOGLE_CLIENT_ID` and `vars.CAPY_PLAY_GAMES_APP_ID` in [`.github/workflows/deploy-branch.yml`](./.github/workflows/deploy-branch.yml), add `web/scripts/sanity.mjs` (`npm run test:sanity`), and run it during `Build & typecheck web app`.
- **Value**: Ensures configured cloud variables reach Web/Android builds and validates SemVer, `CHANGELOG.md`, and markdown hygiene in `< 2s` without launching Chromium.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Bug` `[quick-win]` | `EPIC-2` ([Milestone #2](https://github.com/shthed/capy/milestone/2)) | `priority: high` | `domain: ci, testing`
- **Model & Estimate**: `Gemini 3.8 Flash` or `Gemini 4 Argon` | `~14,000 tokens` (`~7--10 min agent`)
- **Target Files**: [`.github/workflows/deploy-branch.yml`](./.github/workflows/deploy-branch.yml), `web/scripts/sanity.mjs`, [`web/package.json`](./web/package.json), [`TESTING.md`](./TESTING.md), [`CLOUD.md`](./CLOUD.md)
- **Acceptance Criteria**:
  - `npm run test:sanity` completes in `< 2s` with zero browser startup, verifying `APP_VERSION` / `APP_VERSION_CODE`, `CHANGELOG.md` formatting, relative `.md` links, and zero emojis/box-drawing characters.
  - `deploy-branch.yml` builds cleanly when `vars.VITE_GOOGLE_CLIENT_ID` and `vars.CAPY_PLAY_GAMES_APP_ID` are unset (empty-string fallback) and injects them when set.

</details>

### BUG-3: Android WebView Pause / Resume Lifecycle Guard in `MainActivity.kt`

- **Status**: `Staged on beta (#484 / #485) -- Pending Production Merge & Human QA`
- **Action**: Override `onPause()` and `onResume()` in [`MainActivity.kt`](./app/src/main/java/com/capypaint/capy/MainActivity.kt) calling `webView?.onPause()` / `webView?.onResume()`, with unit verification in [`CapyAndroidBridgeTest.kt`](./app/src/test/java/com/capypaint/capy/CapyAndroidBridgeTest.kt) and lifecycle docs in [`APP.md`](./APP.md).
- **Value**: Suspends WebView rendering, `requestAnimationFrame` loops, and Web Audio cleanly when Android backgrounds the app or locks the screen.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Bug` `[quick-win]` | `EPIC-2` ([Milestone #2](https://github.com/shthed/capy/milestone/2)) | `priority: high` | `domain: android`
- **Model & Estimate**: `Gemini 3.8 Flash` or `Gemini 4 Argon` | `~12,000 tokens` (`~6--9 min agent`)
- **Target Files**: [`app/src/main/java/com/capypaint/capy/MainActivity.kt`](./app/src/main/java/com/capypaint/capy/MainActivity.kt), [`app/src/test/java/com/capypaint/capy/CapyAndroidBridgeTest.kt`](./app/src/test/java/com/capypaint/capy/CapyAndroidBridgeTest.kt), [`APP.md`](./APP.md)
- **Acceptance Criteria**:
  - `./gradlew app:testDebugUnitTest` and `./gradlew app:assembleDebug` pass cleanly (locally or via GitHub Actions `Build & Test`), and foreground resume restores responsive canvas input and audio playback.

</details>
