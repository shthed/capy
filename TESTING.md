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
2. **Deterministic Pre-Baked + Live Worker & Event-Driven E2E Coverage**:
   - Verifies both instant zero-worker startup via `./assets/sample_saves.capy` and live `puzzle.worker.ts` custom photo segmentation, IndexedDB (`capy_game_storage_v8`) persistence, and 100% offline PWA reload.
   - Replaces arbitrary UI-transition, modal, long-press, Co-op, resize, keyboard-shortcut, and breadcrumb sleeps in [`web/scripts/test.mjs`](./web/scripts/test.mjs) with deterministic locator visibility, DOM attribute, canvas backing-dimension, IndexedDB eviction, and URL-hash waits, reserving explicit `waitForTimeout(...)` calls strictly for real debounce (`350ms`), animation, timer-starvation, and negative-absence guards.

---

## 2. Test Suites & Commands Across Targets

### A. Web & Cloudflare Worker (`web/`, `worker/`)

Run from `web/`:

- **`npm run test:sanity` (`node scripts/sanity.mjs`)**: Sub-2-second pure-Node repository gate checking `web/package.json` / `version.ts` / `app/build.gradle.kts` version formula parity, `CHANGELOG.md` SemVer/date descending order, channel markers, and PR bullet links (clean-room compatible), `README.md` / `DEV.md` / `PROJECT.md` root guide indexing, and `.md` hygiene (zero emojis, zero box-drawing art, zero `>= 3`-column tables, and valid relative links).
- **`npm run lint` (`tsc --noEmit && tsc --noEmit -p ../worker/tsconfig.json`)**: Strict TypeScript type-checking across all React 19 components, services, providers, Web Worker modules, and Cloudflare Worker / Durable Object modules.
- **`npm run build` (`tsc && vite build`)**: Compiles TypeScript, produces code-split production bundles in `web/dist/`, stamps `dist/sw.js` with `APP_VERSION` and emitted asset chunks, and injects `CAPY_ANDROID_SHA256_CERT_FINGERPRINTS` into `dist/.well-known/assetlinks.json`.
- **`npm run test:unit` (`node scripts/test.mjs --unit`)**: Fast (`< 10s`) headless Part 1 Vite SSR engine, codec, security, relay, cleanup, changelog/sanity, and GitHub Actions workflow unit suite with zero Chromium launch (executed inside the blocking CI `Build & Test` gate; emits sequential `[Unit 01/15]`--`[Unit 15/15]` logs, scaling automatically to `[Unit 01/10]`--`[Unit 10/10]` in clean-room exports).
- **`npm test` (`node scripts/test.mjs`)**: Runs the **Unified Engine, Codec & Browser E2E Suite** (`[Unit 01/15]`--`[Unit 15/15]` followed by `[E2E 01/21]`--`[E2E 21/21]` with `assert.equal` execution-count guards and opt-in `CAPY_V3012_SCREENSHOT_DIR` debug captures so default runs write zero temporary screenshot directories):
  1. **Part 1 -- Unified Engine, Binary Codec, Security, Cleanup, Relay & Workflow Unit Checks (`[Unit 01/15]`--`[Unit 15/15]`)**:
     - `ColorQuantizer` unsigned ARGB bit-packing and deterministic K-Means++ initialization (`0xca91ba7a`), `RegionSegmenter` `cellPartitionMap` mosaic separation, `LineArtPuzzleGenerator` B&W source accent fill preservation (`BF-4`), `GoogleCloudDriver` concurrent write serialization (`BF-3`), bit-exact `CapyCodec` scanline RLE + LEB128 varints, `.capy` v2 Gzip framing, `< 2 KB` `ProgressDeltaV2` CRDT epoch-scoped merges, `PlayGamesAndroidDriver` `> 180 KB` multi-chunk `pgblob:*` binary round-trips, and `M-01` DoS hardening (`[Unit 01]`).
     - Fast `< 2s` `sanity.mjs` gate, SemVer/`APP_VERSION_CODE` parity, `CHANGELOG.md` SemVer/channel/bullet contract, release channel path/origin resolution, `computeProgressPercentage`, Epic naming & PR Readiness validation (`[Unit 02]`).
     - Retry, branch filtering, preview pruning, `{ quiet, logger }` suppression/capture options across [`.github/scripts/cleanup-gh-pages-previews.mjs`](./.github/scripts/cleanup-gh-pages-previews.mjs) and [`.github/scripts/cleanup-branches.mjs`](./.github/scripts/cleanup-branches.mjs) (`[Unit 03]`).
     - `SoundService` SSR/throttle/auto-suspend safety, `PuzzleCanvas` magnetic zoom detents/stops, `DailyPuzzleService` UTC date rotation, `PlayerStatsService` persistence & monotonic merges, and `SvgPrintExporter` vector/XML generation (`[Unit 04]`).
     - `ShareLinkService` canonical `#s=` & `?room=` links, `HybridCoopRoomAdapter` WS/channel isolation, `worker/coopRoomProtocol.ts` Origin/frame/rate-limit checks, `wrangler.jsonc`, and `PwaService.resolvePwaCacheName` / `dist/sw.js` stamping (`[Unit 05]`).
     - `ProgressDeltaV2` monotonic `resetEpoch` anti-resurrection, `PlayGamesAndroidDriver` `> 180 KB` `pgblob:*` chunking & fast-fail guards, cold-start `NativeBridge` buffering, and APK/OAuth WebView safety (`[Unit 06]`).
     - Repository workflow scripts, clean-room export transforms, zero-leak verification, and isolated `bash --norc --noprofile` shell syntax/log-scan checks (`[Unit 07]`--`[Unit 11]` in full repo; skipped cleanly in clean-room exports).
     - Android TV Leanback [`AndroidManifest.xml`](./app/src/main/AndroidManifest.xml) declarations + `320x180` [`tv_banner.png`](./app/src/main/res/drawable-xhdpi/tv_banner.png) PNG IHDR bounds (`[Unit 12]`), GitHub Pages [`404.html`](./web/public/404.html) + [`.github/scripts/pr-index.html`](./.github/scripts/pr-index.html) + [`.github/scripts/generate-pr-manifest.mjs`](./.github/scripts/generate-pr-manifest.mjs) + `include-hidden-files: true` (`[Unit 13]`), [`.github/scripts/compile-changelog.mjs`](./.github/scripts/compile-changelog.mjs) + [`release.yml`](./.github/workflows/release.yml) (`[Unit 14]`), and `.changelog` fragments + [`web/scripts/compile-changelog.mjs`](./web/scripts/compile-changelog.mjs) + `StorageNamespace` + `UserSettings` + `FeatureOffersService` + `TargetSpotlightOverlay` + `StorageService` inline preview offload & quota warnings (`[Unit 15]`).
  2. **Part 2 -- 21 Sequential Browser E2E Stages (`[E2E 01/21]`--`[E2E 21/21]`)**:
     - **`[E2E 01]`--`[E2E 03]` Boot, Onboarding & Feature Offers**: `/manifest.webmanifest`, `/.well-known/assetlinks.json`, `/privacy-policy.html`, `capy-cache-v<version>:/` Service Worker cache, instant 4-sample `sample_saves.capy` boot with zero worker spawn (`[E2E 01]`); 14-step `OnboardingTutorial` interactive auto-advance tour, `TargetSpotlightOverlay` geometry, `reducedMotion`, `[All Topics]` drawer, and rapid `Ctrl+Z` burst (`[E2E 02]`); all 8 `FeatureOfferBanner` tips with FIFO queue & `NativeBridge.saveBackup` spy, `?capy_channel=beta` storage isolation, malformed `#s=` DoS resilience, and default Play Store `Saves` gating (`[E2E 03]`).
     - **`[E2E 04]`--`[E2E 07]` Gameplay, Settings, Replay & Create Gallery**: Palette swatch selection, region tap coloring, double-tap drag zoom, inertial pan momentum, and Paint Mode (`[E2E 04]`); 5-tab `SettingsModal` (`About`/`Settings`/`Hints`/`Create`/`Saves`) isolation, `Enable Undo Action` opt-out toggle, and `capy_last_settings_tab` reload persistence (`[E2E 05]`); Undo/Redo, long-press compact `ReplayControls` scrubber, zoom restoration, Follow Painting, Auto-Loop, swatch/Ctrl+Z auto-dismiss, and Free Colour undo (`[E2E 06]`); `Create` tab gallery search/category filters & Community Puzzle Ideas moderation (`[E2E 07]`).
     - **`[E2E 08]`--`[E2E 13]` Share Links, Co-op, Offline PWA, Resilience, Settings, Stats, SVG & Breadcrumbs**: `#s=` share links, `?coop=1` 2-peer BroadcastChannel Co-op, Google Drive CRDT sync, Saves `'THUMBNAILS'`/`'DETAIL'` views, and `.capy` v2 export (`[E2E 08]`); custom photo `STORE_IMAGES` IndexedDB upload, 100% offline PWA reload, and post-completion Replay invariance (`[E2E 09]`); `BF-2` `ResizeObserver` canvas clamping & `BF-6` `customPalette` IndexedDB eviction recovery (`[E2E 10]`); Controls settings persistence & `topbar-zoom-badge` removal (`[E2E 11]`); **Puzzle of the Day** (`DailyPuzzleService`) Create-tab hero card (`daily-puzzle-card`) with zero-wait prebaked `daily_saves.capy` one-tap launch (`daily-puzzle-play-btn`), `reducedMotion`, desktop keyboard shortcuts + `<input>` focus guard, and **Lifetime Stats** (`[E2E 12]`); printable `.svg` coloring sheet download, Infinite Zoom sub-tile `parentSnapshotId` breadcrumbs & parent delete cleanup, and 2-peer Co-op `UNFILL_EVENT` Undo sync (`[E2E 13]`).
     - **`[E2E 14]`--`[E2E 21]` Release Channels, Co-op Reset, `360px` Mobile Bounds, Deep Links & Quota Durability**: `About`-tab Release Channel card & `BETA` HUD pill (`[E2E 14]`); Co-op `WELCOME_STATE` reload persistence, Replay Scrubber rewind `UNFILL`, monotonic CRDT `resetEpoch`, and `360px` mobile `ReplayControls` (`[E2E 15]`); `360x780` `GameTopBar` two-lane non-overlap (`ALPHA #520`), tutorial, 5-tab `SettingsModal`, Create-tab `create-style-hint-bar` + `(i)` option hint tooltips (`hint-toggle-*` / `hint-tooltip-*`) with `0px` overflow, 2-col Saves & `FeatureOfferBanner` bounds (`[E2E 16]`); `360x780` viewport-save flush races, `clearActiveState`/`deleteSnapshot` safety, blob URL revocation, `snapshotTransitioningRef` recovery, and Probe 2g tap-burst non-starvation (`[E2E 17]`); `360x780` `?capy_channel=beta` `BETA` pill Normal/Large Text containment (`[E2E 18]`); atomic malformed `.capy` import notice, `sample_saves.capy` ordering, zero-snapshot `Capy Forest` recovery, corrupt `#s=` deep link & fractional `1.25x` DPR (`[E2E 19]`); `Beta`/`Alpha` `StorageNamespace` browser isolation & `UserSettings` enum persistence (`[E2E 20]`); inline IndexedDB preview offload, storage quota toast above modals, and async cloud sync stroke preservation (`[E2E 21]`).
