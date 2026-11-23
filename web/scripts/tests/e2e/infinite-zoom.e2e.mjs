/**
 * Opaque-Box Playwright E2E Suite for Capy Paint Issue #606:
 * Bidirectional In-Browser Local AI Infinite Zoom (PR Slice 1).
 *
 * Exact 4 Stages (deterministic, zero external network dependencies):
 *   Stage 1: Manual toolbar popover, inline Guide Prompt + chips, 4-connected selection
 *            (painted warning + 1-tap Switch Selection), seamless in-place subdivision,
 *            camera viewport preservation, untouched vs replaced progress & Undo/Redo scrub,
 *            built-in sample-to-blob promotion, and 1-tap Undo Subdivision revert.
 *   Stage 2: Small-region Deep Child Tile promotion, transparent rId <= 0 organic cutout
 *            (IDB PuzzleData + IDB image Blob alpha + live canvas charcoal corners),
 *            bidirectional Outer/Inner breadcrumbs, and snapshot deletion orphan pruning.
 *   Stage 3: Directional Border Extension (Top + Right) with inline prompt + chips into fresh
 *            0% outer puzzle keeping inner progress intact, 2.5:1 aspect guard on repeated
 *            horizontal stretching, and Tier 1 mock LanguageModel + loading-cancel-btn AbortController.
 *   Stage 4: Offline BroadcastChannel Co-op guard, active Replay guard, CreateTab parity
 *            (legacy infinite-zoom-subtile-btn + new controls + local-ai-mode-select persistence),
 *            and 360x780 + Large Text mobile/a11y layout & TopBar lane containment.
 */
import assert from 'node:assert/strict';
import {
  createBootedContext,
  getStableBoundingBox,
  readTotalRemainingRegions,
  tapCanvasGrid,
  waitForAnimationFrames,
  waitForCondition,
  waitForPuzzleLoaded,
} from './helpers.mjs';

const ACTIVE_SESSION_KEY = 'capy_active_session_v8';
const SNAPSHOTS_KEY = 'capy_snapshots_v8';
const SETTINGS_KEY = 'capy_user_settings_v8';

/**
 * Reads active session metadata from localStorage.
 */
async function readActiveSession(page) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (raw === null || raw.trim() === '') return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`Malformed active session JSON in ${key}: expected object`);
    }
    return parsed;
  }, ACTIVE_SESSION_KEY);
}

/**
 * Reads saved snapshot list from localStorage.
 */
async function readSnapshots(page) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (raw === null || raw.trim() === '') return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error(`Malformed snapshots JSON in ${key}: expected array`);
    }
    return parsed;
  }, SNAPSHOTS_KEY);
}

/**
 * Deterministically maps puzzle regions from IDB PuzzleData into exact live screen
 * coordinates using the public 0.92 fit formula and persisted camera transform.
 * Filters target click points strictly into the unobstructed canvas center area
 * so clicks never collide with GameTopBar, FloatingActions, or PaletteDock.
 */
async function findRegionClickTargets(page, snapId) {
  return page.evaluate(
    async ({ targetSnapId, sessionKey }) => {
      const canvas = document.querySelector('[data-testid="puzzle-canvas"]');
      if (!canvas || !window.capyStorage) return null;
      const puzzle = await window.capyStorage.loadPuzzleData(targetSnapId);
      if (!puzzle || !puzzle.regions || !puzzle.regionMap) return null;

      const rect = canvas.getBoundingClientRect();
      const session = JSON.parse(localStorage.getItem(sessionKey) || '{}');
      const zoomScale = typeof session.zoomScale === 'number' && session.zoomScale > 0 ? session.zoomScale : 1;
      const panOffsetX = typeof session.panOffsetX === 'number' ? session.panOffsetX : 0;
      const panOffsetY = typeof session.panOffsetY === 'number' ? session.panOffsetY : 0;

      const pw = puzzle.width;
      const ph = puzzle.height;
      const w = rect.width;
      const h = rect.height;
      const baseScale = Math.min(w / pw, h / ph) * 0.92;
      const baseOffsetX = (w - pw * baseScale) / 2;
      const baseOffsetY = (h - ph * baseScale) / 2;
      const effScale = zoomScale * baseScale;

      const safeMinX = rect.left + 28;
      const safeMaxX = rect.right - 108;
      const safeMinY = rect.top + 96;
      const safeMaxY = rect.bottom - 240;

      const toScreen = (px, py) => ({
        clientX: rect.left + panOffsetX + baseOffsetX + (px + 0.5) * effScale,
        clientY: rect.top + panOffsetY + baseOffsetY + (py + 0.5) * effScale,
      });

      const isSafe = (pt) =>
        pt.clientX >= safeMinX &&
        pt.clientX <= safeMaxX &&
        pt.clientY >= safeMinY &&
        pt.clientY <= safeMaxY;

      const buildAdjacency = (rm, width, height) => {
        const map = new Map();
        const link = (u, v) => {
          if (u <= 0 || v <= 0 || u === v) return;
          if (!map.has(u)) map.set(u, new Set());
          if (!map.has(v)) map.set(v, new Set());
          map.get(u).add(v);
          map.get(v).add(u);
        };
        for (let y = 0; y < height; y++) {
          const rowOff = y * width;
          for (let x = 0; x < width; x++) {
            const rid = rm[rowOff + x];
            if (rid <= 0) continue;
            if (x + 1 < width) link(rid, rm[rowOff + x + 1]);
            if (y + 1 < height) link(rid, rm[rowOff + width + x]);
          }
        }
        return map;
      };

      const findSafeHit = (r, rm) => {
        const cx = Math.max(0, Math.min(pw - 1, Math.round(r.centroidX)));
        const cy = Math.max(0, Math.min(ph - 1, Math.round(r.centroidY)));
        if (rm[cy * pw + cx] === r.id) {
          const s = toScreen(cx, cy);
          if (isSafe(s)) return { px: cx, py: cy, ...s };
        }
        if (!r.pixels || r.pixels.length === 0) return null;
        const step = Math.max(1, Math.floor(r.pixels.length / 40));
        const scan = (startIdx) => {
          for (let i = startIdx; i < r.pixels.length; i += step) {
            const idx = r.pixels[i];
            const px = idx % pw;
            const py = Math.floor(idx / pw);
            const s = toScreen(px, py);
            if (isSafe(s)) return { px, py, ...s };
          }
          return null;
        };
        return scan(Math.floor(r.pixels.length / 2)) || scan(0);
      };

      const screenDist = (p1, p2) => Math.hypot(p1.clientX - p2.clientX, p1.clientY - p2.clientY);
      const MIN_TAP_SEP_PX = 48;

      const pickLargePair = (byAreaDesc, clickableById, adj) => {
        for (const a of byAreaDesc) {
          const neighbors = adj.get(a.id);
          if (!neighbors || neighbors.size === 0) continue;
          for (const nbId of neighbors) {
            const b = clickableById.get(nbId);
            if (!b) continue;
            if (screenDist(a, b) < MIN_TAP_SEP_PX) continue;
            const unionArea = a.area + b.area;
            const unionW = Math.max(a.maxX, b.maxX) - Math.min(a.minX, b.minX) + 1;
            const unionH = Math.max(a.maxY, b.maxY) - Math.min(a.minY, b.minY) + 1;
            if (unionArea < 8000 || Math.min(unionW, unionH) < 96) continue;
            const nonAdj = byAreaDesc.find((cand) => {
              if (cand.id === a.id || cand.id === b.id) return false;
              if (screenDist(cand, a) < MIN_TAP_SEP_PX || screenDist(cand, b) < MIN_TAP_SEP_PX) return false;
              const nbA = adj.get(a.id);
              const nbB = adj.get(b.id);
              return !(nbA && nbA.has(cand.id)) && !(nbB && nbB.has(cand.id));
            });
            if (!nonAdj) continue;
            const untouched = byAreaDesc.find(
              (cand) =>
                cand.id !== a.id &&
                cand.id !== b.id &&
                cand.id !== nonAdj.id &&
                screenDist(cand, a) >= MIN_TAP_SEP_PX &&
                screenDist(cand, b) >= MIN_TAP_SEP_PX &&
                screenDist(cand, nonAdj) >= MIN_TAP_SEP_PX
            );
            if (untouched) return { a, b, nonAdjacent: nonAdj, untouched };
          }
        }
        return null;
      };

      const rm = puzzle.regionMap;
      const adj = buildAdjacency(rm, pw, ph);
      const clickable = [];
      const clickableById = new Map();
      for (const r of puzzle.regions) {
        const hit = findSafeHit(r, rm);
        if (!hit) continue;
        const info = {
          id: r.id,
          colorId: r.colorId,
          area: r.area,
          minX: r.minX,
          maxX: r.maxX,
          minY: r.minY,
          maxY: r.maxY,
          bboxW: r.maxX - r.minX + 1,
          bboxH: r.maxY - r.minY + 1,
          clientX: hit.clientX,
          clientY: hit.clientY,
        };
        clickable.push(info);
        clickableById.set(r.id, info);
      }

      const byAreaDesc = [...clickable].sort((x, y) => y.area - x.area);
      const largePair = pickLargePair(byAreaDesc, clickableById, adj);
      const hasExteriorBboxCorner = (r) => {
        const cornerIndices = [
          r.minY * pw + r.minX,
          r.minY * pw + r.maxX,
          r.maxY * pw + r.minX,
          r.maxY * pw + r.maxX,
        ];
        return cornerIndices.some((idx) => rm[idx] !== r.id);
      };
      const smallCandidates = clickable
        .filter(
          (r) =>
            r.area >= 40 &&
            r.bboxW >= 8 &&
            r.bboxH >= 8 &&
            (r.area < 8000 || Math.min(r.bboxW, r.bboxH) < 96) &&
            r.area / (r.bboxW * r.bboxH) < 0.85 &&
            hasExteriorBboxCorner(r)
        )
        .sort((x, y) => y.area - x.area);

      return {
        width: pw,
        height: ph,
        totalRegions: puzzle.regions.length,
        largePair,
        smallRegion: smallCandidates[0] || null,
      };
    },
    { targetSnapId: snapId, sessionKey: ACTIVE_SESSION_KEY }
  );
}

