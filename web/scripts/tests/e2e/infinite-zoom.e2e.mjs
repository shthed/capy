/**
 * Opaque-Box Playwright E2E Suite for Capy Paint Issue #606:
 * Google Nano Banana 2.1 / 2 Suite & Unified Single-Canvas Nested-Layer Infinite Zoom.
 *
 * Exact 4 Stages (deterministic, zero external network dependencies, zero console/page errors):
 *   Stage 1: Sparkles visibility on 100% completed puzzles (hidden only during active Replay
 *            playback, visible when paused/idle, entering Zoom dismisses ReplayControls cleanly),
 *            Menu > Create provider/model/model-validated resolution/BYOK controls & device-local
 *            key isolation, Android WebView Puter exclusion & zero js.puter.com loads, and
 *            360x780 + Large Text (1.25x) plus 640x360 short-landscape checks (incl. Copy Image).
 *   Stage 2: Unified Zoom In via mocked window.puter.ai.txt2img (ratio { w, h }, quality, dynamic
 *            MIME, <= 900 KB compact template), non-adjacent switch prompt, single-canvas
 *            invariants, smooth auto-camera focus + 1-tap Undo Split viewport restore, dynamic
 *            max zoom > 12x, and multi-layer painting with shared PaletteDock & unified Undo/Redo.
 *   Stage 3: Unified Zoom Out (Directional Border Extension) via mocked Direct Gemini BYOK route
 *            (dynamic MIME, <= 900 KB compact template), 0-side & 2.5:1 aspect guards, 100%
 *            painted progress + affine-rebased nested layer preservation, 1-tap Undo Extend,
 *            outer border painting, single-file .capy v2 export (zero BYOK leak), and import.
 *   Stage 4: Free Guided Gemini App Handoff end-to-end: Web 1-tap Copy Image (PNG clipboard write),
 *            compact template download (<= 900 KB) + gemini.google.com launch stub, invalid SVG &
 *            corrupt PNG rejection + recovery, Puter structured 402/insufficient_funds automatic
 *            Guided fallback + synthetic paste, and Android shareImage + LIFO share-back.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  createBootedContext,
  getStableBoundingBox,
  readTotalRemainingRegions,
  waitForAnimationFrames,
  waitForCondition,
  waitForPuzzleLoaded,
} from './helpers.mjs';

const ACTIVE_SESSION_KEY = 'capy_active_session_v8';
const SNAPSHOTS_KEY = 'capy_snapshots_v8';
const SETTINGS_KEY = 'capy_user_settings_v8';
const BYOK_KEY_STORAGE_KEY = 'capy_gemini_byok_key_v1';

const VALID_GEMINI_ASPECT_RATIOS = new Set([
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
const ALLOWED_TEMPLATE_MIMES = new Set(['image/jpeg', 'image/webp', 'image/png']);
const MAX_AI_TEMPLATE_BYTES = 900 * 1024;

function assertValidPuterRatio(ratio, label) {
  assert.ok(
    ratio && typeof ratio === 'object' && !Array.isArray(ratio),
    `${label}: expected Puter ratio { w, h } object, got ${JSON.stringify(ratio)}`
  );
  assert.ok(
    Number.isInteger(ratio.w) &&
      Number.isInteger(ratio.h) &&
      ratio.w >= 1 &&
      ratio.w <= 32 &&
      ratio.h >= 1 &&
      ratio.h <= 32,
    `${label}: expected integer Puter ratio within 1..32, got ${JSON.stringify(ratio)}`
  );
  assert.ok(
    VALID_GEMINI_ASPECT_RATIOS.has(`${ratio.w}:${ratio.h}`),
    `${label}: expected supported Gemini aspect ratio, got "${ratio.w}:${ratio.h}"`
  );
}

// ============================================================================
// Pure-Node Deterministic Multi-Color PNG Generator
// ============================================================================

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
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

function makePngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, crcInput, crcBuf]);
}

/**
 * Builds a deterministic 6-color geometric RGB PNG buffer in pure Node so
 * MaskedRegionSubdivider always segments crisp multi-region detail for both
 * Zoom In masks and Zoom Out border rings.
 */
function createMultiColorPatternPngBuffer(width = 128, height = 128) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const palette = [
    [230, 57, 70], // #E63946 crimson
    [42, 157, 143], // #2A9D8F teal
    [233, 196, 106], // #E9C46A saffron
    [69, 123, 157], // #457B9D steel blue
    [155, 93, 229], // #9B5DE5 violet
    [244, 162, 97], // #F4A261 coral
  ];

  const stride = 1 + width * 3;
  const raw = Buffer.alloc(stride * height);
  const cx = width / 2;
  const cy = height / 2;
  const innerR2 = Math.pow(Math.min(width, height) * 0.18, 2);
  const ringR2 = Math.pow(Math.min(width, height) * 0.34, 2);

  for (let y = 0; y < height; y++) {
    const rowOff = y * stride;
    raw[rowOff] = 0; // filter: None
    const gy = Math.min(2, Math.floor((y * 3) / height));
    for (let x = 0; x < width; x++) {
      const gx = Math.min(3, Math.floor((x * 4) / width));
      const dx = x - cx;
      const dy = y - cy;
      const d2 = dx * dx + dy * dy;
      let colorIdx;
      if (d2 < innerR2) {
        colorIdx = (gx + gy + 2) % palette.length;
      } else if (d2 < ringR2 && (x + y) % 32 < 16) {
        colorIdx = (gx + gy + 4) % palette.length;
      } else {
        colorIdx = (gy * 2 + gx) % palette.length;
      }
      const rgb = palette[colorIdx];
      const off = rowOff + 1 + x * 3;
      raw[off] = rgb[0];
      raw[off + 1] = rgb[1];
      raw[off + 2] = rgb[2];
    }
  }

  const idat = zlib.deflateSync(raw, { level: 6 });
  return Buffer.concat([
    signature,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', idat),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const MULTI_COLOR_PNG_BUFFER = createMultiColorPatternPngBuffer(128, 128);
const MULTI_COLOR_PNG_BASE64 = MULTI_COLOR_PNG_BUFFER.toString('base64').replace(/\s+/g, '');
const MULTI_COLOR_PNG_DATA_URL = `data:image/png;base64,${MULTI_COLOR_PNG_BASE64}`;

// ============================================================================
// Error, Network, Mock & Storage Helpers
// ============================================================================

/**
 * Attaches both runner pageerror listeners AND strict console.error listeners so
 * every stage enforces zero console errors and zero uncaught page errors.
 */
function attachStrictErrorListeners(page, label, ctx) {
  const stageErrors = [];
  if (typeof ctx.attachErrorListeners === 'function') {
    ctx.attachErrorListeners(page, label);
  }
  page.on('pageerror', (err) => {
    stageErrors.push(`[${label}:pageerror] ${err.message}`);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const entry = `[${label}:console.error] ${msg.text()}`;
      stageErrors.push(entry);
      if (Array.isArray(ctx.consoleErrors)) {
        ctx.consoleErrors.push(entry);
      }
    }
  });
  return {
    getErrors: () => [...stageErrors],
    assertZeroErrors: () => {
      assert.equal(
        stageErrors.length,
        0,
        `Expected zero console/page errors in ${label}, got:\n${stageErrors.join('\n')}`
      );
    },
  };
}

/**
 * Intercepts and blocks any request to js.puter.com or *.puter.com so offline E2E
 * tests never touch external servers and can assert zero Puter network loads.
 */
async function attachPuterNetworkSpy(page) {
  const requests = [];
  await page.route('**://*.puter.com/**', async (route) => {
    requests.push(route.request().url());
    await route.abort('blockedbyclient');
  });
  return {
    getRequests: () => [...requests],
  };
}

/**
 * Injects an in-page window.puter.ai.txt2img stub BEFORE module load so Puter
 * provider tests run 100% offline with zero external script tags.
 */
async function injectPuterMock(page, { pngDataUrl, mode = 'ok' }) {
  await page.addInitScript(
    ({ dataUrl, initialMode }) => {
      window.__puterCalls = [];
      window.__puterMode = initialMode;
      window.puter = {
        ai: {
          async txt2img(prompt, options) {
            window.__puterCalls.push({
              prompt,
              options: options
                ? {
                    ...options,
                    ratio:
                      options.ratio && typeof options.ratio === 'object'
                        ? { ...options.ratio }
                        : options.ratio,
                  }
                : null,
            });
            const activeMode = window.__puterMode;
            if (activeMode === '402') {
              const err = new Error('Insufficient balance (402)');
              err.status = 402;
              err.code = 'insufficient_funds';
              throw err;
            }
            if (activeMode === 'cancelled') {
              throw new Error('Puter auth popup cancelled by user');
            }
            if (activeMode === 'safety') {
              throw new Error('Blocked by safety policy');
            }
            const img = document.createElement('img');
            img.src = dataUrl;
            return img;
          },
        },
      };
    },
    { dataUrl: pngDataUrl, initialMode: mode }
  );
}

/**
 * Installs a deterministic navigator.clipboard.write spy BEFORE module load so Web
 * 1-tap Copy Image tests verify PNG-normalized ClipboardItem writes offline.
 */
async function injectClipboardWriteSpy(page) {
  await page.addInitScript(() => {
    window.__clipboardImageWrites = [];
    const spyClipboard = {
      async write(items) {
        const item = Array.isArray(items) ? items[0] : null;
        const types = item && Array.isArray(item.types) ? [...item.types] : [];
        let mimeType = '';
        let byteLength = 0;
        let headerHex = '';
        if (item && typeof item.getType === 'function' && types.includes('image/png')) {
          const blob = await item.getType('image/png');
          mimeType = blob.type || '';
          const buf = new Uint8Array(await blob.arrayBuffer());
          byteLength = buf.byteLength;
          headerHex = Array.from(buf.slice(0, 8))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
        }
        window.__clipboardImageWrites.push({ types, mimeType, byteLength, headerHex });
      },
      async writeText() {
        return undefined;
      },
    };
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: spyClipboard,
    });
  });
}

/**
 * Injects the complete Android WebView CapyAndroid bridge mock BEFORE page load
 * so NativeBridge detects Android mode with zero console warnings or backup retries.
 */
async function injectAndroidWebViewMock(page) {
  await page.addInitScript(() => {
    window.__androidBridgeCalls = {
      shareImage: [],
      shareFile: [],
      haptics: [],
      modals: [],
    };
    window.CapyAndroid = {
      getSafeAreaInsets: () => '{"top":0,"bottom":0,"left":0,"right":0}',
      consumePendingSharedImage: () => null,
      consumePendingDeepLink: () => null,
      isPlayGamesConfigured: () => false,
      signInPlayGames: () => null,
      loadBackup: () => null,
      saveBackup: () => true,
      haptic: (type) => window.__androidBridgeCalls.haptics.push(String(type)),
      setModalOpen: (isOpen) => window.__androidBridgeCalls.modals.push(Boolean(isOpen)),
      shareImage: (title, dataUrl) =>
        window.__androidBridgeCalls.shareImage.push({
          title: String(title),
          dataUrl: String(dataUrl),
        }),
      shareFile: (title, fileName, mimeType, base64Data) =>
        window.__androidBridgeCalls.shareFile.push({
          title: String(title),
          fileName: String(fileName),
          mimeType: String(mimeType),
          base64Length: String(base64Data).length,
        }),
      shareTextLink: () => {},
      saveCloudSnapshot: () => false,
      loadCloudSnapshot: () => null,
      saveCloudBinaryChunk: () => false,
      loadCloudBinaryChunk: () => null,
      requestCloudSnapshotPull: () => false,
      openExternalOAuth: () => false,
      getAppVersion: () => '2.6.0-e2e',
    };
  });
}

/**
 * Stubs window.open before page load so Guided Gemini web launches record opened
 * URLs without spawning external popup tabs.
 */
async function injectWindowOpenStub(page) {
  await page.addInitScript(() => {
    window.__openedUrls = [];
    window.open = (url) => {
      window.__openedUrls.push(String(url));
      return {};
    };
  });
}

async function readActiveSession(page) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (raw === null || raw.trim() === '') return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`Malformed active session JSON in ${key}`);
    }
    return parsed;
  }, ACTIVE_SESSION_KEY);
}

async function readSnapshots(page) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (raw === null || raw.trim() === '') return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error(`Malformed snapshots JSON in ${key}`);
    }
    return parsed;
  }, SNAPSHOTS_KEY);
}

async function readUserSettings(page) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (raw === null || raw.trim() === '') return {};
    return JSON.parse(raw);
  }, SETTINGS_KEY);
}

async function readByokKey(page) {
  return page.evaluate((key) => localStorage.getItem(key), BYOK_KEY_STORAGE_KEY);
}

async function readPuzzleSummary(page, snapId) {
  return page.evaluate(async (id) => {
    if (!window.capyStorage) return null;
    const puzzle = await window.capyStorage.loadPuzzleData(id);
    if (!puzzle) return null;
    const nestedLayers = Array.isArray(puzzle.nestedLayers) ? puzzle.nestedLayers : [];
    const allRegionIds = [];
    for (const r of puzzle.regions || []) {
      allRegionIds.push(r.id);
    }
    for (const layer of nestedLayers) {
      for (const r of layer.regions || []) {
        allRegionIds.push(r.id);
      }
    }
    return {
      width: puzzle.width,
      height: puzzle.height,
      rootRegionCount: (puzzle.regions || []).length,
      nestedLayers: nestedLayers.map((l) => ({
        layerId: l.layerId,
        depth: l.depth,
        width: l.width,
        height: l.height,
        regionCount: (l.regions || []).length,
        worldBounds: { ...l.worldBounds },
        imageBlobKey: l.imageBlobKey,
        providerUsed: l.providerUsed,
        modelUsed: l.modelUsed,
      })),
      maxZoomDepth: typeof puzzle.maxZoomDepth === 'number' ? puzzle.maxZoomDepth : 0,
      totalRegionCount: allRegionIds.length,
      allRegionIds,
    };
  }, snapId);
}

