# Agent Instructions — Capy Monorepo (`web/`, `app/`)

Capy is a multi-platform color-by-number suite living in https://github.com/shthed/capy and deployed at https://shthed.github.io/capy/.

---

## 1. Repository Layout & Targets

1. **`web/` — Updated Web Application & Single Source of Truth (Deployed to `/`)**
   - Built with **React 19**, **TypeScript**, **Vite 6**, **Tailwind CSS 4**, offscreen cached 2D canvas rendering (`PuzzleCanvas.tsx`), and a 5-strategy Web Worker puzzle engine (`web/src/engine/`).
   - Shared across both the Web deployment and the Android (`app/`) wrapper via `web/src/services/NativeBridge.ts`.
   - Technical reference for the puzzle engine: [`PUZZLE.md`](./PUZZLE.md); architecture and UI reference: [`WEB.md`](./WEB.md).
   - Keep asset references relative (`assets/...` and `base: './'` in `web/vite.config.ts`) so deployments work at the GitHub Pages root (`/`), PR preview paths (`/pull/<number>/`), and Android `WebViewAssetLoader` (`https://appassets.androidplatform.net/assets/www/`).

2. **`app/` — Unified Native Android Application (`com.capypaint.capy`, Deployed to `/capy.apk`)**
   - Lightweight native Android launcher wrapping `web/dist/` via AndroidX `WebViewAssetLoader` (`MainActivity.kt`) and `CapyAndroidBridge.kt` (`@JavascriptInterface`).
   - Architecture and native bridge specifications live in [`APP.md`](./APP.md).
   - Provides native Android tactile haptic feedback (`Vibrator` / `HapticFeedbackConstants`), hardware back gesture modal closing, native `PickVisualMedia` photo picker, `Intent.ACTION_SEND` image receiver, and persistent JSON disk backups (`filesDir/capy_saves`).

---

## 2. Build & Verification Commands

### Web Application (`web/`)
```bash
cd web
npm ci
npm run lint    # tsc --noEmit
npm run build   # tsc && vite build -> web/dist/
npm run dev     # Vite dev server on http://localhost:3000
npm run test:undo     # Tests undo timeline, long-press replay scrubber, and redo stack
npm run test:gameplay # Tests core tap region coloring and canvas state
npm run test:game     # Comprehensive Playwright browser suite
```

### Android Application (`app/`)
From the repository root:
```bash
./gradlew app:buildWeb             # Compiles web/ TypeScript/Vite frontend into web/dist via Gradle
./gradlew app:testDebugUnitTest    # Runs JUnit4 unit tests for the unified Android wrapper
./gradlew app:assembleDebug        # Syncs web/dist into app/src/main/assets/www and builds debug APK
./gradlew app:installDebug         # Deploys to device (ONLY run when explicitly requested by user)
```

---

## 3. Development & Git Workflow

- **Session kick-off**: Run `git fetch --all --prune` and rebase onto `origin/main` before starting work.
- **Branch naming**: Use short-lived feature branches (`automation/<change>` or `feature/<change>`) and open PRs so CI and preview deployments run automatically.
- **Unified CI & Branch Deployments ([`.github/workflows/deploy-branch.yml`](./.github/workflows/deploy-branch.yml))**:
  - Two-job pipeline separating unprivileged code execution from privileged deployment:
    - `build` job runs under read-only permissions (`contents: read`), compiling Web (`web/`), running Android unit tests, and assembling debug APK (`app/`). Builds across PRs execute concurrently in parallel without locking.
    - `deploy` job runs under privileged deployment permissions (`contents: write`, `pages: write`, `id-token: write`, `pull-requests: write`) and acquires the `deploy-pages` concurrency lock to serialize artifact publishing and PR comments.
  - Automatically skips CI builds and deployments when commits exclusively modify documentation (`paths-ignore: ['**.md', 'docs/**', 'notes/**', '.gitignore', 'LICENSE']`), consuming zero runner minutes.
  - `main` deploys `web/dist/` to `/` (`https://shthed.github.io/capy/`) and the Android APK to `/capy.apk` (`https://shthed.github.io/capy/capy.apk`).
  - Open PR branches deploy previews to `/pull/<number>/` and `/pull/<number>/capy.apk`.
  - `gh-pages` commits are squashed to a single orphan commit on every push so binary `.apk` files never accumulate in Git history.
- **Always wait for explicit confirmation before merging**: Never merge a pull request or push directly to `main` without explicit confirmation and approval from the user. Create the pull request, verify that CI tests and preview deployments pass, share the PR link and preview URL with the user, and wait for approval before merging.
- **PR preview lifecycle & cleanup ([`.github/workflows/cleanup-closed-pr.yml`](./.github/workflows/cleanup-closed-pr.yml))**:
  - While a PR is open, its preview is served at `https://shthed.github.io/capy/pull/<number>/`.
  - When a PR is closed or merged, `cleanup-closed-pr.yml` automatically deletes the `/pull/<number>/` preview directory from `gh-pages` and redeploys. Once merged, the changes are live on the root site `https://shthed.github.io/capy/`.
