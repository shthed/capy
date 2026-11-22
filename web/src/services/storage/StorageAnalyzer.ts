import { DEV_DEBUG_STORAGE_KEY } from '../../utils/debugEnvironment';
import { ReleaseChannel } from '../../version';
import { normalizePwaScopePath, resolvePwaCacheName } from '../PwaService';
import {
  DEV_CLOUD_COOP_UI_STORAGE_KEY,
  resolveStorageNamespace,
} from '../StorageNamespace';
import { reportSwallowed } from '../telemetry';
import { clearActiveState } from './ActiveSessionStorage';
import {
  clearWithBackup,
  peekBackupCandidatesReadOnly,
} from './BackupEngine';
import {
  clearAllPreviewCaches,
  clearAllStores,
  closeDbHandle,
  deleteOrphanedEntries,
} from './IndexedDbStore';
import { SafeLocalStore } from './SafeLocalStore';
import { clearAllSnapshots } from './SnapshotStorage';
import {
  ACTIVE_STATE_KEY,
  matchesScopedKey,
  resolveScopedBackupKey,
  resolveScopedDbName,
  resolveScopedStorageKey,
  SETTINGS_KEY,
  SNAPSHOTS_KEY,
  STORAGE_KEYS,
  STORE_IMAGES,
  STORE_PUZZLES,
} from './StorageKeys';

export type CacheCategory =
  | 'current'
  | 'staleAlpha'
  | 'staleVersion'
  | 'siblingBeta'
  | 'siblingProd'
  | 'otherCapy'
  | 'otherOrigin';

export interface CacheEntrySummary {
  name: string;
  category: CacheCategory;
  scopePath: string | null;
  bytes: number;
  entryCount: number;
  hasOpaqueEntries: boolean;
}

export interface CacheStorageReport {
  supported: boolean;
  totalBytes: number;
  currentAppBytes: number;
  staleAlphaBytes: number;
  staleAlphaCount: number;
  staleVersionBytes: number;
  staleVersionCount: number;
  siblingBetaProdBytes: number;
  otherCapyBytes: number;
  otherOriginBytes: number;
  otherOriginCount: number;
  caches: CacheEntrySummary[];
}

export interface IdbDatabaseReport {
  dbName: string;
  channel: ReleaseChannel | 'other';
  isCurrent: boolean;
  isPreviewChannel: boolean;
  totalBytes: number;
  puzzlesBytes: number;
  puzzlesCount: number;
  imagesBytes: number;
  imagesCount: number;
  previewsBytes: number;
  previewsCount: number;
  orphanedBytes: number;
  orphanedCount: number;
  orphanedPuzzleKeys: string[];
  orphanedImageKeys: string[];
  orphanDetectionSkipped: boolean;
}

export interface IndexedDbReport {
  supported: boolean;
  totalBytes: number;
  activeDb: IdbDatabaseReport | null;
  siblingPreviewDbs: IdbDatabaseReport[];
  siblingProdDbs: IdbDatabaseReport[];
  otherOriginDbNames: string[];
  totalOrphanedBytes: number;
  totalOrphanedCount: number;
}

export interface LocalStoreReport {
  supported: boolean;
  totalBytes: number;
  currentChannelBytes: number;
  currentChannelCount: number;
  previewChannelsBytes: number;
  previewChannelsCount: number;
  prodChannelBytes: number;
  prodChannelCount: number;
  quarantineBytes: number;
  quarantineCount: number;
  cleanableQuarantineBytes: number;
  cleanableQuarantineCount: number;
  otherCapyBytes: number;
  otherCapyCount: number;
  otherOriginBytes: number;
  otherOriginCount: number;
}

export interface BrowserStorageEstimate {
  supported: boolean;
  usageBytes: number | null;
  quotaBytes: number | null;
  usageDetails: Record<string, number> | null;
  persisted: boolean | null;
}

export interface StorageAnalysisReport {
  measuredAt: number;
  activeChannel: ReleaseChannel;
  activeDbName: string;
  activeCacheName: string;
  activeScopePath: string;
  browserEstimate: BrowserStorageEstimate;
  cacheStorage: CacheStorageReport;
  indexedDb: IndexedDbReport;
  localStore: LocalStoreReport;
  totalCapyMeasuredBytes: number;
  totalOriginMeasuredBytes: number;
  unattributedBrowserBytes: number;
  totalReclaimableSafeBytes: number;
}

export interface StorageCleanupResult {
  ok: boolean;
  freedBytesEstimate: number;
  deletedCaches: number;
  deletedIdbRecords: number;
  deletedIdbDatabases: number;
  deletedLocalKeys: number;
  unregisteredWorkers: number;
  blockedDatabases: string[];
  warnings: string[];
}

export interface StorageAnalyzerOptions {
  pathname?: string;
  origin?: string;
  search?: string;
  scopeUrl?: string;
  version?: string;
  blockedTimeoutMs?: number;
}

const CAPY_IDB_NAME_RE = /^capy_game_storage_v8(?:_[a-z0-9_-]+)?$/i;
const ALPHA_PREVIEW_SCOPE_RE = /\/(?:alpha|PR|pull)\/[^/]+\//i;
const BETA_SCOPE_RE = /\/beta\/$/i;
const PROD_SCOPE_RE = /^\/(?:(?:capy|paint)\/)?$/i;
const LEGACY_CAPY_KEY_RE = /^capy_(?:user_settings|snapshots|active_session)_v\d+(?:__|$)/;
const QUARANTINE_SUFFIX = '__corrupt_quarantine';
const SANDBOX_SUFFIX_RE = /__sandbox_(alpha|beta|dev|stable)(?:__|$)/i;
const CAPY_BASE_KEYS: readonly string[] = Object.values(STORAGE_KEYS);
const CACHE_MEASUREMENT_CONCURRENCY = 12;
const DEFAULT_BLOCKED_TIMEOUT_MS = 2500;
const MAX_CLONE_SIZE_DEPTH = 16;

export function formatStorageBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb >= 100 ? Math.round(kb) : kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb >= 100 ? mb.toFixed(0) : mb.toFixed(mb >= 10 ? 1 : 2)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

export function isCapyCacheName(cacheName: string): boolean {
  return cacheName === 'capy-cache-v2' || cacheName.startsWith('capy-cache-v');
}

export function isAlphaPreviewScopePath(scopePath: string): boolean {
  return ALPHA_PREVIEW_SCOPE_RE.test(normalizePwaScopePath(scopePath));
}

export function classifyCacheName(
  cacheName: string,
  currentCacheName: string,
  currentScopePath: string
): { category: CacheCategory; scopePath: string | null } {
  const normalizedCurrentScope = normalizePwaScopePath(currentScopePath);
  if (cacheName === currentCacheName) {
    return { category: 'current', scopePath: normalizedCurrentScope };
  }
  if (cacheName === 'capy-cache-v2') {
    return { category: 'staleVersion', scopePath: null };
  }
  if (!cacheName.startsWith('capy-cache-v')) {
    return { category: 'otherOrigin', scopePath: null };
  }
  const colonIdx = cacheName.indexOf(':');
  if (colonIdx === -1) {
    return { category: 'otherCapy', scopePath: null };
  }
  const scopePath = normalizePwaScopePath(cacheName.slice(colonIdx + 1));
  if (scopePath === normalizedCurrentScope) {
    return { category: 'staleVersion', scopePath };
  }
  if (isAlphaPreviewScopePath(scopePath)) {
    return { category: 'staleAlpha', scopePath };
  }
  if (BETA_SCOPE_RE.test(scopePath)) {
    return { category: 'siblingBeta', scopePath };
  }
  if (PROD_SCOPE_RE.test(scopePath)) {
    return { category: 'siblingProd', scopePath };
  }
  return { category: 'otherCapy', scopePath };
}

