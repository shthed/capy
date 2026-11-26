/**
 * [Unit] RegionSegmenter & PuzzleGenerator bit-identical golden regression test.
 *
 * Verifies bit-identical regionMap, borderMap, palette, per-region metadata, and per-region
 * pixel lists across all 4 built-in artworks plus a multi-strategy synthetic artwork.
 *
 * To regenerate fixtures intentionally after an approved algorithm change:
 *   node scripts/tests/unit/region-segmenter-golden.test.mjs --update-golden
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(__dirname, '../../..');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const ARTWORKS_BUNDLE_PATH = path.join(FIXTURES_DIR, 'builtin-artworks-128.bin.gz');
const GOLDEN_JSON_PATH = path.join(FIXTURES_DIR, 'region-segmenter-golden.json');

export const BUILTIN_ARTWORK_DEFS = [
  {
    id: 'capy_forest',
    assetPath: 'public/assets/capy_forest.webp',
    config: {
      algorithm: 'AUTO',
      lineHandling: 'ABSORB_LINES',
      preset: 'MEDIUM',
      paletteDetail: 'AUTO',
      imageType: 'AUTO',
      colorCount: 16,
      minRegionArea: 20,
      maxRegions: 200,
      resolution: 128,
      smoothingPasses: 2,
    },
  },
  {
    id: 'capybara',
    assetPath: 'public/assets/capybara.webp',
    config: {
      algorithm: 'AUTO',
      lineHandling: 'ABSORB_LINES',
      preset: 'MEDIUM',
      paletteDetail: 'AUTO',
      imageType: 'AUTO',
      colorCount: 16,
      minRegionArea: 20,
      maxRegions: 200,
      resolution: 128,
      smoothingPasses: 2,
    },
  },
  {
    id: 'mushrooms',
    assetPath: 'public/assets/mushrooms.webp',
    config: {
      algorithm: 'LINE_ART',
      lineHandling: 'ABSORB_LINES',
      preset: 'HIGH',
      paletteDetail: 'CUSTOM',
      imageType: 'DRAWING',
      colorCount: 20,
      minRegionArea: 12,
      maxRegions: 600,
      resolution: 128,
      smoothingPasses: 2,
      isFreeColor: true,
    },
  },
  {
    id: 'snail_guitar',
    assetPath: 'public/assets/snail_guitar.webp',
    config: {
      algorithm: 'AUTO',
      lineHandling: 'ABSORB_LINES',
      preset: 'MEDIUM',
      paletteDetail: 'AUTO',
      imageType: 'AUTO',
      colorCount: 16,
      minRegionArea: 20,
      maxRegions: 200,
      resolution: 128,
      smoothingPasses: 2,
    },
  },
];

/**
 * Generates a deterministic 192x192 synthetic artwork featuring:
 * - Drawn dark ink strokes separating crisp colored regions
 * - A concave C-shape (exercises Pole of Inaccessibility interior centroid placement)
 * - Smooth gradient band + tiny 1-3px speckles & 1px serpentine slivers (exercises Phase 1 & 1.5 merges)
 * - High-contrast accent dots inside contrasting fields (exercises hue-preserving neighbor scoring)
 */
export function buildSyntheticArtwork(width = 192, height = 192) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  let seed = 0xca91ba7a;
  const nextRand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 240;
      let g = 236;
      let b = 224;

      // Upper-left sky gradient with small noise speckles
      if (x < 96 && y < 96) {
        r = 80 + Math.floor((x / 96) * 70);
        g = 150 + Math.floor((y / 96) * 65);
        b = 225 - Math.floor(((x + y) / 192) * 45);
        if ((nextRand() & 31) === 0) {
          r = 250;
          g = 90;
          b = 60;
        }
      } else if (x >= 96 && y < 96) {
        // Upper-right warm meadow with red berry islands & 1px serpentine filament
        r = 95;
        g = 185;
        b = 90;
        const dx1 = x - 144;
        const dy1 = y - 48;
        if (dx1 * dx1 + dy1 * dy1 <= 18 * 18) {
          r = 228;
          g = 58;
          b = 64;
        }
        // Thin diagonal sliver across the corner
        if (Math.abs((x - 102) - (y - 6)) <= 0 && x >= 104 && x <= 136) {
          r = 245;
          g = 215;
          b = 66;
        }
      } else if (x < 96 && y >= 96) {
        // Lower-left concave C-shape (exercises Pole of Inaccessibility)
        const cx = 48;
        const cy = 144;
        const distSq = (x - cx) * (x - cx) + (y - cy) * (y - cy);
        if (distSq <= 34 * 34 && !(distSq <= 16 * 16) && !(x > cx + 6 && Math.abs(y - cy) < 12)) {
          r = 142;
          g = 76;
          b = 196;
        } else {
          r = 246;
          g = 226;
          b = 178;
        }
      } else {
        // Lower-right geometric checkerboard tiles (triggers Phase 2 maxRegions merges)
        const tx = Math.floor((x - 96) / 8);
        const ty = Math.floor((y - 96) / 8);
        const pat = (tx * 3 + ty * 5) % 4;
        if (pat === 0) {
          r = 45;
          g = 128;
          b = 215;
        } else if (pat === 1) {
          r = 242;
          g = 152;
          b = 48;
        } else if (pat === 2) {
          r = 52;
          g = 178;
          b = 148;
        } else {
          r = 232;
          g = 96;
          b = 148;
        }
      }

      // Dark ink dividing cross and frame borders (2px thick)
      if (
        Math.abs(x - 96) <= 1 ||
        Math.abs(y - 96) <= 1 ||
        x <= 1 ||
        x >= width - 2 ||
        y <= 1 ||
        y >= height - 2
      ) {
        r = 18;
        g = 22;
        b = 28;
      }

      const idx = (y * width + x) * 4;
      rgba[idx] = r;
      rgba[idx + 1] = g;
      rgba[idx + 2] = b;
      rgba[idx + 3] = 255;
    }
  }
  return { width, height, rgba };
}

