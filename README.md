# Capy Image Generator

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
  - `tests/ui-review.spec.js` – Playwright smoke test that exercises onboarding, palette, and sample reload flows.
  - `playwright.config.js` – Playwright runner configuration bound to the static http-server.
- **Tooling & metadata**
  - `package.json` – npm scripts plus the http-server and Playwright dependencies required to run the app and tests.
  - `package-lock.json` – Locked dependency tree that keeps local installs and CI runs deterministic.
  - `.gitignore` – Ignores dependency installs, Playwright artifacts, and transient reports.
- **CI & Deployment**
  - `.github/workflows/ci.yml` – Runs Playwright tests on Windows for every push and PR.
  - `.github/workflows/deploy-branch.yml` – Deploys every branch to GitHub Pages under a subfolder matching the branch name.
- **Process notes**
  - `AGENTS.md` – Repository guidelines covering style, testing expectations, and contribution workflow.
  - `docs/automation-loop.md` – Blueprint for the automated branching, testing, merging, and feedback loop.
  - `docs/branch-deployments.md` – Detailed guide to the multi-branch GitHub Pages deployment system.

## Development workflow

- **Automation branches.** Create short-lived branches named `automation/<change>` so CI reports and Playwright artifacts map
  directly to the experiment under review.
- **Branch deployments.** Every push to any branch automatically deploys to GitHub Pages under a subfolder named after the branch
  (e.g., `automation/feature` deploys to `/automation-feature/`). This lets reviewers preview changes in a live environment
  without local setup. The main branch deploys to the root path.
- **Continuous smoke tests.** Let every push trigger `npm test --silent` across desktop and mobile viewports; publish the
  resulting `artifacts/ui-review/` bundle for asynchronous review and attach key screenshots when UI changes land.
- **Fast-forward merges.** Rebase onto `main`, rerun the Playwright suite, and merge with `--ff-only` to preserve a linear
  history that keeps bisects practical for the single-file runtime.
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
- **Detailed debug logging.** The Help sheet's live log now announces when the
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
  space runs short, and respect safe-area insets so controls stay reachable on
  phones, tablets, and desktop window resizes.
- **Colour cues and feedback.** Choosing a swatch briefly pulses every matching
  region (falling back to a celebratory flash when a colour is finished) so
  it's obvious where to paint next, and correctly filled regions immediately
  display the underlying illustration.
- **Customisable background.** Pick a backdrop colour for unfinished regions in
  the Settings sheet; outlines and numbers automatically switch contrast so dark
  or light themes stay legible while you paint.
- **Precision view controls.** Pan the puzzle by click-dragging with the
  primary mouse button (spacebar, middle, and right buttons still work), use
  pinch gestures or the mouse wheel to zoom in and out, or tap `+`/`-` on the
  keyboard for incremental adjustments. Ctrl/Cmd zoom shortcuts now target the
  puzzle instead of the surrounding UI so the HUD stays crisp while the canvas
  reacts. The canvas stretches to fill the viewport, centres itself
  automatically, and honours device orientation changes without losing your
  place.
- **Edge-to-edge stage.** A fullscreen toggle, rotation-aware sizing, and
  dynamic viewport padding ensure the command rail and palette scale cleanly on
  phones, tablets, or desktops while the artwork stays centred.
- **Contextual hinting.** Trigger highlight pulses for the current colour or let
  the app surface the smallest unfinished region when you need a nudge.
- **Fullscreen preview.** Toggle a comparison overlay that shows the clustered
  artwork at its final resolution without leaving the play surface.
- **Palette manager.** Swipe through compact, tinted swatches that promote the
  colour number while tooltips, titles, and ARIA copy preserve human-readable
  names and remaining region counts.
- **Progress persistence & recovery.** Every stroke updates a rolling autosave
  using a compact payload so the latest session is restored automatically on
  launch. Manual snapshots still land in the save manager where you can rename,
  export, or delete entries at will.
- **Cloud-ready sync.** A lightweight broadcast channel mirrors autosaves
  across browser tabs and exposes a `window.capyCloudSync` adapter hook so
  teams can plug in remote storage when available.

### Capybara Springs detail presets

The Low/Medium/High detail chips on the onboarding hint and Settings sheet
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
  helpers (`loadFromDataUrl`, `loadPuzzleFixture`, `togglePreview`, etc.) so the
  Playwright suite and manual experiments can orchestrate the app without
  relying on internal selectors.
- **Pan/zoom subsystem.** `viewState` tracks the transform for `#canvasStage`
  and `#canvasTransform`; helpers like `applyZoom`, `resetView`, and
  `applyViewTransform` keep navigation smooth across wheel, keyboard, and drag
  gestures.
- **Puzzle rendering pipeline.** `renderPuzzle` orchestrates drawing the current
  canvas, using `applyRegionToImage`, `drawOutlines`, and `drawNumbers`. Visual
  feedback uses `flashColorRegions` and `paintRegions` to overlay tint pulses.
- **Generation + segmentation.** Image imports flow through `createPuzzleData`,
  which performs quantization (`kmeansQuantize`), smoothing, and `segmentRegions`
  before feeding `applyPuzzleResult`. Regeneration and fixtures reuse the same
  entry point so gameplay and export code paths stay in sync.
- **Persistence helpers.** `persistSaves`, `loadSavedEntries`, and
  `serializeCurrentPuzzle` manage the save sheet while JSON exports lean on the
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
  end).