export function isCapyPaintLocalKey(key: string): boolean {
  if (!key) return false;
  if (key === DEV_DEBUG_STORAGE_KEY || key === DEV_CLOUD_COOP_UI_STORAGE_KEY) {
    return true;
  }
  if (LEGACY_CAPY_KEY_RE.test(key)) {
    return true;
  }
  for (const baseKey of CAPY_BASE_KEYS) {
    if (matchesScopedKey(key, baseKey)) {
      return true;
    }
  }
  return false;
}

function estimateCollectionBytes(
  value: object,
  seen: WeakSet<object>,
  depth: number
): number {
  if (Array.isArray(value)) {
    let total = 0;
    for (let i = 0; i < value.length; i++) {
      total += estimateStructuredCloneBytes(value[i], seen, depth + 1);
    }
    return total;
  }
  if (value instanceof Map) {
    let total = 0;
    value.forEach((v, k) => {
      total += estimateStructuredCloneBytes(k, seen, depth + 1);
      total += estimateStructuredCloneBytes(v, seen, depth + 1);
    });
    return total;
  }
  if (value instanceof Set) {
    let total = 0;
    value.forEach((v) => {
      total += estimateStructuredCloneBytes(v, seen, depth + 1);
    });
    return total;
  }
  let total = 0;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    total += k.length * 2;
    total += estimateStructuredCloneBytes(v, seen, depth + 1);
  }
  return total;
}

export function estimateStructuredCloneBytes(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
  depth: number = 0
): number {
  if (depth > MAX_CLONE_SIZE_DEPTH || value === null || value === undefined) {
    return 0;
  }
  const valueType = typeof value;
  if (valueType === 'boolean') return 4;
  if (valueType === 'number') return 8;
  if (valueType === 'bigint') return 16;
  if (valueType === 'string') return (value as string).length * 2;
  if (valueType !== 'object') return 0;

  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    if (seen.has(value)) return 0;
    seen.add(value);
    return Number.isFinite(value.size) && value.size > 0 ? value.size : 0;
  }
  if (value instanceof ArrayBuffer) {
    if (seen.has(value)) return 0;
    seen.add(value);
    return value.byteLength;
  }
  if (ArrayBuffer.isView(value)) {
    const backing = value.buffer;
    if (seen.has(backing)) return 0;
    seen.add(backing);
    return backing.byteLength;
  }
  if (value instanceof Date) return 8;
  if (value instanceof RegExp) return value.source.length * 2 + 8;

  const obj = value as object;
  if (seen.has(obj)) return 0;
  seen.add(obj);
  return estimateCollectionBytes(obj, seen, depth);
}

function collectLiveSnapshotRefs(
  rawJson: string,
  liveIds: Set<string>,
  liveBlobUris: Set<string>
): boolean {
  try {
    const parsed = JSON.parse(rawJson);
    if (!Array.isArray(parsed)) {
      return false;
    }
    let validIdCount = 0;
    for (const item of parsed) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const rec = item as { id?: unknown; sourceRef?: { kind?: unknown; uri?: unknown } };
      if (typeof rec.id === 'string' && rec.id.length > 0) {
        liveIds.add(rec.id);
        validIdCount += 1;
      }
      if (
        rec.sourceRef &&
        rec.sourceRef.kind === 'blob' &&
        typeof rec.sourceRef.uri === 'string' &&
        rec.sourceRef.uri.length > 0
      ) {
        liveBlobUris.add(rec.sourceRef.uri);
      }
    }
    if (parsed.length > 0 && validIdCount === 0) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function collectLiveActiveStateRef(rawJson: string, liveIds: Set<string>): boolean {
  try {
    const parsedActive = JSON.parse(rawJson);
    if (!parsedActive || typeof parsedActive !== 'object' || Array.isArray(parsedActive)) {
      return false;
    }
    const activeId = (parsedActive as { activeSnapshotId?: unknown }).activeSnapshotId;
    if (typeof activeId === 'string' && activeId.length > 0) {
      liveIds.add(activeId);
    }
    return true;
  } catch {
    return false;
  }
}

function collectNonEmptyCandidates(
  primary: string | null,
  extras?: string[]
): string[] {
  const out: string[] = [];
  if (primary !== null && primary.trim().length > 0) {
    out.push(primary);
  }
  if (extras) {
    for (const candidate of extras) {
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        out.push(candidate);
      }
    }
  }
  return out;
}

export function computeOrphanedKeys(params: {
  puzzleKeys: string[];
  imageKeys: string[];
  rawSnapshotsJson: string | null;
  rawActiveStateJson: string | null;
  extraSnapshotsCandidates?: string[];
  extraActiveStateCandidates?: string[];
}): {
  skipped: boolean;
  orphanedPuzzleKeys: string[];
  orphanedImageKeys: string[];
} {
  const liveIds = new Set<string>();
  const liveBlobUris = new Set<string>();

  for (const rawSnap of collectNonEmptyCandidates(
    params.rawSnapshotsJson,
    params.extraSnapshotsCandidates
  )) {
    if (!collectLiveSnapshotRefs(rawSnap, liveIds, liveBlobUris)) {
      return { skipped: true, orphanedPuzzleKeys: [], orphanedImageKeys: [] };
    }
  }

  for (const rawActive of collectNonEmptyCandidates(
    params.rawActiveStateJson,
    params.extraActiveStateCandidates
  )) {
    if (!collectLiveActiveStateRef(rawActive, liveIds)) {
      return { skipped: true, orphanedPuzzleKeys: [], orphanedImageKeys: [] };
    }
  }

  const orphanedPuzzleKeys = params.puzzleKeys.filter((key) => !liveIds.has(key));
  const orphanedImageKeys = params.imageKeys.filter((key) => {
    if (key.startsWith('preview_')) {
      const snapId = key.slice('preview_'.length);
      return !liveIds.has(snapId) && !liveBlobUris.has(key);
    }
    return !liveIds.has(key) && !liveBlobUris.has(key);
  });

  return { skipped: false, orphanedPuzzleKeys, orphanedImageKeys };
}

function resolveChannelMetaForDbName(dbName: string): {
  channel: ReleaseChannel | 'other';
  sandboxSuffix: string;
  isPreviewChannel: boolean;
} {
  if (dbName === 'capy_game_storage_v8') {
    return { channel: 'stable', sandboxSuffix: '', isPreviewChannel: false };
  }
  const prefix = 'capy_game_storage_v8_';
  if (dbName.startsWith(prefix)) {
    const suffix = dbName.slice(prefix.length).toLowerCase();
    if (suffix === 'alpha' || suffix === 'beta') {
      return { channel: suffix, sandboxSuffix: `__sandbox_${suffix}`, isPreviewChannel: true };
    }
    if (suffix === 'dev') {
      return { channel: 'dev', sandboxSuffix: '__sandbox_dev', isPreviewChannel: true };
    }
    if (suffix === 'stable') {
      return { channel: 'stable', sandboxSuffix: '__sandbox_stable', isPreviewChannel: false };
    }
    return { channel: 'other', sandboxSuffix: `__sandbox_${suffix}`, isPreviewChannel: false };
  }
  return { channel: 'other', sandboxSuffix: '', isPreviewChannel: false };
}

