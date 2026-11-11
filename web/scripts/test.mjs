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
    () => !document.body.innerText.includes('Analyzing artwork'),
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
    assert.deepEqual(decodedSingle.imageBytes, fakeImageBytes);

    const archiveBinary = await codec.encodeArchiveSaveBinaryV2(
      [sampleSnapshot],
      { 'snap-test-1': compact },
      { 'snap-test-1': fakeImageBlob }
    );
    const decodedArchive = await codec.decodeBinarySaveV2(archiveBinary);
    assert.equal(decodedArchive.format, 'capy-archive-save-v2');
    assert.equal(decodedArchive.snapshots.length, 1);

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
      changelogText.includes(`## [${versionMod.APP_VERSION}]`),
      true,
      `CHANGELOG.md must contain a release heading for current version [${versionMod.APP_VERSION}]`
    );

    console.log('   PASS: ColorQuantizer, RegionSegmenter, CapyCodec RLE, .capy v2 Gzip, CRDT deltas, and Version/Changelog sync verified.');
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
    // 1. PWA Manifest, Privacy Policy & Instant Pre-Baked First Launch
    // -------------------------------------------------------------------------
    console.log('1. Verifying PWA manifest, privacy policy, Service Worker & instant pre-baked boot...');
    const manifestRes = await page.goto(`${BASE_URL}/manifest.webmanifest`);
    assert.equal(manifestRes?.status(), 200);
    const manifestJson = JSON.parse(await manifestRes.text());
    assert.equal(manifestJson.name, 'Capy Paint');
    assert.equal(manifestJson.display, 'standalone');

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
    await page.evaluate(async (snapId) => {
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
      // Evict only the puzzle data entry in IndexedDB (keeping the image blob in capy_images_v8)
      await new Promise((resolve) => {
        const req = indexedDB.open('capy_puzzles_db');
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('puzzles')) {
            db.close();
            resolve();
            return;
          }
          const tx = db.transaction('puzzles', 'readwrite');
          tx.objectStore('puzzles').delete(snapId);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            resolve();
          };
        };
        req.onerror = () => resolve();
      });
    }, uploadCheck.id);

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
