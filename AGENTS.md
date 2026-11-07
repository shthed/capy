# Agent Instructions — Capy Monorepo (`web/`, `web1/`, `app/`)

Capy is a multi-platform color-by-number suite living in https://github.com/shthed/capy and deployed at https://shthed.github.io/capy/.

---

## 1. Repository Layout & Targets

1. **`web/` — Updated Web Application (Deployed to `/`)**
   - Built with **React 19**, **TypeScript**, **Vite 6**, **Tailwind CSS 4**, and a Web Worker puzzle engine (`web/src/engine/`).
   - Technical reference for the puzzle engine: [`PUZZLE.md`](./PUZZLE.md).
   - Keep asset references relative (`assets/...` and `base: './'` in `web/vite.config.ts`) so deployments work at both the GitHub Pages root (`/`) and PR preview paths (`/pull/<number>/`).

2. **`web1/` — Legacy Web Application v1 (Deployed to `/web1/`)**
   - Zero-build vanilla JavaScript runtime (`web1/index.html`, `web1/capy.js`, `web1/puzzle-generation.js`, `web1/styles.css`, `web1/settings-menu.json`).
   - Documentation lives in [`web1/docs/`](./web1/docs/) (`TECH.md`, `ONBOARDING.md`, `ROADMAP.md`, `STYLEGUIDE.md`, `TODO.md`, `CHANGELOG.md`).
   - Playwright smoke tests and GitHub Pages helper scripts live in `web1/tests/` and `web1/scripts/`.

3. **`app/` — Native Android Application (`com.capypaint.capy`)**
   - Built with **Kotlin**, **Jetpack Compose**, **Material 3**, and **Gradle 9.3.1**.
   - Technical architecture & V2 GZIP binary save specification: [`app/CAPY.md`](./app/CAPY.md).
   - Master development & optimization roadmap: [`app/CAPY-TODO.md`](./app/CAPY-TODO.md).

---

## 2. Build & Verification Commands

### Updated Web (`web/`)
```bash
cd web
npm ci
npm run lint    # tsc --noEmit
npm run build   # tsc && vite build -> web/dist/
npm run dev     # Vite dev server on http://localhost:3000
```

### Legacy Web v1 (`web1/`)
```bash
cd web1
npm ci
npm run setup:playwright   # npx playwright install --with-deps chromium
npm test --silent          # Runs Playwright smoke suite via ./scripts/run-tests.js
npm run dev                # Serves web1/ on http://localhost:8000
```

### Android App (`app/`)
From the repository root:
```bash
./gradlew app:testDebugUnitTest   # Runs all JUnit4 unit test suites in app/src/test/
./gradlew app:assembleDebug       # Builds debug APK
./gradlew app:installDebug        # Deploys to device (ONLY run when explicitly requested by user)
```

---

## 3. Development & Git Workflow

- **Session kick-off**: Run `git fetch --all --prune` and rebase onto `origin/main` before starting work.
- **Branch naming**: Use short-lived feature branches (`automation/<change>` or `feature/<change>`) and open PRs so CI and preview deployments run automatically.
- **Unified CI & Branch Deployments ([`.github/workflows/deploy-branch.yml`](./.github/workflows/deploy-branch.yml))**:
  - Runs Android unit tests + debug APK build (`android`), Web + Web1 build & Playwright smoke tests (`web`), and GitHub Pages deployment (`deploy`).
  - `main` deploys `web/dist/` to `/` (`https://shthed.github.io/capy/`), `web1/` to `/web1/` (`https://shthed.github.io/capy/web1/`), and the Android APK to `/capy.apk` (`https://shthed.github.io/capy/capy.apk`).
  - Open PR branches deploy previews to `/pull/<number>/`, `/pull/<number>/web1/`, and `/pull/<number>/capy.apk`.
  - `gh-pages` commits are squashed to a single orphan commit on every push so binary `.apk` files never accumulate in Git history.
- **No unsolicited Android device deployment**: Never run `./gradlew app:installDebug` unless explicitly requested by the user.
- **Documentation hygiene**: Keep [`TODO.md`](./TODO.md), [`PUZZLE.md`](./PUZZLE.md), [`app/CAPY.md`](./app/CAPY.md), [`app/CAPY-TODO.md`](./app/CAPY-TODO.md), and [`web1/docs/TECH.md`](./web1/docs/TECH.md) in sync with architectural or runtime changes.

---

## 4. Android Coding Style & Warning Prevention (`app/`)

1. **Trailing Commas**: Include trailing commas in multiline parameter lists, Composable call arguments, and data class declarations.
2. **Clarifying Parentheses**: Wrap sub-expressions in explicit parentheses for complex logical or range operations.
3. **Android KTX Extensions**: Prefer `androidx.core.graphics.createBitmap(...)`, `bitmap.scale(width, height)`, and `sharedPreferences.edit { ... }`.
4. **Compose Modifiers**: Keep `modifier: Modifier = Modifier` as the first optional parameter in Composable signatures.
5. **Data Classes with Array Properties**: Explicitly override `equals()` and `hashCode()` using `contentEquals()` and `contentHashCode()` on any `data class` holding `IntArray` or `BooleanArray`.
6. **Zero-Allocation Engine Loops**: Use primitive array buffers over object allocations in high-frequency quantization, segmentation, and rendering loops.
