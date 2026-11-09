# Web Architecture & Technical Design: Capy Web (`web/`)

This document provides a comprehensive technical reference for the updated Capy Web application located in [`web/`](./web/). It covers the architectural design, component hierarchy, rendering pipeline, gesture handling, state management, background worker engine, native Android bridge, and persistence systems.

---

## 1. Architectural Overview & Design Principles

Capy Web is a high-performance, client-side, color-by-number generator and interactive canvas player built with **React 19**, **TypeScript**, **Vite 6**, and **Tailwind CSS 4**.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             Application Shell                               │
│                         (App.tsx — State & Layout)                          │
├────────────────────────────────┬────────────────────────────────────────────┤
│ Viewport & Presentation        │ Engine & Background Services               │
│  ├─ GameTopBar                 │  ├─ PuzzleWorkerService (Web Worker)       │
│  ├─ PuzzleCanvas (2D Canvas)   │  │    └─ 5-Strategy Segmentation Engine    │
│  ├─ FloatingActions            │  ├─ StorageService (IndexedDB + LS)        │
│  ├─ PaletteDock                │  └─ NativeBridge (Android / WebKit / Web)  │
│  ├─ ColorPickerPopover         │                                            │
│  ├─ SettingsModal (4 Tabs)     │                                            │
│  ├─ ReplayControls             │                                            │
│  └─ LoadingOverlay             │                                            │
└────────────────────────────────┴────────────────────────────────────────────┘
```

### Core Tenets
1. **Zero Server Dependency**: All image processing, quantization, vector segmentation, and progress storage run 100% on the client. Puzzles can be generated and played completely offline.
2. **60 FPS Canvas Rendering**: Instead of rendering thousands of individual DOM or SVG elements, Capy utilizes an **offscreen-cached HTML5 2D Canvas pipeline** that selectively repaints only modified regions.
3. **Responsive Non-Blocking UI**: Compute-intensive computer-vision algorithms run inside a dedicated **Web Worker**, providing continuous progress feedback without dropping frames or freezing UI threads.
4. **Single Source of Truth**: The code in `web/` powers both the web deployment ([`https://shthed.github.io/capy/`](https://shthed.github.io/capy/)) and the native Android app ([`app/`](./app/)) via an extensible, low-overhead native bridge.
5. **Edge-to-Edge Responsive Layout**: Full hardware safe area inset management (`--sat`, `--sab`, `--sal`, `--sar`) ensures seamless layouts across mobile notches, tablets, foldable devices, and widescreen desktops.

---

## 2. Directory & Module Structure

```
web/
├── index.html                 # HTML host document with mobile viewport & safe-area meta
├── package.json               # React 19, Vite 6, Tailwind CSS 4, Lucide icons, canvas-confetti
├── tsconfig.json              # Strict TypeScript configuration
├── vite.config.ts             # Vite configuration with relative asset base ('./')
└── src/
    ├── main.tsx               # React DOM bootstrap
    ├── App.tsx                # Master container, state orchestration, keyboard shortcuts
    ├── index.css              # Tailwind CSS 4 imports, safe area utilities, touch reset
    ├── types/
    │   └── index.ts           # Central TypeScript interfaces, enums, defaults, sample gallery
    ├── components/
    │   ├── PuzzleCanvas.tsx   # Offscreen cached 2D canvas, pan/zoom gestures, hit testing, live generation FX
    │   ├── GameTopBar.tsx     # Progress indicator, title, preview toggle, settings button
    │   ├── PaletteDock.tsx    # Scrollable color palette, remaining count, sort modes
    │   ├── FloatingActions.tsx# Undo, Replay, drag-to-color Paint Mode toggle, zoom +/-, view reset
    │   ├── SettingsModal.tsx  # 4-tab configuration sheet (Settings, Hints, Create, Saves)
    │   ├── ReplayControls.tsx # Floating playback HUD for chronological region completion replays
    │   ├── ColorPickerPopover.tsx # Custom color picker & palette presets for Free Colour mode
    │   └── LoadingOverlay.tsx # Bottom-anchored progress HUD with expandable 6-stage pipeline inspector
    ├── services/
    │   ├── NativeBridge.ts    # Android `@JavascriptInterface` & WebKit bridge (haptics, back button)
    │   ├── PwaService.ts      # PWA install prompt, standalone detection & service worker lifecycle
    │   ├── PuzzleWorkerService.ts # Worker lifecycle, job cancellation, promise dispatch
    │   └── StorageService.ts  # IndexedDB (large blobs) + LocalStorage (settings/snapshots)
    └── engine/
        ├── puzzle.worker.ts   # Web Worker message handler
        ├── PuzzleGenerator.ts # Multi-strategy coordinator & monotonic progress emitter
        ├── ImageAnalyzer.ts   # Heuristic classifier (variance ratio, line art presence)
        ├── LineArtExtractor.ts# Luminance & Sobel gradient ink outline extractor
        ├── ColorQuantizer.ts  # Perceptual Red-Mean K-Means++ color clustering
        └── RegionSegmenter.ts # 4-connected flood fill, slender merging, watershed border absorption
```

