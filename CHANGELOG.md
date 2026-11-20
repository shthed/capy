### 3.0.48 - 2026-11-20 (Production, Beta)

- [#610](https://github.com/shthed/capy/pull/610) Consolidate recent changelog releases into one version per day, condense recent descriptions to 1--2 sentences, move clickable PR links to the start of every bullet, and update the changelog compiler, sanity checks, and `.changelog/README.md`.
- [#608](https://github.com/shthed/capy/pull/608) Omit region boundary lines on completed regions so finished artwork renders seamlessly while unpainted regions keep crisp borders.
- [#604](https://github.com/shthed/capy/pull/604) Add Bring-Your-Own-Cloud account login and automatic cross-device sync for Microsoft OneDrive, Apple CloudKit, and Google Drive with Android OAuth PKCE support.
- [#605](https://github.com/shthed/capy/pull/605) Scale interactive buttons, icons, sliders, and palette swatches in Large Text mode, enable Fat-Finger assist by default, and fix single-tap double-paint and free-colour repaint regressions.
- [#603](https://github.com/shthed/capy/pull/603) Add an anonymous in-game feedback card in Settings backed by a rate-limited Cloudflare Worker relay with a graceful prefilled fallback.
- [#595](https://github.com/shthed/capy/pull/595) Bind the `paint.capyboop.com` custom domain on Cloudflare Workers and allowlist it across Co-op relay, channel detection, and CSP headers.
- [#601](https://github.com/shthed/capy/pull/601) Rename the Android package, namespace, FileProvider authority, and store/architecture docs from `com.capypaint.capy` to `com.capyboop.paint`.
- [#602](https://github.com/shthed/capy/pull/602) Add Fat-Finger Mode with configurable touch reach radius presets (`12px`, `22px`, `34px`) and zero-allocation radial near-miss hit-testing on small regions.

### 3.0.41 - 2026-11-19

- [#598](https://github.com/shthed/capy/pull/598) Align the root `README.md` heading (`# Capy Paint`) with the standalone `capyboop/paint` repository.
- [#596](https://github.com/shthed/capy/pull/596) Retarget the public clean-room mirror, in-app Report Bug / Ideas link, privacy policy, and studio docs from `capyboop/capy` to `capyboop/paint`.
- [#590](https://github.com/shthed/capy/pull/590) Allow the top-bar puzzle save title pill to expand across available left-lane width on mobile and desktop instead of truncating at fixed caps.
- [#589](https://github.com/shthed/capy/pull/589) Replace the daily puzzle-regeneration cron schedule with on-demand and path-filtered triggers on `beta`.
- [#588](https://github.com/shthed/capy/pull/588) Add `oxlint` guardrails, crash-safe `<ErrorBoundary>` recovery with emergency backup export, and consolidated storage/cloud helpers while migrating brittle source-string tests to behavioral checks.
- [#587](https://github.com/shthed/capy/pull/587) Add public community docs (`CONTRIBUTING.md`, `SUPPORT.md`, `SECURITY.md`, PR/issue templates) and exclude internal agent playbooks from public clean-room exports.

### 3.0.36 - 2026-11-18

- [#579](https://github.com/shthed/capy/pull/579) Harden CSP/HSTS headers, service worker caching, local storage schema validation, Co-op burst sync and Worker rate limits, and Android WebView security invariants.
- [#578](https://github.com/shthed/capy/pull/578) Promote `v3.0.35` channel markers, update the Play Store listing metadata, and align CI check titles and roadmap docs for release.
- [#577](https://github.com/shthed/capy/pull/577) Harden local and native backup durability with monotonic timestamps, separated backup/heal retry queues, and empty-overwrite protection across Web, iOS, and Android.
- [#576](https://github.com/shthed/capy/pull/576) Gracefully skip tag-triggered Android release builds when signing secrets are absent and harden public clean-room mirror filtering and origin checks.
- [#575](https://github.com/shthed/capy/pull/575) Add public GitHub issue templates and an About-tab Report Bug / Ideas button linking directly to the public issue tracker.
- [#573](https://github.com/shthed/capy/pull/573) Fix high-resolution `maxRegions` segmentation overflow with a binary min-heap, regenerate Max-detail sample and daily `.capy` archives, and polish Create-tab preset controls and tooltips.
- [#571](https://github.com/shthed/capy/pull/571) Remove legacy rewarded-ad UI hooks, replace placeholder community votes with a local Puzzle Idea Notebook, gate Android startup prompts, and refresh Play Store screenshots.

### 3.0.29 - 2026-11-16

- [#569](https://github.com/shthed/capy/pull/569) Fix intermittent Play Daily E2E failures by waiting for the prebaked daily snapshot to mount before asserting.
- [#568](https://github.com/shthed/capy/pull/568) Update changelog channel markers for the `v3.0.29` Production release promotion.
- [#566](https://github.com/shthed/capy/pull/566) Fix signed Android release `lintVitalRelease` failures by pinning `androidx.fragment:fragment-ktx` `1.8.9` and running release lint in per-PR Android CI.
- [#565](https://github.com/shthed/capy/pull/565) Pre-generate Max-detail sample and rolling daily `.capy` archives with selective zero-wait loading, and add tap-friendly Create-tab style hints and tooltips.
- [#563](https://github.com/shthed/capy/pull/563) Standardize unit and E2E test stage numbering with execution-count assertions, opt-in screenshot capture, and isolated subprocess environments.
- [#550](https://github.com/shthed/capy/pull/550) Enable Cloudflare Worker deployment directly from CI with health-check retries, remove redundant `_redirects` rules, and document Cloudflare Workers setup.
- [#560](https://github.com/shthed/capy/pull/560) Add direct-merge fallback for strict `100%` AI-approved PRs when GitHub auto-merge is blocked on non-check ruleset rules and green checks exist.
- [#559](https://github.com/shthed/capy/pull/559) Update changelog channel markers and sync roadmap docs for the `v3.0.24` Production release promotion.
- [#557](https://github.com/shthed/capy/pull/557) Add an interactive Preset Style Gallery with 10 real segmented previews in the Create tab, sync manual palette counts to `Custom`, and add a matching tutorial step.
- [#555](https://github.com/shthed/capy/pull/555) Set default colour mode to Original Detail and default palette sort order to Rainbow / Hue.
- [#554](https://github.com/shthed/capy/pull/554) Keep replay controls in the compact single-row scrubber bar by removing the expandable two-row deck toggle.
- [#553](https://github.com/shthed/capy/pull/553) Add asynchronous stacked-PR merge fallback and require outstanding-work checklists on Draft PRs in the review gate.
- [#548](https://github.com/shthed/capy/pull/548) Update changelog channel markers and sync roadmap docs for the `v3.0.20` Production release promotion.
- [#547](https://github.com/shthed/capy/pull/547) Hide unfinished Cloud/Co-op UI behind opt-in dev flags while keeping share links and printable SVG visible, and add Google Play Store assets and listing copy.

### 3.0.19 - 2026-11-15

- [#546](https://github.com/shthed/capy/pull/546) Reconcile `3.0.18`/`3.0.19` changelog channels and archive shipped Epic 2 pull requests in `ROADMAP.md`.
- [#545](https://github.com/shthed/capy/pull/545) Declare Android TV Leanback launcher support with a TV banner, update the privacy policy for 100% ad-free builds, and expand Android TV and review-gate tests.
- [#544](https://github.com/shthed/capy/pull/544) Add repo-scoped `.agents/environment.json` setup config and update cloud/roadmap docs with clickable production domain links.
- [#540](https://github.com/shthed/capy/pull/540) Wait two animation frames after wheel zoom in E2E tests to eliminate a viewport-save debounce race before reload.
- [#539](https://github.com/shthed/capy/pull/539) Replace brittle fixed sleeps across the E2E suite with deterministic Playwright locator, attribute, IndexedDB, and URL-hash waits.
- [#537](https://github.com/shthed/capy/pull/537) Target Android API 36 with edge-to-edge insets, hardened WebView navigation, isolated share cache cleanup, cold-start bridge queuing, and release-signing secret checks.
- [#535](https://github.com/shthed/capy/pull/535) Offload save thumbnails to IndexedDB with quota alerts, optimize canvas rendering and HUD memoization, code-split the puzzle generator, and harden Co-op checkpoints.
- [#534](https://github.com/shthed/capy/pull/534) Harden PR review-gate body validation, include `.well-known/assetlinks.json` in GitHub Pages deploys, and improve clean-room mirror sync reliability.
- [#530](https://github.com/shthed/capy/pull/530) Preserve active puzzle progress across debounced and `beforeunload` viewport saves, remove idle spotlight polling, and speed up CI with async heavy jobs.

### 3.0.12 - 2026-11-14

- [#523](https://github.com/shthed/capy/pull/523) Add a non-blocking `TargetSpotlightOverlay` ring and arrow across all 14 tutorial steps and 9 feature tips, plus tighter mobile top-bar fit and synchronous Co-op state updates.
- [#519](https://github.com/shthed/capy/pull/519) Upgrade the onboarding tutorial to a 14-step interactive guide with topic jumping and 9 contextual feature-offer tips, and raise PR review gates to strict `100%`.
- [#518](https://github.com/shthed/capy/pull/518) Add Low-Vision Large Text accessibility mode, keep the palette dock sorted and centered when scrollable, and enable Undo by default.
- [#517](https://github.com/shthed/capy/pull/517) Keep the palette dock visible above replay controls with swatch auto-dismiss and default the Saves tab to a thumbnail-first layout.

### 3.0.8 - 2026-11-13

- [#521](https://github.com/shthed/capy/pull/521) Add CapyBoop Games company structure and AI agent handbook (`CAPYBOOP.md`).
- [#501](https://github.com/shthed/capy/pull/501) Promote `v3.0.8` beta release to Production.
- [#497](https://github.com/shthed/capy/pull/497) Remove the top-bar zoom pill badge, fix `360px` mobile Settings tab clipping, and add an E2E overflow guard.
- [#495](https://github.com/shthed/capy/pull/495) Isolate alpha/beta preview storage namespaces, harden canvas DPR listeners, add the `.changelog/` fragment compiler, and fix palette accessibility labels.
- [#489](https://github.com/shthed/capy/pull/489) Keep post-load replay controls visible until interaction, set Capy Forest as the default puzzle, add the first-run tutorial, and move the About tab first.
- [#491](https://github.com/shthed/capy/pull/491) Serve the `/capy/alpha/` preview index manifest with `404.html` redirects from legacy `/PR/` and `/pull/` paths.
- [#492](https://github.com/shthed/capy/pull/492) Standardize GitHub Pages PR preview URLs to lowercase `/capy/alpha/<num>/` and prune stale legacy preview directories.
- [#494](https://github.com/shthed/capy/pull/494) Harden CI workflow retries, Playwright caching on beta PRs, main-to-beta syncing, and changelog/guide sanity checks.
- [#493](https://github.com/shthed/capy/pull/493) Establish the `PROJECT.md` governance charter, split `3.0.1` vs `3.0.2` changelog channels, and reconcile Epic backlog links.
- [#490](https://github.com/shthed/capy/pull/490) Add bot-opened PR workflow automation, native review-gate tests, and prebaked sample viewport resets.
- [#487](https://github.com/shthed/capy/pull/487) Add Android Play Store release to `v3.0.1` scope and clear shipped Sprint 1 bugfixes from the active queue.

### 3.0.1 - 2026-11-12

- [#488](https://github.com/shthed/capy/pull/488) Promote v3.0.1 mobile topbar and progress cap fixes to Production
- [#486](https://github.com/shthed/capy/pull/486) Fix mobile topbar badge overlap, cap incomplete puzzle progress at 99%, and log capypaint.com DNS cutover
- [#485](https://github.com/shthed/capy/pull/485) Prepare v3.0.0 beta release with Cloudflare Worker, Co-op relay hardening, mobile replay controls, and CI sanity gate

### 2.7 - 2026-11-12

- [#484](https://github.com/shthed/capy/pull/484) Fix Co-op save and rewind sync, Android large cloud saves, CRDT reset epochs, and mobile replay controls

### 2.6 - 2026-11-12

- [#482](https://github.com/shthed/capy/pull/482) Add capypaint.com Cloudflare Worker, Co-op relay security hardening, clean-room export, and dual-approval CI gate

### 2.5 - 2026-11-11

- [#483](https://github.com/shthed/capy/pull/483) Document 3-artefact roadmap triad, GitHub Epic Issue CLI playbooks, and sprint lifecycle
- [#481](https://github.com/shthed/capy/pull/481) Add 3-tier Alpha/Beta/Production release pipeline, channel switcher, and GitHub Agile tracking
- [#475](https://github.com/shthed/capy/pull/475) Add sub-tile parent breadcrumbs, printable SVG sheets, and Co-op undo sync
- [#473](https://github.com/shthed/capy/pull/473) Split strategic ROADMAP.md from Sprint 1 TODO.md and add Gemini 4 sprint playbooks
- [#474](https://github.com/shthed/capy/pull/474) Add daily featured puzzle, reduced motion, keyboard shortcuts, and lifetime stats
- [#472](https://github.com/shthed/capy/pull/472) Add zoom sensitivity, magnetic zoom stops, and procedural Web Audio tap effects
- [#471](https://github.com/shthed/capy/pull/471) Fix cache-eviction E2E test, replay speed grid, and atomic Android backups
- [#470](https://github.com/shthed/capy/pull/470) Standardize TODO.md under Lean Agile epics, stories, and collapsible task specs
- [#467](https://github.com/shthed/capy/pull/467) Add DEV.md, streamline AGENTS.md, and overhaul repository documentation and privacy policy
- [#469](https://github.com/shthed/capy/pull/469) Compact changelog headings for mobile, remove preamble, and group same-day patch releases
- [#468](https://github.com/shthed/capy/pull/468) Standardize historical PR metadata, move changelog rules to AGENTS.md, and add full PR history
- [#466](https://github.com/shthed/capy/pull/466) Resolve all remaining audit bugfixes from TODO
- [#465](https://github.com/shthed/capy/pull/465) Fix resize clamping, IndexedDB palette recovery, and Pixel API 33+ haptics
- [#464](https://github.com/shthed/capy/pull/464) Add YouTube-style playback scrubber and preserve viewport on replay
- [#463](https://github.com/shthed/capy/pull/463) Consolidate test suite, enhance save-load replay, and add AAA TODO roadmap

### 2.4 - 2026-11-10

- [#461](https://github.com/shthed/capy/pull/461) Add modular cloud provider drivers and Google Drive cross-device sync

### 2.3 - 2026-11-10

- [#462](https://github.com/shthed/capy/pull/462) Fix runtime sample resolution, canvas undo repaint, bundle splitting, and prioritize TODO.md

### 2.2 - 2026-11-10

- [#460](https://github.com/shthed/capy/pull/460) Add shareable progress links, simultaneous Co-op, CRDT Cloud Sync, and Play Store compliance

### 2.1 - 2026-11-10

- [#459](https://github.com/shthed/capy/pull/459) Preload sample save archive for instant first-launch gameplay

### 2.0 - 2026-11-10

- [#458](https://github.com/shthed/capy/pull/458) Add Compact Binary Storage v2 (.capy v2) and fix engine edge cases

### 1.4 - 2026-11-09

- [#457](https://github.com/shthed/capy/pull/457) Add min/max label size options, guarantee region fit, and redo circle-free hint color
- [#456](https://github.com/shthed/capy/pull/456) Set Fast Mode puzzle generation progress as default
- [#455](https://github.com/shthed/capy/pull/455) Show real generation metrics and live palette swatches during segmentation
- [#454](https://github.com/shthed/capy/pull/454) Add loading progress detail toggle and fast mode

### 1.3 - 2026-11-09

- [#453](https://github.com/shthed/capy/pull/453) Update AGENTS.md: Refine contributor and agent operational rules
- [#452](https://github.com/shthed/capy/pull/452) Add PWA offline support and manifest
- [#451](https://github.com/shthed/capy/pull/451) Add working thoughts display and Web engine conventions to AGENTS.md
- [#450](https://github.com/shthed/capy/pull/450) Add ci and deps GitHub pull request labels to AGENTS.md
- [#449](https://github.com/shthed/capy/pull/449) Add thumbnails grid view, save pinning, and toolbar to Saves gallery

### 1.2 - 2026-11-09

- [#448](https://github.com/shthed/capy/pull/448) Fix Undo/Redo state synchronization and add post-replay auto-resume
- [#447](https://github.com/shthed/capy/pull/447) Add undo timeline scrubber and multi-step redo
- [#446](https://github.com/shthed/capy/pull/446) Add animated puzzle replay and region undo

### 1.1 - 2026-11-09

- [#445](https://github.com/shthed/capy/pull/445) Add screenshot showcase gallery and capture script
- [#444](https://github.com/shthed/capy/pull/444) Improve zoom pan gestures and color pickers
- [#443](https://github.com/shthed/capy/pull/443) Add PR merge approval rule and preview lifecycle docs
- [#442](https://github.com/shthed/capy/pull/442) Calibrate pan zoom gestures and sync preview assets

### 1.0 - 2026-11-08

- [#441](https://github.com/shthed/capy/pull/441) Add web architecture documentation
- [#440](https://github.com/shthed/capy/pull/440) Optimize CI builds and Pages deployment pipeline
- [#439](https://github.com/shthed/capy/pull/439) Add Free Colour mode, custom palette swatches, and Mushroom Forest sample
- [#438](https://github.com/shthed/capy/pull/438) Parallelize Web and Android CI workflows and streamline target execution
- [#437](https://github.com/shthed/capy/pull/437) Update Web dependencies, enable parallel Gradle sync, and add maintenance guides
- [#436](https://github.com/shthed/capy/pull/436) Add Android WebView debugging, bundle validation, and developer tooling
- [#435](https://github.com/shthed/capy/pull/435) Realign root architecture documentation and prune completed roadmap items
- [#434](https://github.com/shthed/capy/pull/434) Add automated closed pull request preview pruning for GitHub Pages
- [#433](https://github.com/shthed/capy/pull/433) Fix active color sync and auto-pan jumps and add victory celebration export
- [#432](https://github.com/shthed/capy/pull/432) Unify Web and Android single-codebase architecture with WebViewAssetLoader
- [#431](https://github.com/shthed/capy/pull/431) Consolidate Web, Legacy Web1, and Android apps into unified monorepo

### 0.9.3 - 2026-09-24

- [#430](https://github.com/shthed/capy/pull/430) Fix runtime bootstrap scope, default artwork loading, and UI load tests
- [#429](https://github.com/shthed/capy/pull/429) Rename menu and relocate advanced settings toggle
- [#428](https://github.com/shthed/capy/pull/428) Fix save manager SVG export handler
- [#427](https://github.com/shthed/capy/pull/427) Reorder settings tabs around Saves and Create
- [#425](https://github.com/shthed/capy/pull/425) Add SVG snapshot export to save manager
- [#424](https://github.com/shthed/capy/pull/424) Fix autosave refresh and smoke coverage
- [#423](https://github.com/shthed/capy/pull/423) Rework settings header layout
- [#421](https://github.com/shthed/capy/pull/421) Simplify controls layout in settings menu
- [#420](https://github.com/shthed/capy/pull/420) Move hint intensity controls to basics tab
- [#419](https://github.com/shthed/capy/pull/419) Drop raster save artifacts and rebuild maps from vector scenes

### 0.9.2 - 2025-12-05

- [#418](https://github.com/shthed/capy/pull/418) Wrap mobile settings tabs and update settings-menu.json schema
- [#417](https://github.com/shthed/capy/pull/417) Reduce settings sheet minimum dimensions and safe-area gaps on mobile
- [#416](https://github.com/shthed/capy/pull/416) Add configurable region cleanup controls
- [#415](https://github.com/shthed/capy/pull/415) Lower generator defaults for simpler puzzles
- [#414](https://github.com/shthed/capy/pull/414) Enforce upload resizing to stay within source image limit
- [#413](https://github.com/shthed/capy/pull/413) Clarify branch baseline guidance
- [#412](https://github.com/shthed/capy/pull/412) Render labels with SVG
- [#411](https://github.com/shthed/capy/pull/411) Remove binary artifact and document policy
- [#410](https://github.com/shthed/capy/pull/410) Polish vector sample rendering and docs
- [#409](https://github.com/shthed/capy/pull/409) Add vector scene loader and refresh sample puzzle

### 0.9.1 - 2025-12-04

- [#408](https://github.com/shthed/capy/pull/408) Handle save quota failures by trimming previews
- [#407](https://github.com/shthed/capy/pull/407) Fix deploy workflow concurrency scope and env URL
- [#406](https://github.com/shthed/capy/pull/406) Prefer human-readable region maps
- [#405](https://github.com/shthed/capy/pull/405) Enhance smoke test logging report
- [#404](https://github.com/shthed/capy/pull/404) Add render preview support to svg renderer
- [#403](https://github.com/shthed/capy/pull/403) Handle renderer resize safely
- [#402](https://github.com/shthed/capy/pull/402) Auto-generate settings sheet from JSON definition
- [#401](https://github.com/shthed/capy/pull/401) Prune unused runtime modules
- [#400](https://github.com/shthed/capy/pull/400) Consolidate runtime into capy.js
- [#399](https://github.com/shthed/capy/pull/399) Summarize processed branches in cleanup workflow

### 0.9.0 - 2025-11-28

- [#398](https://github.com/shthed/capy/pull/398) Expose runtime APIs as module exports
- [#397](https://github.com/shthed/capy/pull/397) Rewrite Pages deployment workflow
- [#396](https://github.com/shthed/capy/pull/396) Temporarily disable service worker and offline cache
- [#395](https://github.com/shthed/capy/pull/395) Simplify runtime to SVG renderer
- [#394](https://github.com/shthed/capy/pull/394) Expose runtime API via global object
- [#393](https://github.com/shthed/capy/pull/393) Preserve gh-pages preview directories during main deploy
- [#392](https://github.com/shthed/capy/pull/392) Export renderer controller inline
- [#391](https://github.com/shthed/capy/pull/391) Harden renderer controller fallback
- [#390](https://github.com/shthed/capy/pull/390) Avoid duplicate createRendererController export
- [#389](https://github.com/shthed/capy/pull/389) Refresh start hint onboarding UI

### 0.8.3 - 2025-11-28

- [#388](https://github.com/shthed/capy/pull/388) Restore renderer pipeline and fixtures
- [#387](https://github.com/shthed/capy/pull/387) Improve renderer wiring and tests
- [#386](https://github.com/shthed/capy/pull/386) Delete merged branches without cutoff
- [#385](https://github.com/shthed/capy/pull/385) Refine Playwright skip handling
- [#384](https://github.com/shthed/capy/pull/384) Enhance branch cleanup diagnostics
- [#383](https://github.com/shthed/capy/pull/383) Add debug listing to deploy workflow
- [#382](https://github.com/shthed/capy/pull/382) Refine responsive settings navigation and input control styles
- [#381](https://github.com/shthed/capy/pull/381) Handle gh-pages root cleanup
- [#380](https://github.com/shthed/capy/pull/380) Fix deployment artifact path for branch previews
- [#379](https://github.com/shthed/capy/pull/379) Remove outdated menu screenshot artifact

### 0.8.2 - 2025-11-27

- [#378](https://github.com/shthed/capy/pull/378) Add responsive tab stacking and themed input controls to settings sheet
- [#377](https://github.com/shthed/capy/pull/377) Register renderer mode change handler
- [#376](https://github.com/shthed/capy/pull/376) Add iterative development feedback loop guide
- [#375](https://github.com/shthed/capy/pull/375) Clarify renderer controller exports
- [#374](https://github.com/shthed/capy/pull/374) Simplify branch preview comment output
- [#373](https://github.com/shthed/capy/pull/373) Simplify runtime exports
- [#372](https://github.com/shthed/capy/pull/372) Fix service worker cache script loading on GitHub Pages
- [#371](https://github.com/shthed/capy/pull/371) Add console error check to UI smoke test
- [#370](https://github.com/shthed/capy/pull/370) Ensure deploy previews checkout into PR-specific pull directories
- [#369](https://github.com/shthed/capy/pull/369) Consolidate runtime exports

### 0.8.1 - 2025-11-26

- [#368](https://github.com/shthed/capy/pull/368) Fix duplicate renderer controller export
- [#367](https://github.com/shthed/capy/pull/367) Fix Pages artifact path for main deployments
- [#366](https://github.com/shthed/capy/pull/366) Fix runtime controller export
- [#365](https://github.com/shthed/capy/pull/365) Remove Pico CSS
- [#364](https://github.com/shthed/capy/pull/364) Restore custom styles and remove Pico import
- [#363](https://github.com/shthed/capy/pull/363) Add gh-pages artifact diagnostics to deploy workflows
- [#362](https://github.com/shthed/capy/pull/362) Add preboot metric fallbacks for blocked storage
- [#361](https://github.com/shthed/capy/pull/361) Fix branch deployment setup and linkify preview comments
- [#360](https://github.com/shthed/capy/pull/360) Improve deploy preview logging
- [#359](https://github.com/shthed/capy/pull/359) Gate Pages deploys to open PRs and refresh docs

### 0.8.0 - 2025-11-26

- [#358](https://github.com/shthed/capy/pull/358) Add renderer follow-up tasks
- [#357](https://github.com/shthed/capy/pull/357) Exclude project files from Pages deploy
- [#356](https://github.com/shthed/capy/pull/356) Improve SVG renderer sizing and tests
- [#355](https://github.com/shthed/capy/pull/355) Rename changelog file and update guidance
- [#354](https://github.com/shthed/capy/pull/354) Use PR-numbered preview URLs and cleanup on close
- [#353](https://github.com/shthed/capy/pull/353) Simplify branch preview URLs
- [#352](https://github.com/shthed/capy/pull/352) Refine settings tabs and layout
- [#351](https://github.com/shthed/capy/pull/351) Fix deploy workflow concurrency group expression
- [#350](https://github.com/shthed/capy/pull/350) Fix branch preview deployment path
- [#349](https://github.com/shthed/capy/pull/349) Adjust deploy target directory for main Pages deployment

### 0.7.3 - 2025-11-24

- [#348](https://github.com/shthed/capy/pull/348) Improve responsive settings layout
- [#347](https://github.com/shthed/capy/pull/347) Fix duplicate createRendererController export
- [#346](https://github.com/shthed/capy/pull/346) Remove legacy renderer module files
- [#345](https://github.com/shthed/capy/pull/345) Simplify bootstrap to SVG renderer
- [#344](https://github.com/shthed/capy/pull/344) Improve deployment log visibility
- [#343](https://github.com/shthed/capy/pull/343) Remove unsupported screenshot artifact
- [#342](https://github.com/shthed/capy/pull/342) Add session kick-off workflow reminder
- [#340](https://github.com/shthed/capy/pull/340) Move AGENTS guide to root, mirror Pages HTML, and relocate planning docs
- [#339](https://github.com/shthed/capy/pull/339) Trim and document remaining CSS
- [#338](https://github.com/shthed/capy/pull/338) Add service worker status and debug logging

### 0.7.2 - 2025-11-23

- [#337](https://github.com/shthed/capy/pull/337) Move AGENTS guide to root and mirror Pages HTML
- [#336](https://github.com/shthed/capy/pull/336) Remove deployment gating for branch deploys
- [#335](https://github.com/shthed/capy/pull/335) Add gh-pages preview cleanup to branch maintenance workflow
- [#334](https://github.com/shthed/capy/pull/334) Handle workflow dispatch triggers in post-deploy tests
- [#333](https://github.com/shthed/capy/pull/333) Improve settings sheet mobile layout
- [#332](https://github.com/shthed/capy/pull/332) Retarget branch cleanup to codex prefix
- [#331](https://github.com/shthed/capy/pull/331) Fix deploy workflow eligibility for PR branches
- [#329](https://github.com/shthed/capy/pull/329) Remove README link from help panel
- [#328](https://github.com/shthed/capy/pull/328) Add rerun Pages deploy button to PR comments
- [#327](https://github.com/shthed/capy/pull/327) Improve branch cleanup logging and cutoff

### 0.7.1 - 2025-11-21

- [#326](https://github.com/shthed/capy/pull/326) Add manual dispatch for branch deploys and rerun button
- [#325](https://github.com/shthed/capy/pull/325) Fix settings tab layout wrappers
- [#324](https://github.com/shthed/capy/pull/324) Refactor render.js to lean SVG renderer
- [#323](https://github.com/shthed/capy/pull/323) Add merge conflict handling checklist
- [#322](https://github.com/shthed/capy/pull/322) Synchronize modular renderer refactor with updated deployment workflows
- [#321](https://github.com/shthed/capy/pull/321) Clarify git remote and rebase expectations
- [#320](https://github.com/shthed/capy/pull/320) Handle preview screenshot failures gracefully
- [#318](https://github.com/shthed/capy/pull/318) Fix deploy workflow environment expression
- [#317](https://github.com/shthed/capy/pull/317) Enhance post-deploy Playwright coverage
- [#316](https://github.com/shthed/capy/pull/316) Adjust deploy workflow environment per branch

### 0.7.0 - 2025-11-21

- [#315](https://github.com/shthed/capy/pull/315) Stabilize settings toggle and mute test network noise
- [#314](https://github.com/shthed/capy/pull/314) Simplify settings bootstrap with JSON export
- [#313](https://github.com/shthed/capy/pull/313) Update deployment documentation
- [#312](https://github.com/shthed/capy/pull/312) Add feedback form with analytics reporting
- [#311](https://github.com/shthed/capy/pull/311) Improve deploy reporting and always deploy
- [#310](https://github.com/shthed/capy/pull/310) Add global error toast for runtime failures
- [#309](https://github.com/shthed/capy/pull/309) Allow deploy workflow on all branches
- [#308](https://github.com/shthed/capy/pull/308) Adopt templating helper for save manager UI
- [#307](https://github.com/shthed/capy/pull/307) Simplify post-deploy preview comment
- [#305](https://github.com/shthed/capy/pull/305) Auto prune stale Pages previews

### 0.6.3 - 2025-11-18

- [#303](https://github.com/shthed/capy/pull/303) Remove legacy autosave migration
- [#302](https://github.com/shthed/capy/pull/302) Add settings sheet toggle test
- [#301](https://github.com/shthed/capy/pull/301) Add drag deadzone for settings launcher
- [#298](https://github.com/shthed/capy/pull/298) Move cleanup script into project scripts
- [#296](https://github.com/shthed/capy/pull/296) Document deploy workflow env guardrails
- [#295](https://github.com/shthed/capy/pull/295) Adopt rich save preview cards and flattened sticky settings layout
- [#294](https://github.com/shthed/capy/pull/294) Remove job-level environment context reference from deploy sync step
- [#292](https://github.com/shthed/capy/pull/292) Update README with offline and local dev notes
- [#291](https://github.com/shthed/capy/pull/291) Compute deploy workflow concurrency group directly without env context
- [#290](https://github.com/shthed/capy/pull/290) Add terminal output guidance to onboarding

### 0.6.2 - 2025-11-16

- [#288](https://github.com/shthed/capy/pull/288) Refactor UI wiring into components
- [#287](https://github.com/shthed/capy/pull/287) Make branch cleanup asynchronous
- [#286](https://github.com/shthed/capy/pull/286) Optimize GitHub Pages deployment speed
- [#284](https://github.com/shthed/capy/pull/284) Refine developer onboarding guidance
- [#283](https://github.com/shthed/capy/pull/283) Add organic superpixel generator
- [#282](https://github.com/shthed/capy/pull/282) Add project roadmap and TODO tracking
- [#280](https://github.com/shthed/capy/pull/280) Add offline caching and local file access
- [#279](https://github.com/shthed/capy/pull/279) Add simplicity guidance to workflow instructions
- [#278](https://github.com/shthed/capy/pull/278) Consolidate runtime bootstrap into single module
- [#277](https://github.com/shthed/capy/pull/277) Extract runtime styles into stylesheet

### 0.6.1 - 2025-11-16

- [#276](https://github.com/shthed/capy/pull/276) Fix branch cleanup ref encoding
- [#275](https://github.com/shthed/capy/pull/275) Combine renderer performance updates and testing stack
- [#274](https://github.com/shthed/capy/pull/274) Handle WebGL label cache updates for UI scale changes
- [#273](https://github.com/shthed/capy/pull/273) Update TECH.md for modular runtime documentation
- [#272](https://github.com/shthed/capy/pull/272) Update Playwright setup script workflow
- [#270](https://github.com/shthed/capy/pull/270) Organize runtime assets under dedicated directory
- [#269](https://github.com/shthed/capy/pull/269) Add unit tests for render controller fallbacks
- [#264](https://github.com/shthed/capy/pull/264) Add documentation for helper scripts
- [#262](https://github.com/shthed/capy/pull/262) Run branch cleanup after deployments
- [#261](https://github.com/shthed/capy/pull/261) Refresh TECH.md test harness and branch deployment documentation

### 0.6.0 - 2025-11-15

- [#260](https://github.com/shthed/capy/pull/260) Restructure repository around project workspace
- [#259](https://github.com/shthed/capy/pull/259) Reuse counters for tiny region merging
- [#258](https://github.com/shthed/capy/pull/258) Center active palette colour
- [#257](https://github.com/shthed/capy/pull/257) Unify settings, generator, saves, and help into one menu
- [#256](https://github.com/shthed/capy/pull/256) Add nearby difficulty that auto-selects adjacent colours
- [#255](https://github.com/shthed/capy/pull/255) Refactor neighbor iteration in segmentation routines
- [#254](https://github.com/shthed/capy/pull/254) Optimize smoothing histogram reuse
- [#252](https://github.com/shthed/capy/pull/252) Allow dots in post-deploy slug derivation
- [#251](https://github.com/shthed/capy/pull/251) Fix post-deploy artifact naming sanitization
- [#250](https://github.com/shthed/capy/pull/250) Ensure Playwright browsers install with docs

### 0.5.3 - 2025-11-15

- [#249](https://github.com/shthed/capy/pull/249) Simplify branch overview page
- [#248](https://github.com/shthed/capy/pull/248) Restore stable renderer pipeline with performance logging
- [#245](https://github.com/shthed/capy/pull/245) Persist palette sort preference
- [#244](https://github.com/shthed/capy/pull/244) Improve zoom smoothness with compositor-driven scaling
- [#243](https://github.com/shthed/capy/pull/243) Flush autosave on page lifecycle events
- [#242](https://github.com/shthed/capy/pull/242) Fix WebGL label rendering
- [#241](https://github.com/shthed/capy/pull/241) Add branch slug preparation job to post-deploy tests workflow
- [#240](https://github.com/shthed/capy/pull/240) Adjust zoom defaults and expose configurable max zoom
- [#239](https://github.com/shthed/capy/pull/239) Preserve palette numbering when colours complete
- [#238](https://github.com/shthed/capy/pull/238) Fix UI scale flash during boot

### 0.5.2 - 2025-10-26

- [#237](https://github.com/shthed/capy/pull/237) Rename palette sort label and renumber swatches
- [#236](https://github.com/shthed/capy/pull/236) Switch CI workflow to Ubuntu runners
- [#235](https://github.com/shthed/capy/pull/235) Limit Playwright smoke test to Chromium page load
- [#234](https://github.com/shthed/capy/pull/234) Simplify Pages deployment workflow
- [#233](https://github.com/shthed/capy/pull/233) Enhance palette sorting with spectrum and warmth modes
- [#232](https://github.com/shthed/capy/pull/232) Prefer autosave when restoring sessions
- [#231](https://github.com/shthed/capy/pull/231) Sanitize post-deploy concurrency group branch names
- [#230](https://github.com/shthed/capy/pull/230) Improve region label placement and sizing
- [#229](https://github.com/shthed/capy/pull/229) Improve region label placement with polylabel
- [#228](https://github.com/shthed/capy/pull/228) Fix settings persistence when no puzzle is loaded

### 0.5.1 - 2025-10-25

- [#227](https://github.com/shthed/capy/pull/227) Render region numbers continuously across all zoom levels
- [#226](https://github.com/shthed/capy/pull/226) Remove user settings from exported save files
- [#225](https://github.com/shthed/capy/pull/225) Fix post-deploy workflow concurrency expression
- [#224](https://github.com/shthed/capy/pull/224) Configure Playwright UI review artifacts
- [#223](https://github.com/shthed/capy/pull/223) Streamline Playwright smoke test for quick load check
- [#222](https://github.com/shthed/capy/pull/222) Improve remote image URL workflow
- [#221](https://github.com/shthed/capy/pull/221) Add support for loading puzzles from external image URLs
- [#220](https://github.com/shthed/capy/pull/220) Adjust region label layout to respect zoom ratio
- [#219](https://github.com/shthed/capy/pull/219) Support zoom-aware region label layout
- [#217](https://github.com/shthed/capy/pull/217) Persist user settings in browser storage

### 0.5.0 - 2025-10-24

- [#216](https://github.com/shthed/capy/pull/216) Fix right-click select colour when pan drag is configured
- [#215](https://github.com/shthed/capy/pull/215) Default to medium detail with larger regions
- [#214](https://github.com/shthed/capy/pull/214) Revamp Manage Saves autosave slot layout
- [#212](https://github.com/shthed/capy/pull/212) Render puzzles over stored base image
- [#211](https://github.com/shthed/capy/pull/211) Add compact puzzle export option
- [#210](https://github.com/shthed/capy/pull/210) Add tabbed settings layout and refine UI scale defaults
- [#209](https://github.com/shthed/capy/pull/209) Fix WebGL fill updates and refine zoom controls
- [#208](https://github.com/shthed/capy/pull/208) Add renderer selector UI and SVG backend
- [#207](https://github.com/shthed/capy/pull/207) Ensure branch deployments include JSON assets
- [#206](https://github.com/shthed/capy/pull/206) Include all root JS assets in branch deploys

### 0.4.3 - 2025-10-21

- [#205](https://github.com/shthed/capy/pull/205) Expand interface scale limits
- [#204](https://github.com/shthed/capy/pull/204) Include JS assets in branch deployments
- [#203](https://github.com/shthed/capy/pull/203) Add textured passes to WebGL renderer
- [#202](https://github.com/shthed/capy/pull/202) Ensure allow_without_pr input is evaluated correctly
- [#201](https://github.com/shthed/capy/pull/201) Fix deploy workflow expressions for manual inputs
- [#200](https://github.com/shthed/capy/pull/200) Fix branch deploy workflow env quoting
- [#199](https://github.com/shthed/capy/pull/199) Ensure post-deploy tests install Playwright browsers
- [#198](https://github.com/shthed/capy/pull/198) Restore Playwright UI smoke coverage
- [#197](https://github.com/shthed/capy/pull/197) Add WebGL renderer implementation
- [#196](https://github.com/shthed/capy/pull/196) Stabilize UI smoke tests with automation helpers

### 0.4.2 - 2025-10-20

- [#195](https://github.com/shthed/capy/pull/195) Document renderer controller and active Playwright smoke run
- [#194](https://github.com/shthed/capy/pull/194) Add hint type toggles to settings sheet
- [#193](https://github.com/shthed/capy/pull/193) Add Playwright tests for painting and save completion
- [#192](https://github.com/shthed/capy/pull/192) Allow manual deploys to target any branch
- [#191](https://github.com/shthed/capy/pull/191) Synchronize work branch with updated deployment workflows and scripts
- [#188](https://github.com/shthed/capy/pull/188) Add post-deploy branch smoke tests workflow
- [#187](https://github.com/shthed/capy/pull/187) Use fetch to build deployment metadata
- [#186](https://github.com/shthed/capy/pull/186) Add multiple puzzle generation algorithms and documentation updates
- [#185](https://github.com/shthed/capy/pull/185) Point deployment environment URL to branch preview
- [#184](https://github.com/shthed/capy/pull/184) Allow pan and zoom gestures from viewport margins

### 0.4.1 - 2025-10-18

- [#183](https://github.com/shthed/capy/pull/183) Use GitHub Markdown API for README builds
- [#181](https://github.com/shthed/capy/pull/181) Modularize puzzle renderer via controller abstraction
- [#180](https://github.com/shthed/capy/pull/180) Rewrite README for player-focused guidance
- [#179](https://github.com/shthed/capy/pull/179) Hide puzzle outlines for filled regions
- [#178](https://github.com/shthed/capy/pull/178) Harden branch deployment workflow data handling
- [#177](https://github.com/shthed/capy/pull/177) Fix deploy workflow by moving inline scripts to dedicated files
- [#176](https://github.com/shthed/capy/pull/176) Fix deploy workflow heredoc terminators
- [#175](https://github.com/shthed/capy/pull/175) Use actions/deploy-pages v4
- [#174](https://github.com/shthed/capy/pull/174) Fix deploy workflow README conversion block indentation
- [#173](https://github.com/shthed/capy/pull/173) Fix deploy workflow manifest JSON generation

### 0.4.0 - 2025-10-17

- [#172](https://github.com/shthed/capy/pull/172) Prune inactive branch deployments during Pages sync
- [#171](https://github.com/shthed/capy/pull/171) Update GitHub Actions deploy-pages workflow action from v4 to v5
- [#170](https://github.com/shthed/capy/pull/170) Revamp branch deployment index layout with compact timeline rows
- [#169](https://github.com/shthed/capy/pull/169) Fix README core asset reference
- [#168](https://github.com/shthed/capy/pull/168) Generate README HTML during branch deployments
- [#167](https://github.com/shthed/capy/pull/167) Limit branch previews to runtime assets
- [#166](https://github.com/shthed/capy/pull/166) Embed hosted README inside help panel
- [#164](https://github.com/shthed/capy/pull/164) Include weekday in branch deployment timestamps
- [#163](https://github.com/shthed/capy/pull/163) Add npm scaffolding and placeholder test runner
- [#162](https://github.com/shthed/capy/pull/162) Add ChatGPT image prompt helper to generator tab

### 0.3.3 - 2025-10-17

- [#161](https://github.com/shthed/capy/pull/161) Improve save management autosave experience
- [#160](https://github.com/shthed/capy/pull/160) Auto-start generation and relocate saves export
- [#159](https://github.com/shthed/capy/pull/159) Improve mobile gesture responsiveness
- [#158](https://github.com/shthed/capy/pull/158) Add reset progress button to save manager
- [#157](https://github.com/shthed/capy/pull/157) Simplify branch deploy index cards
- [#156](https://github.com/shthed/capy/pull/156) Streamline branch deploy index metadata
- [#155](https://github.com/shthed/capy/pull/155) Align main and preview commit metadata in branch deployment listings
- [#154](https://github.com/shthed/capy/pull/154) Localize branch deployment commit timestamps to 12-hour browser time
- [#153](https://github.com/shthed/capy/pull/153) Remove onboarding start hint and add quick start actions to Saves sheet
- [#152](https://github.com/shthed/capy/pull/152) Improve branch deployment summary layout

### 0.3.2 - 2025-10-16

- [#151](https://github.com/shthed/capy/pull/151) Document branch update workflow
- [#150](https://github.com/shthed/capy/pull/150) Fix deploy workflow heredoc indentation
- [#149](https://github.com/shthed/capy/pull/149) Render branch deployment dashboard metadata via jq pipeline
- [#148](https://github.com/shthed/capy/pull/148) Replace jq branch page generation with Node
- [#147](https://github.com/shthed/capy/pull/147) Restore branch index metadata generation and open-PR deploy gating
- [#144](https://github.com/shthed/capy/pull/144) Prevent branch deployments without open PRs
- [#142](https://github.com/shthed/capy/pull/142) Include PR links in branch deployment dashboard
- [#140](https://github.com/shthed/capy/pull/140) Require import confirmation and show progress inside generator sheet
- [#139](https://github.com/shthed/capy/pull/139) Remove idle Ready to paint status line
- [#137](https://github.com/shthed/capy/pull/137) Simplify branch deployments

### 0.3.1 - 2025-10-15

- [#136](https://github.com/shthed/capy/pull/136) Restrict status bar to generation progress
- [#135](https://github.com/shthed/capy/pull/135) Enable concurrency cancellation for GitHub Pages deployments to prevent 400 errors
- [#130](https://github.com/shthed/capy/pull/130) Fix GitHub Pages deployment workflow failure caused by rsync removing .git directory
- [#129](https://github.com/shthed/capy/pull/129) Fix gh-pages deployment failure by auto-recovering from invalid git repository state
- [#128](https://github.com/shthed/capy/pull/128) Prevent branch deployment cleanup job failures on missing directories
- [#127](https://github.com/shthed/capy/pull/127) Update git remote guidance
- [#126](https://github.com/shthed/capy/pull/126) Streamline command rail buttons
- [#123](https://github.com/shthed/capy/pull/123) Improve tooltip contrast for light palette colors
- [#122](https://github.com/shthed/capy/pull/122) Enhance hint highlights and add easy difficulty
- [#121](https://github.com/shthed/capy/pull/121) Review and update branch-deployments.md documentation for accuracy

### 0.3.0 - 2025-10-14

- [#119](https://github.com/shthed/capy/pull/119) Add clickable commit and PR links to branch deployment history
- [#118](https://github.com/shthed/capy/pull/118) Enhance branch deployment with commit and PR links in Recent History
- [#117](https://github.com/shthed/capy/pull/117) Implement shared save metadata templates
- [#116](https://github.com/shthed/capy/pull/116) Fix gh-pages cache validation to prevent "fatal: not in a git directory" errors
- [#115](https://github.com/shthed/capy/pull/115) Enhance GitHub Pages branch deployment workflow with commit history and timezone conversion
- [#114](https://github.com/shthed/capy/pull/114) Restore project links at the top of README.md
- [#113](https://github.com/shthed/capy/pull/113) Unify start screen and save manager
- [#112](https://github.com/shthed/capy/pull/112) Ensure preview render matches puzzle scale
- [#111](https://github.com/shthed/capy/pull/111) Add configurable hint fade, intensity, and right-click color selection
- [#110](https://github.com/shthed/capy/pull/110) Restore capy.json and add fallback puzzle metadata

### 0.2.3 - 2025-10-13

- [#109](https://github.com/shthed/capy/pull/109) Simplify preview mode to color canvas in place
- [#105](https://github.com/shthed/capy/pull/105) Ensure palette swatches respond to right-click
- [#104](https://github.com/shthed/capy/pull/104) Add region label support and palette-colored hint flashes
- [#103](https://github.com/shthed/capy/pull/103) Add configurable region flash durations and hover hint previews
- [#102](https://github.com/shthed/capy/pull/102) Allow right-click palette selection
- [#101](https://github.com/shthed/capy/pull/101) Improve tap hit-testing performance by caching canvas bounds
- [#100](https://github.com/shthed/capy/pull/100) Add toggle to control status bar visibility
- [#99](https://github.com/shthed/capy/pull/99) Speed up wrong-color hint flashes and highlight matching regions on tap
- [#98](https://github.com/shthed/capy/pull/98) Reconcile touch tap responsiveness handlers in index.html
- [#97](https://github.com/shthed/capy/pull/97) Optimize deployment workflow for 40-60% faster builds

### 0.2.2 - 2025-10-13

- [#96](https://github.com/shthed/capy/pull/96) Trigger region fills on touch pointer events to remove tap delay
- [#95](https://github.com/shthed/capy/pull/95) Centralize canvas fill validation for touch and click events
- [#94](https://github.com/shthed/capy/pull/94) Render puzzle geometry at zoom scale
- [#93](https://github.com/shthed/capy/pull/93) Add async generation progress feedback and modularize generator
- [#91](https://github.com/shthed/capy/pull/91) Fix touch pan and pinch gesture behavior
- [#90](https://github.com/shthed/capy/pull/90) Optimize outline rendering and allow unlimited zoom
- [#89](https://github.com/shthed/capy/pull/89) Fix palette dock overflow on small viewports
- [#88](https://github.com/shthed/capy/pull/88) Fix command rail layout wrapping
- [#87](https://github.com/shthed/capy/pull/87) Handle command rail wrapping metrics
- [#86](https://github.com/shthed/capy/pull/86) Constrain floating command rail within right safe-area inset

### 0.2.1 - 2025-10-11

- [#85](https://github.com/shthed/capy/pull/85) Fix command rail overflow on narrow viewports
- [#84](https://github.com/shthed/capy/pull/84) Simplify play surface layout
- [#82](https://github.com/shthed/capy/pull/82) Fix branch index to save to branch.html instead of index.html
- [#81](https://github.com/shthed/capy/pull/81) Prioritize main branch deployment and list PR metadata on branch index
- [#80](https://github.com/shthed/capy/pull/80) Hide completed colours and shrink UI scale
- [#79](https://github.com/shthed/capy/pull/79) Optimize deploy-branch workflow execution performance
- [#78](https://github.com/shthed/capy/pull/78) Enable double-click sampling of puzzle colours
- [#77](https://github.com/shthed/capy/pull/77) Summarize local save storage in help and drop cloud sync
- [#76](https://github.com/shthed/capy/pull/76) Add region number visibility toggle
- [#75](https://github.com/shthed/capy/pull/75) Add GitHub Copilot repository instructions

### 0.2.0 - 2025-10-09

- [#72](https://github.com/shthed/capy/pull/72) Apply edge-to-edge flat palette swatch layout to index.html
- [#71](https://github.com/shthed/capy/pull/71) Show original artwork behind regions and streamline colour selection
- [#69](https://github.com/shthed/capy/pull/69) Adopt edge-to-edge palette swatch styling and safe-area padding
- [#68](https://github.com/shthed/capy/pull/68) Refine luminance-based swatch label contrast presets
- [#67](https://github.com/shthed/capy/pull/67) Fix deploy-branch workflow to push newly initialized gh-pages branch
- [#66](https://github.com/shthed/capy/pull/66) Fix git authentication in deploy-branch.yml workflow
- [#65](https://github.com/shthed/capy/pull/65) Configure git credentials in deploy-branch workflow
- [#63](https://github.com/shthed/capy/pull/63) Update deploy-branch workflow to use index.html instead of branchindex.html
- [#62](https://github.com/shthed/capy/pull/62) Flatten palette dock into edge-to-edge swatches with adaptive contrast
- [#60](https://github.com/shthed/capy/pull/60) Streamline palette dock to swatches only

### 0.1.3 - 2025-10-08

- [#59](https://github.com/shthed/capy/pull/59) Fix authentication for deploy-branch job using GITHUB_TOKEN
- [#58](https://github.com/shthed/capy/pull/58) Collapse command rail into responsive icon buttons and harden zoom guard
- [#56](https://github.com/shthed/capy/pull/56) Document resolved zoom guard handler structure in merge conflict report
- [#55](https://github.com/shthed/capy/pull/55) Simplify Playwright smoke tests for faster runs
- [#54](https://github.com/shthed/capy/pull/54) Fix deploy-branch workflow to handle missing gh-pages branch
- [#53](https://github.com/shthed/capy/pull/53) Enhance palette focus and responsive command rail
- [#52](https://github.com/shthed/capy/pull/52) Add horizontal wheel scrolling and status copy to palette dock
- [#51](https://github.com/shthed/capy/pull/51) Strip stray UTF-8 BOM from package.json and add ripgrep ignore rules
- [#50](https://github.com/shthed/capy/pull/50) Improve viewport sizing and zoom handling
- [#49](https://github.com/shthed/capy/pull/49) Refresh contributor onboarding guidance

### 0.1.2 - 2025-10-07

- [#48](https://github.com/shthed/capy/pull/48) Add custom cursor tooltip for puzzle regions
- [#44](https://github.com/shthed/capy/pull/44) Add automatic GitHub Pages deployment for all branches
- [#42](https://github.com/shthed/capy/pull/42) Trim unused assets and refresh documentation
- [#41](https://github.com/shthed/capy/pull/41) Improve region label readability and palette hints
- [#39](https://github.com/shthed/capy/pull/39) Add sample detail presets, UI scale controls, and mobile zoom guard
- [#38](https://github.com/shthed/capy/pull/38) Reconcile autosave and cloud-sync gameplay session documentation
- [#37](https://github.com/shthed/capy/pull/37) Improve DOM rendering for save list entries
- [#34](https://github.com/shthed/capy/pull/34) Document upstream git remote
- [#33](https://github.com/shthed/capy/pull/33) Derive export titles from source metadata
- [#30](https://github.com/shthed/capy/pull/30) Add sample detail presets and region legend

### 0.1.1 - 2025-10-06

- [#29](https://github.com/shthed/capy/pull/29) Add autosave restore flow and cloud backup sync
- [#28](https://github.com/shthed/capy/pull/28) Guard pan move updates without a loaded puzzle
- [#27](https://github.com/shthed/capy/pull/27) Allow touch pans without blocking taps
- [#26](https://github.com/shthed/capy/pull/26) Enhance capybara sample illustration
- [#23](https://github.com/shthed/capy/pull/23) Add generator test hooks and end-to-end Playwright review suite
- [#20](https://github.com/shthed/capy/pull/20) Rebuild fullscreen drop interface for puzzle generator
- [#19](https://github.com/shthed/capy/pull/19) Flash palette hint when tapping wrong colors
- [#18](https://github.com/shthed/capy/pull/18) Add terraced market starter art
- [#17](https://github.com/shthed/capy/pull/17) Remove redundant header buttons and stabilize drag panning
- [#16](https://github.com/shthed/capy/pull/16) Document starter scene regression checks in PR review notes

### 0.1.0 - 2025-10-04

- [#15](https://github.com/shthed/capy/pull/15) Update smoke test alias to target UI review harness
- [#14](https://github.com/shthed/capy/pull/14) Restore Babel runtime and unblock starter art loading
- [#11](https://github.com/shthed/capy/pull/11) Preserve stored starter titles when merging updates
- [#10](https://github.com/shthed/capy/pull/10) Bundle Lagoon starter scenes and add local art library
- [#9](https://github.com/shthed/capy/pull/9) Streamline canvas toolbar interactions
- [#8](https://github.com/shthed/capy/pull/8) Refine lagoon segmentation and unblock progress
- [#6](https://github.com/shthed/capy/pull/6) Enable SVG artwork imports and refresh help content
- [#5](https://github.com/shthed/capy/pull/5) Refine capybara art layout
- [#3](https://github.com/shthed/capy/pull/3) Surface README overview through an in-app options panel
- [#1](https://github.com/shthed/capy/pull/1) Build simple color-by-number web app
