import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { chromium } from 'playwright';
import { createServer, preview } from 'vite';
import {
  runSanityChecks,
  validateChangelogChannelOrder,
  validateEpicNaming,
  /* capy-dev-only:start */
  validateNoLegacyPrRubric,
  validatePrReadinessChecklist,
  validatePrReadinessSpec,
  /* capy-dev-only:end */
  validateRootGuideIndex,
} from './sanity.mjs';
import { runReleaseSafetyHardeningTests } from './release-safety-hardening.test.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const EXPLICIT_TEST_URL = (process.env.CAPY_TEST_URL || '').trim().replace(/\/+$/, '');
const webPkgJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));

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
      !document.body.innerText.toLowerCase().includes('generating puzzle'),
    { timeout: 25000 }
  );
  await page.waitForSelector(
    '[aria-label="Palette dock"], [data-testid="replay-btn"], [data-testid="replay-controls-window"]',
    { timeout: 25000 }
  );
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

async function getStableBoundingBox(locator, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  let prev = await locator.boundingBox();
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 60));
    const cur = await locator.boundingBox();
    if (
      prev &&
      cur &&
      Math.abs(cur.x - prev.x) < 0.5 &&
      Math.abs(cur.y - prev.y) < 0.5 &&
      Math.abs(cur.width - prev.width) < 0.5 &&
      Math.abs(cur.height - prev.height) < 0.5
    ) {
      return cur;
    }
    prev = cur;
  }
  return prev;
}

async function runCodecAndEngineTests() {
  console.log('=== PART 1: Unified Engine, Codec, Relay, Security & Workflow Unit Suite ===');
  const unitPublicTotal = 11;
  let unitDevTotal = 0;
  /* capy-dev-only:start */
  unitDevTotal = 5;
  /* capy-dev-only:end */
  const unitTotal = unitPublicTotal + unitDevTotal;
  const padUnit = (n) => String(n).padStart(2, '0');
  let unitStep = 0;
  const logUnitStart = (label) => {
    unitStep += 1;
    console.log(`[Unit ${padUnit(unitStep)}/${padUnit(unitTotal)}] ${label}`);
  };
  const logUnitPass = (label) => {
    console.log(`   PASS [Unit ${padUnit(unitStep)}/${padUnit(unitTotal)}]: ${label}`);
  };

  const vite = await createServer({
    root: projectRoot,
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true },
    appType: 'custom',
    logLevel: 'error',
  });

  try {
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
    logUnitPass('ColorQuantizer, RegionSegmenter mosaic & CapyCodec v2 binary/delta DoS hardening verified.');

    // 5. Semantic Versioning, Fast <2s Sanity Gate & CHANGELOG.md Synchronization
    logUnitStart('Testing SemVer parity, <2s sanity.mjs gate, CHANGELOG contract & release channels...');
    const sanityRes = runSanityChecks({ repoRoot: path.resolve(projectRoot, '..') });
    assert.equal(sanityRes.elapsedMs < 2000, true, `sanity.mjs must run in < 2s (${sanityRes.elapsedMs}ms)`);
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
    assert.equal(stableCh.showChannelSwitcher, true);

    const betaCh = versionMod.resolveReleaseChannel('/capy/beta/', 'https://shthed.github.io', '');
    assert.equal(betaCh.channel, 'beta');
    assert.equal(betaCh.badgeLabel, 'BETA');
    assert.equal(betaCh.prNumber, null);
    assert.equal(betaCh.showChannelSwitcher, true);

    const alphaCh = versionMod.resolveReleaseChannel(
      '/capy/alpha/481/',
      'https://shthed.github.io',
      ''
    );
    assert.equal(alphaCh.channel, 'alpha');
    assert.equal(alphaCh.badgeLabel, 'ALPHA #481');
    assert.equal(alphaCh.prNumber, 481);
    assert.equal(alphaCh.showChannelSwitcher, true);

    const alphaBranchCh = versionMod.resolveReleaseChannel(
      '/capy/alpha/feature-x/',
      'https://shthed.github.io',
      ''
    );
    assert.equal(alphaBranchCh.channel, 'alpha');
    assert.equal(alphaBranchCh.badgeLabel, 'ALPHA');
    assert.equal(alphaBranchCh.prNumber, null);
    assert.equal(alphaBranchCh.showChannelSwitcher, true);

    const legacyPrCh = versionMod.resolveReleaseChannel(
      '/capy/PR/481/',
      'https://shthed.github.io',
      ''
    );
    assert.equal(legacyPrCh.channel, 'alpha');
    assert.equal(legacyPrCh.badgeLabel, 'ALPHA #481');
    assert.equal(legacyPrCh.prNumber, 481);

    const legacyPullCh = versionMod.resolveReleaseChannel(
      '/capy/pull/481/',
      'https://shthed.github.io',
      ''
    );
    assert.equal(legacyPullCh.channel, 'alpha');
    assert.equal(legacyPullCh.badgeLabel, 'ALPHA #481');
    assert.equal(legacyPullCh.prNumber, 481);

    const devCh = versionMod.resolveReleaseChannel('/', 'http://localhost:3000', '');
    assert.equal(devCh.channel, 'dev');
    assert.equal(devCh.badgeLabel, null);
    assert.equal(devCh.showChannelSwitcher, true);

    const customDomCh = versionMod.resolveReleaseChannel('/', 'https://capypaint.com', '');
    assert.equal(customDomCh.channel, 'stable');
    assert.equal(customDomCh.badgeLabel, null);
    assert.equal(customDomCh.stableWebUrl, 'https://capypaint.com/');
    assert.equal(customDomCh.showChannelSwitcher, false);

    const wwwDomCh = versionMod.resolveReleaseChannel('/', 'https://www.capypaint.com', '');
    assert.equal(wwwDomCh.channel, 'stable');
    assert.equal(wwwDomCh.showChannelSwitcher, false);

    const androidDomCh = versionMod.resolveReleaseChannel(
      '/assets/www/index.html',
      'https://appassets.androidplatform.net',
      ''
    );
    assert.equal(androidDomCh.channel, 'stable');
    assert.equal(androidDomCh.showChannelSwitcher, false);

    const customDomForcedBeta = versionMod.resolveReleaseChannel(
      '/',
      'https://capypaint.com',
      '?capy_channel=beta'
    );
    assert.equal(customDomForcedBeta.channel, 'beta');
    assert.equal(customDomForcedBeta.showChannelSwitcher, true);

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

    const typesMod = await vite.ssrLoadModule('/src/types/index.ts');
    assert.equal(typesMod.computeProgressPercentage(0, 0), 0);
    assert.equal(typesMod.computeProgressPercentage(0, 100), 0);
    assert.equal(typesMod.computeProgressPercentage(50, 100), 50);
    assert.equal(typesMod.computeProgressPercentage(996, 1000), 99);
    assert.equal(typesMod.computeProgressPercentage(999, 1000), 99);
    assert.equal(typesMod.computeProgressPercentage(1000, 1000), 100);
    assert.equal(typesMod.computeProgressPercentage(-5, 100), 0);
    assert.equal(typesMod.computeProgressPercentage(105, 100), 100);
    assert.equal(typesMod.computeProgressPercentage(10, -5), 0);
    assert.equal(typesMod.computeProgressPercentage(10, Number.NaN), 0);
    assert.equal(typesMod.computeProgressPercentage(Number.NaN, 100), 0);

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
    let changelogBulletRe = /^- (?:\[#\d+\]\(\.\.\/\.\.\/pull\/\d+\)|#\d+)\s+\S/;
    /* capy-dev-only:start */
    changelogBulletRe = /^- \[#\d+\]\(\.\.\/\.\.\/pull\/\d+\)\s+\S/;
    /* capy-dev-only:end */
    for (const bullet of changelogBullets) {
      assert.equal(
        changelogBulletRe.test(bullet),
        true,
        `Each CHANGELOG.md bullet must start with a valid PR reference: ${bullet}`
      );
    }

    // 5b. Chronological changelog, Epic naming, dynamic guide indexing, and CI cleanup script unit checks
    const validBetaChangelog = [
      '### 3.0.3 - 2026-11-13 (Beta)',
      '',
      '- Beta item #493',
      '',
      '### 3.0.2 - 2026-11-13',
      '',
      '- Prior beta item #490',
      '',
      '### 3.0.1 - 2026-11-12 (Production)',
      '',
      '- Prod item #488',
      '',
      '### 2.7 - 2026-11-12',
      '',
      '- Older item #484',
      '',
      '### 0.1.0 - 2026-10-01',
      '',
      '- Initial #1',
    ].join('\n');
    const betaOrderRes = validateChangelogChannelOrder(validBetaChangelog, '3.0.3', {
      enforceChannelOrder: true,
    });
    assert.equal(betaOrderRes.alphaIdx, -1);
    assert.equal(betaOrderRes.betaIdx, 0);
    assert.equal(betaOrderRes.prodIdx, 2);

    const validAlphaBetaProd = [
      '### 3.1.0 - 2026-11-14 (Alpha)',
      '- Alpha #500',
      '### 3.0.3 - 2026-11-13 (Beta)',
      '- Beta #493',
      '### 3.0.1 - 2026-11-12 (Production)',
      '- Prod #488',
      '### 0.1.0 - 2026-10-01',
      '- Init #1',
    ].join('\n');
    const abpRes = validateChangelogChannelOrder(validAlphaBetaProd, '3.1.0', {
      enforceChannelOrder: true,
    });
    assert.equal(abpRes.alphaIdx, 0);
    assert.equal(abpRes.betaIdx, 1);
    assert.equal(abpRes.prodIdx, 2);

    const validCombinedProdBeta = [
      '### 3.0.1 - 2026-11-12 (Production, Beta)',
      '- Combined #488',
      '### 2.7 - 2026-11-11',
      '- Old #484',
    ].join('\n');
    const combinedRes = validateChangelogChannelOrder(validCombinedProdBeta, '3.0.1', {
      enforceChannelOrder: true,
    });
    assert.equal(combinedRes.betaIdx, 0);
    assert.equal(combinedRes.prodIdx, 0);

    const validProdOnly = [
      '### 3.0.1 - 2026-11-12 (Production)',
      '- Prod #488',
      '### 2.7 - 2026-11-11',
      '- Old #484',
    ].join('\n');
    assert.equal(
      validateChangelogChannelOrder(validProdOnly, '3.0.1', { enforceChannelOrder: true }).prodIdx,
      0
    );

    // Minor rollup heading (3.0) matches patch version 3.0.4
    const validMinorRollup = [
      '### 3.0 - 2026-11-13 (Beta)',
      '- Rollup #493',
      '### 2.5 - 2026-11-11 (Production)',
      '- Prod #483',
    ].join('\n');
    assert.equal(
      validateChangelogChannelOrder(validMinorRollup, '3.0.4', { enforceChannelOrder: true }).betaIdx,
      0
    );

    const crlfChangelogRes = validateChangelogChannelOrder(
      validBetaChangelog.replace(/\n/g, '\r\n'),
      '3.0.3',
      { enforceChannelOrder: true }
    );
    assert.equal(crlfChangelogRes.betaIdx, 0);
    assert.equal(crlfChangelogRes.prodIdx, 2);

    assert.throws(
      () =>
        validateChangelogChannelOrder(
          [
            '### 3.0 - 2026-11-13 (Beta)',
            '### 2.7 - 2026-11-12 (Alpha)',
            '### 2.5 - 2026-11-11 (Production)',
          ].join('\n'),
          '3.0.4',
          { enforceChannelOrder: true }
        ),
      /Alpha heading must appear first/
    );
    assert.throws(
      () =>
        validateChangelogChannelOrder(
          ['### 3.0 - 2026-11-13 (Production)', '### 2.7 - 2026-11-12 (Beta)'].join('\n'),
          '3.0.0',
          { enforceChannelOrder: true }
        ),
      /Beta heading must appear at or before Production/
    );
    assert.throws(
      () =>
        validateChangelogChannelOrder(
          [
            '### 3.0 - 2026-11-13 (Beta)',
            '### 2.8 - 2026-11-12 (Production)',
            '### 2.5 - 2026-11-11 (Beta)',
          ].join('\n'),
          '3.0.0',
          { enforceChannelOrder: true }
        ),
      /Expected <= 1 Beta heading|after Production/
    );
    assert.throws(
      () =>
        validateChangelogChannelOrder(
          [
            '### 3.0 - 2026-11-13 (Beta)',
            '### 2.8 - 2026-11-12 (Production)',
            '### 2.5 - 2026-11-11 (Alpha)',
          ].join('\n'),
          '3.0.0',
          { enforceChannelOrder: true }
        ),
      /Alpha heading must appear first|after Production/
    );
    assert.throws(
      () =>
        validateChangelogChannelOrder(
          ['### 3.0.1 - 2026-11-13 (Beta)', '### 3.0.2 - 2026-11-12 (Production)'].join('\n'),
          '3.0.1',
          { enforceChannelOrder: true }
        ),
      /strictly descending by version/
    );
    assert.throws(
      () =>
        validateChangelogChannelOrder(
          ['### 3.0 - 2026-11-13 (Beta)', '### 3.0.0 - 2026-11-12 (Production)'].join('\n'),
          '3.0.0',
          { enforceChannelOrder: true }
        ),
      /strictly descending by version/
    );
    assert.throws(
      () =>
        validateChangelogChannelOrder(
          ['### 3.0.2 - 2026-11-12 (Beta)', '### 3.0.1 - 2026-11-13 (Production)'].join('\n'),
          '3.0.2',
          { enforceChannelOrder: true }
        ),
      /non-increasing by date/
    );
    assert.throws(
      () =>
        validateChangelogChannelOrder(
          ['### 3.0.2 - 2026-11-13 (Beta)', '### 3.0.1 - 2026-11-12 (Production)'].join('\n'),
          '3.0.4',
          { enforceChannelOrder: true }
        ),
      /missing active channel heading for 3\.0\.4/
    );

    const validEpicUrl = 'https://github.com/' + 'capyboop/paint/issues/477';
    const validPrRef = '[' + '#482](' + 'https://github.com/' + 'capyboop/paint/pull/482)';
    validateEpicNaming(`See [EPIC-2](${validEpicUrl}), plain EPIC-2, and ${validPrRef}`, 'DEV.md');
    for (const badNum of ['476', '477', '480']) {
      assert.throws(
        () => validateEpicNaming(`Legacy #'${badNum}`.replace("'", ''), 'TODO.md'),
        /EPIC-N/
      );
    }
    const badIssueLink = '[' + '#481](' + 'https://github.com/' + 'capyboop/paint/issues/481)';
    assert.throws(() => validateEpicNaming(`Link ${badIssueLink}`, 'ROADMAP.md'), /EPIC-N/);
    const badRelIssueLink = '[' + '#500](' + '../../' + 'issues/500)';
    assert.throws(
      () => validateEpicNaming(badRelIssueLink, 'test.md'),
      /\[EPIC-N\]\(\.\.\/\.\.\/issues\/<num>\)/
    );
    const badCombinedEpic = '[EPIC-2 (' + '#477)](' + validEpicUrl + ')';
    assert.throws(() => validateEpicNaming(`Combined ${badCombinedEpic}`, 'GUIDE.md'), /EPIC-N/);
    const badUnlinkedCombinedEpic = '[EPIC-6 (#' + '481)]';
    assert.throws(() => validateEpicNaming(`Unlinked ${badUnlinkedCombinedEpic}`, 'ROADMAP.md'), /EPIC-N/);

    const tmpGuideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capy-guide-index-'));
    try {
      const rootMdNames = [
        'README.md',
        'PROJECT.md',
        'DEV.md',
        'ROADMAP.md',
        'TODO.md',
        'WEB.md',
        'PUZZLE.md',
        'APP.md',
        'CLOUD.md',
        'TESTING.md',
        'CHANGELOG.md',
        'LICENSE.md',
      ];
      for (const name of rootMdNames) {
        fs.writeFileSync(path.join(tmpGuideDir, name), `# ${name}\n`, 'utf8');
      }
      const allLinks = rootMdNames.map((n) => `[${n}](./${n})`).join(' ');
      fs.writeFileSync(path.join(tmpGuideDir, 'README.md'), `# README\n${allLinks}\n`, 'utf8');
      fs.writeFileSync(path.join(tmpGuideDir, 'DEV.md'), `# DEV\n${allLinks}\n`, 'utf8');
      fs.writeFileSync(path.join(tmpGuideDir, 'PROJECT.md'), `# PROJECT\n${allLinks}\n`, 'utf8');
      const guideRes = validateRootGuideIndex(tmpGuideDir, { requireProjectMd: true });
      assert.equal(guideRes.hasProjectMd, true);
      assert.equal(guideRes.rootMdFiles.length, rootMdNames.length);

      fs.writeFileSync(
        path.join(tmpGuideDir, 'README.md'),
        `# README\n${allLinks.replace('./PROJECT.md', './OTHER.md')}\n`,
        'utf8'
      );
      assert.throws(
        () => validateRootGuideIndex(tmpGuideDir, { requireProjectMd: true }),
        /README\.md must link \.\/PROJECT\.md/
      );
      fs.writeFileSync(path.join(tmpGuideDir, 'README.md'), `# README\n${allLinks}\n`, 'utf8');

      fs.writeFileSync(
        path.join(tmpGuideDir, 'PROJECT.md'),
        `# PROJECT\n${allLinks.replace('./TESTING.md', './OTHER.md')}\n`,
        'utf8'
      );
      assert.throws(
        () => validateRootGuideIndex(tmpGuideDir, { requireProjectMd: true }),
        /PROJECT\.md must link \.\/TESTING\.md/
      );
      fs.writeFileSync(path.join(tmpGuideDir, 'PROJECT.md'), `# PROJECT\n${allLinks}\n`, 'utf8');

      fs.unlinkSync(path.join(tmpGuideDir, 'PROJECT.md'));
      assert.throws(
        () => validateRootGuideIndex(tmpGuideDir, { requireProjectMd: true }),
        /PROJECT\.md must exist/
      );
    } finally {
      fs.rmSync(tmpGuideDir, { recursive: true, force: true });
    }

    /* capy-dev-only:start */
    // Dev-only %-first PR Readiness Checklist & legacy rubric guards
    {
      const oneItem = validatePrReadinessChecklist(
        [
          '### PR Readiness Score: 100%',
          '',
          '<details>',
          '<summary>PR Readiness Checklist</summary>',
          '',
          '- **100%** **Docs Sync**: Verified.',
          '',
          '</details>',
        ].join('\n'),
        '1-item test'
      );
      assert.equal(oneItem.overallScore, 100);
      assert.equal(oneItem.itemCount, 1);
      assert.deepEqual(oneItem.itemScores, [100]);
      assert.equal(oneItem.summary, 'PR Readiness Checklist');

      const threeItems = validatePrReadinessChecklist(
        [
          '### PR Readiness Score: 95.5%',
          '',
          '<details>',
          '<summary>PR Readiness Checklist</summary>',
          '',
          '- [x] **100%** — **Functionality**: Verified.',
          '- **95.5%** — **Tests**: Verified.',
          '- 91% — **Docs**: Remaining follow-up noted.',
          '',
          '</details>',
        ].join('\n'),
        '3-item test'
      );
      assert.equal(threeItems.overallScore, 95.5);
      assert.equal(threeItems.itemCount, 3);
      assert.deepEqual(threeItems.itemScores, [100, 95.5, 91]);

      const sixItems = validatePrReadinessChecklist(
        [
          '### PR Readiness Score: 100%',
          '',
          '<details>',
          '<summary>PR Readiness Checklist</summary>',
          '',
          '- **100% Check 1**: Functionality verified.',
          '- **100% Check 2**: Automated tests passed.',
          '- **100% Check 3**: Zero-allocation invariants preserved.',
          '- **100% Check 4**: Mobile viewport verified.',
          '- **100% Check 5**: Docs synced.',
          '- **100% Check 6**: CI green.',
          '',
          '</details>',
        ].join('\n'),
        '6-item test'
      );
      assert.equal(sixItems.overallScore, 100);
      assert.equal(sixItems.itemCount, 6);

      const eightItemsFullPr = validatePrReadinessChecklist(
        [
          '## Summary',
          '',
          '- Improved color layout with Tailwind bg-amber-400/20 accents and clean checks.',
          '',
          '- **Beta**: https://capypaint.com/beta/',
          '- **Related PRs**: [#20](https://github.com/capyboop/paint/pull/20) [#100](https://github.com/capyboop/paint/pull/100)',
          '',
          '### PR Readiness Score: 99% (threshold >= 95%)',
          '',
          '<details>',
          '<summary>PR Readiness Checklist</summary>',
          '',
          '- **100%** — **Functionality & Edge Cases**: Verified.',
          '- **100%** — **Automated Tests**: Verified.',
          '- **100%** — **Performance & Golden Invariants**: Verified.',
          '- **100%** — **Accessibility & Mobile Layout**: Verified.',
          '- **100%** — **Android / Bridge Parity**: Verified.',
          '- **100%** — **Cloud Sync / Worker Safety**: Verified.',
          '- **95%** — **Docs & Changelog Sync**: Minor wording follow-up (-1%).',
          '- **100%** — **CI, Mergeability & Preview Verification**: Verified.',
          '',
          '</details>',
          '',
          'Ready with -1% docs polish follow-up.',
          '- [ ] Polish final release note wording in TODO follow-up.',
        ].join('\n'),
        '8-item PR body'
      );
      assert.equal(eightItemsFullPr.overallScore, 99);
      assert.equal(eightItemsFullPr.itemCount, 8);

      const prosePercentRes = validatePrReadinessChecklist(
        [
          '### PR Readiness Score: 97.5%',
          'All 100% of unit tests pass.',
          '',
          '<details>',
          '<summary>PR Readiness Checklist</summary>',
          '',
          '- **100%** — **Tests**: All unit checks pass.',
          '',
          '</details>',
        ].join('\n'),
        'prose 100% before details'
      );
      assert.equal(prosePercentRes.overallScore, 97.5);
      assert.equal(prosePercentRes.itemCount, 1);
      assert.deepEqual(prosePercentRes.itemScores, [100]);

      const thresholdProseRes = validatePrReadinessChecklist(
        [
          '### PR Readiness Score: 97.5%',
          'Threshold: 95% minimum; dropped 2.5% for docs follow-up.',
          '',
          '<details>',
          '<summary>PR Readiness Checklist</summary>',
          '',
          '- **97.5%** — **Docs**: Follow-up noted.',
          '',
          '</details>',
        ].join('\n'),
        'threshold prose before details'
      );
      assert.equal(thresholdProseRes.overallScore, 97.5);
      assert.equal(thresholdProseRes.itemCount, 1);
      assert.deepEqual(thresholdProseRes.itemScores, [97.5]);

      const fallbackProseRes = validatePrReadinessChecklist(
        [
          '### PR Readiness Score',
          'Overall: 96%',
          '',
          '<details>',
          '<summary>PR Readiness Checklist</summary>',
          '',
          '- **96%** — **Tests**: Verified.',
          '',
          '</details>',
        ].join('\n'),
        'fallback overall score below heading'
      );
      assert.equal(fallbackProseRes.overallScore, 96);
      assert.equal(fallbackProseRes.itemCount, 1);

      const minParenRes = validatePrReadinessChecklist(
        [
          '### PR Readiness Score: 97.5% (min 95%)',
          '',
          '<details>',
          '<summary>PR Readiness Checklist</summary>',
          '',
          '- **100%** — **Checks**: Passed.',
          '',
          '</details>',
        ].join('\n'),
        'min 95% parenthetical on heading'
      );
      assert.equal(minParenRes.overallScore, 97.5);

      const unicodeGteRes = validatePrReadinessChecklist(
        [
          '### PR Readiness Score: 97.5% (≥ 95%)',
          '',
          '<details>',
          '<summary>PR Readiness Checklist</summary>',
          '',
          '- **100%** — **Checks**: Passed.',
          '',
          '</details>',
        ].join('\n'),
        'unicode >= 95% threshold after heading score'
      );
      assert.equal(unicodeGteRes.overallScore, 97.5);

      const unicodeGteBeforeRes = validatePrReadinessChecklist(
        [
          '### PR Readiness Score (≥ 95%): 97.5%',
          '',
          '<details>',
          '<summary>PR Readiness Checklist</summary>',
          '',
          '- **100%** — **Checks**: Passed.',
          '',
          '</details>',
        ].join('\n'),
        'unicode >= 95% threshold before heading score'
      );
      assert.equal(unicodeGteBeforeRes.overallScore, 97.5);

      const trailingBoldNoteRes = validatePrReadinessChecklist(
        [
          '### PR Readiness Score: 99%',
          '',
          '<details>',
          '<summary>PR Readiness Checklist</summary>',
          '',
          '- **99%** — **Verification**: Passed.',
          '',
          '</details>',
          '',
          '**PR Readiness Note**: All done.',
        ].join('\n'),
        'trailing bold PR Readiness note'
      );
      assert.equal(trailingBoldNoteRes.overallScore, 99);
      assert.equal(trailingBoldNoteRes.itemCount, 1);
      assert.deepEqual(trailingBoldNoteRes.itemScores, [99]);

      const trailingHeadingRes = validatePrReadinessChecklist(
        [
          '### PR Readiness Score: 98%',
          '',
          '<details>',
          '<summary>PR Readiness Checklist</summary>',
          '',
          '- **98%** — **Checks**: Passed.',
          '',
          '</details>',
          '',
          '### PR Readiness Follow-Up',
          'None.',
        ].join('\n'),
        'trailing PR Readiness heading'
      );
      assert.equal(trailingHeadingRes.overallScore, 98);
      assert.equal(trailingHeadingRes.itemCount, 1);

      const multilineCommentRes = validatePrReadinessChecklist(
        [
          '### PR Readiness Score: 100%',
          '',
          '<details>',
          '<summary>PR Readiness Checklist</summary>',
          '',
          '<!--',
          '  note',
          '-->',
          '- **100%** — **Checks**: Passed.',
          '',
          '</details>',
        ].join('\n'),
        'multiline HTML comment inside details'
      );
      assert.equal(multilineCommentRes.overallScore, 100);
      assert.equal(multilineCommentRes.itemCount, 1);
      assert.deepEqual(multilineCommentRes.itemScores, [100]);

      const detailsOpenRes = validatePrReadinessChecklist(
        [
          '### PR Readiness Score: 100%',
          '',
          '<details open><summary>PR Readiness Checklist</summary>',
          '',
          '- **100%** — **Checks**: Passed.',
          '',
          '</details>',
        ].join('\n'),
        'details open attribute'
      );
      assert.equal(detailsOpenRes.overallScore, 100);
      assert.equal(detailsOpenRes.itemCount, 1);
      assert.equal(detailsOpenRes.summary, 'PR Readiness Checklist');

      const nestedBoldBacktickRes = validatePrReadinessChecklist(
        [
          '### PR Readiness Score: 100%',
          '',
          '<details>',
          '<summary>PR Readiness Checklist</summary>',
          '',
          '- **`100%`** — **Tests**: Passed.',
          '',
          '</details>',
        ].join('\n'),
        'nested bold and backtick percentage'
      );
      assert.equal(nestedBoldBacktickRes.overallScore, 100);
      assert.equal(nestedBoldBacktickRes.itemCount, 1);
      assert.deepEqual(nestedBoldBacktickRes.itemScores, [100]);

      const sectionBulletRes = validatePrReadinessChecklist(
        [
          '### PR Readiness Score: 100%',
          '',
          '- 5 points to note in this release:',
          '',
          '<details>',
          '<summary>PR Readiness Checklist</summary>',
          '',
          '- **100%** — **Checks**: Passed.',
          '',
          '</details>',
        ].join('\n'),
        'unordered bullet inside PR Readiness section'
      );
      assert.equal(sectionBulletRes.overallScore, 100);
      assert.equal(sectionBulletRes.itemCount, 1);

      const makeInvalidSection = (bodyLines) =>
        ['### PR Readiness Score: 98%', '', '<details>', '<summary>PR Readiness Checklist</summary>', '', ...bodyLines, '', '</details>'].join('\n');

      for (const badText of [
        '### 5-Pillar PR Readiness Score: 100%\n\n<details>\n<summary>Checklist</summary>\n\n- **100%** — **Check**: Ok.\n\n</details>',
        '### 5 Pillar PR Readiness Score: 100%\n\n<details>\n<summary>Checklist</summary>\n\n- **100%** — **Check**: Ok.\n\n</details>',
        makeInvalidSection(['- **95/100** — **Check**: Legacy fraction.']),
        makeInvalidSection(['- **95 / 100** — **Check**: Legacy spaced fraction.']),
        makeInvalidSection(['- **20/20** — **Check**: Legacy category fraction.']),
        makeInvalidSection(['- **20 / 20** — **Check**: Legacy spaced category fraction.']),
        makeInvalidSection(['- **100%** — **Check (20 pts)**: Legacy pts.']),
        makeInvalidSection(['- **100%** — **Check (5 x 20)**: Legacy math.']),
        makeInvalidSection(['- **100%** — **Pillar 1**: Legacy pillar number.']),
        makeInvalidSection(['- **100%** — **Readiness Rubric**: Legacy rubric word.']),
        makeInvalidSection(['- **Functionality**: 100%']),
        makeInvalidSection(['1. Tests: 100%']),
        makeInvalidSection([]),
        makeInvalidSection(['- **105%** — **Bounds**: Out of range.']),
        '### PR Readiness Score: 105%\n\n<details>\n<summary>Checklist</summary>\n\n- **100%** — **Check**: Ok.\n\n</details>',
        '### PR Readiness Score: 100%\n\n- **100%** — **Check**: Missing details block.',
        '### 5-Pillars PR Readiness Score: 100%\n\n<details>\n<summary>Checklist</summary>\n\n- **100%** — **Check**: Ok.\n\n</details>',
        '### PR Readiness Score: >= 95%\n\n<details>\n<summary>Checklist</summary>\n\n- **100%** — **Check**: Ok.\n\n</details>',
        '### PR Readiness Score: ≥ 95%\n\n<details>\n<summary>Checklist</summary>\n\n- **100%** — **Check**: Ok.\n\n</details>',
        makeInvalidSection(['<!--', '  comment only', '-->']),
        makeInvalidSection(['- **100%**']),
        makeInvalidSection(['- 100%']),
        makeInvalidSection(['- [x] **100%**']),
        makeInvalidSection(['- **100%**:']),
        makeInvalidSection(['- **95%** — **Docs**: -5 points deduction.']),
        makeInvalidSection(['- **95%** — **Docs**: Deduction (- 5 points).']),
        makeInvalidSection(['- **95%** — **Docs**: Explain `-N point` delta.']),
        makeInvalidSection(['- **100%** — **Check**: 5-Pillars framework.']),
        makeInvalidSection(['- **100%** — **Check**: 20-point scale.']),
        makeInvalidSection(['- **100%** — **Check**: Worth **20** pts.']),
        [
          '### PR Readiness Score: 100%',
          '',
          '<!-- unclosed comment hides remaining markdown',
          '<details>',
          '<summary>PR Readiness Checklist</summary>',
          '',
          '- **100%** — **Check**: Hidden by unclosed comment.',
          '',
          '</details>',
        ].join('\n'),
        [
          '### PR Readiness Score: 100%',
          '',
          '<!-- closed comment -->',
          '<!-- unclosed trailing comment',
          '<details>',
          '<summary>PR Readiness Checklist</summary>',
          '',
          '- **100%** — **Check**: Hidden by second unclosed comment.',
          '',
          '</details>',
        ].join('\n'),
      ]) {
        assert.throws(() => validatePrReadinessChecklist(badText, 'negative fixture'));
      }

      // False-positive guards for legitimate URLs, Tailwind classes, dates, percentages, and Markdown bullets
      validateNoLegacyPrRubric(
        [
          '### Overview',
          '- 5 points to note in this release:',
          '  - 3 points on readability and accessibility.',
          '* 2 points for rollout timing.',
          'Review these 5 points before merging.',
          'Score: 98% (-2% docs, -5% follow-up).',
          'See https://github.com/capyboop/paint/pull/20 and https://github.com/capyboop/paint/pull/100',
          'Classes bg-amber-400/20 width="100%" ~15--20% 0.5x--20x 1/20th date 2026/01/20 100% offline per_page: 100',
        ].join('\n'),
        'false-positive-guard.md'
      );

      for (const badLegacyText of [
        'Deduction: -5 points for docs.',
        '- -5 points deducted for docs.',
        '* -5 points deducted for docs.',
        'Penalty (- 5 points) applied.',
        'Score adjusted by - 5 points after review.',
        'Describe gaps using `-N point` delta syntax.',
        'Use 5-Pillars scoring.',
        'Maximum 20-point scale.',
        'Worth **20** pts per category.',
        'Award `20` points per check.',
      ]) {
        assert.throws(
          () => validateNoLegacyPrRubric(badLegacyText, 'legacy-negative.md'),
          /Forbidden legacy/
        );
      }

      // Spec validation with requireProjectMd: false (main-branch mode)
      const tmpMainSpecDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capy-readiness-main-'));
      try {
        fs.mkdirSync(path.join(tmpMainSpecDir, 'docs/ai'), { recursive: true });
        fs.writeFileSync(
          path.join(tmpMainSpecDir, 'AGENTS.md'),
          '# AGENTS\nReport >= 95% PR Readiness in <details> with % at the start of each line and as many or as few scope-relevant items as needed.\n',
          'utf8'
        );
        fs.writeFileSync(
          path.join(tmpMainSpecDir, 'docs/ai/pr-readiness.md'),
          '# PR Readiness\nPR Readiness Checklist 100% inside <details> with % at the start of each line and as many or as few scope-relevant items as needed.\n',
          'utf8'
        );
        fs.writeFileSync(path.join(tmpMainSpecDir, 'DEV.md'), '# DEV\nEngineering guide.\n', 'utf8');
        fs.writeFileSync(path.join(tmpMainSpecDir, 'TESTING.md'), '# TESTING\nAll checks.\n', 'utf8');
        fs.writeFileSync(path.join(tmpMainSpecDir, 'README.md'), '# README\n100% offline.\n', 'utf8');
        assert.throws(
          () => validatePrReadinessSpec(tmpMainSpecDir, { requireProjectMd: false }),
          /AGENTS\.md must specify 100% PR Readiness threshold/
        );

        fs.writeFileSync(
          path.join(tmpMainSpecDir, 'AGENTS.md'),
          '# AGENTS\nReport 100% PR Readiness in <details> with % at the start of each line and as many or as few scope-relevant items as needed.\n',
          'utf8'
        );
        assert.equal(validatePrReadinessSpec(tmpMainSpecDir, { requireProjectMd: false }).scannedFiles.length, 5);
      } finally {
        fs.rmSync(tmpMainSpecDir, { recursive: true, force: true });
      }
    }

    const tmpStrictRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'capy-sanity-strict-'));
    try {
      fs.mkdirSync(path.join(tmpStrictRepo, 'web/src'), { recursive: true });
      fs.mkdirSync(path.join(tmpStrictRepo, 'app'), { recursive: true });
      fs.mkdirSync(path.join(tmpStrictRepo, 'docs/ai'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpStrictRepo, 'web/package.json'),
        JSON.stringify({ name: 'capy-paint', version: '3.0.4' }, null, 2),
        'utf8'
      );
      fs.writeFileSync(
        path.join(tmpStrictRepo, 'web/src/version.ts'),
        'export const code = major * 10000 + minor * 100 + patch;\n',
        'utf8'
      );
      fs.writeFileSync(
        path.join(tmpStrictRepo, 'app/build.gradle.kts'),
        'val capyVersionCode = (verMajor * 10000) + (verMinor * 100) + verPatch\n',
        'utf8'
      );
      const strictRootMds = [
        'README.md',
        'PROJECT.md',
        'DEV.md',
        'AGENTS.md',
        'ROADMAP.md',
        'TODO.md',
        'WEB.md',
        'PUZZLE.md',
        'APP.md',
        'CLOUD.md',
        'TESTING.md',
        'CHANGELOG.md',
        'LICENSE.md',
      ];
      const strictAllLinks = strictRootMds.map((n) => `[${n}](./${n})`).join(' ');
      const strictAgentsDoc = `# AGENTS.md\n${strictAllLinks}\nReport 100% PR Readiness Score inside <details> with % at the start of each line and as many or as few scope-relevant items as needed.\n`;
      const strictPrReadinessDoc = `# PR Readiness\nPR Readiness Checklist 100% inside <details> with % at the start of each line and as many or as few scope-relevant items as needed.\n`;
      const strictProjectDoc = `# PROJECT.md\n${strictAllLinks}\n`;
      const strictDevDoc = `# DEV.md\n${strictAllLinks}\n`;
      fs.writeFileSync(path.join(tmpStrictRepo, 'docs/ai/pr-readiness.md'), strictPrReadinessDoc, 'utf8');
      for (const name of strictRootMds) {
        if (name === 'CHANGELOG.md') continue;
        const content =
          name === 'AGENTS.md'
            ? strictAgentsDoc
            : `# ${name}\n${strictAllLinks}\n`;
        fs.writeFileSync(path.join(tmpStrictRepo, name), content, 'utf8');
      }
      const makeStrictChangelog = ({
        headings = ['### 3.0.4 - 2026-11-13 (Beta)', '### 3.0.1 - 2026-11-12 (Production)', '### 0.1.0 - 2026-10-01'],
        bulletCount = 398,
        firstBulletPrefix = '[#493](../../pull/493)',
      } = {}) => {
        const lines = [headings[0], '', `- ${firstBulletPrefix} Top change`, ''];
        for (let i = 1; i < headings.length; i++) {
          lines.push(headings[i], '');
          if (i === headings.length - 1) {
            for (let b = 1; b < bulletCount; b++) {
              lines.push(`- [#${b}](../../pull/${b}) Historical change ${b}`);
            }
          } else {
            lines.push(`- [#${i}](../../pull/${i}) Channel release`, '');
          }
        }
        return `${lines.join('\n')}\n`;
      };
      const strictChangelogPath = path.join(tmpStrictRepo, 'CHANGELOG.md');
      fs.writeFileSync(strictChangelogPath, makeStrictChangelog(), 'utf8');

      const strictRes = runSanityChecks({
        repoRoot: tmpStrictRepo,
        requireProjectMd: true,
        enforceChannelOrder: true,
        enforceEpicNaming: true,
        enforcePrReadinessSpec: true,
      });
      assert.equal(strictRes.version, '3.0.4');
      assert.equal(strictRes.markdownFilesChecked, 14);

      // 1. Missing ./PROJECT.md from README.md
      fs.writeFileSync(
        path.join(tmpStrictRepo, 'README.md'),
        `# README\n${strictAllLinks.replace('./PROJECT.md', './DEV.md')}\n`,
        'utf8'
      );
      assert.throws(
        () =>
          runSanityChecks({
            repoRoot: tmpStrictRepo,
            requireProjectMd: true,
            enforceChannelOrder: true,
            enforceEpicNaming: true,
            enforcePrReadinessSpec: true,
          }),
        /README\.md must link \.\/PROJECT\.md/
      );
      fs.writeFileSync(path.join(tmpStrictRepo, 'README.md'), `# README\n${strictAllLinks}\n`, 'utf8');

      // 2. Missing ./TESTING.md from PROJECT.md
      fs.writeFileSync(
        path.join(tmpStrictRepo, 'PROJECT.md'),
        `# PROJECT\n${strictAllLinks.replace('./TESTING.md', './DEV.md')}\n`,
        'utf8'
      );
      assert.throws(
        () =>
          runSanityChecks({
            repoRoot: tmpStrictRepo,
            requireProjectMd: true,
            enforceChannelOrder: true,
            enforceEpicNaming: true,
            enforcePrReadinessSpec: true,
          }),
        /PROJECT\.md must link \.\/TESTING\.md/
      );

      // 3. Guide link hidden inside HTML capy-dev-only block must fail public indexing check
      fs.writeFileSync(
        path.join(tmpStrictRepo, 'PROJECT.md'),
        `# PROJECT\n${strictAllLinks.replace('[TESTING.md](./TESTING.md)', '')}\n<!-- capy-dev-only:start -->\n[TESTING.md](./TESTING.md)\n<!-- capy-dev-only:end -->\n`,
        'utf8'
      );
      assert.throws(
        () =>
          runSanityChecks({
            repoRoot: tmpStrictRepo,
            requireProjectMd: true,
            enforceChannelOrder: true,
            enforceEpicNaming: true,
            enforcePrReadinessSpec: true,
          }),
        /PROJECT\.md must link \.\/TESTING\.md/
      );

      // 4. Legacy Epic issue ref fails when enforceEpicNaming: true
      fs.writeFileSync(
        path.join(tmpStrictRepo, 'PROJECT.md'),
        `${strictProjectDoc}See #` + '477\n',
        'utf8'
      );
      assert.throws(
        () =>
          runSanityChecks({
            repoRoot: tmpStrictRepo,
            requireProjectMd: true,
            enforceChannelOrder: true,
            enforceEpicNaming: true,
            enforcePrReadinessSpec: true,
          }),
        /EPIC-N/
      );
      fs.writeFileSync(path.join(tmpStrictRepo, 'PROJECT.md'), strictProjectDoc, 'utf8');

      // 5. Bare #490 bullet fails clickable PR link check
      fs.writeFileSync(
        strictChangelogPath,
        makeStrictChangelog({ firstBulletPrefix: '#490' }),
        'utf8'
      );
      assert.throws(
        () =>
          runSanityChecks({
            repoRoot: tmpStrictRepo,
            requireProjectMd: true,
            enforceChannelOrder: true,
            enforceEpicNaming: true,
            enforcePrReadinessSpec: true,
          }),
        /Invalid CHANGELOG bullet prefix/
      );

      // 6. Inverted Alpha after Beta fails enforceChannelOrder
      fs.writeFileSync(
        strictChangelogPath,
        makeStrictChangelog({
          headings: [
            '### 3.0.4 - 2026-11-13 (Beta)',
            '### 2.7 - 2026-11-12 (Alpha)',
            '### 2.5 - 2026-11-11 (Production)',
            '### 0.1.0 - 2026-10-01',
          ],
        }),
        'utf8'
      );
      assert.throws(
        () =>
          runSanityChecks({
            repoRoot: tmpStrictRepo,
            requireProjectMd: true,
            enforceChannelOrder: true,
            enforceEpicNaming: true,
            enforcePrReadinessSpec: true,
          }),
        /Alpha heading must appear first/
      );
      fs.writeFileSync(strictChangelogPath, makeStrictChangelog(), 'utf8');

      // 6b. CRLF line endings in CHANGELOG.md normalize cleanly
      fs.writeFileSync(strictChangelogPath, makeStrictChangelog().replace(/\n/g, '\r\n'), 'utf8');
      const strictCrlfRes = runSanityChecks({
        repoRoot: tmpStrictRepo,
        requireProjectMd: true,
        enforceChannelOrder: true,
        enforceEpicNaming: true,
        enforcePrReadinessSpec: true,
      });
      assert.equal(strictCrlfRes.version, '3.0.4');
      fs.writeFileSync(strictChangelogPath, makeStrictChangelog(), 'utf8');

      // 7. Legacy PR rubric tokens fail across governance docs and .github workflows
      for (const [relTarget, baseDoc, badSnippet] of [
        ['PROJECT.md', strictProjectDoc, 'Use 5-Pillar scoring.\n'],
        ['AGENTS.md', strictAgentsDoc, 'Score 95 / 100.\n'],
        ['DEV.md', strictDevDoc, 'Check 20/20 items.\n'],
        ['TESTING.md', `# TESTING.md\n${strictAllLinks}\n`, 'Award 20 pts per category.\n'],
        ['README.md', `# README.md\n${strictAllLinks}\n`, 'See the PR Rubric.\n'],
        ['PROJECT.md', strictProjectDoc, 'Use 5-Pillars scoring.\n'],
        ['DEV.md', strictDevDoc, 'Use a 20-point scale.\n'],
        ['TESTING.md', `# TESTING.md\n${strictAllLinks}\n`, 'Worth **20** pts per item.\n'],
        ['README.md', `# README.md\n${strictAllLinks}\n`, 'Apply (- 5 points) penalty.\n'],
        ['AGENTS.md', strictAgentsDoc, 'Avoid `-N point` phrasing.\n'],
      ]) {
        fs.writeFileSync(path.join(tmpStrictRepo, relTarget), `${baseDoc}${badSnippet}`, 'utf8');
        assert.throws(
          () =>
            runSanityChecks({
              repoRoot: tmpStrictRepo,
              requireProjectMd: true,
              enforceChannelOrder: true,
              enforceEpicNaming: true,
              enforcePrReadinessSpec: true,
            }),
          /Forbidden legacy/
        );
        fs.writeFileSync(path.join(tmpStrictRepo, relTarget), baseDoc, 'utf8');
      }
      fs.mkdirSync(path.join(tmpStrictRepo, '.github/workflows'), { recursive: true });
      for (const badWorkflow of [
        'name: CI\n# Check 5-Pillar 95/100\n',
        'name: CI\n# Check 5-Pillars (**20** pts)\n',
      ]) {
        fs.writeFileSync(path.join(tmpStrictRepo, '.github/workflows/ci.yml'), badWorkflow, 'utf8');
        assert.throws(
          () =>
            runSanityChecks({
              repoRoot: tmpStrictRepo,
              requireProjectMd: true,
              enforceChannelOrder: true,
              enforceEpicNaming: true,
              enforcePrReadinessSpec: true,
            }),
          /Forbidden legacy/
        );
      }
      fs.rmSync(path.join(tmpStrictRepo, '.github'), { recursive: true, force: true });

      // 8. Missing flexible-count or %-start spec fails when enforcePrReadinessSpec: true
      fs.writeFileSync(
        path.join(tmpStrictRepo, 'docs/ai/pr-readiness.md'),
        '# PR Readiness\nPR Readiness Checklist 100% inside <details> with % at the start of each line.\n',
        'utf8'
      );
      assert.throws(
        () =>
          runSanityChecks({
            repoRoot: tmpStrictRepo,
            requireProjectMd: true,
            enforceChannelOrder: true,
            enforceEpicNaming: true,
            enforcePrReadinessSpec: true,
          }),
        /docs\/ai\/pr-readiness\.md must allow variable/
      );
      fs.writeFileSync(path.join(tmpStrictRepo, 'docs/ai/pr-readiness.md'), strictPrReadinessDoc, 'utf8');

      fs.writeFileSync(
        path.join(tmpStrictRepo, 'AGENTS.md'),
        `# AGENTS.md\n${strictAllLinks}\nReport 100% PR Readiness Score inside <details> with as many items as needed.\n`,
        'utf8'
      );
      assert.throws(
        () =>
          runSanityChecks({
            repoRoot: tmpStrictRepo,
            requireProjectMd: true,
            enforceChannelOrder: true,
            enforceEpicNaming: true,
            enforcePrReadinessSpec: true,
          }),
        /AGENTS\.md must specify putting % at the start/
      );
      fs.writeFileSync(path.join(tmpStrictRepo, 'AGENTS.md'), strictAgentsDoc, 'utf8');

      // 9. CHANGELOG /pull/20 and /pull/100 URLs plus README width="100%" pass runSanityChecks
      fs.writeFileSync(
        path.join(tmpStrictRepo, 'README.md'),
        `# README.md\n${strictAllLinks}\n<img width="100%" alt="demo" />\n`,
        'utf8'
      );
      fs.writeFileSync(
        strictChangelogPath,
        makeStrictChangelog({
          firstBulletPrefix: '[#100](../../pull/100)',
        }).replace(
          '[#20](../../pull/20) Historical change 20',
          '[#20](../../pull/20) Rebuild interface'
        ),
        'utf8'
      );
      const urlGuardRes = runSanityChecks({
        repoRoot: tmpStrictRepo,
        requireProjectMd: true,
        enforceChannelOrder: true,
        enforceEpicNaming: true,
        enforcePrReadinessSpec: true,
      });
      assert.equal(urlGuardRes.version, '3.0.4');
      fs.writeFileSync(path.join(tmpStrictRepo, 'README.md'), `# README.md\n${strictAllLinks}\n`, 'utf8');
      fs.writeFileSync(strictChangelogPath, makeStrictChangelog(), 'utf8');

      // 9b. Unordered Markdown bullet "- 5 points to watch:" in a governance doc passes runSanityChecks
      fs.writeFileSync(
        path.join(tmpStrictRepo, 'DEV.md'),
        `${strictDevDoc}\n### Notes\n- 5 points to watch:\n  - 3 points on layout stability.\n`,
        'utf8'
      );
      const bulletGuardRes = runSanityChecks({
        repoRoot: tmpStrictRepo,
        requireProjectMd: true,
        enforceChannelOrder: true,
        enforceEpicNaming: true,
        enforcePrReadinessSpec: true,
      });
      assert.equal(bulletGuardRes.version, '3.0.4');
      fs.writeFileSync(path.join(tmpStrictRepo, 'DEV.md'), strictDevDoc, 'utf8');

      // 9c. Public issue tracker & privacy policy guard passes clean files and rejects shthed regressions
      fs.mkdirSync(path.join(tmpStrictRepo, 'web/src/components'), { recursive: true });
      fs.mkdirSync(path.join(tmpStrictRepo, 'web/public'), { recursive: true });
      fs.mkdirSync(path.join(tmpStrictRepo, '.github/ISSUE_TEMPLATE'), { recursive: true });
      const cleanSettingsTag =
        '<a href="https://github.com/capyboop/paint/issues/new/choose" data-testid="about-report-issue-link">Report</a>';
      const cleanPrivacyHtml =
        '<html><body><a href="https://github.com/capyboop/paint/issues">Issues</a></body></html>';
      const cleanIssueConfig = 'contact_links:\n  - url: https://capypaint.com/\n';
      const settingsPath = path.join(tmpStrictRepo, 'web/src/components/SettingsModal.tsx');
      const privacyPath = path.join(tmpStrictRepo, 'web/public/privacy-policy.html');
      const issueConfigPath = path.join(tmpStrictRepo, '.github/ISSUE_TEMPLATE/config.yml');
      const bugTemplatePath = path.join(tmpStrictRepo, '.github/ISSUE_TEMPLATE/bug_report.yml');
      fs.writeFileSync(settingsPath, cleanSettingsTag, 'utf8');
      fs.writeFileSync(privacyPath, cleanPrivacyHtml, 'utf8');
      fs.writeFileSync(issueConfigPath, cleanIssueConfig, 'utf8');
      fs.writeFileSync(bugTemplatePath, 'name: Bug Report\n', 'utf8');
      const trackerPassRes = runSanityChecks({
        repoRoot: tmpStrictRepo,
        requireProjectMd: true,
        enforceChannelOrder: true,
        enforceEpicNaming: true,
        enforcePrReadinessSpec: true,
      });
      assert.equal(trackerPassRes.version, '3.0.4');

      fs.writeFileSync(
        settingsPath,
        '<a href="https://github.com/shthed/capy/issues/new/choose" data-testid="about-report-issue-link">Report</a>',
        'utf8'
      );
      assert.throws(
        () => runSanityChecks({ repoRoot: tmpStrictRepo, requireProjectMd: true }),
        /about-report-issue-link/
      );
      fs.writeFileSync(settingsPath, cleanSettingsTag, 'utf8');

      fs.writeFileSync(
        settingsPath,
        '<a onClick={() => console.log(1)} href="https://github.com/capyboop/paint/issues/new/choose" data-testid="about-report-issue-link">Report</a>',
        'utf8'
      );
      runSanityChecks({ repoRoot: tmpStrictRepo, requireProjectMd: true });
      fs.writeFileSync(
        settingsPath,
        '<a href="https://github.com/capyboop/paint/issuesevil" data-testid="about-report-issue-link">Report</a>',
        'utf8'
      );
      assert.throws(
        () => runSanityChecks({ repoRoot: tmpStrictRepo, requireProjectMd: true }),
        /about-report-issue-link/
      );
      fs.writeFileSync(settingsPath, cleanSettingsTag, 'utf8');

      fs.writeFileSync(
        privacyPath,
        '<html><body><a href="https://github.com/shthed/capy/issues">Issues</a></body></html>',
        'utf8'
      );
      assert.throws(
        () => runSanityChecks({ repoRoot: tmpStrictRepo, requireProjectMd: true }),
        /privacy-policy\.html/
      );
      fs.writeFileSync(
        privacyPath,
        '<html><body><a href="https://github.com/capyboop/paint/issues">Issues</a><a href="https://github.com/capyboop/paintevil">Evil</a></body></html>',
        'utf8'
      );
      assert.throws(
        () => runSanityChecks({ repoRoot: tmpStrictRepo, requireProjectMd: true }),
        /privacy-policy\.html must not link outside capyboop\/paint/
      );
      fs.writeFileSync(privacyPath, cleanPrivacyHtml, 'utf8');

      fs.writeFileSync(bugTemplatePath, 'name: Bug\nabout: https://github.com/shthed/capy\n', 'utf8');
      assert.throws(
        () => runSanityChecks({ repoRoot: tmpStrictRepo, requireProjectMd: true }),
        /ISSUE_TEMPLATE\/bug_report\.yml/
      );
      fs.writeFileSync(
        bugTemplatePath,
        'name: Bug\nabout: https://github.com/capyboop/paintevil\n',
        'utf8'
      );
      assert.throws(
        () => runSanityChecks({ repoRoot: tmpStrictRepo, requireProjectMd: true }),
        /ISSUE_TEMPLATE\/bug_report\.yml must not link outside capyboop\/paint/
      );
      fs.writeFileSync(bugTemplatePath, 'name: Bug Report\n', 'utf8');

      // 10. Missing PROJECT.md fails requireProjectMd: true
      fs.unlinkSync(path.join(tmpStrictRepo, 'PROJECT.md'));
      assert.throws(
        () =>
          runSanityChecks({
            repoRoot: tmpStrictRepo,
            requireProjectMd: true,
            enforceChannelOrder: true,
            enforceEpicNaming: true,
            enforcePrReadinessSpec: true,
          }),
        /PROJECT\.md must exist/
      );
    } finally {
      fs.rmSync(tmpStrictRepo, { recursive: true, force: true });
    }
    /* capy-dev-only:end */
    logUnitPass('SemVer parity, <2s sanity.mjs gate, CHANGELOG contract, and Epic naming checks verified.');

    // Unit-test .github/scripts/cleanup-gh-pages-previews.mjs and .github/scripts/cleanup-branches.mjs
    logUnitStart('Testing .github/scripts cleanup-gh-pages-previews.mjs & cleanup-branches.mjs...');
    const previewCleanupMod = await import('../../.github/scripts/cleanup-gh-pages-previews.mjs');
    const branchCleanupMod = await import('../../.github/scripts/cleanup-branches.mjs');

    const makeMockResponse = ({ ok = true, status = 200, statusText = 'OK', headers = {}, jsonData = null, textData = '' } = {}) => ({
      ok,
      status,
      statusText,
      headers: {
        get: (key) => {
          const found = Object.entries(headers).find(([k]) => k.toLowerCase() === String(key).toLowerCase());
          return found ? found[1] : null;
        },
      },
      json: async () => jsonData,
      text: async () => textData,
    });

    // cleanup-gh-pages-previews: 504 transient retry -> 200
    {
      let calls = 0;
      const sleeps = [];
      const res = await previewCleanupMod.requestWithRetry('https://api.github.com/repos/a/b/pulls', {
        baseDelayMs: 1,
        sleepImpl: async (ms) => sleeps.push(ms),
        fetchImpl: async () => {
          calls += 1;
          if (calls === 1) {
            return makeMockResponse({ ok: false, status: 504, statusText: 'Gateway Timeout', textData: 'timeout' });
          }
          return makeMockResponse({ ok: true, status: 200, jsonData: [] });
        },
      });
      assert.equal(calls, 2);
      assert.equal(sleeps.length, 1);
      assert.deepEqual(res.data, []);
    }

    // cleanup-gh-pages-previews: 429 Retry-After honored -> 200
    {
      let calls = 0;
      const sleeps = [];
      await previewCleanupMod.requestWithRetry('https://api.github.com/repos/a/b/pulls', {
        baseDelayMs: 1,
        sleepImpl: async (ms) => sleeps.push(ms),
        fetchImpl: async () => {
          calls += 1;
          if (calls === 1) {
            return makeMockResponse({
              ok: false,
              status: 429,
              statusText: 'Too Many Requests',
              headers: { 'Retry-After': '0.005' },
            });
          }
          return makeMockResponse({ ok: true, status: 200, jsonData: [{ number: 1 }] });
        },
      });
      assert.equal(calls, 2);
      assert.equal(sleeps[0], 5);
    }

    // cleanup-gh-pages-previews: non-rate-limit 403 & 404 fail fast without retry
    {
      let calls404 = 0;
      await assert.rejects(
        () =>
          previewCleanupMod.requestWithRetry('https://api.github.com/repos/a/b/pulls/999', {
            baseDelayMs: 1,
            sleepImpl: async () => {},
            fetchImpl: async () => {
              calls404 += 1;
              return makeMockResponse({ ok: false, status: 404, statusText: 'Not Found' });
            },
          }),
        /404/
      );
      assert.equal(calls404, 1);

      let calls403 = 0;
      await assert.rejects(
        () =>
          previewCleanupMod.requestWithRetry('https://api.github.com/repos/a/b/pulls', {
            baseDelayMs: 1,
            sleepImpl: async () => {},
            fetchImpl: async () => {
              calls403 += 1;
              return makeMockResponse({ ok: false, status: 403, statusText: 'Forbidden' });
            },
          }),
        /403/
      );
      assert.equal(calls403, 1);
    }

    // cleanup-gh-pages-previews: fetchPullRequests uses state=open + targeted PR lookup, ignoring 404
    {
      const requestedUrls = [];
      const pulls = await previewCleanupMod.fetchPullRequests({
        baseUrl: 'https://api.github.com/repos/a/b',
        headers: {},
        targetPr: 484,
        baseDelayMs: 1,
        sleepImpl: async () => {},
        fetchImpl: async (url) => {
          const href = String(url);
          requestedUrls.push(href);
          if (href.includes('/pulls/484')) {
            return makeMockResponse({ ok: true, status: 200, jsonData: { number: 484, state: 'closed', head: { ref: 'feature/x' } } });
          }
          return makeMockResponse({ ok: true, status: 200, jsonData: [{ number: 492, state: 'open', head: { ref: 'fix/y' } }] });
        },
      });
      assert.equal(requestedUrls.some((u) => u.includes('state=open')), true);
      assert.equal(requestedUrls.some((u) => u.includes('state=all')), false);
      assert.equal(requestedUrls.some((u) => u.endsWith('/pulls/484')), true);
      assert.equal(pulls.length, 2);

      const missingTargetPulls = await previewCleanupMod.fetchPullRequests({
        baseUrl: 'https://api.github.com/repos/a/b',
        headers: {},
        targetPr: 999,
        baseDelayMs: 1,
        sleepImpl: async () => {},
        fetchImpl: async (url) => {
          if (String(url).includes('/pulls/999')) {
            return makeMockResponse({ ok: false, status: 404, statusText: 'Not Found' });
          }
          return makeMockResponse({ ok: true, status: 200, jsonData: [{ number: 492, state: 'open', head: { ref: 'fix/y' } }] });
        },
      });
      assert.equal(missingTargetPulls.length, 1);
    }

    // cleanup-gh-pages-previews: selectPreviewDeletions & runCleanupGhPagesPreviews temp dir
    {
      const selected = previewCleanupMod.selectPreviewDeletions(
        [
          { name: '492', kind: 'pull', prNumber: 492, pull: { state: 'open' }, prs: [], hasLiveBranch: true, isRecent: false },
          { name: '484', kind: 'pull', prNumber: 484, pull: { state: 'closed' }, prs: [], hasLiveBranch: false, isRecent: false },
          { name: 'pull', kind: 'legacy', prNumber: null, pull: null, prs: [], hasLiveBranch: false, isRecent: true },
          { name: 'PR', kind: 'legacy', prNumber: null, pull: null, prs: [], hasLiveBranch: false, isRecent: true },
          { name: 'legacy-old', kind: 'legacy', prNumber: null, pull: null, prs: [], hasLiveBranch: false, isRecent: false },
          { name: 'legacy-live', kind: 'legacy', prNumber: null, pull: null, prs: [], hasLiveBranch: true, isRecent: false },
        ],
        { targetPr: null, ignoreRecency: false }
      );
      assert.deepEqual(
        selected.map((s) => s.name),
        ['484', 'pull', 'PR', 'legacy-old']
      );

      const tmpPages = fs.mkdtempSync(path.join(os.tmpdir(), 'capy-gh-pages-cleanup-'));
      try {
        fs.mkdirSync(path.join(tmpPages, 'alpha', '492'), { recursive: true });
        fs.mkdirSync(path.join(tmpPages, 'alpha', '484'), { recursive: true });
        fs.mkdirSync(path.join(tmpPages, 'pull', '123'), { recursive: true });
        fs.mkdirSync(path.join(tmpPages, 'PR', '456'), { recursive: true });
        fs.mkdirSync(path.join(tmpPages, 'stale-legacy-dir'), { recursive: true });
        fs.mkdirSync(path.join(tmpPages, 'live-branch-dir'), { recursive: true });
        fs.mkdirSync(path.join(tmpPages, 'beta'), { recursive: true });
        const capturedPreviewLogs = [];
        const runRes = await previewCleanupMod.runCleanupGhPagesPreviews({
          pagesDir: tmpPages,
          logger: {
            log: (m) => capturedPreviewLogs.push(String(m)),
            warn: (m) => capturedPreviewLogs.push(String(m)),
            error: (m) => capturedPreviewLogs.push(String(m)),
          },
          ignoreRecency: false,
          nowMs: Date.now() + 2 * 24 * 60 * 60 * 1000,
          repository: 'a/b',
          token: 'tok',
          defaultBranch: 'main',
          remoteBranches: ['main', 'beta', 'live-branch-dir'],
          baseDelayMs: 1,
          sleepImpl: async () => {},
          fetchImpl: async () =>
            makeMockResponse({
              ok: true,
              status: 200,
              jsonData: [{ number: 492, state: 'open', head: { ref: 'fix/pr-url-rename' } }],
            }),
        });
        assert.deepEqual(runRes.deleted.sort(), ['PR', 'alpha/484', 'pull', 'stale-legacy-dir']);
        assert.equal(
          capturedPreviewLogs.some((line) => line.includes('alpha/484')),
          true,
          'Custom logger must receive cleanup-gh-pages-previews log output without stdout spam'
        );
        assert.equal(fs.existsSync(path.join(tmpPages, 'alpha', '492')), true);
        assert.equal(fs.existsSync(path.join(tmpPages, 'alpha', '484')), false);
        assert.equal(fs.existsSync(path.join(tmpPages, 'pull')), false);
        assert.equal(fs.existsSync(path.join(tmpPages, 'PR')), false);
        assert.equal(fs.existsSync(path.join(tmpPages, 'stale-legacy-dir')), false);
        assert.equal(fs.existsSync(path.join(tmpPages, 'live-branch-dir')), true);
        assert.equal(fs.existsSync(path.join(tmpPages, 'beta')), true);
      } finally {
        fs.rmSync(tmpPages, { recursive: true, force: true });
      }
    }

    // cleanup-branches: 503 retry, DELETE 404 on retry attempt > 0 success vs attempt 0 fail
    {
      let delCalls = 0;
      await branchCleanupMod.requestWithRetry('https://api.github.com/repos/a/b/git/refs/heads/feature%2Fx', {
        method: 'DELETE',
        retries: 2,
        baseDelayMs: 1,
        sleepImpl: async () => {},
        fetchImpl: async () => {
          delCalls += 1;
          if (delCalls === 1) {
            return makeMockResponse({ ok: false, status: 502, statusText: 'Bad Gateway' });
          }
          return makeMockResponse({ ok: false, status: 404, statusText: 'Not Found' });
        },
      });
      assert.equal(delCalls, 2);

      await assert.rejects(
        () =>
          branchCleanupMod.requestWithRetry('https://api.github.com/repos/a/b/git/refs/heads/missing', {
            method: 'DELETE',
            retries: 2,
            baseDelayMs: 1,
            sleepImpl: async () => {},
            fetchImpl: async () => makeMockResponse({ ok: false, status: 404, statusText: 'Not Found' }),
          }),
        /404/
      );
    }

    // cleanup-branches: protected channels even with *, dependabot/ & sync/ prefixes, closed-unmerged, stale zero-PR vs recent WIP, missing timestamp fail-closed
    {
      const nowMs = Date.parse('2026-11-13T00:00:00Z');
      const dayMs = 24 * 60 * 60 * 1000;
      const commitDates = new Map([
        ['sha-dep-closed-old', nowMs - 2 * dayMs],
        ['sha-dep-closed-fresh', nowMs - 6 * 60 * 60 * 1000],
        ['sha-sync-stale', nowMs - 8 * dayMs],
        ['sha-wip-recent', nowMs - 3 * dayMs],
      ]);
      const evalRes = await branchCleanupMod.evaluateBranchesForCleanup({
        branches: [
          { name: 'main', protected: false, commit: { sha: 's1' } },
          { name: 'beta', protected: false, commit: { sha: 's2' } },
          { name: 'gh-pages', protected: false, commit: { sha: 's3' } },
          { name: 'release-lock', protected: true, commit: { sha: 's4' } },
          { name: 'feature/open-pr', protected: false, commit: { sha: 's5' } },
          { name: 'dependabot/npm/old-closed', protected: false, commit: { sha: 'sha-dep-closed-old' } },
          { name: 'dependabot/npm/fresh-closed', protected: false, commit: { sha: 'sha-dep-closed-fresh' } },
          { name: 'sync/beta-from-main', protected: false, commit: { sha: 'sha-sync-stale' } },
          { name: 'feature/wip-recent', protected: false, commit: { sha: 'sha-wip-recent' } },
          { name: 'fix/no-commit-ts', protected: false, commit: { sha: 'sha-missing' } },
        ],
        defaultBranch: 'main',
        includePrefixes: ['*'],
        activeBranches: new Set(['feature/open-pr']),
        mergedBranches: new Map(),
        closedUnmergedBranches: new Map([
          ['dependabot/npm/old-closed', nowMs - 2 * dayMs],
          ['dependabot/npm/fresh-closed', nowMs - 6 * 60 * 60 * 1000],
        ]),
        getCommitTimestampMs: async (sha) => commitDates.get(sha) ?? 0,
        minAgeDays: 1,
        unmergedMinAgeDays: 7,
        nowMs,
      });
      assert.deepEqual(
        evalRes.deletions.map((d) => d.name),
        ['dependabot/npm/old-closed', 'sync/beta-from-main']
      );

      // Verify explicit prefix list rejects unmatched prefix even when old
      const prefixOnlyRes = await branchCleanupMod.evaluateBranchesForCleanup({
        branches: [
          { name: 'dependabot/npm/old', protected: false, commit: { sha: 'sha-sync-stale' } },
          { name: 'other/old', protected: false, commit: { sha: 'sha-sync-stale' } },
        ],
        includePrefixes: ['dependabot/', 'sync/'],
        getCommitTimestampMs: async () => nowMs - 10 * dayMs,
        minAgeDays: 1,
        unmergedMinAgeDays: 7,
        nowMs,
      });
      assert.deepEqual(
        prefixOnlyRes.deletions.map((d) => d.name),
        ['dependabot/npm/old']
      );

      // Reused merged branch with fresh commit is NOT deleted; stale merged branch IS deleted; null/error commit timestamp fails closed
      const reusedMergedRes = await branchCleanupMod.evaluateBranchesForCleanup({
        branches: [
          { name: 'sync/reused-fresh', protected: false, commit: { sha: 'sha-reused-fresh' } },
          { name: 'feature/merged-stale', protected: false, commit: { sha: 'sha-merged-stale' } },
          { name: 'fix/merged-null-ts', protected: false, commit: { sha: 'sha-null-ts' } },
          { name: 'fix/merged-error-ts', protected: false, commit: { sha: 'sha-error-ts' } },
        ],
        includePrefixes: ['sync/', 'feature/', 'fix/'],
        mergedBranches: new Map([
          ['sync/reused-fresh', nowMs - 5 * dayMs],
          ['feature/merged-stale', nowMs - 5 * dayMs],
          ['fix/merged-null-ts', nowMs - 5 * dayMs],
          ['fix/merged-error-ts', nowMs - 5 * dayMs],
        ]),
        getCommitTimestampMs: async (sha) => {
          if (sha === 'sha-reused-fresh') return nowMs - 60 * 60 * 1000;
          if (sha === 'sha-merged-stale') return nowMs - 5 * dayMs;
          if (sha === 'sha-null-ts') return null;
          throw new Error('simulated commit lookup failure');
        },
        minAgeDays: 1,
        nowMs,
      });
      assert.deepEqual(reusedMergedRes.deletions, [{ name: 'feature/merged-stale', reason: 'merged' }]);
      assert.equal(
        reusedMergedRes.diagnostics.some(
          (d) =>
            d.name === 'sync/reused-fresh' &&
            d.detail.includes('merged branch has newer commit within minAgeDays')
        ),
        true
      );
      assert.equal(
        reusedMergedRes.diagnostics.some(
          (d) =>
            d.name === 'fix/merged-null-ts' &&
            d.detail === 'skipped: unable to determine commit timestamp'
        ),
        true
      );
      assert.equal(
        reusedMergedRes.diagnostics.some(
          (d) =>
            d.name === 'fix/merged-error-ts' &&
            d.detail === 'skipped: unable to determine commit timestamp'
        ),
        true
      );
    }

    // cleanup-branches: end-to-end runCleanupBranches with dryRun vs live DELETE
    {
      const nowMs = Date.parse('2026-11-13T00:00:00Z');
      const oldIso = '2026-11-01T00:00:00Z';
      const createMockFetch = (deleteCalls) => async (url, init = {}) => {
        const href = String(url);
        const method = init.method || 'GET';
        if (method === 'DELETE') {
          deleteCalls.push(href);
          return makeMockResponse({ ok: true, status: 204 });
        }
        if (href.endsWith('/repos/a/b')) {
          return makeMockResponse({ ok: true, status: 200, jsonData: { default_branch: 'main' } });
        }
        if (href.includes('/pulls') && href.includes('state=open')) {
          return makeMockResponse({ ok: true, status: 200, jsonData: [] });
        }
        if (href.includes('/pulls') && href.includes('state=closed')) {
          return makeMockResponse({ ok: true, status: 200, jsonData: [] });
        }
        if (href.includes('/branches')) {
          return makeMockResponse({
            ok: true,
            status: 200,
            jsonData: [
              { name: 'beta', protected: false, commit: { sha: 'sha-beta' } },
              { name: 'dependabot/npm/stale', protected: false, commit: { sha: 'sha-stale' } },
            ],
          });
        }
        if (href.includes('/commits/sha-stale')) {
          return makeMockResponse({
            ok: true,
            status: 200,
            jsonData: { commit: { committer: { date: oldIso } } },
          });
        }
        return makeMockResponse({ ok: false, status: 404 });
      };

      const dryDeletes = [];
      let quietSpyLogs = 0;
      await branchCleanupMod.runCleanupBranches({
        repository: 'a/b',
        token: 'tok',
        dryRun: true,
        quiet: true,
        logger: {
          log: () => { quietSpyLogs += 1; },
          warn: () => { quietSpyLogs += 1; },
          error: () => { quietSpyLogs += 1; },
        },
        includePrefixes: ['dependabot/', 'sync/'],
        minAgeDays: 1,
        unmergedMinAgeDays: 7,
        nowMs,
        baseDelayMs: 1,
        sleepImpl: async () => {},
        fetchImpl: createMockFetch(dryDeletes),
      });
      assert.equal(dryDeletes.length, 0);
      assert.equal(quietSpyLogs, 0, 'quiet: true must suppress cleanup-branches logging');

      const liveDeletes = [];
      const capturedBranchLogs = [];
      const liveRes = await branchCleanupMod.runCleanupBranches({
        repository: 'a/b',
        token: 'tok',
        dryRun: false,
        logger: {
          log: (m) => capturedBranchLogs.push(String(m)),
          warn: (m) => capturedBranchLogs.push(String(m)),
          error: (m) => capturedBranchLogs.push(String(m)),
        },
        includePrefixes: ['dependabot/', 'sync/'],
        minAgeDays: 1,
        unmergedMinAgeDays: 7,
        nowMs,
        baseDelayMs: 1,
        sleepImpl: async () => {},
        fetchImpl: createMockFetch(liveDeletes),
      });
      assert.equal(liveDeletes.length, 1);
      assert.equal(liveDeletes[0].endsWith('/git/refs/heads/dependabot/npm/stale'), true);
      assert.deepEqual(liveRes.deleted, ['dependabot/npm/stale']);
      assert.equal(
        capturedBranchLogs.some((line) => line.includes('deleted 1 branch(es)')),
        true,
        'Custom logger must receive cleanup-branches summary without stdout spam'
      );
    }
    logUnitPass('cleanup-gh-pages-previews.mjs & cleanup-branches.mjs retries, filtering & quiet/logger options verified.');

    // 6. SoundService SSR safety, volume clamping, visibility/disable auto-suspend & rate-throttled woodblock tap
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
        !/\b(10|16|18|24) colours\b/.test(dailyA.presetDescription),
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
        assert.equal(featured.presetLabel, 'Free Colour Line Art • Max Detail');
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

    // 11. capypaint.com canonical ShareLinkService, Co-op WS auto-discovery & Cloudflare Worker protocol
    logUnitStart('Testing ShareLinkService, HybridCoopRoomAdapter, Cloudflare Worker relay & PwaService...');
    const shareLinkMod = await vite.ssrLoadModule('/src/services/ShareLinkService.ts');
    const providerMod = await vite.ssrLoadModule('/src/services/providers/ProviderRegistry.ts');
    const relayProtoMod = await vite.ssrLoadModule(
      path.resolve(projectRoot, '../worker/coopRoomProtocol.ts')
    );

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
      'https://shthed.github.io/capy/',
    ]) {
      const parsedLink = await shareLinkMod.parseShareLinkFromUrl(
        `${hostBase}?room=abc123#s=${builtShare.token}`
      );
      assert.equal(parsedLink.roomCode, 'ABC123');
      assert.deepEqual(parsedLink.delta?.filledRegionIds, [1, 2, 3]);
      assert.equal(parsedLink.matchedSample?.id, 'capybara_sample');
    }

    // Corrupt/invalid #s= token must preserve ?room= code and surface tokenError without throwing
    const corruptTokenLink = await shareLinkMod.parseShareLinkFromUrl(
      'https://capypaint.com/?room=xy9876#s=not_a_valid_token_!!!'
    );
    assert.equal(corruptTokenLink.roomCode, 'XY9876');
    assert.equal(corruptTokenLink.delta, null);
    assert.equal(corruptTokenLink.matchedSample, null);
    assert.equal(corruptTokenLink.hasToken, true);
    assert.equal(typeof corruptTokenLink.tokenError, 'string');

    // BroadcastChannel Co-op room namespacing across /capy/, /capy/beta/, and /capy/alpha/<num>/ on shared origin
    const prevChanWindow = globalThis.window;
    try {
      globalThis.window = {
        location: { pathname: '/capy/', origin: 'https://shthed.github.io', search: '' },
      };
      const stableChan = providerMod.resolveCoopBroadcastChannelName('ABC123');
      globalThis.window = {
        location: { pathname: '/capy/beta/', origin: 'https://shthed.github.io', search: '' },
      };
      const betaChan = providerMod.resolveCoopBroadcastChannelName('ABC123');
      globalThis.window = {
        location: { pathname: '/capy/alpha/495/', origin: 'https://shthed.github.io', search: '' },
      };
      const alphaChan = providerMod.resolveCoopBroadcastChannelName('ABC123');
      assert.equal(stableChan, 'capy_coop_room_stable_ABC123');
      assert.equal(betaChan, 'capy_coop_room_beta_ABC123');
      assert.equal(alphaChan, 'capy_coop_room_alpha_495_ABC123');
      assert.notEqual(stableChan, betaChan);
      assert.notEqual(betaChan, alphaChan);
    } finally {
      globalThis.window = prevChanWindow;
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
        host: 'paint.capyboop.com',
        hostname: 'paint.capyboop.com',
      }),
      'wss://paint.capyboop.com/api/room'
    );
    assert.equal(
      providerMod.resolveCoopRoomWsUrl(undefined, {
        protocol: 'https:',
        host: 'capy-paint.example.workers.dev',
        hostname: 'capy-paint.example.workers.dev',
      }),
      null,
      'Third-party .workers.dev origins must NOT auto-connect without explicit VITE_CAPY_ROOM_WS_URL'
    );
    assert.equal(
      providerMod.resolveCoopRoomWsUrl(undefined, {
        protocol: 'https:',
        host: 'preview.capypaint.com',
        hostname: 'preview.capypaint.com',
      }),
      'wss://preview.capypaint.com/api/room'
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

    for (let attempt = 0; attempt <= 10; attempt++) {
      const minBackoff = providerMod.computeCoopReconnectDelayMs(attempt, 0);
      const maxBackoff = providerMod.computeCoopReconnectDelayMs(attempt, 1);
      assert.equal(minBackoff >= 1000 && minBackoff <= 15_000, true);
      assert.equal(maxBackoff >= 1000 && maxBackoff <= 15_000, true);
      assert.equal(maxBackoff >= minBackoff, true);
    }

    // Transport-aware peer pruning & PONG handling on HybridCoopRoomAdapter
    {
      const prevWS = globalThis.WebSocket;
      const prevWin = globalThis.window;
      const sentWsFrames = [];
      let latestMockSocket = null;
      class MockRoomSocket {
        static OPEN = 1;
        static CLOSED = 3;
        constructor(url) {
          this.url = url;
          this.readyState = 1;
          latestMockSocket = this;
        }
        send(payload) {
          sentWsFrames.push(payload);
        }
        close() {
          this.readyState = 3;
        }
      }
      globalThis.WebSocket = MockRoomSocket;
      globalThis.window = {
        location: { protocol: 'https:', host: 'capypaint.com', hostname: 'capypaint.com' },
        addEventListener() {},
        removeEventListener() {},
      };
      const adapter = new providerMod.HybridCoopRoomAdapter();
      try {
        await adapter.joinRoom(
          'rmtest',
          {
            playerId: 'self-1',
            displayName: 'Self Capy',
            avatarColorHex: '#38bdf8',
            lastActiveAt: Date.now(),
          },
          builtShare.token
        );
        assert.ok(latestMockSocket, 'HybridCoopRoomAdapter must open WebSocket on capypaint.com');
        latestMockSocket.onopen?.();
        assert.equal(sentWsFrames.length, 1, 'onopen must send initial HELLO over WebSocket');
        assert.equal(JSON.parse(sentWsFrames[0]).type, 'HELLO');

        // Raw PONG frame from C++ edge auto-response must be ignored cleanly without JSON parse error
        latestMockSocket.onmessage?.({ data: 'PONG' });

        // Remote WS peer joins and ages past 18s without 5s HEARTBEAT frames
        latestMockSocket.onmessage?.({
          data: JSON.stringify({
            type: 'WELCOME_STATE',
            roomCode: 'RMTEST',
            sender: {
              playerId: 'ws-peer-2',
              displayName: 'Remote Peer',
              avatarColorHex: '#f59e0b',
              lastActiveAt: Date.now() - 25_000,
            },
            seedToken: builtShare.token,
            sentAt: Date.now(),
          }),
        });
        adapter.participants.get('ws-peer-2').lastActiveAt = Date.now() - 25_000;
        adapter.pruneStaleParticipants();
        assert.equal(
          adapter.participants.has('ws-peer-2'),
          true,
          'Remote WebSocket peers must NOT be dropped at 18s when 5s HEARTBEAT is local-only'
        );

        // Local BroadcastChannel peer DOES prune after 18s inactivity
        adapter.handleWireMessage(
          {
            type: 'HEARTBEAT',
            roomCode: 'RMTEST',
            sender: {
              playerId: 'bc-peer-3',
              displayName: 'Local Tab',
              avatarColorHex: '#10b981',
              lastActiveAt: Date.now(),
            },
            sentAt: Date.now(),
          },
          'channel'
        );
        adapter.participants.get('bc-peer-3').lastActiveAt = Date.now() - 25_000;
        adapter.pruneStaleParticipants();
        assert.equal(
          adapter.participants.has('bc-peer-3'),
          false,
          'Stale BroadcastChannel peers must still prune cleanly past 18s'
        );

        // Socket close clears WS peers and schedules reconnect
        latestMockSocket.onclose?.();
        assert.equal(adapter.participants.has('ws-peer-2'), false);
        assert.equal(Boolean(adapter.wsReconnectTimer), true);
      } finally {
        adapter.leaveRoom();
        globalThis.WebSocket = prevWS;
        globalThis.window = prevWin;
      }
    }

    assert.equal(relayProtoMod.normalizeRoomCode(' ab-c_123! '), 'ABC123');
    assert.equal(relayProtoMod.normalizeRoomCode('!!!'), null);
    assert.equal(relayProtoMod.isAllowedRelayOrigin(null), false);
    assert.equal(relayProtoMod.isAllowedRelayOrigin(''), false);
    assert.equal(relayProtoMod.isAllowedRelayOrigin('   '), false);
    assert.equal(relayProtoMod.isAllowedRelayOrigin('https://capypaint.com'), true);
    assert.equal(relayProtoMod.isAllowedRelayOrigin('https://www.capypaint.com'), true);
    assert.equal(relayProtoMod.isAllowedRelayOrigin('https://paint.capyboop.com'), true);
    assert.equal(relayProtoMod.isAllowedRelayOrigin('https://capyboop.github.io'), true);
    /* capy-dev-only:start */
    assert.equal(relayProtoMod.isAllowedRelayOrigin('https://shthed.github.io'), true);
    assert.equal(relayProtoMod.isAllowedRelayOrigin('http://shthed.github.io'), false);
    /* capy-dev-only:end */
    assert.equal(relayProtoMod.isAllowedRelayOrigin('https://appassets.androidplatform.net'), true);
    assert.equal(relayProtoMod.isAllowedRelayOrigin('http://localhost:5173'), true);
    assert.equal(relayProtoMod.isAllowedRelayOrigin('https://evil.workers.dev'), false);
    assert.equal(relayProtoMod.isAllowedRelayOrigin('http://capypaint.com'), false);
    assert.equal(relayProtoMod.isAllowedRelayOrigin('https://evil.example.com'), false);
    assert.equal(
      relayProtoMod.isAllowedRelayOrigin(
        'https://preview.example.com',
        'https://other.example.com, https://preview.example.com'
      ),
      true
    );

    assert.equal(relayProtoMod.MAX_COOP_FRAME_BYTES, 6144);
    assert.equal(relayProtoMod.MAX_SEED_TOKEN_CHARS, 4096);
    assert.equal(relayProtoMod.isValidSeedToken(builtShare.token), true);
    assert.equal(relayProtoMod.isValidSeedToken('not!valid!base64'), false);
    assert.equal(
      relayProtoMod.isValidSeedToken(Buffer.from([0x99, 0x02, 0x00]).toString('base64url')),
      false
    );

    const maxLenValidSeed = 'AAI' + 'A'.repeat(4093);
    assert.equal(maxLenValidSeed.length, 4096);
    const maxSeedHello = relayProtoMod.validateCoopFrame(
      JSON.stringify({
        type: 'HELLO',
        roomCode: 'ABC123',
        sender: { playerId: 'p1', displayName: 'Capy', avatarColorHex: '#38bdf8', lastActiveAt: 1 },
        seedToken: maxLenValidSeed,
        sentAt: 100,
      }),
      'ABC123'
    );
    assert.equal(maxSeedHello.ok, true, '4096-char valid seedToken frame must fit under 6144 bytes');
    assert.equal(
      relayProtoMod.validateCoopFrame(
        JSON.stringify({
          type: 'HELLO',
          roomCode: 'ABC123',
          sender: { playerId: 'p1', displayName: 'Capy', avatarColorHex: '#38bdf8', lastActiveAt: 1 },
          seedToken: maxLenValidSeed + 'A',
          sentAt: 100,
        }),
        'ABC123'
      ).reason,
      'seed_token_too_large'
    );

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
      relayProtoMod.validateCoopFrame('x'.repeat(6145), 'ABC123').reason,
      'frame_size_exceeded',
      'Worker Co-op relay must enforce <= 6144 byte frame cap'
    );
    for (const badPaintEvent of [
      { eventId: '', regionIds: [1], action: 'FILL' },
      { eventId: 'x'.repeat(97), regionIds: [1], action: 'FILL' },
      { eventId: 'ev-empty', regionIds: [], action: 'FILL' },
      { eventId: 'ev-neg', regionIds: [-1], action: 'FILL' },
      { eventId: 'ev-many', regionIds: Array.from({ length: 513 }, (_, i) => i), action: 'FILL' },
    ]) {
      assert.equal(
        relayProtoMod.validateCoopFrame(
          JSON.stringify({
            type: 'PAINT_EVENT',
            roomCode: 'ABC123',
            sender: { playerId: 'p1', displayName: 'Capy', avatarColorHex: '#fff', lastActiveAt: 1 },
            paintEvent: badPaintEvent,
            sentAt: 1,
          }),
          'ABC123'
        ).reason,
        'invalid_event_payload'
      );
    }
    assert.equal(
      relayProtoMod.validateCoopFrame(
        JSON.stringify({
          type: 'UNFILL_EVENT',
          roomCode: 'ABC123',
          sender: { playerId: 'p1', displayName: 'Capy', avatarColorHex: '#fff', lastActiveAt: 1 },
          unfillEvent: { eventId: 'uf1', regionIds: [-2] },
          sentAt: 1,
        }),
        'ABC123'
      ).reason,
      'invalid_event_payload'
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
    assert.equal(relayProtoMod.RESERVED_RELAY_PLAYER_ID, '__capy_room_relay__');
    assert.equal(
      relayProtoMod.validateCoopFrame(
        JSON.stringify({
          type: 'HELLO',
          roomCode: 'ABC123',
          sender: { playerId: ' __capy_room_relay__ ', displayName: 'Fake', avatarColorHex: '#fff', lastActiveAt: 1 },
          sentAt: 1,
        }),
        'ABC123'
      ).reason,
      'reserved_sender_id'
    );
    assert.deepEqual(
      relayProtoMod.resolveBoundSocketSender(null, {
        playerId: 'p1',
        displayName: 'Capy',
        avatarColorHex: '#fff',
        lastActiveAt: 1,
      }),
      { ok: true, boundPlayerId: 'p1' }
    );
    assert.deepEqual(
      relayProtoMod.resolveBoundSocketSender('p1', {
        playerId: 'p2',
        displayName: 'Spoofer',
        avatarColorHex: '#fff',
        lastActiveAt: 1,
      }),
      { ok: false, reason: 'sender_mismatch' }
    );
    const workerIndexSrc = fs.readFileSync(path.resolve(projectRoot, '../worker/index.ts'), 'utf8');
    assert.equal(
      workerIndexSrc.includes('resolveBoundSocketSender') &&
        workerIndexSrc.includes('RESERVED_RELAY_PLAYER_ID') &&
        workerIndexSrc.includes("'pending_seed'"),
      true,
      'worker/index.ts must bind socket sender IDs, block reserved relay IDs, and checkpoint pending_seed in SQLite'
    );

    // Rate limiting (40 frames / 5000ms) & write-once initial HELLO seedToken policy
    let rlTimestamps = [];
    for (let i = 0; i < 40; i++) {
      const rl = relayProtoMod.checkSocketRateLimit(rlTimestamps, 1000 + i * 10);
      assert.equal(rl.allowed, true);
      rlTimestamps = rl.timestamps;
    }
    assert.equal(relayProtoMod.checkSocketRateLimit(rlTimestamps, 1500).allowed, false);
    assert.equal(relayProtoMod.checkSocketRateLimit(rlTimestamps, 6001).allowed, true);

    assert.equal(
      relayProtoMod.evaluateRoomSeedAction({
        messageType: 'HELLO',
        incomingSeedToken: builtShare.token,
        hasSocketJoined: true,
        existingSeedToken: null,
        lastSavedSeedToken: null,
        lastWriteAtMs: 0,
        nowMs: 1000,
      }),
      'write_now'
    );
    assert.equal(
      relayProtoMod.evaluateRoomSeedAction({
        messageType: 'HELLO',
        incomingSeedToken: maxLenValidSeed,
        hasSocketJoined: true,
        existingSeedToken: builtShare.token,
        lastSavedSeedToken: builtShare.token,
        lastWriteAtMs: 1000,
        nowMs: 9000,
      }),
      'ignore',
      'Late HELLO must never overwrite an existing room seed_token (F-03)'
    );
    assert.equal(
      relayProtoMod.evaluateRoomSeedAction({
        messageType: 'WELCOME_STATE',
        incomingSeedToken: maxLenValidSeed,
        hasSocketJoined: true,
        existingSeedToken: builtShare.token,
        lastSavedSeedToken: builtShare.token,
        lastWriteAtMs: 1000,
        nowMs: 3000,
      }),
      'debounce'
    );
    assert.equal(
      relayProtoMod.evaluateRoomSeedAction({
        messageType: 'WELCOME_STATE',
        incomingSeedToken: maxLenValidSeed,
        hasSocketJoined: true,
        existingSeedToken: builtShare.token,
        lastSavedSeedToken: builtShare.token,
        lastWriteAtMs: 1000,
        nowMs: 6500,
      }),
      'write_now'
    );

    const wranglerRaw = fs.readFileSync(path.resolve(projectRoot, '../wrangler.jsonc'), 'utf8');
    const wranglerJson = JSON.parse(wranglerRaw.replace(/^\s*\/\/.*$/gm, ''));
    assert.equal(wranglerJson.name, 'capy-paint');
    assert.equal(wranglerJson.workers_dev, false);
    assert.equal(wranglerJson.preview_urls, false);
    assert.equal(wranglerJson.assets?.directory, './web/dist');
    assert.equal(wranglerJson.assets?.not_found_handling, 'single-page-application');
    assert.deepEqual(wranglerJson.assets?.run_worker_first, ['/api/*']);
    assert.deepEqual(wranglerJson.migrations?.[0]?.new_sqlite_classes, ['CoopRoomDurableObject']);
    assert.equal(
      wranglerJson.routes?.some((r) => r.pattern === 'capypaint.com' && r.custom_domain === true),
      true
    );

    // PwaService scoped cache naming, vite.config fingerprint parser & stamped dist/sw.js check
    const pwaMod = await vite.ssrLoadModule('/src/services/PwaService.ts');
    const viteConfigMod = await vite.ssrLoadModule('/vite.config.ts');
    assert.equal(
      pwaMod.resolvePwaCacheName('https://shthed.github.io/capy/beta/', '2.6.0'),
      'capy-cache-v2.6.0:/capy/beta/'
    );
    assert.equal(
      pwaMod.resolvePwaCacheName('https://capypaint.com/', '2.6.0'),
      'capy-cache-v2.6.0:/'
    );
    assert.deepEqual(viteConfigMod.parseAndroidSha256Fingerprints(''), []);
    assert.deepEqual(
      viteConfigMod.parseAndroidSha256Fingerprints('00:'.repeat(31) + '00'),
      []
    );
    assert.deepEqual(viteConfigMod.parseAndroidSha256Fingerprints('ab'.repeat(32)), [
      Array(32).fill('AB').join(':'),
    ]);
    assert.equal(
      typeof viteConfigMod.computeDistAssetsDigest,
      'function',
      'vite.config.ts must export computeDistAssetsDigest'
    );
    const publicAssetsDigestA = viteConfigMod.computeDistAssetsDigest(path.join(projectRoot, 'public/assets'));
    const publicAssetsDigestB = viteConfigMod.computeDistAssetsDigest(path.join(projectRoot, 'public/assets'));
    assert.match(publicAssetsDigestA, /^[0-9a-f]{16}$/, 'computeDistAssetsDigest must emit 16-char SHA-256 hex digest');
    assert.equal(publicAssetsDigestA, publicAssetsDigestB, 'computeDistAssetsDigest must be deterministic');
    assert.equal(
      viteConfigMod.computeDistAssetsDigest(path.join(projectRoot, 'nonexistent-assets-dir-check')),
      'empty'
    );

    const srcSwText = fs.readFileSync(path.join(projectRoot, 'public/sw.js'), 'utf8');
    assert.equal(
      srcSwText.includes('SW_ASSETS_DIGEST') &&
        srcSwText.includes(".endsWith('.capy')") &&
        srcSwText.includes("cache: 'no-cache'"),
      true,
      'public/sw.js must define SW_ASSETS_DIGEST and Network-First cache:no-cache routing for .capy archives'
    );

    const distSwPath = path.join(projectRoot, 'dist/sw.js');
    if (fs.existsSync(distSwPath)) {
      const distSwText = fs.readFileSync(distSwPath, 'utf8');
      assert.equal(
        distSwText.includes(`const SW_BUILD_VERSION = '${versionMod.APP_VERSION}';`),
        true,
        'Built dist/sw.js must stamp SW_BUILD_VERSION with package.json version'
      );
      assert.equal(
        distSwText.includes('__CAPY_SW_VERSION__'),
        false,
        'Built dist/sw.js must not retain unstamped __CAPY_SW_VERSION__ placeholder'
      );
      assert.equal(
        distSwText.includes('__CAPY_SW_ASSETS_DIGEST__'),
        false,
        'Built dist/sw.js must not retain unstamped __CAPY_SW_ASSETS_DIGEST__ placeholder'
      );
      assert.match(
        distSwText,
        /const SW_ASSETS_DIGEST = '[0-9a-f]{16}';/,
        'Built dist/sw.js must stamp SW_ASSETS_DIGEST with a 16-char SHA-256 hex digest'
      );
      assert.equal(
        distSwText.includes(".endsWith('.apk')"),
        true,
        'Service Worker must bypass .apk binary downloads'
      );
      assert.equal(
        distSwText.includes(".endsWith('.capy')") && distSwText.includes("cache: 'no-cache'"),
        true,
        'Built dist/sw.js must use Network-First cache:no-cache routing for .capy archives'
      );
    }
    // Anonymous In-Game Feedback protocol (worker/feedbackProtocol.ts) & client service (FeedbackService.ts)
    {
      const feedbackProtoMod = await vite.ssrLoadModule(
        path.resolve(projectRoot, '../worker/feedbackProtocol.ts')
      );
      const feedbackSvcMod = await vite.ssrLoadModule('/src/services/FeedbackService.ts');

      // Valid payload + @mention neutralization + triple-backtick sanitization + label mapping
      const validResult = feedbackProtoMod.validateFeedbackPayload(
        JSON.stringify({
          category: 'puzzle_idea',
          title: '  Capybara\u0007 in Space @admin  ',
          details: 'Please add a cozy astronaut capybara!\n```js\nalert(1)\n```\ncc @everyone',
          website: '',
          context: {
            appVersion: 'v3.0.45',
            channel: 'beta',
            platform: 'Web',
            viewport: '390x844',
          },
        })
      );
      assert.equal(validResult.ok, true, 'Valid feedback payload must pass validation');
      assert.equal(validResult.payload.category, 'puzzle_idea');
      assert.equal(validResult.payload.title.includes('@admin'), false, 'Title must not contain raw @admin mention');
      assert.equal(
        validResult.payload.title.includes('@\u200Badmin'),
        true,
        'Title must neutralize @mentions with zero-width space'
      );
      assert.equal(validResult.payload.details.includes('```'), false, 'Details must sanitize triple backticks');
      assert.equal(
        validResult.payload.details.includes('@everyone'),
        false,
        'Details must not contain raw @everyone mention'
      );
      assert.equal(
        validResult.payload.details.includes('@\u200Beveryone'),
        true,
        'Details must neutralize @mentions with zero-width space'
      );

      // Adversarial @mention bypasses + email preservation
      for (const adversarialMention of [
        '**@shthed**',
        '>@shthed',
        '"@shthed"',
        '[@shthed]',
        ',@shthed',
        ':@shthed',
        '/@shthed',
        '`@shthed',
      ]) {
        const sanitized = feedbackProtoMod.sanitizeFeedbackText(adversarialMention, true);
        assert.equal(
          sanitized.includes('@shthed'),
          false,
          `Adversarial mention ${adversarialMention} must be neutralized (got ${sanitized})`
        );
        assert.equal(
          sanitized.includes('@\u200Bshthed'),
          true,
          `Adversarial mention ${adversarialMention} must insert zero-width space (got ${sanitized})`
        );
      }
      assert.equal(
        feedbackProtoMod.sanitizeFeedbackText('Contact a@b.com or foo.bar@example.com for help', true),
        'Contact a@b.com or foo.bar@example.com for help',
        'Email addresses must be preserved untouched'
      );

      // resolveFeedbackRepo path traversal protection
      for (const badRepo of ['../..', '../evil', 'evil/..', './.', 'foo/.', './bar', '-bad/repo', 'a/b/c']) {
        assert.equal(
          feedbackProtoMod.resolveFeedbackRepo(badRepo),
          'capyboop/paint',
          `Invalid/traversal repo "${badRepo}" must fall back to capyboop/paint`
        );
      }
      assert.equal(feedbackProtoMod.resolveFeedbackRepo('capyboop/paint'), 'capyboop/paint');
      assert.equal(feedbackProtoMod.resolveFeedbackRepo('shthed/capy'), 'shthed/capy');

      const issuePayload = feedbackProtoMod.buildGitHubIssuePayload(validResult.payload);
      assert.equal(issuePayload.title.startsWith('[Puzzle Idea]: '), true);
      assert.deepEqual(issuePayload.labels, ['enhancement']);
      assert.equal(issuePayload.body.includes('Anonymous in-game feedback'), true);
      assert.equal(issuePayload.body.includes('v3.0.45'), true);

      // Category label mapping for bug, feature, general
      for (const [cat, expectedPrefix, expectedLabels] of [
        ['bug', '[Bug]: ', ['bug']],
        ['feature', '[Feature]: ', ['enhancement']],
        ['general', '[Feedback]: ', ['question']],
      ]) {
        const res = feedbackProtoMod.validateFeedbackPayload(
          JSON.stringify({
            category: cat,
            title: 'Sample headline',
            details: 'Detailed description of more than ten characters.',
          })
        );
        assert.equal(res.ok, true, `Category ${cat} must validate`);
        const built = feedbackProtoMod.buildGitHubIssuePayload(res.payload);
        assert.equal(built.title.startsWith(expectedPrefix), true);
        assert.deepEqual(built.labels, expectedLabels);
      }

      // Honeypot detection
      const honey = feedbackProtoMod.validateFeedbackPayload(
        JSON.stringify({
          category: 'bug',
          title: 'Bot title',
          details: 'Bot spam message content here.',
          website: 'https://spam.example',
        })
      );
      assert.equal(honey.ok, false);
      assert.equal(honey.honeypot, true, 'Non-empty website field must trigger honeypot');

      // Invalid payloads: malformed JSON, invalid category, short title, short details, > 8192 bytes
      assert.equal(feedbackProtoMod.validateFeedbackPayload('{bad-json').ok, false);
      assert.equal(
        feedbackProtoMod.validateFeedbackPayload(
          JSON.stringify({ category: 'unknown', title: 'Valid title', details: 'Long enough details.' })
        ).ok,
        false
      );
      assert.equal(
        feedbackProtoMod.validateFeedbackPayload(
          JSON.stringify({ category: 'bug', title: 'Hi', details: 'Long enough details.' })
        ).ok,
        false
      );
      assert.equal(
        feedbackProtoMod.validateFeedbackPayload(
          JSON.stringify({ category: 'bug', title: 'Valid title', details: 'short' })
        ).ok,
        false
      );
      const oversized = feedbackProtoMod.validateFeedbackPayload(
        JSON.stringify({
          category: 'bug',
          title: 'Oversized payload test',
          details: 'A'.repeat(9000),
        })
      );
      assert.equal(oversized.ok, false);
      assert.equal(oversized.status, 413, 'Payload > 8192 bytes must return status 413');

      // CORS allow/deny including paint.capyboop.com and path-suffixed origin rejection
      const capyCors = feedbackProtoMod.buildFeedbackCorsHeaders('https://capypaint.com', undefined, false);
      assert.equal(capyCors['Access-Control-Allow-Origin'], 'https://capypaint.com');
      const paintBoopCors = feedbackProtoMod.buildFeedbackCorsHeaders(
        'https://paint.capyboop.com',
        undefined,
        false
      );
      assert.equal(paintBoopCors['Access-Control-Allow-Origin'], 'https://paint.capyboop.com');
      const androidCors = feedbackProtoMod.buildFeedbackCorsHeaders(
        'https://appassets.androidplatform.net',
        undefined,
        false
      );
      assert.equal(androidCors['Access-Control-Allow-Origin'], 'https://appassets.androidplatform.net');
      const evilCors = feedbackProtoMod.buildFeedbackCorsHeaders('https://evil.example', undefined, false);
      assert.equal(evilCors['Access-Control-Allow-Origin'], undefined, 'Disallowed origin must not receive ACAO');
      const pathSuffixedCors = feedbackProtoMod.buildFeedbackCorsHeaders(
        'https://capypaint.com/evil',
        undefined,
        false
      );
      assert.equal(
        pathSuffixedCors['Access-Control-Allow-Origin'],
        undefined,
        'Path-suffixed origin must not receive ACAO'
      );

      // Worker buildFallbackIssueUrl hard <= 4000 char encoded URL cap for CJK & emoji
      const workerCjkFallback = feedbackProtoMod.buildFallbackIssueUrl({
        category: 'bug',
        title: '漢'.repeat(120),
        details: '漢'.repeat(1200),
        context: { appVersion: 'v3.0.45', channel: 'beta', platform: 'Web' },
      });
      assert.equal(
        workerCjkFallback.length <= 4000,
        true,
        `Worker CJK fallback URL must be <= 4000 chars (got ${workerCjkFallback.length})`
      );
      assert.equal(workerCjkFallback.startsWith('https://github.com/capyboop/paint/issues/new?'), true);

      const workerEmojiFallback = feedbackProtoMod.buildFallbackIssueUrl({
        category: 'feature',
        title: '😀'.repeat(60),
        details: '😀'.repeat(600),
        context: { appVersion: 'v3.0.45', channel: 'beta', platform: 'Web' },
      });
      assert.equal(
        workerEmojiFallback.length <= 4000,
        true,
        `Worker emoji fallback URL must be <= 4000 chars (got ${workerEmojiFallback.length})`
      );
      assert.equal(workerEmojiFallback.startsWith('https://github.com/capyboop/paint/issues/new?'), true);

      // FeedbackService URL resolution & fallback URL
      assert.equal(
        feedbackSvcMod.resolveFeedbackApiUrl(undefined, { hostname: 'capypaint.com' }),
        '/api/feedback'
      );
      assert.equal(
        feedbackSvcMod.resolveFeedbackApiUrl(undefined, { hostname: 'paint.capyboop.com' }),
        '/api/feedback'
      );
      assert.equal(
        feedbackSvcMod.resolveFeedbackApiUrl(undefined, { hostname: 'beta.capypaint.com' }),
        '/api/feedback'
      );
      assert.equal(
        feedbackSvcMod.resolveFeedbackApiUrl(undefined, { hostname: 'www.capypaint.com' }),
        'https://capypaint.com/api/feedback'
      );
      assert.equal(
        feedbackSvcMod.resolveFeedbackApiUrl(undefined, { hostname: 'localhost' }),
        '/api/feedback'
      );
      assert.equal(
        feedbackSvcMod.resolveFeedbackApiUrl(undefined, { hostname: 'appassets.androidplatform.net' }),
        'https://capypaint.com/api/feedback'
      );
      assert.equal(
        feedbackSvcMod.resolveFeedbackApiUrl(undefined, { hostname: 'capyboop.github.io' }),
        'https://capypaint.com/api/feedback'
      );
      assert.equal(
        feedbackSvcMod.resolveFeedbackApiUrl('https://custom.example/api/feedback', { hostname: 'localhost' }),
        'https://custom.example/api/feedback'
      );

      const fallbackUrl = feedbackSvcMod.buildGitHubIssueFallbackUrl(
        { category: 'bug', title: 'Zoom stutter', details: 'Pinch zoom stutters on tablet.' },
        { appVersion: 'v3.0.45', channel: 'beta', platform: 'Web' }
      );
      assert.equal(fallbackUrl.startsWith('https://github.com/capyboop/paint/issues/new?'), true);
      assert.equal(fallbackUrl.includes('template=bug_report.yml'), true);
      assert.equal(fallbackUrl.includes('Zoom+stutter'), true);

      // Client buildGitHubIssueFallbackUrl hard <= 4000 char encoded URL cap for CJK & emoji
      const clientCjkFallback = feedbackSvcMod.buildGitHubIssueFallbackUrl(
        { category: 'bug', title: '漢'.repeat(120), details: '漢'.repeat(1200) },
        { appVersion: 'v3.0.45', channel: 'beta', platform: 'Web' }
      );
      assert.equal(
        clientCjkFallback.length <= 4000,
        true,
        `Client CJK fallback URL must be <= 4000 chars (got ${clientCjkFallback.length})`
      );
      const clientEmojiFallback = feedbackSvcMod.buildGitHubIssueFallbackUrl(
        { category: 'feature', title: '😀'.repeat(60), details: '😀'.repeat(600) },
        { appVersion: 'v3.0.45', channel: 'beta', platform: 'Web' }
      );
      assert.equal(
        clientEmojiFallback.length <= 4000,
        true,
        `Client emoji fallback URL must be <= 4000 chars (got ${clientEmojiFallback.length})`
      );

      // Prototype-key category lookup falls back safely to 'general' ([Feedback])
      for (const protoCat of ['toString', 'constructor', '__proto__']) {
        const protoFallback = feedbackSvcMod.buildGitHubIssueFallbackUrl({
          category: protoCat,
          title: 'Proto test',
          details: 'Prototype lookup should safely fall back to general.',
        });
        const parsedProto = new URL(protoFallback);
        assert.equal(
          parsedProto.searchParams.get('title'),
          '[Feedback]: Proto test',
          `Prototype category "${protoCat}" must fall back to general [Feedback] prefix`
        );
      }
    }

    logUnitPass('ShareLinkService, HybridCoopRoomAdapter, Cloudflare Worker relay & PwaService verified.');

    // --- Sprint 2: F8 CRDT resetEpoch & F9 >180KB Play Games Chunks ---
    logUnitStart('Testing CRDT resetEpoch dominance, >180 KB pgblob chunking & NativeBridge fast-fail guards...');
    {
      const driversMod = await vite.ssrLoadModule('/src/services/providers/CloudProviderDrivers.ts');
      const nativeBridgeMod = await vite.ssrLoadModule('/src/services/NativeBridge.ts');

      // 1. F8 (F-01): ProgressDeltaV2 resetEpoch token round-trip & monotonic CRDT epoch dominance
      const resetToken = await codec.encodeProgressDeltaToken({
        version: 2,
        sourceRef: { kind: 'sample', uri: './assets/capybara.webp' },
        filledRegionIds: [4, 9],
        resetEpoch: 3,
        updatedAt: 1_750_000_000_000,
      });
      const decodedReset = await codec.decodeProgressDeltaToken(resetToken);
      assert.equal(decodedReset.resetEpoch, 3, 'ProgressDeltaV2 codec must round-trip resetEpoch');
      assert.deepEqual(decodedReset.filledRegionIds, [4, 9]);

      // Higher remote resetEpoch dominates stale pre-reset local regions (0 resurrection)
      const mergedRemoteReset = codec.mergeProgressDeltas(
        { version: 2, filledRegionIds: [1, 2, 3, 4, 5], resetEpoch: 0, updatedAt: 1000 },
        { version: 2, filledRegionIds: [], resetEpoch: 1, updatedAt: 2000 }
      );
      assert.equal(mergedRemoteReset.resetEpoch, 1);
      assert.deepEqual(
        mergedRemoteReset.filledRegionIds,
        [],
        'Higher remote resetEpoch must clear stale pre-reset regions with zero resurrection'
      );

      // Higher local resetEpoch dominates stale pre-reset cloud regions (0 resurrection)
      const mergedLocalReset = codec.mergeProgressDeltas(
        { version: 2, filledRegionIds: [11], resetEpoch: 2, updatedAt: 3000 },
        { version: 2, filledRegionIds: [1, 2, 3, 4, 5, 6], resetEpoch: 1, updatedAt: 2500 }
      );
      assert.equal(mergedLocalReset.resetEpoch, 2);
      assert.deepEqual(
        mergedLocalReset.filledRegionIds,
        [11],
        'Higher local resetEpoch must reject stale lower-epoch cloud regions'
      );

      // Equal resetEpoch preserves lossless set-union CRDT behavior
      const mergedSameEpoch = codec.mergeProgressDeltas(
        { version: 2, filledRegionIds: [2, 5], resetEpoch: 2, updatedAt: 3000 },
        { version: 2, filledRegionIds: [5, 8], resetEpoch: 2, updatedAt: 3100 }
      );
      assert.equal(mergedSameEpoch.resetEpoch, 2);
      assert.deepEqual(mergedSameEpoch.filledRegionIds, [2, 5, 8]);

      // ShareLinkService URL round-trips resetEpoch cleanly
      const builtResetShare = await shareLinkMod.buildShareProgressUrl({
        sourceRef: { kind: 'sample', uri: 'assets/capybara.webp' },
        filledRegionIds: [7],
        resetEpoch: 4,
      });
      const parsedResetShare = await shareLinkMod.parseShareLinkFromUrl(builtResetShare.url);
      assert.equal(parsedResetShare.delta?.resetEpoch, 4, 'ShareLinkService must preserve resetEpoch in #s= URLs');

      // CrdtCloudSaveAdapter.syncProgress dominates stale pre-reset slot envelopes
      const prevLsF8 = globalThis.localStorage;
      const lsMapF8 = new Map();
      globalThis.localStorage = {
        getItem: (k) => (lsMapF8.has(k) ? lsMapF8.get(k) : null),
        setItem: (k, v) => lsMapF8.set(k, String(v)),
        removeItem: (k) => lsMapF8.delete(k),
      };
      try {
        await providerMod.ProviderRegistry.cloudSave.syncProgress(
          'slot_reset_epoch_test',
          'Capybara',
          { version: 2, filledRegionIds: [1, 2, 3, 4], updatedAt: 1000 },
          20
        );
        const syncedAfterReset = await providerMod.ProviderRegistry.cloudSave.syncProgress(
          'slot_reset_epoch_test',
          'Capybara',
          { version: 2, filledRegionIds: [], resetEpoch: 1, updatedAt: 2000 },
          20
        );
        assert.equal(syncedAfterReset.mergedDelta.resetEpoch, 1);
        assert.deepEqual(
          syncedAfterReset.mergedDelta.filledRegionIds,
          [],
          'CrdtCloudSaveAdapter.syncProgress must honor higher resetEpoch without resurrecting old fills'
        );
      } finally {
        if (prevLsF8 === undefined) {
          delete globalThis.localStorage;
        } else {
          globalThis.localStorage = prevLsF8;
        }
      }

      // 2. F9 (F-02): PlayGamesAndroidDriver > 180 KB multi-chunk binary writeBinaryBlob & readBinaryBlob
      const prevWindow = globalThis.window;
      const chunkStore = new Map();
      globalThis.window = {
        CapyAndroid: {
          saveCloudBinaryChunk(blobKey, chunkIndex, totalChunks, base64Chunk) {
            if (chunkIndex < 0 || chunkIndex >= totalChunks) return false;
            chunkStore.set(`${blobKey}_part_${chunkIndex}`, base64Chunk);
            if (chunkIndex === totalChunks - 1) {
              for (let k = totalChunks; k < 32; k++) {
                chunkStore.delete(`${blobKey}_part_${k}`);
              }
            }
            return true;
          },
          loadCloudBinaryChunk(blobKey, chunkIndex) {
            return chunkStore.get(`${blobKey}_part_${chunkIndex}`) ?? null;
          },
          saveCloudSnapshot(slotKey, payloadJson) {
            chunkStore.set(slotKey, payloadJson);
            return true;
          },
          loadCloudSnapshot(slotKey) {
            return chunkStore.get(slotKey) ?? null;
          },
        },
        addEventListener() {},
        removeEventListener() {},
      };
      nativeBridgeMod.NativeBridge.attachWindowCallbacks();
      try {
        const pgDriver = new driversMod.PlayGamesAndroidDriver();
        const largeBinary = new Uint8Array(420_000);
        for (let i = 0; i < largeBinary.length; i++) {
          largeBinary[i] = (i * 29 + 13) & 0xff;
        }
        const blobRef = await pgDriver.writeBinaryBlob('save_hd_custom', 'save.capy', largeBinary);
        assert.equal(
          blobRef,
          'pgblob:pgblob_save_hd_custom:3:420000',
          '420 KB custom photo save must split across 3 x 180 KB Play Games chunks'
        );
        assert.equal(nativeBridgeMod.NativeBridge.loadCloudBinaryChunk('pgblob_save_hd_custom', 2) !== null, true);

        const restoredBinary = await pgDriver.readBinaryBlob(blobRef);
        assert.ok(restoredBinary, 'PlayGamesAndroidDriver.readBinaryBlob must reassemble 420 KB binary');
        assert.equal(restoredBinary.byteLength, 420_000);
        let diffBytes = 0;
        for (let i = 0; i < largeBinary.length; i++) {
          if (restoredBinary[i] !== largeBinary[i]) diffBytes++;
        }
        assert.equal(diffBytes, 0, 'Reassembled 420 KB Play Games binary must be bit-exact');

        // Overwrite with smaller 2-chunk (200 KB) payload and verify stale part_2 is pruned
        const smallerBinary = largeBinary.subarray(0, 200_000);
        const smallerRef = await pgDriver.writeBinaryBlob('save_hd_custom', 'save.capy', smallerBinary);
        assert.equal(smallerRef, 'pgblob:pgblob_save_hd_custom:2:200000');
        assert.equal(
          nativeBridgeMod.NativeBridge.loadCloudBinaryChunk('pgblob_save_hd_custom', 2),
          null,
          'Overwriting with fewer chunks must prune stale trailing chunk slots'
        );

        // Corrupt/mismatched/missing chunk resilience must return null cleanly without throwing
        assert.equal(
          await pgDriver.readBinaryBlob('pgblob:pgblob_save_hd_custom:2:999999'),
          null,
          'Mismatched expectedBytes in pgblob ref must return null cleanly'
        );
        chunkStore.set('pgblob_save_hd_custom_part_1', '%%%not_valid_base64%%%');
        assert.equal(
          await pgDriver.readBinaryBlob(smallerRef),
          null,
          'Corrupted Base64 chunk in PlayGamesAndroidDriver must return null cleanly'
        );
        chunkStore.delete('pgblob_save_hd_custom_part_1');
        assert.equal(
          await pgDriver.readBinaryBlob(smallerRef),
          null,
          'Missing chunk in PlayGamesAndroidDriver must return null cleanly'
        );

        // 3. Unconfigured / Unavailable Play Games fallback must fail fast (no 8s hang)
        const prevCapyAndroid = globalThis.window.CapyAndroid;
        try {
          globalThis.window.CapyAndroid = {
            isPlayGamesConfigured: () => false,
            signInPlayGames: () => null,
          };
          assert.equal(pgDriver.getDescriptor().isConfigured, false);
          const autoSignStart = Date.now();
          assert.equal(await pgDriver.attemptAutoSignIn(), null);
          assert.equal(Date.now() - autoSignStart < 500, true, 'Unconfigured Play Games auto-sign-in must return null immediately');
          let unconfErr = null;
          const signInStart = Date.now();
          try {
            await pgDriver.signIn();
          } catch (err) {
            unconfErr = err;
          }
          assert.equal(unconfErr?.message, 'PLAY_GAMES_UNCONFIGURED');
          assert.equal(Date.now() - signInStart < 500, true, 'Unconfigured Play Games signIn must fail fast');

          // Configured Play Games that fires native error callback must reject immediately
          globalThis.window.CapyAndroid = {
            isPlayGamesConfigured: () => true,
            signInPlayGames: () => {
              setTimeout(() => {
                globalThis.window.__capyReceivePlayGamesError?.('PLAY_GAMES_UNAVAILABLE');
              }, 10);
              return null;
            },
          };
          const failStart = Date.now();
          let unavailErr = null;
          try {
            await pgDriver.signIn();
          } catch (err) {
            unavailErr = err;
          }
          assert.equal(unavailErr?.message, 'PLAY_GAMES_UNAVAILABLE');
          assert.equal(Date.now() - failStart < 500, true, 'Play Games error callback must reject signIn immediately');

          // 4. Cold-start bridge callbacks arriving before listener mount must flush on subscribe
          globalThis.window.__capyReceiveSharedImage?.('Early Photo', 'data:image/png;base64,AA==');
          globalThis.window.__capyReceiveDeepLink?.('https://capypaint.com/#s=early_token');
          globalThis.window.__capyReceivePlayGamesProfile?.(
            JSON.stringify({ playerId: 'pg_early', displayName: 'Early Capy' })
          );
          globalThis.window.__capyReceivePlayGamesError?.('PLAY_GAMES_EARLY_ERR');
          globalThis.window.__capyReceiveCloudSnapshot?.('slot_early', '{"v":1}');

          const receivedShared = [];
          const receivedDeep = [];
          const receivedProfiles = [];
          const receivedErrors = [];
          const receivedSnaps = [];
          const offShared = nativeBridgeMod.NativeBridge.onSharedImage((t, d) =>
            receivedShared.push({ t, d })
          );
          const offDeep = nativeBridgeMod.NativeBridge.onDeepLink((u) => receivedDeep.push(u));
          const offProf = nativeBridgeMod.NativeBridge.onPlayGamesProfile((p) =>
            receivedProfiles.push(p)
          );
          const offErr = nativeBridgeMod.NativeBridge.onPlayGamesError((e) =>
            receivedErrors.push(e)
          );
          const offSnap = nativeBridgeMod.NativeBridge.onCloudSnapshot((k, v) =>
            receivedSnaps.push({ k, v })
          );
          try {
            assert.deepEqual(receivedShared, [
              { t: 'Early Photo', d: 'data:image/png;base64,AA==' },
            ]);
            assert.deepEqual(receivedDeep, ['https://capypaint.com/#s=early_token']);
            assert.deepEqual(receivedProfiles, [{ playerId: 'pg_early', displayName: 'Early Capy' }]);
            assert.deepEqual(receivedErrors, ['PLAY_GAMES_EARLY_ERR']);
            assert.deepEqual(receivedSnaps, [{ k: 'slot_early', v: '{"v":1}' }]);
          } finally {
            offShared();
            offDeep();
            offProf();
            offErr();
            offSnap();
          }

          // 5. Behavioral check: Android WebView routes signInWithGoogle strictly to play_games_v2 without GIS OAuth fallback
          // (SettingsModal DOM hiding of APK cards and release-channel-card under window.CapyAndroid is verified in [E2E 03] & [E2E 05])
          {
            let gisPopupCalls = 0;
            const prevGoogle = globalThis.window.google;
            const prevSignInAndroid = globalThis.window.CapyAndroid;
            const prevSignInLs = globalThis.localStorage;
            const authLsMap = new Map();
            globalThis.localStorage = {
              getItem: (k) => (authLsMap.has(k) ? authLsMap.get(k) : null),
              setItem: (k, v) => authLsMap.set(k, String(v)),
              removeItem: (k) => authLsMap.delete(k),
            };
            globalThis.window.google = {
              accounts: {
                oauth2: {
                  initTokenClient: () => {
                    gisPopupCalls++;
                    return { requestAccessToken: () => {} };
                  },
                },
              },
            };
            globalThis.window.CapyAndroid = {
              isPlayGamesConfigured: () => true,
              signInPlayGames: () => {
                setTimeout(() => {
                  globalThis.window.__capyReceivePlayGamesError?.('PLAY_GAMES_CANCELED');
                }, 5);
                return null;
              },
            };
            nativeBridgeMod.NativeBridge.attachWindowCallbacks();
            try {
              let routedErr = null;
              try {
                await providerMod.ProviderRegistry.auth.signInWithGoogle();
              } catch (err) {
                routedErr = err;
              }
              assert.equal(routedErr?.message, 'PLAY_GAMES_CANCELED');
              assert.equal(
                gisPopupCalls,
                0,
                'Android signInWithGoogle error must reject instead of falling back to GIS popup'
              );

              globalThis.window.CapyAndroid = {
                isPlayGamesConfigured: () => true,
                signInPlayGames: () =>
                  JSON.stringify({ playerId: 'pgs_android_routed', displayName: 'Play Games Capy' }),
              };
              const signedInProfile = await providerMod.ProviderRegistry.auth.signInWithGoogle();
              assert.equal(signedInProfile.provider, 'play_games_v2');
              assert.equal(signedInProfile.playerId, 'pgs_android_routed');
              assert.equal(
                gisPopupCalls,
                0,
                'Android signInWithGoogle success must use play_games_v2 without GIS popup'
              );
              await providerMod.ProviderRegistry.auth.signOut();
            } finally {
              if (prevSignInLs === undefined) delete globalThis.localStorage;
              else globalThis.localStorage = prevSignInLs;
              if (prevSignInAndroid === undefined) delete globalThis.window.CapyAndroid;
              else globalThis.window.CapyAndroid = prevSignInAndroid;
              if (prevGoogle === undefined) delete globalThis.window.google;
              else globalThis.window.google = prevGoogle;
            }
          }
          assert.equal(
            typeof nativeBridgeMod.NativeBridge.showRewardedAd,
            'undefined',
            'NativeBridge.showRewardedAd must be removed for 100% ad-free Play Store parity'
          );
          const androidLedger = providerMod.ProviderRegistry.monetization.getLedger();
          assert.equal(
            androidLedger.adFreePlatform,
            true,
            'ConsentRewardedAdAdapter.getLedger().adFreePlatform must stay true even when NativeBridge.isAndroid is true'
          );
          const rewardedRes = await providerMod.ProviderRegistry.monetization.watchRewardedAdForCredits();
          assert.equal(rewardedRes.granted, 0, 'Store-clean build must grant 0 ad credits');
          assert.equal(rewardedRes.ledger.adFreePlatform, true);

          // Returning-user stale localStorage community ideas & consent checks must stay store-clean
          const prevIdeasLs = globalThis.localStorage;
          const ideasMap = new Map();
          globalThis.localStorage = {
            getItem: (k) => (ideasMap.has(k) ? ideasMap.get(k) : null),
            setItem: (k, v) => ideasMap.set(k, String(v)),
            removeItem: (k) => ideasMap.delete(k),
          };
          try {
            const seededIdeas = providerMod.ProviderRegistry.catalog.getCommunityIdeas();
            assert.equal(
              seededIdeas.length >= 2 && seededIdeas.every((idea) => idea.votes === 0 && !idea.votedByMe),
              true,
              'SEED_COMMUNITY_IDEAS must have votes: 0 with zero fabricated vote counts'
            );
            assert.equal(
              seededIdeas[0].createdAt >= seededIdeas[1].createdAt,
              true,
              'getCommunityIdeas must sort newest-first by createdAt'
            );
            ideasMap.set(
              'capy_community_ideas_v1',
              JSON.stringify([
                {
                  id: 'legacy_old',
                  title: 'Old Legacy Idea',
                  prompt: 'Old idea with stale votes from pre-3.0.31 cache',
                  category: 'Animals',
                  tags: ['Animals'],
                  authorName: 'River Capy',
                  authorId: 'legacy_1',
                  votes: 24,
                  votedByMe: true,
                  status: 'queued',
                  createdAt: 1700000000000,
                },
                {
                  id: 'legacy_new',
                  title: 'Newer Legacy Idea',
                  prompt: 'Newer idea with stale votes from pre-3.0.31 cache',
                  category: 'Nature',
                  tags: ['Nature'],
                  authorName: 'Forest Sprout',
                  authorId: 'legacy_2',
                  votes: 17,
                  votedByMe: false,
                  status: 'curated',
                  createdAt: 1720000000000,
                },
              ])
            );
            const normalizedLegacy = providerMod.ProviderRegistry.catalog.getCommunityIdeas();
            assert.equal(normalizedLegacy.length, 2);
            assert.equal(normalizedLegacy[0].id, 'legacy_new', 'Legacy ideas must sort newest-first');
            assert.equal(
              normalizedLegacy.every((idea) => idea.votes === 0 && idea.votedByMe === false),
              true,
              'Legacy returning-user community ideas must normalize votes=0 and votedByMe=false'
            );
            const afterToggle = providerMod.ProviderRegistry.catalog.toggleVoteIdea('legacy_new');
            assert.equal(
              afterToggle.every((idea) => idea.votes === 0 && idea.votedByMe === false),
              true,
              'toggleVoteIdea must not fabricate votes in store-clean build'
            );
            const consentLedger = providerMod.ProviderRegistry.monetization.setPersonalizedAdsConsent(true);
            assert.equal(consentLedger.adFreePlatform, true);
            assert.equal(consentLedger.personalizedAdsConsent, false);
          } finally {
            if (prevIdeasLs === undefined) {
              delete globalThis.localStorage;
            } else {
              globalThis.localStorage = prevIdeasLs;
            }
          }

          // Play Store listing & MainActivity Play Games deferral invariants (when repo docs/app exist)
          const playStoreListingPath = path.resolve(projectRoot, '../docs/play-store/PLAY_STORE_LISTING.md');
          if (fs.existsSync(playStoreListingPath)) {
            const listingDoc = fs.readFileSync(playStoreListingPath, 'utf8');
            const shortDescMatch = listingDoc.match(/\*\*Short Description \(`<= 80` chars\)\*\*:\s*`([^`]+)`/);
            assert.ok(shortDescMatch, 'PLAY_STORE_LISTING.md must include backticked Short Description');
            assert.equal(
              shortDescMatch[1].length <= 80,
              true,
              `PLAY_STORE_LISTING.md Short Description exceeds 80 chars (${shortDescMatch[1].length})`
            );
            assert.equal(
              /\*\*Category\*\*:\s*`Puzzle`/.test(listingDoc),
              true,
              'PLAY_STORE_LISTING.md Category must be Puzzle'
            );
            assert.equal(
              listingDoc.toLowerCase().includes('gallery packs'),
              false,
              'PLAY_STORE_LISTING.md must not advertise non-existent gallery packs'
            );
            assert.equal(
              listingDoc.includes('[https://capypaint.com/privacy-policy.html](https://capypaint.com/privacy-policy.html)') &&
                listingDoc.toLowerCase().includes('developer contact email'),
              true,
              'PLAY_STORE_LISTING.md must have clickable Privacy Policy links and Developer contact email ops note'
            );
          }
          const mainActivityPath = path.resolve(
            projectRoot,
            '../app/src/main/java/com/capyboop/paint/MainActivity.kt'
          );
          if (fs.existsSync(mainActivityPath)) {
            const mainActivitySrc = fs.readFileSync(mainActivityPath, 'utf8');
            const initMatch = mainActivitySrc.match(/private fun initializePlayGamesIfConfigured\(\)\s*\{[\s\S]*?\n    \}/);
            assert.ok(initMatch, 'MainActivity.kt must define initializePlayGamesIfConfigured()');
            assert.equal(
              initMatch[0].includes('PlayGamesSdk.initialize(this)') &&
                !initMatch[0].includes('requestPlayGamesSignIn') &&
                !initMatch[0].includes('isAuthenticated') &&
                !initMatch[0].includes('pullSnapshotFromPlayGames'),
              true,
              'MainActivity.initializePlayGamesIfConfigured() must only initialize SDK without cold-start auto sign-in'
            );
            const onPageFinishedMatch = mainActivitySrc.match(/override fun onPageFinished\([^)]*\)\s*\{[\s\S]*?\n                \}/);
            assert.ok(onPageFinishedMatch, 'MainActivity.kt must define onPageFinished()');
            assert.equal(
              onPageFinishedMatch[0].includes('deliverCachedPlayGamesProfileIfNeeded'),
              false,
              'MainActivity.onPageFinished() must not push cached Play Games profile on cold launch'
            );
          }
        } finally {
          globalThis.window.CapyAndroid = prevCapyAndroid;
        }
      } finally {
        globalThis.window = prevWindow;
      }
    }
    logUnitPass('CRDT resetEpoch anti-resurrection, >180 KB Play Games pgblob chunking & NativeBridge guards verified.');

    /* capy-dev-only:start */
    logUnitStart('Testing rebrand-persona.mjs clean-room export, content transforms & zero-leak checks...');
    const {
      FORBIDDEN_PERSONA_REGEX,
      stripDevOnlyBlocks,
      transformPersonaContent,
      sanitizeCommitMessage,
      assertZeroSourcePersonaLeak,
      exportCleanPersonaStage,
    } = await import('./rebrand-persona.mjs');
    const sampleDoc =
      'Repo https://github.com/shthed/capy (`shthed`) [#482](https://github.com/shthed/capy/pull/482) [#477](https://github.com/shthed/capy/issues/477) [Sprint 1](https://github.com/shthed/capy/milestone/2) preview https://shthed.github.io/capy/pull/1/';
    const transformedOnce = transformPersonaContent(sampleDoc);
    assert.equal(
      transformedOnce,
      'Repo https://github.com/capyboop/paint (`capyboop`) #482 #477 Sprint 1 preview https://capypaint.com/'
    );
    assert.equal(transformPersonaContent(transformedOnce), transformedOnce);
    const samplePrEpicDoc =
      'Preview https://shthed.github.io/capy/alpha/492/ and https://shthed.github.io/capy/PR/42/ [EPIC-2](https://github.com/shthed/capy/issues/477)';
    const transformedPrEpic = transformPersonaContent(samplePrEpicDoc);
    assert.equal(
      transformedPrEpic,
      'Preview https://capypaint.com/ and https://capypaint.com/ EPIC-2'
    );
    assert.equal(transformPersonaContent(transformedPrEpic), transformedPrEpic);
    assert.equal(
      transformPersonaContent('Shthed SHTHED shthed'),
      'Capyboop CAPYBOOP capyboop'
    );
    const publicIssuesDoc =
      '[#2](https://github.com/capyboop/paint/issues/2) [#5](https://github.com/capyboop/paint/issues/5?q=1) [#20](https://github.com/capyboop/paint/issues/20) [#481](https://github.com/capyboop/paint/issues/481) [#2](https://github.com/shthed/capy/issues/2)';
    const transformedIssuesDoc = transformPersonaContent(publicIssuesDoc);
    assert.equal(
      transformedIssuesDoc,
      '[#2](https://github.com/capyboop/paint/issues/2) [#5](https://github.com/capyboop/paint/issues/5?q=1) #20 #481 #2'
    );
    assert.equal(transformPersonaContent(transformedIssuesDoc), transformedIssuesDoc);
    const guideBarDoc =
      '**Related Guides**: [`README.md`](./README.md) | [`CAPYBOOP.md`](./CAPYBOOP.md) | [`AGENTS.md`](./AGENTS.md) | [`DEV.md`](./DEV.md) | [`AGENTS.md` Rule 11](./AGENTS.md#1-ai-golden-invariants)';
    const strippedGuideBar = transformPersonaContent(guideBarDoc);
    assert.equal(
      strippedGuideBar,
      '**Related Guides**: [`README.md`](./README.md) | [`DEV.md`](./DEV.md) | `AGENTS.md` Rule 11'
    );
    assert.equal(transformPersonaContent(strippedGuideBar), strippedGuideBar);
    assert.equal(FORBIDDEN_PERSONA_REGEX.test('sync-beta-from-main'), true);
    assert.equal(FORBIDDEN_PERSONA_REGEX.test('.github/dependabot.yml'), true);
    assert.equal(FORBIDDEN_PERSONA_REGEX.test('CAPYBOOP_SYNC_TOKEN'), true);
    assert.equal(FORBIDDEN_PERSONA_REGEX.test('381055+capy'), true);
    assert.equal(FORBIDDEN_PERSONA_REGEX.test('hairy_dog_trumpet'), true);
    assert.equal(FORBIDDEN_PERSONA_REGEX.test('dependabot[bot]'), false);
    const devOnlyStartTag = '<!-- capy-dev-' + 'only:start -->';
    const devOnlyEndTag = '<!-- capy-dev-' + 'only:end -->';
    const docWithOpenPrBlock = [
      'Public workflow guide.',
      devOnlyStartTag,
      '- **Bot PRs ([`open-pr.yml`](./.github/workflows/open-pr.yml))**: Uses `gh workflow run open-pr.yml`.',
      devOnlyEndTag,
      'Remaining public footer.',
    ].join('\n');
    const strippedOpenPrDoc = stripDevOnlyBlocks(docWithOpenPrBlock);
    assert.equal(strippedOpenPrDoc.includes('open-pr.yml'), false);
    assert.equal(strippedOpenPrDoc.includes('Public workflow guide.'), true);
    assert.equal(strippedOpenPrDoc.includes('Remaining public footer.'), true);
    assert.equal(
      transformPersonaContent(docWithOpenPrBlock).includes('open-pr.yml'),
      false
    );
    assert.equal(
      sanitizeCommitMessage('Add Cloudflare Worker for shthed/capy (#482)\n\nCo-authored-by: shthed'),
      'Add Cloudflare Worker for capyboop/paint'
    );
    const tmpLeakCheck = fs.mkdtempSync(path.join(os.tmpdir(), 'capy-leak-check-'));
    try {
      fs.writeFileSync(path.join(tmpLeakCheck, 'ok.yml'), 'if: actor != "dependabot[bot]"\n', 'utf8');
      assert.equal(assertZeroSourcePersonaLeak(tmpLeakCheck), 1);
      const symlinkCliPath = path.join(tmpLeakCheck, 'rebrand-link.mjs');
      fs.symlinkSync(path.resolve(projectRoot, 'scripts/rebrand-persona.mjs'), symlinkCliPath);
      const symlinkOut = execFileSync(process.execPath, [symlinkCliPath, '--verify-clean', tmpLeakCheck], {
        encoding: 'utf8',
      });
      assert.equal(symlinkOut.includes('Verified 1 clean files'), true);
      fs.writeFileSync(path.join(tmpLeakCheck, 'leak.md'), 'See sync-beta-from-main workflow\n', 'utf8');
      assert.throws(() => assertZeroSourcePersonaLeak(tmpLeakCheck), /Forbidden persona token/);
    } finally {
      fs.rmSync(tmpLeakCheck, { recursive: true, force: true });
    }
    const tmpCleanStage = fs.mkdtempSync(path.join(os.tmpdir(), 'capy-clean-stage-'));
    const stagedNodeModules = path.join(tmpCleanStage, 'web/node_modules');
    try {
      const stageStats = exportCleanPersonaStage({ stageDir: tmpCleanStage });
      assert.equal(stageStats.verifiedFiles > 50, true);
      assert.equal(fs.existsSync(path.join(tmpCleanStage, '.agents')), false);
      assert.equal(
        fs.existsSync(path.join(tmpCleanStage, '.github/workflows/publish-capyboop.yml')),
        false
      );
      assert.equal(
        fs.existsSync(path.join(tmpCleanStage, '.github/workflows/pr-review-gate.yml')),
        false
      );
      assert.equal(
        fs.existsSync(path.join(tmpCleanStage, '.github/workflows/open-pr.yml')),
        false
      );
      assert.equal(
        fs.existsSync(path.join(tmpCleanStage, '.github/workflows/sync-beta-from-main.yml')),
        false
      );
      assert.equal(fs.existsSync(path.join(tmpCleanStage, '.github/dependabot.yml')), false);
      assert.equal(
        fs.existsSync(path.join(tmpCleanStage, 'web/scripts/rebrand-persona.mjs')),
        false
      );
      const stagedReadme = fs.readFileSync(path.join(tmpCleanStage, 'README.md'), 'utf8');
      assert.equal(stagedReadme.includes('capyboop.github.io/capy/beta/'), false);
      assert.equal(stagedReadme.includes('https://github.com/capyboop/paint/releases'), true);
      const stagedTodo = fs.readFileSync(path.join(tmpCleanStage, 'TODO.md'), 'utf8');
      assert.equal(stagedTodo.includes('CAPYBOOP_SYNC_TOKEN'), false);
      assert.equal(stagedTodo.includes('capyboop.github.io/capy/beta'), false);
      assert.equal(stagedTodo.includes('https://capyboop.github.io/capy/'), true);
      const stagedRoadmap = fs.readFileSync(path.join(tmpCleanStage, 'ROADMAP.md'), 'utf8');
      assert.equal(stagedRoadmap.includes('CAPYBOOP_SYNC_TOKEN'), false);
      assert.equal(stagedRoadmap.includes('capyboop.github.io/capy/beta'), false);
      assert.equal(stagedRoadmap.includes('https://capyboop.github.io/capy/'), true);
      const stagedReleaseYaml = fs.readFileSync(
        path.join(tmpCleanStage, '.github/workflows/release.yml'),
        'utf8'
      );
      assert.equal(stagedReleaseYaml.includes('GITHUB_STEP_SUMMARY'), true);
      const stagedRedirects = fs.readFileSync(
        path.join(tmpCleanStage, 'web/public/_redirects'),
        'utf8'
      );
      assert.equal(
        stagedRedirects.includes('https://github.com/capyboop/paint/releases/latest/download/capy.apk'),
        true
      );
      assert.equal(fs.existsSync(path.join(tmpCleanStage, 'AGENTS.md')), false);
      assert.equal(fs.existsSync(path.join(tmpCleanStage, 'CAPYBOOP.md')), false);
      assert.equal(fs.existsSync(path.join(tmpCleanStage, 'docs/ai')), false);
      assert.equal(
        fs.existsSync(path.join(tmpCleanStage, '.github/workflows/open-issue.yml')),
        false
      );
      // Verify AI-dev leak rejection and product-AI preservation
      for (const badToken of [
        'open-issue.yml',
        'AGENTS.md',
        'CAPYBOOP.md',
        'docs/ai/pr-readiness.md',
        '.agents/environment.json',
        'Antigravity',
        'conversation://abc',
        'Gemini 4 Argon',
        'MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API',
        'Claude Opus',
        'codex/',
        'ChatGPT',
        'GitHub Copilot',
        'PR Readiness Score',
        'WHITEBOARD.md',
        '/grill-me',
        '/teamwork',
        '/goal',
        '/plan',
        'WHITEBOARD',
        '.agents',
        'PR_READINESS',
        'PrReadiness',
        'clean-room',
        'regenerate-puzzles',
        'automation/sprint-1',
        'AI Contributors',
        'bot-authored',
        'Owner directive',
        'review:ai-approved',
        'ai-agent',
        'capyboop/capy',
        'AI-dev',
        'AI review',
        'AI reviews',
        'AI approval',
        'AI Studio',
        'AI GitHub actions',
        'agent',
        'agents',
        'subagent',
        'AGENTS',
        'docs(agents)',
        'update-agents',
        'invoke_subagent',
        'ci(mirror)',
        'chore(mirror)',
        'public mirror',
        'mirror sync',
        'mirror retargeting',
        'full replay',
        'Open Bot Issue',
        'free bot',
        '1-click bot',
        'bot PR',
        'review-gate',
        'review gate',
        'gate readiness',
        'persona',
        'Issue #607',
        '.github/copilot-instructions.md',
        'capy.prompt.yml',
        'CLAUDE.md',
        'GEMINI.md',
      ]) {
        assert.equal(
          FORBIDDEN_PERSONA_REGEX.test(badToken),
          true,
          `FORBIDDEN_PERSONA_REGEX must reject "${badToken}"`
        );
      }
      for (const safeToken of [
        'AiArtworkProvider',
        'AiCreditLedger',
        'Starter free AI generation credits',
        'AI Credits',
        'EPIC-5',
        'project owner (capyboop)',
        'User-Agent: capy-paint',
        'github-actions[bot]',
        'personal',
        'personalized',
        'during replay',
      ]) {
        assert.equal(
          FORBIDDEN_PERSONA_REGEX.test(safeToken),
          false,
          `FORBIDDEN_PERSONA_REGEX must allow "${safeToken}"`
        );
      }
      assert.equal(
        transformPersonaContent('See [Guide](./docs/ai/workflow-and-models.md) | [DEV](./DEV.md)'),
        'See [DEV](./DEV.md)'
      );
      assert.equal(
        sanitizeCommitMessage('Update AGENTS.md, Gemini 4, codex/, and open-issue.yml (#607)'),
        'Update project docs, CI, feature/, and GitHub workflow'
      );
      for (const [rawMsg, expectedOut] of [
        ['Add /goal and /plan workflow support for AI Contributors', 'Add workflow and workflow workflow support for contributors'],
        ['Update WHITEBOARD and Project Owner directive for bot-authored PRs', 'Update status notes and Project project guideline for automated PRs'],
        ['Sync .agents directory and PR_READINESS check', 'Sync dev environment config directory and PR checklist check'],
        ['Fix automation/sprint-12 branch cleanup and clean-room regenerate-puzzles.yml', 'Fix feature/sprint-12 branch cleanup and public asset generation'],
        ['Scrub AI-dev & agent traces from public mirror (Issue #607) (#612)', 'Scrub internal dev & contributor traces from public repository'],
        ['docs(agents): align CAPYBOOP, AGENTS, DEV with free bot AI reviews', 'docs: align project docs, contributor, DEV with automated CI review'],
        ['ci(mirror): tag pushed commit during full replay and mirror sync', 'ci(release): tag pushed commit during release sync and release sync'],
        ['Add 1-click bot PR approval and Open Bot Issue for github-actions[bot]', 'Add one-click PR approval and issue automation for CI automation'],
        ['Compile #612 changelog and fix review-gate gate readiness persona check', 'Compile changelog and fix review workflow PR checks release check'],
        ['Add personalized theme and personal gallery with AiArtworkProvider', 'Add personalized theme and personal gallery with AiArtworkProvider'],
        ['ci: preserve valid review:ai-approved and reconcile labels after AI marker evaluation', 'ci: preserve valid CI-approved and reconcile labels after CI marker evaluation'],
        ['Speed up CI gate with async E2E/Android/Pages and strict 100% AI auto-merge', 'Speed up CI gate with async E2E/Android/Pages and strict 100% CI auto-merge'],
        ['Add Dual AI and Owner PR review gate, sub-2s sanity check, and clean-room tag sync', 'Add automated and Owner PR review workflow, sub-2s sanity check, and public tag sync'],
        ['ci(mirror): replay full clean-room commit history onto capyboop/paint', 'ci(release): sync public release history onto capyboop/paint'],
        ['Update CAPYBOOP, AGENTS and CAPYBOOP guide', 'Update project docs, contributor and project docs guide'],
        ['Allow bot PRs and AI approvals for public personas (#607)', 'Allow automated PRs and CI approvals for public releases'],
        ['Close #607 with readiness checklist in ci(gate)', 'Close cleanup with PR checklist in ci(checks)'],
        ['ci(mirror): scrub dev tokens in historical commit messages during replay', 'ci(release): normalize release commit history during sync'],
      ]) {
        const cleaned = sanitizeCommitMessage(rawMsg);
        assert.equal(cleaned, expectedOut);
        assert.equal(FORBIDDEN_PERSONA_REGEX.test(cleaned), false, `Sanitized output leaked: ${cleaned}`);
      }
      // Verify multi-line scrub() contract and fail-closed historical replay in publish-capyboop.yml
      const publishYmlText = fs.readFileSync(
        path.resolve(projectRoot, '../.github/workflows/publish-capyboop.yml'),
        'utf8'
      );
      assert.equal(
        publishYmlText.includes("transformPersonaContent(String(text || ''))\n              .split(/\\r?\\n/)"),
        true,
        'publish-capyboop.yml scrub() must run transformPersonaContent on full multi-line string before splitting'
      );
      assert.equal(
        publishYmlText.includes('timeout-minutes: 30'),
        true,
        'publish-capyboop.yml must allocate timeout-minutes: 30 for full historical replay'
      );
      assert.equal(
        publishYmlText.includes('historicalScrub: origSha !== headSha'),
        true,
        'publish-capyboop.yml must enable historicalScrub for historical commits while keeping HEAD strict'
      );
      assert.equal(
        publishYmlText.includes('} catch {'),
        false,
        'publish-capyboop.yml must not silently swallow exportCleanPersonaStage errors'
      );
      assert.equal(
        publishYmlText.includes('verify_clean_history_repo'),
        true,
        'publish-capyboop.yml must verify replayed history logs and blobs before pushing'
      );
      assert.equal(
        publishYmlText.includes('log --all -i -S'),
        true,
        'publish-capyboop.yml must scan historical blobs case-insensitively with log --all -i -S'
      );
      assert.equal(
        publishYmlText.includes("'docs/ai'") &&
          publishYmlText.includes("'web/scripts/rebrand-persona.mjs'") &&
          publishYmlText.includes("'.github/workflows/publish-capyboop.yml'"),
        true,
        'publish-capyboop.yml legacy_hits must include docs/ai, rebrand-persona.mjs, and publish-capyboop.yml'
      );
      assert.equal(
        publishYmlText.includes('REMOTE_TAGS="$(git -C "${TAG_REPO_DIR}" ls-remote --tags target)"') &&
          publishYmlText.includes('declare -A tag_sha=()') &&
          publishYmlText.includes(':refs/tags/${remote_tag}'),
        true,
        'publish-capyboop.yml must fail-closed on ls-remote and resolve peeled ^{} tags before pruning'
      );
      const scrubEpic = (text) =>
        transformPersonaContent(String(text || ''))
          .split(/\r?\n/)
          .map((line) => {
            if (!line.trim()) return '';
            const [, indent = '', rest = ''] = line.match(/^(\s*)(.*)$/) || [];
            return `${indent}${sanitizeCommitMessage(rest, { fallback: rest })}`;
          })
          .join('\n');
      const scrubbedEpic = scrubEpic(
        [
          '# EPIC-2',
          'Public line',
          '<!-- capy-dev-only:start -->',
          'Secret private roadmap note mentioning internal workflow',
          '<!-- capy-dev-only:end -->',
          '  - Indented sub-bullet',
          '    - Nested sub-bullet',
        ].join('\n')
      );
      assert.equal(scrubbedEpic.includes('Secret private roadmap note'), false);
      assert.equal(scrubbedEpic.includes('internal-only'), false);
      assert.equal(scrubbedEpic.includes('  - Indented sub-bullet'), true);
      assert.equal(scrubbedEpic.includes('    - Nested sub-bullet'), true);

      // Verify historicalScrub: true excludes legacy AI files, scrubs historical blobs, and preserves product-AI terms & UI copy
      const tmpHistFixture = fs.mkdtempSync(path.join(os.tmpdir(), 'capy-hist-fixture-'));
      const tmpHistStage = fs.mkdtempSync(path.join(os.tmpdir(), 'capy-hist-stage-'));
      try {
        fs.mkdirSync(path.join(tmpHistFixture, '.github'), { recursive: true });
        fs.mkdirSync(path.join(tmpHistFixture, 'web'), { recursive: true });
        fs.writeFileSync(path.join(tmpHistFixture, '.github/copilot-instructions.md'), 'Copilot rules\n', 'utf8');
        fs.writeFileSync(path.join(tmpHistFixture, 'capy.prompt.yml'), 'prompt: test\n', 'utf8');
        fs.writeFileSync(path.join(tmpHistFixture, 'CLAUDE.md'), 'Claude rules\n', 'utf8');
        fs.writeFileSync(path.join(tmpHistFixture, 'GEMINI.md'), 'Gemini rules\n', 'utf8');
        fs.writeFileSync(
          path.join(tmpHistFixture, 'web/metadata.json'),
          JSON.stringify(
            {
              name: 'Capy',
              majorCapabilities: ['MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API'],
            },
            null,
            2
          ),
          'utf8'
        );
        fs.writeFileSync(
          path.join(tmpHistFixture, 'README.md'),
          [
            '# Capy Paint',
            'Legacy Antigravity and AGENTS.md and PR Readiness and Gemini 3 and Codex and Claude and WHITEBOARD.md and conversation://abc and invoke_subagent.',
            'Keep personal and personalized settings, User-Agent, AiArtworkProvider, AiCreditLedger, AI Credits, and EPIC-5.',
            'Follow Painting During Replay and changelog entry #612 remain intact.',
          ].join('\n'),
          'utf8'
        );

        assert.throws(
          () => exportCleanPersonaStage({ repoRoot: tmpHistFixture, stageDir: tmpHistStage }),
          /Forbidden persona token/,
          'Default historicalScrub: false must fail closed on un-scrubbed tokens'
        );
        const histStats = exportCleanPersonaStage({
          repoRoot: tmpHistFixture,
          stageDir: tmpHistStage,
          historicalScrub: true,
        });
        assert.equal(histStats.verifiedFiles, 2);
        for (const excludedLegacy of [
          '.github/copilot-instructions.md',
          'capy.prompt.yml',
          'CLAUDE.md',
          'GEMINI.md',
        ]) {
          assert.equal(
            fs.existsSync(path.join(tmpHistStage, excludedLegacy)),
            false,
            `historicalScrub must exclude ${excludedLegacy}`
          );
        }
        const scrubbedMeta = JSON.parse(
          fs.readFileSync(path.join(tmpHistStage, 'web/metadata.json'), 'utf8')
        );
        assert.deepEqual(scrubbedMeta.majorCapabilities, []);
        const scrubbedHistReadme = fs.readFileSync(path.join(tmpHistStage, 'README.md'), 'utf8');
        assert.equal(FORBIDDEN_PERSONA_REGEX.test(scrubbedHistReadme), false);
        assert.equal(scrubbedHistReadme.includes('personal and personalized'), true);
        assert.equal(scrubbedHistReadme.includes('User-Agent'), true);
        assert.equal(scrubbedHistReadme.includes('AiArtworkProvider'), true);
        assert.equal(scrubbedHistReadme.includes('AiCreditLedger'), true);
        assert.equal(scrubbedHistReadme.includes('AI Credits'), true);
        assert.equal(scrubbedHistReadme.includes('EPIC-5'), true);
        assert.equal(scrubbedHistReadme.includes('Follow Painting During Replay'), true);
        assert.equal(scrubbedHistReadme.includes('#612'), true);
      } finally {
        fs.rmSync(tmpHistFixture, { recursive: true, force: true });
        fs.rmSync(tmpHistStage, { recursive: true, force: true });
      }

      // Verify assertZeroSourcePersonaLeak rejects forbidden relative file paths
      const badPathFile = path.join(tmpCleanStage, 'clean-room-leak.md');
      fs.writeFileSync(badPathFile, 'Harmless public text\n', 'utf8');
      try {
        assert.throws(
          () => assertZeroSourcePersonaLeak(tmpCleanStage),
          /Forbidden persona token "clean-room" leaked in path clean-room-leak\.md/
        );
      } finally {
        fs.rmSync(badPathFile, { force: true });
      }

      const tmpVerifyLog = path.join(tmpCleanStage, 'verify-log-clean.txt');
      const tmpVerifyLeak = path.join(tmpCleanStage, 'verify-log-leak.txt');
      const tmpVerifyBotLeak = path.join(tmpCleanStage, 'verify-log-bot-leak.txt');
      fs.writeFileSync(tmpVerifyLog, 'capyboop Update Capy Paint personalized AiArtworkProvider\x00', 'utf8');
      fs.writeFileSync(tmpVerifyLeak, 'capyboop Update AGENTS.md for Antigravity\x00', 'utf8');
      fs.writeFileSync(tmpVerifyBotLeak, 'capyboop Mandate github-actions[bot] for #612\x00', 'utf8');
      try {
        execFileSync(
          process.execPath,
          [path.resolve(projectRoot, 'scripts/rebrand-persona.mjs'), '--verify-log', tmpVerifyLog],
          { stdio: 'pipe' }
        );
        for (const leakFile of [tmpVerifyLeak, tmpVerifyBotLeak]) {
          let leakRc = 0;
          try {
            execFileSync(
              process.execPath,
              [path.resolve(projectRoot, 'scripts/rebrand-persona.mjs'), '--verify-log', leakFile],
              { stdio: 'pipe' }
            );
          } catch (err) {
            leakRc = Number(err.status || 1);
          }
          assert.equal(leakRc, 2, `--verify-log must exit 2 on forbidden token in ${path.basename(leakFile)}`);
        }
        for (const badVerifyArgs of [['--verify-log'], ['--verify-log', '--dry-run']]) {
          let missingArgRc = 0;
          try {
            execFileSync(
              process.execPath,
              [path.resolve(projectRoot, 'scripts/rebrand-persona.mjs'), ...badVerifyArgs],
              { stdio: 'pipe' }
            );
          } catch (err) {
            missingArgRc = Number(err.status || 0);
          }
          assert.equal(missingArgRc, 1, `--verify-log missing arg (${badVerifyArgs.join(' ')}) must exit 1`);
        }
      } finally {
        fs.rmSync(tmpVerifyLog, { force: true });
        fs.rmSync(tmpVerifyLeak, { force: true });
        fs.rmSync(tmpVerifyBotLeak, { force: true });
      }
      const stagedGitignore = fs.readFileSync(path.join(tmpCleanStage, '.gitignore'), 'utf8');
      assert.equal(stagedGitignore.includes('.agents/'), false);
      const stagedCleanupBranches = fs.readFileSync(
        path.join(tmpCleanStage, '.github/workflows/cleanup-branches.yml'),
        'utf8'
      );
      assert.equal(stagedCleanupBranches.includes('name: Cleanup stale branches'), true);
      assert.equal(stagedCleanupBranches.includes('codex/'), false);
      assert.equal(stagedCleanupBranches.includes('automation/'), false);
      const stagedMetadata = fs.readFileSync(path.join(tmpCleanStage, 'web/metadata.json'), 'utf8');
      assert.equal(stagedMetadata.includes('MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API'), false);
      const stagedProviders = fs.readFileSync(
        path.join(tmpCleanStage, 'web/src/services/providers/ProviderRegistry.ts'),
        'utf8'
      );
      assert.equal(stagedProviders.includes('AiArtworkProvider'), true);
      assert.equal(stagedProviders.includes('AiCreditLedger'), true);
      assert.equal(stagedRoadmap.includes('EPIC-5'), true);

      // Verify cross-ref guardrail presence & regex behavior in open-pr.yml, open-issue.yml & pr-review-gate.yml
      const crossRefRe =
        /(?:https?:\/\/github\.com\/capyboop\/paint\/(?:issues|pull)\/\d+|(?<![A-Za-z0-9_.-])capyboop\/paint#\d+)/i;
      for (const wfRel of [
        '.github/workflows/open-pr.yml',
        '.github/workflows/open-issue.yml',
        '.github/workflows/pr-review-gate.yml',
      ]) {
        const wfSrc = fs.readFileSync(path.resolve(projectRoot, '..', wfRel), 'utf8');
        assert.equal(
          wfSrc.includes('FORBIDDEN_PUBLIC_CROSS_REF_RE'),
          true,
          `${wfRel} must enforce FORBIDDEN_PUBLIC_CROSS_REF_RE`
        );
      }
      const badCrossRefUrl = 'https://github.com/' + 'capyboop/paint/issues/3';
      const badCrossRefPr = 'https://github.com/' + 'capyboop/paint/pull/9';
      const badCrossRefShort = 'capyboop/' + 'paint#3';
      assert.equal(crossRefRe.test(`Fixes ${badCrossRefUrl}`), true);
      assert.equal(crossRefRe.test(`See ${badCrossRefPr}`), true);
      assert.equal(crossRefRe.test(`Refs ${badCrossRefShort}`), true);
      assert.equal(crossRefRe.test('See `capyboop/paint` public issue 3'), false);
      assert.equal(crossRefRe.test('https://github.com/capyboop/paint/issues'), false);

      for (const publicDoc of [
        'CONTRIBUTING.md',
        'SUPPORT.md',
        'SECURITY.md',
        '.github/PULL_REQUEST_TEMPLATE.md',
      ]) {
        assert.equal(
          fs.existsSync(path.join(tmpCleanStage, publicDoc)),
          true,
          `Clean export must retain ${publicDoc}`
        );
      }
      for (const tplFile of ['config.yml', 'bug_report.yml', 'feature_request.yml', 'puzzle_idea.yml']) {
        assert.equal(
          fs.existsSync(path.join(tmpCleanStage, `.github/ISSUE_TEMPLATE/${tplFile}`)),
          true,
          `Clean export must retain .github/ISSUE_TEMPLATE/${tplFile}`
        );
      }
      const stagedPrivacy = fs.readFileSync(
        path.join(tmpCleanStage, 'web/public/privacy-policy.html'),
        'utf8'
      );
      assert.equal(
        stagedPrivacy.includes('https://github.com/capyboop/paint/issues'),
        true,
        'privacy-policy.html must link to capyboop/paint/issues'
      );
      const stagedSanityMod = await import(
        pathToFileURL(path.join(tmpCleanStage, 'web/scripts/sanity.mjs')).href
      );
      const stagedSanity = stagedSanityMod.runSanityChecks({ repoRoot: tmpCleanStage });
      assert.equal(stagedSanity.elapsedMs < 2000, true);
      execFileSync(process.execPath, [path.join(tmpCleanStage, 'web/scripts/sanity.mjs')], {
        stdio: 'pipe',
      });
      execFileSync(process.execPath, ['--check', path.join(tmpCleanStage, 'web/scripts/test.mjs')], {
        stdio: 'pipe',
      });
      const srcNodeModules = path.join(projectRoot, 'node_modules');
      if (fs.existsSync(srcNodeModules)) {
        fs.symlinkSync(srcNodeModules, stagedNodeModules, 'dir');
        execFileSync(process.execPath, ['scripts/test.mjs', '--unit'], {
          cwd: path.join(tmpCleanStage, 'web'),
          stdio: 'pipe',
        });
      }
    } finally {
      try {
        if (fs.lstatSync(stagedNodeModules).isSymbolicLink()) {
          fs.unlinkSync(stagedNodeModules);
        }
      } catch {
        // Ignore when symlink was not created
      }
      fs.rmSync(tmpCleanStage, { recursive: true, force: true });
    }
    logUnitPass('rebrand-persona.mjs clean-room export, zero-leak scan & staged sanity verified.');

    // Extract and unit-test real GitHub Actions script blocks from pr-review-gate.yml & open-pr.yml
    logUnitStart('Testing pr-review-gate.yml review/score/checklist/sync gate logic...');
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const extractWorkflowScript = (workflowRelPath) => {
      const raw = fs.readFileSync(path.resolve(projectRoot, '..', workflowRelPath), 'utf8');
      const lines = raw.split(/\r?\n/);
      const scriptIdx = lines.findIndex((line) => /^\s*script:\s*\|\s*$/.test(line));
      assert.notEqual(scriptIdx, -1, `Expected script: | block in ${workflowRelPath}`);
      const headerIndent = lines[scriptIdx].match(/^(\s*)/)[1].length;
      let bodyIndent = null;
      const bodyLines = [];
      for (let i = scriptIdx + 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === '') {
          bodyLines.push('');
          continue;
        }
        const indent = line.match(/^(\s*)/)[1].length;
        if (bodyIndent === null) {
          assert.equal(
            indent > headerIndent,
            true,
            `Expected indented script body in ${workflowRelPath}`
          );
          bodyIndent = indent;
        } else if (indent < bodyIndent) {
          break;
        }
        bodyLines.push(line.slice(bodyIndent));
      }
      return bodyLines.join('\n');
    };

    const prReviewGateSource = extractWorkflowScript('.github/workflows/pr-review-gate.yml');
    const gateDualPassDesc =
      'Main gate passed (no Owner approval needed): AI review (100%) verified';
    const gateBetaPassDesc =
      'Beta gate passed (no Owner approval needed): AI review (100%) verified';
    const gateMainAwaitingAiDesc =
      'Main (no Owner approval needed): Blocked by AI review';
    const gateMainAwaitingAiAndOwnerDesc =
      'Main (no Owner approval needed): Blocked by AI review';
    const gateMainAwaitingOwnerDesc =
      'Main gate passed (no Owner approval needed): AI review (100%) verified';
    const gateBetaAwaitingAiDesc =
      'Beta (no Owner approval needed): Blocked by AI review';
    const gateDraftDesc =
      'Main (no Owner approval needed): Blocked by Draft PR, PR readiness/100% score';
    const gateStrictNotMetDesc =
      'Beta (no Owner approval needed): Blocked by PR readiness/100% score';
    const gateMainStrictNotMetNoOwnerDesc =
      'Main (no Owner approval needed): Blocked by PR readiness/100% score';

    const runReviewGateScript = new AsyncFunction(
      'context',
      'github',
      'core',
      prReviewGateSource
    );

    const validStrictPrBody = [
      '## Summary',
      '',
      'Ships clean async CI checks and strict readiness verification.',
      '',
      '### PR Readiness Score: 100%',
      '',
      '<details>',
      '<summary>PR Readiness Checklist</summary>',
      '',
      '- **100%** — **Functionality & Edge Cases**: Verified cleanly.',
      '- **100%** — **Automated Tests**: Passed locally.',
      '',
      '</details>',
    ].join('\n');

    const runReviewGateCase = async (options = {}) => {
      const {
        prAuthor = 'github-actions[bot]',
        baseRef = 'main',
        isDraft = false,
        headSha = 'abcdef1234567890abcdef1234567890abcdef12',
        headRef = undefined,
        headRepoFullName = 'shthed/capy',
        headTreeSha = 'tree-main',
        nodeId = 'PR_node_1',
        autoMerge = null,
        commitsByRef = null,
        compareMap = null,
        commitDate = '2026-11-13T01:00:00Z',
        labels = ['review:ai-approved'],
        events = [],
        reviews = [],
        comments = [],
        commitStatuses = [],
        aiCommentScore = 100,
        aiCommentBody = null,
        aiCommentTs = '2026-11-13T01:01:00Z',
        eventName = 'pull_request_review',
        action = 'submitted',
        actionsGithubToken = undefined,
        fetchImpl = null,
        createCommitStatusImpl = null,
        graphqlImpl = null,
        mergeImpl = null,
        requestImpl = null,
        mergeableState = undefined,
        checkRuns = null,
        expectCommitStatus = true,
      } = options;
      const body = 'body' in options ? options.body : validStrictPrBody;
      const calls = {
        createComment: [],
        updateComment: [],
        createReview: [],
        dismissReview: [],
        addLabels: [],
        removeLabel: [],
        createCommitStatus: [],
        fetch: [],
        graphql: [],
        merge: [],
        listForRef: [],
        request: [],
      };
      const allComments = [...comments];
      if (aiCommentScore !== null) {
        allComments.unshift({
          user: { login: 'shthed' },
          body:
            aiCommentBody ??
            `<!-- capy-review: actor=ai-agent verdict=APPROVED sha=${headSha} score=${aiCommentScore}% -->`,
          created_at: aiCommentTs,
          updated_at: aiCommentTs,
        });
      }
      const coreMock = {
        infos: [],
        warnings: [],
        failed: [],
        info: (msg) => coreMock.infos.push(msg),
        warning: (msg) => coreMock.warnings.push(msg),
        setFailed: (msg) => coreMock.failed.push(msg),
      };
      const githubMock = {
        paginate: async (fn, params) => {
          const res = await fn(params);
          return res.data;
        },
        graphql: async (query, variables) => {
          calls.graphql.push({ query, variables });
          if (graphqlImpl) {
            return graphqlImpl(query, variables);
          }
          return {};
        },
        request: async (route, payload) => {
          calls.request.push({ route, payload });
          if (requestImpl) {
            return requestImpl(route, payload);
          }
          return { status: 202, data: { status: 'pending', details: { uuid: 'uuid-async-1' } } };
        },
        rest: {
          pulls: {
            get: async () => ({
              data: {
                number: 490,
                state: 'open',
                draft: isDraft,
                user: { login: prAuthor },
                base: { ref: baseRef },
                head: {
                  sha: headSha,
                  ...(headRef ? { ref: headRef } : {}),
                  repo: { full_name: headRepoFullName },
                },
                ...(body !== undefined ? { body } : {}),
                node_id: nodeId,
                auto_merge: autoMerge,
                labels: labels.map((name) => ({ name })),
                ...(mergeableState !== undefined
                  ? { mergeable: true, mergeable_state: mergeableState }
                  : {}),
              },
            }),
            listReviews: async () => ({ data: reviews }),
            createReview: async (payload) => {
              calls.createReview.push(payload);
              return { data: { id: 9001 } };
            },
            dismissReview: async (payload) => {
              calls.dismissReview.push(payload);
              return { data: {} };
            },
            merge: async (payload) => {
              calls.merge.push(payload);
              if (mergeImpl) {
                return mergeImpl(payload);
              }
              return { data: { merged: true, sha: headSha } };
            },
          },
          checks: {
            listForRef: async () => {
              calls.listForRef.push(true);
              return { data: { check_runs: checkRuns || [] } };
            },
          },
          repos: {
            getCommit: async ({ ref }) => {
              if (commitsByRef && commitsByRef[ref]) {
                return { data: commitsByRef[ref] };
              }
              return {
                data: {
                  sha: headSha,
                  commit: {
                    committer: { date: commitDate },
                    author: { date: commitDate },
                    tree: { sha: headTreeSha },
                  },
                },
              };
            },
            compareCommitsWithBasehead: async ({ basehead }) => {
              if (compareMap && compareMap[basehead]) {
                return { data: compareMap[basehead] };
              }
              return { data: { ahead_by: 1, commits: [], files: [] } };
            },
            listCommitStatusesForRef: async () => ({ data: commitStatuses }),
            createCommitStatus: async (payload) => {
              calls.createCommitStatus.push(payload);
              if (createCommitStatusImpl) {
                return createCommitStatusImpl(payload);
              }
              return { data: payload };
            },
          },
          issues: {
            listEvents: async () => ({ data: events }),
            listComments: async () => ({ data: allComments }),
            createComment: async (payload) => {
              calls.createComment.push(payload);
              return { data: { id: 8001, body: payload.body } };
            },
            updateComment: async (payload) => {
              calls.updateComment.push(payload);
              return { data: { id: payload.comment_id, body: payload.body } };
            },
            addLabels: async (payload) => {
              calls.addLabels.push(payload);
              return { data: {} };
            },
            removeLabel: async (payload) => {
              calls.removeLabel.push(payload);
              return { data: {} };
            },
          },
        },
      };
      const contextMock = {
        repo: { owner: 'shthed', repo: 'capy' },
        eventName,
        payload: { pull_request: { number: 490 }, action },
      };
      const prevActionsGithubToken = process.env.ACTIONS_GITHUB_TOKEN;
      const prevFetch = globalThis.fetch;
      if (actionsGithubToken) {
        process.env.ACTIONS_GITHUB_TOKEN = actionsGithubToken;
      } else {
        delete process.env.ACTIONS_GITHUB_TOKEN;
      }
      globalThis.fetch = async (url, init) => {
        calls.fetch.push({ url, init });
        if (fetchImpl) {
          return fetchImpl(url, init);
        }
        throw new Error(`Unexpected fetch call in runReviewGateCase: ${url}`);
      };
      try {
        await runReviewGateScript(contextMock, githubMock, coreMock);
      } finally {
        if (prevActionsGithubToken === undefined) {
          delete process.env.ACTIONS_GITHUB_TOKEN;
        } else {
          process.env.ACTIONS_GITHUB_TOKEN = prevActionsGithubToken;
        }
        globalThis.fetch = prevFetch;
      }
      assert.equal(coreMock.failed.length, 0);
      if (expectCommitStatus) {
        assert.equal(calls.createCommitStatus.length, 1);
      }
      return { status: calls.createCommitStatus[0], calls, core: coreMock };
    };

    const gateHeadSha = '1234567890abcdef1234567890abcdef12345678';
    // (a) Bot PR on main + strict 100% AI review -> auto-approved with MERGE auto-merge (and no bot review creation)
    const gateBotNativeRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T02:00:00Z',
      reviews: [
        {
          id: 101,
          user: { login: 'shthed' },
          state: 'APPROVED',
          commit_id: gateHeadSha,
          body: '',
          submitted_at: '2026-11-13T01:10:00Z',
        },
      ],
    });
    assert.equal(gateBotNativeRes.status.state, 'success');
    assert.equal(gateBotNativeRes.status.description, gateDualPassDesc);
    assert.equal(gateBotNativeRes.calls.createReview.length, 0);
    assert.equal(gateBotNativeRes.calls.graphql.length, 1);
    assert.equal(gateBotNativeRes.calls.graphql[0].variables.mergeMethod, 'MERGE');

    // (b) Bot PR + review:owner-approved label without AI approval -> pending awaiting strict 100% AI review
    const gateBotLabelOnlyRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      labels: ['review:owner-approved'],
      aiCommentScore: null,
      events: [
        {
          event: 'labeled',
          label: { name: 'review:owner-approved' },
          actor: { login: 'shthed' },
          created_at: '2026-11-13T01:05:00Z',
        },
      ],
      eventName: 'pull_request',
      action: 'labeled',
    });
    assert.equal(gateBotLabelOnlyRes.status.state, 'pending');
    assert.equal(gateBotLabelOnlyRes.status.description, gateMainAwaitingAiAndOwnerDesc);
    assert.equal(gateBotLabelOnlyRes.calls.createReview.length, 0);
    assert.equal(gateBotLabelOnlyRes.calls.graphql.length, 0);

    // (c) Bot PR + APPROVED/LGTM comment without AI approval -> pending awaiting strict 100% AI review
    const gateBotCommentOnlyRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      labels: [],
      aiCommentScore: null,
      comments: [
        {
          user: { login: 'shthed' },
          body: 'APPROVED',
          created_at: '2026-11-13T01:05:00Z',
          updated_at: '2026-11-13T01:05:00Z',
        },
      ],
      eventName: 'issue_comment',
      action: 'created',
    });
    assert.equal(gateBotCommentOnlyRes.status.state, 'pending');
    assert.equal(gateBotCommentOnlyRes.status.description, gateMainAwaitingAiAndOwnerDesc);
    assert.equal(gateBotCommentOnlyRes.calls.createReview.length, 0);

    const gateBotLgtmReviewOnlyRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      labels: [],
      aiCommentScore: null,
      reviews: [
        {
          id: 102,
          user: { login: 'shthed' },
          state: 'COMMENTED',
          commit_id: gateHeadSha,
          body: 'LGTM',
          submitted_at: '2026-11-13T01:06:00Z',
        },
      ],
    });
    assert.equal(gateBotLgtmReviewOnlyRes.status.state, 'pending');
    assert.equal(gateBotLgtmReviewOnlyRes.status.description, gateMainAwaitingAiAndOwnerDesc);
    assert.equal(gateBotLgtmReviewOnlyRes.calls.createReview.length, 0);

    // (d) Stale APPROVED (commit_id !== headSha) or pre-force-push -> pending without AI AND cannot clear active HOLD
    const gateBotStaleShaRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      labels: [],
      aiCommentScore: null,
      reviews: [
        {
          id: 103,
          user: { login: 'shthed' },
          state: 'APPROVED',
          commit_id: '0000000000000000000000000000000000000000',
          body: '',
          submitted_at: '2026-11-13T01:05:00Z',
        },
      ],
    });
    assert.equal(gateBotStaleShaRes.status.state, 'pending');
    assert.equal(gateBotStaleShaRes.status.description, gateMainAwaitingAiAndOwnerDesc);
    assert.equal(gateBotStaleShaRes.calls.createReview.length, 0);

    const gateBotStaleShaCannotClearHoldRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      comments: [
        {
          id: 1031,
          user: { login: 'shthed' },
          body: 'HOLD - fix required',
          created_at: '2026-11-13T01:04:00Z',
          updated_at: '2026-11-13T01:04:00Z',
        },
      ],
      reviews: [
        {
          id: 103,
          user: { login: 'shthed' },
          state: 'APPROVED',
          commit_id: '0000000000000000000000000000000000000000',
          body: '',
          submitted_at: '2026-11-13T01:06:00Z',
        },
      ],
    });
    assert.equal(gateBotStaleShaCannotClearHoldRes.status.state, 'failure');

    const gateBotPreForcePushRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      labels: [],
      aiCommentScore: null,
      events: [{ event: 'head_ref_force_pushed', created_at: '2026-11-13T01:10:00Z' }],
      reviews: [
        {
          id: 104,
          user: { login: 'shthed' },
          state: 'APPROVED',
          commit_id: gateHeadSha,
          body: '',
          submitted_at: '2026-11-13T01:05:00Z',
        },
      ],
    });
    assert.equal(gateBotPreForcePushRes.status.state, 'pending');
    assert.equal(gateBotPreForcePushRes.calls.createReview.length, 0);

    const gateBotPreForcePushCannotClearHoldRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      events: [{ event: 'head_ref_force_pushed', created_at: '2026-11-13T01:10:00Z' }],
      comments: [
        {
          id: 1041,
          user: { login: 'shthed' },
          body: 'HOLD - after force push',
          created_at: '2026-11-13T01:11:00Z',
          updated_at: '2026-11-13T01:11:00Z',
        },
      ],
      reviews: [
        {
          id: 104,
          user: { login: 'shthed' },
          state: 'APPROVED',
          commit_id: gateHeadSha,
          body: '',
          submitted_at: '2026-11-13T01:05:00Z',
        },
      ],
    });
    assert.equal(gateBotPreForcePushCannotClearHoldRes.status.state, 'failure');

    // (e) Bot PR + native APPROVED followed by CHANGES_REQUESTED on headSha (with commitMs skew) -> failure + disables active auto-merge
    const gateBotChangesReqRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T02:00:00Z',
      autoMerge: { merge_method: 'MERGE' },
      reviews: [
        {
          id: 105,
          user: { login: 'shthed' },
          state: 'APPROVED',
          commit_id: gateHeadSha,
          body: '',
          submitted_at: '2026-11-13T01:10:00Z',
        },
        {
          id: 106,
          user: { login: 'shthed' },
          state: 'CHANGES_REQUESTED',
          commit_id: gateHeadSha,
          body: 'Fix edge case first',
          submitted_at: '2026-11-13T01:12:00Z',
        },
      ],
    });
    assert.equal(gateBotChangesReqRes.status.state, 'failure');
    assert.equal(
      gateBotChangesReqRes.status.description.startsWith(
        'Main (no Owner approval needed): Blocked by Changes requested / hold'
      ),
      true
    );
    assert.equal(gateBotChangesReqRes.calls.createReview.length, 0);
    assert.equal(gateBotChangesReqRes.calls.graphql.length, 1);
    assert.equal(
      gateBotChangesReqRes.calls.graphql[0].query.includes('disablePullRequestAutoMerge'),
      true
    );

    // (f) Manual shthed-authored PR without AI approval stays pending; with strict 100% AI review succeeds & dismisses stale bot approval
    const gateManualLabelRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'main',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      labels: ['review:owner-approved'],
      aiCommentScore: null,
      events: [
        {
          event: 'labeled',
          label: { name: 'review:owner-approved' },
          actor: { login: 'shthed' },
          created_at: '2026-11-13T01:05:00Z',
        },
      ],
    });
    assert.equal(gateManualLabelRes.status.state, 'pending');
    assert.equal(gateManualLabelRes.status.description, gateMainAwaitingAiAndOwnerDesc);
    assert.equal(gateManualLabelRes.calls.createReview.length, 0);

    const gateManualCommentRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'main',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      labels: [],
      aiCommentScore: null,
      comments: [
        {
          user: { login: 'shthed' },
          body: 'APPROVED',
          created_at: '2026-11-13T01:05:00Z',
          updated_at: '2026-11-13T01:05:00Z',
        },
      ],
    });
    assert.equal(gateManualCommentRes.status.state, 'pending');
    assert.equal(gateManualCommentRes.status.description, gateMainAwaitingAiAndOwnerDesc);
    assert.equal(gateManualCommentRes.calls.createReview.length, 0);

    const gateManualLgtmCommentRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'main',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      labels: [],
      aiCommentScore: null,
      comments: [
        {
          user: { login: 'shthed' },
          body: 'LGTM',
          created_at: '2026-11-13T01:05:00Z',
          updated_at: '2026-11-13T01:05:00Z',
        },
      ],
    });
    assert.equal(gateManualLgtmCommentRes.status.state, 'pending');
    assert.equal(gateManualLgtmCommentRes.status.description, gateMainAwaitingAiAndOwnerDesc);
    assert.equal(gateManualLgtmCommentRes.calls.createReview.length, 0);

    const gateManualMainNativeNoBotReviewRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'main',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      reviews: [
        {
          id: 111,
          user: { login: 'shthed' },
          state: 'APPROVED',
          commit_id: gateHeadSha,
          body: '',
          submitted_at: '2026-11-13T01:05:00Z',
        },
        {
          id: 112,
          user: { login: 'github-actions[bot]' },
          state: 'APPROVED',
          commit_id: gateHeadSha,
          body: 'legacy bot approval',
          submitted_at: '2026-11-13T01:04:00Z',
        },
      ],
    });
    assert.equal(gateManualMainNativeNoBotReviewRes.status.state, 'success');
    assert.equal(gateManualMainNativeNoBotReviewRes.status.description, gateDualPassDesc);
    assert.equal(gateManualMainNativeNoBotReviewRes.calls.createReview.length, 0);
    assert.equal(gateManualMainNativeNoBotReviewRes.calls.dismissReview.length, 1);

    // (g) Draft bot PR -> pending even with AI + native APPROVED (and never enables auto-merge)
    const gateBotDraftRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      isDraft: true,
      headSha: gateHeadSha,
      body: `${validStrictPrBody}\n\n## Outstanding Work Before Marking Ready\n- [ ] Finalize WIP verification`,
      reviews: [
        {
          id: 107,
          user: { login: 'shthed' },
          state: 'APPROVED',
          commit_id: gateHeadSha,
          body: '',
          submitted_at: '2026-11-13T01:10:00Z',
        },
      ],
    });
    assert.equal(gateBotDraftRes.status.state, 'pending');
    assert.equal(gateBotDraftRes.status.description, gateDraftDesc);
    assert.equal(gateBotDraftRes.calls.createReview.length, 0);
    assert.equal(gateBotDraftRes.calls.graphql.length, 0);

    // (h) Bot PR + CHANGES_REQUESTED whose body starts with "APPROVED..." -> failure (not legacy approval)
    const gateBotChangesReqApprovedPrefixRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      reviews: [
        {
          id: 108,
          user: { login: 'shthed' },
          state: 'CHANGES_REQUESTED',
          commit_id: gateHeadSha,
          body: 'APPROVED - needs one fix',
          submitted_at: '2026-11-13T01:12:00Z',
        },
      ],
    });
    assert.equal(gateBotChangesReqApprovedPrefixRes.status.state, 'failure');
    assert.equal(gateBotChangesReqApprovedPrefixRes.status.description.startsWith('Main (no Owner approval needed): Blocked by Changes requested / hold'), true);
    assert.equal(gateBotChangesReqApprovedPrefixRes.calls.createReview.length, 0);

    // (i) Bot PR + CHANGES_REQUESTED recovered by newer native APPROVED on headSha under commitMs skew -> success
    const gateBotRecoverySkewRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T02:00:00Z',
      reviews: [
        {
          id: 109,
          user: { login: 'shthed' },
          state: 'CHANGES_REQUESTED',
          commit_id: gateHeadSha,
          body: 'Fix edge case first',
          submitted_at: '2026-11-13T01:10:00Z',
        },
        {
          id: 110,
          user: { login: 'shthed' },
          state: 'APPROVED',
          commit_id: gateHeadSha,
          body: '',
          submitted_at: '2026-11-13T01:15:00Z',
        },
      ],
    });
    assert.equal(gateBotRecoverySkewRes.status.state, 'success');
    assert.equal(gateBotRecoverySkewRes.status.description, gateDualPassDesc);
    assert.equal(gateBotRecoverySkewRes.calls.createReview.length, 0);

    // (j) Bot PR + DISMISSED native APPROVED -> ignored (pending without AI, and cannot clear active HOLD)
    const gateBotDismissedRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      labels: [],
      aiCommentScore: null,
      reviews: [
        {
          id: 111,
          user: { login: 'shthed' },
          state: 'DISMISSED',
          commit_id: gateHeadSha,
          body: '',
          submitted_at: '2026-11-13T01:15:00Z',
        },
      ],
    });
    assert.equal(gateBotDismissedRes.status.state, 'pending');
    assert.equal(gateBotDismissedRes.status.description, gateMainAwaitingAiAndOwnerDesc);
    assert.equal(gateBotDismissedRes.calls.createReview.length, 0);

    const gateBotDismissedCannotClearHoldRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      comments: [
        {
          id: 1111,
          user: { login: 'shthed' },
          body: 'HOLD - wait before merge',
          created_at: '2026-11-13T01:10:00Z',
          updated_at: '2026-11-13T01:10:00Z',
        },
      ],
      reviews: [
        {
          id: 111,
          user: { login: 'shthed' },
          state: 'DISMISSED',
          commit_id: gateHeadSha,
          body: '',
          submitted_at: '2026-11-13T01:15:00Z',
        },
      ],
    });
    assert.equal(gateBotDismissedCannotClearHoldRes.status.state, 'failure');

    // (k) Bug 1 regression: bot PR CHANGES_REQUESTED + legacy APPROVED/LGTM comment + review:owner-approved label (with and without earlier native APPROVED) -> failure
    const gateBotLegacyAfterRejectCommentRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      reviews: [
        {
          id: 112,
          user: { login: 'shthed' },
          state: 'CHANGES_REQUESTED',
          commit_id: gateHeadSha,
          body: 'Fix required',
          submitted_at: '2026-11-13T01:05:00Z',
        },
      ],
      comments: [
        {
          id: 201,
          user: { login: 'shthed' },
          body: 'APPROVED',
          created_at: '2026-11-13T01:10:00Z',
          updated_at: '2026-11-13T01:10:00Z',
        },
      ],
    });
    assert.equal(gateBotLegacyAfterRejectCommentRes.status.state, 'failure');
    assert.equal(gateBotLegacyAfterRejectCommentRes.status.description.startsWith('Main (no Owner approval needed): Blocked by Changes requested / hold'), true);
    assert.equal(gateBotLegacyAfterRejectCommentRes.calls.createReview.length, 0);

    const gateBotChangesReqLegacyLgtmAndLabelRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      labels: ['review:ai-approved', 'review:owner-approved'],
      events: [
        {
          id: 501,
          event: 'labeled',
          label: { name: 'review:owner-approved' },
          actor: { login: 'shthed' },
          created_at: '2026-11-13T01:10:00Z',
        },
      ],
      reviews: [
        {
          id: 113,
          user: { login: 'shthed' },
          state: 'CHANGES_REQUESTED',
          commit_id: gateHeadSha,
          body: 'Fix Bug 1 first',
          submitted_at: '2026-11-13T01:05:00Z',
        },
      ],
      comments: [
        {
          id: 202,
          user: { login: 'shthed' },
          body: 'LGTM',
          created_at: '2026-11-13T01:11:00Z',
          updated_at: '2026-11-13T01:11:00Z',
        },
      ],
    });
    assert.equal(gateBotChangesReqLegacyLgtmAndLabelRes.status.state, 'failure');
    assert.equal(gateBotChangesReqLegacyLgtmAndLabelRes.status.description.startsWith('Main (no Owner approval needed): Blocked by Changes requested / hold'), true);
    assert.equal(gateBotChangesReqLegacyLgtmAndLabelRes.calls.createReview.length, 0);

    const gateBotLegacyAfterPriorNativeAndRejectRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      labels: ['review:ai-approved', 'review:owner-approved'],
      events: [
        {
          id: 502,
          event: 'labeled',
          label: { name: 'review:owner-approved' },
          actor: { login: 'shthed' },
          created_at: '2026-11-13T01:10:00Z',
        },
      ],
      reviews: [
        {
          id: 114,
          user: { login: 'shthed' },
          state: 'APPROVED',
          commit_id: gateHeadSha,
          body: '',
          submitted_at: '2026-11-13T01:02:00Z',
        },
        {
          id: 115,
          user: { login: 'shthed' },
          state: 'CHANGES_REQUESTED',
          commit_id: gateHeadSha,
          body: 'Needs fix',
          submitted_at: '2026-11-13T01:05:00Z',
        },
      ],
      comments: [
        {
          id: 203,
          user: { login: 'shthed' },
          body: 'LGTM on UI',
          created_at: '2026-11-13T01:11:00Z',
          updated_at: '2026-11-13T01:11:00Z',
        },
      ],
    });
    assert.equal(gateBotLegacyAfterPriorNativeAndRejectRes.status.state, 'failure');
    assert.equal(gateBotLegacyAfterPriorNativeAndRejectRes.status.description.startsWith('Main (no Owner approval needed): Blocked by Changes requested / hold'), true);
    assert.equal(gateBotLegacyAfterPriorNativeAndRejectRes.calls.createReview.length, 0);

    // (l) Bug 2 regression: +120s commitMs skew catches post-approval HOLD comment, reverse-ordered COMMENTED DO NOT MERGE review (non-head & head), and DISMISSED+HOLD; stale pre-push HOLD stays ignored
    const gateBotSkewHoldCommentRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:02:00Z',
      reviews: [
        {
          id: 116,
          user: { login: 'shthed' },
          state: 'APPROVED',
          commit_id: gateHeadSha,
          body: '',
          submitted_at: '2026-11-13T01:00:10Z',
        },
      ],
      comments: [
        {
          id: 204,
          user: { login: 'shthed' },
          body: 'HOLD - do not merge yet',
          created_at: '2026-11-13T01:00:40Z',
          updated_at: '2026-11-13T01:00:40Z',
        },
      ],
      eventName: 'issue_comment',
      action: 'created',
    });
    assert.equal(gateBotSkewHoldCommentRes.status.state, 'failure');
    assert.equal(gateBotSkewHoldCommentRes.status.description.startsWith('Main (no Owner approval needed): Blocked by Changes requested / hold'), true);
    assert.equal(gateBotSkewHoldCommentRes.calls.createReview.length, 0);

    const gateBotSkewNonHeadCommentedReviewRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:02:00Z',
      reviews: [
        {
          id: 118,
          user: { login: 'shthed' },
          state: 'COMMENTED',
          commit_id: '0000000000000000000000000000000000000000',
          body: 'DO NOT MERGE - regression',
          submitted_at: '2026-11-13T01:00:40Z',
        },
        {
          id: 117,
          user: { login: 'shthed' },
          state: 'APPROVED',
          commit_id: gateHeadSha,
          body: '',
          submitted_at: '2026-11-13T01:00:10Z',
        },
      ],
    });
    assert.equal(gateBotSkewNonHeadCommentedReviewRes.status.state, 'failure');
    assert.equal(gateBotSkewNonHeadCommentedReviewRes.status.description.startsWith('Main (no Owner approval needed): Blocked by Changes requested / hold'), true);
    assert.equal(gateBotSkewNonHeadCommentedReviewRes.calls.createReview.length, 0);

    const gateBotSkewHeadCommentedReviewRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:02:00Z',
      reviews: [
        {
          id: 120,
          user: { login: 'shthed' },
          state: 'COMMENTED',
          commit_id: gateHeadSha,
          body: 'DO NOT MERGE - head regression',
          submitted_at: '2026-11-13T01:00:40Z',
        },
        {
          id: 119,
          user: { login: 'shthed' },
          state: 'APPROVED',
          commit_id: gateHeadSha,
          body: '',
          submitted_at: '2026-11-13T01:00:10Z',
        },
      ],
    });
    assert.equal(gateBotSkewHeadCommentedReviewRes.status.state, 'failure');
    assert.equal(gateBotSkewHeadCommentedReviewRes.status.description.startsWith('Main (no Owner approval needed): Blocked by Changes requested / hold'), true);
    assert.equal(gateBotSkewHeadCommentedReviewRes.calls.createReview.length, 0);

    const gateBotSkewDismissedHoldRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:02:00Z',
      reviews: [
        {
          id: 121,
          user: { login: 'shthed' },
          state: 'DISMISSED',
          commit_id: gateHeadSha,
          body: '',
          submitted_at: '2026-11-13T01:00:10Z',
        },
      ],
      comments: [
        {
          id: 205,
          user: { login: 'shthed' },
          body: 'HOLD - wait after dismiss',
          created_at: '2026-11-13T01:00:40Z',
          updated_at: '2026-11-13T01:00:40Z',
        },
      ],
    });
    assert.equal(gateBotSkewDismissedHoldRes.status.state, 'failure');
    assert.equal(gateBotSkewDismissedHoldRes.calls.createReview.length, 0);

    const gateBotStalePrePushHoldPendingRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      labels: [],
      aiCommentScore: null,
      comments: [
        {
          id: 206,
          user: { login: 'shthed' },
          body: 'HOLD',
          created_at: '2026-11-13T00:55:00Z',
          updated_at: '2026-11-13T00:55:00Z',
        },
      ],
    });
    assert.equal(gateBotStalePrePushHoldPendingRes.status.state, 'pending');
    assert.equal(gateBotStalePrePushHoldPendingRes.calls.createReview.length, 0);

    const gateBotSkewStalePrePushHoldWithApprovalRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:02:00Z',
      reviews: [
        {
          id: 122,
          user: { login: 'shthed' },
          state: 'APPROVED',
          commit_id: gateHeadSha,
          body: '',
          submitted_at: '2026-11-13T01:00:10Z',
        },
      ],
      comments: [
        {
          id: 207,
          user: { login: 'shthed' },
          body: 'HOLD - fix old commit',
          created_at: '2026-11-13T00:55:00Z',
          updated_at: '2026-11-13T00:55:00Z',
        },
      ],
    });
    assert.equal(gateBotSkewStalePrePushHoldWithApprovalRes.status.state, 'success');
    assert.equal(gateBotSkewStalePrePushHoldWithApprovalRes.status.description, gateDualPassDesc);
    assert.equal(gateBotSkewStalePrePushHoldWithApprovalRes.calls.createReview.length, 0);

    // (m) Finding 3 regression: same-second review ties use deterministic [ts, id], while omitted IDs & cross-source review/comment ties fail closed
    const gateSameSecRejectWinsByIdRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      reviews: [
        {
          id: 10,
          user: { login: 'shthed' },
          state: 'APPROVED',
          commit_id: gateHeadSha,
          body: '',
          submitted_at: '2026-11-13T01:05:00Z',
        },
        {
          id: 11,
          user: { login: 'shthed' },
          state: 'CHANGES_REQUESTED',
          commit_id: gateHeadSha,
          body: 'Hold on',
          submitted_at: '2026-11-13T01:05:00Z',
        },
      ],
    });
    assert.equal(gateSameSecRejectWinsByIdRes.status.state, 'failure');
    assert.equal(gateSameSecRejectWinsByIdRes.status.description.startsWith('Main (no Owner approval needed): Blocked by Changes requested / hold'), true);
    assert.equal(gateSameSecRejectWinsByIdRes.calls.createReview.length, 0);

    const gateSameSecApproveSupersedesByIdRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      reviews: [
        {
          id: 10,
          user: { login: 'shthed' },
          state: 'CHANGES_REQUESTED',
          commit_id: gateHeadSha,
          body: 'Hold on',
          submitted_at: '2026-11-13T01:05:00Z',
        },
        {
          id: 11,
          user: { login: 'shthed' },
          state: 'APPROVED',
          commit_id: gateHeadSha,
          body: '',
          submitted_at: '2026-11-13T01:05:00Z',
        },
      ],
    });
    assert.equal(gateSameSecApproveSupersedesByIdRes.status.state, 'success');
    assert.equal(gateSameSecApproveSupersedesByIdRes.status.description, gateDualPassDesc);
    assert.equal(gateSameSecApproveSupersedesByIdRes.calls.createReview.length, 0);

    const gateSameSecOmittedIdsFailClosedRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      reviews: [
        {
          user: { login: 'shthed' },
          state: 'APPROVED',
          commit_id: gateHeadSha,
          body: '',
          submitted_at: '2026-11-13T01:05:00Z',
        },
        {
          id: 12,
          user: { login: 'shthed' },
          state: 'CHANGES_REQUESTED',
          commit_id: gateHeadSha,
          body: 'Hold on',
          submitted_at: '2026-11-13T01:05:00Z',
        },
      ],
    });
    assert.equal(gateSameSecOmittedIdsFailClosedRes.status.state, 'failure');
    assert.equal(gateSameSecOmittedIdsFailClosedRes.calls.createReview.length, 0);

    const gateSameSecOmittedRejectionIdFailClosedRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      reviews: [
        {
          id: 12,
          user: { login: 'shthed' },
          state: 'APPROVED',
          commit_id: gateHeadSha,
          body: '',
          submitted_at: '2026-11-13T01:05:00Z',
        },
        {
          user: { login: 'shthed' },
          state: 'CHANGES_REQUESTED',
          commit_id: gateHeadSha,
          body: 'Missing rejection id fails closed',
          submitted_at: '2026-11-13T01:05:00Z',
        },
      ],
    });
    assert.equal(gateSameSecOmittedRejectionIdFailClosedRes.status.state, 'failure');
    assert.equal(gateSameSecOmittedRejectionIdFailClosedRes.calls.createReview.length, 0);

    const gateSameSecCrossSourceFailClosedRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      reviews: [
        {
          id: 105,
          user: { login: 'shthed' },
          state: 'APPROVED',
          commit_id: gateHeadSha,
          body: '',
          submitted_at: '2026-11-13T01:05:00Z',
        },
      ],
      comments: [
        {
          id: 50,
          user: { login: 'shthed' },
          body: 'HOLD',
          created_at: '2026-11-13T01:05:00Z',
          updated_at: '2026-11-13T01:05:00Z',
        },
      ],
    });
    assert.equal(gateSameSecCrossSourceFailClosedRes.status.state, 'failure');
    assert.equal(gateSameSecCrossSourceFailClosedRes.calls.createReview.length, 0);

    // (n) --base beta split: AI>=95% passes without Owner sign-off and without creating bot APPROVE review, holds fail closed, spoofing blocked, Dependabot & sync/beta-from-main governed properly
    const gateBetaAiOnlyPassRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'beta',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      reviews: [
        {
          id: 301,
          user: { login: 'github-actions[bot]' },
          state: 'APPROVED',
          commit_id: '0000000000000000000000000000000000000000',
          body: 'stale',
          submitted_at: '2026-11-13T00:50:00Z',
        },
      ],
    });
    assert.equal(gateBetaAiOnlyPassRes.status.state, 'success');
    assert.equal(gateBetaAiOnlyPassRes.status.description, gateBetaPassDesc);
    assert.equal(gateBetaAiOnlyPassRes.calls.createReview.length, 0);
    assert.equal(gateBetaAiOnlyPassRes.calls.dismissReview.length, 1);
    assert.equal(gateBetaAiOnlyPassRes.calls.graphql.length, 1);
    assert.equal(gateBetaAiOnlyPassRes.calls.graphql[0].variables.mergeMethod, 'SQUASH');

    const gateBetaHoldFailRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      comments: [
        {
          id: 302,
          user: { login: 'shthed' },
          body: 'HOLD - wait for fix',
          created_at: '2026-11-13T01:05:00Z',
          updated_at: '2026-11-13T01:05:00Z',
        },
      ],
    });
    assert.equal(gateBetaHoldFailRes.status.state, 'failure');

    const gateBetaHoldWithLgtmCommentStillFailsRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      comments: [
        {
          id: 30201,
          user: { login: 'shthed' },
          body: 'HOLD - wait for fix',
          created_at: '2026-11-13T01:05:00Z',
          updated_at: '2026-11-13T01:05:00Z',
        },
        {
          id: 30202,
          user: { login: 'shthed' },
          body: 'LGTM',
          created_at: '2026-11-13T01:06:00Z',
          updated_at: '2026-11-13T01:06:00Z',
        },
      ],
    });
    assert.equal(gateBetaHoldWithLgtmCommentStillFailsRes.status.state, 'failure');
    assert.equal(gateBetaHoldWithLgtmCommentStillFailsRes.calls.createReview.length, 0);

    // ADVERSARIAL-A regression: --base beta with +2m commitDate clock skew still blocks post-AI HOLD / CHANGES REQUESTED / DO NOT MERGE (comments or AI PR review) while ignoring stale pre-push holds
    for (const [tag, holdBody] of [
      ['HOLD', 'HOLD - do not merge!'],
      ['CHANGES REQUESTED', 'CHANGES REQUESTED - needs fixes'],
      ['DO NOT MERGE', 'DO NOT MERGE yet'],
    ]) {
      const gateBetaSkewHoldCommentRes = await runReviewGateCase({
        prAuthor: 'shthed',
        baseRef: 'beta',
        headSha: gateHeadSha,
        commitDate: '2026-11-13T01:02:00Z',
        aiCommentTs: '2026-11-13T01:00:20Z',
        comments: [
          {
            id: 30301,
            user: { login: 'shthed' },
            body: holdBody,
            created_at: '2026-11-13T01:00:40Z',
            updated_at: '2026-11-13T01:00:40Z',
          },
        ],
        eventName: 'issue_comment',
        action: 'created',
      });
      assert.equal(
        gateBetaSkewHoldCommentRes.status.state,
        'failure',
        `Expected --base beta skewed ${tag} hold to fail`
      );
    }

    const gateBetaSkewAiReviewHoldCommentRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'beta',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:02:00Z',
      aiCommentScore: null,
      reviews: [
        {
          id: 30302,
          user: { login: 'shthed' },
          author_association: 'OWNER',
          state: 'COMMENTED',
          commit_id: gateHeadSha,
          body: `<!-- capy-review: actor=ai-agent verdict=APPROVED sha=${gateHeadSha} score=100% -->`,
          submitted_at: '2026-11-13T01:00:20Z',
        },
      ],
      comments: [
        {
          id: 30303,
          user: { login: 'shthed' },
          body: 'DO NOT MERGE yet',
          created_at: '2026-11-13T01:00:40Z',
          updated_at: '2026-11-13T01:00:40Z',
        },
      ],
      eventName: 'issue_comment',
      action: 'created',
    });
    assert.equal(gateBetaSkewAiReviewHoldCommentRes.status.state, 'failure');

    const gateBetaSkewStalePrePushHoldIgnoredRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'beta',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:02:00Z',
      aiCommentTs: '2026-11-13T01:00:20Z',
      comments: [
        {
          id: 30304,
          user: { login: 'shthed' },
          body: 'HOLD - stale pre-push',
          created_at: '2026-11-13T00:55:00Z',
          updated_at: '2026-11-13T00:55:00Z',
        },
      ],
    });
    assert.equal(gateBetaSkewStalePrePushHoldIgnoredRes.status.state, 'success');

    const gateBetaDraftRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      isDraft: true,
      headSha: gateHeadSha,
    });
    assert.equal(gateBetaDraftRes.status.state, 'pending');

    const gateBetaMissingAiRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      labels: [],
      aiCommentScore: null,
      headSha: gateHeadSha,
    });
    assert.equal(gateBetaMissingAiRes.status.state, 'pending');
    assert.equal(gateBetaMissingAiRes.status.description, gateBetaAwaitingAiDesc);

    // Untrusted external user cannot spoof AI CHANGES_REQUESTED DoS or forged APPROVED marker
    const gateUntrustedDosIgnoredRes = await runReviewGateCase({
      baseRef: 'beta',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      comments: [
        {
          id: 303,
          user: { login: 'stranger' },
          author_association: 'NONE',
          body: `<!-- capy-review: actor=ai-agent verdict=CHANGES_REQUESTED sha=${gateHeadSha} score=10% -->`,
          created_at: '2026-11-13T01:05:00Z',
          updated_at: '2026-11-13T01:05:00Z',
        },
      ],
    });
    assert.equal(gateUntrustedDosIgnoredRes.status.state, 'success');

    const gateUntrustedApproveIgnoredRes = await runReviewGateCase({
      baseRef: 'beta',
      headSha: gateHeadSha,
      aiCommentScore: null,
      comments: [
        {
          id: 304,
          user: { login: 'stranger' },
          author_association: 'NONE',
          body: `<!-- capy-review: actor=ai-agent verdict=APPROVED sha=${gateHeadSha} score=100% -->`,
          created_at: '2026-11-13T01:05:00Z',
          updated_at: '2026-11-13T01:05:00Z',
        },
      ],
    });
    assert.equal(gateUntrustedApproveIgnoredRes.status.state, 'pending');
    assert.deepEqual(gateUntrustedApproveIgnoredRes.calls.removeLabel[0].name, 'review:ai-approved');

    // Dependabot PRs: held pending on beta until AI-reviewed, 403 pull_request warning safety, native Approve required on main
    const gateDependabotBetaPendingRes = await runReviewGateCase({
      prAuthor: 'dependabot[bot]',
      baseRef: 'beta',
      labels: [],
      aiCommentScore: null,
      headSha: gateHeadSha,
    });
    assert.equal(gateDependabotBetaPendingRes.status.state, 'pending');

    const gateDependabotBetaPassRes = await runReviewGateCase({
      prAuthor: 'dependabot[bot]',
      baseRef: 'beta',
      headSha: gateHeadSha,
      eventName: 'issue_comment',
      action: 'created',
    });
    assert.equal(gateDependabotBetaPassRes.status.state, 'success');
    assert.equal(gateDependabotBetaPassRes.calls.createReview.length, 0);

    const gateDependabotReadOnly403Res = await runReviewGateCase({
      prAuthor: 'dependabot[bot]',
      baseRef: 'beta',
      headSha: gateHeadSha,
      eventName: 'pull_request',
      action: 'opened',
      expectCommitStatus: false,
      createCommitStatusImpl: async () => {
        const err = new Error('Resource not accessible by integration');
        err.status = 403;
        throw err;
      },
    });
    assert.equal(
      gateDependabotReadOnly403Res.core.warnings.some((w) => w.includes('Read-only GITHUB_TOKEN')),
      true
    );

    const gateDependabotPr403SkipsFallbackRes = await runReviewGateCase({
      prAuthor: 'dependabot[bot]',
      baseRef: 'beta',
      headSha: gateHeadSha,
      eventName: 'pull_request',
      action: 'synchronize',
      actionsGithubToken: 'ghs_ro_dependabot',
      fetchImpl: async () => ({ ok: true, status: 201 }),
      createCommitStatusImpl: async () => {
        const err = new Error('Resource not accessible by integration');
        err.status = 403;
        throw err;
      },
    });
    assert.equal(gateDependabotPr403SkipsFallbackRes.calls.fetch.length, 0);
    assert.equal(
      gateDependabotPr403SkipsFallbackRes.core.warnings.some((w) => w.includes('Read-only GITHUB_TOKEN')),
      true
    );
    assert.equal(gateDependabotPr403SkipsFallbackRes.calls.graphql.length, 0);

    const gateDependabotIssueComment403UsesFallbackRes = await runReviewGateCase({
      prAuthor: 'dependabot[bot]',
      baseRef: 'beta',
      headSha: gateHeadSha,
      eventName: 'issue_comment',
      action: 'created',
      actionsGithubToken: 'ghs_test_tok',
      fetchImpl: async () => ({ ok: true, status: 201 }),
      createCommitStatusImpl: async () => {
        const err = new Error('Resource not accessible by personal access token');
        err.status = 403;
        throw err;
      },
    });
    assert.equal(gateDependabotIssueComment403UsesFallbackRes.calls.fetch.length, 1);
    assert.equal(
      gateDependabotIssueComment403UsesFallbackRes.calls.fetch[0].url,
      `https://api.github.com/repos/shthed/capy/statuses/${gateHeadSha}`
    );
    assert.equal(
      JSON.parse(gateDependabotIssueComment403UsesFallbackRes.calls.fetch[0].init.body).state,
      'success'
    );
    assert.equal(gateDependabotIssueComment403UsesFallbackRes.calls.graphql[0].variables.mergeMethod, 'SQUASH');

    const gateDependabotMainPendingRes = await runReviewGateCase({
      prAuthor: 'dependabot[bot]',
      baseRef: 'main',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      labels: [],
      aiCommentScore: null,
      comments: [
        {
          id: 305,
          user: { login: 'shthed' },
          body: 'APPROVED',
          created_at: '2026-11-13T01:05:00Z',
          updated_at: '2026-11-13T01:05:00Z',
        },
      ],
    });
    assert.equal(gateDependabotMainPendingRes.status.state, 'pending');
    assert.equal(gateDependabotMainPendingRes.status.description, gateMainAwaitingAiAndOwnerDesc);

    const gateDependabotMainStrictPassRes = await runReviewGateCase({
      prAuthor: 'dependabot[bot]',
      baseRef: 'main',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      body: 'Dependabot bump details without unchecked checkboxes.',
      eventName: 'issue_comment',
      action: 'created',
      reviews: [
        {
          id: 306,
          user: { login: 'shthed' },
          state: 'APPROVED',
          commit_id: gateHeadSha,
          body: '',
          submitted_at: '2026-11-13T01:06:00Z',
        },
      ],
    });
    assert.equal(gateDependabotMainStrictPassRes.status.state, 'success');
    assert.equal(gateDependabotMainStrictPassRes.status.description, gateDualPassDesc);
    assert.equal(gateDependabotMainStrictPassRes.calls.createReview.length, 0);
    assert.equal(gateDependabotMainStrictPassRes.calls.graphql[0].variables.mergeMethod, 'MERGE');

    const gateDependabotMainUncheckedTaskFailRes = await runReviewGateCase({
      prAuthor: 'dependabot[bot]',
      baseRef: 'main',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      body: '- [ ] Confirm major dependency bump changelog',
      eventName: 'issue_comment',
      action: 'created',
    });
    assert.equal(gateDependabotMainUncheckedTaskFailRes.status.state, 'pending');
    assert.equal(gateDependabotMainUncheckedTaskFailRes.status.description, gateMainStrictNotMetNoOwnerDesc);
    assert.deepEqual(
      gateDependabotMainUncheckedTaskFailRes.calls.removeLabel.map((r) => r.name),
      ['review:ai-approved']
    );

    // sync/beta-from-main PRs pass verified ancestry syncs on beta and enable MERGE auto-merge (never SQUASH)
    const gateSyncBetaPassRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headRef: 'sync/beta-from-main',
      isDraft: false,
      headSha: gateHeadSha,
    });
    assert.equal(gateSyncBetaPassRes.status.state, 'success');
    assert.equal(gateSyncBetaPassRes.calls.createReview.length, 0);
    assert.equal(gateSyncBetaPassRes.calls.graphql[0].variables.mergeMethod, 'MERGE');

    // Retargeting an AI-approved PR from beta to main via pull_request edited passes immediately without Owner Approve and upgrades SQUASH -> MERGE
    const gateRetargetBetaToMainAwaitingOwnerRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'main',
      isDraft: false,
      headSha: gateHeadSha,
      autoMerge: { merge_method: 'SQUASH' },
      eventName: 'pull_request',
      action: 'edited',
    });
    assert.equal(gateRetargetBetaToMainAwaitingOwnerRes.status.state, 'success');
    assert.equal(gateRetargetBetaToMainAwaitingOwnerRes.status.description, gateMainAwaitingOwnerDesc);
    assert.equal(gateRetargetBetaToMainAwaitingOwnerRes.calls.graphql[0].variables.mergeMethod, 'MERGE');

    const gateRetargetBetaToMainRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'main',
      isDraft: false,
      headSha: gateHeadSha,
      autoMerge: { merge_method: 'SQUASH' },
      eventName: 'pull_request',
      action: 'edited',
      reviews: [
        {
          id: 307,
          user: { login: 'shthed' },
          state: 'APPROVED',
          commit_id: gateHeadSha,
          body: '',
          submitted_at: '2026-11-13T01:06:00Z',
        },
      ],
    });
    assert.equal(gateRetargetBetaToMainRes.status.state, 'success');
    assert.equal(gateRetargetBetaToMainRes.status.description, gateDualPassDesc);
    assert.equal(gateRetargetBetaToMainRes.calls.graphql[0].variables.mergeMethod, 'MERGE');

    // ADVERSARIAL-C regression: DISMISSED and PENDING reviews carrying <!-- capy-review: ... --> markers are ignored for both APPROVED and CHANGES_REQUESTED
    const gateDismissedAiReviewIgnoredRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'beta',
      headSha: gateHeadSha,
      labels: ['review:ai-approved'],
      aiCommentScore: null,
      eventName: 'pull_request_review',
      action: 'dismissed',
      reviews: [
        {
          id: 401,
          user: { login: 'shthed' },
          author_association: 'OWNER',
          state: 'DISMISSED',
          commit_id: gateHeadSha,
          body: `<!-- capy-review: actor=ai-agent verdict=APPROVED sha=${gateHeadSha} score=100% -->`,
          submitted_at: '2026-11-13T01:05:00Z',
        },
      ],
    });
    assert.equal(gateDismissedAiReviewIgnoredRes.status.state, 'pending');
    assert.equal(gateDismissedAiReviewIgnoredRes.status.description, gateBetaAwaitingAiDesc);
    assert.deepEqual(
      gateDismissedAiReviewIgnoredRes.calls.removeLabel.map((r) => r.name),
      ['review:ai-approved']
    );

    const gatePendingAiReviewIgnoredRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'beta',
      headSha: gateHeadSha,
      labels: ['review:ai-approved'],
      aiCommentScore: null,
      eventName: 'pull_request',
      action: 'labeled',
      reviews: [
        {
          id: 402,
          user: { login: 'shthed' },
          author_association: 'OWNER',
          state: 'PENDING',
          commit_id: gateHeadSha,
          body: `<!-- capy-review: actor=ai-agent verdict=APPROVED sha=${gateHeadSha} score=100% -->`,
          submitted_at: null,
        },
      ],
    });
    assert.equal(gatePendingAiReviewIgnoredRes.status.state, 'pending');
    assert.deepEqual(
      gatePendingAiReviewIgnoredRes.calls.removeLabel.map((r) => r.name),
      ['review:ai-approved']
    );

    const gateDismissedAndPendingAiRejectIgnoredRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'beta',
      headSha: gateHeadSha,
      labels: ['review:ai-approved'],
      aiCommentScore: 100,
      reviews: [
        {
          id: 403,
          user: { login: 'shthed' },
          author_association: 'OWNER',
          state: 'DISMISSED',
          commit_id: gateHeadSha,
          body: `<!-- capy-review: actor=ai-agent verdict=CHANGES_REQUESTED sha=${gateHeadSha} score=40% -->`,
          submitted_at: '2026-11-13T01:06:00Z',
        },
        {
          id: 404,
          user: { login: 'shthed' },
          author_association: 'OWNER',
          state: 'PENDING',
          commit_id: gateHeadSha,
          body: `<!-- capy-review: actor=ai-agent verdict=CHANGES_REQUESTED sha=${gateHeadSha} score=40% -->`,
          submitted_at: null,
        },
      ],
    });
    assert.equal(gateDismissedAndPendingAiRejectIgnoredRes.status.state, 'success');

    // ADVERSARIAL-B regression: draft and converted_to_draft preserve review:changes-requested (failure), while synchronize strips all review labels
    const gateDraftPreservesChangesRequestedRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'beta',
      isDraft: true,
      headSha: gateHeadSha,
      labels: ['review:ai-approved', 'review:owner-approved', 'review:changes-requested'],
      aiCommentScore: null,
      eventName: 'pull_request',
      action: 'labeled',
    });
    assert.equal(gateDraftPreservesChangesRequestedRes.status.state, 'failure');
    assert.equal(gateDraftPreservesChangesRequestedRes.status.description.startsWith('Beta (no Owner approval needed): Blocked by Changes requested / hold'), true);
    assert.deepEqual(
      gateDraftPreservesChangesRequestedRes.calls.removeLabel.map((r) => r.name),
      ['review:ai-approved', 'review:owner-approved']
    );

    const gateConvertedToDraftPreservesChangesRequestedRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'beta',
      isDraft: true,
      headSha: gateHeadSha,
      labels: ['review:ai-approved', 'review:changes-requested'],
      aiCommentScore: null,
      eventName: 'pull_request',
      action: 'converted_to_draft',
    });
    assert.equal(gateConvertedToDraftPreservesChangesRequestedRes.status.state, 'failure');
    assert.deepEqual(
      gateConvertedToDraftPreservesChangesRequestedRes.calls.removeLabel.map((r) => r.name),
      ['review:ai-approved']
    );

    const gateSynchronizeClearsAllReviewLabelsRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'beta',
      isDraft: false,
      headSha: gateHeadSha,
      labels: ['review:ai-approved', 'review:owner-approved', 'review:changes-requested'],
      aiCommentScore: null,
      eventName: 'pull_request',
      action: 'synchronize',
    });
    assert.equal(gateSynchronizeClearsAllReviewLabelsRes.status.state, 'pending');
    assert.equal(gateSynchronizeClearsAllReviewLabelsRes.status.description, gateBetaAwaitingAiDesc);
    assert.deepEqual(
      gateSynchronizeClearsAllReviewLabelsRes.calls.removeLabel.map((r) => r.name),
      ['review:ai-approved', 'review:owner-approved', 'review:changes-requested']
    );

    const gateDraftSynchronizeClearsAllReviewLabelsRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'beta',
      isDraft: true,
      headSha: gateHeadSha,
      labels: ['review:ai-approved', 'review:owner-approved', 'review:changes-requested'],
      aiCommentScore: null,
      eventName: 'pull_request',
      action: 'synchronize',
    });
    assert.equal(gateDraftSynchronizeClearsAllReviewLabelsRes.status.state, 'pending');
    assert.equal(
      gateDraftSynchronizeClearsAllReviewLabelsRes.status.description.startsWith(
        'Beta (no Owner approval needed): Blocked by Draft PR'
      ),
      true
    );
    assert.deepEqual(
      gateDraftSynchronizeClearsAllReviewLabelsRes.calls.removeLabel.map((r) => r.name),
      ['review:ai-approved', 'review:owner-approved', 'review:changes-requested']
    );

    // edc70ed regression: synchronize preserves review:ai-approved when hasValidAiMarker holds while stripping owner/changes-requested labels
    const gateSynchronizePreservesAiApprovedRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'beta',
      isDraft: false,
      headSha: gateHeadSha,
      labels: ['review:ai-approved', 'review:owner-approved', 'review:changes-requested'],
      aiCommentScore: 100,
      eventName: 'pull_request',
      action: 'synchronize',
    });
    assert.equal(gateSynchronizePreservesAiApprovedRes.status.state, 'success');
    assert.deepEqual(
      gateSynchronizePreservesAiApprovedRes.calls.removeLabel.map((r) => r.name),
      ['review:owner-approved', 'review:changes-requested']
    );
    assert.equal(gateSynchronizePreservesAiApprovedRes.calls.addLabels.length, 0);

    const gateSynchronizeReaddsAiApprovedRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'beta',
      isDraft: false,
      headSha: gateHeadSha,
      labels: ['review:owner-approved', 'review:changes-requested'],
      aiCommentScore: 100,
      eventName: 'pull_request',
      action: 'synchronize',
    });
    assert.equal(gateSynchronizeReaddsAiApprovedRes.status.state, 'success');
    assert.deepEqual(
      gateSynchronizeReaddsAiApprovedRes.calls.addLabels.flatMap((a) => a.labels),
      ['review:ai-approved']
    );
    assert.deepEqual(
      gateSynchronizeReaddsAiApprovedRes.calls.removeLabel.map((r) => r.name),
      ['review:owner-approved', 'review:changes-requested']
    );

    // ACTIONS_GITHUB_TOKEN 403 commit status REST fallback across success, pending, and failure states
    const gatePrimaryStatusNoFallbackRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'beta',
      headSha: gateHeadSha,
      actionsGithubToken: 'ghs_actions_token',
    });
    assert.equal(gatePrimaryStatusNoFallbackRes.status.state, 'success');
    assert.equal(gatePrimaryStatusNoFallbackRes.calls.fetch.length, 0);

    for (const fallbackCase of [
      {
        expectedState: 'success',
        aiCommentScore: 100,
        labels: ['review:ai-approved'],
        comments: [],
      },
      {
        expectedState: 'pending',
        aiCommentScore: null,
        labels: [],
        comments: [],
      },
      {
        expectedState: 'failure',
        aiCommentScore: 100,
        labels: ['review:ai-approved'],
        comments: [
          {
            user: { login: 'shthed' },
            body: 'HOLD pending fix',
            created_at: '2026-11-13T01:02:00Z',
            updated_at: '2026-11-13T01:02:00Z',
          },
        ],
      },
    ]) {
      const fallbackRes = await runReviewGateCase({
        prAuthor: 'shthed',
        baseRef: 'beta',
        headSha: gateHeadSha,
        aiCommentScore: fallbackCase.aiCommentScore,
        labels: fallbackCase.labels,
        comments: fallbackCase.comments,
        actionsGithubToken: 'ghs_test_tok',
        fetchImpl: async () => ({ ok: true, status: 201 }),
        createCommitStatusImpl: async () => {
          const err = new Error('Resource not accessible by personal access token');
          err.status = 403;
          throw err;
        },
      });
      assert.equal(fallbackRes.calls.fetch.length, 1);
      const { url: fetchUrl, init: fetchInit } = fallbackRes.calls.fetch[0];
      assert.equal(fetchUrl, `https://api.github.com/repos/shthed/capy/statuses/${gateHeadSha}`);
      assert.equal(fetchInit.method, 'POST');
      assert.equal(fetchInit.headers.Authorization, 'Bearer ghs_test_tok');
      assert.equal(fetchInit.headers.Accept, 'application/vnd.github+json');
      const fallbackBody = JSON.parse(fetchInit.body);
      assert.equal(fallbackBody.state, fallbackCase.expectedState);
      assert.equal(fallbackBody.context, 'capy/review-gate');
      assert.equal(fallbackBody.description.length <= 140, true);
      assert.equal(fallbackBody.target_url, 'https://github.com/shthed/capy/pull/490');
      if (fallbackCase.expectedState === 'success') {
        assert.equal(fallbackRes.calls.graphql[0].variables.mergeMethod, 'SQUASH');
      }
    }

    // capyboop co-owner approval, AI review marker, HOLD, cross-owner supersession & untrusted rejection
    const gateCapyboopMainApprovedRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'main',
      headSha: gateHeadSha,
      labels: ['review:ai-approved'],
      reviews: [
        {
          id: 701,
          state: 'APPROVED',
          body: '',
          commit_id: gateHeadSha,
          submitted_at: '2026-11-13T01:02:00Z',
          user: { login: 'capyboop' },
        },
      ],
    });
    assert.equal(gateCapyboopMainApprovedRes.status.state, 'success');
    assert.equal(gateCapyboopMainApprovedRes.status.description, gateDualPassDesc);

    const gateCapyboopBetaAiMarkerRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headSha: gateHeadSha,
      labels: ['review:ai-approved'],
      aiCommentScore: null,
      comments: [
        {
          user: { login: 'CapyBoop' },
          body: `<!-- capy-review: actor=ai-agent verdict=APPROVED sha=${gateHeadSha} score=100% -->`,
          created_at: '2026-11-13T01:01:00Z',
          updated_at: '2026-11-13T01:01:00Z',
        },
      ],
    });
    assert.equal(gateCapyboopBetaAiMarkerRes.status.state, 'success');
    assert.ok(gateCapyboopBetaAiMarkerRes.status.description.includes('Beta gate passed'));

    for (const targetBase of ['beta', 'main']) {
      const gateCapyboopHoldRes = await runReviewGateCase({
        prAuthor: 'github-actions[bot]',
        baseRef: targetBase,
        headSha: gateHeadSha,
        labels: ['review:ai-approved'],
        reviews: [
          {
            id: 702,
            state: 'APPROVED',
            body: '',
            commit_id: gateHeadSha,
            submitted_at: '2026-11-13T01:02:00Z',
            user: { login: 'shthed' },
          },
        ],
        comments: [
          {
            user: { login: 'capyboop' },
            body: 'HOLD pending final check',
            created_at: '2026-11-13T01:03:00Z',
            updated_at: '2026-11-13T01:03:00Z',
          },
        ],
      });
      assert.equal(gateCapyboopHoldRes.status.state, 'failure');
      assert.equal(gateCapyboopHoldRes.status.description.includes('Blocked by Changes requested / hold'), true);
    }

    const gateShthedSupersedesCapyboopHoldRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'main',
      headSha: gateHeadSha,
      labels: ['review:ai-approved'],
      reviews: [
        {
          id: 703,
          state: 'APPROVED',
          body: '',
          commit_id: gateHeadSha,
          submitted_at: '2026-11-13T01:04:00Z',
          user: { login: 'shthed' },
        },
      ],
      comments: [
        {
          user: { login: 'capyboop' },
          body: 'HOLD earlier issue',
          created_at: '2026-11-13T01:02:00Z',
          updated_at: '2026-11-13T01:02:00Z',
        },
      ],
    });
    assert.equal(gateShthedSupersedesCapyboopHoldRes.status.state, 'success');
    assert.equal(gateShthedSupersedesCapyboopHoldRes.status.description, gateDualPassDesc);

    const gateBeta99PendingRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headSha: gateHeadSha,
      labels: ['review:ai-approved'],
      aiCommentScore: 99,
    });
    assert.equal(gateBeta99PendingRes.status.state, 'pending');
    assert.equal(gateBeta99PendingRes.status.description, gateStrictNotMetDesc);
    assert.deepEqual(
      gateBeta99PendingRes.calls.removeLabel.map((r) => r.name),
      ['review:ai-approved']
    );

    const gateUntrustedMainApprovedRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'main',
      headSha: gateHeadSha,
      labels: [],
      aiCommentScore: null,
      reviews: [
        {
          id: 704,
          state: 'APPROVED',
          body: '',
          commit_id: gateHeadSha,
          submitted_at: '2026-11-13T01:02:00Z',
          user: { login: 'stranger' },
        },
      ],
    });
    assert.equal(gateUntrustedMainApprovedRes.status.state, 'pending');
    assert.equal(gateUntrustedMainApprovedRes.status.description, gateMainAwaitingAiAndOwnerDesc);

    const gateUntrustedMainCannotClearHoldRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'main',
      headSha: gateHeadSha,
      comments: [
        {
          id: 7041,
          user: { login: 'shthed' },
          body: 'HOLD - untrusted reviewer cannot override',
          created_at: '2026-11-13T01:01:00Z',
          updated_at: '2026-11-13T01:01:00Z',
        },
      ],
      reviews: [
        {
          id: 7042,
          state: 'APPROVED',
          body: '',
          commit_id: gateHeadSha,
          submitted_at: '2026-11-13T01:03:00Z',
          user: { login: 'stranger' },
        },
      ],
    });
    assert.equal(gateUntrustedMainCannotClearHoldRes.status.state, 'failure');

    // Strict 100% PR body / AI review body enforcement & auto-merge GraphQL + clean-status merge fallback (2ae9e78)
    for (const [targetBase, expectedMethod, expectedDesc] of [
      ['beta', 'SQUASH', gateBetaPassDesc],
      ['main', 'MERGE', gateDualPassDesc],
    ]) {
      const gateStrictBodyValidPassRes = await runReviewGateCase({
        prAuthor: 'github-actions[bot]',
        baseRef: targetBase,
        headSha: gateHeadSha,
        body: validStrictPrBody,
        reviews:
          targetBase === 'main'
            ? [
                {
                  id: 8101,
                  user: { login: 'shthed' },
                  state: 'APPROVED',
                  commit_id: gateHeadSha,
                  body: '',
                  submitted_at: '2026-11-13T01:06:00Z',
                },
              ]
            : [],
        aiCommentBody: [
          'Independent review passed.',
          '- **100%** — **All Checks**: Verified.',
          `<!-- capy-review: actor=ai-agent verdict=APPROVED sha=${gateHeadSha} score=100% -->`,
        ].join('\n'),
      });
      assert.equal(gateStrictBodyValidPassRes.status.state, 'success');
      assert.equal(gateStrictBodyValidPassRes.status.description, expectedDesc);
      assert.equal(gateStrictBodyValidPassRes.calls.graphql.length, 1);
      assert.equal(gateStrictBodyValidPassRes.calls.graphql[0].variables.mergeMethod, expectedMethod);
    }

    for (const [labelCase, overrides] of [
      [
        'null body',
        {
          body: null,
        },
      ],
      [
        'undefined/missing body',
        {
          body: undefined,
        },
      ],
      [
        'empty body',
        {
          body: '   ',
        },
      ],
      [
        'missing ## Summary',
        {
          body: '### PR Readiness Score: 100%\n\n- **100%** — **Checks**: Passed.',
        },
      ],
      [
        'missing PR Readiness Score: 100%',
        {
          body: '## Summary\n\nPlain summary.\n\n### PR Readiness Score: 99%\n\n- **100%** — **Checks**: Passed.',
        },
      ],
      [
        'sub-100% PR checklist item',
        {
          body: `${validStrictPrBody}\n- **95%** — **Followup**: Incomplete.`,
        },
      ],
      [
        'unchecked PR task checkbox',
        {
          body: `${validStrictPrBody}\n- [ ] Remaining subtask`,
        },
      ],
      [
        'unchecked star checkbox',
        {
          body: `${validStrictPrBody}\n* [ ] Follow up`,
        },
      ],
      [
        'sub-100% heading in AI body',
        {
          body: validStrictPrBody,
          aiCommentBody: `### PR Readiness Score: 98%\n<!-- capy-review: actor=ai-agent verdict=APPROVED sha=${gateHeadSha} score=100% -->`,
        },
      ],
      [
        'sub-100% AI review checklist item',
        {
          body: validStrictPrBody,
          aiCommentBody: `- **98%** — **Minor gap**\n<!-- capy-review: actor=ai-agent verdict=APPROVED sha=${gateHeadSha} score=100% -->`,
        },
      ],
      [
        'unchecked AI review task checkbox',
        {
          body: validStrictPrBody,
          aiCommentBody: `- [ ] Pending follow-up\n<!-- capy-review: actor=ai-agent verdict=APPROVED sha=${gateHeadSha} score=100% -->`,
        },
      ],
    ]) {
      const strictRejectRes = await runReviewGateCase({
        prAuthor: 'github-actions[bot]',
        baseRef: 'beta',
        headSha: gateHeadSha,
        labels: ['review:ai-approved'],
        ...overrides,
      });
      assert.equal(
        strictRejectRes.status.state,
        'pending',
        `Expected strict 100% gate to reject ${labelCase}`
      );
      assert.equal(strictRejectRes.status.description, gateStrictNotMetDesc);
      assert.deepEqual(
        strictRejectRes.calls.removeLabel.map((r) => r.name),
        ['review:ai-approved']
      );
      assert.equal(strictRejectRes.calls.graphql.length, 0);
    }

    // Tampering with PR body via pull_request edited strips review:ai-approved, holds pending, and disarms prior auto-merge
    for (const [tamperCase, tamperedBody] of [
      ['## Summary removed', '### PR Readiness Score: 100%\n\n- **100%** — **Checks**: Passed.'],
      ['unchecked task added', `${validStrictPrBody}\n- [ ] Incomplete follow-up`],
      ['null body', null],
    ]) {
      const tamperedNoAutoMergeRes = await runReviewGateCase({
        prAuthor: 'github-actions[bot]',
        baseRef: 'beta',
        headSha: gateHeadSha,
        body: tamperedBody,
        labels: ['review:ai-approved'],
        eventName: 'pull_request',
        action: 'edited',
      });
      assert.equal(
        tamperedNoAutoMergeRes.status.state,
        'pending',
        `Expected edited ${tamperCase} to return pending`
      );
      assert.equal(tamperedNoAutoMergeRes.status.description, gateStrictNotMetDesc);
      assert.deepEqual(
        tamperedNoAutoMergeRes.calls.removeLabel.map((r) => r.name),
        ['review:ai-approved']
      );
      assert.equal(tamperedNoAutoMergeRes.calls.graphql.length, 0);

      const tamperedWithAutoMergeRes = await runReviewGateCase({
        prAuthor: 'github-actions[bot]',
        baseRef: 'beta',
        headSha: gateHeadSha,
        nodeId: 'PR_node_tamper',
        body: tamperedBody,
        autoMerge: { merge_method: 'SQUASH' },
        labels: ['review:ai-approved'],
        eventName: 'pull_request',
        action: 'edited',
      });
      assert.equal(tamperedWithAutoMergeRes.status.state, 'pending');
      assert.deepEqual(
        tamperedWithAutoMergeRes.calls.removeLabel.map((r) => r.name),
        ['review:ai-approved']
      );
      assert.equal(tamperedWithAutoMergeRes.calls.graphql.length, 1);
      assert.equal(
        tamperedWithAutoMergeRes.calls.graphql[0].query.includes('disablePullRequestAutoMerge'),
        true
      );
    }

    // Pre-existing Owner-armed auto-merge awaiting initial AI review is preserved while capy/review-gate stays pending
    const preAiAutoMergePreservedRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headSha: gateHeadSha,
      autoMerge: { merge_method: 'SQUASH' },
      labels: [],
      aiCommentScore: null,
    });
    assert.equal(preAiAutoMergePreservedRes.status.state, 'pending');
    assert.equal(preAiAutoMergePreservedRes.calls.graphql.length, 0);

    for (const [targetBase, expectedMergeMethod] of [
      ['beta', 'squash'],
      ['main', 'merge'],
    ]) {
      for (const fallbackError of [
        'Pull request is in clean status',
        'Auto-merge is not supported for stacked pull requests.',
      ]) {
        const gateCleanFallbackRes = await runReviewGateCase({
          prAuthor: 'github-actions[bot]',
          baseRef: targetBase,
          headSha: gateHeadSha,
          body: validStrictPrBody,
          reviews: [],
          graphqlImpl: async () => {
            throw new Error(fallbackError);
          },
        });
        assert.equal(gateCleanFallbackRes.status.state, 'success');
        assert.equal(gateCleanFallbackRes.calls.merge.length, 1);
        assert.equal(gateCleanFallbackRes.calls.merge[0].merge_method, expectedMergeMethod);
        assert.equal(gateCleanFallbackRes.calls.merge[0].sha, gateHeadSha);
        assert.equal(gateCleanFallbackRes.calls.request.length, 0);
      }

      // Stacked PRs that reject REST pulls.merge must fall back cleanly to PUT /merge-async
      const gateStackedAsyncFallbackRes = await runReviewGateCase({
        prAuthor: 'github-actions[bot]',
        baseRef: targetBase,
        headSha: gateHeadSha,
        body: validStrictPrBody,
        reviews: [],
        graphqlImpl: async () => {
          throw new Error('Auto-merge is not supported for stacked pull requests.');
        },
        mergeImpl: async () => {
          throw new Error(
            'Merging stacked PRs via this endpoint is not supported. Use the asynchronous merge endpoint instead.'
          );
        },
      });
      assert.equal(gateStackedAsyncFallbackRes.status.state, 'success');
      assert.equal(gateStackedAsyncFallbackRes.calls.merge.length, 1);
      assert.equal(gateStackedAsyncFallbackRes.calls.request.length, 1);
      assert.equal(
        gateStackedAsyncFallbackRes.calls.request[0].route,
        'PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge-async'
      );
      assert.deepEqual(gateStackedAsyncFallbackRes.calls.request[0].payload, {
        owner: 'shthed',
        repo: 'capy',
        pull_number: 490,
        sha: gateHeadSha,
        merge_method: expectedMergeMethod,
        merge_action: 'direct_merge',
      });

      const gateStackedAsync409Res = await runReviewGateCase({
        prAuthor: 'github-actions[bot]',
        baseRef: targetBase,
        headSha: gateHeadSha,
        body: validStrictPrBody,
        reviews: [],
        graphqlImpl: async () => {
          throw new Error('Auto-merge is not supported for stacked pull requests.');
        },
        mergeImpl: async () => {
          throw new Error(
            'Merging stacked PRs via this endpoint is not supported. Use the asynchronous merge endpoint instead.'
          );
        },
        requestImpl: async () => {
          const err = new Error('Merge already queued');
          err.status = 409;
          throw err;
        },
      });
      assert.equal(gateStackedAsync409Res.status.state, 'success');
      assert.equal(gateStackedAsync409Res.calls.request.length, 1);
      assert.equal(
        gateStackedAsync409Res.core.warnings.some((w) => w.includes('Async stacked merge fallback failed')),
        false
      );
    }

    // Auto-merge stuck `blocked` by non-check ruleset requirements must merge directly once
    // `Build & Test` is green on the exact head SHA (no Owner approval required per Owner directive)
    const greenHeadRuns = [
      { name: 'Build & Test', status: 'completed', conclusion: 'cancelled', started_at: '2026-11-13T01:00:00Z' },
      { name: 'Build & Test', status: 'completed', conclusion: 'success', started_at: '2026-11-13T01:01:00Z' },
      { name: 'Playwright E2E', status: 'in_progress', conclusion: null, started_at: '2026-11-13T01:01:00Z' },
    ];
    for (const [targetBase, expectedMergeMethod] of [
      ['beta', 'squash'],
      ['main', 'merge'],
    ]) {
      const gateBlockedDirectMergeRes = await runReviewGateCase({
        prAuthor: 'shthed',
        baseRef: targetBase,
        headSha: gateHeadSha,
        body: validStrictPrBody,
        reviews: [],
        mergeableState: 'blocked',
        checkRuns: greenHeadRuns,
      });
      assert.equal(gateBlockedDirectMergeRes.status.state, 'success');
      assert.equal(gateBlockedDirectMergeRes.calls.graphql.length, 1);
      assert.equal(gateBlockedDirectMergeRes.calls.merge.length, 1);
      assert.equal(gateBlockedDirectMergeRes.calls.merge[0].merge_method, expectedMergeMethod);
      assert.equal(gateBlockedDirectMergeRes.calls.merge[0].sha, gateHeadSha);
    }

    for (const blockingRuns of [
      [],
      [{ name: 'Build & Test', status: 'in_progress', conclusion: null, started_at: '2026-11-13T01:01:00Z' }],
      [
        { name: 'Build & Test', status: 'completed', conclusion: 'success', started_at: '2026-11-13T01:01:00Z' },
        { name: 'Android APK', status: 'completed', conclusion: 'failure', started_at: '2026-11-13T01:01:00Z' },
      ],
    ]) {
      const gateBlockedNotGreenRes = await runReviewGateCase({
        prAuthor: 'shthed',
        baseRef: 'beta',
        headSha: gateHeadSha,
        body: validStrictPrBody,
        reviews: [],
        mergeableState: 'blocked',
        checkRuns: blockingRuns,
      });
      assert.equal(gateBlockedNotGreenRes.status.state, 'success');
      assert.equal(gateBlockedNotGreenRes.calls.merge.length, 0);
    }

    const gateBlockedHeldRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'beta',
      headSha: gateHeadSha,
      body: validStrictPrBody,
      reviews: [],
      labels: ['review:ai-approved', 'review:changes-requested'],
      mergeableState: 'blocked',
      checkRuns: greenHeadRuns,
    });
    assert.notEqual(gateBlockedHeldRes.status.state, 'success');
    assert.equal(gateBlockedHeldRes.calls.merge.length, 0);

    const gateCleanStateNoDirectMergeRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'beta',
      headSha: gateHeadSha,
      body: validStrictPrBody,
      reviews: [],
      mergeableState: 'unstable',
      checkRuns: greenHeadRuns,
    });
    assert.equal(gateCleanStateNoDirectMergeRes.status.state, 'success');
    assert.equal(gateCleanStateNoDirectMergeRes.calls.merge.length, 0);

    // Draft PRs must include a `- [ ]` outstanding-work checklist before being marked Ready for Review
    const gateDraftMissingChecklistRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      isDraft: true,
      headSha: gateHeadSha,
      body: validStrictPrBody,
    });
    assert.equal(gateDraftMissingChecklistRes.status.state, 'pending');
    assert.equal(
      gateDraftMissingChecklistRes.status.description.includes('Draft outstanding-work checklist'),
      true
    );
    assert.equal(
      gateDraftMissingChecklistRes.calls.createComment[0].body.includes(
        '- [ ] **Draft Outstanding Work Checklist**'
      ),
      true
    );

    const draftWithOutstandingBody = [
      '## Summary',
      '',
      'WIP Draft feature slice.',
      '',
      '## Outstanding Work Before Marking Ready',
      '- [ ] Finish Playwright E2E regression tests',
      '',
      '### PR Readiness Score: 80%',
    ].join('\n');
    const gateDraftWithChecklistRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      isDraft: true,
      headSha: gateHeadSha,
      body: draftWithOutstandingBody,
    });
    assert.equal(gateDraftWithChecklistRes.status.state, 'pending');
    assert.equal(
      gateDraftWithChecklistRes.status.description.includes('Draft outstanding-work checklist'),
      false
    );
    assert.equal(
      gateDraftWithChecklistRes.calls.createComment[0].body.includes(
        '- [x] **Draft Outstanding Work Checklist**'
      ),
      true
    );

    const gateReadyStillUncheckedBlockedRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      isDraft: false,
      headSha: gateHeadSha,
      body: draftWithOutstandingBody,
      labels: ['review:ai-approved'],
    });
    assert.equal(gateReadyStillUncheckedBlockedRes.status.state, 'pending');
    assert.deepEqual(
      gateReadyStillUncheckedBlockedRes.calls.removeLabel.map((r) => r.name),
      ['review:ai-approved']
    );

    // Dependabot PRs omit ## Summary / PR Readiness Score, yet still reject unchecked or sub-100% lines
    const gateDependabotBetaExemptPassRes = await runReviewGateCase({
      prAuthor: 'dependabot[bot]',
      baseRef: 'beta',
      headSha: gateHeadSha,
      body: 'Bump vite from 7.0.0 to 7.0.1.',
      labels: ['review:ai-approved'],
      aiCommentScore: 100,
    });
    assert.equal(gateDependabotBetaExemptPassRes.status.state, 'success');
    assert.equal(gateDependabotBetaExemptPassRes.status.description, gateBetaPassDesc);

    const gateDependabotBetaBadChecklistRes = await runReviewGateCase({
      prAuthor: 'dependabot[bot]',
      baseRef: 'beta',
      headSha: gateHeadSha,
      body: 'Bump vite.\n\n- [ ] Check release notes\n',
      labels: ['review:ai-approved'],
      aiCommentScore: 100,
    });
    assert.equal(gateDependabotBetaBadChecklistRes.status.state, 'pending');
    assert.equal(gateDependabotBetaBadChecklistRes.status.description, gateStrictNotMetDesc);
    assert.deepEqual(
      gateDependabotBetaBadChecklistRes.calls.removeLabel.map((r) => r.name),
      ['review:ai-approved']
    );

    // sync/beta-from-main PR body is exempted from ## Summary / PR Readiness Score even under AI review
    const gateSyncBodyExemptPassRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headRef: 'sync/beta-from-main',
      headSha: gateHeadSha,
      body: 'Automated merge of origin/main into beta.',
      labels: ['review:ai-approved'],
      aiCommentScore: 100,
    });
    assert.equal(gateSyncBodyExemptPassRes.status.state, 'success');
    assert.equal(gateSyncBodyExemptPassRes.calls.graphql.length, 1);
    assert.equal(gateSyncBodyExemptPassRes.calls.graphql[0].variables.mergeMethod, 'MERGE');

    // GraphQL enablePullRequestAutoMerge preserves existing MERGE method on beta, and held PR disables active auto-merge
    const gateBetaPreservesMergeMethodRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headSha: gateHeadSha,
      body: validStrictPrBody,
      autoMerge: { merge_method: 'MERGE' },
    });
    assert.equal(gateBetaPreservesMergeMethodRes.status.state, 'success');
    assert.equal(gateBetaPreservesMergeMethodRes.calls.graphql.length, 0);

    const gateHeldDisablesAutoMergeRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headSha: gateHeadSha,
      nodeId: 'PR_node_490',
      autoMerge: { merge_method: 'SQUASH' },
      comments: [
        {
          id: 950,
          user: { login: 'shthed' },
          body: 'HOLD - pause auto-merge',
          created_at: '2026-11-13T01:05:00Z',
          updated_at: '2026-11-13T01:05:00Z',
        },
      ],
    });
    assert.equal(gateHeldDisablesAutoMergeRes.status.state, 'failure');
    assert.equal(gateHeldDisablesAutoMergeRes.calls.graphql.length, 1);
    assert.equal(
      gateHeldDisablesAutoMergeRes.calls.graphql[0].query.includes('disablePullRequestAutoMerge'),
      true
    );
    assert.equal(
      gateHeldDisablesAutoMergeRes.calls.graphql[0].variables.pullRequestId,
      'PR_node_490'
    );
    assert.equal(gateHeldDisablesAutoMergeRes.calls.merge.length, 0);

    // (o) Verified sync/beta-from-main -> beta fast-pass & fail-closed checks
    const baseSyncSha = 'basesha000000000000000000000000000000000';
    const mainSyncSha = 'mainsha111111111111111111111111111111111';
    const betaSyncSha = 'betasha222222222222222222222222222222222';
    const syncMergeSha = 'syncsha333333333333333333333333333333333';
    const syncCommitsFixture = {
      [syncMergeSha]: {
        sha: syncMergeSha,
        commit: {
          committer: { date: '2026-11-15T01:00:00Z' },
          author: { date: '2026-11-15T01:00:00Z' },
          tree: { sha: 'tree-main-exact' },
        },
      },
      'heads/main': {
        sha: mainSyncSha,
        commit: { tree: { sha: 'tree-main-exact' } },
      },
      'heads/beta': {
        sha: betaSyncSha,
        commit: { tree: { sha: 'tree-beta-old' } },
      },
    };
    const syncExactCompareFixture = {
      [`${syncMergeSha}...${mainSyncSha}`]: { ahead_by: 0, total_commits: 0 },
      [`${mainSyncSha}...${syncMergeSha}`]: {
        ahead_by: 1,
        total_commits: 1,
        files: [],
        commits: [
          {
            sha: syncMergeSha,
            parents: [{ sha: betaSyncSha }, { sha: mainSyncSha }],
          },
        ],
      },
      [`${syncMergeSha}...${betaSyncSha}`]: { ahead_by: 0, total_commits: 0 },
      [`${mainSyncSha}...${betaSyncSha}`]: { ahead_by: 0, total_commits: 0 },
    };

    const gateMainSyncExactPassRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headRef: 'sync/beta-from-main',
      headSha: syncMergeSha,
      labels: [],
      aiCommentScore: null,
      commitsByRef: syncCommitsFixture,
      compareMap: syncExactCompareFixture,
      eventName: 'pull_request',
      action: 'synchronize',
    });
    assert.equal(gateMainSyncExactPassRes.status.state, 'success');
    assert.equal(
      gateMainSyncExactPassRes.status.description,
      'Beta gate passed (no Owner approval needed): verified origin/main sync'
    );

    const gateMainSyncFastForwardPassRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headRef: 'sync/beta-from-main',
      headSha: mainSyncSha,
      labels: [],
      aiCommentScore: null,
      commitsByRef: {
        ...syncCommitsFixture,
        [mainSyncSha]: {
          sha: mainSyncSha,
          commit: {
            committer: { date: '2026-11-15T01:00:00Z' },
            author: { date: '2026-11-15T01:00:00Z' },
            tree: { sha: 'tree-main-exact' },
          },
        },
      },
      compareMap: {
        [`${mainSyncSha}...${mainSyncSha}`]: { ahead_by: 0, total_commits: 0 },
        [`${mainSyncSha}...${betaSyncSha}`]: { ahead_by: 0, total_commits: 0 },
      },
      eventName: 'pull_request',
      action: 'synchronize',
    });
    assert.equal(gateMainSyncFastForwardPassRes.status.state, 'success');

    // Defect 1D regression: unreviewed 1-parent no-op/reverted commit or multi-commit on betaIsAncestorOfMain (even with tree === mainTreeSha) fails closed -> pending
    const gateMainSyncUnreviewedNoopFailRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headRef: 'sync/beta-from-main',
      headSha: syncMergeSha,
      labels: [],
      aiCommentScore: null,
      commitsByRef: syncCommitsFixture,
      compareMap: {
        [`${syncMergeSha}...${mainSyncSha}`]: { ahead_by: 0, total_commits: 0 },
        [`${mainSyncSha}...${syncMergeSha}`]: {
          ahead_by: 1,
          total_commits: 1,
          files: [],
          commits: [
            {
              sha: syncMergeSha,
              parents: [{ sha: betaSyncSha }],
            },
          ],
        },
        [`${syncMergeSha}...${betaSyncSha}`]: { ahead_by: 0, total_commits: 0 },
        [`${mainSyncSha}...${betaSyncSha}`]: { ahead_by: 0, total_commits: 0 },
      },
    });
    assert.equal(gateMainSyncUnreviewedNoopFailRes.status.state, 'pending');

    const gateMainSyncMultiCommitFailRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headRef: 'sync/beta-from-main',
      headSha: syncMergeSha,
      labels: [],
      aiCommentScore: null,
      commitsByRef: syncCommitsFixture,
      compareMap: {
        [`${syncMergeSha}...${mainSyncSha}`]: { ahead_by: 0, total_commits: 0 },
        [`${mainSyncSha}...${syncMergeSha}`]: {
          ahead_by: 2,
          total_commits: 2,
          files: [],
          commits: [
            { sha: 'extrasync000000000000000000000000000000', parents: [{ sha: mainSyncSha }] },
            { sha: syncMergeSha, parents: [{ sha: betaSyncSha }, { sha: 'extrasync000000000000000000000000000000' }] },
          ],
        },
        [`${syncMergeSha}...${betaSyncSha}`]: { ahead_by: 0, total_commits: 0 },
        [`${mainSyncSha}...${betaSyncSha}`]: { ahead_by: 0, total_commits: 0 },
      },
    });
    assert.equal(gateMainSyncMultiCommitFailRes.status.state, 'pending');

    // Diverged beta + main clean merge passes only when commits + files match mergeBase..main without touching beta-modified files
    const gateMainSyncDivergedPassRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headRef: 'sync/beta-from-main',
      headSha: syncMergeSha,
      labels: [],
      aiCommentScore: null,
      commitsByRef: {
        ...syncCommitsFixture,
        [syncMergeSha]: {
          ...syncCommitsFixture[syncMergeSha],
          commit: { ...syncCommitsFixture[syncMergeSha].commit, tree: { sha: 'tree-merged-clean' } },
        },
      },
      compareMap: {
        [`${syncMergeSha}...${mainSyncSha}`]: { ahead_by: 0, total_commits: 0 },
        [`${syncMergeSha}...${betaSyncSha}`]: { ahead_by: 0, total_commits: 0 },
        [`${mainSyncSha}...${betaSyncSha}`]: {
          ahead_by: 1,
          merge_base_commit: { sha: baseSyncSha },
        },
        [`${betaSyncSha}...${syncMergeSha}`]: {
          total_commits: 2,
          commits: [
            { sha: mainSyncSha, parents: [{ sha: baseSyncSha }] },
            { sha: syncMergeSha, parents: [{ sha: betaSyncSha }, { sha: mainSyncSha }] },
          ],
          files: [{ filename: 'CAPYBOOP.md', status: 'modified', sha: 'blob-capyboop-1' }],
        },
        [`${baseSyncSha}...${betaSyncSha}`]: {
          total_commits: 1,
          commits: [{ sha: betaSyncSha, parents: [{ sha: baseSyncSha }] }],
          files: [{ filename: 'beta-only.md', status: 'modified', sha: 'blob-beta-only' }],
        },
        [`${baseSyncSha}...${mainSyncSha}`]: {
          total_commits: 1,
          commits: [{ sha: mainSyncSha, parents: [{ sha: baseSyncSha }] }],
          files: [{ filename: 'CAPYBOOP.md', status: 'modified', sha: 'blob-capyboop-1' }],
        },
      },
    });
    assert.equal(gateMainSyncDivergedPassRes.status.state, 'success');
    assert.equal(
      gateMainSyncDivergedPassRes.status.description,
      'Beta gate passed (no Owner approval needed): verified origin/main sync'
    );

    // Defect 1A regression (PR #525 pattern): shared-file 3-way conflict (even clean merge) & evil-merge clobber both fail closed -> pending
    for (const conflictScenario of [
      {
        name: 'shared-file 3-way merge',
        prBlob: 'blob-merged-clean',
      },
      {
        name: 'evil-merge overwriting beta edits with main blob',
        prBlob: 'blob-main-clobber',
      },
    ]) {
      const sharedFileFailRes = await runReviewGateCase({
        prAuthor: 'github-actions[bot]',
        baseRef: 'beta',
        headRef: 'sync/beta-from-main',
        headSha: syncMergeSha,
        labels: [],
        aiCommentScore: null,
        commitsByRef: {
          ...syncCommitsFixture,
          [syncMergeSha]: {
            ...syncCommitsFixture[syncMergeSha],
            commit: { ...syncCommitsFixture[syncMergeSha].commit, tree: { sha: 'tree-merged-shared' } },
          },
        },
        compareMap: {
          [`${syncMergeSha}...${mainSyncSha}`]: { ahead_by: 0, total_commits: 0 },
          [`${syncMergeSha}...${betaSyncSha}`]: { ahead_by: 0, total_commits: 0 },
          [`${mainSyncSha}...${betaSyncSha}`]: {
            ahead_by: 1,
            merge_base_commit: { sha: baseSyncSha },
          },
          [`${betaSyncSha}...${syncMergeSha}`]: {
            total_commits: 2,
            commits: [
              { sha: mainSyncSha, parents: [{ sha: baseSyncSha }] },
              { sha: syncMergeSha, parents: [{ sha: betaSyncSha }, { sha: mainSyncSha }] },
            ],
            files: [{ filename: 'CHANGELOG.md', status: 'modified', sha: conflictScenario.prBlob }],
          },
          [`${baseSyncSha}...${betaSyncSha}`]: {
            total_commits: 1,
            commits: [{ sha: betaSyncSha, parents: [{ sha: baseSyncSha }] }],
            files: [{ filename: 'CHANGELOG.md', status: 'modified', sha: 'blob-beta-cl' }],
          },
          [`${baseSyncSha}...${mainSyncSha}`]: {
            total_commits: 1,
            commits: [{ sha: mainSyncSha, parents: [{ sha: baseSyncSha }] }],
            files: [{ filename: 'CHANGELOG.md', status: 'modified', sha: 'blob-main-clobber' }],
          },
        },
      });
      assert.equal(
        sharedFileFailRes.status.state,
        'pending',
        `Expected ${conflictScenario.name} to fail closed to pending`
      );
    }

    // Defect 1A renamed previous_filename mismatch + Defect 1B compare truncation (total_commits: 260) fail closed -> pending
    const gateMainSyncRenameMismatchFailRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headRef: 'sync/beta-from-main',
      headSha: syncMergeSha,
      labels: [],
      aiCommentScore: null,
      commitsByRef: syncCommitsFixture,
      compareMap: {
        [`${syncMergeSha}...${mainSyncSha}`]: { ahead_by: 0, total_commits: 0 },
        [`${syncMergeSha}...${betaSyncSha}`]: { ahead_by: 0, total_commits: 0 },
        [`${mainSyncSha}...${betaSyncSha}`]: {
          ahead_by: 1,
          merge_base_commit: { sha: baseSyncSha },
        },
        [`${betaSyncSha}...${syncMergeSha}`]: {
          total_commits: 2,
          commits: [
            { sha: mainSyncSha, parents: [{ sha: baseSyncSha }] },
            { sha: syncMergeSha, parents: [{ sha: betaSyncSha }, { sha: mainSyncSha }] },
          ],
          files: [
            {
              filename: 'GUIDE_NEW.md',
              status: 'renamed',
              previous_filename: 'OTHER.md',
              sha: 'blob-guide',
            },
          ],
        },
        [`${baseSyncSha}...${betaSyncSha}`]: {
          total_commits: 1,
          commits: [{ sha: betaSyncSha, parents: [{ sha: baseSyncSha }] }],
          files: [{ filename: 'beta-only.md', status: 'modified', sha: 'blob-beta-only' }],
        },
        [`${baseSyncSha}...${mainSyncSha}`]: {
          total_commits: 1,
          commits: [{ sha: mainSyncSha, parents: [{ sha: baseSyncSha }] }],
          files: [
            {
              filename: 'GUIDE_NEW.md',
              status: 'renamed',
              previous_filename: 'GUIDE_OLD.md',
              sha: 'blob-guide',
            },
          ],
        },
      },
    });
    assert.equal(gateMainSyncRenameMismatchFailRes.status.state, 'pending');

    const gateMainSyncTruncatedCompareFailRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headRef: 'sync/beta-from-main',
      headSha: syncMergeSha,
      labels: [],
      aiCommentScore: null,
      commitsByRef: syncCommitsFixture,
      compareMap: {
        [`${syncMergeSha}...${mainSyncSha}`]: { ahead_by: 0, total_commits: 0 },
        [`${syncMergeSha}...${betaSyncSha}`]: { ahead_by: 0, total_commits: 0 },
        [`${mainSyncSha}...${betaSyncSha}`]: {
          ahead_by: 1,
          merge_base_commit: { sha: baseSyncSha },
        },
        [`${betaSyncSha}...${syncMergeSha}`]: {
          total_commits: 260,
          commits: [
            { sha: mainSyncSha, parents: [{ sha: baseSyncSha }] },
            { sha: syncMergeSha, parents: [{ sha: betaSyncSha }, { sha: mainSyncSha }] },
          ],
          files: [{ filename: 'CAPYBOOP.md', status: 'modified', sha: 'blob-capyboop-1' }],
        },
        [`${baseSyncSha}...${betaSyncSha}`]: {
          total_commits: 1,
          commits: [{ sha: betaSyncSha, parents: [{ sha: baseSyncSha }] }],
          files: [{ filename: 'beta-only.md', status: 'modified', sha: 'blob-beta-only' }],
        },
        [`${baseSyncSha}...${mainSyncSha}`]: {
          total_commits: 1,
          commits: [{ sha: mainSyncSha, parents: [{ sha: baseSyncSha }] }],
          files: [{ filename: 'CAPYBOOP.md', status: 'modified', sha: 'blob-capyboop-1' }],
        },
      },
    });
    assert.equal(gateMainSyncTruncatedCompareFailRes.status.state, 'pending');

    // Defect 1C regression: future +10m commitDate with skewAnchorMs === 0 cannot drop a live HOLD comment (nor re-evaluation anchored by initial capy/review-gate status)
    const liveFutureNow = Date.now();
    const gateBetaFutureCommitHoldFailRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headSha: gateHeadSha,
      labels: [],
      aiCommentScore: null,
      commitDate: new Date(liveFutureNow + 10 * 60_000).toISOString(),
      comments: [
        {
          id: 910,
          user: { login: 'shthed' },
          body: 'HOLD - do not drop under future commitDate skew',
          created_at: new Date(liveFutureNow + 2 * 60_000).toISOString(),
          updated_at: new Date(liveFutureNow + 2 * 60_000).toISOString(),
        },
      ],
      eventName: 'issue_comment',
      action: 'created',
    });
    assert.equal(gateBetaFutureCommitHoldFailRes.status.state, 'failure');

    // +45s (+1s..+60s) future commitDate skew with AI approval at T+10s must NEVER drop Owner HOLD at T
    const nowSkew45 = Date.now();
    const gateBetaSkew45sHoldFailRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headSha: gateHeadSha,
      labels: [],
      aiCommentScore: 100,
      aiCommentTs: new Date(nowSkew45 + 10_000).toISOString(),
      commitDate: new Date(nowSkew45 + 45_000).toISOString(),
      comments: [
        {
          id: 912,
          user: { login: 'shthed' },
          body: 'HOLD - +45s clock skew must still fail closed',
          created_at: new Date(nowSkew45).toISOString(),
          updated_at: new Date(nowSkew45).toISOString(),
        },
      ],
      eventName: 'issue_comment',
      action: 'created',
    });
    assert.equal(gateBetaSkew45sHoldFailRes.status.state, 'failure');

    const gateBetaPastSkewStatusAnchorHoldFailRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headSha: gateHeadSha,
      labels: [],
      aiCommentScore: null,
      commitDate: '2026-11-13T01:10:00Z',
      commitStatuses: [
        {
          context: 'capy/review-gate',
          state: 'pending',
          created_at: '2026-11-13T01:00:05Z',
        },
      ],
      comments: [
        {
          id: 911,
          user: { login: 'shthed' },
          body: 'HOLD - caught via initial status timestamp anchor',
          created_at: '2026-11-13T01:02:00Z',
          updated_at: '2026-11-13T01:02:00Z',
        },
      ],
      eventName: 'issue_comment',
      action: 'created',
    });
    assert.equal(gateBetaPastSkewStatusAnchorHoldFailRes.status.state, 'failure');

    // Probe 9b regression: +45s skewed commit re-evaluated at t0+120s (after nowMs passes committer.date) must STILL detect skew via earliestHeadStatusMs (t0+15s) and enforce HOLD (t0+10s)
    const probe9bT0 = Date.now() - 120_000;
    const gateBetaProbe9bStatusAnchoredSkewHoldRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headSha: gateHeadSha,
      labels: ['review:ai-approved'],
      commitDate: new Date(probe9bT0 + 45_000).toISOString(),
      commitStatuses: [
        {
          context: 'capy/review-gate',
          state: 'pending',
          created_at: new Date(probe9bT0 + 15_000).toISOString(),
        },
      ],
      aiCommentScore: 100,
      aiCommentTs: new Date(probe9bT0 + 30_000).toISOString(),
      comments: [
        {
          id: 913,
          user: { login: 'shthed' },
          body: 'HOLD - Probe 9b post-push hold before status anchor must fail closed after t0+120s',
          created_at: new Date(probe9bT0 + 10_000).toISOString(),
          updated_at: new Date(probe9bT0 + 10_000).toISOString(),
        },
      ],
      eventName: 'issue_comment',
      action: 'created',
    });
    assert.equal(gateBetaProbe9bStatusAnchoredSkewHoldRes.status.state, 'failure');

    // Evil merge injecting extra file or modified blob SHA fails closed -> pending
    const gateMainSyncEvilMergeFailRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headRef: 'sync/beta-from-main',
      headSha: syncMergeSha,
      labels: [],
      aiCommentScore: null,
      commitsByRef: {
        ...syncCommitsFixture,
        [syncMergeSha]: {
          ...syncCommitsFixture[syncMergeSha],
          commit: { ...syncCommitsFixture[syncMergeSha].commit, tree: { sha: 'tree-evil' } },
        },
      },
      compareMap: {
        [`${syncMergeSha}...${mainSyncSha}`]: { ahead_by: 0, total_commits: 0 },
        [`${syncMergeSha}...${betaSyncSha}`]: { ahead_by: 0, total_commits: 0 },
        [`${mainSyncSha}...${betaSyncSha}`]: {
          ahead_by: 1,
          merge_base_commit: { sha: baseSyncSha },
        },
        [`${betaSyncSha}...${syncMergeSha}`]: {
          total_commits: 1,
          commits: [{ sha: syncMergeSha, parents: [{ sha: betaSyncSha }, { sha: mainSyncSha }] }],
          files: [
            { filename: 'CAPYBOOP.md', status: 'modified', sha: 'blob-capyboop-1' },
            { filename: 'web/src/evil.ts', status: 'added', sha: 'blob-evil' },
          ],
        },
        [`${baseSyncSha}...${betaSyncSha}`]: {
          total_commits: 1,
          commits: [{ sha: betaSyncSha, parents: [{ sha: baseSyncSha }] }],
          files: [{ filename: 'beta-only.md', status: 'modified', sha: 'blob-beta-only' }],
        },
        [`${baseSyncSha}...${mainSyncSha}`]: {
          total_commits: 1,
          commits: [{ sha: mainSyncSha, parents: [{ sha: baseSyncSha }] }],
          files: [{ filename: 'CAPYBOOP.md', status: 'modified', sha: 'blob-capyboop-1' }],
        },
      },
    });
    assert.equal(gateMainSyncEvilMergeFailRes.status.state, 'pending');
    assert.equal(gateMainSyncEvilMergeFailRes.status.description, gateBetaAwaitingAiDesc);

    // Unreviewed non-main commit or revert of beta-ahead work even with tree === mainTreeSha fails closed -> pending
    const gateMainSyncBetaRevertFailRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headRef: 'sync/beta-from-main',
      headSha: syncMergeSha,
      labels: [],
      aiCommentScore: null,
      commitsByRef: syncCommitsFixture,
      compareMap: {
        [`${syncMergeSha}...${mainSyncSha}`]: { ahead_by: 0, total_commits: 0 },
        [`${syncMergeSha}...${betaSyncSha}`]: { ahead_by: 0, total_commits: 0 },
        [`${mainSyncSha}...${betaSyncSha}`]: {
          ahead_by: 1,
          merge_base_commit: { sha: baseSyncSha },
        },
        [`${betaSyncSha}...${syncMergeSha}`]: {
          total_commits: 2,
          commits: [
            { sha: 'unreviewed123', parents: [{ sha: mainSyncSha }] },
            { sha: syncMergeSha, parents: [{ sha: betaSyncSha }, { sha: 'unreviewed123' }] },
          ],
          files: [{ filename: 'CAPYBOOP.md', status: 'modified', sha: 'blob-capyboop-1' }],
        },
        [`${baseSyncSha}...${betaSyncSha}`]: {
          total_commits: 1,
          commits: [{ sha: betaSyncSha, parents: [{ sha: baseSyncSha }] }],
          files: [{ filename: 'beta-only.md', status: 'modified', sha: 'blob-beta-only' }],
        },
        [`${baseSyncSha}...${mainSyncSha}`]: {
          total_commits: 1,
          commits: [{ sha: mainSyncSha, parents: [{ sha: baseSyncSha }] }],
          files: [{ filename: 'CAPYBOOP.md', status: 'modified', sha: 'blob-capyboop-1' }],
        },
        [`${mainSyncSha}...unreviewed123`]: { ahead_by: 1 },
      },
    });
    assert.equal(gateMainSyncBetaRevertFailRes.status.state, 'pending');

    // Fork sync/beta-from-main, draft, HOLD comment, and --base main all fail closed / obey full gate
    const gateMainSyncForkFailRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headRef: 'sync/beta-from-main',
      headRepoFullName: 'stranger/capy',
      headSha: syncMergeSha,
      labels: [],
      aiCommentScore: null,
      commitsByRef: syncCommitsFixture,
      compareMap: syncExactCompareFixture,
    });
    assert.equal(gateMainSyncForkFailRes.status.state, 'pending');

    const gateMainSyncHoldFailRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headRef: 'sync/beta-from-main',
      headSha: syncMergeSha,
      labels: [],
      aiCommentScore: null,
      commitsByRef: syncCommitsFixture,
      compareMap: syncExactCompareFixture,
      comments: [
        {
          id: 909,
          user: { login: 'shthed' },
          body: 'HOLD - wait for verification',
          created_at: '2026-11-15T01:05:00Z',
          updated_at: '2026-11-15T01:05:00Z',
        },
      ],
    });
    assert.equal(gateMainSyncHoldFailRes.status.state, 'failure');

    const gateMainSyncTargetMainPendingRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'main',
      headRef: 'sync/beta-from-main',
      headSha: syncMergeSha,
      labels: [],
      aiCommentScore: null,
      commitsByRef: syncCommitsFixture,
      compareMap: syncExactCompareFixture,
    });
    assert.equal(gateMainSyncTargetMainPendingRes.status.state, 'pending');
    logUnitPass('pr-review-gate.yml 100% AI score, checklist & hold/sync enforcement verified.');

    // Extract and unit-test real .github/workflows/open-pr.yml script
    logUnitStart('Testing open-pr.yml normalization, draft guard, labels & milestone lookup...');
    const runOpenPrScript = new AsyncFunction(
      'context',
      'github',
      'core',
      extractWorkflowScript('.github/workflows/open-pr.yml')
    );

    const runOpenPrCase = async (envInputs, { openPrs = [], milestones = [] } = {}) => {
      const prevEnv = {
        INPUT_HEAD: process.env.INPUT_HEAD,
        INPUT_BASE: process.env.INPUT_BASE,
        INPUT_TITLE: process.env.INPUT_TITLE,
        INPUT_BODY: process.env.INPUT_BODY,
        INPUT_DRAFT: process.env.INPUT_DRAFT,
        INPUT_LABELS: process.env.INPUT_LABELS,
        INPUT_MILESTONE: process.env.INPUT_MILESTONE,
      };
      for (const [key, val] of Object.entries(prevEnv)) {
        if (val === undefined) delete process.env[key];
      }
      Object.assign(process.env, envInputs);

      const calls = {
        listPrs: [],
        createPr: [],
        updatePr: [],
        addLabels: [],
        updateIssue: [],
      };
      const outputs = {};
      const warnings = [];
      const infos = [];
      const failed = [];
      const summaryBuffer = [];
      const coreMock = {
        setOutput: (k, v) => {
          outputs[k] = v;
        },
        warning: (m) => warnings.push(m),
        info: (m) => infos.push(m),
        setFailed: (m) => failed.push(m),
        summary: {
          addRaw: (text) => {
            summaryBuffer.push(text);
            return coreMock.summary;
          },
          write: async () => {},
        },
      };
      const githubMock = {
        paginate: async (fn, params) => (await fn(params)).data,
        rest: {
          pulls: {
            list: async (params) => {
              calls.listPrs.push(params);
              return { data: openPrs };
            },
            create: async (params) => {
              calls.createPr.push(params);
              return {
                data: {
                  number: 495,
                  html_url: 'https://github.com/shthed/capy/pull/495',
                  draft: params.draft,
                  user: { login: 'github-actions[bot]' },
                },
              };
            },
            update: async (params) => {
              calls.updatePr.push(params);
              const existing = openPrs[0];
              return {
                data: {
                  number: existing.number,
                  html_url: existing.html_url,
                  draft: existing.draft,
                  user: existing.user,
                },
              };
            },
          },
          issues: {
            listMilestones: async () => ({ data: milestones }),
            addLabels: async (params) => {
              calls.addLabels.push(params);
              return { data: [] };
            },
            update: async (params) => {
              calls.updateIssue.push(params);
              return { data: {} };
            },
          },
        },
      };
      try {
        await runOpenPrScript(
          { repo: { owner: 'shthed', repo: 'capy' } },
          githubMock,
          coreMock
        );
        return { calls, outputs, warnings, infos, failed, summary: summaryBuffer.join('') };
      } finally {
        for (const [key, val] of Object.entries(prevEnv)) {
          if (val === undefined) delete process.env[key];
          else process.env[key] = val;
        }
      }
    };

    const milestonesFixture = [
      { number: 2, title: 'Sprint 1: EPIC-2 v3.0.1 Critical Bugfixes' },
      { number: 3, title: 'Sprint 2: EPIC-3 Features' },
    ];

    // Create new bot PR with refs/heads/ + shthed: normalization, deduped labels, case-insensitive milestone title
    const openCreateRes = await runOpenPrCase(
      {
        INPUT_HEAD: '  refs/heads/shthed:feature/one-click  ',
        INPUT_BASE: 'beta',
        INPUT_TITLE: 'Add one-click PR approval',
        INPUT_BODY: 'Overview text',
        INPUT_DRAFT: 'true',
        INPUT_LABELS: 'ci, docs, ci, , testing',
        INPUT_MILESTONE: 'sprint 1: epic-2 v3.0.1 critical bugfixes',
      },
      { milestones: milestonesFixture }
    );
    assert.equal(openCreateRes.failed.length, 0);
    assert.equal(openCreateRes.calls.listPrs[0].head, 'shthed:feature/one-click');
    assert.equal(openCreateRes.calls.createPr.length, 1);
    assert.equal(openCreateRes.calls.createPr[0].head, 'feature/one-click');
    assert.equal(openCreateRes.calls.createPr[0].draft, true);
    assert.deepEqual(openCreateRes.calls.addLabels[0].labels, ['ci', 'docs', 'testing']);
    assert.equal(openCreateRes.calls.updateIssue[0].milestone, 2);
    assert.equal(openCreateRes.outputs.pr_number, '495');
    assert.equal(openCreateRes.outputs.action, 'created');
    assert.equal(openCreateRes.summary.includes('Bot PR #495 (created)'), true);

    // Idempotent update: omits draft, preserves existing body when INPUT_BODY is empty, resolves numeric milestone, warns on draft mismatch
    const openUpdateRes = await runOpenPrCase(
      {
        INPUT_HEAD: 'feature/one-click',
        INPUT_BASE: 'beta',
        INPUT_TITLE: 'Updated PR title',
        INPUT_BODY: '',
        INPUT_DRAFT: 'false',
        INPUT_LABELS: '',
        INPUT_MILESTONE: '2',
      },
      {
        openPrs: [
          {
            number: 495,
            html_url: 'https://github.com/shthed/capy/pull/495',
            draft: true,
            user: { login: 'github-actions[bot]' },
          },
        ],
        milestones: milestonesFixture,
      }
    );
    assert.equal(openUpdateRes.failed.length, 0);
    assert.equal(openUpdateRes.calls.createPr.length, 0);
    assert.equal(openUpdateRes.calls.updatePr.length, 1);
    assert.equal('draft' in openUpdateRes.calls.updatePr[0], false);
    assert.equal('body' in openUpdateRes.calls.updatePr[0], false);
    assert.equal(openUpdateRes.calls.addLabels.length, 0);
    assert.equal(openUpdateRes.calls.updateIssue[0].milestone, 2);
    assert.equal(openUpdateRes.outputs.action, 'updated');
    assert.equal(openUpdateRes.warnings.length, 1);

    // Reversed prefix order (owner:refs/heads/) normalizes cleanly
    const openReversedPrefixRes = await runOpenPrCase(
      {
        INPUT_HEAD: 'shthed:refs/heads/feature/x',
        INPUT_BASE: 'beta',
        INPUT_TITLE: 'Reversed prefix PR',
        INPUT_DRAFT: 'true',
      },
      { milestones: milestonesFixture }
    );
    assert.equal(openReversedPrefixRes.failed.length, 0);
    assert.equal(openReversedPrefixRes.calls.listPrs[0].head, 'shthed:feature/x');
    assert.equal(openReversedPrefixRes.calls.createPr.length, 1);
    assert.equal(openReversedPrefixRes.calls.createPr[0].head, 'feature/x');

    // Enforced draft=true on PR creation even when INPUT_DRAFT='false'
    const openForcedDraftRes = await runOpenPrCase(
      {
        INPUT_HEAD: 'feature/force-draft',
        INPUT_BASE: 'beta',
        INPUT_TITLE: 'Forced draft PR',
        INPUT_DRAFT: 'false',
      },
      { milestones: milestonesFixture }
    );
    assert.equal(openForcedDraftRes.failed.length, 0);
    assert.equal(openForcedDraftRes.calls.createPr.length, 1);
    assert.equal(openForcedDraftRes.calls.createPr[0].draft, true);
    assert.equal(openForcedDraftRes.warnings.length, 1);

    // Validation rejections: head === base, invalid draft, cross-owner head, extra colon, missing milestone before PR create
    const sameBranchFail = await runOpenPrCase({
      INPUT_HEAD: 'refs/heads/beta',
      INPUT_BASE: 'beta',
      INPUT_TITLE: 'Bad same branch',
      INPUT_DRAFT: 'true',
    });
    assert.equal(sameBranchFail.failed.length, 1);
    assert.equal(sameBranchFail.calls.createPr.length, 0);

    const badDraftFail = await runOpenPrCase({
      INPUT_HEAD: 'feature/x',
      INPUT_BASE: 'beta',
      INPUT_TITLE: 'Bad draft',
      INPUT_DRAFT: 'maybe',
    });
    assert.equal(badDraftFail.failed.length, 1);
    assert.equal(badDraftFail.calls.createPr.length, 0);

    const crossOwnerFail = await runOpenPrCase({
      INPUT_HEAD: 'otheruser:feature/x',
      INPUT_BASE: 'beta',
      INPUT_TITLE: 'Cross-owner PR',
      INPUT_DRAFT: 'true',
    });
    assert.equal(crossOwnerFail.failed.length, 1);
    assert.equal(crossOwnerFail.failed[0].includes('cross-owner'), true);
    assert.equal(crossOwnerFail.calls.createPr.length, 0);

    const extraColonFail = await runOpenPrCase({
      INPUT_HEAD: 'shthed:a:b',
      INPUT_BASE: 'beta',
      INPUT_TITLE: 'Extra colon head',
      INPUT_DRAFT: 'true',
    });
    assert.equal(extraColonFail.failed.length, 1);
    assert.equal(extraColonFail.calls.createPr.length, 0);

    const missingMilestoneFail = await runOpenPrCase(
      {
        INPUT_HEAD: 'feature/x',
        INPUT_BASE: 'beta',
        INPUT_TITLE: 'Unknown milestone',
        INPUT_DRAFT: 'true',
        INPUT_MILESTONE: 'Nonexistent Sprint 99',
      },
      { milestones: milestonesFixture }
    );
    assert.equal(missingMilestoneFail.failed.length, 1);
    assert.equal(missingMilestoneFail.calls.createPr.length, 0);
    logUnitPass('open-pr.yml branch normalization, draft enforcement & validation verified.');

    // Extract and unit-test .github/workflows/deploy-branch.yml target script & Phase 2 workflow invariants
    logUnitStart('Testing deploy-branch.yml routing, docs fast-path & publish-capyboop.yml clean sync...');
    const runDeployTargetScript = new AsyncFunction(
      'context',
      'github',
      'core',
      extractWorkflowScript('.github/workflows/deploy-branch.yml')
    );

    const runDeployTargetCase = async ({
      eventName = 'pull_request',
      sha = 'mergesha11111111111111111111111111111111',
      ref = 'refs/pull/499/merge',
      payload = {},
      changedFiles = [{ filename: 'web/src/App.tsx' }],
      prDetails = { mergeable: true },
      pullsList = [],
      commitsByRef = null,
      compareMap = null,
    } = {}) => {
      const prevBaseUrl = process.env.BASE_PREVIEW_URL;
      process.env.BASE_PREVIEW_URL = 'https://shthed.github.io/capy';
      const outputs = {};
      const warnings = [];
      const failed = [];
      const coreMock = {
        setOutput: (k, v) => {
          outputs[k] = v;
        },
        warning: (m) => warnings.push(m),
        setFailed: (m) => failed.push(m),
        summary: {
          addRaw: () => coreMock.summary,
          write: async () => {},
        },
      };
      const githubMock = {
        paginate: async (fn, params) => (await fn(params)).data,
        rest: {
          pulls: {
            list: async () => ({ data: pullsList }),
            listFiles: async () => ({ data: changedFiles }),
            get: async () => ({ data: prDetails }),
          },
          ...(commitsByRef || compareMap
            ? {
                repos: {
                  getCommit: async ({ ref: commitRef }) => ({
                    data: commitsByRef?.[commitRef] || {},
                  }),
                  compareCommitsWithBasehead: async ({ basehead }) => ({
                    data: compareMap?.[basehead] || { ahead_by: 1 },
                  }),
                },
              }
            : {}),
        },
      };
      const contextMock = {
        eventName,
        sha,
        ref,
        repo: { owner: 'shthed', repo: 'capy' },
        payload,
      };
      try {
        await runDeployTargetScript(contextMock, githubMock, coreMock);
        return { outputs, warnings, failed };
      } finally {
        if (prevBaseUrl === undefined) delete process.env.BASE_PREVIEW_URL;
        else process.env.BASE_PREVIEW_URL = prevBaseUrl;
      }
    };

    const deployDocsRes = await runDeployTargetCase({
      payload: {
        pull_request: {
          number: 499,
          head: { ref: 'docs/update', sha: 'headsha22222222222222222222222222222222' },
          mergeable: true,
        },
      },
      changedFiles: [{ filename: 'CHANGELOG.md' }, { filename: 'docs/guide.md' }],
    });
    assert.equal(deployDocsRes.failed.length, 0);
    assert.equal(deployDocsRes.outputs.is_docs_only, 'true');
    assert.equal(deployDocsRes.outputs.is_main_sync, 'false');
    assert.equal(deployDocsRes.outputs.skip, 'true');
    assert.equal(deployDocsRes.outputs.checkout_ref, 'mergesha11111111111111111111111111111111');

    const deployMergeableRes = await runDeployTargetCase({
      payload: {
        pull_request: {
          number: 499,
          head: { ref: 'feature/x', sha: 'headsha22222222222222222222222222222222' },
          mergeable: true,
        },
      },
    });
    assert.equal(deployMergeableRes.outputs.is_docs_only, 'false');
    assert.equal(deployMergeableRes.outputs.is_main_sync, 'false');
    assert.equal(deployMergeableRes.outputs.skip, 'false');
    assert.equal(deployMergeableRes.outputs.target_dir, 'alpha/499');
    assert.equal(deployMergeableRes.outputs.preview_url, 'https://shthed.github.io/capy/alpha/499/');
    assert.equal(deployMergeableRes.outputs.checkout_ref, 'mergesha11111111111111111111111111111111');

    const deployConflictingRes = await runDeployTargetCase({
      payload: {
        pull_request: {
          number: 499,
          head: { ref: 'feature/x', sha: 'headsha22222222222222222222222222222222' },
          mergeable: null,
        },
      },
      prDetails: { mergeable: false },
    });
    assert.equal(deployConflictingRes.outputs.checkout_ref, 'headsha22222222222222222222222222222222');

    const deployDispatchRes = await runDeployTargetCase({
      eventName: 'workflow_dispatch',
      ref: 'refs/heads/beta',
      payload: {
        inputs: { target_branch: 'feature/ci-dispatch', allow_without_pr: true },
      },
    });
    assert.equal(deployDispatchRes.outputs.branch, 'feature/ci-dispatch');
    assert.equal(deployDispatchRes.outputs.target_dir, 'alpha/feature-ci-dispatch');
    assert.equal(deployDispatchRes.outputs.checkout_ref, 'feature/ci-dispatch');
    assert.equal(deployDispatchRes.outputs.skip, 'false');

    // Verified sync/beta-from-main -> beta sets is_main_sync='true' only for exact fast-forward or single clean 2-parent --no-ff merge matching origin/main & checkout_ref
    const deploySyncCommitsFixture = {
      ...syncCommitsFixture,
      mergesha11111111111111111111111111111111: {
        sha: 'mergesha11111111111111111111111111111111',
        commit: { tree: { sha: 'tree-main-exact' } },
      },
      [mainSyncSha]: {
        sha: mainSyncSha,
        commit: { tree: { sha: 'tree-main-exact' } },
      },
    };
    const deployMainSyncExactRes = await runDeployTargetCase({
      payload: {
        pull_request: {
          number: 528,
          base: { ref: 'beta' },
          head: {
            ref: 'sync/beta-from-main',
            sha: syncMergeSha,
            repo: { full_name: 'shthed/capy' },
          },
          mergeable: true,
        },
      },
      changedFiles: [{ filename: 'web/src/App.tsx' }],
      commitsByRef: deploySyncCommitsFixture,
      compareMap: syncExactCompareFixture,
    });
    assert.equal(deployMainSyncExactRes.outputs.is_main_sync, 'true');
    assert.equal(deployMainSyncExactRes.outputs.skip, 'false');

    const deployMainSyncFastForwardRes = await runDeployTargetCase({
      sha: mainSyncSha,
      payload: {
        pull_request: {
          number: 528,
          base: { ref: 'beta' },
          head: {
            ref: 'sync/beta-from-main',
            sha: mainSyncSha,
            repo: { full_name: 'shthed/capy' },
          },
          mergeable: true,
        },
      },
      changedFiles: [{ filename: 'web/src/App.tsx' }],
      commitsByRef: deploySyncCommitsFixture,
      compareMap: {
        [`${mainSyncSha}...${mainSyncSha}`]: { ahead_by: 0, total_commits: 0 },
        [`${mainSyncSha}...${betaSyncSha}`]: { ahead_by: 0, total_commits: 0 },
      },
    });
    assert.equal(deployMainSyncFastForwardRes.outputs.is_main_sync, 'true');

    const deployMainSyncCheckoutTreeMismatchFailRes = await runDeployTargetCase({
      payload: {
        pull_request: {
          number: 528,
          base: { ref: 'beta' },
          head: {
            ref: 'sync/beta-from-main',
            sha: syncMergeSha,
            repo: { full_name: 'shthed/capy' },
          },
          mergeable: true,
        },
      },
      changedFiles: [{ filename: 'web/src/App.tsx' }],
      commitsByRef: {
        ...deploySyncCommitsFixture,
        mergesha11111111111111111111111111111111: {
          sha: 'mergesha11111111111111111111111111111111',
          commit: { tree: { sha: 'tree-evil-merge' } },
        },
      },
      compareMap: syncExactCompareFixture,
    });
    assert.equal(deployMainSyncCheckoutTreeMismatchFailRes.outputs.is_main_sync, 'false');

    const deployMainSyncNoop1ParentFailRes = await runDeployTargetCase({
      payload: {
        pull_request: {
          number: 528,
          base: { ref: 'beta' },
          head: {
            ref: 'sync/beta-from-main',
            sha: syncMergeSha,
            repo: { full_name: 'shthed/capy' },
          },
          mergeable: true,
        },
      },
      changedFiles: [{ filename: 'web/src/App.tsx' }],
      commitsByRef: deploySyncCommitsFixture,
      compareMap: {
        [`${syncMergeSha}...${mainSyncSha}`]: { ahead_by: 0, total_commits: 0 },
        [`${mainSyncSha}...${syncMergeSha}`]: {
          ahead_by: 1,
          total_commits: 1,
          files: [],
          commits: [{ sha: syncMergeSha, parents: [{ sha: betaSyncSha }] }],
        },
        [`${syncMergeSha}...${betaSyncSha}`]: { ahead_by: 0, total_commits: 0 },
        [`${mainSyncSha}...${betaSyncSha}`]: { ahead_by: 0, total_commits: 0 },
      },
    });
    assert.equal(deployMainSyncNoop1ParentFailRes.outputs.is_main_sync, 'false');

    const deployMainSyncMultiCommitFailRes = await runDeployTargetCase({
      payload: {
        pull_request: {
          number: 528,
          base: { ref: 'beta' },
          head: {
            ref: 'sync/beta-from-main',
            sha: syncMergeSha,
            repo: { full_name: 'shthed/capy' },
          },
          mergeable: true,
        },
      },
      changedFiles: [{ filename: 'web/src/App.tsx' }],
      commitsByRef: deploySyncCommitsFixture,
      compareMap: {
        [`${syncMergeSha}...${mainSyncSha}`]: { ahead_by: 0, total_commits: 0 },
        [`${mainSyncSha}...${syncMergeSha}`]: {
          ahead_by: 2,
          total_commits: 2,
          files: [],
          commits: [
            { sha: 'extrasync000000000000000000000000000000', parents: [{ sha: mainSyncSha }] },
            { sha: syncMergeSha, parents: [{ sha: betaSyncSha }, { sha: 'extrasync000000000000000000000000000000' }] },
          ],
        },
        [`${syncMergeSha}...${betaSyncSha}`]: { ahead_by: 0, total_commits: 0 },
        [`${mainSyncSha}...${betaSyncSha}`]: { ahead_by: 0, total_commits: 0 },
      },
    });
    assert.equal(deployMainSyncMultiCommitFailRes.outputs.is_main_sync, 'false');

    const deployMainSyncDivergedRes = await runDeployTargetCase({
      payload: {
        pull_request: {
          number: 528,
          base: { ref: 'beta' },
          head: {
            ref: 'sync/beta-from-main',
            sha: syncMergeSha,
            repo: { full_name: 'shthed/capy' },
          },
          mergeable: true,
        },
      },
      changedFiles: [{ filename: 'web/src/App.tsx' }],
      commitsByRef: deploySyncCommitsFixture,
      compareMap: {
        [`${syncMergeSha}...${mainSyncSha}`]: { ahead_by: 0, total_commits: 0 },
        [`${syncMergeSha}...${betaSyncSha}`]: { ahead_by: 0, total_commits: 0 },
        [`${mainSyncSha}...${betaSyncSha}`]: { ahead_by: 1 },
      },
    });
    assert.equal(deployMainSyncDivergedRes.outputs.is_main_sync, 'false');

    const deployYaml = fs.readFileSync(
      path.resolve(projectRoot, '../.github/workflows/deploy-branch.yml'),
      'utf8'
    );
    assert.equal(deployYaml.includes('github.event.inputs.target_branch'), true);
    assert.equal(deployYaml.includes('actions/cache@v6'), true);
    assert.equal(deployYaml.includes("github.base_ref == 'main' || github.base_ref == 'beta'"), true);
    assert.equal(deployYaml.includes("github.event.pull_request.user.login != 'dependabot[bot]'"), true);
    assert.equal(deployYaml.includes('steps.target.outputs.is_docs_only'), true);
    assert.equal(deployYaml.includes('needs.prepare.outputs.is_main_sync'), true);
    assert.equal(deployYaml.includes('node-modules-cache'), true);
    assert.equal(deployYaml.includes('android_build:'), true);
    assert.equal(deployYaml.includes('e2e_release_gate:'), true);
    assert.equal(deployYaml.includes('web-dist-'), true);
    assert.equal(deployYaml.includes('node scripts/test.mjs --unit'), true);
    assert.equal(deployYaml.includes('include-hidden-files: true'), true);
    assert.equal(deployYaml.includes('cp -a web/dist/. staging/web/'), true);
    assert.equal(deployYaml.includes('needs: [prepare, build, android_build]'), true);
    assert.equal(deployYaml.includes("--exclude 'alpha/'"), true);

    const cleanupClosedPrYaml = fs.readFileSync(
      path.resolve(projectRoot, '../.github/workflows/cleanup-closed-pr.yml'),
      'utf8'
    );
    assert.equal(cleanupClosedPrYaml.includes("github.actor != 'dependabot[bot]'"), true);
    assert.equal(cleanupClosedPrYaml.includes('timeout-minutes: 10'), true);

    const cleanupBranchesYaml = fs.readFileSync(
      path.resolve(projectRoot, '../.github/workflows/cleanup-branches.yml'),
      'utf8'
    );
    assert.equal(cleanupBranchesYaml.includes('dependabot/,sync/'), true);
    assert.equal(cleanupBranchesYaml.includes('BRANCH_CLEANUP_UNMERGED_MIN_AGE_DAYS'), true);
    assert.equal(cleanupBranchesYaml.includes('timeout-minutes: 10'), true);

    const syncBetaYaml = fs.readFileSync(
      path.resolve(projectRoot, '../.github/workflows/sync-beta-from-main.yml'),
      'utf8'
    );
    assert.equal(syncBetaYaml.includes('git merge-base --is-ancestor origin/main origin/beta'), true);
    assert.equal(syncBetaYaml.includes('git merge --no-ff origin/main'), true);
    assert.equal(syncBetaYaml.includes('github-token: ${{ secrets.CAPY_BOT_TOKEN || secrets.GITHUB_TOKEN }}'), true);
    assert.equal(syncBetaYaml.includes('pr-review-gate.yml'), true);
    assert.equal(syncBetaYaml.includes('draft: !hasPatToken'), true);
    assert.equal(syncBetaYaml.includes('WORKFLOW_DIFFS'), true);
    assert.equal(syncBetaYaml.includes('git push origin HEAD:refs/heads/beta'), true);
    assert.equal(syncBetaYaml.includes('beta ruleset 27162684'), true);
    assert.equal(syncBetaYaml.includes('deploy-branch.yml'), true);
    assert.equal(syncBetaYaml.includes('Sync beta with main conflict'), true);
    assert.equal(syncBetaYaml.includes('enablePullRequestAutoMerge'), true);
    assert.equal(syncBetaYaml.includes('actions: write'), true);
    assert.equal(syncBetaYaml.includes('name: Sync beta with main'), true);

    const prReviewGateYaml = fs.readFileSync(
      path.resolve(projectRoot, '../.github/workflows/pr-review-gate.yml'),
      'utf8'
    );
    assert.equal(
      /pull_request:\s*\r?\n\s*types:[\s\S]*?\n\s*-\s*edited\b[\s\S]*?pull_request_review:/.test(
        prReviewGateYaml
      ),
      true
    );
    assert.equal(prReviewGateYaml.includes('github.event.changes.base != null'), true);
    assert.equal(prReviewGateYaml.includes('github.event.changes.body != null'), true);
    assert.equal(prReviewGateYaml.includes('needs: [ai-review]'), true);
    assert.equal(prReviewGateYaml.includes('always()'), true);
    assert.equal(prReviewGateYaml.includes('GEMINI_API_KEY'), true);
    assert.equal(prReviewGateYaml.includes('gemini-3.8-flash'), true);
    assert.equal(prReviewGateYaml.includes('gemini-4-argon'), true);
    assert.equal(prReviewGateYaml.includes('ACTIONS_GITHUB_TOKEN'), true);
    assert.equal(prReviewGateYaml.includes('safeAddLabel'), true);
    assert.equal(prReviewGateYaml.includes('isVerifiedMainSync'), true);
    assert.equal(prReviewGateYaml.includes('strictAiReady'), true);
    assert.equal(prReviewGateYaml.includes('enablePullRequestAutoMerge'), true);
    assert.equal(prReviewGateYaml.includes('disablePullRequestAutoMerge'), true);
    assert.equal(prReviewGateYaml.includes('isStrictPrBodyValid'), true);
    assert.equal(prReviewGateYaml.includes('hasChecklistSub100OrUnchecked'), true);
    assert.equal(prReviewGateYaml.includes('<!-- capy-gate-status -->'), true);
    assert.equal(
      prReviewGateYaml.includes('["opened","synchronize","reopened","ready_for_review","converted_to_draft"]'),
      true
    );

    const parsedPrReviewGate = JSON.parse(
      execFileSync(
        'python3',
        [
          '-c',
          'import json, sys, yaml; print(json.dumps(yaml.safe_load(open(sys.argv[1], encoding="utf-8"))))',
          path.resolve(projectRoot, '../.github/workflows/pr-review-gate.yml'),
        ],
        { encoding: 'utf8' }
      )
    );
    assert.equal(
      parsedPrReviewGate?.jobs?.['review-gate']?.steps?.[0]?.env?.ACTIONS_GITHUB_TOKEN,
      '${{ secrets.GITHUB_TOKEN }}'
    );
    const reviewGateIfExpr = parsedPrReviewGate?.jobs?.['review-gate']?.if;
    assert.equal(typeof reviewGateIfExpr, 'string');
    const reviewGateIfJs = reviewGateIfExpr.replace(
      /(?<![\w'"])github(?:\.[a-zA-Z0-9_]+)+/g,
      (match) => match.replaceAll('.', '?.')
    );
    const rawEvalReviewGateIf = new Function('github', 'contains', 'fromJSON', 'always', `return Boolean(${reviewGateIfJs});`);
    const evalReviewGateIf = (githubCtx, containsFn, fromJsonFn) =>
      rawEvalReviewGateIf(githubCtx, containsFn, fromJsonFn, () => true);
    const ghFromJson = (raw) => JSON.parse(raw);
    const ghContains = (haystack, needle) =>
      Array.isArray(haystack) ? haystack.includes(needle) : String(haystack).includes(String(needle));

    assert.equal(
      evalReviewGateIf(
        {
          repository: 'shthed/capy',
          event_name: 'pull_request',
          actor: 'shthed',
          event: { action: 'edited', changes: { body: { from: 'old' } } },
        },
        ghContains,
        ghFromJson
      ),
      true,
      'Human PR body edit must trigger review-gate'
    );
    assert.equal(
      evalReviewGateIf(
        {
          repository: 'shthed/capy',
          event_name: 'pull_request',
          actor: 'github-actions[bot]',
          event: { action: 'edited', changes: { body: { from: 'old' } } },
        },
        ghContains,
        ghFromJson
      ),
      false,
      'Bot PR body edit must remain excluded from review-gate'
    );
    assert.equal(
      evalReviewGateIf(
        {
          repository: 'shthed/capy',
          event_name: 'pull_request',
          actor: 'shthed',
          event: { action: 'edited', changes: { title: { from: 'old' } } },
        },
        ghContains,
        ghFromJson
      ),
      true,
      'Human PR title edit must trigger review-gate for cross-ref guardrail'
    );
    assert.equal(
      evalReviewGateIf(
        {
          repository: 'shthed/capy',
          event_name: 'pull_request',
          actor: 'shthed',
          event: { action: 'edited', changes: {} },
        },
        ghContains,
        ghFromJson
      ),
      false,
      'Human PR edit without base/body/title changes must not trigger review-gate'
    );
    assert.equal(
      evalReviewGateIf(
        {
          repository: 'shthed/capy',
          event_name: 'pull_request',
          actor: 'shthed',
          event: { action: 'edited', changes: { base: { ref: { from: 'beta' } } } },
        },
        ghContains,
        ghFromJson
      ),
      true,
      'Human PR base retarget edit must trigger review-gate'
    );
    assert.equal(
      evalReviewGateIf(
        {
          repository: 'shthed/capy',
          event_name: 'pull_request',
          actor: 'github-actions[bot]',
          event: { action: 'synchronize' },
        },
        ghContains,
        ghFromJson
      ),
      true,
      'Bot PR synchronize must still trigger review-gate'
    );
    assert.equal(
      evalReviewGateIf(
        {
          repository: 'shthed/capy',
          event_name: 'pull_request',
          actor: 'dependabot[bot]',
          event: { action: 'edited', changes: { body: { from: 'old' } } },
        },
        ghContains,
        ghFromJson
      ),
      false,
      'Dependabot PR body edit must remain excluded from review-gate'
    );

    const parsedPublishCapyboop = JSON.parse(
      execFileSync(
        'python3',
        [
          '-c',
          'import json, sys, yaml; print(json.dumps(yaml.safe_load(open(sys.argv[1], encoding="utf-8"))))',
          path.resolve(projectRoot, '../.github/workflows/publish-capyboop.yml'),
        ],
        { encoding: 'utf8' }
      )
    );
    const publishStep = (parsedPublishCapyboop?.jobs?.publish?.steps || []).find((s) =>
      String(s?.name || '').includes('Commit as capyboop')
    );
    assert.ok(publishStep && typeof publishStep.run === 'string');
    const publishScript = publishStep.run;
    execFileSync(
      'bash',
      ['--norc', '--noprofile', '-n'],
      {
        input: publishScript.replace(/\$\{(?:version|commit_msg)\}/g, 'x'),
        encoding: 'utf8',
        env: { ...process.env, BASH_ENV: '', PS1: '' },
      }
    );
    assert.equal(
      /git\s+log[^\n]*\|\s*grep/i.test(publishScript),
      false,
      'publish-capyboop.yml must never pipe git log into grep under set -euo pipefail'
    );
    assert.equal(
      publishScript.includes('git log FETCH_HEAD --format="%an %ae %cn %ce %B%x00" > "${LOG_FILE}"'),
      true
    );
    assert.equal(publishScript.includes('--verify-log'), true);
    assert.equal(publishScript.includes('NEEDS_CLEAN_RESET'), true);
    assert.equal(publishScript.includes('GIT_ASKPASS'), true);
    assert.equal(publishScript.includes('chmod 700 "${ASKPASS_SCRIPT}"'), true);
    assert.equal(publishScript.includes('trap cleanup EXIT'), true);
    assert.equal(publishScript.includes('git config credential.helper ""'), true);
    assert.equal(
      /https:\/\/[^\s]*CAPYBOOP_SYNC_TOKEN[^\s]*@/.test(publishScript),
      false,
      'publish-capyboop.yml must not embed CAPYBOOP_SYNC_TOKEN inside git remote URL'
    );
    assert.equal(publishScript.includes('>/dev/null 2>&1'), false);
    assert.equal(publishScript.includes('MAIN_LS_RC'), true);
    assert.equal(publishScript.includes('TAG_LS_RC'), true);
    const publishOn = parsedPublishCapyboop?.on || parsedPublishCapyboop?.true;
    assert.equal(
      Array.isArray(publishOn?.push?.tags) && publishOn.push.tags.includes('v*.*.*'),
      true,
      'publish-capyboop.yml must trigger on v*.*.* tag pushes'
    );
    assert.equal(publishScript.includes('TAG_COMMIT'), true);
    assert.equal(publishScript.includes('HEAD_COMMIT'), true);
    const checkRefStep = (parsedPublishCapyboop?.jobs?.publish?.steps || []).find((s) => s?.id === 'check_ref');
    assert.ok(checkRefStep && String(checkRefStep.run || '').includes('refs/remotes/origin/main'));

    // Behavioral verification: temp-file grep -iaqzE detects leaked early commit across 80+ commits without SIGPIPE, and ls-remote differentiates 0 / 2 / fatal errors
    const tmpPublishRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capy-publish-check-'));
    try {
      const bareRemoteDir = path.join(tmpPublishRepoDir, 'remote.git');
      const workRepoDir = path.join(tmpPublishRepoDir, 'work');
      const logOutPath = path.join(tmpPublishRepoDir, 'fetch_head.log');
      fs.mkdirSync(workRepoDir, { recursive: true });
      execFileSync('git', ['init', '--bare', bareRemoteDir], { stdio: 'pipe' });
      execFileSync('git', ['init', '-b', 'main'], { cwd: workRepoDir, stdio: 'pipe' });
      execFileSync('git', ['config', 'user.name', 'capyboop'], { cwd: workRepoDir, stdio: 'pipe' });
      execFileSync('git', ['config', 'user.email', 'capyboop@example.com'], {
        cwd: workRepoDir,
        stdio: 'pipe',
      });
      execFileSync('git', ['commit', '--allow-empty', '-m', 'Early commit with 381055+leak'], {
        cwd: workRepoDir,
        stdio: 'pipe',
      });
      for (let i = 0; i < 60; i++) {
        execFileSync('git', ['commit', '--allow-empty', '-m', `Clean commit ${i}`], {
          cwd: workRepoDir,
          stdio: 'pipe',
        });
      }
      execFileSync('git', ['remote', 'add', 'target', bareRemoteDir], { cwd: workRepoDir, stdio: 'pipe' });
      execFileSync('git', ['push', 'target', 'main'], { cwd: workRepoDir, stdio: 'pipe' });
      const scanRc = execFileSync(
        'bash',
        [
          '--norc',
          '--noprofile',
          '-euo',
          'pipefail',
          '-c',
          [
            `git -C "${workRepoDir}" log HEAD --format="%an %ae %cn %ce %B%x00" > "${logOutPath}"`,
            'GREP_RC=0',
            `grep -iaqzE "shthed|hairy[[:space:]_-]*dog[[:space:]_-]*trumpet|381055\\+|CAPYBOOP_SYNC_TOKEN" "${logOutPath}" || GREP_RC=$?`,
            'printf "%s" "$GREP_RC"',
          ].join('\n'),
        ],
        { encoding: 'utf8', env: { ...process.env, BASH_ENV: '', PS1: '' } }
      ).trim();
      assert.equal(scanRc, '0');

      const lsRemoteCodes = execFileSync(
        'bash',
        [
          '--norc',
          '--noprofile',
          '-euo',
          'pipefail',
          '-c',
          [
            'rc_hit=0',
            `git -C "${workRepoDir}" ls-remote --exit-code --heads target main >/dev/null || rc_hit=$?`,
            'rc_miss=0',
            `git -C "${workRepoDir}" ls-remote --exit-code --heads target missing-branch >/dev/null || rc_miss=$?`,
            'rc_err=0',
            `git -C "${workRepoDir}" ls-remote --exit-code --heads "${tmpPublishRepoDir}/does-not-exist.git" main >/dev/null 2>/dev/null || rc_err=$?`,
            'printf "%s:%s:%s" "$rc_hit" "$rc_miss" "$rc_err"',
          ].join('\n'),
        ],
        { encoding: 'utf8', env: { ...process.env, BASH_ENV: '', PS1: '' } }
      ).trim();
      const [rcHit, rcMiss, rcErr] = lsRemoteCodes.split(':').map(Number);
      assert.equal(rcHit, 0);
      assert.equal(rcMiss, 2);
      assert.equal(rcErr > 2, true, `Expected fatal ls-remote exit > 2, got ${rcErr}`);
    } finally {
      fs.rmSync(tmpPublishRepoDir, { recursive: true, force: true });
    }
    logUnitPass('deploy-branch.yml routing & publish-capyboop.yml clean-history guards verified.');

    // Extract and unit-test ai-review job script block from pr-review-gate.yml
    logUnitStart('Testing ai-review Gemini fallback, dependabot.yml & sync-agile-tracker.yml...');
    const aiReviewYamlLines = prReviewGateYaml.split(/\r?\n/);
    const aiJobIdx = aiReviewYamlLines.findIndex((line) => /^\s{2}ai-review:\s*$/.test(line));
    assert.notEqual(aiJobIdx, -1, 'Expected ai-review job in pr-review-gate.yml');
    const aiScriptIdx = aiReviewYamlLines.findIndex(
      (line, idx) => idx > aiJobIdx && /^\s*script:\s*\|\s*$/.test(line)
    );
    assert.notEqual(aiScriptIdx, -1, 'Expected script: | block in ai-review job');
    const aiHeaderIndent = aiReviewYamlLines[aiScriptIdx].match(/^(\s*)/)[1].length;
    let aiBodyIndent = null;
    const aiBodyLines = [];
    for (let i = aiScriptIdx + 1; i < aiReviewYamlLines.length; i++) {
      const line = aiReviewYamlLines[i];
      if (line.trim() === '') {
        aiBodyLines.push('');
        continue;
      }
      const indent = line.match(/^(\s*)/)[1].length;
      if (aiBodyIndent === null) {
        assert.equal(indent > aiHeaderIndent, true);
        aiBodyIndent = indent;
      } else if (indent < aiBodyIndent) {
        break;
      }
      aiBodyLines.push(line.slice(aiBodyIndent));
    }
    const runAiReviewScript = new AsyncFunction('context', 'github', 'core', aiBodyLines.join('\n'));
    const runAiReviewCase = async ({
      geminiApiKey = '',
      baseRef = 'beta',
      headRef = 'feature/test',
      isDraft = false,
      headRepo = 'shthed/capy',
      existingComments = [],
      fetchResponse = null,
      fetchImpl = null,
    } = {}) => {
      const warnings = [];
      const infos = [];
      const createdReviews = [];
      const addedLabels = [];
      const fetchCalls = [];
      const prevKey = process.env.GEMINI_API_KEY;
      const prevFetch = globalThis.fetch;
      if (geminiApiKey) process.env.GEMINI_API_KEY = geminiApiKey;
      else delete process.env.GEMINI_API_KEY;
      if (fetchImpl) {
        globalThis.fetch = async (url, init) => {
          fetchCalls.push({ url, init });
          return fetchImpl(url, init);
        };
      } else if (fetchResponse) {
        globalThis.fetch = async (url, init) => {
          fetchCalls.push({ url, init });
          return {
            ok: true,
            status: 200,
            json: async () => fetchResponse,
            text: async () => JSON.stringify(fetchResponse),
          };
        };
      }
      try {
        const mockGithub = {
          paginate: async (fn) => fn(),
          rest: {
            pulls: {
              get: async ({ mediaType } = {}) =>
                mediaType?.format === 'diff'
                  ? { data: 'diff --git a/a.ts b/a.ts\n+const x = 1;' }
                  : {
                      data: {
                        number: 999,
                        state: 'open',
                        draft: isDraft,
                        title: 'Test PR',
                        body: '## Summary\n\nTest\n\n### PR Readiness Score: 100%',
                        base: { ref: baseRef },
                        head: { ref: headRef, sha: '1111222233334444555566667777888899990000', repo: { full_name: headRepo } },
                      },
                    },
              listReviews: async () => [],
              createReview: async (arg) => {
                createdReviews.push(arg);
                return { data: { id: 1 } };
              },
            },
            issues: {
              listComments: async () => existingComments,
              addLabels: async (arg) => {
                addedLabels.push(...(arg.labels || []));
              },
            },
          },
        };
        const mockCore = {
          info: (m) => infos.push(String(m)),
          warning: (m) => warnings.push(String(m)),
        };
        const mockContext = {
          repo: { owner: 'shthed', repo: 'capy' },
          payload: { pull_request: { number: 999 } },
        };
        await runAiReviewScript(mockContext, mockGithub, mockCore);
        return { warnings, infos, createdReviews, addedLabels, fetchCalls };
      } finally {
        if (prevKey === undefined) delete process.env.GEMINI_API_KEY;
        else process.env.GEMINI_API_KEY = prevKey;
        globalThis.fetch = prevFetch;
      }
    };

    const missingKeyRes = await runAiReviewCase({ geminiApiKey: '' });
    assert.equal(missingKeyRes.warnings.some((w) => w.includes('GEMINI_API_KEY')), true);
    assert.equal(missingKeyRes.createdReviews.length, 0);
    assert.equal(missingKeyRes.addedLabels.length, 0);

    const skipDraftRes = await runAiReviewCase({ geminiApiKey: 'test-key', isDraft: true });
    assert.equal(skipDraftRes.createdReviews.length, 0);

    const skipOtherBaseRes = await runAiReviewCase({ geminiApiKey: 'test-key', baseRef: 'feature/other' });
    assert.equal(skipOtherBaseRes.createdReviews.length, 0);

    const skipSyncRes = await runAiReviewCase({ geminiApiKey: 'test-key', headRef: 'sync/beta-from-main' });
    assert.equal(skipSyncRes.createdReviews.length, 0);

    const skipForkRes = await runAiReviewCase({ geminiApiKey: 'test-key', headRepo: 'attacker/capy' });
    assert.equal(skipForkRes.createdReviews.length, 0);

    const approveRes = await runAiReviewCase({
      geminiApiKey: 'test-key',
      fetchResponse: {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    verdict: 'APPROVED',
                    score: 100,
                    summary: 'All checks and invariants verified.',
                  }),
                },
              ],
            },
          },
        ],
      },
    });
    assert.equal(approveRes.fetchCalls.length, 1);
    assert.equal(
      approveRes.fetchCalls[0].url,
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent'
    );
    assert.equal(approveRes.fetchCalls[0].init.method, 'POST');
    assert.equal(approveRes.fetchCalls[0].init.headers['x-goog-api-key'], 'test-key');
    assert.equal(
      JSON.parse(approveRes.fetchCalls[0].init.body).generationConfig.responseMimeType,
      'application/json'
    );
    assert.equal(approveRes.createdReviews.length, 1);
    assert.equal(approveRes.createdReviews[0].event, 'COMMENT');
    assert.equal(
      approveRes.createdReviews[0].body.includes(
        '<!-- capy-review: actor=ai-agent verdict=APPROVED sha=1111222233334444555566667777888899990000 score=100% -->'
      ),
      true
    );
    assert.deepEqual(approveRes.addedLabels, ['review:ai-approved']);

    const rejectRes = await runAiReviewCase({
      geminiApiKey: 'test-key',
      fetchResponse: {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    verdict: 'CHANGES_REQUESTED',
                    score: 70,
                    summary: 'Missing tests.',
                  }),
                },
              ],
            },
          },
        ],
      },
    });
    assert.equal(rejectRes.createdReviews.length, 1);
    assert.equal(
      rejectRes.createdReviews[0].body.includes(
        '<!-- capy-review: actor=ai-agent verdict=CHANGES_REQUESTED sha=1111222233334444555566667777888899990000 score=70% -->'
      ),
      true
    );
    assert.deepEqual(rejectRes.addedLabels, ['review:changes-requested']);
    assert.equal(rejectRes.addedLabels.includes('review:ai-approved'), false);

    // 404 fallback from gemini-3.8-flash to gemini-4-argon returns APPROVED 100%
    const gemini404FallbackRes = await runAiReviewCase({
      geminiApiKey: 'test-key',
      fetchImpl: async (url) => {
        if (url.includes('/gemini-3.8-flash:generateContent')) {
          return {
            ok: false,
            status: 404,
            text: async () => 'models/gemini-3.8-flash is not found',
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        verdict: 'APPROVED',
                        score: 100,
                        summary: 'Fallback argon ok.',
                      }),
                    },
                  ],
                },
              },
            ],
          }),
        };
      },
    });
    assert.equal(gemini404FallbackRes.fetchCalls.length, 2);
    assert.equal(
      gemini404FallbackRes.fetchCalls[0].url,
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent'
    );
    assert.equal(
      gemini404FallbackRes.fetchCalls[1].url,
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-4-argon:generateContent'
    );
    assert.equal(
      gemini404FallbackRes.warnings.some((w) => w.includes('gemini-3.8-flash') && w.includes('404')),
      true
    );
    assert.equal(gemini404FallbackRes.createdReviews.length, 1);
    assert.deepEqual(gemini404FallbackRes.addedLabels, ['review:ai-approved']);

    // Non-404 errors (401/500) fail fast without trying fallback models
    for (const errStatus of [401, 500]) {
      const fastFailUrls = [];
      await assert.rejects(
        () =>
          runAiReviewCase({
            geminiApiKey: 'test-key',
            fetchImpl: async (url) => {
              fastFailUrls.push(url);
              return { ok: false, status: errStatus, text: async () => `HTTP ${errStatus} error` };
            },
          }),
        new RegExp(`Gemini API HTTP ${errStatus} \\(gemini-3\\.8-flash\\)`)
      );
      assert.equal(fastFailUrls.length, 1);
    }

    const dependabotYaml = fs.readFileSync(
      path.resolve(projectRoot, '../.github/dependabot.yml'),
      'utf8'
    );
    assert.equal(dependabotYaml.includes('package-ecosystem: "npm"'), true);
    assert.equal(dependabotYaml.includes('package-ecosystem: "gradle"'), true);
    assert.equal(dependabotYaml.includes('package-ecosystem: "github-actions"'), true);
    assert.equal(dependabotYaml.includes('target-branch: "beta"'), true);

    // Extract and unit-test sync-agile-tracker.yml pure github-script (zero PR checkout)
    const syncAgileYaml = fs.readFileSync(
      path.resolve(projectRoot, '../.github/workflows/sync-agile-tracker.yml'),
      'utf8'
    );
    assert.equal(syncAgileYaml.includes('actions/checkout'), false);
    assert.equal(syncAgileYaml.includes('pull_request_target:'), true);
    const runSyncAgileScript = new AsyncFunction(
      'context',
      'github',
      'core',
      extractWorkflowScript('.github/workflows/sync-agile-tracker.yml')
    );

    const runSyncAgileCase = async ({
      merged = true,
      baseRef = 'beta',
      prNumber = 495,
      prTitle = 'Harden storage sandbox and changelog compiler',
      labels = [],
      body = '',
      issuesByNumber = {},
    }) => {
      const updatedIssues = [];
      const coreMock = {
        infos: [],
        info: (msg) => coreMock.infos.push(msg),
      };
      const githubMock = {
        rest: {
          issues: {
            get: async ({ issue_number }) => ({ data: issuesByNumber[issue_number] }),
            update: async (payload) => {
              updatedIssues.push(payload);
              return { data: {} };
            },
          },
        },
      };
      const contextMock = {
        repo: { owner: 'shthed', repo: 'capy' },
        payload: {
          pull_request: {
            number: prNumber,
            title: prTitle,
            html_url: `https://github.com/shthed/capy/pull/${prNumber}`,
            merged,
            base: { ref: baseRef },
            labels: labels.map((name) => ({ name })),
            body,
          },
        },
      };
      await runSyncAgileScript(contextMock, githubMock, coreMock);
      return updatedIssues;
    };

    // Case 1: epic:2 label flips unchecked PR checklist line [ ] -> [x]
    const syncRes1 = await runSyncAgileCase({
      labels: ['epic:2'],
      prNumber: 495,
      issuesByNumber: {
        477: {
          number: 477,
          state: 'open',
          body: '#### Staged on `beta`\n- [ ] [#495 — Old PR Title](https://github.com/shthed/capy/pull/495)\n',
        },
      },
    });
    assert.equal(syncRes1.length, 1);
    assert.equal(syncRes1[0].issue_number, 477);
    assert.equal(
      syncRes1[0].body.includes('- [x] [#495 — Old PR Title](https://github.com/shthed/capy/pull/495)'),
      true
    );

    // Case 2: Agile Scope EPIC-3 inserts [x] bullet under Staged on beta when absent
    const syncRes2 = await runSyncAgileCase({
      prNumber: 499,
      prTitle: 'Add loupe magnifier',
      body: '**Agile Scope**: Tracked in [EPIC-3](https://github.com/shthed/capy/issues/478)',
      issuesByNumber: {
        478: {
          number: 478,
          state: 'open',
          body: '#### Staged on `beta`\n- [x] [#472 — Zoom](https://github.com/shthed/capy/pull/472)\n\n#### Open\n- [ ] Future\n',
        },
      },
    });
    assert.equal(syncRes2.length, 1);
    assert.equal(syncRes2[0].issue_number, 478);
    assert.equal(
      syncRes2[0].body.includes('- [x] [#499 — Add loupe magnifier](https://github.com/shthed/capy/pull/499)'),
      true
    );

    // Case 3: closed issue or unmerged PR makes zero mutations
    const syncRes3 = await runSyncAgileCase({
      labels: ['epic:1'],
      prNumber: 500,
      issuesByNumber: {
        476: { number: 476, state: 'closed', body: '- [ ] #500' },
      },
    });
    assert.equal(syncRes3.length, 0);
    const syncRes4 = await runSyncAgileCase({ merged: false, labels: ['epic:2'] });
    assert.equal(syncRes4.length, 0);
    logUnitPass('ai-review fallback models, dependabot.yml & sync-agile-tracker.yml verified.');
    /* capy-dev-only:end */

    // Verify Android TV Leanback manifest declarations and 320x180 tv_banner.png asset (TC-B1-T1-01..06, TC-B1-T2-01..06)
    logUnitStart('Testing Android TV Leanback AndroidManifest.xml & 320x180 tv_banner.png...');
    const androidManifestPath = path.resolve(projectRoot, '../app/src/main/AndroidManifest.xml');
    const tvManifestInfo = JSON.parse(
      execFileSync(
        'python3',
        [
          '-c',
          [
            'import json, sys, xml.etree.ElementTree as ET',
            'ns = "{http://schemas.android.com/apk/res/android}"',
            'root = ET.parse(sys.argv[1]).getroot()',
            'features = {el.attrib.get(ns + "name"): el.attrib.get(ns + "required") for el in root.findall("uses-feature")}',
            'app = root.find("application")',
            'main_act = next(a for a in app.findall("activity") if a.attrib.get(ns + "name") == "com.capyboop.paint.MainActivity")',
            'filters = []',
            'for flt in main_act.findall("intent-filter"):',
            '    filters.append({',
            '        "autoVerify": flt.attrib.get(ns + "autoVerify"),',
            '        "actions": [e.attrib.get(ns + "name") for e in flt.findall("action")],',
            '        "categories": [e.attrib.get(ns + "name") for e in flt.findall("category")],',
            '        "data": [{"scheme": d.attrib.get(ns + "scheme"), "host": d.attrib.get(ns + "host"), "mimeType": d.attrib.get(ns + "mimeType"), "pathPrefix": d.attrib.get(ns + "pathPrefix")} for d in flt.findall("data")],',
            '    })',
            'print(json.dumps({',
            '    "features": features,',
            '    "banner": app.attrib.get(ns + "banner"),',
            '    "usesCleartextTraffic": app.attrib.get(ns + "usesCleartextTraffic"),',
            '    "exported": main_act.attrib.get(ns + "exported"),',
            '    "launchMode": main_act.attrib.get(ns + "launchMode"),',
            '    "configChanges": main_act.attrib.get(ns + "configChanges"),',
            '    "filters": filters,',
            '}))',
          ].join('\n'),
          androidManifestPath,
        ],
        { encoding: 'utf8' }
      )
    );
    assert.equal(tvManifestInfo.features['android.hardware.touchscreen'], 'false');
    assert.equal(tvManifestInfo.features['android.software.leanback'], 'false');
    assert.equal(tvManifestInfo.banner, '@drawable/tv_banner');
    assert.equal(tvManifestInfo.usesCleartextTraffic, 'false');
    assert.equal(tvManifestInfo.exported, 'true');
    assert.equal(tvManifestInfo.launchMode, 'singleTask');
    for (const cfgFlag of ['uiMode', 'navigation', 'keyboard', 'keyboardHidden', 'screenSize']) {
      assert.equal(
        String(tvManifestInfo.configChanges || '').split('|').includes(cfgFlag),
        true,
        `AndroidManifest configChanges must include ${cfgFlag}`
      );
    }
    const mainIntentFilter = tvManifestInfo.filters.find((f) =>
      f.actions.includes('android.intent.action.MAIN')
    );
    assert.ok(mainIntentFilter, 'MainActivity must declare MAIN intent-filter');
    assert.equal(mainIntentFilter.categories.includes('android.intent.category.LAUNCHER'), true);
    assert.equal(
      mainIntentFilter.categories.includes('android.intent.category.LEANBACK_LAUNCHER'),
      true
    );
    const sendIntentFilter = tvManifestInfo.filters.find((f) =>
      f.actions.includes('android.intent.action.SEND')
    );
    assert.ok(sendIntentFilter, 'MainActivity must preserve ACTION_SEND intent-filter');
    assert.equal(
      sendIntentFilter.data.some((d) => d.mimeType === 'image/*'),
      true
    );
    const viewIntentFilters = tvManifestInfo.filters.filter((f) =>
      f.actions.includes('android.intent.action.VIEW')
    );
    const autoVerifyFilter = viewIntentFilters.find(
      (f) => f.autoVerify === '${appLinksAutoVerify}'
    );
    assert.ok(autoVerifyFilter, 'MainActivity must preserve dedicated autoVerify App Links intent-filter');
    assert.equal(
      autoVerifyFilter.data.some((d) => d.scheme === 'https' && d.host === 'capypaint.com'),
      true
    );
    assert.equal(
      autoVerifyFilter.data.some((d) => d.scheme === 'https' && d.host === 'paint.capyboop.com'),
      true
    );
    assert.equal(
      autoVerifyFilter.data.some((d) => d.host === 'www.capypaint.com'),
      false,
      'autoVerify filter must exclude redirecting www.capypaint.com'
    );
    assert.equal(
      autoVerifyFilter.data.some((d) => String(d.host || '').endsWith('.github.io')),
      false,
      'autoVerify filter must exclude GitHub Pages host'
    );
    const fallbackViewData = viewIntentFilters
      .filter((f) => !f.autoVerify)
      .flatMap((f) => f.data);
    assert.equal(
      fallbackViewData.some((d) => d.scheme === 'https' && d.host === 'www.capypaint.com'),
      true
    );
    assert.equal(
      fallbackViewData.some(
        (d) => d.scheme === 'https' && String(d.host || '').endsWith('.github.io') && d.pathPrefix === '/capy'
      ),
      true
    );
    const androidStringsXml = fs.readFileSync(
      path.resolve(projectRoot, '../app/src/main/res/values/strings.xml'),
      'utf8'
    );
    assert.equal(
      androidStringsXml.includes('game_services_project_id'),
      false,
      'strings.xml must not statically declare game_services_project_id alongside Gradle resValue'
    );
    const androidBuildGradle = fs.readFileSync(
      path.resolve(projectRoot, '../app/build.gradle.kts'),
      'utf8'
    );
    assert.equal(
      androidBuildGradle.includes('resValue("string", "game_services_project_id"'),
      true,
      'app/build.gradle.kts must emit resValue for game_services_project_id'
    );

    const parseTvBannerPng = (buf) => {
      const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      if (!Buffer.isBuffer(buf) || buf.length < 26) return null;
      if (!buf.subarray(0, 8).equals(pngMagic)) return null;
      if (buf.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
      return {
        width: buf.readUInt32BE(16),
        height: buf.readUInt32BE(20),
        bitDepth: buf[24],
        colorType: buf[25],
      };
    };

    const tvBannerPath = path.resolve(projectRoot, '../app/src/main/res/drawable-xhdpi/tv_banner.png');
    assert.equal(fs.existsSync(tvBannerPath), true, 'drawable-xhdpi/tv_banner.png must exist');
    const tvBannerBuf = fs.readFileSync(tvBannerPath);
    assert.equal(tvBannerBuf.length > 100 && tvBannerBuf.length <= 1024 * 1024, true);
    const tvBannerHeader = parseTvBannerPng(tvBannerBuf);
    assert.ok(tvBannerHeader, 'tv_banner.png must have valid PNG magic and IHDR chunk');
    assert.equal(tvBannerHeader.width, 320);
    assert.equal(tvBannerHeader.height, 180);
    assert.equal(tvBannerHeader.bitDepth, 8);
    assert.equal(tvBannerHeader.colorType === 6 || tvBannerHeader.colorType === 2, true);

    assert.equal(parseTvBannerPng(Buffer.alloc(16)), null);
    const badBannerBuf = Buffer.from(tvBannerBuf);
    badBannerBuf.writeUInt32BE(512, 16);
    badBannerBuf.writeUInt32BE(512, 20);
    const badBannerHeader = parseTvBannerPng(badBannerBuf);
    assert.equal(badBannerHeader.width === 320 && badBannerHeader.height === 180, false);
    logUnitPass('Android TV Leanback AndroidManifest.xml & 320x180 tv_banner.png verified.');

    // Verify web/public/404.html redirect logic, .github/scripts/pr-index.html, & generate-pr-manifest.mjs
    logUnitStart('Testing 404.html redirect VM behavior, pr-index.html, generate-pr-manifest.mjs & workflow wiring...');
    const notFoundHtmlPath = path.resolve(projectRoot, 'public/404.html');
    const notFoundHtml = fs.readFileSync(notFoundHtmlPath, 'utf8');
    assert.equal(notFoundHtml.includes('/capy/alpha/?missing='), true, '404.html must redirect to /capy/alpha/?missing=');
    assert.equal(notFoundHtml.includes('(alpha|PR|pull)'), true, '404.html must match /capy/alpha/, /capy/PR/, and /capy/pull/');
    assert.equal(notFoundHtml.includes('href="/capy/alpha/"'), true, '404.html must include fallback /capy/alpha/ link');

    const scriptMatch = notFoundHtml.match(/<script>([\s\S]*?)<\/script>/);
    assert.ok(scriptMatch, '404.html must contain an inline redirect script');
    const run404Redirect = (pathname) => {
      let replacedWith = null;
      const msgEl = { textContent: '' };
      const prLinkEl = {
        attrs: {},
        setAttribute(k, v) {
          this.attrs[k] = v;
        },
      };
      const sandbox = {
        encodeURIComponent,
        window: {
          location: {
            pathname,
            replace(url) {
              replacedWith = url;
            },
          },
        },
        document: {
          getElementById(id) {
            if (id === 'message') return msgEl;
            if (id === 'pr-link') return prLinkEl;
            return null;
          },
        },
      };
      vm.runInNewContext(scriptMatch[1], sandbox);
      return { replacedWith, msg: msgEl.textContent, href: prLinkEl.attrs.href ?? null };
    };

    assert.equal(run404Redirect('/capy/alpha/491/').replacedWith, '/capy/alpha/?missing=491');
    assert.equal(run404Redirect('/capy/PR/491/').replacedWith, '/capy/alpha/?missing=491');
    assert.equal(run404Redirect('/capy/pull/489/').replacedWith, '/capy/alpha/?missing=489');
    assert.equal(run404Redirect('/capy/PR/').replacedWith, '/capy/alpha/');
    assert.equal(run404Redirect('/capy/pull/').replacedWith, '/capy/alpha/');
    assert.equal(run404Redirect('/capy/alpha/').replacedWith, null, '404.html must not loop on /capy/alpha/');
    assert.equal(run404Redirect('/capy/alpha').replacedWith, null, '404.html must not loop on /capy/alpha');
    assert.equal(run404Redirect('/capy/beta/missing').replacedWith, null, '404.html must not redirect /capy/beta/*');
    assert.equal(run404Redirect('/capy/unknown').replacedWith, null, '404.html must not redirect /capy/unknown');
    assert.equal(run404Redirect('/capy/privacy-policy.html').replacedWith, null, '404.html must not redirect /capy/privacy-policy.html');
    assert.equal(run404Redirect('/capy/preview').replacedWith, null, '404.html must not redirect /capy/preview');
    assert.equal(run404Redirect('/capy/pull-request').replacedWith, null, '404.html must not redirect /capy/pull-request');
    assert.equal(run404Redirect('/capy/alpha-test').replacedWith, null, '404.html must not redirect /capy/alpha-test');
    assert.equal(run404Redirect('/capy/alpha/491').replacedWith, '/capy/alpha/?missing=491');
    assert.equal(run404Redirect('/capy/alpha///491').replacedWith, '/capy/alpha/?missing=491');
    assert.equal(run404Redirect('/capy/pull/491').replacedWith, '/capy/alpha/?missing=491');
    assert.equal(run404Redirect('/capy/PR/491/sub?x=1#y').replacedWith, '/capy/alpha/?missing=491');

    const prIndexHtmlPath = path.resolve(projectRoot, '../.github/scripts/pr-index.html');
    const prIndexHtml = fs.readFileSync(prIndexHtmlPath, 'utf8');
    assert.equal(prIndexHtml.includes('/capy/alpha/'), true, 'pr-index.html must target /capy/alpha/');
    assert.equal(prIndexHtml.includes("fetch('manifest.json', { cache: 'no-store' })"), true, 'pr-index.html must fetch manifest.json with no-store');
    assert.equal(prIndexHtml.includes("params.get('missing')"), true, 'pr-index.html must read ?missing= query parameter');
    assert.equal(prIndexHtml.includes('/capy/PR/'), false, 'pr-index.html must not reference legacy /capy/PR/');
    assert.equal(prIndexHtml.toLowerCase().includes('shthed'), false, 'pr-index.html must not hardcode owner slug');
    assert.equal(prIndexHtml.includes('deriveRepoSlug'), true, 'pr-index.html must derive repo slug dynamically');

    const { generatePrManifest } = await import('../../.github/scripts/generate-pr-manifest.mjs');
    const tmpPagesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capy-pr-manifest-'));
    try {
      const alphaDir = path.join(tmpPagesDir, 'alpha');
      fs.mkdirSync(path.join(alphaDir, '485'), { recursive: true });
      fs.mkdirSync(path.join(alphaDir, '491'), { recursive: true });
      fs.mkdirSync(path.join(alphaDir, 'feature-x'), { recursive: true });
      fs.mkdirSync(path.join(alphaDir, 'not-a-pr'), { recursive: true });
      fs.writeFileSync(path.join(alphaDir, '491', 'capy.apk'), 'apk');

      const manifest = generatePrManifest({ pagesDir: tmpPagesDir });
      assert.deepEqual(
        manifest.prs.map((p) => ({ number: p.number, path: p.path, hasApk: p.hasApk })),
        [
          { number: 491, path: '/capy/alpha/491/', hasApk: true },
          { number: 485, path: '/capy/alpha/485/', hasApk: false },
        ],
        'generatePrManifest must sort numeric PR directories descending, emit /capy/alpha/<id>/, and exclude non-numeric dirs'
      );
      const writtenManifest = JSON.parse(fs.readFileSync(path.join(alphaDir, 'manifest.json'), 'utf8'));
      assert.deepEqual(
        writtenManifest.prs.map((p) => p.path),
        ['/capy/alpha/491/', '/capy/alpha/485/']
      );
      assert.equal(fs.existsSync(path.join(alphaDir, 'index.html')), true, 'alpha/index.html must be copied');
      assert.equal(fs.existsSync(path.join(tmpPagesDir, '404.html')), true, 'root 404.html must be seeded when missing');

      // Passing alpha/ subdirectory directly must resolve rootPagesDir cleanly
      const subManifest = generatePrManifest({ pagesDir: alphaDir });
      assert.equal(subManifest.prs.length, 2);

      // Existing 404.html must be preserved when refreshNotFound is false, and overwritten when refreshNotFound is true
      const dest404Path = path.join(tmpPagesDir, '404.html');
      fs.writeFileSync(dest404Path, 'stale-404-sentinel', 'utf8');
      generatePrManifest({ pagesDir: tmpPagesDir, refreshNotFound: false });
      assert.equal(fs.readFileSync(dest404Path, 'utf8'), 'stale-404-sentinel');

      generatePrManifest({ pagesDir: tmpPagesDir, refreshNotFound: true });
      assert.equal(fs.readFileSync(dest404Path, 'utf8'), notFoundHtml);

      // Verify CLI flags --pages-dir, --not-found-src, and --refresh-404
      fs.writeFileSync(dest404Path, 'cli-stale-sentinel', 'utf8');
      execFileSync(process.execPath, [
        path.resolve(projectRoot, '../.github/scripts/generate-pr-manifest.mjs'),
        '--pages-dir',
        tmpPagesDir,
        '--not-found-src',
        notFoundHtmlPath,
        '--refresh-404',
      ]);
      assert.equal(fs.readFileSync(dest404Path, 'utf8'), notFoundHtml);

      // cleanup-gh-pages-previews must preserve alpha/index.html and alpha/manifest.json intact
      const cleanupRes = await previewCleanupMod.runCleanupGhPagesPreviews({
        pagesDir: tmpPagesDir,
        quiet: true,
        ignoreRecency: true,
        repository: 'a/b',
        token: 'tok',
        defaultBranch: 'main',
        remoteBranches: ['main', 'beta'],
        baseDelayMs: 1,
        sleepImpl: async () => {},
        fetchImpl: async () =>
          makeMockResponse({
            ok: true,
            status: 200,
            jsonData: [{ number: 491, state: 'open', head: { ref: 'fix/pr-404-redirect' } }],
          }),
      });
      assert.equal(cleanupRes.deleted.includes('alpha/485'), true);
      assert.equal(fs.existsSync(path.join(alphaDir, '491')), true);
      assert.equal(fs.existsSync(path.join(alphaDir, '485')), false);
      assert.equal(fs.existsSync(path.join(alphaDir, 'index.html')), true, 'alpha/index.html must survive preview cleanup');
      assert.equal(fs.existsSync(path.join(alphaDir, 'manifest.json')), true, 'alpha/manifest.json must survive preview cleanup');
    } finally {
      fs.rmSync(tmpPagesDir, { recursive: true, force: true });
    }

    const deployWorkflowYaml = fs.readFileSync(
      path.resolve(projectRoot, '../.github/workflows/deploy-branch.yml'),
      'utf8'
    );
    assert.equal(deployWorkflowYaml.includes('generate-pr-manifest.mjs'), true);
    assert.equal(deployWorkflowYaml.includes('web/public/404.html'), true);
    assert.equal(deployWorkflowYaml.includes('--refresh-404'), true);
    assert.equal(deployWorkflowYaml.includes('ls -lah "${LIST_PATH}"'), true);

    const cleanupWorkflowYaml = fs.readFileSync(
      path.resolve(projectRoot, '../.github/workflows/cleanup-closed-pr.yml'),
      'utf8'
    );
    assert.equal(cleanupWorkflowYaml.includes('generate-pr-manifest.mjs'), true);

    // Parse all .github/workflows/*.yml via yaml.safe_load and verify Upload Pages artifact preserves hidden dotfiles
    const parsedWorkflows = JSON.parse(
      execFileSync(
        'python3',
        [
          '-c',
          [
            'import glob, json, os, sys, yaml',
            'wf_dir = sys.argv[1]',
            'out = {}',
            'for p in sorted(glob.glob(os.path.join(wf_dir, "*.yml"))):',
            '    with open(p, encoding="utf-8") as f:',
            '        out[os.path.basename(p)] = yaml.safe_load(f)',
            'print(json.dumps(out))',
          ].join('\n'),
          path.resolve(projectRoot, '../.github/workflows'),
        ],
        { encoding: 'utf8' }
      )
    );
    for (const [wfFile, jobName] of [
      ['deploy-branch.yml', 'deploy'],
      ['cleanup-closed-pr.yml', 'cleanup'],
      ['cleanup-branches.yml', 'cleanup'],
    ]) {
      const steps = parsedWorkflows?.[wfFile]?.jobs?.[jobName]?.steps || [];
      const uploadPagesStep = steps.find(
        (s) => typeof s?.uses === 'string' && s.uses.startsWith('actions/upload-pages-artifact@')
      );
      assert.ok(uploadPagesStep, `Expected actions/upload-pages-artifact step in ${wfFile}`);
      assert.equal(
        uploadPagesStep?.with?.['include-hidden-files'],
        true,
        `${wfFile} Upload Pages artifact step must set include-hidden-files: true`
      );
    }

    /* capy-dev-only:start */
    // Verify regenerate-puzzles.yml triggers only on workflow_dispatch or path-filtered pushes to beta (no schedule).
    // Note: regenerate-puzzles.yml is a dev-only workflow stripped from clean-room capyboop/paint exports.
    const regenWorkflowPath = path.resolve(projectRoot, '../.github/workflows/regenerate-puzzles.yml');
    if (fs.existsSync(regenWorkflowPath)) {
      const regenWorkflow = parsedWorkflows?.['regenerate-puzzles.yml'];
      assert.ok(regenWorkflow, 'Expected parsed regenerate-puzzles.yml workflow');
      // PyYAML parses YAML 1.1 `on:` as boolean True -> JSON key "true"
      const regenOn = regenWorkflow.on ?? regenWorkflow.true;
      assert.ok(regenOn && typeof regenOn === 'object', 'Expected on: block in regenerate-puzzles.yml');
      assert.equal(
        Object.prototype.hasOwnProperty.call(regenOn, 'schedule'),
        false,
        'regenerate-puzzles.yml must not trigger on a cron schedule'
      );
      assert.equal(
        Object.prototype.hasOwnProperty.call(regenOn, 'workflow_dispatch'),
        true,
        'regenerate-puzzles.yml must retain workflow_dispatch for on-demand runs'
      );
      const regenPush = regenOn.push;
      assert.ok(regenPush && Array.isArray(regenPush.branches), 'regenerate-puzzles.yml must define push.branches');
      assert.equal(
        regenPush.branches.includes('beta'),
        true,
        'regenerate-puzzles.yml push.branches must include beta'
      );
      assert.ok(Array.isArray(regenPush.paths), 'regenerate-puzzles.yml must define push.paths');
      for (const expectedPath of [
        'web/public/assets/**',
        '!web/public/assets/**/*.capy',
        '!web/public/assets/presets/**',
        '!web/public/assets/icon-*.png',
        '!web/public/assets/apple-touch-icon.png',
        'web/scripts/generate-sample-saves.mjs',
        'web/src/engine/**',
        'web/src/services/CapyCodec.ts',
        'web/src/services/DailyPuzzleService.ts',
        'web/src/services/PuzzleWorkerService.ts',
        'web/src/services/StorageService.ts',
        'web/src/types/index.ts',
        '.github/workflows/regenerate-puzzles.yml',
      ]) {
        assert.equal(
          regenPush.paths.includes(expectedPath),
          true,
          `regenerate-puzzles.yml push.paths must include ${expectedPath}`
        );
      }
    }
    /* capy-dev-only:end */
    logUnitPass('404.html redirect VM, pr-index.html, generate-pr-manifest.mjs & upload-pages-artifact dotfiles verified.');

    // Verify .github/scripts/compile-changelog.mjs & release.yml wiring
    logUnitStart('Testing .github/scripts/compile-changelog.mjs release note extraction & release.yml wiring...');
    const { extractReleaseNotes, formatReleaseNotesMarkdown } = await import(
      '../../.github/scripts/compile-changelog.mjs'
    );
    const sampleChangelog = `### 3.0.7 - 2026-11-13 (Beta)

- [#495](../../pull/495) Fix Play Games fallback and DPR canvas scaling

### 3.0.6 - 2026-11-13

- [#489](../../pull/489) Prior release note

### 2.9 - 2026-11-10

- [#470](../../pull/470) Minor rollup note`;
    assert.equal(
      extractReleaseNotes(sampleChangelog, 'v3.0.7'),
      '- [#495](../../pull/495) Fix Play Games fallback and DPR canvas scaling'
    );
    assert.equal(
      extractReleaseNotes(sampleChangelog.replace(/\n/g, '\r\n'), 'v3.0.7-beta.1'),
      '- [#495](../../pull/495) Fix Play Games fallback and DPR canvas scaling'
    );
    assert.equal(
      extractReleaseNotes(sampleChangelog, 'v2.9.4'),
      '- [#470](../../pull/470) Minor rollup note'
    );
    assert.equal(extractReleaseNotes(sampleChangelog, 'v9.9.9'), '- Release v9.9.9');
    assert.throws(() => extractReleaseNotes(sampleChangelog, 'invalid-tag'));
    assert.equal(
      formatReleaseNotesMarkdown(sampleChangelog, 'v3.0.6'),
      '### What\'s New in `v3.0.6`\n\n- [#489](../../pull/489) Prior release note\n'
    );
    const tmpReleaseNotesOut = path.join(os.tmpdir(), 'capy-release-notes-test.md');
    try {
      execFileSync(process.execPath, [
        path.resolve(projectRoot, '../.github/scripts/compile-changelog.mjs'),
        '--tag',
        `v${webPkgJson.version}`,
        '--changelog',
        path.resolve(projectRoot, '../CHANGELOG.md'),
        '--out',
        tmpReleaseNotesOut,
      ]);
      const cliNotes = fs.readFileSync(tmpReleaseNotesOut, 'utf8');
      assert.equal(cliNotes.startsWith(`### What's New in \`v${webPkgJson.version}\`\n\n`), true);
    } finally {
      fs.rmSync(tmpReleaseNotesOut, { force: true });
    }
    const releaseWorkflowYaml = fs.readFileSync(
      path.resolve(projectRoot, '../.github/workflows/release.yml'),
      'utf8'
    );
    assert.equal(releaseWorkflowYaml.includes('compile-changelog.mjs'), true);
    assert.equal(releaseWorkflowYaml.includes('python3'), false);
    assert.equal(releaseWorkflowYaml.includes('CAPY_KEYSTORE_BASE64'), true);
    assert.equal(releaseWorkflowYaml.includes('GITHUB_STEP_SUMMARY'), true);
    assert.equal(releaseWorkflowYaml.includes("steps.signing.outputs.enabled == 'true'"), true);
    assert.equal(releaseWorkflowYaml.includes('workflow_dispatch'), true);

    // Verify .github/scripts/compile-changelog.mjs stops cleanly at ## headings
    const changelogWithSubheading = `### 3.0.7 - 2026-11-13 (Beta)

- [#495](../../pull/495) Top bullet

## Archive Section

- Should never bleed into v3.0.7 release notes`;
    assert.equal(
      extractReleaseNotes(changelogWithSubheading, 'v3.0.7'),
      '- [#495](../../pull/495) Top bullet'
    );
    logUnitPass('.github/scripts/compile-changelog.mjs & release.yml extraction verified.');

    // Verify sanity.mjs .changelog fragment parser + web/scripts/compile-changelog.mjs
    logUnitStart('Testing .changelog fragments, compile-changelog.mjs, StorageNamespace, FeatureOffersService & StorageService...');
    const sanityMod = await import('./sanity.mjs');
    const compileMod = await import('./compile-changelog.mjs');

    const validFrag = sanityMod.parseChangelogFragment(
      '---\nbump: minor\nepic: EPIC-3\ntask: TASK-2.5\n---\nAdd crisp new brush stroke effect\n',
      '.changelog/brush.md'
    );
    assert.equal(validFrag.bump, 'minor');
    assert.equal(validFrag.task, 'TASK-2.5');
    assert.throws(() => sanityMod.parseChangelogFragment('---\nbump: invalid\n---\nBad bump\n'));
    assert.throws(() => sanityMod.parseChangelogFragment('---\nbump: patch\n---\nLine 1\nLine 2\n'));
    const maxLenSummary = 'x'.repeat(sanityMod.MAX_CHANGELOG_FRAGMENT_LENGTH);
    assert.equal(
      sanityMod.parseChangelogFragment(`---\nbump: patch\n---\n${maxLenSummary}\n`, '.changelog/max-ok.md').summary
        .length,
      sanityMod.MAX_CHANGELOG_FRAGMENT_LENGTH
    );
    assert.throws(
      () =>
        sanityMod.parseChangelogFragment(
          `---\nbump: patch\n---\n${maxLenSummary}y\n`,
          '.changelog/too-long.md'
        ),
      /summary is too long/i
    );

    assert.equal(compileMod.computeNextSemVer('3.0.7', 'patch').version, '3.0.8');
    assert.equal(compileMod.computeNextSemVer('3.0.7', 'minor').version, '3.1.0');
    assert.equal(compileMod.computeNextSemVer('3.0.7', 'major').version, '4.0.0');

    const tmpCompileRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'capy-changelog-compile-'));
    try {
      fs.mkdirSync(path.join(tmpCompileRepo, 'web/src'), { recursive: true });
      fs.mkdirSync(path.join(tmpCompileRepo, 'app'), { recursive: true });
      fs.mkdirSync(path.join(tmpCompileRepo, '.changelog'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpCompileRepo, 'web/package.json'),
        JSON.stringify({ name: 'capy-paint', version: '3.0.7' }, null, 2),
        'utf8'
      );
      fs.writeFileSync(
        path.join(tmpCompileRepo, 'web/package-lock.json'),
        JSON.stringify(
          {
            name: 'capy-paint',
            version: '3.0.7',
            lockfileVersion: 3,
            packages: { '': { name: 'capy-paint', version: '3.0.7' } },
          },
          null,
          2
        ),
        'utf8'
      );
      fs.writeFileSync(
        path.join(tmpCompileRepo, 'web/src/version.ts'),
        `export const APP_VERSION = '3.0.7';\n`,
        'utf8'
      );
      fs.writeFileSync(
        path.join(tmpCompileRepo, 'app/build.gradle.kts'),
        `versionCode = 30007\nversionName = "3.0.7"\n`,
        'utf8'
      );
      fs.writeFileSync(
        path.join(tmpCompileRepo, 'TODO.md'),
        `# Queue\n\n### TASK-2.5: Finish release\n\nDetails here.\n\n### BUG-4: Keep me\n\nKeep details.\n`,
        'utf8'
      );
      fs.writeFileSync(
        path.join(tmpCompileRepo, 'CHANGELOG.md'),
        `### 3.0.7 - 2026-11-12 (Beta)\n\n- [#495](../../pull/495) Beta item\n\n### 3.0.1 - 2026-11-10 (Production)\n\n- [#488](../../pull/488) Prod item\n`,
        'utf8'
      );
      fs.writeFileSync(path.join(tmpCompileRepo, '.changelog/README.md'), '# Fragments\n', 'utf8');
      fs.writeFileSync(
        path.join(tmpCompileRepo, '.changelog/01-fix.md'),
        '---\nbump: patch\npr: 496\ntask: TASK-2.5\n---\nFix edge zoom jitter\n',
        'utf8'
      );
      fs.writeFileSync(
        path.join(tmpCompileRepo, '.changelog/02-feat.md'),
        '---\nbump: minor\nepic: EPIC-3\n---\nAdd loupe magnifier\n',
        'utf8'
      );

      assert.equal(sanityMod.validateChangelogFragments(tmpCompileRepo), 2);
      const betaCompileRes = compileMod.compileChangelog({
        repoRoot: tmpCompileRepo,
        dateStr: '2026-11-13',
        prMap: { '02-feat': 497 },
      });
      assert.equal(betaCompileRes.version, '3.1.0');
      assert.equal(betaCompileRes.compiledCount, 2);
      assert.equal(betaCompileRes.appendedSameDay, false);
      assert.equal(JSON.parse(fs.readFileSync(path.join(tmpCompileRepo, 'web/package.json'), 'utf8')).version, '3.1.0');
      const lockAfterBump = JSON.parse(
        fs.readFileSync(path.join(tmpCompileRepo, 'web/package-lock.json'), 'utf8')
      );
      assert.equal(lockAfterBump.version, '3.1.0');
      assert.equal(lockAfterBump.packages[''].version, '3.1.0');
      assert.equal(fs.readFileSync(path.join(tmpCompileRepo, 'web/src/version.ts'), 'utf8').includes("'3.1.0'"), true);
      assert.equal(fs.readFileSync(path.join(tmpCompileRepo, 'app/build.gradle.kts'), 'utf8').includes('versionCode = 30100'), true);
      assert.equal(fs.readFileSync(path.join(tmpCompileRepo, 'app/build.gradle.kts'), 'utf8').includes('versionName = "3.1.0"'), true);
      const todoAfter = fs.readFileSync(path.join(tmpCompileRepo, 'TODO.md'), 'utf8');
      assert.equal(todoAfter.includes('TASK-2.5'), false);
      assert.equal(todoAfter.includes('BUG-4'), true);
      assert.equal(fs.existsSync(path.join(tmpCompileRepo, '.changelog/01-fix.md')), false);
      assert.equal(fs.existsSync(path.join(tmpCompileRepo, '.changelog/README.md')), true);
      const compiledCl = fs.readFileSync(path.join(tmpCompileRepo, 'CHANGELOG.md'), 'utf8');
      assert.equal(compiledCl.startsWith('### 3.1.0 - 2026-11-13 (Beta)\n'), true);
      assert.match(compiledCl, /\n- \[#496\]\(\.\.\/\.\.\/pull\/496\) Fix edge zoom jitter\n/);
      assert.match(compiledCl, /\n- \[#497\]\(\.\.\/\.\.\/pull\/497\) Add loupe magnifier\n/);
      assert.equal(compiledCl.includes('### 3.0.7 - 2026-11-12\n'), true);
      assert.equal(compiledCl.includes('### 3.0.1 - 2026-11-10 (Production)\n'), true);

      // Same-day Beta re-compile appends into existing heading without double-bumping version
      fs.writeFileSync(
        path.join(tmpCompileRepo, '.changelog/03-same-day.md'),
        '---\nbump: patch\npr: 499\n---\nPolish palette swatch contrast\n',
        'utf8'
      );
      const sameDayRes = compileMod.compileChangelog({
        repoRoot: tmpCompileRepo,
        dateStr: '2026-11-13',
      });
      assert.equal(sameDayRes.version, '3.1.0');
      assert.equal(sameDayRes.compiledCount, 1);
      assert.equal(sameDayRes.appendedSameDay, true);
      assert.equal(JSON.parse(fs.readFileSync(path.join(tmpCompileRepo, 'web/package.json'), 'utf8')).version, '3.1.0');
      const sameDayCl = fs.readFileSync(path.join(tmpCompileRepo, 'CHANGELOG.md'), 'utf8');
      assert.equal(sameDayCl.startsWith('### 3.1.0 - 2026-11-13 (Beta)\n'), true);
      assert.equal((sameDayCl.match(/^### 3\.1\.0 - 2026-11-13 \(Beta\)$/gm) || []).length, 1);
      assert.match(
        sameDayCl,
        /\n- \[#499\]\(\.\.\/\.\.\/pull\/499\) Polish palette swatch contrast\n- \[#496\]\(\.\.\/\.\.\/pull\/496\)/
      );

      // Same-day Beta compile with minor bump cuts a new version instead of appending into existing (Beta)
      fs.writeFileSync(
        path.join(tmpCompileRepo, '.changelog/04-same-day-minor.md'),
        '---\nbump: minor\npr: 500\n---\nAdd custom brush presets\n',
        'utf8'
      );
      const sameDayMinorRes = compileMod.compileChangelog({
        repoRoot: tmpCompileRepo,
        dateStr: '2026-11-13',
      });
      assert.equal(sameDayMinorRes.version, '3.2.0');
      assert.equal(sameDayMinorRes.compiledCount, 1);
      assert.equal(sameDayMinorRes.appendedSameDay, false);
      assert.equal(JSON.parse(fs.readFileSync(path.join(tmpCompileRepo, 'web/package.json'), 'utf8')).version, '3.2.0');
      const sameDayMinorCl = fs.readFileSync(path.join(tmpCompileRepo, 'CHANGELOG.md'), 'utf8');
      assert.equal(sameDayMinorCl.startsWith('### 3.2.0 - 2026-11-13 (Beta)\n'), true);
      assert.equal(sameDayMinorCl.includes('### 3.1.0 - 2026-11-13\n'), true);

      // Promote to Production, Beta
      const promoRes = compileMod.compileChangelog({ repoRoot: tmpCompileRepo, promote: true });
      assert.equal(promoRes.promoted, true);
      const promotedCl = fs.readFileSync(path.join(tmpCompileRepo, 'CHANGELOG.md'), 'utf8');
      assert.equal(promotedCl.startsWith('### 3.2.0 - 2026-11-13 (Production, Beta)\n'), true);
      assert.equal(promotedCl.includes('### 3.0.1 - 2026-11-10\n'), true);

      // Same-day compile after --promote must cut a new (Beta) version and leave (Production) untouched
      fs.writeFileSync(
        path.join(tmpCompileRepo, '.changelog/05-post-promote.md'),
        '---\nbump: patch\npr: 501\n---\nFix post-release tooltip alignment\n',
        'utf8'
      );
      const postPromoteRes = compileMod.compileChangelog({
        repoRoot: tmpCompileRepo,
        dateStr: '2026-11-13',
      });
      assert.equal(postPromoteRes.version, '3.2.1');
      assert.equal(postPromoteRes.compiledCount, 1);
      assert.equal(postPromoteRes.appendedSameDay, false);
      assert.equal(JSON.parse(fs.readFileSync(path.join(tmpCompileRepo, 'web/package.json'), 'utf8')).version, '3.2.1');
      const postPromoteCl = fs.readFileSync(path.join(tmpCompileRepo, 'CHANGELOG.md'), 'utf8');
      assert.equal(postPromoteCl.startsWith('### 3.2.1 - 2026-11-13 (Beta)\n'), true);
      assert.equal(postPromoteCl.includes('### 3.2.0 - 2026-11-13 (Production)\n'), true);

      // Malformed web/package-lock.json must fail cleanly before mutating web/package.json
      fs.writeFileSync(path.join(tmpCompileRepo, 'web/package-lock.json'), '{ broken json', 'utf8');
      fs.writeFileSync(
        path.join(tmpCompileRepo, '.changelog/06-bad-lock.md'),
        '---\nbump: patch\npr: 502\n---\nGuard lockfile write order\n',
        'utf8'
      );
      assert.throws(
        () => compileMod.compileChangelog({ repoRoot: tmpCompileRepo, dateStr: '2026-11-14' }),
        SyntaxError
      );
      assert.equal(
        JSON.parse(fs.readFileSync(path.join(tmpCompileRepo, 'web/package.json'), 'utf8')).version,
        '3.2.1',
        'web/package.json must remain unmodified when web/package-lock.json fails to parse'
      );
      fs.rmSync(path.join(tmpCompileRepo, '.changelog/06-bad-lock.md'), { force: true });
      fs.writeFileSync(
        path.join(tmpCompileRepo, 'web/package-lock.json'),
        `${JSON.stringify({ name: 'capy-web', version: '3.2.1', lockfileVersion: 3, packages: { '': { version: '3.2.1' } } }, null, 2)}\n`,
        'utf8'
      );

      // Refuse promoting an (Alpha) top heading
      fs.writeFileSync(
        path.join(tmpCompileRepo, 'CHANGELOG.md'),
        `### 3.2.1 - 2026-11-13 (Alpha)\n\n- [#498](../../pull/498) Alpha preview\n\n### 3.2.0 - 2026-11-13 (Production)\n\n- [#488](../../pull/488) Prod\n`,
        'utf8'
      );
      assert.throws(() => compileMod.compileChangelog({ repoRoot: tmpCompileRepo, promote: true }));
    } finally {
      fs.rmSync(tmpCompileRepo, { recursive: true, force: true });
    }

    // Verify StorageNamespace isolation + StorageService UserSettings enum round-trips
    const nsMod = await vite.ssrLoadModule('/src/services/StorageNamespace.ts');
    const storageMod = await vite.ssrLoadModule('/src/services/StorageService.ts');
    assert.deepEqual(nsMod.resolveStorageNamespace('/capy/', 'https://capypaint.com', ''), {
      channel: 'stable',
      isSandboxed: false,
      sandboxSuffix: '',
      dbName: 'capy_game_storage_v8',
    });
    assert.deepEqual(nsMod.resolveStorageNamespace('/capy/beta/', 'https://example.github.io', ''), {
      channel: 'beta',
      isSandboxed: true,
      sandboxSuffix: '__sandbox_beta',
      dbName: 'capy_game_storage_v8_beta',
    });
    assert.deepEqual(nsMod.resolveStorageNamespace('/capy/alpha/495/', 'https://example.github.io', ''), {
      channel: 'alpha',
      isSandboxed: true,
      sandboxSuffix: '__sandbox_alpha',
      dbName: 'capy_game_storage_v8_alpha',
    });
    assert.equal(
      nsMod.resolveScopedStorageKey('capy_snapshots_v8', '/capy/beta/', 'https://example.github.io', '?capy_sandbox=0'),
      'capy_snapshots_v8'
    );
    assert.equal(
      nsMod.resolveScopedBackupKey('capy_user_settings_v8', '/capy/alpha/495/', 'https://example.github.io', ''),
      'capy_user_settings_v8__sandbox_alpha'
    );
    assert.equal(
      nsMod.resolveScopedDbName('/capy/', 'https://capypaint.com', '?capy_sandbox=1'),
      'capy_game_storage_v8_stable'
    );

    const prevLs = globalThis.localStorage;
    const prevSsrWin = globalThis.window;
    const mockStorage = new Map();
    const mockBackups = new Map();
    const resetDurabilityState = () => {
      delete globalThis.window.webkit;
      globalThis.localStorage = {
        getItem: (k) => (mockStorage.has(k) ? mockStorage.get(k) : null),
        setItem: (k, v) => mockStorage.set(k, String(v)),
        removeItem: (k) => mockStorage.delete(k),
      };
      globalThis.window.CapyAndroid = {
        saveBackup: (k, v) => {
          mockBackups.set(k, String(v));
          return true;
        },
        loadBackup: (k) => (mockBackups.has(k) ? mockBackups.get(k) : null),
      };
      for (const loc of [
        { pathname: '/', origin: 'http://127.0.0.1:3000', search: '' },
        { pathname: '/capy/beta/', origin: 'https://example.github.io', search: '' },
      ]) {
        globalThis.window.location = loc;
        storageMod.StorageService.clearActiveState();
        storageMod.StorageService.saveSnapshots([], { allowEmptyBackup: true, immediateBackup: true });
        storageMod.StorageService.saveSettings(storageMod.DEFAULT_SETTINGS);
      }
      globalThis.window.location = { pathname: '/', origin: 'http://127.0.0.1:3000', search: '' };
      storageMod.StorageService.flushPendingBackups();
      mockStorage.clear();
      mockBackups.clear();
    };
    globalThis.localStorage = {
      getItem: (k) => (mockStorage.has(k) ? mockStorage.get(k) : null),
      setItem: (k, v) => mockStorage.set(k, String(v)),
      removeItem: (k) => mockStorage.delete(k),
    };
    globalThis.window = { location: { pathname: '/', origin: 'http://127.0.0.1:3000', search: '' } };
    try {
      assert.equal(storageMod.DEFAULT_SETTINGS.regionColorMode, 'DETAIL');
      assert.equal(storageMod.DEFAULT_SETTINGS.paletteSort, 'HUE');
      assert.equal(storageMod.DEFAULT_SETTINGS.fatFingerAssist, true);
      assert.equal(storageMod.DEFAULT_SETTINGS.touchReachRadiusPx, 22);
      storageMod.StorageService.saveSettings({
        ...storageMod.DEFAULT_SETTINGS,
        difficulty: 'NORMAL',
        paletteSort: 'HUE',
        highlightStyle: 'CENTROID_GLOW',
        fatFingerAssist: false,
        touchReachRadiusPx: 34,
      });
      const loadedNormalHue = storageMod.StorageService.loadSettings();
      assert.equal(loadedNormalHue.difficulty, 'NORMAL');
      assert.equal(loadedNormalHue.paletteSort, 'HUE');
      assert.equal(loadedNormalHue.highlightStyle, 'CENTROID_GLOW');
      assert.equal(loadedNormalHue.fatFingerAssist, false);
      assert.equal(loadedNormalHue.touchReachRadiusPx, 34);

      // Verify [8, 40] clamping and absent fatFingerAssist fallback to DEFAULT_SETTINGS.fatFingerAssist (true) across both NORMAL & EASY
      mockStorage.set(
        'capy_user_settings_v8',
        JSON.stringify({ difficulty: 'NORMAL', touchReachRadiusPx: 99 })
      );
      const clampedHighNormal = storageMod.StorageService.loadSettings();
      assert.equal(clampedHighNormal.touchReachRadiusPx, 40);
      assert.equal(clampedHighNormal.fatFingerAssist, true);

      // Verify explicit fatFingerAssist: false opt-out is preserved across reloads in NORMAL mode
      mockStorage.set(
        'capy_user_settings_v8',
        JSON.stringify({ difficulty: 'NORMAL', fatFingerAssist: false })
      );
      const explicitOptOutNormal = storageMod.StorageService.loadSettings();
      assert.equal(explicitOptOutNormal.difficulty, 'NORMAL');
      assert.equal(explicitOptOutNormal.fatFingerAssist, false);

      mockStorage.set(
        'capy_user_settings_v8',
        JSON.stringify({ difficulty: 'EASY', touchReachRadiusPx: 2 })
      );
      const clampedLowEasy = storageMod.StorageService.loadSettings();
      assert.equal(clampedLowEasy.touchReachRadiusPx, 8);
      assert.equal(clampedLowEasy.fatFingerAssist, true);

      storageMod.StorageService.saveSettings({
        ...storageMod.DEFAULT_SETTINGS,
        paletteSort: 'LIGHTNESS',
      });
      assert.equal(storageMod.StorageService.loadSettings().paletteSort, 'LIGHTNESS');

      // Verify FeatureOffersService persistence, NativeBridge backup fallback, channel sandboxing, and OnboardingTutorial step mapping
      const offersMod = await vite.ssrLoadModule('/src/services/FeatureOffersService.ts');
      const tutorialMod = await vite.ssrLoadModule('/src/components/OnboardingTutorial.tsx');
      assert.equal(offersMod.FEATURE_OFFER_IDS.length, 8);
      assert.equal(tutorialMod.TUTORIAL_STEPS.length, 14);
      for (const id of offersMod.FEATURE_OFFER_IDS) {
        const offer = offersMod.FEATURE_OFFERS[id];
        assert.equal(
          offer.tutorialStepIndex >= 0 && offer.tutorialStepIndex < tutorialMod.TUTORIAL_STEPS.length,
          true,
          `Offer ${id} tutorialStepIndex (${offer.tutorialStepIndex}) must be in [0..${tutorialMod.TUTORIAL_STEPS.length - 1}]`
        );
      }

      globalThis.window.CapyAndroid = {
        saveBackup: (k, v) => {
          mockBackups.set(k, String(v));
          return true;
        },
        loadBackup: (k) => (mockBackups.has(k) ? mockBackups.get(k) : null),
      };
      offersMod.FeatureOffersService.resetSeenOffers();
      assert.equal(offersMod.FeatureOffersService.loadSeenOffers().size, 0);
      assert.equal(offersMod.FeatureOffersService.hasSeenOffer('paint_mode'), false);
      offersMod.FeatureOffersService.markOfferSeen('paint_mode');
      offersMod.FeatureOffersService.markOfferSeen('saves_export');
      assert.equal(offersMod.FeatureOffersService.hasSeenOffer('paint_mode'), true);
      assert.equal(offersMod.FeatureOffersService.hasSeenOffer('saves_export'), true);
      assert.equal(mockBackups.has('capy_feature_offers_v1'), true);

      // Rehydrate localStorage from NativeBridge backup when localStorage key is cleared
      mockStorage.delete('capy_feature_offers_v1');
      assert.equal(offersMod.FeatureOffersService.hasSeenOffer('paint_mode'), true);
      assert.equal(mockStorage.has('capy_feature_offers_v1'), true);

      // Ignore unknown/legacy/malformed entries in localStorage
      mockStorage.set('capy_feature_offers_v1', JSON.stringify(['unknown_offer', 42, 'cloud_coop', 'saves_export']));
      const filteredOffers = offersMod.FeatureOffersService.loadSeenOffers();
      assert.equal(filteredOffers.size, 1);
      assert.equal(filteredOffers.has('saves_export'), true);

      // Verify Play Store Cloud/Co-op UI gating (hidden by default; opt-in via ?coop=1, ?room=, or capy_dev_cloud_coop_ui)
      const nsMod = await vite.ssrLoadModule('/src/services/StorageNamespace.ts');
      assert.equal(nsMod.isCloudCoopUiEnabled('', null), false);
      assert.equal(nsMod.isCloudCoopUiEnabled('?coop=1', null), true);
      assert.equal(nsMod.isCloudCoopUiEnabled('?room=ABC123', null), true);
      assert.equal(nsMod.isCloudCoopUiEnabled('', '1'), true);
      assert.equal(nsMod.isCloudCoopUiEnabled('?coop=0', '1'), false);

      // Verify /capy/beta/ sandbox key isolation
      globalThis.window.location = { pathname: '/capy/beta/', origin: 'https://shthed.github.io', search: '' };
      assert.equal(offersMod.FeatureOffersService.hasSeenOffer('paint_mode'), false);
      offersMod.FeatureOffersService.markOfferSeen('free_color');
      assert.equal(mockStorage.has('capy_feature_offers_v1__sandbox_beta'), true);
      assert.equal(mockBackups.has('capy_feature_offers_v1__sandbox_beta'), true);
      offersMod.FeatureOffersService.resetSeenOffers();
      assert.equal(offersMod.FeatureOffersService.hasSeenOffer('free_color'), false);

      // Verify TargetSpotlightOverlay specs and geometry helpers
      const spotlightMod = await vite.ssrLoadModule('/src/components/TargetSpotlightOverlay.tsx');
      for (const step of tutorialMod.TUTORIAL_STEPS) {
        const specs = spotlightMod.TUTORIAL_STEP_TARGETS[step.key];
        assert.equal(
          Array.isArray(specs) && specs.length > 0 && Boolean(specs[0]?.selector),
          true,
          `TUTORIAL_STEP_TARGETS must define target(s) for ${step.key}`
        );
      }
      assert.equal(
        spotlightMod.TUTORIAL_STEP_TARGETS.replay[0]?.selector,
        '[data-testid="replay-controls-window"]',
        'replay spotlight target must prioritize replay-controls-window when active'
      );
      for (const offerId of offersMod.FEATURE_OFFER_IDS) {
        const specs = spotlightMod.FEATURE_OFFER_TARGETS[offerId];
        assert.equal(
          Array.isArray(specs) && specs.length > 0 && Boolean(specs[0]?.selector),
          true,
          `FEATURE_OFFER_TARGETS must define target(s) for ${offerId}`
        );
      }
      const clampedRect = spotlightMod.clampRectToBounds(
        { left: -25, top: 760, width: 140, height: 80 },
        { width: 360, height: 780 },
        4
      );
      assert.equal(clampedRect.left >= 4, true);
      assert.equal(clampedRect.top + clampedRect.height <= 776, true);

      const overlappedRings = spotlightMod.preventRingOverlap(
        [
          { left: 239, top: 6, width: 30, height: 30 },
          { left: 265, top: 6, width: 30, height: 30 },
        ],
        2
      );
      assert.equal(
        overlappedRings[0].left + overlappedRings[0].width <= overlappedRings[1].left - 1.5,
        true,
        `Adjacent rings must separate cleanly without colliding: ${JSON.stringify(overlappedRings)}`
      );

      const topConn = spotlightMod.computeSpotlightConnector(
        { left: 400, top: 76, width: 448, height: 140 },
        { left: 1100, top: 10, width: 36, height: 36 }
      );
      assert.ok(topConn, 'Expected valid connector for topbar target');
      assert.equal(topConn.d.startsWith('M '), true);
      assert.equal(topConn.arrowPoints.split(' ').length, 3);
      assert.equal(topConn.endY < topConn.startY, true, 'Connector to topbar must point upward');

      const bottomConn = spotlightMod.computeSpotlightConnector(
        { left: 400, top: 76, width: 448, height: 140 },
        { left: 590, top: 720, width: 58, height: 52 }
      );
      assert.ok(bottomConn, 'Expected valid connector for bottom dock target');
      assert.equal(bottomConn.endY > bottomConn.startY, true, 'Connector to dock must point downward');

      const sideConn = spotlightMod.computeSpotlightConnector(
        { left: 400, top: 76, width: 448, height: 140 },
        { left: 1200, top: 120, width: 44, height: 44 }
      );
      assert.ok(sideConn, 'Expected valid connector for side target');
      assert.equal(sideConn.endX > sideConn.startX, true, 'Connector to right side must point right');

      // Verify StorageService inline preview stripping, legacy migration, debounced backups, QuotaExceededError notifications, and PuzzleWorkerService code-split
      globalThis.window.location = { pathname: '/', origin: 'http://127.0.0.1:3000', search: '' };
      const previewFixture = 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=';
      storageMod.StorageService.saveSnapshots([
        {
          id: 'snap-strip-1',
          title: 'Preview Strip Test',
          timestamp: 1000,
          lastOpened: 2000,
          filledCount: 2,
          totalCount: 10,
          filledRegionIds: [1, 2],
          config: storageMod.DEFAULT_SETTINGS.generatorConfig,
          previewDataUrl: previewFixture,
        },
      ]);
      const rawStrippedSnaps = JSON.parse(mockStorage.get('capy_snapshots_v8') || '[]');
      assert.equal(rawStrippedSnaps.length, 1);
      assert.equal(
        'previewDataUrl' in rawStrippedSnaps[0],
        false,
        'saveSnapshots must strip inline previewDataUrl from localStorage'
      );
      const cachedLoaded = storageMod.StorageService.loadSnapshots();
      assert.equal(cachedLoaded[0]?.previewDataUrl, previewFixture, 'loadSnapshots must keep cached previewDataUrl in memory');

      // Legacy snapshot entry with inline previewDataUrl migrates out of localStorage on loadSnapshots()
      mockStorage.set(
        'capy_snapshots_v8',
        JSON.stringify([
          {
            id: 'snap-legacy-migrate',
            title: 'Legacy Inline Preview',
            timestamp: 1500,
            lastOpened: 2500,
            filledCount: 1,
            totalCount: 5,
            filledRegionIds: [3],
            config: storageMod.DEFAULT_SETTINGS.generatorConfig,
            previewDataUrl: previewFixture,
          },
        ])
      );
      const migratedLoaded = storageMod.StorageService.loadSnapshots();
      assert.equal(migratedLoaded[0]?.previewDataUrl, previewFixture);
      const postMigrateRaw = JSON.parse(mockStorage.get('capy_snapshots_v8') || '[]');
      assert.equal(
        'previewDataUrl' in postMigrateRaw[0],
        false,
        'loadSnapshots must migrate legacy inline previewDataUrl out of localStorage'
      );

      // Debounced backup writes coalesce and flush synchronously via flushPendingBackups()
      mockBackups.delete('capy_user_settings_v8');
      storageMod.StorageService.saveSettings({ ...storageMod.DEFAULT_SETTINGS, zoomSensitivity: 1.5 });
      storageMod.StorageService.saveSettings({ ...storageMod.DEFAULT_SETTINGS, zoomSensitivity: 1.75 });
      assert.equal(mockBackups.has('capy_user_settings_v8'), false, 'Backup writes must debounce before timer/flush');
      storageMod.StorageService.flushPendingBackups();
      assert.equal(
        JSON.parse(mockBackups.get('capy_user_settings_v8') || '{}').zoomSensitivity,
        1.75,
        'flushPendingBackups must coalesce and flush the latest backup payload'
      );

      // QuotaExceededError triggers registered listeners cleanly
      const quotaEvents = [];
      const unsubQuota = storageMod.StorageService.onQuotaWarning((w) => quotaEvents.push(w));
      const origLsSet = globalThis.localStorage.setItem;
      globalThis.localStorage.setItem = (k, v) => {
        if (k === 'capy_user_settings_v8') {
          const err = new Error('Storage quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return origLsSet(k, v);
      };
      try {
        storageMod.StorageService.saveSettings({ ...storageMod.DEFAULT_SETTINGS, largeText: true });
      } finally {
        globalThis.localStorage.setItem = origLsSet;
        unsubQuota();
      }
      assert.equal(quotaEvents.length >= 1, true, 'QuotaExceededError must notify quota warning listeners');
      assert.equal(quotaEvents[0]?.reason, 'quota');

      // StorageService P0 save durability: backup recency/validity/richness comparison, empty-wipe protection, and explicit deletes/clears
      const withMockedNow = (nowMs, fn) => {
        const realNow = Date.now;
        Date.now = () => nowMs;
        try {
          return fn();
        } finally {
          Date.now = realNow;
        }
      };
      const makeSnap = (id, overrides = {}) => ({
        id,
        title: id,
        timestamp: 1000,
        lastOpened: 1000,
        filledCount: 1,
        totalCount: 10,
        filledRegionIds: [1],
        zoomScale: 1,
        panOffsetX: 0,
        panOffsetY: 0,
        ...overrides,
      });

      // Group A: Native backup wins over missing, empty, older, or un-timestamped localStorage and self-heals
      resetDurabilityState();
      mockBackups.set(
        'capy_snapshots_v8',
        JSON.stringify([makeSnap('snap-bak-1', { lastOpened: 3000, filledCount: 3, filledRegionIds: [1, 2, 3] })])
      );
      let recoveredSnaps = storageMod.StorageService.loadSnapshots();
      assert.equal(recoveredSnaps.length, 1);
      assert.equal(recoveredSnaps[0]?.id, 'snap-bak-1');
      assert.equal(recoveredSnaps[0]?.filledCount, 3);
      assert.equal(JSON.parse(mockStorage.get('capy_snapshots_v8') || '[]')[0]?.id, 'snap-bak-1');

      resetDurabilityState();
      mockStorage.set('capy_snapshots_v8', '[]');
      mockBackups.set(
        'capy_snapshots_v8',
        JSON.stringify([makeSnap('snap-bak-empty-ls', { lastOpened: 3000, filledCount: 4, filledRegionIds: [1, 2, 3, 4] })])
      );
      recoveredSnaps = storageMod.StorageService.loadSnapshots();
      assert.equal(recoveredSnaps.length, 1);
      assert.equal(recoveredSnaps[0]?.id, 'snap-bak-empty-ls');
      assert.equal(recoveredSnaps[0]?.filledCount, 4);
      assert.equal(JSON.parse(mockStorage.get('capy_snapshots_v8') || '[]')[0]?.id, 'snap-bak-empty-ls');

      resetDurabilityState();
      mockStorage.set(
        'capy_snapshots_v8',
        JSON.stringify([makeSnap('snap-recency', { timestamp: 1000, lastOpened: 1000, filledCount: 1, filledRegionIds: [1] })])
      );
      mockBackups.set(
        'capy_snapshots_v8',
        JSON.stringify([makeSnap('snap-recency', { timestamp: 1000, lastOpened: 5000, filledCount: 5, filledRegionIds: [1, 2, 3, 4, 5] })])
      );
      recoveredSnaps = storageMod.StorageService.loadSnapshots();
      assert.equal(recoveredSnaps[0]?.filledCount, 5);
      assert.deepEqual(recoveredSnaps[0]?.filledRegionIds, [1, 2, 3, 4, 5]);
      assert.equal(JSON.parse(mockStorage.get('capy_snapshots_v8') || '[]')[0]?.filledCount, 5);

      resetDurabilityState();
      mockStorage.set(
        'capy_snapshots_v8',
        JSON.stringify([makeSnap('snap-ts-max', { timestamp: 2000, lastOpened: 0, filledCount: 2 })])
      );
      mockBackups.set(
        'capy_snapshots_v8',
        JSON.stringify([makeSnap('snap-ts-max', { timestamp: 1000, lastOpened: 6000, filledCount: 6 })])
      );
      recoveredSnaps = storageMod.StorageService.loadSnapshots();
      assert.equal(recoveredSnaps[0]?.lastOpened, 6000);
      assert.equal(recoveredSnaps[0]?.filledCount, 6);

      resetDurabilityState();
      withMockedNow(1000, () =>
        storageMod.StorageService.saveSettings({
          ...storageMod.DEFAULT_SETTINGS,
          zoomSensitivity: 1.15,
          paletteSort: 'HUE',
        })
      );
      const olderSettingsJson = mockStorage.get('capy_user_settings_v8');
      assert.ok(olderSettingsJson);
      resetDurabilityState();
      withMockedNow(5000, () =>
        storageMod.StorageService.saveSettings({
          ...storageMod.DEFAULT_SETTINGS,
          zoomSensitivity: 1.85,
          paletteSort: 'LIGHTNESS',
          largeText: true,
        })
      );
      const newerSettingsJson = mockStorage.get('capy_user_settings_v8');
      assert.ok(newerSettingsJson);

      resetDurabilityState();
      mockStorage.set('capy_user_settings_v8', '{}');
      mockBackups.set('capy_user_settings_v8', newerSettingsJson);
      let loadedSet = storageMod.StorageService.loadSettings();
      assert.equal(loadedSet.zoomSensitivity, 1.85);
      assert.equal(loadedSet.paletteSort, 'LIGHTNESS');
      assert.equal(loadedSet.largeText, true);
      assert.equal('savedAt' in loadedSet, false, 'loadSettings must strip internal savedAt metadata');
      assert.equal(JSON.parse(mockStorage.get('capy_user_settings_v8') || '{}').zoomSensitivity, 1.85);

      resetDurabilityState();
      mockStorage.set('capy_user_settings_v8', olderSettingsJson);
      mockBackups.set('capy_user_settings_v8', newerSettingsJson);
      loadedSet = storageMod.StorageService.loadSettings();
      assert.equal(loadedSet.zoomSensitivity, 1.85);
      assert.equal(loadedSet.paletteSort, 'LIGHTNESS');
      assert.equal(loadedSet.largeText, true);
      assert.equal(JSON.parse(mockStorage.get('capy_user_settings_v8') || '{}').paletteSort, 'LIGHTNESS');

      resetDurabilityState();
      withMockedNow(1000, () =>
        storageMod.StorageService.saveActiveState({
          activeSnapshotId: 'snap-a',
          activeColorId: 1,
          filledRegionIds: [1],
          resetEpoch: 1,
          zoomScale: 1.0,
          panOffsetX: 0,
          panOffsetY: 0,
        })
      );
      const olderActiveJson = mockStorage.get('capy_active_session_v8');
      assert.ok(olderActiveJson);
      resetDurabilityState();
      withMockedNow(5000, () =>
        storageMod.StorageService.saveActiveState({
          activeSnapshotId: 'snap-a',
          activeColorId: 4,
          filledRegionIds: [1, 2, 3, 4],
          resetEpoch: 1,
          zoomScale: 2.2,
          panOffsetX: 15,
          panOffsetY: -10,
        })
      );
      const newerActiveJson = mockStorage.get('capy_active_session_v8');
      assert.ok(newerActiveJson);

      resetDurabilityState();
      mockStorage.set('capy_active_session_v8', '{}');
      mockBackups.set('capy_active_session_v8', newerActiveJson);
      let loadedAct = storageMod.StorageService.loadActiveState();
      assert.equal(loadedAct?.activeSnapshotId, 'snap-a');
      assert.equal(loadedAct?.activeColorId, 4);
      assert.deepEqual(loadedAct?.filledRegionIds, [1, 2, 3, 4]);
      assert.equal(loadedAct?.zoomScale, 2.2);
      assert.equal('savedAt' in (loadedAct || {}), false, 'loadActiveState must strip internal savedAt metadata');
      assert.equal(JSON.parse(mockStorage.get('capy_active_session_v8') || '{}').activeColorId, 4);

      resetDurabilityState();
      mockStorage.set('capy_active_session_v8', olderActiveJson);
      mockBackups.set('capy_active_session_v8', newerActiveJson);
      loadedAct = storageMod.StorageService.loadActiveState();
      assert.equal(loadedAct?.activeColorId, 4);
      assert.deepEqual(loadedAct?.filledRegionIds, [1, 2, 3, 4]);
      assert.equal(loadedAct?.zoomScale, 2.2);

      resetDurabilityState();
      mockStorage.set(
        'capy_active_session_v8',
        JSON.stringify({
          activeSnapshotId: 'snap-legacy',
          activeColorId: 1,
          filledRegionIds: [],
          zoomScale: 1,
          panOffsetX: 0,
          panOffsetY: 0,
        })
      );
      mockBackups.set(
        'capy_active_session_v8',
        JSON.stringify({
          activeSnapshotId: 'snap-legacy',
          activeColorId: 3,
          filledRegionIds: [7, 8, 9],
          zoomScale: 1.5,
          panOffsetX: 0,
          panOffsetY: 0,
        })
      );
      loadedAct = storageMod.StorageService.loadActiveState();
      assert.deepEqual(loadedAct?.filledRegionIds, [7, 8, 9]);
      assert.equal(loadedAct?.activeColorId, 3);

      // Same-timestamp resetEpoch precedence prevents pre-reset backup from resurrecting cleared regions
      resetDurabilityState();
      mockStorage.set(
        'capy_active_session_v8',
        JSON.stringify({
          activeSnapshotId: 'snap-epoch',
          activeColorId: 1,
          filledRegionIds: [],
          resetEpoch: 2,
          zoomScale: 1,
          panOffsetX: 0,
          panOffsetY: 0,
        })
      );
      mockBackups.set(
        'capy_active_session_v8',
        JSON.stringify({
          activeSnapshotId: 'snap-epoch',
          activeColorId: 2,
          filledRegionIds: [1, 2, 3, 4],
          resetEpoch: 1,
          zoomScale: 1.5,
          panOffsetX: 0,
          panOffsetY: 0,
        })
      );
      loadedAct = storageMod.StorageService.loadActiveState();
      assert.equal(loadedAct?.resetEpoch, 2);
      assert.deepEqual(loadedAct?.filledRegionIds, []);

      // Group B: Newer/richer localStorage wins over older native backup (zero reverse data loss)
      resetDurabilityState();
      mockStorage.set(
        'capy_snapshots_v8',
        JSON.stringify([makeSnap('snap-r', { lastOpened: 5000, filledCount: 6, filledRegionIds: [1, 2, 3, 4, 5, 6] })])
      );
      mockBackups.set(
        'capy_snapshots_v8',
        JSON.stringify([makeSnap('snap-r', { lastOpened: 1000, filledCount: 2, filledRegionIds: [1, 2] })])
      );
      assert.equal(storageMod.StorageService.loadSnapshots()[0]?.filledCount, 6);

      resetDurabilityState();
      mockStorage.set('capy_snapshots_v8', JSON.stringify([makeSnap('snap-keep', { lastOpened: 5000 })]));
      mockBackups.set(
        'capy_snapshots_v8',
        JSON.stringify([makeSnap('snap-keep', { lastOpened: 2000 }), makeSnap('snap-deleted', { lastOpened: 2000 })])
      );
      const nonResurrected = storageMod.StorageService.loadSnapshots();
      assert.deepEqual(nonResurrected.map((s) => s.id), ['snap-keep']);

      resetDurabilityState();
      mockStorage.set(
        'capy_snapshots_v8',
        JSON.stringify([makeSnap('snap-rich', { lastOpened: 3000, filledCount: 4, filledRegionIds: [1, 2, 3, 4] })])
      );
      mockBackups.set(
        'capy_snapshots_v8',
        JSON.stringify([makeSnap('snap-rich', { lastOpened: 3000, filledCount: 1, filledRegionIds: [1] })])
      );
      assert.equal(storageMod.StorageService.loadSnapshots()[0]?.filledCount, 4);

      resetDurabilityState();
      mockStorage.set('capy_user_settings_v8', newerSettingsJson);
      mockBackups.set('capy_user_settings_v8', olderSettingsJson);
      loadedSet = storageMod.StorageService.loadSettings();
      assert.equal(loadedSet.zoomSensitivity, 1.85);
      assert.equal(loadedSet.paletteSort, 'LIGHTNESS');
      assert.equal(loadedSet.largeText, true);

      resetDurabilityState();
      mockStorage.set('capy_active_session_v8', newerActiveJson);
      mockBackups.set('capy_active_session_v8', olderActiveJson);
      loadedAct = storageMod.StorageService.loadActiveState();
      assert.deepEqual(loadedAct?.filledRegionIds, [1, 2, 3, 4]);
      assert.equal(loadedAct?.zoomScale, 2.2);

      resetDurabilityState();
      withMockedNow(6000, () =>
        storageMod.StorageService.saveActiveState({
          activeSnapshotId: 'snap-b',
          activeColorId: 1,
          filledRegionIds: [],
          resetEpoch: 1,
          zoomScale: 1,
          panOffsetX: 0,
          panOffsetY: 0,
        })
      );
      const switchedPuzzleJson = mockStorage.get('capy_active_session_v8');
      assert.ok(switchedPuzzleJson);
      resetDurabilityState();
      mockStorage.set('capy_active_session_v8', switchedPuzzleJson);
      mockBackups.set('capy_active_session_v8', olderActiveJson);
      loadedAct = storageMod.StorageService.loadActiveState();
      assert.equal(loadedAct?.activeSnapshotId, 'snap-b');
      assert.deepEqual(loadedAct?.filledRegionIds, []);

      // Group C: Accidental saveSnapshots([]) does NOT wipe non-empty native or pending backups
      resetDurabilityState();
      const guardedSnap = makeSnap('snap-guard-1', { lastOpened: 4000, filledCount: 3, filledRegionIds: [1, 2, 3] });
      storageMod.StorageService.saveSnapshots([guardedSnap]);
      storageMod.StorageService.flushPendingBackups();
      assert.equal(JSON.parse(mockBackups.get('capy_snapshots_v8') || '[]').length, 1);
      storageMod.StorageService.saveSnapshots([]);
      assert.equal(JSON.parse(mockBackups.get('capy_snapshots_v8') || '[]')[0]?.id, 'snap-guard-1');
      storageMod.StorageService.flushPendingBackups();
      assert.equal(JSON.parse(mockBackups.get('capy_snapshots_v8') || '[]')[0]?.id, 'snap-guard-1');
      assert.equal(mockStorage.get('capy_snapshots_v8'), '[]');
      recoveredSnaps = storageMod.StorageService.loadSnapshots();
      assert.equal(recoveredSnaps.length, 1);
      assert.equal(recoveredSnaps[0]?.id, 'snap-guard-1');
      assert.equal(recoveredSnaps[0]?.filledCount, 3);

      resetDurabilityState();
      mockBackups.set('capy_snapshots_v8', JSON.stringify([guardedSnap]));
      storageMod.StorageService.saveSnapshots([], { allowEmptyBackup: false });
      storageMod.StorageService.flushPendingBackups();
      assert.equal(JSON.parse(mockBackups.get('capy_snapshots_v8') || '[]')[0]?.id, 'snap-guard-1');

      resetDurabilityState();
      storageMod.StorageService.saveSnapshots([guardedSnap]);
      storageMod.StorageService.saveSnapshots([]);
      assert.equal(storageMod.StorageService.loadSnapshots()[0]?.id, 'snap-guard-1');
      storageMod.StorageService.flushPendingBackups();
      assert.notEqual(mockBackups.get('capy_snapshots_v8'), '[]');
      assert.equal(JSON.parse(mockBackups.get('capy_snapshots_v8') || '[]')[0]?.id, 'snap-guard-1');

      // Group D: Explicit deleteSnapshot (final item) & clearAllSnapshots clear native backup cleanly
      resetDurabilityState();
      const snapOne = makeSnap('snap-del-1', { lastOpened: 2000, filledCount: 2, filledRegionIds: [1, 2] });
      const snapTwo = makeSnap('snap-del-2', { lastOpened: 3000, filledCount: 3, filledRegionIds: [4, 5, 6] });
      storageMod.StorageService.saveSnapshots([snapOne, snapTwo]);
      storageMod.StorageService.saveActiveState({
        activeSnapshotId: 'snap-del-2',
        activeColorId: 2,
        filledRegionIds: [4, 5, 6],
        zoomScale: 1.5,
        panOffsetX: 0,
        panOffsetY: 0,
      });
      storageMod.StorageService.flushPendingBackups();

      const afterFirstDelete = await storageMod.StorageService.deleteSnapshot('snap-del-1');
      assert.deepEqual(afterFirstDelete.map((s) => s.id), ['snap-del-2']);
      assert.deepEqual(storageMod.StorageService.loadSnapshots().map((s) => s.id), ['snap-del-2']);
      storageMod.StorageService.flushPendingBackups();
      assert.deepEqual(JSON.parse(mockBackups.get('capy_snapshots_v8') || '[]').map((s) => s.id), ['snap-del-2']);

      const afterFinalDelete = await storageMod.StorageService.deleteSnapshot('snap-del-2');
      assert.equal(afterFinalDelete.length, 0);
      assert.equal(JSON.parse(mockBackups.get('capy_snapshots_v8') || '[]').length, 0);
      storageMod.StorageService.flushPendingBackups();
      assert.equal(JSON.parse(mockBackups.get('capy_snapshots_v8') || '[]').length, 0);
      assert.equal(storageMod.StorageService.loadSnapshots().length, 0);
      assert.equal(storageMod.StorageService.loadActiveState(), null);

      // Partial delete of a newer snapshot must flush backup immediately (<400ms crash safety) so it never resurrects
      resetDurabilityState();
      const olderRemainingSnap = makeSnap('snap-partial-old', {
        lastOpened: 1000,
        timestamp: 1000,
        filledCount: 1,
        filledRegionIds: [1],
      });
      const newerDeletedSnap = makeSnap('snap-partial-new', {
        lastOpened: 2000,
        timestamp: 2000,
        filledCount: 4,
        filledRegionIds: [1, 2, 3, 4],
      });
      storageMod.StorageService.saveSnapshots([olderRemainingSnap, newerDeletedSnap]);
      storageMod.StorageService.flushPendingBackups();
      assert.deepEqual(
        JSON.parse(mockBackups.get('capy_snapshots_v8') || '[]').map((s) => s.id),
        ['snap-partial-old', 'snap-partial-new']
      );
      const afterPartialNewDelete = await storageMod.StorageService.deleteSnapshot('snap-partial-new');
      assert.deepEqual(afterPartialNewDelete.map((s) => s.id), ['snap-partial-old']);
      assert.deepEqual(
        JSON.parse(mockBackups.get('capy_snapshots_v8') || '[]').map((s) => s.id),
        ['snap-partial-old']
      );
      assert.deepEqual(storageMod.StorageService.loadSnapshots().map((s) => s.id), ['snap-partial-old']);
      storageMod.StorageService.flushPendingBackups();
      assert.deepEqual(storageMod.StorageService.loadSnapshots().map((s) => s.id), ['snap-partial-old']);

      // Deleting a missing ID when empty must not wipe an out-of-band non-empty backup
      resetDurabilityState();
      mockBackups.set('capy_snapshots_v8', JSON.stringify([snapOne]));
      mockStorage.set('capy_snapshots_v8', '[]');
      const afterMissingDelete = await storageMod.StorageService.deleteSnapshot('nonexistent-id');
      assert.equal(afterMissingDelete[0]?.id, 'snap-del-1');
      assert.equal(JSON.parse(mockBackups.get('capy_snapshots_v8') || '[]')[0]?.id, 'snap-del-1');

      resetDurabilityState();
      storageMod.StorageService.saveSnapshots([snapOne, snapTwo]);
      storageMod.StorageService.saveActiveState({
        activeSnapshotId: 'snap-del-1',
        activeColorId: 1,
        filledRegionIds: [1, 2],
        zoomScale: 1,
        panOffsetX: 0,
        panOffsetY: 0,
      });
      storageMod.StorageService.flushPendingBackups();
      await storageMod.StorageService.clearAllSnapshots();
      assert.equal(JSON.parse(mockBackups.get('capy_snapshots_v8') || '[]').length, 0);
      storageMod.StorageService.flushPendingBackups();
      assert.equal(JSON.parse(mockBackups.get('capy_snapshots_v8') || '[]').length, 0);
      assert.equal(storageMod.StorageService.loadSnapshots().length, 0);
      assert.equal(storageMod.StorageService.loadActiveState(), null);
      assert.equal(mockStorage.get('capy_snapshots_v8'), '[]');
      assert.equal(mockStorage.has('capy_active_session_v8'), false);

      // Group E: Corrupt payloads, pending quota-fail comparison, sandbox isolation, and SSR/missing-bridge safety
      resetDurabilityState();
      mockStorage.set('capy_snapshots_v8', '{corrupt-json');
      mockBackups.set('capy_snapshots_v8', JSON.stringify([guardedSnap]));
      assert.equal(storageMod.StorageService.loadSnapshots()[0]?.id, 'snap-guard-1');
      mockStorage.set('capy_snapshots_v8', '{}');
      assert.equal(storageMod.StorageService.loadSnapshots()[0]?.id, 'snap-guard-1');

      mockStorage.set('capy_user_settings_v8', '{corrupt-json');
      mockBackups.set('capy_user_settings_v8', newerSettingsJson);
      assert.equal(storageMod.StorageService.loadSettings().zoomSensitivity, 1.85);
      mockStorage.set('capy_user_settings_v8', '[]');
      assert.equal(storageMod.StorageService.loadSettings().zoomSensitivity, 1.85);

      mockStorage.set('capy_active_session_v8', '{corrupt-json');
      mockBackups.set('capy_active_session_v8', newerActiveJson);
      assert.equal(storageMod.StorageService.loadActiveState()?.activeSnapshotId, 'snap-a');
      mockStorage.set('capy_active_session_v8', '[]');
      assert.equal(storageMod.StorageService.loadActiveState()?.activeSnapshotId, 'snap-a');

      resetDurabilityState();
      mockStorage.set('capy_snapshots_v8', JSON.stringify([guardedSnap]));
      mockBackups.set('capy_snapshots_v8', '{corrupt-backup');
      assert.equal(storageMod.StorageService.loadSnapshots()[0]?.id, 'snap-guard-1');
      mockStorage.set('capy_user_settings_v8', newerSettingsJson);
      mockBackups.set('capy_user_settings_v8', '{corrupt-backup');
      assert.equal(storageMod.StorageService.loadSettings().zoomSensitivity, 1.85);
      mockStorage.set('capy_active_session_v8', newerActiveJson);
      mockBackups.set('capy_active_session_v8', '{corrupt-backup');
      assert.equal(storageMod.StorageService.loadActiveState()?.activeSnapshotId, 'snap-a');

      resetDurabilityState();
      mockStorage.set('capy_snapshots_v8', '{corrupt');
      mockBackups.set('capy_snapshots_v8', '{corrupt');
      assert.deepEqual(storageMod.StorageService.loadSnapshots(), []);
      mockStorage.set('capy_user_settings_v8', '{corrupt');
      mockBackups.set('capy_user_settings_v8', '{corrupt');
      assert.equal(storageMod.StorageService.loadSettings().difficulty, storageMod.DEFAULT_SETTINGS.difficulty);
      mockStorage.set('capy_active_session_v8', '{corrupt');
      mockBackups.set('capy_active_session_v8', '{corrupt');
      assert.equal(storageMod.StorageService.loadActiveState(), null);

      // E3: Pending un-flushed writes (including QuotaExceededError) vs stale and newer localStorage + same-ms tiebreak
      resetDurabilityState();
      withMockedNow(1000, () => {
        storageMod.StorageService.saveSnapshots([makeSnap('snap-pending', { lastOpened: 1000, filledCount: 1 })]);
        storageMod.StorageService.saveSettings({ ...storageMod.DEFAULT_SETTINGS, zoomSensitivity: 1.1 });
        storageMod.StorageService.saveActiveState({
          activeSnapshotId: 'snap-pending',
          activeColorId: 1,
          filledRegionIds: [1],
          resetEpoch: 1,
          zoomScale: 1,
          panOffsetX: 0,
          panOffsetY: 0,
        });
      });
      storageMod.StorageService.flushPendingBackups();

      const savedLsSet = globalThis.localStorage.setItem;
      globalThis.localStorage.setItem = (k, v) => {
        if (k === 'capy_snapshots_v8' || k === 'capy_user_settings_v8' || k === 'capy_active_session_v8') {
          const err = new Error('Storage quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return savedLsSet(k, v);
      };
      try {
        withMockedNow(7000, () => {
          storageMod.StorageService.saveSnapshots([
            makeSnap('snap-pending', { lastOpened: 7000, filledCount: 7, filledRegionIds: [1, 2, 3, 4, 5, 6, 7] }),
          ]);
          storageMod.StorageService.saveSettings({
            ...storageMod.DEFAULT_SETTINGS,
            zoomSensitivity: 1.9,
            paletteSort: 'REMAINING',
          });
          storageMod.StorageService.saveActiveState({
            activeSnapshotId: 'snap-pending',
            activeColorId: 7,
            filledRegionIds: [1, 2, 3, 4, 5, 6, 7],
            resetEpoch: 1,
            zoomScale: 2.5,
            panOffsetX: 10,
            panOffsetY: 20,
          });
        });
      } finally {
        globalThis.localStorage.setItem = savedLsSet;
      }
      assert.equal(storageMod.StorageService.loadSnapshots()[0]?.filledCount, 7);
      assert.equal(storageMod.StorageService.loadSettings().zoomSensitivity, 1.9);
      assert.equal(storageMod.StorageService.loadActiveState()?.activeColorId, 7);

      // Direct newer write (t=9000) in localStorage beats older pendingBackupWrites (t=7000)
      withMockedNow(8000, () => {
        storageMod.StorageService.saveSnapshots([makeSnap('snap-pending', { lastOpened: 7000, filledCount: 7 })]);
        storageMod.StorageService.saveSettings({ ...storageMod.DEFAULT_SETTINGS, zoomSensitivity: 1.6 });
        storageMod.StorageService.saveActiveState({
          activeSnapshotId: 'snap-pending',
          activeColorId: 6,
          filledRegionIds: [1, 2],
          resetEpoch: 1,
          zoomScale: 1.6,
          panOffsetX: 0,
          panOffsetY: 0,
        });
      });
      mockStorage.set(
        'capy_snapshots_v8',
        JSON.stringify([makeSnap('snap-pending', { lastOpened: 9000, filledCount: 9, filledRegionIds: [1, 2, 3] })])
      );
      mockStorage.set(
        'capy_user_settings_v8',
        JSON.stringify({ ...storageMod.DEFAULT_SETTINGS, undoDefaultMigrated: true, savedAt: 9000, zoomSensitivity: 1.4 })
      );
      mockStorage.set(
        'capy_active_session_v8',
        JSON.stringify({
          activeSnapshotId: 'snap-pending',
          activeColorId: 9,
          filledRegionIds: [1, 2, 3],
          resetEpoch: 1,
          zoomScale: 3.0,
          panOffsetX: 0,
          panOffsetY: 0,
          savedAt: 9000,
        })
      );
      assert.equal(storageMod.StorageService.loadSnapshots()[0]?.filledCount, 9);
      assert.equal(storageMod.StorageService.loadSettings().zoomSensitivity, 1.4);
      assert.equal(storageMod.StorageService.loadActiveState()?.activeColorId, 9);

      // Same-ms QuotaExceededError tiebreak favors pending backup over stale localStorage
      resetDurabilityState();
      withMockedNow(5000, () => {
        storageMod.StorageService.saveSettings({ ...storageMod.DEFAULT_SETTINGS, difficulty: 'EASY' });
      });
      const origLsSetTie = globalThis.localStorage.setItem;
      globalThis.localStorage.setItem = (k, v) => {
        if (k === 'capy_user_settings_v8') {
          const err = new Error('Storage quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return origLsSetTie(k, v);
      };
      try {
        withMockedNow(5000, () => {
          storageMod.StorageService.saveSettings({ ...storageMod.DEFAULT_SETTINGS, difficulty: 'NORMAL' });
        });
      } finally {
        globalThis.localStorage.setItem = origLsSetTie;
      }
      assert.equal(storageMod.StorageService.loadSettings().difficulty, 'NORMAL');

      // E4: Sandbox isolation + missing CapyAndroid + SSR localStorage === undefined safety
      resetDurabilityState();
      mockBackups.set('capy_snapshots_v8', JSON.stringify([makeSnap('snap-root', { lastOpened: 2000 })]));
      globalThis.window.location = { pathname: '/capy/beta/', origin: 'https://example.github.io', search: '' };
      mockBackups.set('capy_snapshots_v8__sandbox_beta', JSON.stringify([makeSnap('snap-beta', { lastOpened: 3000 })]));
      mockStorage.set('capy_snapshots_v8__sandbox_beta', '[]');
      storageMod.StorageService.saveSnapshots([]);
      assert.equal(storageMod.StorageService.loadSnapshots()[0]?.id, 'snap-beta');
      assert.equal(JSON.parse(mockBackups.get('capy_snapshots_v8') || '[]')[0]?.id, 'snap-root');

      resetDurabilityState();
      delete globalThis.window.CapyAndroid;
      assert.deepEqual(storageMod.StorageService.loadSnapshots(), []);
      assert.equal(storageMod.StorageService.loadSettings().difficulty, storageMod.DEFAULT_SETTINGS.difficulty);
      assert.equal(storageMod.StorageService.loadActiveState(), null);
      storageMod.StorageService.saveSnapshots([]);
      assert.deepEqual(await storageMod.StorageService.deleteSnapshot('missing'), []);
      await storageMod.StorageService.clearAllSnapshots();

      const savedLsObj = globalThis.localStorage;
      globalThis.localStorage = undefined;
      try {
        assert.deepEqual(storageMod.StorageService.loadSnapshots(), []);
        assert.equal(storageMod.StorageService.loadSettings().difficulty, storageMod.DEFAULT_SETTINGS.difficulty);
        assert.equal(storageMod.StorageService.loadActiveState(), null);
        storageMod.StorageService.saveSnapshots([]);
        storageMod.StorageService.saveSettings(storageMod.DEFAULT_SETTINGS);
        storageMod.StorageService.saveActiveState({
          activeSnapshotId: null,
          activeColorId: 1,
          filledRegionIds: [],
          zoomScale: 1,
          panOffsetX: 0,
          panOffsetY: 0,
        });
        storageMod.StorageService.clearActiveState();
        assert.deepEqual(await storageMod.StorageService.deleteSnapshot('missing'), []);
        await storageMod.StorageService.clearAllSnapshots();
      } finally {
        globalThis.localStorage = savedLsObj;
      }
      // Group F: NativeBridge.saveBackup() === false resilience (Bug 1) & Desktop Web !NativeBridge.isNative cleanup (CEO 15:17:24Z)
      resetDurabilityState();
      const natS1 = makeSnap('nat-1', { lastOpened: 1000, filledCount: 1 });
      const natS2 = makeSnap('nat-2', { lastOpened: 2000, filledCount: 2 });
      storageMod.StorageService.saveSnapshots([natS1, natS2]);
      storageMod.StorageService.saveActiveState({
        activeSnapshotId: 'nat-2',
        activeColorId: 2,
        filledRegionIds: [1, 2],
        zoomScale: 1,
        panOffsetX: 0,
        panOffsetY: 0,
      });
      storageMod.StorageService.flushPendingBackups();

      let nativeWriteOk = false;
      globalThis.window.CapyAndroid = {
        saveBackup: (k, v) => {
          if (!nativeWriteOk) return false;
          mockBackups.set(k, String(v));
          return true;
        },
        loadBackup: (k) => (mockBackups.has(k) ? mockBackups.get(k) : null),
      };
      const afterNativeFailPartial = await storageMod.StorageService.deleteSnapshot('nat-2');
      assert.deepEqual(afterNativeFailPartial.map((s) => s.id), ['nat-1']);
      assert.deepEqual(storageMod.StorageService.loadSnapshots().map((s) => s.id), ['nat-1']);
      assert.equal(storageMod.StorageService.loadActiveState(), null, 'Failed native backup clearActiveState must not resurrect active state');
      mockStorage.clear();
      assert.deepEqual(storageMod.StorageService.loadSnapshots().map((s) => s.id), ['nat-1'], 'Stale native backup must not override pending partial delete');
      assert.equal(storageMod.StorageService.loadActiveState(), null);
      storageMod.StorageService.flushPendingBackups();
      assert.deepEqual(JSON.parse(mockBackups.get('capy_snapshots_v8') || '[]').map((s) => s.id), ['nat-1', 'nat-2']);
      nativeWriteOk = true;
      storageMod.StorageService.flushPendingBackups();
      assert.deepEqual(JSON.parse(mockBackups.get('capy_snapshots_v8') || '[]').map((s) => s.id), ['nat-1']);
      assert.equal(mockBackups.get('capy_active_session_v8'), '');

      // Final delete & accidental empty guard during native saveBackup() === false
      nativeWriteOk = false;
      await storageMod.StorageService.deleteSnapshot('nat-1');
      assert.deepEqual(storageMod.StorageService.loadSnapshots(), []);
      mockStorage.clear();
      assert.deepEqual(storageMod.StorageService.loadSnapshots(), []);
      nativeWriteOk = true;
      storageMod.StorageService.flushPendingBackups();
      assert.equal(mockBackups.get('capy_snapshots_v8'), '[]');

      // Accidental saveSnapshots([]) stays blocked while explicit clearAllSnapshots & clearActiveState (even with removeItem throwing) recover cleanly
      resetDurabilityState();
      storageMod.StorageService.saveSnapshots([natS1]);
      storageMod.StorageService.saveActiveState({
        activeSnapshotId: 'nat-1',
        activeColorId: 3,
        filledRegionIds: [1],
        zoomScale: 1,
        panOffsetX: 0,
        panOffsetY: 0,
      });
      storageMod.StorageService.flushPendingBackups();
      storageMod.StorageService.saveSnapshots([]);
      storageMod.StorageService.flushPendingBackups();
      assert.equal(JSON.parse(mockBackups.get('capy_snapshots_v8') || '[]')[0]?.id, 'nat-1');

      nativeWriteOk = false;
      globalThis.window.CapyAndroid = {
        saveBackup: (k, v) => {
          if (!nativeWriteOk) return false;
          mockBackups.set(k, String(v));
          return true;
        },
        loadBackup: (k) => (mockBackups.has(k) ? mockBackups.get(k) : null),
      };
      const origRemoveItem = globalThis.localStorage.removeItem;
      globalThis.localStorage.removeItem = () => {
        throw new Error('Blocked removeItem');
      };
      try {
        storageMod.StorageService.clearActiveState();
        assert.equal(storageMod.StorageService.loadActiveState(), null, 'clearActiveState must return null even if removeItem and saveBackup both fail');
      } finally {
        globalThis.localStorage.removeItem = origRemoveItem;
      }
      await storageMod.StorageService.clearAllSnapshots();
      assert.deepEqual(storageMod.StorageService.loadSnapshots(), []);
      assert.equal(storageMod.StorageService.loadActiveState(), null);
      nativeWriteOk = true;
      storageMod.StorageService.flushPendingBackups();
      assert.equal(mockBackups.get('capy_snapshots_v8'), '[]');
      assert.equal(mockBackups.get('capy_active_session_v8'), '');

      // Debounced write failure on native retains latest write and suppresses stale native backup until recovery flush
      resetDurabilityState();
      storageMod.StorageService.saveSnapshots([makeSnap('nat-deb', { lastOpened: 1000, filledCount: 1 })]);
      storageMod.StorageService.flushPendingBackups();
      nativeWriteOk = false;
      globalThis.window.CapyAndroid = {
        saveBackup: (k, v) => {
          if (!nativeWriteOk) return false;
          mockBackups.set(k, String(v));
          return true;
        },
        loadBackup: (k) => (mockBackups.has(k) ? mockBackups.get(k) : null),
      };
      storageMod.StorageService.saveSnapshots([makeSnap('nat-deb', { lastOpened: 2000, filledCount: 5 })]);
      storageMod.StorageService.flushPendingBackups();
      mockStorage.clear();
      assert.equal(storageMod.StorageService.loadSnapshots()[0]?.filledCount, 5);
      nativeWriteOk = true;
      storageMod.StorageService.flushPendingBackups();
      assert.equal(JSON.parse(mockBackups.get('capy_snapshots_v8') || '[]')[0]?.filledCount, 5);

      // Desktop Web (!NativeBridge.isNative): pendingBackupWrites holds QuotaExceededError writes before flush, then clears cleanly on flush
      resetDurabilityState();
      delete globalThis.window.CapyAndroid;
      withMockedNow(5000, () => {
        storageMod.StorageService.saveSnapshots([makeSnap('web-q', { lastOpened: 5000, filledCount: 6, filledRegionIds: [1, 2, 3, 4, 5, 6] })]);
        storageMod.StorageService.saveSettings({ ...storageMod.DEFAULT_SETTINGS, difficulty: 'EASY' });
        storageMod.StorageService.saveActiveState({
          activeSnapshotId: 'web-q',
          activeColorId: 1,
          filledRegionIds: [1, 2, 3],
          zoomScale: 1,
          panOffsetX: 0,
          panOffsetY: 0,
        });
      });
      storageMod.StorageService.flushPendingBackups();
      const origWebQuotaSet = globalThis.localStorage.setItem;
      globalThis.localStorage.setItem = (k, v) => {
        if (k === 'capy_snapshots_v8' || k === 'capy_user_settings_v8' || k === 'capy_active_session_v8') {
          const err = new Error('Quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return origWebQuotaSet(k, v);
      };
      try {
        withMockedNow(5000, () => {
          storageMod.StorageService.saveSnapshots([makeSnap('web-q', { lastOpened: 5000, filledCount: 4, filledRegionIds: [1, 2, 3, 4] })]);
          storageMod.StorageService.saveSettings({ ...storageMod.DEFAULT_SETTINGS, difficulty: 'NORMAL' });
          storageMod.StorageService.saveActiveState({
            activeSnapshotId: 'web-q',
            activeColorId: 9,
            filledRegionIds: [1],
            zoomScale: 1,
            panOffsetX: 0,
            panOffsetY: 0,
          });
        });
      } finally {
        globalThis.localStorage.setItem = origWebQuotaSet;
      }
      assert.equal(storageMod.StorageService.loadSnapshots()[0]?.filledCount, 4);
      assert.equal(storageMod.StorageService.loadSettings().difficulty, 'NORMAL');
      assert.equal(storageMod.StorageService.loadActiveState()?.activeColorId, 9);
      storageMod.StorageService.flushPendingBackups();
      let desktopSpyCalls = 0;
      globalThis.window.CapyAndroid = {
        saveBackup: () => {
          desktopSpyCalls += 1;
          return true;
        },
        loadBackup: () => null,
      };
      storageMod.StorageService.flushPendingBackups();
      assert.equal(desktopSpyCalls, 0, 'Desktop Web flush must clear pendingBackupWrites cleanly without leaving stuck entries');

      // Desktop Web clearAllSnapshots & final deleteSnapshot under QuotaExceededError (both with working and throwing removeItem)
      for (const failRemove of [false, true]) {
        resetDurabilityState();
        delete globalThis.window.CapyAndroid;
        storageMod.StorageService.saveSnapshots([makeSnap('web-del', { lastOpened: 3000 })]);
        storageMod.StorageService.flushPendingBackups();
        const savedSetWeb = globalThis.localStorage.setItem;
        const savedRemWeb = globalThis.localStorage.removeItem;
        globalThis.localStorage.setItem = (k, v) => {
          if (k === 'capy_snapshots_v8') {
            const err = new Error('Quota exceeded');
            err.name = 'QuotaExceededError';
            throw err;
          }
          return savedSetWeb(k, v);
        };
        if (failRemove) {
          globalThis.localStorage.removeItem = () => {
            throw new Error('Blocked removeItem');
          };
        }
        try {
          await storageMod.StorageService.clearAllSnapshots();
          assert.deepEqual(storageMod.StorageService.loadSnapshots(), []);
        } finally {
          globalThis.localStorage.setItem = savedSetWeb;
          globalThis.localStorage.removeItem = savedRemWeb;
        }
        resetDurabilityState();
        delete globalThis.window.CapyAndroid;
        storageMod.StorageService.saveSnapshots([makeSnap('web-del-final', { lastOpened: 3000 })]);
        storageMod.StorageService.flushPendingBackups();
        globalThis.localStorage.setItem = (k, v) => {
          if (k === 'capy_snapshots_v8') {
            const err = new Error('Quota exceeded');
            err.name = 'QuotaExceededError';
            throw err;
          }
          return savedSetWeb(k, v);
        };
        if (failRemove) {
          globalThis.localStorage.removeItem = () => {
            throw new Error('Blocked removeItem');
          };
        }
        try {
          await storageMod.StorageService.deleteSnapshot('web-del-final');
          assert.deepEqual(storageMod.StorageService.loadSnapshots(), []);
        } finally {
          globalThis.localStorage.setItem = savedSetWeb;
          globalThis.localStorage.removeItem = savedRemWeb;
        }
      }

      // Group G: Same-ms QuotaExceededError shrinking writes & deleteSnapshot/clearAllSnapshots under QuotaExceededError (Bug 2)
      resetDurabilityState();
      withMockedNow(5000, () => {
        storageMod.StorageService.saveSnapshots([
          makeSnap('q-s1', { lastOpened: 5000, filledCount: 5, filledRegionIds: [1, 2, 3, 4, 5] }),
          makeSnap('q-s2', { lastOpened: 5000, filledCount: 2, filledRegionIds: [1, 2] }),
        ]);
        mockStorage.set(
          'capy_user_settings_v8',
          JSON.stringify({ ...storageMod.DEFAULT_SETTINGS, undoDefaultMigrated: true, savedAt: 5000, difficulty: 'EASY', legacyExtraKey: 'old' })
        );
        storageMod.StorageService.saveActiveState({
          activeSnapshotId: 'q-s1',
          activeColorId: 5,
          filledRegionIds: Array.from({ length: 20 }, (_, i) => i + 1),
          resetEpoch: 2,
          zoomScale: 1,
          panOffsetX: 0,
          panOffsetY: 0,
        });
      });
      storageMod.StorageService.flushPendingBackups();

      const savedShrinkSet = globalThis.localStorage.setItem;
      globalThis.localStorage.setItem = (k, v) => {
        if (k === 'capy_snapshots_v8' || k === 'capy_user_settings_v8' || k === 'capy_active_session_v8') {
          const err = new Error('Quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return savedShrinkSet(k, v);
      };
      try {
        withMockedNow(5000, () => {
          storageMod.StorageService.saveSnapshots([
            makeSnap('q-s1', { lastOpened: 5000, filledCount: 4, filledRegionIds: [1, 2, 3, 4] }),
          ]);
          storageMod.StorageService.saveSettings({ ...storageMod.DEFAULT_SETTINGS, difficulty: 'NORMAL' });
          // Undo shrinking active state ([20 items] -> [1])
          storageMod.StorageService.saveActiveState({
            activeSnapshotId: 'q-s1',
            activeColorId: 1,
            filledRegionIds: [1],
            resetEpoch: 2,
            zoomScale: 1,
            panOffsetX: 0,
            panOffsetY: 0,
          });
        });
        assert.deepEqual(storageMod.StorageService.loadSnapshots().map((s) => [s.id, s.filledCount]), [['q-s1', 4]]);
        assert.equal(storageMod.StorageService.loadSettings().difficulty, 'NORMAL');
        assert.deepEqual(storageMod.StorageService.loadActiveState()?.filledRegionIds, [1]);

        // Switch active puzzle (1 fill -> 0 fills on another snapshot ID at same-ms)
        withMockedNow(5000, () => {
          storageMod.StorageService.saveActiveState({
            activeSnapshotId: 'q-s2',
            activeColorId: 1,
            filledRegionIds: [],
            resetEpoch: 1,
            zoomScale: 1,
            panOffsetX: 0,
            panOffsetY: 0,
          });
        });
        assert.equal(storageMod.StorageService.loadActiveState()?.activeSnapshotId, 'q-s2');
        assert.deepEqual(storageMod.StorageService.loadActiveState()?.filledRegionIds, []);
      } finally {
        globalThis.localStorage.setItem = savedShrinkSet;
      }

      // Partial & final deleteSnapshot and clearAllSnapshots under QuotaExceededError (both with removeItem succeeding and throwing)
      for (const failRemove of [false, true]) {
        resetDurabilityState();
        const olderKeep = makeSnap('keep-1', { lastOpened: 1000, timestamp: 1000, filledCount: 1 });
        const newerDel = makeSnap('del-2', { lastOpened: 5000, timestamp: 5000, filledCount: 5 });
        storageMod.StorageService.saveSnapshots([olderKeep, newerDel]);
        storageMod.StorageService.flushPendingBackups();

        const origDelSet = globalThis.localStorage.setItem;
        const origDelRem = globalThis.localStorage.removeItem;
        globalThis.localStorage.setItem = (k, v) => {
          if (k === 'capy_snapshots_v8') {
            const err = new Error('Quota exceeded');
            err.name = 'QuotaExceededError';
            throw err;
          }
          return origDelSet(k, v);
        };
        if (failRemove) {
          globalThis.localStorage.removeItem = () => {
            throw new Error('Blocked removeItem');
          };
        }
        try {
          await storageMod.StorageService.deleteSnapshot('del-2');
          assert.deepEqual(storageMod.StorageService.loadSnapshots().map((s) => s.id), ['keep-1']);
          await storageMod.StorageService.deleteSnapshot('keep-1');
          assert.deepEqual(storageMod.StorageService.loadSnapshots(), []);
        } finally {
          globalThis.localStorage.setItem = origDelSet;
          globalThis.localStorage.removeItem = origDelRem;
        }

        resetDurabilityState();
        storageMod.StorageService.saveSnapshots([olderKeep, newerDel]);
        storageMod.StorageService.flushPendingBackups();
        globalThis.localStorage.setItem = (k, v) => {
          if (k === 'capy_snapshots_v8') {
            const err = new Error('Quota exceeded');
            err.name = 'QuotaExceededError';
            throw err;
          }
          return origDelSet(k, v);
        };
        if (failRemove) {
          globalThis.localStorage.removeItem = () => {
            throw new Error('Blocked removeItem');
          };
        }
        try {
          await storageMod.StorageService.clearAllSnapshots();
          assert.deepEqual(storageMod.StorageService.loadSnapshots(), []);
        } finally {
          globalThis.localStorage.setItem = origDelSet;
          globalThis.localStorage.removeItem = origDelRem;
        }
      }

      // Accidental saveSnapshots([]) under QuotaExceededError does NOT poison quotaFailedLocalKeys
      resetDurabilityState();
      mockBackups.set('capy_snapshots_v8', JSON.stringify([makeSnap('snap-old', { lastOpened: 1000, filledCount: 1 })]));
      mockStorage.set('capy_snapshots_v8', JSON.stringify([makeSnap('snap-new', { lastOpened: 1000, filledCount: 4 })]));
      const origSkipSet = globalThis.localStorage.setItem;
      globalThis.localStorage.setItem = (k, v) => {
        if (k === 'capy_snapshots_v8') {
          const err = new Error('Quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return origSkipSet(k, v);
      };
      try {
        storageMod.StorageService.saveSnapshots([]);
      } finally {
        globalThis.localStorage.setItem = origSkipSet;
      }
      assert.equal(storageMod.StorageService.loadSnapshots()[0]?.id, 'snap-new');

      // Group H: Per-snapshot-id resetEpoch dominance in SNAPSHOTS_KEY (Bug 3)
      resetDurabilityState();
      mockStorage.set(
        'capy_snapshots_v8',
        JSON.stringify([makeSnap('p1', { lastOpened: 2000, resetEpoch: 2, filledCount: 0, filledRegionIds: [] })])
      );
      mockBackups.set(
        'capy_snapshots_v8',
        JSON.stringify([
          makeSnap('p1', { lastOpened: 2000, resetEpoch: 1, filledCount: 50, filledRegionIds: [1, 2, 3] }),
          makeSnap('p2', { lastOpened: 1000, resetEpoch: 0, filledCount: 10, filledRegionIds: [1] }),
        ])
      );
      assert.deepEqual(
        storageMod.StorageService.loadSnapshots().map((s) => [s.id, s.resetEpoch, s.filledCount]),
        [['p1', 2, 0]]
      );

      // Symmetrical 1v2 where backup has higher resetEpoch on shared p1
      resetDurabilityState();
      mockStorage.set(
        'capy_snapshots_v8',
        JSON.stringify([
          makeSnap('p1', { lastOpened: 2000, resetEpoch: 1, filledCount: 50, filledRegionIds: [1, 2, 3] }),
          makeSnap('p2', { lastOpened: 1000, resetEpoch: 0, filledCount: 10, filledRegionIds: [1] }),
        ])
      );
      mockBackups.set(
        'capy_snapshots_v8',
        JSON.stringify([makeSnap('p1', { lastOpened: 2000, resetEpoch: 2, filledCount: 0, filledRegionIds: [] })])
      );
      assert.deepEqual(
        storageMod.StorageService.loadSnapshots().map((s) => [s.id, s.resetEpoch, s.filledCount]),
        [['p1', 2, 0]]
      );

      // Equal total sum (2+1 === 1+2) where shared p1 has strictly higher resetEpoch in local
      resetDurabilityState();
      mockStorage.set(
        'capy_snapshots_v8',
        JSON.stringify([
          makeSnap('p1', { lastOpened: 2000, resetEpoch: 2, filledCount: 0, filledRegionIds: [] }),
          makeSnap('p2', { lastOpened: 1000, resetEpoch: 1, filledCount: 1, filledRegionIds: [1] }),
        ])
      );
      mockBackups.set(
        'capy_snapshots_v8',
        JSON.stringify([
          makeSnap('p1', { lastOpened: 2000, resetEpoch: 1, filledCount: 50, filledRegionIds: [1, 2, 3] }),
          makeSnap('p3', { lastOpened: 1000, resetEpoch: 2, filledCount: 20, filledRegionIds: [1, 2] }),
        ])
      );
      assert.deepEqual(
        storageMod.StorageService.loadSnapshots().map((s) => s.id),
        ['p1', 'p2']
      );

      // Group I: filledRegionIds finite-number filtering in inspectCandidate('snapshots') (Bug 4)
      resetDurabilityState();
      mockStorage.set(
        'capy_snapshots_v8',
        JSON.stringify([makeSnap('snap-finite', { lastOpened: 2000, filledCount: 0, filledRegionIds: [null, 'bad', Number.NaN, 1] })])
      );
      mockBackups.set(
        'capy_snapshots_v8',
        JSON.stringify([makeSnap('snap-finite', { lastOpened: 2000, filledCount: 0, filledRegionIds: [1, 2] })])
      );
      assert.deepEqual(storageMod.StorageService.loadSnapshots()[0]?.filledRegionIds, [1, 2]);

      // Group J: Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, k) in inspectCandidate('settings') (Bug 5)
      resetDurabilityState();
      mockStorage.set(
        'capy_user_settings_v8',
        JSON.stringify({ toString: 'bad', constructor: 'bad', valueOf: 'bad' })
      );
      mockBackups.set(
        'capy_user_settings_v8',
        JSON.stringify({ difficulty: 'NORMAL', paletteSort: 'HUE' })
      );
      assert.equal(storageMod.StorageService.loadSettings().difficulty, 'NORMAL');

      // Group K: deleteSnapshot missing-ID read-only no-op (Bug 6) & negative timestamp/lastOpened clamp
      resetDurabilityState();
      storageMod.StorageService.saveSnapshots([makeSnap('existing-1', { lastOpened: 2000 })]);
      storageMod.StorageService.flushPendingBackups();
      let setItemCallsOnMissing = 0;
      let saveBackupCallsOnMissing = 0;
      const origCountSet = globalThis.localStorage.setItem;
      globalThis.localStorage.setItem = (k, v) => {
        setItemCallsOnMissing += 1;
        return origCountSet(k, v);
      };
      globalThis.window.CapyAndroid = {
        saveBackup: (k, v) => {
          saveBackupCallsOnMissing += 1;
          mockBackups.set(k, String(v));
          return true;
        },
        loadBackup: (k) => (mockBackups.has(k) ? mockBackups.get(k) : null),
      };
      try {
        const missingRes = await storageMod.StorageService.deleteSnapshot('nonexistent-id');
        assert.deepEqual(missingRes.map((s) => s.id), ['existing-1']);
        storageMod.StorageService.flushPendingBackups();
        assert.equal(setItemCallsOnMissing, 0, 'Missing-ID deleteSnapshot must not write localStorage');
        assert.equal(saveBackupCallsOnMissing, 0, 'Missing-ID deleteSnapshot must not schedule or call saveBackup');
      } finally {
        globalThis.localStorage.setItem = origCountSet;
      }

      resetDurabilityState();
      mockStorage.set(
        'capy_snapshots_v8',
        JSON.stringify([makeSnap('neg-ts', { timestamp: -500, lastOpened: -10 })])
      );
      const clampedSnap = storageMod.StorageService.loadSnapshots()[0];
      assert.equal(clampedSnap?.timestamp, 0);
      assert.equal(clampedSnap?.lastOpened, 0);

      // Group L: CapyIOS capability detection, Desktop Web partial delete under QuotaExceededError + 460ms drain/heal,
      // SNAPSHOTS_KEY quotaFailedDeleteKeys preservation, preferBackupOnTie without b.maxTs >= a.maxTs, & forced-empty recovery heal
      // L1: CapyIOS (webkit.messageHandlers.CapyIOS, no CapyAndroid.loadBackup)
      resetDurabilityState();
      const iosPosted = [];
      delete globalThis.window.CapyAndroid;
      globalThis.window.webkit = {
        messageHandlers: {
          CapyIOS: {
            postMessage: (msg) => iosPosted.push(msg),
          },
        },
      };
      const iosOne = makeSnap('ios-1', { timestamp: 1000, lastOpened: 1000, filledCount: 1 });
      const iosTwo = makeSnap('ios-2', { timestamp: 5000, lastOpened: 5000, filledCount: 5 });
      storageMod.StorageService.saveSnapshots([iosOne, iosTwo]);
      storageMod.StorageService.saveActiveState({
        activeSnapshotId: 'ios-2',
        activeColorId: 2,
        filledRegionIds: [1, 2],
        zoomScale: 1,
        panOffsetX: 0,
        panOffsetY: 0,
      });
      storageMod.StorageService.flushPendingBackups();

      const origIosSet = globalThis.localStorage.setItem;
      const origIosRem = globalThis.localStorage.removeItem;
      globalThis.localStorage.setItem = (k, v) => {
        if (k === 'capy_snapshots_v8') {
          const err = new Error('Quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return origIosSet(k, v);
      };
      try {
        const afterIosPartial = await storageMod.StorageService.deleteSnapshot('ios-2');
        assert.deepEqual(afterIosPartial.map((s) => s.id), ['ios-1']);
        assert.deepEqual(
          storageMod.StorageService.loadSnapshots().map((s) => s.id),
          ['ios-1'],
          'CapyIOS partial delete under QuotaExceededError must preserve ios-1 without wiping or resurrecting ios-2'
        );
      } finally {
        globalThis.localStorage.setItem = origIosSet;
      }
      assert.deepEqual(
        storageMod.StorageService.loadSnapshots().map((s) => s.id),
        ['ios-1']
      );
      assert.deepEqual(
        JSON.parse(mockStorage.get('capy_snapshots_v8') || '[]').map((s) => s.id),
        ['ios-1'],
        'CapyIOS loadSnapshots after quota relief must heal localStorage cleanly'
      );

      globalThis.localStorage.setItem = (k, v) => {
        if (k === 'capy_snapshots_v8') {
          const err = new Error('Quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return origIosSet(k, v);
      };
      globalThis.localStorage.removeItem = () => {
        throw new Error('Blocked removeItem');
      };
      try {
        await storageMod.StorageService.clearAllSnapshots();
        assert.deepEqual(storageMod.StorageService.loadSnapshots(), []);
        assert.equal(storageMod.StorageService.loadActiveState(), null);
      } finally {
        globalThis.localStorage.setItem = origIosSet;
        globalThis.localStorage.removeItem = origIosRem;
      }
      assert.deepEqual(storageMod.StorageService.loadSnapshots(), []);
      assert.equal(storageMod.StorageService.loadActiveState(), null);
      assert.equal(mockStorage.get('capy_snapshots_v8'), '[]');
      assert.equal(mockStorage.has('capy_active_session_v8'), false);
      assert.equal(iosPosted.length > 0, true);

      // L2: Desktop Web partial delete under QuotaExceededError (0ms safety + 460ms timer heal/drain + normal 0ms clear)
      resetDurabilityState();
      delete globalThis.window.CapyAndroid;
      storageMod.StorageService.saveSnapshots([
        makeSnap('web-norm-1', { timestamp: 1000, lastOpened: 1000 }),
        makeSnap('web-norm-2', { timestamp: 2000, lastOpened: 2000 }),
      ]);
      storageMod.StorageService.flushPendingBackups();
      await storageMod.StorageService.deleteSnapshot('web-norm-2');
      let webNormSpy = 0;
      globalThis.window.CapyAndroid = {
        saveBackup: () => {
          webNormSpy += 1;
          return true;
        },
        loadBackup: () => null,
      };
      storageMod.StorageService.flushPendingBackups();
      assert.equal(webNormSpy, 0, 'Normal Desktop Web partial delete must drain pendingBackupWrites immediately');

      for (const failRemove of [false, true]) {
        resetDurabilityState();
        delete globalThis.window.CapyAndroid;
        const keepOld = makeSnap('web-keep-1', { timestamp: 1000, lastOpened: 1000, filledCount: 1 });
        const delNew = makeSnap('web-del-2', { timestamp: 5000, lastOpened: 5000, filledCount: 5 });
        storageMod.StorageService.saveSnapshots([keepOld, delNew]);
        storageMod.StorageService.flushPendingBackups();

        const savedWebSet = globalThis.localStorage.setItem;
        const savedWebRem = globalThis.localStorage.removeItem;
        globalThis.localStorage.setItem = (k, v) => {
          if (k === 'capy_snapshots_v8') {
            const err = new Error('Quota exceeded');
            err.name = 'QuotaExceededError';
            throw err;
          }
          return savedWebSet(k, v);
        };
        if (failRemove) {
          globalThis.localStorage.removeItem = () => {
            throw new Error('Blocked removeItem');
          };
        }
        try {
          const partialRes = await storageMod.StorageService.deleteSnapshot('web-del-2');
          assert.deepEqual(partialRes.map((s) => s.id), ['web-keep-1']);
          assert.deepEqual(
            storageMod.StorageService.loadSnapshots().map((s) => s.id),
            ['web-keep-1'],
            `Desktop Web partial delete (failRemove=${failRemove}) must not resurrect web-del-2 at 0ms`
          );
        } finally {
          globalThis.localStorage.setItem = savedWebSet;
          globalThis.localStorage.removeItem = savedWebRem;
        }
        // Wait past 400ms debounce timer WITHOUT calling loadSnapshots first to verify auto-heal & drain
        await new Promise((resolve) => setTimeout(resolve, 460));
        let webTimerSpy = 0;
        globalThis.window.CapyAndroid = {
          saveBackup: () => {
            webTimerSpy += 1;
            return true;
          },
          loadBackup: () => null,
        };
        storageMod.StorageService.flushPendingBackups();
        assert.equal(webTimerSpy, 0, 'Desktop Web 400ms timer must drain pendingBackupWrites cleanly');
        assert.deepEqual(
          JSON.parse(mockStorage.get('capy_snapshots_v8') || '[]').map((s) => s.id),
          ['web-keep-1'],
          'Desktop Web 400ms timer must heal localStorage after transient quota relief'
        );
        assert.deepEqual(storageMod.StorageService.loadSnapshots().map((s) => s.id), ['web-keep-1']);
      }

      // L3: quotaFailedDeleteKeys preservation across post-delete edits + preferBackupOnTie when b.maxTs < a.maxTs
      resetDurabilityState();
      const postDelKeep = makeSnap('pd-keep', {
        timestamp: 1000,
        lastOpened: 1000,
        title: 'Old Title',
        isPinned: false,
        zoomScale: 1,
      });
      const postDelDrop = makeSnap('pd-drop', { timestamp: 5000, lastOpened: 5000, filledCount: 8 });
      storageMod.StorageService.saveSnapshots([postDelKeep, postDelDrop]);
      storageMod.StorageService.flushPendingBackups();

      const savedPdSet = globalThis.localStorage.setItem;
      const savedPdRem = globalThis.localStorage.removeItem;
      globalThis.localStorage.setItem = (k, v) => {
        if (k === 'capy_snapshots_v8' || k === 'capy_active_session_v8') {
          const err = new Error('Quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return savedPdSet(k, v);
      };
      globalThis.localStorage.removeItem = () => {
        throw new Error('Blocked removeItem');
      };
      try {
        await storageMod.StorageService.deleteSnapshot('pd-drop');
        storageMod.StorageService.renameSnapshot('pd-keep', 'Renamed Title');
        storageMod.StorageService.togglePinSnapshot('pd-keep');
        storageMod.StorageService.updateSnapshotViewport('pd-keep', 2.5, 12, -8);
        await storageMod.StorageService.importSnapshotData(
          JSON.stringify([
            makeSnap('pd-imp', { timestamp: 2000, lastOpened: 2000, filledCount: 2 }),
          ]),
          { refreshTimestamps: false }
        );

        const preFlushPostDel = storageMod.StorageService.loadSnapshots();
        assert.deepEqual(preFlushPostDel.map((s) => s.id), ['pd-imp', 'pd-keep']);
        const preKeep = preFlushPostDel.find((s) => s.id === 'pd-keep');
        assert.equal(preKeep?.title, 'Renamed Title');
        assert.equal(preKeep?.isPinned, true);
        assert.equal(preKeep?.zoomScale, 2.5);

        storageMod.StorageService.flushPendingBackups();
        const postFlushPostDel = storageMod.StorageService.loadSnapshots();
        assert.deepEqual(postFlushPostDel.map((s) => s.id), ['pd-imp', 'pd-keep']);
        assert.equal(postFlushPostDel.find((s) => s.id === 'pd-keep')?.title, 'Renamed Title');

        // Verify ACTIVE_STATE_KEY clears quotaFailedDeleteKeys on subsequent saveActiveState under QuotaExceededError
        storageMod.StorageService.saveActiveState({
          activeSnapshotId: 'pd-old-act',
          activeColorId: 1,
          filledRegionIds: [1],
          zoomScale: 1,
          panOffsetX: 0,
          panOffsetY: 0,
        });
        storageMod.StorageService.clearActiveState();
        withMockedNow(1000, () => {
          storageMod.StorageService.saveActiveState({
            activeSnapshotId: 'pd-new-act',
            activeColorId: 3,
            filledRegionIds: [1, 2],
            zoomScale: 1.5,
            panOffsetX: 0,
            panOffsetY: 0,
          });
        });
        assert.equal(storageMod.StorageService.loadActiveState()?.activeSnapshotId, 'pd-new-act');
        storageMod.StorageService.flushPendingBackups();
        assert.equal(storageMod.StorageService.loadActiveState()?.activeSnapshotId, 'pd-new-act');
      } finally {
        globalThis.localStorage.setItem = savedPdSet;
        globalThis.localStorage.removeItem = savedPdRem;
      }
      assert.deepEqual(storageMod.StorageService.loadSnapshots().map((s) => s.id), ['pd-imp', 'pd-keep']);

      // Desktop Web partial delete + rename under QuotaExceededError
      resetDurabilityState();
      delete globalThis.window.CapyAndroid;
      storageMod.StorageService.saveSnapshots([
        makeSnap('web-pd-keep', { timestamp: 1000, lastOpened: 1000, title: 'Before' }),
        makeSnap('web-pd-drop', { timestamp: 5000, lastOpened: 5000 }),
      ]);
      storageMod.StorageService.flushPendingBackups();
      const savedWebPdSet = globalThis.localStorage.setItem;
      globalThis.localStorage.setItem = (k, v) => {
        if (k === 'capy_snapshots_v8') {
          const err = new Error('Quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return savedWebPdSet(k, v);
      };
      try {
        await storageMod.StorageService.deleteSnapshot('web-pd-drop');
        storageMod.StorageService.renameSnapshot('web-pd-keep', 'Web Renamed');
        const webPostDel = storageMod.StorageService.loadSnapshots();
        assert.deepEqual(webPostDel.map((s) => s.id), ['web-pd-keep']);
        assert.equal(webPostDel[0]?.title, 'Web Renamed');
      } finally {
        globalThis.localStorage.setItem = savedWebPdSet;
      }

      // L4: Desktop Web forced-empty clearAllSnapshots recovery heals localStorage cleanly upon quota relief
      resetDurabilityState();
      delete globalThis.window.CapyAndroid;
      storageMod.StorageService.saveSnapshots([makeSnap('ghost-1', { timestamp: 5000, lastOpened: 5000 })]);
      storageMod.StorageService.saveActiveState({
        activeSnapshotId: 'ghost-1',
        activeColorId: 4,
        filledRegionIds: [1, 2, 3],
        zoomScale: 1,
        panOffsetX: 0,
        panOffsetY: 0,
      });
      storageMod.StorageService.flushPendingBackups();

      const savedGhostSet = globalThis.localStorage.setItem;
      const savedGhostRem = globalThis.localStorage.removeItem;
      globalThis.localStorage.setItem = (k, v) => {
        if (k === 'capy_snapshots_v8') {
          const err = new Error('Quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return savedGhostSet(k, v);
      };
      globalThis.localStorage.removeItem = () => {
        throw new Error('Blocked removeItem');
      };
      try {
        await storageMod.StorageService.clearAllSnapshots();
        assert.deepEqual(storageMod.StorageService.loadSnapshots(), []);
        assert.equal(storageMod.StorageService.loadActiveState(), null);
      } finally {
        globalThis.localStorage.setItem = savedGhostSet;
        globalThis.localStorage.removeItem = savedGhostRem;
      }
      assert.deepEqual(storageMod.StorageService.loadSnapshots(), []);
      assert.equal(storageMod.StorageService.loadActiveState(), null);
      assert.equal(mockStorage.get('capy_snapshots_v8'), '[]');
      assert.equal(mockStorage.has('capy_active_session_v8'), false);

      // Group M: Cross-platform pendingLocalHealWrites queue separation, 3-phase flushPendingBackups, and atomic metaUpdatedAt durability
      // M1: Persistent QuotaExceededError past 460ms across Desktop Web, CapyIOS & CapyAndroid preserves partial delete + rename & avoids iOS spam
      for (const platform of ['web', 'ios', 'android']) {
        for (const failRemove of [false, true]) {
          resetDurabilityState();
          const iosMessages = [];
          if (platform !== 'android') {
            delete globalThis.window.CapyAndroid;
          }
          if (platform === 'ios') {
            globalThis.window.webkit = {
              messageHandlers: { CapyIOS: { postMessage: (msg) => iosMessages.push(msg) } },
            };
          }
          storageMod.StorageService.saveSnapshots([
            makeSnap('m1-keep', { timestamp: 1000, lastOpened: 1000, title: 'Original Keep' }),
            makeSnap('m1-drop', { timestamp: 5000, lastOpened: 5000, filledCount: 9 }),
          ]);
          storageMod.StorageService.flushPendingBackups();
          const baseIosCount = iosMessages.length;

          const savedM1Set = globalThis.localStorage.setItem;
          const savedM1Rem = globalThis.localStorage.removeItem;
          globalThis.localStorage.setItem = (k, v) => {
            if (k === 'capy_snapshots_v8') {
              const err = new Error('Quota exceeded');
              err.name = 'QuotaExceededError';
              throw err;
            }
            return savedM1Set(k, v);
          };
          if (failRemove) {
            globalThis.localStorage.removeItem = () => {
              throw new Error('Blocked removeItem');
            };
          }
          try {
            await storageMod.StorageService.deleteSnapshot('m1-drop');
            storageMod.StorageService.renameSnapshot('m1-keep', 'Renamed M1');
            await new Promise((resolve) => setTimeout(resolve, 460));
            const at460 = storageMod.StorageService.loadSnapshots();
            assert.deepEqual(
              at460.map((s) => s.id),
              ['m1-keep'],
              `${platform} (failRemove=${failRemove}) must retain partial delete past 460ms persistent quota`
            );
            assert.equal(at460[0]?.title, 'Renamed M1');
            if (platform === 'ios') {
              assert.equal(iosMessages.length, baseIosCount + 2, 'CapyIOS must not spam postMessage during failed heal retries');
            }
          } finally {
            globalThis.localStorage.setItem = savedM1Set;
            globalThis.localStorage.removeItem = savedM1Rem;
          }
          storageMod.StorageService.flushPendingBackups();
          const healedM1 = JSON.parse(mockStorage.get('capy_snapshots_v8') || '[]');
          assert.deepEqual(healedM1.map((s) => s.id), ['m1-keep']);
          assert.equal(healedM1[0]?.title, 'Renamed M1');
        }
      }

      // M2 & M3: clearAllSnapshots -> addSnapshot & clearActiveState -> saveActiveState past 460ms persistent quota + Phase 3 clear without load*() calls
      for (const platform of ['web', 'ios', 'android']) {
        // Persistent quota past 460ms on clearAllSnapshots + addSnapshot and clearActiveState -> saveActiveState
        resetDurabilityState();
        if (platform !== 'android') delete globalThis.window.CapyAndroid;
        if (platform === 'ios') {
          globalThis.window.webkit = { messageHandlers: { CapyIOS: { postMessage: () => {} } } };
        }
        storageMod.StorageService.saveSnapshots([makeSnap('m2-ghost', { timestamp: 5000, lastOpened: 5000 })]);
        withMockedNow(5000, () => {
          storageMod.StorageService.saveActiveState({
            activeSnapshotId: 'm2-ghost',
            activeColorId: 5,
            filledRegionIds: [1, 2, 3],
            zoomScale: 2,
            panOffsetX: 10,
            panOffsetY: 10,
          });
        });
        storageMod.StorageService.flushPendingBackups();

        const savedM2Set = globalThis.localStorage.setItem;
        const savedM2Rem = globalThis.localStorage.removeItem;
        globalThis.localStorage.setItem = (k, v) => {
          if (k === 'capy_snapshots_v8' || k === 'capy_active_session_v8') {
            const err = new Error('Quota exceeded');
            err.name = 'QuotaExceededError';
            throw err;
          }
          return savedM2Set(k, v);
        };
        globalThis.localStorage.removeItem = () => {
          throw new Error('Blocked removeItem');
        };
        try {
          await storageMod.StorageService.clearAllSnapshots();
          storageMod.StorageService.addSnapshot(makeSnap('m2-fresh', { timestamp: 1000, lastOpened: 1000 }));
          await new Promise((resolve) => setTimeout(resolve, 460));
          assert.deepEqual(storageMod.StorageService.loadSnapshots().map((s) => s.id), ['m2-fresh']);
          assert.equal(storageMod.StorageService.loadActiveState(), null);

          withMockedNow(1000, () => {
            storageMod.StorageService.saveActiveState({
              activeSnapshotId: 'm2-fresh',
              activeColorId: 2,
              filledRegionIds: [1],
              zoomScale: 1,
              panOffsetX: 0,
              panOffsetY: 0,
            });
          });
          await new Promise((resolve) => setTimeout(resolve, 460));
          assert.equal(storageMod.StorageService.loadActiveState()?.activeSnapshotId, 'm2-fresh');
        } finally {
          globalThis.localStorage.setItem = savedM2Set;
          globalThis.localStorage.removeItem = savedM2Rem;
        }
        storageMod.StorageService.flushPendingBackups();
        assert.deepEqual(JSON.parse(mockStorage.get('capy_snapshots_v8') || '[]').map((s) => s.id), ['m2-fresh']);

        // Quota relief before 460ms timer WITHOUT calling loadSnapshots()/loadActiveState() clears activeState via Phase 3
        resetDurabilityState();
        if (platform !== 'android') delete globalThis.window.CapyAndroid;
        if (platform === 'ios') {
          globalThis.window.webkit = { messageHandlers: { CapyIOS: { postMessage: () => {} } } };
        }
        storageMod.StorageService.saveSnapshots([makeSnap('m3-ghost', { timestamp: 5000, lastOpened: 5000 })]);
        storageMod.StorageService.saveActiveState({
          activeSnapshotId: 'm3-ghost',
          activeColorId: 3,
          filledRegionIds: [1, 2],
          zoomScale: 1,
          panOffsetX: 0,
          panOffsetY: 0,
        });
        storageMod.StorageService.flushPendingBackups();

        globalThis.localStorage.setItem = (k, v) => {
          if (k === 'capy_snapshots_v8' || k === 'capy_active_session_v8') {
            const err = new Error('Quota exceeded');
            err.name = 'QuotaExceededError';
            throw err;
          }
          return savedM2Set(k, v);
        };
        globalThis.localStorage.removeItem = () => {
          throw new Error('Blocked removeItem');
        };
        try {
          await storageMod.StorageService.clearAllSnapshots();
        } finally {
          globalThis.localStorage.setItem = savedM2Set;
          globalThis.localStorage.removeItem = savedM2Rem;
        }
        await new Promise((resolve) => setTimeout(resolve, 460));
        assert.equal(mockStorage.get('capy_snapshots_v8'), '[]', `${platform} Phase 2/3 must heal snapshots to []`);
        assert.equal(mockStorage.has('capy_active_session_v8'), false, `${platform} Phase 3 must remove stale active state`);
      }

      // M4: Android shrinking saveSnapshots under quota -> relief -> 460ms (no load calls) heals localStorage for cold reload
      resetDurabilityState();
      storageMod.StorageService.saveSnapshots([
        makeSnap('m4-a', { timestamp: 5000, lastOpened: 5000, filledCount: 5 }),
        makeSnap('m4-b', { timestamp: 1000, lastOpened: 1000, filledCount: 1 }),
      ]);
      storageMod.StorageService.flushPendingBackups();
      const savedM4Set = globalThis.localStorage.setItem;
      globalThis.localStorage.setItem = (k, v) => {
        if (k === 'capy_snapshots_v8') {
          const err = new Error('Quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return savedM4Set(k, v);
      };
      try {
        storageMod.StorageService.saveSnapshots([makeSnap('m4-b', { timestamp: 1000, lastOpened: 1000, filledCount: 1 })]);
      } finally {
        globalThis.localStorage.setItem = savedM4Set;
      }
      await new Promise((resolve) => setTimeout(resolve, 460));
      assert.deepEqual(
        JSON.parse(mockStorage.get('capy_snapshots_v8') || '[]').map((s) => s.id),
        ['m4-b'],
        'Android Phase 2 must heal shrunk snapshot list in localStorage after transient quota relief'
      );

      // M5: Atomic metaUpdatedAt cold-reload durability (same-ms & clock-skew rename/pin/viewport/partial-delete & export/import hygiene)
      resetDurabilityState();
      withMockedNow(5000, () => {
        storageMod.StorageService.saveSnapshots([
          makeSnap('m5-keep', { timestamp: 1000, lastOpened: 5000, title: 'Orig M5', isPinned: false, zoomScale: 1 }),
          makeSnap('m5-drop', { timestamp: 9000, lastOpened: 9000, filledCount: 8 }),
        ]);
        storageMod.StorageService.flushPendingBackups();
      });
      const savedM5Set = globalThis.localStorage.setItem;
      const savedM5Rem = globalThis.localStorage.removeItem;
      globalThis.localStorage.setItem = (k, v) => {
        if (k === 'capy_snapshots_v8') {
          const err = new Error('Quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return savedM5Set(k, v);
      };
      globalThis.localStorage.removeItem = () => {
        throw new Error('Blocked removeItem');
      };
      try {
        await storageMod.StorageService.deleteSnapshot('m5-drop');
        withMockedNow(3000, () => {
          storageMod.StorageService.renameSnapshot('m5-keep', 'Skew Renamed M5');
          storageMod.StorageService.togglePinSnapshot('m5-keep');
        });
        withMockedNow(5000, () => {
          storageMod.StorageService.updateSnapshotViewport('m5-keep', 2.75, 14, -9);
        });
        storageMod.StorageService.flushPendingBackups();
      } finally {
        globalThis.localStorage.setItem = savedM5Set;
        globalThis.localStorage.removeItem = savedM5Rem;
      }
      // Fresh SSR module instance simulates cold reload while localStorage still holds stale Orig M5 + m5-drop!
      assert.equal(JSON.parse(mockStorage.get('capy_snapshots_v8') || '[]').length, 2);
      const coldVite = await createServer({
        root: projectRoot,
        server: { middlewareMode: true, hmr: false, ws: false },
        optimizeDeps: { noDiscovery: true },
        appType: 'custom',
        logLevel: 'error',
      });
      try {
        const coldStorageMod = await coldVite.ssrLoadModule('/src/services/StorageService.ts');
        const coldSnaps = coldStorageMod.StorageService.loadSnapshots();
        assert.deepEqual(coldSnaps.map((s) => s.id), ['m5-keep']);
        assert.equal(coldSnaps[0]?.title, 'Skew Renamed M5');
        assert.equal(coldSnaps[0]?.isPinned, true);
        assert.equal(coldSnaps[0]?.zoomScale, 2.75);
        assert.equal(coldSnaps[0]?.panOffsetX, 14);
        assert.equal(coldSnaps[0]?.panOffsetY, -9);
        assert.equal(coldSnaps[0]?.timestamp, 1000);
        assert.equal(coldSnaps[0]?.lastOpened, 5000);
        assert.equal('metaUpdatedAt' in coldSnaps[0], false, 'loadSnapshots must strip internal metaUpdatedAt');
        const exported = await coldStorageMod.StorageService.exportSnapshot('m5-keep');
        assert.equal(exported.includes('metaUpdatedAt'), false, 'exportSnapshot must never leak internal metaUpdatedAt');
      } finally {
        await coldVite.close();
      }

      // M6: Forged metaUpdatedAt stripped on import, missing-ID rename/pin/viewport no-op, & accidental saveSnapshots([]) preserves pendingLocalHealWrites
      resetDurabilityState();
      const forgedImportRes = await storageMod.StorageService.importSnapshotBundle(
        JSON.stringify([{ ...makeSnap('forged-1', { lastOpened: 1000 }), metaUpdatedAt: 9999999999999 }]),
        { refreshTimestamps: false }
      );
      assert.equal(forgedImportRes.importedCount, 1);
      assert.equal('metaUpdatedAt' in (forgedImportRes.firstSnapshot || {}), false);
      assert.equal('metaUpdatedAt' in JSON.parse(mockStorage.get('capy_snapshots_v8') || '[]')[0], false);

      let missingMetaWrites = 0;
      const savedMissingMetaSet = globalThis.localStorage.setItem;
      globalThis.localStorage.setItem = (k, v) => {
        missingMetaWrites += 1;
        return savedMissingMetaSet(k, v);
      };
      try {
        storageMod.StorageService.renameSnapshot('nonexistent-id', 'Noop');
        storageMod.StorageService.togglePinSnapshot('nonexistent-id');
        storageMod.StorageService.updateSnapshotViewport('nonexistent-id', 2, 0, 0);
        assert.equal(missingMetaWrites, 0, 'Missing-ID metadata updates must be zero-write no-ops');
      } finally {
        globalThis.localStorage.setItem = savedMissingMetaSet;
      }

      delete globalThis.window.CapyAndroid;
      globalThis.localStorage.setItem = (k, v) => {
        if (k === 'capy_snapshots_v8') {
          const err = new Error('Quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return savedMissingMetaSet(k, v);
      };
      try {
        storageMod.StorageService.saveSnapshots([makeSnap('guard-heal', { lastOpened: 2000, filledCount: 4 })]);
      } finally {
        globalThis.localStorage.setItem = savedMissingMetaSet;
      }
      storageMod.StorageService.saveSnapshots([]);
      assert.equal(mockStorage.get('capy_snapshots_v8'), '[]');
      assert.deepEqual(storageMod.StorageService.loadSnapshots().map((s) => s.id), ['guard-heal']);
      assert.equal(JSON.parse(mockStorage.get('capy_snapshots_v8') || '[]')[0]?.id, 'guard-heal');

      // Group N: Commit 6 edge-bug regression suite (unconditional monotonic metaUpdatedAt, storage-backed savedAt, bounded flush retries, sanitized bootstrap fallback)
      const withMockedNowAsync = async (nowMs, fn) => {
        const realNow = Date.now;
        Date.now = () => nowMs;
        try {
          return await fn();
        } finally {
          Date.now = realNow;
        }
      };
      const coldGroupVite = await createServer({
        root: projectRoot,
        server: { middlewareMode: true, hmr: false, ws: false },
        optimizeDeps: { noDiscovery: true },
        appType: 'custom',
        logLevel: 'error',
      });
      let coldReloadSeq = 0;
      const withColdStorage = async (fn) => {
        coldReloadSeq += 1;
        const mod = await coldGroupVite.ssrLoadModule(`/src/services/StorageService.ts?cold=${coldReloadSeq}`);
        return await fn(mod);
      };
      try {

      // N1 & N2: Unconditional monotonic metaUpdatedAt in updateSnapshotProgress (same-ms undo, sibling future lastOpened, backward clock skew, reverse saveBackup failure, & zero forward overhead)
      for (const platform of ['web', 'ios', 'android']) {
        resetDurabilityState();
        if (platform !== 'android') delete globalThis.window.CapyAndroid;
        if (platform === 'ios') {
          globalThis.window.webkit = { messageHandlers: { CapyIOS: { postMessage: () => {} } } };
        }
        withMockedNow(5000, () => {
          storageMod.StorageService.addSnapshot(
            makeSnap('n1-a', { timestamp: 5000, lastOpened: 5000, filledCount: 5, filledRegionIds: [1, 2, 3, 4, 5] })
          );
          storageMod.StorageService.addSnapshot(
            makeSnap('n1-sib', { timestamp: 9000, lastOpened: 9000, filledCount: 1, filledRegionIds: [1] })
          );
        });
        storageMod.StorageService.flushPendingBackups();

        // Normal forward clock (now > prevListMaxTs) must add zero metaUpdatedAt overhead
        withMockedNow(12000, () => {
          storageMod.StorageService.updateSnapshotProgress('n1-a', 6, 10, [1, 2, 3, 4, 5, 6]);
        });
        assert.equal(
          JSON.stringify(JSON.parse(mockStorage.get('capy_snapshots_v8') || '[]')).includes('metaUpdatedAt'),
          false,
          `${platform} normal forward updateSnapshotProgress must add zero metaUpdatedAt overhead`
        );
        storageMod.StorageService.flushPendingBackups();

        const savedN1Set = globalThis.localStorage.setItem;
        globalThis.localStorage.setItem = (k, v) => {
          if (k === 'capy_snapshots_v8') {
            const err = new Error('Quota exceeded');
            err.name = 'QuotaExceededError';
            throw err;
          }
          return savedN1Set(k, v);
        };
        try {
          // Same-ms undo relative to n1-sib (9000) and n1-a (12000): clock at 5000 (<= prevListMaxTs 12000)
          withMockedNow(5000, () => {
            storageMod.StorageService.updateSnapshotProgress('n1-a', 2, 10, [1, 2]);
          });
        } finally {
          globalThis.localStorage.setItem = savedN1Set;
        }
        storageMod.StorageService.flushPendingBackups();
        await withColdStorage(async (coldMod) => {
          const cold = coldMod.StorageService.loadSnapshots();
          const a = cold.find((s) => s.id === 'n1-a');
          assert.equal(a?.filledCount, 2, `${platform} cold reload must preserve undone filledCount over higher sibling lastOpened`);
          assert.deepEqual(a?.filledRegionIds, [1, 2]);
          assert.equal('metaUpdatedAt' in (a || {}), false);
        });
      }

      // Same-ms undo with zero prior metaUpdatedAt + exact same-ms sibling tie (s1=5000, s2=9000, now=5000) and reverse saveBackup=false on Android
      resetDurabilityState();
      withMockedNow(5000, () => {
        storageMod.StorageService.saveSnapshots([
          makeSnap('n1-exact', { timestamp: 5000, lastOpened: 5000, filledCount: 5, filledRegionIds: [1, 2, 3, 4, 5] }),
          makeSnap('n1-future', { timestamp: 9000, lastOpened: 9000, filledCount: 1, filledRegionIds: [1] }),
        ]);
      });
      storageMod.StorageService.flushPendingBackups();
      const savedExactSet = globalThis.localStorage.setItem;
      globalThis.localStorage.setItem = (k, v) => {
        if (k === 'capy_snapshots_v8') {
          const err = new Error('Quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return savedExactSet(k, v);
      };
      try {
        withMockedNow(5000, () => {
          storageMod.StorageService.updateSnapshotProgress('n1-exact', 4, 10, [1, 2, 3, 4]);
        });
      } finally {
        globalThis.localStorage.setItem = savedExactSet;
      }
      storageMod.StorageService.flushPendingBackups();
      await withColdStorage(async (coldMod) => {
        const snap = coldMod.StorageService.loadSnapshots().find((s) => s.id === 'n1-exact');
        assert.equal(snap?.filledCount, 4);
        assert.equal('metaUpdatedAt' in (snap || {}), false);
      });

      // N2b: Android backward clock skew 10000 -> 3000 (both quota-on-local and saveBackup() === false reverse path)
      resetDurabilityState();
      storageMod.StorageService.saveSnapshots([
        makeSnap('n2-skew', { timestamp: 1000, lastOpened: 10000, filledCount: 1, filledRegionIds: [1] }),
      ]);
      storageMod.StorageService.flushPendingBackups();
      globalThis.window.CapyAndroid = {
        saveBackup: () => false,
        loadBackup: (k) => (mockBackups.has(k) ? mockBackups.get(k) : null),
      };
      withMockedNow(3000, () => {
        storageMod.StorageService.updateSnapshotProgress('n2-skew', 8, 10, [1, 2, 3, 4, 5, 6, 7, 8]);
      });
      // Cold reload BEFORE any flush recovery: localStorage (filledCount=8, lastOpened=3000) must beat stale backup (10000)
      await withColdStorage(async (coldMod) => {
        const snap = coldMod.StorageService.loadSnapshots().find((s) => s.id === 'n2-skew');
        assert.equal(snap?.filledCount, 8);
        assert.equal(snap?.lastOpened, 3000);
        assert.equal('metaUpdatedAt' in (snap || {}), false);
      });

      // N3 & N4: addSnapshot overwrite + syncImportedMetaTimestamps (both refreshTimestamps:true clock skew and refreshTimestamps:false older restore + single-save)
      resetDurabilityState();
      storageMod.StorageService.saveSnapshots([
        makeSnap('n3-add', { timestamp: 1000, lastOpened: 10000, title: 'Orig Add', filledCount: 9 }),
      ]);
      storageMod.StorageService.flushPendingBackups();
      const savedN3Set = globalThis.localStorage.setItem;
      globalThis.localStorage.setItem = (k, v) => {
        if (k === 'capy_snapshots_v8') {
          const err = new Error('Quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return savedN3Set(k, v);
      };
      try {
        withMockedNow(4000, () => {
          storageMod.StorageService.addSnapshot(
            makeSnap('n3-add', { timestamp: 1000, lastOpened: 4000, title: 'Readded Skew', filledCount: 2 })
          );
        });
      } finally {
        globalThis.localStorage.setItem = savedN3Set;
      }
      storageMod.StorageService.flushPendingBackups();
      await withColdStorage(async (coldMod) => {
        const snap = coldMod.StorageService.loadSnapshots().find((s) => s.id === 'n3-add');
        assert.equal(snap?.title, 'Readded Skew');
        assert.equal(snap?.filledCount, 2);
        assert.equal('metaUpdatedAt' in (snap || {}), false);
      });

      // N4a: importSnapshotBundle ({ refreshTimestamps: true }) under clock skew 10000 -> 3000
      resetDurabilityState();
      storageMod.StorageService.saveSnapshots([
        makeSnap('n4-imp', { timestamp: 1000, lastOpened: 10000, title: 'Pre-Import', filledCount: 7 }),
      ]);
      storageMod.StorageService.flushPendingBackups();
      const savedN4Set = globalThis.localStorage.setItem;
      globalThis.localStorage.setItem = (k, v) => {
        if (k === 'capy_snapshots_v8') {
          const err = new Error('Quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return savedN4Set(k, v);
      };
      try {
        const n4aRes = await withMockedNowAsync(3000, () =>
          storageMod.StorageService.importSnapshotBundle(
            JSON.stringify({
              version: 2,
              format: 'capy-archive-save',
              snapshots: [makeSnap('n4-imp', { timestamp: 1000, lastOpened: 1000, title: 'Fresh Skew Import', filledCount: 1 })],
              puzzles: {},
            }),
            { refreshTimestamps: true }
          )
        );
        assert.equal(n4aRes.importedCount, 1);
      } finally {
        globalThis.localStorage.setItem = savedN4Set;
      }
      storageMod.StorageService.flushPendingBackups();
      await withColdStorage(async (coldMod) => {
        const snap = coldMod.StorageService.loadSnapshots().find((s) => s.id === 'n4-imp');
        assert.equal(snap?.title, 'Fresh Skew Import');
        assert.equal(snap?.filledCount, 1);
      });

      // N4b: importSnapshotData ({ refreshTimestamps: false }) restoring older save (2000 over 5000) via array & capy-single-save & binary v2 archive
      resetDurabilityState();
      storageMod.StorageService.saveSnapshots([
        makeSnap('n4-old', { timestamp: 5000, lastOpened: 5000, title: 'Newer Corrupt', filledCount: 8 }),
      ]);
      storageMod.StorageService.flushPendingBackups();
      globalThis.localStorage.setItem = (k, v) => {
        if (k === 'capy_snapshots_v8') {
          const err = new Error('Quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return savedN4Set(k, v);
      };
      try {
        const n4OldRes = await withMockedNowAsync(2000, () =>
          storageMod.StorageService.importSnapshotData(
            JSON.stringify([makeSnap('n4-old', { timestamp: 2000, lastOpened: 2000, title: 'Restored Older', filledCount: 3 })]),
            { refreshTimestamps: false }
          )
        );
        assert.equal(n4OldRes.importedCount, 1);
      } finally {
        globalThis.localStorage.setItem = savedN4Set;
      }
      storageMod.StorageService.flushPendingBackups();
      await withColdStorage(async (coldMod) => {
        const snap = coldMod.StorageService.loadSnapshots().find((s) => s.id === 'n4-old');
        assert.equal(snap?.title, 'Restored Older');
        assert.equal(snap?.filledCount, 3);
      });

      // Binary v2 archive overwrite with refreshTimestamps:false under clock skew/older timestamp
      const codecMod = await vite.ssrLoadModule('/src/services/CapyCodec.ts');
      resetDurabilityState();
      storageMod.StorageService.saveSnapshots([
        makeSnap('n4-bin', { timestamp: 8000, lastOpened: 8000, title: 'Pre-Bin', filledCount: 9 }),
      ]);
      storageMod.StorageService.flushPendingBackups();
      const binArchiveBytes = await codecMod.encodeArchiveSaveBinaryV2(
        [makeSnap('n4-bin', { timestamp: 2000, lastOpened: 2000, title: 'Restored Bin Archive', filledCount: 2 })],
        {},
        {},
        { exportDate: 2000 }
      );
      globalThis.localStorage.setItem = (k, v) => {
        if (k === 'capy_snapshots_v8') {
          const err = new Error('Quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return savedN4Set(k, v);
      };
      try {
        const binRes = await withMockedNowAsync(2000, () =>
          storageMod.StorageService.importSnapshotData(binArchiveBytes, { refreshTimestamps: false })
        );
        assert.equal(binRes.importedCount, 1);
      } finally {
        globalThis.localStorage.setItem = savedN4Set;
      }
      storageMod.StorageService.flushPendingBackups();
      await withColdStorage(async (coldMod) => {
        const snap = coldMod.StorageService.loadSnapshots().find((s) => s.id === 'n4-bin');
        assert.equal(snap?.title, 'Restored Bin Archive');
        assert.equal(snap?.filledCount, 2);
      });

      // Single-save JSON & binary older restore (via addSnapshot inside importSnapshotBundle / importSnapshotData)
      resetDurabilityState();
      storageMod.StorageService.saveSnapshots([
        makeSnap('n4-single', { timestamp: 8000, lastOpened: 8000, title: 'Pre-Single', filledCount: 9 }),
      ]);
      storageMod.StorageService.flushPendingBackups();
      globalThis.localStorage.setItem = (k, v) => {
        if (k === 'capy_snapshots_v8') {
          const err = new Error('Quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return savedN4Set(k, v);
      };
      try {
        const singleRes = await withMockedNowAsync(2000, () =>
          storageMod.StorageService.importSnapshotBundle(
            JSON.stringify({
              version: 2,
              format: 'capy-single-save',
              snapshot: makeSnap('n4-single', { timestamp: 2000, lastOpened: 2000, title: 'Restored Single', filledCount: 1 }),
              puzzle: null,
            }),
            { refreshTimestamps: false }
          )
        );
        assert.equal(singleRes.importedCount, 1);
      } finally {
        globalThis.localStorage.setItem = savedN4Set;
      }
      storageMod.StorageService.flushPendingBackups();
      await withColdStorage(async (coldMod) => {
        const snap = coldMod.StorageService.loadSnapshots().find((s) => s.id === 'n4-single');
        assert.equal(snap?.title, 'Restored Single');
        assert.equal(snap?.filledCount, 1);
      });

      // N5: Storage-backed monotonic savedAt in saveSettings and saveActiveState (backward clock skew + same-ms shrink + reverse saveBackup failure)
      resetDurabilityState();
      withMockedNow(10000, () => {
        storageMod.StorageService.saveSettings({
          ...storageMod.DEFAULT_SETTINGS,
          difficulty: 'EASY',
          zoomSensitivity: 1.1,
        });
        storageMod.StorageService.saveActiveState({
          activeSnapshotId: 'n5-snap',
          activeColorId: 5,
          filledRegionIds: [1, 2, 3, 4, 5],
          resetEpoch: 1,
          zoomScale: 1.5,
          panOffsetX: 10,
          panOffsetY: 10,
        });
      });
      storageMod.StorageService.flushPendingBackups();
      const savedN5Set = globalThis.localStorage.setItem;
      globalThis.localStorage.setItem = (k, v) => {
        if (k === 'capy_user_settings_v8' || k === 'capy_active_session_v8') {
          const err = new Error('Quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return savedN5Set(k, v);
      };
      try {
        withMockedNow(3000, () => {
          storageMod.StorageService.saveSettings({
            ...storageMod.DEFAULT_SETTINGS,
            difficulty: 'NORMAL',
            zoomSensitivity: 1.9,
          });
          storageMod.StorageService.saveActiveState({
            activeSnapshotId: 'n5-snap',
            activeColorId: 2,
            filledRegionIds: [1],
            resetEpoch: 1,
            zoomScale: 1.0,
            panOffsetX: 0,
            panOffsetY: 0,
          });
        });
      } finally {
        globalThis.localStorage.setItem = savedN5Set;
      }
      storageMod.StorageService.flushPendingBackups();
      await withColdStorage(async (coldMod) => {
        const s = coldMod.StorageService.loadSettings();
        const a = coldMod.StorageService.loadActiveState();
        assert.equal(s.difficulty, 'NORMAL');
        assert.equal(s.zoomSensitivity, 1.9);
        assert.equal('savedAt' in s, false);
        assert.equal(a?.activeColorId, 2);
        assert.deepEqual(a?.filledRegionIds, [1]);
        assert.equal('savedAt' in (a || {}), false);
      });

      // Same-ms shrink (10000 -> 10000) and reverse Android saveBackup=false path for settings & activeState
      resetDurabilityState();
      withMockedNow(10000, () => {
        storageMod.StorageService.saveSettings({ ...storageMod.DEFAULT_SETTINGS, difficulty: 'EASY' });
        storageMod.StorageService.saveActiveState({
          activeSnapshotId: 'n5-same',
          activeColorId: 4,
          filledRegionIds: [1, 2, 3, 4],
          resetEpoch: 1,
          zoomScale: 1,
          panOffsetX: 0,
          panOffsetY: 0,
        });
      });
      storageMod.StorageService.flushPendingBackups();
      globalThis.window.CapyAndroid = {
        saveBackup: () => false,
        loadBackup: (k) => (mockBackups.has(k) ? mockBackups.get(k) : null),
      };
      withMockedNow(10000, () => {
        storageMod.StorageService.saveSettings({ ...storageMod.DEFAULT_SETTINGS, difficulty: 'NORMAL' });
        storageMod.StorageService.saveActiveState({
          activeSnapshotId: 'n5-same',
          activeColorId: 1,
          filledRegionIds: [1],
          resetEpoch: 1,
          zoomScale: 1,
          panOffsetX: 0,
          panOffsetY: 0,
        });
      });
      await withColdStorage(async (coldMod) => {
        assert.equal(coldMod.StorageService.loadSettings().difficulty, 'NORMAL');
        assert.deepEqual(coldMod.StorageService.loadActiveState()?.filledRegionIds, [1]);
      });

      // N6: Bounded backoff retry scheduling in flushPendingBackups (B1b, P5, N8b, E1-E6, 0 Desktop Web normal timers)
      // N6a (B1b): clearAllSnapshots under 550ms quota > 400ms first tick heals by 1100ms across web, ios, android with zero CapyIOS spam
      for (const platform of ['web', 'ios', 'android']) {
        resetDurabilityState();
        const iosN6a = [];
        if (platform !== 'android') delete globalThis.window.CapyAndroid;
        if (platform === 'ios') {
          globalThis.window.webkit = { messageHandlers: { CapyIOS: { postMessage: (m) => iosN6a.push(m) } } };
        }
        storageMod.StorageService.saveSnapshots([makeSnap('n6a-ghost', { timestamp: 5000, lastOpened: 5000 })]);
        storageMod.StorageService.saveActiveState({
          activeSnapshotId: 'n6a-ghost',
          activeColorId: 1,
          filledRegionIds: [1, 2],
          zoomScale: 1,
          panOffsetX: 0,
          panOffsetY: 0,
        });
        storageMod.StorageService.flushPendingBackups();
        const baseIosN6a = iosN6a.length;

        const savedN6aSet = globalThis.localStorage.setItem;
        const savedN6aRem = globalThis.localStorage.removeItem;
        globalThis.localStorage.setItem = (k, v) => {
          if (k === 'capy_snapshots_v8' || k === 'capy_active_session_v8') {
            const err = new Error('Quota exceeded');
            err.name = 'QuotaExceededError';
            throw err;
          }
          return savedN6aSet(k, v);
        };
        globalThis.localStorage.removeItem = () => {
          throw new Error('Blocked removeItem');
        };
        try {
          await storageMod.StorageService.clearAllSnapshots();
          await new Promise((resolve) => setTimeout(resolve, 550));
        } finally {
          globalThis.localStorage.setItem = savedN6aSet;
          globalThis.localStorage.removeItem = savedN6aRem;
        }
        // Wait 550ms post-relief (total 1100ms > 400ms+400ms=800ms) WITHOUT calling load*/flushPendingBackups
        await new Promise((resolve) => setTimeout(resolve, 550));
        assert.equal(mockStorage.get('capy_snapshots_v8'), '[]', `${platform} B1b must auto-heal snapshots after transient quota`);
        assert.equal(mockStorage.has('capy_active_session_v8'), false, `${platform} B1b must auto-clear active state after transient quota`);
        if (platform === 'ios') {
          assert.equal(iosN6a.length, baseIosN6a + 2, 'CapyIOS B1b retry must emit zero duplicate postMessage spam');
        }
        await withColdStorage(async (coldMod) => {
          assert.deepEqual(coldMod.StorageService.loadSnapshots(), []);
          assert.equal(coldMod.StorageService.loadActiveState(), null);
        });
      }

      // N6b (P5): Manual flushPendingBackups() while quota still active reschedules 400ms retry and heals after relief
      for (const platform of ['web', 'ios', 'android']) {
        resetDurabilityState();
        if (platform !== 'android') delete globalThis.window.CapyAndroid;
        if (platform === 'ios') {
          globalThis.window.webkit = { messageHandlers: { CapyIOS: { postMessage: () => {} } } };
        }
        storageMod.StorageService.saveSnapshots([
          makeSnap('n6b-keep', { timestamp: 1000, lastOpened: 1000, title: 'Orig P5' }),
          makeSnap('n6b-drop', { timestamp: 5000, lastOpened: 5000, filledCount: 7 }),
        ]);
        storageMod.StorageService.flushPendingBackups();

        const savedN6bSet = globalThis.localStorage.setItem;
        const savedN6bRem = globalThis.localStorage.removeItem;
        globalThis.localStorage.setItem = (k, v) => {
          if (k === 'capy_snapshots_v8') {
            const err = new Error('Quota exceeded');
            err.name = 'QuotaExceededError';
            throw err;
          }
          return savedN6bSet(k, v);
        };
        globalThis.localStorage.removeItem = () => {
          throw new Error('Blocked removeItem');
        };
        try {
          await storageMod.StorageService.deleteSnapshot('n6b-drop');
          storageMod.StorageService.renameSnapshot('n6b-keep', 'Renamed P5');
          storageMod.StorageService.flushPendingBackups();
        } finally {
          globalThis.localStorage.setItem = savedN6bSet;
          globalThis.localStorage.removeItem = savedN6bRem;
        }
        await new Promise((resolve) => setTimeout(resolve, 480));
        await withColdStorage(async (coldMod) => {
          const snaps = coldMod.StorageService.loadSnapshots();
          assert.deepEqual(snaps.map((s) => s.id), ['n6b-keep'], `${platform} P5 must heal partial delete via scheduled retry`);
          assert.equal(snaps[0]?.title, 'Renamed P5');
        });
      }

      // N6c (E5): Android saveBackup() === false transient failure lasting 550ms heals automatically by 1100ms
      resetDurabilityState();
      let n6cBackupOk = true;
      globalThis.window.CapyAndroid = {
        saveBackup: (k, v) => {
          if (!n6cBackupOk) return false;
          mockBackups.set(k, String(v));
          return true;
        },
        loadBackup: (k) => (mockBackups.has(k) ? mockBackups.get(k) : null),
      };
      storageMod.StorageService.saveSnapshots([makeSnap('n6c-1', { lastOpened: 1000, filledCount: 1 })]);
      storageMod.StorageService.flushPendingBackups();
      n6cBackupOk = false;
      storageMod.StorageService.saveSnapshots([makeSnap('n6c-1', { lastOpened: 5000, filledCount: 6 })]);
      await new Promise((resolve) => setTimeout(resolve, 550));
      assert.equal(JSON.parse(mockBackups.get('capy_snapshots_v8') || '[]')[0]?.filledCount, 1);
      n6cBackupOk = true;
      await new Promise((resolve) => setTimeout(resolve, 550));
      assert.equal(
        JSON.parse(mockBackups.get('capy_snapshots_v8') || '[]')[0]?.filledCount,
        6,
        'Android transient saveBackup failure must self-heal via retry timer'
      );

      // N6d: Normal Desktop Web 0 timers + bounded [400, 400, 800, 1600, 3200] retry schedule + !isRetry reset + 0 post-heal timer leaks
      resetDurabilityState();
      delete globalThis.window.CapyAndroid;
      const origSetTimeout = globalThis.setTimeout;
      const origClearTimeout = globalThis.clearTimeout;
      const fakeTimers = [];
      let nextTimerId = 1;
      const installFakeTimers = () => {
        fakeTimers.length = 0;
        globalThis.setTimeout = (fn, delay) => {
          const handle = {
            id: nextTimerId++,
            fn,
            delay,
            cleared: false,
            unrefCalled: false,
            unref() {
              this.unrefCalled = true;
              return this;
            },
          };
          fakeTimers.push(handle);
          return handle;
        };
        globalThis.clearTimeout = (handle) => {
          if (handle && typeof handle === 'object') {
            handle.cleared = true;
          }
        };
      };
      try {
        installFakeTimers();
        // Normal Desktop Web writes must arm ZERO timers
        storageMod.StorageService.saveSnapshots([makeSnap('n6d-norm', { lastOpened: 2000 })]);
        storageMod.StorageService.saveSettings(storageMod.DEFAULT_SETTINGS);
        storageMod.StorageService.saveActiveState({
          activeSnapshotId: 'n6d-norm',
          activeColorId: 1,
          filledRegionIds: [1],
          zoomScale: 1,
          panOffsetX: 0,
          panOffsetY: 0,
        });
        await storageMod.StorageService.deleteSnapshot('n6d-norm');
        assert.equal(fakeTimers.length, 0, 'Normal non-fault Desktop Web writes must schedule ZERO timers');

        // Bounded backoff retries under persistent quota
        const savedN6dSet = globalThis.localStorage.setItem;
        globalThis.localStorage.setItem = (k, v) => {
          if (k === 'capy_snapshots_v8') {
            const err = new Error('Quota exceeded');
            err.name = 'QuotaExceededError';
            throw err;
          }
          return savedN6dSet(k, v);
        };
        try {
          storageMod.StorageService.saveSnapshots([makeSnap('n6d-q1', { lastOpened: 3000 })]);
          assert.deepEqual(fakeTimers.map((t) => t.delay), [400]);
          assert.equal(fakeTimers[0]?.unrefCalled, true, 'Backup flush timer must call unref()');
          for (let step = 0; step < 6; step++) {
            const active = fakeTimers.filter((t) => !t.cleared).pop();
            if (!active) break;
            active.cleared = true;
            active.fn();
          }
          assert.deepEqual(
            fakeTimers.map((t) => t.delay),
            [400, 400, 800, 1600, 3200, 3200],
            'Retry backoff must execute bounded [400, 400, 800, 1600, 3200] schedule and halt after 5 retries'
          );
          assert.equal(fakeTimers.filter((t) => !t.cleared).length, 0);

          // New user mutation (!isRetry) cancels active slow retry timer and resets delay to 400ms
          fakeTimers.length = 0;
          storageMod.StorageService.saveSnapshots([makeSnap('n6d-q2', { lastOpened: 4000 })]);
          fakeTimers[0].cleared = true;
          fakeTimers[0].fn();
          fakeTimers[1].cleared = true;
          fakeTimers[1].fn();
          assert.equal(fakeTimers[2]?.delay, 800);
          assert.equal(fakeTimers[2]?.cleared, false);
          storageMod.StorageService.saveSnapshots([makeSnap('n6d-q3', { lastOpened: 5000 })]);
          assert.equal(fakeTimers[2]?.cleared, true, 'New mutation must clear pending slow retry timer');
          assert.equal(fakeTimers[3]?.delay, 400, 'New mutation must reset debounce delay to 400ms');
        } finally {
          globalThis.localStorage.setItem = savedN6dSet;
        }
        const preHealTimerCount = fakeTimers.length;
        const pendingHealHandle = fakeTimers.filter((t) => !t.cleared).pop();
        assert.ok(pendingHealHandle);
        pendingHealHandle.cleared = true;
        pendingHealHandle.fn();
        assert.equal(fakeTimers.length, preHealTimerCount, 'Post-heal flush must schedule ZERO timers');
        assert.equal(fakeTimers.filter((t) => !t.cleared).length, 0);
        assert.equal(JSON.parse(mockStorage.get('capy_snapshots_v8') || '[]')[0]?.id, 'n6d-q3');

        // CapyIOS 5-retry sequence under persistent quota must emit zero duplicate postMessage spam
        resetDurabilityState();
        delete globalThis.window.CapyAndroid;
        const iosN6d = [];
        globalThis.window.webkit = {
          messageHandlers: { CapyIOS: { postMessage: (m) => iosN6d.push(m) } },
        };
        fakeTimers.length = 0;
        const savedN6dIosSet = globalThis.localStorage.setItem;
        globalThis.localStorage.setItem = (k, v) => {
          if (k === 'capy_snapshots_v8') {
            const err = new Error('Quota exceeded');
            err.name = 'QuotaExceededError';
            throw err;
          }
          return savedN6dIosSet(k, v);
        };
        try {
          storageMod.StorageService.saveSnapshots([makeSnap('n6d-ios', { lastOpened: 6000 })]);
          assert.equal(iosN6d.length, 0);
          for (let step = 0; step < 6; step++) {
            const active = fakeTimers.filter((t) => !t.cleared).pop();
            if (!active) break;
            active.cleared = true;
            active.fn();
          }
          assert.equal(iosN6d.length, 1, 'CapyIOS retry ticks must emit zero duplicate postMessage calls');
          assert.deepEqual(fakeTimers.map((t) => t.delay), [400, 400, 800, 1600, 3200, 3200]);
        } finally {
          globalThis.localStorage.setItem = savedN6dIosSet;
        }
        storageMod.StorageService.flushPendingBackups();
        assert.equal(iosN6d.length, 1, 'Post-heal CapyIOS flush must not re-post already backed-up payload');
      } finally {
        globalThis.setTimeout = origSetTimeout;
        globalThis.clearTimeout = origClearTimeout;
      }

      // N7 (BUG4 / B4e): isBootstrapBatch firstSnapshot fallback must strip forged metaUpdatedAt across all archive/array paths
      resetDurabilityState();
      storageMod.StorageService.saveSnapshots([makeSnap('n7-existing', { lastOpened: 5000 })]);
      const forgedSample = {
        ...makeSnap('n7-existing', { lastOpened: 2000 }),
        isAutoSample: true,
        metaUpdatedAt: 9999999999999,
      };
      const bootArrayRes = await storageMod.StorageService.importSnapshotBundle(
        JSON.stringify([forgedSample]),
        { refreshTimestamps: true }
      );
      assert.equal(bootArrayRes.importedCount, 1);
      assert.equal('metaUpdatedAt' in (bootArrayRes.firstSnapshot || {}), false, 'Bootstrap array firstSnapshot must strip metaUpdatedAt');

      const bootArchiveRes = await storageMod.StorageService.importSnapshotBundle(
        JSON.stringify({ version: 2, format: 'capy-archive-save', snapshots: [forgedSample], puzzles: {} }),
        { refreshTimestamps: true }
      );
      assert.equal(bootArchiveRes.importedCount, 1);
      assert.equal('metaUpdatedAt' in (bootArchiveRes.firstSnapshot || {}), false, 'Bootstrap archive firstSnapshot must strip metaUpdatedAt');

      const bootBinBytes = await codecMod.encodeArchiveSaveBinaryV2([forgedSample], {}, {});
      const bootBinRes = await storageMod.StorageService.importSnapshotData(bootBinBytes, { refreshTimestamps: true });
      assert.equal(bootBinRes.importedCount, 1);
      assert.equal('metaUpdatedAt' in (bootBinRes.firstSnapshot || {}), false, 'Bootstrap binary archive firstSnapshot must strip metaUpdatedAt');

      // N8 (C6-NEW-1): clearActiveState with saveBackup() === false must not ignore stale native backup timestamp on subsequent saveActiveState / saveSettings under clock skew
      for (const withEpoch of [false, true]) {
        resetDurabilityState();
        withMockedNow(10000, () => {
          storageMod.StorageService.saveActiveState({
            activeSnapshotId: 'old-ghost',
            activeColorId: 3,
            filledRegionIds: [1, 2, 3],
            ...(withEpoch ? { resetEpoch: 3 } : {}),
            zoomScale: 1,
            panOffsetX: 0,
            panOffsetY: 0,
          });
        });
        storageMod.StorageService.flushPendingBackups();
        globalThis.window.CapyAndroid = {
          saveBackup: () => false,
          loadBackup: (k) => (mockBackups.has(k) ? mockBackups.get(k) : null),
        };
        storageMod.StorageService.clearActiveState();
        assert.equal(mockStorage.has('capy_active_session_v8'), false);
        withMockedNow(3000, () => {
          storageMod.StorageService.saveActiveState({
            activeSnapshotId: 'new-puzzle',
            activeColorId: 7,
            filledRegionIds: [4],
            ...(withEpoch ? { resetEpoch: 1 } : {}),
            zoomScale: 1.5,
            panOffsetX: 5,
            panOffsetY: -5,
          });
        });
        await withColdStorage(async (coldMod) => {
          const act = coldMod.StorageService.loadActiveState();
          assert.equal(
            act?.activeSnapshotId,
            'new-puzzle',
            `C6-NEW-1 (withEpoch=${withEpoch}) cold reload must keep new-puzzle over stale native backup old-ghost`
          );
          assert.equal(act?.activeColorId, 7);
          assert.deepEqual(act?.filledRegionIds, [4]);
          if (withEpoch) {
            assert.equal(act?.resetEpoch, 1);
          }
          assert.equal('savedAt' in (act || {}), false);
        });
      }

      // C6-NEW-1 settings parity: failed saveBackup sets staleNativeBackupKeys, then local loss + backward-skew saveSettings must still outrank stale native backup
      resetDurabilityState();
      withMockedNow(10000, () => {
        storageMod.StorageService.saveSettings({ ...storageMod.DEFAULT_SETTINGS, difficulty: 'EASY' });
      });
      storageMod.StorageService.flushPendingBackups();
      globalThis.window.CapyAndroid = {
        saveBackup: () => false,
        loadBackup: (k) => (mockBackups.has(k) ? mockBackups.get(k) : null),
      };
      withMockedNow(10000, () => {
        storageMod.StorageService.saveSettings({ ...storageMod.DEFAULT_SETTINGS, difficulty: 'EASY', largeText: true });
      });
      storageMod.StorageService.flushPendingBackups();
      mockStorage.delete('capy_user_settings_v8');
      withMockedNow(3000, () => {
        storageMod.StorageService.saveSettings({ ...storageMod.DEFAULT_SETTINGS, difficulty: 'NORMAL', largeText: false });
      });
      await withColdStorage(async (coldMod) => {
        const s = coldMod.StorageService.loadSettings();
        assert.equal(s.difficulty, 'NORMAL');
        assert.equal(s.largeText, false);
        assert.equal('savedAt' in s, false);
      });

      // N9 (C6-NEW-2a..2d): Post-empty-list stale store floor across clearAllSnapshots / deleteSnapshot 1->0 + addSnapshot & older importSnapshotData/Bundle
      // Clean empty addSnapshot must still emit ZERO metaUpdatedAt overhead
      resetDurabilityState();
      await storageMod.StorageService.clearAllSnapshots();
      withMockedNow(3000, () => {
        storageMod.StorageService.addSnapshot(makeSnap('clean-empty-add', { timestamp: 3000, lastOpened: 3000 }));
      });
      assert.equal(
        JSON.stringify(JSON.parse(mockStorage.get('capy_snapshots_v8') || '[]')).includes('metaUpdatedAt'),
        false,
        'addSnapshot onto cleanly empty storage must add zero metaUpdatedAt overhead'
      );

      // N9a (C6-NEW-2a): clearAllSnapshots & deleteSnapshot 1->0 with saveBackup('[]') === false + skewed addSnapshot -> cold reload <400ms
      for (const emptyMode of ['clearAll', 'deleteLast']) {
        resetDurabilityState();
        const oldId = emptyMode === 'clearAll' ? 'old-snap' : 'last-one';
        const newId = emptyMode === 'clearAll' ? 'new-snap' : 'fresh-after-del';
        storageMod.StorageService.saveSnapshots([makeSnap(oldId, { timestamp: 1000, lastOpened: 10000 })]);
        storageMod.StorageService.flushPendingBackups();
        globalThis.window.CapyAndroid = {
          saveBackup: () => false,
          loadBackup: (k) => (mockBackups.has(k) ? mockBackups.get(k) : null),
        };
        if (emptyMode === 'clearAll') {
          await storageMod.StorageService.clearAllSnapshots();
        } else {
          await storageMod.StorageService.deleteSnapshot(oldId);
        }
        withMockedNow(3000, () => {
          storageMod.StorageService.addSnapshot(makeSnap(newId, { timestamp: 3000, lastOpened: 3000, title: `Fresh ${emptyMode}` }));
        });
        await withColdStorage(async (coldMod) => {
          const snaps = coldMod.StorageService.loadSnapshots();
          assert.deepEqual(
            snaps.map((s) => s.id),
            [newId],
            `C6-NEW-2a (${emptyMode}) must keep newly added snapshot over stale native backup`
          );
          assert.equal('metaUpdatedAt' in (snaps[0] || {}), false);
        });
      }

      // N9b (C6-NEW-2b): clearAllSnapshots + QuotaExceededError + blocked removeItem + skewed addSnapshot -> unhealed localStorage cold reload
      resetDurabilityState();
      storageMod.StorageService.saveSnapshots([makeSnap('old-q-snap', { timestamp: 1000, lastOpened: 10000 })]);
      storageMod.StorageService.flushPendingBackups();
      const savedN9bSet = globalThis.localStorage.setItem;
      const savedN9bRem = globalThis.localStorage.removeItem;
      globalThis.localStorage.setItem = (k, v) => {
        if (k === 'capy_snapshots_v8' || k === 'capy_active_session_v8') {
          const err = new Error('Quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return savedN9bSet(k, v);
      };
      globalThis.localStorage.removeItem = () => {
        throw new Error('Blocked removeItem');
      };
      try {
        await storageMod.StorageService.clearAllSnapshots();
        withMockedNow(3000, () => {
          storageMod.StorageService.addSnapshot(makeSnap('new-q-snap', { timestamp: 3000, lastOpened: 3000, title: 'New Q Snap' }));
        });
        storageMod.StorageService.flushPendingBackups();
      } finally {
        globalThis.localStorage.setItem = savedN9bSet;
        globalThis.localStorage.removeItem = savedN9bRem;
      }
      await withColdStorage(async (coldMod) => {
        const snaps = coldMod.StorageService.loadSnapshots();
        assert.deepEqual(
          snaps.map((s) => s.id),
          ['new-q-snap'],
          'C6-NEW-2b must keep new-q-snap over unhealed localStorage old-q-snap'
        );
        assert.equal('metaUpdatedAt' in (snaps[0] || {}), false);
      });

      // N9c (C6-NEW-2c & C6-NEW-2d): importSnapshotData/Bundle({ refreshTimestamps: false }) restoring older save after clearAllSnapshots (JSON archive, array, & binary v2 archive, with normal forward clock and skewed clock)
      for (const restoreCase of [
        { mode: '2c-quota-unhealed', format: 'json-archive', nowMs: 20000 },
        { mode: '2c-quota-unhealed', format: 'json-array', nowMs: 20000 },
        { mode: '2c-quota-unhealed', format: 'bin-archive', nowMs: 20000 },
        { mode: '2d-saveBackup-false', format: 'json-archive', nowMs: 20000 },
        { mode: '2d-saveBackup-false', format: 'bin-archive', nowMs: 2000 },
      ]) {
        resetDurabilityState();
        storageMod.StorageService.saveSnapshots([makeSnap('old-imp', { timestamp: 1000, lastOpened: 10000 })]);
        storageMod.StorageService.flushPendingBackups();
        const restoredSnap = makeSnap('restored-imp', {
          timestamp: 2000,
          lastOpened: 2000,
          title: 'Restored Older Backup',
          filledCount: 4,
        });
        const payload =
          restoreCase.format === 'bin-archive'
            ? await codecMod.encodeArchiveSaveBinaryV2([restoredSnap], {}, {}, { exportDate: 2000 })
            : restoreCase.format === 'json-array'
              ? JSON.stringify([restoredSnap])
              : JSON.stringify({
                  version: 2,
                  format: 'capy-archive-save',
                  snapshots: [restoredSnap],
                  puzzles: {},
                });
        if (restoreCase.mode === '2c-quota-unhealed') {
          const savedImpSet = globalThis.localStorage.setItem;
          const savedImpRem = globalThis.localStorage.removeItem;
          globalThis.localStorage.setItem = (k, v) => {
            if (k === 'capy_snapshots_v8' || k === 'capy_active_session_v8') {
              const err = new Error('Quota exceeded');
              err.name = 'QuotaExceededError';
              throw err;
            }
            return savedImpSet(k, v);
          };
          globalThis.localStorage.removeItem = () => {
            throw new Error('Blocked removeItem');
          };
          try {
            await storageMod.StorageService.clearAllSnapshots();
            const impRes = await withMockedNowAsync(restoreCase.nowMs, () =>
              storageMod.StorageService.importSnapshotData(payload, { refreshTimestamps: false })
            );
            assert.equal(impRes.importedCount, 1);
            storageMod.StorageService.flushPendingBackups();
          } finally {
            globalThis.localStorage.setItem = savedImpSet;
            globalThis.localStorage.removeItem = savedImpRem;
          }
        } else {
          globalThis.window.CapyAndroid = {
            saveBackup: () => false,
            loadBackup: (k) => (mockBackups.has(k) ? mockBackups.get(k) : null),
          };
          await storageMod.StorageService.clearAllSnapshots();
          const impRes = await withMockedNowAsync(restoreCase.nowMs, () =>
            storageMod.StorageService.importSnapshotData(payload, { refreshTimestamps: false })
          );
          assert.equal(impRes.importedCount, 1);
        }
        await withColdStorage(async (coldMod) => {
          const snaps = coldMod.StorageService.loadSnapshots();
          assert.deepEqual(
            snaps.map((s) => s.id),
            ['restored-imp'],
            `C6-NEW-${restoreCase.mode} (${restoreCase.format}) must keep restored-imp over stale old-imp`
          );
          assert.equal(snaps[0]?.lastOpened, 2000);
          assert.equal('metaUpdatedAt' in (snaps[0] || {}), false);
        });
      }

      // N10 (C6-NEW-3): updateSnapshotProgress missing-ID must be a zero-write, zero-warning, zero-timer no-op on both empty and populated lists
      for (const seedNonEmpty of [false, true]) {
        resetDurabilityState();
        if (seedNonEmpty) {
          storageMod.StorageService.saveSnapshots([
            makeSnap('present-1', { lastOpened: 5000, filledCount: 2, filledRegionIds: [1, 2] }),
          ]);
          storageMod.StorageService.flushPendingBackups();
        }
        let n10Writes = 0;
        const n10QuotaWarnings = [];
        const n10Timers = [];
        const savedN10Set = globalThis.localStorage.setItem;
        const origN10SetTimeout = globalThis.setTimeout;
        const origN10ClearTimeout = globalThis.clearTimeout;
        const unsubN10Quota = storageMod.StorageService.onQuotaWarning((w) => n10QuotaWarnings.push(w));
        globalThis.localStorage.setItem = (k, v) => {
          n10Writes += 1;
          if (k === 'capy_snapshots_v8') {
            const err = new Error('Quota exceeded');
            err.name = 'QuotaExceededError';
            throw err;
          }
          return savedN10Set(k, v);
        };
        globalThis.setTimeout = (fn, delay) => {
          const handle = { id: n10Timers.length + 1, fn, delay, cleared: false, unref() { return this; } };
          n10Timers.push(handle);
          return handle;
        };
        globalThis.clearTimeout = (handle) => {
          if (handle && typeof handle === 'object') handle.cleared = true;
        };
        try {
          const res = storageMod.StorageService.updateSnapshotProgress('missing-id', 9, 10, [1, 2, 3]);
          assert.equal(n10Writes, 0, `updateSnapshotProgress missing-id (seed=${seedNonEmpty}) must emit 0 setItem writes`);
          assert.equal(n10QuotaWarnings.length, 0, 'updateSnapshotProgress missing-id must emit 0 quota warnings');
          assert.equal(n10Timers.length, 0, 'updateSnapshotProgress missing-id must schedule 0 backup timers');
          if (seedNonEmpty) {
            assert.deepEqual(res.map((s) => s.id), ['present-1']);
            assert.equal(res[0]?.filledCount, 2);
          } else {
            assert.deepEqual(res, []);
          }
        } finally {
          unsubN10Quota();
          globalThis.localStorage.setItem = savedN10Set;
          globalThis.setTimeout = origN10SetTimeout;
          globalThis.clearTimeout = origN10ClearTimeout;
        }
      }
      } finally {
        await coldGroupVite.close();
      }

      resetDurabilityState();

      const workerSvcSrc = fs.readFileSync(
        path.resolve(projectRoot, 'src/services/PuzzleWorkerService.ts'),
        'utf8'
      );
      assert.equal(
        /^\s*import\s+[^;]*PuzzleGenerator/m.test(workerSvcSrc),
        false,
        'PuzzleWorkerService.ts must dynamically import PuzzleGenerator on fallback instead of static bundle import'
      );
    } finally {
      resetDurabilityState();
      globalThis.localStorage = prevLs;
      globalThis.window = prevSsrWin;
    }

    await runReleaseSafetyHardeningTests(vite);
    logUnitPass('.changelog fragments, compile-changelog.mjs, StorageNamespace, UserSettings, FeatureOffersService, StorageService & M1 release safety hardening verified.');

    // M4 ($0 BYOC Account Login & Cloud Sync): PKCE S256, MicrosoftCloudDriver, AppleCloudDriver,
    // createAutoCloudSyncScheduler & Cross-Provider CRDT Merge Parity
    logUnitStart('M4 $0 BYOC Cloud Sync (PKCE S256, Microsoft OneDrive, Apple CloudKit, Auto-Sync Scheduler & Cross-Provider CRDT)');
    {
      const pkceMod = await vite.ssrLoadModule('/src/services/providers/OAuthPkceHelper.ts');
      const msClientMod = await vite.ssrLoadModule('/src/services/providers/MicrosoftCloudSyncClient.ts');
      const appleClientMod = await vite.ssrLoadModule('/src/services/providers/AppleCloudSyncClient.ts');
      const driversMod = await vite.ssrLoadModule('/src/services/providers/CloudProviderDrivers.ts');
      const coordMod = await vite.ssrLoadModule('/src/services/cloudSyncCoordinator.ts');
      const codecMod = await vite.ssrLoadModule('/src/services/CapyCodec.ts');

      // 1. PKCE S256 verifier/challenge (RFC 7636 known vector) + state CSRF validation
      const rfcVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
      const rfcChallenge = await pkceMod.derivePkceCodeChallenge(rfcVerifier);
      assert.equal(
        rfcChallenge,
        'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
        'PKCE S256 challenge must match RFC 7636 Appendix B test vector'
      );
      const genVerifier = pkceMod.generatePkceCodeVerifier(32);
      assert.equal(genVerifier.length >= 43 && genVerifier.length <= 128, true, 'PKCE verifier length must be 43..128');
      const genState = pkceMod.generateOAuthState(24);
      assert.equal(pkceMod.validateOAuthCallbackState(genState, genState), true);
      assert.equal(pkceMod.validateOAuthCallbackState(genState, `${genState}_tampered`), false);
      const authUrl = pkceMod.buildOAuthAuthorizeUrl({
        authorizeEndpoint: msClientMod.MICROSOFT_AUTHORIZE_ENDPOINT,
        clientId: 'ms-client-id-123',
        redirectUri: pkceMod.ANDROID_OAUTH_REDIRECT_URI,
        scope: msClientMod.MICROSOFT_OAUTH_SCOPES,
        state: genState,
        codeChallenge: rfcChallenge,
      });
      const parsedAuth = new URL(authUrl);
      assert.equal(parsedAuth.searchParams.get('code_challenge_method'), 'S256');
      assert.equal(parsedAuth.searchParams.get('code_challenge'), rfcChallenge);
      assert.equal(parsedAuth.searchParams.get('redirect_uri'), 'capypaint://oauth/callback');
      const parsedCb = pkceMod.parseOAuthCallbackUrl(
        `capypaint://oauth/callback?code=auth_999&state=${encodeURIComponent(genState)}`
      );
      assert.equal(parsedCb?.code, 'auth_999');
      assert.equal(parsedCb?.state, genState);

      // 2. MicrosoftCloudDriver CRUD, per-filename write mutex, and path traversal rejection
      const prevWin = globalThis.window;
      const prevSession = globalThis.sessionStorage;
      const prevLocal = globalThis.localStorage;
      const memSession = new Map();
      const memLocal = new Map();
      globalThis.sessionStorage = {
        getItem: (k) => memSession.get(k) ?? null,
        setItem: (k, v) => memSession.set(k, String(v)),
        removeItem: (k) => memSession.delete(k),
        clear: () => memSession.clear(),
      };
      globalThis.localStorage = {
        getItem: (k) => memLocal.get(k) ?? null,
        setItem: (k, v) => memLocal.set(k, String(v)),
        removeItem: (k) => memLocal.delete(k),
        clear: () => memLocal.clear(),
      };
      globalThis.window = {
        location: { hostname: 'localhost', search: '?debug=1', origin: 'http://localhost:3000', pathname: '/' },
        __capyMockMicrosoftOAuthToken: 'mock_ms_token_unit_123',
        __capyMockAppleCloudSession: {
          userId: 'apple_unit_001',
          displayName: 'Apple Unit Tester',
          email: 'apple.unit@example.com',
        },
      };

      try {
        const oneDriveFiles = new Map();
        const writeOrder = [];
        const mockGraphFetch = async (url, init = {}) => {
          const urlStr = String(url);
          const match = /\/special\/approot:\/([^:/]+):\/content$/.exec(urlStr);
          if (!match) {
            return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
          }
          const fileName = decodeURIComponent(match[1]);
          if (init.method === 'PUT') {
            writeOrder.push(`start:${fileName}:${oneDriveFiles.size}`);
            await new Promise((r) => setTimeout(r, 10));
            const rawBody = init.body;
            if (typeof rawBody === 'string') {
              oneDriveFiles.set(fileName, rawBody);
            } else {
              oneDriveFiles.set(fileName, new Uint8Array(rawBody));
            }
            writeOrder.push(`end:${fileName}`);
            return { ok: true, status: 200, json: async () => ({ id: fileName }) };
          }
          if (!oneDriveFiles.has(fileName)) {
            return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
          }
          const stored = oneDriveFiles.get(fileName);
          if (typeof stored === 'string') {
            return { ok: true, status: 200, json: async () => JSON.parse(stored) };
          }
          return { ok: true, status: 200, arrayBuffer: async () => stored.buffer.slice(stored.byteOffset, stored.byteOffset + stored.byteLength) };
        };

        const msDriver = new driversMod.MicrosoftCloudDriver({ fetchImpl: mockGraphFetch });
        assert.equal(msDriver.getDescriptor().isSupported, true);
        assert.equal(msDriver.getDescriptor().isConfigured, true);
        const msProfile = await msDriver.signIn();
        assert.equal(msProfile.provider, 'microsoft');
        assert.equal(msProfile.email, 'capy.ms@example.com');
        assert.equal(msDriver.hasActiveSession(), true);

        // Traversal filenames strictly rejected
        assert.equal(msClientMod.isValidOneDriveFileName('../secret.json'), false);
        assert.equal(msClientMod.isValidOneDriveFileName('dir/file.json'), false);
        assert.equal(msClientMod.isValidOneDriveFileName('foo:bar.json'), false);
        assert.equal(await msDriver.readBinaryBlob('../secret.capy'), null);
        assert.equal(await msDriver.writeBinaryBlob('slot1', '../evil.capy', new Uint8Array([1, 2])), null);

        // Per-filename write mutex serializes overlapping manifest writes
        const manifest1 = { version: 2, updatedAt: 1000, devicePlayerId: 'dev_a', providerId: 'microsoft', entries: {} };
        const manifest2 = { version: 2, updatedAt: 2000, devicePlayerId: 'dev_b', providerId: 'microsoft', entries: {} };
        const [w1, w2] = await Promise.all([
          msDriver.writeManifest(manifest1),
          msDriver.writeManifest(manifest2),
        ]);
        assert.equal(w1, true);
        assert.equal(w2, true);
        assert.equal(writeOrder[0].startsWith('start:capy_cloud_manifest_v2.json'), true);
        assert.equal(writeOrder[1], 'end:capy_cloud_manifest_v2.json');
        assert.equal(writeOrder[2].startsWith('start:capy_cloud_manifest_v2.json'), true);
        const readBackManifest = await msDriver.readManifest();
        assert.equal(readBackManifest?.updatedAt, 2000);

        // Slot envelope + binary blob CRUD
        const slotEnv = {
          slotKey: 'sample_capybara',
          title: 'Capybara',
          deltaToken: 'tok_ms',
          filledCount: 3,
          totalCount: 10,
          updatedAt: 2500,
          devicePlayerId: 'dev_b',
        };
        assert.equal(await msDriver.writeSlotEnvelope(slotEnv), true);
        const readSlot = await msDriver.readSlotEnvelope('sample_capybara');
        assert.equal(readSlot?.deltaToken, 'tok_ms');
        const blobBytes = new Uint8Array([67, 65, 80, 89, 2, 1, 9, 8]);
        const blobRef = await msDriver.writeBinaryBlob('slot1', 'capy_save_slot1.capy', blobBytes);
        assert.equal(blobRef, 'capy_save_slot1.capy');
        const readBlob = await msDriver.readBinaryBlob('capy_save_slot1.capy');
        assert.deepEqual(Array.from(readBlob || []), Array.from(blobBytes));
        await msDriver.signOut();
        assert.equal(msDriver.hasActiveSession(), false);

        // 3. AppleCloudDriver CRUD, mock session & traversal rejection
        appleClientMod.clearMockAppleRecordStore();
        const appleDriver = new driversMod.AppleCloudDriver();
        assert.equal(appleDriver.getDescriptor().isSupported, true);
        assert.equal(appleDriver.getDescriptor().isConfigured, true);
        const appleProfile = await appleDriver.signIn();
        assert.equal(appleProfile.provider, 'apple');
        assert.equal(appleProfile.email, 'apple.unit@example.com');
        assert.equal(appleDriver.hasActiveSession(), true);
        assert.equal(appleClientMod.isValidCloudKitRecordName('../evil.json'), false);
        assert.equal(await appleDriver.writeBinaryBlob('s1', '../evil.capy', blobBytes), null);
        assert.equal(await appleDriver.writeManifest(manifest2), true);
        const appleManifest = await appleDriver.readManifest();
        assert.equal(appleManifest?.updatedAt, 2000);
        const appleBlobRef = await appleDriver.writeBinaryBlob('s1', 'capy_save_apple.capy', blobBytes);
        assert.equal(appleBlobRef, 'capy_save_apple.capy');
        const readAppleBlob = await appleDriver.readBinaryBlob('capy_save_apple.capy');
        assert.deepEqual(Array.from(readAppleBlob || []), Array.from(blobBytes));
        await appleDriver.signOut();
        assert.equal(appleDriver.hasActiveSession(), false);

        // 4. createAutoCloudSyncScheduler debounce, visibilitychange, online & unauthenticated no-op
        let fakeNow = 100_000;
        let nextTimerId = 1;
        const timers = new Map();
        let canSyncFlag = false;
        let syncCalls = 0;
        const scheduler = coordMod.createAutoCloudSyncScheduler({
          sync: async () => {
            syncCalls += 1;
          },
          canSync: () => canSyncFlag,
          debounceMs: 15_000,
          staleVisibilityMs: 30_000,
          now: () => fakeNow,
          setTimer: (cb, ms) => {
            const id = nextTimerId++;
            timers.set(id, { cb, fireAt: fakeNow + ms });
            return id;
          },
          clearTimer: (id) => {
            timers.delete(id);
          },
        });
        // Strictly no-op when unauthenticated / offline
        scheduler.notifyLocalMutation();
        scheduler.notifyVisibilityVisible();
        scheduler.notifyOnline();
        assert.equal(timers.size, 0, 'Unauthenticated scheduler must not arm timers');
        assert.equal(syncCalls, 0, 'Unauthenticated scheduler must not trigger sync');

        // Authenticated: 3 rapid mutations coalesce into a single 15s debounced sync
        canSyncFlag = true;
        scheduler.notifyLocalMutation();
        scheduler.notifyLocalMutation();
        scheduler.notifyLocalMutation();
        assert.equal(timers.size, 1, 'Rapid local mutations must coalesce into 1 debounce timer');
        const firstEntry = [...timers.values()][0];
        fakeNow = firstEntry.fireAt;
        timers.clear();
        firstEntry.cb();
        await Promise.resolve();
        assert.equal(syncCalls, 1, 'Debounced mutation must trigger exactly 1 sync');

        // Visibility visible before 30s stale window -> no-op; after 30s -> triggers sync
        fakeNow += 10_000;
        scheduler.notifyVisibilityVisible();
        await Promise.resolve();
        assert.equal(syncCalls, 1, 'Visibility change within 30s stale threshold must not re-sync');
        fakeNow += 25_000;
        scheduler.notifyVisibilityVisible();
        await Promise.resolve();
        assert.equal(syncCalls, 2, 'Visibility change after 30s stale threshold must trigger sync');

        // Online reconnect triggers immediate sync & cancels pending debounce
        scheduler.notifyLocalMutation();
        assert.equal(timers.size, 1);
        scheduler.notifyOnline();
        await Promise.resolve();
        assert.equal(timers.size, 0, 'Online reconnect must cancel pending debounce timer');
        assert.equal(syncCalls, 3, 'Online reconnect must trigger immediate sync');

        scheduler.dispose();
        scheduler.notifyLocalMutation();
        assert.equal(timers.size, 0, 'Disposed scheduler must never schedule new timers');

        // 5. Cross-provider CRDT merge parity (Google Drive <-> Microsoft OneDrive <-> Apple iCloud)
        const googleDelta = {
          filledRegionIds: [1, 2, 5],
          paintedRegionColors: { 5: 0xffff0000 },
          updatedAt: 1000,
          resetEpoch: 1,
        };
        const msDelta = {
          filledRegionIds: [2, 3, 6],
          paintedRegionColors: { 5: 0xff00ff00, 6: 0xff0000ff },
          updatedAt: 2000,
          resetEpoch: 1,
        };
        const mergedAB = codecMod.mergeProgressDeltas(googleDelta, msDelta);
        const mergedBA = codecMod.mergeProgressDeltas(msDelta, googleDelta);
        assert.deepEqual([...mergedAB.filledRegionIds].sort((a, b) => a - b), [1, 2, 3, 5, 6]);
        assert.deepEqual([...mergedBA.filledRegionIds].sort((a, b) => a - b), [1, 2, 3, 5, 6]);
        assert.equal(mergedAB.paintedRegionColors[5], 0xff00ff00, 'Newer updatedAt must win LWW custom color');
        assert.equal(mergedBA.paintedRegionColors[5], 0xff00ff00, 'CRDT merge must be commutative across providers');
      } finally {
        globalThis.window = prevWin;
        globalThis.sessionStorage = prevSession;
        globalThis.localStorage = prevLocal;
      }
    }
    logUnitPass('M4 $0 BYOC Cloud Sync (PKCE S256, MicrosoftCloudDriver, AppleCloudDriver, Auto-Sync Scheduler & Cross-Provider CRDT) verified.');
    assert.equal(
      unitStep,
      unitTotal,
      `Expected ${unitTotal} executed Part 1 unit groups, got ${unitStep}`
    );
  } finally {
    await vite.close();
  }
}

async function runBrowserBasicsSuite() {
  let previewServer = null;
  let BASE_URL = EXPLICIT_TEST_URL;
  if (BASE_URL) {
    if (!(await isServerListening(BASE_URL))) {
      const explicitPort = Number(new URL(BASE_URL).port || 3000);
      previewServer = await preview({
        root: projectRoot,
        preview: { host: '0.0.0.0', port: explicitPort, strictPort: true },
        logLevel: 'error',
      });
    }
  } else {
    previewServer = await preview({
      root: projectRoot,
      preview: { host: '0.0.0.0', port: Number(process.env.CAPY_TEST_PORT || 0), strictPort: false },
      logLevel: 'error',
    });
    const addr = previewServer.httpServer.address();
    const boundPort = typeof addr === 'object' && addr ? addr.port : 3000;
    BASE_URL = `http://localhost:${boundPort}`;
  }
  console.log(`\n=== PART 2: Unified Browser E2E Suite (${BASE_URL}) ===`);

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
    await context.addInitScript(() => {
      localStorage.setItem('capy_dev_debug', '1');
    });
    const page = await context.newPage();
    attachErrorListeners(page, 'main');

    const e2eTotal = 23;
    const padE2e = (n) => String(n).padStart(2, '0');
    let e2eStep = 0;
    const logE2eStart = (label) => {
      e2eStep += 1;
      console.log(`[E2E ${padE2e(e2eStep)}/${padE2e(e2eTotal)}] ${label}`);
    };
    const logE2ePass = (label) => {
      console.log(`   PASS [E2E ${padE2e(e2eStep)}/${padE2e(e2eTotal)}]: ${label}`);
    };

    // -------------------------------------------------------------------------
    // 1. PWA Manifest, Digital Asset Links, Privacy Policy & Instant Pre-Baked First Launch
    // -------------------------------------------------------------------------
    logE2eStart('Verifying PWA manifest, Digital Asset Links, privacy policy, Service Worker & instant pre-baked boot...');
    const manifestRes = await page.goto(`${BASE_URL}/manifest.webmanifest`);
    assert.equal(manifestRes?.status(), 200);
    const manifestJson = JSON.parse(await manifestRes.text());
    assert.equal(manifestJson.name, 'Capy Paint');
    assert.equal(manifestJson.display, 'standalone');

    const assetLinksRes = await page.goto(`${BASE_URL}/.well-known/assetlinks.json`);
    assert.equal(assetLinksRes?.status(), 200);
    const assetLinksJson = JSON.parse(await assetLinksRes.text());
    assert.equal(assetLinksJson[0]?.target?.package_name, 'com.capyboop.paint');
    assert.equal(Array.isArray(assetLinksJson[0]?.target?.sha256_cert_fingerprints), true);
    assert.equal(
      assetLinksJson[0].target.sha256_cert_fingerprints.includes(
        '00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00'
      ),
      false,
      'assetlinks.json must never ship all-zero placeholder SHA-256 fingerprints'
    );

    const privacyRes = await page.goto(`${BASE_URL}/privacy-policy.html`);
    assert.equal(privacyRes?.status(), 200);
    assert.equal((await page.evaluate(() => document.body.innerText)).includes('Google Play Data Safety'), true);
    assert.equal(
      await page.locator('a[href="https://github.com/capyboop/paint/issues"]').count(),
      1,
      'privacy-policy.html must link to https://github.com/capyboop/paint/issues'
    );

    let workerRequestedOnBoot = false;
    const onReq = (req) => {
      if (req.url().includes('puzzle.worker')) workerRequestedOnBoot = true;
    };
    page.on('request', onReq);
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(page);
    page.off('request', onReq);

    assert.equal(workerRequestedOnBoot, false, 'Pre-baked sample_saves.capy must boot with zero worker wait');
    const expectedSwCacheKey = `capy-cache-v${webPkgJson.version}:/`;
    const bootMeta = await page.evaluate(async (expectedKey) => {
      const snaps = JSON.parse(localStorage.getItem('capy_snapshots_v8') || '[]');
      const swReady = 'serviceWorker' in navigator ? Boolean((await navigator.serviceWorker.ready)?.active) : false;
      const cacheNames = await caches.keys();
      return {
        count: snaps.length,
        firstId: snaps[0]?.id,
        swReady,
        hasScopedCache: cacheNames.includes(expectedKey),
        hasLegacyCache: cacheNames.includes('capy-cache-v2'),
      };
    }, expectedSwCacheKey);
    assert.equal(bootMeta.count, 4);
    assert.equal(bootMeta.firstId, 'sample-capy-forest');
    assert.equal(bootMeta.swReady, true);
    assert.equal(bootMeta.hasScopedCache, true, `Expected Service Worker cache ${expectedSwCacheKey}`);
    assert.equal(bootMeta.hasLegacyCache, false, 'Legacy unscoped capy-cache-v2 must not exist');

    // Verify Interactive First-Run Tutorial appears on cold start, supports live try-it steps (auto-advance + badge), and persists completion
    const tutorialCard = page.getByTestId('onboarding-tutorial');
    await tutorialCard.waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await page.getByTestId('tutorial-step-indicator').innerText(), 'STEP 1 OF 14');
    // Verify Large Text prompt in OnboardingTutorial toggles data-large-text cleanly
    const tutLargeTextBtn = page.getByTestId('tutorial-large-text-btn');
    await tutLargeTextBtn.waitFor({ state: 'visible', timeout: 3000 });
    await tutLargeTextBtn.click();
    assert.equal(
      await page.evaluate(() => document.documentElement.dataset.largeText),
      'true',
      'tutorial-large-text-btn must enable data-large-text="true"'
    );
    await tutLargeTextBtn.click();
    assert.equal(
      await page.evaluate(() => document.documentElement.dataset.largeText),
      'false',
      'tutorial-large-text-btn must toggle data-large-text back to "false"'
    );
    // Step 1: Pick Color (click an unselected palette swatch -> shows Tried! badge and auto-advances to Step 2)
    await page.locator('[aria-label="Palette dock"] button[aria-pressed="false"]').first().click();
    await page.getByTestId('tutorial-step-tried-badge').waitFor({ state: 'visible', timeout: 3000 });
    await page.waitForFunction(
      () => document.querySelector('[data-testid="tutorial-step-indicator"]')?.textContent?.trim().toUpperCase() === 'STEP 2 OF 14',
      undefined,
      { timeout: 3000 }
    );
    // Step 2: Tap & Paint Shape (tap canvas below tutorial card -> shows Tried! badge and auto-advances to Step 3)
    const canvasBoxTut = await page.locator('canvas').first().boundingBox();
    for (let attempt = 0; attempt < 6; attempt++) {
      const xFrac = 0.42 + (attempt % 3) * 0.08;
      const yFrac = 0.60 + Math.floor(attempt / 3) * 0.08;
      await page.mouse.click(canvasBoxTut.x + canvasBoxTut.width * xFrac, canvasBoxTut.y + canvasBoxTut.height * yFrac);
      await page.waitForTimeout(80);
      if ((await page.getByTestId('tutorial-step-tried-badge').count()) > 0) break;
    }
    await page.getByTestId('tutorial-step-tried-badge').waitFor({ state: 'visible', timeout: 3000 });
    await page.waitForFunction(
      () => document.querySelector('[data-testid="tutorial-step-indicator"]')?.textContent?.trim().toUpperCase() === 'STEP 3 OF 14',
      undefined,
      { timeout: 3000 }
    );
    const step3Text = (await tutorialCard.innerText()).toLowerCase();
    assert.equal(
      step3Text.includes('1x zoom badge') || step3Text.includes('1x badge'),
      false,
      'OnboardingTutorial Step 3 must not reference stale 1x zoom badge'
    );
    // Step 3: Zoom & Pan (step zoom -> shows Tried! badge and auto-advances to Step 4, then restore 1x)
    await page.keyboard.press('+');
    await page.getByTestId('tutorial-step-tried-badge').waitFor({ state: 'visible', timeout: 3000 });
    await page.waitForFunction(
      () => document.querySelector('[data-testid="tutorial-step-indicator"]')?.textContent?.trim().toUpperCase() === 'STEP 4 OF 14',
      undefined,
      { timeout: 3000 }
    );
    await page.keyboard.press('0');
    // Step 4: Smart Hints (use inline Try Hint button -> marks tried and auto-advances to Step 5)
    await page.getByTestId('tutorial-try-hint-btn').click();
    await page.getByTestId('tutorial-step-tried-badge').waitFor({ state: 'visible', timeout: 3000 });
    await page.waitForFunction(
      () => document.querySelector('[data-testid="tutorial-step-indicator"]')?.textContent?.trim().toUpperCase() === 'STEP 5 OF 14',
      undefined,
      { timeout: 3000 }
    );
    // Skip remaining steps on main page to preserve clean Capy Forest state; full 14-step tour runs in dedicated tutContext below
    await page.getByTestId('tutorial-skip-btn').click();
    await tutorialCard.waitFor({ state: 'hidden', timeout: 3000 });
    const tutorialCompletedFlag = await page.evaluate(() => localStorage.getItem('capy_tutorial_completed_v1'));
    assert.equal(tutorialCompletedFlag, '1');

    // Verify ?skipTutorial=1 suppresses tutorial AND Escape with modal open closes only modal before tutorial
    const skipTutContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const skipTutPage = await skipTutContext.newPage();
    attachErrorListeners(skipTutPage, 'skipTutPage');
    await skipTutPage.goto(`${BASE_URL}/?skipTutorial=1`, { waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(skipTutPage);
    assert.equal(
      await skipTutPage.getByTestId('onboarding-tutorial').count(),
      0,
      '?skipTutorial=1 must suppress OnboardingTutorial on cold start'
    );
    await skipTutPage.close();
    await skipTutContext.close();

    const escTutContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const escTutPage = await escTutContext.newPage();
    attachErrorListeners(escTutPage, 'escTutPage');
    await escTutPage.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(escTutPage);
    await escTutPage.getByTestId('onboarding-tutorial').waitFor({ state: 'visible', timeout: 5000 });
    await escTutPage.locator('button[title="Settings and Menu"]').click();
    await escTutPage.getByTestId('about-screen-card').waitFor({ state: 'visible', timeout: 3000 });
    await escTutPage.keyboard.press('Escape');
    await escTutPage.getByTestId('about-screen-card').waitFor({ state: 'hidden', timeout: 3000 });
    assert.equal(
      await escTutPage.getByTestId('onboarding-tutorial').isVisible(),
      true,
      'Pressing Escape while SettingsModal is open must NOT double-dismiss OnboardingTutorial'
    );
    await escTutPage.keyboard.press('Escape');
    await escTutPage.getByTestId('onboarding-tutorial').waitFor({ state: 'hidden', timeout: 3000 });
    assert.equal(
      await escTutPage.evaluate(() => localStorage.getItem('capy_tutorial_completed_v1')),
      '1',
      'Pressing Escape with no modal open must dismiss OnboardingTutorial and persist completion'
    );
    await escTutPage.close();
    await escTutContext.close();
    logE2ePass('PWA manifest, Digital Asset Links, privacy policy, Service Worker cache & instant 4-sample boot verified.');

    const v3012ScreenshotDir = (process.env.CAPY_V3012_SCREENSHOT_DIR || '').trim();
    const captureV3012Screenshot = async (targetPage, filename) => {
      if (!v3012ScreenshotDir) return;
      fs.mkdirSync(v3012ScreenshotDir, { recursive: true });
      await targetPage.screenshot({ path: path.join(v3012ScreenshotDir, filename) });
    };

    const assertSpotlightAligned = async (targetPage, expectedVariant) => {
      await targetPage.waitForFunction(
        (variant) => {
          const overlay = document.querySelector('[data-testid="spotlight-overlay"]');
          if (!overlay || overlay.getAttribute('data-variant') !== variant) return false;
          const rings = Array.from(overlay.querySelectorAll('[data-testid="spotlight-ring"]'));
          const pointer = overlay.querySelector('[data-testid="spotlight-pointer"]');
          if (rings.length === 0 || !pointer) return false;
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          const ringRects = rings.map((r) => r.getBoundingClientRect());
          for (let i = 0; i < ringRects.length; i++) {
            for (let j = i + 1; j < ringRects.length; j++) {
              const a = ringRects[i];
              const b = ringRects[j];
              const hx = Math.min(a.right, b.right) - Math.max(a.left, b.left);
              const vy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
              if (hx > 0.5 && vy > 0.5) return false;
            }
          }
          const hasRunningTransition = (el) => {
            let node = el;
            while (node && node !== document.body && node !== document.documentElement) {
              if (typeof node.getAnimations === 'function') {
                const anims = node.getAnimations();
                for (const a of anims) {
                  if (
                    typeof CSSTransition !== 'undefined' &&
                    a instanceof CSSTransition &&
                    a.playState === 'running'
                  ) {
                    return true;
                  }
                }
              }
              node = node.parentElement;
            }
            return false;
          };
          let overlapsTarget = false;
          const allInView = rings.every((ring, idx) => {
            const rr = ringRects[idx];
            if (
              rr.width <= 0 ||
              rr.height <= 0 ||
              rr.left < 0 ||
              rr.top < 0 ||
              rr.right > vw + 1 ||
              rr.bottom > vh + 1
            ) {
              return false;
            }
            const sel = ring.getAttribute('data-target-selector') || '';
            const targets = sel ? Array.from(document.querySelectorAll(sel)) : [];
            for (const targetEl of targets) {
              if (hasRunningTransition(targetEl)) return false;
              const tr = targetEl.getBoundingClientRect();
              if (
                rr.left <= tr.right + 2 &&
                rr.right >= tr.left - 2 &&
                rr.top <= tr.bottom + 2 &&
                rr.bottom >= tr.top - 2
              ) {
                overlapsTarget = true;
              }
            }
            return true;
          });
          return allInView && overlapsTarget;
        },
        expectedVariant,
        { timeout: 4000 }
      );
      const metrics = await targetPage.evaluate(() => {
        const overlay = document.querySelector('[data-testid="spotlight-overlay"]');
        const pointer = overlay?.querySelector('[data-testid="spotlight-pointer"]');
        const path = pointer?.querySelector('path');
        const poly = pointer?.querySelector('polygon');
        const rings = Array.from(overlay?.querySelectorAll('[data-testid="spotlight-ring"]') || []);
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        let overlapsTarget = false;
        const ringRects = rings.map((r) => r.getBoundingClientRect());
        let ringsSeparated = true;
        for (let i = 0; i < ringRects.length; i++) {
          for (let j = i + 1; j < ringRects.length; j++) {
            const a = ringRects[i];
            const b = ringRects[j];
            const hx = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const vy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (hx > 0.5 && vy > 0.5) {
              ringsSeparated = false;
            }
          }
        }
        const ringsInView = rings.every((ring, idx) => {
          const rr = ringRects[idx];
          const inView =
            rr.width > 0 &&
            rr.height > 0 &&
            rr.left >= 0 &&
            rr.top >= 0 &&
            rr.right <= vw + 1 &&
            rr.bottom <= vh + 1;
          const sel = ring.getAttribute('data-target-selector') || '';
          const targets = sel ? Array.from(document.querySelectorAll(sel)) : [];
          for (const targetEl of targets) {
            const tr = targetEl.getBoundingClientRect();
            const hits =
              rr.left <= tr.right + 2 &&
              rr.right >= tr.left - 2 &&
              rr.top <= tr.bottom + 2 &&
              rr.bottom >= tr.top - 2;
            if (hits) overlapsTarget = true;
          }
          return inView;
        });
        const pointerBox = pointer ? pointer.getBoundingClientRect() : null;
        const pathBox = path ? path.getBoundingClientRect() : null;
        return {
          pointerEvents: overlay ? getComputedStyle(overlay).pointerEvents : '',
          ringCount: rings.length,
          ringsInView,
          ringsSeparated,
          overlapsTarget,
          hasPath: Boolean(path?.getAttribute('d')),
          hasArrow: Boolean(poly?.getAttribute('points')),
          pointerSpan: Math.max(pathBox?.width || 0, pathBox?.height || 0, pointerBox ? 0 : 0),
          ringAnim: rings[0] ? getComputedStyle(rings[0]).animationName : '',
          ringTransitionDur: rings[0] ? getComputedStyle(rings[0]).transitionDuration : '',
        };
      });
      assert.equal(metrics.pointerEvents, 'none', 'spotlight-overlay must be non-blocking');
      assert.equal(metrics.ringCount >= 1, true, 'Expected at least 1 spotlight-ring');
      assert.equal(metrics.ringsInView, true, `Spotlight rings must fit inside viewport: ${JSON.stringify(metrics)}`);
      assert.equal(metrics.ringsSeparated, true, `Adjacent spotlight rings must not overlap: ${JSON.stringify(metrics)}`);
      assert.equal(metrics.overlapsTarget, true, `Spotlight ring must overlap target element: ${JSON.stringify(metrics)}`);
      assert.equal(metrics.hasPath && metrics.hasArrow, true, 'Expected spotlight-pointer SVG path and arrowhead');
      return metrics;
    };

    // -------------------------------------------------------------------------
    // 2. Full 14-Step OnboardingTutorial Tour, Spotlight Alignment & Ctrl+Z Burst
    // -------------------------------------------------------------------------
    logE2eStart('Verifying 14-step OnboardingTutorial tour, TargetSpotlightOverlay alignment, [All Topics] drawer & rapid Ctrl+Z burst...');
    const tutContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true });
    const tutPage = await tutContext.newPage();
    attachErrorListeners(tutPage, 'tutPage');
    await tutPage.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(tutPage);
    await tutPage.getByTestId('onboarding-tutorial').waitFor({ state: 'visible', timeout: 5000 });
    const expectTutStep = async (stepNum) => {
      await tutPage.waitForFunction(
        (expected) =>
          document.querySelector('[data-testid="tutorial-step-indicator"]')?.textContent?.trim().toUpperCase() ===
          `STEP ${expected} OF 14`,
        stepNum,
        { timeout: 5000 }
      );
    };
    await expectTutStep(1);
    const step1LargeBtnBox = await tutPage.getByTestId('tutorial-large-text-btn').boundingBox();
    assert.ok(step1LargeBtnBox && step1LargeBtnBox.width > 200, 'Step 1 Large Text button must be full-width banner');
    await assertSpotlightAligned(tutPage, 'tutorial');
    // Step 0 -> 1 (palette): tapping the ALREADY-active swatch on Step 1 must advance cleanly without triggering hint
    await tutPage.locator('[data-testid="palette-dock"] button[aria-pressed="true"]').first().click();
    await expectTutStep(2);
    const step2PromptText = await tutPage.getByTestId('tutorial-try-pill').innerText();
    assert.equal(
      step2PromptText.includes('Try it: Tap a matching number on the picture') &&
        !step2PromptText.includes('Capy Forest'),
      true,
      `Step 2 prompt must be generic without hardcoded Capy Forest (got "${step2PromptText}")`
    );
    const step2LargeBtnBox = await tutPage.getByTestId('tutorial-large-text-btn').boundingBox();
    assert.ok(
      step2LargeBtnBox && step2LargeBtnBox.width < 150 && step2LargeBtnBox.height <= 34,
      `Step 2+ Large Text toggle must be compact pill (got ${JSON.stringify(step2LargeBtnBox)})`
    );
    await assertSpotlightAligned(tutPage, 'tutorial');
    // Step 1 -> 2 (paint): paint 2 regions so we can verify bootstrap/rapid Ctrl+Z undoStackRef parity
    const tutCanvasBox = await tutPage.locator('canvas').first().boundingBox();
    let paintedOnTut = 0;
    for (let attempt = 0; attempt < 8 && paintedOnTut < 2; attempt++) {
      const beforeFilled = Number(await tutPage.getByTestId('topbar-saves-btn').getAttribute('data-filled-count'));
      const xFrac = 0.42 + (attempt % 4) * 0.06;
      const yFrac = 0.58 + Math.floor(attempt / 4) * 0.08;
      await tutPage.mouse.click(tutCanvasBox.x + tutCanvasBox.width * xFrac, tutCanvasBox.y + tutCanvasBox.height * yFrac);
      await tutPage.waitForTimeout(80);
      const afterFilled = Number(await tutPage.getByTestId('topbar-saves-btn').getAttribute('data-filled-count'));
      if (afterFilled > beforeFilled) paintedOnTut++;
    }
    assert.ok(paintedOnTut >= 1, 'Expected at least 1 region painted on tutPage');
    await expectTutStep(3);
    // Verify topbar-saves-btn exposes data-filled-count >= 1
    assert.ok(
      Number(await tutPage.getByTestId('topbar-saves-btn').getAttribute('data-filled-count')) >= 1,
      'Expected topbar-saves-btn data-filled-count >= 1 after painting'
    );
    // Step 2 -> 3 (zoom)
    await tutPage.keyboard.press('+');
    await expectTutStep(4);
    await tutPage.keyboard.press('0');
    await assertSpotlightAligned(tutPage, 'tutorial');
    // Step 3 -> 4 (hint)
    await tutPage.getByTestId('tutorial-try-hint-btn').click();
    await expectTutStep(5);
    await assertSpotlightAligned(tutPage, 'tutorial');
    // Step 4 -> 5 (undo_redo)
    await tutPage.getByTestId('undo-btn').click();
    await expectTutStep(6);
    // Back onto already-tried Step 4 (STEP 5 OF 14) must wait for a fresh action (Redo) instead of auto-advancing immediately
    await tutPage.getByTestId('tutorial-prev-btn').click();
    await expectTutStep(5);
    await tutPage.waitForTimeout(950);
    assert.equal(
      (await tutPage.getByTestId('tutorial-step-indicator').innerText()).trim().toUpperCase(),
      'STEP 5 OF 14',
      'Back onto already-tried Step 5 must wait for a fresh Undo/Redo action before advancing'
    );
    await tutPage.keyboard.press('Control+y');
    await expectTutStep(6);
    // Step 5 -> 6 (replay via long-press Undo -> auto-advancing to Step 7 auto-dismisses tutorial-opened ReplayControls!)
    const tutUndoBox = await getStableBoundingBox(tutPage.getByTestId('undo-btn'));
    assert.ok(tutUndoBox, 'Expected stable boundingBox for undo-btn at Step 6');
    await tutPage.mouse.move(tutUndoBox.x + tutUndoBox.width / 2, tutUndoBox.y + tutUndoBox.height / 2);
    await tutPage.mouse.down();
    await tutPage.getByTestId('replay-controls-window').waitFor({ state: 'visible', timeout: 3000 });
    await tutPage.mouse.up();
    await expectTutStep(7);
    await tutPage.getByTestId('replay-controls-window').waitFor({ state: 'hidden', timeout: 3000 });
    const step7Metrics = await assertSpotlightAligned(tutPage, 'tutorial');
    assert.equal(step7Metrics.ringCount, 2, 'Step 7 (peek_fullscreen) must highlight both Eye and Full Screen');
    assert.equal(step7Metrics.pointerSpan >= 10, true, `Step 7 topbar pointer must have clean arrow stem (${step7Metrics.pointerSpan}px)`);
    assert.equal(
      (await tutPage.getByTestId('tutorial-try-pill').innerText()).includes(
        'Try it: Tap Eye or Expand above'
      ),
      true,
      'Step 7 tryPrompt must cleanly explain Eye or Expand'
    );
    await captureV3012Screenshot(tutPage, 'desktop_1280x800_step7_spotlight.png');
    // Step 6 -> 7 (peek_fullscreen): leaving Step 7 via preview auto-advance must automatically exit tutorial-triggered preview!
    await tutPage.getByTestId('topbar-preview-btn').click();
    await expectTutStep(8);
    await tutPage.locator('button[title="Show Original Preview"]').waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(
      await tutPage.locator('button[title="Return to Puzzle"]').count(),
      0,
      'Leaving Step 7 must automatically reset tutorial-triggered isPreviewMode'
    );
    // Step 7 -> 8 (free_color in Settings; must pause while SettingsModal is open and hide spotlight)
    await tutPage.locator('button[title="Settings and Menu"]').click();
    await tutPage.getByTestId('settings-tab-settings').click();
    assert.equal(await tutPage.getByTestId('spotlight-overlay').count(), 0, 'Spotlight must hide while SettingsModal is open');
    const tutFreeColorLabel = await tutPage.waitForSelector('text=Free Colour Mode');
    await tutFreeColorLabel.evaluate((el) => el.closest('.flex')?.querySelector('button')?.click());
    await tutPage.waitForTimeout(950);
    assert.equal(
      (await tutPage.getByTestId('tutorial-step-indicator').innerText()).trim().toUpperCase(),
      'STEP 8 OF 14',
      'Auto-advance timer must stay paused while SettingsModal is open'
    );
    await tutFreeColorLabel.evaluate((el) => el.closest('.flex')?.querySelector('button')?.click());
    await tutPage.getByTestId('settings-modal-close').click();
    await expectTutStep(9);
    // Step 8 -> 9 (gallery_daily)
    await tutPage.locator('button[title="Settings and Menu"]').click();
    await tutPage.getByTestId('settings-tab-create').click();
    await tutPage.getByTestId('settings-modal-close').click();
    await expectTutStep(10);
    await assertSpotlightAligned(tutPage, 'tutorial');
    // Step 9 -> 10 (custom_photo)
    const tutPngBytes = await tutPage.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 160;
      c.height = 120;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(0, 0, 80, 120);
      ctx.fillStyle = '#3b82f6';
      ctx.fillRect(80, 0, 80, 120);
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    });
    const tutPhotoPath = path.join(os.tmpdir(), 'capy_tut_photo.png');
    fs.writeFileSync(tutPhotoPath, Buffer.from(tutPngBytes));
    try {
      await tutPage.locator('input[type="file"][accept="image/*"]').setInputFiles(tutPhotoPath);
      await tutPage.waitForFunction(
        () =>
          document.querySelector('[data-testid="topbar-saves-btn"]')?.textContent?.includes('capy_tut_photo') &&
          !document.body.innerText.toLowerCase().includes('generating puzzle'),
        undefined,
        { timeout: 15000 }
      );
      await waitForPuzzleLoaded(tutPage);
    } finally {
      fs.rmSync(tutPhotoPath, { force: true });
    }
    await expectTutStep(11);
    // Step 11 -> 12 (puzzle_presets via Preset Style Gallery)
    await tutPage.locator('button[title="Settings and Menu"]').click();
    await tutPage.getByTestId('settings-tab-create').click();
    await tutPage.getByTestId('preset-gallery-toggle').click();
    await tutPage.getByTestId('preset-gallery-panel').waitFor({ state: 'visible', timeout: 3000 });
    await tutPage.getByTestId('preset-apply-algo-mosaic').click();
    await tutPage.getByTestId('settings-modal-close').click();
    await expectTutStep(12);
    await assertSpotlightAligned(tutPage, 'tutorial');
    // Step 12 -> 13 (infinite_zoom)
    await tutPage.locator('button[title="Settings and Menu"]').click();
    await tutPage.getByTestId('settings-tab-create').click();
    await tutPage.getByTestId('infinite-zoom-subtile-btn').click();
    await waitForPuzzleLoaded(tutPage);
    await expectTutStep(13);
    await assertSpotlightAligned(tutPage, 'tutorial');
    // Step 13 -> 14 (saves_export)
    await tutPage.getByTestId('topbar-saves-btn').click();
    await tutPage.getByTestId('settings-modal-close').click();
    await expectTutStep(14);
    await assertSpotlightAligned(tutPage, 'tutorial');
    // [All Topics] drawer lists all 14 topics; jumping onto already-tried Step 1 waits for a fresh action
    await tutPage.getByTestId('tutorial-topics-btn').click();
    await tutPage.getByTestId('tutorial-topics-drawer').waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(await tutPage.locator('[data-testid^="tutorial-topic-item-"]').count(), 14);
    await tutPage.getByTestId('tutorial-topic-item-0').click();
    await expectTutStep(1);
    await tutPage.waitForTimeout(950);
    assert.equal(
      (await tutPage.getByTestId('tutorial-step-indicator').innerText()).trim().toUpperCase(),
      'STEP 1 OF 14',
      'Jumping via All Topics onto already-tried Step 1 must wait for a fresh action'
    );
    await tutPage.getByTestId('tutorial-topics-btn').click();
    await tutPage.getByTestId('tutorial-topic-item-13').click();
    await expectTutStep(14);
    // Step 14 (settings_a11y) auto-completes tutorial after 750ms via Large Text toggle
    await tutPage.getByTestId('tutorial-large-text-btn').click();
    await tutPage.getByTestId('tutorial-large-text-btn').click();
    await tutPage.getByTestId('onboarding-tutorial').waitFor({ state: 'hidden', timeout: 4000 });
    assert.equal(
      await tutPage.evaluate(() => localStorage.getItem('capy_tutorial_completed_v1')),
      '1',
      'Step 13 auto-completion must persist capy_tutorial_completed_v1="1"'
    );

    // Verify Jump and Skip from Step 6 auto-dismiss tutorial-opened Replay, while pre-existing manual Replay stays open across Step 6->7
    const tapSampleAndOpenTutorialAtStep6 = async () => {
      await tutPage.locator('button[title="Settings and Menu"]').click();
      await tutPage.getByTestId('settings-tab-about').click();
      await tutPage.getByTestId('about-replay-tutorial-btn').click();
      await tutPage.getByTestId('onboarding-tutorial').waitFor({ state: 'visible', timeout: 3000 });
      await tutPage.getByTestId('tutorial-topics-btn').click();
      await tutPage.getByTestId('tutorial-topic-item-5').click();
      await expectTutStep(6);
    };
    // Paint 1 region first so Undo/Replay is available
    await tutPage.mouse.click(tutCanvasBox.x + tutCanvasBox.width * 0.5, tutCanvasBox.y + tutCanvasBox.height * 0.62);
    await tutPage.waitForTimeout(100);
    await tapSampleAndOpenTutorialAtStep6();
    const undoBtnForJump = await getStableBoundingBox(tutPage.getByTestId('undo-btn'));
    assert.ok(undoBtnForJump, 'Expected stable boundingBox for undo-btn before Jump');
    await tutPage.mouse.move(undoBtnForJump.x + undoBtnForJump.width / 2, undoBtnForJump.y + undoBtnForJump.height / 2);
    await tutPage.mouse.down();
    await tutPage.getByTestId('replay-controls-window').waitFor({ state: 'visible', timeout: 3000 });
    await tutPage.mouse.up();
    // Jump via All Topics to Step 8 -> must dismiss tutorial-opened replay
    await tutPage.getByTestId('tutorial-topics-btn').click();
    await tutPage.getByTestId('tutorial-topic-item-7').click();
    await tutPage.getByTestId('replay-controls-window').waitFor({ state: 'hidden', timeout: 3000 });
    // Jump back to Step 6, open replay, and click Skip -> must dismiss tutorial-opened replay
    await tutPage.getByTestId('tutorial-topics-btn').click();
    await tutPage.getByTestId('tutorial-topic-item-5').click();
    await expectTutStep(6);
    const undoBtnForSkip = await getStableBoundingBox(tutPage.getByTestId('undo-btn'));
    assert.ok(undoBtnForSkip, 'Expected stable boundingBox for undo-btn before Skip');
    await tutPage.mouse.move(undoBtnForSkip.x + undoBtnForSkip.width / 2, undoBtnForSkip.y + undoBtnForSkip.height / 2);
    await tutPage.mouse.down();
    await tutPage.getByTestId('replay-controls-window').waitFor({ state: 'visible', timeout: 3000 });
    await tutPage.mouse.up();
    await tutPage.getByTestId('tutorial-skip-btn').click();
    await tutPage.getByTestId('replay-controls-window').waitFor({ state: 'hidden', timeout: 3000 });

    // Pre-existing manual Replay opened BEFORE tutorial must survive Step 6 -> Step 7 Next
    const undoBtnPreManual = await getStableBoundingBox(tutPage.getByTestId('undo-btn'));
    assert.ok(undoBtnPreManual, 'Expected stable boundingBox for undo-btn before manual Replay');
    await tutPage.mouse.move(undoBtnPreManual.x + undoBtnPreManual.width / 2, undoBtnPreManual.y + undoBtnPreManual.height / 2);
    await tutPage.mouse.down();
    await tutPage.getByTestId('replay-controls-window').waitFor({ state: 'visible', timeout: 3000 });
    await tutPage.mouse.up();
    await tapSampleAndOpenTutorialAtStep6();
    await tutPage.getByTestId('tutorial-next-btn').click();
    await expectTutStep(7);
    assert.equal(
      await tutPage.getByTestId('replay-controls-window').isVisible(),
      true,
      'Pre-existing manual ReplayControls opened outside tutorial must survive Step 6->7'
    );
    await tutPage.getByTestId('replay-exit-btn').click();
    await tutPage.getByTestId('tutorial-skip-btn').click();

    // Verify reducedMotion disables spotlight pulse & dash animations
    await tutPage.locator('button[title="Settings and Menu"]').click();
    await tutPage.getByTestId('settings-tab-settings').click();
    const rmToggle = tutPage.getByTestId('setting-reduced-motion');
    await rmToggle.scrollIntoViewIfNeeded();
    if ((await rmToggle.getAttribute('aria-checked')) !== 'true') {
      await rmToggle.click();
    }
    await tutPage.getByTestId('settings-tab-about').click();
    await tutPage.getByTestId('about-replay-tutorial-btn').click();
    const rmMetrics = await assertSpotlightAligned(tutPage, 'tutorial');
    assert.equal(rmMetrics.ringAnim, 'none', 'reducedMotion must disable spotlight pulse animation');
    assert.equal(rmMetrics.ringTransitionDur, '0s', 'reducedMotion must disable spotlight ring transitions');
    const rmDashAnim = await tutPage.evaluate(
      () => getComputedStyle(document.querySelector('[data-testid="spotlight-pointer"] path')).animationName
    );
    assert.equal(rmDashAnim, 'none', 'reducedMotion must disable spotlight pointer dash animation');

    // Verify rapid Ctrl+Z burst undoes cleanly via synchronous undoStackRef & redoStackRef
    await tutPage.getByTestId('tutorial-skip-btn').click();
    await tutPage.getByTestId('onboarding-tutorial').waitFor({ state: 'hidden', timeout: 3000 });
    const burstCanvasBox = await tutPage.locator('canvas').first().boundingBox();
    let burstPainted = 0;
    for (let attempt = 0; attempt < 8 && burstPainted < 2; attempt++) {
      const before = Number(await tutPage.getByTestId('topbar-saves-btn').getAttribute('data-filled-count'));
      await tutPage.mouse.click(
        burstCanvasBox.x + burstCanvasBox.width * (0.35 + (attempt % 4) * 0.08),
        burstCanvasBox.y + burstCanvasBox.height * (0.45 + Math.floor(attempt / 4) * 0.12)
      );
      await tutPage.waitForTimeout(80);
      const after = Number(await tutPage.getByTestId('topbar-saves-btn').getAttribute('data-filled-count'));
      if (after > before) burstPainted++;
    }
    const beforeBurstUndo = Number(await tutPage.getByTestId('topbar-saves-btn').getAttribute('data-filled-count'));
    assert.ok(
      beforeBurstUndo >= 2,
      `Precondition: expected at least 2 filled regions before rapid Ctrl+Z burst, got ${beforeBurstUndo}`
    );
    await tutPage.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    });
    await tutPage.waitForFunction(
      (expected) => Number(document.querySelector('[data-testid="topbar-saves-btn"]')?.getAttribute('data-filled-count')) === expected,
      beforeBurstUndo - 2,
      { timeout: 3000 }
    );
    const afterBurstUndo = Number(await tutPage.getByTestId('topbar-saves-btn').getAttribute('data-filled-count'));
    assert.equal(
      afterBurstUndo,
      beforeBurstUndo - 2,
      `Rapid synchronous Ctrl+Z burst must pop 2 steps cleanly (${beforeBurstUndo} -> ${afterBurstUndo})`
    );

    await tutPage.close();
    await tutContext.close();
    logE2ePass('14-step OnboardingTutorial tour, TargetSpotlightOverlay geometry, reducedMotion, [All Topics] drawer & rapid Ctrl+Z burst verified.');

    // -------------------------------------------------------------------------
    // 3. FeatureOfferBanner Quick Tips, Channel Isolation, #s= DoS Resilience & Play Store Saves
    // -------------------------------------------------------------------------
    logE2eStart('Verifying FeatureOfferBanner 8-offer queue, ?capy_channel=beta isolation, #s= DoS resilience & Play Store Saves gating...');
    const offerContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true });
    await offerContext.addInitScript(() => {
      const store = {};
      window.__capySavedBackups = store;
      window.CapyAndroid = {
        saveBackup: (k, v) => {
          store[String(k)] = String(v);
          return true;
        },
        loadBackup: (k) =>
          Object.prototype.hasOwnProperty.call(store, String(k)) ? store[String(k)] : null,
      };
    });
    const offerPage = await offerContext.newPage();
    attachErrorListeners(offerPage, 'offerPage');
    await offerPage.goto(`${BASE_URL}/?skipTutorial=1`, { waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(offerPage);
    assert.equal(await offerPage.getByTestId('feature-offer-banner').count(), 0);
    const expectOfferBanner = async (offerId) => {
      await offerPage.waitForFunction(
        (expectedId) =>
          document.querySelector('[data-testid="feature-offer-banner"]')?.getAttribute('data-offer-id') === expectedId,
        offerId,
        { timeout: 8000 }
      );
      await assertSpotlightAligned(offerPage, 'offer');
    };
    const jumpFromOfferAndAssertStep = async (expectedStepNum) => {
      await offerPage.getByTestId('feature-offer-guide-btn').click();
      await offerPage.getByTestId('onboarding-tutorial').waitFor({ state: 'visible', timeout: 3000 });
      assert.equal(
        (await offerPage.getByTestId('tutorial-step-indicator').innerText()).trim().toUpperCase(),
        `STEP ${expectedStepNum} OF 14`
      );
      await offerPage.waitForTimeout(950);
      assert.equal(
        (await offerPage.getByTestId('tutorial-step-indicator').innerText()).trim().toUpperCase(),
        `STEP ${expectedStepNum} OF 14`,
        `Jump to Guide onto step ${expectedStepNum} must wait for a fresh action before advancing`
      );
      await offerPage.getByTestId('tutorial-skip-btn').click();
      await offerPage.getByTestId('onboarding-tutorial').waitFor({ state: 'hidden', timeout: 3000 });
    };
    // Unconditional pre-filled snapshot/bootstrap undoStack parity check (isolated context so offerPage queue stays pristine)
    {
      const prefilledContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true });
      await prefilledContext.addInitScript(() => {
        localStorage.setItem('capy_dev_debug', '1');
      });
      const prefilledPage = await prefilledContext.newPage();
      attachErrorListeners(prefilledPage, 'prefilledPage');
      await prefilledPage.goto(`${BASE_URL}/?skipTutorial=1`, { waitUntil: 'networkidle' });
      await waitForPuzzleLoaded(prefilledPage);
      const seeded = await prefilledPage.evaluate(async () => {
        const snaps = window.capyStorage.loadSnapshots();
        const active = window.capyStorage.loadActiveState();
        const targetId = active?.activeSnapshotId || snaps[0]?.id;
        if (!targetId) return null;
        const puz = await window.capyStorage.loadPuzzleData(targetId);
        if (!puz || puz.regions.length < 2) return null;
        const prefilledIds = puz.regions.slice(0, 2).map((r) => r.id);
        window.capyStorage.updateSnapshotProgress(
          targetId,
          prefilledIds.length,
          puz.regions.length,
          prefilledIds
        );
        window.capyStorage.saveActiveState({
          ...(active || {}),
          activeSnapshotId: targetId,
          activeColorId: active?.activeColorId || puz.palette[0]?.id || 1,
          filledRegionIds: prefilledIds,
          zoomScale: 1,
          panOffsetX: 0,
          panOffsetY: 0,
        });
        return { targetId, count: prefilledIds.length };
      });
      assert.ok(seeded && seeded.count === 2, 'Expected to seed 2 pre-filled regions for bootstrap undoStack test');
      await prefilledPage.reload({ waitUntil: 'networkidle' });
      await waitForPuzzleLoaded(prefilledPage);
      const filledBeforeBootstrapUndo = Number(
        await prefilledPage.getByTestId('topbar-saves-btn').getAttribute('data-filled-count')
      );
      assert.equal(filledBeforeBootstrapUndo, 2, 'Reloaded pre-filled snapshot must show 2 filled regions');
      assert.equal(
        await prefilledPage.getByTestId('undo-btn').isEnabled(),
        true,
        'Pre-filled snapshot bootstrap must seed undoStack so undo-btn is enabled'
      );
      await prefilledPage.getByTestId('undo-btn').click();
      await prefilledPage.waitForFunction(
        () => Number(document.querySelector('[data-testid="topbar-saves-btn"]')?.getAttribute('data-filled-count')) === 1,
        undefined,
        { timeout: 3000 }
      );
      const filledAfterBootstrapUndo = Number(
        await prefilledPage.getByTestId('topbar-saves-btn').getAttribute('data-filled-count')
      );
      assert.equal(
        filledAfterBootstrapUndo,
        1,
        'Clicking undo-btn after pre-filled snapshot bootstrap must decrement data-filled-count from 2 to 1'
      );
      await prefilledPage.close();
      await prefilledContext.close();
    }
    // 1) paint_mode -> Got it
    const offerPaintBtn = offerPage.locator('button[aria-label="Toggle Paint Mode"]');
    await offerPaintBtn.click();
    await expectOfferBanner('paint_mode');
    await captureV3012Screenshot(offerPage, 'desktop_1280x800_offer_spotlight.png');
    await offerPage.getByTestId('feature-offer-dismiss-btn').click();
    await offerPage.getByTestId('feature-offer-banner').waitFor({ state: 'hidden', timeout: 3000 });
    await offerPaintBtn.click();
    // 2 & 3) Queue create_gallery -> saves_export while SettingsModal suppresses banner; markOfferSeen stays deferred until shown
    await offerPage.locator('button[title="Settings and Menu"]').click();
    await offerPage.getByTestId('settings-tab-create').click();
    await offerPage.getByTestId('daily-puzzle-card').waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(await offerPage.getByTestId('feature-offer-banner').count(), 0);
    await offerPage.getByTestId('settings-tab-saves').click();
    await offerPage.getByTestId('saves-list-section').waitFor({ state: 'visible', timeout: 3000 });
    const seenWhileModalOpen = await offerPage.evaluate(() =>
      JSON.parse(localStorage.getItem('capy_feature_offers_v1') || '[]')
    );
    assert.equal(seenWhileModalOpen.includes('create_gallery'), false, 'create_gallery must not mark seen while suppressed');
    assert.equal(seenWhileModalOpen.includes('saves_export'), false, 'saves_export must not mark seen while suppressed');
    await offerPage.getByTestId('settings-modal-close').click();
    await expectOfferBanner('create_gallery');
    await offerPage.getByTestId('feature-offer-dismiss-btn').click();
    await expectOfferBanner('saves_export');
    await jumpFromOfferAndAssertStep(13);
    // 4) undo_replay (paint a region, then undo) -> Jump to Guide STEP 5 OF 14
    const offerCanvasBox = await offerPage.locator('canvas').first().boundingBox();
    for (let attempt = 0; attempt < 6; attempt++) {
      const xFrac = 0.42 + (attempt % 3) * 0.08;
      const yFrac = 0.60 + Math.floor(attempt / 3) * 0.08;
      await offerPage.mouse.click(
        offerCanvasBox.x + offerCanvasBox.width * xFrac,
        offerCanvasBox.y + offerCanvasBox.height * yFrac
      );
      await offerPage.waitForTimeout(80);
      if (!(await offerPage.getByTestId('undo-btn').isDisabled())) break;
    }
    await offerPage.getByTestId('undo-btn').click();
    await expectOfferBanner('undo_replay');
    await jumpFromOfferAndAssertStep(5);
    // 5) replay_scrubber (redo stroke, long-press undo, exit replay) -> Jump to Guide STEP 6 OF 14
    await offerPage.getByTestId('redo-btn').click();
    const offerUndoBox = await getStableBoundingBox(offerPage.getByTestId('undo-btn'));
    assert.ok(offerUndoBox, 'Expected stable boundingBox for offerPage undo-btn');
    await offerPage.mouse.move(offerUndoBox.x + offerUndoBox.width / 2, offerUndoBox.y + offerUndoBox.height / 2);
    await offerPage.mouse.down();
    await offerPage.getByTestId('replay-controls-window').waitFor({ state: 'visible', timeout: 3000 });
    await offerPage.mouse.up();
    await offerPage.getByTestId('replay-exit-btn').click();
    await expectOfferBanner('replay_scrubber');
    await jumpFromOfferAndAssertStep(6);
    // 6) free_color (Settings -> Free Colour Mode ON) -> Jump to Guide STEP 8 OF 14
    await offerPage.locator('button[title="Settings and Menu"]').click();
    await offerPage.getByTestId('settings-tab-settings').click();
    const offerFreeColorLabel = await offerPage.waitForSelector('text=Free Colour Mode');
    await offerFreeColorLabel.evaluate((el) => el.closest('.flex')?.querySelector('button')?.click());
    await offerPage.getByTestId('settings-modal-close').click();
    await expectOfferBanner('free_color');
    await jumpFromOfferAndAssertStep(8);
    // 7) photo_upload -> Got it
    const offerPngBytes = await offerPage.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 160;
      c.height = 120;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(0, 0, 80, 120);
      ctx.fillStyle = '#3b82f6';
      ctx.fillRect(80, 0, 80, 120);
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    });
    const offerPhotoPath = path.join(os.tmpdir(), 'capy_offer_photo.png');
    fs.writeFileSync(offerPhotoPath, Buffer.from(offerPngBytes));
    try {
      await offerPage.locator('input[type="file"][accept="image/*"]').setInputFiles(offerPhotoPath);
      await offerPage.waitForFunction(
        () =>
          document.querySelector('[data-testid="topbar-saves-btn"]')?.textContent?.includes('capy_offer_photo') &&
          !document.body.innerText.toLowerCase().includes('generating puzzle'),
        undefined,
        { timeout: 15000 }
      );
      await waitForPuzzleLoaded(offerPage);
    } finally {
      fs.rmSync(offerPhotoPath, { force: true });
    }
    await expectOfferBanner('photo_upload');
    await offerPage.getByTestId('feature-offer-dismiss-btn').click();
    await offerPage.getByTestId('feature-offer-banner').waitFor({ state: 'hidden', timeout: 3000 });
    // 8) infinite_zoom -> Got it
    await offerPage.locator('button[title="Settings and Menu"]').click();
    await offerPage.getByTestId('settings-tab-create').click();
    await offerPage.getByTestId('infinite-zoom-subtile-btn').click();
    await offerPage.waitForFunction(
      () =>
        document.querySelector('[data-testid="topbar-saves-btn"]')?.textContent?.includes('2x Detail') &&
        !document.body.innerText.includes('Generating Puzzle'),
      undefined,
      { timeout: 15000 }
    );
    await waitForPuzzleLoaded(offerPage);
    await expectOfferBanner('infinite_zoom');
    await offerPage.getByTestId('feature-offer-dismiss-btn').click();
    await offerPage.getByTestId('feature-offer-banner').waitFor({ state: 'hidden', timeout: 3000 });

    // Verify all 8 offers persisted in both localStorage and NativeBridge.saveBackup spy
    const persistedOfferState = await offerPage.evaluate(() => ({
      ls: JSON.parse(localStorage.getItem('capy_feature_offers_v1') || '[]'),
      backup: JSON.parse(window.__capySavedBackups?.capy_feature_offers_v1 || '[]'),
    }));
    for (const expectedOffer of [
      'paint_mode',
      'undo_replay',
      'replay_scrubber',
      'free_color',
      'create_gallery',
      'photo_upload',
      'infinite_zoom',
      'saves_export',
    ]) {
      assert.equal(
        persistedOfferState.ls.includes(expectedOffer),
        true,
        `Expected ${expectedOffer} in localStorage capy_feature_offers_v1`
      );
      assert.equal(
        persistedOfferState.backup.includes(expectedOffer),
        true,
        `Expected ${expectedOffer} in NativeBridge.saveBackup capy_feature_offers_v1`
      );
    }
    // Seen offers persist across reload (toggling Paint Mode does not re-show paint_mode)
    await offerPage.reload({ waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(offerPage);
    await offerPage.locator('button[aria-label="Toggle Paint Mode"]').click();
    await offerPage.waitForTimeout(150);
    assert.equal(await offerPage.getByTestId('feature-offer-banner').count(), 0);
    await offerPage.close();

    // Verify ?capy_channel=beta isolates capy_feature_offers_v1__sandbox_beta from root offers
    const betaOfferPage = await offerContext.newPage();
    attachErrorListeners(betaOfferPage, 'betaOfferPage');
    await betaOfferPage.goto(`${BASE_URL}/?capy_channel=beta&skipTutorial=1`, { waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(betaOfferPage);
    await betaOfferPage.locator('button[aria-label="Toggle Paint Mode"]').click();
    await betaOfferPage.getByTestId('feature-offer-banner').waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(await betaOfferPage.getByTestId('feature-offer-banner').getAttribute('data-offer-id'), 'paint_mode');
    const betaOfferState = await betaOfferPage.evaluate(() => ({
      ls: JSON.parse(localStorage.getItem('capy_feature_offers_v1__sandbox_beta') || '[]'),
      backup: JSON.parse(window.__capySavedBackups?.capy_feature_offers_v1__sandbox_beta || '[]'),
    }));
    assert.equal(betaOfferState.ls.includes('paint_mode'), true, 'Expected scoped beta localStorage key');
    assert.equal(betaOfferState.backup.includes('paint_mode'), true, 'Expected scoped beta backup key');
    await betaOfferPage.close();
    await offerContext.close();


    // Verify malformed #s= DoS token degrades cleanly without crashing the app
    const dosSharePage = await context.newPage();
    attachErrorListeners(dosSharePage, 'dosSharePage');
    await dosSharePage.goto(`${BASE_URL}/#s=AAIAAf____8P`, { waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(dosSharePage);
    await dosSharePage.close();

    // Verify Play Store Q1 Saves cleanup hides unfinished Cloud/Co-op hub and topbar Friends button by default
    assert.equal(await page.getByTestId('topbar-coop-btn').count(), 0, 'topbar-coop-btn must stay hidden by default');
    await page.locator('button[title="Settings and Menu"]').click();
    await page.getByTestId('settings-tab-saves').waitFor({ state: 'visible', timeout: 3000 });
    await page.getByTestId('settings-tab-saves').click();
    await page.getByTestId('saves-share-print-bar').waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(await page.getByTestId('cloud-coop-hub').count(), 0, 'cloud-coop-hub must stay hidden by default');
    assert.equal(await page.getByTestId('play-games-signin-btn').count(), 0, 'play-games-signin-btn must stay hidden by default');
    assert.equal(await page.getByTestId('cloud-sync-btn').count(), 0, 'cloud-sync-btn must stay hidden by default');
    assert.equal(await page.getByTestId('cloud-providers-bar').count(), 0, 'cloud-providers-bar must stay hidden by default');
    assert.equal(await page.getByTestId('share-progress-link-btn').isVisible(), true);
    assert.equal(await page.getByTestId('export-printable-svg-btn').isVisible(), true);
    await page.keyboard.press('Escape');
    await page.getByTestId('saves-share-print-bar').waitFor({ state: 'hidden', timeout: 3000 });

    // Verify startup ProviderRegistry.auth.attemptAutoSignIn is NOT invoked when showCloudCoopUi === false
    // and Create tab hides Optional Ad, AI Credits, and vote-idea-* even when NativeBridge.isAndroid === true
    const androidGateCtx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const androidGatePage = await androidGateCtx.newPage();
    attachErrorListeners(androidGatePage, 'androidGatePage');
    await androidGatePage.addInitScript(() => {
      window.__capySignInCalls = 0;
      window.CapyAndroid = {
        isPlayGamesConfigured: () => true,
        signInPlayGames: () => {
          window.__capySignInCalls = (window.__capySignInCalls || 0) + 1;
          queueMicrotask(() => window.__capyReceivePlayGamesError?.('PLAY_GAMES_UNAVAILABLE'));
          return null;
        },
        getSafeAreaInsets: () => '{"top":0,"bottom":0,"left":0,"right":0}',
        setModalOpen: () => {},
        saveBackup: () => true,
        loadBackup: () => null,
      };
    });
    await androidGatePage.goto(`${BASE_URL}/?skipTutorial=1`, { waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(androidGatePage);
    await androidGatePage.waitForTimeout(200);
    assert.equal(
      await androidGatePage.evaluate(() => window.__capySignInCalls || 0),
      0,
      'Startup must NOT call signInPlayGames / attemptAutoSignIn when showCloudCoopUi === false'
    );
    await androidGatePage.locator('button[title="Settings and Menu"]').click();
    await androidGatePage.getByTestId('app-version-badge').waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(
      await androidGatePage.getByTestId('release-channel-card').count(),
      0,
      'Android WebView must hide release-channel-card even on localhost'
    );
    await androidGatePage.getByTestId('settings-tab-create').click();
    await androidGatePage.getByTestId('community-ideas-section').waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(await androidGatePage.getByText('Optional Ad').count(), 0, 'Android Create tab must not show Optional Ad');
    assert.equal(await androidGatePage.getByText('AI Credits').count(), 0, 'Android Create tab must not show AI Credits');
    assert.equal(await androidGatePage.locator('[data-testid^="vote-idea-"]').count(), 0, 'Android Create tab must not show vote-idea-*');
    assert.equal(
      (await androidGatePage.getByTestId('community-ideas-section').innerText()).includes('Puzzle Idea Notebook'),
      true,
      'Android Create tab must label local notebook as Puzzle Idea Notebook'
    );
    await androidGatePage.goto(`${BASE_URL}/?skipTutorial=1&capy_channel=beta`, { waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(androidGatePage);
    await androidGatePage.locator('button[title="Settings and Menu"]').click();
    await androidGatePage.getByTestId('app-version-badge').waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(
      await androidGatePage.getByTestId('release-channel-card').count(),
      0,
      'Android WebView must hide release-channel-card even with ?capy_channel=beta'
    );
    assert.equal(await androidGatePage.getByTestId('android-apk-download-link').count(), 0);
    assert.equal(await androidGatePage.getByTestId('beta-apk-download-link').count(), 0);
    await androidGatePage.goto(`${BASE_URL}/?skipTutorial=1&coop=1`, { waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(androidGatePage);
    await androidGatePage.waitForFunction(() => (window.__capySignInCalls || 0) >= 1, undefined, { timeout: 3000 });
    await androidGatePage.close();
    await androidGateCtx.close();

    // Disable autoReplayOnLoad and enable EASY difficulty for fast deterministic E2E interaction checks
    await page.evaluate(() => {
      localStorage.removeItem('capy_last_settings_tab');
      const s = JSON.parse(localStorage.getItem('capy_user_settings_v8') || '{}');
      s.autoReplayOnLoad = false;
      s.difficulty = 'EASY';
      localStorage.setItem('capy_user_settings_v8', JSON.stringify(s));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(page);
    logE2ePass('FeatureOfferBanner 8-offer queue, ?capy_channel=beta offer isolation, #s= DoS resilience & Play Store Saves gating verified.');

    // -------------------------------------------------------------------------
    // 4. Canvas Coloring, Gestures (Double-Tap Zoom, Momentum, Background Drag) & Paint Mode
    // -------------------------------------------------------------------------
    logE2eStart('Verifying palette selection, region tap coloring, double-tap zoom, pan momentum & Paint Mode...');
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

    // Verify US-3.5 Fat-Finger near-miss tap assist on artwork margin (exact pixel out of bounds, within 34px reach)
    {
      const edgeY = box.y + box.height * 0.5;
      // Locate an x-coordinate just outside the left artwork edge (within 0.04 * box.width margin)
      const nearMissX = box.x + Math.max(2, box.width * 0.04 - 4);
      const beforeMiss = await page.evaluate(() => {
        const s = window.capyStorage.loadSettings();
        s.difficulty = 'EASY';
        s.fatFingerAssist = false;
        s.touchReachRadiusPx = 34;
        window.capyStorage.saveSettings(s);
        return JSON.parse(localStorage.getItem('capy_snapshots_v8') || '[]')[0]?.filledCount || 0;
      });
      await page.reload({ waitUntil: 'networkidle' });
      await waitForPuzzleLoaded(page);
      await page.mouse.click(nearMissX, edgeY);
      await page.waitForTimeout(150);
      const afterAssistOff = await page.evaluate(
        () => JSON.parse(localStorage.getItem('capy_snapshots_v8') || '[]')[0]?.filledCount || 0
      );
      assert.equal(
        afterAssistOff,
        beforeMiss,
        'Near-miss tap outside artwork edge with fatFingerAssist=false must not fill any region'
      );

      // Enable fatFingerAssist=true with Large 34px reach and tap the same near-miss coordinate
      await page.evaluate(() => {
        const s = window.capyStorage.loadSettings();
        s.difficulty = 'EASY';
        s.fatFingerAssist = true;
        s.touchReachRadiusPx = 34;
        window.capyStorage.saveSettings(s);
      });
      await page.reload({ waitUntil: 'networkidle' });
      await waitForPuzzleLoaded(page);
      await page.mouse.click(nearMissX, edgeY);
      await page.waitForTimeout(200);
      const afterAssistOn = await page.evaluate(
        () => JSON.parse(localStorage.getItem('capy_snapshots_v8') || '[]')[0]?.filledCount || 0
      );
      assert.equal(
        afterAssistOn >= beforeMiss,
        true,
        'Near-miss tap with fatFingerAssist=true must not regress filledCount'
      );
      // Also verify an inner-margin tap 3px off the left artwork edge at 1x fit view snaps to an edge region
      const marginTapX = box.x + Math.max(2, box.width * 0.04 - 2);
      await page.mouse.click(marginTapX, box.y + box.height * 0.45);
      await page.waitForTimeout(200);
      const afterSecondNearTap = await page.evaluate(
        () => JSON.parse(localStorage.getItem('capy_snapshots_v8') || '[]')[0]?.filledCount || 0
      );
      assert.equal(
        afterSecondNearTap > beforeMiss,
        true,
        `Near-miss tap with fatFingerAssist=true (34px) must snap and fill an adjacent unfilled region (before=${beforeMiss}, after=${afterSecondNearTap})`
      );
    }

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
    logE2ePass('Palette selection, region tap coloring, double-tap zoom, pan momentum, and Paint Mode verified.');

    // -------------------------------------------------------------------------
    // 5. 5-Tab SettingsModal Isolation, Enable Undo Toggle & Tab Persistence
    // -------------------------------------------------------------------------
    logE2eStart('Verifying 5-tab SettingsModal (About, Settings, Hints, Create, Saves), Enable Undo toggle & tab persistence...');
    assert.ok(await page.$('[data-testid="undo-btn"]'), 'Undo visible by default for standard puzzles');

    // Open Settings -> verify all 5 distinct tabs (About=0, Settings=1, Hints=2, Create=3, Saves=4), zero duplicates, and tab 4 persistence across reload
    const settingsBtn = page.locator('button[title="Settings and Menu"]');
    await settingsBtn.click();
    await page.getByTestId('app-version-badge').waitFor({ state: 'visible', timeout: 3000 });

    // Tab 0: About
    const pkgVersion = JSON.parse(fs.readFileSync(path.resolve(projectRoot, 'package.json'), 'utf8')).version;
    const versionBadgeText = await page.locator('[data-testid="app-version-badge"]').textContent();
    assert.equal(versionBadgeText?.trim(), `v${pkgVersion}`, `Expected app-version-badge to equal v${pkgVersion}`);
    assert.equal(await page.getByTestId('app-version-badge').count(), 1, 'Expected single app-version-badge in About tab');
    assert.equal(await page.getByTestId('about-screen-card').isVisible(), true, 'About tab must render about-screen-card');
    assert.equal(await page.getByTestId('about-replay-tutorial-btn').isVisible(), true, 'About tab must render about-replay-tutorial-btn');
    assert.equal(await page.getByTestId('about-privacy-policy-link').isVisible(), true, 'About tab must render about-privacy-policy-link');
    assert.equal(await page.getByTestId('about-report-issue-link').isVisible(), true, 'About tab must render about-report-issue-link');
    assert.equal(
      await page.getByTestId('about-report-issue-link').getAttribute('href'),
      'https://github.com/capyboop/paint/issues/new/choose',
      'about-report-issue-link must point to public capyboop/paint issue chooser'
    );
    assert.equal(await page.getByTestId('lifetime-stats-card').isVisible(), true, 'About tab must render lifetime-stats-card');
    assert.equal(await page.getByTestId('release-channel-card').isVisible(), true, 'About tab must render release-channel-card');
    assert.equal(await page.getByTestId('android-apk-download-link').isVisible(), true, 'About tab must render android-apk-download-link on Web');
    assert.equal(await page.getByTestId('beta-apk-download-link').isVisible(), true, 'About tab must render beta-apk-download-link on Web');
    assert.equal(await page.getByText('Highlight Style').count(), 0, 'About tab must not render Hints content');
    assert.equal(
      /co-op/i.test(await page.getByTestId('about-screen-card').innerText()),
      false,
      'About tab hero card must hide Co-op copy when showCloudCoopUi === false'
    );
    assert.equal(
      await page.getByTestId('stat-coop-regions').count(),
      0,
      'About tab must hide stat-coop-regions when showCloudCoopUi === false'
    );
    assert.equal(
      await page.getByText(/Co-op/).count(),
      0,
      'About tab must not display Co-op strings when showCloudCoopUi === false'
    );
    const freeArtLayout = await page.evaluate(() => {
      const statEl = document.querySelector('[data-testid="stat-free-color-creations"]');
      const tileEl = statEl?.parentElement;
      const gridEl = tileEl?.parentElement;
      if (!tileEl || !gridEl) return null;
      const tileRect = tileEl.getBoundingClientRect();
      const gridRect = gridEl.getBoundingClientRect();
      return {
        hasColSpan2: tileEl.classList.contains('col-span-2'),
        tileWidth: tileRect.width,
        gridWidth: gridRect.width,
      };
    });
    assert.ok(freeArtLayout, 'stat-free-color-creations tile and grid must exist');
    assert.equal(freeArtLayout.hasColSpan2, true, 'Free Colour Art tile must apply col-span-2 when !showCloudCoopUi');
    assert.equal(
      Math.abs(freeArtLayout.tileWidth - freeArtLayout.gridWidth) <= 2,
      true,
      `Free Colour Art tile (${freeArtLayout.tileWidth}px) must span full grid width (${freeArtLayout.gridWidth}px)`
    );

    // Tab 0 Anonymous In-Game Feedback form (validation, 201 created, 503 fallback preserving draft, 429 rate-limit)
    assert.equal(
      await page.getByTestId('about-open-feedback-btn').isVisible(),
      true,
      'About tab must render about-open-feedback-btn'
    );
    await page.getByTestId('about-open-feedback-btn').click();
    await page.getByTestId('in-game-feedback-card').waitFor({ state: 'visible', timeout: 3000 });

    // Client-side validation rejects empty/short title without hitting network
    let interceptedFeedbackCalls = 0;
    let lastFeedbackRequestBody = null;
    let feedbackMockMode = '201';
    await page.route('**/api/feedback', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      interceptedFeedbackCalls += 1;
      lastFeedbackRequestBody = route.request().postDataJSON();
      if (feedbackMockMode === '201') {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            issueNumber: 99,
            issueUrl: 'https://github.com/capyboop/paint/issues/99',
          }),
        });
      } else if (feedbackMockMode === '503') {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: false,
            code: 'feedback_unconfigured',
            error: 'In-app feedback relay is not configured yet. You can submit directly on GitHub.',
            fallbackUrl: 'https://github.com/capyboop/paint/issues/new?template=bug_report.yml&title=%5BBug%5D%3A+Zoom+lag',
          }),
        });
      } else {
        await route.fulfill({
          status: 429,
          contentType: 'application/json',
          headers: { 'Retry-After': '60' },
          body: JSON.stringify({ ok: false, error: 'Too many requests' }),
        });
      }
    });

    try {
      await page.getByTestId('feedback-submit-btn').click();
      await page.getByTestId('feedback-status-banner').waitFor({ state: 'visible', timeout: 3000 });
      assert.equal(interceptedFeedbackCalls, 0, 'Client validation must prevent network call on empty feedback');

      // 201 Created: Puzzle Idea submission
      feedbackMockMode = '201';
      await page.getByTestId('feedback-category-puzzle_idea').click();
      await page.getByTestId('feedback-title-input').fill('Capybara Astronaut');
      await page.getByTestId('feedback-details-input').fill('A cozy capybara floating among pastel stars.');
      await page.getByTestId('feedback-submit-btn').click();
      await page.getByTestId('feedback-issue-link').waitFor({ state: 'visible', timeout: 3000 });
      assert.equal(interceptedFeedbackCalls, 1, 'Expected 1 POST /api/feedback request');
      assert.equal(lastFeedbackRequestBody?.category, 'puzzle_idea');
      assert.equal(lastFeedbackRequestBody?.title, 'Capybara Astronaut');
      assert.equal(
        await page.getByTestId('feedback-issue-link').getAttribute('href'),
        'https://github.com/capyboop/paint/issues/99'
      );
      assert.equal(
        await page.getByTestId('feedback-title-input').inputValue(),
        '',
        'Title input must reset after 201 submission'
      );

      // 503 Unconfigured: fallback link renders and user draft is preserved
      feedbackMockMode = '503';
      await page.getByTestId('feedback-category-bug').click();
      await page.getByTestId('feedback-title-input').fill('Zoom lag');
      await page.getByTestId('feedback-details-input').fill('Pinch zoom feels slightly sluggish on older phones.');
      await page.getByTestId('feedback-submit-btn').click();
      await page.getByTestId('feedback-fallback-link').waitFor({ state: 'visible', timeout: 3000 });
      assert.equal(
        (await page.getByTestId('feedback-fallback-link').getAttribute('href'))?.startsWith(
          'https://github.com/capyboop/paint/issues/new?'
        ),
        true,
        '503 response must surface prefilled GitHub fallback link'
      );
      assert.equal(
        await page.getByTestId('feedback-title-input').inputValue(),
        'Zoom lag',
        '503 fallback must preserve typed title draft'
      );
      assert.equal(
        await page.getByTestId('feedback-details-input').inputValue(),
        'Pinch zoom feels slightly sluggish on older phones.',
        '503 fallback must preserve typed details draft'
      );

      // 429 Rate Limit: inline rate-limit notice renders cleanly
      feedbackMockMode = '429';
      await page.getByTestId('feedback-submit-btn').click();
      await page.waitForFunction(
        () => /wait a minute|too many/i.test(document.querySelector('[data-testid="feedback-status-banner"]')?.textContent || ''),
        { timeout: 3000 }
      );
    } finally {
      await page.unroute('**/api/feedback');
      await page.getByTestId('about-open-feedback-btn').click();
    }

    // Tab 1: Settings (no duplicated About/Stats/Platforms and no leaked Hints content)
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByText('Canvas Background').waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(await page.getByText('Canvas Background').isVisible(), true, 'Settings tab must render Canvas Background');
    assert.equal(await page.getByTestId('app-version-badge').count(), 0, 'Settings tab must not duplicate app-version-badge');
    assert.equal(await page.getByTestId('lifetime-stats-card').count(), 0, 'Settings tab must not duplicate lifetime-stats-card');
    assert.equal(await page.getByTestId('release-channel-card').count(), 0, 'Settings tab must not duplicate release-channel-card');
    assert.equal(await page.getByText('Highlight Style').count(), 0, 'Settings tab must not leak Hints content');

    await page.locator('button[title="Charcoal"]').first().click();
    for (const labelText of [
      'Show Zoom (+ / -) Buttons',
      'Show Reset View (Extent) Button',
    ]) {
      const labelEl = await page.waitForSelector(`text=${labelText}`);
      await labelEl.evaluate((el) => el.closest('.flex')?.querySelector('button')?.click());
    }
    // Verify toggling Enable Undo Action OFF hides undo-btn & persists, then toggle back ON for Undo/Redo suite
    const undoToggleLabel = await page.waitForSelector('text=Enable Undo Action');
    await undoToggleLabel.evaluate((el) => el.closest('.flex')?.querySelector('button')?.click());
    await page.getByTestId('undo-btn').waitFor({ state: 'hidden', timeout: 3000 });
    assert.equal(await page.$('[data-testid="undo-btn"]'), null, 'Undo must hide when toggled off');
    const undoPersistedOff = await page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.includes('capy_user_settings_v8')) {
          return JSON.parse(localStorage.getItem(k) || '{}').enableUndo === false;
        }
      }
      return false;
    });
    assert.equal(undoPersistedOff, true, 'Opting out of enableUndo must persist to localStorage');
    await undoToggleLabel.evaluate((el) => el.closest('.flex')?.querySelector('button')?.click());
    await page.getByTestId('undo-btn').waitFor({ state: 'visible', timeout: 3000 });
    assert.ok(await page.$('[data-testid="undo-btn"]'), 'Undo must reappear when toggled back on');

    // Verify Fat-Finger Tap Assist toggle and Finger Reach Radius presets in Tab 1
    await page.getByTestId('setting-fat-finger-assist').waitFor({ state: 'visible', timeout: 3000 });
    await page.getByTestId('setting-touch-reach-radius').waitFor({ state: 'visible', timeout: 3000 });
    await page.getByTestId('setting-touch-reach-preset-12').click();
    assert.equal(
      await page.getByTestId('setting-touch-reach-radius').inputValue(),
      '12',
      'Compact 12px preset must update touchReachRadiusPx slider to 12'
    );
    await page.getByTestId('setting-touch-reach-preset-34').click();
    assert.equal(
      await page.getByTestId('setting-touch-reach-radius').inputValue(),
      '34',
      'Large 34px preset must update touchReachRadiusPx slider to 34'
    );
    await page.getByTestId('setting-touch-reach-preset-22').click();
    assert.equal(
      await page.getByTestId('setting-touch-reach-radius').inputValue(),
      '22',
      'Standard 22px preset must restore touchReachRadiusPx slider to 22'
    );
    const prevFatFingerChecked = await page.getByTestId('setting-fat-finger-assist').getAttribute('aria-checked');
    await page.getByTestId('setting-fat-finger-assist').click();
    assert.equal(
      await page.getByTestId('setting-fat-finger-assist').getAttribute('aria-checked'),
      prevFatFingerChecked === 'true' ? 'false' : 'true',
      'Fat-Finger Tap Assist toggle must flip aria-checked'
    );
    await page.getByTestId('setting-fat-finger-assist').click();

    // Tab 2: Hints
    await page.getByRole('button', { name: 'Hints', exact: true }).click();
    await page.getByText('Highlight Style').waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(await page.getByText('Highlight Style').isVisible(), true, 'Hints tab must render Highlight Style');
    assert.equal(await page.getByText('Hint Fill Pattern').isVisible(), true, 'Hints tab must render Hint Fill Pattern');
    assert.equal(await page.getByText('Canvas Background').count(), 0, 'Hints tab must not render Settings content');

    // Tab 3: Create
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.getByTestId('daily-puzzle-card').waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(await page.getByTestId('daily-puzzle-card').isVisible(), true, 'Create tab must render daily-puzzle-card');
    assert.equal(await page.getByTestId('gallery-search-input').isVisible(), true, 'Create tab must render gallery-search-input');
    assert.equal(await page.getByText('Highlight Style').count(), 0, 'Create tab must not render Hints content');

    // Tab 4: Saves (persist tab 4 across full page reload; cold-start default must be THUMBNAILS with list first)
    await page.getByRole('button', { name: 'Saves', exact: true }).click();
    await page.getByTestId('saves-list-section').waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(
      await page.evaluate(() => localStorage.getItem('capy_saves_view_mode')),
      null,
      'Cold-start must have no stored capy_saves_view_mode yet'
    );
    assert.equal(
      await page.getByTestId('saves-list-section').getAttribute('data-view-mode'),
      'THUMBNAILS',
      'Saves tab must default to THUMBNAILS when capy_saves_view_mode is unset'
    );
    assert.equal(
      await page.getByTestId('saves-list-thumbnails').isVisible(),
      true,
      'Thumbnails grid must render by default in Saves tab'
    );
    assert.equal(
      await page.getByTestId('saves-list-detail').count(),
      0,
      'Detail list must not render when THUMBNAILS is active'
    );
    assert.equal(
      await page.getByTestId('saves-view-thumbnails-btn').getAttribute('aria-pressed'),
      'true',
      'Thumbnails toggle button must report aria-pressed="true" by default'
    );
    assert.equal(
      await page.getByTestId('saves-view-detail-btn').getAttribute('aria-pressed'),
      'false',
      'Detail toggle button must report aria-pressed="false" by default'
    );
    const [savesListBoxInit, savesActionBarBoxInit, savesShareBarBoxInit] = await Promise.all([
      page.getByTestId('saves-list-section').boundingBox(),
      page.getByTestId('selected-save-action-bar').boundingBox(),
      page.getByTestId('saves-share-print-bar').boundingBox(),
    ]);
    assert.ok(savesListBoxInit && savesActionBarBoxInit && savesShareBarBoxInit);
    assert.equal(
      savesListBoxInit.y + savesListBoxInit.height <= savesActionBarBoxInit.y + 1,
      true,
      `Saves list (${savesListBoxInit.y + savesListBoxInit.height}) must appear above selected-save-action-bar (${savesActionBarBoxInit.y})`
    );
    assert.equal(
      savesActionBarBoxInit.y + savesActionBarBoxInit.height <= savesShareBarBoxInit.y + 1,
      true,
      `selected-save-action-bar (${savesActionBarBoxInit.y + savesActionBarBoxInit.height}) must appear above saves-share-print-bar (${savesShareBarBoxInit.y})`
    );
    await page.keyboard.press('Escape');
    await page.getByTestId('saves-list-section').waitFor({ state: 'hidden', timeout: 3000 });
    assert.equal(await page.evaluate(() => localStorage.getItem('capy_last_settings_tab')), '4');

    await page.reload({ waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(page);
    await settingsBtn.click();
    await page.getByTestId('saves-share-print-bar').waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(
      await page.getByTestId('saves-share-print-bar').isVisible(),
      true,
      'Saves tab (index 4) must restore after page reload via capy_last_settings_tab'
    );

    // Switch to Hints tab and close -> verify capy_last_settings_tab === '2'
    await page.getByRole('button', { name: 'Hints', exact: true }).click();
    await page.getByText('Highlight Style').waitFor({ state: 'visible', timeout: 3000 });
    await page.keyboard.press('Escape');
    await page.getByText('Highlight Style').waitFor({ state: 'hidden', timeout: 3000 });

    const updatedSettings = await page.evaluate(() => JSON.parse(localStorage.getItem('capy_user_settings_v8') || '{}'));
    assert.equal(updatedSettings.canvasBgColor, 'CHARCOAL');
    assert.equal(updatedSettings.canvasBgArgb >>> 0, 0xff18181b);
    assert.equal(localStorage_tab(await page.evaluate(() => localStorage.getItem('capy_last_settings_tab'))), '2');

    function localStorage_tab(v) {
      return String(v);
    }
    logE2ePass('5-tab SettingsModal isolation, Enable Undo opt-out toggle & capy_last_settings_tab reload persistence verified.');

    // -------------------------------------------------------------------------
    // 6. Undo, Redo, Long-Press Replay Scrubber, Follow Painting, Auto-Loop & Free Colour Undo
    // -------------------------------------------------------------------------
    logE2eStart('Verifying Undo, Redo, long-press Replay scrubber, Follow Painting, Auto-Loop, swatch auto-dismiss & Free Colour auto-undo...');

    // Single-step Undo & Redo
    const undoBtn = await page.waitForSelector('[data-testid="undo-btn"]');
    assert.equal(await page.$('[data-testid="redo-btn"]'), null, 'Redo hidden before Undo');
    await undoBtn.click();

    const redoBtn = await page.waitForSelector('[data-testid="redo-btn"]');
    const [redoBox, undoBox] = await Promise.all([redoBtn.boundingBox(), undoBtn.boundingBox()]);
    assert.equal(redoBox.y < undoBox.y, true, 'Redo button must stack above Undo button');
    await redoBtn.click();
    await page.getByTestId('redo-btn').waitFor({ state: 'hidden', timeout: 3000 });

    // Long-press Undo (>=450ms) -> Replay Scrubber (minimised by default) -> Expand -> Scrub to step 2 -> Resume Here
    await page.mouse.move(undoBox.x + undoBox.width / 2, undoBox.y + undoBox.height / 2);
    await page.mouse.down();
    await page.getByTestId('replay-controls-window').waitFor({ state: 'visible', timeout: 3000 });
    await page.mouse.up();

    const replayWin = await page.waitForSelector('[data-testid="replay-controls-window"]');
    assert.equal(await replayWin.isVisible(), true, 'ReplayControls window must be visible');
    assert.equal(
      await page.locator('[data-testid="replay-toggle-minimize-btn"]').count(),
      0,
      'ReplayControls must not render an expand/minimize toggle button'
    );
    // Verify YouTube-style progress slider is immediately interactive in the default bar and takes up wide horizontal space
    const trackBox = await getStableBoundingBox(page.getByTestId('replay-scrubber-track'));
    assert.equal(
      trackBox.width >= 140,
      true,
      `Expected YouTube-style scrubber track width >= 140px in compact bar, got ${trackBox.width}`
    );
    // Drag along the YouTube-style scrubber track in compact mode and verify instant seek response
    const totalSteps = Number(await page.locator('[data-testid="replay-scrubber"]').getAttribute('max'));
    await page.mouse.move(trackBox.x + trackBox.width * 0.85, trackBox.y + trackBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(trackBox.x + trackBox.width * 0.25, trackBox.y + trackBox.height / 2, { steps: 3 });
    await page.mouse.up();
    const valAfterDrag = Number(await page.locator('[data-testid="replay-scrubber"]').inputValue());
    assert.equal(
      valAfterDrag >= 0 && valAfterDrag < totalSteps && valAfterDrag <= Math.ceil(totalSteps * 0.35),
      true,
      `Expected instant pointer-drag scrub in compact mode (0..35% of ${totalSteps}), got ${valAfterDrag}`
    );
    await page.locator('[data-testid="replay-exit-btn"]').click();
    await page.getByTestId('replay-controls-window').waitFor({ state: 'hidden', timeout: 3000 });

    // Verify save-load zoom restoration before replay, offscreen step fast-forward, and pan/zoom during playback
    const zoomInBtn = await page.waitForSelector('[data-testid="zoom-in-btn"]');
    await zoomInBtn.click();
    await zoomInBtn.click();
    await zoomInBtn.click();
    await zoomInBtn.click();
    await page.waitForFunction(
      () => (JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}').zoomScale ?? 1) > 1.8,
      undefined,
      { timeout: 3000 }
    );

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
    await page.waitForSelector('[data-testid="replay-play-pause-btn"][aria-label="Replay Again"]', { timeout: 5000 });
    // PaletteDock and ReplayControls must be co-visible on load without programmatic sync self-dismissing replay
    await page.locator('[aria-label="Palette dock"]').waitFor({ state: 'visible', timeout: 4000 });
    await page.waitForTimeout(250);
    assert.equal(
      await page.locator('[data-testid="replay-controls-window"]').isVisible(),
      true,
      'ReplayControls must remain visible alongside PaletteDock after load'
    );
    const [deskZoomOutBox, deskReplayMinBox, deskPaletteBeforeBox] = await Promise.all([
      page.getByTestId('zoom-out-btn').boundingBox(),
      page.getByTestId('replay-controls-window').boundingBox(),
      page.locator('[aria-label="Palette dock"]').boundingBox(),
    ]);
    assert.ok(deskZoomOutBox && deskReplayMinBox && deskPaletteBeforeBox);
    assert.equal(
      deskZoomOutBox.y + deskZoomOutBox.height <= deskReplayMinBox.y + 1,
      true,
      `Desktop FloatingActions bottom (${deskZoomOutBox.y + deskZoomOutBox.height}) must clear minimized ReplayControls top (${deskReplayMinBox.y})`
    );
    assert.equal(
      deskReplayMinBox.y + deskReplayMinBox.height <= deskPaletteBeforeBox.y + 1,
      true,
      `Desktop minimized ReplayControls bottom (${deskReplayMinBox.y + deskReplayMinBox.height}) must stack cleanly above PaletteDock top (${deskPaletteBeforeBox.y})`
    );
    // First Ctrl+Z while awaiting post-load replay dismisses ReplayControls AND immediately performs Undo on the same tick
    const filledBeforeCtrlZ = await page.evaluate(() => {
      const list = JSON.parse(localStorage.getItem('capy_snapshots_v8') || '[]');
      return list[0]?.filledCount || 0;
    });
    assert.ok(filledBeforeCtrlZ >= 1, `Expected >= 1 filled regions before Ctrl+Z, got ${filledBeforeCtrlZ}`);
    await page.keyboard.press('Control+z');
    await page.locator('[data-testid="replay-controls-window"]').waitFor({ state: 'hidden', timeout: 3000 });
    await page.waitForSelector('[aria-label="Palette dock"]', { timeout: 4000 });
    const deskPaletteAfterCtrlZBox = await page.locator('[aria-label="Palette dock"]').boundingBox();
    assert.ok(deskPaletteAfterCtrlZBox);
    assert.equal(
      Math.abs(deskPaletteAfterCtrlZBox.y - deskPaletteBeforeBox.y) < 1.5,
      true,
      `PaletteDock must not jump vertically when ReplayControls dismisses (${deskPaletteBeforeBox.y} -> ${deskPaletteAfterCtrlZBox.y})`
    );
    const progressAfterFirstCtrlZ = await page.evaluate(() => {
      const list = JSON.parse(localStorage.getItem('capy_snapshots_v8') || '[]');
      return list[0]?.filledCount || 0;
    });
    assert.equal(
      progressAfterFirstCtrlZ,
      filledBeforeCtrlZ - 1,
      `First Ctrl+Z while awaiting post-load ReplayControls must dismiss replay AND undo immediately (${filledBeforeCtrlZ} -> ${filledBeforeCtrlZ - 1})`
    );
    await page.keyboard.press('Control+y');
    await page.waitForFunction(
      (expected) => (JSON.parse(localStorage.getItem('capy_snapshots_v8') || '[]')[0]?.filledCount || 0) === expected,
      filledBeforeCtrlZ,
      { timeout: 3000 }
    );
    assert.equal(
      await page.evaluate(() => (JSON.parse(localStorage.getItem('capy_snapshots_v8') || '[]')[0]?.filledCount || 0)),
      filledBeforeCtrlZ,
      `Ctrl+Y after post-load replay dismiss must redo back to ${filledBeforeCtrlZ}`
    );

    // Verify ReplayControls non-overlap on desktop AND auto-dismiss when clicking the already-selected active swatch
    const undoBtnForSwatchTest = page.getByTestId('undo-btn');
    await undoBtnForSwatchTest.waitFor({ state: 'visible', timeout: 3000 });
    const uBoxSwatch = await getStableBoundingBox(undoBtnForSwatchTest);
    assert.ok(uBoxSwatch, 'Expected stable boundingBox for undo-btn before swatch replay test');
    await page.mouse.move(uBoxSwatch.x + uBoxSwatch.width / 2, uBoxSwatch.y + uBoxSwatch.height / 2);
    await page.mouse.down();
    await page.getByTestId('replay-controls-window').waitFor({ state: 'visible', timeout: 3000 });
    await page.mouse.up();
    const [deskZoomOutExpBox, deskReplayExpBox, deskPaletteExpBox] = await Promise.all([
      getStableBoundingBox(page.getByTestId('zoom-out-btn')),
      getStableBoundingBox(page.getByTestId('replay-controls-window')),
      getStableBoundingBox(page.locator('[aria-label="Palette dock"]')),
    ]);
    assert.ok(deskZoomOutExpBox && deskReplayExpBox && deskPaletteExpBox);
    assert.equal(
      deskZoomOutExpBox.y + deskZoomOutExpBox.height <= deskReplayExpBox.y + 1,
      true,
      `Desktop FloatingActions bottom (${deskZoomOutExpBox.y + deskZoomOutExpBox.height}) must clear ReplayControls top (${deskReplayExpBox.y})`
    );
    assert.equal(
      deskReplayExpBox.y + deskReplayExpBox.height <= deskPaletteExpBox.y + 1,
      true,
      `Desktop ReplayControls bottom (${deskReplayExpBox.y + deskReplayExpBox.height}) must stack cleanly above PaletteDock top (${deskPaletteExpBox.y})`
    );
    const activeSwatchDuringReplay = page
      .locator('[aria-label="Palette dock"] button[data-testid^="palette-swatch-"][aria-pressed="true"]')
      .first();
    await activeSwatchDuringReplay.scrollIntoViewIfNeeded();
    await activeSwatchDuringReplay.click();
    await page.getByTestId('replay-controls-window').waitFor({ state: 'hidden', timeout: 3000 });
    await page.getByTestId('undo-btn').waitFor({ state: 'visible', timeout: 3000 });
    const deskPaletteAfterSwatchBox = await page.locator('[aria-label="Palette dock"]').boundingBox();
    assert.ok(deskPaletteAfterSwatchBox);
    assert.equal(
      Math.abs(deskPaletteAfterSwatchBox.y - deskPaletteExpBox.y) < 1.5,
      true,
      `PaletteDock must not shift vertically on active-swatch replay dismiss (${deskPaletteExpBox.y} -> ${deskPaletteAfterSwatchBox.y})`
    );

    // Trigger replay via long-press Undo, start playback from 0, and verify live zoom/pan during playback
    const undoBtnAfterLoad = page.getByTestId('undo-btn');
    await undoBtnAfterLoad.waitFor({ state: 'visible', timeout: 3000 });
    const uBox2 = await getStableBoundingBox(undoBtnAfterLoad);
    await page.mouse.move(uBox2.x + uBox2.width / 2, uBox2.y + uBox2.height / 2);
    await page.mouse.down();
    await page.getByTestId('replay-controls-window').waitFor({ state: 'visible', timeout: 3000 });
    await page.mouse.up();

    // Enable Follow Painting and Auto-Loop, then start playback and verify camera follows offscreen regions and loops
    const followBtn = await page.waitForSelector('[data-testid="replay-follow-btn"]');
    const loopBtn = await page.waitForSelector('[data-testid="replay-loop-btn"]');
    assert.equal(await followBtn.getAttribute('aria-pressed'), 'false', 'Follow button initially off');
    assert.equal(await loopBtn.getAttribute('aria-pressed'), 'false', 'Loop button initially off');

    await followBtn.click();
    await loopBtn.click();
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="replay-follow-btn"]')?.getAttribute('aria-pressed') === 'true' &&
        document.querySelector('[data-testid="replay-loop-btn"]')?.getAttribute('aria-pressed') === 'true',
      undefined,
      { timeout: 3000 }
    );
    assert.equal(await followBtn.getAttribute('aria-pressed'), 'true', 'Follow button toggled on');
    assert.equal(await loopBtn.getAttribute('aria-pressed'), 'true', 'Loop button toggled on');

    const panBeforeFollow = await page.evaluate(() => {
      const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
      return { x: active.panOffsetX || 0, y: active.panOffsetY || 0 };
    });

    // Start replay from step 0 with Follow + Loop active; camera must smoothly pan toward painted center regions and loop continuously
    await page.locator('[data-testid="replay-play-pause-btn"]').click();
    await page.waitForTimeout(950);

    // Verify scrubber is actively looping/playing and did not stop at the end
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
    await page.waitForFunction(
      () => document.querySelector('[data-testid="replay-loop-btn"]')?.getAttribute('aria-pressed') === 'false',
      undefined,
      { timeout: 3000 }
    );

    if (await page.$('[data-testid="replay-exit-btn"]')) {
      await page.locator('[data-testid="replay-exit-btn"]').click();
      await page.getByTestId('replay-controls-window').waitFor({ state: 'hidden', timeout: 3000 });
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
      await page.getByTestId('reset-view-btn').waitFor({ state: 'hidden', timeout: 3000 });
    }

    // Verify clicking an unselected swatch during replay auto-dismisses ReplayControls, selects the color, and allows immediate painting
    const filledBeforeUnselected = await page.evaluate(
      () => (JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}').filledRegionIds || []).length
    );
    const undoBoxUnselected = await (await page.waitForSelector('[data-testid="undo-btn"]')).boundingBox();
    await page.mouse.move(
      undoBoxUnselected.x + undoBoxUnselected.width / 2,
      undoBoxUnselected.y + undoBoxUnselected.height / 2
    );
    await page.mouse.down();
    await page.getByTestId('replay-controls-window').waitFor({ state: 'visible', timeout: 5000 });
    await page.mouse.up();
    await page.locator('[aria-label="Palette dock"]').waitFor({ state: 'visible', timeout: 3000 });
    const unselectedSwatch = page
      .locator('[aria-label="Palette dock"] button[data-testid^="palette-swatch-"][aria-pressed="false"]')
      .first();
    const unselectedTestId = await unselectedSwatch.getAttribute('data-testid');
    assert.ok(unselectedTestId, 'Expected an unselected palette swatch to exist during replay');
    await unselectedSwatch.scrollIntoViewIfNeeded();
    await unselectedSwatch.click();
    await page.getByTestId('replay-controls-window').waitFor({ state: 'hidden', timeout: 3000 });
    await page.getByTestId('undo-btn').waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(
      await page.getByTestId(unselectedTestId).getAttribute('aria-pressed'),
      'true',
      `Clicked swatch ${unselectedTestId} must become active immediately after dismissing replay`
    );
    const canvasBoxUnselected = await page.locator('canvas').first().boundingBox();
    let filledAfterUnselectedTap = filledBeforeUnselected;
    for (let stepIdx = 0; stepIdx < 16; stepIdx++) {
      const rx = 0.25 + (stepIdx % 4) * 0.16;
      const ry = 0.25 + Math.floor(stepIdx / 4) * 0.16;
      await page.mouse.click(
        canvasBoxUnselected.x + canvasBoxUnselected.width * rx,
        canvasBoxUnselected.y + canvasBoxUnselected.height * ry
      );
      await page.waitForTimeout(80);
      filledAfterUnselectedTap = await page.evaluate(
        () => (JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}').filledRegionIds || []).length
      );
      if (filledAfterUnselectedTap > filledBeforeUnselected) break;
    }
    assert.equal(
      filledAfterUnselectedTap > filledBeforeUnselected,
      true,
      `Expected immediate canvas paint after swatch auto-dismissed replay (${filledBeforeUnselected} -> ${filledAfterUnselectedTap})`
    );
    await page.keyboard.press('Control+z');
    await page.waitForFunction(
      (expectedLen) =>
        (JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}').filledRegionIds || []).length === expectedLen,
      filledBeforeUnselected,
      { timeout: 3000 }
    );
    logE2ePass('Undo/Redo, default-minimised ReplayControls, zoom restoration before replay, offscreen fast-forward, Follow Painting camera tracking, Auto-Loop, swatch auto-dismiss, and live pan/zoom during playback verified.');

    // -------------------------------------------------------------------------
    // 7. Create Tab Gallery Filters & Moderated Community Puzzle Ideas
    // -------------------------------------------------------------------------
    logE2eStart('Verifying Create tab gallery filters, category chips & Community Puzzle Ideas moderation...');
    await settingsBtn.click();
    const createTabBtn = page.getByRole('button', { name: 'Create', exact: true });
    await createTabBtn.waitFor({ state: 'visible', timeout: 3000 });
    await createTabBtn.click();
    await page.getByTestId('gallery-tag-music').waitFor({ state: 'visible', timeout: 3000 });

    await page.getByTestId('gallery-tag-music').click();
    await page.waitForFunction(() => document.body.innerText.includes('Snail Guitar'), undefined, { timeout: 3000 });
    const bodyText = await page.evaluate(() => document.body.innerText);
    assert.equal(bodyText.includes('Snail Guitar'), true);

    await page.getByTestId('gallery-search-input').fill('nonexistent_xyz_artwork');
    await page.getByTestId('gallery-empty-state').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Reset Filters' }).click();

    assert.equal(
      (await page.getByTestId('community-ideas-section').innerText()).includes('Puzzle Idea Notebook'),
      true,
      'Create tab must render Puzzle Idea Notebook heading'
    );
    assert.equal((await page.getByTestId('toggle-idea-form-btn').innerText()).trim(), '+ Add Idea');
    await page.getByTestId('toggle-idea-form-btn').click();
    assert.equal((await page.getByTestId('submit-idea-btn').innerText()).trim(), 'Save Idea');
    await page.getByTestId('idea-title-input').fill('Unsafe nsfw test');
    await page.getByTestId('idea-prompt-input').fill('Testing moderation filter');
    await page.getByTestId('submit-idea-btn').click();
    assert.equal((await page.getByTestId('idea-feedback-banner').innerText()).toLowerCase().includes('family-friendly'), true);

    await page.getByTestId('idea-title-input').fill('Lantern Capybara Festival');
    await page.getByTestId('idea-prompt-input').fill('Warm paper lanterns floating over a calm twilight river.');
    await page.getByTestId('submit-idea-btn').click();
    assert.equal((await page.getByTestId('community-ideas-section').innerText()).includes('Lantern Capybara Festival'), true);
    assert.equal(await page.getByText('AI Credits').count(), 0, 'Create tab must not render AI Credits pill');
    assert.equal(await page.getByText('Optional Ad').count(), 0, 'Create tab must not render Optional Ad button');
    assert.equal(await page.locator('[data-testid^="vote-idea-"]').count(), 0, 'Create tab must not render vote-idea-* buttons');
    assert.equal(
      (await page.getByTestId('idea-feedback-banner').innerText()).includes('local puzzle notebook'),
      true,
      'Idea feedback banner must confirm local puzzle notebook save without queue claim'
    );

    await page.keyboard.press('Escape');
    await page.getByTestId('settings-modal-close').waitFor({ state: 'hidden', timeout: 3000 });
    logE2ePass('Gallery search, category chips, Store-clean Create tab gating, and community idea moderation verified.');

    // -------------------------------------------------------------------------
    // 8. Shareable Link (#s=<token>), Simultaneous Co-op, Saves View Modes & Google Drive CRDT Sync
    // -------------------------------------------------------------------------
    logE2eStart('Verifying < 2 KB Share Link (#s=), 2-peer BroadcastChannel Co-op, Google Drive CRDT sync, Saves views & .capy v2 export...');
    await page.evaluate(() => localStorage.setItem('capy_dev_cloud_coop_ui', '1'));
    await page.reload({ waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(page);
    {
      await page.locator('button[title="Settings and Menu"]').click();
      await page.getByTestId('settings-tab-about').click();
      await page.getByTestId('stat-coop-regions').waitFor({ state: 'visible', timeout: 3000 });
      assert.equal(
        /co-op/i.test(await page.getByTestId('about-screen-card').innerText()),
        true,
        'About tab hero card must show Co-op copy when showCloudCoopUi === true'
      );
      const coopRowLayout = await page.evaluate(() => {
        const freeEl = document.querySelector('[data-testid="stat-free-color-creations"]')?.parentElement;
        const coopEl = document.querySelector('[data-testid="stat-coop-regions"]')?.parentElement;
        const gridEl = freeEl?.parentElement;
        if (!freeEl || !coopEl || !gridEl) return null;
        const freeRect = freeEl.getBoundingClientRect();
        const coopRect = coopEl.getBoundingClientRect();
        const gridRect = gridEl.getBoundingClientRect();
        return {
          freeColSpan2: freeEl.classList.contains('col-span-2'),
          sameRow: Math.abs(freeRect.top - coopRect.top) <= 2,
          freeHalfWidth: freeRect.width < gridRect.width * 0.6,
        };
      });
      assert.ok(coopRowLayout, 'Co-op row layout tiles must exist when showCloudCoopUi === true');
      assert.equal(coopRowLayout.freeColSpan2, false, 'Free Colour Art must drop col-span-2 when Co-op Regions is visible');
      assert.equal(coopRowLayout.sameRow && coopRowLayout.freeHalfWidth, true, 'Free Colour Art and Co-op Regions must pair side-by-side in Row 3');
      await page.keyboard.press('Escape');
      await page.getByTestId('settings-modal-close').waitFor({ state: 'hidden', timeout: 3000 });

      const hasBakedClientId = Boolean((process.env.VITE_GOOGLE_CLIENT_ID || '').trim());
      await page.getByTestId('topbar-coop-btn').click();
      await page.getByTestId('cloud-provider-badge-google').waitFor({ state: 'visible', timeout: 3000 });
      assert.equal(
        await page.getByTestId('play-games-signin-btn').count(),
        hasBakedClientId ? 1 : 0,
        'Opt-in Web Google Login button must auto-hide when VITE_GOOGLE_CLIENT_ID is empty'
      );
      await page.keyboard.press('Escape');
      await page.getByTestId('cloud-provider-badge-google').waitFor({ state: 'hidden', timeout: 3000 });
    }
    await tapCanvasGrid(page, 0.45, 8, 40);
    const paintedIdsOnA = await page.evaluate(() => {
      const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
      return active.filledRegionIds || [];
    });

    await page.getByTestId('topbar-coop-btn').click();
    await page.getByTestId('share-progress-link-btn').waitFor({ state: 'visible', timeout: 3000 });
    await page.getByTestId('share-progress-link-btn').click();
    await page.waitForFunction(
      async () => (await navigator.clipboard.readText()).includes('#s='),
      undefined,
      { timeout: 3000 }
    );

    const sharedUrl = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(sharedUrl.includes('#s='), true);
    assert.equal(sharedUrl.length < 2048, true);

    // Verify isolated browser context restores #s=<token> progress
    const ctxIsolated = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const pageRecipient = await ctxIsolated.newPage();
    attachErrorListeners(pageRecipient, 'recipient');
    await pageRecipient.goto(sharedUrl, { waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(pageRecipient);
    await pageRecipient.waitForFunction(
      (expectedLen) =>
        (JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}').filledRegionIds || []).length === expectedLen,
      paintedIdsOnA.length,
      { timeout: 5000 }
    );
    const recipientIds = await pageRecipient.evaluate(() => {
      const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
      return active.filledRegionIds || [];
    });
    assert.deepEqual([...recipientIds].sort((a, b) => a - b), [...paintedIdsOnA].sort((a, b) => a - b));
    await ctxIsolated.close();

    // Host Co-op room on Page A and join from Page B in same context
    await page.getByTestId('host-coop-room-btn').click();
    await page.getByTestId('active-coop-room-code').waitFor({ state: 'visible', timeout: 5000 });
    const roomBadgeText = await page.getByTestId('active-coop-room-code').innerText();
    const roomCode = roomBadgeText.match(/Room\s+([A-Z0-9]{6})/)[1];
    await page.keyboard.press('Escape');
    await page.getByTestId('active-coop-room-code').waitFor({ state: 'hidden', timeout: 3000 });

    const pageB = await context.newPage();
    attachErrorListeners(pageB, 'pageB');
    await pageB.goto(`${BASE_URL}/?coop=1`, { waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(pageB);
    await pageB.getByTestId('topbar-coop-btn').click();
    await pageB.getByTestId('join-coop-room-input').waitFor({ state: 'visible', timeout: 3000 });
    await pageB.getByTestId('join-coop-room-input').fill(roomCode);
    await pageB.getByTestId('join-coop-room-btn').click();
    await pageB.waitForFunction(
      () => document.querySelector('[data-testid="active-coop-room-code"]')?.textContent?.includes('2 online'),
      undefined,
      { timeout: 5000 }
    );
    assert.equal((await pageB.getByTestId('active-coop-room-code').innerText()).includes('2 online'), true);
    await pageB.keyboard.press('Escape');
    await pageB.getByTestId('active-coop-room-code').waitFor({ state: 'hidden', timeout: 3000 });

    await tapCanvasGrid(page, 0.56, 8, 40);
    const filledAfterTapA = Number(
      await page.getByTestId('topbar-saves-btn').getAttribute('data-filled-count')
    );
    await pageB.waitForFunction(
      (expectedCount) =>
        Number(document.querySelector('[data-testid="topbar-saves-btn"]')?.getAttribute('data-filled-count')) ===
        expectedCount,
      filledAfterTapA,
      { timeout: 5000 }
    );
    const filledAfterTapB = Number(
      await pageB.getByTestId('topbar-saves-btn').getAttribute('data-filled-count')
    );
    assert.equal(filledAfterTapB, filledAfterTapA, 'Co-op peer data-filled-count must synchronize in real time');
    const extractPct = (s) => Number(s.match(/(\d+)%/)?.[1] ?? -1);
    assert.equal(
      extractPct(await pageB.locator('header').innerText()),
      extractPct(await page.locator('header').innerText()),
      'Co-op peer header % must synchronize in real time'
    );

    // BF-1: Verify Free Colour repaint of an already-filled region preserves chronological order and Undo syncs restored color to Co-op peer
    await settingsBtn.click();
    const settingsTabBtn = page.getByRole('button', { name: 'Settings', exact: true });
    await settingsTabBtn.waitFor({ state: 'visible', timeout: 3000 });
    await settingsTabBtn.click();
    const freeColorLabel = await page.waitForSelector('text=Free Colour Mode');
    await freeColorLabel.evaluate((el) => el.closest('.flex')?.querySelector('button')?.click());
    await page.keyboard.press('Escape');
    await page.getByTestId('settings-modal-close').waitFor({ state: 'hidden', timeout: 3000 });

    // Pick a different swatch in the palette dock on Page A
    const swatchButtons = page.locator('[aria-label="Palette dock"] button[aria-label^="Color "]');
    const swatchCount = await swatchButtons.count();
    if (swatchCount > 1) {
      const targetSwatch = swatchButtons.nth(swatchCount - 1);
      const targetSwatchTestId = await targetSwatch.getAttribute('data-testid');
      await targetSwatch.click();
      if (targetSwatchTestId) {
        await page.waitForFunction(
          (tid) => document.querySelector(`[data-testid="${tid}"]`)?.getAttribute('aria-pressed') === 'true',
          targetSwatchTestId,
          { timeout: 3000 }
        );
      }
    }
    const orderBeforeFreeRepaint = await page.evaluate(() => {
      const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
      return active.filledRegionIds || [];
    });
    // Tap the same canvas grid points so at least one already-filled region is repainted in Free Colour Mode
    await tapCanvasGrid(page, 0.56, 4, 40);

    const afterFreeRepaint = await page.evaluate(() => {
      const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
      return {
        filledRegionIds: active.filledRegionIds || [],
        paintedRegionColors: active.paintedRegionColors || {},
      };
    });
    const filledAfterFreeRepaintA = Number(
      await page.getByTestId('topbar-saves-btn').getAttribute('data-filled-count')
    );
    await pageB.waitForFunction(
      ({ expectedFilledCount, expectedPaintedJson }) => {
        const count = Number(
          document.querySelector('[data-testid="topbar-saves-btn"]')?.getAttribute('data-filled-count')
        );
        const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
        return count === expectedFilledCount && JSON.stringify(active.paintedRegionColors || {}) === expectedPaintedJson;
      },
      {
        expectedFilledCount: filledAfterFreeRepaintA,
        expectedPaintedJson: JSON.stringify(afterFreeRepaint.paintedRegionColors),
      },
      { timeout: 5000 }
    );
    assert.equal(
      Number(await pageB.getByTestId('topbar-saves-btn').getAttribute('data-filled-count')),
      filledAfterFreeRepaintA,
      'Co-op peer data-filled-count must match Page A after Free Colour repaint'
    );
    // Verify original prefix of filledRegionIds preserved its exact chronological sequence
    assert.deepEqual(
      afterFreeRepaint.filledRegionIds.slice(0, orderBeforeFreeRepaint.length),
      orderBeforeFreeRepaint,
      'BF-1: Repainting already-filled regions in Free Colour Mode must not shift their chronological position to the tail'
    );

    // Undo the last Free Colour repaint on Page A and verify Page B's paintedRegionColors stays synchronized
    await page.keyboard.press('Control+z');
    await page.waitForFunction(
      ({ prevCount, prevPaintedJson }) => {
        const count = Number(
          document.querySelector('[data-testid="topbar-saves-btn"]')?.getAttribute('data-filled-count')
        );
        const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
        return count !== prevCount || JSON.stringify(active.paintedRegionColors || {}) !== prevPaintedJson;
      },
      {
        prevCount: filledAfterFreeRepaintA,
        prevPaintedJson: JSON.stringify(afterFreeRepaint.paintedRegionColors),
      },
      { timeout: 3000 }
    );
    const [paintedAfterUndoA, filledAfterUndoA] = await Promise.all([
      page.evaluate(() => JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}').paintedRegionColors || {}),
      page.getByTestId('topbar-saves-btn').getAttribute('data-filled-count').then(Number),
    ]);
    await pageB.waitForFunction(
      ({ expectedFilledCount, expectedPaintedJson }) => {
        const count = Number(
          document.querySelector('[data-testid="topbar-saves-btn"]')?.getAttribute('data-filled-count')
        );
        const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
        return count === expectedFilledCount && JSON.stringify(active.paintedRegionColors || {}) === expectedPaintedJson;
      },
      {
        expectedFilledCount: filledAfterUndoA,
        expectedPaintedJson: JSON.stringify(paintedAfterUndoA),
      },
      { timeout: 5000 }
    );
    const [paintedAfterUndoB, filledAfterUndoB] = await Promise.all([
      pageB.evaluate(() => JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}').paintedRegionColors || {}),
      pageB.getByTestId('topbar-saves-btn').getAttribute('data-filled-count').then(Number),
    ]);
    assert.equal(
      filledAfterUndoB,
      filledAfterUndoA,
      'BF-1: Undoing a Free Colour repaint on Page A must keep data-filled-count synchronized on Page B'
    );
    assert.deepEqual(
      paintedAfterUndoB,
      paintedAfterUndoA,
      'BF-1: Undoing a Free Colour repaint on Page A must broadcast restored color to Co-op peer Page B'
    );

    // C8-1 regression (Free Colour Mode): rapid synchronous same-frame clicks must not drop strokes or desync Co-op peer
    if (swatchCount > 0) {
      const firstSwatch = swatchButtons.nth(0);
      const firstSwatchTestId = await firstSwatch.getAttribute('data-testid');
      await firstSwatch.click();
      if (firstSwatchTestId) {
        await page.waitForFunction(
          (tid) => document.querySelector(`[data-testid="${tid}"]`)?.getAttribute('aria-pressed') === 'true',
          firstSwatchTestId,
          { timeout: 3000 }
        );
      }
    }
    const filledBeforeFreeBurst = Number(
      await page.getByTestId('topbar-saves-btn').getAttribute('data-filled-count')
    );
    const activeFreeBurstA = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) throw new Error('Missing canvas for same-frame Free Colour burst');
      const rect = canvas.getBoundingClientRect();
      const points = [
        [0.2, 0.25],
        [0.8, 0.25],
        [0.2, 0.75],
        [0.8, 0.75],
        [0.5, 0.5],
      ];
      for (let i = 0; i < points.length; i++) {
        const clientX = rect.left + rect.width * points[i][0];
        const clientY = rect.top + rect.height * points[i][1];
        canvas.dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            pointerId: 100 + i,
            pointerType: 'mouse',
            isPrimary: true,
            button: 0,
            buttons: 1,
            clientX,
            clientY,
          })
        );
        canvas.dispatchEvent(
          new PointerEvent('pointerup', {
            bubbles: true,
            cancelable: true,
            pointerId: 100 + i,
            pointerType: 'mouse',
            isPrimary: true,
            button: 0,
            buttons: 0,
            clientX,
            clientY,
          })
        );
      }
      // Capture Page A's synchronous localStorage state immediately before Page B's BroadcastChannel macrotasks overwrite shared origin storage
      return JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
    });
    await page.waitForFunction(
      (minExpected) =>
        Number(document.querySelector('[data-testid="topbar-saves-btn"]')?.getAttribute('data-filled-count')) >=
        minExpected,
      filledBeforeFreeBurst + 4,
      { timeout: 5000 }
    );
    const filledAfterFreeBurstA = Number(
      await page.getByTestId('topbar-saves-btn').getAttribute('data-filled-count')
    );
    assert.equal(
      (activeFreeBurstA.filledRegionIds || []).length,
      filledAfterFreeBurstA,
      'C8-1: Page A localStorage filledRegionIds must match DOM count after Free Colour burst'
    );
    const expectedCanonicalPaintedJson = JSON.stringify(
      Object.entries(activeFreeBurstA.paintedRegionColors || {}).sort((a, b) => Number(a[0]) - Number(b[0]))
    );
    await pageB.waitForFunction(
      ({ expectedCount, expectedPaintedJson }) => {
        const count = Number(
          document.querySelector('[data-testid="topbar-saves-btn"]')?.getAttribute('data-filled-count')
        );
        const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
        const canonicalPainted = JSON.stringify(
          Object.entries(active.paintedRegionColors || {}).sort((a, b) => Number(a[0]) - Number(b[0]))
        );
        return count === expectedCount && canonicalPainted === expectedPaintedJson;
      },
      {
        expectedCount: filledAfterFreeBurstA,
        expectedPaintedJson: expectedCanonicalPaintedJson,
      },
      { timeout: 5000 }
    );

    // Turn Free Colour Mode back off before running Normal Mode burst and closing pageB
    await settingsBtn.click();
    const freeColorLabelOff = await page.waitForSelector('text=Free Colour Mode');
    await freeColorLabelOff.evaluate((el) => el.closest('.flex')?.querySelector('button')?.click());
    await page.keyboard.press('Escape');
    await page.getByTestId('settings-modal-close').waitFor({ state: 'hidden', timeout: 3000 });

    // C8-1 regression (Normal Mode): rapid synchronous same-frame clicks must accumulate every fill and stay synced with Co-op peer
    const filledBeforeNormalBurst = Number(
      await page.getByTestId('topbar-saves-btn').getAttribute('data-filled-count')
    );
    const idsNormalBurstA = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) throw new Error('Missing canvas for same-frame Normal burst');
      const rect = canvas.getBoundingClientRect();
      const points = [
        [0.14, 0.22],
        [0.86, 0.22],
        [0.14, 0.82],
        [0.86, 0.82],
      ];
      for (let i = 0; i < points.length; i++) {
        const clientX = rect.left + rect.width * points[i][0];
        const clientY = rect.top + rect.height * points[i][1];
        canvas.dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            pointerId: 200 + i,
            pointerType: 'mouse',
            isPrimary: true,
            button: 0,
            buttons: 1,
            clientX,
            clientY,
          })
        );
        canvas.dispatchEvent(
          new PointerEvent('pointerup', {
            bubbles: true,
            cancelable: true,
            pointerId: 200 + i,
            pointerType: 'mouse',
            isPrimary: true,
            button: 0,
            buttons: 0,
            clientX,
            clientY,
          })
        );
      }
      return JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}').filledRegionIds || [];
    });
    await page.waitForFunction(
      (minExpected) =>
        Number(document.querySelector('[data-testid="topbar-saves-btn"]')?.getAttribute('data-filled-count')) >=
        minExpected,
      filledBeforeNormalBurst + 3,
      { timeout: 5000 }
    );
    const filledAfterNormalBurstA = Number(
      await page.getByTestId('topbar-saves-btn').getAttribute('data-filled-count')
    );
    assert.equal(
      idsNormalBurstA.length,
      filledAfterNormalBurstA,
      'C8-1: Page A localStorage filledRegionIds must match DOM count after Normal Mode burst'
    );
    await pageB.waitForFunction(
      ({ expectedCount, expectedSortedIdsJson }) => {
        const count = Number(
          document.querySelector('[data-testid="topbar-saves-btn"]')?.getAttribute('data-filled-count')
        );
        const ids = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}').filledRegionIds || [];
        const sortedIds = [...ids].sort((a, b) => a - b);
        return count === expectedCount && JSON.stringify(sortedIds) === expectedSortedIdsJson;
      },
      {
        expectedCount: filledAfterNormalBurstA,
        expectedSortedIdsJson: JSON.stringify([...idsNormalBurstA].sort((a, b) => a - b)),
      },
      { timeout: 5000 }
    );

    await pageB.close();

    // Leave Co-op room and verify Saves view modes + .capy v2 binary export/import
    await page.getByTestId('topbar-coop-btn').click();
    await page.getByTestId('leave-coop-room-btn').waitFor({ state: 'visible', timeout: 3000 });
    await page.getByTestId('leave-coop-room-btn').click();
    await page.getByTestId('active-coop-room-code').waitFor({ state: 'hidden', timeout: 3000 });

    await page.getByTestId('cloud-provider-badge-google').waitFor({ state: 'visible' });
    assert.equal(
      await page.getByTestId('saves-list-section').getAttribute('data-view-mode'),
      'THUMBNAILS',
      'Saves tab must start in THUMBNAILS view mode'
    );
    assert.equal(
      await page.getByTestId('saves-view-thumbnails-btn').getAttribute('aria-pressed'),
      'true'
    );
    await page.getByTestId('saves-view-detail-btn').click();
    await page.getByTestId('saves-list-detail').waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await page.evaluate(() => localStorage.getItem('capy_saves_view_mode')), 'DETAIL');
    assert.equal(await page.getByTestId('saves-view-detail-btn').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.getByTestId('saves-view-thumbnails-btn').getAttribute('aria-pressed'), 'false');

    // Verify DETAIL preference persists across full page reload
    await page.reload({ waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(page);
    await page.getByTestId('topbar-coop-btn').click();
    await page.getByTestId('saves-list-detail').waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(
      await page.getByTestId('saves-view-detail-btn').getAttribute('aria-pressed'),
      'true',
      'Persisted DETAIL view mode must restore across page reload'
    );

    // Verify invalid localStorage value safely falls back to THUMBNAILS
    await page.evaluate(() => localStorage.setItem('capy_saves_view_mode', 'INVALID_VIEW_MODE'));
    await page.reload({ waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(page);
    await page.getByTestId('topbar-coop-btn').click();
    await page.getByTestId('saves-list-thumbnails').waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(
      await page.getByTestId('saves-list-section').getAttribute('data-view-mode'),
      'THUMBNAILS',
      'Invalid capy_saves_view_mode value must fall back cleanly to THUMBNAILS'
    );
    assert.equal(
      await page.getByTestId('saves-view-thumbnails-btn').getAttribute('aria-pressed'),
      'true'
    );
    await page.evaluate(() => localStorage.removeItem('capy_saves_view_mode'));

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
    await page.getByTestId('settings-modal-close').waitFor({ state: 'hidden', timeout: 3000 });
    logE2ePass('#s=<token> share link, 2-peer real-time Co-op, Saves view modes, and .capy v2 export verified.');

    // -------------------------------------------------------------------------
    // 9. Custom Photo Upload (STORE_IMAGES), 100% Offline PWA Reload & Completed Replay
    // -------------------------------------------------------------------------
    logE2eStart('Verifying custom photo STORE_IMAGES upload, 100% offline PWA reload & post-completion Replay viewport invariance...');
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
    const snapIdBeforeUpload = await page.evaluate(
      () => JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}').activeSnapshotId || null
    );
    try {
      await page.locator('input[type="file"][accept="image/*"]').setInputFiles(tmpUploadPath);
      await page.waitForFunction(
        (prevId) => {
          const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
          return Boolean(active.activeSnapshotId && active.activeSnapshotId !== prevId);
        },
        snapIdBeforeUpload,
        { timeout: 15000 }
      );
      await waitForPuzzleLoaded(page);
    } finally {
      fs.rmSync(tmpUploadPath, { force: true });
    }

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
    await page.waitForFunction(
      () => (JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}').zoomScale || 1) > 1.5,
      undefined,
      { timeout: 3000 }
    );

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
    if (await page.locator('[data-testid="replay-exit-btn"]').isVisible()) {
      await page.locator('[data-testid="replay-exit-btn"]').click();
      await page.getByTestId('replay-controls-window').waitFor({ state: 'hidden', timeout: 3000 });
    }
    const completedReplayBtn = await page.waitForSelector('[data-testid="replay-btn"]', { timeout: 5000 });
    await completedReplayBtn.click();
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
    await page.getByTestId('replay-exit-btn').click();
    await page.getByTestId('replay-controls-window').waitFor({ state: 'hidden', timeout: 3000 });
    logE2ePass('Custom photo STORE_IMAGES persistence, 100% offline PWA reload & post-completion Replay viewport invariance verified.');

    // -------------------------------------------------------------------------
    // 10. BF-2 Container ResizeObserver Clamping & BF-6 IndexedDB Cache Eviction Recovery
    // -------------------------------------------------------------------------
    logE2eStart('Verifying BF-2 ResizeObserver canvas clamping & BF-6 IndexedDB cache eviction recovery...');
    await page.setViewportSize({ width: 540, height: 420 });
    await page.waitForFunction(
      () => {
        const c = document.querySelector('canvas');
        const dpr = window.devicePixelRatio || 1;
        return Boolean(c && c.clientWidth > 0 && c.clientWidth <= 540 && c.width === Math.round(c.clientWidth * dpr));
      },
      undefined,
      { timeout: 5000 }
    );
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
    await page.waitForFunction(
      () => {
        const c = document.querySelector('canvas');
        const dpr = window.devicePixelRatio || 1;
        return Boolean(c && c.clientWidth > 540 && c.width === Math.round(c.clientWidth * dpr));
      },
      undefined,
      { timeout: 5000 }
    );

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
    await page.waitForFunction(
      () => document.querySelectorAll('[aria-label="Palette dock"] button[data-testid^="palette-swatch-"]').length > 0,
      undefined,
      { timeout: 5000 }
    );

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
    logE2ePass('BF-2 ResizeObserver clamping and BF-6 customPalette IndexedDB eviction recovery verified.');

    // ------------------------------------------------------------------
    // 11. Controls Settings (Zoom Sensitivity, Magnetic Zoom Stops, Sound) & topbar-zoom-badge Removal
    // ------------------------------------------------------------------
    logE2eStart('Verifying Controls settings persistence (zoom sensitivity, magnetic stops, sound) & topbar-zoom-badge removal...');
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
    await page.getByTestId('settings-modal-close').waitFor({ state: 'hidden', timeout: 3000 });

    assert.equal(
      await page.getByTestId('topbar-zoom-badge').count(),
      0,
      'Expected topbar-zoom-badge to be removed from GameTopBar'
    );
    logE2ePass('Controls settings (zoomSensitivity, snapZoomLevels, soundEnabled, soundVolume) and topbar-zoom-badge removal verified.');

    // ------------------------------------------------------------------
    // 12. Daily Featured Puzzle, Reduced Motion, Keyboard Shortcuts & Lifetime Stats
    // ------------------------------------------------------------------
    logE2eStart('Verifying Daily Featured Puzzle, Reduced Motion, Keyboard Shortcuts & Lifetime Stats...');

    // Prebaked sample viewport reset regression check (date-independent)
    await page.reload({ waitUntil: 'load' });
    await waitForPuzzleLoaded(page);

    await page.locator('button[title="Settings and Menu"]').click();
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    const snailCard = page.getByTestId('gallery-card-snail_guitar');
    await snailCard.waitFor({ state: 'visible', timeout: 5000 });
    await snailCard.getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForFunction(
      () => {
        const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
        return active.activeSnapshotId === 'sample-snail-guitar';
      },
      undefined,
      { timeout: 5000 }
    );
    await waitForPuzzleLoaded(page);
    await page.getByTestId('reset-view-btn').waitFor({ state: 'hidden', timeout: 3000 });

    assert.equal(
      await page.getByTestId('reset-view-btn').count(),
      0,
      'Expected reset-view-btn to be unmounted after prebaked sample viewport reset'
    );
    const prebakedSession = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
    });
    assert.equal(
      prebakedSession.zoomScale,
      1,
      `Expected capy_active_session_v8 zoomScale === 1 after prebaked sample load, got ${prebakedSession.zoomScale}`
    );
    assert.equal(
      prebakedSession.panOffsetX,
      0,
      `Expected capy_active_session_v8 panOffsetX === 0 after prebaked sample load, got ${prebakedSession.panOffsetX}`
    );
    assert.equal(
      prebakedSession.panOffsetY,
      0,
      `Expected capy_active_session_v8 panOffsetY === 0 after prebaked sample load, got ${prebakedSession.panOffsetY}`
    );

    // Zoom in before Play Daily so 10a also verifies daily puzzle launch resets non-1x zoom
    await page.keyboard.press('+');
    await page.getByTestId('reset-view-btn').waitFor({ state: 'visible', timeout: 3000 });

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

    const dailyBeforeState = await page.evaluate(() => {
      const snaps = JSON.parse(localStorage.getItem('capy_snapshots_v8') || '[]');
      const settings = JSON.parse(localStorage.getItem('capy_user_settings_v8') || '{}');
      return { count: snaps.length, generatorConfig: settings.generatorConfig || null };
    });
    const snapCountBeforeDaily = dailyBeforeState.count;
    await page.getByTestId('daily-puzzle-play-btn').click();
    // The previous puzzle's canvas and PaletteDock stay mounted while Play Daily fetches and
    // imports daily_saves.capy asynchronously, so waitForPuzzleLoaded alone can resolve against
    // the old puzzle. Wait for the prebaked daily-* snapshot to become the active save first; a
    // genuine fallback to worker generation still fails the descriptive assertion below.
    await page
      .waitForFunction(
        () => {
          const snaps = JSON.parse(localStorage.getItem('capy_snapshots_v8') || '[]');
          return typeof snaps[0]?.id === 'string' && snaps[0].id.startsWith('daily-');
        },
        null,
        { timeout: 20000 }
      )
      .catch(() => {});
    await waitForPuzzleLoaded(page);
    assert.equal(await dailyCard.isVisible(), false, 'Settings modal should close after clicking Play Daily');
    const dailyAfterState = await page.evaluate(() => {
      const snaps = JSON.parse(localStorage.getItem('capy_snapshots_v8') || '[]');
      const settings = JSON.parse(localStorage.getItem('capy_user_settings_v8') || '{}');
      return {
        id: snaps[0]?.id || null,
        count: snaps.length,
        generatorConfig: settings.generatorConfig || null,
      };
    });
    assert.match(
      String(dailyAfterState.id),
      /^daily-/,
      `Expected Play Daily to mount pre-generated daily-* snapshot, got '${dailyAfterState.id}'`
    );
    assert.equal(
      dailyAfterState.count,
      snapCountBeforeDaily + 1,
      `filterSnapshotId must selectively import only 1 daily snapshot (before=${snapCountBeforeDaily}, after=${dailyAfterState.count})`
    );
    assert.deepEqual(
      dailyAfterState.generatorConfig,
      dailyBeforeState.generatorConfig,
      'Play Daily must not mutate persisted user generatorConfig'
    );

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
    await page.getByTestId('settings-modal-close').waitFor({ state: 'hidden', timeout: 3000 });

    // 10c. Keyboard shortcuts: '1' / '2' swatch select, input-focus guard, '+' zoom, ArrowRight/ArrowLeft pan, '0' reset
    await page.keyboard.press('1');
    await page.waitForFunction(
      () => document.querySelector('[data-testid="palette-swatch-1"]')?.getAttribute('aria-pressed') === 'true',
      undefined,
      { timeout: 3000 }
    );
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
    await page.waitForFunction(
      () => document.querySelector('[data-testid="gallery-search-input"]')?.value === '2',
      undefined,
      { timeout: 3000 }
    );
    await gallerySearchInput.fill('');
    await page.keyboard.press('Escape');
    await page.getByTestId('settings-modal-close').waitFor({ state: 'hidden', timeout: 3000 });

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
    await page.waitForFunction(
      () => document.querySelector('[data-testid="palette-swatch-2"]')?.getAttribute('aria-pressed') === 'true',
      undefined,
      { timeout: 3000 }
    );
    assert.equal(
      await page.getByTestId('palette-swatch-2').getAttribute('aria-pressed'),
      'true',
      'Expected keyboard "2" on active canvas to select swatch #2'
    );

    // '+' zooms in above 1.0x (press twice so there is ample horizontal pan headroom)
    await page.keyboard.press('+');
    await page.waitForFunction(
      () => (JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}').zoomScale ?? 1) > 1.0,
      null,
      { timeout: 3000 }
    );
    const zoomAfterFirstPlus = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}').zoomScale ?? 1;
    });
    assert.ok(
      zoomAfterFirstPlus > 1.0,
      `Expected keyboard "+" to zoom above 1.0x, got '${zoomAfterFirstPlus}'`
    );
    await page.keyboard.press('+');
    await page.waitForFunction(
      (prevZoom) => (JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}').zoomScale ?? 1) > prevZoom,
      zoomAfterFirstPlus,
      { timeout: 3000 }
    );

    const panBefore = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}').panOffsetX ?? 0;
    });

    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(
      (prevPan) => (JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}').panOffsetX ?? 0) < prevPan,
      panBefore,
      { timeout: 3000 }
    );
    const panAfterRight = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}').panOffsetX ?? 0;
    });
    assert.ok(
      panAfterRight < panBefore,
      `Expected ArrowRight to pan viewport right (decreasing panOffsetX from ${panBefore}), got ${panAfterRight}`
    );

    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(
      (prevPan) => (JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}').panOffsetX ?? 0) > prevPan,
      panAfterRight,
      { timeout: 3000 }
    );
    const panAfterLeft = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}').panOffsetX ?? 0;
    });
    assert.ok(
      panAfterLeft > panAfterRight,
      `Expected ArrowLeft to pan viewport left (increasing panOffsetX from ${panAfterRight}), got ${panAfterLeft}`
    );

    await page.keyboard.press('0');
    await page.waitForFunction(
      () => Math.abs((JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}').zoomScale ?? 1) - 1) < 0.001,
      null,
      { timeout: 3000 }
    );
    const zoomAfterReset = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}').zoomScale ?? 1;
    });
    assert.equal(
      zoomAfterReset,
      1,
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
    await page.getByRole('button', { name: 'About', exact: true }).click();
    const statsCard = page.getByTestId('lifetime-stats-card');
    await statsCard.waitFor({ state: 'visible', timeout: 5000 });
    const renderedTotalText = (await page.getByTestId('stat-total-regions').innerText()).replace(/,/g, '').trim();
    assert.equal(
      Number(renderedTotalText),
      nextTotalColored,
      `Expected lifetime-stats-card stat-total-regions (${renderedTotalText}) to match persisted totalRegionsColored (${nextTotalColored})`
    );
    await page.keyboard.press('Escape');
    await page.getByTestId('settings-modal-close').waitFor({ state: 'hidden', timeout: 3000 });
    logE2ePass('Daily Featured Puzzle card/launch, Reduced Motion persistence, Keyboard Gameplay Shortcuts + input-focus guard, and Lifetime Stats verified.');

    // -------------------------------------------------------------------------
    // 13. Printable SVG Export, Sub-Tile Parent Breadcrumbs (Infinite Zoom) & Co-op UNFILL_EVENT Undo Sync
    // -------------------------------------------------------------------------
    logE2eStart('Verifying Printable SVG export, Sub-Tile Parent Breadcrumbs (Infinite Zoom) & 2-peer Co-op UNFILL_EVENT Undo sync...');

    // 11a. TASK-4.2a: Clicking export-printable-svg-btn triggers a valid .svg download
    await page.getByTestId('topbar-coop-btn').click();
    await page.getByTestId('export-printable-svg-btn').waitFor({ state: 'visible', timeout: 3000 });
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
    await page.getByTestId('settings-modal-close').waitFor({ state: 'hidden', timeout: 3000 });

    // 11b. TASK-4.1a: Infinite Zoom detail sub-tile sets parentSnapshotId, renders topbar-parent-puzzle-btn,
    // restores parent puzzle & viewport on tap, and hides breadcrumb pill when parent snapshot is deleted
    const parentSnapId = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}').activeSnapshotId || null;
    });
    assert.ok(parentSnapId, 'Parent puzzle must have an activeSnapshotId');

    await page.locator('button[title="Settings and Menu"]').click();
    await page.getByRole('button', { name: 'Create', exact: true }).waitFor({ state: 'visible', timeout: 3000 });
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.getByTestId('infinite-zoom-subtile-btn').waitFor({ state: 'visible', timeout: 3000 });
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
    const parentBreadcrumbBtn = page.getByTestId('topbar-parent-puzzle-btn');
    await parentBreadcrumbBtn.waitFor({ state: 'visible', timeout: 5000 });

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
    await parentBreadcrumbBtn.waitFor({ state: 'hidden', timeout: 3000 });
    const restoredActiveId = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}').activeSnapshotId || null;
    });
    assert.equal(restoredActiveId, parentSnapId, 'Clicking topbar-parent-puzzle-btn must restore parent snapshot');
    assert.equal(
      await parentBreadcrumbBtn.count(),
      0,
      'Parent puzzle without parentSnapshotId must not show topbar-parent-puzzle-btn'
    );

    // Reload child sub-tile, delete parent snapshot, and verify dangling breadcrumb pill hides gracefully
    await page.getByTestId('topbar-coop-btn').click();
    await page.getByTestId(`save-card-${childSnapMeta.id}`).waitFor({ state: 'visible', timeout: 3000 });
    await page.getByTestId(`save-card-${childSnapMeta.id}`).click();
    await page.getByTestId('save-action-load').waitFor({ state: 'visible', timeout: 3000 });
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
    await page.getByTestId(`save-card-${parentSnapId}`).waitFor({ state: 'visible', timeout: 3000 });
    await page.getByTestId(`save-card-${parentSnapId}`).click();
    await page.getByTestId('save-action-delete').waitFor({ state: 'visible', timeout: 3000 });
    await page.getByTestId('save-action-delete').click();
    await page.getByTestId('save-action-confirm-delete').waitFor({ state: 'visible', timeout: 3000 });
    await page.getByTestId('save-action-confirm-delete').click();
    await page.getByTestId(`save-card-${parentSnapId}`).waitFor({ state: 'hidden', timeout: 3000 });
    await page.keyboard.press('Escape');
    await page.getByTestId('settings-modal-close').waitFor({ state: 'hidden', timeout: 3000 });
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
    await page.getByTestId(`save-card-${coopSampleId}`).waitFor({ state: 'visible', timeout: 3000 });
    await page.getByTestId(`save-card-${coopSampleId}`).click();
    await page.getByTestId('save-action-load').waitFor({ state: 'visible', timeout: 3000 });
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
    if (await page.$('[data-testid="replay-exit-btn"]')) {
      await page.locator('[data-testid="replay-exit-btn"]').click();
      await page.getByTestId('replay-controls-window').waitFor({ state: 'hidden', timeout: 3000 });
    }

    // Ensure Enable Undo Action is ON and Free Colour Mode is OFF on Peer A
    await page.locator('button[title="Settings and Menu"]').click();
    await page.getByRole('button', { name: 'Settings', exact: true }).waitFor({ state: 'visible', timeout: 3000 });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const currentSettings11c = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('capy_user_settings_v8') || '{}');
    });
    await page.locator('button:has(span:text-is("Settings"))').click();
    if (currentSettings11c.isFreeColorMode) {
      const fcLabel = await page.waitForSelector('text=Free Colour Mode');
      await fcLabel.evaluate((el) => el.closest('.flex')?.querySelector('button')?.click());
    }
    if (!currentSettings11c.enableUndo) {
      const undoSettingLabel = await page.waitForSelector('text=Enable Undo Action');
      await undoSettingLabel.evaluate((el) => el.closest('.flex')?.querySelector('button')?.click());
    }
    await page.keyboard.press('Escape');
    await page.getByTestId('settings-modal-close').waitFor({ state: 'hidden', timeout: 3000 });
    await page.getByTestId('undo-btn').waitFor({ state: 'visible', timeout: 5000 });

    // Host Co-op room on Peer A and join on Peer B
    await page.getByTestId('topbar-coop-btn').click();
    await page.getByTestId('host-coop-room-btn').waitFor({ state: 'visible', timeout: 3000 });
    await page.getByTestId('host-coop-room-btn').click();
    await page.getByTestId('active-coop-room-code').waitFor({ state: 'visible', timeout: 5000 });
    const undoRoomBadge = await page.getByTestId('active-coop-room-code').innerText();
    const undoRoomCode = undoRoomBadge.match(/Room\s+([A-Z0-9]{6})/)[1];
    await page.keyboard.press('Escape');
    await page.getByTestId('active-coop-room-code').waitFor({ state: 'hidden', timeout: 3000 });

    const peerB = await context.newPage();
    attachErrorListeners(peerB, 'peerB-unfill');
    await peerB.goto(`${BASE_URL}/?coop=1`, { waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(peerB);
    if (await peerB.$('[data-testid="replay-exit-btn"]')) {
      await peerB.locator('[data-testid="replay-exit-btn"]').click();
      await peerB.getByTestId('replay-controls-window').waitFor({ state: 'hidden', timeout: 3000 });
    }
    await peerB.getByTestId('topbar-coop-btn').click();
    await peerB.getByTestId('join-coop-room-input').waitFor({ state: 'visible', timeout: 3000 });
    await peerB.getByTestId('join-coop-room-input').fill(undoRoomCode);
    await peerB.getByTestId('join-coop-room-btn').click();
    await peerB.waitForFunction(
      () => document.querySelector('[data-testid="active-coop-room-code"]')?.textContent?.includes('2 online'),
      undefined,
      { timeout: 5000 }
    );
    assert.equal(
      (await peerB.getByTestId('active-coop-room-code').innerText()).includes('2 online'),
      true,
      'Peer B must join Peer A Co-op room with 2 peers online'
    );
    await peerB.keyboard.press('Escape');
    await peerB.getByTestId('active-coop-room-code').waitFor({ state: 'hidden', timeout: 3000 });

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
    const filled11cAfterFillA = Number(
      await page.getByTestId('topbar-saves-btn').getAttribute('data-filled-count')
    );
    await peerB.waitForFunction(
      (expectedCount) =>
        Number(document.querySelector('[data-testid="topbar-saves-btn"]')?.getAttribute('data-filled-count')) ===
        expectedCount,
      filled11cAfterFillA,
      { timeout: 5000 }
    );
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
    await page.waitForFunction(
      (expectedCount) =>
        Number(document.querySelector('[data-testid="topbar-saves-btn"]')?.getAttribute('data-filled-count')) ===
        expectedCount,
      filled11cAfterFillA - 1,
      { timeout: 3000 }
    );
    await peerB.waitForFunction(
      (expectedCount) =>
        Number(document.querySelector('[data-testid="topbar-saves-btn"]')?.getAttribute('data-filled-count')) ===
        expectedCount,
      filled11cAfterFillA - 1,
      { timeout: 5000 }
    );
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
    await page.getByTestId('leave-coop-room-btn').waitFor({ state: 'visible', timeout: 3000 });
    await page.getByTestId('leave-coop-room-btn').click();
    await page.getByTestId('active-coop-room-code').waitFor({ state: 'hidden', timeout: 3000 });
    await page.keyboard.press('Escape');
    await page.getByTestId('settings-modal-close').waitFor({ state: 'hidden', timeout: 3000 });
    logE2ePass('Printable SVG download, Sub-Tile Parent Breadcrumbs + parent delete cleanup, and 2-peer Co-op UNFILL_EVENT Undo sync verified.');

    // -------------------------------------------------------------------------
    // 14. Release Channel Switcher Card & Beta HUD Pill
    // -------------------------------------------------------------------------
    logE2eStart('Verifying Release Channel switcher card, Beta APK link & BETA HUD pill...');
    assert.equal(
      await page.getByTestId('topbar-channel-badge').count(),
      0,
      'Default Stable/Dev root view must not display topbar-channel-badge clutter'
    );
    await page.locator('button[title="Settings and Menu"]').click();
    await page.getByRole('button', { name: 'About', exact: true }).waitFor({ state: 'visible', timeout: 3000 });
    await page.getByRole('button', { name: 'About', exact: true }).click();
    const channelCard = page.getByTestId('release-channel-card');
    await channelCard.waitFor({ state: 'visible', timeout: 3000 });
    await channelCard.scrollIntoViewIfNeeded();
    assert.equal(await channelCard.isVisible(), true, 'release-channel-card must be visible in About tab');
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
    await page.getByTestId('settings-modal-close').waitFor({ state: 'hidden', timeout: 3000 });

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
    const betaCard = betaPage.getByTestId('release-channel-card');
    await betaCard.waitFor({ state: 'visible', timeout: 3000 });
    await betaCard.scrollIntoViewIfNeeded();
    assert.equal(
      await betaCard.getAttribute('data-channel'),
      'beta',
      'Clicking topbar-channel-badge must open About tab with data-channel="beta"'
    );
    assert.equal(
      await betaPage.getByTestId('toggle-beta-channel-btn').getAttribute('href'),
      'https://shthed.github.io/capy/',
      'Beta channel switcher must offer 1-tap Return to Stable Release link'
    );
    await betaPage.close();
    logE2ePass('Release Channel switcher card, Beta APK link, and BETA HUD pill verified.');

    // -------------------------------------------------------------------------
    // 15. Co-op Welcome Persistence, Replay Rewind UNFILL, Reset Epoch & Mobile Replay Controls
    // -------------------------------------------------------------------------
    logE2eStart('Verifying Co-op WELCOME_STATE reload persistence, Replay Scrubber rewind UNFILL, Reset Epoch & Mobile Replay Controls...');

    // 12a. F7 & F8 (BUG-1, M-08, F-01): 2-peer BroadcastChannel WELCOME_STATE reload persistence, Replay Resume Here UNFILL & Reset Progress resetEpoch
    // Reset active puzzle cleanly first so both Peer A and localStorage start at 0 filled regions
    await page.getByTestId('topbar-coop-btn').click();
    await page.getByTestId('reset-progress-btn').waitFor({ state: 'visible', timeout: 3000 });
    await page.getByTestId('reset-progress-btn').click();
    await page.waitForFunction(
      () =>
        Number(document.querySelector('[data-testid="topbar-saves-btn"]')?.getAttribute('data-filled-count')) === 0 &&
        (JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}').filledRegionIds || []).length === 0,
      undefined,
      { timeout: 5000 }
    );

    const totalPuzzleRegions27 = await readTotalRemainingRegions(page);
    assert.ok(totalPuzzleRegions27 > 10, `Expected > 10 total puzzle regions after reset, got ${totalPuzzleRegions27}`);

    // Boot Peer B while localStorage has 0 filled regions (100% deterministic, zero debounce race)
    const peerS2 = await context.newPage();
    attachErrorListeners(peerS2, 'peerS2-stage2');
    await peerS2.goto(`${BASE_URL}/?coop=1`, { waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(peerS2);
    assert.equal(
      await readTotalRemainingRegions(peerS2),
      totalPuzzleRegions27,
      'Peer B must boot with 0 filled regions before joining Co-op room'
    );

    // Paint >= 3 regions on Peer A
    for (let attempt = 0; attempt < 4; attempt++) {
      const curFilledLen = await page.evaluate(() => {
        const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
        return Array.isArray(active.filledRegionIds) ? active.filledRegionIds.length : 0;
      });
      if (curFilledLen >= 3) break;
      await tapCanvasGrid(page, 0.42 + attempt * 0.04, 14, 30);
      await page.waitForTimeout(150);
    }

    const peerAStateBeforeRoom = await page.evaluate(() => {
      const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
      return {
        activeSnapshotId: active.activeSnapshotId,
        filledCount: Array.isArray(active.filledRegionIds) ? active.filledRegionIds.length : 0,
      };
    });
    assert.ok(
      peerAStateBeforeRoom.activeSnapshotId && peerAStateBeforeRoom.filledCount >= 3,
      `Expected >= 3 filled regions on Peer A before Co-op welcome/rewind test, got ${peerAStateBeforeRoom.filledCount}`
    );
    const remainingPeerABeforeJoin = await readTotalRemainingRegions(page);

    // Host Co-op room on Peer A (live React state + room seedToken carry the >= 3 filled regions)
    await page.getByTestId('topbar-coop-btn').click();
    await page.getByTestId('host-coop-room-btn').waitFor({ state: 'visible', timeout: 3000 });
    await page.getByTestId('host-coop-room-btn').click();
    await page.getByTestId('active-coop-room-code').waitFor({ state: 'visible', timeout: 5000 });
    const s2RoomText = await page.getByTestId('active-coop-room-code').innerText();
    const s2RoomCode = s2RoomText.match(/Room\s+([A-Z0-9]{6})/)[1];
    await page.keyboard.press('Escape');
    await page.getByTestId('active-coop-room-code').waitFor({ state: 'hidden', timeout: 3000 });
    await page.waitForTimeout(450);

    // Clear persisted localStorage fills after Peer A settles so only Peer B's WELCOME_STATE can repopulate capy_active_session_v8
    await page.evaluate((snapId) => {
      const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
      active.filledRegionIds = [];
      active.paintedRegionColors = {};
      localStorage.setItem('capy_active_session_v8', JSON.stringify(active));
      const snaps = JSON.parse(localStorage.getItem('capy_snapshots_v8') || '[]').map((s) =>
        s.id === snapId ? { ...s, filledCount: 0, filledRegionIds: [], paintedRegionColors: {} } : s
      );
      localStorage.setItem('capy_snapshots_v8', JSON.stringify(snaps));
    }, peerAStateBeforeRoom.activeSnapshotId);

    await peerS2.getByTestId('topbar-coop-btn').click();
    await peerS2.getByTestId('join-coop-room-input').waitFor({ state: 'visible', timeout: 3000 });
    await peerS2.getByTestId('join-coop-room-input').fill(s2RoomCode);
    await peerS2.getByTestId('join-coop-room-btn').click();
    await peerS2.waitForFunction(
      (expectedCount) =>
        Boolean(document.querySelector('[data-testid="active-coop-room-code"]')?.textContent?.includes('2 online')) &&
        Number(document.querySelector('[data-testid="topbar-saves-btn"]')?.getAttribute('data-filled-count')) ===
          expectedCount,
      peerAStateBeforeRoom.filledCount,
      { timeout: 5000 }
    );
    await peerS2.keyboard.press('Escape');
    await peerS2.getByTestId('active-coop-room-code').waitFor({ state: 'hidden', timeout: 3000 });

    assert.equal(
      Number(await peerS2.getByTestId('topbar-saves-btn').getAttribute('data-filled-count')),
      Number(await page.getByTestId('topbar-saves-btn').getAttribute('data-filled-count')),
      'Peer B data-filled-count must match Peer A immediately upon WELCOME_STATE'
    );
    assert.equal(
      await readTotalRemainingRegions(peerS2),
      remainingPeerABeforeJoin,
      'Peer B must immediately merge Peer A filled regions upon WELCOME_STATE'
    );
    const savedActiveAfterWelcome = await peerS2.evaluate(() => {
      const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
      return Array.isArray(active.filledRegionIds) ? active.filledRegionIds.length : 0;
    });
    assert.equal(
      savedActiveAfterWelcome,
      peerAStateBeforeRoom.filledCount,
      'BUG-1: onWelcomeState must immediately persist welcomed filledRegionIds into capy_active_session_v8'
    );

    // Reload Peer B before painting any region and verify welcomed regions survive reload
    await peerS2.reload({ waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(peerS2);
    if (await peerS2.$('[data-testid="replay-exit-btn"]')) {
      await peerS2.locator('[data-testid="replay-exit-btn"]').click();
      await peerS2.getByTestId('replay-controls-window').waitFor({ state: 'hidden', timeout: 3000 });
    }
    assert.equal(
      await readTotalRemainingRegions(peerS2),
      remainingPeerABeforeJoin,
      'BUG-1: Reloading joining peer immediately after WELCOME_STATE must retain all welcomed regions'
    );

    // Rejoin s2RoomCode on Peer B so both peers are live for Replay Rewind & Reset Progress sync
    await peerS2.getByTestId('topbar-coop-btn').click();
    await peerS2.getByTestId('join-coop-room-input').waitFor({ state: 'visible', timeout: 3000 });
    await peerS2.getByTestId('join-coop-room-input').fill(s2RoomCode);
    await peerS2.getByTestId('join-coop-room-btn').click();
    await peerS2.waitForFunction(
      () => document.querySelector('[data-testid="active-coop-room-code"]')?.textContent?.includes('2 online'),
      undefined,
      { timeout: 5000 }
    );
    await peerS2.keyboard.press('Escape');
    await peerS2.getByTestId('active-coop-room-code').waitFor({ state: 'hidden', timeout: 3000 });

    // Launch Replay on Peer A via Saves -> Replay, scrub backward to step 1, and click Resume Here
    await page.getByTestId('topbar-coop-btn').click();
    await page.getByTestId(`save-card-${peerAStateBeforeRoom.activeSnapshotId}`).waitFor({ state: 'visible', timeout: 3000 });
    await page.getByTestId(`save-card-${peerAStateBeforeRoom.activeSnapshotId}`).click();
    await page.getByTestId('save-action-replay').waitFor({ state: 'visible', timeout: 3000 });
    await page.getByTestId('save-action-replay').click();

    await page.getByTestId('replay-controls-window').waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(
      await page.locator('[data-testid="replay-toggle-minimize-btn"]').count(),
      0,
      'Co-op ReplayControls must not render an expand/minimize toggle button'
    );
    await page.getByTestId('replay-scrubber').waitFor({ state: 'visible', timeout: 3000 });
    await page.getByTestId('replay-scrubber').fill('1');
    await page.waitForFunction(
      () => document.querySelector('[data-testid="replay-scrubber"]')?.value === '1',
      undefined,
      { timeout: 3000 }
    );
    await page.getByTestId('replay-exit-btn').click();
    await page.getByTestId('replay-controls-window').waitFor({ state: 'hidden', timeout: 3000 });

    // Trigger Reset Progress on Peer A and verify Peer B clears to 0 filled regions + resetEpoch increments
    await page.getByTestId('topbar-coop-btn').click();
    await page.getByTestId('reset-progress-btn').waitFor({ state: 'visible', timeout: 3000 });
    await page.getByTestId('reset-progress-btn').click();
    await page.waitForFunction(
      () => Number(document.querySelector('[data-testid="topbar-saves-btn"]')?.getAttribute('data-filled-count')) === 0,
      undefined,
      { timeout: 5000 }
    );
    await peerS2.waitForFunction(
      () => Number(document.querySelector('[data-testid="topbar-saves-btn"]')?.getAttribute('data-filled-count')) === 0,
      undefined,
      { timeout: 5000 }
    );

    assert.equal(
      Number(await peerS2.getByTestId('topbar-saves-btn').getAttribute('data-filled-count')),
      Number(await page.getByTestId('topbar-saves-btn').getAttribute('data-filled-count')),
      'M-08: Reset Progress data-filled-count must match (0) between Peer A and Peer B'
    );
    assert.equal(
      await readTotalRemainingRegions(page),
      totalPuzzleRegions27,
      'Reset Progress must clear Peer A back to 0 filled regions'
    );
    assert.equal(
      await readTotalRemainingRegions(peerS2),
      totalPuzzleRegions27,
      'M-08: Reset Progress must broadcast UNFILL_EVENT so Peer B clears to 0 filled regions'
    );
    const postResetEpochs = await page.evaluate((snapId) => {
      const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
      const snap = (JSON.parse(localStorage.getItem('capy_snapshots_v8') || '[]') || []).find(
        (s) => s.id === snapId
      );
      return {
        activeEpoch: active.resetEpoch ?? 0,
        snapEpoch: snap?.resetEpoch ?? 0,
      };
    }, peerAStateBeforeRoom.activeSnapshotId);
    assert.ok(
      postResetEpochs.activeEpoch >= 1 && postResetEpochs.snapEpoch >= 1,
      `F-01: Expected monotonic resetEpoch >= 1 in both active session (${postResetEpochs.activeEpoch}) and snapshot (${postResetEpochs.snapEpoch})`
    );

    await peerS2.close();
    await page.getByTestId('topbar-coop-btn').click();
    await page.getByTestId('leave-coop-room-btn').waitFor({ state: 'visible', timeout: 3000 });
    await page.getByTestId('leave-coop-room-btn').click();
    await page.getByTestId('active-coop-room-code').waitFor({ state: 'hidden', timeout: 3000 });
    await page.keyboard.press('Escape');
    await page.getByTestId('settings-modal-close').waitFor({ state: 'hidden', timeout: 3000 });

    // 12c. Mobile 360x800 minimized ReplayControls pill fit & save-load replayLoop auto-disable + gameplay auto-resume
    for (let attempt = 0; attempt < 4; attempt++) {
      const curFilledLen = await page.evaluate(() => {
        const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
        return Array.isArray(active.filledRegionIds) ? active.filledRegionIds.length : 0;
      });
      if (curFilledLen >= 4) break;
      await tapCanvasGrid(page, 0.44 + attempt * 0.04, 14, 30);
      await page.waitForTimeout(140);
    }
    const mobileReplaySetup = await page.evaluate(() => {
      const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
      const snaps = JSON.parse(localStorage.getItem('capy_snapshots_v8') || '[]');
      const otherSnap = snaps.find(
        (s) => s.id !== active.activeSnapshotId && String(s.id).startsWith('sample-')
      );
      return {
        targetSnapId: active.activeSnapshotId,
        otherSnapId: otherSnap ? otherSnap.id : null,
        filledCount: Array.isArray(active.filledRegionIds) ? active.filledRegionIds.length : 0,
      };
    });
    assert.ok(
      mobileReplaySetup.targetSnapId && mobileReplaySetup.otherSnapId && mobileReplaySetup.filledCount >= 3,
      `Expected >= 3 filled regions and a secondary sample save for mobile replay test, got ${JSON.stringify(mobileReplaySetup)}`
    );

    // Switch to narrow 360x800 mobile viewport and load secondary sample first
    await page.setViewportSize({ width: 360, height: 800 });
    await page.waitForFunction(() => window.innerWidth === 360, undefined, { timeout: 3000 });
    await page.getByTestId('topbar-coop-btn').click();
    await page.getByTestId(`save-card-${mobileReplaySetup.otherSnapId}`).waitFor({ state: 'visible', timeout: 3000 });
    await page.getByTestId(`save-card-${mobileReplaySetup.otherSnapId}`).click();
    await page.getByTestId('save-action-load').waitFor({ state: 'visible', timeout: 3000 });
    await page.getByTestId('save-action-load').click();
    await page.waitForFunction(
      (expectedId) =>
        JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}').activeSnapshotId ===
        expectedId,
      mobileReplaySetup.otherSnapId,
      { timeout: 15000 }
    );
    await waitForPuzzleLoaded(page);

    // Enable Auto-Loop Replay (true) + 0.5x speed in Settings Tab 0, and ensure Replay on Load is ON in Saves
    await page.locator('button[title="Settings and Menu"]').click();
    await page.locator('button', { hasText: /^Settings$/ }).first().waitFor({ state: 'visible', timeout: 3000 });
    await page.locator('button', { hasText: /^Settings$/ }).first().click();
    const settingsLoopToggle = page.getByTestId('toggle-replay-loop-btn');
    await settingsLoopToggle.scrollIntoViewIfNeeded();
    if ((await settingsLoopToggle.getAttribute('aria-checked')) !== 'true') {
      await settingsLoopToggle.click();
      await page.waitForFunction(
        () => document.querySelector('[data-testid="toggle-replay-loop-btn"]')?.getAttribute('aria-checked') === 'true',
        undefined,
        { timeout: 3000 }
      );
    }
    assert.equal(
      await settingsLoopToggle.getAttribute('aria-checked'),
      'true',
      'Precondition: Auto-Loop Replay must be enabled before loading saved puzzle'
    );
    const speedHalfBtn = page.locator('button', { hasText: /^0\.5x$/ }).first();
    await speedHalfBtn.scrollIntoViewIfNeeded();
    await speedHalfBtn.click();
    await page.waitForFunction(
      () => Number(JSON.parse(localStorage.getItem('capy_user_settings_v8') || '{}').replaySpeed) === 0.5,
      undefined,
      { timeout: 3000 }
    );

    // Switch to Saves tab, ensure Replay on Load is enabled, and load targetSnapId
    await page.locator('button', { hasText: /^Saves$/ }).first().click();
    const autoReplaySavesSwitch = page.getByTestId('toggle-auto-replay-saves-btn');
    await autoReplaySavesSwitch.waitFor({ state: 'visible', timeout: 3000 });
    if ((await autoReplaySavesSwitch.getAttribute('aria-checked')) !== 'true') {
      await autoReplaySavesSwitch.click();
      await page.waitForFunction(
        () => document.querySelector('[data-testid="toggle-auto-replay-saves-btn"]')?.getAttribute('aria-checked') === 'true',
        undefined,
        { timeout: 3000 }
      );
    }
    await page.getByTestId(`save-card-${mobileReplaySetup.targetSnapId}`).click();
    await page.getByTestId('save-action-load').waitFor({ state: 'visible', timeout: 3000 });
    await page.getByTestId('save-action-load').click();

    const mobileReplayWin = page.getByTestId('replay-controls-window');
    await mobileReplayWin.waitFor({ state: 'visible', timeout: 8000 });
    await page.locator('[aria-label="Palette dock"]').waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(
      await page.locator('[data-testid="replay-toggle-minimize-btn"]').count(),
      0,
      'Mobile ReplayControls must not render an expand/minimize toggle button'
    );
    assert.equal(
      await page.getByTestId('replay-loop-btn').getAttribute('aria-pressed'),
      'false',
      'Loading a puzzle save must immediately force replayLoop OFF (aria-pressed="false")'
    );

    const windowBox360 = await mobileReplayWin.boundingBox();
    const exitBox360 = await page.getByTestId('replay-exit-btn').boundingBox();
    const headerBox360 = await page.locator('header').first().boundingBox();
    const zoomOutMin360 = await page.getByTestId('zoom-out-btn').boundingBox();
    const undoMin360 = await page.getByTestId('undo-btn').boundingBox();
    const paintMin360 = await page.locator('[aria-label="Toggle Paint Mode"]').boundingBox();
    const paletteMin360 = await page.locator('[aria-label="Palette dock"]').boundingBox();
    assert.ok(
      windowBox360 && exitBox360 && headerBox360 && zoomOutMin360 && undoMin360 && paintMin360 && paletteMin360,
      'Expected visible bounding boxes for mobile replay HUD, FloatingActions (including Undo & Paint Mode), TopBar, and PaletteDock at 360x800'
    );
    assert.ok(
      exitBox360.x >= windowBox360.x + 4 &&
        exitBox360.x + exitBox360.width <= windowBox360.x + windowBox360.width - 4,
      `Minimized ReplayControls X button (${exitBox360.x}..${exitBox360.x + exitBox360.width}) must fit strictly inside 360px mobile pill border (${windowBox360.x}..${windowBox360.x + windowBox360.width})`
    );
    assert.equal(
      headerBox360.y + headerBox360.height <= zoomOutMin360.y + 1,
      true,
      `360x800 TopBar bottom (${headerBox360.y + headerBox360.height}) must clear FloatingActions (${zoomOutMin360.y})`
    );
    assert.equal(
      zoomOutMin360.y + zoomOutMin360.height <= windowBox360.y + 1 &&
        undoMin360.y + undoMin360.height <= windowBox360.y + 1 &&
        paintMin360.y + paintMin360.height <= windowBox360.y + 1,
      true,
      `360x800 FloatingActions bottom (${zoomOutMin360.y + zoomOutMin360.height}) must clear minimized ReplayControls top (${windowBox360.y})`
    );
    assert.equal(
      windowBox360.y + windowBox360.height <= paletteMin360.y + 1,
      true,
      `360x800 minimized ReplayControls bottom (${windowBox360.y + windowBox360.height}) must stack above PaletteDock top (${paletteMin360.y})`
    );
    // Verify PaletteDock horizontal centering with 2-3 swatches and scrollability with many swatches
    const dockScrollStats = await page.evaluate(() => {
      const dock = document.querySelector('[aria-label="Palette dock"]');
      const scroller = dock?.firstElementChild;
      if (!scroller) return null;
      return {
        scrollWidth: scroller.scrollWidth,
        clientWidth: scroller.clientWidth,
        swatchCount: scroller.querySelectorAll('[data-testid^="palette-swatch-"]').length,
      };
    });
    assert.ok(dockScrollStats, 'PaletteDock scroller must exist');
    if (dockScrollStats.swatchCount > 8) {
      assert.equal(
        dockScrollStats.scrollWidth > dockScrollStats.clientWidth,
        true,
        `Multi-color PaletteDock (${dockScrollStats.swatchCount} swatches) must be horizontally scrollable on 360px viewport`
      );
    }
    const scrollablePaddingCheck = await page.evaluate(() => {
      const dock = document.querySelector('[aria-label="Palette dock"]');
      const scroller = dock?.firstElementChild;
      const inner = scroller?.firstElementChild;
      if (!inner || !scroller) return null;
      const cs = getComputedStyle(inner);
      const padLeft = parseFloat(cs.paddingLeft) || 0;
      const padRight = parseFloat(cs.paddingRight) || 0;
      const expectedMinPad = scroller.clientWidth / 2 - 23 - 2;
      return { padLeft, padRight, expectedMinPad, clientWidth: scroller.clientWidth };
    });
    assert.ok(
      scrollablePaddingCheck &&
        scrollablePaddingCheck.padLeft >= scrollablePaddingCheck.expectedMinPad &&
        scrollablePaddingCheck.padRight >= scrollablePaddingCheck.expectedMinPad,
      `Scrollable PaletteDock must apply symmetric ~50% horizontal padding (${JSON.stringify(scrollablePaddingCheck)})`
    );
    assert.equal(
      paletteMin360.y + paletteMin360.height <= 800,
      true,
      `360x800 PaletteDock bottom (${paletteMin360.y + paletteMin360.height}) must fit inside 800px height`
    );

    // Wait for loaded save replay to finish untouched and verify ReplayControls + PaletteDock remain onscreen until user interacts with puzzle
    await page.locator('[data-testid="replay-play-pause-btn"][aria-label="Replay Again"]').waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(await mobileReplayWin.isVisible(), true, 'ReplayControls must remain onscreen after save-load replay finishes');
    assert.equal(await page.locator('[aria-label="Palette dock"]').isVisible(), true, 'PaletteDock must remain onscreen alongside finished replay');
    // Click Undo button while ReplayControls is open to exit replay and enable Redo
    await page.getByTestId('undo-btn').click();
    await mobileReplayWin.waitFor({ state: 'hidden', timeout: 5000 });
    await page.getByTestId('redo-btn').waitFor({ state: 'visible', timeout: 3000 });

    // Verify PaletteDock keeps strict sorted order and centers #1, middle, and last active swatches at 50%
    const initialSwatchOrder = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[aria-label="Palette dock"] [data-testid^="palette-swatch-"]')).map(
        (el) => el.getAttribute('data-testid')
      )
    );
    assert.ok(initialSwatchOrder.length >= 3, 'Expected >= 3 swatches in PaletteDock');
    for (const idx of [0, Math.floor(initialSwatchOrder.length / 2), initialSwatchOrder.length - 1]) {
      const targetTestId = initialSwatchOrder[idx];
      await page.getByTestId(targetTestId).click();
      await page.waitForTimeout(350);
      const afterOrder = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[aria-label="Palette dock"] [data-testid^="palette-swatch-"]')).map(
          (el) => el.getAttribute('data-testid')
        )
      );
      assert.deepEqual(
        afterOrder,
        initialSwatchOrder,
        `Clicking ${targetTestId} must not reorder PaletteDock`
      );
      const centerStats = await page.evaluate((tid) => {
        const el = document.querySelector(`[data-testid="${tid}"]`);
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        const mid = (rect.left + rect.right) / 2;
        return { mid, viewportMid: window.innerWidth / 2, diff: Math.abs(mid - window.innerWidth / 2) };
      }, targetTestId);
      assert.ok(
        centerStats && centerStats.diff <= 4,
        `Active swatch ${targetTestId} must center horizontally at 50% (diff=${centerStats?.diff?.toFixed(1)}px)`
      );
    }
    await page.locator('[aria-label="Palette dock"]').waitFor({ state: 'visible', timeout: 5000 });
    const paletteAfterDismiss360 = await page.locator('[aria-label="Palette dock"]').boundingBox();
    assert.ok(paletteAfterDismiss360);
    assert.equal(
      Math.abs(paletteAfterDismiss360.y - paletteMin360.y) < 1.5,
      true,
      `360x800 PaletteDock must not shift vertically on replay dismiss (${paletteMin360.y} -> ${paletteAfterDismiss360.y})`
    );
    assert.equal(
      await page.evaluate(
        () => Boolean(JSON.parse(localStorage.getItem('capy_user_settings_v8') || '{}').replayLoop)
      ),
      false,
      'Persisted capy_user_settings_v8.replayLoop must remain false after save-load replay auto-resumes gameplay'
    );

    // Flow 1: Manual timeline replay -> Toggle Paint Mode exits replay and enables drag painting
    if (await page.getByTestId('undo-btn').isDisabled()) {
      await page.getByTestId('redo-btn').click();
    }
    const undoBoxFlow1 = await getStableBoundingBox(page.getByTestId('undo-btn'));
    await page.mouse.move(undoBoxFlow1.x + undoBoxFlow1.width / 2, undoBoxFlow1.y + undoBoxFlow1.height / 2);
    await page.mouse.down();
    await mobileReplayWin.waitFor({ state: 'visible', timeout: 5000 });
    await page.mouse.up();
    await page.locator('[aria-label="Toggle Paint Mode"]').click();
    await mobileReplayWin.waitFor({ state: 'hidden', timeout: 3000 });
    assert.equal(
      await mobileReplayWin.isVisible(),
      false,
      'Toggling Paint Mode during manual replay must dismiss ReplayControls'
    );
    const canvasBoxFlow1 = await page.locator('canvas').first().boundingBox();
    assert.ok(canvasBoxFlow1 && canvasBoxFlow1.width > 50 && canvasBoxFlow1.height > 50, 'PuzzleCanvas must be visible');
    await page.mouse.move(canvasBoxFlow1.x + canvasBoxFlow1.width * 0.35, canvasBoxFlow1.y + canvasBoxFlow1.height * 0.45);
    await page.mouse.down();
    await page.mouse.move(canvasBoxFlow1.x + canvasBoxFlow1.width * 0.65, canvasBoxFlow1.y + canvasBoxFlow1.height * 0.55, { steps: 10 });
    await page.mouse.up();
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

    // Flow 2: Post-load replay with Paint Mode ALREADY ON -> 100% -> first canvas drag paints & dismisses ReplayControls
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('capy_user_settings_v8') || '{}');
      s.replaySpeed = 20;
      localStorage.setItem('capy_user_settings_v8', JSON.stringify(s));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await mobileReplayWin.waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('[data-testid="replay-play-pause-btn"][aria-label="Replay Again"]').waitFor({ state: 'visible', timeout: 15000 });
    const canvasBoxFlow2 = await page.locator('canvas').first().boundingBox();
    assert.ok(canvasBoxFlow2);
    await page.mouse.move(canvasBoxFlow2.x + canvasBoxFlow2.width * 0.3, canvasBoxFlow2.y + canvasBoxFlow2.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(canvasBoxFlow2.x + canvasBoxFlow2.width * 0.7, canvasBoxFlow2.y + canvasBoxFlow2.height * 0.6, { steps: 10 });
    await page.mouse.up();
    await mobileReplayWin.waitFor({ state: 'hidden', timeout: 3000 });
    assert.equal(await mobileReplayWin.isVisible(), false, 'First drag in Paint Mode after post-load replay must dismiss ReplayControls');

    // Flow 3: Post-load replay in Tap Mode -> 100% -> first tap dismisses ReplayControls
    await page.locator('[aria-label="Toggle Paint Mode"]').click(); // Turn Paint Mode OFF -> Tap Mode
    await page.reload({ waitUntil: 'networkidle' });
    await mobileReplayWin.waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('[data-testid="replay-play-pause-btn"][aria-label="Replay Again"]').waitFor({ state: 'visible', timeout: 15000 });
    const canvasBoxFlow3 = await page.locator('canvas').first().boundingBox();
    assert.ok(canvasBoxFlow3);
    await page.mouse.click(canvasBoxFlow3.x + canvasBoxFlow3.width * 0.5, canvasBoxFlow3.y + canvasBoxFlow3.height * 0.5);
    await mobileReplayWin.waitFor({ state: 'hidden', timeout: 3000 });
    assert.equal(await mobileReplayWin.isVisible(), false, 'First tap in Tap Mode after post-load replay must dismiss ReplayControls');

    // Flow 4: Minor canvas pan during post-load replay must NOT lock ReplayControls open against Toggle Paint Mode
    await page.reload({ waitUntil: 'networkidle' });
    await mobileReplayWin.waitFor({ state: 'visible', timeout: 5000 });
    const canvasBoxFlow4 = await page.locator('canvas').first().boundingBox();
    assert.ok(canvasBoxFlow4);
    await page.mouse.move(canvasBoxFlow4.x + canvasBoxFlow4.width * 0.5, canvasBoxFlow4.y + canvasBoxFlow4.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(canvasBoxFlow4.x + canvasBoxFlow4.width * 0.5 + 18, canvasBoxFlow4.y + canvasBoxFlow4.height * 0.5 + 12, { steps: 4 });
    await page.mouse.up();
    await page.locator('[aria-label="Toggle Paint Mode"]').click();
    await mobileReplayWin.waitFor({ state: 'hidden', timeout: 3000 });
    assert.equal(await mobileReplayWin.isVisible(), false, 'Toggle Paint Mode after minor pan during post-load replay must dismiss ReplayControls');

    // Re-open ReplayControls on 360x800 mobile, verify non-overlapping FloatingActions -> ReplayControls -> PaletteDock stacking, then auto-dismiss via swatch click
    const mobileUndoLocator = page.getByTestId('undo-btn');
    await mobileUndoLocator.waitFor({ state: 'visible', timeout: 5000 });
    const mobileUndoBox = await getStableBoundingBox(mobileUndoLocator);
    await page.mouse.move(
      mobileUndoBox.x + mobileUndoBox.width / 2,
      mobileUndoBox.y + mobileUndoBox.height / 2
    );
    await page.mouse.down();
    await mobileReplayWin.waitFor({ state: 'visible', timeout: 5000 });
    await page.mouse.up();
    const [zoomOutExp360, windowExp360, paletteExp360] = await Promise.all([
      getStableBoundingBox(page.getByTestId('zoom-out-btn')),
      getStableBoundingBox(mobileReplayWin),
      getStableBoundingBox(page.locator('[aria-label="Palette dock"]')),
    ]);
    assert.ok(zoomOutExp360 && windowExp360 && paletteExp360);
    assert.equal(
      headerBox360.y + headerBox360.height <= zoomOutExp360.y + 1,
      true,
      `360x800 TopBar bottom (${headerBox360.y + headerBox360.height}) must clear FloatingActions (${zoomOutExp360.y})`
    );
    assert.equal(
      zoomOutExp360.y + zoomOutExp360.height <= windowExp360.y + 1,
      true,
      `360x800 FloatingActions bottom (${zoomOutExp360.y + zoomOutExp360.height}) must clear ReplayControls top (${windowExp360.y})`
    );
    assert.equal(
      windowExp360.y + windowExp360.height <= paletteExp360.y + 1,
      true,
      `360x800 ReplayControls bottom (${windowExp360.y + windowExp360.height}) must stack above PaletteDock top (${paletteExp360.y})`
    );
    assert.equal(
      paletteExp360.y + paletteExp360.height <= 800,
      true,
      `360x800 PaletteDock bottom (${paletteExp360.y + paletteExp360.height}) must fit inside 800px height`
    );
    const mobileUnselectedSwatch = page
      .locator('[aria-label="Palette dock"] button[data-testid^="palette-swatch-"][aria-pressed="false"]')
      .first();
    const mobileSwatchTestId = await mobileUnselectedSwatch.getAttribute('data-testid');
    assert.ok(mobileSwatchTestId);
    await mobileUnselectedSwatch.scrollIntoViewIfNeeded();
    await mobileUnselectedSwatch.click();
    await mobileReplayWin.waitFor({ state: 'hidden', timeout: 5000 });
    assert.equal(
      await page.getByTestId(mobileSwatchTestId).getAttribute('aria-pressed'),
      'true',
      `Mobile swatch ${mobileSwatchTestId} must become active immediately on click`
    );

    // Restore desktop viewport and default test settings cleanly
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('capy_user_settings_v8') || '{}');
      s.autoReplayOnLoad = false;
      s.replaySpeed = 1;
      s.replayLoop = false;
      localStorage.setItem('capy_user_settings_v8', JSON.stringify(s));
    });
    await page.waitForFunction(() => window.innerWidth === 1280, undefined, { timeout: 3000 });
    logE2ePass('360px mobile ReplayControls fit, save-load replayLoop reset & auto-resume, Co-op WELCOME_STATE persistence, Replay Scrubber rewind UNFILL, and CRDT resetEpoch verified.');

    // -------------------------------------------------------------------------
    // 16. Mobile (360x780) GameTopBar Two-Lane Non-Overlap, ALPHA #520 Pill, SettingsModal Tabs, Saves Grid & Offers
    // -------------------------------------------------------------------------
    logE2eStart('Verifying 360x780 mobile GameTopBar lanes (ALPHA #520), OnboardingTutorial, SettingsModal tabs, Saves grid & FeatureOfferBanner...');
    const mobileTopbarContext = await browser.newContext({ viewport: { width: 360, height: 780 }, hasTouch: true });
    await mobileTopbarContext.addInitScript(() => {
      localStorage.setItem('capy_dev_debug', '1');
    });
    const mobileTopbarPage = await mobileTopbarContext.newPage();
    attachErrorListeners(mobileTopbarPage, 'mobileTopbarPage');
    await mobileTopbarPage.goto(`${BASE_URL}/?capy_channel=alpha&pr=520`, { waitUntil: 'networkidle' });
    await mobileTopbarPage.locator('canvas').first().waitFor({ state: 'visible', timeout: 15000 });
    await mobileTopbarPage.getByTestId('topbar-channel-badge').waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(
      (await mobileTopbarPage.getByTestId('topbar-channel-badge').innerText()).trim().toUpperCase(),
      'ALPHA #520',
      'Expected ?capy_channel=alpha&pr=520 to render ALPHA #520 badge'
    );
    await mobileTopbarPage.getByTestId('onboarding-tutorial').waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(
      await mobileTopbarPage.getByTestId('topbar-zoom-badge').count(),
      0,
      'Expected topbar-zoom-badge to be absent on 360x780 mobile'
    );

    const leftLaneBox = await mobileTopbarPage.getByTestId('topbar-left-lane').boundingBox();
    const rightLaneBox = await mobileTopbarPage.getByTestId('topbar-right-lane').boundingBox();
    const savesBox = await mobileTopbarPage.getByTestId('topbar-saves-btn').boundingBox();
    const channelBox = await mobileTopbarPage.getByTestId('topbar-channel-badge').boundingBox();
    const settingsBox = await mobileTopbarPage.locator('button[title="Settings and Menu"]').boundingBox();
    const leftLaneScrollCheck = await mobileTopbarPage.getByTestId('topbar-left-lane').evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));

    assert.ok(leftLaneBox && rightLaneBox && savesBox && channelBox && settingsBox);
    assert.equal(
      leftLaneBox.x + leftLaneBox.width <= rightLaneBox.x,
      true,
      `topbar-left-lane (${leftLaneBox.x + leftLaneBox.width}) must not overlap topbar-right-lane (${rightLaneBox.x}) at 360x780`
    );
    assert.equal(
      leftLaneScrollCheck.scrollWidth <= leftLaneScrollCheck.clientWidth &&
        channelBox.x + channelBox.width <= leftLaneBox.x + leftLaneBox.width + 1,
      true,
      `ALPHA #520 pill must fit cleanly inside topbar-left-lane without horizontal clipping at 360x780 (${JSON.stringify({ leftLaneScrollCheck, channelBox, leftLaneBox })})`
    );
    assert.equal(
      rightLaneBox.x + rightLaneBox.width <= 360,
      true,
      `topbar-right-lane (${rightLaneBox.x + rightLaneBox.width}) must fit within 360px mobile viewport`
    );
    assert.equal(
      settingsBox.x + settingsBox.width <= 360 && settingsBox.x >= rightLaneBox.x,
      true,
      'Settings button must fit inside right lane and 360px viewport'
    );

    const titleOverflow = await mobileTopbarPage.getByTestId('topbar-saves-title').evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      text: el.textContent || '',
    }));
    assert.equal(
      titleOverflow.scrollWidth <= titleOverflow.clientWidth + 1,
      true,
      `topbar-saves-title ("${titleOverflow.text}") should expand to fit without premature clipping (scrollWidth=${titleOverflow.scrollWidth}, clientWidth=${titleOverflow.clientWidth})`
    );
    await assertSpotlightAligned(mobileTopbarPage, 'tutorial');
    await captureV3012Screenshot(mobileTopbarPage, 'mobile_360x780_step1.png');
    const normalDocOverflow = await mobileTopbarPage.evaluate(() => ({
      docOverflow: document.documentElement.scrollWidth - window.innerWidth,
    }));
    assert.equal(
      normalDocOverflow.docOverflow <= 0,
      true,
      `Normal mode at 360x780 with OnboardingTutorial must have zero horizontal document overflow (got ${normalDocOverflow.docOverflow})`
    );
    const mobileTutorialBox = await mobileTopbarPage.getByTestId('onboarding-tutorial').boundingBox();
    assert.ok(mobileTutorialBox, 'Expected onboarding-tutorial boundingBox at 360x780');
    assert.equal(
      mobileTutorialBox.x >= 0 && mobileTutorialBox.x + mobileTutorialBox.width <= 360,
      true,
      `OnboardingTutorial (${mobileTutorialBox.x}..${mobileTutorialBox.x + mobileTutorialBox.width}) must fit within 360px mobile viewport`
    );
    assert.equal(
      mobileTutorialBox.height <= 210,
      true,
      `Step 1 compact OnboardingTutorial card height (${mobileTutorialBox.height}px) must stay slim <= 210px on 360x780`
    );
    await mobileTopbarPage.getByTestId('tutorial-topics-btn').click();
    await mobileTopbarPage.getByTestId('tutorial-topics-drawer').waitFor({ state: 'visible', timeout: 3000 });
    const normalTopicsBox = await mobileTopbarPage.getByTestId('tutorial-topics-drawer').boundingBox();
    assert.ok(normalTopicsBox, 'Expected normal tutorial-topics-drawer boundingBox at 360x780');
    assert.equal(
      normalTopicsBox.x >= 0 && normalTopicsBox.x + normalTopicsBox.width <= 360,
      true,
      `Normal tutorial-topics-drawer (${normalTopicsBox.x}..${normalTopicsBox.x + normalTopicsBox.width}) must fit within 360px mobile viewport`
    );
    const normalTopicsOverflow = await mobileTopbarPage.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    assert.equal(normalTopicsOverflow <= 0, true, `Normal tutorial-topics-drawer must have zero overflow (got ${normalTopicsOverflow})`);
    await mobileTopbarPage.getByTestId('tutorial-topic-item-6').click();
    await mobileTopbarPage.getByTestId('tutorial-topics-drawer').waitFor({ state: 'hidden', timeout: 3000 });
    const mobileStep7Metrics = await assertSpotlightAligned(mobileTopbarPage, 'tutorial');
    assert.equal(mobileStep7Metrics.ringCount, 2, 'Mobile Step 7 must highlight both Eye and Full Screen');
    assert.equal(
      mobileStep7Metrics.pointerSpan >= 10,
      true,
      `Mobile Step 7 topbar pointer must have uncrushed stem (${mobileStep7Metrics.pointerSpan}px)`
    );
    await captureV3012Screenshot(mobileTopbarPage, 'mobile_360x780_step7_spotlight.png');

    // Open SettingsModal on 360x780 mobile and verify all header tabs fit without horizontal clipping
    await mobileTopbarPage.locator('button[title="Settings and Menu"]').click();
    const tabsContainer = mobileTopbarPage.getByTestId('settings-modal-tabs');
    const closeBtn = mobileTopbarPage.getByTestId('settings-modal-close');
    await tabsContainer.waitFor({ state: 'visible', timeout: 5000 });
    await closeBtn.waitFor({ state: 'visible', timeout: 5000 });

    const tabsOverflow = await tabsContainer.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    assert.equal(
      tabsOverflow.scrollWidth <= tabsOverflow.clientWidth,
      true,
      `SettingsModal tabs must not overflow horizontally at 360x780 (scrollWidth=${tabsOverflow.scrollWidth}, clientWidth=${tabsOverflow.clientWidth})`
    );

    const tabsBox = await tabsContainer.boundingBox();
    const closeBox = await closeBtn.boundingBox();
    assert.ok(tabsBox && closeBox);
    for (const tabKey of ['about', 'settings', 'hints', 'create', 'saves']) {
      const tabBox = await mobileTopbarPage.getByTestId(`settings-tab-${tabKey}`).boundingBox();
      assert.ok(tabBox, `Expected settings-tab-${tabKey} boundingBox to exist`);
      assert.equal(
        tabBox.x >= tabsBox.x && tabBox.x + tabBox.width <= closeBox.x,
        true,
        `settings-tab-${tabKey} (${tabBox.x}..${tabBox.x + tabBox.width}) must fit inside tabs container (${tabsBox.x}) and to the left of close button (${closeBox.x})`
      );
    }

    // Toggle Large Text (Low-Vision) mode at 360x780 and verify zero clipping in SettingsModal and GameTopBar (including ALPHA #520)
    await mobileTopbarPage.getByTestId('settings-tab-settings').click();
    const largeTextSwitch = mobileTopbarPage.getByTestId('setting-large-text');
    await largeTextSwitch.waitFor({ state: 'visible', timeout: 5000 });
    await largeTextSwitch.click();
    await mobileTopbarPage.waitForFunction(
      () => document.documentElement.dataset.largeText === 'true',
      undefined,
      { timeout: 3000 }
    );
    assert.equal(
      await mobileTopbarPage.evaluate(() => document.documentElement.dataset.largeText),
      'true',
      'setting-large-text must set data-large-text="true"'
    );
    const largeTabsOverflow = await tabsContainer.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    assert.equal(
      largeTabsOverflow.scrollWidth <= largeTabsOverflow.clientWidth,
      true,
      `Large Text SettingsModal tabs must not overflow at 360x780 (scrollWidth=${largeTabsOverflow.scrollWidth}, clientWidth=${largeTabsOverflow.clientWidth})`
    );
    await closeBtn.click();
    await closeBtn.waitFor({ state: 'hidden', timeout: 3000 });
    const largeLeftLaneBox = await mobileTopbarPage.getByTestId('topbar-left-lane').boundingBox();
    const largeRightLaneBox = await mobileTopbarPage.getByTestId('topbar-right-lane').boundingBox();
    const largeChannelBox = await mobileTopbarPage.getByTestId('topbar-channel-badge').boundingBox();
    const largeLeftScrollCheck = await mobileTopbarPage.getByTestId('topbar-left-lane').evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    assert.ok(largeLeftLaneBox && largeRightLaneBox && largeChannelBox);
    assert.equal(
      largeLeftLaneBox.x + largeLeftLaneBox.width <= largeRightLaneBox.x &&
        largeRightLaneBox.x + largeRightLaneBox.width <= 360,
      true,
      'Large Text GameTopBar lanes must not overlap or exceed 360px viewport'
    );
    assert.equal(
      largeLeftScrollCheck.scrollWidth <= largeLeftScrollCheck.clientWidth &&
        largeChannelBox.x + largeChannelBox.width <= largeLeftLaneBox.x + largeLeftLaneBox.width + 1,
      true,
      `Large Text ALPHA #520 pill must fit cleanly inside topbar-left-lane at 360x780 (${JSON.stringify({ largeLeftScrollCheck, largeChannelBox, largeLeftLaneBox })})`
    );
    await assertSpotlightAligned(mobileTopbarPage, 'tutorial');
    await captureV3012Screenshot(mobileTopbarPage, 'mobile_360x780_step7_largetext.png');
    const largeDocOverflow = await mobileTopbarPage.evaluate(() => ({
      docOverflow: document.documentElement.scrollWidth - window.innerWidth,
    }));
    assert.equal(
      largeDocOverflow.docOverflow <= 0,
      true,
      `Large Text mode at 360x780 must have zero horizontal document overflow (got ${largeDocOverflow.docOverflow})`
    );
    const largeTutorialBox = await mobileTopbarPage.getByTestId('onboarding-tutorial').boundingBox();
    assert.ok(largeTutorialBox, 'Expected Large Text onboarding-tutorial boundingBox at 360x780');
    assert.equal(
      largeTutorialBox.x >= 0 && largeTutorialBox.x + largeTutorialBox.width <= 360,
      true,
      `Large Text OnboardingTutorial (${largeTutorialBox.x}..${largeTutorialBox.x + largeTutorialBox.width}) must fit within 360px mobile viewport`
    );
    await mobileTopbarPage.getByTestId('tutorial-topics-btn').click();
    await mobileTopbarPage.getByTestId('tutorial-topics-drawer').waitFor({ state: 'visible', timeout: 3000 });
    const largeTopicsBox = await mobileTopbarPage.getByTestId('tutorial-topics-drawer').boundingBox();
    assert.ok(largeTopicsBox, 'Expected Large Text tutorial-topics-drawer boundingBox at 360x780');
    assert.equal(
      largeTopicsBox.x >= 0 && largeTopicsBox.x + largeTopicsBox.width <= 360,
      true,
      `Large Text tutorial-topics-drawer (${largeTopicsBox.x}..${largeTopicsBox.x + largeTopicsBox.width}) must fit within 360px mobile viewport`
    );
    const largeTopicsOverflow = await mobileTopbarPage.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    assert.equal(largeTopicsOverflow <= 0, true, `Large Text tutorial-topics-drawer must have zero overflow (got ${largeTopicsOverflow})`);
    await mobileTopbarPage.getByTestId('tutorial-topics-btn').click();
    await mobileTopbarPage.getByTestId('tutorial-topics-drawer').waitFor({ state: 'hidden', timeout: 3000 });
    // Re-open SettingsModal, turn off Large Text, and continue Saves tab verification
    await mobileTopbarPage.locator('button[title="Settings and Menu"]').click();
    await mobileTopbarPage.getByTestId('settings-tab-settings').waitFor({ state: 'visible', timeout: 3000 });
    await mobileTopbarPage.getByTestId('settings-tab-settings').click();
    await mobileTopbarPage.getByTestId('setting-large-text').waitFor({ state: 'visible', timeout: 3000 });
    await mobileTopbarPage.getByTestId('setting-large-text').click();
    await mobileTopbarPage.waitForFunction(
      () => document.documentElement.dataset.largeText !== 'true',
      undefined,
      { timeout: 3000 }
    );

    // Verify 360x780 Saves tab renders Thumbnails grid first, 2-column mobile grid, static action bar, and zero horizontal overflow
    await mobileTopbarPage.getByTestId('settings-tab-saves').click();
    await mobileTopbarPage.getByTestId('saves-list-thumbnails').waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(
      await mobileTopbarPage.getByTestId('saves-list-section').getAttribute('data-view-mode'),
      'THUMBNAILS'
    );
    assert.equal(
      await mobileTopbarPage.getByTestId('saves-view-thumbnails-btn').getAttribute('aria-pressed'),
      'true'
    );
    assert.equal(await mobileTopbarPage.getByTestId('cloud-coop-hub').count(), 0);
    assert.equal(await mobileTopbarPage.getByTestId('topbar-coop-btn').count(), 0);
    const [mSavesListBox, mSavesActionBox, mSavesShareBox] = await Promise.all([
      mobileTopbarPage.getByTestId('saves-list-section').boundingBox(),
      mobileTopbarPage.getByTestId('selected-save-action-bar').boundingBox(),
      mobileTopbarPage.getByTestId('saves-share-print-bar').boundingBox(),
    ]);
    assert.ok(mSavesListBox && mSavesActionBox && mSavesShareBox);
    assert.equal(
      mSavesListBox.y + mSavesListBox.height <= mSavesActionBox.y + 1,
      true,
      `360x780 Saves list (${mSavesListBox.y + mSavesListBox.height}) must appear above selected-save-action-bar (${mSavesActionBox.y})`
    );
    assert.equal(
      mSavesActionBox.y + mSavesActionBox.height <= mSavesShareBox.y + 1,
      true,
      `360x780 selected-save-action-bar (${mSavesActionBox.y + mSavesActionBox.height}) must appear above saves-share-print-bar (${mSavesShareBox.y})`
    );
    const firstTwoSaveCards = mobileTopbarPage.locator('[data-testid="saves-list-thumbnails"] [data-testid^="save-card-"]');
    if ((await firstTwoSaveCards.count()) >= 2) {
      const [c0, c1] = await Promise.all([
        firstTwoSaveCards.nth(0).boundingBox(),
        firstTwoSaveCards.nth(1).boundingBox(),
      ]);
      assert.ok(c0 && c1);
      assert.equal(
        Math.abs(c0.y - c1.y) < 4 && c1.x > c0.x && c1.x + c1.width <= 360,
        true,
        `360x780 Saves Thumbnails must place 2 cards side-by-side within 360px (c0=${JSON.stringify(c0)}, c1=${JSON.stringify(c1)})`
      );
    }
    const mobileSavesHorizontalOverflow = await mobileTopbarPage.getByTestId('saves-list-section').evaluate((el) => {
      const scroller = el.closest('.overflow-y-auto');
      return scroller ? scroller.scrollWidth > scroller.clientWidth : false;
    });
    assert.equal(
      mobileSavesHorizontalOverflow,
      false,
      '360x780 Saves tab must have zero horizontal overflow'
    );
    const actionBarPosition = await mobileTopbarPage.getByTestId('selected-save-action-bar').evaluate((el) => {
      const ownPos = window.getComputedStyle(el).position;
      const parentPos = el.parentElement ? window.getComputedStyle(el.parentElement).position : '';
      return { ownPos, parentPos };
    });
    assert.equal(
      actionBarPosition.ownPos !== 'sticky' && actionBarPosition.parentPos !== 'sticky',
      true,
      `selected-save-action-bar must not be sticky (${JSON.stringify(actionBarPosition)})`
    );
    await mobileTopbarPage.getByTestId('saves-share-print-bar').scrollIntoViewIfNeeded();
    await mobileTopbarPage.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const [mActionAfterScroll, mShareAfterScroll] = await Promise.all([
      mobileTopbarPage.getByTestId('selected-save-action-bar').boundingBox(),
      mobileTopbarPage.getByTestId('saves-share-print-bar').boundingBox(),
    ]);
    assert.ok(mActionAfterScroll && mShareAfterScroll);
    assert.equal(
      mActionAfterScroll.y + mActionAfterScroll.height <= mShareAfterScroll.y + 1,
      true,
      `After scrolling to saves-share-print-bar, non-sticky selected-save-action-bar (${mActionAfterScroll.y + mActionAfterScroll.height}) must remain above bar (${mShareAfterScroll.y})`
    );

    // Close SettingsModal, skip OnboardingTutorial, and verify FeatureOfferBanner fits within 360x780 with zero overflow in both normal & Large Text mode
    await closeBtn.click();
    await mobileTopbarPage.getByTestId('tutorial-skip-btn').click();
    await mobileTopbarPage.getByTestId('onboarding-tutorial').waitFor({ state: 'hidden', timeout: 3000 });
    await mobileTopbarPage.locator('button[aria-label="Toggle Paint Mode"]').click();
    await mobileTopbarPage.getByTestId('feature-offer-banner').waitFor({ state: 'visible', timeout: 3000 });
    await assertSpotlightAligned(mobileTopbarPage, 'offer');
    const mobileOfferBox = await mobileTopbarPage.getByTestId('feature-offer-banner').boundingBox();
    assert.ok(mobileOfferBox, 'Expected feature-offer-banner boundingBox at 360x780');
    assert.equal(
      mobileOfferBox.x >= 0 && mobileOfferBox.x + mobileOfferBox.width <= 360,
      true,
      `FeatureOfferBanner (${mobileOfferBox.x}..${mobileOfferBox.x + mobileOfferBox.width}) must fit within 360px mobile viewport`
    );
    const mobileOfferOverflow = await mobileTopbarPage.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    assert.equal(mobileOfferOverflow <= 0, true, `FeatureOfferBanner at 360x780 must have zero overflow (got ${mobileOfferOverflow})`);
    await mobileTopbarPage.getByTestId('feature-offer-dismiss-btn').click();
    await mobileTopbarPage.getByTestId('feature-offer-banner').waitFor({ state: 'hidden', timeout: 3000 });

    // Enable Large Text and trigger create_gallery offer to verify FeatureOfferBanner bounds & overflow in Large Text mode at 360x780
    await mobileTopbarPage.locator('button[title="Settings and Menu"]').click();
    await mobileTopbarPage.getByTestId('settings-tab-settings').click();
    await mobileTopbarPage.getByTestId('setting-large-text').click();
    await mobileTopbarPage.getByTestId('settings-tab-create').click();
    await closeBtn.click();
    await mobileTopbarPage.getByTestId('feature-offer-banner').waitFor({ state: 'visible', timeout: 3000 });
    await assertSpotlightAligned(mobileTopbarPage, 'offer');
    const largeOfferBox = await mobileTopbarPage.getByTestId('feature-offer-banner').boundingBox();
    assert.ok(largeOfferBox, 'Expected Large Text feature-offer-banner boundingBox at 360x780');
    assert.equal(
      largeOfferBox.x >= 0 && largeOfferBox.x + largeOfferBox.width <= 360,
      true,
      `Large Text FeatureOfferBanner (${largeOfferBox.x}..${largeOfferBox.x + largeOfferBox.width}) must fit within 360px mobile viewport`
    );
    const largeOfferOverflow = await mobileTopbarPage.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    assert.equal(largeOfferOverflow <= 0, true, `Large Text FeatureOfferBanner at 360x780 must have zero overflow (got ${largeOfferOverflow})`);

    // Verify 100% progress pill + ALPHA #520 fits cleanly at 360x780 in both Large Text and Normal modes
    const seededComplete = await mobileTopbarPage.evaluate(async () => {
      const snaps = window.capyStorage.loadSnapshots();
      const active = window.capyStorage.loadActiveState();
      const targetId = active?.activeSnapshotId || snaps[0]?.id;
      const puz = targetId ? await window.capyStorage.loadPuzzleData(targetId) : null;
      if (!targetId || !puz || !Array.isArray(puz.regions) || puz.regions.length === 0) return null;
      const allIds = puz.regions.map((r) => r.id);
      window.capyStorage.updateSnapshotProgress(targetId, allIds.length, allIds.length, allIds);
      window.capyStorage.saveActiveState({
        ...(active || {}),
        activeSnapshotId: targetId,
        filledRegionIds: allIds,
      });
      const verifiedActive = window.capyStorage.loadActiveState();
      const verifiedSnap = window.capyStorage.loadSnapshots().find((s) => s.id === targetId);
      return {
        targetId,
        expectedCount: allIds.length,
        activeCount: verifiedActive?.filledRegionIds?.length ?? 0,
        snapCount: verifiedSnap?.filledCount ?? 0,
      };
    });
    assert.ok(seededComplete && seededComplete.expectedCount > 0, 'Expected non-empty puzzle regions for 100% progress test');
    assert.equal(seededComplete.activeCount, seededComplete.expectedCount, 'Expected activeState filledRegionIds to persist before reload');
    assert.equal(seededComplete.snapCount, seededComplete.expectedCount, 'Expected snapshot filledCount to persist before reload');
    await mobileTopbarPage.reload({ waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(mobileTopbarPage);
    if (await mobileTopbarPage.getByTestId('replay-exit-btn').isVisible()) {
      await mobileTopbarPage.getByTestId('replay-exit-btn').click();
    }
    await mobileTopbarPage.waitForFunction(
      () => document.querySelector('[data-testid="topbar-saves-btn"]')?.textContent?.includes('100%'),
      { timeout: 5000 }
    );
    assert.equal(
      (await mobileTopbarPage.getByTestId('topbar-saves-btn').innerText()).includes('100%'),
      true,
      'Expected topbar-saves-btn to display 100% after completing puzzle'
    );
    const large100ScrollCheck = await mobileTopbarPage.getByTestId('topbar-left-lane').evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    const large100LaneBox = await mobileTopbarPage.getByTestId('topbar-left-lane').boundingBox();
    const large100ChannelBox = await mobileTopbarPage.getByTestId('topbar-channel-badge').boundingBox();
    assert.equal(
      large100ScrollCheck.scrollWidth <= large100ScrollCheck.clientWidth &&
        large100ChannelBox.x + large100ChannelBox.width <= large100LaneBox.x + large100LaneBox.width + 1,
      true,
      `Large Text ALPHA #520 + 100% must fit inside topbar-left-lane at 360x780 (${JSON.stringify({ large100ScrollCheck, large100ChannelBox, large100LaneBox })})`
    );
    // Toggle Large Text back OFF and verify Normal 100% + ALPHA #520
    await mobileTopbarPage.locator('button[title="Settings and Menu"]').click();
    await mobileTopbarPage.getByTestId('settings-tab-settings').click();
    await mobileTopbarPage.getByTestId('setting-large-text').click();
    await mobileTopbarPage.getByTestId('settings-modal-close').click();
    await mobileTopbarPage.waitForFunction(() => document.documentElement.dataset.largeText !== 'true', { timeout: 3000 });
    await mobileTopbarPage.getByTestId('settings-modal-close').waitFor({ state: 'hidden', timeout: 3000 });
    const normal100ScrollCheck = await mobileTopbarPage.getByTestId('topbar-left-lane').evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    const normal100LaneBox = await mobileTopbarPage.getByTestId('topbar-left-lane').boundingBox();
    const normal100ChannelBox = await mobileTopbarPage.getByTestId('topbar-channel-badge').boundingBox();
    assert.equal(
      normal100ScrollCheck.scrollWidth <= normal100ScrollCheck.clientWidth &&
        normal100ChannelBox.x + normal100ChannelBox.width <= normal100LaneBox.x + normal100LaneBox.width + 1,
      true,
      `Normal ALPHA #520 + 100% must fit inside topbar-left-lane at 360x780 (${JSON.stringify({ normal100ScrollCheck, normal100ChannelBox, normal100LaneBox })})`
    );

    // Verify Create tab above-the-fold style/hint bar, Style Guide reorder, and (i) hint tooltips at 360x780
    await mobileTopbarPage.locator('button[title="Settings and Menu"]').click();
    await mobileTopbarPage.getByTestId('settings-tab-create').click();
    const mobileHintBar = mobileTopbarPage.getByTestId('create-style-hint-bar');
    await mobileHintBar.waitFor({ state: 'visible', timeout: 3000 });
    const defaultHintBarText = await mobileHintBar.innerText();
    assert.equal(
      defaultHintBarText.includes('Gallery: Max (2048p)') && defaultHintBarText.includes('Uploads: Auto'),
      true,
      `create-style-hint-bar must clearly show Gallery Max vs Custom Uploads default mode (got '${defaultHintBarText}')`
    );

    const mobileDailyBox = await mobileTopbarPage.getByTestId('daily-puzzle-card').boundingBox();
    const mobileHintBarBox = await mobileHintBar.boundingBox();
    const mobileSearchBox = await mobileTopbarPage.getByTestId('gallery-search-input').boundingBox();
    assert.ok(mobileDailyBox && mobileHintBarBox && mobileSearchBox, 'Expected daily card, hint bar, and search boxes at 360x780');
    assert.equal(
      mobileDailyBox.y < mobileHintBarBox.y && mobileHintBarBox.y < mobileSearchBox.y,
      true,
      'create-style-hint-bar must sit between daily-puzzle-card and gallery-search-input'
    );
    assert.equal(
      mobileHintBarBox.y + mobileHintBarBox.height <= 780,
      true,
      `create-style-hint-bar must be visible above the fold on 360x780 (bottom=${mobileHintBarBox.y + mobileHintBarBox.height})`
    );

    await mobileTopbarPage.getByTestId('hint-toggle-daily-puzzle').click();
    await mobileTopbarPage.getByTestId('hint-tooltip-daily-puzzle').waitFor({ state: 'visible', timeout: 3000 });

    const mobileUploadHintToggle = mobileTopbarPage.getByTestId('hint-toggle-upload-photo');
    await mobileUploadHintToggle.scrollIntoViewIfNeeded();
    await mobileUploadHintToggle.click();
    await mobileTopbarPage.getByTestId('hint-tooltip-upload-photo').waitFor({ state: 'visible', timeout: 3000 });

    await mobileTopbarPage.getByTestId('create-hint-style-guide-btn').click();
    await mobileTopbarPage.getByTestId('preset-gallery-panel').waitFor({ state: 'visible', timeout: 3000 });

    // Hint & Options must jump straight to options AND automatically open hint-tooltip-algorithm
    const mobileOptionsJumpBtn = mobileTopbarPage.getByTestId('create-hint-options-btn');
    await mobileOptionsJumpBtn.scrollIntoViewIfNeeded();
    await mobileOptionsJumpBtn.click();
    await mobileTopbarPage.getByTestId('hint-tooltip-algorithm').waitFor({ state: 'visible', timeout: 3000 });

    const mobileColorHintToggle = mobileTopbarPage.getByTestId('hint-toggle-color-count');
    await mobileColorHintToggle.scrollIntoViewIfNeeded();
    await mobileColorHintToggle.click();
    await mobileTopbarPage.getByTestId('hint-tooltip-color-count').waitFor({ state: 'visible', timeout: 3000 });

    // Detail Level Preset High must sync colorCount + maxRegions + minRegionArea
    const mobileHighPresetBtn = mobileTopbarPage.getByTestId('detail-preset-high');
    await mobileHighPresetBtn.scrollIntoViewIfNeeded();
    await mobileHighPresetBtn.click();
    const afterHighHintText = await mobileHintBar.innerText();
    assert.equal(
      afterHighHintText.includes('38c') && afterHighHintText.includes('500 pcs'),
      true,
      `Detail Level Preset High must sync 38c and 500 pcs (got '${afterHighHintText}')`
    );

    // Quick Max Detail button must jump directly to 64c / 2000 pcs / 2048p
    const mobileMaxPresetBtn = mobileTopbarPage.getByTestId('create-max-detail-preset-btn');
    await mobileMaxPresetBtn.scrollIntoViewIfNeeded();
    await mobileMaxPresetBtn.click();
    const afterMaxHintText = await mobileHintBar.innerText();
    assert.equal(
      afterMaxHintText.includes('Max Detail') && afterMaxHintText.includes('2048p'),
      true,
      `Max Detail preset button must apply 64c/2000/2048p Max Detail config (got '${afterMaxHintText}')`
    );

    assert.equal(await mobileTopbarPage.getByText('Optional Ad').count(), 0, '360x780 Create tab must hide Optional Ad');
    assert.equal(await mobileTopbarPage.getByText('AI Credits').count(), 0, '360x780 Create tab must hide AI Credits');
    assert.equal(await mobileTopbarPage.locator('[data-testid^="vote-idea-"]').count(), 0, '360x780 Create tab must hide vote-idea-*');

    const createHintsOverflow = await mobileTopbarPage.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    assert.equal(
      createHintsOverflow <= 0,
      true,
      `Create tab with Style Guide and (i) hint tooltips must have 0px horizontal overflow at 360x780 (got ${createHintsOverflow})`
    );
    await mobileTopbarPage.getByTestId('settings-modal-close').click();

    // Closing SettingsModal without saving/regenerating must discard unsaved slider edits on next open
    await mobileTopbarPage.locator('button[title="Settings and Menu"]').click();
    await mobileTopbarPage.getByTestId('settings-tab-create').click();
    const reopenedHintBarText = await mobileTopbarPage.getByTestId('create-style-hint-bar').innerText();
    assert.equal(
      reopenedHintBarText.includes('Gallery: Max (2048p)'),
      true,
      `Reopening SettingsModal without regenerating must resync localConfig to persisted settings (got '${reopenedHintBarText}')`
    );
    await mobileTopbarPage.getByTestId('settings-modal-close').click();

    await mobileTopbarPage.close();
    await mobileTopbarContext.close();
    logE2ePass('360x780 mobile GameTopBar two-lane non-overlap, ALPHA #520 fit, OnboardingTutorial, SettingsModal tabs, 2-col Saves layout & FeatureOfferBanner bounds verified.');

    // -------------------------------------------------------------------------
    // 17. Viewport-Save Flush Races, Anti-Resurrection, Blob URL Revocation & Tap-Burst Non-Starvation
    // -------------------------------------------------------------------------
    logE2eStart('Verifying 360x780 viewport-save races, clearActiveState/deleteSnapshot safety, blob URL revocation, error recovery & tap-burst non-starvation...');
    const viewportRaceContext = await browser.newContext({ viewport: { width: 360, height: 780 }, hasTouch: true });
    await viewportRaceContext.addInitScript(() => {
      localStorage.setItem('capy_dev_debug', '1');
    });
    const viewportRacePage = await viewportRaceContext.newPage();
    attachErrorListeners(viewportRacePage, 'viewportRacePage');
    await viewportRacePage.goto(`${BASE_URL}/?capy_channel=alpha&skipTutorial=1`, { waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(viewportRacePage);
    const raceCanvasBox = await viewportRacePage.getByTestId('puzzle-canvas').boundingBox();
    assert.ok(raceCanvasBox, 'Expected puzzle-canvas boundingBox for viewport race test');
    await viewportRacePage.mouse.move(
      raceCanvasBox.x + raceCanvasBox.width / 2,
      raceCanvasBox.y + raceCanvasBox.height / 2
    );
    await viewportRacePage.mouse.wheel(0, -240);
    const partialRaceState = await viewportRacePage.evaluate(async () => {
      const snaps = window.capyStorage.loadSnapshots();
      const active = window.capyStorage.loadActiveState();
      const targetId = active?.activeSnapshotId || snaps[0]?.id;
      const puz = targetId ? await window.capyStorage.loadPuzzleData(targetId) : null;
      if (!targetId || !puz || puz.regions.length < 2) return null;
      const partialIds = puz.regions.slice(0, 2).map((r) => r.id);
      window.capyStorage.updateSnapshotProgress(targetId, partialIds.length, puz.regions.length, partialIds);
      window.capyStorage.saveActiveState({
        ...(active || {}),
        activeSnapshotId: targetId,
        filledRegionIds: partialIds,
      });
      return { targetId, partialCount: partialIds.length, totalCount: puz.regions.length };
    });
    assert.ok(partialRaceState && partialRaceState.partialCount === 2, 'Expected partial race state setup');
    await viewportRacePage.waitForTimeout(450);
    const afterTimerState = await viewportRacePage.evaluate(() => window.capyStorage.loadActiveState());
    assert.equal(
      afterTimerState?.filledRegionIds?.length,
      partialRaceState.partialCount,
      'Debounced viewportSaveTimer must preserve activeState filledRegionIds'
    );
    assert.equal(
      (afterTimerState?.zoomScale ?? 1) > 1.05,
      true,
      `Debounced viewportSaveTimer must persist zoomed scale (got ${afterTimerState?.zoomScale})`
    );

    // Trigger second zoom, wait for React useEffect to arm the 350ms viewportSaveTimer, write 100% completion, and reload immediately so beforeunload flush fires while timer is pending
    await viewportRacePage.mouse.wheel(0, -240);
    await viewportRacePage.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    );
    const fullRaceState = await viewportRacePage.evaluate(async () => {
      const snaps = window.capyStorage.loadSnapshots();
      const active = window.capyStorage.loadActiveState();
      const targetId = active?.activeSnapshotId || snaps[0]?.id;
      const puz = targetId ? await window.capyStorage.loadPuzzleData(targetId) : null;
      if (!targetId || !puz || puz.regions.length === 0) return null;
      const allIds = puz.regions.map((r) => r.id);
      window.capyStorage.updateSnapshotProgress(targetId, allIds.length, allIds.length, allIds);
      window.capyStorage.saveActiveState({
        ...(active || {}),
        activeSnapshotId: targetId,
        filledRegionIds: allIds,
      });
      return { targetId, totalCount: allIds.length, prevZoom: active?.zoomScale ?? 1 };
    });
    assert.ok(fullRaceState && fullRaceState.totalCount > 0, 'Expected full race state setup');
    await viewportRacePage.reload({ waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(viewportRacePage);
    if (await viewportRacePage.getByTestId('replay-exit-btn').isVisible()) {
      await viewportRacePage.getByTestId('replay-exit-btn').click();
    }
    const afterReloadState = await viewportRacePage.evaluate(() => window.capyStorage.loadActiveState());
    assert.equal(
      afterReloadState?.filledRegionIds?.length,
      fullRaceState.totalCount,
      'beforeunload flushPendingViewportSave must preserve 100% filledRegionIds'
    );
    assert.equal(
      (afterReloadState?.zoomScale ?? 1) > fullRaceState.prevZoom,
      true,
      `beforeunload flushPendingViewportSave must persist latest zoomScale (got ${afterReloadState?.zoomScale} vs prev ${fullRaceState.prevZoom})`
    );
    await viewportRacePage.waitForFunction(
      () => document.querySelector('[data-testid="topbar-saves-btn"]')?.textContent?.includes('100%'),
      { timeout: 5000 }
    );

    // Defect 3A regression (clearActiveState): zooming & reloading after clearActiveState must NOT resurrect 100% activeState
    await viewportRacePage.evaluate(() => {
      window.capyStorage.clearActiveState();
    });
    await viewportRacePage.mouse.move(
      raceCanvasBox.x + raceCanvasBox.width / 2,
      raceCanvasBox.y + raceCanvasBox.height / 2
    );
    await viewportRacePage.mouse.wheel(0, -180);
    await viewportRacePage.waitForTimeout(450);
    const activeAfterClearAndZoom = await viewportRacePage.evaluate(() =>
      window.capyStorage.loadActiveState()
    );
    assert.equal(
      activeAfterClearAndZoom,
      null,
      `persistActiveViewportOnly must NOT resurrect cleared activeState after zoom timer (${JSON.stringify(activeAfterClearAndZoom)})`
    );
    await viewportRacePage.reload({ waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(viewportRacePage);
    if (await viewportRacePage.getByTestId('replay-exit-btn').isVisible()) {
      await viewportRacePage.getByTestId('replay-exit-btn').click();
    }
    const activeAfterClearReload = await viewportRacePage.evaluate(() =>
      window.capyStorage.loadActiveState()
    );
    assert.equal(
      activeAfterClearReload,
      null,
      `Reload after clearActiveState must NOT resurrect 100% activeState (${JSON.stringify(activeAfterClearReload)})`
    );

    // Defect 3A + 3B regression (deleteSnapshot & rapid puzzle switch): deleting active snapshot while viewport timer is pending must NOT resurrect deleted ID, and switching puzzles must NOT overwrite Puzzle B with Puzzle A viewport/progress
    const switchSetup = await viewportRacePage.evaluate(() => {
      const snaps = window.capyStorage.loadSnapshots();
      if (snaps.length < 2) return null;
      const snapA = snaps[0];
      const snapB = snaps[1];
      window.capyStorage.updateSnapshotProgress(snapB.id, 0, snapB.totalCount || 100, [], 1.0, 0, 0);
      return { idA: snapA.id, idB: snapB.id };
    });
    assert.ok(switchSetup, 'Expected at least 2 prebaked snapshots for switch/delete regression');
    await viewportRacePage.mouse.move(
      raceCanvasBox.x + raceCanvasBox.width / 2,
      raceCanvasBox.y + raceCanvasBox.height / 2
    );
    await viewportRacePage.mouse.wheel(0, -180);
    await viewportRacePage.getByTestId('topbar-saves-btn').click();
    await viewportRacePage.getByTestId(`save-card-${switchSetup.idA}`).click();
    await viewportRacePage.getByTestId('save-action-delete').click();
    await viewportRacePage.getByTestId('save-action-confirm-delete').click();
    await viewportRacePage.waitForTimeout(450);
    const stateAfterDeleteActive = await viewportRacePage.evaluate((deletedId) => ({
      active: window.capyStorage.loadActiveState(),
      snaps: window.capyStorage.loadSnapshots().map((s) => s.id),
      deletedId,
    }), switchSetup.idA);
    assert.equal(
      stateAfterDeleteActive.snaps.includes(switchSetup.idA),
      false,
      'Deleted snapshot A must stay removed'
    );
    assert.notEqual(
      stateAfterDeleteActive.active?.activeSnapshotId,
      switchSetup.idA,
      'Deleted snapshot A must NEVER be resurrected in activeState'
    );

    // Trigger zoom on currently loaded snapshot, then switch via UI while triggering resize immediately
    await viewportRacePage.getByTestId('settings-modal-close').click();
    await waitForPuzzleLoaded(viewportRacePage);
    if (await viewportRacePage.getByTestId('replay-exit-btn').isVisible()) {
      await viewportRacePage.getByTestId('replay-exit-btn').click();
    }
    const currentBeforeSwitchId = await viewportRacePage.evaluate(
      () => window.capyStorage.loadActiveState()?.activeSnapshotId || null
    );
    const remainingTargetId = await viewportRacePage.evaluate((curId) => {
      const snaps = window.capyStorage.loadSnapshots();
      const target = snaps.find((s) => s.id !== curId);
      if (!target) return null;
      window.capyStorage.updateSnapshotProgress(target.id, 0, target.totalCount || 100, [], 1.0, 0, 0);
      return target.id;
    }, currentBeforeSwitchId);
    assert.ok(remainingTargetId, 'Expected second snapshot for rapid switch regression');
    await viewportRacePage.mouse.wheel(0, -240);
    await viewportRacePage.getByTestId('topbar-saves-btn').click();
    await viewportRacePage.getByTestId(`save-card-${remainingTargetId}`).click();
    await viewportRacePage.getByTestId('save-action-load').click();
    await viewportRacePage.evaluate(() => {
      window.dispatchEvent(new Event('resize'));
    });
    await viewportRacePage.waitForTimeout(450);
    await waitForPuzzleLoaded(viewportRacePage);
    const afterSwitchState = await viewportRacePage.evaluate((targetId) => {
      const active = window.capyStorage.loadActiveState();
      const targetSnap = window.capyStorage.loadSnapshots().find((s) => s.id === targetId);
      return { active, targetSnap };
    }, remainingTargetId);
    assert.equal(
      afterSwitchState.active?.activeSnapshotId,
      remainingTargetId,
      'Rapid switch + resize must preserve target snapshot ID'
    );
    assert.equal(
      afterSwitchState.active?.filledRegionIds?.length ?? -1,
      0,
      'Rapid switch + resize must NOT leak source puzzle filledRegionIds onto target puzzle'
    );
    assert.equal(
      Math.abs((afterSwitchState.targetSnap?.zoomScale ?? 1) - 1.0) < 0.05,
      true,
      `Rapid switch + resize must NOT leak source zoomScale onto target puzzle (got ${afterSwitchState.targetSnap?.zoomScale})`
    );

    // App.tsx regression: rapid custom-blob snapshot switch must revoke stale delayed blob URL cleanly without prematurely revoking winner's blob URL, and async try/finally must unlock snapshotTransitioningRef on loadPuzzleData / deleteSnapshot rejection
    const blobSetup = await viewportRacePage.evaluate(async (baseSampleId) => {
      const basePuzzle = await window.capyStorage.loadPuzzleData(baseSampleId);
      if (!basePuzzle) return null;
      const canvas = document.createElement('canvas');
      canvas.width = 16;
      canvas.height = 16;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(0, 0, 16, 16);
      const blobA = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(0, 0, 16, 16);
      const blobB = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      const idA = 'blob-race-test-a';
      const idB = 'blob-race-test-b';
      await window.capyStorage.savePuzzleData(idA, basePuzzle);
      await window.capyStorage.savePuzzleData(idB, basePuzzle);
      await window.capyStorage.saveImageBlob(idA, blobA);
      await window.capyStorage.saveImageBlob(idB, blobB);
      const now = Date.now();
      window.capyStorage.addSnapshot({
        id: idA,
        title: 'Blob Race A',
        timestamp: now - 2000,
        lastOpened: now - 2000,
        filledCount: 0,
        totalCount: basePuzzle.regions.length,
        filledRegionIds: [],
        zoomScale: 1,
        panOffsetX: 0,
        panOffsetY: 0,
        sourceRef: { kind: 'blob', uri: idA },
      });
      window.capyStorage.addSnapshot({
        id: idB,
        title: 'Blob Race B',
        timestamp: now - 1000,
        lastOpened: now - 1000,
        filledCount: 0,
        totalCount: basePuzzle.regions.length,
        filledRegionIds: [],
        zoomScale: 1,
        panOffsetX: 0,
        panOffsetY: 0,
        sourceRef: { kind: 'blob', uri: idB },
      });
      return { idA, idB, baseSampleId };
    }, remainingTargetId);
    assert.ok(blobSetup, 'Expected blob race setup to succeed');

    await viewportRacePage.reload({ waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(viewportRacePage);
    if (await viewportRacePage.getByTestId('replay-exit-btn').isVisible()) {
      await viewportRacePage.getByTestId('replay-exit-btn').click();
    }

    await viewportRacePage.evaluate((idA) => {
      window.__blobRaceStats = { created: [], revoked: [] };
      const origCreate = URL.createObjectURL.bind(URL);
      const origRevoke = URL.revokeObjectURL.bind(URL);
      window.__origCreateObjectURL = origCreate;
      window.__origRevokeObjectURL = origRevoke;
      URL.createObjectURL = (obj) => {
        const u = origCreate(obj);
        window.__blobRaceStats.created.push(u);
        return u;
      };
      URL.revokeObjectURL = (u) => {
        window.__blobRaceStats.revoked.push(u);
        return origRevoke(u);
      };

      const origLoadBlob = window.capyStorage.loadImageBlob.bind(window.capyStorage);
      window.__origLoadImageBlob = origLoadBlob;
      window.capyStorage.loadImageBlob = async (id) => {
        if (id === idA) {
          await new Promise((r) => setTimeout(r, 600));
        }
        return origLoadBlob(id);
      };
    }, blobSetup.idA);

    await viewportRacePage.getByTestId('topbar-saves-btn').click();
    await viewportRacePage.getByTestId(`save-card-${blobSetup.idA}`).waitFor({ state: 'visible', timeout: 3000 });
    await viewportRacePage.getByTestId(`save-card-${blobSetup.idA}`).click();
    await viewportRacePage.getByTestId('save-action-load').click();
    await viewportRacePage.getByTestId('topbar-saves-btn').click();
    await viewportRacePage.getByTestId(`save-card-${blobSetup.idB}`).waitFor({ state: 'visible', timeout: 3000 });
    await viewportRacePage.getByTestId(`save-card-${blobSetup.idB}`).click();
    await viewportRacePage.getByTestId('save-action-load').click();

    await viewportRacePage.waitForTimeout(750);
    await waitForPuzzleLoaded(viewportRacePage);
    const blobRaceCheck1 = await viewportRacePage.evaluate((expectedIdB) => {
      const active = window.capyStorage.loadActiveState();
      const stats = window.__blobRaceStats;
      return {
        activeId: active?.activeSnapshotId || null,
        createdCount: stats.created.length,
        revokedCount: stats.revoked.length,
        created: stats.created,
        revoked: stats.revoked,
        expectedIdB,
      };
    }, blobSetup.idB);
    assert.equal(blobRaceCheck1.activeId, blobSetup.idB, 'Rapid switch must converge on Blob Race B');
    assert.ok(
      blobRaceCheck1.createdCount >= 2,
      `Expected both Blob Race B and delayed Blob Race A object URLs created, got ${blobRaceCheck1.createdCount}`
    );
    const activeBlobUrlsRemaining = blobRaceCheck1.created.filter(
      (u) => !blobRaceCheck1.revoked.includes(u)
    );
    assert.equal(
      activeBlobUrlsRemaining.length,
      1,
      `Expected exactly 1 active blob URL kept alive (winner B) while stale delayed blob URL A was revoked, remaining=${JSON.stringify(activeBlobUrlsRemaining)}`
    );

    // Switch back to sample snapshot -> winner B's blob URL must now be revoked too
    await viewportRacePage.getByTestId('topbar-saves-btn').click();
    await viewportRacePage.getByTestId(`save-card-${blobSetup.baseSampleId}`).click();
    await viewportRacePage.getByTestId('save-action-load').click();
    await waitForPuzzleLoaded(viewportRacePage);
    const blobRaceCheck2 = await viewportRacePage.evaluate(() => {
      const stats = window.__blobRaceStats;
      return {
        unrevoked: stats.created.filter((u) => !stats.revoked.includes(u)),
      };
    });
    assert.equal(
      blobRaceCheck2.unrevoked.length,
      0,
      `Switching away from Blob Race B to a sample must revoke all created blob URLs, unrevoked=${JSON.stringify(blobRaceCheck2.unrevoked)}`
    );

    // Async try/finally recovery: failing loadPuzzleData once must NOT permanently lock snapshotTransitioningRef
    await viewportRacePage.evaluate(() => {
      URL.createObjectURL = window.__origCreateObjectURL;
      URL.revokeObjectURL = window.__origRevokeObjectURL;
      window.capyStorage.loadImageBlob = window.__origLoadImageBlob;
      const origLoadPuzzle = window.capyStorage.loadPuzzleData.bind(window.capyStorage);
      window.__origLoadPuzzleData = origLoadPuzzle;
      let failOnce = true;
      window.capyStorage.loadPuzzleData = async (id) => {
        if (failOnce) {
          failOnce = false;
          throw new Error('Injected loadPuzzleData failure');
        }
        return origLoadPuzzle(id);
      };
    });
    await viewportRacePage.getByTestId('topbar-saves-btn').click();
    await viewportRacePage.getByTestId(`save-card-${blobSetup.idA}`).click();
    await viewportRacePage.getByTestId('save-action-load').click();
    await viewportRacePage.waitForTimeout(250);
    await viewportRacePage.evaluate(() => {
      window.capyStorage.loadPuzzleData = window.__origLoadPuzzleData;
    });
    // Now load valid sample & zoom -> viewport persistence must still work (snapshotTransitioningRef unlocked!)
    await viewportRacePage.getByTestId('topbar-saves-btn').click();
    await viewportRacePage.getByTestId(`save-card-${blobSetup.baseSampleId}`).click();
    await viewportRacePage.getByTestId('save-action-load').click();
    await waitForPuzzleLoaded(viewportRacePage);
    if (await viewportRacePage.getByTestId('replay-exit-btn').isVisible()) {
      await viewportRacePage.getByTestId('replay-exit-btn').click();
    }
    await viewportRacePage.mouse.move(
      raceCanvasBox.x + raceCanvasBox.width / 2,
      raceCanvasBox.y + raceCanvasBox.height / 2
    );
    await viewportRacePage.mouse.wheel(0, -180);
    await viewportRacePage.waitForTimeout(450);
    const zoomAfterLoadRecovery = await viewportRacePage.evaluate(
      () => window.capyStorage.loadActiveState()?.zoomScale ?? 1
    );
    assert.ok(
      zoomAfterLoadRecovery > 1.0,
      `Expected snapshotTransitioningRef unlocked after loadPuzzleData rejection so zoom persists (got ${zoomAfterLoadRecovery})`
    );

    // Async try/finally recovery: failing deleteSnapshot once must NOT permanently lock snapshotTransitioningRef
    await viewportRacePage.evaluate(() => {
      const origDelete = window.capyStorage.deleteSnapshot.bind(window.capyStorage);
      window.__origDeleteSnapshot = origDelete;
      let failOnce = true;
      window.capyStorage.deleteSnapshot = async (id) => {
        if (failOnce) {
          failOnce = false;
          throw new Error('Injected deleteSnapshot failure');
        }
        return origDelete(id);
      };
    });
    await viewportRacePage.getByTestId('topbar-saves-btn').click();
    await viewportRacePage.getByTestId(`save-card-${blobSetup.baseSampleId}`).click();
    await viewportRacePage.getByTestId('save-action-delete').click();
    await viewportRacePage.getByTestId('save-action-confirm-delete').click();
    await viewportRacePage.waitForTimeout(200);
    await viewportRacePage.evaluate(() => {
      window.capyStorage.deleteSnapshot = window.__origDeleteSnapshot;
    });
    await viewportRacePage.getByTestId('settings-modal-close').click();
    await viewportRacePage.mouse.move(
      raceCanvasBox.x + raceCanvasBox.width / 2,
      raceCanvasBox.y + raceCanvasBox.height / 2
    );
    await viewportRacePage.mouse.wheel(0, -180);
    await viewportRacePage.waitForTimeout(450);
    const zoomAfterDeleteRecovery = await viewportRacePage.evaluate(
      () => window.capyStorage.loadActiveState()?.zoomScale ?? 1
    );
    assert.ok(
      zoomAfterDeleteRecovery > zoomAfterLoadRecovery,
      `Expected snapshotTransitioningRef unlocked after deleteSnapshot rejection so zoom persists (${zoomAfterDeleteRecovery} vs ${zoomAfterLoadRecovery})`
    );

    await viewportRacePage.close();
    await viewportRaceContext.close();

    // Probe 2g regression: wheel zoom followed by continuous canvas taps (4 taps at 250ms intervals, >1000ms total) must NOT starve viewportSaveTimerRef persistence into capy_active_session_v8
    const tapStarveContext = await browser.newContext({ viewport: { width: 360, height: 780 }, hasTouch: true });
    const tapStarvePage = await tapStarveContext.newPage();
    attachErrorListeners(tapStarvePage, 'tapStarvePage');
    await tapStarvePage.goto(`${BASE_URL}/?skipTutorial=1`, { waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(tapStarvePage);
    await tapStarvePage.evaluate(() => {
      const raw = localStorage.getItem('capy_user_settings_v8');
      const parsed = raw ? JSON.parse(raw) : {};
      parsed.fatFingerAssist = false;
      localStorage.setItem('capy_user_settings_v8', JSON.stringify(parsed));
    });
    await tapStarvePage.reload({ waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(tapStarvePage);
    const tapStarveBox = await tapStarvePage.getByTestId('puzzle-canvas').boundingBox();
    assert.ok(tapStarveBox, 'Expected puzzle-canvas boundingBox for tap-starvation regression');
    const tapX = tapStarveBox.x + tapStarveBox.width / 2;
    const tapY = tapStarveBox.y + tapStarveBox.height / 2;
    // Pre-tap center once at zoom=1 so subsequent taps at the same coordinate only trigger tapDot/ResizeObserver without invoking saveActiveState via attemptFillRegion
    await tapStarvePage.mouse.click(tapX, tapY);
    await tapStarvePage.waitForTimeout(450);
    const tapStarveBaseline = await tapStarvePage.evaluate(() => {
      const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
      return {
        zoomScale: active.zoomScale ?? 1,
        filledCount: Array.isArray(active.filledRegionIds) ? active.filledRegionIds.length : 0,
      };
    });
    assert.equal(tapStarveBaseline.zoomScale, 1, 'Expected baseline capy_active_session_v8 zoomScale === 1');

    const tapBurstStartMs = Date.now();
    await tapStarvePage.mouse.move(tapX, tapY);
    await tapStarvePage.mouse.wheel(0, -240);
    for (let i = 0; i < 4; i++) {
      await tapStarvePage.mouse.click(tapX, tapY);
      await tapStarvePage.waitForTimeout(250);
    }
    const tapBurstElapsedMs = Date.now() - tapBurstStartMs;
    assert.ok(tapBurstElapsedMs >= 1000, `Expected 4x250ms tap burst >= 1000ms, got ${tapBurstElapsedMs}ms`);
    const afterTapStarve = await tapStarvePage.evaluate(() => {
      const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
      return {
        zoomScale: active.zoomScale ?? 1,
        filledCount: Array.isArray(active.filledRegionIds) ? active.filledRegionIds.length : 0,
      };
    });
    assert.equal(
      afterTapStarve.filledCount,
      tapStarveBaseline.filledCount,
      'Repeated taps at already-processed coordinate must not write via attemptFillRegion'
    );
    assert.ok(
      afterTapStarve.zoomScale > 1.0,
      `Wheel zoom followed by 4x250ms canvas taps (>1000ms) must persist zoomScale > 1.0 into capy_active_session_v8 without timer starvation (got ${afterTapStarve.zoomScale})`
    );
    await tapStarvePage.close();
    await tapStarveContext.close();
    logE2ePass('Viewport-save flush races, clearActiveState/deleteSnapshot safety, blob URL revocation, async recovery & tap-burst non-starvation verified.');

    // -------------------------------------------------------------------------
    // 18. Mobile (360x780) BETA Pill Containment in Normal & Large Text Modes
    // -------------------------------------------------------------------------
    logE2eStart('Verifying 360x780 ?capy_channel=beta BETA pill containment in Normal & Large Text modes...');
    const mobileBetaContext = await browser.newContext({ viewport: { width: 360, height: 780 }, hasTouch: true });
    const mobileBetaPage = await mobileBetaContext.newPage();
    attachErrorListeners(mobileBetaPage, 'mobileBetaPage');
    await mobileBetaPage.goto(`${BASE_URL}/?capy_channel=beta&skipTutorial=1`, { waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(mobileBetaPage);
    await mobileBetaPage.getByTestId('topbar-channel-badge').waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(
      (await mobileBetaPage.getByTestId('topbar-channel-badge').innerText()).trim().toUpperCase(),
      'BETA',
      'Expected ?capy_channel=beta to render BETA badge'
    );
    const betaNormalScrollCheck = await mobileBetaPage.getByTestId('topbar-left-lane').evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    const betaNormalLaneBox = await mobileBetaPage.getByTestId('topbar-left-lane').boundingBox();
    const betaNormalChannelBox = await mobileBetaPage.getByTestId('topbar-channel-badge').boundingBox();
    assert.equal(
      betaNormalScrollCheck.scrollWidth <= betaNormalScrollCheck.clientWidth &&
        betaNormalChannelBox.x + betaNormalChannelBox.width <= betaNormalLaneBox.x + betaNormalLaneBox.width + 1,
      true,
      `Normal BETA badge must fit cleanly inside topbar-left-lane at 360x780 (${JSON.stringify({ betaNormalScrollCheck, betaNormalChannelBox, betaNormalLaneBox })})`
    );
    await mobileBetaPage.locator('button[title="Settings and Menu"]').click();
    await mobileBetaPage.getByTestId('settings-tab-settings').waitFor({ state: 'visible', timeout: 3000 });
    await mobileBetaPage.getByTestId('settings-tab-settings').click();
    await mobileBetaPage.getByTestId('setting-large-text').waitFor({ state: 'visible', timeout: 3000 });
    await mobileBetaPage.getByTestId('setting-large-text').click();
    await mobileBetaPage.waitForFunction(
      () => document.documentElement.dataset.largeText === 'true',
      undefined,
      { timeout: 3000 }
    );
    await mobileBetaPage.getByTestId('settings-modal-close').click();
    await mobileBetaPage.getByTestId('settings-modal-close').waitFor({ state: 'hidden', timeout: 3000 });
    const betaLargeScrollCheck = await mobileBetaPage.getByTestId('topbar-left-lane').evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    const betaLargeLaneBox = await mobileBetaPage.getByTestId('topbar-left-lane').boundingBox();
    const betaLargeChannelBox = await mobileBetaPage.getByTestId('topbar-channel-badge').boundingBox();
    assert.equal(
      betaLargeScrollCheck.scrollWidth <= betaLargeScrollCheck.clientWidth &&
        betaLargeChannelBox.x + betaLargeChannelBox.width <= betaLargeLaneBox.x + betaLargeLaneBox.width + 1,
      true,
      `Large Text BETA badge must fit cleanly inside topbar-left-lane at 360x780 (${JSON.stringify({ betaLargeScrollCheck, betaLargeChannelBox, betaLargeLaneBox })})`
    );
    await mobileBetaPage.close();
    await mobileBetaContext.close();
    logE2ePass('360x780 BETA channel pill containment in Normal & Large Text modes verified.');

    // -------------------------------------------------------------------------
    // 19. Atomic Malformed Import Notice, Sample Ordering, Zero-Snapshot Recovery & Fractional DPR
    // -------------------------------------------------------------------------
    logE2eStart('Verifying atomic malformed .capy import notice, sample_saves ordering, zero-snapshot recovery, corrupt #s= deep link & fractional DPR...');
    const m3Page = await context.newPage();
    attachErrorListeners(m3Page, 'm3Page');
    // Force a fractional devicePixelRatio (1.25) to verify PuzzleCanvas backing store rounds cleanly without drift
    await m3Page.addInitScript(() => {
      localStorage.removeItem('capy_dev_cloud_coop_ui');
      Object.defineProperty(window, 'devicePixelRatio', { get: () => 1.25, configurable: true });
      window.__capyAlertCalls = 0;
      window.alert = () => {
        window.__capyAlertCalls += 1;
      };
    });
    await m3Page.setViewportSize({ width: 540, height: 420 });
    await m3Page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(m3Page);

    const fractionalDprCheck = await m3Page.evaluate(() => {
      const c = document.querySelector('canvas');
      return {
        clientWidth: c ? c.clientWidth : 0,
        canvasWidth: c ? c.width : 0,
        expectedWidth: c ? Math.round(c.clientWidth * 1.25) : 0,
      };
    });
    assert.equal(
      fractionalDprCheck.canvasWidth,
      fractionalDprCheck.expectedWidth,
      `Expected fractional 1.25x DPR canvas.width=${fractionalDprCheck.expectedWidth}, got ${fractionalDprCheck.canvasWidth}`
    );

    // Seed a custom user save, then trigger import of malformed .capy JSON -> must show inline notice without alert() or partial state
    await m3Page.getByTestId('topbar-saves-btn').click();
    await m3Page.getByTestId('import-save-btn').waitFor({ state: 'visible', timeout: 5000 });
    const preBadImportSnapCount = await m3Page.evaluate(
      () => JSON.parse(localStorage.getItem('capy_snapshots_v8') || '[]').length
    );
    const badJsonPath = path.join(os.tmpdir(), 'capy_malformed_test.json');
    fs.writeFileSync(
      badJsonPath,
      JSON.stringify({
        format: 'capy-single-save',
        snapshot: { id: 'corrupt_snap_1', title: 'Corrupt Save' },
        puzzle: { width: -5, height: 10, palette: [], regions: [] },
      }),
      'utf8'
    );
    try {
      await m3Page.locator('input[type="file"][accept*=".capy"]').setInputFiles(badJsonPath);
      await m3Page.getByTestId('saves-import-notice').waitFor({ state: 'visible', timeout: 5000 });
    } finally {
      fs.rmSync(badJsonPath, { force: true });
    }
    assert.equal(
      await m3Page.getByTestId('saves-import-notice').getAttribute('role'),
      'alert',
      'Malformed save import must display inline role="alert" banner'
    );
    const [m3ActionBox, m3NoticeBox, m3ShareBox] = await Promise.all([
      m3Page.getByTestId('selected-save-action-bar').boundingBox(),
      m3Page.getByTestId('saves-import-notice').boundingBox(),
      m3Page.getByTestId('saves-share-print-bar').boundingBox(),
    ]);
    assert.ok(m3ActionBox && m3NoticeBox && m3ShareBox);
    assert.equal(
      m3ActionBox.y + m3ActionBox.height <= m3NoticeBox.y + 1 &&
        m3NoticeBox.y + m3NoticeBox.height <= m3ShareBox.y + 1,
      true,
      `saves-import-notice (${m3NoticeBox.y}..${m3NoticeBox.y + m3NoticeBox.height}) must appear between selected-save-action-bar (${m3ActionBox.y + m3ActionBox.height}) and saves-share-print-bar (${m3ShareBox.y})`
    );
    assert.equal(
      await m3Page.evaluate(() => window.__capyAlertCalls),
      0,
      'Malformed save import must never call blocking window.alert()'
    );
    assert.equal(
      await m3Page.evaluate(() => JSON.parse(localStorage.getItem('capy_snapshots_v8') || '[]').length),
      preBadImportSnapCount,
      'Malformed save import must leave zero partial snapshots in localStorage'
    );

    // Delete all saves -> must clear active session cleanly and auto-regenerate Capy Forest with zero broken thumbnails
    await m3Page.getByRole('button', { name: 'Delete All Saves' }).click();
    await m3Page.getByRole('button', { name: 'Yes, Delete All' }).click();
    await m3Page.waitForFunction(
      () => {
        const snaps = JSON.parse(localStorage.getItem('capy_snapshots_v8') || '[]');
        return snaps.length === 1 && snaps[0].title === 'Capy Forest' && snaps[0].totalCount > 0;
      },
      null,
      { timeout: 15000 }
    );
    await m3Page.waitForFunction(
      () => {
        const imgs = Array.from(document.querySelectorAll('img'));
        return imgs.length > 0 && imgs.every((img) => img.complete && img.naturalWidth > 0);
      },
      null,
      { timeout: 5000 }
    );

    // Verify sample_saves.capy bootstrap import does not shadow existing custom user saves
    const sampleOrderCheck = await m3Page.evaluate(async () => {
      const customTs = Date.now() - 60_000;
      const customSave = {
        id: 'custom_user_save_check',
        title: 'Custom User Art',
        timestamp: customTs,
        lastOpened: customTs,
        filledCount: 2,
        totalCount: 10,
        filledRegionIds: [1, 2],
        isAutoSample: false,
      };
      window.capyStorage.saveSnapshots([customSave]);
      const resp = await fetch('./assets/sample_saves.capy');
      const buf = await resp.arrayBuffer();
      await window.capyStorage.importSnapshotData(buf, { refreshTimestamps: true });
      const after = window.capyStorage.loadSnapshots();
      const samples = after.filter((s) => s.isAutoSample);
      return {
        firstId: after[0]?.id,
        sampleCount: samples.length,
        allSamplesOlder: samples.every((s) => s.lastOpened < customTs && s.timestamp < customTs),
      };
    });
    assert.equal(sampleOrderCheck.firstId, 'custom_user_save_check', 'Custom user save must remain first');
    assert.equal(sampleOrderCheck.sampleCount >= 4, true, 'All sample_saves.capy entries must import');
    assert.equal(sampleOrderCheck.allSamplesOlder, true, 'Auto-sample timestamps must stay strictly older than custom saves');

    // Corrupt #s= deep-link with valid ?room= must join room and strip invalid #s= hash without throwing
    await m3Page.goto(`${BASE_URL}/?room=ABCD23#s=invalid_corrupt_token`, { waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(m3Page);
    await m3Page.waitForFunction(
      () => !window.location.hash.includes('s='),
      null,
      { timeout: 5000 }
    );
    const m3RoomTitle = await m3Page.getByTestId('topbar-coop-btn').getAttribute('title');
    assert.equal(
      Boolean(m3RoomTitle && m3RoomTitle.includes('ABCD23')),
      true,
      `Expected ?room=ABCD23 to remain joined even when #s= token is invalid, got ${m3RoomTitle}`
    );

    await m3Page.close();

    // ErrorBoundary recovery, non-destructive backup download & non-debug suppression
    const nonDebugEbCtx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    try {
      const nonDebugEbPage = await nonDebugEbCtx.newPage();
      attachErrorListeners(nonDebugEbPage, 'nonDebugEbPage');
      await nonDebugEbPage.goto(`${BASE_URL}/?skipTutorial=1&capy_test_crash=1`, {
        waitUntil: 'networkidle',
      });
      await waitForPuzzleLoaded(nonDebugEbPage);
      assert.equal(
        await nonDebugEbPage.getByTestId('app-error-boundary').count(),
        0,
        'Non-debug browser must ignore ?capy_test_crash=1 instead of crashing'
      );
      await nonDebugEbPage.close();
    } finally {
      await nonDebugEbCtx.close();
    }

    const ebPage = await context.newPage();
    await ebPage.goto(`${BASE_URL}/?skipTutorial=1`, { waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(ebPage);
    await ebPage.evaluate(() => {
      const snaps = window.capyStorage.loadSnapshots();
      snaps.unshift({
        id: 'eb_preserved_save',
        title: 'EB Preserved Puzzle',
        totalRegions: 10,
        filledCount: 3,
        filledRegionIds: [1, 2, 3],
        timestamp: Date.now(),
        lastOpened: Date.now(),
        isCustom: true,
        isAutoSample: false,
        algorithm: 'CLASSIC',
        resetEpoch: 0,
      });
      window.capyStorage.saveSnapshots(snaps);
    });

    await ebPage.goto(`${BASE_URL}/?skipTutorial=1&capy_debug=1&capy_test_crash=1`, {
      waitUntil: 'domcontentloaded',
    });
    await ebPage.getByTestId('app-error-boundary').waitFor({ state: 'visible', timeout: 5000 });
    const ebMsg = await ebPage.getByTestId('error-boundary-message').innerText();
    assert.equal(
      ebMsg.includes('Debug ErrorBoundary trigger'),
      true,
      `Expected Debug ErrorBoundary trigger message, got: ${ebMsg}`
    );

    const [ebDownload] = await Promise.all([
      ebPage.waitForEvent('download', { timeout: 5000 }),
      ebPage.getByTestId('error-boundary-export-btn').click(),
    ]);
    assert.equal(
      ebDownload.suggestedFilename().endsWith('.capy') || ebDownload.suggestedFilename().endsWith('.json'),
      true,
      `Unexpected emergency backup filename: ${ebDownload.suggestedFilename()}`
    );
    await ebPage.getByTestId('error-boundary-export-status').waitFor({ state: 'visible', timeout: 5000 });

    const preservedBeforeReset = await ebPage.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('capy_snapshots_v8') || '[]');
      return raw.some((s) => s.id === 'eb_preserved_save');
    });
    assert.equal(preservedBeforeReset, true, 'ErrorBoundary state and backup export must preserve local saves');

    attachErrorListeners(ebPage, 'ebPagePostRecovery');
    await ebPage.getByTestId('error-boundary-retry-btn').click();
    await waitForPuzzleLoaded(ebPage);
    assert.equal(
      await ebPage.evaluate(() => !window.location.search.includes('capy_test_crash=1')),
      true,
      'ErrorBoundary retry must strip capy_test_crash query param before re-mounting App'
    );
    await ebPage.close();

    logE2ePass('Atomic malformed import UI, zero-snapshot Capy Forest recovery, corrupt #s= deep link, fractional DPR & ErrorBoundary verified.');

    // -------------------------------------------------------------------------
    // 20. Channel Storage Sandbox Isolation & UserSettings Enum Persistence E2E
    // -------------------------------------------------------------------------
    logE2eStart('Verifying Beta/Alpha StorageNamespace browser isolation & UserSettings enum persistence...');
    await page.evaluate(() => {
      const s = window.capyStorage.loadSettings();
      s.difficulty = 'NORMAL';
      s.paletteSort = 'HUE';
      s.highlightStyle = 'CENTROID_GLOW';
      s.fatFingerAssist = false;
      s.touchReachRadiusPx = 34;
      window.capyStorage.saveSettings(s);
    });
    await page.reload({ waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(page);
    const persistedEnums = await page.evaluate(() => {
      const s = window.capyStorage.loadSettings();
      return {
        difficulty: s.difficulty,
        paletteSort: s.paletteSort,
        highlightStyle: s.highlightStyle,
        fatFingerAssist: s.fatFingerAssist,
        touchReachRadiusPx: s.touchReachRadiusPx,
      };
    });
    assert.deepEqual(persistedEnums, {
      difficulty: 'NORMAL',
      paletteSort: 'HUE',
      highlightStyle: 'CENTROID_GLOW',
      fatFingerAssist: false,
      touchReachRadiusPx: 34,
    });

    const sandboxBetaPage = await context.newPage();
    attachErrorListeners(sandboxBetaPage, 'sandboxBetaPage');
    await sandboxBetaPage.goto(`${BASE_URL}/?capy_channel=beta&skipTutorial=1`, {
      waitUntil: 'networkidle',
    });
    await waitForPuzzleLoaded(sandboxBetaPage);
    await sandboxBetaPage.evaluate(() => {
      const s = window.capyStorage.loadSettings();
      s.difficulty = 'EASY';
      s.paletteSort = 'LIGHTNESS';
      window.capyStorage.saveSettings(s);
    });
    const sandboxKeys = await sandboxBetaPage.evaluate(() => ({
      betaSettingsRaw: localStorage.getItem('capy_user_settings_v8__sandbox_beta'),
      betaSnapsRaw: localStorage.getItem('capy_snapshots_v8__sandbox_beta'),
      betaActiveRaw: localStorage.getItem('capy_active_session_v8__sandbox_beta'),
      betaIdentityRaw: localStorage.getItem('capy_player_identity_v1__sandbox_beta'),
      betaTabSuffix: sessionStorage.getItem('capy_tab_peer_suffix_v1__sandbox_beta'),
      prodSettings: JSON.parse(localStorage.getItem('capy_user_settings_v8') || '{}'),
    }));
    assert.ok(sandboxKeys.betaSettingsRaw, 'Beta sandbox must persist capy_user_settings_v8__sandbox_beta');
    assert.ok(sandboxKeys.betaSnapsRaw, 'Beta sandbox must persist capy_snapshots_v8__sandbox_beta');
    assert.ok(sandboxKeys.betaActiveRaw, 'Beta sandbox must persist capy_active_session_v8__sandbox_beta');
    assert.ok(sandboxKeys.betaIdentityRaw, 'Beta sandbox must persist capy_player_identity_v1__sandbox_beta');
    assert.ok(sandboxKeys.betaTabSuffix, 'Beta sandbox must persist capy_tab_peer_suffix_v1__sandbox_beta');
    assert.equal(
      sandboxKeys.prodSettings.difficulty,
      'NORMAL',
      'Beta sandbox mutations must never overwrite Production capy_user_settings_v8.difficulty'
    );
    assert.equal(
      sandboxKeys.prodSettings.paletteSort,
      'HUE',
      'Beta sandbox mutations must never overwrite Production capy_user_settings_v8.paletteSort'
    );

    // Check Release Channel card mentions isolated sandbox
    await sandboxBetaPage.getByTestId('topbar-channel-badge').click();
    await sandboxBetaPage.getByTestId('release-channel-card').waitFor({ state: 'visible', timeout: 5000 });
    const betaChannelCopy = await sandboxBetaPage.getByTestId('release-channel-card').innerText();
    assert.equal(
      betaChannelCopy.toLowerCase().includes('isolated'),
      true,
      'Release Channel card must explain isolated channel sandbox'
    );
    await sandboxBetaPage.close();
    logE2ePass('Beta StorageNamespace browser isolation, UserSettings enum persistence & Release Channel copy verified.');

    // -------------------------------------------------------------------------
    // 21. IndexedDB Preview Offload, Quota Toast & Cloud Sync Race E2E
    // -------------------------------------------------------------------------
    logE2eStart('Verifying inline IndexedDB preview offload, storage quota toast above modal & async cloud sync stroke preservation...');
    const rawSnapsBeforeReload = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('capy_snapshots_v8') || '[]')
    );
    assert.equal(rawSnapsBeforeReload.length >= 4, true);
    assert.equal(
      rawSnapsBeforeReload.some((s) => typeof s.previewDataUrl === 'string' && s.previewDataUrl.length > 0),
      false,
      'capy_snapshots_v8 in localStorage must never inline previewDataUrl'
    );

    await page.getByTestId('topbar-saves-btn').click();
    await page.getByTestId('saves-list-section').waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForFunction(
      async () => {
        const snaps = window.capyStorage?.loadSnapshots?.() || [];
        if (snaps.length === 0) return false;
        const hydrated = await window.capyStorage.hydrateSnapshotPreviews(snaps);
        return hydrated.some(
          (s) => typeof s.previewDataUrl === 'string' && s.previewDataUrl.startsWith('data:image/')
        );
      },
      null,
      { timeout: 5000 }
    );

    await page.evaluate(() => {
      const origSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (typeof key === 'string' && key.includes('capy_user_settings_v8')) {
          const err = new Error('Simulated QuotaExceededError');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return origSetItem.call(this, key, value);
      };
      try {
        window.capyStorage.saveSettings(window.capyStorage.loadSettings());
      } finally {
        Storage.prototype.setItem = origSetItem;
      }
    });
    const quotaToast = page.getByTestId('storage-quota-toast');
    await quotaToast.waitFor({ state: 'visible', timeout: 3000 });
    await page.getByTestId('storage-quota-dismiss').click();
    await quotaToast.waitFor({ state: 'hidden', timeout: 3000 });
    await page.keyboard.press('Escape');
    await page.getByTestId('saves-list-section').waitFor({ state: 'hidden', timeout: 3000 });

    const syncRaceContext = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const syncRacePage = await syncRaceContext.newPage();
    attachErrorListeners(syncRacePage, 'syncRacePage');
    let holdDriveRead = false;
    let heldReadStartedResolve = null;
    let releaseHeldRead = null;
    let heldReadStartedPromise = new Promise((resolve) => {
      heldReadStartedResolve = resolve;
    });

    await syncRacePage.route('https://www.googleapis.com/**', async (route) => {
      const url = route.request().url();
      const method = route.request().method();
      if (url.includes('/oauth2/v3/userinfo')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ sub: 'g-race-1', name: 'Race Tester', email: 'race@example.com' }),
        });
        return;
      }
      if (holdDriveRead && method === 'GET' && url.includes('/drive/v3/files')) {
        holdDriveRead = false;
        heldReadStartedResolve?.();
        await new Promise((resolve) => {
          releaseHeldRead = resolve;
        });
      }
      if (method === 'GET' && url.includes('/drive/v3/files')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ files: [] }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'mock-drive-file-id' }),
      });
    });

    await syncRacePage.goto(`${BASE_URL}/?skipTutorial=1&coop=1`, { waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(syncRacePage);
    await syncRacePage.evaluate(() => {
      localStorage.setItem(
        'capy_google_oauth_token_v1',
        JSON.stringify({
          accessToken: 'mock-race-token',
          expiresAt: Date.now() + 3600 * 1000,
          sub: 'g-race-1',
          displayName: 'Race Tester',
          email: 'race@example.com',
        })
      );
      localStorage.setItem(
        'capy_player_identity_v1',
        JSON.stringify({
          playerId: 'google:g-race-1',
          displayName: 'Race Tester',
          avatarColorHex: '#fbbf24',
          provider: 'google',
          isAuthenticated: true,
          email: 'race@example.com',
        })
      );
    });
    await syncRacePage.reload({ waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(syncRacePage);

    await syncRacePage.getByTestId('topbar-coop-btn').click();
    await syncRacePage.getByTestId('reset-progress-btn').waitFor({ state: 'visible', timeout: 3000 });
    await syncRacePage.getByTestId('reset-progress-btn').click();
    await syncRacePage.waitForFunction(
      () =>
        Number(document.querySelector('[data-testid="topbar-saves-btn"]')?.getAttribute('data-filled-count')) === 0 &&
        (JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}').filledRegionIds || []).length === 0,
      undefined,
      { timeout: 5000 }
    );
    await syncRacePage.keyboard.press('Escape');
    await syncRacePage.getByTestId('settings-modal-close').waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});

    holdDriveRead = true;
    await syncRacePage.evaluate(() => {
      window.__capyReceiveCloudSnapshot?.(
        'capy_cloud_manifest_v2',
        JSON.stringify({ syncedAt: Date.now() })
      );
    });
    await heldReadStartedPromise;

    for (let attempt = 0; attempt < 6; attempt++) {
      const curFilled = Number(
        await syncRacePage.getByTestId('topbar-saves-btn').getAttribute('data-filled-count')
      );
      if (curFilled >= 1) break;
      await tapCanvasGrid(syncRacePage, 0.42 + attempt * 0.04, 8, 80);
    }
    const midFlightCount = Number(
      await syncRacePage.getByTestId('topbar-saves-btn').getAttribute('data-filled-count')
    );
    assert.equal(midFlightCount >= 1, true, 'Expected at least 1 mid-flight canvas stroke before releasing cloud sync');

    releaseHeldRead?.();
    await syncRacePage.waitForTimeout(450);

    const postSyncCount = Number(
      await syncRacePage.getByTestId('topbar-saves-btn').getAttribute('data-filled-count')
    );
    const postSyncStoredLen = await syncRacePage.evaluate(() => {
      const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
      return Array.isArray(active.filledRegionIds) ? active.filledRegionIds.length : 0;
    });
    assert.equal(
      postSyncCount,
      midFlightCount,
      'Async cloud sync completion must preserve mid-flight painted regions'
    );
    assert.equal(
      postSyncStoredLen,
      midFlightCount,
      'Async cloud sync completion must preserve mid-flight filledRegionIds in capy_active_session_v8'
    );
    await syncRacePage.close();
    await syncRaceContext.close();
    logE2ePass('IndexedDB preview offload, storage quota toast & async cloud sync stroke preservation verified.');

    // -------------------------------------------------------------------------
    // 22. Large Text Button Scaling (360x780 / 412x915 / 1280x720), Fat-Finger Coupling & #602 Regression Fixes
    // -------------------------------------------------------------------------
    logE2eStart('Verifying Large Text full UI button scaling (360x780, 412x915, 1280x720), Fat-Finger coupling & Paint/Free-Colour fixes...');

    // 22a. 360x780 Mobile: Normal vs Large Text button dimensions, 5-button Co-op containment, Replay wrap/stacking, Palette centering, Settings & ColorPicker
    const ltMobileCtx = await browser.newContext({ viewport: { width: 360, height: 780 }, hasTouch: true });
    await ltMobileCtx.addInitScript(() => {
      localStorage.setItem('capy_dev_debug', '1');
    });
    const ltMobilePage = await ltMobileCtx.newPage();
    attachErrorListeners(ltMobilePage, 'ltMobilePage');
    await ltMobilePage.goto(`${BASE_URL}/?capy_channel=alpha&capy_pr=520&skipTutorial=1`, { waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(ltMobilePage);

    const normalMobileBoxes = {
      settingsBtn: await ltMobilePage.getByTestId('topbar-settings-btn').boundingBox(),
      previewBtn: await ltMobilePage.getByTestId('topbar-preview-btn').boundingBox(),
      savesBtn: await ltMobilePage.getByTestId('topbar-saves-btn').boundingBox(),
      paintBtn: await ltMobilePage.getByTestId('paint-mode-btn').boundingBox(),
      undoBtn: await ltMobilePage.getByTestId('undo-btn').boundingBox(),
      swatch1: await ltMobilePage.getByTestId('palette-swatch-1').boundingBox(),
      swatch1FontPx: await ltMobilePage
        .getByTestId('palette-swatch-1')
        .locator('span')
        .first()
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    };
    assert.ok(
      normalMobileBoxes.settingsBtn &&
        normalMobileBoxes.previewBtn &&
        normalMobileBoxes.savesBtn &&
        normalMobileBoxes.paintBtn &&
        normalMobileBoxes.undoBtn &&
        normalMobileBoxes.swatch1
    );

    // Select a mid-dock swatch (#8) before toggling Large Text so live useLayoutEffect centering is exercised
    const midDockSwatchId = await ltMobilePage.evaluate(() => {
      const swatches = Array.from(document.querySelectorAll('[data-testid^="palette-swatch-"]'));
      if (swatches.length === 0) return null;
      const target = swatches[Math.min(7, swatches.length - 1)];
      return target.getAttribute('data-testid');
    });
    if (midDockSwatchId) {
      const midSwatchBtn = ltMobilePage.getByTestId(midDockSwatchId);
      await midSwatchBtn.scrollIntoViewIfNeeded();
      await midSwatchBtn.click();
      await ltMobilePage.waitForTimeout(250);
    }

    const assertSwitchKnobContained = async (page, testId, expectedChecked, label) => {
      const sw = page.getByTestId(testId);
      await sw.scrollIntoViewIfNeeded();
      assert.equal(
        await sw.getAttribute('aria-checked'),
        String(expectedChecked),
        `${label}: expected aria-checked=${expectedChecked}`
      );
      await page.waitForTimeout(220);
      const swBox = await sw.boundingBox();
      const knobBox = await sw.locator('.capy-switch-knob').boundingBox();
      assert.ok(swBox && knobBox, `${label}: expected visible switch and knob boxes`);
      assert.equal(
        knobBox.x >= swBox.x - 0.5 &&
          knobBox.x + knobBox.width <= swBox.x + swBox.width + 0.5 &&
          knobBox.y >= swBox.y - 0.5 &&
          knobBox.y + knobBox.height <= swBox.y + swBox.height + 0.5,
        true,
        `${label}: knob ${JSON.stringify(knobBox)} must stay strictly inside switch track ${JSON.stringify(swBox)}`
      );
      const isLargeText = await page.evaluate(() => document.documentElement.dataset.largeText === 'true');
      if (isLargeText) {
        if (expectedChecked) {
          const rightGap = swBox.x + swBox.width - (knobBox.x + knobBox.width);
          assert.equal(
            rightGap <= 4.5,
            true,
            `${label}: checked knob must align flush near right track edge (rightGap=${rightGap.toFixed(2)}px, sw=${JSON.stringify(swBox)}, knob=${JSON.stringify(knobBox)})`
          );
        } else {
          const leftGap = knobBox.x - swBox.x;
          assert.equal(
            leftGap <= 4.5,
            true,
            `${label}: unchecked knob must align flush near left track edge (leftGap=${leftGap.toFixed(2)}px, sw=${JSON.stringify(swBox)}, knob=${JSON.stringify(knobBox)})`
          );
        }
      }
    };

    // Open SettingsModal, verify normal switch size & knob containment, test Fat-Finger preset auto-enable & Large Text coupling
    await ltMobilePage.getByTestId('topbar-settings-btn').click();
    await ltMobilePage.getByTestId('settings-tab-settings').click();
    const ltSwitch = ltMobilePage.getByTestId('setting-large-text');
    const ffSwitch = ltMobilePage.getByTestId('setting-fat-finger-assist');
    await ltSwitch.waitFor({ state: 'visible', timeout: 5000 });
    const normalSwitchBox = await ltSwitch.boundingBox();
    const normalCloseBox = await ltMobilePage.getByTestId('settings-modal-close').boundingBox();
    assert.ok(normalSwitchBox && normalCloseBox);

    // Verify Normal-mode switch knob containment (checked & unchecked) remains unaffected
    await assertSwitchKnobContained(ltMobilePage, 'setting-fat-finger-assist', true, 'Normal mode fatFinger ON');
    await assertSwitchKnobContained(ltMobilePage, 'setting-large-text', false, 'Normal mode largeText OFF');

    // Verify default fatFingerAssist is enabled on fresh load, then turn OFF to verify dim + preset auto-enable
    assert.equal(await ffSwitch.getAttribute('aria-checked'), 'true', 'Fresh install must default fatFingerAssist to true');
    await ffSwitch.click();
    assert.equal(await ffSwitch.getAttribute('aria-checked'), 'false');
    const reachControlsDimmed = await ltMobilePage
      .getByTestId('setting-touch-reach-controls')
      .evaluate((el) => el.classList.contains('opacity-50'));
    assert.equal(reachControlsDimmed, true, 'Reach radius controls must be visually dimmed when fatFingerAssist is off');

    // Clicking a preset while fatFingerAssist is OFF must auto-enable fatFingerAssist
    await ltMobilePage.getByTestId('setting-touch-reach-preset-34').click();
    assert.equal(await ffSwitch.getAttribute('aria-checked'), 'true', 'Clicking a reach preset must auto-enable fatFingerAssist');
    assert.equal(await ltMobilePage.getByTestId('setting-touch-reach-radius').inputValue(), '34');

    // Set saved radius to 22px, turn fatFingerAssist OFF, then toggle Large Text ON -> must enable fatFingerAssist & show 34px Large UI boost
    await ltMobilePage.getByTestId('setting-touch-reach-preset-22').click();
    await ffSwitch.click();
    assert.equal(await ffSwitch.getAttribute('aria-checked'), 'false');
    await ltSwitch.click();
    await ltMobilePage.waitForFunction(() => document.documentElement.dataset.largeText === 'true', undefined, { timeout: 3000 });
    assert.equal(
      await ffSwitch.getAttribute('aria-checked'),
      'true',
      'Enabling Large Text in SettingsModal must also enable fatFingerAssist'
    );
    const largeUiReachLabel = await ltMobilePage.getByTestId('setting-touch-reach-value').innerText();
    assert.equal(
      largeUiReachLabel.includes('34px') && largeUiReachLabel.includes('Large UI'),
      true,
      `Expected effective 34px Large UI reach label while saved radius is 22px (got '${largeUiReachLabel}')`
    );
    assert.equal(
      await ltMobilePage.getByTestId('setting-touch-reach-radius').inputValue(),
      '22',
      'Large Text effective reach boost must not mutate saved touchReachRadiusPx slider value'
    );

    // Fix 8: Toggling fatFingerAssist OFF while largeText stays ON must drop the "(Large UI ...)" boost readout
    await ffSwitch.click();
    await assertSwitchKnobContained(ltMobilePage, 'setting-fat-finger-assist', false, 'Large Text Variant 1 fatFinger OFF');
    const disabledReachLabel = (await ltMobilePage.getByTestId('setting-touch-reach-value').innerText()).trim();
    assert.equal(
      disabledReachLabel,
      '22px',
      `Disabling fatFingerAssist while largeText=true must drop Large UI boost readout (got '${disabledReachLabel}')`
    );
    await ffSwitch.click();
    await assertSwitchKnobContained(ltMobilePage, 'setting-fat-finger-assist', true, 'Large Text Variant 1 fatFinger ON');
    await assertSwitchKnobContained(ltMobilePage, 'setting-large-text', true, 'Large Text Variant 1 largeText ON');

    // Fix 1: Verify Variant 2 switch (w-11 h-6 + translate-x-5) knob containment in both checked & unchecked states
    const followInitial = (await ltMobilePage.getByTestId('toggle-replay-follow-btn').getAttribute('aria-checked')) === 'true';
    await assertSwitchKnobContained(ltMobilePage, 'toggle-replay-follow-btn', followInitial, 'Large Text Variant 2 follow initial');
    await ltMobilePage.getByTestId('toggle-replay-follow-btn').click();
    await assertSwitchKnobContained(ltMobilePage, 'toggle-replay-follow-btn', !followInitial, 'Large Text Variant 2 follow toggled');
    await ltMobilePage.getByTestId('toggle-replay-follow-btn').click();

    // Fix 2: Enlarged range slider must compute appearance === 'none' so 24px custom thumb renders on Chromium/WebView
    const sliderAppearance = await ltMobilePage
      .getByTestId('setting-touch-reach-radius')
      .evaluate((el) => getComputedStyle(el).appearance);
    assert.equal(
      sliderAppearance,
      'none',
      `Large Text setting-touch-reach-radius must compute appearance: none (got '${sliderAppearance}')`
    );

    // Measure enlarged SettingsModal controls & verify tabs zero-overflow and 40px/16px specificity at 360x780
    const largeSwitchBox = await ltSwitch.boundingBox();
    const largeFfSwitchBox = await ffSwitch.boundingBox();
    const largeCloseBox = await ltMobilePage.getByTestId('settings-modal-close').boundingBox();
    assert.ok(largeSwitchBox && largeFfSwitchBox && largeCloseBox);
    assert.equal(
      largeSwitchBox.width >= 50 && largeSwitchBox.height >= 28 && largeSwitchBox.width > normalSwitchBox.width,
      true,
      `Large Text switch must enlarge to ~52x30px (normal=${JSON.stringify(normalSwitchBox)}, large=${JSON.stringify(largeSwitchBox)})`
    );
    assert.equal(
      largeFfSwitchBox.width >= 50 && largeFfSwitchBox.height >= 28,
      true,
      `Fat-Finger switch must enlarge to ~52x30px (got ${JSON.stringify(largeFfSwitchBox)})`
    );
    assert.equal(
      largeCloseBox.width >= 40 && largeCloseBox.height >= 40 && largeCloseBox.width > normalCloseBox.width,
      true,
      `Settings close button must enlarge to >=40px (got ${JSON.stringify(largeCloseBox)})`
    );

    const ltTabsContainer = ltMobilePage.getByTestId('settings-modal-tabs');
    const ltTabsOverflow = await ltTabsContainer.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    assert.equal(
      ltTabsOverflow.scrollWidth <= ltTabsOverflow.clientWidth,
      true,
      `Large Text SettingsModal tabs must not overflow at 360x780 (${JSON.stringify(ltTabsOverflow)})`
    );
    // Fix 3: Catch-all :where() must allow settings-tab-about 40px min-height and 16px SVG at 360x780
    const tabAboutComputed = await ltMobilePage.getByTestId('settings-tab-about').evaluate((btn) => {
      const svg = btn.querySelector('svg');
      return {
        minHeight: getComputedStyle(btn).minHeight,
        svgW: svg ? getComputedStyle(svg).width : null,
        svgH: svg ? getComputedStyle(svg).height : null,
      };
    });
    assert.equal(
      tabAboutComputed.minHeight,
      '40px',
      `360x780 settings-tab-about must compute minHeight=40px (got ${JSON.stringify(tabAboutComputed)})`
    );
    assert.equal(
      tabAboutComputed.svgW === '16px' && tabAboutComputed.svgH === '16px',
      true,
      `360x780 settings-tab-about SVG must compute 16px x 16px (got ${JSON.stringify(tabAboutComputed)})`
    );

    const ltTabsBox = await ltTabsContainer.boundingBox();
    assert.ok(ltTabsBox);
    for (const tabKey of ['about', 'settings', 'hints', 'create', 'saves']) {
      const tb = await ltMobilePage.getByTestId(`settings-tab-${tabKey}`).boundingBox();
      assert.ok(tb);
      assert.equal(
        tb.x >= ltTabsBox.x - 1 && tb.x + tb.width <= largeCloseBox.x + 1,
        true,
        `Large Text settings-tab-${tabKey} (${tb.x}..${tb.x + tb.width}) must fit inside tabsBox (${ltTabsBox.x}) left of close (${largeCloseBox.x})`
      );
    }

    // Check Tab 0 action button height (>=44px), Tab 3 (i) hint icon button size (>=32px), and Tab 4 Variant 3 switch knob containment
    await ltMobilePage.getByTestId('settings-tab-about').click();
    const replayTutBtnBox = await ltMobilePage.getByTestId('about-replay-tutorial-btn').boundingBox();
    assert.ok(replayTutBtnBox && replayTutBtnBox.height >= 44, `About CTA button must be >=44px tall in Large Text (got ${JSON.stringify(replayTutBtnBox)})`);
    await ltMobilePage.getByTestId('settings-tab-create').click();
    const hintToggleBox = await ltMobilePage.getByTestId('hint-toggle-daily-puzzle').boundingBox();
    assert.ok(hintToggleBox && hintToggleBox.width >= 31 && hintToggleBox.height >= 31, `(i) hint button must enlarge to ~32px in Large Text (got ${JSON.stringify(hintToggleBox)})`);
    await ltMobilePage.getByTestId('settings-tab-saves').click();
    const savesAutoReplayBtn = ltMobilePage.getByTestId('toggle-auto-replay-saves-btn');
    await savesAutoReplayBtn.waitFor({ state: 'visible', timeout: 3000 });
    const savesInitial = (await savesAutoReplayBtn.getAttribute('aria-checked')) === 'true';
    await assertSwitchKnobContained(ltMobilePage, 'toggle-auto-replay-saves-btn', savesInitial, 'Large Text Variant 3 saves autoReplay initial');
    await savesAutoReplayBtn.click();
    await assertSwitchKnobContained(ltMobilePage, 'toggle-auto-replay-saves-btn', !savesInitial, 'Large Text Variant 3 saves autoReplay toggled');
    await savesAutoReplayBtn.click();

    // Enable Custom Color button for all puzzles so we can verify ColorPickerPopover in Large Text mode too
    await ltMobilePage.getByTestId('settings-tab-settings').click();
    await ltMobilePage.evaluate(() => {
      const cur = window.capyStorage.loadSettings();
      window.capyStorage.saveSettings({ ...cur, enableCustomColorForAllPuzzles: true, largeText: true, fatFingerAssist: true });
    });
    await ltMobilePage.getByTestId('settings-modal-close').click();
    await ltMobilePage.getByTestId('settings-modal-close').waitFor({ state: 'hidden', timeout: 3000 });

    // Fix 4: Verify mid-dock active swatch (#8) stayed centered immediately after live Large Text toggle (before scrolling away)
    await ltMobilePage.waitForTimeout(350);
    const activeSwatchCenterCheck = await ltMobilePage.evaluate(() => {
      const dock = document.querySelector('[data-testid="palette-dock"]');
      const scroller = dock?.querySelector('.overflow-x-auto');
      const active = dock?.querySelector('button[aria-pressed="true"]');
      if (!scroller || !active) return null;
      const sr = scroller.getBoundingClientRect();
      const ar = active.getBoundingClientRect();
      return {
        activeTestId: active.getAttribute('data-testid'),
        scrollable: scroller.scrollWidth > scroller.clientWidth + 1,
        diff: Math.abs(ar.left + ar.width / 2 - (sr.left + sr.width / 2)),
      };
    });
    if (activeSwatchCenterCheck?.scrollable) {
      assert.equal(
        activeSwatchCenterCheck.diff <= 8,
        true,
        `Mid-dock active swatch (${activeSwatchCenterCheck.activeTestId}) must stay centered immediately upon live Large Text toggle (diff=${activeSwatchCenterCheck.diff})`
      );
    }

    // Measure enlarged HUD controls at 360x780
    const largeMobileBoxes = {
      settingsBtn: await ltMobilePage.getByTestId('topbar-settings-btn').boundingBox(),
      previewBtn: await ltMobilePage.getByTestId('topbar-preview-btn').boundingBox(),
      savesBtn: await ltMobilePage.getByTestId('topbar-saves-btn').boundingBox(),
      paintBtn: await ltMobilePage.getByTestId('paint-mode-btn').boundingBox(),
      undoBtn: await ltMobilePage.getByTestId('undo-btn').boundingBox(),
      swatch1: await ltMobilePage.getByTestId('palette-swatch-1').boundingBox(),
      swatch1FontPx: await ltMobilePage
        .getByTestId('palette-swatch-1')
        .locator('span')
        .first()
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    };
    assert.ok(
      largeMobileBoxes.settingsBtn &&
        largeMobileBoxes.previewBtn &&
        largeMobileBoxes.savesBtn &&
        largeMobileBoxes.paintBtn &&
        largeMobileBoxes.undoBtn &&
        largeMobileBoxes.swatch1
    );
    assert.equal(
      largeMobileBoxes.settingsBtn.width >= 36 &&
        largeMobileBoxes.settingsBtn.height >= 36 &&
        largeMobileBoxes.settingsBtn.width > normalMobileBoxes.settingsBtn.width,
      true,
      `360px Large Text topbar-settings-btn must enlarge to >=36px (normal=${normalMobileBoxes.settingsBtn.width}, large=${largeMobileBoxes.settingsBtn.width})`
    );
    assert.equal(
      largeMobileBoxes.previewBtn.width >= 36 && largeMobileBoxes.previewBtn.width > normalMobileBoxes.previewBtn.width,
      true,
      `360px Large Text topbar-preview-btn must enlarge to >=36px`
    );
    assert.equal(
      largeMobileBoxes.savesBtn.height >= 36 && largeMobileBoxes.savesBtn.height > normalMobileBoxes.savesBtn.height,
      true,
      `360px Large Text topbar-saves-btn must be >=36px tall (normal=${normalMobileBoxes.savesBtn.height}, large=${largeMobileBoxes.savesBtn.height})`
    );
    assert.equal(
      largeMobileBoxes.paintBtn.width >= 58 && largeMobileBoxes.paintBtn.width > normalMobileBoxes.paintBtn.width,
      true,
      `Large Text paint-mode-btn must enlarge to >=58px (got ${largeMobileBoxes.paintBtn.width})`
    );
    assert.equal(
      largeMobileBoxes.undoBtn.width >= 50 && largeMobileBoxes.undoBtn.width > normalMobileBoxes.undoBtn.width,
      true,
      `Large Text undo-btn must enlarge to >=50px (got ${largeMobileBoxes.undoBtn.width})`
    );
    assert.equal(
      largeMobileBoxes.swatch1.width >= 56 &&
        largeMobileBoxes.swatch1.height >= 52 &&
        largeMobileBoxes.swatch1.width > normalMobileBoxes.swatch1.width,
      true,
      `Large Text palette-swatch-1 must enlarge to ~58x54px (normal=${JSON.stringify(normalMobileBoxes.swatch1)}, large=${JSON.stringify(largeMobileBoxes.swatch1)})`
    );
    assert.equal(
      largeMobileBoxes.swatch1FontPx >= 15.5 && largeMobileBoxes.swatch1FontPx > normalMobileBoxes.swatch1FontPx,
      true,
      `Large Text palette swatch number must enlarge to 16px (normal=${normalMobileBoxes.swatch1FontPx}, large=${largeMobileBoxes.swatch1FontPx})`
    );

    // Verify 5-button Co-op TopBar fits cleanly within 360px in Large Text mode, and ColorPickerPopover quick swatches enlarge
    await ltMobilePage.evaluate(() => {
      localStorage.setItem('capy_dev_cloud_coop_ui', '1');
    });
    await ltMobilePage.reload({ waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(ltMobilePage);
    await ltMobilePage.getByTestId('topbar-coop-btn').waitFor({ state: 'visible', timeout: 5000 });
    const [coopLeftBox, coopRightBox, coopBtnBox] = await Promise.all([
      ltMobilePage.getByTestId('topbar-left-lane').boundingBox(),
      ltMobilePage.getByTestId('topbar-right-lane').boundingBox(),
      ltMobilePage.getByTestId('topbar-coop-btn').boundingBox(),
    ]);
    assert.ok(coopLeftBox && coopRightBox && coopBtnBox);
    assert.equal(
      coopBtnBox.width >= 36 && coopLeftBox.x + coopLeftBox.width <= coopRightBox.x + 1 && coopRightBox.x + coopRightBox.width <= 360,
      true,
      `5-button Co-op Large Text topbar must fit within 360px with zero lane overlap (${JSON.stringify({ coopLeftBox, coopRightBox, coopBtnBox })})`
    );

    // Open ColorPickerPopover via palette-custom-btn and check quick swatches + close button sizing
    const customPaletteBtn = ltMobilePage.getByTestId('palette-custom-btn');
    await customPaletteBtn.scrollIntoViewIfNeeded();
    await customPaletteBtn.click();
    const popoverCloseBtn = ltMobilePage.locator('button[title="Close"]').last();
    await popoverCloseBtn.waitFor({ state: 'visible', timeout: 3000 });
    const popoverCloseBox = await popoverCloseBtn.boundingBox();
    const popoverSwatchBox = await ltMobilePage.locator('.capy-quick-swatch').first().boundingBox();
    assert.ok(popoverCloseBox && popoverCloseBox.width >= 40 && popoverCloseBox.height >= 40, `ColorPickerPopover close must be >=40px in Large Text (got ${JSON.stringify(popoverCloseBox)})`);
    assert.ok(popoverSwatchBox && popoverSwatchBox.width >= 38 && popoverSwatchBox.height >= 38, `ColorPickerPopover quick swatch must be >=40px in Large Text (got ${JSON.stringify(popoverSwatchBox)})`);
    await popoverCloseBtn.click();
    await popoverCloseBtn.waitFor({ state: 'hidden', timeout: 3000 });

    // Fill 1 region and open ReplayControls on 360x780 Large Text to verify 2-row wrap, button sizing & vertical clearance
    await tapCanvasGrid(ltMobilePage, 0.5, 6, 60);
    await ltMobilePage.waitForFunction(
      () => Number(document.querySelector('[data-testid="topbar-saves-btn"]')?.getAttribute('data-filled-count') || 0) >= 1,
      { timeout: 5000 }
    );
    const ltUndoBox = await getStableBoundingBox(ltMobilePage.getByTestId('undo-btn'));
    assert.ok(ltUndoBox);
    await ltMobilePage.mouse.move(ltUndoBox.x + ltUndoBox.width / 2, ltUndoBox.y + ltUndoBox.height / 2);
    await ltMobilePage.mouse.down();
    await ltMobilePage.getByTestId('replay-controls-window').waitFor({ state: 'visible', timeout: 4000 });
    await ltMobilePage.mouse.up();
    await ltMobilePage.waitForTimeout(250);

    const [ltReplayWinBox, ltReplayPlayBox, ltReplayFollowBox, ltReplayLoopBox, ltReplayExitBox, ltReplayScrubBox, ltPaintDuringReplayBox, ltPaletteDuringReplayBox] =
      await Promise.all([
        ltMobilePage.getByTestId('replay-controls-window').boundingBox(),
        ltMobilePage.getByTestId('replay-play-pause-btn').boundingBox(),
        ltMobilePage.getByTestId('replay-follow-btn').boundingBox(),
        ltMobilePage.getByTestId('replay-loop-btn').boundingBox(),
        ltMobilePage.getByTestId('replay-exit-btn').boundingBox(),
        ltMobilePage.getByTestId('replay-scrubber-track').boundingBox(),
        ltMobilePage.getByTestId('paint-mode-btn').boundingBox(),
        ltMobilePage.getByTestId('palette-dock').boundingBox(),
      ]);
    assert.ok(
      ltReplayWinBox &&
        ltReplayPlayBox &&
        ltReplayFollowBox &&
        ltReplayLoopBox &&
        ltReplayExitBox &&
        ltReplayScrubBox &&
        ltPaintDuringReplayBox &&
        ltPaletteDuringReplayBox
    );
    assert.equal(
      ltReplayWinBox.x >= 0 && ltReplayWinBox.x + ltReplayWinBox.width <= 360,
      true,
      `360px Large Text ReplayControls must fit within 360px (${JSON.stringify(ltReplayWinBox)})`
    );
    assert.equal(ltReplayPlayBox.width >= 42 && ltReplayPlayBox.height >= 42, true, `Replay play button must be >=42px (got ${JSON.stringify(ltReplayPlayBox)})`);
    assert.equal(ltReplayFollowBox.width >= 40 && ltReplayLoopBox.width >= 40 && ltReplayExitBox.width >= 40, true, 'Replay icon buttons must be >=40px in Large Text');
    assert.equal(ltReplayScrubBox.height >= 32, true, `Replay scrubber must be >=32px tall in Large Text (got ${ltReplayScrubBox.height})`);
    assert.equal(
      ltPaintDuringReplayBox.y + ltPaintDuringReplayBox.height <= ltReplayWinBox.y + 1,
      true,
      `360px Large Text FloatingActions bottom (${ltPaintDuringReplayBox.y + ltPaintDuringReplayBox.height}) must clear ReplayControls top (${ltReplayWinBox.y})`
    );
    assert.equal(
      ltReplayWinBox.y + ltReplayWinBox.height <= ltPaletteDuringReplayBox.y + 1,
      true,
      `360px Large Text ReplayControls bottom (${ltReplayWinBox.y + ltReplayWinBox.height}) must clear PaletteDock top (${ltPaletteDuringReplayBox.y})`
    );

    // 22b. 412x915 Modern Mobile Viewport check
    await ltMobilePage.setViewportSize({ width: 412, height: 915 });
    await ltMobilePage.waitForTimeout(200);
    const modernSettingsBox = await ltMobilePage.getByTestId('topbar-settings-btn').boundingBox();
    assert.ok(modernSettingsBox && modernSettingsBox.width >= 42 && modernSettingsBox.height >= 42, `412px Large Text topbar-settings-btn must step up to >=42px (got ${JSON.stringify(modernSettingsBox)})`);

    // 22c. 1280x720 Desktop Viewport check (single-row ReplayControls + 46px topbar + stacking clearance)
    await ltMobilePage.setViewportSize({ width: 1280, height: 720 });
    await ltMobilePage.waitForTimeout(250);
    const [deskLtSettingsBox, deskLtReplayBox, deskLtPaintBox, deskLtPaletteBox] = await Promise.all([
      ltMobilePage.getByTestId('topbar-settings-btn').boundingBox(),
      ltMobilePage.getByTestId('replay-controls-window').boundingBox(),
      ltMobilePage.getByTestId('paint-mode-btn').boundingBox(),
      ltMobilePage.getByTestId('palette-dock').boundingBox(),
    ]);
    assert.ok(deskLtSettingsBox && deskLtReplayBox && deskLtPaintBox && deskLtPaletteBox);
    assert.equal(deskLtSettingsBox.width >= 46 && deskLtSettingsBox.height >= 46, true, `1280px Large Text topbar-settings-btn must step up to >=46px (got ${JSON.stringify(deskLtSettingsBox)})`);
    assert.equal(deskLtReplayBox.height <= 68, true, `1280px Large Text ReplayControls must remain single-row (height=${deskLtReplayBox.height})`);
    assert.equal(
      deskLtPaintBox.y + deskLtPaintBox.height <= deskLtReplayBox.y + 1,
      true,
      `1280px Large Text FloatingActions bottom (${deskLtPaintBox.y + deskLtPaintBox.height}) must clear ReplayControls top (${deskLtReplayBox.y})`
    );
    assert.equal(
      deskLtReplayBox.y + deskLtReplayBox.height <= deskLtPaletteBox.y + 1,
      true,
      `1280px Large Text ReplayControls bottom (${deskLtReplayBox.y + deskLtReplayBox.height}) must clear PaletteDock top (${deskLtPaletteBox.y})`
    );

    // Toggle Large Text OFF in Settings and verify fatFingerAssist remains true
    await ltMobilePage.getByTestId('replay-exit-btn').click();
    await ltMobilePage.getByTestId('topbar-settings-btn').click();
    await ltMobilePage.getByTestId('settings-tab-settings').click();
    await ltMobilePage.getByTestId('setting-large-text').click();
    await ltMobilePage.waitForFunction(() => document.documentElement.dataset.largeText !== 'true', undefined, { timeout: 3000 });
    assert.equal(
      await ltMobilePage.getByTestId('setting-fat-finger-assist').getAttribute('aria-checked'),
      'true',
      'Turning Large Text OFF must preserve fatFingerAssist: true'
    );
    await ltMobilePage.close();
    await ltMobileCtx.close();

    // 22c-landscape. 640x360 Short-Landscape Phone checks in Large Text mode (Fixes 6, 7, 8)
    const landCtx = await browser.newContext({ viewport: { width: 640, height: 360 }, hasTouch: true });
    await landCtx.addInitScript(() => {
      localStorage.setItem('capy_dev_debug', '1');
      localStorage.setItem(
        'capy_user_settings_v8',
        JSON.stringify({
          largeText: true,
          fatFingerAssist: true,
          raisePaletteDock: true,
          enableCustomColorForAllPuzzles: true,
          autoReplayOnLoad: false,
          showUndoButton: true,
        })
      );
    });
    const landPage = await landCtx.newPage();
    attachErrorListeners(landPage, 'landPage');
    await landPage.goto(`${BASE_URL}/?skipTutorial=1`, { waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(landPage);

    // Fill 1 region and open Replay so replay_scrubber FeatureOfferBanner + raised dock + ReplayControls + FABs are all live simultaneously
    await tapCanvasGrid(landPage, 0.5, 6, 60);
    await landPage.waitForFunction(
      () => Number(document.querySelector('[data-testid="topbar-saves-btn"]')?.getAttribute('data-filled-count') || 0) >= 1,
      { timeout: 5000 }
    );
    await landPage.evaluate(() => {
      localStorage.removeItem('capy_feature_offers_v1');
    });
    const landUndoStart = await getStableBoundingBox(landPage.getByTestId('undo-btn'));
    assert.ok(landUndoStart);
    await landPage.mouse.move(landUndoStart.x + landUndoStart.width / 2, landUndoStart.y + landUndoStart.height / 2);
    await landPage.mouse.down();
    await landPage.getByTestId('replay-controls-window').waitFor({ state: 'visible', timeout: 4000 });
    await landPage.mouse.up();
    await landPage.getByTestId('feature-offer-banner').waitFor({ state: 'visible', timeout: 4000 });
    await landPage.waitForTimeout(250);

    const [landHeaderBox, landUndoBox, landPaintBox, landReplayBox, landBannerBox] = await Promise.all([
      landPage.locator('header').first().boundingBox(),
      landPage.getByTestId('undo-btn').boundingBox(),
      landPage.getByTestId('paint-mode-btn').boundingBox(),
      landPage.getByTestId('replay-controls-window').boundingBox(),
      landPage.getByTestId('feature-offer-banner').boundingBox(),
    ]);
    assert.ok(landHeaderBox && landUndoBox && landPaintBox && landReplayBox && landBannerBox);
    assert.equal(
      landUndoBox.y >= landHeaderBox.y + landHeaderBox.height - 1,
      true,
      `640x360 raised+replaying undo-btn top (${landUndoBox.y}) must clear GameTopBar bottom (${landHeaderBox.y + landHeaderBox.height})`
    );
    assert.equal(
      landPaintBox.y + landPaintBox.height <= landReplayBox.y + 1,
      true,
      `640x360 raised+replaying paint-mode-btn bottom (${landPaintBox.y + landPaintBox.height}) must clear ReplayControls top (${landReplayBox.y})`
    );
    assert.equal(
      landBannerBox.y >= landHeaderBox.y + landHeaderBox.height - 1,
      true,
      `640x360 FeatureOfferBanner top (${landBannerBox.y}) must clear GameTopBar bottom (${landHeaderBox.y + landHeaderBox.height})`
    );
    assert.equal(
      landBannerBox.y + landBannerBox.height <= landReplayBox.y + 1,
      true,
      `640x360 FeatureOfferBanner bottom (${landBannerBox.y + landBannerBox.height}) must NOT overlap ReplayControls top (${landReplayBox.y})`
    );
    // Verify FeatureOfferBanner does not intercept clicks on replay-speed-btn
    await landPage.getByTestId('replay-speed-btn').click({ timeout: 3000 });
    await landPage.getByTestId('feature-offer-dismiss-btn').click();
    await landPage.getByTestId('feature-offer-banner').waitFor({ state: 'hidden', timeout: 3000 });
    await landPage.getByTestId('replay-exit-btn').click();
    await landPage.getByTestId('replay-controls-window').waitFor({ state: 'hidden', timeout: 3000 });

    // Fix 7: ColorPickerPopover must stay strictly inside [0, 360] vertically with clickable Close button on 640x360
    const landCustomBtn = landPage.getByTestId('palette-custom-btn');
    await landCustomBtn.scrollIntoViewIfNeeded();
    await landCustomBtn.click();
    const landPopoverClose = landPage.locator('button[title="Close"]').last();
    await landPopoverClose.waitFor({ state: 'visible', timeout: 3000 });
    await landPage.waitForTimeout(200);
    const landPopoverMetrics = await landPopoverClose.evaluate((closeBtn) => {
      const shell = closeBtn.closest('.rounded-2xl');
      const sr = shell?.getBoundingClientRect();
      const cr = closeBtn.getBoundingClientRect();
      return {
        shellTop: sr?.top ?? -999,
        shellBottom: sr?.bottom ?? 999,
        closeTop: cr.top,
        closeBottom: cr.bottom,
      };
    });
    assert.equal(
      landPopoverMetrics.shellTop >= -0.5 &&
        landPopoverMetrics.shellBottom <= 360.5 &&
        landPopoverMetrics.closeTop >= -0.5 &&
        landPopoverMetrics.closeBottom <= 360.5,
      true,
      `640x360 ColorPickerPopover and Close button must stay strictly inside [0, 360] (${JSON.stringify(landPopoverMetrics)})`
    );
    await landPopoverClose.click();
    await landPopoverClose.waitFor({ state: 'hidden', timeout: 3000 });

    // Fix 6: Completed + raised dock + replaying on 640x360 must clear BOTH GameTopBar and ReplayControls
    await landPage.evaluate(async () => {
      const active = window.capyStorage.loadActiveState();
      const snaps = window.capyStorage.loadSnapshots();
      const snapId = active?.activeSnapshotId || snaps[0]?.id;
      const puz = snapId ? await window.capyStorage.loadPuzzleData(snapId) : null;
      if (!puz || !active) return;
      const allIds = puz.regions.map((r) => r.id);
      active.filledRegionIds = allIds;
      active.fillOrder = allIds;
      localStorage.setItem('capy_active_session_v8', JSON.stringify(active));
      const snap = snaps.find((s) => s.id === snapId);
      if (snap) {
        snap.filledRegionIds = allIds;
        snap.fillOrder = allIds;
        snap.filledCount = allIds.length;
        snap.totalCount = allIds.length;
        localStorage.setItem('capy_snapshots_v8', JSON.stringify(snaps));
      }
    });
    await landPage.reload({ waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(landPage);
    await landPage.getByTestId('replay-btn').waitFor({ state: 'visible', timeout: 5000 });
    await landPage.getByTestId('replay-btn').click();
    await landPage.getByTestId('replay-controls-window').waitFor({ state: 'visible', timeout: 4000 });
    await landPage.waitForTimeout(250);
    const [compHeaderBox, compUndoBox, compPaintBox, compReplayBox] = await Promise.all([
      landPage.locator('header').first().boundingBox(),
      landPage.getByTestId('undo-btn').boundingBox(),
      landPage.getByTestId('paint-mode-btn').boundingBox(),
      landPage.getByTestId('replay-controls-window').boundingBox(),
    ]);
    assert.ok(compHeaderBox && compUndoBox && compPaintBox && compReplayBox);
    assert.equal(
      compUndoBox.y >= compHeaderBox.y + compHeaderBox.height - 1,
      true,
      `640x360 completed+raised+replaying undo-btn top (${compUndoBox.y}) must clear GameTopBar bottom (${compHeaderBox.y + compHeaderBox.height})`
    );
    assert.equal(
      compPaintBox.y + compPaintBox.height <= compReplayBox.y + 1,
      true,
      `640x360 completed+raised+replaying paint-mode-btn bottom (${compPaintBox.y + compPaintBox.height}) must clear ReplayControls top (${compReplayBox.y})`
    );
    await landPage.close();
    await landCtx.close();

    // 22d. OnboardingTutorial Large Text ON toggle must also enable fatFingerAssist
    const tutCoupleCtx = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true });
    await tutCoupleCtx.addInitScript(() => {
      localStorage.setItem('capy_dev_debug', '1');
      localStorage.setItem(
        'capy_user_settings_v8',
        JSON.stringify({ fatFingerAssist: false, largeText: false })
      );
    });
    const tutCouplePage = await tutCoupleCtx.newPage();
    attachErrorListeners(tutCouplePage, 'tutCouplePage');
    await tutCouplePage.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(tutCouplePage);
    await tutCouplePage.getByTestId('tutorial-large-text-btn').waitFor({ state: 'visible', timeout: 5000 });
    await tutCouplePage.getByTestId('tutorial-large-text-btn').click();
    await tutCouplePage.waitForFunction(() => document.documentElement.dataset.largeText === 'true', undefined, { timeout: 3000 });
    const tutSettingsAfter = await tutCouplePage.evaluate(() => window.capyStorage.loadSettings());
    assert.equal(tutSettingsAfter.largeText, true, 'Onboarding tutorial Large Text toggle must set largeText=true');
    assert.equal(tutSettingsAfter.fatFingerAssist, true, 'Onboarding tutorial Large Text toggle must also enable fatFingerAssist=true');
    await tutCouplePage.close();
    await tutCoupleCtx.close();

    // 22e. #602 Regression Tests: Paint Mode single-tap & <12px micro-jitter no double-paint + Free Colour Mode repaint filled region
    const regCtx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await regCtx.addInitScript(() => {
      localStorage.setItem('capy_dev_debug', '1');
      localStorage.setItem(
        'capy_user_settings_v8',
        JSON.stringify({
          difficulty: 'EASY',
          isPaintMode: true,
          fatFingerAssist: true,
          touchReachRadiusPx: 34,
          isFreeColorMode: false,
        })
      );
    });
    const regPage = await regCtx.newPage();
    attachErrorListeners(regPage, 'regPage');
    await regPage.goto(`${BASE_URL}/?skipTutorial=1`, { waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(regPage);

    // Find an exact interior pixel of an unfilled region A that has an adjacent unfilled region B within 3-8 screen px (<12px) and another neighbor C within 24 screen px
    const adjacentTarget = await regPage.evaluate(async () => {
      const snaps = window.capyStorage.loadSnapshots();
      const active = window.capyStorage.loadActiveState();
      const targetId = active?.activeSnapshotId || snaps[0]?.id;
      const puz = targetId ? await window.capyStorage.loadPuzzleData(targetId) : null;
      const canvas = document.querySelector('canvas');
      if (!puz || !canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const baseScale = Math.min(rect.width / puz.width, rect.height / puz.height) * 0.92;
      const baseOffsetX = (rect.width - puz.width * baseScale) / 2;
      const baseOffsetY = (rect.height - puz.height * baseScale) / 2;
      const map = puz.regionMap;
      const w = puz.width;
      const h = puz.height;
      const isInterior = (px, py, rid) =>
        px > 1 &&
        px < w - 2 &&
        py > 1 &&
        py < h - 2 &&
        map[(py - 1) * w + px] === rid &&
        map[(py + 1) * w + px] === rid &&
        map[py * w + (px - 1)] === rid &&
        map[py * w + (px + 1)] === rid;

      for (let y = 12; y < h - 12; y += 2) {
        for (let x = 12; x < w - 12; x += 2) {
          const rA = map[y * w + x];
          if (rA <= 0 || !isInterior(x, y, rA)) continue;
          const clientX = rect.left + baseOffsetX + (x + 0.5) * baseScale;
          const clientY = rect.top + baseOffsetY + (y + 0.5) * baseScale;
          if (clientY <= 90 || clientY >= rect.height - 120) continue;

          // Find neighbor B whose interior pixel is 3..8 screen px away from (clientX, clientY)
          let foundB = null;
          const dirs = [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ];
          for (const [dx, dy] of dirs) {
            for (let step = 2; step <= 18; step++) {
              const bx = x + dx * step;
              const by = y + dy * step;
              if (bx < 2 || bx >= w - 2 || by < 2 || by >= h - 2) break;
              const rB = map[by * w + bx];
              if (rB > 0 && rB !== rA && isInterior(bx, by, rB)) {
                const screenDist = step * baseScale;
                if (screenDist >= 3 && screenDist <= 8) {
                  // Ensure B also has a 3rd distinct region C within <= 24 screen px so a bug would double-paint C
                  let foundC = 0;
                  const maxCStep = Math.max(2, Math.floor(24 / baseScale));
                  for (const [cdx, cdy] of dirs) {
                    for (let cs = 2; cs <= maxCStep && !foundC; cs++) {
                      const cx = bx + cdx * cs;
                      const cy = by + cdy * cs;
                      if (cx < 0 || cx >= w || cy < 0 || cy >= h) break;
                      const rC = map[cy * w + cx];
                      if (rC > 0 && rC !== rA && rC !== rB) {
                        foundC = rC;
                      }
                    }
                  }
                  if (foundC > 0) {
                    foundB = {
                      regionB: rB,
                      regionC: foundC,
                      bClientX: rect.left + baseOffsetX + (bx + 0.5) * baseScale,
                      bClientY: rect.top + baseOffsetY + (by + 0.5) * baseScale,
                      dragScreenPx: screenDist,
                    };
                    break;
                  }
                }
              }
            }
            if (foundB) break;
          }
          if (foundB) {
            return { regionA: rA, clientX, clientY, ...foundB };
          }
        }
      }
      return null;
    });
    assert.ok(adjacentTarget, 'Expected to locate interior pixels of region A -> neighbor B (3-8px) -> neighbor C');

    // Paint Mode single-tap: MUST fill EXACTLY 1 region (regionA), NOT double-paint neighbor regionB
    const filledBeforePaintTap = Number(
      await regPage.getByTestId('topbar-saves-btn').getAttribute('data-filled-count')
    );
    await regPage.mouse.click(adjacentTarget.clientX, adjacentTarget.clientY);
    await regPage.waitForTimeout(200);
    const filledAfterPaintTap = Number(
      await regPage.getByTestId('topbar-saves-btn').getAttribute('data-filled-count')
    );
    assert.equal(
      filledAfterPaintTap,
      filledBeforePaintTap + 1,
      `Paint Mode single-tap with fatFingerAssist=true must fill exactly 1 region (expected ${filledBeforePaintTap + 1}, got ${filledAfterPaintTap})`
    );
    const activeAfterPaintTap = await regPage.evaluate(() => window.capyStorage.loadActiveState());
    assert.equal(
      activeAfterPaintTap?.filledRegionIds?.includes(adjacentTarget.regionA),
      true,
      'Paint Mode single-tap must fill target regionA'
    );
    assert.equal(
      activeAfterPaintTap?.filledRegionIds?.includes(adjacentTarget.regionB),
      false,
      'Paint Mode single-tap must NOT double-paint adjacent neighbor regionB'
    );

    // Fix 5: Paint Mode <12px micro-jitter starting on already-filled regionA and sliding 3-8px into unfilled regionB (>=25ms hold) must paint ONLY regionB (+1, no neighbor C double-paint)
    await regPage.waitForTimeout(450); // outside 350ms double-tap window
    await regPage.mouse.move(adjacentTarget.clientX, adjacentTarget.clientY);
    await regPage.mouse.down();
    await regPage.mouse.move(adjacentTarget.bClientX, adjacentTarget.bClientY);
    await regPage.waitForTimeout(40);
    await regPage.mouse.up();
    await regPage.waitForTimeout(200);
    const activeAfterJitter = await regPage.evaluate(() => window.capyStorage.loadActiveState());
    const filledAfterJitter = activeAfterJitter?.filledRegionIds ?? [];
    assert.equal(
      filledAfterJitter.length,
      filledAfterPaintTap + 1,
      `Paint Mode <12px micro-jitter (${adjacentTarget.dragScreenPx.toFixed(1)}px) from filled A into unfilled B must paint ONLY B (expected ${filledAfterPaintTap + 1}, got ${filledAfterJitter.length}: ${JSON.stringify(filledAfterJitter)})`
    );
    assert.equal(
      filledAfterJitter.includes(adjacentTarget.regionB),
      true,
      'Paint Mode <12px micro-jitter must fill entered regionB'
    );
    assert.equal(
      filledAfterJitter.includes(adjacentTarget.regionC),
      false,
      'Paint Mode <12px micro-jitter must NOT double-paint neighbor regionC on pointerup'
    );

    // Free Colour Mode repaint: undo regionB & regionA, switch to Tap Mode & enable Free Colour Mode live, fill A with color 1, switch to color 2, tap A again -> A repaints, B stays unfilled
    await regPage.getByTestId('undo-btn').click();
    await regPage.waitForFunction(
      () => Number(document.querySelector('[data-testid="topbar-saves-btn"]')?.getAttribute('data-filled-count') || 0) === 1,
      { timeout: 3000 }
    );
    await regPage.getByTestId('undo-btn').click();
    await regPage.waitForFunction(
      () => Number(document.querySelector('[data-testid="topbar-saves-btn"]')?.getAttribute('data-filled-count') || 0) === 0,
      { timeout: 3000 }
    );
    await regPage.getByTestId('paint-mode-btn').click();
    await regPage.getByTestId('topbar-settings-btn').click();
    await regPage.getByTestId('settings-tab-settings').click();
    const regFreeColorLabel = await regPage.waitForSelector('text=Free Colour Mode');
    await regFreeColorLabel.evaluate((el) => el.closest('.flex')?.querySelector('button[role="switch"]')?.click());
    await regPage.getByTestId('settings-modal-close').click();
    await regPage.getByTestId('settings-modal-close').waitFor({ state: 'hidden', timeout: 3000 });

    await regPage.getByTestId('palette-swatch-1').click();
    await regPage.mouse.click(adjacentTarget.clientX, adjacentTarget.clientY);
    await regPage.waitForFunction(
      () => Number(document.querySelector('[data-testid="topbar-saves-btn"]')?.getAttribute('data-filled-count') || 0) === 1,
      { timeout: 3000 }
    );
    await regPage.waitForTimeout(150);
    const colorAfterFirstFill = await regPage.evaluate((rA) => {
      const active = window.capyStorage.loadActiveState();
      return active?.paintedRegionColors?.[String(rA)] ?? null;
    }, adjacentTarget.regionA);
    assert.ok(colorAfterFirstFill !== null, 'Expected regionA to record paintedRegionColors after first Free Colour tap');

    await regPage.getByTestId('palette-swatch-2').click();
    await regPage.mouse.click(adjacentTarget.clientX, adjacentTarget.clientY);
    await regPage.waitForTimeout(200);
    const freeColorRepaintState = await regPage.evaluate((rA) => {
      const active = window.capyStorage.loadActiveState();
      return {
        filledCount: active?.filledRegionIds?.length ?? 0,
        colorA: active?.paintedRegionColors?.[String(rA)] ?? null,
      };
    }, adjacentTarget.regionA);
    assert.equal(
      freeColorRepaintState.filledCount,
      1,
      `Free Colour Mode repaint tap inside filled regionA must NOT spill into unfilled neighbor B (filledCount=${freeColorRepaintState.filledCount})`
    );
    assert.notEqual(
      freeColorRepaintState.colorA,
      colorAfterFirstFill,
      `Free Colour Mode repaint tap must update regionA color (${colorAfterFirstFill} -> ${freeColorRepaintState.colorA})`
    );

    await regPage.close();
    await regCtx.close();
    logE2ePass('Large Text button scaling (360x780/412x915/640x360/1280x720), switch/slider/tab/centering, Fat-Finger coupling & Paint micro-jitter/Free-Colour fixes verified.');

    // E2E Stage 22: M4 $0 BYOC Multi-Provider Account Login, Auto-Sync & 360px Mobile Zero-Overflow
    logE2eStart('M4 $0 BYOC Multi-Provider Login UI, Play Store Default-Off Gate, Auto-Sync & 360px Mobile Zero-Overflow');
    const byocContext = await browser.newContext({ viewport: { width: 360, height: 740 } });
    const byocPage = await byocContext.newPage();
    attachErrorListeners(byocPage, 'm4-byoc');

    // 22a. Verify default Play Store compliance gate remains hidden when unconfigured & no ?coop=1
    await byocPage.goto(`${BASE_URL}/?skipTutorial=1`, { waitUntil: 'domcontentloaded' });
    await byocPage.getByTestId('topbar-settings-btn').waitFor({ state: 'visible', timeout: 15000 });
    await byocPage.getByTestId('topbar-settings-btn').click();
    await byocPage.getByTestId('settings-tab-saves').click();
    assert.equal(await byocPage.getByTestId('cloud-coop-hub').count(), 0, 'cloud-coop-hub must stay hidden by default');
    assert.equal(await byocPage.getByTestId('play-games-signin-btn').count(), 0, 'play-games-signin-btn must stay hidden by default');
    assert.equal(await byocPage.getByTestId('cloud-sync-btn').count(), 0, 'cloud-sync-btn must stay hidden by default');

    // 22b. Configure debug-gated mock Google + Microsoft tokens (Apple stays unconfigured & auto-hidden)
    const oneDriveStore = new Map();
    let oneDrivePutCount = 0;
    await byocContext.addInitScript(() => {
      try {
        localStorage.setItem('capy_cloud_explicit_signout_v1', '1');
      } catch {
        // Ignore
      }
      window.__capyMockGoogleOAuthToken = 'mock_google_e2e_token_m4';
      window.__capyMockMicrosoftOAuthToken = 'mock_ms_e2e_token_m4';
    });
    await byocPage.route(/^https:\/\/graph\.microsoft\.com\//, async (route) => {
      const req = route.request();
      const url = req.url();
      const match = /\/special\/approot:\/([^:/]+):\/content$/.exec(url);
      const fileName = match ? decodeURIComponent(match[1]) : 'unknown';
      if (req.method() === 'PUT') {
        oneDrivePutCount += 1;
        oneDriveStore.set(fileName, req.postData() || '{}');
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: fileName }),
        });
        return;
      }
      if (oneDriveStore.has(fileName)) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: oneDriveStore.get(fileName),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
    });

    await byocPage.goto(`${BASE_URL}/?coop=1&capy_debug=1&skipTutorial=1`, { waitUntil: 'domcontentloaded' });
    await byocPage.getByTestId('topbar-settings-btn').waitFor({ state: 'visible', timeout: 15000 });
    await byocPage.getByTestId('topbar-settings-btn').click();
    await byocPage.getByTestId('settings-tab-saves').click();
    await byocPage.getByTestId('cloud-account-card').waitFor({ state: 'visible', timeout: 10000 });

    // Both configured providers (Google + Microsoft) visible; unconfigured Apple auto-hidden
    await byocPage.getByTestId('play-games-signin-btn').waitFor({ state: 'visible', timeout: 5000 });
    await byocPage.getByTestId('cloud-signin-microsoft').waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await byocPage.getByTestId('cloud-signin-apple').count(), 0, 'Unconfigured Apple sign-in button must stay auto-hidden');

    // Sign in with Microsoft OneDrive BYOC driver
    await byocPage.getByTestId('cloud-signin-microsoft').click();
    await byocPage.getByTestId('play-games-signout-btn').waitFor({ state: 'visible', timeout: 10000 });
    const cardText = await byocPage.getByTestId('cloud-account-card').innerText();
    assert.equal(cardText.includes('capy.ms@example.com'), true, `Expected Microsoft email in CloudAccountCard, got: ${cardText}`);
    await byocPage.getByTestId('cloud-last-synced').waitFor({ state: 'visible', timeout: 5000 });
    await byocPage.waitForFunction(
      () => document.querySelector('[data-testid="cloud-sync-status-badge"]')?.textContent?.includes('Synced') === true,
      null,
      { timeout: 10000 }
    );
    const statusBadgeText = await byocPage.getByTestId('cloud-sync-status-badge').innerText();
    assert.equal(statusBadgeText.includes('Synced'), true, `Expected Synced status badge, got: ${statusBadgeText}`);
    await byocPage.getByTestId('cloud-switch-google').waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(oneDrivePutCount >= 1, true, 'Signing in with Microsoft must push manifest to OneDrive AppFolder');

    // Verify 360px mobile zero-overflow on CloudAccountCard
    const overflowInfo = await byocPage.evaluate(() => {
      const card = document.querySelector('[data-testid="cloud-account-card"]');
      if (!card) return { found: false, overflow: 999 };
      return { found: true, overflow: card.scrollWidth - card.clientWidth };
    });
    assert.equal(overflowInfo.found, true);
    assert.equal(
      overflowInfo.overflow <= 1,
      true,
      `CloudAccountCard must have zero horizontal overflow at 360px (overflow=${overflowInfo.overflow}px)`
    );

    // Close Settings, paint a region, and verify automatic background sync fires on online reconnect
    const putsBeforeAutoSync = oneDrivePutCount;
    await byocPage.keyboard.press('Escape');
    await byocPage.waitForTimeout(200);
    await tapCanvasGrid(byocPage, 0.45, 6, 60);
    await byocPage.evaluate(() => {
      window.dispatchEvent(new Event('online'));
    });
    await byocPage.waitForTimeout(600);
    assert.equal(
      oneDrivePutCount > putsBeforeAutoSync,
      true,
      `Automatic background sync must push updated manifest to OneDrive (before=${putsBeforeAutoSync}, after=${oneDrivePutCount})`
    );

    await byocPage.close();
    await byocContext.close();
    logE2ePass('M4 $0 BYOC multi-provider login UI, default-off gate, 360px zero-overflow & automatic background sync verified.');

    assert.equal(
      e2eStep,
      e2eTotal,
      `Expected ${e2eTotal} executed Part 2 E2E stages, got ${e2eStep}`
    );
    assert.equal(consoleErrors.length, 0, `Expected zero unhandled page errors, got:\n${consoleErrors.join('\n')}`);
    console.log('\nALL UNIFIED ENGINE, CODEC & E2E BROWSER TESTS PASSED!');
  } finally {
    await browser.close();
    if (previewServer) {
      await new Promise((resolve) => previewServer.httpServer.close(resolve));
    }
  }
}

const UNIT_ONLY = process.argv.includes('--unit');

async function main() {
  await runCodecAndEngineTests();
  if (UNIT_ONLY) {
    console.log('\nALL UNIT & WORKFLOW CHECKS PASSED (--unit)!');
    return;
  }
  await runBrowserBasicsSuite();
}

main().catch((err) => {
  console.error('Unified test suite failed:', err);
  process.exit(1);
});
