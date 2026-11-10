# Agent Instructions & Operational Playbook — Capy Monorepo (`web/`, `app/`)

Capy is a multi-platform color-by-number suite living in https://github.com/shthed/capy and deployed at https://shthed.github.io/capy/.

---

## 1. The Golden Invariants (Non-Negotiable Guardrails)

All contributors and AI agents must strictly observe these absolute core invariants:

1. **Never merge without explicit approval**: Never merge a pull request or push directly to `main` without explicit confirmation and approval from the user. Create the pull request, verify that CI tests pass, share the PR link, and wait for confirmation.
2. **Build Android freely, but never deploy to physical devices without request**: You may build and assemble the Android app (`./gradlew app:assembleDebug`, `./gradlew app:testDebugUnitTest`, `./gradlew app:buildWeb`) whenever required to verify changes. However, never execute device installation commands (`./gradlew app:installDebug`) unless explicitly requested by the user.
3. **Never use root-relative asset URLs**: Never use `/assets/...` URLs in code or CSS. Always use relative `./assets/...` and maintain `base: './'` in `web/vite.config.ts` so bundles resolve across GitHub Pages root (`/`), PR previews (`/pull/<number>/`), and Android WebView (`https://appassets.androidplatform.net/assets/www/`). See Section 6.6.
4. **Strict documentation & changelog maintenance, zero emojis & no ASCII art**: Never include emojis or ASCII art / box-drawing diagrams in markdown documentation files (`.md`). Prefer tables, indented bullet hierarchies, GitHub Flavored Markdown alerts, or Mermaid diagrams. Always maintain and synchronize documentation across `WEB.md`, `PUZZLE.md`, `APP.md`, `CLOUD.md`, `TESTING.md`, `TODO.md`, `CHANGELOG.md`, and `README.md` following Section 5.
5. **Never execute heavy CPU segmentation on the main thread**: All color clustering (K-Means), contour tracing, and region segmentation must execute exclusively in `web/src/engine/puzzle.worker.ts` using transferable `ArrayBuffer` objects. See Section 6.4.
6. **Zero per-frame allocations in hot paths**: Never instantiate objects or arrays inside `requestAnimationFrame` loops, canvas rendering callbacks, or high-frequency touch gesture paths. Reuse typed arrays and scratch structs to eliminate GC micro-stutter. See Section 6.2.
7. **Never leave completed items in `TODO.md`**: When a task or milestone is completed, remove it from `TODO.md` immediately rather than checking it off. Keep `TODO.md` strictly focused on pending, active roadmap tasks.
8. **Always display working thoughts**: Continuously display thoughts while working to explain what is being done and why, stating what file, component, or system is being inspected and the exact reasoning for each action.
9. **Never open a PR without verifying builds**: Always run `npm run lint` and `npm run build` cleanly before creating or updating a pull request. Never submit unverified changes to CI.
10. **Verify code reality before documenting**: Never document speculative, non-existent function names, setting keys, file paths, or CLI flags. Verify names and signatures directly against the codebase before updating documentation.
11. **Evaluate & report PR Readiness & Perfection Confidence Score before requesting merge**: Whenever finishing a PR and preparing it for merge, compute a weighted `0-100%` (`5` pillars x `20` points) **PR Readiness & Perfection Confidence Score** (Functionality & Edge Cases, Automated Tests, Performance & Golden Invariants, Docs & Changelog Sync, CI & Preview Verification). Require `>= 95%` confidence before requesting merge approval (automatically fixing any technical/test/doc gaps first and asking clarifying questions via `/grill-me` if design ambiguity remains), and display the score and 5-pillar rubric table in chat, near the top of the PR description (immediately below the live preview link), and in the PR Development Summary comment (explicitly stating the exact delta if `< 100%`).

---

## 2. Repository Architecture & Target Boundaries

| Subsystem | Location | Technologies & Scope | Key Capabilities |
| :--- | :--- | :--- | :--- |
| **Web Application** | `web/` | React 19, TypeScript, Vite 6, Tailwind CSS 4 | Cached 2D Canvas engine (`PuzzleCanvas.tsx`), 5-strategy Web Worker pipeline (`puzzle.worker.ts`), `NativeBridge` interface |
| **Native Android Launcher** | `app/` | Kotlin, AndroidX WebViewAssetLoader, Play Games Services v2 | Host shell (`MainActivity.kt`), `@JavascriptInterface` bridge (`CapyAndroidBridge.kt`), Play Games profile login, tactile haptics, back navigation, disk backups |

