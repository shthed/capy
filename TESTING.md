# Testing Architecture & Verification Guide: Capy Monorepo

This document outlines the testing strategy, tooling rationale, end-to-end gesture verification, and platform test suites for the Capy monorepo across **Web** (`web/`) and **Android** (`app/`).

---

## 1. Tooling Evaluation: Why Playwright is the Optimal Tool for Capy

Testing an interactive HTML5 2D Canvas color-by-number game with Web Workers and mobile touch gestures presents unique requirements that traditional DOM testing libraries (e.g., Jest + JSDOM or Cypress) cannot fulfill alone.

### Comparison Matrix

| Capability | Playwright | Puppeteer | Cypress | Jest / Testing Library |
| :--- | :--- | :--- | :--- | :--- |
| **Multi-Touch & Pointer Gestures** | **Native** (`hasTouch`, `touchIdentifier`, pointer stream) | Raw CDP touch events only | Limited / plugin-dependent | No real touch/canvas simulation |
| **Canvas Pixel & Hit-Test Inspection** | **Full** (evaluate canvas contexts, `getImageData`, pixel sampling) | Full (evaluate in page) | Partial (iframe constraints) | Mocked / stubbed canvas only |
| **Web Worker Lifecycle & Cancellation** | **Automatic** tracking and message interception | Manual worker target attachment | Poor worker isolation in iframe | No worker thread execution |
| **Mobile Viewport & Safe-Area Emulation** | **Native** (DPR, safe-area insets, mobile touch events) | Viewport resize only | Emulated viewports only | Headless DOM only |
| **Execution Speed & Reliability** | **High** (direct CDP multiplexing, isolated contexts) | High | Medium (in-browser iframe overhead) | Very High (but no browser rendering) |

### Key Reasons Playwright Excels for Capy:
1. **Precise Multi-Touch & Pointer Gesture Engine**:
   - Capy relies heavily on custom touch gestures: multi-touch pinch-to-zoom, single-finger inertial pan flicking, and Google Maps-style one-finger double-tap-and-drag zoom.
   - Playwright's pointer dispatch engine allows sending precise microsecond-timed `pointerdown`, `pointermove`, and `pointerup` sequences with velocity tracking, accurately testing inertial gliding and cancel-on-touch logic.
2. **Worker-Driven Pipeline Testing**:
   - Image segmentation, line extraction, and color clustering execute inside a Web Worker (`puzzle.worker.ts`).
   - Playwright runs true browser threads, allowing tests to wait for asynchronous worker progress messages (`GENERATE` $\rightarrow$ `PROGRESS` $\rightarrow$ `SUCCESS`) without artificial mocking.
3. **Comprehensive Headless Browser Automation**:
   - Playwright executes tests against real Chromium, Firefox, and WebKit rendering engines, ensuring canvas operations, IndexedDB persistence, and gesture handlers behave identically across all major browser targets.

---

## 2. Test Suites Across Targets

| Target | Test Scope | Verification Steps |
| :--- | :--- | :--- |
| **Web Application (`web/`)** | TypeScript type check, production build, binary codec parity, Playwright E2E suites | `npm run lint`, `npm run build`, `npm run test:codec`, `npm run test:undo`, `npm run test:gameplay` |
| **Native Android Launcher (`app/`)** | JUnit4 native bridge unit tests, web asset bundle sync, debug APK assembly | `./gradlew app:testDebugUnitTest`, `./gradlew app:assembleDebug` |

### A. Web Application (`web/`)

