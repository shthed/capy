# Capy - Color by Number Application Documentation

## Overview

**Capy** is a serene, high-performance vector color-by-number Android application built with modern **Android Jetpack Compose**, **Material 3**, **Kotlin Coroutines**, and an **adaptive multi-strategy vector quantization and segmentation engine**.

Users can import any photo or drawing from their device gallery or play built-in sample artwork. The app automatically analyzes the image style (drawings/cartoons vs. photos/realistic art), detects optimal palette color counts, segments artwork into crisp vector regions, and allows users to paint regions using touch gestures or Paint Mode (drag-to-color).

---

## Core Component Map & References

Below is the complete list of application components, packages, models, ViewModels, and UI composables for reference when interacting with or extending the codebase:

### 1. Application Entry & View Model

* **`com.capypaint.capy.MainActivity`**
  * Root `ComponentActivity`. Configures a global uncaught exception handler (`CapyCrash` logcat tag), enables edge-to-edge window rendering (`enableEdgeToEdge()`), and sets up `CapyTheme` and `GameScreen`.
* **`com.capypaint.capy.viewmodel.GameViewModel`**
  * Android ViewModel managing game UI state, settings, active snapshot sessions, loading progress, and haptics.
  * **Key State Flows**:
    * `uiState: StateFlow<GameUiState>` — Live UI state (loading, puzzle, display bitmap, active color, filled region IDs, paint mode, hint region ID).
    * `settings: StateFlow<UserSettings>` — User preferences and generator configuration.
    * `snapshots: StateFlow<List<SavedSnapshot>>` — List of saved puzzles pinned by active save at index 0 and sorted by user preference.
  * **Key Functions**:
    * `loadBitmap(bitmap, config, initialFilledRegionIds, initialActiveColorId, saveBitmapToDisk, title)` — Generates/loads a puzzle from a Bitmap image using `AutoPuzzleGenerator`.
    * `restoreActiveGameSession(onResult)` — Instantly restores the last active puzzle session on app launch in ~10ms.
    * `loadSnapshot(snapshot: SavedSnapshot)` — Loads a specific saved puzzle slot from storage.
    * `attemptFillRegion(regionId: Int): Boolean` — Fills a region if the active color matches or in Easy mode.
    * `selectColor(colorId: Int)` — Switches the active painting palette color.
    * `triggerHint(colorId: Int?)` — Highlights and centers an uncompleted region for the active color.
    * `togglePreview()` / `togglePaintMode()` / `setPaintMode(enabled)` — Toggles view modes.
    * `resetProgress()` — Clears painted regions for the current active puzzle.
    * `renameSnapshot(id, newTitle)` — Renames a saved puzzle slot.
    * `deleteSnapshot(id)` — Deletes a save slot and automatically switches to the next save.
    * `getSnapshotFileSize(snapshotId: String): Long` — Computes the disk footprint of a save slot.
    * `getSnapshotPreview(snapshotId: String): Bitmap?` — Loads the thumbnail preview bitmap for a save slot.

---

### 2. Custom Engine & Pipeline (`com.capypaint.capy.engine`)

```
[Input Bitmap]
       │
       ▼
1. Image Analysis (ImageAnalyzer)
   ├── Downsamples to 128x128 (<5ms execution)
   ├── Sobel edge magnitude & local-vs-global variance calculation
   └── Classifies DRAWING vs PHOTO & calculates recommended colors
       │
       ▼
2. Strategy Delegation (PuzzleGenerator)
   ├── DRAWING ──► Edge-preserving 3x3 median filter ──► Perceptual Quantization ──► Strict Noise Cleanup
   └── PHOTO ────► Perceptual K-Means++ (Red-Mean ΔE) ──► Spatial Smoothing ──────► Sliver Prevention
       │
       ▼
3. Color Quantization (ColorQuantizer)
   ├── K-Means++ seed initialization
   ├── Iterative primitive IntArray clustering (Red-Mean perceptual distance)
   └── 3x3 spatial majority-filter smoothing pass
       │
       ▼
4. Region Segmentation (RegionSegmenter)
   ├── BFS flood-fill into connected components
   ├── Iterative merging of small (<minArea) & spindly (perimeter/area ratio) regions
   ├── Hairline border map generation
   └── Interior centroid calculation
       │
       ▼
5. Canvas Rendering (GameViewModel)
   └── Creates PuzzleData, displayBitmap, previewBitmap & persists GZIP binary snapshot
```