1. **`web/` — Web Application & Single Source of Truth (Deployed to `/`)**:
   - Built with **React 19**, **TypeScript**, **Vite 6**, **Tailwind CSS 4**, offscreen cached 2D canvas rendering (`PuzzleCanvas.tsx`), and a 5-strategy Web Worker puzzle engine (`web/src/engine/`).
   - Shared across both the Web deployment and the Android (`app/`) wrapper via `web/src/services/NativeBridge.ts`.
   - Subsystem references: UI & architecture in [`WEB.md`](./WEB.md); cloud sync, Play Games login & multiplayer in [`CLOUD.md`](./CLOUD.md); puzzle engine in [`PUZZLE.md`](./PUZZLE.md); testing guide in [`TESTING.md`](./TESTING.md); release history in [`CHANGELOG.md`](./CHANGELOG.md); roadmap in [`TODO.md`](./TODO.md).

2. **`app/` — Unified Native Android Application (`com.capypaint.capy`, Deployed to `/capy.apk`)**:
   - Lightweight native Android launcher wrapping `web/dist/` via AndroidX `WebViewAssetLoader` (`MainActivity.kt`) and `CapyAndroidBridge.kt` (`@JavascriptInterface`).
   - Native launcher specifications live in [`APP.md`](./APP.md).
   - Provides native Android tactile haptic feedback (`Vibrator` / `HapticFeedbackConstants`), hardware back gesture modal closing, native `PickVisualMedia` photo picker, `Intent.ACTION_SEND` image receiver, and persistent JSON disk backups (`filesDir/capy_saves`).

---

## 3. Task-Based Execution Decision Matrix

Match incoming user tasks to the matrix below to determine target files, mandatory tests, and required documentation updates. `npm run lint` and `npm run build` are the mandatory baseline for every code pull request.

| Task Domain | Target Files & Directories | Mandatory Verification Commands | Documentation to Sync |
| :--- | :--- | :--- | :--- |
| **Gameplay UI & Controls** | `web/src/components/*`, `web/src/index.css` | `npm run lint`<br>`npm run build`<br>`npm test`<br>`npm run gallery:capture` (if styling changed) | [`WEB.md`](./WEB.md)<br>[`CHANGELOG.md`](./CHANGELOG.md)<br>[`TODO.md`](./TODO.md) |
| **Puzzle Engine & Workers** | `web/src/engine/*`, `web/src/engine/puzzle.worker.ts` | `npm run lint`<br>`npm run build`<br>`npm test` | [`PUZZLE.md`](./PUZZLE.md)<br>[`CHANGELOG.md`](./CHANGELOG.md)<br>[`TODO.md`](./TODO.md) |
| **Native Android Wrapper** | `app/src/main/*`, `web/src/services/NativeBridge.ts` | `npm run lint`<br>`npm run build`<br>`./gradlew app:testDebugUnitTest`<br>`./gradlew app:assembleDebug` | [`APP.md`](./APP.md)<br>[`CHANGELOG.md`](./CHANGELOG.md)<br>[`TODO.md`](./TODO.md) |
| **Testing & Automation** | `web/scripts/*`, Playwright test specs | `npm run lint`<br>`npm run build`<br>`npm test` | [`TESTING.md`](./TESTING.md)<br>[`CHANGELOG.md`](./CHANGELOG.md)<br>[`TODO.md`](./TODO.md) |
| **CI/CD & Deployment** | `.github/workflows/*` | Validate YAML workflow syntax; verify dual-job pipeline permissions | [`AGENTS.md`](./AGENTS.md)<br>[`CHANGELOG.md`](./CHANGELOG.md) |
| **Documentation & Roadmap** | `*.md`, `docs/*` | Verify links and headings; zero emojis & no ASCII art | [`TODO.md`](./TODO.md)<br>[`CHANGELOG.md`](./CHANGELOG.md) |

---

## 4. Build & Verification Commands

