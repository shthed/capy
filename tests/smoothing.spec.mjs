import test from 'node:test';
import assert from 'node:assert/strict';

import { __smoothAssignmentsForTests as smoothAssignments } from '../puzzle-generation.js';

function accumulateMap(histogram, color) {
  histogram.set(color, (histogram.get(color) || 0) + 1);
}

function smoothAssignmentsReference(assignments, width, height, passes) {
  let current = new Uint16Array(assignments);
  for (let pass = 0; pass < passes; pass++) {
    const next = new Uint16Array(current);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const histogram = new Map();
        const baseColor = current[idx];
        histogram.set(baseColor, (histogram.get(baseColor) || 0) + 2);
        if (x > 0) accumulateMap(histogram, current[idx - 1]);
        if (x < width - 1) accumulateMap(histogram, current[idx + 1]);
        if (y > 0) accumulateMap(histogram, current[idx - width]);
        if (y < height - 1) accumulateMap(histogram, current[idx + width]);
        let bestColor = baseColor;
        let bestScore = -Infinity;
        for (const [color, score] of histogram.entries()) {
          if (score > bestScore) {
            bestScore = score;
            bestColor = color;
          }
        }
        next[idx] = bestColor;
      }
    }
    current = next;
  }
  return current;
}

function runFixture(fixture) {
  const { description, width, height, passes, assignments } = fixture;
  test(description, () => {
    const source = new Uint16Array(assignments);
    const expected = smoothAssignmentsReference(source, width, height, passes);
    const actual = smoothAssignments(source, width, height, passes);
    assert.deepStrictEqual(
      Array.from(actual),
      Array.from(expected),
      'Refactored smoothing should preserve colour transitions'
    );
  });
}

const fixtures = [
  {
    description: 'preserves transitions across a simple 3x3 cluster',
    width: 3,
    height: 3,
    passes: 1,
    assignments: [
      0, 1, 1,
      1, 1, 2,
      1, 2, 2,
    ],
  },
  {
    description: 'handles multiple passes with distant palette indices',
    width: 4,
    height: 2,
    passes: 2,
    assignments: [
      0, 5, 5, 12,
      0, 0, 7, 12,
    ],
  },
  {
    description: 'returns an untouched copy when passes are zero',
    width: 2,
    height: 2,
    passes: 0,
    assignments: [
      3, 4,
      5, 6,
    ],
  },
];

for (const fixture of fixtures) {
  runFixture(fixture);
}
