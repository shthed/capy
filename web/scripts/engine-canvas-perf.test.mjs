import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

export async function runEngineCanvasPerfTests(vite) {
  const segmenterMod = await vite.ssrLoadModule('/src/engine/RegionSegmenter.ts');
  const quantizerMod = await vite.ssrLoadModule('/src/engine/ColorQuantizer.ts');
  const lineArtMod = await vite.ssrLoadModule('/src/engine/LineArtExtractor.ts');
  const workerMod = await vite.ssrLoadModule('/src/engine/puzzle.worker.ts');
  const workerSvcMod = await vite.ssrLoadModule('/src/services/PuzzleWorkerService.ts');
  const serializerMod = await vite.ssrLoadModule('/src/services/storage/PuzzleSerializer.ts');

  const { RegionSegmenter } = segmenterMod;
  const { ColorQuantizer } = quantizerMod;
  const { LineArtExtractor } = lineArtMod;
  const { packPuzzleForTransfer } = workerMod;
  const { unpackPuzzleFromWorker } = workerSvcMod;
  const { serializePuzzle, deserializePuzzle } = serializerMod;

  // -------------------------------------------------------------------------
  // 1. RegionSegmenter: Reusable distGrid + bfsQueue (no per-region Map) & determinism
  // -------------------------------------------------------------------------
  {
    const segSrc = fs.readFileSync(
      path.join(projectRoot, 'src/engine/RegionSegmenter.ts'),
      'utf8'
    );
    assert.equal(
      segSrc.includes('idxToPos'),
      false,
      'RegionSegmenter.ts must not allocate per-region idxToPos Map'
    );
    assert.equal(
      /const\s+distGrid\s*=\s*new\s+Int32Array\(total\)/.test(segSrc),
      true,
      'RegionSegmenter.ts must allocate one reusable Int32Array(total) distGrid outside region loop'
    );
    assert.equal(
      /const\s+bfsQueue\s*=\s*new\s+Int32Array\(total\)/.test(segSrc),
      true,
      'RegionSegmenter.ts must allocate one reusable Int32Array(total) bfsQueue outside region loop'
    );

    // Build a deterministic 48x48 multi-region cluster grid:
    // - Cluster 0: large background surrounding everything
    // - Cluster 1: 18x18 interior square at x=[6..23], y=[6..23]
    // - Cluster 2: L-shaped region at x=[28..42], y=[10..38]
    const width = 48;
    const height = 48;
    const total = width * height;
    const clusters = new Int32Array(total);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (x >= 6 && x <= 23 && y >= 6 && y <= 23) {
          clusters[idx] = 1;
        } else if (
          (x >= 28 && x <= 34 && y >= 10 && y <= 38) ||
          (x >= 28 && x <= 42 && y >= 32 && y <= 38)
        ) {
          clusters[idx] = 2;
        } else {
          clusters[idx] = 0;
        }
      }
    }
    const palette = [
      { id: 1, r: 240, g: 240, b: 240, hex: '#f0f0f0' },
      { id: 2, r: 220, g: 60, b: 60, hex: '#dc3c3c' },
      { id: 3, r: 40, g: 120, b: 220, hex: '#2878dc' },
    ];

    const runA = RegionSegmenter.segment(width, height, palette, clusters, 4);
    const runB = RegionSegmenter.segment(width, height, palette, clusters, 4);

    assert.equal(runA.regions.length, 3, 'Expected 3 segmented regions');
    assert.equal(runB.regions.length, runA.regions.length);

    for (let i = 0; i < runA.regions.length; i++) {
      const a = runA.regions[i];
      const b = runB.regions[i];
      assert.equal(a.id, b.id, `Region ${i} id must be deterministic`);
      assert.equal(a.centroidX, b.centroidX, `Region ${i} centroidX must be deterministic`);
      assert.equal(a.centroidY, b.centroidY, `Region ${i} centroidY must be deterministic`);
      assert.equal(a.maxRadius, b.maxRadius, `Region ${i} maxRadius must be deterministic`);
      assert.deepEqual(Array.from(a.pixels), Array.from(b.pixels));

      // Pole-of-inaccessibility centroid must lie strictly inside its own region
      const cx = Math.floor(a.centroidX);
      const cy = Math.floor(a.centroidY);
      assert.equal(
        runA.regionMap[cy * width + cx],
        a.id,
        `Region ${a.id} centroid (${cx}, ${cy}) must lie inside its own region`
      );
    }

    // The 18x18 interior square (colorId 2) must have maxRadius >= 8 and centroid near center (14.5, 14.5)
    const squareReg = runA.regions.find((r) => r.colorId === 2);
    assert.ok(squareReg, 'Expected 18x18 square region');
    assert.equal(squareReg.area, 18 * 18);
    assert.equal(
      squareReg.maxRadius >= 8 && squareReg.maxRadius <= 10,
      true,
      `Expected 18x18 square maxRadius in [8..10], got ${squareReg.maxRadius}`
    );
    assert.equal(
      Math.abs(squareReg.centroidX - 14.5) <= 2 && Math.abs(squareReg.centroidY - 14.5) <= 2,
      true,
      `Expected 18x18 square centroid near (14.5, 14.5), got (${squareReg.centroidX}, ${squareReg.centroidY})`
    );
  }

  // -------------------------------------------------------------------------
  // 2. ColorQuantizer: K-Means++ minDistances initialized against ALL pre-seeded centroids
  // -------------------------------------------------------------------------
  {
    const quantSrc = fs.readFileSync(
      path.join(projectRoot, 'src/engine/ColorQuantizer.ts'),
      'utf8'
    );
    assert.equal(
      /for\s*\(\s*let\s+c\s*=\s*0\s*;\s*c\s*<\s*effectiveK\s*-\s*1\s*;\s*c\+\+\s*\)/.test(quantSrc),
      true,
      'ColorQuantizer.ts must initialize minDistances against all pre-seeded centroids 0..effectiveK-2'
    );

    // Construct a 32x32 image with 6 large prominent color blocks (seeded into centroid[0..5])
    // plus 2 smaller distinct color blocks (must be picked by K-Means++ when targetColors = 8).
    const width = 32;
    const height = 32;
    const rgba = new Uint8ClampedArray(width * height * 4);
    const prominentColors = [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 255, 0],
      [255, 0, 255],
      [0, 255, 255],
    ];
    const rareColors = [
      [250, 128, 20],
      [20, 20, 20],
    ];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let rgb;
        if (y >= 28 && x < 16) {
          rgb = rareColors[0];
        } else if (y >= 28 && x >= 16) {
          rgb = rareColors[1];
        } else {
          const band = Math.min(5, Math.floor((x / width) * 6));
          rgb = prominentColors[band];
        }
        const p = (y * width + x) * 4;
        rgba[p] = rgb[0];
        rgba[p + 1] = rgb[1];
        rgba[p + 2] = rgb[2];
        rgba[p + 3] = 255;
      }
    }

    const q1 = ColorQuantizer.quantize(rgba, width, height, 8, 14, false);
    const q2 = ColorQuantizer.quantize(rgba, width, height, 8, 14, false);

    assert.equal(q1.palette.length, 8, 'Expected all 8 distinct colors in quantized palette');
    assert.deepEqual(q1.palette, q2.palette, 'ColorQuantizer must remain 100% deterministic');
    assert.deepEqual(Array.from(q1.assignments), Array.from(q2.assignments));

    // Verify every single one of the 8 true colors (including both rare colors) is matched closely
    const allExpected = [...prominentColors, ...rareColors];
    for (const [er, eg, eb] of allExpected) {
      const closest = q1.palette.reduce((best, c) => {
        const d = Math.hypot(c.r - er, c.g - eg, c.b - eb);
        return Math.min(best, d);
      }, Infinity);
      assert.equal(
        closest < 35,
        true,
        `Expected color rgb(${er},${eg},${eb}) to be represented in palette (closest dist=${closest.toFixed(1)})`
      );
    }
  }

  // -------------------------------------------------------------------------
  // 3. LineArtExtractor: Pass-2 watershed medial-axis symmetry (horizontal & vertical)
  // -------------------------------------------------------------------------
  {
    // 3a. Vertical 2-pixel-wide multi-touch boundary between Region 1 (left) and Region 2 (right):
    // Row 0 & Row 5 provide opposite-region vertical touch so Pass 1 marks both x=4 and x=5 as
    // multiTouchLine=1 / regionMap=-1. In Pass 2, x=4 touches Region 1 on the left and x=5 touches
    // Region 2 on the right. Without buffering, x=4 mutates regionMap in-place and x=5 reads x=4=1!
    const w = 10;
    const h = 6;
    const vertRegionMap = new Int32Array(w * h);
    const vertLineMask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (x < 4) {
          vertRegionMap[idx] = 1;
        } else if (x > 5) {
          vertRegionMap[idx] = 2;
        } else {
          vertLineMask[idx] = 1;
          // Assign alternating seeds so Pass 1 detects multi-touch on both x=4 and x=5
          vertRegionMap[idx] = x === 4 ? 2 : 1;
        }
      }
    }
    // Add top/bottom region borders so both x=4 and x=5 touch both regions in Pass 1
    for (let x = 4; x <= 5; x++) {
      vertLineMask[x] = 0;
      vertRegionMap[x] = x === 4 ? 2 : 1;
      vertLineMask[(h - 1) * w + x] = 0;
      vertRegionMap[(h - 1) * w + x] = x === 4 ? 2 : 1;
    }

    LineArtExtractor.alignBoundariesToLines(vertRegionMap, vertLineMask, w, h);
    // For interior rows (y = 2, 3), x=4 must belong to Region 1 and x=5 must belong to Region 2!
    for (const y of [2, 3]) {
      assert.equal(
        vertRegionMap[y * w + 4],
        1,
        `Vertical medial-axis symmetry failed at (4, ${y}): expected 1, got ${vertRegionMap[y * w + 4]}`
      );
      assert.equal(
        vertRegionMap[y * w + 5],
        2,
        `Vertical medial-axis symmetry failed at (5, ${y}): expected 2, got ${vertRegionMap[y * w + 5]}`
      );
    }

    // 3b. Horizontal 2-pixel-wide multi-touch boundary between Region 1 (top) and Region 2 (bottom):
    const hw = 6;
    const hh = 10;
    const horizRegionMap = new Int32Array(hw * hh);
    const horizLineMask = new Uint8Array(hw * hh);
    for (let y = 0; y < hh; y++) {
      for (let x = 0; x < hw; x++) {
        const idx = y * hw + x;
        if (y < 4) {
          horizRegionMap[idx] = 1;
        } else if (y > 5) {
          horizRegionMap[idx] = 2;
        } else {
          horizLineMask[idx] = 1;
          horizRegionMap[idx] = y === 4 ? 2 : 1;
        }
      }
    }
    for (let y = 4; y <= 5; y++) {
      horizLineMask[y * hw] = 0;
      horizRegionMap[y * hw] = y === 4 ? 2 : 1;
      horizLineMask[y * hw + (hw - 1)] = 0;
      horizRegionMap[y * hw + (hw - 1)] = y === 4 ? 2 : 1;
    }

    LineArtExtractor.alignBoundariesToLines(horizRegionMap, horizLineMask, hw, hh);
    for (const x of [2, 3]) {
      assert.equal(
        horizRegionMap[4 * hw + x],
        1,
        `Horizontal medial-axis symmetry failed at (${x}, 4): expected 1, got ${horizRegionMap[4 * hw + x]}`
      );
      assert.equal(
        horizRegionMap[5 * hw + x],
        2,
        `Horizontal medial-axis symmetry failed at (${x}, 5): expected 2, got ${horizRegionMap[5 * hw + x]}`
      );
    }

    // 3c. Strict H-mirror, V-mirror, and 180-degree rotation symmetry across 2px, 3px, and 4px
    // vertical lines, horizontal lines, and 4-quadrant crosses (guards Pass-1 mutation & Pass-2
    // interior-line tie-break regressions).
    const transformGrid = (grid, gw, gh, mode, remap) => {
      const out = new grid.constructor(gw * gh);
      for (let y = 0; y < gh; y++) {
        for (let x = 0; x < gw; x++) {
          const sx = mode === 'h' || mode === 'rot180' ? gw - 1 - x : x;
          const sy = mode === 'v' || mode === 'rot180' ? gh - 1 - y : y;
          const v = grid[sy * gw + sx];
          out[y * gw + x] = remap ? (remap[v] ?? v) : v;
        }
      }
      return out;
    };

    const assertSymmetry = (label, baseRegionMap, baseLineMask, gw, gh, remaps) => {
      const origOut = new Int32Array(baseRegionMap);
      LineArtExtractor.alignBoundariesToLines(origOut, baseLineMask, gw, gh);

      for (const mode of ['h', 'v', 'rot180']) {
        const remap = remaps[mode];
        const tRegion = transformGrid(baseRegionMap, gw, gh, mode, remap);
        const tMask = transformGrid(baseLineMask, gw, gh, mode, null);
        LineArtExtractor.alignBoundariesToLines(tRegion, tMask, gw, gh);

        const expected = transformGrid(origOut, gw, gh, mode, remap);
        let diffs = 0;
        for (let i = 0; i < origOut.length; i++) {
          if (tRegion[i] !== expected[i]) diffs++;
        }
        assert.equal(
          diffs,
          0,
          `LineArtExtractor ${label} failed ${mode} symmetry with ${diffs} differing pixels`
        );
      }
    };

    for (const thickness of [2, 3, 4]) {
      // Vertical line (R3) separating R1 (left) and R2 (right)
      const vw = 12 + thickness;
      const vh = 12;
      const vReg = new Int32Array(vw * vh);
      const vMask = new Uint8Array(vw * vh);
      const xStart = 6;
      const xEnd = 6 + thickness - 1;
      for (let y = 0; y < vh; y++) {
        for (let x = 0; x < vw; x++) {
          const idx = y * vw + x;
          if (x < xStart) {
            vReg[idx] = 1;
          } else if (x > xEnd) {
            vReg[idx] = 2;
          } else {
            vReg[idx] = 3;
            vMask[idx] = 1;
          }
        }
      }
      assertSymmetry(`vertical_${thickness}px`, vReg, vMask, vw, vh, {
        h: { 1: 2, 2: 1, 3: 3 },
        v: { 1: 1, 2: 2, 3: 3 },
        rot180: { 1: 2, 2: 1, 3: 3 },
      });

      // Horizontal line (R3) separating R1 (top) and R2 (bottom)
      const hw2 = 12;
      const hh2 = 12 + thickness;
      const hReg = new Int32Array(hw2 * hh2);
      const hMask = new Uint8Array(hw2 * hh2);
      const yStart = 6;
      const yEnd = 6 + thickness - 1;
      for (let y = 0; y < hh2; y++) {
        for (let x = 0; x < hw2; x++) {
          const idx = y * hw2 + x;
          if (y < yStart) {
            hReg[idx] = 1;
          } else if (y > yEnd) {
            hReg[idx] = 2;
          } else {
            hReg[idx] = 3;
            hMask[idx] = 1;
          }
        }
      }
      assertSymmetry(`horizontal_${thickness}px`, hReg, hMask, hw2, hh2, {
        h: { 1: 1, 2: 2, 3: 3 },
        v: { 1: 2, 2: 1, 3: 3 },
        rot180: { 1: 2, 2: 1, 3: 3 },
      });

      // 4-quadrant cross (R5) separating R1 (TL), R2 (TR), R3 (BL), R4 (BR)
      const cw = 12 + thickness;
      const ch = 12 + thickness;
      const cReg = new Int32Array(cw * ch);
      const cMask = new Uint8Array(cw * ch);
      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          const idx = y * cw + x;
          const inX = x >= 6 && x < 6 + thickness;
          const inY = y >= 6 && y < 6 + thickness;
          if (inX || inY) {
            cReg[idx] = 5;
            cMask[idx] = 1;
          } else if (y < 6 && x < 6) {
            cReg[idx] = 1;
          } else if (y < 6 && x >= 6 + thickness) {
            cReg[idx] = 2;
          } else if (y >= 6 + thickness && x < 6) {
            cReg[idx] = 3;
          } else {
            cReg[idx] = 4;
          }
        }
      }
      assertSymmetry(`cross_${thickness}px`, cReg, cMask, cw, ch, {
        h: { 1: 2, 2: 1, 3: 4, 4: 3, 5: 5 },
        v: { 1: 3, 2: 4, 3: 1, 4: 2, 5: 5 },
        rot180: { 1: 4, 2: 3, 3: 2, 4: 1, 5: 5 },
      });
    }
  }

  // -------------------------------------------------------------------------
  // 4. Packed transferable worker buffers (puzzle.worker.ts + PuzzleWorkerService.ts)
  // -------------------------------------------------------------------------
  {
    const width = 50;
    const height = 10;
    const total = width * height;
    const regionMap = new Int32Array(total);
    const borderMap = new Uint8Array(total);
    const regions = [];

    // 50 distinct vertical-strip regions (10 pixels each)
    for (let r = 1; r <= 50; r++) {
      const pixels = new Int32Array(height);
      for (let y = 0; y < height; y++) {
        const idx = y * width + (r - 1);
        regionMap[idx] = r;
        pixels[y] = idx;
      }
      regions.push({
        id: r,
        colorId: ((r - 1) % 4) + 1,
        centroidX: r - 0.5,
        centroidY: 5,
        area: height,
        minX: r - 1,
        maxX: r - 1,
        minY: 0,
        maxY: height - 1,
        maxRadius: 1,
        pixels,
      });
    }

    const originalPuzzle = {
      width,
      height,
      palette: [
        { id: 1, r: 220, g: 50, b: 50, hex: '#dc3232' },
        { id: 2, r: 50, g: 220, b: 50, hex: '#32dc32' },
        { id: 3, r: 50, g: 50, b: 220, hex: '#3232dc' },
        { id: 4, r: 220, g: 220, b: 50, hex: '#dcdc32' },
      ],
      regions,
      regionMap,
      borderMap,
      isFreeColor: false,
    };

    const { payload, transferList } = packPuzzleForTransfer(originalPuzzle);
    assert.equal(
      transferList.length,
      3,
      `Expected exactly 3 Transferables (regionMap, borderMap, packedPixelsBuffer), got ${transferList.length}`
    );
    assert.equal(
      payload.packedPixelsBuffer instanceof ArrayBuffer,
      true,
      'packedPixelsBuffer must be an ArrayBuffer'
    );
    assert.equal(
      payload.packedPixelsBuffer.byteLength,
      total * Int32Array.BYTES_PER_ELEMENT,
      'packedPixelsBuffer byteLength must match total packed region pixels'
    );

    const unpacked = unpackPuzzleFromWorker(payload);
    assert.equal(unpacked.regions.length, 50);
    assert.deepEqual(Array.from(unpacked.regionMap), Array.from(regionMap));
    assert.deepEqual(Array.from(unpacked.borderMap), Array.from(borderMap));

    for (let i = 0; i < 50; i++) {
      const orig = originalPuzzle.regions[i];
      const rec = unpacked.regions[i];
      assert.equal(rec.id, orig.id);
      assert.equal(rec.colorId, orig.colorId);
      assert.equal(
        rec.pixels.buffer,
        payload.packedPixelsBuffer,
        'Unpacked region.pixels must be a zero-copy subarray view over packedPixelsBuffer'
      );
      assert.equal(rec.pixels.byteOffset, i * height * Int32Array.BYTES_PER_ELEMENT);
      assert.equal(rec.pixels.byteLength, height * Int32Array.BYTES_PER_ELEMENT);
      assert.deepEqual(Array.from(rec.pixels), Array.from(orig.pixels));
    }

    // Verify subarray views serialize & deserialize cleanly in BOTH v1 (pixelsB64) and v2 (RLE) modes
    const serializedV1 = serializePuzzle(unpacked, false);
    const roundTrippedV1 = deserializePuzzle(serializedV1);
    assert.equal(roundTrippedV1.regions.length, 50);
    for (let i = 0; i < 50; i++) {
      assert.deepEqual(
        Array.from(roundTrippedV1.regions[i].pixels),
        Array.from(originalPuzzle.regions[i].pixels),
        `v1 PuzzleSerializer corrupted subarray region ${i + 1}`
      );
    }

    const serializedV2 = serializePuzzle(unpacked, true);
    const roundTrippedV2 = deserializePuzzle(serializedV2);
    assert.equal(roundTrippedV2.regions.length, 50);
    for (let i = 0; i < 50; i++) {
      assert.deepEqual(
        Array.from(roundTrippedV2.regions[i].pixels),
        Array.from(originalPuzzle.regions[i].pixels),
        `v2 PuzzleSerializer corrupted subarray region ${i + 1}`
      );
    }
  }

  // -------------------------------------------------------------------------
  // 5. PuzzleCanvas.tsx hot-path & gesture invariants
  // -------------------------------------------------------------------------
  {
    const canvasSrc = fs.readFileSync(
      path.join(projectRoot, 'src/components/PuzzleCanvas.tsx'),
      'utf8'
    );

    // 5a. tapDot moved out of React useState + setInterval into useRef + rAF
    assert.equal(
      canvasSrc.includes('setTapDot'),
      false,
      'PuzzleCanvas.tsx must not use React setTapDot state'
    );
    assert.equal(
      canvasSrc.includes('setInterval'),
      false,
      'PuzzleCanvas.tsx must not use setInterval for tapDot decay'
    );
    assert.equal(
      canvasSrc.includes('tapDotRef') && canvasSrc.includes('tapDotRafIdRef'),
      true,
      'PuzzleCanvas.tsx must drive tapDot via tapDotRef and tapDotRafIdRef'
    );

    // Verify tapDot is NOT in drawCompositeFrame dependency array
    const drawDepsMatch = /drawCompositeFrame\s*=\s*useCallback\([\s\S]*?\n\s*\[([\s\S]*?)\]\s*\);/.exec(
      canvasSrc
    );
    assert.ok(drawDepsMatch, 'Expected drawCompositeFrame useCallback dependency array');
    assert.equal(
      /\btapDot\b/.test(drawDepsMatch[1]),
      false,
      'drawCompositeFrame deps must not include tapDot'
    );

    // 5b. highlightImageDataRef reused and cleared via fill(0)
    assert.equal(
      canvasSrc.includes('highlightImageDataRef.current = imgData') &&
        canvasSrc.includes('imgData.data.fill(0)'),
      true,
      'PuzzleCanvas.tsx must reuse highlightImageDataRef and clear via fill(0)'
    );

    // 5c. Native { passive: false } wheel listener instead of React JSX onWheel
    assert.equal(
      /addEventListener\(\s*['"]wheel['"]\s*,\s*\w+\s*,\s*\{\s*passive:\s*false\s*\}\s*\)/.test(
        canvasSrc
      ),
      true,
      'PuzzleCanvas.tsx must attach native wheel listener with { passive: false }'
    );
    assert.equal(
      canvasSrc.includes('onWheel={handleWheel}'),
      false,
      'PuzzleCanvas.tsx must not use passive React JSX onWheel={handleWheel}'
    );

    // 5d. handlePointerCancel resets isDoubleTapPanningRef.current = false
    const cancelMatch = /const\s+handlePointerCancel\s*=\s*\([\s\S]*?\n\s*\};/.exec(canvasSrc);
    assert.ok(cancelMatch, 'Expected handlePointerCancel handler');
    assert.equal(
      cancelMatch[0].includes('isDoubleTapPanningRef.current = false'),
      true,
      'handlePointerCancel must reset isDoubleTapPanningRef.current = false'
    );

    // 5e. screenToCanvasCoords uses getCachedCanvasRect() instead of canvas.getBoundingClientRect()
    const coordsMatch = /const\s+screenToCanvasCoords\s*=\s*useCallback\([\s\S]*?\n\s*\);/.exec(
      canvasSrc
    );
    assert.ok(coordsMatch, 'Expected screenToCanvasCoords callback');
    assert.equal(
      coordsMatch[0].includes('getCachedCanvasRect()'),
      true,
      'screenToCanvasCoords must call getCachedCanvasRect()'
    );
    assert.equal(
      coordsMatch[0].includes('getBoundingClientRect()'),
      false,
      'screenToCanvasCoords must not call getBoundingClientRect() directly'
    );
  }
}
