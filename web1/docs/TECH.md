# Capy Legacy Web v1 (`web1/`) — Technical Guide

Play the Legacy Web v1 build at https://shthed.github.io/capy/web1/ (branch previews deploy
to `/pull/<number>/web1/`, alongside the Updated Web App at `/` and Android APK at `/capy.apk`).
Repository: https://github.com/shthed/capy.

This document collects the technical, architectural, and QA details for the Legacy Vanilla JS Web v1 target (`web1/`). For the Updated React 19 Web App (`web/`), Android App (`app/`), and cross-project roadmap, see the root [`README.md`](../../README.md), [`TODO.md`](../../TODO.md), [`PUZZLE.md`](../../PUZZLE.md), and [`app/CAPY.md`](../../app/CAPY.md).

## Project Overview (`web1/`)

`web1/` turns any bitmap image into a colour-by-number puzzle entirely in the
browser using zero-build Vanilla JS. Everything inside `web1/` ships as static
runtime files (`index.html`, `capy.js`, `puzzle-generation.js`, `render.js`, `styles.css`)
so the single-page app can be served directly without a build step.

## Repository Map (`web1/`)

- **Runtime (`web1/`)**
  - `web1/index.html` – Single-page host document containing markup and wiring for renderer selection, saves, generator controls, and automation helpers.
  - `web1/styles.css` – Primary stylesheet housing theme tokens, responsive layout rules, and component styles.
  - `web1/capy.js`, `web1/puzzle-generation.js`, `web1/render.js` – Runtime, renderer helpers, and puzzle generation logic.
  - `web1/capy.json` – Bundled puzzle fixture used for fast boot and previews.
- **Documentation (`web1/docs/`)**
  - [`AGENTS.md`](../../AGENTS.md) – Monorepo contributor workflow and automation expectations.
  - [`README.md`](../../README.md) – Player-facing quick start and monorepo overview.
  - [`TODO.md`](../../TODO.md) & [`web1/docs/TODO.md`](./TODO.md) – Monorepo and `web1/` task checklists.
  - `web1/docs/TECH.md` – This technical reference.
  - `web1/docs/STYLEGUIDE.md` – CSS conventions and maintenance tips for `web1/styles.css`.
- **Testing & QA (`web1/tests/` & `web1/scripts/`)**
  - `web1/tests/ui-load-page.spec.js` – Playwright smoke suite verifying both `web1/index.html` and the built `web/dist/` bundle in headless Chromium.
  - `web1/scripts/run-tests.js` – Harness invoked by `npm test --silent`.
  - `web1/package.json` & `web1/package-lock.json` – npm scripts (`npm run dev`, `npm test`, `npm run setup:playwright`).
- **CI & Deployment (`.github/workflows/`)**
  - `.github/workflows/deploy-branch.yml` – Unified CI & GitHub Pages workflow: runs `android` (`./gradlew app:testDebugUnitTest app:assembleDebug`), `web` (`web` build + `web1` & `web` Playwright smoke tests), and `deploy` (deploys `web/dist/` to `/`, `web1/` to `/web1/`, and `capy.apk` to `/capy.apk`, squashing `gh-pages` history to a single orphan commit).
  - `.github/workflows/cleanup-branches.yml` & `.github/workflows/cleanup-closed-pr.yml` – Prunes merged branches and removes closed PR preview directories (`pull/<number>/`) from `gh-pages` using `web1/scripts/cleanup-branches.mjs` and `web1/scripts/cleanup-gh-pages-previews.mjs`.

## Deployment & Branch Previews

Branch previews and production deployments are driven by `.github/workflows/deploy-branch.yml`:

1. **Parallel Build & Test (`android` + `web` jobs)**:
   - `android` runs unit tests and builds `app-debug.apk` (`capy-debug-apk` artifact) using cached Gradle state.
   - `web` builds `web/` (`web-dist` artifact) and runs Playwright smoke tests in `web1/` against both `web1/` and `web/dist/` using cached npm & Playwright Chromium binaries.
