# Capy Monorepo -- Master AAA Production Roadmap & Active Priorities (`TODO.md`)

This document tracks active cross-project bugfixes, easy-win subtasks, production readiness milestones, effort estimates (LLM tokens and wall-clock implementation time), and unimplemented AAA features across the unified **Capy** monorepo ([`web/`](./web/) and [`app/`](./app/)).

**Related Guides**: [`README.md`](./README.md) | [`DEV.md`](./DEV.md) | [`AGENTS.md`](./AGENTS.md) | [`WEB.md`](./WEB.md) | [`PUZZLE.md`](./PUZZLE.md) | [`APP.md`](./APP.md) | [`CLOUD.md`](./CLOUD.md) | [`TESTING.md`](./TESTING.md) | [`CHANGELOG.md`](./CHANGELOG.md)

**Table of Contents**:
1. [Priority & Resource Estimation Overview](#1-priority--resource-estimation-overview)
2. [Label Taxonomy & Sequencing Rationale](#2-label-taxonomy--sequencing-rationale)
3. [Compact Item-by-Item Estimation Index](#3-compact-item-by-item-estimation-index)
4. [Easy-Win Fast-Track Queue (`<= 15 min` Agent / `Flash`-Ready)](#4-easy-win-fast-track-queue--15-min-agent--flash-ready)
5. [Priority Bugfixes -- Documentation & Codebase Audit Findings (`BF-8`--`BF-11`)](#5-priority-bugfixes----documentation--codebase-audit-findings-bf-8--bf-11)
6. [Priority P0: Mobile Precision Controls & AAA Sensory Polish](#6-priority-p0-mobile-precision-controls--aaa-sensory-polish)
7. [Priority P1: Zero-Backend Retention, Accessibility & Replay Export](#7-priority-p1-zero-backend-retention-accessibility--replay-export)
8. [Priority P2: Serverless Infinite Zoom, Printable Exports & Local Co-op Polish](#8-priority-p2-serverless-infinite-zoom-printable-exports--local-co-op-polish)
9. [Priority P3: Storefront Credentials & Cross-Network Co-op / Share Relays](#9-priority-p3-storefront-credentials--cross-network-co-op--share-relays)
10. [Priority P4: Live AI Endpoints, Community Backend & Opt-In Monetization](#10-priority-p4-live-ai-endpoints-community-backend--opt-in-monetization)
11. [Priority P5: Multi-Platform Desktop (Steam / Tauri), iOS & Microsoft Store Packaging](#11-priority-p5-multi-platform-desktop-steam--tauri-ios--microsoft-store-packaging)

> [!NOTE]
> **Task & Subtask Hygiene Rule**: Do not leave completed items or completed subtasks in `TODO.md`. Whenever a parent item or individual subtask (such as `BF-8` or `P1-2a`) ships, delete it from both Section 4 and its parent section immediately rather than checking it off (`[x]`), and update remaining parent estimates accordingly. Completed history is preserved in Git commits, pull request descriptions, and [`CHANGELOG.md`](./CHANGELOG.md). Never use unicode emojis, ASCII box-drawing art, or wide multi-column tables that overflow mobile viewports.

---

## 1. Priority & Resource Estimation Overview

> [!IMPORTANT]
> **Token & Time Estimation Methodology**:
> - **Estimated Tokens (`Est. Tokens`)**: Total LLM tokens (targeted context reads + reasoning + code edits + single-pass `npm run lint && npm run build && npm test` verification) for an autonomous coding agent.
> - **Estimated Time (`Est. Time`)**: Reported both as **Autonomous Agent Wall-Clock Time** and **Human Developer Equivalent Time**.

- **Audit Bugfixes (`BF-8`--`BF-11` -- 4 items, all `[easy-win]`)**:
  - *Focus*: E2E IndexedDB Eviction Test Accuracy, Replay Speed Grid UI, Atomic Android Disk Writes & Gradle Catalog Cleanup.
  - *Complexity / Difficulty*: Low | Easy to Moderate.
  - *Aggregate Effort*: `~56,000 tokens` | `~25--40 min agent` | `~4--7 hrs human`.
- **P0 -- Mobile Precision Controls & Sensory Polish (4 items, 3 `[easy-win]` subtasks)**:
  - *Focus*: Precision Loupe Magnifier, Pinch Sensitivity & Scale Snapping, Procedural ASMR Web Audio & Zero-GC Fill Micro-Animations.
  - *Complexity / Difficulty*: Low to High | Moderate to Hard.
  - *Aggregate Effort*: `~145,000 tokens` | `~65--95 min agent` | `~16--24 hrs human`.
- **P1 -- Zero-Backend Retention, Accessibility & Replay Export (4 items, 4 `[easy-win]` subtasks)**:
  - *Focus*: Daily Featured Puzzle & Streaks, Colorblind/Motion/Keyboard Accessibility, Replay Video Export & Local Stats/Achievements.
  - *Complexity / Difficulty*: Medium to High | Moderate to Hard.
  - *Aggregate Effort*: `~175,000 tokens` | `~80--115 min agent` | `~22--32 hrs human`.
- **P2 -- Serverless Infinite Zoom, Print Exports & Local Co-op Polish (3 items, 3 `[easy-win]` subtasks)**:
  - *Focus*: Focal-Point Quadtree Sub-Tiles & Breadcrumbs, Printable Vector SVG/PDF Sheets & Co-op `UNFILL_EVENT` / Ping Beacon.
  - *Complexity / Difficulty*: Medium to High | Moderate to Hard.
  - *Aggregate Effort*: `~117,000 tokens` | `~54--77 min agent` | `~15--22 hrs human`.
- **P3 -- Storefront Credentials & Cross-Network Relays (4 items, 1 `[easy-win]` subtask)**:
  - *Focus*: Play Console / OAuth Credentials & `assetlinks.json`, WebSocket Room Relay, Encrypted Share Blob Relay & WebRTC P2P.
  - *Complexity / Difficulty*: Low to Very High | Easy to Expert.
  - *Aggregate Effort*: `~175,000 tokens` | `~83--121 min agent` | `~26--38 hrs human`.
- **P4 -- Live AI Endpoints, Community Backend & Monetization (4 items)**:
  - *Focus*: Live AI Artwork Endpoint, Seam-Locked Sub-Tile AI Inpainting, Community Gallery Backend & AdMob UMP Rewarded SDK.
  - *Complexity / Difficulty*: Medium to High | Moderate to Hard.
  - *Aggregate Effort*: `~183,000 tokens` | `~82--122 min agent` | `~25--36 hrs human`.
- **P5 -- Multi-Platform Expansion (3 items)**:
  - *Focus*: Steam Desktop (`Tauri`), iOS/iPadOS (`WKWebView`) & Microsoft Store / Xbox Wrappers.
  - *Complexity / Difficulty*: High to Very High | Hard to Expert.
  - *Aggregate Effort*: `~170,000 tokens` | `~80--115 min agent` | `~28--40 hrs human`.
- **Total Active Roadmap (26 parent items, including 15 `[easy-win]` fast-track tasks/subtasks)**:
  - *Aggregate Effort*: **`~1,021,000 tokens`** | **`~7.8--11.4 hrs agent`** | **`~136--199 hrs human`**.

---

## 2. Label Taxonomy & Sequencing Rationale

### Label Dimensions
- **Priority (`priority:*`)**: `P0-fix`, `P0-critical`, `P1-high`, `P2-medium-high`, `P3-medium`, `P4-medium-low`, `P5-long-term`.
- **Quick-Win Tag**: `[easy-win]` marks standalone fixes or decoupled Phase-A subtasks (`<= 15 min` agent time, `1--3` files, zero external backend blockers, suitable for `Flash` or `Pro`).
- **Work Type (`type:*`)**: `fix`, `feature`, `polish`, `infra`, `integration`, `testing`, `chore`.
- **Subsystem (`domain:*`)**: `canvas`, `ui`, `engine`, `audio`, `a11y`, `cloud`, `multiplayer`, `android`, `ai`, `export`, `testing`, `desktop`, `ios`.
- **Complexity (`complexity:*`)**: `low` (1--2 files, localized), `medium` (2--4 files, state + UI), `high` (4--7 files, cross-layer/worker), `very-high` (multi-package / native + web protocol).
- **Difficulty (`difficulty:*`)**: `easy` (straightforward logic), `moderate` (careful state/math invariance), `hard` (60 FPS zero-allocation math, WebAudio/WebCodecs, CRDTs), `expert` (distributed P2P signaling, native SDK bridges).

### Priority Sequencing Principles
1. **Correctness & Test Blindspots First (`BF-8`--`BF-11`)**: Fix silent E2E test gaps, UI grid overflow, non-atomic Android disk writes, and dead Gradle dependencies before layering new features.
2. **Mobile Touch Ergonomics Before Secondary Chrome (`P0`)**: Solve thumb occlusion on `< 50px` micro-regions (`P0-1`, `P0-2`) and core tactile audio/visual feedback (`P0-3`, `P0-4`) ahead of meta-progression.
3. **Zero-Backend Client Wins Ahead of Hosted Infrastructure (`P1`--`P2` before `P3`--`P4`)**: Ship 100% offline/client-side features (Daily Puzzle, Accessibility, Video Export, Local Stats, Breadcrumbs, Printable SVG, Local Co-op `UNFILL_EVENT`) before tasks gated on external cloud workers, paid AI APIs, or store console setup.
4. **Stabilize Web Core Before New Native Shells (`P5` Last)**: Finalize `UserSettings`, `NativeBridge`, and HUD contracts in `web/` before wrapping them in Tauri (`desktop/`) or Swift `WKWebView` (`ios/`).

---

## 3. Compact Item-by-Item Estimation Index

- **`BF-8`** `[easy-win]` (*Stale IndexedDB Name in `BF-6` Eviction Test*): `P0-fix` | `testing` | `low` / `easy` | `~14k tok` (`6--10m` agent, `1--1.5h` human).
- **`BF-9`** `[easy-win]` (*Settings Replay Speed `grid-cols-5` Overflow*): `P0-fix` | `ui` | `low` / `easy` | `~12k tok` (`5--8m` agent, `0.5--1h` human).
- **`BF-10`** `[easy-win]` (*Atomic `.tmp` + Rename Android Disk Backups*): `P0-fix` | `android` | `low` / `moderate` | `~18k tok` (`8--12m` agent, `1.5--2.5h` human).
- **`BF-11`** `[easy-win]` (*Prune Orphaned `:app1` Compose Gradle Catalog Entries*): `P0-fix` | `android`, `chore` | `low` / `easy` | `~12k tok` (`5--10m` agent, `1--2h` human).
- **`P0-1`** (*Floating Precision Loupe Magnifier & Offset*): `P0-critical` | `canvas`, `ui` | `high` / `hard` | `~40k tok` (`18--26m` agent, `5--7h` human).
- **`P0-2`** (*Pinch-to-Zoom Sensitivity & Scale Anchor Snapping*): `P0-critical` | `canvas`, `ui` | `low` / `moderate` | `~25k tok` (`10--16m` agent, `2--4h` human).
- **`P0-3`** (*Procedural Web Audio & ASMR Sound Engine*): `P0-critical` | `audio`, `ui` | `medium` / `moderate` | `~38k tok` (`18--25m` agent, `4--6h` human).
- **`P0-4`** (*Zero-Allocation Fill Micro-Animations & Bursts*): `P0-critical` | `canvas` | `high` / `hard` | `~42k tok` (`20--28m` agent, `5--7h` human).
- **`P1-1`** (*Daily Featured Puzzle Rotation & Streak Medals*): `P1-high` | `ui` | `medium` / `moderate` | `~35k tok` (`16--22m` agent, `4--6h` human).
- **`P1-2`** (*AAA Accessibility Suite: Motion, Keys & Patterns*): `P1-high` | `a11y`, `canvas`, `ui` | `high` / `hard` | `~45k tok` (`20--30m` agent, `6--8h` human).
- **`P1-3`** (*Replay Video `.webm`/`.mp4` & Animated GIF Export*): `P1-high` | `export`, `canvas` | `high` / `hard` | `~45k tok` (`22--30m` agent, `6--9h` human).
- **`P1-4`** (*Local Player Stats, Achievements & Store Bridges*): `P1-high` | `ui`, `cloud`, `android` | `high` / `moderate` | `~50k tok` (`22--32m` agent, `6--9h` human).
- **`P2-1`** (*Focal-Point Quadtree Sub-Tiles & Breadcrumbs*): `P2-medium-high` | `canvas`, `engine`, `ui` | `high` / `hard` | `~42k tok` (`20--28m` agent, `6--8h` human).
- **`P2-2`** (*Printable Vector SVG / PDF Coloring Sheet Exporter*): `P2-medium-high` | `export`, `engine` | `medium` / `hard` | `~40k tok` (`18--25m` agent, `5--8h` human).
- **`P2-3`** (*Co-op Initial-Fill `UNFILL_EVENT` & Ping Beacon*): `P2-medium-high` | `multiplayer`, `canvas` | `medium` / `moderate` | `~35k tok` (`16--24m` agent, `4--6h` human).
- **`P3-1`** (*Play Console Production Credentials & `assetlinks.json`*): `P3-medium` | `android`, `cloud` | `low` / `easy` | `~20k tok` (`10--15m` agent, `2--4h` human).
- **`P3-2`** (*Hosted Hibernating WebSocket Relay `VITE_CAPY_ROOM_WS_URL`*): `P3-medium` | `multiplayer`, `cloud` | `high` / `hard` | `~50k tok` (`25--35m` agent, `8--12h` human).
- **`P3-3`** (*Ephemeral Encrypted Cloud Blob Share Relay*): `P3-medium` | `cloud`, `multiplayer` | `medium` / `hard` | `~40k tok` (`18--26m` agent, `6--8h` human).
- **`P3-4`** (*WebRTC DataChannel P2P Upgrade & Photo Transfer*): `P3-medium` | `multiplayer` | `very-high` / `expert` | `~65k tok` (`30--45m` agent, `10--14h` human).
- **`P4-1`** (*Live In-App AI Artwork Endpoint `VITE_CAPY_AI_API_URL`*): `P4-medium-low` | `ai`, `ui` | `medium` / `moderate` | `~42k tok` (`18--28m` agent, `5--8h` human).
- **`P4-2`** (*AI Seam-Locked Detail Inpainting for Sub-Tiles*): `P4-medium-low` | `ai`, `engine` | `high` / `hard` | `~48k tok` (`22--32m` agent, `7--10h` human).
- **`P4-3`** (*Shared Community Backend & Automated `.capy` Publisher*): `P4-medium-low` | `cloud`, `engine` | `high` / `hard` | `~45k tok` (`20--30m` agent, `6--8h` human).
- **`P4-4`** (*Native Google UMP Consent + AdMob Rewarded SDK*): `P4-medium-low` | `android`, `ui` | `high` / `hard` | `~48k tok` (`22--32m` agent, `7--10h` human).
- **`P5-1`** (*Steam Desktop Wrapper `desktop/` & `SteamCloudDriver`*): `P5-long-term` | `desktop`, `cloud` | `very-high` / `expert` | `~60k tok` (`28--40m` agent, `10--14h` human).
- **`P5-2`** (*iOS & iPadOS Native Wrapper `ios/` & `AppleCloudDriver`*): `P5-long-term` | `ios`, `cloud` | `very-high` / `expert` | `~65k tok` (`30--45m` agent, `12--16h` human).
- **`P5-3`** (*Microsoft Store / Xbox Wrapper & `MicrosoftCloudDriver`*): `P5-long-term` | `desktop`, `cloud` | `high` / `hard` | `~45k tok` (`22--30m` agent, `6--10h` human).

---

## 4. Easy-Win Fast-Track Queue (`<= 15 min` Agent / `Flash`-Ready)

Each item below is a **self-contained, zero-backend quick win** (`1--3` files, `<= 20,000 tokens`, `5--15 min` agent time) that can be shipped individually or in small themed batches using the `Flash` model tier (see [`DEV.md` Section 3](./DEV.md#3-choosing-the-right-ai-model-capability-tier--workflow)):

1. **`BF-8`** (`~6--10m`, `Flash`): Fix stale `'capy_puzzles_db'` IndexedDB name to `'capy_game_storage_v8'` in [`web/scripts/test.mjs`](./web/scripts/test.mjs) (`#L946-L968`).
2. **`BF-9`** (`~5--8m`, `Flash`): Fix `REPLAY_SPEED_OPTIONS` grid from `grid-cols-5` to `grid-cols-3 sm:grid-cols-6` in [`SettingsModal.tsx`](./web/src/components/SettingsModal.tsx) (`#L854`).
3. **`BF-10`** (`~8--12m`, `Flash`): Make Android `saveBackupToDir` crash-safe via `.tmp` + `fsync` + atomic move in [`CapyAndroidBridge.kt`](./app/src/main/java/com/capypaint/capy/CapyAndroidBridge.kt).
4. **`BF-11`** (`~5--10m`, `Flash`): Prune unused `:app1` Jetpack Compose & Coil entries from [`gradle/libs.versions.toml`](./gradle/libs.versions.toml).
5. **`P0-2a`** (`~8--12m`, `Flash`): Add `zoomSensitivity` (`0.5x--2.0x`) setting slider and wheel/pinch multiplier in [`SettingsModal.tsx`](./web/src/components/SettingsModal.tsx) & [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx).
6. **`P0-2b`** (`~8--12m`, `Flash`): Add `snapZoomLevels` (`1x`, `2x`, `4x`, `8x`, `12x`) magnetic detents and zoom-badge quick-step in [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx) & [`GameTopBar.tsx`](./web/src/components/GameTopBar.tsx).
7. **`P0-3a`** (`~8--12m`, `Flash`): Scaffold zero-asset `SoundService.ts` (`AudioContext` + visibility suspend/resume + tap woodblock click) with `soundEnabled` / `soundVolume` controls.
8. **`P1-1a`** (`~8--12m`, `Flash`): Add deterministic UTC date-seeded "Puzzle of the Day" card at the top of the **Create** tab in [`SettingsModal.tsx`](./web/src/components/SettingsModal.tsx).
9. **`P1-2a`** (`~8--12m`, `Flash`): Add `reducedMotion` setting (auto-detecting `prefers-reduced-motion: reduce`) to skip `canvas-confetti`, camera zoom animations, and hint pulses.
10. **`P1-2b`** (`~8--12m`, `Flash`): Add keyboard shortcuts (`1`--`9` swatch select, `+`/`-` zoom, `0` reset view, Arrow/WASD pan) in [`App.tsx`](./web/src/App.tsx) & [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx).
11. **`P1-4a`** (`~10--14m`, `Flash`): Add local `PlayerStatsService.ts` (`capy_player_stats_v1`: regions colored, puzzles completed, zero-hint clears, fastest time) + Stats card in [`SettingsModal.tsx`](./web/src/components/SettingsModal.tsx).
12. **`P2-1a`** (`~10--14m`, `Flash`): Persist `parentSnapshotId` on detail-tile saves and render a one-tap "Back to Parent Puzzle" pill in [`GameTopBar.tsx`](./web/src/components/GameTopBar.tsx).
13. **`P2-2a`** (`~10--15m`, `Flash`): Build `SvgPrintExporter.ts` exporting `borderMap` + region numbers + palette key as a crisp printable A4/Letter `.svg` sheet via `NativeBridge.exportOrShareFile`.
14. **`P2-3a`** (`~8--12m`, `Flash`): Add `'UNFILL_EVENT'` to [`HybridCoopRoomAdapter`](./web/src/services/providers/ProviderRegistry.ts) so initial-fill Undo syncs cleanly across connected Co-op peers.
15. **`P3-1a`** (`~6--10m`, `Flash`): Scaffold `web/public/.well-known/assetlinks.json` template and env-injection validation helper for Android App Links & Google OAuth setup.

---

## 5. Priority Bugfixes -- Documentation & Codebase Audit Findings (`BF-8`--`BF-11`)

- **BF-8: Stale IndexedDB Database Name (`'capy_puzzles_db'`) in `BF-6` Cache-Eviction E2E Test ([`web/scripts/test.mjs`](./web/scripts/test.mjs))**:
  - **Labels**: `[easy-win]` `[priority: P0-fix]` `[type: fix]` `[domain: testing]` `[complexity: low]` `[difficulty: easy]`
  - **Estimates**: `Est. Tokens: ~14,000 tokens` | `Est. Time: ~6--10 min agent (~1--1.5 hrs human dev)` | **Model**: `Flash`
  - **Scope**: In [`web/scripts/test.mjs`](./web/scripts/test.mjs) (`#L946-L968`), the `BF-6` cache-eviction assertion calls `indexedDB.open('capy_puzzles_db')` (and references `'capy_images_v8'` in a comment), whereas [`StorageService.ts`](./web/src/services/StorageService.ts) (`#L22-L25`) stores all records inside `DB_NAME = 'capy_game_storage_v8'` (`STORE_PUZZLES = 'puzzles'`, `STORE_IMAGES = 'images'`). Because `'capy_puzzles_db'` has no `'puzzles'` store, `db.objectStoreNames.contains('puzzles')` returns `false` and resolves as a silent no-op instead of exercising cold-start worker regeneration + `mergeCustomPalette`. Open `'capy_game_storage_v8'`, delete `snapId` from `'puzzles'`, and assert true regeneration preserves `customPalette` and `isFreeColor`.
- **BF-9: Default Replay Speed Selector Grid Column Mismatch (`grid-cols-5` for 6 Options) ([`web/src/components/SettingsModal.tsx`](./web/src/components/SettingsModal.tsx))**:
  - **Labels**: `[easy-win]` `[priority: P0-fix]` `[type: fix]` `[domain: ui]` `[complexity: low]` `[difficulty: easy]`
  - **Estimates**: `Est. Tokens: ~12,000 tokens` | `Est. Time: ~5--8 min agent (~0.5--1 hr human dev)` | **Model**: `Flash`
  - **Scope**: [`SettingsModal.tsx`](./web/src/components/SettingsModal.tsx) (`#L854`) renders `REPLAY_SPEED_OPTIONS` (`[0.5, 1, 2, 5, 10, 20]` from [`ReplayControls.tsx`](./web/src/components/ReplayControls.tsx) `#L18`) inside `<div className="grid grid-cols-5 gap-1.5">`, wrapping `20x` onto an orphan second row. Update to `grid-cols-3 sm:grid-cols-6` (or `grid-cols-6`) so all 6 speeds align cleanly across phone and desktop viewports.
- **BF-10: Non-Atomic `writeText` Disk Backup & Cloud Cache Writes on Android ([`app/src/main/java/com/capypaint/capy/CapyAndroidBridge.kt`](./app/src/main/java/com/capypaint/capy/CapyAndroidBridge.kt))**:
  - **Labels**: `[easy-win]` `[priority: P0-fix]` `[type: fix]` `[domain: android]` `[complexity: low]` `[difficulty: moderate]`
  - **Estimates**: `Est. Tokens: ~18,000 tokens` | `Est. Time: ~8--12 min agent (~1.5--2.5 hrs human dev)` | **Model**: `Flash`
  - **Scope**: `CapyAndroidBridge.saveBackupToDir` (`#L286-L300`, shared by `saveBackup` and `saveCloudSnapshot`) writes UTF-8 JSON directly via `targetFile.writeText(data, Charsets.UTF_8)`, risking truncated corrupt JSON if the process dies mid-write. Write to `<sanitized_key>.json.tmp`, flush/`fd.sync()` the `FileOutputStream`, and atomically replace `targetFile` (`Files.move(..., ATOMIC_MOVE, REPLACE_EXISTING)` with `renameTo` fallback), covered by unit tests in [`CapyAndroidBridgeTest.kt`](./app/src/test/java/com/capypaint/capy/CapyAndroidBridgeTest.kt).
- **BF-11: Orphaned `:app1` Jetpack Compose & Coil Entries in Gradle Version Catalog ([`gradle/libs.versions.toml`](./gradle/libs.versions.toml))**:
  - **Labels**: `[easy-win]` `[priority: P0-fix]` `[type: chore]` `[domain: android]` `[complexity: low]` `[difficulty: easy]`
  - **Estimates**: `Est. Tokens: ~12,000 tokens` | `Est. Time: ~5--10 min agent (~1--2 hrs human dev)` | **Model**: `Flash`
  - **Scope**: [`settings.gradle.kts`](./settings.gradle.kts) includes only `:app`, yet [`gradle/libs.versions.toml`](./gradle/libs.versions.toml) retains unused Compose and Coil entries (`composeBom`, `coilCompose`, `androidx-activity-compose`, `androidx-compose-bom`, `androidx-ui*`, `androidx-material3`, `androidx-lifecycle-viewmodel-compose`, `coil-compose`, and plugin `kotlin-compose`). Remove unused entries and verify `./gradlew app:testDebugUnitTest app:assembleDebug`.

---

## 6. Priority P0: Mobile Precision Controls & AAA Sensory Polish

- **P0-1: Floating Precision Loupe Magnifier & Crosshair Offset for Tiny Micro-Regions**:
  - **Labels**: `[priority: P0-critical]` `[type: feature]` `[domain: canvas]` `[domain: ui]` `[complexity: high]` `[difficulty: hard]`
  - **Estimates**: `Est. Tokens: ~40,000 tokens` | `Est. Time: ~18--26 min agent (~5--7 hrs human dev)` | **Model**: `Pro` (`/plan`)
  - **Scope**:
    - Add an optional press-and-hold or Paint Mode floating magnifier lens (`showMagnifierLoupe: boolean` in `UserSettings`) offset 72px above the active touch point in [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx) (clipping cleanly near the top HUD edge) so mobile players can target `< 50px` micro-regions without thumb occlusion.
- **P0-2: Custom Pinch-to-Zoom Sensitivity & Scale Anchor Snapping (`1x`, `2x`, `4x`, `8x`, `12x`)**:
  - **Labels**: `[priority: P0-critical]` `[type: polish]` `[domain: canvas]` `[domain: ui]` `[complexity: low]` `[difficulty: moderate]`
  - **Estimates**: `Est. Tokens: ~25,000 tokens` | `Est. Time: ~10--16 min agent (~2--4 hrs human dev)`
  - **Subtasks**:
    - **`P0-2a` `[easy-win]` (`~13k tok`, `8--12m` agent, `Flash`)**: Add `zoomSensitivity: number` (`0.5` to `2.0`, default `1.0`) to `UserSettings` (`capy_user_settings_v8`), expose a slider in [`SettingsModal.tsx`](./web/src/components/SettingsModal.tsx) Controls, and scale wheel/pinch/double-tap-drag zoom deltas in [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx).
    - **`P0-2b` `[easy-win]` (`~12k tok`, `8--12m` agent, `Flash`)**: Add `snapZoomLevels: boolean` (default `false`) magnetic detents (`1x`, `2x`, `4x`, `8x`, `12x` within `+-4%`) in [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx) plus tap-to-cycle zoom anchor stepping on the zoom readout in [`GameTopBar.tsx`](./web/src/components/GameTopBar.tsx).
- **P0-3: Procedural Web Audio & ASMR Sound Effects Engine (`web/src/services/SoundService.ts`)**:
  - **Labels**: `[priority: P0-critical]` `[type: feature]` `[domain: audio]` `[domain: ui]` `[complexity: medium]` `[difficulty: moderate]`
  - **Estimates**: `Est. Tokens: ~38,000 tokens` | `Est. Time: ~18--25 min agent (~4--6 hrs human dev)`
  - **Subtasks**:
    - **`P0-3a` `[easy-win]` (`~16k tok`, `8--12m` agent, `Flash`)**: Create zero-asset `SoundService.ts` managing lazy `AudioContext` unlock, `visibilitychange` / blur auto-suspend, soft region-tap woodblock/paper stroke synthesis, and `soundEnabled: boolean` (default `true`) + `soundVolume: number` (`0.0`--`1.0`, default `0.7`) controls in [`SettingsModal.tsx`](./web/src/components/SettingsModal.tsx).
    - **`P0-3b` (`~22k tok`, `10--15m` agent, `Pro`)**: Layer harmonic pentatonic pitch progression across continuous Paint Mode streaks, a warm chord arpeggio when a palette swatch reaches 100%, and a celebratory completion fanfare.
- **P0-4: Zero-Allocation Region Fill Micro-Animations & Swatch Completion Bursts (`PuzzleCanvas.tsx`)**:
  - **Labels**: `[priority: P0-critical]` `[type: polish]` `[domain: canvas]` `[complexity: high]` `[difficulty: hard]`
  - **Estimates**: `Est. Tokens: ~42,000 tokens` | `Est. Time: ~20--28 min agent (~5--7 hrs human dev)` | **Model**: `Pro`
  - **Scope**:
    - Extend the demand-driven `requestAnimationFrame` overlay pass in [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx) using a pre-allocated typed ring buffer (mirroring [`CoopRippleBuffer.ts`](./web/src/engine/CoopRippleBuffer.ts)) to render a 180ms radial ink-bloom when a region is painted and a subtle shimmer wave across all regions of a newly completed swatch.

---

## 7. Priority P1: Zero-Backend Retention, Accessibility & Replay Export

- **P1-1: Daily Featured Puzzle Rotation, Streak Calendar & Medal Tiers**:
  - **Labels**: `[priority: P1-high]` `[type: feature]` `[domain: ui]` `[complexity: medium]` `[difficulty: moderate]`
  - **Estimates**: `Est. Tokens: ~35,000 tokens` | `Est. Time: ~16--22 min agent (~4--6 hrs human dev)`
  - **Subtasks**:
    - **`P1-1a` `[easy-win]` (`~15k tok`, `8--12m` agent, `Flash`)**: Add a deterministic UTC date-seeded "Puzzle of the Day" card at the top of the **Create** tab in [`SettingsModal.tsx`](./web/src/components/SettingsModal.tsx) selecting from `SAMPLE_GALLERY` with a one-tap launch action.
    - **`P1-1b` (`~20k tok`, `10--14m` agent, `Flash` / `Pro`)**: Persist daily completion history (`capy_daily_streak_v1` in `localStorage`), consecutive-day streak counter, and Relaxed vs. Zero-Hint medal badges.
- **P1-2: AAA Accessibility Suite (Reduced Motion, Keyboard Navigation & Colorblind Pattern Overlays)**:
  - **Labels**: `[priority: P1-high]` `[type: feature]` `[domain: a11y]` `[domain: canvas]` `[domain: ui]` `[complexity: high]` `[difficulty: hard]`
  - **Estimates**: `Est. Tokens: ~45,000 tokens` | `Est. Time: ~20--30 min agent (~6--8 hrs human dev)`
  - **Subtasks**:
    - **`P1-2a` `[easy-win]` (`~14k tok`, `8--12m` agent, `Flash`)**: Add `reducedMotion: boolean` to `UserSettings` (seeded from `window.matchMedia('(prefers-reduced-motion: reduce)')`) and [`SettingsModal.tsx`](./web/src/components/SettingsModal.tsx) to bypass `canvas-confetti` bursts in [`App.tsx`](./web/src/App.tsx), smooth camera glides, and pulsing hint animations.
    - **`P1-2b` `[easy-win]` (`~14k tok`, `8--12m` agent, `Flash`)**: Extend `handleKeyDown` in [`App.tsx`](./web/src/App.tsx) (`#L1590-L1606`) and [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx) with `1`--`9` palette swatch selection, `+`/`=` and `-` zoom, `0` reset view, and Arrow/WASD viewport panning.
    - **`P1-2c` (`~22k tok`, `12--18m` agent, `Pro`)**: Add `colorblindPatternMode: boolean` using pre-rendered offscreen `CanvasPattern` geometric tiles (dots, diagonal stripes, crosshatch, checkerboard) over active and hinted regions in [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx).
- **P1-3: Replay Animation Video (`.webm` / `.mp4`) & Animated GIF Export**:
  - **Labels**: `[priority: P1-high]` `[type: feature]` `[domain: export]` `[domain: canvas]` `[complexity: high]` `[difficulty: hard]`
  - **Estimates**: `Est. Tokens: ~45,000 tokens` | `Est. Time: ~22--30 min agent (~6--9 hrs human dev)` | **Model**: `Pro`
  - **Scope**:
    - Allow players to export their chronological puzzle completion replay directly from [`ReplayControls.tsx`](./web/src/components/ReplayControls.tsx) as a shareable high-resolution timelapse video (`HTMLCanvasElement.captureStream(60)` + `MediaRecorder` / WebCodecs) or animated image sequence via `NativeBridge.exportOrShareFile`.
- **P1-4: Local Player Statistics, In-App Achievement System & Play Games / Steam Bridges**:
  - **Labels**: `[priority: P1-high]` `[type: feature]` `[domain: ui]` `[domain: cloud]` `[domain: android]` `[complexity: high]` `[difficulty: moderate]`
  - **Estimates**: `Est. Tokens: ~50,000 tokens` | `Est. Time: ~22--32 min agent (~6--9 hrs human dev)`
  - **Subtasks**:
    - **`P1-4a` `[easy-win]` (`~18k tok`, `10--14m` agent, `Flash`)**: Create `PlayerStatsService.ts` (`capy_player_stats_v1`: `totalRegionsColored`, `puzzlesCompleted`, `zeroHintPuzzles`, `fastestCompletionMs`, `freeColorCreations`, `coopRegionsPainted`) and render a **Lifetime Stats** summary card in [`SettingsModal.tsx`](./web/src/components/SettingsModal.tsx).
    - **`P1-4b` (`~32k tok`, `15--22m` agent, `Pro`)**: Add milestone achievement definitions, non-blocking unlock toast banners, CRDT cloud stat merging in [`CloudProviderDrivers.ts`](./web/src/services/providers/CloudProviderDrivers.ts), and `NativeBridge.unlockAchievement` / `incrementAchievement` / `submitLeaderboardScore` hooks (`app/src/main/res/values/games-ids.xml` once `P3-1` credentials exist).

---

## 8. Priority P2: Serverless Infinite Zoom, Printable Exports & Local Co-op Polish

- **P2-1: Focal-Point Quadtree Sub-Tile Navigation & Parent Breadcrumb Stack**:
  - **Labels**: `[priority: P2-medium-high]` `[type: feature]` `[domain: canvas]` `[domain: engine]` `[domain: ui]` `[complexity: high]` `[difficulty: hard]`
  - **Estimates**: `Est. Tokens: ~42,000 tokens` | `Est. Time: ~20--28 min agent (~6--8 hrs human dev)`
  - **Subtasks**:
    - **`P2-1a` `[easy-win]` (`~16k tok`, `10--14m` agent, `Flash`)**: Add optional `parentSnapshotId?: string` to `SavedSnapshot`, populate it inside `handleZoomIntoDetailTile` ([`App.tsx`](./web/src/App.tsx) `#L3319`), and render a one-tap "Back to Parent Puzzle" breadcrumb pill in [`GameTopBar.tsx`](./web/src/components/GameTopBar.tsx).
    - **`P2-1b` (`~26k tok`, `14--18m` agent, `Pro`)**: Upgrade `handleZoomIntoDetailTile` from fixed 2x center-crop to multi-level quadtree sub-tile bounds centered on the active `(focusX, focusY)` viewport center in [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx).
- **P2-2: Printable Vector SVG / PDF Coloring Sheet Exporter**:
  - **Labels**: `[priority: P2-medium-high]` `[type: feature]` `[domain: export]` `[domain: engine]` `[complexity: medium]` `[difficulty: hard]`
  - **Estimates**: `Est. Tokens: ~40,000 tokens` | `Est. Time: ~18--25 min agent (~5--8 hrs human dev)`
  - **Subtasks**:
    - **`P2-2a` `[easy-win]` (`~18k tok`, `10--15m` agent, `Flash`)**: Build `SvgPrintExporter.ts` exporting `borderMap` contours, `centroidX`/`centroidY` region numbers, and a bottom swatch-number legend as a clean monochrome `.svg` sheet wired to `NativeBridge.exportOrShareFile` in [`SettingsModal.tsx`](./web/src/components/SettingsModal.tsx).
    - **`P2-2b` (`~22k tok`, `10--14m` agent, `Flash` / `Pro`)**: Add configurable print options (A4 vs. Letter page framing, line weight, hide numbers for freehand coloring, and one-tap browser print/PDF dialog).
- **P2-3: Co-op Collaborator Undo Sync (`UNFILL_EVENT`) & Interactive "Ping Region" Beacon**:
  - **Labels**: `[priority: P2-medium-high]` `[type: feature]` `[domain: multiplayer]` `[domain: canvas]` `[complexity: medium]` `[difficulty: moderate]`
  - **Estimates**: `Est. Tokens: ~35,000 tokens` | `Est. Time: ~16--24 min agent (~4--6 hrs human dev)`
  - **Subtasks**:
    - **`P2-3a` `[easy-win]` (`~15k tok`, `8--12m` agent, `Flash`)**: Add `'UNFILL_EVENT'` to `RealtimeRoomMessage` ([`providers/types.ts`](./web/src/services/providers/types.ts)) and [`HybridCoopRoomAdapter`](./web/src/services/providers/ProviderRegistry.ts) so undoing a first-time fill clears that region across all connected Co-op peers immediately.
    - **`P2-3b` (`~20k tok`, `10--14m` agent, `Pro`)**: Add a tap-and-hold `'PING_EVENT'` beacon rendered via [`CoopRippleBuffer.ts`](./web/src/engine/CoopRippleBuffer.ts) on [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx) to highlight tricky micro-regions for collaborators.

---

## 9. Priority P3: Storefront Credentials & Cross-Network Co-op / Share Relays

- **P3-1: Google Play Console Production Credentials, Web OAuth ID & Verified `assetlinks.json`**:
  - **Labels**: `[priority: P3-medium]` `[type: infra]` `[domain: android]` `[domain: cloud]` `[complexity: low]` `[difficulty: easy]`
  - **Estimates**: `Est. Tokens: ~20,000 tokens` | `Est. Time: ~10--15 min agent (~2--4 hrs human dev)`
  - **Subtasks**:
    - **`P3-1a` `[easy-win]` (`~12k tok`, `6--10m` agent, `Flash`)**: Scaffold `web/public/.well-known/assetlinks.json` and build-time env substitution/validation for `VITE_GOOGLE_CLIENT_ID` and `CAPY_PLAY_GAMES_APP_ID` so dropping production credentials requires zero code edits.
    - **`P3-1b` (*Human Console Setup*, `~1--2h`)**: Provision the 12-digit Play Games Project ID and Web OAuth 2.0 Client ID (linking `https://shthed.github.io/capy/privacy-policy.html`), register Upload and Play App Signing SHA-256 fingerprints, and populate CI secrets.
- **P3-2: Hosted Hibernating WebSocket Room Relay Server (`VITE_CAPY_ROOM_WS_URL`)**:
  - **Labels**: `[priority: P3-medium]` `[type: infra]` `[domain: multiplayer]` `[domain: cloud]` `[complexity: high]` `[difficulty: hard]`
  - **Estimates**: `Est. Tokens: ~50,000 tokens` | `Est. Time: ~25--35 min agent (~8--12 hrs human dev)` | **Model**: `Pro` (`/plan`)
  - **Scope**:
    - Implement and deploy a lightweight hibernating WebSocket room relay (Cloudflare Worker + Durable Objects in a `relay/` workspace package) backing [`HybridCoopRoomAdapter`](./web/src/services/providers/ProviderRegistry.ts) so 6-character Co-op room codes (`?room=ABC123`) connect players across separate devices and networks.
- **P3-3: Ephemeral Encrypted Cloud Blob Relay for Custom Photo Share Links (`#s=<token>`)**:
  - **Labels**: `[priority: P3-medium]` `[type: infra]` `[domain: cloud]` `[domain: multiplayer]` `[complexity: medium]` `[difficulty: hard]`
  - **Estimates**: `Est. Tokens: ~40,000 tokens` | `Est. Time: ~18--26 min agent (~6--8 hrs human dev)` | **Model**: `Pro`
  - **Scope**:
    - Add an opt-in encrypted `.capy` v2 blob upload (content-addressed SHA-256 key with 30-day TTL in object storage) so `#s=<token>` share URLs work across devices for custom uploaded photos just like built-in Gallery artworks.
- **P3-4: WebRTC DataChannel Peer-to-Peer Upgrade & Custom Photo Transfer in Co-op Rooms**:
  - **Labels**: `[priority: P3-medium]` `[type: feature]` `[domain: multiplayer]` `[complexity: very-high]` `[difficulty: expert]`
  - **Estimates**: `Est. Tokens: ~65,000 tokens` | `Est. Time: ~30--45 min agent (~10--14 hrs human dev)` | **Model**: `Pro` (`/plan`)
  - **Scope**:
    - Upgrade WebSocket room signaling to negotiate direct `RTCPeerConnection` / `RTCDataChannel` links between participants so real-time `PAINT_EVENT` strokes and custom `.capy` v2 puzzle packs stream peer-to-peer without server storage overhead.

---

## 10. Priority P4: Live AI Endpoints, Community Backend & Opt-In Monetization

- **P4-1: Live In-App AI Artwork Generation Endpoint (`VITE_CAPY_AI_API_URL`)**:
  - **Labels**: `[priority: P4-medium-low]` `[type: integration]` `[domain: ai]` `[domain: ui]` `[complexity: medium]` `[difficulty: moderate]`
  - **Estimates**: `Est. Tokens: ~42,000 tokens` | `Est. Time: ~18--28 min agent (~5--8 hrs human dev)` | **Model**: `Pro`
  - **Scope**:
    - Connect [`DefaultAiArtworkAdapter`](./web/src/services/providers/ProviderRegistry.ts) to a live serverless image generation endpoint (Imagen 3 / Gemini / Flux) and add a "Generate Custom AI Puzzle from Prompt" workflow in the **Create** tab spending verified `AiCreditLedger` credits into `puzzle.worker.ts`.
- **P4-2: AI Seam-Locked Detail Inpainting for Infinite Zoom Sub-Tiles**:
  - **Labels**: `[priority: P4-medium-low]` `[type: integration]` `[domain: ai]` `[domain: engine]` `[complexity: high]` `[difficulty: hard]`
  - **Estimates**: `Est. Tokens: ~48,000 tokens` | `Est. Time: ~22--32 min agent (~7--10 hrs human dev)` | **Model**: `Pro`
  - **Scope**:
    - Wire [`DefaultAiArtworkAdapter.buildSeamLockedInfillPrompt`](./web/src/services/providers/ProviderRegistry.ts) to an image-to-image / outpainting model synthesizing micro-details inside zoomed sub-tiles while clamping outer border pixels to `lockedBoundaryPaletteHex` for seamless parent transitions.
- **P4-3: Shared Multi-User Backend & Automated `.capy` v2 Gallery Publisher for Community Ideas**:
  - **Labels**: `[priority: P4-medium-low]` `[type: infra]` `[domain: cloud]` `[domain: engine]` `[complexity: high]` `[difficulty: hard]`
  - **Estimates**: `Est. Tokens: ~45,000 tokens` | `Est. Time: ~20--30 min agent (~6--8 hrs human dev)` | **Model**: `Pro`
  - **Scope**:
    - Connect `StaticAndCommunityCatalogAdapter` (`capy_community_ideas_v1`) to a rate-limited, moderated backend API so player-submitted ideas and upvotes sync globally, paired with a scheduled GitHub Actions workflow pre-baking top-voted ideas into `.capy` v2 packs (`catalog/v1/index.json`).
- **P4-4: Native Google UMP Consent + AdMob Rewarded Video SDK Integration (`app/`)**:
  - **Labels**: `[priority: P4-medium-low]` `[type: integration]` `[domain: android]` `[domain: ui]` `[complexity: high]` `[difficulty: hard]`
  - **Estimates**: `Est. Tokens: ~48,000 tokens` | `Est. Time: ~22--32 min agent (~7--10 hrs human dev)` | **Model**: `Pro` (`/plan`)
  - **Scope**:
    - Bundle `com.google.android.ump:user-messaging-platform` and `com.google.android.gms:play-services-ads` in [`app/build.gradle.kts`](./app/build.gradle.kts), wire GDPR/CCPA consent forms in [`MainActivity.kt`](./app/src/main/java/com/capypaint/capy/MainActivity.kt), and implement `CapyAndroidBridge.showRewardedAd()` with Server-Side Verification (SSV) callbacks to fund optional AI generation credits while keeping core coloring 100% ad-free.

---

## 11. Priority P5: Multi-Platform Desktop (Steam / Tauri), iOS & Microsoft Store Packaging

- **P5-1: Steam Desktop Wrapper (`desktop/`) & `SteamCloudDriver` Bindings**:
  - **Labels**: `[priority: P5-long-term]` `[type: integration]` `[domain: desktop]` `[domain: cloud]` `[complexity: very-high]` `[difficulty: expert]`
  - **Estimates**: `Est. Tokens: ~60,000 tokens` | `Est. Time: ~28--40 min agent (~10--14 hrs human dev)` | **Model**: `Pro` (`/plan`)
  - **Scope**:
    - Scaffold a Tauri v2 desktop wrapper (`desktop/`) hosting `web/dist/` with `steamworks-rs` adapters wired to [`SteamCloudDriver`](./web/src/services/providers/CloudProviderDrivers.ts) (`ISteamRemoteStorage` Cloud Saves, Steam Achievements, Steam Overlay, and Rich Presence).
- **P5-2: iOS & iPadOS Native Wrapper (`ios/`) & `AppleCloudDriver` Bindings**:
  - **Labels**: `[priority: P5-long-term]` `[type: integration]` `[domain: ios]` `[domain: cloud]` `[complexity: very-high]` `[difficulty: expert]`
  - **Estimates**: `Est. Tokens: ~65,000 tokens` | `Est. Time: ~30--45 min agent (~12--16 hrs human dev)` | **Model**: `Pro` (`/plan`)
  - **Scope**:
    - Scaffold a Swift `WKWebView` iOS/iPadOS wrapper connected to `window.webkit.messageHandlers.CapyIOS` and [`AppleCloudDriver`](./web/src/services/providers/CloudProviderDrivers.ts), supporting Apple Pencil hover/pressure, CoreHaptics, Sign in with Apple / GameKit (`GKLocalPlayer`), and CloudKit `privateCloudDatabase` save sync.
- **P5-3: Microsoft Store / Xbox Wrapper & `MicrosoftCloudDriver` Bindings**:
  - **Labels**: `[priority: P5-long-term]` `[type: integration]` `[domain: desktop]` `[domain: cloud]` `[complexity: high]` `[difficulty: hard]`
  - **Estimates**: `Est. Tokens: ~45,000 tokens` | `Est. Time: ~22--30 min agent (~6--10 hrs human dev)` | **Model**: `Pro` (`/plan`)
  - **Scope**:
    - Connect [`MicrosoftCloudDriver`](./web/src/services/providers/CloudProviderDrivers.ts) to live Microsoft Entra ID / MSA OAuth 2.0 PKCE credentials for OneDrive `special/approot` and Xbox Connected Storage synchronization.
