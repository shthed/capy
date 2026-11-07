# Roadmap (`web1/`)

Direction for Legacy Web v1 (`web1/`, deployed at `/web1/`). For the overall Capy monorepo roadmap across `web/`, `web1/`, and `app/`, see the root [`TODO.md`](../../TODO.md).

## Completed
- Restored full Playwright CI smoke coverage in [`.github/workflows/deploy-branch.yml`](../../.github/workflows/deploy-branch.yml) verifying both `web1/` and `web/dist/` on every push.
- Relocated Legacy Web v1 into `web1/` and published at `/web1/` alongside the Updated Web App (`web/` at `/`) and Android APK (`/capy.apk`).
- Updated handbook docs (`TECH.md`, `AGENTS.md`, `STYLEGUIDE.md`, `ONBOARDING.md`) to reflect the unified monorepo structure.

## Next (maintainability)
- Decompose the renderer section of `web1/capy.js` into renderer-specific modules and shared helpers to cut line count and simplify backend swaps.
- Expand test coverage for settings/bootstrap paths (UI scale, renderer selection, persistence fallbacks) to catch regressions outside Playwright flows.
- Deduplicate/compress sample artwork (`web1/capy.png` vs `web/public/assets/capybara.webp`).
