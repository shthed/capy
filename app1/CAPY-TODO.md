# CAPY-TODO: Android Development & Optimization Roadmap

This document outlines all planned improvements, performance optimizations, debugging enhancements, and feature roadmaps for the preserved legacy native Jetpack Compose **Capy - Color by Number** Android application (`com.capypaint.capy` in `app1/`, `:app1` in Gradle). For cross-platform monorepo tasks and the unified `app/` launcher, see the root [`TODO.md`](../TODO.md).

Items are organized by prioritized tiers (**P0** = Critical Performance & System Fixes, **P1** = Engine Unification, Memory, Rendering & Release Build, **P2** = High-Value Gameplay & UX Features, **P3** = Long-Term Platform & Social Features).

---

## 🎯 Priority Matrix Overview

| Tier | Area | Focus | Key Tasks |
| :--- | :--- | :--- | :--- |
| **P0** | **Critical Performance & System** | Speed up image loading, reduce main thread/disk I/O strain, system compatibility | Parallelize & Cap Segmentation, Debounce Save Disk I/O, Enable Predictive Back |
| **P1** | **Engine Unification, Memory & Release** | Align with 5-strategy Web engine, R8 release APK, eliminate GC pauses | Port 5-Strategy Engine (`LineArtExtractor`), R8 Release APK Minification, Eliminate Overlay Bitmap Allocations, Partial Dirty-Rect Updates, CapyLogger Migration |
| **P2** | **Core Gameplay & UX** | High-demand user features, desktop ergonomics, precision tapping | Cursor-Centric Mouse Wheel Zooming, Micro-Region Tap Tolerance, Magnifying Glass Loupe, Expanded Sample Gallery |
| **P3** | **Platform & Cloud** | Advanced media generation, social features, sync | Time-Lapse Video/GIF Export, Daily Challenge, Palette Filters, Google Drive Sync, Material You |

---

## 🔴 P0: Critical Performance & System Integration

### 1. [x] Parallelize & Downsample Image Segmentation Engine
* **Priority**: `P0 - Critical Performance`
* **Target Files**:
  * [`app1/src/main/java/com/capypaint/capy/engine/ColorQuantizer.kt`](./src/main/java/com/capypaint/capy/engine/ColorQuantizer.kt)
  * [`app1/src/main/java/com/capypaint/capy/engine/RegionSegmenter.kt`](./src/main/java/com/capypaint/capy/engine/RegionSegmenter.kt)
  * [`app1/src/main/java/com/capypaint/capy/engine/PuzzleGenerator.kt`](./src/main/java/com/capypaint/capy/engine/PuzzleGenerator.kt)
* **Status**: **Completed**
* **Accomplished Solution**:
  1. **Maximum Processing Resolution Capping**: `DrawingPuzzleGenerator` and `PhotoPuzzleGenerator` scale input bitmaps to `config.resolution` (default 640px–1000px, max 4096px).
  2. **Multi-Threaded Primitive K-Means**: In `ColorQuantizer.quantize()`, pixel processing is partitioned into chunks across available CPU cores (`Runtime.getRuntime().availableProcessors()`) via a lightweight `ForkJoinPool` parallel loop (`parallelFor`), eliminating object allocation in cluster assignments and median pre-filtering.
  3. **Optimized Region Merging**: In `RegionSegmenter.kt`, flood-fill components use fast primitive integer array queues (`IntArrayList`, `queueBuffer`) and single-pass perimeter ratio scans.

---

### 2. [x] Debounce & Throttle Progress Save Operations
* **Priority**: `P0 - Disk I/O & UI Responsiveness`
* **Target Files**:
  * [`app1/src/main/java/com/capypaint/capy/data/GamePreferencesRepository.kt`](./src/main/java/com/capypaint/capy/data/GamePreferencesRepository.kt)
  * [`app1/src/main/java/com/capypaint/capy/viewmodel/GameViewModel.kt`](./src/main/java/com/capypaint/capy/viewmodel/GameViewModel.kt)
