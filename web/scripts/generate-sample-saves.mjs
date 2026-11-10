import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_PATH = path.resolve(__dirname, '../public/assets/sample_saves.capy');

const SAMPLES = [
  { id: 'sample-capybara', title: 'Capybara', assetPath: 'assets/capybara.webp' },
  { id: 'sample-mushrooms', title: 'Mushroom Forest', assetPath: 'assets/mushrooms.webp' },
  { id: 'sample-capy-forest', title: 'Capy Forest', assetPath: 'assets/capy_forest.webp' },
  { id: 'sample-snail-guitar', title: 'Snail Guitar', assetPath: 'assets/snail_guitar.webp' },
];

async function waitForFinalizedSnapshotCount(page, expectedCount) {
  await page.waitForFunction(
    (count) => {
      const raw = localStorage.getItem('capy_snapshots_v8');
      if (!raw) return false;
      try {
        const list = JSON.parse(raw);
        if (!Array.isArray(list) || list.length < count) return false;
        return list.slice(0, count).every((s) => typeof s.fileSizeBytes === 'number' && s.totalCount > 0);
      } catch {
        return false;
      }
    },
    expectedCount,
    { timeout: 60000 }
  );
  await page.waitForSelector('[aria-label="Palette dock"]', { timeout: 60000 });
  // Allow IndexedDB transaction to commit cleanly
  await page.waitForTimeout(250);
}

async function generateSampleSaves() {
  const executablePath = fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined;
  console.log('Launching headless Chromium to pre-generate sample save archive...');
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();

    page.on('pageerror', (err) => {
      console.error('Browser page error:', err.message);
    });

    // 1. Open app with skipSampleBootstrap=1 so Sample 1 (Capybara) generates from source image
    console.log('1/4 Generating "Capybara"...');
    await page.goto('http://localhost:3000/?skipSampleBootstrap=1', { waitUntil: 'networkidle' });
    await waitForFinalizedSnapshotCount(page, 1);

    // 2. Generate remaining samples via Settings -> Create tab
    for (let i = 1; i < SAMPLES.length; i++) {
      const sample = SAMPLES[i];
      console.log(`${i + 1}/4 Generating "${sample.title}"...`);

      const settingsBtn = await page.waitForSelector('button[title="Settings and Menu"]');
      await settingsBtn.click();
      await page.waitForTimeout(250);

      const createTabBtn = await page.waitForSelector('button:has-text("Create")');
      await createTabBtn.click();
      await page.waitForTimeout(250);

      const card = await page.waitForSelector(`div.group:has-text("${sample.title}")`);
      const playBtn = await card.$('button:has-text("Play")');
      if (!playBtn) {
        throw new Error(`Play button not found for sample "${sample.title}"`);
      }
      await playBtn.click();

      await waitForFinalizedSnapshotCount(page, i + 1);
    }

    // 3. Export archive via StorageService and normalize snapshot IDs, ordering, and float precision
    console.log('Serializing compact .capy archive bundle...');
    const { binaryArray, jsonSizeBytes, summary } = await page.evaluate(async (sampleDefs) => {
      const rawExport = await window.capyStorage.exportAllSnapshots();
      const parsed = JSON.parse(rawExport);

      const orderedSnapshots = [];
      const orderedPuzzles = {};
      const stats = [];
      const baseTime = 1767225600000;

      for (let idx = 0; idx < sampleDefs.length; idx++) {
        const def = sampleDefs[idx];
        const snap = parsed.snapshots.find(
          (s) => s.sampleAssetPath === def.assetPath || s.title === def.title
        );
        if (!snap) {
          throw new Error(`Missing generated snapshot for ${def.title}`);
        }
        const puzzle = parsed.puzzles[snap.id];
        if (!puzzle) {
          throw new Error(`Missing serialized puzzle data for ${def.title}`);
        }

        // Round floating-point region metrics to 2 decimal places to eliminate JSON float bloat
        const compactRegions = puzzle.regions.map((r) => ({
          ...r,
          centroidX: Math.round(r.centroidX * 100) / 100,
          centroidY: Math.round(r.centroidY * 100) / 100,
          maxRadius: Math.round(r.maxRadius * 100) / 100,
        }));

        const cleanSnapshot = {
          id: def.id,
          title: def.title,
          timestamp: baseTime - idx * 1000,
          lastOpened: baseTime - idx * 1000,
          filledCount: 0,
          totalCount: compactRegions.length,
          filledRegionIds: [],
          ...(snap.customPalette ? { customPalette: snap.customPalette } : {}),
          isFreeColor: Boolean(snap.isFreeColor || puzzle.isFreeColor),
          isAutoSample: true,
          sampleAssetPath: def.assetPath,
          sourceRef: { kind: 'sample', uri: def.assetPath },
          zoomScale: 1,
          panOffsetX: 0,
          panOffsetY: 0,
          fileSizeBytes: snap.fileSizeBytes,
        };

        orderedSnapshots.push(cleanSnapshot);
        orderedPuzzles[def.id] = {
          ...puzzle,
          regions: compactRegions,
        };

        stats.push({
          id: def.id,
          title: def.title,
          dimensions: `${puzzle.width}x${puzzle.height}`,
          colors: puzzle.palette.length,
          regions: compactRegions.length,
          isFreeColor: Boolean(puzzle.isFreeColor),
          rleKb: Math.round(((puzzle.regionMapRleB64 || '').length / 1024) * 10) / 10,
        });
      }

      const finalBundle = {
        version: 2,
        format: 'capy-archive-save',
        exportDate: baseTime,
        snapshots: orderedSnapshots,
        puzzles: orderedPuzzles,
      };

      await window.capyStorage.clearAllSnapshots();
      await window.capyStorage.importSnapshotBundle(JSON.stringify(finalBundle));
      const binaryBytes = await window.capyStorage.exportAllSnapshotsBinary();

      return {
        binaryArray: Array.from(binaryBytes),
        jsonSizeBytes: JSON.stringify(finalBundle).length,
        summary: stats,
      };
    }, SAMPLES);

    const outBuffer = Buffer.from(binaryArray);
    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, outBuffer);

    const totalSizeKb = (outBuffer.byteLength / 1024).toFixed(1);
    const jsonSizeKb = (jsonSizeBytes / 1024).toFixed(1);
    console.log(
      `\nSuccessfully generated compact v2 binary ${OUTPUT_PATH} (${totalSizeKb} KB vs ${jsonSizeKb} KB JSON v2):`
    );
    for (const item of summary) {
      console.log(
        `  - ${item.title} (${item.id}): ${item.dimensions}, ${item.colors} colors, ${item.regions} regions, freeColor=${item.isFreeColor}, RLE=${item.rleKb} KB`
      );
    }
  } finally {
    await browser.close();
  }
}

generateSampleSaves().catch((err) => {
  console.error('Failed to generate sample saves:', err);
  process.exit(1);
});