- **Region clicks.** The canvas click handler first validates that a puzzle and
  active colour exist, then resolves the clicked pixel to a region. Mismatches
  trigger a yellow flash and a debug log entry explaining which colour is
  required, while successful fills call `applyRegionToImage` and advance
  progress tracking.

## How it works

1. **Resume or load an image.** The app restores your most recent autosave on
   boot; if nothing is stored yet the bundled “Capybara Springs” puzzle loads
   automatically in the high detail preset so you can start painting
   immediately. Drag a bitmap into the viewport, activate the “Choose an image”
   button, or press the 🐹 command button to reload the bundled scene. The hint
   overlay disappears once a new source is selected, and the Low/Medium/High
   detail chips can pre-seed the capybara sample with relaxed or high-fidelity
   settings before you reload it.
2. **Tune generation & appearance.** Open **Settings** to tweak palette size,
   minimum region area, resize detail, sample rate (for faster clustering),
   iteration count, smoothing passes, auto-advance, hint animations, the canvas
   background colour, and the new interface scale slider. Apply changes
   instantly when working from an image source, then expand the **Advanced
   options** accordion to edit the optional art prompt metadata before exporting
   or regenerating a scene.
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

Autosaves, manual exports, and the Playwright fixtures all share a
`capy-puzzle@2` payload. Key fields include:

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
- **Settings sheet** – A modal sheet that hides the generation sliders by
  default. Controls include colours, minimum region size, resize detail, sample
  rate, k-means iterations, smoothing passes, a background colour picker, and
  an interface scale slider, plus toggles for auto-advance and hint animations.
  The sheet also houses the JSON export action, mirrors the Low/Medium/High
  detail chips so you can reload the sample with tuned parameters without
  leaving the modal, and tucks the art prompt query inside an **Advanced
  options** accordion so casual play stays focused on painting.
- **Detail presets** – The onboarding hint and Settings sheet both surface the
  Low/Medium/High chips with a live caption describing the active preset so you
  know how many colours, what minimum region size, and which resize edge (and
  approximate region count) the next sample reload will use.
- **Save manager** – A companion sheet listing every stored snapshot. Each entry
  shows completion progress with quick actions to load, rename, export, or
  delete the save.
- **Help sheet** – Lists every command button, summarizes canvas gestures, and
  surfaces a live debug log so contributors can confirm state changes while
  testing.
- **Palette dock** – A horizontal scroller anchored to the bottom of the page.
  Each compact swatch keeps the colour number front-and-center with an adaptive
  high-contrast pill so the digits stay readable no matter the paint tone,
  while tooltips and `data-color-id` attributes expose the colour name plus
  remaining counts for automation hooks.

## Keyboard and accessibility notes

- The hint overlay is focusable and reacts to Enter/Space to trigger the file
  picker, keeping the first interaction accessible.
- The help sheet’s debug log uses an `aria-live="polite"` region for gameplay
  telemetry so assistive tech announces save loads, resets, and palette
  activity.
- Command rail buttons expose descriptive `aria-label` and `title` attributes
  even though the visual controls are icon-only, and they stay reachable via
  keyboard focus.
- Palette buttons toggle the active colour and expose `data-color-id` so tests
  and tooling can reason about selections. Each swatch dynamically flips its
  label foreground/background pairing to maintain WCAG-friendly contrast, and
  auto-advance can be disabled from the Settings sheet for full manual control.
- Palette selection briefly flashes every matching region (and completed
  colours) so it's immediately clear where the next strokes belong.
- Hold Space to temporarily switch the primary mouse button into a dedicated
  pan gesture; direct click-dragging also works for quick viewport adjustments.
- Use `+`/`-` (or `Shift+=`/`-`) to zoom without leaving the keyboard; mouse and
  trackpad scrolling continue to work for analog control.
- Both the settings and save sheets trap focus while open and close via their
  dedicated Close buttons or the shared backdrop.

## Testing

The Playwright suite exercises the core flows:

- **renders command rail and generator settings on load** – Confirms the hint
  overlay, iconized command rail, palette dock, and generator controls render on
  first boot.
 - **auto loads the capybara sample scene** – Verifies the bundled illustration is
    ready as soon as the app boots, that the sample button still reloads it on
    demand, and that the Low/Medium/High detail chips update generator sliders,
    debug logging, and palette/region counts as expected.
- **allows adjusting the canvas background colour** – Uses the fixture loader to
  set a new background via the exposed harness helper, verifies pixel data,
  and confirms the debug log records the change.
- **fills the basic test pattern to completion** – Loads a tiny fixture via
  `window.capyGenerator.loadPuzzleFixture`, walks through selecting palette
  swatches, fills each region, observes the completion copy, and resets the
  board.

Run them locally with:

```bash
npm install
npm test --silent
```

The suite writes artifacts (screenshots + JSON summaries) into
`artifacts/ui-review/` if you need to inspect the DOM snapshots.

## TODO

- [ ] Restore artwork documentation once a new segmentation pipeline is ready for publication.
- [ ] Add automated visual regression coverage beyond the current smoke test to guard the trimmed UI.
- [ ] Wire the Playwright CI job to automatically upload `artifacts/ui-review/` bundles to the Automation Sync dashboard.
- [ ] Draft a GitHub issue template for the weekly Automation Sync summary and link it from the contributor guide.

