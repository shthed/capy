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
the new posterize-and-merge pass) to build a discrete palette, merge tiny
regions, and paint a canvas you can immediately play. An instant preview toggle,
hint tools, a save manager, and a configurable generator all live inside a
single `index.html` document—no build tools or extra runtime required.

## Repository Map

- **Core application**
  - `index.html` – Single-file UI, styles, and generator logic powering the colouring experience.
  - `render.js` – Renderer controller plus Canvas2D, WebGL, and SVG backends; manages the active drawing pipeline and exposes
    hooks for swapping or extending renderers at runtime.
  - `capy.json` – Bundled Capybara Springs puzzle fixture used for previews and branch deployments alongside the single-page runtime.
  - `puzzle-generation.js` – Worker-ready generator module that handles colour quantization, segmentation, and metadata assembly off the main thread.
- **Documentation**
  - `README.md` – Player-facing quick start and gameplay overview.
  - `TECH.md` – This technical reference.
- **Testing & QA**
- `project/tests/ui-review.spec.js` – Playwright smoke test that loads the bundled site in Chromium and confirms the document title so we know the runtime boots.
  - `project/artifacts/ui-review/` – Drop Playwright reports and screenshots here when you capture them locally.
  - **Playwright local setup** – Inside `project/`, run `npm install` followed by `npx playwright install --with-deps chromium` when provisioning a new machine so the bundled Chromium binary and its shared library dependencies are ready for UI review runs.
- **Tooling & metadata**
  - `project/package.json` – npm scripts plus the `http-server` dependency required to run the app locally.
  - `project/package-lock.json` – Locked dependency tree that keeps local installs and CI runs deterministic.
  - `.gitignore` – Ignores dependency installs, legacy automation artifacts, and transient reports.
  - `project/scripts/prepare-deploy-metadata.mjs` – Fetches recent pull requests and commits via the GitHub API to regenerate the deployment metadata consumed by branch previews.
- **CI & Deployment**
  - `.github/workflows/ci.yml` – Placeholder workflow that currently checks installs while the automated test suite is offline.
  - `.github/workflows/deploy-branch.yml` – Deploys branches with open PRs to GitHub Pages under subfolders; `main` always deploys to root.

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
   - `main` copies the full runtime (minus excluded directories like
     `node_modules`, Playwright reports, and other transient artifacts) straight
     to the root of `gh-pages` and regenerates `/README/index.html` so
     https://shthed.github.io/capy/README/ always mirrors the handbook.
   - Other branches ship the files required to run the app (`index.html`,
     `puzzle-generation.js`, `capy.json`) plus a branch-scoped README mirror at
     `/README/index.html`.
4. **Index generation.** The workflow rebuilds `branch.html`, surfacing the main
   deployment first followed by every active branch. Each card now keeps the
   layout intentionally simple: a preview link, branch and PR references, and
   the full list of commits collected when metadata was generated (timestamps
   stay in ISO format so the page can render without client-side scripts).
5. **Cleanup.** Branch directories without open PRs are deleted on each run so
   deployments disappear automatically once work merges or closes.

Tweaking the deployment:

- Adjust exclusion patterns or published files inside the `rsync` steps.
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
  RGB buckets, averages each bucket, and assigns pixels to the closest surviving colours. New entries can represent hosted
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
- **Start screen** – Launch puzzles, reload the sample, and highlight manual snapshot tips. **Choose an image** triggers the system picker; the **Load capybara sample** shortcut mirrors the Generator tab’s detail presets, and resets remain available from the Saves tab once the menu is open.
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

Playwright smoke coverage now exercises the bundled puzzle, first-paint interaction, and save/load completion flow. From inside `project/`, run `npm test --silent` locally (it wraps `npx playwright test --config=playwright.config.js`) before merging. The first run may require `npx playwright install` plus the system dependencies listed in the Playwright output (`npx playwright install-deps` on Debian/Ubuntu) so Chromium can launch headlessly.

Supplement the automated run with these manual checks when you change gameplay, rendering, or onboarding flows:

- **Boot and sample load.** Refresh to confirm onboarding hints, command rail, palette dock, and sample puzzle appear without errors.
- **Palette readability.** Scrub swatches to ensure labels remain legible across bright/dark paints on desktop and mobile viewports.
- **Painting loop.** Fill regions to verify flashes, completion states, and that the active save updates.
- **Save/load recovery.** Create a manual save, reload, and confirm it restores correctly.

Local workflow:

```bash
cd project
npm install
npm run dev
```

Run the preview at http://localhost:8000 and exercise the checks above across multiple viewport sizes. The Playwright suite expects the app at the same origin, so keep the dev server on port 8000 when iterating.

## Open Follow-Ups

- [ ] Restore artwork documentation once a new segmentation pipeline is ready for publication.
- [ ] Expand the automated smoke test suite as new renderer types or UI flows ship.
- [ ] Draft a GitHub issue template for the weekly Automation Sync summary and link it from the contributor guide.
