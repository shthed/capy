# Fix for PR #181 Deployment Issue

## Quick Start (Automated)
Run this script to automatically fix and deploy PR #181:
```bash
chmod +x apply-pr-181-fix.sh
./apply-pr-181-fix.sh
```

## Problem
PR #181 (branch: `codex/refactor-canvas-rendering-to-use-controller`) has not been deployed because it contains an **outdated version** of the `.github/workflows/deploy-branch.yml` workflow file and is missing required deployment scripts.

## Root Cause
The PR branch was created before the deployment workflow was updated to use Node.js scripts. The branch has:
- Old inline deployment script in `deploy-branch.yml`
- Missing scripts: `update-deployments.mjs`, `render-branch-page.mjs`, `build-pages-site.mjs`, `generate_readme_html.py`
- Only has `run-tests.js` in the scripts directory

## Workflow Run Details
- Last failed workflow run: #586 (run ID: 18628042630)
- Run URL: https://github.com/shthed/capy/actions/runs/18628042630
- Status: failure (workflow couldn't even start jobs due to invalid script references)

## Solution

### Option 1: Update PR #181 Branch (Recommended)
Merge or rebase the PR #181 branch with main to get the latest workflow and scripts:

```bash
# Checkout the PR branch
git fetch origin codex/refactor-canvas-rendering-to-use-controller
git checkout codex/refactor-canvas-rendering-to-use-controller

# Option A: Merge main into the branch
git fetch origin main
git merge origin/main

# Option B: Rebase onto main (cleaner history)
git fetch origin main
git rebase origin/main

# Resolve any conflicts if they occur, then push
git push origin codex/refactor-canvas-rendering-to-use-controller
```

### Option 2: Cherry-pick Workflow Updates
If you want to avoid a full merge/rebase, just update the workflow and scripts:

```bash
# Checkout the PR branch
git fetch origin codex/refactor-canvas-rendering-to-use-controller
git checkout codex/refactor-canvas-rendering-to-use-controller

# Copy the latest workflow and scripts from main
git checkout origin/main -- .github/workflows/deploy-branch.yml scripts/

# Commit and push
git commit -m "Update workflow and scripts from main for deployment"
git push origin codex/refactor-canvas-rendering-to-use-controller
```

### Option 3: Manual File Updates
If git operations fail, manually update these files in the PR branch:
1. Replace `.github/workflows/deploy-branch.yml` with the version from main
2. Copy these missing scripts from main to the PR branch:
   - `scripts/build-pages-site.mjs`
   - `scripts/generate_readme_html.py`
   - `scripts/render-branch-page.mjs`
   - `scripts/update-deployments.mjs`

## After Fix
Once the PR branch is updated:
1. The workflow will automatically trigger on push
2. OR manually trigger it via GitHub Actions UI using "Run workflow" button
3. The branch will be deployed to: https://shthed.github.io/capy/codex-refactor-canvas-rendering-to-use-controller/

## Files That Need Updating
- `.github/workflows/deploy-branch.yml` (outdated)
- `scripts/build-pages-site.mjs` (missing)
- `scripts/generate_readme_html.py` (missing)
- `scripts/render-branch-page.mjs` (missing)
- `scripts/update-deployments.mjs` (missing)

## Preview
The expected deployment URL after fix:
https://shthed.github.io/capy/codex-refactor-canvas-rendering-to-use-controller/
