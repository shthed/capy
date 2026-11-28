import { PaletteColor, PuzzleData, SavedSnapshot } from '../../types';
import { estimateCompactPuzzleBytes } from '../CapyCodec';
import { computeSlotKeyForSnapshot, recordLocalSlotTombstone } from '../cloud/slotKey';
import { reportSwallowed } from '../telemetry';
import { clearActiveState, loadActiveState } from './ActiveSessionStorage';
import {
  getMaxPersistedSnapshotTimestamp,
  hasReadableNativeBackup,
  loadRawWithBackupFallback,
  parseTimestampMs,
  writeLocalAndScheduleBackup,
} from './BackupEngine';
import {
  clearAllStores,
  deleteSnapshotEntries,
  getCachedPreview,
  loadPreviewDataUrl,
  savePreviewDataUrl,
  setCachedPreview,
} from './IndexedDbStore';
import { resolveScopedBackupKey, resolveScopedStorageKey, SNAPSHOTS_KEY } from './StorageKeys';

export async function hydrateSnapshotPreviews(
  snapshots: SavedSnapshot[]
): Promise<SavedSnapshot[]> {
  if (snapshots.length === 0) return snapshots;
  return Promise.all(
    snapshots.map(async (snap) => {
      if (typeof snap.previewDataUrl === 'string' && snap.previewDataUrl.length > 0) {
        setCachedPreview(snap.id, snap.previewDataUrl);
        return snap;
      }
      const preview = await loadPreviewDataUrl(snap.id);
      return preview ? { ...snap, previewDataUrl: preview } : snap;
    })
  );
}

export function normalizeSnapshotTitle(title: string): string {
  const cleaned = title.replace(/\s*\(Max Detail \(Auto\)\)\s*$/i, '').trim();
  return cleaned || title;
}

export function stripInternalSnapshotMeta(snapshot: SavedSnapshot): SavedSnapshot {
  const normalizedTitle = normalizeSnapshotTitle(snapshot.title);
  const hasMeta = Object.prototype.hasOwnProperty.call(snapshot, 'metaUpdatedAt');
  if (!hasMeta && normalizedTitle === snapshot.title) {
    return snapshot;
  }
  const copy = { ...snapshot, title: normalizedTitle } as SavedSnapshot & {
    metaUpdatedAt?: unknown;
  };
  delete copy.metaUpdatedAt;
  return copy;
}

export function getMaxSnapshotListTs(
  snapshots: SavedSnapshot[],
  metaTsById: Map<string, number>
): number {
  let maxSeen = 0;
  for (const s of snapshots) {
    const candidate = Math.max(
      parseTimestampMs(s.lastOpened),
      parseTimestampMs(s.timestamp),
      metaTsById.get(s.id) ?? 0
    );
    if (candidate > maxSeen) {
      maxSeen = candidate;
    }
  }
  return maxSeen;
}

export function computeNextSnapshotMetaTs(
  snapshots: SavedSnapshot[],
  metaTsById: Map<string, number>,
  floorTs: number = 0
): number {
  const maxSeen = Math.max(floorTs, getMaxSnapshotListTs(snapshots, metaTsById));
  return Math.max(maxSeen + 1, Date.now());
}

