import { DEFAULT_GENERATOR_CONFIG, PaletteColor, PuzzleData, SavedSnapshot, UserSettings } from '../types';
import {
  base64ToUint8,
  buildBorderMapFromRegionMap,
  CompactPuzzleRecordV2,
  compressPuzzleRecord,
  decodeBinarySaveV2,
  decompressPuzzleRecord,
  encodeArchiveSaveBinaryV2,
  encodeSingleSaveBinaryV2,
  estimateCompactPuzzleBytes,
  hasBinaryMagicHeader,
  isCompactPuzzleRecordV2,
  serializableToRecord,
  uint8ToBase64,
} from './CapyCodec';
import { NativeBridge } from './NativeBridge';
import {
  resolveScopedBackupKey,
  resolveScopedDbName,
  resolveScopedStorageKey,
} from './StorageNamespace';

const SETTINGS_KEY = 'capy_user_settings_v8';
const UNDO_DEFAULT_MIGRATED_KEY = 'capy_undo_default_migrated_v1';
const SNAPSHOTS_KEY = 'capy_snapshots_v8';
const ACTIVE_STATE_KEY = 'capy_active_session_v8';
const DB_VERSION = 1;
const STORE_PUZZLES = 'puzzles';
const STORE_IMAGES = 'images';

export const DEFAULT_SETTINGS: UserSettings = {
  autoAdvance: true,
  difficulty: 'EASY',
  isPaintMode: false,
  isFreeColorMode: false,
  raisePaletteDock: true,
  regionColorMode: 'DETAIL',
  canvasBgColor: 'CHARCOAL',
  canvasBgArgb: 0xff18181b,
  saveSortOrder: 'LAST_ACTIVE',
  showSavePreviews: true,
  highlightStyle: 'FULL_REGION',
  hintFillStyle: 'CHECKER',
  hintColorArgb: 0xfffbbf24,
  showRegionLabels: true,
  showPreviewLabels: false,
  showPreviewBorders: false,
  highlightMatching: true,
  animateHint: true,
  showNextRegionHint: true,
  hintIntensity: 0.65,
  labelScale: 1.0,
  minLabelSize: 6,
  maxLabelSize: 18,
  showZoomButtons: false,
  showResetViewButton: false,
  paletteSort: 'HUE',
  prioritizeOnScreen: false,
  hapticsEnabled: true,
  panMomentum: true,
  enableCustomColorForAllPuzzles: false,
  enableUndo: true,
  replaySpeed: 1,
  autoReplayOnLoad: true,
  replayLoop: false,
  replayFollow: false,
  reverseDoubleTapZoom: false,
  zoomSensitivity: 1.0,
  snapZoomLevels: false,
  soundEnabled: true,
  soundVolume: 0.7,
  reducedMotion: false,
  largeText: false,
  detailedLoadingProgress: false,
  generatorConfig: { ...DEFAULT_GENERATOR_CONFIG },
};

function detectSystemReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
  } catch {
    return false;
  }
}

export interface QuotaWarning {
  reason: 'quota';
  key: string;
  message: string;
}

type BackupDataKind = 'snapshots' | 'settings' | 'activeState';

interface BackupCandidateMetrics {
  parseOk: boolean;
  nonEmpty: boolean;
  maxTs: number;
  knownFieldCount: number;
  fieldCount: number;
  snapshotEpochs: Map<string, number>;
  totalFilled: number;
  count: number;
  completeness: number;
  hasSnapshotId: boolean;
  snapshotId: string;
  resetEpoch: number;
  paintedPlusFilled: number;
}

export class StorageService {
  private static dbPromises = new Map<string, Promise<IDBDatabase>>();
  private static quotaListeners = new Set<(warning: QuotaWarning) => void>();
  private static persistentStorageRequested = false;
  private static pendingBackupWrites = new Map<string, string>();
  private static pendingForcedBackupKeys = new Set<string>();
  private static staleNativeBackupKeys = new Set<string>();
  private static quotaFailedLocalKeys = new Set<string>();
  private static quotaFailedDeleteKeys = new Set<string>();
  private static backupFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private static lifecycleFlushRegistered = false;
  private static previewCache = new Map<string, string>();

  static isQuotaError(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const rec = err as { name?: unknown; code?: unknown; message?: unknown };
    const name = typeof rec.name === 'string' ? rec.name : '';
    const code = typeof rec.code === 'number' ? rec.code : 0;
    const msg = typeof rec.message === 'string' ? rec.message : '';
    return (
      name === 'QuotaExceededError' ||
      name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      code === 22 ||
      code === 1014 ||
      /quota/i.test(msg)
    );
  }

  static onQuotaWarning(listener: (warning: QuotaWarning) => void): () => void {
    this.quotaListeners.add(listener);
    return () => {
      this.quotaListeners.delete(listener);
    };
  }

  private static notifyQuotaWarning(key: string): void {
    const warning: QuotaWarning = {
      reason: 'quota',
      key,
      message: 'Browser storage is full. Export older saves or free space to keep your progress safe.',
    };
    for (const listener of this.quotaListeners) {
      try {
        listener(warning);
      } catch {
        // Ignore listener failure
      }
    }
    try {
      if (
        typeof window !== 'undefined' &&
        typeof window.dispatchEvent === 'function' &&
        typeof CustomEvent === 'function'
      ) {
        window.dispatchEvent(new CustomEvent('capy:storage-quota', { detail: warning }));
      }
    } catch {
      // Ignore event dispatch failure in headless mocks
    }
  }

  static requestPersistentStorageOnce(): void {
    if (this.persistentStorageRequested) return;
    this.persistentStorageRequested = true;
    try {
      if (
        typeof navigator !== 'undefined' &&
        navigator.storage &&
        typeof navigator.storage.persist === 'function'
      ) {
        void navigator.storage.persist().catch(() => {});
      }
    } catch {
      // Ignore unsupported storage.persist
    }
  }

