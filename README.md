# Capy: Color-By-Number Playground

A browser-based paint-by-numbers generator and player. Runs fully client-side. Usable in desktop and mobile browsers.

<a href="https://shthed.github.io/capy/">Launch Capy</a>

## Overview

- Converts imported images (PNG/JPG/WebP/GIF) into numbered colour regions.
- Bundles the Capybara Springs sample puzzle for instant play.
- Supports Canvas 2D, WebGL, and SVG renderers.
- Saves progress locally with autosave and manual snapshots.
- Ships a service worker for offline use on same-origin loads.

## How to Play

1. Open the app and let the Capybara Springs sample load.
2. Select a palette tile along the bottom bar.
3. Click/tap/pen-fill matching regions. Mouse right-click acts as an eyedropper by default.
4. Use hints or preview to locate remaining regions.

Image import: drop a file anywhere or use **Import** in the command rail. The puzzle regenerates immediately using the new asset.

## Offline and Install Behavior

- `service-worker.js` precaches the runtime after the first HTTPS load (including the `https://capy.local/` alias).
- Cached assets enable offline play and home-screen installs; clearing site data removes the cache and resets the worker.
- If a deployment looks stale, perform a hard refresh to update the cache before continuing.

## Key Controls

- **Mouse / Trackpad:** Left-click fill, right-click eyedropper, click-drag to pan (or hold <kbd>Space</kbd>). Button mappings can be reassigned under **Settings → Mouse controls**.
- **Touch:** Tap to paint, pinch to zoom, two-finger drag to pan. Double taps stay within the canvas area.
- **Keyboard:** Arrow keys or <kbd>Tab</kbd> to move through palette colours; <kbd>Enter</kbd>/<kbd>Space</kbd> to select; <kbd>+</kbd>/<kbd>-</kbd> (or <kbd>Shift</kbd> + <kbd>=</kbd>/<kbd>-</kbd>) to zoom.

## Command Rail Actions

- Preview finished artwork overlay.
- Generator tuning for palette size, smoothing, and detail.
- Fullscreen toggle.
- Import new images or Capy puzzle files.
- Saves management, reset, and sample reload.
- Help panel with manual and activity log.
- Settings for numbers, hints, palette sorting, renderer, and accessibility options.

## Saving and Exporting

- Autosaves restore the last session automatically.
- Manual snapshots allow rename, duplicate, delete, and reload operations.
- Exports: JSON or compact `.capy` archives (`capy-export@2`) with compressed metadata and fill state.
- Reset puzzle progress without removing stored saves.

## Accessibility and Comfort

- Palette sorting by number, remaining regions, hue, or brightness.
- Contrast-aware palette labels.
- Hint animation intensity controls.
- Background colour selection for contrast preferences.
- Renderer choice under **Settings → Appearance** to balance compatibility and fidelity.

## Troubleshooting

- Blocky image: increase detail preset or palette size.
- Too many small regions: use Low detail preset or raise minimum region size before regenerating.
- Low storage: delete or export saves before clearing.
- Canvas stuck: hold <kbd>Space</kbd> while dragging or use two-finger pan.
- WebGL disabled: hardware fallback to Canvas 2D; update drivers or continue with Canvas/SVG.

## Automation

`window.capyGenerator` provides scripted control from the devtools console:

```js
const capyFixture = await fetch("capy.json").then((r) => r.json());
window.capyGenerator.loadPuzzleFixture(capyFixture);
window.capyGenerator.togglePreview(true);
window.capyGenerator.setRenderer("canvas");
window.capyGenerator.setActiveColor(3, { flash: true });
window.capyGenerator.fillRegion(42, { ensureColor: true, label: "qa-fill" });
```

See [`TECH.md`](./TECH.md#windowcapygenerator-api-reference) for full API reference.

## Testing and QA

All tooling lives in `project/`.

- Install dependencies: `cd project && npm install`.
- Provision Playwright browsers: `npm run setup:playwright` (inside `project/`).
- Smoke and generator tests: `npm test` (from `project/`).
- Playwright-only quick run: `npm run test:smoke` (from `project/`).
- Reports: open `npx playwright show-report` after a run (default output `playwright-report/`).

## Local Development and Hosting

- Dependencies: `cd project && npm install`.
- Serve repository root at http://localhost:8000 with `npm run dev` (run inside `project/`). Uses `http-server` with caching disabled for fast reloads while exercising the service worker.

## Contributing

Review [`TECH.md`](./TECH.md) for architecture details. Contributor scripts and Playwright config live under [`project/`](./project/). Runtime assets reside at the repository root (`index.html`, `styles.css`, `render.js`, `puzzle-generation.js`, `capy.json`, `service-worker.js`). CSS conventions live in [`project/STYLEGUIDE.md`](./project/STYLEGUIDE.md).
