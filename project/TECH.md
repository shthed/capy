# Capy Technical Guide

Play the latest build at https://shthed.github.io/capy/ (branch previews deploy
to `/pull/<number>/`). Repository: https://github.com/shthed/capy.

This document collects all technical, architectural, and QA details that were
previously tracked in the README. Keep it accurate alongside feature work so
both contributors and automation agents have a single source of truth. New
developers should start with `project/ONBOARDING.md` for setup and workflow
expectations before diving into the deeper references below.

## Project Overview

Capy turns any bitmap image into a colour-by-number puzzle entirely in the
browser. Drop a file (or load one via the hidden file picker) and the app will
resize it, run the selected quantization pipeline (k-means palette clustering or
the posterize-and-merge pass) to build a discrete palette, merge tiny regions,
and paint a canvas you can immediately play. Everything ships as static runtime
files in the repository root so the single-page app can be served directly
without a build step.
Offline play is temporarily disabled while the service worker (`service-worker.js`)
and its cache are paused. The runtime still ships the worker file for when
offline support returns, but loads now unregister any existing service worker
and clear the runtime cache before continuing. Imported images fall back to
in-memory URLs instead of Cache Storage while this pause is in effect.

## Repository Map

- **Runtime (repository root)**
  - `index.html` – Single-page host document containing markup and wiring for renderer selection, saves, generator controls, and automation helpers.
  - `styles.css` – Primary stylesheet housing theme tokens, responsive layout rules, and component styles (preboot UI scale variables stay inline in `index.html`).
  - `capy.js` – Combined runtime, renderer helpers, and puzzle generation logic; hosts the SVG renderer, preboot sizing, and worker-friendly generation entry points.
  - `capy.json` – Bundled "Three Bands" puzzle fixture (vector stripes) used for previews and branch deployments alongside the runtime payload.
- **Documentation**
  - `AGENTS.md` – Contributor workflow and automation expectations; mirrored to `/AGENTS/index.html` during deployments.
  - `README.md` – Player-facing quick start and gameplay overview.
  - `TECH.md` – This technical reference.
  - `project/STYLEGUIDE.md` – CSS conventions, load-order expectations, and maintenance tips for the runtime stylesheet.
- **Testing & QA**
  - `project/tests/ui-review.spec.js` – Playwright smoke suite that loads the bundled runtime, switches between renderers, paints automation fixtures, and exercises saves reloads.
  - `project/tests/render-controller.spec.js` – Node-based unit coverage that mocks renderer registrations and asserts the controller's fallback hooks and error paths.
  - `project/tests/generator.spec.js` / `project/tests/smoothing.spec.mjs` – Node-driven generator coverage with typed-array fixtures under `project/tests/fixtures/` plus shared helpers in `project/tests/utils/fixtures.js`.
  - `project/scripts/run-tests.js` – Harness invoked by `npm test --silent`; runs the Node test runner before handing off to Playwright so both suites share a single entry point and exit code.
  - `project/scripts/capture-preview-screenshot.js` – Playwright helper that loads the configured `PLAYWRIGHT_BASE_URL` (falling back to the local dev server) and writes a full-page preview screenshot to `artifacts/ui-review/preview.png` for upload.
  - `project/artifacts/ui-review/` – Drop Playwright reports and screenshots here when you capture them locally.
  - **Playwright local setup** – Inside `project/`, run `npm install` followed by `npm run setup:playwright` when provisioning a new machine so the bundled Chromium binary and its shared library dependencies are ready for UI review runs.
- **Tooling & metadata**
  - `project/package.json` – npm scripts plus the `http-server` dependency required to run the app locally; `npm run dev` serves the repository root at http://localhost:8000.
  - `project/package-lock.json` – Locked dependency tree that keeps local installs and CI runs deterministic.
  - `.gitignore` – Ignores dependency installs, legacy automation artifacts, and transient reports.
  - `project/scripts/build-pages-site.mjs` – GitHub Markdown renderer used by deployments to turn Markdown sources (README, AGENTS, etc.) into styled HTML mirrors for GitHub Pages previews.
  - `project/scripts/generate_readme_html.py` – Local helper that mirrors the markdown-to-HTML conversion pipeline for manual testing or offline builds.
- **Styling stack**
  - `styles.css` owns the full runtime stylesheet without external CSS dependencies. Layout, form styling, and color tokens are defined locally to keep the zero-build pipeline lean and avoid vendored frameworks.
