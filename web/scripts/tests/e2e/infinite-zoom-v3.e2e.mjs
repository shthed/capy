#!/usr/bin/env node
/**
 * Standalone Opaque-Box Playwright E2E Suite for Capy Paint Infinite Zoom v3.
 *
 * Covers Features F1-F16 across 4 structured tiers (51 tests total):
 *   - Tier 1 (20 tests): Isolated happy-path feature coverage across Areas A-D.
 *   - Tier 2 (20 tests): Boundary, error, stress & corner cases across Areas A-D.
 *   - Tier 3 (6 tests):  All 6 pairwise cross-feature combinations.
 *   - Tier 4 (5 tests):  Real-world end-to-end user workflows.
 *
 * Usage:
 *   node web/scripts/tests/e2e/infinite-zoom-v3.e2e.mjs --list
 *   node web/scripts/tests/e2e/infinite-zoom-v3.e2e.mjs --list --json
 *   node web/scripts/tests/e2e/infinite-zoom-v3.e2e.mjs --tier=1
 *   node web/scripts/tests/e2e/infinite-zoom-v3.e2e.mjs --tier=1,2
 *   node web/scripts/tests/e2e/infinite-zoom-v3.e2e.mjs --tier=all
 *   node web/scripts/tests/e2e/infinite-zoom-v3.e2e.mjs --test=T1-A1
 *   CAPY_TEST_URL=http://127.0.0.1:4173 node web/scripts/tests/e2e/infinite-zoom-v3.e2e.mjs --tier=3
 *
 * Strictly opaque-box: interacts only through browser UI, DOM data-testid hooks,
 * Canvas pixels, boundary mocks (Puter SDK, Direct Gemini HTTPS route, Clipboard API,
 * Android WebView bridge), localStorage/IndexedDB persistence, and .capy v2 files.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import {
  createBootedContext,
  getStableBoundingBox,
  isServerListening,
  readTotalRemainingRegions,
  waitForAnimationFrames,
  waitForCondition,
  waitForPuzzleLoaded,
} from './helpers.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WEB_ROOT = path.resolve(__dirname, '../../..');

// ============================================================================
// Constants & Storage Keys (Public Browser Boundary)
// ============================================================================

const SETTINGS_KEY = 'capy_user_settings_v8';
const ACTIVE_SESSION_KEY = 'capy_active_session_v8';
const SNAPSHOTS_KEY = 'capy_snapshots_v8';
const BYOK_KEY_STORAGE_KEY = 'capy_gemini_byok_key_v1';

const MAX_AI_TEMPLATE_BYTES = 900 * 1024;
const TEST_BYOK_KEY = 'AIzaSyTEST_V3_E2E_LOCAL_ONLY_KEY_9876543210';

const VALID_PUTER_RATIO_PAIRS = new Set([
  '1:1',
  '4:3',
  '3:4',
  '3:2',
  '2:3',
  '16:9',
  '9:16',
  '4:5',
  '5:4',
  '21:9',
]);

const VALID_GEMINI_ASPECT_RATIOS = new Set([
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9',
]);

export const TIER_META = {
  1: {
    name: 'Tier 1: Feature Coverage',
    description: 'Isolated happy-path coverage across Areas A-D (F1-F16)',
  },
  2: {
    name: 'Tier 2: Boundary & Corner Cases',
    description: 'Error, stress, layout, guard-rail and corner-case coverage across Areas A-D',
  },
  3: {
    name: 'Tier 3: Cross-Feature Combinations',
    description: 'All 6 pairwise integration combinations across Areas A, B, C, and D',
  },
  4: {
    name: 'Tier 4: Real-World Application Scenarios',
    description: 'Comprehensive multi-step end-to-end player workflows',
  },
};

// ============================================================================
// Pure-Node Zero-Dependency Synthetic PNG Fixtures (node:zlib only)
// ============================================================================

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC32_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(width, height, fillPixelFn, { colorType = 2, compressionLevel = 6 } = {}) {
  const channels = colorType === 6 ? 4 : 3;
  const rowBytes = 1 + width * channels;
  const raw = Buffer.alloc(rowBytes * height);

  for (let y = 0; y < height; y++) {
    const rowOff = y * rowBytes;
    raw[rowOff] = 0; // filter None
    for (let x = 0; x < width; x++) {
      fillPixelFn(x, y, raw, rowOff + 1 + x * channels);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8-bit depth
  ihdr[9] = colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw, { level: compressionLevel });
  const buffer = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  const base64 = buffer.toString('base64');
  return {
    buffer,
    base64,
    dataUrl: `data:image/png;base64,${base64}`,
    width,
    height,
  };
}

function detectImageMimeFromBuffer(buf) {
  if (!buf || buf.length < 12) return 'unknown';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return 'unknown';
}

function expectedExtensionsForMime(mime) {
  if (mime === 'image/jpeg') return ['.jpg', '.jpeg'];
  if (mime === 'image/png') return ['.png'];
  if (mime === 'image/webp') return ['.webp'];
  return [];
}

/**
 * Multi-color geometric mosaic PNG. Avoids neon green (0,255,0) and magenta (255,0,255).
 * Increasing gridSize (e.g. 18 at 504x504) reliably drives 100-250+ clean regions.
 */
function createMultiColorPatternPng(width = 256, height = 256, { gridSize = 6, palette = null } = {}) {
  const colors = palette || [
    [224, 68, 68], // crimson
    [46, 122, 224], // cobalt
    [235, 162, 34], // amber
    [138, 66, 214], // violet
    [28, 158, 152], // teal
    [232, 108, 48], // tangerine
    [214, 72, 138], // rose
    [66, 142, 82], // forest
  ];
  const cellW = width / gridSize;
  const cellH = height / gridSize;
  return encodePng(width, height, (x, y, out, off) => {
    const gx = Math.min(gridSize - 1, Math.floor(x / cellW));
    const gy = Math.min(gridSize - 1, Math.floor(y / cellH));
    // Ensure adjacent 4-neighbors never share the same color
    const idx = (gx + gy * 3) % colors.length;
    const c = colors[idx];
    out[off] = c[0];
    out[off + 1] = c[1];
    out[off + 2] = c[2];
  });
}

/**
 * Colored-ink line art on non-paper pastel fills (all fills L < 190 => brightRatio = 0 < 0.45).
 * Draws 2px-3px strokes in warm brown, deep navy, and burgundy.
 * Adjacent cells intentionally include same-pastel pairs separated ONLY by colored-ink strokes
 * so splitting proves colored-ink dark-ridge detection is active.
 */
function createColoredInkLineArtPng(width = 320, height = 320) {
  // Pastel fills calibrated strictly below L = 190
  const pastels = [
    [135, 192, 225], // Sky (L ~ 179)
    [140, 190, 145], // Sage (L ~ 170)
    [220, 168, 130], // Peach (L ~ 179)
    [172, 152, 215], // Lavender (L ~ 165)
    [205, 185, 135], // Warm Sand (L ~ 185)
  ];
  // 3x3 cell color assignment with intentional same-color pairs across each ink divider
  const cellColorIdx = [
    [0, 0, 1],
    [2, 2, 1],
    [3, 4, 4],
  ];
  const warmBrown = [110, 62, 34]; // L ~ 73
  const deepNavy = [28, 52, 118]; // L ~ 52
  const burgundy = [128, 32, 54]; // L ~ 63

  const x1 = Math.floor(width / 3);
  const x2 = Math.floor((2 * width) / 3);
  const y1 = Math.floor(height / 3);
  const y2 = Math.floor((2 * height) / 3);

  return encodePng(width, height, (x, y, out, off) => {
    let rgb = null;
    if (Math.abs(x - x1) <= 1) {
      rgb = warmBrown;
    } else if (Math.abs(x - x2) <= 1) {
      rgb = deepNavy;
    } else if (Math.abs(y - y1) <= 1) {
      rgb = burgundy;
    } else if (Math.abs(y - y2) <= 1) {
      rgb = warmBrown;
    } else {
      const cx = x < x1 ? 0 : x < x2 ? 1 : 2;
      const cy = y < y1 ? 0 : y < y2 ? 1 : 2;
      rgb = pastels[cellColorIdx[cy][cx]];
    }
    out[off] = rgb[0];
    out[off + 1] = rgb[1];
    out[off + 2] = rgb[2];
  });
}

/**
 * Continuous multi-hue photo gradient containing two large thick solid dark shadow shapes
 * (radius = 40px) to verify thickness suppression prevents false rim-halo slivers.
 */
function createThickDarkPhotoShadowPng(width = 320, height = 320) {
  const c1x = Math.floor(width * 0.3);
  const c1y = Math.floor(height * 0.38);
  const c2x = Math.floor(width * 0.7);
  const c2y = Math.floor(height * 0.64);
  const rSq = 40 * 40;

  return encodePng(width, height, (x, y, out, off) => {
    const d1 = (x - c1x) * (x - c1x) + (y - c1y) * (y - c1y);
    const d2 = (x - c2x) * (x - c2x) + (y - c2y) * (y - c2y);
    if (d1 <= rSq) {
      out[off] = 42;
      out[off + 1] = 36;
      out[off + 2] = 52;
      return;
    }
    if (d2 <= rSq) {
      out[off] = 22;
      out[off + 1] = 28;
      out[off + 2] = 44;
      return;
    }
    const nx = x / width;
    const ny = y / height;
    const wave = Math.sin(nx * Math.PI * 3) * 18 + Math.cos(ny * Math.PI * 2) * 14;
    out[off] = Math.max(60, Math.min(185, Math.round(80 + nx * 95 + wave * 0.5)));
    out[off + 1] = Math.max(55, Math.min(175, Math.round(70 + ny * 90 - wave * 0.4)));
    out[off + 2] = Math.max(70, Math.min(180, Math.round(165 - nx * 70 + ny * 25)));
  });
}

/**
 * Strict neutral grayscale patch grid (R === G === B for every pixel, coloredRatio = 0).
 */
function createGrayscalePatchPng(width = 256, height = 256) {
  const grays = [48, 84, 120, 156, 192, 224];
  const grid = 4;
  const cw = width / grid;
  const ch = height / grid;
  return encodePng(width, height, (x, y, out, off) => {
    const gx = Math.min(grid - 1, Math.floor(x / cw));
    const gy = Math.min(grid - 1, Math.floor(y / ch));
    const v = grays[(gx + gy * 2) % grays.length];
    out[off] = v;
    out[off + 1] = v;
    out[off + 2] = v;
  });
}

/**
 * Deterministic high-entropy noise texture (2048x2048) to stress < 900 KB template compression.
 */
function createHighEntropyTexturePng(width = 2048, height = 2048) {
  let state = 0x12345678;
  return encodePng(
    width,
    height,
    (x, y, out, off) => {
      state ^= (state << 13) >>> 0;
      state ^= state >>> 17;
      state ^= (state << 5) >>> 0;
      const bx = (x >> 6) & 7;
      const by = (y >> 6) & 7;
      out[off] = ((state & 0xff) + bx * 23) & 0xff;
      out[off + 1] = (((state >>> 8) & 0xff) + by * 29) & 0xff;
      out[off + 2] = (((state >>> 16) & 0xff) + (bx + by) * 17) & 0xff;
    },
    { colorType: 2, compressionLevel: 1 }
  );
}

/**
 * Transparent RGBA circular cutout (exterior alpha = 0, interior 6 bold opaque sectors).
 */
function createAlphaCutoutPng(width = 256, height = 256) {
  const cx = width / 2;
  const cy = height / 2;
  const radius = width * 0.38;
  const rSq = radius * radius;
  const sectorColors = [
    [220, 62, 62],
    [48, 120, 220],
    [232, 168, 38],
    [142, 68, 212],
    [32, 160, 148],
    [224, 102, 52],
  ];
  return encodePng(
    width,
    height,
    (x, y, out, off) => {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy > rSq) {
        out[off] = 0;
        out[off + 1] = 0;
        out[off + 2] = 0;
        out[off + 3] = 0;
        return;
      }
      const angle = (Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI);
      const sec = Math.min(sectorColors.length - 1, Math.floor(angle * sectorColors.length));
      const c = sectorColors[sec];
      out[off] = c[0];
      out[off + 1] = c[1];
      out[off + 2] = c[2];
      out[off + 3] = 255;
    },
    { colorType: 6 }
  );
}

// ============================================================================
// CIE76 Lab-Spaced Disjoint Color Banks (for > 64 up to <= 96 Palette Tests)
// ============================================================================

function rgbToLab(r, g, b) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const rl = lin(r);
  const gl = lin(g);
  const bl = lin(b);
  const x = (rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375) / 0.95047;
  const y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.072175;
  const z = (rl * 0.0193339 + gl * 0.119192 + bl * 0.9503041) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function deltaE76(labA, labB) {
  const dL = labA[0] - labB[0];
  const da = labA[1] - labB[1];
  const db = labA[2] - labB[2];
  return Math.sqrt(dL * dL + da * da + db * db);
}

let cachedSpacedColorPool = null;
function buildSpacedColorPool() {
  if (cachedSpacedColorPool) return cachedSpacedColorPool;
  const candidates = [];
  for (let r = 0; r <= 255; r += 15) {
    for (let g = 0; g <= 255; g += 15) {
      for (let b = 0; b <= 255; b += 15) {
        // Avoid magenta guide color (#FF00FF) and neon green test backdrop (#00FF00)
        if (r > 200 && g < 55 && b > 200) continue;
        if (g > 180 && r < 80 && b < 80) continue;
        candidates.push({ rgb: [r, g, b], lab: rgbToLab(r, g, b) });
      }
    }
  }
  // Greedy CIE76 Lab packing strictly > 22.0 (DEFAULT_REUSE_DELTA_E = 22)
  const selected = [];
  for (const cand of candidates) {
    let ok = true;
    for (const prev of selected) {
      if (deltaE76(cand.lab, prev.lab) < 22.1) {
        ok = false;
        break;
      }
    }
    if (ok) selected.push(cand);
  }
  assert.ok(
    selected.length >= 110,
    `Expected >= 110 CIE76-spaced colors (deltaE >= 22.1), got ${selected.length}`
  );
  cachedSpacedColorPool = selected.map((c) => c.rgb);
  return cachedSpacedColorPool;
}

function getDisjointColorBanks() {
  const pool = buildSpacedColorPool();
  return {
    bank0: pool.slice(0, 60),
    bank1: pool.slice(60, 70),
    bank2: pool.slice(70, 80),
    bank3: pool.slice(80, 90),
    bank4: pool.slice(90, 100),
    bank5: pool.slice(100, 110),
  };
}

function createColorBankPng(width, height, colors, cols = 5, rows = 2) {
  assert.ok(Array.isArray(colors) && colors.length > 0, 'createColorBankPng requires non-empty colors');
  const cw = width / cols;
  const ch = height / rows;
  return encodePng(width, height, (x, y, out, off) => {
    const gx = Math.min(cols - 1, Math.floor(x / cw));
    const gy = Math.min(rows - 1, Math.floor(y / ch));
    const idx = (gy * cols + gx) % colors.length;
    const c = colors[idx];
    out[off] = c[0];
    out[off + 1] = c[1];
    out[off + 2] = c[2];
  });
}

// Lazy-cached common PNG fixtures so tests run fast without regenerating identical buffers
let cachedFixtures = null;
function getCommonFixtures() {
  if (cachedFixtures) return cachedFixtures;
  const banks = getDisjointColorBanks();
  cachedFixtures = {
    standardPattern: createMultiColorPatternPng(256, 256, { gridSize: 6 }),
    highDensityPattern: createMultiColorPatternPng(504, 504, { gridSize: 18 }),
    coloredInkArt: createColoredInkLineArtPng(320, 320),
    thickDarkShadowPhoto: createThickDarkPhotoShadowPng(320, 320),
    grayscalePatch: createGrayscalePatchPng(256, 256),
    alphaCutout: createAlphaCutoutPng(256, 256),
    wideRatio2To1: createMultiColorPatternPng(400, 200, { gridSize: 8 }),
    bank0Png: createColorBankPng(600, 360, banks.bank0, 10, 6),
    bank0ReuseSubsetPng: createColorBankPng(256, 256, banks.bank0.slice(0, 10), 5, 2),
    bank1Png: createColorBankPng(256, 256, banks.bank1, 5, 2),
    bank2Png: createColorBankPng(256, 256, banks.bank2, 5, 2),
    bank3Png: createColorBankPng(256, 256, banks.bank3, 5, 2),
    bank4Png: createColorBankPng(256, 256, banks.bank4, 5, 2),
    bank5Png: createColorBankPng(256, 256, banks.bank5, 5, 2),
    banks,
  };
  return cachedFixtures;
}

// ============================================================================
// Boundary Mocks (Puter SDK, Direct Gemini BYOK, Clipboard, Android WebView)
// ============================================================================

async function attachPuterNetworkSpy(page) {
  const externalPuterRequests = [];
  await page.route('**://*.puter.com/**', (route) => {
    externalPuterRequests.push(route.request().url());
    route.abort('blockedbyclient');
  });
  return externalPuterRequests;
}

async function injectPuterMockV3(page, defaultPngDataUrl, { mode = 'ok', responseQueue = [] } = {}) {
  await page.addInitScript(
    ({ defaultDataUrl, initialMode, initialQueue }) => {
      window.__puterCalls = [];
      window.__puterMode = initialMode;
      window.__puterCustomError = null;
      window.__puterResponseQueue = Array.isArray(initialQueue) ? [...initialQueue] : [];
      window.__puterDelayUntilRelease = false;
      window.__puterPendingReleases = [];
      window.__releasePuterPending = () => {
        const list = window.__puterPendingReleases.splice(0);
        for (const fn of list) fn();
      };

      const makeImageEl = (src) =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error('Mock Puter image load failed'));
          img.src = src;
        });

      window.puter = {
        auth: {
          isSignedIn: () => true,
          signIn: async () => true,
        },
        ai: {
          txt2img: async (prompt, options) => {
            const opts = options && typeof options === 'object' ? options : {};
            const recorded = {
              prompt: String(prompt || ''),
              options: {
                model: opts.model,
                ratio:
                  opts.ratio && typeof opts.ratio === 'object'
                    ? { ...opts.ratio }
                    : opts.ratio,
                quality: opts.quality,
                input_image_mime_type: opts.input_image_mime_type,
                input_image: typeof opts.input_image === 'string' ? opts.input_image : '',
              },
            };
            window.__puterCalls.push(recorded);

            if (window.__puterDelayUntilRelease) {
              await new Promise((resolve) => {
                window.__puterPendingReleases.push(resolve);
              });
            }

            const curMode = window.__puterMode;
            if (curMode === 'moderation_flagged') {
              throw {
                status: 400,
                code: 'bad_request',
                error: {
                  status: 400,
                  code: 'bad_request',
                  errorCode: 'moderation_flagged',
                  message: 'Input was rejected by upstream review',
                },
              };
            }
            if (curMode === 'safety_over_cancel') {
              throw {
                error: {
                  errorCode: 'moderation_flagged',
                  message: 'Auth popup closed and cancelled by user',
                },
              };
            }
            if (curMode === 'insufficient_funds') {
              throw {
                error: {
                  code: 'insufficient_funds',
                  message: 'Account top-up required to continue',
                },
              };
            }
            if (curMode === 'bad_request') {
              throw {
                status: 400,
                code: 'bad_request',
                message: 'Invalid dimension parameter',
              };
            }
            if (curMode === 'custom_error' && window.__puterCustomError) {
              throw window.__puterCustomError;
            }

            const nextDataUrl =
              window.__puterResponseQueue.length > 0
                ? window.__puterResponseQueue.shift()
                : defaultDataUrl;
            return makeImageEl(nextDataUrl);
          },
        },
      };
    },
    { defaultDataUrl: defaultPngDataUrl, initialMode: mode, initialQueue: responseQueue }
  );
}

async function installGeminiByokRouteMock(
  page,
  defaultPngBase64,
  { responseBase64Queue = [], delayPromiseRef = null } = {}
) {
  const capturedRequests = [];
  const queue = [...responseBase64Queue];

  await page.route('https://generativelanguage.googleapis.com/v1beta/models/*:generateContent*', async (route) => {
    const req = route.request();
    const url = req.url();
    const headers = req.headers();
    let body = null;
    try {
      body = req.postDataJSON();
    } catch {
      body = null;
    }
    capturedRequests.push({
      url,
      headers,
      body,
    });

    let wasDelayed = false;
    if (delayPromiseRef && delayPromiseRef.current) {
      wasDelayed = true;
      await delayPromiseRef.current;
    }

    if (page.isClosed()) return;
    const nextBase64 = queue.length > 0 ? queue[0] : defaultPngBase64;
    try {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          candidates: [
            {
              finishReason: 'STOP',
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: 'image/png',
                      data: nextBase64,
                    },
                  },
                ],
              },
            },
          ],
        }),
      });
      if (queue.length > 0) queue.shift();
    } catch (err) {
      const msg = String(err?.message || err);
      if (
        wasDelayed &&
        /Target|aborted|closed|disposed|Route is already handled/i.test(msg)
      ) {
        return;
      }
      if (/Target|aborted|closed|disposed|Route is already handled/i.test(msg)) {
        return;
      }
      throw err;
    }
  });

  return capturedRequests;
}

async function injectClipboardMock(page, { mode = 'ok' } = {}) {
  await page.addInitScript((initialMode) => {
    window.__clipboardState = {
      mode: initialMode,
      writeCalls: [],
      writeTextCalls: [],
      rejectedPromiseCount: 0,
      writeAttempts: 0,
    };

    class MockClipboardItem {
      constructor(items) {
        this.__rawItems = items;
        this.types = Object.keys(items);
      }
      async getType(type) {
        return await this.__rawItems[type];
      }
    }
    window.ClipboardItem = MockClipboardItem;

    const mockClipboard = {
      write: async (items) => {
        window.__clipboardState.writeAttempts += 1;
        const curMode = window.__clipboardState.mode;
        if (curMode === 'denied') {
          throw new DOMException('Clipboard write denied by user', 'NotAllowedError');
        }
        const first = Array.isArray(items) ? items[0] : null;
        const rawMap = first && first.__rawItems ? first.__rawItems : {};
        const pngEntry = rawMap['image/png'];
        const wasPromise = Boolean(pngEntry && typeof pngEntry.then === 'function');

        if (curMode === 'reject-promise-once' && wasPromise && window.__clipboardState.rejectedPromiseCount === 0) {
          window.__clipboardState.rejectedPromiseCount += 1;
          throw new TypeError('Promise-valued ClipboardItem is unsupported in this runtime');
        }

        const resolvedBlob = pngEntry ? await pngEntry : null;
        let byteLength = 0;
        let isPngMagic = false;
        let blobType = '';
        if (resolvedBlob) {
          blobType = resolvedBlob.type || '';
          const ab = await resolvedBlob.arrayBuffer();
          const bytes = new Uint8Array(ab);
          byteLength = bytes.byteLength;
          isPngMagic =
            bytes.length >= 8 &&
            bytes[0] === 0x89 &&
            bytes[1] === 0x50 &&
            bytes[2] === 0x4e &&
            bytes[3] === 0x47 &&
            bytes[4] === 0x0d &&
            bytes[5] === 0x0a &&
            bytes[6] === 0x1a &&
            bytes[7] === 0x0a;
        }
        window.__clipboardState.writeCalls.push({
          types: Object.keys(rawMap),
          blobType,
          byteLength,
          isPngMagic,
          wasPromise,
        });
      },
      writeText: async (text) => {
        window.__clipboardState.writeTextCalls.push(String(text || ''));
      },
      read: async () => [],
    };

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: mockClipboard,
    });
  }, mode);
}

async function injectWindowOpenStub(page) {
  await page.addInitScript(() => {
    window.__openedUrls = [];
    window.open = (url) => {
      window.__openedUrls.push(String(url || ''));
      return { closed: false, focus: () => {}, close: () => {} };
    };
  });
}

async function injectAndroidWebViewMock(page) {
  await page.addInitScript(() => {
    window.__androidBridgeCalls = {
      shareImage: [],
      shareFile: [],
      shareTextLink: [],
    };
    window.CapyAndroid = {
      getSafeAreaInsets: () => JSON.stringify({ top: 0, right: 0, bottom: 0, left: 0 }),
      consumePendingSharedImage: () => null,
      consumePendingDeepLink: () => null,
      isPlayGamesConfigured: () => false,
      signInPlayGames: () => false,
      loadBackup: () => null,
      saveBackup: () => true,
      haptic: () => {},
      setModalOpen: () => {},
      shareImage: (title, dataUrl) => {
        window.__androidBridgeCalls.shareImage.push({
          title: String(title || ''),
          dataUrl: String(dataUrl || ''),
        });
        return true;
      },
      shareFile: (filename, mimeType, base64) => {
        window.__androidBridgeCalls.shareFile.push({ filename, mimeType, byteLen: String(base64 || '').length });
        return true;
      },
      shareTextLink: (title, text, url) => {
        window.__androidBridgeCalls.shareTextLink.push({ title, text, url });
        return true;
      },
      saveCloudSnapshot: () => true,
      loadCloudSnapshot: () => null,
      saveCloudBinaryChunk: () => true,
      loadCloudBinaryChunk: () => null,
      requestCloudSnapshotPull: () => false,
      openExternalOAuth: () => false,
      getAppVersion: () => '3.0.0-e2e',
    };
  });
}

async function dispatchSyntheticImagePaste(page, base64Png, mimeType = 'image/png') {
  await page.evaluate(
    ({ b64, mime }) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const file = new File([bytes], 'gemini-result.png', { type: mime });
      const dt = new DataTransfer();
      dt.items.add(file);
      const ev = new ClipboardEvent('paste', {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(ev);
    },
    { b64: base64Png, mime: mimeType }
  );
}

// ============================================================================
// Payload, Storage, Viewport, Canvas & PaletteDock Inspection Helpers
// ============================================================================

function assertValidPuterPayload(call, { expectedModel = null, expectedQuality = null } = {}) {
  assert.ok(call && call.options, 'Expected captured Puter txt2img call');
  const opts = call.options;
  if (expectedModel) {
    assert.equal(opts.model, expectedModel, `Expected Puter model ${expectedModel}, got ${opts.model}`);
  }
  if (expectedQuality) {
    assert.equal(opts.quality, expectedQuality, `Expected Puter quality ${expectedQuality}, got ${opts.quality}`);
  }
  assert.equal(
    typeof opts.ratio,
    'object',
    `Expected Puter ratio to be an object { w, h }, got ${typeof opts.ratio} (${JSON.stringify(opts.ratio)})`
  );
  assert.ok(opts.ratio !== null, 'Expected Puter ratio object to be non-null');
  assert.ok(
    Number.isInteger(opts.ratio.w) && opts.ratio.w >= 1 && opts.ratio.w <= 32,
    `Expected integer ratio.w in [1, 32], got ${opts.ratio.w}`
  );
  assert.ok(
    Number.isInteger(opts.ratio.h) && opts.ratio.h >= 1 && opts.ratio.h <= 32,
    `Expected integer ratio.h in [1, 32], got ${opts.ratio.h}`
  );
  const ratioStr = `${opts.ratio.w}:${opts.ratio.h}`;
  assert.ok(
    VALID_PUTER_RATIO_PAIRS.has(ratioStr),
    `Expected Puter ratio ${ratioStr} to be a valid aspect ratio pair`
  );

  assert.ok(
    typeof opts.input_image === 'string' && opts.input_image.length > 0,
    'Expected non-empty base64 input_image in Puter payload'
  );
  const decoded = Buffer.from(opts.input_image, 'base64');
  assert.ok(
    decoded.byteLength > 0 && decoded.byteLength <= MAX_AI_TEMPLATE_BYTES,
    `Expected compact Puter input_image <= ${MAX_AI_TEMPLATE_BYTES} bytes, got ${decoded.byteLength}`
  );
  const detectedMime = detectImageMimeFromBuffer(decoded);
  assert.ok(
    ['image/jpeg', 'image/png', 'image/webp'].includes(detectedMime),
    `Expected valid image magic bytes in Puter input_image, detected ${detectedMime}`
  );
  assert.equal(
    opts.input_image_mime_type,
    detectedMime,
    `Expected input_image_mime_type (${opts.input_image_mime_type}) to match decoded magic bytes (${detectedMime})`
  );
  return { decodedBytes: decoded.byteLength, detectedMime, ratioStr };
}

async function readActiveSession(page) {
  return page.evaluate((key) => {
    try {
      return JSON.parse(localStorage.getItem(key) || '{}');
    } catch {
      return {};
    }
  }, ACTIVE_SESSION_KEY);
}

async function readSnapshots(page) {
  return page.evaluate((key) => {
    try {
      return JSON.parse(localStorage.getItem(key) || '[]');
    } catch {
      return [];
    }
  }, SNAPSHOTS_KEY);
}

async function readSettings(page) {
  return page.evaluate((key) => {
    try {
      return JSON.parse(localStorage.getItem(key) || '{}');
    } catch {
      return {};
    }
  }, SETTINGS_KEY);
}

async function readByokKey(page) {
  return page.evaluate((key) => localStorage.getItem(key), BYOK_KEY_STORAGE_KEY);
}

async function readViewportState(page) {
  const sess = await readActiveSession(page);
  return {
    zoomScale: typeof sess.zoomScale === 'number' && Number.isFinite(sess.zoomScale) ? sess.zoomScale : 1,
    panOffsetX: typeof sess.panOffsetX === 'number' && Number.isFinite(sess.panOffsetX) ? sess.panOffsetX : 0,
    panOffsetY: typeof sess.panOffsetY === 'number' && Number.isFinite(sess.panOffsetY) ? sess.panOffsetY : 0,
  };
}

/**
 * Waits via waitForCondition until persisted viewport satisfies optional predicate
 * AND stabilizes across consecutive polls (covering the 350ms viewport persistence debounce).
 */
async function waitForViewportSettled(page, predicate = null, timeoutMs = 5000) {
  let prev = null;
  let stableCount = 0;
  let latest = null;
  const ok = await waitForCondition(
    async () => {
      const vp = await readViewportState(page);
      latest = vp;
      if (predicate && !predicate(vp)) {
        prev = vp;
        stableCount = 0;
        return false;
      }
      if (
        prev &&
        Math.abs(vp.zoomScale - prev.zoomScale) < 0.01 &&
        Math.abs(vp.panOffsetX - prev.panOffsetX) < 1.0 &&
        Math.abs(vp.panOffsetY - prev.panOffsetY) < 1.0
      ) {
        stableCount += 1;
      } else {
        stableCount = 0;
      }
      prev = vp;
      return stableCount >= 6;
    },
    timeoutMs,
    100
  );
  assert.equal(
    ok,
    true,
    `Viewport did not settle within ${timeoutMs}ms (last=${JSON.stringify(latest)})`
  );
  return latest;
}

async function readPuzzleSummary(page, snapId) {
  return page.evaluate(async (id) => {
    if (!window.capyStorage) return null;
    const puzzle = await window.capyStorage.loadPuzzleData(id);
    if (!puzzle) return null;
    const nestedLayers = Array.isArray(puzzle.nestedLayers) ? puzzle.nestedLayers : [];
    const allRegionIds = [];
    for (const r of puzzle.regions || []) allRegionIds.push(r.id);
    for (const layer of nestedLayers) {
      for (const r of layer.regions || []) allRegionIds.push(r.id);
    }

    let rootExteriorZero = 0;
    let rootPositive = 0;
    if (puzzle.regionMap) {
      for (let i = 0; i < puzzle.regionMap.length; i++) {
        if (puzzle.regionMap[i] === 0) rootExteriorZero++;
        else rootPositive++;
      }
    }

    return {
      width: puzzle.width,
      height: puzzle.height,
      isFreeColor: Boolean(puzzle.isFreeColor),
      paletteCount: (puzzle.palette || []).length,
      paletteIds: (puzzle.palette || []).map((c) => c.id),
      paletteHexes: (puzzle.palette || []).map((c) => c.hex),
      rootRegionCount: (puzzle.regions || []).length,
      rootExteriorZero,
      rootPositive,
      rootUniqueColorIds: Array.from(new Set((puzzle.regions || []).map((r) => r.colorId))),
      nestedLayers: nestedLayers.map((l) => {
        let extZero = 0;
        let intPos = 0;
        const validIds = new Set((l.regions || []).map((r) => r.id));
        let invalidMapPixels = 0;
        if (l.regionMap) {
          for (let i = 0; i < l.regionMap.length; i++) {
            const v = l.regionMap[i];
            if (v === 0) extZero++;
            else {
              intPos++;
              if (!validIds.has(v)) invalidMapPixels++;
            }
          }
        }
        const areas = (l.regions || []).map((r) => r.area);
        return {
          layerId: l.layerId,
          depth: l.depth,
          width: l.width,
          height: l.height,
          regionCount: (l.regions || []).length,
          worldBounds: { ...l.worldBounds },
          imageBlobKey: l.imageBlobKey,
          providerUsed: l.providerUsed,
          modelUsed: l.modelUsed,
          uniqueColorIds: Array.from(new Set((l.regions || []).map((r) => r.colorId))),
          exteriorZeroCount: extZero,
          interiorPositiveCount: intPos,
          invalidMapPixels,
          minRegionArea: areas.length > 0 ? Math.min(...areas) : 0,
          maxRegionArea: areas.length > 0 ? Math.max(...areas) : 0,
        };
      }),
      maxZoomDepth: typeof puzzle.maxZoomDepth === 'number' ? puzzle.maxZoomDepth : 0,
      totalRegionCount: allRegionIds.length,
      allRegionIds,
    };
  }, snapId);
}

async function hasImageBlobInIdb(page, blobKey) {
  return page.evaluate(async (key) => {
    if (!window.capyStorage || !key) return false;
    const blob = await window.capyStorage.loadImageBlob(key);
    return Boolean(blob && blob.size > 0);
  }, blobKey);
}

async function listLayerImageBlobKeysInIdb(page, snapId) {
  return page.evaluate(async (id) => {
    const prefix = `layer_${id}_`;
    const dbNames =
      typeof indexedDB.databases === 'function'
        ? (await indexedDB.databases()).map((d) => d.name).filter(Boolean)
        : [];
    const targetName =
      dbNames.find((n) => n === 'capy_game_storage_v8' || n.startsWith('capy_game_storage_v8_')) ||
      'capy_game_storage_v8';
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(targetName);
      req.onerror = () => reject(req.error || new Error(`Failed to open IDB ${targetName}`));
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('images')) {
          db.close();
          resolve([]);
          return;
        }
        const tx = db.transaction('images', 'readonly');
        const store = tx.objectStore('images');
        const keysReq = store.getAllKeys();
        keysReq.onerror = () => {
          db.close();
          reject(keysReq.error || new Error('Failed to read IDB image keys'));
        };
        keysReq.onsuccess = () => {
          const keys = (keysReq.result || [])
            .map((k) => String(k))
            .filter((k) => k.startsWith(prefix))
            .sort();
          db.close();
          resolve(keys);
        };
      };
    });
  }, snapId);
}

