# UI Review Notes

## Automated Visual Capture
- Run `npm test --silent` to boot the static demo, grab a full-page screenshot, and log palette/cell counts to `artifacts/ui-review`. The harness fails automatically if the screenshot capture is empty, the console throws, or the page renders without palette buttons/numbered regions.
- The companion prompt-flow suite (`tests/prompt-flow.spec.js`) mocks the ChatGPT image API so we can assert both the successful import and sample fallback without relying on the network. Trigger it on its own with `npm run test:prompt` during prompt work.
- The multi-scene sweep now opens the art library, loads every bundled SVG, and stores per-artwork screenshots plus JSON summaries under `artifacts/ui-review/artworks/`. A manifest is emitted alongside the images so you can confirm counts and console status for each scene at a glance.
- The JSON summary now records the header button ARIA labels and whether the art-library affordance is present so regressions are obvious during review.
- A dedicated interaction check clicks the first paintable region, ensuring the DOM reflects the filled state and no console errors appear while tapping-to-fill.
- Interaction coverage also asserts that selecting a palette swatch pulses every matching region and that mouse-wheel as well as keyboard `+`/`-` zoom controls adjust the viewport scale.
- The smoke run now exercises the ChatGPT prompt on load (falling back to the bundled sample puzzle when no API key is available) and confirms the fullscreen control is available for edge-to-edge play.
- Review the generated JSON for console errors and metadata counts, then open the screenshot to confirm composition changes look right before merging.

## Positive Observations
- The Peek control lets you preview the finished painting without leaving the canvas, either by holding or toggling the button.
- The ChatGPT prompt bar now drives first-run art generation, gracefully falling back to the bundled “Capycolour Springs” scene so testers always land on a paintable puzzle without importing anything.
- Palette swatches now tuck their color names directly inside the button while keeping the numbers bold, so picking the next hue is faster without extra labels.
- Tap-to-fill now fires on deliberate taps, and palette swatches respect the same pointer handling so choosing a color on touch devices never requires a second press while drag gestures stay focused on panning.
- Left-drag panning now keeps the canvas full-screen while the palette hugs the bottom edge without a frame.
- The Help & shortcuts sheet now lists every command icon (including the prompt bar), reiterates the gesture cheatsheet, offers a ChatGPT access form for storing/clearing the API key, and pipes a live debug log with severity pills and a legend so QA can confirm fills, hints, zooms, ChatGPT requests, and the start/finish of sample reloads as they happen.
- The new generator status tray in the palette dock shows a live progress bar, a telemetry grid (mode/prompt, source & target sizes, palette/region totals, background, live progress percentages, current pipeline step), plus fading notifications for file reads, k-means clustering, smoothing, segmentation counts, and palette prep, making it obvious when the import pipeline is working or blocked. On handheld screenshots the tray collapses completely so the palette has breathing room while the mirrored Help log keeps telemetry reachable.
- The art library now opens with a thumbnail picker that previews each scene, making it faster to spot and load the exact artwork you want.
- The ultra-slim glass command rail now hugs the top-right corner with a hint icon plus menu toggle and fullscreen toggle, keeping library, options, help, peek, and hint controls reachable without crowding the artwork.
- The mobile smoke run confirms the compact swatches stay legible and the top rail remains reachable at handheld sizes.
- Rotation events and fullscreen transitions now recenter the canvas automatically, so orientation changes never strand the puzzler.
- Mousewheel zoom now stays anchored under the cursor, eases smoothly toward the target scale, keyboard nudges on `+`/`-` mirror the motion, and both mouse buttons pan the scene, so navigation feels immediate and predictable.
- Palette pulses now accompany colour selection so playtesters immediately see every matching region (or a brief celebration when a colour is finished).
- The Settings sheet now exposes a background colour picker that immediately repaints unfinished regions and recalibrates outline contrast, making dark themes workable without extra CSS overrides.
- Long-pressing the hint icon now peeks at the finished artwork while a tap still flashes hint pulses, so advanced guidance stays one gesture away.
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