function resolveActiveScopePath(options?: StorageAnalyzerOptions): string {
  const activeCacheName = resolvePwaCacheName(options?.scopeUrl, options?.version);
  const colonIdx = activeCacheName.indexOf(':');
  if (colonIdx !== -1) {
    return normalizePwaScopePath(activeCacheName.slice(colonIdx + 1));
  }
  return normalizePwaScopePath(options?.pathname ?? '/');
}

async function readBrowserStorageEstimate(): Promise<BrowserStorageEstimate> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.storage ||
    typeof navigator.storage.estimate !== 'function'
  ) {
    return {
      supported: false,
      usageBytes: null,
      quotaBytes: null,
      usageDetails: null,
      persisted: null,
    };
  }
  try {
    const raw = (await navigator.storage.estimate()) as StorageEstimate & {
      usageDetails?: Record<string, unknown>;
    };
    const usageBytes =
      typeof raw.usage === 'number' && Number.isFinite(raw.usage) ? Math.max(0, raw.usage) : null;
    const quotaBytes =
      typeof raw.quota === 'number' && Number.isFinite(raw.quota) && raw.quota > 0
        ? raw.quota
        : null;
    let usageDetails: Record<string, number> | null = null;
    if (raw.usageDetails && typeof raw.usageDetails === 'object') {
      const cleaned: Record<string, number> = {};
      for (const [k, v] of Object.entries(raw.usageDetails)) {
        if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
          cleaned[k] = v;
        }
      }
      if (Object.keys(cleaned).length > 0) {
        usageDetails = cleaned;
      }
    }
    let persisted: boolean | null = null;
    if (typeof navigator.storage.persisted === 'function') {
      try {
        persisted = await navigator.storage.persisted();
      } catch (err) {
        reportSwallowed('StorageAnalyzer.persisted', err);
      }
    }
    return { supported: true, usageBytes, quotaBytes, usageDetails, persisted };
  } catch (err) {
    reportSwallowed('StorageAnalyzer.estimate', err);
    return {
      supported: false,
      usageBytes: null,
      quotaBytes: null,
      usageDetails: null,
      persisted: null,
    };
  }
}

async function measureResponseBytes(
  res: Response | undefined
): Promise<{ bytes: number; isOpaque: boolean }> {
  if (!res) return { bytes: 0, isOpaque: false };
  if (res.type === 'opaque' || res.type === 'opaqueredirect') {
    return { bytes: 0, isOpaque: true };
  }
  const encoding = res.headers?.get('content-encoding')?.trim().toLowerCase() ?? '';
  if (!encoding || encoding === 'identity') {
    const contentLength = res.headers?.get('content-length')?.trim() ?? '';
    if (/^\d+$/.test(contentLength)) {
      return { bytes: Number(contentLength), isOpaque: false };
    }
  }
  if (res.bodyUsed) {
    return { bytes: 0, isOpaque: false };
  }
  try {
    const cloned = typeof res.clone === 'function' ? res.clone() : res;
    if (typeof cloned.blob === 'function') {
      const blob = await cloned.blob();
      return { bytes: Number.isFinite(blob.size) ? blob.size : 0, isOpaque: false };
    }
  } catch (err) {
    reportSwallowed('StorageAnalyzer.measureResponseBlob', err);
  }
  try {
    const cloned = typeof res.clone === 'function' ? res.clone() : res;
    if (typeof cloned.arrayBuffer === 'function') {
      const ab = await cloned.arrayBuffer();
      return { bytes: ab.byteLength, isOpaque: false };
    }
  } catch (err) {
    reportSwallowed('StorageAnalyzer.measureResponseArrayBuffer', err);
  }
  return { bytes: 0, isOpaque: false };
}

async function inspectSingleCache(
  cacheName: string,
  currentCacheName: string,
  currentScopePath: string
): Promise<CacheEntrySummary> {
  const { category, scopePath } = classifyCacheName(cacheName, currentCacheName, currentScopePath);
  let bytes = 0;
  let entryCount = 0;
  let hasOpaqueEntries = false;
  try {
    const cache = await caches.open(cacheName);
    const requests = await cache.keys();
    entryCount = requests.length;
    for (let i = 0; i < requests.length; i += CACHE_MEASUREMENT_CONCURRENCY) {
      const slice = requests.slice(i, i + CACHE_MEASUREMENT_CONCURRENCY);
      const measured = await Promise.all(
        slice.map(async (req) => {
          try {
            const matched =
              (await cache.match(req, { ignoreVary: true })) ?? (await cache.match(req));
            return await measureResponseBytes(matched);
          } catch (err) {
            reportSwallowed('StorageAnalyzer.matchCacheRequest', err, { cacheName });
            return { bytes: 0, isOpaque: false };
          }
        })
      );
      for (const item of measured) {
        bytes += item.bytes;
        if (item.isOpaque) hasOpaqueEntries = true;
      }
    }
  } catch (err) {
    reportSwallowed('StorageAnalyzer.inspectSingleCache', err, { cacheName });
  }
  return { name: cacheName, category, scopePath, bytes, entryCount, hasOpaqueEntries };
}

async function inspectCacheStorage(
  currentCacheName: string,
  currentScopePath: string
): Promise<CacheStorageReport> {
  const empty: CacheStorageReport = {
    supported: false,
    totalBytes: 0,
    currentAppBytes: 0,
    staleAlphaBytes: 0,
    staleAlphaCount: 0,
    staleVersionBytes: 0,
    staleVersionCount: 0,
    siblingBetaProdBytes: 0,
    otherCapyBytes: 0,
    otherOriginBytes: 0,
    otherOriginCount: 0,
    caches: [],
  };
  if (typeof caches === 'undefined' || typeof caches.keys !== 'function') {
    return empty;
  }
  try {
    const names = await caches.keys();
    const summaries = await Promise.all(
      names.map((name) => inspectSingleCache(name, currentCacheName, currentScopePath))
    );
    summaries.sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
    const report: CacheStorageReport = { ...empty, supported: true, caches: summaries };
    for (const item of summaries) {
      report.totalBytes += item.bytes;
      if (item.category === 'current') {
        report.currentAppBytes += item.bytes;
      } else if (item.category === 'staleAlpha') {
        report.staleAlphaBytes += item.bytes;
        report.staleAlphaCount += 1;
      } else if (item.category === 'staleVersion') {
        report.staleVersionBytes += item.bytes;
        report.staleVersionCount += 1;
      } else if (item.category === 'siblingBeta' || item.category === 'siblingProd') {
        report.siblingBetaProdBytes += item.bytes;
      } else if (item.category === 'otherCapy') {
        report.otherCapyBytes += item.bytes;
      } else {
        report.otherOriginBytes += item.bytes;
        report.otherOriginCount += 1;
      }
    }
    return report;
  } catch (err) {
    reportSwallowed('StorageAnalyzer.inspectCacheStorage', err);
    return empty;
  }
}

