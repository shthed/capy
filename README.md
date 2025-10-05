# Capy Image Generator

Capy turns any bitmap image into a color-by-number puzzle entirely in the
browser. Drop a file (or load one via the hidden file picker) and the app will
resize it, run k-means clustering to build a discrete palette, merge tiny
regions, and paint a canvas you can immediately play. A fullscreen preview, hint
tools, a save manager, and a configurable generator all live inside a single
`index.html` document—no build tools or extra runtime required.

## How it works

1. **Load an image.** Drag a bitmap into the viewport or activate the “Choose an
   image” button. The hint overlay disappears once a source is selected.
2. **Tune generation.** Open **Settings** to tweak palette size, minimum region
   area, resize detail, sample rate (for faster clustering), iteration count,
   and smoothing passes. Apply changes instantly when working from an image
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

- **Command rail** – A slim header exposing Hint, Reset, Preview, Import, Save
  manager, and Settings buttons. Hint flashes tiny regions, Reset clears
  progress, Preview reveals the fullscreen clustered artwork, Import accepts
  images or JSON puzzles, Save manager opens the local snapshot vault, and
  Settings reveals generator/gameplay options.
- **Viewport canvas** – Hosts the interactive puzzle (`data-testid="puzzle-canvas"`).
  The canvas renders outlines, remaining numbers, and filled regions, and
  respects the auto-advance / hint animation toggles stored in settings.
- **Fullscreen preview overlay** – Triggered by the Preview button. The preview
  canvas stretches to fit the viewport so contributors can inspect the clustered
  output in detail before painting.
- **Status bar** – A floating card in the lower-left corner that narrates each
  step (“Quantizing colours…”, “Smoothing regions…”, “Puzzle complete!”).
- **Settings sheet** – A modal sheet that hides the generation sliders by
  default. Controls include colours, minimum region size, resize detail, sample
  rate, k-means iterations, and smoothing passes, plus toggles for auto-advance
  and hint animations. The sheet also houses the JSON export action.
- **Save manager** – A companion sheet listing every stored snapshot. Each entry
  shows completion progress with quick actions to load, rename, export, or
  delete the save.
- **Palette dock** – A horizontal scroller anchored to the bottom of the page.
  Each swatch lists the colour number, hex value, total cell count, and
  remaining regions while exposing `data-color-id` for automation hooks.

## Keyboard and accessibility notes

- The hint overlay is focusable and reacts to Enter/Space to trigger the file
  picker, keeping the first interaction accessible.
- Status and progress messages use `aria-live="polite"` announcements so assistive
  tech hears every generator update.
- Command rail buttons advertise clear labels (“Hint”, “Preview”, etc.) and stay
  reachable via keyboard focus.
- Palette buttons toggle the active colour and expose `data-color-id` so tests
  and tooling can reason about selections. Auto-advance can be disabled from the
  Settings sheet for full manual control.
- Both the settings and save sheets trap focus while open and close via their
  dedicated Close buttons or the shared backdrop.

## Testing

The Playwright suite exercises the core flows:

- **renders command rail and generator settings on load** – Confirms the hint
  overlay, status copy, command rail buttons, and generator controls render on
  first boot.
- **lets players fill a puzzle to completion** – Loads a tiny fixture via
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