* **Status**: **Completed**
* **Accomplished Solution**:
  1. **In-Memory UI Feedback**: Region taps update `_uiState` and `_snapshots` state flows instantly on the Main thread for zero-latency 60 FPS UI feedback.
  2. **Debounced Background Disk Writes**: In `GameViewModel.kt`, `saveCurrentActiveState(debounceMs = 300L)` uses coroutine job cancellation and `delay(300L)` on `Dispatchers.IO` to debounce disk writes during rapid painting gestures.

---

### 3. [x] Enable Predictive Back Navigation (`android:enableOnBackInvokedCallback`)
* **Priority**: `P0 - System Standards & Logs`
* **Target File**:
  * [`app1/src/main/AndroidManifest.xml`](./src/main/AndroidManifest.xml)
* **Status**: **Completed**
* **Accomplished Solution**:
  Added `android:enableOnBackInvokedCallback="true"` to the `<application>` element in `AndroidManifest.xml`, resolving system back dispatcher logcat warnings and enabling predictive back animations on Android 13+ (API 33+).

---

## 🟡 P1: Engine Unification, Memory, Rendering & Release Build

### 4. [ ] Unify Puzzle Generation Engine with 5-Strategy Web Pipeline
* **Priority**: `P1 - Engine Parity & Image Quality`
* **Target Files**:
  * [`app1/src/main/java/com/capypaint/capy/engine/PuzzleGenerator.kt`](./src/main/java/com/capypaint/capy/engine/PuzzleGenerator.kt)
  * [`app1/src/main/java/com/capypaint/capy/engine/RegionSegmenter.kt`](./src/main/java/com/capypaint/capy/engine/RegionSegmenter.kt)
  * Reference: [`web/src/engine/`](../web/src/engine) and [`PUZZLE.md`](../PUZZLE.md)
* **Problem**:
  The updated web app (`web/src/engine/`) implements a 5-stage pipeline with `LineArtExtractor` (`ABSORB_LINES` medial-axis watershed expansion vs. `UNIFIED_BLACK_REGION`), Lab-guided bilateral smoothing, and 5 segmentation strategies (`watershed`, `slic`, `floodfill`, `felzenszwalb`, `voronoi`), whereas the Android engine currently uses the earlier 2-strategy (`DrawingPuzzleGenerator` / `PhotoPuzzleGenerator`) pipeline.
* **Implementation Plan**:
  1. Port `LineArtExtractor` to Kotlin (`com.capypaint.capy.engine.LineArtExtractor`) to extract binary ink masks before spatial filtering.
  2. Port the 5 segmentation strategies and Kuwahara/bilateral pre-filters into `RegionSegmenter.kt` and `PuzzleGenerator.kt`.
  3. Add cross-platform JUnit4 parity tests in `app/src/test/` matching `web/src/engine/` outputs.

---

### 5. [ ] Configure R8 Minification & Resource Shrinking for Release APK
* **Priority**: `P1 - APK Size & Runtime Performance`
* **Target File**:
  * [`app1/build.gradle.kts`](./build.gradle.kts)
* **Problem**:
  The downloadable `capy.apk` currently uses the unminified debug build (~18.8 MB). Enabling R8 code shrinking, obfuscation, and resource shrinking will reduce APK size to ~3–5 MB and optimize Compose runtime performance.
* **Implementation Plan**:
  1. Configure `isMinifyEnabled = true` and `isShrinkResources = true` on the `release` build type in `app/build.gradle.kts` with a deterministic signing config.
  2. Add ProGuard/R8 keep rules in `app/proguard-rules.pro` for serialized `SavedSnapshot` / `UserSettings` models if needed.

---

### 6. [ ] Eliminate Canvas Overlay Bitmap Heap Allocations
* **Priority**: `P1 - Memory & GC Optimization`
* **Target File**:
  * [`app1/src/main/java/com/capypaint/capy/ui/components/PuzzleCanvas.kt`](./src/main/java/com/capypaint/capy/ui/components/PuzzleCanvas.kt)
