### 3.1.3 - 2026-11-26 (Production, Beta)

- [#662](../../pull/662) Remove the victory confetti burst and `canvas-confetti` dependency on puzzle completion, keeping the golden 100% badge and automatic chronological timelapse replay
- [#661](../../pull/661) Refresh the README with high-DPI screenshots, an animated puzzle-completion timelapse showcase, and a cleaner player-focused feature overview

### 3.1.2 - 2026-11-23

- [#657](../../pull/657) Remove the redundant TODO.md backlog file and slim ROADMAP.md into a concise Now, Next, and Later vision doc linked to GitHub Issues and CHANGELOG.md
- [#655](../../pull/655) Update Android Gradle plugin (9.5.2), `fragment-ktx` (1.9.1), and Gradle wrapper (9.9.2)
- [#654](../../pull/654) Update web dependencies `lucide-react` (1.77.0), `tailwind-merge` (3.7.1), and `playwright` (1.65.1)

### 3.1.1 - 2026-11-22

- [#651](../../pull/651) Retire umbrella GitHub Epic tracking issues and epic label rules, standardizing planning around ROADMAP.md milestones and focused GitHub Issues
- [#650](../../pull/650) Parallelized the 24-stage Playwright E2E suite across 10 isolated worker suites with targeted `--suite`/`--smoke` CLI controls, smart tiered CI path gating, and unblocked Alpha/Beta Pages previews
- [#649](../../pull/649) Complete Stage 5 modularization by extracting tutorial/offers, viewport/shortcuts, paint controller, snapshot library hooks, and artwork exporter from App.tsx
- [#648](../../pull/648) Extracted cloud library and active-slot sync controller, auto-sync scheduler, and startup auth sync effects from App.tsx into useCloudSyncController wired via ProviderContext with resetEpoch reconciliation and fast unit tests
- [#646](../../pull/646) Extracted Co-op session management, room subscriptions, seed-token sync, and share-link actions from App.tsx into useCoopSession wired via ProviderContext with reportSwallowed telemetry and fast unit tests
- [#645](../../pull/645) Extracted undo/redo history management and animated replay playback from App.tsx into dedicated useUndoRedo and useReplayController hooks with pure transition and zero-allocation viewport-follow helpers plus fast unit tests
- [#644](../../pull/644) Extracted app-launch session restoration into a modular, AbortController-guarded 4-phase pipeline and useSessionRestore hook with unit tests covering share-link merges, active snapshot hydration, cache-eviction fallback, starter bootstrap, and cancellation
- [#642](../../pull/642) Modularized the web unit, release-hardening, and browser E2E test suites into domain modules, replaced Python workflow/manifest test subprocesses with pure Node.js parsers, and swapped fixed E2E sleeps for deterministic waits
- [#640](../../pull/640) Eliminated unnecessary zoom re-renders, deduplicated ColorPickerPopover back-button handling, replaced render-time ref mirrors with useLatest, memoized hot child callbacks, and unified paint completion and persistence into finishPaintStroke
- [#639](../../pull/639) Optimized puzzle engine memory and canvas hot paths with reusable RegionSegmenter BFS buffers, multi-centroid K-Means++ distance initialization, symmetric LineArtExtractor watershed seeding, single-buffer worker pixel transfers, and zero-allocation PuzzleCanvas tap-dot/highlight/wheel/gesture updates
- [#638](../../pull/638) Hardened Co-op relay rooms against unjoined eavesdropping, duplicate player spoofing, and slot squatting while adding server-issued host tokens, automatic host handoff on disconnect, deferred room storage, dynamic health hostname, and declarative frame validation
- [#637](../../pull/637) Decomposed Android CapyAndroidBridge into four internal delegates, offloaded Play Games snapshot I/O off the UI thread, hardened incoming ACTION_SEND image validation and shareFile exports, allowlisted capy_saves in Auto Backup rules, and made consumePending bridge reads atomic
- [#636](../../pull/636) Decomposed SettingsModal into focused per-tab modules, reusable toggle/slider/save-card primitives, and preset gallery data while completing dialog aria-labelledby, focus restoration on close, and accessible slider labeling
- [#635](../../pull/635) Decompose `ProviderRegistry` into focused auth, cloud sync, Co-op, and catalog domain modules, enforce per-slot deletion tombstones and cross-account `signOut()` isolation, harden OAuth 401/One Tap validation, Drive 404 retry, and Co-op wire whitelisting, and instrument swallowed catches with `reportSwallowed`

### 3.1.0 - 2026-11-22

- [#632](../../pull/632) Add a Browser Storage analyzer and targeted cleanup tool in Saves, automatically prune stale preview caches and slim down initial offline precaching, and compress oversized custom photo uploads to minimize browser storage usage
- [#631](../../pull/631) Harden Content-Security-Policy and XSS defenses across Cloudflare `_headers`, Vite build-time `<meta>` CSP, standalone HTML pages, Worker API responses, OAuth/Feedback/Avatar URL validation, and Android WebView asset headers and `JSON.parse` bridge delivery
- [#628](../../pull/628) Keep the interactive tutorial docked above Settings with live tab and control guidance, stabilize the Next button position across early tips, regroup Accessibility first with UI and Hints sections, and add independent Text Size and UI Size sliders

### 3.0.9 - 2026-11-21

- [#627](../../pull/627) Decompose the browser storage layer into focused modules, fail closed on IndexedDB quota and reclaimed-handle errors, lift the multi-puzzle `.capy` archive limit to 256 MiB, enforce legacy puzzle pixel bounds, centralize `localStorage` access, and clear Android stats backups on reset
- [#622](../../pull/622) Pass OAuth build variables into `Playwright E2E`, gate `main` Production Pages deploys and `beta -> main` auto-merges on `Playwright E2E` and `Android APK`, guard stacked-PR merge fallbacks with `headChecksGreen()`, and retire the completed one-time issue migration step
- [#621](../../pull/621) Polish Play Store UI with grouped responsive Settings, fixed defaults, 12-step modal-aware Settings and Hints tutorial, larger mobile touch targets with full ARIA accessibility, US English copy, and Android edge-to-edge and App Links updates
- [#620](../../pull/620) Keep the fast-forward skip button visible (disabled at replay end) in ReplayControls so the replay scrubber and action buttons never shift horizontally when playback finishes
- [#619](../../pull/619) Eliminate the Android Play Games `game_services_project_id` AAPT2 duplicate-resource conflict, disable cleartext HTTP on Android 7--8, split App Links `autoVerify` onto `capypaint.com` and `paint.capyboop.com`, and redirect `/capy.apk` to the public `capyboop/paint` release

### 3.0.8 - 2026-11-20

- [#612](../../pull/612) Reorganize repository documentation and harden CI workflow checks
- [#610](../../pull/610) Standardize changelog formatting with sequential daily versions (`3.0.2`--`3.0.8`), leading PR links, and concise 1--2 sentence bullets, plus tooling, GitHub Releases gating, `SECURITY.md`, and project documentation sync
- [#608](../../pull/608) Omit region boundary lines on completed regions so finished artwork renders seamlessly while unpainted regions keep crisp borders
- [#604](../../pull/604) Add Bring-Your-Own-Cloud account login and automatic cross-device sync for Microsoft OneDrive, Apple CloudKit, and Google Drive with Android OAuth PKCE support
- [#605](../../pull/605) Scale interactive buttons, icons, sliders, and palette swatches in Large Text mode, enable Fat-Finger assist by default, and fix single-tap double-paint and free-colour repaint regressions
- [#603](../../pull/603) Add an anonymous in-game feedback card in Settings backed by a rate-limited Cloudflare Worker relay with a graceful prefilled fallback
- [#595](../../pull/595) Bind the `paint.capyboop.com` custom domain on Cloudflare Workers and allowlist it across Co-op relay, channel detection, and CSP headers
- [#601](../../pull/601) Rename the Android package, namespace, FileProvider authority, and store/architecture docs from `com.capypaint.capy` to `com.capyboop.paint`
- [#602](../../pull/602) Add Fat-Finger Mode with configurable touch reach radius presets (`12px`, `22px`, `34px`) and zero-allocation radial near-miss hit-testing on small regions

### 3.0.7 - 2026-11-19

- [#598](../../pull/598) Align the root `README.md` heading (`# Capy Paint`) with the standalone `capyboop/paint` repository
- [#596](../../pull/596) Retarget the public repository links, in-app Report Bug / Ideas link, privacy policy, and project docs to `capyboop/paint`
- [#590](../../pull/590) Allow the top-bar puzzle save title pill to expand across available left-lane width on mobile and desktop instead of truncating at fixed caps
- [#589](../../pull/589) Replace the daily puzzle-regeneration cron schedule with on-demand and path-filtered triggers on `beta`
- [#588](../../pull/588) Add `oxlint` guardrails, crash-safe `<ErrorBoundary>` recovery with emergency backup export, and consolidated storage/cloud helpers while migrating brittle source-string tests to behavioral checks
- [#587](../../pull/587) Add public community documentation (`CONTRIBUTING.md`, `SUPPORT.md`, `SECURITY.md`, and PR/issue templates)

### 3.0.6 - 2026-11-18

- [#579](../../pull/579) Harden CSP/HSTS headers, service worker caching, local storage schema validation, Co-op burst sync and Worker rate limits, and Android WebView security invariants
- [#578](../../pull/578) Promote Production channel markers, update the Play Store listing metadata, and align CI check titles and roadmap docs for release
- [#577](../../pull/577) Harden local and native backup durability with monotonic timestamps, separated backup/heal retry queues, and empty-overwrite protection across Web, iOS, and Android
- [#576](../../pull/576) Gracefully skip tag-triggered Android release builds when signing secrets are absent and harden release export filtering and origin checks
- [#575](../../pull/575) Add public GitHub issue templates and an About-tab Report Bug / Ideas button linking directly to the public issue tracker
- [#573](../../pull/573) Fix high-resolution `maxRegions` segmentation overflow with a binary min-heap, regenerate Max-detail sample and daily `.capy` archives, and polish Create-tab preset controls and tooltips
- [#571](../../pull/571) Remove legacy rewarded-ad UI hooks, replace placeholder community votes with a local Puzzle Idea Notebook, gate Android startup prompts, and refresh Play Store screenshots

### 3.0.5 - 2026-11-16

- [#569](../../pull/569) Fix intermittent Play Daily E2E failures by waiting for the prebaked daily snapshot to mount before asserting
- [#568](../../pull/568) Update changelog channel markers for the Production release promotion
- [#566](../../pull/566) Fix signed Android release `lintVitalRelease` failures by pinning `androidx.fragment:fragment-ktx` `1.8.9` and running release lint in per-PR Android CI
- [#565](../../pull/565) Pre-generate Max-detail sample and rolling daily `.capy` archives with selective zero-wait loading, and add tap-friendly Create-tab style hints and tooltips
- [#563](../../pull/563) Standardize unit and E2E test stage numbering with execution-count assertions, opt-in screenshot capture, and isolated subprocess environments
- [#550](../../pull/550) Enable Cloudflare Worker deployment directly from CI with health-check retries, remove redundant `_redirects` rules, and document Cloudflare Workers setup
- [#560](../../pull/560) Improve CI merge workflow handling when branch rulesets block auto-merge after required checks pass
- [#559](../../pull/559) Update changelog channel markers and sync roadmap docs for the Production release promotion
- [#557](../../pull/557) Add an interactive Preset Style Gallery with 10 real segmented previews in the Create tab, sync manual palette counts to `Custom`, and add a matching tutorial step
- [#555](../../pull/555) Set default colour mode to Original Detail and default palette sort order to Rainbow / Hue
- [#554](../../pull/554) Keep replay controls in the compact single-row scrubber bar by removing the expandable two-row deck toggle
- [#553](../../pull/553) Improve CI workflow handling for stacked pull requests and draft checklist validation
- [#548](../../pull/548) Update changelog channel markers and sync roadmap docs for the Production release promotion
- [#547](../../pull/547) Hide unfinished Cloud/Co-op UI behind opt-in dev flags while keeping share links and printable SVG visible, and add Google Play Store assets and listing copy

### 3.0.4 - 2026-11-15

- [#546](../../pull/546) Reconcile Production and Beta changelog channels and archive shipped Epic 2 pull requests in `ROADMAP.md`
- [#545](../../pull/545) Declare Android TV Leanback launcher support with a TV banner, update the privacy policy for 100% ad-free builds, and expand Android TV and CI workflow tests
- [#544](../../pull/544) Add repository environment setup configuration and update cloud and roadmap docs with clickable production domain links
- [#540](../../pull/540) Wait two animation frames after wheel zoom in E2E tests to eliminate a viewport-save debounce race before reload
- [#539](../../pull/539) Replace brittle fixed sleeps across the E2E suite with deterministic Playwright locator, attribute, IndexedDB, and URL-hash waits
- [#537](../../pull/537) Target Android API 36 with edge-to-edge insets, hardened WebView navigation, isolated share cache cleanup, cold-start bridge queuing, and release-signing secret checks
- [#535](../../pull/535) Offload save thumbnails to IndexedDB with quota alerts, optimize canvas rendering and HUD memoization, code-split the puzzle generator, and harden Co-op checkpoints
- [#534](../../pull/534) Harden PR workflow validation, include `.well-known/assetlinks.json` in GitHub Pages deploys, and improve deployment sync reliability
- [#530](../../pull/530) Preserve active puzzle progress across debounced and `beforeunload` viewport saves, remove idle spotlight polling, and speed up CI with async heavy jobs

### 3.0.3 - 2026-11-14

- [#523](../../pull/523) Add a non-blocking `TargetSpotlightOverlay` ring and arrow across all 14 tutorial steps and 9 feature tips, plus tighter mobile top-bar fit and synchronous Co-op state updates
- [#519](../../pull/519) Upgrade the onboarding tutorial to a 14-step interactive guide with topic jumping and 9 contextual feature-offer tips
- [#518](../../pull/518) Add Low-Vision Large Text accessibility mode, keep the palette dock sorted and centered when scrollable, and enable Undo by default
- [#517](../../pull/517) Keep the palette dock visible above replay controls with swatch auto-dismiss and default the Saves tab to a thumbnail-first layout

### 3.0.2 - 2026-11-13

- [#521](../../pull/521) Add CapyBoop Games studio organization documentation
- [#501](../../pull/501) Promote the beta release to Production
- [#497](../../pull/497) Remove the top-bar zoom pill badge, fix `360px` mobile Settings tab clipping, and add an E2E overflow guard
- [#495](../../pull/495) Isolate alpha/beta preview storage namespaces, harden canvas DPR listeners, add the `.changelog/` fragment compiler, and fix palette accessibility labels
- [#489](../../pull/489) Keep post-load replay controls visible until interaction, set Capy Forest as the default puzzle, add the first-run tutorial, and move the About tab first
- [#491](../../pull/491) Serve the `/capy/alpha/` preview index manifest with `404.html` redirects from legacy `/PR/` and `/pull/` paths
- [#492](../../pull/492) Standardize GitHub Pages PR preview URLs to lowercase `/capy/alpha/<num>/` and prune stale legacy preview directories
- [#494](../../pull/494) Harden CI workflow retries, Playwright caching on beta PRs, main-to-beta syncing, and changelog/guide sanity checks
- [#493](../../pull/493) Establish the `PROJECT.md` governance charter, split `3.0.1` vs `3.0.2` changelog channels, and reconcile Epic backlog links
- [#490](../../pull/490) Add CI workflow automation tests and prebaked sample viewport resets
- [#487](../../pull/487) Add Android Play Store release to `v3.0.1` scope and clear shipped Sprint 1 bugfixes from the active queue

### 3.0.1 - 2026-11-12

- [#488](../../pull/488) Promote v3.0.1 mobile topbar and progress cap fixes to Production
- [#486](../../pull/486) Fix mobile topbar badge overlap, cap incomplete puzzle progress at 99%, and log capypaint.com DNS cutover
- [#485](../../pull/485) Prepare v3.0.0 beta release with Cloudflare Worker, Co-op relay hardening, mobile replay controls, and CI sanity gate

### 2.7 - 2026-11-12

- [#484](../../pull/484) Fix Co-op save and rewind sync, Android large cloud saves, CRDT reset epochs, and mobile replay controls

### 2.6 - 2026-11-12

- [#482](../../pull/482) Add capypaint.com Cloudflare Worker, Co-op relay security hardening, and CI workflow checks

### 2.5 - 2026-11-11

- [#483](../../pull/483) Document 3-artefact roadmap triad, GitHub Epic Issue CLI playbooks, and sprint lifecycle
- [#481](../../pull/481) Add 3-tier Alpha/Beta/Production release pipeline, channel switcher, and GitHub Agile tracking
- [#475](../../pull/475) Add sub-tile parent breadcrumbs, printable SVG sheets, and Co-op undo sync
- [#473](../../pull/473) Split strategic ROADMAP.md from Sprint 1 TODO.md and organize sprint planning documentation
- [#474](../../pull/474) Add daily featured puzzle, reduced motion, keyboard shortcuts, and lifetime stats
- [#472](../../pull/472) Add zoom sensitivity, magnetic zoom stops, and procedural Web Audio tap effects
- [#471](../../pull/471) Fix cache-eviction E2E test, replay speed grid, and atomic Android backups
- [#470](../../pull/470) Standardize TODO.md under Lean Agile epics, stories, and collapsible task specs
- [#467](../../pull/467) Add DEV.md and overhaul repository documentation and privacy policy
- [#469](../../pull/469) Compact changelog headings for mobile, remove preamble, and group same-day patch releases
- [#468](../../pull/468) Standardize historical PR metadata, document changelog rules, and add full PR history
- [#466](../../pull/466) Resolve all remaining audit bugfixes from TODO
- [#465](../../pull/465) Fix resize clamping, IndexedDB palette recovery, and Pixel API 33+ haptics
- [#464](../../pull/464) Add YouTube-style playback scrubber and preserve viewport on replay
- [#463](../../pull/463) Consolidate test suite, enhance save-load replay, and add AAA TODO roadmap

### 2.4 - 2026-11-10

- [#461](../../pull/461) Add modular cloud provider drivers and Google Drive cross-device sync

### 2.3 - 2026-11-10

- [#462](../../pull/462) Fix runtime sample resolution, canvas undo repaint, bundle splitting, and prioritize TODO.md

### 2.2 - 2026-11-10

- [#460](../../pull/460) Add shareable progress links, simultaneous Co-op, CRDT Cloud Sync, and Play Store compliance

### 2.1 - 2026-11-10

- [#459](../../pull/459) Preload sample save archive for instant first-launch gameplay

### 2.0 - 2026-11-10

- [#458](../../pull/458) Add Compact Binary Storage v2 (.capy v2) and fix engine edge cases

### 1.4 - 2026-11-09

- [#457](../../pull/457) Add min/max label size options, guarantee region fit, and redo circle-free hint color
- [#456](../../pull/456) Set Fast Mode puzzle generation progress as default
- [#455](../../pull/455) Show real generation metrics and live palette swatches during segmentation
- [#454](../../pull/454) Add loading progress detail toggle and fast mode

### 1.3 - 2026-11-09

- [#453](../../pull/453) Refine contributor and repository operational documentation
- [#452](../../pull/452) Add PWA offline support and manifest
- [#451](../../pull/451) Document Web engine conventions and development guidelines
- [#450](../../pull/450) Document ci and deps GitHub pull request labels
- [#449](../../pull/449) Add thumbnails grid view, save pinning, and toolbar to Saves gallery

### 1.2 - 2026-11-09

- [#448](../../pull/448) Fix Undo/Redo state synchronization and add post-replay auto-resume
- [#447](../../pull/447) Add undo timeline scrubber and multi-step redo
- [#446](../../pull/446) Add animated puzzle replay and region undo

### 1.1 - 2026-11-09

- [#445](../../pull/445) Add screenshot showcase gallery and capture script
- [#444](../../pull/444) Improve zoom pan gestures and color pickers
- [#443](../../pull/443) Add PR merge approval rule and preview lifecycle docs
- [#442](../../pull/442) Calibrate pan zoom gestures and sync preview assets

### 1.0 - 2026-11-08

- [#441](../../pull/441) Add web architecture documentation
- [#440](../../pull/440) Optimize CI builds and Pages deployment pipeline
- [#439](../../pull/439) Add Free Colour mode, custom palette swatches, and Mushroom Forest sample
- [#438](../../pull/438) Parallelize Web and Android CI workflows and streamline target execution
- [#437](../../pull/437) Update Web dependencies, enable parallel Gradle sync, and add maintenance guides
- [#436](../../pull/436) Add Android WebView debugging, bundle validation, and developer tooling
- [#435](../../pull/435) Realign root architecture documentation and prune completed roadmap items
- [#434](../../pull/434) Add automated closed pull request preview pruning for GitHub Pages
- [#433](../../pull/433) Fix active color sync and auto-pan jumps and add victory celebration export
- [#432](../../pull/432) Unify Web and Android single-codebase architecture with WebViewAssetLoader
- [#431](../../pull/431) Consolidate Web, Legacy Web1, and Android apps into unified monorepo

### 0.9.3 - 2026-09-24

- [#430](../../pull/430) Fix runtime bootstrap scope, default artwork loading, and UI load tests
- [#429](../../pull/429) Rename menu and relocate advanced settings toggle
- [#428](../../pull/428) Fix save manager SVG export handler
- [#427](../../pull/427) Reorder settings tabs around Saves and Create
- [#425](../../pull/425) Add SVG snapshot export to save manager
- [#424](../../pull/424) Fix autosave refresh and smoke coverage
- [#423](../../pull/423) Rework settings header layout
- [#421](../../pull/421) Simplify controls layout in settings menu
- [#420](../../pull/420) Move hint intensity controls to basics tab
- [#419](../../pull/419) Drop raster save artifacts and rebuild maps from vector scenes

### 0.9.2 - 2025-12-05

- [#418](../../pull/418) Wrap mobile settings tabs and update settings-menu.json schema
- [#417](../../pull/417) Reduce settings sheet minimum dimensions and safe-area gaps on mobile
- [#416](../../pull/416) Add configurable region cleanup controls
- [#415](../../pull/415) Lower generator defaults for simpler puzzles
- [#414](../../pull/414) Enforce upload resizing to stay within source image limit
- [#413](../../pull/413) Clarify branch baseline guidance
- [#412](../../pull/412) Render labels with SVG
- [#411](../../pull/411) Remove binary artifact and document policy
- [#410](../../pull/410) Polish vector sample rendering and docs
- [#409](../../pull/409) Add vector scene loader and refresh sample puzzle

### 0.9.1 - 2025-12-04

- [#408](../../pull/408) Handle save quota failures by trimming previews
- [#407](../../pull/407) Fix deploy workflow concurrency scope and env URL
- [#406](../../pull/406) Prefer human-readable region maps
- [#405](../../pull/405) Enhance smoke test logging report
- [#404](../../pull/404) Add render preview support to svg renderer
- [#403](../../pull/403) Handle renderer resize safely
- [#402](../../pull/402) Auto-generate settings sheet from JSON definition
- [#401](../../pull/401) Prune unused runtime modules
- [#400](../../pull/400) Consolidate runtime into capy.js
- [#399](../../pull/399) Summarize processed branches in cleanup workflow

### 0.9.0 - 2025-11-28

- [#398](../../pull/398) Expose runtime APIs as module exports
- [#397](../../pull/397) Rewrite Pages deployment workflow
- [#396](../../pull/396) Temporarily disable service worker and offline cache
- [#395](../../pull/395) Simplify runtime to SVG renderer
- [#394](../../pull/394) Expose runtime API via global object
- [#393](../../pull/393) Preserve gh-pages preview directories during main deploy
- [#392](../../pull/392) Export renderer controller inline
- [#391](../../pull/391) Harden renderer controller fallback
- [#390](../../pull/390) Avoid duplicate createRendererController export
- [#389](../../pull/389) Refresh start hint onboarding UI

### 0.8.3 - 2025-11-28

- [#388](../../pull/388) Restore renderer pipeline and fixtures
- [#387](../../pull/387) Improve renderer wiring and tests
- [#386](../../pull/386) Delete merged branches without cutoff
- [#385](../../pull/385) Refine Playwright skip handling
- [#384](../../pull/384) Enhance branch cleanup diagnostics
- [#383](../../pull/383) Add debug listing to deploy workflow
- [#382](../../pull/382) Refine responsive settings navigation and input control styles
- [#381](../../pull/381) Handle gh-pages root cleanup
- [#380](../../pull/380) Fix deployment artifact path for branch previews
- [#379](../../pull/379) Remove outdated menu screenshot artifact

### 0.8.2 - 2025-11-27

- [#378](../../pull/378) Add responsive tab stacking and themed input controls to settings sheet
- [#377](../../pull/377) Register renderer mode change handler
- [#376](../../pull/376) Add iterative development feedback loop guide
- [#375](../../pull/375) Clarify renderer controller exports
- [#374](../../pull/374) Simplify branch preview comment output
- [#373](../../pull/373) Simplify runtime exports
- [#372](../../pull/372) Fix service worker cache script loading on GitHub Pages
- [#371](../../pull/371) Add console error check to UI smoke test
- [#370](../../pull/370) Ensure deploy previews checkout into PR-specific pull directories
- [#369](../../pull/369) Consolidate runtime exports

### 0.8.1 - 2025-11-26

- [#368](../../pull/368) Fix duplicate renderer controller export
- [#367](../../pull/367) Fix Pages artifact path for main deployments
- [#366](../../pull/366) Fix runtime controller export
- [#365](../../pull/365) Remove Pico CSS
- [#364](../../pull/364) Restore custom styles and remove Pico import
- [#363](../../pull/363) Add gh-pages artifact diagnostics to deploy workflows
- [#362](../../pull/362) Add preboot metric fallbacks for blocked storage
- [#361](../../pull/361) Fix branch deployment setup and linkify preview comments
- [#360](../../pull/360) Improve deploy preview logging
- [#359](../../pull/359) Gate Pages deploys to open PRs and refresh docs

### 0.8.0 - 2025-11-26

- [#358](../../pull/358) Add renderer follow-up tasks
- [#357](../../pull/357) Exclude project files from Pages deploy
- [#356](../../pull/356) Improve SVG renderer sizing and tests
- [#355](../../pull/355) Rename changelog file and update guidance
- [#354](../../pull/354) Use PR-numbered preview URLs and cleanup on close
- [#353](../../pull/353) Simplify branch preview URLs
- [#352](../../pull/352) Refine settings tabs and layout
- [#351](../../pull/351) Fix deploy workflow concurrency group expression
- [#350](../../pull/350) Fix branch preview deployment path
- [#349](../../pull/349) Adjust deploy target directory for main Pages deployment

### 0.7.3 - 2025-11-24

- [#348](../../pull/348) Improve responsive settings layout
- [#347](../../pull/347) Fix duplicate createRendererController export
- [#346](../../pull/346) Remove legacy renderer module files
- [#345](../../pull/345) Simplify bootstrap to SVG renderer
- [#344](../../pull/344) Improve deployment log visibility
- [#343](../../pull/343) Remove unsupported screenshot artifact
- [#342](../../pull/342) Add session kick-off workflow reminder
- [#340](../../pull/340) Mirror Pages HTML and relocate repository planning docs
- [#339](../../pull/339) Trim and document remaining CSS
- [#338](../../pull/338) Add service worker status and debug logging

### 0.7.2 - 2025-11-23

- [#337](../../pull/337) Reorganize repository guides and mirror Pages HTML
- [#336](../../pull/336) Remove deployment gating for branch deploys
- [#335](../../pull/335) Add gh-pages preview cleanup to branch maintenance workflow
- [#334](../../pull/334) Handle workflow dispatch triggers in post-deploy tests
- [#333](../../pull/333) Improve settings sheet mobile layout
- [#332](../../pull/332) Update scheduled branch cleanup prefixes
- [#331](../../pull/331) Fix deploy workflow eligibility for PR branches
- [#329](../../pull/329) Remove README link from help panel
- [#328](../../pull/328) Add rerun Pages deploy button to PR comments
- [#327](../../pull/327) Improve branch cleanup logging and cutoff

### 0.7.1 - 2025-11-21

- [#326](../../pull/326) Add manual dispatch for branch deploys and rerun button
- [#325](../../pull/325) Fix settings tab layout wrappers
- [#324](../../pull/324) Refactor render.js to lean SVG renderer
- [#323](../../pull/323) Add merge conflict handling checklist
- [#322](../../pull/322) Synchronize modular renderer refactor with updated deployment workflows
- [#321](../../pull/321) Clarify git remote and rebase expectations
- [#320](../../pull/320) Handle preview screenshot failures gracefully
- [#318](../../pull/318) Fix deploy workflow environment expression
- [#317](../../pull/317) Enhance post-deploy Playwright coverage
- [#316](../../pull/316) Adjust deploy workflow environment per branch

### 0.7.0 - 2025-11-21

- [#315](../../pull/315) Stabilize settings toggle and mute test network noise
- [#314](../../pull/314) Simplify settings bootstrap with JSON export
- [#313](../../pull/313) Update deployment documentation
- [#312](../../pull/312) Add feedback form with analytics reporting
- [#311](../../pull/311) Improve deploy reporting and always deploy
- [#310](../../pull/310) Add global error toast for runtime failures
- [#309](../../pull/309) Allow deploy workflow on all branches
- [#308](../../pull/308) Adopt templating helper for save manager UI
- [#307](../../pull/307) Simplify post-deploy preview comment
- [#305](../../pull/305) Auto prune stale Pages previews

### 0.6.3 - 2025-11-18

- [#303](../../pull/303) Remove legacy autosave migration
- [#302](../../pull/302) Add settings sheet toggle test
- [#301](../../pull/301) Add drag deadzone for settings launcher
- [#298](../../pull/298) Move cleanup script into project scripts
- [#296](../../pull/296) Document deploy workflow env guardrails
- [#295](../../pull/295) Adopt rich save preview cards and flattened sticky settings layout
- [#294](../../pull/294) Remove job-level environment context reference from deploy sync step
- [#292](../../pull/292) Update README with offline and local dev notes
- [#291](../../pull/291) Compute deploy workflow concurrency group directly without env context
- [#290](../../pull/290) Add terminal output guidance to onboarding

### 0.6.2 - 2025-11-16

- [#288](../../pull/288) Refactor UI wiring into components
- [#287](../../pull/287) Make branch cleanup asynchronous
- [#286](../../pull/286) Optimize GitHub Pages deployment speed
- [#284](../../pull/284) Refine developer onboarding guidance
- [#283](../../pull/283) Add organic superpixel generator
- [#282](../../pull/282) Add project roadmap and TODO tracking
- [#280](../../pull/280) Add offline caching and local file access
- [#279](../../pull/279) Add simplicity guidance to workflow instructions
- [#278](../../pull/278) Consolidate runtime bootstrap into single module
- [#277](../../pull/277) Extract runtime styles into stylesheet

### 0.6.1 - 2025-11-16

- [#276](../../pull/276) Fix branch cleanup ref encoding
- [#275](../../pull/275) Combine renderer performance updates and testing stack
- [#274](../../pull/274) Handle WebGL label cache updates for UI scale changes
- [#273](../../pull/273) Update TECH.md for modular runtime documentation
- [#272](../../pull/272) Update Playwright setup script workflow
- [#270](../../pull/270) Organize runtime assets under dedicated directory
- [#269](../../pull/269) Add unit tests for render controller fallbacks
- [#264](../../pull/264) Add documentation for helper scripts
- [#262](../../pull/262) Run branch cleanup after deployments
- [#261](../../pull/261) Refresh TECH.md test harness and branch deployment documentation

### 0.6.0 - 2025-11-15

- [#260](../../pull/260) Restructure repository around project workspace
- [#259](../../pull/259) Reuse counters for tiny region merging
- [#258](../../pull/258) Center active palette colour
- [#257](../../pull/257) Unify settings, generator, saves, and help into one menu
- [#256](../../pull/256) Add nearby difficulty that auto-selects adjacent colours
- [#255](../../pull/255) Refactor neighbor iteration in segmentation routines
- [#254](../../pull/254) Optimize smoothing histogram reuse
- [#252](../../pull/252) Allow dots in post-deploy slug derivation
- [#251](../../pull/251) Fix post-deploy artifact naming sanitization
- [#250](../../pull/250) Ensure Playwright browsers install with docs

### 0.5.3 - 2025-11-15

- [#249](../../pull/249) Simplify branch overview page
- [#248](../../pull/248) Restore stable renderer pipeline with performance logging
- [#245](../../pull/245) Persist palette sort preference
- [#244](../../pull/244) Improve zoom smoothness with compositor-driven scaling
- [#243](../../pull/243) Flush autosave on page lifecycle events
- [#242](../../pull/242) Fix WebGL label rendering
- [#241](../../pull/241) Add branch slug preparation job to post-deploy tests workflow
- [#240](../../pull/240) Adjust zoom defaults and expose configurable max zoom
- [#239](../../pull/239) Preserve palette numbering when colours complete
- [#238](../../pull/238) Fix UI scale flash during boot

### 0.5.2 - 2025-10-26

- [#237](../../pull/237) Rename palette sort label and renumber swatches
- [#236](../../pull/236) Switch CI workflow to Ubuntu runners
- [#235](../../pull/235) Limit Playwright smoke test to Chromium page load
- [#234](../../pull/234) Simplify Pages deployment workflow
- [#233](../../pull/233) Enhance palette sorting with spectrum and warmth modes
- [#232](../../pull/232) Prefer autosave when restoring sessions
- [#231](../../pull/231) Sanitize post-deploy concurrency group branch names
- [#230](../../pull/230) Improve region label placement and sizing
- [#229](../../pull/229) Improve region label placement with polylabel
- [#228](../../pull/228) Fix settings persistence when no puzzle is loaded

### 0.5.1 - 2025-10-25

- [#227](../../pull/227) Render region numbers continuously across all zoom levels
- [#226](../../pull/226) Remove user settings from exported save files
- [#225](../../pull/225) Fix post-deploy workflow concurrency expression
- [#224](../../pull/224) Configure Playwright UI review artifacts
- [#223](../../pull/223) Streamline Playwright smoke test for quick load check
- [#222](../../pull/222) Improve remote image URL workflow
- [#221](../../pull/221) Add support for loading puzzles from external image URLs
- [#220](../../pull/220) Adjust region label layout to respect zoom ratio
- [#219](../../pull/219) Support zoom-aware region label layout
- [#217](../../pull/217) Persist user settings in browser storage

### 0.5.0 - 2025-10-24

- [#216](../../pull/216) Fix right-click select colour when pan drag is configured
- [#215](../../pull/215) Default to medium detail with larger regions
- [#214](../../pull/214) Revamp Manage Saves autosave slot layout
- [#212](../../pull/212) Render puzzles over stored base image
- [#211](../../pull/211) Add compact puzzle export option
- [#210](../../pull/210) Add tabbed settings layout and refine UI scale defaults
- [#209](../../pull/209) Fix WebGL fill updates and refine zoom controls
- [#208](../../pull/208) Add renderer selector UI and SVG backend
- [#207](../../pull/207) Ensure branch deployments include JSON assets
- [#206](../../pull/206) Include all root JS assets in branch deploys

### 0.4.3 - 2025-10-21

- [#205](../../pull/205) Expand interface scale limits
- [#204](../../pull/204) Include JS assets in branch deployments
- [#203](../../pull/203) Add textured passes to WebGL renderer
- [#202](../../pull/202) Ensure allow_without_pr input is evaluated correctly
- [#201](../../pull/201) Fix deploy workflow expressions for manual inputs
- [#200](../../pull/200) Fix branch deploy workflow env quoting
- [#199](../../pull/199) Ensure post-deploy tests install Playwright browsers
- [#198](../../pull/198) Restore Playwright UI smoke coverage
- [#197](../../pull/197) Add WebGL renderer implementation
- [#196](../../pull/196) Stabilize UI smoke tests with automation helpers

### 0.4.2 - 2025-10-20

- [#195](../../pull/195) Document renderer controller and active Playwright smoke run
- [#194](../../pull/194) Add hint type toggles to settings sheet
- [#193](../../pull/193) Add Playwright tests for painting and save completion
- [#192](../../pull/192) Allow manual deploys to target any branch
- [#191](../../pull/191) Synchronize work branch with updated deployment workflows and scripts
- [#188](../../pull/188) Add post-deploy branch smoke tests workflow
- [#187](../../pull/187) Use fetch to build deployment metadata
- [#186](../../pull/186) Add multiple puzzle generation algorithms and documentation updates
- [#185](../../pull/185) Point deployment environment URL to branch preview
- [#184](../../pull/184) Allow pan and zoom gestures from viewport margins

### 0.4.1 - 2025-10-18

- [#183](../../pull/183) Use GitHub Markdown API for README builds
- [#181](../../pull/181) Modularize puzzle renderer via controller abstraction
- [#180](../../pull/180) Rewrite README for player-focused guidance
- [#179](../../pull/179) Hide puzzle outlines for filled regions
- [#178](../../pull/178) Harden branch deployment workflow data handling
- [#177](../../pull/177) Fix deploy workflow by moving inline scripts to dedicated files
- [#176](../../pull/176) Fix deploy workflow heredoc terminators
- [#175](../../pull/175) Use actions/deploy-pages v4
- [#174](../../pull/174) Fix deploy workflow README conversion block indentation
- [#173](../../pull/173) Fix deploy workflow manifest JSON generation

### 0.4.0 - 2025-10-17

- [#172](../../pull/172) Prune inactive branch deployments during Pages sync
- [#171](../../pull/171) Update GitHub Actions deploy-pages workflow action from v4 to v5
- [#170](../../pull/170) Revamp branch deployment index layout with compact timeline rows
- [#169](../../pull/169) Fix README core asset reference
- [#168](../../pull/168) Generate README HTML during branch deployments
- [#167](../../pull/167) Limit branch previews to runtime assets
- [#166](../../pull/166) Embed hosted README inside help panel
- [#164](../../pull/164) Include weekday in branch deployment timestamps
- [#163](../../pull/163) Add npm scaffolding and placeholder test runner
- [#162](../../pull/162) Add image prompt helper to generator tab

### 0.3.3 - 2025-10-17

- [#161](../../pull/161) Improve save management autosave experience
- [#160](../../pull/160) Auto-start generation and relocate saves export
- [#159](../../pull/159) Improve mobile gesture responsiveness
- [#158](../../pull/158) Add reset progress button to save manager
- [#157](../../pull/157) Simplify branch deploy index cards
- [#156](../../pull/156) Streamline branch deploy index metadata
- [#155](../../pull/155) Align main and preview commit metadata in branch deployment listings
- [#154](../../pull/154) Localize branch deployment commit timestamps to 12-hour browser time
- [#153](../../pull/153) Remove onboarding start hint and add quick start actions to Saves sheet
- [#152](../../pull/152) Improve branch deployment summary layout

### 0.3.2 - 2025-10-16

- [#151](../../pull/151) Document branch update workflow
- [#150](../../pull/150) Fix deploy workflow heredoc indentation
- [#149](../../pull/149) Render branch deployment dashboard metadata via jq pipeline
- [#148](../../pull/148) Replace jq branch page generation with Node
- [#147](../../pull/147) Restore branch index metadata generation and open-PR deploy gating
- [#144](../../pull/144) Prevent branch deployments without open PRs
- [#142](../../pull/142) Include PR links in branch deployment dashboard
- [#140](../../pull/140) Require import confirmation and show progress inside generator sheet
- [#139](../../pull/139) Remove idle Ready to paint status line
- [#137](../../pull/137) Simplify branch deployments

### 0.3.1 - 2025-10-15

- [#136](../../pull/136) Restrict status bar to generation progress
- [#135](../../pull/135) Enable concurrency cancellation for GitHub Pages deployments to prevent 400 errors
- [#130](../../pull/130) Fix GitHub Pages deployment workflow failure caused by rsync removing .git directory
- [#129](../../pull/129) Fix gh-pages deployment failure by auto-recovering from invalid git repository state
- [#128](../../pull/128) Prevent branch deployment cleanup job failures on missing directories
- [#127](../../pull/127) Update git remote guidance
- [#126](../../pull/126) Streamline command rail buttons
- [#123](../../pull/123) Improve tooltip contrast for light palette colors
- [#122](../../pull/122) Enhance hint highlights and add easy difficulty
- [#121](../../pull/121) Review and update branch-deployments.md documentation for accuracy

### 0.3.0 - 2025-10-14

- [#119](../../pull/119) Add clickable commit and PR links to branch deployment history
- [#118](../../pull/118) Enhance branch deployment with commit and PR links in Recent History
- [#117](../../pull/117) Implement shared save metadata templates
- [#116](../../pull/116) Fix gh-pages cache validation to prevent "fatal: not in a git directory" errors
- [#115](../../pull/115) Enhance GitHub Pages branch deployment workflow with commit history and timezone conversion
- [#114](../../pull/114) Restore project links at the top of README.md
- [#113](../../pull/113) Unify start screen and save manager
- [#112](../../pull/112) Ensure preview render matches puzzle scale
- [#111](../../pull/111) Add configurable hint fade, intensity, and right-click color selection
- [#110](../../pull/110) Restore capy.json and add fallback puzzle metadata

### 0.2.3 - 2025-10-13

- [#109](../../pull/109) Simplify preview mode to color canvas in place
- [#105](../../pull/105) Ensure palette swatches respond to right-click
- [#104](../../pull/104) Add region label support and palette-colored hint flashes
- [#103](../../pull/103) Add configurable region flash durations and hover hint previews
- [#102](../../pull/102) Allow right-click palette selection
- [#101](../../pull/101) Improve tap hit-testing performance by caching canvas bounds
- [#100](../../pull/100) Add toggle to control status bar visibility
- [#99](../../pull/99) Speed up wrong-color hint flashes and highlight matching regions on tap
- [#98](../../pull/98) Reconcile touch tap responsiveness handlers in index.html
- [#97](../../pull/97) Optimize deployment workflow for 40-60% faster builds

### 0.2.2 - 2025-10-13

- [#96](../../pull/96) Trigger region fills on touch pointer events to remove tap delay
- [#95](../../pull/95) Centralize canvas fill validation for touch and click events
- [#94](../../pull/94) Render puzzle geometry at zoom scale
- [#93](../../pull/93) Add async generation progress feedback and modularize generator
- [#91](../../pull/91) Fix touch pan and pinch gesture behavior
- [#90](../../pull/90) Optimize outline rendering and allow unlimited zoom
- [#89](../../pull/89) Fix palette dock overflow on small viewports
- [#88](../../pull/88) Fix command rail layout wrapping
- [#87](../../pull/87) Handle command rail wrapping metrics
- [#86](../../pull/86) Constrain floating command rail within right safe-area inset

### 0.2.1 - 2025-10-11

- [#85](../../pull/85) Fix command rail overflow on narrow viewports
- [#84](../../pull/84) Simplify play surface layout
- [#82](../../pull/82) Fix branch index to save to branch.html instead of index.html
- [#81](../../pull/81) Prioritize main branch deployment and list PR metadata on branch index
- [#80](../../pull/80) Hide completed colours and shrink UI scale
- [#79](../../pull/79) Optimize deploy-branch workflow execution performance
- [#78](../../pull/78) Enable double-click sampling of puzzle colours
- [#77](../../pull/77) Summarize local save storage in help and drop cloud sync
- [#76](../../pull/76) Add region number visibility toggle
- [#75](../../pull/75) Add repository contributor instructions

### 0.2.0 - 2025-10-09

- [#72](../../pull/72) Apply edge-to-edge flat palette swatch layout to index.html
- [#71](../../pull/71) Show original artwork behind regions and streamline colour selection
- [#69](../../pull/69) Adopt edge-to-edge palette swatch styling and safe-area padding
- [#68](../../pull/68) Refine luminance-based swatch label contrast presets
- [#67](../../pull/67) Fix deploy-branch workflow to push newly initialized gh-pages branch
- [#66](../../pull/66) Fix git authentication in deploy-branch.yml workflow
- [#65](../../pull/65) Configure git credentials in deploy-branch workflow
- [#63](../../pull/63) Update deploy-branch workflow to use index.html instead of branchindex.html
- [#62](../../pull/62) Flatten palette dock into edge-to-edge swatches with adaptive contrast
- [#60](../../pull/60) Streamline palette dock to swatches only

### 0.1.3 - 2025-10-08

- [#59](../../pull/59) Fix authentication for deploy-branch job using GITHUB_TOKEN
- [#58](../../pull/58) Collapse command rail into responsive icon buttons and harden zoom guard
- [#56](../../pull/56) Document resolved zoom guard handler structure in merge conflict report
- [#55](../../pull/55) Simplify Playwright smoke tests for faster runs
- [#54](../../pull/54) Fix deploy-branch workflow to handle missing gh-pages branch
- [#53](../../pull/53) Enhance palette focus and responsive command rail
- [#52](../../pull/52) Add horizontal wheel scrolling and status copy to palette dock
- [#51](../../pull/51) Strip stray UTF-8 BOM from package.json and add ripgrep ignore rules
- [#50](../../pull/50) Improve viewport sizing and zoom handling
- [#49](../../pull/49) Refresh contributor onboarding guidance

### 0.1.2 - 2025-10-07

- [#48](../../pull/48) Add custom cursor tooltip for puzzle regions
- [#44](../../pull/44) Add automatic GitHub Pages deployment for all branches
- [#42](../../pull/42) Trim unused assets and refresh documentation
- [#41](../../pull/41) Improve region label readability and palette hints
- [#39](../../pull/39) Add sample detail presets, UI scale controls, and mobile zoom guard
- [#38](../../pull/38) Reconcile autosave and cloud-sync gameplay session documentation
- [#37](../../pull/37) Improve DOM rendering for save list entries
- [#34](../../pull/34) Document upstream git remote
- [#33](../../pull/33) Derive export titles from source metadata
- [#30](../../pull/30) Add sample detail presets and region legend

### 0.1.1 - 2025-10-06

- [#29](../../pull/29) Add autosave restore flow and cloud backup sync
- [#28](../../pull/28) Guard pan move updates without a loaded puzzle
- [#27](../../pull/27) Allow touch pans without blocking taps
- [#26](../../pull/26) Enhance capybara sample illustration
- [#23](../../pull/23) Add generator test hooks and end-to-end Playwright review suite
- [#20](../../pull/20) Rebuild fullscreen drop interface for puzzle generator
- [#19](../../pull/19) Flash palette hint when tapping wrong colors
- [#18](../../pull/18) Add terraced market starter art
- [#17](../../pull/17) Remove redundant header buttons and stabilize drag panning
- [#16](../../pull/16) Document starter scene regression checks in PR review notes

### 0.1.0 - 2025-10-04

- [#15](../../pull/15) Update smoke test alias to target UI review harness
- [#14](../../pull/14) Restore Babel runtime and unblock starter art loading
- [#11](../../pull/11) Preserve stored starter titles when merging updates
- [#10](../../pull/10) Bundle Lagoon starter scenes and add local art library
- [#9](../../pull/9) Streamline canvas toolbar interactions
- [#8](../../pull/8) Refine lagoon segmentation and unblock progress
- [#6](../../pull/6) Enable SVG artwork imports and refresh help content
- [#5](../../pull/5) Refine capybara art layout
- [#3](../../pull/3) Surface README overview through an in-app options panel
- [#1](../../pull/1) Build simple color-by-number web app