#### Engine Classes & Functions

* **`ImageAnalyzer`** (`object`)
  * Fast image classification and palette detail evaluation engine.
  * **Optimizations**: Downsamples bitmap to max $128 \times 128$ px for sub-5ms analysis time.
  * **Function**: `analyze(bitmap: Bitmap)` $\rightarrow$ Returns `ImageAnalysisResult`:
    * Evaluates Sobel edge magnitude ($|G_x| + |G_y|$), local 3x3 patch variance vs. global variance, and 5-bit color space histogram cluster density.
    * Classifies artwork as `ImageType.DRAWING` (sharp outlines, flat fills) vs. `ImageType.PHOTO` (continuous tone gradients).
    * Calculates recommended color counts mapped to detail levels (`PaletteDetail`: `LOW`, `MEDIUM`, `HIGH`, `AUTO`).
* **`PuzzleGenerator`** (`interface` & implementations)
  * Strategy pattern interface: `generate(bitmap, config, onProgress)` $\rightarrow$ `PuzzleData`.
  * **`AutoPuzzleGenerator`**: Analyzes artwork style via `ImageAnalyzer`, resolves target color count based on `PaletteDetail`, and delegates to `DrawingPuzzleGenerator` or `PhotoPuzzleGenerator`.
  * **`DrawingPuzzleGenerator`**: Tailored for cartoons, line art, and vector graphics. Applies a 3x3 edge-preserving median pre-filter (`applyMedianFilter`) to clean JPEG noise/dithering while keeping crisp outlines, then performs perceptual quantization and line-aware segmentation.
  * **`PhotoPuzzleGenerator`**: Tailored for natural scenes and portraits. Performs Red-Mean perceptual K-Means++ color clustering, 3x3 spatial majority filtering, and perimeter aspect-ratio sliver prevention (`maxPerimeterToAreaRatio = 1.6f`).
  * **`PuzzleGeneratorFactory`**: Factory helper for instantiating generators by `ImageType`.
* **`ColorQuantizer`** (`object`)
  * High-performance primitive K-Means clustering engine with Red-Mean perceptual color distance.
  * **Red-Mean Perceptual Distance**: Uses human-eye sensitivity formula $(2 + \bar{r}/256) \Delta R^2 + 4 \Delta G^2 + (2 + (255 - \bar{r})/256) \Delta B^2$ via fast integer bit-shifts, replacing Euclidean distance for superior color group separation.
  * **Edge-Preserving Median Filter**: `applyMedianFilter(pixels, width, height)` removes raster noise while preserving outlines.
  * **Spatial Majority Filtering**: 3x3 neighborhood voting pass to eliminate isolated pixel speckles.
* **`RegionSegmenter`** (`object`)
  * Connected component segmentation, sliver prevention, and centroid engine.
  * **Sliver Prevention**: Measures region perimeter-to-area aspect ratios ($p / A$) during merging passes. Regions exceeding `maxPerimeterToAreaRatio` merge into adjacent color neighbors with the highest contact, eliminating thin unclickable serpentine sliver regions.
  * **Hairline Border Map**: Generates 1-pixel boundary map (`borderMap` Boolean array) for sharp hairline outlines.
  * **Guaranteed Interior Centroids**: Calculates arithmetic center $(\bar{x}, \bar{y})$ and verifies it lies inside the region bounds in `regionMap`. For concave or donut shapes, selects the closest pixel inside the region boundary to guarantee labels render inside.
* **`PuzzleModel`** (`data classes`)
  * `PaletteColor(id: Int, color: Color, hex: String, isLight: Boolean, argb: Int)` — Model representing a palette color swatch.
  * `Region(id: Int, colorId: Int, centroidX: Float, centroidY: Float, area: Int, minX: Int, maxX: Int, minY: Int, maxY: Int, pixels: IntArray)` — Vector region model with interior centroid.
  * `PuzzleData(width: Int, height: Int, palette: List<PaletteColor>, regions: List<Region>, regionMap: IntArray, borderMap: BooleanArray)` — Full puzzle definition model.

