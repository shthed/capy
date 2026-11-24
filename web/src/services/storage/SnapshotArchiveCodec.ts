import { PuzzleData, SavedSnapshot } from '../../types';
import {
  ArchiveSavePayloadV2,
  assertSafeLayerImageKey,
  assertValidSavedSnapshot,
  CompactPuzzleRecordV2,
  decodeBinarySaveV2,
  decompressPuzzleRecord,
  encodeArchiveSaveBinaryV2,
  encodeSingleSaveBinaryV2,
  hasBinaryMagicHeader,
  isReservedSnapshotId,
  serializableToRecord,
  SingleSavePayloadV2,
} from '../CapyCodec';
import { getMaxPersistedSnapshotTimestamp, parseTimestampMs } from './BackupEngine';
import {
  collectReferencedLayerImageKeysStrict,
  loadCompactPuzzleRecord,
  loadImageBlob,
  loadPreviewDataUrl,
  loadPuzzleData,
  previewStoreKey,
  saveCompactPuzzleRecord,
  saveImageBlob,
  saveMultipleCompactPuzzleRecords,
  saveMultiplePuzzleData,
  savePreviewDataUrl,
  savePuzzleData,
} from './IndexedDbStore';
import { deserializePuzzle, SerializedPuzzleData, serializePuzzle } from './PuzzleSerializer';
import {
  addSnapshot,
  computeNextSnapshotMetaTs,
  getMaxSnapshotListTs,
  hydrateSnapshotPreviews,
  loadSnapshots,
  loadSnapshotsWithMeta,
  saveSnapshotsInternal,
  stripInternalSnapshotMeta,
} from './SnapshotStorage';
import {
  buildCanonicalLayerImageKey,
  isLayerImageKey,
  LAYER_IMAGE_KEY_PREFIX,
  resolveScopedBackupKey,
  resolveScopedStorageKey,
  SNAPSHOTS_KEY,
} from './StorageKeys';

export interface ImportSnapshotResult {
  importedCount: number;
  importedIds?: string[];
  firstSnapshot?: SavedSnapshot;
  firstPuzzle?: PuzzleData;
  error?: string;
}

function isZeroCopySnapshotRef(snapshot: SavedSnapshot): boolean {
  return (
    Boolean(snapshot.sampleAssetPath) ||
    snapshot.sourceRef?.kind === 'sample' ||
    snapshot.sourceRef?.kind === 'catalog' ||
    snapshot.sourceRef?.kind === 'url'
  );
}

async function collectNestedLayerBlobs(
  compactRecord: CompactPuzzleRecordV2 | null,
  into: Record<string, Blob>
): Promise<void> {
  if (!compactRecord?.nestedLayers?.length) return;
  for (const layer of compactRecord.nestedLayers) {
    const key = layer.imageBlobKey;
    if (!key || Object.prototype.hasOwnProperty.call(into, key)) continue;
    const blob = await loadImageBlob(key);
    if (blob) {
      into[key] = blob;
    }
  }
}

export async function exportSnapshotBinary(
  id: string,
  options?: { exportDate?: number }
): Promise<Uint8Array> {
  const snapshots = loadSnapshots();
  const rawSnapshot = snapshots.find((s) => s.id === id);
  if (!rawSnapshot) throw new Error('Snapshot not found');
  const preview = rawSnapshot.previewDataUrl || (await loadPreviewDataUrl(id));
  const snapshot: SavedSnapshot = preview ? { ...rawSnapshot, previewDataUrl: preview } : rawSnapshot;

  const compactRecord = await loadCompactPuzzleRecord(id);
  const imageBlob = isZeroCopySnapshotRef(snapshot) ? null : await loadImageBlob(id);
  const layerImageBlobs: Record<string, Blob> = {};
  await collectNestedLayerBlobs(compactRecord, layerImageBlobs);

  return encodeSingleSaveBinaryV2(snapshot, compactRecord, imageBlob, {
    ...options,
    ...(Object.keys(layerImageBlobs).length > 0 ? { layerImageBlobs } : {}),
  });
}

