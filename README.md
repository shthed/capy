# Capy

Single-page color-by-number playground powered by a lightweight React 18 setup
served directly from static files.

## App overview

The demo boots entirely from `index.html`, pulling React, ReactDOM, and Babel
from the vendored runtime bundles so JSX can execute without a build step. The
default scene streams directly from the annotated SVG at
`art/capybara-lagoon.svg`, and the starter loader now fetches the segmented
twilight companion in `art/capybara-twilight.svg` alongside the new
"Lush Green Forest Walk" reference stored in `art/lush-green-forest.svg`. The
library ships all three scenes so you can jump in and paint while progress is
tracked automatically.

When the app runs from `file://`, the loader hydrates each starter from the
embedded SVG strings inside `art/starter-fallbacks.js` instead of making
network requests. Regenerate the inline bundle after editing any starter SVG
with either command:

```bash
npm run build:fallbacks
# or
node tools/build-starter-fallbacks.js
```

Interaction handlers support mouse and touch gestures including smooth,
cursor-anchored wheel zoom, pinch zoom, left- or right-button drag panning,
tap/drag fill, auto-advance to the next color, hint pulses for tiny cells, and
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
  single-row, horizontally scrollable set of circular swatches. Swatches
  resize to stay round, highlight the active selection, and dim once their
  cells are complete.
- **Smoke Tests HUD:** Hidden by default when all checks pass. If a test fails,
  a floating card appears with diagnostics and a reminder that the “T”
  shortcut toggles visibility.
- **Options panel:** Floating dialog that explains the app, lists controls,
  and exposes toggles for autosave, auto-advance, hint pulses, drag-fill,
  eyedropper, keyboard shortcuts, numbered overlays, heatmap dots, and the
  smoke-test HUD. Choices persist in `localStorage` and can be restored to
  the defaults with a single reset.

## Getting started

Open `index.html` directly in a browser (no build step required) or serve the
repository root with any static file server:

```bash
python -m http.server 8000
```

Then visit <http://localhost:8000> to use the app.
