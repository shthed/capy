# Testing Architecture & Verification Guide: Capy Monorepo

This document outlines the testing strategy, tooling rationale, unified end-to-end verification suite, and platform test commands for the Capy monorepo across **Web** (`web/`) and **Android** (`app/`).

---

## 1. Tooling Evaluation: Why Playwright + Vite SSR is Optimal for Capy

Testing an interactive HTML5 2D Canvas color-by-number game with Web Workers, binary RLE codecs, and mobile touch gestures presents unique requirements that traditional DOM testing libraries (e.g., Jest + JSDOM or Cypress) cannot fulfill alone.

### Comparison Matrix

| Capability | Playwright | Puppeteer | Cypress | Jest / Testing Library |
| :--- | :--- | :--- | :--- | :--- |
| **Multi-Touch & Pointer Gestures** | **Native** (`hasTouch`, `touchIdentifier`, pointer stream) | Raw CDP touch events only | Limited / plugin-dependent | No real touch/canvas simulation |
| **Canvas Pixel & Hit-Test Inspection** | **Full** (evaluate canvas contexts, `getImageData`, pixel sampling) | Full (evaluate in page) | Partial (iframe constraints) | Mocked / stubbed canvas only |
| **Web Worker Lifecycle & Cancellation** | **Automatic** tracking and message interception | Manual worker target attachment | Poor worker isolation in iframe | No worker thread execution |
| **Mobile Viewport & Safe-Area Emulation** | **Native** (DPR, safe-area insets, mobile touch events) | Viewport resize only | Emulated viewports only | Headless DOM only |
| **Execution Speed & Reliability** | **High** (direct CDP multiplexing, isolated contexts) | High | Medium (in-browser iframe overhead) | Very High (but no browser rendering) |

### Key Architectural Advantages
1. **Single Unified Runner (`web/scripts/test.mjs`)**:
   - Instead of spawning multiple redundant browser processes across fragmented test scripts, Capy consolidates all engine/codec unit assertions and browser E2E checks into a single deterministic script (`npm test` -> [`web/scripts/test.mjs`](./web/scripts/test.mjs)).
   - Automatically starts an in-process Vite preview server on port 3000 if one is not already running, eliminating manual background server orchestration.
2. **Precise Multi-Touch & Pointer Gesture Engine**:
   - Capy relies on custom touch gestures: multi-touch pinch-to-zoom, single-finger inertial pan flicking, and Google Maps-style one-finger double-tap-and-drag zoom.
   - Playwright's pointer dispatch engine sends microsecond-timed `pointerdown`, `pointermove`, and `pointerup` sequences with velocity tracking, testing inertial gliding and cancel-on-touch logic.
3. **Worker-Driven Pipeline & Offline Service Worker Verification**:
   - Verifies both instant pre-baked sample loading (`sample_saves.capy` with zero worker wait on first boot) and live Web Worker (`puzzle.worker.ts`) custom photo segmentation, plus 100% offline Service Worker (`capy-cache-v2`) reload.

---

## 2. Test Suites Across Targets

| Target | Test Scope | Verification Commands |
| :--- | :--- | :--- |
| **Web Application (`web/`)** | TypeScript type check, production bundle build, unified codec + E2E browser suite | `npm run lint`, `npm run build`, `npm test` |
| **Native Android Launcher (`app/`)** | JUnit4 native bridge unit tests, web asset bundle sync, debug APK assembly | `./gradlew app:testDebugUnitTest`, `./gradlew app:assembleDebug` |

### A. Web Application (`web/`)