/**
 * Dismisses any visible FeatureOfferBanner (e.g. `undo_replay` or `infinite_zoom` Quick Tip)
 * so the top-center banner never intercepts subsequent canvas clicks.
 */
async function dismissFeatureOfferIfVisible(page) {
  const offerDismissBtn = page.getByTestId('feature-offer-dismiss-btn');
  if ((await offerDismissBtn.count()) > 0 && (await offerDismissBtn.first().isVisible())) {
    await offerDismissBtn.first().click();
    await page.getByTestId('feature-offer-banner').waitFor({ state: 'hidden', timeout: 3000 });
    await waitForAnimationFrames(page, 1);
  }
}

/**
 * Clicks a specific unfilled region's exact screen coordinate (in EASY mode, which paints
 * any tapped region directly with zero palette-swatch hint camera pan), waiting until
 * filledRegionIds includes the target region ID.
 */
async function paintTargetRegion(page, regionTarget) {
  await dismissFeatureOfferIfVisible(page);
  await page.mouse.click(regionTarget.clientX, regionTarget.clientY);
  await waitForAnimationFrames(page, 2);
  const filled = await waitForCondition(async () => {
    const sess = await readActiveSession(page);
    return Array.isArray(sess.filledRegionIds) && sess.filledRegionIds.includes(regionTarget.id);
  }, 4000);
  assert.equal(
    filled,
    true,
    `Expected region ${regionTarget.id} to be painted at (${Math.round(regionTarget.clientX)}, ${Math.round(regionTarget.clientY)})`
  );
}

/**
 * Ensures a directional border edge toggle (`extend-side-*`) matches desired boolean state.
 */
async function setExtendSideState(page, testId, desiredOn) {
  const locator = page.getByTestId(testId);
  await locator.waitFor({ state: 'visible', timeout: 3000 });
  const readActive = async () =>
    locator.evaluate((el) => {
      if (el instanceof HTMLInputElement && el.type === 'checkbox') return el.checked;
      const pressed = el.getAttribute('aria-pressed');
      if (pressed !== null) return pressed === 'true';
      const checked = el.getAttribute('aria-checked');
      if (checked !== null) return checked === 'true';
      const selected = el.getAttribute('aria-selected');
      if (selected !== null) return selected === 'true';
      const dataActive = el.getAttribute('data-active');
      if (dataActive !== null) return dataActive === 'true';
      const dataSelected = el.getAttribute('data-selected');
      if (dataSelected !== null) return dataSelected === 'true';
      const dataState = el.getAttribute('data-state');
      if (dataState !== null) {
        return (
          dataState === 'on' ||
          dataState === 'checked' ||
          dataState === 'active' ||
          dataState === 'selected'
        );
      }
      const nestedCheckbox = el.querySelector('input[type="checkbox"]');
      if (nestedCheckbox instanceof HTMLInputElement) return nestedCheckbox.checked;
      return false;
    });
  const current = await readActive();
  if (current !== desiredOn) {
    await locator.click();
    await waitForAnimationFrames(page, 1);
  }
  const finalState = await readActive();
  assert.equal(finalState, desiredOn, `Edge toggle ${testId} must be ${desiredOn ? 'ON' : 'OFF'}`);
}

/**
 * Inspects decoded IDB source image Blob alpha channels (exterior alpha === 0 vs opaque interior).
 */
async function inspectImageBlobAlpha(page, snapId) {
  return page.evaluate(async (id) => {
    const blob = await window.capyStorage.loadImageBlob(id);
    if (!blob) return null;
    const bmp = await createImageBitmap(blob);
    try {
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(bmp, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      let zeroAlphaCount = 0;
      let opaqueCount = 0;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] === 0) zeroAlphaCount += 1;
        else if (data[i] >= 250) opaqueCount += 1;
      }
      return {
        blobSize: blob.size,
        width: bmp.width,
        height: bmp.height,
        zeroAlphaCount,
        opaqueCount,
      };
    } finally {
      bmp.close();
    }
  }, snapId);
}

/**
 * Samples live `<canvas data-testid="puzzle-canvas">` pixels to inspect artwork bounding corners
 * against the default charcoal stage `rgb(24, 24, 27)` (verifying organic cutout exterior has
 * no opaque white rectangular corner paper block).
 */
async function sampleLiveCanvasCutoutCorners(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="puzzle-canvas"]');
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    const step = 4;
    const isCharcoalStage = (r, g, b) =>
      Math.abs(r - 24) <= 18 && Math.abs(g - 24) <= 18 && Math.abs(b - 27) <= 18;
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const i = (y * width + x) * 4;
        if (!isCharcoalStage(data[i], data[i + 1], data[i + 2])) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    const sampleAt = (x, y) => {
      const cx = Math.max(0, Math.min(width - 1, Math.round(x)));
      const cy = Math.max(0, Math.min(height - 1, Math.round(y)));
      const i = (cy * width + cx) * 4;
      return {
        r: data[i],
        g: data[i + 1],
        b: data[i + 2],
        a: data[i + 3],
        isStage: isCharcoalStage(data[i], data[i + 1], data[i + 2]),
        isWhitePaper: data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240,
      };
    };
    const corners =
      maxX > minX + 8 && maxY > minY + 8
        ? [
            sampleAt(minX + 2, minY + 2),
            sampleAt(maxX - 2, minY + 2),
            sampleAt(minX + 2, maxY - 2),
            sampleAt(maxX - 2, maxY - 2),
          ]
        : [];
    return { width, height, minX, minY, maxX, maxY, corners };
  });
}