async function readPaletteDockOrder(page) {
  return page.evaluate(() => {
    const tray = document.querySelector('[data-testid="palette-dock-tray"]');
    if (!tray) {
      return { swatches: [], hasDivider: false, dividerIndex: -1, floatedCount: 0 };
    }
    const swatches = [];
    let hasDivider = false;
    let dividerIndex = -1;

    const nodes = tray.querySelectorAll(
      'button[data-testid^="palette-swatch-"], [data-testid="palette-nested-divider"]'
    );
    for (const node of nodes) {
      const tid = node.getAttribute('data-testid') || '';
      if (tid === 'palette-nested-divider') {
        hasDivider = true;
        dividerIndex = swatches.length;
        continue;
      }
      const dispNum = Number.parseInt(tid.replace('palette-swatch-', ''), 10);
      const isNestedFloated = node.getAttribute('data-nested-floated') === 'true';
      const isActive = node.getAttribute('aria-pressed') === 'true';
      const title = node.getAttribute('title') || '';
      const ariaLabel = node.getAttribute('aria-label') || '';
      const styleBg = window.getComputedStyle(node).backgroundColor;
      swatches.push({
        testId: tid,
        displayNumber: dispNum,
        isNestedFloated,
        isActive,
        title,
        ariaLabel,
        styleBg,
      });
    }
    const floatedCount = swatches.filter((s) => s.isNestedFloated).length;
    return { swatches, hasDivider, dividerIndex, floatedCount };
  });
}

// ============================================================================
// UI Interaction Helpers (100% Opaque-Box DOM Controls)
// ============================================================================

async function dismissFeatureOfferIfVisible(page) {
  const banner = page.getByTestId('feature-offer-banner');
  const dismissBtn = page.getByTestId('feature-offer-dismiss-btn');
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const visible = await banner.first().isVisible().catch(() => false);
    if (!visible) break;
    const prevOfferId = await banner
      .first()
      .getAttribute('data-offer-id', { timeout: 1000 })
      .catch(() => null);
    await dismissBtn.first().waitFor({ state: 'visible', timeout: 3000 });
    await dismissBtn.first().click();
    const progressed = await waitForCondition(async () => {
      const stillVisible = await banner.first().isVisible().catch(() => false);
      if (!stillVisible) return true;
      const nextOfferId = await banner
        .first()
        .getAttribute('data-offer-id', { timeout: 250 })
        .catch(() => null);
      return nextOfferId !== prevOfferId;
    }, 3000);
    assert.equal(
      progressed,
      true,
      `Expected feature-offer-banner (${prevOfferId ?? 'unknown'}) to hide or advance after clicking dismiss`
    );
    await waitForAnimationFrames(page, 1);
  }
  await banner.waitFor({ state: 'hidden', timeout: 3000 });
  await waitForAnimationFrames(page, 1);
}

async function openSettingsTab(page, tab) {
  const tabs = page.getByTestId('settings-modal-tabs');
  if ((await tabs.count()) === 0 || !(await tabs.isVisible())) {
    await dismissFeatureOfferIfVisible(page);
    await page.getByTestId('topbar-settings-btn').click();
    await tabs.waitFor({ state: 'visible', timeout: 5000 });
  }
  const tabBtn = page.getByTestId(`settings-tab-${tab}`);
  await tabBtn.waitFor({ state: 'visible', timeout: 5000 });
  await tabBtn.click();
  const selected = await waitForCondition(
    async () => (await tabBtn.getAttribute('aria-selected')) === 'true',
    3000
  );
  assert.equal(selected, true, `Expected settings tab ${tab} to become active`);
  await waitForAnimationFrames(page, 2);
}

async function closeSettingsModal(page) {
  const closeBtn = page.getByTestId('settings-modal-close');
  if ((await closeBtn.count()) > 0 && (await closeBtn.isVisible())) {
    await closeBtn.click();
    await page.getByTestId('settings-modal-tabs').waitFor({ state: 'hidden', timeout: 5000 });
    await waitForAnimationFrames(page, 2);
  }
}

async function setSwitchState(page, testId, desiredOn) {
  const sw = page.getByTestId(testId);
  await sw.waitFor({ state: 'visible', timeout: 5000 });
  const isOn = (await sw.getAttribute('aria-checked')) === 'true';
  if (isOn !== desiredOn) {
    await sw.click();
    const ok = await waitForCondition(
      async () => (await sw.getAttribute('aria-checked')) === String(desiredOn),
      3000
    );
    assert.equal(ok, true, `Switch ${testId} did not toggle to ${desiredOn}`);
  }
}

async function selectSettingsPaletteSort(page, label) {
  await openSettingsTab(page, 'settings');
  const uiSec = page.getByTestId('settings-section-ui');
  await uiSec.waitFor({ state: 'visible', timeout: 5000 });
  await uiSec.getByRole('button', { name: label, exact: true }).click();
  await waitForAnimationFrames(page, 2);
  await closeSettingsModal(page);
}

async function configureInfiniteZoomProvider(page, { provider, model, resolution, byokKey } = {}) {
  await openSettingsTab(page, 'create');
  if (provider !== undefined) {
    const provSel = page.getByTestId('iz-provider-select');
    await provSel.waitFor({ state: 'visible', timeout: 5000 });
    await provSel.selectOption(provider);
    await waitForAnimationFrames(page, 2);
  }
  if (model !== undefined) {
    const modelSel = page.getByTestId('iz-model-select');
    await modelSel.waitFor({ state: 'visible', timeout: 5000 });
    await modelSel.selectOption(model);
    await waitForAnimationFrames(page, 2);
  }
  if (resolution !== undefined) {
    const resSel = page.getByTestId('iz-resolution-select');
    await resSel.waitFor({ state: 'visible', timeout: 5000 });
    await resSel.selectOption(resolution);
    await waitForAnimationFrames(page, 2);
  }
  if (byokKey !== undefined) {
    if (byokKey === null) {
      const clearBtn = page.getByTestId('iz-byok-clear-btn');
      if ((await clearBtn.count()) > 0 && (await clearBtn.isEnabled())) {
        await clearBtn.click();
        await page.waitForFunction((k) => !localStorage.getItem(k), BYOK_KEY_STORAGE_KEY, {
          timeout: 3000,
        });
      }
    } else {
      const keyInput = page.getByTestId('iz-byok-key-input');
      await keyInput.waitFor({ state: 'visible', timeout: 5000 });
      await keyInput.fill(byokKey);
      await page.getByTestId('iz-byok-save-btn').click();
      await page.waitForFunction(
        ({ k, expected }) => localStorage.getItem(k) === expected,
        { k: BYOK_KEY_STORAGE_KEY, expected: byokKey },
        { timeout: 3000 }
      );
    }
  }
  await closeSettingsModal(page);
}

async function uploadTestPhoto(page, { name = 'test-photo.png', mimeType = 'image/png', buffer }) {
  const prevSnapId = (await readActiveSession(page)).activeSnapshotId || null;
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles({
    name,
    mimeType,
    buffer,
  });
  const switched = await waitForCondition(async () => {
    const sess = await readActiveSession(page);
    return Boolean(sess.activeSnapshotId && sess.activeSnapshotId !== prevSnapId);
  }, 25000);
  await waitForPuzzleLoaded(page);
  await dismissFeatureOfferIfVisible(page);
  const sess = await readActiveSession(page);
  assert.ok(sess.activeSnapshotId, 'Expected activeSnapshotId after photo upload');
  if (!switched) {
    // Even if snapshot ID was reused, ensure puzzle loaded cleanly
    const summary = await readPuzzleSummary(page, sess.activeSnapshotId);
    assert.ok(summary && summary.rootRegionCount > 0, 'Uploaded photo must produce regions');
  }
  return sess.activeSnapshotId;
}

async function openInfiniteZoomPopover(page) {
  await dismissFeatureOfferIfVisible(page);
  const menuBtn = page.getByTestId('infinite-zoom-menu-btn');
  await menuBtn.waitFor({ state: 'visible', timeout: 8000 });
  await menuBtn.click();
  const dialog = page.locator('[role="dialog"][aria-label="Infinite Zoom Controls"]');
  await dialog.waitFor({ state: 'visible', timeout: 5000 });
  await waitForAnimationFrames(page, 2);
  return dialog;
}

async function enterZoomInSelection(page) {
  await openInfiniteZoomPopover(page);
  await page.getByTestId('toolbar-infinite-zoom-in-btn').click();
  const bar = page.getByTestId('region-selection-bar');
  await bar.waitFor({ state: 'visible', timeout: 5000 });
  await waitForAnimationFrames(page, 2);
  return bar;
}

async function setExtendSideState(page, testId, desiredOn) {
  const loc = page.getByTestId(testId);
  await loc.waitFor({ state: 'visible', timeout: 4000 });
  const isPressed = (await loc.getAttribute('aria-pressed')) === 'true';
  if (isPressed !== desiredOn) {
    await loc.click();
    const ok = await waitForCondition(
      async () => (await loc.getAttribute('aria-pressed')) === String(desiredOn),
      3000
    );
    assert.equal(ok, true, `Expected ${testId} aria-pressed to become ${desiredOn}`);
  }
}

async function triggerZoomOut(page, sides = { top: false, bottom: true, left: false, right: true }, { prompt = '' } = {}) {
  await openInfiniteZoomPopover(page);
  const expandBtn = page.getByTestId('toolbar-infinite-zoom-out-btn');
  if ((await expandBtn.getAttribute('aria-expanded')) !== 'true') {
    await expandBtn.click();
    await page.getByTestId('extend-side-top').waitFor({ state: 'visible', timeout: 4000 });
  }
  await setExtendSideState(page, 'extend-side-top', Boolean(sides.top));
  await setExtendSideState(page, 'extend-side-bottom', Boolean(sides.bottom));
  await setExtendSideState(page, 'extend-side-left', Boolean(sides.left));
  await setExtendSideState(page, 'extend-side-right', Boolean(sides.right));
  if (prompt) {
    await page.getByTestId('infinite-zoom-out-prompt-input').fill(prompt);
  }
  const confirmBtn = page.getByTestId('toolbar-infinite-zoom-out-confirm-btn');
  await confirmBtn.waitFor({ state: 'visible', timeout: 3000 });
  assert.equal(await confirmBtn.isEnabled(), true, 'Expected Extend confirm button to be enabled');
  await confirmBtn.click();
}

// ============================================================================
// Unified Canvas Region Coordinate Targeting & Pixel Probes
// ============================================================================

async function findUnifiedRegionTargets(page, snapId) {
  return page.evaluate(
    async ({ targetSnapId, sessionKey }) => {
      const canvas = document.querySelector('[data-testid="puzzle-canvas"]');
      if (!canvas || !window.capyStorage) return null;
      const puzzle = await window.capyStorage.loadPuzzleData(targetSnapId);
      if (!puzzle || !puzzle.regions || !puzzle.regionMap) return null;

      const rect = canvas.getBoundingClientRect();
      const session = JSON.parse(localStorage.getItem(sessionKey) || '{}');
      const zoomScale =
        typeof session.zoomScale === 'number' && session.zoomScale > 0 ? session.zoomScale : 1;
      const panOffsetX = typeof session.panOffsetX === 'number' ? session.panOffsetX : 0;
      const panOffsetY = typeof session.panOffsetY === 'number' ? session.panOffsetY : 0;
      const filledSet = new Set(Array.isArray(session.filledRegionIds) ? session.filledRegionIds : []);

      const pw = puzzle.width;
      const ph = puzzle.height;
      const w = rect.width;
      const h = rect.height;
      const baseScale = Math.min(w / pw, h / ph) * 0.92;
      const baseOffsetX = (w - pw * baseScale) / 2;
      const baseOffsetY = (h - ph * baseScale) / 2;
      const effScale = zoomScale * baseScale;

      const headerEl = document.querySelector('header');
      const headerBottom = headerEl ? headerEl.getBoundingClientRect().bottom : rect.top + 64;
      const safeMinX = rect.left + Math.min(28, w * 0.04);
      const safeMaxX = rect.right - Math.min(96, w * 0.22);
      const safeMinY =
        h <= 500
          ? Math.max(rect.top + 46, headerBottom + 6)
          : Math.max(rect.top + 72, headerBottom + 16);
      const barEl = document.querySelector('[data-testid="region-selection-bar"]');
      const barRect = barEl ? barEl.getBoundingClientRect() : null;
      const hasVisibleBar = Boolean(barRect && barRect.width > 0 && barRect.height > 0);
      const reserveBarHeadroom = hasVisibleBar && barRect.top - safeMinY > 120;
      const safeMaxY =
        h <= 500
          ? rect.bottom - 70
          : !hasVisibleBar && w >= 640
            ? rect.bottom - Math.min(280, Math.round(h * 0.36))
            : rect.bottom - Math.min(220, h * 0.34);

      const worldToScreen = (wx, wy) => ({
        clientX: rect.left + panOffsetX + baseOffsetX + wx * effScale,
        clientY: rect.top + panOffsetY + baseOffsetY + wy * effScale,
      });

      const isSafe = (pt) => {
        if (
          pt.clientX < safeMinX ||
          pt.clientX > safeMaxX ||
          pt.clientY < safeMinY ||
          pt.clientY > safeMaxY
        ) {
          return false;
        }
        if (
          reserveBarHeadroom &&
          pt.clientX >= barRect.left - 8 &&
          pt.clientX <= barRect.right + 8 &&
          pt.clientY >= barRect.top - 52 &&
          pt.clientY <= barRect.bottom + 8
        ) {
          return false;
        }
        return document.elementFromPoint(pt.clientX, pt.clientY) === canvas;
      };

      const nestedLayers = Array.isArray(puzzle.nestedLayers) ? puzzle.nestedLayers : [];
      const sortedLayersDeepestFirst = [...nestedLayers].sort((a, b) => b.depth - a.depth);

      const sampleLayerAtWorld = (layer, wx, wy) => {
        const wb = layer.worldBounds;
        if (!wb || wb.width <= 0 || wb.height <= 0) return 0;
        const nx = wx / pw;
        const ny = wy / ph;
        if (nx < wb.x || nx >= wb.x + wb.width || ny < wb.y || ny >= wb.y + wb.height) {
          return 0;
        }
        const lx = Math.floor(((nx - wb.x) / wb.width) * layer.width);
        const ly = Math.floor(((ny - wb.y) / wb.height) * layer.height);
        if (lx < 0 || lx >= layer.width || ly < 0 || ly >= layer.height) return 0;
        return layer.regionMap[ly * layer.width + lx] || 0;
      };

      const isOccludedByDeeperLayer = (minDepthExclusive, wx, wy) => {
        for (const layer of sortedLayersDeepestFirst) {
          if (layer.depth <= minDepthExclusive) break;
          if (sampleLayerAtWorld(layer, wx, wy) > 0) return true;
        }
        return false;
      };

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

      const findSafeRootHit = (r, rm) => {
        const tryPx = (px, py) => {
          if (px < 0 || px >= pw || py < 0 || py >= ph) return null;
          if (rm[py * pw + px] !== r.id) return null;
          const wx = px + 0.5;
          const wy = py + 0.5;
          if (isOccludedByDeeperLayer(0, wx, wy)) return null;
          const s = worldToScreen(wx, wy);
          if (!isSafe(s)) return null;
          return { px, py, ...s };
        };
        const cx = Math.max(0, Math.min(pw - 1, Math.round(r.centroidX)));
        const cy = Math.max(0, Math.min(ph - 1, Math.round(r.centroidY)));
        const direct = tryPx(cx, cy);
        if (direct) return direct;
        if (!r.pixels || r.pixels.length === 0) return null;
        const step = Math.max(1, Math.floor(r.pixels.length / 60));
        for (let i = Math.floor(r.pixels.length / 2); i < r.pixels.length; i += step) {
          const idx = r.pixels[i];
          const hit = tryPx(idx % pw, Math.floor(idx / pw));
          if (hit) return hit;
        }
        for (let i = 0; i < r.pixels.length; i += step) {
          const idx = r.pixels[i];
          const hit = tryPx(idx % pw, Math.floor(idx / pw));
          if (hit) return hit;
        }
        return null;
      };

      const findSafeNestedHit = (layer, r) => {
        const wb = layer.worldBounds;
        const lw = layer.width;
        const lh = layer.height;
        const rm = layer.regionMap;
        const tryLocal = (lx, ly) => {
          if (lx < 0 || lx >= lw || ly < 0 || ly >= lh) return null;
          if (rm[ly * lw + lx] !== r.id) return null;
          const wx = (wb.x + ((lx + 0.5) / lw) * wb.width) * pw;
          const wy = (wb.y + ((ly + 0.5) / lh) * wb.height) * ph;
          if (isOccludedByDeeperLayer(layer.depth, wx, wy)) return null;
          const s = worldToScreen(wx, wy);
          if (!isSafe(s)) return null;
          return { lx, ly, ...s };
        };
        const cx = Math.max(0, Math.min(lw - 1, Math.round(r.centroidX)));
        const cy = Math.max(0, Math.min(lh - 1, Math.round(r.centroidY)));
        const direct = tryLocal(cx, cy);
        if (direct) return direct;
        if (!r.pixels || r.pixels.length === 0) return null;
        const step = Math.max(1, Math.floor(r.pixels.length / 60));
        for (let i = Math.floor(r.pixels.length / 2); i < r.pixels.length; i += step) {
          const idx = r.pixels[i];
          const hit = tryLocal(idx % lw, Math.floor(idx / lw));
          if (hit) return hit;
        }
        for (let i = 0; i < r.pixels.length; i += step) {
          const idx = r.pixels[i];
          const hit = tryLocal(idx % lw, Math.floor(idx / lw));
          if (hit) return hit;
        }
        return null;
      };

      const rm = puzzle.regionMap;
      const adj = buildAdjacency(rm, pw, ph);
      const rootClickable = [];
      const rootClickableById = new Map();
      for (const r of puzzle.regions) {
        const hit = findSafeRootHit(r, rm);
        if (!hit) continue;
        const info = {
          id: r.id,
          layerId: null,
          depth: 0,
          colorId: r.colorId,
          area: r.area,
          filled: filledSet.has(r.id),
          clientX: hit.clientX,
          clientY: hit.clientY,
        };
        rootClickable.push(info);
        rootClickableById.set(r.id, info);
      }

      const screenDist = (p1, p2) => Math.hypot(p1.clientX - p2.clientX, p1.clientY - p2.clientY);
      const MIN_TAP_SEP_PX = 48;
      const byAreaDesc = [...rootClickable].sort((x, y) => y.area - x.area);
      const byAreaAsc = [...rootClickable].sort((x, y) => x.area - y.area);

      let largePair = null;
      outer: for (const a of byAreaDesc) {
        const neighbors = adj.get(a.id);
        if (!neighbors || neighbors.size === 0) continue;
        for (const nbId of neighbors) {
          const b = rootClickableById.get(nbId);
          if (!b || screenDist(a, b) < MIN_TAP_SEP_PX) continue;
          const nonAdj = byAreaDesc.find((cand) => {
            if (cand.id === a.id || cand.id === b.id) return false;
            if (screenDist(cand, a) < MIN_TAP_SEP_PX || screenDist(cand, b) < MIN_TAP_SEP_PX) {
              return false;
            }
            const nbA = adj.get(a.id);
            const nbB = adj.get(b.id);
            return !(nbA && nbA.has(cand.id)) && !(nbB && nbB.has(cand.id));
          });
          if (!nonAdj) continue;
          largePair = { a, b, nonAdjacent: nonAdj };
          break outer;
        }
      }

      const unfilledNestedTargets = [];
      for (const layer of sortedLayersDeepestFirst) {
        const layerRegionsDesc = [...(layer.regions || [])].sort((x, y) => y.area - x.area);
        for (const r of layerRegionsDesc) {
          if (filledSet.has(r.id)) continue;
          const hit = findSafeNestedHit(layer, r);
          if (!hit) continue;
          unfilledNestedTargets.push({
            id: r.id,
            layerId: layer.layerId,
            depth: layer.depth,
            colorId: r.colorId,
            area: r.area,
            worldBounds: { ...layer.worldBounds },
            clientX: hit.clientX,
            clientY: hit.clientY,
          });
          if (unfilledNestedTargets.length >= 16) break;
        }
      }

      const unfilledRootTargets = byAreaDesc.filter((r) => !r.filled);
      const smallestRootTarget = byAreaAsc.find((r) => !r.filled) || byAreaAsc[0] || null;

      return {
        width: pw,
        height: ph,
        largePair,
        smallestRootTarget,
        allRootTargets: byAreaDesc,
        unfilledRootTargets,
        unfilledNestedTargets,
      };
    },
    { targetSnapId: snapId, sessionKey: ACTIVE_SESSION_KEY }
  );
}

function pickWellSeparatedTargets(candidates, count, excludeIds = new Set(), minSepPx = 48) {
  const chosen = [];
  for (const cand of candidates || []) {
    if (excludeIds.has(cand.id)) continue;
    if (chosen.some((prev) => Math.hypot(prev.clientX - cand.clientX, prev.clientY - cand.clientY) < minSepPx)) {
      continue;
    }
    chosen.push(cand);
    if (chosen.length >= count) break;
  }
  return chosen;
}

async function paintTargetRegion(page, target) {
  await dismissFeatureOfferIfVisible(page);
  await page.mouse.click(target.clientX, target.clientY);
  await waitForAnimationFrames(page, 2);
  const painted = await waitForCondition(async () => {
    const sess = await readActiveSession(page);
    return Array.isArray(sess.filledRegionIds) && sess.filledRegionIds.includes(target.id);
  }, 4500);
  assert.equal(
    painted,
    true,
    `Expected region ${target.id} (layer=${target.layerId || 'root'}) to paint at (${Math.round(target.clientX)}, ${Math.round(target.clientY)})`
  );
}

/**
 * Selects target region(s) in Zoom In selection mode and clicks Subdivide.
 */
async function startZoomInSubdivide(
  page,
  snapId,
  {
    targets = null,
    singleTarget = false,
    smallestTarget = false,
    useNestedTarget = false,
    rootTargetIndex = null,
    prompt = '',
    onSelectionReady = null,
  } = {}
) {
  const bar = await enterZoomInSelection(page);

  const isPointHittingCanvas = async (pt) =>
    page.evaluate(
      ({ x, y }) => {
        const canvas = document.querySelector('[data-testid="puzzle-canvas"]');
        return Boolean(canvas && document.elementFromPoint(x, y) === canvas);
      },
      { x: pt.clientX, y: pt.clientY }
    );

  const resolveUnoccludedTarget = async (pt) => {
    if (await isPointHittingCanvas(pt)) return pt;
    const refreshed = await findUnifiedRegionTargets(page, snapId);
    if (!refreshed) return pt;
    const pool = pt.layerId
      ? refreshed.unfilledNestedTargets || []
      : refreshed.allRootTargets || refreshed.unfilledRootTargets || [];
    const sameRegion = pool.find((cand) => cand.id === pt.id && cand.layerId === pt.layerId);
    return sameRegion || pt;
  };

  let chosen = Array.isArray(targets) ? [...targets] : null;
  if (!chosen) {
    const found = await findUnifiedRegionTargets(page, snapId);
    assert.ok(found, 'Expected unified region targets');
    if (useNestedTarget && found.unfilledNestedTargets.length > 0) {
      chosen = [found.unfilledNestedTargets[0]];
    } else if (smallestTarget && found.smallestRootTarget) {
      chosen = [found.smallestRootTarget];
    } else if (typeof rootTargetIndex === 'number' && found.unfilledRootTargets.length > 0) {
      const pick = found.unfilledRootTargets[rootTargetIndex % found.unfilledRootTargets.length];
      assert.ok(pick, 'Expected a clickable root target at rootTargetIndex');
      chosen = [pick];
    } else if (singleTarget) {
      const pick = found.largePair?.a || found.unfilledRootTargets[0];
      assert.ok(pick, 'Expected a clickable single root target');
      chosen = [pick];
    } else if (found.largePair) {
      chosen = [found.largePair.a, found.largePair.b];
    } else {
      assert.ok(found.unfilledRootTargets.length > 0, 'Expected at least one clickable root target');
      chosen = [found.unfilledRootTargets[0]];
    }
  } else {
    for (let i = 0; i < chosen.length; i++) {
      chosen[i] = await resolveUnoccludedTarget(chosen[i]);
    }
  }

  for (let i = 0; i < chosen.length; i++) {
    if (i > 0) {
      chosen[i] = await resolveUnoccludedTarget(chosen[i]);
    }
    const pt = chosen[i];
    await page.mouse.click(pt.clientX, pt.clientY);
    const expectedLabel = i === 0 ? '1 region selected' : `${i + 1} regions selected`;
    const ok = await waitForCondition(async () => {
      const txt = await bar.innerText();
      return txt.includes(expectedLabel);
    }, 3500);
    assert.equal(ok, true, `Expected selection bar to include "${expectedLabel}"`);
  }
  if (prompt) {
    await page.getByTestId('infinite-zoom-in-prompt-input').fill(prompt);
  }
  const confirmBtn = page.getByTestId('region-selection-confirm-btn');
  await confirmBtn.waitFor({ state: 'visible', timeout: 3000 });
  assert.equal(await confirmBtn.isEnabled(), true, 'Expected Subdivide button to be enabled');
  if (typeof onSelectionReady === 'function') {
    await onSelectionReady(bar);
  }
  await confirmBtn.click();
  return chosen;
}

/**
 * Arms an opaque-box, one-shot DOM MutationObserver on document.body watching strictly for
 * [data-testid="undo-subdivision-toast"]. When the toast mounts, schedules a same-frame
 * requestAnimationFrame -> queueMicrotask callback (zero fixed sleeps) that runs right after
 * stepFocusGlide Frame 0 and dispatches real bubbling, cancelable WheelEvent ticks on
 * [data-testid="puzzle-canvas"] while the 420ms focus glide is genuinely mid-flight.
 */