async function openExistingIdbReadonly(
  dbName: string,
  timeoutMs: number = DEFAULT_BLOCKED_TIMEOUT_MS
): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined' || typeof indexedDB.open !== 'function') {
    return null;
  }
  const effectiveTimeoutMs =
    typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
      ? timeoutMs
      : DEFAULT_BLOCKED_TIMEOUT_MS;
  return await new Promise<IDBDatabase | null>((resolve) => {
    let createdDuringProbe = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (db: IDBDatabase | null) => {
      if (settled) return;
      settled = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      resolve(db);
    };
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(dbName);
    } catch (err) {
      reportSwallowed('StorageAnalyzer.openExistingIdbReadonly', err, { dbName });
      finish(null);
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      finish(null);
    }, effectiveTimeoutMs);
    if (
      typeof timer === 'object' &&
      timer !== null &&
      typeof (timer as { unref?: () => void }).unref === 'function'
    ) {
      (timer as { unref: () => void }).unref();
    }
    req.onupgradeneeded = (ev) => {
      if (settled || ev.oldVersion === 0) {
        createdDuringProbe = true;
        try {
          req.transaction?.abort();
        } catch (err) {
          reportSwallowed('StorageAnalyzer.abortProbeUpgrade', err, { dbName });
        }
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      if (settled || createdDuringProbe) {
        try {
          if (db && typeof db.close === 'function') {
            db.close();
          }
        } catch (err) {
          reportSwallowed('StorageAnalyzer.closeCreatedProbeDb', err, { dbName });
        }
        finish(null);
        return;
      }
      db.onversionchange = () => {
        try {
          db.close();
        } catch (err) {
          reportSwallowed('StorageAnalyzer.probeOnVersionChange', err, { dbName });
        }
      };
      finish(db);
    };
    req.onerror = () => finish(null);
    req.onblocked = () => finish(null);
  });
}

async function readStoreEntries(
  db: IDBDatabase,
  storeName: string
): Promise<Array<{ key: string; bytes: number }>> {
  if (!db.objectStoreNames || !db.objectStoreNames.contains(storeName)) {
    return [];
  }
  return await new Promise<Array<{ key: string; bytes: number }>>((resolve) => {
    const entries: Array<{ key: string; bytes: number }> = [];
    let tx: IDBTransaction;
    try {
      tx = db.transaction(storeName, 'readonly');
    } catch (err) {
      reportSwallowed('StorageAnalyzer.readStoreEntriesTx', err, { storeName });
      resolve([]);
      return;
    }
    const store = tx.objectStore(storeName);
    if (typeof store.openCursor === 'function') {
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve(entries);
          return;
        }
        const keyStr = String(cursor.key);
        const bytes = keyStr.length * 2 + estimateStructuredCloneBytes(cursor.value);
        entries.push({ key: keyStr, bytes });
        cursor.continue();
      };
      req.onerror = () => resolve(entries);
      tx.onabort = () => resolve(entries);
      return;
    }
    if (typeof store.getAllKeys === 'function') {
      const keysReq = store.getAllKeys();
      keysReq.onsuccess = () => {
        const keys = Array.isArray(keysReq.result) ? keysReq.result : [];
        if (keys.length === 0) {
          resolve([]);
          return;
        }
        let pending = keys.length;
        for (const rawKey of keys) {
          const getReq = store.get(rawKey);
          getReq.onsuccess = () => {
            const keyStr = String(rawKey);
            const bytes = keyStr.length * 2 + estimateStructuredCloneBytes(getReq.result);
            entries.push({ key: keyStr, bytes });
            pending -= 1;
            if (pending === 0) resolve(entries);
          };
          getReq.onerror = () => {
            pending -= 1;
            if (pending === 0) resolve(entries);
          };
        }
      };
      keysReq.onerror = () => resolve([]);
      return;
    }
    resolve([]);
  });
}

function isHealthyJsonLocalValue(raw: string | null): boolean {
  if (!raw || raw.trim().length === 0) return false;
  try {
    JSON.parse(raw);
    return true;
  } catch {
    return false;
  }
}

function readChannelMetadataForOrphanCheck(
  dbName: string,
  activeDbName: string,
  snapshotsKey: string,
  activeStateKey: string
): {
  ok: boolean;
  rawSnapshotsJson: string | null;
  rawActiveStateJson: string | null;
  extraSnapshotsCandidates: string[];
  extraActiveStateCandidates: string[];
} {
  const snapRead = SafeLocalStore.tryGetItem(snapshotsKey);
  const activeRead = SafeLocalStore.tryGetItem(activeStateKey);
  if (!snapRead.ok || !activeRead.ok) {
    return {
      ok: false,
      rawSnapshotsJson: null,
      rawActiveStateJson: null,
      extraSnapshotsCandidates: [],
      extraActiveStateCandidates: [],
    };
  }

  let extraSnapshotsCandidates: string[] = [];
  let extraActiveStateCandidates: string[] = [];

  if (dbName === activeDbName) {
    const snapBackup = peekBackupCandidatesReadOnly(snapshotsKey, snapshotsKey);
    if (!snapBackup.ok) {
      return {
        ok: false,
        rawSnapshotsJson: null,
        rawActiveStateJson: null,
        extraSnapshotsCandidates: [],
        extraActiveStateCandidates: [],
      };
    }
    const activeBackup = peekBackupCandidatesReadOnly(activeStateKey, activeStateKey);
    if (!activeBackup.ok) {
      return {
        ok: false,
        rawSnapshotsJson: null,
        rawActiveStateJson: null,
        extraSnapshotsCandidates: [],
        extraActiveStateCandidates: [],
      };
    }
    extraSnapshotsCandidates = snapBackup.candidates;
    extraActiveStateCandidates = activeBackup.candidates;
  }

  return {
    ok: true,
    rawSnapshotsJson: snapRead.value,
    rawActiveStateJson: activeRead.value,
    extraSnapshotsCandidates,
    extraActiveStateCandidates,
  };
}

