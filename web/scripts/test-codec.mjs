import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

async function run() {
  const vite = await createServer({
    root: projectRoot,
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true },
    appType: 'custom',
    logLevel: 'error',
  });

  try {
    const codec = await vite.ssrLoadModule('/src/services/CapyCodec.ts');
    const segmenterMod = await vite.ssrLoadModule('/src/engine/RegionSegmenter.ts');
    const quantizerMod = await vite.ssrLoadModule('/src/engine/ColorQuantizer.ts');

    console.log('1. Verifying unsigned ARGB bit-packing in ColorQuantizer...');
    const { palette } = quantizerMod.ColorQuantizer.quantize(
      new Uint8ClampedArray([
        255, 50, 100, 255,
        20, 180, 240, 255,
        250, 240, 120, 255,
        30, 40, 50, 255,
      ]),
      2,
      2,
      2,
      4,
      false,
      true
    );
    for (const col of palette) {
      assert.equal(col.argb >= 0, true, `Expected unsigned argb >= 0, got ${col.argb}`);
      assert.equal(col.argb >>> 24, 0xff, 'Expected alpha byte 0xff');
    }
    console.log('   PASS: ColorQuantizer emits unsigned 32-bit ARGB integers.');

    console.log('2. Verifying RegionSegmenter cellPartitionMap & bit-exact CapyCodec RLE round-trip...');
    const width = 512;
    const height = 512;
    const total = width * height;
    const rgba = new Uint8ClampedArray(total * 4);
    const clusterMap = new Int32Array(total);
    const cellPartitionMap = new Int32Array(total);
    const lineMask = new Uint8Array(total);

    // Build an 8x8 stained-glass mosaic grid (64 distinct cells) using only 4 palette colors
    const gridN = 8;
    const cellW = width / gridN;
    const cellH = height / gridN;
    const testPalette = [
      { id: 1, hex: '#ef4444', isLight: false, argb: 0xffef4444, r: 239, g: 68, b: 68 },
      { id: 2, hex: '#22c55e', isLight: false, argb: 0xff22c55e, r: 34, g: 197, b: 94 },
      { id: 3, hex: '#3b82f6', isLight: false, argb: 0xff3b82f6, r: 59, g: 130, b: 246 },
      { id: 4, hex: '#eab308', isLight: true, argb: 0xffeab308, r: 234, g: 179, b: 8 },
    ];

    for (let y = 0; y < height; y++) {
      const gy = Math.min(gridN - 1, Math.floor(y / cellH));
      for (let x = 0; x < width; x++) {
        const gx = Math.min(gridN - 1, Math.floor(x / cellW));
        const p = y * width + x;
        const cellId = gy * gridN + gx;
        // Adjacent horizontal cells share color to verify cellPartitionMap prevents coalescing!
        const clusterIdx = gy % 4;
        const col = testPalette[clusterIdx];
        clusterMap[p] = clusterIdx;
        cellPartitionMap[p] = cellId;
        rgba[p * 4] = col.r;
        rgba[p * 4 + 1] = col.g;
        rgba[p * 4 + 2] = col.b;
        rgba[p * 4 + 3] = 255;
      }
    }

    const segmented = segmenterMod.RegionSegmenter.segment(
      width,
      height,
      testPalette,
      clusterMap,
      32,
      8,
      2.5,
      lineMask,
      'ABSORB_LINES',
      rgba,
      128,
      undefined,
      cellPartitionMap
    );

    assert.equal(
      segmented.regions.length,
      64,
      `Expected 64 preserved mosaic cells with cellPartitionMap, got ${segmented.regions.length}`
    );

    const puzzleData = {
      width,
      height,
      palette: testPalette,
      regions: segmented.regions,
      regionMap: segmented.regionMap,
      borderMap: segmented.borderMap,
      isFreeColor: false,
    };

    const rawBytes =
      puzzleData.regionMap.byteLength +
      puzzleData.borderMap.byteLength +
      puzzleData.regions.reduce((acc, r) => acc + r.pixels.byteLength + 64, 0);

    const t0 = performance.now();
    const compact = codec.compressPuzzleRecord(puzzleData);
    const encodeMs = performance.now() - t0;
    const compactBytes = codec.estimateCompactPuzzleBytes(puzzleData);
    const ratio = rawBytes / compactBytes;

    const t1 = performance.now();
    const restored = codec.decompressPuzzleRecord(compact);
    const decodeMs = performance.now() - t1;

    assert.equal(restored.width, puzzleData.width);
    assert.equal(restored.height, puzzleData.height);
    assert.equal(restored.regions.length, puzzleData.regions.length);
    assert.deepEqual(restored.regionMap, puzzleData.regionMap, 'regionMap must match bit-for-bit');
    assert.deepEqual(restored.borderMap, puzzleData.borderMap, 'borderMap must match bit-for-bit');

    for (let i = 0; i < puzzleData.regions.length; i++) {
      const origR = puzzleData.regions[i];
      const restR = restored.regions[i];
      assert.equal(restR.id, origR.id);
      assert.equal(restR.colorId, origR.colorId);
      assert.equal(restR.area, origR.area);
      assert.equal(restR.minX, origR.minX);
      assert.equal(restR.maxX, origR.maxX);
      assert.equal(restR.minY, origR.minY);
      assert.equal(restR.maxY, origR.maxY);
      assert.equal(restR.centroidX, origR.centroidX);
      assert.equal(restR.centroidY, origR.centroidY);
      assert.equal(restR.maxRadius, origR.maxRadius);
      assert.deepEqual(restR.pixels, origR.pixels, `Region ${origR.id} pixels must match bit-for-bit`);
    }

    console.log(
      `   PASS: CompactPuzzleRecordV2 ${rawBytes} B -> ${compactBytes} B (${ratio.toFixed(1)}x smaller, encode ${encodeMs.toFixed(2)}ms, decode ${decodeMs.toFixed(2)}ms).`
    );
    assert.equal(compactBytes < 30_000, true, `Expected compact record < 30 KB, got ${compactBytes}`);

    console.log('3. Verifying .capy v2 Gzip binary single & archive framing + custom image blob...');
    const sampleSnapshot = {
      id: 'snap-test-1',
      title: 'Test Custom Upload',
      timestamp: 1700000000000,
      lastOpened: 1700000005000,
      filledCount: 3,
      totalCount: 64,
      filledRegionIds: [5, 1, 12],
      zoomScale: 2.75,
      panOffsetX: -120.5,
      panOffsetY: 48.25,
      sourceRef: { kind: 'custom_blob', imageId: 'snap-test-1' },
    };
    const fakeImageBytes = new Uint8Array(262_144);
    let rng = 0x12345678;
    for (let i = 0; i < fakeImageBytes.length; i++) {
      rng ^= rng << 13;
      rng ^= rng >>> 17;
      rng ^= rng << 5;
      fakeImageBytes[i] = rng & 0xff;
    }
    const fakeImageBlob = new Blob([fakeImageBytes], { type: 'image/webp' });

    const singleBinary = await codec.encodeSingleSaveBinaryV2(
      sampleSnapshot,
      compact,
      fakeImageBlob
    );
    assert.equal(codec.hasBinaryMagicHeader(singleBinary), true, 'Must start with CAPY\\x02 magic header');

    const decodedSingle = await codec.decodeBinarySaveV2(singleBinary);
    assert.equal(decodedSingle.format, 'capy-single-save-v2');
    assert.equal(decodedSingle.snapshot.id, 'snap-test-1');
    assert.equal(decodedSingle.snapshot.zoomScale, 2.75);
    assert.deepEqual(decodedSingle.snapshot.filledRegionIds, [5, 1, 12]);
    assert.equal(decodedSingle.imageMimeType, 'image/webp');
    assert.deepEqual(decodedSingle.imageBytes, fakeImageBytes);

    const secondSnapshot = {
      ...sampleSnapshot,
      id: 'snap-test-2',
      title: 'Built-in Capybara',
      sampleAssetPath: 'assets/capybara.webp',
      sourceRef: { kind: 'sample', assetPath: 'assets/capybara.webp' },
    };
    const archiveBinary = await codec.encodeArchiveSaveBinaryV2(
      [sampleSnapshot, secondSnapshot],
      { 'snap-test-1': compact, 'snap-test-2': compact },
      { 'snap-test-1': fakeImageBlob }
    );
    const decodedArchive = await codec.decodeBinarySaveV2(archiveBinary);
    assert.equal(decodedArchive.format, 'capy-archive-save-v2');
    assert.equal(decodedArchive.snapshots.length, 2);
    assert.equal(decodedArchive.snapshots[1].sourceRef?.kind, 'sample');
    assert.deepEqual(decodedArchive.images?.['snap-test-1']?.bytes, fakeImageBytes);
    console.log(
      `   PASS: .capy v2 binary single (${singleBinary.byteLength} B) & 2-save archive (${archiveBinary.byteLength} B) round-trip cleanly.`
    );

    console.log('4. Verifying <2 KB ProgressDeltaV2 token & CRDT union merge...');
    const deltaA = {
      version: 2,
      sourceRef: { kind: 'catalog', catalogId: 'capy_forest_01' },
      filledRegionIds: [1, 4, 9, 16, 25],
      paintedRegionColors: { 1: 0xffef4444, 4: 0xff22c55e },
      isFreeColor: true,
      updatedAt: 1000000,
    };
    const deltaB = {
      version: 2,
      sourceRef: { kind: 'catalog', catalogId: 'capy_forest_01' },
      filledRegionIds: [4, 2, 8, 25, 30],
      paintedRegionColors: { 4: 0xff3b82f6, 8: 0xffeab308 },
      isFreeColor: true,
      updatedAt: 2000000,
    };
    const tokenA = await codec.encodeProgressDeltaToken(deltaA);
    assert.equal(tokenA.length < 2048, true, `Expected token < 2 KB, got ${tokenA.length} chars`);
    const roundTripDeltaA = await codec.decodeProgressDeltaToken(tokenA);
    assert.deepEqual(roundTripDeltaA.filledRegionIds, deltaA.filledRegionIds);
    assert.equal(roundTripDeltaA.paintedRegionColors?.[1], 0xffef4444);

    const merged = codec.mergeProgressDeltas(deltaA, deltaB);
    assert.deepEqual(merged.filledRegionIds, [1, 4, 9, 16, 25, 2, 8, 30]);
    assert.equal(merged.paintedRegionColors?.[4], 0xff3b82f6, 'Newer timestamp wins Free Colour conflict');
    assert.equal(merged.paintedRegionColors?.[1], 0xffef4444);
    assert.equal(merged.paintedRegionColors?.[8], 0xffeab308);
    console.log(`   PASS: ProgressDeltaV2 token (${tokenA.length} chars) & CRDT merge verified.`);

    console.log('\nALL CAPY CODEC V2 & ENGINE UNIT TESTS PASSED!');
  } finally {
    await vite.close();
  }
}

run().catch((err) => {
  console.error('Codec test failed:', err);
  process.exit(1);
});
