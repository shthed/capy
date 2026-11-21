import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, '..');
const srcRoot = path.join(webRoot, 'src');

function walkTsFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTsFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function stripJsComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

function createMemoryLocalStorage(options = {}) {
  const map = new Map();
  return {
    _map: map,
    getItem(k) {
      if (options.throwOnGet) throw options.throwOnGet;
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      if (options.throwOnSet) throw options.throwOnSet;
      map.set(k, String(v));
    },
    removeItem(k) {
      if (options.throwOnRemove) throw options.throwOnRemove;
      map.delete(k);
    },
    clear() {
      map.clear();
    },
  };
}

function createMockIndexedDb(behavior = {}) {
  const stores = {
    puzzles: new Map(),
    images: new Map(),
  };
  let openCount = 0;
  let closedHandles = 0;

  const makeDbHandle = (handleIndex) => {
    const handle = {
      objectStoreNames: {
        contains: (name) => name === 'puzzles' || name === 'images',
      },
      createObjectStore: () => {},
      onversionchange: null,
      onclose: null,
      close() {
        closedHandles += 1;
        if (behavior.fireOnCloseOnClose && typeof handle.onclose === 'function') {
          handle.onclose();
        }
      },
      transaction(storeNames, mode) {
        if (behavior.throwInvalidStateOnHandle === handleIndex) {
          const err = new Error('The database connection is closing.');
          err.name = 'InvalidStateError';
          throw err;
        }

        const tx = {
          error: null,
          oncomplete: null,
          onerror: null,
          onabort: null,
          objectStore(storeName) {
            const map = stores[storeName] || new Map();
            stores[storeName] = map;
            return {
              put(value, key) {
                const req = { result: key, error: null, onsuccess: null, onerror: null };
                if (behavior.failWriteWithError) {
                  if (behavior.bubbleRequestErrorOnTx) {
                    req.error = behavior.failWriteWithError;
                    tx.error = null;
                    queueMicrotask(() => {
                      if (tx.onerror) tx.onerror({ target: req });
                      tx.error = behavior.failWriteWithError;
                      if (tx.onabort) tx.onabort({ target: tx });
                    });
                  } else {
                    tx.error = behavior.failWriteWithError;
                    queueMicrotask(() => {
                      if (tx.onabort) tx.onabort();
                      else if (tx.onerror) tx.onerror();
                    });
                  }
                } else {
                  map.set(key, value);
                }
                return req;
              },
              get(key) {
                const req = { result: undefined, error: null, onsuccess: null, onerror: null };
                queueMicrotask(() => {
                  req.result = map.has(key) ? map.get(key) : undefined;
                  if (req.onsuccess) req.onsuccess();
                });
                return req;
              },
              delete(key) {
                map.delete(key);
                return { onsuccess: null, onerror: null };
              },
              clear() {
                map.clear();
                return { onsuccess: null, onerror: null };
              },
            };
          },
        };

        if (mode === 'readwrite' && !behavior.failWriteWithError) {
          queueMicrotask(() => {
            if (tx.oncomplete) tx.oncomplete();
          });
        }
        return tx;
      },
    };
    return handle;
  };

  const mockIndexedDb = {
    open(_dbName, _version) {
      openCount += 1;
      const idx = openCount;
      const req = {
        result: makeDbHandle(idx),
        error: null,
        onupgradeneeded: null,
        onblocked: null,
        onsuccess: null,
        onerror: null,
      };
      queueMicrotask(() => {
        if (req.onsuccess) req.onsuccess();
      });
      return req;
    },
  };

  return {
    mockIndexedDb,
    stores,
    getOpenCount: () => openCount,
    getClosedHandles: () => closedHandles,
  };
}