2. **Artifact Sync & Squashed `gh-pages` Commit (`deploy` job)**:
   - Downloads `web-dist` and `capy-debug-apk` without rebuilding, syncs `web/dist/` to the target root (`.` for `main`, `pull/<pr>` for open PRs), copies `capy.apk`, and syncs `web1/` runtime files to `web1/`.
   - Commits `gh-pages` as a single parentless orphan commit (`git checkout --orphan gh-pages-squashed && git push --force origin gh-pages`) so binary APK blobs never accumulate in Git history, then deploys to GitHub Pages and comments the preview + APK links on the PR.

### Keeping branch directories and artifacts lean

- **Prune Git branches & previews regularly.** `.github/workflows/cleanup-branches.yml` (daily cron) and `.github/workflows/cleanup-closed-pr.yml` (on PR close) invoke
  `web1/scripts/cleanup-branches.mjs` and `web1/scripts/cleanup-gh-pages-previews.mjs`.
- **Squashed `gh-pages` history.** Both `.github/workflows/deploy-branch.yml` and the cleanup workflows commit to `gh-pages` using a single parentless orphan commit (`git checkout --orphan gh-pages-squashed && git push --force origin gh-pages`) so binary `capy.apk` files never accumulate in Git history.
- **Automatic PR comments.** At the end of `.github/workflows/deploy-branch.yml`, open PRs automatically receive an updated `<!-- capy-pages-preview -->` comment with direct links to the workflow run, Updated Web Preview (`/pull/<pr>/`), Legacy Web1 Preview (`/pull/<pr>/web1/`), and Android Debug APK (`/pull/<pr>/capy.apk`).

## UI & Feature Tour

### Headline Features

- **Instant image import.** Drag-and-drop or use the picker to feed bitmaps or previously exported JSON puzzles straight into the generator pipeline; finished puzzles now export only vector geometry so no raster artifacts linger in saves or fixtures, and loads regenerate region maps from the attached vector scene.
- **Saves tab quick start.** The Saves tab opens with an **Upload Image** button and lists manual slots. Entries carry labels and timestamps without embedded previews so vector-only saves stay lean. The active slot stays pinned to the top with an "Autosaving this slot" badge so you always know which snapshot will keep tracking progress. Manual snapshot tools, export shortcuts, and the **Reset puzzle progress** control sit after the save cards so you can bookmark or rewind without digging through other menus. Export shortcuts now include a JSON puzzle package and an SVG snapshot that embeds palette colours, region centres, and fill state styling for offline archiving.
- **Built-in vector sample.** The bundled "Three Bands" stripes load automatically on boot when no saves exist, providing a tiny vector-backed scene for renderer smoke checks.
- **Sample detail presets.** Low/Medium/High chips tune colour counts, resize targets, k-means iterations, and smoothing passes so QA can switch between breezy ≈26-region boards, balanced ≈20-region sessions, or high-fidelity ≈140-region runs.
- **Detailed debug logging.** The **Help & logs** tab in the Settings dialog announces sample loads, fills, hints, zooms, background tweaks, fullscreen toggles, ignored clicks, and now mirrors console warnings/errors (including unhandled rejections) so QA can confirm issues without opening DevTools. Service worker registration, cache limits, and skip reasons also stream into this log alongside a System summary of the active cache.
- **Embedded documentation.** The same **Help & logs** tab loads the hosted README (`https://shthed.github.io/capy/README`) for in-app gameplay and contributor notes.
- **Configurable generator.** Choose between local algorithms (k-means clustering or the posterize-and-merge pass today, with
  room for hosted services) and adjust palette size, minimum region area, resize detail, sampling, iteration count, and smoothing
  passes before rebuilding the scene. Iterations rerun the clustering stage for tighter centroids; smoothing passes perform
  majority blending to fold stray pixels into their neighbours ahead of segmentation.
