/**
 * [Unit 04] SoundService, zoom detents, DailyPuzzleService, PlayerStatsService & SvgPrintExporter.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export async function runServicesGameplayTests({ vite, projectRoot, logUnitStart, logUnitPass, shared }) {
    const { puzzleData } = shared;
    const codec = await vite.ssrLoadModule('/src/services/CapyCodec.ts');
    logUnitStart('Testing SoundService, zoom detents, DailyPuzzleService, PlayerStatsService & SvgPrintExporter...');
    const soundMod = await vite.ssrLoadModule('/src/services/SoundService.ts');
    const canvasMod = await vite.ssrLoadModule('/src/components/PuzzleCanvas.tsx');

    assert.deepEqual(soundMod.SoundService.getConfig(), { enabled: true, volume: 0.7 });
    assert.equal(
      soundMod.SoundService.playRegionTap(1, 1000),
      false,
      'SoundService.playRegionTap must return false safely without AudioContext in Node SSR'
    );
    await soundMod.SoundService.suspend();

    soundMod.SoundService.configure({ enabled: false, volume: 2.5 });
    assert.deepEqual(soundMod.SoundService.getConfig(), { enabled: false, volume: 1.0 });
    soundMod.SoundService.configure({ enabled: true, volume: -0.5 });
    assert.deepEqual(soundMod.SoundService.getConfig(), { enabled: true, volume: 0.0 });
    assert.equal(
      soundMod.SoundService.playRegionTap(1, 1100),
      false,
      'SoundService must skip synthesis when volume is 0'
    );

    const prevAudioCtx = globalThis.AudioContext;
    let mockOscCount = 0;
    let mockSuspendCount = 0;
    class MockAudioContext {
      constructor() {
        this.state = 'running';
        this.currentTime = 0;
        this.destination = {};
      }
      async resume() {
        this.state = 'running';
      }
      async suspend() {
        mockSuspendCount += 1;
        this.state = 'suspended';
      }
      async close() {
        this.state = 'closed';
      }
      createOscillator() {
        mockOscCount += 1;
        return {
          type: 'triangle',
          frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
          connect() {},
          disconnect() {},
          start() {},
          stop() {},
          onended: null,
        };
      }
      createBiquadFilter() {
        return {
          type: 'lowpass',
          frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
          Q: { setValueAtTime() {} },
          connect() {},
          disconnect() {},
        };
      }
      createGain() {
        return {
          gain: {
            setValueAtTime() {},
            linearRampToValueAtTime() {},
            exponentialRampToValueAtTime() {},
          },
          connect() {},
          disconnect() {},
        };
      }
    }

    try {
      globalThis.AudioContext = MockAudioContext;
      soundMod.SoundService.disposeForTesting();
      soundMod.SoundService.configure({ enabled: true, volume: 0.8 });
      assert.equal(soundMod.SoundService.playRegionTap(1, 2000), true, 'First tap should synthesize');
      assert.equal(mockOscCount, 1);
      assert.equal(
        soundMod.SoundService.playRegionTap(2, 2000 + soundMod.MIN_TAP_INTERVAL_MS - 5),
        false,
        'Rapid Paint Mode tap within MIN_TAP_INTERVAL_MS must be throttled'
      );
      assert.equal(mockOscCount, 1);
      assert.equal(
        soundMod.SoundService.playRegionTap(2, 2000 + soundMod.MIN_TAP_INTERVAL_MS + 1),
        true,
        'Tap after MIN_TAP_INTERVAL_MS window must synthesize cleanly'
      );
      assert.equal(mockOscCount, 2);

      soundMod.SoundService.configure({ enabled: false });
      assert.equal(mockSuspendCount >= 1, true, 'Disabling sound must immediately suspend AudioContext');
      assert.equal(soundMod.SoundService.playRegionTap(3, 3000), false);
    } finally {
      soundMod.SoundService.disposeForTesting();
      soundMod.SoundService.configure({ enabled: true, volume: 0.7 });
      if (prevAudioCtx === undefined) {
        delete globalThis.AudioContext;
      } else {
        globalThis.AudioContext = prevAudioCtx;
      }
    }

    // 7. Magnetic zoom detents (+-4%) & HUD zoom-stop cycle [1, 2, 4, 8, 12]
    assert.equal(canvasMod.applyZoomSnapDetent(1.95, true), 2, 'Within +-4% of 2x should snap to 2');
    assert.equal(canvasMod.applyZoomSnapDetent(1.89, true), 1.89, 'Outside +-4% of 2x should not snap');
    assert.equal(canvasMod.applyZoomSnapDetent(1.95, false), 1.95, 'Disabled snapZoomLevels must be identity');
    assert.equal(canvasMod.getNextZoomStop(1), 2);
    assert.equal(canvasMod.getNextZoomStop(2), 4);
    assert.equal(canvasMod.getNextZoomStop(4), 8);
    assert.equal(canvasMod.getNextZoomStop(8), 12);
    assert.equal(canvasMod.getNextZoomStop(12), 1);

    // 7b. US-3.5 Fat-Finger Mode: resolveNearTapRegionId zero-allocation radial hit-testing
    {
      const width = 128;
      const height = 128;
      const regionMap = new Int32Array(width * height);
      const setRect = (x0, y0, x1, y1, id) => {
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            regionMap[y * width + x] = id;
          }
        }
      };
      // Micro-region 1 (colorId 1 = active) at (20..21, 20..21)
      setRect(20, 20, 21, 21, 1);
      // Micro-region 2 (colorId 2 = non-active) at (26..27, 20..21)
      setRect(26, 20, 27, 21, 2);
      // Filled region 3 (colorId 1) at (50..53, 50..53) next to unfilled micro-region 4 (colorId 2) at (55..56, 50..51)
      setRect(50, 50, 53, 53, 3);
      setRect(55, 50, 56, 51, 4);
      // Isolated micro-region 5 (colorId 2 = non-active) at (80..81, 80..81), far from active regions
      setRect(80, 80, 81, 81, 5);

      const regionById = new Map([
        [1, { id: 1, colorId: 1, pixelCount: 4, centroidX: 20, centroidY: 20, maxRadius: 1 }],
        [2, { id: 2, colorId: 2, pixelCount: 4, centroidX: 26, centroidY: 20, maxRadius: 1 }],
        [3, { id: 3, colorId: 1, pixelCount: 16, centroidX: 51, centroidY: 51, maxRadius: 2 }],
        [4, { id: 4, colorId: 2, pixelCount: 4, centroidX: 55, centroidY: 50, maxRadius: 1 }],
        [5, { id: 5, colorId: 2, pixelCount: 4, centroidX: 80, centroidY: 80, maxRadius: 1 }],
      ]);
      const filledRegionIds = new Set([3]);
      const baseParams = {
        width,
        height,
        regionMap,
        regionById,
        filledRegionIds,
        activeColorId: 1,
        touchReachRadiusPx: 22,
        totalScreenScale: 1,
        isFreeColorMode: false,
      };

      // Direct O(1) hit works even when fatFingerAssist is false
      assert.equal(
        canvasMod.resolveNearTapRegionId({
          ...baseParams,
          canvasX: 20.5,
          canvasY: 20.5,
          difficulty: 'NORMAL',
          fatFingerAssist: false,
        }),
        1,
        'Direct O(1) hit on unfilled active region must succeed with fatFingerAssist=false'
      );

      // Near-miss with fatFingerAssist=false must return 0
      assert.equal(
        canvasMod.resolveNearTapRegionId({
          ...baseParams,
          canvasX: 17.5,
          canvasY: 20.5,
          difficulty: 'EASY',
          fatFingerAssist: false,
        }),
        0,
        'Near-miss on border with fatFingerAssist=false must return 0'
      );

      // NORMAL + fatFingerAssist=true: snaps strictly to activeColorId (1), ignores isolated non-active (5)
      assert.equal(
        canvasMod.resolveNearTapRegionId({
          ...baseParams,
          canvasX: 17.5,
          canvasY: 20.5,
          difficulty: 'NORMAL',
          fatFingerAssist: true,
        }),
        1,
        'NORMAL + fatFingerAssist=true must snap to nearby unfilled activeColorId region'
      );
      assert.equal(
        canvasMod.resolveNearTapRegionId({
          ...baseParams,
          canvasX: 83.5,
          canvasY: 80.5,
          difficulty: 'NORMAL',
          fatFingerAssist: true,
        }),
        0,
        'NORMAL + fatFingerAssist=true must NOT snap to non-activeColorId region'
      );

      // EASY + fatFingerAssist=true: prefers activeColorId (1) over closer non-active (2), and falls back to any unfilled color on border/filled pixels
      assert.equal(
        canvasMod.resolveNearTapRegionId({
          ...baseParams,
          canvasX: 24.5,
          canvasY: 20.5,
          difficulty: 'EASY',
          fatFingerAssist: true,
        }),
        1,
        'EASY + fatFingerAssist=true must prefer activeColorId (1 at dx=-3) over non-active (2 at dx=+2)'
      );
      assert.equal(
        canvasMod.resolveNearTapRegionId({
          ...baseParams,
          canvasX: 83.5,
          canvasY: 80.5,
          difficulty: 'EASY',
          fatFingerAssist: true,
        }),
        5,
        'EASY + fatFingerAssist=true on border near non-active region must snap to 5'
      );
      assert.equal(
        canvasMod.resolveNearTapRegionId({
          ...baseParams,
          canvasX: 52.5,
          canvasY: 50.5,
          difficulty: 'EASY',
          fatFingerAssist: true,
        }),
        4,
        'EASY + fatFingerAssist=true on filled region must snap to nearby unfilled region of any color'
      );

      // Zoom scaling: touchReachRadiusPx=22 at totalScreenScale=4 -> 5.5 puzzle px
      assert.equal(
        canvasMod.resolveNearTapRegionId({
          ...baseParams,
          canvasX: 14.5,
          canvasY: 20.5,
          difficulty: 'NORMAL',
          fatFingerAssist: true,
          touchReachRadiusPx: 22,
          totalScreenScale: 4,
        }),
        0,
        'Zoomed-in 4x (reach=5.5px) must not reach region 6px away'
      );
      assert.equal(
        canvasMod.resolveNearTapRegionId({
          ...baseParams,
          canvasX: 16.5,
          canvasY: 20.5,
          difficulty: 'NORMAL',
          fatFingerAssist: true,
          touchReachRadiusPx: 22,
          totalScreenScale: 4,
        }),
        1,
        'Zoomed-in 4x (reach=5.5px) must reach region 4px away'
      );

      // Zoomed-out 64px puzzle-space cap: 40 / 0.25 = 160 -> capped at 64px
      assert.equal(
        canvasMod.resolveNearTapRegionId({
          ...baseParams,
          canvasX: 85.5,
          canvasY: 20.5,
          difficulty: 'NORMAL',
          fatFingerAssist: true,
          touchReachRadiusPx: 40,
          totalScreenScale: 0.25,
        }),
        1,
        'Zoomed-out 0.25x cap (64px) must reach region 64px away (85 - 21 = 64)'
      );
      assert.equal(
        canvasMod.resolveNearTapRegionId({
          ...baseParams,
          canvasX: 86.5,
          canvasY: 20.5,
          difficulty: 'NORMAL',
          fatFingerAssist: true,
          touchReachRadiusPx: 40,
          totalScreenScale: 0.25,
        }),
        0,
        'Zoomed-out 0.25x cap (64px) must NOT reach region 65px away (86 - 21 = 65)'
      );

      // Free Colour Mode direct-hit repaint: tapping already-filled region 1 near unfilled neighbor 2 must return 1 (not snap to 2)
      assert.equal(
        canvasMod.resolveNearTapRegionId({
          ...baseParams,
          filledRegionIds: new Set([1]),
          canvasX: 20.5,
          canvasY: 20.5,
          difficulty: 'NORMAL',
          fatFingerAssist: true,
          touchReachRadiusPx: 34,
          totalScreenScale: 1.0,
          isFreeColorMode: true,
        }),
        1,
        'Free Colour Mode direct hit on already-filled region 1 must return 1 for repaint instead of snapping to adjacent unfilled neighbor 2'
      );

      // Free Colour Mode border miss: tapping border pixel (exactId=0) must still snap to nearest unfilled region
      assert.equal(
        canvasMod.resolveNearTapRegionId({
          ...baseParams,
          filledRegionIds: new Set([1]),
          canvasX: 23.5,
          canvasY: 20.5,
          difficulty: 'NORMAL',
          fatFingerAssist: true,
          touchReachRadiusPx: 34,
          totalScreenScale: 1.0,
          isFreeColorMode: true,
        }),
        2,
        'Free Colour Mode border miss (exactId=0) must still snap to nearest unfilled region 2'
      );

      // Non-finite (NaN / Infinity) coordinates must return 0 immediately without scanning
      assert.equal(
        canvasMod.resolveNearTapRegionId({
          ...baseParams,
          canvasX: Number.NaN,
          canvasY: 20.5,
          difficulty: 'EASY',
          fatFingerAssist: true,
          touchReachRadiusPx: 34,
          totalScreenScale: 1.0,
        }),
        0,
        'NaN canvasX must return 0 safely'
      );
      assert.equal(
        canvasMod.resolveNearTapRegionId({
          ...baseParams,
          canvasX: 20.5,
          canvasY: Number.POSITIVE_INFINITY,
          difficulty: 'EASY',
          fatFingerAssist: true,
          touchReachRadiusPx: 34,
          totalScreenScale: 1.0,
        }),
        0,
        'Infinity canvasY must return 0 safely'
      );

      // Zero-allocation verification: no Set/Map/Array allocations inside resolveNearTapRegionId
      const fnSource = canvasMod.resolveNearTapRegionId.toString();
      assert.equal(
        /new\s+(Map|Set|Array)\b/.test(fnSource),
        false,
        'resolveNearTapRegionId must not allocate Map/Set/Array'
      );

      // 7b. Completed regions must NOT draw region boundaries (both incremental and full base rebuild)
      assert.equal(
        typeof canvasMod.writeRegionPixelsToImageData,
        'function',
        'PuzzleCanvas must export writeRegionPixelsToImageData'
      );
      assert.equal(
        typeof canvasMod.writeBaseCanvasPixels,
        'function',
        'PuzzleCanvas must export writeBaseCanvasPixels'
      );
      {
        // 4 pixels: [0]=interior of reg 1, [1]=border of reg 1, [2]=interior of reg 2, [3]=border of reg 2
        const bMap = new Uint8Array([0, 1, 0, 1]);
        const rMap = new Int32Array([1, 1, 2, 2]);
        const srcPx = new Uint8ClampedArray([
          11, 22, 33, 255,
          44, 55, 66, 255,
          77, 88, 99, 255,
          101, 112, 123, 255,
        ]);
        const reg1 = { id: 1, colorId: 1, pixels: new Int32Array([0, 1]) };
        const reg2 = { id: 2, colorId: 2, pixels: new Int32Array([2, 3]) };
        const rById = new Map([
          [1, reg1],
          [2, reg2],
        ]);
        const pById = new Map([
          [1, { id: 1, r: 200, g: 150, b: 100 }],
          [2, { id: 2, r: 60, g: 120, b: 180 }],
        ]);

        // Incremental write: DETAIL mode filled region uses exact srcPixels on border pixel (no 0.72 darkening)
        const incDetail = new Uint8ClampedArray(16);
        canvasMod.writeRegionPixelsToImageData(incDetail, bMap, reg1.pixels, 200, 150, 100, true, true, srcPx, false);
        assert.deepEqual(Array.from(incDetail.slice(0, 8)), [11, 22, 33, 255, 44, 55, 66, 255], 'Filled DETAIL region must render exact source pixels even on borderMap=1');

        // Incremental write: FLAT mode filled region uses exact palette RGB on border pixel (no 0.72 darkening)
        const incFlat = new Uint8ClampedArray(16);
        canvasMod.writeRegionPixelsToImageData(incFlat, bMap, reg1.pixels, 200, 150, 100, true, false, srcPx, false);
        assert.deepEqual(Array.from(incFlat.slice(0, 8)), [200, 150, 100, 255, 200, 150, 100, 255], 'Filled FLAT region must render exact palette color without border darkening');

        // Incremental write: Unfilled standard region still draws 1px slate (51,65,85) border and white interior
        const incUnfilled = new Uint8ClampedArray(16);
        canvasMod.writeRegionPixelsToImageData(incUnfilled, bMap, reg2.pixels, 60, 120, 180, false, true, srcPx, false);
        assert.deepEqual(Array.from(incUnfilled.slice(8, 16)), [255, 255, 255, 255, 51, 65, 85, 255], 'Unfilled region must keep white interior and slate border');

        // Full base rebuild: reg 1 filled (no border), reg 2 unfilled (slate border preserved)
        const fullDetail = new Uint8ClampedArray(16);
        canvasMod.writeBaseCanvasPixels(fullDetail, rMap, bMap, new Set([1]), rById, pById, undefined, true, srcPx, false);
        assert.deepEqual(
          Array.from(fullDetail),
          [11, 22, 33, 255, 44, 55, 66, 255, 255, 255, 255, 255, 51, 65, 85, 255],
          'Full DETAIL base rebuild must omit borders on completed reg 1 while keeping borders on unfilled reg 2'
        );

        const fullFlat = new Uint8ClampedArray(16);
        canvasMod.writeBaseCanvasPixels(fullFlat, rMap, bMap, new Set([1]), rById, pById, undefined, false, srcPx, false);
        assert.deepEqual(
          Array.from(fullFlat),
          [200, 150, 100, 255, 200, 150, 100, 255, 255, 255, 255, 255, 51, 65, 85, 255],
          'Full FLAT base rebuild must omit borders on completed reg 1 while keeping borders on unfilled reg 2'
        );

        // Free Colour mode: unfilled region has pure white everywhere (no slate border)
        const fullFree = new Uint8ClampedArray(16);
        canvasMod.writeBaseCanvasPixels(fullFree, rMap, bMap, new Set([1]), rById, pById, new Map([[1, 2]]), true, srcPx, true);
        assert.deepEqual(
          Array.from(fullFree),
          [60, 120, 180, 255, 60, 120, 180, 255, 255, 255, 255, 255, 255, 255, 255, 255],
          'Free Colour base rebuild must paint custom palette color seamlessly on filled reg 1 and pure white on unfilled reg 2'
        );
      }
    }

    // 8. DailyPuzzleService deterministic UTC date seeding & consecutive-date variation
    const dailyMod = await vite.ssrLoadModule('/src/services/DailyPuzzleService.ts');
    const dailyA = dailyMod.getDailyFeaturedPuzzle('2026-11-11');
    const dailyB = dailyMod.getDailyFeaturedPuzzle('2026-11-11');
    assert.deepEqual(dailyA, dailyB, 'getDailyFeaturedPuzzle("2026-11-11") must be 100% deterministic');
    assert.equal(dailyA.utcDate, '2026-11-11');
    assert.ok(dailyA.sample?.id && dailyA.presetId && dailyA.presetLabel && dailyA.config);

    const dailyNext1 = dailyMod.getDailyFeaturedPuzzle('2026-11-12');
    const dailyNext2 = dailyMod.getDailyFeaturedPuzzle('2026-11-13');
    assert.notEqual(
      dailyA.sample.id,
      dailyNext1.sample.id,
      'Consecutive UTC dates must rotate SAMPLE_GALLERY artwork'
    );
    assert.notEqual(
      dailyA.presetId,
      dailyNext1.presetId,
      'Consecutive UTC dates must rotate preset variation'
    );
    assert.notEqual(dailyNext1.sample.id, dailyNext2.sample.id);
    assert.notEqual(dailyNext1.presetId, dailyNext2.presetId);
    assert.equal(dailyA.snapshotId, `daily-${dailyA.sample.id}-${dailyA.presetId}`);
    assert.equal(dailyA.config.resolution, 2048, 'Daily puzzle config must default to Max resolution 2048');
    assert.equal(dailyA.config.maxRegions, 2000, 'Daily puzzle config must default to Max regions 2000');
    assert.equal(dailyA.config.colorCount, 64, 'Daily puzzle config must default to Max colors 64');
    assert.equal(dailyA.config.paletteDetail, 'CUSTOM', 'Daily puzzle config must use CUSTOM paletteDetail for 64 colors');
    assert.ok(
      dailyA.presetDescription.includes('Max Detail') &&
        !/\b(10|16|18|24) colou?rs\b/.test(dailyA.presetDescription),
      `Daily presetDescription must not show contradictory low/medium counts: '${dailyA.presetDescription}'`
    );

    // Verify full 20-day cycle coverage, honest labels, and real disk .capy archives
    const seenDailyIds = new Set();
    for (let offset = 0; offset < 20; offset++) {
      const utcDate = new Date(Date.UTC(2026, 10, 18 + offset)).toISOString().slice(0, 10);
      const featured = dailyMod.getDailyFeaturedPuzzle(utcDate);
      seenDailyIds.add(featured.snapshotId);
      assert.equal(featured.config.resolution, 2048);
      assert.equal(featured.config.maxRegions, 2000);
      assert.equal(featured.config.minRegionArea, 24);
      assert.equal(featured.config.colorCount, 64);
      assert.equal(featured.config.paletteDetail, 'CUSTOM');
      assert.equal(
        featured.presetLabel.includes('Max Detail') &&
          featured.presetDescription.includes('Max Detail') &&
          !/Cozy Quick|Balanced Classic/i.test(`${featured.presetLabel} ${featured.presetDescription}`),
        true,
        `Expected honest Max Detail copy for ${utcDate}, got '${featured.presetLabel}' / '${featured.presetDescription}'`
      );
      if (featured.sample.isFreeColor) {
        assert.equal(featured.presetLabel, 'Free Color Line Art • Max Detail');
        assert.equal(featured.config.algorithm, 'LINE_ART');
        assert.equal(featured.config.isFreeColor, true);
      }
    }
    assert.equal(seenDailyIds.size, 20, `20 consecutive UTC dates must cover all 20 unique daily IDs (got ${seenDailyIds.size})`);

    const sampleArchivePath = path.join(projectRoot, 'public/assets/sample_saves.capy');
    const dailyArchivePath = path.join(projectRoot, 'public/assets/daily_saves.capy');
    assert.equal(fs.existsSync(sampleArchivePath), true, 'Missing pre-baked sample_saves.capy asset');
    assert.equal(fs.existsSync(dailyArchivePath), true, 'Missing pre-baked daily_saves.capy asset');

    const sampleArchiveBytes = new Uint8Array(fs.readFileSync(sampleArchivePath));
    const decodedSampleArchive = await codec.decodeBinarySaveV2(sampleArchiveBytes);
    assert.equal(decodedSampleArchive.format, 'capy-archive-save-v2');
    assert.equal(decodedSampleArchive.exportDate, 1767225600000);
    assert.equal(decodedSampleArchive.snapshots.length, 4, 'sample_saves.capy must contain all 4 built-in samples');
    for (const sSnap of decodedSampleArchive.snapshots) {
      assert.equal(
        sSnap.totalCount > 0 && sSnap.totalCount <= 2000,
        true,
        `Sample '${sSnap.id}' must have 1..2000 regions (got ${sSnap.totalCount})`
      );
      const decodedRec = decodedSampleArchive.compactPuzzles?.[sSnap.id];
      assert.ok(decodedRec, `Missing compact puzzle record for sample '${sSnap.id}'`);
      assert.equal(
        decodedRec.regionMetaBytes.byteLength / 20 <= 2000,
        true,
        `Sample '${sSnap.id}' decoded regionMeta rows must stay <= 2000`
      );
    }

    const dailyArchiveBytes = new Uint8Array(fs.readFileSync(dailyArchivePath));
    const dailyUnpackedSize =
      (dailyArchiveBytes[5] & 0x01) !== 0
        ? zlib.gunzipSync(dailyArchiveBytes.subarray(6)).byteLength
        : dailyArchiveBytes.byteLength - 6;
    assert.equal(
      dailyUnpackedSize < 16 * 1024 * 1024,
      true,
      `daily_saves.capy unpacked size must stay safely below 16 MiB codec cap (got ${dailyUnpackedSize})`
    );
    const decodedDailyArchive = await codec.decodeBinarySaveV2(dailyArchiveBytes);
    assert.equal(decodedDailyArchive.format, 'capy-archive-save-v2');
    assert.equal(decodedDailyArchive.exportDate, 1767225600000);
    assert.equal(decodedDailyArchive.snapshots.length, 20, 'daily_saves.capy must pack all 20 daily combinations');
    const packedDailyIds = new Set(decodedDailyArchive.snapshots.map((s) => s.id));
    for (const dailyId of seenDailyIds) {
      assert.equal(packedDailyIds.has(dailyId), true, `daily_saves.capy missing '${dailyId}'`);
    }
    for (const dSnap of decodedDailyArchive.snapshots) {
      assert.equal(
        dSnap.totalCount > 0 && dSnap.totalCount <= 2000,
        true,
        `Daily '${dSnap.id}' must have 1..2000 regions (got ${dSnap.totalCount})`
      );
      assert.equal(
        !/Cozy Quick|Balanced Classic|Max Detail \(Auto\)/i.test(dSnap.title),
        true,
        `Daily snapshot title must not leak stale label: '${dSnap.title}'`
      );
      const decodedRec = decodedDailyArchive.compactPuzzles?.[dSnap.id];
      assert.ok(decodedRec, `Missing compact puzzle record for daily '${dSnap.id}'`);
      assert.equal(
        decodedRec.regionMetaBytes.byteLength / 20 <= 2000,
        true,
        `Daily '${dSnap.id}' decoded regionMeta rows must stay <= 2000`
      );
    }

    const storageTitleMod = await vite.ssrLoadModule('/src/services/StorageService.ts');
    assert.equal(
      storageTitleMod.StorageService.normalizeSnapshotTitle('Capy Forest (Max Detail (Auto))'),
      'Capy Forest'
    );
    assert.equal(
      storageTitleMod.StorageService.normalizeSnapshotTitle('Capy Forest (Crisp Posterized (Max Detail))'),
      'Capy Forest (Crisp Posterized (Max Detail))'
    );

    // 9. PlayerStatsService SSR load, increment, clamping, persistence & monotonic mergeLifetimeStats
    const statsMod = await vite.ssrLoadModule('/src/services/PlayerStatsService.ts');
    try {
      const resetInitial = statsMod.PlayerStatsService.resetStats();
      assert.deepEqual(resetInitial, {
        totalRegionsColored: 0,
        puzzlesCompleted: 0,
        zeroHintPuzzles: 0,
        fastestCompletionMs: null,
        freeColorCreations: 0,
        coopRegionsPainted: 0,
      });

      statsMod.PlayerStatsService.recordRegionsColored(4, false);
      const afterCoop = statsMod.PlayerStatsService.recordRegionsColored(3, true);
      assert.equal(afterCoop.totalRegionsColored, 7);
      assert.equal(afterCoop.coopRegionsPainted, 3);

      // Negative or zero increments must be clamped safely without decrementing totals
      const afterNeg = statsMod.PlayerStatsService.recordRegionsColored(-5, true);
      assert.equal(afterNeg.totalRegionsColored, 7);
      assert.equal(afterNeg.coopRegionsPainted, 3);

      statsMod.PlayerStatsService.recordFreeColorCreation();
      statsMod.PlayerStatsService.recordPuzzleCompleted({ hintsUsed: 2, activeElapsedMs: 52_000 });
      statsMod.PlayerStatsService.recordPuzzleCompleted({ hintsUsed: 0, activeElapsedMs: 34_500 });
      const finalSaved = statsMod.PlayerStatsService.recordPuzzleCompleted({
        hintsUsed: 0,
        activeElapsedMs: 75_000,
      });

      assert.deepEqual(finalSaved, {
        totalRegionsColored: 7,
        puzzlesCompleted: 3,
        zeroHintPuzzles: 2,
        fastestCompletionMs: 34_500,
        freeColorCreations: 1,
        coopRegionsPainted: 3,
      });
      assert.deepEqual(statsMod.PlayerStatsService.loadStats(), finalSaved);

      const merged = statsMod.mergeLifetimeStats(
        {
          totalRegionsColored: 120,
          puzzlesCompleted: 4,
          zeroHintPuzzles: 1,
          fastestCompletionMs: 49_000,
          freeColorCreations: 2,
          coopRegionsPainted: 15,
        },
        {
          totalRegionsColored: 85,
          puzzlesCompleted: 9,
          zeroHintPuzzles: 6,
          fastestCompletionMs: 28_400,
          freeColorCreations: 5,
          coopRegionsPainted: 4,
        }
      );
      assert.deepEqual(merged, {
        totalRegionsColored: 120,
        puzzlesCompleted: 9,
        zeroHintPuzzles: 6,
        fastestCompletionMs: 28_400,
        freeColorCreations: 5,
        coopRegionsPainted: 15,
      });
      assert.equal(
        statsMod.mergeLifetimeStats({ fastestCompletionMs: null }, { fastestCompletionMs: 19_000 })
          .fastestCompletionMs,
        19_000
      );
    } finally {
      statsMod.PlayerStatsService.resetStats();
    }

    // 10. SvgPrintExporter SSR vector coloring sheet generation, legend items & XML escaping
    const svgMod = await vite.ssrLoadModule('/src/services/SvgPrintExporter.ts');
    const rawSpecialTitle = 'Capy & Friends <"Zen" Sheet>';
    const svgDoc = svgMod.buildPrintableColoringSvg(puzzleData, {
      title: rawSpecialTitle,
      palette: puzzleData.palette,
    });
    assert.equal(
      svgDoc.includes('<svg xmlns="http://www.w3.org/2000/svg"') && svgDoc.trim().endsWith('</svg>'),
      true,
      'buildPrintableColoringSvg must emit a valid self-contained <svg>...</svg> XML document'
    );
    assert.equal(
      svgDoc.includes('<rect width="100%" height="100%" fill="#ffffff" />'),
      true,
      'Printable SVG must render a crisp white #ffffff paper background'
    );
    assert.equal(
      svgDoc.includes('<path id="region-outlines" d="M'),
      true,
      'Printable SVG must trace inter-region boundaries into a vector <path>'
    );
    assert.equal(
      svgDoc.includes('<g id="region-numbers"') && /<text x="[0-9.]+" y="[0-9.]+" font-size="[0-9.]+">\d+<\/text>/.test(svgDoc),
      true,
      'Printable SVG must emit centered region color number <text> labels'
    );
    for (let idx = 0; idx < puzzleData.palette.length; idx++) {
      assert.equal(
        svgDoc.includes(`data-swatch-number="${idx + 1}"`),
        true,
        `Printable SVG must include swatch legend item #${idx + 1}`
      );
    }
    assert.equal(
      svgDoc.includes('Capy &amp; Friends &lt;&quot;Zen&quot; Sheet&gt;'),
      true,
      'Printable SVG must XML-escape &, <, >, and " characters in title headers'
    );
    assert.equal(
      svgDoc.includes(rawSpecialTitle),
      false,
      'Printable SVG must never contain unescaped special XML characters'
    );
    assert.equal(
      svgMod.sanitizeColoringSheetFileName(rawSpecialTitle),
      'capy-friends-zen-sheet-coloring-sheet.svg'
    );
    logUnitPass('SoundService, zoom detents, DailyPuzzleService, PlayerStatsService & SvgPrintExporter verified.');
}
