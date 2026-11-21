import { NativeBridge } from '../NativeBridge';
import { reportSwallowed } from '../telemetry';
import { isQuotaError, notifyQuotaWarning, SafeLocalStore } from './SafeLocalStore';
import { ACTIVE_STATE_KEY, matchesScopedKey, SNAPSHOTS_KEY } from './StorageKeys';

export type BackupDataKind = 'snapshots' | 'settings' | 'activeState';

export interface BackupCandidateValidator {
  hasRecognizedSettingsField?: (rec: Record<string, unknown>) => boolean;
  defaultSettingsKeys?: ReadonlySet<string>;
  isValidActiveStateRaw?: (trimmedRaw: string) => boolean;
}

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

const BACKUP_DEBOUNCE_MS = 400;
const BACKUP_FLUSH_BACKOFF_MS = [400, 400, 800, 1600, 3200];

const pendingBackupWrites = new Map<string, string>();
const pendingBackupStorageKeys = new Map<string, string>();
const pendingLocalHealWrites = new Map<string, string>();
const pendingForcedBackupKeys = new Set<string>();
const staleNativeBackupKeys = new Set<string>();
const quotaFailedLocalKeys = new Set<string>();
const quotaFailedDeleteKeys = new Set<string>();
let backupFlushTimer: ReturnType<typeof setTimeout> | null = null;
let backupFlushRetryAttempt = 0;
let lifecycleFlushRegistered = false;

export function parseTimestampMs(val: unknown): number {
  return typeof val === 'number' && Number.isFinite(val) && val > 0 ? val : 0;
}

export function nonNegFinite(val: unknown): number {
  return typeof val === 'number' && Number.isFinite(val) && val >= 0 ? val : 0;
}

export function extractObjectTimestamp(obj: Record<string, unknown>): number {
  return Math.max(
    parseTimestampMs(obj.savedAt),
    parseTimestampMs(obj.updatedAt),
    parseTimestampMs(obj.timestamp),
    parseTimestampMs(obj.lastModified)
  );
}

export function hasReadableNativeBackup(): boolean {
  return typeof window !== 'undefined' && typeof window.CapyAndroid?.loadBackup === 'function';
}

function safeNativeLoadBackup(backupKey: string): string | null {
  try {
    const val = NativeBridge.loadBackup(backupKey);
    return val && val.length > 0 ? val : null;
  } catch (err) {
    reportSwallowed('BackupEngine.safeNativeLoadBackup', err, { backupKey });
    return null;
  }
}

function isSnapshotsBackupKey(backupKey: string): boolean {
  return matchesScopedKey(backupKey, SNAPSHOTS_KEY);
}

function isEmptySnapshotsPayload(serialized: string): boolean {
  const trimmed = serialized.trim();
  if (trimmed.length === 0 || trimmed === '[]') return true;
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) && parsed.length === 0;
  } catch {
    return false;
  }
}

function hasPendingFlushWork(): boolean {
  return (
    pendingBackupWrites.size > 0 ||
    pendingLocalHealWrites.size > 0 ||
    quotaFailedDeleteKeys.size > 0
  );
}

function clearBackupFlushTimer(): void {
  if (backupFlushTimer !== null) {
    clearTimeout(backupFlushTimer);
    backupFlushTimer = null;
  }
}

function ensureLifecycleFlushRegistered(): void {
  if (lifecycleFlushRegistered) return;
  lifecycleFlushRegistered = true;
  const flush = () => flushPendingBackups();
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
  } catch (err) {
    reportSwallowed('BackupEngine.ensureLifecycleFlushRegistered', err);
  }
}

function scheduleBackupFlushTimer(isRetry: boolean = false): void {
  if (!isRetry) {
    if (backupFlushRetryAttempt > 0) {
      clearBackupFlushTimer();
    }
    backupFlushRetryAttempt = 0;
  }
  if (backupFlushTimer !== null) return;
  const delayMs = isRetry
    ? BACKUP_FLUSH_BACKOFF_MS[Math.min(backupFlushRetryAttempt, BACKUP_FLUSH_BACKOFF_MS.length - 1)]
    : BACKUP_DEBOUNCE_MS;
  backupFlushTimer = setTimeout(() => {
    backupFlushTimer = null;
    flushPendingBackups();
  }, delayMs);
  if (
    typeof backupFlushTimer === 'object' &&
    backupFlushTimer !== null &&
    typeof (backupFlushTimer as { unref?: () => void }).unref === 'function'
  ) {
    (backupFlushTimer as { unref: () => void }).unref();
  }
}

