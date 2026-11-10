# Changelog & Versioning Scheme -- Capy Monorepo ([`web/`](./web), [`app/`](./app))

All notable changes to the **Capy** color-by-number suite across the Web Application ([`web/`](./web)) and Unified Native Android Launcher ([`app/`](./app)) are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

> [!NOTE]
> **Documentation Hygiene**: Never include unicode emojis or ASCII box-drawing diagrams in [`CHANGELOG.md`](./CHANGELOG.md). Every feature, bugfix, or architectural pull request must bump the version in [`web/package.json`](./web/package.json) according to the scheme below and record its changes under a matching version heading in this file.

---

## Versioning Scheme & Cross-Target Synchronization

Capy uses a unified **Semantic Versioning (`MAJOR.MINOR.PATCH`)** scheme shared across all targets from a single source of truth:

| Component | Source / Location | Rule & Formula | Current Value |
| :--- | :--- | :--- | :--- |
| **Canonical SemVer** | [`web/package.json`](./web/package.json) (`"version"`) | Single source of truth formatted as `MAJOR.MINOR.PATCH` (`0 <= MINOR <= 99`, `0 <= PATCH <= 99`). | `2.5.2` |
| **Web Runtime Constant** | [`web/src/version.ts`](./web/src/version.ts) (`APP_VERSION`, `APP_VERSION_CODE`) | Imported directly from [`web/package.json`](./web/package.json) and displayed in [`SettingsModal.tsx`](./web/src/components/SettingsModal.tsx) (`data-testid="app-version-badge"`). | `v2.5.2` (`20502`) |
| **Android `versionName`** | [`app/build.gradle.kts`](./app/build.gradle.kts) (`capyVersionName`) | Automatically parsed at Gradle configuration time from [`../web/package.json`](./web/package.json). | `"2.5.2"` |
| **Android `versionCode`** | [`app/build.gradle.kts`](./app/build.gradle.kts) (`capyVersionCode`) | Deterministically computed as `(MAJOR * 10000) + (MINOR * 100) + PATCH` for strictly monotonic Google Play Console uploads. | `20502` |

### When to Increment Each Version Segment

1. **`MAJOR` (`X.0.0`, e.g., `1.0.0` $\rightarrow$ `2.0.0`)**:
   - Incremented for major storage epoch upgrades (such as the transition from legacy JSON saves to `.capy` v2 Gzip binary archives in [`CapyCodec.ts`](./web/src/services/CapyCodec.ts)), fundamental architecture migrations, or new top-level platform launches.
2. **`MINOR` (`2.Y.0`, e.g., `2.4.0` $\rightarrow$ `2.5.0`)**:
   - Incremented whenever backward-compatible gameplay features, replay modes, UI controls, cloud/multiplayer drivers, or new `UserSettings` keys ([`web/src/types/index.ts`](./web/src/types/index.ts)) are added.
3. **`PATCH` (`2.5.Z`, e.g., `2.5.0` $\rightarrow$ `2.5.1`)**:
   - Incremented for backward-compatible bug fixes, gesture edge-case corrections, performance optimizations, test suite consolidation, or dependency security updates.

---

## Release History

## [2.5.2] - 2026-11-10 (Android `versionCode`: `20502`)

### Fixed
- **Canvas Container Resize & Orientation Change Clamping (`BF-2`, [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx), [`test.mjs`](./web/scripts/test.mjs))**:
  - Attached a `ResizeObserver` (with a `window` `resize` listener fallback) to `containerRef` in [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx) so viewport resizes, mobile portrait/landscape rotations, split-screen adjustments, and DevTools dock changes immediately clamp `offsetRef.current` via `clampCanvasOffset`, resize and repaint the high-DPI onscreen `<canvas>` via `drawCompositeFrame(pulseAlphaRef.current)`, notify `onViewExtentChangedRef`, and recompute visible on-screen regions/colors (`containerSize`).
- **IndexedDB Cache Eviction Custom Palette Restoration (`BF-6`, [`App.tsx`](./web/src/App.tsx), [`test.mjs`](./web/scripts/test.mjs))**:
  - Added `mergeCustomPalette` in [`App.tsx`](./web/src/App.tsx) and extended `loadArtworkFromImage`, `handleLoadSnapshot`, and cold-start `restoreSession` so when `StorageService.loadPuzzleData(snapshot.id)` returns `null` after browser IndexedDB cache eviction and falls back to re-segmenting the source image, both user-edited swatches and user-added custom swatches (`snapshot.customPalette`) as well as `snapshot.isFreeColor` are preserved instead of resetting to newly quantized colors.
