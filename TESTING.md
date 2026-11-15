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
   - `npm run test:sanity` verifies SemVer/`versionCode` parity, `CHANGELOG.md` SemVer/date ordering, clickable PR links, channel-marker invariants, root `.md` guide indexing, and `.md` formatting/links across the entire repo in `< 2s` with zero browser startup.
   - `npm test` consolidates all Vite SSR engine/codec/worker unit checks and headless Chromium E2E stages into one deterministic script, binding an ephemeral preview port automatically when `CAPY_TEST_URL` is unset so concurrent runs never collide on `:3000`.
2. **Deterministic Pre-Baked + Live Worker Coverage**:
   - Verifies both instant zero-worker startup via `./assets/sample_saves.capy` and live `puzzle.worker.ts` custom photo segmentation, IndexedDB (`capy_game_storage_v8`) persistence, and 100% offline PWA reload.

---

## 2. Test Suites & Commands Across Targets

### A. Web & Cloudflare Worker (`web/`, `worker/`)

Run from `web/`:

- **`npm run test:sanity` (`node scripts/sanity.mjs`)**: Sub-2-second pure-Node repository gate checking `web/package.json` / `version.ts` / `app/build.gradle.kts` version formula parity, `CHANGELOG.md` SemVer/date descending order, channel markers, and PR bullet links (clean-room compatible), `README.md` / `DEV.md` / `PROJECT.md` root guide indexing, and `.md` hygiene (zero emojis, zero box-drawing art, zero `>= 3`-column tables, and valid relative links).
- **`npm run lint` (`tsc --noEmit && tsc --noEmit -p ../worker/tsconfig.json`)**: Strict TypeScript type-checking across all React 19 components, services, providers, Web Worker modules, and Cloudflare Worker / Durable Object modules.
- **`npm run build` (`tsc && vite build`)**: Compiles TypeScript, produces code-split production bundles in `web/dist/`, stamps `dist/sw.js` with `APP_VERSION` and emitted asset chunks, and injects `CAPY_ANDROID_SHA256_CERT_FINGERPRINTS` into `dist/.well-known/assetlinks.json`.
- **`npm run test:unit` (`node scripts/test.mjs --unit`)**: Fast (`< 10s`) headless Part 1 Vite SSR engine, codec, security, relay, changelog/sanity, and GitHub Actions workflow unit suite with zero Chromium launch (executed inside the blocking CI `Build & Test` gate).
- **`npm test` (`node scripts/test.mjs`)**: Runs the **Unified Engine, Codec & Browser E2E Suite**:
  1. **Part 1 -- Engine, Binary Codec, Security, Relay & Version/Changelog Unit Checks (Vite SSR)**:
     - `ColorQuantizer` unsigned ARGB bit-packing and deterministic K-Means++ initialization (`0xca91ba7a`).
     - `RegionSegmenter` `cellPartitionMap` mosaic separation.
     - `LineArtPuzzleGenerator` B&W coloring book explicit source accent fill preservation (`BF-4`).
     - `GoogleCloudDriver` per-file concurrent write serialization (`writeLocks` / `enqueueWrite`) and Google Drive file-ID caching (`BF-3`).
     - Bit-exact `CapyCodec` scanline RLE + LEB128 varints, `.capy` v2 Gzip single/archive framing (including `SavedSnapshot.parentSnapshotId` and monotonic `resetEpoch` preservation), `< 2 KB` `ProgressDeltaV2` CRDT epoch-scoped Set-Union + LWW merges (`mergeProgressDeltas`), `PlayGamesAndroidDriver` `> 180 KB` multi-chunk `pgblob:*` binary split/reassembly + stale-chunk pruning + corrupt-chunk rejection, and `M-01` DoS hardening (malformed/EOF/overflow varint rejection, `256 KB` delta / `16 MB` save streaming gzip-bomb caps, framed header bounds, and `decompressPuzzleRecord` region ceilings).
     - `SoundService` SSR no-op safety, volume clamping, `25ms` drag rate-throttling, and `visibilitychange` / `blur` auto-suspend, alongside `PuzzleCanvas` magnetic zoom detent (`applyZoomSnapDetent`) and stop-stepping (`getNextZoomStop`) math.
     - `DailyPuzzleService` (`getDailyFeaturedPuzzle`) deterministic UTC date seeding across repeated calls and artwork/preset variation across consecutive dates, `PlayerStatsService` (`capy_player_stats_v1`) SSR load/increment/persistence, negative clamping, and monotonic `mergeLifetimeStats` merging, plus `SvgPrintExporter` (`buildPrintableColoringSvg`) vector `<path>` region boundary tracing, centroid `<text>` labels, swatch legend items, and XML special-character escaping (`&`, `<`, `>` , `"`).
      - `ShareLinkService` (including `resetEpoch` round-trips and corrupt `#s=` token preservation of `?room=`), `CrdtCloudSaveAdapter` `resetEpoch` anti-resurrection, `HybridCoopRoomAdapter` (`resolveCoopRoomWsUrl`, `resolveCoopBroadcastChannelName` channel isolation, jittered backoff, transport-aware `'ws'` vs `'channel'` peer pruning, `PONG` handling), `PlayGamesAndroidDriver` fast-fail unconfigured/unavailable sign-in fallback, `worker/coopRoomProtocol.ts` (`Origin` allowlist + `ALLOWED_EXTRA_ORIGINS`, `6 KB` frame / `4096`-char Base64URL+header `seedToken` / `paintEvent` / `unfillEvent` schema checks, `40 frames / 5s` rate limit, write-once `HELLO` `seed_token` + `5s` debounced `WELCOME_STATE`), `TargetSpotlightOverlay` (`TUTORIAL_STEP_TARGETS`, `FEATURE_OFFER_TARGETS`, `clampRectToBounds`, `preventRingOverlap`, `computeSpotlightConnector`), `PwaService.resolvePwaCacheName`, `parseAndroidSha256Fingerprints`, `computeProgressPercentage` (`99%` incomplete cap and clamping), `version.ts` (`APP_VERSION`, `APP_VERSION_CODE`, `resolveReleaseChannel` including `capypaint.com` `showChannelSwitcher: false`) + `CHANGELOG.md` contract + unclosed HTML comment checklist sanitization, `.github/scripts/compile-changelog.mjs`, and GitHub Pages `404.html` redirect guard + `.github/scripts/pr-index.html` + `generate-pr-manifest.mjs` (`/capy/alpha/` manifest, `--refresh-404`, and `cleanup-gh-pages-previews` preservation).
  2. **Part 2.1 -- Instant Boot, App Links, DoS Resilience, Onboarding Tutorial, Spotlight Overlay & PWA Shell**:
     - Verifies `/manifest.webmanifest`, `/.well-known/assetlinks.json` (zero `00:00:...` placeholder fingerprints), `/privacy-policy.html`, `capy-cache-v<version>:/` Service Worker registration, instant 4-sample `sample_saves.capy` bootstrap (`sample-capy-forest` default) with zero worker spawn and `undoStack` parity, interactive 14-step `OnboardingTutorial` per-visit auto-advance across all steps + Step 1 active-swatch tap + `[All Topics]` jump drawer + compact `Large Text` toggle on Steps 2--14 + Step 6->7 tutorial-opened `ReplayControls` auto-dismiss (`Next`, `Jump`, `Skip`) while preserving pre-existing manual replays + Step 7->8 tutorial-triggered `isPreviewMode` auto-exit + rapid `Ctrl+Z` burst (`undoStackRef`) + `?skipTutorial=1` suppression + modal-guarded `Escape` dismiss, `TargetSpotlightOverlay` scroll-clipped alignment/viewport-bounds/`pointer-events: none`/`reducedMotion` assertions across tutorial steps (including dual Step 7 `Eye` + `Full Screen` rings) and all 9 `FeatureOfferBanner` / `FeatureOffersService` quick tips (`Jump to Guide`, `Got it`, FIFO suppression queue, `NativeBridge.saveBackup` & scoped storage persistence), `360x780` normal & `Large Text` `0px` horizontal overflow guards (including `ALPHA #520` non-clipping fit), malformed `#s=` DoS URL recovery, and Web `Google Login` auto-hide when `VITE_GOOGLE_CLIENT_ID` is empty.
  3. **Part 2.2 -- Canvas Gameplay & Gestures**:
     - Verifies `PaletteDock` swatch selection, region tap coloring, Google Maps-style one-finger double-tap-and-drag zoom, inertial pan momentum flick + zero-latency touch cancellation, and continuous Paint Mode.
  4. **Part 2.3 -- Undo, Redo & YouTube-Style Replay Controls**:
     - Verifies `Enable Undo Action` toggle, single-step Undo/Redo, Redo stacking above Undo, `Ctrl+Z` / `Ctrl+Y`, long-press Undo (`>= 450ms`) opening default-minimised [`ReplayControls.tsx`](./web/src/components/ReplayControls.tsx) (`data-minimized="true"`), zero-latency pointer-drag timeline scrubbing (`replay-scrubber-track`), expanding to the two-row deck (`replay-toggle-minimize-btn`), `Next` opening the `Create` tab (`3`), `Resume Here` state rewind, save-load zoom restoration, persistent post-load `ReplayControls` co-visible above `PaletteDock` without self-dismissing on mount and dismissed immediately on first `Ctrl+Z` (+ immediate undo) or any palette swatch click (both already-selected active swatch and unselected swatches, with zero `PaletteDock` vertical jump), strict viewport invariance on `replay-btn`, offscreen step fast-forwarding, Follow Painting safe-frame camera tracking (`replay-follow-btn`), Auto-Loop (`replay-loop-btn`), and live pan/zoom during playback.
  5. **Part 2.4 -- 5-Tab SettingsModal, Gallery & Community Ideas**:
     - Verifies all 5 `SettingsModal` tabs (`About`=`0` with `app-version-badge`, `about-replay-tutorial-btn`, `lifetime-stats-card`, `release-channel-card`; `Settings`=`1` with zero duplicate testids; `Hints`=`2`; `Create`=`3`; `Saves`=`4` persisting across reload via `capy_last_settings_tab`), preset background reset (`Charcoal`), Gallery search & category filtering, and moderated Community Puzzle Ideas.
  6. **Part 2.5 -- Share Links, Simultaneous Co-op, Saves, Resilience, Controls, Daily Puzzle, A11y, Stats & Printable SVG (`BF-1`, `BF-2`, `BF-6`)**:
     - Verifies `< 2 KB` `#s=<token>` share URL restoration in an isolated browser context, 2-peer `BroadcastChannel` Co-op stroke sync, Free Colour repaint first-fill chronology preservation and Co-op undo/redo repaint broadcast (`BF-1`), 2-peer `BroadcastChannel` Co-op first-time-fill Undo synchronization via `'UNFILL_EVENT'` (`undo-btn`), Saves `'THUMBNAILS'` cold-start default, invalid `localStorage` fallback to `'THUMBNAILS'`, `'DETAIL'` view persistence, desktop vertical DOM order (`saves-list-section` -> `selected-save-action-bar` -> `cloud-coop-hub`), custom photo upload into IndexedDB `capy_game_storage_v8` (`images` & `puzzles` stores), `.capy` v2 binary export, printable monochrome vector `.svg` coloring sheet download (`export-printable-svg-btn`), Infinite Zoom detail sub-tile `parentSnapshotId` persistence, one-tap `topbar-parent-puzzle-btn` parent navigation + saved viewport zoom restoration + parent-deletion breadcrumb cleanup, 100% offline PWA reload, `ResizeObserver` canvas resize clamping (`BF-2`), `customPalette` eviction recovery (`BF-6`, evicting `snapId` from the `'puzzles'` object store in `'capy_game_storage_v8'` and asserting `evicted === true` before cold-start reload), Controls settings persistence (`zoomSensitivity`, `snapZoomLevels`, `soundEnabled`, `soundVolume`, `reducedMotion` in `capy_user_settings_v8`), **Puzzle of the Day** Create-tab hero card (`daily-puzzle-card`) and one-tap launch (`daily-puzzle-play-btn`), desktop keyboard gameplay shortcuts (`1`--`9` swatch select, `+` zoom, `ArrowRight`/`ArrowLeft` pan, `0` reset, plus `<input>` focus guard on `gallery-search-input`), and **Lifetime Stats** (`capy_player_stats_v1` & `lifetime-stats-card`).
  7. **Part 2.6 -- Release Channel Switcher & Non-Production HUD Pill**:
     - Verifies zero `topbar-channel-badge` clutter on default `/` views, `About`-tab `release-channel-card` (`toggle-beta-channel-btn` -> `/capy/beta/`, `beta-apk-download-link` -> `/capy/beta/capy.apk`), and `BETA` pill click-to-open `About` tab on `?capy_channel=beta`.
  8. **Part 2.7 -- Co-op `WELCOME_STATE` Reload Persistence, Replay Rewind `UNFILL`, CRDT `resetEpoch`, Mobile Replay & TopBar Bounds & Save-Load Auto-Resume**:
     - Verifies 2-peer `BroadcastChannel` `WELCOME_STATE` immediate `capy_active_session_v8` persistence across peer reload (`BUG-1`), Replay Scrubber `Resume Here` `UNFILL_EVENT` synchronization across peers, `Reset Progress` (`reset-progress-btn`) `UNFILL_EVENT` broadcast + monotonic `resetEpoch` increment (`M-08`, `F-01`), `360x800` mobile minimized & expanded `ReplayControls` pill fit + non-overlapping `PaletteDock` / `FloatingActions` / `GameTopBar` geometry + swatch-click auto-dismiss, `360x780` mobile `?capy_channel=alpha&pr=520` `GameTopBar` non-overlap (`topbar-left-lane` vs `topbar-right-lane` + `ALPHA #520` non-clipping fit + Settings button fit), `TargetSpotlightOverlay` bounds on `360x780`, `SettingsModal` 5-tab horizontal fit (`settings-modal-tabs` `scrollWidth <= clientWidth`), `Saves` `'THUMBNAILS'` 2-column grid alignment + vertical order + scroll-without-sticky-occlusion check, and save-load `replayLoop` auto-disable (`aria-pressed="false"`) with automatic post-replay gameplay resume.
  9. **Part 2.8 -- Atomic Import Notice, Sample-Save Ordering, Zero-Snapshot Recovery, Corrupt `#s=` Deep Link, Fractional DPR, Transition Races & Tap-Save Non-Starvation**:
     - Verifies fractional `1.25x` `devicePixelRatio` integer backing rounding, atomic malformed `.capy` import rejection with accessible `role="alert"` inline banner (`saves-import-notice`, zero `window.alert()` calls, zero partial saves), `Delete All Saves` active-session cleanup + `Capy Forest` recovery with zero broken thumbnails, `sample_saves.capy` non-shadowing timestamp preservation alongside custom saves, `?room=ABCD23#s=invalid` room preservation + stale hash stripping, debounced / `beforeunload` viewport-save preservation of externally persisted `filledRegionIds` alongside updated `zoomScale`, Probe 2g continuous-tap burst non-starvation of `viewportSaveTimerRef` persistence, rapid custom-image switch blob URL revocation (`resolveSnapshotImageSrc`) + `snapshotTransitioningRef` async `try/finally` recovery on load/delete failure, and zero-idle-polling `TargetSpotlightOverlay` CSS transition alignment.
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

