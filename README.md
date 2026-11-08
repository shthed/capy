# Capy: Color-by-Number Suite (Web, Web1 Legacy & Android)

[![Web](https://img.shields.io/badge/Web-React%2019%20%2B%20Vite%206-blue.svg)](https://shthed.github.io/capy/)
[![Web1](https://img.shields.io/badge/Legacy%20Web-Vanilla%20JS-amber.svg)](https://shthed.github.io/capy/web1/)
[![Android](https://img.shields.io/badge/Platform-Android%20Jetpack%20Compose-green.svg)](https://developer.android.com)
[![Kotlin](https://img.shields.io/badge/Language-Kotlin%20%2F%20TypeScript-purple.svg)](https://kotlinlang.org)

**Capy** is a serene, high-performance color-by-number generator and player across web and Android platforms. Import any photo or drawing from your device or play built-in sample artwork — Capy segments images into crisp numbered color regions, builds an adaptive palette, and lets you paint with tap or drag-to-color **Paint Mode**.

- **Launch Updated Web App (`web/`)**: [https://shthed.github.io/capy/](https://shthed.github.io/capy/)
- **Launch Legacy Web App v1 (`web1/`)**: [https://shthed.github.io/capy/web1/](https://shthed.github.io/capy/web1/)
- **Download Android APK (`app/`)**: [https://shthed.github.io/capy/capy.apk](https://shthed.github.io/capy/capy.apk)

---

## Repository Structure

| Directory | Target | Tech Stack | Hosted Path |
| :--- | :--- | :--- | :--- |
| **[`web/`](./web)** | **Updated Web App (Single Source of Truth)** | React 19, TypeScript, Vite 6, Tailwind CSS 4, Web Workers | `/` |
| **[`web1/`](./web1)** | **Legacy Web App (v1)** | Zero-build Vanilla JS (`capy.js`, `puzzle-generation.js`) + Playwright | `/web1/` |
| **[`app/`](./app)** | **Unified Android App** | Kotlin, AndroidX WebKit (`WebViewAssetLoader`), Native Haptics & Storage Bridge | `/capy.apk` |
| **[`app1/`](./app1)** | **Legacy Native Android App (v1)** | Kotlin, Jetpack Compose, Material 3, Custom K-Means Engine | `:app1` |

---

## 🎨 How to Play

1. **Starting a Puzzle**:
   - **Sample Artwork**: Built-in sample artwork (*Capybara*, *Capy Forest*, *Snail Guitar*) is ready on launch.
   - **Importing Photos**: Tap the **Image / Upload** icon to convert any photo or drawing from your device into a playable puzzle.
2. **Selecting & Painting Colors**:
   - Tap any numbered color swatch in the bottom **Palette Dock**.
   - Tap regions on the canvas matching the selected color number to paint them, or switch to **Easy Mode** (auto-selects and fills the tapped region's color).
3. **Paint Mode (Drag-to-Color)**:
   - Toggle the **Paint Mode** brush button to continuously fill matching regions as you drag across the canvas.
4. **Canvas Controls & Gestures**:
   - **Pinch-to-Zoom / Mouse Wheel**: Zoom up to **10x** for micro-regions.
   - **Pan / Drag**: Click-and-drag or two-finger drag to pan around the zoomed canvas.
5. **Hints & Preview**:
   - **Hint Assist**: Tap the **Hint** lightbulb icon or re-tap the active swatch to center and pulse an unpainted region.
   - **Preview Finished Artwork**: Toggle the **Preview** eye icon in the top bar to inspect the source artwork without region boundaries.
6. **Settings, Generator Tuning & Saves**:
   - Open **Settings** to customize Region Fill Style (*Original Detail* vs *Solid Palette*), Canvas Background, Palette Swatch Order (*Number*, *Remaining*, *Hue Rainbow*, *Lightness*), Hint styles, Generator tuning presets (*Low*, *Medium*, *High*, *Custom*), and saved puzzle sessions.

---

## 🛠️ Architecture & Documentation

- **Master Project Roadmap & TODO**: [`TODO.md`](./TODO.md)
- **Puzzle Generation Engine Reference**: [`PUZZLE.md`](./PUZZLE.md)
- **Unified Android Launcher Architecture & Native Bridge**: [`APP.md`](./APP.md)
- **Legacy Android v1 Architecture & Roadmap**: [`app1/APP1.md`](./app1/APP1.md)
- **Legacy Web v1 Technical Reference & Style Guide**: [`web1/WEB1.md`](./web1/WEB1.md)
- **Contributor & Agent Playbook**: [`AGENTS.md`](./AGENTS.md)

---

## 💻 Build, Run & Test Commands

### 1. Updated Web App (`web/`)
```bash
cd web

# Install dependencies
npm install

# Start development server (http://localhost:3000)
npm run dev

# Run TypeScript typecheck
npm run lint

# Build production bundle (outputs to web/dist/)
npm run build
```

### 2. Legacy Web App v1 (`web1/`)
```bash
cd web1

# Install dependencies
npm install

# Start local static server (http://localhost:8000)
npm run dev

# Provision Playwright Chromium and run smoke tests
npm run setup:playwright
npm test
```

### 3. Native Android App (`app/`)
Run Gradle commands from the repository root:
```bash
# Run Android unit tests
./gradlew app:testDebugUnitTest

# Build debug APK
./gradlew app:assembleDebug

# Install debug APK to connected device/emulator
./gradlew app:installDebug
```

---

## 🔄 Keeping Dependencies Updated

Detailed instructions for checking and updating dependencies across all targets are documented in [`AGENTS.md`](./AGENTS.md#5-maintaining--updating-dependencies):

- **Web (`web/`)**: Run `cd web && npm outdated` and `npm update`, then verify with `npm run lint` and `npm run build`.
- **Legacy Web (`web1/`)**: Run `cd web1 && npm update`, then verify with `npm test`.
- **Android (`app/` & `app1/`)**: Update version catalog in [`gradle/libs.versions.toml`](./gradle/libs.versions.toml), ensure `compileSdk` alignment, then verify with `./gradlew app:testDebugUnitTest app1:testDebugUnitTest` and `./gradlew app:assembleDebug app1:assembleDebug`.

