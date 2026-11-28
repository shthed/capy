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
  blockOpenDbNames = new Set(),
  blockOpenAfterDeleteDbNames = new Set(),
} = {}) {
  const dbs = new Map();
  const createdNames = [];
  const deleteAttemptedDbNames = new Set();

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
        if (this.closed) {
          throw new DOMException('The database connection is closing.', 'InvalidStateError');
        }
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
        if (
          blockOpenDbNames.has(dbName) ||
          (blockOpenAfterDeleteDbNames.has(dbName) && deleteAttemptedDbNames.has(dbName))
        ) {
          req.onblocked?.({ target: req });
          return;
        }
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
      deleteAttemptedDbNames.add(dbName);
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
  const snapshotMod = await vite.ssrLoadModule('/src/services/storage/SnapshotStorage.ts');
  const backupMod = await vite.ssrLoadModule('/src/services/storage/BackupEngine.ts');
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
    analyzerMod.isCapyPaintLocalKey('capy_gemini_byok_key_v1'),
    true,
    'Device-local Gemini BYOK key must be classified as Capy Paint storage'
  );
  assert.equal(
    analyzerMod.isCapyPaintLocalKey('capy_gemini_byok_key_v1__sandbox_alpha'),
    true,
    'Channel-scoped Gemini BYOK key must be classified as Capy Paint storage'
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

    // 10. Regression: Android localStorage="[]" while CapyAndroid.loadBackup has live saves -> must preserve live saves
    await resetCachedHandles();
    const androidEmptyArrLs = createMockLocalStorage({
      capy_snapshots_v8: '[]',
    });
    const androidEmptyArrIdb = createMockIndexedDb({
      initialDbs: {
        capy_game_storage_v8: {
          puzzles: {
            'native-live-1': { data: new Uint8Array(512) },
            'native-orphan-1': { data: new Uint8Array(256) },
          },
          images: {
            'native-blob-1': new Blob([new Uint8Array(256)]),
            'preview_native-live-1': new Blob([new Uint8Array(128)]),
            'orphan-img-1': new Blob([new Uint8Array(128)]),
          },
        },
      },
      exposeDatabasesApi: true,
    });
    globalThis.localStorage = androidEmptyArrLs;
    globalThis.indexedDB = androidEmptyArrIdb;
    globalThis.window = {
      location: { pathname: '/capy/', origin: 'https://example.github.io', search: '' },
      CapyAndroid: {
        loadBackup: (key) =>
          key === 'capy_snapshots_v8'
            ? JSON.stringify([
                {
                  id: 'native-live-1',
                  title: 'Recovered From Native',
                  sourceRef: { kind: 'blob', uri: 'native-blob-1' },
                },
              ])
            : null,
        saveBackup: () => true,
      },
    };
    const emptyArrClean = await analyzerMod.cleanOrphanedSaveData(opts);
    assert.equal(emptyArrClean.deletedIdbRecords, 2);
    assert.deepEqual(
      androidEmptyArrIdb._getStoreKeys('capy_game_storage_v8', 'puzzles'),
      ['native-live-1'],
      'Android backup live save must survive cleanOrphanedSaveData when localStorage="[]"'
    );
    assert.deepEqual(
      androidEmptyArrIdb._getStoreKeys('capy_game_storage_v8', 'images').sort(),
      ['native-blob-1', 'preview_native-live-1'],
      'Android backup blob and preview must survive cleanOrphanedSaveData when localStorage="[]"'
    );

    // 11. Regression: Android localStorage has stale [s1] while CapyAndroid.loadBackup has [s1, s2] -> s2 must survive
    await resetCachedHandles();
    const androidStaleLs = createMockLocalStorage({
      capy_snapshots_v8: JSON.stringify([{ id: 's1', title: 'Save 1' }]),
    });
    const androidStaleIdb = createMockIndexedDb({
      initialDbs: {
        capy_game_storage_v8: {
          puzzles: {
            s1: { data: new Uint8Array(512) },
            s2: { data: new Uint8Array(512) },
            'stale-orphan': { data: new Uint8Array(256) },
          },
          images: {},
        },
      },
      exposeDatabasesApi: true,
    });
    globalThis.localStorage = androidStaleLs;
    globalThis.indexedDB = androidStaleIdb;
    globalThis.window = {
      location: { pathname: '/capy/', origin: 'https://example.github.io', search: '' },
      CapyAndroid: {
        loadBackup: (key) =>
          key === 'capy_snapshots_v8'
            ? JSON.stringify([
                { id: 's1', title: 'Save 1' },
                { id: 's2', title: 'Save 2 Newer' },
              ])
            : null,
        saveBackup: () => true,
      },
    };
    const staleBackupClean = await analyzerMod.cleanOrphanedSaveData(opts);
    assert.equal(staleBackupClean.deletedIdbRecords, 1);
    assert.deepEqual(
      androidStaleIdb._getStoreKeys('capy_game_storage_v8', 'puzzles').sort(),
      ['s1', 's2'],
      'Newer save s2 in Android backup must survive cleanOrphanedSaveData when localStorage has stale [s1]'
    );

    // 12. Regression: Pure Web QuotaExceededError buffering [s1, s2] in BackupEngine pendingLocalHealWrites -> s2 must survive
    await resetCachedHandles();
    const baseQuotaLs = createMockLocalStorage({
      capy_snapshots_v8: JSON.stringify([{ id: 's1', title: 'Save 1', updatedAt: 1000 }]),
    });
    let throwQuotaOnSet = true;
    const quotaWebLs = {
      get length() {
        return baseQuotaLs.length;
      },
      key(i) {
        return baseQuotaLs.key(i);
      },
      getItem(k) {
        return baseQuotaLs.getItem(k);
      },
      setItem(k, v) {
        if (throwQuotaOnSet && k === 'capy_snapshots_v8') {
          throw new DOMException('Quota exceeded', 'QuotaExceededError');
        }
        baseQuotaLs.setItem(k, v);
      },
      removeItem(k) {
        baseQuotaLs.removeItem(k);
      },
      clear() {
        baseQuotaLs.clear();
      },
    };
    const quotaWebIdb = createMockIndexedDb({
      initialDbs: {
        capy_game_storage_v8: {
          puzzles: {
            s1: { data: new Uint8Array(512) },
            s2: { data: new Uint8Array(512) },
            'web-orphan': { data: new Uint8Array(256) },
          },
          images: {},
        },
      },
      exposeDatabasesApi: true,
    });
    globalThis.localStorage = quotaWebLs;
    globalThis.indexedDB = quotaWebIdb;
    globalThis.window = {
      location: { pathname: '/capy/', origin: 'https://example.github.io', search: '' },
    };
    snapshotMod.saveSnapshots([
      { id: 's1', title: 'Save 1', updatedAt: 1000 },
      { id: 's2', title: 'Save 2 Buffered', updatedAt: 2000 },
    ]);
    // Confirm localStorage still only has stale [s1] while BackupEngine buffered [s1, s2]
    assert.equal(JSON.parse(quotaWebLs.getItem('capy_snapshots_v8')).length, 1);
    const webQuotaClean = await analyzerMod.cleanOrphanedSaveData(opts);
    assert.equal(webQuotaClean.deletedIdbRecords, 1);
    assert.deepEqual(
      quotaWebIdb._getStoreKeys('capy_game_storage_v8', 'puzzles').sort(),
      ['s1', 's2'],
      'Live save s2 buffered in BackupEngine pendingLocalHealWrites after QuotaExceededError must survive cleanOrphanedSaveData'
    );
    // Clean up BackupEngine pending queue so state does not leak to subsequent tests
    throwQuotaOnSet = false;
    backupMod.flushPendingBackups();

    // 13. Regression: analyzeBrowserStorage() on Android with empty localStorage + populated CapyAndroid.loadBackup MUST be 100% read-only (0 writes)
    await resetCachedHandles();
    const roBaseLs = createMockLocalStorage({});
    let lsWriteCount = 0;
    const roSpyLs = {
      get length() {
        return roBaseLs.length;
      },
      key(i) {
        return roBaseLs.key(i);
      },
      getItem(k) {
        return roBaseLs.getItem(k);
      },
      setItem(k, v) {
        lsWriteCount += 1;
        roBaseLs.setItem(k, v);
      },
      removeItem(k) {
        lsWriteCount += 1;
        roBaseLs.removeItem(k);
      },
      clear() {
        lsWriteCount += 1;
        roBaseLs.clear();
      },
    };
    const roAndroidIdb = createMockIndexedDb({
      initialDbs: {
        capy_game_storage_v8: {
          puzzles: {
            'ro-live-1': { data: new Uint8Array(512) },
            'ro-orphan-1': { data: new Uint8Array(256) },
          },
          images: {},
        },
      },
      exposeDatabasesApi: true,
    });
    globalThis.localStorage = roSpyLs;
    globalThis.indexedDB = roAndroidIdb;
    globalThis.window = {
      location: { pathname: '/capy/', origin: 'https://example.github.io', search: '' },
      CapyAndroid: {
        loadBackup: (key) =>
          key === 'capy_snapshots_v8'
            ? JSON.stringify([{ id: 'ro-live-1', title: 'Android Backup' }])
            : null,
        saveBackup: () => true,
      },
    };
    const roReport = await analyzerMod.analyzeBrowserStorage(opts);
    assert.equal(roReport.indexedDb.activeDb.orphanDetectionSkipped, false);
    assert.deepEqual(roReport.indexedDb.activeDb.orphanedPuzzleKeys, ['ro-orphan-1']);
    assert.equal(
      lsWriteCount,
      0,
      `analyzeBrowserStorage() must perform 0 localStorage writes on Android backup read (got ${lsWriteCount})`
    );
    assert.equal(roBaseLs.getItem('capy_snapshots_v8'), null);

    // 14. Regression: Blocked DB where indexedDB.open inside clearAllStores() ALSO blocks -> returns false, no freedBytes inflation, accurate warning
    await resetCachedHandles();
    const blockedOpenLs = createMockLocalStorage({
      capy_snapshots_v8: JSON.stringify([{ id: 'p1', title: 'Prod' }]),
    });
    const blockedOpenIdb = createMockIndexedDb({
      initialDbs: {
        capy_game_storage_v8: {
          puzzles: { p1: { data: new Uint8Array(50_000) } },
          images: {},
        },
        capy_game_storage_v8_alpha: {
          puzzles: { a1: { data: new Uint8Array(50_000) } },
          images: {},
        },
      },
      exposeDatabasesApi: true,
      blockedDbNames: new Set(['capy_game_storage_v8_alpha', 'capy_game_storage_v8']),
      blockOpenAfterDeleteDbNames: new Set(['capy_game_storage_v8_alpha', 'capy_game_storage_v8']),
    });
    globalThis.localStorage = blockedOpenLs;
    globalThis.indexedDB = blockedOpenIdb;
    globalThis.caches = createMockCacheStorage({});
    globalThis.window = {
      location: { pathname: '/capy/', origin: 'https://example.github.io', search: '' },
    };
    const blockedPreviewRes = await analyzerMod.clearPreviewChannelData({
      ...opts,
      channels: ['alpha'],
      blockedTimeoutMs: 60,
    });
    assert.deepEqual(blockedPreviewRes.blockedDatabases, ['capy_game_storage_v8_alpha']);
    assert.equal(
      blockedPreviewRes.freedBytesEstimate,
      0,
      `Blocked DB whose clearAllStores() failed must NOT inflate freedBytesEstimate (got ${blockedPreviewRes.freedBytesEstimate})`
    );
    assert.equal(
      blockedPreviewRes.warnings.some((w) => w.includes('data was cleared')),
      false,
      'Warning must NOT falsely claim "data was cleared" when clearAllStores() fails'
    );
    assert.deepEqual(blockedOpenIdb._getStoreKeys('capy_game_storage_v8_alpha', 'puzzles'), ['a1']);

    // Direct clearAllStores() call against blocked-open DB must return false
    const directClearOk = await idbMod.clearAllStores('capy_game_storage_v8_alpha', 60);
    assert.equal(directClearOk, false, 'clearAllStores() must return false when open() is blocked');

    // Also verify clearAllCapyStorage does not credit blocked un-cleared active DB bytes
    const blockedAllRes = await analyzerMod.clearAllCapyStorage({ ...opts, blockedTimeoutMs: 60 });
    assert.equal(blockedAllRes.blockedDatabases.includes('capy_game_storage_v8'), true);
    assert.equal(
      blockedAllRes.freedBytesEstimate < 50_000,
      true,
      `clearAllCapyStorage must NOT include un-cleared 50KB DB bytes (got ${blockedAllRes.freedBytesEstimate})`
    );
    assert.equal(
      blockedAllRes.warnings.some((w) => w.includes('data was cleared')),
      false,
      'clearAllCapyStorage warning must NOT falsely claim "data was cleared" when clearAllStores() fails'
    );

    // 15. Regression: Corrupt SNAPSHOTS_KEY + healthy SETTINGS_KEY quarantine key -> cleanableQuarantineCount===1 and cleanOrphanedSaveData deletes it while preserving all IDB saves
    await resetCachedHandles();
    const corruptSnapLs = createMockLocalStorage({
      capy_snapshots_v8: '{corrupt-json',
      capy_user_settings_v8: JSON.stringify({ theme: 'dark' }),
      capy_user_settings_v8__corrupt_quarantine: '{old-corrupt-settings',
    });
    const corruptSnapIdb = createMockIndexedDb({
      initialDbs: {
        capy_game_storage_v8: {
          puzzles: {
            'preserve-1': { data: new Uint8Array(1024) },
            'preserve-2': { data: new Uint8Array(1024) },
          },
          images: {
            'preserve-1': new Blob([new Uint8Array(512)]),
          },
        },
      },
      exposeDatabasesApi: true,
    });
    globalThis.localStorage = corruptSnapLs;
    globalThis.indexedDB = corruptSnapIdb;
    globalThis.caches = createMockCacheStorage({});
    globalThis.window = {
      location: { pathname: '/capy/', origin: 'https://example.github.io', search: '' },
    };
    const corruptSnapReport = await analyzerMod.analyzeBrowserStorage(opts);
    assert.equal(corruptSnapReport.indexedDb.activeDb.orphanDetectionSkipped, true);
    assert.equal(corruptSnapReport.indexedDb.activeDb.orphanedCount, 0);
    assert.equal(
      corruptSnapReport.localStore.cleanableQuarantineCount,
      1,
      'Healthy settings quarantine key must still be counted as cleanable when snapshots JSON is corrupt'
    );
    const corruptSnapClean = await analyzerMod.cleanOrphanedSaveData(opts);
    assert.equal(corruptSnapClean.deletedIdbRecords, 0, 'IDB saves must be preserved when metadata is corrupt');
    assert.equal(
      corruptSnapClean.deletedLocalKeys,
      1,
      'cleanOrphanedSaveData must still clean the 1 healthy quarantine key matching cleanableQuarantineCount'
    );
    assert.equal(corruptSnapLs.getItem('capy_user_settings_v8__corrupt_quarantine'), null);
    assert.deepEqual(
      corruptSnapIdb._getStoreKeys('capy_game_storage_v8', 'puzzles').sort(),
      ['preserve-1', 'preserve-2']
    );
    assert.equal(
      corruptSnapClean.warnings.some((w) => w.includes('Skipped IDB orphan cleanup')),
      true
    );

    // 16. Regression: Post-blocked analyzeBrowserStorage({ blockedTimeoutMs }) when open() hangs behind blocked deleteDatabase() must resolve within bounded timeout and close late-opened handle
    await resetCachedHandles();
    const postBlockedLs = createMockLocalStorage({
      capy_snapshots_v8: JSON.stringify([{ id: 'prod-ok', title: 'Prod OK' }]),
    });
    const basePostBlockedIdb = createMockIndexedDb({
      initialDbs: {
        capy_game_storage_v8: {
          puzzles: { 'prod-ok': { data: new Uint8Array(512) } },
          images: {},
        },
        capy_game_storage_v8_alpha: {
          puzzles: { 'alpha-stuck': { data: new Uint8Array(2048) } },
          images: {},
        },
      },
      exposeDatabasesApi: true,
      blockedDbNames: new Set(['capy_game_storage_v8_alpha']),
    });
    const deferredAlphaOpens = [];
    let alphaDeleteCalled = false;
    const postBlockedIdb = {
      ...basePostBlockedIdb,
      deleteDatabase(dbName) {
        if (dbName === 'capy_game_storage_v8_alpha') {
          alphaDeleteCalled = true;
        }
        return basePostBlockedIdb.deleteDatabase(dbName);
      },
      open(dbName, version) {
        if (dbName === 'capy_game_storage_v8_alpha' && alphaDeleteCalled) {
          const req = {
            result: null,
            error: null,
            transaction: null,
            onupgradeneeded: null,
            onsuccess: null,
            onerror: null,
            onblocked: null,
          };
          deferredAlphaOpens.push(req);
          return req;
        }
        return basePostBlockedIdb.open(dbName, version);
      },
    };
    globalThis.localStorage = postBlockedLs;
    globalThis.indexedDB = postBlockedIdb;
    globalThis.caches = createMockCacheStorage({});
    globalThis.window = {
      location: { pathname: '/capy/', origin: 'https://example.github.io', search: '' },
    };
    const postBlockedClearRes = await analyzerMod.clearPreviewChannelData({
      ...opts,
      channels: ['alpha'],
      blockedTimeoutMs: 60,
    });
    assert.deepEqual(postBlockedClearRes.blockedDatabases, ['capy_game_storage_v8_alpha']);
    const scanStartMs = Date.now();
    const postBlockedReport = await analyzerMod.analyzeBrowserStorage({
      ...opts,
      blockedTimeoutMs: 60,
    });
    const scanElapsedMs = Date.now() - scanStartMs;
    assert.equal(
      scanElapsedMs < 1500,
      true,
      `Post-blocked analyzeBrowserStorage() must resolve within bounded timeout (took ${scanElapsedMs}ms)`
    );
    assert.equal(postBlockedReport.indexedDb.activeDb?.dbName, 'capy_game_storage_v8');
    assert.equal(
      deferredAlphaOpens.length >= 2,
      true,
      'Expected hanging open() calls for blocked clearAllStores and post-cleanup analyzeBrowserStorage'
    );
    // Simulate stalled readonly open() completing after timeout and verify the late handle is immediately closed
    const lastReadonlyReq = deferredAlphaOpens[deferredAlphaOpens.length - 1];
    const trackedLateHandle = {
      name: 'capy_game_storage_v8_alpha',
      closed: false,
      onversionchange: null,
      close() {
        this.closed = true;
      },
    };
    lastReadonlyReq.result = trackedLateHandle;
    lastReadonlyReq.onsuccess?.({ target: lastReadonlyReq });
    assert.equal(
      trackedLateHandle.closed,
      true,
      'Late-opening readonly handle after openExistingIdbReadonly() timeout must be closed immediately'
    );

    // 17. Regression: Timed-out clearAllStores(dbName, 60) where stalled open() resolves later (BOTH unclosed FIFO wakeup AND InvalidStateError retry paths) must NOT wipe new post-timeout saves
    // 17a: Unclosed FIFO wakeup path
    await resetCachedHandles();
    const zombieFifoBaseIdb = createMockIndexedDb({
      initialDbs: {
        capy_game_storage_v8: {
          puzzles: { 'old-save': { data: new Uint8Array(256) } },
          images: {},
        },
      },
      exposeDatabasesApi: true,
    });
    let fifoHangFirstOpen = true;
    let fifoStalledReq = null;
    const zombieFifoIdb = {
      ...zombieFifoBaseIdb,
      open(dbName, version) {
        if (dbName === 'capy_game_storage_v8' && fifoHangFirstOpen) {
          fifoHangFirstOpen = false;
          fifoStalledReq = {
            result: null,
            error: null,
            transaction: null,
            onupgradeneeded: null,
            onsuccess: null,
            onerror: null,
            onblocked: null,
          };
          return fifoStalledReq;
        }
        return zombieFifoBaseIdb.open(dbName, version);
      },
    };
    globalThis.indexedDB = zombieFifoIdb;
    globalThis.window = {
      location: { pathname: '/capy/', origin: 'https://example.github.io', search: '' },
    };
    const fifoTimedOutOk = await idbMod.clearAllStores('capy_game_storage_v8', 60);
    assert.equal(fifoTimedOutOk, false, 'Stalled clearAllStores() must time out and return false');
    await idbMod.saveCompactPuzzleRecord('post-timeout-fifo', { data: new Uint8Array(128) });
    assert.equal(
      zombieFifoBaseIdb._getStoreKeys('capy_game_storage_v8', 'puzzles').includes('post-timeout-fifo'),
      true
    );
    // Deliver a real unclosed DB handle to the timed-out open() request (FIFO wakeup)
    const lateFifoOpenReq = zombieFifoBaseIdb.open('capy_game_storage_v8');
    const lateFifoDb = await new Promise((resolve) => {
      lateFifoOpenReq.onsuccess = () => resolve(lateFifoOpenReq.result);
    });
    fifoStalledReq.result = lateFifoDb;
    fifoStalledReq.onsuccess?.({ target: fifoStalledReq });
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(
      zombieFifoBaseIdb._getStoreKeys('capy_game_storage_v8', 'puzzles').includes('post-timeout-fifo'),
      true,
      'Late-resolving FIFO open() after clearAllStores() timeout must NOT wipe post-timeout saves'
    );
    assert.equal(
      lateFifoDb.closed,
      true,
      'Stalled DB handle delivered after clearAllStores() timeout must be closed'
    );

    // 17b: Already-closed handle / InvalidStateError retry path
    await resetCachedHandles();
    const zombieRetryBaseIdb = createMockIndexedDb({
      initialDbs: {
        capy_game_storage_v8: {
          puzzles: { 'old-save': { data: new Uint8Array(256) } },
          images: {},
        },
      },
      exposeDatabasesApi: true,
    });
    let retryHangFirstOpen = true;
    let retryStalledReq = null;
    const zombieRetryIdb = {
      ...zombieRetryBaseIdb,
      open(dbName, version) {
        if (dbName === 'capy_game_storage_v8' && retryHangFirstOpen) {
          retryHangFirstOpen = false;
          retryStalledReq = {
            result: null,
            error: null,
            transaction: null,
            onupgradeneeded: null,
            onsuccess: null,
            onerror: null,
            onblocked: null,
          };
          return retryStalledReq;
        }
        return zombieRetryBaseIdb.open(dbName, version);
      },
    };
    globalThis.indexedDB = zombieRetryIdb;
    const retryTimedOutOk = await idbMod.clearAllStores('capy_game_storage_v8', 60);
    assert.equal(retryTimedOutOk, false, 'Stalled clearAllStores() must time out and return false');
    await idbMod.saveCompactPuzzleRecord('post-timeout-invalidstate', { data: new Uint8Array(128) });
    // Deliver an InvalidStateError rejection to the timed-out open() to exercise runTransaction's catch/retry path
    retryStalledReq.error = new DOMException('The database connection is closing.', 'InvalidStateError');
    retryStalledReq.onerror?.({ target: retryStalledReq });
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(
      zombieRetryBaseIdb
        ._getStoreKeys('capy_game_storage_v8', 'puzzles')
        .includes('post-timeout-invalidstate'),
      true,
      'Late InvalidStateError after clearAllStores() timeout must NOT trigger attempt=1 retry wipe'
    );
    // Also verify already-closed handle delivered to onsuccess cannot trigger retry wipe
    await resetCachedHandles();
    retryHangFirstOpen = true;
    retryStalledReq = null;
    const closedTimedOutOk = await idbMod.clearAllStores('capy_game_storage_v8', 60);
    assert.equal(closedTimedOutOk, false);
    await idbMod.saveCompactPuzzleRecord('post-timeout-closed-handle', { data: new Uint8Array(128) });
    const preClosedReq = zombieRetryBaseIdb.open('capy_game_storage_v8');
    const preClosedDb = await new Promise((resolve) => {
      preClosedReq.onsuccess = () => resolve(preClosedReq.result);
    });
    preClosedDb.close();
    retryStalledReq.result = preClosedDb;
    retryStalledReq.onsuccess?.({ target: retryStalledReq });
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(
      zombieRetryBaseIdb
        ._getStoreKeys('capy_game_storage_v8', 'puzzles')
        .includes('post-timeout-closed-handle'),
      true,
      'Late already-closed DB handle after clearAllStores() timeout must NOT trigger retry wipe'
    );

    // 18. Regression: computeOrphanedKeys / cleanOrphanedSaveData with rawSnapshotsJson='[null, {}]' fails closed while '[]' succeeds
    const corruptElemOrphan = analyzerMod.computeOrphanedKeys({
      puzzleKeys: ['live-1'],
      imageKeys: ['preview_live-1'],
      rawSnapshotsJson: '[null, {}]',
      rawActiveStateJson: null,
    });
    assert.equal(
      corruptElemOrphan.skipped,
      true,
      'Non-empty snapshots array with zero valid IDs ("[null, {}]") must fail closed'
    );
    assert.deepEqual(corruptElemOrphan.orphanedPuzzleKeys, []);
    assert.deepEqual(corruptElemOrphan.orphanedImageKeys, []);

    const validEmptyOrphan = analyzerMod.computeOrphanedKeys({
      puzzleKeys: ['orphan-empty-1'],
      imageKeys: ['preview_orphan-empty-1'],
      rawSnapshotsJson: '[]',
      rawActiveStateJson: null,
    });
    assert.equal(validEmptyOrphan.skipped, false, 'Empty snapshots array ("[]") must remain valid');
    assert.deepEqual(validEmptyOrphan.orphanedPuzzleKeys, ['orphan-empty-1']);
    assert.deepEqual(validEmptyOrphan.orphanedImageKeys, ['preview_orphan-empty-1']);

    await resetCachedHandles();
    const corruptElemLs = createMockLocalStorage({
      capy_snapshots_v8: '[null, {}]',
    });
    const corruptElemIdb = createMockIndexedDb({
      initialDbs: {
        capy_game_storage_v8: {
          puzzles: { 'live-1': { data: new Uint8Array(512) } },
          images: { 'preview_live-1': new Blob([new Uint8Array(128)]) },
        },
      },
      exposeDatabasesApi: true,
    });
    globalThis.localStorage = corruptElemLs;
    globalThis.indexedDB = corruptElemIdb;
    globalThis.caches = createMockCacheStorage({});
    globalThis.window = {
      location: { pathname: '/capy/', origin: 'https://example.github.io', search: '' },
    };
    const corruptElemReport = await analyzerMod.analyzeBrowserStorage(opts);
    assert.equal(corruptElemReport.indexedDb.activeDb.orphanDetectionSkipped, true);
    const corruptElemClean = await analyzerMod.cleanOrphanedSaveData(opts);
    assert.equal(
      corruptElemClean.deletedIdbRecords,
      0,
      'cleanOrphanedSaveData must delete 0 IDB records when rawSnapshotsJson is "[null, {}]"'
    );
    assert.deepEqual(corruptElemIdb._getStoreKeys('capy_game_storage_v8', 'puzzles'), ['live-1']);

    corruptElemLs.setItem('capy_snapshots_v8', '[]');
    const emptyArrValidClean = await analyzerMod.cleanOrphanedSaveData(opts);
    assert.equal(
      emptyArrValidClean.deletedIdbRecords,
      2,
      'cleanOrphanedSaveData must still clean orphaned records when rawSnapshotsJson is valid "[]"'
    );
    assert.deepEqual(corruptElemIdb._getStoreKeys('capy_game_storage_v8', 'puzzles'), []);

    // 19. Regression (D1): 2nd queued clearAllCapyStorage({ blockedTimeoutMs: 60 }) while 1st deleteDatabase() is still pending (never fires onblocked) resolves within bounded timeout
    await resetCachedHandles();
    const queuedLs = createMockLocalStorage({
      capy_snapshots_v8: JSON.stringify([{ id: 'q-1', title: 'Queued 1' }]),
    });
    const queuedBaseIdb = createMockIndexedDb({
      initialDbs: {
        capy_game_storage_v8: {
          puzzles: { 'q-1': { data: new Uint8Array(512) } },
          images: {},
        },
      },
      exposeDatabasesApi: true,
    });
    let prodDeleteCalls = 0;
    const queuedIdb = {
      ...queuedBaseIdb,
      deleteDatabase(dbName) {
        if (dbName === 'capy_game_storage_v8') {
          prodDeleteCalls += 1;
          const req = {
            result: undefined,
            error: null,
            onsuccess: null,
            onerror: null,
            onblocked: null,
          };
          if (prodDeleteCalls === 1) {
            // 1st deleteDatabase fires onblocked and stays pending in the IDB queue
            setTimeout(() => req.onblocked?.({ target: req }), 0);
          }
          // 2nd+ queued deleteDatabase never fires onblocked/onsuccess/onerror while 1st is pending
          return req;
        }
        return queuedBaseIdb.deleteDatabase(dbName);
      },
      open(dbName, version) {
        if (dbName === 'capy_game_storage_v8' && prodDeleteCalls >= 1) {
          // Queued behind pending deleteDatabase: never fires any event
          return {
            result: null,
            error: null,
            transaction: null,
            onupgradeneeded: null,
            onsuccess: null,
            onerror: null,
            onblocked: null,
          };
        }
        return queuedBaseIdb.open(dbName, version);
      },
    };
    globalThis.localStorage = queuedLs;
    globalThis.indexedDB = queuedIdb;
    globalThis.caches = createMockCacheStorage({});
    globalThis.window = {
      location: { pathname: '/capy/', origin: 'https://example.github.io', search: '' },
    };
    const firstClearRes = await analyzerMod.clearAllCapyStorage({ ...opts, blockedTimeoutMs: 60 });
    assert.equal(firstClearRes.blockedDatabases.includes('capy_game_storage_v8'), true);
    const secondClearStartMs = Date.now();
    const secondClearRes = await analyzerMod.clearAllCapyStorage({ ...opts, blockedTimeoutMs: 60 });
    const secondClearElapsedMs = Date.now() - secondClearStartMs;
    assert.equal(
      secondClearElapsedMs < 1000,
      true,
      `2nd queued clearAllCapyStorage() must resolve within bounded timeout (took ${secondClearElapsedMs}ms)`
    );
    assert.equal(
      secondClearRes.blockedDatabases.includes('capy_game_storage_v8'),
      true,
      '2nd queued clearAllCapyStorage() must report capy_game_storage_v8 in blockedDatabases'
    );
    assert.equal(prodDeleteCalls >= 2, true, `Expected >=2 deleteDatabase calls (got ${prodDeleteCalls})`);

    // 20. Regression (D2): closeDbHandle(dbName, 60) with a stalled openPromise resolves within bounded timeout AND closes the DB handle immediately when open() later resolves (0 unhandled rejections)
    await resetCachedHandles();
    let unhandledCount = 0;
    const onUnhandled = () => {
      unhandledCount += 1;
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      const stalledOpenReqs = [];
      const stalledOpenBaseIdb = createMockIndexedDb({
        initialDbs: {
          capy_game_storage_v8: { puzzles: {}, images: {} },
        },
        exposeDatabasesApi: true,
      });
      globalThis.indexedDB = {
        ...stalledOpenBaseIdb,
        open(dbName) {
          const req = {
            result: null,
            error: null,
            transaction: null,
            onupgradeneeded: null,
            onsuccess: null,
            onerror: null,
            onblocked: null,
          };
          stalledOpenReqs.push({ dbName, req });
          return req;
        },
      };
      globalThis.window = {
        location: { pathname: '/capy/', origin: 'https://example.github.io', search: '' },
      };

      // Populate dbPromises with a stalled openPromise via a normal app write
      const pendingSave = idbMod
        .saveCompactPuzzleRecord('stalled-d2', { data: new Uint8Array(16) })
        .catch(() => undefined);
      assert.equal(stalledOpenReqs.length, 1, 'Expected stalled open() request to be created');

      const closeStartMs = Date.now();
      await idbMod.closeDbHandle('capy_game_storage_v8', 60);
      const closeElapsedMs = Date.now() - closeStartMs;
      assert.equal(
        closeElapsedMs < 500,
        true,
        `closeDbHandle(dbName, 60) must resolve within bounded timeout (took ${closeElapsedMs}ms)`
      );

      // Now resolve the stalled open() late and verify closeWhenReady closes the handle immediately
      const lateTrackedDb = {
        name: 'capy_game_storage_v8',
        closed: false,
        onversionchange: null,
        onclose: null,
        transaction() {
          throw new DOMException('The database connection is closing.', 'InvalidStateError');
        },
        close() {
          this.closed = true;
        },
      };
      stalledOpenReqs[0].req.result = lateTrackedDb;
      stalledOpenReqs[0].req.onsuccess?.({ target: stalledOpenReqs[0].req });
      await new Promise((resolve) => setTimeout(resolve, 25));
      assert.equal(
        lateTrackedDb.closed,
        true,
        'Late-resolving DB handle after closeDbHandle() timeout must be closed immediately'
      );

      // Also verify stalled open() that later rejects triggers 0 unhandled rejections
      const pendingRejectSave = idbMod
        .saveCompactPuzzleRecord('stalled-d2-reject', { data: new Uint8Array(16) })
        .catch(() => undefined);
      const rejectReq = stalledOpenReqs[stalledOpenReqs.length - 1].req;
      await idbMod.closeDbHandle('capy_game_storage_v8', 60);
      rejectReq.error = new DOMException('Open aborted', 'AbortError');
      rejectReq.onerror?.({ target: rejectReq });
      await pendingRejectSave;
      // Settle any retry request created by pendingSave cleanly
      for (const item of stalledOpenReqs.slice(1)) {
        if (!item.req.error && !item.req.result) {
          item.req.error = new DOMException('Aborted', 'AbortError');
          item.req.onerror?.({ target: item.req });
        }
      }
      await pendingSave;
      await new Promise((resolve) => setTimeout(resolve, 25));
      assert.equal(unhandledCount, 0, `Expected 0 unhandled rejections (got ${unhandledCount})`);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }

    // 21. Regression (D3 + D4/D5): Pre-measurement open() hang on Production does NOT silently skip preview DB deletion, emits busy warning on cleanOrphanedSaveData, and counts sibling DB deletions accurately
    // 21a (D3): Production clearPreviewChannelData({ channels: ['beta'], blockedTimeoutMs: 60 }) when beta pre-measure open() hangs
    await resetCachedHandles();
    const d3Ls = createMockLocalStorage({
      capy_snapshots_v8: JSON.stringify([{ id: 'prod-safe', title: 'Prod Safe' }]),
    });
    const d3BaseIdb = createMockIndexedDb({
      initialDbs: {
        capy_game_storage_v8: {
          puzzles: { 'prod-safe': { data: new Uint8Array(512) } },
          images: {},
        },
        capy_game_storage_v8_beta: {
          puzzles: { 'beta-stuck': { data: new Uint8Array(2048) } },
          images: {},
        },
      },
      exposeDatabasesApi: true,
      blockedDbNames: new Set(['capy_game_storage_v8_beta']),
    });
    let betaDeleteCalls = 0;
    const d3Idb = {
      ...d3BaseIdb,
      open(dbName, version) {
        if (dbName === 'capy_game_storage_v8_beta') {
          // Hang pre-measurement open() and clearAllStores open()
          return {
            result: null,
            error: null,
            transaction: null,
            onupgradeneeded: null,
            onsuccess: null,
            onerror: null,
            onblocked: null,
          };
        }
        return d3BaseIdb.open(dbName, version);
      },
      deleteDatabase(dbName) {
        if (dbName === 'capy_game_storage_v8_beta') {
          betaDeleteCalls += 1;
        }
        return d3BaseIdb.deleteDatabase(dbName);
      },
    };
    globalThis.localStorage = d3Ls;
    globalThis.indexedDB = d3Idb;
    globalThis.caches = createMockCacheStorage({});
    globalThis.window = {
      location: { pathname: '/capy/', origin: 'https://example.github.io', search: '' },
    };
    const d3Res = await analyzerMod.clearPreviewChannelData({
      ...opts,
      channels: ['beta'],
      blockedTimeoutMs: 60,
    });
    assert.equal(d3Res.affectedActiveChannel, false);
    assert.equal(
      betaDeleteCalls,
      1,
      `Production clearPreviewChannelData must still call safeDeleteDatabase on timed-out beta DB (got ${betaDeleteCalls})`
    );
    assert.deepEqual(d3Res.blockedDatabases, ['capy_game_storage_v8_beta']);
    assert.equal(
      d3Res.warnings.some((w) => w.includes('capy_game_storage_v8_beta') && w.includes('another tab')),
      true,
      `Expected blocked warning for capy_game_storage_v8_beta (got ${JSON.stringify(d3Res.warnings)})`
    );

    // 21b (D4): cleanOrphanedSaveData when active DB open() hangs emits busy warning while still cleaning healthy quarantine keys
    await resetCachedHandles();
    const d4Ls = createMockLocalStorage({
      capy_snapshots_v8: JSON.stringify([{ id: 'prod-1', title: 'Prod 1' }]),
      capy_user_settings_v8: JSON.stringify({ theme: 'light' }),
      capy_user_settings_v8__corrupt_quarantine: '{corrupt-settings',
    });
    const d4BaseIdb = createMockIndexedDb({
      initialDbs: {
        capy_game_storage_v8: {
          puzzles: { 'prod-1': { data: new Uint8Array(256) }, 'orphan-1': { data: new Uint8Array(256) } },
          images: {},
        },
      },
      exposeDatabasesApi: true,
    });
    globalThis.localStorage = d4Ls;
    globalThis.indexedDB = {
      ...d4BaseIdb,
      open(dbName, version) {
        if (dbName === 'capy_game_storage_v8') {
          return {
            result: null,
            error: null,
            transaction: null,
            onupgradeneeded: null,
            onsuccess: null,
            onerror: null,
            onblocked: null,
          };
        }
        return d4BaseIdb.open(dbName, version);
      },
    };
    const d4Res = await analyzerMod.cleanOrphanedSaveData({ ...opts, blockedTimeoutMs: 60 });
    assert.equal(d4Res.deletedIdbRecords, 0);
    assert.equal(d4Res.deletedLocalKeys, 1, 'Healthy quarantine key must still be cleaned when IDB is busy');
    assert.equal(
      d4Res.warnings.some((w) => w.includes('busy in another tab')),
      true,
      `Expected busy-tab warning on active DB open timeout (got ${JSON.stringify(d4Res.warnings)})`
    );

    // 21c (D5): clearAllCapyStorage when sibling alpha pre-measurement open() hangs but deleteDatabase succeeds counts both DBs
    await resetCachedHandles();
    const d5Ls = createMockLocalStorage({
      capy_snapshots_v8: JSON.stringify([{ id: 'prod-1', title: 'Prod 1' }]),
    });
    const d5BaseIdb = createMockIndexedDb({
      initialDbs: {
        capy_game_storage_v8: {
          puzzles: { 'prod-1': { data: new Uint8Array(256) } },
          images: {},
        },
        capy_game_storage_v8_alpha: {
          puzzles: { 'alpha-1': { data: new Uint8Array(512) } },
          images: {},
        },
      },
      exposeDatabasesApi: true,
    });
    globalThis.localStorage = d5Ls;
    globalThis.indexedDB = {
      ...d5BaseIdb,
      open(dbName, version) {
        if (dbName === 'capy_game_storage_v8_alpha') {
          return {
            result: null,
            error: null,
            transaction: null,
            onupgradeneeded: null,
            onsuccess: null,
            onerror: null,
            onblocked: null,
          };
        }
        return d5BaseIdb.open(dbName, version);
      },
    };
    const d5Res = await analyzerMod.clearAllCapyStorage({ ...opts, blockedTimeoutMs: 60 });
    assert.equal(
      d5Res.deletedIdbDatabases,
      2,
      `Expected deletedIdbDatabases=2 even when sibling alpha pre-measure timed out (got ${d5Res.deletedIdbDatabases})`
    );
    assert.equal(d5BaseIdb._hasDb('capy_game_storage_v8_alpha'), false);

    // 22. computeOrphanedKeys: liveLayerImageKeysByPuzzle exemption & orphaned layer_* detection (Record & Map)
    const sec22SnapshotsJson = JSON.stringify([
      { id: 'snap-live', title: 'Live', sourceRef: { kind: 'blob', uri: 'snap-live' } },
    ]);
    const sec22ActiveJson = JSON.stringify({ activeSnapshotId: 'snap-active' });
    const sec22PuzzleKeys = ['snap-live', 'snap-active', 'snap-orphan'];
    const sec22ImageKeys = [
      'snap-live',
      'layer_snap-live_detail1',
      'layer_snap-live_border1',
      'layer_snap-active_detail1',
      'layer_shared_detail',
      'layer_snap-live_stale',
      'layer_snap-orphan_detail1',
      'preview_snap-live',
      'preview_snap-orphan',
    ];
    const sec22RecordMap = {
      'snap-live': ['layer_snap-live_detail1', 'layer_snap-live_border1', 'layer_shared_detail', ''],
      'snap-active': ['layer_snap-active_detail1'],
      'snap-orphan': ['layer_snap-orphan_detail1', 'layer_shared_detail'],
    };
    const sec22FromRecord = analyzerMod.computeOrphanedKeys({
      rawSnapshotsJson: sec22SnapshotsJson,
      rawActiveStateJson: sec22ActiveJson,
      puzzleKeys: sec22PuzzleKeys,
      imageKeys: sec22ImageKeys,
      liveLayerImageKeysByPuzzle: sec22RecordMap,
    });
    assert.equal(sec22FromRecord.skipped, false);
    assert.deepEqual(sec22FromRecord.orphanedPuzzleKeys, ['snap-orphan']);
    assert.deepEqual(
      [...sec22FromRecord.orphanedImageKeys].sort(),
      ['layer_snap-live_stale', 'layer_snap-orphan_detail1', 'preview_snap-orphan']
    );

    const sec22FromMap = analyzerMod.computeOrphanedKeys({
      rawSnapshotsJson: sec22SnapshotsJson,
      rawActiveStateJson: sec22ActiveJson,
      puzzleKeys: sec22PuzzleKeys,
      imageKeys: sec22ImageKeys,
      liveLayerImageKeysByPuzzle: new Map(Object.entries(sec22RecordMap)),
    });
    assert.equal(sec22FromMap.skipped, false);
    assert.deepEqual(sec22FromMap.orphanedPuzzleKeys, sec22FromRecord.orphanedPuzzleKeys);
    assert.deepEqual(
      [...sec22FromMap.orphanedImageKeys].sort(),
      [...sec22FromRecord.orphanedImageKeys].sort()
    );

    // 23. End-to-end analyzeBrowserStorage + cleanOrphanedSaveData + clearAllCapyStorage with nestedLayers & BYOK key
    await resetCachedHandles();
    const sec23Ls = createMockLocalStorage({
      capy_snapshots_v8: JSON.stringify([
        { id: 'live-zoom-1', title: 'Live Zoom', sourceRef: { kind: 'blob', uri: 'live-zoom-1' } },
      ]),
      capy_gemini_byok_key_v1: 'AIza-local-test-key',
    });
    const sec23Idb = createMockIndexedDb({
      initialDbs: {
        capy_game_storage_v8: {
          puzzles: {
            'live-zoom-1': {
              __capyCompactV2: 2,
              rleRegionMap: new Uint8Array(600),
              nestedLayers: [
                { layerId: 'd1', imageBlobKey: 'layer_live-zoom-1_d1' },
                { layerId: 'shared', imageBlobKey: 'layer_shared_1' },
              ],
            },
            'orphan-zoom-2': {
              __capyCompactV2: 2,
              rleRegionMap: new Uint8Array(400),
              nestedLayers: [
                { layerId: 'd2', imageBlobKey: 'layer_orphan-zoom-2_d2' },
                { layerId: 'shared', imageBlobKey: 'layer_shared_1' },
              ],
            },
          },
          images: {
            'live-zoom-1': new Blob([new Uint8Array(1000)], { type: 'image/png' }),
            'preview_live-zoom-1': 'data:image/webp;base64,AAAA',
            'layer_live-zoom-1_d1': new Blob([new Uint8Array(2000)], { type: 'image/png' }),
            'layer_shared_1': new Blob([new Uint8Array(1500)], { type: 'image/png' }),
            'layer_live-zoom-1_stale': new Blob([new Uint8Array(1200)], { type: 'image/png' }),
            'layer_orphan-zoom-2_d2': new Blob([new Uint8Array(1800)], { type: 'image/png' }),
          },
        },
      },
      exposeDatabasesApi: true,
    });
    globalThis.localStorage = sec23Ls;
    globalThis.indexedDB = sec23Idb;
    globalThis.caches = createMockCacheStorage({});
    globalThis.window = {
      location: { pathname: '/capy/', origin: 'https://example.github.io', search: '' },
    };

    const sec23Report = await analyzerMod.analyzeBrowserStorage(opts);
    const sec23Db = sec23Report.indexedDb.activeDb;
    assert.ok(sec23Db, 'Expected active DB report in Section 23');
    assert.equal(sec23Db.orphanDetectionSkipped, false);
    assert.equal(sec23Db.previewsCount, 1);
    assert.equal(sec23Db.imagesCount, 5, 'layer_* blobs must count under imagesCount, not previewsCount');
    assert.deepEqual(sec23Db.orphanedPuzzleKeys, ['orphan-zoom-2']);
    assert.deepEqual(
      [...sec23Db.orphanedImageKeys].sort(),
      ['layer_live-zoom-1_stale', 'layer_orphan-zoom-2_d2']
    );
    assert.equal(sec23Db.orphanedCount, 3);
    assert.ok(
      sec23Db.orphanedBytes >= 400 + 1200 + 1800,
      `Expected orphanedBytes >= 3400, got ${sec23Db.orphanedBytes}`
    );

    const sec23Clean = await analyzerMod.cleanOrphanedSaveData(opts);
    assert.equal(sec23Clean.deletedIdbRecords, 3);
    assert.deepEqual(sec23Idb._getStoreKeys('capy_game_storage_v8', 'puzzles'), ['live-zoom-1']);
    assert.deepEqual(
      sec23Idb._getStoreKeys('capy_game_storage_v8', 'images').sort(),
      ['layer_live-zoom-1_d1', 'layer_shared_1', 'live-zoom-1', 'preview_live-zoom-1']
    );
    assert.equal(
      sec23Ls.getItem('capy_gemini_byok_key_v1'),
      'AIza-local-test-key',
      'Orphan cleanup must preserve device-local BYOK API key'
    );

    await analyzerMod.clearAllCapyStorage(opts);
    assert.equal(
      sec23Ls.getItem('capy_gemini_byok_key_v1'),
      null,
      'clearAllCapyStorage must wipe device-local BYOK API key'
    );

    // 24. Fail-closed orphanDetectionSkipped: true on IDB cursor, transaction & getAllKeys() fallback errors
    const makeSec24Fixture = () => {
      const ls = createMockLocalStorage({
        capy_snapshots_v8: JSON.stringify([
          { id: 'live-1', title: 'Live', sourceRef: { kind: 'blob', uri: 'live-1' } },
        ]),
      });
      const baseIdb = createMockIndexedDb({
        initialDbs: {
          capy_game_storage_v8: {
            puzzles: {
              'live-1': {
                __capyCompactV2: 2,
                rleRegionMap: new Uint8Array(200),
                nestedLayers: [{ layerId: 'd1', imageBlobKey: 'layer_live-1_d1' }],
              },
              'orphan-p1': { __capyCompactV2: 2, rleRegionMap: new Uint8Array(200) },
            },
            images: {
              'live-1': new Blob([new Uint8Array(300)], { type: 'image/png' }),
              'layer_live-1_d1': new Blob([new Uint8Array(400)], { type: 'image/png' }),
              'layer_live-1_stale': new Blob([new Uint8Array(500)], { type: 'image/png' }),
            },
          },
        },
        exposeDatabasesApi: true,
      });
      return { ls, baseIdb };
    };

    // Helper that cleanly intercepts db.transaction on opened mock handles
    const createWrappedIdb = (baseIdb, wrapTxFactory) => ({
      ...baseIdb,
      open(dbName, version) {
        const innerReq = baseIdb.open(dbName, version);
        const outerReq = {
          result: null,
          error: null,
          transaction: null,
          onupgradeneeded: null,
          onsuccess: null,
          onerror: null,
          onblocked: null,
        };
        innerReq.onupgradeneeded = (ev) => {
          outerReq.result = innerReq.result;
          outerReq.transaction = innerReq.transaction;
          if (outerReq.onupgradeneeded) outerReq.onupgradeneeded(ev);
        };
        innerReq.onsuccess = () => {
          const rawDb = innerReq.result;
          const wrappedDb = {
            ...rawDb,
            objectStoreNames: rawDb.objectStoreNames,
            close: () => rawDb.close(),
            createObjectStore: (...a) => rawDb.createObjectStore(...a),
            transaction(storeNames, mode) {
              return wrapTxFactory(rawDb, storeNames, mode);
            },
          };
          outerReq.result = wrappedDb;
          if (outerReq.onsuccess) outerReq.onsuccess({ target: outerReq });
        };
        innerReq.onerror = (ev) => {
          outerReq.error = innerReq.error;
          if (outerReq.onerror) outerReq.onerror(ev);
        };
        innerReq.onblocked = (ev) => {
          if (outerReq.onblocked) outerReq.onblocked(ev);
        };
        return outerReq;
      },
    });

    // 24a: STORE_PUZZLES openCursor fires onerror -> fail-closed
    {
      await resetCachedHandles();
      const { ls, baseIdb } = makeSec24Fixture();
      globalThis.localStorage = ls;
      globalThis.indexedDB = createWrappedIdb(baseIdb, (rawDb, storeNames, mode) => {
        const tx = rawDb.transaction(storeNames, mode);
        const origObjectStore = tx.objectStore.bind(tx);
        tx.objectStore = (storeName) => {
          const st = origObjectStore(storeName);
          if (storeName === 'puzzles' && mode === 'readonly') {
            return {
              ...st,
              openCursor() {
                const req = { result: null, error: new Error('cursor-puzzles-fail'), onsuccess: null, onerror: null };
                queueMicrotask(() => {
                  if (req.onerror) req.onerror({ target: req });
                });
                return req;
              },
            };
          }
          return st;
        };
        return tx;
      });
      const r24a = await analyzerMod.analyzeBrowserStorage(opts);
      const db24a = r24a.indexedDb.activeDb;
      assert.equal(db24a.orphanDetectionSkipped, true);
      assert.equal(db24a.orphanedCount, 0);
      assert.equal(db24a.orphanedBytes, 0);
      assert.deepEqual(db24a.orphanedImageKeys, []);
      const c24a = await analyzerMod.cleanOrphanedSaveData(opts);
      assert.equal(c24a.deletedIdbRecords, 0);
      assert.equal(
        c24a.warnings.some((w) => w.includes('Skipped IDB orphan cleanup')),
        true
      );
      assert.deepEqual(baseIdb._getStoreKeys('capy_game_storage_v8', 'puzzles').sort(), ['live-1', 'orphan-p1']);
      assert.deepEqual(
        baseIdb._getStoreKeys('capy_game_storage_v8', 'images').sort(),
        ['layer_live-1_d1', 'layer_live-1_stale', 'live-1']
      );
    }

    // 24b: STORE_IMAGES openCursor fires onerror -> fail-closed
    {
      await resetCachedHandles();
      const { ls, baseIdb } = makeSec24Fixture();
      globalThis.localStorage = ls;
      globalThis.indexedDB = createWrappedIdb(baseIdb, (rawDb, storeNames, mode) => {
        const tx = rawDb.transaction(storeNames, mode);
        const origObjectStore = tx.objectStore.bind(tx);
        tx.objectStore = (storeName) => {
          const st = origObjectStore(storeName);
          if (storeName === 'images' && mode === 'readonly') {
            return {
              ...st,
              openCursor() {
                const req = { result: null, error: new Error('cursor-images-fail'), onsuccess: null, onerror: null };
                queueMicrotask(() => {
                  if (req.onerror) req.onerror({ target: req });
                });
                return req;
              },
            };
          }
          return st;
        };
        return tx;
      });
      const r24b = await analyzerMod.analyzeBrowserStorage(opts);
      const db24b = r24b.indexedDb.activeDb;
      assert.equal(db24b.orphanDetectionSkipped, true);
      assert.equal(db24b.orphanedCount, 0);
      const c24b = await analyzerMod.cleanOrphanedSaveData(opts);
      assert.equal(c24b.deletedIdbRecords, 0);
      assert.deepEqual(
        baseIdb._getStoreKeys('capy_game_storage_v8', 'images').sort(),
        ['layer_live-1_d1', 'layer_live-1_stale', 'live-1']
      );
    }

    // 24c: STORE_PUZZLES transaction() throws -> fail-closed
    {
      await resetCachedHandles();
      const { ls, baseIdb } = makeSec24Fixture();
      globalThis.localStorage = ls;
      globalThis.indexedDB = createWrappedIdb(baseIdb, (rawDb, storeNames, mode) => {
        if (storeNames === 'puzzles' && mode === 'readonly') {
          throw new Error('tx-puzzles-throw');
        }
        return rawDb.transaction(storeNames, mode);
      });
      const r24c = await analyzerMod.analyzeBrowserStorage(opts);
      const db24c = r24c.indexedDb.activeDb;
      assert.equal(db24c.orphanDetectionSkipped, true);
      assert.equal(db24c.orphanedCount, 0);
      const c24c = await analyzerMod.cleanOrphanedSaveData(opts);
      assert.equal(c24c.deletedIdbRecords, 0);
    }

    // 24d: getAllKeys() fallback path (no openCursor) — happy path & getReq.onerror fail-closed
    {
      await resetCachedHandles();
      const { ls, baseIdb } = makeSec24Fixture();
      let failPuzzleKey = null;
      globalThis.localStorage = ls;
      globalThis.indexedDB = createWrappedIdb(baseIdb, (rawDb, storeNames, mode) => {
        const tx = rawDb.transaction(storeNames, mode);
        const origObjectStore = tx.objectStore.bind(tx);
        tx.objectStore = (storeName) => {
          const st = origObjectStore(storeName);
          if (mode !== 'readonly') return st;
          const keys = baseIdb._getStoreKeys('capy_game_storage_v8', storeName);
          return {
            get(key) {
              if (storeName === 'puzzles' && failPuzzleKey && key === failPuzzleKey) {
                const req = { result: undefined, error: new Error('get-fail'), onsuccess: null, onerror: null };
                queueMicrotask(() => {
                  if (req.onerror) req.onerror({ target: req });
                });
                return req;
              }
              return st.get(key);
            },
            getAllKeys() {
              const req = { result: [...keys], error: null, onsuccess: null, onerror: null };
              queueMicrotask(() => {
                if (req.onsuccess) req.onsuccess({ target: req });
              });
              return req;
            },
          };
        };
        return tx;
      });

      const r24dOk = await analyzerMod.analyzeBrowserStorage(opts);
      const db24dOk = r24dOk.indexedDb.activeDb;
      assert.equal(db24dOk.orphanDetectionSkipped, false);
      assert.deepEqual(db24dOk.orphanedPuzzleKeys, ['orphan-p1']);
      assert.deepEqual(
        db24dOk.orphanedImageKeys,
        ['layer_live-1_stale'],
        'getAllKeys() fallback must exempt live layer_live-1_d1 while flagging layer_live-1_stale'
      );

      failPuzzleKey = 'live-1';
      const r24dErr = await analyzerMod.analyzeBrowserStorage(opts);
      const db24dErr = r24dErr.indexedDb.activeDb;
      assert.equal(db24dErr.orphanDetectionSkipped, true);
      assert.equal(db24dErr.orphanedCount, 0);
      const c24dErr = await analyzerMod.cleanOrphanedSaveData(opts);
      assert.equal(c24dErr.deletedIdbRecords, 0);
    }

    // 25. IndexedDbStore (collectReferencedLayerImageKeysStrict, deleteSnapshotEntries) & SnapshotStorage.deleteSnapshot
    // 25a: collectReferencedLayerImageKeysStrict happy path, dedup, empty, & fail-closed error
    {
      await resetCachedHandles();
      const emptyRes = await idbMod.collectReferencedLayerImageKeysStrict([]);
      assert.equal(emptyRes.ok, true);
      assert.equal(emptyRes.keys.size, 0);
      assert.equal(emptyRes.targetKeys.size, 0);

      const idb25a = createMockIndexedDb({
        initialDbs: {
          capy_game_storage_v8: {
            puzzles: {
              s1: {
                nestedLayers: [
                  { layerId: 'a', imageBlobKey: 'layer_s1_a' },
                  { layerId: 'b', imageBlobKey: 'layer_s1_b' },
                ],
              },
              s2: { rleRegionMap: new Uint8Array(8) },
            },
            images: {},
          },
        },
      });
      globalThis.indexedDB = idb25a;
      const read25a = await idbMod.collectReferencedLayerImageKeysStrict(['s1', 's1', 's2', '']);
      assert.equal(read25a.ok, true);
      assert.deepEqual([...read25a.keys].sort(), ['layer_s1_a', 'layer_s1_b']);
      assert.deepEqual(read25a.targetKeys.get('s1'), ['layer_s1_a', 'layer_s1_b']);
      assert.equal(read25a.targetKeys.has('s2'), false);

      await resetCachedHandles();
      globalThis.indexedDB = createWrappedIdb(idb25a, (rawDb, storeNames, mode) => {
        const tx = rawDb.transaction(storeNames, mode);
        const origObjectStore = tx.objectStore.bind(tx);
        tx.objectStore = (storeName) => {
          const st = origObjectStore(storeName);
          return {
            ...st,
            get() {
              const req = { result: undefined, error: new Error('read-err'), onsuccess: null, onerror: null };
              queueMicrotask(() => {
                if (req.onerror) req.onerror({ target: req });
              });
              return req;
            },
          };
        };
        return tx;
      });
      const fail25a = await idbMod.collectReferencedLayerImageKeysStrict(['s1']);
      assert.equal(fail25a.ok, false);
      assert.equal(fail25a.keys.size, 0);
      assert.equal(fail25a.targetKeys.size, 0);
    }

    // 25b: deleteSnapshotEntries preserveRootImageKey & preservePreviewKey flags
    {
      await resetCachedHandles();
      const idb25b = createMockIndexedDb({
        initialDbs: {
          capy_game_storage_v8: {
            puzzles: { s1: { rleRegionMap: new Uint8Array(8) } },
            images: {
              s1: new Blob([new Uint8Array(10)]),
              preview_s1: 'data:image/webp;base64,AA==',
              layer_s1_a: new Blob([new Uint8Array(20)]),
            },
          },
        },
      });
      globalThis.indexedDB = idb25b;
      await idbMod.deleteSnapshotEntries('s1', ['s1', 'preview_s1', 'layer_s1_a'], {
        preserveRootImageKey: true,
        preservePreviewKey: true,
      });
      assert.deepEqual(idb25b._getStoreKeys('capy_game_storage_v8', 'puzzles'), []);
      assert.deepEqual(
        idb25b._getStoreKeys('capy_game_storage_v8', 'images').sort(),
        ['preview_s1', 's1']
      );
    }

    // 25c: SnapshotStorage.deleteSnapshot happy path + non-layer_ smuggling guard + shared layer preservation
    {
      await resetCachedHandles();
      const ls25c = createMockLocalStorage({
        capy_snapshots_v8: JSON.stringify([
          { id: 'target', title: 'Target', sourceRef: { kind: 'blob', uri: 'target' }, createdAt: 1, updatedAt: 1 },
          { id: 'survivor', title: 'Survivor', sourceRef: { kind: 'blob', uri: 'survivor' }, createdAt: 1, updatedAt: 1 },
        ]),
      });
      const idb25c = createMockIndexedDb({
        initialDbs: {
          capy_game_storage_v8: {
            puzzles: {
              target: {
                nestedLayers: [
                  { layerId: 'only', imageBlobKey: 'layer_target_only' },
                  { layerId: 'shared', imageBlobKey: 'layer_shared' },
                  { layerId: 'smug1', imageBlobKey: 'survivor' },
                  { layerId: 'smug2', imageBlobKey: 'preview_survivor' },
                  { layerId: 'smug3', imageBlobKey: 'custom_non_layer_key' },
                ],
              },
              survivor: {
                nestedLayers: [{ layerId: 'shared', imageBlobKey: 'layer_shared' }],
              },
            },
            images: {
              target: new Blob([new Uint8Array(10)]),
              preview_target: 'data:image/webp;base64,AA==',
              layer_target_only: new Blob([new Uint8Array(10)]),
              layer_shared: new Blob([new Uint8Array(10)]),
              survivor: new Blob([new Uint8Array(10)]),
              preview_survivor: 'data:image/webp;base64,BB==',
              custom_non_layer_key: new Blob([new Uint8Array(10)]),
            },
          },
        },
      });
      globalThis.localStorage = ls25c;
      globalThis.indexedDB = idb25c;
      await snapshotMod.deleteSnapshot('target', { skipTombstone: true });
      assert.deepEqual(idb25c._getStoreKeys('capy_game_storage_v8', 'puzzles'), ['survivor']);
      assert.deepEqual(
        idb25c._getStoreKeys('capy_game_storage_v8', 'images').sort(),
        ['custom_non_layer_key', 'layer_shared', 'preview_survivor', 'survivor'],
        'deleteSnapshot must delete target layer_target_only while preserving shared layer_shared and all non-layer_ keys'
      );
    }

    // 25d: SnapshotStorage.deleteSnapshot fail-closed when survivingRead.ok === false
    {
      await resetCachedHandles();
      const ls25d = createMockLocalStorage({
        capy_snapshots_v8: JSON.stringify([
          { id: 'target-fc', title: 'Target FC', sourceRef: { kind: 'blob', uri: 'target-fc' }, createdAt: 1, updatedAt: 1 },
          { id: 'survivor-fc', title: 'Survivor FC', sourceRef: { kind: 'blob', uri: 'survivor-fc' }, createdAt: 1, updatedAt: 1 },
        ]),
      });
      const idb25d = createMockIndexedDb({
        initialDbs: {
          capy_game_storage_v8: {
            puzzles: {
              'target-fc': {
                nestedLayers: [
                  { layerId: 'd1', imageBlobKey: 'layer_target-fc_d1' },
                  { layerId: 'sh', imageBlobKey: 'layer_shared-fc' },
                ],
              },
              'survivor-fc': {
                nestedLayers: [{ layerId: 'sh', imageBlobKey: 'layer_shared-fc' }],
              },
            },
            images: {
              'target-fc': new Blob([new Uint8Array(10)]),
              'preview_target-fc': 'data:image/webp;base64,AA==',
              'layer_target-fc_d1': new Blob([new Uint8Array(10)]),
              'layer_shared-fc': new Blob([new Uint8Array(10)]),
              'survivor-fc': new Blob([new Uint8Array(10)]),
            },
          },
        },
      });
      globalThis.localStorage = ls25d;
      globalThis.indexedDB = createWrappedIdb(idb25d, (rawDb, storeNames, mode) => {
        const tx = rawDb.transaction(storeNames, mode);
        const origObjectStore = tx.objectStore.bind(tx);
        tx.objectStore = (storeName) => {
          const st = origObjectStore(storeName);
          if (storeName === 'puzzles' && mode === 'readonly') {
            return {
              ...st,
              get(key) {
                if (key === 'survivor-fc') {
                  const req = { result: undefined, error: new Error('survivor-read-fail'), onsuccess: null, onerror: null };
                  queueMicrotask(() => {
                    if (req.onerror) req.onerror({ target: req });
                  });
                  return req;
                }
                return st.get(key);
              },
            };
          }
          return st;
        };
        return tx;
      });
      await snapshotMod.deleteSnapshot('target-fc', { skipTombstone: true });
      assert.deepEqual(idb25d._getStoreKeys('capy_game_storage_v8', 'puzzles'), ['survivor-fc']);
      const remaining25dImages = idb25d._getStoreKeys('capy_game_storage_v8', 'images');
      assert.equal(
        remaining25dImages.includes('layer_target-fc_d1'),
        true,
        'Fail-closed survivingRead.ok === false must NOT delete layer_target-fc_d1'
      );
      assert.equal(
        remaining25dImages.includes('layer_shared-fc'),
        true,
        'Fail-closed survivingRead.ok === false must NOT delete layer_shared-fc'
      );
      assert.equal(remaining25dImages.includes('survivor-fc'), true);
    }
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
