import { PuzzleData, SavedSnapshot } from '../../types';
import {
  ArchiveSavePayloadV2,
  assertValidSavedSnapshot,
  CompactPuzzleRecordV2,
  decodeBinarySaveV2,
  decompressPuzzleRecord,
  encodeArchiveSaveBinaryV2,
  encodeSingleSaveBinaryV2,
  hasBinaryMagicHeader,
  serializableToRecord,
  SingleSavePayloadV2,
} from '../CapyCodec';
import { getMaxPersistedSnapshotTimestamp, parseTimestampMs } from './BackupEngine';
import {
  loadCompactPuzzleRecord,
  loadImageBlob,
  loadPreviewDataUrl,
  loadPuzzleData,
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
import { resolveScopedBackupKey, resolveScopedStorageKey, SNAPSHOTS_KEY } from './StorageKeys';

export interface ImportSnapshotResult {
  importedCount: number;
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

  return encodeSingleSaveBinaryV2(snapshot, compactRecord, imageBlob, options);
}

export async function exportAllSnapshotsBinary(options?: {
  exportDate?: number;
}): Promise<Uint8Array> {
  const snapshots = await hydrateSnapshotPreviews(loadSnapshots());
  const compactRecords: Record<string, CompactPuzzleRecordV2> = {};
  const imageBlobs: Record<string, Blob> = {};

  for (const snap of snapshots) {
    const rec = await loadCompactPuzzleRecord(snap.id);
    if (rec) {
      compactRecords[snap.id] = rec;
    }
    if (!isZeroCopySnapshotRef(snap)) {
      const blob = await loadImageBlob(snap.id);
      if (blob) {
        imageBlobs[snap.id] = blob;
      }
    }
  }

  return encodeArchiveSaveBinaryV2(snapshots, compactRecords, imageBlobs, options);
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

  // Fail-closed: commit IndexedDB payloads BEFORE writing localStorage metadata.
  if (preparedRecord) {
    await saveCompactPuzzleRecord(snap.id, preparedRecord);
  }
  if (preparedBlob) {
    await saveImageBlob(snap.id, preparedBlob);
  }
  if (snap.previewDataUrl) {
    await savePreviewDataUrl(snap.id, snap.previewDataUrl);
  }
  addSnapshot(snap);
  return { importedCount: 1, firstSnapshot: snap, firstPuzzle };
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

  const { snapshots: existing, metaTsById } = loadSnapshotsWithMeta();
  const { mergedList, toPersist } = mergeImportedSnapshots(
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

  // Fail-closed: commit IndexedDB payloads BEFORE writing localStorage metadata.
  await saveMultipleCompactPuzzleRecords(compactEntries);
  for (const imgEntry of imageEntries) {
    await saveImageBlob(imgEntry.id, imgEntry.blob);
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
  let firstPuzzle: PuzzleData | undefined;
  if (data.puzzle !== undefined && data.puzzle !== null) {
    firstPuzzle = deserializePuzzle(data.puzzle as SerializedPuzzleData);
  }
  if (firstPuzzle) {
    await savePuzzleData(snap.id, firstPuzzle);
  }
  if (snap.previewDataUrl) {
    await savePreviewDataUrl(snap.id, snap.previewDataUrl);
  }
  addSnapshot(snap);
  return { importedCount: 1, firstSnapshot: snap, firstPuzzle };
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

  let firstPuzzle: PuzzleData | undefined;
  const puzzleEntries: Array<{ id: string; puzzle: PuzzleData }> = [];
  const puzzlesMap = data.puzzles as Record<string, SerializedPuzzleData> | undefined;
  if (puzzlesMap) {
    for (let i = 0; i < toPersist.length; i++) {
      const snap = toPersist[i];
      const serialized = puzzlesMap[snap.id];
      if (serialized !== undefined && serialized !== null) {
        const puzzle = deserializePuzzle(serialized);
        if (i === 0) {
          firstPuzzle = puzzle;
        }
        puzzleEntries.push({ id: snap.id, puzzle });
      }
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
  const { snapshots: existing, metaTsById } = loadSnapshotsWithMeta();
  const { mergedList, toPersist } = mergeImportedSnapshots(
    existing,
    validSnapshots,
    options?.refreshTimestamps
  );
  await persistPreviews(toPersist);
  const persistedMaxTs = getMaxPersistedSnapshotTimestamp(
    resolveScopedStorageKey(SNAPSHOTS_KEY),
    resolveScopedBackupKey(SNAPSHOTS_KEY)
  );
  syncImportedMetaTimestamps(existing, toPersist, metaTsById, persistedMaxTs);
  saveSnapshotsInternal(mergedList, { metaTsById });
  return {
    importedCount: toPersist.length > 0 ? toPersist.length : validSnapshots.length,
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