- **`npm run gallery:capture` (`node scripts/capture-gallery.mjs`)**: Captures deterministic high-DPI showcase screenshots into `docs/gallery/`.
- **`npm run generate:samples` (`node scripts/generate-sample-saves.mjs`)**: Spawns an in-process Vite dev server and headless Chromium to generate all 4 built-in `SAMPLE_GALLERY` puzzles (`web/public/assets/sample_saves.capy`) and a rolling UTC window of daily puzzles (`web/public/assets/daily_saves.capy`) at Max settings (`2048p`, `2000` max regions, `64` colours, `24 px²` min region area).

### B. Native Android Application (`app/`)

Run from the repository root:

```bash
# 1. Run JUnit4 unit tests (`CapyAndroidBridgeTest.kt` + `AndroidTvManifestAndBridgeTest.kt`: haptics, deep-link validation, ACTION_SEND downsampling, > 180 KB chunked cloud binary round-trip & corrupt-chunk resilience, disk backups, TV Leanback manifest & 320x180 tv_banner.png)
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
   - Triggered on `v*.*.*` Git tags (or `workflow_dispatch`), requiring `CAPY_KEYSTORE_BASE64`, `CAPY_KEYSTORE_PASSWORD`, `CAPY_KEY_ALIAS`, and `CAPY_KEY_PASSWORD` before executing `app:testDebugUnitTest app:lintVitalRelease app:assembleRelease app:bundleRelease` to publish `capy-<tag>.apk` (plus unversioned `capy.apk` on stable releases), Google Play Store `capy-<tag>.aab`, and `capy-web-<tag>.tgz` with release notes extracted via [`.github/scripts/compile-changelog.mjs`](./.github/scripts/compile-changelog.mjs).
6. **Deploy Cloudflare Worker Job ([`deploy-cloudflare.yml`](./.github/workflows/deploy-cloudflare.yml), `contents: read`)**:
   - Runs `npm run test:sanity`, `npm run lint`, and `npm run build`, deploys `web/dist` Static Assets and `worker/index.ts` (`CoopRoomDurableObject`) to `https://capypaint.com/` via `cloudflare/wrangler-action@v4` when `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are set (skipping cleanly in `< 2s` when unconfigured), and verifies `https://capypaint.com/api/health`.