function safeLocalHeal(storageKey: string, value: string): boolean {
  if (!SafeLocalStore.setItem(storageKey, value)) {
    return false;
  }
  quotaFailedLocalKeys.delete(storageKey);
  quotaFailedDeleteKeys.delete(storageKey);
  pendingLocalHealWrites.delete(storageKey);
  if (!hasPendingFlushWork()) {
    clearBackupFlushTimer();
    backupFlushRetryAttempt = 0;
  }
  return true;
}

function tryClearLocalStorageKey(storageKey: string): boolean {
  if (!SafeLocalStore.removeItem(storageKey)) {
    return false;
  }
  quotaFailedLocalKeys.delete(storageKey);
  quotaFailedDeleteKeys.delete(storageKey);
  pendingLocalHealWrites.delete(storageKey);
  if (!hasPendingFlushWork()) {
    clearBackupFlushTimer();
    backupFlushRetryAttempt = 0;
  }
  return true;
}

function flushNativeBackupQueue(): void {
  const entries = Array.from(pendingBackupWrites.entries());
  const storageKeyMap = new Map(pendingBackupStorageKeys);
  pendingBackupWrites.clear();
  pendingBackupStorageKeys.clear();
  for (const [backupKey, serialized] of entries) {
    const storageKey = storageKeyMap.get(backupKey) ?? backupKey;
    const isForced = pendingForcedBackupKeys.has(backupKey);
    if (isSnapshotsBackupKey(backupKey) && isEmptySnapshotsPayload(serialized) && !isForced) {
      pendingForcedBackupKeys.delete(backupKey);
      continue;
    }
    let ok = false;
    try {
      ok = NativeBridge.saveBackup(backupKey, serialized);
    } catch (err) {
      reportSwallowed('BackupEngine.flushNativeBackupQueue', err, { backupKey });
      ok = false;
    }
    if (ok) {
      staleNativeBackupKeys.delete(backupKey);
      pendingForcedBackupKeys.delete(backupKey);
    } else {
      staleNativeBackupKeys.add(backupKey);
      pendingBackupWrites.set(backupKey, serialized);
      pendingBackupStorageKeys.set(backupKey, storageKey);
      if (isForced) {
        pendingForcedBackupKeys.add(backupKey);
      }
    }
  }
}

function flushLocalHealQueue(): void {
  for (const [storageKey, serialized] of Array.from(pendingLocalHealWrites.entries())) {
    if (matchesScopedKey(storageKey, ACTIVE_STATE_KEY) && serialized.trim().length === 0) {
      tryClearLocalStorageKey(storageKey);
    } else {
      safeLocalHeal(storageKey, serialized);
    }
  }
}

function hasNonEmptyPendingBackupForStorageKey(storageKey: string): boolean {
  for (const [bKey, bVal] of pendingBackupWrites.entries()) {
    const mappedStorageKey = pendingBackupStorageKeys.get(bKey) ?? bKey;
    if (mappedStorageKey !== storageKey) continue;
    const isEmptyBak =
      bVal.trim().length === 0 || (isSnapshotsBackupKey(bKey) && isEmptySnapshotsPayload(bVal));
    if (!isEmptyBak) {
      return true;
    }
  }
  return false;
}

function flushQuotaFailedDeletes(): void {
  for (const storageKey of Array.from(quotaFailedDeleteKeys)) {
    const healVal = pendingLocalHealWrites.get(storageKey);
    const isEmptyHeal =
      healVal === undefined ||
      healVal.trim().length === 0 ||
      (matchesScopedKey(storageKey, SNAPSHOTS_KEY) && isEmptySnapshotsPayload(healVal));
    if (!isEmptyHeal || hasNonEmptyPendingBackupForStorageKey(storageKey)) {
      continue;
    }
    if (matchesScopedKey(storageKey, ACTIVE_STATE_KEY)) {
      tryClearLocalStorageKey(storageKey);
    } else if (matchesScopedKey(storageKey, SNAPSHOTS_KEY)) {
      if (!safeLocalHeal(storageKey, '[]')) {
        tryClearLocalStorageKey(storageKey);
      }
    }
  }
}