export async function exportAllSnapshotsBinary(options?: {
  exportDate?: number;
}): Promise<Uint8Array> {
  const snapshots = await hydrateSnapshotPreviews(loadSnapshots());
  const compactRecords: Record<string, CompactPuzzleRecordV2> = {};
  const imageBlobs: Record<string, Blob> = {};
  const layerImageBlobs: Record<string, Blob> = {};

  for (const snap of snapshots) {
    const rec = await loadCompactPuzzleRecord(snap.id);
    if (rec) {
      compactRecords[snap.id] = rec;
      await collectNestedLayerBlobs(rec, layerImageBlobs);
    }
    if (!isZeroCopySnapshotRef(snap)) {
      const blob = await loadImageBlob(snap.id);
      if (blob) {
        imageBlobs[snap.id] = blob;
      }
    }
  }

  return encodeArchiveSaveBinaryV2(snapshots, compactRecords, imageBlobs, {
    ...options,
    ...(Object.keys(layerImageBlobs).length > 0 ? { layerImageBlobs } : {}),
  });
}

export async function exportSnapshot(id: string): Promise<string> {
  const snapshots = loadSnapshots();
  const rawSnapshot = snapshots.find((s) => s.id === id);
  if (!rawSnapshot) throw new Error('Snapshot not found');
  const preview = rawSnapshot.previewDataUrl || (await loadPreviewDataUrl(id));
  const snapshot: SavedSnapshot = preview ? { ...rawSnapshot, previewDataUrl: preview } : rawSnapshot;
  const puzzle = await loadPuzzleData(id);
  const bundle = {
    version: 2,
    format: 'capy-single-save',
    exportDate: Date.now(),
    snapshot,
    puzzle: puzzle ? serializePuzzle(puzzle) : null,
  };
  return JSON.stringify(bundle);
}

export async function exportAllSnapshots(): Promise<string> {
  const snapshots = await hydrateSnapshotPreviews(loadSnapshots());
  const puzzles: Record<string, SerializedPuzzleData> = {};
  for (const snap of snapshots) {
    const p = await loadPuzzleData(snap.id);
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

function mergeImportedSnapshots(
  existing: SavedSnapshot[],
  imported: SavedSnapshot[],
  refreshTimestamps?: boolean
): { mergedList: SavedSnapshot[]; toPersist: SavedSnapshot[] } {
  const now = Date.now();
  const sanitizedImported = imported.map((s) => stripInternalSnapshotMeta(s));
  const isBootstrapBatch =
    Boolean(refreshTimestamps) &&
    existing.length > 0 &&
    sanitizedImported.every((s) => Boolean(s.isAutoSample));

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
          timestamp:
            typeof s.timestamp === 'number' && Number.isFinite(s.timestamp)
              ? s.timestamp
              : now - idx * 1000,
          lastOpened:
            typeof s.lastOpened === 'number' && Number.isFinite(s.lastOpened)
              ? s.lastOpened
              : now - idx * 1000,
        }
  );
  const importedIds = new Set(normalized.map((s) => s.id));
  const remaining = existing.filter((s) => !importedIds.has(s.id));
  return {
    mergedList: [...normalized, ...remaining],
    toPersist: normalized,
  };
}

function syncImportedMetaTimestamps(
  existing: SavedSnapshot[],
  toPersist: SavedSnapshot[],
  metaTsById: Map<string, number>,
  persistedMaxTs: number = getMaxPersistedSnapshotTimestamp(
    resolveScopedStorageKey(SNAPSHOTS_KEY),
    resolveScopedBackupKey(SNAPSHOTS_KEY)
  )
): void {
  const existingById = new Map(existing.map((s) => [s.id, s]));
  const hasPriorHistory = existing.length > 0 || persistedMaxTs > 0;
  let floorTs = Math.max(getMaxSnapshotListTs(existing, metaTsById), persistedMaxTs);
  for (const s of toPersist) {
    const prevItem = existingById.get(s.id);
    const prevItemTs = prevItem
      ? Math.max(
          parseTimestampMs(prevItem.lastOpened),
          parseTimestampMs(prevItem.timestamp),
          metaTsById.get(s.id) ?? 0
        )
      : (metaTsById.get(s.id) ?? 0);
    const incomingTs = Math.max(parseTimestampMs(s.lastOpened), parseTimestampMs(s.timestamp));
    const effectiveFloor = Math.max(prevItemTs, floorTs);
    if ((prevItem || hasPriorHistory) && incomingTs <= effectiveFloor) {
      const nextTs = Math.max(
        computeNextSnapshotMetaTs(existing, metaTsById, effectiveFloor),
        incomingTs + 1
      );
      metaTsById.set(s.id, nextTs);
      floorTs = Math.max(floorTs, nextTs);
    }
  }
}

