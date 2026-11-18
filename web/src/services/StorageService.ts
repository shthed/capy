import {
  DEFAULT_GENERATOR_CONFIG,
  GeneratorConfig,
  PaletteColor,
  PuzzleData,
  SavedSnapshot,
  UserSettings,
} from '../types';
import {
  assertValidPalette,
  assertValidSavedSnapshot,
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
  MAX_DELTA_REGION_ENTRIES,
  MAX_PUZZLE_PIXELS,
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

const SETTINGS_BOOLEAN_KEYS = [
  'autoAdvance',
  'isPaintMode',
  'isFreeColorMode',
  'raisePaletteDock',
  'showSavePreviews',
  'showRegionLabels',
  'showPreviewLabels',
  'showPreviewBorders',
  'highlightMatching',
  'animateHint',
  'showNextRegionHint',
  'showZoomButtons',
  'showResetViewButton',
  'prioritizeOnScreen',
  'hapticsEnabled',
  'panMomentum',
  'enableCustomColorForAllPuzzles',
  'enableUndo',
  'autoReplayOnLoad',
  'replayLoop',
  'replayFollow',
  'reverseDoubleTapZoom',
  'snapZoomLevels',
  'soundEnabled',
  'reducedMotion',
  'largeText',
  'detailedLoadingProgress',
] as const;

const SETTINGS_NUMBER_KEYS = [
  'canvasBgArgb',
  'hintColorArgb',
  'hintIntensity',
  'labelScale',
  'minLabelSize',
  'maxLabelSize',
  'replaySpeed',
  'zoomSensitivity',
  'soundVolume',
] as const;

const SETTINGS_ENUM_VALUES: Record<string, readonly string[]> = {
  difficulty: ['EASY', 'NORMAL'],
  regionColorMode: ['DETAIL', 'SOLID'],
  canvasBgColor: ['BLACK', 'DARK_SLATE', 'CHARCOAL', 'LIGHT_GRAY', 'PURE_WHITE', 'CUSTOM'],
  saveSortOrder: ['LAST_ACTIVE', 'DATE', 'PERCENT_COMPLETE'],
  highlightStyle: ['CENTROID_GLOW', 'NUMBER_ONLY', 'FULL_REGION', 'BOUNDARY_ONLY'],
  hintFillStyle: ['CHECKER', 'STRIPES', 'SOLID'],
  paletteSort: ['NUMBER', 'REMAINING', 'HUE', 'LIGHTNESS'],
};

const GEN_CONFIG_ENUM_VALUES: Record<string, readonly string[]> = {
  algorithm: ['AUTO', 'LINE_ART', 'PAINTERLY', 'POSTERIZED', 'MOSAIC_CEL'],
  lineHandling: ['ABSORB_LINES', 'UNIFIED_BLACK_REGION'],
  preset: ['LOW', 'MEDIUM', 'HIGH', 'CUSTOM'],
  paletteDetail: ['AUTO', 'LOW', 'MEDIUM', 'HIGH', 'CUSTOM'],
  imageType: ['AUTO', 'DRAWING', 'PHOTO'],
};

const GEN_CONFIG_NUMBER_KEYS = [
  'colorCount',
  'minRegionArea',
  'maxRegions',
  'resolution',
  'smoothingPasses',
] as const;

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
  private static readonly BACKUP_DEBOUNCE_MS = 400;
  private static readonly BACKUP_FLUSH_BACKOFF_MS = [400, 400, 800, 1600, 3200];
  private static dbPromises = new Map<string, Promise<IDBDatabase>>();
  private static quotaListeners = new Set<(warning: QuotaWarning) => void>();
  private static persistentStorageRequested = false;
  private static pendingBackupWrites = new Map<string, string>();
  private static pendingBackupStorageKeys = new Map<string, string>();
  private static pendingLocalHealWrites = new Map<string, string>();
  private static pendingForcedBackupKeys = new Set<string>();
  private static staleNativeBackupKeys = new Set<string>();
  private static quotaFailedLocalKeys = new Set<string>();
  private static quotaFailedDeleteKeys = new Set<string>();
  private static backupFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private static backupFlushRetryAttempt = 0;
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

  private static hasPendingFlushWork(): boolean {
    return (
      this.pendingBackupWrites.size > 0 ||
      this.pendingLocalHealWrites.size > 0 ||
      this.quotaFailedDeleteKeys.size > 0
    );
  }

  private static clearBackupFlushTimer(): void {
    if (this.backupFlushTimer !== null) {
      clearTimeout(this.backupFlushTimer);
      this.backupFlushTimer = null;
    }
  }

  private static scheduleBackupFlushTimer(isRetry: boolean = false): void {
    if (!isRetry) {
      if (this.backupFlushRetryAttempt > 0) {
        this.clearBackupFlushTimer();
      }
      this.backupFlushRetryAttempt = 0;
    }
    if (this.backupFlushTimer !== null) return;
    const delayMs = isRetry
      ? StorageService.BACKUP_FLUSH_BACKOFF_MS[
          Math.min(this.backupFlushRetryAttempt, StorageService.BACKUP_FLUSH_BACKOFF_MS.length - 1)
        ]
      : StorageService.BACKUP_DEBOUNCE_MS;
    this.backupFlushTimer = setTimeout(() => {
      this.backupFlushTimer = null;
      this.flushPendingBackups();
    }, delayMs);
    if (
      typeof this.backupFlushTimer === 'object' &&
      this.backupFlushTimer !== null &&
      typeof (this.backupFlushTimer as { unref?: () => void }).unref === 'function'
    ) {
      (this.backupFlushTimer as { unref: () => void }).unref();
    }
  }

  static flushPendingBackups(): void {
    this.clearBackupFlushTimer();
    const isNative = NativeBridge.isNative;
    if (!isNative) {
      this.pendingBackupWrites.clear();
      this.pendingBackupStorageKeys.clear();
      this.staleNativeBackupKeys.clear();
      this.pendingForcedBackupKeys.clear();
    }
    if (!this.hasPendingFlushWork()) {
      this.backupFlushRetryAttempt = 0;
      return;
    }

    // Phase 1: Native Backup Queue (pendingBackupWrites strictly when NativeBridge.isNative)
    if (isNative && this.pendingBackupWrites.size > 0) {
      const entries = Array.from(this.pendingBackupWrites.entries());
      const storageKeyMap = new Map(this.pendingBackupStorageKeys);
      this.pendingBackupWrites.clear();
      this.pendingBackupStorageKeys.clear();
      for (const [backupKey, serialized] of entries) {
        const storageKey = storageKeyMap.get(backupKey) ?? backupKey;
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
        if (ok) {
          this.staleNativeBackupKeys.delete(backupKey);
          this.pendingForcedBackupKeys.delete(backupKey);
        } else {
          this.staleNativeBackupKeys.add(backupKey);
          this.pendingBackupWrites.set(backupKey, serialized);
          this.pendingBackupStorageKeys.set(backupKey, storageKey);
          if (isForced) {
            this.pendingForcedBackupKeys.add(backupKey);
          }
        }
      }
    }

    // Phase 2: Local Heal Queue (pendingLocalHealWrites across all 3 platforms)
    if (this.pendingLocalHealWrites.size > 0) {
      for (const [storageKey, serialized] of Array.from(this.pendingLocalHealWrites.entries())) {
        if (this.matchesScopedKey(storageKey, ACTIVE_STATE_KEY) && serialized.trim().length === 0) {
          this.tryClearLocalStorageKey(storageKey);
        } else {
          this.safeLocalHeal(storageKey, serialized);
        }
      }
    }

    // Phase 3: Residual quotaFailedDeleteKeys (all 3 platforms)
    if (this.quotaFailedDeleteKeys.size > 0) {
      for (const storageKey of Array.from(this.quotaFailedDeleteKeys)) {
        const healVal = this.pendingLocalHealWrites.get(storageKey);
        const isEmptyHeal =
          healVal === undefined ||
          healVal.trim().length === 0 ||
          (this.matchesScopedKey(storageKey, SNAPSHOTS_KEY) && this.isEmptySnapshotsPayload(healVal));
        if (!isEmptyHeal) {
          continue;
        }
        let hasNonEmptyPendingBackup = false;
        for (const [bKey, bVal] of this.pendingBackupWrites.entries()) {
          const mappedStorageKey = this.pendingBackupStorageKeys.get(bKey) ?? bKey;
          if (mappedStorageKey !== storageKey) continue;
          const isEmptyBak =
            bVal.trim().length === 0 ||
            (this.isSnapshotsBackupKey(bKey) && this.isEmptySnapshotsPayload(bVal));
          if (!isEmptyBak) {
            hasNonEmptyPendingBackup = true;
            break;
          }
        }
        if (hasNonEmptyPendingBackup) {
          continue;
        }
        if (this.matchesScopedKey(storageKey, ACTIVE_STATE_KEY)) {
          this.tryClearLocalStorageKey(storageKey);
        } else if (this.matchesScopedKey(storageKey, SNAPSHOTS_KEY)) {
          if (!this.safeLocalHeal(storageKey, '[]')) {
            this.tryClearLocalStorageKey(storageKey);
          }
        }
      }
    }

    if (!this.hasPendingFlushWork()) {
      this.backupFlushRetryAttempt = 0;
    } else if (this.backupFlushRetryAttempt < StorageService.BACKUP_FLUSH_BACKOFF_MS.length) {
      this.backupFlushRetryAttempt += 1;
      this.scheduleBackupFlushTimer(true);
    }
  }

  private static scheduleBackupWrite(
    backupKey: string,
    serialized: string,
    immediate: boolean = false,
    storageKey: string = backupKey
  ): void {
    const isEmptySnapshot = this.isSnapshotsBackupKey(backupKey) && this.isEmptySnapshotsPayload(serialized);
    if (!immediate && isEmptySnapshot) {
      return;
    }
    const isEmptyActive =
      this.matchesScopedKey(backupKey, ACTIVE_STATE_KEY) && serialized.trim().length === 0;
    this.ensureLifecycleFlushRegistered();
    if (!NativeBridge.isNative) {
      this.pendingBackupWrites.delete(backupKey);
      this.pendingBackupStorageKeys.delete(backupKey);
      this.pendingForcedBackupKeys.delete(backupKey);
      this.staleNativeBackupKeys.delete(backupKey);
      if (this.hasPendingFlushWork()) {
        this.scheduleBackupFlushTimer();
      } else {
        this.clearBackupFlushTimer();
        this.backupFlushRetryAttempt = 0;
      }
      return;
    }
    if (immediate) {
      this.pendingBackupWrites.delete(backupKey);
      this.pendingBackupStorageKeys.delete(backupKey);
      this.pendingForcedBackupKeys.delete(backupKey);
      let ok = false;
      try {
        ok = NativeBridge.saveBackup(backupKey, serialized);
      } catch {
        ok = false;
      }
      if (ok) {
        this.staleNativeBackupKeys.delete(backupKey);
      } else {
        this.staleNativeBackupKeys.add(backupKey);
        this.pendingBackupWrites.set(backupKey, serialized);
        this.pendingBackupStorageKeys.set(backupKey, storageKey);
        if (isEmptySnapshot || isEmptyActive) {
          this.pendingForcedBackupKeys.add(backupKey);
        }
      }
      if (this.hasPendingFlushWork()) {
        this.scheduleBackupFlushTimer();
      } else {
        this.clearBackupFlushTimer();
        this.backupFlushRetryAttempt = 0;
      }
      return;
    }
    this.pendingForcedBackupKeys.delete(backupKey);
    this.pendingBackupWrites.set(backupKey, serialized);
    this.pendingBackupStorageKeys.set(backupKey, storageKey);
    this.scheduleBackupFlushTimer();
  }

  private static safeLocalGet(storageKey: string): string | null {
    try {
      if (typeof localStorage === 'undefined' || localStorage === null) return null;
      return localStorage.getItem(storageKey);
    } catch {
      return null;
    }
  }

  private static safeLocalHeal(storageKey: string, value: string): boolean {
    try {
      if (typeof localStorage === 'undefined' || localStorage === null) return false;
      localStorage.setItem(storageKey, value);
      this.quotaFailedLocalKeys.delete(storageKey);
      this.quotaFailedDeleteKeys.delete(storageKey);
      this.pendingLocalHealWrites.delete(storageKey);
      if (!this.hasPendingFlushWork()) {
        this.clearBackupFlushTimer();
        this.backupFlushRetryAttempt = 0;
      }
      return true;
    } catch {
      return false;
    }
  }

  private static tryClearLocalStorageKey(storageKey: string): boolean {
    try {
      if (typeof localStorage === 'undefined' || localStorage === null) return false;
      localStorage.removeItem(storageKey);
      this.quotaFailedLocalKeys.delete(storageKey);
      this.quotaFailedDeleteKeys.delete(storageKey);
      this.pendingLocalHealWrites.delete(storageKey);
      if (!this.hasPendingFlushWork()) {
        this.clearBackupFlushTimer();
        this.backupFlushRetryAttempt = 0;
      }
      return true;
    } catch {
      return false;
    }
  }

  private static hasReadableNativeBackup(): boolean {
    return typeof window !== 'undefined' && typeof window.CapyAndroid?.loadBackup === 'function';
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

  private static getMaxPersistedObjectTimestamp(storageKey: string, backupKey: string): number {
    let maxTs = 0;
    const candidates: Array<string | null | undefined> = [
      this.safeLocalGet(storageKey),
      this.pendingBackupWrites.get(backupKey),
      this.pendingLocalHealWrites.get(storageKey),
      this.hasReadableNativeBackup() ? this.safeNativeLoadBackup(backupKey) : null,
    ];
    for (const raw of candidates) {
      if (!raw || raw.trim().length === 0) continue;
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const ts = this.extractObjectTimestamp(parsed as Record<string, unknown>);
          if (ts > maxTs) {
            maxTs = ts;
          }
        }
      } catch {
        // Ignore malformed JSON candidate
      }
    }
    return maxTs;
  }

  private static getMaxPersistedSnapshotTimestamp(storageKey: string, backupKey: string): number {
    let maxTs = 0;
    const candidates: Array<string | null | undefined> = [
      this.safeLocalGet(storageKey),
      this.pendingBackupWrites.get(backupKey),
      this.pendingLocalHealWrites.get(storageKey),
      this.hasReadableNativeBackup() ? this.safeNativeLoadBackup(backupKey) : null,
    ];
    for (const raw of candidates) {
      if (!raw || raw.trim().length === 0) continue;
      const metrics = this.inspectCandidate(raw, 'snapshots');
      if (metrics.parseOk && metrics.maxTs > maxTs) {
        maxTs = metrics.maxTs;
      }
    }
    return maxTs;
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
      if (parsed.length > 0 && valid.length === 0) {
        return base;
      }
      let maxTs = 0;
      let totalFilled = 0;
      let completeness = 0;
      for (const s of valid) {
        const sid = s.id as string;
        const metaTs = Object.prototype.hasOwnProperty.call(s, 'metaUpdatedAt')
          ? this.parseTimestampMs(s.metaUpdatedAt)
          : 0;
        const ts = Math.max(
          this.parseTimestampMs(s.lastOpened),
          this.parseTimestampMs(s.timestamp),
          metaTs
        );
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
      if (!this.hasRecognizedSettingsField(rec)) {
        return base;
      }
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

    const activeCheck = this.tryParseActiveState(trimmed);
    if (activeCheck.status !== 'ok') {
      return base;
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

  private static quarantineCorruptLocalPayload(storageKey: string, raw: string | null): void {
    if (!raw) return;
    try {
      if (typeof localStorage === 'undefined' || localStorage === null) return;
      localStorage.setItem(`${storageKey}__corrupt_quarantine`, raw);
    } catch {
      // Ignore quota errors while quarantining corrupt payload
    }
    console.warn(`[StorageService] Quarantined corrupt local payload for ${storageKey}`);
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
    if (preferBackupOnTie && b.parseOk && (forceBackupWins || b.nonEmpty)) {
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
    kind: BackupDataKind,
    forceEmptyPending: boolean = false
  ): string | null {
    const hasPending = Boolean(pendingRaw && pendingRaw.length > 0);
    const hasNative = Boolean(nativeRaw && nativeRaw.length > 0);
    if (hasPending && hasNative) {
      if (forceEmptyPending && kind === 'snapshots' && this.isEmptySnapshotsPayload(pendingRaw!)) {
        return pendingRaw!;
      }
      if (this.isValidNonEmptyPayload(pendingRaw!, kind)) return pendingRaw!;
      if (this.isValidNonEmptyPayload(nativeRaw!, kind)) return nativeRaw!;
      return pendingRaw!;
    }
    if (hasPending) return pendingRaw!;
    if (hasNative) return nativeRaw!;
    return null;
  }

  private static loadRawWithBackupFallbackWithMeta(
    storageKey: string,
    backupKey: string,
    kind: BackupDataKind
  ): { raw: string | null; recoveredFromBackup: boolean } {
    const localVal = this.safeLocalGet(storageKey);
    const hasPendingBackup = this.pendingBackupWrites.has(backupKey);
    const pendingBackupVal = hasPendingBackup ? (this.pendingBackupWrites.get(backupKey) ?? null) : null;
    const hasPendingHeal = this.pendingLocalHealWrites.has(storageKey);
    const pendingHealVal = hasPendingHeal ? (this.pendingLocalHealWrites.get(storageKey) ?? null) : null;
    const pendingRaw = pendingBackupVal ?? pendingHealVal;
    const hasPending = pendingRaw !== null;
    const nativeRaw = this.staleNativeBackupKeys.has(backupKey)
      ? null
      : this.safeNativeLoadBackup(backupKey);

    const isForcedEmptyActive =
      kind === 'activeState' &&
      ((this.pendingForcedBackupKeys.has(backupKey) && pendingRaw !== null && pendingRaw.trim().length === 0) ||
        (this.quotaFailedDeleteKeys.has(storageKey) && (!hasPending || (pendingRaw !== null && pendingRaw.trim().length === 0))));
    if (isForcedEmptyActive) {
      if (this.quotaFailedDeleteKeys.has(storageKey)) {
        this.tryClearLocalStorageKey(storageKey);
      }
      return { raw: null, recoveredFromBackup: false };
    }

    const localMetrics = localVal && localVal.length > 0 ? this.inspectCandidate(localVal, kind) : null;
    if (localVal && localVal.length > 0 && localMetrics && !localMetrics.parseOk) {
      this.quarantineCorruptLocalPayload(storageKey, localVal);
    }

    const forceEmptyPending =
      this.pendingForcedBackupKeys.has(backupKey) || this.quotaFailedDeleteKeys.has(storageKey);
    const backupVal = this.selectPreferredBackupRaw(pendingRaw, nativeRaw, kind, forceEmptyPending);

    if (!backupVal) {
      if (kind === 'snapshots' && this.quotaFailedDeleteKeys.has(storageKey) && !this.hasReadableNativeBackup()) {
        this.safeLocalHeal(storageKey, '[]');
        return { raw: '[]', recoveredFromBackup: false };
      }
      if (!localVal || localVal.length === 0 || !localMetrics?.parseOk) {
        return { raw: null, recoveredFromBackup: false };
      }
      return { raw: localVal, recoveredFromBackup: false };
    }

    const backupMetrics = this.inspectCandidate(backupVal, kind);
    if (!localVal || localVal.length === 0 || !localMetrics?.parseOk) {
      if (!backupMetrics.parseOk) {
        return { raw: null, recoveredFromBackup: false };
      }
      if (
        this.isValidNonEmptyPayload(backupVal, kind) ||
        (kind === 'snapshots' &&
          this.isEmptySnapshotsPayload(backupVal) &&
          (this.quotaFailedLocalKeys.has(storageKey) || this.quotaFailedDeleteKeys.has(storageKey)))
      ) {
        this.safeLocalHeal(storageKey, backupVal);
      }
      return { raw: backupVal, recoveredFromBackup: backupMetrics.nonEmpty };
    }

    if (localVal === backupVal) {
      this.quotaFailedLocalKeys.delete(storageKey);
      this.quotaFailedDeleteKeys.delete(storageKey);
      this.pendingLocalHealWrites.delete(storageKey);
      return { raw: localVal, recoveredFromBackup: false };
    }

    const preferBackupOnTie = this.quotaFailedLocalKeys.has(storageKey);
    const forceBackupWins =
      preferBackupOnTie &&
      (this.quotaFailedDeleteKeys.has(storageKey) || this.pendingForcedBackupKeys.has(backupKey));
    const selected = this.pickWinner(localVal, backupVal, kind, preferBackupOnTie, forceBackupWins);
    if (selected !== localVal) {
      if (
        this.isValidNonEmptyPayload(selected, kind) ||
        this.quotaFailedDeleteKeys.has(storageKey) ||
        (kind === 'snapshots' && this.isEmptySnapshotsPayload(selected) && this.quotaFailedLocalKeys.has(storageKey))
      ) {
        this.safeLocalHeal(storageKey, selected);
      }
      return { raw: selected, recoveredFromBackup: true };
    } else if (!this.quotaFailedDeleteKeys.has(storageKey) && this.pendingLocalHealWrites.has(storageKey)) {
      this.quotaFailedLocalKeys.delete(storageKey);
      this.pendingLocalHealWrites.delete(storageKey);
    }
    return { raw: selected, recoveredFromBackup: false };
  }

  private static loadRawWithBackupFallback(
    storageKey: string,
    backupKey: string,
    kind: BackupDataKind
  ): string | null {
    return this.loadRawWithBackupFallbackWithMeta(storageKey, backupKey, kind).raw;
  }

  private static writeLocalAndScheduleBackup(
    storageKey: string,
    backupKey: string,
    serialized: string,
    immediateBackup: boolean = false,
    skipBackup: boolean = false,
    clearLocalOnFailure: boolean = false
  ): void {
    const isEmptyPayload =
      (this.isSnapshotsBackupKey(backupKey) && this.isEmptySnapshotsPayload(serialized)) ||
      (this.matchesScopedKey(backupKey, ACTIVE_STATE_KEY) && serialized.trim().length === 0);
    try {
      if (typeof localStorage !== 'undefined' && localStorage !== null) {
        localStorage.setItem(storageKey, serialized);
        if (!skipBackup) {
          this.quotaFailedLocalKeys.delete(storageKey);
          this.quotaFailedDeleteKeys.delete(storageKey);
          this.pendingLocalHealWrites.delete(storageKey);
        }
      }
    } catch (err) {
      if (!skipBackup) {
        this.quotaFailedLocalKeys.add(storageKey);
        if (clearLocalOnFailure) {
          this.quotaFailedDeleteKeys.add(storageKey);
        } else if (!this.matchesScopedKey(storageKey, SNAPSHOTS_KEY)) {
          this.quotaFailedDeleteKeys.delete(storageKey);
        }
        let deletedLocal = false;
        if (clearLocalOnFailure) {
          try {
            if (typeof localStorage !== 'undefined' && localStorage !== null) {
              localStorage.removeItem(storageKey);
              this.quotaFailedDeleteKeys.delete(storageKey);
              deletedLocal = true;
            }
          } catch {
            // Ignore removeItem failure when storage is restricted/full
          }
        }
        if (isEmptyPayload && deletedLocal) {
          this.quotaFailedLocalKeys.delete(storageKey);
          this.pendingLocalHealWrites.delete(storageKey);
        } else {
          this.pendingLocalHealWrites.set(storageKey, serialized);
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
      this.scheduleBackupWrite(backupKey, serialized, immediateBackup, storageKey);
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

  private static hasRecognizedSettingsField(rec: Record<string, unknown>): boolean {
    const hasOwn = (obj: Record<string, unknown>, key: string) =>
      Object.prototype.hasOwnProperty.call(obj, key);
    for (const key of SETTINGS_BOOLEAN_KEYS) {
      if (hasOwn(rec, key) && typeof rec[key] === 'boolean') return true;
    }
    for (const key of SETTINGS_NUMBER_KEYS) {
      if (hasOwn(rec, key) && typeof rec[key] === 'number' && Number.isFinite(rec[key])) return true;
    }
    for (const [key, allowed] of Object.entries(SETTINGS_ENUM_VALUES)) {
      if (!hasOwn(rec, key)) continue;
      const val = rec[key];
      if (typeof val === 'string' && allowed.includes(val)) return true;
    }
    if (
      hasOwn(rec, 'generatorConfig') &&
      rec.generatorConfig &&
      typeof rec.generatorConfig === 'object' &&
      !Array.isArray(rec.generatorConfig)
    ) {
      const cfg = rec.generatorConfig as Record<string, unknown>;
      for (const [key, allowed] of Object.entries(GEN_CONFIG_ENUM_VALUES)) {
        if (!hasOwn(cfg, key)) continue;
        const val = cfg[key];
        if (typeof val === 'string' && allowed.includes(val)) return true;
      }
      for (const key of GEN_CONFIG_NUMBER_KEYS) {
        if (hasOwn(cfg, key) && typeof cfg[key] === 'number' && Number.isFinite(cfg[key])) return true;
      }
      if (hasOwn(cfg, 'isFreeColor') && typeof cfg.isFreeColor === 'boolean') return true;
    }
    return false;
  }

  private static sanitizeGeneratorConfig(rawCfg: unknown): GeneratorConfig {
    const defaults = DEFAULT_SETTINGS.generatorConfig;
    if (!rawCfg || typeof rawCfg !== 'object' || Array.isArray(rawCfg)) {
      return { ...defaults };
    }
    const cfg = rawCfg as Record<string, unknown>;
    const pickEnum = <T extends string>(key: string, fallback: T): T => {
      const val = cfg[key];
      const allowed = GEN_CONFIG_ENUM_VALUES[key];
      return typeof val === 'string' && allowed?.includes(val) ? (val as T) : fallback;
    };
    const pickFinite = (key: (typeof GEN_CONFIG_NUMBER_KEYS)[number], fallback: number): number => {
      const val = cfg[key];
      return typeof val === 'number' && Number.isFinite(val) ? val : fallback;
    };
    return {
      algorithm: pickEnum('algorithm', defaults.algorithm ?? 'AUTO'),
      lineHandling: pickEnum('lineHandling', defaults.lineHandling ?? 'ABSORB_LINES'),
      preset: pickEnum('preset', defaults.preset ?? 'MEDIUM'),
      paletteDetail: pickEnum('paletteDetail', defaults.paletteDetail),
      imageType: pickEnum('imageType', defaults.imageType),
      colorCount: pickFinite('colorCount', defaults.colorCount),
      minRegionArea: pickFinite('minRegionArea', defaults.minRegionArea),
      maxRegions: pickFinite('maxRegions', defaults.maxRegions),
      resolution: pickFinite('resolution', defaults.resolution),
      smoothingPasses: pickFinite('smoothingPasses', defaults.smoothingPasses),
      ...(typeof cfg.isFreeColor === 'boolean' ? { isFreeColor: cfg.isFreeColor } : {}),
    };
  }

  private static tryParseSettingsObject(
    raw: string | null
  ): { status: 'empty' | 'ok' | 'corrupt'; parsed: Record<string, unknown> | null } {
    if (!raw) return { status: 'empty', parsed: null };
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { status: 'corrupt', parsed: null };
      }
      const record = parsed as Record<string, unknown>;
      if (!this.hasRecognizedSettingsField(record)) {
        return { status: 'corrupt', parsed: null };
      }
      return { status: 'ok', parsed: record };
    } catch {
      return { status: 'corrupt', parsed: null };
    }
  }

  static loadSettings(): UserSettings {
    const systemReducedMotion = detectSystemReducedMotion();
    try {
      const storageKey = resolveScopedStorageKey(SETTINGS_KEY);
      const backupKey = resolveScopedBackupKey(SETTINGS_KEY);
      const { raw, recoveredFromBackup } = this.loadRawWithBackupFallbackWithMeta(
        storageKey,
        backupKey,
        'settings'
      );
      if (!raw) {
        return {
          ...DEFAULT_SETTINGS,
          reducedMotion: systemReducedMotion,
        };
      }
      const parsedRes = this.tryParseSettingsObject(raw);
      if (parsedRes.status !== 'ok' || !parsedRes.parsed) {
        return {
          ...DEFAULT_SETTINGS,
          reducedMotion: systemReducedMotion,
        };
      }
      const parsed = parsedRes.parsed;

      const pickBool = (key: keyof UserSettings, fallback: boolean): boolean =>
        typeof parsed[key] === 'boolean' ? (parsed[key] as boolean) : fallback;
      const pickFinite = (key: keyof UserSettings, fallback: number): number => {
        const val = parsed[key];
        return typeof val === 'number' && Number.isFinite(val) ? val : fallback;
      };

      const zoomSensitivity = Math.min(
        2.0,
        Math.max(0.5, pickFinite('zoomSensitivity', DEFAULT_SETTINGS.zoomSensitivity))
      );
      const snapZoomLevels = pickBool('snapZoomLevels', DEFAULT_SETTINGS.snapZoomLevels);
      const soundEnabled = pickBool('soundEnabled', DEFAULT_SETTINGS.soundEnabled);
      const soundVolume = Math.min(
        1.0,
        Math.max(0.0, pickFinite('soundVolume', DEFAULT_SETTINGS.soundVolume))
      );
      const reducedMotion = pickBool('reducedMotion', systemReducedMotion);
      const largeText = pickBool('largeText', DEFAULT_SETTINGS.largeText);
      const undoMigrationKey = resolveScopedStorageKey(UNDO_DEFAULT_MIGRATED_KEY);
      const hasUndoMigration =
        Boolean(parsed.undoDefaultMigrated) ||
        this.safeLocalGet(undoMigrationKey) === '1';
      const enableUndo = hasUndoMigration
        ? pickBool('enableUndo', DEFAULT_SETTINGS.enableUndo)
        : true;
      const difficulty =
        parsed.difficulty === 'EASY' || parsed.difficulty === 'NORMAL'
          ? parsed.difficulty
          : DEFAULT_SETTINGS.difficulty;
      const canvasBgColor =
        typeof parsed.canvasBgColor === 'string' &&
        SETTINGS_ENUM_VALUES.canvasBgColor.includes(parsed.canvasBgColor)
          ? (parsed.canvasBgColor as UserSettings['canvasBgColor'])
          : DEFAULT_SETTINGS.canvasBgColor;
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
      const rawReplaySpeed = parsed.replaySpeed;
      const replaySpeed =
        typeof rawReplaySpeed === 'number' &&
        Number.isFinite(rawReplaySpeed) &&
        rawReplaySpeed > 0 &&
        rawReplaySpeed <= 20
          ? rawReplaySpeed
          : DEFAULT_SETTINGS.replaySpeed;

      const resolved: UserSettings = {
        autoAdvance: pickBool('autoAdvance', DEFAULT_SETTINGS.autoAdvance),
        difficulty,
        isPaintMode: pickBool('isPaintMode', DEFAULT_SETTINGS.isPaintMode),
        isFreeColorMode: pickBool('isFreeColorMode', DEFAULT_SETTINGS.isFreeColorMode),
        raisePaletteDock: pickBool('raisePaletteDock', DEFAULT_SETTINGS.raisePaletteDock),
        regionColorMode,
        canvasBgColor,
        canvasBgArgb: pickFinite('canvasBgArgb', DEFAULT_SETTINGS.canvasBgArgb),
        saveSortOrder,
        showSavePreviews: pickBool('showSavePreviews', DEFAULT_SETTINGS.showSavePreviews),
        highlightStyle,
        hintFillStyle,
        hintColorArgb: pickFinite('hintColorArgb', DEFAULT_SETTINGS.hintColorArgb),
        showRegionLabels: pickBool('showRegionLabels', DEFAULT_SETTINGS.showRegionLabels),
        showPreviewLabels: pickBool('showPreviewLabels', DEFAULT_SETTINGS.showPreviewLabels),
        showPreviewBorders: pickBool('showPreviewBorders', DEFAULT_SETTINGS.showPreviewBorders),
        highlightMatching: pickBool('highlightMatching', DEFAULT_SETTINGS.highlightMatching),
        animateHint: pickBool('animateHint', DEFAULT_SETTINGS.animateHint),
        showNextRegionHint: pickBool('showNextRegionHint', DEFAULT_SETTINGS.showNextRegionHint),
        hintIntensity: pickFinite('hintIntensity', DEFAULT_SETTINGS.hintIntensity),
        labelScale: pickFinite('labelScale', DEFAULT_SETTINGS.labelScale),
        minLabelSize: pickFinite('minLabelSize', DEFAULT_SETTINGS.minLabelSize),
        maxLabelSize: pickFinite('maxLabelSize', DEFAULT_SETTINGS.maxLabelSize),
        showZoomButtons: pickBool('showZoomButtons', DEFAULT_SETTINGS.showZoomButtons),
        showResetViewButton: pickBool('showResetViewButton', DEFAULT_SETTINGS.showResetViewButton),
        paletteSort,
        prioritizeOnScreen: pickBool('prioritizeOnScreen', DEFAULT_SETTINGS.prioritizeOnScreen),
        hapticsEnabled: pickBool('hapticsEnabled', DEFAULT_SETTINGS.hapticsEnabled),
        panMomentum: pickBool('panMomentum', DEFAULT_SETTINGS.panMomentum),
        enableCustomColorForAllPuzzles: pickBool(
          'enableCustomColorForAllPuzzles',
          DEFAULT_SETTINGS.enableCustomColorForAllPuzzles
        ),
        enableUndo,
        replaySpeed,
        autoReplayOnLoad: pickBool('autoReplayOnLoad', DEFAULT_SETTINGS.autoReplayOnLoad),
        replayLoop: pickBool('replayLoop', DEFAULT_SETTINGS.replayLoop),
        replayFollow: pickBool('replayFollow', DEFAULT_SETTINGS.replayFollow),
        reverseDoubleTapZoom: pickBool(
          'reverseDoubleTapZoom',
          DEFAULT_SETTINGS.reverseDoubleTapZoom
        ),
        zoomSensitivity,
        snapZoomLevels,
        soundEnabled,
        soundVolume,
        reducedMotion,
        largeText,
        detailedLoadingProgress: pickBool(
          'detailedLoadingProgress',
          DEFAULT_SETTINGS.detailedLoadingProgress
        ),
        generatorConfig: this.sanitizeGeneratorConfig(parsed.generatorConfig),
      };
      if (!hasUndoMigration && !recoveredFromBackup) {
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
      const storageKey = resolveScopedStorageKey(SETTINGS_KEY);
      const backupKey = resolveScopedBackupKey(SETTINGS_KEY);
      const now = Date.now();
      const prevSavedAt = this.getMaxPersistedObjectTimestamp(storageKey, backupKey);
      const savedAt = prevSavedAt >= now ? prevSavedAt + 1 : now;
      const payload = { ...settings, undoDefaultMigrated: true, savedAt };
      const serialized = JSON.stringify(payload);
      this.writeLocalAndScheduleBackup(
        storageKey,
        backupKey,
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

  private static stripInternalSnapshotMeta(snapshot: SavedSnapshot): SavedSnapshot {
    if (!Object.prototype.hasOwnProperty.call(snapshot, 'metaUpdatedAt')) {
      return snapshot;
    }
    const copy = { ...snapshot } as SavedSnapshot & { metaUpdatedAt?: unknown };
    delete copy.metaUpdatedAt;
    return copy;
  }

  private static getMaxSnapshotListTs(
    snapshots: SavedSnapshot[],
    metaTsById: Map<string, number>
  ): number {
    let maxSeen = 0;
    for (const s of snapshots) {
      const candidate = Math.max(
        this.parseTimestampMs(s.lastOpened),
        this.parseTimestampMs(s.timestamp),
        metaTsById.get(s.id) ?? 0
      );
      if (candidate > maxSeen) {
        maxSeen = candidate;
      }
    }
    return maxSeen;
  }

  private static computeNextSnapshotMetaTs(
    snapshots: SavedSnapshot[],
    metaTsById: Map<string, number>,
    floorTs: number = 0
  ): number {
    const maxSeen = Math.max(floorTs, this.getMaxSnapshotListTs(snapshots, metaTsById));
    return Math.max(maxSeen + 1, Date.now());
  }

  private static stripInlinePreviews(
    snapshots: SavedSnapshot[],
    metaTsById?: Map<string, number>
  ): SavedSnapshot[] {
    return snapshots.map((s) => {
      if (typeof s.previewDataUrl === 'string' && s.previewDataUrl.length > 0) {
        this.previewCache.set(this.previewCacheKey(s.id), s.previewDataUrl);
        void this.savePreviewDataUrl(s.id, s.previewDataUrl);
      }
      const rawMetaTs = metaTsById?.get(s.id);
      const metaTs =
        typeof rawMetaTs === 'number' && Number.isFinite(rawMetaTs) && rawMetaTs > 0
          ? rawMetaTs
          : 0;
      const hasMetaProp = Object.prototype.hasOwnProperty.call(s, 'metaUpdatedAt');
      if ('previewDataUrl' in s || metaTs > 0 || hasMetaProp) {
        const copy = { ...s } as SavedSnapshot & { metaUpdatedAt?: number };
        delete copy.previewDataUrl;
        if (metaTs > 0) {
          copy.metaUpdatedAt = metaTs;
        } else {
          delete copy.metaUpdatedAt;
        }
        return copy;
      }
      return s;
    });
  }

  private static loadSnapshotsWithMeta(): {
    snapshots: SavedSnapshot[];
    metaTsById: Map<string, number>;
  } {
    const metaTsById = new Map<string, number>();
    try {
      const storageKey = resolveScopedStorageKey(SNAPSHOTS_KEY);
      const backupKey = resolveScopedBackupKey(SNAPSHOTS_KEY);
      const raw = this.loadRawWithBackupFallback(storageKey, backupKey, 'snapshots');
      if (!raw) return { snapshots: [], metaTsById };
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return { snapshots: [], metaTsById };
      let hadLegacyInlinePreview = false;
      const valid = parsed.filter(
        (s): s is SavedSnapshot =>
          Boolean(
            s &&
              typeof s === 'object' &&
              !Array.isArray(s) &&
              typeof s.id === 'string' &&
              s.id.length > 0 &&
              typeof s.title === 'string'
          )
      );
      const normalized = valid.map((s) => {
        const rawRec = s as unknown as Record<string, unknown>;
        const metaTs = Object.prototype.hasOwnProperty.call(rawRec, 'metaUpdatedAt')
          ? this.parseTimestampMs(rawRec.metaUpdatedAt)
          : 0;
        if (metaTs > 0) {
          metaTsById.set(s.id, Math.max(metaTsById.get(s.id) ?? 0, metaTs));
        }
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
        delete (base as unknown as Record<string, unknown>).metaUpdatedAt;
        if (cachedPreview) {
          base.previewDataUrl = cachedPreview;
        } else {
          delete base.previewDataUrl;
        }
        return base;
      });
      if (hadLegacyInlinePreview) {
        const stripped = this.stripInlinePreviews(normalized, metaTsById);
        this.writeLocalAndScheduleBackup(storageKey, backupKey, JSON.stringify(stripped), false);
      }
      return { snapshots: normalized, metaTsById };
    } catch {
      return { snapshots: [], metaTsById };
    }
  }

  static loadSnapshots(): SavedSnapshot[] {
    return this.loadSnapshotsWithMeta().snapshots;
  }

  private static saveSnapshotsInternal(
    snapshots: SavedSnapshot[],
    options?: {
      allowEmptyBackup?: boolean;
      immediateBackup?: boolean;
      clearLocalOnFailure?: boolean;
      metaTsById?: Map<string, number>;
    }
  ): void {
    try {
      const stripped = this.stripInlinePreviews(snapshots, options?.metaTsById);
      const serialized = JSON.stringify(stripped);
      const allowEmptyBackup = Boolean(options?.allowEmptyBackup);
      const isEmpty = stripped.length === 0;
      const skipBackup = isEmpty && !allowEmptyBackup;
      const immediateBackup = (isEmpty && allowEmptyBackup) || (Boolean(options?.immediateBackup) && !skipBackup);
      const clearLocalOnFailure =
        Boolean(options?.clearLocalOnFailure) && !skipBackup && (isEmpty || this.hasReadableNativeBackup());
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

  static saveSnapshots(
    snapshots: SavedSnapshot[],
    optionsOrImmediate?:
      | boolean
      | { allowEmptyBackup?: boolean; immediateBackup?: boolean; clearLocalOnFailure?: boolean }
  ): void {
    const options =
      typeof optionsOrImmediate === 'boolean'
        ? { immediateBackup: optionsOrImmediate }
        : optionsOrImmediate;
    this.saveSnapshotsInternal(snapshots, options);
  }

  static addSnapshot(snapshot: SavedSnapshot): SavedSnapshot[] {
    const cleanSnapshot = this.stripInternalSnapshotMeta(snapshot);
    const storageKey = resolveScopedStorageKey(SNAPSHOTS_KEY);
    const backupKey = resolveScopedBackupKey(SNAPSHOTS_KEY);
    const { snapshots: list, metaTsById } = this.loadSnapshotsWithMeta();
    const persistedMaxTs = this.getMaxPersistedSnapshotTimestamp(storageKey, backupKey);
    const prevListMaxTs = Math.max(this.getMaxSnapshotListTs(list, metaTsById), persistedMaxTs);
    const existingIndex = list.findIndex((s) => s.id === cleanSnapshot.id);
    const incomingTs = Math.max(
      this.parseTimestampMs(cleanSnapshot.lastOpened),
      this.parseTimestampMs(cleanSnapshot.timestamp)
    );
    let updated: SavedSnapshot[];
    if (existingIndex >= 0) {
      const existingItem = list[existingIndex];
      const prevItemTs = Math.max(
        this.parseTimestampMs(existingItem.lastOpened),
        this.parseTimestampMs(existingItem.timestamp),
        metaTsById.get(cleanSnapshot.id) ?? 0
      );
      const effectiveFloor = Math.max(prevItemTs, prevListMaxTs);
      if (incomingTs <= effectiveFloor) {
        metaTsById.set(
          cleanSnapshot.id,
          Math.max(this.computeNextSnapshotMetaTs(list, metaTsById, effectiveFloor), incomingTs + 1)
        );
      }
      updated = [...list];
      updated[existingIndex] = cleanSnapshot;
    } else {
      if ((list.length > 0 || persistedMaxTs > 0) && incomingTs <= prevListMaxTs) {
        metaTsById.set(
          cleanSnapshot.id,
          Math.max(this.computeNextSnapshotMetaTs(list, metaTsById, prevListMaxTs), incomingTs + 1)
        );
      }
      updated = [cleanSnapshot, ...list];
    }
    this.saveSnapshotsInternal(updated, { metaTsById });
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
    const { snapshots: list, metaTsById } = this.loadSnapshotsWithMeta();
    const prevListMaxTs = this.getMaxSnapshotListTs(list, metaTsById);
    const now = Date.now();
    let matched = false;
    let prevItemTs = 0;
    const updated = list.map((item) => {
      if (item.id === id) {
        matched = true;
        prevItemTs = Math.max(
          this.parseTimestampMs(item.lastOpened),
          this.parseTimestampMs(item.timestamp),
          metaTsById.get(id) ?? 0
        );
        return {
          ...item,
          lastOpened: now,
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
    if (matched) {
      const storageKey = resolveScopedStorageKey(SNAPSHOTS_KEY);
      const backupKey = resolveScopedBackupKey(SNAPSHOTS_KEY);
      const persistedMaxTs = this.getMaxPersistedSnapshotTimestamp(storageKey, backupKey);
      const effectivePrevMaxTs = Math.max(prevListMaxTs, persistedMaxTs);
      if (now <= prevItemTs || now <= effectivePrevMaxTs) {
        metaTsById.set(
          id,
          Math.max(
            this.computeNextSnapshotMetaTs(list, metaTsById, effectivePrevMaxTs),
            effectivePrevMaxTs + 1
          )
        );
      }
      this.saveSnapshotsInternal(updated, { metaTsById });
    }
    return updated;
  }

  static updateSnapshotViewport(
    id: string,
    zoomScale: number,
    panOffsetX: number,
    panOffsetY: number
  ): SavedSnapshot[] {
    const { snapshots: list, metaTsById } = this.loadSnapshotsWithMeta();
    let matched = false;
    const updated = list.map((item) => {
      if (item.id === id) {
        matched = true;
        return {
          ...item,
          zoomScale,
          panOffsetX,
          panOffsetY,
        };
      }
      return item;
    });
    if (matched) {
      const persistedMaxTs = this.getMaxPersistedSnapshotTimestamp(
        resolveScopedStorageKey(SNAPSHOTS_KEY),
        resolveScopedBackupKey(SNAPSHOTS_KEY)
      );
      metaTsById.set(id, this.computeNextSnapshotMetaTs(list, metaTsById, persistedMaxTs));
      this.saveSnapshotsInternal(updated, { metaTsById });
    }
    return updated;
  }

  static renameSnapshot(id: string, newTitle: string): SavedSnapshot[] {
    const { snapshots: list, metaTsById } = this.loadSnapshotsWithMeta();
    let matched = false;
    const updated = list.map((s) => {
      if (s.id === id) {
        matched = true;
        return { ...s, title: newTitle };
      }
      return s;
    });
    if (matched) {
      const persistedMaxTs = this.getMaxPersistedSnapshotTimestamp(
        resolveScopedStorageKey(SNAPSHOTS_KEY),
        resolveScopedBackupKey(SNAPSHOTS_KEY)
      );
      metaTsById.set(id, this.computeNextSnapshotMetaTs(list, metaTsById, persistedMaxTs));
      this.saveSnapshotsInternal(updated, { metaTsById });
    }
    return updated;
  }

  static togglePinSnapshot(id: string): SavedSnapshot[] {
    const { snapshots: list, metaTsById } = this.loadSnapshotsWithMeta();
    let matched = false;
    const updated = list.map((s) => {
      if (s.id === id) {
        matched = true;
        return { ...s, isPinned: !s.isPinned };
      }
      return s;
    });
    if (matched) {
      const persistedMaxTs = this.getMaxPersistedSnapshotTimestamp(
        resolveScopedStorageKey(SNAPSHOTS_KEY),
        resolveScopedBackupKey(SNAPSHOTS_KEY)
      );
      metaTsById.set(id, this.computeNextSnapshotMetaTs(list, metaTsById, persistedMaxTs));
      this.saveSnapshotsInternal(updated, { metaTsById });
    }
    return updated;
  }

  static async deleteSnapshot(id: string): Promise<SavedSnapshot[]> {
    this.previewCache.delete(this.previewCacheKey(id));
    const { snapshots: list, metaTsById } = this.loadSnapshotsWithMeta();
    const updated = list.filter((s) => s.id !== id);
    if (updated.length < list.length) {
      if (updated.length > 0) {
        const storageKey = resolveScopedStorageKey(SNAPSHOTS_KEY);
        const backupKey = resolveScopedBackupKey(SNAPSHOTS_KEY);
        const persistedMaxTs = this.getMaxPersistedSnapshotTimestamp(storageKey, backupKey);
        const prevListMaxTs = Math.max(this.getMaxSnapshotListTs(list, metaTsById), persistedMaxTs);
        const nextMetaTs = this.computeNextSnapshotMetaTs(list, metaTsById, prevListMaxTs);
        metaTsById.delete(id);
        metaTsById.set(updated[0].id, nextMetaTs);
      }
      this.saveSnapshotsInternal(updated, {
        immediateBackup: true,
        allowEmptyBackup: updated.length === 0,
        clearLocalOnFailure: true,
        metaTsById: updated.length > 0 ? metaTsById : undefined,
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
    updatedAt?: number;
  }): void {
    try {
      const storageKey = resolveScopedStorageKey(ACTIVE_STATE_KEY);
      const backupKey = resolveScopedBackupKey(ACTIVE_STATE_KEY);
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
      const now = Date.now();
      const prevSavedAt = this.getMaxPersistedObjectTimestamp(storageKey, backupKey);
      const savedAt = prevSavedAt >= now ? prevSavedAt + 1 : now;
      const payload = { ...basePayload, savedAt };
      const serialized = JSON.stringify(payload);
      this.writeLocalAndScheduleBackup(
        storageKey,
        backupKey,
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
    this.pendingBackupStorageKeys.delete(backupKey);
    this.pendingForcedBackupKeys.delete(backupKey);
    this.pendingLocalHealWrites.delete(storageKey);
    try {
      if (typeof localStorage !== 'undefined' && localStorage !== null) {
        localStorage.removeItem(storageKey);
        this.quotaFailedLocalKeys.delete(storageKey);
        this.quotaFailedDeleteKeys.delete(storageKey);
      }
    } catch {
      this.quotaFailedLocalKeys.add(storageKey);
      this.quotaFailedDeleteKeys.add(storageKey);
      this.pendingLocalHealWrites.delete(storageKey);
    }
    try {
      this.scheduleBackupWrite(backupKey, '', true, storageKey);
    } catch {
      // ignore
    }
  }

  private static tryParseActiveState(raw: string | null): {
    status: 'empty' | 'ok' | 'corrupt';
    state: {
      activeSnapshotId: string | null;
      activeColorId: number;
      filledRegionIds: number[];
      paintedRegionColors?: Record<number, number>;
      isFreeColorMode?: boolean;
      resetEpoch?: number;
      zoomScale: number;
      panOffsetX: number;
      panOffsetY: number;
      updatedAt?: number;
    } | null;
  } {
    if (!raw) return { status: 'empty', state: null };
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { status: 'corrupt', state: null };
      }
      const rec = parsed as Record<string, unknown>;
      const hasOwn = (key: string) => Object.prototype.hasOwnProperty.call(rec, key);

      let recognizedCount = 0;
      if (hasOwn('activeSnapshotId')) {
        if (rec.activeSnapshotId !== null && typeof rec.activeSnapshotId !== 'string') {
          return { status: 'corrupt', state: null };
        }
        recognizedCount++;
      }
      if (hasOwn('activeColorId')) {
        if (typeof rec.activeColorId !== 'number' || !Number.isFinite(rec.activeColorId)) {
          return { status: 'corrupt', state: null };
        }
        recognizedCount++;
      }
      if (hasOwn('filledRegionIds')) {
        if (!Array.isArray(rec.filledRegionIds)) {
          return { status: 'corrupt', state: null };
        }
        recognizedCount++;
      }
      if (hasOwn('zoomScale')) {
        if (typeof rec.zoomScale !== 'number' || !Number.isFinite(rec.zoomScale)) {
          return { status: 'corrupt', state: null };
        }
        recognizedCount++;
      }
      if (hasOwn('panOffsetX')) {
        if (typeof rec.panOffsetX !== 'number' || !Number.isFinite(rec.panOffsetX)) {
          return { status: 'corrupt', state: null };
        }
        recognizedCount++;
      }
      if (hasOwn('panOffsetY')) {
        if (typeof rec.panOffsetY !== 'number' || !Number.isFinite(rec.panOffsetY)) {
          return { status: 'corrupt', state: null };
        }
        recognizedCount++;
      }
      if (hasOwn('updatedAt')) {
        if (typeof rec.updatedAt !== 'number' || !Number.isFinite(rec.updatedAt)) {
          return { status: 'corrupt', state: null };
        }
        recognizedCount++;
      }
      if (hasOwn('savedAt')) {
        if (typeof rec.savedAt !== 'number' || !Number.isFinite(rec.savedAt)) {
          return { status: 'corrupt', state: null };
        }
        recognizedCount++;
      }
      if (hasOwn('resetEpoch')) {
        if (typeof rec.resetEpoch !== 'number' || !Number.isFinite(rec.resetEpoch) || rec.resetEpoch < 0) {
          return { status: 'corrupt', state: null };
        }
        recognizedCount++;
      }
      if (hasOwn('isFreeColorMode')) {
        if (typeof rec.isFreeColorMode !== 'boolean') {
          return { status: 'corrupt', state: null };
        }
        recognizedCount++;
      }
      if (hasOwn('paintedRegionColors')) {
        if (
          !rec.paintedRegionColors ||
          typeof rec.paintedRegionColors !== 'object' ||
          Array.isArray(rec.paintedRegionColors)
        ) {
          return { status: 'corrupt', state: null };
        }
        recognizedCount++;
      }
      if (recognizedCount === 0) {
        return { status: 'corrupt', state: null };
      }

      let paintedRegionColors: Record<number, number> | undefined;
      if (
        hasOwn('paintedRegionColors') &&
        rec.paintedRegionColors &&
        typeof rec.paintedRegionColors === 'object' &&
        !Array.isArray(rec.paintedRegionColors)
      ) {
        const cleanColors: Record<number, number> = {};
        for (const [k, v] of Object.entries(rec.paintedRegionColors as Record<string, unknown>)) {
          if (/^\d+$/.test(k) && typeof v === 'number' && Number.isFinite(v)) {
            cleanColors[Number(k)] = v;
          }
        }
        paintedRegionColors = cleanColors;
      }

      const normalized = {
        activeSnapshotId:
          typeof rec.activeSnapshotId === 'string' ? rec.activeSnapshotId : null,
        activeColorId:
          typeof rec.activeColorId === 'number' && Number.isFinite(rec.activeColorId)
            ? rec.activeColorId
            : 1,
        filledRegionIds: Array.isArray(rec.filledRegionIds)
          ? rec.filledRegionIds.filter(
              (id: unknown) => typeof id === 'number' && Number.isFinite(id)
            )
          : [],
        ...(paintedRegionColors !== undefined ? { paintedRegionColors } : {}),
        ...(typeof rec.isFreeColorMode === 'boolean'
          ? { isFreeColorMode: rec.isFreeColorMode }
          : {}),
        ...(typeof rec.resetEpoch === 'number' &&
        Number.isFinite(rec.resetEpoch) &&
        rec.resetEpoch >= 0
          ? { resetEpoch: rec.resetEpoch }
          : {}),
        zoomScale:
          typeof rec.zoomScale === 'number' &&
          Number.isFinite(rec.zoomScale) &&
          rec.zoomScale > 0
            ? rec.zoomScale
            : 1,
        panOffsetX:
          typeof rec.panOffsetX === 'number' && Number.isFinite(rec.panOffsetX)
            ? rec.panOffsetX
            : 0,
        panOffsetY:
          typeof rec.panOffsetY === 'number' && Number.isFinite(rec.panOffsetY)
            ? rec.panOffsetY
            : 0,
        ...(typeof rec.updatedAt === 'number' && Number.isFinite(rec.updatedAt)
          ? { updatedAt: rec.updatedAt }
          : {}),
      };
      return { status: 'ok', state: normalized };
    } catch {
      return { status: 'corrupt', state: null };
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
    updatedAt?: number;
  } | null {
    try {
      const raw = this.loadRawWithBackupFallback(
        resolveScopedStorageKey(ACTIVE_STATE_KEY),
        resolveScopedBackupKey(ACTIVE_STATE_KEY),
        'activeState'
      );
      if (!raw) return null;
      const parsedRes = this.tryParseActiveState(raw);
      if (parsedRes.status !== 'ok' || !parsedRes.state) return null;
      return parsedRes.state;
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
    const sanitizedImported = imported.map((s) => this.stripInternalSnapshotMeta(s));
    const isBootstrapBatch =
      Boolean(refreshTimestamps) && existing.length > 0 && sanitizedImported.every((s) => Boolean(s.isAutoSample));

    if (isBootstrapBatch) {
      const existingIds = new Set(existing.map((s) => s.id));
      const minExistingTs = existing.reduce((minTs, s) => {
        const candidate = s.lastOpened || s.timestamp || minTs;
        return candidate > 0 && candidate < minTs ? candidate : minTs;
      }, now);
      const sampleBaseTs = Math.min(now, minExistingTs - 1000);
      const newSamples = sanitizedImported
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

    const normalized = sanitizedImported.map((s, idx) =>
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

  private static syncImportedMetaTimestamps(
    existing: SavedSnapshot[],
    toPersist: SavedSnapshot[],
    metaTsById: Map<string, number>,
    persistedMaxTs: number = this.getMaxPersistedSnapshotTimestamp(
      resolveScopedStorageKey(SNAPSHOTS_KEY),
      resolveScopedBackupKey(SNAPSHOTS_KEY)
    )
  ): void {
    const existingById = new Map(existing.map((s) => [s.id, s]));
    const hasPriorHistory = existing.length > 0 || persistedMaxTs > 0;
    let floorTs = Math.max(this.getMaxSnapshotListTs(existing, metaTsById), persistedMaxTs);
    for (const s of toPersist) {
      const prevItem = existingById.get(s.id);
      const prevItemTs = prevItem
        ? Math.max(
            this.parseTimestampMs(prevItem.lastOpened),
            this.parseTimestampMs(prevItem.timestamp),
            metaTsById.get(s.id) ?? 0
          )
        : (metaTsById.get(s.id) ?? 0);
      const incomingTs = Math.max(
        this.parseTimestampMs(s.lastOpened),
        this.parseTimestampMs(s.timestamp)
      );
      const effectiveFloor = Math.max(prevItemTs, floorTs);
      if (prevItem || (hasPriorHistory && incomingTs <= effectiveFloor)) {
        if (incomingTs <= effectiveFloor) {
          const nextTs = Math.max(
            this.computeNextSnapshotMetaTs(existing, metaTsById, effectiveFloor),
            incomingTs + 1
          );
          metaTsById.set(s.id, nextTs);
          floorTs = Math.max(floorTs, nextTs);
        }
      }
    }
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
            assertValidSavedSnapshot(decoded.snapshot, { strictV2: true });
            const rawSnap = this.stripInternalSnapshotMeta(decoded.snapshot);
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
            for (const s of decoded.snapshots) {
              assertValidSavedSnapshot(s, { strictV2: true });
            }
            const validSnapshots = decoded.snapshots.filter(
              (s) => !options?.filterSnapshotId || s.id === options.filterSnapshotId
            );
            if (validSnapshots.length === 0) {
              return { importedCount: 0, error: 'No valid snapshots in binary archive' };
            }

            const { snapshots: existing, metaTsById } = this.loadSnapshotsWithMeta();
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
            const persistedMaxTs = this.getMaxPersistedSnapshotTimestamp(
              resolveScopedStorageKey(SNAPSHOTS_KEY),
              resolveScopedBackupKey(SNAPSHOTS_KEY)
            );
            this.syncImportedMetaTimestamps(existing, toPersist, metaTsById, persistedMaxTs);
            this.saveSnapshotsInternal(mergedList, { metaTsById });
            return {
              importedCount: toPersist.length > 0 ? toPersist.length : validSnapshots.length,
              firstSnapshot: toPersist[0] || this.stripInternalSnapshotMeta(validSnapshots[0]),
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
      if (
        typeof data === 'object' &&
        !Array.isArray(data) &&
        data.format === 'capy-single-save' &&
        data.snapshot !== undefined
      ) {
        assertValidSavedSnapshot(data.snapshot, { strictV2: false });
        const rawSnap = this.stripInternalSnapshotMeta(data.snapshot as SavedSnapshot);
        const snap: SavedSnapshot = options?.refreshTimestamps
          ? { ...rawSnap, timestamp: now, lastOpened: now }
          : rawSnap;
        let firstPuzzle: PuzzleData | undefined;
        if (data.puzzle !== undefined && data.puzzle !== null) {
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
      if (
        typeof data === 'object' &&
        !Array.isArray(data) &&
        data.format === 'capy-archive-save' &&
        Array.isArray(data.snapshots)
      ) {
        if (data.snapshots.length === 0) {
          return { importedCount: 0, error: 'No valid snapshots in archive' };
        }
        for (const s of data.snapshots) {
          assertValidSavedSnapshot(s, { strictV2: false });
        }
        const validSnapshots = data.snapshots as SavedSnapshot[];

        if (
          data.puzzles !== undefined &&
          data.puzzles !== null &&
          (typeof data.puzzles !== 'object' || Array.isArray(data.puzzles))
        ) {
          return { importedCount: 0, error: 'Invalid puzzles map in archive' };
        }

        const { snapshots: existing, metaTsById } = this.loadSnapshotsWithMeta();
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
            if (serialized !== undefined && serialized !== null) {
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
        const persistedMaxTs = this.getMaxPersistedSnapshotTimestamp(
          resolveScopedStorageKey(SNAPSHOTS_KEY),
          resolveScopedBackupKey(SNAPSHOTS_KEY)
        );
        this.syncImportedMetaTimestamps(existing, toPersist, metaTsById, persistedMaxTs);
        this.saveSnapshotsInternal(mergedList, { metaTsById });

        return {
          importedCount: toPersist.length > 0 ? toPersist.length : validSnapshots.length,
          firstSnapshot: toPersist[0] || this.stripInternalSnapshotMeta(validSnapshots[0]),
          firstPuzzle,
        };
      }

      // Fallback: array of snapshots
      if (Array.isArray(data)) {
        if (data.length === 0) {
          return { importedCount: 0, error: 'No valid snapshots in array' };
        }
        for (const s of data) {
          assertValidSavedSnapshot(s, { strictV2: false });
        }
        const validSnapshots = data as SavedSnapshot[];
        const { snapshots: existing, metaTsById } = this.loadSnapshotsWithMeta();
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
        const persistedMaxTs = this.getMaxPersistedSnapshotTimestamp(
          resolveScopedStorageKey(SNAPSHOTS_KEY),
          resolveScopedBackupKey(SNAPSHOTS_KEY)
        );
        this.syncImportedMetaTimestamps(existing, toPersist, metaTsById, persistedMaxTs);
        this.saveSnapshotsInternal(mergedList, { metaTsById });
        return {
          importedCount: toPersist.length > 0 ? toPersist.length : validSnapshots.length,
          firstSnapshot: toPersist[0] || this.stripInternalSnapshotMeta(validSnapshots[0]),
        };
      }

      return { importedCount: 0, error: 'Unrecognized Capy save format' };
    } catch (err: any) {
      return { importedCount: 0, error: err?.message || 'Failed to parse JSON save' };
    }
  }
}

export const DEV_DEBUG_STORAGE_KEY = 'capy_dev_debug';

export function isDebugStorageExposed(
  search?: string,
  storageValue?: string | null,
  isDevOverride?: boolean
): boolean {
  const isDev =
    isDevOverride !== undefined ? isDevOverride : Boolean(import.meta.env?.DEV);
  if (isDev) return true;

  const effectiveSearch =
    search !== undefined
      ? search
      : typeof window !== 'undefined'
        ? (window.location?.search ?? '')
        : '';
  if (effectiveSearch) {
    const params = new URLSearchParams(
      effectiveSearch.startsWith('?') ? effectiveSearch : `?${effectiveSearch}`
    );
    const rawDebug = (params.get('capy_debug') || '').trim().toLowerCase();
    if (rawDebug === '0' || rawDebug === 'false') {
      return false;
    }
    if (rawDebug === '1' || rawDebug === 'true') {
      return true;
    }
  }

  let stored = storageValue;
  if (stored === undefined && typeof window !== 'undefined') {
    try {
      stored = window.localStorage?.getItem(DEV_DEBUG_STORAGE_KEY) ?? null;
    } catch {
      stored = null;
    }
  }
  return stored === '1' || stored === 'true';
}

if (typeof window !== 'undefined' && isDebugStorageExposed()) {
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
  if (bytes.byteLength % 4 !== 0) {
    throw new Error('Invalid Int32Array byte length in puzzle payload');
  }
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
  if (!Number.isInteger(total) || total <= 0 || total > MAX_PUZZLE_PIXELS) {
    throw new Error('Invalid regionMap pixel count');
  }
  if (typeof b64 !== 'string' || b64.length === 0) {
    throw new Error('Invalid or empty RLE regionMap');
  }
  const bytes = base64ToUint8(b64);
  const byteLen = bytes.byteLength;
  if (byteLen === 0 || byteLen % 4 !== 0) {
    throw new Error('Invalid RLE regionMap byte length');
  }
  const regionMap = new Int32Array(total);
  let writePos = 0;
  let i = 0;
  for (; i < byteLen; i += 4) {
    const rid = bytes[i] | (bytes[i + 1] << 8);
    const len = bytes[i + 2] | (bytes[i + 3] << 8);
    if (len === 0) {
      throw new Error('Invalid zero-length run in RLE regionMap');
    }
    if (writePos + len > total) {
      throw new Error('RLE regionMap run exceeds expected puzzle pixel count');
    }
    const end = writePos + len;
    regionMap.fill(rid, writePos, end);
    writePos = end;
  }
  if (writePos !== total || i !== byteLen) {
    throw new Error('Decoded RLE regionMap length mismatch');
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
    !Array.isArray(s.regions)
  ) {
    throw new Error('Invalid puzzle payload dimensions or structure');
  }
  assertValidPalette(s.palette);
  if (s.isFreeColor !== undefined && typeof s.isFreeColor !== 'boolean') {
    throw new Error('Invalid isFreeColor flag in puzzle payload');
  }
  const total = s.width * s.height;
  if (!Number.isSafeInteger(total) || total <= 0 || total > MAX_PUZZLE_PIXELS) {
    throw new Error('Invalid puzzle payload dimensions or structure');
  }
  let regionMap: Int32Array;
  if (s.regionMapRleB64 !== undefined) {
    if (typeof s.regionMapRleB64 !== 'string' || s.regionMapRleB64.length === 0) {
      throw new Error('Invalid or empty regionMapRleB64 in puzzle payload');
    }
    regionMap = decodeRegionMapRle16(s.regionMapRleB64, total);
  } else if (s.regionMapB64 !== undefined) {
    if (typeof s.regionMapB64 !== 'string' || s.regionMapB64.length === 0) {
      throw new Error('Invalid or empty regionMapB64 in puzzle payload');
    }
    regionMap = base64ToInt32Array(s.regionMapB64);
  } else {
    throw new Error('Missing regionMap in puzzle payload');
  }
  if (regionMap.length !== total) {
    throw new Error('Decoded regionMap length mismatch');
  }

  let borderMap: Uint8Array;
  if (s.borderMapB64 !== undefined) {
    if (typeof s.borderMapB64 !== 'string' || s.borderMapB64.length === 0) {
      throw new Error('Invalid or empty borderMapB64 in puzzle payload');
    }
    borderMap = base64ToUint8(s.borderMapB64);
  } else {
    borderMap = buildBorderMapFromRegionMap(regionMap, s.width, s.height);
  }
  if (borderMap.length !== total) {
    throw new Error('Decoded borderMap length mismatch');
  }

  const maxAllowedRegionId = Math.max(total, MAX_DELTA_REGION_ENTRIES);
  if (s.regions.length > maxAllowedRegionId) {
    throw new Error('Puzzle region count exceeds safety limit');
  }

  let maxRegionId = 0;
  for (let i = 0; i < s.regions.length; i++) {
    const r = s.regions[i];
    if (
      !r ||
      typeof r !== 'object' ||
      typeof r.id !== 'number' ||
      !Number.isInteger(r.id) ||
      r.id < 0 ||
      r.id > maxAllowedRegionId ||
      typeof r.colorId !== 'number' ||
      !Number.isInteger(r.colorId) ||
      r.colorId < 0 ||
      typeof r.centroidX !== 'number' ||
      !Number.isFinite(r.centroidX) ||
      typeof r.centroidY !== 'number' ||
      !Number.isFinite(r.centroidY) ||
      typeof r.area !== 'number' ||
      !Number.isFinite(r.area) ||
      r.area < 0 ||
      typeof r.maxRadius !== 'number' ||
      !Number.isFinite(r.maxRadius) ||
      r.maxRadius < 0 ||
      (r.minX !== undefined && (typeof r.minX !== 'number' || !Number.isFinite(r.minX))) ||
      (r.maxX !== undefined && (typeof r.maxX !== 'number' || !Number.isFinite(r.maxX))) ||
      (r.minY !== undefined && (typeof r.minY !== 'number' || !Number.isFinite(r.minY))) ||
      (r.maxY !== undefined && (typeof r.maxY !== 'number' || !Number.isFinite(r.maxY)))
    ) {
      throw new Error('Invalid puzzle region metadata or ID out of bounds');
    }
    if (r.id > maxRegionId) {
      maxRegionId = r.id;
    }
  }

  const hasLegacyPixels = s.regions.length > 0 && s.regions.every((r) => typeof r.pixelsB64 === 'string');
  if (hasLegacyPixels) {
    return {
      width: s.width,
      height: s.height,
      palette: s.palette,
      regionMap,
      borderMap,
      isFreeColor: s.isFreeColor,
      regions: s.regions.map((r) => {
        const pixels = base64ToInt32Array(r.pixelsB64!);
        if (pixels.length > total) {
          throw new Error('Decoded region pixel array exceeds puzzle pixel count');
        }
        return {
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
          pixels,
        };
      }),
    };
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
