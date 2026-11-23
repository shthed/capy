import { PuzzleData } from '../../types';
import {
  CompactPuzzleRecordV2,
  compressPuzzleRecord,
  decompressPuzzleRecord,
  isCompactPuzzleRecordV2,
} from '../CapyCodec';
import { reportSwallowed } from '../telemetry';
import { isQuotaError, notifyQuotaWarning } from './SafeLocalStore';
import {
  DB_VERSION,
  PREVIEW_IMAGE_KEY_PREFIX,
  resolveScopedDbName,
  STORE_IMAGES,
  STORE_PUZZLES,
} from './StorageKeys';

export const MAX_PREVIEW_CACHE_ENTRIES = 128;
const DEFAULT_CLEAR_ALL_STORES_TIMEOUT_MS = 2500;

const dbPromises = new Map<string, Promise<IDBDatabase>>();
const previewCache = new Map<string, string>();

export function previewCacheKey(id: string): string {
  return `${resolveScopedDbName()}::${id}`;
}

export function previewStoreKey(id: string): string {
  return `${PREVIEW_IMAGE_KEY_PREFIX}${id}`;
}

export function getCachedPreview(id: string): string | undefined {
  const key = previewCacheKey(id);
  const val = previewCache.get(key);
  if (val !== undefined) {
    // Promote to most-recently-used position
    previewCache.delete(key);
    previewCache.set(key, val);
  }
  return val;
}

export function setCachedPreview(id: string, previewDataUrl: string): void {
  if (!id || !previewDataUrl) return;
  const key = previewCacheKey(id);
  if (previewCache.has(key)) {
    previewCache.delete(key);
  }
  previewCache.set(key, previewDataUrl);
  while (previewCache.size > MAX_PREVIEW_CACHE_ENTRIES) {
    const oldestKey = previewCache.keys().next().value;
    if (oldestKey === undefined) break;
    previewCache.delete(oldestKey);
  }
}

export function deleteCachedPreview(id: string): void {
  previewCache.delete(previewCacheKey(id));
}

export function clearScopedPreviewCache(): void {
  const dbPrefix = `${resolveScopedDbName()}::`;
  for (const key of Array.from(previewCache.keys())) {
    if (key.startsWith(dbPrefix)) {
      previewCache.delete(key);
    }
  }
}

export function clearAllPreviewCaches(): void {
  previewCache.clear();
}

export function getPreviewCacheSize(): number {
  return previewCache.size;
}

export function isInvalidStateError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const rec = err as { name?: unknown; message?: unknown };
  const name = typeof rec.name === 'string' ? rec.name : '';
  if (name === 'InvalidStateError') return true;
  const msg = typeof rec.message === 'string' ? rec.message : '';
  return /InvalidStateError/i.test(msg);
}

export function evictDbHandle(dbName: string, expectedPromise?: Promise<IDBDatabase>): void {
  const current = dbPromises.get(dbName);
  if (!current) return;
  if (expectedPromise && current !== expectedPromise) return;
  dbPromises.delete(dbName);
  void current
    .then((db) => {
      try {
        if (typeof db.close === 'function') {
          db.close();
        }
      } catch (err) {
        reportSwallowed('IndexedDbStore.evictDbHandleClose', err, { dbName });
      }
    })
    .catch((err) => {
      reportSwallowed('IndexedDbStore.evictDbHandleReject', err, { dbName });
    });
}