async function armMidGlideWheelCancel(
  page,
  { clientX, clientY, deltaY = 800, ticks = 2, hookName = '__capyMidGlideCancelResult' } = {}
) {
  await page.evaluate(
    ({ cx, cy, dy, tickCount, prop, sessionKey }) => {
      const readPersistedZoom = () => {
        try {
          const parsed = JSON.parse(localStorage.getItem(sessionKey) || '{}');
          return typeof parsed.zoomScale === 'number' && Number.isFinite(parsed.zoomScale) ? parsed.zoomScale : 1;
        } catch {
          return 1;
        }
      };

      const state = {
        fired: false,
        defaultPrevented: false,
        dispatchedTicks: 0,
        elapsedMsFromToast: null,
        scaleBefore: null,
        scaleAfter: null,
      };
      window[prop] = state;

      let triggered = false;
      const onToastMounted = () => {
        if (triggered) return;
        triggered = true;
        const toastMountedAt = performance.now();
        requestAnimationFrame(() => {
          queueMicrotask(() => {
            const canvas = document.querySelector('[data-testid="puzzle-canvas"]');
            if (!canvas) return;
            const rect = canvas.getBoundingClientRect();
            const x = typeof cx === 'number' ? cx : rect.left + rect.width / 2;
            const y = typeof cy === 'number' ? cy : rect.top + rect.height / 2;
            state.scaleBefore = readPersistedZoom();
            let anyPrevented = false;
            for (let i = 0; i < tickCount; i++) {
              const ev = new WheelEvent('wheel', {
                bubbles: true,
                cancelable: true,
                clientX: x,
                clientY: y,
                deltaY: dy,
                deltaMode: 0,
              });
              const notCancelled = canvas.dispatchEvent(ev);
              if (ev.defaultPrevented || !notCancelled) {
                anyPrevented = true;
              }
              state.dispatchedTicks += 1;
            }
            state.defaultPrevented = anyPrevented;
            state.elapsedMsFromToast = performance.now() - toastMountedAt;
            state.scaleAfter = readPersistedZoom();
            state.fired = true;
          });
        });
      };

      if (document.querySelector('[data-testid="undo-subdivision-toast"]')) {
        onToastMounted();
        return;
      }

      const observer = new MutationObserver(() => {
        if (document.querySelector('[data-testid="undo-subdivision-toast"]')) {
          observer.disconnect();
          onToastMounted();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    },
    { cx: clientX, cy: clientY, dy: deltaY, tickCount: ticks, prop: hookName, sessionKey: ACTIVE_SESSION_KEY }
  );
}

/**
 * Probes the organic silhouette seam of a nested layer on the live 2D canvas.
 * Detects any neon-green (#00FF00) backdrop bleed (transparent halo) and computes
 * silhouette contrast continuity + exact RGB center signatures for Preview diffing.
 */
async function probeNestedSilhouetteSeam(page, snapId, layerId) {
  await waitForAnimationFrames(page, 4);
  return page.evaluate(
    async ({ targetSnapId, targetLayerId, sessionKey }) => {
      const canvas = document.querySelector('[data-testid="puzzle-canvas"]');
      if (!canvas || !window.capyStorage) return null;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      const puzzle = await window.capyStorage.loadPuzzleData(targetSnapId);
      if (!puzzle || !Array.isArray(puzzle.nestedLayers)) return null;
      const layer = puzzle.nestedLayers.find((l) => l.layerId === targetLayerId);
      if (!layer || !layer.regionMap) return null;

      const rect = canvas.getBoundingClientRect();
      const dprX = canvas.width / rect.width;
      const dprY = canvas.height / rect.height;
      const session = JSON.parse(localStorage.getItem(sessionKey) || '{}');
      const zoomScale =
        typeof session.zoomScale === 'number' && session.zoomScale > 0 ? session.zoomScale : 1;
      const panOffsetX = typeof session.panOffsetX === 'number' ? session.panOffsetX : 0;
      const panOffsetY = typeof session.panOffsetY === 'number' ? session.panOffsetY : 0;

      const pw = puzzle.width;
      const ph = puzzle.height;
      const rootRm = puzzle.regionMap;
      const baseScale = Math.min(rect.width / pw, rect.height / ph) * 0.92;
      const baseOffsetX = (rect.width - pw * baseScale) / 2;
      const baseOffsetY = (rect.height - ph * baseScale) / 2;
      const effScale = zoomScale * baseScale;

      const lw = layer.width;
      const lh = layer.height;
      const rm = layer.regionMap;
      const wb = layer.worldBounds;
      const allLayers = puzzle.nestedLayers;

      const sampleLayerAtWorld = (l, wx, wy) => {
        const b = l.worldBounds;
        if (!b || b.width <= 0 || b.height <= 0) return 0;
        const nx = wx / pw;
        const ny = wy / ph;
        if (nx < b.x || nx >= b.x + b.width || ny < b.y || ny >= b.y + b.height) return 0;
        const lx = Math.floor(((nx - b.x) / b.width) * l.width);
        const ly = Math.floor(((ny - b.y) / b.height) * l.height);
        if (lx < 0 || lx >= l.width || ly < 0 || ly >= l.height) return 0;
        return l.regionMap[ly * l.width + lx] || 0;
      };

      const isCoveredByOpaquePuzzle = (rx, ry) => {
        if (rx < 0 || rx >= pw || ry < 0 || ry >= ph) return false;
        if (rootRm && rootRm[ry * pw + rx] > 0) return true;
        const wx = rx + 0.5;
        const wy = ry + 0.5;
        for (const l of allLayers) {
          if (sampleLayerAtWorld(l, wx, wy) > 0) return true;
        }
        return false;
      };

      // Confirm whether transparent cutout exterior visibly exposes the #00FF00 canvas backdrop
      let backdropNeonGreenConfirmed = false;
      if (rootRm) {
        const visL = Math.max(2, Math.floor((-panOffsetX - baseOffsetX) / effScale));
        const visR = Math.min(pw - 3, Math.ceil((rect.width - panOffsetX - baseOffsetX) / effScale));
        const visT = Math.max(2, Math.floor((-panOffsetY - baseOffsetY) / effScale));
        const visB = Math.min(ph - 3, Math.ceil((rect.height - panOffsetY - baseOffsetY) / effScale));
        outerBackdrop: for (let ry = visT; ry <= visB; ry += 4) {
          for (let rx = visL; rx <= visR; rx += 4) {
            if (isCoveredByOpaquePuzzle(rx, ry)) continue;
            // Ensure surrounding 3px root neighborhood is also transparent cutout void
            let allVoid = true;
            for (let dy = -2; dy <= 2 && allVoid; dy += 2) {
              for (let dx = -2; dx <= 2; dx += 2) {
                if (isCoveredByOpaquePuzzle(rx + dx, ry + dy)) {
                  allVoid = false;
                  break;
                }
              }
            }
            if (!allVoid) continue;
            const clientX = rect.left + panOffsetX + baseOffsetX + (rx + 0.5) * effScale;
            const clientY = rect.top + panOffsetY + baseOffsetY + (ry + 0.5) * effScale;
            const bx = Math.round((panOffsetX + baseOffsetX + (rx + 0.5) * effScale) * dprX);
            const by = Math.round((panOffsetY + baseOffsetY + (ry + 0.5) * effScale) * dprY);
            if (bx < 4 || bx >= canvas.width - 4 || by < 4 || by >= canvas.height - 4) continue;
            if (document.elementFromPoint(clientX, clientY) !== canvas) continue;
            const px = ctx.getImageData(bx, by, 1, 1).data;
            if (px[1] > 180 && px[0] < 80 && px[2] < 80) {
              backdropNeonGreenConfirmed = true;
              break outerBackdrop;
            }
          }
        }
      }

      const guardRadius = Math.max(2, Math.min(6, Math.ceil(3 / Math.max(0.5, effScale))));
      const candidates = [];
      for (let ly = 0; ly < lh; ly++) {
        const off = ly * lw;
        for (let lx = 0; lx < lw; lx++) {
          if (rm[off + lx] <= 0) continue;
          const leftZero = lx === 0 || rm[off + lx - 1] === 0;
          const rightZero = lx === lw - 1 || rm[off + lx + 1] === 0;
          const upZero = ly === 0 || rm[off - lw + lx] === 0;
          const downZero = ly === lh - 1 || rm[off + lw + lx] === 0;
          if (!leftZero && !rightZero && !upZero && !downZero) continue;

          const wx = (wb.x + ((lx + 0.5) / lw) * wb.width) * pw;
          const wy = (wb.y + ((ly + 0.5) / lh) * wb.height) * ph;
          const rx = Math.floor(wx);
          const ry = Math.floor(wy);
          // Exclude outer puzzle frame edges so neon-green canvas margin outside artwork is never sampled
          if (
            rx < guardRadius + 1 ||
            rx >= pw - guardRadius - 1 ||
            ry < guardRadius + 1 ||
            ry >= ph - guardRadius - 1
          ) {
            continue;
          }
          // Restrict to internal parent-to-nested seams (excluding transparent cutout outer perimeter)
          let bordersTransparentVoid = false;
          for (let dy = -guardRadius; dy <= guardRadius && !bordersTransparentVoid; dy += guardRadius) {
            for (let dx = -guardRadius; dx <= guardRadius; dx += guardRadius) {
              if (!isCoveredByOpaquePuzzle(rx + dx, ry + dy)) {
                bordersTransparentVoid = true;
                break;
              }
            }
          }
          if (bordersTransparentVoid) continue;

          const clientX = rect.left + panOffsetX + baseOffsetX + wx * effScale;
          const clientY = rect.top + panOffsetY + baseOffsetY + wy * effScale;
          const bx = Math.round((panOffsetX + baseOffsetX + wx * effScale) * dprX);
          const by = Math.round((panOffsetY + baseOffsetY + wy * effScale) * dprY);
          if (bx < 4 || bx >= canvas.width - 4 || by < 4 || by >= canvas.height - 4) continue;
          if (document.elementFromPoint(clientX, clientY) !== canvas) continue;
          candidates.push({ lx, ly, bx, by });
        }
      }

      if (candidates.length === 0) {
        return {
          sampleCount: 0,
          neonGreenPixels: 0,
          contrastHits: 0,
          backdropNeonGreenConfirmed,
          signatures: [],
        };
      }

      const maxSamples = 64;
      const step = Math.max(1, Math.floor(candidates.length / maxSamples));
      let neonGreenPixels = 0;
      let contrastHits = 0;
      const signatures = [];

      for (let i = 0; i < candidates.length && signatures.length < maxSamples; i += step) {
        const pt = candidates[i];
        const img = ctx.getImageData(pt.bx - 2, pt.by - 2, 5, 5).data;
        let minL = 255;
        let maxL = 0;
        let minR = 255;
        let maxR = 0;
        let minG = 255;
        let maxG = 0;
        let minB = 255;
        let maxB = 0;

        for (let p = 0; p < img.length; p += 4) {
          const r = img[p];
          const g = img[p + 1];
          const b = img[p + 2];
          if (g > 180 && r < 80 && b < 80) {
            neonGreenPixels += 1;
          }
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          if (lum < minL) minL = lum;
          if (lum > maxL) maxL = lum;
          if (r < minR) minR = r;
          if (r > maxR) maxR = r;
          if (g < minG) minG = g;
          if (g > maxG) maxG = g;
          if (b < minB) minB = b;
          if (b > maxB) maxB = b;
        }
        if (maxL - minL >= 8 || Math.max(maxR - minR, maxG - minG, maxB - minB) >= 12) {
          contrastHits += 1;
        }
        const centerOff = (2 * 5 + 2) * 4;
        signatures.push({
          bx: pt.bx,
          by: pt.by,
          r: img[centerOff],
          g: img[centerOff + 1],
          b: img[centerOff + 2],
        });
      }

      return {
        sampleCount: signatures.length,
        neonGreenPixels,
        contrastHits,
        backdropNeonGreenConfirmed,
        signatures,
      };
    },
    { targetSnapId: snapId, targetLayerId: layerId, sessionKey: ACTIVE_SESSION_KEY }
  );
}

/**
 * Samples backing canvas pixels at previously recorded silhouette coordinates to detect
 * visual changes (e.g., normal mode vs Clean Preview mode with showPreviewBorders: false).
 */
async function sampleCanvasAtCoordinates(page, coords) {
  await waitForAnimationFrames(page, 4);
  return page.evaluate((pts) => {
    const canvas = document.querySelector('[data-testid="puzzle-canvas"]');
    if (!canvas) return [];
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return [];
    return pts.map((pt) => {
      const d = ctx.getImageData(pt.bx, pt.by, 1, 1).data;
      return { bx: pt.bx, by: pt.by, r: d[0], g: d[1], b: d[2] };
    });
  }, coords);
}

/**
 * Samples an N x N RGB pixel signature grid from the live 2D puzzle canvas backing store.
 * Used to prove instant-snap camera placement with zero multi-frame glide motion.
 */
async function sampleCanvasPixelGrid(page, gridN = 8) {
  return page.evaluate((n) => {
    const canvas = document.querySelector('[data-testid="puzzle-canvas"]');
    if (!canvas) return [];
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return [];
    const pts = [];
    for (let gy = 0; gy < n; gy++) {
      const by = Math.round(canvas.height * (0.15 + (0.7 * (gy + 0.5)) / n));
      for (let gx = 0; gx < n; gx++) {
        const bx = Math.round(canvas.width * (0.15 + (0.7 * (gx + 0.5)) / n));
        const d = ctx.getImageData(bx, by, 1, 1).data;
        pts.push([d[0], d[1], d[2]]);
      }
    }
    return pts;
  }, gridN);
}

/**
 * Checks whether a magnified outer parent boundary renders smooth intermediate pixels
 * (imageSmoothingEnabled = true) rather than raw binary nearest-neighbor aliasing.
 * Scans visible world bounds with step 1 across unpainted two-tone white/border/white edges.
 */
async function probeOuterParentSmoothing(page, snapId) {
  await waitForAnimationFrames(page, 4);
  return page.evaluate(
    async ({ targetSnapId, sessionKey }) => {
      const canvas = document.querySelector('[data-testid="puzzle-canvas"]');
      if (!canvas || !window.capyStorage) return null;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      const puzzle = await window.capyStorage.loadPuzzleData(targetSnapId);
      if (!puzzle || !puzzle.regionMap) return null;

      const rect = canvas.getBoundingClientRect();
      const dprX = canvas.width / rect.width;
      const dprY = canvas.height / rect.height;
      const session = JSON.parse(localStorage.getItem(sessionKey) || '{}');
      const zoomScale =
        typeof session.zoomScale === 'number' && session.zoomScale > 0 ? session.zoomScale : 1;
      const panOffsetX = typeof session.panOffsetX === 'number' ? session.panOffsetX : 0;
      const panOffsetY = typeof session.panOffsetY === 'number' ? session.panOffsetY : 0;
      const filledSet = new Set(Array.isArray(session.filledRegionIds) ? session.filledRegionIds : []);

      const pw = puzzle.width;
      const ph = puzzle.height;
      const baseScale = Math.min(rect.width / pw, rect.height / ph) * 0.92;
      const baseOffsetX = (rect.width - pw * baseScale) / 2;
      const baseOffsetY = (rect.height - ph * baseScale) / 2;
      const effScale = zoomScale * baseScale;
      const rm = puzzle.regionMap;
      const nestedLayers = Array.isArray(puzzle.nestedLayers) ? puzzle.nestedLayers : [];

      const padNormX = Math.max(0.01, 4 / pw);
      const padNormY = Math.max(0.01, 4 / ph);
      const isNearAnyNested = (wx, wy) => {
        const nx = wx / pw;
        const ny = wy / ph;
        for (const l of nestedLayers) {
          const wb = l.worldBounds;
          if (
            nx >= wb.x - padNormX &&
            nx <= wb.x + wb.width + padNormX &&
            ny >= wb.y - padNormY &&
            ny <= wb.y + wb.height + padNormY
          ) {
            return true;
          }
        }
        return false;
      };

      const visLeft = Math.max(4, Math.floor((-panOffsetX - baseOffsetX) / effScale));
      const visRight = Math.min(pw - 5, Math.ceil((rect.width - panOffsetX - baseOffsetX) / effScale));
      const visTop = Math.max(4, Math.floor((-panOffsetY - baseOffsetY) / effScale));
      const visBottom = Math.min(ph - 5, Math.ceil((rect.height - panOffsetY - baseOffsetY) / effScale));

      const evaluateStrip = (data) => {
        let minL = 255;
        let maxL = 0;
        const lums = [];
        for (let i = 0; i < data.length; i += 4) {
          const lum = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
          lums.push(lum);
          if (lum < minL) minL = lum;
          if (lum > maxL) maxL = lum;
        }
        if (maxL - minL < 15) return { valid: false, smoothed: false };
        const uniqueLums = new Set(lums);
        const hasIntermediate = lums.some((l) => l > minL + 4 && l < maxL - 4);
        return { valid: true, smoothed: uniqueLums.size >= 3 && hasIntermediate };
      };

      let stripsChecked = 0;
      let stripsWithIntermediateSteps = 0;
      const yStep = Math.max(1, Math.floor((visBottom - visTop + 1) / 48));

      // Scan visible outer-parent vertical borders with px step = 1 across unpainted regions
      for (let py = visTop; py <= visBottom && stripsChecked < 24; py += yStep) {
        const rowOff = py * pw;
        for (let px = visLeft; px <= visRight && stripsChecked < 24; px += 1) {
          const a = rm[rowOff + px];
          const b = rm[rowOff + px + 1];
          if (a <= 0 || b <= 0 || a === b) continue;
          if (filledSet.has(a) || filledSet.has(b)) continue;
          const wx = px + 1;
          const wy = py + 0.5;
          if (isNearAnyNested(wx, wy)) continue;
          const clientX = rect.left + panOffsetX + baseOffsetX + wx * effScale;
          const clientY = rect.top + panOffsetY + baseOffsetY + wy * effScale;
          const bx = Math.round((panOffsetX + baseOffsetX + wx * effScale) * dprX);
          const by = Math.round((panOffsetY + baseOffsetY + wy * effScale) * dprY);
          if (bx < 8 || bx >= canvas.width - 8 || by < 8 || by >= canvas.height - 8) continue;
          if (document.elementFromPoint(clientX, clientY) !== canvas) continue;

          const strip = ctx.getImageData(bx - 6, by, 13, 1).data;
          const res = evaluateStrip(strip);
          if (!res.valid) continue;
          stripsChecked += 1;
          if (res.smoothed) stripsWithIntermediateSteps += 1;
          px += 4;
        }
      }

      // Also scan visible outer-parent horizontal borders if fewer than 12 strips were found
      if (stripsChecked < 12) {
        const xStep = Math.max(1, Math.floor((visRight - visLeft + 1) / 48));
        for (let px = visLeft; px <= visRight && stripsChecked < 24; px += xStep) {
          for (let py = visTop; py <= visBottom && stripsChecked < 24; py += 1) {
            const a = rm[py * pw + px];
            const b = rm[(py + 1) * pw + px];
            if (a <= 0 || b <= 0 || a === b) continue;
            if (filledSet.has(a) || filledSet.has(b)) continue;
            const wx = px + 0.5;
            const wy = py + 1;
            if (isNearAnyNested(wx, wy)) continue;
            const clientX = rect.left + panOffsetX + baseOffsetX + wx * effScale;
            const clientY = rect.top + panOffsetY + baseOffsetY + wy * effScale;
            const bx = Math.round((panOffsetX + baseOffsetX + wx * effScale) * dprX);
            const by = Math.round((panOffsetY + baseOffsetY + wy * effScale) * dprY);
            if (bx < 8 || bx >= canvas.width - 8 || by < 8 || by >= canvas.height - 8) continue;
            if (document.elementFromPoint(clientX, clientY) !== canvas) continue;

            const strip = ctx.getImageData(bx, by - 6, 1, 13).data;
            const res = evaluateStrip(strip);
            if (!res.valid) continue;
            stripsChecked += 1;
            if (res.smoothed) stripsWithIntermediateSteps += 1;
            py += 4;
          }
        }
      }

      return { stripsChecked, stripsWithIntermediateSteps, zoomScale };
    },
    { targetSnapId: snapId, sessionKey: ACTIVE_SESSION_KEY }
  );
}

/**
 * Validates an exported single-save .capy v2 binary file (header, gzip, JSON schema,
 * and zero BYOK secret leakage).
 */
function inspectCapyV2Buffer(rawBuf, secretByokKey = null) {
  assert.ok(rawBuf.length > 16, `Exported .capy too small (${rawBuf.length} bytes)`);
  assert.equal(rawBuf.subarray(0, 4).toString('ascii'), 'CAPY', 'Expected CAPY magic header');
  assert.equal(rawBuf[4], 0x02, `Expected .capy v2 (0x02), got 0x${rawBuf[4].toString(16)}`);
  const flags = rawBuf[5];
  assert.equal(flags & 0x02, 0, 'Expected single-save .capy archive flag bit 1 === 0');

  const body = rawBuf.subarray(6);
  const framed = (flags & 0x01) !== 0 ? zlib.gunzipSync(body) : body;

  if (secretByokKey) {
    const secretBuf = Buffer.from(secretByokKey, 'utf8');
    const keyNameBuf = Buffer.from(BYOK_KEY_STORAGE_KEY, 'utf8');
    assert.equal(rawBuf.includes(secretBuf), false, 'BYOK key leaked into raw .capy bytes!');
    assert.equal(framed.includes(secretBuf), false, 'BYOK key leaked into decompressed .capy bytes!');
    assert.equal(framed.includes(keyNameBuf), false, 'BYOK key name leaked into .capy bytes!');
  }

  const jsonLen = framed.readUInt32LE(0);
  assert.ok(jsonLen > 20 && 4 + jsonLen <= framed.length, `Invalid framed JSON length ${jsonLen}`);
  const jsonText = framed.subarray(4, 4 + jsonLen).toString('utf8');
  if (secretByokKey) {
    assert.equal(jsonText.includes(secretByokKey), false, 'BYOK key leaked into .capy JSON!');
  }
  const parsed = JSON.parse(jsonText);
  assert.equal(parsed.format, 'capy-single-save-v2', 'Expected capy-single-save-v2 format');
  assert.equal(parsed.version, 2, 'Expected version === 2');
  return parsed;
}

async function assertNoHorizontalOverflow(page, label) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  assert.ok(
    metrics.scrollWidth <= metrics.innerWidth + 1,
    `[${label}] Horizontal overflow detected: scrollWidth=${metrics.scrollWidth} > innerWidth=${metrics.innerWidth}`
  );
}

async function assertMinTouchTarget(locator, label, minPx = 44) {
  await locator.waitFor({ state: 'visible', timeout: 5000 });
  const box = await getStableBoundingBox(locator, 2500);
  assert.ok(box, `[${label}] Bounding box unavailable`);
  assert.ok(
    box.width >= minPx - 0.5 && box.height >= minPx - 0.5,
    `[${label}] Expected >= ${minPx}x${minPx}px touch target, got ${box.width.toFixed(1)}x${box.height.toFixed(1)}px`
  );
  return box;
}

/**
 * Seeds 100% completion for a specific nested layer in localStorage & reloads so
 * the app renders the authentic completed nested layer state.
 */
async function completeNestedLayerAndReload(page, snapId, layerId) {
  const layerRegionCount = await page.evaluate(
    async ({ id, targetLayerId, activeKey, snapsKey }) => {
      const puzzle = await window.capyStorage.loadPuzzleData(id);
      if (!puzzle || !Array.isArray(puzzle.nestedLayers)) return 0;
      const layer = puzzle.nestedLayers.find((l) => l.layerId === targetLayerId);
      if (!layer) return 0;
      const layerIds = (layer.regions || []).map((r) => r.id);
      const sess = JSON.parse(localStorage.getItem(activeKey) || '{}');
      const merged = Array.from(new Set([...(sess.filledRegionIds || []), ...layerIds]));
      sess.filledRegionIds = merged;
      sess.fillOrder = merged;
      localStorage.setItem(activeKey, JSON.stringify(sess));

      const snaps = JSON.parse(localStorage.getItem(snapsKey) || '[]');
      const updated = snaps.map((s) =>
        s.id === id
          ? { ...s, filledRegionIds: merged, fillOrder: merged, filledCount: merged.length }
          : s
      );
      localStorage.setItem(snapsKey, JSON.stringify(updated));
      return layerIds.length;
    },
    { id: snapId, targetLayerId: layerId, activeKey: ACTIVE_SESSION_KEY, snapsKey: SNAPSHOTS_KEY }
  );
  assert.ok(layerRegionCount > 0, 'Expected nested layer to have regions to complete');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForPuzzleLoaded(page);
  return layerRegionCount;
}

// ============================================================================
// Declarative 4-Tier Test Registry (51 Opaque-Box Tests)
// ============================================================================

export const TEST_REGISTRY = [
  // --------------------------------------------------------------------------
  // TIER 1: Feature Coverage — Area A (F1-F7)
  // --------------------------------------------------------------------------
  {
    id: 'T1-A1',
    tier: 1,
    area: 'A',
    features: ['F1', 'F4', 'F5', 'F7'],
    title: 'Puter Zoom In sends { w, h } ratio object, quality tier, dynamic MIME & < 900 KB template',
    run: async (env) => {
      const fx = getCommonFixtures();
      let puterNetReqs = [];
      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        beforeGoto: async (p) => {
          puterNetReqs = await attachPuterNetworkSpy(p);
          await injectPuterMockV3(p, fx.standardPattern.dataUrl);
        },
      });
      const snapId = (await readActiveSession(page)).activeSnapshotId;
      assert.ok(snapId, 'Expected booted activeSnapshotId');

      await startZoomInSubdivide(page, snapId, { prompt: 'crisp floral motif' });
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 20000 });

      const calls = await page.evaluate(() => window.__puterCalls);
      assert.equal(calls.length, 1, 'Expected exactly 1 Puter txt2img call');
      assertValidPuterPayload(calls[0], {
        expectedModel: 'gemini-nano-banana-2.1',
        expectedQuality: '1K',
      });
      assert.equal(puterNetReqs.length, 0, 'Expected zero real external requests to puter.com');

      const summary = await readPuzzleSummary(page, snapId);
      assert.equal(summary.nestedLayers.length, 1, 'Expected 1 nested layer committed');
      assert.equal(summary.nestedLayers[0].providerUsed, 'PUTER');
      assert.ok(
        await hasImageBlobInIdb(page, summary.nestedLayers[0].imageBlobKey),
        'Expected nested layer image blob in IDB'
      );
    },
  },
  {
    id: 'T1-A2',
    tier: 1,
    area: 'A',
    features: ['F2', 'F7'],
    title: 'Model-validated resolution options & Puter quality tiers across 2.1, 2 Lite, and 2',
    run: async (env) => {
      const fx = getCommonFixtures();
      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        beforeGoto: async (p) => {
          await attachPuterNetworkSpy(p);
          await injectPuterMockV3(p, fx.standardPattern.dataUrl);
        },
      });
      const snapId = (await readActiveSession(page)).activeSnapshotId;

      const readResOptions = async () =>
        page.getByTestId('iz-resolution-select').evaluate((sel) => ({
          value: sel.value,
          options: Array.from(sel.options).map((o) => o.value),
        }));

      // 1. Default Nano Banana 2.1 -> ['1K', '2K'], pick '2K'
      await openSettingsTab(page, 'create');
      let resInfo = await readResOptions();
      assert.deepEqual(resInfo.options, ['1K', '2K'], 'Nano Banana 2.1 must offer only 1K and 2K');
      assert.equal(resInfo.value, '1K');
      await page.getByTestId('iz-resolution-select').selectOption('2K');
      await closeSettingsModal(page);

      await startZoomInSubdivide(page, snapId, { singleTarget: true });
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 20000 });
      let calls = await page.evaluate(() => window.__puterCalls);
      assertValidPuterPayload(calls[0], {
        expectedModel: 'gemini-nano-banana-2.1',
        expectedQuality: '2K',
      });
      await page.getByTestId('undo-subdivision-btn').click();
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'hidden', timeout: 5000 });
      await waitForViewportSettled(page, (vp) => vp.zoomScale <= 1.12, 4500);

      // 2. Switch to Nano Banana 2 Lite -> ['1K'], auto-clamps '2K' -> '1K'
      await openSettingsTab(page, 'create');
      await page.getByTestId('iz-model-select').selectOption('gemini-3.1-flash-lite-image');
      await waitForAnimationFrames(page, 2);
      resInfo = await readResOptions();
      assert.deepEqual(resInfo.options, ['1K'], 'Nano Banana 2 Lite must offer only 1K');
      assert.equal(resInfo.value, '1K', 'Switching from 2K to 2 Lite must clamp to 1K');
      await closeSettingsModal(page);

      await startZoomInSubdivide(page, snapId, { singleTarget: true });
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 20000 });
      calls = await page.evaluate(() => window.__puterCalls);
      assertValidPuterPayload(calls[1], {
        expectedModel: 'gemini-3.1-flash-lite-image',
        expectedQuality: '1K',
      });
      await page.getByTestId('undo-subdivision-btn').click();
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'hidden', timeout: 5000 });
      await waitForViewportSettled(page, (vp) => vp.zoomScale <= 1.12, 4500);

      // 3. Switch to Nano Banana 2 -> ['512', '1K', '2K'], pick '512'
      await openSettingsTab(page, 'create');
      await page.getByTestId('iz-model-select').selectOption('gemini-3.1-flash-image');
      await waitForAnimationFrames(page, 2);
      resInfo = await readResOptions();
      assert.deepEqual(resInfo.options, ['512', '1K', '2K'], 'Nano Banana 2 must offer 512, 1K, 2K');
      await page.getByTestId('iz-resolution-select').selectOption('512');
      await closeSettingsModal(page);

      await startZoomInSubdivide(page, snapId, { singleTarget: true });
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 20000 });
      calls = await page.evaluate(() => window.__puterCalls);
      assertValidPuterPayload(calls[2], {
        expectedModel: 'gemini-3.1-flash-image',
        expectedQuality: '512',
      });
    },
  },
  {
    id: 'T1-A3',
    tier: 1,
    area: 'A',
    features: ['F3'],
    title: 'Structured Puter insufficient_funds error triggers automatic Guided Gemini fallback',
    run: async (env) => {
      const fx = getCommonFixtures();
      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        beforeGoto: async (p) => {
          await attachPuterNetworkSpy(p);
          await injectPuterMockV3(p, fx.standardPattern.dataUrl, { mode: 'insufficient_funds' });
        },
      });
      const snapId = (await readActiveSession(page)).activeSnapshotId;

      await startZoomInSubdivide(page, snapId, { singleTarget: true });

      const modal = page.getByTestId('guided-gemini-modal');
      await modal.waitFor({ state: 'visible', timeout: 10000 });
      await page.getByTestId('guided-gemini-fallback-notice').waitFor({ state: 'visible', timeout: 3000 });
      assert.equal(
        await page.getByTestId('infinite-zoom-error-toast').count(),
        0,
        'Fallback must open Guided Gemini modal instead of terminal error toast'
      );

      // Complete via file upload
      await page.getByTestId('guided-gemini-file-input').setInputFiles({
        name: 'guided-fallback-result.png',
        mimeType: 'image/png',
        buffer: fx.standardPattern.buffer,
      });
      await modal.waitFor({ state: 'hidden', timeout: 20000 });
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 10000 });

      const summary = await readPuzzleSummary(page, snapId);
      assert.equal(summary.nestedLayers.length, 1, 'Guided fallback upload must commit nested layer');
    },
  },
  {
    id: 'T1-A4',
    tier: 1,
    area: 'A',
    features: ['F4', 'F5', 'F6'],
    title: 'Guided Gemini Web 1-tap Copy Image (PNG ClipboardItem, >=44px) & MIME-matched < 900 KB download',
    run: async (env) => {
      const fx = getCommonFixtures();
      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        acceptDownloads: true,
        extraSettings: { infiniteZoomProvider: 'GUIDED_GEMINI' },
        beforeGoto: async (p) => {
          await injectClipboardMock(p, { mode: 'ok' });
          await injectWindowOpenStub(p);
        },
      });
      const snapId = (await readActiveSession(page)).activeSnapshotId;

      await startZoomInSubdivide(page, snapId, { singleTarget: true });
      const modal = page.getByTestId('guided-gemini-modal');
      await modal.waitFor({ state: 'visible', timeout: 10000 });

      // 1-tap Copy Image button (Web-only, >= 44px)
      const copyImgBtn = page.getByTestId('guided-gemini-copy-image-btn');
      await assertMinTouchTarget(copyImgBtn, 'guided-gemini-copy-image-btn', 44);
      await copyImgBtn.click();

      const copiedFeedback = await waitForCondition(
        async () => (await copyImgBtn.innerText()).includes('Copied Image'),
        3000
      );
      assert.equal(copiedFeedback, true, 'Copy Image button must show "Copied Image" feedback');

      const clip = await page.evaluate(() => window.__clipboardState);
      assert.equal(clip.writeCalls.length, 1, 'Expected 1 navigator.clipboard.write call');
      assert.ok(clip.writeCalls[0].types.includes('image/png'), 'ClipboardItem must write image/png');
      assert.equal(clip.writeCalls[0].isPngMagic, true, 'Clipboard blob must have PNG magic bytes');
      assert.ok(clip.writeCalls[0].byteLength > 100, 'Clipboard PNG payload must be non-empty');

      // Download & Open Gemini -> MIME-matched extension + <= 900 KB
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 10000 }),
        page.getByTestId('guided-gemini-launch-btn').click(),
      ]);
      const suggestedName = download.suggestedFilename();
      const dlPath = await download.path();
      assert.ok(dlPath, 'Expected downloaded template file path');
      const dlBuf = fs.readFileSync(dlPath);
      assert.ok(
        dlBuf.byteLength > 0 && dlBuf.byteLength <= MAX_AI_TEMPLATE_BYTES,
        `Downloaded template must be <= ${MAX_AI_TEMPLATE_BYTES} bytes, got ${dlBuf.byteLength}`
      );
      const detectedMime = detectImageMimeFromBuffer(dlBuf);
      const allowedExts = expectedExtensionsForMime(detectedMime);
      assert.ok(
        allowedExts.some((ext) => suggestedName.toLowerCase().endsWith(ext)),
        `Filename "${suggestedName}" must match detected MIME ${detectedMime}`
      );

      const openedUrls = await page.evaluate(() => window.__openedUrls);
      assert.ok(
        openedUrls.some((u) => u.includes('gemini.google.com')),
        `Expected Gemini URL open, got ${JSON.stringify(openedUrls)}`
      );

      await page.getByTestId('guided-gemini-cancel-btn').click();
      await modal.waitFor({ state: 'hidden', timeout: 5000 });
    },
  },
  {
    id: 'T1-A5',
    tier: 1,
    area: 'A',
    features: ['F2', 'F4', 'F5', 'F7'],
    title: 'Direct Gemini BYOK sends compact < 900 KB dynamic-MIME inlineData & validated imageSize',
    run: async (env) => {
      const fx = getCommonFixtures();
      let capturedByok = [];
      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        beforeGoto: async (p) => {
          capturedByok = await installGeminiByokRouteMock(p, fx.standardPattern.base64);
        },
      });
      await configureInfiniteZoomProvider(page, {
        provider: 'GEMINI_BYOK',
        model: 'gemini-3.1-flash-image',
        resolution: '2K',
        byokKey: TEST_BYOK_KEY,
      });
      const snapId = (await readActiveSession(page)).activeSnapshotId;

      await startZoomInSubdivide(page, snapId, { singleTarget: true });
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 20000 });

      assert.equal(capturedByok.length, 1, 'Expected 1 Direct Gemini BYOK API call');
      const req = capturedByok[0];
      assert.equal(req.headers['x-goog-api-key'], TEST_BYOK_KEY, 'BYOK key must be in x-goog-api-key header');
      assert.equal(req.url.includes(TEST_BYOK_KEY), false, 'BYOK key must never appear in request URL');

      const imgCfg = req.body?.generationConfig?.imageConfig;
      assert.equal(imgCfg?.imageSize, '2K', 'Expected imageConfig.imageSize === 2K');
      assert.ok(
        VALID_GEMINI_ASPECT_RATIOS.has(imgCfg?.aspectRatio),
        `Expected valid Gemini aspectRatio, got ${imgCfg?.aspectRatio}`
      );

      const parts = req.body?.contents?.[0]?.parts || [];
      const inlinePart = parts.find((part) => part && part.inlineData);
      assert.ok(inlinePart?.inlineData?.data, 'Expected inlineData image part in BYOK request');
      const decoded = Buffer.from(inlinePart.inlineData.data, 'base64');
      assert.ok(
        decoded.byteLength > 0 && decoded.byteLength <= MAX_AI_TEMPLATE_BYTES,
        `BYOK inlineData must be <= ${MAX_AI_TEMPLATE_BYTES} bytes, got ${decoded.byteLength}`
      );
      const detectedMime = detectImageMimeFromBuffer(decoded);
      assert.equal(
        inlinePart.inlineData.mimeType,
        detectedMime,
        `BYOK inlineData.mimeType (${inlinePart.inlineData.mimeType}) must match decoded bytes (${detectedMime})`
      );

      const summary = await readPuzzleSummary(page, snapId);
      assert.equal(summary.nestedLayers.length, 1);
      assert.equal(summary.nestedLayers[0].providerUsed, 'GEMINI_BYOK');
    },
  },

  // --------------------------------------------------------------------------
  // TIER 1: Feature Coverage — Area B (F8-F11)
  // --------------------------------------------------------------------------
  {
    id: 'T1-B1',
    tier: 1,
    area: 'B',
    features: ['F8', 'F11'],
    title: 'Unified Zoom In preserves high-density segmentation (100-200+ regions) & activeMask exterior purity',
    run: async (env) => {
      const fx = getCommonFixtures();
      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        beforeGoto: async (p) => {
          await attachPuterNetworkSpy(p);
          await injectPuterMockV3(p, fx.highDensityPattern.dataUrl);
        },
      });
      const snapId = (await readActiveSession(page)).activeSnapshotId;
      const before = await readPuzzleSummary(page, snapId);

      await startZoomInSubdivide(page, snapId, { singleTarget: false });
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 25000 });
      await waitForViewportSettled(page);

      const after = await readPuzzleSummary(page, snapId);
      assert.equal(after.nestedLayers.length, 1, 'Expected 1 nested layer');
      const layer = after.nestedLayers[0];
      assert.ok(
        layer.regionCount >= 80,
        `Expected high-density nested layer (>= 80 regions, far above legacy 12 cap), got ${layer.regionCount}`
      );
      assert.equal(layer.invalidMapPixels, 0, 'Every positive regionMap pixel must map to a valid region');
      assert.ok(layer.interiorPositiveCount > 0, 'Expected masked interior pixels');
      assert.ok(layer.exteriorZeroCount > 0, 'Expected masked exterior pixels strictly equal to 0');
      assert.ok(after.totalRegionCount > before.totalRegionCount + 75);

      const remaining = await readTotalRemainingRegions(page);
      assert.ok(remaining >= layer.regionCount, `Expected PaletteDock remaining >= ${layer.regionCount}, got ${remaining}`);

      const targets = await findUnifiedRegionTargets(page, snapId);
      assert.ok(targets.unfilledNestedTargets.length > 0, 'Expected clickable nested region');
      await paintTargetRegion(page, targets.unfilledNestedTargets[0]);
    },
  },
  {
    id: 'T1-B2',
    tier: 1,
    area: 'B',
    features: ['F1', 'F5', 'F8', 'F11'],
    title: 'Unified Zoom Out extends canvas borders via shared engine while preserving root progress',
    run: async (env) => {
      const fx = getCommonFixtures();
      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        beforeGoto: async (p) => {
          await attachPuterNetworkSpy(p);
          await injectPuterMockV3(p, fx.standardPattern.dataUrl);
        },
      });
      const snapId = (await readActiveSession(page)).activeSnapshotId;
      const targets = await findUnifiedRegionTargets(page, snapId);
      const paintTwo = pickWellSeparatedTargets(targets.unfilledRootTargets, 2);
      assert.equal(paintTwo.length, 2, 'Expected 2 well-separated root regions to paint');
      await paintTargetRegion(page, paintTwo[0]);
      await paintTargetRegion(page, paintTwo[1]);

      const preFilled = (await readActiveSession(page)).filledRegionIds || [];
      const preSummary = await readPuzzleSummary(page, snapId);

      await triggerZoomOut(page, { top: false, bottom: true, left: false, right: true }, { prompt: 'extended meadow' });
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 25000 });

      const calls = await page.evaluate(() => window.__puterCalls);
      assert.equal(calls.length, 1);
      assertValidPuterPayload(calls[0]);

      const postSummary = await readPuzzleSummary(page, snapId);
      assert.ok(postSummary.width > preSummary.width, 'Expected canvas width to grow after Right extend');
      assert.ok(postSummary.height > preSummary.height, 'Expected canvas height to grow after Bottom extend');
      assert.ok(postSummary.totalRegionCount > preSummary.totalRegionCount, 'Expected more regions after Zoom Out');

      const postFilled = new Set((await readActiveSession(page)).filledRegionIds || []);
      for (const id of preFilled) {
        assert.ok(postFilled.has(id), `Previously painted region ${id} must survive Zoom Out`);
      }
    },
  },
  {
    id: 'T1-B3',
    tier: 1,
    area: 'B',
    features: ['F9'],
    title: 'Colored-ink dark-ridge detection splits non-paper pastel fills along brown, navy & burgundy strokes',
    run: async (env) => {
      const fx = getCommonFixtures();
      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        extraSettings: {
          generatorConfig: {
            algorithm: 'AUTO',
            lineHandling: 'ABSORB_LINES',
            preset: 'MEDIUM',
            paletteDetail: 'AUTO',
            colorCount: 16,
            maxRegions: 200,
          },
        },
      });
      const snapId = await uploadTestPhoto(page, {
        name: 'colored-ink-pastel.png',
        mimeType: 'image/png',
        buffer: fx.coloredInkArt.buffer,
      });

      const cellAnalysis = await page.evaluate(async (id) => {
        const puzzle = await window.capyStorage.loadPuzzleData(id);
        if (!puzzle || !puzzle.regionMap) return null;
        const w = puzzle.width;
        const h = puzzle.height;
        const rm = puzzle.regionMap;
        // Sample centers of the 3x3 cells
        const cellIds = [];
        for (let cy = 0; cy < 3; cy++) {
          const row = [];
          for (let cx = 0; cx < 3; cx++) {
            const px = Math.floor(((cx + 0.5) / 3) * w);
            const py = Math.floor(((cy + 0.5) / 3) * h);
            row.push(rm[py * w + px]);
          }
          cellIds.push(row);
        }
        const flat = cellIds.flat().filter((v) => v > 0);
        return {
          rootRegionCount: puzzle.regions.length,
          cellIds,
          uniqueCellRegions: new Set(flat).size,
        };
      }, snapId);

      assert.ok(cellAnalysis, 'Expected colored-ink puzzle analysis');
      assert.ok(
        cellAnalysis.rootRegionCount >= 9,
        `Expected >= 9 regions for 3x3 colored-ink pastel art, got ${cellAnalysis.rootRegionCount}`
      );
      // Same-pastel pairs across warm brown (row 0 cols 0-1), burgundy (col 2 rows 0-1),
      // and deep navy (row 2 cols 1-2) must stay split into distinct regions!
      assert.notEqual(
        cellAnalysis.cellIds[0][0],
        cellAnalysis.cellIds[0][1],
        'Same-pastel cells separated by warm brown ink must NOT merge'
      );
      assert.notEqual(
        cellAnalysis.cellIds[0][2],
        cellAnalysis.cellIds[1][2],
        'Same-pastel cells separated by burgundy ink must NOT merge'
      );
      assert.notEqual(
        cellAnalysis.cellIds[2][1],
        cellAnalysis.cellIds[2][2],
        'Same-pastel cells separated by deep navy ink must NOT merge'
      );
      assert.ok(
        cellAnalysis.uniqueCellRegions >= 8,
        `Expected >= 8 distinct cell regions across 3x3 colored-ink grid, got ${cellAnalysis.uniqueCellRegions}`
      );
    },
  },
  {
    id: 'T1-B4',
    tier: 1,
    area: 'B',
    features: ['F10', 'F11'],
    title: 'Zoom In honors GeneratorConfig parity & explicit isFreeColor: false on grayscale artwork',
    run: async (env) => {
      const fx = getCommonFixtures();
      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        extraSettings: {
          isFreeColorMode: false,
          generatorConfig: {
            algorithm: 'POSTERIZED',
            preset: 'MEDIUM',
            paletteDetail: 'CUSTOM',
            colorCount: 16,
            maxRegions: 240,
          },
        },
        beforeGoto: async (p) => {
          await attachPuterNetworkSpy(p);
          await injectPuterMockV3(p, fx.grayscalePatch.dataUrl);
        },
      });
      const snapId = (await readActiveSession(page)).activeSnapshotId;

      await startZoomInSubdivide(page, snapId, { singleTarget: false });
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 25000 });

      const summary = await readPuzzleSummary(page, snapId);
      assert.equal(summary.isFreeColor, false, 'Grayscale Zoom In must NOT flip puzzle into Free Color mode');
      assert.equal(summary.nestedLayers.length, 1);
      const layer = summary.nestedLayers[0];
      assert.ok(layer.regionCount >= 4, `Expected >= 4 grayscale nested regions, got ${layer.regionCount}`);
      const paletteSet = new Set(summary.paletteIds);
      for (const cid of layer.uniqueColorIds) {
        assert.ok(paletteSet.has(cid), `Nested colorId ${cid} must exist in numbered palette`);
      }

      const dock = await readPaletteDockOrder(page);
      assert.ok(
        dock.swatches.some((s) => s.ariaLabel.includes('remaining')),
        'PaletteDock must stay in Color-by-Number remaining-count mode'
      );
    },
  },
  {
    id: 'T1-B5',
    tier: 1,
    area: 'B',
    features: ['F8', 'F10'],
    title: 'Alpha cutout upload routes through activeMask with 0 exterior bleed & >= 99% interior coverage',
    run: async (env) => {
      const fx = getCommonFixtures();
      const { page } = await env.openIsolatedPage({ easyNoReplay: true });
      const snapId = await uploadTestPhoto(page, {
        name: 'alpha-cutout.png',
        mimeType: 'image/png',
        buffer: fx.alphaCutout.buffer,
      });

      const maskCheck = await page.evaluate(async (id) => {
        const puzzle = await window.capyStorage.loadPuzzleData(id);
        if (!puzzle || !puzzle.regionMap) return null;
        const w = puzzle.width;
        const h = puzzle.height;
        const rm = puzzle.regionMap;
        const cx = w / 2;
        const cy = h / 2;
        const outerR = Math.min(w, h) * 0.44;
        const innerR = Math.min(w, h) * 0.33;

        let exteriorSampled = 0;
        let exteriorLeaked = 0;
        let interiorSampled = 0;
        let interiorCovered = 0;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
            const rid = rm[y * w + x];
            if (dist > outerR) {
              exteriorSampled += 1;
              if (rid !== 0) exteriorLeaked += 1;
            } else if (dist < innerR) {
              interiorSampled += 1;
              if (rid >= 1) interiorCovered += 1;
            }
          }
        }
        return {
          rootRegionCount: puzzle.regions.length,
          exteriorSampled,
          exteriorLeaked,
          interiorSampled,
          interiorCovered,
        };
      }, snapId);

      assert.ok(maskCheck && maskCheck.exteriorSampled > 100 && maskCheck.interiorSampled > 100);
      assert.equal(maskCheck.exteriorLeaked, 0, 'Transparent exterior must have strictly 0 leaked regionMap pixels');
      const coverage = maskCheck.interiorCovered / maskCheck.interiorSampled;
      assert.ok(coverage >= 0.99, `Expected >= 99% opaque interior coverage, got ${(coverage * 100).toFixed(2)}%`);
      assert.ok(maskCheck.rootRegionCount >= 6, `Expected >= 6 cutout sectors, got ${maskCheck.rootRegionCount}`);
    },
  },

  // --------------------------------------------------------------------------
  // TIER 1: Feature Coverage — Area C (F13-F14)
  // --------------------------------------------------------------------------
  {
    id: 'T1-C1',
    tier: 1,
    area: 'C',
    features: ['F14'],
    title: 'Smooth auto-camera focus frames newly generated Zoom In bounds inside unobstructed safe viewport',
    run: async (env) => {
      const fx = getCommonFixtures();
      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        extraSettings: { reducedMotion: false, showResetViewButton: true },
        beforeGoto: async (p) => {
          await attachPuterNetworkSpy(p);
          await injectPuterMockV3(p, fx.standardPattern.dataUrl);
        },
      });
      const snapId = (await readActiveSession(page)).activeSnapshotId;
      const preVp = await readViewportState(page);
      assert.ok(preVp.zoomScale <= 1.05, `Expected initial zoomScale ~1, got ${preVp.zoomScale}`);

      await startZoomInSubdivide(page, snapId, { singleTarget: true });
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 20000 });

      const focusedVp = await waitForViewportSettled(page, (vp) => vp.zoomScale > 1.25, 6000);
      assert.ok(
        focusedVp.zoomScale > 1.25,
        `Expected auto-camera focus to zoom in (> 1.25x), got ${focusedVp.zoomScale}`
      );
      await page.getByTestId('reset-view-btn').waitFor({ state: 'visible', timeout: 4000 });

      // Verify nested layer center projects inside unobstructed canvas safe area
      const frameCheck = await page.evaluate(
        async ({ id, sessionKey }) => {
          const canvas = document.querySelector('[data-testid="puzzle-canvas"]');
          const puzzle = await window.capyStorage.loadPuzzleData(id);
          const layer = puzzle?.nestedLayers?.[0];
          if (!canvas || !layer) return null;
          const rect = canvas.getBoundingClientRect();
          const header = document.querySelector('header');
          const dock = document.querySelector('[data-testid="palette-dock"]');
          const headerBottom = header ? header.getBoundingClientRect().bottom : rect.top;
          const dockTop = dock ? dock.getBoundingClientRect().top : rect.bottom;
          const sess = JSON.parse(localStorage.getItem(sessionKey) || '{}');
          const baseScale = Math.min(rect.width / puzzle.width, rect.height / puzzle.height) * 0.92;
          const baseOffsetX = (rect.width - puzzle.width * baseScale) / 2;
          const baseOffsetY = (rect.height - puzzle.height * baseScale) / 2;
          const effScale = (sess.zoomScale || 1) * baseScale;
          const wb = layer.worldBounds;
          const cxWorld = (wb.x + wb.width / 2) * puzzle.width;
          const cyWorld = (wb.y + wb.height / 2) * puzzle.height;
          const cxScreen = rect.left + (sess.panOffsetX || 0) + baseOffsetX + cxWorld * effScale;
          const cyScreen = rect.top + (sess.panOffsetY || 0) + baseOffsetY + cyWorld * effScale;
          return {
            cxScreen,
            cyScreen,
            rectLeft: rect.left,
            rectRight: rect.right,
            headerBottom,
            dockTop,
          };
        },
        { id: snapId, sessionKey: ACTIVE_SESSION_KEY }
      );
      assert.ok(frameCheck, 'Expected focus frame projection data');
      assert.ok(
        frameCheck.cxScreen >= frameCheck.rectLeft && frameCheck.cxScreen <= frameCheck.rectRight,
        `Focused nested center X (${frameCheck.cxScreen}) must be within canvas horizontal bounds`
      );
      assert.ok(
        frameCheck.cyScreen >= frameCheck.headerBottom && frameCheck.cyScreen <= frameCheck.dockTop,
        `Focused nested center Y (${frameCheck.cyScreen}) must lie between TopBar (${frameCheck.headerBottom}) and PaletteDock (${frameCheck.dockTop})`
      );
    },
  },
  {
    id: 'T1-C2',
    tier: 1,
    area: 'C',
    features: ['F14'],
    title: 'reducedMotion: true snaps auto-camera focus immediately without multi-frame glide drift',
    run: async (env) => {
      const fx = getCommonFixtures();
      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        extraSettings: { reducedMotion: true, showResetViewButton: true },
        beforeGoto: async (p) => {
          await attachPuterNetworkSpy(p);
          await injectPuterMockV3(p, fx.standardPattern.dataUrl);
        },
      });
      const snapId = (await readActiveSession(page)).activeSnapshotId;

      // Confirm UI reflects reducedMotion ON
      await openSettingsTab(page, 'settings');
      assert.equal(await page.getByTestId('setting-reduced-motion').getAttribute('aria-checked'), 'true');
      await closeSettingsModal(page);

      await startZoomInSubdivide(page, snapId, { singleTarget: true });
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 20000 });

      // Sample canvas pixels immediately (frame 2 vs frame 22, BEFORE waitForViewportSettled)
      // to prove reducedMotion snapped immediately with zero multi-frame glide motion.
      await waitForAnimationFrames(page, 2);
      const earlyGrid = await sampleCanvasPixelGrid(page, 8);
      await waitForAnimationFrames(page, 20);
      const laterGrid = await sampleCanvasPixelGrid(page, 8);
      assert.equal(earlyGrid.length, laterGrid.length);
      assert.ok(earlyGrid.length >= 16, `Expected >= 16 canvas grid samples, got ${earlyGrid.length}`);
      let diffPixels = 0;
      for (let i = 0; i < earlyGrid.length; i++) {
        const [r1, g1, b1] = earlyGrid[i];
        const [r2, g2, b2] = laterGrid[i];
        if (Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2) > 6) {
          diffPixels += 1;
        }
      }
      assert.equal(
        diffPixels,
        0,
        `Reduced-motion focus must snap instantly without multi-frame glide (${diffPixels}/${earlyGrid.length} canvas pixels drifted)`
      );

      const snappedVp = await waitForViewportSettled(page, (vp) => vp.zoomScale > 1.25, 4500);
      assert.ok(snappedVp.zoomScale > 1.25, `Expected snapped zoomScale > 1.25, got ${snappedVp.zoomScale}`);
    },
  },
  {
    id: 'T1-C3',
    tier: 1,
    area: 'C',
    features: ['F13', 'F14'],
    title: '1-tap Undo Split restores exact previousViewport and removes nested layer cleanly',
    run: async (env) => {
      const fx = getCommonFixtures();
      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        extraSettings: { showZoomButtons: true, reducedMotion: true },
        beforeGoto: async (p) => {
          await attachPuterNetworkSpy(p);
          await injectPuterMockV3(p, fx.standardPattern.dataUrl);
        },
      });
      const snapId = (await readActiveSession(page)).activeSnapshotId;
      const preSummary = await readPuzzleSummary(page, snapId);

      // Establish a distinctive pre-Zoom-In viewport
      await page.getByTestId('zoom-in-btn').click();
      const preVp = await waitForViewportSettled(page, (vp) => vp.zoomScale > 1.15, 4500);

      await startZoomInSubdivide(page, snapId, { singleTarget: true });
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 20000 });
      const focusedVp = await waitForViewportSettled(
        page,
        (vp) => Math.abs(vp.zoomScale - preVp.zoomScale) > 0.1 || Math.abs(vp.panOffsetX - preVp.panOffsetX) > 10,
        5000
      );
      assert.ok(focusedVp.zoomScale > 1.2, 'Expected auto-focus zoom before Undo Split');

      const undoBtn = page.getByTestId('undo-subdivision-btn');
      assert.ok((await undoBtn.innerText()).includes('Undo Split'), 'Expected Undo Split button label');
      await undoBtn.click();
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'hidden', timeout: 6000 });

      const restoredVp = await waitForViewportSettled(
        page,
        (vp) => Math.abs(vp.zoomScale - preVp.zoomScale) < 0.15,
        5000
      );
      assert.ok(
        Math.abs(restoredVp.zoomScale - preVp.zoomScale) < 0.15 &&
          Math.abs(restoredVp.panOffsetX - preVp.panOffsetX) < 15 &&
          Math.abs(restoredVp.panOffsetY - preVp.panOffsetY) < 15,
        `Undo Split must restore preViewport ${JSON.stringify(preVp)}, got ${JSON.stringify(restoredVp)}`
      );

      const postSummary = await readPuzzleSummary(page, snapId);
      assert.equal(postSummary.nestedLayers.length, 0, 'Undo Split must remove nested layer');
      assert.equal(postSummary.totalRegionCount, preSummary.totalRegionCount, 'Total regions must restore exactly');
    },
  },
  {
    id: 'T1-C4',
    tier: 1,
    area: 'C',
    features: ['F13', 'F14'],
    title: '1-tap Undo Extend restores exact previousViewport, canvas dimensions & region count',
    run: async (env) => {
      const fx = getCommonFixtures();
      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        extraSettings: { showZoomButtons: true, reducedMotion: true },
        beforeGoto: async (p) => {
          await attachPuterNetworkSpy(p);
          await injectPuterMockV3(p, fx.standardPattern.dataUrl);
        },
      });
      const snapId = (await readActiveSession(page)).activeSnapshotId;
      const preSummary = await readPuzzleSummary(page, snapId);

      await page.getByTestId('zoom-in-btn').click();
      const preVp = await waitForViewportSettled(page, (vp) => vp.zoomScale > 1.15, 4500);

      await triggerZoomOut(page, { top: false, bottom: true, left: false, right: true });
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 25000 });

      const extended = await readPuzzleSummary(page, snapId);
      assert.ok(extended.width > preSummary.width && extended.height > preSummary.height);

      const undoBtn = page.getByTestId('undo-subdivision-btn');
      assert.ok((await undoBtn.innerText()).includes('Undo Extend'), 'Expected Undo Extend button label');
      await undoBtn.click();
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'hidden', timeout: 6000 });

      const restoredVp = await waitForViewportSettled(
        page,
        (vp) => Math.abs(vp.zoomScale - preVp.zoomScale) < 0.15,
        5000
      );
      assert.ok(
        Math.abs(restoredVp.zoomScale - preVp.zoomScale) < 0.15 &&
          Math.abs(restoredVp.panOffsetX - preVp.panOffsetX) < 15 &&
          Math.abs(restoredVp.panOffsetY - preVp.panOffsetY) < 15,
        `Undo Extend must restore preViewport ${JSON.stringify(preVp)}, got ${JSON.stringify(restoredVp)}`
      );

      const postSummary = await readPuzzleSummary(page, snapId);
      assert.equal(postSummary.width, preSummary.width);
      assert.equal(postSummary.height, preSummary.height);
      assert.equal(postSummary.totalRegionCount, preSummary.totalRegionCount);
    },
  },
  {
    id: 'T1-C5',
    tier: 1,
    area: 'C',
    features: ['F13', 'F14'],
    title: 'WorldBounds-aware >12x..256x zoom headroom across nested Depth 0 -> 1 -> 2',
    run: async (env) => {
      const fx = getCommonFixtures();
      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        extraSettings: { showZoomButtons: true, reducedMotion: true },
        beforeGoto: async (p) => {
          await attachPuterNetworkSpy(p);
          await injectPuterMockV3(p, fx.standardPattern.dataUrl, {
            responseQueue: [fx.bank1Png.dataUrl, fx.bank2Png.dataUrl],
          });
        },
      });
      const snapId = (await readActiveSession(page)).activeSnapshotId;

      // Depth 1 Zoom In on smallest root region for tighter worldBounds
      await startZoomInSubdivide(page, snapId, { smallestTarget: true });
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 20000 });
      await waitForViewportSettled(page, (vp) => vp.zoomScale > 1.2, 5000);

      // Depth 2 Zoom In inside Depth 1
      await startZoomInSubdivide(page, snapId, { useNestedTarget: true });
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 20000 });
      await waitForViewportSettled(page);

      const summary = await readPuzzleSummary(page, snapId);
      assert.ok(summary.maxZoomDepth >= 2, `Expected maxZoomDepth >= 2, got ${summary.maxZoomDepth}`);

      // Push zoom via zoom-in-btn past the legacy 12x cap
      const zoomInBtn = page.getByTestId('zoom-in-btn');
      for (let i = 0; i < 14; i++) {
        await zoomInBtn.click();
        await waitForAnimationFrames(page, 1);
      }
      const deepVp = await waitForViewportSettled(page, (vp) => vp.zoomScale > 12, 5000);
      assert.ok(
        deepVp.zoomScale > 12 && deepVp.zoomScale <= 256,
        `Expected worldBounds-aware deep zoom in (12, 256], got ${deepVp.zoomScale}`
      );

      const targets = await findUnifiedRegionTargets(page, snapId);
      const d2Target = targets.unfilledNestedTargets.find((t) => t.depth >= 2);
      assert.ok(d2Target, 'Expected clickable Depth-2 nested region at >12x deep zoom');
      await paintTargetRegion(page, d2Target);
    },
  },

  // --------------------------------------------------------------------------
  // TIER 1: Feature Coverage — Area D (F12, F15-F16)
  // --------------------------------------------------------------------------
  {
    id: 'T1-D1',
    tier: 1,
    area: 'D',
    features: ['F15'],
    title: 'Screen-space silhouette hairline continuity & zero transparent halo on neon-green backdrop',
    run: async (env) => {
      const fx = getCommonFixtures();
      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        extraSettings: {
          canvasBgColor: 'CUSTOM',
          canvasBgArgb: 0xff00ff00,
          reducedMotion: true,
          showPreviewBorders: false,
        },
        beforeGoto: async (p) => {
          await attachPuterNetworkSpy(p);
          await injectPuterMockV3(p, fx.bank1Png.dataUrl);
        },
      });
      // Upload alpha cutout puzzle (hasTransparentMask === true) so #00FF00 backdrop genuinely
      // shows through behind transparent cutout void & would bleed through any transparent seam halo
      const snapId = await uploadTestPhoto(page, {
        name: 'cutout-zero-halo.png',
        mimeType: 'image/png',
        buffer: fx.alphaCutout.buffer,
      });

      await startZoomInSubdivide(page, snapId, { singleTarget: true });
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 20000 });
      await waitForViewportSettled(page, (vp) => vp.zoomScale > 1.2, 5000);

      const summary = await readPuzzleSummary(page, snapId);
      const layerId = summary.nestedLayers[0].layerId;
      const probe = await probeNestedSilhouetteSeam(page, snapId, layerId);

      assert.ok(
        probe && probe.sampleCount >= 16,
        `Expected >= 16 visible internal silhouette boundary samples, got ${probe?.sampleCount}`
      );
      assert.equal(
        probe.backdropNeonGreenConfirmed,
        true,
        'Alpha cutout puzzle must expose #00FF00 backdrop outside mask so zero-halo seam probe is non-vacuous'
      );
      assert.equal(
        probe.neonGreenPixels,
        0,
        `Detected ${probe.neonGreenPixels} neon-green backdrop bleed pixels along nested silhouette seam`
      );
      const contrastRatio = probe.contrastHits / probe.sampleCount;
      assert.ok(
        contrastRatio >= 0.6,
        `Expected continuous silhouette hairline contrast (>= 60% of points), got ${(contrastRatio * 100).toFixed(1)}%`
      );
    },
  },
  {
    id: 'T1-D2',
    tier: 1,
    area: 'D',
    features: ['F15'],
    title: 'Magnified outer parent smoothing behind sharp nested layer & clean Preview border toggle',
    run: async (env) => {
      const fx = getCommonFixtures();
      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        extraSettings: {
          reducedMotion: true,
          showPreviewBorders: false,
          showZoomButtons: true,
        },
        beforeGoto: async (p) => {
          await attachPuterNetworkSpy(p);
          await injectPuterMockV3(p, fx.bank1Png.dataUrl);
        },
      });
      const snapId = (await readActiveSession(page)).activeSnapshotId;

      await startZoomInSubdivide(page, snapId, { singleTarget: true });
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 20000 });
      await waitForViewportSettled(page, (vp) => vp.zoomScale > 1.2, 5000);

      const summary = await readPuzzleSummary(page, snapId);
      const layerId = summary.nestedLayers[0].layerId;
      const normalProbe = await probeNestedSilhouetteSeam(page, snapId, layerId);
      assert.ok(normalProbe && normalProbe.sampleCount >= 10, 'Expected silhouette samples in normal mode');

      // Toggle Clean Preview mode (showPreviewBorders: false)
      await page.getByTestId('topbar-preview-btn').click();
      const previewActive = await waitForCondition(
        async () => (await page.getByTestId('topbar-preview-btn').getAttribute('aria-label')) === 'Return to Puzzle',
        3000
      );
      assert.equal(previewActive, true, 'Expected Preview mode to activate');

      const previewSamples = await sampleCanvasAtCoordinates(page, normalProbe.signatures);
      let changedCount = 0;
      for (let i = 0; i < normalProbe.signatures.length; i++) {
        const a = normalProbe.signatures[i];
        const b = previewSamples[i];
        if (!b) continue;
        const diff = Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
        if (diff >= 12) changedCount += 1;
      }
      assert.ok(
        changedCount >= Math.max(3, Math.floor(normalProbe.signatures.length * 0.2)),
        `Expected Clean Preview to visually change silhouette pixels, only ${changedCount}/${normalProbe.signatures.length} differed`
      );

      // Return to puzzle and probe magnified outer-parent smoothing at >= 4x zoom
      await page.getByTestId('topbar-preview-btn').click();
      const previewClosed = await waitForCondition(
        async () => (await page.getByTestId('topbar-preview-btn').getAttribute('aria-label')) !== 'Return to Puzzle',
        3000
      );
      assert.equal(previewClosed, true, 'Expected Preview mode to close');
      await waitForAnimationFrames(page, 3);

      const preZoomVp = await waitForViewportSettled(page);
      const clicksNeeded =
        preZoomVp.zoomScale >= 4.2
          ? 0
          : Math.max(
              1,
              Math.min(8, Math.ceil(Math.log(4.6 / Math.max(0.5, preZoomVp.zoomScale)) / Math.log(1.25)))
            );
      for (let i = 0; i < clicksNeeded; i++) {
        await page.getByTestId('zoom-in-btn').click();
        await waitForAnimationFrames(page, 1);
      }
      await waitForViewportSettled(page, (vp) => vp.zoomScale >= 4, 4500);

      let smoothProbe = await probeOuterParentSmoothing(page, snapId);
      if (!smoothProbe || smoothProbe.stripsChecked < 3) {
        // Pan outward off the nested layer center so outer parent borders are clearly inside viewport
        const box = await page.getByTestId('puzzle-canvas').boundingBox();
        assert.ok(box, 'Expected canvas bounding box for panning');
        const cx = box.x + box.width * 0.5;
        const cy = box.y + box.height * 0.5;
        const dx = Math.round(box.width * 0.45);
        const dy = Math.round(box.height * 0.45);
        const panVectors = [
          [dx, 0],
          [dx, 0],
          [-dx * 3, 0],
          [dx, dy],
          [0, -dy * 2],
        ];
        for (const [vx, vy] of panVectors) {
          // Split large displacements into in-bounds drags from canvas center so pointer stays inside box
          const subSteps = Math.max(
            1,
            Math.ceil(Math.abs(vx) / Math.max(1, dx)),
            Math.ceil(Math.abs(vy) / Math.max(1, dy))
          );
          const stepDx = Math.round(vx / subSteps);
          const stepDy = Math.round(vy / subSteps);
          for (let s = 0; s < subSteps; s++) {
            await page.mouse.move(cx, cy);
            await page.mouse.down();
            await page.mouse.move(cx + stepDx, cy + stepDy, { steps: 4 });
            await page.mouse.up();
          }
          await waitForViewportSettled(page);
          smoothProbe = await probeOuterParentSmoothing(page, snapId);
          if (smoothProbe && smoothProbe.stripsChecked >= 3) break;
        }
      }

      assert.ok(
        smoothProbe && smoothProbe.stripsChecked >= 3,
        `Expected >= 3 visible magnified outer-parent border strips at >=4x zoom, got ${JSON.stringify(smoothProbe)}`
      );
      assert.ok(
        smoothProbe.stripsWithIntermediateSteps > 0,
        `Expected smoothed intermediate pixel transitions along magnified outer parent borders, got ${JSON.stringify(smoothProbe)}`
      );
    },
  },
  {
    id: 'T1-D3',
    tier: 1,
    area: 'D',
    features: ['F16'],
    title: 'PaletteDock floats visible nested-layer swatches with divider & stable displayNumberMap',
    run: async (env) => {
      const fx = getCommonFixtures();
      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        extraSettings: { reducedMotion: true, showResetViewButton: true },
        beforeGoto: async (p) => {
          await attachPuterNetworkSpy(p);
          await injectPuterMockV3(p, fx.bank1Png.dataUrl);
        },
      });
      const snapId = (await readActiveSession(page)).activeSnapshotId;

      const beforeDock = await readPaletteDockOrder(page);
      assert.equal(beforeDock.floatedCount, 0, 'Standard puzzle before Zoom In must have 0 floated swatches');
      assert.equal(beforeDock.hasDivider, false);

      await startZoomInSubdivide(page, snapId, { singleTarget: true });
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 20000 });
      await waitForViewportSettled(page, (vp) => vp.zoomScale > 1.2, 5000);

      // Wait for 80ms debounced visibleNestedColorIds emission -> floated swatches
      const floatedReady = await waitForCondition(async () => {
        const d = await readPaletteDockOrder(page);
        return d.floatedCount > 0;
      }, 4500);
      assert.equal(floatedReady, true, 'Expected visible nested-layer swatches to float to front of PaletteDock');

      const floatedDock = await readPaletteDockOrder(page);
      assert.ok(floatedDock.floatedCount > 0 && floatedDock.floatedCount < floatedDock.swatches.length);
      assert.equal(floatedDock.hasDivider, true, 'Expected palette-nested-divider between floated & outer swatches');
      assert.equal(
        floatedDock.dividerIndex,
        floatedDock.floatedCount,
        `Divider must sit strictly after floated block (expected ${floatedDock.floatedCount}, got ${floatedDock.dividerIndex})`
      );

      // Leading swatches must all be floated; trailing swatches must not be floated
      for (let i = 0; i < floatedDock.swatches.length; i++) {
        assert.equal(
          floatedDock.swatches[i].isNestedFloated,
          i < floatedDock.floatedCount,
          `Swatch at index ${i} floated state mismatch`
        );
      }

      // Reset view to 1x to unfloat on the SAME post-Zoom-In puzzle and verify 1:1 displayNumber -> styleBg invariance
      await page.getByTestId('reset-view-btn').click();
      await waitForViewportSettled(page, (vp) => vp.zoomScale <= 1.1, 4500);
      const unfloatedReady = await waitForCondition(async () => {
        const d = await readPaletteDockOrder(page);
        return d.floatedCount === 0 && d.hasDivider === false;
      }, 4500);
      assert.equal(unfloatedReady, true, 'Expected Reset View to unfloat swatches cleanly');

      const unfloatedDock = await readPaletteDockOrder(page);
      assert.equal(
        unfloatedDock.swatches.length,
        floatedDock.swatches.length,
        'Floating/unfloating must preserve exact swatch count'
      );
      const unfloatedMap = new Map(unfloatedDock.swatches.map((s) => [s.displayNumber, s.styleBg]));
      for (const sw of floatedDock.swatches) {
        assert.equal(
          unfloatedMap.get(sw.displayNumber),
          sw.styleBg,
          `Swatch #${sw.displayNumber} displayNumber -> styleBg shifted between floated and unfloated states`
        );
      }
    },
  },
  {
    id: 'T1-D4',
    tier: 1,
    area: 'D',
    features: ['F16'],
    title: '1-9 keyboard shortcuts track floated dock order & swatches unfloat on Reset View / pan away',
    run: async (env) => {
      const fx = getCommonFixtures();
      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        extraSettings: { reducedMotion: true, showResetViewButton: true },
        beforeGoto: async (p) => {
          await attachPuterNetworkSpy(p);
          await injectPuterMockV3(p, fx.bank1Png.dataUrl);
        },
      });
      const snapId = (await readActiveSession(page)).activeSnapshotId;

      await startZoomInSubdivide(page, snapId, { singleTarget: true });
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 20000 });
      await waitForViewportSettled(page, (vp) => vp.zoomScale > 1.2, 5000);

      const floatedReady = await waitForCondition(async () => (await readPaletteDockOrder(page)).floatedCount > 0, 4500);
      assert.equal(floatedReady, true, 'Expected floated nested swatches');

      const dock = await readPaletteDockOrder(page);
      assert.ok(dock.swatches.length >= 2, 'Expected >= 2 swatches in PaletteDock');
      const firstFloatedTestId = dock.swatches[0].testId;
      const nonLeadingTestId = dock.swatches[dock.swatches.length - 1].testId;

      // Select a non-leading swatch first so pressing '1' genuinely changes active swatch
      await page.getByTestId(nonLeadingTestId).click();
      const nonLeadingActive = await waitForCondition(
        async () => (await page.getByTestId(nonLeadingTestId).getAttribute('aria-pressed')) === 'true',
        3000
      );
      assert.equal(nonLeadingActive, true, `Expected non-leading swatch ${nonLeadingTestId} to become active`);

      // Press keyboard '1' -> must activate the leading floated swatch (dock.swatches[0])
      await page.keyboard.press('1');
      const pressed1 = await waitForCondition(
        async () => (await page.getByTestId(firstFloatedTestId).getAttribute('aria-pressed')) === 'true',
        3000
      );
      assert.equal(pressed1, true, `Pressing '1' must select leading floated swatch ${firstFloatedTestId}`);

      if (dock.floatedCount >= 2) {
        const secondTestId = dock.swatches[1].testId;
        await page.keyboard.press('2');
        const pressed2 = await waitForCondition(
          async () => (await page.getByTestId(secondTestId).getAttribute('aria-pressed')) === 'true',
          3000
        );
        assert.equal(pressed2, true, `Pressing '2' must select second floated swatch ${secondTestId}`);
      }

      // Click Reset View (Fit to Screen) -> zoom returns to 1x -> nested swatches unfloat
      await page.getByTestId('reset-view-btn').click();
      await waitForViewportSettled(page, (vp) => vp.zoomScale <= 1.08, 4500);
      const unfloated = await waitForCondition(async () => {
        const d = await readPaletteDockOrder(page);
        return d.floatedCount === 0 && d.hasDivider === false;
      }, 4500);
      assert.equal(unfloated, true, 'Reset View at 1x must unfloat nested swatches and remove divider');
    },
  },
  {
    id: 'T1-D5',
    tier: 1,
    area: 'D',
    features: ['F12'],
    title: 'Palette grows past 64 up to <= 96 colors & round-trips losslessly through .capy v2 export/import',
    run: async (env) => {
      const fx = getCommonFixtures();
      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        acceptDownloads: true,
        extraSettings: {
          reducedMotion: true,
          showResetViewButton: true,
          generatorConfig: {
            algorithm: 'POSTERIZED',
            preset: 'HIGH',
            paletteDetail: 'CUSTOM',
            colorCount: 64,
            maxRegions: 400,
          },
        },
        beforeGoto: async (p) => {
          await attachPuterNetworkSpy(p);
          await injectPuterMockV3(p, fx.bank1Png.dataUrl, {
            responseQueue: [fx.bank1Png.dataUrl, fx.bank2Png.dataUrl, fx.bank3Png.dataUrl],
          });
        },
      });

      const snapId = await uploadTestPhoto(page, {
        name: 'bank0-60colors.png',
        mimeType: 'image/png',
        buffer: fx.bank0Png.buffer,
      });
      let summary = await readPuzzleSummary(page, snapId);
      assert.ok(summary.paletteCount >= 45, `Expected Bank 0 upload >= 45 swatches, got ${summary.paletteCount}`);

      // Run up to 3 sequential Zoom In layers on distinct root targets to cross 64 swatches
      for (let pass = 0; pass < 3 && summary.paletteCount <= 64; pass++) {
        if (pass > 0) {
          const resetBtn = page.getByTestId('reset-view-btn');
          if ((await resetBtn.count()) > 0 && (await resetBtn.isVisible())) {
            await resetBtn.click();
            await waitForViewportSettled(page, (vp) => vp.zoomScale <= 1.1, 4500);
          }
        }
        await startZoomInSubdivide(page, snapId, { singleTarget: true });
        await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 25000 });
        await waitForViewportSettled(page);
        summary = await readPuzzleSummary(page, snapId);
      }

      assert.ok(
        summary.paletteCount > 64 && summary.paletteCount <= 96,
        `Expected paletteCount in (64, 96], got ${summary.paletteCount}`
      );

      // Paint 2 regions before exporting
      const targets = await findUnifiedRegionTargets(page, snapId);
      const toPaint = pickWellSeparatedTargets(
        [...targets.unfilledNestedTargets, ...targets.unfilledRootTargets],
        2
      );
      assert.ok(toPaint.length >= 1, 'Expected >= 1 paintable region before .capy v2 export');
      for (const t of toPaint) await paintTargetRegion(page, t);
      const exportedSession = await readActiveSession(page);

      // Export .capy v2 via Saves tab
      await openSettingsTab(page, 'saves');
      await page.getByTestId(`save-card-${snapId}`).click();
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }),
        page.getByTestId('save-action-export').click(),
      ]);
      const capyPath = await download.path();
      const rawBuf = fs.readFileSync(capyPath);
      const parsed = inspectCapyV2Buffer(rawBuf);
      assert.ok(
        parsed.compactPuzzle.palette.length > 64 && parsed.compactPuzzle.palette.length <= 96,
        `Exported .capy v2 palette must have > 64 and <= 96 colors, got ${parsed.compactPuzzle.palette.length}`
      );

      // Import into fresh isolated BrowserContext and verify lossless round-trip
      const { page: freshPage } = await env.openIsolatedPage({ easyNoReplay: true });
      await openSettingsTab(freshPage, 'saves');
      await freshPage.locator('input[type="file"][accept*=".capy"]').setInputFiles({
        name: 'roundtrip-96.capy',
        mimeType: 'application/octet-stream',
        buffer: rawBuf,
      });
      await freshPage.getByTestId('saves-import-notice').waitFor({ state: 'visible', timeout: 15000 });

      const importedSnaps = await readSnapshots(freshPage);
      const imported = importedSnaps.find((s) => s.totalCount === summary.totalRegionCount) || importedSnaps[0];
      assert.ok(imported, 'Expected imported snapshot in fresh context');
      await freshPage.getByTestId(`save-card-${imported.id}`).click();
      await freshPage.getByTestId('save-action-load').click();
      await waitForPuzzleLoaded(freshPage);

      const restoredSummary = await readPuzzleSummary(freshPage, imported.id);
      const restoredSession = await readActiveSession(freshPage);
      assert.equal(restoredSummary.paletteCount, summary.paletteCount, 'Palette count must survive .capy v2 round-trip');
      assert.equal(restoredSummary.nestedLayers.length, summary.nestedLayers.length);
      assert.equal(restoredSummary.totalRegionCount, summary.totalRegionCount);
      assert.deepEqual(
        [...(restoredSession.filledRegionIds || [])].sort((a, b) => a - b),
        [...(exportedSession.filledRegionIds || [])].sort((a, b) => a - b),
        'Filled regions must survive .capy v2 round-trip'
      );
    },
  },

  // --------------------------------------------------------------------------
  // TIER 2: Boundary & Corner Cases — Area A (F1-F7)
  // --------------------------------------------------------------------------
  {
    id: 'T2-A1',
    tier: 2,
    area: 'A',
    features: ['F3'],
    title: 'Puter moderation_flagged (HTTP 400 bad_request, no safety keyword) -> SAFETY_BLOCKED, zero fallback',
    run: async (env) => {
      const fx = getCommonFixtures();
      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        beforeGoto: async (p) => {
          await attachPuterNetworkSpy(p);
          await injectPuterMockV3(p, fx.standardPattern.dataUrl, { mode: 'moderation_flagged' });
        },
      });
      const snapId = (await readActiveSession(page)).activeSnapshotId;

      await startZoomInSubdivide(page, snapId, { singleTarget: true });

      const errToast = page.getByTestId('infinite-zoom-error-toast');
      await errToast.waitFor({ state: 'visible', timeout: 10000 });
      const errText = await errToast.innerText();
      assert.match(
        errText,
        /safety|policy|blocked|inappropriate|flagged|cannot generate|moderated/i,
        `Expected SAFETY_BLOCKED toast copy, got "${errText}"`
      );
      assert.equal(
        await page.getByTestId('guided-gemini-modal').count(),
        0,
        'moderation_flagged must NEVER fall back to Guided Gemini modal'
      );

      await page.getByTestId('infinite-zoom-error-dismiss').click();
      await errToast.waitFor({ state: 'hidden', timeout: 4000 });
      const summary = await readPuzzleSummary(page, snapId);
      assert.equal(summary.nestedLayers.length, 0);
    },
  },
  {
    id: 'T2-A2',
    tier: 2,
    area: 'A',
    features: ['F3'],
    title: 'Safety-over-cancel precedence (moderation_flagged + cancelled message) stays SAFETY_BLOCKED',
    run: async (env) => {
      const fx = getCommonFixtures();
      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        beforeGoto: async (p) => {
          await attachPuterNetworkSpy(p);
          await injectPuterMockV3(p, fx.standardPattern.dataUrl, { mode: 'safety_over_cancel' });
        },
      });
      const snapId = (await readActiveSession(page)).activeSnapshotId;

      await startZoomInSubdivide(page, snapId, { singleTarget: true });

      const errToast = page.getByTestId('infinite-zoom-error-toast');
      await errToast.waitFor({ state: 'visible', timeout: 10000 });
      const errText = await errToast.innerText();
      assert.match(
        errText,
        /safety|policy|blocked|inappropriate|flagged|cannot generate|moderated/i,
        `Expected SAFETY_BLOCKED toast copy on safety-over-cancel, got "${errText}"`
      );
      assert.equal(
        await page.getByTestId('guided-gemini-modal').count(),
        0,
        'Safety-over-cancel must display SAFETY_BLOCKED toast and NEVER open Guided fallback'
      );
    },
  },
  {
    id: 'T2-A3',
    tier: 2,
    area: 'A',
    features: ['F2', 'F7'],
    title: 'Stale persisted localStorage cross-model resolutions clamp cleanly in UI, Puter & BYOK',
    run: async (env) => {
      const fx = getCommonFixtures();
      // Case 1: 2 Lite seeded with unsupported '2K' -> clamps to '1K'
      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        extraSettings: {
          infiniteZoomProvider: 'PUTER',
          nanoBananaModel: 'gemini-3.1-flash-lite-image',
          nanoBananaResolution: '2K',
        },
        beforeGoto: async (p) => {
          await attachPuterNetworkSpy(p);
          await injectPuterMockV3(p, fx.standardPattern.dataUrl);
        },
      });
      await openSettingsTab(page, 'create');
      const liteUi = await page.getByTestId('iz-resolution-select').evaluate((sel) => ({
        value: sel.value,
        options: Array.from(sel.options).map((o) => o.value),
      }));
      assert.equal(liteUi.value, '1K', '2 Lite stale 2K must clamp to 1K in UI');
      assert.deepEqual(liteUi.options, ['1K']);
      await closeSettingsModal(page);

      const snapId = (await readActiveSession(page)).activeSnapshotId;
      await startZoomInSubdivide(page, snapId, { singleTarget: true });
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 20000 });
      const puterCalls = await page.evaluate(() => window.__puterCalls);
      assertValidPuterPayload(puterCalls[0], {
        expectedModel: 'gemini-3.1-flash-lite-image',
        expectedQuality: '1K',
      });

      // Case 2: 2.1 seeded with unsupported '512' on BYOK -> clamps to '1K'
      let byokReqs = [];
      const { page: byokPage } = await env.openIsolatedPage({
        easyNoReplay: true,
        extraSettings: {
          infiniteZoomProvider: 'GEMINI_BYOK',
          nanoBananaModel: 'gemini-nano-banana-2.1',
          nanoBananaResolution: '512',
        },
        beforeGoto: async (p) => {
          await p.addInitScript(
            ({ k, v }) => localStorage.setItem(k, v),
            { k: BYOK_KEY_STORAGE_KEY, v: TEST_BYOK_KEY }
          );
          byokReqs = await installGeminiByokRouteMock(p, fx.standardPattern.base64);
        },
      });
      await openSettingsTab(byokPage, 'create');
      const v21Ui = await byokPage.getByTestId('iz-resolution-select').evaluate((sel) => ({
        value: sel.value,
        options: Array.from(sel.options).map((o) => o.value),
      }));
      assert.equal(v21Ui.value, '1K', '2.1 stale 512 must clamp to 1K in UI');
      assert.deepEqual(v21Ui.options, ['1K', '2K']);
      await closeSettingsModal(byokPage);

      const byokSnap = (await readActiveSession(byokPage)).activeSnapshotId;
      await startZoomInSubdivide(byokPage, byokSnap, { singleTarget: true });
      await byokPage.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 20000 });
      assert.equal(byokReqs.length, 1);
      assert.equal(
        byokReqs[0].body?.generationConfig?.imageConfig?.imageSize,
        '1K',
        'BYOK imageSize must clamp stale 512 on 2.1 to 1K'
      );
    },
  },
  {
    id: 'T2-A4',
    tier: 2,
    area: 'A',
    features: ['F1', 'F4', 'F5'],
    title: '2048x2048 high-entropy texture compresses strictly to <= 900 KB compact template',
    run: async (env) => {
      const fx = getCommonFixtures();
      const noisy2048 = createHighEntropyTexturePng(2048, 2048);
      assert.ok(
        noisy2048.buffer.byteLength > MAX_AI_TEMPLATE_BYTES * 2,
        'Sanity check: 2048x2048 high-entropy source PNG must exceed 1.8 MB'
      );

      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        extraSettings: {
          generatorConfig: {
            algorithm: 'PAINTERLY',
            preset: 'LOW',
            resolution: 1024,
            maxRegions: 80,
          },
        },
        beforeGoto: async (p) => {
          await attachPuterNetworkSpy(p);
          await injectPuterMockV3(p, fx.standardPattern.dataUrl);
        },
      });

      await uploadTestPhoto(page, {
        name: 'high-entropy-2048.png',
        mimeType: 'image/png',
        buffer: noisy2048.buffer,
      });

      await triggerZoomOut(page, { top: true, bottom: true, left: true, right: true });
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 30000 });

      const calls = await page.evaluate(() => window.__puterCalls);
      assert.equal(calls.length, 1);
      const info = assertValidPuterPayload(calls[0]);
      assert.ok(
        info.decodedBytes <= MAX_AI_TEMPLATE_BYTES,
        `High-entropy template must compress to <= ${MAX_AI_TEMPLATE_BYTES} bytes, got ${info.decodedBytes}`
      );
    },
  },
  {
    id: 'T2-A5',
    tier: 2,
    area: 'A',
    features: ['F5', 'F6'],
    title: 'Copy Image corner cases: NotAllowedError, Promise-reject Blob retry, rapid close & Android exclusion',
    run: async (env) => {
      const fx = getCommonFixtures();
      // Part 1 & 2: Web clipboard denied + Promise-rejection fallback retry + rapid close
      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        extraSettings: { infiniteZoomProvider: 'GUIDED_GEMINI' },
        beforeGoto: async (p) => {
          await injectClipboardMock(p, { mode: 'denied' });
          await injectWindowOpenStub(p);
        },
      });
      const snapId = (await readActiveSession(page)).activeSnapshotId;
      await startZoomInSubdivide(page, snapId, { singleTarget: true });

      const modal = page.getByTestId('guided-gemini-modal');
      await modal.waitFor({ state: 'visible', timeout: 10000 });
      const copyImgBtn = page.getByTestId('guided-gemini-copy-image-btn');
      await copyImgBtn.click();

      // NotAllowedError must show recoverable error banner & stop after 1 attempt (no retry)
      await page.getByTestId('guided-gemini-error').waitFor({ state: 'visible', timeout: 4000 });
      let clip = await page.evaluate(() => window.__clipboardState);
      assert.equal(clip.writeAttempts, 1, 'NotAllowedError must not blindly retry clipboard.write');
      assert.equal(await modal.isVisible(), true, 'Modal must stay open and recoverable on denied clipboard');

      // Switch mock to reject-promise-once -> resolved Blob retry succeeds!
      await page.evaluate(() => {
        window.__clipboardState.mode = 'reject-promise-once';
        window.__clipboardState.writeAttempts = 0;
        window.__clipboardState.rejectedPromiseCount = 0;
        window.__clipboardState.writeCalls = [];
      });
      await copyImgBtn.click();
      const retriedOk = await waitForCondition(
        async () => (await copyImgBtn.innerText()).includes('Copied Image'),
        4000
      );
      assert.equal(retriedOk, true, 'Resolved-Blob fallback retry must succeed when Promise ClipboardItem rejects');
      clip = await page.evaluate(() => window.__clipboardState);
      assert.equal(clip.rejectedPromiseCount, 1, 'Expected initial Promise ClipboardItem rejection');
      assert.equal(clip.writeCalls.length, 1, 'Expected second resolved-Blob write call to succeed');
      assert.equal(clip.writeCalls[0].wasPromise, false, 'Fallback retry must pass a resolved Blob');
      assert.equal(clip.writeCalls[0].isPngMagic, true, 'Fallback retry blob must be valid PNG');

      // Rapid close before 2.5s feedback timer expires -> zero errors
      await page.getByTestId('guided-gemini-cancel-btn').click();
      await modal.waitFor({ state: 'hidden', timeout: 4000 });
      await waitForAnimationFrames(page, 6);

      // Part 3: Android WebView excludes Puter & hides Web-only Copy Image button
      const { page: androidPage } = await env.openIsolatedPage({
        easyNoReplay: true,
        beforeGoto: async (p) => {
          await injectAndroidWebViewMock(p);
        },
      });
      await openSettingsTab(androidPage, 'create');
      const androidProviders = await androidPage
        .getByTestId('iz-provider-select')
        .evaluate((sel) => Array.from(sel.options).map((o) => o.value));
      assert.equal(androidProviders.includes('PUTER'), false, 'Android WebView must strictly exclude PUTER');
      await closeSettingsModal(androidPage);

      const androidSnap = (await readActiveSession(androidPage)).activeSnapshotId;
      await startZoomInSubdivide(androidPage, androidSnap, { singleTarget: true });
      await androidPage.getByTestId('guided-gemini-modal').waitFor({ state: 'visible', timeout: 10000 });
      assert.equal(
        await androidPage.getByTestId('guided-gemini-copy-image-btn').count(),
        0,
        'Android WebView must NOT render Web-only guided-gemini-copy-image-btn'
      );

      await androidPage.getByTestId('guided-gemini-launch-btn').click();
      await androidPage.waitForFunction(
        () => (window.__androidBridgeCalls?.shareImage?.length || 0) >= 1,
        { timeout: 5000 }
      );
      await androidPage
        .getByTestId('guided-gemini-modal')
        .locator('p[role="status"]')
        .waitFor({ state: 'visible', timeout: 5000 });
      const shareCalls = await androidPage.evaluate(() => window.__androidBridgeCalls.shareImage);
      assert.equal(shareCalls.length, 1, 'Android launch must call window.CapyAndroid.shareImage');
      const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(shareCalls[0].dataUrl);
      assert.ok(match, 'Android shareImage must receive a valid image data URL');
      const sharedBuf = Buffer.from(match[2], 'base64');
      assert.ok(
        sharedBuf.byteLength > 0 && sharedBuf.byteLength <= MAX_AI_TEMPLATE_BYTES,
        `Android shareImage payload must be <= ${MAX_AI_TEMPLATE_BYTES} bytes, got ${sharedBuf.byteLength}`
      );
    },
  },

  // --------------------------------------------------------------------------
  // TIER 2: Boundary & Corner Cases — Area B (F8-F11)
  // --------------------------------------------------------------------------
  {
    id: 'T2-B1',
    tier: 2,
    area: 'B',
    features: ['F9'],
    title: 'Thick dark photo shadows suppress rim-halo slivers and preserve clean photo segmentation',
    run: async (env) => {
      const fx = getCommonFixtures();
      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        extraSettings: {
          generatorConfig: {
            algorithm: 'AUTO',
            preset: 'MEDIUM',
            maxRegions: 200,
          },
        },
      });
      const snapId = await uploadTestPhoto(page, {
        name: 'thick-dark-photo-shadows.png',
        mimeType: 'image/png',
        buffer: fx.thickDarkShadowPhoto.buffer,
      });

      const check = await page.evaluate(async (id) => {
        const puzzle = await window.capyStorage.loadPuzzleData(id);
        if (!puzzle || !puzzle.regions) return null;
        const total = puzzle.regions.length;
        const tinySlivers = puzzle.regions.filter((r) => r.area < 20).length;
        // Sample centers & 8 inner-perimeter points (r = 35px inside r=40px discs) to catch rim-halo rings
        const w = puzzle.width;
        const h = puzzle.height;
        const c1x = Math.floor(w * 0.3);
        const c1y = Math.floor(h * 0.38);
        const c2x = Math.floor(w * 0.7);
        const c2y = Math.floor(h * 0.64);
        const r1 = puzzle.regionMap[c1y * w + c1x];
        const r2 = puzzle.regionMap[c2y * w + c2x];
        const reg1 = puzzle.regions.find((r) => r.id === r1);
        const reg2 = puzzle.regions.find((r) => r.id === r2);
        const rimRadius = 35 * (Math.min(w, h) / 320);
        let r1PerimeterMatch = 0;
        let r2PerimeterMatch = 0;
        for (let k = 0; k < 8; k++) {
          const ang = (k * Math.PI) / 4;
          const p1x = Math.max(0, Math.min(w - 1, Math.round(c1x + Math.cos(ang) * rimRadius)));
          const p1y = Math.max(0, Math.min(h - 1, Math.round(c1y + Math.sin(ang) * rimRadius)));
          if (puzzle.regionMap[p1y * w + p1x] === r1) r1PerimeterMatch += 1;
          const p2x = Math.max(0, Math.min(w - 1, Math.round(c2x + Math.cos(ang) * rimRadius)));
          const p2y = Math.max(0, Math.min(h - 1, Math.round(c2y + Math.sin(ang) * rimRadius)));
          if (puzzle.regionMap[p2y * w + p2x] === r2) r2PerimeterMatch += 1;
        }
        return {
          total,
          tinySlivers,
          r1Area: reg1 ? reg1.area : 0,
          r2Area: reg2 ? reg2.area : 0,
          r1PerimeterMatch,
          r2PerimeterMatch,
        };
      }, snapId);

      assert.ok(check && check.total >= 3, `Expected clean photo regions, got ${check?.total}`);
      assert.ok(check.r1Area >= 500 && check.r2Area >= 500, 'Thick dark shadow cores must stay intact solid regions');
      assert.equal(
        check.r1PerimeterMatch,
        8,
        `Shadow disc 1 rim-halo detected: only ${check.r1PerimeterMatch}/8 perimeter samples matched disc core`
      );
      assert.equal(
        check.r2PerimeterMatch,
        8,
        `Shadow disc 2 rim-halo detected: only ${check.r2PerimeterMatch}/8 perimeter samples matched disc core`
      );
      assert.ok(
        check.tinySlivers / check.total < 0.25,
        `Too many tiny rim-halo slivers (${check.tinySlivers}/${check.total})`
      );
    },
  },
  {
    id: 'T2-B2',
    tier: 2,
    area: 'B',
    features: ['F8', 'F11'],
    title: 'Single smallest root region activeMask Zoom In satisfies floor >= 1 & zero invalid pixels',
    run: async (env) => {
      const fx = getCommonFixtures();
      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        beforeGoto: async (p) => {
          await attachPuterNetworkSpy(p);
          await injectPuterMockV3(p, fx.standardPattern.dataUrl);
        },
      });
      const snapId = (await readActiveSession(page)).activeSnapshotId;

      await startZoomInSubdivide(page, snapId, { smallestTarget: true });
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 20000 });

      const summary = await readPuzzleSummary(page, snapId);
      assert.equal(summary.nestedLayers.length, 1);
      const layer = summary.nestedLayers[0];
      assert.ok(layer.regionCount >= 1, `Single-region activeMask must produce >= 1 region, got ${layer.regionCount}`);
      assert.ok(layer.minRegionArea >= 1, 'Every region must have area >= 1');
      assert.equal(layer.invalidMapPixels, 0, 'Zero dangling regionMap IDs allowed');
      assert.ok(layer.interiorPositiveCount > 0, 'Masked interior must be populated');
    },
  },
  {
    id: 'T2-B3',
    tier: 2,
    area: 'B',
    features: ['F11'],
    title: 'Zoom Out guard rails block 0 sides selected and extreme > 2.5:1 aspect ratio extensions',
    run: async (env) => {
      const fx = getCommonFixtures();
      const { page } = await env.openIsolatedPage({ easyNoReplay: true });

      // Part 1: 0 sides selected -> disabled confirm + alert
      const dialog = await openInfiniteZoomPopover(page);
      await page.getByTestId('toolbar-infinite-zoom-out-btn').click();
      await setExtendSideState(page, 'extend-side-top', false);
      await setExtendSideState(page, 'extend-side-bottom', false);
      await setExtendSideState(page, 'extend-side-left', false);
      await setExtendSideState(page, 'extend-side-right', false);

      const confirmBtn = page.getByTestId('toolbar-infinite-zoom-out-confirm-btn');
      assert.equal(await confirmBtn.isDisabled(), true, 'Extend confirm must be disabled when 0 sides selected');
      await dialog.locator('[role="alert"]').waitFor({ state: 'visible', timeout: 3000 });
      await page.locator('button[aria-label="Close Infinite Zoom menu"]').click();

      // Part 2: Upload 2.0:1 wide image, try left+right only -> exceeds 2.5:1 -> blocked
      await uploadTestPhoto(page, {
        name: 'wide-2-to-1.png',
        mimeType: 'image/png',
        buffer: fx.wideRatio2To1.buffer,
      });
      const dialog2 = await openInfiniteZoomPopover(page);
      await page.getByTestId('toolbar-infinite-zoom-out-btn').click();
      await setExtendSideState(page, 'extend-side-top', false);
      await setExtendSideState(page, 'extend-side-bottom', false);
      await setExtendSideState(page, 'extend-side-left', true);
      await setExtendSideState(page, 'extend-side-right', true);

      assert.equal(await confirmBtn.isDisabled(), true, 'Extending wide 2:1 image horizontally only must be blocked (>2.5:1)');
      await dialog2.locator('[role="alert"]').waitFor({ state: 'visible', timeout: 3000 });

      // Enabling top+bottom restores balanced aspect ratio -> re-enables button
      await setExtendSideState(page, 'extend-side-top', true);
      await setExtendSideState(page, 'extend-side-bottom', true);
      assert.equal(await confirmBtn.isEnabled(), true, 'Balanced 4-side extend must re-enable confirm button');
    },
  },
  {
    id: 'T2-B4',
    tier: 2,
    area: 'B',
    features: ['F10', 'F11'],
    title: 'Switching GeneratorConfig strategies via Create Tab regenerates & executes Zoom In cleanly',
    run: async (env) => {
      const fx = getCommonFixtures();
      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        beforeGoto: async (p) => {
          await attachPuterNetworkSpy(p);
          await injectPuterMockV3(p, fx.standardPattern.dataUrl);
        },
      });

      const strategies = ['Painterly (Photo)', 'Line Art Tracer', 'Posterized', 'Mosaic Cells'];
      for (const label of strategies) {
        await openSettingsTab(page, 'create');
        await page.locator('[role="dialog"]').getByRole('button', { name: label }).first().click();
        await waitForAnimationFrames(page, 1);
        await page.locator('[role="dialog"]').getByRole('button', { name: 'Regenerate Artwork with Settings' }).click();
        await waitForPuzzleLoaded(page);
      }

      const snapId = (await readActiveSession(page)).activeSnapshotId;
      await startZoomInSubdivide(page, snapId, { singleTarget: true });
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 20000 });

      const summary = await readPuzzleSummary(page, snapId);
      assert.equal(summary.nestedLayers.length, 1);
      assert.ok(summary.nestedLayers[0].regionCount >= 4, 'Strategy-parity Zoom In must produce valid nested regions');
    },
  },
  {
    id: 'T2-B5',
    tier: 2,
    area: 'B',
    features: ['F8', 'F11'],
    title: 'Non-adjacent region tap shows Switch Selection prompt & Clear resets selection controls',
    run: async (env) => {
      const { page } = await env.openIsolatedPage({ easyNoReplay: true });
      const snapId = (await readActiveSession(page)).activeSnapshotId;
      const bar = await enterZoomInSelection(page);
      const targets = await findUnifiedRegionTargets(page, snapId);
      assert.ok(targets?.largePair?.nonAdjacent, 'Expected non-adjacent root target');
      await page.mouse.click(targets.largePair.a.clientX, targets.largePair.a.clientY);
      const selected1 = await waitForCondition(
        async () => (await bar.innerText()).includes('1 region selected'),
        3500
      );
      assert.equal(selected1, true);

      // Tap non-adjacent region -> Switch Selection prompt appears
      await page.mouse.click(targets.largePair.nonAdjacent.clientX, targets.largePair.nonAdjacent.clientY);
      const switchBtn = page.getByTestId('region-selection-switch-btn');
      await switchBtn.waitFor({ state: 'visible', timeout: 4000 });
      assert.ok((await bar.innerText()).includes('not touching'));

      await switchBtn.click();
      await switchBtn.waitFor({ state: 'hidden', timeout: 3000 });
      assert.ok((await bar.innerText()).includes('1 region selected'));

      // Clear resets selection cleanly
      await page.getByTestId('region-selection-clear-btn').click();
      const cleared = await waitForCondition(
        async () => (await bar.innerText()).includes('Tap or drag connected regions'),
        3000
      );
      assert.equal(cleared, true);
      assert.equal(await page.getByTestId('region-selection-confirm-btn').isDisabled(), true);
      assert.equal(await page.getByTestId('region-selection-clear-btn').isDisabled(), true);
    },
  },

  // --------------------------------------------------------------------------
  // TIER 2: Boundary & Corner Cases — Area C (F13-F14)
  // --------------------------------------------------------------------------
  {
    id: 'T2-C1',
    tier: 2,
    area: 'C',
    features: ['F14'],
    title: 'Mid-glide user wheel/drag gesture cancels auto-camera focus immediately with zero snap-back',
    run: async (env) => {
      const fx = getCommonFixtures();
      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        extraSettings: { reducedMotion: false },
        beforeGoto: async (p) => {
          await attachPuterNetworkSpy(p);
          await injectPuterMockV3(p, fx.standardPattern.dataUrl);
        },
      });
      const snapId = (await readActiveSession(page)).activeSnapshotId;

      // Pre-compute canvas center BEFORE commit so zero boundingBox() CDP latency occurs after toast visibility
      const canvasBox = await page.getByTestId('puzzle-canvas').boundingBox();
      assert.ok(canvasBox, 'Expected puzzle-canvas bounding box before Zoom In commit');
      const cx = canvasBox.x + canvasBox.width / 2;
      const cy = canvasBox.y + canvasBox.height / 2;

      // Pick smallest root region (~11.11x target) and arm opaque-box mid-glide wheel cancel
      // so WheelEvent dispatches genuinely mid-flight before CDP round-trips outlast the 420ms glide
      await startZoomInSubdivide(page, snapId, {
        smallestTarget: true,
        onSelectionReady: async () => {
          await armMidGlideWheelCancel(page, { clientX: cx, clientY: cy, deltaY: 800, ticks: 3 });
        },
      });
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 20000 });
      const cancelFired = await waitForCondition(
        () => page.evaluate(() => Boolean(window.__capyMidGlideCancelResult?.fired)),
        5000
      );
      assert.equal(cancelFired, true, 'Expected mid-glide wheel cancel gesture to fire on undo-subdivision-toast mount');
      const cancelResult = await page.evaluate(() => window.__capyMidGlideCancelResult);
      assert.equal(cancelResult?.fired, true, `Expected fired=true (got ${JSON.stringify(cancelResult)})`);
      assert.equal(
        cancelResult?.defaultPrevented,
        true,
        `Expected puzzle-canvas wheel handler to preventDefault mid-glide (got ${JSON.stringify(cancelResult)})`
      );

      const afterWheelCancel = await waitForViewportSettled(page, (vp) => vp.zoomScale < 0.95, 5000);
      assert.ok(
        afterWheelCancel.zoomScale <= 1.25,
        `Mid-glide wheel cancellation must stop auto-focus glide instead of snapping to zoomed target (got zoomScale=${afterWheelCancel.zoomScale})`
      );

      // Follow up with a real Playwright drag gesture to verify pan control remains responsive after cancel
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + 60, cy + 40, { steps: 3 });
      await page.mouse.up();

      const afterCancel = await waitForViewportSettled(
        page,
        (vp) =>
          vp.zoomScale <= 1.25 &&
          vp.panOffsetX >= afterWheelCancel.panOffsetX + 45 &&
          vp.panOffsetY >= afterWheelCancel.panOffsetY + 30,
        5000
      );
      assert.ok(
        afterCancel.zoomScale <= 1.25,
        `Mid-glide cancellation must stop auto-focus glide instead of snapping to zoomed target (got zoomScale=${afterCancel.zoomScale})`
      );
      // Run 24 animation frames (~400ms) and assert zero snap-back toward auto-focus zoom
      await waitForAnimationFrames(page, 24);
      const later = await waitForViewportSettled(page, null, 4000);
      assert.ok(
        Math.abs(later.zoomScale - afterCancel.zoomScale) < 0.05 &&
          Math.abs(later.panOffsetX - afterCancel.panOffsetX) < 4 &&
          Math.abs(later.panOffsetY - afterCancel.panOffsetY) < 4,
        `Cancelled auto-focus must NOT snap back (afterCancel=${JSON.stringify(afterCancel)}, later=${JSON.stringify(later)})`
      );
    },
  },
  {
    id: 'T2-C2',
    tier: 2,
    area: 'C',
    features: ['F14'],
    title: 'Rapid multi-gesture burst during auto-focus produces finite valid viewport & zero errors',
    run: async (env) => {
      const fx = getCommonFixtures();
      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        extraSettings: { reducedMotion: false, showZoomButtons: true },
        beforeGoto: async (p) => {
          await attachPuterNetworkSpy(p);
          await injectPuterMockV3(p, fx.standardPattern.dataUrl);
        },
      });
      const snapId = (await readActiveSession(page)).activeSnapshotId;

      await startZoomInSubdivide(page, snapId, { singleTarget: true });
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 20000 });

      const box = await page.getByTestId('puzzle-canvas').boundingBox();
      const cx = box.x + box.width * 0.5;
      const cy = box.y + box.height * 0.5;
      await page.mouse.move(cx, cy);
      await page.mouse.wheel(0, -300);
      await page.mouse.down();
      await page.mouse.move(cx - 45, cy + 35, { steps: 2 });
      await page.mouse.up();
      await page.mouse.wheel(0, 500);
      await page.getByTestId('zoom-out-btn').click();
      await page.getByTestId('zoom-in-btn').click();

      const settled = await waitForViewportSettled(page, null, 5000);
      assert.ok(
        Number.isFinite(settled.zoomScale) && settled.zoomScale >= 0.4 && settled.zoomScale <= 256,
        `Expected finite zoomScale in [0.4, 256], got ${settled.zoomScale}`
      );
      assert.ok(Number.isFinite(settled.panOffsetX) && Number.isFinite(settled.panOffsetY));
    },
  },
  {
    id: 'T2-C3',
    tier: 2,
    area: 'C',
    features: ['F13', 'F14'],
    title: 'Cancel/Abort mid-generation leaves IDB layers, region count & viewport completely untouched',
    run: async (env) => {
      const fx = getCommonFixtures();
      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        beforeGoto: async (p) => {
          await attachPuterNetworkSpy(p);
          await injectPuterMockV3(p, fx.standardPattern.dataUrl);
        },
      });
      const snapId = (await readActiveSession(page)).activeSnapshotId;
      const preSummary = await readPuzzleSummary(page, snapId);
      const preVp = await readViewportState(page);
      const preLayerBlobKeys = await listLayerImageBlobKeysInIdb(page, snapId);

      // Pause Puter mock until explicitly released so Cancel is deterministic
      await page.evaluate(() => {
        window.__puterDelayUntilRelease = true;
      });
      await startZoomInSubdivide(page, snapId, { singleTarget: true });

      const puterReached = await waitForCondition(
        async () => (await page.evaluate(() => window.__puterCalls.length)) >= 1,
        8000
      );
      assert.equal(puterReached, true, 'Expected Puter mock to be invoked before clicking cancel');

      const cancelBtn = page.getByTestId('loading-cancel-btn');
      await cancelBtn.waitFor({ state: 'visible', timeout: 8000 });
      await cancelBtn.click();
      await cancelBtn.waitFor({ state: 'hidden', timeout: 8000 });

      // Release late Puter response — must be cleanly ignored after abort
      await page.evaluate(() => window.__releasePuterPending());
      await waitForAnimationFrames(page, 12);

      const postSummary = await readPuzzleSummary(page, snapId);
      const postVp = await readViewportState(page);
      const postLayerBlobKeys = await listLayerImageBlobKeysInIdb(page, snapId);
      assert.equal(postSummary.nestedLayers.length, preSummary.nestedLayers.length);
      assert.equal(postSummary.totalRegionCount, preSummary.totalRegionCount);
      assert.deepEqual(
        postLayerBlobKeys,
        preLayerBlobKeys,
        `Cancelled generation must leave zero orphan layer_* blobs in IDB (before=${JSON.stringify(preLayerBlobKeys)}, after=${JSON.stringify(postLayerBlobKeys)})`
      );
      assert.ok(Math.abs(postVp.zoomScale - preVp.zoomScale) < 0.05);
      assert.equal(await page.getByTestId('undo-subdivision-toast').count(), 0);
    },
  },
  {
    id: 'T2-C4',
    tier: 2,
    area: 'C',
    features: ['F14'],
    title: 'Reloading a puzzle with existing nested layers preserves saved viewport without auto-focus jump',
    run: async (env) => {
      const fx = getCommonFixtures();
      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        extraSettings: { reducedMotion: true, showResetViewButton: true },
        beforeGoto: async (p) => {
          await attachPuterNetworkSpy(p);
          await injectPuterMockV3(p, fx.standardPattern.dataUrl);
        },
      });
      const snapId = (await readActiveSession(page)).activeSnapshotId;

      await startZoomInSubdivide(page, snapId, { singleTarget: true });
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 20000 });
      await waitForViewportSettled(page, (vp) => vp.zoomScale > 1.2, 5000);

      // Reset view to ~1.0x and wait for persistence
      await page.getByTestId('reset-view-btn').click();
      await waitForViewportSettled(page, (vp) => vp.zoomScale <= 1.08, 4500);

      // Reload page — camera MUST remain near 1.0x (no spurious auto-focus jump!)
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForPuzzleLoaded(page);
      await waitForAnimationFrames(page, 16);

      const postReloadVp = await waitForViewportSettled(page, null, 4000);
      assert.ok(
        postReloadVp.zoomScale <= 1.12,
        `Reloading saved puzzle must not spuriously auto-focus (got zoomScale=${postReloadVp.zoomScale})`
      );
      const summary = await readPuzzleSummary(page, snapId);
      assert.equal(summary.nestedLayers.length, 1);
    },
  },
  {
    id: 'T2-C5',
    tier: 2,
    area: 'C',
    features: ['F13', 'F14'],
    title: 'Painting a nested region auto-dismisses Undo Split toast while keeping regular Undo Region intact',
    run: async (env) => {
      const fx = getCommonFixtures();
      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        extraSettings: { reducedMotion: true },
        beforeGoto: async (p) => {
          await attachPuterNetworkSpy(p);
          await injectPuterMockV3(p, fx.standardPattern.dataUrl);
        },
      });
      const snapId = (await readActiveSession(page)).activeSnapshotId;

      await startZoomInSubdivide(page, snapId, { singleTarget: true });
      const toast = page.getByTestId('undo-subdivision-toast');
      await toast.waitFor({ state: 'visible', timeout: 20000 });
      await waitForViewportSettled(page);

      const targets = await findUnifiedRegionTargets(page, snapId);
      assert.ok(targets.unfilledNestedTargets.length > 0, 'Expected clickable nested region');
      const target = targets.unfilledNestedTargets[0];
      await paintTargetRegion(page, target);

      await toast.waitFor({ state: 'hidden', timeout: 4000 });

      // Regular Undo Region must undo ONLY the painted region, keeping the nested layer intact
      const undoRegionBtn = page.getByTestId('undo-btn');
      await undoRegionBtn.waitFor({ state: 'visible', timeout: 3000 });
      assert.equal(await undoRegionBtn.isEnabled(), true);
      await undoRegionBtn.click();

      const undone = await waitForCondition(async () => {
        const sess = await readActiveSession(page);
        return !(sess.filledRegionIds || []).includes(target.id);
      }, 4000);
      assert.equal(undone, true, 'Regular Undo Region must unpaint the nested region');

      const summary = await readPuzzleSummary(page, snapId);
      assert.equal(summary.nestedLayers.length, 1, 'Regular Undo Region must NOT delete the nested layer');
    },
  },

  // --------------------------------------------------------------------------
  // TIER 2: Boundary & Corner Cases — Area D (F12, F15-F16)
  // --------------------------------------------------------------------------
  {
    id: 'T2-D1',
    tier: 2,
    area: 'D',
    features: ['F12'],
    title: 'Palette reuses close colors (deltaE <= 22) first and strictly caps total swatches at <= 96',
    run: async (env) => {
      const fx = getCommonFixtures();
      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        extraSettings: {
          reducedMotion: true,
          showResetViewButton: true,
          generatorConfig: {
            algorithm: 'POSTERIZED',
            preset: 'HIGH',
            paletteDetail: 'CUSTOM',
            colorCount: 64,
            maxRegions: 400,
          },
        },
        beforeGoto: async (p) => {
          await attachPuterNetworkSpy(p);
          await injectPuterMockV3(p, fx.bank0ReuseSubsetPng.dataUrl, {
            responseQueue: [
              fx.bank0ReuseSubsetPng.dataUrl, // Phase 1: colors already in Bank 0 -> reuse!
              fx.bank1Png.dataUrl,
              fx.bank2Png.dataUrl,
              fx.bank3Png.dataUrl,
              fx.bank4Png.dataUrl,
              fx.bank5Png.dataUrl,
            ],
          });
        },
      });

      const snapId = await uploadTestPhoto(page, {
        name: 'bank0-ceiling.png',
        mimeType: 'image/png',
        buffer: fx.bank0Png.buffer,
      });
      const initial = await readPuzzleSummary(page, snapId);
      assert.ok(initial.paletteCount >= 45, `Expected >= 45 initial swatches, got ${initial.paletteCount}`);

      // Phase 1: Matching Bank 0 subset should reuse existing swatches with minimal/zero growth
      await startZoomInSubdivide(page, snapId, { singleTarget: true });
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 25000 });
      await waitForViewportSettled(page);
      const afterReuse = await readPuzzleSummary(page, snapId);
      assert.ok(
        afterReuse.paletteCount - initial.paletteCount <= 2,
        `Expected deltaE <= 22 reuse (growth <= 2), grew from ${initial.paletteCount} to ${afterReuse.paletteCount}`
      );

      // Phase 2: Sequential disjoint banks push past 64 while strictly enforcing <= 96 ceiling
      let current = afterReuse;
      for (let i = 0; i < 5; i++) {
        const resetBtn = page.getByTestId('reset-view-btn');
        if ((await resetBtn.count()) > 0 && (await resetBtn.isVisible())) {
          await resetBtn.click();
          await waitForViewportSettled(page, (vp) => vp.zoomScale <= 1.1, 4500);
        }
        await startZoomInSubdivide(page, snapId, { singleTarget: true, rootTargetIndex: i });
        await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 25000 });
        await waitForViewportSettled(page);
        current = await readPuzzleSummary(page, snapId);
        assert.ok(
          current.paletteCount <= 96,
          `Palette count exceeded hard cap 96 (got ${current.paletteCount})`
        );
      }

      assert.ok(current.paletteCount > 64, `Expected palette to grow past 64, got ${current.paletteCount}`);
      assert.ok(current.paletteCount <= 96, `Expected palette <= 96, got ${current.paletteCount}`);
    },
  },
  {
    id: 'T2-D2',
    tier: 2,
    area: 'D',
    features: ['F16'],
    title: 'Standard 0-nested-layer puzzle leaves PaletteDock order unchanged with zero floated/divider DOM',
    run: async (env) => {
      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        extraSettings: { showZoomButtons: true },
      });

      const assertNoFloat = async (stage) => {
        const dock = await readPaletteDockOrder(page);
        assert.ok(dock.swatches.length > 0, `[${stage}] Expected swatches`);
        assert.equal(dock.floatedCount, 0, `[${stage}] Standard puzzle must have 0 floated swatches`);
        assert.equal(dock.hasDivider, false, `[${stage}] Standard puzzle must have no nested divider`);
      };

      await assertNoFloat('1x default');
      for (let i = 0; i < 5; i++) {
        await page.getByTestId('zoom-in-btn').click();
        await waitForAnimationFrames(page, 1);
      }
      await waitForViewportSettled(page, (vp) => vp.zoomScale > 2, 4000);
      await waitForAnimationFrames(page, 8);
      await assertNoFloat('zoomed-in');

      for (const sortLabel of ['By Number', 'Remaining', 'Rainbow', 'Lightness']) {
        await selectSettingsPaletteSort(page, sortLabel);
        await assertNoFloat(`sort=${sortLabel}`);
      }
    },
  },
  {
    id: 'T2-D3',
    tier: 2,
    area: 'D',
    features: ['F16'],
    title: 'Floated nested swatches keep stable displayNumberMap labels across all 4 PaletteDock sort modes',
    run: async (env) => {
      const fx = getCommonFixtures();
      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        extraSettings: { reducedMotion: true, showResetViewButton: true },
        beforeGoto: async (p) => {
          await attachPuterNetworkSpy(p);
          await injectPuterMockV3(p, fx.bank1Png.dataUrl);
        },
      });
      const snapId = (await readActiveSession(page)).activeSnapshotId;

      await startZoomInSubdivide(page, snapId, { singleTarget: true });
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 20000 });
      await waitForViewportSettled(page, (vp) => vp.zoomScale > 1.2, 5000);

      const sortOrders = ['By Number', 'Remaining', 'Rainbow', 'Lightness'];
      const floatedBySort = new Map();

      // Pass A (zoomed in on nested layer): verify floated order & record displayNumber -> styleBg per sort order
      for (const sortLabel of sortOrders) {
        await selectSettingsPaletteSort(page, sortLabel);
        const ready = await waitForCondition(async () => (await readPaletteDockOrder(page)).floatedCount > 0, 4500);
        assert.equal(ready, true, `Expected floated swatches preserved under sort "${sortLabel}"`);
        const cur = await readPaletteDockOrder(page);
        assert.equal(cur.hasDivider, true, `Expected divider preserved under sort "${sortLabel}"`);
        assert.equal(
          cur.dividerIndex,
          cur.floatedCount,
          `Divider index mismatch under sort "${sortLabel}"`
        );
        floatedBySort.set(sortLabel, cur);
      }

      // Pass B (reset view to 1x unfloated): verify identical 1:1 displayNumber -> styleBg under EACH sort order
      await page.getByTestId('reset-view-btn').click();
      await waitForViewportSettled(page, (vp) => vp.zoomScale <= 1.1, 4500);
      const unfloatedReady = await waitForCondition(async () => {
        const d = await readPaletteDockOrder(page);
        return d.floatedCount === 0 && d.hasDivider === false;
      }, 4500);
      assert.equal(unfloatedReady, true, 'Expected Reset View to unfloat swatches');

      for (const sortLabel of sortOrders) {
        await selectSettingsPaletteSort(page, sortLabel);
        const stillUnfloated = await waitForCondition(async () => {
          const d = await readPaletteDockOrder(page);
          return d.floatedCount === 0 && d.swatches.length > 0;
        }, 4000);
        assert.equal(stillUnfloated, true, `Expected unfloated dock at 1x under sort "${sortLabel}"`);
        const unfloated = await readPaletteDockOrder(page);
        const floated = floatedBySort.get(sortLabel);
        assert.equal(
          floated.swatches.length,
          unfloated.swatches.length,
          `Swatch count mismatch between floated and unfloated under sort "${sortLabel}"`
        );
        const unfloatedMap = new Map(unfloated.swatches.map((s) => [s.displayNumber, s.styleBg]));
        for (const sw of floated.swatches) {
          assert.equal(
            sw.styleBg,
            unfloatedMap.get(sw.displayNumber),
            `displayNumber #${sw.displayNumber} shifted color between floated and unfloated under sort "${sortLabel}"`
          );
        }
      }
    },
  },
  {
    id: 'T2-D4',
    tier: 2,
    area: 'D',
    features: ['F15'],
    title: 'Completed nested layer transitions silhouette boundary cleanly with zero neon-green halo',
    run: async (env) => {
      const fx = getCommonFixtures();
      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        extraSettings: {
          canvasBgColor: 'CUSTOM',
          canvasBgArgb: 0xff00ff00,
          reducedMotion: true,
        },
        beforeGoto: async (p) => {
          await attachPuterNetworkSpy(p);
          await injectPuterMockV3(p, fx.bank1Png.dataUrl);
        },
      });
      // Use alpha cutout puzzle so #00FF00 backdrop genuinely shows through transparent void
      const snapId = await uploadTestPhoto(page, {
        name: 'cutout-completed-layer.png',
        mimeType: 'image/png',
        buffer: fx.alphaCutout.buffer,
      });

      await startZoomInSubdivide(page, snapId, { singleTarget: true });
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 20000 });
      await waitForViewportSettled(page, (vp) => vp.zoomScale > 1.2, 5000);

      const summary = await readPuzzleSummary(page, snapId);
      const layerId = summary.nestedLayers[0].layerId;
      const beforeComplete = await probeNestedSilhouetteSeam(page, snapId, layerId);
      assert.ok(beforeComplete && beforeComplete.sampleCount >= 10);
      assert.equal(
        beforeComplete.backdropNeonGreenConfirmed,
        true,
        'Alpha cutout must expose #00FF00 backdrop before completion'
      );
      assert.equal(beforeComplete.neonGreenPixels, 0);

      // Complete all regions in the nested layer and reload (persisted viewport stays focused on layer)
      await completeNestedLayerAndReload(page, snapId, layerId);
      const afterComplete = await probeNestedSilhouetteSeam(page, snapId, layerId);
      assert.ok(afterComplete && afterComplete.sampleCount >= 10);
      assert.equal(
        afterComplete.backdropNeonGreenConfirmed,
        true,
        'Alpha cutout must expose #00FF00 backdrop after completion'
      );
      assert.equal(
        afterComplete.neonGreenPixels,
        0,
        'Completed nested layer must have zero neon-green halo pixels along boundary'
      );

      // Verify pixels changed cleanly when layer completed
      let pixelDiffs = 0;
      const count = Math.min(beforeComplete.signatures.length, afterComplete.signatures.length);
      for (let i = 0; i < count; i++) {
        const a = beforeComplete.signatures[i];
        const b = afterComplete.signatures[i];
        if (Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) >= 15) {
          pixelDiffs += 1;
        }
      }
      assert.ok(pixelDiffs >= 3, 'Expected visible silhouette transition after completing nested layer');
    },
  },
  {
    id: 'T2-D5',
    tier: 2,
    area: 'D',
    features: ['F6', 'F12', 'F16'],
    title: 'Mobile 360x780 & 640x360 + 1.25x Large Text with > 64 swatches: zero overflow & >= 44px targets',
    run: async (env) => {
      const fx = getCommonFixtures();
      const { page } = await env.openIsolatedPage({
        viewport: { width: 360, height: 780 },
        easyNoReplay: true,
        extraSettings: {
          largeText: true,
          reducedMotion: true,
          showResetViewButton: true,
          generatorConfig: {
            algorithm: 'POSTERIZED',
            preset: 'HIGH',
            paletteDetail: 'CUSTOM',
            colorCount: 64,
            maxRegions: 300,
          },
        },
        beforeGoto: async (p) => {
          await attachPuterNetworkSpy(p);
          await injectPuterMockV3(p, fx.bank1Png.dataUrl, {
            responseQueue: [fx.bank1Png.dataUrl, fx.bank2Png.dataUrl, fx.bank3Png.dataUrl],
          });
        },
      });

      const snapId = await uploadTestPhoto(page, {
        name: 'mobile-bank0.png',
        mimeType: 'image/png',
        buffer: fx.bank0Png.buffer,
      });

      // Confirm 1.25x Large Text attribute is active
      const ds = await page.evaluate(() => ({
        largeText: document.documentElement.dataset.largeText,
        uiBoosted: document.documentElement.dataset.uiBoosted,
      }));
      assert.equal(ds.largeText, 'true');
      assert.equal(ds.uiBoosted, 'true');

      // Loop up to 3 Puter Zoom Ins to genuinely surpass 64 swatches (<= 96) on mobile
      let summary = await readPuzzleSummary(page, snapId);
      for (let pass = 0; pass < 3 && summary.paletteCount <= 64; pass++) {
        if (pass > 0) {
          const resetBtn = page.getByTestId('reset-view-btn');
          if ((await resetBtn.count()) > 0 && (await resetBtn.isVisible())) {
            await resetBtn.click();
            await waitForViewportSettled(page, (vp) => vp.zoomScale <= 1.1, 4500);
          }
        }
        await startZoomInSubdivide(page, snapId, {
          singleTarget: true,
          onSelectionReady:
            pass === 0
              ? async () => {
                  await assertNoHorizontalOverflow(page, '360x780 region-selection-bar');
                  await assertMinTouchTarget(
                    page.getByTestId('region-selection-cancel-btn'),
                    '360x780 selection Cancel',
                    44
                  );
                  await assertMinTouchTarget(
                    page.getByTestId('region-selection-confirm-btn'),
                    '360x780 selection Confirm',
                    44
                  );
                }
              : null,
        });
        await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 25000 });
        await waitForViewportSettled(page);
        summary = await readPuzzleSummary(page, snapId);
      }

      assert.ok(
        summary.paletteCount > 64 && summary.paletteCount <= 96,
        `Expected mobile paletteCount in (64, 96], got ${summary.paletteCount}`
      );

      await assertNoHorizontalOverflow(page, '360x780 canvas');
      await assertMinTouchTarget(page.getByTestId('infinite-zoom-menu-btn'), '360x780 FAB', 44);

      await openInfiniteZoomPopover(page);
      await assertNoHorizontalOverflow(page, '360x780 popover');
      await assertMinTouchTarget(
        page.getByTestId('toolbar-infinite-zoom-in-btn'),
        '360x780 popover Zoom In',
        44
      );
      await assertMinTouchTarget(
        page.getByTestId('toolbar-infinite-zoom-out-btn'),
        '360x780 popover Zoom Out',
        44
      );
      await page.locator('button[aria-label="Close Infinite Zoom menu"]').click();

      // Reset view to 1x so unoccluded root target is guaranteed visible on 360x780 before Guided Gemini modal
      const resetBeforeGuided = page.getByTestId('reset-view-btn');
      if ((await resetBeforeGuided.count()) > 0 && (await resetBeforeGuided.isVisible())) {
        await resetBeforeGuided.click();
        await waitForViewportSettled(page, (vp) => vp.zoomScale <= 1.1, 4500);
      }

      // Switch to Guided Gemini & verify modal + Copy Image touch target & zero overflow on 360x780
      await configureInfiniteZoomProvider(page, { provider: 'GUIDED_GEMINI' });
      await startZoomInSubdivide(page, snapId, { singleTarget: true });
      await page.getByTestId('guided-gemini-modal').waitFor({ state: 'visible', timeout: 10000 });
      await assertNoHorizontalOverflow(page, '360x780 guided modal');
      await assertMinTouchTarget(page.getByTestId('guided-gemini-copy-image-btn'), '360x780 Copy Image', 44);
      await page.getByTestId('guided-gemini-cancel-btn').click();
      await page.getByTestId('guided-gemini-modal').waitFor({ state: 'hidden', timeout: 4000 });

      // Landscape 640x360 check
      await page.setViewportSize({ width: 640, height: 360 });
      await waitForAnimationFrames(page, 4);
      await assertNoHorizontalOverflow(page, '640x360 landscape');
      await assertMinTouchTarget(page.getByTestId('infinite-zoom-menu-btn'), '640x360 FAB', 44);
    },
  },

  // --------------------------------------------------------------------------
  // TIER 3: Cross-Feature Combinations (All 6 Pairwise Combinations)
  // --------------------------------------------------------------------------
  {
    id: 'T3-01',
    tier: 3,
    area: 'CROSS',
    features: ['F1', 'F2', 'F5', 'F7', 'F8', 'F9', 'F11'],
    title: 'Pair A+B: Puter Nano Banana 2 (quality 512, { w, h }, <900 KB) + colored-ink nested segmentation',
    run: async (env) => {
      const fx = getCommonFixtures();
      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        extraSettings: {
          nanoBananaModel: 'gemini-3.1-flash-image',
          nanoBananaResolution: '512',
        },
        beforeGoto: async (p) => {
          await attachPuterNetworkSpy(p);
          await injectPuterMockV3(p, fx.coloredInkArt.dataUrl);
        },
      });
      const snapId = (await readActiveSession(page)).activeSnapshotId;

      await startZoomInSubdivide(page, snapId, { singleTarget: false });
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 25000 });

      const calls = await page.evaluate(() => window.__puterCalls);
      assert.equal(calls.length, 1);
      assertValidPuterPayload(calls[0], {
        expectedModel: 'gemini-3.1-flash-image',
        expectedQuality: '512',
      });

      const summary = await readPuzzleSummary(page, snapId);
      assert.equal(summary.nestedLayers.length, 1);
      const layer = summary.nestedLayers[0];
      assert.ok(layer.regionCount >= 6, `Colored-ink nested layer expected >= 6 regions, got ${layer.regionCount}`);
      assert.equal(layer.invalidMapPixels, 0);
      assert.ok(layer.exteriorZeroCount > 0);
    },
  },
  {
    id: 'T3-02',
    tier: 3,
    area: 'CROSS',
    features: ['F3', 'F6', 'F14'],
    title: 'Pair A+C: Puter insufficient_funds -> Guided Copy Image + upload -> Auto-Focus -> Undo Split restore',
    run: async (env) => {
      const fx = getCommonFixtures();
      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        extraSettings: { showZoomButtons: true, reducedMotion: false },
        beforeGoto: async (p) => {
          await attachPuterNetworkSpy(p);
          await injectPuterMockV3(p, fx.standardPattern.dataUrl, { mode: 'insufficient_funds' });
          await injectClipboardMock(p, { mode: 'ok' });
        },
      });
      const snapId = (await readActiveSession(page)).activeSnapshotId;
      await page.getByTestId('zoom-in-btn').click();
      const preVp = await waitForViewportSettled(page, (vp) => vp.zoomScale > 1.15, 4500);

      await startZoomInSubdivide(page, snapId, { singleTarget: true });
      const modal = page.getByTestId('guided-gemini-modal');
      await modal.waitFor({ state: 'visible', timeout: 10000 });
      await page.getByTestId('guided-gemini-fallback-notice').waitFor({ state: 'visible', timeout: 3000 });

      await page.getByTestId('guided-gemini-copy-image-btn').click();
      const copied = await waitForCondition(
        async () => (await page.evaluate(() => window.__clipboardState.writeCalls.length)) === 1,
        3000
      );
      assert.equal(copied, true);

      await page.getByTestId('guided-gemini-file-input').setInputFiles({
        name: 'guided-return.png',
        mimeType: 'image/png',
        buffer: fx.standardPattern.buffer,
      });
      await modal.waitFor({ state: 'hidden', timeout: 20000 });
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 10000 });

      // Auto-focus must glide onto new layer
      await waitForViewportSettled(page, (vp) => vp.zoomScale > preVp.zoomScale + 0.1, 6000);

      // Undo Split restores preVp & removes layer
      await page.getByTestId('undo-subdivision-btn').click();
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'hidden', timeout: 6000 });
      const restoredVp = await waitForViewportSettled(
        page,
        (vp) => Math.abs(vp.zoomScale - preVp.zoomScale) < 0.15,
        5000
      );
      assert.ok(Math.abs(restoredVp.zoomScale - preVp.zoomScale) < 0.15);
      assert.equal((await readPuzzleSummary(page, snapId)).nestedLayers.length, 0);
    },
  },
  {
    id: 'T3-03',
    tier: 3,
    area: 'CROSS',
    features: ['F4', 'F5', 'F12', 'F16'],
    title: 'Pair A+D: Direct Gemini BYOK compact transfer -> >64 palette + PaletteDock float + zero-leak .capy v2',
    run: async (env) => {
      const fx = getCommonFixtures();
      let byokReqs = [];
      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        acceptDownloads: true,
        extraSettings: {
          reducedMotion: true,
          showResetViewButton: true,
          generatorConfig: {
            algorithm: 'POSTERIZED',
            preset: 'HIGH',
            paletteDetail: 'CUSTOM',
            colorCount: 64,
            maxRegions: 400,
          },
        },
        beforeGoto: async (p) => {
          byokReqs = await installGeminiByokRouteMock(p, fx.bank1Png.base64, {
            responseBase64Queue: [fx.bank1Png.base64, fx.bank2Png.base64, fx.bank3Png.base64],
          });
        },
      });
      await configureInfiniteZoomProvider(page, {
        provider: 'GEMINI_BYOK',
        model: 'gemini-nano-banana-2.1',
        resolution: '1K',
        byokKey: TEST_BYOK_KEY,
      });

      const snapId = await uploadTestPhoto(page, {
        name: 'byok-bank0.png',
        mimeType: 'image/png',
        buffer: fx.bank0Png.buffer,
      });

      let summary = await readPuzzleSummary(page, snapId);
      for (let i = 0; i < 3 && summary.paletteCount <= 64; i++) {
        if (i > 0) {
          const resetBtn = page.getByTestId('reset-view-btn');
          if ((await resetBtn.count()) > 0 && (await resetBtn.isVisible())) {
            await resetBtn.click();
            await waitForViewportSettled(page, (vp) => vp.zoomScale <= 1.1, 4500);
          }
        }
        await startZoomInSubdivide(page, snapId, { singleTarget: true });
        await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 25000 });
        await waitForViewportSettled(page);
        summary = await readPuzzleSummary(page, snapId);
      }

      assert.ok(summary.paletteCount > 64 && summary.paletteCount <= 96);
      assert.ok(byokReqs.length >= 1);
      for (const req of byokReqs) {
        const inlinePart = (req.body?.contents?.[0]?.parts || []).find((p) => p?.inlineData);
        const buf = Buffer.from(inlinePart.inlineData.data, 'base64');
        assert.ok(buf.byteLength <= MAX_AI_TEMPLATE_BYTES);
        assert.equal(inlinePart.inlineData.mimeType, detectImageMimeFromBuffer(buf));
      }

      const floated = await waitForCondition(async () => (await readPaletteDockOrder(page)).floatedCount > 0, 4500);
      assert.equal(floated, true, 'Nested swatches must float after BYOK Zoom In');

      await openSettingsTab(page, 'saves');
      await page.getByTestId(`save-card-${snapId}`).click();
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }),
        page.getByTestId('save-action-export').click(),
      ]);
      const capyBuf = fs.readFileSync(await download.path());
      const parsed = inspectCapyV2Buffer(capyBuf, TEST_BYOK_KEY);
      assert.ok(parsed.compactPuzzle.palette.length > 64 && parsed.compactPuzzle.palette.length <= 96);
    },
  },
  {
    id: 'T3-04',
    tier: 3,
    area: 'CROSS',
    features: ['F8', 'F10', 'F11', 'F14'],
    title: 'Pair B+C: High-density Zoom In + mid-glide cancel + nested paint + Zoom Out & Undo Extend',
    run: async (env) => {
      const fx = getCommonFixtures();
      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        extraSettings: { reducedMotion: false },
        beforeGoto: async (p) => {
          await attachPuterNetworkSpy(p);
          await injectPuterMockV3(p, fx.highDensityPattern.dataUrl, {
            responseQueue: [fx.highDensityPattern.dataUrl, fx.standardPattern.dataUrl],
          });
        },
      });
      const snapId = (await readActiveSession(page)).activeSnapshotId;

      const canvasBox = await page.getByTestId('puzzle-canvas').boundingBox();
      assert.ok(canvasBox, 'Expected puzzle-canvas bounding box before Zoom In commit');
      const cx = canvasBox.x + canvasBox.width / 2;
      const cy = canvasBox.y + canvasBox.height / 2;

      await startZoomInSubdivide(page, snapId, {
        singleTarget: false,
        onSelectionReady: async () => {
          await armMidGlideWheelCancel(page, { clientX: cx, clientY: cy, deltaY: 350, ticks: 1 });
        },
      });
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 25000 });

      // Verify mid-glide wheel cancel fired cleanly
      const cancelFired = await waitForCondition(
        () => page.evaluate(() => Boolean(window.__capyMidGlideCancelResult?.fired)),
        5000
      );
      assert.equal(cancelFired, true, 'Expected mid-glide wheel cancel to fire in T3-04');
      const cancelResult = await page.evaluate(() => window.__capyMidGlideCancelResult);
      assert.equal(
        cancelResult?.defaultPrevented,
        true,
        `Expected puzzle-canvas wheel handler to preventDefault mid-glide in T3-04 (got ${JSON.stringify(cancelResult)})`
      );
      const preOutVp = await waitForViewportSettled(page, (vp) => vp.zoomScale < 0.95, 5000);

      const postIn = await readPuzzleSummary(page, snapId);
      assert.ok(postIn.nestedLayers[0].regionCount >= 80);

      const targets = await findUnifiedRegionTargets(page, snapId);
      assert.ok(targets.unfilledNestedTargets.length > 0);
      const paintedTarget = targets.unfilledNestedTargets[0];
      await paintTargetRegion(page, paintedTarget);

      // Zoom Out -> verify painted nested region preserved -> Undo Extend restores dimensions & viewport
      await triggerZoomOut(page, { top: false, bottom: true, left: false, right: true });
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 25000 });

      const afterOut = await readPuzzleSummary(page, snapId);
      assert.ok(afterOut.width > postIn.width && afterOut.height > postIn.height);
      const sessAfterOut = await readActiveSession(page);
      assert.ok((sessAfterOut.filledRegionIds || []).includes(paintedTarget.id));

      await page.getByTestId('undo-subdivision-btn').click();
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'hidden', timeout: 6000 });
      const restored = await readPuzzleSummary(page, snapId);
      assert.equal(restored.width, postIn.width);
      assert.equal(restored.height, postIn.height);
      const restoredVp = await waitForViewportSettled(
        page,
        (vp) => Math.abs(vp.zoomScale - preOutVp.zoomScale) < 0.25,
        5000
      );
      assert.ok(Math.abs(restoredVp.zoomScale - preOutVp.zoomScale) < 0.25);
    },
  },
  {
    id: 'T3-05',
    tier: 3,
    area: 'CROSS',
    features: ['F8', 'F9', 'F15', 'F16'],
    title: 'Pair B+D: Colored-ink nested layer on neon-green backdrop (zero halo) + PaletteDock float + shortcut paint',
    run: async (env) => {
      const fx = getCommonFixtures();
      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        extraSettings: {
          canvasBgColor: 'CUSTOM',
          canvasBgArgb: 0xff00ff00,
          reducedMotion: true,
        },
        beforeGoto: async (p) => {
          await attachPuterNetworkSpy(p);
          await injectPuterMockV3(p, fx.coloredInkArt.dataUrl);
        },
      });
      // Upload alpha cutout base puzzle so #00FF00 genuinely exposes behind transparent void
      const snapId = await uploadTestPhoto(page, {
        name: 'cutout-colored-ink-base.png',
        mimeType: 'image/png',
        buffer: fx.alphaCutout.buffer,
      });

      await startZoomInSubdivide(page, snapId, { singleTarget: true });
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 25000 });
      await waitForViewportSettled(page, (vp) => vp.zoomScale > 1.2, 5000);

      const summary = await readPuzzleSummary(page, snapId);
      const layer = summary.nestedLayers[0];
      assert.ok(layer.regionCount >= 5);

      const seam = await probeNestedSilhouetteSeam(page, snapId, layer.layerId);
      assert.ok(seam && seam.sampleCount >= 10, `Expected >= 10 seam samples, got ${seam?.sampleCount}`);
      assert.equal(
        seam.backdropNeonGreenConfirmed,
        true,
        'Alpha cutout must expose #00FF00 backdrop outside mask in T3-05'
      );
      assert.equal(seam.neonGreenPixels, 0, 'Zero neon-green backdrop halo allowed on colored-ink nested layer');
      assert.ok(
        seam.contrastHits / seam.sampleCount >= 0.5,
        `Expected continuous silhouette hairline contrast in T3-05, got ${seam.contrastHits}/${seam.sampleCount}`
      );

      const floated = await waitForCondition(async () => (await readPaletteDockOrder(page)).floatedCount > 0, 4500);
      assert.equal(floated, true);
      const dock = await readPaletteDockOrder(page);
      assert.equal(dock.hasDivider, true);
      assert.ok(dock.swatches.length >= 2, 'Expected >= 2 swatches in T3-05');

      // Select non-leading swatch first so pressing '1' genuinely activates dock.swatches[0]
      const nonLeadingId = dock.swatches[dock.swatches.length - 1].testId;
      await page.getByTestId(nonLeadingId).click();
      const nonLeadOk = await waitForCondition(
        async () => (await page.getByTestId(nonLeadingId).getAttribute('aria-pressed')) === 'true',
        3000
      );
      assert.equal(nonLeadOk, true);

      await page.keyboard.press('1');
      const selected = await waitForCondition(
        async () => (await page.getByTestId(dock.swatches[0].testId).getAttribute('aria-pressed')) === 'true',
        3000
      );
      assert.equal(selected, true);

      const remBefore = await readTotalRemainingRegions(page);
      const targets = await findUnifiedRegionTargets(page, snapId);
      assert.ok(targets.unfilledNestedTargets.length > 0, 'Expected clickable unfilled nested target in T3-05');
      await paintTargetRegion(page, targets.unfilledNestedTargets[0]);
      const remAfter = await readTotalRemainingRegions(page);
      assert.equal(remAfter, remBefore - 1, 'Remaining count must decrement by 1 after painting nested region');
    },
  },
  {
    id: 'T3-06',
    tier: 3,
    area: 'CROSS',
    features: ['F14', 'F16'],
    title: 'Pair C+D: Multi-depth Auto-Focus (Depth 1 -> 2) updates floated swatches & Undo Split reverts both',
    run: async (env) => {
      const fx = getCommonFixtures();
      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        extraSettings: { reducedMotion: true },
        beforeGoto: async (p) => {
          await attachPuterNetworkSpy(p);
          await injectPuterMockV3(p, fx.bank1Png.dataUrl, {
            responseQueue: [fx.bank1Png.dataUrl, fx.bank2Png.dataUrl],
          });
        },
      });
      const snapId = (await readActiveSession(page)).activeSnapshotId;

      // Depth 1 Zoom In (Bank 1)
      await startZoomInSubdivide(page, snapId, { singleTarget: true });
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 25000 });
      const vpDepth1 = await waitForViewportSettled(page, (vp) => vp.zoomScale > 1.2, 5000);
      const d1Floated = await waitForCondition(async () => (await readPaletteDockOrder(page)).floatedCount > 0, 4500);
      assert.equal(d1Floated, true);
      const dockDepth1 = await readPaletteDockOrder(page);
      const d1FloatedNums = dockDepth1.swatches.filter((s) => s.isNestedFloated).map((s) => s.displayNumber);

      // Depth 2 Zoom In inside Depth 1 (Bank 2)
      await startZoomInSubdivide(page, snapId, { useNestedTarget: true });
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 25000 });
      const vpDepth2 = await waitForViewportSettled(page, (vp) => vp.zoomScale > vpDepth1.zoomScale, 5000);
      assert.ok(vpDepth2.zoomScale > vpDepth1.zoomScale, 'Depth 2 auto-focus must zoom deeper than Depth 1');

      const d2Updated = await waitForCondition(async () => {
        const d = await readPaletteDockOrder(page);
        const nums = d.swatches.filter((s) => s.isNestedFloated).map((s) => s.displayNumber);
        return nums.length > 0 && nums.some((n) => !d1FloatedNums.includes(n));
      }, 4500);
      assert.equal(d2Updated, true, 'Depth 2 auto-focus must float Depth 2 nested swatches');

      // Undo Split -> removes Depth 2, restores Depth 1 viewport & Depth 1 floated swatches
      await page.getByTestId('undo-subdivision-btn').click();
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'hidden', timeout: 6000 });
      const revertedVp = await waitForViewportSettled(
        page,
        (vp) => Math.abs(vp.zoomScale - vpDepth1.zoomScale) < 0.25,
        5000
      );
      assert.ok(Math.abs(revertedVp.zoomScale - vpDepth1.zoomScale) < 0.25);
      const postSummary = await readPuzzleSummary(page, snapId);
      assert.equal(postSummary.nestedLayers.length, 1);

      const d1Restored = await waitForCondition(async () => {
        const d = await readPaletteDockOrder(page);
        const nums = d.swatches.filter((s) => s.isNestedFloated).map((s) => s.displayNumber);
        return nums.length > 0 && d1FloatedNums.some((n) => nums.includes(n));
      }, 4500);
      assert.equal(d1Restored, true, 'Undo Split must revert floated swatches back to Depth 1');
    },
  },

  // --------------------------------------------------------------------------
  // TIER 4: Real-World Application Scenarios (5 End-to-End User Workflows)
  // --------------------------------------------------------------------------
  {
    id: 'T4-01',
    tier: 4,
    area: 'E2E',
    features: ['F3', 'F4', 'F5', 'F6', 'F11', 'F14', 'F15', 'F16'],
    title: 'Real-World Scenario 1: Guided Gemini Free User full journey (fallback -> copy -> paste -> paint -> reload)',
    run: async (env) => {
      const fx = getCommonFixtures();
      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        acceptDownloads: true,
        extraSettings: { canvasBgColor: 'CUSTOM', canvasBgArgb: 0xff00ff00 },
        beforeGoto: async (p) => {
          await attachPuterNetworkSpy(p);
          await injectPuterMockV3(p, fx.bank1Png.dataUrl, { mode: 'insufficient_funds' });
          await injectClipboardMock(p, { mode: 'ok' });
          await injectWindowOpenStub(p);
        },
      });
      const snapId = (await readActiveSession(page)).activeSnapshotId;

      // 1. User attempts Zoom In -> Puter balance exhausted -> automatic Guided Gemini fallback
      await startZoomInSubdivide(page, snapId, { singleTarget: true, prompt: 'cozy botanical detail' });
      const modal = page.getByTestId('guided-gemini-modal');
      await modal.waitFor({ state: 'visible', timeout: 10000 });
      await page.getByTestId('guided-gemini-fallback-notice').waitFor({ state: 'visible', timeout: 3000 });

      // 2. User taps Copy Image (PNG ClipboardItem) and Copy Prompt & Open Gemini (< 900 KB download)
      await page.getByTestId('guided-gemini-copy-image-btn').click();
      const copiedFeedback = await waitForCondition(
        async () => (await page.getByTestId('guided-gemini-copy-image-btn').innerText()).includes('Copied Image'),
        3000
      );
      assert.equal(copiedFeedback, true, 'Expected Copy Image button to display "Copied Image" feedback');
      const clipState = await page.evaluate(() => window.__clipboardState);
      assert.ok(
        clipState && clipState.writeCalls.length >= 1,
        'Expected Copy Image to invoke navigator.clipboard.write at least once'
      );
      const [dl] = await Promise.all([
        page.waitForEvent('download', { timeout: 10000 }),
        page.getByTestId('guided-gemini-launch-btn').click(),
      ]);
      const dlBuf = fs.readFileSync(await dl.path());
      assert.ok(dlBuf.byteLength > 0 && dlBuf.byteLength <= MAX_AI_TEMPLATE_BYTES);

      // 3. User pastes Gemini output back via ClipboardEvent('paste')
      await dispatchSyntheticImagePaste(page, fx.bank1Png.base64, 'image/png');
      await modal.waitFor({ state: 'hidden', timeout: 20000 });
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 10000 });

      // 4. Camera auto-focuses, nested swatches float, seam shows crisp hairline & zero halo
      await waitForViewportSettled(page, (vp) => vp.zoomScale > 1.25, 6000);
      const floated = await waitForCondition(async () => (await readPaletteDockOrder(page)).floatedCount > 0, 4500);
      assert.equal(floated, true);

      const summary = await readPuzzleSummary(page, snapId);
      const seam = await probeNestedSilhouetteSeam(page, snapId, summary.nestedLayers[0].layerId);
      assert.ok(seam && seam.sampleCount >= 10, `Expected >= 10 silhouette seam samples in T4-01, got ${seam?.sampleCount}`);
      assert.equal(seam.neonGreenPixels, 0);
      assert.ok(
        seam.contrastHits / seam.sampleCount >= 0.5,
        `Expected visible silhouette hairline contrast in T4-01, got ${seam.contrastHits}/${seam.sampleCount}`
      );

      // 5. Select a non-first swatch, press '1' -> activates leading floated swatch, paint & reload
      const dock = await readPaletteDockOrder(page);
      assert.ok(dock.swatches.length >= 2, 'Expected >= 2 swatches in T4-01');
      const nonFirstId = dock.swatches[dock.swatches.length - 1].testId;
      await page.getByTestId(nonFirstId).click();
      const nonFirstSelected = await waitForCondition(
        async () => (await page.getByTestId(nonFirstId).getAttribute('aria-pressed')) === 'true',
        3000
      );
      assert.equal(nonFirstSelected, true);

      await page.keyboard.press('1');
      const firstSelected = await waitForCondition(
        async () => (await page.getByTestId(dock.swatches[0].testId).getAttribute('aria-pressed')) === 'true',
        3000
      );
      assert.equal(firstSelected, true, `Pressing '1' in T4-01 must select leading floated swatch ${dock.swatches[0].testId}`);

      const targets = await findUnifiedRegionTargets(page, snapId);
      const pair = pickWellSeparatedTargets(targets.unfilledNestedTargets, 2);
      assert.ok(pair.length >= 1, 'Expected >= 1 clickable unfilled nested target in T4-01');
      for (const t of pair) await paintTargetRegion(page, t);
      const preReloadFilled = (await readActiveSession(page)).filledRegionIds || [];

      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForPuzzleLoaded(page);
      const postReloadSummary = await readPuzzleSummary(page, snapId);
      const postReloadFilled = (await readActiveSession(page)).filledRegionIds || [];
      assert.equal(postReloadSummary.nestedLayers.length, 1);
      for (const id of preReloadFilled) {
        assert.ok(postReloadFilled.includes(id), `Region ${id} must persist across reload`);
      }
    },
  },
  {
    id: 'T4-02',
    tier: 4,
    area: 'E2E',
    features: ['F1', 'F2', 'F5', 'F7', 'F8', 'F11', 'F13', 'F14', 'F16'],
    title: 'Real-World Scenario 2: Puter Power User multi-depth exploration, model switch, >12x zoom & Zoom Out',
    run: async (env) => {
      const fx = getCommonFixtures();
      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        extraSettings: { showZoomButtons: true, showResetViewButton: true, reducedMotion: true },
        beforeGoto: async (p) => {
          await attachPuterNetworkSpy(p);
          await injectPuterMockV3(p, fx.highDensityPattern.dataUrl, {
            responseQueue: [fx.highDensityPattern.dataUrl, fx.bank2Png.dataUrl, fx.standardPattern.dataUrl],
          });
        },
      });
      const snapId = (await readActiveSession(page)).activeSnapshotId;

      // 1. Configure 2.1 @ 2K and perform Depth-1 high-density Zoom In
      await configureInfiniteZoomProvider(page, {
        provider: 'PUTER',
        model: 'gemini-nano-banana-2.1',
        resolution: '2K',
      });
      await startZoomInSubdivide(page, snapId, { singleTarget: true });
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 25000 });
      await waitForViewportSettled(page, (vp) => vp.zoomScale > 1.2, 5000);

      let calls = await page.evaluate(() => window.__puterCalls);
      assertValidPuterPayload(calls[0], { expectedModel: 'gemini-nano-banana-2.1', expectedQuality: '2K' });

      const t1 = await findUnifiedRegionTargets(page, snapId);
      const paintD1 = pickWellSeparatedTargets(t1.unfilledNestedTargets, 2);
      assert.ok(paintD1.length >= 1, 'Expected >= 1 paintable Depth-1 nested target in T4-02');
      for (const t of paintD1) await paintTargetRegion(page, t);

      // 2. Switch to 2 Lite (clamps to 1K) & perform Depth-2 Zoom In
      await configureInfiniteZoomProvider(page, { model: 'gemini-3.1-flash-lite-image' });
      await startZoomInSubdivide(page, snapId, { useNestedTarget: true });
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 25000 });
      await waitForViewportSettled(page);

      calls = await page.evaluate(() => window.__puterCalls);
      assertValidPuterPayload(calls[1], { expectedModel: 'gemini-3.1-flash-lite-image', expectedQuality: '1K' });

      // 3. Verify > 12x deep zoom headroom
      for (let i = 0; i < 12; i++) {
        await page.getByTestId('zoom-in-btn').click();
        await waitForAnimationFrames(page, 1);
      }
      const deepVp = await waitForViewportSettled(page, (vp) => vp.zoomScale > 12, 5000);
      assert.ok(deepVp.zoomScale > 12 && deepVp.zoomScale <= 256);

      // 4. Reset View -> swatches unfloat -> perform Zoom Out (Right + Bottom)
      await page.getByTestId('reset-view-btn').click();
      await waitForViewportSettled(page, (vp) => vp.zoomScale <= 1.1, 4500);
      const unfloated = await waitForCondition(
        async () => (await readPaletteDockOrder(page)).floatedCount === 0,
        4000
      );
      assert.equal(unfloated, true, 'Expected Reset View to unfloat nested swatches in T4-02');

      const preOut = await readPuzzleSummary(page, snapId);
      await triggerZoomOut(page, { top: false, bottom: true, left: false, right: true });
      // Wait on actual expanded canvas dimensions so a stale Depth-2 toast cannot resolve prematurely
      const extendedDone = await waitForCondition(async () => {
        const s = await readPuzzleSummary(page, snapId);
        return Boolean(s && s.width > preOut.width && s.height > preOut.height);
      }, 25000);
      assert.equal(extendedDone, true, 'Expected Zoom Out to commit expanded canvas dimensions in T4-02');
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 5000 });
      const undoExtendText = await page.getByTestId('undo-subdivision-btn').innerText();
      assert.ok(undoExtendText.includes('Undo Extend'), `Expected Undo Extend toast, got "${undoExtendText}"`);
      const postOut = await readPuzzleSummary(page, snapId);
      assert.ok(postOut.width > preOut.width && postOut.height > preOut.height);

      // 5. Verify zero legacy breadcrumb buttons & clean reload persistence
      assert.equal(await page.getByTestId('topbar-parent-puzzle-btn').count(), 0);
      assert.equal(await page.getByTestId('topbar-child-puzzle-btn').count(), 0);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForPuzzleLoaded(page);
      const reloaded = await readPuzzleSummary(page, snapId);
      assert.equal(reloaded.width, postOut.width);
      assert.equal(reloaded.height, postOut.height);
      assert.ok(reloaded.maxZoomDepth >= 2);
    },
  },
  {
    id: 'T4-03',
    tier: 4,
    area: 'E2E',
    features: ['F1', 'F5', 'F10', 'F12', 'F15', 'F16'],
    title: 'Real-World Scenario 3: Max-Detail 64->96 Color Artist workflow with Clean Preview & .capy v2 share',
    run: async (env) => {
      const fx = getCommonFixtures();
      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        acceptDownloads: true,
        extraSettings: {
          reducedMotion: true,
          showResetViewButton: true,
          showPreviewBorders: false,
          canvasBgColor: 'CUSTOM',
          canvasBgArgb: 0xff00ff00,
          generatorConfig: {
            algorithm: 'POSTERIZED',
            preset: 'HIGH',
            paletteDetail: 'CUSTOM',
            colorCount: 64,
            maxRegions: 400,
          },
        },
        beforeGoto: async (p) => {
          await attachPuterNetworkSpy(p);
          await injectPuterMockV3(p, fx.bank1Png.dataUrl, {
            responseQueue: [fx.bank1Png.dataUrl, fx.bank2Png.dataUrl, fx.bank3Png.dataUrl],
          });
        },
      });

      const snapId = await uploadTestPhoto(page, {
        name: 'artist-60colors.png',
        mimeType: 'image/png',
        buffer: fx.bank0Png.buffer,
      });

      // Paint 2 root regions
      const rootT = await findUnifiedRegionTargets(page, snapId);
      const rootPaint = pickWellSeparatedTargets(rootT.unfilledRootTargets, 2);
      assert.ok(rootPaint.length >= 1, 'Expected >= 1 paintable root target in T4-03');
      for (const t of rootPaint) {
        await paintTargetRegion(page, t);
      }

      // Add up to 3 disjoint nested layers pushing palette > 64 and <= 96
      let summary = await readPuzzleSummary(page, snapId);
      for (let i = 0; i < 3 && summary.paletteCount <= 64; i++) {
        if (i > 0) {
          const resetBtn = page.getByTestId('reset-view-btn');
          if ((await resetBtn.count()) > 0 && (await resetBtn.isVisible())) {
            await resetBtn.click();
            await waitForViewportSettled(page, (vp) => vp.zoomScale <= 1.1, 4500);
          }
        }
        await startZoomInSubdivide(page, snapId, { singleTarget: true });
        await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 25000 });
        await waitForViewportSettled(page);
        summary = await readPuzzleSummary(page, snapId);
      }
      assert.ok(summary.paletteCount > 64 && summary.paletteCount <= 96);

      // Verify floated swatches, clean seam, Clean Preview toggle & nested painting
      const floated = await waitForCondition(
        async () => (await readPaletteDockOrder(page)).floatedCount > 0,
        4500
      );
      assert.equal(floated, true, 'Expected nested swatches to float in T4-03');
      const lastLayer = summary.nestedLayers[summary.nestedLayers.length - 1];
      const seam = await probeNestedSilhouetteSeam(page, snapId, lastLayer.layerId);
      assert.ok(seam && seam.sampleCount >= 10, `Expected >= 10 seam samples in T4-03, got ${seam?.sampleCount}`);
      assert.equal(seam.neonGreenPixels, 0);
      assert.ok(
        seam.contrastHits / seam.sampleCount >= 0.5,
        `Expected visible silhouette hairline contrast in T4-03, got ${seam.contrastHits}/${seam.sampleCount}`
      );

      // Verify Clean Preview mode actually toggles state and updates silhouette pixels
      await page.getByTestId('topbar-preview-btn').click();
      const previewOn = await waitForCondition(
        async () => (await page.getByTestId('topbar-preview-btn').getAttribute('aria-label')) === 'Return to Puzzle',
        3000
      );
      assert.equal(previewOn, true, 'Expected Clean Preview mode to activate in T4-03');
      const previewSamples = await sampleCanvasAtCoordinates(page, seam.signatures);
      let previewDiffs = 0;
      for (let i = 0; i < seam.signatures.length; i++) {
        const a = seam.signatures[i];
        const b = previewSamples[i];
        if (!b) continue;
        if (Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) >= 12) {
          previewDiffs += 1;
        }
      }
      assert.ok(
        previewDiffs >= Math.max(3, Math.floor(seam.signatures.length * 0.2)),
        `Expected Clean Preview to visually change silhouette pixels in T4-03 (${previewDiffs}/${seam.signatures.length})`
      );
      await page.getByTestId('topbar-preview-btn').click();
      const previewOff = await waitForCondition(
        async () => (await page.getByTestId('topbar-preview-btn').getAttribute('aria-label')) !== 'Return to Puzzle',
        3000
      );
      assert.equal(previewOff, true, 'Expected Clean Preview mode to return to puzzle in T4-03');
      await waitForAnimationFrames(page, 3);

      const nestedT = await findUnifiedRegionTargets(page, snapId);
      assert.ok(
        nestedT.unfilledNestedTargets.length > 0,
        'Expected clickable unfilled nested target in T4-03'
      );
      await paintTargetRegion(page, nestedT.unfilledNestedTargets[0]);

      // Export .capy v2 and verify lossless import in a clean second context
      await openSettingsTab(page, 'saves');
      await page.getByTestId(`save-card-${snapId}`).click();
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }),
        page.getByTestId('save-action-export').click(),
      ]);
      const capyBuf = fs.readFileSync(await download.path());
      inspectCapyV2Buffer(capyBuf);

      const { page: receiverPage } = await env.openIsolatedPage({ easyNoReplay: true });
      await openSettingsTab(receiverPage, 'saves');
      await receiverPage.locator('input[type="file"][accept*=".capy"]').setInputFiles({
        name: 'artist-shared.capy',
        mimeType: 'application/octet-stream',
        buffer: capyBuf,
      });
      await receiverPage.getByTestId('saves-import-notice').waitFor({ state: 'visible', timeout: 15000 });
      const snaps = await readSnapshots(receiverPage);
      const imported = snaps.find((s) => s.totalCount === summary.totalRegionCount) || snaps[0];
      await receiverPage.getByTestId(`save-card-${imported.id}`).click();
      await receiverPage.getByTestId('save-action-load').click();
      await waitForPuzzleLoaded(receiverPage);

      const restored = await readPuzzleSummary(receiverPage, imported.id);
      assert.equal(restored.paletteCount, summary.paletteCount);
      assert.equal(restored.nestedLayers.length, summary.nestedLayers.length);
      assert.equal(restored.totalRegionCount, summary.totalRegionCount);
    },
  },
  {
    id: 'T4-04',
    tier: 4,
    area: 'E2E',
    features: ['F9', 'F14', 'F16'],
    title: 'Real-World Scenario 4: Accessibility & Reduced Motion mobile player (360x780 & 640x360)',
    run: async (env) => {
      const fx = getCommonFixtures();
      const { page } = await env.openIsolatedPage({
        viewport: { width: 360, height: 780 },
        easyNoReplay: true,
        extraSettings: { showResetViewButton: true },
        beforeGoto: async (p) => {
          await attachPuterNetworkSpy(p);
          await injectPuterMockV3(p, fx.bank1Png.dataUrl);
        },
      });

      // Enable Large Text (1.25x) & Reduced Motion via real Settings -> Accessibility UI
      await openSettingsTab(page, 'settings');
      await setSwitchState(page, 'setting-large-text', true);
      await setSwitchState(page, 'setting-reduced-motion', true);
      await closeSettingsModal(page);

      const settings = await readSettings(page);
      assert.equal(settings.largeText, true);
      assert.equal(settings.reducedMotion, true);
      assert.ok(settings.textScale >= 1.25);

      const snapId = await uploadTestPhoto(page, {
        name: 'mobile-colored-ink.png',
        mimeType: 'image/png',
        buffer: fx.coloredInkArt.buffer,
      });

      await startZoomInSubdivide(page, snapId, { singleTarget: true });
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 25000 });
      await waitForViewportSettled(page, (vp) => vp.zoomScale > 1.2, 5000);

      // Verify floated swatches under Remaining sort on mobile
      const floated = await waitForCondition(async () => (await readPaletteDockOrder(page)).floatedCount > 0, 4500);
      assert.equal(floated, true);

      await selectSettingsPaletteSort(page, 'Remaining');
      const floatedRemReady = await waitForCondition(
        async () => (await readPaletteDockOrder(page)).floatedCount > 0,
        4000
      );
      assert.equal(floatedRemReady, true, 'Expected floated swatches under Remaining sort in T4-04');
      const floatedRemDock = await readPaletteDockOrder(page);
      assert.equal(floatedRemDock.hasDivider, true, 'Expected nested divider under Remaining sort in T4-04');

      // Zero overflow & >= 44px touch targets in portrait while zoomed in
      await assertNoHorizontalOverflow(page, 'mobile-a11y portrait');
      await assertMinTouchTarget(page.getByTestId('infinite-zoom-menu-btn'), 'mobile-a11y FAB', 44);

      const targets = await findUnifiedRegionTargets(page, snapId);
      assert.ok(targets.unfilledNestedTargets.length > 0);
      const nestedPick = targets.unfilledNestedTargets[0];
      await paintTargetRegion(page, nestedPick);

      await page.getByTestId('undo-btn').click();
      const undone = await waitForCondition(
        async () => !((await readActiveSession(page)).filledRegionIds || []).includes(nestedPick.id),
        4000
      );
      assert.equal(undone, true);

      // Reset view to 1x and verify floated vs unfloated displayNumber -> styleBg invariance under the SAME Remaining sort
      await page.getByTestId('reset-view-btn').click();
      await waitForViewportSettled(page, (vp) => vp.zoomScale <= 1.1, 4500);
      const unfloatedRemReady = await waitForCondition(
        async () => (await readPaletteDockOrder(page)).floatedCount === 0,
        4500
      );
      assert.equal(unfloatedRemReady, true, 'Expected Reset View to unfloat swatches under Remaining sort in T4-04');
      const unfloatedRemDock = await readPaletteDockOrder(page);
      const unfloatedRemMap = new Map(unfloatedRemDock.swatches.map((s) => [s.displayNumber, s.styleBg]));
      assert.equal(unfloatedRemDock.swatches.length, floatedRemDock.swatches.length);
      for (const s of floatedRemDock.swatches) {
        assert.equal(
          s.styleBg,
          unfloatedRemMap.get(s.displayNumber),
          `Swatch #${s.displayNumber} shifted color between floated and unfloated under Remaining sort`
        );
      }

      await page.setViewportSize({ width: 640, height: 360 });
      await waitForAnimationFrames(page, 4);
      await assertNoHorizontalOverflow(page, 'mobile-a11y landscape');
    },
  },
  {
    id: 'T4-05',
    tier: 4,
    area: 'E2E',
    features: ['F2', 'F3', 'F4', 'F5', 'F6', 'F10', 'F13'],
    title: 'Real-World Scenario 5: Safety guardrails, abort rollback, BYOK grayscale & Android share-back',
    run: async (env) => {
      const fx = getCommonFixtures();
      // Phase 1: Web safety recovery + BYOK mid-flight abort + retry on grayscale
      const delayRef = { current: null };
      let releaseByok = null;
      let byokReqs = [];
      const { page } = await env.openIsolatedPage({
        easyNoReplay: true,
        extraSettings: { isFreeColorMode: false },
        beforeGoto: async (p) => {
          await attachPuterNetworkSpy(p);
          await injectPuterMockV3(p, fx.grayscalePatch.dataUrl, { mode: 'moderation_flagged' });
          byokReqs = await installGeminiByokRouteMock(p, fx.grayscalePatch.base64, {
            delayPromiseRef: delayRef,
          });
        },
      });
      const snapId = (await readActiveSession(page)).activeSnapshotId;

      // 1a. Puter moderation_flagged -> SAFETY_BLOCKED error toast (no Guided fallback)
      await startZoomInSubdivide(page, snapId, { singleTarget: true });
      const safetyToast = page.getByTestId('infinite-zoom-error-toast');
      await safetyToast.waitFor({ state: 'visible', timeout: 10000 });
      const safetyText = await safetyToast.innerText();
      assert.match(
        safetyText,
        /safety|policy|blocked|inappropriate|flagged|cannot generate|moderated/i,
        `Expected SAFETY_BLOCKED copy in T4-05, got "${safetyText}"`
      );
      assert.equal(await page.getByTestId('guided-gemini-modal').count(), 0);
      await page.getByTestId('infinite-zoom-error-dismiss').click();

      // 1b. Switch to BYOK, pause request, cancel mid-flight -> verify zero layer mutation
      await configureInfiniteZoomProvider(page, {
        provider: 'GEMINI_BYOK',
        model: 'gemini-nano-banana-2.1',
        resolution: '1K',
        byokKey: TEST_BYOK_KEY,
      });
      delayRef.current = new Promise((res) => {
        releaseByok = res;
      });
      await startZoomInSubdivide(page, snapId, { singleTarget: true });
      const byokReached = await waitForCondition(() => byokReqs.length >= 1, 8000);
      assert.equal(byokReached, true, 'Expected Direct Gemini BYOK network request before clicking cancel');
      const cancelBtn = page.getByTestId('loading-cancel-btn');
      await cancelBtn.waitFor({ state: 'visible', timeout: 8000 });
      await cancelBtn.click();
      await cancelBtn.waitFor({ state: 'hidden', timeout: 8000 });
      releaseByok();
      delayRef.current = null;
      await waitForAnimationFrames(page, 10);
      assert.equal((await readPuzzleSummary(page, snapId)).nestedLayers.length, 0);

      // 1c. Retry BYOK cleanly on grayscale -> isFreeColor stays false
      await startZoomInSubdivide(page, snapId, { singleTarget: true });
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 20000 });
      const postByok = await readPuzzleSummary(page, snapId);
      assert.equal(postByok.nestedLayers.length, 1);
      assert.equal(postByok.isFreeColor, false);
      assert.ok(byokReqs.length >= 2);
      assert.equal(await readByokKey(page), TEST_BYOK_KEY);

      // Phase 2: Android WebView share-out & LIFO share-back without stray snapshots
      const { page: androidPage } = await env.openIsolatedPage({
        easyNoReplay: true,
        beforeGoto: async (p) => {
          await injectAndroidWebViewMock(p);
        },
      });
      const androidSnapId = (await readActiveSession(androidPage)).activeSnapshotId;
      const preSnapCount = (await readSnapshots(androidPage)).length;

      await startZoomInSubdivide(androidPage, androidSnapId, { singleTarget: true });
      const androidModal = androidPage.getByTestId('guided-gemini-modal');
      await androidModal.waitFor({ state: 'visible', timeout: 10000 });
      assert.equal(await androidPage.getByTestId('guided-gemini-copy-image-btn').count(), 0);

      await androidPage.getByTestId('guided-gemini-launch-btn').click();
      await androidPage.waitForFunction(
        () => (window.__androidBridgeCalls?.shareImage?.length || 0) >= 1,
        { timeout: 5000 }
      );
      await androidPage
        .getByTestId('guided-gemini-modal')
        .locator('p[role="status"]')
        .waitFor({ state: 'visible', timeout: 5000 });
      const shares = await androidPage.evaluate(() => window.__androidBridgeCalls.shareImage);
      assert.equal(shares.length, 1);

      // Trigger Android share-back receiver
      await androidPage.evaluate((dataUrl) => {
        if (typeof window.__capyReceiveSharedImage !== 'function') {
          throw new Error('window.__capyReceiveSharedImage is not registered');
        }
        window.__capyReceiveSharedImage('Gemini Result', dataUrl);
      }, fx.standardPattern.dataUrl);

      await androidModal.waitFor({ state: 'hidden', timeout: 20000 });
      await androidPage.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 10000 });

      const postAndroidSummary = await readPuzzleSummary(androidPage, androidSnapId);
      assert.equal(postAndroidSummary.nestedLayers.length, 1);
      assert.equal(
        (await readSnapshots(androidPage)).length,
        preSnapCount,
        'Android share-back must embed into active puzzle without creating a stray snapshot'
      );
    },
  },
];