* **Problem**:
  In `PuzzleCanvas.kt`, `borderBitmap` and `highlightBitmap` instantiate full $W \times H$ `ARGB_8888` bitmaps (allocating up to 16MB of RAM each) inside Compose `remember` blocks whenever region fills, active color, or revision state changes. On high-resolution puzzles, this triggers repeated Garbage Collection pauses (`Background young concurrent mark compact GC freed...`).
* **Implementation Plan**:
  1. **Direct Canvas Path / Primitive Region Drawing**: Instead of creating full-canvas `Bitmap` objects for boundary outlines and glowing region highlights, draw boundary pixels directly onto the Compose `DrawScope` canvas or maintain a single reusable pixel array buffer.
  2. **Reusable Scratch Canvas**: If software bitmap baking is retained for complex pattern fills (Checker/Stripes), allocate a single persistent reusable `Bitmap` buffer rather than calling `Bitmap.createBitmap()` on every state recalculation.
  3. **Explicit Recycling**: Ensure previously allocated overlay bitmaps call `.recycle()` prior to re-allocation or disposal.

---

### 7. [ ] Eliminate ViewModel GC Pauses via Bitmap Pooling & Immediate Recycling
* **Priority**: `P1 - Memory & GC Optimization`
* **Target Files**:
  * [`app1/src/main/java/com/capypaint/capy/viewmodel/GameViewModel.kt`](./src/main/java/com/capypaint/capy/viewmodel/GameViewModel.kt)
  * [`app1/src/main/java/com/capypaint/capy/engine/PuzzleGenerator.kt`](./src/main/java/com/capypaint/capy/engine/PuzzleGenerator.kt)
* **Problem**:
  `loadBitmap()`, `generateProgressPreviewBitmap()`, and `restoreSnapshotDataAndBitmap()` in `GameViewModel.kt` construct intermediate `displayBitmap`, `previewBitmap`, and `progressPreviewBmp` instances without recycling old bitmaps when switching between save slots.
* **Implementation Plan**:
  1. **Explicit Recycle Calls**: In `GameViewModel.kt`, explicitly invoke `.recycle()` on old `displayBitmap` and `previewBitmap` instances before replacing them in `_uiState.value`.
  2. **Thread-Safe Bitmap Pool**: Implement a lightweight `BitmapPool` object for temporary canvas buffer allocations of matching dimensions (`Width` $\times$ `Height` $\times$ `Config.ARGB_8888`).
  3. **Safe Memory Release in OnCleared**: Ensure `GameViewModel.onCleared()` releases all cached bitmap references and cleans up temporary memory.

---

### 8. [ ] Optimize Canvas Rendering with Partial Dirty-Rect Updates & Viewport Culling
* **Priority**: `P1 - Render Performance`
* **Target File**:
  * [`app1/src/main/java/com/capypaint/capy/ui/components/PuzzleCanvas.kt`](./src/main/java/com/capypaint/capy/ui/components/PuzzleCanvas.kt)
* **Problem**:
  1. **Full-Bitmap Re-draws**: When a user paints a single region, `displayBitmap.setPixels()` re-writes pixels across the entire image buffer.
  2. **Unculled Text Labels**: `PuzzleCanvas` iterates through all `puzzle.regions` to compute text sizes and draw region numbers, even for regions located outside the current zoom viewport bounds (`scale` + `offset`).
* **Implementation Plan**:
  1. **Bounding Box Partial Update**: Update `displayBitmap.setPixels()` using the region's pre-calculated bounding rect (`minX`, `minY`, `maxX - minX + 1`, `maxY - minY + 1`) instead of the full canvas dimensions:
     `displayBitmap.setPixels(pixels, offset, stride, x, y, width, height)`
  2. **Viewport Bounding Rect Culling**: Compute visible canvas bounds in image coordinate space using current `scale` and `offset`:
     $$[\text{minX}, \text{minY}, \text{maxX}, \text{maxY}]$$
     Skip `drawText` calculations for any region whose centroid (`centroidX`, `centroidY`) lies outside the visible viewport rect.

---

