# Capy Monorepo — Master TODO & Active Roadmap

This document tracks active cross-project tasks, pending optimizations, and platform improvements across the unified **Capy** monorepo (`web/`, `web1/`, `app/`, and `app1/`).

> [!NOTE]
> **Task Hygiene Rule**: Do not leave completed items in `TODO.md`. When a task, feature, or milestone is finished, remove it from this file rather than checking it off. Completed history is preserved in Git commits and pull request descriptions. Keep `TODO.md` strictly focused on active, pending work.

For target-specific deep dives, see also:
- **Puzzle Generation Engine Reference**: [`PUZZLE.md`](./PUZZLE.md)
- **Unified Android Launcher Architecture & Native Bridge**: [`APP.md`](./APP.md)
- **Legacy Android v1 Architecture & Roadmap**: [`app1/APP1.md`](./app1/APP1.md)
- **Legacy Web v1 Technical Reference & Style Guide**: [`web1/WEB1.md`](./web1/WEB1.md)

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
- [ ] **Retire Legacy Targets (`web1/` & `app1/`)**:
  - Remove deprecated legacy vanilla JS app (`web1/`) and legacy Jetpack Compose app (`app1/`) from repository now that the unified React 19 web app and Android wrapper are fully operational.
  - Relocate any reusable maintenance scripts from `web1/scripts/` to `scripts/`.
