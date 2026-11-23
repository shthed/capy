/**
 * [Unit 01] ColorQuantizer, RegionSegmenter mosaic & CapyCodec v2 binary/delta DoS hardening.
 */
import assert from 'node:assert/strict';
import zlib from 'node:zlib';

export async function runEngineCodecTests({ vite, logUnitStart, logUnitPass, shared }) {
    logUnitStart('Testing ColorQuantizer, RegionSegmenter mosaic & CapyCodec v2 binary/delta DoS hardening...');
    const codec = await vite.ssrLoadModule('/src/services/CapyCodec.ts');
    const segmenterMod = await vite.ssrLoadModule('/src/engine/RegionSegmenter.ts');
    const quantizerMod = await vite.ssrLoadModule('/src/engine/ColorQuantizer.ts');

    // 1. Unsigned ARGB bit-packing in ColorQuantizer
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

    // 2. RegionSegmenter cellPartitionMap & bit-exact CapyCodec RLE round-trip
    const width = 256;
    const height = 256;
    const total = width * height;
    const rgba = new Uint8ClampedArray(total * 4);
    const clusterMap = new Int32Array(total);
    const cellPartitionMap = new Int32Array(total);
    const lineMask = new Uint8Array(total);
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
        const clusterIdx = gy % 4;
        const col = testPalette[clusterIdx];
        clusterMap[p] = clusterIdx;
        cellPartitionMap[p] = gy * gridN + gx;
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
      16,
      8,
      2.5,
      lineMask,
      'ABSORB_LINES',
      rgba,
      128,
      undefined,
      cellPartitionMap
    );
    assert.equal(segmented.regions.length, 64, 'Expected 64 mosaic cells with cellPartitionMap');

    // 2b. RegionSegmenter Phase 2 min-heap strict maxRegions cap with > 9,000 initial regions
    {
      const gridBlocks = 104; // 104 * 104 = 10,816 4-connected initial regions (> 8,000 legacy safety cap)
      const sW = gridBlocks * 4;
      const sH = gridBlocks * 4;
      const sClusters = new Int32Array(sW * sH);
      const sLineMask = new Uint8Array(sW * sH);
      const sRgba = new Uint8ClampedArray(sW * sH * 4);
      for (let by = 0; by < gridBlocks; by++) {
        for (let bx = 0; bx < gridBlocks; bx++) {
          const clusterIdx = (bx + by) % 2;
          const col = testPalette[clusterIdx];
          for (let dy = 0; dy < 4; dy++) {
            const rowBase = (by * 4 + dy) * sW + bx * 4;
            for (let dx = 0; dx < 4; dx++) {
              const p = rowBase + dx;
              sClusters[p] = clusterIdx;
              sRgba[p * 4] = col.r;
              sRgba[p * 4 + 1] = col.g;
              sRgba[p * 4 + 2] = col.b;
              sRgba[p * 4 + 3] = 255;
            }
          }
        }
      }
      const capped2000 = segmenterMod.RegionSegmenter.segment(
        sW,
        sH,
        testPalette.slice(0, 2),
        sClusters,
        12,
        0,
        0,
        sLineMask,
        'ABSORB_LINES',
        sRgba,
        2000
      );
      assert.equal(
        capped2000.regions.length <= 2000 && capped2000.regions.length > 0,
        true,
        `Phase 2 min-heap must strictly cap 10,816 components <= 2000 (got ${capped2000.regions.length})`
      );

      const capped200 = segmenterMod.RegionSegmenter.segment(
        sW,
        sH,
        testPalette.slice(0, 2),
        sClusters,
        12,
        0,
        0,
        sLineMask,
        'ABSORB_LINES',
        sRgba,
        200
      );
      assert.equal(
        capped200.regions.length <= 200 && capped200.regions.length > 0,
        true,
        `Phase 2 min-heap must strictly cap 10,816 components <= 200 (got ${capped200.regions.length})`
      );
    }

    const puzzleData = {
      width,
      height,
      palette: testPalette,
      regions: segmented.regions,
      regionMap: segmented.regionMap,
      borderMap: segmented.borderMap,
      isFreeColor: false,
    };

    const compact = codec.compressPuzzleRecord(puzzleData);
    const compactBytes = codec.estimateCompactPuzzleBytes(puzzleData);
    const restored = codec.decompressPuzzleRecord(compact);
    assert.equal(compactBytes < 20_000, true, `Expected compact record < 20 KB, got ${compactBytes}`);
    assert.deepEqual(restored.regionMap, puzzleData.regionMap, 'regionMap must match bit-for-bit');
    assert.deepEqual(restored.borderMap, puzzleData.borderMap, 'borderMap must match bit-for-bit');
    assert.deepEqual(restored.regions[0].pixels, puzzleData.regions[0].pixels, 'Region pixels must match bit-for-bit');

    // 3. .capy v2 Gzip single & archive binary framing
    const sampleSnapshot = {
      id: 'snap-test-1',
      title: 'Test Custom Upload',
      timestamp: 1700000000000,
      lastOpened: 1700000005000,
      filledCount: 3,
      totalCount: 64,
      filledRegionIds: [5, 1, 12],
      parentSnapshotId: 'parent-snap-0',
      zoomScale: 2.5,
      panOffsetX: -80,
      panOffsetY: 32,
      sourceRef: { kind: 'blob', uri: 'snap-test-1' },
    };
    const fakeImageBytes = new Uint8Array(4096);
    for (let i = 0; i < fakeImageBytes.length; i++) fakeImageBytes[i] = (i * 31) & 0xff;
    const fakeImageBlob = new Blob([fakeImageBytes], { type: 'image/webp' });

    const fixedExportDate = 1767225600000;
    const singleBinary = await codec.encodeSingleSaveBinaryV2(sampleSnapshot, compact, fakeImageBlob, {
      exportDate: fixedExportDate,
    });
    const singleBinaryRepeat = await codec.encodeSingleSaveBinaryV2(sampleSnapshot, compact, fakeImageBlob, {
      exportDate: fixedExportDate,
    });
    assert.equal(codec.hasBinaryMagicHeader(singleBinary), true, 'Must start with CAPY\\x02 magic header');
    assert.equal(
      Buffer.compare(Buffer.from(singleBinary), Buffer.from(singleBinaryRepeat)),
      0,
      'encodeSingleSaveBinaryV2 with fixed exportDate must emit byte-identical .capy files'
    );
    const decodedSingle = await codec.decodeBinarySaveV2(singleBinary);
    assert.equal(decodedSingle.format, 'capy-single-save-v2');
    assert.equal(decodedSingle.exportDate, fixedExportDate);
    assert.deepEqual(decodedSingle.snapshot.filledRegionIds, [5, 1, 12]);
    assert.equal(decodedSingle.snapshot.parentSnapshotId, 'parent-snap-0');
    assert.deepEqual(decodedSingle.imageBytes, fakeImageBytes);

    const archiveBinary = await codec.encodeArchiveSaveBinaryV2(
      [sampleSnapshot],
      { 'snap-test-1': compact },
      { 'snap-test-1': fakeImageBlob },
      { exportDate: fixedExportDate }
    );
    const archiveBinaryRepeat = await codec.encodeArchiveSaveBinaryV2(
      [sampleSnapshot],
      { 'snap-test-1': compact },
      { 'snap-test-1': fakeImageBlob },
      { exportDate: fixedExportDate }
    );
    assert.equal(
      Buffer.compare(Buffer.from(archiveBinary), Buffer.from(archiveBinaryRepeat)),
      0,
      'encodeArchiveSaveBinaryV2 with fixed exportDate must emit byte-identical .capy archives'
    );
    const decodedArchive = await codec.decodeBinarySaveV2(archiveBinary);
    assert.equal(decodedArchive.format, 'capy-archive-save-v2');
    assert.equal(decodedArchive.exportDate, fixedExportDate);
    assert.equal(decodedArchive.snapshots.length, 1);
    assert.equal(decodedArchive.snapshots[0].parentSnapshotId, 'parent-snap-0');

    // 4. <2 KB ProgressDeltaV2 token & CRDT union merge
    const deltaA = {
      version: 2,
      sourceRef: { kind: 'catalog', uri: 'capy_forest_01' },
      filledRegionIds: [1, 4, 9],
      paintedRegionColors: { 1: 0xffef4444, 4: 0xff22c55e },
      isFreeColor: true,
      updatedAt: 1000,
    };
    const deltaB = {
      version: 2,
      sourceRef: { kind: 'catalog', uri: 'capy_forest_01' },
      filledRegionIds: [4, 2, 8],
      paintedRegionColors: { 4: 0xff3b82f6 },
      isFreeColor: true,
      updatedAt: 2000,
    };
    const tokenA = await codec.encodeProgressDeltaToken(deltaA);
    assert.equal(tokenA.length < 2048, true);
    const merged = codec.mergeProgressDeltas(deltaA, deltaB);
    assert.deepEqual(merged.filledRegionIds, [1, 4, 9, 2, 8]);
    assert.equal(merged.paintedRegionColors?.[4], 0xff3b82f6, 'Newer timestamp wins Free Colour conflict');

    // 4b. M-01 CapyCodec malformed varint, gzip-bomb, and allocation-ceiling rejection
    const nineByteDosToken = Buffer.from([
      0x00, 0x02, 0x00, 0x01, 0xff, 0xff, 0xff, 0xff, 0x0f,
    ]).toString('base64url');
    await assert.rejects(
      () => codec.decodeProgressDeltaToken(nineByteDosToken),
      /filledLen|bounds/,
      '9-byte filledLen=0xffffffff token must be rejected before allocation'
    );
    const truncatedPayloadToken = Buffer.from([0x00, 0x02, 0x00, 0x80]).toString('base64url');
    await assert.rejects(
      () => codec.decodeProgressDeltaToken(truncatedPayloadToken),
      /Truncated progress delta payload/
    );
    const eofVarintToken = Buffer.from([0x00, 0x02, 0x00, 0x01, 0x80]).toString('base64url');
    await assert.rejects(
      () => codec.decodeProgressDeltaToken(eofVarintToken),
      /Malformed varint: unexpected EOF/
    );
    const overlongVarintToken = Buffer.from([
      0x00, 0x02, 0x00, 0x80, 0x80, 0x80, 0x80, 0x80, 0x01,
    ]).toString('base64url');
    await assert.rejects(
      () => codec.decodeProgressDeltaToken(overlongVarintToken),
      /Malformed varint/
    );
    const overflowVarintToken = Buffer.from([
      0x00, 0x02, 0x00, 0x80, 0x80, 0x80, 0x80, 0x10,
    ]).toString('base64url');
    await assert.rejects(
      () => codec.decodeProgressDeltaToken(overflowVarintToken),
      /uint32 overflow/
    );
    const oversizedColorsToken = Buffer.from([
      0x00, 0x02, 0x02, 0x01, 0x00, 0xff, 0xff, 0x0f,
    ]).toString('base64url');
    await assert.rejects(
      () => codec.decodeProgressDeltaToken(oversizedColorsToken),
      /colorEntries|bounds/
    );
    const oversizedRefToken = Buffer.from([0x00, 0x02, 0x04, 0x01, 0x81, 0x20]).toString(
      'base64url'
    );
    await assert.rejects(
      () => codec.decodeProgressDeltaToken(oversizedRefToken),
      /sourceRef length/
    );
    const deltaGzipBombToken = Buffer.concat([
      Buffer.from([0x01]),
      zlib.gzipSync(Buffer.alloc(300 * 1024, 0)),
    ]).toString('base64url');
    await assert.rejects(
      () => codec.decodeProgressDeltaToken(deltaGzipBombToken),
      /exceeds limit/,
      'Progress delta gzip stream > 256 KB must abort immediately'
    );
    const saveGzipBomb = new Uint8Array(
      Buffer.concat([
        Buffer.from([0x43, 0x41, 0x50, 0x59, 0x02, 0x01]),
        zlib.gzipSync(Buffer.alloc(17 * 1024 * 1024, 0)),
      ])
    );
    await assert.rejects(
      () => codec.decodeBinarySaveV2(saveGzipBomb),
      /exceeds limit/,
      '.capy v2 gzip stream > 16 MB must abort immediately'
    );
    const badFramedSave = new Uint8Array([
      0x43, 0x41, 0x50, 0x59, 0x02, 0x00, 0xff, 0xff, 0xff, 0x7f,
    ]);
    await assert.rejects(
      () => codec.decodeBinarySaveV2(badFramedSave),
      /JSON header exceeds payload/
    );
    assert.throws(
      () =>
        codec.decompressPuzzleRecord({
          ...compact,
          regionMeta: new Float32Array([1e9, 1, 0, 0, 1]),
        }),
      /exceeds limit/
    );
    shared.puzzleData = puzzleData;
    logUnitPass('ColorQuantizer, RegionSegmenter mosaic & CapyCodec v2 binary/delta DoS hardening verified.');
}
