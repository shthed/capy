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
  - Added 2-finger focal-point pinch-to-zoom and mobile safe-area inset support (`viewport-fit=cover`, `.safe-top`, `.safe-bottom`).

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

## 🧹 Immediate Post-Merge Cleanup

- [ ] **Archive or Delete Redundant Secondary Repositories**:
  - Archive or delete `shthed/capy-g`, `shthed/capy-g2`, `shthed/capy-web`, and `shthed/capyg` on GitHub now that all active code and history are unified in `shthed/capy`.
  - Detach the retired repositories from workspace resources so all future development targets `shthed/capy` exclusively.

---

## 🔗 Milestone 2: Cross-App UX & Asset Optimization

- [ ] **Cross-Link Web, Legacy Web1 & Android APK in UI**:
  - Add links in `web/src/components/SettingsModal.tsx` (and `web1/index.html`) allowing players to switch between the Updated Web App (`/`), Legacy Web v1 (`/web1/`), and direct Android APK download (`capy.apk`).
- [ ] **Optimize & Deduplicate Sample Artwork Assets**:
  - Convert or share the 5.8 MB `capy.png` (`web1/capy.png` and `web/public/assets/capy.png`) using WebP (`capybara.webp` is 564 KB) to save ~5.5 MB in repository checkout and GitHub Pages artifact size.
- [ ] **Expand Built-In Sample Artwork Gallery**:
  - Bundle `capy_forest.webp` and `snail_guitar.webp` (currently in `web/public/assets/`) into the Android app (`app/src/main/res/drawable/`) so both Web and Android offer the same multi-image starter gallery.

---

## 📱 Milestone 3: Android App Release & Performance (`app/`)

*(See [`app/CAPY-TODO.md`](./app/CAPY-TODO.md) for full implementation specifications.)*

- [ ] **R8 Minified Release APK Build**:
  - Configure `isMinifyEnabled = true` and `isShrinkResources = true` in [`app/build.gradle.kts`](./app/build.gradle.kts) with signing configuration so `capy.apk` shrinks from ~18.8 MB to ~3–5 MB with full R8 bytecode optimization.
- [ ] **Canvas Memory & Dirty-Rect Rendering Optimizations**:
  - Eliminate full-canvas overlay bitmap heap allocations (`borderBitmap` / `highlightBitmap`) in [`app/src/main/java/com/capypaint/capy/ui/components/PuzzleCanvas.kt`](./app/src/main/java/com/capypaint/capy/ui/components/PuzzleCanvas.kt).
  - Use region bounding-box partial `setPixels()` updates and viewport frustum culling for region number labels.
- [ ] **Desktop/Mouse & Precision Touch Ergonomics**:
  - Implement cursor-centric mouse wheel zooming, micro-region touch tap tolerance ($5 \times 5$ neighborhood fallback), and a magnifying glass loupe overlay.