// =========================================================================
// STAGE 1: Manual Popover, Guide Prompt + Chips, 4-Connected Selection,
//          Painted Warning, Switch Selection, Seamless In-Place Subdivision,
//          Viewport Preservation, Sample-to-Blob Promotion & 1-Tap Undo
// =========================================================================
async function runStage1InPlaceSubdivision({ browser, BASE_URL, attachErrorListeners, logE2eStart, logE2ePass }) {
    logE2eStart(
      'Stage 1: Manual Infinite Zoom popover, 4-connected selection, inline prompt, seamless in-place split, camera preservation, sample-to-blob promotion, Undo/Redo scrub & 1-tap Undo Subdivision'
    );
    const { context, page } = await createBootedContext(browser, BASE_URL, {
      label: 'infinite-zoom-stage1',
      attachErrorListeners,
      viewport: { width: 1280, height: 860 },
      skipTutorial: true,
      easyNoReplay: true,
      extraSettings: { showZoomButtons: true, showResetViewButton: true },
    });
    try {
      const initialSession = await readActiveSession(page);
      const initialSnapId = initialSession.activeSnapshotId;
      assert.ok(initialSnapId, 'Initial puzzle must have an activeSnapshotId');

      const initialRemaining = await readTotalRemainingRegions(page);
      assert.ok(initialRemaining > 0, 'Initial puzzle must have remaining unpainted regions');

      // Zoom in once so camera is non-default and reset-view-btn is visible
      await page.getByTestId('zoom-in-btn').click();
      await page.getByTestId('reset-view-btn').waitFor({ state: 'visible', timeout: 4000 });
      await page.waitForFunction(
        (key) => {
          const s = JSON.parse(localStorage.getItem(key) || '{}');
          return typeof s.zoomScale === 'number' && s.zoomScale > 1.05;
        },
        ACTIVE_SESSION_KEY,
        { timeout: 4000 }
      );

      const targets = await findRegionClickTargets(page, initialSnapId);
      assert.ok(targets && targets.largePair, 'Expected deterministic 4-connected large region pair in zoomed viewport');
      const { a, b, nonAdjacent, untouched } = targets.largePair;
      const preRegionCount = targets.totalRegions;
      const preRegionIds = await page.evaluate(async (id) => {
        const p = await window.capyStorage.loadPuzzleData(id);
        return p ? p.regions.map((r) => r.id) : [];
      }, initialSnapId);
      const preMaxRegionId = Math.max(...preRegionIds);

      // Paint untouched, a, and b, then undo b once so redoStack holds [b] (while undoStack holds [untouched, a])
      await paintTargetRegion(page, untouched);
      await paintTargetRegion(page, a);
      await paintTargetRegion(page, b);

      await page.getByTestId('undo-btn').click();
      await page.getByTestId('redo-btn').waitFor({ state: 'visible', timeout: 3000 });
      const bUndone = await waitForCondition(async () => {
        const s = await readActiveSession(page);
        const ids = Array.isArray(s.filledRegionIds) ? s.filledRegionIds : [];
        return ids.includes(untouched.id) && ids.includes(a.id) && !ids.includes(b.id);
      }, 4000);
      assert.equal(bUndone, true, `Expected pre-subdivide undo to unfill region ${b.id} while keeping ${untouched.id} & ${a.id}`);
      await waitForAnimationFrames(page, 2);

      // Dismiss undo_replay FeatureOfferBanner if triggered on first undo so it never intercepts canvas clicks
      await dismissFeatureOfferIfVisible(page);
      assert.equal(
        await page.getByTestId('redo-btn').count(),
        1,
        'Precondition: redo-btn must be visible before in-place subdivision so redoStack scrubbing can be verified'
      );

      const preSession = await readActiveSession(page);
      const cameraBefore = {
        zoomScale: preSession.zoomScale,
        panOffsetX: preSession.panOffsetX,
        panOffsetY: preSession.panOffsetY,
      };

      // Open manual toolbar popover and enter Infill Detail selection mode
      await page.getByTestId('infinite-zoom-menu-btn').click();
      await page.getByTestId('toolbar-infinite-zoom-in-btn').waitFor({ state: 'visible', timeout: 3000 });
      await page.getByTestId('toolbar-infinite-zoom-out-btn').waitFor({ state: 'visible', timeout: 3000 });
      await page.getByTestId('toolbar-infinite-zoom-in-btn').click();

      const selBar = page.getByTestId('region-selection-bar');
      await selBar.waitFor({ state: 'visible', timeout: 3000 });

      // Select painted region `a` + 4-connected touching neighbor `b`
      await page.mouse.click(a.clientX, a.clientY);
      await waitForAnimationFrames(page, 2);
      await page.mouse.click(b.clientX, b.clientY);
      await waitForAnimationFrames(page, 2);

      // Verify painted-region reopen warning & In-Place mode badge
      const selBarText = await selBar.innerText();
      assert.match(
        selBarText,
        /paint|color|reopen|filled/i,
        `Selection bar must warn when painted regions are included, got: "${selBarText}"`
      );
      const modeBadgeText = await page.getByTestId('region-selection-mode-badge').innerText();
      assert.match(
        modeBadgeText,
        /in-place|in place|split/i,
        `Large contiguous selection must show In-Place mode badge, got: "${modeBadgeText}"`
      );

      // Tap non-adjacent region -> must reveal 1-tap Switch Selection button (zero double-tap collision)
      await page.mouse.click(nonAdjacent.clientX, nonAdjacent.clientY);
      const switchBtn = page.getByTestId('region-selection-switch-btn');
      await switchBtn.waitFor({ state: 'visible', timeout: 3000 });
      await switchBtn.click();
      await switchBtn.waitFor({ state: 'hidden', timeout: 3000 });

      // Clear selection and re-select contiguous pair (a + b)
      await page.getByTestId('region-selection-clear-btn').click();
      await waitForAnimationFrames(page, 2);
      await page.mouse.click(a.clientX, a.clientY);
      await waitForAnimationFrames(page, 2);
      await page.mouse.click(b.clientX, b.clientY);
      await waitForAnimationFrames(page, 2);

      // Inline Guide Prompt + 1-tap suggestion chip
      const promptInput = page.getByTestId('infinite-zoom-in-prompt-input');
      await promptInput.waitFor({ state: 'visible', timeout: 3000 });
      const chipButtons = selBar
        .locator('button:not([data-testid^="region-selection-"])')
        .filter({ hasText: /[A-Za-z]{3,}/ })
        .filter({
          hasNotText:
            /^(clear(\s+prompt|\s+selection)?|close|cancel|subdivide|switch(\s+selection)?|dismiss|undo|back)$/i,
        });
      assert.ok((await chipButtons.count()) >= 1, 'Expected at least one 1-tap prompt suggestion chip in selection bar');
      await chipButtons.first().click();
      const chipPromptVal = await promptInput.inputValue();
      assert.ok(chipPromptVal.trim().length > 0, 'Clicking 1-tap suggestion chip must populate prompt input');
      await promptInput.fill(`${chipPromptVal.trim()}, mossy pebbles`);

      // Confirm seamless In-Place Subdivision
      await page.getByTestId('region-selection-confirm-btn').click();
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 25000 });
      await page.getByTestId('undo-subdivision-btn').waitFor({ state: 'visible', timeout: 5000 });
      await selBar.waitFor({ state: 'hidden', timeout: 5000 });
      await waitForPuzzleLoaded(page);

      // Verify zero viewport camera jolt
      await page.getByTestId('reset-view-btn').waitFor({ state: 'visible', timeout: 3000 });
      const postSession = await readActiveSession(page);
      assert.equal(postSession.activeSnapshotId, initialSnapId, 'In-place subdivision must keep activeSnapshotId');
      assert.ok(
        Math.abs(postSession.zoomScale - cameraBefore.zoomScale) < 0.05 &&
          Math.abs(postSession.panOffsetX - cameraBefore.panOffsetX) < 5 &&
          Math.abs(postSession.panOffsetY - cameraBefore.panOffsetY) < 5,
        `In-place subdivision must preserve viewport camera (before=${JSON.stringify(cameraBefore)}, after=${JSON.stringify({
          zoomScale: postSession.zoomScale,
          panOffsetX: postSession.panOffsetX,
          panOffsetY: postSession.panOffsetY,
        })})`
      );

      // Verify untouched painted region preserved & replaced painted region `a` reopened
      const postFilled = Array.isArray(postSession.filledRegionIds) ? postSession.filledRegionIds : [];
      assert.equal(
        postFilled.includes(untouched.id),
        true,
        `Untouched painted region ${untouched.id} must remain filled after in-place split`
      );
      assert.equal(
        postFilled.includes(a.id),
        false,
        `Replaced painted region ${a.id} must be reopened/scrubbed after in-place split`
      );
      assert.equal(
        postFilled.includes(b.id),
        false,
        `Replaced region ${b.id} must remain unfilled after in-place split`
      );
      // Verify redoStack scrubbing immediately (without touching undo-btn before 1-tap undo-subdivision-btn)
      assert.equal(
        await page.getByTestId('redo-btn').count(),
        0,
        `In-place subdivision of {${a.id}, ${b.id}} must scrub replaced region ${b.id} from redoStack so redo-btn hides`
      );

      // Verify puzzle data updated in IDB with replaced IDs gone and new regions added
      const postPuzzleMeta = await page.evaluate(async (id) => {
        const p = await window.capyStorage.loadPuzzleData(id);
        return p ? { count: p.regions.length, ids: p.regions.map((r) => r.id) } : null;
      }, initialSnapId);
      assert.ok(postPuzzleMeta, 'Updated PuzzleData must be persisted in IndexedDB');
      assert.equal(postPuzzleMeta.ids.includes(a.id), false, 'Replaced region a.id must be removed from PuzzleData');
      assert.equal(postPuzzleMeta.ids.includes(b.id), false, 'Replaced region b.id must be removed from PuzzleData');
      const newlyAddedIds = postPuzzleMeta.ids.filter((id) => id > preMaxRegionId);
      assert.ok(
        newlyAddedIds.length >= 2 && postPuzzleMeta.count >= preRegionCount,
        `In-place subdivision must insert >= 2 sparse monotonic sub-region IDs > ${preMaxRegionId} (added=${newlyAddedIds.length}, before=${preRegionCount}, after=${postPuzzleMeta.count})`
      );

      // Verify built-in sample promoted to sourceRef.kind === 'blob', sampleAssetPath cleared, IDB Blob persisted
      const postSnaps = await readSnapshots(page);
      const promotedSnap = postSnaps.find((s) => s.id === initialSnapId);
      assert.ok(promotedSnap, 'Promoted snapshot metadata must exist');
      assert.equal(
        promotedSnap.sourceRef?.kind,
        'blob',
        `Built-in sample must promote to sourceRef.kind === "blob" after in-place split, got ${JSON.stringify(promotedSnap.sourceRef)}`
      );
      assert.equal(
        promotedSnap.sampleAssetPath ?? null,
        null,
        `Promoted sample must clear sampleAssetPath, got ${promotedSnap.sampleAssetPath}`
      );
      const promotedBlobSize = await page.evaluate(async (id) => {
        const blob = await window.capyStorage.loadImageBlob(id);
        return blob ? blob.size : 0;
      }, initialSnapId);
      assert.ok(promotedBlobSize > 0, 'Promoted sample must persist updated source image Blob in IndexedDB');

      // Replacing painted region `a` must bump resetEpoch cleanly
      assert.ok(
        (promotedSnap.resetEpoch ?? 0) >= 1 || (postSession.resetEpoch ?? 0) >= 1,
        'Replacing a painted region during in-place split must increment resetEpoch'
      );

      // Click 1-tap Undo Subdivision toast and verify exact pre-subdivide restoration
      await page.getByTestId('undo-subdivision-btn').click();
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'hidden', timeout: 10000 });
      await waitForAnimationFrames(page, 2);

      const revertedOk = await waitForCondition(async () => {
        const s = await readActiveSession(page);
        const pCount = await page.evaluate(async (id) => {
          const p = await window.capyStorage.loadPuzzleData(id);
          return p ? p.regions.length : -1;
        }, initialSnapId);
        return (
          pCount === preRegionCount &&
          Array.isArray(s.filledRegionIds) &&
          s.filledRegionIds.includes(a.id) &&
          s.filledRegionIds.includes(untouched.id) &&
          !s.filledRegionIds.includes(b.id)
        );
      }, 6000);
      assert.equal(
        revertedOk,
        true,
        '1-tap Undo Subdivision must restore pre-subdivide region count and previously filled regions'
      );
      await waitForAnimationFrames(page, 2);

      // Verify undoStack selective scrubbing: paint nonAdjacent then b -> undoStack ends with [..., nonAdjacent, b]
      await paintTargetRegion(page, nonAdjacent);
      await paintTargetRegion(page, b);

      // Clean second in-place subdivision on {a, b} (keeps nonAdjacent & untouched; scrubs replaced a & b from undoStack)
      await page.getByTestId('infinite-zoom-menu-btn').click();
      await page.getByTestId('toolbar-infinite-zoom-in-btn').waitFor({ state: 'visible', timeout: 3000 });
      await page.getByTestId('toolbar-infinite-zoom-in-btn').click();
      await selBar.waitFor({ state: 'visible', timeout: 3000 });
      await page.mouse.click(a.clientX, a.clientY);
      await waitForAnimationFrames(page, 2);
      await page.mouse.click(b.clientX, b.clientY);
      await waitForAnimationFrames(page, 2);
      await page.getByTestId('region-selection-confirm-btn').click();
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 25000 });
      await selBar.waitFor({ state: 'hidden', timeout: 5000 });
      await waitForPuzzleLoaded(page);

      const postSplit2Session = await readActiveSession(page);
      const postSplit2Filled = Array.isArray(postSplit2Session.filledRegionIds) ? postSplit2Session.filledRegionIds : [];
      assert.equal(postSplit2Filled.includes(nonAdjacent.id), true, `Surviving region ${nonAdjacent.id} must stay filled after second split`);
      assert.equal(postSplit2Filled.includes(untouched.id), true, `Surviving region ${untouched.id} must stay filled after second split`);
      assert.equal(postSplit2Filled.includes(a.id), false, `Replaced region ${a.id} must be absent after second split`);
      assert.equal(postSplit2Filled.includes(b.id), false, `Replaced region ${b.id} must be absent after second split`);

      // Clicking undo-btn ONCE must immediately unfill surviving nonAdjacent (proving replaced b & a were scrubbed from undoStack)
      await page.getByTestId('undo-btn').click();
      await page.getByTestId('redo-btn').waitFor({ state: 'visible', timeout: 3000 });
      const undidSurviving = await waitForCondition(async () => {
        const s = await readActiveSession(page);
        const ids = Array.isArray(s.filledRegionIds) ? s.filledRegionIds : [];
        return (
          !ids.includes(nonAdjacent.id) &&
          ids.includes(untouched.id) &&
          !ids.includes(a.id) &&
          !ids.includes(b.id)
        );
      }, 4000);
      assert.equal(
        undidSurviving,
        true,
        `First undo-btn click after in-place split must immediately unfill surviving region ${nonAdjacent.id} (proving replaced regions ${a.id}/${b.id} were scrubbed from undoStack without wiping surviving history)`
      );

      // Clicking redo-btn ONCE must re-fill surviving nonAdjacent cleanly without resurrecting replaced a or b
      await page.getByTestId('redo-btn').click();
      await page.getByTestId('redo-btn').waitFor({ state: 'hidden', timeout: 3000 });
      const redidSurviving = await waitForCondition(async () => {
        const s = await readActiveSession(page);
        const ids = Array.isArray(s.filledRegionIds) ? s.filledRegionIds : [];
        return (
          ids.includes(nonAdjacent.id) &&
          ids.includes(untouched.id) &&
          !ids.includes(a.id) &&
          !ids.includes(b.id)
        );
      }, 4000);
      assert.equal(
        redidSurviving,
        true,
        `redo-btn click after undo must re-fill surviving region ${nonAdjacent.id} without resurrecting replaced regions ${a.id}/${b.id}`
      );

      // Verify Cancel exits Region Selection Bar cleanly
      await page.getByTestId('infinite-zoom-menu-btn').click();
      await page.getByTestId('toolbar-infinite-zoom-in-btn').click();
      await selBar.waitFor({ state: 'visible', timeout: 3000 });
      await page.getByTestId('region-selection-cancel-btn').click();
      await selBar.waitFor({ state: 'hidden', timeout: 3000 });

      logE2ePass('Stage 1 passed');
    } finally {
      await context.close();
    }
}

