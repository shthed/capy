# Branch Deployments to GitHub Pages

## Overview

Every push to any branch in this repository automatically deploys to GitHub Pages under a subfolder named after the branch. This allows reviewers and collaborators to preview changes in a live environment without needing to clone and run the project locally.

## How It Works

### Workflow Trigger

The `.github/workflows/deploy-branch.yml` workflow triggers on:
- Every push to any branch (`branches: ['**']`)
- Manual workflow dispatch

### Deployment Process

1. **Checkout**: The workflow checks out both the current branch (source code) and the `gh-pages` branch (deployment target)

2. **Branch Name Sanitization**: The branch name is converted to a safe folder name by replacing special characters with hyphens
   - Example: `automation/feature` → `automation-feature`

3. **Content Deployment**: The workflow:
   - Creates a folder in `gh-pages` branch matching the sanitized branch name
   - Copies all content except `.git`, `node_modules`, test results, and artifacts
   - Updates the deployment with the latest content from the branch

4. **GitHub Pages Publish**: The updated `gh-pages` branch is deployed to GitHub Pages

### Accessing Deployments

- **Main branch**: Accessible at the root URL
  - `https://<owner>.github.io/<repo>/`

- **Other branches**: Accessible under their sanitized branch name
  - `https://<owner>.github.io/<repo>/<branch-name>/`
  - Example: `automation/feature` → `https://<owner>.github.io/<repo>/automation-feature/`

## Benefits

1. **Live Previews**: Reviewers can test the actual application without local setup
2. **Parallel Testing**: Multiple branches can be previewed simultaneously
3. **Historical Reference**: Old branches remain accessible until explicitly removed
4. **CI/CD Integration**: Deployment happens automatically on every push

## Cleanup

Branch folders in `gh-pages` persist after branches are deleted. To clean up old deployments:

1. Checkout the `gh-pages` branch locally
2. Remove unwanted branch folders
3. Commit and push the changes

## Maintenance Notes

- The `gh-pages` branch is automatically created on first deployment if it doesn't exist
- Each deployment creates a single commit in the `gh-pages` branch
- The workflow uses `--force` push to ensure the latest content is always deployed
- Deployments are protected by GitHub Actions permissions and only run from the repository

## Configuration

To modify the deployment behavior, edit `.github/workflows/deploy-branch.yml`:

- **Excluded content**: Modify the `rsync --exclude` patterns
- **Branch filtering**: Adjust the `on.push.branches` pattern
- **Deployment target**: Change the target branch from `gh-pages` if needed
