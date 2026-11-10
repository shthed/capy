# Changelog & Versioning Scheme -- Capy Monorepo (`web/`, `app/`)

All notable changes to the **Capy** color-by-number suite across the Web Application (`web/`) and Unified Native Android Launcher (`app/`) are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

> [!NOTE]
> **Documentation Hygiene**: Never include unicode emojis or ASCII box-drawing diagrams in `CHANGELOG.md`. Every feature, bugfix, or architectural pull request must bump the version in [`web/package.json`](./web/package.json) according to the scheme below and record its changes under a matching version heading in this file.

---

## Versioning Scheme & Cross-Target Synchronization

Capy uses a unified **Semantic Versioning (`MAJOR.MINOR.PATCH`)** scheme shared across all targets from a single source of truth:

| Component | Source / Location | Rule & Formula | Current Value |
| :--- | :--- | :--- | :--- |
| **Canonical SemVer** | [`web/package.json`](./web/package.json) (`"version"`) | Single source of truth formatted as `MAJOR.MINOR.PATCH` (`0 <= MINOR <= 99`, `0 <= PATCH <= 99`). | `2.5.0` |
| **Web Runtime Constant** | [`web/src/version.ts`](./web/src/version.ts) (`APP_VERSION`, `APP_VERSION_CODE`) | Imported directly from `web/package.json` and displayed in `SettingsModal.tsx` (`data-testid="app-version-badge"`). | `v2.5.0` (`20500`) |
| **Android `versionName`** | [`app/build.gradle.kts`](./app/build.gradle.kts) (`capyVersionName`) | Automatically parsed at Gradle configuration time from `../web/package.json`. | `"2.5.0"` |
| **Android `versionCode`** | [`app/build.gradle.kts`](./app/build.gradle.kts) (`capyVersionCode`) | Deterministically computed as `(MAJOR * 10000) + (MINOR * 100) + PATCH` for strictly monotonic Google Play Console uploads. | `20500` |

### When to Increment Each Version Segment

1. **`MAJOR` (`X.0.0`, e.g., `1.0.0` $\rightarrow$ `2.0.0`)**:
   - Incremented for major storage epoch upgrades (such as the transition from legacy JSON saves to `.capy` v2 Gzip binary archives), fundamental architecture migrations, or new top-level platform launches.
2. **`MINOR` (`2.Y.0`, e.g., `2.4.0` $\rightarrow$ `2.5.0`)**:
   - Incremented whenever backward-compatible gameplay features, replay modes, UI controls, cloud/multiplayer drivers, or new `UserSettings` keys are added.
3. **`PATCH` (`2.5.Z`, e.g., `2.5.0` $\rightarrow$ `2.5.1`)**:
   - Incremented for backward-compatible bug fixes, gesture edge-case corrections, performance optimizations, test suite consolidation, or dependency security updates.

---

## Release History

## [2.5.0] - 2026-11-10 (Android `versionCode`: `20500`)

### Added
- **Save-Load Zoom Extent Restoration Before Replay ([`web/src/App.tsx`](./web/src/App.tsx), [`web/src/components/PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx))**:
  - Restores the saved puzzle's previous `zoomScale`, `panOffsetX`, and `panOffsetY` on the canvas (`restoreViewTrigger` + immediate `clampCanvasOffset` clamping) before initiating chronological replay on app launch or save switching.
- **Automatic Offscreen Replay Step Fast-Forward ([`web/src/App.tsx`](./web/src/App.tsx))**:
  - Added a zero-allocation O(1) bounding-box frustum check (`isRegionVisibleInViewport`) inside the 60 FPS replay `requestAnimationFrame` loop that immediately skips consecutive offscreen regions when `replayFollow` is disabled.
- **Follow Painting Camera Tracking (`replayFollow`, [`web/src/components/PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx), [`web/src/components/ReplayControls.tsx`](./web/src/components/ReplayControls.tsx), [`web/src/components/SettingsModal.tsx`](./web/src/components/SettingsModal.tsx))**:
  - Added `replayFollow: boolean` (default `false`) to `UserSettings` (`capy_user_settings_v8`) with toggle buttons in both the minimised and expanded `ReplayControls` HUD (`data-testid="replay-follow-btn"`) and `SettingsModal` (`data-testid="toggle-replay-follow-btn"`).
  - Smoothly pans the camera (`stepFollow` at 60 FPS with pre-allocated scratch vectors) toward the next region being painted (`replaySequence[replayStep]`), bypasses offscreen step skipping, and waits for the viewport to catch up (`isViewportCaughtUpToRegion`) so every region is onscreen before painting.