// ============================================================================
// Standalone CLI Argument Parser & Inventory Printer (Zero Browser Deps)
// ============================================================================

export function parseCliArgs(argv) {
  const opts = {
    list: false,
    json: false,
    help: false,
    tiers: [1, 2, 3, 4],
    testIds: [],
    filter: '',
    failFast: false,
    workers: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--list') {
      opts.list = true;
    } else if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--fail-fast') {
      opts.failFast = true;
    } else if (arg.startsWith('--tier=') || arg === '--tier') {
      const val = arg === '--tier' ? argv[++i] : arg.slice('--tier='.length);
      if (!val) throw new Error('Missing value for --tier (expected 1|2|3|4|all or comma-separated list)');
      if (val.toLowerCase() === 'all') {
        opts.tiers = [1, 2, 3, 4];
      } else {
        const parsed = val.split(',').map((s) => s.trim());
        if (parsed.length === 0) throw new Error(`Invalid --tier value: "${val}"`);
        const tiers = [];
        for (const token of parsed) {
          if (!/^[1-4]$/.test(token)) {
            throw new Error(`Invalid --tier value "${token}" (allowed: 1, 2, 3, 4, all)`);
          }
          const num = Number(token);
          if (!tiers.includes(num)) tiers.push(num);
        }
        opts.tiers = tiers.sort((a, b) => a - b);
      }
    } else if (arg.startsWith('--test=') || arg === '--test') {
      const val = arg === '--test' ? argv[++i] : arg.slice('--test='.length);
      if (!val) throw new Error('Missing value for --test');
      const tokens = val.split(',').map((s) => s.trim());
      for (const token of tokens) {
        if (!token) {
          throw new Error(`Invalid empty token in --test="${val}"`);
        }
        opts.testIds.push(token);
      }
    } else if (arg.startsWith('--filter=') || arg === '--filter') {
      const val = arg === '--filter' ? argv[++i] : arg.slice('--filter='.length);
      if (!val) throw new Error('Missing value for --filter');
      opts.filter = val;
    } else if (arg.startsWith('--workers=') || arg === '--workers') {
      const val = arg === '--workers' ? argv[++i] : arg.slice('--workers='.length);
      if (!val || !/^[1-9]\d*$/.test(val.trim())) {
        throw new Error(
          `Invalid --workers value "${val ?? ''}" (expected a positive integer >= 1)`
        );
      }
      opts.workers = Number.parseInt(val.trim(), 10);
    } else {
      throw new Error(`Unknown CLI argument: "${arg}". Run with --help for usage.`);
    }
  }
  return opts;
}