export async function closeDbHandle(
  dbName: string,
  timeoutMs: number = DEFAULT_CLEAR_ALL_STORES_TIMEOUT_MS
): Promise<void> {
  const current = dbPromises.get(dbName);
  if (!current) return;
  dbPromises.delete(dbName);

  const effectiveTimeoutMs =
    typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
      ? timeoutMs
      : DEFAULT_CLEAR_ALL_STORES_TIMEOUT_MS;

  const closeWhenReady = current.then(
    (db) => {
      try {
        if (db && typeof db.close === 'function') {
          db.close();
        }
      } catch (err) {
        reportSwallowed('IndexedDbStore:closeDbHandle', err, { dbName });
      }
    },
    (err) => {
      reportSwallowed('IndexedDbStore:closeDbHandlePending', err, { dbName });
    }
  );

  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      timer = null;
      resolve();
    }, effectiveTimeoutMs);
    if (
      typeof timer === 'object' &&
      timer !== null &&
      typeof (timer as { unref?: () => void }).unref === 'function'
    ) {
      (timer as { unref: () => void }).unref();
    }
  });

  try {
    await Promise.race([closeWhenReady, timeoutPromise]);
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }
  await Promise.resolve();
}

function getDBWithHandle(targetDbName?: string): { dbName: string; dbPromise: Promise<IDBDatabase> } {
  const dbName = targetDbName || resolveScopedDbName();
  const existing = dbPromises.get(dbName);
  if (existing) {
    return { dbName, dbPromise: existing };
  }
  let openPromise: Promise<IDBDatabase> | null = null;
  let openFailed = false;
  const deleteIfCurrent = () => {
    if (openPromise && dbPromises.get(dbName) === openPromise) {
      dbPromises.delete(dbName);
    }
  };
  openPromise = new Promise<IDBDatabase>((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(dbName, DB_VERSION);
    } catch (err) {
      openFailed = true;
      deleteIfCurrent();
      reject(err);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PUZZLES)) {
        db.createObjectStore(STORE_PUZZLES);
      }
      if (!db.objectStoreNames.contains(STORE_IMAGES)) {
        db.createObjectStore(STORE_IMAGES);
      }
    };
    req.onblocked = () => {
      openFailed = true;
      deleteIfCurrent();
      reject(new Error('IndexedDB open blocked'));
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        try {
          db.close();
        } catch (err) {
          reportSwallowed('IndexedDbStore.onversionchangeClose', err, { dbName });
        }
        deleteIfCurrent();
      };
      db.onclose = () => {
        deleteIfCurrent();
      };
      resolve(db);
    };
    req.onerror = () => {
      openFailed = true;
      deleteIfCurrent();
      reject(req.error);
    };
  });
  if (!openFailed) {
    dbPromises.set(dbName, openPromise);
  }
  return { dbName, dbPromise: openPromise };
}

function resolveIdbError(
  primary: DOMException | null | undefined,
  ev: Event | undefined,
  fallbackMessage: string
): Error {
  const targetError = (ev?.target as { error?: DOMException | Error | null } | null)?.error;
  return primary || targetError || new Error(fallbackMessage);
}

export async function runTransaction(
  storeNames: string | string[],
  work: (tx: IDBTransaction) => void,
  targetDbName?: string,
  shouldCancel?: () => boolean
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (shouldCancel?.()) return;
    const { dbName, dbPromise } = getDBWithHandle(targetDbName);
    try {
      const db = await dbPromise;
      if (shouldCancel?.()) return;
      await new Promise<void>((resolve, reject) => {
        if (shouldCancel?.()) {
          resolve();
          return;
        }
        let tx: IDBTransaction;
        try {
          tx = db.transaction(storeNames, 'readwrite');
        } catch (err) {
          reject(err);
          return;
        }
        tx.oncomplete = () => resolve();
        tx.onerror = (ev) => reject(resolveIdbError(tx.error, ev, 'IndexedDB transaction failed'));
        tx.onabort = (ev) => reject(resolveIdbError(tx.error, ev, 'IndexedDB transaction aborted'));
        work(tx);
      });
      return;
    } catch (err) {
      if (shouldCancel?.()) return;
      if (attempt === 0 && isInvalidStateError(err)) {
        evictDbHandle(dbName, dbPromise);
        continue;
      }
      throw err;
    }
  }
}

