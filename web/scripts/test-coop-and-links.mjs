import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const BASE_URL = process.env.CAPY_TEST_URL || 'http://localhost:3000';

async function waitForPuzzleLoaded(page) {
  await page.waitForSelector('canvas', { timeout: 25000 });
  await page.waitForSelector('[aria-label="Palette dock"]', { timeout: 25000 });
  await page.waitForTimeout(300);
}

async function disableAutoReplay(page) {
  await page.evaluate(() => {
    const raw = localStorage.getItem('capy_user_settings_v8');
    const parsed = raw ? JSON.parse(raw) : {};
    parsed.autoReplayOnLoad = false;
    parsed.difficulty = 'EASY';
    parsed.enableUndo = true;
    localStorage.setItem('capy_user_settings_v8', JSON.stringify(parsed));
  });
}

async function tapCanvasGrid(page, startFrac = 0.32, count = 8) {
  const canvas = await page.$('canvas');
  const box = await canvas.boundingBox();
  const cols = 4;
  for (let i = 0; i < count; i++) {
    const x = box.x + box.width * (startFrac + (i % cols) * 0.09);
    const y = box.y + box.height * (startFrac + Math.floor(i / cols) * 0.09);
    await page.mouse.click(x, y);
    await page.waitForTimeout(310);
  }
  await page.waitForTimeout(200);
}

