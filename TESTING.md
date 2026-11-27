# Testing Architecture & Verification Guide -- Capy Monorepo (`TESTING.md`)

This document outlines the testing strategy, tooling rationale, unified end-to-end verification suite, and platform test commands across **Web** ([`web/`](./web/)), **Cloudflare Worker** ([`worker/`](./worker/)), and **Android** ([`app/`](./app/)).

**Related Guides**: [`README.md`](./README.md) | [`CONTRIBUTING.md`](./CONTRIBUTING.md) | [`SUPPORT.md`](./SUPPORT.md) | [`SECURITY.md`](./SECURITY.md) | [`ROADMAP.md`](./ROADMAP.md) | [`DEV.md`](./DEV.md) | [`WEB.md`](./WEB.md) | [`PUZZLE.md`](./PUZZLE.md) | [`APP.md`](./APP.md) | [`CLOUD.md`](./CLOUD.md) | [`CHANGELOG.md`](./CHANGELOG.md)

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
1. **Thin Unified Orchestrator ([`web/scripts/test.mjs`](./web/scripts/test.mjs)) + Modular Suites (`web/scripts/tests/{unit,e2e}/`) + Sub-2s Sanity Gate ([`web/scripts/sanity.mjs`](./web/scripts/sanity.mjs))**:
   - `npm run test:sanity` verifies SemVer/`versionCode` parity, `CHANGELOG.md` SemVer/date ordering, clickable PR links, channel-marker invariants, root `.md` guide indexing, and `.md` formatting/links across the repo in `< 2s` with zero browser startup.
   - `npm test` invokes [`web/scripts/test.mjs`](./web/scripts/test.mjs), delegating Part 1 to modular Vite SSR unit suites under `web/scripts/tests/unit/` (plus 13 standalone domain/hook test modules) and Part 2 to **10 parallel isolated Browser E2E suites (24 stages across 6 module files)** under `web/scripts/tests/e2e/` (`runner.mjs` + `helpers.mjs`), binding an ephemeral preview port automatically when `CAPY_TEST_URL` is unset so concurrent runs never collide.
2. **Deterministic Pre-Baked + Live Worker & Event-Driven E2E Coverage**:
   - Verifies both instant zero-worker startup via `./assets/sample_saves.capy` and live `puzzle.worker.ts` custom photo segmentation, IndexedDB (`capy_game_storage_v8`) persistence, and 100% offline PWA reload.
   - Uses deterministic locator visibility, DOM attribute, canvas dimension, `waitForAnimationFrames`, atomic `getStableBoundingBox`, `longPressUndoForReplay`, `waitForCondition`, and URL-hash waits across `web/scripts/tests/e2e/`, reserving annotated `INTENTIONAL_TIMING_WINDOW` sleeps strictly for real debounce (`350ms`), animation, timer-starvation, and negative-absence checks.

---

## 2. Test Suites & Commands Across Targets

### A. Web & Cloudflare Worker (`web/`, `worker/`)

Run from `web/`:

- **`npm run test:sanity` (`node scripts/sanity.mjs`)**: Sub-2-second pure-Node repository gate checking version/`versionCode` parity, `CHANGELOG.md` SemVer/date ordering and leading PR links, `.changelog/` fragment syntax (`<= 320` chars), root guide indexing (`README.md`, `DEV.md`, `PROJECT.md`), Android `@JavascriptInterface` parity, and `.md` hygiene (zero emojis, zero box-drawing art, zero `>= 3`-column tables, valid relative file links and `#anchor` headings).
- **`npm run lint` (`tsc --noEmit && tsc --noEmit -p ../worker/tsconfig.json && oxlint -c .oxlintrc.json --format unix src/`)**: Strict TypeScript checking (`web/` and `worker/`) paired with fast `oxlint` rules across React hooks, empty catch blocks, cyclomatic complexity, and ref access ([`web/.oxlintrc.json`](./web/.oxlintrc.json)).
- **`npm run build` (`tsc && vite build`)**: Compiles TypeScript, emits code-split production bundles in `web/dist/`, stamps `dist/sw.js` with `APP_VERSION` and asset digest, and injects `CAPY_ANDROID_SHA256_CERT_FINGERPRINTS` into `dist/.well-known/assetlinks.json`.
- **`npm run test:unit` (`node scripts/test.mjs --unit`)**: Fast headless Part 1 Vite SSR engine, codec, security, relay, storage, hooks, BYOC cloud sync, and workflow unit suites with zero Chromium launch (executed inside the blocking CI `Build & Test` gate).
- **`npm run test:e2e` (`node scripts/test.mjs --e2e`)**: Runs **Part 2** (all 10 isolated Browser E2E suites / 24 stages) in parallel across `Math.min(4, cpus)` concurrent BrowserContexts without re-running Part 1. Supports `--workers=<n>` (or `CAPY_E2E_WORKERS`), `--suite=<csv>` / `--only=<csv>` (`boot`, `onboarding`, `offers`, `gameplay`, `coop`, `svg-coop`, `mobile`, `resilience`, `accessibility`, `storage`), `--shard=<i>/<n>`, and `--list-suites`.
- **`npm run test:e2e:smoke` (`node scripts/test.mjs --e2e --smoke`)**: Fast (`~15--20s`) critical-path browser smoke subset (`boot` + `gameplay` = 5 stages covering manifest/SW/pre-baked boot, palette/tap coloring, gestures, 5-tab `SettingsModal`, Undo/Redo/Replay, and Create gallery) for rapid local feature PR verification.
- **`npm test` (`node scripts/test.mjs`)**: Runs the **Unified Engine, Codec & Browser E2E Suite** (Part 1 `[Unit 01/16]`--`[Unit 16/16]` followed by all 10 parallel Browser E2E suites / 24 stages with strict execution-count guards and per-suite timing summaries):
  1. **Part 1 -- Modular Unit Suites (`web/scripts/tests/unit/` + standalone domain/hook runners)**:
     - `engine-codec.test.mjs` (`[Unit 01]`): `ColorQuantizer` deterministic K-Means++ (`0xca91ba7a`), `RegionSegmenter` mosaic separation + Phase 2 `O(R log R)` min-heap `maxRegions` cap, `LineArtPuzzleGenerator` B&W source accent fill locking, `GoogleCloudDriver` write serialization, bit-exact `CapyCodec` RLE/LEB128/Gzip framing, `< 2 KB` CRDT `ProgressDeltaV2` merges, multi-chunk `pgblob:*` round-trips, and DoS hardening.
     - `sanity-changelog.test.mjs` (`[Unit 02]` & `[Unit 14]`): `sanity.mjs` gate, SemVer/`APP_VERSION_CODE` parity, `CHANGELOG.md` contract, release channel resolution, `computeProgressPercentage`, and [`.github/scripts/compile-changelog.mjs`](./.github/scripts/compile-changelog.mjs) + [`release.yml`](./.github/workflows/release.yml) wiring.
     - `ci-public-scripts.test.mjs` (`[Unit 03]` & `[Unit 13]`): Cleanup/pruning scripts ([`cleanup-gh-pages-previews.mjs`](./.github/scripts/cleanup-gh-pages-previews.mjs), [`cleanup-branches.mjs`](./.github/scripts/cleanup-branches.mjs)), [`404.html`](./web/public/404.html), [`pr-index.html`](./.github/scripts/pr-index.html), [`generate-pr-manifest.mjs`](./.github/scripts/generate-pr-manifest.mjs), pure-Node [`yamlParser.mjs`](./web/scripts/tests/unit/yamlParser.mjs) workflow checks, and `include-hidden-files: true` dotfile preservation.
     - `services-gameplay.test.mjs` (`[Unit 04]`): `SoundService` safety, `PuzzleCanvas` magnetic zoom detents and zero-allocation `resolveNearTapRegionId` snapping, 20-day `DailyPuzzleService` UTC rotation + on-disk `sample_saves.capy` and `daily_saves.capy` decoding bounds, `PlayerStatsService` monotonic merges, and `SvgPrintExporter`.
     - `coop-share-pwa.test.mjs` (`[Unit 05]`): `ShareLinkService` `#s=` & `?room=` links, `HybridCoopRoomClient` channel/WS isolation, `worker/coopRoomProtocol.ts` validation, `wrangler.jsonc`, `PwaService.resolvePwaCacheName`, `computeDistAssetsDigest`, and `sw.js` Network-First `.capy` checks.
     - `crdt-native-bridge.test.mjs` (`[Unit 06]`): `ProgressDeltaV2` monotonic `resetEpoch` anti-resurrection, `PlayGamesAndroidDriver` `pgblob:*` chunking & fast-fail guards, cold-start `NativeBridge` buffering, ad-free `ConsentRewardedAdAdapter`, `Puzzle Idea Notebook` sorting, `PLAY_STORE_LISTING.md` constraints, and Android Play Games vs. web GIS isolation.