- **Pinned settings cog.** A single Settings button lives in a floating cog parked in the top-right by default; players can drag it anywhere on-screen and the saved position persists with other Settings preferences so the launcher stays reachable.
- **Stable first paint.** An inline head script precomputes `--ui-scale-auto` from the current viewport and seeds `--ui-scale` so the interface renders at its final size before the runtime finishes booting.
- **Palette guidance.** Choosing a swatch pulses every matching region, flashing when a colour is complete so it is obvious where to paint next. Players can disable the matching-region hint in Settings if they prefer to scout manually.
- **Customisable background.** Settings lets you pick a backdrop colour; outlines and numbers flip contrast automatically.
- **Progress persistence.** Every stroke rewrites the active save slot; additional manual snapshots live in the **Saves** tab with rename/export/delete controls. Storage quota usage stays visible there.
- **Previewed snapshots.** Vector-only saves no longer embed preview thumbnails; slots list labels and timestamps instead of screenshot data URLs.
- **Startup restore priority.** Launching the app resumes from the most recent save (preferring the active slot) and falls back to the bundled sample only when nothing is stored.
- **Settings persistence.** Gameplay, hint, control, and appearance preferences now sync to `localStorage` (`capy.settings.v1`) so `capy.json` only ships puzzle data. Settings writes commit immediately so UI tweaks survive reloads even if puzzle autosave is still pending, and puzzle loads leave those stored preferences intact. Palette sorting mode selections share the same store, so switching to options like **Sort Colours → Spectrum** survives a refresh. The Settings dialog also records whether it was open so the sheet can reopen automatically after a reload. Stored settings now carry a `versionDate` stamp (current: `2025-12-06`) and stale payloads or old cookies are purged automatically when formats change.

### Detail Presets

The Low/Medium/High chips in the Generator and Settings panels toggle tuned generator options for the bundled vignette:

| Preset | Colours | Approx. regions | Min region | Resize edge | Sample rate | Iterations | Smoothing | Use it when… |
| ------ | ------- | --------------- | ---------- | ----------- | ----------- | ---------- | --------- | ------------ |
| Low detail | 18 | ≈26 | 15 px² | 1216 px | 90% | 20 | 1 | Quick demos that favour broad shapes while keeping characters readable. |
| Medium detail | 26 | ≈20 | 100 px² | 1408 px | 95% | 24 | 1 | Balanced play sessions that capture lagoon reflections without overwhelming region counts. |
| High detail | 32 | ≈140 | 3 px² | 1536 px | 100% | 28 | 1 | Showcase captures where fur bands, ripples, and foliage clusters should stay distinct. |

Each preset reloads the sample immediately, updates generator sliders, and stamps the debug log. The remembered preset persists across sessions once you switch.

### Generator algorithms & tuning

- **Default slider positions.** New imports bias toward simpler layouts: 12 target colours, a 60 px² minimum region size, a
  640 px longest edge when resizing the source, 50% sampling, 12 k-means iterations, and 0 smoothing passes.
- **Algorithms.** The generator select box maps to `GENERATION_ALGORITHM_CATALOG` inside `puzzle-generation.js`. `local-kmeans`
  runs k-means clustering with user-controlled sampling and iteration counts. `local-posterize` bins pixels into evenly spaced
  RGB buckets, averages each bucket, and assigns pixels to the closest surviving colours. `organic-slic` scatters jittered grid
  seeds and performs a spatially aware k-means pass (similar to SLIC superpixels) to cluster nearby colours together, rounding
  region boundaries and keeping gradients smoother for more natural, curved islands. New entries can represent hosted
  services—UI copy stays service-agnostic so remote providers can drop in without layout tweaks.
- **Iterations.** Iterations rerun the clustering loop. Higher counts push centroids closer to their most representative
  pixels, improving palette fidelity at the cost of longer runs.
- **Smoothing passes.** Each pass performs a weighted majority filter across the assignment map, blending stray pixels into
  neighbouring regions before segmentation. Set it to 0 to keep posterized edges crisp; bump it up when noise or tiny islands
  sneak through.
- **Region simplification.** Post-flood merges now cap the number of sweeps (default 12) and optionally collapse slender regions
  whose perimeter-to-area ratio exceeds a configurable limit (default 1.6). Set the ratio to 0 to disable the slender merge and
  preserve finer detail.

### UI Guide