| Test Level | Command | Scope |
| :--- | :--- | :--- |
| **Type Checking** | `npm run lint` | Runs `tsc --noEmit` in strict mode to ensure zero type errors across all React components, services, and worker modules. |
| **Production Build** | `npm run build` | Compiles TypeScript and produces minified, optimized production bundles via Vite (`tsc && vite build`). Verifies chunk splitting and asset paths. |
| **Compact Codec Suite** | `npm run test:codec` | Verifies `CapyCodec` scanline RLE + LEB128 varints, zero-loss `PuzzleData` geometry reconstruction, `.capy` v2 Gzip binary framing, and CRDT progress delta merges. |
| **Dev Server Verification** | `npm run dev` | Spins up Vite dev server on `http://localhost:3000` with hot module replacement (HMR). |
| **Preview Server Verification**| `npm run preview`| Serves the compiled `web/dist/` bundle on `http://localhost:3000` for realistic end-to-end verification. |
| **Undo & Timeline Suite** | `npm run test:undo` | Tests long-press undo timeline scrubber, resume play from step, redo stack, and save portability. |
| **Gameplay Smoke Suite** | `npm run test:gameplay` | Tests core tap region coloring, canvas rendering, and progress tracking. |
| **Browser E2E Suite** | `npm run test:game` | Comprehensive Playwright browser suite verifying zoom, pan, settings, and modal flows. |
| **PWA & Offline Suite** | `npm run test:pwa` | Validates web app manifest, Service Worker registration, Cache Storage population, network disconnect emulation, and 100% offline gameplay. |
| **Sample Archive Generation** | `npm run generate:samples` | Generates all 4 built-in `SAMPLE_GALLERY` puzzles via headless Chromium and exports `web/public/assets/sample_saves.capy` for instant first-launch loading. |

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

## 3. Automated Gesture & Canvas Feature Testing Guide

When writing or executing Playwright tests for `PuzzleCanvas.tsx`, adhere to these patterns:

### 1. Testing Google Maps-Style One-Finger Double-Tap-and-Drag Zoom
- **Gesture Sequence**:
  1. Dispatch `pointerdown` at $(x, y)$.
  2. Wait 40ms, dispatch `pointerup` (first tap recorded).
  3. Within 200ms (below `DOUBLE_TAP_TIMEOUT = 350ms`), dispatch second `pointerdown` at $(x, y)$.
  4. Dispatch `pointermove` to $(x, y + 100)$ (dragging **down** when `reverseDoubleTapZoom` is `false`).
  5. Verify canvas scale increases: $\text{scale}_{new} > \text{scale}_{initial}$.
  6. Dispatch `pointermove` to $(x, y - 100)$ (dragging **up** when `reverseDoubleTapZoom` is `false`).
  7. Verify canvas scale decreases: $\text{scale}_{new} < \text{scale}_{initial}$.
  8. Dispatch `pointerup`.

### 2. Testing Smooth Pan Momentum (Inertial Gliding)
- **Gesture Sequence**:
  1. Dispatch `pointerdown` at $(x_0, y_0)$ at timestamp $t_0$.
  2. Dispatch rapid series of `pointermove` events over 80ms to $(x_1, y_1)$ such that flick velocity exceeds $0.18\text{ px/ms}$.
  3. Dispatch `pointerup`.
  4. Sample canvas offset 100ms and 200ms post-release: verify that the pan position continued to glide along the velocity vector.
  5. Test zero-latency cancellation: dispatch an immediate `pointerdown` mid-glide and verify that gliding ceases instantaneously without overshoot.

### 3. Testing Corner Panning Bounds (`clampCanvasOffset`)
- **Verification**:
  1. Set zoom scale to $2.5\times$.
  2. Pan towards the top-left corner $(0, 0)$.
  3. Verify that the artwork corner can be panned past the viewport center:
     $$\text{panOffset.x} \le \frac{\text{containerWidth}}{2}$$
  4. Repeat for all 4 corners (top-left, top-right, bottom-left, bottom-right).

### 4. Testing Settings Tab Memory & Persistence
- **Verification**:
  1. Open Settings modal.
  2. Click the **Appearance** tab.
  3. Close Settings modal.
  4. Re-open Settings modal via the top bar gear icon.
  5. Assert that the active tab is **Appearance** (persisted in `localStorage.getItem('capy_last_settings_tab')`).

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
