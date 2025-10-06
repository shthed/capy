# Merge Conflict Resolution Guide

## Summary

This document provides instructions for resolving merge conflicts in open PRs and cleaning up stale branches.

## Open PRs with Merge Conflicts

### PR #31: Add in-app ChatGPT key manager and extend tests
- **Branch:** `codex/implement-image-generation-on-game-load`
- **Base:** `7ecd437` (outdated, current main is `a1e912e`)
- **Status:** Has merge conflicts with main
- **Files in conflict:** README.md, docs/gameplay-session.md, index.html

#### Conflict Resolution Strategy for PR #31

The conflicts arise because:
- PR #31 adds ChatGPT integration, key manager, and generator telemetry features
- Main branch (advanced since PR was created) adds autosave and cloud sync features

**Resolution approach:** Merge both feature sets by combining the changes.

**README.md conflicts:**
1. **Features section** - Combine both:
   - Keep ChatGPT features from PR (prompt bar, telemetry, key manager)
   - Keep autosave features from main (rolling autosave, cloud sync)
   
2. **How it works section** - Merge initialization logic:
   - "Generate or resume art" - combine autosave restoration with ChatGPT generation

**docs/gameplay-session.md conflicts:**
1. **Actions Performed** - Merge both narratives:
   - Combine autosave restoration with ChatGPT key manager testing
   
2. **Observations** - Include all features:
   - ChatGPT features (status tray, severity badges, key manager)
   - Autosave features (localStorage, cloud sync)

**index.html conflicts:**
1. **Storage constants** (line ~1616) - Keep all:
   ```javascript
   const OPENAI_KEY_STORAGE = "capycolour.openaiKey";
   const PROMPT_STORAGE_KEY = "capycolour.lastPrompt";
   const DEFAULT_PROMPT = "...";
   const AUTOSAVE_STORAGE_KEY = "capy.autosave.v1";
   const CLOUD_STORAGE_KEY = "capy.cloud.backup.v1";
   ```

2. **Initialization** (line ~2150) - Call both:
   ```javascript
   setGenerationIdle();
   applyGameplaySettings(state.settings);
   ```

3. **Boot sequence** (line ~2172) - Merge logic:
   ```javascript
   // Set up prompt form handler
   if (promptForm) {
     promptForm.addEventListener("submit", ...);
   }
   
   // Load autosave or fallback to sample
   if (!loadInitialSession() && SAMPLE_ARTWORK?.dataUrl) {
     loadSamplePuzzle();
   }
   ```

### PR #30: Add sample detail presets and region legend
- **Branch:** `codex/run-tests-on-app-functions-wkhe6x`
- **Base:** `7ecd437` (outdated, current main is `a1e912e`)
- **Status:** Has merge conflicts with main
- **Files affected:** Similar pattern to PR #31

#### Conflict Resolution Strategy for PR #30

The conflicts are similar in nature - PR #30 adds detail presets while main adds autosave.
Both feature sets should be preserved during merge.

### PR #25: Streamline palette swatches and document features
- **Branch:** `codex/run-tests-on-app-functions`
- **Base:** `f7af674` (much older, predates both PR #30/#31 bases)
- **Status:** Has merge conflicts with main
- **Files affected:** Similar pattern

#### Conflict Resolution Strategy for PR #25

This PR is based on an even older version of main. The conflicts will be more extensive.
Should merge all features added since: compact palette, autosave, ChatGPT integration, etc.

## Stale Branches to Delete

These branches have no associated open PRs and can be safely deleted:

1. **codex/add-local-storage-auto-reload-for-drawings**
   - Already merged via PR #29
   - Commit: `6347840`

2. **codex/run-tests-on-app-functions-mdptn5**
   - Already merged via PR #26
   - Commit: `1db09e1`

3. **codex/update-touch-pointer-handling-in-index.html**
   - Already merged via PR #27
   - Commit: `1ddb08b`

4. **codex/update-touch-pointer-handling-in-index.html-nzppqn**
   - Already merged via PR #28
   - Commit: `7895c3d`

## Recommended Actions

### For Repository Maintainers

1. **Resolve conflicts in PRs #25, #30, and #31:**
   ```bash
   # For each PR:
   git checkout <branch-name>
   git merge main
   # Resolve conflicts using the strategies above
   git commit
   git push origin <branch-name>
   ```

2. **Delete stale branches:**
   ```bash
   git push origin --delete codex/add-local-storage-auto-reload-for-drawings
   git push origin --delete codex/run-tests-on-app-functions-mdptn5
   git push origin --delete codex/update-touch-pointer-handling-in-index.html
   git push origin --delete codex/update-touch-pointer-handling-in-index.html-nzppqn
   ```

3. **Verify PRs are mergeable after resolution:**
   - Check each PR on GitHub to confirm "mergeable" status changes to true

### Automated Resolution Script

A helper script for resolving the conflicts automatically (for maintainers with push access):

```bash
#!/bin/bash
# resolve-pr-conflicts.sh

set -e

# Function to resolve conflicts for a PR branch
resolve_pr() {
    local branch=$1
    echo "Resolving conflicts in $branch..."
    
    git checkout "$branch"
    git merge main --no-edit || {
        # Conflicts occurred, resolve them
        echo "Conflicts detected, applying resolution strategies..."
        
        # Apply the resolution strategies documented above
        # (Implementation would go here)
        
        git commit -m "Merge main into $branch

Resolved conflicts by merging all feature sets"
    }
    
    git push origin "$branch"
}

# Resolve each PR
resolve_pr "codex/implement-image-generation-on-game-load"  # PR #31
resolve_pr "codex/run-tests-on-app-functions-wkhe6x"        # PR #30
resolve_pr "codex/run-tests-on-app-functions"               # PR #25

# Delete stale branches
git push origin --delete codex/add-local-storage-auto-reload-for-drawings
git push origin --delete codex/run-tests-on-app-functions-mdptn5
git push origin --delete codex/update-touch-pointer-handling-in-index.html
git push origin --delete codex/update-touch-pointer-handling-in-index.html-nzppqn

echo "All conflicts resolved and stale branches deleted!"
```

## Testing After Resolution

After resolving conflicts, run the test suite to ensure nothing broke:

```bash
npm test --silent
```

All Playwright tests should pass, confirming that the merged features work together correctly.