// =========================================================================
// STAGE 2: Small-Region Deep Child Promotion, Transparent rId <= 0 Cutout
//          (IDB PuzzleData + IDB Blob Alpha + Live Canvas Charcoal Corners),
//          Bidirectional Outer/Inner Breadcrumbs & Orphan Pruning
// =========================================================================
async function runStage2DeepChildCutout({ browser, BASE_URL, attachErrorListeners, logE2eStart, logE2ePass }) {
    logE2eStart(
      'Stage 2: Deep Child Tile promotion, transparent rId <= 0 organic cutout verification, Outer/Inner breadcrumbs & orphan pruning'
    );
    const { context, page } = await createBootedContext(browser, BASE_URL, {
      label: 'infinite-zoom-stage2',
      attachErrorListeners,
      viewport: { width: 1280, height: 860 },
      skipTutorial: true,
      easyNoReplay: true,
    });
    try {
      const parentSnapId = (await readActiveSession(page)).activeSnapshotId;
      assert.ok(parentSnapId, 'Expected active parentSnapshotId');

      const targets = await findRegionClickTargets(page, parentSnapId);
      assert.ok(targets && targets.smallRegion, 'Expected a small region (< 8000 px or minDim < 96) for Deep Child Tile');
      const smallReg = targets.smallRegion;

      await page.getByTestId('infinite-zoom-menu-btn').click();
      await page.getByTestId('toolbar-infinite-zoom-in-btn').click();
      await page.getByTestId('region-selection-bar').waitFor({ state: 'visible', timeout: 3000 });

      await page.mouse.click(smallReg.clientX, smallReg.clientY);
      await waitForAnimationFrames(page, 2);

      const badgeText = await page.getByTestId('region-selection-mode-badge').innerText();
      assert.match(
        badgeText,
        /child|deep|tile/i,
        `Small region selection must switch badge to Deep Child Tile, got: "${badgeText}"`
      );

      await page.getByTestId('region-selection-confirm-btn').click();
      await page.waitForFunction(
        ({ key, prevId }) => {
          const s = JSON.parse(localStorage.getItem(key) || '{}');
          return Boolean(s.activeSnapshotId && s.activeSnapshotId !== prevId);
        },
        { key: ACTIVE_SESSION_KEY, prevId: parentSnapId },
        { timeout: 25000 }
      );
      await waitForPuzzleLoaded(page);

      const childSnapId = (await readActiveSession(page)).activeSnapshotId;
      assert.ok(childSnapId && childSnapId !== parentSnapId, 'Deep Child Tile must create a distinct child snapshot');

      const snaps = await readSnapshots(page);
      const childMeta = snaps.find((s) => s.id === childSnapId);
      const parentMeta = snaps.find((s) => s.id === parentSnapId);
      assert.ok(childMeta, `Child snapshot ${childSnapId} must be persisted in snapshots`);
      assert.ok(parentMeta, `Parent snapshot ${parentSnapId} must be persisted in snapshots`);
      assert.equal(childMeta.parentSnapshotId, parentSnapId, 'Child snapshot must link parentSnapshotId');
      assert.equal(childMeta.zoomTree?.direction, 'child-in', 'Child zoomTree.direction must be "child-in"');
      assert.equal(
        Boolean(parentMeta.zoomTree?.childSnapshotIds?.includes(childSnapId)),
        true,
        'Parent zoomTree.childSnapshotIds must reference linked childSnapId'
      );

      // (a) Verify IDB PuzzleData has exterior transparent rId <= 0 pixels
      const idbCutoutStats = await page.evaluate(async (id) => {
        const p = await window.capyStorage.loadPuzzleData(id);
        if (!p || !p.regionMap) return null;
        let transparentPixels = 0;
        let interiorPixels = 0;
        for (let i = 0; i < p.regionMap.length; i++) {
          if (p.regionMap[i] <= 0) transparentPixels += 1;
          else interiorPixels += 1;
        }
        return { transparentPixels, interiorPixels, regionCount: p.regions.length };
      }, childSnapId);
      assert.ok(idbCutoutStats, 'Child PuzzleData must exist in IndexedDB');
      assert.ok(
        idbCutoutStats.transparentPixels > 0 && idbCutoutStats.interiorPixels > 0,
        `Child PuzzleData must contain transparent rId<=0 exterior and positive interior regions (${JSON.stringify(idbCutoutStats)})`
      );

      // (b) Verify IDB source image Blob decoded offscreen has alpha === 0 exterior pixels
      const blobAlpha = await inspectImageBlobAlpha(page, childSnapId);
      assert.ok(blobAlpha && blobAlpha.blobSize > 0, 'Child cutout source image Blob must exist in IDB');
      assert.ok(
        blobAlpha.zeroAlphaCount > 0 && blobAlpha.opaqueCount > 0,
        `Child cutout image Blob must contain alpha===0 exterior and opaque interior pixels (${JSON.stringify(blobAlpha)})`
      );

      // (c) Verify live canvas bounding corners show charcoal stage rgb(24,24,27) instead of opaque white paper
      const canvasCutout = await sampleLiveCanvasCutoutCorners(page);
      assert.ok(canvasCutout && canvasCutout.corners.length === 4, 'Live canvas must render child cutout');
      const hasCharcoalCorner = canvasCutout.corners.some((c) => c.isStage && !c.isWhitePaper);
      assert.equal(
        hasCharcoalCorner,
        true,
        `Organic child cutout corners on live canvas must show stage charcoal rgb(24,24,27), not white paper (${JSON.stringify(canvasCutout.corners)})`
      );

      // Bidirectional Outer (parent) / Inner (child) breadcrumb navigation
      const parentBtn = page.getByTestId('topbar-parent-puzzle-btn');
      const childBtn = page.getByTestId('topbar-child-puzzle-btn');
      await parentBtn.waitFor({ state: 'visible', timeout: 5000 });

      await parentBtn.click();
      await page.waitForFunction(
        ({ key, targetId }) => JSON.parse(localStorage.getItem(key) || '{}').activeSnapshotId === targetId,
        { key: ACTIVE_SESSION_KEY, targetId: parentSnapId },
        { timeout: 15000 }
      );
      await waitForPuzzleLoaded(page);
      assert.equal(await parentBtn.count(), 0, 'Parent root puzzle must hide topbar-parent-puzzle-btn');
      await childBtn.waitFor({ state: 'visible', timeout: 5000 });

      await childBtn.click();
      await page.waitForFunction(
        ({ key, targetId }) => JSON.parse(localStorage.getItem(key) || '{}').activeSnapshotId === targetId,
        { key: ACTIVE_SESSION_KEY, targetId: childSnapId },
        { timeout: 15000 }
      );
      await waitForPuzzleLoaded(page);
      await parentBtn.waitFor({ state: 'visible', timeout: 5000 });

      // Delete parent snapshot via Saves tab and verify dead breadcrumb immediately prunes
      await page.getByTestId('topbar-saves-btn').click();
      await page.getByTestId(`save-card-${parentSnapId}`).waitFor({ state: 'visible', timeout: 3000 });
      await page.getByTestId(`save-card-${parentSnapId}`).click();
      await page.getByTestId('save-action-delete').click();
      await page.getByTestId('save-action-confirm-delete').click();
      await page.getByTestId(`save-card-${parentSnapId}`).waitFor({ state: 'hidden', timeout: 3000 });
      await page.keyboard.press('Escape');
      await page.getByTestId('settings-modal-close').waitFor({ state: 'hidden', timeout: 3000 });

      assert.equal(
        await parentBtn.count(),
        0,
        'Deleting parent snapshot must immediately hide topbar-parent-puzzle-btn'
      );
      const prunedSnaps = await readSnapshots(page);
      assert.equal(
        prunedSnaps.some((s) => s.id === parentSnapId),
        false,
        `Deleted parent snapshot ${parentSnapId} must be removed from persisted snapshots`
      );
      const prunedChild = prunedSnaps.find((s) => s.id === childSnapId);
      assert.ok(
        prunedChild,
        `Child snapshot ${childSnapId} must remain persisted after deleting parent snapshot ${parentSnapId}`
      );
      assert.equal(
        prunedChild.parentSnapshotId,
        undefined,
        'Deleting parent snapshot must prune child.parentSnapshotId to undefined'
      );

      logE2ePass('Stage 2 passed');
    } finally {
      await context.close();
    }
}