### 9. [ ] Complete Centralized Logging Migration (`Log.*` -> `CapyLogger`)
* **Priority**: `P1 - Production Hygiene & Diagnostics`
* **Target Files**:
  * [`app1/src/main/java/com/capypaint/capy/util/CapyLogger.kt`](./src/main/java/com/capypaint/capy/util/CapyLogger.kt)
  * [`app1/src/main/java/com/capypaint/capy/data/GamePreferencesRepository.kt`](./src/main/java/com/capypaint/capy/data/GamePreferencesRepository.kt)
  * [`app1/src/main/java/com/capypaint/capy/viewmodel/GameViewModel.kt`](./src/main/java/com/capypaint/capy/viewmodel/GameViewModel.kt)
* **Problem**:
  While `CapyLogger` is implemented and active, raw `android.util.Log.d` / `Log.e` / `Log.w` calls remain in `GamePreferencesRepository` and `GameViewModel`, bypassing `CapyLogger`'s ring-buffer and crash dump recording.
* **Implementation Plan**:
  1. Replace all raw `Log.d("CapyRepo", ...)`, `Log.d("CapyVM", ...)`, and `Log.d("CapySave", ...)` calls with `CapyLogger.d(...)`, `CapyLogger.e(...)`, and `CapyLogger.w(...)`.
  2. Ensure all log tags are standardized (`CapyRepo`, `CapyVM`, `CapySave`, `CapyEngine`, `CapyInput`).

---

### 10. [ ] Add Stage-by-Stage Trace Markers & Perfetto Integration
* **Priority**: `P1 - Telemetry & Profiling`
* **Target Files**:
  * [`app1/build.gradle.kts`](./build.gradle.kts)
  * [`app1/src/main/java/com/capypaint/capy/viewmodel/GameViewModel.kt`](./src/main/java/com/capypaint/capy/viewmodel/GameViewModel.kt)
  * [`app1/src/main/java/com/capypaint/capy/engine/ColorQuantizer.kt`](./src/main/java/com/capypaint/capy/engine/ColorQuantizer.kt)
  * [`app1/src/main/java/com/capypaint/capy/engine/RegionSegmenter.kt`](./src/main/java/com/capypaint/capy/engine/RegionSegmenter.kt)
* **Problem**:
  Overall puzzle load times are currently recorded as aggregate numbers, making fine-grained execution analysis difficult during performance tuning.
* **Implementation Plan**:
  1. Add `androidx.tracing:tracing-ktx` dependency to `build.gradle.kts`.
  2. Wrap pipeline execution stages with explicit trace sections:
     * `trace("Capy:ImageAnalyze") { ... }`
     * `trace("Capy:ColorQuantize") { ... }`
     * `trace("Capy:RegionSegment") { ... }`
     * `trace("Capy:BitmapRender") { ... }`
     * `trace("Capy:SaveSnapshot") { ... }`
  3. Ensure custom trace slices appear clearly in Perfetto traces and Android Studio Profiler system trace captures.

---

### 11. [ ] Enable StrictMode & LeakCanary in Debug Builds
* **Priority**: `P1 - Debugging & Quality`
* **Target Files**:
  * [`app1/src/main/java/com/capypaint/capy/MainActivity.kt`](./src/main/java/com/capypaint/capy/MainActivity.kt)
  * [`app1/build.gradle.kts`](./build.gradle.kts)
* **Problem**:
  Accidental disk I/O on the main thread or retained ViewModel references need automated detection during development.
* **Implementation Plan**:
  1. Add `debugImplementation("com.squareup.leakcanary:leakcanary-android:2.14")` to `build.gradle.kts`.
  2. Enable `StrictMode` thread and VM policies in `MainActivity.onCreate()` when `BuildConfig.DEBUG` is true to catch unintended main-thread file I/O or unclosed streams:
     ```kotlin
     if (BuildConfig.DEBUG) {
         StrictMode.setThreadPolicy(
             StrictMode.ThreadPolicy.Builder().detectDiskReads().detectDiskWrites().detectNetwork().penaltyLog().build()
         )
     }
     ```

---

