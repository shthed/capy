import { chromium } from 'playwright';
import { createServer } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import zlib from 'zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WEB_DIR = path.resolve(__dirname, '..');
const SAMPLE_OUTPUT_PATH = path.resolve(WEB_DIR, 'public/assets/sample_saves.capy');
const DAILY_OUTPUT_PATH = path.resolve(WEB_DIR, 'public/assets/daily_saves.capy');
const MAX_DECOMPRESSED_SAFE_BYTES = 14 * 1024 * 1024; // Safety margin below CapyCodec 16 MB limit
const DETERMINISTIC_EXPORT_DATE_MS = 1767225600000;

const MAX_GENERATOR_CONFIG = {
  algorithm: 'AUTO',
  lineHandling: 'ABSORB_LINES',
  preset: 'HIGH',
  paletteDetail: 'CUSTOM',
  imageType: 'AUTO',
  colorCount: 64,
  minRegionArea: 24,
  maxRegions: 2000,
  resolution: 2048,
  smoothingPasses: 2,
};

const SAMPLES = [
  {
    id: 'sample-capy-forest',
    galleryId: 'capy_forest',
    title: 'Capy Forest',
    assetPath: 'assets/capy_forest.webp',
    isFreeColor: false,
  },
  {
    id: 'sample-capybara',
    galleryId: 'capybara_sample',
    title: 'Capybara',
    assetPath: 'assets/capybara.webp',
    isFreeColor: false,
  },
  {
    id: 'sample-mushrooms',
    galleryId: 'mushrooms',
    title: 'Mushroom Forest',
    assetPath: 'assets/mushrooms.webp',
    isFreeColor: true,
  },
  {
    id: 'sample-snail-guitar',
    galleryId: 'snail_guitar',
    title: 'Snail Guitar',
    assetPath: 'assets/snail_guitar.webp',
    isFreeColor: false,
  },
];

const DAILY_PRESETS = [
  { id: 'balanced-classic', label: 'Max Detail (Auto)', algorithm: 'AUTO' },
  { id: 'cozy-relax', label: 'Max Detail (Auto)', algorithm: 'AUTO' },
  { id: 'crisp-posterized', label: 'Crisp Posterized (Max Detail)', algorithm: 'POSTERIZED' },
  { id: 'stained-mosaic', label: 'Stained Mosaic (Max Detail)', algorithm: 'MOSAIC_CEL' },
  { id: 'detailed-challenge', label: 'Max Detail (Auto)', algorithm: 'AUTO' },
];

async function waitForFinalizedSnapshotCount(page, expectedCount) {
  await page.waitForFunction(
    (count) => {
      const raw = localStorage.getItem('capy_snapshots_v8');
      if (!raw) return false;
      try {
        const list = JSON.parse(raw);
        if (!Array.isArray(list) || list.length < count) return false;
        return list
          .slice(0, count)
          .every((s) => typeof s.fileSizeBytes === 'number' && s.totalCount > 0);
      } catch {
        return false;
      }
    },
    expectedCount,
    { timeout: 120000 }
  );
  await page.waitForSelector('[aria-label="Palette dock"]', { timeout: 120000 });
  // Allow IndexedDB transaction to commit cleanly
  await page.waitForTimeout(250);
}

async function setGeneratorConfigAndReload(page, baseUrl, config) {
  await page.evaluate((cfg) => {
    const raw = localStorage.getItem('capy_user_settings_v8');
    const existing = raw ? JSON.parse(raw) : {};
    localStorage.setItem(
      'capy_user_settings_v8',
      JSON.stringify({ ...existing, generatorConfig: cfg })
    );
  }, config);
  await page.goto(`${baseUrl}/?skipSampleBootstrap=1&skipTutorial=1`, {
    waitUntil: 'networkidle',
  });
  await page.waitForSelector('[aria-label="Palette dock"]', { timeout: 120000 });
}

