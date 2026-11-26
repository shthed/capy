import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { preview } from 'vite';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.resolve(import.meta.dirname, '../../docs/gallery');
const ONLY_ANIMATION = process.argv.includes('--only-animation');

fs.mkdirSync(OUT_DIR, { recursive: true });

const ALL_OFFER_IDS = [
  'paint_mode',
  'undo_replay',
  'replay_scrubber',
  'free_color',
  'create_gallery',
  'photo_upload',
  'infinite_zoom',
  'saves_export',
  'settings_hints_tip',
];

function resolveChromiumExecutablePath() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }
  try {
    const bundled = chromium.executablePath();
    if (bundled && fs.existsSync(bundled)) {
      return bundled;
    }
  } catch {
    // Fall through to system browser discovery
  }
  if (fs.existsSync('/usr/bin/chromium')) return '/usr/bin/chromium';
  if (fs.existsSync('/usr/bin/google-chrome')) return '/usr/bin/google-chrome';
  return undefined;
}

async function isServerListening(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}

async function suppressOnboardingAndOffers(context) {
  await context.addInitScript((offerIds) => {
    try {
      localStorage.setItem('capy_tutorial_completed_v1', '2');
      localStorage.setItem('capy_feature_offers_v1', JSON.stringify(offerIds));
    } catch {
      // Ignore storage restrictions
    }
  }, ALL_OFFER_IDS);
}

async function clickCanvasPoints(page, points, delayMs = 70) {
  const canvas = await page.waitForSelector('canvas', { timeout: 15000 });
  const box = await canvas.boundingBox();
  if (!box) return;
  for (const [rx, ry] of points) {
    await page.mouse.click(box.x + box.width * rx, box.y + box.height * ry);
    await page.waitForTimeout(delayMs);
  }
}

async function openSampleFromCreate(page, sampleId) {
  await page.getByTestId('topbar-settings-btn').click();
  await page.waitForTimeout(250);
  await page.getByTestId('settings-tab-create').click();
  await page.waitForTimeout(300);

  const card = page.getByTestId(`gallery-card-${sampleId}`);
  await card.scrollIntoViewIfNeeded();
  await card.locator('button:has-text("Play")').click();

  await page.waitForSelector('[data-testid="palette-dock"]', { timeout: 25000 });
  await page.waitForTimeout(800);
}