async function persistPreviews(snapshots: SavedSnapshot[]): Promise<void> {
  for (const snap of snapshots) {
    if (snap.previewDataUrl) {
      await savePreviewDataUrl(snap.id, snap.previewDataUrl);
    }
  }
}

const FORBIDDEN_IMPORT_MAP_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

interface NestedLayerLike {
  layerId: string;
  imageBlobKey: string;
}

interface ImportBatchItem<TLayer extends NestedLayerLike> {
  snapshot: SavedSnapshot;
  nestedLayers?: TLayer[];
}

interface ValidatedImportBatchResult<TLayer extends NestedLayerLike> {
  remappedLayersBySnapshotId: Map<string, TLayer[]>;
  layerBlobs: Array<{ key: string; blob: Blob }>;
}

function getOwnMapValue<T>(
  map: Record<string, T> | undefined,
  key: string
): T | undefined {
  if (!map || !Object.prototype.hasOwnProperty.call(map, key)) {
    return undefined;
  }
  return map[key];
}

function assertNoDuplicateSnapshotIds(snapshots: SavedSnapshot[]): void {
  const seen = new Set<string>();
  for (const snap of snapshots) {
    if (seen.has(snap.id)) {
      throw new Error(`Duplicate snapshot id "${snap.id}" in import batch`);
    }
    seen.add(snap.id);
  }
}

async function collectOtherLiveProtectedImageKeysStrict(
  existingSnapshots: SavedSnapshot[],
  replacingIds: Set<string>
): Promise<Set<string>> {
  const protectedKeys = new Set<string>();
  const otherSnapshots = existingSnapshots.filter((s) => !replacingIds.has(s.id));
  for (const snap of otherSnapshots) {
    protectedKeys.add(snap.id);
    protectedKeys.add(previewStoreKey(snap.id));
    if (snap.sourceRef?.kind === 'blob' && typeof snap.sourceRef.uri === 'string') {
      const trimmedUri = snap.sourceRef.uri.trim();
      if (trimmedUri.length > 0) {
        protectedKeys.add(trimmedUri);
      }
    }
  }
  const layerRead = await collectReferencedLayerImageKeysStrict(
    otherSnapshots.map((s) => s.id)
  );
  if (!layerRead.ok) {
    throw new Error('Failed to verify existing snapshot layer keys');
  }
  for (const key of layerRead.keys) {
    protectedKeys.add(key);
  }
  return protectedKeys;
}

function validateIncomingSnapshotKeys(
  snap: SavedSnapshot,
  otherProtectedImageKeys: Set<string>,
  allLiveRootIds: Set<string>,
  allLivePreviewKeys: Set<string>,
  claimedBatchBlobUris: Set<string>
): void {
  if (isReservedSnapshotId(snap.id)) {
    throw new Error(`Invalid snapshot id "${snap.id}": reserved prefix or key`);
  }
  const snapPreviewKey = previewStoreKey(snap.id);
  if (
    otherProtectedImageKeys.has(snap.id) ||
    otherProtectedImageKeys.has(snapPreviewKey)
  ) {
    throw new Error(`Snapshot id "${snap.id}" collides with an existing snapshot image key`);
  }
  if (snap.sourceRef?.kind !== 'blob') return;
  const uri = snap.sourceRef.uri.trim();
  if (
    FORBIDDEN_IMPORT_MAP_KEYS.has(uri) ||
    isLayerImageKey(uri) ||
    uri.startsWith(LAYER_IMAGE_KEY_PREFIX)
  ) {
    throw new Error(`Invalid snapshot sourceRef blob id "${uri}"`);
  }
  const isSelfKey = uri === snap.id || uri === snapPreviewKey;
  if (isSelfKey) return;
  if (
    otherProtectedImageKeys.has(uri) ||
    allLiveRootIds.has(uri) ||
    allLivePreviewKeys.has(uri) ||
    claimedBatchBlobUris.has(uri)
  ) {
    throw new Error(
      `Snapshot sourceRef blob id "${uri}" collides with another snapshot image key`
    );
  }
  claimedBatchBlobUris.add(uri);
}