function makeMiniPuzzle(width = 4, height = 4) {
  const total = width * height;
  const regionMap = new Int32Array(total);
  regionMap.fill(1, 0, Math.floor(total / 2));
  regionMap.fill(2, Math.floor(total / 2));
  const borderMap = new Uint8Array(total);
  return {
    width,
    height,
    palette: [
      { id: 1, hex: '#ff0000', isLight: false, argb: 0xffff0000, r: 255, g: 0, b: 0 },
      { id: 2, hex: '#00ff00', isLight: true, argb: 0xff00ff00, r: 0, g: 255, b: 0 },
    ],
    regionMap,
    borderMap,
    regions: [
      {
        id: 1,
        colorId: 1,
        centroidX: 1,
        centroidY: 1,
        area: Math.floor(total / 2),
        minX: 0,
        maxX: width - 1,
        minY: 0,
        maxY: 1,
        maxRadius: 1,
        pixels: Int32Array.from({ length: Math.floor(total / 2) }, (_, i) => i),
      },
      {
        id: 2,
        colorId: 2,
        centroidX: 2,
        centroidY: 2,
        area: total - Math.floor(total / 2),
        minX: 0,
        maxX: width - 1,
        minY: 2,
        maxY: height - 1,
        maxRadius: 1,
        pixels: Int32Array.from(
          { length: total - Math.floor(total / 2) },
          (_, i) => i + Math.floor(total / 2)
        ),
      },
    ],
  };
}

function makeSnapshot(id, overrides = {}) {
  const now = Date.now();
  return {
    id,
    title: `Test Puzzle ${id}`,
    timestamp: now,
    lastOpened: now,
    filledCount: 0,
    totalCount: 2,
    filledRegionIds: [],
    zoomScale: 1,
    panOffsetX: 0,
    panOffsetY: 0,
    ...overrides,
  };
}

