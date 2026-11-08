# Technical Architecture: Capy Legacy Web v1 (`web1/`)

This document collects the technical, architectural, interaction, and styling specifications for the Legacy Vanilla JS Web v1 application in `web1/` (deployed at [https://shthed.github.io/capy/web1/](https://shthed.github.io/capy/web1/)). For the Updated React 19 Web App (`web/`), Android App (`app/`), and master monorepo roadmap, see [`README.md`](../README.md), [`TODO.md`](../TODO.md), [`PUZZLE.md`](../PUZZLE.md), and [`APP.md`](../APP.md).

---

## 1. Project Overview & Strategy

`web1/` turns any bitmap image into a color-by-number puzzle entirely in the browser using zero-build Vanilla JS. Everything inside `web1/` ships as static runtime files (`index.html`, `capy.js`, `puzzle-generation.js`, `render.js`, `styles.css`) so the single-page app can be served directly without a build step or bundling pipeline.

---

## 2. Runtime Map & Components

- **Host & Markup**: [`index.html`](./index.html)
  - Single-page host document containing markup, responsive preboot scaling scripts, settings sheet templates, and devtools hooks (`window.capy`, `window.capyGenerator`).
  - Precomputes `--ui-scale-auto` from viewport dimensions before stylesheet execution to eliminate first-paint layout shifts.
- **Styling**: [`styles.css`](./styles.css)
  - Single stylesheet containing theme tokens (light and dark mode), responsive breakpoints, command rail positioning, and component rules.
- **Runtime & Controllers**: [`capy.js`](./capy.js)
  - Runtime bootstrap, template utilities, state management, persistence, and renderer controller.
- **Segmentation & Quantization**: [`puzzle-generation.js`](./puzzle-generation.js)
  - Worker-friendly image quantization (k-means and posterize pipelines) and flood-fill segmentation.
- **Renderer Helpers**: [`render.js`](./render.js)
  - SVG and canvas drawing helpers.
- **Sample Fixtures**: [`capy.json`](./capy.json)
  - Bundled "Three Bands" sample puzzle for rapid offline boot and testing.

---

## 3. Detail Presets & Algorithms

### Detail Presets

The Low/Medium/High chips in the Generator and Settings panels configure generation options for built-in sample artwork:

| Preset | Colours | Approx. regions | Min region | Resize edge | Sample rate | Iterations | Smoothing | Use it when… |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Low detail** | 18 | ≈26 | 15 px² | 1216 px | 90% | 20 | 1 | Quick demos favouring broad shapes while keeping characters readable. |
| **Medium detail** | 26 | ≈20 | 100 px² | 1408 px | 95% | 24 | 1 | Balanced play sessions that capture lagoon reflections without overwhelming region counts. |
| **High detail** | 32 | ≈140 | 3 px² | 1536 px | 100% | 28 | 1 | Showcase captures where fur bands, ripples, and foliage clusters stay distinct. |

### Generation Algorithms

- **`local-kmeans`**: Standard k-means color clustering with configurable sampling rates and iteration counts.
- **`local-posterize`**: Bins pixels into evenly spaced RGB buckets, averages each bucket, and assigns pixels to the closest surviving colors.
- **`organic-slic`**: Scatters jittered grid seeds and executes a spatially aware k-means pass (similar to SLIC superpixels) to round boundaries and smooth gradients.
- **Slender Region Merging**: Post-flood pass identifies narrow regions where perimeter-to-area ratio exceeds a threshold (default 1.6) and merges them into adjacent color regions.

---

## 4. Pointer Interaction & Camera Controls

- **Pointer Staging**: `#viewport` captures pointer events while `#canvasStage` manages cursor states. Modifier keys (`Space`, `Alt`, `Ctrl`) convert drag motions into camera panning.
- **Pan Bounds Clamping**: `clampViewPanToPuzzleBounds` restricts pan offsets so the puzzle cannot be panned fully out of the viewport.
- **Smooth Zooming**: Mouse wheel scroll, pinch gestures, and `+`/`-` hotkeys funnel into `applyZoom`. CSS transforms handle transition frames while a debounced redraw (~80ms) refreshes sharp SVG outlines.
- **Region Fills**: Click events validate that the clicked pixel matches the active color swatch, flashing a mismatch indicator or marking the region filled before dispatching autosaves.

---

## 5. `window.capyGenerator` Developer API

For QA testing, automated smoke runs, and console inspection:

- `getState()`: Returns live runtime state (palette, fills, settings, renderer wiring).
- `setActiveColor(colorId, { flash, redraw })`: Selects active palette entry.
- `getRendererType()` / `listRenderers()` / `setRenderer(type)`: Inspects or switches active rendering backend.
- `loadFromDataUrl(dataUrl, metadata)`: Dynamically hydrates a puzzle from an exported data URL.
- `loadPuzzleFixture(puzzle)`: Loads parsed puzzle fixtures (e.g. `capy.json`).
- `setBackgroundColor(hex)`: Updates canvas stage backdrop color.
- `setUiScale(scale)`: Sets interface scale multiplier (e.g. `1.0` = 100%).
- `setTheme(theme)`: Switches between `'dark'` and `'light'` mode.
- `togglePreview(show)`: Toggles finished artwork preview overlay.
- `resetProgress()`: Clears painted region progress for active puzzle.
- `fillRegion(regionId, { ensureColor, flash, redraw })`: Programmatically paints a target region.
- `deleteAllSiteData()`: Purges localStorage and caches for clean reset.

---

## 6. CSS Architecture & Style Guide

*(Consolidated from `STYLEGUIDE.md`)*

Runtime styles reside in [`styles.css`](./styles.css). The only inline CSS in `index.html` is the preboot `:root` block establishing `--ui-scale-*` tokens before first paint.

### Styling Conventions
1. **Single Stylesheet**: All layout, theme tokens, and component styles stay in `web1/styles.css` to keep deployment assets predictable.
2. **Custom Properties First**: Shared values must use CSS custom properties (`--theme-sheet-border`, `--command-rail-top`) co-located in `:root` or `body[data-theme="light"]`.
3. **Attribute-Driven Variants**: Use `data-theme="light"|"dark"`, `data-orientation`, and `data-compact-commands` attributes rather than mutating inline style strings.
4. **Scoped Selectors**: Anchor rules to established container IDs (`#commandRail`, `#modalSheet`, `#canvasStage`) rather than loose element tags.
5. **Responsive Breakpoints**: Align media queries to established breakpoints (`max-width: 960px` for compact layouts, `max-width: 720px` for mobile viewports).

---

## 7. Build, Test & QA Commands

```bash
cd web1

# Install Playwright and local static server dependencies
npm install

# Provision Playwright Chromium headless browser (first run only)
npm run setup:playwright

# Run automated smoke test suite (verifies both web1 and web/dist)
npm test --silent

# Run local development static server (http://localhost:8000)
npm run dev
```