function remapAndValidateSnapshotLayers<TLayer extends NestedLayerLike>(
  snapId: string,
  nestedLayers: TLayer[],
  decodedLayerImages: Record<string, { mimeType: string; bytes: Uint8Array }> | undefined,
  otherProtectedImageKeys: Set<string>,
  allLiveRootIds: Set<string>,
  allLivePreviewKeys: Set<string>,
  batchBlobUris: Set<string>,
  claimedLayerKeys: Map<string, string>,
  outLayerBlobs: Array<{ key: string; blob: Blob }>
): TLayer[] {
  const seenLayerIds = new Set<string>();
  const remapped: TLayer[] = [];

  for (const layer of nestedLayers) {
    if (seenLayerIds.has(layer.layerId)) {
      throw new Error(`Duplicate nested layerId "${layer.layerId}" in snapshot "${snapId}"`);
    }
    seenLayerIds.add(layer.layerId);

    const oldKey = layer.imageBlobKey;
    const canonicalKey = buildCanonicalLayerImageKey(snapId, layer.layerId);
    assertSafeLayerImageKey(canonicalKey, 'imageBlobKey');

    if (
      otherProtectedImageKeys.has(canonicalKey) ||
      allLiveRootIds.has(canonicalKey) ||
      allLivePreviewKeys.has(canonicalKey) ||
      batchBlobUris.has(canonicalKey)
    ) {
      throw new Error(
        `Nested layer image key "${canonicalKey}" collides with an existing snapshot`
      );
    }
    const prevOwner = claimedLayerKeys.get(canonicalKey);
    if (prevOwner !== undefined && prevOwner !== snapId) {
      throw new Error(
        `Nested layer image key "${canonicalKey}" collides across imported snapshots`
      );
    }
    claimedLayerKeys.set(canonicalKey, snapId);
    remapped.push({ ...layer, imageBlobKey: canonicalKey });

    const entry = getOwnMapValue(decodedLayerImages, oldKey);
    if (entry && entry.bytes.byteLength > 0) {
      outLayerBlobs.push({
        key: canonicalKey,
        blob: new Blob([new Uint8Array(entry.bytes)], {
          type: entry.mimeType || 'image/webp',
        }),
      });
    }
  }

  return remapped;
}

