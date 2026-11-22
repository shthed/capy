import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

function createMockLocalStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    key(index) {
      return Array.from(map.keys())[index] ?? null;
    },
    getItem(k) {
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      map.set(String(k), String(v));
    },
    removeItem(k) {
      map.delete(String(k));
    },
    clear() {
      map.clear();
    },
    _dump() {
      return Object.fromEntries(map.entries());
    },
  };
}

function createMockCacheStorage(initialBuckets = {}) {
  const buckets = new Map();
  for (const [name, entries] of Object.entries(initialBuckets)) {
    const entryMap = new Map();
    for (const [url, res] of Object.entries(entries)) {
      entryMap.set(url, res);
    }
    buckets.set(name, entryMap);
  }
  return {
    async keys() {
      return Array.from(buckets.keys());
    },
    async open(name) {
      if (!buckets.has(name)) {
        buckets.set(name, new Map());
      }
      const entryMap = buckets.get(name);
      return {
        async keys() {
          return Array.from(entryMap.keys()).map((url) => ({ url }));
        },
        async match(req) {
          const url = typeof req === 'string' ? req : req?.url;
          return entryMap.get(url);
        },
        async put(req, res) {
          const url = typeof req === 'string' ? req : req?.url;
          entryMap.set(url, res);
        },
      };
    },
    async delete(name) {
      return buckets.delete(name);
    },
    _names() {
      return Array.from(buckets.keys());
    },
  };
}

function createMockIndexedDb({
  initialDbs = {},
  exposeDatabasesApi = true,
  blockedDbNames = new Set(),
} = {}) {
  const dbs = new Map();
  const createdNames = [];

  for (const [dbName, stores] of Object.entries(initialDbs)) {
    const storeMap = new Map();
    for (const [storeName, records] of Object.entries(stores)) {
      storeMap.set(storeName, new Map(Object.entries(records)));
    }
    dbs.set(dbName, { version: 1, stores: storeMap });
  }

  function makeDbHandle(dbName) {
    const record = dbs.get(dbName);
    const storeNames = Array.from(record.stores.keys());
    return {
      name: dbName,
      version: record.version,
      closed: false,
      onversionchange: null,
      onclose: null,
      objectStoreNames: {
        contains(name) {
          return record.stores.has(name);
        },
        get length() {
          return storeNames.length;
        },
      },
      createObjectStore(name) {
        if (!record.stores.has(name)) {
          record.stores.set(name, new Map());
        }
      },
      close() {
        this.closed = true;
      },
      transaction(requestedStores, _mode = 'readonly') {
        const names = Array.isArray(requestedStores) ? requestedStores : [requestedStores];
        const tx = {
          error: null,
          oncomplete: null,
          onerror: null,
          onabort: null,
          abort() {
            queueMicrotask(() => tx.onabort?.({ target: tx }));
          },
          objectStore(storeName) {
            if (!names.includes(storeName) || !record.stores.has(storeName)) {
              throw new Error(`Missing object store: ${storeName}`);
            }
            const map = record.stores.get(storeName);
            return {
              get(key) {
                const req = { result: undefined, error: null, onsuccess: null, onerror: null };
                queueMicrotask(() => {
                  req.result = map.get(key);
                  req.onsuccess?.({ target: req });
                });
                return req;
              },
              put(val, key) {
                map.set(key, val);
                return { result: key, onsuccess: null, onerror: null };
              },
              delete(key) {
                map.delete(key);
                return { result: undefined, onsuccess: null, onerror: null };
              },
              clear() {
                map.clear();
                return { result: undefined, onsuccess: null, onerror: null };
              },
              openCursor() {
                const req = { result: null, error: null, onsuccess: null, onerror: null };
                const items = Array.from(map.entries());
                let idx = 0;
                const emitNext = () => {
                  if (idx >= items.length) {
                    req.result = null;
                    req.onsuccess?.({ target: req });
                    return;
                  }
                  const [k, v] = items[idx++];
                  req.result = {
                    key: k,
                    value: v,
                    continue() {
                      queueMicrotask(emitNext);
                    },
                  };
                  req.onsuccess?.({ target: req });
                };
                queueMicrotask(emitNext);
                return req;
              },
            };
          },
        };
        queueMicrotask(() => {
          tx.oncomplete?.({ target: tx });
        });
        return tx;
      },
    };
  }

  const factory = {
    open(dbName, version) {
      const req = {
        result: null,
        error: null,
        transaction: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
      };
      queueMicrotask(() => {
        const existed = dbs.has(dbName);
        if (!existed) {
          let aborted = false;
          const tempStore = { version: version || 1, stores: new Map() };
          dbs.set(dbName, tempStore);
          req.result = makeDbHandle(dbName);
          req.transaction = {
            abort() {
              aborted = true;
              dbs.delete(dbName);
            },
          };
          req.onupgradeneeded?.({ oldVersion: 0, newVersion: tempStore.version, target: req });
          if (aborted) {
            req.error = new Error('AbortError');
            req.onerror?.({ target: req });
            return;
          }
          createdNames.push(dbName);
          req.onsuccess?.({ target: req });
          return;
        }
        req.result = makeDbHandle(dbName);
        req.onsuccess?.({ target: req });
      });
      return req;
    },
    deleteDatabase(dbName) {
      const req = {
        result: undefined,
        error: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
      };
      queueMicrotask(() => {
        if (blockedDbNames.has(dbName)) {
          req.onblocked?.({ target: req });
          return;
        }
        dbs.delete(dbName);
        req.onsuccess?.({ target: req });
      });
      return req;
    },
    _hasDb(dbName) {
      return dbs.has(dbName);
    },
    _getStoreKeys(dbName, storeName) {
      const rec = dbs.get(dbName);
      if (!rec || !rec.stores.has(storeName)) return [];
      return Array.from(rec.stores.get(storeName).keys());
    },
    _createdNames: createdNames,
  };

  if (exposeDatabasesApi) {
    factory.databases = async () =>
      Array.from(dbs.entries()).map(([name, rec]) => ({ name, version: rec.version }));
  }

  return factory;
}