1. **Build & Test Job (`deploy-branch.yml`, `contents: read`, required)**:
   - Runs a `< 2s` pure-Node `npm run test:sanity` check on pure `.md`/metadata PRs (`is_docs_only`, zero `npm ci`) or verified `origin/main`-identical `sync/beta-from-main -> beta` ancestry sync PRs (`is_main_sync`) against the resolved PR merge ref (`checkout_ref`) before skipping Web/Android compilation and Pages deploy.
   - Otherwise restores cached `web/node_modules` (`actions/cache@v6` keyed on `web/package-lock.json`, running `npm ci` only on miss), runs `npm run test:sanity` (`< 2s`), `npm run lint`, `npm run build`, and headless `node scripts/test.mjs --unit` (`< 30s` total, zero Chromium), and uploads `web-dist` (`web/dist/`) for downstream async jobs.
   - Runs in parallel across PR branches (`feature/* -> beta`, `dependabot/* -> beta`, and `beta -> main`) with `inputs.target_branch` concurrency isolation; `dependabot/* -> beta` PRs run `Build & Test`, `Android Build & JUnit Tests`, and `Playwright E2E Release Gate` while skipping Pages `deploy`.
2. **Android Build & JUnit Tests Job (`deploy-branch.yml`, `contents: read`, async)**:
   - Runs asynchronously after `Build & Test` (downloading `web-dist` without blocking `Build & Test` or auto-merge), sets up JDK 17 + Gradle, executes `./gradlew app:testDebugUnitTest app:assembleDebug --build-cache`, and stages/uploads `build-artifacts` (`staging/web/` + `staging/apk/capy.apk`) for Pages deployment.