- **Android Pixel / API 33+ Tactile Haptic Feedback Silent Suppression (`BF-7`, [`CapyAndroidBridge.kt`](./app/src/main/java/com/capypaint/capy/CapyAndroidBridge.kt), [`MainActivity.kt`](./app/src/main/java/com/capypaint/capy/MainActivity.kt), [`CapyAndroidBridgeTest.kt`](./app/src/test/java/com/capypaint/capy/CapyAndroidBridgeTest.kt))**:
  - Enabled `isHapticFeedbackEnabled = true` on the host `WebView` in [`MainActivity.kt`](./app/src/main/java/com/capypaint/capy/MainActivity.kt) and passed `HapticFeedbackConstants.FLAG_IGNORE_VIEW_SETTING` to `view.performHapticFeedback(...)` in [`CapyAndroidBridge.kt`](./app/src/main/java/com/capypaint/capy/CapyAndroidBridge.kt).
  - Updated `performHaptic` in [`CapyAndroidBridge.kt`](./app/src/main/java/com/capypaint/capy/CapyAndroidBridge.kt) (`resolveHapticSpec`, `vibrateEffectWithTouchAttributes`, `vibratePredefined`) to attach `VibrationAttributes.createForUsage(VibrationAttributes.USAGE_TOUCH)` on API 33+ (Android 13–15) and `AudioAttributes.USAGE_ASSISTANCE_SONIFICATION` on API 26–32, while using crisp hardware-tuned `VibrationEffect.createPredefined` effects (`EFFECT_TICK`, `EFFECT_CLICK`, `EFFECT_HEAVY_CLICK`) on API 29+ so Pixel linear resonant actuators (LRAs) never silently drop region-fill and UI haptics under default notification vibration rules.

---

## [2.5.1] - 2026-11-10 ([PR #464](https://github.com/shthed/capy/pull/464), Android `versionCode`: `20501`)

