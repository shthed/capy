import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { preview } from 'vite';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.resolve(import.meta.dirname, '../../docs/play-store/screenshots');

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

async function clickCanvasPoints(page, points, delayMs = 20) {
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
  await page.waitForTimeout(700);
}

async function selectPreferredSwatch(page, preferredNums) {
  const swatches = page.locator('[data-testid^="palette-swatch-"]');
  const count = await swatches.count();
  if (count === 0) return;
  for (const num of preferredNums) {
    const candidate = page.getByTestId(`palette-swatch-${num}`);
    if (await candidate.count()) {
      await candidate.click();
      await page.waitForTimeout(450);
      return;
    }
  }
  await swatches.nth(Math.min(4, count - 1)).click();
  await page.waitForTimeout(450);
}

async function capturePlayStoreFoldables() {
  const distDir = path.join(PROJECT_ROOT, 'dist');
  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    throw new Error('web/dist/index.html not found. Run `npm run build` in web/ first.');
  }

  let previewServer = null;
  let baseUrl = (process.env.CAPY_PLAYSTORE_URL || '').trim().replace(/\/+$/, '');
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
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const saveScreenshot = async (page, filename) => {
    const dest = path.join(OUT_DIR, filename);
    await page.screenshot({ path: dest });
    console.log(`   Saved Play Store screenshot: ${dest}`);
  };

  try {
    // -----------------------------------------------------------------
    // 1. Foldable 1:1 Inner Display (1920x1920 = 768x768 @ 2.5x DPR)
    //    Target devices: Google Pixel 11 Pro Fold, Galaxy Z Fold8 Ultra
    // -----------------------------------------------------------------
    console.log('1) Capturing Foldable 1:1 Inner Display (1920x1920)...');
    const squareCtx = await browser.newContext({
      viewport: { width: 768, height: 768 },
      deviceScaleFactor: 2.5,
      hasTouch: true,
    });
    await suppressOnboardingAndOffers(squareCtx);
    const squarePage = await squareCtx.newPage();
    await squarePage.goto(`${baseUrl}/?skipTutorial=1`, { waitUntil: 'networkidle' });
    await squarePage.waitForSelector('[data-testid="palette-dock"]', { timeout: 25000 });
    await openSampleFromCreate(squarePage, 'capybara_sample');

    const capySquarePoints = [];
    for (let gx = 0.24; gx <= 0.74; gx += 0.036) {
      for (let gy = 0.22; gy <= 0.72; gy += 0.036) {
        const dx = (gx - 0.48) / 0.27;
        const dy = (gy - 0.46) / 0.25;
        if (dx * dx + dy * dy <= 1.0) {
          capySquarePoints.push([gx, gy]);
        }
      }
    }
    await clickCanvasPoints(squarePage, capySquarePoints, 12);
    await selectPreferredSwatch(squarePage, ['26', '25', '21', '15', '10']);
    await saveScreenshot(squarePage, 'foldable_1_1_inner.png');
    await squareCtx.close();

    // -----------------------------------------------------------------
    // 2. Foldable 4:3 Inner Display (1920x1440 = 960x720 @ 2x DPR)
    //    Target devices: Samsung Galaxy Z Fold8 unfolded inner screen
    // -----------------------------------------------------------------
    console.log('2) Capturing Foldable 4:3 Inner Display (1920x1440)...');
    const inner43Ctx = await browser.newContext({
      viewport: { width: 960, height: 720 },
      deviceScaleFactor: 2,
      hasTouch: true,
    });
    await suppressOnboardingAndOffers(inner43Ctx);
    const inner43Page = await inner43Ctx.newPage();
    await inner43Page.goto(`${baseUrl}/?skipTutorial=1`, { waitUntil: 'networkidle' });
    await inner43Page.waitForSelector('[data-testid="palette-dock"]', { timeout: 25000 });
    await inner43Page.waitForTimeout(800);

    const forestPoints = [];
    for (let gx = 0.18; gx <= 0.72; gx += 0.03) {
      for (let gy = 0.22; gy <= 0.74; gy += 0.036) {
        const dx = (gx - 0.44) / 0.28;
        const dy = (gy - 0.48) / 0.26;
        if (dx * dx + dy * dy <= 1.0) {
          forestPoints.push([gx, gy]);
        }
      }
    }
    await clickCanvasPoints(inner43Page, forestPoints, 10);
    await selectPreferredSwatch(inner43Page, ['15', '10', '20', '17']);
    await saveScreenshot(inner43Page, 'foldable_4_3_inner.png');
    await inner43Ctx.close();

    // -----------------------------------------------------------------
    // 3. Foldable 10:16 Folded Outer Display (1200x1920 = 400x640 @ 3x DPR)
    //    Target devices: Samsung Galaxy Z Fold8 cover display
    // -----------------------------------------------------------------
    console.log('3) Capturing Foldable 10:16 Outer Display (1200x1920)...');
    const outerCtx = await browser.newContext({
      viewport: { width: 400, height: 640 },
      deviceScaleFactor: 3,
      hasTouch: true,
      isMobile: true,
    });
    await suppressOnboardingAndOffers(outerCtx);
    const outerPage = await outerCtx.newPage();
    await outerPage.goto(`${baseUrl}/?skipTutorial=1`, { waitUntil: 'networkidle' });
    await outerPage.waitForSelector('[data-testid="palette-dock"]', { timeout: 25000 });
    await openSampleFromCreate(outerPage, 'snail_guitar');

    const outerPoints = [];
    for (let gx = 0.22; gx <= 0.76; gx += 0.04) {
      for (let gy = 0.26; gy <= 0.70; gy += 0.03) {
        const dx = (gx - 0.48) / 0.28;
        const dy = (gy - 0.48) / 0.22;
        if (dx * dx + dy * dy <= 1.0) {
          outerPoints.push([gx, gy]);
        }
      }
    }
    await clickCanvasPoints(outerPage, outerPoints, 12);
    await selectPreferredSwatch(outerPage, ['14', '12', '10', '7']);
    await saveScreenshot(outerPage, 'foldable_10_16_outer.png');
    await outerCtx.close();

    console.log('All Play Store foldable screenshots captured successfully!');
  } finally {
    await browser.close();
    if (previewServer) {
      previewServer.httpServer?.close();
    }
  }
}

capturePlayStoreFoldables().catch((err) => {
  console.error('Play Store foldable capture failed:', err);
  process.exit(1);
});
