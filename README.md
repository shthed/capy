# Capy: Color-by-Number Suite

[![Web App](https://img.shields.io/badge/Web_App-Play_Online-blue?style=for-the-badge&logo=googlechrome&logoColor=white)](https://shthed.github.io/capy/)
[![Android APK](https://img.shields.io/badge/Android-Download_APK-green?style=for-the-badge&logo=android&logoColor=white)](https://shthed.github.io/capy/capy.apk)
[![License: CC BY-NC-SA 4.0](https://img.shields.io/badge/License-CC_BY--NC--SA_4.0-orange?style=for-the-badge)](LICENSE.md)

**Capy** is a serene, delightful color-by-number game you can play directly in your web browser or on Android. Transform any photo or artwork into a crisp, playable color puzzle with smart number guides, or relax with Free Colour coloring pages.

- **[Play Capy in Your Browser](https://shthed.github.io/capy/)**
- **[Download the Android APK](https://shthed.github.io/capy/capy.apk)**

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
- **Turn Any Photo into a Puzzle**: Tap the photo upload button to convert your favorite pictures, pets, landscapes, or drawings into instant playable puzzles, or zoom in with **Infinite Zoom 2x Detail Tiles**.
- **Shareable Links and Simultaneous Co-op**: Share a compact `< 2 KB` progress URL (`#s=<token>`) with friends, or host a 6-character **Co-op Room** to paint the same puzzle simultaneously with live collaborator ripples.
- **Compact `.capy` v2 Saves and CRDT Cloud Sync**: Ultra-compact RLE binary saves (`~140x` smaller footprint) and conflict-free Set-Union Cloud Sync ensure zero progress is ever lost across devices.
- **Searchable Gallery and Community Ideas**: Filter artwork by category tags (`Animals`, `Coloring`, `Nature`, `Line Art`, `Detailed`, `Music`), submit family-friendly puzzle ideas, and vote on upcoming community gallery packs.
- **Smooth Navigation**: One-finger double-tap-and-drag zoom, fluid pinch-to-zoom up to 12x, and inertial gliding pan momentum just like Google Maps.
- **Continuous Paint Mode**: Drag your finger across the screen to quickly fill connected matching regions without tapping each one individually.
- **100% Offline-First and Private**: All image processing and coloring run locally inside a sandboxed Web Worker. Play completely offline with zero forced accounts or ads.

---

## How to Play

1. **Pick an Artwork**: Start playing instantly with pre-generated built-in favorites (*Capybara*, *Mushroom Forest*, *Capy Forest*, and *Snail Guitar*) with zero generation wait, or import your own photo.
2. **Choose a Color**: Tap any numbered swatch in the bottom **Palette Dock**. Matching puzzle shapes highlight instantly in that color.
3. **Tap or Drag to Paint**: Tap the numbered shapes on the canvas to fill them. Turn on the **Paint Brush** tool to color continuously by dragging.
4. **Zoom and Pan**: Double-tap and drag (down to zoom in, up to zoom out, configurable in Settings), or pinch with two fingers to inspect fine micro-regions.
5. **Celebrate**: Complete all colors to trigger the victory confetti burst and download your finished masterpiece.

---

## Controls and Gestures Cheat Sheet

| Gesture / Control | Action |
| :--- | :--- |
| **Tap Region** | Paints the region if it matches the selected active color. |
| **Drag Canvas** | Pans the artwork smoothly across the screen with inertial gliding momentum. |
| **Double-Tap and Drag Down / Up** | Google Maps-style one-finger zoom: drag down to zoom in, drag up to zoom out (reversible via Settings). |
| **Pinch / Mouse Wheel** | Multi-touch focal zoom in / zoom out up to 12x. |
| **Paint Brush Button** | Toggles continuous drag-to-paint mode. |
| **Undo Button (`Ctrl+Z`)** | Undoes the last painted region. |
| **Long-Press Undo Button** | Opens the interactive Replay timeline scrubber to inspect history and resume play from any point. |
| **Redo Button (`Ctrl+Y` / `Ctrl+Shift+Z`)** | Steps forward to re-apply previously undone regions. |
| **Preview Eye Button** | Toggles unmasked preview of the original source artwork. |
| **Lightbulb / Swatch Double-Tap** | Targets and animates the next unpainted region for the active color. |

---

## Developer Quick Start

To run Capy locally in development mode:

```bash
cd web
npm install
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

Run the automated browser test suite (tests gestures, settings, canvas):
```bash
npm run test:game
```

---

## Technical Documentation and Architecture

All detailed architectural guides, computer vision algorithms, and native bridge specifications live in dedicated documentation files:

- **Web Architecture and UI Reference**: [`WEB.md`](./WEB.md) -- Comprehensive guide to React 19, Vite, 3-tier offscreen canvas rendering, gesture engine, and settings dictionary.
- **Android Native Launcher**: [`APP.md`](./APP.md) -- Kotlin launcher, AndroidX `WebViewAssetLoader`, Google Play Games Services v2 bridge, native haptics, and backup specifications.
- **Cloud Sync, Google Play Games and Multiplayer Data Sharing**: [`CLOUD.md`](./CLOUD.md) -- Plain-English and technical guide to Play Games profile login, CRDT Cloud Sync, `< 2 KB` shareable URL links, and simultaneous Co-op rooms.
- **Puzzle Generation Engine**: [`PUZZLE.md`](./PUZZLE.md) -- Web Worker segmentation, Sobel line extraction, Red-Mean K-Means clustering, and watershed absorption.
- **Testing Architecture**: [`TESTING.md`](./TESTING.md) -- Playwright E2E testing guide, multi-touch gesture verification, and CI pipelines.
- **Project Roadmap and Tasks**: [`TODO.md`](./TODO.md) -- Active milestones and post-merge cleanup tracking.
- **Agent and Contributor Playbook**: [`AGENTS.md`](./AGENTS.md) -- Monorepo workflows, development rules, and PR standards.
