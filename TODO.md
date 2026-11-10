# Capy Monorepo -- Master AAA Production Roadmap & Active Priorities

This document tracks active cross-project priorities, production readiness milestones, effort estimates (tokens and wall-clock implementation time), and unimplemented AAA features across the unified **Capy** monorepo (`web/` and `app/`).

> [!NOTE]
> **Task Hygiene Rule**: Do not leave completed items in `TODO.md`. When a task, feature, or milestone is finished, remove it from this file immediately rather than checking it off. Completed history is preserved in Git commits and pull request descriptions. Keep `TODO.md` strictly focused on active, pending work. Never use emojis or ASCII box-drawing art in documentation files.

For subsystem references, see:
- **Web Architecture and UI Reference**: [`WEB.md`](./WEB.md)
- **Puzzle Generation Engine Reference**: [`PUZZLE.md`](./PUZZLE.md)
- **Unified Android Launcher Architecture and Native Bridge**: [`APP.md`](./APP.md)
- **Cloud Sync, Google Play Games & Multiplayer Architecture**: [`CLOUD.md`](./CLOUD.md)
- **Testing Architecture and Verification Guide**: [`TESTING.md`](./TESTING.md)
- **Versioning Scheme and Release History**: [`CHANGELOG.md`](./CHANGELOG.md)
- **Contributor and Agent Playbook**: [`AGENTS.md`](./AGENTS.md)

---

## 1. Priority & Resource Estimation Overview Matrix

> [!IMPORTANT]
> **Token & Time Estimation Methodology**:
> - **Estimated Tokens (`Est. Tokens`)**: Total LLM tokens (context reads + reasoning + code generation + `npm run lint` / `npm run build` / `npm test` verification turns) required for an autonomous coding agent to implement, test, and document the item end-to-end.
> - **Estimated Time (`Est. Time`)**: Reported both as **Autonomous Agent Wall-Clock Time** (including build and Playwright E2E test runs) and **Human Developer Equivalent Time** (for sprint planning).

| Priority Tier | Items | Focus Domain | Aggregate Complexity | Aggregate Difficulty | Est. Total Tokens | Est. Agent Time | Est. Human Dev Time |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Bugfixes -- Audit Findings** | 7 | State Consistency, Viewport Resize, Cloud Concurrency, Android Haptics & Memory Safety | Low to Medium | Easy to Moderate | `~145,000 tokens` | `~65-95 min` | `~11-16 hrs` |
| **P0 -- Critical Polish** | 4 | Sensory Audio, Tactile Juice & Precision Controls | Medium to High | Moderate to Hard | `~145,000 tokens` | `~65-95 min` | `~16-24 hrs` |
| **P1 -- Retention & Accessibility** | 4 | Achievements, Daily Content, Accessibility & Video Export | Medium to High | Moderate to Hard | `~175,000 tokens` | `~80-115 min` | `~22-32 hrs` |
| **P2 -- Engine & Infinite Zoom** | 3 | Focal-Point Infinite Zoom Pyramid & Vector Export | High | Hard | `~130,000 tokens` | `~60-85 min` | `~18-26 hrs` |
| **P3 -- Real-Time Multiplayer** | 4 | Internet Co-op Relay, WebRTC P2P & Undo/Ping Sync | High to Very High | Hard to Expert | `~190,000 tokens` | `~90-130 min` | `~28-40 hrs` |
| **P4 -- Cloud, Storefront & AI** | 4 | Play Console Credentials, AdMob UMP & Live AI Catalog | Medium to High | Moderate to Hard | `~155,000 tokens` | `~70-105 min` | `~20-30 hrs` |
| **P5 -- Multi-Platform Expansion** | 3 | Steam Desktop (`Tauri`), iOS (`WKWebView`) & Microsoft Store | Very High | Hard to Expert | `~170,000 tokens` | `~80-115 min` | `~28-40 hrs` |
| **Total Roadmap** | **29** | **Full Multi-Platform AAA Production Readiness** | **Low to Very High** | **Easy to Expert** | **`~1,110,000 tokens`** | **`~8.5-12.3 hrs`** | **`~143-208 hrs`** |

---

## 2. Label Taxonomy Reference

Every task in this roadmap is tagged with five standardized classification dimensions:

| Label Category | Allowed Values | Meaning & Scope |
| :--- | :--- | :--- |
| **Priority (`priority:*`)** | `P0-fix`, `P0-critical`, `P1-high`, `P2-medium-high`, `P3-medium`, `P4-medium-low`, `P5-long-term` | Execution order and criticality for AAA production readiness. |
| **Work Type (`type:*`)** | `fix`, `feature`, `polish`, `infra`, `integration` | Nature of the engineering change (bug resolution, new gameplay feature, sensory UX polish, or cloud/platform integration). |
| **Subsystem (`domain:*`)** | `canvas`, `ui`, `engine`, `audio`, `a11y`, `cloud`, `multiplayer`, `android`, `ai`, `export`, `desktop`, `ios` | Primary target architecture boundary (`web/`, `app/`, `relay/`, `desktop/`, `ios/`). |
| **Complexity (`complexity:*`)** | `low` (1-2 files, localized), `medium` (2-4 files, state + UI), `high` (4-7 files, cross-layer/worker), `very-high` (multi-package / native + web protocol) | Architectural surface area, state coordination, and number of files touched. |
| **Difficulty (`difficulty:*`)** | `easy` (straightforward logic), `moderate` (careful state/math invariance), `hard` (60 FPS zero-allocation math, WebAudio/WebCodecs, CRDTs), `expert` (distributed P2P signaling, native SDK bridges) | Algorithmic, mathematical, or concurrency challenge level. |

