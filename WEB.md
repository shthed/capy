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
│  ├─ SettingsModal (5 Tabs)     │                                            │
│  ├─ VictoryModal               │                                            │
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
    │   ├── PuzzleCanvas.tsx   # Offscreen cached 2D canvas, pan/zoom gestures, hit testing
    │   ├── GameTopBar.tsx     # Progress indicator, title, preview toggle, settings button
    │   ├── PaletteDock.tsx    # Scrollable color palette, remaining count, sort modes
    │   ├── FloatingActions.tsx# Drag-to-color Paint Mode toggle, zoom +/-, view reset
    │   ├── SettingsModal.tsx  # 5-tab configuration sheet (Game, Appearance, Engine, Saves, Gallery)
    │   ├── VictoryModal.tsx   # Completion modal with canvas confetti and artwork export
    │   ├── ColorPickerPopover.tsx # Custom color picker & palette presets for Free Colour mode
    │   └── LoadingOverlay.tsx # Deterministic progress bar with live stage status
    ├── services/
    │   ├── NativeBridge.ts    # Android `@JavascriptInterface` & WebKit bridge (haptics, back button)
    │   ├── PuzzleWorkerService.ts # Worker lifecycle, job cancellation, promise dispatch
    │   └── StorageService.ts  # IndexedDB (large blobs) + LocalStorage (settings/snapshots)
    └── engine/
        ├── puzzle.worker.ts   # Web Worker message handler
        ├── PuzzleGenerator.ts # Multi-strategy coordinator
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
│                                                       [ Fit to Screen ]│
│                                                       [ Zoom In (+) ]  │
│                                                       [ Zoom Out (-) ] │
│                                                       [ Paint Brush ]  │
├────────────────────────────────────────────────────────────────────────┤
│ [Z-20] PaletteDock: [ 🎨 ] (1)  (2)  (3)  (4)  (5) ... [Hint]          │
└────────────────────────────────────────────────────────────────────────┘
  [Z-40] LoadingOverlay (Centered modal dialog when processing)
  [Z-50] SettingsModal / VictoryModal / ColorPickerPopover
```

### Component Breakdown

| Component | Responsibility | Key Interactions |
| :--- | :--- | :--- |
| [**`PuzzleCanvas`**](file:///home/antigravity/shthed/capy/web/src/components/PuzzleCanvas.tsx) | Renders the puzzle with 3-tier offscreen caching, handles gestures, hit-tests pixel taps. | Single-finger drag (pan), pinch (zoom), Google Maps-style one-finger double-tap-and-drag zoom, smooth pan momentum gliding, tap (color region), drag (continuous paint mode). |
| [**`GameTopBar`**](file:///home/antigravity/shthed/capy/web/src/components/GameTopBar.tsx) | Displays puzzle title, overall completion percentage, quick actions. | Tap title to open Saves tab; toggle preview mode; enter/exit fullscreen; import image; open settings. |
| [**`PaletteDock`**](file:///home/antigravity/shthed/capy/web/src/components/PaletteDock.tsx) | Horizontal scrolling list of numbered color swatches with completion badges. | Tap swatch to select active color; tap active swatch again to trigger hint; tap custom color button to open picker. Guarantees persistent active color selection even when 0 matching regions remain on-screen. Supports dynamic sorting (Number, Remaining, Hue, Lightness) and viewport culling. |
| [**`FloatingActions`**](file:///home/antigravity/shthed/capy/web/src/components/FloatingActions.tsx) | Secondary floating action buttons positioned above the palette dock. | Toggle continuous Paint Mode; zoom in/out; reset view to fit screen. |
| [**`SettingsModal`**](file:///home/antigravity/shthed/capy/web/src/components/SettingsModal.tsx) | Full modal sheet with 5 tabbed sections and automatic active tab persistence. | Automatically restores the last active tab from `localStorage` (`capy_last_settings_tab`).<br>**Game**: Auto-advance, difficulty, hint styles, free color mode, pan momentum toggle.<br>**Appearance**: Canvas background (preset swatches + `<Pipette>` custom hex/color picker), hint highlight color, dock elevation, label scale.<br>**Generator**: Algorithm selection, color counts, min region area, line handling.<br>**Saves**: Rename, delete, restore snapshots, view thumbnails.<br>**Gallery**: Sample artwork picker, device photo upload. |
| [**`VictoryModal`**](file:///home/antigravity/shthed/capy/web/src/components/VictoryModal.tsx) | Celebration overlay shown upon reaching 100% completion. | Fires confetti bursts (`canvas-confetti`); exports high-resolution painted artwork; offers quick navigation to new puzzle. |
| [**`ColorPickerPopover`**](file:///home/antigravity/shthed/capy/web/src/components/ColorPickerPopover.tsx) | Palette customization panel for Free Colour / Coloring Page mode. | Select from 5 preset palettes (Vibrant, Mushroom, Pastels, Earthy, Neon); pick custom HSL/Hex swatches; update palette colors in real time. |
| [**`LoadingOverlay`**](file:///home/antigravity/shthed/capy/web/src/components/LoadingOverlay.tsx) | Full-screen translucent backdrop with animated spinner and progress bar. | Displays step-by-step engine status (`"Extracting line art..."`, `"Quantizing colors..."`, `"Segmenting regions..."`). |


---

## 4. State Management & Lifecycle (`App.tsx`)

`App.tsx` serves as the centralized state orchestrator. State is divided into four main domains:

### 1. Active Session State
- `puzzle: PuzzleData | null`: The current puzzle model containing dimensions, palette, region array, region map, and border map.
- `sourceImage: HTMLImageElement | null`: Cached HTML image element of the original artwork (used for preview rendering and detail sampling).
- `activeColorId: number`: The ID of the currently selected palette color.
- `filledRegionIds: Set<number>`: Set of region IDs that have been correctly colored.
- `paintedRegionColors: Map<number, number>`: Region ID $\rightarrow$ Color ID mapping for Free Colour Mode.
- `hintRegionId: number | null`: Region ID currently targeted by hint guidance.
- `isPreviewMode: boolean`: Toggles display between the interactive puzzle and the unmasked original artwork.

### 2. Viewport & Spatial Culling
- `visibleColorIds: Set<number>` / `visibleRegionIds: Set<number>`: Calculated by `PuzzleCanvas` on each pan/zoom change. Allows `PaletteDock` to dynamically prioritize swatches currently on-screen (`prioritizeOnScreen`).

### 3. Generation Sequence Tracking (`generationSeqRef`)
To prevent asynchronous race conditions when switching sample artwork or uploading files while a generator worker is running:
- Every generation request increments a sequence counter (`generationSeqRef.current`).
- If a newer request begins, any earlier in-flight worker execution is terminated via `PuzzleWorkerService.cancelActive()`.
- Responses from stale sequence IDs are discarded automatically.

### 4. Auto-Advance & Victory Flow
- When `filledRegionIds` completes all regions for `activeColorId`, and `settings.autoAdvance` is enabled, the game automatically advances to the next incomplete color (with a light haptic tick).
- When `filledRegionIds.size === puzzle.regions.length`, victory is triggered:
  - Victory haptic sequence fired.
  - Confetti burst dispatched via `canvas-confetti`.
  - Preview thumbnail rendered and snapshot updated in `StorageService`.
  - `VictoryModal` presented.

---

## 5. Rendering Pipeline & Gesture Engine (`PuzzleCanvas.tsx`)

Rendering thousands of intricate vector regions at 60 FPS during continuous touch-drag requires avoiding full canvas redraws. `PuzzleCanvas` employs a **three-tier offscreen caching strategy**:

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
  └── 5. Render interactive feedback (tap ripple dot, pulse animation)
```