async function dismissFeatureOfferIfVisible(page) {
  const offerDismissBtn = page.getByTestId('feature-offer-dismiss-btn');
  if ((await offerDismissBtn.count()) > 0 && (await offerDismissBtn.first().isVisible())) {
    await offerDismissBtn.first().click();
    await page.getByTestId('feature-offer-banner').waitFor({ state: 'hidden', timeout: 3000 });
    await waitForAnimationFrames(page, 1);
  }
}

async function setExtendSideState(page, testId, desiredOn) {
  const locator = page.getByTestId(testId);
  await locator.waitFor({ state: 'visible', timeout: 3000 });
  const readActive = async () =>
    locator.evaluate((el) => {
      const pressed = el.getAttribute('aria-pressed');
      if (pressed !== null) return pressed === 'true';
      if (el instanceof HTMLInputElement && el.type === 'checkbox') return el.checked;
      return false;
    });
  if ((await readActive()) !== desiredOn) {
    await locator.click();
    await waitForAnimationFrames(page, 1);
  }
  assert.equal(await readActive(), desiredOn, `Toggle ${testId} must be ${desiredOn}`);
}

/**
 * Deterministically maps both root-layer AND nested-layer regions from IDB PuzzleData
 * into live unobstructed screen coordinates (respecting worldBounds and deepest-first
 * occlusion so clicks reliably hit the intended layer and region).
 */
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
      const safeMaxX = rect.right - Math.min(108, w * 0.2);
      const safeMinY =
        h <= 500
          ? Math.max(rect.top + 48, headerBottom + 6)
          : Math.max(rect.top + 72, headerBottom + 16);
      const safeMaxY = h <= 500 ? rect.bottom - 72 : rect.bottom - Math.min(240, h * 0.34);

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
          minX: r.minX,
          maxX: r.maxX,
          minY: r.minY,
          maxY: r.maxY,
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
          const untouched = byAreaDesc.find(
            (cand) =>
              cand.id !== a.id &&
              cand.id !== b.id &&
              cand.id !== nonAdj.id &&
              screenDist(cand, a) >= MIN_TAP_SEP_PX &&
              screenDist(cand, b) >= MIN_TAP_SEP_PX &&
              screenDist(cand, nonAdj) >= MIN_TAP_SEP_PX
          );
          if (untouched) {
            largePair = { a, b, nonAdjacent: nonAdj, untouched };
            break outer;
          }
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
          if (unfilledNestedTargets.length >= 10) break;
        }
      }

      const unfilledRootTargets = byAreaDesc.filter((r) => !r.filled);

      return {
        width: pw,
        height: ph,
        largePair,
        unfilledRootTargets,
        unfilledNestedTargets,
      };
    },
    { targetSnapId: snapId, sessionKey: ACTIVE_SESSION_KEY }
  );
}

/**
 * Clicks a specific unfilled region's screen coordinate (in EASY mode) and verifies
 * active session filledRegionIds includes its ID.
 */
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
 * Picks up to `count` regions mutually separated by >= minSepPx on screen so rapid
 * sequential clicks never collapse into a double-tap zoom gesture.
 */
function pickWellSeparatedTargets(candidates, count, excludeIds = new Set(), minSepPx = 48) {
  const chosen = [];
  for (const cand of candidates) {
    if (excludeIds.has(cand.id)) continue;
    const tooClose = chosen.some(
      (prev) => Math.hypot(prev.clientX - cand.clientX, prev.clientY - cand.clientY) < minSepPx
    );
    if (tooClose) continue;
    chosen.push(cand);
    if (chosen.length >= count) break;
  }
  return chosen;
}

/**
 * Seeds 100% completion for the active puzzle into localStorage and reloads so the
 * puzzle enters its authentic 100% completed state deterministically.
 */
