# Capy Technical Guide

Play the latest build at https://shthed.github.io/capy/ (branch previews deploy
to `/automation-<slug>/`). Repository: https://github.com/shthed/capy.

This document collects all technical, architectural, and QA details that were
previously tracked in the README. Keep it accurate alongside feature work so
both contributors and automation agents have a single source of truth.

## Project Overview

Capy turns any bitmap image into a colour-by-number puzzle entirely in the
browser. Drop a file (or load one via the hidden file picker) and the app will
resize it, run the selected quantization pipeline (k-means palette clustering or
the posterize-and-merge pass) to build a discrete palette, merge tiny regions,
and paint a canvas you can immediately play. Everything ships as a static
 runtime files in the repository root so the single-page app can be served directly without a
 build step.
Offline play stays supported via a minimal service worker (`service-worker.js`)
that precaches the runtime payload and reuses a shared Cache Storage bucket for
downloaded or user-selected source images. Imported images are stored under
`source-images/<id>` cache entries so saves keep lightweight references (cache
keys + URLs) instead of embedding large data URLs in `localStorage`.

## Repository Map

- **Runtime (repository root)**
  - `index.html` – Single-page host document containing markup and wiring for renderer selection, saves, generator controls, and automation helpers.
  - `styles.css` – Primary stylesheet housing theme tokens, responsive layout rules, and component styles (preboot UI scale variables stay inline in `index.html`).
  - `render.js` – Renderer controller plus Canvas2D, WebGL, and SVG backends (including the GPU-accelerated outline/text pipeline); manages the active drawing pipeline and exposes hooks for swapping or extending renderers at runtime.
  - `capy.json` – Bundled Capybara Springs puzzle fixture used for previews and branch deployments alongside the runtime payload.
  - `puzzle-generation.js` – Worker-ready generator module that handles colour quantization, segmentation, smoothing, and metadata assembly off the main thread.
- **Documentation**
  - `README.md` – Player-facing quick start and gameplay overview.
  - `TECH.md` – This technical reference.
  - `project/STYLEGUIDE.md` – CSS conventions, load-order expectations, and maintenance tips for the runtime stylesheet.
- **Testing & QA**
  - `project/tests/ui-review.spec.js` – Playwright smoke suite that loads the bundled runtime, switches between renderers, paints automation fixtures, and exercises saves reloads.
  - `project/tests/render-controller.spec.js` – Node-based unit coverage that mocks renderer registrations and asserts the controller's fallback hooks and error paths.
  - `project/tests/generator.spec.js` / `project/tests/smoothing.spec.mjs` – Node-driven generator coverage with typed-array fixtures under `project/tests/fixtures/` plus shared helpers in `project/tests/utils/fixtures.js`.
  - `project/scripts/run-tests.js` – Harness invoked by `npm test --silent`; runs the Node test runner before handing off to Playwright so both suites share a single entry point and exit code.
  - `project/artifacts/ui-review/` – Drop Playwright reports and screenshots here when you capture them locally.
  - **Playwright local setup** – Inside `project/`, run `npm install` followed by `npm run setup:playwright` when provisioning a new machine so the bundled Chromium binary and its shared library dependencies are ready for UI review runs.
- **Tooling & metadata**
  - `project/package.json` – npm scripts plus the `http-server` dependency required to run the app locally; `npm run dev` serves the repository root at http://localhost:8000.
  - `project/package-lock.json` – Locked dependency tree that keeps local installs and CI runs deterministic.
  - `.gitignore` – Ignores dependency installs, legacy automation artifacts, and transient reports.
  - `project/scripts/build-pages-site.mjs` – GitHub Markdown renderer used by deployments to turn `README.md` into `/README/index.html` and keep embedded docs mirrored in previews.
  - `project/scripts/render-branch-page.mjs` – Static HTML builder for `branch.html`, fed by deployment metadata so previews stay discoverable.
  - `project/scripts/prepare-deploy-metadata.mjs` – Fetches recent pull requests and commits via the GitHub API to regenerate the deployment metadata consumed by branch previews.
  - `project/scripts/generate_readme_html.py` – Local helper that mirrors the markdown-to-HTML conversion pipeline for manual testing or offline builds.