<!-- capy-dev-only:start -->
7. **Bot-Authored PRs ([`open-pr.yml`](./.github/workflows/open-pr.yml)) & Strict `100%` AI Auto-Merge Gate ([`pr-review-gate.yml`](./.github/workflows/pr-review-gate.yml))**:
   - Enforces Draft-first creation (`draft: true` unconditionally in `open-pr.yml` so `gh pr ready <num>` and `synchronize` emit `pull_request` triggers), allows `github-actions[bot]` `pull_request` lifecycle events (`opened`, `synchronize`, `reopened`, `ready_for_review`, `converted_to_draft`) while still guarding against comment/label loops, re-evaluates non-bot `pull_request: edited` events when `changes.base != null || changes.body != null`, filters `capy-review` markers to trusted actors/associations (`OWNER`, `MEMBER`, `COLLABORATOR`), rejects untrusted future `commitDate` clock skew (`> now`, or exceeding earliest head-SHA `capy/review-gate` status or latest force-push timestamps) alongside paginated `capy/review-gate` status timestamp anchoring (`per_page: 100`), fails closed on non-string/`null` PR bodies (`typeof pr.body !== 'string'`), enforces strict `100%` AI review (`gemini-3.8-flash` primary with `gemini-4-argon` / `gemini-2.5-flash` `404` fallback, `100%` marker score, valid `## Summary`, `### PR Readiness Score: 100%`, zero `< 100%` checklist items, and zero unchecked `- [ ]` tasks—or strictly verified `sync/beta-from-main -> beta` `origin/main` ancestry via exact fast-forward, single clean 2-parent `--no-ff` merge commit, or untruncated `< 250`-commit / `< 300`-file non-overlapping 3-way diff parity matching `checkout_ref` tree with zero holds, failing closed on shared-file merges/evil merges, while holding `dependabot[bot]` and unverified pushes pending), preserves valid `review:ai-approved` on `synchronize` while stripping `review:owner-approved` and reconciling `review:changes-requested`, falls back to `ACTIONS_GITHUB_TOKEN` REST commit status `fetch` on `403` for non-Dependabot events (and Dependabot `issue_comment`) while skipping read-only Dependabot `pull_request` `403`s, strips stale `review:ai-approved` + disarms `auto_merge` if a previously reviewed PR becomes non-passing, and automatically passes `capy/review-gate` and enables auto-merge (or merges immediately if clean; `--merge` on `main`/`sync/beta-from-main`, `--squash` on standard `beta` PRs, disabling auto-merge if a hold is posted) on **both `--base beta` and `--base main`** (unit-tested against the extracted workflow scripts and `if:` expression in [`web/scripts/test.mjs`](./web/scripts/test.mjs)).