async function runSwEvictionAndPrecacheTests() {
  const swPath = path.resolve(projectRoot, 'public/sw.js');
  const rawSw = fs.readFileSync(swPath, 'utf8');

  // Verify core invariants remain intact
  assert.equal(rawSw.includes('SW_BUILD_VERSION'), true);
  assert.equal(rawSw.includes('SW_ASSETS_DIGEST'), true);
  assert.equal(rawSw.includes('isCacheableAssetResponse'), true);
  assert.equal(rawSw.includes('isWithinSwScope'), true);
  assert.equal(rawSw.includes(".endsWith('.capy')"), true);
  assert.equal(rawSw.includes("cache: 'no-cache'"), true);
  assert.equal(rawSw.includes(".endsWith('.apk')"), true);
  assert.equal(rawSw.includes('ignoreSearch'), false, 'sw.js must never use ignoreSearch');

  // Verify lean PRECACHE_RELATIVE_URLS omits optional heavy assets and keeps essentials
  const precacheMatch = rawSw.match(/const\s+PRECACHE_RELATIVE_URLS\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(precacheMatch, 'PRECACHE_RELATIVE_URLS must be defined in sw.js');
  const precacheBody = precacheMatch[1];
  assert.equal(
    precacheBody.includes('daily_saves.capy'),
    false,
    'daily_saves.capy must be moved to on-demand runtime caching'
  );
  assert.equal(
    precacheBody.includes('icon-512.png'),
    false,
    'icon-512.png must be moved to on-demand runtime caching'
  );
  assert.equal(
    precacheBody.includes('icon-maskable-512.png'),
    false,
    'icon-maskable-512.png must be moved to on-demand runtime caching'
  );
  for (const requiredAsset of [
    "'./'",
    "'./index.html'",
    "'./assets/sample_saves.capy'",
    "'./assets/icon-192.png'",
    "'./assets/apple-touch-icon.png'",
  ]) {
    assert.equal(
      precacheBody.includes(requiredAsset),
      true,
      `PRECACHE_RELATIVE_URLS must keep essential asset ${requiredAsset}`
    );
  }

  // Evaluate activate cache eviction across Production, Beta, and Alpha scopes in node:vm
  const runActivateForScope = async (scopeUrl, initialCacheNames) => {
    const stamped = rawSw.replace('__CAPY_SW_VERSION__', '3.0.12');
    const listeners = new Map();
    const deleted = [];
    const remaining = new Set(initialCacheNames);
    const sandbox = {
      URL,
      console,
      Promise,
      Set,
      Array,
      self: {
        location: { href: `${scopeUrl}sw.js` },
        registration: { scope: scopeUrl },
        clients: { claim: async () => {} },
        skipWaiting: async () => {},
        addEventListener(type, fn) {
          listeners.set(type, fn);
        },
      },
      caches: {
        async keys() {
          return Array.from(remaining);
        },
        async delete(key) {
          deleted.push(key);
          return remaining.delete(key);
        },
      },
    };
    vm.runInNewContext(stamped, sandbox, { filename: 'sw.js' });
    const activateHandler = listeners.get('activate');
    assert.equal(typeof activateHandler, 'function', 'sw.js must register activate handler');
    let pendingPromise = null;
    activateHandler({
      waitUntil(p) {
        pendingPromise = p;
      },
    });
    await pendingPromise;
    return { deleted: deleted.sort(), remaining: Array.from(remaining).sort() };
  };

  const seedCaches = [
    'capy-cache-v3.0.12:/capy/',
    'capy-cache-v3.0.11:/capy/',
    'capy-cache-v3.0.12:/capy/beta/',
    'capy-cache-v3.0.11:/capy/beta/',
    'capy-cache-v3.0.12:/capy/alpha/630/',
    'capy-cache-v3.0.11:/capy/alpha/601/',
    'capy-cache-v3.0.10:/capy/PR/99/',
    'capy-cache-v3.0.10:/capy/pull/42/',
    'capy-cache-v2',
    'capygame-cache-v1',
  ];

  // Production scope: evicts old Prod, all alpha/PR/pull, legacy v2; keeps current Prod, sibling Beta, CapyGame
  const prodRes = await runActivateForScope('https://example.github.io/capy/', seedCaches);
  assert.deepEqual(prodRes.remaining, [
    'capy-cache-v3.0.11:/capy/beta/',
    'capy-cache-v3.0.12:/capy/',
    'capy-cache-v3.0.12:/capy/beta/',
    'capygame-cache-v1',
  ]);

  // Beta scope: evicts old Beta, all alpha/PR/pull, legacy v2; keeps current Beta, sibling Prod, CapyGame
  const betaRes = await runActivateForScope('https://example.github.io/capy/beta/', seedCaches);
  assert.deepEqual(betaRes.remaining, [
    'capy-cache-v3.0.11:/capy/',
    'capy-cache-v3.0.12:/capy/',
    'capy-cache-v3.0.12:/capy/beta/',
    'capygame-cache-v1',
  ]);

  // Alpha #630 scope: keeps current Alpha #630 + sibling Prod + sibling Beta + CapyGame; evicts all other alpha/PR/pull + v2
  const alphaRes = await runActivateForScope(
    'https://example.github.io/capy/alpha/630/',
    seedCaches
  );
  assert.deepEqual(alphaRes.remaining, [
    'capy-cache-v3.0.11:/capy/',
    'capy-cache-v3.0.11:/capy/beta/',
    'capy-cache-v3.0.12:/capy/',
    'capy-cache-v3.0.12:/capy/alpha/630/',
    'capy-cache-v3.0.12:/capy/beta/',
    'capygame-cache-v1',
  ]);
}

async function runImageCompressionTests(vite) {
  const imgMod = await vite.ssrLoadModule('/src/services/storage/ImageCompression.ts');

  // Dimensions calculation
  assert.deepEqual(imgMod.computeTargetImageDimensions(1024, 768), {
    width: 1024,
    height: 768,
    resized: false,
  });
  assert.deepEqual(imgMod.computeTargetImageDimensions(4096, 2048), {
    width: 2048,
    height: 1024,
    resized: true,
  });
  assert.deepEqual(imgMod.computeTargetImageDimensions(1500, 3000), {
    width: 1024,
    height: 2048,
    resized: true,
  });

  // Skip heuristic
  assert.equal(imgMod.shouldCompressImageBlob(100 * 1024, 1200, 900), false);
  assert.equal(imgMod.shouldCompressImageBlob(350 * 1024, 2048, 2048), false);
  assert.equal(imgMod.shouldCompressImageBlob(350 * 1024 + 1, 1024, 1024), true);
  assert.equal(imgMod.shouldCompressImageBlob(100 * 1024, 2049, 1024), true);

  // Skip without calling encoder when small & <= 2048px
  let encodeCalls = 0;
  const smallOriginal = new Blob([new Uint8Array(4096)], { type: 'image/png' });
  const skipped = await imgMod.compressImageForStorage(
    { blob: smallOriginal, image: {}, width: 800, height: 600 },
    {
      encode: async () => {
        encodeCalls += 1;
        return null;
      },
    }
  );
  assert.equal(skipped, smallOriginal);
  assert.equal(encodeCalls, 0);

  // Compress oversized upload via WebP when smaller
  const largeOriginal = new Blob([new Uint8Array(600 * 1024)], { type: 'image/jpeg' });
  const smallerWebp = new Blob([new Uint8Array(120 * 1024)], { type: 'image/webp' });
  const webpEncArgs = [];
  const compressedWebp = await imgMod.compressImageForStorage(
    { blob: largeOriginal, image: {}, width: 4000, height: 3000 },
    {
      encode: async (params) => {
        webpEncArgs.push(params);
        return smallerWebp;
      },
    }
  );
  assert.equal(compressedWebp, smallerWebp);
  assert.equal(webpEncArgs.length, 1);
  assert.equal(webpEncArgs[0].mimeType, 'image/webp');
  assert.equal(webpEncArgs[0].width, 2048);
  assert.equal(webpEncArgs[0].height, 1536);
  assert.equal(webpEncArgs[0].fillWhite, false);

  // Safari silent image/png fallback -> JPEG fallback with fillWhite=true
  const safariCalls = [];
  const jpegFallback = new Blob([new Uint8Array(180 * 1024)], { type: 'image/jpeg' });
  const safariResult = await imgMod.compressImageForStorage(
    { blob: largeOriginal, image: {}, width: 2048, height: 2048 },
    {
      encode: async (params) => {
        safariCalls.push(params);
        if (params.mimeType === 'image/webp') {
          return new Blob([new Uint8Array(900 * 1024)], { type: 'image/png' });
        }
        return jpegFallback;
      },
    }
  );
  assert.equal(safariResult, jpegFallback);
  assert.equal(safariCalls.length, 2);
  assert.equal(safariCalls[1].mimeType, 'image/jpeg');
  assert.equal(safariCalls[1].fillWhite, true);

  // Keep original when compressed output is not smaller
  const biggerWebp = new Blob([new Uint8Array(700 * 1024)], { type: 'image/webp' });
  const keptOriginal = await imgMod.compressImageForStorage(
    { blob: largeOriginal, image: {}, width: 2048, height: 2048 },
    { encode: async () => biggerWebp }
  );
  assert.equal(keptOriginal, largeOriginal);

  // Null original blob (canvas-only path)
  const canvasOnlyResult = await imgMod.compressImageForStorage(
    { blob: null, image: {}, width: 1024, height: 768 },
    { encode: async () => smallerWebp }
  );
  assert.equal(canvasOnlyResult, smallerWebp);
}

async function runStorageAnalyzerCoreTests(vite) {
  const analyzerMod = await vite.ssrLoadModule('/src/services/storage/StorageAnalyzer.ts');
  const idbMod = await vite.ssrLoadModule('/src/services/storage/IndexedDbStore.ts');
  const resetCachedHandles = async () => {
    await idbMod.closeDbHandle('capy_game_storage_v8');
    await idbMod.closeDbHandle('capy_game_storage_v8_beta');
    await idbMod.closeDbHandle('capy_game_storage_v8_alpha');
  };

  // 1. Pure classifier & key protection tests
  assert.equal(
    analyzerMod.classifyCacheName('capy-cache-v3.0.12:/capy/', 'capy-cache-v3.0.12:/capy/', '/capy/')
      .category,
    'current'
  );
  assert.equal(
    analyzerMod.classifyCacheName(
      'capy-cache-v3.0.11:/capy/alpha/601/',
      'capy-cache-v3.0.12:/capy/',
      '/capy/'
    ).category,
    'staleAlpha'
  );
  assert.equal(
    analyzerMod.classifyCacheName('capy-cache-v2', 'capy-cache-v3.0.12:/capy/', '/capy/').category,
    'staleVersion'
  );
  assert.equal(
    analyzerMod.classifyCacheName(
      'capy-cache-v3.0.12:/capy/beta/',
      'capy-cache-v3.0.12:/capy/',
      '/capy/'
    ).category,
    'siblingBeta'
  );
  assert.equal(
    analyzerMod.classifyCacheName('capygame-cache-v1', 'capy-cache-v3.0.12:/capy/', '/capy/')
      .category,
    'otherOrigin'
  );

  // CapyGame & non-Capy Local Storage key protection
  assert.equal(analyzerMod.isCapyPaintLocalKey('capy_snapshots_v8'), true);
  assert.equal(analyzerMod.isCapyPaintLocalKey('capy_snapshots_v8__sandbox_alpha'), true);
  assert.equal(analyzerMod.isCapyPaintLocalKey('capy_snapshots_v8__corrupt_quarantine'), true);
  assert.equal(analyzerMod.isCapyPaintLocalKey('capy_dev_debug'), true);
  assert.equal(analyzerMod.isCapyPaintLocalKey('capy_user_settings_v7'), true);
  assert.equal(
    analyzerMod.isCapyPaintLocalKey('capy_apple_cloud_session_v1'),
    true,
    'Apple OAuth session key must be classified as Capy Paint storage'
  );
  assert.equal(
    analyzerMod.isCapyPaintLocalKey('capy_apple_cloud_session_v1__sandbox_alpha'),
    true
  );
  assert.equal(
    analyzerMod.isCapyPaintLocalKey('capy_microsoft_oauth_token_v1'),
    true,
    'Microsoft OAuth token key must be classified as Capy Paint storage'
  );
  assert.equal(
    analyzerMod.isCapyPaintLocalKey('capy_game_save_v3'),
    false,
    'CapyGame save key must NEVER be classified as Capy Paint storage'
  );
  assert.equal(
    analyzerMod.isCapyPaintLocalKey('capy_game_settings_v1'),
    false,
    'CapyGame settings key must NEVER be classified as Capy Paint storage'
  );
  assert.equal(
    analyzerMod.isCapyPaintLocalKey('capy_game_onboarding_v1'),
    false,
    'CapyGame onboarding key must NEVER be classified as Capy Paint storage'
  );
  assert.equal(analyzerMod.isCapyPaintLocalKey('unrelated_site_key'), false);

  // 2. Recursive structured clone sizing (Blob, deduped ArrayBuffer, shared views, cycle & depth guard)
  const sharedBuf = new ArrayBuffer(10_000);
  const view1 = new Uint8Array(sharedBuf);
  const view2 = new DataView(sharedBuf);
  const blob = new Blob([new Uint8Array(512)], { type: 'image/webp' });
  const cyclic = { label: 'abc', buf1: sharedBuf, buf2: sharedBuf, view1, view2, b1: blob, b2: blob };
  cyclic.self = cyclic;
  const est = analyzerMod.estimateStructuredCloneBytes(cyclic);
  // Shared backing ArrayBuffer (10,000) and shared Blob (512) must each be counted ONCE
  assert.equal(est >= 10_000 + 512, true, `Expected >= 10512 bytes, got ${est}`);
  assert.equal(
    est < 10_000 + 512 + 256,
    true,
    `Shared ArrayBuffer views and duplicate Blob refs must not double-count (got ${est})`
  );
  const sharedViewsOnly = analyzerMod.estimateStructuredCloneBytes({
    v1: new Uint8Array(sharedBuf),
    v2: new DataView(sharedBuf),
  });
  assert.equal(
    sharedViewsOnly >= 10_000 && sharedViewsOnly < 10_100,
    true,
    `Two views over one 10000-byte ArrayBuffer must count backing buffer once (got ${sharedViewsOnly})`
  );
  const bufAndView = analyzerMod.estimateStructuredCloneBytes({
    buf: sharedBuf,
    view: new Uint8Array(sharedBuf),
  });
  assert.equal(
    bufAndView >= 10_000 && bufAndView < 10_100,
    true,
    `{ buf, view } sharing one ArrayBuffer must count backing buffer once (got ${bufAndView})`
  );
  const dupBlobs = analyzerMod.estimateStructuredCloneBytes({ b1: blob, b2: blob });
  assert.equal(
    dupBlobs >= 512 && dupBlobs < 600,
    true,
    `Duplicate Blob references must count Blob once (got ${dupBlobs})`
  );
  let deep = { leaf: 'x' };
  for (let i = 0; i < 30; i++) deep = { nested: deep };
  assert.equal(Number.isFinite(analyzerMod.estimateStructuredCloneBytes(deep)), true);

  // 3. Zero-false-positive orphan computation + fail-closed corrupt JSON + preview_ sourceRef.uri guard
  const orphanNormal = analyzerMod.computeOrphanedKeys({
    puzzleKeys: ['snap-1', 'snap-active', 'orphan-p1'],
    imageKeys: [
      'snap-1',
      'custom-uri-1',
      'preview_custom-77',
      'preview_snap-1',
      'preview_snap-active',
      'orphan-img',
      'preview_orphan-p1',
    ],
    rawSnapshotsJson: JSON.stringify([
      { id: 'snap-1', title: 'Live', sourceRef: { kind: 'blob', uri: 'custom-uri-1' } },
      { id: 'snap-2', title: 'PreviewPrefixedUri', sourceRef: { kind: 'blob', uri: 'preview_custom-77' } },
    ]),
    rawActiveStateJson: JSON.stringify({ activeSnapshotId: 'snap-active' }),
  });
  assert.equal(orphanNormal.skipped, false);
  assert.deepEqual(orphanNormal.orphanedPuzzleKeys, ['orphan-p1']);
  assert.deepEqual(
    orphanNormal.orphanedImageKeys.sort(),
    ['orphan-img', 'preview_orphan-p1'],
    'preview_-prefixed sourceRef.uri must never be flagged as orphaned'
  );

  const orphanCorrupt = analyzerMod.computeOrphanedKeys({
    puzzleKeys: ['snap-1', 'orphan-p1'],
    imageKeys: ['snap-1', 'preview_snap-1'],
    rawSnapshotsJson: '{corrupt-json',
    rawActiveStateJson: null,
  });
  assert.equal(orphanCorrupt.skipped, true, 'Corrupt SNAPSHOTS_KEY must fail closed');
  assert.deepEqual(orphanCorrupt.orphanedPuzzleKeys, []);
  assert.deepEqual(orphanCorrupt.orphanedImageKeys, []);

  // 4. Full analyzeBrowserStorage() + all 4 cleanup actions + non-creating IDB probe + regression probes
  const prevLs = globalThis.localStorage;
  const prevCaches = globalThis.caches;
  const prevIdb = globalThis.indexedDB;
  const prevWin = globalThis.window;
  const prevNavDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  const setMockNavigator = (navObj) => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      writable: true,
      value: navObj,
    });
  };

  try {
    const snapshotsPayload = JSON.stringify([
      { id: 'live-1', title: 'Live Puzzle', sourceRef: { kind: 'blob', uri: 'live-blob-1' } },
    ]);
    const mockLs = createMockLocalStorage({
      capy_snapshots_v8: snapshotsPayload,
      capy_snapshots_v8__corrupt_quarantine: '{broken',
      capy_active_session_v8: JSON.stringify({ activeSnapshotId: 'live-1' }),
      capy_user_settings_v8: JSON.stringify({ isFreeColorMode: true }),
      capy_snapshots_v8__sandbox_alpha: JSON.stringify([{ id: 'alpha-1', title: 'Alpha Save' }]),
      capy_snapshots_v8__sandbox_beta: JSON.stringify([{ id: 'beta-1', title: 'Beta Save' }]),
      capy_game_save_v3: JSON.stringify({ capybaraScore: 9000 }),
      capy_game_settings_v1: JSON.stringify({ quality: 'high' }),
    });
    const mockCaches = createMockCacheStorage({
      'capy-cache-v3.0.12:/capy/': {
        'https://example.github.io/capy/index.html': new Response('<html>app</html>', {
          headers: { 'content-length': '2048' },
        }),
      },
      'capy-cache-v3.0.11:/capy/alpha/601/': {
        'https://example.github.io/capy/alpha/601/bundle.js': new Response('a'.repeat(8192), {
          headers: { 'content-encoding': 'gzip' },
        }),
      },
      'capy-cache-v3.0.12:/capy/beta/': {
        'https://example.github.io/capy/beta/index.html': new Response('beta', {
          headers: { 'content-length': '4096' },
        }),
      },
      'capygame-cache-v1': {
        'https://example.github.io/capygame/index.html': new Response('game', {
          headers: { 'content-length': '3000' },
        }),
      },
    });
    const mockIdb = createMockIndexedDb({
      initialDbs: {
        capy_game_storage_v8: {
          puzzles: {
            'live-1': { __capyCompactV2: 2, rleRegionMap: new Uint8Array(1000) },
            'orphan-1': { __capyCompactV2: 2, rleRegionMap: new Uint8Array(2500) },
          },
          images: {
            'live-blob-1': new Blob([new Uint8Array(4000)], { type: 'image/webp' }),
            'preview_live-1': 'data:image/webp;base64,AAAA',
            'orphan-img-1': new Blob([new Uint8Array(3000)], { type: 'image/png' }),
            'preview_orphan-1': 'data:image/webp;base64,BBBB',
          },
        },
        capy_game_storage_v8_alpha: {
          puzzles: { 'alpha-1': { data: new Uint8Array(1500) } },
          images: {},
        },
        capy_game_storage_v8_beta: {
          puzzles: { 'beta-1': { data: new Uint8Array(1200) } },
          images: {},
        },
        capygame_world_db: {
          worlds: { w1: { data: new Uint8Array(999) } },
        },
      },
      exposeDatabasesApi: true,
    });
    const unregisteredScopes = [];
    setMockNavigator({
      storage: {
        estimate: async () => ({
          usage: 50000,
          quota: 1000000,
          usageDetails: { caches: 18000, indexedDB: 15000 },
        }),
        persisted: async () => true,
      },
      serviceWorker: {
        getRegistrations: async () => [
          {
            scope: 'https://example.github.io/capy/',
            unregister: async () => {
              unregisteredScopes.push('/capy/');
              return true;
            },
          },
          {
            scope: 'https://example.github.io/capy/alpha/601/',
            unregister: async () => {
              unregisteredScopes.push('/capy/alpha/601/');
              return true;
            },
          },
        ],
      },
    });
    await resetCachedHandles();
    globalThis.localStorage = mockLs;
    globalThis.caches = mockCaches;
    globalThis.indexedDB = mockIdb;
    globalThis.window = {
      location: { pathname: '/capy/', origin: 'https://example.github.io', search: '' },
    };

    const opts = {
      pathname: '/capy/',
      origin: 'https://example.github.io',
      search: '',
      scopeUrl: 'https://example.github.io/capy/',
      version: '3.0.12',
    };

    const report = await analyzerMod.analyzeBrowserStorage(opts);
    assert.equal(report.browserEstimate.supported, true);
    assert.equal(report.browserEstimate.usageBytes, 50000);
    assert.equal(report.browserEstimate.usageDetails.caches, 18000);
    assert.equal(report.cacheStorage.staleAlphaCount, 1);
    assert.equal(report.cacheStorage.staleAlphaBytes, 8192);
    assert.equal(report.cacheStorage.currentAppBytes, 2048);
    assert.equal(report.cacheStorage.siblingBetaProdBytes, 4096);
    assert.equal(report.cacheStorage.otherOriginCount, 1);
    assert.equal(report.cacheStorage.otherOriginBytes, 3000);
    assert.equal(report.indexedDb.activeDb.puzzlesCount, 2);
    assert.equal(report.indexedDb.activeDb.imagesCount, 2);
    assert.equal(report.indexedDb.activeDb.previewsCount, 2);
    assert.equal(report.indexedDb.activeDb.orphanedCount, 3);
    assert.equal(report.indexedDb.siblingPreviewDbs.length, 2);
    assert.deepEqual(report.indexedDb.otherOriginDbNames, ['capygame_world_db']);
    assert.equal(report.localStore.otherOriginCount, 2, 'CapyGame keys must be counted as otherOrigin');
    assert.equal(report.localStore.previewChannelsCount, 2);
    assert.equal(report.localStore.quarantineCount, 1);
    assert.equal(report.localStore.cleanableQuarantineCount, 1);
    assert.equal(
      report.localStore.currentChannelBytes +
        report.localStore.previewChannelsBytes +
        report.localStore.prodChannelBytes +
        report.localStore.quarantineBytes +
        report.localStore.otherCapyBytes +
        report.localStore.otherOriginBytes,
      report.localStore.totalBytes,
      'Local Storage sub-rows must sum exactly to totalBytes with zero quarantine double-counting'
    );

    // Cleanup 1: Clear Stale & Offline Caches (zero save loss, protects CapyGame cache)
    const cacheClean = await analyzerMod.clearStaleAndOfflineCaches(opts);
    assert.equal(cacheClean.deletedCaches, 3);
    assert.deepEqual(mockCaches._names(), ['capygame-cache-v1']);
    assert.deepEqual(unregisteredScopes, ['/capy/alpha/601/']);
    assert.equal(mockIdb._getStoreKeys('capy_game_storage_v8', 'puzzles').includes('live-1'), true);

    // Cleanup 2: Clean Orphaned Save Data (zero save loss, removes healthy quarantine key)
    const orphanClean = await analyzerMod.cleanOrphanedSaveData(opts);
    assert.equal(orphanClean.deletedIdbRecords, 3);
    assert.equal(orphanClean.deletedLocalKeys, 1);
    assert.deepEqual(mockIdb._getStoreKeys('capy_game_storage_v8', 'puzzles'), ['live-1']);
    assert.deepEqual(
      mockIdb._getStoreKeys('capy_game_storage_v8', 'images').sort(),
      ['live-blob-1', 'preview_live-1']
    );
    assert.equal(mockLs.getItem('capy_snapshots_v8__corrupt_quarantine'), null);
    assert.equal(mockLs.getItem('capy_game_save_v3') !== null, true);

    // Cleanup 3: Clear Preview Channel Data (zero Production save loss)
    const previewClean = await analyzerMod.clearPreviewChannelData(opts);
    assert.equal(previewClean.affectedActiveChannel, false);
    assert.equal(previewClean.deletedIdbDatabases, 2);
    assert.equal(previewClean.deletedLocalKeys, 2);
    assert.equal(mockIdb._hasDb('capy_game_storage_v8_alpha'), false);
    assert.equal(mockIdb._hasDb('capy_game_storage_v8_beta'), false);
    assert.equal(mockIdb._hasDb('capy_game_storage_v8'), true, 'Production DB must stay intact');
    assert.equal(mockLs.getItem('capy_snapshots_v8') !== null, true, 'Production saves must stay intact');
    assert.equal(mockLs.getItem('capy_game_save_v3') !== null, true, 'CapyGame save must stay intact');

    // Non-creating IDB probe when indexedDB.databases() is absent (zero ghost DBs created!)
    await resetCachedHandles();
    const noListIdb = createMockIndexedDb({
      initialDbs: {
        capy_game_storage_v8: {
          puzzles: { 'live-1': { data: new Uint8Array(256) } },
          images: {},
        },
      },
      exposeDatabasesApi: false,
    });
    globalThis.indexedDB = noListIdb;
    const probeReport = await analyzerMod.analyzeBrowserStorage(opts);
    assert.equal(probeReport.indexedDb.activeDb.puzzlesCount, 1);
    assert.equal(probeReport.indexedDb.siblingPreviewDbs.length, 0);
    assert.equal(
      noListIdb._hasDb('capy_game_storage_v8_alpha'),
      false,
      'Probe must NEVER create ghost _alpha DB'
    );
    assert.equal(
      noListIdb._hasDb('capy_game_storage_v8_beta'),
      false,
      'Probe must NEVER create ghost _beta DB'
    );
    assert.deepEqual(noListIdb._createdNames, []);

    // Cleanup 4: Clear All Capy Storage (blocked active DB fallback, accurate deletedLocalKeys/freedBytesEstimate & CapyGame protection)
    await resetCachedHandles();
    const blockedIdb = createMockIndexedDb({
      initialDbs: {
        capy_game_storage_v8: {
          puzzles: { 'live-1': { data: new Uint8Array(512) } },
          images: { 'live-blob-1': new Blob([new Uint8Array(256)]) },
        },
        capy_game_storage_v8_alpha: {
          puzzles: { 'a-1': { data: new Uint8Array(128) } },
          images: {},
        },
        capygame_world_db: {
          worlds: { w1: { data: new Uint8Array(999) } },
        },
      },
      exposeDatabasesApi: true,
      blockedDbNames: new Set(['capy_game_storage_v8']),
    });
    globalThis.indexedDB = blockedIdb;
    const clearAllRes = await analyzerMod.clearAllCapyStorage({ ...opts, blockedTimeoutMs: 60 });
    assert.equal(clearAllRes.affectedActiveChannel, true);
    assert.deepEqual(clearAllRes.blockedDatabases, ['capy_game_storage_v8']);
    assert.equal(blockedIdb._hasDb('capy_game_storage_v8_alpha'), false);
    assert.equal(
      blockedIdb._getStoreKeys('capy_game_storage_v8', 'puzzles').length,
      0,
      'Blocked active DB must still have stores wiped via clearAllStores() fallback'
    );
    assert.equal(blockedIdb._hasDb('capygame_world_db'), true, 'CapyGame DB must stay untouched');
    assert.equal(mockLs.getItem('capy_snapshots_v8'), null);
    assert.equal(mockLs.getItem('capy_active_session_v8'), null);
    assert.equal(mockLs.getItem('capy_user_settings_v8'), null);
    assert.equal(
      clearAllRes.deletedLocalKeys,
      3,
      `clearAllCapyStorage must count snapshots, active_session, and user_settings (got ${clearAllRes.deletedLocalKeys})`
    );
    assert.equal(
      clearAllRes.freedBytesEstimate > 512 + 256 + 128 + snapshotsPayload.length * 2,
      true,
      `clearAllCapyStorage must include pre-measured IDB + Local Storage bytes (got ${clearAllRes.freedBytesEstimate})`
    );
    assert.equal(mockLs.getItem('capy_game_save_v3') !== null, true, 'CapyGame save must stay untouched');
    assert.equal(
      mockLs.getItem('capy_game_settings_v1') !== null,
      true,
      'CapyGame settings must stay untouched'
    );
    assert.deepEqual(mockCaches._names(), ['capygame-cache-v1']);

    // 5. Regression: Fail-closed Orphan GC when localStorage throws SecurityError or is undefined
    await resetCachedHandles();
    const failClosedIdb = createMockIndexedDb({
      initialDbs: {
        capy_game_storage_v8: {
          puzzles: { 'live-protected': { data: new Uint8Array(1024) } },
          images: { 'live-protected': new Blob([new Uint8Array(512)]) },
        },
      },
      exposeDatabasesApi: true,
    });
    globalThis.indexedDB = failClosedIdb;
    globalThis.localStorage = {
      get length() {
        throw new DOMException('Blocked', 'SecurityError');
      },
      key() {
        throw new DOMException('Blocked', 'SecurityError');
      },
      getItem() {
        throw new DOMException('Blocked', 'SecurityError');
      },
      setItem() {
        throw new DOMException('Blocked', 'SecurityError');
      },
      removeItem() {
        throw new DOMException('Blocked', 'SecurityError');
      },
    };
    const secErrReport = await analyzerMod.analyzeBrowserStorage(opts);
    assert.equal(
      secErrReport.indexedDb.activeDb.orphanDetectionSkipped,
      true,
      'SecurityError on localStorage.getItem must fail closed'
    );
    assert.equal(secErrReport.indexedDb.activeDb.orphanedCount, 0);
    const secErrClean = await analyzerMod.cleanOrphanedSaveData(opts);
    assert.equal(secErrClean.deletedIdbRecords, 0);
    assert.deepEqual(failClosedIdb._getStoreKeys('capy_game_storage_v8', 'puzzles'), ['live-protected']);

    globalThis.localStorage = undefined;
    const undefLsReport = await analyzerMod.analyzeBrowserStorage(opts);
    assert.equal(
      undefLsReport.indexedDb.activeDb.orphanDetectionSkipped,
      true,
      'undefined localStorage must fail closed'
    );
    assert.equal(undefLsReport.indexedDb.activeDb.orphanedCount, 0);
    const undefLsClean = await analyzerMod.cleanOrphanedSaveData(opts);
    assert.equal(undefLsClean.deletedIdbRecords, 0);
    assert.deepEqual(failClosedIdb._getStoreKeys('capy_game_storage_v8', 'puzzles'), ['live-protected']);

    // 6. Regression: Android native BackupEngine fallback & fail-closed orphan protection
    await resetCachedHandles();
    const androidLs = createMockLocalStorage({});
    const androidIdb = createMockIndexedDb({
      initialDbs: {
        capy_game_storage_v8: {
          puzzles: {
            'android-live-1': { data: new Uint8Array(512) },
            'android-orphan-1': { data: new Uint8Array(256) },
          },
          images: {},
        },
      },
      exposeDatabasesApi: true,
    });
    globalThis.localStorage = androidLs;
    globalThis.indexedDB = androidIdb;
    globalThis.window = {
      location: { pathname: '/capy/', origin: 'https://example.github.io', search: '' },
      CapyAndroid: {
        loadBackup: (key) =>
          key === 'capy_snapshots_v8'
            ? JSON.stringify([{ id: 'android-live-1', title: 'Backed Up On Android' }])
            : null,
        saveBackup: () => true,
      },
    };
    const androidBackupReport = await analyzerMod.analyzeBrowserStorage(opts);
    assert.equal(androidBackupReport.indexedDb.activeDb.orphanDetectionSkipped, false);
    assert.deepEqual(
      androidBackupReport.indexedDb.activeDb.orphanedPuzzleKeys,
      ['android-orphan-1'],
      'Android native backup snapshots must keep live IDB saves protected while detecting true orphans'
    );
    // Throwing Android native backup when localStorage is empty must fail closed
    androidLs.removeItem('capy_snapshots_v8');
    globalThis.window.CapyAndroid.loadBackup = () => {
      throw new Error('Native bridge unavailable');
    };
    const androidErrReport = await analyzerMod.analyzeBrowserStorage(opts);
    assert.equal(
      androidErrReport.indexedDb.activeDb.orphanDetectionSkipped,
      true,
      'Throwing Android native backup must fail closed'
    );
    assert.equal(androidErrReport.indexedDb.activeDb.orphanedCount, 0);

    // 7. Regression: StorageAnalyzerOptions honored across cross-channel calls (window.location is Prod, options is Alpha)
    await resetCachedHandles();
    const crossLs = createMockLocalStorage({
      capy_snapshots_v8: JSON.stringify([{ id: 'prod-1', title: 'Production Save' }]),
      capy_active_session_v8: JSON.stringify({ activeSnapshotId: 'prod-1' }),
      capy_snapshots_v8__sandbox_alpha: JSON.stringify([{ id: 'alpha-live', title: 'Alpha Save' }]),
      capy_active_session_v8__sandbox_alpha: JSON.stringify({ activeSnapshotId: 'alpha-live' }),
    });
    const crossIdb = createMockIndexedDb({
      initialDbs: {
        capy_game_storage_v8: {
          puzzles: { 'prod-1': { data: new Uint8Array(4096) } },
          images: {},
        },
        capy_game_storage_v8_alpha: {
          puzzles: {
            'alpha-live': { data: new Uint8Array(2048) },
            'alpha-orphan': { data: new Uint8Array(1024) },
          },
          images: {},
        },
      },
      exposeDatabasesApi: true,
    });
    globalThis.localStorage = crossLs;
    globalThis.indexedDB = crossIdb;
    globalThis.window = {
      location: { pathname: '/capy/', origin: 'https://example.github.io', search: '' },
    };
    const alphaOpts = {
      pathname: '/capy/alpha/629/',
      origin: 'https://example.github.io',
      search: '',
      scopeUrl: 'https://example.github.io/capy/alpha/629/',
      version: '3.0.12',
    };
    const crossOrphanRes = await analyzerMod.cleanOrphanedSaveData(alphaOpts);
    assert.equal(crossOrphanRes.deletedIdbRecords, 1);
    assert.deepEqual(
      crossIdb._getStoreKeys('capy_game_storage_v8', 'puzzles'),
      ['prod-1'],
      'cleanOrphanedSaveData(alphaOptions) from Prod window must NEVER touch Production DB'
    );
    assert.deepEqual(
      crossIdb._getStoreKeys('capy_game_storage_v8_alpha', 'puzzles'),
      ['alpha-live'],
      'cleanOrphanedSaveData(alphaOptions) must delete only Alpha orphan'
    );
    const crossPreviewRes = await analyzerMod.clearPreviewChannelData(alphaOpts);
    assert.equal(crossPreviewRes.affectedActiveChannel, true);
    assert.equal(crossIdb._hasDb('capy_game_storage_v8_alpha'), false);
    assert.equal(crossIdb._hasDb('capy_game_storage_v8'), true, 'Production DB must remain untouched');
    assert.deepEqual(
      crossIdb._getStoreKeys('capy_game_storage_v8', 'puzzles'),
      ['prod-1'],
      'clearPreviewChannelData(alphaOptions) from Prod window must NEVER wipe Production saves'
    );
    assert.equal(
      JSON.parse(crossLs.getItem('capy_snapshots_v8')).length,
      1,
      'Production snapshots Local Storage key must remain intact'
    );

    // 8. Regression: clearPreviewChannelData from active Beta channel reports accurate freedBytesEstimate & deletedLocalKeys
    await resetCachedHandles();
    const betaLs = createMockLocalStorage({
      capy_snapshots_v8: JSON.stringify([{ id: 'prod-keep', title: 'Prod' }]),
      capy_snapshots_v8__sandbox_beta: JSON.stringify([{ id: 'beta-big', title: 'Beta Big' }]),
      capy_active_session_v8__sandbox_beta: JSON.stringify({ activeSnapshotId: 'beta-big' }),
    });
    const betaIdb = createMockIndexedDb({
      initialDbs: {
        capy_game_storage_v8: {
          puzzles: { 'prod-keep': { data: new Uint8Array(500) } },
          images: {},
        },
        capy_game_storage_v8_beta: {
          puzzles: { 'beta-big': { data: new Uint8Array(50_000) } },
          images: { 'beta-big': new Blob([new Uint8Array(20_000)]) },
        },
      },
      exposeDatabasesApi: true,
    });
    globalThis.localStorage = betaLs;
    globalThis.indexedDB = betaIdb;
    globalThis.window = {
      location: { pathname: '/capy/beta/', origin: 'https://example.github.io', search: '' },
    };
    const betaOpts = {
      pathname: '/capy/beta/',
      origin: 'https://example.github.io',
      search: '',
      scopeUrl: 'https://example.github.io/capy/beta/',
      version: '3.0.12',
    };
    const betaClean = await analyzerMod.clearPreviewChannelData(betaOpts);
    assert.equal(betaClean.affectedActiveChannel, true);
    assert.equal(betaClean.deletedIdbDatabases, 1);
    assert.equal(betaClean.deletedLocalKeys, 2);
    assert.equal(
      betaClean.freedBytesEstimate >= 70_000,
      true,
      `Active Beta clearPreviewChannelData must pre-measure IDB bytes >= 70000 (got ${betaClean.freedBytesEstimate})`
    );
    assert.equal(betaIdb._hasDb('capy_game_storage_v8'), true);
    assert.equal(betaLs.getItem('capy_snapshots_v8') !== null, true);

    // 9. Regression: Sibling-channel & unhealthy quarantine keys do not inflate cleanableQuarantineCount or totalReclaimableSafeBytes
    await resetCachedHandles();
    const qLs = createMockLocalStorage({
      capy_snapshots_v8: JSON.stringify([{ id: 'prod-1', title: 'Prod' }]),
      capy_snapshots_v8__sandbox_alpha__corrupt_quarantine: '{sibling-corrupt',
      capy_user_settings_v8__corrupt_quarantine: '{unhealthy-no-live-key',
    });
    const qIdb = createMockIndexedDb({
      initialDbs: {
        capy_game_storage_v8: {
          puzzles: { 'prod-1': { data: new Uint8Array(128) } },
          images: {},
        },
      },
      exposeDatabasesApi: true,
    });
    globalThis.localStorage = qLs;
    globalThis.indexedDB = qIdb;
    globalThis.caches = createMockCacheStorage({});
    globalThis.window = {
      location: { pathname: '/capy/', origin: 'https://example.github.io', search: '' },
    };
    const qReport = await analyzerMod.analyzeBrowserStorage(opts);
    assert.equal(qReport.localStore.quarantineCount, 2);
    assert.equal(
      qReport.localStore.cleanableQuarantineCount,
      0,
      'Sibling-channel & unhealthy quarantine keys must NOT be counted as cleanable'
    );
    assert.equal(
      qReport.totalReclaimableSafeBytes,
      0,
      'Uncleanable quarantine keys must NOT inflate totalReclaimableSafeBytes'
    );
  } finally {
    await resetCachedHandles();
    globalThis.localStorage = prevLs;
    globalThis.caches = prevCaches;
    globalThis.indexedDB = prevIdb;
    globalThis.window = prevWin;
    if (prevNavDesc) {
      Object.defineProperty(globalThis, 'navigator', prevNavDesc);
    } else {
      delete globalThis.navigator;
    }
  }
}

export async function runStorageAnalyzerTests(vite) {
  console.log('[Unit] Browser Storage Analyzer, SW Eviction & Image Compression Tests...');
  await runSwEvictionAndPrecacheTests();
  await runImageCompressionTests(vite);
  await runStorageAnalyzerCoreTests(vite);
}