- **CI & Deployment**
  - `.github/workflows/ci.yml` – Placeholder workflow that currently checks installs while the automated test suite is offline.
  - `.github/workflows/deploy-branch.yml` – Deploys branches with open PRs to GitHub Pages under subfolders; `main` always deploys to root.
  - `.github/workflows/cleanup-branches.yml` – Nightly job and post-deploy follow-up (triggered asynchronously) that prunes stale `codex` branches with no open PR and no commits in the last 30 days by calling `project/scripts/cleanup-branches.mjs`.

## Project Health Snapshot

- **Zero-build runtime.** The app still ships as plain HTML/JS/CSS and must remain directly loadable without bundling. Optimisations should respect this constraint and avoid minified dependency drops.
  - **Binary hygiene.** Do not generate or commit binary assets (for example, screenshots or rendered previews) directly into the repository. Capture UI evidence as external PR artifacts instead so the runtime stays text-only and diffs remain lightweight.
  - **Cache hygiene.** Offline caching is paused; when re-enabled the service worker (`service-worker.js`) will continue to cap Cache Storage at roughly 25 MB or 80 entries with LRU eviction and skip uploads larger than ~6 MB. Keep those limits in mind before introducing larger assets or new fetch endpoints so storage stays within budget once the cache returns.
  - **Module registration.** The service worker registers as an ES module so `service-worker-cache.js` can load without MIME-type errors on GitHub Pages; stick to module-friendly helpers when adjusting its imports.
  - **Automation coverage.** The shared Node + Playwright harness remains the expected entry point (`npm test --silent`), but CI currently only validates installs. Manual smoke checks stay required until the hosted automation suite returns.
  - **Documentation sources.** Planning and work intake now live in `project/ROADMAP.md` (direction) and `project/TODO.md` (actionable tasks); update them when behaviour, tooling, or QA coverage shifts. The in-app Help panel fetches the `/README/` mirror that renders `README.md`, so keep that endpoint available when relocating docs.

## Repository Review Findings

- **Renderer structure.** `capy.js` now bundles the SVG implementation alongside the controller. The controller still exposes
  registration hooks but defaults to the simple SVG backend.
- **Vector scenes.** `capy.js` can hydrate `capy.scene+simple` metadata (including optional binary buffers) into scene loaders that feed the SVG renderer; the bundled Three Bands sample ships both vector metadata and per-region pixel lists for preview rendering.
- **Preboot + settings.** `capy.js` performs preboot sizing and UI-scale selection before the app loads, pulling stored
  settings from `localStorage` when available and falling back to defaults otherwise. Pair this with tests that cover missing or
  malformed settings data so boot-time CSS variables stay predictable.
- **Offline cache risk.** Offline caching is disabled for now; when restored, `service-worker.js` will resume precaching the
    runtime payload with the ≈25 MB / 80-entry LRU cap and continue skipping cached uploads above ~6 MB. Revisit those limits
    before adding larger assets or new fetch targets so storage usage stays predictable once caching returns.
- **Automation entry point.** `project/scripts/run-tests.js` still drives the Node generator specs and Playwright UI smoke tests,
  but the workflow in `.github/workflows/ci.yml` currently serves as a placeholder. Decide whether to re-enable the Playwright
  portion in CI or gate it behind an environment flag so coverage expectations match automation reality.
- **Workflow context guardrails.** GitHub parses the workflow `env:` blocks before it exposes the job-level `env.*` context, so
  referencing `${{ env.SOME_VALUE }}` while defining the same block fails validation with `Unrecognized named-value: 'env'`.
  Keep `env:` assignments limited to literals/contexts that GitHub resolves at parse time (such as `github.*`, `inputs.*`, or
  direct strings) and reuse those exports inside the shell scripts to avoid invalid deployments.

## Deployment & Branch Previews

Branch previews are driven by `.github/workflows/deploy-branch.yml`, which runs
on every push (all branches) plus optional manual dispatches (trigger the manual
run from `main` and provide the `target_branch` input so the workflow checks out
the right source). The workflow computes the target ref and preview URL in its
first step, then deploys directly to `gh-pages`:

1. **Checkout & PR discovery.** The action checks out the triggering branch
   (shallow fetch for speed) and the `gh-pages` deployment branch, then resolves
   the open PR attached to the branch. `main` publishes to the Pages root;
   everything else publishes to `/pull/<pr-number>/` when a PR is present or
   falls back to `/pull/<safe-branch>/` if no PR is found. The summary logs the
   branch, PR lookup result, target directory, and preview URL on every run.