- **Command rail** – The floating Menu cog sits in the top-right by default. Drag it anywhere on-screen (the coordinates persist in Settings) and tap to open the menu; the Menu opens straight to the Settings list with Quick actions for the preview toggle and fullscreen control before flowing into gameplay preferences.
- **Viewport surface** – Hosts the interactive puzzle (`data-testid="puzzle-canvas"`). Renders outlines, numbers, and filled regions with a viewBox-aligned SVG so zooming stays crisp. Drag to reposition, scroll/pinch/double-tap to zoom; mobile gestures feed directly into the stage.
- **Preview mode** – Temporarily renders every region in its target colour for quick comparisons.
- **Settings dialog** – Opens centered over the playfield and can be dragged by the title bar while staying clamped inside the viewport. A sticky nav column now starts with **Settings** as the default tab and keeps **Saves** close by for the save manager. **Settings** consolidates preview/fullscreen quick actions, play style (auto-advance, tap forgiveness, region numbers), hint toggles, and interface size while hiding advanced assists, display, and control tweaks until **Advanced controls** is enabled from the **Debug** tab. That toggle also reveals **Guides** plus deeper controls in **Create** (puzzle builder) and **Debug**. The rail stays visible while the content pane scrolls and collapses into a horizontal, scrollable strip on mobile so sections remain reachable. Palette sorting covers region number, remaining regions, colour name, a rainbow spectrum order based on OKLCH hue, a warm→cool temperature pass, and perceptual lightness. Sheet surfaces lean on the minimal-library palette (dark: `rgba(9, 13, 24, 0.94)` with a desaturated slate border; light: near-solid white with cool-gray outlines). Hover, active, and focus states pull from the refreshed `--theme-sheet-button-hover-*`, `--theme-sheet-button-active-*`, and `--theme-sheet-focus-ring` tokens, and range sliders keep **Default** buttons for quick resets. The sheet avoids scale/slide animations so the dialog appears immediately, and the embedded README preloads in the background so the Guides section is ready when opened.
- **JSON-driven menu.** All Settings tabs and controls are defined in `settings-menu.json` and embedded into the document via the `#settingsDefinition` JSON script, then rendered at runtime. Update that JSON to add or reorder controls instead of editing the HTML shell directly.
- **Detail presets** – Onboarding hints and Settings surface the active preset with live captions describing colours, min region size, resize edge, and approximate region counts.
- **Start screen** – Launch puzzles, reload the sample, and highlight manual snapshot tips. **Choose an image** now prefers the
  File System Access picker (when supported) so users can grant read permissions for local files; it falls back to the hidden
  `<input type="file">` for older browsers. Selected images are cached in the shared runtime cache instead of being serialised
  to `localStorage`, so large files no longer overflow save storage. The **Load capybara sample** shortcut mirrors the Generator
  tab’s detail presets, and resets remain available from the Saves tab once the menu is open.
- **Palette dock** – Horizontal scroller anchored to the bottom. Flat colour tiles adjust label contrast automatically, collapse completed colours, and expose tooltips plus `data-color-id` attributes for automation. Completed swatches drop from the picker without renumbering the remaining entries so labels and hints keep stable references.

## Interaction & Architecture Notes

### Pointer Interaction Flow

- **Pointer staging.** `#viewport` captures pointer events (with `#canvasStage` handling cursor affordances) so blank space around the puzzle still responds to drags and pinches. `handlePanStart` consults `state.settings.mouseControls` to determine each mouse button’s click and click+drag behaviour (fill, select, select+fill, zoom, or pan) while modifier keys (Space/Alt/Ctrl/Meta) still force a pan session. Touch pointers are tracked individually so single-finger drags can promote into pans while multi-touch sessions trigger pinch zooming.
- **Pan bounds.** `clampViewPanToPuzzleBounds` reins in `viewState.panX`/`panY` so the puzzle surface can’t be flung fully outside the viewport. Up to half the artwork can leave the stage, which keeps edges reachable without letting the screen go blank.
- **Pan promotion.** When a drag is mapped to panning, `handlePanMove` watches for ~4px of travel before calling `beginPanSession`, capturing the pointer, and updating `viewState` so the vector surface glides under the cursor.
- **Drag fills & zooms.** Custom drag actions (“Fill while dragging” or “Drag to zoom”) stream through `handleMouseDragFill`/`handleMouseDragZoom`, filling regions the pointer sweeps across or applying zoom deltas relative to the cursor. The helpers suppress the subsequent click event so the configured drag behaviour doesn’t trigger an extra fill.
- **Teardown safeguards.** `handlePanEnd` handles `pointerup`, `pointercancel`, and `lostpointercapture` so releasing outside the viewport still resets cursors, finalises drag sessions, and clears state.
- **Zoom input.** Scroll events, `+`/`-` shortcuts, drag-to-zoom mappings, pinch gestures, and helper calls all funnel through `applyZoom`, which recalculates scale, recentres the viewport, and logs the latest percentage. The helper now pushes the zoom multiplier straight into a CSS custom property on `#canvasTransform`, letting the compositor handle the animation while a debounced redraw (≈80 ms) refreshes labels and outlines once the gesture settles. Wheel deltas still map to exponential steps and the viewport clamps between the fitted scale (100%) and the configurable ceiling (default 1200%) so you can dive into tiny regions without raster seams or blurry edges.
- **Region clicks.** The surface click handler validates that a puzzle and active colour exist, resolves the clicked pixel to a region, and either flashes a mismatch warning or marks the region filled before re-rendering. Left-click fills respect the configured mouse mapping; other buttons funnel through `finalizeMouseSession` before any click fires.