- **CI & Deployment**
  - `.github/workflows/ci.yml` – Placeholder workflow that currently checks installs while the automated test suite is offline.
  - `.github/workflows/deploy-branch.yml` – Deploys branches with open PRs to GitHub Pages under subfolders; `main` always deploys to root.
  - `.github/workflows/cleanup-branches.yml` – Nightly job and post-deploy follow-up (triggered asynchronously) that prunes stale `automation/` branches with no open PR and no commits in the last 30 days.

## Deployment & Branch Previews

Branch previews are driven by `.github/workflows/deploy-branch.yml`, which runs on
every push and optional manual dispatches (trigger the manual run from `main`
and provide the `target_branch` input so the workflow checks out the right
source):

1. **PR gate.** The workflow exits early unless the branch has an open PR.
   `main` is the exception—it always deploys. Manual runs can opt-in to deploy
   without an open review by setting the `allow_without_pr` input.
2. **Checkout & sanitise.** The action checks out the source branch and the
   `gh-pages` deployment branch, converts branch names into URL-safe slugs
   (e.g., `automation/feature` → `automation-feature`), and creates a matching
   directory for non-`main` deployments.
3. **Content sync.**
   - `main` clears the deployment working tree (leaving `.git`) and copies the
     runtime payload from the repository root (`index.html`, `styles.css`,
     `render.js`, `puzzle-generation.js`, and `capy.json`) into the root of
     `gh-pages`, then regenerates `/README/index.html` with
     `project/scripts/build-pages-site.mjs` so
     https://shthed.github.io/capy/README/ always mirrors the handbook.
   - Other branches mirror the same runtime payload inside their
     branch-specific directories before running the README conversion for a
     scoped `/README/index.html`.
4. **Index generation.** The workflow rebuilds `branch.html`, surfacing the main
   deployment first followed by every active branch. Each card now keeps the
   layout intentionally simple: a preview link, branch and PR references, and
   the full list of commits collected when metadata was generated (timestamps
   stay in ISO format so the page can render without client-side scripts).
5. **Cleanup.** Branch directories without open PRs are deleted on each run so
   deployments disappear automatically once work merges or closes.

Tweaking the deployment:

- Adjust exclusion patterns or published files inside the `rsync` steps. When
  adding new runtime assets, update the `ESSENTIAL_FILES`/include lists in
  `.github/workflows/deploy-branch.yml` so branch previews ship the same payload
  as `main`.
- Change the slug format in the sanitisation helper if branch naming needs to
  support additional characters.
- Modify the GitHub API pagination values in the index-building script to show
  more or fewer commits.
- Swap the publish branch from `gh-pages` if you need a different hosting
  target.

### Post-deploy branch smoke tests

- **Trigger.** The `Post-deploy branch tests` workflow listens for successful
  runs of the deployment job. It only proceeds for push-triggered runs so manual
  dispatches and `gh-pages` updates do not double-trigger Playwright.
- **Preview discovery.** Each run sanitises the branch name the same way the
  deployment workflow does (`automation/feature` → `/automation-feature/`) to
  reconstruct the GitHub Pages preview URL. The computed link feeds both
  Playwright and the PR comment that lands at the end of the job.
- **Playwright smoke rerun.** Once the preview URL is known, the workflow
  installs dependencies and reuses `npm test --silent`, pointing Playwright at
  the hosted branch preview via `PLAYWRIGHT_BASE_URL` so reviewers see the live
  build rather than a local server.
- **Artifacts.** Any files dropped under `artifacts/ui-review/` (screenshots,
  traces, reports) are uploaded automatically. The PR comment links directly to
  the workflow run so reviewers can download them without re-running the suite.
- **PR update.** After the test finishes (pass or fail), the workflow posts a
  comment on every associated PR summarising the preview URL, test outcome, and
  whether UI review artifacts were captured. This keeps the automation loop
  self-serve even while the primary Playwright suite remains paused in CI.

## UI & Feature Tour

### Headline Features