### Web Application (`web/`)
From `web/`:
```bash
npm ci                  # Install dependencies cleanly
npm run lint            # Type check with tsc --noEmit
npm run build           # Compile production bundle (tsc && vite build -> web/dist/)
npm run dev             # Vite dev server on http://localhost:3000
npm run preview         # Serve compiled web/dist/ on http://localhost:3000
npm test                # Unified test suite: codec/engine unit checks + full E2E browser basics
npm run gallery:capture # Captures automated UI showcase gallery screenshots
npm run generate:samples # Pre-bakes built-in sample puzzles into sample_saves.capy
```

### Android Application (`app/`)
From the repository root:
```bash
./gradlew app:buildWeb             # Compiles web/ frontend into web/dist via Gradle
./gradlew app:testDebugUnitTest    # Runs JUnit4 unit tests for unified Android wrapper
./gradlew app:assembleDebug        # Syncs web/dist into assets/www and builds debug APK
./gradlew app:installDebug         # Deploys to device (ONLY run when explicitly requested by user)
```

---

## 5. Development, Communication & Git Workflow

- **Display working thoughts & communication style**:
  - Always display thoughts while working to explain what is being done and why. The user reads working thoughts to follow along, learn what the agent is doing, and understand its reasoning.
  - Clearly state what file, component, or system is being inspected and explain the exact reason for the inspection.
  - State actions directly using present participles (e.g. "Updating...", "Inspecting...", "Verifying...", "Executing...") rather than past-tense announcements or conversational filler ("I have updated...", "Now, ...", "First, ...", "Next, ...").
  - Avoid robotic numbered step headings; use natural, telegraphic participle-driven logging.
- **Session kick-off**: Run `git fetch --all --prune` and rebase onto `origin/main` before starting work.
- **Branch naming**: Use short-lived feature branches (`automation/<change>` or `feature/<change>`) and open PRs so CI and preview deployments run automatically.
- **Linear History & Rebase Hygiene**: Keep branch history linear by rebasing onto `origin/main` (`git pull --rebase origin main`) rather than introducing merge commits into feature branches.
- **Unified CI & Branch Deployments ([`.github/workflows/deploy-branch.yml`](./.github/workflows/deploy-branch.yml))**:
  - Two-job pipeline separating unprivileged code execution from privileged deployment:
    - `build` job runs under read-only permissions (`contents: read`), compiling Web (`npm ci && npm run build`), running Android unit tests (`./gradlew app:testDebugUnitTest`), and assembling debug APK (`./gradlew app:assembleDebug`). Builds across PRs execute concurrently in parallel without locking.
    - `deploy` job runs under privileged deployment permissions (`contents: write`, `pages: write`, `id-token: write`, `pull-requests: write`) and acquires the `deploy-pages` concurrency lock to serialize artifact publishing and PR comments.
  - Automatically skips CI builds and deployments when commits exclusively modify documentation (`paths-ignore: ['**.md', 'docs/**', 'notes/**', '.gitignore', 'LICENSE']`), consuming zero runner minutes.
  - `main` deploys `web/dist/` to `/` (`https://shthed.github.io/capy/`) and the Android APK to `/capy.apk` (`https://shthed.github.io/capy/capy.apk`).
  - Open PR branches deploy previews to `/pull/<number>/` and `/pull/<number>/capy.apk`.
  - `gh-pages` commits are squashed to a single orphan commit on every push so binary `.apk` files never accumulate in Git history.
- **PR preview lifecycle, top-of-PR test link & cleanup ([`.github/workflows/cleanup-closed-pr.yml`](./.github/workflows/cleanup-closed-pr.yml))**:
  - While a PR is open, its preview is served at `https://shthed.github.io/capy/pull/<number>/` (and Android APK at `https://shthed.github.io/capy/pull/<number>/capy.apk`).
  - **Always update the PR description after successful deployment to include a link to test the game at the very top** (`https://shthed.github.io/capy/pull/<number>/`) whenever the game is ready to be tested.
  - When a PR is closed or merged, `cleanup-closed-pr.yml` automatically deletes the `/pull/<number>/` preview directory from `gh-pages` and redeploys. Once merged, the changes are live on the root site `https://shthed.github.io/capy/`.
