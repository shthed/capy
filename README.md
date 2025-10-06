# Capycolour Image Generator

Capycolour turns any idea or bitmap into a colour-by-number puzzle directly in
the browser. On boot the game now asks ChatGPT to sketch a fresh illustration
from the stored prompt (or a whimsical default), then automatically imports the
result so you can start painting immediately. A glassy prompt bar in the command
rail lets you tweak the description at any time, while a bundled Capycolour
sample puzzle remains available as a reliable fallback. The entire experience
still lives inside `index.html`—no build step or framework runtime required.

## Features

- **ChatGPT-powered scene generation.** The `?` prompt bar sends your description
to OpenAI's image endpoint and pipes the returned artwork straight into the
segmentation pipeline. The command rail disables while a request is in flight
and the debug log records success or failure so you know exactly what happened.
- **Sample safety net.** If no API key is configured (or the network request
fails) Capycolour automatically reloads the bundled “Capycolour Springs” SVG so
you always land on a playable puzzle. The 🐹 button still reloads the sample on
demand.
- **Instant image import.** Drag-and-drop or use the picker to feed bitmaps or
previously exported JSON puzzles straight into the generator pipeline.
- **Detailed debug logging.** The Help sheet's live log announces ChatGPT
  requests, sample fallbacks, fills, hints, zooms, background tweaks, fullscreen
  toggles, and ignored clicks so QA can confirm the entire flow without cracking
  open DevTools.
- **In-app key manager.** Help → ChatGPT access stores or clears the OpenAI API
  key with a single click while the prompt bar reflects the current state.
- **Configurable puzzle generator.** Tune palette size, minimum region area,
resize detail, sampling, iteration count, and smoothing passes before rebuilding
the scene.
- **Responsive painting canvas.** Click or tap numbered regions to fill them in
while optional auto-advance hops to the next unfinished colour. Filled areas now
reveal the clustered artwork beneath the outlines so the illustration gradually
emerges as you work.
- **Colour cues and feedback.** Choosing a swatch briefly pulses every matching
region (falling back to a celebratory flash when a colour is finished) so it's
obvious where to paint next, and correctly filled regions immediately display
the underlying illustration.
- **Customisable background.** Pick a backdrop colour for unfinished regions in
the Settings sheet; outlines and numbers automatically switch contrast so dark
or light themes stay legible while you paint.
- **Precision view controls.** Pan the puzzle by click-dragging with the primary
mouse button (spacebar, middle, and right buttons still work), use pinch
gestures or the mouse wheel to zoom in and out, or tap `+`/`-` on the keyboard
for incremental adjustments. The canvas stretches to fill the viewport, centres
itself automatically, and honours device orientation changes without losing your
place.
- **Edge-to-edge stage.** A fullscreen toggle, rotation-aware sizing, and dynamic
viewport padding ensure the command rail and palette scale cleanly on phones,
tablets, or desktops while the artwork stays centred.
- **Contextual hinting.** Trigger highlight pulses for the current colour or let
the app surface the smallest unfinished region when you need a nudge.
- **Fullscreen preview.** Toggle a comparison overlay that shows the clustered
artwork at its final resolution without leaving the play surface.
- **Palette manager.** Swipe through compact, tinted swatches that promote the
colour number while tooltips, titles, and ARIA copy preserve human-readable
names and remaining region counts.
- **Progress persistence.** Snapshot runs into localStorage, reopen saves,
rename them, or export/import the underlying puzzle data as JSON.

## Code architecture tour

- **Single-file app shell.** `index.html` owns the markup, styles, logic, and the
new ChatGPT orchestration helpers. The inline script is segmented into DOM
caches, global state, event wiring, puzzle rendering, generation helpers, prompt
storage, and persistence utilities—each called out in a developer map comment at
the top of the file.
- **Public testing surface.** `window.capyGenerator` exposes harness-friendly
helpers (`loadFromDataUrl`, `loadPuzzleFixture`, `generateFromPrompt`,
`togglePreview`, etc.) so the Playwright suite and manual experiments can
orchestrate the app without relying on internal selectors.
- **Pan/zoom subsystem.** `viewState` tracks the transform for `#canvasStage` and
`#canvasTransform`; helpers like `applyZoom`, `resetView`, and
`applyViewTransform` keep navigation smooth across wheel, keyboard, and drag
gestures.
- **Puzzle rendering pipeline.** `renderPuzzle` orchestrates drawing the current
canvas, using `applyRegionToImage`, `drawOutlines`, and `drawNumbers`. Visual
feedback uses `flashColorRegions` and `paintRegions` to overlay tint pulses.
- **Generation + segmentation.** Image imports flow through `createPuzzleData`,
which performs quantization (`kmeansQuantize`), smoothing, and `segmentRegions`
before feeding `applyPuzzleResult`. Regeneration and fixtures reuse the same
entry point so gameplay and export code paths stay in sync.
- **ChatGPT integration.** `generatePromptedPuzzle` resolves the stored API key,
sends prompt requests, handles error logging, and falls back to the bundled
sample when necessary. Helpers store prompts and API keys in localStorage while
the command rail reflects pending state.
- **Persistence helpers.** `persistSaves`, `loadSavedEntries`, and
`serializeCurrentPuzzle` manage the save sheet while JSON exports lean on the
same serialization path for predictable data output.