async function inspectSingleIdbDatabase(
  dbName: string,
  activeDbName: string,
  blockedTimeoutMs: number = DEFAULT_BLOCKED_TIMEOUT_MS
): Promise<IdbDatabaseReport | null> {
  const db = await openExistingIdbReadonly(dbName, blockedTimeoutMs);
  if (!db) return null;
  try {
    const puzzleEntries = await readStoreEntries(db, STORE_PUZZLES);
    const imageEntries = await readStoreEntries(db, STORE_IMAGES);
    const meta = resolveChannelMetaForDbName(dbName);
    const snapshotsKey = `${SNAPSHOTS_KEY}${meta.sandboxSuffix}`;
    const activeStateKey = `${ACTIVE_STATE_KEY}${meta.sandboxSuffix}`;
    const metaRead = readChannelMetadataForOrphanCheck(
      dbName,
      activeDbName,
      snapshotsKey,
      activeStateKey
    );
    const orphanRes = metaRead.ok
      ? computeOrphanedKeys({
          puzzleKeys: puzzleEntries.map((e) => e.key),
          imageKeys: imageEntries.map((e) => e.key),
          rawSnapshotsJson: metaRead.rawSnapshotsJson,
          rawActiveStateJson: metaRead.rawActiveStateJson,
          extraSnapshotsCandidates: metaRead.extraSnapshotsCandidates,
          extraActiveStateCandidates: metaRead.extraActiveStateCandidates,
        })
      : { skipped: true, orphanedPuzzleKeys: [] as string[], orphanedImageKeys: [] as string[] };
    const orphanPuzzleSet = new Set(orphanRes.orphanedPuzzleKeys);
    const orphanImageSet = new Set(orphanRes.orphanedImageKeys);

    let puzzlesBytes = 0;
    let imagesBytes = 0;
    let imagesCount = 0;
    let previewsBytes = 0;
    let previewsCount = 0;
    let orphanedBytes = 0;

    for (const entry of puzzleEntries) {
      puzzlesBytes += entry.bytes;
      if (orphanPuzzleSet.has(entry.key)) {
        orphanedBytes += entry.bytes;
      }
    }
    for (const entry of imageEntries) {
      if (entry.key.startsWith('preview_')) {
        previewsBytes += entry.bytes;
        previewsCount += 1;
      } else {
        imagesBytes += entry.bytes;
        imagesCount += 1;
      }
      if (orphanImageSet.has(entry.key)) {
        orphanedBytes += entry.bytes;
      }
    }

    return {
      dbName,
      channel: meta.channel,
      isCurrent: dbName === activeDbName,
      isPreviewChannel: meta.isPreviewChannel,
      totalBytes: puzzlesBytes + imagesBytes + previewsBytes,
      puzzlesBytes,
      puzzlesCount: puzzleEntries.length,
      imagesBytes,
      imagesCount,
      previewsBytes,
      previewsCount,
      orphanedBytes,
      orphanedCount: orphanRes.orphanedPuzzleKeys.length + orphanRes.orphanedImageKeys.length,
      orphanedPuzzleKeys: orphanRes.orphanedPuzzleKeys,
      orphanedImageKeys: orphanRes.orphanedImageKeys,
      orphanDetectionSkipped: orphanRes.skipped,
    };
  } finally {
    try {
      db.close();
    } catch (err) {
      reportSwallowed('StorageAnalyzer.closeInspectedDb', err, { dbName });
    }
  }
}

async function discoverIdbNames(activeDbName: string): Promise<{
  capyDbNames: string[];
  otherOriginDbNames: string[];
}> {
  const canonical = new Set<string>([
    'capy_game_storage_v8',
    'capy_game_storage_v8_beta',
    'capy_game_storage_v8_alpha',
    activeDbName,
  ]);
  const otherOriginDbNames: string[] = [];

  if (typeof indexedDB !== 'undefined' && typeof indexedDB.databases === 'function') {
    try {
      const list = await indexedDB.databases();
      const capyFound = new Set<string>();
      for (const info of list) {
        const name = typeof info?.name === 'string' ? info.name : '';
        if (!name) continue;
        if (CAPY_IDB_NAME_RE.test(name)) {
          capyFound.add(name);
        } else {
          otherOriginDbNames.push(name);
        }
      }
      return {
        capyDbNames: Array.from(capyFound),
        otherOriginDbNames: Array.from(new Set(otherOriginDbNames)).sort(),
      };
    } catch (err) {
      reportSwallowed('StorageAnalyzer.idbDatabases', err);
    }
  }

  return {
    capyDbNames: Array.from(canonical),
    otherOriginDbNames,
  };
}

async function inspectIndexedDb(
  activeDbName: string,
  blockedTimeoutMs: number = DEFAULT_BLOCKED_TIMEOUT_MS
): Promise<IndexedDbReport> {
  const empty: IndexedDbReport = {
    supported: false,
    totalBytes: 0,
    activeDb: null,
    siblingPreviewDbs: [],
    siblingProdDbs: [],
    otherOriginDbNames: [],
    totalOrphanedBytes: 0,
    totalOrphanedCount: 0,
  };
  if (typeof indexedDB === 'undefined') {
    return empty;
  }
  const { capyDbNames, otherOriginDbNames } = await discoverIdbNames(activeDbName);
  const report: IndexedDbReport = { ...empty, supported: true, otherOriginDbNames };
  const inspected = await Promise.all(
    capyDbNames.map((dbName) => inspectSingleIdbDatabase(dbName, activeDbName, blockedTimeoutMs))
  );
  for (const dbReport of inspected) {
    if (!dbReport) continue;
    report.totalBytes += dbReport.totalBytes;
    report.totalOrphanedBytes += dbReport.orphanedBytes;
    report.totalOrphanedCount += dbReport.orphanedCount;
    if (dbReport.isCurrent) {
      report.activeDb = dbReport;
    } else if (dbReport.isPreviewChannel) {
      report.siblingPreviewDbs.push(dbReport);
    } else {
      report.siblingProdDbs.push(dbReport);
    }
  }
  report.siblingPreviewDbs.sort((a, b) => b.totalBytes - a.totalBytes);
  report.siblingProdDbs.sort((a, b) => b.totalBytes - a.totalBytes);
  return report;
}

function inspectLocalStore(activeSandboxSuffix: string): LocalStoreReport {
  const supported = SafeLocalStore.hasLocalStorage();
  const report: LocalStoreReport = {
    supported,
    totalBytes: 0,
    currentChannelBytes: 0,
    currentChannelCount: 0,
    previewChannelsBytes: 0,
    previewChannelsCount: 0,
    prodChannelBytes: 0,
    prodChannelCount: 0,
    quarantineBytes: 0,
    quarantineCount: 0,
    cleanableQuarantineBytes: 0,
    cleanableQuarantineCount: 0,
    otherCapyBytes: 0,
    otherCapyCount: 0,
    otherOriginBytes: 0,
    otherOriginCount: 0,
  };
  if (!supported) return report;

  const entries = SafeLocalStore.entries();
  const entriesByKey = new Map<string, string>(entries);
  for (const [key, value] of entries) {
    const bytes = (key.length + value.length) * 2;
    report.totalBytes += bytes;

    if (!isCapyPaintLocalKey(key)) {
      report.otherOriginBytes += bytes;
      report.otherOriginCount += 1;
      continue;
    }

    if (key.endsWith(QUARANTINE_SUFFIX)) {
      report.quarantineBytes += bytes;
      report.quarantineCount += 1;
      const baseKeyWithSandbox = key.slice(0, -QUARANTINE_SUFFIX.length);
      const qSandboxMatch = SANDBOX_SUFFIX_RE.exec(baseKeyWithSandbox);
      const qSuffix = qSandboxMatch ? `__sandbox_${qSandboxMatch[1].toLowerCase()}` : '';
      if (
        qSuffix === activeSandboxSuffix &&
        isHealthyJsonLocalValue(entriesByKey.get(baseKeyWithSandbox) ?? null)
      ) {
        report.cleanableQuarantineBytes += bytes;
        report.cleanableQuarantineCount += 1;
      }
      continue;
    }

    const sandboxMatch = SANDBOX_SUFFIX_RE.exec(key);
    if (sandboxMatch) {
      const channel = sandboxMatch[1].toLowerCase();
      const keySuffix = `__sandbox_${channel}`;
      if (activeSandboxSuffix && keySuffix === activeSandboxSuffix) {
        report.currentChannelBytes += bytes;
        report.currentChannelCount += 1;
      } else if (channel === 'alpha' || channel === 'beta' || channel === 'dev') {
        report.previewChannelsBytes += bytes;
        report.previewChannelsCount += 1;
      } else {
        report.otherCapyBytes += bytes;
        report.otherCapyCount += 1;
      }
      continue;
    }

    if (!activeSandboxSuffix) {
      report.currentChannelBytes += bytes;
      report.currentChannelCount += 1;
    } else if (key === DEV_DEBUG_STORAGE_KEY || key === DEV_CLOUD_COOP_UI_STORAGE_KEY) {
      report.otherCapyBytes += bytes;
      report.otherCapyCount += 1;
    } else {
      report.prodChannelBytes += bytes;
      report.prodChannelCount += 1;
    }
  }
  return report;
}

