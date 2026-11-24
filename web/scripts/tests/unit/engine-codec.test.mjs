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
    // 5. F8 — RegionSegmenter optional activeMask (empty mask, circular donut, relaxed floors, isolated islands, masked watershed)
    {
      const maskW = 64;
      const maskH = 64;
      const maskTotal = maskW * maskH;
      const emptyMask = new Uint8Array(maskTotal);
      const emptyRes = segmenterMod.RegionSegmenter.segment(
        maskW,
        maskH,
        testPalette,
        new Int32Array(maskTotal),
        4,
        4,
        2.0,
        undefined,
        'ABSORB_LINES',
        undefined,
        10,
        undefined,
        undefined,
        emptyMask
      );
      assert.equal(emptyRes.regions.length, 0, 'Empty activeMask must return 0 regions');
      assert.equal(emptyRes.regionMap.every((v) => v === 0), true, 'Empty activeMask regionMap must be all 0');
      assert.equal(emptyRes.borderMap.every((v) => v === 0), true, 'Empty activeMask borderMap must be all 0');

      // Circular donut mask with 4 color quadrants + center hole
      const donutMask = new Uint8Array(maskTotal);
      const donutClusters = new Int32Array(maskTotal).fill(-1);
      const donutRgba = new Uint8ClampedArray(maskTotal * 4);
      for (let y = 0; y < maskH; y++) {
        for (let x = 0; x < maskW; x++) {
          const idx = y * maskW + x;
          const dx = x - 32;
          const dy = y - 32;
          const d2 = dx * dx + dy * dy;
          if (d2 <= 24 * 24 && d2 >= 8 * 8) {
            donutMask[idx] = 1;
            const q = (y < 32 ? 0 : 2) + (x < 32 ? 0 : 1);
            donutClusters[idx] = q;
            const c = testPalette[q];
            donutRgba[idx * 4] = c.r;
            donutRgba[idx * 4 + 1] = c.g;
            donutRgba[idx * 4 + 2] = c.b;
            donutRgba[idx * 4 + 3] = 255;
          }
        }
      }
      const donutSeg = segmenterMod.RegionSegmenter.segment(
        maskW,
        maskH,
        testPalette,
        donutClusters,
        4,
        8,
        2.0,
        undefined,
        'ABSORB_LINES',
        donutRgba,
        8,
        undefined,
        undefined,
        donutMask
      );
      assert.equal(donutSeg.regions.length, 4, 'Donut 4-quadrant mask should yield 4 regions');
      for (let i = 0; i < maskTotal; i++) {
        if (donutMask[i] === 1) {
          assert.ok(donutSeg.regionMap[i] >= 1, `Active pixel ${i} must have regionMap >= 1`);
        } else {
          assert.equal(donutSeg.regionMap[i], 0, `Inactive pixel ${i} must have regionMap === 0`);
        }
      }
      for (let rIdx = 0; rIdx < donutSeg.regions.length; rIdx++) {
        const reg = donutSeg.regions[rIdx];
        assert.equal(reg.id, rIdx + 1, 'Masked region IDs must be sequential 1-based');
        for (let p = 1; p < reg.pixels.length; p++) {
          assert.ok(reg.pixels[p] > reg.pixels[p - 1], 'Masked region pixels must be strictly ascending');
        }
        const cx = Math.floor(reg.centroidX);
        const cy = Math.floor(reg.centroidY);
        assert.equal(donutSeg.regionMap[cy * maskW + cx], reg.id, 'Pole-of-Inaccessibility centroid must lie inside region');
        assert.equal(donutMask[cy * maskW + cx], 1, 'Pole-of-Inaccessibility centroid must lie inside activeMask');
      }
      assert.deepEqual(
        donutSeg.borderMap,
        codec.buildBorderMapFromRegionMap(donutSeg.regionMap, maskW, maskH),
        'Masked borderMap must match CapyCodec.buildBorderMapFromRegionMap bit-for-bit'
      );

      // Relaxed maxRegions floor: 4-quadrant donut capped strictly to <= 2 regions
      const cappedTwo = segmenterMod.RegionSegmenter.segment(
        maskW,
        maskH,
        testPalette,
        donutClusters,
        4,
        8,
        2.0,
        undefined,
        'ABSORB_LINES',
        donutRgba,
        2,
        undefined,
        undefined,
        donutMask
      );
      assert.ok(
        cappedTwo.regions.length >= 1 && cappedTwo.regions.length <= 2,
        `Masked maxRegions=2 must relax unmasked 20-region floor (got ${cappedTwo.regions.length})`
      );

      // Relaxed minRegionArea floor: 6px patch with minRegionArea=2, maxRegions=1
      const tinyMask = new Uint8Array(16 * 16);
      const tinyClusters = new Int32Array(16 * 16).fill(-1);
      for (let x = 5; x < 11; x++) {
        tinyMask[8 * 16 + x] = 1;
        tinyClusters[8 * 16 + x] = 0;
      }
      const tinySeg = segmenterMod.RegionSegmenter.segment(
        16,
        16,
        testPalette,
        tinyClusters,
        2,
        4,
        2.0,
        undefined,
        'ABSORB_LINES',
        undefined,
        1,
        undefined,
        undefined,
        tinyMask
      );
      assert.equal(tinySeg.regions.length, 1, '6px masked patch with minRegionArea=2 must yield 1 valid region');

      // Disconnected islands: Island A (4 quadrants 20x20) + Island B (isolated 6x6) capped to maxRegions=2 -> exact 2 regions
      const islW = 48;
      const islH = 32;
      const islMask = new Uint8Array(islW * islH);
      const islClusters = new Int32Array(islW * islH).fill(-1);
      for (let y = 4; y < 24; y++) {
        for (let x = 4; x < 24; x++) {
          const idx = y * islW + x;
          islMask[idx] = 1;
          islClusters[idx] = (y < 14 ? 0 : 2) + (x < 14 ? 0 : 1);
        }
      }
      for (let y = 10; y < 16; y++) {
        for (let x = 36; x < 42; x++) {
          const idx = y * islW + x;
          islMask[idx] = 1;
          islClusters[idx] = 0;
        }
      }
      const islCap2 = segmenterMod.RegionSegmenter.segment(
        islW,
        islH,
        testPalette,
        islClusters,
        4,
        4,
        0,
        undefined,
        'ABSORB_LINES',
        undefined,
        2,
        undefined,
        undefined,
        islMask
      );
      assert.equal(
        islCap2.regions.length,
        2,
        `Disconnected islands with maxRegions=2 must merge Island A to 1 + keep Island B = 2 (got ${islCap2.regions.length})`
      );
      const islCap1 = segmenterMod.RegionSegmenter.segment(
        islW,
        islH,
        testPalette,
        islClusters,
        4,
        4,
        0,
        undefined,
        'ABSORB_LINES',
        undefined,
        1,
        undefined,
        undefined,
        islMask
      );
      assert.equal(
        islCap1.regions.length,
        2,
        'Disconnected islands with maxRegions=1 must terminate cleanly at physical minimum 2 without bridging exterior'
      );

      // Masked ABSORB_LINES watershed + zero-gap guarantee
      const wsLineMask = new Uint8Array(maskTotal);
      for (let y = 0; y < maskH; y++) {
        wsLineMask[y * maskW + 31] = 1;
        wsLineMask[y * maskW + 32] = 1;
      }
      const wsSeg = segmenterMod.RegionSegmenter.segment(
        maskW,
        maskH,
        testPalette,
        donutClusters,
        4,
        8,
        2.0,
        wsLineMask,
        'ABSORB_LINES',
        donutRgba,
        8,
        undefined,
        undefined,
        donutMask
      );
      for (let i = 0; i < maskTotal; i++) {
        if (donutMask[i] === 1) {
          assert.ok(wsSeg.regionMap[i] >= 1, `Masked watershed active pixel ${i} must stay >= 1`);
        } else {
          assert.equal(wsSeg.regionMap[i], 0, `Masked watershed inactive pixel ${i} must stay 0`);
        }
      }
    }

    // 6. F9 — LineArtExtractor colored-ink bilateral dark-ridge detection, thick-blob zero-halo suppression & activeMask
    {
      const lineArtMod = await vite.ssrLoadModule('/src/engine/LineArtExtractor.ts');
      const { LineArtExtractor } = lineArtMod;
      const lw = 80;
      const lh = 80;

      const makeBg = (r, g, b) => {
        const buf = new Uint8ClampedArray(lw * lh * 4);
        for (let y = 0; y < lh; y++) {
          for (let x = 0; x < lw; x++) {
            const o = (y * lw + x) * 4;
            const jitter = ((x * 7 + y * 13) % 7) - 3;
            buf[o] = Math.max(0, Math.min(255, r + jitter));
            buf[o + 1] = Math.max(0, Math.min(255, g + jitter));
            buf[o + 2] = Math.max(0, Math.min(255, b + jitter));
            buf[o + 3] = 255;
          }
        }
        return buf;
      };

      // All 5 colored inks on mid-tone textured backgrounds
      const coloredInks = [
        ['warm-brown', [74, 44, 29]],
        ['deep-navy', [30, 58, 95]],
        ['burgundy', [92, 29, 42]],
        ['forest-green', [31, 77, 46]],
        ['charcoal', [59, 53, 50]],
      ];
      for (const [label, [ir, ig, ib]] of coloredInks) {
        const buf = makeBg(175, 162, 140);
        const expectedStroke = new Uint8Array(lw * lh);
        for (let y = 10; y < 70; y++) {
          for (const sx of [25, 26, 54, 55]) {
            const idx = y * lw + sx;
            expectedStroke[idx] = 1;
            buf[idx * 4] = ir;
            buf[idx * 4 + 1] = ig;
            buf[idx * 4 + 2] = ib;
          }
        }
        for (let x = 10; x < 70; x++) {
          for (const sy of [25, 26, 54, 55]) {
            const idx = sy * lw + x;
            expectedStroke[idx] = 1;
            buf[idx * 4] = ir;
            buf[idx * 4 + 1] = ig;
            buf[idx * 4 + 2] = ib;
          }
        }
        const res = LineArtExtractor.extract(buf, lw, lh);
        let hits = 0;
        let expected = 0;
        let falsePositives = 0;
        for (let i = 0; i < lw * lh; i++) {
          if (expectedStroke[i] === 1) {
            expected++;
            if (res.lineMask[i] === 1) hits++;
          } else if (res.lineMask[i] === 1) {
            falsePositives++;
          }
        }
        const recall = hits / expected;
        assert.equal(res.isLineArt, true, `${label} ink strokes must be detected as line art`);
        assert.ok(recall >= 0.9, `${label} ink recall must be >= 90% (got ${(recall * 100).toFixed(1)}%)`);
        assert.equal(falsePositives, 0, `${label} ink must have 0 false positives outside strokes (got ${falsePositives})`);
      }

      // Thick dark blobs MUST produce 0 line pixels (zero outer-rim halo)
      const blobCases = [
        ['black-square', 'square', [10, 10, 10], 15],
        ['black-circle', 'circle', [10, 10, 10], 18],
        ['brown-square', 'square', [74, 44, 29], 15],
        ['navy-circle', 'circle', [30, 58, 95], 18],
        ['burgundy-square', 'square', [92, 29, 42], 10],
      ];
      for (const [label, shape, [br, bg, bb], rad] of blobCases) {
        const buf = makeBg(175, 165, 150);
        for (let y = 0; y < lh; y++) {
          for (let x = 0; x < lw; x++) {
            const dx = x - 40;
            const dy = y - 40;
            const inside = shape === 'circle' ? dx * dx + dy * dy <= rad * rad : Math.abs(dx) <= rad && Math.abs(dy) <= rad;
            if (inside) {
              const o = (y * lw + x) * 4;
              buf[o] = br;
              buf[o + 1] = bg;
              buf[o + 2] = bb;
            }
          }
        }
        const res = LineArtExtractor.extract(buf, lw, lh);
        assert.equal(res.linePixelCount, 0, `Thick ${label} must emit 0 halo pixels (got ${res.linePixelCount})`);
        assert.equal(res.isLineArt, false, `Thick ${label} must not be classified as line art`);
      }

      // Smooth gradient & noisy photo preservation (isLineArt === false)
      const photoBuf = new Uint8ClampedArray(lw * lh * 4);
      let seed = 1337;
      const nextRand = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return (seed / 4294967296) * 2 - 1;
      };
      for (let y = 0; y < lh; y++) {
        for (let x = 0; x < lw; x++) {
          const o = (y * lw + x) * 4;
          const n = Math.round(nextRand() * 25);
          photoBuf[o] = Math.max(0, Math.min(255, 90 + Math.round((x / lw) * 110) + n));
          photoBuf[o + 1] = Math.max(0, Math.min(255, 80 + Math.round((y / lh) * 100) + n));
          photoBuf[o + 2] = Math.max(0, Math.min(255, 110 + Math.round(((x + y) / (lw + lh)) * 70) + n));
          photoBuf[o + 3] = 255;
        }
      }
      const photoRes = LineArtExtractor.extract(photoBuf, lw, lh);
      assert.equal(photoRes.isLineArt, false, `Noisy gradient photo must not trigger isLineArt (ratio=${photoRes.lineRatio})`);

      // B&W paper drawing preservation
      const paperBuf = new Uint8ClampedArray(lw * lh * 4);
      for (let i = 0; i < lw * lh; i++) {
        paperBuf[i * 4] = 250;
        paperBuf[i * 4 + 1] = 250;
        paperBuf[i * 4 + 2] = 250;
        paperBuf[i * 4 + 3] = 255;
      }
      for (let y = 10; y < 70; y++) {
        for (const sx of [39, 40]) {
          const o = (y * lw + sx) * 4;
          paperBuf[o] = 20;
          paperBuf[o + 1] = 20;
          paperBuf[o + 2] = 20;
        }
      }
      const paperRes = LineArtExtractor.extract(paperBuf, lw, lh);
      assert.equal(paperRes.isLineArt, true, 'White paper drawing with dark ink must stay isLineArt=true');

      // Masked extract & masked alignBoundariesToLines
      const circleMask = new Uint8Array(lw * lh);
      const maskedInkBuf = new Uint8ClampedArray(lw * lh * 4); // exterior is [0,0,0,0]
      for (let y = 0; y < lh; y++) {
        for (let x = 0; x < lw; x++) {
          const idx = y * lw + x;
          const dx = x - 40;
          const dy = y - 40;
          if (dx * dx + dy * dy <= 28 * 28) {
            circleMask[idx] = 1;
            const onCross = (Math.abs(x - 40) <= 1 && Math.abs(y - 40) <= 20) || (Math.abs(y - 40) <= 1 && Math.abs(x - 40) <= 20);
            maskedInkBuf[idx * 4] = onCross ? 74 : 180;
            maskedInkBuf[idx * 4 + 1] = onCross ? 44 : 165;
            maskedInkBuf[idx * 4 + 2] = onCross ? 29 : 145;
            maskedInkBuf[idx * 4 + 3] = 255;
          }
        }
      }
      const maskedExtract = LineArtExtractor.extract(maskedInkBuf, lw, lh, undefined, undefined, circleMask);
      assert.equal(maskedExtract.isLineArt, true, 'Masked circular brown-ink cross must be detected as line art');
      for (let i = 0; i < lw * lh; i++) {
        if (circleMask[i] !== 1) {
          assert.equal(maskedExtract.lineMask[i], 0, 'Inactive exterior pixel must never appear in masked lineMask');
        }
      }
      const emptyLine = LineArtExtractor.extract(maskedInkBuf, lw, lh, undefined, undefined, new Uint8Array(lw * lh));
      assert.equal(emptyLine.isLineArt, false);
      assert.equal(emptyLine.linePixelCount, 0);

      // Masked alignBoundariesToLines must never mutate inactive pixels
      const wsMap = new Int32Array(16 * 16);
      const wsMask = new Uint8Array(16 * 16);
      const wsLines = new Uint8Array(16 * 16);
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const idx = y * 16 + x;
          const active = x >= 2 && x <= 13 && y >= 2 && y <= 13;
          wsMask[idx] = active ? 1 : 0;
          wsLines[idx] = x === 7 || x === 8 ? 1 : 0;
          wsMap[idx] = active ? (x < 8 ? 1 : 2) : 0;
        }
      }
      LineArtExtractor.alignBoundariesToLines(wsMap, wsLines, 16, 16, wsMask);
      for (let i = 0; i < 16 * 16; i++) {
        if (wsMask[i] !== 1) {
          assert.equal(wsMap[i], 0, `alignBoundariesToLines must never mutate inactive pixel ${i}`);
        }
      }
    }

    // 7. F10 — ColorQuantizer & ImageAnalyzer optional activeMask
    {
      const analyzerMod = await vite.ssrLoadModule('/src/engine/ImageAnalyzer.ts');
      const { ColorQuantizer } = quantizerMod;
      const { ImageAnalyzer } = analyzerMod;

      const qw = 32;
      const qh = 32;
      const qRgba = new Uint8ClampedArray(qw * qh * 4);
      const qMask = new Uint8Array(qw * qh);
      for (let y = 0; y < qh; y++) {
        for (let x = 0; x < qw; x++) {
          const idx = y * qw + x;
          const active = x >= 8 && x < 24 && y >= 8 && y < 24;
          qMask[idx] = active ? 1 : 0;
          if (active) {
            qRgba[idx * 4] = x < 16 ? 210 : 40;
            qRgba[idx * 4 + 1] = x < 16 ? 60 : 120;
            qRgba[idx * 4 + 2] = x < 16 ? 60 : 210;
            qRgba[idx * 4 + 3] = 255;
          } else {
            // Garish magenta exterior must NEVER leak into palette or filtered interior
            qRgba[idx * 4] = 255;
            qRgba[idx * 4 + 1] = 0;
            qRgba[idx * 4 + 2] = 255;
            qRgba[idx * 4 + 3] = 0;
          }
        }
      }

      const qRes = ColorQuantizer.quantize(qRgba, qw, qh, 2, 10, true, true, undefined, qMask);
      assert.equal(qRes.palette.length, 2, 'Masked 2-color interior must quantize to 2 swatches');
      for (const col of qRes.palette) {
        assert.equal(col.r > 240 && col.g < 20 && col.b > 240, false, `Garish exterior leaked into palette: ${col.hex}`);
      }
      for (let i = 0; i < qw * qh; i++) {
        if (qMask[i] === 1) assert.ok(qRes.assignments[i] >= 0, 'Active pixel must receive cluster >= 0');
        else assert.equal(qRes.assignments[i], -1, 'Inactive pixel must receive cluster -1');
      }

      // Empty mask & k=1 / 1-pixel activeMask edge cases
      const qEmpty = ColorQuantizer.quantize(qRgba, qw, qh, 4, 4, true, true, undefined, new Uint8Array(qw * qh));
      assert.equal(qEmpty.palette.length, 0);
      assert.equal(qEmpty.assignments.every((v) => v === -1), true);
      const onePxMask = new Uint8Array(qw * qh);
      onePxMask[10 * qw + 10] = 1;
      const qOne = ColorQuantizer.quantize(qRgba, qw, qh, 1, 4, true, true, undefined, onePxMask);
      assert.equal(qOne.palette.length, 1);
      assert.equal(qOne.assignments[10 * qw + 10], 0);

      // Masked Kuwahara & Median filters preserve solid interior adjacent to garish exterior
      const solidMaskRgba = new Uint8ClampedArray(qw * qh * 4);
      for (let i = 0; i < qw * qh; i++) {
        if (qMask[i] === 1) {
          solidMaskRgba[i * 4] = 80;
          solidMaskRgba[i * 4 + 1] = 140;
          solidMaskRgba[i * 4 + 2] = 90;
          solidMaskRgba[i * 4 + 3] = 255;
        } else {
          solidMaskRgba[i * 4] = 255;
          solidMaskRgba[i * 4 + 1] = 0;
          solidMaskRgba[i * 4 + 2] = 255;
          solidMaskRgba[i * 4 + 3] = 0;
        }
      }
      const kuw = ColorQuantizer.applyKuwaharaFilter(solidMaskRgba, qw, qh, 2, qMask);
      const med = ColorQuantizer.applyMedianFilter(solidMaskRgba, qw, qh, qMask);
      for (let i = 0; i < qw * qh; i++) {
        if (qMask[i] === 1) {
          assert.equal(kuw[i * 4], 80, 'Kuwahara must not bleed exterior into interior');
          assert.equal(med[i * 4], 80, 'Median must not bleed exterior into interior');
        } else {
          assert.equal(kuw[i * 4 + 3], 0, 'Kuwahara must preserve exterior alpha=0');
          assert.equal(med[i * 4 + 3], 0, 'Median must preserve exterior alpha=0');
        }
      }

      // ImageAnalyzer with small colorful patch (< 5% of total area) on black exterior
      const aw = 64;
      const ah = 64;
      const aRgba = new Uint8ClampedArray(aw * ah * 4);
      const aMask = new Uint8Array(aw * ah);
      for (let y = 26; y < 38; y++) {
        for (let x = 26; x < 38; x++) {
          const idx = y * aw + x;
          aMask[idx] = 1;
          aRgba[idx * 4] = 220;
          aRgba[idx * 4 + 1] = 50;
          aRgba[idx * 4 + 2] = 50;
          aRgba[idx * 4 + 3] = 255;
        }
      }
      const aRes = ImageAnalyzer.analyze({ width: aw, height: ah, data: aRgba }, aMask);
      assert.equal(aRes.isBlackAndWhite, false, 'Small colorful masked patch (<5% area) must NOT be classified as B&W');
      assert.equal(aRes.edgeRatio, 0, 'Smooth interior masked patch must have 0 edgeRatio (no mask-boundary Sobel spike)');
      const aEmpty = ImageAnalyzer.analyze({ width: aw, height: ah, data: aRgba }, new Uint8Array(aw * ah));
      assert.equal(Number.isFinite(aEmpty.edgeRatio) && Number.isFinite(aEmpty.globalVariance), true);
    }

    // 8. F12 — 96-swatch .capy v2 single & archive round-trip + MAX_GENERATOR_CONFIG.colorCount=64 parity
    {
      const typesMod = await vite.ssrLoadModule('/src/types/index.ts');
      assert.equal(
        typesMod.MAX_GENERATOR_CONFIG.colorCount,
        64,
        'MAX_GENERATOR_CONFIG.colorCount MUST stay 64 for Daily Puzzle parity'
      );

      const palette96 = Array.from({ length: 96 }, (_, idx) => {
        const r = (idx * 29 + 17) % 256;
        const g = (idx * 53 + 41) % 256;
        const b = (idx * 89 + 73) % 256;
        const hex = `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1).toUpperCase()}`;
        return {
          id: idx + 1,
          hex,
          isLight: 0.299 * r + 0.587 * g + 0.114 * b > 140,
          argb: ((0xff << 24) | (r << 16) | (g << 8) | b) >>> 0,
          r,
          g,
          b,
        };
      });
      // Root grid: 64x16 with 64 regions referencing colorIds 1..64
      const rw = 64;
      const rh = 16;
      const rMap = new Int32Array(rw * rh);
      const rootRegions = [];
      for (let i = 0; i < 64; i++) {
        const x = i;
        const pixels = new Int32Array(rh);
        for (let y = 0; y < rh; y++) {
          const idx = y * rw + x;
          rMap[idx] = i + 1;
          pixels[y] = idx;
        }
        rootRegions.push({
          id: i + 1,
          colorId: i + 1,
          centroidX: x + 0.5,
          centroidY: 8.5,
          area: rh,
          minX: x,
          maxX: x,
          minY: 0,
          maxY: rh - 1,
          maxRadius: 1,
          pixels,
        });
      }
      // Nested layer: 32x16 with 32 regions referencing extended colorIds 65..96
      const nw = 32;
      const nh = 16;
      const nMap = new Int32Array(nw * nh);
      const nestedRegions = [];
      for (let i = 0; i < 32; i++) {
        const x = i;
        const pixels = new Int32Array(nh);
        for (let y = 0; y < nh; y++) {
          const idx = y * nw + x;
          nMap[idx] = 65 + i;
          pixels[y] = idx;
        }
        nestedRegions.push({
          id: 65 + i,
          colorId: 65 + i,
          centroidX: x + 0.5,
          centroidY: 8.5,
          area: nh,
          minX: x,
          maxX: x,
          minY: 0,
          maxY: nh - 1,
          maxRadius: 1,
          pixels,
        });
      }
      const puzzle96 = {
        width: rw,
        height: rh,
        palette: palette96,
        regions: rootRegions,
        regionMap: rMap,
        borderMap: codec.buildBorderMapFromRegionMap(rMap, rw, rh),
        isFreeColor: false,
        maxZoomDepth: 1,
        nestedLayers: [
          {
            layerId: 'layer_96_swatches',
            depth: 1,
            worldBounds: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
            width: nw,
            height: nh,
            regions: nestedRegions,
            regionMap: nMap,
            borderMap: codec.buildBorderMapFromRegionMap(nMap, nw, nh),
            imageBlobKey: 'layer_img_96_swatches',
          },
        ],
      };

      const compact96 = codec.compressPuzzleRecord(puzzle96);
      const restored96 = codec.decompressPuzzleRecord(compact96);
      assert.equal(restored96.palette.length, 96, 'decompressPuzzleRecord must preserve all 96 swatches');
      assert.equal(restored96.nestedLayers?.length, 1, 'decompressPuzzleRecord must preserve nested layer');
      assert.deepEqual(restored96.regionMap, puzzle96.regionMap);
      assert.deepEqual(restored96.borderMap, puzzle96.borderMap);
      assert.deepEqual(restored96.nestedLayers[0].regionMap, nMap);
      assert.deepEqual(restored96.nestedLayers[0].borderMap, puzzle96.nestedLayers[0].borderMap);
      assert.deepEqual(
        restored96.nestedLayers[0].regions.map((r) => r.colorId),
        Array.from({ length: 32 }, (_, i) => 65 + i),
        'Nested layer colorIds 65..96 must round-trip bit-exactly'
      );

      const snap96 = {
        ...sampleSnapshot,
        id: 'snap-96-test',
        totalCount: 96,
        sourceRef: { kind: 'blob', uri: 'snap-96-test' },
      };
      const layerBlob96 = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/webp' });
      const binSingle96 = await codec.encodeSingleSaveBinaryV2(
        snap96,
        compact96,
        fakeImageBlob,
        { exportDate: fixedExportDate, layerImages: { layer_img_96_swatches: layerBlob96 } }
      );
      assert.equal(codec.hasBinaryMagicHeader(binSingle96), true, '96-swatch .capy must keep CAPY\\x02 v2 header');
      const decSingle96 = await codec.decodeBinarySaveV2(binSingle96);
      const decPuzzle96 = codec.decompressPuzzleRecord(
        codec.serializableToRecord(decSingle96.compactPuzzle)
      );
      assert.equal(decPuzzle96.palette.length, 96);
      assert.equal(decPuzzle96.nestedLayers[0].regions[31].colorId, 96);

      const binArch96 = await codec.encodeArchiveSaveBinaryV2(
        [snap96],
        { 'snap-96-test': compact96 },
        { 'snap-96-test': fakeImageBlob },
        { exportDate: fixedExportDate, layerImages: { layer_img_96_swatches: layerBlob96 } }
      );
      const decArch96 = await codec.decodeBinarySaveV2(binArch96);
      const decArchPuzzle96 = codec.decompressPuzzleRecord(
        codec.serializableToRecord(decArch96.compactPuzzles['snap-96-test'])
      );
      assert.equal(decArchPuzzle96.palette.length, 96);
      assert.equal(decArchPuzzle96.nestedLayers[0].regions[0].colorId, 65);
    }

    shared.puzzleData = puzzleData;
    logUnitPass('ColorQuantizer, RegionSegmenter activeMask, LineArtExtractor colored-ink ridges & CapyCodec v2 96-swatch/DoS hardening verified.');
}
