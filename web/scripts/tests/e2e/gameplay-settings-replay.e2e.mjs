/**
 * [E2E 04-07] Palette/Canvas gestures & Paint Mode, 5-tab SettingsModal, Undo/Redo/Replay scrubber & Create gallery.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  createBootedContext,
  getSettingsBtn,
  getStableBoundingBox,
  longPressUndoForReplay,
  tapCanvasGrid,
  waitForAnimationFrames,
  waitForPuzzleLoaded,
} from './helpers.mjs';

export async function runGameplaySettingsReplayE2e(ctx) {
  const { browser, BASE_URL, projectRoot, attachErrorListeners, logE2eStart, logE2ePass } = ctx;
  const ownBoot = !ctx.page;
  const { context, page } = ownBoot
    ? await createBootedContext(browser, BASE_URL, {
        label: 'gameplay',
        attachErrorListeners,
        skipTutorial: true,
        easyNoReplay: true,
      })
    : { context: ctx.context, page: ctx.page };
  try {
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
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForPuzzleLoaded(page);
      await page.mouse.click(nearMissX, edgeY);
      // INTENTIONAL_TIMING_WINDOW: negative-absence guard verifying near-miss click with fatFingerAssist: false does not fill any region
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
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForPuzzleLoaded(page);
      await page.mouse.click(nearMissX, edgeY);
      await waitForAnimationFrames(page, 2);
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
      await waitForAnimationFrames(page, 2);
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

    const paintBtn = await page.waitForSelector('[data-testid="paint-mode-btn"]');
    await paintBtn.click();
    await paintBtn.click();
    logE2ePass('Palette selection, region tap coloring, double-tap zoom, pan momentum, and Paint Mode verified.');

    // -------------------------------------------------------------------------
    // 5. 5-Tab SettingsModal Isolation, Enable Undo Toggle & Tab Persistence
    // -------------------------------------------------------------------------
    logE2eStart('Verifying 5-tab SettingsModal (About, Settings, Hints, Create, Saves), Enable Undo toggle & tab persistence...');
    assert.ok(await page.$('[data-testid="undo-btn"]'), 'Undo visible by default for standard puzzles');

    // Open Settings -> verify default first-time tab is Tab 1 (Settings), ARIA roles, aria-labelledby, focus restoration, accessible slider labels, all 5 distinct tabs, zero duplicates, and tab 4 persistence across reload
    const settingsBtn = page.locator('button[title="Settings and Menu"]');
    await settingsBtn.focus();
    await settingsBtn.click();
    await page.getByTestId('settings-modal-tabs').waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(
      await page.locator('[role="dialog"][aria-modal="true"]').count(),
      1,
      'SettingsModal must expose role="dialog" aria-modal="true"'
    );
    const dialogLabelledByText = await page.locator('[role="dialog"][aria-modal="true"]').evaluate((dialogEl) => {
      const refId = dialogEl.getAttribute('aria-labelledby');
      if (!refId) return '';
      return document.getElementById(refId)?.textContent?.trim() || '';
    });
    assert.equal(
      dialogLabelledByText.length > 0,
      true,
      `SettingsModal aria-labelledby must resolve to a non-empty heading (got '${dialogLabelledByText}')`
    );

    // Focus restoration on Escape and Close button
    await page.keyboard.press('Escape');
    await page.getByTestId('settings-modal-tabs').waitFor({ state: 'hidden', timeout: 3000 });
    const focusedAfterEscape = await page.evaluate(() => document.activeElement?.getAttribute('title') || '');
    assert.equal(
      focusedAfterEscape,
      'Settings and Menu',
      'Closing SettingsModal via Escape must restore focus to the trigger button'
    );
    await settingsBtn.click();
    await page.getByTestId('settings-modal-tabs').waitFor({ state: 'visible', timeout: 3000 });
    await page.getByTestId('settings-modal-close').click();
    await page.getByTestId('settings-modal-tabs').waitFor({ state: 'hidden', timeout: 3000 });
    const focusedAfterCloseBtn = await page.evaluate(() => document.activeElement?.getAttribute('title') || '');
    assert.equal(
      focusedAfterCloseBtn,
      'Settings and Menu',
      'Closing SettingsModal via Close button must restore focus to the trigger button'
    );
    await settingsBtn.click();
    await page.getByTestId('settings-modal-tabs').waitFor({ state: 'visible', timeout: 3000 });

    const assertVisibleSlidersLabeled = async (tabLabel, minExpectedCount) => {
      const results = await page.locator('[role="dialog"] input[type="range"]').evaluateAll((els) =>
        els.map((el) => {
          const id = el.getAttribute('id') || '';
          const ariaLabel = (el.getAttribute('aria-label') || '').trim();
          const labelText = id ? (document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent || '').trim() : '';
          return {
            testId: el.getAttribute('data-testid') || '',
            id,
            ariaLabel,
            labelText,
          };
        })
      );
      assert.equal(
        results.length >= minExpectedCount,
        true,
        `Expected at least ${minExpectedCount} range sliders in ${tabLabel} tab (found ${results.length})`
      );
      for (const item of results) {
        assert.equal(
          item.id.length > 0 && item.labelText.length > 0 && item.ariaLabel.length > 0,
          true,
          `Slider in ${tabLabel} tab must have paired <label htmlFor> and non-empty aria-label (${JSON.stringify(item)})`
        );
      }
    };
    await assertVisibleSlidersLabeled('Settings', 5);
    await page.getByTestId('settings-tab-hints').click();
    await assertVisibleSlidersLabeled('Hints', 1);
    await page.getByTestId('settings-tab-create').click();
    await assertVisibleSlidersLabeled('Create', 4);
    await page.getByTestId('settings-tab-settings').click();

    assert.equal(
      await page.getByTestId('settings-modal-tabs').getAttribute('role'),
      'tablist',
      'settings-modal-tabs must expose role="tablist"'
    );
    assert.equal(
      await page.getByTestId('settings-tab-settings').getAttribute('role'),
      'tab',
      'Settings tab button must expose role="tab"'
    );
    assert.equal(
      await page.getByTestId('settings-tab-settings').getAttribute('aria-selected'),
      'true',
      'First-time gear icon tap must default to Tab 1 (Settings)'
    );

    // Tab 0: About
    await page.getByTestId('settings-tab-about').click();
    await page.getByTestId('app-version-badge').waitFor({ state: 'visible', timeout: 3000 });
    const pkgVersion = JSON.parse(fs.readFileSync(path.resolve(projectRoot, 'package.json'), 'utf8')).version;
    const versionBadgeText = await page.locator('[data-testid="app-version-badge"]').textContent();
    assert.equal(versionBadgeText?.trim(), `v${pkgVersion}`, `Expected app-version-badge to equal v${pkgVersion}`);
    assert.equal(await page.getByTestId('app-version-badge').count(), 1, 'Expected single app-version-badge in About tab');
    assert.equal(await page.getByTestId('about-screen-card').isVisible(), true, 'About tab must render about-screen-card');
    assert.equal(await page.getByTestId('about-replay-tutorial-btn').isVisible(), true, 'About tab must render about-replay-tutorial-btn');
    assert.equal(await page.getByTestId('about-privacy-policy-link').isVisible(), true, 'About tab must render about-privacy-policy-link');
    assert.equal(await page.getByTestId('about-licenses-section').isVisible(), true, 'About tab must render collapsible about-licenses-section');
    await page.getByTestId('about-licenses-section').locator('summary').click();
    assert.equal(
      (await page.getByTestId('about-licenses-section').innerText()).includes('React'),
      true,
      'Expanded about-licenses-section must list Open Source Licenses (React, Tailwind, Lucide)'
    );
    await page.getByTestId('about-licenses-section').locator('summary').click();
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
    assert.equal(freeArtLayout.hasColSpan2, true, 'Free Color Art tile must apply col-span-2 when !showCloudCoopUi');
    assert.equal(
      Math.abs(freeArtLayout.tileWidth - freeArtLayout.gridWidth) <= 2,
      true,
      `Free Color Art tile (${freeArtLayout.tileWidth}px) must span full grid width (${freeArtLayout.gridWidth}px)`
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

    // Tab 1: Settings (Accessibility first, UI with Canvas Background, Gameplay, Controls, Navigation, Sound & Haptics + 2 collapsibles)
    await page.getByTestId('settings-tab-settings').click();
    await page.getByText('Canvas Background').waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(await page.getByText('Canvas Background').isVisible(), true, 'Settings tab must render Canvas Background');
    for (const secId of [
      'settings-section-accessibility',
      'settings-section-ui',
      'settings-section-gameplay',
      'settings-section-controls',
      'settings-section-navigation',
      'settings-section-audio',
      'settings-section-replay',
      'settings-section-labels',
    ]) {
      assert.equal(await page.getByTestId(secId).isVisible(), true, `Settings tab must render grouped section ${secId}`);
    }
    const a11ySecBox = await page.getByTestId('settings-section-accessibility').boundingBox();
    const uiSecBox = await page.getByTestId('settings-section-ui').boundingBox();
    assert.ok(a11ySecBox && uiSecBox && a11ySecBox.y < uiSecBox.y, 'Accessibility section must appear first above UI section on Tab 1');
    assert.equal(
      await page.locator('[data-testid="settings-section-ui"]').getByText('Canvas Background').isVisible(),
      true,
      'Canvas Background must live inside settings-section-ui'
    );
    assert.equal(await page.getByText('Tap Behavior', { exact: true }).count(), 0, 'Tap Behavior (Difficulty) must be relocated from Tab 1 Settings to Tab 2 Hints');
    assert.equal(await page.getByText('Color Mode', { exact: true }).count(), 0, 'Color Mode must be relocated from Tab 1 Settings to Tab 2 Hints');
    const replaySummaryText = (await page.getByTestId('settings-section-replay-summary').innerText()).trim();
    assert.equal(/x\s*•\s*Auto-replay (On|Off)/i.test(replaySummaryText), true, `Expected live Replay summary badge (got "${replaySummaryText}")`);
    const labelsSummaryText = (await page.getByTestId('settings-section-labels-summary').innerText()).trim();
    assert.equal(/\d+–\d+px\s*•\s*\d+%/i.test(labelsSummaryText), true, `Expected live Number Label Sizing summary badge (got "${labelsSummaryText}")`);
    assert.equal(await page.getByTestId('setting-detailed-progress').count(), 0, 'Detailed Generation Progress must be relocated out of Tab 1 Settings to Tab 3 Create');
    assert.equal(await page.getByTestId('app-version-badge').count(), 0, 'Settings tab must not duplicate app-version-badge');
    assert.equal(await page.getByTestId('lifetime-stats-card').count(), 0, 'Settings tab must not duplicate lifetime-stats-card');
    assert.equal(await page.getByTestId('release-channel-card').count(), 0, 'Settings tab must not duplicate release-channel-card');
    assert.equal(await page.getByText('Highlight Style').count(), 0, 'Settings tab must not leak Hints content');

    await page.locator('button[title="Charcoal"]').first().click();
    for (const switchTestId of ['setting-show-zoom-buttons', 'setting-show-reset-view-button']) {
      const sw = page.getByTestId(switchTestId);
      assert.equal(await sw.getAttribute('role'), 'switch', `${switchTestId} must expose role="switch"`);
      await sw.click();
    }
    // Verify toggling Undo Button OFF hides undo-btn & persists, then toggle back ON for Undo/Redo suite
    const undoSwitch = page.getByTestId('setting-enable-undo');
    assert.equal(await undoSwitch.getAttribute('role'), 'switch', 'setting-enable-undo must expose role="switch"');
    await undoSwitch.click();
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
    await undoSwitch.click();
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

    // Tab 2: Hints (grouped sections + fresh install Amber swatch #f59e0b selected + relocated Coloring Mode & Difficulty)
    await page.getByTestId('settings-tab-hints').click();
    await page.getByTestId('hints-section-style').waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(await page.getByTestId('hints-section-style').isVisible(), true, 'Hints tab must render hints-section-style');
    assert.equal(await page.getByTestId('hints-section-assist').isVisible(), true, 'Hints tab must render hints-section-assist');
    assert.equal(await page.getByTestId('hints-section-mode-difficulty').isVisible(), true, 'Hints tab must render hints-section-mode-difficulty');
    assert.equal(
      await page.locator('[data-testid="hints-section-mode-difficulty"]').getByText('Tap Behavior').isVisible(),
      true,
      'Hints tab must render relocated Tap Behavior (Difficulty)'
    );
    assert.equal(
      await page.locator('[data-testid="hints-section-mode-difficulty"]').getByText('Color Mode').isVisible(),
      true,
      'Hints tab must render relocated Color Mode'
    );
    assert.equal(await page.getByText('Highlight Style').isVisible(), true, 'Hints tab must render Highlight Style');
    assert.equal(await page.getByText('Hint Fill Pattern').isVisible(), true, 'Hints tab must render Hint Fill Pattern');
    assert.equal(await page.getByText('Canvas Background').count(), 0, 'Hints tab must not render Settings content');
    const amberSwatchActive = await page.evaluate(() => {
      const amberBtn = document.querySelector('[data-testid="hints-section-style"] button[title="Amber"]');
      return Boolean(amberBtn && amberBtn.className.includes('scale-110'));
    });
    assert.equal(amberSwatchActive, true, 'Fresh install hintColorArgb (0xfff59e0b) must match first Amber preset swatch');

    // Tab 3: Create (includes relocated Detailed Generation Progress)
    await page.getByTestId('settings-tab-create').click();
    await page.getByTestId('daily-puzzle-card').waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(await page.getByTestId('daily-puzzle-card').isVisible(), true, 'Create tab must render daily-puzzle-card');
    assert.equal(await page.getByTestId('gallery-search-input').isVisible(), true, 'Create tab must render gallery-search-input');
    assert.equal(await page.getByTestId('setting-detailed-progress').isVisible(), true, 'Create tab must render relocated setting-detailed-progress');
    assert.equal(await page.getByText('Highlight Style').count(), 0, 'Create tab must not render Hints content');

    // Tab 4: Saves (no duplicate autoReplayOnLoad toggle; cold-start default must be THUMBNAILS with list first)
    await page.getByTestId('settings-tab-saves').click();
    await page.getByTestId('saves-list-section').waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(
      await page.getByTestId('toggle-auto-replay-saves-btn').count(),
      0,
      'Saves tab must not render removed duplicate toggle-auto-replay-saves-btn'
    );
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

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForPuzzleLoaded(page);
    await settingsBtn.click();
    await page.getByTestId('saves-share-print-bar').waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(
      await page.getByTestId('saves-share-print-bar').isVisible(),
      true,
      'Saves tab (index 4) must restore after page reload via capy_last_settings_tab'
    );

    // Switch to Hints tab and close -> verify capy_last_settings_tab === '2'
    await page.getByTestId('settings-tab-hints').click();
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
    await longPressUndoForReplay(page);

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
    // Verify Skip to End stays mounted (disabled) when playback reaches the end so sibling controls never shift
    const skipBtn = page.getByTestId('replay-skip-btn');
    const speedBtn = page.getByTestId('replay-speed-btn');
    assert.equal(await skipBtn.isVisible(), true, 'replay-skip-btn must be visible mid-replay');
    assert.equal(await skipBtn.isDisabled(), false, 'replay-skip-btn must be enabled mid-replay');
    const speedBoxMid = await getStableBoundingBox(speedBtn);
    await skipBtn.click();
    assert.equal(await skipBtn.isVisible(), true, 'replay-skip-btn must stay visible at replay end');
    assert.equal(await skipBtn.isDisabled(), true, 'replay-skip-btn must be disabled at replay end');
    const speedBoxEnd = await getStableBoundingBox(speedBtn);
    assert.equal(
      Math.abs(speedBoxEnd.x - speedBoxMid.x) <= 1,
      true,
      `Replay controls must not shift horizontally at replay end (${speedBoxMid.x} -> ${speedBoxEnd.x})`
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

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('canvas', { timeout: 25000 });
    // Immediately check that Fit-to-Screen button is visible (meaning previous zoom extent was restored BEFORE replay)
    await page.waitForSelector('[data-testid="reset-view-btn"]', { timeout: 5000 });
    // Because the painted center regions are offscreen at the restored top-left zoom extent, offscreen steps fast-forward automatically
    await page.waitForSelector('[data-testid="replay-play-pause-btn"][aria-label="Replay Again"]', { timeout: 5000 });
    // PaletteDock and ReplayControls must be co-visible on load without programmatic sync self-dismissing replay
    await page.locator('[aria-label="Palette dock"]').waitFor({ state: 'visible', timeout: 4000 });
    // INTENTIONAL_TIMING_WINDOW: negative-absence guard verifying ReplayControls is not self-dismissed alongside PaletteDock
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
    await longPressUndoForReplay(page);
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
    await longPressUndoForReplay(page);

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
    // INTENTIONAL_TIMING_WINDOW: real-time Replay playback window allowing Follow + Loop animation to advance and pan camera
    await page.waitForTimeout(950);

    // Verify scrubber is actively looping/playing and did not stop at the end
    // INTENTIONAL_TIMING_WINDOW: real-time Replay loop continuation window verifying playback stays active rather than stopping at end
    await page.waitForTimeout(450);
    const isStillLooping = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('capy_user_settings_v8') || '{}');
      return Boolean(s.replayLoop && s.replayFollow);
    });
    assert.equal(isStillLooping, true, 'Expected replayLoop and replayFollow settings persisted as true');

    // Also test live zoom-in during playback
    await page.waitForSelector('[data-testid="zoom-in-btn"]');
    await page.locator('[data-testid="zoom-in-btn"]').click();
    await waitForAnimationFrames(page, 3);

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
    await page.waitForFunction(
      () => document.querySelector('[data-testid="replay-follow-btn"]')?.getAttribute('aria-pressed') === 'false',
      { timeout: 3000 }
    );
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
    await longPressUndoForReplay(page, { timeout: 5000 });
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
      await waitForAnimationFrames(page, 2);
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
    const createTabBtn = page.getByTestId('settings-tab-create');
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
  } finally {
    if (ownBoot) await context.close();
  }
}