// =========================================================================
// STAGE 3: Directional Border Extension (Top + Right), Fresh 0% Outer Puzzle
//          Keeping Inner Progress Intact, 2.5:1 Aspect Guard, and
//          Tier 1 Mock LanguageModel + loading-cancel-btn AbortController
// =========================================================================
async function runStage3BorderExtensionPart({ browser, BASE_URL, attachErrorListeners }) {
    // Part A: Directional Border Extension + 2.5:1 aspect guard
    const { context, page } = await createBootedContext(browser, BASE_URL, {
      label: 'infinite-zoom-stage3-extend',
      attachErrorListeners,
      viewport: { width: 1280, height: 860 },
      skipTutorial: true,
      easyNoReplay: true,
    });
    try {
      const innerSnapId = (await readActiveSession(page)).activeSnapshotId;
      assert.ok(innerSnapId);

      // Paint regions on the inner puzzle so we verify inner progress stays intact
      await tapCanvasGrid(page, 0.35, 8, 50);
      await page.waitForFunction(
        () => Number(document.querySelector('[data-testid="topbar-saves-btn"]')?.getAttribute('data-filled-count') || 0) >= 1,
        undefined,
        { timeout: 5000 }
      );
      const innerFilledBefore = Number(
        await page.getByTestId('topbar-saves-btn').getAttribute('data-filled-count')
      );
      assert.ok(innerFilledBefore >= 1, 'Inner puzzle must have painted progress before border extension');

      const innerDims = await page.evaluate(async (id) => {
        const p = await window.capyStorage.loadPuzzleData(id);
        return p ? { width: p.width, height: p.height } : null;
      }, innerSnapId);
      assert.ok(innerDims, 'Inner puzzle dimensions must be readable from IDB');

      // Open Extend Borders popover, select Top + Right ONLY (Bottom & Left OFF)
      await page.getByTestId('infinite-zoom-menu-btn').click();
      await page.getByTestId('toolbar-infinite-zoom-out-btn').waitFor({ state: 'visible', timeout: 3000 });
      await page.getByTestId('toolbar-infinite-zoom-out-btn').click();

      await setExtendSideState(page, 'extend-side-top', true);
      await setExtendSideState(page, 'extend-side-right', true);
      await setExtendSideState(page, 'extend-side-bottom', false);
      await setExtendSideState(page, 'extend-side-left', false);

      // Inline Guide Prompt + 1-tap chip scoped strictly to Extend Borders popover
      const outPromptInput = page.getByTestId('infinite-zoom-out-prompt-input');
      await outPromptInput.waitFor({ state: 'visible', timeout: 3000 });
      const extendPopover = outPromptInput.locator(
        'xpath=ancestor::*[.//*[@data-testid="extend-side-top"] and .//*[@data-testid="toolbar-infinite-zoom-out-confirm-btn"]][1]'
      );
      const outChips = extendPopover
        .locator(
          'button:not([data-testid^="extend-side-"]):not([data-testid^="toolbar-infinite-zoom-"]):not([data-testid="infinite-zoom-menu-btn"])'
        )
        .filter({
          hasText: /[A-Za-z]{3,}/,
          hasNotText:
            /^\s*(?:[←<×✕]\s*)?(back|close|cancel|clear(?:\s+prompt)?|reset|extend(?:\s+borders)?|confirm|apply|done|all|none|top|bottom|left|right|infill\s+detail)\s*$/i,
        });
      const outChipCount = await outChips.count();
      assert.ok(
        outChipCount >= 1,
        'Expected at least one 1-tap prompt suggestion chip inside Extend Borders popover'
      );
      const outChip = outChips.first();
      await outChip.waitFor({ state: 'visible', timeout: 3000 });
      await outChip.click();
      assert.ok(
        (await outPromptInput.inputValue()).trim().length > 0,
        'Clicking Extend Borders 1-tap prompt chip must populate prompt input'
      );
      await outPromptInput.fill('starry hills & calm meadow');

      await page.getByTestId('toolbar-infinite-zoom-out-confirm-btn').click();
      await page.waitForFunction(
        ({ key, prevId }) => {
          const s = JSON.parse(localStorage.getItem(key) || '{}');
          return Boolean(s.activeSnapshotId && s.activeSnapshotId !== prevId);
        },
        { key: ACTIVE_SESSION_KEY, prevId: innerSnapId },
        { timeout: 25000 }
      );
      await waitForPuzzleLoaded(page);

      const outerSnapId = (await readActiveSession(page)).activeSnapshotId;
      assert.ok(outerSnapId && outerSnapId !== innerSnapId, 'Extend Borders must create a new linked outer puzzle');

      const snaps = await readSnapshots(page);
      const outerMeta = snaps.find((s) => s.id === outerSnapId);
      assert.equal(outerMeta?.filledCount, 0, 'Extended outer puzzle must start fresh at 0% (filledCount === 0)');
      assert.equal(outerMeta?.zoomTree?.direction, 'extend-out', 'Outer puzzle zoomTree.direction must be "extend-out"');
      assert.deepEqual(
        outerMeta?.zoomTree?.extendedSides,
        { top: true, bottom: false, left: false, right: true },
        'Outer puzzle zoomTree.extendedSides must record exact selected sides'
      );

      const outerDims = await page.evaluate(async (id) => {
        const p = await window.capyStorage.loadPuzzleData(id);
        return p ? { width: p.width, height: p.height } : null;
      }, outerSnapId);
      assert.ok(outerDims, 'Extended outer PuzzleData must exist in IndexedDB');
      const expectedOuterW = Math.round(innerDims.width * 1.35);
      const expectedOuterH = Math.round(innerDims.height * 1.35);
      const expectedAspect = expectedOuterW / expectedOuterH;
      const actualOuterAspect = outerDims.width / outerDims.height;
      assert.ok(
        outerDims.width > 0 &&
          outerDims.height > 0 &&
          Math.abs(actualOuterAspect - expectedAspect) < 0.04,
        `Extended outer puzzle must preserve expanded aspect ratio (inner=${JSON.stringify(innerDims)}, outer=${JSON.stringify(outerDims)}, expectedAspect=${expectedAspect.toFixed(3)})`
      );
      let outerBlobDims = null;
      const outerBlobSaved = await waitForCondition(async () => {
        outerBlobDims = await page.evaluate(async (id) => {
          const blob = await window.capyStorage.loadImageBlob(id);
          if (!blob) return null;
          const bmp = await createImageBitmap(blob);
          const dims = { width: bmp.width, height: bmp.height };
          bmp.close();
          return dims;
        }, outerSnapId);
        return Boolean(outerBlobDims);
      }, 6000);
      assert.equal(outerBlobSaved, true, 'Extended outer source image Blob must be persisted in IndexedDB');
      assert.ok(
        outerBlobDims.width > innerDims.width &&
          outerBlobDims.height > innerDims.height &&
          Math.abs(outerBlobDims.width - expectedOuterW) <= 4 &&
          Math.abs(outerBlobDims.height - expectedOuterH) <= 4,
        `Extended outer source Blob must expand Top+Right by 0.35x (inner=${JSON.stringify(innerDims)}, expected=${expectedOuterW}x${expectedOuterH}, actualBlob=${JSON.stringify(outerBlobDims)})`
      );
      const innerAfterExt = snaps.find((s) => s.id === innerSnapId);
      const extBounds = innerAfterExt?.zoomTree?.boundsInParent ?? outerMeta?.zoomTree?.boundsInParent;
      assert.ok(
        extBounds &&
          extBounds.x >= 0 &&
          extBounds.x <= 0.01 &&
          extBounds.y > 0.05 &&
          extBounds.y < 1 &&
          extBounds.width > 0 &&
          extBounds.width < 0.95 &&
          extBounds.height > 0 &&
          extBounds.height < 0.95,
        `Top+Right border extension must persist exact normalized boundsInParent with x<=0.01, y>0.05, width<0.95, height<0.95 (got ${JSON.stringify(extBounds)})`
      );

      // Verify navigating Inner restores exact prior painted progress, and Outer returns to outer puzzle
      const innerBreadcrumb = page.getByTestId('topbar-child-puzzle-btn');
      await innerBreadcrumb.waitFor({ state: 'visible', timeout: 5000 });
      await innerBreadcrumb.click();
      await page.waitForFunction(
        ({ key, targetId }) => JSON.parse(localStorage.getItem(key) || '{}').activeSnapshotId === targetId,
        { key: ACTIVE_SESSION_KEY, targetId: innerSnapId },
        { timeout: 15000 }
      );
      await waitForPuzzleLoaded(page);
      const restoredInnerFilled = Number(
        await page.getByTestId('topbar-saves-btn').getAttribute('data-filled-count')
      );
      assert.equal(
        restoredInnerFilled,
        innerFilledBefore,
        'Inner puzzle must preserve exact prior painted progress after border extension'
      );

      const outerBreadcrumb = page.getByTestId('topbar-parent-puzzle-btn');
      await outerBreadcrumb.waitFor({ state: 'visible', timeout: 5000 });
      await outerBreadcrumb.click();
      await page.waitForFunction(
        ({ key, targetId }) => JSON.parse(localStorage.getItem(key) || '{}').activeSnapshotId === targetId,
        { key: ACTIVE_SESSION_KEY, targetId: outerSnapId },
        { timeout: 15000 }
      );
      await waitForPuzzleLoaded(page);

      // Repeated single-axis stretching (Left + Right only) must hit 2.5:1 aspect guard
      await verifyHorizontalAspectGuard(page);
    } finally {
      await context.close();
    }
}