2. **Content sync.** The workflow wipes the target directory, then rsyncs the
   repository root into place while excluding `.git/`, `.github/`, `project/`,
   and any prior `pages/` checkout. The deployment mirrors the repository tree
   directly—no build or doc regeneration steps run here.
3. **Preview surfacing.** After copying files, the workflow commits straight to
   `gh-pages`, pushes the update, uploads the published directory as an artifact
   (`gh-pages-pr-<number>` when a PR is found, otherwise `gh-pages-<safe>`), and
   echoes the preview URL in the job summary so reviewers can copy it quickly.

If the sync step finds nothing new to commit, the workflow exits after noting
there are no changes to deploy while leaving the previously published preview
in place. The compute step logs the resolved branch, PR number (when
applicable), target directory, and preview URL so runs stay self-documenting.

### Keeping branch directories and artifacts lean

- **Prune Git branches regularly.** `.github/workflows/cleanup-branches.yml`
  runs nightly (and after every successful Pages deployment) to invoke
  `project/scripts/cleanup-branches.mjs`. The script deletes unprotected
  branches matching the configured prefixes (defaults to `automation/`) when
  they have no open PR activity and have not received commits within the
  configurable cutoff window (defaults to 60 minutes), ensuring future deploy
  runs stop re-copying previews nobody needs. Trigger the workflow manually via
  the **Cleanup stale automation branches** action whenever you close a large
  batch of PRs so stale heads disappear immediately.
- **Cleanup also trims Pages previews.** After refreshing remote branches,
  `.github/workflows/cleanup-branches.yml` and
  `.github/workflows/cleanup-closed-pr.yml` still prune stale branches from the
  Pages tree, but deployment itself no longer checks PR state. Branch runs land
  in `gh-pages/pull/<pr-number>/` when a PR exists (or `/pull/<safe-branch>/`
  when it does not) and `main` continues to publish to the root.
- **Manual cleanup remains available.** If you need to reclaim space before the
  next deployment runs (or before triggering **Deploy GitHub Pages previews**
  by hand), delete the stale `pull/<branch>` directories on `gh-pages` and push
  the commit.

Tweaking the deployment:

- The publish step now clones `gh-pages`, wipes the target directory, and
  copies the repository root (excluding `.github/`, `project/`, and any prior
  `pages/` working tree) into place. Adjust the `rsync` excludes or add more
  files if the runtime payload grows.
- Branch previews map to `pull/<pr-number>` when a PR exists and fall back to
  `pull/<safe-branch>` otherwise; update the path construction in
  `.github/workflows/deploy-branch.yml` if a different layout is needed.
- Swap the publish branch from `gh-pages` if you need a different hosting
  target.

### Post-deploy branch updates

- **Trigger.** The `Post-deploy branch tests` workflow runs after every
  completed deployment.
- **Preview discovery.** The workflow rebuilds the preview URL using the PR
  number (matching `/pull/<pr-number>/`) and posts it back to the PR alongside
  links to the deployment run, artifact bundle, and rerun entry point.
- **No automated tests.** The job no longer installs dependencies or runs
  Playwright; it only reports the latest preview location so reviewers can
  click through directly.

## UI & Feature Tour

### Headline Features

- **Instant image import.** Drag-and-drop or use the picker to feed bitmaps or previously exported JSON puzzles straight into the generator pipeline.
- **Saves tab quick start.** The Saves tab opens with an **Upload Image** button and lists manual slots. Each card now carries a live preview thumbnail alongside the metadata so you can spot the right slot before loading. The active slot stays pinned to the top with an "Autosaving this slot" badge so you always know which snapshot will keep tracking progress. Manual snapshot tools, export shortcuts, and the **Reset puzzle progress** control sit after the save cards so you can bookmark or rewind without digging through other menus.
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
- **Progress persistence.** Every stroke rewrites the active save slot; additional manual snapshots live in the **Saves** tab with rename/export/delete controls. Storage quota usage stays visible there, and the legacy autosave bucket migrates into a manual slot on first launch.
- **Previewed snapshots.** Saves capture a downscaled preview thumbnail (rendered from the current preview canvas) so save cards and start-screen entries stay visually recognizable after a reload.
- **Startup restore priority.** Launching the app resumes from the most recent save (preferring the active slot) and falls back to the bundled sample only when nothing is stored.
- **Settings persistence.** Gameplay, hint, control, and appearance preferences now sync to `localStorage` (`capy.settings.v1`) so `capy.json` only ships puzzle data. Settings writes commit immediately so UI tweaks survive reloads even if puzzle autosave is still pending, and puzzle loads leave those stored preferences intact. Palette sorting mode selections share the same store, so switching to options like **Sort Colours → Spectrum** survives a refresh. The Settings dialog also records whether it was open so the sheet can reopen automatically after a reload.

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