- **Instant image import.** Drag-and-drop or use the picker to feed bitmaps or previously exported JSON puzzles straight into the generator pipeline.
- **Saves tab quick start.** The Saves tab opens with an **Upload Image** button and lists manual slots. The active slot stays pinned to the top with an "Autosaving this slot" badge so you always know which snapshot will keep tracking progress. Manual snapshot tools, export shortcuts, and the **Reset puzzle progress** control sit after the save cards so you can bookmark or rewind without digging through other menus.
- **Built-in capybara sample.** The "Capybara Springs" illustration loads automatically on boot when no saves exist in the medium detail preset so players can start painting immediately.
- **Sample detail presets.** Low/Medium/High chips tune colour counts, resize targets, k-means iterations, and smoothing passes so QA can switch between breezy ≈26-region boards, balanced ≈20-region sessions, or high-fidelity ≈140-region runs.
- **Detailed debug logging.** The **Help & logs** tab in the Settings & tools menu announces sample loads, fills, hints, zooms, background tweaks, fullscreen toggles, ignored clicks, and now mirrors console warnings/errors (including unhandled rejections) so QA can confirm issues without opening DevTools.
- **Embedded documentation.** The same **Help & logs** tab loads the hosted README (`https://shthed.github.io/capy/README`) for in-app gameplay and contributor notes.
- **Configurable generator.** Choose between local algorithms (k-means clustering or the posterize-and-merge pass today, with
  room for hosted services) and adjust palette size, minimum region area, resize detail, sampling, iteration count, and smoothing
  passes before rebuilding the scene. Iterations rerun the clustering stage for tighter centroids; smoothing passes perform
  majority blending to fold stray pixels into their neighbours ahead of segmentation.
- **Pinned settings cog.** A single Settings & tools button anchors to the header so nothing scrolls off-screen, keeps safe-area spacing intact, and opens the full menu from anywhere in play.
- **Stable first paint.** An inline head script precomputes `--ui-scale-auto` from the current viewport and seeds `--ui-scale` so the interface renders at its final size before the runtime finishes booting.
- **Palette guidance.** Choosing a swatch pulses every matching region, flashing when a colour is complete so it is obvious where to paint next. Players can disable the matching-region hint in Settings if they prefer to scout manually.
- **Customisable background.** Settings lets you pick a backdrop colour; outlines and numbers flip contrast automatically.
- **Progress persistence.** Every stroke rewrites the active save slot; additional manual snapshots live in the **Saves** tab with rename/export/delete controls. Storage quota usage stays visible there, and the legacy autosave bucket migrates into a manual slot on first launch.
- **Startup restore priority.** Launching the app resumes from the most recent save (preferring the active slot) and falls back to the bundled sample only when nothing is stored.
- **Settings persistence.** Gameplay, hint, control, and appearance preferences now sync to `localStorage` (`capy.settings.v1`) so `capy.json` only ships puzzle data. Settings writes commit immediately so UI tweaks survive reloads even if puzzle autosave is still pending, and puzzle loads leave those stored preferences intact. Palette sorting mode selections share the same store, so switching to options like **Sort Colours → Spectrum** survives a refresh.

### Detail Presets

The Low/Medium/High chips in the Generator and Settings panels toggle tuned generator options for the bundled vignette:

| Preset | Colours | Approx. regions | Min region | Resize edge | Sample rate | Iterations | Smoothing | Use it when… |
| ------ | ------- | --------------- | ---------- | ----------- | ----------- | ---------- | --------- | ------------ |
| Low detail | 18 | ≈26 | 15 px² | 1216 px | 90% | 20 | 1 | Quick demos that favour broad shapes while keeping characters readable. |
| Medium detail | 26 | ≈20 | 100 px² | 1408 px | 95% | 24 | 1 | Balanced play sessions that capture lagoon reflections without overwhelming region counts. |
| High detail | 32 | ≈140 | 3 px² | 1536 px | 100% | 28 | 1 | Showcase captures where fur bands, ripples, and foliage clusters should stay distinct. |

Each preset reloads the sample immediately, updates generator sliders, and stamps the debug log. The remembered preset persists across sessions once you switch.

### Generator algorithms & tuning

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

### UI Guide

