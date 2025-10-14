# Capy Automated Testing

## Quick Start

Run the automated smoke test:

```bash
npm install
npm test
```

This will:
1. Start a local web server on port 8000
2. Launch Chrome in headless mode
3. Load the game in both desktop (1920x1080) and mobile (375x667) viewports
4. Capture screenshots to verify the game loaded correctly
5. Save screenshots to `artifacts/` directory

## Test Artifacts

After running tests, check the captured screenshots:

- `artifacts/game-loaded-desktop.png` - Desktop view (1920x1080)
- `artifacts/game-loaded-mobile.png` - Mobile view (375x667)

These screenshots verify that:
- The game canvas loads
- The command rail is visible
- The palette dock appears
- The default Capybara Springs sample renders

## Running Tests

- **Full test:** `npm test`
- **Smoke test:** `npm run test:smoke` (same as above)
- **Development server:** `npm run dev` (starts server on port 8000)

## Requirements

- Node.js 18+ 
- Google Chrome or Chromium browser
- http-server package (installed via npm)

## How It Works

The test system uses a simple Bash script (`tests/smoke-test.sh`) that:

1. Starts http-server in the background
2. Uses Chrome's headless mode with the `--screenshot` flag
3. Captures full-page screenshots at different viewport sizes
4. Verifies screenshot files were created successfully
5. Cleans up the server process

This approach is:
- ✅ **Fast** - Completes in under 30 seconds
- ✅ **Simple** - No complex test framework dependencies
- ✅ **Reliable** - Uses the system Chrome browser
- ✅ **Portable** - Works in CI/CD environments with Chrome installed

## CI Integration

The test can be run in CI workflows:

```yaml
- name: Run smoke tests
  run: |
    npm install
    npm test
    
- name: Upload test artifacts
  uses: actions/upload-artifact@v3
  with:
    name: test-screenshots
    path: artifacts/
```

## Troubleshooting

**Test fails with "google-chrome: command not found"**
- Install Google Chrome or Chromium browser
- Update the script to use `chromium-browser` instead if needed

**Server already running on port 8000**
- Stop any existing server on port 8000
- Or modify `tests/smoke-test.sh` to use a different port

**Screenshots look wrong**
- Check console output for errors
- Verify the game loads correctly at http://localhost:8000
- Ensure the Capybara Springs sample is loading properly
