# Capy Product Backlog — Lean Agile Epics, Stories & Tasks (`TODO.md`)

Active, prioritized product and engineering backlog for the **Capy** monorepo ([`web/`](./web/) and [`app/`](./app/)). Structured under **Capy Lean Agile** (`EPIC` -> `Story / Bug` -> `1-PR Tasks`; full standard in [`DEV.md`](./DEV.md#capy-lean-agile-backlog--todomd-entry-standard)).

**Related Guides**: [`README.md`](./README.md) | [`DEV.md`](./DEV.md) | [`AGENTS.md`](./AGENTS.md) | [`WEB.md`](./WEB.md) | [`PUZZLE.md`](./PUZZLE.md) | [`APP.md`](./APP.md) | [`CLOUD.md`](./CLOUD.md) | [`TESTING.md`](./TESTING.md) | [`CHANGELOG.md`](./CHANGELOG.md)

**Table of Contents**:
1. [Quick-Win Ready Queue (`<= 15 min` Agent / `Flash`-Ready)](#1-quick-win-ready-queue--15-min-agent--flash-ready)
2. [`EPIC-2`: Mobile Touch Precision & Tactile Sensory Polish](#2-epic-2-mobile-touch-precision--tactile-sensory-polish)
3. [`EPIC-3`: Daily Retention, Inclusive Accessibility & Shareable Replays](#3-epic-3-daily-retention-inclusive-accessibility--shareable-replays)
4. [`EPIC-4`: Serverless Infinite Zoom, Printable Art & Local Co-op Polish](#4-epic-4-serverless-infinite-zoom-printable-art--local-co-op-polish)
5. [`EPIC-5`: Production Cloud Auth, Cross-Network Co-op & Optional AI Creation](#5-epic-5-production-cloud-auth-cross-network-co-op--optional-ai-creation)
6. [Unscheduled Platform Icebox (`ICE-1`--`ICE-3`)](#6-unscheduled-platform-icebox-ice-1--ice-3)

<details>
<summary>Capy Lean Agile Methodology, Entry Quick-Reference & Backlog Totals</summary>

- **3-Tier Delivery Hierarchy**:
  - **Epics (`EPIC-2`..`EPIC-5`)**: Player-outcome pillars ordered strictly by execution priority.
  - **Stories (`US-*`) & Bugs (`BUG-*`)**: Cohesive player capabilities or verified defects. Every card displays **Description**, **Value**, **Why Now**, and **1-line Shippable Tasks** visibly on mobile, tucking verbose tags, estimates, file paths, and acceptance criteria inside `<details>`.
  - **Tasks (`TASK-*`)**: Independently mergeable `1-PR` slices. `[quick-win]` marks `<= 15 min` agent tasks (`1--3` files, zero external backend blockers, suitable for `Flash`).
- **Definition of Ready (Anti-Busywork Gate)**: Items enter `TODO.md` *only* when they deliver measurable gameplay delight, accessibility, retention, or crash/test reliability. Zero-impact chores, unused dependency pruning with zero binary impact, placeholder config scaffolds, and ad-SDK bloat are rejected.
- **Definition of Done (Immediate Deletion)**: Never leave `[x]` checkboxes in `TODO.md`. When a `TASK-*` ships, delete that `TASK-*` line (and its Quick-Win Ready Queue pointer) in the same PR; when a Story or Bug's final task ships, delete the entire card. History lives in Git and [`CHANGELOG.md`](./CHANGELOG.md).
- **Active Backlog Rollup (`15` Stories across `4` Epics, `7` `[quick-win]` tasks)**:
  - `EPIC-2` (*3 Stories*): `~104k tokens` | `~48--69 min agent` (`~12.5--17.5 hrs human`).
  - `EPIC-3` (*4 Stories*): `~175k tokens` | `~80--115 min agent` (`~22--32 hrs human`).
  - `EPIC-4` (*3 Stories*): `~117k tokens` | `~54--77 min agent` (`~15--22 hrs human`).
  - `EPIC-5` (*5 Stories*): `~245k tokens` | `~113--165 min agent` (`~34--50 hrs human`).
  - **Active Total**: `~641k tokens` | `~4.9--7.1 hrs agent` (`~83.5--121.5 hrs human`).

</details>

---

## 1. Quick-Win Ready Queue (`<= 15 min` Agent / `Flash`-Ready)

Self-contained `1-PR` tasks (`1--3` files, zero external backend dependencies) ready to pull and ship immediately with `Flash` or `Pro`:

1. **`TASK-3.1a`** ([`US-3.1`](#us-31-daily-featured-puzzle--streak-medals)): Add deterministic UTC "Puzzle of the Day" hero card at the top of the **Create** tab.
2. **`TASK-3.2a`** ([`US-3.2`](#us-32-inclusive-accessibility--reduced-motion-keyboard--colorblind-patterns)): Add `reducedMotion` setting (auto-detecting `prefers-reduced-motion: reduce`) to skip confetti, camera glides, and hint pulses.
3. **`TASK-3.2b`** ([`US-3.2`](#us-32-inclusive-accessibility--reduced-motion-keyboard--colorblind-patterns)): Add `1`--`9` swatch select, `+`/`-` zoom, `0` reset view, and Arrow/WASD pan keyboard shortcuts.
4. **`TASK-3.4a`** ([`US-3.4`](#us-34-lifetime-player-statistics--milestone-achievements)): Build local `PlayerStatsService.ts` (`capy_player_stats_v1`) and a **Lifetime Stats** card in Settings.
5. **`TASK-4.1a`** ([`US-4.1`](#us-41-focal-point-quadtree-sub-tiles--parent-breadcrumbs)): Persist `parentSnapshotId` on detail tiles and show a "Back to Parent Puzzle" pill in `GameTopBar.tsx`.
6. **`TASK-4.2a`** ([`US-4.2`](#us-42-printable-vector-svg--pdf-coloring-sheet-exporter)): Build `SvgPrintExporter.ts` exporting `borderMap` outlines, region numbers, and swatch legend as `.svg`.
7. **`TASK-4.3a`** ([`US-4.3`](#us-43-co-op-collaborator-undo-sync--region-ping-beacon)): Broadcast `'UNFILL_EVENT'` over `HybridCoopRoomAdapter` so initial-fill Undo syncs across Co-op peers.

---

## 2. `EPIC-2`: Mobile Touch Precision & Tactile Sensory Polish

**Epic Goal**: Make core region tapping, micro-detail targeting, zooming, and stroke feedback feel effortless and deeply satisfying on phones and tablets.

### US-2.1: Floating Precision Loupe Magnifier for Micro-Regions

- **Description**: Render an optional floating circular magnifier lens (`showMagnifierLoupe`) offset `72px` above the active finger during press-and-hold or Paint Mode drags on `PuzzleCanvas.tsx`.
- **Value**: Eliminates mobile "fat-finger" occlusion so players can target tiny `< 50px` micro-regions accurately without constantly zooming to `16x` and back out.
- **Why Now**: Intricate stained-glass and detailed photo puzzles generate small regions that hide directly beneath a fingertip; solving thumb occlusion is the highest-impact mobile usability upgrade left.
- **Tasks**:
  - **TASK-2.1a**: Render a zero-allocation `2.5x` magnified composite cutout + crosshair lens in `PuzzleCanvas.tsx` (flipping cleanly below/beside top HUD edges).
  - **TASK-2.1b**: Add `showMagnifierLoupe: boolean` setting toggle in `SettingsModal.tsx` Controls and Playwright E2E touch-hold verification.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | `EPIC-2` | `priority: critical` | `domain: canvas, ui`
- **Complexity & Model**: `high` / `hard` | **Recommended Model**: `Pro` (`/plan`)
- **Effort Estimate**: `~40,000 tokens` | `~18--26 min agent` (`~5--7 hrs human`)
- **Target Files**: [`web/src/components/PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx), [`web/src/components/SettingsModal.tsx`](./web/src/components/SettingsModal.tsx), [`web/src/types/index.ts`](./web/src/types/index.ts), [`WEB.md`](./WEB.md)
- **Acceptance Criteria**:
  - Reuses existing offscreen `compositeCanvasRef` via `ctx.drawImage` clipping with zero per-frame `OffscreenCanvas` or object allocations inside `requestAnimationFrame`.
  - Automatically repositions when within `96px` of the top viewport edge so the lens is never clipped offscreen.

</details>

### US-2.3: Zero-Asset Procedural ASMR Web Audio Engine

- **Description**: Build a pure Web Audio API synthesizer (`SoundService.ts`) producing soft brush/woodblock taps, rising pentatonic Paint Mode streak notes, swatch-completion chord arpeggios, and puzzle-completion chimes.
- **Value**: Adds warm, relaxing tactile audio feedback that pairs with mobile haptics while adding `0 KB` of MP3/WAV bundle weight and working 100% offline.
- **Why Now**: Soft woodblock region-tap audio is now live (`SoundService.ts`); layering melodic Paint Mode streak notes and completion chimes finishes the tactile audio experience.
- **Tasks**:
  - **TASK-2.3b**: Layer harmonic pentatonic streak progression during Paint Mode drags, warm swatch-clear arpeggios, and 100% puzzle completion chimes.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | `EPIC-2` | `priority: critical` | `domain: audio, ui`
- **Complexity & Model**: `medium` / `moderate` | **Recommended Model**: `Pro`
- **Effort Estimate**: `~22,000 tokens` | `~10--15 min agent` (`~2.5--3.5 hrs human`)
- **Target Files**: [`web/src/services/SoundService.ts`](./web/src/services/SoundService.ts), [`web/src/App.tsx`](./web/src/App.tsx), [`WEB.md`](./WEB.md)
- **Acceptance Criteria**:
  - Rising pentatonic streak notes reset cleanly after gesture idle (`> 450ms`), and swatch/puzzle completion arpeggios respect `soundEnabled`, `soundVolume`, and `document.hidden` auto-suspend.

</details>

### US-2.4: Zero-Allocation Region Fill Bloom & Swatch Shimmer

- **Description**: Animate region fills with a `180ms` radial ink-bloom and highlight newly completed palette swatches with a brief shimmer wave across matching regions in `PuzzleCanvas.tsx`.
- **Value**: Makes every region tap feel alive and gives clear visual celebration when finishing all regions of a color number without interrupting flow.
- **Why Now**: Instant single-frame pixel swaps can feel abrupt on large regions; adding a typed-array ring-buffer bloom completes the core sensory triad (visual bloom + procedural sound + LRA haptics).
- **Tasks**:
  - **TASK-2.4a**: Create a pre-allocated typed-array fill-animation ring buffer (mirroring `CoopRippleBuffer.ts`) driving a `180ms` radial clip bloom in `PuzzleCanvas.tsx`.
  - **TASK-2.4b**: Trigger a `400ms` celebratory highlight pulse across completed-swatch centroids when a palette color reaches `0` remaining regions (respecting `reducedMotion`).

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | `EPIC-2` | `priority: critical` | `domain: canvas`
- **Complexity & Model**: `high` / `hard` | **Recommended Model**: `Pro`
- **Effort Estimate**: `~42,000 tokens` | `~20--28 min agent` (`~5--7 hrs human`)
- **Target Files**: [`web/src/components/PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx), [`web/src/engine/CoopRippleBuffer.ts`](./web/src/engine/CoopRippleBuffer.ts), [`WEB.md`](./WEB.md)
- **Acceptance Criteria**:
  - Zero heap allocations (`Float32Array` / `Int32Array` fixed ring buffer) during `requestAnimationFrame`, returning to `0%` CPU idle once the `180ms` / `400ms` window expires.

</details>

---

## 3. `EPIC-3`: Daily Retention, Inclusive Accessibility & Shareable Replays

**Epic Goal**: Give players a reason to return daily, make every puzzle accessible regardless of color vision or motor preference, and turn replays into shareable videos—100% client-side with zero backend.

### US-3.1: Daily Featured Puzzle & Streak Medals

- **Description**: Surface a deterministic UTC date-seeded "Puzzle of the Day" hero card in the **Create** tab with consecutive-day streak tracking and Relaxed vs. Zero-Hint completion medals.
- **Value**: Removes choice paralysis on launch and builds a lightweight, rewarding daily coloring habit that works completely offline.
- **Why Now**: Delivers high player retention with zero server cost by deterministically rotating curated `SAMPLE_GALLERY` artworks and preset variations by UTC date.
- **Tasks**:
  - **TASK-3.1a** `[quick-win]`: Render a deterministic UTC date-seeded "Puzzle of the Day" card at the top of the **Create** tab in `SettingsModal.tsx` with one-tap launch.
  - **TASK-3.1b**: Persist daily completion history (`capy_daily_streak_v1`), consecutive-day streak counter, and Relaxed vs. Zero-Hint medal badges.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | `EPIC-3` | `priority: high` | `domain: ui`
- **Complexity & Model**: `medium` / `moderate` | **Recommended Model**: `Flash`
- **Effort Estimate**: `~35,000 tokens` (`~15k` + `~20k`) | `~16--22 min agent` (`~4--6 hrs human`)
- **Target Files**: [`web/src/components/SettingsModal.tsx`](./web/src/components/SettingsModal.tsx), [`web/src/App.tsx`](./web/src/App.tsx), [`web/src/types/index.ts`](./web/src/types/index.ts), [`WEB.md`](./WEB.md)
- **Acceptance Criteria**:
  - Same UTC calendar date resolves to the identical featured artwork + preset across all devices offline, covered by Playwright E2E assertions.

</details>

### US-3.2: Inclusive Accessibility — Reduced Motion, Keyboard & Colorblind Patterns

- **Description**: Add `reducedMotion` support, full desktop keyboard gameplay (`1`--`9` swatches, `+/-` zoom, `0` reset, Arrow/WASD pan), and geometric `CanvasPattern` hatch overlays (`colorblindPatternMode`) for active/hinted regions.
- **Value**: Ensures players with color-vision deficiency, vestibular motion sensitivity, or keyboard-first setups can play comfortably without relying solely on hue contrast or pointer drags.
- **Why Now**: Color-by-number games inherently risk excluding deuteranopia/protanopia/tritanopia players on similar palette shades; shipping client-side accessibility unlocks inclusive play immediately.
- **Tasks**:
  - **TASK-3.2a** `[quick-win]`: Add `reducedMotion: boolean` (seeded from `prefers-reduced-motion: reduce`) in `SettingsModal.tsx` to skip `canvas-confetti`, smooth camera glides, and hint pulses.
  - **TASK-3.2b** `[quick-win]`: Extend `handleKeyDown` in `App.tsx` and `PuzzleCanvas.tsx` with `1`--`9` swatch selection, `+`/`-` zoom, `0` reset view, and Arrow/WASD viewport panning.
  - **TASK-3.2c**: Add `colorblindPatternMode: boolean` rendering cached `CanvasPattern` geometric textures (dots, stripes, crosshatch, checkerboard) over active and hinted regions.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | `EPIC-3` | `priority: high` | `domain: a11y, canvas, ui`
- **Complexity & Model**: `high` / `hard` | **Recommended Model**: `Flash` (`3.2a`, `3.2b`), `Pro` (`3.2c`)
- **Effort Estimate**: `~45,000 tokens` (`~14k` + `~14k` + `~17k`) | `~20--30 min agent` (`~6--8 hrs human`)
- **Target Files**: [`web/src/App.tsx`](./web/src/App.tsx) (`#L1590-L1606`), [`web/src/components/PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx), [`web/src/components/SettingsModal.tsx`](./web/src/components/SettingsModal.tsx), [`web/src/types/index.ts`](./web/src/types/index.ts), [`WEB.md`](./WEB.md), [`README.md`](./README.md)
- **Acceptance Criteria**:
  - Keyboard shortcuts ignore events while typing inside `<input>` / `<textarea>` fields.
  - `CanvasPattern` tiles are generated once at setup/theme change—zero per-frame pattern creation inside `requestAnimationFrame`.

</details>

### US-3.3: Shareable Timelapse Replay Video (`.webm` / `.mp4`) Export

- **Description**: Add an "Export Timelapse Video" button in `ReplayControls.tsx` recording the puzzle's chronological fill animation via `HTMLCanvasElement.captureStream(60)` + `MediaRecorder` and sharing via `NativeBridge.exportOrShareFile`.
- **Value**: Turns Capy's existing YouTube-style replay scrubber into a one-tap shareable timelapse video for friends and social feeds, driving organic word-of-mouth discovery.
- **Why Now**: The chronological `replaySequence` and predictive camera framing already exist in `PuzzleCanvas.tsx`; adding `MediaRecorder` export unlocks high-value sharing with zero server encoding cost.
- **Tasks**:
  - **TASK-3.3a**: Build `ReplayVideoExporter.ts` (`MediaRecorder` `video/mp4` / `video/webm` fallback + progress bar + clean cancellation) rendering offscreen or locked-frame timelapse playback.
  - **TASK-3.3b**: Wire an Export Video button in `ReplayControls.tsx` and completion banner to `NativeBridge.exportOrShareFile` with feature-detection fallback.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | `EPIC-3` | `priority: high` | `domain: export, canvas`
- **Complexity & Model**: `high` / `hard` | **Recommended Model**: `Pro`
- **Effort Estimate**: `~45,000 tokens` | `~22--30 min agent` (`~6--9 hrs human`)
- **Target Files**: `web/src/services/ReplayVideoExporter.ts`, [`web/src/components/ReplayControls.tsx`](./web/src/components/ReplayControls.tsx), [`web/src/components/PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx), [`web/src/services/NativeBridge.ts`](./web/src/services/NativeBridge.ts), [`WEB.md`](./WEB.md)
- **Acceptance Criteria**:
  - Prefers `video/mp4;codecs=avc1` where supported (Safari/Chrome) with automatic `video/webm;codecs=vp9` fallback, releasing all `MediaStreamTrack` handles on finish or cancel.

</details>

### US-3.4: Lifetime Player Statistics & Milestone Achievements

- **Description**: Track lifetime coloring stats (`totalRegionsColored`, `puzzlesCompleted`, `zeroHintPuzzles`, `fastestCompletionMs`, `freeColorCreations`, `coopRegionsPainted`) with non-blocking milestone unlock toasts, CRDT cloud sync, and optional Play Games hooks.
- **Value**: Rewards long-term mastery across Easy, Hard, Free Colour, and Co-op modes without cluttering the minimalist coloring canvas.
- **Why Now**: Decoupling `TASK-3.4a` (local stats) from `TASK-3.4b` (achievements + cloud/Play bridges) lets players start accumulating lifetime progress immediately before Play Console IDs (`US-5.1`) are provisioned.
- **Tasks**:
  - **TASK-3.4a** `[quick-win]`: Create `PlayerStatsService.ts` (`capy_player_stats_v1`) and render a **Lifetime Stats** summary card in `SettingsModal.tsx`.
  - **TASK-3.4b**: Add milestone achievement unlock toasts, monotonic CRDT stat merging in `CloudProviderDrivers.ts`, and `NativeBridge` Play Games achievement hooks.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | `EPIC-3` | `priority: high` | `domain: ui, cloud, android`
- **Complexity & Model**: `high` / `moderate` | **Recommended Model**: `Flash` (`3.4a`), `Pro` (`3.4b`)
- **Effort Estimate**: `~50,000 tokens` (`~18k` + `~32k`) | `~22--32 min agent` (`~6--9 hrs human`)
- **Target Files**: `web/src/services/PlayerStatsService.ts`, [`web/src/components/SettingsModal.tsx`](./web/src/components/SettingsModal.tsx), [`web/src/services/providers/CloudProviderDrivers.ts`](./web/src/services/providers/CloudProviderDrivers.ts), [`web/src/services/NativeBridge.ts`](./web/src/services/NativeBridge.ts), [`WEB.md`](./WEB.md)
- **Acceptance Criteria**:
  - Stat counters merge monotonically (`Math.max` / set-count union) across devices so syncing an older offline tab never decrements lifetime totals.

</details>

---

## 4. `EPIC-4`: Serverless Infinite Zoom, Printable Art & Local Co-op Polish

**Epic Goal**: Complete Capy's signature offline creative workflows—focal-point sub-tile exploration, physical paper coloring sheets, and seamless local Co-op—before introducing external backend infrastructure.

### US-4.1: Focal-Point Quadtree Sub-Tiles & Parent Breadcrumbs

- **Description**: Upgrade `handleZoomIntoDetailTile` from a fixed `2x` center crop to generate detail sub-tiles centered on the player's active `(focusX, focusY)` viewport focus, paired with a one-tap "Back to Parent Puzzle" breadcrumb pill in `GameTopBar.tsx`.
- **Value**: Makes Infinite Zoom genuinely exploratory—players can dive into any interesting corner of an artwork and jump right back to the parent canvas without hunting through the Saves list.
- **Why Now**: The base `2x` crop pipeline already exists in `App.tsx` (`#L3319`), but lacks parent navigation and focal-point targeting; finishing both completes the local Infinite Zoom loop cleanly.
- **Tasks**:
  - **TASK-4.1a** `[quick-win]`: Add `parentSnapshotId?: string` to `SavedSnapshot` and render a one-tap "Back to Parent Puzzle" breadcrumb pill in `GameTopBar.tsx`.
  - **TASK-4.1b**: Upgrade `handleZoomIntoDetailTile` to crop around the active `(focusX, focusY)` viewport center with persisted `subTileBounds` for multi-depth navigation.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | `EPIC-4` | `priority: medium-high` | `domain: canvas, engine, ui`
- **Complexity & Model**: `high` / `hard` | **Recommended Model**: `Flash` (`4.1a`), `Pro` (`4.1b`)
- **Effort Estimate**: `~42,000 tokens` (`~16k` + `~26k`) | `~20--28 min agent` (`~6--8 hrs human`)
- **Target Files**: [`web/src/App.tsx`](./web/src/App.tsx) (`#L3319`), [`web/src/components/GameTopBar.tsx`](./web/src/components/GameTopBar.tsx), [`web/src/components/PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx), [`web/src/types/index.ts`](./web/src/types/index.ts), [`WEB.md`](./WEB.md)
- **Acceptance Criteria**:
  - Returning to a parent snapshot restores its saved zoom/pan viewport cleanly; deleting a parent snapshot gracefully clears dangling `parentSnapshotId` pills.

</details>

### US-4.2: Printable Vector SVG / PDF Coloring Sheet Exporter

- **Description**: Allow players to export any generated puzzle (built-in or custom photo) as a crisp, resolution-independent monochrome `.svg` / print-ready PDF coloring page with region outlines, numbers, and a bottom color-key legend.
- **Value**: Bridges digital and physical play—parents, teachers, and artists can turn family photos or line art into physical paper coloring sheets in seconds.
- **Why Now**: `puzzle.worker.ts` already computes clean `borderMap` contours and guaranteed-fit `centroidX`/`centroidY` label coordinates; exporting them to SVG requires zero server infrastructure.
- **Tasks**:
  - **TASK-4.2a** `[quick-win]`: Build `SvgPrintExporter.ts` tracing `borderMap` outlines, region numbers, and a swatch-number key into an `.svg` download via `NativeBridge.exportOrShareFile`.
  - **TASK-4.2b**: Add print sheet layout options in `SettingsModal.tsx` (A4 vs. Letter aspect framing, line thickness, optional number hiding for freehand coloring, and browser Print/PDF trigger).

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | `EPIC-4` | `priority: medium-high` | `domain: export, engine`
- **Complexity & Model**: `medium` / `hard` | **Recommended Model**: `Flash`
- **Effort Estimate**: `~40,000 tokens` (`~18k` + `~22k`) | `~18--25 min agent` (`~5--8 hrs human`)
- **Target Files**: `web/src/services/SvgPrintExporter.ts`, [`web/src/components/SettingsModal.tsx`](./web/src/components/SettingsModal.tsx), [`web/src/services/NativeBridge.ts`](./web/src/services/NativeBridge.ts), [`WEB.md`](./WEB.md)
- **Acceptance Criteria**:
  - Generated `.svg` opens cleanly in Chrome/Firefox/Safari and prints cleanly on white paper without dark UI backgrounds.

</details>

### US-4.3: Co-op Collaborator Undo Sync & Region Ping Beacon

- **Description**: Broadcast `'UNFILL_EVENT'` messages when a collaborator undoes a first-time fill and add a tap-and-hold `'PING_EVENT'` beacon rendered via `CoopRippleBuffer.ts` on `PuzzleCanvas.tsx`.
- **Value**: Keeps all Co-op canvases 100% consistent when someone undoes an accidental tap and lets partners point out hard-to-find micro-regions visually.
- **Why Now**: Works immediately over same-device `BroadcastChannel` Co-op today with zero server changes, and automatically carries forward once the cross-network WebSocket relay (`US-5.2`) goes live.
- **Tasks**:
  - **TASK-4.3a** `[quick-win]`: Add `'UNFILL_EVENT'` to `RealtimeRoomMessage` and `HybridCoopRoomAdapter` so undoing a first-time fill clears that region on peer canvases.
  - **TASK-4.3b**: Add `'PING_EVENT'` beacon broadcasting and expanding dual-ring rendering in `CoopRippleBuffer.ts` and `PuzzleCanvas.tsx`.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | `EPIC-4` | `priority: medium-high` | `domain: multiplayer, canvas`
- **Complexity & Model**: `medium` / `moderate` | **Recommended Model**: `Flash` (`4.3a`), `Pro` (`4.3b`)
- **Effort Estimate**: `~35,000 tokens` (`~15k` + `~20k`) | `~16--24 min agent` (`~4--6 hrs human`)
- **Target Files**: [`web/src/services/providers/types.ts`](./web/src/services/providers/types.ts), [`web/src/services/providers/ProviderRegistry.ts`](./web/src/services/providers/ProviderRegistry.ts), [`web/src/engine/CoopRippleBuffer.ts`](./web/src/engine/CoopRippleBuffer.ts), [`web/src/components/PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx), [`CLOUD.md`](./CLOUD.md)
- **Acceptance Criteria**:
  - 2-peer Playwright `BroadcastChannel` E2E test verifies that Peer A filling then undoing a region leaves Peer B's region unfilled cleanly.

</details>

---

## 5. `EPIC-5`: Production Cloud Auth, Cross-Network Co-op & Optional AI Creation

**Epic Goal**: Connect Capy's hexagonal cloud, room-sync, and AI provider interfaces (`ProviderRegistry.ts`) to live production credentials and lightweight serverless endpoints when ready for public store and cross-network scale.

### US-5.1: Production Google OAuth, Play Games IDs & Verified App Links

- **Description**: Provision production Google Cloud Web OAuth Client ID (`VITE_GOOGLE_CLIENT_ID`), 12-digit Play Games Project ID (`CAPY_PLAY_GAMES_APP_ID`), and signed SHA-256 fingerprints in `web/public/.well-known/assetlinks.json`.
- **Value**: Unlocks live one-tap Google Drive cross-device save sync on web, native Play Games `SnapshotsClient` sync on Android, and seamless Android App Link opening for shared `#s=<token>` puzzle links.
- **Why Now**: Placed first in `EPIC-5` because `GoogleCloudDriver`, `PlayGamesAndroidDriver`, and `privacy-policy.html` are already built and tested—only live console credentials remain to light them up in production.
- **Tasks**:
  - **TASK-5.1a**: Provision Play Console & Google Cloud OAuth credentials, configure repository build secrets, and publish verified `web/public/.well-known/assetlinks.json`.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | `EPIC-5` | `priority: medium` | `domain: android, cloud`
- **Complexity & Model**: `low` / `easy` | **Recommended Model**: `Flash` + Human Console Setup
- **Effort Estimate**: `~20,000 tokens` | `~10--15 min agent` (`~2--4 hrs human`)
- **Target Files**: `web/public/.well-known/assetlinks.json`, [`app/build.gradle.kts`](./app/build.gradle.kts), [`.github/workflows/deploy-branch.yml`](./.github/workflows/deploy-branch.yml), [`CLOUD.md`](./CLOUD.md)
- **Acceptance Criteria**:
  - `https://shthed.github.io/.well-known/assetlinks.json` (or custom domain) validates against `pm get-app-links com.capypaint.capy` and Google OAuth sign-in succeeds without sandbox overrides.

</details>

### US-5.2: Hosted Hibernating WebSocket Co-op Room Relay (`VITE_CAPY_ROOM_WS_URL`)

- **Description**: Deploy a lightweight stateless/hibernating WebSocket room relay (`relay/` Cloudflare Worker + Durable Objects) backing `HybridCoopRoomAdapter` for 6-character `?room=ABC123` codes.
- **Value**: Lets friends and family color the same puzzle together in real time across separate phones, tablets, and laptops over the internet—not just tabs on the same browser.
- **Why Now**: `HybridCoopRoomAdapter` already implements the WebSocket room protocol (`HELLO`, `WELCOME_STATE`, `PAINT_EVENT`, `HEARTBEAT`, `LEAVE`); a minimal hibernating relay activates cross-device Co-op with near-zero idle cost.
- **Tasks**:
  - **TASK-5.2a**: Scaffold `relay/` Durable Object room worker enforcing message size caps (`<= 4 KB`), room TTLs, and rate limits with local `wrangler` integration tests.
  - **TASK-5.2b**: Wire `VITE_CAPY_ROOM_WS_URL` in CI and add cross-context WebSocket reconnection E2E coverage in `web/scripts/test.mjs`.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | `EPIC-5` | `priority: medium` | `domain: multiplayer, cloud`
- **Complexity & Model**: `high` / `hard` | **Recommended Model**: `Pro` (`/plan`)
- **Effort Estimate**: `~50,000 tokens` | `~25--35 min agent` (`~8--12 hrs human`)
- **Target Files**: `relay/`, [`web/src/services/providers/ProviderRegistry.ts`](./web/src/services/providers/ProviderRegistry.ts), [`CLOUD.md`](./CLOUD.md)
- **Acceptance Criteria**:
  - Hibernates between strokes (`0` billable CPU ms while idle) and automatically falls back to `BroadcastChannel` when offline or unconfigured.

</details>

### US-5.3: Ephemeral Encrypted Blob Relay for Custom Photo Share Links

- **Description**: Add opt-in client-side AES-GCM encrypted `.capy` v2 blob upload (`30`-day TTL, key kept exclusively in the URL `#` fragment) so `#s=<token>` share links work across devices for custom uploaded photos.
- **Value**: Removes the current limitation where `#s=<token>` links work across devices only for built-in Gallery artworks while keeping user photos zero-knowledge encrypted.
- **Why Now**: Custom photo puzzles (`45--95 KB` `.capy` v2) cannot fit inside a `< 2 KB` URL hash alone; a content-addressed ephemeral blob store completes universal link sharing privately.
- **Tasks**:
  - **TASK-5.3a**: Implement WebCrypto AES-GCM pack encryption/decryption in `ShareLinkService.ts` paired with a size-capped (`<= 200 KB`), `30`-day TTL blob endpoint and Privacy Policy disclosure update.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | `EPIC-5` | `priority: medium` | `domain: cloud, multiplayer`
- **Complexity & Model**: `medium` / `hard` | **Recommended Model**: `Pro`
- **Effort Estimate**: `~40,000 tokens` | `~18--26 min agent` (`~6--8 hrs human`)
- **Target Files**: [`web/src/services/ShareLinkService.ts`](./web/src/services/ShareLinkService.ts), [`web/public/privacy-policy.html`](./web/public/privacy-policy.html), [`CLOUD.md`](./CLOUD.md)
- **Acceptance Criteria**:
  - Decryption key stays strictly inside `#s=...` (never transmitted in HTTP requests), and built-in Gallery `#s=` links continue using zero network calls.

</details>

### US-5.4: Live Prompt-to-Puzzle & Seam-Locked Sub-Tile AI Artwork Endpoint

- **Description**: Connect `DefaultAiArtworkAdapter` (`VITE_CAPY_AI_API_URL`) to a serverless image-generation endpoint supporting both "Create Puzzle from Text Prompt" and seam-locked detail inpainting (`buildSeamLockedInfillPrompt`) for Infinite Zoom sub-tiles.
- **Value**: Gives players an endless supply of custom coloring-book illustrations from imagination and synthesizes crisp new micro-details when zooming deep into sub-tiles.
- **Why Now**: Kept in `EPIC-5` behind client polish because live image generation incurs per-request API cost and rate-limiting governance (`AiCreditLedger`).
- **Tasks**:
  - **TASK-5.4a**: Connect `DefaultAiArtworkAdapter` to `VITE_CAPY_AI_API_URL` and add a "Generate AI Artwork" prompt flow in the **Create** tab feeding `puzzle.worker.ts`.
  - **TASK-5.4b**: Wire `buildSeamLockedInfillPrompt` (`lockedBoundaryPaletteHex`) into Infinite Zoom sub-tile generation (`US-4.1`) for seamless parent-border transitions.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | `EPIC-5` | `priority: medium-low` | `domain: ai, engine, ui`
- **Complexity & Model**: `high` / `hard` | **Recommended Model**: `Pro`
- **Effort Estimate**: `~90,000 tokens` (`~42k` + `~48k`) | `~40--60 min agent` (`~12--18 hrs human`)
- **Target Files**: [`web/src/services/providers/ProviderRegistry.ts`](./web/src/services/providers/ProviderRegistry.ts), [`web/src/components/SettingsModal.tsx`](./web/src/components/SettingsModal.tsx), [`web/src/App.tsx`](./web/src/App.tsx), [`CLOUD.md`](./CLOUD.md)
- **Acceptance Criteria**:
  - Enforces family-friendly prompt moderation prior to API dispatch and degrades cleanly when offline or unconfigured.

</details>

### US-5.5: Moderated Global Community Ideas & Automated `.capy` Pack Publisher

- **Description**: Back `StaticAndCommunityCatalogAdapter` (`capy_community_ideas_v1`) with a moderated shared API so player puzzle ideas and upvotes sync globally, paired with a scheduled workflow that pre-bakes top-voted ideas into `.capy` v2 gallery packs.
- **Value**: Turns the currently local-only Community Puzzle Ideas box into a living, player-curated artwork catalog where popular requests automatically become playable zero-wait puzzles.
- **Why Now**: Sequenced last in `EPIC-5` because it builds directly on the AI generation pipeline (`US-5.4`) to synthesize and package top-voted community prompts.
- **Tasks**:
  - **TASK-5.5a**: Connect `StaticAndCommunityCatalogAdapter` to a rate-limited, profanity-filtered community ideas/upvotes endpoint with offline `localStorage` fallback.
  - **TASK-5.5b**: Add a scheduled GitHub Actions publisher generating `.capy` v2 archives for approved top-voted ideas into `catalog/v1/index.json`.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | `EPIC-5` | `priority: medium-low` | `domain: cloud, engine`
- **Complexity & Model**: `high` / `hard` | **Recommended Model**: `Pro`
- **Effort Estimate**: `~45,000 tokens` | `~20--30 min agent` (`~6--8 hrs human`)
- **Target Files**: [`web/src/services/providers/ProviderRegistry.ts`](./web/src/services/providers/ProviderRegistry.ts), `.github/workflows/`, [`CLOUD.md`](./CLOUD.md)
- **Acceptance Criteria**:
  - Client continues working 100% offline with bundled + cached catalog entries if the community API is unreachable.

</details>

---

## 6. Unscheduled Platform Icebox (`ICE-1`--`ICE-3`)

Parked native desktop/mobile store wrappers awaiting completion of `EPIC-2`--`EPIC-4` Web/Android stabilization before active scheduling:

<details>
<summary>Expand Unscheduled Multi-Platform Shell Epics (Steam, iOS/iPadOS, Microsoft/Xbox)</summary>

- **`ICE-1`: Steam Desktop Wrapper (`desktop/` Tauri v2) & `SteamCloudDriver` Bindings**:
  - *Value*: Packages `web/dist/` for Windows/macOS/Linux Steam Deck & desktop players with `ISteamRemoteStorage` Cloud Saves, Steam Achievements, and Steam Overlay (`SteamCloudDriver` in [`CloudProviderDrivers.ts`](./web/src/services/providers/CloudProviderDrivers.ts) is already modularly stubbed).
  - *Activation Trigger*: Promote to an active Epic only after `EPIC-2`--`EPIC-4` desktop keyboard, audio, and achievement contracts stabilize (`~60k tokens`, `Pro`).
- **`ICE-2`: iOS & iPadOS Native Wrapper (`ios/` Swift `WKWebView`) & `AppleCloudDriver` Bindings**:
  - *Value*: Delivers App Store distribution with Apple Pencil hover/tilt ergonomics, CoreHaptics, GameKit (`GKLocalPlayer`), and CloudKit save sync (`window.webkit.messageHandlers.CapyIOS` + `AppleCloudDriver`).
  - *Activation Trigger*: Promote when Apple Developer Storefront distribution is scheduled (`~65k tokens`, `Pro`).
- **`ICE-3`: Microsoft Store / Xbox Wrapper & `MicrosoftCloudDriver` Bindings**:
  - *Value*: Connects `MicrosoftCloudDriver` to live Entra ID / MSA OAuth 2.0 PKCE credentials for OneDrive `special/approot` and Xbox Connected Storage sync.
  - *Activation Trigger*: Promote alongside desktop/console storefront packaging (`~45k tokens`, `Pro`).

</details>
