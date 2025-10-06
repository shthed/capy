# Testing Feedback Loop

This guide describes the tight iteration cycle for validating Capycolour's
ChatGPT prompt flow, colour-by-number gameplay, and regression harness.

## Quick commands

- `npm run dev` – Serves `index.html` with caching disabled so changes refresh
  immediately.
- `npm test --silent` – Runs the full Playwright suite across Chromium and
  Mobile Safari emulation.
- `npm run test:prompt` – Executes only `tests/prompt-flow.spec.js`, which mocks
  the ChatGPT image API to cover both the success path and the sample fallback.
- `npm run test:loop` – Opens Playwright's UI runner focused on Chromium for
  rapid re-runs while editing code.
- `npm run test:smoke` – Keeps the regression snapshot suite handy when checking
  layout or palette changes.

## Suggested workflow

1. Start the dev server with `npm run dev` and open the game in a browser.
2. In another terminal, run `npm run test:loop` to open the UI runner. Keep the
   `ui-review` and `prompt-flow` specs enabled so they re-run automatically on
   file save.
3. When iterating on prompt-handling code, toggle off the heavier `ui-review`
   spec and focus on `prompt-flow` until the mocked ChatGPT interactions pass.
4. Once the prompt spec is green, re-enable `ui-review` to confirm palette
   counts, command buttons, and region renders still match expectations.
5. Before pushing, run `npm test --silent` to exercise all browsers and capture
   the latest artifacts under `artifacts/ui-review/`.

## Observability checklist

- **Debug log.** The Help sheet records prompt attempts, fallbacks, zooms,
  fills, and settings adjustments with severity badges that mirror the status
  tray. Keep it open during manual tests to confirm behaviour without extra
  logging.
- **Status tray.** The footer card displays import/progress steps (file reads,
  clustering, segmentation counts, palette prep) on a live progress bar with
  fading notifications so you can confirm the generator pipeline is advancing.
- **JSON manifests.** Every `npm test` run stores palette counts, header labels,
  and prompt metadata in `artifacts/ui-review/*.json`. Compare snapshots between
  iterations to spot regressions early.
- **Harness helpers.** Use `window.capyGenerator.getState()` and associated
  helpers (`loadPuzzleFixture`, `setBackgroundColor`, etc.) in the browser
  console to reproduce what the Playwright specs assert.

Keeping this loop tight makes it easier to confirm that Capycolour always tries
ChatGPT first, gracefully falls back to the bundled sample, and keeps the
colour-by-number experience responsive across form factors.
