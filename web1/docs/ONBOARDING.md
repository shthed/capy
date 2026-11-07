# Developer Onboarding Guide

Welcome to Capy! This guide gets new contributors productive quickly by surfacing
what matters most for local setup, the runtime architecture, and day-one
expectations.

## Setup checklist
- **Prerequisites:** Node.js 20+.
- **Install dependencies:** from `web1/`, run `npm install` (pulls Playwright
  and the lightweight dev server). If you plan to run UI tests locally, follow
  with `npm run setup:playwright` to provision the Chromium bundle.
- **Serve the app:** `npm run dev` from `web1/` hosts `web1/` at
  http://localhost:8000. The runtime is build-free, so the HTML and JS in
  `web1/` load as-is.
- **Primary tests:** `npm test --silent` from `web1/` runs the Playwright smoke
  suite (`web1/tests/ui-load-page.spec.js`).
- **Terminal output:** Avoid dumping huge single-line outputs; remote shells
  kill the session once any line exceeds ~4 KB. Prefer `rg`, `sed`, or
  `cut -c1-200` to trim results before printing.
- **Manual smoke:** Before shipping changes, exercise puzzle load, palette
  selection, painting, and save/load flows in both a desktop and mobile browser
  (emulated is fine) to mirror the release checklist.
- **Branch hygiene:** work on short-lived branches named `automation/<change>`;
  keep them rebased on `origin/main` so deployment workflows and preview URLs
  stay healthy.

## First 60 minutes
1. Clone the repo and run through the setup checklist above.
2. Start the dev server (`cd web1 && npm run dev`) and load http://localhost:8000. Confirm you can
   complete a few strokes on the bundled capybara puzzle.
3. Run `npm test --silent` to verify your environment passes the default checks.
4. Open DevTools and expand `window.capy` and `window.capyGenerator` to see the
   live runtime state. Toggling `window.capyGenerator.togglePreview()` should
   match the UI preview button.
5. Skim the sections below so you know where to patch UI markup, rendering, or
   generator code before you open your first PR.

## What to read first
- [`README.md`](../../README.md) – Monorepo overview for `web/`, `web1/`, and `app/`.
- [`TODO.md`](../../TODO.md) – Master monorepo roadmap and future work.
- [`TECH.md`](./TECH.md) – Technical reference for `web1/` deployment, testing, and runtime map.
- [`STYLEGUIDE.md`](./STYLEGUIDE.md) – CSS and layout conventions used by `web1/styles.css`.

## Runtime crash course
Everything ships directly from the repository root—no bundlers, transpilers, or
build steps.

- **Host & UI wiring:** `index.html` contains the page markup plus a large inline
  script that handles settings, generator controls, storage, and devtools hooks
  (`window.capy`/`window.capyGenerator`).
- **Runtime, rendering, and generation:** `capy.js` packages renderer selection,
  preboot sizing, and the worker-friendly generation module (quantization,
  segmentation, smoothing). Generator options are mirrored in the UI controls
  inside `index.html`.
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
- Capture UI review artifacts under `web1/artifacts/ui-review/` when running
  Playwright locally and surface them in PRs.
- Log significant screenshots and QA notes in `web1/docs/CHANGELOG.md` so branch
  deployments have a dated reference.
- Before opening a PR, rebase on `origin/main`, run `npm test --silent`, and do
  the manual smoke flow on desktop + mobile widths.
- Draft PRs early so branch deployments stay available for reviewers; link the
  preview URL once the workflow finishes.

## Iterative development feedback loop
Use this loop to ship fixes quickly while improving the gameplay experience each
cycle.

1. **Start with context.** Read [`TODO.md`](../../TODO.md) and [`web1/docs/TODO.md`](./TODO.md) to pick a concrete issue, skim
   recent `web1/docs/CHANGELOG.md` entries for open questions, and scan
   `TECH.md`/`README.md` if the task touches rendering or controls.
2. **Baseline the experience.** Launch the app (`npm run dev` in `web1/`),
   open http://localhost:8000, and complete the "How to Play" tour:
   - Pick a palette colour, fill a few regions, and try hints/preview toggles.
   - Exercise mouse, touch, and keyboard shortcuts plus command-rail actions
     (preview, generator tuning, import, saves, settings) to spot regressions.
3. **Automate repetitive checks.** In DevTools, use `window.capyGenerator`
   helpers to speed up the loop: set the renderer, switch colours, fill regions,
   and toggle preview without manual clicks.
4. **Capture observations.** Take screenshots of notable states (baseline,
   post-fix, import flow) and log findings with desired fixes in your notes or
   `web1/docs/CHANGELOG.md`.
5. **Implement and verify.** Apply the fix, then rerun `npm test --silent` in `web1/`
   and repeat the gameplay tour from step 2.
6. **Repeat the loop.** Continue cycling through TODO items until the experience
   feels fun, keeping docs/snapshots current.

## Where to patch what (`web1/`)
- **UI behaviour:** adjust markup, event wiring, or settings defaults inside the
  inline script in `web1/index.html`. Developer map comments near the top call out the
  major sections to navigate quickly.
- **Rendering bugs or features:** use `web1/capy.js` and `web1/render.js`.
- **Generator changes:** `web1/puzzle-generation.js` and `web1/capy.js` contain the worker-friendly generation loop.
- **Styling:** global tokens and layout rules live in `web1/styles.css`, while a few
  critical CSS variables in `web1/index.html` set the pre-boot scale and safe-area
  padding.

## Quick debugging aids
- **Runtime helpers:** The inline script exposes `window.capyGenerator` helpers
  such as `loadPuzzleFixture` and `togglePreview`, plus `window.capy` for
  renderer state—useful for smoke scripts or manual checks.
- **Logs:** The in-app **Help & logs** tab mirrors console warnings/errors and
  notes generator/resume events without opening DevTools.
- **Smoke tests:** `web1/tests/ui-load-page.spec.js` loads both `web1/index.html` and the built `web/dist/` bundle in headless Chromium via Playwright.
