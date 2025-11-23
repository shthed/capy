# Roadmap

Direction for upcoming work. Use this as the planning spine; keep individual tasks in `TODO.md` and reflect major shifts here after each milestone.

## Now (stabilise)
- Bring CI back to the full Node + Playwright harness (with Playwright opt-outs only when browsers are unavailable) and restore hosted smoke checks so deployments regain automatic coverage.
- Harden offline support by adding cache caps/eviction to the service worker before introducing larger assets or remote fetches; follow with tests that simulate cache growth and offline restores.
- Keep handbook docs (`TECH.md`, `AGENTS.md`, `STYLEGUIDE.md`) aligned with runtime behaviour so contributors land on accurate guidance, especially around preboot sizing and renderer bootstraps.

## Next (maintainability)
- Decompose `render.js` into renderer-specific modules and shared helpers to cut line count and simplify backend swaps.
- Expand test coverage for settings/bootstrap paths (UI scale, renderer selection, persistence fallbacks) to catch regressions outside Playwright flows.
- Document the preferred low-abstraction DOM patterns (template cloning, delegated events, small helpers) with examples in the codebase to reduce incidental complexity.

## Later (experience)
- Publish refreshed artwork/segmentation documentation once the pipeline is ready, keeping sample assets in sync.
- Explore renderer refinements (SVG and WebGL paths) for accessibility and export fidelity while preserving the zero-build constraint.
- Revisit save/export UX after renderer refactors so compact bundles and metadata stay portable across browsers and devices.