### Code Architecture Tour

- **Module entrypoint.** `index.html` owns markup, styles, and the JSON settings definition, while `capy.js` houses the runtime logic (templates, renderer boot, persistence, and settings rendering). Keep the developer-map comment in `index.html` aligned with the module’s structure.
- **Preboot viewport metrics.** A blocking `<script>` in the `<head>` seeds UI scale variables, viewport padding, and the orientation/compact flags before the stylesheet paints; a companion snippet at the top of `<body>` mirrors those attributes so the runtime boot avoids first-paint jumps when `handleViewportChange` recalculates metrics.
- **Public testing surface.** `window.capyGenerator` exposes helpers (`loadFromDataUrl`, `loadPuzzleFixture`, `togglePreview`, etc.) so automation and manual experiments can orchestrate the app without touching internals. Recent renderer work also surfaced `getRendererType()`, `listRenderers()`, `setRenderer(type)`, `registerRenderer(type, factory)`, and `unregisterRenderer(type)` so tests can assert the active backend or load experimental renderers without patching private state.
- **Inspectable globals.** `window.capy` aggregates immutable constants, the parsed settings definition, and the active `capyRuntime` handle so testers can inspect presets or tab layouts without re-parsing the module.
- **Pan/zoom subsystem.** `viewState` tracks transforms for `#canvasStage` and `#canvasTransform`; helpers like `applyZoom`, `resetView`, and `applyViewTransform` keep navigation smooth across wheel, keyboard, and drag gestures.

### Compact UI patterns (no framework)

The runtime must stay build-free and avoid shipping large bundled frameworks. To trim UI code without pulling in minified dependencies:

- **Lean on `<template>` clones.** Define reusable fragments (e.g., palette items or save rows) in `index.html`, call `template.content.cloneNode(true)`, and toggle `dataset` flags or text content during hydration instead of re-creating DOM trees by hand.
- **Delegate events.** Attach a single listener to the container (palette rail, save list, settings tabs) and branch on `event.target.closest('[data-action="..."]')` so new buttons can be added in markup without extra wiring.
- **Small helper utilities only.** When repetition is unavoidable, add a tiny helper (e.g., `renderList(container, items, renderItem)`) in a shared module and reuse it rather than adopting a state library. Keep helpers self-contained and tree-shake-free.
- **Limit inline state.** Store UI state on elements via `dataset` or `aria-*` attributes and derive rendering from those flags so refresh functions can stay short and predictable.