### UI Guide

- **Command rail** – The floating Settings cog sits in the top-right by default. Drag it anywhere on-screen (the coordinates persist in Settings) and tap to open the menu; the Settings list opens with Quick actions for the preview toggle and fullscreen control before flowing into gameplay preferences.
- **Viewport canvas** – Hosts the interactive puzzle (`data-testid="puzzle-canvas"`). Renders outlines, numbers, and filled regions; supports smooth pan + zoom and respects auto-advance and hint animation toggles. Drag to reposition, scroll/pinch/double-tap to zoom; mobile gestures feed directly into the stage.
- **Preview mode** – Temporarily renders every region in its target colour for quick comparisons.
- **Settings dialog** – Opens centered over the playfield and can be dragged by the title bar while staying clamped inside the viewport. Categories now live in a single scrolling list with a sticky heading column on the left so Gameplay, Hints, Controls, Appearance, Generator, Saves, and Help & logs stay visible without swapping tabs. Each category flows through a responsive grid that spills settings across two columns on wide viewports and collapses cleanly on smaller screens. The list opens with Quick actions for the preview toggle and fullscreen control before diving into palette sorting, auto-advance, difficulty, hint animations, overlay intensity, interface scaling, renderer swaps, and mouse mappings. The Generator section mirrors clustering sliders, detail presets, remote URL imports, and advanced metadata (art prompts, image descriptions). The Saves section manages manual snapshots, exports, deletion, and the stored-image size cap, while Help & logs hosts command descriptions, gesture tips, the embedded README, a service worker system summary, and the live debug console. Palette sorting modes include region number, remaining regions, colour name, a rainbow spectrum order based on OKLCH hue, a warm→cool temperature pass, and perceptual lightness (legacy hue/brightness selections migrate to spectrum/lightness automatically). Sheet surfaces now lean on the minimal-library palette: darker themes use `rgba(9, 13, 24, 0.94)` with a desaturated slate border, while the light theme sticks to near-solid white with cool-gray outlines. Hover, active, and focus states pull from the refreshed `--theme-sheet-button-hover-*`, `--theme-sheet-button-active-*`, and `--theme-sheet-focus-ring` tokens so the sheet stays AA-compliant without the previous heavy blur. Toggle switches adopt compact pill styling and range sliders live in bordered cards with short tracks plus **Default** buttons that snap back to the recommended presets (for example 1.2 s hint fades or 50 % sampling), keeping adjustments reachable without stretching across the full sheet. The sheet avoids scale/slide animations so the dialog appears immediately, and the embedded README preloads in the background so the Help section is ready when opened.
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

### Compact UI patterns (no framework)

The runtime must stay build-free and avoid shipping large bundled frameworks. To trim UI code without pulling in minified dependencies:

- **Lean on `<template>` clones.** Define reusable fragments (e.g., palette items or save rows) in `index.html`, call `template.content.cloneNode(true)`, and toggle `dataset` flags or text content during hydration instead of re-creating DOM trees by hand.
- **Delegate events.** Attach a single listener to the container (palette rail, save list, settings tabs) and branch on `event.target.closest('[data-action="..."]')` so new buttons can be added in markup without extra wiring.
- **Small helper utilities only.** When repetition is unavoidable, add a tiny helper (e.g., `renderList(container, items, renderItem)`) in a shared module and reuse it rather than adopting a state library. Keep helpers self-contained and tree-shake-free.
- **Limit inline state.** Store UI state on elements via `dataset` or `aria-*` attributes and derive rendering from those flags so refresh functions can stay short and predictable.