async function verifyHorizontalAspectGuard(page) {
  let aspectGuardTriggered = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.getByTestId('infinite-zoom-menu-btn').click();
    await page.getByTestId('toolbar-infinite-zoom-out-btn').click();
    await setExtendSideState(page, 'extend-side-top', false);
    await setExtendSideState(page, 'extend-side-bottom', false);
    await setExtendSideState(page, 'extend-side-left', true);
    await setExtendSideState(page, 'extend-side-right', true);

    const confirmBtn = page.getByTestId('toolbar-infinite-zoom-out-confirm-btn');
    if (await confirmBtn.isDisabled()) {
      aspectGuardTriggered = true;
      break;
    }
    const prevId = (await readActiveSession(page)).activeSnapshotId;
    await confirmBtn.click();
    await page.waitForFunction(
      ({ key, beforeId }) => {
        const s = JSON.parse(localStorage.getItem(key) || '{}');
        return Boolean(s.activeSnapshotId && s.activeSnapshotId !== beforeId);
      },
      { key: ACTIVE_SESSION_KEY, beforeId: prevId },
      { timeout: 25000 }
    );
    await waitForPuzzleLoaded(page);
  }
  assert.equal(
    aspectGuardTriggered,
    true,
    'Repeated horizontal-only border extensions MUST trigger the 2.5:1 aspect guard and disable confirm'
  );
}

