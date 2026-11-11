# Capy Monorepo -- Master AAA Production Roadmap & Active Priorities (`TODO.md`)

This document tracks active cross-project bugfixes, production readiness milestones, effort estimates (LLM tokens and wall-clock implementation time), and unimplemented AAA features across the unified **Capy** monorepo ([`web/`](./web/) and [`app/`](./app/)).

**Related Guides**: [`README.md`](./README.md) | [`DEV.md`](./DEV.md) | [`AGENTS.md`](./AGENTS.md) | [`WEB.md`](./WEB.md) | [`PUZZLE.md`](./PUZZLE.md) | [`APP.md`](./APP.md) | [`CLOUD.md`](./CLOUD.md) | [`TESTING.md`](./TESTING.md) | [`CHANGELOG.md`](./CHANGELOG.md)

**Table of Contents**:
1. [Priority & Resource Estimation Overview](#1-priority--resource-estimation-overview)
2. [Label Taxonomy Reference](#2-label-taxonomy-reference)
3. [Compact Item-by-Item Estimation Index](#3-compact-item-by-item-estimation-index)
4. [Priority Bugfixes -- Documentation & Codebase Audit Findings (`BF-8`--`BF-11`)](#4-priority-bugfixes----documentation--codebase-audit-findings-bf-8--bf-11)
5. [Priority P0: AAA Sensory Polish, Tactile Audio & Precision Controls](#5-priority-p0-aaa-sensory-polish-tactile-audio--precision-controls)
6. [Priority P1: Player Progression, Daily Challenges, Accessibility & Video Export](#6-priority-p1-player-progression-daily-challenges-accessibility--video-export)
7. [Priority P2: Interactive Infinite Zoom Pyramid & Vector Print Exports](#7-priority-p2-interactive-infinite-zoom-pyramid--vector-print-exports)
8. [Priority P3: Real-Time Co-op Multiplayer & Cross-Device Sharing Infrastructure](#8-priority-p3-real-time-co-op-multiplayer--cross-device-sharing-infrastructure)
9. [Priority P4: Production Storefront Credentials, Cloud Providers & Live AI Catalog](#9-priority-p4-production-storefront-credentials-cloud-providers--live-ai-catalog)
10. [Priority P5: Multi-Platform Desktop (Steam / Tauri), iOS & Microsoft Store Packaging](#10-priority-p5-multi-platform-desktop-steam--tauri-ios--microsoft-store-packaging)

> [!NOTE]
> **Task & Mobile Hygiene Rule**: Do not leave completed items in `TODO.md`. When a task, bugfix, or milestone is finished, delete it from this file immediately rather than checking it off (`[x]`). Completed history is preserved in Git commits, pull request descriptions, and [`CHANGELOG.md`](./CHANGELOG.md). Never use unicode emojis, ASCII box-drawing art, or wide multi-column tables that overflow mobile viewports.

---

## 1. Priority & Resource Estimation Overview

> [!IMPORTANT]
> **Token & Time Estimation Methodology**:
> - **Estimated Tokens (`Est. Tokens`)**: Total LLM tokens (targeted context reads + reasoning + code edits + single-pass `npm run lint && npm run build && npm test` verification) for an autonomous coding agent.
> - **Estimated Time (`Est. Time`)**: Reported both as **Autonomous Agent Wall-Clock Time** and **Human Developer Equivalent Time**.

- **Audit Bugfixes (`BF-8`--`BF-11` -- 4 items)**:
  - *Focus*: E2E IndexedDB Eviction Test Accuracy, Replay Speed Grid UI, Atomic Android Disk Writes & Gradle Catalog Cleanup.
  - *Complexity / Difficulty*: Low | Easy to Moderate.
  - *Aggregate Effort*: `~56,000 tokens` | `~25--40 min agent` | `~4--7 hrs human`.
- **P0 -- Critical Polish (4 items)**:
  - *Focus*: Procedural ASMR Web Audio, Fill Micro-Animations, Precision Loupe & Pinch Sensitivity.
  - *Complexity / Difficulty*: Low to High | Moderate to Hard.
  - *Aggregate Effort*: `~145,000 tokens` | `~65--95 min agent` | `~16--24 hrs human`.
- **P1 -- Retention & Accessibility (4 items)**:
  - *Focus*: Achievements, Daily Featured Puzzle, Colorblind/Motion Accessibility & Video/GIF Export.
  - *Complexity / Difficulty*: Medium to High | Moderate to Hard.
  - *Aggregate Effort*: `~175,000 tokens` | `~80--115 min agent` | `~22--32 hrs human`.
- **P2 -- Engine & Infinite Zoom (3 items)**:
  - *Focus*: Focal-Point Quadtree Sub-Tile Navigation, Seam-Locked AI Inpainting & Printable SVG/PDF Export.
  - *Complexity / Difficulty*: Medium to High | Hard.
  - *Aggregate Effort*: `~130,000 tokens` | `~60--85 min agent` | `~18--26 hrs human`.
- **P3 -- Real-Time Multiplayer (4 items)**:
  - *Focus*: Co-op `UNFILL_EVENT` & Ping Beacon, Hosted WebSocket Relay, WebRTC P2P & Custom Photo Share Relay.
  - *Complexity / Difficulty*: Medium to Very High | Moderate to Expert.
  - *Aggregate Effort*: `~190,000 tokens` | `~90--130 min agent` | `~28--40 hrs human`.
- **P4 -- Cloud, Storefront & AI (4 items)**:
  - *Focus*: Play Console Credentials & `assetlinks.json`, AdMob UMP Rewarded SDK, Live AI Endpoint & Community Gallery Publisher.
  - *Complexity / Difficulty*: Low to High | Easy to Hard.
  - *Aggregate Effort*: `~155,000 tokens` | `~70--105 min agent` | `~20--30 hrs human`.
- **P5 -- Multi-Platform Expansion (3 items)**:
  - *Focus*: Steam Desktop (`Tauri`), iOS/iPadOS (`WKWebView`) & Microsoft Store / Xbox Wrappers.
  - *Complexity / Difficulty*: High to Very High | Hard to Expert.
  - *Aggregate Effort*: `~170,000 tokens` | `~80--115 min agent` | `~28--40 hrs human`.
- **Total Active Roadmap (26 items)**:
  - *Aggregate Effort*: **`~1,021,000 tokens`** | **`~7.8--11.4 hrs agent`** | **`~136--199 hrs human`**.

---

## 2. Label Taxonomy Reference

Every task in this roadmap is tagged across five standardized dimensions:

- **Priority (`priority:*`)**: `P0-fix`, `P0-critical`, `P1-high`, `P2-medium-high`, `P3-medium`, `P4-medium-low`, `P5-long-term`.
- **Work Type (`type:*`)**: `fix`, `feature`, `polish`, `infra`, `integration`, `testing`, `chore`.
- **Subsystem (`domain:*`)**: `canvas`, `ui`, `engine`, `audio`, `a11y`, `cloud`, `multiplayer`, `android`, `ai`, `export`, `testing`, `desktop`, `ios`.
- **Complexity (`complexity:*`)**: `low` (1--2 files, localized), `medium` (2--4 files, state + UI), `high` (4--7 files, cross-layer/worker), `very-high` (multi-package / native + web protocol).
- **Difficulty (`difficulty:*`)**: `easy` (straightforward logic), `moderate` (careful state/math invariance), `hard` (60 FPS zero-allocation math, WebAudio/WebCodecs, CRDTs), `expert` (distributed P2P signaling, native SDK bridges).

---

## 3. Compact Item-by-Item Estimation Index

- **`BF-8`** (*Stale IndexedDB Name in `BF-6` Eviction Test*): `P0-fix` | `testing` | `low` / `easy` | `~14k tok` (`6--10m` agent, `1--1.5h` human).
- **`BF-9`** (*Settings Replay Speed `grid-cols-5` Overflow*): `P0-fix` | `ui` | `low` / `easy` | `~12k tok` (`5--8m` agent, `0.5--1h` human).
- **`BF-10`** (*Atomic `.tmp` + Rename Android Disk Backups*): `P0-fix` | `android` | `low` / `moderate` | `~18k tok` (`8--12m` agent, `1.5--2.5h` human).
- **`BF-11`** (*Prune Orphaned `:app1` Compose Gradle Catalog Entries*): `P0-fix` | `android`, `chore` | `low` / `easy` | `~12k tok` (`5--10m` agent, `1--2h` human).
- **`P0-1`** (*Procedural Web Audio & ASMR Sound Engine*): `P0-critical` | `audio`, `ui` | `medium` / `moderate` | `~38k tok` (`18--25m` agent, `4--6h` human).
- **`P0-2`** (*Zero-Allocation Fill Micro-Animations & Bursts*): `P0-critical` | `canvas` | `high` / `hard` | `~42k tok` (`20--28m` agent, `5--7h` human).
- **`P0-3`** (*Floating Precision Loupe Magnifier & Offset*): `P0-critical` | `canvas`, `ui` | `high` / `hard` | `~40k tok` (`18--26m` agent, `5--7h` human).
- **`P0-4`** (*Pinch-to-Zoom Sensitivity & Scale Anchor Snapping*): `P0-critical` | `canvas`, `ui` | `low` / `moderate` | `~25k tok` (`10--16m` agent, `2--4h` human).
- **`P1-1`** (*In-App Achievements, Stats & Play/Steam Bridges*): `P1-high` | `ui`, `cloud`, `android` | `high` / `moderate` | `~50k tok` (`22--32m` agent, `6--9h` human).
- **`P1-2`** (*Daily Featured Puzzle Rotation & Streak Medals*): `P1-high` | `ui` | `medium` / `moderate` | `~35k tok` (`16--22m` agent, `4--6h` human).
- **`P1-3`** (*AAA Accessibility Suite: Patterns, Motion & Keys*): `P1-high` | `a11y`, `canvas`, `ui` | `high` / `hard` | `~45k tok` (`20--30m` agent, `6--8h` human).
- **`P1-4`** (*Replay Video `.webm`/`.mp4` & Animated GIF Export*): `P1-high` | `export`, `canvas` | `high` / `hard` | `~45k tok` (`22--30m` agent, `6--9h` human).
- **`P2-1`** (*Focal-Point Quadtree Sub-Tiles & Breadcrumbs*): `P2-medium-high` | `canvas`, `engine`, `ui` | `high` / `hard` | `~42k tok` (`20--28m` agent, `6--8h` human).
- **`P2-2`** (*AI Seam-Locked Detail Inpainting for Sub-Tiles*): `P2-medium-high` | `ai`, `engine` | `high` / `hard` | `~48k tok` (`22--32m` agent, `7--10h` human).
- **`P2-3`** (*Printable Vector SVG / PDF Coloring Sheet Exporter*): `P2-medium-high` | `export`, `engine` | `medium` / `hard` | `~40k tok` (`18--25m` agent, `5--8h` human).
- **`P3-1`** (*Co-op Initial-Fill `UNFILL_EVENT` & Ping Beacon*): `P3-medium` | `multiplayer`, `canvas` | `medium` / `moderate` | `~35k tok` (`16--24m` agent, `4--6h` human).
- **`P3-2`** (*Hosted Hibernating WebSocket Relay `VITE_CAPY_ROOM_WS_URL`*): `P3-medium` | `multiplayer`, `cloud` | `high` / `hard` | `~50k tok` (`25--35m` agent, `8--12h` human).
- **`P3-3`** (*WebRTC DataChannel P2P Upgrade & Photo Transfer*): `P3-medium` | `multiplayer` | `very-high` / `expert` | `~65k tok` (`30--45m` agent, `10--14h` human).
- **`P3-4`** (*Ephemeral Encrypted Cloud Blob Share Relay*): `P3-medium` | `cloud`, `multiplayer` | `medium` / `hard` | `~40k tok` (`18--26m` agent, `6--8h` human).
- **`P4-1`** (*Play Console Production Credentials & `assetlinks.json`*): `P4-medium-low` | `android`, `cloud` | `low` / `easy` | `~20k tok` (`10--15m` agent, `2--4h` human).
- **`P4-2`** (*Native Google UMP Consent + AdMob Rewarded SDK*): `P4-medium-low` | `android`, `ui` | `high` / `hard` | `~48k tok` (`22--32m` agent, `7--10h` human).
- **`P4-3`** (*Live In-App AI Artwork Endpoint `VITE_CAPY_AI_API_URL`*): `P4-medium-low` | `ai`, `ui` | `medium` / `moderate` | `~42k tok` (`18--28m` agent, `5--8h` human).
- **`P4-4`** (*Shared Community Backend & Automated `.capy` Publisher*): `P4-medium-low` | `cloud`, `engine` | `high` / `hard` | `~45k tok` (`20--30m` agent, `6--8h` human).
- **`P5-1`** (*Steam Desktop Wrapper `desktop/` & `SteamCloudDriver`*): `P5-long-term` | `desktop`, `cloud` | `very-high` / `expert` | `~60k tok` (`28--40m` agent, `10--14h` human).
- **`P5-2`** (*iOS & iPadOS Native Wrapper `ios/` & `AppleCloudDriver`*): `P5-long-term` | `ios`, `cloud` | `very-high` / `expert` | `~65k tok` (`30--45m` agent, `12--16h` human).
- **`P5-3`** (*Microsoft Store / Xbox Wrapper & `MicrosoftCloudDriver`*): `P5-long-term` | `desktop`, `cloud` | `high` / `hard` | `~45k tok` (`22--30m` agent, `6--10h` human).

---

## 4. Priority Bugfixes -- Documentation & Codebase Audit Findings (`BF-8`--`BF-11`)

- **BF-8: Stale IndexedDB Database Name (`'capy_puzzles_db'`) in `BF-6` Cache-Eviction E2E Test ([`web/scripts/test.mjs`](./web/scripts/test.mjs))**:
  - **Labels**: `[priority: P0-fix]` `[type: fix]` `[domain: testing]` `[complexity: low]` `[difficulty: easy]`
  - **Estimates**: `Est. Tokens: ~14,000 tokens` | `Est. Time: ~6--10 min agent (~1--1.5 hrs human dev)`
  - **Scope**: In [`web/scripts/test.mjs`](./web/scripts/test.mjs) (`#L946-L968`), the `BF-6` cache-eviction assertion calls `indexedDB.open('capy_puzzles_db')` (and references `'capy_images_v8'` in a comment), whereas [`StorageService.ts`](./web/src/services/StorageService.ts) (`#L22-L25`) stores all records inside `DB_NAME = 'capy_game_storage_v8'` (`STORE_PUZZLES = 'puzzles'`, `STORE_IMAGES = 'images'`). Because `'capy_puzzles_db'` contains no `'puzzles'` object store, `db.objectStoreNames.contains('puzzles')` returns `false` and resolves as a silent no-op, leaving the cached `CompactPuzzleRecordV2` intact in `'capy_game_storage_v8'` instead of exercising cold-start worker regeneration + `mergeCustomPalette`. Update `test.mjs` to open `'capy_game_storage_v8'`, delete `snapId` from `'puzzles'`, and assert that `puzzles` entry eviction triggers true regeneration while preserving `customPalette` and `isFreeColor`.
- **BF-9: Default Replay Speed Selector Grid Column Mismatch (`grid-cols-5` for 6 Options) ([`web/src/components/SettingsModal.tsx`](./web/src/components/SettingsModal.tsx))**:
  - **Labels**: `[priority: P0-fix]` `[type: fix]` `[domain: ui]` `[complexity: low]` `[difficulty: easy]`
  - **Estimates**: `Est. Tokens: ~12,000 tokens` | `Est. Time: ~5--8 min agent (~0.5--1 hr human dev)`
  - **Scope**: [`SettingsModal.tsx`](./web/src/components/SettingsModal.tsx) (`#L854`) renders `REPLAY_SPEED_OPTIONS` (`[0.5, 1, 2, 5, 10, 20]` from [`ReplayControls.tsx`](./web/src/components/ReplayControls.tsx) `#L18`) inside `<div className="grid grid-cols-5 gap-1.5">`. After `20x` was added as the 6th option, `20x` wraps onto a lonely second row. Update the container to `grid-cols-6` (or `grid-cols-3 sm:grid-cols-6` on ultra-narrow viewports) so all 6 speed options align cleanly.
- **BF-10: Non-Atomic `writeText` Disk Backup & Cloud Cache Writes on Android ([`app/src/main/java/com/capypaint/capy/CapyAndroidBridge.kt`](./app/src/main/java/com/capypaint/capy/CapyAndroidBridge.kt))**:
  - **Labels**: `[priority: P0-fix]` `[type: fix]` `[domain: android]` `[complexity: low]` `[difficulty: moderate]`
  - **Estimates**: `Est. Tokens: ~18,000 tokens` | `Est. Time: ~8--12 min agent (~1.5--2.5 hrs human dev)`
  - **Scope**: `CapyAndroidBridge.saveBackupToDir` (`#L286-L300`, shared by `saveBackup` and `saveCloudSnapshot`) writes UTF-8 JSON directly to `<sanitized_key>.json` via `targetFile.writeText(data, Charsets.UTF_8)`. If the Android process is killed mid-write (OOM, battery loss, or OS task eviction), the existing `.json` backup can be truncated into corrupt partial JSON. Write to `<sanitized_key>.json.tmp`, flush/fsync the `FileOutputStream` descriptor, and atomically replace `targetFile` (`Files.move(..., ATOMIC_MOVE, REPLACE_EXISTING)` with `renameTo` fallback), covered by unit tests in [`CapyAndroidBridgeTest.kt`](./app/src/test/java/com/capypaint/capy/CapyAndroidBridgeTest.kt).
- **BF-11: Orphaned `:app1` Jetpack Compose & Coil Entries in Gradle Version Catalog ([`gradle/libs.versions.toml`](./gradle/libs.versions.toml))**:
  - **Labels**: `[priority: P0-fix]` `[type: chore]` `[domain: android]` `[complexity: low]` `[difficulty: easy]`
  - **Estimates**: `Est. Tokens: ~12,000 tokens` | `Est. Time: ~5--10 min agent (~1--2 hrs human dev)`
  - **Scope**: [`settings.gradle.kts`](./settings.gradle.kts) includes only `:app` (the lightweight `ComponentActivity` + `WebViewAssetLoader` launcher), yet [`gradle/libs.versions.toml`](./gradle/libs.versions.toml) still defines unused Compose and Coil entries (`composeBom`, `coilCompose`, `androidx-activity-compose`, `androidx-compose-bom`, `androidx-ui*`, `androidx-material3`, `androidx-lifecycle-viewmodel-compose`, `coil-compose`, and plugin `kotlin-compose`) left over from the deleted `:app1` prototype. Remove unused catalog entries and verify `./gradlew app:testDebugUnitTest app:assembleDebug`.

---

## 5. Priority P0: AAA Sensory Polish, Tactile Audio & Precision Controls

- **P0-1: Procedural Web Audio & ASMR Sound Effects Engine (`web/src/services/SoundService.ts`)**:
  - **Labels**: `[priority: P0-critical]` `[type: feature]` `[domain: audio]` `[domain: ui]` `[complexity: medium]` `[difficulty: moderate]`
  - **Estimates**: `Est. Tokens: ~38,000 tokens` | `Est. Time: ~18--25 min agent (~4--6 hrs human dev)`
  - **Scope**:
    - Build a zero-asset, offline-first Web Audio API synthesizer generating soft brush/paper strokes on region tap, harmonic pentatonic marimba/woodblock pitch progression during continuous Paint Mode streaks, a warm chord arpeggio when all regions of a color swatch are completed, and a celebratory fanfare on 100% puzzle completion.
    - Add `soundEnabled: boolean` (default `true`) and `soundVolume: number` (`0.0` to `1.0`, default `0.7`) to `UserSettings` (`capy_user_settings_v8`) in [`web/src/types/index.ts`](./web/src/types/index.ts) and [`SettingsModal.tsx`](./web/src/components/SettingsModal.tsx), and automatically suspend/resume `AudioContext` on page visibility changes and Android activity pause/resume.
- **P0-2: Zero-Allocation Region Fill Micro-Animations & Swatch Completion Bursts (`PuzzleCanvas.tsx`)**:
  - **Labels**: `[priority: P0-critical]` `[type: polish]` `[domain: canvas]` `[complexity: high]` `[difficulty: hard]`
  - **Estimates**: `Est. Tokens: ~42,000 tokens` | `Est. Time: ~20--28 min agent (~5--7 hrs human dev)`
  - **Scope**:
    - Extend the demand-driven `requestAnimationFrame` overlay pass in [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx) using a pre-allocated typed ring buffer (mirroring [`CoopRippleBuffer.ts`](./web/src/engine/CoopRippleBuffer.ts)) to render a 180ms radial ink-spread / spring-bloom transition when a region is painted and a subtle shimmer wave across all regions of a newly completed palette color.
- **P0-3: Floating Precision Loupe Magnifier & Crosshair Offset for Tiny Micro-Regions**:
  - **Labels**: `[priority: P0-critical]` `[type: feature]` `[domain: canvas]` `[domain: ui]` `[complexity: high]` `[difficulty: hard]`
  - **Estimates**: `Est. Tokens: ~40,000 tokens` | `Est. Time: ~18--26 min agent (~5--7 hrs human dev)`
  - **Scope**:
    - Add an optional press-and-hold or Paint Mode floating magnifier lens (`showMagnifierLoupe: boolean` in `UserSettings`) offset 72px above the active touch point in [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx) so players on mobile screens can accurately target `< 50px` micro-regions without finger occlusion.
- **P0-4: Custom Pinch-to-Zoom Sensitivity & Scale Anchor Snapping (`1x`, `2x`, `4x`, `8x`)**:
  - **Labels**: `[priority: P0-critical]` `[type: polish]` `[domain: canvas]` `[domain: ui]` `[complexity: low]` `[difficulty: moderate]`
  - **Estimates**: `Est. Tokens: ~25,000 tokens` | `Est. Time: ~10--16 min agent (~2--4 hrs human dev)`
  - **Scope**:
    - Add configurable `zoomSensitivity: number` (`0.5x` to `2.0x`, default `1.0x`) and `snapZoomLevels: boolean` (optional magnetic detents at `1x`, `2x`, `4x`, `8x`, and `12x`) in [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx) and [`SettingsModal.tsx`](./web/src/components/SettingsModal.tsx).

---

## 6. Priority P1: Player Progression, Daily Challenges, Accessibility & Video Export

- **P1-1: In-App Achievement System, Player Statistics & Native Play Games / Steam Bridges**:
  - **Labels**: `[priority: P1-high]` `[type: feature]` `[domain: ui]` `[domain: cloud]` `[domain: android]` `[complexity: high]` `[difficulty: moderate]`
  - **Estimates**: `Est. Tokens: ~50,000 tokens` | `Est. Time: ~22--32 min agent (~6--9 hrs human dev)`
  - **Scope**:
    - Create `AchievementService.ts` tracking lifetime player telemetry (`totalRegionsColored`, `puzzlesCompleted`, `zeroHintPuzzles`, `fastestCompletionMs`, `freeColorCreations`, `coopRegionsPainted`, `currentDailyStreak`) persisted in `localStorage` and merged via CRDT in [`CloudProviderDrivers.ts`](./web/src/services/providers/CloudProviderDrivers.ts).
    - Render non-blocking achievement unlock toast banners and a dedicated **Profile & Achievements** drawer in [`SettingsModal.tsx`](./web/src/components/SettingsModal.tsx).
    - Define Play Console achievement and leaderboard IDs in `app/src/main/res/values/games-ids.xml` and expose `NativeBridge.unlockAchievement(id)`, `NativeBridge.incrementAchievement(id, steps)`, and `NativeBridge.submitLeaderboardScore(id, score)` in [`CapyAndroidBridge.kt`](./app/src/main/java/com/capypaint/capy/CapyAndroidBridge.kt) and [`NativeBridge.ts`](./web/src/services/NativeBridge.ts).
- **P1-2: Daily Featured Puzzle Rotation, Streak Calendar & Medal Tiers**:
  - **Labels**: `[priority: P1-high]` `[type: feature]` `[domain: ui]` `[complexity: medium]` `[difficulty: moderate]`
  - **Estimates**: `Est. Tokens: ~35,000 tokens` | `Est. Time: ~16--22 min agent (~4--6 hrs human dev)`
  - **Scope**:
    - Add a deterministic "Puzzle of the Day" card at the top of the **Create** tab in [`SettingsModal.tsx`](./web/src/components/SettingsModal.tsx) with a visual streak counter, optional relaxed vs. zero-hint challenge badges, and automatic completion recording.
- **P1-3: AAA Accessibility Suite (Colorblind Pattern Overlays, High-Contrast HUD & Reduced Motion)**:
  - **Labels**: `[priority: P1-high]` `[type: feature]` `[domain: a11y]` `[domain: canvas]` `[domain: ui]` `[complexity: high]` `[difficulty: hard]`
  - **Estimates**: `Est. Tokens: ~45,000 tokens` | `Est. Time: ~20--30 min agent (~6--8 hrs human dev)`
  - **Scope**:
    - Add a `colorblindPatternMode: boolean` setting that overlays distinct geometric textures (dots, diagonal stripes, crosshatch, checkerboard) onto active and hinted regions in [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx) so region guidance never relies solely on color perception.
    - Add `reducedMotion: boolean` (automatically respecting `prefers-reduced-motion: reduce`) to bypass confetti, camera zoom transitions, and pulsing hint animations, and add full keyboard arrow/WASD pan + `+`/`-` zoom + `1`--`9` swatch selection shortcuts.
- **P1-4: Replay Animation Video (`.webm` / `.mp4`) & Animated GIF Export**:
  - **Labels**: `[priority: P1-high]` `[type: feature]` `[domain: export]` `[domain: canvas]` `[complexity: high]` `[difficulty: hard]`
  - **Estimates**: `Est. Tokens: ~45,000 tokens` | `Est. Time: ~22--30 min agent (~6--9 hrs human dev)`
  - **Scope**:
    - Allow players to export their chronological puzzle completion replay directly from [`ReplayControls.tsx`](./web/src/components/ReplayControls.tsx) as a shareable high-resolution timelapse video (`HTMLCanvasElement.captureStream(60)` + `MediaRecorder` / WebCodecs) or animated image sequence via `NativeBridge.exportOrShareFile`.

---

## 7. Priority P2: Interactive Infinite Zoom Pyramid & Vector Print Exports

- **P2-1: Focal-Point Quadtree Sub-Tile Navigation & Parent Breadcrumb Stack**:
  - **Labels**: `[priority: P2-medium-high]` `[type: feature]` `[domain: canvas]` `[domain: engine]` `[domain: ui]` `[complexity: high]` `[difficulty: hard]`
  - **Estimates**: `Est. Tokens: ~42,000 tokens` | `Est. Time: ~20--28 min agent (~6--8 hrs human dev)`
  - **Scope**:
    - Extend the existing single-level 2x center-crop (`handleZoomIntoDetailTile` in [`App.tsx`](./web/src/App.tsx)) into a multi-level quadtree hierarchy where players zoom into the exact `(focusX, focusY)` viewport center they are inspecting on [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx) rather than a fixed center crop.
    - Persist `parentSnapshotId` and `subTileBounds` on `SavedSnapshot` and render a one-tap "Return to Parent Puzzle" breadcrumb pill in [`GameTopBar.tsx`](./web/src/components/GameTopBar.tsx) that seamlessly restores the parent puzzle viewport.
- **P2-2: AI Seam-Locked Detail Inpainting for Infinite Zoom Sub-Tiles**:
  - **Labels**: `[priority: P2-medium-high]` `[type: integration]` `[domain: ai]` `[domain: engine]` `[complexity: high]` `[difficulty: hard]`
  - **Estimates**: `Est. Tokens: ~48,000 tokens` | `Est. Time: ~22--32 min agent (~7--10 hrs human dev)`
  - **Scope**:
    - Wire [`DefaultAiArtworkAdapter.buildSeamLockedInfillPrompt`](./web/src/services/providers/ProviderRegistry.ts) to an image-to-image / outpainting model that synthesizes high-frequency micro-details (foliage, textures, tiny critters) inside zoomed sub-tiles while clamping outer border pixels to `lockedBoundaryPaletteHex` for invisible parent seams.
- **P2-3: Printable Vector SVG / PDF Coloring Sheet Exporter**:
  - **Labels**: `[priority: P2-medium-high]` `[type: feature]` `[domain: export]` `[domain: engine]` `[complexity: medium]` `[difficulty: hard]`
  - **Estimates**: `Est. Tokens: ~40,000 tokens` | `Est. Time: ~18--25 min agent (~5--8 hrs human dev)`
  - **Scope**:
    - Add an "Export Printable Line Art (SVG / PDF)" action in [`SettingsModal.tsx`](./web/src/components/SettingsModal.tsx) that traces `borderMap` and `region.centroidX`/`centroidY` labels into a crisp, resolution-independent SVG coloring page for physical printing.

---

## 8. Priority P3: Real-Time Co-op Multiplayer & Cross-Device Sharing Infrastructure

- **P3-1: Co-op Collaborator Undo Sync (`UNFILL_EVENT`) & Interactive "Ping Region" Beacon**:
  - **Labels**: `[priority: P3-medium]` `[type: feature]` `[domain: multiplayer]` `[domain: canvas]` `[complexity: medium]` `[difficulty: moderate]`
  - **Estimates**: `Est. Tokens: ~35,000 tokens` | `Est. Time: ~16--24 min agent (~4--6 hrs human dev)`
  - **Scope**:
    - Broadcast `UNFILL_EVENT` messages over [`HybridCoopRoomAdapter`](./web/src/services/providers/ProviderRegistry.ts) when a collaborator undoes a first-time region fill back to unfilled so all peer canvases stay strictly consistent during initial-fill undo.
    - Add a tap-and-hold "Ping Region" beacon on [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx) rendered via [`CoopRippleBuffer.ts`](./web/src/engine/CoopRippleBuffer.ts) so collaborators can highlight a tricky micro-region or call attention to a specific area on large puzzles.
- **P3-2: Hosted Hibernating WebSocket Room Relay Server (`VITE_CAPY_ROOM_WS_URL`)**:
  - **Labels**: `[priority: P3-medium]` `[type: infra]` `[domain: multiplayer]` `[domain: cloud]` `[complexity: high]` `[difficulty: hard]`
  - **Estimates**: `Est. Tokens: ~50,000 tokens` | `Est. Time: ~25--35 min agent (~8--12 hrs human dev)`
  - **Scope**:
    - Implement and deploy a lightweight hibernating WebSocket room relay (Cloudflare Worker + Durable Objects in a `relay/` workspace package) backing [`HybridCoopRoomAdapter`](./web/src/services/providers/ProviderRegistry.ts) so 6-character Co-op room codes (`?room=ABC123`) connect players across separate devices and networks over the internet.
- **P3-3: WebRTC DataChannel Peer-to-Peer Upgrade & Custom Photo Transfer in Co-op Rooms**:
  - **Labels**: `[priority: P3-medium]` `[type: feature]` `[domain: multiplayer]` `[complexity: very-high]` `[difficulty: expert]`
  - **Estimates**: `Est. Tokens: ~65,000 tokens` | `Est. Time: ~30--45 min agent (~10--14 hrs human dev)`
  - **Scope**:
    - Upgrade WebSocket room signaling to negotiate direct `RTCPeerConnection` / `RTCDataChannel` links between room participants so real-time `PAINT_EVENT` strokes and custom user-uploaded `.capy` v2 puzzle packs stream directly peer-to-peer without server storage overhead.
- **P3-4: Ephemeral Encrypted Cloud Blob Relay for Custom Photo Share Links (`#s=<token>`)**:
  - **Labels**: `[priority: P3-medium]` `[type: infra]` `[domain: cloud]` `[domain: multiplayer]` `[complexity: medium]` `[difficulty: hard]`
  - **Estimates**: `Est. Tokens: ~40,000 tokens` | `Est. Time: ~18--26 min agent (~6--8 hrs human dev)`
  - **Scope**:
    - Add an opt-in encrypted `.capy` v2 blob upload (content-addressed SHA-256 key with 30-day TTL in object storage) so players can share `#s=<token>` URL links for custom uploaded photos across devices just as seamlessly as built-in Gallery artworks.

---

## 9. Priority P4: Production Storefront Credentials, Cloud Providers & Live AI Catalog

- **P4-1: Google Play Console Production Credentials & Verified `assetlinks.json`**:
  - **Labels**: `[priority: P4-medium-low]` `[type: infra]` `[domain: android]` `[domain: cloud]` `[complexity: low]` `[difficulty: easy]`
  - **Estimates**: `Est. Tokens: ~20,000 tokens` | `Est. Time: ~10--15 min agent (~2--4 hrs human dev)`
  - **Scope**:
    - Provision the production 12-digit Play Games Project ID (`CAPY_PLAY_GAMES_APP_ID`) and Web OAuth Client ID (`VITE_GOOGLE_CLIENT_ID`), register Upload Key and Play App Signing SHA-1/SHA-256 certificate fingerprints in Google Play Console, and publish `web/public/.well-known/assetlinks.json` so `android:autoVerify="true"` App Links verify automatically on Android devices.
- **P4-2: Native Google UMP Consent + AdMob Rewarded Video SDK Integration (`app/`)**:
  - **Labels**: `[priority: P4-medium-low]` `[type: integration]` `[domain: android]` `[domain: ui]` `[complexity: high]` `[difficulty: hard]`
  - **Estimates**: `Est. Tokens: ~48,000 tokens` | `Est. Time: ~22--32 min agent (~7--10 hrs human dev)`
  - **Scope**:
    - Bundle `com.google.android.ump:user-messaging-platform` and `com.google.android.gms:play-services-ads` in [`app/build.gradle.kts`](./app/build.gradle.kts), wire GDPR/CCPA consent forms in [`MainActivity.kt`](./app/src/main/java/com/capypaint/capy/MainActivity.kt), and implement `CapyAndroidBridge.showRewardedAd()` with Server-Side Verification (SSV) callbacks to fund optional AI puzzle generation credits while keeping core coloring 100% ad-free.
- **P4-3: Live In-App AI Artwork Generation Endpoint (`VITE_CAPY_AI_API_URL`)**:
  - **Labels**: `[priority: P4-medium-low]` `[type: integration]` `[domain: ai]` `[domain: ui]` `[complexity: medium]` `[difficulty: moderate]`
  - **Estimates**: `Est. Tokens: ~42,000 tokens` | `Est. Time: ~18--28 min agent (~5--8 hrs human dev)`
  - **Scope**:
    - Connect [`DefaultAiArtworkAdapter`](./web/src/services/providers/ProviderRegistry.ts) to a live serverless image generation endpoint (Imagen 3 / Gemini / Flux) and add a "Generate Custom AI Puzzle from Prompt" workflow in the Create tab that spends verified `AiCreditLedger` credits and feeds the generated illustration directly into `puzzle.worker.ts`.
- **P4-4: Shared Multi-User Backend & Automated `.capy` v2 Gallery Publisher for Community Ideas**:
  - **Labels**: `[priority: P4-medium-low]` `[type: infra]` `[domain: cloud]` `[domain: engine]` `[complexity: high]` `[difficulty: hard]`
  - **Estimates**: `Est. Tokens: ~45,000 tokens` | `Est. Time: ~20--30 min agent (~6--8 hrs human dev)`
  - **Scope**:
    - Connect `StaticAndCommunityCatalogAdapter` (`capy_community_ideas_v1`) to a rate-limited, moderated backend API so player-submitted ideas and upvotes sync globally, paired with a scheduled GitHub Actions workflow that pre-bakes top-voted ideas into `.capy` v2 packs (`catalog/v1/index.json`).

---

## 10. Priority P5: Multi-Platform Desktop (Steam / Tauri), iOS & Microsoft Store Packaging

- **P5-1: Steam Desktop Wrapper (`desktop/`) & `SteamCloudDriver` Bindings**:
  - **Labels**: `[priority: P5-long-term]` `[type: integration]` `[domain: desktop]` `[domain: cloud]` `[complexity: very-high]` `[difficulty: expert]`
  - **Estimates**: `Est. Tokens: ~60,000 tokens` | `Est. Time: ~28--40 min agent (~10--14 hrs human dev)`
  - **Scope**:
    - Scaffold a Tauri v2 desktop wrapper (`desktop/`) hosting `web/dist/` with `steamworks-rs` adapters wired to [`SteamCloudDriver`](./web/src/services/providers/CloudProviderDrivers.ts) (`ISteamRemoteStorage` Cloud Saves, Steam Achievements, Steam Overlay, and Rich Presence).
- **P5-2: iOS & iPadOS Native Wrapper (`ios/`) & `AppleCloudDriver` Bindings**:
  - **Labels**: `[priority: P5-long-term]` `[type: integration]` `[domain: ios]` `[domain: cloud]` `[complexity: very-high]` `[difficulty: expert]`
  - **Estimates**: `Est. Tokens: ~65,000 tokens` | `Est. Time: ~30--45 min agent (~12--16 hrs human dev)`
  - **Scope**:
    - Scaffold a Swift `WKWebView` iOS/iPadOS wrapper connected to `window.webkit.messageHandlers.CapyIOS` and [`AppleCloudDriver`](./web/src/services/providers/CloudProviderDrivers.ts), supporting Apple Pencil hover/pressure, CoreHaptics, Sign in with Apple / GameKit (`GKLocalPlayer`), and CloudKit `privateCloudDatabase` save sync.
- **P5-3: Microsoft Store / Xbox Wrapper & `MicrosoftCloudDriver` Bindings**:
  - **Labels**: `[priority: P5-long-term]` `[type: integration]` `[domain: desktop]` `[domain: cloud]` `[complexity: high]` `[difficulty: hard]`
  - **Estimates**: `Est. Tokens: ~45,000 tokens` | `Est. Time: ~22--30 min agent (~6--10 hrs human dev)`
  - **Scope**:
    - Connect [`MicrosoftCloudDriver`](./web/src/services/providers/CloudProviderDrivers.ts) to live Microsoft Entra ID / MSA OAuth 2.0 PKCE credentials for OneDrive `special/approot` and Xbox Connected Storage synchronization.
