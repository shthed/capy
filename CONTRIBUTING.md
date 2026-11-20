# Contributing to Capy

Thank you for your interest in contributing to **Capy** ([`https://github.com/shthed/capy`](https://github.com/shthed/capy), live at [`https://capypaint.com/`](https://capypaint.com/)).

**Related Guides**: [`README.md`](./README.md) | [`SUPPORT.md`](./SUPPORT.md) | [`SECURITY.md`](./SECURITY.md) | [`DEV.md`](./DEV.md) | [`TESTING.md`](./TESTING.md) | [`LICENSE.md`](./LICENSE.md)

---

## Ways to Contribute

- **Report Bugs**: Open a [Bug Report](https://github.com/capyboop/paint/issues/new/choose) with your browser/device/app version and reproduction steps.
- **Suggest Features or Puzzle Ideas**: Use the [Feature Request or Puzzle Idea forms](https://github.com/capyboop/paint/issues/new/choose).
- **Submit Pull Requests**: Fork `https://github.com/shthed/capy`, create a focused branch from `main`, and open a Pull Request using [`.github/PULL_REQUEST_TEMPLATE.md`](./.github/PULL_REQUEST_TEMPLATE.md).

---

## Local Development Setup

### Web App (`web/`) and Cloudflare Worker (`worker/`)

```bash
cd web
npm ci
npm run dev
```

Open `http://localhost:3000` in your browser.

### Android Launcher (`app/`)

Android builds require JDK 17 and the Android SDK:

```bash
./gradlew app:testDebugUnitTest app:assembleDebug
```

---

## Required Checks Before Opening a Pull Request

Run the full verification suite inside `web/`:

```bash
npm run test:sanity && npm run lint && npm run build && npm test
```

- `npm run test:sanity`: Verifies SemVer parity, `CHANGELOG.md` and `.changelog/` fragment formatting, relative links, zero emojis, zero box-drawing characters, and mobile-first Markdown formatting (no `>= 3`-column tables).
- `npm run lint`: Runs strict TypeScript typechecking for `web/` and `worker/` plus `oxlint` static checks (`web/.oxlintrc.json`).
- `npm run build`: Builds the production Vite bundle.
- `npm test`: Runs the unit and Playwright E2E test suite.

For documentation-only changes (`**.md`, `docs/**`), `npm run test:sanity` is sufficient.

---

## Pull Request Guidelines

- Keep changes focused on a single bugfix, feature, or documentation improvement.
- For feature or bugfix PRs, add a concise 1--2 sentence (`<= 320`-char) fragment under [`.changelog/`](./.changelog/README.md) instead of editing `CHANGELOG.md` or bumping `web/package.json` directly.
- Add or update tests in [`web/scripts/test.mjs`](./web/scripts/test.mjs) when changing engine, UI, storage, or worker behavior.
- Keep relevant documentation in sync (`README.md`, `WEB.md`, `PUZZLE.md`, `APP.md`, `CLOUD.md`, `TESTING.md`).
- Never commit secrets, API tokens, or personal data.

---

## License and Contributor Agreement

By submitting a contribution, you agree to the terms in [`LICENSE.md`](./LICENSE.md) (CC BY-NC-SA 4.0 and the Capybara Chill Preamble).