<!-- capy-dev-only:start -->
     - `ci-dev-gates.test.mjs` & `ci-review-gate.test.mjs` (`[Unit 07]`--`[Unit 11]` in full repo; excluded from clean-room exports): Workflow path gating, clean-room export transforms & zero-leak checks, pure-Node `yamlParser.mjs` assertions, E2E suite registry/sharding checks, `node --check` syntax checks, and isolated `bash` checks.
<!-- capy-dev-only:end -->
     - `android-manifest.test.mjs` (`[Unit 12]`): Pure-Node XML verification of Android TV Leanback & Android 17 (`targetSdk = 37`) adaptive [`AndroidManifest.xml`](./app/src/main/AndroidManifest.xml) declarations, `320x180` [`tv_banner.png`](./app/src/main/res/drawable-xhdpi/tv_banner.png), and Play Store foldable screenshot (`1:1`, `4:3`, `10:16`) PNG bounds.
     - `storage-durability.test.mjs` (`[Unit 15]`) + **13 Standalone Domain & Hook Runners** (`web/scripts/*.test.mjs`):
       - *Core Durability & Storage*: `storage-durability.test.mjs` (`.changelog`, `StorageNamespace`, `UserSettings`, `FeatureOffersService`, `TargetSpotlightOverlay`, backup recency), `storage-gateway.test.mjs` (centralized `SafeLocalStore`, fail-closed `IndexedDbStore` quota/retry, LRU `previewCache`, `> 16 MiB` archive bounds), and `storage-analyzer.test.mjs` (stale preview cache eviction, `ImageCompression`, `StorageAnalyzer` orphan GC & shared-origin protection).
       - *Security & Providers*: `release-safety-hardening.test.mjs` (delegating to `hardening-csp-security`, `hardening-worker-sw`, `hardening-cloud-providers`, and `hardening-storage-codec` under `web/scripts/tests/unit/`), `provider-domain-hardening.test.mjs` (tombstones, sign-out cache clearing, `401`/`404` handling, Co-op peer whitelisting & `24`-peer cap), and `worker-coop-security.test.mjs` (Durable Object handshake timeout, host seed-lock, rate limits, feedback relay).
       - *Hooks, UI & Performance*: `settings-decomposition.test.mjs`, `engine-canvas-perf.test.mjs`, `region-segmenter-golden.test.mjs` (bit-identical golden regression across all 4 built-in artworks plus multi-strategy synthetic artwork), `app-hooks-quickwin.test.mjs`, `session-restore-pipeline.test.mjs`, `undo-replay-hooks.test.mjs`, `coop-session-hook.test.mjs`, `cloud-sync-controller-hook.test.mjs`, and `tutorial-snapshot-hooks.test.mjs`.
     - `byoc-cloud-sync.test.mjs` (`[Unit 16]`): BYOC Cloud Sync (`S256` PKCE, Microsoft OneDrive, Apple CloudKit, Auto-Sync Scheduler & Cross-Provider CRDT).
  2. **Part 2 -- 10 Parallel Isolated Browser E2E Suites / 24 Stages (`web/scripts/tests/e2e/runner.mjs` + `helpers.mjs`)**:
     - **`boot-onboarding.e2e.mjs` (`boot` [smoke], `onboarding`, `offers` -- 3 stages)**:
       - `boot`: Manifest, `assetlinks.json`, `privacy-policy.html`, scope-isolated Service Worker cache, and instant 4-sample `sample_saves.capy` launch with zero worker spawn.
       - `onboarding`: 12-step interactive `OnboardingTutorial` auto-advance tour, modal-docked `Settings` & `Hints` guidance, `TargetSpotlightOverlay` geometry, `reducedMotion`, `[All Topics]` drawer, and rapid `Ctrl+Z` bursts.
       - `offers`: All 9 `FeatureOfferBanner` tips (including `settings_hints_tip`) with FIFO queue & backup persistence, `?capy_channel=beta` storage isolation, malformed `#s=` resilience, Play Store default Saves gating, and Android mock bridge behaviors.
     - **`gameplay-settings-replay.e2e.mjs` (`gameplay` [smoke] -- 4 stages)**:
       - Palette selection, region tap coloring, double-tap drag zoom, inertial pan momentum, and Paint Mode.
       - 5-tab `SettingsModal` ARIA accessibility, 6 grouped sections, collapsible Replay & Label Sizing badges, About `Send Feedback` CTA & Open Source Licenses, default Co-op gating, Undo opt-out toggle, and tab persistence.
       - Undo/Redo, long-press `ReplayControls` scrubber, Follow Painting, Auto-Loop, swatch/Ctrl+Z auto-dismiss, Free Color undo, Create gallery filters, and local `Puzzle Idea Notebook`.
     - **`coop-cloud-offline.e2e.mjs` (`coop` -- 5 stages)**:
       - `#s=` share links, opt-in `?coop=1` Co-op UI & 2-peer `BroadcastChannel` sync, Google Drive CRDT sync, Saves views, and `.capy` v2 export.
       - Custom photo IndexedDB upload, 100% offline PWA reload, post-completion replay invariance, `ResizeObserver` canvas clamping, and `customPalette` eviction recovery.
       - Daily Puzzle one-tap prebaked `daily_saves.capy` launch, `reducedMotion`, desktop keyboard shortcuts + `<input>` focus guard, and Lifetime Stats.
     - **`svg-coop-channels.e2e.mjs` (`svg-coop` -- 3 stages)**:
       - Printable `.svg` export, Infinite Zoom 2x detail-tile breadcrumbs & parent delete cleanup, 2-peer Co-op `UNFILL_EVENT` Undo sync, Release Channel switcher & `BETA` pill, Co-op reload persistence, monotonic `resetEpoch`, and `360px` mobile `ReplayControls`.
     - **`mobile-resilience-isolation.e2e.mjs` (`mobile`, `resilience` -- 6 stages)**:
       - `mobile`: `360x780` `GameTopBar` two-lane non-overlap in Normal & Large Text, Create-tab style/hint bars & `(i)` tooltips, synced presets & `Max Detail`, `0px` mobile overflow, viewport-save flush races, blob URL revocation, tap-burst non-starvation, `BETA` pill containment, and Tier 3 foldable/multi-window live-resize continuity (`10:16` outer <-> `1:1` inner <-> `4:3` inner <-> `360x540` split-screen).
       - `resilience`: Atomic malformed `.capy` import notices, zero-snapshot `Capy Forest` recovery, corrupt `#s=` handling, fractional `1.25x` DPR, `ErrorBoundary` emergency backup & retry, Beta/Alpha `StorageNamespace` isolation, inline preview offload, quota toast stacking, and async cloud sync stroke preservation.
     - **`accessibility-byoc-storage.e2e.mjs` (`accessibility`, `storage` -- 3 stages)**:
       - `accessibility`: `360x780` / `412x915` / `1280x720` Normal & Large Text touch targets (`>= 38px`), independent `Text Size` & `UI Size` scaling, `fatFingerAssist` reach boost, Paint Mode single-tap guard, Free Color direct-hit repaint, and `$0` BYOC multi-provider login UI / background sync.
       - `storage`: `BrowserStorageModal` live quota/cache/IDB/Local Storage breakdown, `360x780` zero-overflow, targeted safe cleanups (stale alpha caches, orphaned IDB records, preview channel data, full Capy storage reset with CapyGame shared-origin survival), `Escape` sub-modal isolation, and oversized photo upload compression.