These patterns keep the DOM logic compact while preserving the zero-build, zero-framework runtime constraints.
- **Puzzle rendering pipeline.** `renderPuzzle` now feeds the SVG renderer directly. Each frame rebuilds region paths from cached geometry, fills unfinished regions with a uniform overlay, and strokes outlines without juggling cached canvases or preview layers.
- **Generation & segmentation.** `createPuzzleData` looks up the requested generator in `GENERATION_ALGORITHM_CATALOG`, runs the matching quantizer via `performQuantization` (k-means or the posterize-and-merge pipeline today, with scaffolding for future services), smooths assignments, and then calls `segmentRegions`. Local uploads are resized against the configured detail max and sampled to keep processing fast, but the resulting puzzle payload only preserves vector geometry plus palette metadata—no raster snapshots or packed region maps are persisted with saves or exports. Region maps are rebuilt from vector scenes on load when a saved payload omits them. Regeneration and fixtures reuse the same entry point.
- **Persistence helpers.** `persistSaves`, `loadSavedEntries`, and `serializeCurrentPuzzle` manage puzzle snapshots while `getUserSettingsSnapshot`/`persistUserSettings` keep preferences on their own track; exports now ship puzzle data without bundling user settings. Saves skip preview thumbnails entirely to keep storage purely vector and predictable.

### `window.capyGenerator` API Reference

Capy’s developer API exposes a minimal surface for automation, QA smoke tests, and manual debugging. Every method lives on `window.capyGenerator` and mirrors the runtime behaviour documented below:

- `getState()`
  - **Parameters:** None.
  - **Purpose:** Returns the live runtime state object (palette, fills, settings, renderer wiring) for inspection. Palette
    metadata from puzzle payloads (for example `paletteMeta` from `capy.json`) hydrates into `state.paletteMetadata` for
    smoke tests that check palette provenance.
  - **Side effects:** None; the object is shared with the app, so treat it as read-only.
- `setActiveColor(colorId, { flash, redraw })`
  - **Parameters:** `colorId` (number or string), optional `flash`/`redraw` booleans.
  - **Purpose:** Selects a palette entry for subsequent fills.
  - **Side effects:** Optionally flashes matching regions, recentres the palette scroll, re-renders palette UI, logs the selection, and schedules an autosave when the colour changes.
- `getRendererType()`
  - **Parameters:** None.
  - **Purpose:** Reveals the active renderer backend identifier (e.g. `"canvas"`, `"webgl"`, `"svg"`).
  - **Side effects:** None.
- `listRenderers()`
  - **Parameters:** None.
  - **Purpose:** Lists renderer identifiers registered with the active controller.
  - **Side effects:** Logs an error and returns an empty array if the controller throws.
- `setRenderer(type)`
  - **Parameters:** `type` (string identifier).
  - **Purpose:** Switches the rendering backend.
  - **Side effects:** Applies the new renderer without autosaving/logging, then triggers canvas sizing and a redraw when the renderer changes.
- `registerRenderer(type, factory)`
  - **Parameters:** `type` (string identifier), `factory` (renderer factory function).
  - **Purpose:** Adds a custom renderer implementation to the controller.
  - **Side effects:** When the new renderer becomes active, the canvas resizes and the puzzle redraws. Logs an error if registration fails.
- `unregisterRenderer(type)`
  - **Parameters:** `type` (string identifier).
  - **Purpose:** Removes a previously registered renderer backend.
  - **Side effects:** Returns `false` when the controller rejects the request and logs thrown errors.
- `loadFromDataUrl(dataUrl, metadata)`
  - **Parameters:** `dataUrl` (string), optional `metadata` object/string used for titles.
  - **Purpose:** Imports a puzzle or image payload from a string generated by Capy.
  - **Side effects:** Resets the puzzle UI, updates source metadata, hides the start screen, logs the activity, and kicks off the asynchronous load pipeline.
- `loadPuzzleFixture(puzzle)`
  - **Parameters:** Puzzle snapshot object (for example, the parsed contents of `capy.json`).
  - **Purpose:** Loads one of the bundled sample puzzles.
  - **Side effects:** Logs an error and returns `false` when given a non-object value; otherwise resets the UI, applies the puzzle result, hides the start screen, and returns whether hydration succeeded. Smoke tests rely on fixtures in
    `project/tests/fixtures/puzzle-fixtures.js` to exercise this pathway.
- `setBackgroundColor(hex)` / `setStageBackgroundColor(hex)`
  - **Parameters:** Hex colour string.
  - **Purpose:** Updates either the app chrome background or the puzzle stage backdrop.
  - **Side effects:** Persists the preference and refreshes themed UI tokens.
