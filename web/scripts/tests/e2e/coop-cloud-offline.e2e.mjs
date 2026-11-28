/**
 * [E2E 08-12] Share links/Co-op/Drive CRDT/Saves export, custom photo upload & offline PWA, BF-2/BF-6 recovery, Controls & Daily Puzzle/Stats.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createBootedContext,
  getSettingsBtn,
  tapCanvasGrid,
  waitForAnimationFrames,
  waitForPuzzleLoaded,
} from './helpers.mjs';

export async function runCoopCloudOfflineE2e(ctx) {
  const { browser, BASE_URL, projectRoot, attachErrorListeners, logE2eStart, logE2ePass } = ctx;
  const ownBoot = !ctx.page;
  const { context, page } = ownBoot
    ? await createBootedContext(browser, BASE_URL, {
        label: 'coop',
        attachErrorListeners,
        acceptDownloads: true,
        permissions: ['clipboard-read', 'clipboard-write'],
        skipTutorial: true,
        easyNoReplay: true,
        extraSettings: { showZoomButtons: true, showResetViewButton: true },
      })
    : { context: ctx.context, page: ctx.page };
  const settingsBtn = getSettingsBtn(page);
  try {
    logE2eStart('Verifying < 2 KB Share Link (#s=), 2-peer BroadcastChannel Co-op, Google Drive CRDT sync, Saves views & .capy v2 export...');
    await page.evaluate(() => localStorage.setItem('capy_dev_cloud_coop_ui', '1'));
    await page.reload({ waitUntil: 'domcontentloaded' });
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
    await pageRecipient.goto(sharedUrl, { waitUntil: 'domcontentloaded' });
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
    await pageB.goto(`${BASE_URL}/?coop=1`, { waitUntil: 'domcontentloaded' });
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
    const settingsTabBtn = page.getByTestId('settings-tab-settings');
    await settingsTabBtn.waitFor({ state: 'visible', timeout: 3000 });
    await settingsTabBtn.click();
    await page.getByTestId('setting-free-color-mode').click();
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

    // Undo moves/zooms the viewport to focus on the undone region; reset back to 1x before the 1x quadrant burst
    await page.keyboard.press('0');
    await page.waitForFunction(
      () => {
        const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
        const zoom = active.zoomScale ?? 1;
        const panX = active.panOffsetX ?? 0;
        const panY = active.panOffsetY ?? 0;
        return !document.querySelector('[data-testid="reset-view-btn"]') && Math.abs(zoom - 1) < 0.02 && Math.hypot(panX, panY) < 2;
      },
      undefined,
      { timeout: 3000 }
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
    await page.getByTestId('setting-free-color-mode').click();
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
    await page.reload({ waitUntil: 'domcontentloaded' });
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
    await page.reload({ waitUntil: 'domcontentloaded' });
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
    const exportedPath = path.join(os.tmpdir(), `capy_unified_test_backup_${process.pid}.capy`);
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
    const tmpUploadPath = path.join(os.tmpdir(), `capy_test_upload_${process.pid}.png`);
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

    // Ensure Service Worker is active and controlling this isolated context before zooming & offline reload
    await page.evaluate(async () => {
      if ('serviceWorker' in navigator) {
        await navigator.serviceWorker.ready;
      }
    });
    const isControlled = await page.evaluate(() => Boolean(navigator.serviceWorker?.controller));
    if (!isControlled) {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForPuzzleLoaded(page);
    }

    // Zoom in on the custom puzzle, mark all regions completed, and verify offline reload + post-completion Replay preserves viewport without zooming out
    const zoomInUpload = await page.waitForSelector('[data-testid="zoom-in-btn"]');
    await zoomInUpload.click();
    await zoomInUpload.click();
    await zoomInUpload.click();
    await page.waitForFunction(
      () => (JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}').zoomScale || 1) >= 1.9,
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
    await page.getByTestId('settings-tab-settings').click();

    const zoomSensSlider = page.getByTestId('setting-zoom-sensitivity');
    await zoomSensSlider.waitFor({ state: 'visible', timeout: 5000 });
    await zoomSensSlider.fill('1.6');

    const snapZoomToggle = page.getByTestId('setting-snap-zoom-levels');
    await snapZoomToggle.click();

    const soundVolumeSlider = page.getByTestId('setting-sound-volume');
    await soundVolumeSlider.fill('0.45');

    const soundEnabledToggle = page.getByTestId('setting-sound-enabled');
    await soundEnabledToggle.click();
    assert.equal(
      await soundVolumeSlider.isDisabled(),
      true,
      'Sound Volume slider must disable when Sound Effects is toggled off'
    );

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
    await page.getByTestId('settings-tab-create').click();
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
    await page.getByTestId('settings-tab-create').click();

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
    await page.getByTestId('settings-tab-settings').click();
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
    await page.getByTestId('settings-tab-create').click();
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
    await page.getByTestId('settings-tab-about').click();
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
  } finally {
    if (ownBoot) await context.close();
  }
}