async function generateSampleViaCreateTab(page, sampleTitle, expectedCount) {
  const settingsBtn = await page.waitForSelector('button[title="Settings and Menu"]');
  await settingsBtn.click();
  await page.waitForTimeout(200);

  const createTabBtn = await page.waitForSelector('button:has(span:text-is("Create"))');
  await createTabBtn.click();
  await page.waitForTimeout(200);

  const card = await page.waitForSelector(`div.group:has-text("${sampleTitle}")`);
  const playBtn = await card.$('button:has-text("Play")');
  if (!playBtn) {
    throw new Error(`Play button not found for sample "${sampleTitle}"`);
  }
  await playBtn.click();

  await waitForFinalizedSnapshotCount(page, expectedCount);
}

function compactPuzzleRegions(puzzle) {
  return puzzle.regions.map((r) => ({
    ...r,
    centroidX: Math.round(r.centroidX * 100) / 100,
    centroidY: Math.round(r.centroidY * 100) / 100,
    maxRadius: Math.round(r.maxRadius * 100) / 100,
  }));
}

function measureBinaryPayloadSize(archiveBytes) {
  if (!archiveBytes || archiveBytes.byteLength < 6) {
    throw new Error(`Invalid .capy binary archive length: ${archiveBytes?.byteLength ?? 0}`);
  }
  const flags = archiveBytes[5];
  const rawPayload = archiveBytes.subarray(6);
  const decompressed = (flags & 0x01) !== 0 ? zlib.gunzipSync(rawPayload) : rawPayload;
  return decompressed.byteLength;
}