export async function analyzeBrowserStorage(
  options?: StorageAnalyzerOptions
): Promise<StorageAnalysisReport> {
  const ns = resolveStorageNamespace(options?.pathname, options?.origin, options?.search);
  const activeDbName = ns.dbName;
  const activeCacheName = resolvePwaCacheName(options?.scopeUrl, options?.version);
  const activeScopePath = resolveActiveScopePath(options);

  const blockedTimeoutMs = options?.blockedTimeoutMs ?? DEFAULT_BLOCKED_TIMEOUT_MS;

  const [browserEstimate, cacheStorage, indexedDb] = await Promise.all([
    readBrowserStorageEstimate(),
    inspectCacheStorage(activeCacheName, activeScopePath),
    inspectIndexedDb(activeDbName, blockedTimeoutMs),
  ]);
  const localStore = inspectLocalStore(ns.sandboxSuffix);

  const capyCacheBytes = Math.max(0, cacheStorage.totalBytes - cacheStorage.otherOriginBytes);
  const capyLocalBytes = Math.max(0, localStore.totalBytes - localStore.otherOriginBytes);
  const totalCapyMeasuredBytes = capyCacheBytes + indexedDb.totalBytes + capyLocalBytes;
  const totalOriginMeasuredBytes = cacheStorage.totalBytes + indexedDb.totalBytes + localStore.totalBytes;
  const unattributedBrowserBytes =
    browserEstimate.usageBytes !== null
      ? Math.max(0, browserEstimate.usageBytes - totalOriginMeasuredBytes)
      : 0;
  const activeOrphanedBytes =
    indexedDb.activeDb && !indexedDb.activeDb.orphanDetectionSkipped
      ? indexedDb.activeDb.orphanedBytes
      : 0;
  const totalReclaimableSafeBytes =
    cacheStorage.staleAlphaBytes +
    cacheStorage.staleVersionBytes +
    activeOrphanedBytes +
    localStore.cleanableQuarantineBytes;

  return {
    measuredAt: Date.now(),
    activeChannel: ns.channel,
    activeDbName,
    activeCacheName,
    activeScopePath,
    browserEstimate,
    cacheStorage,
    indexedDb,
    localStore,
    totalCapyMeasuredBytes,
    totalOriginMeasuredBytes,
    unattributedBrowserBytes,
    totalReclaimableSafeBytes,
  };
}

async function unregisterMatchingServiceWorkers(
  predicate: (scopePath: string) => boolean,
  activeScopePath: string
): Promise<number> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.serviceWorker ||
    typeof navigator.serviceWorker.getRegistrations !== 'function'
  ) {
    return 0;
  }
  let unregistered = 0;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const reg of registrations) {
      let scopePath = '/';
      try {
        scopePath = normalizePwaScopePath(new URL(reg.scope).pathname);
      } catch (err) {
        reportSwallowed('StorageAnalyzer.parseSwScope', err);
        continue;
      }
      if (scopePath === activeScopePath) continue;
      if (!predicate(scopePath)) continue;
      try {
        const ok = await reg.unregister();
        if (ok) unregistered += 1;
      } catch (err) {
        reportSwallowed('StorageAnalyzer.unregisterSw', err, { scopePath });
      }
    }
  } catch (err) {
    reportSwallowed('StorageAnalyzer.getSwRegistrations', err);
  }
  return unregistered;
}

async function safeDeleteDatabase(
  dbName: string,
  blockedTimeoutMs: number = DEFAULT_BLOCKED_TIMEOUT_MS
): Promise<{ deleted: boolean; blocked: boolean }> {
  await closeDbHandle(dbName);
  if (typeof indexedDB === 'undefined' || typeof indexedDB.deleteDatabase !== 'function') {
    return { deleted: false, blocked: false };
  }
  return await new Promise<{ deleted: boolean; blocked: boolean }>((resolve) => {
    let settled = false;
    let blockedTimer: ReturnType<typeof setTimeout> | null = null;
    const finish = (result: { deleted: boolean; blocked: boolean }) => {
      if (settled) return;
      settled = true;
      if (blockedTimer !== null) {
        clearTimeout(blockedTimer);
        blockedTimer = null;
      }
      resolve(result);
    };
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.deleteDatabase(dbName);
    } catch (err) {
      reportSwallowed('StorageAnalyzer.deleteDatabaseCall', err, { dbName });
      finish({ deleted: false, blocked: false });
      return;
    }
    req.onsuccess = () => finish({ deleted: true, blocked: false });
    req.onerror = () => finish({ deleted: false, blocked: false });
    req.onblocked = () => {
      if (blockedTimer === null) {
        blockedTimer = setTimeout(() => {
          finish({ deleted: false, blocked: true });
        }, Math.max(50, blockedTimeoutMs));
      }
    };
  });
}

function createEmptyCleanupResult(): StorageCleanupResult {
  return {
    ok: true,
    freedBytesEstimate: 0,
    deletedCaches: 0,
    deletedIdbRecords: 0,
    deletedIdbDatabases: 0,
    deletedLocalKeys: 0,
    unregisteredWorkers: 0,
    blockedDatabases: [],
    warnings: [],
  };
}

export async function clearStaleAndOfflineCaches(
  options?: StorageAnalyzerOptions
): Promise<StorageCleanupResult> {
  const result = createEmptyCleanupResult();
  const activeCacheName = resolvePwaCacheName(options?.scopeUrl, options?.version);
  const activeScopePath = resolveActiveScopePath(options);

  if (typeof caches !== 'undefined' && typeof caches.keys === 'function') {
    try {
      const names = await caches.keys();
      for (const name of names) {
        if (!isCapyCacheName(name)) continue;
        const summary = await inspectSingleCache(name, activeCacheName, activeScopePath);
        const deleted = await caches.delete(name);
        if (deleted) {
          result.deletedCaches += 1;
          result.freedBytesEstimate += summary.bytes;
        }
      }
    } catch (err) {
      reportSwallowed('StorageAnalyzer.clearStaleAndOfflineCaches', err);
      result.ok = false;
      result.warnings.push('Could not clear all browser offline caches.');
    }
  }

  result.unregisteredWorkers = await unregisterMatchingServiceWorkers(
    (scopePath) => isAlphaPreviewScopePath(scopePath),
    activeScopePath
  );
  return result;
}

function matchesLiveWindowNamespace(targetDbName: string): boolean {
  return targetDbName === resolveScopedDbName();
}

