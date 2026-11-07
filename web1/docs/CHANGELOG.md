# Change Log

## 2025-12-07
- Added an SVG export option that downloads a palette-aware progress snapshot with region paths and centres from the Saves tab.

## 2025-12-06
- Moved hint intensity into the main settings tab and grouped hint toggles together for quicker tuning.
- Added a devtools helper to clear all site data (cookies, caches, IndexedDB, storage, and workers) from `window.capyGenerator`.

## 2025-12-05
- Added a vector-scene-aware preview fallback so samples without embedded pixel lists still render previews from the region map.
- Rebuilt the bundled Three Bands fixture with per-region pixel lists and vector scene metadata for SVG smoke checks.
- Updated docs to describe the new sample puzzle and vector scene support.

## 2025-11-28
- Paused offline support by disabling service worker registration, unregistering any existing workers, and clearing the runtime cache on load.

## 2025-11-27
- Made the settings sheet responsive by stacking the tab list above the content on smaller screens.
- Themed settings text inputs and textareas so they match other controls.
- Refined the settings layout with responsive tabs so the sheet stays organized on smaller screens.
- Styled text inputs and textareas across the settings UI to match the themed controls and improve readability.
- Tightened the in-game menu spacing, added a compact drag grip, and introduced contextual help tooltips for every section.
- Compacted the menu sheet padding and pushed the controls into an earlier two-column flow for wide viewports.

## 2025-11-26
- Switched the service worker and cache helper to ES modules so GitHub Pages serves them with a supported MIME type.
- Added a lightweight README mirror at `/README/` to keep the in-app Help panel from hitting 404s.

## 2025-11-23
- Clarified Playwright setup/retry expectations in `AGENTS.md` so UI smoke tests run cleanly after browser installs.
- Recorded the latest automated coverage (`npm test --silent`) and artifact expectations for this update.
