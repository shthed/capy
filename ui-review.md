# UI Review Notes

## Positive Observations
- The Peek control lets you preview the finished painting without leaving the canvas, either by holding or toggling the button.
- Palette swatches now list both color names and remaining counts, so picking the next hue is faster.
- Tap-to-fill now happens on deliberate clicks, reducing accidental strokes on touch screens while drag gestures stay focused on panning.
- Left-drag panning now keeps the canvas full-screen while the palette hugs the bottom edge without a frame.
- The new Help panel delivers a simple how-to, to-do checklist, and keyboard tips so new players understand the flow right away.
- The art library now opens with a thumbnail picker that previews each scene, making it faster to spot and load the exact artwork you want.
- The ultra-slim glass command rail now hugs the top edge in a single line, keeping library, options, reset, undo, hint, next, and testing controls visible without crowding the artwork.
- Mousewheel zoom now stays anchored under the cursor and both mouse buttons pan the scene, so navigation feels immediate and predictable.
- The integrated progress chip beside the artwork title makes it effortless to see completion percentage at a glance as you fill cells.
- Slimmed palette bubbles still feel tactile thanks to the inset numbering and glow, and they give the composition more breathing room around the artwork.
- Region numerals now stay centered even inside narrow tree trunks or tapered highlights, which makes the puzzle feel more intentional when zoomed in.

## Suggestions for Improvement
- Consider increasing the contrast between inactive palette swatches and the dark background to improve readability.
- On initial load, the onboarding helper text could be more prominent to guide first-time users to select a color before tapping the canvas.
- Offer a quick legend of gesture controls (pan, zoom, tap-to-fill) near the top bar so first-time painters notice the advanced interactions and available drag gestures.
- Some badge circles still graze the edge of extremely thin shapes; nudging the search radius or providing manual overrides for future art would eliminate the occasional overlap.

## Artwork Production Checklist
- Each SVG path must represent a single numbered region with no overlap; adjacent shapes may share edges but never stack on top of one another.
- Regions should use varied silhouettes (curves, diagonals, and organic contours) so the final illustration feels hand-crafted instead of grid based.
- Validate that every region receives a unique identifier and is referenced by the palette legend so color matching remains obvious to players.
- Before committing new artwork, zoom the canvas to inspect that no slivers remain unlabeled and that the aggregate composition still conveys the intended scene.
- Export the finalized segmentation alongside the detailed reference illustration (art/capybara-forest.svg) so the scene can be inspected or iterated on outside the runtime.