function snapshotMatchingLocalKeys(
  predicate: (key: string) => boolean
): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const [key, value] of SafeLocalStore.entries()) {
    if (!predicate(key)) continue;
    sizes.set(key, (key.length + value.length) * 2);
  }
  return sizes;
}

function removeAndCountLocalKeys(
  predicate: (key: string) => boolean,
  preMeasured: Map<string, number>,
  result: StorageCleanupResult
): void {
  const removedKeys = new Set<string>();
  for (const [key, value] of SafeLocalStore.entries()) {
    if (!predicate(key)) continue;
    if (SafeLocalStore.removeItem(key)) {
      removedKeys.add(key);
      result.deletedLocalKeys += 1;
      result.freedBytesEstimate += preMeasured.get(key) ?? (key.length + value.length) * 2;
    }
  }
  // Account for pre-measured keys already removed earlier by clearActiveState() / clearWithBackup()
  for (const [key, bytes] of preMeasured.entries()) {
    if (removedKeys.has(key)) continue;
    const read = SafeLocalStore.tryGetItem(key);
    if (read.ok && read.value === null) {
      result.deletedLocalKeys += 1;
      result.freedBytesEstimate += bytes;
    }
  }
}

export async function cleanOrphanedSaveData(
  options?: StorageAnalyzerOptions
): Promise<StorageCleanupResult> {
  const result = createEmptyCleanupResult();
  const ns = resolveStorageNamespace(options?.pathname, options?.origin, options?.search);
  const activeDbName = resolveScopedDbName(options?.pathname, options?.origin, options?.search);

  const blockedTimeoutMs = options?.blockedTimeoutMs ?? DEFAULT_BLOCKED_TIMEOUT_MS;

  // Recompute live references fail-closed right before deleting to prevent TOCTOU races
  const activeReport = await inspectSingleIdbDatabase(activeDbName, activeDbName, blockedTimeoutMs);
  if (activeReport?.orphanDetectionSkipped) {
    result.warnings.push(
      'Skipped IDB orphan cleanup because save metadata could not be verified safely.'
    );
  } else if (
    activeReport &&
    (activeReport.orphanedPuzzleKeys.length > 0 || activeReport.orphanedImageKeys.length > 0)
  ) {
    try {
      await deleteOrphanedEntries(
        activeReport.orphanedPuzzleKeys,
        activeReport.orphanedImageKeys,
        activeDbName
      );
      result.deletedIdbRecords +=
        activeReport.orphanedPuzzleKeys.length + activeReport.orphanedImageKeys.length;
      result.freedBytesEstimate += activeReport.orphanedBytes;
    } catch (err) {
      reportSwallowed('StorageAnalyzer.cleanOrphanedSaveDataIdb', err);
      result.ok = false;
      result.warnings.push('Failed to remove some orphaned IndexedDB records.');
    }
  }

  // Also remove stale __corrupt_quarantine keys in the active channel when their live key is healthy
  const entries = SafeLocalStore.entries();
  for (const [key, value] of entries) {
    if (!key.endsWith(QUARANTINE_SUFFIX) || !isCapyPaintLocalKey(key)) continue;
    const baseKeyWithSandbox = key.slice(0, -QUARANTINE_SUFFIX.length);
    const sandboxMatch = SANDBOX_SUFFIX_RE.exec(baseKeyWithSandbox);
    const keySuffix = sandboxMatch ? `__sandbox_${sandboxMatch[1].toLowerCase()}` : '';
    if (keySuffix !== ns.sandboxSuffix) continue;
    if (!isHealthyJsonLocalValue(SafeLocalStore.getItem(baseKeyWithSandbox))) continue;
    if (SafeLocalStore.removeItem(key)) {
      result.deletedLocalKeys += 1;
      result.freedBytesEstimate += (key.length + value.length) * 2;
    }
  }

  return result;
}

function scopeMatchesPreviewChannels(
  scopePath: string,
  targetChannels: Set<'alpha' | 'beta'>
): boolean {
  const matchesAlpha = targetChannels.has('alpha') && isAlphaPreviewScopePath(scopePath);
  const matchesBeta = targetChannels.has('beta') && BETA_SCOPE_RE.test(scopePath);
  return matchesAlpha || matchesBeta;
}

function isPreviewChannelLocalKey(
  key: string,
  targetChannels: Set<'alpha' | 'beta'>
): boolean {
  if (!isCapyPaintLocalKey(key)) return false;
  const match = SANDBOX_SUFFIX_RE.exec(key);
  if (!match) return false;
  const keyChannel = match[1].toLowerCase();
  if (keyChannel !== 'alpha' && keyChannel !== 'beta') return false;
  return targetChannels.has(keyChannel);
}

async function deletePreviewCaches(
  targetChannels: Set<'alpha' | 'beta'>,
  activeCacheName: string,
  activeScopePath: string,
  result: StorageCleanupResult
): Promise<void> {
  if (typeof caches === 'undefined' || typeof caches.keys !== 'function') return;
  try {
    const names = await caches.keys();
    for (const name of names) {
      if (!name.startsWith('capy-cache-v')) continue;
      const colonIdx = name.indexOf(':');
      if (colonIdx === -1) continue;
      const scopePath = normalizePwaScopePath(name.slice(colonIdx + 1));
      if (!scopeMatchesPreviewChannels(scopePath, targetChannels)) continue;
      const summary = await inspectSingleCache(name, activeCacheName, activeScopePath);
      if (await caches.delete(name)) {
        result.deletedCaches += 1;
        result.freedBytesEstimate += summary.bytes;
      }
    }
  } catch (err) {
    reportSwallowed('StorageAnalyzer.clearPreviewCaches', err);
    result.warnings.push('Could not delete all preview caches.');
  }
}

function deletePreviewLocalKeys(
  targetChannels: Set<'alpha' | 'beta'>,
  preMeasuredLocalKeys: Map<string, number>,
  result: StorageCleanupResult
): void {
  removeAndCountLocalKeys(
    (key) => isPreviewChannelLocalKey(key, targetChannels),
    preMeasuredLocalKeys,
    result
  );
}

async function deletePreviewDatabases(
  targetChannels: Set<'alpha' | 'beta'>,
  activeDbName: string,
  affectedActiveChannel: boolean,
  blockedTimeoutMs: number,
  preMeasuredDbSizes: Map<string, number>,
  result: StorageCleanupResult
): Promise<void> {
  for (const channel of targetChannels) {
    const dbName = `capy_game_storage_v8_${channel}`;
    const beforeBytes = preMeasuredDbSizes.get(dbName);
    if (beforeBytes === undefined && !affectedActiveChannel) continue;
    const del = await safeDeleteDatabase(dbName, blockedTimeoutMs);
    if (del.deleted) {
      if (beforeBytes !== undefined) {
        result.deletedIdbDatabases += 1;
        result.freedBytesEstimate += beforeBytes;
      }
    } else if (del.blocked) {
      result.blockedDatabases.push(dbName);
      let cleared = false;
      if (dbName === activeDbName || beforeBytes !== undefined) {
        cleared = await clearAllStores(dbName, blockedTimeoutMs);
        if (cleared && beforeBytes !== undefined) {
          result.freedBytesEstimate += beforeBytes;
        }
      }
      if (cleared) {
        result.warnings.push(
          `Database ${dbName} is open in another tab; data was cleared, close other Capy tabs to finish removing it.`
        );
      } else {
        result.warnings.push(
          `Database ${dbName} is open in another tab and could not be cleared until other Capy tabs are closed.`
        );
      }
    }
  }
}

