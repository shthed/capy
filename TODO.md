# Capy Monorepo -- Master TODO & Active Roadmap

This document tracks active cross-project tasks, pending optimizations, and platform improvements across the unified **Capy** monorepo (`web/`, `web1/`, `app/`, and `app1/`).

> [!NOTE]
> **Task Hygiene Rule**: Do not leave completed items in `TODO.md`. When a task, feature, or milestone is finished, remove it from this file rather than checking it off. Completed history is preserved in Git commits and pull request descriptions. Keep `TODO.md` strictly focused on active, pending work. Never use emojis in documentation files.

For target-specific deep dives, see also:
- **Web Architecture and UI Reference**: [`WEB.md`](./WEB.md)
- **Puzzle Generation Engine Reference**: [`PUZZLE.md`](./PUZZLE.md)
- **Unified Android Launcher Architecture and Native Bridge**: [`APP.md`](./APP.md)
- **Testing Architecture and Verification Guide**: [`TESTING.md`](./TESTING.md)
- **Contributor and Agent Playbook**: [`AGENTS.md`](./AGENTS.md)

---

## Immediate Post-Merge Cleanup

- [ ] **Archive or Delete Redundant Secondary Repositories**:
  - Archive or delete `shthed/capy-g`, `shthed/capy-g2`, `shthed/capy-web`, and `shthed/capyg` on GitHub now that all active code and history are unified in `shthed/capy`.
  - Detach the retired repositories from workspace resources so all future development targets `shthed/capy` exclusively.

---

## Milestone 1: Replay Animation Export, Redo Stack & Advanced Gestures

- [ ] **Replay Animation Video and GIF Export**:
  - Allow players to export their chronological puzzle completion replay directly as an animated GIF or lightweight WebM/MP4 video to save or share.
- [ ] **Redo Stack Support for Undone Regions**:
  - Pair the single-step Undo button with a complementary Redo action (and `Ctrl+Y` / `Ctrl+Shift+Z` keyboard shortcuts) so players can step forward and backward through their completion history freely.
- [ ] **Custom Pinch-to-Zoom Sensitivity and Anchor Snapping**:
  - Add configurable pinch sensitivity multiplier and optional auto-snapping to whole scale factors (1x, 2x, 4x, 8x).

---

## Milestone 2: Storage Optimization, Save Management, and Save Export/Import

- [ ] **Zero-Copy Image Storage for URL and Local File Puzzles**:
  - Support generating puzzles directly from remote URLs or local file handles (`FileSystemFileHandle` on Web or persistent URI on Android) without copying the entire raw image bitmap into IndexedDB `STORE_IMAGES`.
  - Store lightweight source references (e.g. `sourceUrl` or file path) alongside the serialized region segmentation map, drastically reducing local save storage usage.
- [ ] **Save Export and Import**:
  - Provide a one-click export button to download individual or all saved puzzle snapshots as portable `.capy` / `.json` files.
  - Provide an import file picker to restore or transfer saves across browsers and devices.

---

## Milestone 3: Gallery Discovery, Search, and External Cloud Catalog

- [ ] **Puzzle Tags and Real-Time Search**:
  - Attach searchable tags (`tags: string[]`, such as `Animals`, `Nature`, `Detailed`, `Line Art`, `Coloring`) to built-in sample artwork and custom puzzles.
  - Add a search input and tag chip filters in the Gallery / Create tab allowing players to search puzzles by title or tag.
- [ ] **External Cloud Gallery**:
  - Implement a remote gallery loader that queries an external JSON manifest to browse and preview cloud-hosted puzzle packs on demand.
  - Allow downloading and generating cloud puzzles dynamically without bundling heavy asset images into the base app distribution.

---

## Milestone 4: Google Play Services, Cloud Backup, and Multi-Platform Packaging

- [ ] **Google Play Store and Play Games Services Integration (`app/`)**:
  - Integrate Google Play Games Services SDK in the Android launcher (`app/`) via `CapyAndroidBridge.kt`.
  - Add support for Google Play sign-in, player achievements, and Play Games leaderboards.
- [ ] **Cloud Backup and Cross-Device Synchronization**:
  - Synchronize puzzle progress and user settings across devices using Google Play Games Saved Games API (Android) and cloud backup endpoints (Web).
- [ ] **Cross-Link Web, Legacy Web1 & Android APK in UI**:
  - Add links in `web/src/components/SettingsModal.tsx` allowing players to switch between the Updated Web App (`/`), Legacy Web v1 (`/web1/`), and direct Android APK download (`capy.apk`).
- [ ] **Dynamic Theme Sync (System Dark/Light Mode)**:
  - Add Android `uiMode` configuration listener in `MainActivity.kt` and bridge into `NativeBridge.ts` so system theme changes automatically adjust `canvasBgColor`.
- [ ] **R8 Minified Release APK Build (`app/`)**:
  - Configure `isMinifyEnabled = true` and `isShrinkResources = true` in [`app/build.gradle.kts`](./app/build.gradle.kts) with release signing configuration so `capy.apk` shrinks to ~3-5 MB.
- [ ] **iOS WKWebView Wrapper Packaging**:
  - Leverage [`NativeBridge.ts`](./web/src/services/NativeBridge.ts)'s existing `window.webkit.messageHandlers.CapyIOS` dispatch mechanism to create a lightweight Swift iOS wrapper around `web/dist/`.
- [ ] **Retire Legacy Targets (`web1/` & `app1/`)**:
  - Remove deprecated legacy vanilla JS app (`web1/`) and legacy Jetpack Compose app (`app1/`) from repository now that the unified React 19 web app and Android wrapper are fully operational.
