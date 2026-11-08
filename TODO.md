# Capy Monorepo — Master TODO & Roadmap

This document tracks cross-project tasks, post-merge cleanups, puzzle engine unification plans, and platform improvements across the unified **Capy** monorepo (`web/`, `web1/`, `app/`, and `app1/`).

For target-specific deep dives, see also:
- **Legacy Android v1 Detailed Optimization Roadmap**: [`app1/CAPY-TODO.md`](./app1/CAPY-TODO.md)
- **Legacy Web v1 Maintenance Checklist**: [`web1/docs/TODO.md`](./web1/docs/TODO.md)
- **Puzzle Generation Engine Reference**: [`PUZZLE.md`](./PUZZLE.md)

---

## ✅ Completed: Single-Codebase Web & Android Unification

- [x] **Preserve Native Jetpack Compose Android v1 in [`app1/`](./app1)**:
  - Renamed the original Jetpack Compose Android implementation to `app1/` (`:app1`), preserving all custom Kotlin K-Means/segmentation code and JUnit4 tests intact.
- [x] **Unified Web-Wrapper Android Launcher in [`app/`](./app)**:
  - Created a lightweight native Android shell (`MainActivity.kt` + `CapyAndroidBridge.kt`) serving `web/dist/` offline via `WebViewAssetLoader` (`https://appassets.androidplatform.net/assets/www/index.html`).
  - Integrated native tactile haptics (`Vibrator` / `HapticFeedbackConstants`), hardware back gesture modal closing, native `PickVisualMedia` photo picker, `Intent.ACTION_SEND` image sharing into Capy, and persistent JSON save backups in `filesDir/capy_saves`.
  - Automated `syncWebAssets` in [`app/build.gradle.kts`](./app/build.gradle.kts) and linked `web-dist` in [`.github/workflows/deploy-branch.yml`](./.github/workflows/deploy-branch.yml).
