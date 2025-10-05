# Capy

Single-page color-by-number playground powered by a lightweight React 18 setup
served directly from static files.

## App overview

The demo boots entirely from `index.html`, pulling React, ReactDOM, and Babel
from the vendored runtime bundles so JSX can execute without a build step. It
now includes four sample scenes—"Capybara in a Forest," "Capybara Lagoon
Sunrise," "Twilight Marsh Study," and "Lush Green Forest Walk"—and keeps track of every cell you fill as
you paint by matching colors to numbers. The library reads the segmented SVG
files directly so you can jump in and paint while progress is tracked
automatically. When opened via `file://`, the browser blocks direct `fetch`/XHR
access to sibling files, so the generated `art/starter-fallbacks.js` bundle
seeds the loader with the same SVG markup. On startup the loader now merges
those bundled scenes with anything in localStorage so refreshed starter updates
coexist with imported artwork.

### Feature highlights

- **Artwork library and importer:** Browse bundled scenes with hover previews,
  rename entries in place, or import new JSON/SVG payloads directly in the
  dialog. Library metadata (including autosave state) persists in
  `localStorage` so custom scenes stay available between sessions.
- **Palette customization:** Edit color names, override swatch hex values, or
  toggle Peek behavior from the Options panel. The palette dock now prints each
  color name directly inside its swatch, dims colors as you finish a hue, and
  can optionally show a minimal remaining-count badge inside the swatch.
- **Peek preview modes:** Hold the Peek button for a transient look at the
  completed illustration or toggle it to stay active. Keyboard shortcuts mirror
  the on-screen controls for quick access.
- **Improved navigation:** Cursor-anchored scroll zoom, dual-button panning,
  and high-precision number badges make it easier to explore dense artwork
  without losing context.

Interaction handlers support mouse and touch gestures including smooth,
cursor-anchored wheel zoom, pinch zoom, left- or right-button drag panning,
tap-to-fill (with optional drag-fill), auto-advance to the next color, hint
pulses for tiny cells, a configurable Peek preview, and an eyedropper that
reselects already-filled colors. Keyboard shortcuts mirror the core actions.
Progress, remaining-cell counts, and autosave state update immediately after
each change, while a lightweight smoke test overlay validates key invariants
when a check fails.

### UI elements

- **Top command rail:** Ultra-slim glass bar pinned near the top-right corner.
  It shows the active artwork title, a live progress chip, and compact icon
  buttons for the library, help, options, peek preview, and hint pulse. On
  phones the actions collapse behind a "Menu" toggle so the header stays tidy
  without hiding functionality.
- **Canvas frame:** Fullscreen SVG stage wrapped with pan/zoom transforms,
  per-cell strokes, number badges that stay centered inside each region, and
  optional heatmap dots when zoomed out.
- **Palette dock:** Floating glass strip centred beneath the canvas with a
  single-row, horizontally scrollable set of smaller swatches. Each swatch now
  shows both the number and color name inside the button, can surface a tiny
  remaining-count badge, highlights the active selection, dims once its cells
  are complete, and responds instantly to touch taps as well as clicks.
- **Smoke Tests HUD:** Hidden by default when all checks pass. If a test fails,
  a floating card appears with diagnostics and a reminder that the “T”
  shortcut toggles visibility.
- **Options panel:** Floating dialog that explains the app, lists controls,
  and exposes toggles for autosave, auto-advance, hint pulses, eyedropper,
  keyboard shortcuts, numbered overlays, heatmap dots, the smoke-test HUD,
  palette labels/badges, and peek behavior. Choices persist in `localStorage` and can be restored to
  the defaults with a single reset.

## Getting started

Open `index.html` directly in a browser (no build step required) or serve the
repository root with any static file server:

```bash
python -m http.server 8000
```

Then visit <http://localhost:8000> to use the app.

## Test suite explainers

Our automated Playwright run (`npm test --silent`) validates the experience end to end:

- **Application shell renders:** Confirms the React runtime boots, starter artwork mounts, and HUD chrome appears.
- **Artwork and palette presence:** Ensures the starter SVG and swatch dock render with the expected DOM structure.
- **Art library listing:** Opens the library dialog and verifies every bundled scene is present (Capybara in a Forest, Capybara Lagoon Sunrise, Twilight Marsh Study, Lush Green Forest Walk).
- **Painting updates progress:** Fills a cell to confirm the completion meter and progress chip react immediately.
- **HUD coverage snapshot:** Captures a full-page screenshot plus a JSON summary with palette counts, cell totals, progress text/ARIA label, and the presence of the art-library control.
- **Mobile command rail layout:** Boots the app at a handheld viewport to ensure the header hugs the top-right edge, the menu toggle reveals every command, and the palette swatches stay compact while still showing their color names.
- **Starter merge behavior:** Boots with stored data to ensure bundled scenes merge without duplication.
- **Title preservation:** Checks that custom titles persist after a starter refresh.
- **SVG quality checks:** Parses each bundled SVG (`capybara-forest`, `capybara-lagoon`, `capybara-twilight`, `lush-green-forest`) to enforce formatting and metadata quality.

See [docs/test-run-2025-10-04.md](docs/test-run-2025-10-04.md) for the latest run log, timings, and raw output.