function sha256Bytes(view) {
  return crypto
    .createHash('sha256')
    .update(new Uint8Array(view.buffer, view.byteOffset, view.byteLength))
    .digest('hex');
}

function hashInt32LE(arr) {
  const buf = Buffer.allocUnsafe(arr.length * 4);
  for (let i = 0; i < arr.length; i++) {
    buf.writeInt32LE(arr[i], i * 4);
  }
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function hashRegionPixels(regions) {
  const hash = crypto.createHash('sha256');
  const header = Buffer.allocUnsafe(8);
  for (let i = 0; i < regions.length; i++) {
    const r = regions[i];
    header.writeInt32LE(r.id, 0);
    header.writeInt32LE(r.pixels.length, 4);
    hash.update(header);
    const pxBuf = Buffer.allocUnsafe(r.pixels.length * 4);
    for (let j = 0; j < r.pixels.length; j++) {
      pxBuf.writeInt32LE(r.pixels[j], j * 4);
    }
    hash.update(pxBuf);
  }
  return hash.digest('hex');
}

export function summarizePuzzleForGolden(puzzle) {
  return {
    width: puzzle.width,
    height: puzzle.height,
    isFreeColor: Boolean(puzzle.isFreeColor),
    regionMapSha256: hashInt32LE(puzzle.regionMap),
    borderMapSha256: sha256Bytes(puzzle.borderMap),
    regionPixelsSha256: hashRegionPixels(puzzle.regions),
    palette: puzzle.palette.map((c) => ({
      id: c.id,
      hex: c.hex,
      isLight: c.isLight,
      argb: c.argb,
      r: c.r,
      g: c.g,
      b: c.b,
    })),
    // Compact metadata tuple: [id, colorId, centroidX, centroidY, area, minX, maxX, minY, maxY, maxRadius]
    regions: puzzle.regions.map((r) => [
      r.id,
      r.colorId,
      r.centroidX,
      r.centroidY,
      r.area,
      r.minX,
      r.maxX,
      r.minY,
      r.maxY,
      r.maxRadius,
    ]),
  };
}

function loadBuiltinArtworksBundle(bundlePath = ARTWORKS_BUNDLE_PATH) {
  const gz = fs.readFileSync(bundlePath);
  const raw = zlib.gunzipSync(gz);
  const metaLen = raw.readUInt32LE(0);
  const meta = JSON.parse(raw.subarray(4, 4 + metaLen).toString('utf8'));
  const pixelPayload = raw.subarray(4 + metaLen);

  const decoded = new Map();
  for (const item of meta.artworks) {
    const rgb = pixelPayload.subarray(item.byteOffset, item.byteOffset + item.byteLength);
    const pixelCount = item.width * item.height;
    assert.equal(rgb.length, pixelCount * 3, `Corrupt RGB byte length for ${item.id}`);
    const rgba = new Uint8ClampedArray(pixelCount * 4);
    for (let i = 0, j = 0; i < pixelCount; i++, j += 3) {
      const o = i * 4;
      rgba[o] = rgb[j];
      rgba[o + 1] = rgb[j + 1];
      rgba[o + 2] = rgb[j + 2];
      rgba[o + 3] = 255;
    }
    decoded.set(item.id, {
      ...item,
      rgba,
    });
  }
  return { meta, decoded };
}

function runAllGoldenCases(AutoPuzzleGenerator, decodedArtworks) {
  const generator = new AutoPuzzleGenerator();
  const cases = {};

  for (const def of BUILTIN_ARTWORK_DEFS) {
    const art = decodedArtworks.get(def.id);
    assert.ok(art, `Missing built-in artwork fixture for "${def.id}"`);
    const puzzle = generator.generateFromRgba(art.rgba, art.width, art.height, def.config);
    cases[def.id] = summarizePuzzleForGolden(puzzle);
  }

  const synth = buildSyntheticArtwork(192, 192);
  const synthStrategies = [
    {
      name: 'synthetic_line_absorb',
      config: {
        algorithm: 'LINE_ART',
        lineHandling: 'ABSORB_LINES',
        preset: 'MEDIUM',
        paletteDetail: 'CUSTOM',
        imageType: 'DRAWING',
        colorCount: 12,
        minRegionArea: 16,
        maxRegions: 60,
        resolution: 192,
        smoothingPasses: 2,
      },
    },
    {
      name: 'synthetic_line_unified',
      config: {
        algorithm: 'LINE_ART',
        lineHandling: 'UNIFIED_BLACK_REGION',
        preset: 'MEDIUM',
        paletteDetail: 'CUSTOM',
        imageType: 'DRAWING',
        colorCount: 12,
        minRegionArea: 16,
        maxRegions: 60,
        resolution: 192,
        smoothingPasses: 2,
      },
    },
    {
      name: 'synthetic_painterly',
      config: {
        algorithm: 'PAINTERLY',
        lineHandling: 'ABSORB_LINES',
        preset: 'MEDIUM',
        paletteDetail: 'CUSTOM',
        imageType: 'PHOTO',
        colorCount: 10,
        minRegionArea: 16,
        maxRegions: 50,
        resolution: 192,
        smoothingPasses: 2,
      },
    },
    {
      name: 'synthetic_mosaic_cel',
      config: {
        algorithm: 'MOSAIC_CEL',
        lineHandling: 'ABSORB_LINES',
        preset: 'MEDIUM',
        paletteDetail: 'CUSTOM',
        imageType: 'PHOTO',
        colorCount: 10,
        minRegionArea: 16,
        maxRegions: 48,
        resolution: 192,
        smoothingPasses: 2,
      },
    },
  ];

  for (const strat of synthStrategies) {
    const puzzle = generator.generateFromRgba(synth.rgba, synth.width, synth.height, strat.config);
    cases[strat.name] = summarizePuzzleForGolden(puzzle);
  }

  return cases;
}

export async function runRegionSegmenterGoldenTests(vite) {
  const generatorMod = await vite.ssrLoadModule('/src/engine/PuzzleGenerator.ts');
  const { AutoPuzzleGenerator } = generatorMod;

  assert.equal(
    fs.existsSync(ARTWORKS_BUNDLE_PATH),
    true,
    `Missing built-in artwork golden fixture: ${ARTWORKS_BUNDLE_PATH}`
  );
  assert.equal(
    fs.existsSync(GOLDEN_JSON_PATH),
    true,
    `Missing golden snapshot JSON: ${GOLDEN_JSON_PATH}`
  );

  const { meta, decoded } = loadBuiltinArtworksBundle(ARTWORKS_BUNDLE_PATH);

  // Verify the 4 built-in .webp assets match the fixture source SHA-256 hashes
  for (const item of meta.artworks) {
    const assetAbs = path.join(WEB_DIR, item.assetPath);
    assert.equal(fs.existsSync(assetAbs), true, `Missing built-in asset: ${item.assetPath}`);
    const actualSha = crypto.createHash('sha256').update(fs.readFileSync(assetAbs)).digest('hex');
    assert.equal(
      actualSha,
      item.webpSha256,
      `Built-in asset ${item.assetPath} changed; regenerate golden fixtures via --update-golden`
    );
  }

  const expected = JSON.parse(fs.readFileSync(GOLDEN_JSON_PATH, 'utf8'));
  const actual = runAllGoldenCases(AutoPuzzleGenerator, decoded);

  const expectedKeys = Object.keys(expected.cases).sort();
  const actualKeys = Object.keys(actual).sort();
  assert.deepEqual(actualKeys, expectedKeys, 'Golden case set mismatch');

  for (const key of expectedKeys) {
    const exp = expected.cases[key];
    const act = actual[key];
    assert.equal(act.width, exp.width, `[${key}] width mismatch`);
    assert.equal(act.height, exp.height, `[${key}] height mismatch`);
    assert.equal(act.isFreeColor, exp.isFreeColor, `[${key}] isFreeColor mismatch`);
    assert.equal(act.regionMapSha256, exp.regionMapSha256, `[${key}] regionMap is not bit-identical`);
    assert.equal(act.borderMapSha256, exp.borderMapSha256, `[${key}] borderMap is not bit-identical`);
    assert.equal(
      act.regionPixelsSha256,
      exp.regionPixelsSha256,
      `[${key}] region.pixels arrays are not bit-identical`
    );
    assert.deepEqual(act.palette, exp.palette, `[${key}] palette mismatch`);
    assert.equal(act.regions.length, exp.regions.length, `[${key}] region count mismatch`);
    assert.deepEqual(act.regions, exp.regions, `[${key}] region metadata mismatch`);
  }
}

async function generateFixturesCli() {
  const { createServer } = await import('vite');
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });

  const maxDim = 128;
  const artworkRecords = [];
  const rgbChunks = [];
  let byteOffset = 0;

  for (const def of BUILTIN_ARTWORK_DEFS) {
    const absPath = path.join(WEB_DIR, def.assetPath);
    const webpSha256 = crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
    const info = JSON.parse(
      execFileSync(
        'python3',
        [
          '-c',
          `
import json, math, sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB')
src_w, src_h = im.size
max_src = max(src_w, src_h)
scale = float(sys.argv[2]) / max_src if max_src > int(sys.argv[2]) else 1.0
tw = max(1, int(math.floor(src_w * scale)))
th = max(1, int(math.floor(src_h * scale)))
im = im.resize((tw, th), Image.Resampling.NEAREST)
print(json.dumps({'width': tw, 'height': th}))
`,
          absPath,
          String(maxDim),
        ],
        { encoding: 'utf8' }
      )
    );
    const rgb = execFileSync(
      'python3',
      [
        '-c',
        `
import math, sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB')
src_w, src_h = im.size
max_src = max(src_w, src_h)
scale = float(sys.argv[2]) / max_src if max_src > int(sys.argv[2]) else 1.0
tw = max(1, int(math.floor(src_w * scale)))
th = max(1, int(math.floor(src_h * scale)))
im = im.resize((tw, th), Image.Resampling.NEAREST)
sys.stdout.buffer.write(im.tobytes())
`,
        absPath,
        String(maxDim),
      ],
      { maxBuffer: 16 * 1024 * 1024 }
    );
    artworkRecords.push({
      id: def.id,
      assetPath: def.assetPath,
      webpSha256,
      width: info.width,
      height: info.height,
      byteOffset,
      byteLength: rgb.length,
    });
    rgbChunks.push(rgb);
    byteOffset += rgb.length;
  }

  const metaJson = Buffer.from(
    JSON.stringify({ version: 1, maxDim, artworks: artworkRecords }),
    'utf8'
  );
  const lenBuf = Buffer.allocUnsafe(4);
  lenBuf.writeUInt32LE(metaJson.length, 0);
  const bundleRaw = Buffer.concat([lenBuf, metaJson, ...rgbChunks]);
  const bundleGz = zlib.gzipSync(bundleRaw, { level: 9 });
  fs.writeFileSync(ARTWORKS_BUNDLE_PATH, bundleGz);

  const vite = await createServer({
    root: WEB_DIR,
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true },
    appType: 'custom',
    logLevel: 'error',
  });
  try {
    const { AutoPuzzleGenerator } = await vite.ssrLoadModule('/src/engine/PuzzleGenerator.ts');
    const { decoded } = loadBuiltinArtworksBundle(ARTWORKS_BUNDLE_PATH);
    const cases = runAllGoldenCases(AutoPuzzleGenerator, decoded);
    fs.writeFileSync(
      GOLDEN_JSON_PATH,
      JSON.stringify({ version: 1, cases }, null, 2) + '\n',
      'utf8'
    );
    console.log(
      `Generated ${path.relative(WEB_DIR, ARTWORKS_BUNDLE_PATH)} (${(bundleGz.length / 1024).toFixed(1)} KB) and ${path.relative(WEB_DIR, GOLDEN_JSON_PATH)} (${Object.keys(cases).length} cases).`
    );
  } finally {
    await vite.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--update-golden')) {
    generateFixturesCli().catch((err) => {
      console.error(err);
      process.exit(1);
    });
  } else {
    import('vite').then(async ({ createServer }) => {
      const vite = await createServer({
        root: WEB_DIR,
        server: { middlewareMode: true, hmr: false, ws: false, watch: null },
        optimizeDeps: { noDiscovery: true },
        appType: 'custom',
        logLevel: 'error',
      });
      try {
        await runRegionSegmenterGoldenTests(vite);
        console.log('RegionSegmenter golden bit-identity tests PASSED.');
      } finally {
        await vite.close();
      }
    });
  }
}