- **Show working thoughts & communication style**: Use telegraphic, participle-driven log style with zero filler. State actions directly using present participles (e.g. "Updating...", "Inspecting...", "Verifying...") rather than past-tense announcements or conversational filler ("I have updated...", "Now, ...", "First, ...", "Next, ..."). Explain what is being inspected, why, and what actions are occurring without robotic step headings.
- **Finish active task before switching**: Finish working on the current task instead of switching when the user sends an update with a new task, unless the comment directly relates to what is currently being worked on.
- **Plan before executing major changes**: When starting work on a big task, write out a clear plan of what you are going to do and how you are going to implement it before jumping into code edits.
- **No unsolicited Android device deployment**: Never run `./gradlew app:installDebug` unless explicitly requested by the user.
- **User-Friendly Pull Request Naming & Labels**:
  - **PR Titles**: Write clean, concise, human-readable titles focusing on user value (e.g. `Visual Screenshot Showcase Gallery & Automated Capture Pipeline`, `Google Maps-Style Zoom, Pan Momentum & Corner Navigation`, `Resume Panning After Pinch & Persistent Active Color`). Do **not** use raw git commit syntax or parenthesized prefixes (like `docs(readme): ...` or `feat(web): ...`) in PR titles.
  - **PR Labels**: Always attach appropriate GitHub label tags when opening or editing PRs:
    - `feature`: New gameplay features, controls, or user capabilities.
    - `fix`: Bug fixes, gesture corrections, or rendering fixes.
    - `docs`: User guides, README additions, architectural updates.
    - `ui`: Styling, themes, modal redesigns, visual gallery.
    - `testing`: E2E suites, Playwright test scripts, test harness.

- **Documentation hygiene**: Always remember to update documentation after making changes to UI elements, settings, functions, design, or architecture. Keep [`TODO.md`](./TODO.md), [`WEB.md`](./WEB.md), [`PUZZLE.md`](./PUZZLE.md), and [`APP.md`](./APP.md) in sync with architectural or runtime changes. Always remember to update [`WEB.md`](./WEB.md) with details of all functions, settings, UI elements, gestures, and engine features. Never use emojis in documentation files.
- **Export chat log and development summary to PR before merge**: When finalising a pull request ready for merge, compile a comprehensive summary of the entire conversation and development process (all user requests, architectural decisions, implementations, debugging notes, test execution results, and visual showcases) and post it as a comment on the pull request. This preserves a complete historical record of the development workflow and context directly on GitHub.

---

## 4. Android Coding Style & Warning Prevention (`app/`)

1. **Trailing Commas**: Include trailing commas in multiline parameter lists, Composable call arguments, and data class declarations.
2. **Clarifying Parentheses**: Wrap sub-expressions in explicit parentheses for complex logical or range operations.
3. **Android KTX Extensions**: Prefer `androidx.core.graphics.createBitmap(...)`, `bitmap.scale(width, height)`, and `sharedPreferences.edit { ... }`.
4. **Compose Modifiers**: Keep `modifier: Modifier = Modifier` as the first optional parameter in Composable signatures.
5. **Data Classes with Array Properties**: Explicitly override `equals()` and `hashCode()` using `contentEquals()` and `contentHashCode()` on any `data class` holding `IntArray` or `BooleanArray`.
6. **Zero-Allocation Engine Loops**: Use primitive array buffers over object allocations in high-frequency quantization, segmentation, and rendering loops.

---

## 5. Maintaining & Updating Dependencies

To keep all target environments (Web `web/` and Android `:app`) up to date with security patches and new library releases, follow these workflows:

### A. Web Application (`web/`)
1. **Check for outdated packages**:
   ```cmd
   cd web
   npm outdated
   ```
2. **Update within SemVer range & refresh lockfile**:
   ```cmd
   cd web
   npm update
   ```
3. **Verify linting & production build**:
   ```cmd
   cd web
   npm run lint    # tsc --noEmit
   npm run build   # tsc && vite build
   ```

### B. Native Android Application (`app/`)
1. **Centralized Version Catalog (`gradle/libs.versions.toml`)**:
   - All Android dependency versions are centralized in `gradle/libs.versions.toml`.
   - Inspect recommended updates using IDE inspection tools or `version_lookup`.
2. **`compileSdk` Alignment**:
   - When bumping Android libraries (e.g., `coreKtx`, `activityCompose`, `composeBom`), check that the library requirements align with `compileSdk` in `app/build.gradle.kts` (currently `compileSdk = 35`).
   - If a newer library version requires `compileSdk 36+` or API level 37+, update `compileSdk` in `:app` build script or keep the library pinned to the latest stable release supporting API 35.
3. **Verify Android builds & unit tests**:
   ```bash
   ./gradlew app:testDebugUnitTest
   ./gradlew app:assembleDebug
   ```
