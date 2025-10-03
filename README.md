# Capy

Single-page color-by-number playground powered by a lightweight React 18 setup
served directly from static files.

## App overview

The demo boots entirely from `index.html`, pulling React, ReactDOM, and Babel
from the vendored runtime bundles so JSX can execute without a build step. It
now includes three sample scenes—"Capybara Forest Retreat," "Capybara Lagoon
Sunrise," and "Twilight Marsh Study"—and keeps track of every cell you fill as
you paint by matching colors to numbers.

Interaction handlers support mouse and touch gestures including smooth,
cursor-anchored wheel zoom, pinch zoom, left- or right-button drag panning,
tap-to-fill, auto-advance to the next color, hint pulses for tiny cells, a configurable Peek preview, and
an eyedropper that reselects already-filled colors. Keyboard shortcuts mirror
the core actions. Progress, remaining-cell counts, and autosave state update
immediately after each change, while a lightweight smoke test overlay
validates key invariants when a check fails.

### UI elements

- **Top command rail:** Ultra-slim glass bar pinned to the top edge. It shows
  the active artwork title, a live progress chip, and compact buttons for the
  library, options, reset, undo, hint, next color, and smoke-test toggle in a
  single line.
- **Canvas frame:** Fullscreen SVG stage wrapped with pan/zoom transforms,
  per-cell strokes, number badges that stay centered inside each region, and
  optional heatmap dots when zoomed out.
- **Palette dock:** Floating glass strip centred beneath the canvas with a
  single-row, horizontally scrollable set of swatches. Each swatch now shows
  the color name and remaining count, highlights the active selection, and dims
  once its cells are complete.
- **Smoke Tests HUD:** Hidden by default when all checks pass. If a test fails,
  a floating card appears with diagnostics and a reminder that the “T”
  shortcut toggles visibility.
- **Options panel:** Floating dialog that explains the app, lists controls,
  and exposes toggles for autosave, auto-advance, hint pulses, eyedropper,
  keyboard shortcuts, numbered overlays, heatmap dots, the smoke-test HUD,
  palette labels, and peek behavior. Choices persist in `localStorage` and can be restored to
  the defaults with a single reset.

## Getting started

Open `index.html` directly in a browser (no build step required) or serve the
repository root with any static file server:

```bash
python -m http.server 8000
```

Then visit <http://localhost:8000> to use the app.