8. **Automated `main -> beta` Ancestry Sync ([`sync-beta-from-main.yml`](./.github/workflows/sync-beta-from-main.yml)), Clean-Room Mirror ([`publish-capyboop.yml`](./.github/workflows/publish-capyboop.yml)), Epic Sync ([`sync-agile-tracker.yml`](./.github/workflows/sync-agile-tracker.yml)) & Dependabot ([`dependabot.yml`](./.github/dependabot.yml))**:
   - Triggered on `push` to `main` (or `workflow_dispatch`); `sync-beta-from-main.yml` exits cleanly when `origin/main` is already an ancestor of `origin/beta`, flags `.github/workflows/*` diffs clearly and documents `CAPY_BOT_TOKEN` requirement for automatic `opened`/`synchronize` evaluation when `CAPY_BOT_TOKEN` is unset (since `GITHUB_TOKEN` lacks `workflows: write` and triggers `action_required` / zero-job skips), otherwise opens/updates a `sync/beta-from-main -> beta` PR merged with `--merge` to preserve ancestry without force-pushing protected `beta`; `publish-capyboop.yml` uses ephemeral `GIT_ASKPASS` auth, explicit `git ls-remote` exit-code differentiation (`0` / `2` / fatal error), `SIGPIPE`-safe temp-file `grep -iaqzE` commit-history scanning, and `NEEDS_CLEAN_RESET` tag force-sync (verified via `yaml.safe_load`, `bash -n`, and bare-repo tests in [`web/scripts/test.mjs`](./web/scripts/test.mjs)); `sync-agile-tracker.yml` updates open Epic Issue checklists via pure `actions/github-script` on merged PRs; Dependabot groups weekly `npm`/`gradle`/`github-actions` updates into `--base beta` PRs while scheduled branch cleanup prunes stale `dependabot/` and `sync/` branches safely.
<!-- capy-dev-only:end -->

> [!NOTE]
> **Fast Blocking Gate + Full Local VM Verification**: `npm run test:sanity && npm run lint && npm run build && npm test` is always run locally inside the Antigravity VM before pushing any PR. In GitHub Actions, required `Build & Test` executes fast `< 30s` sanity/lint/build/`--unit` checks while `Android Build & JUnit Tests`, `Playwright E2E Release Gate` (on ready non-docs PRs and branch pushes), and `Deploy to GitHub Pages` run asynchronously without blocking PR review or merge.