export async function runReadonly<T>(
  storeName: string,
  work: (store: IDBObjectStore) => IDBRequest
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { dbName, dbPromise } = getDBWithHandle();
    try {
      const db = await dbPromise;
      return await new Promise<T>((resolve, reject) => {
        let tx: IDBTransaction;
        try {
          tx = db.transaction(storeName, 'readonly');
        } catch (err) {
          reject(err);
          return;
        }
        const req = work(tx.objectStore(storeName));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = (ev) => reject(resolveIdbError(req.error, ev, 'IndexedDB read failed'));
        tx.onerror = (ev) => reject(resolveIdbError(tx.error, ev, 'IndexedDB read failed'));
        tx.onabort = (ev) => reject(resolveIdbError(tx.error, ev, 'IndexedDB read aborted'));
      });
    } catch (err) {
      if (attempt === 0 && isInvalidStateError(err)) {
        evictDbHandle(dbName, dbPromise);
        continue;
      }
      throw err;
    }
  }
  throw new Error('IndexedDB readonly retry exhausted');
}

export async function savePreviewDataUrl(id: string, previewDataUrl: string): Promise<void> {
  if (!id || !previewDataUrl) return;
  setCachedPreview(id, previewDataUrl);
  if (typeof indexedDB === 'undefined') return;
  try {
    const key = previewStoreKey(id);
    await runTransaction(STORE_IMAGES, (tx) => {
      tx.objectStore(STORE_IMAGES).put(previewDataUrl, key);
    });
  } catch (err) {
    if (isQuotaError(err)) {
      notifyQuotaWarning(previewStoreKey(id));
    }
    reportSwallowed('IndexedDbStore.savePreviewDataUrl', err, { id });
  }
}

export async function loadPreviewDataUrl(id: string): Promise<string | null> {
  if (!id) return null;
  const cached = getCachedPreview(id);
  if (cached) return cached;
  if (typeof indexedDB === 'undefined') return null;
  try {
    const key = previewStoreKey(id);
    const raw = await runReadonly<unknown>(STORE_IMAGES, (store) => store.get(key));
    const result = typeof raw === 'string' && raw.length > 0 ? raw : null;
    if (result) {
      setCachedPreview(id, result);
    }
    return result;
  } catch (err) {
    reportSwallowed('IndexedDbStore.loadPreviewDataUrl', err, { id });
    return null;
  }
}

export async function saveCompactPuzzleRecord(
  id: string,
  record: CompactPuzzleRecordV2
): Promise<void> {
  try {
    await runTransaction(STORE_PUZZLES, (tx) => {
      tx.objectStore(STORE_PUZZLES).put(record, id);
    });
  } catch (err) {
    if (isQuotaError(err)) {
      notifyQuotaWarning(id);
    }
    reportSwallowed('IndexedDbStore.saveCompactPuzzleRecord', err, { id });
    throw err;
  }
}

export async function savePuzzleData(id: string, puzzle: PuzzleData): Promise<void> {
  let compactRecord: CompactPuzzleRecordV2;
  try {
    compactRecord = compressPuzzleRecord(puzzle);
  } catch (err) {
    reportSwallowed('IndexedDbStore.compressPuzzleRecord', err, { id });
    throw err;
  }
  await saveCompactPuzzleRecord(id, compactRecord);
}

async function loadRawPuzzleEntry(id: string): Promise<unknown> {
  try {
    const result = await runReadonly<unknown>(STORE_PUZZLES, (store) => store.get(id));
    return result || null;
  } catch (err) {
    reportSwallowed('IndexedDbStore.loadRawPuzzleEntry', err, { id });
    return null;
  }
}

export async function loadPuzzleData(id: string): Promise<PuzzleData | null> {
  const raw = await loadRawPuzzleEntry(id);
  if (!raw) return null;

  if (isCompactPuzzleRecordV2(raw)) {
    return decompressPuzzleRecord(raw);
  }

  // Backward-compatible transparent migration for legacy v1 IndexedDB PuzzleData entries
  const legacy = raw as PuzzleData;
  if (legacy && legacy.regionMap && Array.isArray(legacy.regions)) {
    savePuzzleData(id, legacy).catch((err) => {
      reportSwallowed('IndexedDbStore.legacyCompactMigration', err, { id });
    });
    return legacy;
  }

  return null;
}