async function captureGallery() {
  const distDir = path.join(PROJECT_ROOT, 'dist');
  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    throw new Error('web/dist/index.html not found. Run `npm run build` in web/ first.');
  }

  let previewServer = null;
  let baseUrl = (process.env.CAPY_GALLERY_URL || '').trim().replace(/\/+$/, '');
  if (!baseUrl || !(await isServerListening(baseUrl))) {
    console.log('Starting local Vite preview server from dist/...');
    previewServer = await preview({
      root: PROJECT_ROOT,
      preview: { port: 0, host: '127.0.0.1' },
      logLevel: 'error',
    });
    const addr = previewServer.httpServer?.address();
    const port = typeof addr === 'object' && addr ? addr.port : 4173;
    baseUrl = `http://127.0.0.1:${port}`;
    console.log(`Vite preview listening at ${baseUrl}`);
  }

  const executablePath = resolveChromiumExecutablePath();
  console.log(`Launching Chromium${executablePath ? ` (${executablePath})` : ''}...`);
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const saveScreenshot = async (page, filename) => {
    const dest = path.join(OUT_DIR, filename);
    await page.screenshot({ path: dest });
    console.log(`   Saved screenshot: ${dest}`);
  };

  try {
    if (!ONLY_ANIMATION) {
    // ----------------------------------------------------
    // 1. Desktop Gameplay (1280x800 @ 2x DPR)
    // ----------------------------------------------------
    console.log('1) Capturing Desktop Gameplay...');
    const desktopContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 2,
    });
    await suppressOnboardingAndOffers(desktopContext);
    const desktopPage = await desktopContext.newPage();
    await desktopPage.goto(`${baseUrl}/?skipTutorial=1`, { waitUntil: 'networkidle' });
    await desktopPage.waitForSelector('[data-testid="palette-dock"]', { timeout: 25000 });
    await desktopPage.waitForTimeout(900);

    // Paint a lush, recognizable cluster over the capybara, mushrooms, butterfly clearing, and treehouse
    const forestPoints = [];
    for (let gx = 0.16; gx <= 0.72; gx += 0.028) {
      for (let gy = 0.18; gy <= 0.74; gy += 0.036) {
        const dx = (gx - 0.42) / 0.30;
        const dy = (gy - 0.47) / 0.30;
        if (dx * dx + dy * dy <= 1.0) {
          forestPoints.push([gx, gy]);
        }
      }
    }
    await clickCanvasPoints(desktopPage, forestPoints, 10);

    // Pick a high-count remaining swatch so active region highlighting stands out
    const desktopSwatches = desktopPage.locator('[data-testid^="palette-swatch-"]');
    const desktopSwatchCount = await desktopSwatches.count();
    if (desktopSwatchCount > 0) {
      await desktopPage.getByTestId('palette-swatch-10').click().catch(async () => {
        await desktopSwatches.nth(Math.min(4, desktopSwatchCount - 1)).click();
      });
      await desktopPage.waitForTimeout(450);
    }

    await saveScreenshot(desktopPage, 'desktop_gameplay.png');

    // ----------------------------------------------------
    // 2. Zoomed Detail & Active Highlighting
    // ----------------------------------------------------
    console.log('2) Capturing Zoomed Detail...');
    for (let i = 0; i < 4; i += 1) {
      await desktopPage.keyboard.press('=');
      await desktopPage.waitForTimeout(200);
    }
    // Pan slightly toward the painted/unpainted boundary near the clearing & treehouse
    await desktopPage.keyboard.press('ArrowLeft');
    await desktopPage.waitForTimeout(140);
    await desktopPage.keyboard.press('ArrowUp');
    await desktopPage.waitForTimeout(220);

    // Select a swatch with many unpainted shapes visible inside the zoomed viewport
    for (const candidateNum of ['35', '37', '34', '38', '16', '20']) {
      const candidate = desktopPage.getByTestId(`palette-swatch-${candidateNum}`);
      if (await candidate.count()) {
        await candidate.click();
        await desktopPage.waitForTimeout(450);
        break;
      }
    }
    await saveScreenshot(desktopPage, 'zoomed_detail.png');

    // Reset zoom
    await desktopPage.keyboard.press('0');
    await desktopPage.waitForTimeout(400);

    // ----------------------------------------------------
    // 3. Settings, Hints & Create Tabs
    // ----------------------------------------------------
    console.log('3) Capturing Settings, Hints, and Create modals...');
    await desktopPage.getByTestId('topbar-settings-btn').click();
    await desktopPage.waitForTimeout(300);

    await desktopPage.getByTestId('settings-tab-settings').click();
    await desktopPage.waitForTimeout(350);
    await saveScreenshot(desktopPage, 'settings_customizer.png');

    await desktopPage.getByTestId('settings-tab-hints').click();
    await desktopPage.waitForTimeout(350);
    await saveScreenshot(desktopPage, 'settings_hints.png');

    await desktopPage.getByTestId('settings-tab-create').click();
    await desktopPage.waitForTimeout(350);
    await saveScreenshot(desktopPage, 'create_gallery.png');

    await desktopPage.getByTestId('settings-modal-close').click();
    await desktopPage.waitForTimeout(250);
    await desktopContext.close();

    // ----------------------------------------------------
    // 4. Free Color / Coloring Page Mode (Mushroom Forest)
    // ----------------------------------------------------
    console.log('4) Capturing Free Color / Coloring Page Mode...');
    const coloringContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 2,
    });
    await suppressOnboardingAndOffers(coloringContext);
    const coloringPage = await coloringContext.newPage();
    await coloringPage.goto(`${baseUrl}/?skipTutorial=1`, { waitUntil: 'networkidle' });
    await coloringPage.waitForSelector('[data-testid="palette-dock"]', { timeout: 25000 });
    await openSampleFromCreate(coloringPage, 'mushrooms');

    // Paint vibrant hues across the full Mushroom Forest (including perimeter mushrooms visible around popover)
    const swatches = coloringPage.locator('[data-testid^="palette-swatch-"]');
    const swatchCount = await swatches.count();
    const mushroomStrokes = [
      {
        swatchIdx: 0,
        pts: [
          [0.26, 0.24], [0.29, 0.38], [0.33, 0.56], [0.70, 0.26], [0.73, 0.48], [0.42, 0.14],
        ],
      },
      {
        swatchIdx: 2,
        pts: [
          [0.24, 0.46], [0.31, 0.68], [0.68, 0.36], [0.74, 0.64], [0.54, 0.12], [0.36, 0.80],
        ],
      },
      {
        swatchIdx: 4,
        pts: [
          [0.27, 0.62], [0.32, 0.28], [0.67, 0.58], [0.72, 0.18], [0.48, 0.82], [0.62, 0.14],
        ],
      },
      {
        swatchIdx: 6,
        pts: [
          [0.25, 0.74], [0.34, 0.44], [0.69, 0.72], [0.75, 0.34], [0.30, 0.16], [0.58, 0.82],
        ],
      },
      {
        swatchIdx: 9,
        pts: [
          [0.28, 0.32], [0.33, 0.76], [0.66, 0.22], [0.71, 0.54], [0.44, 0.34], [0.56, 0.44],
        ],
      },
      {
        swatchIdx: 12,
        pts: [
          [0.23, 0.54], [0.30, 0.82], [0.68, 0.44], [0.74, 0.76], [0.36, 0.20], [0.64, 0.78],
        ],
      },
      {
        swatchIdx: 15,
        pts: [
          [0.26, 0.16], [0.32, 0.50], [0.67, 0.66], [0.73, 0.28], [0.52, 0.20], [0.40, 0.76],
        ],
      },
    ];
    for (const stroke of mushroomStrokes) {
      if (swatchCount > 0) {
        await swatches.nth(stroke.swatchIdx % swatchCount).click();
        await coloringPage.waitForTimeout(80);
      }
      await clickCanvasPoints(coloringPage, stroke.pts, 20);
    }

    // Open custom color picker popover so both the vibrant artwork and color picker are visible
    const customBtn = coloringPage.getByTestId('palette-custom-btn');
    if (await customBtn.count()) {
      await customBtn.click();
      await coloringPage.waitForTimeout(450);
    }
    await saveScreenshot(coloringPage, 'coloring_page_mode.png');
    await coloringContext.close();

    // ----------------------------------------------------
    // 5. Mobile Portrait Experience (412x915 @ 2.5x DPR)
    // ----------------------------------------------------
    console.log('5) Capturing Mobile Portrait Experience...');
    const mobileContext = await browser.newContext({
      viewport: { width: 412, height: 915 },
      deviceScaleFactor: 2.5,
      hasTouch: true,
      isMobile: true,
    });
    await suppressOnboardingAndOffers(mobileContext);
    const mobilePage = await mobileContext.newPage();
    await mobilePage.goto(`${baseUrl}/?skipTutorial=1`, { waitUntil: 'networkidle' });
    await mobilePage.waitForSelector('[data-testid="palette-dock"]', { timeout: 25000 });

    // Load square Capybara illustration so it frames beautifully in portrait orientation
    await openSampleFromCreate(mobilePage, 'capybara_sample');

    const capyPoints = [];
    for (let gx = 0.22; gx <= 0.74; gx += 0.036) {
      for (let gy = 0.34; gy <= 0.64; gy += 0.022) {
        const dx = (gx - 0.45) / 0.28;
        const dy = (gy - 0.48) / 0.16;
        if (dx * dx + dy * dy <= 1.0) {
          capyPoints.push([gx, gy]);
        }
      }
    }
    await clickCanvasPoints(mobilePage, capyPoints, 12);

    for (const candidateNum of ['26', '25', '21', '7', '6']) {
      const candidate = mobilePage.getByTestId(`palette-swatch-${candidateNum}`);
      if (await candidate.count()) {
        await candidate.click();
        await mobilePage.waitForTimeout(450);
        break;
      }
    }

    await saveScreenshot(mobilePage, 'mobile_gameplay.png');
    await mobileContext.close();
    }

    // ----------------------------------------------------
    // 6. Animated Puzzle Completion & Timelapse Replay (960x600 WebP)
    // ----------------------------------------------------
    console.log('6) Capturing Animated Puzzle Completion & Timelapse Replay...');
    await captureCompletionAnimation(browser, baseUrl);

    console.log('All gallery screenshots captured and saved successfully!');
  } finally {
    await browser.close();
    if (previewServer) {
      previewServer.httpServer?.close();
    }
  }
}