export async function clearPreviewChannelData(
  options?: StorageAnalyzerOptions & { channels?: Array<'alpha' | 'beta'> }
): Promise<StorageCleanupResult & { affectedActiveChannel: boolean }> {
  const result = createEmptyCleanupResult();
  const targetChannels = new Set<'alpha' | 'beta'>(options?.channels ?? ['alpha', 'beta']);
  const ns = resolveStorageNamespace(options?.pathname, options?.origin, options?.search);
  const activeCacheName = resolvePwaCacheName(options?.scopeUrl, options?.version);
  const activeScopePath = resolveActiveScopePath(options);
  const blockedTimeoutMs = options?.blockedTimeoutMs ?? DEFAULT_BLOCKED_TIMEOUT_MS;
  const affectedActiveChannel =
    ns.isSandboxed &&
    (ns.channel === 'alpha' || ns.channel === 'beta') &&
    targetChannels.has(ns.channel);

  // 1. Pre-measure preview IDB sizes & Local Storage keys BEFORE any destructive clears
  const preMeasuredDbSizes = new Map<string, number>();
  for (const channel of targetChannels) {
    const dbName = `capy_game_storage_v8_${channel}`;
    const inspected = await inspectSingleIdbDatabase(dbName, ns.dbName, blockedTimeoutMs);
    if (inspected) {
      preMeasuredDbSizes.set(dbName, inspected.totalBytes);
    }
  }
  const preMeasuredLocalKeys = snapshotMatchingLocalKeys((key) =>
    isPreviewChannelLocalKey(key, targetChannels)
  );

  // 2. Only invoke window.location-bound snapshot/active clears when options match live window namespace
  if (affectedActiveChannel && matchesLiveWindowNamespace(ns.dbName)) {
    await clearAllSnapshots();
    clearActiveState();
  }

  // 3. Delete preview caches, stale preview SWs, preview IDBs, then preview Local Storage keys
  await deletePreviewCaches(targetChannels, activeCacheName, activeScopePath, result);
  result.unregisteredWorkers = await unregisterMatchingServiceWorkers(
    (scopePath) => scopeMatchesPreviewChannels(scopePath, targetChannels),
    activeScopePath
  );
  await deletePreviewDatabases(
    targetChannels,
    ns.dbName,
    affectedActiveChannel,
    blockedTimeoutMs,
    preMeasuredDbSizes,
    result
  );
  deletePreviewLocalKeys(targetChannels, preMeasuredLocalKeys, result);

  return { ...result, affectedActiveChannel };
}

async function deleteAllCapyDatabases(
  activeDbName: string,
  capyDbNames: string[],
  dbSizes: Map<string, number>,
  blockedTimeoutMs: number,
  result: StorageCleanupResult
): Promise<void> {
  const allCapyDbs = Array.from(
    new Set<string>([
      'capy_game_storage_v8',
      'capy_game_storage_v8_beta',
      'capy_game_storage_v8_alpha',
      activeDbName,
      ...capyDbNames,
    ])
  );
  for (const dbName of allCapyDbs) {
    const del = await safeDeleteDatabase(dbName, blockedTimeoutMs);
    if (del.deleted) {
      if (dbSizes.has(dbName)) {
        result.deletedIdbDatabases += 1;
        result.freedBytesEstimate += dbSizes.get(dbName) ?? 0;
      }
      continue;
    }
    if (del.blocked) {
      result.blockedDatabases.push(dbName);
      let cleared = false;
      if (dbName === activeDbName || dbSizes.has(dbName)) {
        cleared = await clearAllStores(dbName, blockedTimeoutMs);
        if (cleared) {
          result.freedBytesEstimate += dbSizes.get(dbName) ?? 0;
        }
      }
      if (cleared) {
        result.warnings.push(
          `Database ${dbName} is open in another tab; data was cleared but close other tabs to finish cleanup.`
        );
      } else {
        result.warnings.push(
          `Database ${dbName} is open in another tab and could not be cleared until other Capy tabs are closed.`
        );
      }
    }
  }
}

export async function clearAllCapyStorage(
  options?: StorageAnalyzerOptions
): Promise<StorageCleanupResult & { affectedActiveChannel: boolean }> {
  const result = createEmptyCleanupResult();
  const ns = resolveStorageNamespace(options?.pathname, options?.origin, options?.search);
  const activeDbName = ns.dbName;
  const blockedTimeoutMs = options?.blockedTimeoutMs ?? DEFAULT_BLOCKED_TIMEOUT_MS;

  // 1. Pre-measure Capy IDB databases AND Capy Local Storage keys before clearing so freedBytesEstimate & deletedLocalKeys are accurate
  const { capyDbNames } = await discoverIdbNames(activeDbName);
  const dbSizes = new Map<string, number>();
  for (const dbName of capyDbNames) {
    const inspected = await inspectSingleIdbDatabase(dbName, activeDbName, blockedTimeoutMs);
    if (inspected) {
      dbSizes.set(dbName, inspected.totalBytes);
    }
  }
  const preMeasuredLocalKeys = snapshotMatchingLocalKeys((key) => isCapyPaintLocalKey(key));

  // 2. Cancel pending BackupEngine writes and clear Android native backups when matching live channel
  if (matchesLiveWindowNamespace(activeDbName)) {
    await clearAllSnapshots();
    clearActiveState();
    clearWithBackup(
      resolveScopedStorageKey(SETTINGS_KEY, options?.pathname, options?.origin, options?.search),
      resolveScopedBackupKey(SETTINGS_KEY, options?.pathname, options?.origin, options?.search)
    );
  }
  clearAllPreviewCaches();

  // 3. Delete all Capy caches (NEVER touch non-Capy origin caches)
  const cacheCleanup = await clearStaleAndOfflineCaches(options);
  result.deletedCaches += cacheCleanup.deletedCaches;
  result.unregisteredWorkers += cacheCleanup.unregisteredWorkers;
  result.freedBytesEstimate += cacheCleanup.freedBytesEstimate;
  result.warnings.push(...cacheCleanup.warnings);

  // 4. Close and delete all Capy IndexedDB databases (fallback to clearAllStores(dbName) if blocked)
  await deleteAllCapyDatabases(activeDbName, capyDbNames, dbSizes, blockedTimeoutMs, result);

  // 5. Remove all Capy Paint Local Storage keys across channels (NEVER touch CapyGame or other origin keys)
  removeAndCountLocalKeys((key) => isCapyPaintLocalKey(key), preMeasuredLocalKeys, result);

  // Re-ensure active scoped snapshot/session/settings keys don't linger
  SafeLocalStore.removeItem(
    resolveScopedStorageKey(SNAPSHOTS_KEY, options?.pathname, options?.origin, options?.search)
  );
  SafeLocalStore.removeItem(
    resolveScopedStorageKey(ACTIVE_STATE_KEY, options?.pathname, options?.origin, options?.search)
  );
  SafeLocalStore.removeItem(
    resolveScopedStorageKey(SETTINGS_KEY, options?.pathname, options?.origin, options?.search)
  );

  return { ...result, affectedActiveChannel: true };
}
