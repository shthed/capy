# Technical Architecture: Capy Legacy Android v1 (`app1/`)

This document details the architecture, custom K-Means & segmentation engine, binary save specifications, and development roadmap for the preserved native Jetpack Compose Android application (`com.capypaint.capy` in `app1/`, `:app1` in Gradle). For cross-platform monorepo tasks and the unified `app/` launcher, see the root [`TODO.md`](../TODO.md) and [`APP.md`](../APP.md).

---

## 1. Overview & Strategy

The Android application in `app1/` is the preserved standalone native Kotlin + Jetpack Compose color-by-number generator and player. It features an adaptive multi-strategy vector quantization and segmentation engine written natively in Kotlin with primitive array buffers, custom K-Means++, and a binary GZIP snapshot storage format.

---

## 2. Core Component Map & References

### 2.1 Application Entry & View Model

* **`com.capypaint.capy.MainActivity`** ([`MainActivity.kt`](./src/main/java/com/capypaint/capy/MainActivity.kt))
  * Root `ComponentActivity`. Configures a global uncaught exception handler (`CapyCrash` logcat tag), enables edge-to-edge window rendering (`enableEdgeToEdge()`), and sets up `CapyTheme` and `GameScreen`.
* **`com.capypaint.capy.viewmodel.GameViewModel`** ([`GameViewModel.kt`](./src/main/java/com/capypaint/capy/viewmodel/GameViewModel.kt))
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

### 2.2 Custom Engine & Pipeline (`com.capypaint.capy.engine`)

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
  * Fast image classification and palette detail evaluation engine. Downsamples bitmap to max $128 \times 128$ px for sub-5ms analysis time.
  * Evaluates Sobel edge magnitude ($|G_x| + |G_y|$), local 3x3 patch variance vs. global variance, and 5-bit color space histogram cluster density.
  * Classifies artwork as `ImageType.DRAWING` vs. `ImageType.PHOTO` and calculates recommended colors.
* **`PuzzleGenerator`** (`interface` & implementations)
  * Strategy pattern interface: `generate(bitmap, config, onProgress)` $\rightarrow$ `PuzzleData`.
  * **`AutoPuzzleGenerator`**: Analyzes artwork style via `ImageAnalyzer` and delegates to `DrawingPuzzleGenerator` or `PhotoPuzzleGenerator`.
  * **`DrawingPuzzleGenerator`**: Tailored for line art and drawings. Applies a 3x3 edge-preserving median pre-filter to clean noise while keeping outlines crisp.
  * **`PhotoPuzzleGenerator`**: Tailored for natural scenes. Performs Red-Mean perceptual K-Means++ color clustering and sliver prevention.
* **`ColorQuantizer`** (`object`)
  * High-performance primitive K-Means clustering engine with Red-Mean perceptual color distance:
    $$\Delta E^2 = \left(2 + \frac{\bar{r}}{256}\right)\Delta R^2 + 4\Delta G^2 + \left(2 + \frac{255 - \bar{r}}{256}\right)\Delta B^2$$
  * Edge-Preserving Median Filter and 3x3 spatial majority-filter smoothing pass.
* **`RegionSegmenter`** (`object`)
  * Connected component segmentation with queue-based BFS flood-fill.
  * Enforces sliver prevention based on isoperimetric compactness ($p / A \le 1.6$).
  * Generates 1-pixel boundary map (`borderMap`) and calculates guaranteed interior centroids.
* **`PuzzleModel`** (`data classes`)
  * `PaletteColor(id, color, hex, isLight, argb)`
  * `Region(id, colorId, centroidX, centroidY, area, minX, maxX, minY, maxY, pixels)`
  * `PuzzleData(width, height, palette, regions, regionMap, borderMap)`

---

### 2.3 Data & Persistence (`com.capypaint.capy.data`)

* **`GamePreferencesRepository`**
  * Repository managing SharedPreferences settings, active game state, and compact binary snapshot persistence.
  * **Persistence Specs**:
    * Source Bitmap: `puzzle_source_$snapshotId.png`
    * Compressed Binary Data: `puzzle_data_$snapshotId.bin` (Version 2 GZIP binary stream with magic header `0x43415059` and bit-packed `borderMap`).
    * Preview Thumbnail: `puzzle_preview_$snapshotId.png` (120x120 px compressed preview).

---

## 3. Binary Save File Specification

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

## 4. UI Composable Hierarchy (`app1/src/main/.../ui/`)

* **`GameScreen`** (`ui/screens/GameScreen.kt`): Root Compose screen with `Scaffold`, top bar, loading progress, canvas, floating actions, and palette dock.
* **`GameTopBar`** (`ui/components/GameTopBar.kt`): Floating top bar with completion percentage badge, Preview toggle, Import Photo button, and Settings gear.
* **`PuzzleCanvas`** (`ui/components/PuzzleCanvas.kt`): Interactive vector canvas with 2-finger pinch-to-zoom (up to 10x), pan gestures, region hit testing, pattern fills (Solid, Checker, Diagonal), hint pulse animation, and tap feedback dots.
* **`PaletteDock`** (`ui/components/PaletteDock.kt`): Horizontal color swatch row with gesture insets, active color pinning, auto-scroll, and sorting modes (Number, Remaining, Lightness, Hue Rainbow).
* **`SettingsMenuSheet`** (`ui/components/SettingsMenuSheet.kt`): Modal Bottom Sheet with Settings, Create (tuning sliders), and Saves tabs.

---

## 5. Development & Optimization Roadmap
*(Note: Completed items are pruned. Active pending tasks only.)*

- [ ] **Unify Puzzle Generation Engine with 5-Strategy Web Pipeline**:
  - Port `LineArtExtractor` to Kotlin to extract binary ink masks before spatial filtering (see [`PUZZLE.md`](../PUZZLE.md) and [`web/src/engine/`](../web/src/engine)).
  - Implement `ABSORB_LINES` medial-axis watershed expansion vs. `UNIFIED_BLACK_REGION`.
- [ ] **Eliminate Canvas Overlay Bitmap Heap Allocations**:
  - Replace full $W \times H$ `ARGB_8888` `borderBitmap` and `highlightBitmap` allocations in `PuzzleCanvas.kt` with direct DrawScope canvas paths or a single reusable pixel buffer.
- [ ] **R8 Minification for Release APK**:
  - Configure `isMinifyEnabled = true` and `isShrinkResources = true` in `build.gradle.kts`.

---

## 6. Build, Test & Run Commands

```bash
# Run unit tests for the preserved Jetpack Compose app (:app1)
./gradlew app1:testDebugUnitTest

# Build debug APK for app1
./gradlew app1:assembleDebug
```