async function validateAndRemapImportBatch<TLayer extends NestedLayerLike>(params: {
  existingSnapshots: SavedSnapshot[];
  incomingItems: Array<ImportBatchItem<TLayer>>;
  decodedLayerImages?: Record<string, { mimeType: string; bytes: Uint8Array }>;
}): Promise<ValidatedImportBatchResult<TLayer>> {
  const { existingSnapshots, incomingItems, decodedLayerImages } = params;
  const incomingSnapshots = incomingItems.map((item) => item.snapshot);
  assertNoDuplicateSnapshotIds(incomingSnapshots);

  const replacingIds = new Set(incomingSnapshots.map((s) => s.id));
  const otherProtectedImageKeys = await collectOtherLiveProtectedImageKeysStrict(
    existingSnapshots,
    replacingIds
  );

  const allLiveRootIds = new Set<string>([
    ...existingSnapshots.map((s) => s.id),
    ...incomingSnapshots.map((s) => s.id),
  ]);
  const allLivePreviewKeys = new Set<string>([
    ...existingSnapshots.map((s) => previewStoreKey(s.id)),
    ...incomingSnapshots.map((s) => previewStoreKey(s.id)),
  ]);

  const claimedBatchBlobUris = new Set<string>();
  const batchBlobUris = new Set<string>();
  for (const snap of incomingSnapshots) {
    validateIncomingSnapshotKeys(
      snap,
      otherProtectedImageKeys,
      allLiveRootIds,
      allLivePreviewKeys,
      claimedBatchBlobUris
    );
    if (snap.sourceRef?.kind === 'blob') {
      const uri = snap.sourceRef.uri.trim();
      if (uri.length > 0) {
        batchBlobUris.add(uri);
      }
    }
  }

  const claimedLayerKeys = new Map<string, string>();
  const remappedLayersBySnapshotId = new Map<string, TLayer[]>();
  const layerBlobs: Array<{ key: string; blob: Blob }> = [];

  for (const item of incomingItems) {
    if (!item.nestedLayers || item.nestedLayers.length === 0) continue;
    const remapped = remapAndValidateSnapshotLayers(
      item.snapshot.id,
      item.nestedLayers,
      decodedLayerImages,
      otherProtectedImageKeys,
      allLiveRootIds,
      allLivePreviewKeys,
      batchBlobUris,
      claimedLayerKeys,
      layerBlobs
    );
    remappedLayersBySnapshotId.set(item.snapshot.id, remapped);
  }

  return { remappedLayersBySnapshotId, layerBlobs };
}

async function importBinarySingleSave(
  decoded: SingleSavePayloadV2,
  options?: { refreshTimestamps?: boolean }
): Promise<ImportSnapshotResult> {
  assertValidSavedSnapshot(decoded.snapshot, { strictV2: true });
  const now = Date.now();
  const rawSnap = stripInternalSnapshotMeta(decoded.snapshot);
  const snap: SavedSnapshot = options?.refreshTimestamps
    ? { ...rawSnap, timestamp: now, lastOpened: now }
    : rawSnap;

  const existingSnapshots = loadSnapshots();
  let preparedRecord: CompactPuzzleRecordV2 | null = decoded.compactPuzzle
    ? serializableToRecord(decoded.compactPuzzle)
    : null;

  const { remappedLayersBySnapshotId, layerBlobs: preparedLayerBlobs } =
    await validateAndRemapImportBatch({
      existingSnapshots,
      incomingItems: [{ snapshot: snap, nestedLayers: preparedRecord?.nestedLayers }],
      decodedLayerImages: decoded.layerImages,
    });

  let firstPuzzle: PuzzleData | undefined;
  if (preparedRecord) {
    const remappedLayers = remappedLayersBySnapshotId.get(snap.id);
    if (remappedLayers) {
      preparedRecord = { ...preparedRecord, nestedLayers: remappedLayers };
    }
    firstPuzzle = decompressPuzzleRecord(preparedRecord);
  }
  const preparedBlob =
    decoded.imageBytes && decoded.imageBytes.byteLength > 0
      ? new Blob([new Uint8Array(decoded.imageBytes)], {
          type: decoded.imageMimeType || 'image/webp',
        })
      : null;

  // Fail-closed: commit IndexedDB payloads (including all nested layer blobs) BEFORE writing localStorage metadata.
  if (preparedRecord) {
    await saveCompactPuzzleRecord(snap.id, preparedRecord);
  }
  if (preparedBlob) {
    await saveImageBlob(snap.id, preparedBlob);
  }
  for (const layerImg of preparedLayerBlobs) {
    await saveImageBlob(layerImg.key, layerImg.blob);
  }
  if (snap.previewDataUrl) {
    await savePreviewDataUrl(snap.id, snap.previewDataUrl);
  }
  addSnapshot(snap);
  return { importedCount: 1, importedIds: [snap.id], firstSnapshot: snap, firstPuzzle };
}