3. **Playwright E2E Release Gate Job (`deploy-branch.yml`, `contents: read`, async)**:
   - Runs asynchronously after `Build & Test` on ready-for-review (`draft == false`) non-docs/non-main-sync PRs targeting `beta` or `main` **and** on `push` to `beta` or `main`, skipping cleanly on verified `origin/main`-identical `sync/beta-from-main -> beta` PRs whose `HEAD` tree already passed on `main`.
   - Downloads `web-dist` (zero redundant rebuilds), restores cached `web/node_modules` and Playwright Chromium (`~/.cache/ms-playwright`), installs OS shared libraries/Chromium as needed, and executes the full `npm test` SSR + headless Chromium E2E suite without blocking `Build & Test`, Pages `deploy`, or PR merge.
4. **Deploy to GitHub Pages Job (`deploy-branch.yml`, `contents: write`, `pages: write`, `id-token: write`, `pull-requests: write`, async)**:
   - Runs as soon as `Build & Test` and `Android Build & JUnit Tests` succeed (`needs: [prepare, build, android_build]`, never held behind `e2e_release_gate`), guarded by `github.event.repository.has_pages == true` (excluding `dependabot[bot]` PRs, external forks, and `is_main_sync` fast-path PRs) and serialized under the `deploy-pages` concurrency lock (`cancel-in-progress: false`).
   - Uploads the Pages artifact with `include-hidden-files: true` across [`deploy-branch.yml`](./.github/workflows/deploy-branch.yml), [`cleanup-closed-pr.yml`](./.github/workflows/cleanup-closed-pr.yml), and [`cleanup-branches.yml`](./.github/workflows/cleanup-branches.yml) (validated by `yaml.safe_load` assertions in [`web/scripts/test.mjs`](./web/scripts/test.mjs)) so dotfiles such as `.well-known/assetlinks.json` survive deploys and cleanup sweeps.
   - Publishes open Alpha PR previews to `/alpha/<number>/` and `/alpha/<number>/capy.apk`, regenerating `/alpha/index.html` and `/alpha/manifest.json` via [`.github/scripts/generate-pr-manifest.mjs`](./.github/scripts/generate-pr-manifest.mjs) and seeding root `404.html` from [`web/public/404.html`](./web/public/404.html) when absent.
   - Publishes `beta` merges to `/beta/` (`https://shthed.github.io/capy/beta/`) and `/beta/capy.apk` without touching production `/`, refreshing root `404.html` (`--refresh-404`) and `/alpha/manifest.json`.
   - Publishes `main` promotions to `/` (`https://shthed.github.io/capy/`, preserving `/alpha/` and `/beta/`) with refreshed `404.html` (`--refresh-404`) as a single squashed orphan commit on `gh-pages`.