---

## 3. Component Hierarchy & Layering

The UI uses a fixed, layered viewport stack where pointer events pass through empty spaces to the canvas below (`pointer-events-none` on overlay containers, `pointer-events-auto` on interactive controls):

```
┌────────────────────────────────────────────────────────────────────────┐
│ [Z-30] GameTopBar: [ Title • Progress % ]      [ Eye ] [ + ] [ Gear ]  │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│                                                                        │
│                     [Z-0] PuzzleCanvas                                 │
│                   (Interactive Pan & Zoom)                             │
│                                                                        │
│                                                                        │
│                                                [Z-20] FloatingActions  │
│                                                       [ Replay ]       │
│                                                       [ Fit to Screen ]│
│                                                       [ Zoom In (+) ]  │
│                                                       [ Zoom Out (-) ] │
│                                                       [ Undo ]         │
│                                                       [ Paint Brush ]  │
├────────────────────────────────────────────────────────────────────────┤
│ [Z-20] PaletteDock: [Color] (1)  (2)  (3)  (4)  (5) ... [Hint]         │
└────────────────────────────────────────────────────────────────────────┘
  [Z-30] ReplayControls (Floating bottom HUD during chronological replay)
  [Z-40] LoadingOverlay (Bottom-anchored HUD with expandable pipeline drawer)
  [Z-50] SettingsModal / ColorPickerPopover
```

### Component Breakdown