- **`npm run gallery:capture` (`node scripts/capture-gallery.mjs`)**: Starts a local Vite preview server from `dist/` and captures deterministic high-DPI showcase screenshots plus the animated puzzle-completion WebP (`puzzle_completion.webp`) into `docs/gallery/`.
- **`npm run playstore:capture` (`node scripts/capture-playstore-screenshots.mjs`)**: Starts a local Vite preview server from `dist/` and captures Google Play foldable screenshots (`1:1` `1920x1920`, `4:3` `1920x1440`, and `10:16` `1200x1920`) into [`docs/play-store/screenshots/`](./docs/play-store/screenshots/).
- **`npm run generate:samples` (`node scripts/generate-sample-saves.mjs`)**: Spawns an in-process Vite dev server and headless Chromium to deterministically generate all 4 built-in `SAMPLE_GALLERY` puzzles (`web/public/assets/sample_saves.capy`) and all 20 static UTC daily combinations (`web/public/assets/daily_saves.capy`) at Max settings (`2048p`, `2000` max regions, `64` colors or `20` colors in Free Color mode, `24 px²` min region area, fixed `exportDate`) with strict `<= 2000`-region / `< 14 MiB`-unpacked guards.

### B. Native Android Application (`app/`)

Run from the repository root:

```bash
# 1. Run JUnit4 unit tests (`CapyAndroidBridgeTest.kt` + `AndroidTvManifestAndBridgeTest.kt`: haptics, deep-link validation, origin/WebMessage/document blocking, share URL/MIME sanitization, CRDT push conflict decisions, concurrent FILE_IO_LOCK backups, ACTION_SEND downsampling, > 180 KB chunked cloud binary round-trip & corrupt-chunk resilience, TV Leanback manifest & 320x180 tv_banner.png)
./gradlew app:testDebugUnitTest

# 2. Compile Web bundle and assemble Android debug APK
./gradlew app:buildWeb
./gradlew app:assembleDebug
```

