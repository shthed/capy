/**
 * [E2E 22-24] Large Text full UI scaling & Fat-Finger/Paint fixes, M4 $0 BYOC multi-provider login & Browser Storage Analyzer modal.
 */
import assert from 'node:assert/strict';
import {
  getStableBoundingBox,
  tapCanvasGrid,
  waitForAnimationFrames,
  waitForCondition,
  waitForPuzzleLoaded,
} from './helpers.mjs';

export async function runAccessibilityByocStorageE2e(ctx) {
  const { browser, BASE_URL, attachErrorListeners, logE2eStart, logE2ePass } = ctx;
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
      await waitForAnimationFrames(ltMobilePage, 3);
    }

    const assertSwitchKnobContained = async (page, testId, expectedChecked, label) => {
      const sw = page.getByTestId(testId);
      await sw.scrollIntoViewIfNeeded();
      assert.equal(
        await sw.getAttribute('aria-checked'),
        String(expectedChecked),
        `${label}: expected aria-checked=${expectedChecked}`
      );
      await getStableBoundingBox(sw.locator('.capy-switch-knob'));
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

    // Verify 360x780 normal-mode mobile topbar icon buttons meet >=38px touch targets & carry descriptive aria-labels
    for (const topbarId of ['topbar-preview-btn', 'topbar-upload-btn', 'topbar-settings-btn']) {
      const btn = ltMobilePage.getByTestId(topbarId);
      const box = await btn.boundingBox();
      assert.ok(
        box && box.width >= 38 && box.height >= 38,
        `Mobile 360x780 ${topbarId} must be >=38x38px (got ${JSON.stringify(box)})`
      );
      assert.ok(
        Boolean((await btn.getAttribute('aria-label'))?.trim()),
        `Icon-only ${topbarId} must expose descriptive aria-label`
      );
    }

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
    const reachSliderDimmed = await ltMobilePage
      .getByTestId('setting-touch-reach-radius')
      .evaluate((el) => el.getAttribute('data-dimmed') === 'true' && el.classList.contains('accent-slate-500') && !el.disabled);
    assert.equal(reachSliderDimmed, true, 'Reach radius slider must show dimmed styling while remaining interactive when fatFingerAssist is off');

    // Clicking a preset while fatFingerAssist is OFF must auto-enable fatFingerAssist
    await ltMobilePage.getByTestId('setting-touch-reach-preset-34').click();
    assert.equal(await ffSwitch.getAttribute('aria-checked'), 'true', 'Clicking a reach preset must auto-enable fatFingerAssist');
    assert.equal(await ltMobilePage.getByTestId('setting-touch-reach-radius').inputValue(), '34');
    assert.equal(
      await ltMobilePage.getByTestId('setting-touch-reach-radius').getAttribute('data-dimmed'),
      null,
      'Reach radius slider must clear dimmed state once fatFingerAssist is enabled'
    );

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

    // Verify independent Text Size and UI Size sliders scale text and buttons separately while maintaining switch knob containment
    const setRangeSlider = async (page, testId, val) => {
      await page.getByTestId(testId).evaluate((el, v) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, String(v));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, val);
    };
    // Reset to 100% / 100% via Large Text toggle OFF first
    await ltSwitch.click();
    await ltMobilePage.waitForFunction(() => document.documentElement.dataset.largeText === 'false', undefined, { timeout: 3000 });
    const baselineFontSize = await ltMobilePage
      .locator('[data-testid="settings-section-accessibility"] .text-xs')
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    const baselineSwitchW = (await ltSwitch.boundingBox()).width;

    // 1) Text Size 140%, UI Size 100%: font size grows, switch width unchanged, and Finger Reach does NOT boost to Large UI 34px
    await setRangeSlider(ltMobilePage, 'setting-text-size', 1.4);
    await ltMobilePage.waitForFunction(() => document.documentElement.dataset.textScaled === 'true', undefined, { timeout: 3000 });
    assert.equal((await ltMobilePage.getByTestId('setting-text-size-value').innerText()).trim(), '140%');
    assert.equal(await ltMobilePage.evaluate(() => document.documentElement.dataset.uiScaled), 'false');
    const textOnlyReachLabel = (await ltMobilePage.getByTestId('setting-touch-reach-value').innerText()).trim();
    assert.equal(
      !textOnlyReachLabel.includes('Large UI') && textOnlyReachLabel === '22px',
      true,
      `Text Size 140% with UI Size 100% must not trigger 34px Large UI reach boost (got "${textOnlyReachLabel}")`
    );
    const textOnlyFontSize = await ltMobilePage
      .locator('[data-testid="settings-section-accessibility"] .text-xs')
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    const textOnlySwitchW = (await ltSwitch.boundingBox()).width;
    assert.ok(textOnlyFontSize > baselineFontSize + 2, `Text Size 140% must enlarge font (${baselineFontSize} -> ${textOnlyFontSize})`);
    assert.ok(Math.abs(textOnlySwitchW - baselineSwitchW) <= 1, `Text Size 140% alone must not resize switch (${baselineSwitchW} vs ${textOnlySwitchW})`);

    // 1b) Desktop >=640px sm:text-* monotonic scaling: 100% (14px) < 105% (14.7px) < 125% (17.5px)
    await ltMobilePage.setViewportSize({ width: 1280, height: 800 });
    await setRangeSlider(ltMobilePage, 'setting-text-size', 1.0);
    await ltMobilePage.waitForFunction(() => document.documentElement.dataset.textScaled === 'false', undefined, { timeout: 3000 });
    const desktopTabFont100 = await ltMobilePage
      .getByTestId('settings-tab-settings')
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    await setRangeSlider(ltMobilePage, 'setting-text-size', 1.05);
    await ltMobilePage.waitForFunction(() => document.documentElement.dataset.textScaled === 'true', undefined, { timeout: 3000 });
    const desktopTabFont105 = await ltMobilePage
      .getByTestId('settings-tab-settings')
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    await setRangeSlider(ltMobilePage, 'setting-text-size', 1.25);
    const desktopTabFont125 = await ltMobilePage
      .getByTestId('settings-tab-settings')
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    assert.equal(
      desktopTabFont105 > desktopTabFont100 + 0.4 && desktopTabFont125 > desktopTabFont105 + 2.0,
      true,
      `Desktop >=640px sm:text-sm must scale monotonically across 100% -> 105% -> 125% (got ${desktopTabFont100} -> ${desktopTabFont105} -> ${desktopTabFont125})`
    );
    await ltMobilePage.setViewportSize({ width: 360, height: 780 });

    // 2) Text Size 100%, UI Size 140%: switch width grows & knob stays contained, font size back to baseline, and FAB clears PaletteDock
    await setRangeSlider(ltMobilePage, 'setting-text-size', 1.0);
    await setRangeSlider(ltMobilePage, 'setting-ui-size', 1.4);
    await ltMobilePage.waitForFunction(() => document.documentElement.dataset.uiScaled === 'true', undefined, { timeout: 3000 });
    assert.equal((await ltMobilePage.getByTestId('setting-ui-size-value').innerText()).trim(), '140%');
    assert.equal(await ltMobilePage.evaluate(() => document.documentElement.dataset.textScaled), 'false');
    const uiOnlyFontSize = await ltMobilePage
      .locator('[data-testid="settings-section-accessibility"] .text-xs')
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    const uiOnlySwitchW = (await ltSwitch.boundingBox()).width;
    assert.ok(Math.abs(uiOnlyFontSize - baselineFontSize) <= 1, `UI Size 140% alone must not enlarge font (${baselineFontSize} vs ${uiOnlyFontSize})`);
    assert.ok(uiOnlySwitchW > baselineSwitchW + 6, `UI Size 140% must enlarge switch (${baselineSwitchW} -> ${uiOnlySwitchW})`);
    await assertSwitchKnobContained(ltMobilePage, 'setting-large-text', true, 'UI Size 140% largeText ON');
    await assertSwitchKnobContained(ltMobilePage, 'setting-fat-finger-assist', true, 'UI Size 140% fatFinger ON');

    // Close Settings briefly at UI Size 140% to confirm FloatingActions clears PaletteDock without overlap
    await ltMobilePage.getByTestId('settings-modal-close').click();
    await ltMobilePage.getByTestId('settings-modal-close').waitFor({ state: 'hidden', timeout: 3000 });
    const ui140Clearance = await ltMobilePage.evaluate(() => {
      const fab = document.querySelector('.capy-fab-stack');
      const dock = document.querySelector('[data-testid="palette-dock"]');
      if (!fab || !dock) return null;
      return {
        fabBottom: fab.getBoundingClientRect().bottom,
        dockTop: dock.getBoundingClientRect().top,
      };
    });
    assert.ok(ui140Clearance, 'Expected FloatingActions and PaletteDock bounding rects at UI Size 140%');
    assert.equal(
      ui140Clearance.fabBottom <= ui140Clearance.dockTop + 0.5,
      true,
      `FloatingActions must not overlap PaletteDock at UI Size 140% (${JSON.stringify(ui140Clearance)})`
    );
    await ltMobilePage.getByTestId('topbar-settings-btn').click();
    await ltMobilePage.getByTestId('settings-modal-close').waitFor({ state: 'visible', timeout: 3000 });

    // Restore Large Text preset (125% / 125%) for remaining E2E 22 checks
    await ltSwitch.click();
    await ltSwitch.click();
    await ltMobilePage.waitForFunction(
      () =>
        document.documentElement.dataset.largeText === 'true' &&
        document.documentElement.dataset.textScaled === 'true' &&
        document.documentElement.dataset.uiScaled === 'true',
      undefined,
      { timeout: 3000 }
    );

    // Fix 1: Expand collapsible Replay section and verify unified switch knob containment on follow & auto-replay toggles
    const ltReplayToggle = ltMobilePage.getByTestId('settings-section-replay-toggle');
    await ltReplayToggle.scrollIntoViewIfNeeded();
    if ((await ltReplayToggle.getAttribute('aria-expanded')) !== 'true') {
      await ltReplayToggle.click();
    }
    const followInitial = (await ltMobilePage.getByTestId('toggle-replay-follow-btn').getAttribute('aria-checked')) === 'true';
    await assertSwitchKnobContained(ltMobilePage, 'toggle-replay-follow-btn', followInitial, 'Large Text follow initial');
    await ltMobilePage.getByTestId('toggle-replay-follow-btn').click();
    await assertSwitchKnobContained(ltMobilePage, 'toggle-replay-follow-btn', !followInitial, 'Large Text follow toggled');
    await ltMobilePage.getByTestId('toggle-replay-follow-btn').click();
    const autoReplayInitial = (await ltMobilePage.getByTestId('toggle-auto-replay-btn').getAttribute('aria-checked')) === 'true';
    await assertSwitchKnobContained(ltMobilePage, 'toggle-auto-replay-btn', autoReplayInitial, 'Large Text autoReplay initial');
    await ltMobilePage.getByTestId('toggle-auto-replay-btn').click();
    await assertSwitchKnobContained(ltMobilePage, 'toggle-auto-replay-btn', !autoReplayInitial, 'Large Text autoReplay toggled');
    await ltMobilePage.getByTestId('toggle-auto-replay-btn').click();

    // Fix 2: Enlarged range slider must compute appearance === 'none' so 24px custom thumb renders on Chromium/WebView
    const sliderAppearance = await ltMobilePage
      .getByTestId('setting-touch-reach-radius')
      .evaluate((el) => getComputedStyle(el).appearance);
    assert.equal(
      sliderAppearance,
      'none',
      `Large Text setting-touch-reach-radius must compute appearance: none (got '${sliderAppearance}')`
    );

    // Measure enlarged SettingsModal controls & verify tabs zero-overflow, >=38-40px touch targets & ARIA labels at 360x780
    const largeSwitchBox = await ltSwitch.boundingBox();
    const largeFfSwitchBox = await ffSwitch.boundingBox();
    const largeCloseBox = await ltMobilePage.getByTestId('settings-modal-close').boundingBox();
    const largeTourBox = await ltMobilePage.getByTestId('settings-tour-btn').boundingBox();
    assert.ok(largeSwitchBox && largeFfSwitchBox && largeCloseBox && largeTourBox);
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
      normalCloseBox.width >= 40 && normalCloseBox.height >= 40 && largeCloseBox.width >= 40 && largeCloseBox.height >= 40,
      true,
      `Settings close button must be >=40px in both normal & Large Text (normal=${JSON.stringify(normalCloseBox)}, large=${JSON.stringify(largeCloseBox)})`
    );
    assert.equal(
      largeTourBox.width >= 38 && largeTourBox.height >= 38,
      true,
      `Settings header '?' tour button must be >=38px (got ${JSON.stringify(largeTourBox)})`
    );
    assert.ok(await ltMobilePage.getByTestId('settings-modal-close').getAttribute('aria-label'), 'settings-modal-close must have aria-label');
    assert.ok(await ltMobilePage.getByTestId('settings-tour-btn').getAttribute('aria-label'), 'settings-tour-btn must have aria-label');

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
        tb.x >= ltTabsBox.x - 1 && tb.x + tb.width <= largeTourBox.x + 1,
        true,
        `Large Text settings-tab-${tabKey} (${tb.x}..${tb.x + tb.width}) must fit inside tabsBox (${ltTabsBox.x}) left of tour/close (${largeTourBox.x})`
      );
    }

    // Check Tab 0 action button height (>=44px), Tab 3 (i) hint icon button size (>=32px), and Tab 4 has no duplicate auto-replay switch
    await ltMobilePage.getByTestId('settings-tab-about').click();
    const replayTutBtnBox = await ltMobilePage.getByTestId('about-replay-tutorial-btn').boundingBox();
    assert.ok(replayTutBtnBox && replayTutBtnBox.height >= 44, `About CTA button must be >=44px tall in Large Text (got ${JSON.stringify(replayTutBtnBox)})`);
    await ltMobilePage.getByTestId('settings-tab-create').click();
    const hintToggleBox = await ltMobilePage.getByTestId('hint-toggle-daily-puzzle').boundingBox();
    assert.ok(hintToggleBox && hintToggleBox.width >= 31 && hintToggleBox.height >= 31, `(i) hint button must enlarge to ~32px in Large Text (got ${JSON.stringify(hintToggleBox)})`);
    await ltMobilePage.getByTestId('settings-tab-saves').click();
    assert.equal(
      await ltMobilePage.getByTestId('toggle-auto-replay-saves-btn').count(),
      0,
      'Large Text Tab 4 Saves must not render removed duplicate toggle-auto-replay-saves-btn'
    );

    // Enable Custom Color button for all puzzles so we can verify ColorPickerPopover in Large Text mode too
    await ltMobilePage.getByTestId('settings-tab-settings').click();
    await ltMobilePage.evaluate(() => {
      const cur = window.capyStorage.loadSettings();
      window.capyStorage.saveSettings({ ...cur, enableCustomColorForAllPuzzles: true, largeText: true, fatFingerAssist: true });
    });
    await ltMobilePage.getByTestId('settings-modal-close').click();
    await ltMobilePage.getByTestId('settings-modal-close').waitFor({ state: 'hidden', timeout: 3000 });

    // Fix 4: Verify mid-dock active swatch (#8) stayed centered immediately after live Large Text toggle (before scrolling away)
    await getStableBoundingBox(ltMobilePage.locator('[data-testid="palette-dock"] button[aria-pressed="true"]'));
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
      normalMobileBoxes.settingsBtn.width >= 38 &&
        largeMobileBoxes.settingsBtn.width >= 38 &&
        largeMobileBoxes.settingsBtn.height >= 38 &&
        largeMobileBoxes.settingsBtn.width >= normalMobileBoxes.settingsBtn.width,
      true,
      `360px topbar-settings-btn must be >=38px in Normal & Large Text (normal=${normalMobileBoxes.settingsBtn.width}, large=${largeMobileBoxes.settingsBtn.width})`
    );
    assert.equal(
      normalMobileBoxes.previewBtn.width >= 38 &&
        largeMobileBoxes.previewBtn.width >= 38 &&
        largeMobileBoxes.previewBtn.width >= normalMobileBoxes.previewBtn.width,
      true,
      `360px topbar-preview-btn must be >=38px in Normal & Large Text (normal=${normalMobileBoxes.previewBtn.width}, large=${largeMobileBoxes.previewBtn.width})`
    );
    assert.equal(
      normalMobileBoxes.savesBtn.height >= 36 &&
        largeMobileBoxes.savesBtn.height >= 36 &&
        largeMobileBoxes.savesBtn.height >= normalMobileBoxes.savesBtn.height,
      true,
      `360px topbar-saves-btn must be >=36px tall in Normal & Large Text (normal=${normalMobileBoxes.savesBtn.height}, large=${largeMobileBoxes.savesBtn.height})`
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
    await getStableBoundingBox(ltMobilePage.getByTestId('replay-controls-window'));

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
    await ltMobilePage.waitForFunction(() => window.innerWidth === 412 && window.innerHeight === 915, { timeout: 3000 });
    const modernSettingsBox = await getStableBoundingBox(ltMobilePage.getByTestId('topbar-settings-btn'));
    assert.ok(modernSettingsBox && modernSettingsBox.width >= 42 && modernSettingsBox.height >= 42, `412px Large Text topbar-settings-btn must step up to >=42px (got ${JSON.stringify(modernSettingsBox)})`);

    // 22c. 1280x720 Desktop Viewport check (single-row ReplayControls + 46px topbar + stacking clearance)
    await ltMobilePage.setViewportSize({ width: 1280, height: 720 });
    await ltMobilePage.waitForFunction(() => window.innerWidth === 1280 && window.innerHeight === 720, { timeout: 3000 });
    await getStableBoundingBox(ltMobilePage.getByTestId('topbar-settings-btn'));
    await getStableBoundingBox(ltMobilePage.getByTestId('replay-controls-window'));
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
    await getStableBoundingBox(landPage.getByTestId('feature-offer-banner'));

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
    await getStableBoundingBox(landPopoverClose);
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
    await landPage
      .waitForFunction(
        () => {
          const header = document.querySelector('header');
          const undo = document.querySelector('[data-testid="undo-btn"]');
          const paint = document.querySelector('[data-testid="paint-mode-btn"]');
          const replay = document.querySelector('[data-testid="replay-controls-window"]');
          if (!header || !undo || !paint || !replay) return false;
          const h = header.getBoundingClientRect();
          const u = undo.getBoundingClientRect();
          const p = paint.getBoundingClientRect();
          const r = replay.getBoundingClientRect();
          return u.top >= h.bottom - 1 && p.bottom <= r.top + 1;
        },
        undefined,
        { timeout: 3000 }
      )
      .catch(() => {});
    const [compHeaderBox, compUndoBox, compPaintBox, compReplayBox] = await Promise.all([
      getStableBoundingBox(landPage.locator('header').first()),
      getStableBoundingBox(landPage.getByTestId('undo-btn')),
      getStableBoundingBox(landPage.getByTestId('paint-mode-btn')),
      getStableBoundingBox(landPage.getByTestId('replay-controls-window')),
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
    await waitForAnimationFrames(regPage, 2);
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
    // INTENTIONAL_TIMING_WINDOW: explicit wall-clock gap exceeding 350ms DOUBLE_TAP_TIMEOUT in PuzzleCanvas.tsx
    await regPage.waitForTimeout(450); // outside 350ms double-tap window
    await regPage.mouse.move(adjacentTarget.clientX, adjacentTarget.clientY);
    await regPage.mouse.down();
    await regPage.mouse.move(adjacentTarget.bClientX, adjacentTarget.bClientY);
    // INTENTIONAL_TIMING_WINDOW: explicit wall-clock hold satisfying >= 25ms micro-jitter Paint Mode threshold
    await regPage.waitForTimeout(40);
    await regPage.mouse.up();
    await waitForAnimationFrames(regPage, 2);
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
    await regPage.getByTestId('setting-free-color-mode').click();
    await regPage.getByTestId('settings-modal-close').click();
    await regPage.getByTestId('settings-modal-close').waitFor({ state: 'hidden', timeout: 3000 });

    await regPage.getByTestId('palette-swatch-1').click();
    await regPage.mouse.click(adjacentTarget.clientX, adjacentTarget.clientY);
    await regPage.waitForFunction(
      () => Number(document.querySelector('[data-testid="topbar-saves-btn"]')?.getAttribute('data-filled-count') || 0) === 1,
      { timeout: 3000 }
    );
    await waitForAnimationFrames(regPage, 2);
    const colorAfterFirstFill = await regPage.evaluate((rA) => {
      const active = window.capyStorage.loadActiveState();
      return active?.paintedRegionColors?.[String(rA)] ?? null;
    }, adjacentTarget.regionA);
    assert.ok(colorAfterFirstFill !== null, 'Expected regionA to record paintedRegionColors after first Free Colour tap');

    await regPage.getByTestId('palette-swatch-2').click();
    await regPage.mouse.click(adjacentTarget.clientX, adjacentTarget.clientY);
    await waitForAnimationFrames(regPage, 2);
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
    await byocPage.getByTestId('settings-modal-close').waitFor({ state: 'hidden', timeout: 3000 });
    await tapCanvasGrid(byocPage, 0.45, 6, 60);
    await byocPage.evaluate(() => {
      window.dispatchEvent(new Event('online'));
    });
    await waitForCondition(() => oneDrivePutCount > putsBeforeAutoSync, 3000);
    assert.equal(
      oneDrivePutCount > putsBeforeAutoSync,
      true,
      `Automatic background sync must push updated manifest to OneDrive (before=${putsBeforeAutoSync}, after=${oneDrivePutCount})`
    );

    await byocPage.close();
    await byocContext.close();
    logE2ePass('M4 $0 BYOC multi-provider login UI, default-off gate, 360px zero-overflow & automatic background sync verified.');

    // E2E Stage 24: Browser Storage Analyzer, Targeted Safe Cleanups, 360x780 Layout & Oversized Photo Compression
    logE2eStart('Browser Storage Analyzer modal, 360x780 zero-overflow, safe cleanups (caches/orphans/previews) & oversized photo upload compression');
    const storageContext = await browser.newContext({ viewport: { width: 360, height: 780 } });
    const storagePage = await storageContext.newPage();
    attachErrorListeners(storagePage, 'storage-analyzer');

    await storagePage.goto(`${BASE_URL}/?skipTutorial=1`, { waitUntil: 'domcontentloaded' });
    await waitForPuzzleLoaded(storagePage);
    await storagePage.waitForFunction(
      () => {
        try {
          const snaps = JSON.parse(localStorage.getItem('capy_snapshots_v8') || '[]');
          return Array.isArray(snaps) && snaps.length >= 1;
        } catch {
          return false;
        }
      },
      undefined,
      { timeout: 15000 }
    );

    const liveSnapCountBefore = await storagePage.evaluate(() => {
      const snaps = JSON.parse(localStorage.getItem('capy_snapshots_v8') || '[]');
      return snaps.length;
    });
    assert.equal(liveSnapCountBefore >= 1, true, 'Expected at least 1 active snapshot before seeding bloat');

    // Seed stale alpha caches, protected CapyGame cache/key, orphaned active IDB records, and sandboxed alpha preview DB
    await storagePage.evaluate(async () => {
      const c1 = await caches.open('capy-cache-v3.0.10:/capy/alpha/590/');
      await c1.put(
        new Request(`${location.origin}/capy/alpha/590/bundle.js`),
        new Response('a'.repeat(65536), {
          headers: { 'content-type': 'application/javascript', 'content-length': '65536' },
        })
      );
      const c2 = await caches.open('capy-cache-v3.0.11:/capy/alpha/615/');
      await c2.put(
        new Request(`${location.origin}/capy/alpha/615/bundle.js`),
        new Response('b'.repeat(32768), {
          headers: { 'content-type': 'application/javascript', 'content-length': '32768' },
        })
      );
      const otherCache = await caches.open('capygame-cache-v1');
      await otherCache.put(
        new Request(`${location.origin}/capygame/app.js`),
        new Response('g'.repeat(4096), {
          headers: { 'content-type': 'application/javascript', 'content-length': '4096' },
        })
      );

      // Seed orphaned records in active capy_game_storage_v8
      await new Promise((resolve, reject) => {
        const req = indexedDB.open('capy_game_storage_v8', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('puzzles')) db.createObjectStore('puzzles');
          if (!db.objectStoreNames.contains('images')) db.createObjectStore('images');
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['puzzles', 'images'], 'readwrite');
          tx.objectStore('puzzles').put(
            { __capyCompactV2: 2, rleRegionMap: new Uint8Array(4096) },
            'orphan-snap-999'
          );
          tx.objectStore('images').put(
            new Blob([new Uint8Array(32768)], { type: 'image/png' }),
            'orphan-snap-999'
          );
          tx.objectStore('images').put(
            `data:image/webp;base64,${'A'.repeat(1024)}`,
            'preview_orphan-snap-999'
          );
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
        req.onerror = () => reject(req.error);
      });

      // Seed sandboxed alpha preview DB + Local Storage keys + protected sibling CapyGame key
      await new Promise((resolve, reject) => {
        const req = indexedDB.open('capy_game_storage_v8_alpha', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('puzzles')) db.createObjectStore('puzzles');
          if (!db.objectStoreNames.contains('images')) db.createObjectStore('images');
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['puzzles'], 'readwrite');
          tx.objectStore('puzzles').put(
            { __capyCompactV2: 2, rleRegionMap: new Uint8Array(2048) },
            'alpha-snap-1'
          );
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
        req.onerror = () => reject(req.error);
      });

      localStorage.setItem(
        'capy_snapshots_v8__sandbox_alpha',
        JSON.stringify([{ id: 'alpha-snap-1', title: 'Alpha Preview Save' }])
      );
      localStorage.setItem('capy_game_save_v3', JSON.stringify({ capyWorld: 'protected' }));
    });

    // Open Menu -> Saves at 360x780 and verify saves-storage-info-btn + zero horizontal overflow
    await storagePage.getByTestId('topbar-settings-btn').click();
    await storagePage.getByTestId('settings-tab-saves').click();
    await storagePage.getByTestId('saves-storage-info-btn').waitFor({ state: 'visible', timeout: 5000 });

    const savesOverflow = await storagePage.evaluate(() => {
      const actionBar = document.querySelector('[data-testid="selected-save-action-bar"]');
      const scrollContainer = actionBar?.closest('.overflow-y-auto');
      return {
        actionBarOverflow: actionBar ? actionBar.scrollWidth - actionBar.clientWidth : 999,
        containerOverflow: scrollContainer
          ? scrollContainer.scrollWidth - scrollContainer.clientWidth
          : 999,
      };
    });
    assert.equal(
      savesOverflow.actionBarOverflow <= 1 && savesOverflow.containerOverflow <= 1,
      true,
      `Saves tab with Browser Storage button must have zero horizontal overflow at 360x780: ${JSON.stringify(savesOverflow)}`
    );

    // Open Browser Storage modal and verify breakdown sections + 360x780 zero overflow
    await storagePage.getByTestId('saves-storage-info-btn').click();
    await storagePage.getByTestId('browser-storage-modal').waitFor({ state: 'visible', timeout: 5000 });
    await storagePage.getByTestId('storage-quota-summary').waitFor({ state: 'visible', timeout: 10000 });
    await storagePage.getByTestId('storage-section-caches').waitFor({ state: 'visible', timeout: 5000 });
    await storagePage.getByTestId('storage-section-idb').waitFor({ state: 'visible', timeout: 5000 });
    await storagePage.getByTestId('storage-section-local').waitFor({ state: 'visible', timeout: 5000 });

    const modalText = await storagePage.getByTestId('browser-storage-modal').innerText();
    assert.equal(
      modalText.includes('Stale Alpha PR Previews (2)'),
      true,
      `Expected 2 stale alpha caches in Browser Storage modal, got:\n${modalText}`
    );
    assert.equal(
      modalText.includes('Orphaned Records (3)'),
      true,
      `Expected 3 orphaned IDB records in Browser Storage modal, got:\n${modalText}`
    );
    assert.equal(
      modalText.includes('Preview Channel DB (alpha)'),
      true,
      `Expected Preview Channel DB (alpha) in Browser Storage modal, got:\n${modalText}`
    );

    const modalOverflow = await storagePage.evaluate(() => {
      const modal = document.querySelector('[data-testid="browser-storage-modal"]');
      const body = modal?.querySelector('.overflow-y-auto');
      return {
        modalOverflow: modal ? modal.scrollWidth - modal.clientWidth : 999,
        bodyOverflow: body ? body.scrollWidth - body.clientWidth : 999,
      };
    });
    assert.equal(
      modalOverflow.modalOverflow <= 1 && modalOverflow.bodyOverflow <= 1,
      true,
      `BrowserStorageModal must have zero horizontal overflow at 360x780: ${JSON.stringify(modalOverflow)}`
    );

    // 24a. Safe Cleanup 1: Clear Stale & Offline Caches (zero save loss, preserves CapyGame cache)
    await storagePage.getByTestId('storage-clean-caches-btn').click();
    await storagePage.getByTestId('storage-clean-caches-confirm').click();
    await storagePage.getByTestId('storage-action-notice').waitFor({ state: 'visible', timeout: 10000 });
    const afterCacheClean = await storagePage.evaluate(async () => ({
      cacheNames: await caches.keys(),
      snapCount: JSON.parse(localStorage.getItem('capy_snapshots_v8') || '[]').length,
    }));
    assert.equal(
      afterCacheClean.cacheNames.some((n) => n.includes('/alpha/')),
      false,
      `Stale alpha caches must be deleted, remaining: ${afterCacheClean.cacheNames.join(', ')}`
    );
    assert.equal(
      afterCacheClean.cacheNames.includes('capygame-cache-v1'),
      true,
      'Non-Capy origin cache capygame-cache-v1 must stay protected'
    );
    assert.equal(
      afterCacheClean.snapCount,
      liveSnapCountBefore,
      'Clearing caches must preserve 100% of saved puzzles'
    );

    // 24b. Safe Cleanup 2: Clean Orphaned Save Data (zero save loss)
    await storagePage.getByTestId('storage-clean-orphans-btn').click();
    await storagePage.getByTestId('storage-clean-orphans-confirm').click();
    await storagePage.waitForFunction(
      () => {
        const btn = document.querySelector('[data-testid="storage-clean-orphans-btn"]');
        return Boolean(btn && btn.hasAttribute('disabled'));
      },
      undefined,
      { timeout: 10000 }
    );
    const afterOrphanClean = await storagePage.evaluate(async () => {
      const idbKeys = await new Promise((resolve, reject) => {
        const req = indexedDB.open('capy_game_storage_v8', 1);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['puzzles', 'images'], 'readonly');
          const pReq = tx.objectStore('puzzles').getAllKeys();
          const iReq = tx.objectStore('images').getAllKeys();
          let pKeys = [];
          let iKeys = [];
          pReq.onsuccess = () => {
            pKeys = pReq.result.map(String);
          };
          iReq.onsuccess = () => {
            iKeys = iReq.result.map(String);
          };
          tx.oncomplete = () => {
            db.close();
            resolve({ pKeys, iKeys });
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
        req.onerror = () => reject(req.error);
      });
      return {
        ...idbKeys,
        snapCount: JSON.parse(localStorage.getItem('capy_snapshots_v8') || '[]').length,
      };
    });
    assert.equal(afterOrphanClean.pKeys.includes('orphan-snap-999'), false);
    assert.equal(afterOrphanClean.iKeys.includes('orphan-snap-999'), false);
    assert.equal(afterOrphanClean.iKeys.includes('preview_orphan-snap-999'), false);
    assert.equal(afterOrphanClean.pKeys.length >= 1, true, 'Active puzzles must remain in IDB');
    assert.equal(afterOrphanClean.snapCount, liveSnapCountBefore);

    // 24c. Safe Cleanup 3: Clear Preview Channel Data (zero Production save loss & protects CapyGame)
    await storagePage.getByTestId('storage-clean-previews-btn').click();
    await storagePage.getByTestId('storage-clean-previews-confirm').click();
    await storagePage.waitForFunction(
      () => {
        const btn = document.querySelector('[data-testid="storage-clean-previews-btn"]');
        return (
          Boolean(btn && btn.hasAttribute('disabled')) &&
          localStorage.getItem('capy_snapshots_v8__sandbox_alpha') === null
        );
      },
      undefined,
      { timeout: 10000 }
    );
    const afterPreviewClean = await storagePage.evaluate(async () => {
      const dbList = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : [];
      return {
        alphaLs: localStorage.getItem('capy_snapshots_v8__sandbox_alpha'),
        capyGameLs: localStorage.getItem('capy_game_save_v3'),
        prodSnapCount: JSON.parse(localStorage.getItem('capy_snapshots_v8') || '[]').length,
        hasAlphaDb: dbList.some((d) => d.name === 'capy_game_storage_v8_alpha'),
      };
    });
    assert.equal(afterPreviewClean.alphaLs, null);
    assert.equal(afterPreviewClean.hasAlphaDb, false);
    assert.equal(afterPreviewClean.prodSnapCount, liveSnapCountBefore);
    assert.equal(
      afterPreviewClean.capyGameLs !== null,
      true,
      'CapyGame capy_game_save_v3 must remain protected'
    );

    // 24d. Escape closes BrowserStorageModal while keeping SettingsModal open
    await storagePage.waitForFunction(
      () => {
        const btn = document.querySelector('[data-testid="storage-close-btn"]');
        return Boolean(btn && !btn.hasAttribute('disabled'));
      },
      null,
      { timeout: 5000 }
    );
    await storagePage.keyboard.press('Escape');
    await storagePage.getByTestId('browser-storage-modal').waitFor({ state: 'hidden', timeout: 5000 });
    await storagePage.getByTestId('settings-modal-close').waitFor({ state: 'visible', timeout: 3000 });
    await storagePage.getByTestId('settings-modal-close').click();
    await storagePage.getByTestId('settings-modal-close').waitFor({ state: 'hidden', timeout: 3000 });

    // 24e. Oversized custom photo upload compression (2400x1800 noisy PNG -> downscaled <= 2048px & smaller WebP)
    const oversizedPngBytes = await storagePage.evaluate(async () => {
      const w = 2400;
      const h = 1800;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      const imgData = ctx.createImageData(w, h);
      const data = imgData.data;
      let seed = 0x12345678;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          seed = (seed * 1664525 + 1013904223) >>> 0;
          const idx = (y * w + x) * 4;
          data[idx] = (x * 7 + (seed & 0x3f)) & 0xff;
          data[idx + 1] = (y * 5 + ((seed >> 8) & 0x3f)) & 0xff;
          data[idx + 2] = ((x + y) * 3 + ((seed >> 16) & 0x3f)) & 0xff;
          data[idx + 3] = 255;
        }
      }
      ctx.putImageData(imgData, 0, 0);
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    });
    assert.equal(
      oversizedPngBytes.length > 400_000,
      true,
      `Expected synthetic oversized PNG > 400 KB, got ${oversizedPngBytes.length} B`
    );

    const snapIdBeforeOversized = await storagePage.evaluate(
      () => JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}').activeSnapshotId || null
    );
    await storagePage.locator('input[type="file"][accept="image/*"]').setInputFiles({
      name: 'oversized_test_photo.png',
      mimeType: 'image/png',
      buffer: Buffer.from(oversizedPngBytes),
    });
    await storagePage.waitForFunction(
      (prevId) => {
        const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
        return Boolean(active.activeSnapshotId && active.activeSnapshotId !== prevId);
      },
      snapIdBeforeOversized,
      { timeout: 25000 }
    );
    await waitForPuzzleLoaded(storagePage);

    const compressedUploadInfo = await storagePage.evaluate(async () => {
      const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
      const snapId = active.activeSnapshotId;
      for (let attempt = 0; attempt < 30; attempt++) {
        const blob = await new Promise((resolve) => {
          const req = indexedDB.open('capy_game_storage_v8', 1);
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction('images', 'readonly');
            const g = tx.objectStore('images').get(snapId);
            g.onsuccess = () => {
              db.close();
              resolve(g.result || null);
            };
            g.onerror = () => {
              db.close();
              resolve(null);
            };
          };
          req.onerror = () => resolve(null);
        });
        if (blob instanceof Blob) {
          const bmp = await createImageBitmap(blob);
          const dims = { width: bmp.width, height: bmp.height };
          bmp.close();
          return { size: blob.size, type: blob.type, ...dims };
        }
        await new Promise((r) => setTimeout(r, 150));
      }
      return null;
    });
    assert.ok(compressedUploadInfo, 'Compressed custom upload blob must persist in STORE_IMAGES');
    assert.equal(
      compressedUploadInfo.size < oversizedPngBytes.length,
      true,
      `Expected compressed blob (${compressedUploadInfo.size} B) < raw PNG (${oversizedPngBytes.length} B)`
    );
    assert.equal(
      compressedUploadInfo.width <= 2048 && compressedUploadInfo.height <= 2048,
      true,
      `Expected compressed dimensions <= 2048px, got ${compressedUploadInfo.width}x${compressedUploadInfo.height}`
    );

    // 24f. Cleanup 4: Clear All Capy Storage resets custom settings, reloads starter sample & protects CapyGame
    await storagePage.getByTestId('topbar-settings-btn').click();
    await storagePage.getByTestId('settings-tab-settings').click();
    await storagePage.getByTestId('setting-free-color-mode').click();
    const freeColorBeforeClear = await storagePage.evaluate(
      () => Boolean(JSON.parse(localStorage.getItem('capy_user_settings_v8') || '{}').isFreeColorMode)
    );
    assert.equal(freeColorBeforeClear, true, 'Expected Free Color Mode setting persisted before Clear All');

    await storagePage.getByTestId('settings-tab-saves').click();
    await storagePage.getByTestId('saves-storage-info-btn').click();
    await storagePage.getByTestId('browser-storage-modal').waitFor({ state: 'visible', timeout: 5000 });
    await storagePage.getByTestId('storage-clean-all-btn').waitFor({ state: 'visible', timeout: 10000 });
    await storagePage.getByTestId('storage-clean-all-btn').click();
    await storagePage.getByTestId('storage-clean-all-confirm').click();
    await storagePage.getByTestId('storage-action-notice').waitFor({ state: 'visible', timeout: 15000 });
    await storagePage.waitForFunction(
      () => {
        const closeBtn = document.querySelector('[data-testid="storage-close-btn"]');
        return Boolean(closeBtn && !closeBtn.hasAttribute('disabled'));
      },
      undefined,
      { timeout: 15000 }
    );
    await storagePage.keyboard.press('Escape');
    await storagePage.getByTestId('browser-storage-modal').waitFor({ state: 'hidden', timeout: 5000 });
    await storagePage.getByTestId('settings-modal-close').click();
    await storagePage.getByTestId('settings-modal-close').waitFor({ state: 'hidden', timeout: 3000 });
    await waitForPuzzleLoaded(storagePage);
    await storagePage.waitForFunction(
      () => {
        try {
          const snaps = JSON.parse(localStorage.getItem('capy_snapshots_v8') || '[]');
          return Array.isArray(snaps) && snaps.length === 1;
        } catch {
          return false;
        }
      },
      undefined,
      { timeout: 15000 }
    );
    const afterClearAll = await storagePage.evaluate(async () => {
      const settingsRaw = localStorage.getItem('capy_user_settings_v8');
      const parsedSettings = settingsRaw ? JSON.parse(settingsRaw) : null;
      const snaps = JSON.parse(localStorage.getItem('capy_snapshots_v8') || '[]');
      const cacheNames = await caches.keys();
      return {
        isFreeColorMode: parsedSettings ? Boolean(parsedSettings.isFreeColorMode) : false,
        snapCount: snaps.length,
        capyGameLs: localStorage.getItem('capy_game_save_v3'),
        hasCapyGameCache: cacheNames.includes('capygame-cache-v1'),
      };
    });
    assert.equal(
      afterClearAll.isFreeColorMode,
      false,
      'Clear All Capy Storage must reset custom settings instead of resurrecting isFreeColorMode'
    );
    assert.equal(afterClearAll.snapCount, 1, 'Clear All must reload a fresh starter sample snapshot');
    assert.equal(
      afterClearAll.capyGameLs !== null && afterClearAll.hasCapyGameCache,
      true,
      'Clear All Capy Storage must preserve CapyGame localStorage key and CacheStorage'
    );

    await storagePage.close();
    await storageContext.close();
    logE2ePass('Browser Storage Analyzer modal, 360x780 zero-overflow, all 4 cleanups, Escape isolation & oversized photo upload compression verified.');

}
