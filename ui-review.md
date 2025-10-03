# UI Review Notes

## Positive Observations
- The glassy top command bar now centralizes library, options, and canvas utilities with readable labels and generous touch targets.
- The integrated progress chip beside the artwork title makes it effortless to see completion percentage at a glance as you fill cells.
- Keyboard shortcuts and hint messaging are surfaced in the footer, which supports accessibility for power users.

## Suggestions for Improvement
- Consider increasing the contrast between inactive palette swatches and the dark background to improve readability.
- On initial load, the onboarding helper text could be more prominent to guide first-time users to select a color before tapping the canvas.
- Offer a quick legend of gesture controls (pan, zoom, drag-fill) near the top bar so first-time painters notice the advanced interactions.

## Artwork Production Checklist
- Each SVG path must represent a single numbered region with no overlap; adjacent shapes may share edges but never stack on top of one another.
- Regions should use varied silhouettes (curves, diagonals, and organic contours) so the final illustration feels hand-crafted instead of grid based.
- Validate that every region receives a unique identifier and is referenced by the palette legend so color matching remains obvious to players.
- Before committing new artwork, zoom the canvas to inspect that no slivers remain unlabeled and that the aggregate composition still conveys the intended scene.
- Export the finalized segmentation alongside the detailed reference illustration (art/capybara-forest.svg) so the scene can be inspected or iterated on outside the runtime.