> [!IMPORTANT]
> Never run `./gradlew app:installDebug` unless explicitly requested by the user.

---

## 3. Automated Gesture & Canvas Feature Testing Patterns

When extending `web/scripts/tests/e2e/` (invoked via [`web/scripts/test.mjs`](./web/scripts/test.mjs)) for [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx), follow these deterministic patterns:

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

0. **Target Job (`prepare`, `deploy-branch.yml`, `contents: read`, `pull-requests: read`)**:
   - Resolves `target_dir` (`/alpha/<number>/`, `/beta/`, or `/`), `checkout_ref`, `is_docs_only`, `is_main_sync`, `is_draft`, `has_web_changes`, and `skip` flags once before downstream jobs run.
1. **Build & Test Job (`deploy-branch.yml`, `contents: read`, required)**:
   - Runs a `< 2s` pure-Node `npm run test:sanity` check on pure `.md`/metadata PRs (`is_docs_only`, zero `npm ci`) or verified `origin/main`-identical `beta` ancestry sync PRs (`is_main_sync`) before skipping Web/Android compilation and Pages deploy.
   - Otherwise restores cached `web/node_modules`, runs `npm run test:sanity`, `npm run lint`, `npm run build` (with repository BYOC/App Links `vars.*`), and headless `node scripts/test.mjs --unit` (zero Chromium), then uploads `web-dist`.
   - Runs in parallel across PR branches (`feature/* -> beta`, `dependabot/* -> beta`, and `beta -> main`) with concurrency isolation; `dependabot/* -> beta` PRs run `Build & Test`, `Android APK`, and `Playwright E2E` while skipping Pages deploys.
2. **Android APK Job (`deploy-branch.yml`, `contents: read`, async)**:
   - Runs asynchronously after `Build & Test` (downloading `web-dist`), executes `./gradlew app:testDebugUnitTest app:lintVitalRelease app:assembleDebug --build-cache`, and uploads `build-artifacts` (`staging/web/` + `staging/apk/capy.apk`) for Pages deployment.
