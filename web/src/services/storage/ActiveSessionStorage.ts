import { reportSwallowed } from '../telemetry';
import {
  BackupCandidateValidator,
  clearWithBackup,
  getMaxPersistedObjectTimestamp,
  loadRawWithBackupFallback,
  writeLocalAndScheduleBackup,
} from './BackupEngine';
import { ACTIVE_STATE_KEY, resolveScopedBackupKey, resolveScopedStorageKey } from './StorageKeys';

export interface ActiveSessionState {
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
}

const FINITE_NUMBER_KEYS = [
  'activeColorId',
  'zoomScale',
  'panOffsetX',
  'panOffsetY',
  'updatedAt',
  'savedAt',
] as const;

function validateActiveStateRecord(rec: Record<string, unknown>): boolean {
  const hasOwn = (key: string) => Object.prototype.hasOwnProperty.call(rec, key);
  let recognizedCount = 0;

  if (hasOwn('activeSnapshotId')) {
    if (rec.activeSnapshotId !== null && typeof rec.activeSnapshotId !== 'string') return false;
    recognizedCount++;
  }
  if (hasOwn('filledRegionIds')) {
    if (!Array.isArray(rec.filledRegionIds)) return false;
    recognizedCount++;
  }
  for (const key of FINITE_NUMBER_KEYS) {
    if (hasOwn(key)) {
      if (typeof rec[key] !== 'number' || !Number.isFinite(rec[key])) return false;
      recognizedCount++;
    }
  }
  if (hasOwn('resetEpoch')) {
    if (typeof rec.resetEpoch !== 'number' || !Number.isFinite(rec.resetEpoch) || rec.resetEpoch < 0) {
      return false;
    }
    recognizedCount++;
  }
  if (hasOwn('isFreeColorMode')) {
    if (typeof rec.isFreeColorMode !== 'boolean') return false;
    recognizedCount++;
  }
  if (hasOwn('paintedRegionColors')) {
    if (
      !rec.paintedRegionColors ||
      typeof rec.paintedRegionColors !== 'object' ||
      Array.isArray(rec.paintedRegionColors)
    ) {
      return false;
    }
    recognizedCount++;
  }
  return recognizedCount > 0;
}

function sanitizePaintedRegionColors(raw: unknown): Record<number, number> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const cleanColors: Record<number, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (/^\d+$/.test(k) && typeof v === 'number' && Number.isFinite(v)) {
      cleanColors[Number(k)] = v;
    }
  }
  return cleanColors;
}

function pickFiniteOrDefault(val: unknown, fallback: number): number {
  return typeof val === 'number' && Number.isFinite(val) ? val : fallback;
}

function normalizeActiveStateRecord(rec: Record<string, unknown>): ActiveSessionState {
  const paintedRegionColors = Object.prototype.hasOwnProperty.call(rec, 'paintedRegionColors')
    ? sanitizePaintedRegionColors(rec.paintedRegionColors)
    : undefined;
  const zoomScale =
    typeof rec.zoomScale === 'number' && Number.isFinite(rec.zoomScale) && rec.zoomScale > 0
      ? rec.zoomScale
      : 1;
  return {
    activeSnapshotId: typeof rec.activeSnapshotId === 'string' ? rec.activeSnapshotId : null,
    activeColorId: pickFiniteOrDefault(rec.activeColorId, 1),
    filledRegionIds: Array.isArray(rec.filledRegionIds)
      ? rec.filledRegionIds.filter(
          (id: unknown): id is number => typeof id === 'number' && Number.isFinite(id)
        )
      : [],
    ...(paintedRegionColors !== undefined ? { paintedRegionColors } : {}),
    ...(typeof rec.isFreeColorMode === 'boolean' ? { isFreeColorMode: rec.isFreeColorMode } : {}),
    ...(typeof rec.resetEpoch === 'number' && Number.isFinite(rec.resetEpoch) && rec.resetEpoch >= 0
      ? { resetEpoch: rec.resetEpoch }
      : {}),
    zoomScale,
    panOffsetX: pickFiniteOrDefault(rec.panOffsetX, 0),
    panOffsetY: pickFiniteOrDefault(rec.panOffsetY, 0),
    ...(typeof rec.updatedAt === 'number' && Number.isFinite(rec.updatedAt)
      ? { updatedAt: rec.updatedAt }
      : {}),
  };
}

export function tryParseActiveState(raw: string | null): {
  status: 'empty' | 'ok' | 'corrupt';
  state: ActiveSessionState | null;
} {
  if (!raw) return { status: 'empty', state: null };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { status: 'corrupt', state: null };
    }
    const rec = parsed as Record<string, unknown>;
    if (!validateActiveStateRecord(rec)) {
      return { status: 'corrupt', state: null };
    }
    return { status: 'ok', state: normalizeActiveStateRecord(rec) };
  } catch {
    return { status: 'corrupt', state: null };
  }
}

const ACTIVE_STATE_VALIDATOR: BackupCandidateValidator = {
  isValidActiveStateRaw: (trimmedRaw: string) => tryParseActiveState(trimmedRaw).status === 'ok',
};

export function loadActiveState(): ActiveSessionState | null {
  try {
    const raw = loadRawWithBackupFallback(
      resolveScopedStorageKey(ACTIVE_STATE_KEY),
      resolveScopedBackupKey(ACTIVE_STATE_KEY),
      'activeState',
      ACTIVE_STATE_VALIDATOR
    );
    if (!raw) return null;
    const parsedRes = tryParseActiveState(raw);
    if (parsedRes.status !== 'ok' || !parsedRes.state) return null;
    return parsedRes.state;
  } catch (err) {
    reportSwallowed('ActiveSessionStorage.loadActiveState', err);
    return null;
  }
}

export function saveActiveState(state: ActiveSessionState): void {
  try {
    const storageKey = resolveScopedStorageKey(ACTIVE_STATE_KEY);
    const backupKey = resolveScopedBackupKey(ACTIVE_STATE_KEY);
    const existing =
      state.resetEpoch === undefined && state.activeSnapshotId ? loadActiveState() : null;
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
    const prevSavedAt = getMaxPersistedObjectTimestamp(storageKey, backupKey);
    const savedAt = prevSavedAt >= now ? prevSavedAt + 1 : now;
    const payload = { ...basePayload, savedAt };
    const serialized = JSON.stringify(payload);
    writeLocalAndScheduleBackup(storageKey, backupKey, serialized);
  } catch (err) {
    reportSwallowed('ActiveSessionStorage.saveActiveState', err);
  }
}

export function clearActiveState(): void {
  clearWithBackup(
    resolveScopedStorageKey(ACTIVE_STATE_KEY),
    resolveScopedBackupKey(ACTIVE_STATE_KEY)
  );
}