### Added
- **YouTube-Style Playback Control Bar & Zero-Latency Timeline Scrubber ([`ReplayControls.tsx#L136-L214`](https://github.com/shthed/capy/blob/8b120f89b61a2d03778b4165e00610c723a67fe7/web/src/components/ReplayControls.tsx#L136-L214), [`PuzzleCanvas.tsx#L814-L876`](https://github.com/shthed/capy/blob/98d769017aa468460062b79bfa2ee8dd0cd6668c/web/src/components/PuzzleCanvas.tsx#L814-L876), [`App.tsx#L2319-L2327`](https://github.com/shthed/capy/blob/98d769017aa468460062b79bfa2ee8dd0cd6668c/web/src/App.tsx#L2319-L2327), [PR #464](https://github.com/shthed/capy/pull/464/files#diff-31c2689e34e930bf53e85704fee926a32e4ff5f7c9bc17f45a43267422c44b87R136-R214))**:
  - Redesigned [`ReplayControls.tsx#L136-L586`](https://github.com/shthed/capy/blob/8b120f89b61a2d03778b4165e00610c723a67fe7/web/src/components/ReplayControls.tsx#L136-L586) ([`0ed0217`](https://github.com/shthed/capy/pull/464/commits/0ed0217e93ecd218d22820a365de5cb1ce167ff8), [`8b120f8`](https://github.com/shthed/capy/pull/464/commits/8b120f89b61a2d03778b4165e00610c723a67fe7)) as a YouTube-style video control bar (`w-full max-w-2xl`) where the interactive progress slider ([`renderYouTubeScrubber` (`ReplayControls.tsx#L136-L214`)](https://github.com/shthed/capy/blob/8b120f89b61a2d03778b4165e00610c723a67fe7/web/src/components/ReplayControls.tsx#L136-L214), `data-testid="replay-scrubber-track"` / `data-testid="replay-scrubber"`) occupies the majority of the horizontal space (`flex-1`) and can be clicked or dragged at any time in both the default compact bar ([`ReplayControls.tsx#L216-L366`](https://github.com/shthed/capy/blob/8b120f89b61a2d03778b4165e00610c723a67fe7/web/src/components/ReplayControls.tsx#L216-L366), `data-minimized="true"`) and the expanded deck ([`ReplayControls.tsx#L368-L586`](https://github.com/shthed/capy/blob/8b120f89b61a2d03778b4165e00610c723a67fe7/web/src/components/ReplayControls.tsx#L368-L586), `data-minimized="false"`), with step/percentage info displayed via the floating hover/scrub tooltip ([`ReplayControls.tsx#L152-L162`](https://github.com/shthed/capy/blob/8b120f89b61a2d03778b4165e00610c723a67fe7/web/src/components/ReplayControls.tsx#L152-L162)).
  - Implemented zero-latency pointer-capture scrubbing ([`computeStepFromPointer` / `handleTrackPointerDown` / `handleTrackPointerMove` (`ReplayControls.tsx#L91-L134`)](https://github.com/shthed/capy/blob/8b120f89b61a2d03778b4165e00610c723a67fe7/web/src/components/ReplayControls.tsx#L91-L134) with `setPointerCapture`), a `transition-none` progress fill bar ([`ReplayControls.tsx#L172-L176`](https://github.com/shthed/capy/blob/8b120f89b61a2d03778b4165e00610c723a67fe7/web/src/components/ReplayControls.tsx#L172-L176)), an interactive thumb indicator ([`ReplayControls.tsx#L180-L185`](https://github.com/shthed/capy/blob/8b120f89b61a2d03778b4165e00610c723a67fe7/web/src/components/ReplayControls.tsx#L180-L185)), and a `20x` ultra-fast playback speed option ([`REPLAY_SPEED_OPTIONS` (`ReplayControls.tsx#L18`)](https://github.com/shthed/capy/blob/8b120f89b61a2d03778b4165e00610c723a67fe7/web/src/components/ReplayControls.tsx#L18) `= [0.5, 1, 2, 5, 10, 20]`).
  - Eliminated intermediate `Array.prototype.slice` and per-frame `new Set` / `new Map` cloning in [`App.tsx#L2319-L2327`](https://github.com/shthed/capy/blob/98d769017aa468460062b79bfa2ee8dd0cd6668c/web/src/App.tsx#L2319-L2327) (`displayedFilledRegionIds`) and [`PuzzleCanvas.tsx#L814-L876`](https://github.com/shthed/capy/blob/98d769017aa468460062b79bfa2ee8dd0cd6668c/web/src/components/PuzzleCanvas.tsx#L814-L876) (`paintedCacheRef` / `prevColorsRef` in-place mutation) for instant timeline scrubbing across hundreds of regions.
- **Predictive Lookahead Safe-Frame Camera Controller ([`stepFollow` (`PuzzleCanvas.tsx#L401-L591`)](https://github.com/shthed/capy/blob/98d769017aa468460062b79bfa2ee8dd0cd6668c/web/src/components/PuzzleCanvas.tsx#L401-L591), [`App.tsx#L385-L436`](https://github.com/shthed/capy/blob/98d769017aa468460062b79bfa2ee8dd0cd6668c/web/src/App.tsx#L385-L436), [commit `98d7690`](https://github.com/shthed/capy/pull/464/commits/98d769017aa468460062b79bfa2ee8dd0cd6668c), [PR #464 diff](https://github.com/shthed/capy/pull/464/files#diff-b5b5422550e96235f37cee8a794ff26639948c7370602e4cdc6ec56caf53c3feR401-R591))**:
  - Added an inner safe-frame dead-zone (`[18% w, 82% w]` x `[max(68px, 18% h), h - max(92px, 22% h)]`) in [`stepFollow` (`PuzzleCanvas.tsx#L461-L479`)](https://github.com/shthed/capy/blob/98d769017aa468460062b79bfa2ee8dd0cd6668c/web/src/components/PuzzleCanvas.tsx#L461-L479) so the camera remains completely stationary while upcoming regions stay comfortably onscreen and only updates its anchor ([`followAnchorOffsetRef` (`PuzzleCanvas.tsx#L408-L410`)](https://github.com/shthed/capy/blob/98d769017aa468460062b79bfa2ee8dd0cd6668c/web/src/components/PuzzleCanvas.tsx#L408-L410)) when current or anticipated upcoming regions approach the screen edge ([`PuzzleCanvas.tsx#L480-L551`](https://github.com/shthed/capy/blob/98d769017aa468460062b79bfa2ee8dd0cd6668c/web/src/components/PuzzleCanvas.tsx#L480-L551)).
  - Added predictive lookahead over the next 10 future region completions ([`replayFollowSequence` / `replayFollowStep` (`PuzzleCanvas.tsx#L60-L63`)](https://github.com/shthed/capy/blob/98d769017aa468460062b79bfa2ee8dd0cd6668c/web/src/components/PuzzleCanvas.tsx#L60-L63) passed from [`App.tsx#L3361-L3373`](https://github.com/shthed/capy/blob/98d769017aa468460062b79bfa2ee8dd0cd6668c/web/src/App.tsx#L3361-L3373)) to compute a horizon-weighted cluster centroid ([`PuzzleCanvas.tsx#L502-L547`](https://github.com/shthed/capy/blob/98d769017aa468460062b79bfa2ee8dd0cd6668c/web/src/components/PuzzleCanvas.tsx#L502-L547)) and glide smoothly via a critically-damped 2D velocity spring-damper ([`SmoothDamp` / `followVelRef` (`PuzzleCanvas.tsx#L553-L584`)](https://github.com/shthed/capy/blob/98d769017aa468460062b79bfa2ee8dd0cd6668c/web/src/components/PuzzleCanvas.tsx#L553-L584)) with smooth ease-in and ease-out.

### Fixed
- **Strict Viewport Invariance on Puzzle Completion & Replay Playback ([`App.tsx#L439-L468`](https://github.com/shthed/capy/blob/98d769017aa468460062b79bfa2ee8dd0cd6668c/web/src/App.tsx#L439-L468), [`PuzzleCanvas.tsx#L401-L450`](https://github.com/shthed/capy/blob/98d769017aa468460062b79bfa2ee8dd0cd6668c/web/src/components/PuzzleCanvas.tsx#L401-L450), [`FloatingActions.tsx#L125-L141`](https://github.com/shthed/capy/blob/948bda28523bf8764610ee6295b3523c4d73d4bc/web/src/components/FloatingActions.tsx#L125-L141), [`test.mjs#L781-L837`](https://github.com/shthed/capy/blob/98d769017aa468460062b79bfa2ee8dd0cd6668c/web/scripts/test.mjs#L781-L837), [commit `948bda2`](https://github.com/shthed/capy/pull/464/commits/948bda28523bf8764610ee6295b3523c4d73d4bc))**:
  - Removed automatic fit-to-screen zoom-out (`resetViewTrigger`) when completing the final region of a puzzle ([`attemptFillRegion` (`App.tsx#L1659-L1661`)](https://github.com/shthed/capy/blob/98d769017aa468460062b79bfa2ee8dd0cd6668c/web/src/App.tsx#L1659-L1661), [`attemptBatchFillRegions` (`App.tsx#L1786-L1869`)](https://github.com/shthed/capy/blob/98d769017aa468460062b79bfa2ee8dd0cd6668c/web/src/App.tsx#L1786-L1869)) or when pressing the **Watch Puzzle Replay** button (`data-testid="replay-btn"` in [`FloatingActions.tsx#L125-L141`](https://github.com/shthed/capy/blob/948bda28523bf8764610ee6295b3523c4d73d4bc/web/src/components/FloatingActions.tsx#L125-L141), invoking [`startReplay` (`App.tsx#L439-L455`)](https://github.com/shthed/capy/blob/98d769017aa468460062b79bfa2ee8dd0cd6668c/web/src/App.tsx#L439-L455)) so replays always play directly from the player's current zoom and pan position.
  - Updated [`handleLoadSnapshot` (`App.tsx#L2165-L2189`)](https://github.com/shthed/capy/blob/98d769017aa468460062b79bfa2ee8dd0cd6668c/web/src/App.tsx#L2165-L2189) and [`finishAutoResume` (`App.tsx#L459-L468`)](https://github.com/shthed/capy/blob/98d769017aa468460062b79bfa2ee8dd0cd6668c/web/src/App.tsx#L459-L468) so triggering a replay on the currently active puzzle from Saves or finishing an auto-replay never resets or teleports the viewport.
  - Removed automatic zoom scale mutation (`followAutoZoomingRef`) from [`stepFollow` (`PuzzleCanvas.tsx#L401-L450`)](https://github.com/shthed/capy/blob/98d769017aa468460062b79bfa2ee8dd0cd6668c/web/src/components/PuzzleCanvas.tsx#L401-L450) so `replayFollow` never alters the player's zoom level and only pans when the player is already zoomed in (`scale > 1.05`).

---

## [2.5.0] - 2026-11-10 ([PR #463](https://github.com/shthed/capy/pull/463), Android `versionCode`: `20500`)

### Added
- **Save-Load Zoom Extent Restoration Before Replay ([`web/src/App.tsx`](./web/src/App.tsx), [`web/src/components/PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx), [PR #463](https://github.com/shthed/capy/pull/463))**:
  - Restores the saved puzzle's previous `zoomScale`, `panOffsetX`, and `panOffsetY` on the canvas (`restoreViewTrigger` + immediate `clampCanvasOffset` clamping in [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx)) before initiating chronological replay on app launch or save switching.
- **Automatic Offscreen Replay Step Fast-Forward ([`web/src/App.tsx`](./web/src/App.tsx), [PR #463](https://github.com/shthed/capy/pull/463))**:
  - Added a zero-allocation O(1) bounding-box frustum check (`isRegionVisibleInViewport` in [`App.tsx`](./web/src/App.tsx)) inside the 60 FPS replay `requestAnimationFrame` loop that immediately skips consecutive offscreen regions when `replayFollow` is disabled.
- **Follow Painting Camera Tracking (`replayFollow`, [`web/src/components/PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx), [`web/src/components/ReplayControls.tsx`](./web/src/components/ReplayControls.tsx), [`web/src/components/SettingsModal.tsx`](./web/src/components/SettingsModal.tsx), [PR #463](https://github.com/shthed/capy/pull/463))**:
  - Added `replayFollow: boolean` (default `false`) to `UserSettings` (`capy_user_settings_v8` in [`web/src/types/index.ts`](./web/src/types/index.ts) and [`web/src/services/StorageService.ts`](./web/src/services/StorageService.ts)) with toggle buttons in both the minimised and expanded [`ReplayControls.tsx`](./web/src/components/ReplayControls.tsx) HUD (`data-testid="replay-follow-btn"`) and [`SettingsModal.tsx`](./web/src/components/SettingsModal.tsx) (`data-testid="toggle-replay-follow-btn"`).
  - Smoothly auto-zooms to `~2.5x` when enabled from fit-to-screen zoom (`< 1.8x`), pans the camera (`stepFollow` at 60 FPS with pre-allocated scratch vectors in [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx)) toward the next region being painted (`replaySequence[replayStep]`), bypasses offscreen step skipping, waits for the viewport to catch up (`isViewportCaughtUpToRegion` in [`App.tsx`](./web/src/App.tsx)) so every region is onscreen before painting, automatically disengages (`onManualPanStart`) if the player manually pans the canvas during replay, and restores the save's pre-replay viewport (`preReplayViewportRef`) when a save-load auto-replay finishes.
- **Auto-Loop Replay (`replayLoop`, [`web/src/App.tsx`](./web/src/App.tsx), [`web/src/components/ReplayControls.tsx`](./web/src/components/ReplayControls.tsx), [`web/src/components/SettingsModal.tsx`](./web/src/components/SettingsModal.tsx), [PR #463](https://github.com/shthed/capy/pull/463))**:
  - Added `replayLoop: boolean` (default `false`) to `UserSettings` (`capy_user_settings_v8` in [`web/src/types/index.ts`](./web/src/types/index.ts) and [`web/src/services/StorageService.ts`](./web/src/services/StorageService.ts)) with toggle buttons in [`ReplayControls.tsx`](./web/src/components/ReplayControls.tsx) (`data-testid="replay-loop-btn"`) and [`SettingsModal.tsx`](./web/src/components/SettingsModal.tsx) (`data-testid="toggle-replay-loop-btn"`).
  - Automatically holds at `100%` for 350ms (`loopPauseUntil`) and restarts replay from step `0` when enabled.
- **Live Panning & Zooming During Replay Playback ([`web/src/App.tsx`](./web/src/App.tsx), [PR #463](https://github.com/shthed/capy/pull/463))**:
  - Enabled live viewport pan and zoom persistence during active replay playback and added `flushPendingViewportSave` on replay exit, save switching, and `beforeunload`/`pagehide`.
- **Unified Versioning Scheme & Runtime Version Badge ([`web/src/version.ts`](./web/src/version.ts), [`app/build.gradle.kts`](./app/build.gradle.kts), [`CHANGELOG.md`](./CHANGELOG.md), [PR #463](https://github.com/shthed/capy/pull/463))**:
  - Established [`web/package.json`](./web/package.json) as the single source of truth for Semantic Versioning (`2.5.0`), wired [`app/build.gradle.kts`](./app/build.gradle.kts) to compute `versionCode = (MAJOR * 10000) + (MINOR * 100) + PATCH` (`20500`), and added `data-testid="app-version-badge"` in [`SettingsModal.tsx`](./web/src/components/SettingsModal.tsx).

### Changed
- **Default-Minimised Replay Controls HUD ([`web/src/components/ReplayControls.tsx`](./web/src/components/ReplayControls.tsx), [PR #463](https://github.com/shthed/capy/pull/463))**:
  - [`ReplayControls.tsx`](./web/src/components/ReplayControls.tsx) now opens minimised by default (`data-minimized="true"`) as a compact floating pill and expands to the full timeline scrubber card via `data-testid="replay-toggle-minimize-btn"`.
- **Unified Single-Script Test Suite ([`web/scripts/test.mjs`](./web/scripts/test.mjs), [`web/package.json`](./web/package.json), [PR #463](https://github.com/shthed/capy/pull/463))**:
  - Consolidated all 7 standalone test scripts into a single unified test runner (`npm test` $\rightarrow$ [`web/scripts/test.mjs`](./web/scripts/test.mjs)) verifying engine/codec unit checks, version/changelog invariants, and 6 comprehensive Playwright E2E browser stages.
- **Prioritized AAA Roadmap & Effort Ledger ([`TODO.md`](./TODO.md), [PR #463](https://github.com/shthed/capy/pull/463))**:
  - Reorganized [`TODO.md`](./TODO.md) into `Bugfixes -- Audit Findings` and `P0`–`P5` tiers with token budgets, agent/human time estimates, and standardized `priority`, `type`, `domain`, `complexity`, and `difficulty` labels.

### Fixed
- **Inactive Save Card Replay Trigger ([`web/src/App.tsx`](./web/src/App.tsx), [PR #463](https://github.com/shthed/capy/pull/463))**:
  - Fixed `handleLoadSnapshot` in [`App.tsx`](./web/src/App.tsx) so clicking Replay (`forceReplay = true`) on an inactive save card starts the replay after loading even when `settings.autoReplayOnLoad` is `false`.
- **Free Colour Override Persistence ([`web/src/App.tsx`](./web/src/App.tsx), [PR #463](https://github.com/shthed/capy/pull/463))**:
  - Preserved `paintedRegionColors` when calling `StorageService.saveActiveState` ([`StorageService.ts`](./web/src/services/StorageService.ts)) in `attemptFillRegion`, `attemptBatchFillRegions`, and worker regeneration fallbacks.
- **Hardware Back & Escape Modal Stack Registration ([`web/src/App.tsx`](./web/src/App.tsx), [PR #463](https://github.com/shthed/capy/pull/463))**:
  - Registered `isReplaying` ([`ReplayControls.tsx`](./web/src/components/ReplayControls.tsx)) and `showPaletteOptions` ([`ColorPickerPopover.tsx`](./web/src/components/ColorPickerPopover.tsx)) with `NativeBridge.pushBackHandler` ([`NativeBridge.ts`](./web/src/services/NativeBridge.ts)).

---

## [2.4.0] - 2026-11-10 ([PR #461](https://github.com/shthed/capy/pull/461), Android `versionCode`: `20400`)

### Added
- **Modular Cloud Provider Driver Architecture ([`web/src/services/providers/CloudProviderDrivers.ts`](./web/src/services/providers/CloudProviderDrivers.ts), [PR #461](https://github.com/shthed/capy/pull/461))**:
  - Implemented pluggable `CloudProviderDriver` backends (`LocalVaultCloudDriver`, `GoogleDriveCloudDriver`, `SteamCloudDriver`, `AppleCloudDriver`, `MicrosoftCloudDriver`) managed by `MultiProviderCloudSaveAdapter` in [`CloudProviderDrivers.ts`](./web/src/services/providers/CloudProviderDrivers.ts).
- **Google OAuth 2.0 GIS & Drive `appDataFolder` Cross-Device Sync ([`web/src/services/providers/CloudProviderDrivers.ts`](./web/src/services/providers/CloudProviderDrivers.ts), [PR #461](https://github.com/shthed/capy/pull/461))**:
  - Added browser-native Google Identity Services OAuth 2.0 token acquisition (`drive.appdata` + `userinfo.profile`) and hidden Google Drive `appDataFolder` synchronization for CRDT `CloudSaveEnvelope` slots and `.capy` v2 custom puzzle archives.

---

## [2.3.0] - 2026-11-09 ([PR #462](https://github.com/shthed/capy/pull/462), Android `versionCode`: `20300`)

### Fixed
- **Runtime Share Link & Co-op Pre-Baked Sample Resolution ([`web/src/App.tsx`](./web/src/App.tsx), [PR #462](https://github.com/shthed/capy/pull/462))**:
  - Added `loadSampleFromPrebakedOrGenerate` in [`App.tsx`](./web/src/App.tsx) so incoming `#s=<token>` share links, Co-op `WELCOME_STATE` puzzle switches, and Create tab sample loads resolve directly against pre-baked `IndexedDB` records ([`StorageService.ts`](./web/src/services/StorageService.ts)) with 100% matching region IDs and zero duplicate snapshots.
- **Canvas Undo/Unfill Incremental Dirty-Rect Repaint ([`web/src/components/PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx), [PR #462](https://github.com/shthed/capy/pull/462))**:
  - Fixed incremental base canvas updates in [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx) so unfilling regions via single-step Undo, Replay scrubbing, or `Resume Here` repaints dirty bounding boxes without requiring a full canvas rebuild.
- **Lazy Modal Code-Splitting & Passive Viewport Updates ([`web/vite.config.ts`](./web/vite.config.ts), [`web/src/services/StorageService.ts`](./web/src/services/StorageService.ts), [PR #462](https://github.com/shthed/capy/pull/462))**:
  - Code-split [`SettingsModal.tsx`](./web/src/components/SettingsModal.tsx), [`ColorPickerPopover.tsx`](./web/src/components/ColorPickerPopover.tsx), and vendor chunks under 225 KB and added `StorageService.updateSnapshotViewport` in [`StorageService.ts`](./web/src/services/StorageService.ts) so passive pan/zoom updates do not reorder `LAST_ACTIVE` save sorting.

---

## [2.2.0] - 2026-11-09 ([PR #460](https://github.com/shthed/capy/pull/460), Android `versionCode`: `20200`)

### Added
- **Shareable `< 2 KB` Progress Links & Simultaneous Co-op Rooms ([`web/src/services/ShareLinkService.ts`](./web/src/services/ShareLinkService.ts), [`web/src/services/providers/ProviderRegistry.ts`](./web/src/services/providers/ProviderRegistry.ts), [PR #460](https://github.com/shthed/capy/pull/460))**:
  - Added `#s=<token>` URL progress sharing ([`ShareLinkService.ts`](./web/src/services/ShareLinkService.ts)), 6-character simultaneous Co-op rooms (`HybridCoopRoomAdapter` in [`ProviderRegistry.ts`](./web/src/services/providers/ProviderRegistry.ts) with `BroadcastChannel` + WebSocket transport), and zero-allocation collaborator paint ripples ([`CoopRippleBuffer.ts`](./web/src/engine/CoopRippleBuffer.ts)).
- **Google Play Games Services v2 Sign-In & Storefront Compliance ([`app/src/main/java/com/capypaint/capy/MainActivity.kt`](./app/src/main/java/com/capypaint/capy/MainActivity.kt), [`web/public/privacy-policy.html`](./web/public/privacy-policy.html), [PR #460](https://github.com/shthed/capy/pull/460))**:
  - Integrated Play Games Services v2 silent sign-in (`PlayGamesSignInClient` in [`MainActivity.kt`](./app/src/main/java/com/capypaint/capy/MainActivity.kt)), release keystore signing configuration ([`app/build.gradle.kts`](./app/build.gradle.kts)), ProGuard rules ([`app/proguard-rules.pro`](./app/proguard-rules.pro)), and family-friendly moderated Community Puzzle Ideas.

---

## [2.1.0] - 2026-11-08 ([PR #459](https://github.com/shthed/capy/pull/459), Android `versionCode`: `20100`)

### Added
- **Instant First-Launch Sample Bootstrap ([`web/public/assets/sample_saves.capy`](./web/public/assets/sample_saves.capy), [`web/scripts/generate-sample-saves.mjs`](./web/scripts/generate-sample-saves.mjs), [PR #459](https://github.com/shthed/capy/pull/459))**:
  - Pre-baked all 4 built-in `SAMPLE_GALLERY` artworks (`Capybara`, `Mushroom Forest`, `Capy Forest`, `Snail Guitar` in [`web/src/types/index.ts`](./web/src/types/index.ts)) into a 225 KB `.capy` v2 Gzip binary archive ([`web/public/assets/sample_saves.capy`](./web/public/assets/sample_saves.capy)) with deterministic K-Means++ initialization (`0xca91ba7a` in [`ColorQuantizer.ts`](./web/src/engine/ColorQuantizer.ts)) so first-time players enter gameplay immediately without waiting for Web Worker segmentation.

---

## [2.0.0] - 2026-11-08 ([PR #458](https://github.com/shthed/capy/pull/458), Android `versionCode`: `20000`)

### Added
- **Compact Binary Storage Format v2 (`.capy` v2, [`web/src/services/CapyCodec.ts`](./web/src/services/CapyCodec.ts), [PR #458](https://github.com/shthed/capy/pull/458))**:
  - Introduced `CAPY\x02` Gzip-compressed binary framing, `uint16` Run-Length Encoding (`regionMapRleB64`), LEB128 varint delta encoding, and CRDT `ProgressDeltaV2` tokens in [`CapyCodec.ts`](./web/src/services/CapyCodec.ts), reducing save storage footprint by ~140x (`~54 KB` per puzzle in `IndexedDB` via [`StorageService.ts`](./web/src/services/StorageService.ts) and `~22 KB` per `.capy` export).

---

## [1.4.0] - 2026-11-07 ([PR #457](https://github.com/shthed/capy/pull/457), [PR #456](https://github.com/shthed/capy/pull/456), [PR #455](https://github.com/shthed/capy/pull/455), [PR #454](https://github.com/shthed/capy/pull/454), Android `versionCode`: `10400`)

### Added
- **Inscribed-Circle Label Fitting & Circle-Free `NUMBER_ONLY` Hints ([`web/src/components/PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx), [PR #457](https://github.com/shthed/capy/pull/457))**:
  - Added configurable `minLabelSize` (2–14px), `maxLabelSize` (10–36px), and `labelScale` settings in [`SettingsModal.tsx`](./web/src/components/SettingsModal.tsx), mathematical inscribed-circle bounds guarantees for 1–3 digit labels, and circle-free `NUMBER_ONLY` label text color highlighting in [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx).
- **Simple (Fast Mode) vs. Detailed Generation Progress & Authentic Palette Metrics ([`web/src/components/LoadingOverlay.tsx`](./web/src/components/LoadingOverlay.tsx), [PR #454](https://github.com/shthed/capy/pull/454), [PR #455](https://github.com/shthed/capy/pull/455), [PR #456](https://github.com/shthed/capy/pull/456))**:
  - Added low-overhead Simple Progress (Fast Mode default) alongside Detailed 6-stage pipeline inspection with live K-Means clustered palette swatches in [`LoadingOverlay.tsx`](./web/src/components/LoadingOverlay.tsx).

---

## [1.3.0] - 2026-11-06 ([PR #452](https://github.com/shthed/capy/pull/452), [PR #449](https://github.com/shthed/capy/pull/449), Android `versionCode`: `10300`)

### Added
- **Installable Offline-First Progressive Web App ([`web/public/sw.js`](./web/public/sw.js), [`web/public/manifest.webmanifest`](./web/public/manifest.webmanifest), [`web/src/services/PwaService.ts`](./web/src/services/PwaService.ts), [PR #452](https://github.com/shthed/capy/pull/452))**:
  - Added `capy-cache-v2` offline Service Worker ([`web/public/sw.js`](./web/public/sw.js)) with automatic Vite bundle discovery, standalone PWA manifest ([`web/public/manifest.webmanifest`](./web/public/manifest.webmanifest)), and in-app install prompt integration ([`PwaService.ts`](./web/src/services/PwaService.ts)).
- **Saves Gallery Modernization ([`web/src/components/SettingsModal.tsx`](./web/src/components/SettingsModal.tsx), [PR #449](https://github.com/shthed/capy/pull/449))**:
  - Added Detail vs. Thumbnails grid view switcher (`capy_saves_view_mode`), save pinning (`isPinned`), and sticky library action toolbar in [`SettingsModal.tsx`](./web/src/components/SettingsModal.tsx).

---

## [1.2.0] - 2026-11-05 ([PR #448](https://github.com/shthed/capy/pull/448), [PR #447](https://github.com/shthed/capy/pull/447), [PR #446](https://github.com/shthed/capy/pull/446), Android `versionCode`: `10200`)

### Added
- **Animated Chronological Replay, Long-Press Undo Scrubber & Multi-Step Redo ([`web/src/components/ReplayControls.tsx`](./web/src/components/ReplayControls.tsx), [`web/src/components/FloatingActions.tsx`](./web/src/components/FloatingActions.tsx), [PR #446](https://github.com/shthed/capy/pull/446), [PR #447](https://github.com/shthed/capy/pull/447), [PR #448](https://github.com/shthed/capy/pull/448))**:
  - Added 60 FPS chronological puzzle completion replays ([`ReplayControls.tsx`](./web/src/components/ReplayControls.tsx)), single-step Undo/Redo (`Ctrl+Z` / `Ctrl+Y` via [`FloatingActions.tsx`](./web/src/components/FloatingActions.tsx)), long-press Undo (`>= 450ms`) timeline scrubbing with "Resume Here", and automatic post-replay gameplay resumption on save load.

---

## [1.1.0] - 2026-11-04 ([PR #445](https://github.com/shthed/capy/pull/445), [PR #444](https://github.com/shthed/capy/pull/444), [PR #442](https://github.com/shthed/capy/pull/442), Android `versionCode`: `10100`)

### Added
- **Google Maps-Style One-Finger Double-Tap Zoom, Inertial Pan Momentum & Custom Pipette Pickers ([`web/src/components/PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx), [PR #442](https://github.com/shthed/capy/pull/442), [PR #444](https://github.com/shthed/capy/pull/444), [PR #445](https://github.com/shthed/capy/pull/445))**:
  - Added one-finger double-tap-and-drag focal zoom, friction-decayed pan momentum gliding, dynamic corner pan margins in [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx), custom `<Pipette>` hex color pickers for canvas background and hints in [`SettingsModal.tsx`](./web/src/components/SettingsModal.tsx), and automated Playwright gallery screenshot capture (`npm run gallery:capture` via [`web/scripts/capture-gallery.mjs`](./web/scripts/capture-gallery.mjs)).

---

## [1.0.0] - 2026-11-01 ([PR #441](https://github.com/shthed/capy/pull/441), Android `versionCode`: `10000`)

### Added
- **Initial Capy Monorepo Release ([`web/`](./web) & [`app/`](./app), [PR #441](https://github.com/shthed/capy/pull/441))**:
  - Launched the React 19 + TypeScript + Vite 6 Web Application ([`web/`](./web)) with 3-tier offscreen canvas caching ([`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx)), 5-strategy Web Worker segmentation pipeline ([`puzzle.worker.ts`](./web/src/engine/puzzle.worker.ts)), Free Colour mode ([`ColorPickerPopover.tsx`](./web/src/components/ColorPickerPopover.tsx)), and the unified Kotlin Android `WebViewAssetLoader` wrapper ([`app/`](./app), [`MainActivity.kt`](./app/src/main/java/com/capypaint/capy/MainActivity.kt), [`CapyAndroidBridge.kt`](./app/src/main/java/com/capypaint/capy/CapyAndroidBridge.kt)).

[2.5.1]: https://github.com/shthed/capy/pull/464
[2.5.0]: https://github.com/shthed/capy/pull/463
[2.4.0]: https://github.com/shthed/capy/pull/461
[2.3.0]: https://github.com/shthed/capy/pull/462
[2.2.0]: https://github.com/shthed/capy/pull/460
[2.1.0]: https://github.com/shthed/capy/pull/459
[2.0.0]: https://github.com/shthed/capy/pull/458
[1.4.0]: https://github.com/shthed/capy/pull/457
[1.3.0]: https://github.com/shthed/capy/pull/452
[1.2.0]: https://github.com/shthed/capy/pull/448
[1.1.0]: https://github.com/shthed/capy/pull/445
[1.0.0]: https://github.com/shthed/capy/pull/441
