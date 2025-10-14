# Branch Deployments to GitHub Pages

## Overview

The `main` branch is always deployed to the root of GitHub Pages. Every push to other branches with an open pull request automatically deploys to GitHub Pages under a subfolder named after the branch. This allows reviewers and collaborators to preview changes in a live environment without needing to clone and run the project locally.

**Note:** The `main` branch always deploys to the root. Other branches are only deployed if they have open PRs. Once a PR is closed or merged, the branch deployment will be automatically cleaned up on the next workflow run.

## How It Works

### Workflow Trigger

The `.github/workflows/deploy-branch.yml` workflow triggers on:
- Every push to any branch (`branches: ['**']`)
- Manual workflow dispatch

**Performance optimization:** The workflow checks if the branch has an open PR before proceeding. If no PR exists, it exits early without deploying, saving CI/CD resources. The `main` branch is an exception - it always deploys to the root regardless of PR status.

### Deployment Process

1. **PR Check**: The workflow verifies that the branch has an open pull request. If not, deployment is skipped entirely. **Exception:** The `main` branch always deploys regardless of PR status.

2. **Checkout**: The workflow checks out both the current branch (source code) and the `gh-pages` branch (deployment target)

3. **Branch Name Sanitization**: The branch name is converted to a safe folder name by replacing special characters with hyphens
   - Example: `automation/feature` → `automation-feature`
   - **Exception:** The `main` branch deploys to the root (no subfolder)

4. **Content Deployment**: The workflow:
   - For `main` branch: Copies content directly to the root of `gh-pages` (including the application's main index.html file)
   - For other branches: Creates a folder in `gh-pages` matching the sanitized branch name and copies content there
   - Copies all content except `.git`, `node_modules`, test results, and artifacts
   - Updates the deployment with the latest content from the branch

5. **Cleanup**: The workflow removes deployments for branches that no longer have open PRs

6. **Index Generation**: A sorted branch index page (`branch.html`) is generated showing:
   - The `main` branch first (always at root) with a production badge
   - For the main branch: last commit date, last deployment date, and the 3 most recent commits with:
     - First line of commit message
     - Author name and commit timestamp
     - Clickable short SHA linking to the full commit on GitHub
     - Links to any associated pull requests that include the commit
   - All branches with open PRs, sorted by most recently updated PR first
   - Each branch listing includes: branch name, PR number, title, link, and last update date
   - All dates and times are automatically converted to the viewer's local timezone using JavaScript

7. **GitHub Pages Publish**: The updated `gh-pages` branch is deployed to GitHub Pages

### Accessing Deployments

- **Main branch**: Accessible at the root URL
  - `https://<owner>.github.io/<repo>/`

- **Other branches**: Accessible under their sanitized branch name
  - `https://<owner>.github.io/<repo>/<branch-name>/`
  - Example: `automation/feature` → `https://<owner>.github.io/<repo>/automation-feature/`

- **Branch index**: Accessible at
  - `https://<owner>.github.io/<repo>/branch.html`

## Benefits

1. **Live Previews**: Reviewers can test the actual application without local setup
2. **Production Always Available**: The main branch is always deployed to the root, ensuring the production site is accessible
3. **Parallel Testing**: Multiple branches can be previewed simultaneously
4. **Automatic Cleanup**: Old branches are automatically removed when PRs are closed
5. **CI/CD Integration**: Deployment happens automatically on every push to main or branches with open PRs
6. **Resource Efficiency**: Branches without PRs are not deployed, saving CI/CD minutes
7. **Sorted Navigation**: The branch index page (`branch.html`) shows main first, then the most recently updated PRs for easy access
8. **Commit History**: The branch index shows the last 3 commits on main with author, timestamp, commit SHA links, and associated PR links
9. **Local Timezone Display**: All dates and times are automatically converted to the viewer's local timezone for easier comprehension
10. **GitHub Integration**: Direct links to commits and associated pull requests make it easy to trace changes from the deployment back to their source

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
- **Commit history depth**: Modify the `per_page: 3` parameter in the "Fetch main branch commits" step to show more or fewer commits (note: the HTML layout is optimized for displaying 3-5 commits)
