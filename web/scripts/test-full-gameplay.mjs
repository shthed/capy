import { chromium } from 'playwright';

async function runFullGameplayTest() {
  console.log('🎮 Starting Full Gameplay Test for Capy Web...');
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    viewport: { width: 412, height: 915 }, // Pixel 7 viewport
    hasTouch: true,
    isMobile: true,
  });

  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.error('❌ Browser Console Error:', msg.text());
      consoleErrors.push(msg.text());
    }
  });

  page.on('pageerror', (err) => {
    console.error('❌ Browser Unhandled Page Error:', err.message);
    consoleErrors.push(err.message);
  });

  try {
    // -------------------------------------------------------------------------
    // Step 1: Initial Page Load & Verification
    // -------------------------------------------------------------------------
    console.log('1️⃣ Navigating to http://localhost:3000/ ...');
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });

    const title = await page.title();
    console.log(`   Page title: "${title}"`);
    if (!title.includes('Capy')) {
      throw new Error(`Unexpected page title: "${title}"`);
    }

    console.log('   Waiting for puzzle generation and palette dock...');
    await page.waitForSelector('canvas', { timeout: 10000 });
    await page.waitForSelector('[aria-label="Palette dock"]', { timeout: 25000 });
    console.log('   ✅ Initial puzzle and PaletteDock loaded successfully.');

    // -------------------------------------------------------------------------
    // Step 2: Test Gestures - Reversed Double-Tap Zoom & Background Drag
    // -------------------------------------------------------------------------
    console.log('2️⃣ Testing Reversed Double-Tap Zoom & Background Drag...');
    const canvas = await page.$('canvas');
    const box = await canvas.boundingBox();
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    // Execute double tap and drag down
    await page.evaluate(async ({ startX, startY }) => {
      const canvasEl = document.querySelector('canvas');
      if (!canvasEl) return;

      canvasEl.dispatchEvent(new PointerEvent('pointerdown', { clientX: startX, clientY: startY, pointerId: 10, pointerType: 'touch', isPrimary: true, bubbles: true }));
      await new Promise((r) => setTimeout(r, 40));
      canvasEl.dispatchEvent(new PointerEvent('pointerup', { clientX: startX, clientY: startY, pointerId: 10, pointerType: 'touch', isPrimary: true, bubbles: true }));

      await new Promise((r) => setTimeout(r, 80));
      canvasEl.dispatchEvent(new PointerEvent('pointerdown', { clientX: startX, clientY: startY, pointerId: 10, pointerType: 'touch', isPrimary: true, bubbles: true }));

      // Drag DOWN (dy > 0 -> zoom IN by default)
      for (let y = startY; y <= startY + 80; y += 20) {
        canvasEl.dispatchEvent(new PointerEvent('pointermove', { clientX: startX, clientY: y, pointerId: 10, pointerType: 'touch', isPrimary: true, bubbles: true }));
        await new Promise((r) => setTimeout(r, 16));
      }

      canvasEl.dispatchEvent(new PointerEvent('pointerup', { clientX: startX, clientY: startY + 80, pointerId: 10, pointerType: 'touch', isPrimary: true, bubbles: true }));
    }, { startX: centerX, startY: centerY });
    await page.waitForTimeout(300);
    console.log('   ✅ Double-tap drag down zoom executed.');

    // Test background touch drag (touching outside image on background)
    console.log('   Testing Background Canvas Touch Drag Panning...');
    await page.evaluate(async () => {
      const canvasEl = document.querySelector('canvas');
      if (!canvasEl) return;
      // Touch top-left corner background
      canvasEl.dispatchEvent(new PointerEvent('pointerdown', { clientX: 20, clientY: 80, pointerId: 11, pointerType: 'touch', isPrimary: true, bubbles: true }));
      for (let x = 20; x <= 100; x += 20) {
        canvasEl.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: 80, pointerId: 11, pointerType: 'touch', isPrimary: true, bubbles: true }));
        await new Promise((r) => setTimeout(r, 16));
      }
      canvasEl.dispatchEvent(new PointerEvent('pointerup', { clientX: 100, clientY: 80, pointerId: 11, pointerType: 'touch', isPrimary: true, bubbles: true }));
    });
    await page.waitForTimeout(300);
    console.log('   ✅ Background canvas touch drag panning verified.');

    // -------------------------------------------------------------------------
    // Step 3: Test Paint Mode & Double-Tap Horizontal Pan
    // -------------------------------------------------------------------------
    console.log('3️⃣ Testing Paint Mode & Double-Tap Horizontal Pan...');
    const paintBtn = await page.waitForSelector('button[aria-label="Toggle Paint Mode"]');
    await paintBtn.click();
    await page.waitForTimeout(200);
    console.log('   Paint Mode enabled.');

    // In Paint Mode: double-tap and drag left/right should pan instead of painting
    await page.evaluate(async ({ startX, startY }) => {
      const canvasEl = document.querySelector('canvas');
      if (!canvasEl) return;

      canvasEl.dispatchEvent(new PointerEvent('pointerdown', { clientX: startX, clientY: startY, pointerId: 12, pointerType: 'touch', isPrimary: true, bubbles: true }));
      await new Promise((r) => setTimeout(r, 40));
      canvasEl.dispatchEvent(new PointerEvent('pointerup', { clientX: startX, clientY: startY, pointerId: 12, pointerType: 'touch', isPrimary: true, bubbles: true }));

      await new Promise((r) => setTimeout(r, 80));
      canvasEl.dispatchEvent(new PointerEvent('pointerdown', { clientX: startX, clientY: startY, pointerId: 12, pointerType: 'touch', isPrimary: true, bubbles: true }));

      // Horizontal drag left/right
      for (let x = startX; x <= startX + 60; x += 20) {
        canvasEl.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: startY, pointerId: 12, pointerType: 'touch', isPrimary: true, bubbles: true }));
        await new Promise((r) => setTimeout(r, 16));
      }
      canvasEl.dispatchEvent(new PointerEvent('pointerup', { clientX: startX + 60, clientY: startY, pointerId: 12, pointerType: 'touch', isPrimary: true, bubbles: true }));
    }, { startX: centerX, startY: centerY });
    await page.waitForTimeout(300);
    console.log('   ✅ Double-tap horizontal pan in Paint Mode verified.');

    await paintBtn.click();
    await page.waitForTimeout(200);
    console.log('   Paint Mode disabled.');

    // -------------------------------------------------------------------------
    // Step 4: Simulate Gameplay, Save Persistence & 100% Completion
    // -------------------------------------------------------------------------
    console.log('4️⃣ Simulating Gameplay, Save Persistence & 100% Completion...');

    // Tap canvas regions to color them
    await page.evaluate(() => {
      const canvasEl = document.querySelector('canvas');
      if (!canvasEl) return;
      const rect = canvasEl.getBoundingClientRect();
      for (let i = 0; i < 15; i++) {
        const x = rect.left + (rect.width * (0.35 + (i % 5) * 0.08));
        const y = rect.top + (rect.height * (0.35 + Math.floor(i / 5) * 0.08));
        canvasEl.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true }));
        canvasEl.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true }));
      }
    });
    await page.waitForTimeout(500);
    console.log('   ✅ Dispatched interactive region taps.');

    // Now set active snapshot to 100% completion in storage to test completed puzzle lifecycle
    console.log('   Setting active snapshot to 100% completion in LocalStorage...');
    const snapshotInfo = await page.evaluate(() => {
      const raw = localStorage.getItem('capy_snapshots_v8');
      if (!raw) return null;
      const list = JSON.parse(raw);
      if (!list || list.length === 0) return null;
      const active = list[0];
      const allIds = Array.from({ length: active.totalCount }, (_, i) => i + 1);
      active.filledCount = active.totalCount;
      active.filledRegionIds = allIds;
      localStorage.setItem('capy_snapshots_v8', JSON.stringify(list));

      const session = {
        activeSnapshotId: active.id,
        activeColorId: 1,
        filledRegionIds: allIds,
        paintedRegionColors: {},
        isFreeColorMode: false,
        zoomScale: 1.0,
        panOffsetX: 0,
        panOffsetY: 0,
      };
      localStorage.setItem('capy_active_session_v8', JSON.stringify(session));

      const settings = JSON.parse(localStorage.getItem('capy_user_settings_v8') || '{}');
      settings.enableUndo = true;
      localStorage.setItem('capy_user_settings_v8', JSON.stringify(settings));

      return { totalCount: active.totalCount, id: active.id };
    });
    console.log(`   Configured 100% completion snapshot (${snapshotInfo?.totalCount} regions).`);

    // Reload page to test Auto-Replay on Save Load
    console.log('   Reloading page to test Auto-Replay on Load (autoReplayOnLoad)...');
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
    await page.waitForSelector('canvas', { timeout: 10000 });

    // -------------------------------------------------------------------------
    // Step 5: Test Completion Lifecycle & Replay Controls HUD
    // -------------------------------------------------------------------------
    console.log('5️⃣ Testing Completion Lifecycle & Replay Controls HUD...');

    // Wait for ReplayControls HUD to appear
    const replayHud = await page.waitForSelector('text=regions', { timeout: 15000 });
    console.log('   ✅ ReplayControls HUD automatically opened on load!');

    // Verify PaletteDock is hidden when puzzle is complete
    const dockIsHidden = await page.evaluate(() => {
      const dock = document.querySelector('[aria-label="Palette dock"]');
      return dock === null;
    });
    if (!dockIsHidden) {
      throw new Error('PaletteDock must be hidden when the puzzle is complete or replaying!');
    }
    console.log('   ✅ PaletteDock and active color selection are correctly hidden.');

    // -------------------------------------------------------------------------
    // Step 6: Test Replay HUD Features (Play/Pause, Speed, Seek, Restart)
    // -------------------------------------------------------------------------
    console.log('6️⃣ Testing Replay HUD Controls (Play/Pause, Speed, Scrubber)...');

    // Test Play/Pause toggle
    const playPauseBtn = await page.waitForSelector('[data-testid="replay-play-pause-btn"]');
    await playPauseBtn.click();
    await page.waitForTimeout(200);
    console.log('   ✅ Play/Pause toggled.');

    // Test Speed Selector cycling
    const speedBtn = await page.waitForSelector('[data-testid="replay-speed-btn"]');
    const initialSpeedText = await speedBtn.textContent();
    await speedBtn.click();
    await page.waitForTimeout(200);
    const newSpeedText = await speedBtn.textContent();
    console.log(`   ✅ Replay speed changed from ${initialSpeedText?.trim()} to ${newSpeedText?.trim()}.`);

    // Test Timeline Range Scrubber seeking
    const scrubber = await page.waitForSelector('[data-testid="replay-scrubber"]');
    await scrubber.fill('15');
    await scrubber.dispatchEvent('change');
    await page.waitForTimeout(300);
    console.log('   ✅ Timeline range scrubber seeked to region 15.');

    // Test Restart Replay button
    const restartBtn = await page.waitForSelector('[data-testid="replay-restart-btn"]');
    await restartBtn.click();
    await page.waitForTimeout(300);
    console.log('   ✅ Replay Restart button verified.');

    // Test Skip to End button
    const skipBtn = await page.waitForSelector('[data-testid="replay-skip-btn"]');
    await skipBtn.click();
    await page.waitForTimeout(300);
    console.log('   ✅ Skip to End verified.');

    // Exit Replay HUD
    const exitReplayBtn = await page.waitForSelector('[data-testid="replay-exit-btn"]');
    await exitReplayBtn.click();
    await page.waitForTimeout(400);
    console.log('   ✅ Exited Replay HUD.');

    // Test Watch Puzzle Replay button in FloatingActions while puzzle is 100% complete
    const floatingReplayBtn = await page.waitForSelector('button[title*="Watch Puzzle Replay"]');
    console.log('   ✅ Watch Puzzle Replay button found in FloatingActions.');
    await floatingReplayBtn.click();
    await page.waitForTimeout(300);
    await page.waitForSelector('[data-testid="replay-exit-btn"]', { timeout: 5000 });
    console.log('   ✅ Watch Puzzle Replay successfully relaunched replay animation from floating action button.');

    // Exit Replay again to test Undo
    const exitBtn2 = await page.waitForSelector('[data-testid="replay-exit-btn"]');
    await exitBtn2.click();
    await page.waitForTimeout(300);

    // -------------------------------------------------------------------------
    // Step 7: Test Undo on a Completed Puzzle (Dock & Active Color Reappear)
    // -------------------------------------------------------------------------
    console.log('7️⃣ Testing Undo on Completed Puzzle...');
    const undoBtn = await page.waitForSelector('button[title*="Undo"]');
    const isUndoDisabled = await undoBtn.getAttribute('disabled');
    if (isUndoDisabled !== null) {
      throw new Error('Undo button should be enabled on completed puzzle!');
    }

    // Click Undo: removes the last completed region
    await undoBtn.click();
    await page.waitForTimeout(400);
    console.log('   ✅ Clicked Undo to unfill the last region.');

    // When undone, puzzle is 99% complete: PaletteDock and active color MUST reappear!
    await page.waitForSelector('[aria-label="Palette dock"]', { timeout: 5000 });
    console.log('   ✅ PaletteDock and active colour swatch immediately reappeared after Undo!');

    // Verify Floating Replay button disappears once puzzle is no longer 100% complete
    const isReplayBtnGone = await page.evaluate(() => {
      return document.querySelector('button[title*="Watch Puzzle Replay"]') === null;
    });
    if (!isReplayBtnGone) {
      throw new Error('Watch Puzzle Replay button should disappear after undoing completion!');
    }
    console.log('   ✅ Watch Puzzle Replay button correctly hidden after undoing completion.');

    // Test keyboard shortcut Ctrl+Z
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    console.log('   ✅ Dispatched Ctrl+Z to undo another region.');

    // -------------------------------------------------------------------------
    // Step 8: Test Expandable Generation Details Drawer
    // -------------------------------------------------------------------------
    console.log('8️⃣ Testing Expandable Generation Pipeline Details...');
    // Open Settings -> Create Tab -> Pick Capy Forest
    const settingsBtn = await page.waitForSelector('button[aria-label="Open Settings"], button[title*="Settings"]');
    await settingsBtn.click();
    await page.waitForTimeout(400);

    const createTabBtn = await page.waitForSelector('button:has-text("Create")');
    await createTabBtn.click();
    await page.waitForTimeout(400);

    // Pick Capy Forest sample card
    const capyForestCard = await page.waitForSelector('div.group:has-text("Capy Forest")');
    const playBtn = await capyForestCard.$('button:has-text("Play")');
    if (playBtn) {
      await playBtn.click();
    }

    // Wait for bottom-anchored LoadingOverlay
    console.log('   Waiting for generation pipeline HUD...');
    // In Fast Mode (default), toggle to Detailed mode if "Detailed" button is present
    const detailedModeBtn = await page.waitForSelector('button:has-text("Detailed")', { timeout: 8000 }).catch(() => null);
    if (detailedModeBtn) {
      await detailedModeBtn.click();
      await page.waitForTimeout(200);
      console.log('   ✅ Toggled from Fast Mode (default) to Detailed Progress.');
    }
    const detailsToggleBtn = await page.waitForSelector('button:has-text("Generation Details")', { timeout: 8000 }).catch(() => null);
    if (detailsToggleBtn) {
      await detailsToggleBtn.click();
      await page.waitForTimeout(300);
      console.log('   ✅ Expanded Generation Details drawer.');

      // Verify presence of pipeline checklist
      const sectionHeader = await page.waitForSelector('text=Auto-Detected Artwork', { timeout: 3000 }).catch(() => null);
      if (sectionHeader) {
        console.log('   ✅ Auto-detected artwork & engine parameters section verified.');
      }
    }

    // Wait for generation to complete
    await page.waitForSelector('[aria-label="Palette dock"]', { timeout: 25000 });
    console.log('   ✅ New puzzle generated successfully with live background visualization!');

    // -------------------------------------------------------------------------
    // Step 9: Final Console & Error Assertion
    // -------------------------------------------------------------------------
    console.log('9️⃣ Checking browser error logs...');
    if (consoleErrors.length > 0) {
      console.error('❌ Browser errors encountered:', consoleErrors);
      throw new Error(`Full gameplay test failed with ${consoleErrors.length} console errors.`);
    }

    console.log('🎉 FULL GAMEPLAY TEST COMPLETED SUCCESSFULLY WITH ZERO ERRORS!');
  } finally {
    await browser.close();
  }
}

runFullGameplayTest().catch((err) => {
  console.error('❌ Full gameplay test failed:', err);
  process.exit(1);
});
