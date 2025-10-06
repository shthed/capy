# PR #31 Conflict Resolution Example

This document provides concrete before/after examples for resolving conflicts in PR #31.

## Overview

**PR #31:** Add in-app ChatGPT key manager and extend tests  
**Branch:** `codex/implement-image-generation-on-game-load`  
**Conflicting Files:** 3 (README.md, docs/gameplay-session.md, index.html)

## File 1: docs/gameplay-session.md

### Conflict Location: Line 11-24 (Actions Performed)

**HEAD (PR #31):**
```markdown
1. Launched the app with no OpenAI key configured and watched the runtime log a
   skipped ChatGPT request before loading the "Capycolour Springs" fallback
   puzzle, then pressed the 🐹 command button to reload it without reopening the
   hint overlay.
```

**origin/main:**
```markdown
1. Reloaded the page to confirm the new autosave pipeline restored the last
   in-progress puzzle; with no prior data the "Capybara Springs" scene still
   loads automatically, showcasing the orange-crowned capybara, loyal
   dachshund, waterfall, and mushroom-ring lagoon. Pressed the 🐹 command button
   afterwards to force a fresh board and confirm the shortcut still works
   without reopening the hint overlay.
```

**RESOLUTION (merge both features):**
```markdown
1. Reloaded the page to confirm the new autosave pipeline restored the last
   in-progress puzzle; with no prior data and no OpenAI key configured, the
   runtime logged a skipped ChatGPT request before loading the "Capybara
   Springs" fallback scene, showcasing the orange-crowned capybara, loyal
   dachshund, waterfall, and mushroom-ring lagoon. Pressed the 🐹 command button
   afterwards to force a fresh board and confirm the shortcut still works
   without reopening the hint overlay.
```

### Conflict Location: Line 37-46 (Observations)

**HEAD (PR #31):**
```markdown
- The refreshed Help sheet documents every icon command (including the prompt bar and fullscreen), reiterates the gesture controls, and streams a live debug log so it was easy to verify hints, fills, zooms, sample fallbacks, and orientation changes during the session.
- The new footer status tray surfaced each import step—file read, image decode, k-means clustering, segmentation counts, and palette prep—on a live progress bar, populated a telemetry grid with the active mode/prompt plus source/target sizes and palette/region totals, and emitted fading notifications so it was obvious where the generator was spending time.
- The refreshed Help sheet now includes a ChatGPT access section, making it trivial to paste or clear the OpenAI key without touching DevTools while the debug log confirms every save/clear action and outlines what each severity badge means.
- Debug logging now captures ignored clicks (no puzzle, wrong colour, filled regions), viewport orientation changes, fullscreen transitions, background updates, and both the start and completion of sample reloads with severity badges that mirror the status tray—making it easier to spot warnings versus success events at a glance.
```

**origin/main:**
```markdown
- The refreshed Help sheet documents every icon command (including fullscreen), reiterates the gesture controls, and streams a live debug log so it was easy to verify hints, fills, zooms, and orientation changes during the session.
- Debug logging now captures ignored clicks (no puzzle, wrong colour, filled regions), viewport orientation changes, fullscreen transitions, background updates, autosave restore messages, and both the start and completion of sample reloads which helped confirm why certain taps were rejected while exercising the canvas.
- Rolling autosaves hit local storage on each stroke and immediately mirror to any open tabs via the new cloud sync channel, so the session resumed intact after hard refreshes.
```

**RESOLUTION (merge all observations):**
```markdown
- The refreshed Help sheet documents every icon command (including the prompt bar and fullscreen), reiterates the gesture controls, and streams a live debug log so it was easy to verify hints, fills, zooms, sample fallbacks, and orientation changes during the session.
- The new footer status tray surfaced each import step—file read, image decode, k-means clustering, segmentation counts, and palette prep—on a live progress bar, populated a telemetry grid with the active mode/prompt plus source/target sizes and palette/region totals, and emitted fading notifications so it was obvious where the generator was spending time.
- The refreshed Help sheet now includes a ChatGPT access section, making it trivial to paste or clear the OpenAI key without touching DevTools while the debug log confirms every save/clear action and outlines what each severity badge means.
- Debug logging now captures ignored clicks (no puzzle, wrong colour, filled regions), viewport orientation changes, fullscreen transitions, background updates, autosave restore messages, and both the start and completion of sample reloads with severity badges that mirror the status tray—making it easier to spot warnings versus success events at a glance.
- Rolling autosaves hit local storage on each stroke and immediately mirror to any open tabs via the new cloud sync channel, so the session resumed intact after hard refreshes.
```

## File 2: README.md

### Conflict Location: Line 62-77 (Features section)

**HEAD (PR #31):**
```markdown
- **Palette manager.** Swipe through compact, tinted swatches that promote the
colour number while tooltips, titles, and ARIA copy preserve human-readable
names and remaining region counts.
- **Progress persistence.** Snapshot runs into localStorage, reopen saves,
rename them, or export/import the underlying puzzle data as JSON.
```

**origin/main:**
```markdown
- **Palette manager.** Swipe through compact, tinted swatches that promote the
  colour number while tooltips, titles, and ARIA copy preserve human-readable
  names and remaining region counts.
- **Progress persistence & recovery.** Every stroke updates a rolling
  autosave so the latest session is restored automatically on launch. Manual
  snapshots still land in the save manager where you can rename, export, or
  delete entries at will.
- **Cloud-ready sync.** A lightweight broadcast channel mirrors autosaves
  across browser tabs and exposes a `window.capyCloudSync` adapter hook so
  teams can plug in remote storage when available.
```

**RESOLUTION (use enhanced version with all features):**
```markdown
- **Palette manager.** Swipe through compact, tinted swatches that promote the
  colour number while tooltips, titles, and ARIA copy preserve human-readable
  names and remaining region counts.
- **Progress persistence & recovery.** Every stroke updates a rolling
  autosave so the latest session is restored automatically on launch. Manual
  snapshots still land in the save manager where you can rename, export, or
  delete entries at will.
- **Cloud-ready sync.** A lightweight broadcast channel mirrors autosaves
  across browser tabs and exposes a `window.capyCloudSync` adapter hook so
  teams can plug in remote storage when available.
```

### Conflict Location: Line 136-148 (How it works)

**HEAD (PR #31):**
```markdown
1. **Generate or load art.** On boot Capycolour sends the stored prompt (or a
   built-in default) to ChatGPT and, if successful, imports the returned PNG. If
the request is skipped or fails, the bundled "Capycolour Springs" puzzle loads
instead. You can edit the prompt at any time or import your own image/JSON file.
```

**origin/main:**
```markdown
1. **Resume or load an image.** The app restores your most recent autosave on
   boot; if nothing is stored yet the bundled "Capybara Springs" puzzle loads
   automatically so you can start painting immediately. Drag a bitmap into the
   viewport, activate the "Choose an image" button, or press the 🐹 command
   button to reload the bundled scene. The hint overlay disappears once a new
   source is selected.
```

**RESOLUTION (merge both workflows):**
```markdown
1. **Generate or resume art.** On boot the app restores your most recent
   autosave; if nothing is stored yet, Capycolour sends the stored prompt (or a
   built-in default) to ChatGPT and, if successful, imports the returned PNG.
   If the request is skipped or fails, the bundled "Capybara Springs" puzzle
   loads instead so you can start painting immediately. Drag a bitmap into the
   viewport, activate the "Choose an image" button, press the 🐹 command button
   to reload the bundled scene, or edit the prompt at any time. The hint overlay
   disappears once a new source is selected.
```

## File 3: index.html

### Conflict Location: Line ~1616 (Storage Constants)

**HEAD (PR #31):**
```javascript
const OPENAI_KEY_STORAGE = "capycolour.openaiKey";
const PROMPT_STORAGE_KEY = "capycolour.lastPrompt";
const DEFAULT_PROMPT =
  "A cheerful capybara painting in luminous watercolour, surrounded by vibrant jungle flowers and sparkling water";
```

**origin/main:**
```javascript
const AUTOSAVE_STORAGE_KEY = "capy.autosave.v1";
const CLOUD_STORAGE_KEY = "capy.cloud.backup.v1";
```

**RESOLUTION (keep all constants):**
```javascript
const OPENAI_KEY_STORAGE = "capycolour.openaiKey";
const PROMPT_STORAGE_KEY = "capycolour.lastPrompt";
const DEFAULT_PROMPT =
  "A cheerful capybara painting in luminous watercolour, surrounded by vibrant jungle flowers and sparkling water";
const AUTOSAVE_STORAGE_KEY = "capy.autosave.v1";
const CLOUD_STORAGE_KEY = "capy.cloud.backup.v1";
```

### Conflict Location: Line ~2150 (Initialization)

**HEAD (PR #31):**
```javascript
setGenerationIdle();
```

**origin/main:**
```javascript
applyGameplaySettings(state.settings);
```

**RESOLUTION (call both functions):**
```javascript
setGenerationIdle();
applyGameplaySettings(state.settings);
```

### Conflict Location: Line ~2172 (Boot Sequence)

**HEAD (PR #31):**
```javascript
if (promptForm) {
  promptForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = promptInput ? promptInput.value : "";
    generatePromptedPuzzle(value, {
      interactive: true,
      fallbackToSample: false,
      persistPromptValue: true,
      reason: "manual",
    });
  });
}
```

**origin/main:**
```javascript
if (!loadInitialSession() && SAMPLE_ARTWORK?.dataUrl) {
  loadSamplePuzzle();
}
```

**RESOLUTION (setup form handler, then load initial session):**
```javascript
if (promptForm) {
  promptForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = promptInput ? promptInput.value : "";
    generatePromptedPuzzle(value, {
      interactive: true,
      fallbackToSample: false,
      persistPromptValue: true,
      reason: "manual",
    });
  });
}

if (!loadInitialSession() && SAMPLE_ARTWORK?.dataUrl) {
  loadSamplePuzzle();
}
```

## Applying the Resolution

### Command Sequence

```bash
# 1. Checkout the PR branch
git checkout codex/implement-image-generation-on-game-load

# 2. Merge main (will trigger conflicts)
git merge origin/main

# 3. Apply the resolutions shown above to each file
#    - docs/gameplay-session.md
#    - README.md
#    - index.html

# 4. Stage the resolved files
git add docs/gameplay-session.md README.md index.html

# 5. Complete the merge
git commit -m "Merge main into codex/implement-image-generation-on-game-load

Resolved conflicts by merging both feature sets:
- Combined ChatGPT key manager with autosave/cloud sync
- Merged generator telemetry with autosave restoration
- Kept both initialization sequences and boot logic"

# 6. Push the resolved branch
git push origin codex/implement-image-generation-on-game-load
```

### Verification

After pushing, verify on GitHub:
- PR #31 should show "mergeable" (green checkmark)
- The PR description should update to reflect the resolution
- CI should pass (if configured)

## Testing

Run the full test suite to ensure merged features work together:

```bash
npm test --silent
```

Expected: All tests pass, confirming ChatGPT + autosave features coexist properly.

## Notes

- All conflicts are **additive** - we're combining features, not choosing one over the other
- No existing functionality is removed
- Both ChatGPT workflow and autosave workflow are preserved
- The resolved code supports both use cases seamlessly

---

**This example can be used as a template for resolving PR #30 and #25, which have similar conflict patterns.**