- **Finish active task before switching**: Finish working on the current task instead of switching when the user sends an update with a new task, unless the comment directly relates to what is currently being worked on.
- **Plan before executing major changes**: When starting work on a big task, write out a clear plan of what you are going to do and how you are going to implement it before jumping into code edits.
- **Scope Discipline & Minimal Diffs**: Only modify files directly required to fulfill the active task. Avoid speculative refactorings, reformatting unrelated files, or introducing architectural complexity beyond what was requested.
- **Credential & Secret Hygiene**: Never commit secrets, personal access tokens, API credentials, or internal environment details to Git or pull request comments.
- **User-Friendly Pull Request Naming & Labels**:
  - **PR Titles**: Write clean, concise, direct action-oriented titles focusing on what changed (e.g. `Update AGENTS.md: Improve rules`, `Add PWA offline support`, `Fix zoom pan gestures`). Avoid overly verbose, buzzword-heavy titles or raw git commit syntax and parenthesized prefixes.
  - **PR Labels**: Always attach appropriate GitHub label tags when opening or editing PRs:
    - `feature`: New gameplay features, controls, or user capabilities.
    - `fix`: Bug fixes, gesture corrections, or rendering fixes.
    - `docs`: User guides, README additions, architectural updates.
    - `ui`: Styling, themes, modal redesigns, visual gallery.
    - `testing`: E2E suites, Playwright test scripts, test harness.
    - `ci`: GitHub Actions workflows, CI/CD pipelines, and deployment automation.
    - `deps`: Dependency upgrades, version catalogs, and package manager updates.
- **Versioning Scheme & `CHANGELOG.md` Maintenance**:
  - **Single Source of Truth (`MAJOR.MINOR.PATCH`)**: [`web/package.json`](./web/package.json) `"version"` is the canonical Semantic Version for the entire monorepo (`0 <= MINOR <= 99`, `0 <= PATCH <= 99`).
  - **Cross-Target Synchronization**: [`web/src/version.ts`](./web/src/version.ts) exports `APP_VERSION` and `APP_VERSION_CODE` (`(MAJOR * 10000) + (MINOR * 100) + PATCH`), and [`app/build.gradle.kts`](./app/build.gradle.kts) automatically reads `../web/package.json` at Gradle configuration time to set `versionName` and `versionCode`.
  - **Mandatory Version Bump & Changelog Entry**: Whenever a pull request introduces new features (`MINOR`), bugfixes (`PATCH`), or breaking storage/architectural changes (`MAJOR`), bump `"version"` in `web/package.json` and add a corresponding `## [MAJOR.MINOR.PATCH] - YYYY-MM-DD (Android versionCode: XXXXX)` section in [`CHANGELOG.md`](./CHANGELOG.md). `npm test` automatically verifies that `CHANGELOG.md` contains an entry matching `web/package.json`.
- **Documentation Maintenance & Synchronization Guidelines**:
  - **Zero Emojis & No ASCII Art**:
    - Never include unicode emojis or ASCII art / box-drawing diagrams in markdown documentation files (`.md`).
    - Use GitHub Flavored Markdown alerts (`> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`), tables, indented bullet hierarchies, or Mermaid diagrams for structural callouts and visual emphasis.
  - **Subsystem Synchronization Matrix**:
    - When modifying **UI controls, settings, appearance, or gestures**: Update [`WEB.md`](./WEB.md) with complete setting keys, default states, UI placement, and user interaction mechanics.
    - When modifying **segmentation algorithms, color clustering, line extraction, or web worker protocols**: Update [`PUZZLE.md`](./PUZZLE.md) with algorithmic details, buffer structures, and performance budgets.
    - When modifying **Android launcher, bridge APIs, haptic patterns, or native storage**: Update [`APP.md`](./APP.md) with `@JavascriptInterface` signatures and native lifecycle contracts.
    - When adding, updating, or fixing **test suites, Playwright scripts, or verification procedures**: Update [`TESTING.md`](./TESTING.md) with command options and assertion requirements.
    - When adding, starting, or completing **roadmap items**: Update [`TODO.md`](./TODO.md) and [`CHANGELOG.md`](./CHANGELOG.md).
    - When changing **high-level project capabilities, build steps, or deployment architecture**: Update [`README.md`](./README.md) and [`AGENTS.md`](./AGENTS.md).
  - **Active Task Hygiene (`TODO.md`)**:
    - Never check off completed items with `[x]`. When a task or milestone is finished, remove it from `TODO.md` immediately rather than checking it off.
    - Keep `TODO.md` strictly focused on pending, active roadmap tasks. Git commit history and pull request descriptions preserve historical completion records.
  - **Settings & Property Documentation Standards**:
    - Every newly added setting must be documented with its TypeScript type, default value, persistence storage (`StorageService` key `capy_user_settings_v8` or direct `localStorage` keys like `capy_saves_view_mode`, `capy_last_settings_tab`), and UI location.
  - **Relative Link Validation**:
    - All intra-repository links must use relative paths (e.g. `[`WEB.md`](./WEB.md)`) so documentation navigates seamlessly across branches, forks, and local clones.
  - **Pruning Obsolete & Retired References**:
    - When refactoring or deleting an API, UI element, or setting, perform a global search across all `.md` files to prune dead references and prevent documentation rot.
