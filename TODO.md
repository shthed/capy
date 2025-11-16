# TODO

Actionable maintenance items collected during the project review. Keep entries short, measurable, and update them as work lands so the list stays trustworthy.

## High priority
- [ ] Reinstate full CI coverage: run the Node + Playwright harness (`npm test --silent`) in `.github/workflows/ci.yml`, publish reports, and make failing tests block merges.
- [ ] Add Cache Storage limits/eviction to `service-worker.js` (or gate which requests are cached) so user sessions cannot grow the offline cache without bound.

## Maintenance
- [ ] Split `render.js` into smaller modules (renderer implementations, controller utilities, shared helpers) to trim its ~2,300 lines and make per-renderer changes safer.
- [ ] Extend tests around UI-scale and settings persistence in `runtime.js` to catch regressions when localStorage is unavailable or values are malformed.
- [ ] Restore and publish artwork/segmentation documentation once a refreshed pipeline is ready, replacing the placeholder note in `TECH.md`.
