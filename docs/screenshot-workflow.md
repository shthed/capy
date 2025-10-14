# Screenshot Workflow Guide

## Overview

The automated screenshot workflow (`screenshot.yml`) captures UI screenshots across multiple viewports and performs basic visual regression detection. This helps catch unintended visual changes and maintains a visual history of the application.

## Triggering the Workflow

### Automatic Triggers

The workflow runs automatically on pushes to the `main` branch when any of these files change:
- `index.html`
- `puzzle-generation.js`
- `capy.json`
- `.github/workflows/screenshot.yml`

### Manual Dispatch

You can manually trigger the workflow with custom parameters via GitHub Actions:

1. Go to the **Actions** tab in the repository
2. Select **UI Screenshot Capture** from the workflows list
3. Click **Run workflow**
4. Configure the parameters:
   - **viewports**: Comma-separated list (e.g., `1366x768,1024x768,390x844`)
   - **path**: Path to capture relative to site root (default: `/`)
   - **full_page**: Whether to capture the full scrollable page (default: `false`)

## Default Viewports

The workflow captures screenshots at three standard viewports:

- **Desktop**: 1366×768 (standard laptop/desktop)
- **Tablet**: 1024×768 (tablet landscape)
- **Mobile**: 390×844 (mobile portrait, iPhone 12/13/14 size)

## Visual Regression Detection

### Baseline Screenshots

Baseline screenshots are stored in `.github/screenshots/baseline/` and are named:
- `screenshot-desktop.png`
- `screenshot-tablet.png`
- `screenshot-mobile.png`

### Comparison Process

On each push to `main`:

1. New screenshots are captured for each viewport
2. If a baseline exists, the new screenshot is compared using [pixelmatch](https://github.com/mapbox/pixelmatch)
3. A diff percentage is calculated
4. If the difference exceeds 5%, the workflow reports a warning
5. Diff images showing the differences are uploaded as artifacts

### Creating/Updating Baselines

- If no baseline exists for a viewport, the workflow automatically creates one from the current screenshot
- To update a baseline, manually replace the file in `.github/screenshots/baseline/`
- Commit and push the updated baseline to the repository

## Artifacts

The workflow uploads the following artifacts (retained for 30 days):

### Screenshot Artifacts
- **Name**: `screenshot-{viewport}-{run_number}`
- **Contains**: PNG screenshot file(s)
- **Format**: `screenshot-{viewport}-{timestamp}.png`

### Diff Artifacts (only for visual regression runs)
- **Name**: `diff-{viewport}-{run_number}`
- **Contains**: Diff images showing pixel-level differences
- **Format**: `diff-{viewport}-{timestamp}.png`

## Accessing Artifacts

1. Go to the workflow run in the **Actions** tab
2. Scroll to the **Artifacts** section at the bottom
3. Download the artifact ZIP files
4. Extract to view the screenshots or diff images

## Troubleshooting

### Workflow Fails with "Visual regression detected"

This is expected when UI changes are intentional. Review the diff artifacts to confirm:
1. Download the diff artifact from the workflow run
2. Check if the differences match your intended changes
3. If correct, update the baseline screenshot

### Server Fails to Start

The workflow waits up to 30 seconds for `http-server` to start. If it fails:
- Check if port 8000 is available
- Verify `package.json` contains the correct `dev` script
- Review the workflow logs for error messages

### Screenshots are Blank or Incorrect

Possible causes:
- Page didn't fully load (increase wait time in the workflow)
- JavaScript errors preventing rendering
- Network issues loading resources

Check the workflow logs and browser console output for errors.

## Customization

### Adding More Viewports

Edit `.github/workflows/screenshot.yml` and add to the `matrix.viewport` array:

```yaml
- name: custom
  width: 1920
  height: 1080
```

### Changing Diff Threshold

The current threshold is 5% (line ~230 in the workflow). Adjust this value in the compare script:

```javascript
if (parseFloat(diffPercentage) > 5.0) {  // Change 5.0 to your threshold
```

### Capturing Specific Pages

Use the manual workflow dispatch with the `path` parameter:

- Homepage: `/`
- Specific route: `/about` (if your app has routing)

## Best Practices

1. **Review diffs carefully** before updating baselines
2. **Keep baselines in sync** with major UI changes
3. **Use descriptive commit messages** when updating baselines
4. **Document visual changes** in PRs and link to screenshot artifacts
5. **Run manual captures** before major releases to verify all viewports

## Integration with Development Workflow

- Screenshots run automatically on `main` to catch regressions
- Review screenshot artifacts during PR reviews
- Update baselines as part of intentional UI changes
- Reference workflow runs in issue discussions
- Use manual dispatch to test specific viewports or paths

## Future Enhancements

Potential improvements to consider:

- [ ] Performance metrics capture (load time, FCP, LCP)
- [ ] Additional viewports (4K, ultra-wide, small mobile)
- [ ] Screenshot annotations or regions of interest
- [ ] Integration with visual testing platforms
- [ ] Automated PR comments with visual diff previews
- [ ] Historical screenshot gallery