export async function loadCompactPuzzleRecord(id: string): Promise<CompactPuzzleRecordV2 | null> {
  const raw = await loadRawPuzzleEntry(id);
  if (!raw) return null;
  if (isCompactPuzzleRecordV2(raw)) return raw;

  const legacy = raw as PuzzleData;
  if (legacy && legacy.regionMap && Array.isArray(legacy.regions)) {
    const compact = compressPuzzleRecord(legacy);
    saveCompactPuzzleRecord(id, compact).catch((err) => {
      reportSwallowed('IndexedDbStore.legacyCompactRecordMigration', err, { id });
    });
    return compact;
  }
  return null;
}

export async function saveImageBlob(id: string, blob: Blob): Promise<void> {
  try {
    await runTransaction(STORE_IMAGES, (tx) => {
      tx.objectStore(STORE_IMAGES).put(blob, id);
    });
  } catch (err) {
    if (isQuotaError(err)) {
      notifyQuotaWarning(id);
    }
    reportSwallowed('IndexedDbStore.saveImageBlob', err, { id });
    throw err;
  }
}

export async function loadImageBlob(id: string): Promise<Blob | null> {
  try {
    const result = await runReadonly<Blob | null | undefined>(STORE_IMAGES, (store) =>
      store.get(id)
    );
    return result || null;
  } catch (err) {
    reportSwallowed('IndexedDbStore.loadImageBlob', err, { id });
    return null;
  }
}

export async function saveMultipleCompactPuzzleRecords(
  entries: Array<{ id: string; record: CompactPuzzleRecordV2 }>
): Promise<void> {
  if (entries.length === 0) return;
  try {
    await runTransaction(STORE_PUZZLES, (tx) => {
      const store = tx.objectStore(STORE_PUZZLES);
      for (const entry of entries) {
        store.put(entry.record, entry.id);
      }
    });
  } catch (err) {
    if (isQuotaError(err)) {
      notifyQuotaWarning(entries[0]?.id ?? STORE_PUZZLES);
    }
    reportSwallowed('IndexedDbStore.saveMultipleCompactPuzzleRecords', err, {
      count: entries.length,
    });
    throw err;
  }
}

export async function saveMultiplePuzzleData(
  entries: Array<{ id: string; puzzle: PuzzleData }>
): Promise<void> {
  if (entries.length === 0) return;
  await saveMultipleCompactPuzzleRecords(
    entries.map((entry) => ({
      id: entry.id,
      record: compressPuzzleRecord(entry.puzzle),
    }))
  );
}

export function extractNestedLayerKeysFromRawRecord(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return [];
  }
  const nested = (raw as { nestedLayers?: unknown }).nestedLayers;
  if (!Array.isArray(nested) || nested.length === 0) {
    return [];
  }
  const keys: string[] = [];
  for (const layer of nested) {
    if (!layer || typeof layer !== 'object' || Array.isArray(layer)) continue;
    const blobKey = (layer as { imageBlobKey?: unknown }).imageBlobKey;
    if (typeof blobKey === 'string' && blobKey.length > 0) {
      keys.push(blobKey);
    }
  }
  return keys;
}

export interface ReferencedLayerKeysReadResult {
  ok: boolean;
  keys: Set<string>;
  targetKeys: Map<string, string[]>;
}

