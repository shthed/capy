import { InfiniteZoomNodeMeta, PaletteColor, PuzzleData, SavedSnapshot } from '../../types';
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
  collectReferencedLayerImageKeysStrict,
  deleteSnapshotEntries,
  getCachedPreview,
  loadPreviewDataUrl,
  previewStoreKey,
  savePreviewDataUrl,
  setCachedPreview,
} from './IndexedDbStore';
import {
  isLayerImageKey,
  isPreviewImageKey,
  resolveScopedBackupKey,
  resolveScopedStorageKey,
  SNAPSHOTS_KEY,
} from './StorageKeys';

const MAX_ZOOM_TREE_CHILDREN = 64;
const REQUIRED_SNAPSHOT_KEYS = new Set<string>([
  'id',
  'title',
  'timestamp',
  'lastOpened',
  'filledCount',
  'totalCount',
  'filledRegionIds',
  'zoomScale',
  'panOffsetX',
  'panOffsetY',
]);
const FORBIDDEN_PATCH_KEYS = new Set<string>([
  'id',
  'metaUpdatedAt',
  '__proto__',
  'constructor',
  'prototype',
]);

function mergeZoomTreePatch(
  base: InfiniteZoomNodeMeta | undefined,
  patch: Partial<InfiniteZoomNodeMeta> | undefined,
  defaults: { depth: number; direction: InfiniteZoomNodeMeta['direction'] }
): InfiniteZoomNodeMeta {
  const merged: InfiniteZoomNodeMeta = {
    ...base,
    depth: base?.depth ?? defaults.depth,
    direction: base?.direction ?? defaults.direction,
  };
  if (patch) {
    for (const key of Object.keys(patch) as Array<keyof InfiniteZoomNodeMeta>) {
      if (FORBIDDEN_PATCH_KEYS.has(key as string)) continue;
      const val = patch[key];
      if (val !== undefined) {
        (merged as unknown as Record<string, unknown>)[key] = val;
      }
    }
  }
  return merged;
}

function combineChildSnapshotIds(
  existing: string[] | undefined,
  patched: string[] | undefined,
  parentId: string,
  childId: string
): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const addId = (cid: unknown) => {
    if (typeof cid !== 'string') return;
    const trimmed = cid.trim();
    if (!trimmed || trimmed === parentId || seen.has(trimmed)) return;
    seen.add(trimmed);
    ordered.push(trimmed);
  };
  if (Array.isArray(existing)) {
    for (const cid of existing) addId(cid);
  }
  if (Array.isArray(patched)) {
    for (const cid of patched) addId(cid);
  }
  addId(childId);
  if (ordered.length <= MAX_ZOOM_TREE_CHILDREN) {
    return ordered;
  }
  const tail = ordered.slice(-MAX_ZOOM_TREE_CHILDREN);
  if (!tail.includes(childId)) {
    return [...tail.slice(-(MAX_ZOOM_TREE_CHILDREN - 1)), childId];
  }
  return tail;
}

function pruneDeletedZoomTreeLinks(
  snapshots: SavedSnapshot[],
  deletedId: string
): { prunedUpdated: SavedSnapshot[]; prunedIds: string[] } {
  const prunedIds: string[] = [];
  const prunedUpdated = snapshots.map((s) => {
    const clearParent = s.parentSnapshotId === deletedId;
    const hasChildRef =
      Array.isArray(s.zoomTree?.childSnapshotIds) &&
      s.zoomTree.childSnapshotIds.includes(deletedId);
    if (!clearParent && !hasChildRef) {
      return s;
    }
    prunedIds.push(s.id);
    const next: SavedSnapshot = { ...s };
    if (clearParent) {
      delete next.parentSnapshotId;
    }
    if (hasChildRef && next.zoomTree) {
      next.zoomTree = {
        ...next.zoomTree,
        childSnapshotIds: next.zoomTree.childSnapshotIds!.filter((cid) => cid !== deletedId),
      };
    }
    return next;
  });
  return { prunedUpdated, prunedIds };
}

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