---

### 3. Data & Persistence (`com.capypaint.capy.data`)

* **`GamePreferencesRepository`**
  * Repository managing SharedPreferences settings, active game state, and compact binary snapshot persistence.
  * **Key Data Stream Persistence Specs**:
    * Source Bitmap: `puzzle_source_$snapshotId.png`
    * Compressed Binary Data: `puzzle_data_$snapshotId.bin` (Version 2 GZIP-compressed binary stream with magic header `0x43415059` and bit-packed `borderMap`).
    * Preview Thumbnail: `puzzle_preview_$snapshotId.png` (120x120 px compressed preview displaying painted progress without number labels).
  * **Key Functions**:
    * `loadSettings()` / `saveSettings(settings: UserSettings)`
    * `loadActiveGameState()` / `saveActiveGameState(state: ActiveGameState)`
    * `savePuzzleBitmapForSnapshot(snapshotId, bitmap)` / `loadPuzzleBitmapForSnapshot(snapshotId)`
    * `savePuzzleDataForSnapshot(snapshotId, puzzle)` / `loadPuzzleDataForSnapshot(snapshotId)`
    * `savePuzzlePreviewForSnapshot(snapshotId, previewBitmap)` / `loadPuzzlePreviewForSnapshot(snapshotId)`
    * `deletePuzzleFilesForSnapshot(snapshotId)`
    * `getSnapshotFileSize(snapshotId: String): Long`
    * `loadSnapshots()` / `saveSnapshots(snapshots)` / `addSnapshot(snapshot)` / `updateSnapshotProgress(...)` / `renameSnapshot(id, newTitle)` / `deleteSnapshot(id)`

---

### 4. Saves & Snapshots System Architecture

How saves and snapshots operate throughout the application lifecycle:

1. **Snapshot Lifecycle & Data Model (`SavedSnapshot`)**:
   - Each saved puzzle slot is uniquely identified by `id`.
   - Stores metadata: `title`, `timestamp`, `lastOpened`, `filledCount`, `totalCount`, `filledRegionIds: Set<Int>`, `isAutoSample: Boolean`.
   - Property `progressPercentage` dynamically calculates percentage completion: `(filledCount * 100) / totalCount`.

2. **Dedicated Per-Slot File Storage**:
   - For every save slot, internal app storage (`context.filesDir`) holds three dedicated files:
     * `puzzle_source_$id.png` — High-resolution source bitmap.
     * `puzzle_data_$id.bin` — Compact Version 2 GZIP binary stream containing vector regions, centroids, palette, `regionMap`, and bit-packed `borderMap`.
     * `puzzle_preview_$id.png` — Scaled thumbnail image displaying current painted progress without region number clutter.

3. **Instant Save Creation & Emission**:
   - As soon as `loadBitmap` finishes vector quantization/segmentation, `addSnapshot` immediately emits the new `SavedSnapshot` into `_snapshots.value` on the Main Thread.
   - The new save appears in the Saves list **instantly** (0ms delay) while background file I/O writes PNG/BIN files asynchronously on `Dispatchers.IO`.

4. **Real-Time Progress & Thumbnail Updates**:
   - Whenever the user fills a region (`attemptFillRegion`), `updateSnapshotProgress` updates `filledRegionIds`, `filledCount`, and percentage in `_snapshots.value` synchronously in real-time.
   - In the background, `generateProgressPreviewBitmap` renders a clean, label-free preview image showing exact painted regions and saves `puzzle_preview_$id.png` on `Dispatchers.IO`.

5. **Multi-Save Restoration & Switching**:
   - When the user selects a save slot in the Saves list (`loadSnapshot`), `GameViewModel` fetches that slot's bitmap and `PuzzleData` on `Dispatchers.IO`, restores its pixels and display bitmaps on `Dispatchers.Default`, and updates `_uiState`.
   - Switching between custom photo saves and sample artwork works seamlessly in milliseconds.