- **Auto-Loop Replay (`replayLoop`, [`web/src/App.tsx`](./web/src/App.tsx), [`web/src/components/ReplayControls.tsx`](./web/src/components/ReplayControls.tsx), [`web/src/components/SettingsModal.tsx`](./web/src/components/SettingsModal.tsx))**:
  - Added `replayLoop: boolean` (default `false`) to `UserSettings` (`capy_user_settings_v8`) with toggle buttons in `ReplayControls` (`data-testid="replay-loop-btn"`) and `SettingsModal` (`data-testid="toggle-replay-loop-btn"`).
  - Automatically holds at `100%` for 350ms (`loopPauseUntil`) and restarts replay from step `0` when enabled.
- **Live Panning & Zooming During Replay Playback ([`web/src/App.tsx`](./web/src/App.tsx))**:
  - Enabled live viewport pan and zoom persistence during active replay playback and added `flushPendingViewportSave` on replay exit, save switching, and `beforeunload`/`pagehide`.
- **Unified Versioning Scheme & Runtime Version Badge ([`web/src/version.ts`](./web/src/version.ts), [`app/build.gradle.kts`](./app/build.gradle.kts), [`CHANGELOG.md`](./CHANGELOG.md))**:
  - Established `web/package.json` as the single source of truth for Semantic Versioning (`2.5.0`), wired `app/build.gradle.kts` to compute `versionCode = (MAJOR * 10000) + (MINOR * 100) + PATCH` (`20500`), and added `data-testid="app-version-badge"` in `SettingsModal.tsx`.

### Changed
- **Default-Minimised Replay Controls HUD ([`web/src/components/ReplayControls.tsx`](./web/src/components/ReplayControls.tsx))**:
  - `ReplayControls` now opens minimised by default (`data-minimized="true"`) as a compact floating pill and expands to the full timeline scrubber card via `data-testid="replay-toggle-minimize-btn"`.
- **Unified Single-Script Test Suite ([`web/scripts/test.mjs`](./web/scripts/test.mjs), [`web/package.json`](./web/package.json))**:
  - Consolidated all 7 standalone test scripts in `web/scripts/` into a single unified test runner (`npm test` $\rightarrow$ `node scripts/test.mjs`) verifying engine/codec unit checks, version/changelog invariants, and 6 comprehensive Playwright E2E browser stages.
- **Prioritized AAA Roadmap & Effort Ledger ([`TODO.md`](./TODO.md))**:
  - Reorganized `TODO.md` into `Bugfixes -- Audit Findings` and `P0`–`P5` tiers with token budgets, agent/human time estimates, and standardized `priority`, `type`, `domain`, `complexity`, and `difficulty` labels.

### Fixed
- **Inactive Save Card Replay Trigger ([`web/src/App.tsx`](./web/src/App.tsx))**:
  - Fixed `handleLoadSnapshot` so clicking Replay (`forceReplay = true`) on an inactive save card starts the replay after loading even when `settings.autoReplayOnLoad` is `false`.
- **Free Colour Override Persistence ([`web/src/App.tsx`](./web/src/App.tsx))**:
  - Preserved `paintedRegionColors` when calling `StorageService.saveActiveState` in `attemptFillRegion`, `attemptBatchFillRegions`, and worker regeneration fallbacks.
- **Hardware Back & Escape Modal Stack Registration ([`web/src/App.tsx`](./web/src/App.tsx))**:
  - Registered `isReplaying` (`ReplayControls`) and `showPaletteOptions` (`ColorPickerPopover`) with `NativeBridge.pushBackHandler`.

---

## [2.4.0] - 2026-11-10 (Android `versionCode`: `20400`)

