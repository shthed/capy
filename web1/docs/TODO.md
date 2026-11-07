# Legacy Web v1 (`web1/`) — Maintenance TODO

Actionable maintenance items for the Legacy Vanilla JS Web v1 target (`web1/`, deployed to `/web1/`). For cross-project monorepo items (Updated Web `web/`, Android `app/`, and engine unification), see the root [`TODO.md`](../../TODO.md).

## High priority
- [x] Reinstate full CI coverage: run the Node + Playwright harness (`npm test --silent`) in [`.github/workflows/deploy-branch.yml`](../../.github/workflows/deploy-branch.yml) against both `web1/` and `web/dist/`, and make failing tests block deployments.
- [x] Add Cache Storage limits/eviction to `service-worker.js` (or gate which requests are cached) so user sessions cannot grow the offline cache without bound. (Service worker removed)
- [ ] Add regression tests for preboot sizing/settings in `web1/capy.js` (malformed or missing `localStorage` data) to keep UI scale and orientation tokens stable.
- [x] Fix runtime boot errors where `handleRendererChange` is undefined (shows the error toast and blocks the settings button), ensuring renderer toggles are registered before UI events fire.
- [ ] Restore Playwright puzzle fixtures so `window.capyGenerator.loadPuzzleFixture` succeeds and the smoke suite can exercise renderer switching, palette updates, save/restore, and performance metrics.
- [ ] Re-enable the multi-renderer pipeline (Canvas2D/WebGL) in `web1/capy.js` if desired, or finalize SVG-only mode in `web1/docs/TECH.md`.

## Maintenance
- [ ] Split the renderer section of `web1/capy.js` into smaller modules (renderer implementations, controller utilities, shared helpers) to trim its ~2,300 lines and make per-renderer changes safer.
- [x] Extend service-worker coverage with tests that simulate cache growth and offline restores once eviction rules land. (Service worker removed)
- [ ] Convert or share `web1/capy.png` (5.8 MB) with `web/public/assets/capybara.webp` (564 KB) to reduce repository and GitHub Pages size.
- [ ] Pass vector scene export options (e.g., `maxZoom`) through `createVectorScenePayload` so loaders respect authored zoom limits.

## UI polish
- [ ] Add a portrait-friendly start hint layout that centers the welcome card without overlapping the palette dock.
- [ ] Trim palette dock padding on small screens so the first/last swatches are fully visible without horizontal scrolling.
- [x] Reorganize the settings panel into grouped toggles with adjustable hint intensity controls (see `web1/notes/screenshot-review.md`).
- [ ] Add live preview + keyboard shortcuts to the interface scale dropdown (25–400%) so users can jump to a preset and recover the control after large jumps.
- [ ] Extend the scroll-into-view affordance to other settings (label scale, zoom limits, palette sort) to keep the active control visible after value changes.