| Command | Script | What It Verifies |
| :--- | :--- | :--- |
| `npm run lint` | `tsc --noEmit` | Strict TypeScript type-checking across all React components, services, and worker modules. |
| `npm run build` | `tsc && vite build` | Compiles TypeScript and produces minified production bundles in `web/dist/`. |
| `npm test` | `node scripts/test.mjs` | **Unified Engine, Codec & Browser E2E Suite**:<br>1. **Engine & Binary Codec Unit Checks (Vite SSR)**: Verifies `ColorQuantizer` unsigned ARGB bit-packing, `RegionSegmenter` `cellPartitionMap` mosaic separation, bit-exact `CapyCodec` RLE + LEB128 compression/decompression, `.capy` v2 Gzip single/archive framing, and `< 2 KB` `ProgressDeltaV2` CRDT merges.<br>2. **Instant Boot & PWA Shell**: Verifies `/manifest.webmanifest`, `/privacy-policy.html`, `capy-cache-v2` Service Worker registration, and instant 4-sample `sample_saves.capy` bootstrap with zero worker spawn.<br>3. **Canvas Gameplay & Gestures**: Verifies `PaletteDock` swatch selection, region tap coloring, one-finger double-tap-and-drag zoom, inertial pan momentum flick + zero-latency touch cancellation, and Paint Mode.<br>4. **Undo, Redo & Replay Controls**: Verifies `Enable Undo Action` toggle, single-step Undo/Redo, Redo button stacking above Undo, `Ctrl+Z` / `Ctrl+Y`, long-press Undo (`>= 450ms`) opening the default-minimised `ReplayControls` pill (`data-minimized="true"`), expanding to the timeline scrubber (`replay-toggle-minimize-btn`), `Resume Here` rewinding state, restoring saved zoom extent before replay on save load, automatic offscreen step fast-forwarding, Follow Painting camera tracking (`replay-follow-btn`, waiting for viewport catch-up without skipping offscreen steps), Auto-Loop replay (`replay-loop-btn`), and live panning/zooming during active playback.<br>5. **Settings, Gallery & Community Ideas**: Verifies atomic preset background reset (`Charcoal`), Settings tab memory (`capy_last_settings_tab`), Gallery tag filtering, search empty state, and family-friendly Community Puzzle Idea moderation.<br>6. **Share Links, Simultaneous Co-op & Saves**: Verifies `< 2 KB` `#s=<token>` share URL restoration in an isolated browser context, 2-peer real-time `BroadcastChannel` Co-op stroke sync, Saves Detail/Thumbnails view switching, custom photo `STORE_IMAGES` upload, `.capy` v2 binary export, and 100% offline PWA reload. |
| `npm run gallery:capture` | `node scripts/capture-gallery.mjs` | Captures automated high-DPI UI showcase screenshots into `docs/gallery/`. |
| `npm run generate:samples` | `node scripts/generate-sample-saves.mjs` | Generates all 4 built-in `SAMPLE_GALLERY` puzzles via headless Chromium and exports `web/public/assets/sample_saves.capy`. |

### B. Native Android Application (`app/`)

From the repository root:

```bash
# 1. Run unit tests for unified native Android wrapper (:app)
./gradlew app:testDebugUnitTest

# 2. Compile Web bundle and assemble Android debug APK
./gradlew app:buildWeb
./gradlew app:assembleDebug
```

> [!IMPORTANT]
> Never run `./gradlew app:installDebug` unless explicitly requested by the user, in accordance with repository safety rules.

---

## 3. Automated Gesture & Canvas Feature Testing Patterns

When extending [`web/scripts/test.mjs`](./web/scripts/test.mjs) for [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx), adhere to these patterns:

### 1. Testing Google Maps-Style One-Finger Double-Tap-and-Drag Zoom
- **Gesture Sequence**:
  1. Dispatch `pointerdown` at $(x, y)$, wait 30ms, and dispatch `pointerup` (first tap recorded).
  2. Within 200ms (below `DOUBLE_TAP_TIMEOUT = 350ms`), dispatch second `pointerdown` at $(x, y)$.
  3. Dispatch `pointermove` downward $(x, y + \Delta y)$ to zoom **in** (or upward to zoom **out** when `reverseDoubleTapZoom` is `false`).
  4. Dispatch `pointerup`.

### 2. Testing Smooth Pan Momentum (Inertial Gliding) & Touch Cancellation
- **Gesture Sequence**:
  1. Dispatch `pointerdown` at $(x_0, y_0)$.
  2. Dispatch a rapid series of `pointermove` events over ~80ms such that flick velocity exceeds $0.18\text{ px/ms}$, then dispatch `pointerup`.
  3. Dispatch an immediate `pointerdown` mid-glide to verify zero-latency momentum cancellation.

### 3. Testing Corner Panning Bounds (`clampCanvasOffset`)
- **Verification**:
  1. Set zoom scale to $2.5\times$ and pan towards the top-left corner $(0, 0)$.
  2. Verify that the artwork corner can be panned past the viewport center:
     $$\text{panOffset.x} \le \frac{\text{containerWidth}}{2}$$

---

## 4. Continuous Integration Pipeline ([`.github/workflows/deploy-branch.yml`](./.github/workflows/deploy-branch.yml))

Capy uses a bifurcated GitHub Actions workflow ensuring high velocity and security:

1. **Build & Test Job** (`contents: read`):
   - Compiles `web/` (`npm ci && npm run build`, which includes `tsc`).
   - Executes Android unit tests (`./gradlew app:testDebugUnitTest`).
   - Assembles native Android debug APK (`./gradlew app:assembleDebug`).
   - Runs in parallel across PR branches without concurrency locks.
2. **Deploy Job** (`pages: write`, `id-token: write`):
   - Acquires `deploy-pages` concurrency lock.
   - Publishes preview builds to `/pull/<number>/` and uploads debug APK to `/pull/<number>/capy.apk`.
   - On `main` merges, publishes directly to the production root (`https://shthed.github.io/capy/`).