6. **Active Save Highlighting & Action Controls**:
   - The currently loaded/active save is pinned to index 0 and highlighted with a `primaryContainer` background.
   - The redundant `"Load"` button is hidden for the currently loaded save.
   - Each card displays disk footprint (e.g. `320 KB`), completion `%`, region counts `(18/40)`, 12-hour AM/PM date/time, rename pencil dialog, and delete button with confirmation dialog.

---

### 5. Domain & Settings Models (`com.capypaint.capy.model`)

* **`ImageType`**:
  * `AUTO` ("Auto Detect", "Analyze image to choose best strategy")
  * `DRAWING` ("Drawing / Line Art", "Optimized for clean edges and flat colors")
  * `PHOTO` ("Photo / Realistic", "Optimized for smooth gradients and natural scenes")
* **`PaletteDetail`**:
  * `AUTO` ("Auto Recommended", "Optimal colours determined by image analysis")
  * `LOW` ("Low Detail", "Fewer, larger regions (~8-12 colours)")
  * `MEDIUM` ("Medium Detail", "Balanced regions and palette (~14-24 colours)")
  * `HIGH` ("High Detail", "Rich, detailed artwork (~30-50 colours)")
  * `CUSTOM` ("Custom", "Fine-tune sliders manually")
* **`GeneratorConfig`**:
  * `preset: GeneratorPreset` (`LOW`, `MEDIUM`, `HIGH`, `CUSTOM`).
  * `paletteDetail: PaletteDetail` (`AUTO`, `LOW`, `MEDIUM`, `HIGH`, `CUSTOM`).
  * `imageType: ImageType` (`AUTO`, `DRAWING`, `PHOTO`).
  * `colorCount: Int` — Palette color count (Default: 16, $k \in [4, 200]$).
  * `minRegionArea: Int` — Region size (Default: $35 \text{ px}^2$, $4 \text{ px}^2 \dots 4096 \text{ px}^2$ on logarithmic scale).
  * `resolution: Int` — Detail resolution in pixels ($240 \dots \text{maxSourceDim}$).
  * `smoothingPasses: Int` — Spatial majority smoothing passes.
* **`UserSettings`**:
  * `difficulty: Difficulty` (`EASY` [Auto-Select Colour] vs `NORMAL` [Precise]).
  * `regionColorMode: RegionColorMode` (`DETAIL` [Original Detail] vs `SOLID` [Solid Palette]).
  * `canvasBgColor: CanvasBgColor` (`BLACK` [Deep Black], `DARK_SLATE`, `CHARCOAL`, `LIGHT_GRAY`, `PURE_WHITE`).
  * `saveSortOrder: SaveSortOrder` (`LAST_ACTIVE`, `DATE`, `PERCENT_COMPLETE`).
  * `showSavePreviews: Boolean` — Toggles between thumbnail preview cards and compact list mode.
  * `raisePaletteDock: Boolean` — Leave gap at bottom setting to avoid navigation gestures.
  * `isPaintMode: Boolean` — Drag-to-color mode state.
  * `autoAdvance: Boolean` — Automatically advances to the next remaining color when a color is completed.
  * `showRegionLabels: Boolean`, `highlightMatching: Boolean`, `animateHint: Boolean`, `hintIntensity: Float`, `labelScale: Float`, `paletteSort: PaletteSortOrder`, `hapticsEnabled: Boolean`, `generatorConfig: GeneratorConfig`.

---

### 6. UI Composable Components (`com.capypaint.capy.ui`)

* **`GameScreen`** (`ui/screens/GameScreen.kt`)
  * Root Compose screen displaying `Scaffold`, `GameTopBar`, centered loading screen with live progress line (`LinearProgressIndicator`) & percentage, `PuzzleCanvas`, floating action controls (Hint & Paint Mode), and `PaletteDock`.
* **`GameTopBar`** (`ui/components/GameTopBar.kt`)
  * Modern floating top app bar featuring a single percentage-complete pill badge in the top right (tapping jumps directly to the Saves page), Preview toggle, Import Photo button, and Settings gear button.