---

## 3. Master Item-by-Item Estimation Ledger

| ID | Task Title | Priority | Type | Domain | Complexity | Difficulty | Est. Tokens | Est. Agent Time | Est. Human Time |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **BF-1** | Free Colour Undo Co-op Desync & Chronological Order Shift | `P0-fix` | `fix` | `multiplayer`, `ui` | `medium` | `moderate` | `~22,000` | `10-15 min` | `2-3 hrs` |
| **BF-2** | Canvas Container Resize & Orientation Change Clamping | `P0-fix` | `fix` | `canvas` | `low` | `easy` | `~18,000` | `8-12 min` | `1-2 hrs` |
| **BF-3** | Google Drive `appDataFolder` Concurrent Write Mutex | `P0-fix` | `fix` | `cloud` | `medium` | `moderate` | `~24,000` | `10-15 min` | `2-3 hrs` |
| **BF-4** | B&W Coloring Book Graph-Coloring Source Fill Preservation | `P0-fix` | `fix` | `engine` | `medium` | `moderate` | `~22,000` | `10-15 min` | `2-3 hrs` |
| **BF-5** | Android `ACTION_SEND` Downsampling & Background Decode | `P0-fix` | `fix` | `android` | `medium` | `moderate` | `~23,000` | `10-15 min` | `2-3 hrs` |
| **BF-6** | IndexedDB Cache Eviction Custom Palette Restoration | `P0-fix` | `fix` | `ui`, `engine` | `low` | `easy` | `~16,000` | `7-10 min` | `1 hrs` |
| **BF-7** | Android Pixel / API 33+ Tactile Haptic Feedback Silent Suppression | `P0-fix` | `fix` | `android` | `low` | `moderate` | `~20,000` | `10-15 min` | `2 hrs` |
| **P0-1** | Procedural Web Audio & ASMR Sound Effects Engine | `P0-critical` | `feature` | `audio`, `ui` | `medium` | `moderate` | `~38,000` | `18-25 min` | `4-6 hrs` |
| **P0-2** | Zero-Allocation Region Fill Micro-Animations & Bursts | `P0-critical` | `polish` | `canvas` | `high` | `hard` | `~42,000` | `20-28 min` | `5-7 hrs` |
| **P0-3** | Floating Precision Loupe Magnifier & Crosshair Offset | `P0-critical` | `feature` | `canvas`, `ui` | `high` | `hard` | `~40,000` | `18-26 min` | `5-7 hrs` |
| **P0-4** | Custom Pinch-to-Zoom Sensitivity & Scale Anchor Snapping | `P0-critical` | `polish` | `canvas`, `ui` | `low` | `moderate` | `~25,000` | `10-16 min` | `2-4 hrs` |
| **P1-1** | In-App Achievement System, Stats & Native Play/Steam Bridges | `P1-high` | `feature` | `ui`, `cloud`, `android` | `high` | `moderate` | `~50,000` | `22-32 min` | `6-9 hrs` |
| **P1-2** | Daily Featured Puzzle Rotation, Streak Calendar & Medals | `P1-high` | `feature` | `ui` | `medium` | `moderate` | `~35,000` | `16-22 min` | `4-6 hrs` |
| **P1-3** | AAA Accessibility Suite (Colorblind Patterns, Reduced Motion, Keys) | `P1-high` | `feature` | `a11y`, `canvas`, `ui` | `high` | `hard` | `~45,000` | `20-30 min` | `6-8 hrs` |
| **P1-4** | Replay Animation Video (`.webm` / `.mp4`) & GIF Export | `P1-high` | `feature` | `export`, `canvas` | `high` | `hard` | `~45,000` | `22-30 min` | `6-9 hrs` |
| **P2-1** | Focal-Point Quadtree Sub-Tile Navigation & Breadcrumbs | `P2-medium-high` | `feature` | `canvas`, `engine`, `ui` | `high` | `hard` | `~42,000` | `20-28 min` | `6-8 hrs` |
| **P2-2** | AI Seam-Locked Detail Inpainting for Infinite Zoom Sub-Tiles | `P2-medium-high` | `integration` | `ai`, `engine` | `high` | `hard` | `~48,000` | `22-32 min` | `7-10 hrs` |
| **P2-3** | Printable Vector SVG / PDF Coloring Sheet Exporter | `P2-medium-high` | `feature` | `export`, `engine` | `medium` | `hard` | `~40,000` | `18-25 min` | `5-8 hrs` |
| **P3-1** | Co-op Collaborator Undo Sync (`UNFILL_EVENT`) & Ping Beacon | `P3-medium` | `feature` | `multiplayer`, `canvas` | `medium` | `moderate` | `~35,000` | `16-24 min` | `4-6 hrs` |
| **P3-2** | Hosted Hibernating WebSocket Room Relay (`VITE_CAPY_ROOM_WS_URL`) | `P3-medium` | `infra` | `multiplayer`, `cloud` | `high` | `hard` | `~50,000` | `25-35 min` | `8-12 hrs` |
| **P3-3** | WebRTC DataChannel P2P Upgrade & Custom Photo Transfer | `P3-medium` | `feature` | `multiplayer` | `very-high` | `expert` | `~65,000` | `30-45 min` | `10-14 hrs` |
| **P3-4** | Ephemeral Encrypted Cloud Blob Relay for Custom Share Links | `P3-medium` | `infra` | `cloud`, `multiplayer` | `medium` | `hard` | `~40,000` | `18-26 min` | `6-8 hrs` |
| **P4-1** | Google Play Console Production Credentials & `assetlinks.json` | `P4-medium-low` | `infra` | `android`, `cloud` | `low` | `easy` | `~20,000` | `10-15 min` | `2-4 hrs` |
| **P4-2** | Native Google UMP Consent + AdMob Rewarded Video SDK (`app/`) | `P4-medium-low` | `integration` | `android`, `ui` | `high` | `hard` | `~48,000` | `22-32 min` | `7-10 hrs` |
| **P4-3** | Live In-App AI Artwork Generation Endpoint (`VITE_CAPY_AI_API_URL`) | `P4-medium-low` | `integration` | `ai`, `ui` | `medium` | `moderate` | `~42,000` | `18-28 min` | `5-8 hrs` |
| **P4-4** | Shared Multi-User Backend & Automated `.capy` v2 Gallery Publisher | `P4-medium-low` | `infra` | `cloud`, `engine` | `high` | `hard` | `~45,000` | `20-30 min` | `6-8 hrs` |
| **P5-1** | Steam Desktop Wrapper (`desktop/`) & `SteamCloudDriver` Bindings | `P5-long-term` | `integration` | `desktop`, `cloud` | `very-high` | `expert` | `~60,000` | `28-40 min` | `10-14 hrs` |
| **P5-2** | iOS & iPadOS Native Wrapper (`ios/`) & `AppleCloudDriver` Bindings | `P5-long-term` | `integration` | `ios`, `cloud` | `very-high` | `expert` | `~65,000` | `30-45 min` | `12-16 hrs` |
| **P5-3** | Microsoft Store / Xbox Wrapper & `MicrosoftCloudDriver` Bindings | `P5-long-term` | `integration` | `desktop`, `cloud` | `high` | `hard` | `~45,000` | `22-30 min` | `6-10 hrs` |

