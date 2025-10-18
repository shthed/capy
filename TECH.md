# Capy Technical Guide

Play the latest build at https://shthed.github.io/capy/ (branch previews deploy
to `/automation-<slug>/`). Repository: https://github.com/shthed/capy.

This document collects all technical, architectural, and QA details that were
previously tracked in the README. Keep it accurate alongside feature work so
both contributors and automation agents have a single source of truth.

## Project Overview

Capy turns any bitmap image into a colour-by-number puzzle entirely in the
browser. Drop a file (or load one via the hidden file picker) and the app will
resize it, run k-means clustering to build a discrete palette, merge tiny
regions, and paint a canvas you can immediately play. An instant preview toggle,
hint tools, a save manager, and a configurable generator all live inside a
single `index.html` document—no build tools or extra runtime required.

## Repository Map

- **Core application**
  - `index.html` – Single-file UI, styles, and generator logic powering the colouring experience.
  - `capy.json` – Bundled Capybara Springs puzzle fixture used for previews and branch deployments alongside the single-page runtime.
  - `puzzle-generation.js` – Worker-ready generator module that handles colour quantization, segmentation, and metadata assembly off the main thread.
- **Documentation**
  - `README.md` – Player-facing quick start and gameplay overview.
  - `TECH.md` – This technical reference.
  - `docs/automation-loop.md` – Blueprint for the automated branching, testing, merging, and feedback loop.
  - `docs/branch-deployments.md` – Guide to the multi-branch GitHub Pages deployment system.
- **Testing & QA**
  - `tests/ui-review.spec.js` – (Currently paused) Playwright smoke test covering onboarding, palette interactions, and save reload flows across desktop & mobile viewports.
  - `artifacts/ui-review/` – Drop Playwright reports and screenshots here when you capture them locally.
- **Tooling & metadata**
  - `package.json` – npm scripts plus the `http-server` dependency required to run the app locally.
  - `package-lock.json` – Locked dependency tree that keeps local installs and CI runs deterministic.
  - `.gitignore` – Ignores dependency installs, legacy automation artifacts, and transient reports.
- **CI & Deployment**
  - `.github/workflows/ci.yml` – Placeholder workflow that currently checks installs while the automated test suite is offline.
  - `.github/workflows/deploy-branch.yml` – Deploys branches with open PRs to GitHub Pages under subfolders; `main` always deploys to root.

## UI & Feature Tour

### Headline Features

- **Instant image import.** Drag-and-drop or use the picker to feed bitmaps or previously exported JSON puzzles straight into the generator pipeline.
- **Saves sheet quick start.** The Saves panel surfaces quick actions to import a new image or JSON puzzle and reload the bundled Capybara Springs board. A **Reset puzzle progress** control clears the board without touching autosaves or manual snapshots.
- **Built-in capybara sample.** The "Capybara Springs" illustration loads automatically on boot (when no autosave exists) in the high detail preset so players can start painting immediately.
- **Sample detail presets.** Low/Medium/High chips tune colour counts, resize targets, k-means iterations, and smoothing passes so QA can switch between breezy ≈26-region boards, balanced ≈42-region sessions, or high-fidelity ≈140-region runs.
- **Detailed debug logging.** The Help panel’s live log announces sample loads, fills, hints, zooms, background tweaks, fullscreen toggles, and ignored clicks so QA can confirm the flow without DevTools.
- **Embedded documentation.** The Help panel loads the hosted README (`https://shthed.github.io/capy/README`) for in-app gameplay and contributor notes.
- **Configurable generator.** Adjust palette size, minimum region area, resize detail, sampling, iteration count, and smoothing passes before rebuilding the scene.
- **Responsive command rail.** Header icons clamp to the viewport, wrap when space runs short, respect safe-area insets, and stay pinned to the top edge so controls remain reachable.
- **Palette guidance.** Choosing a swatch pulses every matching region, flashing when a colour is complete so it is obvious where to paint next.
- **Customisable background.** Settings lets you pick a backdrop colour; outlines and numbers flip contrast automatically.
- **Progress persistence.** Every stroke updates a rolling autosave; manual snapshots live in the Saves manager with rename/export/delete controls. Storage quota usage is surfaced in the Help panel.

### Detail Presets

The Low/Medium/High chips in the Generator and Settings panels toggle tuned generator options for the bundled vignette:

| Preset | Colours | Approx. regions | Min region | Resize edge | Sample rate | Iterations | Smoothing | Use it when… |
| ------ | ------- | --------------- | ---------- | ----------- | ----------- | ---------- | --------- | ------------ |
| Low detail | 18 | ≈26 | 15 px² | 1216 px | 90% | 20 | 1 | Quick demos that favour broad shapes while keeping characters readable. |
| Medium detail | 26 | ≈42 | 8 px² | 1408 px | 95% | 24 | 1 | Balanced play sessions that capture lagoon reflections without overwhelming region counts. |
| High detail | 32 | ≈140 | 3 px² | 1536 px | 100% | 28 | 1 | Showcase captures where fur bands, ripples, and foliage clusters should stay distinct. |

Each preset reloads the sample immediately, updates generator sliders, and stamps the debug log. The remembered preset persists across sessions once you switch.

### UI Guide

- **Command rail** – Right-aligned header exposing Preview, Generator, Fullscreen, Import, Save manager, Help, and Settings buttons through icon-only controls. Preview reveals the clustered artwork, Generator opens clustering sliders, Fullscreen pushes the stage edge-to-edge, Import accepts images or JSON puzzles, the Save manager hosts manual snapshots plus onboarding, Help opens an in-app manual and debug log, and Settings reveals gameplay, palette, and accessibility options.
- **Viewport canvas** – Hosts the interactive puzzle (`data-testid="puzzle-canvas"`). Renders outlines, numbers, and filled regions; supports smooth pan + zoom and respects auto-advance and hint animation toggles. Drag to reposition, scroll/pinch/double-tap to zoom; mobile gestures feed directly into the stage.
- **Preview mode** – Temporarily renders every region in its target colour for quick comparisons.
- **Settings panel** – Slides in beside the playfield so you can keep painting while adjusting sliders. Controls include palette size, minimum region size, resize detail, sample rate, k-means iterations, smoothing passes, interface theme, background colour, interface scale, auto-advance, difficulty, hint animations, overlay intensity, and palette sorting. Houses JSON export and detail preset chips plus an **Advanced options** accordion for art prompt metadata.
- **Detail presets** – Onboarding hints and Settings surface the active preset with live captions describing colours, min region size, resize edge, and approximate region counts.
- **Start & save screen** – Launch puzzles, reload the sample, and manage manual snapshots. **Choose an image** leads the overlay; manual snapshots can be renamed, exported, or deleted; **Reset puzzle progress** clears the active board.
- **Help panel** – Lists command buttons, summarises gestures, and surfaces the live debug log for telemetry.
- **Palette dock** – Horizontal scroller anchored to the bottom. Flat colour tiles adjust label contrast automatically, collapse completed colours, and expose tooltips plus `data-color-id` attributes for automation.

## Interaction & Architecture Notes

### Pointer Interaction Flow

- **Pointer staging.** `#canvasStage` captures pointer events. `handlePanStart` records the pointer, immediately beginning a pan for right/middle clicks or when modifier keys (Space/Alt/Ctrl/Meta) are held. Touch pointers are tracked individually so single-finger drags can promote into pans while multi-touch sessions trigger pinch zooming.
- **Pan promotion.** `handlePanMove` tracks distance; once it exceeds ~4px the function calls `beginPanSession`, captures the pointer, and updates `viewState` so the canvas glides under the cursor.
- **Teardown safeguards.** `handlePanEnd` handles `pointerup`, `pointercancel`, and `lostpointercapture` so releasing outside the viewport still resets cursors and clears state.
- **Zoom input.** Scroll events, `+`/`-` shortcuts, pinch gestures, and helper calls all funnel through `applyZoom`, which recalculates scale, recentres the viewport, and logs the latest percentage. Zooming is effectively unbounded while keeping the canvas centred.
- **Region clicks.** The canvas click handler validates that a puzzle and active colour exist, resolves the clicked pixel to a region, and either flashes a mismatch warning or streams the region geometry into the cached `filledLayer` before re-rendering.

### Code Architecture Tour

- **Single-file app shell.** `index.html` owns markup, styles, and logic. The inline script is segmented into DOM caches, global state, event wiring, puzzle rendering, generation helpers, and persistence utilities—each called out in a developer-map comment.
- **Public testing surface.** `window.capyGenerator` exposes helpers (`loadFromDataUrl`, `loadPuzzleFixture`, `togglePreview`, etc.) so automation and manual experiments can orchestrate the app without touching internals.
- **Pan/zoom subsystem.** `viewState` tracks transforms for `#canvasStage` and `#canvasTransform`; helpers like `applyZoom`, `resetView`, and `applyViewTransform` keep navigation smooth across wheel, keyboard, and drag gestures.
- **Puzzle rendering pipeline.** `renderPuzzle` composites the current canvas from the Path2D-backed geometry cache generated by `ensureRenderCache`. Filled regions stream into an offscreen `filledLayer` via `paintRegionToFilledLayer`, outlines blit from a cached stroke layer, and `drawNumbers` overlays remaining labels. Visual feedback leverages `flashColorRegions` and `paintRegions` to tint regions without rebuilding masks.
- **Generation & segmentation.** `createPuzzleData` performs quantization (`kmeansQuantize`), smoothing, and `segmentRegions` before feeding `applyPuzzleResult`. Regeneration and fixtures reuse the same entry point.
- **Persistence helpers.** `persistSaves`, `loadSavedEntries`, and `serializeCurrentPuzzle` manage the save panel while exports rely on the same serialization for predictable output.