5. **Release & Play Store Bundle Workflow ([`release.yml`](./.github/workflows/release.yml))**:
   - Triggered on `v*.*.*` Git tags (or `workflow_dispatch`), compiling `capy-<tag>.apk` (plus unversioned `capy.apk` on stable releases), Google Play Store `capy-<tag>.aab` (`bundleRelease`), and `capy-web-<tag>.tgz` with release notes extracted via [`.github/scripts/compile-changelog.mjs`](./.github/scripts/compile-changelog.mjs).
6. **Deploy Cloudflare Worker Job ([`deploy-cloudflare.yml`](./.github/workflows/deploy-cloudflare.yml), `contents: read`)**:
   - Runs `npm run test:sanity`, `npm run lint`, and `npm run build`, deploys `web/dist` Static Assets and `worker/index.ts` (`CoopRoomDurableObject`) to `https://capypaint.com/` via `cloudflare/wrangler-action@v4` when `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are set (skipping cleanly in `< 2s` when unconfigured), and verifies `https://capypaint.com/api/health`.
<!-- capy-dev-only:start -->
7. **Bot-Authored PRs ([`open-pr.yml`](./.github/workflows/open-pr.yml)) & Strict `100%` AI Auto-Merge Gate ([`pr-review-gate.yml`](./.github/workflows/pr-review-gate.yml))**:
   - Enforces Draft-first creation (`draft: true` unconditionally in `open-pr.yml` so `gh pr ready <num>` and `synchronize` emit `pull_request` triggers), allows `github-actions[bot]` `pull_request` lifecycle events (`opened`, `synchronize`, `reopened`, `ready_for_review`, `converted_to_draft`) while still guarding against comment/label loops, re-evaluates non-bot `pull_request: edited` events when `changes.base != null || changes.body != null`, filters `capy-review` markers to trusted actors/associations (`OWNER`, `MEMBER`, `COLLABORATOR`), rejects untrusted future `commitDate` clock skew (`> now`, or exceeding earliest head-SHA `capy/review-gate` status or latest force-push timestamps) alongside paginated `capy/review-gate` status timestamp anchoring (`per_page: 100`), fails closed on non-string/`null` PR bodies (`typeof pr.body !== 'string'`), enforces strict `100%` AI review (`100%` marker score, valid `## Summary`, `### PR Readiness Score: 100%`, zero `< 100%` checklist items, and zero unchecked `- [ ]` tasks—or strictly verified `sync/beta-from-main -> beta` `origin/main` ancestry via exact fast-forward, single clean 2-parent `--no-ff` merge commit, or untruncated `< 250`-commit / `< 300`-file non-overlapping 3-way diff parity matching `checkout_ref` tree with zero holds, failing closed on shared-file merges/evil merges, while holding `dependabot[bot]` and unverified pushes pending), strips stale `review:ai-approved` + disarms `auto_merge` if a previously reviewed PR becomes non-passing, and automatically passes `capy/review-gate` and enables auto-merge (or merges immediately if clean; `--merge` on `main`/`sync/beta-from-main`, `--squash` on standard `beta` PRs, disabling auto-merge if a hold is posted) on **both `--base beta` and `--base main`** (unit-tested against the extracted workflow scripts and `if:` expression in [`web/scripts/test.mjs`](./web/scripts/test.mjs)).