async function importBinaryArchiveSave(
  decoded: ArchiveSavePayloadV2,
  options?: { refreshTimestamps?: boolean; filterSnapshotId?: string }
): Promise<ImportSnapshotResult> {
  for (const s of decoded.snapshots) {
    assertValidSavedSnapshot(s, { strictV2: true });
  }
  const validSnapshots = decoded.snapshots.filter(
    (s) => !options?.filterSnapshotId || s.id === options.filterSnapshotId
  );
  if (validSnapshots.length === 0) {
    return { importedCount: 0, error: 'No valid snapshots in binary archive' };
  }
  assertNoDuplicateSnapshotIds(validSnapshots);

  const { snapshots: existing, metaTsById } = loadSnapshotsWithMeta();
  const { mergedList, toPersist } = mergeImportedSnapshots(
    existing,
    validSnapshots,
    options?.refreshTimestamps
  );

  const rawRecordsBySnapId = new Map<string, CompactPuzzleRecordV2>();
  const incomingItems = toPersist.map((snap) => {
    const comp = getOwnMapValue(decoded.compactPuzzles, snap.id);
    const record = comp ? serializableToRecord(comp) : undefined;
    if (record) {
      rawRecordsBySnapId.set(snap.id, record);
    }
    return { snapshot: snap, nestedLayers: record?.nestedLayers };
  });

  const { remappedLayersBySnapshotId, layerBlobs: layerImageEntries } =
    await validateAndRemapImportBatch({
      existingSnapshots: existing,
      incomingItems,
      decodedLayerImages: decoded.layerImages,
    });

  const compactEntries: Array<{ id: string; record: CompactPuzzleRecordV2 }> = [];
  const imageEntries: Array<{ id: string; blob: Blob }> = [];
  let firstPuzzle: PuzzleData | undefined;

  for (let i = 0; i < toPersist.length; i++) {
    const snap = toPersist[i];
    const baseRecord = rawRecordsBySnapId.get(snap.id);
    if (baseRecord) {
      const remappedLayers = remappedLayersBySnapshotId.get(snap.id);
      const record = remappedLayers ? { ...baseRecord, nestedLayers: remappedLayers } : baseRecord;
      const decompressed = decompressPuzzleRecord(record);
      if (i === 0) {
        firstPuzzle = decompressed;
      }
      compactEntries.push({ id: snap.id, record });
    }
    const imgEntry = getOwnMapValue(decoded.images, snap.id);
    if (imgEntry && imgEntry.bytes.byteLength > 0) {
      imageEntries.push({
        id: snap.id,
        blob: new Blob([new Uint8Array(imgEntry.bytes)], {
          type: imgEntry.mimeType || 'image/webp',
        }),
      });
    }
  }

  // Fail-closed: commit IndexedDB payloads (including all nested layer blobs) BEFORE writing localStorage metadata.
  await saveMultipleCompactPuzzleRecords(compactEntries);
  for (const imgEntry of imageEntries) {
    await saveImageBlob(imgEntry.id, imgEntry.blob);
  }
  for (const layerImg of layerImageEntries) {
    await saveImageBlob(layerImg.key, layerImg.blob);
  }
  await persistPreviews(toPersist);

  const persistedMaxTs = getMaxPersistedSnapshotTimestamp(
    resolveScopedStorageKey(SNAPSHOTS_KEY),
    resolveScopedBackupKey(SNAPSHOTS_KEY)
  );
  syncImportedMetaTimestamps(existing, toPersist, metaTsById, persistedMaxTs);
  saveSnapshotsInternal(mergedList, { metaTsById });
  return {
    importedCount: toPersist.length > 0 ? toPersist.length : validSnapshots.length,
    importedIds: toPersist.map((s) => s.id),
    firstSnapshot: toPersist[0] || stripInternalSnapshotMeta(validSnapshots[0]),
    firstPuzzle,
  };
}

