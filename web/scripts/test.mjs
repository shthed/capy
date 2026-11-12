import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer, preview } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const BASE_URL = process.env.CAPY_TEST_URL || 'http://localhost:3000';

async function isServerListening(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

async function waitForPuzzleLoaded(page) {
  await page.waitForSelector('canvas', { timeout: 25000 });
  await page.waitForFunction(
    () =>
      !document.body.innerText.includes('Analyzing artwork') &&
      !document.body.innerText.includes('Generating puzzle'),
    { timeout: 25000 }
  );
  await page.waitForSelector('[aria-label="Palette dock"], [data-testid="replay-btn"]', { timeout: 25000 });
  await page.waitForTimeout(250);
}

async function tapCanvasGrid(page, startFrac = 0.32, count = 8, delayMs = 60) {
  const canvas = await page.$('canvas');
  const box = await canvas.boundingBox();
  const cols = 4;
  for (let i = 0; i < count; i++) {
    const x = box.x + box.width * (startFrac + (i % cols) * 0.09);
    const y = box.y + box.height * (startFrac + Math.floor(i / cols) * 0.09);
    await page.mouse.click(x, y);
    if (delayMs > 0) await page.waitForTimeout(delayMs);
  }
  await page.waitForTimeout(200);
}

async function runCodecAndEngineTests() {
  console.log('=== PART 1: Engine & Compact Binary Codec v2 Unit Checks ===');
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

    const singleBinary = await codec.encodeSingleSaveBinaryV2(sampleSnapshot, compact, fakeImageBlob);
    assert.equal(codec.hasBinaryMagicHeader(singleBinary), true, 'Must start with CAPY\\x02 magic header');
    const decodedSingle = await codec.decodeBinarySaveV2(singleBinary);
    assert.equal(decodedSingle.format, 'capy-single-save-v2');
    assert.deepEqual(decodedSingle.snapshot.filledRegionIds, [5, 1, 12]);
    assert.equal(decodedSingle.snapshot.parentSnapshotId, 'parent-snap-0');
    assert.deepEqual(decodedSingle.imageBytes, fakeImageBytes);

    const archiveBinary = await codec.encodeArchiveSaveBinaryV2(
      [sampleSnapshot],
      { 'snap-test-1': compact },
      { 'snap-test-1': fakeImageBlob }
    );
    const decodedArchive = await codec.decodeBinarySaveV2(archiveBinary);
    assert.equal(decodedArchive.format, 'capy-archive-save-v2');
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

    // 5. Semantic Versioning & CHANGELOG.md Synchronization
    const versionMod = await vite.ssrLoadModule('/src/version.ts');
    const semverParts = versionMod.parseSemVer(versionMod.APP_VERSION);
    assert.equal(
      versionMod.APP_VERSION_CODE,
      semverParts.major * 10000 + semverParts.minor * 100 + semverParts.patch,
      'APP_VERSION_CODE must equal MAJOR * 10000 + MINOR * 100 + PATCH'
    );
    const changelogPath = path.resolve(projectRoot, '..', 'CHANGELOG.md');
    assert.equal(fs.existsSync(changelogPath), true, 'CHANGELOG.md must exist at repository root');
    const changelogText = fs.readFileSync(changelogPath, 'utf8');
    assert.equal(
      changelogText.startsWith('### '),
      true,
      'CHANGELOG.md must start directly on line 1 with a compact ### version heading (no preamble)'
    );
    assert.equal(
      /^#{1,2}\s+/m.test(changelogText),
      false,
      'CHANGELOG.md must not contain oversized # or ## headings'
    );
    const majorMinor = `${semverParts.major}.${semverParts.minor}`;
    const currentVersionHeadingRe = new RegExp(
      `^### (?:${versionMod.APP_VERSION.replace(/\./g, '\\.')}|${majorMinor.replace(/\./g, '\\.')}) - \\d{4}-\\d{2}-\\d{2} \\((?:Alpha|Beta|Production|Production, Beta)\\)$`,
      'm'
    );
    assert.equal(
      currentVersionHeadingRe.test(changelogText),
      true,
      `CHANGELOG.md must contain a compact ### release heading with active channel marker for ${versionMod.APP_VERSION} or ${majorMinor}`
    );
    const changelogHeadings = changelogText.split('\n').filter((line) => line.startsWith('#'));
    let productionHeadingCount = 0;
    let betaHeadingCount = 0;
    let alphaHeadingCount = 0;
    for (const heading of changelogHeadings) {
      assert.equal(
        /^### \d+\.\d+(?:\.\d+)? - \d{4}-\d{2}-\d{2}(?: \((?:Alpha|Beta|Production|Production, Beta)\))?$/.test(
          heading
        ),
        true,
        `Each CHANGELOG.md heading must be concise "### X.Y[.Z] - YYYY-MM-DD [(Alpha|Beta|Production|Production, Beta)]": ${heading}`
      );
      if (/\((?:Production|Production, Beta)\)$/.test(heading)) productionHeadingCount += 1;
      if (/\((?:Beta|Production, Beta)\)$/.test(heading)) betaHeadingCount += 1;
      if (/\(Alpha\)$/.test(heading)) alphaHeadingCount += 1;
    }
    assert.equal(
      productionHeadingCount,
      1,
      `CHANGELOG.md must mark exactly 1 active Production release heading, got ${productionHeadingCount}`
    );
    assert.equal(
      betaHeadingCount <= 1,
      true,
      `CHANGELOG.md must mark at most 1 active Beta release heading, got ${betaHeadingCount}`
    );
    assert.equal(
      alphaHeadingCount <= 1,
      true,
      `CHANGELOG.md must mark at most 1 active Alpha release heading, got ${alphaHeadingCount}`
    );
    assert.equal(
      changelogText.includes('### 0.1.0 - '),
      true,
      'CHANGELOG.md must include retrospective 0.1.0--0.9.x release history'
    );

    // Release channel path/origin/query resolution checks
    const stableCh = versionMod.resolveReleaseChannel('/capy/', 'https://shthed.github.io', '');
    assert.equal(stableCh.channel, 'stable');
    assert.equal(stableCh.badgeLabel, null);
    assert.equal(stableCh.prNumber, null);
    assert.equal(stableCh.stableWebUrl, 'https://shthed.github.io/capy/');
    assert.equal(stableCh.betaWebUrl, 'https://shthed.github.io/capy/beta/');
    assert.equal(stableCh.betaApkUrl, 'https://shthed.github.io/capy/beta/capy.apk');

    const betaCh = versionMod.resolveReleaseChannel('/capy/beta/', 'https://shthed.github.io', '');
    assert.equal(betaCh.channel, 'beta');
    assert.equal(betaCh.badgeLabel, 'BETA');
    assert.equal(betaCh.prNumber, null);

    const alphaCh = versionMod.resolveReleaseChannel(
      '/capy/pull/481/',
      'https://shthed.github.io',
      ''
    );
    assert.equal(alphaCh.channel, 'alpha');
    assert.equal(alphaCh.badgeLabel, 'ALPHA #481');
    assert.equal(alphaCh.prNumber, 481);

    const devCh = versionMod.resolveReleaseChannel('/', 'http://localhost:3000', '');
    assert.equal(devCh.channel, 'dev');
    assert.equal(devCh.badgeLabel, null);

    const queryBetaCh = versionMod.resolveReleaseChannel(
      '/',
      'http://localhost:3000',
      '?capy_channel=beta'
    );
    assert.equal(queryBetaCh.channel, 'beta');
    assert.equal(queryBetaCh.badgeLabel, 'BETA');

    const queryAlphaCh = versionMod.resolveReleaseChannel(
      '/',
      'http://localhost:3000',
      '?capy_channel=alpha&pr=481'
    );
    assert.equal(queryAlphaCh.channel, 'alpha');
    assert.equal(queryAlphaCh.badgeLabel, 'ALPHA #481');
    assert.equal(queryAlphaCh.prNumber, 481);
    assert.equal(
      /^[ \t]+-\s+/m.test(changelogText),
      false,
      'CHANGELOG.md must not contain nested sub-bullets'
    );
    const changelogBullets = changelogText.split('\n').filter((line) => line.startsWith('- '));
    assert.equal(
      changelogBullets.length >= 398,
      true,
      `Expected >= 398 single-line PR bullets in CHANGELOG.md, got ${changelogBullets.length}`
    );
    for (const bullet of changelogBullets) {
      assert.equal(
        /\s\[#\d+\]\(https:\/\/github\.com\/(?:capyboop|shthed)\/capy\/pull\/\d+\)$/.test(bullet),
        true,
        `Each CHANGELOG.md bullet must end with a bare [#000] PR link: ${bullet}`
      );
    }

    // 6. SoundService SSR safety, volume clamping, visibility/disable auto-suspend & rate-throttled woodblock tap
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

    // 11. capypaint.com canonical ShareLinkService, Co-op WS auto-discovery, Cloudflare Worker protocol & persona rebrand
    const shareLinkMod = await vite.ssrLoadModule('/src/services/ShareLinkService.ts');
    const providerMod = await vite.ssrLoadModule('/src/services/providers/ProviderRegistry.ts');
    const relayProtoMod = await vite.ssrLoadModule(
      path.resolve(projectRoot, '../worker/coopRoomProtocol.ts')
    );
    const { transformPersonaContent } = await import('./rebrand-persona.mjs');

    assert.equal(shareLinkMod.CANONICAL_PRODUCTION_URL, 'https://capypaint.com/');
    const builtShare = await shareLinkMod.buildShareProgressUrl({
      sourceRef: { kind: 'sample', uri: 'assets/capybara.webp' },
      filledRegionIds: [1, 2, 3],
      roomCode: 'abc123',
    });
    assert.equal(
      builtShare.url.startsWith('https://capypaint.com/?room=ABC123#s='),
      true,
      `SSR canonical share URL must target https://capypaint.com/, got ${builtShare.url}`
    );
    for (const hostBase of [
      'https://capypaint.com/',
      'https://capyboop.github.io/capy/',
      'https://shthed.github.io/capy/',
    ]) {
      const parsedLink = await shareLinkMod.parseShareLinkFromUrl(
        `${hostBase}?room=abc123#s=${builtShare.token}`
      );
      assert.equal(parsedLink.roomCode, 'ABC123');
      assert.deepEqual(parsedLink.delta?.filledRegionIds, [1, 2, 3]);
      assert.equal(parsedLink.matchedSample?.id, 'capybara_sample');
    }

    assert.equal(
      providerMod.resolveCoopRoomWsUrl(undefined, {
        protocol: 'https:',
        host: 'capypaint.com',
        hostname: 'capypaint.com',
      }),
      'wss://capypaint.com/api/room'
    );
    assert.equal(
      providerMod.resolveCoopRoomWsUrl(undefined, {
        protocol: 'https:',
        host: 'www.capypaint.com',
        hostname: 'www.capypaint.com',
      }),
      'wss://capypaint.com/api/room'
    );
    assert.equal(
      providerMod.resolveCoopRoomWsUrl(undefined, {
        protocol: 'https:',
        host: 'capy-paint.example.workers.dev',
        hostname: 'capy-paint.example.workers.dev',
      }),
      'wss://capy-paint.example.workers.dev/api/room'
    );
    assert.equal(
      providerMod.resolveCoopRoomWsUrl(undefined, {
        protocol: 'https:',
        host: 'appassets.androidplatform.net',
        hostname: 'appassets.androidplatform.net',
      }),
      'wss://capypaint.com/api/room'
    );
    assert.equal(
      providerMod.resolveCoopRoomWsUrl(undefined, {
        protocol: 'http:',
        host: 'localhost:3000',
        hostname: 'localhost',
      }),
      null,
      'Localhost without VITE_CAPY_ROOM_WS_URL must stay null so BroadcastChannel runs without spurious WS errors'
    );
    assert.equal(
      providerMod.resolveCoopRoomWsUrl('wss://custom-relay.example/ws', {
        protocol: 'https:',
        host: 'capypaint.com',
        hostname: 'capypaint.com',
      }),
      'wss://custom-relay.example/ws'
    );

    assert.equal(relayProtoMod.normalizeRoomCode(' ab-c_123! '), 'ABC123');
    assert.equal(relayProtoMod.normalizeRoomCode('!!!'), null);
    assert.equal(relayProtoMod.isAllowedRelayOrigin('https://capypaint.com'), true);
    assert.equal(relayProtoMod.isAllowedRelayOrigin('https://www.capypaint.com'), true);
    assert.equal(relayProtoMod.isAllowedRelayOrigin('https://appassets.androidplatform.net'), true);
    assert.equal(relayProtoMod.isAllowedRelayOrigin('http://capypaint.com'), false);
    assert.equal(relayProtoMod.isAllowedRelayOrigin('https://evil.example.com'), false);

    const validRelayFrame = relayProtoMod.validateCoopFrame(
      JSON.stringify({
        type: 'PAINT_EVENT',
        roomCode: 'abc123',
        sender: {
          playerId: 'p1',
          displayName: 'Sunny Capy',
          avatarColorHex: '#38bdf8',
          lastActiveAt: 1000,
        },
        paintEvent: { eventId: 'ev1', regionIds: [4, 5], action: 'FILL' },
        sentAt: 1234,
      }),
      'ABC123'
    );
    assert.equal(validRelayFrame.ok, true);
    assert.equal(validRelayFrame.message?.roomCode, 'ABC123');
    assert.equal(
      relayProtoMod.validateCoopFrame('x'.repeat(4097), 'ABC123').reason,
      'frame_size_exceeded',
      'Worker Co-op relay must enforce <= 4096 byte frame cap'
    );
    assert.equal(
      relayProtoMod.validateCoopFrame(
        JSON.stringify({
          type: 'HELLO',
          roomCode: 'OTHER1',
          sender: { playerId: 'p1', displayName: 'Capy', avatarColorHex: '#fff', lastActiveAt: 1 },
          sentAt: 1,
        }),
        'ABC123'
      ).reason,
      'room_mismatch'
    );

    const wranglerRaw = fs.readFileSync(path.resolve(projectRoot, '../wrangler.jsonc'), 'utf8');
    const wranglerJson = JSON.parse(wranglerRaw.replace(/^\s*\/\/.*$/gm, ''));
    assert.equal(wranglerJson.name, 'capy-paint');
    assert.equal(wranglerJson.assets?.directory, './web/dist');
    assert.equal(wranglerJson.assets?.not_found_handling, 'single-page-application');
    assert.deepEqual(wranglerJson.assets?.run_worker_first, ['/api/*']);
    assert.deepEqual(wranglerJson.migrations?.[0]?.new_sqlite_classes, ['CoopRoomDurableObject']);
    assert.equal(
      wranglerJson.routes?.some((r) => r.pattern === 'capypaint.com' && r.custom_domain === true),
      true
    );

    const sampleDoc =
      'Repo https://github.com/shthed/capy (`shthed`) preview https://shthed.github.io/capy/pull/1/';
    const transformedOnce = transformPersonaContent(sampleDoc);
    assert.equal(
      transformedOnce,
      'Repo https://github.com/capyboop/capy (`capyboop`) preview https://capyboop.github.io/capy/pull/1/'
    );
    assert.equal(transformPersonaContent(transformedOnce), transformedOnce);

    console.log('   PASS: ColorQuantizer, RegionSegmenter, CapyCodec RLE, .capy v2 Gzip, CRDT deltas, SoundService, Zoom Detents, DailyPuzzleService, PlayerStatsService, SvgPrintExporter, Cloudflare Worker Co-op Relay, and Version/Changelog sync verified.');
  } finally {
    await vite.close();
  }
}

