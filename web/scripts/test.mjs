import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import zlib from 'node:zlib';
import { chromium } from 'playwright';
import { createServer, preview } from 'vite';
import {
  runSanityChecks,
  validateChangelogChannelOrder,
  validateEpicNaming,
  validateRootGuideIndex,
} from './sanity.mjs';

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

    // 5. Semantic Versioning, Fast <2s Sanity Gate & CHANGELOG.md Synchronization
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
    let changelogBulletRe = /\s(?:\[#\d+\]\(https:\/\/github\.com\/[^/\s]+\/capy\/pull\/\d+\)|#\d+)$/;
    /* capy-dev-only:start */
    changelogBulletRe = /\s\[#\d+\]\(https:\/\/github\.com\/shthed\/capy\/pull\/\d+\)$/;
    /* capy-dev-only:end */
    for (const bullet of changelogBullets) {
      assert.equal(
        changelogBulletRe.test(bullet),
        true,
        `Each CHANGELOG.md bullet must end with a valid PR reference: ${bullet}`
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

    const validEpicUrl = 'https://github.com/' + 'capyboop/capy/issues/477';
    const validPrRef = '[' + '#482](' + 'https://github.com/' + 'capyboop/capy/pull/482)';
    validateEpicNaming(`See [EPIC-2](${validEpicUrl}), plain EPIC-2, and ${validPrRef}`, 'DEV.md');
    for (const badNum of ['476', '477', '480']) {
      assert.throws(
        () => validateEpicNaming(`Legacy #'${badNum}`.replace("'", ''), 'TODO.md'),
        /EPIC-N/
      );
    }
    const badIssueLink = '[' + '#481](' + 'https://github.com/' + 'capyboop/capy/issues/481)';
    assert.throws(() => validateEpicNaming(`Link ${badIssueLink}`, 'ROADMAP.md'), /EPIC-N/);
    const badCombinedEpic = '[EPIC-2 (' + '#477)](' + validEpicUrl + ')';
    assert.throws(() => validateEpicNaming(`Combined ${badCombinedEpic}`, 'AGENTS.md'), /EPIC-N/);
    const badUnlinkedCombinedEpic = '[EPIC-6 (#' + '481)]';
    assert.throws(() => validateEpicNaming(`Unlinked ${badUnlinkedCombinedEpic}`, 'ROADMAP.md'), /EPIC-N/);

    const tmpGuideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capy-guide-index-'));
    try {
      const rootMdNames = [
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
      for (const name of rootMdNames) {
        fs.writeFileSync(path.join(tmpGuideDir, name), `# ${name}\n`, 'utf8');
      }
      const allLinks = rootMdNames.map((n) => `[${n}](./${n})`).join(' ');
      fs.writeFileSync(path.join(tmpGuideDir, 'README.md'), `# README\n${allLinks}\n`, 'utf8');
      fs.writeFileSync(path.join(tmpGuideDir, 'DEV.md'), `# DEV\n${allLinks}\n`, 'utf8');
      fs.writeFileSync(path.join(tmpGuideDir, 'PROJECT.md'), `# PROJECT\n${allLinks}\n`, 'utf8');
      const guideRes = validateRootGuideIndex(tmpGuideDir, { requireProjectMd: true });
      assert.equal(guideRes.hasProjectMd, true);
      assert.equal(guideRes.rootMdFiles.length, 13);

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
    const tmpStrictRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'capy-sanity-strict-'));
    try {
      fs.mkdirSync(path.join(tmpStrictRepo, 'web/src'), { recursive: true });
      fs.mkdirSync(path.join(tmpStrictRepo, 'app'), { recursive: true });
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
      for (const name of strictRootMds) {
        if (name === 'CHANGELOG.md') continue;
        fs.writeFileSync(path.join(tmpStrictRepo, name), `# ${name}\n${strictAllLinks}\n`, 'utf8');
      }
      const makeStrictChangelog = ({
        headings = ['### 3.0.4 - 2026-11-13 (Beta)', '### 3.0.1 - 2026-11-12 (Production)', '### 0.1.0 - 2026-10-01'],
        bulletCount = 398,
        firstBulletSuffix = '[#493](https://github.com/shthed/capy/pull/493)',
      } = {}) => {
        const lines = [headings[0], '', `- Top change ${firstBulletSuffix}`, ''];
        for (let i = 1; i < headings.length; i++) {
          lines.push(headings[i], '');
          if (i === headings.length - 1) {
            for (let b = 1; b < bulletCount; b++) {
              lines.push(`- Historical change ${b} [#${b}](https://github.com/shthed/capy/pull/${b})`);
            }
          } else {
            lines.push(`- Channel release [#${i}](https://github.com/shthed/capy/pull/${i})`, '');
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
      });
      assert.equal(strictRes.version, '3.0.4');
      assert.equal(strictRes.markdownFilesChecked, 13);

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
          }),
        /PROJECT\.md must link \.\/TESTING\.md/
      );

      // 4. Legacy Epic issue ref fails when enforceEpicNaming: true
      fs.writeFileSync(
        path.join(tmpStrictRepo, 'PROJECT.md'),
        `# PROJECT\n${strictAllLinks}\nSee #` + '477\n',
        'utf8'
      );
      assert.throws(
        () =>
          runSanityChecks({
            repoRoot: tmpStrictRepo,
            requireProjectMd: true,
            enforceChannelOrder: true,
            enforceEpicNaming: true,
          }),
        /EPIC-N/
      );
      fs.writeFileSync(path.join(tmpStrictRepo, 'PROJECT.md'), `# PROJECT\n${strictAllLinks}\n`, 'utf8');

      // 5. Bare #490 bullet fails clickable PR link check
      fs.writeFileSync(
        strictChangelogPath,
        makeStrictChangelog({ firstBulletSuffix: '#490' }),
        'utf8'
      );
      assert.throws(
        () =>
          runSanityChecks({
            repoRoot: tmpStrictRepo,
            requireProjectMd: true,
            enforceChannelOrder: true,
            enforceEpicNaming: true,
          }),
        /Invalid CHANGELOG bullet suffix/
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
      });
      assert.equal(strictCrlfRes.version, '3.0.4');
      fs.writeFileSync(strictChangelogPath, makeStrictChangelog(), 'utf8');

      // 7. Missing PROJECT.md fails requireProjectMd: true
      fs.unlinkSync(path.join(tmpStrictRepo, 'PROJECT.md'));
      assert.throws(
        () =>
          runSanityChecks({
            repoRoot: tmpStrictRepo,
            requireProjectMd: true,
            enforceChannelOrder: true,
            enforceEpicNaming: true,
          }),
        /PROJECT\.md must exist/
      );
    } finally {
      fs.rmSync(tmpStrictRepo, { recursive: true, force: true });
    }
    /* capy-dev-only:end */

    // Unit-test .github/scripts/cleanup-gh-pages-previews.mjs and .github/scripts/cleanup-branches.mjs
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
        const runRes = await previewCleanupMod.runCleanupGhPagesPreviews({
          pagesDir: tmpPages,
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
      await branchCleanupMod.runCleanupBranches({
        repository: 'a/b',
        token: 'tok',
        dryRun: true,
        includePrefixes: ['dependabot/', 'sync/'],
        minAgeDays: 1,
        unmergedMinAgeDays: 7,
        nowMs,
        baseDelayMs: 1,
        sleepImpl: async () => {},
        fetchImpl: createMockFetch(dryDeletes),
      });
      assert.equal(dryDeletes.length, 0);

      const liveDeletes = [];
      const liveRes = await branchCleanupMod.runCleanupBranches({
        repository: 'a/b',
        token: 'tok',
        dryRun: false,
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

    // 11. capypaint.com canonical ShareLinkService, Co-op WS auto-discovery & Cloudflare Worker protocol
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
    assert.equal(relayProtoMod.isAllowedRelayOrigin('https://capyboop.github.io'), true);
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
        distSwText.includes(".endsWith('.apk')"),
        true,
        'Service Worker must bypass .apk binary downloads'
      );
    }

    // --- Sprint 2: F8 CRDT resetEpoch & F9 >180KB Play Games Chunks ---
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
      } finally {
        globalThis.window = prevWindow;
      }
    }

    /* capy-dev-only:start */
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
      'Repo https://github.com/capyboop/capy (`capyboop`) #482 #477 Sprint 1 preview https://capypaint.com/'
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
    assert.equal(FORBIDDEN_PERSONA_REGEX.test('sync-beta-from-main'), true);
    assert.equal(FORBIDDEN_PERSONA_REGEX.test('.github/dependabot.yml'), true);
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
      'Add Cloudflare Worker for capyboop/capy'
    );
    const tmpLeakCheck = fs.mkdtempSync(path.join(os.tmpdir(), 'capy-leak-check-'));
    try {
      fs.writeFileSync(path.join(tmpLeakCheck, 'ok.yml'), 'if: actor != "dependabot[bot]"\n', 'utf8');
      assert.equal(assertZeroSourcePersonaLeak(tmpLeakCheck), 1);
      fs.writeFileSync(path.join(tmpLeakCheck, 'leak.md'), 'See sync-beta-from-main workflow\n', 'utf8');
      assert.throws(() => assertZeroSourcePersonaLeak(tmpLeakCheck), /Forbidden persona token/);
    } finally {
      fs.rmSync(tmpLeakCheck, { recursive: true, force: true });
    }
    const tmpCleanStage = fs.mkdtempSync(path.join(os.tmpdir(), 'capy-clean-stage-'));
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
      const stagedRedirects = fs.readFileSync(
        path.join(tmpCleanStage, 'web/public/_redirects'),
        'utf8'
      );
      assert.equal(
        stagedRedirects.includes('https://github.com/capyboop/capy/releases/latest/download/capy.apk'),
        true
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
    } finally {
      fs.rmSync(tmpCleanStage, { recursive: true, force: true });
    }

    // Extract and unit-test real GitHub Actions script blocks from pr-review-gate.yml & open-pr.yml
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

    const runReviewGateScript = new AsyncFunction(
      'context',
      'github',
      'core',
      extractWorkflowScript('.github/workflows/pr-review-gate.yml')
    );

    const runReviewGateCase = async ({
      prAuthor = 'github-actions[bot]',
      baseRef = 'main',
      isDraft = false,
      headSha = 'abcdef1234567890abcdef1234567890abcdef12',
      commitDate = '2026-11-13T01:00:00Z',
      labels = ['review:ai-approved'],
      events = [],
      reviews = [],
      comments = [],
      aiCommentScore = 98,
      aiCommentTs = '2026-11-13T01:01:00Z',
      eventName = 'pull_request_review',
      action = 'submitted',
      createCommitStatusImpl = null,
      expectCommitStatus = true,
    } = {}) => {
      const calls = {
        createReview: [],
        dismissReview: [],
        removeLabel: [],
        createCommitStatus: [],
      };
      const allComments = [...comments];
      if (aiCommentScore !== null) {
        allComments.unshift({
          user: { login: 'shthed' },
          body: `<!-- capy-review: actor=ai-agent verdict=APPROVED sha=${headSha} score=${aiCommentScore}% -->`,
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
        rest: {
          pulls: {
            get: async () => ({
              data: {
                number: 490,
                state: 'open',
                draft: isDraft,
                user: { login: prAuthor },
                base: { ref: baseRef },
                head: { sha: headSha },
                labels: labels.map((name) => ({ name })),
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
          },
          repos: {
            getCommit: async () => ({
              data: { commit: { committer: { date: commitDate }, author: { date: commitDate } } },
            }),
            listCommitStatusesForRef: async () => ({ data: [] }),
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
      await runReviewGateScript(contextMock, githubMock, coreMock);
      assert.equal(coreMock.failed.length, 0);
      if (expectCommitStatus) {
        assert.equal(calls.createCommitStatus.length, 1);
      }
      return { status: calls.createCommitStatus[0], calls, core: coreMock };
    };

    const gateHeadSha = '1234567890abcdef1234567890abcdef12345678';
    // (a) Bot PR + empty-body native APPROVED with commit_id === headSha and future commitMs clock skew
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
    assert.equal(
      gateBotNativeRes.status.description,
      'Dual-approved: AI review (>=95%) + Owner sign-off verified'
    );
    assert.equal(gateBotNativeRes.calls.createReview.length, 0);

    // (b) Bot PR + review:owner-approved label only -> pending awaiting Project Owner sign-off
    const gateBotLabelOnlyRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      labels: ['review:ai-approved', 'review:owner-approved'],
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
    assert.equal(
      gateBotLabelOnlyRes.status.description,
      'AI review passed; awaiting Project Owner sign-off'
    );
    assert.equal(gateBotLabelOnlyRes.calls.createReview.length, 0);

    // (c) Bot PR + APPROVED/LGTM comment only -> pending awaiting Project Owner sign-off
    const gateBotCommentOnlyRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
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
    assert.equal(
      gateBotCommentOnlyRes.status.description,
      'AI review passed; awaiting Project Owner sign-off'
    );
    assert.equal(gateBotCommentOnlyRes.calls.createReview.length, 0);

    const gateBotLgtmReviewOnlyRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
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
    assert.equal(
      gateBotLgtmReviewOnlyRes.status.description,
      'AI review passed; awaiting Project Owner sign-off'
    );
    assert.equal(gateBotLgtmReviewOnlyRes.calls.createReview.length, 0);

    // (d) Bot PR + stale APPROVED (commit_id !== headSha) or pre-force-push -> pending
    const gateBotStaleShaRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
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
    assert.equal(
      gateBotStaleShaRes.status.description,
      'AI review passed; awaiting Project Owner sign-off'
    );
    assert.equal(gateBotStaleShaRes.calls.createReview.length, 0);

    const gateBotPreForcePushRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
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

    // (e) Bot PR + native APPROVED followed by CHANGES_REQUESTED on headSha (with commitMs skew) -> failure
    const gateBotChangesReqRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T02:00:00Z',
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
      gateBotChangesReqRes.status.description,
      'Changes requested or hold active; address feedback before merge'
    );
    assert.equal(gateBotChangesReqRes.calls.createReview.length, 0);

    // (f) Manual shthed-authored PR + label/comment -> pending (no bot APPROVE rubber-stamping); native APPROVED -> success with stale bot review dismissed
    const gateManualLabelRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'main',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      labels: ['review:ai-approved', 'review:owner-approved'],
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
    assert.equal(
      gateManualLabelRes.status.description,
      'AI review passed; awaiting Project Owner sign-off'
    );
    assert.equal(gateManualLabelRes.calls.createReview.length, 0);

    const gateManualCommentRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'main',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
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
    assert.equal(
      gateManualCommentRes.status.description,
      'AI review passed; awaiting Project Owner sign-off'
    );
    assert.equal(gateManualCommentRes.calls.createReview.length, 0);

    const gateManualLgtmCommentRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'main',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
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
    assert.equal(
      gateManualLgtmCommentRes.status.description,
      'AI review passed; awaiting Project Owner sign-off'
    );
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
    assert.equal(gateManualMainNativeNoBotReviewRes.calls.createReview.length, 0);
    assert.equal(gateManualMainNativeNoBotReviewRes.calls.dismissReview.length, 1);

    // (g) Draft bot PR -> pending even with native APPROVED
    const gateBotDraftRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      isDraft: true,
      headSha: gateHeadSha,
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
    assert.equal(
      gateBotDraftRes.status.description,
      'Draft PR: complete work, pass AI review, and mark ready'
    );
    assert.equal(gateBotDraftRes.calls.createReview.length, 0);

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
    assert.equal(
      gateBotChangesReqApprovedPrefixRes.status.description,
      'Changes requested or hold active; address feedback before merge'
    );
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
    assert.equal(
      gateBotRecoverySkewRes.status.description,
      'Dual-approved: AI review (>=95%) + Owner sign-off verified'
    );
    assert.equal(gateBotRecoverySkewRes.calls.createReview.length, 0);

    // (j) Bot PR + DISMISSED native APPROVED -> ignored (pending)
    const gateBotDismissedRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
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
    assert.equal(
      gateBotDismissedRes.status.description,
      'AI review passed; awaiting Project Owner sign-off'
    );
    assert.equal(gateBotDismissedRes.calls.createReview.length, 0);

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
    assert.equal(
      gateBotLegacyAfterRejectCommentRes.status.description,
      'Changes requested or hold active; address feedback before merge'
    );
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
    assert.equal(
      gateBotChangesReqLegacyLgtmAndLabelRes.status.description,
      'Changes requested or hold active; address feedback before merge'
    );
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
    assert.equal(
      gateBotLegacyAfterPriorNativeAndRejectRes.status.description,
      'Changes requested or hold active; address feedback before merge'
    );
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
    assert.equal(
      gateBotSkewHoldCommentRes.status.description,
      'Changes requested or hold active; address feedback before merge'
    );
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
    assert.equal(
      gateBotSkewNonHeadCommentedReviewRes.status.description,
      'Changes requested or hold active; address feedback before merge'
    );
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
    assert.equal(
      gateBotSkewHeadCommentedReviewRes.status.description,
      'Changes requested or hold active; address feedback before merge'
    );
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
    assert.equal(
      gateBotSkewStalePrePushHoldWithApprovalRes.status.description,
      'Dual-approved: AI review (>=95%) + Owner sign-off verified'
    );
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
    assert.equal(
      gateSameSecRejectWinsByIdRes.status.description,
      'Changes requested or hold active; address feedback before merge'
    );
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
    assert.equal(
      gateSameSecApproveSupersedesByIdRes.status.description,
      'Dual-approved: AI review (>=95%) + Owner sign-off verified'
    );
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
    assert.equal(
      gateBetaAiOnlyPassRes.status.description,
      'Beta gate passed: AI review (>=95%) verified; no holds'
    );
    assert.equal(gateBetaAiOnlyPassRes.calls.createReview.length, 0);
    assert.equal(gateBetaAiOnlyPassRes.calls.dismissReview.length, 1);

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
          body: `<!-- capy-review: actor=ai-agent verdict=APPROVED sha=${gateHeadSha} score=98% -->`,
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
    assert.equal(
      gateBetaMissingAiRes.status.description,
      'Beta gate: awaiting AI review (review:ai-approved) on HEAD'
    );

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

    const gateDependabotMainCommentOnlyRes = await runReviewGateCase({
      prAuthor: 'dependabot[bot]',
      baseRef: 'main',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
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
    assert.equal(gateDependabotMainCommentOnlyRes.status.state, 'pending');
    assert.equal(
      gateDependabotMainCommentOnlyRes.status.description,
      'AI review passed; awaiting Project Owner sign-off'
    );

    const gateDependabotMainNativeRes = await runReviewGateCase({
      prAuthor: 'dependabot[bot]',
      baseRef: 'main',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      reviews: [
        {
          id: 306,
          user: { login: 'shthed' },
          state: 'APPROVED',
          commit_id: gateHeadSha,
          body: '',
          submitted_at: '2026-11-13T01:05:00Z',
        },
      ],
    });
    assert.equal(gateDependabotMainNativeRes.status.state, 'success');
    assert.equal(gateDependabotMainNativeRes.calls.createReview.length, 0);

    // sync/beta-from-main PRs follow --base beta rules uniformly (draft -> pending, ready without AI -> pending, ready with AI -> success)
    const gateSyncBetaPassRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      isDraft: false,
      headSha: gateHeadSha,
    });
    assert.equal(gateSyncBetaPassRes.status.state, 'success');
    assert.equal(gateSyncBetaPassRes.calls.createReview.length, 0);

    // Retargeting an AI-approved PR from beta to main via pull_request edited immediately requires Owner sign-off
    const gateRetargetBetaToMainRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'main',
      isDraft: false,
      headSha: gateHeadSha,
      eventName: 'pull_request',
      action: 'edited',
    });
    assert.equal(gateRetargetBetaToMainRes.status.state, 'pending');
    assert.equal(
      gateRetargetBetaToMainRes.status.description,
      'AI review passed; awaiting Project Owner sign-off'
    );

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
          body: `<!-- capy-review: actor=ai-agent verdict=APPROVED sha=${gateHeadSha} score=98% -->`,
          submitted_at: '2026-11-13T01:05:00Z',
        },
      ],
    });
    assert.equal(gateDismissedAiReviewIgnoredRes.status.state, 'pending');
    assert.equal(
      gateDismissedAiReviewIgnoredRes.status.description,
      'Beta gate: awaiting AI review (review:ai-approved) on HEAD'
    );
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
          body: `<!-- capy-review: actor=ai-agent verdict=APPROVED sha=${gateHeadSha} score=99% -->`,
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
      aiCommentScore: 98,
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
    assert.equal(
      gateDraftPreservesChangesRequestedRes.status.description,
      'Changes requested or hold active; address feedback before merge'
    );
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
    assert.equal(
      gateSynchronizeClearsAllReviewLabelsRes.status.description,
      'Beta gate: awaiting AI review (review:ai-approved) on HEAD'
    );
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
      gateDraftSynchronizeClearsAllReviewLabelsRes.status.description,
      'Draft PR: complete work, pass AI review, and mark ready'
    );
    assert.deepEqual(
      gateDraftSynchronizeClearsAllReviewLabelsRes.calls.removeLabel.map((r) => r.name),
      ['review:ai-approved', 'review:owner-approved', 'review:changes-requested']
    );

    // Extract and unit-test real .github/workflows/open-pr.yml script
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

    // Extract and unit-test .github/workflows/deploy-branch.yml target script & Phase 2 workflow invariants
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

    const deployYaml = fs.readFileSync(
      path.resolve(projectRoot, '../.github/workflows/deploy-branch.yml'),
      'utf8'
    );
    assert.equal(deployYaml.includes('github.event.inputs.target_branch'), true);
    assert.equal(deployYaml.includes('actions/cache@v6'), true);
    assert.equal(deployYaml.includes("github.base_ref == 'main' || github.base_ref == 'beta'"), true);
    assert.equal(deployYaml.includes("github.event.pull_request.user.login != 'dependabot[bot]'"), true);
    assert.equal(deployYaml.includes('steps.target.outputs.is_docs_only'), true);
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

    const dependabotYaml = fs.readFileSync(
      path.resolve(projectRoot, '../.github/dependabot.yml'),
      'utf8'
    );
    assert.equal(dependabotYaml.includes('package-ecosystem: "npm"'), true);
    assert.equal(dependabotYaml.includes('package-ecosystem: "gradle"'), true);
    assert.equal(dependabotYaml.includes('package-ecosystem: "github-actions"'), true);
    assert.equal(dependabotYaml.includes('target-branch: "beta"'), true);
    /* capy-dev-only:end */

    console.log('   PASS: ColorQuantizer, RegionSegmenter, CapyCodec RLE & DoS guards, .capy v2 Gzip, CRDT deltas, SoundService, Zoom Detents, DailyPuzzleService, PlayerStatsService, SvgPrintExporter, Cloudflare Worker Co-op Relay, and Version/Changelog sync verified.');
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
    assert.equal(bootMeta.firstId, 'sample-capybara');
    assert.equal(bootMeta.swReady, true);
    assert.equal(bootMeta.hasScopedCache, true, `Expected Service Worker cache ${expectedSwCacheKey}`);
    assert.equal(bootMeta.hasLegacyCache, false, 'Legacy unscoped capy-cache-v2 must not exist');

    // Verify malformed #s= DoS token degrades cleanly without crashing the app
    const dosSharePage = await context.newPage();
    attachErrorListeners(dosSharePage, 'dosSharePage');
    await dosSharePage.goto(`${BASE_URL}/#s=AAIAAf____8P`, { waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(dosSharePage);
    await dosSharePage.close();

    // Verify Google Login button auto-hides on Web when VITE_GOOGLE_CLIENT_ID is unconfigured
    const hasBakedClientId = Boolean((process.env.VITE_GOOGLE_CLIENT_ID || '').trim());
    await page.locator('button[title="Settings and Menu"]').click();
    await page.waitForTimeout(150);
    await page.getByRole('button', { name: 'Saves', exact: true }).click();
    await page.waitForTimeout(120);
    await page.getByTestId('cloud-provider-badge-google').waitFor({ state: 'visible' });
    assert.equal(
      await page.getByTestId('play-games-signin-btn').count(),
      hasBakedClientId ? 1 : 0,
      'Web Google Login button must auto-hide when VITE_GOOGLE_CLIENT_ID is empty'
    );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

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

    // Prebaked sample viewport reset regression check (date-independent, reproduces zoomed reload -> 1x cycle -> prebaked load)
    await zoomBadge.click();
    assert.equal((await zoomBadge.innerText()).trim(), '2x', 'Expected zoomBadge to step to 2x before reload');
    await page.waitForTimeout(420);
    await page.reload({ waitUntil: 'load' });
    await waitForPuzzleLoaded(page);

    for (let guard = 0; guard < 6; guard++) {
      const text = (await zoomBadge.innerText()).trim();
      if (text === '1x') break;
      await zoomBadge.click();
    }
    assert.equal((await zoomBadge.innerText()).trim(), '1x', 'Expected zoomBadge to cycle back to 1x after zoomed reload');

    await page.locator('button[title="Settings and Menu"]').click();
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    const snailCard = page.getByTestId('gallery-card-snail_guitar');
    await snailCard.waitFor({ state: 'visible', timeout: 5000 });
    await snailCard.getByRole('button', { name: 'Play', exact: true }).click();
    await waitForPuzzleLoaded(page);
    await page.waitForTimeout(200);

    assert.equal(
      (await zoomBadge.innerText()).trim(),
      '1x',
      'Expected prebaked sample load after zoomed reload to reset zoom badge to 1x'
    );
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

    // Step to 2x before Play Daily so 10a also verifies daily puzzle launch resets non-1x zoom
    await zoomBadge.click();
    assert.equal((await zoomBadge.innerText()).trim(), '2x', 'Expected zoomBadge to step to 2x before Play Daily');

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

    // -------------------------------------------------------------------------
    // 12. Stage 2 (v2.7): Co-op Welcome Persistence, Replay Rewind UNFILL, Reset Epoch & Mobile Replay Controls
    // -------------------------------------------------------------------------
    console.log('-> [2.7] Verifying Co-op WELCOME_STATE persistence, Replay Scrubber rewind UNFILL, Reset Epoch & Mobile Replay Controls...');

    // 12a. F7 & F8 (BUG-1, M-08, F-01): 2-peer BroadcastChannel WELCOME_STATE reload persistence, Replay Resume Here UNFILL & Reset Progress resetEpoch
    // Reset active puzzle cleanly first so both Peer A and localStorage start at 0 filled regions
    await page.getByTestId('topbar-coop-btn').click();
    await page.waitForTimeout(150);
    await page.getByTestId('reset-progress-btn').click();
    await page.waitForTimeout(450);

    const totalPuzzleRegions27 = await readTotalRemainingRegions(page);
    assert.ok(totalPuzzleRegions27 > 10, `Expected > 10 total puzzle regions after reset, got ${totalPuzzleRegions27}`);

    // Boot Peer B while localStorage has 0 filled regions (100% deterministic, zero debounce race)
    const peerS2 = await context.newPage();
    attachErrorListeners(peerS2, 'peerS2-stage2');
    await peerS2.goto(BASE_URL, { waitUntil: 'networkidle' });
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
    await page.waitForTimeout(150);
    await page.getByTestId('host-coop-room-btn').click();
    await page.waitForTimeout(200);
    const s2RoomText = await page.getByTestId('active-coop-room-code').innerText();
    const s2RoomCode = s2RoomText.match(/Room\s+([A-Z0-9]{6})/)[1];
    await page.keyboard.press('Escape');
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
    await peerS2.waitForTimeout(150);
    await peerS2.getByTestId('join-coop-room-input').fill(s2RoomCode);
    await peerS2.getByTestId('join-coop-room-btn').click();
    await peerS2.waitForTimeout(450);
    await peerS2.keyboard.press('Escape');
    await peerS2.waitForTimeout(150);

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
    assert.equal(
      await readTotalRemainingRegions(peerS2),
      remainingPeerABeforeJoin,
      'BUG-1: Reloading joining peer immediately after WELCOME_STATE must retain all welcomed regions'
    );

    // Rejoin s2RoomCode on Peer B so both peers are live for Replay Rewind & Reset Progress sync
    await peerS2.getByTestId('topbar-coop-btn').click();
    await peerS2.waitForTimeout(150);
    await peerS2.getByTestId('join-coop-room-input').fill(s2RoomCode);
    await peerS2.getByTestId('join-coop-room-btn').click();
    await peerS2.waitForTimeout(350);
    await peerS2.keyboard.press('Escape');
    await peerS2.waitForTimeout(150);

    // Launch Replay on Peer A via Saves -> Replay, scrub backward to step 1, and click Resume Here
    await page.getByTestId('topbar-coop-btn').click();
    await page.waitForTimeout(150);
    await page.getByTestId(`save-card-${peerAStateBeforeRoom.activeSnapshotId}`).click();
    await page.waitForTimeout(100);
    await page.getByTestId('save-action-replay').click();

    await page.getByTestId('replay-controls-window').waitFor({ state: 'visible', timeout: 5000 });
    await page.getByTestId('replay-toggle-minimize-btn').click();
    await page.waitForTimeout(120);
    await page.getByTestId('replay-scrubber').fill('1');
    await page.waitForTimeout(120);
    await page.getByTestId('replay-resume-btn').click();
    await page.waitForTimeout(200);
    await peerS2.waitForTimeout(400);

    const remainingAfterRewindA = await readTotalRemainingRegions(page);
    const remainingAfterRewindB = await readTotalRemainingRegions(peerS2);
    assert.equal(
      remainingAfterRewindA,
      totalPuzzleRegions27 - 1,
      `Expected Replay Resume Here at step 1 to leave exactly 1 filled region on Peer A (${totalPuzzleRegions27 - 1} remaining), got ${remainingAfterRewindA}`
    );
    assert.equal(
      remainingAfterRewindB,
      remainingAfterRewindA,
      'BUG-1: Replay Scrubber Resume Here must broadcast UNFILL_EVENT so Peer B rewinds in lockstep'
    );

    // Trigger Reset Progress on Peer A and verify Peer B clears to 0 filled regions + resetEpoch increments
    await page.getByTestId('topbar-coop-btn').click();
    await page.waitForTimeout(150);
    await page.getByTestId('reset-progress-btn').click();
    await page.waitForTimeout(200);
    await peerS2.waitForTimeout(400);

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
    await page.waitForTimeout(150);
    await page.getByTestId('leave-coop-room-btn').click();
    await page.waitForTimeout(120);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);

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
    await page.waitForTimeout(150);
    await page.getByTestId('topbar-coop-btn').click();
    await page.waitForTimeout(150);
    await page.getByTestId(`save-card-${mobileReplaySetup.otherSnapId}`).click();
    await page.waitForTimeout(100);
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
    await page.waitForTimeout(150);
    await page.locator('button', { hasText: /^Settings$/ }).first().click();
    await page.waitForTimeout(120);
    const settingsLoopToggle = page.getByTestId('toggle-replay-loop-btn');
    await settingsLoopToggle.scrollIntoViewIfNeeded();
    if ((await settingsLoopToggle.getAttribute('aria-checked')) !== 'true') {
      await settingsLoopToggle.click();
      await page.waitForTimeout(80);
    }
    assert.equal(
      await settingsLoopToggle.getAttribute('aria-checked'),
      'true',
      'Precondition: Auto-Loop Replay must be enabled before loading saved puzzle'
    );
    const speedHalfBtn = page.locator('button', { hasText: /^0\.5x$/ }).first();
    await speedHalfBtn.scrollIntoViewIfNeeded();
    await speedHalfBtn.click();
    await page.waitForTimeout(80);

    // Switch to Saves tab, ensure Replay on Load is enabled, and load targetSnapId
    await page.locator('button', { hasText: /^Saves$/ }).first().click();
    await page.waitForTimeout(120);
    const autoReplaySavesSwitch = page.getByTestId('toggle-auto-replay-saves-btn');
    if ((await autoReplaySavesSwitch.getAttribute('aria-checked')) !== 'true') {
      await autoReplaySavesSwitch.click();
      await page.waitForTimeout(80);
    }
    await page.getByTestId(`save-card-${mobileReplaySetup.targetSnapId}`).click();
    await page.waitForTimeout(100);
    await page.getByTestId('save-action-load').click();

    const mobileReplayWin = page.getByTestId('replay-controls-window');
    await mobileReplayWin.waitFor({ state: 'visible', timeout: 8000 });
    assert.equal(
      await mobileReplayWin.getAttribute('data-minimized'),
      'true',
      'Loaded save replay HUD must open minimized on mobile'
    );
    assert.equal(
      await page.getByTestId('replay-loop-btn').getAttribute('aria-pressed'),
      'false',
      'Loading a puzzle save must immediately force replayLoop OFF (aria-pressed="false")'
    );

    const windowBox360 = await mobileReplayWin.boundingBox();
    const exitBox360 = await page.getByTestId('replay-exit-btn').boundingBox();
    assert.ok(windowBox360 && exitBox360, 'Expected visible bounding boxes for replay-controls-window and replay-exit-btn at 360x800');
    assert.ok(
      exitBox360.x >= windowBox360.x + 4 &&
        exitBox360.x + exitBox360.width <= windowBox360.x + windowBox360.width - 4,
      `Minimized ReplayControls X button (${exitBox360.x}..${exitBox360.x + exitBox360.width}) must fit strictly inside 360px mobile pill border (${windowBox360.x}..${windowBox360.x + windowBox360.width})`
    );

    // Wait for loaded save replay to finish and verify it automatically closes ReplayControls and resumes gameplay
    await mobileReplayWin.waitFor({ state: 'hidden', timeout: 10000 });
    await page.locator('[aria-label="Palette dock"]').waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(
      await page.evaluate(
        () => Boolean(JSON.parse(localStorage.getItem('capy_user_settings_v8') || '{}').replayLoop)
      ),
      false,
      'Persisted capy_user_settings_v8.replayLoop must remain false after save-load replay auto-resumes gameplay'
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
    await page.waitForTimeout(120);
    console.log('   PASS: 360px mobile ReplayControls fit, save-load replayLoop reset & auto-resume, Co-op WELCOME_STATE persistence, Replay Scrubber rewind UNFILL, and CRDT resetEpoch verified.');

    // 12f. Mobile (360x780) GameTopBar two-lane non-overlap with BETA pill + zoomed badge
    const mobileTopbarPage = await context.newPage();
    attachErrorListeners(mobileTopbarPage, 'mobileTopbarPage');
    await mobileTopbarPage.setViewportSize({ width: 360, height: 780 });
    await mobileTopbarPage.goto(`${BASE_URL}/?capy_channel=beta`, { waitUntil: 'networkidle' });
    await mobileTopbarPage.locator('canvas').first().waitFor({ state: 'visible', timeout: 15000 });
    await mobileTopbarPage.getByTestId('topbar-channel-badge').waitFor({ state: 'visible', timeout: 5000 });
    await mobileTopbarPage.getByTestId('topbar-zoom-badge').click();
    await mobileTopbarPage.waitForTimeout(100);

    const leftLaneBox = await mobileTopbarPage.getByTestId('topbar-left-lane').boundingBox();
    const rightLaneBox = await mobileTopbarPage.getByTestId('topbar-right-lane').boundingBox();
    const savesBox = await mobileTopbarPage.getByTestId('topbar-saves-btn').boundingBox();
    const channelBox = await mobileTopbarPage.getByTestId('topbar-channel-badge').boundingBox();
    const zoomBox = await mobileTopbarPage.getByTestId('topbar-zoom-badge').boundingBox();
    const settingsBox = await mobileTopbarPage.locator('button[title="Settings and Menu"]').boundingBox();

    assert.ok(leftLaneBox && rightLaneBox && savesBox && channelBox && zoomBox && settingsBox);
    assert.equal(
      leftLaneBox.x + leftLaneBox.width <= rightLaneBox.x,
      true,
      `topbar-left-lane (${leftLaneBox.x + leftLaneBox.width}) must not overlap topbar-right-lane (${rightLaneBox.x}) at 360x780`
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
    await mobileTopbarPage.close();
    console.log('   PASS: 360x780 mobile GameTopBar two-lane non-overlap with BETA and zoom badges verified.');

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
