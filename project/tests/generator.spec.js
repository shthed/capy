import test from 'node:test';
import assert from 'node:assert/strict';

import {
  __segmentRegionsForTests as segmentRegions,
  __smoothAssignmentsForTests as smoothAssignments,
  createPuzzleData,
} from '../../runtime/puzzle-generation.js';
import {
  smoothingOutlierFixture,
  segmentationMergeFixture,
  createPosterizePuzzleFixture,
} from './fixtures/generator-fixtures.js';

test('smoothAssignments demotes isolated noise after a single pass', () => {
  const { width, height, passes, assignments, expected } = smoothingOutlierFixture;
  const source = new Uint16Array(assignments);
  const actual = Array.from(smoothAssignments(source, width, height, passes));
  assert.deepStrictEqual(actual, expected, 'Smoothing should replace the noisy centre pixel');
});

test('segmentRegions merges undersized islands into neighbouring regions', () => {
  const { width, height, minRegion, assignments, expectedRegionMap, expectedRegions } =
    segmentationMergeFixture;
  const result = segmentRegions(width, height, new Uint16Array(assignments), minRegion);
  assert.deepStrictEqual(
    Array.from(result.regionMap),
    expectedRegionMap,
    'Region map should be normalized to the surviving clusters',
  );
  assert.strictEqual(
    result.regions.length,
    expectedRegions.length,
    'Expected region count after merging tiny islands',
  );
  for (const expectedRegion of expectedRegions) {
    const region = result.regions.find((entry) => entry.id === expectedRegion.id);
    assert.ok(region, `Region ${expectedRegion.id} should survive`);
    assert.strictEqual(region.colorId, expectedRegion.colorId);
    assert.strictEqual(region.pixelCount, expectedRegion.pixelCount);
  }
});

test('createPuzzleData integrates quantization, smoothing, and segmentation for posterized fixtures', async () => {
  const fixture = createPosterizePuzzleFixture();
  const originalDocument = globalThis.document;
  const beginCalls = [];
  const stageReports = [];
  const debugLogs = [];

  const makeContext = () => ({
    drawImage: () => {},
    getImageData: () => ({ data: fixture.pixels }),
  });

  globalThis.document = {
    createElement: (tag) => {
      if (tag === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => makeContext(),
          toDataURL: () => '',
        };
      }
      return {};
    },
  };

  const jobId = 42;

  let result;
  try {
    result = await createPuzzleData(
      { width: fixture.width, height: fixture.height },
      fixture.options,
      {
        beginJob: () => {
          beginCalls.push(jobId);
          return jobId;
        },
        reportStage: (id, progress, label) => {
          stageReports.push({ id, progress, label });
        },
        isLatestJob: (id) => id === jobId,
        logDebug: (...args) => {
          debugLogs.push(args.join(' '));
        },
      },
    );
  } finally {
    if (originalDocument) {
      globalThis.document = originalDocument;
    } else {
      delete globalThis.document;
    }
  }

  assert.ok(result, 'Pipeline should resolve data');
  assert.strictEqual(result.width, fixture.width);
  assert.strictEqual(result.height, fixture.height);
  assert.deepStrictEqual(
    result.palette.map((entry) => entry.hex),
    fixture.expectedPaletteHex,
    'Palette hex values should match posterized colours',
  );
  assert.deepStrictEqual(
    Array.from(result.regionMap),
    fixture.expectedRegionMap,
    'Region map should encode merged area identifiers',
  );
  assert.strictEqual(result.regions.length, fixture.expectedRegions.length);
  for (const expected of fixture.expectedRegions) {
    const region = result.regions.find((candidate) => candidate.colorId === expected.colorId);
    assert.ok(region, `Region with colour ${expected.colorId} should exist`);
    assert.strictEqual(region.pixelCount, expected.pixelCount);
    assert.ok(Math.abs(region.cx - expected.cx) < 1e-6, 'Region centre X should be stable');
    assert.ok(Math.abs(region.cy - expected.cy) < 1e-6, 'Region centre Y should be stable');
  }
  assert.deepStrictEqual(beginCalls, [jobId], 'Pipeline should start one job');
  assert.ok(stageReports.some((entry) => entry.label?.includes('Preparing image')));
  assert.ok(stageReports.some((entry) => entry.label?.includes('Generation complete')));
  assert.ok(debugLogs.length >= 3, 'Debug hook should capture pipeline timings');
});