- `setUiScale(scale)`
  - **Parameters:** Numeric scale multiplier (1 = 100%).
  - **Purpose:** Overrides the interface scale.
  - **Side effects:** Persists the preference and recalculates sizing tokens.
- `setTheme(theme)`
  - **Parameters:** Theme identifier string.
  - **Purpose:** Switches between theme presets.
  - **Side effects:** Persists the preference and reapplies theme tokens.
- `setArtPrompt(promptText)` / `setImageDescription(description)`
  - **Parameters:** Freeform string metadata.
  - **Purpose:** Updates descriptive metadata bundled with exports and saves.
  - **Side effects:** Persists the metadata values and refreshes relevant UI fields.
- `setRegionLabelsVisible(visible)`
  - **Parameters:** Optional boolean (toggled when omitted).
  - **Purpose:** Shows or hides region numbers on the canvas.
  - **Side effects:** Updates settings persistence, re-renders the puzzle, and refreshes command states.
- `isBrowserZoomSuppressed()`
  - **Parameters:** None.
  - **Purpose:** Indicates whether browser-level zoom prevention is active for wheel gestures.
  - **Side effects:** None.
- `togglePreview(show)`
  - **Parameters:** Optional boolean (toggles when omitted).
  - **Purpose:** Controls the finished artwork preview overlay.
  - **Side effects:** Updates preview state, triggers a redraw, refreshes UI affordances, and logs the action.
- `openGenerator()` / `openSettings()` / `openSaves()`
  - **Parameters:** None.
  - **Purpose:** Opens the Settings sheet focused on the Generator section, preserves the current scroll position, or jumps to Save management.
  - **Side effects:** Forces the slide-over open and scrolls the consolidated Settings list to the requested category when provided.
- `resetProgress()`
  - **Parameters:** None.
  - **Purpose:** Clears fill progress for the active puzzle.
  - **Side effects:** Removes fill state, updates autosave/command controls, and logs the reset.
- `deleteAllSiteData()`
  - **Parameters:** None.
  - **Purpose:** Clears all origin data (Cache Storage, cookies, service workers, IndexedDB, local/session storage) for a fresh start.
  - **Side effects:** Unregisters service workers, deletes caches/databases when supported, clears browser cookies/storage, and logs a summary of what was removed.
- `fillRegion(regionId, { ensureColor, flash, redraw, label })`
  - **Parameters:** Region id (number) plus optional behaviour flags.
  - **Purpose:** Paints a specific region programmatically, optionally selecting its palette colour first.
  - **Side effects:** May change the active colour, trigger region flashes, update fill data, render the puzzle/palette, log results, and queue an autosave. Returns a status code describing the outcome.

## Gameplay Loop Walkthrough

1. **Resume or load an image.** Autosaves restore on boot; otherwise the bundled Three Bands stripes load immediately. Drag a bitmap, pick a file, or press the 🐹 button to reload the sample. Adjust sliders first if you want different clustering before regenerating.
2. **Tune generation & appearance.** Use Settings to tweak palette size, minimum region area, resize detail, sample rate, iteration count, smoothing passes, auto-advance, difficulty, hint animations, hint type toggles, fade timing, overlay intensity, interface theme, unfilled region colour, stage background, interface scale, palette sorting, and mouse button mappings. Advanced options capture art prompt metadata for exports; adjust the “Stored image size” cap from the Saves tab when you want to trade fidelity for smaller saves.
3. **Explore the puzzle.** The canvas shows outlines and numbers; Preview floods the viewport with the finished artwork for comparison.
4. **Fill regions.** Pick a colour and click/tap cells. Easy difficulty can auto-select the tapped colour before painting; auto-advance hops to the next incomplete colour when enabled.
5. **Save or export.** The Saves tab stores snapshots (progress, generator options, source metadata) in localStorage using a compact schema. Export active puzzles as human-readable JSON or a compressed `.capy` package, generate an SVG progress snapshot that records palette colours, region centres, and fill styling, rename manual saves for organisation, and use **Reset puzzle progress** for a fresh attempt without deleting saves.

## Puzzle JSON Format

The bundled `capy.json` ships only the puzzle payload for the Three Bands sample; progress, viewport, and generator options live exclusively in saves. The fixture uses the `capy-puzzle@2` schema with these fields:

- `format` – Schema version (`capy-puzzle@2`).
- `title` – Friendly puzzle label.
- `width` / `height` – Canvas dimensions in pixels.
- `palette` – Colour entries with `id`, `hex`, `rgba`, and display `name`.
- `regions` – Metadata for each region (`id`, `colorId`, centroid, `pixelCount`, optional vector-friendly preview payloads). Geometry lives in the paired vector scene rather than pixel lists.
- `vectorScene` – Required vector scene snapshot (`metadata` describing a `capy.scene+simple` payload plus base64-encoded `binary`) consumed by the SVG renderer and kept as the canonical puzzle definition for all renderers.

Loaders derive region maps from the attached vector scene when they are not present on disk, keeping persisted payloads purely vector based.

### Save storage schema

Save slots live in `localStorage` (`capy.saves.v2`) and encode the same `capy-puzzle@2` payload alongside metadata:

- `id`/`timestamp` – Slot identifier plus last-updated timestamp.
- `data` – Puzzle snapshot normalised via `compactPuzzleSnapshot` (palette/region keys shrink to `{ i, h, n, r }` and `{ i, c, p, x, y }`, and filled regions stay as plain arrays alongside the vector scene for readability). Legacy imports using `m`/`f` packed strings continue to decode, but raster region maps are no longer emitted and are reconstructed from vector geometry on load when absent.
- `settings` – Optional gameplay/renderer preferences from `capy.settings.v1` so restores can reapply difficulty and renderer choices on fresh devices.
- `title` – Optional slot label. Vector-only saves avoid embedding preview thumbnails or source image snapshots.

Exports use the same schema (or the compressed `.capy` archive variant) so imports can pass the decoded payload straight into `compactPuzzleSnapshot` before calling `applyPuzzleResult`.

## Accessibility & Keyboard Notes

- The start/saves overlay stays focusable: Enter/Space triggers the file picker; Escape closes it (once a puzzle or save exists).
- The Help & logs tab uses `aria-live="polite"` so assistive tech announces saves, resets, and palette activity.
- Command rail buttons expose descriptive `aria-label`/`title` attributes and remain reachable via focus order.
- Palette buttons toggle the active colour, expose `data-color-id`, adjust label contrast automatically, and flash matching regions. Auto-advance can be disabled for manual control.
- Hold Space to convert the primary mouse button into a pan gesture; direct click-dragging also pans. `+`/`-` (or `Shift+=`/`-`) zoom without leaving the keyboard.
- Close buttons sit at the top of floating panels for easy keyboard dismissal.

## Testing & QA Checklist

Playwright smoke coverage now exercises the bundled puzzle, first-paint interaction, and save/load completion flow. From inside `project/`, run `npm test --silent` locally (it wraps `npx playwright test --config=playwright.config.js`) before merging. When the bundled Chromium binary is missing, the harness skips the Playwright suite and prints a reminder to run `npm run setup:playwright`; the first install may also need the system dependencies listed in the Playwright output (`npx playwright install-deps` on Debian/Ubuntu) so Chromium can launch headlessly.

Supplement the automated run with these manual checks when you change gameplay, rendering, or onboarding flows:

- **Boot and sample load.** Refresh to confirm onboarding hints, command rail, palette dock, and sample puzzle appear without errors.
- **Palette readability.** Scrub swatches to ensure labels remain legible across bright/dark paints on desktop and mobile viewports.
- **Painting loop.** Fill regions to verify flashes, completion states, and that the active save updates.
- **Save/load recovery.** Create a manual save, reload, and confirm it restores correctly.

Local workflow:

```bash
cd project
npm install
npm run setup:playwright  # Only required when running Playwright locally
npm run dev
```

Run the preview at http://localhost:8000 and exercise the checks above across multiple viewport sizes. The Playwright suite expects the app at the same origin, so keep the dev server on port 8000 when iterating.

## Open Follow-Ups

Active work now lives in [`project/TODO.md`](./TODO.md) (actionable tasks) and [`project/ROADMAP.md`](./ROADMAP.md) (direction). Update those files when behaviour changes or milestones land so this guide can stay focused on architecture and gameplay references.
