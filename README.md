# Capy Image Generator

[https://shthed.github.io/capy/](https://shthed.github.io/capy/)
[https://shthed.github.io/capy/branch](https://shthed.github.io/capy/branch)
[https://github.com/shthed/capy](https://github.com/shthed/capy)

Capy turns any bitmap image into a color-by-number puzzle entirely in the
browser. Drop a file (or load one via the hidden file picker) and the app will
resize it, run k-means clustering to build a discrete palette, merge tiny
regions, and paint a canvas you can immediately play. A fullscreen preview, hint
tools, a save manager, and a configurable generator all live inside a single
`index.html` document—no build tools or extra runtime required.

## Repository report

- **Core application**
  - `index.html` – Single-file UI, styles, and generator logic powering the coloring experience.
  - `README.md` – Usage guide and architecture reference for contributors.
- **Testing & QA**
  - Automated Playwright smoke tests have been retired for now. Run quick manual passes in desktop and mobile browsers before pushing.
- **Tooling & metadata**
  - `package.json` – npm scripts plus the http-server dependency required to run the app locally.
  - `package-lock.json` – Locked dependency tree that keeps local installs and CI runs deterministic.
  - `.gitignore` – Ignores dependency installs, legacy automation artifacts, and transient reports.
- **CI & Deployment**
  - `.github/workflows/ci.yml` – Placeholder workflow that currently checks installs while the automated test suite is offline.
  - `.github/workflows/deploy-branch.yml` – Deploys every branch to GitHub Pages under a subfolder matching the branch name.
- **Process notes**
  - `AGENTS.md` – Repository guidelines covering style, testing expectations, and contribution workflow.
  - `docs/automation-loop.md` – Blueprint for the automated branching, testing, merging, and feedback loop.
  - `docs/branch-deployments.md` – Detailed guide to the multi-branch GitHub Pages deployment system.

## Development workflow

- **Automation branches.** Create short-lived branches named `automation/<change>` so QA notes and preview URLs map directly to the experiment under review.
- **Branch deployments.** Every push to any branch automatically deploys to GitHub Pages under a subfolder named after the branch
  (e.g., `automation/feature` deploys to `/automation-feature/`). This lets reviewers preview changes in a live environment
  without local setup. The main branch deploys to the root path.
- **Manual smoke tests.** Exercise the puzzle load, palette selection, painting, and save/load flows in at least one desktop and one mobile browser before requesting review.
- **Fast-forward merges.** Rebase onto `main`, repeat the quick manual checks, and merge with `--ff-only` to preserve a linear history that keeps bisects practical for the single-file runtime.
- **Weekly automation sync.** Summarise flaky runs, TODO updates, and follow-up work in a standing Friday issue so the team has
  a shared backlog of automation improvements.
- **Close the loop.** Update PR descriptions and linked issues with branch names, CI run URLs, artifact locations, and live
  preview URLs so the automation history remains searchable.

## Features

- **Instant image import.** Drag-and-drop or use the picker to feed bitmaps or
  previously exported JSON puzzles straight into the generator pipeline.
- **Built-in capybara sample.** The "Capybara Springs" illustration now loads
  automatically on boot in the high detail preset (when no autosave is
  available) so you can start painting without importing anything. The vignette
  features an orange-balanced capybara lounging in a lagoon with a curious
  dachshund, water mushrooms, and a distant waterfall, and the 🐹 command rail
  button instantly reloads it whenever you want a fresh board while reflecting
  whichever detail preset you last chose.
- **Sample detail presets.** Low/Medium/High chips live on the onboarding hint
  and inside Settings, instantly reloading the sample with tuned colour counts,
  resize targets, k-means iterations, and smoothing passes so QA can cycle
  between breezy ≈26-region boards, balanced ≈42-region sessions, or
  high-fidelity ≈140-region showpieces.
- **Detailed debug logging.** The Help panel's live log now announces when the
  sample puzzle begins loading and when it completes, alongside fills, hints,
  zooms, background tweaks, fullscreen toggles, and ignored clicks, so QA can
  confirm the entire flow without cracking open DevTools.
- **Configurable puzzle generator.** Tune palette size, minimum region area,
  resize detail, sampling, iteration count, and smoothing passes before
  rebuilding the scene.
- **Responsive painting canvas.** Click or tap numbered regions to fill them in
  while optional auto-advance hops to the next unfinished colour. Filled areas
  now reveal the clustered artwork beneath the outlines so the illustration
  gradually emerges as you work.
- **Mobile-friendly zoom guard.** Double-tap and pinch gestures no longer
  trigger browser-level zoom; a global guard redirects them to the custom
  canvas handlers so the HUD stays stable while pan/zoom gestures still feel
  natural on touchscreens.
- **Responsive command rail.** Header icons now clamp to the viewport, wrap when
  space runs short, respect safe-area insets, and stay pinned to the top edge so
  controls remain reachable on phones, tablets, and desktop window resizes.
- **Colour cues and feedback.** Choosing a swatch briefly pulses every matching
  region (falling back to a celebratory flash when a colour is finished) so
  it's obvious where to paint next, and correctly filled regions immediately
  display the underlying illustration.
- **Customisable background.** Pick a backdrop colour for unfinished regions in
  the Settings panel; outlines and numbers automatically switch contrast so dark
  or light themes stay legible while you paint.
- **Region number toggle.** Flip a Gameplay setting to hide or restore the
  region numbers once you're familiar with the artwork for an unobstructed
  canvas while you fill in the illustration.
- **Precision view controls.** Pan the puzzle by click-dragging with the
  primary mouse button (spacebar, middle, and right buttons still work), use
  pinch gestures or the mouse wheel to zoom in and out, or tap `+`/`-` on the
  keyboard for incremental adjustments. Ctrl/Cmd zoom shortcuts now target the
  puzzle instead of the surrounding UI so the HUD stays crisp while the canvas
  reacts. Zooming is now unbounded, letting you dive down to single-pixel
  accuracy or orbit far above the artwork without hitting a ceiling. The canvas
  stretches to fill the viewport, centres itself automatically, and honours
  device orientation changes without losing your place.
- **Edge-to-edge stage.** A fullscreen toggle, rotation-aware sizing, and
  dynamic viewport padding lock the play surface to the visible viewport so the
  command rail and palette scale cleanly on phones, tablets, or desktops while
  the artwork stays centred.
- **Contextual hinting.** Trigger highlight pulses for the current colour or let
  the app surface the smallest unfinished region when you need a nudge.
- **Fullscreen preview.** Toggle a comparison overlay that shows the clustered
  artwork at its final resolution without leaving the play surface.
- **Sidecar panels.** Settings, Help, and the Save manager now dock to the
  right as floating panels instead of modal overlays, so you can keep painting
  while tweaking generator sliders or reviewing shortcuts. Each panel remembers
  its scroll position and stays interactive alongside the canvas.
- **Palette manager.** Swipe through edge-to-edge swatches rendered as simple,
  gutterless colour blocks so the dock stays packed. Completed colours collapse
  out of view once every region is filled, tooltips call out how many areas are
  left, and the Settings → Palette control lets you reorder swatches by number,
  remaining regions, colour name, hue, or brightness. Right-clicking a swatch now
  selects it just like a primary click so alternate buttons stay consistent. The digits automatically flip
  between dark and light treatments (with a subtle halo) to stay legible on any
  swatch, and the dock scrolls horizontally whenever palettes stretch beyond the
  screen so every colour stays accessible without vertical overflow.
- **Progress persistence & recovery.** Every stroke updates a rolling autosave
  using a compressed snapshot so the latest session is restored automatically on
  launch. Manual snapshots still land in the save manager where you can rename,
  export, or delete entries at will. The Help panel now surfaces estimated
  browser quota usage alongside save totals, offers a one-click delete button
  for clearing local data, and logs payload sizes plus storage consumption when
  the browser reports quota errors.

### Capybara Springs detail presets

  The Low/Medium/High detail chips on the onboarding hint and Settings panel
toggle tuned generator options for the built-in capybara vignette:

| Preset | Colours | Approx. regions | Min region | Resize edge | Sample rate | Iterations | Smoothing | Use it when… |
| ------ | ------- | --------------- | ---------- | ----------- | ----------- | ---------- | --------- | ------------ |
| Low detail | 18 | ≈26 | 15 px² | 1216 px | 90% | 20 | 1 | Quick demos that favour broad shapes while keeping the characters readable. |
| Medium detail | 26 | ≈42 | 8 px² | 1408 px | 95% | 24 | 1 | Balanced play sessions that capture the lagoon’s reflections without overwhelming region counts. |
| High detail | 32 | ≈140 | 3 px² | 1536 px | 100% | 28 | 1 | Showcase captures where fur bands, ripples, and foliage clusters should stay distinct. |

Each preset reloads the sample puzzle immediately, updates the generator
sliders to mirror the chosen settings, and stamps the debug log with the
relevant detail level so QA transcripts record every switch. The app boots in
the high preset so playtesters immediately see the full ≈140-region canvas, but
the remembered preset keeps medium or low runs sticky after you switch. The
region counts above are based on the bundled Capybara Springs artwork and keep
every preset playable—from the breezy ≈26-region low detail board to the
≈140-region high fidelity scene.

## Code architecture tour

- **Single-file app shell.** `index.html` owns the markup, styles, and logic. The
  inline script is segmented into DOM caches, global state, event wiring, puzzle
  rendering, generation helpers, and persistence utilities—each called out in a
  developer map comment at the top of the file.
- **Public testing surface.** `window.capyGenerator` exposes harness-friendly
  helpers (`loadFromDataUrl`, `loadPuzzleFixture`, `togglePreview`, etc.) so
  automation tooling and manual experiments can orchestrate the app without
  relying on internal selectors.
- **Pan/zoom subsystem.** `viewState` tracks the transform for `#canvasStage`
  and `#canvasTransform`; helpers like `applyZoom`, `resetView`, and
  `applyViewTransform` keep navigation smooth across wheel, keyboard, and drag
  gestures, with zoom clamps expanded to cover extreme close-ups and wide shots
  without artefacts.
- **Puzzle rendering pipeline.** `renderPuzzle` composites the current canvas
  from the Path2D-backed geometry cache generated by `ensureRenderCache`. Filled
  regions stream into a persistent offscreen `filledLayer` as soon as
  `paintRegionToFilledLayer` records them, outlines blit from a cached stroke
  layer, and `drawNumbers` overlays remaining labels. Visual feedback still uses
  `flashColorRegions` and `paintRegions` to tint regions without rebuilding
  pixel masks.
- **Generation + segmentation.** Image imports flow through `createPuzzleData`,
  which performs quantization (`kmeansQuantize`), smoothing, and `segmentRegions`
  before feeding `applyPuzzleResult`. Regeneration and fixtures reuse the same
  entry point so gameplay and export code paths stay in sync.
- **Persistence helpers.** `persistSaves`, `loadSavedEntries`, and
  `serializeCurrentPuzzle` manage the save panel while JSON exports lean on the
  same serialization path for predictable data output.

## Pointer interaction flow

- **Pointer staging.** The stage element (`#canvasStage`) captures all pointer
  events for the playfield. `handlePanStart` records the pointer that pressed
  down, immediately beginning a pan for right/middle clicks or when modifier
  keys (Space/Alt/Ctrl/Meta) are held. Touch pointers are tracked individually
  so single-finger drags can promote into pans while multi-touch sessions
  trigger pinch zooming.
- **Pan promotion.** `handlePanMove` measures how far the candidate pointer has
  travelled. Once it exceeds roughly four pixels the function calls
  `beginPanSession`, captures the pointer, and continuously updates `viewState`
  so the canvas glides under the cursor.
- **Teardown safeguards.** `handlePanEnd` runs for `pointerup`,
  `pointercancel`, and `lostpointercapture` so releasing the mouse outside the
  viewport still resets the grab cursor and clears pan state.
- **Zoom input.** Scroll wheel events, `+`/`-` keyboard shortcuts, pinch
  gestures, and helper calls from tests all feed into `applyZoom`, which
  calculates a new scale, recenters the viewport, and updates the debug log with
  the latest percentage (pinch sessions summarise their final zoom when they
  end). The new scale math allows for near limitless zooming while keeping the
  canvas centred under the pointer.
- **Region clicks.** The canvas click handler first validates that a puzzle and
  active colour exist, then resolves the clicked pixel to a region. Mismatches
  trigger a yellow flash and a debug log entry explaining which colour is
  required, while successful fills add the region to the completed set,
  immediately stream its geometry into the cached `filledLayer`, and invoke
  `renderPuzzle` to composite the layers.

## How it works

1. **Resume or load an image.** The app restores your most recent autosave on
   boot; if nothing is stored yet the bundled “Capybara Springs” puzzle loads
   automatically in the high detail preset so you can start painting
   immediately. Drag a bitmap into the viewport, activate the “Choose an image”
   button, or press the 🐹 command button to reload the bundled scene. The hint
   overlay disappears once a new source is selected, and the Low/Medium/High
   detail chips can pre-seed the capybara sample with relaxed or high-fidelity
   settings before you reload it.
2. **Tune generation & appearance.** Open **Settings** to slide out the
   sidecar and tweak palette size, minimum region area, resize detail, sample
   rate (for faster clustering), iteration count, smoothing passes,
   auto-advance, the status bar toggle, hint animations, the interface theme,
   the canvas background colour, the interface scale slider, and the Palette sort menu. Apply changes instantly
   when working from an image source, then expand the **Advanced options**
   accordion to edit the optional art prompt metadata before exporting or
   regenerating a scene.
3. **Explore the puzzle.** The game canvas shows outlines and number badges,
   while the **Preview** button floods the entire viewport with a fullscreen
   comparison of the clustered artwork.
4. **Fill regions.** Pick a colour from the bottom dock, click any numbered cell,
   and the region fills in. Auto-advance can hop to the next incomplete colour
   once you finish the current hue.
5. **Save or export.** The save manager captures snapshots (including progress,
   generator options, and source metadata) in localStorage using a compact
   schema. Export the active puzzle as JSON at any time.

## Puzzle JSON format

Autosaves and manual exports all share a `capy-puzzle@2` payload. Key fields
include:

- `format` – Indicates the schema version (`capy-puzzle@2`).
- `width`/`height` – Pixel dimensions of the clustered canvas.
- `palette` – Colour entries with `id`, `hex`, and display `name`.
- `regions` – Region metadata (`id`, `colorId`, centroid, and `pixelCount`).
- `regionMapPacked` – Base64-encoded little-endian `Int32Array` describing
  which region id occupies each pixel. Legacy imports can still provide a plain
  `regionMap` array; the loader hydrates whichever is available and rebuilds the
  per-region pixel lists on the fly.
- `filled` – Region ids that the player has already painted.
- `backgroundColor`, `options`, `activeColor`, `viewport`, `settings`, and
  `sourceUrl` – The appearance and generator state needed to restore the session.

Packing the region map trims autosave/export payloads by more than half compared
to the old verbose arrays, which prevents the `QuotaExceededError` console
messages browsers emitted when large puzzles overflowed localStorage. If storage
does fill up, the app now logs a debug reminder prompting you to clear old saves
before retrying.

## UI guide

- **Command rail** – A slim, right-aligned header exposing Hint, Reset, Preview,
  Sample, Fullscreen, Import, Save manager, Help, and Settings buttons through
  icon-only controls. Hint flashes tiny regions, Reset clears progress, Preview
  reveals the clustered artwork, Sample reloads the bundled capybara puzzle,
  Fullscreen pushes the stage edge-to-edge (and exits back to windowed mode),
  Import accepts images or JSON puzzles, Save manager opens the local snapshot
  vault, Help opens an in-app manual plus live
  debug log, and Settings reveals generator/gameplay options.
- **Viewport canvas** – Hosts the interactive puzzle (`data-testid="puzzle-canvas"`).
  The canvas renders outlines, remaining numbers, and filled regions, respects
  auto-advance / hint animation toggles, and supports smooth pan + zoom so you
  can inspect fine details. Drag with the mouse or trackpad to reposition the
  scene and use the scroll wheel (or trackpad gesture) to zoom — mobile pinch
  gestures now feed directly into the stage, and a double-tap guard keeps the
  browser from scaling the interface accidentally while you navigate.
- **Fullscreen preview overlay** – Triggered by the Preview button. The preview
  canvas stretches to fit the viewport so contributors can inspect the clustered
  output in detail before painting.
- **Settings panel** – Slides in beside the playfield instead of taking over the
  window so you can keep painting while adjusting sliders. Controls include
  colours, minimum region size, resize detail, sample rate, k-means iterations,
  smoothing passes, an interface theme switcher, a background colour picker, the
  interface scale slider, toggles for auto-advance, the status bar, and hint animations, and the Palette sort menu. The
  panel also houses the JSON export action, mirrors the Low/Medium/High detail
  chips so you can reload the sample with tuned parameters without leaving the
  sidecar, and tucks the art prompt query inside an **Advanced options**
  accordion so casual play stays focused on painting.
- **Detail presets** – The onboarding hint and Settings panel both surface the
  Low/Medium/High chips with a live caption describing the active preset so you
  know how many colours, what minimum region size, and which resize edge (and
  approximate region count) the next sample reload will use.
- **Save manager panel** – Lists every stored snapshot without blocking the
  canvas. Each entry shows completion progress with quick actions to load,
  rename, export, or delete the save.
- **Help panel** – Lists every command button, summarizes canvas gestures, and
  surfaces a live debug log so contributors can confirm state changes while
  testing.
- **Palette dock** – A horizontal scroller anchored to the bottom of the page.
  Each swatch now stretches into a flat colour tile with no gutters, and the
  number rides directly on the paint with a contrast-aware outline so it stays
  readable without extra chrome. A collapsible status bar above the dock stays hidden
  unless an image import is running; enable the Settings toggle to keep its filled/remaining
  counts visible after generation completes. Tooltips and `data-color-id` attributes still
  expose the colour name plus remaining counts for automation hooks.

## Keyboard and accessibility notes

- The hint overlay is focusable and reacts to Enter/Space to trigger the file
  picker, keeping the first interaction accessible.
- The Help panel’s debug log uses an `aria-live="polite"` region for gameplay
  telemetry so assistive tech announces save loads, resets, and palette
  activity.
- Command rail buttons expose descriptive `aria-label` and `title` attributes
  even though the visual controls are icon-only, and they stay reachable via
  keyboard focus.
- Palette buttons toggle the active colour and expose `data-color-id` so tests
  and tooling can reason about selections. Each swatch dynamically adjusts its
  label colour and outline to maintain WCAG-friendly contrast without extra
  chrome, and auto-advance can be disabled from the Settings panel for full
  manual control.
- Palette selection briefly flashes every matching region (and completed
  colours) so it's immediately clear where the next strokes belong.
- Hold Space to temporarily switch the primary mouse button into a dedicated
  pan gesture; direct click-dragging also works for quick viewport adjustments.
- Use `+`/`-` (or `Shift+=`/`-`) to zoom without leaving the keyboard; mouse and
  trackpad scrolling continue to work for analog control.
- Close buttons sit at the top of each floating panel so keyboard users can exit
  quickly without relying on a backdrop.

## Testing

With Playwright on pause, lean on the following manual smoke checks before
pushing changes or requesting review:

- **Boot and sample load.** Refresh the app to confirm the onboarding hint, command rail, palette dock, and Capybara Springs sample all appear without errors.
- **Palette readability.** Scrub through the swatches to confirm the flat numbers stay legible against bright and dark paints in both desktop and mobile viewports.
- **Painting loop.** Select a handful of swatches and fill matching regions to verify flashes, completion states, and autosaves still respond as expected.
- **Save/load recovery.** Create a manual save, reload the page, and ensure the entry restores correctly.

```bash
npm install
npm run dev
```

Use the local preview to exercise the manual checks above across multiple
viewports.

## TODO

- [ ] Restore artwork documentation once a new segmentation pipeline is ready for publication.
- [ ] Rebuild an automated smoke test suite once the palette refactor settles.
- [ ] Draft a GitHub issue template for the weekly Automation Sync summary and link it from the contributor guide.