async function completeActivePuzzleTo100(page, snapId) {
  const totalCount = await page.evaluate(
    async ({ id, activeKey, snapsKey }) => {
      const puzzle = await window.capyStorage.loadPuzzleData(id);
      if (!puzzle) throw new Error(`Missing puzzle ${id} in IDB`);
      const allIds = [];
      for (const r of puzzle.regions || []) allIds.push(r.id);
      for (const layer of puzzle.nestedLayers || []) {
        for (const r of layer.regions || []) allIds.push(r.id);
      }
      const sess = JSON.parse(localStorage.getItem(activeKey) || '{}');
      sess.activeSnapshotId = id;
      sess.filledRegionIds = allIds;
      sess.fillOrder = allIds;
      localStorage.setItem(activeKey, JSON.stringify(sess));

      const snaps = JSON.parse(localStorage.getItem(snapsKey) || '[]');
      const updated = snaps.map((s) =>
        s.id === id
          ? {
              ...s,
              filledRegionIds: allIds,
              fillOrder: allIds,
              filledCount: allIds.length,
              totalCount: allIds.length,
            }
          : s
      );
      localStorage.setItem(snapsKey, JSON.stringify(updated));
      return allIds.length;
    },
    { id: snapId, activeKey: ACTIVE_SESSION_KEY, snapsKey: SNAPSHOTS_KEY }
  );
  assert.ok(totalCount > 10, `Expected sample puzzle to have > 10 regions, got ${totalCount}`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForPuzzleLoaded(page);
  return totalCount;
}

/**
 * Parses and validates an exported single-save .capy v2 binary file, asserting
 * header format, gzip decompression, nestedLayers/layerImages presence, and zero
 * BYOK API key leakage across both raw and decompressed bytes.
 */
function inspectCapyV2Buffer(rawBuf, secretByokKey) {
  assert.ok(rawBuf.length > 16, `Exported .capy file too small (${rawBuf.length} bytes)`);
  assert.equal(rawBuf.subarray(0, 4).toString('ascii'), 'CAPY', 'Expected CAPY magic header');
  assert.equal(rawBuf[4], 0x02, `Expected .capy v2 byte (0x02), got 0x${rawBuf[4].toString(16)}`);
  const flags = rawBuf[5];
  assert.equal(flags & 0x02, 0, 'Expected single-save .capy (archive flag bit 1 must be 0)');

  const body = rawBuf.subarray(6);
  const framed = (flags & 0x01) !== 0 ? zlib.gunzipSync(body) : body;

  // Verify zero BYOK API key leakage in raw and decompressed bytes
  const secretBuf = Buffer.from(secretByokKey, 'utf8');
  const keyNameBuf = Buffer.from(BYOK_KEY_STORAGE_KEY, 'utf8');
  assert.equal(rawBuf.includes(secretBuf), false, 'BYOK secret key leaked into raw .capy bytes!');
  assert.equal(
    framed.includes(secretBuf),
    false,
    'BYOK secret key leaked into decompressed .capy payload!'
  );
  assert.equal(
    framed.includes(keyNameBuf),
    false,
    'BYOK storage key name leaked into decompressed .capy payload!'
  );

  const jsonLen = framed.readUInt32LE(0);
  assert.ok(jsonLen > 20 && 4 + jsonLen <= framed.length, `Invalid framed JSON length ${jsonLen}`);
  const jsonText = framed.subarray(4, 4 + jsonLen).toString('utf8');
  assert.equal(jsonText.includes(secretByokKey), false, 'BYOK key found in .capy JSON header!');
  const parsed = JSON.parse(jsonText);
  assert.equal(parsed.format, 'capy-single-save-v2', 'Expected capy-single-save-v2 format');
  assert.equal(parsed.version, 2, 'Expected version === 2');
  return parsed;
}

// ============================================================================
// Responsive Layout & Touch-Target Verification Helpers
// ============================================================================

async function assertNoHorizontalOverflow(page, containerLocator, label) {
  const docOverflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  assert.ok(
    docOverflow.scrollWidth <= docOverflow.clientWidth + 1,
    `${label}: document horizontal overflow (${docOverflow.scrollWidth} > ${docOverflow.clientWidth})`
  );
  if (containerLocator) {
    const metrics = await containerLocator.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    assert.ok(
      metrics.scrollWidth <= metrics.clientWidth + 1,
      `${label}: container horizontal overflow (${metrics.scrollWidth} > ${metrics.clientWidth})`
    );
  }
}

async function assertInsideViewport(page, locator, label) {
  const box = await getStableBoundingBox(locator);
  assert.ok(box, `${label}: expected stable bounding box`);
  const vp = page.viewportSize();
  assert.ok(
    box.x >= -1 &&
      box.y >= -1 &&
      box.x + box.width <= vp.width + 1 &&
      box.y + box.height <= vp.height + 1,
    `${label}: box (${Math.round(box.x)},${Math.round(box.y)},${Math.round(box.width)}x${Math.round(box.height)}) overflows viewport ${vp.width}x${vp.height}`
  );
  return box;
}

async function assertMinTouchTarget(locator, label, minPx = 44) {
  const box = await getStableBoundingBox(locator);
  assert.ok(box, `${label}: expected bounding box for touch target check`);
  assert.ok(
    box.height >= minPx - 0.5 && box.width >= minPx - 0.5,
    `${label}: touch target ${box.width.toFixed(1)}x${box.height.toFixed(1)}px is below ${minPx}px minimum`
  );
  return box;
}

async function assertTopBarLanesNonOverlapping(page, label) {
  const vp = page.viewportSize();
  const leftBox = await getStableBoundingBox(page.getByTestId('topbar-left-lane'));
  const rightBox = await getStableBoundingBox(page.getByTestId('topbar-right-lane'));
  assert.ok(leftBox && rightBox, `${label}: expected TopBar lane bounding boxes`);
  assert.ok(
    leftBox.x + leftBox.width <= rightBox.x + 1,
    `${label}: TopBar lanes overlap (leftRight=${leftBox.x + leftBox.width} > rightLeft=${rightBox.x})`
  );
  assert.ok(
    rightBox.x + rightBox.width <= vp.width + 1,
    `${label}: TopBar right lane overflows viewport width ${vp.width}`
  );
}

// ============================================================================
// Stage 1: Sparkles 100% Visibility, Provider/BYOK Controls, Android & Mobile
// ============================================================================

async function runStage1(ctx) {
  const label =
    'Infinite Zoom Stage 1: Sparkles 100% visibility, provider/BYOK controls, Android exclusion & mobile/Large Text';
  ctx.logE2eStart(label);

  // --- Part 1A: Web Desktop Sparkles 100% visibility + CreateTab controls & BYOK isolation ---
  {
    const { context, page } = await createBootedContext(ctx.browser, ctx.BASE_URL, {
      label: 'infinite-zoom-s1-web',
      easyNoReplay: true,
      bootUrl: false,
      waitForPuzzle: false,
    });
    try {
      const errors = attachStrictErrorListeners(page, 'iz-s1-web', ctx);
      const puterSpy = await attachPuterNetworkSpy(page);

      await page.goto(`${ctx.BASE_URL}/?skipTutorial=1`, { waitUntil: 'domcontentloaded' });
      await waitForPuzzleLoaded(page);

      const initialSession = await readActiveSession(page);
      const snapId = initialSession.activeSnapshotId;
      assert.ok(snapId, 'Stage 1A: expected activeSnapshotId after boot');

      // Complete puzzle to 100% and verify Sparkles visibility across idle/playing/paused Replay
      await completeActivePuzzleTo100(page, snapId);
      const savesBtnText = await page.getByTestId('topbar-saves-btn').innerText();
      assert.ok(savesBtnText.includes('100%'), `Expected 100% completion, got "${savesBtnText}"`);

      const replayBtn = page.getByTestId('replay-btn');
      const sparklesBtn = page.getByTestId('infinite-zoom-menu-btn');
      await replayBtn.waitFor({ state: 'visible', timeout: 5000 });
      await sparklesBtn.waitFor({ state: 'visible', timeout: 5000 });
      assert.equal(
        await sparklesBtn.isEnabled(),
        true,
        'Sparkles button must stay enabled on 100% completed idle puzzle'
      );

      // Start animated Replay -> Sparkles MUST be hidden while isReplaying && isReplayPlaying
      await replayBtn.click();
      const replayWindow = page.getByTestId('replay-controls-window');
      const replayToggleBtn = page.getByTestId('replay-play-pause-btn');
      await replayWindow.waitFor({ state: 'visible', timeout: 5000 });
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-testid="replay-play-pause-btn"]')
            ?.getAttribute('aria-label') === 'Pause Replay',
        { timeout: 5000 }
      );
      assert.equal(
        await sparklesBtn.count(),
        0,
        'Sparkles button must be hidden ONLY while Replay is actively playing'
      );

      // Pause Replay -> Sparkles MUST reappear and stay enabled
      await replayToggleBtn.click();
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-testid="replay-play-pause-btn"]')
            ?.getAttribute('aria-label') === 'Resume Replay',
        { timeout: 5000 }
      );
      await sparklesBtn.waitFor({ state: 'visible', timeout: 5000 });
      assert.equal(
        await sparklesBtn.isEnabled(),
        true,
        'Sparkles button must be visible and enabled when Replay is paused on 100% puzzle'
      );

      // Open Infinite Zoom while Replay is paused -> ReplayControls cleanly dismissed (zero overlap)
      await sparklesBtn.click();
      const popover = page.locator('[role="dialog"][aria-label="Infinite Zoom Controls"]');
      await popover.waitFor({ state: 'visible', timeout: 3000 });
      const pillText = await page.getByTestId('iz-active-provider-pill').innerText();
      assert.ok(
        pillText.includes('Nano Banana 2.1') && pillText.includes('Puter'),
        `Expected default Web pill "Nano Banana 2.1 • Puter", got "${pillText}"`
      );
      await page.getByTestId('toolbar-infinite-zoom-in-btn').click();
      await page.getByTestId('region-selection-bar').waitFor({ state: 'visible', timeout: 3000 });
      assert.equal(
        await replayWindow.count(),
        0,
        'Entering Infinite Zoom from paused Replay must cleanly dismiss replay-controls-window'
      );

      // Cancel selection -> both Replay and Sparkles remain visible on completed idle puzzle
      await page.getByTestId('region-selection-cancel-btn').click();
      await page.getByTestId('region-selection-bar').waitFor({ state: 'hidden', timeout: 3000 });
      await replayBtn.waitFor({ state: 'visible', timeout: 3000 });
      await sparklesBtn.waitFor({ state: 'visible', timeout: 3000 });

      // Menu > Create: verify provider/model/resolution controls & device-local BYOK isolation
      await page.getByTestId('topbar-settings-btn').click();
      await page.getByTestId('settings-tab-create').click();

      const providerSelect = page.getByTestId('iz-provider-select');
      const modelSelect = page.getByTestId('iz-model-select');
      const resSelect = page.getByTestId('iz-resolution-select');
      await providerSelect.waitFor({ state: 'visible', timeout: 3000 });

      const providerOptions = await providerSelect
        .locator('option')
        .evaluateAll((opts) => opts.map((o) => o.value));
      assert.deepEqual(
        providerOptions,
        ['PUTER', 'GUIDED_GEMINI', 'GEMINI_BYOK'],
        'Web CreateTab must expose Puter, Guided Gemini, and Gemini BYOK providers'
      );
      assert.equal(await providerSelect.inputValue(), 'PUTER', 'Default Web provider must be PUTER');

      const modelOptions = await modelSelect
        .locator('option')
        .evaluateAll((opts) => opts.map((o) => o.value));
      assert.deepEqual(
        modelOptions,
        ['gemini-nano-banana-2.1', 'gemini-3.1-flash-lite-image', 'gemini-3.1-flash-image'],
        'CreateTab must expose Nano Banana 2.1, 2 Lite, and 2 Pro models'
      );
      assert.equal(
        await modelSelect.inputValue(),
        'gemini-nano-banana-2.1',
        'Default model must be gemini-nano-banana-2.1'
      );

      const readResOptions = () =>
        resSelect.locator('option').evaluateAll((opts) => opts.map((o) => o.value));

      assert.deepEqual(
        await readResOptions(),
        ['1K', '2K'],
        'Nano Banana 2.1 must expose model-validated 1K, 2K resolutions'
      );
      assert.equal(await resSelect.inputValue(), '1K', 'Default resolution must be 1K');

      // Nano Banana 2 Lite supports 1K only
      await modelSelect.selectOption('gemini-3.1-flash-lite-image');
      assert.deepEqual(
        await readResOptions(),
        ['1K'],
        'Nano Banana 2 Lite must expose 1K resolution only'
      );
      assert.equal(await resSelect.inputValue(), '1K');

      // Nano Banana 2 supports 512, 1K, 2K; verify UserSettings persistence + clamp back to 1K on Lite
      await modelSelect.selectOption('gemini-3.1-flash-image');
      assert.deepEqual(
        await readResOptions(),
        ['512', '1K', '2K'],
        'Nano Banana 2 must expose 512, 1K, 2K resolutions'
      );
      await resSelect.selectOption('2K');
      const settingsAfterPick = await readUserSettings(page);
      assert.equal(settingsAfterPick.nanoBananaModel, 'gemini-3.1-flash-image');
      assert.equal(settingsAfterPick.nanoBananaResolution, '2K');

      await modelSelect.selectOption('gemini-3.1-flash-lite-image');
      assert.equal(await resSelect.inputValue(), '1K', 'Switching to Lite must clamp 2K -> 1K');
      assert.equal((await readUserSettings(page)).nanoBananaResolution, '1K');

      // Switch to GEMINI_BYOK and verify device-local storage isolation
      await providerSelect.selectOption('GEMINI_BYOK');
      const byokBadge = page.getByTestId('iz-byok-status-badge');
      await byokBadge.waitFor({ state: 'visible', timeout: 3000 });
      assert.equal((await byokBadge.innerText()).trim(), 'Not set');
      assert.equal(await page.getByTestId('iz-byok-clear-btn').isDisabled(), true);

      const sampleByokSecret = 'AIzaSyStage1DeviceLocalOnlyKey999';
      await page.getByTestId('iz-byok-key-input').fill(sampleByokSecret);
      await page.getByTestId('iz-byok-save-btn').click();
      await page.waitForFunction(
        (key) => localStorage.getItem(key) !== null,
        BYOK_KEY_STORAGE_KEY,
        { timeout: 3000 }
      );
      assert.equal(await readByokKey(page), sampleByokSecret);
      assert.equal((await byokBadge.innerText()).trim(), 'Saved on this device only');

      // Verify BYOK key is strictly absent from capy_user_settings_v8
      const rawSettingsJson = await page.evaluate((k) => localStorage.getItem(k) || '', SETTINGS_KEY);
      assert.equal(
        rawSettingsJson.includes(sampleByokSecret),
        false,
        'BYOK key must NEVER be stored inside capy_user_settings_v8'
      );

      // Clear BYOK key and confirm removal
      await page.getByTestId('iz-byok-clear-btn').click();
      await page.waitForFunction(
        (key) => localStorage.getItem(key) === null,
        BYOK_KEY_STORAGE_KEY,
        { timeout: 3000 }
      );
      assert.equal((await byokBadge.innerText()).trim(), 'Not set');

      const puterScripts = await page.locator('script[src*="js.puter.com"]').count();
      assert.equal(puterScripts, 0, 'Web idle boot/settings must not inject js.puter.com');
      assert.equal(puterSpy.getRequests().length, 0, 'Zero js.puter.com requests expected');

      errors.assertZeroErrors();
    } finally {
      await context.close();
    }
  }

  // --- Part 1B: Android WebView simulation (Puter hidden & unreachable, Guided Gemini default) ---
  {
    const { context, page } = await createBootedContext(ctx.browser, ctx.BASE_URL, {
      label: 'infinite-zoom-s1-android',
      easyNoReplay: true,
      bootUrl: false,
      waitForPuzzle: false,
    });
    try {
      const errors = attachStrictErrorListeners(page, 'iz-s1-android', ctx);
      const puterSpy = await attachPuterNetworkSpy(page);
      await injectAndroidWebViewMock(page);

      await page.goto(`${ctx.BASE_URL}/?skipTutorial=1`, { waitUntil: 'domcontentloaded' });
      await waitForPuzzleLoaded(page);

      // Verify toolbar pill defaults to Guided Gemini on Android
      await page.getByTestId('infinite-zoom-menu-btn').click();
      const pillText = await page.getByTestId('iz-active-provider-pill').innerText();
      assert.ok(
        pillText.includes('Guided Gemini') && !pillText.includes('Puter'),
        `Android toolbar pill must show Guided Gemini (never Puter), got "${pillText}"`
      );
      await page.keyboard.press('Escape');

      // Verify CreateTab provider select omits PUTER completely
      await page.getByTestId('topbar-settings-btn').click();
      await page.getByTestId('settings-tab-create').click();
      const providerSelect = page.getByTestId('iz-provider-select');
      await providerSelect.waitFor({ state: 'visible', timeout: 3000 });
      const androidOptions = await providerSelect
        .locator('option')
        .evaluateAll((opts) => opts.map((o) => o.value));
      assert.deepEqual(
        androidOptions,
        ['GUIDED_GEMINI', 'GEMINI_BYOK'],
        'Android WebView must completely omit PUTER from provider select'
      );
      assert.equal(
        await providerSelect.inputValue(),
        'GUIDED_GEMINI',
        'Android default provider must be GUIDED_GEMINI'
      );

      assert.equal(
        await page.locator('script[src*="js.puter.com"]').count(),
        0,
        'Android WebView must never contain js.puter.com script tags'
      );
      assert.equal(
        puterSpy.getRequests().length,
        0,
        'Android WebView must never issue js.puter.com network requests'
      );

      errors.assertZeroErrors();
    } finally {
      await context.close();
    }
  }

  // --- Part 1C: 360x780 Mobile + Large Text (1.25x via setting-large-text) ---
  {
    const { context, page } = await createBootedContext(ctx.browser, ctx.BASE_URL, {
      label: 'infinite-zoom-s1-mobile-large-text',
      viewport: { width: 360, height: 780 },
      hasTouch: true,
      easyNoReplay: true,
      bootUrl: false,
      waitForPuzzle: false,
    });
    try {
      const errors = attachStrictErrorListeners(page, 'iz-s1-mobile-360', ctx);
      const puterSpy = await attachPuterNetworkSpy(page);
      await injectWindowOpenStub(page);

      await page.goto(`${ctx.BASE_URL}/?skipTutorial=1`, { waitUntil: 'domcontentloaded' });
      await waitForPuzzleLoaded(page);

      // Toggle Large Text (1.25x) via real Settings UI switch
      await page.getByTestId('topbar-settings-btn').click();
      await page.getByTestId('settings-tab-settings').click();
      const largeTextSwitch = page.getByTestId('setting-large-text');
      await largeTextSwitch.waitFor({ state: 'visible', timeout: 3000 });
      if ((await largeTextSwitch.getAttribute('aria-checked')) !== 'true') {
        await largeTextSwitch.click();
      }
      await page.waitForFunction(
        () => document.documentElement.dataset.largeText === 'true',
        { timeout: 3000 }
      );

      // Check CreateTab card on 360x780 + Large Text
      await page.getByTestId('settings-tab-create').click();
      await page.getByTestId('iz-provider-select').selectOption('GUIDED_GEMINI');
      const createCard = page.locator('.capy-iz-provider-card');
      await createCard.waitFor({ state: 'visible', timeout: 3000 });
      await assertNoHorizontalOverflow(page, createCard, '360x780 LargeText CreateCard');
      await assertMinTouchTarget(page.getByTestId('iz-provider-select'), '360x780 iz-provider-select');
      await assertMinTouchTarget(page.getByTestId('iz-model-select'), '360x780 iz-model-select');
      await assertMinTouchTarget(
        page.getByTestId('iz-resolution-select'),
        '360x780 iz-resolution-select'
      );
      await assertMinTouchTarget(
        page.getByTestId('create-infinite-zoom-in-btn'),
        '360x780 create-infinite-zoom-in-btn'
      );
      await assertMinTouchTarget(
        page.getByTestId('create-infinite-zoom-out-btn'),
        '360x780 create-infinite-zoom-out-btn'
      );

      await page.getByTestId('settings-modal-close').click();
      await waitForAnimationFrames(page, 2);

      // Check TopBar lanes on 360x780 + Large Text
      await assertTopBarLanesNonOverlapping(page, '360x780 LargeText TopBar');

      // Check Infinite Zoom toolbar popover & touch targets
      const sparklesBtn = page.getByTestId('infinite-zoom-menu-btn');
      await assertMinTouchTarget(sparklesBtn, '360x780 infinite-zoom-menu-btn');
      await sparklesBtn.click();
      const popover = page.locator('[role="dialog"][aria-label="Infinite Zoom Controls"]');
      await popover.waitFor({ state: 'visible', timeout: 3000 });
      await assertInsideViewport(page, popover, '360x780 LargeText Popover');
      await assertNoHorizontalOverflow(page, popover, '360x780 LargeText Popover');
      await assertMinTouchTarget(
        page.getByTestId('toolbar-infinite-zoom-in-btn'),
        '360x780 toolbar-infinite-zoom-in-btn'
      );
      await assertMinTouchTarget(
        page.getByTestId('toolbar-infinite-zoom-out-btn'),
        '360x780 toolbar-infinite-zoom-out-btn'
      );
      await page.getByTestId('toolbar-infinite-zoom-out-btn').click();
      await assertInsideViewport(page, popover, '360x780 LargeText Expanded Popover');
      await assertNoHorizontalOverflow(page, popover, '360x780 LargeText Expanded Popover');
      await assertMinTouchTarget(
        popover.locator('button[aria-label="Close Infinite Zoom menu"]'),
        '360x780 popover close button'
      );
      for (const side of ['top', 'bottom', 'left', 'right']) {
        await assertMinTouchTarget(
          page.getByTestId(`extend-side-${side}`),
          `360x780 extend-side-${side}`
        );
      }
      await assertMinTouchTarget(
        page.getByTestId('toolbar-infinite-zoom-out-confirm-btn'),
        '360x780 toolbar-infinite-zoom-out-confirm-btn'
      );

      // Enter RegionSelectionBar and verify containment + >= 44px touch targets
      await page.getByTestId('toolbar-infinite-zoom-in-btn').click();
      const selBar = page.getByTestId('region-selection-bar');
      await selBar.waitFor({ state: 'visible', timeout: 3000 });
      const selBarBox = await assertInsideViewport(page, selBar, '360x780 LargeText RegionSelectionBar');
      await assertNoHorizontalOverflow(page, selBar, '360x780 LargeText RegionSelectionBar');
      const headerBox = await getStableBoundingBox(page.locator('header'));
      assert.ok(
        selBarBox.y >= headerBox.y + headerBox.height - 1,
        '360x780 RegionSelectionBar must not collide with GameTopBar header'
      );
      await assertMinTouchTarget(
        page.getByTestId('region-selection-cancel-btn'),
        '360x780 region-selection-cancel-btn'
      );
      await assertMinTouchTarget(
        page.getByTestId('region-selection-clear-btn'),
        '360x780 region-selection-clear-btn'
      );
      await assertMinTouchTarget(
        page.getByTestId('region-selection-confirm-btn'),
        '360x780 region-selection-confirm-btn'
      );

      // Select a region and open GuidedGeminiHandoffModal to verify mobile modal layout
      const sess = await readActiveSession(page);
      const targets = await findUnifiedRegionTargets(page, sess.activeSnapshotId);
      assert.ok(targets && targets.unfilledRootTargets.length > 0, '360x780: expected clickable region');
      await page.mouse.click(
        targets.unfilledRootTargets[0].clientX,
        targets.unfilledRootTargets[0].clientY
      );
      await page.waitForFunction(
        () => !document.querySelector('[data-testid="region-selection-confirm-btn"]')?.disabled,
        { timeout: 3000 }
      );
      await page.getByTestId('region-selection-confirm-btn').click();

      const guidedModal = page.getByTestId('guided-gemini-modal');
      await guidedModal.waitFor({ state: 'visible', timeout: 10000 });
      await assertInsideViewport(page, guidedModal, '360x780 LargeText GuidedGeminiModal');
      await assertNoHorizontalOverflow(page, guidedModal, '360x780 LargeText GuidedGeminiModal');
      await assertMinTouchTarget(
        page.getByTestId('guided-gemini-copy-image-btn'),
        '360x780 guided-gemini-copy-image-btn'
      );
      await assertMinTouchTarget(
        page.getByTestId('guided-gemini-launch-btn'),
        '360x780 guided-gemini-launch-btn'
      );
      await assertMinTouchTarget(
        page.getByTestId('guided-gemini-paste-btn'),
        '360x780 guided-gemini-paste-btn'
      );
      await assertMinTouchTarget(
        page.getByTestId('guided-gemini-cancel-btn'),
        '360x780 guided-gemini-cancel-btn'
      );
      await page.getByTestId('guided-gemini-cancel-btn').click();
      await guidedModal.waitFor({ state: 'hidden', timeout: 3000 });

      assert.equal(puterSpy.getRequests().length, 0);
      errors.assertZeroErrors();
    } finally {
      await context.close();
    }
  }

  // --- Part 1D: 640x360 Short Landscape Layout & Touch Target Verification (1.0x + Boosted 1.25x Large Text) ---
  {
    const { context, page } = await createBootedContext(ctx.browser, ctx.BASE_URL, {
      label: 'infinite-zoom-s1-landscape-640x360',
      viewport: { width: 640, height: 360 },
      hasTouch: true,
      easyNoReplay: true,
      extraSettings: { infiniteZoomProvider: 'GUIDED_GEMINI' },
      bootUrl: false,
      waitForPuzzle: false,
    });
    try {
      const errors = attachStrictErrorListeners(page, 'iz-s1-landscape', ctx);
      const puterSpy = await attachPuterNetworkSpy(page);
      await injectWindowOpenStub(page);

      await page.goto(`${ctx.BASE_URL}/?skipTutorial=1`, { waitUntil: 'domcontentloaded' });
      await waitForPuzzleLoaded(page);

      await assertTopBarLanesNonOverlapping(page, '640x360 Landscape TopBar');

      // Verify CreateTab card on 640x360 (1.0x)
      await page.getByTestId('topbar-settings-btn').click();
      await page.getByTestId('settings-tab-create').click();
      const createCard = page.locator('.capy-iz-provider-card');
      await createCard.waitFor({ state: 'visible', timeout: 3000 });
      await assertNoHorizontalOverflow(page, createCard, '640x360 Landscape CreateCard');
      await assertMinTouchTarget(
        page.getByTestId('create-infinite-zoom-in-btn'),
        '640x360 create-infinite-zoom-in-btn'
      );
      await assertMinTouchTarget(
        page.getByTestId('create-infinite-zoom-out-btn'),
        '640x360 create-infinite-zoom-out-btn'
      );
      await page.getByTestId('settings-modal-close').click();
      await waitForAnimationFrames(page, 2);

      // Verify Infinite Zoom popover on 640x360 (1.0x)
      const sparklesBtn = page.getByTestId('infinite-zoom-menu-btn');
      await assertMinTouchTarget(sparklesBtn, '640x360 infinite-zoom-menu-btn');
      await sparklesBtn.click();
      const popover = page.locator('[role="dialog"][aria-label="Infinite Zoom Controls"]');
      await popover.waitFor({ state: 'visible', timeout: 3000 });
      await assertInsideViewport(page, popover, '640x360 Landscape Popover');
      await assertNoHorizontalOverflow(page, popover, '640x360 Landscape Popover');
      await assertMinTouchTarget(
        page.getByTestId('toolbar-infinite-zoom-in-btn'),
        '640x360 toolbar-infinite-zoom-in-btn'
      );
      await assertMinTouchTarget(
        page.getByTestId('toolbar-infinite-zoom-out-btn'),
        '640x360 toolbar-infinite-zoom-out-btn'
      );

      // Verify RegionSelectionBar on 640x360 (1.0x)
      await page.getByTestId('toolbar-infinite-zoom-in-btn').click();
      const selBar = page.getByTestId('region-selection-bar');
      await selBar.waitFor({ state: 'visible', timeout: 3000 });
      await assertInsideViewport(page, selBar, '640x360 Landscape RegionSelectionBar');
      await assertNoHorizontalOverflow(page, selBar, '640x360 Landscape RegionSelectionBar');
      await assertMinTouchTarget(
        page.getByTestId('region-selection-cancel-btn'),
        '640x360 region-selection-cancel-btn'
      );
      await assertMinTouchTarget(
        page.getByTestId('region-selection-clear-btn'),
        '640x360 region-selection-clear-btn'
      );
      await assertMinTouchTarget(
        page.getByTestId('region-selection-confirm-btn'),
        '640x360 region-selection-confirm-btn'
      );

      // Open GuidedGeminiHandoffModal on 640x360 and verify sticky header/footer containment
      const sess = await readActiveSession(page);
      const targets = await findUnifiedRegionTargets(page, sess.activeSnapshotId);
      assert.ok(targets && targets.unfilledRootTargets.length > 0, '640x360: expected clickable region');
      await page.mouse.click(
        targets.unfilledRootTargets[0].clientX,
        targets.unfilledRootTargets[0].clientY
      );
      await page.waitForFunction(
        () => !document.querySelector('[data-testid="region-selection-confirm-btn"]')?.disabled,
        { timeout: 3000 }
      );
      await page.getByTestId('region-selection-confirm-btn').click();

      const guidedModal = page.getByTestId('guided-gemini-modal');
      await guidedModal.waitFor({ state: 'visible', timeout: 10000 });
      await assertInsideViewport(page, guidedModal, '640x360 Landscape GuidedGeminiModal');
      await assertNoHorizontalOverflow(page, guidedModal, '640x360 Landscape GuidedGeminiModal');
      await assertMinTouchTarget(
        page.getByTestId('guided-gemini-copy-image-btn'),
        '640x360 guided-gemini-copy-image-btn'
      );
      await assertMinTouchTarget(
        page.getByTestId('guided-gemini-cancel-btn'),
        '640x360 guided-gemini-cancel-btn'
      );
      await assertMinTouchTarget(
        page.getByTestId('guided-gemini-launch-btn'),
        '640x360 guided-gemini-launch-btn'
      );
      await page.getByTestId('guided-gemini-cancel-btn').click();
      await guidedModal.waitFor({ state: 'hidden', timeout: 3000 });

      // Now enable Large Text (1.25x -> data-ui-boosted="true") on 640x360 to exercise
      // @media (max-height: 440px) + [data-ui-boosted="true"] CSS rules in index.css
      await page.getByTestId('topbar-settings-btn').click();
      await page.getByTestId('settings-tab-settings').click();
      const largeTextSwitch = page.getByTestId('setting-large-text');
      await largeTextSwitch.waitFor({ state: 'visible', timeout: 3000 });
      if ((await largeTextSwitch.getAttribute('aria-checked')) !== 'true') {
        await largeTextSwitch.click();
      }
      await page.waitForFunction(
        () =>
          document.documentElement.dataset.largeText === 'true' &&
          document.documentElement.dataset.uiBoosted === 'true' &&
          window.matchMedia('(max-height: 440px)').matches,
        { timeout: 3000 }
      );
      await page.getByTestId('settings-modal-close').click();
      await waitForAnimationFrames(page, 2);

      // Verify expanded .capy-iz-popover on 640x360 + Large Text (data-ui-boosted="true")
      await sparklesBtn.click();
      await popover.waitFor({ state: 'visible', timeout: 3000 });
      await assertInsideViewport(page, popover, '640x360 Boosted Popover');
      await assertNoHorizontalOverflow(page, popover, '640x360 Boosted Popover');
      await assertMinTouchTarget(
        popover.locator('button[aria-label="Close Infinite Zoom menu"]'),
        '640x360 Boosted popover close button'
      );
      await assertMinTouchTarget(
        page.getByTestId('toolbar-infinite-zoom-in-btn'),
        '640x360 Boosted toolbar-infinite-zoom-in-btn'
      );
      await assertMinTouchTarget(
        page.getByTestId('toolbar-infinite-zoom-out-btn'),
        '640x360 Boosted toolbar-infinite-zoom-out-btn'
      );

      await page.getByTestId('toolbar-infinite-zoom-out-btn').click();
      await assertInsideViewport(page, popover, '640x360 Boosted Expanded Popover');
      await assertNoHorizontalOverflow(page, popover, '640x360 Boosted Expanded Popover');
      for (const side of ['top', 'bottom', 'left', 'right']) {
        await assertMinTouchTarget(
          page.getByTestId(`extend-side-${side}`),
          `640x360 Boosted extend-side-${side}`
        );
      }
      await assertMinTouchTarget(
        page.getByTestId('toolbar-infinite-zoom-out-confirm-btn'),
        '640x360 Boosted toolbar-infinite-zoom-out-confirm-btn'
      );

      // Verify RegionSelectionBar on 640x360 + Large Text (data-ui-boosted="true")
      await page.getByTestId('toolbar-infinite-zoom-in-btn').click();
      await selBar.waitFor({ state: 'visible', timeout: 3000 });
      await assertInsideViewport(page, selBar, '640x360 Boosted RegionSelectionBar');
      await assertNoHorizontalOverflow(page, selBar, '640x360 Boosted RegionSelectionBar');
      await assertMinTouchTarget(
        page.getByTestId('region-selection-cancel-btn'),
        '640x360 Boosted region-selection-cancel-btn'
      );
      await assertMinTouchTarget(
        page.getByTestId('region-selection-clear-btn'),
        '640x360 Boosted region-selection-clear-btn'
      );
      await assertMinTouchTarget(
        page.getByTestId('region-selection-confirm-btn'),
        '640x360 Boosted region-selection-confirm-btn'
      );
      await page.getByTestId('region-selection-cancel-btn').click();
      await selBar.waitFor({ state: 'hidden', timeout: 3000 });

      assert.equal(puterSpy.getRequests().length, 0);
      errors.assertZeroErrors();
    } finally {
      await context.close();
    }
  }

  ctx.logE2ePass(label);
}

