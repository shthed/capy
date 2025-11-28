# TODO

Actionable maintenance items collected during the project review. Keep entries short, measurable, and update them as work lands so the list stays trustworthy.

## High priority
- [ ] Reinstate full CI coverage: run the Node + Playwright harness (`npm test --silent`) in `.github/workflows/ci.yml`, publish reports, and make failing tests block merges (with opt-outs only when browsers are unavailable).
- [x] Add Cache Storage limits/eviction to `service-worker.js` (or gate which requests are cached) so user sessions cannot grow the offline cache without bound.
- [ ] Add regression tests for preboot sizing/settings in `runtime.js` (malformed or missing `localStorage` data) to keep UI scale and orientation tokens stable.
- [x] Fix runtime boot errors where `handleRendererChange` is undefined (shows the error toast and blocks the settings button), ensuring renderer toggles are registered before UI events fire.
- [ ] Restore Playwright puzzle fixtures so `window.capyGenerator.loadPuzzleFixture` succeeds and the smoke suite can exercise renderer switching, palette updates, save/restore, and performance metrics.
- [ ] Restore the Capybara Springs sample bootstrap so first paint loads the bundled puzzle (with sample artwork metadata) instead of the blank white viewport shown in the latest smoke screenshot.
- [ ] Rehydrate puzzle rendering output: the stage currently shows only the white background with no outlines or numbers even though `capy.json` hydrates, and palette metadata is missing from `window.capyGenerator.getState()`.
- [ ] Re-enable the multi-renderer pipeline (Canvas2D/WebGL) so `createRendererController`, `applyRendererMode`, and `window.capyGenerator` can switch backends instead of hard-coding SVG with a disabled selector.
- [ ] Reconcile renderer documentation and coverage: `TECH.md` still promises switchable Canvas/WebGL renderers while `project/tests/render-controller.spec.js` only asserts SVG globals; update docs and tests once the controller work lands.

## Maintenance
- [ ] Split `render.js` into smaller modules (renderer implementations, controller utilities, shared helpers) to trim its ~2,300 lines and make per-renderer changes safer.
- [x] Extend service-worker coverage with tests that simulate cache growth and offline restores once eviction rules land.
- [ ] Restore and publish artwork/segmentation documentation once a refreshed pipeline is ready, replacing the placeholder note in `TECH.md`.
- [ ] Add an `actionlint` (or equivalent workflow validation) step so `.github/workflows/*.yml` files fail CI when they reference unsupported contexts, catching env-scope errors before pushes.