export function flushPendingBackups(): void {
  clearBackupFlushTimer();
  const isNative = NativeBridge.isNative;
  if (!isNative) {
    pendingBackupWrites.clear();
    pendingBackupStorageKeys.clear();
    staleNativeBackupKeys.clear();
    pendingForcedBackupKeys.clear();
  }
  if (!hasPendingFlushWork()) {
    backupFlushRetryAttempt = 0;
    return;
  }

  if (isNative && pendingBackupWrites.size > 0) {
    flushNativeBackupQueue();
  }
  if (pendingLocalHealWrites.size > 0) {
    flushLocalHealQueue();
  }
  if (quotaFailedDeleteKeys.size > 0) {
    flushQuotaFailedDeletes();
  }

  if (!hasPendingFlushWork()) {
    backupFlushRetryAttempt = 0;
  } else if (backupFlushRetryAttempt < BACKUP_FLUSH_BACKOFF_MS.length) {
    backupFlushRetryAttempt += 1;
    scheduleBackupFlushTimer(true);
  }
}

function syncTimerAfterQueueUpdate(): void {
  if (hasPendingFlushWork()) {
    scheduleBackupFlushTimer();
  } else {
    clearBackupFlushTimer();
    backupFlushRetryAttempt = 0;
  }
}

export function scheduleBackupWrite(
  backupKey: string,
  serialized: string,
  immediate: boolean = false,
  storageKey: string = backupKey
): void {
  const isEmptySnapshot = isSnapshotsBackupKey(backupKey) && isEmptySnapshotsPayload(serialized);
  if (!immediate && isEmptySnapshot) {
    return;
  }
  const isEmptyActive =
    matchesScopedKey(backupKey, ACTIVE_STATE_KEY) && serialized.trim().length === 0;
  ensureLifecycleFlushRegistered();
  if (!NativeBridge.isNative) {
    pendingBackupWrites.delete(backupKey);
    pendingBackupStorageKeys.delete(backupKey);
    pendingForcedBackupKeys.delete(backupKey);
    staleNativeBackupKeys.delete(backupKey);
    syncTimerAfterQueueUpdate();
    return;
  }
  if (immediate) {
    pendingBackupWrites.delete(backupKey);
    pendingBackupStorageKeys.delete(backupKey);
    pendingForcedBackupKeys.delete(backupKey);
    let ok = false;
    try {
      ok = NativeBridge.saveBackup(backupKey, serialized);
    } catch (err) {
      reportSwallowed('BackupEngine.scheduleBackupWriteImmediate', err, { backupKey });
      ok = false;
    }
    if (ok) {
      staleNativeBackupKeys.delete(backupKey);
    } else {
      staleNativeBackupKeys.add(backupKey);
      pendingBackupWrites.set(backupKey, serialized);
      pendingBackupStorageKeys.set(backupKey, storageKey);
      if (isEmptySnapshot || isEmptyActive) {
        pendingForcedBackupKeys.add(backupKey);
      }
    }
    syncTimerAfterQueueUpdate();
    return;
  }
  pendingForcedBackupKeys.delete(backupKey);
  pendingBackupWrites.set(backupKey, serialized);
  pendingBackupStorageKeys.set(backupKey, storageKey);
  scheduleBackupFlushTimer();
}

export function getMaxPersistedObjectTimestamp(storageKey: string, backupKey: string): number {
  let maxTs = 0;
  const candidates: Array<string | null | undefined> = [
    SafeLocalStore.getItem(storageKey),
    pendingBackupWrites.get(backupKey),
    pendingLocalHealWrites.get(storageKey),
    hasReadableNativeBackup() ? safeNativeLoadBackup(backupKey) : null,
  ];
  for (const raw of candidates) {
    if (!raw || raw.trim().length === 0) continue;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const ts = extractObjectTimestamp(parsed as Record<string, unknown>);
        if (ts > maxTs) {
          maxTs = ts;
        }
      }
    } catch {
      // Malformed candidate JSON is expected during probing
    }
  }
  return maxTs;
}