## Gameplay Loop Walkthrough

1. **Resume or load an image.** Autosaves restore on boot; otherwise the bundled sample loads in the high preset. Drag a bitmap, pick a file, or press the 🐹 button to reload the vignette. Adjust sliders first if you want different clustering before regenerating.
2. **Tune generation & appearance.** Use Settings to tweak palette size, minimum region area, resize detail, sample rate, iteration count, smoothing passes, auto-advance, difficulty, hint animations, fade timing, overlay intensity, interface theme, background colour, interface scale, and palette sorting. Advanced options capture art prompt metadata for exports.
3. **Explore the puzzle.** The canvas shows outlines and numbers; Preview floods the viewport with the finished artwork for comparison.
4. **Fill regions.** Pick a colour and click/tap cells. Easy difficulty can auto-select the tapped colour before painting; auto-advance hops to the next incomplete colour when enabled.
5. **Save or export.** The save manager stores snapshots (progress, generator options, source metadata) in localStorage using a compact schema. Export active puzzles as JSON, rename manual saves for organisation, and use **Reset puzzle progress** for a fresh attempt without deleting saves.

## Puzzle JSON Format

Autosaves and manual exports share the `capy-puzzle@2` payload with the following key fields:

- `format` – Schema version (`capy-puzzle@2`).
- `width` / `height` – Canvas dimensions in pixels.
- `palette` – Colour entries with `id`, `hex`, and display `name`.
- `regions` – Metadata for each region (`id`, `colorId`, centroid, `pixelCount`).
- `regionMapPacked` – Base64-encoded little-endian `Int32Array` describing region ids per pixel. Legacy imports may provide `regionMap`; loaders rebuild the pixel lists either way.
- `filled` – Region ids already painted.
- `backgroundColor`, `options`, `activeColor`, `viewport`, `settings`, `sourceUrl` – Appearance and generator state used to restore the session.

Packing the region map trims payloads by more than half, avoiding `QuotaExceededError` when large puzzles previously overflowed localStorage. If storage does fill up, the Help log prompts the user to clear old saves before retrying.

## Accessibility & Keyboard Notes

- The start/saves overlay stays focusable: Enter/Space triggers the file picker; Escape closes it (once a puzzle or save exists).
- The Help panel’s log uses `aria-live="polite"` so assistive tech announces saves, resets, and palette activity.
- Command rail buttons expose descriptive `aria-label`/`title` attributes and remain reachable via focus order.
- Palette buttons toggle the active colour, expose `data-color-id`, adjust label contrast automatically, and flash matching regions. Auto-advance can be disabled for manual control.
- Hold Space to convert the primary mouse button into a pan gesture; direct click-dragging also pans. `+`/`-` (or `Shift+=`/`-`) zoom without leaving the keyboard.
- Close buttons sit at the top of floating panels for easy keyboard dismissal.

## Testing & QA Checklist

With Playwright automated tests paused, rely on these manual passes before merging:

- **Boot and sample load.** Refresh to confirm onboarding hints, command rail, palette dock, and sample puzzle appear without errors.
- **Palette readability.** Scrub swatches to ensure labels remain legible across bright/dark paints on desktop and mobile viewports.
- **Painting loop.** Fill regions to verify flashes, completion states, and autosave updates.
- **Save/load recovery.** Create a manual save, reload, and confirm it restores correctly.

Local workflow:

```bash
npm install
npm run dev
```

Run the preview at http://localhost:8000 and exercise the checks above across multiple viewport sizes. Use `npm test --silent` to keep CI hooks green even though the suite currently reports skipped tests.

## Open Follow-Ups

- [ ] Restore artwork documentation once a new segmentation pipeline is ready for publication.
- [ ] Rebuild an automated smoke test suite once the palette refactor settles.
- [ ] Draft a GitHub issue template for the weekly Automation Sync summary and link it from the contributor guide.
