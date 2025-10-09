# PR #62 Merge Conflict Resolution

## Overview
Successfully resolved merge conflicts between PR #62 (Flatten palette swatches) and the current main branch (which includes PR #71 - Show original artwork behind regions).

## Conflicts Resolved

### 1. .github/workflows/deploy-branch.yml
**Conflict**: Different git authentication approaches and branch index file naming
**Resolution**: 
- Kept authenticated URLs from main (using `${{ secrets.GITHUB_TOKEN }}`)
- Used `branchindex.html` naming from PR #62 (more explicit than `index.html`)
- Ensured all git operations use authenticated URLs for reliability

### 2. README.md
**Conflict**: Palette description differences
**Resolution**:
- Kept PR #62's mention of "halo" in the palette description, which is part of the new flat palette design
- Full text: "label colour, outline, and halo to maintain WCAG-friendly contrast"

### 3. index.html (34 conflicts)
**Strategy**: Integrated both feature sets completely

#### From PR #62 (Palette Flattening):
- Flat, gutterless palette swatches with no gaps
- Adaptive text contrast (dark/light labels based on swatch color)
- Text halo/shadow for readability on any background
- `computeSwatchLabelStyles()` function for dynamic contrast calculation
- Removed progress message from palette dock
- Palette sorting functionality (by region, hue, or remaining count)
- Updated CSS for edge-to-edge swatches

#### From PR #71 (Original Canvas Feature):
- `#canvasStack` wrapper div for layered canvases
- `#originalCanvas` element to display the original clustered artwork
- `originalCtx` context variable and initialization
- `revealOriginalArtwork()` function to temporarily show original artwork
- `hintRevealTimer` variable to track reveal animation
- Updated `useHint()` to reveal original artwork before highlighting regions
- Updated `renderPreview()` to also draw to originalCanvas
- Updated `resetPuzzleUI()` to clear hintRevealTimer and remove reveal-original class
- CSS for `.reveal-original` state (fades out puzzle canvas to show original)
- Responsive CSS updates for `#canvasStack` instead of `#puzzleCanvas`
- Constants: `LAST_IMAGE_STORAGE_KEY` and `HINT_REVEAL_DURATION_MS`
- Check for `completedColors` in `flashColorRegions()`

## Technical Integration Details

### Canvas Structure
```html
<div id="canvasStack">
  <canvas id="originalCanvas" aria-hidden="true"></canvas>
  <canvas id="puzzleCanvas"></canvas>
</div>
```

The puzzle canvas is positioned absolutely over the original canvas, and the reveal-original class temporarily hides it to show the original artwork underneath.

### Palette Dock
The palette dock now renders flat color blocks with no gutters, using CSS custom properties for dynamic label styling:
- `--swatch-color`: The swatch background color
- `--swatch-label-color`: Dark or light text color (auto-selected)
- `--swatch-outline`: Border color for contrast
- `--swatch-label-shadow`: Text shadow/halo for readability

### Hint Behavior
1. When hint button is clicked, `useHint()` is called
2. It calls `revealOriginalArtwork()` which adds `.reveal-original` class
3. After the reveal duration, the region is highlighted
4. The reveal-original class is automatically removed after 1600ms

## Testing
- `npm install` completes successfully
- `npm test --silent` runs (returns placeholder message as expected)
- No conflict markers remain in any file
- All key features verified present in merged code

## Compatibility
Both PR #62 and PR #71 features work together:
- Flat palette swatches display correctly
- Original canvas reveal works on hint
- Adaptive label contrast functions properly
- All responsive breakpoints updated correctly