3. **Playwright E2E Job (`deploy-branch.yml`, `contents: read`, smart tiered async on `beta`/Alpha, required for `main`)**:
   - Runs after `Build & Test` on ready-for-review (`draft == false`) non-docs/non-main-sync PRs targeting `main` (always) or `beta` (when `has_web_changes == 'true'`), on `push` to `main` (when `has_web_changes == 'true'`), and on `workflow_dispatch` targeting `main` (or `run_e2e == true`).
   - Downloads `web-dist`, restores cached `web/node_modules` and Playwright Chromium, checks `ldd` to skip redundant `apt-get` installs, and executes `npm run test:e2e -- --workers=4`.
4. **Deploy Preview (`deploy_preview`) & Production Deploy Pages (`deploy`) Jobs (`deploy-branch.yml`)**:
   - **Unblocked Previews (`deploy_preview`, `target_dir != '.'`)**: Depends on `[prepare, build, android_build]` (never waiting on E2E), publishing open Alpha PR previews to `/alpha/<number>/` + `capy.apk` and `beta` pushes to `/beta/` ([Capy Beta](https://shthed.github.io/capy/beta/)) + `capy.apk` while refreshing `/alpha/manifest.json` and root `404.html`.
   - **E2E-Gated Production (`deploy`, `target_dir == '.'`)**: Depends on `[prepare, build, android_build, e2e_release_gate]`, requiring green E2E before publishing `main` to `/` ([Capy Production](https://shthed.github.io/capy/), preserving `/alpha/` and `/beta/`) as a single squashed orphan commit on `gh-pages`.
   - Guarded by `has_pages == true`, serialized under `deploy-pages`, and uploaded with `include-hidden-files: true` across [`deploy-branch.yml`](./.github/workflows/deploy-branch.yml), [`cleanup-closed-pr.yml`](./.github/workflows/cleanup-closed-pr.yml), and [`cleanup-branches.yml`](./.github/workflows/cleanup-branches.yml) so `.well-known/assetlinks.json` survives deploys and cleanups.
5. **Release & Play Store Bundle Workflow ([`release.yml`](./.github/workflows/release.yml))**:
   - Triggered on `v*.*.*` Git tags (or `workflow_dispatch`), requiring `CAPY_KEYSTORE_*` secrets before running `app:testDebugUnitTest app:lintVitalRelease app:assembleRelease app:bundleRelease` to publish `capy-<tag>.apk` (plus unversioned `capy.apk` on stable tags), `capy-<tag>.aab`, and `capy-web-<tag>.tgz` with notes compiled via [`.github/scripts/compile-changelog.mjs`](./.github/scripts/compile-changelog.mjs).
6. **Deploy Cloudflare Worker Workflow ([`deploy-cloudflare.yml`](./.github/workflows/deploy-cloudflare.yml), `contents: read`)**:
   - Skips docs-only pushes via `paths-ignore`; otherwise runs `npm run test:sanity`, `npm run lint`, `npm run build`, and `npm run test:unit`, deploys `web/dist` + `worker/index.ts` (`CoopRoomDurableObject`) via `cloudflare/wrangler-action@v4`, syncs HTTPS/`301` edge redirects (with optional `replace_dns=true` for first-time cutovers), and verifies both [capypaint.com/api/health](https://capypaint.com/api/health) and [paint.capyboop.com/api/health](https://paint.capyboop.com/api/health) (skipping cleanly in `< 2s` when Cloudflare secrets are absent).
<!-- capy-dev-only:start -->
7. **Bot-Authored PRs/Issues ([`open-pr.yml`](./.github/workflows/open-pr.yml), [`open-issue.yml`](./.github/workflows/open-issue.yml)) & Strict `100%` AI Auto-Merge Gate ([`pr-review-gate.yml`](./.github/workflows/pr-review-gate.yml))**:
   - *Bot Creation & Attribution*: All automated PRs, issues, reviews, merges, and post-merge workflow dispatches execute strictly as `github-actions[bot]` via `GITHUB_TOKEN` (zero personal PATs; `shthed` appears only on personal human actions). `open-pr.yml` enforces Draft-first creation (`draft: true` on create so `gh pr ready` emits `pull_request` triggers); `open-issue.yml` creates and comments on bot-authored tracking/review Issues and updates PR/issue bodies.
   - *`$0` Bot Review Dispatch*: Independent read-only AI reviewers submit verdicts via `workflow_dispatch` (`pr-review-gate.yml` with `head_sha`, `ai_verdict=APPROVED`, `ai_score=100`, `ai_summary`), posting a `<!-- capy-review: actor=ai-agent verdict=APPROVED sha=<HEAD_SHA> score=100% -->` review and applying `review:ai-approved` as `github-actions[bot]` with zero paid API dependency.
   - *Strict Gate, Major-UI Hold & Post-Merge Dispatch*: Verifies `head_sha === pr.head.sha`, `## Summary`, `### PR Readiness Score: 100%`, zero `< 100%` checklist items, zero unchecked `- [ ]` tasks, trusted actor associations, valid commit timestamps, and zero active Owner holds. PRs labeled `review:owner-required` hold `capy/review-gate` at `pending` until explicit Owner approval; all other `100%`-approved PRs targeting `beta` or `main` merge as `github-actions[bot]` (`--squash` on `beta`, `--merge` on `main` and verified `sync/beta-from-main -> beta`) and immediately dispatch downstream workflows (`deploy-branch.yml`, `cleanup-closed-pr.yml`, `regenerate-puzzles.yml` on `beta`; plus `deploy-cloudflare.yml`, `publish-capyboop.yml`, `sync-beta-from-main.yml` on `main`) via `workflow_dispatch` (`actions: write`).
8. **Repository Maintenance Workflows**:
   - *`main -> beta` Ancestry Sync ([`sync-beta-from-main.yml`](./.github/workflows/sync-beta-from-main.yml))*: Runs strictly as `github-actions[bot]` via `GITHUB_TOKEN`, exits cleanly if `origin/main` is already an ancestor of `origin/beta`, and otherwise opens/updates a `sync/beta-from-main -> beta` PR and dispatches `deploy-branch.yml` + `pr-review-gate.yml` via `workflow_dispatch` so it merges via `--merge` cleanly.
   - *Clean-Room Mirror ([`publish-capyboop.yml`](./.github/workflows/publish-capyboop.yml))*: Runs `rebrand-persona.mjs` clean-room export (excluding `AGENTS.md`/`CAPYBOOP.md` and dev workflows while retaining community docs/templates), enforces byte-level zero-leak verification, and pushes linear `capyboop`-authored history + tags to `capyboop/paint`.
   - *Pre-Baked Puzzle Regeneration ([`regenerate-puzzles.yml`](./.github/workflows/regenerate-puzzles.yml))*: Triggers on `workflow_dispatch` or `beta` pushes affecting engine/codec/sample inputs and pushes verified `sample_saves.capy` & `daily_saves.capy` updates as `github-actions[bot]` (opening a bot PR `chore/regenerate-puzzles -> beta` when direct push to protected `beta` is declined).
   - *Dependabot ([`dependabot.yml`](./.github/dependabot.yml))*: Groups weekly `npm`/`gradle`/`github-actions` updates into `--base beta` PRs while scheduled branch cleanup prunes stale branches safely.
<!-- capy-dev-only:end -->

> [!NOTE]
> **Targeted/Smoke Locally + Fast Parallel Full E2E in CI**: For feature PRs targeting `beta`, run `npm run test:sanity && npm run lint && npm run build && npm run test:unit` plus targeted `npm run test:e2e -- --suite=<affected>` or `npm run test:e2e:smoke` (`~15--20s`) locally; reserve full local `npm run test:e2e` for cross-cutting UI/state changes and `beta -> main` promotions. In GitHub Actions, required `Build & Test` stays fast while `Android APK`, `Deploy Preview` (unblocked for Alpha/Beta), and parallel 4-worker `Playwright E2E` (web-touching ready PRs and `main` release gate) run asynchronously.
