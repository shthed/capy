# Branch Deployments to GitHub Pages

## Overview

Every push to a branch with an open pull request automatically deploys to GitHub Pages under a subfolder named after the branch. This allows reviewers and collaborators to preview changes in a live environment without needing to clone and run the project locally.

**Note:** Only branches with open PRs are deployed. Once a PR is closed or merged, the branch deployment will be automatically cleaned up on the next workflow run.

## How It Works

### Workflow Trigger

The `.github/workflows/deploy-branch.yml` workflow triggers on:
- Every push to any branch (`branches: ['**']`)
- Manual workflow dispatch

**Performance optimization:** The workflow checks if the branch has an open PR before proceeding. If no PR exists, it exits early without deploying, saving CI/CD resources.

### Deployment Process

1. **PR Check**: The workflow verifies that the branch has an open pull request. If not, deployment is skipped entirely.

2. **Checkout**: The workflow checks out both the current branch (source code) and the `gh-pages` branch (deployment target)

3. **Branch Name Sanitization**: The branch name is converted to a safe folder name by replacing special characters with hyphens
   - Example: `automation/feature` → `automation-feature`

4. **Content Deployment**: The workflow:
   - Creates a folder in `gh-pages` branch matching the sanitized branch name
   - Copies all content except `.git`, `node_modules`, test results, and artifacts
   - Updates the deployment with the latest content from the branch

5. **Cleanup**: The workflow removes deployments for branches that no longer have open PRs

6. **Index Generation**: A sorted index page is generated showing all active deployments, sorted by most recently updated PR first

7. **GitHub Pages Publish**: The updated `gh-pages` branch is deployed to GitHub Pages

### Accessing Deployments

- **Main branch**: Accessible at the root URL
  - `https://<owner>.github.io/<repo>/`

- **Other branches**: Accessible under their sanitized branch name
  - `https://<owner>.github.io/<repo>/<branch-name>/`
  - Example: `automation/feature` → `https://<owner>.github.io/<repo>/automation-feature/`

## Benefits

1. **Live Previews**: Reviewers can test the actual application without local setup
2. **Parallel Testing**: Multiple branches can be previewed simultaneously
3. **Automatic Cleanup**: Old branches are automatically removed when PRs are closed
4. **CI/CD Integration**: Deployment happens automatically on every push to branches with open PRs
5. **Resource Efficiency**: Branches without PRs are not deployed, saving CI/CD minutes
6. **Sorted Navigation**: The index page shows the most recently updated PRs first for easy access

## Cleanup

Branch folders are automatically cleaned up when their pull requests are closed or merged. The workflow maintains a list of branches with open PRs and removes any deployments that no longer have active PRs.

**Manual cleanup** is no longer necessary but can still be performed if needed:

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
- **PR limit**: Modify the `per_page: 100` parameter to change the maximum number of PRs displayed (default supports up to 100 open PRs)