function createEmptyMetrics(): BackupCandidateMetrics {
  return {
    parseOk: false,
    nonEmpty: false,
    maxTs: 0,
    knownFieldCount: 0,
    fieldCount: 0,
    snapshotEpochs: new Map<string, number>(),
    totalFilled: 0,
    count: 0,
    completeness: 0,
    hasSnapshotId: false,
    snapshotId: '',
    resetEpoch: 0,
    paintedPlusFilled: 0,
  };
}

function inspectSnapshotsCandidate(
  parsed: unknown,
  base: BackupCandidateMetrics
): BackupCandidateMetrics {
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
      ? parseTimestampMs(s.metaUpdatedAt)
      : 0;
    const ts = Math.max(parseTimestampMs(s.lastOpened), parseTimestampMs(s.timestamp), metaTs);
    if (ts > maxTs) maxTs = ts;
    const epoch = nonNegFinite(s.resetEpoch);
    base.snapshotEpochs.set(sid, Math.max(base.snapshotEpochs.get(sid) ?? 0, epoch));
    const filledIdsCount = Array.isArray(s.filledRegionIds)
      ? s.filledRegionIds.filter((id) => typeof id === 'number' && Number.isFinite(id)).length
      : 0;
    totalFilled += Math.max(nonNegFinite(s.filledCount), filledIdsCount);
    const totalCountBonus =
      typeof s.totalCount === 'number' && Number.isFinite(s.totalCount) && s.totalCount > 0 ? 1 : 0;
    const paletteBonus = Array.isArray(s.customPalette) ? 1 : 0;
    const sourceBonus = s.sourceRef ? 1 : 0;
    const paintedBonus =
      s.paintedRegionColors &&
      typeof s.paintedRegionColors === 'object' &&
      !Array.isArray(s.paintedRegionColors)
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

function inspectCandidate(
  raw: string,
  kind: BackupDataKind,
  validator?: BackupCandidateValidator
): BackupCandidateMetrics {
  const base = createEmptyMetrics();
  const trimmed = raw.trim();
  if (trimmed.length === 0) return base;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return base;
  }

  if (kind === 'snapshots') {
    return inspectSnapshotsCandidate(parsed, base);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return base;
  }

  const rec = parsed as Record<string, unknown>;
  const keys = Object.keys(rec);
  const nonEmpty = keys.length > 0;
  const maxTs = extractObjectTimestamp(rec);

  if (kind === 'settings') {
    if (validator?.hasRecognizedSettingsField && !validator.hasRecognizedSettingsField(rec)) {
      return base;
    }
    const knownKeys = validator?.defaultSettingsKeys;
    const knownFieldCount = keys.filter(
      (k) =>
        ((knownKeys ? knownKeys.has(k) : true) || k === 'undoDefaultMigrated') &&
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

  if (validator?.isValidActiveStateRaw && !validator.isValidActiveStateRaw(trimmed)) {
    return base;
  }

  const snapshotId = typeof rec.activeSnapshotId === 'string' ? rec.activeSnapshotId.trim() : '';
  const hasSnapshotId = snapshotId.length > 0;
  const resetEpoch = nonNegFinite(rec.resetEpoch);
  const filledCount = Array.isArray(rec.filledRegionIds)
    ? rec.filledRegionIds.filter((id) => typeof id === 'number' && Number.isFinite(id)).length
    : 0;
  const paintedCount =
    rec.paintedRegionColors &&
    typeof rec.paintedRegionColors === 'object' &&
    !Array.isArray(rec.paintedRegionColors)
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

export function getMaxPersistedSnapshotTimestamp(storageKey: string, backupKey: string): number {
  let maxTs = 0;
  const candidates: Array<string | null | undefined> = [
    SafeLocalStore.getItem(storageKey),
    pendingBackupWrites.get(backupKey),
    pendingLocalHealWrites.get(storageKey),
    hasReadableNativeBackup() ? safeNativeLoadBackup(backupKey) : null,
  ];
  for (const raw of candidates) {
    if (!raw || raw.trim().length === 0) continue;
    const metrics = inspectCandidate(raw, 'snapshots');
    if (metrics.parseOk && metrics.maxTs > maxTs) {
      maxTs = metrics.maxTs;
    }
  }
  return maxTs;
}

function quarantineCorruptLocalPayload(storageKey: string, raw: string | null): void {
  if (!raw) return;
  SafeLocalStore.setItem(`${storageKey}__corrupt_quarantine`, raw);
  console.warn(`[StorageService] Quarantined corrupt local payload for ${storageKey}`);
}

function isValidNonEmptyPayload(
  raw: string,
  kind: BackupDataKind,
  validator?: BackupCandidateValidator
): boolean {
  const metrics = inspectCandidate(raw, kind, validator);
  return metrics.parseOk && metrics.nonEmpty;
}

function pickSnapshotsWinner(
  a: BackupCandidateMetrics,
  b: BackupCandidateMetrics,
  localRaw: string,
  backupRaw: string,
  preferBackupOnTie: boolean
): string {
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
  if (a.completeness !== b.completeness) {
    return a.completeness > b.completeness ? localRaw : backupRaw;
  }
  return preferBackupOnTie ? backupRaw : localRaw;
}

function pickActiveStateWinner(
  a: BackupCandidateMetrics,
  b: BackupCandidateMetrics,
  localRaw: string,
  backupRaw: string,
  preferBackupOnTie: boolean
): string {
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

function pickWinner(
  localRaw: string,
  backupRaw: string,
  kind: BackupDataKind,
  preferBackupOnTie: boolean,
  forceBackupWins: boolean = false,
  validator?: BackupCandidateValidator
): string {
  const a = inspectCandidate(localRaw, kind, validator);
  const b = inspectCandidate(backupRaw, kind, validator);

  if (a.parseOk !== b.parseOk) return a.parseOk ? localRaw : backupRaw;
  if (preferBackupOnTie && b.parseOk && (forceBackupWins || b.nonEmpty)) {
    return backupRaw;
  }
  if (a.nonEmpty !== b.nonEmpty) return a.nonEmpty ? localRaw : backupRaw;
  if (a.maxTs !== b.maxTs) return a.maxTs > b.maxTs ? localRaw : backupRaw;

  if (kind === 'snapshots') {
    return pickSnapshotsWinner(a, b, localRaw, backupRaw, preferBackupOnTie);
  }
  if (kind === 'settings') {
    if (a.knownFieldCount !== b.knownFieldCount) {
      return a.knownFieldCount > b.knownFieldCount ? localRaw : backupRaw;
    }
    if (a.fieldCount !== b.fieldCount) return a.fieldCount > b.fieldCount ? localRaw : backupRaw;
    return preferBackupOnTie ? backupRaw : localRaw;
  }
  return pickActiveStateWinner(a, b, localRaw, backupRaw, preferBackupOnTie);
}

function selectPreferredBackupRaw(
  pendingRaw: string | null,
  nativeRaw: string | null,
  kind: BackupDataKind,
  forceEmptyPending: boolean = false,
  validator?: BackupCandidateValidator
): string | null {
  const hasPending = Boolean(pendingRaw && pendingRaw.length > 0);
  const hasNative = Boolean(nativeRaw && nativeRaw.length > 0);
  if (hasPending && hasNative) {
    if (forceEmptyPending && kind === 'snapshots' && isEmptySnapshotsPayload(pendingRaw!)) {
      return pendingRaw!;
    }
    if (isValidNonEmptyPayload(pendingRaw!, kind, validator)) return pendingRaw!;
    if (isValidNonEmptyPayload(nativeRaw!, kind, validator)) return nativeRaw!;
    return pendingRaw!;
  }
  if (hasPending) return pendingRaw!;
  if (hasNative) return nativeRaw!;
  return null;
}

function isForcedEmptyActiveState(
  kind: BackupDataKind,
  storageKey: string,
  backupKey: string,
  pendingRaw: string | null
): boolean {
  if (kind !== 'activeState') return false;
  const isPendingEmpty = pendingRaw !== null && pendingRaw.trim().length === 0;
  if (pendingForcedBackupKeys.has(backupKey) && isPendingEmpty) return true;
  return quotaFailedDeleteKeys.has(storageKey) && (pendingRaw === null || isPendingEmpty);
}

function resolveWithoutBackup(
  storageKey: string,
  kind: BackupDataKind,
  localVal: string | null,
  localMetrics: BackupCandidateMetrics | null
): { raw: string | null; recoveredFromBackup: boolean } {
  if (kind === 'snapshots' && quotaFailedDeleteKeys.has(storageKey) && !hasReadableNativeBackup()) {
    safeLocalHeal(storageKey, '[]');
    return { raw: '[]', recoveredFromBackup: false };
  }
  if (!localVal || localVal.length === 0 || !localMetrics?.parseOk) {
    return { raw: null, recoveredFromBackup: false };
  }
  return { raw: localVal, recoveredFromBackup: false };
}

function resolveBackupWhenLocalMissing(
  storageKey: string,
  kind: BackupDataKind,
  backupVal: string,
  validator?: BackupCandidateValidator
): { raw: string | null; recoveredFromBackup: boolean } {
  const backupMetrics = inspectCandidate(backupVal, kind, validator);
  if (!backupMetrics.parseOk) {
    return { raw: null, recoveredFromBackup: false };
  }
  const shouldHealEmptySnapshots =
    kind === 'snapshots' &&
    isEmptySnapshotsPayload(backupVal) &&
    (quotaFailedLocalKeys.has(storageKey) || quotaFailedDeleteKeys.has(storageKey));
  if (isValidNonEmptyPayload(backupVal, kind, validator) || shouldHealEmptySnapshots) {
    safeLocalHeal(storageKey, backupVal);
  }
  return { raw: backupVal, recoveredFromBackup: backupMetrics.nonEmpty };
}

export function loadRawWithBackupFallbackWithMeta(
  storageKey: string,
  backupKey: string,
  kind: BackupDataKind,
  validator?: BackupCandidateValidator
): { raw: string | null; recoveredFromBackup: boolean } {
  const localVal = SafeLocalStore.getItem(storageKey);
  const pendingBackupVal = pendingBackupWrites.has(backupKey)
    ? (pendingBackupWrites.get(backupKey) ?? null)
    : null;
  const pendingHealVal = pendingLocalHealWrites.has(storageKey)
    ? (pendingLocalHealWrites.get(storageKey) ?? null)
    : null;
  const pendingRaw = pendingBackupVal ?? pendingHealVal;
  const nativeRaw = staleNativeBackupKeys.has(backupKey)
    ? null
    : safeNativeLoadBackup(backupKey);

  if (isForcedEmptyActiveState(kind, storageKey, backupKey, pendingRaw)) {
    if (quotaFailedDeleteKeys.has(storageKey)) {
      tryClearLocalStorageKey(storageKey);
    }
    return { raw: null, recoveredFromBackup: false };
  }

  const localMetrics =
    localVal && localVal.length > 0 ? inspectCandidate(localVal, kind, validator) : null;
  if (localVal && localVal.length > 0 && localMetrics && !localMetrics.parseOk) {
    quarantineCorruptLocalPayload(storageKey, localVal);
  }

  const forceEmptyPending =
    pendingForcedBackupKeys.has(backupKey) || quotaFailedDeleteKeys.has(storageKey);
  const backupVal = selectPreferredBackupRaw(
    pendingRaw,
    nativeRaw,
    kind,
    forceEmptyPending,
    validator
  );

  if (!backupVal) {
    return resolveWithoutBackup(storageKey, kind, localVal, localMetrics);
  }
  if (!localVal || localVal.length === 0 || !localMetrics?.parseOk) {
    return resolveBackupWhenLocalMissing(storageKey, kind, backupVal, validator);
  }
  if (localVal === backupVal) {
    quotaFailedLocalKeys.delete(storageKey);
    quotaFailedDeleteKeys.delete(storageKey);
    pendingLocalHealWrites.delete(storageKey);
    return { raw: localVal, recoveredFromBackup: false };
  }

  const preferBackupOnTie = quotaFailedLocalKeys.has(storageKey);
  const forceBackupWins =
    preferBackupOnTie &&
    (quotaFailedDeleteKeys.has(storageKey) || pendingForcedBackupKeys.has(backupKey));
  const selected = pickWinner(
    localVal,
    backupVal,
    kind,
    preferBackupOnTie,
    forceBackupWins,
    validator
  );
  if (selected !== localVal) {
    const shouldHeal =
      isValidNonEmptyPayload(selected, kind, validator) ||
      quotaFailedDeleteKeys.has(storageKey) ||
      (kind === 'snapshots' &&
        isEmptySnapshotsPayload(selected) &&
        quotaFailedLocalKeys.has(storageKey));
    if (shouldHeal) {
      safeLocalHeal(storageKey, selected);
    }
    return { raw: selected, recoveredFromBackup: true };
  }
  if (!quotaFailedDeleteKeys.has(storageKey) && pendingLocalHealWrites.has(storageKey)) {
    quotaFailedLocalKeys.delete(storageKey);
    pendingLocalHealWrites.delete(storageKey);
  }
  return { raw: selected, recoveredFromBackup: false };
}

export function loadRawWithBackupFallback(
  storageKey: string,
  backupKey: string,
  kind: BackupDataKind,
  validator?: BackupCandidateValidator
): string | null {
  return loadRawWithBackupFallbackWithMeta(storageKey, backupKey, kind, validator).raw;
}

export function writeLocalAndScheduleBackup(
  storageKey: string,
  backupKey: string,
  serialized: string,
  immediateBackup: boolean = false,
  skipBackup: boolean = false,
  clearLocalOnFailure: boolean = false
): void {
  const isEmptyPayload =
    (isSnapshotsBackupKey(backupKey) && isEmptySnapshotsPayload(serialized)) ||
    (matchesScopedKey(backupKey, ACTIVE_STATE_KEY) && serialized.trim().length === 0);
  try {
    if (SafeLocalStore.hasLocalStorage()) {
      SafeLocalStore.setItem(storageKey, serialized, { rethrow: true });
      if (!skipBackup) {
        quotaFailedLocalKeys.delete(storageKey);
        quotaFailedDeleteKeys.delete(storageKey);
        pendingLocalHealWrites.delete(storageKey);
      }
    }
  } catch (err) {
    if (!skipBackup) {
      quotaFailedLocalKeys.add(storageKey);
      if (clearLocalOnFailure) {
        quotaFailedDeleteKeys.add(storageKey);
      } else if (!matchesScopedKey(storageKey, SNAPSHOTS_KEY)) {
        quotaFailedDeleteKeys.delete(storageKey);
      }
      let deletedLocal = false;
      if (clearLocalOnFailure && SafeLocalStore.removeItem(storageKey)) {
        quotaFailedDeleteKeys.delete(storageKey);
        deletedLocal = true;
      }
      if (isEmptyPayload && deletedLocal) {
        quotaFailedLocalKeys.delete(storageKey);
        pendingLocalHealWrites.delete(storageKey);
      } else {
        pendingLocalHealWrites.set(storageKey, serialized);
      }
    }
    if (isQuotaError(err)) {
      notifyQuotaWarning(storageKey);
    }
  }
  if (skipBackup) {
    return;
  }
  try {
    scheduleBackupWrite(backupKey, serialized, immediateBackup, storageKey);
  } catch (err) {
    reportSwallowed('BackupEngine.writeLocalAndScheduleBackup', err, { backupKey });
  }
}

export function clearWithBackup(storageKey: string, backupKey: string): void {
  pendingBackupWrites.delete(backupKey);
  pendingBackupStorageKeys.delete(backupKey);
  pendingForcedBackupKeys.delete(backupKey);
  pendingLocalHealWrites.delete(storageKey);
  try {
    if (SafeLocalStore.hasLocalStorage()) {
      SafeLocalStore.removeItem(storageKey, { rethrow: true });
      quotaFailedLocalKeys.delete(storageKey);
      quotaFailedDeleteKeys.delete(storageKey);
    }
  } catch (err) {
    quotaFailedLocalKeys.add(storageKey);
    quotaFailedDeleteKeys.add(storageKey);
    pendingLocalHealWrites.delete(storageKey);
    reportSwallowed('BackupEngine.clearWithBackupRemove', err, { storageKey });
  }
  try {
    scheduleBackupWrite(backupKey, '', true, storageKey);
  } catch (err) {
    reportSwallowed('BackupEngine.clearWithBackupSchedule', err, { backupKey });
  }
}
