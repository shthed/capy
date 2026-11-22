/**
 * [E2E 01-03] PWA manifest, Digital Asset Links, Service Worker boot, 12-step OnboardingTutorial & FeatureOfferBanner queue.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertSpotlightAligned,
  captureV3012Screenshot,
  getStableBoundingBox,
  tapCanvasGrid,
  waitForAnimationFrames,
  waitForPuzzleLoaded,
} from './helpers.mjs';

export async function runBootOnboardingE2e(ctx) {
  const { browser, context, page, BASE_URL, webPkgJson, attachErrorListeners, logE2eStart, logE2ePass } = ctx;
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
    assert.equal(await page.getByTestId('tutorial-step-indicator').innerText(), 'STEP 1 OF 12');
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
      () => document.querySelector('[data-testid="tutorial-step-indicator"]')?.textContent?.trim().toUpperCase() === 'STEP 2 OF 12',
      undefined,
      { timeout: 3000 }
    );
    // Step 2: Tap & Paint Shape (tap canvas below tutorial card -> shows Tried! badge and auto-advances to Step 3)
    const canvasBoxTut = await page.locator('canvas').first().boundingBox();
    for (let attempt = 0; attempt < 6; attempt++) {
      const xFrac = 0.42 + (attempt % 3) * 0.08;
      const yFrac = 0.60 + Math.floor(attempt / 3) * 0.08;
      await page.mouse.click(canvasBoxTut.x + canvasBoxTut.width * xFrac, canvasBoxTut.y + canvasBoxTut.height * yFrac);
      await waitForAnimationFrames(page, 2);
      if ((await page.getByTestId('tutorial-step-tried-badge').count()) > 0) break;
    }
    await page.getByTestId('tutorial-step-tried-badge').waitFor({ state: 'visible', timeout: 3000 });
    await page.waitForFunction(
      () => document.querySelector('[data-testid="tutorial-step-indicator"]')?.textContent?.trim().toUpperCase() === 'STEP 3 OF 12',
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
      () => document.querySelector('[data-testid="tutorial-step-indicator"]')?.textContent?.trim().toUpperCase() === 'STEP 4 OF 12',
      undefined,
      { timeout: 3000 }
    );
    await page.keyboard.press('0');
    // Step 4: Smart Hints (use inline Try Hint button -> marks tried and auto-advances to Step 5)
    await page.getByTestId('tutorial-try-hint-btn').click();
    await page.getByTestId('tutorial-step-tried-badge').waitFor({ state: 'visible', timeout: 3000 });
    await page.waitForFunction(
      () => document.querySelector('[data-testid="tutorial-step-indicator"]')?.textContent?.trim().toUpperCase() === 'STEP 5 OF 12',
      undefined,
      { timeout: 3000 }
    );
    // Skip remaining steps on main page to preserve clean Capy Forest state; full 12-step tour runs in dedicated tutContext below
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
    await escTutPage.getByTestId('settings-modal-tabs').waitFor({ state: 'visible', timeout: 3000 });
    await escTutPage.keyboard.press('Escape');
    await escTutPage.getByTestId('settings-modal-tabs').waitFor({ state: 'hidden', timeout: 3000 });
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

    logE2eStart('Verifying 12-step OnboardingTutorial tour, modal-docked Settings/Hints spotlight, [All Topics] drawer & rapid Ctrl+Z burst...');
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
          `STEP ${expected} OF 12`,
        stepNum,
        { timeout: 5000 }
      );
    };
    await expectTutStep(1);
    const step1LargeBtnBox = await tutPage.getByTestId('tutorial-large-text-btn').boundingBox();
    assert.ok(
      step1LargeBtnBox && step1LargeBtnBox.width < 150 && step1LargeBtnBox.height <= 34,
      `Step 1 Large Text button must be compact header pill matching Step 2+ (got ${JSON.stringify(step1LargeBtnBox)})`
    );
    const desktopNextRefBox = await tutPage.getByTestId('tutorial-next-btn').boundingBox();
    assert.ok(desktopNextRefBox, 'Expected Step 1 tutorial-next-btn boundingBox on desktop');
    const assertDesktopNextStable = async (stepNum) => {
      const box = await tutPage.getByTestId('tutorial-next-btn').boundingBox();
      assert.ok(box, `Expected tutorial-next-btn boundingBox on Step ${stepNum}`);
      assert.equal(
        Math.abs(box.x - desktopNextRefBox.x) <= 1 &&
          Math.abs(box.y - desktopNextRefBox.y) <= 1 &&
          Math.abs(box.width - desktopNextRefBox.width) <= 1 &&
          Math.abs(box.height - desktopNextRefBox.height) <= 1,
        true,
        `Desktop Step ${stepNum} tutorial-next-btn shifted beyond 1px (ref=${JSON.stringify(desktopNextRefBox)}, got=${JSON.stringify(box)})`
      );
    };
    await assertSpotlightAligned(tutPage, 'tutorial');
    // Step 0 -> 1 (palette): tapping the ALREADY-active swatch on Step 1 must advance cleanly without triggering hint
    await tutPage.locator('[data-testid="palette-dock"] button[aria-pressed="true"]').first().click();
    await expectTutStep(2);
    await assertDesktopNextStable(2);
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
      await waitForAnimationFrames(tutPage, 2);
      const afterFilled = Number(await tutPage.getByTestId('topbar-saves-btn').getAttribute('data-filled-count'));
      if (afterFilled > beforeFilled) paintedOnTut++;
    }
    assert.ok(paintedOnTut >= 1, 'Expected at least 1 region painted on tutPage');
    await expectTutStep(3);
    await assertDesktopNextStable(3);
    // Verify topbar-saves-btn exposes data-filled-count >= 1
    assert.ok(
      Number(await tutPage.getByTestId('topbar-saves-btn').getAttribute('data-filled-count')) >= 1,
      'Expected topbar-saves-btn data-filled-count >= 1 after painting'
    );
    // Step 2 -> 3 (zoom)
    await tutPage.keyboard.press('+');
    await expectTutStep(4);
    await assertDesktopNextStable(4);
    await tutPage.keyboard.press('0');
    await assertSpotlightAligned(tutPage, 'tutorial');
    // Step 3 -> 4 (hint)
    await tutPage.getByTestId('tutorial-try-hint-btn').click();
    await expectTutStep(5);
    await assertDesktopNextStable(5);
    await assertSpotlightAligned(tutPage, 'tutorial');
    // Step 4 -> 5 (undo_redo)
    await tutPage.getByTestId('undo-btn').click();
    await expectTutStep(6);
    await assertDesktopNextStable(6);
    // Back onto already-tried Step 4 (STEP 5 OF 12) must wait for a fresh action (Redo) instead of auto-advancing immediately
    await tutPage.getByTestId('tutorial-prev-btn').click();
    await expectTutStep(5);
    // INTENTIONAL_TIMING_WINDOW: negative-absence guard past 800ms tutorial auto-advance timer (Back to already-tried Step 5 must not auto-advance)
    await tutPage.waitForTimeout(950);
    assert.equal(
      (await tutPage.getByTestId('tutorial-step-indicator').innerText()).trim().toUpperCase(),
      'STEP 5 OF 12',
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
    await assertDesktopNextStable(7);
    await tutPage.getByTestId('replay-controls-window').waitFor({ state: 'hidden', timeout: 3000 });
    const step7Metrics = await assertSpotlightAligned(tutPage, 'tutorial');
    assert.equal(step7Metrics.ringCount, 2, 'Step 7 (peek_fullscreen) must highlight both Eye and Full Screen');
    assert.equal(step7Metrics.pointerSpan >= 10, true, `Step 7 topbar pointer must have clean arrow stem (${step7Metrics.pointerSpan}px)`);
    assert.equal(
      (await tutPage.getByTestId('tutorial-try-pill').innerText()).includes(
        'Try it: Tap the Eye icon above'
      ),
      true,
      'Step 7 tryPrompt must cleanly explain tapping the Eye icon'
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
    // Step 8 (free_color in Settings; tutorial must dock at z-[60] & spotlight tab/control while SettingsModal is open)
    await tutPage.locator('button[title="Settings and Menu"]').click();
    await tutPage.getByTestId('settings-modal-tabs').waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(
      await tutPage.getByTestId('onboarding-tutorial').getAttribute('data-modal-docked'),
      'true',
      'OnboardingTutorial must dock above SettingsModal (data-modal-docked="true") on Step 8'
    );
    await tutPage.getByTestId('spotlight-overlay').waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(
      await tutPage.getByTestId('spotlight-overlay').getAttribute('data-modal-spotlight'),
      'true',
      'TargetSpotlightOverlay must stay active inside SettingsModal on Step 8'
    );
    // Switch to wrong tab (About) -> prompt tells user which tab to press and shows Open Settings button
    await tutPage.getByTestId('settings-tab-about').click();
    assert.equal(
      (await tutPage.getByTestId('tutorial-try-pill').innerText()).includes('Tap the Settings tab at the top'),
      true,
      'Step 8 on wrong tab must instruct user to tap the Settings tab'
    );
    assert.equal(
      await tutPage.getByTestId('tutorial-open-free-color-btn').isVisible(),
      true,
      'Step 8 on wrong tab must show Open Settings button'
    );
    // Switch to Tab 1 (Settings) -> prompt transitions to control guidance and hides redundant Open Settings button
    await tutPage.getByTestId('settings-tab-settings').click();
    assert.equal(
      (await tutPage.getByTestId('tutorial-try-pill').innerText()).includes('Turn on Free Color Mode above'),
      true,
      'Step 8 on Settings tab must instruct user to turn on Free Color Mode'
    );
    assert.equal(
      await tutPage.getByTestId('tutorial-open-free-color-btn').count(),
      0,
      'Step 8 on target Settings tab must hide redundant Open Settings button'
    );
    await tutPage.getByTestId('setting-free-color-mode').click();
    // INTENTIONAL_TIMING_WINDOW: negative-absence guard past 800ms tutorial auto-advance timer (Step 8 Free Color toggle must not auto-advance)
    await tutPage.waitForTimeout(950);
    assert.equal(
      (await tutPage.getByTestId('tutorial-step-indicator').innerText()).trim().toUpperCase(),
      'STEP 8 OF 12',
      'Auto-advance timer must stay paused while SettingsModal is open'
    );
    await tutPage.getByTestId('setting-free-color-mode').click();
    await tutPage.getByTestId('settings-modal-close').click();
    await expectTutStep(9);
    // Step 9 (create_gallery: Daily Puzzle, Gallery & Photos) — opening Settings lands on Tab 1 (wrong tab) then transitions on Tab 3 (Create)
    await tutPage.locator('button[title="Settings and Menu"]').click();
    await tutPage.getByTestId('settings-modal-tabs').waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(
      await tutPage.getByTestId('onboarding-tutorial').getAttribute('data-modal-docked'),
      'true',
      'OnboardingTutorial must dock above SettingsModal on Step 9'
    );
    assert.equal(
      (await tutPage.getByTestId('tutorial-try-pill').innerText()).includes('Tap the Create tab at the top'),
      true,
      'Step 9 on Settings tab must instruct user to tap the Create tab'
    );
    await tutPage.getByTestId('settings-tab-create').click();
    assert.equal(
      (await tutPage.getByTestId('tutorial-try-pill').innerText()).includes('Tap Play Daily Puzzle'),
      true,
      'Step 9 on Create tab must transition to Play Daily Puzzle / Preset Gallery guidance'
    );
    await tutPage.getByTestId('settings-modal-close').click();
    await expectTutStep(10);
    await assertSpotlightAligned(tutPage, 'tutorial');
    // Step 10 (saves_export)
    await tutPage.getByTestId('topbar-saves-btn').click();
    await tutPage.getByTestId('settings-modal-tabs').waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(
      await tutPage.getByTestId('onboarding-tutorial').getAttribute('data-modal-docked'),
      'true',
      'OnboardingTutorial must dock above SettingsModal on Step 10'
    );
    assert.equal(
      await tutPage.getByTestId('spotlight-overlay').getAttribute('data-modal-spotlight'),
      'true',
      'TargetSpotlightOverlay must stay active inside SettingsModal on Step 10'
    );
    await tutPage.getByTestId('settings-modal-close').click();
    await expectTutStep(11);
    await assertSpotlightAligned(tutPage, 'tutorial');
    // Step 11 (settings, modalTab: 1): one-tap Open Settings button -> bottom-docked guide bar + in-modal spotlight
    await tutPage.getByTestId('tutorial-open-settings-btn').click();
    await tutPage.getByTestId('settings-modal-tabs').waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(
      await tutPage.getByTestId('settings-tab-settings').getAttribute('aria-selected'),
      'true',
      'tutorial-open-settings-btn must open SettingsModal on Tab 1 (Settings)'
    );
    assert.equal(
      await tutPage.getByTestId('onboarding-tutorial').getAttribute('data-modal-docked'),
      'true',
      'OnboardingTutorial must dock at bottom (data-modal-docked="true") on settings step'
    );
    await tutPage.getByTestId('spotlight-overlay').waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(
      await tutPage.getByTestId('spotlight-overlay').getAttribute('data-modal-spotlight'),
      'true',
      'TargetSpotlightOverlay must stay active inside SettingsModal (data-modal-spotlight="true") on settings step'
    );
    // Manually switch to Tab 0 (About) while SettingsModal stays open, then tap Open Settings -> must switch back to Tab 1 via initialTabRequestKey
    await tutPage.getByTestId('settings-tab-about').click();
    assert.equal(
      await tutPage.getByTestId('settings-tab-about').getAttribute('aria-selected'),
      'true',
      'Manual tab click must switch to Tab 0 (About)'
    );
    await tutPage.getByTestId('tutorial-open-settings-btn').click();
    await tutPage.getByTestId('settings-section-accessibility').waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(
      await tutPage.getByTestId('settings-tab-settings').getAttribute('aria-selected'),
      'true',
      'Clicking tutorial-open-settings-btn while modal is already open must re-switch back to Tab 1 (Settings)'
    );
    // Step 11 -> 12 (hints, modalTab: 2): Next while modal is open automatically switches to Tab 2 (Hints)
    await tutPage.getByTestId('tutorial-next-btn').click();
    await expectTutStep(12);
    assert.equal(
      await tutPage.getByTestId('settings-tab-hints').getAttribute('aria-selected'),
      'true',
      'Advancing to Step 12 (hints) while modal is open must switch to Tab 2 (Hints)'
    );
    assert.equal(
      await tutPage.getByTestId('onboarding-tutorial').getAttribute('data-modal-docked'),
      'true',
      'OnboardingTutorial must remain docked at bottom on hints step'
    );
    assert.equal(
      await tutPage.getByTestId('spotlight-overlay').getAttribute('data-modal-spotlight'),
      'true',
      'TargetSpotlightOverlay must stay active inside SettingsModal on hints step'
    );
    // [All Topics] drawer lists all 12 topics; jumping to Step 1 closes tutorial-opened SettingsModal and waits for fresh action
    await tutPage.getByTestId('tutorial-topics-btn').click();
    await tutPage.getByTestId('tutorial-topics-drawer').waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(await tutPage.locator('[data-testid^="tutorial-topic-item-"]').count(), 12);
    await tutPage.getByTestId('tutorial-topic-item-0').click();
    await expectTutStep(1);
    await tutPage.getByTestId('settings-modal-close').waitFor({ state: 'hidden', timeout: 3000 });
    // INTENTIONAL_TIMING_WINDOW: negative-absence guard past 800ms tutorial auto-advance timer (Step 1 jump from [All Topics] must not auto-advance)
    await tutPage.waitForTimeout(950);
    assert.equal(
      (await tutPage.getByTestId('tutorial-step-indicator').innerText()).trim().toUpperCase(),
      'STEP 1 OF 12',
      'Jumping via All Topics onto already-tried Step 1 must wait for a fresh action'
    );
    // Jump to Step 12 (hints), use one-tap Open Hints button, toggle a hint setting, close modal -> auto-completes tutorial
    await tutPage.getByTestId('tutorial-topics-btn').click();
    await tutPage.getByTestId('tutorial-topic-item-11').click();
    await expectTutStep(12);
    await tutPage.getByTestId('tutorial-open-hints-btn').click();
    await tutPage.getByTestId('hints-section-style').waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(
      await tutPage.getByTestId('settings-tab-hints').getAttribute('aria-selected'),
      'true',
      'tutorial-open-hints-btn must open SettingsModal on Tab 2 (Hints)'
    );
    assert.equal(
      await tutPage.getByTestId('onboarding-tutorial').getAttribute('data-modal-docked'),
      'true',
      'tutorial-open-hints-btn must dock OnboardingTutorial at bottom'
    );
    await tutPage.getByTestId('setting-animate-hint').click();
    await tutPage.getByTestId('setting-animate-hint').click();
    await tutPage.getByTestId('settings-modal-close').click();
    await tutPage.getByTestId('onboarding-tutorial').waitFor({ state: 'hidden', timeout: 4000 });
    assert.equal(
      await tutPage.evaluate(() => localStorage.getItem('capy_tutorial_completed_v1')),
      '1',
      'Step 12 auto-completion must persist capy_tutorial_completed_v1="1"'
    );

    // Verify compact '?' tour button (settings-tour-btn) in SettingsModal header launches Settings/Hints tour directly
    await tutPage.locator('button[title="Settings and Menu"]').click();
    await tutPage.getByTestId('settings-tab-settings').click();
    await tutPage.getByTestId('settings-tour-btn').click();
    await tutPage.getByTestId('onboarding-tutorial').waitFor({ state: 'visible', timeout: 3000 });
    await expectTutStep(11);
    assert.equal(
      await tutPage.getByTestId('onboarding-tutorial').getAttribute('data-modal-docked'),
      'true',
      'settings-tour-btn from Tab 1 must launch bottom-docked tour at STEP 11 OF 12'
    );
    await tutPage.getByTestId('tutorial-skip-btn').click();
    await tutPage.getByTestId('onboarding-tutorial').waitFor({ state: 'hidden', timeout: 3000 });
    await tutPage.getByTestId('settings-modal-close').click();

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
    await waitForAnimationFrames(tutPage, 2);
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
      await waitForAnimationFrames(tutPage, 2);
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
    logE2ePass('12-step OnboardingTutorial tour, modal-docked Settings/Hints spotlight, reducedMotion, [All Topics] drawer & rapid Ctrl+Z burst verified.');

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
        `STEP ${expectedStepNum} OF 12`
      );
      // INTENTIONAL_TIMING_WINDOW: negative-absence guard past 800ms tutorial auto-advance timer inside offer-banner check
      await offerPage.waitForTimeout(950);
      assert.equal(
        (await offerPage.getByTestId('tutorial-step-indicator').innerText()).trim().toUpperCase(),
        `STEP ${expectedStepNum} OF 12`,
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
    const offerPaintBtn = offerPage.locator('[data-testid="paint-mode-btn"]');
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
    await jumpFromOfferAndAssertStep(10);
    // 4) undo_replay (paint a region, then undo) -> Jump to Guide STEP 5 OF 12
    const offerCanvasBox = await offerPage.locator('canvas').first().boundingBox();
    for (let attempt = 0; attempt < 6; attempt++) {
      const xFrac = 0.42 + (attempt % 3) * 0.08;
      const yFrac = 0.60 + Math.floor(attempt / 3) * 0.08;
      await offerPage.mouse.click(
        offerCanvasBox.x + offerCanvasBox.width * xFrac,
        offerCanvasBox.y + offerCanvasBox.height * yFrac
      );
      await waitForAnimationFrames(offerPage, 2);
      if (!(await offerPage.getByTestId('undo-btn').isDisabled())) break;
    }
    await offerPage.getByTestId('undo-btn').click();
    await expectOfferBanner('undo_replay');
    await jumpFromOfferAndAssertStep(5);
    // 5) replay_scrubber (redo stroke, long-press undo, exit replay) -> Jump to Guide STEP 6 OF 12
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
    // 6) free_color (Settings -> Free Color Mode ON) -> Jump to Guide STEP 8 OF 12
    await offerPage.locator('button[title="Settings and Menu"]').click();
    await offerPage.getByTestId('settings-tab-settings').click();
    await offerPage.getByTestId('setting-free-color-mode').click();
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

    // Verify all 8 triggered offers persisted in both localStorage and NativeBridge.saveBackup spy
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
    await offerPage.locator('[data-testid="paint-mode-btn"]').click();
    // INTENTIONAL_TIMING_WINDOW: negative-absence guard verifying dismissed feature-offer-banner does not reappear after reload
    await offerPage.waitForTimeout(150);
    assert.equal(await offerPage.getByTestId('feature-offer-banner').count(), 0);
    await offerPage.close();

    // 9) One-time settings_hints_tip offer for returning v1 tutorial completers (without ?skipTutorial)
    {
      const returningCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await returningCtx.addInitScript(() => {
        localStorage.setItem('capy_tutorial_completed_v1', '1');
      });
      const returningPage = await returningCtx.newPage();
      attachErrorListeners(returningPage, 'returningPage');
      await returningPage.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
      await waitForPuzzleLoaded(returningPage);
      await returningPage.waitForFunction(
        () => document.querySelector('[data-testid="feature-offer-banner"]')?.getAttribute('data-offer-id') === 'settings_hints_tip',
        undefined,
        { timeout: 5000 }
      );
      await returningPage.getByTestId('feature-offer-guide-btn').click();
      await returningPage.getByTestId('onboarding-tutorial').waitFor({ state: 'visible', timeout: 3000 });
      assert.equal(
        (await returningPage.getByTestId('tutorial-step-indicator').innerText()).trim().toUpperCase(),
        'STEP 11 OF 12',
        'settings_hints_tip Jump to Guide must open STEP 11 OF 12 (settings)'
      );
      await returningPage.getByTestId('tutorial-skip-btn').click();
      // Reloading must NOT re-show settings_hints_tip
      await returningPage.reload({ waitUntil: 'networkidle' });
      await waitForPuzzleLoaded(returningPage);
      // INTENTIONAL_TIMING_WINDOW: negative-absence guard verifying one-time settings_hints_tip banner does not reappear on reload
      await returningPage.waitForTimeout(200);
      assert.equal(await returningPage.getByTestId('feature-offer-banner').count(), 0, 'settings_hints_tip must only show once');
      await returningPage.close();
      await returningCtx.close();
    }

    // Verify ?capy_channel=beta isolates capy_feature_offers_v1__sandbox_beta from root offers
    const betaOfferPage = await offerContext.newPage();
    attachErrorListeners(betaOfferPage, 'betaOfferPage');
    await betaOfferPage.goto(`${BASE_URL}/?capy_channel=beta&skipTutorial=1`, { waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(betaOfferPage);
    await betaOfferPage.locator('[data-testid="paint-mode-btn"]').click();
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
    // INTENTIONAL_TIMING_WINDOW: negative-absence guard verifying Android Play Store startup does not trigger window.__capySignInCalls
    await androidGatePage.waitForTimeout(200);
    assert.equal(
      await androidGatePage.evaluate(() => window.__capySignInCalls || 0),
      0,
      'Startup must NOT call signInPlayGames / attemptAutoSignIn when showCloudCoopUi === false'
    );
    assert.equal(
      await androidGatePage.getByTestId('topbar-fullscreen-btn').count(),
      0,
      'Android WebView must hide web-only topbar-fullscreen-btn'
    );
    await androidGatePage.locator('button[title="Settings and Menu"]').click();
    await androidGatePage.getByTestId('settings-section-controls').waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(
      await androidGatePage.getByTestId('setting-fullscreen').count(),
      0,
      'Android WebView must hide web-only setting-fullscreen in Controls'
    );
    await androidGatePage.getByTestId('settings-tab-about').click();
    await androidGatePage.getByTestId('app-version-badge').waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(
      await androidGatePage.getByTestId('about-privacy-policy-link').getAttribute('href'),
      'https://capypaint.com/privacy-policy.html',
      'Android About tab Privacy Policy link must point to https://capypaint.com/privacy-policy.html'
    );
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
    await androidGatePage.getByTestId('settings-tab-about').click();
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
}
