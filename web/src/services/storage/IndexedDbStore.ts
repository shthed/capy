import { PuzzleData } from '../../types';
import {
  CompactPuzzleRecordV2,
  compressPuzzleRecord,
  decompressPuzzleRecord,
  isCompactPuzzleRecordV2,
} from '../CapyCodec';
import { reportSwallowed } from '../telemetry';
import { isQuotaError, notifyQuotaWarning } from './SafeLocalStore';
import { DB_VERSION, resolveScopedDbName, STORE_IMAGES, STORE_PUZZLES } from './StorageKeys';

export const MAX_PREVIEW_CACHE_ENTRIES = 128;

const dbPromises = new Map<string, Promise<IDBDatabase>>();
const previewCache = new Map<string, string>();

export function previewCacheKey(id: string): string {
  return `${resolveScopedDbName()}::${id}`;
}

export function previewStoreKey(id: string): string {
  return `preview_${id}`;
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

function getDBWithHandle(): { dbName: string; dbPromise: Promise<IDBDatabase> } {
  const dbName = resolveScopedDbName();
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
  work: (tx: IDBTransaction) => void
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { dbName, dbPromise } = getDBWithHandle();
    try {
      const db = await dbPromise;
      await new Promise<void>((resolve, reject) => {
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

export async function deleteSnapshotEntries(id: string): Promise<void> {
  deleteCachedPreview(id);
  if (typeof indexedDB === 'undefined') return;
  try {
    const previewKey = previewStoreKey(id);
    await runTransaction([STORE_PUZZLES, STORE_IMAGES], (tx) => {
      tx.objectStore(STORE_PUZZLES).delete(id);
      tx.objectStore(STORE_IMAGES).delete(id);
      tx.objectStore(STORE_IMAGES).delete(previewKey);
    });
  } catch (err) {
    reportSwallowed('IndexedDbStore.deleteSnapshotEntries', err, { id });
  }
}

export async function clearAllStores(): Promise<void> {
  clearScopedPreviewCache();
  if (typeof indexedDB === 'undefined') return;
  try {
    await runTransaction([STORE_PUZZLES, STORE_IMAGES], (tx) => {
      tx.objectStore(STORE_PUZZLES).clear();
      tx.objectStore(STORE_IMAGES).clear();
    });
  } catch (err) {
    reportSwallowed('IndexedDbStore.clearAllStores', err);
  }
}