function selectTests(opts) {
  let list = TEST_REGISTRY.filter((t) => opts.tiers.includes(t.tier));
  if (opts.testIds.length > 0) {
    const knownIds = new Set(TEST_REGISTRY.map((t) => t.id.toUpperCase()));
    const unknownIds = opts.testIds.filter((id) => !knownIds.has(id.toUpperCase()));
    if (unknownIds.length > 0) {
      throw new Error(`Unknown --test ID(s): ${unknownIds.join(', ')}`);
    }
    const wanted = new Set(opts.testIds.map((id) => id.toUpperCase()));
    list = list.filter((t) => wanted.has(t.id.toUpperCase()));
    if (list.length === 0) {
      throw new Error(
        `No tests matched --test=${opts.testIds.join(',')} within selected tier(s) ${opts.tiers.join(',')}`
      );
    }
  }
  if (opts.filter) {
    const q = opts.filter.toLowerCase();
    list = list.filter(
      (t) =>
        t.id.toLowerCase().includes(q) ||
        t.title.toLowerCase().includes(q) ||
        t.area.toLowerCase().includes(q) ||
        t.features.some((f) => f.toLowerCase() === q)
    );
    if (list.length === 0) {
      throw new Error(`No tests matched --filter="${opts.filter}"`);
    }
  }
  return list;
}