## Pointer interaction flow

- **Pointer staging.** The stage element (`#canvasStage`) captures all pointer
events for the playfield. `handlePanStart` records the pointer that pressed
 down, immediately beginning a pan for right/middle clicks or when modifier keys
(Space/Alt/Ctrl/Meta) are held. Touch pointers are tracked individually so
single-finger drags can promote into pans while multi-touch sessions trigger
pinch zooming.
- **Pan promotion.** `handlePanMove` measures how far the candidate pointer has
travelled. Once it exceeds roughly four pixels the function calls
`beginPanSession`, captures the pointer, and continuously updates `viewState` so
the canvas glides under the cursor.
- **Teardown safeguards.** `handlePanEnd` runs for `pointerup`, `pointercancel`,
and `lostpointercapture` so releasing the mouse outside the viewport still
resets the grab cursor and clears pan state.
- **Zoom input.** Scroll wheel events, `+`/`-` keyboard shortcuts, pinch gestures,
and helper calls from tests all feed into `applyZoom`, which calculates a new
scale, recenters the viewport, and updates the debug log with the latest
percentage (pinch sessions summarise their final zoom when they end).
- **Region clicks.** The canvas click handler first validates that a puzzle and
active colour exist, then resolves the clicked pixel to a region. Mismatches
trigger a yellow flash and a debug log entry explaining which colour is
required, while successful fills call `applyRegionToImage` and advance progress
tracking.

## How it works

1. **Generate or load art.** On boot Capycolour sends the stored prompt (or a
   built-in default) to ChatGPT and, if successful, imports the returned PNG. If
the request is skipped or fails, the bundled “Capycolour Springs” puzzle loads
instead. You can edit the prompt at any time or import your own image/JSON file.
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

- **Prompt bar** – A pill-shaped form anchored to the left side of the command
  rail. The question mark icon mirrors the hint button while the “Draw” control
  sends your description to ChatGPT. When a request is pending the form dims,
  disables input, and the button label switches to “Drawing…”.
- **Command rail** – Icon-only controls for Hint, Reset, Preview, Sample,
  Fullscreen, Import, Save manager, Help, and Settings. Hint flashes tiny
  regions, Reset clears progress, Preview reveals the clustered artwork, Sample
  reloads the bundled Capycolour puzzle, Fullscreen pushes the stage edge-to-
  edge (and exits back to windowed mode), Import accepts images or JSON puzzles,
  Save manager opens the local snapshot vault, Help opens an in-app manual plus
  live debug log, and Settings reveals generator/gameplay options.
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
- **Help sheet** – Lists every command icon (including the prompt bar),
  summarizes canvas gestures, and surfaces a live debug log so contributors can
  confirm state changes while testing.
- **Palette dock** – A horizontal scroller anchored to the bottom of the page.
  Swatches keep their number badges bold while tooltips and ARIA copy preserve
  colour names and remaining counts.

## ChatGPT setup

Open **Help → ChatGPT access** and paste your key into the **OpenAI API key**
field. Saving it stores the key in `localStorage` (`capycolour.openaiKey`) for
this browser only, while the **Clear stored key** button removes it instantly.
The prompt bar now reflects the stored state and logs whenever a key is added or
removed, so you always know which source will be used for the next request.

For scripted runs you can still set the key manually:

```js
window.capyGenerator.setChatGPTKey('sk-...');
// window.capyGenerator.clearChatGPTKey();
```

If no key is saved Capycolour logs the omission and immediately reloads the
bundled sample puzzle instead of attempting a network request.

## Development workflow

1. Install dependencies: `npm install` (Playwright browsers install automatically
   via the postinstall hook).
2. Start the dev server: `npm run dev` and open <http://127.0.0.1:8000/index.html>.
3. Run Playwright smoke tests: `npm test --silent`.
4. ChatGPT calls originate from the browser, so store an OpenAI key via
   **Help → ChatGPT access** (or `window.capyGenerator.setChatGPTKey('sk-...')`) before
   relying on the prompt bar locally.
5. Review `artifacts/ui-review/` after tests for captured screenshots and JSON
   summaries (palette counts, header labels, etc.).