async function generateAllSaves() {
  let viteServer = null;
  let baseUrl = process.env.CAPY_GENERATE_URL || '';

  if (!baseUrl) {
    viteServer = await createServer({
      root: WEB_DIR,
      server: { host: '127.0.0.1', port: 0, strictPort: false },
      logLevel: 'error',
    });
    await viteServer.listen();
    const addr = viteServer.httpServer.address();
    const boundPort = typeof addr === 'object' && addr ? addr.port : 3000;
    baseUrl = `http://127.0.0.1:${boundPort}`;
  }

  const executablePath =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);

  console.log(`Launching headless Chromium against ${baseUrl} (Max settings)...`);
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

    // Seed Max generator settings before first cold load so Capy Forest generates at Max settings
    await page.addInitScript((maxCfg) => {
      if (!localStorage.getItem('capy_user_settings_v8')) {
        localStorage.setItem(
          'capy_user_settings_v8',
          JSON.stringify({ generatorConfig: maxCfg })
        );
      }
    }, MAX_GENERATOR_CONFIG);

    // Cache serialized generated puzzles by (assetPath, algorithm, isFreeColor) so identical configs
    // are computed once in headless Chromium and shared cleanly across sample_saves + all 20 dailies.
    const cacheByConfigKey = new Map();

    // 1. Built-in samples (4) at Max settings
    console.log('1/4 Generating built-in "Capy Forest" (Max settings)...');
    await page.goto(`${baseUrl}/?skipSampleBootstrap=1&skipTutorial=1`, {
      waitUntil: 'networkidle',
    });
    await waitForFinalizedSnapshotCount(page, 1);

    for (let i = 1; i < SAMPLES.length; i++) {
      const sample = SAMPLES[i];
      console.log(`${i + 1}/4 Generating built-in "${sample.title}" (Max settings)...`);
      if (sample.isFreeColor) {
        await setGeneratorConfigAndReload(page, baseUrl, {
          ...MAX_GENERATOR_CONFIG,
          algorithm: 'LINE_ART',
          imageType: 'DRAWING',
          isFreeColor: true,
        });
      } else {
        await setGeneratorConfigAndReload(page, baseUrl, MAX_GENERATOR_CONFIG);
      }
      await generateSampleViaCreateTab(page, sample.title, i + 1);
    }

    // Export built-in sample_saves.capy and populate base cache entries
    console.log('Serializing compact v2 binary sample_saves.capy...');
    const sampleExport = await page.evaluate(
      async ({ sampleDefs, exportDate }) => {
        const rawExport = await window.capyStorage.exportAllSnapshots();
        const parsed = JSON.parse(rawExport);

        const orderedSnapshots = [];
        const orderedPuzzles = {};
        const stats = [];

        for (let idx = 0; idx < sampleDefs.length; idx++) {
          const def = sampleDefs[idx];
          const snap = parsed.snapshots.find(
            (s) => s.sampleAssetPath === def.assetPath || s.title === def.title
          );
          if (!snap) throw new Error(`Missing generated snapshot for ${def.title}`);
          const puzzle = parsed.puzzles[snap.id];
          if (!puzzle) throw new Error(`Missing serialized puzzle data for ${def.title}`);

          const compactRegions = puzzle.regions.map((r) => ({
            ...r,
            centroidX: Math.round(r.centroidX * 100) / 100,
            centroidY: Math.round(r.centroidY * 100) / 100,
            maxRadius: Math.round(r.maxRadius * 100) / 100,
          }));
          if (compactRegions.length > 2000) {
            throw new Error(
              `Built-in sample "${def.title}" exceeded 2000 region cap (${compactRegions.length})`
            );
          }

          orderedSnapshots.push({
            id: def.id,
            title: def.title,
            timestamp: exportDate - idx * 1000,
            lastOpened: exportDate - idx * 1000,
            filledCount: 0,
            totalCount: compactRegions.length,
            filledRegionIds: [],
            ...(snap.customPalette ? { customPalette: snap.customPalette } : {}),
            isFreeColor: Boolean(def.isFreeColor || snap.isFreeColor || puzzle.isFreeColor),
            isAutoSample: true,
            sampleAssetPath: def.assetPath,
            sourceRef: { kind: 'sample', uri: def.assetPath },
            zoomScale: 1,
            panOffsetX: 0,
            panOffsetY: 0,
            fileSizeBytes: snap.fileSizeBytes,
          });
          orderedPuzzles[def.id] = { ...puzzle, regions: compactRegions };
          stats.push({
            id: def.id,
            title: def.title,
            dimensions: `${puzzle.width}x${puzzle.height}`,
            colors: puzzle.palette.length,
            regions: compactRegions.length,
            isFreeColor: Boolean(def.isFreeColor || puzzle.isFreeColor),
            rleKb: Math.round(((puzzle.regionMapRleB64 || '').length / 1024) * 10) / 10,
          });
        }

        const finalBundle = {
          version: 2,
          format: 'capy-archive-save',
          exportDate,
          snapshots: orderedSnapshots,
          puzzles: orderedPuzzles,
        };
        const jsonStr = JSON.stringify(finalBundle);
        await window.capyStorage.clearAllSnapshots();
        await window.capyStorage.importSnapshotBundle(jsonStr);
        const binaryBytes = await window.capyStorage.exportAllSnapshotsBinary({ exportDate });

        return {
          binaryArray: Array.from(binaryBytes),
          snapshots: orderedSnapshots,
          puzzles: orderedPuzzles,
          summary: stats,
        };
      },
      { sampleDefs: SAMPLES, exportDate: DETERMINISTIC_EXPORT_DATE_MS }
    );

    const sampleOutBuffer = Buffer.from(sampleExport.binaryArray);
    const sampleDecompressedBytes = measureBinaryPayloadSize(sampleOutBuffer);
    if (sampleDecompressedBytes > MAX_DECOMPRESSED_SAFE_BYTES) {
      throw new Error(
        `sample_saves.capy decompressed payload (${sampleDecompressedBytes} bytes) exceeds safe ceiling (${MAX_DECOMPRESSED_SAFE_BYTES} bytes)`
      );
    }
    fs.mkdirSync(path.dirname(SAMPLE_OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(SAMPLE_OUTPUT_PATH, sampleOutBuffer);
    console.log(
      `\nGenerated ${SAMPLE_OUTPUT_PATH} (${(sampleOutBuffer.byteLength / 1024).toFixed(1)} KB gz, ${(sampleDecompressedBytes / 1024).toFixed(1)} KB unpacked):`
    );
    for (const item of sampleExport.summary) {
      console.log(
        `  - ${item.title} (${item.id}): ${item.dimensions}, ${item.colors} colors, ${item.regions} regions, freeColor=${item.isFreeColor}, RLE=${item.rleKb} KB`
      );
    }

    // Seed cache from the 4 generated sample puzzles
    for (const sample of SAMPLES) {
      const snap = sampleExport.snapshots.find((s) => s.id === sample.id);
      const puzzle = sampleExport.puzzles[sample.id];
      const alg = sample.isFreeColor ? 'LINE_ART' : MAX_GENERATOR_CONFIG.algorithm;
      cacheByConfigKey.set(`${sample.assetPath}::${alg}::${sample.isFreeColor ? '1' : '0'}`, {
        snap,
        puzzle,
      });
    }

    // 2. Pack ALL 20 deterministic daily combinations (4 SAMPLES x 5 DAILY_PRESETS) at Max settings
    const dailySnapshots = [];
    const dailyPuzzles = {};
    const dailyStats = [];
    const plannedCombos = [];

    for (const sample of SAMPLES) {
      for (const preset of DAILY_PRESETS) {
        plannedCombos.push({
          dailyId: `daily-${sample.galleryId}-${preset.id}`,
          sample,
          preset,
        });
      }
    }

    let generatedVariantCount = 0;
    for (let comboIndex = 0; comboIndex < plannedCombos.length; comboIndex++) {
      const { dailyId, sample, preset } = plannedCombos[comboIndex];
      const effectiveAlgorithm = sample.isFreeColor ? 'LINE_ART' : preset.algorithm;
      const cacheKey = `${sample.assetPath}::${effectiveAlgorithm}::${sample.isFreeColor ? '1' : '0'}`;

      let extracted = cacheByConfigKey.get(cacheKey);
      if (!extracted) {
        generatedVariantCount++;
        const cfg = {
          ...MAX_GENERATOR_CONFIG,
          algorithm: effectiveAlgorithm,
          imageType: sample.isFreeColor ? 'DRAWING' : 'AUTO',
          ...(sample.isFreeColor ? { isFreeColor: true } : {}),
        };

        console.log(
          `${comboIndex + 1}/${plannedCombos.length} Generating variant ${generatedVariantCount} "${sample.title}" [${preset.label}] (Max settings)...`
        );

        // Trim storage back down to 1 anchor snapshot so snapshot list stays tiny & fast
        await page.evaluate(async (exportDate) => {
          const snaps = JSON.parse(localStorage.getItem('capy_snapshots_v8') || '[]');
          if (snaps.length > 1) {
            const rawExport = await window.capyStorage.exportAllSnapshots();
            const parsed = JSON.parse(rawExport);
            const keep = parsed.snapshots[0];
            await window.capyStorage.clearAllSnapshots();
            await window.capyStorage.importSnapshotBundle(
              JSON.stringify({
                version: 2,
                format: 'capy-archive-save',
                exportDate,
                snapshots: [keep],
                puzzles: { [keep.id]: parsed.puzzles[keep.id] },
              })
            );
          }
        }, DETERMINISTIC_EXPORT_DATE_MS);

        await setGeneratorConfigAndReload(page, baseUrl, cfg);
        await generateSampleViaCreateTab(page, sample.title, 2);

        extracted = await page.evaluate(async () => {
          const snaps = JSON.parse(localStorage.getItem('capy_snapshots_v8') || '[]');
          const newest = snaps[0];
          const rawExport = await window.capyStorage.exportAllSnapshots();
          const parsed = JSON.parse(rawExport);
          return {
            snap: newest,
            puzzle: parsed.puzzles[newest.id],
          };
        });
        cacheByConfigKey.set(cacheKey, extracted);
      } else {
        console.log(
          `${comboIndex + 1}/${plannedCombos.length} Reusing cached "${sample.title}" [${effectiveAlgorithm}] for ${dailyId}...`
        );
      }

      const compactRegions = compactPuzzleRegions(extracted.puzzle);
      if (compactRegions.length > 2000) {
        throw new Error(
          `Daily puzzle "${dailyId}" exceeded 2000 region cap (${compactRegions.length})`
        );
      }

      const displayLabel = sample.isFreeColor ? 'Free Colour Line Art • Max Detail' : preset.label;
      const snapEntry = {
        id: dailyId,
        title: `${sample.title} (${displayLabel})`,
        timestamp: DETERMINISTIC_EXPORT_DATE_MS - (comboIndex + 1) * 1000,
        lastOpened: DETERMINISTIC_EXPORT_DATE_MS - (comboIndex + 1) * 1000,
        filledCount: 0,
        totalCount: compactRegions.length,
        filledRegionIds: [],
        ...(extracted.snap.customPalette ? { customPalette: extracted.snap.customPalette } : {}),
        isFreeColor: Boolean(
          sample.isFreeColor || extracted.snap.isFreeColor || extracted.puzzle.isFreeColor
        ),
        isAutoSample: false,
        sampleAssetPath: sample.assetPath,
        sourceRef: { kind: 'sample', uri: sample.assetPath },
        zoomScale: 1,
        panOffsetX: 0,
        panOffsetY: 0,
        fileSizeBytes: extracted.snap.fileSizeBytes,
      };
      const puzzleEntry = { ...extracted.puzzle, regions: compactRegions };

      dailySnapshots.push(snapEntry);
      dailyPuzzles[dailyId] = puzzleEntry;
      dailyStats.push({
        id: dailyId,
        dimensions: `${extracted.puzzle.width}x${extracted.puzzle.height}`,
        colors: extracted.puzzle.palette.length,
        regions: compactRegions.length,
        rleKb: Math.round(((extracted.puzzle.regionMapRleB64 || '').length / 1024) * 10) / 10,
      });
    }

    if (dailySnapshots.length !== SAMPLES.length * DAILY_PRESETS.length) {
      throw new Error(
        `Expected all ${SAMPLES.length * DAILY_PRESETS.length} daily combinations, got ${dailySnapshots.length}`
      );
    }

    const finalDailyBundle = {
      version: 2,
      format: 'capy-archive-save',
      exportDate: DETERMINISTIC_EXPORT_DATE_MS,
      snapshots: dailySnapshots,
      puzzles: dailyPuzzles,
    };
    const dailyJsonStr = JSON.stringify(finalDailyBundle);

    const dailyBinaryArray = await page.evaluate(
      async ({ jsonStr, exportDate }) => {
        await window.capyStorage.clearAllSnapshots();
        await window.capyStorage.importSnapshotBundle(jsonStr);
        const binaryBytes = await window.capyStorage.exportAllSnapshotsBinary({ exportDate });
        return Array.from(binaryBytes);
      },
      { jsonStr: dailyJsonStr, exportDate: DETERMINISTIC_EXPORT_DATE_MS }
    );

    const dailyOutBuffer = Buffer.from(dailyBinaryArray);
    const dailyDecompressedBytes = measureBinaryPayloadSize(dailyOutBuffer);
    if (dailyDecompressedBytes > MAX_DECOMPRESSED_SAFE_BYTES) {
      throw new Error(
        `daily_saves.capy decompressed binary payload (${dailyDecompressedBytes} bytes) exceeds safe ceiling (${MAX_DECOMPRESSED_SAFE_BYTES} bytes)`
      );
    }
    fs.mkdirSync(path.dirname(DAILY_OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(DAILY_OUTPUT_PATH, dailyOutBuffer);

    console.log(
      `\nGenerated ${DAILY_OUTPUT_PATH} (${(dailyOutBuffer.byteLength / 1024).toFixed(1)} KB gz, ${(dailyDecompressedBytes / 1024 / 1024).toFixed(2)} MB unpacked, ${dailySnapshots.length}/${SAMPLES.length * DAILY_PRESETS.length} dailies):`
    );
    for (const item of dailyStats) {
      console.log(
        `  - ${item.id}: ${item.dimensions}, ${item.colors} colors, ${item.regions} regions, RLE=${item.rleKb} KB`
      );
    }
  } finally {
    await browser.close();
    if (viteServer) {
      await viteServer.close();
    }
  }
}

generateAllSaves().catch((err) => {
  console.error('Failed to generate sample saves:', err);
  process.exit(1);
});