export function linkZoomTreeSnapshots(
  parentId: string,
  childId: string,
  parentPatch?: Partial<InfiniteZoomNodeMeta>,
  childPatch?: Partial<InfiniteZoomNodeMeta>
): SavedSnapshot[] {
  if (!parentId || !childId || parentId === childId) {
    return loadSnapshots();
  }
  const { snapshots: list, metaTsById } = loadSnapshotsWithMeta();
  const parentSnap = list.find((s) => s.id === parentId);
  const childSnap = list.find((s) => s.id === childId);
  if (!parentSnap || !childSnap) {
    return list;
  }

  const nextChildIds = combineChildSnapshotIds(
    parentSnap.zoomTree?.childSnapshotIds,
    parentPatch?.childSnapshotIds,
    parentId,
    childId
  );
  const nextParentZoomTree: InfiniteZoomNodeMeta = {
    ...mergeZoomTreePatch(parentSnap.zoomTree, parentPatch, { depth: 0, direction: 'in-place' }),
    childSnapshotIds: nextChildIds,
  };
  const nextChildZoomTree = mergeZoomTreePatch(childSnap.zoomTree, childPatch, {
    depth: nextParentZoomTree.depth + 1,
    direction: 'child-in',
  });

  const updated = list.map((s) => {
    if (s.id === parentId) {
      return { ...s, zoomTree: nextParentZoomTree };
    }
    if (s.id === childId) {
      return { ...s, parentSnapshotId: parentId, zoomTree: nextChildZoomTree };
    }
    return s;
  });

  const persistedMaxTs = getMaxPersistedSnapshotTimestamp(
    resolveScopedStorageKey(SNAPSHOTS_KEY),
    resolveScopedBackupKey(SNAPSHOTS_KEY)
  );
  const nextMetaTs = computeNextSnapshotMetaTs(list, metaTsById, persistedMaxTs);
  metaTsById.set(parentId, nextMetaTs);
  metaTsById.set(childId, nextMetaTs);
  saveSnapshotsInternal(updated, { metaTsById });
  return updated;
}

export function updateSnapshotMetadata(
  id: string,
  patch: Partial<SavedSnapshot>
): SavedSnapshot[] {
  if (!id) {
    return loadSnapshots();
  }
  const { snapshots: list, metaTsById } = loadSnapshotsWithMeta();
  let matched = false;
  const updated = list.map((s) => {
    if (s.id !== id) return s;
    matched = true;
    const next: Record<string, unknown> = { ...s };
    for (const key of Object.keys(patch)) {
      if (FORBIDDEN_PATCH_KEYS.has(key)) continue;
      const val = (patch as Record<string, unknown>)[key];
      if (val === undefined) {
        if (REQUIRED_SNAPSHOT_KEYS.has(key)) continue;
        delete next[key];
      } else {
        next[key] = val;
      }
    }
    return stripInternalSnapshotMeta(next as unknown as SavedSnapshot);
  });
  if (!matched) {
    return list;
  }
  const persistedMaxTs = getMaxPersistedSnapshotTimestamp(
    resolveScopedStorageKey(SNAPSHOTS_KEY),
    resolveScopedBackupKey(SNAPSHOTS_KEY)
  );
  metaTsById.set(id, computeNextSnapshotMetaTs(list, metaTsById, persistedMaxTs));
  saveSnapshotsInternal(updated, { metaTsById });
  return updated;
}

export interface DeleteSnapshotOptions {
  skipTombstone?: boolean;
  tombstoneAt?: number;
}