| Component | Responsibility | Key Interactions |
| :--- | :--- | :--- |
| [**`PuzzleCanvas`**](file:///home/antigravity/shthed/capy/web/src/components/PuzzleCanvas.tsx) | Renders the puzzle with 3-tier offscreen caching, handles gestures, hit-tests pixel taps, and renders live background generation visualization. | Single-finger drag (pan), pinch (zoom), Google Maps-style one-finger double-tap-and-drag zoom, smooth pan momentum gliding, tap (color region), drag (continuous paint mode), animated fit-to-screen zoom-out, and 60 FPS organic radial contour generation overlay. |
| [**`GameTopBar`**](file:///home/antigravity/shthed/capy/web/src/components/GameTopBar.tsx) | Displays puzzle title, overall completion percentage, quick actions. | Tap title to open Saves tab; toggle preview mode; enter/exit fullscreen; import image; open settings. |
| [**`PaletteDock`**](file:///home/antigravity/shthed/capy/web/src/components/PaletteDock.tsx) | Horizontal scrolling list of numbered color swatches with completion badges. | Tap swatch to select active color; tap active swatch again to trigger hint; tap custom color button to open picker. Guarantees persistent active color selection even when 0 matching regions remain on-screen. Supports dynamic sorting (Number, Remaining, Hue, Lightness) and viewport culling. |
| [**`FloatingActions`**](file:///home/antigravity/shthed/capy/web/src/components/FloatingActions.tsx) | Secondary floating action buttons positioned above the palette dock. | Undo last completed region (`Ctrl+Z` / `Cmd+Z`, disabled by default for standard puzzles, enabled automatically for free colour puzzles or via Settings toggle); long-press Undo (>=450ms) to open Replay timeline scrubber; conditional Redo button positioned above Undo (`Ctrl+Y` / `Ctrl+Shift+Z`) to re-apply undone regions (hidden until an action is undone); trigger Replay when completed; toggle continuous Paint Mode; zoom in/out; reset view to fit screen. |
| [**`SettingsModal`**](file:///home/antigravity/shthed/capy/web/src/components/SettingsModal.tsx) | Full modal sheet with 4 tabbed sections and automatic active tab persistence. | Automatically restores the last active tab index from `localStorage` (`capy_last_settings_tab`).<br>**Settings**: Preferences, difficulty, auto-advance, replay speed (`0.5x`–`10x`), minimal `Replay on Load` toggle, pan momentum toggle, canvas background (preset circular swatches + `<Pipette>` custom hex/color picker), dock elevation, label scale, and Android APK direct download link.<br>**Hints**: Hint styles, hint highlight colour (circular swatches + `<Pipette>`), hint intensity, animated hint pulse.<br>**Create**: Algorithm selection, color counts, min region area, line handling, sample artwork picker, device photo upload.<br>**Saves**: Unified sticky top control region combining all options, view switches, selected save actions, and library utilities (Sort dropdown, minimal `Replay on Load` toggle, Detail/Thumbnails view switcher, named save action buttons [Pin/Unpin, Load/Resume, Replay, Rename, Export `.capy`, Delete], and library buttons [Import, Export All, Delete All Saves]) into a single region always visible at the top above the scrolling gallery; single-tap save selection; double-tap/double-click save loading; pin save capability to lock saves at top; view modes between **Detail** (single vertical list with 64–72px thumbnails, percentage, file size, and progress bar) and **Thumbnails** (responsive 2–3 column grid with 4:3 rectangular preview artwork, floating pin badge, completion badge, and progress line). |
| [**`ReplayControls`**](file:///home/antigravity/shthed/capy/web/src/components/ReplayControls.tsx) | Non-blocking bottom HUD shown during chronological puzzle replays and upon 100% completion. | Play/Pause/Replay toggle; interactive timeline range scrubber; "Resume Play From Here" button to rewind active gameplay to any scrubbed step; speed selector (`0.5x`, `1x`, `2x`, `5x`, `10x`); Restart and Skip-to-End controls; post-completion `Save PNG` and `Next` puzzle quick actions. |
| [**`ColorPickerPopover`**](file:///home/antigravity/shthed/capy/web/src/components/ColorPickerPopover.tsx) | Palette customization panel for Free Colour / Coloring Page mode. | Select from 5 preset palettes (Vibrant, Mushroom, Pastels, Earthy, Neon); pick custom HSL/Hex swatches; update palette colors in real time. |
| [**`LoadingOverlay`**](file:///home/antigravity/shthed/capy/web/src/components/LoadingOverlay.tsx) | Non-blocking bottom-anchored HUD card keeping the background canvas visible during puzzle creation. | Supports two generation progress modes with live toggle control directly on the HUD:<br>1. **Detailed Progress (Default)**: Displays strictly monotonic progress (`0%` to `100%`), `Step X/6` badge, live sub-status, animated canvas preview with authentic artwork contour emergence and salient feature anchors, and an expandable **Generation Details** drawer listing all 6 stages alongside auto-detected style, chosen strategy rationale, color count, region targets, working resolution, and estimated save file size (`KB`).<br>2. **Simple Progress (Fast Mode)**: Minimalist, ultra-low-overhead progress HUD showing an amber-to-yellow gradient progress bar and percentage. In Simple mode, the high-frequency 60/120fps canvas animation loop and heavy `shadowBlur` are completely disabled on the main thread, and worker IPC progress events are throttled with payload construction skipped, dedicating maximum CPU and memory bandwidth to the puzzle generation engine for the fastest possible load times. |


---

## 4. State Management & Lifecycle (`App.tsx`)

`App.tsx` serves as the centralized state orchestrator. State is divided into five main domains:

### 1. Active Session, Undo & Redo State
- `puzzle: PuzzleData | null`: The current puzzle model containing dimensions, palette, region array, region map, and border map.
- `sourceImage: HTMLImageElement | null`: Cached HTML image element of the original artwork, set immediately before worker execution begins so the background canvas displays the artwork during generation.
- `activeColorId: number`: The ID of the currently selected palette color.
- `filledRegionIds: Set<number>`: Set of region IDs that have been colored, preserving exact chronological insertion order across saves and reloads.
- `paintedRegionColors: Map<number, number>`: Region ID $\rightarrow$ Color ID mapping for Free Colour Mode.
- `undoStack: UndoHistoryEntry[]`: History stack recording each region completion (`regionId`, `paintedColorId`, `prevColorId`, `wasAlreadyFilled`) so players can undo completions one by one via the Undo button or `Ctrl+Z` / `Cmd+Z`. Long-pressing the Undo button (>=450ms) opens the interactive Replay timeline scrubber.
- `redoStack: UndoHistoryEntry[]`: Redo stack storing undone paint actions. Stepped forward sequentially using the Redo button stacked above Undo (`FloatingActions.tsx`) or keyboard shortcuts (`Ctrl+Y` / `Ctrl+Shift+Z`). Hidden unless actions have been undone and redo is enabled. Cleared when a new region is actively painted.
- `hintRegionId: number | null`: Region ID currently targeted by hint guidance.
- `isPreviewMode: boolean`: Toggles display between the interactive puzzle and the unmasked original artwork.

### 2. Chronological Replay & Historical Resumption State
- `isReplaying: boolean`, `isReplayPlaying: boolean`, `replayStep: number`, `replaySequence: number[]`: Controls chronological playback of `filledRegionIds`.
- During replay, `PuzzleCanvas` receives `displayedFilledRegionIds = new Set(replaySequence.slice(0, replayStep))`, leveraging incremental dirty-rect updates on `baseCanvasRef` to animate both forward filling and backward scrubbing at 60 FPS.
- **Resume Play From Step**: Clicking "Resume Here" in the Replay HUD header restores active gameplay to step $K$, updating `filledRegionIds` to match the scrubbed point, and placing the rewound actions into `redoStack` in reverse order so players can immediately redo actions forward or diverge with new colors.

### 3. Viewport & Spatial Culling
- `visibleColorIds: Set<number>` / `visibleRegionIds: Set<number>`: Calculated by `PuzzleCanvas` on each pan/zoom change. Allows `PaletteDock` to dynamically prioritize swatches currently on-screen (`prioritizeOnScreen`).

### 4. Generation Sequence Tracking (`generationSeqRef`)
To prevent asynchronous race conditions when switching sample artwork or uploading files while a generator worker is running:
- Every generation request increments a sequence counter (`generationSeqRef.current`).
- If a newer request begins, any earlier in-flight worker execution is terminated via `PuzzleWorkerService.cancelActive()`.
- Responses from stale sequence IDs are discarded automatically.

### 5. Auto-Advance, Completion Zoom-Out & Auto-Replay Flow
- When `filledRegionIds` completes all regions for `activeColorId`, and `settings.autoAdvance` is enabled, the game automatically advances to the next incomplete color (with a light haptic tick).
- When `filledRegionIds.size === puzzle.regions.length`, completion is triggered without any blocking modal popup:
  - Victory haptic sequence fired and confetti burst dispatched via `canvas-confetti`.
  - Preview thumbnail and save file size (`fileSizeBytes`) calculated and persisted in `StorageService`.
  - Canvas smoothly animates a 280ms cubic ease-out zoom-out to fit the entire puzzle (`resetViewTrigger`).
  - Chronological puzzle replay starts automatically via `ReplayControls`, painting every region in the exact order the player completed it.
- When loading a previously saved puzzle with completed regions (`filledRegionIds.length > 0`) and `settings.autoReplayOnLoad` enabled, the canvas fits to screen, replays the saved progress chronologically, and automatically resumes active gameplay once playback finishes.

---

## 5. Rendering Pipeline & Gesture Engine (`PuzzleCanvas.tsx`)

Rendering thousands of intricate vector regions at 60 FPS during continuous touch-drag or high-speed replay requires avoiding full canvas redraws. `PuzzleCanvas` employs a **three-tier offscreen caching strategy**:

```
Offscreen Buffer 1: Base Canvas (baseCanvasRef)
  ├── Static background color
  ├── Translucent white mask for unfilled regions
  └── Incrementally painted solid / original color for filled regions
          │
Offscreen Buffer 2: Border Canvas (borderCanvasRef)
  └── Pre-baked 1-pixel border lines (Uint8Array borderMap)
          │
Offscreen Buffer 3: Highlight Canvas (highlightCanvasRef)
  └── Transient glow / pattern overlay for matching or hinted regions
          │
          ▼
Composite Render to Onscreen Canvas (canvasRef)
  ├── 1. Draw baseCanvas with current pan/zoom transformation
  ├── 2. Draw borderCanvas (if enabled / not preview mode)
  ├── 3. Draw highlightCanvas (centroid glow, boundary, full fill)
  ├── 4. Render Region Centroid Labels (culled to visible viewport)
  └── 5. Render interactive feedback (tap ripple dot, pulse animation, or live generation FX)
```

### Live Background Generation Visualization
When `isGenerating` is `true` and `sourceImage` is loaded:
- `PuzzleCanvas` immediately centers and draws the `sourceImage` onto the background canvas so the user never stares at a blank screen.
- An animated 60 FPS procedural generation overlay renders on top of the source image synchronized with `generationProgress` (`0.0` to `1.0`):
  - **Radial Discovery Wave**: An organic bioluminescent wave expands outward 360 degrees from the artwork center, replacing artificial top-down raster scans.
  - **Authentic Artwork Contour Emergence**: Detects and renders the true edges and silhouettes of the subject matter via an offscreen Sobel pass. In early-to-mid stages (`Step 1–4`), edges shimmer with a warm amber glow; in late stages (`Step 5–6`), they crispen into authentic puzzle boundary lines.
  - **Salient Feature Centroid Pings & Badges**: Tracks high-contrast focal landmarks across the composition, illuminating pulsating golden target reticles and region number badges as the wave encompasses them.
  - **Dual Wavefront Resonance Rings**: Subtle trailing perimeter ripples accentuate the discovery wave progression without obstructing the artwork.

### Incremental Base Layer Painting (Fill, Undo & Replay Scrubbing)
When regions are filled or unfilled (via gameplay, Undo, or Replay scrubbing), `baseCanvas` does not repaint the entire canvas. Instead:
- It compares the new `filledRegionIds` set against `paintedCacheRef.current`.
- For both newly filled and newly unfilled regions, it retrieves the region's `pixels: Int32Array` containing exact 1D pixel coordinates, updates `baseImageDataRef`, and calls `baseCtx.putImageData(..., minX, minY, ...)` restricted strictly to the combined dirty bounding box.

### Dynamic Active Colour & Highlight Overlays
`PuzzleCanvas` dynamically renders visual cues for active and hinted regions without redrawing base layers:
- **Active Colour Highlighting**: When `highlightStyle` is set to `FULL_REGION` (default) or `BOUNDARY_ONLY`, unfilled regions matching `activeColorId` are filled directly with the **active palette colour** (extracted from `palette[activeColorId].rgb`). This creates an immediate visual connection between the selected palette swatch and the target puzzle shapes.
- **Hint Highlighting**: When a hint is triggered, the target region is highlighted using `settings.hintColorArgb` (default gold `#FBBF24`), rendering a distinct checkerboard, pulse, or border pattern to avoid visual confusion with the active colour.
- **Matching Centroid Glow & Badges**: Region centroid rings and number badges for matching regions dynamically use the active palette color for their glowing background accents.

### Centroid Label Placement & Culling
Labels are drawn at each region's **Pole of Inaccessibility** (deepest interior point computed via BFS in the engine), avoiding thin concave edges:
- **Spatial Culling**: Labels outside the viewport bounding box are discarded before font measurement.
- **Scale Thresholding**: Labels only render when `region.maxRadius * effScale >= 6px`. Tiny regions suppress labels until the user zooms in.
- **Dynamic Contrast**: Text color automatically toggles between `#FFFFFF` (with dark drop shadow) and `#000000` (with light drop shadow) based on the region's perceived luminance (`isLight`).

### Viewport Pan & Zoom Clamping (`clampCanvasOffset`)
[`clampCanvasOffset`](file:///home/antigravity/shthed/capy/web/src/components/PuzzleCanvas.tsx) keeps the artwork bounded while providing full viewport navigation:
- **Zoom Range**: Smooth clamping between **0.5×** and **12.0×**.
- **Animated Fit-to-Screen Reset**: When `resetViewTrigger` increments (via the Fit-to-Screen button or upon puzzle completion), `PuzzleCanvas` smoothly interpolates `scale` to `1` and `offset` to `{x: 0, y: 0}` over 280ms using a cubic ease-out curve.
- **Dynamic Corner Panning Margins**: When zoomed in (`effScale >= fitScale`), margin caps scale dynamically with viewport size (`containerWidth * 0.72` horizontally and `containerHeight * 0.72` vertically) rather than fixed pixel offsets. This ensures players can pan all four corners of the puzzle comfortably past the center of the viewport, well clear of the bottom `PaletteDock` (~120px) and top `GameTopBar` (~60px).
- **Centering Elasticity**: When the artwork is smaller than the container, it smoothly snaps to center.

### Gesture Engine & Interaction Paradigms
`PuzzleCanvas` orchestrates 5 distinct touch, mouse, and gesture interactions:

1. **Tap Hit-Testing**:
   - Converts client screen $(x, y)$ to canvas coordinates using the inverse transform matrix: `puzzleX = (clientX - rect.left - panX) / effScale`.
   - Looks up `regionId = regionMap[y * width + x]` directly in the `Int32Array` region map.
   - If `isFreeColorMode`: paints the region with `activeColorId`.
   - If matching `activeColorId`: marks region filled and triggers light haptic feedback.
   - If mismatch: triggers subtle error haptic and tap ripple feedback dot.
   - In **Easy Mode**: automatically selects the tapped region's color and fills it immediately.

2. **Google Maps-Style One-Finger Double-Tap-and-Drag Zoom & Pan**:
   - Quick tap followed by a second tap-and-hold within 350ms (`timeSinceTapUp < 350ms`, `distFromLastTap < 40px`).
   - **Zooming (Vertical Drag)**: By default, dragging **DOWN** (`dy > 0`) zooms **IN**; dragging **UP** (`dy < 0`) zooms **OUT**. Reversible via `settings.reverseDoubleTapZoom` (`Invert Double-Tap Zoom Direction`).
   - Continuous exponential scale tracking: `zoomFactor = Math.pow(Math.E, (directionMultiplier * dy) / 220)`.
   - Centers zoom smoothly on the double-tap anchor point on the canvas without step-jumps.
   - **One-Finger Panning in Paint Mode (Horizontal Drag)**: Dragging left or right (`Math.abs(dx) >= Math.abs(dy)`) while in continuous Paint Mode seamlessly pans the canvas without painting any strokes or requiring two-finger pinches.

3. **Background Touch Drag Panning**:
   - Touching the canvas background outside the artwork bounds (`x < 0`, `y < 0`, `x >= width`, or `y >= height`) always pans the canvas, even when continuous Paint Mode is toggled on, allowing effortless viewport repositioning from anywhere on the screen.

4. **Smooth Pan Momentum (Inertial Gliding)**:
   - Tracks pointer movement history over a sliding 100ms window (`pointerHistoryRef`).
   - On pointer release, calculates the flick velocity vector $(v_x, v_y)$ in pixels per millisecond.
   - If velocity magnitude $\ge 0.18\text{ px/ms}$, kicks off an inertial animation loop via `requestAnimationFrame`.
   - Applies exponential friction decay: $v_{t} = v_0 \cdot 0.92^{\Delta t / 16}$.
   - Clamps offsets on every glide tick via `clampCanvasOffset`.
   - Halts animation once glide velocity drops below $0.02\text{ px/ms}$ or reaches boundaries.
   - **Zero-Latency Touch Cancellation**: Any subsequent pointer touch immediately cancels active momentum gliding with zero lag, ensuring instant tactile control.
   - Toggleable via `settings.panMomentum` (enabled by default).

5. **Multi-Touch Pinch-to-Zoom**:
   - Two-finger touch tracking with real-time midpoint focal tracking and scale clamping between $0.5\times$ and $12.0\times$.

6. **Drag-to-Color (Continuous Paint Mode)**:
   - When `isPaintMode` is active and touch begins inside the image, pointer drag samples points along the interpolated stroke path and batch-fills intersecting matching regions via `onBatchRegionsClicked`.
   - Automatically disabled while watching chronological replays.


---

## 6. Background Engine & Worker Protocol

Image quantization and segmentation are handled in [`puzzle.worker.ts`](file:///home/antigravity/shthed/capy/web/src/engine/puzzle.worker.ts) via [`PuzzleWorkerService.ts`](file:///home/antigravity/shthed/capy/web/src/services/PuzzleWorkerService.ts):

### Message Passing Protocol

```typescript
// Main -> Worker (Request)
interface WorkerGenerateRequest {
  type: 'GENERATE';
  id: string;
  width: number;
  height: number;
  rgbaBuffer: ArrayBuffer; // Transferred zero-copy
  config: GeneratorConfig;
}

// Worker -> Main (Progress Updates)
interface WorkerProgressMessage {
  type: 'PROGRESS';
  id: string;
  progress: number; // Strictly monotonic 0.0 to 1.0
  status: string;   // e.g. "Clustering perceptual color palette (2/4)..."
  payload: GenerationProgressPayload; // 6-stage step index, description & inspection telemetry
}

// Worker -> Main (Completion)
interface WorkerSuccessMessage {
  type: 'SUCCESS';
  id: string;
  puzzleData: SerializedPuzzleData; // ArrayBuffers for region pixels
}
```

Detailed documentation of the 5 segmentation strategies (`AUTO`, `LINE_ART`, `PAINTERLY`, `POSTERIZED`, `MOSAIC_CEL`) and line absorption mechanics is maintained in [**`PUZZLE.md`**](./PUZZLE.md).

---

## 7. Native Android Bridge (`NativeBridge.ts`)

When running inside the Android wrapper (`app/`), `NativeBridge` connects the web runtime to native hardware features exposed by `CapyAndroidBridge.kt` via `@JavascriptInterface`:

| Bridge Method | Web Fallback | Native Android Implementation |
| :--- | :--- | :--- |
| `haptic(type)` | `navigator.vibrate(10)` | Native `Vibrator` / `VibrationEffect` with pre-baked feedback constants (`tick`, `success`, `warning`, `error`). |
| `setBackModalOpen(isOpen, onClose)` | Adds `popstate` history listener | Registers callback on Android's `OnBackPressedCallback`, closing modals on back swipe before exiting the app. |
| `saveBackup(key, data)` | No-op (localStorage only) | Persists JSON snapshots directly to private internal disk (`context.filesDir/capy_saves`). |
| `loadBackup(key)` | Returns `null` | Reads persisted backup from internal disk if localStorage is cleared or fresh install. |
| `applySafeAreaInsets()` | CSS `env(safe-area-inset-*)` | Queries `WindowInsetsCompat` and injects exact pixel values into `--safe-area-top`, `--safe-area-bottom`, etc. |
| `consumePendingSharedImage()` | File `<input>` upload | Consumes incoming images sent to Capy via Android's `Intent.ACTION_SEND` (Share menu). |

---

## 8. Persistence & Snapshot Storage (`StorageService.ts`)

Capy uses a hybrid storage model to manage performance and browser storage quotas:

1. **IndexedDB (`capy_game_storage_v8`)**:
   - `STORE_PUZZLES`: Serialized heavy `PuzzleData` (region maps, border maps, typed arrays).
   - `STORE_IMAGES`: Full-resolution source image blobs.
2. **LocalStorage (`capy_snapshots_v8`) + Native Disk**:
   - Stores lightweight snapshot metadata (`SavedSnapshot`): ordered `filledRegionIds` array (preserving chronological completion sequence), active color, zoom/pan coordinates, estimated storage footprint (`fileSizeBytes`), and a compressed **aspect-ratio preserved JPEG preview data URL** (max 320px).
   - Enables instant rendering of the Saves gallery tab across Detail and Thumbnails modes (including human-readable `KB` file size badges and unified Selected Save Action Bar actions) without reading megabytes of raw image data from IndexedDB. Sample artwork automatically falls back to pristine sample asset images.
3. **Settings Persistence (`capy_user_settings_v8`) & Tab Memory**:
   - User preferences survive app updates and browser restarts.
   - Reopening `SettingsModal` remembers the last active tab index via `localStorage.getItem('capy_last_settings_tab')` (integer index `'0'` [Settings], `'1'` [Hints], `'2'` [Create], or `'3'` [Saves]).
4. **Save Export, Import & TypedArray Serialization**:
   - `StorageService.exportSnapshot(id)`: Downloads a single save snapshot along with its serialized puzzle model as `<snapshot_name>.capy` (formatted JSON).
   - `StorageService.exportAllSnapshots()`: Bundles all user saves, puzzle data, and metadata into a portable backup `capy_all_saves_<timestamp>.capy`.
   - `StorageService.importSnapshotBundle(jsonString)`: Validates bundle schema (`version: 8`, `type: 'CAPY_SAVE_BUNDLE'`), checks integrity, restores snapshots into `localStorage`, deserializes TypedArrays, and stores puzzles into IndexedDB.
   - **TypedArray Base64 Buffer Encoding**: Large `Int32Array` (`regionMap`, `Region.pixels`) and `Uint8Array` (`borderMap`) are serialized to compact base64 byte chunks (`bufferToBase64` / `base64ToUint8Array` / `base64ToInt32Array`) to prevent precision loss and maintain compact export file sizes.

### 8.1 Comprehensive User Settings Reference (`UserSettings`)

| Setting Key | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `autoAdvance` | `boolean` | `true` | Automatically switches to the next incomplete color when all regions for the active color are filled. |
| `difficulty` | `'EASY' \| 'NORMAL' \| 'HARD'` | `'NORMAL'` | **EASY**: Auto-selects color upon clicking any region.<br>**NORMAL**: Requires matching active color.<br>**HARD**: Mismatches trigger error penalty feedback. |
| `isPaintMode` | `boolean` | `false` | Enables drag-to-color continuous stroke painting. |
| `isFreeColorMode` | `boolean` | `false` | Enables Coloring Page / Free Color mode allowing arbitrary color assignment. |
| `raisePaletteDock` | `boolean` | `true` | Lifts the floating palette dock above navigation bars and Android gestures. |
| `regionColorMode` | `'SOLID' \| 'ORIGINAL'` | `'SOLID'` | Renders filled regions with flat quantized palette color (`SOLID`) or sampled photographic detail (`ORIGINAL`). |
| `canvasBgColor` | `'BLACK' \| 'DARK_SLATE' \| 'CHARCOAL' \| 'LIGHT_GRAY' \| 'PURE_WHITE' \| 'CUSTOM'` | `'CHARCOAL'` | Background fill color for the canvas viewport surrounding the artwork. |
| `canvasBgArgb` | `number` (32-bit ARGB) | `0xff18181b` (`#18181B`) | Custom background color when `canvasBgColor` is set to `'CUSTOM'` (configured via `<Pipette>` picker). |
| `saveSortOrder` | `'LAST_ACTIVE' \| 'NAME' \| 'PROGRESS'` | `'LAST_ACTIVE'` | Sorting order for saved game snapshots in the Saves tab. |
| `showSavePreviews` | `boolean` | `true` | Displays 240×240 thumbnails in the Saves gallery tab. |
| `highlightStyle` | `'NONE' \| 'CENTROID_ONLY' \| 'BOUNDARY_ONLY' \| 'FULL_REGION'` | `'FULL_REGION'` | Visual overlay style for matching active regions. `FULL_REGION` and `BOUNDARY_ONLY` fill regions in the **active palette color**. |
| `hintFillStyle` | `'SOLID' \| 'CHECKER' \| 'STRIPED'` | `'CHECKER'` | Texture pattern applied to the active hint target region. |
| `hintColorArgb` | `number` (32-bit ARGB) | `0xfffbbf24` (`#FBBF24`) | Custom highlight color for hint targets (configured via `<Pipette>` picker). |
| `showRegionLabels` | `boolean` | `true` | Displays number labels at interior poles of inaccessibility. |
| `showPreviewLabels` | `boolean` | `false` | Shows number labels even when in artwork preview mode. |
| `showPreviewBorders` | `boolean` | `false` | Shows border lines when in artwork preview mode. |
| `highlightMatching` | `boolean` | `true` | Toggles dynamic glow and fill overlays for matching active regions. |
| `animateHint` | `boolean` | `true` | Enables pulsing / breathing animation for hinted region. |
| `showNextRegionHint` | `boolean` | `true` | Highlights the next closest matching region when requesting hints. |
| `hintIntensity` | `number` (0.0 – 1.0) | `0.65` | Opacity of hint overlays and glow animations. |
| `labelScale` | `number` (0.5 – 2.0) | `1.0` | Global multiplier for number label font size. |
| `showZoomButtons` | `boolean` | `false` | Displays onscreen `+` / `-` floating zoom buttons. |
| `showResetViewButton` | `boolean` | `false` | Displays onscreen fit-to-screen view reset button. |
| `paletteSort` | `'NUMBER' \| 'REMAINING' \| 'HUE' \| 'LIGHTNESS'` | `'NUMBER'` | Dynamic sorting order for palette swatches in `PaletteDock`. |
| `prioritizeOnScreen`| `boolean` | `true` | Dynamically floats colors visible in current viewport to front of `PaletteDock`. |
| `hapticsEnabled` | `boolean` | `true` | Enables native Android vibration / web vibration feedback on taps and victory. |
| `panMomentum` | `boolean` | `true` | Enables Google Maps-style inertial gliding with friction decay on canvas pan flicks. |
| `enableCustomColorForAllPuzzles` | `boolean` | `false` | Unlocks the palette color editor across all standard puzzle modes. |
| `enableUndo` | `boolean` | `false` | Enables the Undo action button above the palette dock and keyboard shortcuts (`Ctrl+Z`). Disabled by default for standard puzzles and enabled automatically for free colour puzzles. |
| `replaySpeed` | `number` (`0.5`, `1`, `2`, `5`, `10`) | `1` | Playback speed multiplier for chronological puzzle completion replays (`1x` $\approx$ 3.5s baseline duration). |
| `autoReplayOnLoad` | `boolean` | `true` | Automatically zooms out and replays completed regions chronologically when opening a saved puzzle, then resumes active play. Configurable via minimal `Replay on Load` toggle switch in Settings and the Saves tab. |
| `reverseDoubleTapZoom` | `boolean` | `false` | Inverts one-finger double-tap zoom direction. By default (`false`), dragging down zooms in and dragging up zooms out. When `true`, dragging up zooms in and dragging down zooms out. |
| `detailedLoadingProgress` | `boolean` | `true` | Toggles between Detailed Generation Progress (real-time 6-stage pipeline inspector, metrics, and live canvas preview with authentic artwork contours) and Simple Progress (minimalist, low-overhead progress bar with canvas animation disabled and worker IPC throttled for maximum generation speed). Can also be toggled directly from the loading card HUD. |
| `generatorConfig` | `GeneratorConfig` | *(See PUZZLE.md)* | Engine tuning: algorithm, color count, min region area, max regions, resolution. |

---

## 9. Styling & Design Tokens (`index.css`)

Capy Web uses **Tailwind CSS 4** with CSS custom properties for hardware insets:

```css
:root {
  --sat: max(env(safe-area-inset-top, 0px), var(--safe-area-top, 0px));
  --sab: max(env(safe-area-inset-bottom, 0px), var(--safe-area-bottom, 0px));
  --sal: max(env(safe-area-inset-left, 0px), var(--safe-area-left, 0px));
  --sar: max(env(safe-area-inset-right, 0px), var(--safe-area-right, 0px));
}
```

- **Touch Prevention**: `touch-action: none; overscroll-behavior: none; user-select: none;` prevents accidental page zooming, pull-to-refresh gestures, or text selection during gameplay.
- **Theme Tokens**: Dark slate base (`#0f172a`, `#1e293b`) accented with bright amber (`#fbbf24`, `#f59e0b`) for active swatches, completion badges, and victory highlights.

---

## 10. Progressive Web App (PWA) & Offline Caching Architecture

Capy is an installable, 100% offline-first Progressive Web App. It operates without an internet connection after the initial visit, delivering native-like standalone desktop and mobile experiences.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Capy PWA Architecture                           │
├──────────────────────────┬─────────────────────────────────────────────┤
│ Install & Manifest Layer │ Offline Service Worker (`sw.js`)            │
│  ├─ manifest.webmanifest │  ├─ Pre-cache: HTML, manifest, sample assets│
│  ├─ PwaService.ts        │  ├─ Auto-discovery: Vite JS/CSS bundles     │
│  ├─ Standalone detection │  ├─ Cache-First: Scripts, styles, workers   │
│  └─ In-app install card  │  └─ Network-First / Cache Fallback: Document │
└──────────────────────────┴─────────────────────────────────────────────┘
```

1. **Web App Manifest (`manifest.webmanifest`)**:
   - Configures standalone display mode (`display: "standalone"`, `display_override: ["standalone", "minimal-ui"]`) and zero-margin immersion with `#000000` theme and background colors.
   - Provides responsive application icons (192x192, 512x512, and 512x512 maskable for adaptive Android icons) and Apple touch icons.
   - Uses relative scoping (`start_url: "./"`, `scope: "./"`) to preserve host independence across GitHub Pages root (`/capy/`), PR branch previews (`/capy/pull/<number>/`), and local environments.

2. **Offline Service Worker (`web/public/sw.js`)**:
   - Pre-caches core application shell (`./`, `./index.html`, `./manifest.webmanifest`), sample puzzle images (`capybara.webp`, `mushrooms.webp`, `capy_forest.webp`, `snail_guitar.webp`), and application icons.
   - Dynamically parses `index.html` during the `install` phase to discover and pre-cache hashed Vite script and CSS bundles (`assets/index-*.js`, `assets/index-*.css`) and Web Worker scripts (`assets/puzzle.worker-*.js`).
   - Implements cache-first strategy for static assets and network-first with offline cache fallback for document navigation.
   - Uses URL-string matching in addition to `Request` object matching to prevent CORS mode discrepancies when fetching module scripts.
   - Skips waiting and claims active clients immediately upon installation to ensure immediate offline readiness.

3. **Application Lifecycle Bridge (`PwaService.ts`)**:
   - Detects standalone execution via `display-mode: standalone` media query and `navigator.standalone`.
   - Captures `beforeinstallprompt` events and surfaces a direct "Install Web App" action card in the Settings modal under Platforms & Applications.
   - Bypasses service worker registration when running inside the native Android launcher wrapper (`NativeBridge.isAndroid`), allowing AndroidX `WebViewAssetLoader` to manage APK assets directly.

---

## 11. Development & Build Verification

From the `web/` directory:

```bash
# Install dependencies
npm ci

# Type-check TypeScript without emitting output
npm run lint

# Compile production bundle into web/dist/
npm run build

# Run Playwright interaction test suite
npm run test:game

# Run comprehensive end-to-end full gameplay test suite
npm run test:gameplay

# Capture showcase screenshots for gallery
npm run gallery:capture

# Launch Vite development server on http://localhost:3000
npm run dev
```

From the repository root:

```bash
# Compile web/ bundle and sync into Android assets (app/src/main/assets/www)
./gradlew app:buildWeb

# Build complete Android debug APK using the web bundle
./gradlew app:assembleDebug
```