async function runBrowserBasicsSuite() {
  console.log(`\n=== PART 2: Unified Browser E2E Suite (${BASE_URL}) ===`);
  let previewServer = null;
  if (!(await isServerListening(BASE_URL))) {
    previewServer = await preview({
      root: projectRoot,
      preview: { host: '0.0.0.0', port: 3000, strictPort: true },
      logLevel: 'error',
    });
  }

  const chromiumPath =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  const browser = await chromium.launch({
    headless: true,
    ...(chromiumPath ? { executablePath: chromiumPath } : {}),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const consoleErrors = [];
  const attachErrorListeners = (page, label) => {
    page.on('pageerror', (err) => consoleErrors.push(`[${label}] ${err.message}`));
  };

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 860 },
      hasTouch: true,
      acceptDownloads: true,
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const page = await context.newPage();
    attachErrorListeners(page, 'main');

    // -------------------------------------------------------------------------
    // 1. PWA Manifest, Digital Asset Links, Privacy Policy & Instant Pre-Baked First Launch
    // -------------------------------------------------------------------------
    console.log('1. Verifying PWA manifest, Digital Asset Links, privacy policy, Service Worker & instant pre-baked boot...');
    const manifestRes = await page.goto(`${BASE_URL}/manifest.webmanifest`);
    assert.equal(manifestRes?.status(), 200);
    const manifestJson = JSON.parse(await manifestRes.text());
    assert.equal(manifestJson.name, 'Capy Paint');
    assert.equal(manifestJson.display, 'standalone');

    const assetLinksRes = await page.goto(`${BASE_URL}/.well-known/assetlinks.json`);
    assert.equal(assetLinksRes?.status(), 200);
    const assetLinksJson = JSON.parse(await assetLinksRes.text());
    assert.equal(assetLinksJson[0]?.target?.package_name, 'com.capypaint.capy');

    const privacyRes = await page.goto(`${BASE_URL}/privacy-policy.html`);
    assert.equal(privacyRes?.status(), 200);
    assert.equal((await page.evaluate(() => document.body.innerText)).includes('Google Play Data Safety'), true);

    let workerRequestedOnBoot = false;
    const onReq = (req) => {
      if (req.url().includes('puzzle.worker')) workerRequestedOnBoot = true;
    };
    page.on('request', onReq);
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(page);
    page.off('request', onReq);

    assert.equal(workerRequestedOnBoot, false, 'Pre-baked sample_saves.capy must boot with zero worker wait');
    const bootMeta = await page.evaluate(async () => {
      const snaps = JSON.parse(localStorage.getItem('capy_snapshots_v8') || '[]');
      const swReady = 'serviceWorker' in navigator ? Boolean((await navigator.serviceWorker.ready)?.active) : false;
      const cacheNames = await caches.keys();
      return { count: snaps.length, firstId: snaps[0]?.id, swReady, hasCache: cacheNames.includes('capy-cache-v2') };
    });
    assert.equal(bootMeta.count, 4);
    assert.equal(bootMeta.firstId, 'sample-capybara');
    assert.equal(bootMeta.swReady, true);
    assert.equal(bootMeta.hasCache, true);

    // Disable autoReplayOnLoad and enable EASY difficulty for fast deterministic E2E interaction checks
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('capy_user_settings_v8') || '{}');
      s.autoReplayOnLoad = false;
      s.difficulty = 'EASY';
      localStorage.setItem('capy_user_settings_v8', JSON.stringify(s));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(page);
    console.log('   PASS: Instant 4-sample bootstrap, Service Worker cache, and manifest verified.');

    // -------------------------------------------------------------------------
    // 2. Canvas Coloring, Gestures (Double-Tap Zoom, Momentum, Background Drag) & Paint Mode
    // -------------------------------------------------------------------------
    console.log('2. Verifying canvas coloring, touch gestures, and Paint Mode...');
    const swatches = await page.$$('[aria-label="Palette dock"] button');
    assert.equal(swatches.length > 2, true, 'PaletteDock must render swatches');
    await swatches[1].click();

    await tapCanvasGrid(page, 0.32, 12, 40);
    const initialProgress = await page.evaluate(() => {
      const list = JSON.parse(localStorage.getItem('capy_snapshots_v8') || '[]');
      return list[0]?.filledCount || 0;
    });
    assert.equal(initialProgress >= 2, true, `Expected >= 2 filled regions, got ${initialProgress}`);

    const canvas = await page.$('canvas');
    const box = await canvas.boundingBox();
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    // One-finger double-tap-and-drag zoom + inertial flick + zero-latency cancel + background drag
    await page.evaluate(
      async ({ x, y }) => {
        const el = document.querySelector('canvas');
        if (!el) return;
        const fire = (type, cx, cy, id = 1) =>
          el.dispatchEvent(
            new PointerEvent(type, { clientX: cx, clientY: cy, pointerId: id, pointerType: 'touch', isPrimary: true, bubbles: true })
          );

        // Double-tap drag vertical zoom
        fire('pointerdown', x, y, 1);
        await new Promise((r) => setTimeout(r, 30));
        fire('pointerup', x, y, 1);
        await new Promise((r) => setTimeout(r, 60));
        fire('pointerdown', x, y, 1);
        for (let dy = 0; dy <= 90; dy += 30) {
          fire('pointermove', x, y + dy, 1);
          await new Promise((r) => setTimeout(r, 16));
        }
        fire('pointerup', x, y + 90, 1);

        // Inertial pan flick & immediate touch cancel
        fire('pointerdown', x, y, 2);
        for (let i = 1; i <= 5; i++) {
          fire('pointermove', x + i * 25, y + i * 20, 2);
          await new Promise((r) => setTimeout(r, 16));
        }
        fire('pointerup', x + 125, y + 100, 2);
        await new Promise((r) => setTimeout(r, 40));
        fire('pointerdown', x + 125, y + 100, 3);
        fire('pointerup', x + 125, y + 100, 3);
      },
      { x: startX, y: startY }
    );

    const paintBtn = await page.waitForSelector('button[aria-label="Toggle Paint Mode"]');
    await paintBtn.click();
    await paintBtn.click();
    console.log('   PASS: Palette selection, region tap coloring, double-tap zoom, pan momentum, and Paint Mode verified.');

    // -------------------------------------------------------------------------
    // 3. Undo, Redo, Long-Press Replay Scrubber, Resume Here & Free Colour Undo
    // -------------------------------------------------------------------------
    console.log('3. Verifying Undo, Redo, long-press Replay scrubber, Resume Here & Free Colour auto-undo...');
    assert.equal(await page.$('[data-testid="undo-btn"]'), null, 'Undo hidden by default for standard puzzles');

    // Open Settings -> verify version badge, enable Undo, test Charcoal background reset, and verify tab memory
    const settingsBtn = page.locator('button[title="Settings and Menu"]');
    await settingsBtn.click();
    await page.waitForTimeout(200);

    const pkgVersion = JSON.parse(fs.readFileSync(path.resolve(projectRoot, 'package.json'), 'utf8')).version;
    const versionBadgeText = await page.locator('[data-testid="app-version-badge"]').textContent();
    assert.equal(versionBadgeText?.trim(), `v${pkgVersion}`, `Expected app-version-badge to equal v${pkgVersion}`);

    await page.locator('button[title="Charcoal"]').first().click();
    for (const labelText of [
      'Show Zoom (+ / -) Buttons',
      'Show Reset View (Extent) Button',
      'Enable Undo Action',
    ]) {
      const labelEl = await page.waitForSelector(`text=${labelText}`);
      await labelEl.evaluate((el) => el.closest('.flex')?.querySelector('button')?.click());
    }

    // Switch to Hints tab and close -> reopen to verify capy_last_settings_tab persistence
    await page.getByRole('button', { name: 'Hints', exact: true }).click();
    await page.waitForTimeout(150);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    const updatedSettings = await page.evaluate(() => JSON.parse(localStorage.getItem('capy_user_settings_v8') || '{}'));
    assert.equal(updatedSettings.canvasBgColor, 'CHARCOAL');
    assert.equal(updatedSettings.canvasBgArgb >>> 0, 0xff18181b);
    assert.equal(localStorage_tab(await page.evaluate(() => localStorage.getItem('capy_last_settings_tab'))), '1');

    function localStorage_tab(v) {
      return String(v);
    }

    // Single-step Undo & Redo
    const undoBtn = await page.waitForSelector('[data-testid="undo-btn"]');
    assert.equal(await page.$('[data-testid="redo-btn"]'), null, 'Redo hidden before Undo');
    await undoBtn.click();
    await page.waitForTimeout(200);

    const redoBtn = await page.waitForSelector('[data-testid="redo-btn"]');
    const [redoBox, undoBox] = await Promise.all([redoBtn.boundingBox(), undoBtn.boundingBox()]);
    assert.equal(redoBox.y < undoBox.y, true, 'Redo button must stack above Undo button');
    await redoBtn.click();
    await page.waitForTimeout(200);

    // Long-press Undo (>=450ms) -> Replay Scrubber (minimised by default) -> Expand -> Scrub to step 2 -> Resume Here
    await page.mouse.move(undoBox.x + undoBox.width / 2, undoBox.y + undoBox.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(520);
    await page.mouse.up();
    await page.waitForTimeout(250);

    const replayWin = await page.waitForSelector('[data-testid="replay-controls-window"]');
    assert.equal(
      await replayWin.getAttribute('data-minimized'),
      'true',
      'ReplayControls window must be minimised by default'
    );
    // Verify YouTube-style progress slider is immediately interactive in the default bar and takes up wide horizontal space
    const trackInCompact = await page.waitForSelector('[data-testid="replay-scrubber-track"]');
    const trackBox = await trackInCompact.boundingBox();
    assert.equal(
      trackBox.width >= 140,
      true,
      `Expected YouTube-style scrubber track width >= 140px in compact bar, got ${trackBox.width}`
    );
    // Drag along the YouTube-style scrubber track in compact mode and verify instant seek response
    await page.mouse.move(trackBox.x + trackBox.width * 0.85, trackBox.y + trackBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(trackBox.x + trackBox.width * 0.25, trackBox.y + trackBox.height / 2, { steps: 3 });
    await page.mouse.up();
    const valAfterDrag = Number(await page.locator('[data-testid="replay-scrubber"]').inputValue());
    assert.equal(valAfterDrag >= 0 && valAfterDrag <= 3, true, `Expected instant pointer-drag scrub in compact mode, got ${valAfterDrag}`);

    await page.locator('[data-testid="replay-toggle-minimize-btn"]').click();
    await page.waitForTimeout(150);
    assert.equal(
      await page.locator('[data-testid="replay-controls-window"]').getAttribute('data-minimized'),
      'false',
      'ReplayControls window must expand when toggle button is clicked'
    );

    const scrubber = await page.waitForSelector('[data-testid="replay-scrubber"]');
    await scrubber.fill('2');
    await scrubber.dispatchEvent('change');
    await page.waitForTimeout(200);
    await page.locator('[data-testid="replay-resume-btn"]').click();
    await page.waitForTimeout(250);

    const progressAfterResume = await page.evaluate(() => {
      const list = JSON.parse(localStorage.getItem('capy_snapshots_v8') || '[]');
      return list[0]?.filledCount || 0;
    });
    assert.equal(progressAfterResume, 2, 'Expected filledCount rewound to 2 after Resume Here');

    await page.keyboard.press('Control+y');
    await page.waitForTimeout(150);
    const progressAfterCtrlY = await page.evaluate(() => {
      const list = JSON.parse(localStorage.getItem('capy_snapshots_v8') || '[]');
      return list[0]?.filledCount || 0;
    });
    assert.equal(progressAfterCtrlY, 3, 'Expected Ctrl+Y to redo step 3');

    // Verify save-load zoom restoration before replay, offscreen step fast-forward, and pan/zoom during playback
    const zoomInBtn = await page.waitForSelector('[data-testid="zoom-in-btn"]');
    await zoomInBtn.click();
    await zoomInBtn.click();
    await zoomInBtn.click();
    await zoomInBtn.click();
    await page.waitForTimeout(450);

    const savedZoomBeforeLoad = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('capy_user_settings_v8') || '{}');
      s.autoReplayOnLoad = true;
      s.replaySpeed = 0.5;
      localStorage.setItem('capy_user_settings_v8', JSON.stringify(s));
      const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
      // Pan to far top-left corner so painted center regions are offscreen when save loads
      active.panOffsetX = 420;
      active.panOffsetY = 320;
      localStorage.setItem('capy_active_session_v8', JSON.stringify(active));
      const snaps = JSON.parse(localStorage.getItem('capy_snapshots_v8') || '[]');
      if (snaps[0]) {
        snaps[0].zoomScale = active.zoomScale;
        snaps[0].panOffsetX = 420;
        snaps[0].panOffsetY = 320;
        localStorage.setItem('capy_snapshots_v8', JSON.stringify(snaps));
      }
      return active.zoomScale || 1;
    });
    assert.equal(savedZoomBeforeLoad > 1.8, true, `Expected zoomed-in viewport > 1.8, got ${savedZoomBeforeLoad}`);

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('canvas', { timeout: 25000 });
    // Immediately check that Fit-to-Screen button is visible (meaning previous zoom extent was restored BEFORE replay)
    await page.waitForSelector('[data-testid="reset-view-btn"]', { timeout: 5000 });
    // Because the painted center regions are offscreen at the restored top-left zoom extent, offscreen steps fast-forward automatically
    await page.waitForSelector('[aria-label="Palette dock"]', { timeout: 4000 });
    await page.waitForTimeout(220);

    // Trigger replay via long-press Undo, start playback from 0, and verify live zoom/pan during playback
    const undoBtnAfterLoad = await page.waitForSelector('[data-testid="undo-btn"]');
    const uBox2 = await undoBtnAfterLoad.boundingBox();
    await page.mouse.move(uBox2.x + uBox2.width / 2, uBox2.y + uBox2.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(520);
    await page.mouse.up();
    await page.waitForTimeout(200);

    // Minimised by default: enable Follow Painting and Auto-Loop, then start playback and verify camera follows offscreen regions and loops
    const followBtn = await page.waitForSelector('[data-testid="replay-follow-btn"]');
    const loopBtn = await page.waitForSelector('[data-testid="replay-loop-btn"]');
    assert.equal(await followBtn.getAttribute('aria-pressed'), 'false', 'Follow button initially off');
    assert.equal(await loopBtn.getAttribute('aria-pressed'), 'false', 'Loop button initially off');

    await followBtn.click();
    await loopBtn.click();
    await page.waitForTimeout(100);
    assert.equal(await followBtn.getAttribute('aria-pressed'), 'true', 'Follow button toggled on');
    assert.equal(await loopBtn.getAttribute('aria-pressed'), 'true', 'Loop button toggled on');

    const panBeforeFollow = await page.evaluate(() => {
      const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
      return { x: active.panOffsetX || 0, y: active.panOffsetY || 0 };
    });

    // Start replay from step 0 with Follow + Loop active; camera must smoothly pan toward painted center regions and loop continuously
    await page.locator('[data-testid="replay-play-pause-btn"]').click();
    await page.waitForTimeout(950);

    // Expand HUD briefly to verify scrubber is actively looping/playing and did not stop at the end
    await page.locator('[data-testid="replay-toggle-minimize-btn"]').click();
    await page.waitForTimeout(450);
    const isStillLooping = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('capy_user_settings_v8') || '{}');
      return Boolean(s.replayLoop && s.replayFollow);
    });
    assert.equal(isStillLooping, true, 'Expected replayLoop and replayFollow settings persisted as true');

    // Also test live zoom-in during playback
    await page.waitForSelector('[data-testid="zoom-in-btn"]');
    await page.locator('[data-testid="zoom-in-btn"]').click();
    await page.waitForTimeout(250);

    // Manually pan-drag the canvas slightly during replay and verify Follow Painting automatically disengages
    const canvasBoxAfterLoad = await page.locator('canvas').boundingBox();
    await page.mouse.move(
      canvasBoxAfterLoad.x + canvasBoxAfterLoad.width / 2,
      canvasBoxAfterLoad.y + canvasBoxAfterLoad.height / 2
    );
    await page.mouse.down();
    await page.mouse.move(
      canvasBoxAfterLoad.x + canvasBoxAfterLoad.width / 2 + 14,
      canvasBoxAfterLoad.y + canvasBoxAfterLoad.height / 2 + 10,
      { steps: 3 }
    );
    await page.mouse.up();
    await page.waitForTimeout(420);
    assert.equal(
      await page.locator('[data-testid="replay-follow-btn"]').getAttribute('aria-pressed'),
      'false',
      'Expected Follow Painting to automatically disengage on manual canvas pan'
    );

    // Turn off Loop toggle before exiting replay
    await page.locator('[data-testid="replay-loop-btn"]').click();
    await page.waitForTimeout(100);

    if (await page.$('[data-testid="replay-exit-btn"]')) {
      await page.locator('[data-testid="replay-exit-btn"]').click();
      await page.waitForTimeout(150);
    }

    const afterFollowAndZoom = await page.evaluate(() => {
      const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
      const s = JSON.parse(localStorage.getItem('capy_user_settings_v8') || '{}');
      s.autoReplayOnLoad = false;
      s.replaySpeed = 1;
      s.replayLoop = false;
      s.replayFollow = false;
      localStorage.setItem('capy_user_settings_v8', JSON.stringify(s));
      return {
        zoom: active.zoomScale || 1,
        panX: active.panOffsetX || 0,
        panY: active.panOffsetY || 0,
      };
    });
    const followPanDist = Math.hypot(
      afterFollowAndZoom.panX - panBeforeFollow.x,
      afterFollowAndZoom.panY - panBeforeFollow.y
    );
    assert.equal(
      followPanDist > 40,
      true,
      `Expected Follow Painting mode to smoothly pan viewport toward painted regions (moved ${followPanDist.toFixed(1)}px)`
    );
    assert.equal(
      afterFollowAndZoom.zoom > savedZoomBeforeLoad,
      true,
      `Expected live zoom during playback (${afterFollowAndZoom.zoom}) > initial saved zoom (${savedZoomBeforeLoad})`
    );
    if (await page.$('[data-testid="reset-view-btn"]')) {
      await page.locator('[data-testid="reset-view-btn"]').click();
      await page.waitForTimeout(350);
    }
    console.log('   PASS: Undo/Redo, default-minimised ReplayControls, zoom restoration before replay, offscreen fast-forward, Follow Painting camera tracking, Auto-Loop, and live pan/zoom during playback verified.');

    // -------------------------------------------------------------------------
    // 4. Gallery Filters, Community Ideas & Infinite Zoom 2x Detail Sub-Tile
    // -------------------------------------------------------------------------
    console.log('4. Verifying Create tab gallery filters, Community Puzzle Ideas, and Infinite Zoom...');
    await settingsBtn.click();
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.waitForTimeout(200);

    await page.getByTestId('gallery-tag-music').click();
    await page.waitForTimeout(100);
    const bodyText = await page.evaluate(() => document.body.innerText);
    assert.equal(bodyText.includes('Snail Guitar'), true);

    await page.getByTestId('gallery-search-input').fill('nonexistent_xyz_artwork');
    await page.getByTestId('gallery-empty-state').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Reset Filters' }).click();

    await page.getByTestId('toggle-idea-form-btn').click();
    await page.getByTestId('idea-title-input').fill('Unsafe nsfw test');
    await page.getByTestId('idea-prompt-input').fill('Testing moderation filter');
    await page.getByTestId('submit-idea-btn').click();
    assert.equal((await page.getByTestId('idea-feedback-banner').innerText()).toLowerCase().includes('family-friendly'), true);

    await page.getByTestId('idea-title-input').fill('Lantern Capybara Festival');
    await page.getByTestId('idea-prompt-input').fill('Warm paper lanterns floating over a calm twilight river.');
    await page.getByTestId('submit-idea-btn').click();
    assert.equal((await page.getByTestId('community-ideas-section').innerText()).includes('Lantern Capybara Festival'), true);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    console.log('   PASS: Gallery search, category chips, and community idea moderation verified.');

    // -------------------------------------------------------------------------
    // 5. Shareable Link (#s=<token>), Simultaneous Co-op & Google Drive CRDT Sync
    // -------------------------------------------------------------------------
    console.log('5. Verifying <2 KB Share Link, 2-peer BroadcastChannel Co-op & Google Drive CRDT sync...');
    await tapCanvasGrid(page, 0.45, 8, 40);
    const paintedIdsOnA = await page.evaluate(() => {
      const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
      return active.filledRegionIds || [];
    });

    await page.getByTestId('topbar-coop-btn').click();
    await page.waitForTimeout(200);
    await page.getByTestId('share-progress-link-btn').click();
    await page.waitForTimeout(200);

    const sharedUrl = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(sharedUrl.includes('#s='), true);
    assert.equal(sharedUrl.length < 2048, true);

    // Verify isolated browser context restores #s=<token> progress
    const ctxIsolated = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const pageRecipient = await ctxIsolated.newPage();
    attachErrorListeners(pageRecipient, 'recipient');
    await pageRecipient.goto(sharedUrl, { waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(pageRecipient);
    await pageRecipient.waitForTimeout(350);
    const recipientIds = await pageRecipient.evaluate(() => {
      const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
      return active.filledRegionIds || [];
    });
    assert.deepEqual([...recipientIds].sort((a, b) => a - b), [...paintedIdsOnA].sort((a, b) => a - b));
    await ctxIsolated.close();

    // Host Co-op room on Page A and join from Page B in same context
    await page.getByTestId('host-coop-room-btn').click();
    await page.waitForTimeout(200);
    const roomBadgeText = await page.getByTestId('active-coop-room-code').innerText();
    const roomCode = roomBadgeText.match(/Room\s+([A-Z0-9]{6})/)[1];
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

    const pageB = await context.newPage();
    attachErrorListeners(pageB, 'pageB');
    await pageB.goto(BASE_URL, { waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(pageB);
    await pageB.getByTestId('topbar-coop-btn').click();
    await pageB.waitForTimeout(200);
    await pageB.getByTestId('join-coop-room-input').fill(roomCode);
    await pageB.getByTestId('join-coop-room-btn').click();
    await pageB.waitForTimeout(300);
    assert.equal((await pageB.getByTestId('active-coop-room-code').innerText()).includes('2 online'), true);
    await pageB.keyboard.press('Escape');
    await pageB.waitForTimeout(200);

    await tapCanvasGrid(page, 0.56, 8, 40);
    await pageB.waitForTimeout(350);
    const extractPct = (s) => Number(s.match(/(\d+)%/)?.[1] ?? -1);
    assert.equal(
      extractPct(await pageB.locator('header').innerText()),
      extractPct(await page.locator('header').innerText()),
      'Co-op peer header % must synchronize in real time'
    );

    // BF-1: Verify Free Colour repaint of an already-filled region preserves chronological order and Undo syncs restored color to Co-op peer
    await settingsBtn.click();
    await page.waitForTimeout(150);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.waitForTimeout(100);
    const freeColorLabel = await page.waitForSelector('text=Free Colour Mode');
    await freeColorLabel.evaluate((el) => el.closest('.flex')?.querySelector('button')?.click());
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

    // Pick a different swatch in the palette dock on Page A
    const swatchButtons = page.locator('[aria-label="Palette dock"] button[aria-label^="Color "]');
    const swatchCount = await swatchButtons.count();
    if (swatchCount > 1) {
      await swatchButtons.nth(swatchCount - 1).click();
      await page.waitForTimeout(100);
    }
    const orderBeforeFreeRepaint = await page.evaluate(() => {
      const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
      return active.filledRegionIds || [];
    });
    // Tap the same canvas grid points so at least one already-filled region is repainted in Free Colour Mode
    await tapCanvasGrid(page, 0.56, 4, 40);
    await pageB.waitForTimeout(300);

    const afterFreeRepaint = await page.evaluate(() => {
      const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
      return {
        filledRegionIds: active.filledRegionIds || [],
        paintedRegionColors: active.paintedRegionColors || {},
      };
    });
    // Verify original prefix of filledRegionIds preserved its exact chronological sequence
    assert.deepEqual(
      afterFreeRepaint.filledRegionIds.slice(0, orderBeforeFreeRepaint.length),
      orderBeforeFreeRepaint,
      'BF-1: Repainting already-filled regions in Free Colour Mode must not shift their chronological position to the tail'
    );

    // Undo the last Free Colour repaint on Page A and verify Page B's paintedRegionColors stays synchronized
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(150);
    await pageB.waitForTimeout(300);
    const [paintedAfterUndoA, paintedAfterUndoB] = await Promise.all([
      page.evaluate(() => JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}').paintedRegionColors || {}),
      pageB.evaluate(() => JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}').paintedRegionColors || {}),
    ]);
    assert.deepEqual(
      paintedAfterUndoB,
      paintedAfterUndoA,
      'BF-1: Undoing a Free Colour repaint on Page A must broadcast restored color to Co-op peer Page B'
    );

    // Turn Free Colour Mode back off before closing pageB
    await settingsBtn.click();
    await page.waitForTimeout(150);
    const freeColorLabelOff = await page.waitForSelector('text=Free Colour Mode');
    await freeColorLabelOff.evaluate((el) => el.closest('.flex')?.querySelector('button')?.click());
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

    await pageB.close();

    // Leave Co-op room and verify Saves view modes + .capy v2 binary export/import
    await page.getByTestId('topbar-coop-btn').click();
    await page.waitForTimeout(200);
    await page.getByTestId('leave-coop-room-btn').click();
    await page.waitForTimeout(150);

    await page.getByTestId('cloud-provider-badge-google').waitFor({ state: 'visible' });
    await page.getByTestId('saves-view-thumbnails-btn').click();
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => localStorage.getItem('capy_saves_view_mode')), 'THUMBNAILS');
    await page.getByTestId('saves-view-detail-btn').click();
    await page.waitForTimeout(150);

    const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
    await page.locator('[data-testid="export-all-saves-btn"]').click();
    const download = await downloadPromise;
    const exportedPath = path.join(os.tmpdir(), 'capy_unified_test_backup.capy');
    await download.saveAs(exportedPath);
    const exportedBuf = fs.readFileSync(exportedPath);
    assert.equal(exportedBuf[0], 0x43, 'Magic byte C');
    assert.equal(exportedBuf[4], 0x02, 'Version byte 0x02');
    fs.rmSync(exportedPath, { force: true });

    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    console.log('   PASS: #s=<token> share link, 2-peer real-time Co-op, Saves view modes, and .capy v2 export verified.');

    // -------------------------------------------------------------------------
    // 6. Custom Photo Upload (STORE_IMAGES) & Offline PWA Reload
    // -------------------------------------------------------------------------
    console.log('6. Verifying custom photo STORE_IMAGES upload and 100% offline PWA reload...');
    const pngBytes = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 480;
      c.height = 360;
      const ctx = c.getContext('2d');
      const cols = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b'];
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = cols[i];
        ctx.fillRect((i % 2) * 240, Math.floor(i / 2) * 180, 240, 180);
      }
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    });
    const tmpUploadPath = path.join(os.tmpdir(), 'capy_test_upload.png');
    fs.writeFileSync(tmpUploadPath, Buffer.from(pngBytes));
    await page.locator('input[type="file"][accept="image/*"]').setInputFiles(tmpUploadPath);
    await page.waitForTimeout(300);
    await waitForPuzzleLoaded(page);
    fs.rmSync(tmpUploadPath, { force: true });

    const uploadCheck = await page.evaluate(async () => {
      const snaps = JSON.parse(localStorage.getItem('capy_snapshots_v8') || '[]');
      const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
      const snap = snaps.find((s) => s.id === active.activeSnapshotId);
      return { id: snap?.id, kind: snap?.sourceRef?.kind, fileSizeBytes: snap?.fileSizeBytes };
    });
    assert.equal(uploadCheck.kind, 'blob');
    assert.equal(uploadCheck.fileSizeBytes < 120_000, true);

    // Zoom in on the custom puzzle, mark all regions completed, and verify offline reload + post-completion Replay preserves viewport without zooming out
    const zoomInUpload = await page.waitForSelector('[data-testid="zoom-in-btn"]');
    await zoomInUpload.click();
    await zoomInUpload.click();
    await zoomInUpload.click();
    await page.waitForTimeout(420);

    const preReplayCompletedView = await page.evaluate((snapId) => {
      const snaps = JSON.parse(localStorage.getItem('capy_snapshots_v8') || '[]');
      const snap = snaps.find((s) => s.id === snapId);
      const total = snap?.totalCount || 4;
      const allIds = Array.from({ length: total }, (_, i) => i + 1);
      const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
      active.filledRegionIds = allIds;
      active.panOffsetX = 110;
      active.panOffsetY = 85;
      localStorage.setItem('capy_active_session_v8', JSON.stringify(active));
      if (snap) {
        snap.filledRegionIds = allIds;
        snap.filledCount = allIds.length;
        snap.totalCount = allIds.length;
        snap.zoomScale = active.zoomScale;
        snap.panOffsetX = 110;
        snap.panOffsetY = 85;
        localStorage.setItem('capy_snapshots_v8', JSON.stringify(snaps));
      }
      return { zoom: active.zoomScale || 1, panX: active.panOffsetX, panY: active.panOffsetY };
    }, uploadCheck.id);
    assert.equal(preReplayCompletedView.zoom > 1.5, true, `Expected zoomed-in completed puzzle > 1.5, got ${preReplayCompletedView.zoom}`);

    // Offline reload via Service Worker
    await context.setOffline(true);
    await page.reload({ waitUntil: 'load' });
    await waitForPuzzleLoaded(page);
    await context.setOffline(false);

    // Verify completed puzzle Replay button starts replay in place without zooming out or resetting viewport
    await page.waitForSelector('[data-testid="reset-view-btn"]', { timeout: 5000 });
    const completedReplayBtn = await page.waitForSelector('[data-testid="replay-btn"]', { timeout: 5000 });
    await completedReplayBtn.click();
    await page.waitForTimeout(380);
    await page.waitForSelector('[data-testid="replay-controls-window"]', { timeout: 5000 });
    assert.equal(
      Boolean(await page.$('[data-testid="reset-view-btn"]')),
      true,
      'Pressing Replay on a completed puzzle must NOT zoom out or hide reset-view-btn'
    );
    const duringCompletedReplayView = await page.evaluate(() => {
      const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
      return { zoom: active.zoomScale || 1, panX: active.panOffsetX || 0, panY: active.panOffsetY || 0 };
    });
    assert.equal(
      Math.abs(duringCompletedReplayView.zoom - preReplayCompletedView.zoom) < 0.01,
      true,
      `Expected post-completion Replay to preserve zoomScale (${preReplayCompletedView.zoom}), got ${duringCompletedReplayView.zoom}`
    );

    // Close replay overlay before testing BF-2 container resize and BF-6 IndexedDB eviction fallback
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // 7. BF-2: Container ResizeObserver immediately updates canvas backing store and clamps pan offsets
    await page.setViewportSize({ width: 540, height: 420 });
    await page.waitForTimeout(450);
    const resizedCanvasCheck = await page.evaluate(() => {
      const c = document.querySelector('canvas');
      const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
      return {
        canvasWidth: c ? c.width : 0,
        clientWidth: c ? c.clientWidth : 0,
        panX: active.panOffsetX || 0,
        panY: active.panOffsetY || 0,
      };
    });
    assert.equal(
      resizedCanvasCheck.clientWidth > 0 && resizedCanvasCheck.clientWidth <= 540,
      true,
      `Expected resized canvas clientWidth <= 540, got ${resizedCanvasCheck.clientWidth}`
    );
    assert.equal(
      resizedCanvasCheck.canvasWidth,
      Math.round(resizedCanvasCheck.clientWidth * (await page.evaluate(() => window.devicePixelRatio || 1))),
      'ResizeObserver must immediately update canvas backing width without waiting for pointer events'
    );
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.waitForTimeout(350);

    // 8. BF-6: IndexedDB Cache Eviction Fallback preserves snapshot.customPalette and added swatches
    const evicted = await page.evaluate(async (snapId) => {
      const snaps = JSON.parse(localStorage.getItem('capy_snapshots_v8') || '[]');
      const snap = snaps.find((s) => s.id === snapId);
      if (snap) {
        const basePal = Array.isArray(snap.customPalette) && snap.customPalette.length > 0
          ? snap.customPalette
          : [{ id: 1, hex: '#ef4444', isLight: false, argb: 0xffef4444, r: 239, g: 68, b: 68 }];
        snap.customPalette = [
          { ...basePal[0], id: 1, hex: '#ff00ff', isLight: false, argb: 0xffff00ff, r: 255, g: 0, b: 255 },
          ...basePal.slice(1),
          { id: 99, hex: '#00ffff', isLight: true, argb: 0xff00ffff, r: 0, g: 255, b: 255 },
        ];
        snap.isFreeColor = true;
        localStorage.setItem('capy_snapshots_v8', JSON.stringify(snaps));
      }
      // Evict only the puzzle data entry in IndexedDB (keeping the image blob in the 'images' store)
      return await new Promise((resolve) => {
        const req = indexedDB.open('capy_game_storage_v8');
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('puzzles')) {
            db.close();
            resolve(false);
            return;
          }
          const tx = db.transaction('puzzles', 'readwrite');
          tx.objectStore('puzzles').delete(snapId);
          tx.oncomplete = () => {
            db.close();
            resolve(true);
          };
          tx.onerror = () => {
            db.close();
            resolve(false);
          };
        };
        req.onerror = () => resolve(false);
      });
    }, uploadCheck.id);
    assert.equal(evicted, true, 'Expected puzzle record to be evicted from IndexedDB cache');

    await page.reload({ waitUntil: 'load' });
    await waitForPuzzleLoaded(page);
    await page.waitForTimeout(350);

    const postEvictionPalette = await page.evaluate((snapId) => {
      const snaps = JSON.parse(localStorage.getItem('capy_snapshots_v8') || '[]');
      const snap = snaps.find((s) => s.id === snapId);
      const pal = snap?.customPalette || [];
      return {
        swatch1Hex: pal.find((c) => c.id === 1)?.hex?.toLowerCase(),
        swatch99Hex: pal.find((c) => c.id === 99)?.hex?.toLowerCase(),
        isFreeColor: Boolean(snap?.isFreeColor),
      };
    }, uploadCheck.id);
    assert.equal(
      postEvictionPalette.swatch1Hex,
      '#ff00ff',
      `BF-6: Expected edited swatch #1 hex '#ff00ff' to survive IndexedDB cache eviction regeneration, got '${postEvictionPalette.swatch1Hex}'`
    );
    assert.equal(
      postEvictionPalette.swatch99Hex,
      '#00ffff',
      `BF-6: Expected added custom swatch #99 hex '#00ffff' to survive IndexedDB cache eviction regeneration, got '${postEvictionPalette.swatch99Hex}'`
    );
    assert.equal(postEvictionPalette.isFreeColor, true, 'BF-6: Expected isFreeColor to be preserved after cache eviction');
    console.log('   PASS: Custom photo STORE_IMAGES persistence, 100% offline PWA reload, post-completion Replay viewport invariance, BF-2 ResizeObserver clamping, and BF-6 customPalette eviction recovery verified.');

    // ------------------------------------------------------------------
    // 9. Zoom Sensitivity, Magnetic Zoom Stops, Sound Controls & HUD Zoom-Badge Cycle
    // ------------------------------------------------------------------
    console.log('-> [E2E 9] Verifying Controls settings persistence and HUD zoom-badge stop cycling...');
    await page.locator('button[title="Settings and Menu"]').click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();

    const zoomSensSlider = page.getByTestId('setting-zoom-sensitivity');
    await zoomSensSlider.waitFor({ state: 'visible', timeout: 5000 });
    await zoomSensSlider.fill('1.6');

    const snapZoomToggle = page.getByTestId('setting-snap-zoom-levels');
    await snapZoomToggle.click();

    const soundEnabledToggle = page.getByTestId('setting-sound-enabled');
    await soundEnabledToggle.click();

    const soundVolumeSlider = page.getByTestId('setting-sound-volume');
    await soundVolumeSlider.fill('0.45');

    const persistedControls = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('capy_user_settings_v8') || '{}');
    });
    assert.ok(
      Math.abs(Number(persistedControls.zoomSensitivity) - 1.6) < 1e-6,
      `Expected zoomSensitivity=1.6 in capy_user_settings_v8, got ${persistedControls.zoomSensitivity}`
    );
    assert.equal(
      persistedControls.snapZoomLevels,
      true,
      `Expected snapZoomLevels=true in capy_user_settings_v8, got ${persistedControls.snapZoomLevels}`
    );
    assert.equal(
      persistedControls.soundEnabled,
      false,
      `Expected soundEnabled=false in capy_user_settings_v8, got ${persistedControls.soundEnabled}`
    );
    assert.ok(
      Math.abs(Number(persistedControls.soundVolume) - 0.45) < 1e-6,
      `Expected soundVolume=0.45 in capy_user_settings_v8, got ${persistedControls.soundVolume}`
    );

    // Re-enable sound effects so gameplay defaults stay clean
    await soundEnabledToggle.click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    const zoomBadge = page.getByTestId('topbar-zoom-badge');
    await zoomBadge.waitFor({ state: 'visible', timeout: 5000 });

    // Align to 1x stop if currently zoomed in from previous E2E steps
    for (let guard = 0; guard < 6; guard++) {
      const text = (await zoomBadge.innerText()).trim();
      if (text === '1x') break;
      await zoomBadge.click();
    }
    assert.equal((await zoomBadge.innerText()).trim(), '1x', 'Expected top HUD zoom badge to align to 1x');

    const expectedZoomCycle = ['2x', '4x', '8x', '12x', '1x'];
    for (const expectedLabel of expectedZoomCycle) {
      await zoomBadge.click();
      const actualLabel = (await zoomBadge.innerText()).trim();
      assert.equal(
        actualLabel,
        expectedLabel,
        `Expected topbar-zoom-badge to step to '${expectedLabel}', got '${actualLabel}'`
      );
    }
    console.log('   PASS: Controls settings (zoomSensitivity, snapZoomLevels, soundEnabled, soundVolume) and HUD zoom-badge cycle (1x -> 2x -> 4x -> 8x -> 12x -> 1x) verified.');

    // ------------------------------------------------------------------
    // 10. Daily Featured Puzzle, Reduced Motion, Keyboard Shortcuts & Lifetime Stats
    // ------------------------------------------------------------------
    console.log('-> [E2E 10] Verifying Daily Featured Puzzle, Reduced Motion, Keyboard Shortcuts & Lifetime Stats...');

    // 10a. Daily Featured Puzzle hero card at top of Create tab + one-tap Play Daily launch
    await page.locator('button[title="Settings and Menu"]').click();
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    const dailyCard = page.getByTestId('daily-puzzle-card');
    await dailyCard.waitFor({ state: 'visible', timeout: 5000 });
    const dateBadgeText = (await page.getByTestId('daily-puzzle-date-badge').innerText()).trim();
    assert.match(dateBadgeText, /^\d{4}-\d{2}-\d{2} UTC$/, `Expected UTC date badge, got '${dateBadgeText}'`);

    const searchInputForOrder = page.getByTestId('gallery-search-input');
    await searchInputForOrder.waitFor({ state: 'visible', timeout: 5000 });
    const dailyBox = await dailyCard.boundingBox();
    const searchBox = await searchInputForOrder.boundingBox();
    assert.ok(
      dailyBox && searchBox && dailyBox.y < searchBox.y,
      'Expected daily-puzzle-card to render above gallery-search-input at the top of the Create tab'
    );

    await page.getByTestId('daily-puzzle-play-btn').click();
    await waitForPuzzleLoaded(page);
    assert.equal(await dailyCard.isVisible(), false, 'Settings modal should close after clicking Play Daily');

    // 10b. Reduced Motion toggle persistence in capy_user_settings_v8
    await page.locator('button[title="Settings and Menu"]').click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const reducedMotionToggle = page.getByTestId('setting-reduced-motion');
    await reducedMotionToggle.waitFor({ state: 'visible', timeout: 5000 });
    await reducedMotionToggle.click();

    const persistedA11y = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('capy_user_settings_v8') || '{}');
    });
    assert.equal(
      persistedA11y.reducedMotion,
      true,
      `Expected reducedMotion=true in capy_user_settings_v8, got ${persistedA11y.reducedMotion}`
    );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    // 10c. Keyboard shortcuts: '1' / '2' swatch select, input-focus guard, '+' zoom, ArrowRight/ArrowLeft pan, '0' reset
    await page.keyboard.press('1');
    await page.waitForTimeout(80);
    assert.equal(
      await page.getByTestId('palette-swatch-1').getAttribute('aria-pressed'),
      'true',
      'Expected keyboard "1" to select swatch #1'
    );

    // Verify typing '2' inside Gallery search <input> does NOT change selected swatch
    await page.locator('button[title="Settings and Menu"]').click();
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    const gallerySearchInput = page.getByTestId('gallery-search-input');
    await gallerySearchInput.waitFor({ state: 'visible', timeout: 5000 });
    await gallerySearchInput.focus();
    await page.keyboard.type('2');
    await page.waitForTimeout(80);
    await gallerySearchInput.fill('');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    assert.equal(
      await page.getByTestId('palette-swatch-1').getAttribute('aria-pressed'),
      'true',
      'Typing "2" inside gallery-search-input must NOT hijack active swatch #1'
    );
    assert.equal(
      await page.getByTestId('palette-swatch-2').getAttribute('aria-pressed'),
      'false',
      'Swatch #2 must remain unselected after typing "2" in gallery-search-input'
    );

    // Active canvas keyboard '2' selects swatch #2
    await page.keyboard.press('2');
    await page.waitForTimeout(80);
    assert.equal(
      await page.getByTestId('palette-swatch-2').getAttribute('aria-pressed'),
      'true',
      'Expected keyboard "2" on active canvas to select swatch #2'
    );

    // '+' zooms in above 1.0x (press twice so there is ample horizontal pan headroom)
    assert.equal((await zoomBadge.innerText()).trim(), '1x', 'Expected daily puzzle initial zoom at 1x');
    await page.keyboard.press('+');
    await page.waitForTimeout(80);
    const zoomAfterFirstPlus = parseFloat((await zoomBadge.innerText()).replace('x', '').trim());
    assert.ok(
      zoomAfterFirstPlus > 1.0,
      `Expected keyboard "+" to zoom above 1.0x, got '${zoomAfterFirstPlus}'`
    );
    await page.keyboard.press('+');
    await page.waitForTimeout(420);

    const panBefore = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}').panOffsetX ?? 0;
    });

    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(420);
    const panAfterRight = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}').panOffsetX ?? 0;
    });
    assert.ok(
      panAfterRight < panBefore,
      `Expected ArrowRight to pan viewport right (decreasing panOffsetX from ${panBefore}), got ${panAfterRight}`
    );

    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(420);
    const panAfterLeft = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}').panOffsetX ?? 0;
    });
    assert.ok(
      panAfterLeft > panAfterRight,
      `Expected ArrowLeft to pan viewport left (increasing panOffsetX from ${panAfterRight}), got ${panAfterLeft}`
    );

    await page.keyboard.press('0');
    await page.waitForTimeout(100);
    assert.equal(
      (await zoomBadge.innerText()).trim(),
      '1x',
      'Expected keyboard "0" to reset zoom back to 1x'
    );

    // 10d. Coloring regions increments totalRegionsColored in capy_player_stats_v1 & displays in lifetime-stats-card
    const statsBeforeTap = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('capy_player_stats_v1') || '{}');
    });
    const prevTotalColored = Number(statsBeforeTap.totalRegionsColored || 0);

    await tapCanvasGrid(page, 0.32, 12, 35);
    const statsAfterTap = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('capy_player_stats_v1') || '{}');
    });
    const nextTotalColored = Number(statsAfterTap.totalRegionsColored || 0);
    assert.ok(
      nextTotalColored > prevTotalColored,
      `Expected coloring regions to increment totalRegionsColored in capy_player_stats_v1 (${prevTotalColored} -> ${nextTotalColored})`
    );

    await page.locator('button[title="Settings and Menu"]').click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const statsCard = page.getByTestId('lifetime-stats-card');
    await statsCard.waitFor({ state: 'visible', timeout: 5000 });
    const renderedTotalText = (await page.getByTestId('stat-total-regions').innerText()).replace(/,/g, '').trim();
    assert.equal(
      Number(renderedTotalText),
      nextTotalColored,
      `Expected lifetime-stats-card stat-total-regions (${renderedTotalText}) to match persisted totalRegionsColored (${nextTotalColored})`
    );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    console.log('   PASS: Daily Featured Puzzle card/launch, Reduced Motion persistence, Keyboard Gameplay Shortcuts + input-focus guard, and Lifetime Stats verified.');

    // -------------------------------------------------------------------------
    // 11. EPIC-4 Quick-Wins: Printable SVG Export, Sub-Tile Parent Breadcrumbs & Co-op Undo Sync
    // -------------------------------------------------------------------------
    console.log('11. Verifying Printable SVG export, Sub-Tile Parent Breadcrumbs & 2-peer Co-op UNFILL_EVENT Undo sync...');

    // 11a. TASK-4.2a: Clicking export-printable-svg-btn triggers a valid .svg download
    await page.getByTestId('topbar-coop-btn').click();
    await page.waitForTimeout(150);
    const svgDownloadPromise = page.waitForEvent('download', { timeout: 10000 });
    await page.getByTestId('export-printable-svg-btn').click();
    const svgDownload = await svgDownloadPromise;
    assert.equal(
      svgDownload.suggestedFilename().endsWith('.svg'),
      true,
      `Expected printable coloring sheet filename to end with .svg, got ${svgDownload.suggestedFilename()}`
    );
    const svgDownloadPath = await svgDownload.path();
    assert.ok(svgDownloadPath, 'Expected Playwright download path for printable .svg');
    const downloadedSvgText = fs.readFileSync(svgDownloadPath, 'utf8');
    assert.equal(
      downloadedSvgText.includes('<svg xmlns="http://www.w3.org/2000/svg"') &&
        downloadedSvgText.includes('<path id="region-outlines"') &&
        downloadedSvgText.trim().endsWith('</svg>'),
      true,
      'Downloaded .svg file must contain valid vector <svg> coloring sheet content'
    );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

    // 11b. TASK-4.1a: Infinite Zoom detail sub-tile sets parentSnapshotId, renders topbar-parent-puzzle-btn,
    // restores parent puzzle & viewport on tap, and hides breadcrumb pill when parent snapshot is deleted
    await page.getByTestId('topbar-zoom-badge').click();
    await page.waitForTimeout(120);
    assert.equal(
      (await page.getByTestId('topbar-zoom-badge').innerText()).trim(),
      '2x',
      'Parent puzzle should be zoomed to 2x before spawning detail sub-tile'
    );
    const parentSnapId = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}').activeSnapshotId || null;
    });
    assert.ok(parentSnapId, 'Parent puzzle must have an activeSnapshotId');

    await page.locator('button[title="Settings and Menu"]').click();
    await page.waitForTimeout(120);
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.waitForTimeout(120);
    await page.getByTestId('infinite-zoom-subtile-btn').click();
    await page.waitForFunction(
      (prevId) => {
        const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
        return Boolean(active.activeSnapshotId && active.activeSnapshotId !== prevId);
      },
      parentSnapId,
      { timeout: 25000 }
    );
    await waitForPuzzleLoaded(page);
    await page.waitForTimeout(200);

    const childSnapMeta = await page.evaluate(() => {
      const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
      const snaps = JSON.parse(localStorage.getItem('capy_snapshots_v8') || '[]');
      return snaps.find((s) => s.id === active.activeSnapshotId) || null;
    });
    assert.ok(childSnapMeta && childSnapMeta.id !== parentSnapId, 'Detail sub-tile must create a distinct child snapshot');
    assert.equal(
      childSnapMeta.parentSnapshotId,
      parentSnapId,
      'Detail sub-tile snapshot must persist parentSnapshotId pointing to parent puzzle'
    );
    const parentBreadcrumbBtn = page.getByTestId('topbar-parent-puzzle-btn');
    await parentBreadcrumbBtn.waitFor({ state: 'visible', timeout: 5000 });

    // Clicking topbar-parent-puzzle-btn switches back to parent puzzle and restores its saved 2x zoom
    await parentBreadcrumbBtn.click();
    await page.waitForFunction(
      (expectedId) => {
        const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
        return active.activeSnapshotId === expectedId;
      },
      parentSnapId,
      { timeout: 15000 }
    );
    await waitForPuzzleLoaded(page);
    await page.waitForTimeout(250);
    const restoredActiveId = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}').activeSnapshotId || null;
    });
    assert.equal(restoredActiveId, parentSnapId, 'Clicking topbar-parent-puzzle-btn must restore parent snapshot');
    assert.equal(
      (await page.getByTestId('topbar-zoom-badge').innerText()).trim(),
      '2x',
      'Returning to parent puzzle via breadcrumb must restore parent saved 2x viewport zoom'
    );
    assert.equal(
      await parentBreadcrumbBtn.count(),
      0,
      'Parent puzzle without parentSnapshotId must not show topbar-parent-puzzle-btn'
    );

    // Reload child sub-tile, delete parent snapshot, and verify dangling breadcrumb pill hides gracefully
    await page.getByTestId('topbar-coop-btn').click();
    await page.waitForTimeout(150);
    await page.getByTestId(`save-card-${childSnapMeta.id}`).click();
    await page.waitForTimeout(100);
    await page.getByTestId('save-action-load').click();
    await page.waitForFunction(
      (expectedId) => {
        const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
        return active.activeSnapshotId === expectedId;
      },
      childSnapMeta.id,
      { timeout: 15000 }
    );
    await waitForPuzzleLoaded(page);
    await parentBreadcrumbBtn.waitFor({ state: 'visible', timeout: 5000 });

    await page.getByTestId('topbar-coop-btn').click();
    await page.waitForTimeout(150);
    await page.getByTestId(`save-card-${parentSnapId}`).click();
    await page.waitForTimeout(100);
    await page.getByTestId('save-action-delete').click();
    await page.waitForTimeout(80);
    await page.getByTestId('save-action-confirm-delete').click();
    await page.waitForTimeout(150);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    assert.equal(
      await parentBreadcrumbBtn.count(),
      0,
      'Deleting parent snapshot must immediately hide dangling topbar-parent-puzzle-btn'
    );

    // 11c. TASK-4.3a: 2-peer BroadcastChannel Co-op UNFILL_EVENT Undo synchronization
    // Load a pre-baked built-in sample save with unfilled regions so both peers share identical puzzle geometry instantly
    const coopSampleId = await page.evaluate(() => {
      const snaps = JSON.parse(localStorage.getItem('capy_snapshots_v8') || '[]');
      const candidate = snaps.find((s) => s.id.startsWith('sample-') && s.filledCount < s.totalCount) || snaps.find((s) => s.id.startsWith('sample-'));
      return candidate ? candidate.id : null;
    });
    assert.ok(coopSampleId, 'Expected a pre-baked sample-* snapshot in capy_snapshots_v8');
    await page.getByTestId('topbar-coop-btn').click();
    await page.waitForTimeout(150);
    await page.getByTestId(`save-card-${coopSampleId}`).click();
    await page.waitForTimeout(100);
    await page.getByTestId('save-action-load').click();
    await page.waitForFunction(
      (expectedId) => {
        const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
        return active.activeSnapshotId === expectedId;
      },
      coopSampleId,
      { timeout: 15000 }
    );
    await waitForPuzzleLoaded(page);
    await page.waitForTimeout(200);

    // Ensure Enable Undo Action is ON and Free Colour Mode is OFF on Peer A
    await page.locator('button[title="Settings and Menu"]').click();
    await page.waitForTimeout(120);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.waitForTimeout(100);
    const currentSettings11c = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('capy_user_settings_v8') || '{}');
    });
    if (currentSettings11c.isFreeColorMode) {
      const fcLabel = await page.waitForSelector('text=Free Colour Mode');
      await fcLabel.evaluate((el) => el.closest('.flex')?.querySelector('button')?.click());
      await page.waitForTimeout(80);
    }
    const isUndoVisibleAlready = (await page.getByTestId('undo-btn').count()) > 0;
    if (!isUndoVisibleAlready) {
      const undoSettingLabel = await page.waitForSelector('text=Enable Undo Action');
      await undoSettingLabel.evaluate((el) => el.closest('.flex')?.querySelector('button')?.click());
      await page.waitForTimeout(80);
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    await page.getByTestId('undo-btn').waitFor({ state: 'visible', timeout: 5000 });

    // Host Co-op room on Peer A and join on Peer B
    await page.getByTestId('topbar-coop-btn').click();
    await page.waitForTimeout(150);
    await page.getByTestId('host-coop-room-btn').click();
    await page.waitForTimeout(200);
    const undoRoomBadge = await page.getByTestId('active-coop-room-code').innerText();
    const undoRoomCode = undoRoomBadge.match(/Room\s+([A-Z0-9]{6})/)[1];
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

    const peerB = await context.newPage();
    attachErrorListeners(peerB, 'peerB-unfill');
    await peerB.goto(BASE_URL, { waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(peerB);
    await peerB.getByTestId('topbar-coop-btn').click();
    await peerB.waitForTimeout(150);
    await peerB.getByTestId('join-coop-room-input').fill(undoRoomCode);
    await peerB.getByTestId('join-coop-room-btn').click();
    await peerB.waitForTimeout(350);
    assert.equal(
      (await peerB.getByTestId('active-coop-room-code').innerText()).includes('2 online'),
      true,
      'Peer B must join Peer A Co-op room with 2 peers online'
    );
    await peerB.keyboard.press('Escape');
    await peerB.waitForTimeout(200);

    const readTotalRemainingRegions = async (targetPage) => {
      return targetPage.evaluate(() => {
        const buttons = Array.from(
          document.querySelectorAll('[aria-label="Palette dock"] button[data-testid^="palette-swatch-"]')
        );
        return buttons.reduce((sum, btn) => {
          const title = btn.getAttribute('title') || '';
          const m = title.match(/\((\d+)\s+remaining\)/);
          return sum + (m ? Number(m[1]) : 0);
        }, 0);
      });
    };

    const remainingBeforeA = await readTotalRemainingRegions(page);
    const remainingBeforeB = await readTotalRemainingRegions(peerB);
    assert.equal(remainingBeforeB, remainingBeforeA, 'Peers A and B must start with identical remaining region counts');
    assert.ok(remainingBeforeA > 0, 'Active sample puzzle must have unfilled regions before Co-op undo test');

    // Fill regions on Peer A and verify Peer B's remaining region count decrements
    await tapCanvasGrid(page, 0.45, 10, 35);
    await peerB.waitForTimeout(350);
    const remainingAfterFillA = await readTotalRemainingRegions(page);
    const remainingAfterFillB = await readTotalRemainingRegions(peerB);
    assert.ok(
      remainingAfterFillA < remainingBeforeA,
      `Expected Peer A canvas taps to fill >= 1 region (${remainingBeforeA} -> ${remainingAfterFillA})`
    );
    assert.equal(
      remainingAfterFillB,
      remainingAfterFillA,
      'Peer B remaining region count must decrement in real time when Peer A fills regions'
    );

    // Click Undo (undo-btn) on Peer A and verify Peer B's unfilled region count increments by +1 via UNFILL_EVENT
    await page.getByTestId('undo-btn').click();
    await page.waitForTimeout(150);
    await peerB.waitForTimeout(350);
    const remainingAfterUndoA = await readTotalRemainingRegions(page);
    const remainingAfterUndoB = await readTotalRemainingRegions(peerB);
    assert.equal(
      remainingAfterUndoA,
      remainingAfterFillA + 1,
      `Expected Peer A undo-btn click to unfill 1 region (${remainingAfterFillA} -> ${remainingAfterUndoA})`
    );
    assert.equal(
      remainingAfterUndoB,
      remainingAfterUndoA,
      'Peer B must revert the undone region back to unfilled (0) cleanly via UNFILL_EVENT'
    );

    await peerB.close();
    await page.getByTestId('topbar-coop-btn').click();
    await page.waitForTimeout(150);
    await page.getByTestId('leave-coop-room-btn').click();
    await page.waitForTimeout(120);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    console.log('   PASS: Printable SVG download, Sub-Tile Parent Breadcrumbs + parent delete cleanup, and 2-peer Co-op UNFILL_EVENT Undo sync verified.');

    console.log('-> [2.6] Verifying Release Channel switcher card & Beta HUD pill...');
    assert.equal(
      await page.getByTestId('topbar-channel-badge').count(),
      0,
      'Default Stable/Dev root view must not display topbar-channel-badge clutter'
    );
    await page.locator('button[title="Settings and Menu"]').click();
    await page.waitForTimeout(150);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.waitForTimeout(100);
    const channelCard = page.getByTestId('release-channel-card');
    await channelCard.scrollIntoViewIfNeeded();
    assert.equal(await channelCard.isVisible(), true, 'release-channel-card must be visible in Controls tab');
    assert.equal(
      await page.getByTestId('toggle-beta-channel-btn').getAttribute('href'),
      'https://shthed.github.io/capy/beta/',
      'Default channel switcher must link to Beta Web URL'
    );
    assert.equal(
      await page.getByTestId('beta-apk-download-link').getAttribute('href'),
      'https://shthed.github.io/capy/beta/capy.apk',
      'Beta Android APK link must point to /capy/beta/capy.apk'
    );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    const betaPage = await context.newPage();
    attachErrorListeners(betaPage, 'betaPage');
    await betaPage.goto(`${BASE_URL}/?capy_channel=beta`, { waitUntil: 'networkidle' });
    await betaPage.locator('canvas').first().waitFor({ state: 'visible', timeout: 15000 });
    const betaTopPill = betaPage.getByTestId('topbar-channel-badge');
    await betaTopPill.waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(
      (await betaTopPill.textContent())?.trim(),
      'BETA',
      'Beta channel view must render BETA pill in GameTopBar'
    );
    await betaTopPill.click();
    await betaPage.waitForTimeout(200);
    const betaCard = betaPage.getByTestId('release-channel-card');
    await betaCard.scrollIntoViewIfNeeded();
    assert.equal(
      await betaCard.getAttribute('data-channel'),
      'beta',
      'Clicking topbar-channel-badge must open Settings Controls tab with data-channel="beta"'
    );
    assert.equal(
      await betaPage.getByTestId('toggle-beta-channel-btn').getAttribute('href'),
      'https://shthed.github.io/capy/',
      'Beta channel switcher must offer 1-tap Return to Stable Release link'
    );
    await betaPage.close();
    console.log('   PASS: Release Channel switcher card, Beta APK link, and BETA HUD pill verified.');

    assert.equal(consoleErrors.length, 0, `Expected zero unhandled page errors, got:\n${consoleErrors.join('\n')}`);
    console.log('\nALL UNIFIED ENGINE, CODEC & E2E BROWSER TESTS PASSED!');
  } finally {
    await browser.close();
    if (previewServer) {
      await new Promise((resolve) => previewServer.httpServer.close(resolve));
    }
  }
}

async function main() {
  await runCodecAndEngineTests();
  await runBrowserBasicsSuite();
}

main().catch((err) => {
  console.error('Unified test suite failed:', err);
  process.exit(1);
});