### Incremental Base Layer Painting
When a region is filled, `baseCanvas` does not repaint the entire canvas. Instead:
- It retrieves the region's `pixels: Int32Array` containing the exact 1D pixel coordinates.
- Directly updates the target pixels in `baseImageDataRef`.
- Calls `baseCtx.putImageData(..., region.minX, region.minY, ...)` restricted strictly to the region's bounding box.

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

2. **Google Maps-Style One-Finger Double-Tap-and-Drag Zoom**:
   - Quick tap followed by a second tap-and-hold within 300ms (`DOUBLE_TAP_TIMEOUT = 300ms`, `DOUBLE_TAP_DIST = 40px`).
   - Dragging **UP** (`dy < 0`) zooms **IN**; dragging **DOWN** (`dy > 0`) zooms **OUT**.
   - Continuous exponential scale tracking: `zoomFactor = Math.pow(Math.E, -dy / 220)`.
   - Centers zoom smoothly on the double-tap anchor point on the canvas.
   - Eliminates jarring instant step-jumps, giving players precise one-handed zoom control on mobile devices.

3. **Smooth Pan Momentum (Inertial Gliding)**:
   - Tracks pointer movement history over a sliding 100ms window (`pointerHistoryRef`).
   - On pointer release, calculates the flick velocity vector $(v_x, v_y)$ in pixels per millisecond.
   - If velocity magnitude $\ge 0.18\text{ px/ms}$, kicks off an inertial animation loop via `requestAnimationFrame`.
   - Applies exponential friction decay: $v_{t} = v_0 \cdot 0.92^{\Delta t / 16}$.
   - Clamps offsets on every glide tick via `clampCanvasOffset`.
   - Halts animation once glide velocity drops below $0.02\text{ px/ms}$ or reaches boundaries.
   - **Zero-Latency Touch Cancellation**: Any subsequent pointer touch immediately cancels active momentum gliding with zero lag, ensuring instant tactile control.
   - Toggleable via `settings.panMomentum` (enabled by default).

4. **Multi-Touch Pinch-to-Zoom**:
   - Two-finger touch tracking with real-time midpoint focal tracking and scale clamping between $0.5\times$ and $12.0\times$.

5. **Drag-to-Color (Continuous Paint Mode)**:
   - When `isPaintMode` is active, pointer drag samples points along the interpolated stroke path and batch-fills intersecting matching regions via `onBatchRegionsClicked`.


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
  progress: number; // 0.0 to 1.0
  status: string;   // e.g. "Segmenting regions..."
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
   - Stores lightweight snapshot metadata (`SavedSnapshot`): completion counts, active color, zoom/pan coordinates, and a compressed **240×240 JPEG preview data URL**.
   - Enables instant rendering of the Saves gallery tab without reading megabytes of raw image data from IndexedDB.
3. **Settings Persistence (`capy_user_settings_v8`) & Tab Memory**:
   - User preferences survive app updates and browser restarts.
   - Reopening `SettingsModal` remembers the last active tab via `localStorage.getItem('capy_last_settings_tab')` (one of `'GAME' | 'APPEARANCE' | 'GENERATOR' | 'SAVES' | 'GALLERY'`).

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

## 10. Development & Build Verification

From the `web/` directory:

```bash
# Install dependencies
npm ci

# Type-check TypeScript without emitting output
npm run lint

# Compile production bundle into web/dist/
npm run build

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