  private static ensureLifecycleFlushRegistered(): void {
    if (this.lifecycleFlushRegistered) return;
    this.lifecycleFlushRegistered = true;
    const flush = () => this.flushPendingBackups();
    try {
      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('pagehide', flush);
      }
      if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'hidden') {
            flush();
          }
        });
      }
    } catch {
      // Ignore partial SSR/DOM mocks
    }
  }

  static flushPendingBackups(): void {
    if (this.backupFlushTimer !== null) {
      clearTimeout(this.backupFlushTimer);
      this.backupFlushTimer = null;
    }
    const isNative = NativeBridge.isNative;
    if (!isNative) {
      this.staleNativeBackupKeys.clear();
      this.pendingForcedBackupKeys.clear();
    }
    if (this.pendingBackupWrites.size === 0) return;
    const entries = Array.from(this.pendingBackupWrites.entries());
    this.pendingBackupWrites.clear();
    for (const [backupKey, serialized] of entries) {
      const isForced = this.pendingForcedBackupKeys.has(backupKey);
      if (this.isSnapshotsBackupKey(backupKey) && this.isEmptySnapshotsPayload(serialized) && !isForced) {
        this.pendingForcedBackupKeys.delete(backupKey);
        continue;
      }
      let ok = false;
      try {
        ok = NativeBridge.saveBackup(backupKey, serialized);
      } catch {
        ok = false;
      }
      if (!isNative || ok) {
        this.staleNativeBackupKeys.delete(backupKey);
        this.pendingForcedBackupKeys.delete(backupKey);
      } else {
        this.staleNativeBackupKeys.add(backupKey);
        this.pendingBackupWrites.set(backupKey, serialized);
        if (isForced) {
          this.pendingForcedBackupKeys.add(backupKey);
        }
      }
    }
  }

  private static scheduleBackupWrite(
    backupKey: string,
    serialized: string,
    immediate: boolean = false
  ): void {
    const isEmptySnapshot = this.isSnapshotsBackupKey(backupKey) && this.isEmptySnapshotsPayload(serialized);
    if (!immediate && isEmptySnapshot) {
      return;
    }
    const isEmptyActive =
      this.matchesScopedKey(backupKey, ACTIVE_STATE_KEY) && serialized.trim().length === 0;
    this.ensureLifecycleFlushRegistered();
    if (immediate) {
      this.pendingBackupWrites.delete(backupKey);
      this.pendingForcedBackupKeys.delete(backupKey);
      const isNative = NativeBridge.isNative;
      let ok = false;
      try {
        ok = NativeBridge.saveBackup(backupKey, serialized);
      } catch {
        ok = false;
      }
      if (!isNative || ok) {
        this.staleNativeBackupKeys.delete(backupKey);
        this.pendingForcedBackupKeys.delete(backupKey);
      } else {
        this.staleNativeBackupKeys.add(backupKey);
        this.pendingBackupWrites.set(backupKey, serialized);
        if (isEmptySnapshot || isEmptyActive) {
          this.pendingForcedBackupKeys.add(backupKey);
        }
      }
      return;
    }
    this.pendingForcedBackupKeys.delete(backupKey);
    this.pendingBackupWrites.set(backupKey, serialized);
    if (this.backupFlushTimer === null) {
      this.backupFlushTimer = setTimeout(() => {
        this.backupFlushTimer = null;
        this.flushPendingBackups();
      }, 400);
      if (
        typeof this.backupFlushTimer === 'object' &&
        this.backupFlushTimer !== null &&
        typeof (this.backupFlushTimer as { unref?: () => void }).unref === 'function'
      ) {
        (this.backupFlushTimer as { unref: () => void }).unref();
      }
    }
  }

  private static safeLocalGet(storageKey: string): string | null {
    try {
      if (typeof localStorage === 'undefined' || localStorage === null) return null;
      return localStorage.getItem(storageKey);
    } catch {
      return null;
    }
  }

  private static safeLocalHeal(storageKey: string, value: string): void {
    try {
      if (typeof localStorage === 'undefined' || localStorage === null) return;
      localStorage.setItem(storageKey, value);
      this.quotaFailedLocalKeys.delete(storageKey);
      this.quotaFailedDeleteKeys.delete(storageKey);
    } catch {
      // Best-effort heal without triggering user-facing quota warning
    }
  }

  private static safeNativeLoadBackup(backupKey: string): string | null {
    try {
      const val = NativeBridge.loadBackup(backupKey);
      return val && val.length > 0 ? val : null;
    } catch {
      return null;
    }
  }

  private static matchesScopedKey(candidateKey: string, baseKey: string): boolean {
    return candidateKey === baseKey || candidateKey.startsWith(`${baseKey}__`);
  }

  private static isSnapshotsBackupKey(backupKey: string): boolean {
    return this.matchesScopedKey(backupKey, SNAPSHOTS_KEY);
  }

  private static isEmptySnapshotsPayload(serialized: string): boolean {
    const trimmed = serialized.trim();
    if (trimmed.length === 0 || trimmed === '[]') return true;
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) && parsed.length === 0;
    } catch {
      return false;
    }
  }

  private static parseTimestampMs(val: unknown): number {
    return typeof val === 'number' && Number.isFinite(val) && val > 0 ? val : 0;
  }

  private static nonNegFinite(val: unknown): number {
    return typeof val === 'number' && Number.isFinite(val) && val >= 0 ? val : 0;
  }

  private static extractObjectTimestamp(obj: Record<string, unknown>): number {
    return Math.max(
      this.parseTimestampMs(obj.savedAt),
      this.parseTimestampMs(obj.updatedAt),
      this.parseTimestampMs(obj.timestamp),
      this.parseTimestampMs(obj.lastModified)
    );
  }

  private static inspectCandidate(raw: string, kind: BackupDataKind): BackupCandidateMetrics {
    const snapshotEpochs = new Map<string, number>();
    const base: BackupCandidateMetrics = {
      parseOk: false,
      nonEmpty: false,
      maxTs: 0,
      knownFieldCount: 0,
      fieldCount: 0,
      snapshotEpochs,
      totalFilled: 0,
      count: 0,
      completeness: 0,
      hasSnapshotId: false,
      snapshotId: '',
      resetEpoch: 0,
      paintedPlusFilled: 0,
    };
    const trimmed = raw.trim();
    if (trimmed.length === 0) return base;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return base;
    }

    if (kind === 'snapshots') {
      if (!Array.isArray(parsed)) return base;
      const valid = parsed.filter((s): s is Record<string, unknown> =>
        Boolean(
          s &&
            typeof s === 'object' &&
            !Array.isArray(s) &&
            typeof (s as Record<string, unknown>).id === 'string' &&
            ((s as Record<string, unknown>).id as string).length > 0 &&
            typeof (s as Record<string, unknown>).title === 'string'
        )
      );
      let maxTs = 0;
      let totalFilled = 0;
      let completeness = 0;
      for (const s of valid) {
        const sid = s.id as string;
        const ts = Math.max(this.parseTimestampMs(s.lastOpened), this.parseTimestampMs(s.timestamp));
        if (ts > maxTs) maxTs = ts;
        const epoch = this.nonNegFinite(s.resetEpoch);
        snapshotEpochs.set(sid, Math.max(snapshotEpochs.get(sid) ?? 0, epoch));
        const filledIdsCount = Array.isArray(s.filledRegionIds)
          ? s.filledRegionIds.filter((id) => typeof id === 'number' && Number.isFinite(id)).length
          : 0;
        totalFilled += Math.max(this.nonNegFinite(s.filledCount), filledIdsCount);
        const totalCountBonus =
          typeof s.totalCount === 'number' && Number.isFinite(s.totalCount) && s.totalCount > 0 ? 1 : 0;
        const paletteBonus = Array.isArray(s.customPalette) ? 1 : 0;
        const sourceBonus = s.sourceRef ? 1 : 0;
        const paintedBonus =
          s.paintedRegionColors && typeof s.paintedRegionColors === 'object' && !Array.isArray(s.paintedRegionColors)
            ? Object.keys(s.paintedRegionColors as Record<string, unknown>).length
            : 0;
        completeness += totalCountBonus + paletteBonus + sourceBonus + paintedBonus;
      }
      return {
        ...base,
        parseOk: true,
        nonEmpty: valid.length > 0,
        maxTs,
        totalFilled,
        count: valid.length,
        completeness,
      };
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return base;
    }

    const rec = parsed as Record<string, unknown>;
    const keys = Object.keys(rec);
    const nonEmpty = keys.length > 0;
    const maxTs = this.extractObjectTimestamp(rec);

    if (kind === 'settings') {
      const knownFieldCount = keys.filter(
        (k) =>
          (Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, k) || k === 'undoDefaultMigrated') &&
          rec[k] !== undefined
      ).length;
      return {
        ...base,
        parseOk: true,
        nonEmpty,
        maxTs,
        knownFieldCount,
        fieldCount: keys.length,
      };
    }

    const snapshotId = typeof rec.activeSnapshotId === 'string' ? rec.activeSnapshotId.trim() : '';
    const hasSnapshotId = snapshotId.length > 0;
    const resetEpoch = this.nonNegFinite(rec.resetEpoch);
    const filledCount = Array.isArray(rec.filledRegionIds)
      ? rec.filledRegionIds.filter((id) => typeof id === 'number' && Number.isFinite(id)).length
      : 0;
    const paintedCount =
      rec.paintedRegionColors && typeof rec.paintedRegionColors === 'object' && !Array.isArray(rec.paintedRegionColors)
        ? Object.keys(rec.paintedRegionColors as Record<string, unknown>).length
        : 0;
    return {
      ...base,
      parseOk: true,
      nonEmpty,
      maxTs,
      hasSnapshotId,
      snapshotId,
      resetEpoch,
      paintedPlusFilled: filledCount + paintedCount,
      fieldCount: keys.length,
    };
  }

  private static isValidNonEmptyPayload(raw: string, kind: BackupDataKind): boolean {
    const metrics = this.inspectCandidate(raw, kind);
    return metrics.parseOk && metrics.nonEmpty;
  }

  private static pickWinner(
    localRaw: string,
    backupRaw: string,
    kind: BackupDataKind,
    preferBackupOnTie: boolean,
    forceBackupWins: boolean = false
  ): string {
    const a = this.inspectCandidate(localRaw, kind);
    const b = this.inspectCandidate(backupRaw, kind);

    if (a.parseOk !== b.parseOk) return a.parseOk ? localRaw : backupRaw;
    if (preferBackupOnTie && b.parseOk && (forceBackupWins || b.maxTs >= a.maxTs)) {
      return backupRaw;
    }
    if (a.nonEmpty !== b.nonEmpty) return a.nonEmpty ? localRaw : backupRaw;

    if (a.maxTs !== b.maxTs) return a.maxTs > b.maxTs ? localRaw : backupRaw;

    if (kind === 'snapshots') {
      let aHasHigherEpoch = false;
      let bHasHigherEpoch = false;
      for (const [id, epochA] of a.snapshotEpochs) {
        const epochB = b.snapshotEpochs.get(id);
        if (epochB === undefined) continue;
        if (epochA > epochB) aHasHigherEpoch = true;
        else if (epochB > epochA) bHasHigherEpoch = true;
      }
      if (aHasHigherEpoch !== bHasHigherEpoch) {
        return aHasHigherEpoch ? localRaw : backupRaw;
      }
      if (a.totalFilled !== b.totalFilled) return a.totalFilled > b.totalFilled ? localRaw : backupRaw;
      if (a.count !== b.count) return a.count > b.count ? localRaw : backupRaw;
      if (a.completeness !== b.completeness) return a.completeness > b.completeness ? localRaw : backupRaw;
      return preferBackupOnTie ? backupRaw : localRaw;
    }

    if (kind === 'settings') {
      if (a.knownFieldCount !== b.knownFieldCount) {
        return a.knownFieldCount > b.knownFieldCount ? localRaw : backupRaw;
      }
      if (a.fieldCount !== b.fieldCount) return a.fieldCount > b.fieldCount ? localRaw : backupRaw;
      return preferBackupOnTie ? backupRaw : localRaw;
    }

    if (a.hasSnapshotId !== b.hasSnapshotId) return a.hasSnapshotId ? localRaw : backupRaw;
    if (a.snapshotId === b.snapshotId && a.resetEpoch !== b.resetEpoch) {
      return a.resetEpoch > b.resetEpoch ? localRaw : backupRaw;
    }
    if (a.paintedPlusFilled !== b.paintedPlusFilled) {
      return a.paintedPlusFilled > b.paintedPlusFilled ? localRaw : backupRaw;
    }
    if (a.fieldCount !== b.fieldCount) return a.fieldCount > b.fieldCount ? localRaw : backupRaw;
    return preferBackupOnTie ? backupRaw : localRaw;
  }

  private static selectPreferredBackupRaw(
    pendingRaw: string | null,
    nativeRaw: string | null,
    kind: BackupDataKind
  ): string | null {
    const hasPending = Boolean(pendingRaw && pendingRaw.length > 0);
    const hasNative = Boolean(nativeRaw && nativeRaw.length > 0);
    if (hasPending && hasNative) {
      if (this.isValidNonEmptyPayload(pendingRaw!, kind)) return pendingRaw!;
      if (this.isValidNonEmptyPayload(nativeRaw!, kind)) return nativeRaw!;
      return pendingRaw!;
    }
    if (hasPending) return pendingRaw!;
    if (hasNative) return nativeRaw!;
    return null;
  }

  private static loadRawWithBackupFallback(
    storageKey: string,
    backupKey: string,
    kind: BackupDataKind
  ): string | null {
    const localVal = this.safeLocalGet(storageKey);
    const hasPending = this.pendingBackupWrites.has(backupKey);
    const pendingRaw = hasPending ? (this.pendingBackupWrites.get(backupKey) ?? null) : null;
    const nativeRaw = this.staleNativeBackupKeys.has(backupKey)
      ? null
      : this.safeNativeLoadBackup(backupKey);

    const isForcedEmptyActive =
      kind === 'activeState' &&
      ((this.pendingForcedBackupKeys.has(backupKey) && pendingRaw !== null && pendingRaw.trim().length === 0) ||
        (this.quotaFailedDeleteKeys.has(storageKey) && (!hasPending || (pendingRaw !== null && pendingRaw.trim().length === 0))));
    if (isForcedEmptyActive) {
      return null;
    }

    const backupVal = this.selectPreferredBackupRaw(pendingRaw, nativeRaw, kind);

    if (!backupVal) {
      if (kind === 'snapshots' && this.quotaFailedDeleteKeys.has(storageKey) && !NativeBridge.isNative) {
        return '[]';
      }
      return localVal && localVal.length > 0 ? localVal : null;
    }
    if (!localVal || localVal.length === 0) {
      if (this.isValidNonEmptyPayload(backupVal, kind)) {
        this.safeLocalHeal(storageKey, backupVal);
      }
      return backupVal;
    }
    if (localVal === backupVal) {
      this.quotaFailedLocalKeys.delete(storageKey);
      this.quotaFailedDeleteKeys.delete(storageKey);
      return localVal;
    }
    const preferBackupOnTie = this.quotaFailedLocalKeys.has(storageKey);
    const forceBackupWins =
      preferBackupOnTie &&
      (this.quotaFailedDeleteKeys.has(storageKey) || this.pendingForcedBackupKeys.has(backupKey));
    const selected = this.pickWinner(localVal, backupVal, kind, preferBackupOnTie, forceBackupWins);
    if (
      selected !== localVal &&
      (this.isValidNonEmptyPayload(selected, kind) || this.quotaFailedDeleteKeys.has(storageKey))
    ) {
      this.safeLocalHeal(storageKey, selected);
    }
    return selected;
  }

  private static writeLocalAndScheduleBackup(
    storageKey: string,
    backupKey: string,
    serialized: string,
    immediateBackup: boolean = false,
    skipBackup: boolean = false,
    clearLocalOnFailure: boolean = false
  ): void {
    try {
      if (typeof localStorage !== 'undefined' && localStorage !== null) {
        localStorage.setItem(storageKey, serialized);
        this.quotaFailedLocalKeys.delete(storageKey);
        this.quotaFailedDeleteKeys.delete(storageKey);
      }
    } catch (err) {
      if (!skipBackup) {
        this.quotaFailedLocalKeys.add(storageKey);
        if (clearLocalOnFailure) {
          this.quotaFailedDeleteKeys.add(storageKey);
        } else {
          this.quotaFailedDeleteKeys.delete(storageKey);
        }
      }
      if (clearLocalOnFailure) {
        try {
          if (typeof localStorage !== 'undefined' && localStorage !== null) {
            localStorage.removeItem(storageKey);
          }
        } catch {
          // Ignore removeItem failure when storage is restricted/full
        }
      }
      if (this.isQuotaError(err)) {
        this.notifyQuotaWarning(storageKey);
      }
    }
    if (skipBackup) {
      return;
    }
    try {
      this.scheduleBackupWrite(backupKey, serialized, immediateBackup);
    } catch {
      // Ignore native backup failure
    }
  }

  private static previewCacheKey(id: string): string {
    return `${resolveScopedDbName()}::${id}`;
  }

  private static previewStoreKey(id: string): string {
    return `preview_${id}`;
  }

  private static getDB(): Promise<IDBDatabase> {
    const dbName = resolveScopedDbName();
    let existing = this.dbPromises.get(dbName);
    if (!existing) {
      existing = new Promise((resolve, reject) => {
        const req = indexedDB.open(dbName, DB_VERSION);
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
          this.dbPromises.delete(dbName);
          reject(new Error('IndexedDB open blocked'));
        };
        req.onsuccess = () => {
          const db = req.result;
          db.onversionchange = () => {
            try {
              db.close();
            } catch {
              // ignore
            }
            this.dbPromises.delete(dbName);
          };
          db.onclose = () => {
            this.dbPromises.delete(dbName);
          };
          resolve(db);
        };
        req.onerror = () => {
          this.dbPromises.delete(dbName);
          reject(req.error);
        };
      });
      this.dbPromises.set(dbName, existing);
    }
    return existing;
  }

  private static async runTransaction(
    storeNames: string | string[],
    work: (tx: IDBTransaction) => void
  ): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeNames, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
      work(tx);
    });
  }

  static loadSettings(): UserSettings {
    const systemReducedMotion = detectSystemReducedMotion();
    try {
      const storageKey = resolveScopedStorageKey(SETTINGS_KEY);
      const backupKey = resolveScopedBackupKey(SETTINGS_KEY);
      const raw = this.loadRawWithBackupFallback(storageKey, backupKey, 'settings');
      if (!raw) {
        return {
          ...DEFAULT_SETTINGS,
          reducedMotion: systemReducedMotion,
        };
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {
          ...DEFAULT_SETTINGS,
          reducedMotion: systemReducedMotion,
        };
      }
      const rawZoomSensitivity = Number(parsed.zoomSensitivity);
      const zoomSensitivity = Number.isFinite(rawZoomSensitivity)
        ? Math.min(2.0, Math.max(0.5, rawZoomSensitivity))
        : DEFAULT_SETTINGS.zoomSensitivity;
      const snapZoomLevels =
        typeof parsed.snapZoomLevels === 'boolean'
          ? parsed.snapZoomLevels
          : DEFAULT_SETTINGS.snapZoomLevels;
      const soundEnabled =
        typeof parsed.soundEnabled === 'boolean'
          ? parsed.soundEnabled
          : DEFAULT_SETTINGS.soundEnabled;
      const rawSoundVolume = Number(parsed.soundVolume);
      const soundVolume = Number.isFinite(rawSoundVolume)
        ? Math.min(1.0, Math.max(0.0, rawSoundVolume))
        : DEFAULT_SETTINGS.soundVolume;
      const reducedMotion =
        typeof parsed.reducedMotion === 'boolean' ? parsed.reducedMotion : systemReducedMotion;
      const largeText =
        typeof parsed.largeText === 'boolean' ? parsed.largeText : DEFAULT_SETTINGS.largeText;
      const undoMigrationKey = resolveScopedStorageKey(UNDO_DEFAULT_MIGRATED_KEY);
      const hasUndoMigration =
        Boolean((parsed as Record<string, unknown>).undoDefaultMigrated) ||
        this.safeLocalGet(undoMigrationKey) === '1';
      const enableUndo = hasUndoMigration
        ? typeof parsed.enableUndo === 'boolean'
          ? parsed.enableUndo
          : DEFAULT_SETTINGS.enableUndo
        : true;
      const difficulty =
        parsed.difficulty === 'EASY' || parsed.difficulty === 'NORMAL'
          ? parsed.difficulty
          : DEFAULT_SETTINGS.difficulty;
      const saveSortOrder =
        parsed.saveSortOrder === 'LAST_ACTIVE' ||
        parsed.saveSortOrder === 'DATE' ||
        parsed.saveSortOrder === 'PERCENT_COMPLETE'
          ? parsed.saveSortOrder
          : DEFAULT_SETTINGS.saveSortOrder;
      const paletteSort =
        parsed.paletteSort === 'NUMBER' ||
        parsed.paletteSort === 'REMAINING' ||
        parsed.paletteSort === 'HUE' ||
        parsed.paletteSort === 'LIGHTNESS'
          ? parsed.paletteSort
          : DEFAULT_SETTINGS.paletteSort;
      const highlightStyle =
        parsed.highlightStyle === 'CENTROID_GLOW' ||
        parsed.highlightStyle === 'NUMBER_ONLY' ||
        parsed.highlightStyle === 'FULL_REGION' ||
        parsed.highlightStyle === 'BOUNDARY_ONLY'
          ? parsed.highlightStyle
          : DEFAULT_SETTINGS.highlightStyle;
      const hintFillStyle =
        parsed.hintFillStyle === 'CHECKER' ||
        parsed.hintFillStyle === 'STRIPES' ||
        parsed.hintFillStyle === 'SOLID'
          ? parsed.hintFillStyle
          : DEFAULT_SETTINGS.hintFillStyle;
      const regionColorMode =
        parsed.regionColorMode === 'SOLID' || parsed.regionColorMode === 'DETAIL'
          ? parsed.regionColorMode
          : DEFAULT_SETTINGS.regionColorMode;
      const rawReplaySpeed = Number(parsed.replaySpeed);
      const replaySpeed =
        Number.isFinite(rawReplaySpeed) && rawReplaySpeed > 0 && rawReplaySpeed <= 20
          ? rawReplaySpeed
          : DEFAULT_SETTINGS.replaySpeed;
      const genCfg =
        parsed.generatorConfig && typeof parsed.generatorConfig === 'object' && !Array.isArray(parsed.generatorConfig)
          ? parsed.generatorConfig
          : {};
      const resolved: UserSettings = {
        ...DEFAULT_SETTINGS,
        ...parsed,
        difficulty,
        saveSortOrder,
        paletteSort,
        highlightStyle,
        hintFillStyle,
        regionColorMode,
        replaySpeed,
        zoomSensitivity,
        snapZoomLevels,
        soundEnabled,
        soundVolume,
        reducedMotion,
        largeText,
        enableUndo,
        generatorConfig: {
          ...DEFAULT_SETTINGS.generatorConfig,
          ...genCfg,
        },
      };
      delete (resolved as unknown as Record<string, unknown>).savedAt;
      if (!hasUndoMigration) {
        StorageService.saveSettings(resolved);
      }
      return resolved;
    } catch {
      return {
        ...DEFAULT_SETTINGS,
        reducedMotion: systemReducedMotion,
      };
    }
  }

  static saveSettings(settings: UserSettings): void {
    try {
      const payload = { ...settings, undoDefaultMigrated: true, savedAt: Date.now() };
      const serialized = JSON.stringify(payload);
      this.writeLocalAndScheduleBackup(
        resolveScopedStorageKey(SETTINGS_KEY),
        resolveScopedBackupKey(SETTINGS_KEY),
        serialized
      );
      try {
        if (typeof localStorage !== 'undefined' && localStorage !== null) {
          localStorage.setItem(resolveScopedStorageKey(UNDO_DEFAULT_MIGRATED_KEY), '1');
        }
      } catch (err) {
        if (this.isQuotaError(err)) {
          this.notifyQuotaWarning(resolveScopedStorageKey(UNDO_DEFAULT_MIGRATED_KEY));
        }
      }
    } catch {
      // ignore
    }
  }

  static async savePreviewDataUrl(id: string, previewDataUrl: string): Promise<void> {
    if (!id || !previewDataUrl) return;
    this.previewCache.set(this.previewCacheKey(id), previewDataUrl);
    if (typeof indexedDB === 'undefined') return;
    try {
      const key = this.previewStoreKey(id);
      await this.runTransaction(STORE_IMAGES, (tx) => {
        tx.objectStore(STORE_IMAGES).put(previewDataUrl, key);
      });
    } catch (e) {
      if (this.isQuotaError(e)) {
        this.notifyQuotaWarning(this.previewStoreKey(id));
      } else {
        console.warn('Failed to save preview data URL to IndexedDB', e);
      }
    }
  }

  static async loadPreviewDataUrl(id: string): Promise<string | null> {
    if (!id) return null;
    const cacheKey = this.previewCacheKey(id);
    const cached = this.previewCache.get(cacheKey);
    if (cached) return cached;
    if (typeof indexedDB === 'undefined') return null;
    try {
      const db = await this.getDB();
      const key = this.previewStoreKey(id);
      const result = await new Promise<string | null>((resolve) => {
        const tx = db.transaction(STORE_IMAGES, 'readonly');
        const req = tx.objectStore(STORE_IMAGES).get(key);
        req.onsuccess = () => {
          resolve(typeof req.result === 'string' && req.result.length > 0 ? req.result : null);
        };
        req.onerror = () => resolve(null);
      });
      if (result) {
        this.previewCache.set(cacheKey, result);
      }
      return result;
    } catch {
      return null;
    }
  }

  static async hydrateSnapshotPreviews(snapshots: SavedSnapshot[]): Promise<SavedSnapshot[]> {
    if (snapshots.length === 0) return snapshots;
    const hydrated = await Promise.all(
      snapshots.map(async (snap) => {
        if (typeof snap.previewDataUrl === 'string' && snap.previewDataUrl.length > 0) {
          this.previewCache.set(this.previewCacheKey(snap.id), snap.previewDataUrl);
          return snap;
        }
        const preview = await this.loadPreviewDataUrl(snap.id);
        return preview ? { ...snap, previewDataUrl: preview } : snap;
      })
    );
    return hydrated;
  }

  private static stripInlinePreviews(snapshots: SavedSnapshot[]): SavedSnapshot[] {
    return snapshots.map((s) => {
      if (typeof s.previewDataUrl === 'string' && s.previewDataUrl.length > 0) {
        this.previewCache.set(this.previewCacheKey(s.id), s.previewDataUrl);
        void this.savePreviewDataUrl(s.id, s.previewDataUrl);
      }
      if ('previewDataUrl' in s) {
        const copy = { ...s };
        delete copy.previewDataUrl;
        return copy;
      }
      return s;
    });
  }

  static loadSnapshots(): SavedSnapshot[] {
    try {
      const storageKey = resolveScopedStorageKey(SNAPSHOTS_KEY);
      const backupKey = resolveScopedBackupKey(SNAPSHOTS_KEY);
      const raw = this.loadRawWithBackupFallback(storageKey, backupKey, 'snapshots');
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      let hadLegacyInlinePreview = false;
      const valid = parsed.filter(
        (s): s is SavedSnapshot =>
          Boolean(s && typeof s === 'object' && typeof s.id === 'string' && s.id.length > 0 && typeof s.title === 'string')
      );
      const normalized = valid.map((s) => {
        const inlinePreview =
          typeof s.previewDataUrl === 'string' && s.previewDataUrl.length > 0 ? s.previewDataUrl : undefined;
        if (inlinePreview) {
          hadLegacyInlinePreview = true;
          this.previewCache.set(this.previewCacheKey(s.id), inlinePreview);
          void this.savePreviewDataUrl(s.id, inlinePreview);
        }
        const cachedPreview = inlinePreview || this.previewCache.get(this.previewCacheKey(s.id));
        const base: SavedSnapshot = {
          ...s,
          filledRegionIds: Array.isArray(s.filledRegionIds)
            ? s.filledRegionIds.filter((id) => typeof id === 'number' && Number.isFinite(id))
            : [],
          filledCount: typeof s.filledCount === 'number' && Number.isFinite(s.filledCount) ? Math.max(0, s.filledCount) : 0,
          totalCount: typeof s.totalCount === 'number' && Number.isFinite(s.totalCount) ? Math.max(0, s.totalCount) : 0,
          timestamp: typeof s.timestamp === 'number' && Number.isFinite(s.timestamp) ? Math.max(0, s.timestamp) : 0,
          lastOpened: typeof s.lastOpened === 'number' && Number.isFinite(s.lastOpened) ? Math.max(0, s.lastOpened) : 0,
        };
        if (cachedPreview) {
          base.previewDataUrl = cachedPreview;
        } else {
          delete base.previewDataUrl;
        }
        return base;
      });
      if (hadLegacyInlinePreview) {
        const stripped = this.stripInlinePreviews(normalized);
        this.writeLocalAndScheduleBackup(storageKey, backupKey, JSON.stringify(stripped), false);
      }
      return normalized;
    } catch {
      return [];
    }
  }

  static saveSnapshots(
    snapshots: SavedSnapshot[],
    options?: { allowEmptyBackup?: boolean; immediateBackup?: boolean; clearLocalOnFailure?: boolean }
  ): void {
    try {
      const stripped = this.stripInlinePreviews(snapshots);
      const serialized = JSON.stringify(stripped);
      const allowEmptyBackup = Boolean(options?.allowEmptyBackup);
      const isEmpty = stripped.length === 0;
      const skipBackup = isEmpty && !allowEmptyBackup;
      const immediateBackup = (isEmpty && allowEmptyBackup) || (Boolean(options?.immediateBackup) && !skipBackup);
      const clearLocalOnFailure = Boolean(options?.clearLocalOnFailure) && (isEmpty || NativeBridge.isNative);
      this.writeLocalAndScheduleBackup(
        resolveScopedStorageKey(SNAPSHOTS_KEY),
        resolveScopedBackupKey(SNAPSHOTS_KEY),
        serialized,
        immediateBackup,
        skipBackup,
        clearLocalOnFailure
      );
    } catch {
      // ignore
    }
  }

  static addSnapshot(snapshot: SavedSnapshot): SavedSnapshot[] {
    const list = this.loadSnapshots();
    const existingIndex = list.findIndex((s) => s.id === snapshot.id);
    let updated: SavedSnapshot[];
    if (existingIndex >= 0) {
      updated = [...list];
      updated[existingIndex] = snapshot;
    } else {
      updated = [snapshot, ...list];
    }
    this.saveSnapshots(updated);
    return updated;
  }

  static estimatePuzzleSaveBytes(puzzle: PuzzleData, previewDataUrl?: string): number {
    return estimateCompactPuzzleBytes(puzzle, previewDataUrl);
  }

  static updateSnapshotProgress(
    id: string,
    filledCount: number,
    totalCount: number,
    filledRegionIds: number[],
    zoomScale?: number,
    panOffsetX?: number,
    panOffsetY?: number,
    previewDataUrl?: string,
    paintedRegionColors?: Record<number, number>,
    customPalette?: PaletteColor[],
    isFreeColor?: boolean,
    fileSizeBytes?: number,
    resetEpoch?: number
  ): SavedSnapshot[] {
    const list = this.loadSnapshots();
    const updated = list.map((item) => {
      if (item.id === id) {
        return {
          ...item,
          lastOpened: Date.now(),
          filledCount,
          totalCount,
          filledRegionIds,
          ...(paintedRegionColors !== undefined ? { paintedRegionColors } : {}),
          ...(customPalette !== undefined ? { customPalette } : {}),
          ...(isFreeColor !== undefined ? { isFreeColor } : {}),
          ...(zoomScale !== undefined ? { zoomScale } : {}),
          ...(panOffsetX !== undefined ? { panOffsetX } : {}),
          ...(panOffsetY !== undefined ? { panOffsetY } : {}),
          ...(previewDataUrl ? { previewDataUrl } : {}),
          ...(fileSizeBytes !== undefined ? { fileSizeBytes } : {}),
          ...(resetEpoch !== undefined ? { resetEpoch } : {}),
        };
      }
      return item;
    });
    this.saveSnapshots(updated);
    return updated;
  }

  static updateSnapshotViewport(
    id: string,
    zoomScale: number,
    panOffsetX: number,
    panOffsetY: number
  ): SavedSnapshot[] {
    const list = this.loadSnapshots();
    const updated = list.map((item) =>
      item.id === id
        ? {
            ...item,
            zoomScale,
            panOffsetX,
            panOffsetY,
          }
        : item
    );
    this.saveSnapshots(updated);
    return updated;
  }

  static renameSnapshot(id: string, newTitle: string): SavedSnapshot[] {
    const list = this.loadSnapshots();
    const updated = list.map((s) => (s.id === id ? { ...s, title: newTitle } : s));
    this.saveSnapshots(updated);
    return updated;
  }

  static togglePinSnapshot(id: string): SavedSnapshot[] {
    const list = this.loadSnapshots();
    const updated = list.map((s) => (s.id === id ? { ...s, isPinned: !s.isPinned } : s));
    this.saveSnapshots(updated);
    return updated;
  }

  static async deleteSnapshot(id: string): Promise<SavedSnapshot[]> {
    this.previewCache.delete(this.previewCacheKey(id));
    const list = this.loadSnapshots();
    const updated = list.filter((s) => s.id !== id);
    if (updated.length < list.length) {
      this.saveSnapshots(updated, {
        immediateBackup: true,
        allowEmptyBackup: updated.length === 0,
        clearLocalOnFailure: true,
      });
    }
    const active = this.loadActiveState();
    if (active?.activeSnapshotId === id) {
      this.clearActiveState();
    }

    if (typeof indexedDB !== 'undefined') {
      try {
        const previewKey = this.previewStoreKey(id);
        await this.runTransaction([STORE_PUZZLES, STORE_IMAGES], (tx) => {
          tx.objectStore(STORE_PUZZLES).delete(id);
          tx.objectStore(STORE_IMAGES).delete(id);
          tx.objectStore(STORE_IMAGES).delete(previewKey);
        });
      } catch (e) {
        console.warn('Failed to delete snapshot IndexedDB entries', e);
      }
    }

    return updated;
  }

  static async clearAllSnapshots(): Promise<void> {
    const dbPrefix = `${resolveScopedDbName()}::`;
    for (const key of this.previewCache.keys()) {
      if (key.startsWith(dbPrefix)) {
        this.previewCache.delete(key);
      }
    }
    this.saveSnapshots([], {
      allowEmptyBackup: true,
      immediateBackup: true,
      clearLocalOnFailure: true,
    });
    this.clearActiveState();
    if (typeof indexedDB !== 'undefined') {
      try {
        await this.runTransaction([STORE_PUZZLES, STORE_IMAGES], (tx) => {
          tx.objectStore(STORE_PUZZLES).clear();
          tx.objectStore(STORE_IMAGES).clear();
        });
      } catch (e) {
        console.warn('Failed to clear snapshot IndexedDB stores', e);
      }
    }
  }

  static async savePuzzleData(id: string, puzzle: PuzzleData): Promise<void> {
    try {
      const compactRecord = compressPuzzleRecord(puzzle);
      await this.saveCompactPuzzleRecord(id, compactRecord);
    } catch (e) {
      console.warn('Failed to save compact puzzle data to IndexedDB', e);
    }
  }

  static async saveCompactPuzzleRecord(id: string, record: CompactPuzzleRecordV2): Promise<void> {
    await this.runTransaction(STORE_PUZZLES, (tx) => {
      tx.objectStore(STORE_PUZZLES).put(record, id);
    });
  }

  private static async loadRawPuzzleEntry(id: string): Promise<unknown> {
    try {
      const db = await this.getDB();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_PUZZLES, 'readonly');
        const req = tx.objectStore(STORE_PUZZLES).get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  static async loadPuzzleData(id: string): Promise<PuzzleData | null> {
    const raw = await this.loadRawPuzzleEntry(id);
    if (!raw) return null;

    if (isCompactPuzzleRecordV2(raw)) {
      return decompressPuzzleRecord(raw);
    }

    // Backward-compatible transparent migration for legacy v1 IndexedDB PuzzleData entries
    const legacy = raw as PuzzleData;
    if (legacy && legacy.regionMap && Array.isArray(legacy.regions)) {
      this.savePuzzleData(id, legacy).catch(() => {
        // Non-blocking background compaction
      });
      return legacy;
    }

    return null;
  }

  static async loadCompactPuzzleRecord(id: string): Promise<CompactPuzzleRecordV2 | null> {
    const raw = await this.loadRawPuzzleEntry(id);
    if (!raw) return null;
    if (isCompactPuzzleRecordV2(raw)) return raw;

    const legacy = raw as PuzzleData;
    if (legacy && legacy.regionMap && Array.isArray(legacy.regions)) {
      const compact = compressPuzzleRecord(legacy);
      this.saveCompactPuzzleRecord(id, compact).catch(() => {});
      return compact;
    }
    return null;
  }

  static async saveImageBlob(id: string, blob: Blob): Promise<void> {
    try {
      await this.runTransaction(STORE_IMAGES, (tx) => {
        tx.objectStore(STORE_IMAGES).put(blob, id);
      });
    } catch (e) {
      console.warn('Failed to save image blob to IndexedDB', e);
    }
  }

  static async loadImageBlob(id: string): Promise<Blob | null> {
    try {
      const db = await this.getDB();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_IMAGES, 'readonly');
        const req = tx.objectStore(STORE_IMAGES).get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  static saveActiveState(state: {
    activeSnapshotId: string | null;
    activeColorId: number;
    filledRegionIds: number[];
    paintedRegionColors?: Record<number, number>;
    isFreeColorMode?: boolean;
    resetEpoch?: number;
    zoomScale: number;
    panOffsetX: number;
    panOffsetY: number;
  }): void {
    try {
      const existing = state.resetEpoch === undefined && state.activeSnapshotId ? this.loadActiveState() : null;
      const effectiveEpoch =
        state.resetEpoch !== undefined
          ? state.resetEpoch
          : existing?.activeSnapshotId === state.activeSnapshotId
            ? existing.resetEpoch
            : undefined;
      const basePayload =
        effectiveEpoch !== undefined && effectiveEpoch > 0
          ? { ...state, resetEpoch: effectiveEpoch }
          : { ...state };
      const payload = { ...basePayload, savedAt: Date.now() };
      const serialized = JSON.stringify(payload);
      this.writeLocalAndScheduleBackup(
        resolveScopedStorageKey(ACTIVE_STATE_KEY),
        resolveScopedBackupKey(ACTIVE_STATE_KEY),
        serialized
      );
    } catch {
      // ignore
    }
  }

  static clearActiveState(): void {
    const storageKey = resolveScopedStorageKey(ACTIVE_STATE_KEY);
    const backupKey = resolveScopedBackupKey(ACTIVE_STATE_KEY);
    this.pendingBackupWrites.delete(backupKey);
    this.pendingForcedBackupKeys.delete(backupKey);
    try {
      if (typeof localStorage !== 'undefined' && localStorage !== null) {
        localStorage.removeItem(storageKey);
        this.quotaFailedLocalKeys.delete(storageKey);
        this.quotaFailedDeleteKeys.delete(storageKey);
      }
    } catch {
      this.quotaFailedLocalKeys.add(storageKey);
      this.quotaFailedDeleteKeys.add(storageKey);
    }
    try {
      this.scheduleBackupWrite(backupKey, '', true);
    } catch {
      // ignore
    }
  }

  static loadActiveState(): {
    activeSnapshotId: string | null;
    activeColorId: number;
    filledRegionIds: number[];
    paintedRegionColors?: Record<number, number>;
    isFreeColorMode?: boolean;
    resetEpoch?: number;
    zoomScale: number;
    panOffsetX: number;
    panOffsetY: number;
  } | null {
    try {
      const raw = this.loadRawWithBackupFallback(
        resolveScopedStorageKey(ACTIVE_STATE_KEY),
        resolveScopedBackupKey(ACTIVE_STATE_KEY),
        'activeState'
      );
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      const normalized = {
        ...parsed,
        activeSnapshotId: typeof parsed.activeSnapshotId === 'string' ? parsed.activeSnapshotId : null,
        activeColorId: typeof parsed.activeColorId === 'number' && Number.isFinite(parsed.activeColorId) ? parsed.activeColorId : 1,
        filledRegionIds: Array.isArray(parsed.filledRegionIds)
          ? parsed.filledRegionIds.filter((id: unknown) => typeof id === 'number' && Number.isFinite(id))
          : [],
        zoomScale: typeof parsed.zoomScale === 'number' && Number.isFinite(parsed.zoomScale) && parsed.zoomScale > 0 ? parsed.zoomScale : 1,
        panOffsetX: typeof parsed.panOffsetX === 'number' && Number.isFinite(parsed.panOffsetX) ? parsed.panOffsetX : 0,
        panOffsetY: typeof parsed.panOffsetY === 'number' && Number.isFinite(parsed.panOffsetY) ? parsed.panOffsetY : 0,
      };
      delete (normalized as Record<string, unknown>).savedAt;
      return normalized;
    } catch {
      return null;
    }
  }

  static async saveMultipleCompactPuzzleRecords(
    entries: Array<{ id: string; record: CompactPuzzleRecordV2 }>
  ): Promise<void> {
    if (entries.length === 0) return;
    try {
      await this.runTransaction(STORE_PUZZLES, (tx) => {
        const store = tx.objectStore(STORE_PUZZLES);
        for (const entry of entries) {
          store.put(entry.record, entry.id);
        }
      });
    } catch (e) {
      console.warn('Failed to batch save compact puzzle records to IndexedDB', e);
    }
  }

  static async saveMultiplePuzzleData(entries: Array<{ id: string; puzzle: PuzzleData }>): Promise<void> {
    if (entries.length === 0) return;
    await this.saveMultipleCompactPuzzleRecords(
      entries.map((entry) => ({
        id: entry.id,
        record: compressPuzzleRecord(entry.puzzle),
      }))
    );
  }

  /**
   * Exports a single save in Compact Binary Format v2 (`CAPY\x02...`, ~45-95 KB).
   * Embeds custom uploaded image blobs automatically while keeping built-in/catalog references zero-copy.
   */
  static async exportSnapshotBinary(
    id: string,
    options?: { exportDate?: number }
  ): Promise<Uint8Array> {
    const snapshots = this.loadSnapshots();
    const rawSnapshot = snapshots.find((s) => s.id === id);
    if (!rawSnapshot) throw new Error('Snapshot not found');
    const preview = rawSnapshot.previewDataUrl || (await this.loadPreviewDataUrl(id));
    const snapshot: SavedSnapshot = preview ? { ...rawSnapshot, previewDataUrl: preview } : rawSnapshot;

    const compactRecord = await this.loadCompactPuzzleRecord(id);
    const isZeroCopyRef =
      Boolean(snapshot.sampleAssetPath) ||
      snapshot.sourceRef?.kind === 'sample' ||
      snapshot.sourceRef?.kind === 'catalog' ||
      snapshot.sourceRef?.kind === 'url';
    const imageBlob = isZeroCopyRef ? null : await this.loadImageBlob(id);

    return encodeSingleSaveBinaryV2(snapshot, compactRecord, imageBlob, options);
  }

  /**
   * Exports all saves into a single Compact Binary Archive v2 (`CAPY\x02...`).
   */
  static async exportAllSnapshotsBinary(options?: { exportDate?: number }): Promise<Uint8Array> {
    const snapshots = await this.hydrateSnapshotPreviews(this.loadSnapshots());
    const compactRecords: Record<string, CompactPuzzleRecordV2> = {};
    const imageBlobs: Record<string, Blob> = {};

    for (const snap of snapshots) {
      const rec = await this.loadCompactPuzzleRecord(snap.id);
      if (rec) {
        compactRecords[snap.id] = rec;
      }
      const isZeroCopyRef =
        Boolean(snap.sampleAssetPath) ||
        snap.sourceRef?.kind === 'sample' ||
        snap.sourceRef?.kind === 'catalog' ||
        snap.sourceRef?.kind === 'url';
      if (!isZeroCopyRef) {
        const blob = await this.loadImageBlob(snap.id);
        if (blob) {
          imageBlobs[snap.id] = blob;
        }
      }
    }

    return encodeArchiveSaveBinaryV2(snapshots, compactRecords, imageBlobs, options);
  }

  /**
   * JSON v2 RLE export helper preserved for programmatic inspection and backward compatibility.
   */
  static async exportSnapshot(id: string): Promise<string> {
    const snapshots = this.loadSnapshots();
    const rawSnapshot = snapshots.find((s) => s.id === id);
    if (!rawSnapshot) throw new Error('Snapshot not found');
    const preview = rawSnapshot.previewDataUrl || (await this.loadPreviewDataUrl(id));
    const snapshot: SavedSnapshot = preview ? { ...rawSnapshot, previewDataUrl: preview } : rawSnapshot;
    const puzzle = await this.loadPuzzleData(id);
    const bundle = {
      version: 2,
      format: 'capy-single-save',
      exportDate: Date.now(),
      snapshot,
      puzzle: puzzle ? serializePuzzle(puzzle) : null,
    };
    return JSON.stringify(bundle);
  }

  static async exportAllSnapshots(): Promise<string> {
    const snapshots = await this.hydrateSnapshotPreviews(this.loadSnapshots());
    const puzzles: Record<string, SerializedPuzzleData> = {};
    for (const snap of snapshots) {
      const p = await this.loadPuzzleData(snap.id);
      if (p) {
        puzzles[snap.id] = serializePuzzle(p);
      }
    }
    const bundle = {
      version: 2,
      format: 'capy-archive-save',
      exportDate: Date.now(),
      snapshots,
      puzzles,
    };
    return JSON.stringify(bundle);
  }

  private static mergeImportedSnapshots(
    existing: SavedSnapshot[],
    imported: SavedSnapshot[],
    refreshTimestamps?: boolean
  ): { mergedList: SavedSnapshot[]; toPersist: SavedSnapshot[] } {
    const now = Date.now();
    const isBootstrapBatch = Boolean(refreshTimestamps) && existing.length > 0 && imported.every((s) => Boolean(s.isAutoSample));

    if (isBootstrapBatch) {
      const existingIds = new Set(existing.map((s) => s.id));
      const minExistingTs = existing.reduce((minTs, s) => {
        const candidate = s.lastOpened || s.timestamp || minTs;
        return candidate > 0 && candidate < minTs ? candidate : minTs;
      }, now);
      const sampleBaseTs = Math.min(now, minExistingTs - 1000);
      const newSamples = imported
        .filter((s) => !existingIds.has(s.id))
        .map((s, idx) => ({
          ...s,
          timestamp: sampleBaseTs - idx * 1000,
          lastOpened: sampleBaseTs - idx * 1000,
        }));
      return {
        mergedList: [...existing, ...newSamples],
        toPersist: newSamples,
      };
    }

    const normalized = imported.map((s, idx) =>
      refreshTimestamps
        ? { ...s, timestamp: now - idx * 1000, lastOpened: now - idx * 1000 }
        : {
            ...s,
            timestamp: typeof s.timestamp === 'number' && Number.isFinite(s.timestamp) ? s.timestamp : now - idx * 1000,
            lastOpened: typeof s.lastOpened === 'number' && Number.isFinite(s.lastOpened) ? s.lastOpened : now - idx * 1000,
          }
    );
    const importedIds = new Set(normalized.map((s) => s.id));
    const remaining = existing.filter((s) => !importedIds.has(s.id));
    return {
      mergedList: [...normalized, ...remaining],
      toPersist: normalized,
    };
  }

  /**
   * Unified importer supporting Compact Binary v2 (`CAPY\x02...`), JSON v2 RLE, and legacy v1 JSON `.capy` saves.
   * Validates and prepares all puzzle records in memory before mutating IndexedDB or localStorage.
   */
  static async importSnapshotData(
    input: ArrayBuffer | Uint8Array | string,
    options?: { refreshTimestamps?: boolean; filterSnapshotId?: string }
  ): Promise<{
    importedCount: number;
    firstSnapshot?: SavedSnapshot;
    firstPuzzle?: PuzzleData;
    error?: string;
  }> {
    try {
      if (typeof input !== 'string') {
        const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
        if (bytes.byteLength === 0) {
          return { importedCount: 0, error: 'Empty save file' };
        }
        if (hasBinaryMagicHeader(bytes)) {
          const decoded = await decodeBinarySaveV2(bytes);
          const now = Date.now();

          if (decoded.format === 'capy-single-save-v2' && decoded.snapshot) {
            const rawSnap = decoded.snapshot;
            if (!rawSnap.id || !rawSnap.title) {
              return { importedCount: 0, error: 'Invalid binary snapshot structure' };
            }
            const snap: SavedSnapshot = options?.refreshTimestamps
              ? { ...rawSnap, timestamp: now, lastOpened: now }
              : rawSnap;

            let preparedRecord: CompactPuzzleRecordV2 | null = null;
            let firstPuzzle: PuzzleData | undefined;
            if (decoded.compactPuzzle) {
              preparedRecord = serializableToRecord(decoded.compactPuzzle);
              firstPuzzle = decompressPuzzleRecord(preparedRecord);
            }
            const preparedBlob =
              decoded.imageBytes && decoded.imageBytes.byteLength > 0
                ? new Blob([new Uint8Array(decoded.imageBytes)], {
                    type: decoded.imageMimeType || 'image/webp',
                  })
                : null;

            if (preparedRecord) {
              await this.saveCompactPuzzleRecord(snap.id, preparedRecord);
            }
            if (preparedBlob) {
              await this.saveImageBlob(snap.id, preparedBlob);
            }
            if (snap.previewDataUrl) {
              await this.savePreviewDataUrl(snap.id, snap.previewDataUrl);
            }
            this.addSnapshot(snap);
            return { importedCount: 1, firstSnapshot: snap, firstPuzzle };
          }

          if (decoded.format === 'capy-archive-save-v2' && Array.isArray(decoded.snapshots)) {
            const validSnapshots = decoded.snapshots.filter(
              (s) =>
                Boolean(s && s.id && s.title) &&
                (!options?.filterSnapshotId || s.id === options.filterSnapshotId)
            );
            if (validSnapshots.length === 0) {
              return { importedCount: 0, error: 'No valid snapshots in binary archive' };
            }

            const existing = this.loadSnapshots();
            const { mergedList, toPersist } = this.mergeImportedSnapshots(
              existing,
              validSnapshots,
              options?.refreshTimestamps
            );

            const compactEntries: Array<{ id: string; record: CompactPuzzleRecordV2 }> = [];
            const imageEntries: Array<{ id: string; blob: Blob }> = [];
            let firstPuzzle: PuzzleData | undefined;

            for (let i = 0; i < toPersist.length; i++) {
              const snap = toPersist[i];
              const comp = decoded.compactPuzzles?.[snap.id];
              if (comp) {
                const record = serializableToRecord(comp);
                const decompressed = decompressPuzzleRecord(record);
                if (i === 0) {
                  firstPuzzle = decompressed;
                }
                compactEntries.push({ id: snap.id, record });
              }
              const imgEntry = decoded.images?.[snap.id];
              if (imgEntry && imgEntry.bytes.byteLength > 0) {
                imageEntries.push({
                  id: snap.id,
                  blob: new Blob([new Uint8Array(imgEntry.bytes)], {
                    type: imgEntry.mimeType || 'image/webp',
                  }),
                });
              }
            }

            await this.saveMultipleCompactPuzzleRecords(compactEntries);
            for (const imgEntry of imageEntries) {
              await this.saveImageBlob(imgEntry.id, imgEntry.blob);
            }
            for (const snap of toPersist) {
              if (snap.previewDataUrl) {
                await this.savePreviewDataUrl(snap.id, snap.previewDataUrl);
              }
            }
            this.saveSnapshots(mergedList);
            return {
              importedCount: toPersist.length > 0 ? toPersist.length : validSnapshots.length,
              firstSnapshot: toPersist[0] || validSnapshots[0],
              firstPuzzle,
            };
          }

          return { importedCount: 0, error: 'Unrecognized Capy v2 binary payload' };
        }

        const text = new TextDecoder().decode(bytes);
        return this.importSnapshotBundle(text, options);
      }

      return this.importSnapshotBundle(input, options);
    } catch (err: any) {
      return { importedCount: 0, error: err?.message || 'Failed to import Capy save file' };
    }
  }

  static async importSnapshotBundle(
    jsonString: string,
    options?: { refreshTimestamps?: boolean }
  ): Promise<{
    importedCount: number;
    firstSnapshot?: SavedSnapshot;
    firstPuzzle?: PuzzleData;
    error?: string;
  }> {
    try {
      const data = JSON.parse(jsonString);
      if (!data) return { importedCount: 0, error: 'Empty or invalid JSON' };

      const now = Date.now();

      // Single snapshot format (v1 JSON)
      if (data.format === 'capy-single-save' && data.snapshot) {
        const rawSnap = data.snapshot as SavedSnapshot;
        if (!rawSnap.id || !rawSnap.title) {
          return { importedCount: 0, error: 'Invalid snapshot data structure' };
        }
        const snap: SavedSnapshot = options?.refreshTimestamps
          ? { ...rawSnap, timestamp: now, lastOpened: now }
          : rawSnap;
        let firstPuzzle: PuzzleData | undefined;
        if (data.puzzle) {
          firstPuzzle = deserializePuzzle(data.puzzle);
        }
        if (firstPuzzle) {
          await this.savePuzzleData(snap.id, firstPuzzle);
        }
        if (snap.previewDataUrl) {
          await this.savePreviewDataUrl(snap.id, snap.previewDataUrl);
        }
        this.addSnapshot(snap);
        return { importedCount: 1, firstSnapshot: snap, firstPuzzle };
      }

      // Archive format (v1 JSON)
      if (data.format === 'capy-archive-save' && Array.isArray(data.snapshots)) {
        const validSnapshots = (data.snapshots as SavedSnapshot[]).filter((s) =>
          Boolean(s && s.id && s.title)
        );
        if (validSnapshots.length === 0) {
          return { importedCount: 0, error: 'No valid snapshots in archive' };
        }

        const existing = this.loadSnapshots();
        const { mergedList, toPersist } = this.mergeImportedSnapshots(
          existing,
          validSnapshots,
          options?.refreshTimestamps
        );

        let firstPuzzle: PuzzleData | undefined;
        const puzzleEntries: Array<{ id: string; puzzle: PuzzleData }> = [];
        if (data.puzzles) {
          for (let i = 0; i < toPersist.length; i++) {
            const snap = toPersist[i];
            const serialized = data.puzzles[snap.id];
            if (serialized) {
              const puzzle = deserializePuzzle(serialized);
              if (i === 0) {
                firstPuzzle = puzzle;
              }
              puzzleEntries.push({ id: snap.id, puzzle });
            }
          }
        }

        await this.saveMultiplePuzzleData(puzzleEntries);
        for (const snap of toPersist) {
          if (snap.previewDataUrl) {
            await this.savePreviewDataUrl(snap.id, snap.previewDataUrl);
          }
        }
        this.saveSnapshots(mergedList);

        return {
          importedCount: toPersist.length > 0 ? toPersist.length : validSnapshots.length,
          firstSnapshot: toPersist[0] || validSnapshots[0],
          firstPuzzle,
        };
      }

      // Fallback: array of snapshots
      if (Array.isArray(data)) {
        const validSnapshots = (data as SavedSnapshot[]).filter((s) => Boolean(s && s.id && s.title));
        if (validSnapshots.length === 0) {
          return { importedCount: 0, error: 'No valid snapshots in array' };
        }
        const existing = this.loadSnapshots();
        const { mergedList, toPersist } = this.mergeImportedSnapshots(
          existing,
          validSnapshots,
          options?.refreshTimestamps
        );
        for (const snap of toPersist) {
          if (snap.previewDataUrl) {
            await this.savePreviewDataUrl(snap.id, snap.previewDataUrl);
          }
        }
        this.saveSnapshots(mergedList);
        return {
          importedCount: toPersist.length > 0 ? toPersist.length : validSnapshots.length,
          firstSnapshot: toPersist[0] || validSnapshots[0],
        };
      }

      return { importedCount: 0, error: 'Unrecognized Capy save format' };
    } catch (err: any) {
      return { importedCount: 0, error: err?.message || 'Failed to parse JSON save' };
    }
  }
}

if (typeof window !== 'undefined') {
  (window as unknown as { capyStorage?: typeof StorageService }).capyStorage = StorageService;
}

export interface SerializedPuzzleData {
  encodingVersion?: number;
  width: number;
  height: number;
  palette: PaletteColor[];
  /** Compact v2 Run-Length Encoded regionMap (little-endian uint16 regionId + uint16 runLength pairs) */
  regionMapRleB64?: string;
  /** Legacy v1 raw Int32Array regionMap */
  regionMapB64?: string;
  /** Legacy v1 raw Uint8Array borderMap (derived deterministically from regionMap in v2) */
  borderMapB64?: string;
  isFreeColor?: boolean;
  regions: Array<{
    id: number;
    colorId: number;
    centroidX: number;
    centroidY: number;
    area: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    maxRadius: number;
    /** Legacy v1 per-region pixel index array (derived deterministically from regionMap in v2) */
    pixelsB64?: string;
  }>;
}

function bufferToBase64(buffer: ArrayBufferView): string {
  return uint8ToBase64(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
}

function base64ToInt32Array(b64: string): Int32Array {
  const bytes = base64ToUint8(b64);
  return new Int32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

function encodeRegionMapRle16(regionMap: Int32Array): Uint8Array {
  const total = regionMap.length;
  if (total === 0) return new Uint8Array(0);

  let runCount = 0;
  let i = 0;
  while (i < total) {
    const rid = regionMap[i];
    let len = 1;
    while (i + len < total && regionMap[i + len] === rid && len < 65535) {
      len++;
    }
    runCount++;
    i += len;
  }

  const bytes = new Uint8Array(runCount * 4);
  let bIdx = 0;
  i = 0;
  while (i < total) {
    const rid = regionMap[i];
    let len = 1;
    while (i + len < total && regionMap[i + len] === rid && len < 65535) {
      len++;
    }
    bytes[bIdx++] = rid & 0xff;
    bytes[bIdx++] = (rid >> 8) & 0xff;
    bytes[bIdx++] = len & 0xff;
    bytes[bIdx++] = (len >> 8) & 0xff;
    i += len;
  }
  return bytes;
}

function decodeRegionMapRle16(b64: string, total: number): Int32Array {
  const bytes = base64ToUint8(b64);
  const regionMap = new Int32Array(total);
  let writePos = 0;
  const byteLen = bytes.length;
  for (let i = 0; i + 3 < byteLen && writePos < total; i += 4) {
    const rid = bytes[i] | (bytes[i + 1] << 8);
    const len = bytes[i + 2] | (bytes[i + 3] << 8);
    const end = Math.min(total, writePos + len);
    regionMap.fill(rid, writePos, end);
    writePos = end;
  }
  return regionMap;
}

export function serializePuzzle(p: PuzzleData): SerializedPuzzleData {
  let canUseRle16 = true;
  for (let i = 0; i < p.regionMap.length; i++) {
    const rid = p.regionMap[i];
    if (rid < 0 || rid > 65535) {
      canUseRle16 = false;
      break;
    }
  }

  if (canUseRle16) {
    return {
      encodingVersion: 2,
      width: p.width,
      height: p.height,
      palette: p.palette,
      regionMapRleB64: bufferToBase64(encodeRegionMapRle16(p.regionMap)),
      isFreeColor: p.isFreeColor,
      regions: p.regions.map((r) => ({
        id: r.id,
        colorId: r.colorId,
        centroidX: r.centroidX,
        centroidY: r.centroidY,
        area: r.area,
        minX: r.minX,
        maxX: r.maxX,
        minY: r.minY,
        maxY: r.maxY,
        maxRadius: r.maxRadius,
      })),
    };
  }

  return {
    encodingVersion: 1,
    width: p.width,
    height: p.height,
    palette: p.palette,
    regionMapB64: bufferToBase64(p.regionMap),
    borderMapB64: bufferToBase64(p.borderMap),
    isFreeColor: p.isFreeColor,
    regions: p.regions.map((r) => ({
      id: r.id,
      colorId: r.colorId,
      centroidX: r.centroidX,
      centroidY: r.centroidY,
      area: r.area,
      minX: r.minX,
      maxX: r.maxX,
      minY: r.minY,
      maxY: r.maxY,
      maxRadius: r.maxRadius,
      pixelsB64: bufferToBase64(r.pixels),
    })),
  };
}

export function deserializePuzzle(s: SerializedPuzzleData): PuzzleData {
  if (
    !s ||
    typeof s.width !== 'number' ||
    typeof s.height !== 'number' ||
    !Number.isInteger(s.width) ||
    !Number.isInteger(s.height) ||
    s.width <= 0 ||
    s.height <= 0 ||
    s.width * s.height > 16_777_216 ||
    !Array.isArray(s.palette) ||
    !Array.isArray(s.regions)
  ) {
    throw new Error('Invalid puzzle payload dimensions or structure');
  }
  const total = s.width * s.height;
  const regionMap = s.regionMapRleB64
    ? decodeRegionMapRle16(s.regionMapRleB64, total)
    : s.regionMapB64
      ? base64ToInt32Array(s.regionMapB64)
      : new Int32Array(total);

  const borderMap = s.borderMapB64
    ? base64ToUint8(s.borderMapB64)
    : buildBorderMapFromRegionMap(regionMap, s.width, s.height);

  const hasLegacyPixels = s.regions.length > 0 && s.regions.every((r) => typeof r.pixelsB64 === 'string');
  if (hasLegacyPixels) {
    return {
      width: s.width,
      height: s.height,
      palette: s.palette,
      regionMap,
      borderMap,
      isFreeColor: s.isFreeColor,
      regions: s.regions.map((r) => ({
        id: r.id,
        colorId: r.colorId,
        centroidX: r.centroidX,
        centroidY: r.centroidY,
        area: r.area,
        minX: r.minX,
        maxX: r.maxX,
        minY: r.minY,
        maxY: r.maxY,
        maxRadius: r.maxRadius,
        pixels: base64ToInt32Array(r.pixelsB64!),
      })),
    };
  }

  let maxRegionId = 0;
  for (let i = 0; i < s.regions.length; i++) {
    if (s.regions[i].id > maxRegionId) {
      maxRegionId = s.regions[i].id;
    }
  }

  const idToIndex = new Int32Array(maxRegionId + 1);
  idToIndex.fill(-1);
  for (let i = 0; i < s.regions.length; i++) {
    idToIndex[s.regions[i].id] = i;
  }

  const counts = new Uint32Array(s.regions.length);
  for (let idx = 0; idx < total; idx++) {
    const rid = regionMap[idx];
    if (rid >= 0 && rid <= maxRegionId) {
      const rIdx = idToIndex[rid];
      if (rIdx >= 0) counts[rIdx]++;
    }
  }

  const pixelArrays: Int32Array[] = new Array(s.regions.length);
  for (let i = 0; i < s.regions.length; i++) {
    pixelArrays[i] = new Int32Array(counts[i]);
  }

  const cursors = new Uint32Array(s.regions.length);
  for (let idx = 0; idx < total; idx++) {
    const rid = regionMap[idx];
    if (rid >= 0 && rid <= maxRegionId) {
      const rIdx = idToIndex[rid];
      if (rIdx >= 0) {
        pixelArrays[rIdx][cursors[rIdx]++] = idx;
      }
    }
  }

  return {
    width: s.width,
    height: s.height,
    palette: s.palette,
    regionMap,
    borderMap,
    isFreeColor: s.isFreeColor,
    regions: s.regions.map((r, i) => ({
      id: r.id,
      colorId: r.colorId,
      centroidX: r.centroidX,
      centroidY: r.centroidY,
      area: r.area,
      minX: r.minX,
      maxX: r.maxX,
      minY: r.minY,
      maxY: r.maxY,
      maxRadius: r.maxRadius,
      pixels: pixelArrays[i],
    })),
  };
}