function readLayerKeysInSingleTx(
  db: IDBDatabase,
  uniqueIds: string[]
): Promise<{ keys: Set<string>; targetKeys: Map<string, string[]> }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    let tx: IDBTransaction;
    try {
      tx = db.transaction(STORE_PUZZLES, 'readonly');
    } catch (err) {
      fail(err);
      return;
    }

    tx.onerror = (ev) => fail(resolveIdbError(tx.error, ev, 'IndexedDB read failed'));
    tx.onabort = (ev) => fail(resolveIdbError(tx.error, ev, 'IndexedDB read aborted'));

    let store: IDBObjectStore;
    try {
      store = tx.objectStore(STORE_PUZZLES);
    } catch (err) {
      fail(err);
      return;
    }

    const keys = new Set<string>();
    const targetKeys = new Map<string, string[]>();
    let pending = uniqueIds.length;

    for (const snapId of uniqueIds) {
      let req: IDBRequest;
      try {
        req = store.get(snapId);
      } catch (err) {
        fail(err);
        return;
      }
      req.onsuccess = () => {
        if (settled) return;
        const extracted = extractNestedLayerKeysFromRawRecord(req.result);
        if (extracted.length > 0) {
          targetKeys.set(snapId, extracted);
          for (const key of extracted) {
            keys.add(key);
          }
        }
        pending -= 1;
        if (pending === 0) {
          settled = true;
          resolve({ keys, targetKeys });
        }
      };
      req.onerror = (ev) => fail(resolveIdbError(req.error, ev, 'IndexedDB read failed'));
    }
  });
}

export async function collectReferencedLayerImageKeysStrict(
  snapshotIds: string[]
): Promise<ReferencedLayerKeysReadResult> {
  if (snapshotIds.length === 0 || typeof indexedDB === 'undefined') {
    return { ok: true, keys: new Set<string>(), targetKeys: new Map<string, string[]>() };
  }
  const uniqueIds = Array.from(
    new Set(snapshotIds.filter((id): id is string => typeof id === 'string' && id.length > 0))
  );
  if (uniqueIds.length === 0) {
    return { ok: true, keys: new Set<string>(), targetKeys: new Map<string, string[]>() };
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const { dbName, dbPromise } = getDBWithHandle();
    try {
      const db = await dbPromise;
      const result = await readLayerKeysInSingleTx(db, uniqueIds);
      return { ok: true, keys: result.keys, targetKeys: result.targetKeys };
    } catch (err) {
      if (attempt === 0 && isInvalidStateError(err)) {
        evictDbHandle(dbName, dbPromise);
        continue;
      }
      reportSwallowed('IndexedDbStore.collectReferencedLayerImageKeysStrict', err, {
        count: uniqueIds.length,
      });
      return { ok: false, keys: new Set<string>(), targetKeys: new Map<string, string[]>() };
    }
  }
  return { ok: false, keys: new Set<string>(), targetKeys: new Map<string, string[]>() };
}

export interface DeleteSnapshotEntriesOptions {
  preserveRootImageKey?: boolean;
  preservePreviewKey?: boolean;
}

export async function deleteSnapshotEntries(
  id: string,
  extraImageKeys?: string[],
  options?: DeleteSnapshotEntriesOptions
): Promise<void> {
  const preserveRootImageKey = options?.preserveRootImageKey === true;
  const preservePreviewKey = options?.preservePreviewKey === true;
  if (!preservePreviewKey) {
    deleteCachedPreview(id);
  }
  if (typeof indexedDB === 'undefined') return;
  try {
    const previewKey = previewStoreKey(id);
    const uniqueExtraKeys = Array.isArray(extraImageKeys)
      ? Array.from(
          new Set(
            extraImageKeys.filter(
              (k): k is string =>
                typeof k === 'string' &&
                k.length > 0 &&
                !(preserveRootImageKey && k === id) &&
                !(preservePreviewKey && k === previewKey)
            )
          )
        )
      : [];
    await runTransaction([STORE_PUZZLES, STORE_IMAGES], (tx) => {
      tx.objectStore(STORE_PUZZLES).delete(id);
      const imageStore = tx.objectStore(STORE_IMAGES);
      if (!preserveRootImageKey) {
        imageStore.delete(id);
      }
      if (!preservePreviewKey) {
        imageStore.delete(previewKey);
      }
      for (const extraKey of uniqueExtraKeys) {
        imageStore.delete(extraKey);
      }
    });
  } catch (err) {
    reportSwallowed('IndexedDbStore.deleteSnapshotEntries', err, { id });
  }
}