### Added
- **Modular Cloud Provider Driver Architecture ([`web/src/services/providers/CloudProviderDrivers.ts`](./web/src/services/providers/CloudProviderDrivers.ts), PR #461)**:
  - Implemented pluggable `CloudProviderDriver` backends (`LocalVaultCloudDriver`, `GoogleDriveCloudDriver`, `SteamCloudDriver`, `AppleCloudDriver`, `MicrosoftCloudDriver`) managed by `MultiProviderCloudSaveAdapter`.
- **Google OAuth 2.0 GIS & Drive `appDataFolder` Cross-Device Sync (PR #461)**:
  - Added browser-native Google Identity Services OAuth 2.0 token acquisition (`drive.appdata` + `userinfo.profile`) and hidden Google Drive `appDataFolder` synchronization for CRDT `CloudSaveEnvelope` slots and `.capy` v2 custom puzzle archives.

---

## [2.3.0] - 2026-11-09 (Android `versionCode`: `20300`)

### Fixed
- **Runtime Share Link & Co-op Pre-Baked Sample Resolution ([`web/src/App.tsx`](./web/src/App.tsx), PR #462)**:
  - Added `loadSampleFromPrebakedOrGenerate` so incoming `#s=<token>` share links, Co-op `WELCOME_STATE` puzzle switches, and Create tab sample loads resolve directly against pre-baked `IndexedDB` records with 100% matching region IDs and zero duplicate snapshots.
- **Canvas Undo/Unfill Incremental Dirty-Rect Repaint ([`web/src/components/PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx), PR #462)**:
  - Fixed incremental base canvas updates so unfilling regions via single-step Undo, Replay scrubbing, or `Resume Here` repaints dirty bounding boxes without requiring a full canvas rebuild.
- **Lazy Modal Code-Splitting & Passive Viewport Updates ([`web/vite.config.ts`](./web/vite.config.ts), [`web/src/services/StorageService.ts`](./web/src/services/StorageService.ts), PR #462)**:
  - Code-split `SettingsModal`, `ColorPickerPopover`, and vendor chunks under 225 KB and added `StorageService.updateSnapshotViewport` so passive pan/zoom updates do not reorder `LAST_ACTIVE` save sorting.

---

## [2.2.0] - 2026-11-09 (Android `versionCode`: `20200`)

### Added
- **Shareable `< 2 KB` Progress Links & Simultaneous Co-op Rooms ([`web/src/services/ShareLinkService.ts`](./web/src/services/ShareLinkService.ts), [`web/src/services/providers/ProviderRegistry.ts`](./web/src/services/providers/ProviderRegistry.ts), PR #460)**:
  - Added `#s=<token>` URL progress sharing, 6-character simultaneous Co-op rooms (`HybridCoopRoomAdapter` with `BroadcastChannel` + WebSocket transport), and zero-allocation collaborator paint ripples (`CoopRippleBuffer.ts`).
- **Google Play Games Services v2 Sign-In & Storefront Compliance ([`app/src/main/java/com/capypaint/capy/MainActivity.kt`](./app/src/main/java/com/capypaint/capy/MainActivity.kt), [`web/public/privacy-policy.html`](./web/public/privacy-policy.html), PR #460)**:
  - Integrated Play Games Services v2 silent sign-in (`PlayGamesSignInClient`), release keystore signing configuration, ProGuard rules, and family-friendly moderated Community Puzzle Ideas.

---

## [2.1.0] - 2026-11-08 (Android `versionCode`: `20100`)

### Added
- **Instant First-Launch Sample Bootstrap (`./assets/sample_saves.capy`, [`web/scripts/generate-sample-saves.mjs`](./web/scripts/generate-sample-saves.mjs), PR #459)**:
  - Pre-baked all 4 built-in `SAMPLE_GALLERY` artworks (`Capybara`, `Mushroom Forest`, `Capy Forest`, `Snail Guitar`) into a 225 KB `.capy` v2 Gzip binary archive with deterministic K-Means++ initialization (`0xca91ba7a`) so first-time players enter gameplay immediately without waiting for Web Worker segmentation.

---

## [2.0.0] - 2026-11-08 (Android `versionCode`: `20000`)

### Added
- **Compact Binary Storage Format v2 (`.capy` v2, [`web/src/services/CapyCodec.ts`](./web/src/services/CapyCodec.ts), PR #458)**:
  - Introduced `CAPY\x02` Gzip-compressed binary framing, `uint16` Run-Length Encoding (`regionMapRleB64`), LEB128 varint delta encoding, and CRDT `ProgressDeltaV2` tokens, reducing save storage footprint by ~140x (`~54 KB` per puzzle in `IndexedDB` and `~22 KB` per `.capy` export).

---

## [1.4.0] - 2026-11-07 (Android `versionCode`: `10400`)

### Added
- **Inscribed-Circle Label Fitting & Circle-Free `NUMBER_ONLY` Hints ([`web/src/components/PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx), PR #457)**:
  - Added configurable `minLabelSize` (2–14px), `maxLabelSize` (10–36px), and `labelScale` settings, mathematical inscribed-circle bounds guarantees for 1–3 digit labels, and circle-free `NUMBER_ONLY` label text color highlighting.
- **Simple (Fast Mode) vs. Detailed Generation Progress & Authentic Palette Metrics ([`web/src/components/LoadingOverlay.tsx`](./web/src/components/LoadingOverlay.tsx), PR #454, PR #455, PR #456)**:
  - Added low-overhead Simple Progress (Fast Mode default) alongside Detailed 6-stage pipeline inspection with live K-Means clustered palette swatches.

---

## [1.3.0] - 2026-11-06 (Android `versionCode`: `10300`)

### Added
- **Installable Offline-First Progressive Web App ([`web/public/sw.js`](./web/public/sw.js), [`web/public/manifest.webmanifest`](./web/public/manifest.webmanifest), [`web/src/services/PwaService.ts`](./web/src/services/PwaService.ts), PR #452)**:
  - Added `capy-cache-v2` offline Service Worker with automatic Vite bundle discovery, standalone PWA manifest, and in-app install prompt integration.
- **Saves Gallery Modernization ([`web/src/components/SettingsModal.tsx`](./web/src/components/SettingsModal.tsx), PR #449)**:
  - Added Detail vs. Thumbnails grid view switcher (`capy_saves_view_mode`), save pinning (`isPinned`), and sticky library action toolbar.

---

## [1.2.0] - 2026-11-05 (Android `versionCode`: `10200`)

### Added
- **Animated Chronological Replay, Long-Press Undo Scrubber & Multi-Step Redo ([`web/src/components/ReplayControls.tsx`](./web/src/components/ReplayControls.tsx), [`web/src/components/FloatingActions.tsx`](./web/src/components/FloatingActions.tsx), PR #446, PR #447, PR #448)**:
  - Added 60 FPS chronological puzzle completion replays, single-step Undo/Redo (`Ctrl+Z` / `Ctrl+Y`), long-press Undo (`>= 450ms`) timeline scrubbing with "Resume Here", and automatic post-replay gameplay resumption on save load.

---

## [1.1.0] - 2026-11-04 (Android `versionCode`: `10100`)

### Added
- **Google Maps-Style One-Finger Double-Tap Zoom, Inertial Pan Momentum & Custom Pipette Pickers ([`web/src/components/PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx), PR #442, PR #444, PR #445)**:
  - Added one-finger double-tap-and-drag focal zoom, friction-decayed pan momentum gliding, dynamic corner pan margins, custom `<Pipette>` hex color pickers for canvas background and hints, and automated Playwright gallery screenshot capture (`npm run gallery:capture`).

---

## [1.0.0] - 2026-11-01 (Android `versionCode`: `10000`)

### Added
- **Initial Capy Monorepo Release (`web/` & `app/`, PR #441)**:
  - Launched the React 19 + TypeScript + Vite 6 Web Application (`web/`) with 3-tier offscreen canvas caching (`PuzzleCanvas.tsx`), 5-strategy Web Worker segmentation pipeline (`puzzle.worker.ts`), Free Colour mode (`ColorPickerPopover.tsx`), and the unified Kotlin Android `WebViewAssetLoader` wrapper (`app/`).