- **Command rail** – A single Settings & tools button stays fixed to the header, eliminating scroll while keeping safe-area padding. Opening it jumps straight into the slide-over; the Gameplay tab’s Quick actions expose the preview toggle and fullscreen control alongside the usual gameplay preferences.
- **Viewport canvas** – Hosts the interactive puzzle (`data-testid="puzzle-canvas"`). Renders outlines, numbers, and filled regions; supports smooth pan + zoom and respects auto-advance and hint animation toggles. Drag to reposition, scroll/pinch/double-tap to zoom; mobile gestures feed directly into the stage.
- **Preview mode** – Temporarily renders every region in its target colour for quick comparisons.
- **Settings & tools menu** – Slides in beside the playfield so you can keep painting while adjusting sliders. A fixed vertical tab rail now sits on the left while the active panel scrolls independently on the right, and the content within each panel flows through a responsive grid so wide viewports spill settings across two columns without sacrificing headings. Tabs still cover Gameplay, Hints, Controls, Appearance, Generator, Saves, and Help & logs so related toggles stay visible on smaller screens. The Gameplay tab opens with Quick actions for the preview toggle and fullscreen control before diving into palette sorting, auto-advance, difficulty, hint animations, overlay intensity, interface scaling, renderer swaps, and mouse mappings. The Generator tab mirrors clustering sliders, detail presets, remote URL imports, and advanced metadata (art prompts, image descriptions). The Saves tab manages manual snapshots, exports, deletion, and the stored-image size cap, while Help & logs hosts command descriptions, gesture tips, the embedded README, and the live debug console. Palette sorting modes include region number, remaining regions, colour name, a rainbow spectrum order based on OKLCH hue, a warm→cool temperature pass, and perceptual lightness (legacy hue/brightness selections migrate to spectrum/lightness automatically). Sheet surfaces now lean on the minimal-library palette: darker themes use `rgba(9, 13, 24, 0.94)` with a desaturated slate border, while the light theme sticks to near-solid white with cool-gray outlines. Hover, active, and focus states pull from the refreshed `--theme-sheet-button-hover-*`, `--theme-sheet-button-active-*`, and `--theme-sheet-focus-ring` tokens so tabs and close buttons stay AA-compliant without the previous heavy blur. Toggle switches adopt compact pill styling and range sliders live in bordered cards with short tracks plus **Default** buttons that snap back to the recommended presets (for example 1.2 s hint fades or 65 % sampling), keeping adjustments reachable without stretching across the full sheet.
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
- **Pan promotion.** When a drag is mapped to panning, `handlePanMove` watches for ~4px of travel before calling `beginPanSession`, capturing the pointer, and updating `viewState` so the canvas glides under the cursor.
- **Drag fills & zooms.** Custom drag actions (“Fill while dragging” or “Drag to zoom”) stream through `handleMouseDragFill`/`handleMouseDragZoom`, filling regions the pointer sweeps across or applying zoom deltas relative to the cursor. The helpers suppress the subsequent click event so the configured drag behaviour doesn’t trigger an extra fill.
- **Teardown safeguards.** `handlePanEnd` handles `pointerup`, `pointercancel`, and `lostpointercapture` so releasing outside the viewport still resets cursors, finalises drag sessions, and clears state.
- **Zoom input.** Scroll events, `+`/`-` shortcuts, drag-to-zoom mappings, pinch gestures, and helper calls all funnel through `applyZoom`, which recalculates scale, recentres the viewport, and logs the latest percentage. The helper now pushes the zoom multiplier straight into a CSS custom property on `#canvasTransform`, letting the compositor handle the animation while a debounced redraw (≈80 ms) refreshes labels and outlines once the gesture settles. Wheel deltas still map to exponential steps and the viewport clamps between the fitted scale (100%) and the configurable ceiling (default 1200%) so you can dive into tiny regions without the canvas shrinking below the screen.
- **Region clicks.** The canvas click handler validates that a puzzle and active colour exist, resolves the clicked pixel to a region, and either flashes a mismatch warning or streams the region geometry into the cached `filledLayer` before re-rendering. Left-click fills respect the configured mouse mapping; other buttons funnel through `finalizeMouseSession` before any click fires.

### Code Architecture Tour

