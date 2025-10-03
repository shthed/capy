# capy

Single-page color-by-number demo powered by a lightweight React 18 setup served
entirely from static files.

## App overview

The project is a single-page React 18 color-by-number demo that boots entirely
from `index.html`, pulling React, ReactDOM, and Babel from CDNs so the JSX logic
can run in the browser without a build step. It loads a predefined “Low‑poly
Fox” artwork composed of numbered SVG paths and a corresponding palette, then
tracks each cell’s fill state so users can paint the illustration by matching
colors to numbers.

Interaction handlers support mouse/touch gestures including wheel and pinch
zoom, panning, tap/drag fill, auto-advance to the next color, hint pulses for
small cells, and an eyedropper that reselects already-filled colors, while
keyboard shortcuts mirror core actions. Progress, remaining-cell counts, and
autosave persistence update automatically after each change, with a lightweight
smoke-test overlay verifying key invariants for debugging.

### UI elements

- **Root layout:** Dark-mode experience with a full-viewport canvas flanked by
  floating header and footer controls layered above the artwork.
- **Header bar:** Left back button (stubbed alert), centered artwork title, and
  a right-aligned control cluster with live progress text plus Fit, Undo, Hint,
  Next Color, and Smoke Test toggle buttons.
- **Canvas frame:** Fullscreen SVG stage wrapped with pan/zoom transforms,
  per-cell strokes, number badges at high zoom, and heat-map dots when zoomed
  out.
- **Smoke Tests HUD:** Optional floating card in the main area that reports
  automated sanity checks and can be hidden via the toolbar or “T” shortcut.
- **Palette footer:** Scrollable row of circular numbered swatches showing
  remaining cell counts, highlighting the active color, and disabling completed
  colors.
- **Options panel:** Floating dialog opened from the header that summarizes the
  app overview, lists the major UI surfaces, and exposes toggles for autosave,
  auto-advance, hint pulses, drag-fill, eyedropper, keyboard shortcuts,
  numbered overlays, heat-map dots, and the smoke-test HUD. Choices persist in
  localStorage and can be restored to the defaults with a single reset.

## Getting started

Open `index.html` directly in a browser (an internet connection is required on
first load to fetch the React + Babel runtime from the CDN), or serve the
repository root with any static file server:

```bash
python -m http.server 8000
```

Then visit <http://localhost:8000> to use the app.
