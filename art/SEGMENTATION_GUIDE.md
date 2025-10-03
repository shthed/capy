# SVG Segmentation Guide

Follow these steps when exporting a new reference illustration so it can plug into the color-by-number runtime without additional cleanup. The segmented starters in `art/capybara-lagoon.svg`, `art/capybara-twilight.svg`, and `art/lush-green-forest.svg` are good references.

1. **Use a shared canvas.** Start from a 960×600 artboard (or document the width/height clearly) and ensure the exported `<svg>` includes an explicit `viewBox` and `width`/`height` so aspect ratio stays consistent.
2. **Include metadata.** Add `<title>` and `<desc>` elements at the top of the file that summarize the scene for assistive technology and reviewers.
3. **Group every paintable region.** For each numbered area wrap the path(s) in a `<g>` element that carries:
   - a unique `id` such as `region-c01`
   - `data-cell-id` (e.g., `c1`) that matches the JSON payload
   - `data-color-id` pointing to the palette entry
   - optional `data-color-name`/`data-color-hex`/`data-color-rgba` values that seed the importer’s palette metadata
   - an embedded `<title>` node that spells out the label, e.g. `Region c1 – Color #1 (Sky Mist)` so hovering in the app reveals the tooltip.
4. **Keep region geometry clean.** Use absolute commands (`M`, `L`, `C`, `Z`, etc.) with closed contours and avoid self-intersections. Curves are welcome for organic silhouettes, but ensure every region is watertight so the centroid sampler can locate a true interior point. Extremely thin slivers can confuse the automatic interior-point search, so widen them slightly or merge them with neighboring shapes when possible.
5. **Avoid overlaps and gaps.** Paths must not overlap and should fully cover the illustration. Slight padding between shapes is acceptable if the background should peek through, but cells cannot intersect. When in doubt, tile the full canvas with contiguous regions so the background never peeks through.
6. **Favor smooth, label-friendly shapes.** Round sharp spikes and carve smaller segments with gentle curves so each region has room for an interior badge. If a shape is small, scale it up slightly or flare the sides so the label finder can surface a bubble without being clipped by neighboring paths. When trunks or other elements should punch through layered foliage, use `fill-rule="evenodd"` cutouts (as in `lush-green-forest.svg`) so the regions stay non-overlapping while the silhouettes remain organic.
7. **Keep fills flat.** Assign a single solid fill color per region that roughly matches the palette entry. Decorative gradients or strokes are fine in non-paintable layers, but numbered regions should stay flat for clarity.
8. **Name the palette.** Document the palette separately (see `index.html`) with IDs, human-friendly names, and hex colors so the runtime can display swatches and instructions.
9. **Validate before shipping.** Open the SVG in a browser and move the pointer across the regions—each should display the tooltip text and highlight clean edges. Confirm no region bleeds outside the artboard and that IDs increment without gaps. Zoom in to verify that every badge would have enough breathing room to sit comfortably inside the painted shape.

Exporting assets with these conventions guarantees that new scenes import cleanly, display centered labels, and surface accessible tooltips in the game.
