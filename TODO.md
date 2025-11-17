# TODO

Actionable maintenance items collected during the project review. Keep entries short, measurable, and update them as work lands so the list stays trustworthy.

## High priority
- [ ] Reinstate full CI coverage: run the Node + Playwright harness (`npm test --silent`) in `.github/workflows/ci.yml`, publish reports, and make failing tests block merges (with opt-outs only when browsers are unavailable).
- [ ] Add Cache Storage limits/eviction to `service-worker.js` (or gate which requests are cached) so user sessions cannot grow the offline cache without bound.
- [ ] Add regression tests for preboot sizing/settings in `runtime.js` (malformed or missing `localStorage` data) to keep UI scale and orientation tokens stable.

## Maintenance
- [ ] Split `render.js` into smaller modules (renderer implementations, controller utilities, shared helpers) to trim its ~2,300 lines and make per-renderer changes safer.
- [ ] Extend service-worker coverage with tests that simulate cache growth and offline restores once eviction rules land.
- [ ] Restore and publish artwork/segmentation documentation once a refreshed pipeline is ready, replacing the placeholder note in `TECH.md`.