async function resolveDeleteImageProtection(
  id: string,
  survivingSnapshots: SavedSnapshot[]
): Promise<{
  layerImageKeys: string[];
  preserveRootImageKey: boolean;
  preservePreviewKey: boolean;
}> {
  const previewKey = previewStoreKey(id);
  const liveSnapshotIds = new Set<string>();
  const livePreviewKeys = new Set<string>();
  const liveBlobUris = new Set<string>();
  for (const snap of survivingSnapshots) {
    liveSnapshotIds.add(snap.id);
    livePreviewKeys.add(previewStoreKey(snap.id));
    if (snap.sourceRef?.kind === 'blob' && typeof snap.sourceRef.uri === 'string') {
      const trimmedUri = snap.sourceRef.uri.trim();
      if (trimmedUri.length > 0) {
        liveBlobUris.add(trimmedUri);
      }
    }
  }

  const targetRead = await collectReferencedLayerImageKeysStrict([id]);
  const targetKeys = targetRead.ok ? (targetRead.targetKeys.get(id) ?? []) : [];
  const survivingRead = await collectReferencedLayerImageKeysStrict(
    survivingSnapshots.map((snap) => snap.id)
  );

  if (survivingRead.ok) {
    const survivingProtectedKeys = new Set<string>([
      ...liveSnapshotIds,
      ...livePreviewKeys,
      ...liveBlobUris,
      ...survivingRead.keys,
    ]);
    return {
      preserveRootImageKey: survivingProtectedKeys.has(id),
      preservePreviewKey: survivingProtectedKeys.has(previewKey),
      layerImageKeys: Array.from(
        new Set(
          targetKeys.filter((key) => isLayerImageKey(key) && !survivingProtectedKeys.has(key))
        )
      ),
    };
  }

  return {
    preserveRootImageKey:
      liveSnapshotIds.has(id) ||
      livePreviewKeys.has(id) ||
      liveBlobUris.has(id) ||
      isLayerImageKey(id) ||
      isPreviewImageKey(id),
    preservePreviewKey:
      liveSnapshotIds.has(previewKey) ||
      livePreviewKeys.has(previewKey) ||
      liveBlobUris.has(previewKey),
    layerImageKeys: [],
  };
}

export async function deleteSnapshot(
  id: string,
  options?: DeleteSnapshotOptions
): Promise<SavedSnapshot[]> {
  const { snapshots: list, metaTsById } = loadSnapshotsWithMeta();
  const target = list.find((s) => s.id === id);
  const updated = list.filter((s) => s.id !== id);
  if (target && !options?.skipTombstone) {
    const deletedAt =
      typeof options?.tombstoneAt === 'number' &&
      Number.isFinite(options.tombstoneAt) &&
      options.tombstoneAt > 0
        ? options.tombstoneAt
        : Date.now();
    recordLocalSlotTombstone(computeSlotKeyForSnapshot(target), deletedAt);
  }
  let resultList = updated;
  if (updated.length < list.length) {
    const { prunedUpdated, prunedIds } = pruneDeletedZoomTreeLinks(updated, id);
    resultList = prunedUpdated;
    if (prunedUpdated.length > 0) {
      const storageKey = resolveScopedStorageKey(SNAPSHOTS_KEY);
      const backupKey = resolveScopedBackupKey(SNAPSHOTS_KEY);
      const persistedMaxTs = getMaxPersistedSnapshotTimestamp(storageKey, backupKey);
      const prevListMaxTs = Math.max(getMaxSnapshotListTs(list, metaTsById), persistedMaxTs);
      const nextMetaTs = computeNextSnapshotMetaTs(list, metaTsById, prevListMaxTs);
      metaTsById.delete(id);
      metaTsById.set(prunedUpdated[0].id, nextMetaTs);
      for (const prunedId of prunedIds) {
        metaTsById.set(prunedId, nextMetaTs);
      }
    }
    saveSnapshotsInternal(prunedUpdated, {
      immediateBackup: true,
      allowEmptyBackup: prunedUpdated.length === 0,
      clearLocalOnFailure: true,
      metaTsById: prunedUpdated.length > 0 ? metaTsById : undefined,
    });
  }
  const active = loadActiveState();
  if (active?.activeSnapshotId === id) {
    clearActiveState();
  }
  const { layerImageKeys, preserveRootImageKey, preservePreviewKey } =
    await resolveDeleteImageProtection(id, resultList);
  await deleteSnapshotEntries(id, layerImageKeys, {
    preserveRootImageKey,
    preservePreviewKey,
  });
  return resultList;
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