8. **Automated `main -> beta` Ancestry Sync ([`sync-beta-from-main.yml`](./.github/workflows/sync-beta-from-main.yml)), Clean-Room Mirror ([`publish-capyboop.yml`](./.github/workflows/publish-capyboop.yml)), Epic Sync ([`sync-agile-tracker.yml`](./.github/workflows/sync-agile-tracker.yml)) & Dependabot ([`dependabot.yml`](./.github/dependabot.yml))**:
   - Triggered on `push` to `main` (or `workflow_dispatch`); `sync-beta-from-main.yml` exits cleanly when `origin/main` is already an ancestor of `origin/beta`, flags `.github/workflows/*` diffs clearly and documents `CAPY_BOT_TOKEN` requirement for automatic `opened`/`synchronize` evaluation when `CAPY_BOT_TOKEN` is unset (since `GITHUB_TOKEN` lacks `workflows: write` and triggers `action_required` / zero-job skips), otherwise opens/updates a `sync/beta-from-main -> beta` PR merged with `--merge` to preserve ancestry without force-pushing protected `beta`; `publish-capyboop.yml` uses ephemeral `GIT_ASKPASS` auth, explicit `git ls-remote` exit-code differentiation (`0` / `2` / fatal error), `SIGPIPE`-safe temp-file `grep -iaqzE` commit-history scanning, and `NEEDS_CLEAN_RESET` tag force-sync (verified via `yaml.safe_load`, `bash -n`, and bare-repo tests in [`web/scripts/test.mjs`](./web/scripts/test.mjs)); `sync-agile-tracker.yml` updates open Epic Issue checklists via pure `actions/github-script` on merged PRs; Dependabot groups weekly `npm`/`gradle`/`github-actions` updates into `--base beta` PRs while scheduled branch cleanup prunes stale `dependabot/` and `sync/` branches safely.
<!-- capy-dev-only:end -->

> [!NOTE]
> **Fast Blocking Gate + Full Local VM Verification**: `npm run test:sanity && npm run lint && npm run build && npm test` is always run locally inside the Antigravity VM before pushing any PR. In GitHub Actions, required `Build & Test` executes fast `< 30s` sanity/lint/build/`--unit` checks while `Android Build & JUnit Tests`, `Playwright E2E Release Gate` (on ready non-docs PRs and branch pushes), and `Deploy to GitHub Pages` run asynchronously without blocking PR review or merge.