async function run() {
  console.log(`Running Phase 3 & Phase 4 Co-op, Share Links, Cloud Sync & Gallery E2E suite against ${BASE_URL}...`);
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
    page.on('pageerror', (err) => {
      consoleErrors.push(`[${label}] ${err.message}`);
    });
  };

  try {
    // =========================================================================
    // 1. Gallery Search, Filter Chips & Community Idea Moderation + Upvoting
    // =========================================================================
    console.log('1. Testing Gallery Search, Category Filter Chips & Community Puzzle Ideas...');
    const ctx1 = await browser.newContext({
      viewport: { width: 1280, height: 860 },
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const pageA = await ctx1.newPage();
    attachErrorListeners(pageA, 'pageA');

    await pageA.goto(BASE_URL, { waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(pageA);
    await disableAutoReplay(pageA);
    await pageA.reload({ waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(pageA);

    // Open Settings -> Tab 2 (Create)
    await pageA.locator('button[title="Settings and Menu"]').click();
    await pageA.waitForTimeout(200);
    await pageA.getByRole('button', { name: 'Create', exact: true }).click();
    await pageA.waitForTimeout(200);

    // Filter by "Music" tag chip -> Snail Guitar visible, Capybara hidden
    await pageA.getByTestId('gallery-tag-music').click();
    await pageA.waitForTimeout(150);
    const musicGalleryText = await pageA.evaluate(() => document.body.innerText);
    assert.equal(musicGalleryText.includes('Snail Guitar'), true, 'Expected Snail Guitar under Music tag');
    assert.equal(musicGalleryText.includes('Kitten Yarn'), false, 'Expected Kitten Yarn hidden under Music tag');

    // Search non-existent query -> empty state + Reset Filters
    await pageA.getByTestId('gallery-search-input').fill('nonexistent_xyz_artwork');
    await pageA.waitForTimeout(150);
    await pageA.getByTestId('gallery-empty-state').waitFor({ state: 'visible' });
    await pageA.getByRole('button', { name: 'Reset Filters' }).click();
    await pageA.waitForTimeout(150);

    // Community Puzzle Ideas: test family-friendly safety rejection + valid submission + upvote
    await pageA.getByTestId('toggle-idea-form-btn').click();
    await pageA.getByTestId('idea-title-input').fill('Unsafe nsfw test');
    await pageA.getByTestId('idea-prompt-input').fill('Testing prompt safety moderation filter');
    await pageA.getByTestId('submit-idea-btn').click();
    await pageA.waitForTimeout(150);
    const unsafeFeedback = await pageA.getByTestId('idea-feedback-banner').innerText();
    assert.equal(
      unsafeFeedback.toLowerCase().includes('family-friendly'),
      true,
      `Expected family-friendly moderation warning, got: ${unsafeFeedback}`
    );

    await pageA.getByTestId('idea-title-input').fill('Lantern Capybara Festival');
    await pageA.getByTestId('idea-prompt-input').fill('Warm paper lanterns floating over a calm twilight river with capybaras.');
    await pageA.getByTestId('submit-idea-btn').click();
    await pageA.waitForTimeout(200);
    const ideaSectionText = await pageA.getByTestId('community-ideas-section').innerText();
    assert.equal(
      ideaSectionText.includes('Lantern Capybara Festival'),
      true,
      'Expected newly submitted idea to appear in Community Puzzle Ideas list'
    );

    // Toggle vote on top community idea
    const firstVoteBtn = pageA.locator('[data-testid^="vote-idea-"]').first();
    const beforeVotes = parseInt((await firstVoteBtn.innerText()).trim(), 10);
    await firstVoteBtn.click();
    await pageA.waitForTimeout(100);
    const afterVotes = parseInt((await firstVoteBtn.innerText()).trim(), 10);
    assert.notEqual(afterVotes, beforeVotes, 'Expected idea vote toggle to update count');

    await pageA.keyboard.press('Escape');
    await pageA.waitForTimeout(200);
    console.log('   PASS: Gallery search, tag chips, community idea moderation, and voting verified.');

    // =========================================================================
    // 2. Shareable Progress Link (#s=<ProgressDeltaV2Token>) Round-Trip
    // =========================================================================
    console.log('2. Testing Shareable Progress Link (#s=<token>) across isolated browser contexts...');
    await tapCanvasGrid(pageA, 0.3, 16);

    const paintedIdsOnA = await pageA.evaluate(() => {
      const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
      return active.filledRegionIds || [];
    });
    assert.equal(
      paintedIdsOnA.length >= 2,
      true,
      `Expected >= 2 filled regions on pageA before sharing link, got ${paintedIdsOnA.length}`
    );

    // Open Co-op / Saves hub from top bar and click Share Progress Link
    await pageA.getByTestId('topbar-coop-btn').click();
    await pageA.waitForTimeout(250);
    await pageA.getByTestId('share-progress-link-btn').click();
    await pageA.waitForTimeout(250);

    const sharedUrl = await pageA.evaluate(() => navigator.clipboard.readText());
    assert.equal(sharedUrl.includes('#s='), true, `Expected #s=<token> in clipboard URL, got: ${sharedUrl}`);
    assert.equal(sharedUrl.length < 2048, true, `Expected compact share link < 2 KB, got ${sharedUrl.length} chars`);

    // Also push Page A's progress to Cloud Sync vault so we can test CRDT merge next
    await pageA.getByTestId('cloud-sync-btn').click();
    await pageA.waitForTimeout(250);
    const cloudVaultRawFromA = await pageA.evaluate(() => localStorage.getItem('capy_cloud_vault_v1'));
    assert.equal(Boolean(cloudVaultRawFromA), true, 'Expected cloud vault envelope persisted after Cloud Sync');

    // Boot a brand-new isolated BrowserContext at sharedUrl and verify regions restore!
    const ctxIsolated = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const pageRecipient = await ctxIsolated.newPage();
    attachErrorListeners(pageRecipient, 'pageRecipient');

    await pageRecipient.goto(sharedUrl, { waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(pageRecipient);
    await pageRecipient.waitForTimeout(500);

    const recipientFilledIds = await pageRecipient.evaluate(() => {
      const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
      return active.filledRegionIds || [];
    });
    assert.deepEqual(
      [...recipientFilledIds].sort((a, b) => a - b),
      [...paintedIdsOnA].sort((a, b) => a - b),
      'Recipient opening #s=<token> URL must restore the exact painted region IDs'
    );
    await ctxIsolated.close();
    console.log(`   PASS: Shareable URL (${sharedUrl.length} chars) restored ${recipientFilledIds.length} painted regions in an isolated browser.`);

    // =========================================================================
    // 3. Simultaneous Real-Time Co-op Multiplayer (BroadcastChannel + Live Sync)
    // =========================================================================
    console.log('3. Testing Simultaneous Real-Time Co-op Room sync between two live tabs...');
    // Page A is currently on Saves & Co-op tab -> Host Co-op Room
    await pageA.getByTestId('host-coop-room-btn').click();
    await pageA.waitForTimeout(250);
    const roomBadgeText = await pageA.getByTestId('active-coop-room-code').innerText();
    const roomMatch = roomBadgeText.match(/Room\s+([A-Z0-9]{6})/);
    assert.equal(Boolean(roomMatch), true, `Expected 6-char room code in badge, got: ${roomBadgeText}`);
    const roomCode = roomMatch[1];
    await pageA.keyboard.press('Escape');
    await pageA.waitForTimeout(200);

    // Open Page B in the SAME BrowserContext so BroadcastChannel connects Page A <-> Page B
    const pageB = await ctx1.newPage();
    attachErrorListeners(pageB, 'pageB');
    await pageB.goto(BASE_URL, { waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(pageB);

    // Join roomCode on Page B
    await pageB.getByTestId('topbar-coop-btn').click();
    await pageB.waitForTimeout(250);
    await pageB.getByTestId('join-coop-room-input').fill(roomCode);
    await pageB.getByTestId('join-coop-room-btn').click();
    await pageB.waitForTimeout(400);

    const pageBRoomBadge = await pageB.getByTestId('active-coop-room-code').innerText();
    assert.equal(
      pageBRoomBadge.includes('2 online'),
      true,
      `Expected Page B Co-op badge to show 2 online peers, got: ${pageBRoomBadge}`
    );
    await pageB.keyboard.press('Escape');
    await pageB.waitForTimeout(250);

    //Verify top bar live co-op pill shows 2 collaborators on both pages
    const pillCountA = await pageA.getByTestId('topbar-active-coop-pill').innerText();
    assert.equal(pillCountA.includes('2'), true, `Expected topbar co-op pill on Page A to include peer count 2, got: ${pillCountA}`);

    const countBeforeCoopPaint = paintedIdsOnA.length;
    // Paint new regions on a different quadrant of Page A's canvas!
    await tapCanvasGrid(pageA, 0.52, 16);
    await pageB.waitForTimeout(450);

    const countAfterOnA = await pageA.evaluate(() => {
      const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
      return (active.filledRegionIds || []).length;
    });
    assert.equal(
      countAfterOnA > countBeforeCoopPaint,
      true,
      `Expected Page A to paint additional regions (${countBeforeCoopPaint} -> ${countAfterOnA})`
    );

    // Verify Page B's live React UI header progress percentage matches Page A's header without reloading!
    const [headerPctA, headerPctB] = await Promise.all([
      pageA.locator('header').innerText(),
      pageB.locator('header').innerText(),
    ]);
    const extractPct = (s) => {
      const m = s.match(/(\d+)%/);
      return m ? Number(m[1]) : -1;
    };
    assert.equal(
      extractPct(headerPctB),
      extractPct(headerPctA),
      `Expected Page B live progress % (${extractPct(headerPctB)}%) to match Page A (${extractPct(headerPctA)}%) in real time`
    );
    console.log(`   PASS: Live Co-op Room ${roomCode} synchronized real-time strokes across 2 online peers (${extractPct(headerPctB)}%).`);

    // =========================================================================
    // 4. Conflict-Free CRDT Cloud Sync (Set-Union Merge Across Devices)
    // =========================================================================
    console.log('4. Testing Conflict-Free CRDT Cloud Sync Set-Union merge...');
    const ctxCloudDevice2 = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const pageDevice2 = await ctxCloudDevice2.newPage();
    attachErrorListeners(pageDevice2, 'pageDevice2');

    await pageDevice2.goto(BASE_URL, { waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(pageDevice2);
    await disableAutoReplay(pageDevice2);
    // Seed cloud vault from Device 1 (Page A) while Device 2 paints a different corner offline!
    await pageDevice2.evaluate((vaultRaw) => {
      localStorage.setItem('capy_cloud_vault_v1', vaultRaw);
    }, cloudVaultRawFromA);
    await pageDevice2.reload({ waitUntil: 'networkidle' });
    await waitForPuzzleLoaded(pageDevice2);

    // Paint bottom-right corner on Device 2
    await tapCanvasGrid(pageDevice2, 0.62, 12);
    const localIdsBeforeSync = await pageDevice2.evaluate(() => {
      const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
      return active.filledRegionIds || [];
    });

    // Trigger Play Games Login + Cloud Sync on Device 2
    await pageDevice2.getByTestId('topbar-coop-btn').click();
    await pageDevice2.waitForTimeout(200);
    await pageDevice2.getByTestId('play-games-signin-btn').click();
    await pageDevice2.waitForTimeout(150);
    await pageDevice2.getByTestId('cloud-sync-btn').click();
    await pageDevice2.waitForTimeout(400);

    const mergedIdsAfterSync = await pageDevice2.evaluate(() => {
      const active = JSON.parse(localStorage.getItem('capy_active_session_v8') || '{}');
      return active.filledRegionIds || [];
    });

    const expectedUnion = new Set([...localIdsBeforeSync, ...paintedIdsOnA]);
    assert.equal(
      mergedIdsAfterSync.length,
      expectedUnion.size,
      `Expected CRDT Set-Union size ${expectedUnion.size}, got ${mergedIdsAfterSync.length}`
    );
    for (const id of expectedUnion) {
      assert.equal(mergedIdsAfterSync.includes(id), true, `Missing region ${id} from CRDT Set-Union`);
    }
    await ctxCloudDevice2.close();
    console.log(`   PASS: CRDT Cloud Sync merged Device 1 (${paintedIdsOnA.length}) + Device 2 (${localIdsBeforeSync.length}) -> ${mergedIdsAfterSync.length} union regions with zero data loss.`);

    // =========================================================================
    // 5. Multi-Resolution Infinite Zoom 2x Detail Sub-Tile + Privacy Policy Page
    // =========================================================================
    console.log('5. Testing Infinite Zoom 2x Detail Tile generation & Play Store Privacy Policy...');
    await pageA.locator('button[title="Settings and Menu"]').click();
    await pageA.waitForTimeout(200);
    await pageA.getByRole('button', { name: 'Create', exact: true }).click();
    await pageA.waitForTimeout(200);
    await pageA.getByTestId('infinite-zoom-subtile-btn').click();
    await pageA.waitForTimeout(400);
    await waitForPuzzleLoaded(pageA);

    const headerAfterZoomTile = await pageA.locator('header').innerText();
    assert.equal(
      headerAfterZoomTile.includes('(2x Detail)'),
      true,
      `Expected active title to include "(2x Detail)", got: ${headerAfterZoomTile}`
    );

    const privacyRes = await pageA.goto(`${BASE_URL}/privacy-policy.html`, { waitUntil: 'domcontentloaded' });
    assert.equal(privacyRes.status(), 200, 'Expected /privacy-policy.html to return HTTP 200');
    const privacyText = await pageA.evaluate(() => document.body.innerText);
    assert.equal(
      privacyText.includes('Google Play Data Safety'),
      true,
      'Expected Google Play Data Safety section in privacy-policy.html'
    );

    await ctx1.close();

    assert.equal(
      consoleErrors.length,
      0,
      `Expected zero unhandled page errors, got:\n${consoleErrors.join('\n')}`
    );
    console.log('ALL PHASE 3 & PHASE 4 E2E TESTS PASSED!');
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error('Co-op & Share Links E2E suite failed:', err);
  process.exit(1);
});
