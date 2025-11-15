# Capy: Color-By-Number Playground

Bring any image to life as a paint-by-numbers puzzle directly in your browser. Capy runs entirely client-side, so you can drag in artwork, explore the bundled Capybara Springs scene, and relax into a colouring session without installing anything.

<a href="https://shthed.github.io/capy/">Play Capy in your browser</a>

## Quick Start

1. Open the app and wait for the Capybara Springs sample to finish loading.
2. Tap a colour tile along the bottom palette to make it active.
3. Fill matching regions on the canvas by clicking, tapping, or using a stylus.
4. Watch finished areas reveal the clustered illustration as you progress.

Want to paint your own scene? Drop an image (PNG, JPG, WebP, GIF) anywhere on the page or choose **Import** from the command rail. Capy immediately rebuilds the puzzle using that artwork.

## Game Highlights

- **Instant puzzle import** – Drag-and-drop images or previously exported Capy puzzles to start colouring right away.
- **Three detail presets** – Low, Medium, and High detail buttons instantly reload the sample with tuned colour counts and region sizes so you can pick a breezy warm-up or a meticulous challenge.
- **Palette guidance** – Selecting a swatch briefly highlights every matching region and flashes when a colour is complete, making it obvious where to paint next.
- **Helpful hints** – Trigger hints to spotlight the smallest unfinished region when you need a nudge, or toggle the preview overlay to compare progress with the finished artwork.
- **Progress that sticks** – Capy autosaves after every stroke. Manual saves let you bookmark milestones, rename snapshots, export JSON files, and reload them later.
- **Play your way** – Adjust zoom, pan with the mouse, touch, or keyboard, hide region numbers for a clean canvas, and customise the background colour for better contrast.
- **Three rendering backends** – Pick between Canvas 2D, WebGL, or SVG in Settings to prioritise compatibility, GPU acceleration, or scalable vector output.

## Controls & Gestures

### Painting
- **Mouse / Trackpad:** The defaults keep left-click for filling, right-click as an eyedropper, and click-drag to pan (or hold <kbd>Space</kbd> to pan from anywhere). Customize left, middle, and right clicks—and their click+drag actions—under **Settings → Mouse controls**, including drag-to-zoom or select-and-fill mappings.
- **Touch:** Tap to paint, pinch to zoom, and drag with two fingers to pan. Double-tap gestures stay inside the canvas so the browser UI remains steady.
- **Keyboard:** Use the arrow keys or <kbd>Tab</kbd> to move focus between palette colours, press <kbd>Enter</kbd> or <kbd>Space</kbd> to select, and tap <kbd>+</kbd>/<kbd>-</kbd> (or <kbd>Shift</kbd> + <kbd>=</kbd>/<kbd>-</kbd>) to zoom.

### Command Rail
- **Preview** – Temporarily shows the finished clustered artwork on the canvas.
- **Generator** – Opens tuning controls for palette size, smoothing, and detail if you want to experiment with custom imports.
- **Fullscreen** – Expands the play surface edge-to-edge.
- **Import** – Choose a new image or Capy puzzle from disk.
- **Saves** – Manage autosaves and manual snapshots, reset the current board, or reload the Capybara Springs sample.
- **Help** – See an in-app manual, live activity log, and handy shortcuts.
- **Settings** – Toggle region numbers, adjust hint animations, remap mouse buttons, choose palette sorting, and tweak accessibility preferences.

## Saving, Sharing, and Reloading

- **Autosaves:** Capy restores your most recent puzzle automatically the next time you visit, even if you close the tab.
- **Manual saves:** Open **Saves** → **Snapshot current puzzle** to capture your progress. You can rename, duplicate, export, or delete saves at any time.
- **Exports:** Use **Export JSON** or **Export compact puzzle** (inside Settings) to download a portable puzzle file you can share or re-import later. Compact downloads save as `.capy` archives (`capy-export@2`) with trimmed metadata, varint-packed fill state, and LZ77 compression so they stay small even for large boards.
- **Resetting:** The **Reset puzzle progress** button clears the board while keeping your save list intact.

## Accessibility & Comfort Options

- **Palette sorting:** Arrange swatches by number, remaining regions, hue, or brightness to suit your workflow.
- **Contrast-aware labels:** Numbers automatically flip between light and dark treatments so every swatch stays legible.
- **Hint tuning:** Adjust animation fade and highlight intensity to keep guidance subtle or pronounced.
- **Background colour:** Pick a backdrop that makes outlines and numbers easy to read, whether you prefer light or dark themes.
- **Renderer toggle:** Choose Canvas 2D for broad compatibility, WebGL for GPU-accelerated compositing, or SVG for crisp vector output under **Settings → Appearance**.
- **Keyboard-friendly UI:** Command buttons expose descriptive labels and predictable focus order, and the help log uses polite announcements for assistive technology.

## Troubleshooting Tips

- **Image looks blocky?** Reload with a higher detail preset or increase palette size in the Generator panel.
- **Too many tiny regions?** Try the Low detail preset or raise the minimum region size slider before regenerating the puzzle.
- **Running out of storage?** Delete older saves from the Saves panel or export them to JSON before clearing.
- **Canvas won’t move?** Hold <kbd>Space</kbd> while dragging, or switch to a two-finger pan on touch devices.
- **WebGL option disabled?** If the WebGL renderer fails to initialise, Capy automatically falls back to Canvas 2D and disables the option—try updating graphics drivers or stick with Canvas/SVG on that device.

## Testing & QA

Automated UI coverage now runs through Playwright so you can validate the end-to-end flow without manual setup. Install dependencies from the workspace by running `cd project && npm install` (this triggers `npx playwright install --with-deps chromium chromium-headless-shell` so the bundled browser binaries and system libraries are ready). If the suite reports missing browsers or libraries, rerun that install command manually before executing the scripts below:

- `npm test` – from inside `project/`, launches the local dev server and executes the Playwright smoke check (Chromium desktop) using `playwright.config.js`.
- `npm run test:smoke` – from inside `project/`, targets the same Chromium project for quick iteration.

Playwright stores its reports under `playwright-report/` by default. After any run you can open the latest results with `npx playwright show-report` to review traces, screenshots, and console output.

## Want to Contribute?

Capy is open source! If you’d like to help shape new features, fix bugs, or expand the documentation, start with the development guide in [`AGENTS.md`](./AGENTS.md) and dive into the technical deep-dive in [`TECH.md`](./TECH.md). All contributor tooling now lives under [`project/`](./project/), so switch into that workspace before running npm scripts or Playwright commands. Runtime assets ship from [`runtime/`](./runtime/), which holds the single-page app (`index.html`), renderer bundle, generator module, and the bundled Capybara Springs fixture.
