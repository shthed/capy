# Capy Active Sprint Backlog -- Ready-for-Dev Tasks (`TODO.md`)

Focused **Sprint 1 Execution Queue** ([Milestone #2](https://github.com/shthed/capy/milestone/2) | `EPIC-2` Tracking Issue [#477](https://github.com/shthed/capy/issues/477)) for the **Capy** monorepo ([`web/`](./web/) and [`app/`](./app/)). Only unblocked, codebase-verified `BUG-*` and `TASK-*` `1-PR` slices approved for immediate development enter `TODO.md`, and all daily feature/bugfix PRs branch from and target **`beta`** (`--base beta`, deploying to `https://shthed.github.io/capy/beta/`) so live production players on `main` are never disrupted. Strategic Epics (`EPIC-3`--`EPIC-5`), future User Stories, external dependency gates, Platform Icebox (`ICE-*`), and shipped milestones live in [`ROADMAP.md`](./ROADMAP.md) (full workflow in [`DEV.md`](./DEV.md#capy-lean-agile-backlog--todomd-entry-standard)).

**Related Guides**: [`README.md`](./README.md) | [`ROADMAP.md`](./ROADMAP.md) | [`DEV.md`](./DEV.md) | [`AGENTS.md`](./AGENTS.md) | [`WEB.md`](./WEB.md) | [`PUZZLE.md`](./PUZZLE.md) | [`APP.md`](./APP.md) | [`CLOUD.md`](./CLOUD.md) | [`TESTING.md`](./TESTING.md) | [`CHANGELOG.md`](./CHANGELOG.md)

**Table of Contents**:
1. [Quick-Win Ready Queue (`<= 15 min` Agent / `3.8 Flash` or `Argon`)](#1-quick-win-ready-queue--15-min-agent--38-flash-or-argon)
2. [Sprint 1 Priority 0: Verified Codebase, Lifecycle & CI Hygiene Bugs (`BUG-1`--`BUG-3`)](#2-sprint-1-priority-0-verified-codebase-lifecycle--ci-hygiene-bugs-bug-1--bug-3)
3. [Sprint 1 Feature Tasks: `EPIC-2` Mobile Touch Precision & Tactile Sensory Polish](#3-sprint-1-feature-tasks-epic-2-mobile-touch-precision--tactile-sensory-polish)

<details>
<summary>Sprint 1 Entry Gate, Hybrid Execution Rules & Totals</summary>

- **Strict Ready-for-Dev Gate**:
  - A task enters `TODO.md` **only** when it has zero external backend/credential blockers, verified source file/symbol names against `beta`/`main`, and deterministic acceptance criteria testable via `npm test` or `./gradlew app:testDebugUnitTest`.
  - Future Epics (`EPIC-3` [#478](https://github.com/shthed/capy/issues/478), `EPIC-4` [#479](https://github.com/shthed/capy/issues/479)), externally blocked cloud/AI stories (`EPIC-5` [#480](https://github.com/shthed/capy/issues/480)), and `ICE-*` remain in [`ROADMAP.md`](./ROADMAP.md) until promoted at sprint replenishment.
- **Hybrid Automated Sprint Execution (`feature/* -> beta -> main`)**:
  - **Single-Task Chat (`1-Task = 1-PR` -> `beta`)**: Pick one `BUG-*` or `TASK-*` item in a fresh `#NNN` chat branched off `origin/beta`, run full local verification (`npm run lint && npm run build && npm test`), open the PR with `--base beta` + Sprint 1 Milestone + `epic:*` label, and wait for human merge approval.
  - **Automated Story / Sprint-Slice Run (`/goal` or `/swarm` -> `beta`)**: Execute a cohesive multi-task story (e.g., `BUG-1`--`BUG-3` or `US-2.1`) onto an `automation/sprint-*` or `feature/*` branch off `origin/beta` using atomic per-task commits, verify the full Playwright + JUnit4 suite locally in the Antigravity VM, and open one PR targeting `beta` for human merge approval.
- **Definition of Done (Immediate Deletion & Epic Issue Sync)**:
  - Never leave `[x]` checkboxes in `TODO.md`. Delete finished `BUG-*` / `TASK-*` items (and their Section 1 pointers) in the same PR that ships them, check off the shipped item on its parent GitHub Epic Tracking Issue (`#477`), and when a Story's final task ships, archive that Story into the collapsed **Shipped Epics & Stories** `<details>` section at the bottom of [`ROADMAP.md`](./ROADMAP.md).
- **Sprint 1 Rollup (`8` Ready `1-PR` Slices: `3` `[quick-win]` Bugs + `5` `EPIC-2` Tasks)**:
  - **Priority 0 Bugs (`BUG-1`--`BUG-3`)**: `~44k tokens` | `~22--32 min agent` (`~5--8 hrs human`).
  - **`EPIC-2` Remaining Tasks (`US-2.1`, `US-2.3`, `US-2.4`)**: `~104k tokens` | `~48--69 min agent` (`~12.5--17.5 hrs human`).
  - **Sprint 1 Active Total**: `~148k tokens` | `~1.2--1.7 hrs agent` (`~17.5--25.5 hrs human`).

</details>

---

## 1. Quick-Win Ready Queue (`<= 15 min` Agent / `3.8 Flash` or `Argon`)

Self-contained Sprint 1 `1-PR` slices (`1--3` files, zero external dependencies) ready for immediate single-pass execution:

1. **`BUG-1`** ([Section 2](#bug-1-co-op-welcome-session-persistence--replay-rewind-unfill-sync)): Persist `StorageService.saveActiveState` on Co-op `WELCOME_STATE`, emit `'UNFILL'` on Replay Scrubber rewind, and add 2-peer `UNFILL` E2E coverage.
2. **`BUG-2`** ([Section 2](#bug-2-ci-cloud-variable-injection--fast--2s-sanity-gate)): Wire `vars.VITE_GOOGLE_CLIENT_ID` & `vars.CAPY_PLAY_GAMES_APP_ID` in `deploy-branch.yml` and add a `< 2s` `npm run test:sanity` check.
3. **`BUG-3`** ([Section 2](#bug-3-android-webview-pause--resume-lifecycle-guard-in-mainactivitykt)): Override `onPause()` / `onResume()` in `MainActivity.kt` calling `webView?.onPause()` / `webView?.onResume()` to suspend background timers and audio cleanly.
4. **`TASK-2.1b`** ([`US-2.1`](#us-21-floating-precision-loupe-magnifier-for-micro-regions)): Add `showMagnifierLoupe: boolean` setting toggle in `SettingsModal.tsx` Controls and Playwright E2E touch-hold verification *(after `TASK-2.1a`)*.
5. **`TASK-2.3b`** ([`US-2.3`](#us-23-zero-asset-procedural-asmr-web-audio-engine-melodic-layer)): Layer rising pentatonic Paint Mode streak notes, swatch-clear arpeggios, and 100% puzzle completion chimes into `SoundService.ts`.

---

## 2. Sprint 1 Priority 0: Verified Codebase, Lifecycle & CI Hygiene Bugs (`BUG-1`--`BUG-3`)

### BUG-1: Co-op Welcome Session Persistence & Replay Rewind `UNFILL` Sync

- **Description**: Fix two Co-op state-synchronization gaps in [`App.tsx`](./web/src/App.tsx): (1) `onWelcomeState` (`#L2859`) updates snapshot progress on join but omits `StorageService.saveActiveState(...)`, and (2) `handleResumeFromReplayStep` (`#L1514`) rewinds `undoneRegionIds` locally when clicking **Resume Here** on the Replay Scrubber without calling `emitCoopPaint('UNFILL', undoneRegionIds)`.
- **Value**: Prevents joining Co-op peers from losing synced progress if they reload before painting a region, and keeps collaborator canvases 100% consistent after a timeline rewind.
- **Why Now**: Verified defects in existing Co-op code with zero external dependencies; fixing them also completes the missing 2-peer initial-fill `UNFILL` E2E test coverage in `web/scripts/test.mjs`.
- **Tasks**:
  - **BUG-1** `[quick-win]`: Persist `StorageService.saveActiveState` inside `onWelcomeState`, broadcast `emitCoopPaint('UNFILL', Array.from(undoneRegionIds))` inside `handleResumeFromReplayStep`, and add a 2-peer `BroadcastChannel` initial-fill `UNFILL` + replay-rewind assertion in `web/scripts/test.mjs`.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Bug` | `Sprint 1 P0` | `priority: critical` | `domain: multiplayer, storage, testing`
- **Complexity & Model**: `low` / `moderate` | **Recommended Model**: `Gemini 4 Argon`
- **Effort Estimate**: `~18,000 tokens` | `~9--13 min agent` (`~2--3 hrs human`)
- **Target Files**: [`web/src/App.tsx`](./web/src/App.tsx), [`web/scripts/test.mjs`](./web/scripts/test.mjs), [`TESTING.md`](./TESTING.md)
- **Acceptance Criteria**:
  - Reloading a peer tab immediately after receiving `WELCOME_STATE` retains all merged regions in `capy_active_session_v8`.
  - 2-peer Playwright `BroadcastChannel` E2E test verifies both single-step initial-fill Undo (`UNFILL`) and Replay Scrubber `Resume Here` rewind across peers.

</details>

### BUG-2: CI Cloud Variable Injection & Fast `< 2s` Sanity Gate

- **Description**: Wire `VITE_GOOGLE_CLIENT_ID` and `CAPY_PLAY_GAMES_APP_ID` from GitHub Repository Variables (`vars.*`) into [`.github/workflows/deploy-branch.yml`](./.github/workflows/deploy-branch.yml) (matching [`CLOUD.md`](./CLOUD.md) documentation), and add a sub-2-second `npm run test:sanity` Node check (`version.ts`, `CHANGELOG.md` contract, markdown relative links, and zero-emoji/box-drawing guard) to `deploy-branch.yml` without launching Playwright Chromium in CI.
- **Value**: Ensures repository cloud variables actually reach Web and Android builds when configured, and gives GitHub Actions an instant `< 2s` hygiene/changelog sanity check on code PRs without slowing down preview deployments.
- **Why Now**: Prepares CI for automated `/goal` and `/swarm` sprints while keeping full Playwright browser E2E inside the Antigravity VM so PR previews stay fast.
- **Tasks**:
  - **BUG-2** `[quick-win]`: Add `env:` bindings for `vars.VITE_GOOGLE_CLIENT_ID` and `vars.CAPY_PLAY_GAMES_APP_ID` in `deploy-branch.yml`, create `web/scripts/sanity.mjs` (`npm run test:sanity`), and invoke it during the `Build & typecheck web app` CI step.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Bug` | `Sprint 1 P0` | `priority: high` | `domain: ci, testing`
- **Complexity & Model**: `low` / `easy` | **Recommended Model**: `Gemini 3.8 Flash` or `Gemini 4 Argon`
- **Effort Estimate**: `~14,000 tokens` | `~7--10 min agent` (`~1.5--2.5 hrs human`)
- **Target Files**: [`.github/workflows/deploy-branch.yml`](./.github/workflows/deploy-branch.yml), `web/scripts/sanity.mjs`, [`web/package.json`](./web/package.json), [`TESTING.md`](./TESTING.md), [`CLOUD.md`](./CLOUD.md)
- **Acceptance Criteria**:
  - `npm run test:sanity` completes in `< 2s` with zero browser startup, verifying `APP_VERSION` / `APP_VERSION_CODE`, `CHANGELOG.md` formatting, relative `.md` links, and zero emojis/box-drawing characters.
  - `deploy-branch.yml` builds cleanly when `vars.VITE_GOOGLE_CLIENT_ID` and `vars.CAPY_PLAY_GAMES_APP_ID` are unset (empty-string fallback) and injects them when set.

</details>

### BUG-3: Android WebView Pause / Resume Lifecycle Guard in `MainActivity.kt`

- **Description**: Override `onPause()` and `onResume()` in [`MainActivity.kt`](./app/src/main/java/com/capypaint/capy/MainActivity.kt) (`#L632`) to call `webView?.onPause()` and `webView?.onResume()` alongside unit verification in `CapyAndroidBridgeTest.kt`.
- **Value**: Guarantees Android WebView rendering, `requestAnimationFrame` loops, and Web Audio (`SoundService.ts`, shipped in `#472`) suspend cleanly at the native OS layer whenever the app is backgrounded or the screen locks.
- **Why Now**: `SoundService.ts` is now active in production (`v2.5.9`), and upcoming `EPIC-2` canvas animations (`US-2.1`, `US-2.4`) rely on strict zero-battery drain when backgrounded on Android.
- **Tasks**:
  - **BUG-3** `[quick-win]`: Add `onPause()` / `onResume()` WebView lifecycle forwarding in `MainActivity.kt` and update `APP.md` lifecycle documentation.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Bug` | `Sprint 1 P0` | `priority: high` | `domain: android`
- **Complexity & Model**: `low` / `easy` | **Recommended Model**: `Gemini 3.8 Flash` or `Gemini 4 Argon`
- **Effort Estimate**: `~12,000 tokens` | `~6--9 min agent` (`~1.5--2.5 hrs human`)
- **Target Files**: [`app/src/main/java/com/capypaint/capy/MainActivity.kt`](./app/src/main/java/com/capypaint/capy/MainActivity.kt), [`app/src/test/java/com/capypaint/capy/CapyAndroidBridgeTest.kt`](./app/src/test/java/com/capypaint/capy/CapyAndroidBridgeTest.kt), [`APP.md`](./APP.md)
- **Acceptance Criteria**:
  - `./gradlew app:testDebugUnitTest` and `./gradlew app:assembleDebug` pass cleanly (locally or via GitHub Actions `Build & Test`), and foreground resume restores responsive canvas input and audio playback.

</details>

---

## 3. Sprint 1 Feature Tasks: `EPIC-2` Mobile Touch Precision & Tactile Sensory Polish

**Sprint 1 Feature Goal**: Finish `EPIC-2` ([`ROADMAP.md`](./ROADMAP.md#1-epic-2-mobile-touch-precision--tactile-sensory-polish-active-in-sprint-1)) so mobile micro-region targeting, melodic ASMR audio, and region fill blooms feel effortless and tactile.

### US-2.1: Floating Precision Loupe Magnifier for Micro-Regions

- **Description**: Render an optional floating circular magnifier lens (`showMagnifierLoupe`) offset `72px` above the active finger during press-and-hold or Paint Mode drags on [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx).
- **Value**: Eliminates mobile "fat-finger" occlusion so players can target tiny `< 50px` micro-regions accurately without constantly zooming to `12x` and back out.
- **Why Now**: Highest-impact mobile touch usability upgrade remaining in `EPIC-2`.
- **Tasks**:
  - **TASK-2.1a**: Render a zero-allocation `2.5x` magnified `compositeCanvasRef` cutout + crosshair lens in `PuzzleCanvas.tsx` (flipping cleanly below/beside top HUD edges).
  - **TASK-2.1b** `[quick-win]`: Add `showMagnifierLoupe: boolean` setting toggle in `SettingsModal.tsx` Controls and Playwright E2E touch-hold verification.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | `EPIC-2` | `priority: critical` | `domain: canvas, ui`
- **Complexity & Model**: `high` / `hard` | **Recommended Model**: `Gemini 4 Carbon` (`2.1a` `/plan`), `Gemini 4 Argon` or `3.8 Flash` (`2.1b`)
- **Effort Estimate**: `~40,000 tokens` | `~18--26 min agent` (`~5--7 hrs human`)
- **Target Files**: [`web/src/components/PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx), [`web/src/components/SettingsModal.tsx`](./web/src/components/SettingsModal.tsx), [`web/src/services/StorageService.ts`](./web/src/services/StorageService.ts), [`web/src/types/index.ts`](./web/src/types/index.ts), [`WEB.md`](./WEB.md)
- **Acceptance Criteria**:
  - Reuses existing offscreen `compositeCanvasRef` via `ctx.drawImage` circular clip with zero per-frame `OffscreenCanvas` or heap object allocations inside `requestAnimationFrame`.
  - Automatically repositions when within `96px` of the top viewport edge so the lens is never clipped offscreen.

</details>

### US-2.3: Zero-Asset Procedural ASMR Web Audio Engine (Melodic Layer)

- **Description**: Extend [`SoundService.ts`](./web/src/services/SoundService.ts) (`#472`) with rising pentatonic Paint Mode streak notes, warm swatch-completion chord arpeggios, and 100% puzzle-completion chimes.
- **Value**: Rewards continuous Paint Mode streaks and color completions with warm, zero-asset procedural harmony that pairs with LRA haptics.
- **Why Now**: `SoundService.ts` woodblock taps and Settings volume controls are already live (`v2.5.9`); `TASK-2.3b` completes `US-2.3` in a single slice.
- **Tasks**:
  - **TASK-2.3b** `[quick-win]`: Layer harmonic pentatonic streak progression during Paint Mode drags, warm swatch-clear arpeggios, and 100% puzzle completion chimes into `SoundService.ts` and `App.tsx`.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | `EPIC-2` | `priority: critical` | `domain: audio, ui`
- **Complexity & Model**: `medium` / `moderate` | **Recommended Model**: `Gemini 4 Argon`
- **Effort Estimate**: `~22,000 tokens` | `~10--15 min agent` (`~2.5--3.5 hrs human`)
- **Target Files**: [`web/src/services/SoundService.ts`](./web/src/services/SoundService.ts), [`web/src/App.tsx`](./web/src/App.tsx), [`web/scripts/test.mjs`](./web/scripts/test.mjs), [`WEB.md`](./WEB.md)
- **Acceptance Criteria**:
  - Rising pentatonic streak index resets cleanly after gesture idle (`> 450ms`), and swatch/puzzle completion arpeggios respect `soundEnabled`, `soundVolume`, and `document.hidden` auto-suspend.
  - Archive `US-2.3` into the collapsed **Shipped Epics & Stories** section of [`ROADMAP.md`](./ROADMAP.md) when merged.

</details>

### US-2.4: Zero-Allocation Region Fill Bloom & Swatch Shimmer

- **Description**: Animate region fills with a `180ms` radial ink-bloom and highlight newly completed palette swatches with a `400ms` shimmer wave across matching regions in [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx).
- **Value**: Makes every region tap feel alive and gives clear visual celebration when finishing all regions of a color number without interrupting flow.
- **Why Now**: Completes `EPIC-2` and the core sensory triad (visual bloom + procedural sound + Android LRA haptics).
- **Tasks**:
  - **TASK-2.4a**: Create a pre-allocated typed-array fill-animation ring buffer (mirroring `CoopRippleBuffer.ts`) driving a `180ms` radial clip bloom in `PuzzleCanvas.tsx`.
  - **TASK-2.4b**: Trigger a `400ms` celebratory highlight pulse across completed-swatch centroids when a palette color reaches `0` remaining regions.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | `EPIC-2` | `priority: critical` | `domain: canvas`
- **Complexity & Model**: `high` / `hard` | **Recommended Model**: `Gemini 4 Carbon` (`2.4a`), `Gemini 4 Argon` (`2.4b`)
- **Effort Estimate**: `~42,000 tokens` | `~20--28 min agent` (`~5--7 hrs human`)
- **Target Files**: [`web/src/components/PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx), [`web/src/engine/CoopRippleBuffer.ts`](./web/src/engine/CoopRippleBuffer.ts), [`web/scripts/test.mjs`](./web/scripts/test.mjs), [`WEB.md`](./WEB.md)
- **Acceptance Criteria**:
  - Zero heap allocations (`Float32Array` / `Int32Array` fixed ring buffer) during `requestAnimationFrame`, returning to `0%` CPU idle once the `180ms` / `400ms` window expires.
  - Archive `US-2.4` (and `EPIC-2` once `US-2.1` + `US-2.3` are also merged) into the collapsed **Shipped Epics & Stories** section of [`ROADMAP.md`](./ROADMAP.md).

</details>