* **`PuzzleCanvas`** (`ui/components/PuzzleCanvas.kt`)
  * Interactive vector canvas handling 2-finger pinch-to-zoom (up to 10x) with gesture separation, edge-to-edge full-screen bounds behind floating headers, region hit-testing, region-colored hairline boundaries, glowing region highlights, full region fills with pattern styles (**Solid**, **Checker**, **Diagonal**) and custom ARGB color picker, refined `sans-serif-medium` label typography that dynamically shrinks to fit inside region interior clearance, animated hint pulses with **Show Next Region Hint** panning (centers the region on screen while preserving user zoom level), and **tap fading feedback dots** on each tap event.
* **`PaletteDock`** (`ui/components/PaletteDock.kt`)
  * Horizontal color swatch row lifting swatches above system gesture bars when `raisePaletteDock` is enabled, hiding completed swatches, pinning the active selected color in a dedicated spot on the far left, rendering thinner rectangular swatches (`42dp` x `36dp`) with numbers and remaining counts inside, applying an 8dp fading-edge alpha mask right up to the edge of the active swatch to eliminate hard cutoff lines without vertical dividers, supporting tap-to-hint on selected swatch, sorting swatches numerically, by remaining regions, by lightness, or by **Rainbow Spectrum (Hue)**, with an independent **Prioritise On-Screen Colours** toggle (`prioritizeOnScreen`) that encloses all viewport-visible swatches inside a long background container on the left without renumbering colors, auto-scrolling to the left, and auto-advancing to the first color on the left when a color is completed.
* **`SettingsMenuSheet`** (`ui/components/SettingsMenuSheet.kt`)
  * Modal Bottom Sheet featuring 3 clean tabs:
    1. **Settings**: Region Fill Style, Play Style switches, Difficulty, Canvas Background, Palette Swatch Order, Assists, and Leave gap at bottom.
    2. **Create**: Artwork Style (`Auto`, `Drawing`, `Photo`), Palette Detail Level (`Auto`, `Low`, `Medium`, `High`, `Custom`), and Manual Fine-Tuning controls (`Palette Colours` slider, `Region Size` logarithmic slider, `Detail Resolution` slider).
    3. **Saves**: Dropdown menu for sorting (`Last Active`, `Date Created`, `Completion`), Previews FilterChip view mode toggle, pinned & highlighted active save slot (with 'Load' button suppressed for active save), 52x52 dp rounded thumbnail previews, file size display (e.g. `320 KB`), Reset Progress header button, Delete All header button, per-card Rename pencil dialog, Delete button with confirmation dialog, and Load button.

---

## Binary Save File Specification

Each saved puzzle is stored in binary format to maximize speed and minimize storage footprint:

```
File Path: context.filesDir / "puzzle_data_$snapshotId.bin"
Compression: GZIPOutputStream over DataOutputStream

Byte Structure:
├── Magic Int (4 bytes): 0x43415059 ("CAPY")
├── Version Int (4 bytes): 2 (Version 2 with bit-packed borderMap)
├── Width Int (4 bytes), Height Int (4 bytes)
├── Palette Section:
│   ├── paletteSize Int (4 bytes)
│   └── For each color: id (Int), argb (Int), isLight (Boolean), hex (UTF String)
├── Regions Section:
│   ├── regionsCount Int (4 bytes)
│   └── For each region: id (Int), colorId (Int), centroidX (Float), centroidY (Float),
│                        area (Int), minX (Int), maxX (Int), minY (Int), maxY (Int),
│                        pixelsCount (Int), pixels (IntArray stream)
├── Region Map Section: regionMap.size (Int), followed by flat IntArray
└── Border Map Section: borderMap.size (Int), followed by bit-packed ByteArray (8 booleans/byte)
```

---

## Build & Testing Commands

To compile, build, and verify the application from the command line:

* **Unit Tests**:
  ```bash
  ./gradlew app:testDebugUnitTest
  ```
  *(Verifies all 16 unit test harnesses in `GameSettingsTest.kt`, `PuzzleSegmentationTest.kt`, `PuzzleZoomAndHintTest.kt`, and `PuzzleGeneratorTest.kt`)*

* **Build Debug APK**:
  ```bash
  ./gradlew app:assembleDebug
  ```

* **Deploy to Connected Device**:
  ```bash
  ./gradlew app:installDebug
  ```