// ============================================================================
// Stage 2: Unified Zoom In (Puter Mock), 1-Tap Undo, >12x Zoom & Multi-Layer Paint
// ============================================================================

async function runStage2(ctx) {
  const label =
    'Infinite Zoom Stage 2: Unified Zoom In (Puter mock), 1-tap Undo, >12x dynamic zoom & multi-layer painting';
  ctx.logE2eStart(label);

  const { context, page } = await createBootedContext(ctx.browser, ctx.BASE_URL, {
    label: 'infinite-zoom-s2',
    easyNoReplay: true,
    extraSettings: { showZoomButtons: true, showResetViewButton: true },
    bootUrl: false,
    waitForPuzzle: false,
  });

  try {
    const errors = attachStrictErrorListeners(page, 'iz-s2', ctx);
    const puterSpy = await attachPuterNetworkSpy(page);
    await injectPuterMock(page, { pngDataUrl: MULTI_COLOR_PNG_DATA_URL, mode: 'ok' });

    await page.goto(`${ctx.BASE_URL}/?skipTutorial=1`, { waitUntil: 'domcontentloaded' });
    await waitForPuzzleLoaded(page);

    const sessionBefore = await readActiveSession(page);
    const snapId = sessionBefore.activeSnapshotId;
    const snapshotsBefore = await readSnapshots(page);
    const puzzleBefore = await readPuzzleSummary(page, snapId);
    assert.ok(snapId && puzzleBefore, 'Stage 2: expected loaded puzzle in IDB');
    assert.equal(puzzleBefore.nestedLayers.length, 0, 'Stage 2: initial puzzle must have 0 nested layers');
    assert.equal(puzzleBefore.maxZoomDepth, 0, 'Stage 2: initial maxZoomDepth must be 0');

    const targets = await findUnifiedRegionTargets(page, snapId);
    assert.ok(targets?.largePair, 'Stage 2: expected touching pair + non-adjacent root regions');
    const { a, b, nonAdjacent } = targets.largePair;

    // Enter Region Selection mode
    await page.getByTestId('infinite-zoom-menu-btn').click();
    await page.getByTestId('toolbar-infinite-zoom-in-btn').click();
    const selBar = page.getByTestId('region-selection-bar');
    await selBar.waitFor({ state: 'visible', timeout: 3000 });

    // Select region A, then tap non-adjacent region -> assert switch prompt & switch cleanly
    await page.mouse.click(a.clientX, a.clientY);
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="region-selection-bar"]')
          ?.innerText.includes('1 region selected'),
      { timeout: 3000 }
    );
    await page.getByTestId('region-selection-mode-badge').waitFor({ state: 'visible', timeout: 3000 });

    await page.mouse.click(nonAdjacent.clientX, nonAdjacent.clientY);
    const switchBtn = page.getByTestId('region-selection-switch-btn');
    await switchBtn.waitFor({ state: 'visible', timeout: 3000 });
    const barTextNonAdj = await selBar.innerText();
    assert.ok(
      barTextNonAdj.includes('That region is not touching your selection.'),
      `Expected non-adjacent warning, got "${barTextNonAdj}"`
    );
    await switchBtn.click();
    await switchBtn.waitFor({ state: 'hidden', timeout: 3000 });

    // Clear and select touching pair A + B
    await page.getByTestId('region-selection-clear-btn').click();
    await page.mouse.click(a.clientX, a.clientY);
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="region-selection-bar"]')
          ?.innerText.includes('1 region selected'),
      { timeout: 3000 }
    );
    await page.mouse.click(b.clientX, b.clientY);
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="region-selection-bar"]')
          ?.innerText.includes('2 regions selected'),
      { timeout: 3000 }
    );

    // Enter raw prompt with extra whitespace/control chars to verify sanitization
    await page
      .getByTestId('infinite-zoom-in-prompt-input')
      .fill('  Tiny wildflowers   and moss  ');
    await page.getByTestId('region-selection-confirm-btn').click();

    const undoToast = page.getByTestId('undo-subdivision-toast');
    await undoToast.waitFor({ state: 'visible', timeout: 25000 });

    // Assert Puter call payload contract & zero external script loads
    const puterCalls = await page.evaluate(() => window.__puterCalls || []);
    assert.equal(puterCalls.length, 1, `Expected 1 Puter call, got ${puterCalls.length}`);
    const call = puterCalls[0];
    assert.equal(call.options?.model, 'gemini-nano-banana-2.1', 'Expected default Nano Banana 2.1 model');
    assert.ok(
      ALLOWED_TEMPLATE_MIMES.has(call.options?.input_image_mime_type),
      `Expected compact raster MIME (image/jpeg|image/webp|image/png), got "${call.options?.input_image_mime_type}"`
    );
    assert.equal(
      call.options?.quality,
      '1K',
      `Expected validated 1K quality on Nano Banana 2.1, got "${call.options?.quality}"`
    );
    assert.ok(
      typeof call.options?.input_image === 'string' &&
        call.options.input_image.length > 100 &&
        !call.options.input_image.startsWith('data:'),
      'Expected non-empty raw base64 input_image without data URL prefix'
    );
    const decodedTemplateBytes = Buffer.from(call.options.input_image, 'base64').byteLength;
    assert.ok(
      decodedTemplateBytes > 0 && decodedTemplateBytes <= MAX_AI_TEMPLATE_BYTES,
      `Expected compact AI template <= ${MAX_AI_TEMPLATE_BYTES} bytes, got ${decodedTemplateBytes}`
    );
    assertValidPuterRatio(call.options?.ratio, 'Stage 2 Zoom In Puter ratio');
    assert.ok(
      typeof call.prompt === 'string' && call.prompt.includes('Tiny wildflowers and moss'),
      `Expected sanitized user prompt inside Puter prompt, got "${call.prompt}"`
    );
    assert.equal(await page.locator('script[src*="js.puter.com"]').count(), 0);
    assert.equal(puterSpy.getRequests().length, 0);

    // Verify unified single-canvas invariants: NO separate child save
    assert.equal(
      await page.getByTestId('topbar-parent-puzzle-btn').count(),
      0,
      'Unified Zoom In must NOT show topbar-parent-puzzle-btn'
    );
    const snapshotsAfterFirstZoom = await readSnapshots(page);
    const sessionAfterFirstZoom = await readActiveSession(page);
    assert.equal(
      snapshotsAfterFirstZoom.length,
      snapshotsBefore.length,
      'Unified Zoom In must NOT create a separate child snapshot'
    );
    assert.equal(
      sessionAfterFirstZoom.activeSnapshotId,
      snapId,
      'activeSnapshotId must remain identical after Zoom In'
    );

    const puzzleAfterFirstZoom = await readPuzzleSummary(page, snapId);
    assert.equal(puzzleAfterFirstZoom.nestedLayers.length, 1, 'Expected 1 embedded nested layer');
    assert.equal(puzzleAfterFirstZoom.maxZoomDepth, 1, 'Expected maxZoomDepth === 1');
    assert.ok(
      puzzleAfterFirstZoom.totalRegionCount > puzzleBefore.totalRegionCount,
      `Expected total regions to grow (${puzzleAfterFirstZoom.totalRegionCount} > ${puzzleBefore.totalRegionCount})`
    );

    // Verify M3 auto-camera focus glide settles (zoomScale > 1.05) before 1-tap Undo
    const autoFocused = await waitForCondition(async () => {
      const sess = await readActiveSession(page);
      return typeof sess.zoomScale === 'number' && sess.zoomScale > 1.05;
    }, 5000);
    assert.equal(autoFocused, true, 'Expected Zoom In to smoothly auto-focus camera (zoomScale > 1.05)');

    // 1-Tap Undo Infinite Zoom (BEFORE painting, since painting clears the undo toast)
    await page.getByTestId('undo-subdivision-btn').click();
    await undoToast.waitFor({ state: 'hidden', timeout: 10000 });
    const undoSplitRestored = await waitForCondition(
      async () => {
        const snaps = await readSnapshots(page);
        const cur = snaps.find((s) => s.id === snapId);
        return Boolean(cur && cur.totalCount === puzzleBefore.totalRegionCount);
      },
      10000,
      50
    );
    assert.equal(
      undoSplitRestored,
      true,
      'Expected 1-tap Undo Split to restore pre-zoom snapshot totalCount'
    );
    const puzzleAfterUndo = await readPuzzleSummary(page, snapId);
    assert.equal(
      puzzleAfterUndo.nestedLayers.length,
      0,
      '1-tap Undo Split must remove the embedded nested layer'
    );
    assert.equal(
      puzzleAfterUndo.totalRegionCount,
      puzzleBefore.totalRegionCount,
      '1-tap Undo Split must restore exact pre-zoom region count'
    );
    assert.equal((await readSnapshots(page)).length, snapshotsBefore.length);

    const undoViewportRestored = await waitForCondition(async () => {
      const sess = await readActiveSession(page);
      return (
        typeof sess.zoomScale === 'number' &&
        sess.zoomScale <= 1.05 &&
        Math.abs(sess.panOffsetX || 0) <= 1 &&
        Math.abs(sess.panOffsetY || 0) <= 1
      );
    }, 4000);
    assert.equal(
      undoViewportRestored,
      true,
      'Expected 1-tap Undo Split to restore pre-zoom viewport before re-selection'
    );
    await waitForAnimationFrames(page, 2);

    // Re-apply Zoom In on A + B
    await dismissFeatureOfferIfVisible(page);
    await page.getByTestId('infinite-zoom-menu-btn').click();
    await page.getByTestId('toolbar-infinite-zoom-in-btn').click();
    await selBar.waitFor({ state: 'visible', timeout: 3000 });
    await page.mouse.click(a.clientX, a.clientY);
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="region-selection-bar"]')
          ?.innerText.includes('1 region selected'),
      { timeout: 3000 }
    );
    await page.mouse.click(b.clientX, b.clientY);
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="region-selection-bar"]')
          ?.innerText.includes('2 regions selected'),
      { timeout: 3000 }
    );
    await page.getByTestId('region-selection-confirm-btn').click();
    await undoToast.waitFor({ state: 'visible', timeout: 25000 });

    const puzzleUnified = await readPuzzleSummary(page, snapId);
    assert.equal(puzzleUnified.nestedLayers.length, 1);
    assert.equal(puzzleUnified.maxZoomDepth, 1);

    // Verify dynamic max zoom scales cleanly ABOVE 12x (worldBounds-aware up to 256x)
    const zoomInBtn = page.getByTestId('zoom-in-btn');
    await zoomInBtn.waitFor({ state: 'visible', timeout: 3000 });
    for (let i = 0; i < 16; i++) {
      await zoomInBtn.click();
    }
    const scaledAbove12 = await waitForCondition(async () => {
      const sess = await readActiveSession(page);
      return typeof sess.zoomScale === 'number' && sess.zoomScale > 12;
    }, 5000);
    const zoomedSess = await readActiveSession(page);
    assert.equal(
      scaledAbove12,
      true,
      `Expected dynamic max zoom > 12x at depth 1, got zoomScale=${zoomedSess.zoomScale}`
    );
    assert.ok(
      zoomedSess.zoomScale <= 256.05,
      `Expected depth-1 zoomScale <= 256x, got ${zoomedSess.zoomScale}`
    );

    // Reset view back to 1x so both outer root and nested detail layers are cleanly clickable
    await page.getByTestId('reset-view-btn').click();
    const resetDone = await waitForCondition(async () => {
      const sess = await readActiveSession(page);
      return typeof sess.zoomScale === 'number' && sess.zoomScale <= 1.05;
    }, 4000);
    assert.equal(resetDone, true, 'Expected reset-view-btn to return zoomScale to ~1x');
    await waitForAnimationFrames(page, 2);
    await dismissFeatureOfferIfVisible(page);

    // Paint BOTH an outer root region AND a nested detail layer region in the same session
    const unifiedTargets = await findUnifiedRegionTargets(page, snapId);
    assert.ok(
      unifiedTargets &&
        unifiedTargets.unfilledRootTargets.length > 0 &&
        unifiedTargets.unfilledNestedTargets.length > 0,
      `Expected clickable outer (${unifiedTargets?.unfilledRootTargets?.length}) and nested (${unifiedTargets?.unfilledNestedTargets?.length}) targets`
    );
    const outerTarget = unifiedTargets.unfilledRootTargets[0];
    const nestedTarget = unifiedTargets.unfilledNestedTargets.find(
      (cand) => Math.hypot(cand.clientX - outerTarget.clientX, cand.clientY - outerTarget.clientY) >= 48
    ) || unifiedTargets.unfilledNestedTargets[0];

    const filledBefore = Number(
      await page.getByTestId('topbar-saves-btn').getAttribute('data-filled-count')
    );
    const remainingBefore = await readTotalRemainingRegions(page);

    await paintTargetRegion(page, outerTarget);
    // Painting commits history and clears the undo-subdivision toast
    await undoToast.waitFor({ state: 'hidden', timeout: 3000 });
    const filledAfterOuter = Number(
      await page.getByTestId('topbar-saves-btn').getAttribute('data-filled-count')
    );
    assert.equal(filledAfterOuter, filledBefore + 1, 'Outer root paint must increment filledCount');

    // INTENTIONAL_TIMING_WINDOW: ensure second paint tap exceeds 350ms double-tap window if close
    await page.waitForTimeout(380);
    await paintTargetRegion(page, nestedTarget);
    const filledAfterNested = Number(
      await page.getByTestId('topbar-saves-btn').getAttribute('data-filled-count')
    );
    assert.equal(filledAfterNested, filledBefore + 2, 'Nested detail paint must increment filledCount');

    const remainingAfterBoth = await readTotalRemainingRegions(page);
    assert.equal(
      remainingAfterBoth,
      remainingBefore - 2,
      'Shared PaletteDock remaining count must decrement for both outer and nested layer paints'
    );

    // Verify unified Undo & Redo across both layers
    await dismissFeatureOfferIfVisible(page);
    await page.getByTestId('undo-btn').click();
    const undidNested = await waitForCondition(async () => {
      const sess = await readActiveSession(page);
      return (
        Array.isArray(sess.filledRegionIds) &&
        !sess.filledRegionIds.includes(nestedTarget.id) &&
        sess.filledRegionIds.includes(outerTarget.id)
      );
    }, 4000);
    assert.equal(undidNested, true, 'First Undo must revert nested layer paint');

    await dismissFeatureOfferIfVisible(page);
    await page.getByTestId('undo-btn').click();
    const undidOuter = await waitForCondition(async () => {
      const sess = await readActiveSession(page);
      return Array.isArray(sess.filledRegionIds) && !sess.filledRegionIds.includes(outerTarget.id);
    }, 4000);
    assert.equal(undidOuter, true, 'Second Undo must revert outer root paint');

    await page.getByTestId('redo-btn').click();
    await waitForAnimationFrames(page, 2);
    await page.getByTestId('redo-btn').click();
    const redidBoth = await waitForCondition(async () => {
      const sess = await readActiveSession(page);
      return (
        Array.isArray(sess.filledRegionIds) &&
        sess.filledRegionIds.includes(outerTarget.id) &&
        sess.filledRegionIds.includes(nestedTarget.id)
      );
    }, 4000);
    assert.equal(redidBoth, true, 'Redo twice must restore both outer and nested layer paints');

    assert.equal(puterSpy.getRequests().length, 0);
    errors.assertZeroErrors();
  } finally {
    await context.close();
  }

  ctx.logE2ePass(label);
}

