/**
 * [E2E 16-21] 360x780 mobile layout/bounds, viewport-save races, BETA pill, malformed .capy/#s=/ErrorBoundary/DPR, StorageNamespace & IDB quota durability.
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

export async function runMobileResilienceIsolationE2e(ctx) {
  const { browser, context, page, BASE_URL, projectRoot, attachErrorListeners, logE2eStart, logE2ePass } = ctx;
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
    // Verify Next button stays at exact same (x, y, width, height) <= 1px across basic-feature Steps 1-7 on 360x780 mobile
    const mobileNextRefBox = await mobileTopbarPage.getByTestId('tutorial-next-btn').boundingBox();
    assert.ok(mobileNextRefBox, 'Expected Step 1 tutorial-next-btn boundingBox on 360x780 mobile');
    for (let stepNum = 2; stepNum <= 7; stepNum++) {
      await mobileTopbarPage.getByTestId('tutorial-next-btn').click();
      await mobileTopbarPage.waitForFunction(
        (expected) =>
          document.querySelector('[data-testid="tutorial-step-indicator"]')?.textContent?.trim().toUpperCase() ===
          `STEP ${expected} OF 12`,
        stepNum,
        { timeout: 3000 }
      );
      const nextBox = await mobileTopbarPage.getByTestId('tutorial-next-btn').boundingBox();
      assert.ok(nextBox, `Expected Step ${stepNum} tutorial-next-btn boundingBox on 360x780 mobile`);
      assert.equal(
        Math.abs(nextBox.x - mobileNextRefBox.x) <= 1 &&
          Math.abs(nextBox.y - mobileNextRefBox.y) <= 1 &&
          Math.abs(nextBox.width - mobileNextRefBox.width) <= 1 &&
          Math.abs(nextBox.height - mobileNextRefBox.height) <= 1,
        true,
        `Mobile 360x780 Step ${stepNum} tutorial-next-btn shifted beyond 1px (ref=${JSON.stringify(mobileNextRefBox)}, got=${JSON.stringify(nextBox)})`
      );
    }
    // Verify Next button stays unclipped and <=1px stable across Steps 1-7 at 125%/125% (Large Text) and 150%/140% (max scale)
    const verifyScaledTutorialSteps1To7 = async (label) => {
      await mobileTopbarPage.getByTestId('tutorial-topics-btn').click();
      await mobileTopbarPage.getByTestId('tutorial-topic-item-0').click();
      await mobileTopbarPage.waitForFunction(
        () =>
          document.querySelector('[data-testid="tutorial-step-indicator"]')?.textContent?.trim().toUpperCase() ===
          'STEP 1 OF 12',
        undefined,
        { timeout: 3000 }
      );
      const refBox = await mobileTopbarPage.getByTestId('tutorial-next-btn').boundingBox();
      assert.ok(refBox, `Expected Step 1 tutorial-next-btn boundingBox (${label})`);
      for (let stepNum = 1; stepNum <= 7; stepNum++) {
        if (stepNum > 1) {
          await mobileTopbarPage.getByTestId('tutorial-next-btn').click();
          await mobileTopbarPage.waitForFunction(
            (expected) =>
              document.querySelector('[data-testid="tutorial-step-indicator"]')?.textContent?.trim().toUpperCase() ===
              `STEP ${expected} OF 12`,
            stepNum,
            { timeout: 3000 }
          );
        }
        const metrics = await mobileTopbarPage.evaluate(() => {
          const card = document.querySelector('[data-testid="onboarding-tutorial"]');
          const next = document.querySelector('[data-testid="tutorial-next-btn"]');
          if (!card || !next) return null;
          const cr = card.getBoundingClientRect();
          const nr = next.getBoundingClientRect();
          return {
            vOver: card.scrollHeight - card.clientHeight,
            nextBottom: nr.bottom,
            cardBottom: cr.bottom,
            x: nr.x,
            y: nr.y,
            width: nr.width,
            height: nr.height,
          };
        });
        assert.ok(metrics, `Expected tutorial metrics on Step ${stepNum} (${label})`);
        assert.equal(
          metrics.vOver <= 1 && metrics.nextBottom <= metrics.cardBottom + 1,
          true,
          `${label} Step ${stepNum} tutorial-next-btn clipped or card overflowed (${JSON.stringify(metrics)})`
        );
        assert.equal(
          Math.abs(metrics.x - refBox.x) <= 1 &&
            Math.abs(metrics.y - refBox.y) <= 1 &&
            Math.abs(metrics.width - refBox.width) <= 1 &&
            Math.abs(metrics.height - refBox.height) <= 1,
          true,
          `${label} Step ${stepNum} tutorial-next-btn shifted beyond 1px (ref=${JSON.stringify(refBox)}, got=${JSON.stringify(metrics)})`
        );
      }
    };
    await mobileTopbarPage.getByTestId('tutorial-large-text-btn').click();
    await mobileTopbarPage.waitForFunction(() => document.documentElement.dataset.largeText === 'true', undefined, { timeout: 3000 });
    await verifyScaledTutorialSteps1To7('360x780 Large Text 125%/125%');
    await mobileTopbarPage.evaluate(() => {
      document.documentElement.style.setProperty('--capy-text-scale', '1.5');
      document.documentElement.style.setProperty('--capy-ui-scale', '1.4');
    });
    await verifyScaledTutorialSteps1To7('360x780 Max Scale 150%/140%');
    await mobileTopbarPage.getByTestId('tutorial-large-text-btn').click();
    await mobileTopbarPage.waitForFunction(() => document.documentElement.dataset.largeText === 'false', undefined, { timeout: 3000 });
    await mobileTopbarPage.getByTestId('tutorial-topics-btn').click();
    await mobileTopbarPage.getByTestId('tutorial-topic-item-0').click();
    await mobileTopbarPage.waitForFunction(
      () =>
        document.querySelector('[data-testid="tutorial-step-indicator"]')?.textContent?.trim().toUpperCase() ===
        'STEP 1 OF 12',
      undefined,
      { timeout: 3000 }
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
    await mobileTopbarPage.locator('[data-testid="paint-mode-btn"]').click();
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
      defaultHintBarText.includes('Built-in Gallery: Max Detail') && defaultHintBarText.includes('Photo Uploads: Auto'),
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
      afterHighHintText.includes('38 colors') && afterHighHintText.includes('500 pieces'),
      true,
      `Detail Level Preset High must sync 38 colors and 500 pieces (got '${afterHighHintText}')`
    );

    // Quick Max Detail button must jump directly to 64c / 2000 pcs / 2048p
    const mobileMaxPresetBtn = mobileTopbarPage.getByTestId('create-max-detail-preset-btn');
    await mobileMaxPresetBtn.scrollIntoViewIfNeeded();
    await mobileMaxPresetBtn.click();
    const afterMaxHintText = await mobileHintBar.innerText();
    assert.equal(
      afterMaxHintText.includes('Max Detail') &&
        afterMaxHintText.includes('64 colors') &&
        afterMaxHintText.includes('2000 pieces'),
      true,
      `Max Detail preset button must apply 64 colors / 2000 pieces Max Detail config (got '${afterMaxHintText}')`
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
      reopenedHintBarText.includes('Built-in Gallery: Max Detail'),
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
    // INTENTIONAL_TIMING_WINDOW: negative-absence guard past 350ms viewport-save debounce (stale timer must not overwrite partial state)
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
    // INTENTIONAL_TIMING_WINDOW: negative-absence guard past 350ms viewport-save debounce after clearActiveState + wheel zoom
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
    // INTENTIONAL_TIMING_WINDOW: negative-absence guard past 350ms viewport-save debounce after deleting active snapshot
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
    // INTENTIONAL_TIMING_WINDOW: negative-absence guard past 350ms viewport-save debounce after resize during snapshot switch
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

    // INTENTIONAL_TIMING_WINDOW: simulated delayed loadPuzzleData race + 350ms debounce window verifying stale load A cannot clobber load B
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
    // INTENTIONAL_TIMING_WINDOW: async rejection settle window for mocked failing loadPuzzleData before restoring original method
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
    await viewportRacePage.waitForFunction(
      () => (window.capyStorage.loadActiveState()?.zoomScale ?? 1) > 1,
      { timeout: 3000 }
    );
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
    // INTENTIONAL_TIMING_WINDOW: async rejection settle window for mocked failing deleteSnapshot before restoring original method
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
    await viewportRacePage.waitForFunction(
      (prevZoom) => (window.capyStorage.loadActiveState()?.zoomScale ?? 1) > prevZoom,
      zoomAfterLoadRecovery,
      { timeout: 3000 }
    );
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
    // INTENTIONAL_TIMING_WINDOW: debounce settle past 350ms viewport-save timer after baseline pre-tap before Probe 2g tap-burst starvation test
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
      // INTENTIONAL_TIMING_WINDOW: intentional 4 x 250ms >= 1000ms tap-burst cadence proving 350ms debounce timer is not starved
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
    // INTENTIONAL_TIMING_WINDOW: async post-sync settle window after releaseHeldRead() verifying mid-flight local stroke is preserved
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
}