- **Development Summary to PR Before Merge**: When finalising a pull request ready for merge, compile a comprehensive summary of the development process (user requests, architectural decisions, implementations, debugging notes, test execution results, and visual showcases) and post it as a comment on the pull request. Never dump raw conversation transcripts, internal credentials, tokens, or environment details. This preserves a clean historical record directly on GitHub.
- **PR Readiness & Perfection Confidence Score (`0-100%`)**:
  - Whenever finishing a pull request and preparing it for merge, evaluate the PR against the **5-Pillar Readiness & Perfection Rubric** (`20` points per pillar = `100` total):
    | Pillar | Weight | Verification Criteria |
    | :--- | :--- | :--- |
    | **1. Functionality & Edge Cases** | `20` | All user requirements and edge cases (touch/mouse gestures, state persistence, modal back-stack, viewport clamping, fallback paths) are resolved and verified. |
    | **2. Automated Tests** | `20` | New and existing unit/codec/engine checks and Playwright E2E browser assertions in [`web/scripts/test.mjs`](./web/scripts/test.mjs) (`npm test`) and Android JUnit4 tests pass deterministically. |
    | **3. Performance & Golden Invariants** | `20` | Zero per-frame heap allocations in `requestAnimationFrame` loops, worker-isolated CPU segmentation, relative `./assets/...` paths, and defensive `NativeBridge` fallbacks. |
    | **4. Docs & Changelog Sync** | `20` | [`web/package.json`](./web/package.json) version bumped, [`CHANGELOG.md`](./CHANGELOG.md) updated with clickable GitHub PR/file links, completed tasks removed from [`TODO.md`](./TODO.md), and subsystem `.md` files synchronized with zero emojis/ASCII art. |
    | **5. CI & Preview Verification** | `20` | `npm run lint`, `npm run build`, and GitHub Actions (`Build & Test` + `Deploy to GitHub Pages`) pass on the latest commit, and the live preview URL (`https://shthed.github.io/capy/pull/<number>/`) is placed at the top of the PR description. |
  - **Threshold & Self-Correction Policy**:
    - **Require `>= 95%` confidence** before asking the user for merge approval.
    - If any technical, test, lint, or documentation gap lowers the score below `95%`, fix the gap automatically before presenting the PR.
    - If design ambiguity lowers the score below `95%`, proactively ask clarifying questions (`/grill-me` style) to resolve the ambiguity with the user.
    - Report the score and 5-pillar table in **three places**: (1) the chat response requesting merge approval, (2) near the top of the PR description right below the live preview callout, and (3) inside the PR Development Summary comment. Whenever the score is `< 100%`, explicitly state the exact `-N` point delta explaining what accounts for the remaining points.

---

## 6. Web & Puzzle Engine Coding Conventions (`web/`)