export async function deleteOrphanedEntries(
  puzzleKeys: string[],
  imageKeys: string[],
  targetDbName?: string
): Promise<void> {
  if (puzzleKeys.length === 0 && imageKeys.length === 0) return;
  const effectiveDbName = targetDbName || resolveScopedDbName();
  for (const key of imageKeys) {
    if (key.startsWith(PREVIEW_IMAGE_KEY_PREFIX)) {
      previewCache.delete(`${effectiveDbName}::${key.slice(PREVIEW_IMAGE_KEY_PREFIX.length)}`);
    }
  }
  if (typeof indexedDB === 'undefined') return;
  const storesToOpen: string[] = [];
  if (puzzleKeys.length > 0) storesToOpen.push(STORE_PUZZLES);
  if (imageKeys.length > 0) storesToOpen.push(STORE_IMAGES);
  await runTransaction(
    storesToOpen,
    (tx) => {
      if (puzzleKeys.length > 0) {
        const puzzleStore = tx.objectStore(STORE_PUZZLES);
        for (const key of puzzleKeys) {
          puzzleStore.delete(key);
        }
      }
      if (imageKeys.length > 0) {
        const imageStore = tx.objectStore(STORE_IMAGES);
        for (const key of imageKeys) {
          imageStore.delete(key);
        }
      }
    },
    effectiveDbName
  );
}

export async function clearAllStores(
  targetDbName?: string,
  timeoutMs: number = DEFAULT_CLEAR_ALL_STORES_TIMEOUT_MS
): Promise<boolean> {
  const effectiveDbName = targetDbName || resolveScopedDbName();
  const dbPrefix = `${effectiveDbName}::`;
  for (const key of Array.from(previewCache.keys())) {
    if (key.startsWith(dbPrefix)) {
      previewCache.delete(key);
    }
  }
  if (typeof indexedDB === 'undefined') return false;

  const effectiveTimeoutMs =
    typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
      ? timeoutMs
      : DEFAULT_CLEAR_ALL_STORES_TIMEOUT_MS;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;

  const clearPromise = runTransaction(
    [STORE_PUZZLES, STORE_IMAGES],
    (tx) => {
      if (timedOut) {
        try {
          tx.abort();
        } catch (err) {
          reportSwallowed('IndexedDbStore:clearAllStoresAbort', err, { dbName: effectiveDbName });
        }
        return;
      }
      tx.objectStore(STORE_PUZZLES).clear();
      tx.objectStore(STORE_IMAGES).clear();
    },
    effectiveDbName,
    () => timedOut
  ).then(
    () => !timedOut,
    (err) => {
      reportSwallowed('IndexedDbStore.clearAllStores', err, { dbName: effectiveDbName });
      return false;
    }
  );

  const timeoutPromise = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => {
      timer = null;
      timedOut = true;
      const stuckHandle = dbPromises.get(effectiveDbName);
      if (stuckHandle) {
        dbPromises.delete(effectiveDbName);
        void stuckHandle.then(
          (db) => {
            try {
              if (db && typeof db.close === 'function') {
                db.close();
              }
            } catch (err) {
              reportSwallowed('IndexedDbStore.clearAllStoresTimeoutClose', err, {
                dbName: effectiveDbName,
              });
            }
          },
          () => {}
        );
      }
      resolve(false);
    }, effectiveTimeoutMs);
    if (
      typeof timer === 'object' &&
      timer !== null &&
      typeof (timer as { unref?: () => void }).unref === 'function'
    ) {
      (timer as { unref: () => void }).unref();
    }
  });

  try {
    return await Promise.race([clearPromise, timeoutPromise]);
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }
}