---

## 4. Priority Bugfixes (Codebase Audit Findings)

- [ ] **BF-1: Free Colour Undo Co-op Desync & Chronological Order Shift ([`web/src/App.tsx`](./web/src/App.tsx))**:
  - **Labels**: `[priority: P0-fix]` `[type: fix]` `[domain: multiplayer]` `[domain: ui]` `[complexity: medium]` `[difficulty: moderate]`
  - **Estimates**: `Est. Tokens: ~22,000 tokens` | `Est. Time: ~10-15 min agent (~2-3 hrs human dev)`
  - **Scope**: Repainting an already-filled region in Free Colour mode currently deletes and re-inserts the region ID at the tail of `filledRegionIds`, altering its original fill chronology, and undoing a Free Colour repaint when `previousPaintedColorId !== undefined` omits broadcasting a color-restoration `CoopPaintEvent` to connected Co-op collaborators.
- [ ] **BF-2: Canvas Container Resize & Orientation Change Stale Offset Clamping ([`web/src/components/PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx))**:
  - **Labels**: `[priority: P0-fix]` `[type: fix]` `[domain: canvas]` `[complexity: low]` `[difficulty: easy]`
  - **Estimates**: `Est. Tokens: ~18,000 tokens` | `Est. Time: ~8-12 min agent (~1-2 hrs human dev)`
  - **Scope**: `clampCanvasOffset` executes inside an effect watching `[scale, puzzle]` rather than observing container dimension changes via `ResizeObserver`, leaving pan offsets unclamped after mobile screen rotation or browser window resizing until the next zoom gesture.
- [ ] **BF-3: Google Drive `appDataFolder` Duplicate Slot File Accumulation on Concurrent Writes ([`web/src/services/providers/CloudProviderDrivers.ts`](./web/src/services/providers/CloudProviderDrivers.ts))**:
  - **Labels**: `[priority: P0-fix]` `[type: fix]` `[domain: cloud]` `[complexity: medium]` `[difficulty: moderate]`
  - **Estimates**: `Est. Tokens: ~24,000 tokens` | `Est. Time: ~10-15 min agent (~2-3 hrs human dev)`
  - **Scope**: `writeSlotEnvelope` and `writeBinaryBlob` query `findFileByName` before uploading without an in-memory per-slot mutex or file-ID cache (unlike `cachedManifestFileId`), allowing rapid back-to-back syncs to create duplicate slot files in Drive `appDataFolder`.
- [ ] **BF-4: B&W Coloring Book Graph-Coloring Overwrites Source Fill Hints ([`web/src/engine/PuzzleGenerator.ts`](./web/src/engine/PuzzleGenerator.ts))**:
  - **Labels**: `[priority: P0-fix]` `[type: fix]` `[domain: engine]` `[complexity: medium]` `[difficulty: moderate]`
  - **Estimates**: `Est. Tokens: ~22,000 tokens` | `Est. Time: ~10-15 min agent (~2-3 hrs human dev)`
  - **Scope**: In `LineArtPuzzleGenerator`, the greedy graph-coloring pass unconditionally overwrites `reg.colorId` for all regions when `isColoringBook` is true, discarding explicit non-white source accent fills in hybrid B&W illustrations.
- [ ] **BF-5: Android `ACTION_SEND` Large Image OOM & UI Thread Blocking Risk ([`app/src/main/java/com/capypaint/capy/MainActivity.kt`](./app/src/main/java/com/capypaint/capy/MainActivity.kt))**:
  - **Labels**: `[priority: P0-fix]` `[type: fix]` `[domain: android]` `[complexity: medium]` `[difficulty: moderate]`
  - **Estimates**: `Est. Tokens: ~23,000 tokens` | `Est. Time: ~10-15 min agent (~2-3 hrs human dev)`
  - **Scope**: `handleIncomingIntent` reads the entire shared `InputStream` into a `ByteArray` and Base64-encodes it synchronously on the UI thread without downsampling or size-capping ultra-high-resolution camera photos, risking `OutOfMemoryError` or ANR on low-RAM devices.
- [ ] **BF-6: IndexedDB Cache Eviction Fallback Drops Custom Palette Modifications ([`web/src/App.tsx`](./web/src/App.tsx))**:
  - **Labels**: `[priority: P0-fix]` `[type: fix]` `[domain: ui]` `[domain: engine]` `[complexity: low]` `[difficulty: easy]`
  - **Estimates**: `Est. Tokens: ~16,000 tokens` | `Est. Time: ~7-10 min agent (~1 hr human dev)`
  - **Scope**: When `StorageService.loadPuzzleData(snapshot.id)` returns `null` in `handleLoadSnapshot` and falls back to regenerating the puzzle via `loadArtworkFromImage`, user-edited `snapshot.customPalette` swatches are overwritten by the newly quantized palette.
- [ ] **BF-7: Android Pixel / API 33+ Tactile Haptic Feedback Silent Suppression ([`app/src/main/java/com/capypaint/capy/CapyAndroidBridge.kt`](./app/src/main/java/com/capypaint/capy/CapyAndroidBridge.kt), [`app/src/main/java/com/capypaint/capy/MainActivity.kt`](./app/src/main/java/com/capypaint/capy/MainActivity.kt))**:
  - **Labels**: `[priority: P0-fix]` `[type: fix]` `[domain: android]` `[complexity: low]` `[difficulty: moderate]`
  - **Estimates**: `Est. Tokens: ~20,000 tokens` | `Est. Time: ~10-15 min agent (~2 hrs human dev)`
  - **Scope**: Verified on Pixel 7 Pro hardware: `performHaptic` in [`CapyAndroidBridge.kt`](./app/src/main/java/com/capypaint/capy/CapyAndroidBridge.kt) currently calls `view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)` for `"tick"` events without `HapticFeedbackConstants.FLAG_IGNORE_VIEW_SETTING` or a `Vibrator` fallback, and calls `vibrator.vibrate(VibrationEffect)` without `VibrationAttributes.createForUsage(VibrationAttributes.USAGE_TOUCH)` on API 33+ (Android 13+). Because `Capy` controls haptics via its own in-app `settings.hapticsEnabled` toggle, `performHaptic` must pass `VibrationAttributes.USAGE_TOUCH` (or `AudioAttributes.USAGE_ASSISTANCE_SONIFICATION` on API < 33) and use crisp `VibrationEffect.createPredefined(VibrationEffect.EFFECT_CLICK)` / `EFFECT_TICK` / `EFFECT_HEAVY_CLICK` primitives on API 29+ so tactile feedback is reliably felt on Pixel devices.

---

## 5. Priority P0: AAA Sensory Polish, Tactile Audio & Precision Controls

- [ ] **P0-1: Procedural Web Audio & ASMR Sound Effects Engine (`web/src/services/SoundService.ts`)**:
  - **Labels**: `[priority: P0-critical]` `[type: feature]` `[domain: audio]` `[domain: ui]` `[complexity: medium]` `[difficulty: moderate]`
  - **Estimates**: `Est. Tokens: ~38,000 tokens` | `Est. Time: ~18-25 min agent (~4-6 hrs human dev)`
  - **Scope**:
    - Build a zero-asset, offline-first Web Audio API synthesizer generating soft brush/paper strokes on region tap, harmonic pentatonic marimba/woodblock pitch progression during continuous Paint Mode streaks, a warm chord arpeggio when all regions of a color swatch are completed, and a celebratory fanfare on 100% puzzle completion.
    - Add `soundEnabled: boolean` (default `true`) and `soundVolume: number` (`0.0` to `1.0`, default `0.7`) to `UserSettings` (`capy_user_settings_v8`) in [`web/src/types/index.ts`](./web/src/types/index.ts) and [`SettingsModal.tsx`](./web/src/components/SettingsModal.tsx), and automatically suspend/resume `AudioContext` on page visibility changes and Android activity pause/resume.
- [ ] **P0-2: Zero-Allocation Region Fill Micro-Animations & Swatch Completion Bursts (`PuzzleCanvas.tsx`)**:
  - **Labels**: `[priority: P0-critical]` `[type: polish]` `[domain: canvas]` `[complexity: high]` `[difficulty: hard]`
  - **Estimates**: `Est. Tokens: ~42,000 tokens` | `Est. Time: ~20-28 min agent (~5-7 hrs human dev)`
  - **Scope**:
    - Extend the demand-driven `requestAnimationFrame` overlay pass in [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx) using a pre-allocated typed ring buffer (mirroring [`CoopRippleBuffer.ts`](./web/src/engine/CoopRippleBuffer.ts)) to render a 180ms radial ink-spread / spring-bloom transition when a region is painted and a subtle shimmer wave across all regions of a newly completed palette color.
- [ ] **P0-3: Floating Precision Loupe Magnifier & Crosshair Offset for Tiny Micro-Regions**:
  - **Labels**: `[priority: P0-critical]` `[type: feature]` `[domain: canvas]` `[domain: ui]` `[complexity: high]` `[difficulty: hard]`
  - **Estimates**: `Est. Tokens: ~40,000 tokens` | `Est. Time: ~18-26 min agent (~5-7 hrs human dev)`
  - **Scope**:
    - Add an optional press-and-hold or Paint Mode floating magnifier lens (`showMagnifierLoupe: boolean` in `UserSettings`) offset 72px above the active touch point in [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx) so players on mobile screens can accurately target `< 50px` micro-regions without finger occlusion.
- [ ] **P0-4: Custom Pinch-to-Zoom Sensitivity & Scale Anchor Snapping (`1x`, `2x`, `4x`, `8x`)**:
  - **Labels**: `[priority: P0-critical]` `[type: polish]` `[domain: canvas]` `[domain: ui]` `[complexity: low]` `[difficulty: moderate]`
  - **Estimates**: `Est. Tokens: ~25,000 tokens` | `Est. Time: ~10-16 min agent (~2-4 hrs human dev)`
  - **Scope**:
    - Add configurable `zoomSensitivity: number` (`0.5x` to `2.0x`, default `1.0x`) and `snapZoomLevels: boolean` (optional magnetic detents at `1x`, `2x`, `4x`, `8x`, and `12x`) in [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx) and [`SettingsModal.tsx`](./web/src/components/SettingsModal.tsx).

---

## 6. Priority P1: Player Progression, Daily Challenges, Accessibility & Video Export

- [ ] **P1-1: In-App Achievement System, Player Statistics & Native Play Games / Steam Bridges**:
  - **Labels**: `[priority: P1-high]` `[type: feature]` `[domain: ui]` `[domain: cloud]` `[domain: android]` `[complexity: high]` `[difficulty: moderate]`
  - **Estimates**: `Est. Tokens: ~50,000 tokens` | `Est. Time: ~22-32 min agent (~6-9 hrs human dev)`
  - **Scope**:
    - Create `AchievementService.ts` tracking lifetime player telemetry (`totalRegionsColored`, `puzzlesCompleted`, `zeroHintPuzzles`, `fastestCompletionMs`, `freeColorCreations`, `coopRegionsPainted`, `currentDailyStreak`) persisted in `localStorage` and merged via CRDT in [`CloudProviderDrivers.ts`](./web/src/services/providers/CloudProviderDrivers.ts).
    - Render non-blocking achievement unlock toast banners and a dedicated **Profile & Achievements** drawer in [`SettingsModal.tsx`](./web/src/components/SettingsModal.tsx).
    - Define Play Console achievement and leaderboard IDs in `app/src/main/res/values/games-ids.xml` and expose `NativeBridge.unlockAchievement(id)`, `NativeBridge.incrementAchievement(id, steps)`, and `NativeBridge.submitLeaderboardScore(id, score)` in [`CapyAndroidBridge.kt`](./app/src/main/java/com/capypaint/capy/CapyAndroidBridge.kt) and [`NativeBridge.ts`](./web/src/services/NativeBridge.ts).
- [ ] **P1-2: Daily Featured Puzzle Rotation, Streak Calendar & Medal Tiers**:
  - **Labels**: `[priority: P1-high]` `[type: feature]` `[domain: ui]` `[complexity: medium]` `[difficulty: moderate]`
  - **Estimates**: `Est. Tokens: ~35,000 tokens` | `Est. Time: ~16-22 min agent (~4-6 hrs human dev)`
  - **Scope**:
    - Add a deterministic "Puzzle of the Day" card at the top of the **Create** tab in [`SettingsModal.tsx`](./web/src/components/SettingsModal.tsx) with a visual streak counter, optional relaxed vs. zero-hint challenge badges, and automatic completion recording.
- [ ] **P1-3: AAA Accessibility Suite (Colorblind Pattern Overlays, High-Contrast HUD & Reduced Motion)**:
  - **Labels**: `[priority: P1-high]` `[type: feature]` `[domain: a11y]` `[domain: canvas]` `[domain: ui]` `[complexity: high]` `[difficulty: hard]`
  - **Estimates**: `Est. Tokens: ~45,000 tokens` | `Est. Time: ~20-30 min agent (~6-8 hrs human dev)`
  - **Scope**:
    - Add a `colorblindPatternMode: boolean` setting that overlays distinct geometric textures (dots, diagonal stripes, crosshatch, checkerboard) onto active and hinted regions in [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx) so region guidance never relies solely on color perception.
    - Add `reducedMotion: boolean` (automatically respecting `prefers-reduced-motion: reduce`) to bypass confetti, camera zoom transitions, and pulsing hint animations, and add full keyboard arrow/WASD pan + `+`/`-` zoom + `1`-`9` swatch selection shortcuts.
- [ ] **P1-4: Replay Animation Video (`.webm` / `.mp4`) & Animated GIF Export**:
  - **Labels**: `[priority: P1-high]` `[type: feature]` `[domain: export]` `[domain: canvas]` `[complexity: high]` `[difficulty: hard]`
  - **Estimates**: `Est. Tokens: ~45,000 tokens` | `Est. Time: ~22-30 min agent (~6-9 hrs human dev)`
  - **Scope**:
    - Allow players to export their chronological puzzle completion replay directly from [`ReplayControls.tsx`](./web/src/components/ReplayControls.tsx) as a shareable high-resolution timelapse video (`HTMLCanvasElement.captureStream(60)` + `MediaRecorder` / WebCodecs) or animated image sequence via `NativeBridge.exportOrShareFile`.

---

## 7. Priority P2: Interactive Infinite Zoom Pyramid & Vector Print Exports

- [ ] **P2-1: Focal-Point Quadtree Sub-Tile Navigation & Parent Breadcrumb Stack**:
  - **Labels**: `[priority: P2-medium-high]` `[type: feature]` `[domain: canvas]` `[domain: engine]` `[domain: ui]` `[complexity: high]` `[difficulty: hard]`
  - **Estimates**: `Est. Tokens: ~42,000 tokens` | `Est. Time: ~20-28 min agent (~6-8 hrs human dev)`
  - **Scope**:
    - Extend `handleZoomIntoDetailTile` in [`App.tsx`](./web/src/App.tsx) so players can zoom into the exact `(focusX, focusY)` viewport center they are currently inspecting on [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx) rather than a fixed center crop.
    - Persist `parentSnapshotId` and `subTileBounds` on `SavedSnapshot` and render a one-tap "Return to Parent Puzzle" breadcrumb pill in [`GameTopBar.tsx`](./web/src/components/GameTopBar.tsx) that seamlessly restores the parent puzzle viewport.
- [ ] **P2-2: AI Seam-Locked Detail Inpainting for Infinite Zoom Sub-Tiles**:
  - **Labels**: `[priority: P2-medium-high]` `[type: integration]` `[domain: ai]` `[domain: engine]` `[complexity: high]` `[difficulty: hard]`
  - **Estimates**: `Est. Tokens: ~48,000 tokens` | `Est. Time: ~22-32 min agent (~7-10 hrs human dev)`
  - **Scope**:
    - Wire [`DefaultAiArtworkAdapter.buildSeamLockedInfillPrompt`](./web/src/services/providers/ProviderRegistry.ts) to an image-to-image / outpainting model that synthesizes high-frequency micro-details (foliage, textures, tiny critters) inside zoomed sub-tiles while clamping outer border pixels to `lockedBoundaryPaletteHex` for invisible parent seams.
- [ ] **P2-3: Printable Vector SVG / PDF Coloring Sheet Exporter**:
  - **Labels**: `[priority: P2-medium-high]` `[type: feature]` `[domain: export]` `[domain: engine]` `[complexity: medium]` `[difficulty: hard]`
  - **Estimates**: `Est. Tokens: ~40,000 tokens` | `Est. Time: ~18-25 min agent (~5-8 hrs human dev)`
  - **Scope**:
    - Add a "Export Printable Line Art (SVG / PDF)" action in [`SettingsModal.tsx`](./web/src/components/SettingsModal.tsx) that traces `borderMap` and `region.centroidX`/`centroidY` labels into a crisp, resolution-independent SVG coloring page for physical printing.

---

## 8. Priority P3: Real-Time Co-op Multiplayer & Cross-Device Sharing Infrastructure

- [ ] **P3-1: Co-op Collaborator Undo Sync (`UNFILL_EVENT`) & Interactive "Ping Region" Beacon**:
  - **Labels**: `[priority: P3-medium]` `[type: feature]` `[domain: multiplayer]` `[domain: canvas]` `[complexity: medium]` `[difficulty: moderate]`
  - **Estimates**: `Est. Tokens: ~35,000 tokens` | `Est. Time: ~16-24 min agent (~4-6 hrs human dev)`
  - **Scope**:
    - Broadcast `UNFILL_EVENT` and Free Colour re-paint messages over [`HybridCoopRoomAdapter`](./web/src/services/providers/ProviderRegistry.ts) when a collaborator undoes a region fill so all peer canvases stay strictly consistent during undo/redo.
    - Add a tap-and-hold "Ping Region" beacon on [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx) rendered via [`CoopRippleBuffer.ts`](./web/src/engine/CoopRippleBuffer.ts) so collaborators can highlight a tricky micro-region or call attention to a specific area on large puzzles.
- [ ] **P3-2: Hosted Hibernating WebSocket Room Relay Server (`VITE_CAPY_ROOM_WS_URL`)**:
  - **Labels**: `[priority: P3-medium]` `[type: infra]` `[domain: multiplayer]` `[domain: cloud]` `[complexity: high]` `[difficulty: hard]`
  - **Estimates**: `Est. Tokens: ~50,000 tokens` | `Est. Time: ~25-35 min agent (~8-12 hrs human dev)`
  - **Scope**:
    - Implement and deploy a lightweight hibernating WebSocket room relay (Cloudflare Worker + Durable Objects in a `relay/` workspace package) backing [`HybridCoopRoomAdapter`](./web/src/services/providers/ProviderRegistry.ts) so 6-character Co-op room codes (`?room=ABC123`) connect players across separate devices and networks over the internet.
- [ ] **P3-3: WebRTC DataChannel Peer-to-Peer Upgrade & Custom Photo Transfer in Co-op Rooms**:
  - **Labels**: `[priority: P3-medium]` `[type: feature]` `[domain: multiplayer]` `[complexity: very-high]` `[difficulty: expert]`
  - **Estimates**: `Est. Tokens: ~65,000 tokens` | `Est. Time: ~30-45 min agent (~10-14 hrs human dev)`
  - **Scope**:
    - Upgrade WebSocket room signaling to negotiate direct `RTCPeerConnection` / `RTCDataChannel` links between room participants so real-time `PAINT_EVENT` strokes and custom user-uploaded `.capy` v2 puzzle packs stream directly peer-to-peer without server storage overhead.
- [ ] **P3-4: Ephemeral Encrypted Cloud Blob Relay for Custom Photo Share Links (`#s=<token>`)**:
  - **Labels**: `[priority: P3-medium]` `[type: infra]` `[domain: cloud]` `[domain: multiplayer]` `[complexity: medium]` `[difficulty: hard]`
  - **Estimates**: `Est. Tokens: ~40,000 tokens` | `Est. Time: ~18-26 min agent (~6-8 hrs human dev)`
  - **Scope**:
    - Add an opt-in encrypted `.capy` v2 blob upload (content-addressed SHA-256 key with 30-day TTL in object storage) so players can share `#s=<token>` URL links for custom uploaded photos across devices just as seamlessly as built-in Gallery artworks.

---

## 9. Priority P4: Production Storefront Credentials, Cloud Providers & Live AI Catalog

- [ ] **P4-1: Google Play Console Production Credentials & Verified `assetlinks.json`**:
  - **Labels**: `[priority: P4-medium-low]` `[type: infra]` `[domain: android]` `[domain: cloud]` `[complexity: low]` `[difficulty: easy]`
  - **Estimates**: `Est. Tokens: ~20,000 tokens` | `Est. Time: ~10-15 min agent (~2-4 hrs human dev)`
  - **Scope**:
    - Provision the production 12-digit Play Games Project ID (`CAPY_PLAY_GAMES_APP_ID`) and Web OAuth Client ID (`VITE_GOOGLE_CLIENT_ID`), register Upload Key and Play App Signing SHA-1/SHA-256 certificate fingerprints in Google Play Console, and publish `web/public/.well-known/assetlinks.json` so `android:autoVerify="true"` App Links verify automatically on Android devices.
- [ ] **P4-2: Native Google UMP Consent + AdMob Rewarded Video SDK Integration (`app/`)**:
  - **Labels**: `[priority: P4-medium-low]` `[type: integration]` `[domain: android]` `[domain: ui]` `[complexity: high]` `[difficulty: hard]`
  - **Estimates**: `Est. Tokens: ~48,000 tokens` | `Est. Time: ~22-32 min agent (~7-10 hrs human dev)`
  - **Scope**:
    - Bundle `com.google.android.ump:user-messaging-platform` and `com.google.android.gms:play-services-ads` in [`app/build.gradle.kts`](./app/build.gradle.kts), wire GDPR/CCPA consent forms in [`MainActivity.kt`](./app/src/main/java/com/capypaint/capy/MainActivity.kt), and implement `CapyAndroidBridge.showRewardedAd()` with Server-Side Verification (SSV) callbacks to fund optional AI puzzle generation credits while keeping core coloring 100% ad-free.
- [ ] **P4-3: Live In-App AI Artwork Generation Endpoint (`VITE_CAPY_AI_API_URL`)**:
  - **Labels**: `[priority: P4-medium-low]` `[type: integration]` `[domain: ai]` `[domain: ui]` `[complexity: medium]` `[difficulty: moderate]`
  - **Estimates**: `Est. Tokens: ~42,000 tokens` | `Est. Time: ~18-28 min agent (~5-8 hrs human dev)`
  - **Scope**:
    - Connect [`DefaultAiArtworkAdapter`](./web/src/services/providers/ProviderRegistry.ts) to a live serverless image generation endpoint (Imagen 3 / Gemini / Flux) and add a "Generate Custom AI Puzzle from Prompt" workflow in the Create tab that spends verified `AiCreditLedger` credits and feeds the generated illustration directly into `puzzle.worker.ts`.
- [ ] **P4-4: Shared Multi-User Backend & Automated `.capy` v2 Gallery Publisher for Community Ideas**:
  - **Labels**: `[priority: P4-medium-low]` `[type: infra]` `[domain: cloud]` `[domain: engine]` `[complexity: high]` `[difficulty: hard]`
  - **Estimates**: `Est. Tokens: ~45,000 tokens` | `Est. Time: ~20-30 min agent (~6-8 hrs human dev)`
  - **Scope**:
    - Connect `StaticAndCommunityCatalogAdapter` (`capy_community_ideas_v1`) to a rate-limited, moderated backend API so player-submitted ideas and upvotes sync globally, paired with a scheduled GitHub Actions workflow that pre-bakes top-voted ideas into `.capy` v2 packs (`catalog/v1/index.json`).

---

## 10. Priority P5: Multi-Platform Desktop (Steam / Tauri), iOS & Microsoft Store Packaging

- [ ] **P5-1: Steam Desktop Wrapper (`desktop/`) & `SteamCloudDriver` Bindings**:
  - **Labels**: `[priority: P5-long-term]` `[type: integration]` `[domain: desktop]` `[domain: cloud]` `[complexity: very-high]` `[difficulty: expert]`
  - **Estimates**: `Est. Tokens: ~60,000 tokens` | `Est. Time: ~28-40 min agent (~10-14 hrs human dev)`
  - **Scope**:
    - Scaffold a Tauri v2 desktop wrapper (`desktop/`) hosting `web/dist/` with `steamworks-rs` adapters wired to [`SteamCloudDriver`](./web/src/services/providers/CloudProviderDrivers.ts) (`ISteamRemoteStorage` Cloud Saves, Steam Achievements, Steam Overlay, and Rich Presence).
- [ ] **P5-2: iOS & iPadOS Native Wrapper (`ios/`) & `AppleCloudDriver` Bindings**:
  - **Labels**: `[priority: P5-long-term]` `[type: integration]` `[domain: ios]` `[domain: cloud]` `[complexity: very-high]` `[difficulty: expert]`
  - **Estimates**: `Est. Tokens: ~65,000 tokens` | `Est. Time: ~30-45 min agent (~12-16 hrs human dev)`
  - **Scope**:
    - Scaffold a Swift `WKWebView` iOS/iPadOS wrapper connected to `window.webkit.messageHandlers.CapyIOS` and [`AppleCloudDriver`](./web/src/services/providers/CloudProviderDrivers.ts), supporting Apple Pencil hover/pressure, CoreHaptics, Sign in with Apple / GameKit (`GKLocalPlayer`), and CloudKit `privateCloudDatabase` save sync.
- [ ] **P5-3: Microsoft Store / Xbox Wrapper & `MicrosoftCloudDriver` Bindings**:
  - **Labels**: `[priority: P5-long-term]` `[type: integration]` `[domain: desktop]` `[domain: cloud]` `[complexity: high]` `[difficulty: hard]`
  - **Estimates**: `Est. Tokens: ~45,000 tokens` | `Est. Time: ~22-30 min agent (~6-10 hrs human dev)`
  - **Scope**:
    - Connect [`MicrosoftCloudDriver`](./web/src/services/providers/CloudProviderDrivers.ts) to live Microsoft Entra ID / MSA OAuth 2.0 PKCE credentials for OneDrive `special/approot` and Xbox Connected Storage synchronization.