## 🟢 P2: Core Gameplay, UX & Desktop/Mouse Ergonomics

### 12. [ ] Cursor-Centric Mouse Wheel Zooming
* **Priority**: `P2 - Desktop Ergonomics & Input`
* **Target Files**:
  * [`app1/src/main/java/com/capypaint/capy/MainActivity.kt`](./src/main/java/com/capypaint/capy/MainActivity.kt)
  * [`app1/src/main/java/com/capypaint/capy/viewmodel/GameViewModel.kt`](./src/main/java/com/capypaint/capy/viewmodel/GameViewModel.kt)
  * [`app1/src/main/java/com/capypaint/capy/ui/components/PuzzleCanvas.kt`](./src/main/java/com/capypaint/capy/ui/components/PuzzleCanvas.kt)
* **Problem**:
  When using a physical USB/Bluetooth mouse or running on Chromebooks/Desktop/Emulators, mouse wheel scrolling currently triggers `gameViewModel?.zoomIn()` / `zoomOut()`, which zooms around the screen center rather than zooming relative to the mouse cursor position $(x, y)$.
* **Implementation Plan**:
  1. Update `dispatchGenericMotionEvent` and `setOnGenericMotionListener` in `MainActivity.kt` to extract mouse event coordinates $(f_x, f_y) = (\text{ev.x}, \text{ev.y})$.
  2. Pass focal coordinates to `GameViewModel` / `PuzzleCanvas` to adjust `scale` and calculate offset delta:
     $$\text{newOffset}_x = f_x - (f_x - \text{oldOffset}_x) \times \frac{\text{newScale}}{\text{oldScale}}$$
     $$\text{newOffset}_y = f_y - (f_y - \text{oldOffset}_y) \times \frac{\text{newScale}}{\text{oldScale}}$$
  3. Keep canvas zooming centered on the exact point under the mouse cursor.

---

### 13. [ ] Micro-Region Touch Tap Tolerance
* **Priority**: `P2 - Precision & Ergonomics`
* **Target File**:
  * [`app1/src/main/java/com/capypaint/capy/ui/components/PuzzleCanvas.kt`](./src/main/java/com/capypaint/capy/ui/components/PuzzleCanvas.kt)
* **Problem**:
  On dense photo puzzles, user touch taps near region boundaries may hit a 1-pixel hairline border or adjacent region, causing missed region fill taps.
* **Implementation Plan**:
  1. In `PuzzleCanvas.kt`, when a user taps coordinate $(x, y)$, convert to bitmap coordinate $(px, py)$.
  2. If `regionMap[px, py]` hits a border or incorrect region, inspect a $5 \times 5$ pixel neighborhood around $(px, py)$ for uncompleted regions matching the active color.
  3. If an uncompleted matching region is within 2 pixels, select that region ID to provide smooth, forgiving tap interaction.

---

### 14. [ ] Magnifying Glass Loupe for Micro-Regions
* **Priority**: `P2 - Accessibility & Precision`
* **Target File**:
  * [`app1/src/main/java/com/capypaint/capy/ui/components/PuzzleCanvas.kt`](./src/main/java/com/capypaint/capy/ui/components/PuzzleCanvas.kt)
* **Problem**:
  Extremely small regions on high-resolution photo puzzles can be covered by the user's finger during touch/drag events.
* **Implementation Plan**:
  1. Add a floating $2.5\times$ circular zoom lens overlay (120dp diameter) in `PuzzleCanvas.kt` offset 100dp above the active touch coordinate during drag/tap gestures.
  2. Render a localized crop of `displayBitmap` inside a circular clip path with an amber border and crosshair target.

---

### 15. [ ] Expand Built-in Sample Artwork Gallery
* **Priority**: `P2 - Content Expansion`
* **Target Files**:
  * [`app1/src/main/java/com/capypaint/capy/model/SettingsModel.kt`](./src/main/java/com/capypaint/capy/model/SettingsModel.kt)
  * `app/src/main/res/drawable/`