- [x] **60/120 FPS Offscreen Canvas Layer Caching in [`web/src/components/PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx)**:
  - Cached the base puzzle layer (`baseCanvasRef` with incremental dirty-rect updates on region fill) and highlight layer (`highlightCanvasRef` with GPU alpha modulation), eliminating per-frame full-canvas pixel iteration and DOM allocations.
  - Added 2-finger focal-point pinch-to-zoom math, 1-finger panning, Bresenham stroke interpolation for paint mode, and visual tap feedback dots.
- [x] **Dynamic Safe-Area Insets Bridge & Edge-to-Edge System UI ([`app/`](./app) & [`web/`](./web))**:
  - Solved Android WebView's lack of CSS `env(safe-area-inset-*)` support by bridging physical `systemBars() or displayCutout()` insets from `MainActivity.kt` into CSS custom properties (`--safe-area-top`, `--safe-area-bottom`, `--safe-area-left`, `--safe-area-right`).
  - Added fallback status/navigation bar query on startup to eliminate frame-0 layout flicker.
  - Formulated cross-platform `:root` fallback variables in [`web/src/index.css`](./web/src/index.css) (`.safe-top`, `.safe-bottom`, `.safe-bottom-raised`).
  - Verified on Google Pixel 7: completely prevents top bar buttons and bottom palette swatches from overlapping the status bar (clock, Wi-Fi, battery) or gesture navigation bar.
  - Added Playwright test verification in [`web1/tests/ui-load-page.spec.js`](./web1/tests/ui-load-page.spec.js) and JUnit4 test in [`CapyAndroidBridgeTest.kt`](./app/src/test/java/com/capypaint/capy/CapyAndroidBridgeTest.kt).

---

## ✅ Completed in PR #431 (Monorepo Unification & CI Optimization)

- [x] **Consolidate Repositories into `shthed/capy`**:
  - Imported Updated Web App (`React 19 + TypeScript + Vite 6 + Tailwind CSS 4`) from `shthed/capy-web` into [`web/`](./web).
  - Relocated Legacy Vanilla JS Web App v1 (`1fa28eb` + PR #430 fixes) into [`web1/`](./web1).
  - Imported Native Android Jetpack Compose App (`com.capypaint.capy`) and Gradle 9.3.1 wrapper from `shthed/capy-g2` into [`app1/`](./app1).
- [x] **Multi-Target GitHub Pages & APK Deployment**:
  - Updated Web (`web/`) deployed at `/` (`https://shthed.github.io/capy/`) and `/pull/<pr>/`.
  - Legacy Web v1 (`web1/`) deployed at `/web1/` (`https://shthed.github.io/capy/web1/`) and `/pull/<pr>/web1/`.
  - Android Debug APK (`app/`) deployed at `/capy.apk` (`https://shthed.github.io/capy/capy.apk`) and `/pull/<pr>/capy.apk`, plus uploaded as workflow artifact `capy-debug-apk`.
- [x] **CI/CD Consolidation & Performance Optimization ([`.github/workflows/deploy-branch.yml`](./.github/workflows/deploy-branch.yml))**:
  - Removed duplicate workflows (`ci.yml`, `post-deploy-tests.yml`) and combined build, test, and deploy into a single 3-job pipeline (`android`, `web`, `deploy`).
  - Enabled writable Gradle build caching (`cache-read-only: false`, `--build-cache`, `org.gradle.parallel=true`), npm caching, Playwright Chromium caching (`~/.cache/ms-playwright`), and pre-built artifact reuse (`web-dist` + `capy-debug-apk`), cutting warm-cache wall-clock time from **~4m 20s** to **1m 14s** (-82% runner minutes).
- [x] **Squash `gh-pages` Git History**:
  - Updated [`deploy-branch.yml`](./.github/workflows/deploy-branch.yml), [`cleanup-branches.yml`](./.github/workflows/cleanup-branches.yml), and [`cleanup-closed-pr.yml`](./.github/workflows/cleanup-closed-pr.yml) to commit to `gh-pages` using a single parentless orphan commit (`git checkout --orphan gh-pages-squashed && git push --force origin gh-pages`) so binary `capy.apk` deployments never bloat repository Git history.

---

## ✅ Completed: Gameplay, Canvas & UX Refinements (`automation/gameplay-fixes`)

- [x] **Ghost Active Color State Desync Fix**:
  - Resolved bug where images with pruned empty clusters (e.g. Snail Guitar) left `activeColorId` desynced from `dockPalette[0].id`.
  - Evaluated `getVisiblePalette` before assigning default active color across session restore, artwork load, and snapshot load, plus added defensive dock synchronization.
- [x] **Hint Auto-Pan Clamping & Stability**:
  - Constrained hint auto-centering to only pan if `scale > 1.05` and the region is currently off-screen.
  - Added boundary clamping to drag and pan offsets, preventing canvas from drifting into an empty void.
- [x] **Fit-to-Screen Reset Action & Double-Tap Gesture**:
  - Added floating `Maximize2` "Fit to Screen" button that displays when zoomed or panned.
  - Added double-tap detection (<300ms) to smoothly reset camera zoom to 1x and re-center the canvas.
- [x] **Gallery Canvas Framing & Depth**:
  - Added ambient drop shadow (`rgba(0, 0, 0, 0.55)`, blur 24px) around the artwork boundary, creating distinct framing on dark stage backgrounds.
- [x] **Pristine Reference Preview Mode**:
  - Defaulted `showPreviewLabels` to `false` in storage preferences.
  - Suppressed glowing highlight circles during preview mode so players can examine the clean original artwork.
- [x] **Micro-Region Label Culling**:
  - Suppressed badge numbers on tiny sub-threshold regions at 1x zoom (`minDim * effScale < 14`), eliminating collision swarms while keeping active and hinted regions visible.
- [x] **Mobile Settings Modal Responsiveness**:
  - Enabled horizontal scroll on settings tab navigation (`overflow-x-auto no-scrollbar`) with flexible padding, preventing "Saves" tab cutoff on narrow mobile screens.
- [x] **Palette Swatch Typography**:
  - Enlarged swatch remaining count labels to `text-[10px]` with high-contrast text styling.
- [x] **100% Victory Celebration & PNG Export**:
  - Implemented `VictoryModal` with trophy badge, stats, full-resolution artwork PNG download (`handleExportArtwork`), and quick "Pick Next Artwork" action.

---

## 🧹 Immediate Post-Merge Cleanup

- [ ] **Archive or Delete Redundant Secondary Repositories**:
  - Archive or delete `shthed/capy-g`, `shthed/capy-g2`, `shthed/capy-web`, and `shthed/capyg` on GitHub now that all active code and history are unified in `shthed/capy`.
  - Detach the retired repositories from workspace resources so all future development targets `shthed/capy` exclusively.

---

## 🔗 Milestone 2: Cross-App UX & Asset Optimization

- [ ] **Cross-Link Web, Legacy Web1 & Android APK in UI**:
  - Add links in `web/src/components/SettingsModal.tsx` (and `web1/index.html`) allowing players to switch between the Updated Web App (`/`), Legacy Web v1 (`/web1/`), and direct Android APK download (`capy.apk`).
- [ ] **Optimize & Deduplicate Sample Artwork Assets**:
  - Replace the uncompressed 5.8 MB `capy.png` (`web1/capy.png` and `web/public/assets/capy.png`) with WebP (`capybara.webp` is 564 KB) to save ~5.5 MB in repository checkout and GitHub Pages artifact size.
- [ ] **Dynamic Theme Sync (System Dark/Light Mode)**:
  - Add Android `uiMode` configuration listener in `MainActivity.kt` and bridge into `NativeBridge.ts` so system theme changes automatically adjust `canvasBgColor`.

---

## 📱 Milestone 3: Android Release Build & Multi-Platform Packaging

- [ ] **R8 Minified Release APK Build (`app/`)**:
  - Configure `isMinifyEnabled = true` and `isShrinkResources = true` in [`app/build.gradle.kts`](./app/build.gradle.kts) with release signing configuration so `capy.apk` shrinks to ~3–5 MB.
- [ ] **iOS WKWebView Wrapper Packaging**:
  - Leverage [`NativeBridge.ts`](./web/src/services/NativeBridge.ts)'s existing `window.webkit.messageHandlers.CapyIOS` dispatch mechanism to create a lightweight Swift iOS wrapper around `web/dist/`.
- [ ] **Preserved Native Jetpack Compose App Optimization (`app1/`)**:
  - *(See [`app1/CAPY-TODO.md`](./app1/CAPY-TODO.md) for full implementation specifications.)*
  - Eliminate overlay bitmap heap allocations and add partial dirty-rect updates to `app1/src/main/java/com/capypaint/capy/ui/components/PuzzleCanvas.kt`.