// ============================================================================
// Stage 3: Unified Zoom Out (BYOK Mock), 100% Progress & Nested Preservation,
//          2.5:1 Guard & Single-File .capy v2 Round-Trip
// ============================================================================

async function runStage3(ctx) {
  const label =
    'Infinite Zoom Stage 3: Unified Zoom Out (BYOK mock), progress/layer preservation, 2.5:1 guard & .capy v2 round-trip';
  ctx.logE2eStart(label);

  const TEST_BYOK_KEY = 'AIzaSyCapyE2EByokSecretKey987654321';
  const exportedCapyPath = path.join(
    os.tmpdir(),
    `capy_iz_v2_roundtrip_${process.pid}_${Date.now()}.capy`
  );

  let expectedTotalRegions = 0;
  let expectedNestedLayerCount = 0;
  let expectedMaxZoomDepth = 0;
  let expectedFilledIds = [];

  try {
    // --- Context 1: Paint + Zoom In + BYOK Zoom Out + 2.5:1 Guard + Export .capy v2 ---
    const { context, page } = await createBootedContext(ctx.browser, ctx.BASE_URL, {
      label: 'infinite-zoom-s3-export',
      acceptDownloads: true,
      easyNoReplay: true,
      extraSettings: { showZoomButtons: true, showResetViewButton: true },
      bootUrl: false,
      waitForPuzzle: false,
    });
    try {
      const errors = attachStrictErrorListeners(page, 'iz-s3-export', ctx);
      const puterSpy = await attachPuterNetworkSpy(page);
      await injectPuterMock(page, { pngDataUrl: MULTI_COLOR_PNG_DATA_URL, mode: 'ok' });

      const geminiRequests = [];
      await page.route(
        'https://generativelanguage.googleapis.com/v1beta/models/*:generateContent',
        async (route) => {
          const req = route.request();
          const headers = req.headers();
          const url = req.url();
          let body = null;
          try {
            body = req.postDataJSON();
          } catch {
            body = null;
          }
          geminiRequests.push({
            url,
            apiKeyHeader: headers['x-goog-api-key'] || null,
            body,
          });
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
                          data: MULTI_COLOR_PNG_BASE64,
                        },
                      },
                    ],
                  },
                },
              ],
            }),
          });
        }
      );

      await page.goto(`${ctx.BASE_URL}/?skipTutorial=1`, { waitUntil: 'domcontentloaded' });
      await waitForPuzzleLoaded(page);

      const initialSession = await readActiveSession(page);
      const snapId = initialSession.activeSnapshotId;
      const snapshotsBefore = await readSnapshots(page);

      // Step 1: Paint 2 distinct root regions outside our Zoom In pair
      const initialTargets = await findUnifiedRegionTargets(page, snapId);
      assert.ok(initialTargets?.largePair, 'Stage 3: expected touching pair');
      const { a, b } = initialTargets.largePair;
      const prePaintRootTargets = pickWellSeparatedTargets(
        initialTargets.unfilledRootTargets,
        2,
        new Set([a.id, b.id]),
        48
      );
      assert.equal(prePaintRootTargets.length, 2, 'Stage 3: expected 2 root regions to pre-paint');
      for (const target of prePaintRootTargets) {
        await paintTargetRegion(page, target);
      }

      // Step 2: Create a nested Zoom In detail layer on A + B and paint 1 nested region too
      await dismissFeatureOfferIfVisible(page);
      await page.getByTestId('infinite-zoom-menu-btn').click();
      await page.getByTestId('toolbar-infinite-zoom-in-btn').click();
      await page.getByTestId('region-selection-bar').waitFor({ state: 'visible', timeout: 3000 });
      await page.mouse.click(a.clientX, a.clientY);
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-testid="region-selection-bar"]')
            ?.innerText.includes('1 region selected'),
        { timeout: 3000 }
      );
      await page.mouse.click(b.clientX, b.clientY);
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-testid="region-selection-bar"]')
            ?.innerText.includes('2 regions selected'),
        { timeout: 3000 }
      );
      await page.getByTestId('region-selection-confirm-btn').click();
      const undoToast = page.getByTestId('undo-subdivision-toast');
      await undoToast.waitFor({ state: 'visible', timeout: 25000 });

      // Wait for M3 auto-camera focus glide (420ms) + viewport persistence debounce (350ms)
      // so findUnifiedRegionTargets reads the settled camera transform rather than stale 1x.
      const stage3Focused = await waitForCondition(async () => {
        const sess = await readActiveSession(page);
        return typeof sess.zoomScale === 'number' && sess.zoomScale > 1.05;
      }, 5000);
      assert.equal(stage3Focused, true, 'Stage 3: expected auto-camera focus after Zoom In');
      await waitForAnimationFrames(page, 2);

      const afterZoomInTargets = await findUnifiedRegionTargets(page, snapId);
      assert.ok(
        afterZoomInTargets?.unfilledNestedTargets?.length > 0,
        'Stage 3: expected paintable region in nested detail layer'
      );
      await paintTargetRegion(page, afterZoomInTargets.unfilledNestedTargets[0]);
      await undoToast.waitFor({ state: 'hidden', timeout: 3000 });

      const puzzleBeforeExtend = await readPuzzleSummary(page, snapId);
      assert.equal(puzzleBeforeExtend.nestedLayers.length, 1, 'Expected 1 nested layer before Zoom Out');
      const preExistingDetailLayer = puzzleBeforeExtend.nestedLayers[0];
      const sessionBeforeExtend = await readActiveSession(page);
      const filledBeforeExtend = [...(sessionBeforeExtend.filledRegionIds || [])];
      assert.ok(
        filledBeforeExtend.length >= 3,
        `Expected >= 3 painted regions (root + nested) before Zoom Out, got ${filledBeforeExtend.length}`
      );

      // Step 3: Switch provider to GEMINI_BYOK and save test API key
      await page.getByTestId('topbar-settings-btn').click();
      await page.getByTestId('settings-tab-create').click();
      await page.getByTestId('iz-provider-select').selectOption('GEMINI_BYOK');
      await page.getByTestId('iz-byok-key-input').fill(TEST_BYOK_KEY);
      await page.getByTestId('iz-byok-save-btn').click();
      await page.waitForFunction(
        (k) => localStorage.getItem(k) !== null,
        BYOK_KEY_STORAGE_KEY,
        { timeout: 3000 }
      );
      await page.getByTestId('settings-modal-close').click();
      await waitForAnimationFrames(page, 2);

      // Step 4: Verify 0-side alert guard, then extend Top + Left via Direct Gemini BYOK
      await page.getByTestId('infinite-zoom-menu-btn').click();
      const popover = page.locator('[role="dialog"][aria-label="Infinite Zoom Controls"]');
      await popover.waitFor({ state: 'visible', timeout: 3000 });
      await page.getByTestId('toolbar-infinite-zoom-out-btn').click();

      await setExtendSideState(page, 'extend-side-top', false);
      await setExtendSideState(page, 'extend-side-bottom', false);
      await setExtendSideState(page, 'extend-side-left', false);
      await setExtendSideState(page, 'extend-side-right', false);

      const zeroSideAlert = popover.locator('[role="alert"]');
      await zeroSideAlert.waitFor({ state: 'visible', timeout: 3000 });
      assert.ok(
        (await zeroSideAlert.innerText()).includes('Select at least one border side'),
        'Expected 0-side guard alert message'
      );
      assert.equal(
        await page.getByTestId('toolbar-infinite-zoom-out-confirm-btn').isDisabled(),
        true,
        'Confirm button must be disabled when 0 sides are selected'
      );

      // Enable Top + Left and confirm Zoom Out
      await setExtendSideState(page, 'extend-side-top', true);
      await setExtendSideState(page, 'extend-side-left', true);
      await page.getByTestId('infinite-zoom-out-prompt-input').fill('Starry hills');
      await page.getByTestId('toolbar-infinite-zoom-out-confirm-btn').click();

      await undoToast.waitFor({ state: 'visible', timeout: 25000 });
      assert.ok(
        (await page.getByTestId('undo-subdivision-btn').innerText()).includes('Undo Extend'),
        'Expected Undo Extend label on Zoom Out toast'
      );

      // Assert Direct Gemini BYOK HTTP contract
      assert.equal(geminiRequests.length, 1, 'Expected 1 Direct Gemini BYOK HTTP request');
      assert.equal(
        geminiRequests[0].apiKeyHeader,
        TEST_BYOK_KEY,
        'x-goog-api-key header must match saved BYOK key'
      );
      assert.equal(
        geminiRequests[0].url.includes(TEST_BYOK_KEY),
        false,
        'BYOK API key must NEVER appear in request URL'
      );
      assert.equal(
        geminiRequests[0].body?.generationConfig?.imageConfig?.imageSize,
        '1K',
        'Expected 1K resolution in Gemini imageConfig'
      );
      const inlinePart = geminiRequests[0].body?.contents?.[0]?.parts?.find((p) => p?.inlineData);
      assert.ok(
        ALLOWED_TEMPLATE_MIMES.has(inlinePart?.inlineData?.mimeType),
        `Expected compact raster inlineData.mimeType, got "${inlinePart?.inlineData?.mimeType}"`
      );
      const byokTemplateBytes = Buffer.from(inlinePart.inlineData.data || '', 'base64').byteLength;
      assert.ok(
        byokTemplateBytes > 0 && byokTemplateBytes <= MAX_AI_TEMPLATE_BYTES,
        `Expected BYOK Zoom Out template <= ${MAX_AI_TEMPLATE_BYTES} bytes, got ${byokTemplateBytes}`
      );
      assert.ok(
        VALID_GEMINI_ASPECT_RATIOS.has(
          geminiRequests[0].body?.generationConfig?.imageConfig?.aspectRatio
        ),
        `Expected valid Gemini aspectRatio string, got "${geminiRequests[0].body?.generationConfig?.imageConfig?.aspectRatio}"`
      );

      // Verify unified Zoom Out invariants: NO separate 0% save, 100% painted progress & nested layer preserved
      assert.equal(await page.getByTestId('topbar-parent-puzzle-btn').count(), 0);
      assert.equal(
        (await readSnapshots(page)).length,
        snapshotsBefore.length,
        'Unified Zoom Out must NOT create a separate 0% outer snapshot'
      );
      const sessionAfterExtend = await readActiveSession(page);
      assert.equal(sessionAfterExtend.activeSnapshotId, snapId);
      const filledSetAfterExtend = new Set(sessionAfterExtend.filledRegionIds || []);
      for (const prevId of filledBeforeExtend) {
        assert.equal(
          filledSetAfterExtend.has(prevId),
          true,
          `Previously painted region ${prevId} MUST remain painted after Zoom Out`
        );
      }

      const puzzleAfterExtend = await readPuzzleSummary(page, snapId);
      assert.equal(
        puzzleAfterExtend.nestedLayers.length,
        puzzleBeforeExtend.nestedLayers.length + 1,
        'Zoom Out must demote prior root and preserve existing nested detail layer'
      );
      assert.equal(puzzleAfterExtend.maxZoomDepth, 2, 'Expected maxZoomDepth === 2 after Zoom In + Zoom Out');
      assert.ok(
        puzzleAfterExtend.totalRegionCount > puzzleBeforeExtend.totalRegionCount,
        'Expected outer border regions added to unified totalCount'
      );

      const rebasedDetailLayer = puzzleAfterExtend.nestedLayers.find(
        (l) => l.layerId === preExistingDetailLayer.layerId
      );
      assert.ok(rebasedDetailLayer, 'Pre-existing nested detail layer must survive Zoom Out');
      assert.equal(
        rebasedDetailLayer.depth,
        preExistingDetailLayer.depth + 1,
        'Pre-existing nested detail layer depth must increment on Zoom Out'
      );
      assert.ok(
        rebasedDetailLayer.worldBounds.x > preExistingDetailLayer.worldBounds.x &&
          rebasedDetailLayer.worldBounds.y > preExistingDetailLayer.worldBounds.y &&
          rebasedDetailLayer.worldBounds.width < preExistingDetailLayer.worldBounds.width &&
          rebasedDetailLayer.worldBounds.height < preExistingDetailLayer.worldBounds.height,
        `Pre-existing nested detail layer worldBounds must be affinely rebased inside Top+Left expanded world (before=${JSON.stringify(preExistingDetailLayer.worldBounds)}, after=${JSON.stringify(rebasedDetailLayer.worldBounds)})`
      );

      // Step 5: Verify 1-tap Undo Extend restores exact pre-extend state
      await page.getByTestId('undo-subdivision-btn').click();
      await undoToast.waitFor({ state: 'hidden', timeout: 10000 });
      const undoExtendRestored = await waitForCondition(
        async () => {
          const snaps = await readSnapshots(page);
          const cur = snaps.find((s) => s.id === snapId);
          return Boolean(cur && cur.totalCount === puzzleBeforeExtend.totalRegionCount);
        },
        10000,
        50
      );
      assert.equal(
        undoExtendRestored,
        true,
        'Expected 1-tap Undo Extend to restore pre-extend snapshot totalCount'
      );
      const puzzleAfterUndoExtend = await readPuzzleSummary(page, snapId);
      assert.equal(puzzleAfterUndoExtend.nestedLayers.length, puzzleBeforeExtend.nestedLayers.length);
      assert.equal(puzzleAfterUndoExtend.maxZoomDepth, puzzleBeforeExtend.maxZoomDepth);
      assert.equal(puzzleAfterUndoExtend.totalRegionCount, puzzleBeforeExtend.totalRegionCount);

      // Step 6: Verify 2.5:1 aspect ratio guard via Left + Right extension and leave an active extended border for Steps 7-8
      await dismissFeatureOfferIfVisible(page);
      await page.getByTestId('infinite-zoom-menu-btn').click();
      await popover.waitFor({ state: 'visible', timeout: 3000 });
      await page.getByTestId('toolbar-infinite-zoom-out-btn').click();
      await setExtendSideState(page, 'extend-side-top', false);
      await setExtendSideState(page, 'extend-side-bottom', false);
      await setExtendSideState(page, 'extend-side-left', true);
      await setExtendSideState(page, 'extend-side-right', true);

      const confirmExtendBtn = page.getByTestId('toolbar-infinite-zoom-out-confirm-btn');
      const aspectAlert = popover.locator('[role="alert"]');
      const leftRightAlreadyBlocked = await confirmExtendBtn.isDisabled();
      if (leftRightAlreadyBlocked) {
        // Wide sample (e.g. 1408x768 = 1.83:1 -> Left+Right = 3.12:1 > 2.5:1) trips 2.5:1 guard immediately
        await aspectAlert.waitFor({ state: 'visible', timeout: 3000 });
        assert.ok(
          (await aspectAlert.innerText()).includes('2.5:1'),
          `Expected 2.5:1 aspect guard alert, got "${await aspectAlert.innerText()}"`
        );
        assert.equal(
          await confirmExtendBtn.isDisabled(),
          true,
          'Confirm button must be disabled when extension exceeds 2.5:1 aspect ratio'
        );
        // Now switch to balanced Top + Left extension so Steps 7 & 8 test outer border painting & .capy v2 round-trip
        await setExtendSideState(page, 'extend-side-top', true);
        await setExtendSideState(page, 'extend-side-right', false);
        assert.equal(
          await confirmExtendBtn.isDisabled(),
          false,
          'Confirm button must re-enable for balanced Top + Left extension'
        );
        await confirmExtendBtn.click();
        await undoToast.waitFor({ state: 'visible', timeout: 25000 });
      } else {
        // Square sample (1:1 -> 1.7:1 on first Left+Right, then 2.89:1 > 2.5:1 on second Left+Right)
        await confirmExtendBtn.click();
        await undoToast.waitFor({ state: 'visible', timeout: 25000 });

        await page.getByTestId('infinite-zoom-menu-btn').click();
        await popover.waitFor({ state: 'visible', timeout: 3000 });
        await page.getByTestId('toolbar-infinite-zoom-out-btn').click();
        await setExtendSideState(page, 'extend-side-top', false);
        await setExtendSideState(page, 'extend-side-bottom', false);
        await setExtendSideState(page, 'extend-side-left', true);
        await setExtendSideState(page, 'extend-side-right', true);

        await aspectAlert.waitFor({ state: 'visible', timeout: 3000 });
        assert.ok(
          (await aspectAlert.innerText()).includes('2.5:1'),
          `Expected 2.5:1 aspect guard alert, got "${await aspectAlert.innerText()}"`
        );
        assert.equal(
          await confirmExtendBtn.isDisabled(),
          true,
          'Confirm button must be disabled when extension exceeds 2.5:1 aspect ratio'
        );
        await page.keyboard.press('Escape');
        await popover.waitFor({ state: 'hidden', timeout: 3000 });
      }

      // Step 7: Paint a newly added outer border region in the SAME unified canvas
      await dismissFeatureOfferIfVisible(page);
      await waitForAnimationFrames(page, 2);
      const postExtendTargets = await findUnifiedRegionTargets(page, snapId);
      assert.ok(
        postExtendTargets?.unfilledRootTargets?.length > 0,
        'Stage 3: expected clickable newly added outer border region'
      );
      const outerBorderTarget = postExtendTargets.unfilledRootTargets[0];
      await paintTargetRegion(page, outerBorderTarget);

      const finalExportPuzzle = await readPuzzleSummary(page, snapId);
      const finalExportSession = await readActiveSession(page);
      expectedTotalRegions = finalExportPuzzle.totalRegionCount;
      expectedNestedLayerCount = finalExportPuzzle.nestedLayers.length;
      expectedMaxZoomDepth = finalExportPuzzle.maxZoomDepth;
      expectedFilledIds = [...(finalExportSession.filledRegionIds || [])];
      assert.ok(expectedFilledIds.includes(outerBorderTarget.id));
      for (const prevId of filledBeforeExtend) {
        assert.ok(
          expectedFilledIds.includes(prevId),
          `Prior painted region ${prevId} must remain in final exported set`
        );
      }

      // Step 8: Export single-file .capy v2 & verify binary structure + zero BYOK leak
      await page.getByTestId('topbar-saves-btn').click();
      await page.getByTestId(`save-card-${snapId}`).click();
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 10000 }),
        page.getByTestId('save-action-export').click(),
      ]);
      await download.saveAs(exportedCapyPath);

      const exportedBuf = fs.readFileSync(exportedCapyPath);
      const parsedCapy = inspectCapyV2Buffer(exportedBuf, TEST_BYOK_KEY);
      assert.equal(
        parsedCapy.compactPuzzle?.nestedLayers?.length,
        expectedNestedLayerCount,
        'Exported .capy v2 must include all nestedLayers'
      );
      assert.equal(
        parsedCapy.compactPuzzle?.maxZoomDepth,
        expectedMaxZoomDepth,
        'Exported .capy v2 must include maxZoomDepth'
      );
      const layerImageKeys = Object.keys(parsedCapy.layerImages || {});
      assert.ok(
        layerImageKeys.length >= expectedNestedLayerCount,
        `Exported .capy v2 must include layerImages (got ${layerImageKeys.length}, expected >= ${expectedNestedLayerCount})`
      );

      assert.equal(puterSpy.getRequests().length, 0);
      errors.assertZeroErrors();
    } finally {
      await context.close();
    }

    // --- Context 2: Fresh Isolated Context .capy v2 Import Round-Trip Verification ---
    const { context: freshContext, page: freshPage } = await createBootedContext(
      ctx.browser,
      ctx.BASE_URL,
      {
        label: 'infinite-zoom-s3-import',
        easyNoReplay: true,
        extraSettings: { showZoomButtons: true },
        bootUrl: false,
        waitForPuzzle: false,
      }
    );
    try {
      const errors = attachStrictErrorListeners(freshPage, 'iz-s3-import', ctx);
      const puterSpy = await attachPuterNetworkSpy(freshPage);

      await freshPage.goto(`${ctx.BASE_URL}/?skipTutorial=1`, { waitUntil: 'domcontentloaded' });
      await waitForPuzzleLoaded(freshPage);

      assert.equal(
        await readByokKey(freshPage),
        null,
        'Fresh isolated context must have no BYOK key'
      );

      const snapsBeforeImport = await readSnapshots(freshPage);
      const idsBeforeImport = new Set(snapsBeforeImport.map((s) => s.id));

      await freshPage.getByTestId('topbar-saves-btn').click();
      await freshPage.getByTestId('import-save-btn').waitFor({ state: 'visible', timeout: 5000 });
      await freshPage.locator('input[type="file"][accept*=".capy"]').setInputFiles(exportedCapyPath);

      const importNotice = freshPage.getByTestId('saves-import-notice');
      await importNotice.waitFor({ state: 'visible', timeout: 10000 });
      assert.ok(
        (await importNotice.innerText()).toLowerCase().includes('imported'),
        `Expected successful import notice, got "${await importNotice.innerText()}"`
      );

      // Locate imported snapshot card (either newly inserted ID or updated matching totalCount)
      const snapsAfterImport = await readSnapshots(freshPage);
      const importedSnap =
        snapsAfterImport.find((s) => !idsBeforeImport.has(s.id)) ||
        snapsAfterImport.find((s) => s.totalCount === expectedTotalRegions);
      assert.ok(importedSnap, 'Expected imported snapshot in capy_snapshots_v8');

      await freshPage.getByTestId(`save-card-${importedSnap.id}`).click();
      await freshPage.getByTestId('save-action-load').click();
      await freshPage.waitForFunction(
        ({ key, targetId }) => {
          const sess = JSON.parse(localStorage.getItem(key) || '{}');
          return (
            sess.activeSnapshotId === targetId &&
            Array.isArray(sess.filledRegionIds) &&
            sess.filledRegionIds.length > 0
          );
        },
        { key: ACTIVE_SESSION_KEY, targetId: importedSnap.id },
        { timeout: 10000 }
      );
      await waitForPuzzleLoaded(freshPage);

      const restoredPuzzle = await readPuzzleSummary(freshPage, importedSnap.id);
      const restoredSession = await readActiveSession(freshPage);
      assert.equal(
        restoredPuzzle.totalRegionCount,
        expectedTotalRegions,
        'Imported .capy v2 must restore exact unified totalRegionCount'
      );
      assert.equal(
        restoredPuzzle.nestedLayers.length,
        expectedNestedLayerCount,
        'Imported .capy v2 must restore exact nestedLayers count'
      );
      assert.equal(
        restoredPuzzle.maxZoomDepth,
        expectedMaxZoomDepth,
        'Imported .capy v2 must restore exact maxZoomDepth'
      );

      const restoredFilledSet = new Set(restoredSession.filledRegionIds || []);
      assert.equal(
        restoredFilledSet.size,
        expectedFilledIds.length,
        'Imported .capy v2 must restore exact painted region count'
      );
      for (const expectedId of expectedFilledIds) {
        assert.equal(
          restoredFilledSet.has(expectedId),
          true,
          `Imported .capy v2 missing painted region ID ${expectedId}`
        );
      }

      // Verify zero BYOK key leaked into fresh context localStorage
      assert.equal(await readByokKey(freshPage), null);
      assert.equal(puterSpy.getRequests().length, 0);
      errors.assertZeroErrors();
    } finally {
      await freshContext.close();
    }
  } finally {
    fs.rmSync(exportedCapyPath, { force: true });
  }

  ctx.logE2ePass(label);
}

