import { InfiniteZoomNodeMeta, PaletteColor, PuzzleData, SavedSnapshot, UserSettings } from '../types';
import { CompactPuzzleRecordV2 } from './CapyCodec';
import {
  DEV_DEBUG_STORAGE_KEY,
  isDebugEnvironmentEnabled as isDebugStorageExposed,
} from '../utils/debugEnvironment';
import {
  ActiveSessionState,
  clearActiveState,
  loadActiveState,
  saveActiveState,
} from './storage/ActiveSessionStorage';
import { flushPendingBackups } from './storage/BackupEngine';
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
} from './storage/IndexedDbStore';
import {
  deserializePuzzle,
  SerializedPuzzleData,
  serializePuzzle,
} from './storage/PuzzleSerializer';
import {
  isQuotaError,
  onQuotaWarning,
  QuotaWarning,
  requestPersistentStorageOnce,
} from './storage/SafeLocalStore';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './storage/SettingsStorage';
import {
  exportAllSnapshots,
  exportAllSnapshotsBinary,
  exportSnapshot,
  exportSnapshotBinary,
  importSnapshotBundle,
  importSnapshotData,
  ImportSnapshotResult,
} from './storage/SnapshotArchiveCodec';
import {
  addSnapshot,
  clearAllSnapshots,
  deleteSnapshot,
  estimatePuzzleSaveBytes,
  hydrateSnapshotPreviews,
  linkZoomTreeSnapshots,
  loadSnapshots,
  normalizeSnapshotTitle,
  renameSnapshot,
  saveSnapshots,
  togglePinSnapshot,
  updateSnapshotMetadata,
  updateSnapshotProgress,
  updateSnapshotViewport,
} from './storage/SnapshotStorage';

export {
  DEFAULT_SETTINGS,
  deserializePuzzle,
  DEV_DEBUG_STORAGE_KEY,
  isDebugStorageExposed,
  serializePuzzle,
};
export type { QuotaWarning, SerializedPuzzleData };

/**
 * Thin backward-compatible static facade delegating to `web/src/services/storage/*`.
 * Preserves writable static methods for E2E/unit test hooks and `window.capyStorage` exposure
 * when `isDebugStorageExposed()` is enabled.
 */
export class StorageService {
  static isQuotaError(err: unknown): boolean {
    return isQuotaError(err);
  }

  static onQuotaWarning(listener: (warning: QuotaWarning) => void): () => void {
    return onQuotaWarning(listener);
  }

  static requestPersistentStorageOnce(): void {
    requestPersistentStorageOnce();
  }

  static flushPendingBackups(): void {
    flushPendingBackups();
  }

  static loadSettings(): UserSettings {
    return loadSettings();
  }

  static saveSettings(settings: UserSettings): void {
    saveSettings(settings);
  }

  static savePreviewDataUrl(id: string, previewDataUrl: string): Promise<void> {
    return savePreviewDataUrl(id, previewDataUrl);
  }

  static loadPreviewDataUrl(id: string): Promise<string | null> {
    return loadPreviewDataUrl(id);
  }

  static hydrateSnapshotPreviews(snapshots: SavedSnapshot[]): Promise<SavedSnapshot[]> {
    return hydrateSnapshotPreviews(snapshots);
  }

  static normalizeSnapshotTitle(title: string): string {
    return normalizeSnapshotTitle(title);
  }

  static loadSnapshots(): SavedSnapshot[] {
    return loadSnapshots();
  }

  static saveSnapshots(
    snapshots: SavedSnapshot[],
    optionsOrImmediate?:
      | boolean
      | { allowEmptyBackup?: boolean; immediateBackup?: boolean; clearLocalOnFailure?: boolean }
  ): void {
    saveSnapshots(snapshots, optionsOrImmediate);
  }

  static addSnapshot(snapshot: SavedSnapshot): SavedSnapshot[] {
    return addSnapshot(snapshot);
  }

  static estimatePuzzleSaveBytes(puzzle: PuzzleData, previewDataUrl?: string): number {
    return estimatePuzzleSaveBytes(puzzle, previewDataUrl);
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
    return updateSnapshotProgress(
      id,
      filledCount,
      totalCount,
      filledRegionIds,
      zoomScale,
      panOffsetX,
      panOffsetY,
      previewDataUrl,
      paintedRegionColors,
      customPalette,
      isFreeColor,
      fileSizeBytes,
      resetEpoch
    );
  }