export async function importSnapshotData(
  input: ArrayBuffer | Uint8Array | string,
  options?: { refreshTimestamps?: boolean; filterSnapshotId?: string }
): Promise<ImportSnapshotResult> {
  try {
    if (typeof input !== 'string') {
      const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
      if (bytes.byteLength === 0) {
        return { importedCount: 0, error: 'Empty save file' };
      }
      if (hasBinaryMagicHeader(bytes)) {
        const decoded = await decodeBinarySaveV2(bytes);
        if (decoded.format === 'capy-single-save-v2' && decoded.snapshot) {
          return await importBinarySingleSave(decoded, options);
        }
        if (decoded.format === 'capy-archive-save-v2' && Array.isArray(decoded.snapshots)) {
          return await importBinaryArchiveSave(decoded, options);
        }
        return { importedCount: 0, error: 'Unrecognized Capy v2 binary payload' };
      }
      const text = new TextDecoder().decode(bytes);
      return await importSnapshotBundle(text, options);
    }

    return await importSnapshotBundle(input, options);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : undefined;
    return { importedCount: 0, error: message || 'Failed to import Capy save file' };
  }
}

async function importSingleJsonBundle(
  data: Record<string, unknown>,
  options?: { refreshTimestamps?: boolean }
): Promise<ImportSnapshotResult> {
  assertValidSavedSnapshot(data.snapshot, { strictV2: false });
  const now = Date.now();
  const rawSnap = stripInternalSnapshotMeta(data.snapshot as SavedSnapshot);
  const snap: SavedSnapshot = options?.refreshTimestamps
    ? { ...rawSnap, timestamp: now, lastOpened: now }
    : rawSnap;

  const existingSnapshots = loadSnapshots();
  let firstPuzzle: PuzzleData | undefined;
  if (data.puzzle !== undefined && data.puzzle !== null) {
    firstPuzzle = deserializePuzzle(data.puzzle as SerializedPuzzleData);
  }

  const { remappedLayersBySnapshotId } = await validateAndRemapImportBatch({
    existingSnapshots,
    incomingItems: [{ snapshot: snap, nestedLayers: firstPuzzle?.nestedLayers }],
  });

  if (firstPuzzle) {
    const remappedLayers = remappedLayersBySnapshotId.get(snap.id);
    if (remappedLayers) {
      firstPuzzle = { ...firstPuzzle, nestedLayers: remappedLayers };
    }
    await savePuzzleData(snap.id, firstPuzzle);
  }
  if (snap.previewDataUrl) {
    await savePreviewDataUrl(snap.id, snap.previewDataUrl);
  }
  addSnapshot(snap);
  return { importedCount: 1, importedIds: [snap.id], firstSnapshot: snap, firstPuzzle };
}

async function importArchiveJsonBundle(
  data: Record<string, unknown>,
  options?: { refreshTimestamps?: boolean }
): Promise<ImportSnapshotResult> {
  const rawSnapshots = data.snapshots as unknown[];
  if (rawSnapshots.length === 0) {
    return { importedCount: 0, error: 'No valid snapshots in archive' };
  }
  for (const s of rawSnapshots) {
    assertValidSavedSnapshot(s, { strictV2: false });
  }
  const validSnapshots = rawSnapshots as SavedSnapshot[];
  assertNoDuplicateSnapshotIds(validSnapshots);

  if (
    data.puzzles !== undefined &&
    data.puzzles !== null &&
    (typeof data.puzzles !== 'object' || Array.isArray(data.puzzles))
  ) {
    return { importedCount: 0, error: 'Invalid puzzles map in archive' };
  }

  const { snapshots: existing, metaTsById } = loadSnapshotsWithMeta();
  const { mergedList, toPersist } = mergeImportedSnapshots(
    existing,
    validSnapshots,
    options?.refreshTimestamps
  );

  const deserializedBySnapId = new Map<string, PuzzleData>();
  const puzzlesMap = data.puzzles as Record<string, SerializedPuzzleData> | undefined;
  const incomingItems = toPersist.map((snap) => {
    const serialized = getOwnMapValue(puzzlesMap, snap.id);
    const puzzle =
      serialized !== undefined && serialized !== null ? deserializePuzzle(serialized) : undefined;
    if (puzzle) {
      deserializedBySnapId.set(snap.id, puzzle);
    }
    return { snapshot: snap, nestedLayers: puzzle?.nestedLayers };
  });

  const { remappedLayersBySnapshotId } = await validateAndRemapImportBatch({
    existingSnapshots: existing,
    incomingItems,
  });

  let firstPuzzle: PuzzleData | undefined;
  const puzzleEntries: Array<{ id: string; puzzle: PuzzleData }> = [];
  for (let i = 0; i < toPersist.length; i++) {
    const snap = toPersist[i];
    const basePuzzle = deserializedBySnapId.get(snap.id);
    if (basePuzzle) {
      const remappedLayers = remappedLayersBySnapshotId.get(snap.id);
      const puzzle = remappedLayers
        ? { ...basePuzzle, nestedLayers: remappedLayers }
        : basePuzzle;
      if (i === 0) {
        firstPuzzle = puzzle;
      }
      puzzleEntries.push({ id: snap.id, puzzle });
    }
  }

  await saveMultiplePuzzleData(puzzleEntries);
  await persistPreviews(toPersist);
  const persistedMaxTs = getMaxPersistedSnapshotTimestamp(
    resolveScopedStorageKey(SNAPSHOTS_KEY),
    resolveScopedBackupKey(SNAPSHOTS_KEY)
  );
  syncImportedMetaTimestamps(existing, toPersist, metaTsById, persistedMaxTs);
  saveSnapshotsInternal(mergedList, { metaTsById });

  return {
    importedCount: toPersist.length > 0 ? toPersist.length : validSnapshots.length,
    importedIds: toPersist.map((s) => s.id),
    firstSnapshot: toPersist[0] || stripInternalSnapshotMeta(validSnapshots[0]),
    firstPuzzle,
  };
}

