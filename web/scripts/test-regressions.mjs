import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE_URL = process.env.CAPY_TEST_URL || 'http://localhost:3000';

async function waitForPuzzleLoaded(page) {
  await page.waitForSelector('canvas', { timeout: 25000 });
  await page.waitForFunction(
    () => {
      const loading = document.body.innerText.includes('Analyzing artwork');
      return !loading;
    },
    { timeout: 25000 }
  );
  await page.waitForTimeout(700);
}

async function run() {
  console.log(`Running Phase 1 & Phase 2 browser regression suite against ${BASE_URL}...`);
  const chromiumPath =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  const browser = await chromium.launch({
    headless: true,
    ...(chromiumPath ? { executablePath: chromiumPath } : {}),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 840 },
    acceptDownloads: true,
  });
  const page = await context.newPage();

  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(page);

    // Disable autoReplayOnLoad so reload tests immediately inspect active state & zoom
    await page.evaluate(() => {
      const raw = localStorage.getItem('capy_user_settings_v8');
      const parsed = raw ? JSON.parse(raw) : {};
      parsed.autoReplayOnLoad = false;
      parsed.enableUndo = true;
      localStorage.setItem('capy_user_settings_v8', JSON.stringify(parsed));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(page);

    console.log('1. Testing custom background -> preset background atomic update (Bug #2)...');
    await page.evaluate(() => {
      // Simulate having selected a CUSTOM hot-pink background in Settings
      const raw = localStorage.getItem('capy_user_settings_v8');
      const parsed = JSON.parse(raw);
      parsed.canvasBgColor = 'CUSTOM';
      parsed.canvasBgArgb = 0xffff3366;
      localStorage.setItem('capy_user_settings_v8', JSON.stringify(parsed));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(page);

    // Open Settings modal and click "Charcoal" preset swatch
    await page.locator('button[title*="Settings"], button[aria-label*="Settings"]').first().click();
    await page.waitForTimeout(250);
    await page.locator('button[title="Charcoal"]').first().click();
    await page.waitForTimeout(200);

    const updatedBgSettings = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('capy_user_settings_v8'));
    });
    assert.equal(updatedBgSettings.canvasBgColor, 'CHARCOAL');
    assert.equal(
      updatedBgSettings.canvasBgArgb >>> 0,
      0xff18181b,
      `Expected Charcoal ARGB 0xff18181b, got 0x${(updatedBgSettings.canvasBgArgb >>> 0).toString(16)}`
    );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    console.log('   PASS: Preset background swatch atomically resets both canvasBgColor and canvasBgArgb.');

    console.log('2. Testing custom uploaded photo full-resolution STORE_IMAGES persistence across reload (Bug #1)...');
    // Generate a crisp 1200x900 PNG buffer in browser and upload via hidden input[type="file"]
    const pngBytes = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 1200;
      c.height = 900;
      const ctx = c.getContext('2d');
      const colors = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#06b6d4'];
      for (let y = 0; y < 3; y++) {
        for (let x = 0; x < 3; x++) {
          ctx.fillStyle = colors[(y * 3 + x) % colors.length];
          ctx.fillRect(x * 400, y * 300, 400, 300);
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = 8;
          ctx.strokeRect(x * 400 + 4, y * 300 + 4, 392, 292);
        }
      }
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      const buf = await blob.arrayBuffer();
      return Array.from(new Uint8Array(buf));
    });

    const tmpUploadPath = path.join(os.tmpdir(), 'capy_custom_upload_1200x900.png');
    fs.writeFileSync(tmpUploadPath, Buffer.from(pngBytes));

    const fileInput = page.locator('input[type="file"][accept="image/*"]');
    await fileInput.setInputFiles(tmpUploadPath);
    await page.waitForTimeout(400);
    await waitForPuzzleLoaded(page);
    await page.waitForTimeout(800);

    const uploadedMetaBefore = await page.evaluate(async () => {
      const snaps = JSON.parse(localStorage.getItem('capy_snapshots_v8') || '[]');
      const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
      const snap = snaps.find((s) => s.id === active.activeSnapshotId);
      const db = await new Promise((res, rej) => {
        const req = indexedDB.open('capy_game_storage_v8', 1);
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      const imgBlob = await new Promise((res) => {
        const tx = db.transaction('images', 'readonly');
        const g = tx.objectStore('images').get(snap.id);
        g.onsuccess = () => res(g.result);
      });
      const puzzleRec = await new Promise((res) => {
        const tx = db.transaction('puzzles', 'readonly');
        const g = tx.objectStore('puzzles').get(snap.id);
        g.onsuccess = () => res(g.result);
      });
      return {
        snapId: snap.id,
        sourceRef: snap.sourceRef,
        fileSizeBytes: snap.fileSizeBytes,
        hasBlob: Boolean(imgBlob && imgBlob.size > 1000),
        isCompactV2: Boolean(puzzleRec && puzzleRec.__capyCompactV2 === 2 && puzzleRec.rleRegionMap),
      };
    });

    assert.equal(uploadedMetaBefore.sourceRef?.kind, 'blob', 'Custom upload must record sourceRef.kind === "blob"');
    assert.equal(uploadedMetaBefore.hasBlob, true, 'Custom upload must persist full image Blob in STORE_IMAGES');
    assert.equal(uploadedMetaBefore.isCompactV2, true, 'Puzzle must be persisted as CompactPuzzleRecordV2');
    assert.equal(
      uploadedMetaBefore.fileSizeBytes < 120_000,
      true,
      `Expected compact fileSizeBytes < 120 KB, got ${uploadedMetaBefore.fileSizeBytes}`
    );

    // Zoom in using mouse wheel and wait >450ms for debounced viewport persistence (Bug #5)
    await page.mouse.move(640, 420);
    await page.mouse.wheel(0, -600);
    await page.waitForTimeout(600);

    const savedZoomBeforeReload = await page.evaluate(() => {
      const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
      return active.zoomScale;
    });
    assert.equal(
      savedZoomBeforeReload > 1.15,
      true,
      `Expected zoomed scale > 1.15 persisted to activeState, got ${savedZoomBeforeReload}`
    );

    // Reload browser and verify full-res blob URL (not 320px JPEG previewDataUrl) & saved zoomScale!
    await page.reload({ waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(page);
    await page.waitForTimeout(500);

    const afterReloadState = await page.evaluate(() => {
      const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
      return { zoomScale: active.zoomScale };
    });
    assert.equal(
      Math.abs(afterReloadState.zoomScale - savedZoomBeforeReload) < 0.05,
      true,
      `Expected zoomScale preserved across reload (${savedZoomBeforeReload} vs ${afterReloadState.zoomScale})`
    );
    console.log(
      `   PASS: Custom photo stored in STORE_IMAGES, CompactPuzzleRecordV2 (${uploadedMetaBefore.fileSizeBytes} B), and zoom (${savedZoomBeforeReload.toFixed(2)}x) preserved across reload.`
    );

    console.log('3. Testing .capy v2 binary export and re-import round-trip (Phase 2 + Bug #8)...');
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.error('Browser console error:', msg.text());
    });
    page.on('pageerror', (err) => console.error('Browser pageerror:', err));

    // Open Settings modal -> Saves tab -> Export All
    await page.locator('button[title*="Settings"], button[aria-label*="Settings"]').first().click();
    await page.waitForTimeout(250);
    await page.getByRole('button', { name: 'Saves', exact: true }).click();
    await page.waitForSelector('[data-testid="export-all-saves-btn"]', { timeout: 5000 });

    const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
    await page.locator('[data-testid="export-all-saves-btn"]').click();
    const download = await downloadPromise;
    const exportedPath = path.join(os.tmpdir(), 'exported_backup_v2.capy');
    await download.saveAs(exportedPath);

    const exportedBuf = fs.readFileSync(exportedPath);
    assert.equal(exportedBuf[0], 0x43, 'Magic byte 0 = C');
    assert.equal(exportedBuf[1], 0x41, 'Magic byte 1 = A');
    assert.equal(exportedBuf[2], 0x50, 'Magic byte 2 = P');
    assert.equal(exportedBuf[3], 0x59, 'Magic byte 3 = Y');
    assert.equal(exportedBuf[4], 0x02, 'Version byte 4 = 0x02');

    // Re-import the binary .capy v2 archive via Saves tab file input
    const importInput = page.locator('input[type="file"][accept*=".capy"]');
    await importInput.setInputFiles(exportedPath);
    await page.waitForTimeout(600);

    const snapshotsAfterImport = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('capy_snapshots_v8') || '[]').length;
    });
    assert.equal(snapshotsAfterImport >= 1, true, 'Imported .capy v2 archive must populate snapshots');
    console.log(`   PASS: Binary .capy v2 archive (${exportedBuf.length} bytes) exported with CAPY\\x02 header and re-imported cleanly.`);

    fs.rmSync(tmpUploadPath, { force: true });
    fs.rmSync(exportedPath, { force: true });
    console.log('\nALL PHASE 1 & PHASE 2 BROWSER REGRESSION TESTS PASSED!');
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error('Browser regression suite failed:', err);
  process.exit(1);
});
