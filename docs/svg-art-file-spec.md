# SVG Art File Specification

This document defines the structure and metadata requirements for segmented SVG scenes that ship with Capybooper (all files in `art/*.svg` that are intended to be imported into the coloring runtime). Follow this checklist when exporting art or reviewing pull requests that touch SVG assets.

## Canvas & Accessibility Metadata
- Export scenes at 960×600 (or document the actual size) and include explicit `width`, `height`, and `viewBox` attributes on the root `<svg>` element so the runtime can scale reliably.
- Keep `xmlns="http://www.w3.org/2000/svg"` on the root node so the parser reads the document in SVG mode.
- Declare `role="img"` on `<svg>` and wire `aria-labelledby` to the human readable metadata nodes. The attribute must reference **both** the `<title>` and `<desc>` IDs without duplicates so assistive tech announces the scene correctly.
- Provide meaningful `<title>` and `<desc>` elements immediately inside `<svg>`. Each element **must** carry an `id` attribute so it can be referenced by `aria-labelledby`, and their text content should be trimmed and descriptive.

## Region Group Requirements
- Every paintable area lives in a direct child `<g>` element on the root `<svg>`.
- Each group requires a unique `id` that follows the pattern `region-cXX`, where `XX` is the `data-cell-id` number left-padded to two digits (e.g. `data-cell-id="c5"` → `id="region-c05"`).
- Include `data-cell-id`, `data-color-id`, `data-color-name`, and `data-color-hex` attributes on every group:
  - `data-cell-id` values start at `c1` and increment without gaps (`c1`, `c2`, `c3`, …).
  - `data-color-id` is a positive integer string that references the palette slot.
  - `data-color-name` is the human readable swatch label.
  - `data-color-hex` is a six-digit hex color such as `#1c6f8c`.
- Nest a `<title>` element inside each region group to provide the tooltip/annotation text that displays in the app.

## Geometry Expectations
- Group nodes must contain one or more `<path>` elements with populated `d` attributes so the runtime can paint the geometry.
- Avoid `fill="none"` on paintable paths. The runtime uses the fill to seed sampling and highlight strokes.
- Use clean, closed path data. Refer to `art/SEGMENTATION_GUIDE.md` for composition advice around overlaps, fill rules, and shape hygiene.

## Validation
Run `npm test --silent` before committing new or updated art. The Node smoke harness confirms `index.html` and the handbook still document the testing contract; pair it with a manual import of the SVG to verify palette counts, numbered regions, and console output before signing off.