export async function runStorageGatewayTests(vite) {
  console.log('[Unit] Stage 2 Storage Gateway & Durability Tests (Issue #582)...');

  // 1. Static source check: zero direct localStorage references outside allowlist
  {
    const allowlist = new Set([
      'services/storage/SafeLocalStore.ts',
      'services/StorageNamespace.ts',
      'utils/debugEnvironment.ts',
    ]);
    const files = walkTsFiles(srcRoot);
    const violations = [];
    for (const file of files) {
      const rel = path.relative(srcRoot, file).replace(/\\/g, '/');
      if (allowlist.has(rel)) continue;
      const stripped = stripJsComments(fs.readFileSync(file, 'utf8'));
      if (/\blocalStorage\b/.test(stripped)) {
        violations.push(rel);
      }
    }
    assert.deepEqual(
      violations,
      [],
      `Direct localStorage usage found outside allowlist: ${violations.join(', ')}`
    );
  }

  const prevLs = globalThis.localStorage;
  const prevIdb = globalThis.indexedDB;
  const prevWin = globalThis.window;

  try {
    const telemetryMod = await vite.ssrLoadModule('/src/services/telemetry.ts');
    const safeStoreMod = await vite.ssrLoadModule('/src/services/storage/SafeLocalStore.ts');
    const keysMod = await vite.ssrLoadModule('/src/services/storage/StorageKeys.ts');
    const idbMod = await vite.ssrLoadModule('/src/services/storage/IndexedDbStore.ts');
    const serializerMod = await vite.ssrLoadModule('/src/services/storage/PuzzleSerializer.ts');
    const codecMod = await vite.ssrLoadModule('/src/services/CapyCodec.ts');
    const statsMod = await vite.ssrLoadModule('/src/services/PlayerStatsService.ts');
    const storageMod = await vite.ssrLoadModule('/src/services/StorageService.ts');

    // 2. SafeLocalStore + StorageKeys happy paths, error swallowing, quota detection
    {
      telemetryMod.clearSwallowedErrorLog();
      globalThis.localStorage = createMemoryLocalStorage();
      assert.equal(safeStoreMod.SafeLocalStore.hasLocalStorage(), true);
      assert.equal(safeStoreMod.SafeLocalStore.setScopedItem(keysMod.SAVES_VIEW_MODE_KEY, 'DETAIL'), true);
      assert.equal(safeStoreMod.SafeLocalStore.getScopedItem(keysMod.SAVES_VIEW_MODE_KEY), 'DETAIL');
      assert.equal(safeStoreMod.SafeLocalStore.removeScopedItem(keysMod.SAVES_VIEW_MODE_KEY), true);
      assert.equal(safeStoreMod.SafeLocalStore.getScopedItem(keysMod.SAVES_VIEW_MODE_KEY), null);

      const quotaErr = Object.assign(new Error('Storage quota exceeded'), { name: 'QuotaExceededError' });
      assert.equal(safeStoreMod.isQuotaError(quotaErr), true);
      assert.equal(safeStoreMod.isQuotaError(new Error('ordinary error')), false);

      const warnings = [];
      const unsub = safeStoreMod.onQuotaWarning((w) => warnings.push(w));
      globalThis.localStorage = createMemoryLocalStorage({ throwOnSet: quotaErr });
      const ok = safeStoreMod.SafeLocalStore.setItem('test_quota_key', 'val', { notifyQuota: true });
      unsub();
      assert.equal(ok, false);
      assert.equal(warnings.length, 1);
      assert.equal(warnings[0].key, 'test_quota_key');
      const swallowed = telemetryMod.getSwallowedErrorLog();
      assert.equal(
        swallowed.some((entry) => entry.scope === 'SafeLocalStore.setItem'),
        true,
        'SafeLocalStore.setItem failure must record to swallowed error ring'
      );
    }

    // 3. IndexedDbStore P0 quota failure: notifyQuotaWarning + reject + importSnapshotData aborts before localStorage commit
    {
      telemetryMod.clearSwallowedErrorLog();
      const memLs = createMemoryLocalStorage();
      globalThis.localStorage = memLs;
      globalThis.window = { location: { pathname: '/', search: '' } };

      const quotaErr = Object.assign(new Error('IDB quota exceeded'), { name: 'QuotaExceededError' });
      const { mockIndexedDb } = createMockIndexedDb({ failWriteWithError: quotaErr });
      globalThis.indexedDB = mockIndexedDb;
      idbMod.evictDbHandle(keysMod.resolveScopedDbName());

      const warnings = [];
      const unsub = storageMod.StorageService.onQuotaWarning((w) => warnings.push(w));

      const puzzle = makeMiniPuzzle();
      await assert.rejects(
        () => idbMod.savePuzzleData('p-quota-1', puzzle),
        (err) => err === quotaErr
      );
      await assert.rejects(
        () => idbMod.saveImageBlob('p-quota-1', new Blob([new Uint8Array([1, 2, 3])])),
        (err) => err === quotaErr
      );
      await assert.rejects(
        () =>
          idbMod.saveMultipleCompactPuzzleRecords([
            { id: 'p-quota-2', record: codecMod.compressPuzzleRecord(puzzle) },
          ]),
        (err) => err === quotaErr
      );
      assert.equal(warnings.length >= 3, true, 'All three IDB quota failures must emit quota warnings');

      // Now verify importSnapshotData fails closed BEFORE committing localStorage metadata
      const snap = makeSnapshot('snap-quota-abort');
      const compact = codecMod.compressPuzzleRecord(puzzle);
      const binaryBytes = await codecMod.encodeSingleSaveBinaryV2(snap, compact, null, {
        exportDate: Date.now(),
      });
      const importRes = await storageMod.StorageService.importSnapshotData(binaryBytes);
      unsub();

      assert.equal(importRes.importedCount, 0, 'importSnapshotData must abort on IDB quota failure');
      assert.ok(importRes.error, 'importSnapshotData must surface error message');
      assert.equal(
        storageMod.StorageService.loadSnapshots().length,
        0,
        'localStorage snapshots metadata must remain uncommitted when IDB write fails'
      );
    }

    // 3b. Probe 1B regression: W3C bubbling tx.onerror(ev) where tx.error === null & ev.target.error === QuotaExceededError
    {
      globalThis.localStorage = createMemoryLocalStorage();
      globalThis.window = { location: { pathname: '/', search: '' } };
      const bubbleQuotaErr = Object.assign(new Error('The quota has been exceeded.'), {
        name: 'QuotaExceededError',
      });
      const { mockIndexedDb } = createMockIndexedDb({
        failWriteWithError: bubbleQuotaErr,
        bubbleRequestErrorOnTx: true,
      });
      globalThis.indexedDB = mockIndexedDb;
      idbMod.evictDbHandle(keysMod.resolveScopedDbName());

      const warnings = [];
      const unsub = storageMod.StorageService.onQuotaWarning((w) => warnings.push(w));
      const puzzle = makeMiniPuzzle();
      await assert.rejects(
        () => idbMod.savePuzzleData('p-bubble-quota-1', puzzle),
        (err) => err === bubbleQuotaErr
      );
      await assert.rejects(
        () => idbMod.saveImageBlob('p-bubble-quota-1', new Blob([new Uint8Array([1, 2, 3])])),
        (err) => err === bubbleQuotaErr
      );
      await assert.rejects(
        () =>
          idbMod.saveMultipleCompactPuzzleRecords([
            { id: 'p-bubble-quota-2', record: codecMod.compressPuzzleRecord(puzzle) },
          ]),
        (err) => err === bubbleQuotaErr
      );
      unsub();
      assert.equal(
        warnings.length,
        3,
        'Bubbling tx.onerror with tx.error===null must extract ev.target.error and emit quota warnings'
      );
    }

    // 4. IndexedDbStore P0 InvalidStateError handle eviction + single retry on write AND read
    {
      globalThis.localStorage = createMemoryLocalStorage();
      globalThis.window = { location: { pathname: '/', search: '' } };

      // Write retry test: handle #1 throws InvalidStateError -> evicted -> handle #2 succeeds
      const writeMock = createMockIndexedDb({ throwInvalidStateOnHandle: 1 });
      globalThis.indexedDB = writeMock.mockIndexedDb;
      idbMod.evictDbHandle(keysMod.resolveScopedDbName());

      const puzzle = makeMiniPuzzle();
      await idbMod.savePuzzleData('p-retry-write', puzzle);
      assert.equal(writeMock.getOpenCount(), 2, 'Write InvalidStateError must evict handle and reopen DB once');
      assert.equal(writeMock.stores.puzzles.has('p-retry-write'), true);

      // Read retry test: handle #1 throws InvalidStateError on readonly -> evicted -> handle #2 succeeds
      const readMock = createMockIndexedDb({ throwInvalidStateOnHandle: 1 });
      readMock.stores.puzzles.set('p-retry-read', codecMod.compressPuzzleRecord(puzzle));
      globalThis.indexedDB = readMock.mockIndexedDb;
      idbMod.evictDbHandle(keysMod.resolveScopedDbName());

      const loaded = await idbMod.loadPuzzleData('p-retry-read');
      assert.equal(readMock.getOpenCount(), 2, 'Read InvalidStateError must evict handle and reopen DB once');
      assert.ok(loaded, 'Read retry must return puzzle data');
      assert.equal(loaded.width, puzzle.width);
    }

    // 4b. Probe 2C regression: stale db1.onclose after eviction must NOT evict healthy replacement db2
    {
      globalThis.localStorage = createMemoryLocalStorage();
      globalThis.window = { location: { pathname: '/', search: '' } };
      const staleCloseMock = createMockIndexedDb({
        throwInvalidStateOnHandle: 1,
        fireOnCloseOnClose: true,
      });
      globalThis.indexedDB = staleCloseMock.mockIndexedDb;
      idbMod.evictDbHandle(keysMod.resolveScopedDbName());

      const puzzle = makeMiniPuzzle();
      await idbMod.savePuzzleData('p-stale-close-1', puzzle);
      // Flush microtasks so evictDbHandle's deferred db1.close() -> db1.onclose() runs after db2 is cached
      await Promise.resolve();
      await Promise.resolve();
      assert.equal(staleCloseMock.getClosedHandles(), 1, 'Evicted handle #1 must be closed');

      await idbMod.savePuzzleData('p-stale-close-2', puzzle);
      assert.equal(
        staleCloseMock.getOpenCount(),
        2,
        'Stale db1.onclose must not evict replacement handle #2 or force a 3rd open'
      );
      assert.equal(staleCloseMock.stores.puzzles.has('p-stale-close-2'), true);
    }

    // 5. Bounded LRU previewCache eviction behavior
    {
      idbMod.clearScopedPreviewCache();
      const max = idbMod.MAX_PREVIEW_CACHE_ENTRIES;
      assert.equal(max, 128);
      for (let i = 0; i < max; i++) {
        idbMod.setCachedPreview(`lru-${i}`, `data:image/png;base64,${i}`);
      }
      assert.equal(idbMod.getPreviewCacheSize(), max);
      // Promote lru-0 by reading it
      assert.equal(idbMod.getCachedPreview('lru-0'), 'data:image/png;base64,0');
      // Insert one more entry -> lru-1 (oldest unaccessed) should be evicted, lru-0 retained
      idbMod.setCachedPreview('lru-overflow', 'data:image/png;base64,overflow');
      assert.equal(idbMod.getPreviewCacheSize(), max);
      assert.equal(idbMod.getCachedPreview('lru-1'), undefined, 'Oldest unaccessed preview must be evicted');
      assert.equal(idbMod.getCachedPreview('lru-0'), 'data:image/png;base64,0', 'Recently accessed preview must be retained');
      assert.equal(idbMod.getCachedPreview('lru-overflow'), 'data:image/png;base64,overflow');
      idbMod.clearScopedPreviewCache();
    }

    // 6. CapyCodec P0 >16 MB archive round-trip, single save >16 MB rejection & crafted FLAG_ARCHIVE rejection
    {
      assert.equal(codecMod.MAX_BINARY_SAVE_DECOMPRESSED_BYTES, 16 * 1024 * 1024);
      assert.equal(codecMod.MAX_BINARY_ARCHIVE_DECOMPRESSED_BYTES, 256 * 1024 * 1024);

      const puzzle = makeMiniPuzzle();
      const compact = codecMod.compressPuzzleRecord(puzzle);

      // Build an archive whose uncompressed framed size exceeds 16 MB (~18 MB via two 9 MB blobs)
      const blobA = new Blob([new Uint8Array(9 * 1024 * 1024)], { type: 'image/webp' });
      const blobB = new Blob([new Uint8Array(9 * 1024 * 1024)], { type: 'image/webp' });
      const snapA = makeSnapshot('arch-big-a');
      const snapB = makeSnapshot('arch-big-b');

      const archiveBytes = await codecMod.encodeArchiveSaveBinaryV2(
        [snapA, snapB],
        { 'arch-big-a': compact, 'arch-big-b': compact },
        { 'arch-big-a': blobA, 'arch-big-b': blobB },
        { exportDate: 1_700_000_000_000 }
      );
      const decodedArchive = await codecMod.decodeBinarySaveV2(archiveBytes);
      assert.equal(decodedArchive.format, 'capy-archive-save-v2');
      assert.equal(decodedArchive.snapshots.length, 2);
      assert.equal(decodedArchive.images['arch-big-a'].bytes.byteLength, 9 * 1024 * 1024);
      assert.equal(decodedArchive.images['arch-big-b'].bytes.byteLength, 9 * 1024 * 1024);

      // Single save > 16 MB must be rejected at encode time
      const oversizedSingleBlob = new Blob([new Uint8Array(17 * 1024 * 1024)], { type: 'image/webp' });
      await assert.rejects(
        () => codecMod.encodeSingleSaveBinaryV2(snapA, compact, oversizedSingleBlob),
        /exceeds limit/i
      );

      // Crafted single save with FLAG_ARCHIVE bit set in header must be rejected on decode
      const validSingleBytes = await codecMod.encodeSingleSaveBinaryV2(snapA, compact, null, {
        exportDate: 1_700_000_000_000,
      });
      const craftedSingle = new Uint8Array(validSingleBytes);
      craftedSingle[5] |= 1 << 1; // Set FLAG_ARCHIVE on a capy-single-save-v2 payload
      await assert.rejects(
        () => codecMod.decodeBinarySaveV2(craftedSingle),
        /archive flag|size limit/i
      );
    }

    // 7. PuzzleSerializer P1 legacy pixelsB64 bounds checks (cumulative sum > total, index < 0, index >= total)
    {
      const basePuzzle = makeMiniPuzzle(2, 2); // total = 4
      const toB64 = (arr) =>
        codecMod.uint8ToBase64(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength));
      const baseSerialized = {
        encodingVersion: 1,
        width: 2,
        height: 2,
        palette: basePuzzle.palette,
        regionMapB64: toB64(basePuzzle.regionMap),
        borderMapB64: toB64(basePuzzle.borderMap),
        regions: [
          {
            id: 1,
            colorId: 1,
            centroidX: 0,
            centroidY: 0,
            area: 2,
            minX: 0,
            maxX: 1,
            minY: 0,
            maxY: 0,
            maxRadius: 1,
            pixelsB64: toB64(new Int32Array([0, 1])),
          },
          {
            id: 2,
            colorId: 2,
            centroidX: 1,
            centroidY: 1,
            area: 2,
            minX: 0,
            maxX: 1,
            minY: 1,
            maxY: 1,
            maxRadius: 1,
            pixelsB64: toB64(new Int32Array([2, 3])),
          },
        ],
      };

      // Valid legacy pixelsB64 succeeds
      const okPuzzle = serializerMod.deserializePuzzle(baseSerialized);
      assert.equal(okPuzzle.regions[0].pixels.length, 2);
      assert.equal(okPuzzle.regions[1].pixels.length, 2);

      // Cumulative sum > total (3 + 3 = 6 > 4, even though each <= 4) must reject
      const overCumulative = {
        ...baseSerialized,
        regions: [
          { ...baseSerialized.regions[0], pixelsB64: toB64(new Int32Array([0, 1, 2])) },
          { ...baseSerialized.regions[1], pixelsB64: toB64(new Int32Array([1, 2, 3])) },
        ],
      };
      assert.throws(
        () => serializerMod.deserializePuzzle(overCumulative),
        /exceeds puzzle pixel count/i
      );

      // Negative pixel index must reject
      const negativeIndex = {
        ...baseSerialized,
        regions: [
          { ...baseSerialized.regions[0], pixelsB64: toB64(new Int32Array([-1, 0])) },
          baseSerialized.regions[1],
        ],
      };
      assert.throws(
        () => serializerMod.deserializePuzzle(negativeIndex),
        /out of bounds/i
      );

      // Pixel index >= total must reject
      const highIndex = {
        ...baseSerialized,
        regions: [
          { ...baseSerialized.regions[0], pixelsB64: toB64(new Int32Array([0, 4])) },
          baseSerialized.regions[1],
        ],
      };
      assert.throws(
        () => serializerMod.deserializePuzzle(highIndex),
        /out of bounds/i
      );
    }

    // 8. PlayerStatsService.resetStats() clears Android native backup so loadStats() returns zeros
    {
      const nativeBackups = new Map();
      globalThis.localStorage = createMemoryLocalStorage();
      globalThis.window = {
        location: { pathname: '/', search: '' },
        CapyAndroid: {
          saveBackup: (k, data) => {
            nativeBackups.set(k, data);
            return true;
          },
          loadBackup: (k) => (nativeBackups.has(k) ? nativeBackups.get(k) : null),
        },
      };

      statsMod.PlayerStatsService.recordRegionsColored(42, true);
      statsMod.PlayerStatsService.recordPuzzleCompleted({ hintsUsed: 0, activeElapsedMs: 12000 });
      const beforeReset = statsMod.PlayerStatsService.loadStats();
      assert.equal(beforeReset.totalRegionsColored, 42);
      assert.equal(beforeReset.puzzlesCompleted, 1);

      statsMod.PlayerStatsService.resetStats();
      const backupKey = keysMod.resolveScopedBackupKey(statsMod.PLAYER_STATS_STORAGE_KEY);
      assert.equal(
        nativeBackups.get(backupKey),
        JSON.stringify(statsMod.DEFAULT_PLAYER_STATS),
        'resetStats() must overwrite native Android backup with zeroed DEFAULT_PLAYER_STATS'
      );

      // Subsequent loadStats() (even with empty localStorage) must NOT resurrect old stats
      const afterReset = statsMod.PlayerStatsService.loadStats();
      assert.deepEqual(afterReset, statsMod.DEFAULT_PLAYER_STATS);
    }

    // 8b. Probe 5B regression: resetStats() must not resurrect stale native backup if saveBackup returns false
    {
      const nativeBackups = new Map();
      let allowBackupWrite = true;
      globalThis.localStorage = createMemoryLocalStorage();
      globalThis.window = {
        location: { pathname: '/', search: '' },
        CapyAndroid: {
          saveBackup: (k, data) => {
            if (!allowBackupWrite) return false;
            nativeBackups.set(k, data);
            return true;
          },
          loadBackup: (k) => (nativeBackups.has(k) ? nativeBackups.get(k) : null),
        },
      };

      statsMod.PlayerStatsService.recordRegionsColored(77, true);
      assert.equal(statsMod.PlayerStatsService.loadStats().totalRegionsColored, 77);

      allowBackupWrite = false;
      statsMod.PlayerStatsService.resetStats();
      const afterFailedBackupReset = statsMod.PlayerStatsService.loadStats();
      assert.deepEqual(
        afterFailedBackupReset,
        statsMod.DEFAULT_PLAYER_STATS,
        'resetStats() must shadow stale native backup in localStorage when NativeBridge.saveBackup returns false'
      );
    }

    // 9. StorageService thin facade export parity & window.capyStorage gate
    {
      assert.equal(typeof storageMod.DEV_DEBUG_STORAGE_KEY, 'string');
      assert.equal(typeof storageMod.isDebugStorageExposed, 'function');
      assert.equal(typeof storageMod.DEFAULT_SETTINGS, 'object');
      assert.equal(typeof storageMod.StorageService, 'function');
      assert.equal(typeof storageMod.serializePuzzle, 'function');
      assert.equal(typeof storageMod.deserializePuzzle, 'function');

      // Verify writable static methods (monkey-patchable by E2E/unit tests)
      const origExport = storageMod.StorageService.exportAllSnapshotsBinary;
      storageMod.StorageService.exportAllSnapshotsBinary = async () => new Uint8Array([1, 2, 3]);
      assert.deepEqual(
        await storageMod.StorageService.exportAllSnapshotsBinary(),
        new Uint8Array([1, 2, 3])
      );
      storageMod.StorageService.exportAllSnapshotsBinary = origExport;
    }

    console.log('[Unit PASS] Stage 2 Storage Gateway & Durability Tests passed.');
  } finally {
    globalThis.localStorage = prevLs;
    globalThis.indexedDB = prevIdb;
    globalThis.window = prevWin;
  }
}
