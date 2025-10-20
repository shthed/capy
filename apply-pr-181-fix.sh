#!/bin/bash
# Script to apply the PR #181 deployment fix
#
# This script will:
# 1. Checkout the PR #181 branch
# 2. Apply the patch that updates workflow and scripts
# 3. Push the changes to trigger deployment
#
# Usage: ./apply-pr-181-fix.sh

set -euo pipefail

echo "=== Fixing PR #181 Deployment Issue ==="
echo ""

# Check if we're in the right directory
if [ ! -f "index.html" ] || [ ! -d ".github/workflows" ]; then
    echo "Error: Must run this script from the capy repository root directory"
    exit 1
fi

# Check if patch file exists
if [ ! -f "pr-181-fix.patch" ]; then
    echo "Error: pr-181-fix.patch not found in current directory"
    exit 1
fi

echo "1. Fetching latest changes..."
git fetch origin

echo ""
echo "2. Checking out PR #181 branch..."
git checkout codex/refactor-canvas-rendering-to-use-controller || {
    echo "Creating local branch from remote..."
    git checkout -b codex/refactor-canvas-rendering-to-use-controller origin/codex/refactor-canvas-rendering-to-use-controller
}

echo ""
echo "3. Applying deployment fix patch..."
if git apply --check pr-181-fix.patch 2>/dev/null; then
    git apply pr-181-fix.patch
    echo "Patch applied successfully"
else
    echo "Patch doesn't apply cleanly. Trying alternative method..."
    # Alternative: checkout files directly from main
    git fetch origin main
    git checkout origin/main -- .github/workflows/deploy-branch.yml scripts/
    echo "Files copied from main branch"
fi

echo ""
echo "4. Staging changes..."
git add .github/workflows/deploy-branch.yml scripts/

echo ""
echo "5. Committing changes..."
git commit -m "Update workflow and scripts from main for deployment

- Update deploy-branch.yml to latest version with Node.js scripts  
- Add missing deployment scripts (update-deployments.mjs, render-branch-page.mjs, build-pages-site.mjs, generate_readme_html.py)
- Fixes deployment failure for PR #181
"

echo ""
echo "6. Pushing to remote..."
echo "   This will trigger the deployment workflow automatically"
git push origin codex/refactor-canvas-rendering-to-use-controller

echo ""
echo "=== Fix Applied Successfully! ==="
echo ""
echo "The workflow should now run automatically."
echo "You can monitor it at: https://github.com/shthed/capy/actions"
echo ""
echo "Once deployed, the PR will be available at:"
echo "https://shthed.github.io/capy/codex-refactor-canvas-rendering-to-use-controller/"
