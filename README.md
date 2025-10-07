# Capy Image Generator

Capy turns any bitmap image into a color-by-number puzzle entirely in the
browser. Drop a file (or load one via the hidden file picker) and the app will
resize it, run k-means clustering to build a discrete palette, merge tiny
regions, and paint a canvas you can immediately play. A fullscreen preview, hint
tools, a save manager, and a configurable generator all live inside a single
`index.html` document—no build tools or extra runtime required.

## Features

- **Instant image import.** Drag-and-drop or use the picker to feed bitmaps or
  previously exported JSON puzzles straight into the generator pipeline.
- **Built-in capybara sample.** The "Capybara Springs" illustration now loads
  automatically on boot so you can start painting without importing anything.
  The vignette features an orange-balanced capybara lounging in a lagoon with a
  curious dachshund, water mushrooms, and a distant waterfall, and the 🐹
  command rail button instantly reloads it whenever you want a fresh board.
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
  keyboard for incremental adjustments. The canvas now stretches to fill the
  viewport, centres itself automatically, and honours device orientation
  changes without losing your place.
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
- **Progress persistence & recovery.** Every stroke updates a rolling
  autosave so the latest session is restored automatically on launch. Manual
  snapshots still land in the save manager where you can rename, export, or
  delete entries at will.
- **Cloud-ready sync.** A lightweight broadcast channel mirrors autosaves
  across browser tabs and exposes a `window.capyCloudSync` adapter hook so
  teams can plug in remote storage when available.

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
   automatically so you can start painting immediately. Drag a bitmap into the
   viewport, activate the “Choose an image” button, or press the 🐹 command
   button to reload the bundled scene. The hint overlay disappears once a new
   source is selected.
2. **Tune generation & appearance.** Open **Settings** to tweak palette size,
   minimum region area, resize detail, sample rate (for faster clustering),
   iteration count, smoothing passes, auto-advance, hint animations, and the
   canvas background colour. Apply changes instantly when working from an image
   source.
3. **Explore the puzzle.** The game canvas shows outlines and number badges,
   while the **Preview** button floods the entire viewport with a fullscreen
   comparison of the clustered artwork.
4. **Fill regions.** Pick a colour from the bottom dock, click any numbered cell,
   and the region fills in. Auto-advance can hop to the next incomplete colour
   once you finish the current hue.
5. **Save or export.** The save manager captures snapshots (including progress,
   generator options, and source metadata) in localStorage. Export the active
   puzzle as JSON at any time.

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
  scene and use the scroll wheel (or trackpad gesture) to zoom.
- **Fullscreen preview overlay** – Triggered by the Preview button. The preview
  canvas stretches to fit the viewport so contributors can inspect the clustered
  output in detail before painting.
- **Progress indicator** – A numeric tally in the palette dock that tracks
  completed versus total regions and announces updates politely via `aria-live`.
- **Settings sheet** – A modal sheet that hides the generation sliders by
  default. Controls include colours, minimum region size, resize detail, sample
  rate, k-means iterations, smoothing passes, a background colour picker, plus
  toggles for auto-advance and hint animations. The sheet also houses the JSON
  export action.
- **Save manager** – A companion sheet listing every stored snapshot. Each entry
  shows completion progress with quick actions to load, rename, export, or
  delete the save.
- **Help sheet** – Lists every command button, summarizes canvas gestures, and
  surfaces a live debug log so contributors can confirm state changes while
  testing.
- **Palette dock** – A horizontal scroller anchored to the bottom of the page.
  Each compact swatch keeps the colour number front-and-center while tooltips
  and `data-color-id` attributes expose the colour name plus remaining counts
  for automation hooks.

## Keyboard and accessibility notes

- The hint overlay is focusable and reacts to Enter/Space to trigger the file
  picker, keeping the first interaction accessible.
- The progress tally uses `aria-live="polite"` announcements so assistive tech
  hears every completion update, and the help sheet’s debug log mirrors the same
  polite live region for gameplay telemetry.
- Command rail buttons expose descriptive `aria-label` and `title` attributes
  even though the visual controls are icon-only, and they stay reachable via
  keyboard focus.
- Palette buttons toggle the active colour and expose `data-color-id` so tests
  and tooling can reason about selections. Auto-advance can be disabled from the
  Settings sheet for full manual control.
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
  overlay, iconized command rail, compact progress tally, and generator controls
  render on first boot.
- **auto loads the capybara sample scene** – Verifies the bundled illustration is
  ready as soon as the app boots and that the sample button still reloads it on
  demand.
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

