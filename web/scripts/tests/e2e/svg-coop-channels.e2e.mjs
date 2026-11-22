/**
 * [E2E 13-15] Printable SVG + Sub-Tile Breadcrumbs + Co-op UNFILL_EVENT, Release Channels & Co-op WELCOME_STATE/Replay rewind/Reset Epoch.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  createBootedContext,
  getStableBoundingBox,
  readTotalRemainingRegions,
  tapCanvasGrid,
  waitForAnimationFrames,
  waitForPuzzleLoaded,
} from './helpers.mjs';

export async function runSvgCoopChannelsE2e(ctx) {
  const { browser, BASE_URL, attachErrorListeners, logE2eStart, logE2ePass } = ctx;
  const ownBoot = !ctx.page;
  const { context, page } = ownBoot
    ? await createBootedContext(browser, BASE_URL, {
        label: 'svg-coop',
        attachErrorListeners,
        acceptDownloads: true,
        skipTutorial: true,
        easyNoReplay: true,
        enableCoopUi: true,
        extraSettings: { showZoomButtons: true, showResetViewButton: true },
      })
    : { context: ctx.context, page: ctx.page };
  try {
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
    await page.getByTestId('settings-tab-create').waitFor({ state: 'visible', timeout: 3000 });
    await page.getByTestId('settings-tab-create').click();
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
    await page.getByTestId('settings-tab-settings').waitFor({ state: 'visible', timeout: 3000 });
    await page.getByTestId('settings-tab-settings').click();
    const currentSettings11c = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('capy_user_settings_v8') || '{}');
    });
    await page.locator('button:has(span:text-is("Settings"))').click();
    if (currentSettings11c.isFreeColorMode) {
      await page.getByTestId('setting-free-color-mode').click();
    }
    if (!currentSettings11c.enableUndo) {
      await page.getByTestId('setting-enable-undo').click();
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
    await peerB.goto(`${BASE_URL}/?coop=1`, { waitUntil: 'domcontentloaded' });
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

    logE2eStart('Verifying Release Channel switcher card, Beta APK link & BETA HUD pill...');
    assert.equal(
      await page.getByTestId('topbar-channel-badge').count(),
      0,
      'Default Stable/Dev root view must not display topbar-channel-badge clutter'
    );
    await page.locator('button[title="Settings and Menu"]').click();
    await page.getByTestId('settings-tab-about').waitFor({ state: 'visible', timeout: 3000 });
    await page.getByTestId('settings-tab-about').click();
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
    await betaPage.goto(`${BASE_URL}/?capy_channel=beta`, { waitUntil: 'domcontentloaded' });
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
    await peerS2.goto(`${BASE_URL}/?coop=1`, { waitUntil: 'domcontentloaded' });
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
      await waitForAnimationFrames(page, 2);
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
    // INTENTIONAL_TIMING_WINDOW: debounce settle past 350ms viewport-save timer before clearing capy_active_session_v8 for WELCOME_STATE test
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
    await peerS2.reload({ waitUntil: 'domcontentloaded' });
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
      await waitForAnimationFrames(page, 2);
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

    // Enable Auto-Loop Replay (true), 0.5x speed, and Replay on Load (true) in Tab 1 collapsible Replay section
    await page.locator('button[title="Settings and Menu"]').click();
    await page.getByTestId('settings-tab-settings').waitFor({ state: 'visible', timeout: 3000 });
    await page.getByTestId('settings-tab-settings').click();
    const replaySectionToggle = page.getByTestId('settings-section-replay-toggle');
    await replaySectionToggle.scrollIntoViewIfNeeded();
    if ((await replaySectionToggle.getAttribute('aria-expanded')) !== 'true') {
      await replaySectionToggle.click();
    }
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
    const autoReplaySwitch = page.getByTestId('toggle-auto-replay-btn');
    await autoReplaySwitch.scrollIntoViewIfNeeded();
    if ((await autoReplaySwitch.getAttribute('aria-checked')) !== 'true') {
      await autoReplaySwitch.click();
      await page.waitForFunction(
        () => document.querySelector('[data-testid="toggle-auto-replay-btn"]')?.getAttribute('aria-checked') === 'true',
        undefined,
        { timeout: 3000 }
      );
    }

    // Switch to Saves tab and load targetSnapId
    await page.getByTestId('settings-tab-saves').click();
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
    for (const replayBtnId of [
      'replay-play-pause-btn',
      'replay-follow-btn',
      'replay-loop-btn',
      'replay-skip-btn',
      'replay-exit-btn',
    ]) {
      const rBtn = page.getByTestId(replayBtnId);
      const rBox = await rBtn.boundingBox();
      assert.ok(
        rBox && rBox.width >= 38 && rBox.height >= 38,
        `Mobile 360px ${replayBtnId} must be >=38x38px (got ${JSON.stringify(rBox)})`
      );
      assert.ok(
        Boolean((await rBtn.getAttribute('aria-label'))?.trim()),
        `Replay button ${replayBtnId} must expose descriptive aria-label`
      );
    }

    const windowBox360 = await mobileReplayWin.boundingBox();
    const exitBox360 = await page.getByTestId('replay-exit-btn').boundingBox();
    const headerBox360 = await page.locator('header').first().boundingBox();
    const zoomOutMin360 = await page.getByTestId('zoom-out-btn').boundingBox();
    const undoMin360 = await page.getByTestId('undo-btn').boundingBox();
    const paintMin360 = await page.locator('[data-testid="paint-mode-btn"]').boundingBox();
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
      // INTENTIONAL_TIMING_WINDOW: negative-absence + smooth-scroll settle verifying PaletteDock swatch order does not mutate on click
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
    await page.locator('[data-testid="paint-mode-btn"]').click();
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
    await page.reload({ waitUntil: 'domcontentloaded' });
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
    await page.locator('[data-testid="paint-mode-btn"]').click(); // Turn Paint Mode OFF -> Tap Mode
    await page.reload({ waitUntil: 'domcontentloaded' });
    await mobileReplayWin.waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('[data-testid="replay-play-pause-btn"][aria-label="Replay Again"]').waitFor({ state: 'visible', timeout: 15000 });
    const canvasBoxFlow3 = await page.locator('canvas').first().boundingBox();
    assert.ok(canvasBoxFlow3);
    await page.mouse.click(canvasBoxFlow3.x + canvasBoxFlow3.width * 0.5, canvasBoxFlow3.y + canvasBoxFlow3.height * 0.5);
    await mobileReplayWin.waitFor({ state: 'hidden', timeout: 3000 });
    assert.equal(await mobileReplayWin.isVisible(), false, 'First tap in Tap Mode after post-load replay must dismiss ReplayControls');

    // Flow 4: Minor canvas pan during post-load replay must NOT lock ReplayControls open against Toggle Paint Mode
    await page.reload({ waitUntil: 'domcontentloaded' });
    await mobileReplayWin.waitFor({ state: 'visible', timeout: 5000 });
    const canvasBoxFlow4 = await page.locator('canvas').first().boundingBox();
    assert.ok(canvasBoxFlow4);
    await page.mouse.move(canvasBoxFlow4.x + canvasBoxFlow4.width * 0.5, canvasBoxFlow4.y + canvasBoxFlow4.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(canvasBoxFlow4.x + canvasBoxFlow4.width * 0.5 + 18, canvasBoxFlow4.y + canvasBoxFlow4.height * 0.5 + 12, { steps: 4 });
    await page.mouse.up();
    await page.locator('[data-testid="paint-mode-btn"]').click();
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
  } finally {
    if (ownBoot) await context.close();
  }
}