* **Problem**:
  Currently, the Android app bundles a single sample artwork (`Capybara Sample`), while `web/public/assets/` includes `capybara.webp`, `capy_forest.webp`, and `snail_guitar.webp`.
* **Implementation Plan**:
  1. Bundle shared sample artworks (`capy_forest`, `snail_guitar`, and additional curated artwork) into `app/src/main/res/drawable/`.
  2. Define sample artwork metadata model `SampleArtwork(id, title, category, drawableRes, defaultColorCount)`.
  3. Build a `SampleGallery` selection grid in `SettingsMenuSheet`'s Create tab.

---

## 🔵 P3: Platform, Social & Cloud Features

### 16. [ ] Time-Lapse Video / GIF Export
* **Priority**: `P3 - Social Sharing`
* **Target Files**:
  * New `app/src/main/java/com/capypaint/capy/util/TimeLapseRecorder.kt`
  * [`app1/src/main/java/com/capypaint/capy/viewmodel/GameViewModel.kt`](./src/main/java/com/capypaint/capy/viewmodel/GameViewModel.kt)
* **Implementation Plan**:
  1. Record low-resolution thumbnail frame snapshots in temporary storage as regions are painted (e.g., every 5% completion step or every $N$ filled regions).
  2. Use Android's `MediaMuxer` & `MediaCodec` (or `Animated GIF` generator) to render a 1080p MP4 time-lapse video on puzzle completion.
  3. Trigger native Android Share Sheet intent for sharing to social platforms.

---

### 17. [ ] Daily Capy Challenge & Streak Tracker
* **Priority**: `P3 - Retention & Engagement`
* **Target Files**:
  * [`app1/src/main/java/com/capypaint/capy/data/GamePreferencesRepository.kt`](./src/main/java/com/capypaint/capy/data/GamePreferencesRepository.kt)
  * [`app1/src/main/java/com/capypaint/capy/ui/screens/GameScreen.kt`](./src/main/java/com/capypaint/capy/ui/screens/GameScreen.kt)
* **Implementation Plan**:
  1. Implement a daily seeded puzzle generator using `EpochDay` (`LocalDate.now().toEpochDay()`) that produces a unique daily puzzle.
  2. Track consecutive daily completion streaks in `GamePreferencesRepository` and display a flame streak counter on `GameTopBar`.

---

### 18. [ ] Custom Palette Color Filters
* **Priority**: `P3 - Customization`
* **Target File**:
  * [`app1/src/main/java/com/capypaint/capy/engine/ColorQuantizer.kt`](./src/main/java/com/capypaint/capy/engine/ColorQuantizer.kt)
* **Implementation Plan**:
  1. Add `PaletteFilter` enum (`NATURAL`, `PASTEL`, `RETRO_WARM`, `NEON_NIGHT`, `MONOCHROME`).
  2. Post-process quantized palette colors in `ColorQuantizer.quantize()` by remapping HSV/saturation/hue shift values.

---

### 19. [ ] Google Drive Cloud Sync
* **Priority**: `P3 - Cloud Persistence`
* **Target File**:
  * [`app1/src/main/java/com/capypaint/capy/data/GamePreferencesRepository.kt`](./src/main/java/com/capypaint/capy/data/GamePreferencesRepository.kt)
* **Implementation Plan**:
  1. Integrate Google Drive REST API using App Data Folder (`drive.appdata` scope).
  2. Perform two-way sync of `snapshots.json` manifest and GZIP binary save files on app launch and save creation with conflict resolution based on `lastOpened` timestamp.

---

### 20. [ ] Material You Dynamic Theming (Android 12+)
* **Priority**: `P3 - System Polish`
* **Target File**:
  * [`app1/src/main/java/com/capypaint/capy/ui/theme/Theme.kt`](./src/main/java/com/capypaint/capy/ui/theme/Theme.kt)
* **Implementation Plan**:
  1. Enable `dynamicLightColorScheme(context)` and `dynamicDarkColorScheme(context)` in `CapyTheme` for API 31+ devices.
  2. Retain custom palette swatch rendering on the game canvas independent of system theme colors.