function printHelp() {
  console.log(`Capy Paint Infinite Zoom v3 Opaque-Box E2E Suite (${TEST_REGISTRY.length} tests)

Usage:
  node web/scripts/tests/e2e/infinite-zoom-v3.e2e.mjs [options]

Options:
  --list                Print full tier/test inventory and exit 0 (no browser or dist/ required)
  --json                Output machine-readable JSON when combined with --list
  --tier=<spec>         Run specific tier(s): 1, 2, 3, 4, all, or CSV like 1,2 (default: all)
  --test=<id[,id]>      Run specific test ID(s), e.g. --test=T1-A1,T2-A1
  --filter=<substr>     Case-insensitive substring match against ID, area, feature, or title
  --workers=<n>         Max concurrent isolated browser contexts (default: min(2, CPUs) for >= 10 tests, else 1)
  --fail-fast           Stop immediately after the first failed test
  -h, --help            Show this usage help

Environment:
  CAPY_TEST_URL         Reuse an already-running preview URL instead of launching ephemeral vite preview
  CAPY_TEST_PORT        Optional port for ephemeral vite preview (default: 0 / OS-assigned)
  CAPY_E2E_WORKERS      Positive integer worker count fallback when --workers is not specified
`);
}

function printInventory(selected, asJson) {
  const countsByTier = {};
  for (const tier of [1, 2, 3, 4]) {
    countsByTier[tier] = selected.filter((t) => t.tier === tier).length;
  }
  if (asJson) {
    const payload = {
      total: selected.length,
      countsByTier,
      tiers: TIER_META,
      tests: selected.map(({ id, tier, area, features, title }) => ({
        id,
        tier,
        area,
        features,
        title,
      })),
    };
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`Capy Paint Infinite Zoom v3 Opaque-Box E2E Inventory (${selected.length} tests)\n`);
  for (const tier of [1, 2, 3, 4]) {
    const inTier = selected.filter((t) => t.tier === tier);
    if (inTier.length === 0) continue;
    const meta = TIER_META[tier];
    console.log(`${meta.name} (${inTier.length} tests) — ${meta.description}`);
    for (const t of inTier) {
      const feat = t.features.join(',');
      console.log(`  ${t.id.padEnd(6)} [${t.area.padEnd(5)}] (${feat.padEnd(22)}) ${t.title}`);
    }
    console.log('');
  }
}

