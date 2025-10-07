# Repository Analysis

## Overview
This document captures a file-by-file review of the Capy image generator repo and highlights the most important assets powering the single-file application, automated tests, and delivery tooling. Use it as a quick inventory before diving into implementation changes or audits.

## File and Folder Inventory

### Root
- **`index.html`** – Primary entry point that combines markup, inline styles, and JavaScript for the drag-and-drop image-to-puzzle workflow. The inline script organises logic into caches, state containers, render helpers, generator routines, persistence, and public harness hooks so Playwright can drive end-to-end sessions.
- **`README.md`** – Contributor guide summarising core features, workflow expectations, architecture, and preset details. Keep this document in sync when the UI or automation process changes.
- **`AGENTS.md`** – Repository-wide contributor instructions covering formatting, testing, automation loop, and PR guidelines. Follow these rules for every change, especially around Playwright testing and documentation updates.
- **`package.json`** – Declares the `dev` server script (http-server), bundles the Playwright dependency stack, and wires the `test` command to the UI smoke suite. Removing unused tooling keeps installs fast and the repo lean.
- **`package-lock.json`** – Locks dependency versions so local and CI runs stay deterministic.
- **`playwright.config.js`** – Configures base URL, retries, and device emulation for the UI suite. Critical for reproducing the same viewport matrix locally and in CI.
- **`index.html` assets (embedded)** – Fonts, SVG icons, and palettes are embedded directly, eliminating external network dependencies during CI runs.

### Automation & Documentation
- **`docs/automation-loop.md`** – Defines the automation branch naming, CI triggers, merge strategy, and feedback loop cadence. Essential reference when adjusting pipelines or communicating sync expectations.
- **`docs/repository-analysis.md`** *(this file)* – Comprehensive inventory and system diagram describing how application, testing, and deployment pieces interact.

### Testing Surface
- **`tests/ui-review.spec.js`** – Playwright regression that boots the app, validates layout affordances, exercises sheet toggles, drives palette interactions, and reloads fixtures. It depends on the public `window.capyGenerator` API exposed in `index.html`.
- **`playwright-report/` (generated)** – Captures HTML and trace artifacts after Playwright runs; ignored from version control but referenced in automation instructions.

### Tooling & Environment
- **`.github/workflows/ci.yml`** – Windows-based workflow that installs dependencies, launches the static server, and runs the Playwright suite on pushes and PRs targeting `main`.
- **`.github/workflows/static.yml`** – GitHub Pages deployment pipeline shipping the repo contents as static artefacts for manual previews.
- **`.vscode/launch.json`** – Chrome launch configuration wired to the local dev server for quick manual debugging.
- **`.vscode/tasks.json`** – Defines reusable VS Code shell tasks that start the http-server in the background, mirroring the npm `dev` script.
- **`.gitignore`** – Filters node modules, Playwright outputs, and other transient files.
- **`.github/` auxiliary files** – Ensures CI/CD alignment with the documented automation loop.

### Dependency Tree
- **`node_modules/`** – Installed dependencies managed by npm; not committed but required for local runs.

## Highlights & Key Takeaways
- **Single-file runtime** – Nearly all product logic lives in `index.html`, so even minor edits can impact drag-and-drop handling, generator performance, or autosave behaviour. Review the developer map comment at the top before refactoring.
- **Harness-first API** – The Playwright spec hinges on `window.capyGenerator` helpers for deterministic testing. Breaking that API requires updating both the suite and README instructions.
- **Automation discipline** – Branch naming (`automation/<feature>`), CI execution, and fast-forward merges are codified in `AGENTS.md` and `docs/automation-loop.md`. Deviations should be documented and reviewed.
- **Cross-platform tooling** – CI currently runs on Windows while VS Code tasks reference Windows shells; ensure Linux/Mac contributors rely on npm scripts to avoid shell incompatibilities.
- **Static deployment** – GitHub Pages workflow deploys the entire repository, so keep heavy assets out of version control to maintain fast publish cycles.

## Data Flow Diagram
```mermaid
graph TD
  User[User Actions
  • Drop image / pick preset
  • Paint regions]
  Browser[Browser UI
  (`index.html` DOM & styles)]
  Script[Inline Script Modules
  • State caches
  • Event handlers
  • Generator helpers]
  Generator[Puzzle Generator
  (`createPuzzleData`, `segmentRegions`,
  `applyPuzzleResult`)]
  Renderer[Canvas Renderer
  (`renderPuzzle`, `flashColorRegions`)]
  Persistence[Persistence Layer
  (`persistSaves`, autosave, exports)]
  Harness[Testing & Automation
  (`window.capyGenerator`, Playwright suite,
  CI workflows)]

  User --> Browser --> Script --> Generator --> Renderer
  Script --> Persistence
  Persistence --> Browser
  Harness --> Script
  Harness --> Browser
  Harness -->|CI triggers| Automation[Automation Loop
  (`docs/automation-loop.md`, workflows)]
  Automation --> Harness
```

## Follow-up Ideas
- Validate that VS Code tasks work on non-Windows shells or document alternatives for macOS/Linux contributors.
- Consider extracting key generator modules from `index.html` if future maintainability becomes a concern, while balancing the zero-build constraint.

