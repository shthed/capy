# Development Guide

## Prerequisites
- Node.js 18 or newer.
- npm 9+ (ships with recent Node releases).

## Initial Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Launch a local dev server:
   ```bash
   npm run dev
   ```
   The app serves static assets from the repository root on port 8000.

## Daily Workflow
- **Start the app:** `npm run dev` (or `npm run start`).
- **Run smoke tests:** `npm test` executes the Node-based harness at `tools/run-basic-tests.js`.
- **Manual verification:** Walk through palette interactions, viewport controls, and autosave/export flows after gameplay changes.
- **Static assets:** React, ReactDOM, and Babel live under `vendor/`. Update them via direct downloads and keep versions in sync with `package.json`.
- **Editor tasks:** VS Code tasks (`.vscode/tasks.json`) expose a "Start http-server" background task that mirrors `npm run dev`.

## Project Structure
- `index.html` - single-file React application plus inline logic.
- `vendor/` - vendored runtime dependencies required for offline execution.
- `tools/run-basic-tests.js` - Node smoke harness covering core scaffolding.
- `docs/` - Project documentation (this guide, requirements, etc.).

## Importing Artwork
- Open the in-app Art Library and use the import section to paste JSON payloads or upload `.json`/`.svg` files.
- Annotated SVGs must tag each paintable region with `data-cell-id` and `data-color-id`; optional `data-color-name`, `data-color-hex`, or `data-color-rgba` metadata is used to seed palette entries (otherwise fills or defaults supply the swatch color).
- The importer merges multiple `<path>` elements within a region, generates palette entries for every referenced color ID, and slugifies the SVG title or filename when an explicit artwork ID is absent.
- Successful imports are saved to localStorage alongside autosave progress and can be removed or renamed from the library UI.

## Quality Checklist
- Keep the smoke harness green (`npm test`).
- Manually verify keyboard shortcuts (W/A/S/D panning, hints, toggles) when touching interaction code.
- Confirm bundled assets remain up to date if upgrading React/Babel.
- Review accessibility: confirm the hint icon and menu toggle announce their actions and the Options button exposes dialog affordances.

Update this guide when workflows change.

