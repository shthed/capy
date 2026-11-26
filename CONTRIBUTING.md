# Contributing to Capy

Thank you for your interest in contributing to **Capy** ([GitHub Repository](https://github.com/shthed/capy), live at [capypaint.com](https://capypaint.com/)).

**Related Guides**: [`README.md`](./README.md) | [`SUPPORT.md`](./SUPPORT.md) | [`SECURITY.md`](./SECURITY.md) | [`DEV.md`](./DEV.md) | [`TESTING.md`](./TESTING.md) | [`LICENSE.md`](./LICENSE.md)

---

## Ways to Contribute

- **Report Bugs**: Open a [Bug Report](https://github.com/capyboop/paint/issues/new/choose) with your browser/device/app version and reproduction steps, or use **About -> Send Feedback** inside the app.
- **Suggest Features or Puzzle Ideas**: Use the [Feature Request or Puzzle Idea forms](https://github.com/capyboop/paint/issues/new/choose).
- **Submit Pull Requests**: Fork the [repository](https://github.com/shthed/capy), create a focused branch (from `main` on public forks, or `beta` during active integration cycles), and open a Pull Request using [`.github/PULL_REQUEST_TEMPLATE.md`](./.github/PULL_REQUEST_TEMPLATE.md).

---

## Local Development Setup

### Web App (`web/`) and Cloudflare Worker (`worker/`)

Requires **Node.js 22+**:

```bash
cd web
npm ci
npm run dev
```

Open `http://localhost:3000` in your browser. If running Playwright E2E tests for the first time, install Chromium via `npx playwright install chromium`.

For Cloudflare Worker changes (`worker/`), `npm run lint` inside `web/` typechecks `worker/tsconfig.json`, and `npm run test:unit` runs all Worker security/protocol unit tests without needing Cloudflare credentials (or run `npx wrangler dev` from repo root for local edge emulation).

### Android Launcher (`app/`)

Android builds require JDK 17, the Android SDK, and a compiled web bundle (`web/dist/index.html`):

```bash
./gradlew app:buildWeb app:testDebugUnitTest app:assembleDebug
```

---

## Required Checks Before Opening a Pull Request

Run verification inside `web/`:

```bash
npm run test:sanity && npm run lint && npm run build && npm test
```

- `npm run test:sanity`: Verifies SemVer parity, `CHANGELOG.md` and `.changelog/` fragment formatting, relative links, zero emojis, zero box-drawing characters, and mobile-first Markdown formatting (no `>= 3`-column tables).
- `npm run lint`: Runs strict TypeScript typechecking for `web/` and `worker/` plus `oxlint` static checks (`web/.oxlintrc.json`).
- `npm run build`: Builds the production Vite 8 bundle.
- **Targeted fast test commands**:
  - `npm run test:unit`: Fast Vite SSR unit suites (zero Chromium).
  - `npm run test:e2e:smoke`: Fast (`~20s`) critical-path Playwright smoke E2E.
  - `npm run test:e2e -- --suite=<name>`: Targeted Playwright suite (`boot`, `gameplay`, `coop`, `svg-coop`, `mobile`, `resilience`, `accessibility`, `storage`, `onboarding`, `offers`).
  - `npm test`: Full unit + parallel Playwright E2E suite.

For documentation-only changes (`**.md`, `docs/**`), `npm run test:sanity` is sufficient.

---

## Pull Request Guidelines

- Keep changes focused on a single bugfix, feature, or documentation improvement.
- For feature or bugfix PRs, add a concise 1--2 sentence (`<= 320`-char) fragment under [`.changelog/`](./.changelog/README.md) instead of editing `CHANGELOG.md` or bumping `web/package.json` directly.
- Add or update tests under `web/scripts/tests/unit/*.test.mjs`, `web/scripts/tests/e2e/*.e2e.mjs`, or modular `web/scripts/*.test.mjs` runners (orchestrated by [`web/scripts/test.mjs`](./web/scripts/test.mjs)) when changing engine, UI, storage, or worker behavior.
- Keep relevant documentation in sync (`README.md`, `WEB.md`, `PUZZLE.md`, `APP.md`, `CLOUD.md`, `TESTING.md`).
- Never commit secrets, API tokens, or personal data.

---

## License and Contributor Agreement

By submitting a contribution, you agree to the terms in [`LICENSE.md`](./LICENSE.md) (CC BY-NC-SA 4.0 and the Capybara Chill Preamble).
