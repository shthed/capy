# Developer Onboarding Guide

Welcome to Capy! This guide gets new contributors productive quickly by surfacing
what matters most for local setup, the runtime architecture, and day-one
expectations.

## Setup checklist
- **Prerequisites:** Node.js 18+.
- **Install dependencies:** from `project/`, run `npm install` (pulls Playwright
  and the lightweight dev server). If you plan to run UI tests locally, follow
  with `npm run setup:playwright` to provision the Chromium bundle.
- **Serve the app:** `npm run dev` from `project/` hosts the repository root at
  http://localhost:8000. The runtime is build-free, so the HTML and JS in the
  root load as-is.
- **Primary tests:** `npm test --silent` from `project/` runs Node-based unit
  coverage first and hands off to Playwright. Use `npm run test:smoke` for the
  single-page Playwright load check while iterating.
- **Terminal output:** Avoid dumping huge single-line outputs; remote shells
  kill the session once any line exceeds ~4 KB. Prefer `rg`, `sed`, or
  `cut -c1-200` to trim results before printing.
- **Manual smoke:** Before shipping changes, exercise puzzle load, palette
  selection, painting, and save/load flows in both a desktop and mobile browser
  (emulated is fine) to mirror the release checklist.
- **Branch hygiene:** work on short-lived branches named `automation/<change>`;
  keep them rebased on `origin/main` so deployment workflows and preview URLs
  stay healthy. Start each day with a `git fetch --all --prune` and rebase onto
  `origin/main` so you pick up workflow changes early and avoid conflict backlogs.

## First 60 minutes
1. Clone the repo and run through the setup checklist above.
2. Start the dev server and load http://localhost:8000. Confirm you can
   complete a few strokes on the bundled capybara puzzle.
3. Run `npm test --silent` (or at least `npm run test:smoke` if the full suite
   is offline) to verify your environment passes the default checks.
4. Open DevTools and expand `window.capy` and `window.capyGenerator` to see the
   live runtime state. Toggling `window.capyGenerator.togglePreview()` should
   match the UI preview button.
5. Skim the sections below so you know where to patch UI markup, rendering, or
   generator code before you open your first PR.

## What to read first
- [`README.md`](../README.md) – player-facing quick start and gameplay tour.
- [`TECH.md`](./TECH.md) – technical reference for deployment, testing, and the
  full runtime map.
- [`STYLEGUIDE.md`](./STYLEGUIDE.md) – CSS and layout conventions used by the
  runtime stylesheet.

## Runtime crash course
Everything ships directly from the repository root—no bundlers, transpilers, or
build steps.

- **Host & UI wiring:** `index.html` contains the page markup plus a large inline
  script that handles settings, generator controls, storage, and devtools hooks
  (`window.capy`/`window.capyGenerator`).
- **Rendering:** `render.js` owns renderer selection and the Canvas2D, WebGL, and
  SVG backends. The controller exposes fallbacks so the UI can swap pipelines on
  errors or user request.
- **Puzzle generation:** `puzzle-generation.js` runs quantization, segmentation,
  and smoothing in a worker-friendly module. Generator options are mirrored in
  the UI controls inside `index.html`.
- **Persistence:** Saves and settings live in `localStorage`; imported images are
  cached via the service worker (`service-worker.js`) to keep snapshots small.
- **Styling:** `styles.css` holds the main theme tokens and layout rules. Inline
  CSS variables inside `index.html` seed the responsive UI scale before boot.

## Daily development habits
- Keep changes minimal and readable—small, direct updates beat broad
  abstractions.
- Avoid introducing build tooling; the shipped HTML and JS must stay directly
  loadable.
- When adding UI or runtime hooks, update `TECH.md` alongside the change so the
  reference stays current.
- Capture UI review artifacts under `project/artifacts/ui-review/` when running
  Playwright locally and surface them in PRs.
- Log significant screenshots and QA notes in `project/CHANGELOG.md` so branch
  deployments have a dated reference (link the committed `project/artifacts/`
  captures alongside the notes).
- Before opening a PR, rebase on `origin/main`, run `npm test --silent`, and do
  the manual smoke flow on desktop + mobile widths. Note any skipped tests in
  the PR description and final review notes. If conflicts crop up, resolve and
  push the updated branch quickly to keep the history clean for reviewers.
- Draft PRs early so branch deployments stay available for reviewers; link the
  preview URL once the workflow finishes.

## Where to patch what
- **UI behaviour:** adjust markup, event wiring, or settings defaults inside the
  inline script in `index.html`. Developer map comments near the top call out the
  major sections to navigate quickly.
- **Rendering bugs or features:** use `render.js`; the controller sits near the
  top, Canvas2D helpers follow, WebGL sits mid-file, and the SVG overlay is at
  the end. Renderer registration happens near the bottom.
- **Generator changes:** `puzzle-generation.js` contains the worker-friendly
  generation loop. Search for `GENERATION_ALGORITHM_CATALOG` or
  `createGeneratorWorker` to plug in new algorithms or tweak lifecycle events.
- **Styling:** global tokens and layout rules live in `styles.css`, while a few
  critical CSS variables in `index.html` set the pre-boot scale and safe-area
  padding.

## Quick debugging aids
- **Runtime helpers:** The inline script exposes `window.capyGenerator` helpers
  such as `loadPuzzleFixture` and `togglePreview`, plus `window.capy` for
  renderer state—useful for smoke scripts or manual checks.
- **Logs:** The in-app **Help & logs** tab mirrors console warnings/errors and
  notes generator/resume events without opening DevTools.
- **Renderer testing:** `project/tests/render-controller.spec.js` mocks renderer
  registration to validate fallbacks and error paths without loading the full UI.
- **Generator fixtures:** `project/tests/generator.spec.js` and
  `project/tests/smoothing.spec.mjs` use typed-array fixtures under
  `project/tests/fixtures/` to exercise quantization and smoothing steps.

## Simplifying refactor ideas
These tasks can be tackled independently to shrink complexity while respecting
the zero-build runtime.

1. **Modularise UI domains:** Extract the inline script in `index.html` into
   small ES modules (e.g., settings persistence, generator control wiring,
   palette interactions) loaded via `<script type="module">` tags so domains are
   easier to navigate and test without introducing bundling. Start with the
   `storage` and `uiState` helpers so saves/settings logic leaves the DOM event
   section untouched.
2. **Renderer boundary cleanup:** Split `render.js` into per-backend modules
   (controller, Canvas2D, WebGL, SVG) and keep a thin index to wire them
   together. This reduces scroll fatigue and makes backend swaps safer. The
   `registerRenderer` exports near the bottom provide the seam to peel out.
3. **Generator lifecycle wrapper:** Create a dedicated host-side module for
   launching and recycling generator workers so UI code can depend on a small
   API surface instead of manipulating worker messages directly. The calls to
   `createGeneratorWorker` in `index.html` are the first usage sites to wrap.
4. **Settings/state adapters:** Centralise `localStorage` and Cache Storage
   accessors behind well-named helpers to clarify data formats, migration steps,
   and error handling paths. Give the adapters a tiny schema table so future
   migrations document themselves.
5. **Targeted Playwright fixtures:** Grow the smoke suite with focused steps for
   palette sort modes, renderer switching, and save-slot migrations to catch UI
   regressions before manual QA. `project/tests/ui-review.spec.js` already loads
   the app and paints a region—extend that flow instead of creating a new file.