  static updateSnapshotViewport(
    id: string,
    zoomScale: number,
    panOffsetX: number,
    panOffsetY: number
  ): SavedSnapshot[] {
    return updateSnapshotViewport(id, zoomScale, panOffsetX, panOffsetY);
  }

  static renameSnapshot(id: string, newTitle: string): SavedSnapshot[] {
    return renameSnapshot(id, newTitle);
  }

  static togglePinSnapshot(id: string): SavedSnapshot[] {
    return togglePinSnapshot(id);
  }

  static linkZoomTreeSnapshots(
    parentId: string,
    childId: string,
    parentPatch?: Partial<InfiniteZoomNodeMeta>,
    childPatch?: Partial<InfiniteZoomNodeMeta>
  ): SavedSnapshot[] {
    return linkZoomTreeSnapshots(parentId, childId, parentPatch, childPatch);
  }

  static updateSnapshotMetadata(id: string, patch: Partial<SavedSnapshot>): SavedSnapshot[] {
    return updateSnapshotMetadata(id, patch);
  }

  static deleteSnapshot(
    id: string,
    options?: { skipTombstone?: boolean; tombstoneAt?: number }
  ): Promise<SavedSnapshot[]> {
    return deleteSnapshot(id, options);
  }

  static clearAllSnapshots(): Promise<void> {
    return clearAllSnapshots();
  }

  static savePuzzleData(id: string, puzzle: PuzzleData): Promise<void> {
    return savePuzzleData(id, puzzle);
  }

  static saveCompactPuzzleRecord(id: string, record: CompactPuzzleRecordV2): Promise<void> {
    return saveCompactPuzzleRecord(id, record);
  }

  static loadPuzzleData(id: string): Promise<PuzzleData | null> {
    return loadPuzzleData(id);
  }

  static loadCompactPuzzleRecord(id: string): Promise<CompactPuzzleRecordV2 | null> {
    return loadCompactPuzzleRecord(id);
  }

  static saveImageBlob(id: string, blob: Blob): Promise<void> {
    return saveImageBlob(id, blob);
  }

  static loadImageBlob(id: string): Promise<Blob | null> {
    return loadImageBlob(id);
  }

  static saveActiveState(state: ActiveSessionState): void {
    saveActiveState(state);
  }

  static clearActiveState(): void {
    clearActiveState();
  }

  static loadActiveState(): ActiveSessionState | null {
    return loadActiveState();
  }

  static saveMultipleCompactPuzzleRecords(
    entries: Array<{ id: string; record: CompactPuzzleRecordV2 }>
  ): Promise<void> {
    return saveMultipleCompactPuzzleRecords(entries);
  }

  static saveMultiplePuzzleData(entries: Array<{ id: string; puzzle: PuzzleData }>): Promise<void> {
    return saveMultiplePuzzleData(entries);
  }

  static exportSnapshotBinary(
    id: string,
    options?: { exportDate?: number }
  ): Promise<Uint8Array> {
    return exportSnapshotBinary(id, options);
  }

  static exportAllSnapshotsBinary(options?: { exportDate?: number }): Promise<Uint8Array> {
    return exportAllSnapshotsBinary(options);
  }

  static exportSnapshot(id: string): Promise<string> {
    return exportSnapshot(id);
  }

  static exportAllSnapshots(): Promise<string> {
    return exportAllSnapshots();
  }

  static importSnapshotData(
    input: ArrayBuffer | Uint8Array | string,
    options?: { refreshTimestamps?: boolean; filterSnapshotId?: string }
  ): Promise<ImportSnapshotResult> {
    return importSnapshotData(input, options);
  }

  static importSnapshotBundle(
    jsonString: string,
    options?: { refreshTimestamps?: boolean }
  ): Promise<ImportSnapshotResult> {
    return importSnapshotBundle(jsonString, options);
  }
}

if (typeof window !== 'undefined' && isDebugStorageExposed()) {
  (window as unknown as { capyStorage?: typeof StorageService }).capyStorage = StorageService;
}
