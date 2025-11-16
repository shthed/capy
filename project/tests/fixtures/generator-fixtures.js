export const smoothingOutlierFixture = Object.freeze({
  description: 'smooths a single noisy pixel back into a dominant colour',
  width: 3,
  height: 3,
  passes: 1,
  assignments: [
    0, 0, 0,
    0, 5, 0,
    0, 0, 0,
  ],
  expected: [
    0, 0, 0,
    0, 0, 0,
    0, 0, 0,
  ],
});

export const segmentationMergeFixture = Object.freeze({
  description: 'merges sub-threshold islands into the nearest majority region',
  width: 4,
  height: 3,
  minRegion: 3,
  assignments: [
    0, 0, 0, 0,
    0, 1, 2, 2,
    0, 1, 2, 3,
  ],
  expectedRegionMap: [
    0, 0, 0, 0,
    0, 0, 1, 1,
    0, 0, 1, 1,
  ],
  expectedRegions: [
    { id: 0, colorId: 0, pixelCount: 8 },
    { id: 1, colorId: 2, pixelCount: 4 },
  ],
});

export function createPosterizePuzzleFixture() {
  const width = 8;
  const height = 8;
  const red = [240, 20, 20, 255];
  const green = [20, 200, 20, 255];
  const blue = [20, 20, 220, 255];
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      let color = null;
      if (y < 4) {
        color = red;
        if (x === 6 && y === 1) {
          color = blue;
        }
      } else {
        color = green;
        if (x < 2 && y >= 6) {
          color = blue;
        }
      }
      pixels[idx] = color[0];
      pixels[idx + 1] = color[1];
      pixels[idx + 2] = color[2];
      pixels[idx + 3] = color[3];
    }
  }
  return {
    width,
    height,
    pixels,
    options: {
      algorithm: 'local-posterize',
      targetColors: 3,
      smoothingPasses: 1,
      minRegion: 4,
      sourceImageMaxBytes: 0,
    },
    expectedPaletteHex: ['#f01414', '#14c814', '#1414dc'],
    expectedRegions: [
      { colorId: 1, pixelCount: 32, cx: 3.5, cy: 1.5 },
      { colorId: 2, pixelCount: 28, cx: 3.9285714285714284, cy: 5.357142857142857 },
      { colorId: 3, pixelCount: 4, cx: 0.5, cy: 6.5 },
    ],
    expectedRegionMap: [
      0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0,
      1, 1, 1, 1, 1, 1, 1, 1,
      1, 1, 1, 1, 1, 1, 1, 1,
      2, 2, 1, 1, 1, 1, 1, 1,
      2, 2, 1, 1, 1, 1, 1, 1,
    ],
  };
}