async function captureCompletionAnimation(browser, baseUrl) {
  const animContext = await browser.newContext({
    viewport: { width: 960, height: 600 },
    deviceScaleFactor: 1,
  });
  await suppressOnboardingAndOffers(animContext);
  const page = await animContext.newPage();

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capy-gallery-anim-'));
  try {
    await page.goto(`${baseUrl}/?skipTutorial=1`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="palette-dock"]', { timeout: 25000 });
    await page.waitForTimeout(700);

    // Prepare active Capy Forest snapshot at ~99% complete, leaving 5 prominent focal shapes
    const prep = await page.evaluate(async () => {
      const activeRaw = localStorage.getItem('capy_active_session_v8');
      const snapsRaw = localStorage.getItem('capy_snapshots_v8');
      if (!activeRaw || !snapsRaw) return null;
      const active = JSON.parse(activeRaw);
      const snaps = JSON.parse(snapsRaw);
      const snapId = active.activeSnapshotId || snaps[0]?.id;
      if (!snapId) return null;

      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('capy_game_storage_v8', 1);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const record = await new Promise((resolve, reject) => {
        const tx = db.transaction('puzzles', 'readonly');
        const req = tx.objectStore('puzzles').get(snapId);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      db.close();
      if (!record || !record.regionMeta) return null;

      const { width, height, regionMeta } = record;
      const regions = [];
      for (let i = 0; i < regionMeta.length; i += 5) {
        regions.push({
          id: Math.round(regionMeta[i]),
          colorId: Math.round(regionMeta[i + 1]),
          cx: regionMeta[i + 2],
          cy: regionMeta[i + 3],
          r: regionMeta[i + 4],
        });
      }

      // Pick 5 big, well-spaced visible shapes in the safe inner canvas area for the final live taps
      const candidates = regions
        .filter(
          (reg) =>
            reg.cx >= width * 0.14 &&
            reg.cx <= width * 0.86 &&
            reg.cy >= height * 0.16 &&
            reg.cy <= height * 0.76
        )
        .sort((a, b) => b.r - a.r);

      const finalRegions = [];
      const minSpacing = width * 0.14;
      for (const cand of candidates) {
        if (finalRegions.length >= 5) break;
        const tooClose = finalRegions.some(
          (picked) => Math.hypot(picked.cx - cand.cx, picked.cy - cand.cy) < minSpacing
        );
        if (!tooClose) finalRegions.push(cand);
      }
      // Order final taps left-to-right so the eye tracks them naturally
      finalRegions.sort((a, b) => a.cx - b.cx);
      const finalSet = new Set(finalRegions.map((r) => r.id));

      // Sort all earlier regions in a smooth diagonal sunrise wave for the built-in timelapse replay
      const prefilled = regions
        .filter((r) => !finalSet.has(r.id))
        .sort((a, b) => a.cx * 0.72 + a.cy * 0.48 - (b.cx * 0.72 + b.cy * 0.48))
        .map((r) => r.id);

      // Update active session & snapshots to prefilled (~99%) and set crisp 8x replay speed
      active.filledRegionIds = prefilled;
      active.zoomScale = 1;
      active.panOffsetX = 0;
      active.panOffsetY = 0;
      localStorage.setItem('capy_active_session_v8', JSON.stringify(active));

      for (const s of snaps) {
        if (s.id === snapId) {
          s.filledRegionIds = prefilled;
          s.filledCount = prefilled.length;
          s.totalCount = regions.length;
          s.progress = Math.floor((prefilled.length / regions.length) * 100);
          s.zoomScale = 1;
          s.panOffsetX = 0;
          s.panOffsetY = 0;
        }
      }
      localStorage.setItem('capy_snapshots_v8', JSON.stringify(snaps));

      const settingsRaw = localStorage.getItem('capy_user_settings_v8');
      const settings = settingsRaw ? JSON.parse(settingsRaw) : {};
      settings.replaySpeed = 8;
      settings.replayFollow = false;
      settings.replayLoop = false;
      settings.reducedMotion = false;
      localStorage.setItem('capy_user_settings_v8', JSON.stringify(settings));

      return { width, height, finalRegions, totalRegions: regions.length };
    });

    if (!prep || prep.finalRegions.length === 0) {
      console.warn('   Skipping completion animation: could not read active puzzle regions.');
      return;
    }

    // Reload so the app boots into the 99% state cleanly
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('canvas', { timeout: 25000 });
    await page.waitForTimeout(500);

    // If post-load replay started, exit straight to live 99% interactive canvas
    const exitReplayBtn = page.getByTestId('replay-exit-btn');
    if (await exitReplayBtn.isVisible().catch(() => false)) {
      await exitReplayBtn.click();
      await page.waitForTimeout(350);
    }

    const canvas = await page.waitForSelector('canvas', { timeout: 15000 });
    const box = await canvas.boundingBox();
    if (!box) return;

    const baseScale = Math.min(box.width / prep.width, box.height / prep.height) * 0.92;
    const baseOffsetX = (box.width - prep.width * baseScale) / 2;
    const baseOffsetY = (box.height - prep.height * baseScale) / 2;

    const cdp = await animContext.newCDPSession(page);
    const frameMeta = [];
    let frameIdx = 0;
    const snapFrame = async (durationMs) => {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const filePath = path.join(tempDir, `frame_${String(frameIdx).padStart(4, '0')}.png`);
      fs.writeFileSync(filePath, Buffer.from(data, 'base64'));
      frameMeta.push({ file: filePath, duration: durationMs });
      frameIdx += 1;
    };

    // Opening pause showing 99% puzzle with 5 final shapes waiting
    await snapFrame(600);

    // Tap the first 4 final regions one by one
    for (let i = 0; i < prep.finalRegions.length - 1; i += 1) {
      const reg = prep.finalRegions[i];
      const sx = box.x + baseOffsetX + reg.cx * baseScale;
      const sy = box.y + baseOffsetY + reg.cy * baseScale;
      await page.mouse.click(sx, sy);
      await page.waitForTimeout(70);
      await snapFrame(150);
      await page.waitForTimeout(120);
      await snapFrame(210);
    }

    // Tap the final 5th region to trigger 100% golden badge and automatic 8x timelapse replay
    const lastReg = prep.finalRegions[prep.finalRegions.length - 1];
    await page.mouse.click(
      box.x + baseOffsetX + lastReg.cx * baseScale,
      box.y + baseOffsetY + lastReg.cy * baseScale
    );

    // Capture smooth live frames across the 8x timelapse replay sweep
    const startMs = Date.now();
    let replayFinishedAt = null;
    while (Date.now() - startMs < 6500) {
      const t0 = Date.now();
      await snapFrame(115);
      // Detect when replay reaches 100% (skip button becomes disabled) and let the final frame settle
      if (replayFinishedAt === null) {
        const skipDisabled = await page
          .getByTestId('replay-skip-btn')
          .isDisabled()
          .catch(() => false);
        if (skipDisabled && Date.now() - startMs > 1500) {
          replayFinishedAt = Date.now();
        }
      } else if (Date.now() - replayFinishedAt > 350) {
        break;
      }
      const elapsed = Date.now() - t0;
      if (elapsed < 55) {
        await page.waitForTimeout(55 - elapsed);
      }
    }

    // Close the replay bar cleanly if visible and hold on the completed 100% masterpiece
    if (await exitReplayBtn.isVisible().catch(() => false)) {
      await exitReplayBtn.click();
      await page.waitForTimeout(180);
    }
    await snapFrame(1600);

    const outWebp = path.join(OUT_DIR, 'puzzle_completion.webp');
    const manifestPath = path.join(tempDir, 'frames.json');
    fs.writeFileSync(manifestPath, JSON.stringify(frameMeta));

    const pyScript = `
import json, sys
from PIL import Image

manifest_path, out_path = sys.argv[1], sys.argv[2]
with open(manifest_path, 'r', encoding='utf-8') as f:
    entries = json.load(f)

frames = [Image.open(e['file']).convert('RGB') for e in entries]
durations = [int(e['duration']) for e in entries]
frames[0].save(
    out_path,
    format='WEBP',
    save_all=True,
    append_images=frames[1:],
    duration=durations,
    loop=0,
    quality=76,
    method=4,
)
print(f'Encoded {len(frames)} frames -> {out_path}')
`;
    execFileSync('python3', ['-c', pyScript, manifestPath, outWebp], { stdio: 'inherit' });
    const sizeKb = Math.round(fs.statSync(outWebp).size / 1024);
    console.log(`   Saved animation: ${outWebp} (${frameMeta.length} frames, ${sizeKb} KB)`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    await animContext.close();
  }
}

captureGallery().catch((err) => {
  console.error('Capture failed:', err);
  process.exit(1);
});