async function importSnapshotArrayBundle(
  data: unknown[],
  options?: { refreshTimestamps?: boolean }
): Promise<ImportSnapshotResult> {
  if (data.length === 0) {
    return { importedCount: 0, error: 'No valid snapshots in array' };
  }
  for (const s of data) {
    assertValidSavedSnapshot(s, { strictV2: false });
  }
  const validSnapshots = data as SavedSnapshot[];
  assertNoDuplicateSnapshotIds(validSnapshots);

  const { snapshots: existing, metaTsById } = loadSnapshotsWithMeta();
  const { mergedList, toPersist } = mergeImportedSnapshots(
    existing,
    validSnapshots,
    options?.refreshTimestamps
  );

  await validateAndRemapImportBatch({
    existingSnapshots: existing,
    incomingItems: toPersist.map((snapshot) => ({ snapshot })),
  });

  await persistPreviews(toPersist);
  const persistedMaxTs = getMaxPersistedSnapshotTimestamp(
    resolveScopedStorageKey(SNAPSHOTS_KEY),
    resolveScopedBackupKey(SNAPSHOTS_KEY)
  );
  syncImportedMetaTimestamps(existing, toPersist, metaTsById, persistedMaxTs);
  saveSnapshotsInternal(mergedList, { metaTsById });
  return {
    importedCount: toPersist.length > 0 ? toPersist.length : validSnapshots.length,
    importedIds: toPersist.map((s) => s.id),
    firstSnapshot: toPersist[0] || stripInternalSnapshotMeta(validSnapshots[0]),
  };
}

export async function importSnapshotBundle(
  jsonString: string,
  options?: { refreshTimestamps?: boolean }
): Promise<ImportSnapshotResult> {
  try {
    const data = JSON.parse(jsonString);
    if (!data) return { importedCount: 0, error: 'Empty or invalid JSON' };

    if (
      typeof data === 'object' &&
      !Array.isArray(data) &&
      data.format === 'capy-single-save' &&
      data.snapshot !== undefined
    ) {
      return await importSingleJsonBundle(data as Record<string, unknown>, options);
    }

    if (
      typeof data === 'object' &&
      !Array.isArray(data) &&
      data.format === 'capy-archive-save' &&
      Array.isArray(data.snapshots)
    ) {
      return await importArchiveJsonBundle(data as Record<string, unknown>, options);
    }

    if (Array.isArray(data)) {
      return await importSnapshotArrayBundle(data, options);
    }

    return { importedCount: 0, error: 'Unrecognized Capy save format' };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : undefined;
    return { importedCount: 0, error: message || 'Failed to parse JSON save' };
  }
}