async function runStage3Tier1CancelPart({ browser, BASE_URL, attachErrorListeners }) {
    // Part B: Dedicated Tier 1 Mock window.LanguageModel + loading-cancel-btn AbortController cancellation
    const { context: tier1Ctx, page: tier1Page } = await createBootedContext(browser, BASE_URL, {
      label: 'infinite-zoom-stage3-tier1-cancel',
      attachErrorListeners,
      viewport: { width: 1280, height: 860 },
      skipTutorial: true,
      easyNoReplay: true,
      bootUrl: false,
      waitForPuzzle: false,
    });
    try {
      await tier1Page.addInitScript(() => {
        window.__capyTier1Mock = { createCalls: 0, promptStarted: false, aborted: false, destroyCalls: 0 };
        window.LanguageModel = {
          async availability() {
            return 'available';
          },
          async create() {
            window.__capyTier1Mock.createCalls += 1;
            return {
              prompt(_input, opts) {
                window.__capyTier1Mock.promptStarted = true;
                return new Promise((_resolve, reject) => {
                  const onAbort = () => {
                    window.__capyTier1Mock.aborted = true;
                    const err = new DOMException('Aborted by user', 'AbortError');
                    reject(err);
                  };
                  if (opts?.signal?.aborted) {
                    onAbort();
                    return;
                  }
                  opts?.signal?.addEventListener?.('abort', onAbort, { once: true });
                });
              },
              destroy() {
                window.__capyTier1Mock.destroyCalls += 1;
              },
            };
          },
        };
      });
      await tier1Page.goto(`${BASE_URL}/?skipTutorial=1`, { waitUntil: 'domcontentloaded' });
      await waitForPuzzleLoaded(tier1Page);

      const snapBeforeCancel = (await readActiveSession(tier1Page)).activeSnapshotId;
      await tier1Page.getByTestId('infinite-zoom-menu-btn').click();
      await tier1Page.getByTestId('toolbar-infinite-zoom-out-btn').waitFor({ state: 'visible', timeout: 3000 });
      await tier1Page.getByTestId('toolbar-infinite-zoom-out-btn').click();
      await setExtendSideState(tier1Page, 'extend-side-top', true);
      await tier1Page.getByTestId('toolbar-infinite-zoom-out-confirm-btn').waitFor({ state: 'visible', timeout: 3000 });
      await tier1Page.getByTestId('toolbar-infinite-zoom-out-confirm-btn').click();

      // Wait for Tier 1 prompt invocation AND loading-cancel-btn visibility
      const cancelBtn = tier1Page.getByTestId('loading-cancel-btn');
      await cancelBtn.waitFor({ state: 'visible', timeout: 8000 });
      await tier1Page.waitForFunction(() => Boolean(window.__capyTier1Mock?.promptStarted), undefined, {
        timeout: 5000,
      });

      await cancelBtn.click();
      await cancelBtn.waitFor({ state: 'hidden', timeout: 5000 });
      await waitForAnimationFrames(tier1Page, 3);

      const tier1State = await tier1Page.evaluate(() => window.__capyTier1Mock);
      assert.ok(tier1State.createCalls >= 1, 'Tier 1 LanguageModel.create() must have been invoked');
      assert.equal(
        tier1State.aborted,
        true,
        'Aborting via loading-cancel-btn must trigger AbortSignal listener on Tier 1 LanguageModel.prompt()'
      );
      assert.ok(tier1State.destroyCalls >= 1, 'Aborting via loading-cancel-btn must call session.destroy()');
      assert.equal(
        (await readActiveSession(tier1Page)).activeSnapshotId,
        snapBeforeCancel,
        'Cancelling Infinite Zoom must leave active snapshot intact and uncorrupted'
      );

    } finally {
      await tier1Ctx.close();
    }
}

async function runStage3DirectionalBorderAndCancel(stageCtx) {
  stageCtx.logE2eStart(
    'Stage 3: Directional Border Extension (Top+Right), fresh 0% outer puzzle, 2.5:1 aspect guard & Tier 1 mock LanguageModel AbortController cancel'
  );
  await runStage3BorderExtensionPart(stageCtx);
  await runStage3Tier1CancelPart(stageCtx);
  stageCtx.logE2ePass('Stage 3 passed');
}