- **Single-file app shell.** `index.html` owns markup, styles, and logic. The inline script is segmented into DOM caches, global state, event wiring, puzzle rendering, generation helpers, and persistence utilities—each called out in a developer-map comment.
- **Preboot viewport metrics.** A blocking `<script>` in the `<head>` seeds UI scale variables, viewport padding, and the orientation/compact flags before the stylesheet paints; a companion snippet at the top of `<body>` mirrors those attributes so the runtime boot avoids first-paint jumps when `handleViewportChange` recalculates metrics.
- **Public testing surface.** `window.capyGenerator` exposes helpers (`loadFromDataUrl`, `loadPuzzleFixture`, `togglePreview`, etc.) so automation and manual experiments can orchestrate the app without touching internals. Recent renderer work also surfaced `getRendererType()`, `listRenderers()`, `setRenderer(type)`, `registerRenderer(type, factory)`, and `unregisterRenderer(type)` so tests can assert the active backend or load experimental renderers without patching private state.
- **Pan/zoom subsystem.** `viewState` tracks transforms for `#canvasStage` and `#canvasTransform`; helpers like `applyZoom`, `resetView`, and `applyViewTransform` keep navigation smooth across wheel, keyboard, and drag gestures.
 - **Puzzle rendering pipeline.** `renderPuzzle` composites the stored base image first, then fills an offscreen mask covering every unfinished region so the original art shows through as you paint. The mask rasterizes into the cached `filledLayer`, outlines still blit from the stroke cache, and `drawNumbers` overlays remaining labels. Label layout caches include a rounded zoom key derived from the current display-to-base scale ratio, shrink the minimum font size relative to that zoom factor, and expand their attempt list at higher zoom so thin regions surface labels once there is enough on-screen room without sacrificing base zoom legibility. Visual feedback continues to leverage `flashColorRegions` and `paintRegions` for hints. The renderer controller proxies those calls to Canvas2D, WebGL, or SVG backends—WebGL uploads the stored base image alongside the cached layers as textures, tracks incremental fills so textures refresh immediately, and preserves the last good upload when a transfer fails so the screen never flashes blank, while the SVG renderer mounts the base image under its region mask before emitting `<path>` nodes so vector output stays crisp at any zoom. Each renderer samples its frame times and prints rolling averages to the browser console once per second so you can spot performance regressions while debugging pan and zoom flows.
- **Generation & segmentation.** `createPuzzleData` looks up the requested generator in `GENERATION_ALGORITHM_CATALOG`, runs the matching quantizer via `performQuantization` (k-means or the posterize-and-merge pipeline today, with scaffolding for future services), smooths assignments, and then calls `segmentRegions`. Before returning it compresses the resized source image to a data URL honouring the “Stored image size” limit so the original art ships with saves and exports; when a remote URL is supplied we skip compression and store just the resolved link so saves refetch the bitmap on demand. Regeneration and fixtures reuse the same entry point.
- **Persistence helpers.** `persistSaves`, `loadSavedEntries`, and `serializeCurrentPuzzle` manage puzzle snapshots while `getUserSettingsSnapshot`/`persistUserSettings` keep preferences on their own track; exports now ship puzzle data without bundling user settings.

### `window.capyGenerator` API Reference

Capy’s developer API exposes a minimal surface for automation, QA smoke tests, and manual debugging. Every method lives on `window.capyGenerator` and mirrors the runtime behaviour documented below:

- `getState()`
  - **Parameters:** None.
  - **Purpose:** Returns the live runtime state object (palette, fills, settings, renderer wiring) for inspection.
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
  - **Side effects:** Logs an error and returns `false` when given a non-object value; otherwise resets the UI, applies the puzzle result, hides the start screen, and returns whether hydration succeeded.
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
  - **Purpose:** Opens the Settings sheet focused on the Generator, most recent gameplay tab, or Saves tab.
  - **Side effects:** Forces the slide-over open and manages tab focus/reset behaviour.
- `resetProgress()`
  - **Parameters:** None.
  - **Purpose:** Clears fill progress for the active puzzle.
  - **Side effects:** Removes fill state, updates autosave/command controls, and logs the reset.
- `fillRegion(regionId, { ensureColor, flash, redraw, label })`
  - **Parameters:** Region id (number) plus optional behaviour flags.
  - **Purpose:** Paints a specific region programmatically, optionally selecting its palette colour first.
  - **Side effects:** May change the active colour, trigger region flashes, update fill data, render the puzzle/palette, log results, and queue an autosave. Returns a status code describing the outcome.

## Gameplay Loop Walkthrough