1. **Coordinate Geometry & Invariant Transformations**:
   - Maintain explicit distinctions between Screen coordinates (pointer DOM events), Container coordinates (CSS client bounds), Artwork coordinates (canvas image pixel grid), and Segmentation map coordinates (`regions[id]`).
   - All pointer coordinate conversions must use `screenToCanvas` and coordinate clamping (`clampCanvasOffset`) in [`web/src/components/PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx).
   - Zoom and pan operations must maintain focal point invariance under pinch-to-zoom and Google Maps-style one-finger double-tap-and-drag gestures.

2. **Zero-Allocation Hot Paths**:
   - Forbid per-frame object and array allocations inside high-frequency animation loops (`requestAnimationFrame`, pan momentum gliding, and canvas repainting).
   - Reuse typed array buffers (`Uint8Array`, `Uint32Array`), pre-allocated bounding box structs, and scratch vectors to eliminate garbage collection micro-stutter during active gameplay. If an allocation is unavoidable, document and justify the exception.

3. **React State vs Direct Canvas Refs**:
   - High-frequency 60-120fps interactions (pointer dragging, momentum flick gliding, pinch zoom) must directly mutate canvas refs and trigger repaints via `requestAnimationFrame` without triggering React virtual DOM reconciliation.
   - React state is reserved for discrete lifecycle transitions: active color selection, region completed, modal visibility, and completion stats.

4. **Web Worker Concurrency & Transferable Buffers**:
   - All CPU-heavy image processing (color quantization, K-Means clustering, Otsu thresholding, contour line tracing, region segmentation) must execute exclusively in [`web/src/engine/puzzle.worker.ts`](./web/src/engine/puzzle.worker.ts).
   - Message payloads between main thread and worker must utilize transferable `ArrayBuffer` objects where possible to eliminate serialization overhead.
   - Generation tasks must support clean cancellation and worker termination when a new puzzle is initiated.

5. **Defensive NativeBridge Fallback Pattern**:
   - Every bridge invocation (`NativeBridge.haptic`, `NativeBridge.saveBackup`, `NativeBridge.loadBackup`, `NativeBridge.setBackModalOpen`, `NativeBridge.onSharedImage`, `NativeBridge.shareImage`) must feature-detect host capabilities and fall back safely to Web APIs (`navigator.vibrate`, IndexedDB, Web Share API) without throwing uncaught exceptions.

6. **Relative Asset Path Invariance**:
   - Never use root-relative `/assets/...` URLs in code or CSS. Always use relative `./assets/...` and maintain `base: './'` in [`web/vite.config.ts`](./web/vite.config.ts) to guarantee seamless asset resolution across GitHub Pages root (`/`), PR previews (`/pull/<number>/`), and Android WebView (`https://appassets.androidplatform.net/assets/www/`).

7. **Storage Durability & IndexedDB Quota Safety**:
   - Never store raw binary image Blobs or heavy base64 strings in synchronous `localStorage` (which is capped at 5MB and blocks the main thread).
   - Use asynchronous IndexedDB stores (`STORE_PUZZLES`, `STORE_IMAGES` in [`web/src/services/StorageService.ts`](./web/src/services/StorageService.ts)) for image bitmaps and serialized region states on Web, coupled with `filesDir/capy_saves` disk backups on Android.
   - Always ensure puzzle save serialization supports backward-compatible migrations when introducing new schema fields.

8. **Mobile Gesture State Transitions & Touch Invariance**:
   - Maintain `touch-action: none` (defined in [`web/src/index.css`](./web/src/index.css)) on the interactive canvas container to prevent browser scroll conflicts.
   - When transitioning out of a multi-touch pinch-to-zoom gesture where one finger remains in contact, re-anchor pan coordinates dynamically to prevent canvas jumping or viewport teleportation.

9. **Hardware Back Navigation & Modal Registration Contract**:
   - Modals must coordinate with the native Android back gesture. When a modal opens, it registers its close callback via `NativeBridge.setBackModalOpen(true, onClose)`. On back press, `MainActivity.kt` triggers `window.__capyCloseModal()`, which invokes the registered callback.
   - Desktop `Escape` key listeners should trigger the same modal close callback.

---

## 7. Android Coding Style & Warning Prevention (`app/`)

1. **Trailing Commas**: Include trailing commas in multiline parameter lists and data class declarations.
2. **Clarifying Parentheses**: Wrap sub-expressions in explicit parentheses for complex logical or range operations.
3. **Android KTX Extensions**: Prefer `androidx.core.graphics.createBitmap(...)`, `bitmap.scale(width, height)`, and `sharedPreferences.edit { ... }`.
4. **Data Classes with Array Properties**: Explicitly override `equals()` and `hashCode()` using `contentEquals()` and `contentHashCode()` on any `data class` holding `IntArray` or `BooleanArray`.
5. **Zero-Allocation Engine Loops**: Use primitive array buffers over object allocations in high-frequency quantization, segmentation, and rendering loops.

---

## 8. Pre-PR Verification Checklist

Before opening or updating any pull request, execute verification according to scope:

### A. Baseline Verification (Mandatory for All Code PRs)
```bash
cd web
npm run lint                  # Type check with tsc --noEmit
npm run build                 # Compile production bundle (tsc && vite build -> web/dist/)
```

### B. Domain-Specific Verification
```bash
# 1. Gameplay UI, Engine, Codec & Canvas Changes
npm test                      # Unified engine, codec, and Playwright E2E browser test suite
npm run gallery:capture       # Generates automated UI showcase screenshots (if styling changed)

# 2. Native Android Launcher (:app)
cd ..
./gradlew app:testDebugUnitTest # Native bridge JUnit4 unit tests
./gradlew app:assembleDebug   # Syncs web/dist and builds debug APK

# 3. Documentation PRs (*.md)
# Verify intra-repo relative links, zero emojis, and no ASCII art / box-drawing diagrams.
# Documentation-only PRs automatically skip CI builds via paths-ignore.
```

### C. Final Merge Readiness & Confidence Score Audit (`>= 95%`)
1. Verify that the live preview link (`https://shthed.github.io/capy/pull/<number>/`) is at the very top of the PR description.
2. Compute the **5-Pillar PR Readiness & Perfection Confidence Score (`0-100%`)** (Section 5) and ensure it is `>= 95%` (fixing any technical/test/doc gaps or resolving design ambiguities first).
3. Include the Confidence Score and 5-pillar rubric table near the top of the PR description, in the PR Development Summary comment, and in the chat response requesting merge approval.

---

## 9. Agent Self-Healing & Troubleshooting Recipes

Common environment scenarios and their direct remediation steps:

1. **Missing Node binaries or `tsc: not found`**:
   - Cause: Fresh container environment without installed node modules.
   - Remedy: Run `npm ci` inside `web/` before running lint or build.

2. **Playwright test connection refused (`ERR_CONNECTION_REFUSED http://localhost:3000/`)**:
   - Cause: Browser test scripts connect to a live web server on port 3000.
   - Remedy: Start the preview server in the background as a persistent daemon process (`npm run preview`), execute the test suite, and terminate the background preview process immediately when tests finish.

3. **Playwright browser missing (`Executable doesn't exist at .../chromium`)**:
   - Cause: Playwright browser binaries not yet installed in container cache.
   - Remedy: Run `npx playwright install chromium` inside `web/`.

4. **Skipped CI builds on documentation commits**:
   - Notice: Pull requests modifying only markdown files (`**.md`), `docs/`, or `.gitignore` intentionally skip GitHub Actions builds via `paths-ignore`. This is expected behavior and consumes zero runner minutes.

5. **Local Android Gradle SSL certificate error (`SSLException: trustAnchors parameter must be non-empty`)**:
   - Cause: The local container environment may lack a populated CA certificate keystore (`/etc/ssl/certs/java/cacerts`) for the Java runtime.
   - Remedy: Do not attempt to bypass TLS or tamper with system trust roots. Ensure `npm run lint` and `npm run build` pass cleanly, push changes to your feature branch, and rely on GitHub Actions CI (`deploy-branch.yml`), which executes `./gradlew app:testDebugUnitTest` and `./gradlew app:assembleDebug` in a fully provisioned Temurin JDK 17 runner.

---

## 10. Maintaining & Updating Dependencies

To keep all target environments (Web `web/` and Android `:app`) up to date with security patches and new library releases, follow these workflows:

### A. Web Application (`web/`)
1. **Check for outdated packages**:
   ```bash
   cd web
   npm outdated
   ```
2. **Update within SemVer range & refresh lockfile**:
   ```bash
   cd web
   npm update
   ```
3. **Verify linting & production build**:
   ```bash
   cd web
   npm run lint    # tsc --noEmit
   npm run build   # tsc && vite build
   ```

### B. Native Android Application (`app/`)
1. **Centralized Version Catalog (`gradle/libs.versions.toml`)**:
   - All Android dependency versions are centralized in `gradle/libs.versions.toml`.
   - Inspect recommended updates using IDE inspection tools or version lookup tools.
2. **`compileSdk` Alignment**:
   - When bumping Android libraries (e.g., `coreKtx`, `activityCompose`, `composeBom`), check that the library requirements align with `compileSdk` in `app/build.gradle.kts` (currently `compileSdk = 35`).
   - If a newer library version requires `compileSdk 36+` or API level 37+, update `compileSdk` in `:app` build script or keep the library pinned to the latest stable release supporting API 35.
3. **Verify Android builds & unit tests**:
   ```bash
   ./gradlew app:testDebugUnitTest
   ./gradlew app:assembleDebug
   ```
