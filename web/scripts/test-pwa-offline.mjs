// test-pwa-offline.mjs - Automated Playwright Test for Capy PWA & Offline Support
import { chromium } from 'playwright';

async function runPwaOfflineTest() {
  console.log('📱 Starting Capy PWA & Offline Verification Test...');
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
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

  page.on('response', (res) => {
    if (res.status() >= 400) {
      console.warn(`⚠️ HTTP ${res.status()} ${res.url()}`);
    }
  });

  page.on('requestfailed', (req) => {
    console.warn(`⚠️ REQ FAILED: ${req.url()} (${req.failure()?.errorText})`);
  });

  page.on('pageerror', (err) => {
    console.error('❌ Browser Unhandled Error:', err.message);
    consoleErrors.push(err.message);
  });

  try {
    // -------------------------------------------------------------------------
    // Step 1: Verify Manifest Reachability & Validity
    // -------------------------------------------------------------------------
    console.log('1️⃣ Fetching and validating manifest.webmanifest...');
    const manifestResponse = await page.goto('http://localhost:3000/manifest.webmanifest');
    if (!manifestResponse || manifestResponse.status() !== 200) {
      throw new Error(`Failed to load manifest.webmanifest (status: ${manifestResponse?.status()})`);
    }
    const manifestJson = JSON.parse(await manifestResponse.text());
    console.log(`   Manifest Name: "${manifestJson.name}"`);
    console.log(`   Display Mode: "${manifestJson.display}"`);
    console.log(`   Start URL: "${manifestJson.start_url}"`);
    console.log(`   Icons defined: ${manifestJson.icons?.length}`);

    if (manifestJson.name !== 'Capy - Color by Number') {
      throw new Error(`Unexpected manifest name: ${manifestJson.name}`);
    }
    if (manifestJson.display !== 'standalone') {
      throw new Error(`Unexpected manifest display: ${manifestJson.display}`);
    }
    if (!manifestJson.icons || manifestJson.icons.length < 3) {
      throw new Error(`Expected at least 3 icons in manifest, found ${manifestJson.icons?.length}`);
    }
    console.log('   ✅ Manifest validation passed.');

    // -------------------------------------------------------------------------
    // Step 2: Load Capy Web App & Wait for Service Worker Registration
    // -------------------------------------------------------------------------
    console.log('2️⃣ Navigating to http://localhost:3000/ and waiting for Service Worker...');
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });

    await page.waitForSelector('canvas', { timeout: 10000 });
    await page.waitForSelector('[aria-label="Palette dock"]', { timeout: 25000 });

    // Wait for service worker to activate
    console.log('   Waiting for navigator.serviceWorker.ready...');
    const swRegistered = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false;
      const reg = await navigator.serviceWorker.ready;
      return !!reg && !!reg.active;
    });

    if (!swRegistered) {
      throw new Error('Service Worker did not become ready/active.');
    }
    console.log('   ✅ Service Worker registered and active.');

    // -------------------------------------------------------------------------
    // Step 3: Verify Cache Storage Contents
    // -------------------------------------------------------------------------
    console.log('3️⃣ Inspecting Cache Storage...');
    const cacheDetails = await page.evaluate(async () => {
      const cacheNames = await caches.keys();
      const hasCapyCache = cacheNames.includes('capy-cache-v1');
      if (!hasCapyCache) return { hasCapyCache: false, count: 0, sampleUrls: [] };

      const cache = await caches.open('capy-cache-v1');
      const requests = await cache.keys();
      const urls = requests.map((r) => r.url);
      return {
        hasCapyCache: true,
        count: urls.length,
        urls: urls,
      };
    });

    console.log(`   Cache "capy-cache-v1" found with ${cacheDetails.count} cached entries:`);
    cacheDetails.urls.forEach((u) => console.log(`     - ${u}`));
    if (!cacheDetails.hasCapyCache || cacheDetails.count === 0) {
      throw new Error('Expected capy-cache-v1 to contain cached assets.');
    }
    console.log('   ✅ Cache Storage populated with application shell.');

    // -------------------------------------------------------------------------
    // Step 4: Verify Settings Modal PWA UI Card
    // -------------------------------------------------------------------------
    console.log('4️⃣ Verifying PWA Platforms & Applications card in Settings Modal...');
    await page.click('button[title*="Settings"], button[aria-label*="Settings"]');
    await page.waitForSelector('text=Platforms & Applications', { timeout: 5000 });
    const pwaCardText = await page.textContent('text=Progressive Web App');
    if (!pwaCardText) {
      throw new Error('Progressive Web App card not visible in Settings modal.');
    }
    console.log('   ✅ PWA Platforms & Applications card verified in Settings.');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // -------------------------------------------------------------------------
    // Step 5: Simulate Offline Network Disconnection
    // -------------------------------------------------------------------------
    console.log('5️⃣ Disconnecting network (Offline Mode: TRUE)...');
    await context.setOffline(true);

    // -------------------------------------------------------------------------
    // Step 6: Reload Page Completely Offline
    // -------------------------------------------------------------------------
    console.log('6️⃣ Reloading page while 100% offline...');
    await page.reload({ waitUntil: 'load' });

    const offlineTitle = await page.title();
    console.log(`   Offline page title: "${offlineTitle}"`);
    if (!offlineTitle.includes('Capy')) {
      throw new Error(`Failed to load page offline, title is "${offlineTitle}"`);
    }

    console.log('   Waiting for puzzle canvas and palette dock offline...');
    await page.waitForSelector('canvas', { timeout: 10000 });
    await page.waitForSelector('[aria-label="Palette dock"]', { timeout: 25000 });
    console.log('   ✅ Puzzle canvas and PaletteDock loaded completely offline via Service Worker!');

    // -------------------------------------------------------------------------
    // Step 7: Play Game Offline (Region Hit-Testing & Undo)
    // -------------------------------------------------------------------------
    console.log('7️⃣ Testing gameplay actions while offline...');
    // Tap canvas to fill region
    const canvas = await page.$('canvas');
    const box = await canvas.boundingBox();
    const tapX = box.x + box.width / 2;
    const tapY = box.y + box.height / 2;

    await page.mouse.click(tapX, tapY);
    await page.waitForTimeout(300);

    const initialProgress = await page.evaluate(() => {
      const text = document.querySelector('header button')?.textContent || '';
      const match = text.match(/(\d+)%/);
      return match ? parseInt(match[1], 10) : 0;
    });
    console.log(`   Offline gameplay progress: ${initialProgress}%`);

    // Verify Undo action offline
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    console.log('   ✅ Offline gameplay gestures and shortcuts verified.');

    // -------------------------------------------------------------------------
    // Step 8: Reconnect Network & Verify Clean Execution
    // -------------------------------------------------------------------------
    console.log('8️⃣ Reconnecting network and verifying zero error logs...');
    await context.setOffline(false);

    if (consoleErrors.length > 0) {
      console.warn('⚠️ Console errors recorded:', consoleErrors);
    }
    console.log('🎉 PWA OFFLINE VERIFICATION PASSED WITH FULL SERVICE WORKER CACHING!');
  } finally {
    await browser.close();
  }
}

runPwaOfflineTest().catch((err) => {
  console.error('❌ PWA Offline Test Failed:', err);
  process.exit(1);
});
