# Capy: Color-by-Number Suite

[![Web App](https://img.shields.io/badge/Web_App-Play_Online-blue?style=for-the-badge&logo=googlechrome&logoColor=white)](https://shthed.github.io/capy/)
[![Android APK](https://img.shields.io/badge/Android-Download_APK-green?style=for-the-badge&logo=android&logoColor=white)](https://shthed.github.io/capy/capy.apk)
[![License: CC BY-NC-SA 4.0](https://img.shields.io/badge/License-CC_BY--NC--SA_4.0-orange?style=for-the-badge)](./LICENSE.md)

**Capy** is a serene, delightful color-by-number game you can play directly in your web browser or on Android. Transform any photo or artwork into a crisp, playable color puzzle with smart number guides, or relax with Free Colour coloring pages.

- **[Play Capy in Your Browser (Stable)](https://shthed.github.io/capy/)**
- **[Download the Android APK (Stable)](https://shthed.github.io/capy/capy.apk)**
- **[Try Upcoming Features on the Beta Channel](https://shthed.github.io/capy/beta/)** ([Beta Android APK](https://shthed.github.io/capy/beta/capy.apk) | [Official GitHub Releases](https://github.com/shthed/capy/releases))
- **[Read the Privacy Policy](https://shthed.github.io/capy/privacy-policy.html)**

---

## Visual Showcase and Gallery

<p align="center">
  <img src="./docs/gallery/desktop_gameplay.png" alt="Capy Desktop Gameplay" width="90%" />
  <br>
  <em>Interactive color-by-number canvas with responsive Palette Dock, dynamic active region highlighting, and centroid glow badges.</em>
</p>

| **Fine Zoom and Active Highlighting** | **Free Colour / Coloring Page Mode** |
| :---: | :---: |
| <img src="./docs/gallery/zoomed_detail.png" alt="Fine Zoom and Active Highlighting" width="100%" /> | <img src="./docs/gallery/coloring_page_mode.png" alt="Free Colour / Coloring Page Mode" width="100%" /> |
| *Continuous zoom up to 12x with poles-of-inaccessibility labels and active region fills* | *Mushroom Forest with custom HSL/Hex palette picker and quick presets* |

| **Settings and Appearance Customizer** | **Mobile Portrait Experience** |
| :---: | :---: |
| <img src="./docs/gallery/settings_customizer.png" alt="Settings and Appearance Customizer" width="100%" /> | <img src="./docs/gallery/mobile_gameplay.png" alt="Mobile Portrait Experience" width="55%" /> |
| *Circular background swatches, custom pipette color pickers, and smooth pan momentum* | *Full edge-to-edge touch UI with Google Maps-style one-finger drag zoom* |

---

## Why You'll Love Capy

- **Two Ways to Play**: Classic **Color by Number** guided coloring or relaxed **Free Colour** creative mode.
- **Turn Any Photo into a Puzzle or Printable Sheet**: Tap the photo upload button to convert your favorite pictures, pets, landscapes, or drawings into instant playable puzzles, dive into **Infinite Zoom 2x Detail Tiles** with one-tap **Parent Puzzle** breadcrumbs, or export crisp monochrome **Printable Vector SVG (`.svg`) Coloring Sheets** for physical paper coloring.
- **Shareable Links and Simultaneous Co-op**: Share a compact `< 2 KB` progress URL (`#s=<token>`) with friends, or host a 6-character **Co-op Room** to paint the same puzzle simultaneously with live collaborator ripples and real-time undo sync.
- **Compact `.capy` v2 Saves and CRDT Cloud Sync**: Ultra-compact RLE binary saves (`~140x` smaller footprint) and conflict-free Set-Union Cloud Sync across Google Account (Google Drive `appDataFolder`) and Android Google Play Games Services v2 ensure zero progress is ever lost across devices.
- **Daily Featured Puzzle, Searchable Gallery and Community Ideas**: Play a fresh deterministic UTC **Puzzle of the Day** completely offline, filter artwork by category tags (`Animals`, `Coloring`, `Nature`, `Line Art`, `Detailed`, `Music`), track your **Lifetime Stats**, and vote on upcoming community gallery packs.
- **Smooth Navigation and Inclusive Accessibility**: One-finger double-tap-and-drag zoom, fluid pinch-to-zoom up to 12x, inertial gliding pan momentum, full desktop keyboard gameplay shortcuts, and a **Reduced Motion** accessibility mode.
- **Continuous Paint Mode**: Drag your finger across the screen to quickly fill connected matching regions without tapping each one individually.
- **100% Offline-First and Private**: All image processing and coloring run locally inside a sandboxed Web Worker. Play completely offline with zero forced accounts or ads.

---

## How to Play

1. **Pick an Artwork**: Start playing instantly with pre-generated built-in favorites (*Capybara*, *Mushroom Forest*, *Capy Forest*, and *Snail Guitar*) with zero generation wait, launch the **Puzzle of the Day** in the **Create** tab, or import your own photo.
2. **Choose a Color**: Tap any numbered swatch in the bottom **Palette Dock** (or simply tap any region directly in default **Easy Mode** to auto-select its color). Matching puzzle shapes highlight instantly.
3. **Tap or Drag to Paint**: Tap numbered shapes on the canvas to fill them, or turn on the **Paint Brush** tool to color continuously by dragging.
4. **Zoom and Pan**: Double-tap and drag (down to zoom in, up to zoom out, configurable in Settings), or pinch with two fingers to inspect fine micro-regions.
5. **Celebrate**: Complete all colors to trigger the victory confetti burst, watch your chronological replay, and download your finished masterpiece.

---

## Controls and Gestures Cheat Sheet

- **Tap Region**: In **Easy Mode** (default), auto-selects the tapped region's color and fills it immediately; in **Normal Mode**, fills the region when it matches the active swatch; in **Free Colour Mode**, paints with any selected color.
- **Drag Canvas**: Pans the artwork smoothly across the screen with inertial gliding momentum.
- **Double-Tap and Drag Down / Up**: Google Maps-style one-finger focal zoom—drag down to zoom in, drag up to zoom out (reversible and sensitivity-scalable via Settings).
- **Pinch / Mouse Wheel**: Multi-touch focal zoom in or out between `0.5x` and `12x`, with optional magnetic zoom detents (`1x`, `2x`, `4x`, `8x`, `12x`) in Settings.
- **Top-Bar Zoom Badge**: Taps step cleanly through `1x` -> `2x` -> `4x` -> `8x` -> `12x` -> `1x` relative zoom stops anchored at the viewport center.
- **Desktop Keyboard Shortcuts**: Keys `1`--`9` select the corresponding palette swatch, `+` / `=` zoom in, `-` / `_` zoom out, `0` resets the viewport to `1x` fit view, and `ArrowUp`/`W`, `ArrowDown`/`S`, `ArrowLeft`/`A`, `ArrowRight`/`D` pan the canvas by `64px` steps (automatically ignored when modals or text inputs are active or browser modifiers are held).
- **Paint Brush Button**: Toggles continuous drag-to-paint stroke mode.
- **Undo Button (`Ctrl+Z` / `Cmd+Z`)**: Undoes the last painted region (enabled automatically in Free Colour mode or via Settings toggle).
- **Long-Press Undo Button (`>= 450ms`)**: Opens the interactive YouTube-style Replay timeline scrubber (`0.5x`–`20x`) to scrub history and resume play from any step.
- **Redo Button (`Ctrl+Y` / `Ctrl+Shift+Z`)**: Steps forward to re-apply previously undone regions.
- **Preview Eye Button**: Toggles unmasked preview of the original source artwork.
- **Lightbulb / Active Swatch Second Tap**: Targets and animates the next unpainted region for the active color.
- **`Escape` Key**: Cancels inline save renaming first, or closes the topmost open popover, modal, or replay bar (`Enter` saves an inline save rename).

---

## Developer Quick Start

To run Capy locally in development mode:

```bash
cd web
npm ci
npm run dev
```
Open `http://localhost:3000` in your browser.

Verify strict TypeScript types, production bundling, and the unified automated test suite (binary codec, engine, gestures, settings, and Playwright E2E gameplay):
```bash
npm run lint && npm run build && npm test
```

---

## Technical Documentation and Architecture

All detailed architectural guides, computer vision algorithms, and native bridge specifications live in dedicated documentation files:

- **Web Architecture and UI Reference**: [`WEB.md`](./WEB.md) -- React 19, Vite 6, 3-tier offscreen canvas rendering, 6-mode gesture engine, Worker IPC, storage keys, and `UserSettings` dictionary.
- **Android Native Launcher**: [`APP.md`](./APP.md) -- Kotlin launcher, AndroidX `WebViewAssetLoader`, Google Play Games Services v2 `SnapshotsClient` sync, Pixel API 33+ haptics, and disk backups.
- **Cloud Sync, Google Account / Play Games and Multiplayer Sharing**: [`CLOUD.md`](./CLOUD.md) -- Google Identity Services OAuth 2.0 (`drive.appdata`), Play Games v2 login, CRDT Cloud Sync, `< 2 KB` shareable URL links, and simultaneous Co-op rooms.
- **Puzzle Generation Engine**: [`PUZZLE.md`](./PUZZLE.md) -- Web Worker 5-strategy segmentation, adaptive Otsu/Sobel line extraction, Red-Mean K-Means++ clustering, and watershed border alignment.
- **Testing Architecture**: [`TESTING.md`](./TESTING.md) -- Unified Vite SSR + Playwright E2E verification suite, multi-touch gesture patterns, and CI pipelines.
- **Versioning Scheme and Changelog**: [`CHANGELOG.md`](./CHANGELOG.md) -- Semantic Versioning (`MAJOR.MINOR.PATCH`), Android `versionCode` mapping, and chronological release history.
- **Product Roadmap (Epics and Stories)**: [`ROADMAP.md`](./ROADMAP.md) -- Strategic epics, user stories, external readiness gates, platform icebox, and collapsed shipped milestones.
- **Active Sprint Backlog**: [`TODO.md`](./TODO.md) -- Ready-for-dev Sprint 1 bugfixes, `1-PR` engineering slices, and `[quick-win]` queue.
- **Development and Maintenance Guide**: [`DEV.md`](./DEV.md) -- Human + AI co-development workflows, Hybrid Agile sprints, Gemini 4 model routing, shared technical guardrails, CI/CD pipelines, and maintenance playbooks.
- **AI Agent Operational Playbook**: [`AGENTS.md`](./AGENTS.md) -- Auto-loaded AI guardrails, mobile-first formatting rules, and PR readiness contract for AI coding agents.
- **Privacy Policy and Data Safety**: [`web/public/privacy-policy.html`](./web/public/privacy-policy.html) -- Local-first photo processing and optional Google Drive `appDataFolder` / Play Games Cloud Sync disclosures.