// ============================================================================
// Runtime Harness (Dynamic Playwright & Vite Imports Only on Execution)
// ============================================================================

function resolveChromiumExecutablePath(chromium) {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }
  try {
    const bundled = chromium.executablePath();
    if (bundled && fs.existsSync(bundled)) return bundled;
  } catch {
    // Fall through to system browser binaries
  }
  if (fs.existsSync('/usr/bin/chromium')) return '/usr/bin/chromium';
  if (fs.existsSync('/usr/bin/google-chrome')) return '/usr/bin/google-chrome';
  return undefined;
}

async function runSuite(selectedTests, opts) {
  const explicitUrl = (process.env.CAPY_TEST_URL || '').trim().replace(/\/+$/, '');
  let baseUrl = explicitUrl;
  let previewServer = null;
  let browser = null;

  try {
    if (baseUrl && (await isServerListening(baseUrl))) {
      console.log(`Reusing CAPY_TEST_URL: ${baseUrl}`);
    } else {
      const distIndex = path.join(WEB_ROOT, 'dist', 'index.html');
      if (!fs.existsSync(distIndex)) {
        throw new Error(
          `Production bundle missing at ${distIndex}. Build web/ first (npm run build) or pass CAPY_TEST_URL.`
        );
      }
      const { preview } = await import('vite');
      const reqPort = Number.parseInt(process.env.CAPY_TEST_PORT || '0', 10);
      const previewPort = Number.isInteger(reqPort) && reqPort > 0 ? reqPort : 0;
      previewServer = await preview({
        root: WEB_ROOT,
        preview: { port: previewPort, strictPort: previewPort > 0, host: '127.0.0.1' },
        logLevel: 'error',
      });
      const addr = previewServer.httpServer?.address();
      const resolvedPort = typeof addr === 'object' && addr ? addr.port : previewPort;
      baseUrl = `http://127.0.0.1:${resolvedPort}`;
      const ready = await waitForCondition(() => isServerListening(baseUrl), 6000, 50);
      assert.equal(ready, true, `Ephemeral vite preview server did not respond at ${baseUrl}`);
      console.log(`Started ephemeral vite preview server at ${baseUrl}`);
    }

    const { chromium } = await import('playwright');
    browser = await chromium.launch({
      executablePath: resolveChromiumExecutablePath(chromium),
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-background-networking',
        '--disable-extensions',
        '--disable-default-apps',
        '--disable-sync',
        '--metrics-recording-only',
        '--no-first-run',
      ],
    });

    const total = selectedTests.length;
    const cpuCount = Math.max(1, os.cpus()?.length || 1);
    const rawEnvWorkers = (process.env.CAPY_E2E_WORKERS || '').trim();
    let envWorkers = null;
    if (rawEnvWorkers) {
      if (!/^[1-9]\d*$/.test(rawEnvWorkers)) {
        throw new Error(
          `Invalid CAPY_E2E_WORKERS value "${rawEnvWorkers}" (expected a positive integer >= 1)`
        );
      }
      envWorkers = Number.parseInt(rawEnvWorkers, 10);
    }
    const requestedWorkers =
      Number.isInteger(opts.workers) && opts.workers > 0
        ? opts.workers
        : envWorkers !== null
          ? envWorkers
          : total >= 10
            ? Math.min(2, cpuCount)
            : 1;
    const concurrency = Math.max(1, Math.min(requestedWorkers, total));

    // Pre-warm immutable shared synthetic fixtures once before launching concurrent workers
    getCommonFixtures();

    const results = new Array(total);
    const suiteStartedAt = Date.now();
    let nextIndex = 0;
    let completedCount = 0;
    let stopRequested = false;
    console.log(`\nRunning ${total} Infinite Zoom v3 E2E test(s) (workers=${concurrency})...\n`);

    const runSingleTest = async (testDef) => {
      const started = Date.now();
      const openedContexts = [];
      const tempDirs = [];
      const runtimeErrors = [];

      const attachErrorListeners = (page, label) => {
        page.on('pageerror', (err) => {
          runtimeErrors.push(`[pageerror:${label}] ${err?.stack || err?.message || String(err)}`);
        });
        page.on('console', (msg) => {
          if (msg.type() === 'error') {
            runtimeErrors.push(`[console.error:${label}] ${msg.text()}`);
          }
        });
      };

      const env = {
        browser,
        BASE_URL: baseUrl,
        webRoot: WEB_ROOT,
        createTempDir: () => {
          const dir = fs.mkdtempSync(path.join(os.tmpdir(), `capy-iz-v3-${testDef.id}-`));
          tempDirs.push(dir);
          return dir;
        },
        openIsolatedPage: async ({
          beforeGoto = null,
          viewport = { width: 1280, height: 860 },
          hasTouch = true,
          acceptDownloads = false,
          permissions = [],
          skipTutorial = true,
          easyNoReplay = false,
          extraSettings = null,
        } = {}) => {
          const ctxLabel = `${testDef.id}#${openedContexts.length + 1}`;
          const { context, page } = await createBootedContext(browser, baseUrl, {
            label: ctxLabel,
            attachErrorListeners,
            viewport,
            hasTouch,
            acceptDownloads,
            permissions,
            skipTutorial,
            easyNoReplay,
            extraSettings,
            bootUrl: beforeGoto ? false : null,
            waitForPuzzle: !beforeGoto,
          });
          openedContexts.push(context);
          if (beforeGoto) {
            await beforeGoto(page, context);
            const targetUrl = skipTutorial ? `${baseUrl}/?skipTutorial=1` : baseUrl;
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
            await waitForPuzzleLoaded(page);
          }
          await dismissFeatureOfferIfVisible(page);
          return { context, page };
        },
      };

      let status = 'PASS';
      let error = null;
      try {
        await testDef.run(env);
        assert.equal(
          runtimeErrors.length,
          0,
          `Unexpected browser runtime errors (${runtimeErrors.length}):\n  ${runtimeErrors.join('\n  ')}`
        );
      } catch (err) {
        status = 'FAIL';
        error = err;
      } finally {
        for (const ctx of openedContexts) {
          await ctx.close().catch(() => {});
        }
        for (const dir of tempDirs) {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      }

      const elapsedMs = Date.now() - started;
      return { testDef, status, elapsedMs, error };
    };

    const workerLoop = async () => {
      while (!stopRequested) {
        const idx = nextIndex++;
        if (idx >= total) break;
        const testDef = selectedTests[idx];
        const outcome = await runSingleTest(testDef);
        results[idx] = outcome;
        completedCount += 1;
        const seq = String(completedCount).padStart(String(total).length, '0');
        const sec = (outcome.elapsedMs / 1000).toFixed(2);
        console.log(`[T${testDef.tier} ${seq}/${total}] ${outcome.status} ${testDef.id} (${sec}s) ${testDef.title}`);
        if (outcome.error) {
          console.error(`    -> ${outcome.error?.message || String(outcome.error)}`);
          if (opts.failFast) {
            stopRequested = true;
          }
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => workerLoop()));

    const completedResults = results.filter(Boolean);
    const suiteElapsedSec = ((Date.now() - suiteStartedAt) / 1000).toFixed(2);

    // Print tier summary (deterministic registry order)
    console.log('\n================ Infinite Zoom v3 E2E Summary ================');
    for (const tier of [1, 2, 3, 4]) {
      const inTier = completedResults.filter((r) => r.testDef.tier === tier);
      if (inTier.length === 0) continue;
      const passed = inTier.filter((r) => r.status === 'PASS').length;
      const failed = inTier.length - passed;
      console.log(`  Tier ${tier}: ${passed}/${inTier.length} passed (${failed} failed)`);
    }
    const totalPassed = completedResults.filter((r) => r.status === 'PASS').length;
    const totalFailed = completedResults.length - totalPassed;
    console.log(
      `  TOTAL : ${totalPassed}/${completedResults.length} passed (${totalFailed} failed) in ${suiteElapsedSec}s (workers=${concurrency})`
    );
    console.log('==============================================================\n');

    if (totalFailed > 0) {
      process.exitCode = 1;
    }
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (previewServer?.httpServer) {
      previewServer.httpServer.closeAllConnections?.();
      await new Promise((resolve) => previewServer.httpServer.close(() => resolve()));
    }
  }
}

async function main() {
  let opts;
  try {
    opts = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`CLI Error: ${err.message}`);
    process.exit(1);
  }

  if (opts.help) {
    printHelp();
    return;
  }

  let selected;
  try {
    selected = selectTests(opts);
  } catch (err) {
    console.error(`CLI Error: ${err.message}`);
    process.exit(1);
  }

  if (opts.list) {
    printInventory(selected, opts.json);
    return;
  }

  await runSuite(selected, opts);
}

const isDirectCli =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === __filename;

if (isDirectCli) {
  main().catch((err) => {
    console.error('\nINFINITE ZOOM V3 E2E RUNNER ERROR:', err);
    process.exit(1);
  });
}