// ============================================================================
// Stage 4: Free Guided Gemini Handoff (Web File/Error/Retry, Puter 402 Fallback
//          + Clipboard Paste, Android LIFO Share Receive)
// ============================================================================

async function runStage4(ctx) {
  const label =
    'Infinite Zoom Stage 4: Free Guided Gemini Handoff (Web file/error/retry, Puter 402 fallback + paste, Android LIFO share)';
  ctx.logE2eStart(label);

  // --- Part 4A: Web Guided Gemini Handoff + Invalid File Rejection + Puter 402 Fallback + Paste ---
  {
    const { context, page } = await createBootedContext(ctx.browser, ctx.BASE_URL, {
      label: 'infinite-zoom-s4-web-guided',
      acceptDownloads: true,
      easyNoReplay: true,
      extraSettings: { infiniteZoomProvider: 'GUIDED_GEMINI' },
      bootUrl: false,
      waitForPuzzle: false,
    });
    try {
      const errors = attachStrictErrorListeners(page, 'iz-s4-web', ctx);
      const puterSpy = await attachPuterNetworkSpy(page);
      await injectWindowOpenStub(page);
      await injectPuterMock(page, { pngDataUrl: MULTI_COLOR_PNG_DATA_URL, mode: '402' });
      await injectClipboardWriteSpy(page);

      await page.goto(`${ctx.BASE_URL}/?skipTutorial=1`, { waitUntil: 'domcontentloaded' });
      await waitForPuzzleLoaded(page);

      const sessionBefore = await readActiveSession(page);
      const snapId = sessionBefore.activeSnapshotId;
      const snapshotsBefore = await readSnapshots(page);
      const puzzleBefore = await readPuzzleSummary(page, snapId);
      const targets = await findUnifiedRegionTargets(page, snapId);
      assert.ok(targets?.largePair, 'Stage 4A: expected clickable region targets');

      // Trigger Zoom In under GUIDED_GEMINI
      await page.getByTestId('infinite-zoom-menu-btn').click();
      await page.getByTestId('toolbar-infinite-zoom-in-btn').click();
      await page.getByTestId('region-selection-bar').waitFor({ state: 'visible', timeout: 3000 });
      await page.mouse.click(targets.largePair.a.clientX, targets.largePair.a.clientY);
      await page.waitForFunction(
        () => !document.querySelector('[data-testid="region-selection-confirm-btn"]')?.disabled,
        { timeout: 3000 }
      );
      await page.getByTestId('region-selection-confirm-btn').click();

      const modal = page.getByTestId('guided-gemini-modal');
      await modal.waitFor({ state: 'visible', timeout: 10000 });
      assert.equal(
        await page.getByTestId('guided-gemini-fallback-notice').count(),
        0,
        'Direct GUIDED_GEMINI launch should not show fallback notice'
      );

      // Assert template preview image loaded & prompt text populated
      const previewImg = modal.locator('img[alt="Prepared puzzle template preview"]');
      await previewImg.waitFor({ state: 'visible', timeout: 5000 });
      const previewLoaded = await previewImg.evaluate(
        (img) => img.complete && img.naturalWidth > 0 && Boolean(img.src)
      );
      assert.equal(previewLoaded, true, 'Guided Gemini template preview image must load');

      const modalText = await modal.innerText();
      assert.ok(
        modalText.toLowerCase().includes('magenta') || modalText.toLowerCase().includes('infill'),
        'Guided Gemini modal must display the engineered infill prompt'
      );

      // Verify Web 1-tap Copy Image button writes PNG-normalized bytes to clipboard
      const copyImgBtn = page.getByTestId('guided-gemini-copy-image-btn');
      await copyImgBtn.waitFor({ state: 'visible', timeout: 5000 });
      await assertMinTouchTarget(copyImgBtn, 'Stage 4A guided-gemini-copy-image-btn');
      await copyImgBtn.click();
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-testid="guided-gemini-copy-image-btn"]')
            ?.textContent?.includes('Copied Image'),
        { timeout: 5000 }
      );
      const clipboardWrites = await page.evaluate(() => window.__clipboardImageWrites || []);
      assert.ok(clipboardWrites.length >= 1, 'Expected Copy Image to invoke navigator.clipboard.write');
      assert.ok(
        clipboardWrites[0].types.includes('image/png'),
        `Expected image/png ClipboardItem type, got ${JSON.stringify(clipboardWrites[0].types)}`
      );
      assert.equal(clipboardWrites[0].mimeType, 'image/png', 'Copied blob must be image/png');
      assert.ok(clipboardWrites[0].byteLength > 8, 'Copied PNG blob must be non-empty');
      assert.equal(
        clipboardWrites[0].headerHex,
        '89504e470d0a1a0a',
        `Copied blob must have PNG magic bytes, got "${clipboardWrites[0].headerHex}"`
      );

      // Click launch button -> verify compact template image download AND window.open('https://gemini.google.com/')
      const [templateDownload] = await Promise.all([
        page.waitForEvent('download', { timeout: 10000 }),
        page.getByTestId('guided-gemini-launch-btn').click(),
      ]);
      assert.match(
        templateDownload.suggestedFilename(),
        /\.(?:jpe?g|webp|png)$/i,
        `Expected compact template image download (.jpg/.jpeg/.webp/.png), got "${templateDownload.suggestedFilename()}"`
      );
      const downloadedTemplatePath = await templateDownload.path();
      assert.ok(downloadedTemplatePath, 'Expected Playwright to persist downloaded template file');
      const downloadedTemplateSize = fs.statSync(downloadedTemplatePath).size;
      assert.ok(
        downloadedTemplateSize > 0 && downloadedTemplateSize <= MAX_AI_TEMPLATE_BYTES,
        `Expected downloaded template <= ${MAX_AI_TEMPLATE_BYTES} bytes, got ${downloadedTemplateSize}`
      );
      await page.waitForFunction(
        () => (window.__openedUrls || []).some((u) => u.includes('gemini.google.com')),
        { timeout: 5000 }
      );
      const openedUrls = await page.evaluate(() => window.__openedUrls || []);
      assert.ok(
        openedUrls.some((u) => u.includes('gemini.google.com')),
        `Expected window.open to launch gemini.google.com, got ${JSON.stringify(openedUrls)}`
      );

      const fileInput = page.getByTestId('guided-gemini-file-input');
      const errorBanner = page.getByTestId('guided-gemini-error');

      // Negative robustness test 1: invalid SVG upload
      await fileInput.setInputFiles({
        name: 'invalid-vector.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="64" height="64"/></svg>'),
      });
      await errorBanner.waitFor({ state: 'visible', timeout: 5000 });
      assert.ok((await errorBanner.innerText()).trim().length > 0, 'Expected inline SVG error message');
      assert.equal(await modal.isVisible(), true, 'Modal must stay open & recoverable after SVG error');

      // Negative robustness test 2: corrupt PNG bytes (valid magic bytes + garbage payload)
      await fileInput.setInputFiles({
        name: 'corrupt-image.png',
        mimeType: 'image/png',
        buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3, 4, 5, 6, 7, 255, 254]),
      });
      await page.waitForFunction(
        () => {
          const el = document.querySelector('[data-testid="guided-gemini-error"]');
          return Boolean(el && el.textContent && el.textContent.toLowerCase().includes('decode'));
        },
        { timeout: 5000 }
      );
      assert.equal(await modal.isVisible(), true, 'Modal must stay open after corrupt PNG error');

      // Recover cleanly with valid multi-color PNG via file input
      await fileInput.setInputFiles({
        name: 'gemini-detail-result.png',
        mimeType: 'image/png',
        buffer: MULTI_COLOR_PNG_BUFFER,
      });
      await modal.waitFor({ state: 'hidden', timeout: 25000 });
      const undoToast = page.getByTestId('undo-subdivision-toast');
      await undoToast.waitFor({ state: 'visible', timeout: 10000 });

      const puzzleAfterGuidedZoomIn = await readPuzzleSummary(page, snapId);
      assert.equal(puzzleAfterGuidedZoomIn.nestedLayers.length, 1);
      assert.ok(puzzleAfterGuidedZoomIn.totalRegionCount > puzzleBefore.totalRegionCount);
      assert.equal((await readSnapshots(page)).length, snapshotsBefore.length);

      // --- Puter 402 Error -> Automatic Guided Gemini Fallback + Synthetic Window Paste ---
      await page.getByTestId('topbar-settings-btn').click();
      await page.getByTestId('settings-tab-create').click();
      await page.getByTestId('iz-provider-select').selectOption('PUTER');
      await page.getByTestId('settings-modal-close').click();
      await waitForAnimationFrames(page, 2);

      await page.getByTestId('infinite-zoom-menu-btn').click();
      await page.getByTestId('toolbar-infinite-zoom-out-btn').click();
      await setExtendSideState(page, 'extend-side-top', true);
      await setExtendSideState(page, 'extend-side-bottom', false);
      await setExtendSideState(page, 'extend-side-left', false);
      await setExtendSideState(page, 'extend-side-right', false);
      await page.getByTestId('toolbar-infinite-zoom-out-confirm-btn').click();

      // Puter 402 must automatically open GuidedGeminiHandoffModal with fallback notice
      await modal.waitFor({ state: 'visible', timeout: 15000 });
      const fallbackNotice = page.getByTestId('guided-gemini-fallback-notice');
      await fallbackNotice.waitFor({ state: 'visible', timeout: 5000 });
      const fallbackText = await fallbackNotice.innerText();
      assert.ok(
        fallbackText.includes('Free Gemini App Handoff') || fallbackText.includes('$0'),
        `Expected Guided fallback notice text, got "${fallbackText}"`
      );
      const puterCalls = await page.evaluate(() => window.__puterCalls || []);
      assert.equal(puterCalls.length, 1, 'Expected Puter provider to be attempted before 402 fallback');
      assertValidPuterRatio(puterCalls[0].options?.ratio, 'Stage 4A Zoom Out Puter ratio');
      assert.equal(puterCalls[0].options?.quality, '1K', 'Expected 1K quality on Zoom Out Puter call');
      assert.ok(
        ALLOWED_TEMPLATE_MIMES.has(puterCalls[0].options?.input_image_mime_type),
        `Expected compact raster MIME on Zoom Out Puter call, got "${puterCalls[0].options?.input_image_mime_type}"`
      );

      // Complete via synthetic window ClipboardEvent('paste') with valid multi-color PNG File
      await page.evaluate((base64Png) => {
        const bin = atob(base64Png);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const file = new File([bytes], 'pasted-gemini-result.png', { type: 'image/png' });
        const dt = new DataTransfer();
        dt.items.add(file);
        const ev = new ClipboardEvent('paste', {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
        });
        window.dispatchEvent(ev);
      }, MULTI_COLOR_PNG_BASE64);

      await modal.waitFor({ state: 'hidden', timeout: 25000 });
      await undoToast.waitFor({ state: 'visible', timeout: 10000 });

      const puzzleAfterFallbackPaste = await readPuzzleSummary(page, snapId);
      assert.equal(
        puzzleAfterFallbackPaste.nestedLayers.length,
        2,
        'Puter 402 fallback + paste must complete unified Zoom Out cleanly'
      );
      assert.equal(puzzleAfterFallbackPaste.maxZoomDepth, 2);
      assert.equal((await readSnapshots(page)).length, snapshotsBefore.length);

      assert.equal(puterSpy.getRequests().length, 0);
      errors.assertZeroErrors();
    } finally {
      await context.close();
    }
  }

  // --- Part 4B: Android WebView Mock + shareImage + LIFO __capyReceiveSharedImage ---
  {
    const { context, page } = await createBootedContext(ctx.browser, ctx.BASE_URL, {
      label: 'infinite-zoom-s4-android-share',
      easyNoReplay: true,
      bootUrl: false,
      waitForPuzzle: false,
    });
    try {
      const errors = attachStrictErrorListeners(page, 'iz-s4-android', ctx);
      const puterSpy = await attachPuterNetworkSpy(page);
      await injectAndroidWebViewMock(page);

      await page.goto(`${ctx.BASE_URL}/?skipTutorial=1`, { waitUntil: 'domcontentloaded' });
      await waitForPuzzleLoaded(page);

      const sessionBefore = await readActiveSession(page);
      const snapId = sessionBefore.activeSnapshotId;
      const snapshotsBefore = await readSnapshots(page);
      const puzzleBefore = await readPuzzleSummary(page, snapId);
      const targets = await findUnifiedRegionTargets(page, snapId);
      assert.ok(targets?.largePair, 'Stage 4B: expected clickable root regions');

      // Trigger Zoom In under default Android GUIDED_GEMINI provider
      await page.getByTestId('infinite-zoom-menu-btn').click();
      await page.getByTestId('toolbar-infinite-zoom-in-btn').click();
      await page.getByTestId('region-selection-bar').waitFor({ state: 'visible', timeout: 3000 });
      await page.mouse.click(targets.largePair.a.clientX, targets.largePair.a.clientY);
      await page.waitForFunction(
        () => !document.querySelector('[data-testid="region-selection-confirm-btn"]')?.disabled,
        { timeout: 3000 }
      );
      await page.getByTestId('region-selection-confirm-btn').click();

      const modal = page.getByTestId('guided-gemini-modal');
      await modal.waitFor({ state: 'visible', timeout: 10000 });
      assert.equal(
        await page.getByTestId('guided-gemini-copy-image-btn').count(),
        0,
        'Android WebView must NOT render Web-only guided-gemini-copy-image-btn'
      );

      const launchBtn = page.getByTestId('guided-gemini-launch-btn');
      assert.ok(
        (await launchBtn.innerText()).includes('Share to Gemini App'),
        `Expected Android launch label, got "${await launchBtn.innerText()}"`
      );
      await launchBtn.click();
      await page.waitForFunction(
        () => (window.__androidBridgeCalls?.shareImage?.length || 0) >= 1,
        { timeout: 5000 }
      );

      const shareCalls = await page.evaluate(() => window.__androidBridgeCalls?.shareImage || []);
      assert.equal(shareCalls.length, 1, 'Android launch must invoke window.CapyAndroid.shareImage');
      assert.match(
        shareCalls[0].dataUrl,
        /^data:image\/(?:jpeg|webp|png);base64,/i,
        `Android shareImage must pass prepared compact template image data URL, got "${shareCalls[0].dataUrl.slice(0, 48)}"`
      );
      const sharedBase64 = shareCalls[0].dataUrl.slice(shareCalls[0].dataUrl.indexOf(',') + 1);
      const sharedBytes = Buffer.from(sharedBase64, 'base64').byteLength;
      assert.ok(
        sharedBytes > 0 && sharedBytes <= MAX_AI_TEMPLATE_BYTES,
        `Android shareImage template must be <= ${MAX_AI_TEMPLATE_BYTES} bytes, got ${sharedBytes}`
      );

      // Simulate Android OS Share-Back via window.__capyReceiveSharedImage -> LIFO interceptor
      await page.evaluate((dataUrl) => {
        if (typeof window.__capyReceiveSharedImage !== 'function') {
          throw new Error('window.__capyReceiveSharedImage is not registered');
        }
        window.__capyReceiveSharedImage('Gemini Result', dataUrl);
      }, MULTI_COLOR_PNG_DATA_URL);

      await modal.waitFor({ state: 'hidden', timeout: 25000 });
      await page.getByTestId('undo-subdivision-toast').waitFor({ state: 'visible', timeout: 10000 });

      const puzzleAfterShare = await readPuzzleSummary(page, snapId);
      const snapshotsAfterShare = await readSnapshots(page);
      const sessionAfterShare = await readActiveSession(page);

      assert.equal(
        puzzleAfterShare.nestedLayers.length,
        1,
        'Android LIFO share-back must embed the detail layer into active puzzle'
      );
      assert.ok(
        puzzleAfterShare.totalRegionCount > puzzleBefore.totalRegionCount,
        'Android LIFO share-back must grow unified totalRegionCount'
      );
      assert.equal(
        snapshotsAfterShare.length,
        snapshotsBefore.length,
        'Android LIFO share-back must NOT create a stray new snapshot in useSnapshotLibrary'
      );
      assert.equal(sessionAfterShare.activeSnapshotId, snapId);
      assert.equal(await page.locator('script[src*="js.puter.com"]').count(), 0);
      assert.equal(puterSpy.getRequests().length, 0);

      errors.assertZeroErrors();
    } finally {
      await context.close();
    }
  }

  ctx.logE2ePass(label);
}

// ============================================================================
// Suite Entrypoint (Exact 4-stage runner.mjs Contract)
// ============================================================================

export async function runInfiniteZoomE2e(ctx) {
  await runStage1(ctx);
  await runStage2(ctx);
  await runStage3(ctx);
  await runStage4(ctx);
}