// =========================================================================
// STAGE 4: Co-op Guard, Replay Guard, CreateTab Legacy Parity &
//          local-ai-mode-select, and 360x780 + Large Text Mobile Layout
// =========================================================================
async function runStage4GuardsAndMobile({ browser, BASE_URL, attachErrorListeners, logE2eStart, logE2ePass }) {
    logE2eStart(
      'Stage 4: Offline Co-op guard, active Replay guard, CreateTab parity & local-ai-mode-select, and 360x780 + Large Text mobile layout'
    );

    // Part A: Co-op guard, Replay guard & CreateTab parity
    const { context, page } = await createBootedContext(browser, BASE_URL, {
      label: 'infinite-zoom-stage4-guards',
      attachErrorListeners,
      viewport: { width: 1280, height: 860 },
      skipTutorial: true,
      easyNoReplay: true,
      enableCoopUi: true,
    });
    try {
      // Paint at least 1 region so Replay via long-press undo-btn is enabled
      await tapCanvasGrid(page, 0.35, 8, 50);
      await page.waitForFunction(
        () => Number(document.querySelector('[data-testid="topbar-saves-btn"]')?.getAttribute('data-filled-count') || 0) >= 1,
        undefined,
        { timeout: 5000 }
      );

      const menuBtn = page.getByTestId('infinite-zoom-menu-btn');
      await menuBtn.waitFor({ state: 'visible', timeout: 3000 });
      assert.equal(await menuBtn.isEnabled(), true, 'infinite-zoom-menu-btn must be enabled outside Co-op');

      // 4a. Host offline BroadcastChannel Co-op room -> Infinite Zoom must be disabled
      await page.getByTestId('topbar-coop-btn').click();
      await page.getByTestId('host-coop-room-btn').waitFor({ state: 'visible', timeout: 3000 });
      await page.getByTestId('host-coop-room-btn').click();
      await page.getByTestId('active-coop-room-code').waitFor({ state: 'visible', timeout: 5000 });
      await page.keyboard.press('Escape');
      await page.getByTestId('topbar-active-coop-pill').waitFor({ state: 'visible', timeout: 3000 });

      const disabledInCoop = await menuBtn.evaluate(
        (el) => Boolean(el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true')
      );
      assert.equal(disabledInCoop, true, 'infinite-zoom-menu-btn MUST be disabled while in an active Co-op room');

      // Leave Co-op room -> Infinite Zoom must re-enable
      await page.getByTestId('topbar-coop-btn').click();
      await page.getByTestId('leave-coop-room-btn').waitFor({ state: 'visible', timeout: 3000 });
      await page.getByTestId('leave-coop-room-btn').click();
      await page.getByTestId('active-coop-room-code').waitFor({ state: 'hidden', timeout: 3000 });
      await page.keyboard.press('Escape');
      await page.getByTestId('settings-modal-close').waitFor({ state: 'hidden', timeout: 3000 });
      assert.equal(await menuBtn.isEnabled(), true, 'infinite-zoom-menu-btn must re-enable after leaving Co-op');

      // 4b. Active Replay mode (long-press undo-btn) -> Infinite Zoom button must hide
      const undoBtn = page.getByTestId('undo-btn');
      await undoBtn.waitFor({ state: 'visible', timeout: 3000 });
      const undoBox = await getStableBoundingBox(undoBtn);
      assert.ok(undoBox, 'Expected stable boundingBox for undo-btn');
      await page.mouse.move(undoBox.x + undoBox.width / 2, undoBox.y + undoBox.height / 2);
      await page.mouse.down();
      await page.getByTestId('replay-controls-window').waitFor({ state: 'visible', timeout: 4000 });
      await page.mouse.up();

      const hiddenInReplay = (await menuBtn.count()) === 0 || !(await menuBtn.isVisible());
      assert.equal(hiddenInReplay, true, 'infinite-zoom-menu-btn MUST be hidden during active Replay');

      await page.getByTestId('replay-exit-btn').click();
      await page.getByTestId('replay-controls-window').waitFor({ state: 'hidden', timeout: 3000 });
      await menuBtn.waitFor({ state: 'visible', timeout: 3000 });

      // 4c. CreateTab legacy parity & local-ai-mode-select persistence
      await page.getByTestId('topbar-settings-btn').click();
      await page.getByTestId('settings-tab-create').waitFor({ state: 'visible', timeout: 3000 });
      await page.getByTestId('settings-tab-create').click();

      await page.getByTestId('infinite-zoom-subtile-btn').waitFor({ state: 'visible', timeout: 3000 });
      await page.getByTestId('create-infinite-zoom-in-btn').waitFor({ state: 'visible', timeout: 3000 });
      await page.getByTestId('create-infinite-zoom-out-btn').waitFor({ state: 'visible', timeout: 3000 });
      const modeSelect = page.getByTestId('local-ai-mode-select');
      await modeSelect.waitFor({ state: 'visible', timeout: 3000 });

      await modeSelect.selectOption('OFFLINE_FAST');
      await page.waitForFunction(
        (key) => JSON.parse(localStorage.getItem(key) || '{}').localAiMode === 'OFFLINE_FAST',
        SETTINGS_KEY,
        { timeout: 3000 }
      );
      await modeSelect.selectOption('AUTO');
      await page.waitForFunction(
        (key) => JSON.parse(localStorage.getItem(key) || '{}').localAiMode === 'AUTO',
        SETTINGS_KEY,
        { timeout: 3000 }
      );
      await page.keyboard.press('Escape');
      await page.getByTestId('settings-modal-close').waitFor({ state: 'hidden', timeout: 3000 });
    } finally {
      await context.close();
    }

    // Part B: 360x780 Mobile Portrait + largeText: true layout & TopBar lane overlap checks
    const { context: mobCtx, page: mobPage } = await createBootedContext(browser, BASE_URL, {
      label: 'infinite-zoom-stage4-mobile-360',
      attachErrorListeners,
      viewport: { width: 360, height: 780 },
      hasTouch: true,
      skipTutorial: true,
      easyNoReplay: true,
      extraSettings: { largeText: true },
    });
    try {
      const largeTextAttr = await mobPage.evaluate(() => document.documentElement.dataset.largeText);
      assert.equal(largeTextAttr, 'true', 'largeText: true must set documentElement.dataset.largeText = "true"');

      // Create an extended outer puzzle so Outer/Inner breadcrumbs are visible on 360x780
      const baseSnapId = (await readActiveSession(mobPage)).activeSnapshotId;
      await mobPage.getByTestId('infinite-zoom-menu-btn').click();
      await mobPage.getByTestId('toolbar-infinite-zoom-out-btn').waitFor({ state: 'visible', timeout: 3000 });

      // Check popover items fit strictly inside [0, 360] x [0, 780]
      const zoomInPopBox = await getStableBoundingBox(mobPage.getByTestId('toolbar-infinite-zoom-in-btn'));
      const zoomOutPopBox = await getStableBoundingBox(mobPage.getByTestId('toolbar-infinite-zoom-out-btn'));
      assert.ok(zoomInPopBox && zoomOutPopBox, 'Popover action buttons must have valid bounding boxes');
      for (const [name, box] of [
        ['toolbar-infinite-zoom-in-btn', zoomInPopBox],
        ['toolbar-infinite-zoom-out-btn', zoomOutPopBox],
      ]) {
        assert.ok(
          box.x >= -0.5 && box.x + box.width <= 360.5 && box.y >= 0 && box.y + box.height <= 780.5,
          `Mobile 360x780 + largeText: ${name} clipped outside viewport (${JSON.stringify(box)})`
        );
      }

      await mobPage.getByTestId('toolbar-infinite-zoom-out-btn').click();
      await mobPage.getByTestId('toolbar-infinite-zoom-out-confirm-btn').waitFor({ state: 'visible', timeout: 3000 });
      await mobPage.getByTestId('infinite-zoom-out-prompt-input').waitFor({ state: 'visible', timeout: 3000 });
      await setExtendSideState(mobPage, 'extend-side-top', true);

      // Verify Extend Borders sub-popover controls fit strictly inside 360x780 + largeText with zero horizontal overflow
      const extendSubPopoverControls = [
        'extend-side-top',
        'extend-side-bottom',
        'extend-side-left',
        'extend-side-right',
        'infinite-zoom-out-prompt-input',
        'toolbar-infinite-zoom-out-confirm-btn',
      ];
      for (const testId of extendSubPopoverControls) {
        const ctrl = mobPage.getByTestId(testId);
        await ctrl.waitFor({ state: 'visible', timeout: 3000 });
        const box = await getStableBoundingBox(ctrl);
        assert.ok(box, `Mobile 360x780 + largeText: ${testId} must have a valid bounding box`);
        assert.ok(
          box.x >= 0 && box.x + box.width <= 360.5 && box.y >= 0 && box.y + box.height <= 780.5,
          `Mobile 360x780 + largeText: Extend Borders control ${testId} clipped outside viewport (${JSON.stringify(box)})`
        );
      }
      const extendPopoverOverflow = await mobPage.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth
      );
      assert.ok(
        extendPopoverOverflow <= 0,
        `Must have zero horizontal document overflow while Extend Borders sub-popover is open on 360x780 + largeText (got ${extendPopoverOverflow}px)`
      );

      await mobPage.getByTestId('toolbar-infinite-zoom-out-confirm-btn').click();
      await mobPage.waitForFunction(
        ({ key, prevId }) => {
          const s = JSON.parse(localStorage.getItem(key) || '{}');
          return Boolean(s.activeSnapshotId && s.activeSnapshotId !== prevId);
        },
        { key: ACTIVE_SESSION_KEY, prevId: baseSnapId },
        { timeout: 25000 }
      );
      await waitForPuzzleLoaded(mobPage);
      await mobPage.getByTestId('topbar-child-puzzle-btn').waitFor({ state: 'visible', timeout: 5000 });

      // Verify zero horizontal document overflow and zero topbar-left-lane / topbar-right-lane overlap
      const mobileOverflow = await mobPage.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth
      );
      assert.ok(
        mobileOverflow <= 0,
        `Must have zero horizontal document overflow on 360x780 + largeText (got ${mobileOverflow}px)`
      );

      const leftLaneBox = await mobPage.getByTestId('topbar-left-lane').boundingBox();
      const rightLaneBox = await mobPage.getByTestId('topbar-right-lane').boundingBox();
      assert.ok(leftLaneBox && rightLaneBox, 'TopBar left and right lanes must have bounding boxes');
      assert.ok(
        leftLaneBox.x + leftLaneBox.width <= rightLaneBox.x + 1 &&
          rightLaneBox.x + rightLaneBox.width <= 360.5,
        `TopBar lanes must not overlap or overflow 360px with Inner breadcrumb visible (${JSON.stringify({
          leftLaneBox,
          rightLaneBox,
        })})`
      );

      // Navigate Inner to also verify Outer breadcrumb (topbar-parent-puzzle-btn) on 360x780 + largeText
      await mobPage.getByTestId('topbar-child-puzzle-btn').click();
      await mobPage.waitForFunction(
        ({ key, targetId }) => JSON.parse(localStorage.getItem(key) || '{}').activeSnapshotId === targetId,
        { key: ACTIVE_SESSION_KEY, targetId: baseSnapId },
        { timeout: 15000 }
      );
      await waitForPuzzleLoaded(mobPage);
      await mobPage.getByTestId('topbar-parent-puzzle-btn').waitFor({ state: 'visible', timeout: 5000 });
      const leftLaneOuterBox = await mobPage.getByTestId('topbar-left-lane').boundingBox();
      const rightLaneOuterBox = await mobPage.getByTestId('topbar-right-lane').boundingBox();
      assert.ok(
        leftLaneOuterBox &&
          rightLaneOuterBox &&
          leftLaneOuterBox.x + leftLaneOuterBox.width <= rightLaneOuterBox.x + 1 &&
          rightLaneOuterBox.x + rightLaneOuterBox.width <= 360.5,
        `TopBar lanes must not overlap with Outer breadcrumb visible on 360x780 (${JSON.stringify({
          leftLaneOuterBox,
          rightLaneOuterBox,
        })})`
      );

      // Open Region Selection Bar on 360x780 + largeText and verify zero horizontal clipping
      await mobPage.getByTestId('infinite-zoom-menu-btn').click();
      await mobPage.getByTestId('toolbar-infinite-zoom-in-btn').click();
      const mobSelBar = mobPage.getByTestId('region-selection-bar');
      await mobSelBar.waitFor({ state: 'visible', timeout: 3000 });
      const mobBarBox = await getStableBoundingBox(mobSelBar);
      assert.ok(mobBarBox, 'Expected stable boundingBox for mobile region-selection-bar');
      assert.ok(
        mobBarBox.x >= -0.5 &&
          mobBarBox.x + mobBarBox.width <= 360.5 &&
          mobBarBox.y >= 0 &&
          mobBarBox.y + mobBarBox.height <= 780.5,
        `region-selection-bar clipped on 360x780 + largeText (${JSON.stringify(mobBarBox)})`
      );
      const overflowWithBar = await mobPage.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth
      );
      assert.ok(
        overflowWithBar <= 0,
        `Must have zero horizontal overflow with region-selection-bar open on 360x780 (got ${overflowWithBar}px)`
      );
      await mobPage.getByTestId('region-selection-cancel-btn').click();
      await mobSelBar.waitFor({ state: 'hidden', timeout: 3000 });

      logE2ePass('Stage 4 passed');
    } finally {
      await mobCtx.close();
    }
}

export async function runInfiniteZoomE2e(ctx) {
  const { browser, BASE_URL, attachErrorListeners, logE2eStart, logE2ePass } = ctx;
  const stageCtx = { browser, BASE_URL, attachErrorListeners, logE2eStart, logE2ePass };
  await runStage1InPlaceSubdivision(stageCtx);
  await runStage2DeepChildCutout(stageCtx);
  await runStage3DirectionalBorderAndCancel(stageCtx);
  await runStage4GuardsAndMobile(stageCtx);
}