function stripInlinePreviews(
  snapshots: SavedSnapshot[],
  metaTsById?: Map<string, number>
): SavedSnapshot[] {
  return snapshots.map((s) => {
    if (typeof s.previewDataUrl === 'string' && s.previewDataUrl.length > 0) {
      setCachedPreview(s.id, s.previewDataUrl);
      void savePreviewDataUrl(s.id, s.previewDataUrl);
    }
    const rawMetaTs = metaTsById?.get(s.id);
    const metaTs =
      typeof rawMetaTs === 'number' && Number.isFinite(rawMetaTs) && rawMetaTs > 0 ? rawMetaTs : 0;
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

function normalizeLoadedSnapshot(
  s: SavedSnapshot,
  metaTsById: Map<string, number>
): { snapshot: SavedSnapshot; hadInlinePreview: boolean } {
  const rawRec = s as unknown as Record<string, unknown>;
  const metaTs = Object.prototype.hasOwnProperty.call(rawRec, 'metaUpdatedAt')
    ? parseTimestampMs(rawRec.metaUpdatedAt)
    : 0;
  if (metaTs > 0) {
    metaTsById.set(s.id, Math.max(metaTsById.get(s.id) ?? 0, metaTs));
  }
  const inlinePreview =
    typeof s.previewDataUrl === 'string' && s.previewDataUrl.length > 0
      ? s.previewDataUrl
      : undefined;
  let hadInlinePreview = false;
  if (inlinePreview) {
    hadInlinePreview = true;
    setCachedPreview(s.id, inlinePreview);
    void savePreviewDataUrl(s.id, inlinePreview);
  }
  const cachedPreview = inlinePreview || getCachedPreview(s.id);
  const base: SavedSnapshot = {
    ...s,
    title: normalizeSnapshotTitle(s.title),
    filledRegionIds: Array.isArray(s.filledRegionIds)
      ? s.filledRegionIds.filter((id) => typeof id === 'number' && Number.isFinite(id))
      : [],
    filledCount:
      typeof s.filledCount === 'number' && Number.isFinite(s.filledCount)
        ? Math.max(0, s.filledCount)
        : 0,
    totalCount:
      typeof s.totalCount === 'number' && Number.isFinite(s.totalCount)
        ? Math.max(0, s.totalCount)
        : 0,
    timestamp:
      typeof s.timestamp === 'number' && Number.isFinite(s.timestamp)
        ? Math.max(0, s.timestamp)
        : 0,
    lastOpened:
      typeof s.lastOpened === 'number' && Number.isFinite(s.lastOpened)
        ? Math.max(0, s.lastOpened)
        : 0,
  };
  delete (base as unknown as Record<string, unknown>).metaUpdatedAt;
  if (cachedPreview) {
    base.previewDataUrl = cachedPreview;
  } else {
    delete base.previewDataUrl;
  }
  return { snapshot: base, hadInlinePreview };
}

export function loadSnapshotsWithMeta(): {
  snapshots: SavedSnapshot[];
  metaTsById: Map<string, number>;
} {
  const metaTsById = new Map<string, number>();
  try {
    const storageKey = resolveScopedStorageKey(SNAPSHOTS_KEY);
    const backupKey = resolveScopedBackupKey(SNAPSHOTS_KEY);
    const raw = loadRawWithBackupFallback(storageKey, backupKey, 'snapshots');
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
      const res = normalizeLoadedSnapshot(s, metaTsById);
      if (res.hadInlinePreview) hadLegacyInlinePreview = true;
      return res.snapshot;
    });
    if (hadLegacyInlinePreview) {
      const stripped = stripInlinePreviews(normalized, metaTsById);
      writeLocalAndScheduleBackup(storageKey, backupKey, JSON.stringify(stripped), false);
    }
    return { snapshots: normalized, metaTsById };
  } catch (err) {
    reportSwallowed('SnapshotStorage.loadSnapshotsWithMeta', err);
    return { snapshots: [], metaTsById };
  }
}

export function loadSnapshots(): SavedSnapshot[] {
  return loadSnapshotsWithMeta().snapshots;
}

export function saveSnapshotsInternal(
  snapshots: SavedSnapshot[],
  options?: {
    allowEmptyBackup?: boolean;
    immediateBackup?: boolean;
    clearLocalOnFailure?: boolean;
    metaTsById?: Map<string, number>;
  }
): void {
  try {
    const stripped = stripInlinePreviews(snapshots, options?.metaTsById);
    const serialized = JSON.stringify(stripped);
    const allowEmptyBackup = Boolean(options?.allowEmptyBackup);
    const isEmpty = stripped.length === 0;
    const skipBackup = isEmpty && !allowEmptyBackup;
    const immediateBackup =
      (isEmpty && allowEmptyBackup) || (Boolean(options?.immediateBackup) && !skipBackup);
    const clearLocalOnFailure =
      Boolean(options?.clearLocalOnFailure) && !skipBackup && (isEmpty || hasReadableNativeBackup());
    writeLocalAndScheduleBackup(
      resolveScopedStorageKey(SNAPSHOTS_KEY),
      resolveScopedBackupKey(SNAPSHOTS_KEY),
      serialized,
      immediateBackup,
      skipBackup,
      clearLocalOnFailure
    );
  } catch (err) {
    reportSwallowed('SnapshotStorage.saveSnapshotsInternal', err);
  }
}

export function saveSnapshots(
  snapshots: SavedSnapshot[],
  optionsOrImmediate?:
    | boolean
    | { allowEmptyBackup?: boolean; immediateBackup?: boolean; clearLocalOnFailure?: boolean }
): void {
  const options =
    typeof optionsOrImmediate === 'boolean'
      ? { immediateBackup: optionsOrImmediate }
      : optionsOrImmediate;
  saveSnapshotsInternal(snapshots, options);
}

export function addSnapshot(snapshot: SavedSnapshot): SavedSnapshot[] {
  const cleanSnapshot = stripInternalSnapshotMeta(snapshot);
  const storageKey = resolveScopedStorageKey(SNAPSHOTS_KEY);
  const backupKey = resolveScopedBackupKey(SNAPSHOTS_KEY);
  const { snapshots: list, metaTsById } = loadSnapshotsWithMeta();
  const persistedMaxTs = getMaxPersistedSnapshotTimestamp(storageKey, backupKey);
  const prevListMaxTs = Math.max(getMaxSnapshotListTs(list, metaTsById), persistedMaxTs);
  const existingIndex = list.findIndex((s) => s.id === cleanSnapshot.id);
  const incomingTs = Math.max(
    parseTimestampMs(cleanSnapshot.lastOpened),
    parseTimestampMs(cleanSnapshot.timestamp)
  );
  let updated: SavedSnapshot[];
  if (existingIndex >= 0) {
    const existingItem = list[existingIndex];
    const prevItemTs = Math.max(
      parseTimestampMs(existingItem.lastOpened),
      parseTimestampMs(existingItem.timestamp),
      metaTsById.get(cleanSnapshot.id) ?? 0
    );
    const effectiveFloor = Math.max(prevItemTs, prevListMaxTs);
    if (incomingTs <= effectiveFloor) {
      metaTsById.set(
        cleanSnapshot.id,
        Math.max(computeNextSnapshotMetaTs(list, metaTsById, effectiveFloor), incomingTs + 1)
      );
    }
    updated = [...list];
    updated[existingIndex] = cleanSnapshot;
  } else {
    if ((list.length > 0 || persistedMaxTs > 0) && incomingTs <= prevListMaxTs) {
      metaTsById.set(
        cleanSnapshot.id,
        Math.max(computeNextSnapshotMetaTs(list, metaTsById, prevListMaxTs), incomingTs + 1)
      );
    }
    updated = [cleanSnapshot, ...list];
  }
  saveSnapshotsInternal(updated, { metaTsById });
  return updated;
}

export function estimatePuzzleSaveBytes(puzzle: PuzzleData, previewDataUrl?: string): number {
  return estimateCompactPuzzleBytes(puzzle, previewDataUrl);
}

export function updateSnapshotProgress(
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
  const { snapshots: list, metaTsById } = loadSnapshotsWithMeta();
  const prevListMaxTs = getMaxSnapshotListTs(list, metaTsById);
  const now = Date.now();
  let matched = false;
  let prevItemTs = 0;
  const updated = list.map((item) => {
    if (item.id === id) {
      matched = true;
      prevItemTs = Math.max(
        parseTimestampMs(item.lastOpened),
        parseTimestampMs(item.timestamp),
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
    const persistedMaxTs = getMaxPersistedSnapshotTimestamp(storageKey, backupKey);
    const effectivePrevMaxTs = Math.max(prevListMaxTs, persistedMaxTs);
    if (now <= prevItemTs || now <= effectivePrevMaxTs) {
      metaTsById.set(
        id,
        Math.max(
          computeNextSnapshotMetaTs(list, metaTsById, effectivePrevMaxTs),
          effectivePrevMaxTs + 1
        )
      );
    }
    saveSnapshotsInternal(updated, { metaTsById });
  }
  return updated;
}

export function updateSnapshotViewport(
  id: string,
  zoomScale: number,
  panOffsetX: number,
  panOffsetY: number
): SavedSnapshot[] {
  const { snapshots: list, metaTsById } = loadSnapshotsWithMeta();
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
    const persistedMaxTs = getMaxPersistedSnapshotTimestamp(
      resolveScopedStorageKey(SNAPSHOTS_KEY),
      resolveScopedBackupKey(SNAPSHOTS_KEY)
    );
    metaTsById.set(id, computeNextSnapshotMetaTs(list, metaTsById, persistedMaxTs));
    saveSnapshotsInternal(updated, { metaTsById });
  }
  return updated;
}

export function renameSnapshot(id: string, newTitle: string): SavedSnapshot[] {
  const { snapshots: list, metaTsById } = loadSnapshotsWithMeta();
  let matched = false;
  const updated = list.map((s) => {
    if (s.id === id) {
      matched = true;
      return { ...s, title: newTitle };
    }
    return s;
  });
  if (matched) {
    const persistedMaxTs = getMaxPersistedSnapshotTimestamp(
      resolveScopedStorageKey(SNAPSHOTS_KEY),
      resolveScopedBackupKey(SNAPSHOTS_KEY)
    );
    metaTsById.set(id, computeNextSnapshotMetaTs(list, metaTsById, persistedMaxTs));
    saveSnapshotsInternal(updated, { metaTsById });
  }
  return updated;
}

export function togglePinSnapshot(id: string): SavedSnapshot[] {
  const { snapshots: list, metaTsById } = loadSnapshotsWithMeta();
  let matched = false;
  const updated = list.map((s) => {
    if (s.id === id) {
      matched = true;
      return { ...s, isPinned: !s.isPinned };
    }
    return s;
  });
  if (matched) {
    const persistedMaxTs = getMaxPersistedSnapshotTimestamp(
      resolveScopedStorageKey(SNAPSHOTS_KEY),
      resolveScopedBackupKey(SNAPSHOTS_KEY)
    );
    metaTsById.set(id, computeNextSnapshotMetaTs(list, metaTsById, persistedMaxTs));
    saveSnapshotsInternal(updated, { metaTsById });
  }
  return updated;
}

export interface DeleteSnapshotOptions {
  skipTombstone?: boolean;
  tombstoneAt?: number;
}

export async function deleteSnapshot(
  id: string,
  options?: DeleteSnapshotOptions
): Promise<SavedSnapshot[]> {
  const { snapshots: list, metaTsById } = loadSnapshotsWithMeta();
  const target = list.find((s) => s.id === id);
  const updated = list.filter((s) => s.id !== id);
  if (target && !options?.skipTombstone) {
    const baseDeletedAt =
      typeof options?.tombstoneAt === 'number' &&
      Number.isFinite(options.tombstoneAt) &&
      options.tombstoneAt > 0
        ? options.tombstoneAt
        : Date.now();
    const targetLastOpened =
      typeof target.lastOpened === 'number' &&
      Number.isFinite(target.lastOpened) &&
      target.lastOpened > 0
        ? target.lastOpened
        : 0;
    const targetTimestamp =
      typeof target.timestamp === 'number' &&
      Number.isFinite(target.timestamp) &&
      target.timestamp > 0
        ? target.timestamp
        : 0;
    const deletedAt = Math.max(baseDeletedAt, targetLastOpened, targetTimestamp);
    recordLocalSlotTombstone(computeSlotKeyForSnapshot(target), deletedAt);
  }
  if (updated.length < list.length) {
    if (updated.length > 0) {
      const storageKey = resolveScopedStorageKey(SNAPSHOTS_KEY);
      const backupKey = resolveScopedBackupKey(SNAPSHOTS_KEY);
      const persistedMaxTs = getMaxPersistedSnapshotTimestamp(storageKey, backupKey);
      const prevListMaxTs = Math.max(getMaxSnapshotListTs(list, metaTsById), persistedMaxTs);
      const nextMetaTs = computeNextSnapshotMetaTs(list, metaTsById, prevListMaxTs);
      metaTsById.delete(id);
      metaTsById.set(updated[0].id, nextMetaTs);
    }
    saveSnapshotsInternal(updated, {
      immediateBackup: true,
      allowEmptyBackup: updated.length === 0,
      clearLocalOnFailure: true,
      metaTsById: updated.length > 0 ? metaTsById : undefined,
    });
  }
  const active = loadActiveState();
  if (active?.activeSnapshotId === id) {
    clearActiveState();
  }
  await deleteSnapshotEntries(id);
  return updated;
}

export async function clearAllSnapshots(timeoutMs?: number): Promise<void> {
  saveSnapshots([], {
    allowEmptyBackup: true,
    immediateBackup: true,
    clearLocalOnFailure: true,
  });
  clearActiveState();
  await clearAllStores(undefined, timeoutMs);
}
