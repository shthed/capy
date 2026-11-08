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
| [**`PuzzleCanvas`**](file:///home/antigravity/shthed/capy/web/src/components/PuzzleCanvas.tsx) | Renders the puzzle, handles gestures, hit-tests pixel taps. | Single-finger drag (pan), pinch (zoom), mouse wheel, tap (color region), drag (continuous paint mode). |
| [**`GameTopBar`**](file:///home/antigravity/shthed/capy/web/src/components/GameTopBar.tsx) | Displays puzzle title, overall completion percentage, quick actions. | Tap title to open Saves tab; toggle preview mode; enter/exit fullscreen; import image; open settings. |
| [**`PaletteDock`**](file:///home/antigravity/shthed/capy/web/src/components/PaletteDock.tsx) | Horizontal scrolling list of numbered color swatches with completion badges. | Tap swatch to select active color; tap active swatch again to trigger hint; tap custom color button to open picker. Supports dynamic sorting (Number, Remaining, Hue, Lightness). |
| [**`FloatingActions`**](file:///home/antigravity/shthed/capy/web/src/components/FloatingActions.tsx) | Secondary floating action buttons positioned above the palette dock. | Toggle continuous Paint Mode; zoom in/out; reset view to fit screen. |
| [**`SettingsModal`**](file:///home/antigravity/shthed/capy/web/src/components/SettingsModal.tsx) | Full modal sheet with 5 tabbed sections. | **Game**: Auto-advance, difficulty, hint styles, free color mode.<br>**Appearance**: Canvas background (Charcoal, Black, Slate, etc.), dock elevation.<br>**Generator**: Algorithm selection, color counts, min region area.<br>**Saves**: Rename, delete, restore snapshots, view thumbnails.<br>**Gallery**: Sample artwork picker, device photo upload. |
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

### Centroid Label Placement & Culling
Labels are drawn at each region's **Pole of Inaccessibility** (deepest interior point computed via BFS in the engine), avoiding thin concave edges:
- **Spatial Culling**: Labels outside the viewport bounding box are discarded before font measurement.
- **Scale Thresholding**: Labels only render when `region.maxRadius * effScale >= 6px`. Tiny regions suppress labels until the user zooms in.
- **Dynamic Contrast**: Text color automatically toggles between `#FFFFFF` (with dark drop shadow) and `#000000` (with light drop shadow) based on the region's perceived luminance (`isLight`).

### Viewport Pan & Zoom Clamping
[`clampCanvasOffset`](file:///home/antigravity/shthed/capy/web/src/components/PuzzleCanvas.tsx#L59-L107) prevents the puzzle from being panned off-screen:
- Allows smooth zoom between **0.5×** and **12.0×**.
- Enforces elastic boundaries: when artwork is smaller than viewport, it centers with rubber-band margin; when larger, pan offsets are clamped to edge limits.

### Touch & Pointer Handling
- **Tap**: Converts screen $(x, y)$ to canvas coordinates using current transform matrix. Looks up `regionId = regionMap[y * width + x]`.
  - If `isFreeColorMode`: paints region with `activeColorId`.
  - If matching `activeColorId`: marks filled and plays haptic feedback.
  - If mismatch: triggers subtle error haptic and tap ripple.
  - In **Easy Mode**: automatically selects the tapped region's color and fills it.
- **Drag-to-Color (Paint Mode)**: When `isPaintMode` is active, pointer movement samples points along the stroke path and batch-fills intersecting matching regions using `onBatchRegionsClicked`.

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
3. **Settings Persistence (`capy_user_settings_v8`)**:
   - User preferences (difficulty, colors, hint styles, generator tuning) survive app updates and restarts.

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
