import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const OUT_DIRS = [
  path.resolve(import.meta.dirname, '../../docs/gallery'),
];

OUT_DIRS.forEach((d) => fs.mkdirSync(d, { recursive: true }));

async function captureGallery() {
  console.log('📸 Launching Chromium to capture gallery screenshots...');
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const saveScreenshots = async (page, filename) => {
    for (const dir of OUT_DIRS) {
      const dest = path.join(dir, filename);
      await page.screenshot({ path: dest });
      console.log(`   Saved screenshot: ${dest}`);
    }
  };

  try {
    // ----------------------------------------------------
    // 1. Desktop Gameplay (1280x800 @ 2x DPR)
    // ----------------------------------------------------
    console.log('1️⃣ Capturing Desktop Gameplay...');
    const desktopContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 2,
    });
    const desktopPage = await desktopContext.newPage();
    await desktopPage.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
    await desktopPage.waitForSelector('[aria-label="Palette dock"]', { timeout: 25000 });
    await desktopPage.waitForTimeout(1000); // Allow render settle

    // Color a couple regions to make the canvas look dynamic & active
    const canvas = await desktopPage.$('canvas');
    const box = await canvas.boundingBox();
    if (box) {
      // Tap center-left and center-right
      await desktopPage.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.48);
      await desktopPage.waitForTimeout(300);
      await desktopPage.mouse.click(box.x + box.width * 0.52, box.y + box.height * 0.52);
      await desktopPage.waitForTimeout(300);
    }

    await saveScreenshots(desktopPage, 'desktop_gameplay.png');

    // ----------------------------------------------------
    // 2. Zoomed Detail & Dynamic Highlighting
    // ----------------------------------------------------
    console.log('2️⃣ Capturing Zoomed Detail...');
    // Click zoom in button a few times
    const zoomInBtn = await desktopPage.$('button[title*="Zoom In"], button:has(svg.lucide-plus)');
    if (zoomInBtn) {
      await zoomInBtn.click();
      await desktopPage.waitForTimeout(150);
      await zoomInBtn.click();
      await desktopPage.waitForTimeout(150);
      await zoomInBtn.click();
      await desktopPage.waitForTimeout(400);
    }
    await saveScreenshots(desktopPage, 'zoomed_detail.png');

    // Reset zoom
    const resetBtn = await desktopPage.$('button[title*="Reset"], button:has(svg.lucide-maximize-2)');
    if (resetBtn) {
      await resetBtn.click();
      await desktopPage.waitForTimeout(300);
    }

    // ----------------------------------------------------
    // 3. Settings Modal & Customizer UX
    // ----------------------------------------------------
    console.log('3️⃣ Capturing Settings Modal Customizer...');
    const settingsBtn = await desktopPage.waitForSelector('button[title="Settings and Menu"]');
    await settingsBtn.click();
    await desktopPage.waitForTimeout(300);
    const settingsTabBtn = await desktopPage.waitForSelector('button:has-text("Settings")');
    await settingsTabBtn.click();
    await desktopPage.waitForTimeout(400);

    await saveScreenshots(desktopPage, 'settings_customizer.png');

    // Also capture Hints tab in Settings
    const hintsTabBtn = await desktopPage.waitForSelector('button:has-text("Hints")');
    await hintsTabBtn.click();
    await desktopPage.waitForTimeout(400);
    await saveScreenshots(desktopPage, 'settings_hints.png');

    // Close settings modal
    const closeBtn = await desktopPage.waitForSelector('button:has(svg.lucide-x)');
    await closeBtn.click();
    await desktopPage.waitForTimeout(400);

    await desktopContext.close();

    // ----------------------------------------------------
    // 4. Free Colour / Coloring Page Mode (Mushroom Forest)
    // ----------------------------------------------------
    console.log('4️⃣ Capturing Free Colour / Coloring Page Mode...');
    const coloringContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 2,
    });
    const coloringPage = await coloringContext.newPage();
    await coloringPage.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
    await coloringPage.waitForSelector('[aria-label="Palette dock"]', { timeout: 25000 });

    // Open Settings -> Create tab -> Pick Mushroom Forest sample
    const sBtn = await coloringPage.waitForSelector('button[title="Settings and Menu"]');
    await sBtn.click();
    await coloringPage.waitForTimeout(400);

    const createTabBtn = await coloringPage.waitForSelector('button:has-text("Create")');
    await createTabBtn.click();
    await coloringPage.waitForTimeout(400);

    // Click Mushroom Forest sample card's Play button
    const mushroomCard = await coloringPage.waitForSelector('div.group:has-text("Mushroom Forest")');
    const playBtn = await mushroomCard.$('button:has-text("Play")');
    if (playBtn) {
      await playBtn.click();
    }

    // Wait for new puzzle to generate and modal to close
    await coloringPage.waitForSelector('[aria-label="Palette dock"]', { timeout: 25000 });
    await coloringPage.waitForTimeout(1000);

    // Color a couple regions in free color mode
    const cCanvas = await coloringPage.$('canvas');
    const cBox = await cCanvas.boundingBox();
    if (cBox) {
      await coloringPage.mouse.click(cBox.x + cBox.width * 0.42, cBox.y + cBox.height * 0.48);
      await coloringPage.waitForTimeout(200);
      await coloringPage.mouse.click(cBox.x + cBox.width * 0.55, cBox.y + cBox.height * 0.55);
      await coloringPage.waitForTimeout(200);
    }

    // Open color palette customizer popover if button is visible
    const paletteOptionsBtn = await coloringPage.$('button[title*="Palette"], button:has(svg.lucide-palette)');
    if (paletteOptionsBtn) {
      await paletteOptionsBtn.click();
      await coloringPage.waitForTimeout(500);
    }

    await saveScreenshots(coloringPage, 'coloring_page_mode.png');
    await coloringContext.close();


    // ----------------------------------------------------
    // 5. Mobile Portrait Experience (Pixel 7: 412x915 @ 2.5x DPR)
    // ----------------------------------------------------
    console.log('5️⃣ Capturing Mobile Portrait Experience...');
    const mobileContext = await browser.newContext({
      viewport: { width: 412, height: 915 },
      deviceScaleFactor: 2.5,
      hasTouch: true,
      isMobile: true,
    });
    const mobilePage = await mobileContext.newPage();
    await mobilePage.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
    await mobilePage.waitForSelector('[aria-label="Palette dock"]', { timeout: 25000 });
    await mobilePage.waitForTimeout(1000);

    // Color a region in mobile
    const mCanvas = await mobilePage.$('canvas');
    const mBox = await mCanvas.boundingBox();
    if (mBox) {
      await mobilePage.mouse.click(mBox.x + mBox.width * 0.5, mBox.y + mBox.height * 0.48);
      await mobilePage.waitForTimeout(400);
    }

    await saveScreenshots(mobilePage, 'mobile_gameplay.png');
    await mobileContext.close();

    console.log('✨ All gallery screenshots captured and saved successfully!');
  } finally {
    await browser.close();
  }
}

captureGallery().catch((err) => {
  console.error('❌ Capture failed:', err);
  process.exit(1);
});