1. **Resume or load an image.** Autosaves restore on boot; otherwise the bundled sample loads in the high preset. Drag a bitmap, pick a file, or press the 🐹 button to reload the vignette. Adjust sliders first if you want different clustering before regenerating.
2. **Tune generation & appearance.** Use Settings to tweak palette size, minimum region area, resize detail, sample rate, iteration count, smoothing passes, auto-advance, difficulty, hint animations, hint type toggles, fade timing, overlay intensity, interface theme, unfilled region colour, stage background, interface scale, palette sorting, and mouse button mappings. Advanced options capture art prompt metadata for exports; adjust the “Stored image size” cap from the Saves tab when you want to trade fidelity for smaller saves.
3. **Explore the puzzle.** The canvas shows outlines and numbers; Preview floods the viewport with the finished artwork for comparison.
4. **Fill regions.** Pick a colour and click/tap cells. Easy difficulty can auto-select the tapped colour before painting; auto-advance hops to the next incomplete colour when enabled.
5. **Save or export.** The Saves tab stores snapshots (progress, generator options, source metadata) in localStorage using a compact schema. Export active puzzles as human-readable JSON or a compressed `.capy` package, rename manual saves for organisation, and use **Reset puzzle progress** for a fresh attempt without deleting saves.

## Puzzle JSON Format

Saved puzzles share the `capy-puzzle@2` payload with the following key fields:

- `format` – Schema version (`capy-puzzle@2`).
- `width` / `height` – Canvas dimensions in pixels.
- `palette` – Colour entries with `id`, `hex`, and display `name`.
- `regions` – Metadata for each region (`id`, `colorId`, centroid, `pixelCount`).
- `regionMapPacked` – Base64-encoded little-endian `Int32Array` describing region ids per pixel. Legacy imports may provide `regionMap`; loaders rebuild the pixel lists either way.
- `filled` – Region ids already painted.
- `backgroundColor`, `stageBackgroundColor`, `options`, `activeColor`, `viewport`, `sourceUrl` – Appearance and generator state used to restore the session.

Saved slots persist the active user settings alongside the puzzle snapshot so restoring a session on a fresh device can hydrate difficulty, renderer, and other preferences, but exported files omit that bundle for portability. When the player already has settings stored locally, puzzle loads keep those preferences instead of overwriting them with the snapshot.

Packing the region map trims payloads by more than half, avoiding `QuotaExceededError` when large puzzles previously overflowed localStorage. Saves now store the compacted structure directly in `localStorage` without extra compression, and exports write the same JSON so imports hand the decoded object straight to `compactPuzzleSnapshot` before calling `applyPuzzleResult`. The compactor rekeys palette entries to `{ i, h, n, r }`, regions to `{ i, c, p, x, y }`, stores the region map as `m`, and varint-packs filled region ids into the `f` string. If storage does fill up, the Help log prompts the user to clear old saves before retrying.

## Accessibility & Keyboard Notes

- The start/saves overlay stays focusable: Enter/Space triggers the file picker; Escape closes it (once a puzzle or save exists).
- The Help & logs tab uses `aria-live="polite"` so assistive tech announces saves, resets, and palette activity.
- Command rail buttons expose descriptive `aria-label`/`title` attributes and remain reachable via focus order.
- Palette buttons toggle the active colour, expose `data-color-id`, adjust label contrast automatically, and flash matching regions. Auto-advance can be disabled for manual control.
- Hold Space to convert the primary mouse button into a pan gesture; direct click-dragging also pans. `+`/`-` (or `Shift+=`/`-`) zoom without leaving the keyboard.
- Close buttons sit at the top of floating panels for easy keyboard dismissal.

## Testing & QA Checklist

Playwright smoke coverage now exercises the bundled puzzle, first-paint interaction, and save/load completion flow. From inside `project/`, run `npm test --silent` locally (it wraps `npx playwright test --config=playwright.config.js`) before merging. The first run may require `npm run setup:playwright` plus the system dependencies listed in the Playwright output (`npx playwright install-deps` on Debian/Ubuntu) so Chromium can launch headlessly.

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

- [ ] Restore artwork documentation once a new segmentation pipeline is ready for publication.
- [ ] Expand the automated smoke test suite as new renderer types or UI flows ship.
- [ ] Draft a GitHub issue template for the weekly Automation Sync summary and link it from the contributor guide.
