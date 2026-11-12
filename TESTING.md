# Testing Architecture & Verification Guide -- Capy Monorepo (`TESTING.md`)

This document outlines the testing strategy, tooling rationale, unified end-to-end verification suite, and platform test commands across **Web** ([`web/`](./web/)), **Cloudflare Worker** ([`worker/`](./worker/)), and **Android** ([`app/`](./app/)).

**Related Guides**: [`README.md`](./README.md) | [`ROADMAP.md`](./ROADMAP.md) | [`DEV.md`](./DEV.md) | [`AGENTS.md`](./AGENTS.md) | [`TODO.md`](./TODO.md) | [`WEB.md`](./WEB.md) | [`PUZZLE.md`](./PUZZLE.md) | [`APP.md`](./APP.md) | [`CLOUD.md`](./CLOUD.md) | [`CHANGELOG.md`](./CHANGELOG.md)

**Table of Contents**:
1. [Tooling Evaluation: Why Playwright + Vite SSR Is Optimal](#1-tooling-evaluation-why-playwright--vite-ssr-is-optimal)
2. [Test Suites & Commands Across Targets](#2-test-suites--commands-across-targets)
3. [Automated Gesture & Canvas Feature Testing Patterns](#3-automated-gesture--canvas-feature-testing-patterns)
4. [Continuous Integration Pipeline (`deploy-branch.yml`, `release.yml` & `deploy-cloudflare.yml`)](#4-continuous-integration-pipeline-deploy-branchyml-releaseyml--deploy-cloudflareyml)

---

## 1. Tooling Evaluation: Why Playwright + Vite SSR Is Optimal

Testing an interactive HTML5 2D Canvas color-by-number game with Web Workers, binary RLE codecs, and mobile touch gestures presents requirements that DOM-only runners (`Jest + JSDOM`) or iframe-bound runners (`Cypress`) cannot cover cleanly:

### Cross-Tooling Capability Summary
- **Playwright + Vite SSR (Selected for Capy)**:
  - *Multi-Touch & Pointer Gestures*: Native `hasTouch`, `pointerId`, and microsecond-timed `pointerdown` / `pointermove` / `pointerup` streams for pinch-to-zoom, one-finger double-tap drag zoom, and inertial pan gliding.
  - *2D Canvas & Hit-Testing*: Direct browser context evaluation (`getImageData`, pixel sampling, `ResizeObserver` viewport checks).
  - *Web Worker & Service Worker Lifecycle*: Real `puzzle.worker.ts` thread execution/cancellation and offline version+scope-isolated (`capy-cache-v<version>:<scopePath>`) Service Worker reload verification.
  - *Engine & Codec Unit Speed*: Loads TypeScript modules directly in Node via `vite.ssrLoadModule(...)` before launching headless Chromium in the same process.
- **Puppeteer**: Supports raw CDP touch dispatch and canvas evaluation, but lacks built-in mobile viewport/safe-area ergonomics and Playwright's auto-waiting locators.
- **Cypress**: Runs inside an in-browser iframe with limited multi-touch fidelity and weaker Web Worker / Service Worker isolation.
- **Jest / Testing Library (`JSDOM`)**: Fast for pure JS functions, but has no real HTML5 2D Canvas rasterizer, `ResizeObserver`, `BroadcastChannel`, or Web Worker execution.

### Key Architectural Advantages
1. **Single Unified Runner ([`web/scripts/test.mjs`](./web/scripts/test.mjs)) + Sub-2s Sanity Gate ([`web/scripts/sanity.mjs`](./web/scripts/sanity.mjs))**:
   - `npm run test:sanity` verifies SemVer/`versionCode` parity, `CHANGELOG.md` channel-marker invariants, and `.md` formatting/links across the entire repo in `< 2s` with zero browser startup.
   - `npm test` consolidates all Vite SSR engine/codec/worker unit checks and headless Chromium E2E stages into one deterministic script, binding an ephemeral preview port automatically when `CAPY_TEST_URL` is unset so concurrent runs never collide on `:3000`.
2. **Deterministic Pre-Baked + Live Worker Coverage**:
   - Verifies both instant zero-worker startup via `./assets/sample_saves.capy` and live `puzzle.worker.ts` custom photo segmentation, IndexedDB (`capy_game_storage_v8`) persistence, and 100% offline PWA reload.

---

## 2. Test Suites & Commands Across Targets

### A. Web & Cloudflare Worker (`web/`, `worker/`)

Run from `web/`:

- **`npm run test:sanity` (`node scripts/sanity.mjs`)**: Sub-2-second pure-Node repository gate checking `web/package.json` / `version.ts` / `app/build.gradle.kts` version formula parity, `CHANGELOG.md` channel markers and PR bullets, and `.md` hygiene (zero emojis, zero box-drawing art, zero `>= 3`-column tables, and valid relative links).
- **`npm run lint` (`tsc --noEmit && tsc --noEmit -p ../worker/tsconfig.json`)**: Strict TypeScript type-checking across all React 19 components, services, providers, Web Worker modules, and Cloudflare Worker / Durable Object modules.
- **`npm run build` (`tsc && vite build`)**: Compiles TypeScript, produces code-split production bundles in `web/dist/`, stamps `dist/sw.js` with `APP_VERSION` and emitted asset chunks, and injects `CAPY_ANDROID_SHA256_CERT_FINGERPRINTS` into `dist/.well-known/assetlinks.json`.
- **`npm test` (`node scripts/test.mjs`)**: Runs the **Unified Engine, Codec & Browser E2E Suite**:
  1. **Part 1 -- Engine, Binary Codec, Security, Relay & Version/Changelog Unit Checks (Vite SSR)**:
     - `ColorQuantizer` unsigned ARGB bit-packing and deterministic K-Means++ initialization (`0xca91ba7a`).
     - `RegionSegmenter` `cellPartitionMap` mosaic separation.
     - `LineArtPuzzleGenerator` B&W coloring book explicit source accent fill preservation (`BF-4`).
     - `GoogleCloudDriver` per-file concurrent write serialization (`writeLocks` / `enqueueWrite`) and Google Drive file-ID caching (`BF-3`).
     - Bit-exact `CapyCodec` scanline RLE + LEB128 varints, `.capy` v2 Gzip single/archive framing (including `SavedSnapshot.parentSnapshotId` and monotonic `resetEpoch` preservation), `< 2 KB` `ProgressDeltaV2` CRDT epoch-scoped Set-Union + LWW merges (`mergeProgressDeltas`), `PlayGamesAndroidDriver` `> 180 KB` multi-chunk `pgblob:*` binary split/reassembly + stale-chunk pruning + corrupt-chunk rejection, and `M-01` DoS hardening (malformed/EOF/overflow varint rejection, `256 KB` delta / `16 MB` save streaming gzip-bomb caps, framed header bounds, and `decompressPuzzleRecord` region ceilings).
     - `SoundService` SSR no-op safety, volume clamping, `25ms` drag rate-throttling, and `visibilitychange` / `blur` auto-suspend, alongside `PuzzleCanvas` magnetic zoom detent (`applyZoomSnapDetent`) and stop-stepping (`getNextZoomStop`) math.
     - `DailyPuzzleService` (`getDailyFeaturedPuzzle`) deterministic UTC date seeding across repeated calls and artwork/preset variation across consecutive dates, `PlayerStatsService` (`capy_player_stats_v1`) SSR load/increment/persistence, negative clamping, and monotonic `mergeLifetimeStats` merging, plus `SvgPrintExporter` (`buildPrintableColoringSvg`) vector `<path>` region boundary tracing, centroid `<text>` labels, swatch legend items, and XML special-character escaping (`&`, `<`, `>` , `"`).
     - `ShareLinkService` (including `resetEpoch` round-trips), `CrdtCloudSaveAdapter` `resetEpoch` anti-resurrection, `HybridCoopRoomAdapter` (`resolveCoopRoomWsUrl`, jittered backoff, transport-aware `'ws'` vs `'channel'` peer pruning, `PONG` handling), `worker/coopRoomProtocol.ts` (`Origin` allowlist + `ALLOWED_EXTRA_ORIGINS`, `6 KB` frame / `4096`-char Base64URL+header `seedToken` / `paintEvent` / `unfillEvent` schema checks, `40 frames / 5s` rate limit, write-once `HELLO` `seed_token` + `5s` debounced `WELCOME_STATE`), `PwaService.resolvePwaCacheName`, `parseAndroidSha256Fingerprints`, and `version.ts` (`APP_VERSION`, `APP_VERSION_CODE`, `resolveReleaseChannel` including `capypaint.com` `showChannelSwitcher: false`) + `CHANGELOG.md` contract.
  2. **Part 2.1 -- Instant Boot, App Links, DoS Resilience & PWA Shell**:
     - Verifies `/manifest.webmanifest`, `/.well-known/assetlinks.json` (zero `00:00:...` placeholder fingerprints), `/privacy-policy.html`, `capy-cache-v<version>:/` Service Worker registration, instant 4-sample `sample_saves.capy` bootstrap with zero worker spawn, malformed `#s=` DoS URL recovery, and Web `Google Login` auto-hide when `VITE_GOOGLE_CLIENT_ID` is empty.
  3. **Part 2.2 -- Canvas Gameplay & Gestures**:
     - Verifies `PaletteDock` swatch selection, region tap coloring, Google Maps-style one-finger double-tap-and-drag zoom, inertial pan momentum flick + zero-latency touch cancellation, and continuous Paint Mode.
  4. **Part 2.3 -- Undo, Redo & YouTube-Style Replay Controls**:
     - Verifies `Enable Undo Action` toggle, single-step Undo/Redo, Redo stacking above Undo, `Ctrl+Z` / `Ctrl+Y`, long-press Undo (`>= 450ms`) opening default-minimised [`ReplayControls.tsx`](./web/src/components/ReplayControls.tsx) (`data-minimized="true"`), zero-latency pointer-drag timeline scrubbing (`replay-scrubber-track`), expanding to the two-row deck (`replay-toggle-minimize-btn`), `Resume Here` state rewind, save-load zoom restoration, strict viewport invariance on `replay-btn`, offscreen step fast-forwarding, Follow Painting safe-frame camera tracking (`replay-follow-btn`), Auto-Loop (`replay-loop-btn`), and live pan/zoom during playback.
  5. **Part 2.4 -- Settings, Gallery & Community Ideas**:
     - Verifies `app-version-badge`, preset background reset (`Charcoal`), Settings tab persistence (`capy_last_settings_tab`), Gallery search & category filtering, and moderated Community Puzzle Ideas.
  6. **Part 2.5 -- Share Links, Simultaneous Co-op, Saves, Resilience, Controls, Daily Puzzle, A11y, Stats & Printable SVG (`BF-1`, `BF-2`, `BF-6`)**:
     - Verifies `< 2 KB` `#s=<token>` share URL restoration in an isolated browser context, 2-peer `BroadcastChannel` Co-op stroke sync, Free Colour repaint first-fill chronology preservation and Co-op undo/redo repaint broadcast (`BF-1`), 2-peer `BroadcastChannel` Co-op first-time-fill Undo synchronization via `'UNFILL_EVENT'` (`undo-btn`), Saves Detail/Thumbnails view switching, custom photo upload into IndexedDB `capy_game_storage_v8` (`images` & `puzzles` stores), `.capy` v2 binary export, printable monochrome vector `.svg` coloring sheet download (`export-printable-svg-btn`), Infinite Zoom detail sub-tile `parentSnapshotId` persistence, one-tap `topbar-parent-puzzle-btn` parent navigation + saved viewport zoom restoration + parent-deletion breadcrumb cleanup, 100% offline PWA reload, `ResizeObserver` canvas resize clamping (`BF-2`), `customPalette` eviction recovery (`BF-6`, evicting `snapId` from the `'puzzles'` object store in `'capy_game_storage_v8'` and asserting `evicted === true` before cold-start reload), Controls settings persistence (`zoomSensitivity`, `snapZoomLevels`, `soundEnabled`, `soundVolume`, `reducedMotion` in `capy_user_settings_v8`), top HUD zoom-badge cycling (`topbar-zoom-badge`: `1x -> 2x -> 4x -> 8x -> 12x -> 1x`), **Puzzle of the Day** Create-tab hero card (`daily-puzzle-card`) and one-tap launch (`daily-puzzle-play-btn`), desktop keyboard gameplay shortcuts (`1`--`9` swatch select, `+` zoom, `ArrowRight`/`ArrowLeft` pan, `0` reset, plus `<input>` focus guard on `gallery-search-input`), and **Lifetime Stats** (`capy_player_stats_v1` & `lifetime-stats-card`).
  7. **Part 2.6 -- Release Channel Switcher & Non-Production HUD Pill**:
     - Verifies zero `topbar-channel-badge` clutter on default `/` views, `release-channel-card` (`toggle-beta-channel-btn` -> `/capy/beta/`, `beta-apk-download-link` -> `/capy/beta/capy.apk`), and `BETA` pill click-to-open Settings on `?capy_channel=beta`.
  8. **Part 2.7 -- Co-op `WELCOME_STATE` Reload Persistence, Replay Rewind `UNFILL`, CRDT `resetEpoch`, Mobile Replay Bounds & Save-Load Auto-Resume**:
     - Verifies 2-peer `BroadcastChannel` `WELCOME_STATE` immediate `capy_active_session_v8` persistence across peer reload (`BUG-1`), Replay Scrubber `Resume Here` `UNFILL_EVENT` synchronization across peers, `Reset Progress` (`reset-progress-btn`) `UNFILL_EVENT` broadcast + monotonic `resetEpoch` increment (`M-08`, `F-01`), `360x800` mobile minimized `ReplayControls` pill fit (`replay-exit-btn` strictly inside `replay-controls-window`), and save-load `replayLoop` auto-disable (`aria-pressed="false"`) with automatic post-replay gameplay resume.
- **`npm run gallery:capture` (`node scripts/capture-gallery.mjs`)**: Captures deterministic high-DPI showcase screenshots into `docs/gallery/`.
- **`npm run generate:samples` (`node scripts/generate-sample-saves.mjs`)**: Generates all 4 built-in `SAMPLE_GALLERY` puzzles via headless Chromium and writes `web/public/assets/sample_saves.capy`.

### B. Native Android Application (`app/`)

Run from the repository root:

```bash
# 1. Run JUnit4 unit tests (CapyAndroidBridgeTest.kt: haptics, deep-link validation, ACTION_SEND downsampling, > 180 KB chunked cloud binary round-trip & corrupt-chunk resilience, disk backups)
./gradlew app:testDebugUnitTest

# 2. Compile Web bundle and assemble Android debug APK
./gradlew app:buildWeb
./gradlew app:assembleDebug
```

> [!IMPORTANT]
> Never run `./gradlew app:installDebug` unless explicitly requested by the user.

---

## 3. Automated Gesture & Canvas Feature Testing Patterns

When extending [`web/scripts/test.mjs`](./web/scripts/test.mjs) for [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx), follow these deterministic patterns:

### 1. Google Maps-Style One-Finger Double-Tap-and-Drag Zoom
1. Dispatch `pointerdown` at $(x, y)$, wait 30ms, and dispatch `pointerup` (first tap).
2. Within 200ms (below `DOUBLE_TAP_TIMEOUT = 350ms`), dispatch second `pointerdown` at $(x, y)$.
3. Dispatch `pointermove` downward $(x, y + \Delta y)$ to zoom **in** (or upward to zoom **out** when `reverseDoubleTapZoom` is `false`), then `pointerup`.

### 2. Smooth Pan Momentum (Inertial Gliding) & Touch Cancellation
1. Dispatch `pointerdown` at $(x_0, y_0)$.
2. Dispatch rapid `pointermove` steps over ~80ms so flick velocity exceeds $0.18\text{ px/ms}$, then `pointerup`.
3. Dispatch an immediate `pointerdown` mid-glide to verify zero-latency momentum cancellation.

### 3. Corner Panning Bounds (`clampCanvasOffset`)
1. Zoom to $2.5\times$ and pan toward the top-left corner $(0, 0)$.
2. Assert the artwork corner can pan comfortably past the viewport center:
   $$\text{panOffset.x} \le \frac{\text{containerWidth}}{2}$$

---

## 4. Continuous Integration Pipeline ([`deploy-branch.yml`](./.github/workflows/deploy-branch.yml), [`release.yml`](./.github/workflows/release.yml) & [`deploy-cloudflare.yml`](./.github/workflows/deploy-cloudflare.yml))

Capy uses a 3-tier `Alpha -> Beta -> Production` GitHub Actions architecture paired with Cloudflare Workers edge deployment:

1. **Build & Test Job (`deploy-branch.yml`, `contents: read`)**:
   - Runs a `< 2s` docs-only fast-path check on pure `.md`/metadata PRs so required branch ruleset checks pass immediately without consuming build runner minutes.
   - Executes `npm ci`, `npm run test:sanity` (`< 2s`), `npm run lint`, and `npm run build` in `web/`, runs Android JUnit4 unit tests (`./gradlew app:testDebugUnitTest`), and assembles the Android debug APK (`./gradlew app:assembleDebug`).
   - Runs in parallel across PR branches (`feature/* -> beta` and `beta -> main`) without global concurrency locks.
2. **Playwright E2E Release Gate Job (`deploy-branch.yml`, `contents: read`, conditional on non-draft `pull_request` targeting `main`)**:
   - Triggered automatically whenever a ready-for-review **Release Promotion PR (`beta -> main`)** opens or updates (`draft == false`).
   - Installs Playwright Chromium (`npx playwright install --with-deps chromium`) and executes the complete `npm test` SSR + headless Chromium E2E suite before `deploy` can proceed.
3. **Deploy to GitHub Pages Job (`deploy-branch.yml`, `contents: write`, `pages: write`, `id-token: write`, `pull-requests: write`)**:
   - Guarded by `github.event.repository.has_pages == true` and serialized under the `deploy-pages` concurrency lock (`cancel-in-progress: false`).
   - Publishes open Alpha PR previews to `/pull/<number>/` and `/pull/<number>/capy.apk`.
   - Publishes `beta` merges to `/beta/` (`https://shthed.github.io/capy/beta/`) and `/beta/capy.apk` without touching production `/`.
   - Publishes `main` promotions to `/` (`https://shthed.github.io/capy/`, preserving `/pull/` and `/beta/`) as a single squashed orphan commit on `gh-pages`.
4. **Release & Play Store Bundle Workflow ([`release.yml`](./.github/workflows/release.yml))**:
   - Triggered on `v*.*.*` Git tags (or `workflow_dispatch`), compiling `capy-<tag>.apk` (plus unversioned `capy.apk` on stable releases), Google Play Store `capy-<tag>.aab` (`bundleRelease`), and `capy-web-<tag>.tgz` with extracted `CHANGELOG.md` notes.
5. **Deploy Cloudflare Worker Job ([`deploy-cloudflare.yml`](./.github/workflows/deploy-cloudflare.yml), `contents: read`)**:
   - Runs `npm run test:sanity`, `npm run lint`, and `npm run build`, deploys `web/dist` Static Assets and `worker/index.ts` (`CoopRoomDurableObject`) to `https://capypaint.com/` via `cloudflare/wrangler-action@v4` when `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are set (skipping cleanly in `< 2s` when unconfigured), and verifies `https://capypaint.com/api/health`.
<!-- capy-dev-only:start -->
6. **Dual AI & Owner PR Review Gate ([`pr-review-gate.yml`](./.github/workflows/pr-review-gate.yml))**:
   - Enforces Draft-first development, machine-verified `review:ai-approved` (`>= 95%` 5-Pillar score for exact `HEAD` SHA), and separate post-push Human Project Owner sign-off (`review:owner-approved` or `APPROVED`/`LGTM`) via the `capy/review-gate` commit status before `gh pr merge` can unlock.
<!-- capy-dev-only:end -->

> [!NOTE]
> **Fast Daily CI + Full E2E Production Gate**: `npm run test:sanity && npm run lint && npm run build && npm test` is always run locally inside the Antigravity VM before pushing any PR. Draft and daily `feature/* -> beta` PRs skip heavy Playwright browser downloads in GitHub Actions so `/pull/<number>/` Alpha previews deploy rapidly, while ready-for-review `main` PRs enforce the full Playwright Chromium E2E suite in GitHub Actions as a second safety net.
