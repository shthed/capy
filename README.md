# Capy Image Generator

Capy turns any bitmap image into a color-by-number puzzle entirely in the
browser. Drop a file (or load one via the hidden file picker) and the app will
resize it, run k-means clustering to build a discrete palette, merge tiny
regions, and paint a canvas + preview that you can immediately interact with.
No build tools or server runtime are required—the whole experience lives inside
`index.html`.

## How it works

1. **Load an image.** Drag a bitmap into the viewport or activate the “Choose an
   image” button. The hint overlay disappears once a source is selected.
2. **Quantize colours.** The generator resizes the image to the configured
   detail level, applies k-means, and converts the result into labelled regions.
3. **Explore the puzzle.** The left canvas shows the paintable view with outlines
   and number badges. A secondary preview canvas displays the clustered image.
4. **Fill regions.** Pick a colour in the palette dock, click any numbered cell,
   and the region fills in. Progress updates as soon as each area is completed.
5. **Download results.** When satisfied, export a JSON summary containing the
   palette, centroids, and region metadata.

## UI guide

- **Viewport canvas** – Hosts the interactive puzzle (`data-testid="puzzle-canvas"`).
  The canvas renders outlines, remaining numbers, and filled regions.
- **Status bar** – A floating card in the lower-left corner that narrates the
  current step (“Quantizing colours…”, “Generated 128 regions…”, etc.).
- **Options panel** – Fixed panel with three sliders:
  - **Colours** (`#colorCount`): number of palette entries to target (4–48).
  - **Regions** (`#minRegion`): merge threshold for tiny areas (in pixels).
  - **Detail** (`#detailLevel`): longest edge used when resizing the source
    image.
  The panel also exposes Apply, Reset, and Download buttons plus a live
  progress message.
- **Preview canvas** – Displays the clustered image using the generated palette
  so you can compare the quantized output against the puzzle view.
- **Palette dock** – Vertical list of swatches, each indicating the colour
  number, hex value, total region count, and remaining cells.

## Keyboard and accessibility notes

- The hint overlay is focusable and reacts to Enter/Space to trigger the file
  picker, keeping the first interaction accessible.
- Status and progress messages use `aria-live="polite"` to announce updates to
  assistive tech.
- Palette buttons toggle the active colour and expose `data-color-id` so tests
  and tooling can reason about selections.

## Testing

The Playwright suite exercises the core flows:

- **renders drag hint and options on load** – Confirms the hint overlay, status
  copy, and panel controls render on first boot.
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