These patterns keep the DOM logic compact while preserving the zero-build, zero-framework runtime constraints.
- **Puzzle rendering pipeline.** `renderPuzzle` now feeds the SVG renderer directly. Each frame rebuilds region paths from cached geometry, fills unfinished regions with a uniform overlay, and strokes outlines without juggling cached canvases or preview layers.
- **Generation & segmentation.** `createPuzzleData` looks up the requested generator in `GENERATION_ALGORITHM_CATALOG`, runs the matching quantizer via `performQuantization` (k-means or the posterize-and-merge pipeline today, with scaffolding for future services), smooths assignments, and then calls `segmentRegions`. Before returning it compresses the resized source image to a data URL honouring the “Stored image size” limit so the original art ships with saves and exports; when a remote URL is supplied we skip compression and store just the resolved link so saves refetch the bitmap on demand. Regeneration and fixtures reuse the same entry point.
- **Persistence helpers.** `persistSaves`, `loadSavedEntries`, and `serializeCurrentPuzzle` manage puzzle snapshots while `getUserSettingsSnapshot`/`persistUserSettings` keep preferences on their own track; exports now ship puzzle data without bundling user settings. When the browser rejects manual save writes, the save manager retries without preview thumbnails to squeeze under strict storage quotas.

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
- `fillRegion(regionId, { ensureColor, flash, redraw, label })`
  - **Parameters:** Region id (number) plus optional behaviour flags.
  - **Purpose:** Paints a specific region programmatically, optionally selecting its palette colour first.
  - **Side effects:** May change the active colour, trigger region flashes, update fill data, render the puzzle/palette, log results, and queue an autosave. Returns a status code describing the outcome.

## Gameplay Loop Walkthrough

1. **Resume or load an image.** Autosaves restore on boot; otherwise the bundled Three Bands stripes load immediately. Drag a bitmap, pick a file, or press the 🐹 button to reload the sample. Adjust sliders first if you want different clustering before regenerating.
2. **Tune generation & appearance.** Use Settings to tweak palette size, minimum region area, resize detail, sample rate, iteration count, smoothing passes, auto-advance, difficulty, hint animations, hint type toggles, fade timing, overlay intensity, interface theme, unfilled region colour, stage background, interface scale, palette sorting, and mouse button mappings. Advanced options capture art prompt metadata for exports; adjust the “Stored image size” cap from the Saves tab when you want to trade fidelity for smaller saves.
3. **Explore the puzzle.** The canvas shows outlines and numbers; Preview floods the viewport with the finished artwork for comparison.
4. **Fill regions.** Pick a colour and click/tap cells. Easy difficulty can auto-select the tapped colour before painting; auto-advance hops to the next incomplete colour when enabled.
5. **Save or export.** The Saves tab stores snapshots (progress, generator options, source metadata) in localStorage using a compact schema. Export active puzzles as human-readable JSON or a compressed `.capy` package, rename manual saves for organisation, and use **Reset puzzle progress** for a fresh attempt without deleting saves.

## Puzzle JSON Format

The bundled `capy.json` ships only the puzzle payload for the Three Bands sample; progress, viewport, and generator options live exclusively in saves. The fixture uses the `capy-puzzle@2` schema with these fields:

- `format` – Schema version (`capy-puzzle@2`).
- `title` – Friendly puzzle label.
- `width` / `height` – Canvas dimensions in pixels.
- `palette` – Colour entries with `id`, `hex`, `rgba`, and display `name`.
- `regions` – Metadata for each region (`id`, `colorId`, centroid, `pixelCount`, optional `pixels` array for preview rendering).
- `regionMapPacked` – Base64-encoded little-endian `Int32Array` of region ids per pixel (`width * height` entries). Loaders also accept a raw `regionMap` array for backwards compatibility and exports; the bundled fixture uses the raw map because the Three Bands sample is tiny.
- `vectorScene` – Optional vector scene snapshot (`metadata` describing a `capy.scene+simple` payload plus base64-encoded `binary`) used by the SVG renderer.
- `sourceImage` – Snapshot of the reference artwork (URL/data URL plus `width`, `height`, `originalWidth`, `originalHeight`, `scale`, `bytes`, and MIME type). The default puzzle omits a raster URL because the Three Bands sample is already encoded in the vector scene data.

Packing the default region map keeps the fixture small while preserving compatibility with earlier human-readable exports and legacy `m` blobs.

### Save storage schema

Save slots live in `localStorage` (`capy.saves.v2`) and encode the same `capy-puzzle@2` payload alongside metadata:

- `id`/`timestamp` – Slot identifier plus last-updated timestamp.
- `data` – Puzzle snapshot normalised via `compactPuzzleSnapshot` (palette/region keys shrink to `{ i, h, n, r }` and `{ i, c, p, x, y }`, and the region map plus filled regions stay as plain arrays for readability). Legacy imports using `m`/`f` packed strings continue to decode.
- `settings` – Optional gameplay/renderer preferences from `capy.settings.v1` so restores can reapply difficulty and renderer choices on fresh devices.
- `title`/`preview` – Optional slot label plus downscaled canvas preview (data URL) for the Saves tab.

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
