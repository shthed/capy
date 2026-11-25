import {
  BorderExtensionSides,
  InfiniteZoomNodeMeta,
  InfiniteZoomProviderMode,
  NanoBananaModelId,
  PuzzleData,
  SavedSnapshot,
} from '../types';
import { StorageService } from '../services/StorageService';
import { deleteOrphanedEntries } from '../services/storage/IndexedDbStore';
import { getTotalRegionCount, isSafeLayerId } from '../engine/UnifiedPuzzleLayers';
import { generatePreviewDataUrl, hasCutoutExteriorMask } from '../services/artworkExporter';
import { reportSwallowed } from '../services/telemetry';
import type { RegionGridLike } from '../services/ai/RegionSelectionEngine';
import type { CoopViewport } from './useCoopSession';
import type { UndoHistoryEntry } from './useUndoRedo';
import { computeNextResetEpoch, hydrateLayerImagesForPuzzle } from './useSnapshotLibrary';

export interface PreviousSnapshotMeta {
  sampleAssetPath: string | null | undefined;
  isAutoSample: boolean | undefined;
  sourceRef: SavedSnapshot['sourceRef'];
  zoomTree: InfiniteZoomNodeMeta | undefined;
  previewDataUrl: string | undefined;
}

export interface UndoInfiniteZoomSnapshot {
  operationKind: 'zoom-in' | 'zoom-out';
  snapshotId: string;
  puzzle: PuzzleData;
  sourceImage: HTMLImageElement;
  previousBlob: Blob | null;
  promotedFromSample?: boolean;
  addedRootBlobKey?: string;
  previousBlobUrl: string | null;
  newBlobUrl: string | null;
  addedLayerBlobKeys: string[];
  previousLayerImages: Map<string, HTMLImageElement>;
  filledRegionIds: Set<number>;
  paintedRegionColors: Map<number, number>;
  undoStack: UndoHistoryEntry[];
  redoStack: UndoHistoryEntry[];
  activeColorId: number;
  previousViewport: CoopViewport;
  previousMeta: PreviousSnapshotMeta;
  addedRegionCount: number;
}

export type UndoSubdivisionSnapshot = UndoInfiniteZoomSnapshot;

export interface RootBlobPersistencePlan {
  targetRootBlobKey: string;
  addedRootBlobKey?: string;
  needsRootMaterialization: boolean;
  ownedPreviousRootBlobKey: string | null;
}

export interface RollbackAbortedLayerPersistOpts {
  snapId: string;
  addedLayerBlobKeys: string[];
  addedRootBlobKey?: string;
  newRootBlobUrl?: string | null;
  newLayerObjectUrls?: string[];
  previousRootBlob?: Blob | null;
  promotedFromSample?: boolean;
  basePuzzle?: PuzzleData;
}

export interface PersistZoomInBlobsOpts {
  snapId: string;
  existingSnap: SavedSnapshot | undefined;
  basePuzzle: PuzzleData;
  baseImage: HTMLImageElement;
  nextPuzzle: PuzzleData;
  imageBlobKey: string;
  layerPngBlob: Blob;
  layerObjectUrl: string;
  promotedFromSample: boolean;
  rootImageBlobKey?: string;
  addedRootBlobKey?: string;
  isAborted: () => boolean;
}

export interface PersistZoomOutBlobsOpts {
  snapId: string;
  basePuzzle: PuzzleData;
  nextPuzzle: PuzzleData;
  previousRootImageBlobKey: string;
  previousRootLayerBlob: Blob;
  outerBlob: Blob;
  previousRootBlob: Blob | null;
  promotedFromSample: boolean;
  rootImageBlobKey?: string;
  addedRootBlobKey?: string;
  outerObjUrl: string;
  prevRootObjUrl: string;
  isAborted: () => boolean;
}

export interface ZoomInStorageCommitParams {
  snapId: string;
  existingSnap: SavedSnapshot | undefined;
  liveActiveSave: SavedSnapshot | undefined;
  currentActiveSave: SavedSnapshot | undefined;
  nextPuzzle: PuzzleData;
  nextFilled: Set<number>;
  nextPainted: Map<number, number>;
  nextActiveColorId: number;
  selectedCopy: ReadonlySet<number>;
  sanitizedPrompt: string;
  providerUsed: InfiniteZoomProviderMode;
  modelUsed: NanoBananaModelId;
  removedFilledCount: number;
  previewUrl: string;
  isFree: boolean;
  viewport: CoopViewport;
  rootImageBlobKey?: string;
}

export interface ZoomInStorageCommitResult {
  updatedSnapshots: SavedSnapshot[];
  syncedSave: SavedSnapshot | undefined;
  nextResetEpoch: number | undefined;
}

export interface ZoomOutStorageCommitParams {
  snapId: string;
  existingSnap: SavedSnapshot | undefined;
  nextPuzzle: PuzzleData;
  preservedFilled: Set<number>;
  preservedPainted: Map<number, number>;
  nextActiveColorId: number;
  sides: BorderExtensionSides;
  sanitizedPrompt: string;
  providerUsed: InfiniteZoomProviderMode;
  modelUsed: NanoBananaModelId;
  previewUrl: string;
  isFree: boolean;
  rootImageBlobKey?: string;
}

export interface ZoomOutStorageCommitResult {
  updatedSnapshots: SavedSnapshot[];
  syncedSave: SavedSnapshot | undefined;
  fittedViewport: CoopViewport;
}

export interface RestoreUndoSubdivisionPersistenceParams {
  snap: UndoInfiniteZoomSnapshot;
  isFreeColorMode: boolean;
  activeSave: SavedSnapshot | undefined;
  liveActiveSave: SavedSnapshot | undefined;
  isStale: () => boolean;
  shouldReconcileResetProgress?: () => boolean;
}

export interface RestoreUndoSubdivisionPersistenceResult {
  updatedSnapshots: SavedSnapshot[];
  syncedSave: SavedSnapshot | undefined;
  restoredViewport: CoopViewport;
  nextResetEpoch: number;
  resetProgressMidUndo?: boolean;
}

export function revokeObjectUrlSafely(url: string | null | undefined): void {
  if (!url || !url.startsWith('blob:')) return;
  try {
    URL.revokeObjectURL(url);
  } catch (err) {
    reportSwallowed('InfiniteZoom.revokeObjectUrl', err);
  }
}

export function revokeUnusedObjectUrl(
  candidateUrl: string | null | undefined,
  activeUrl: string | null | undefined
): void {
  if (candidateUrl && candidateUrl !== activeUrl) {
    revokeObjectUrlSafely(candidateUrl);
  }
}

export function revokeOwnedUrlsNotIn(
  owned: Map<string, string>,
  keepKeys: ReadonlySet<string>
): void {
  for (const [key, url] of Array.from(owned.entries())) {
    if (!keepKeys.has(key)) {
      revokeObjectUrlSafely(url);
      owned.delete(key);
    }
  }
}

export function clearTimeoutBox(box: { current: ReturnType<typeof setTimeout> | null }): void {
  if (box.current !== null) {
    clearTimeout(box.current);
    box.current = null;
  }
}

export function abortControllerBox(box: { current: AbortController | null }): void {
  if (box.current) {
    box.current.abort();
    box.current = null;
  }
}

export function releaseCanvas(canvas: HTMLCanvasElement | null | undefined): void {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

export function createCanvasFromRgbaData(
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const imgData = ctx.createImageData(width, height);
    imgData.data.set(rgba);
    ctx.putImageData(imgData, 0, 0);
  }
  return canvas;
}

export function renderImageToCanvas(
  sourceImage: HTMLImageElement,
  targetWidth: number,
  targetHeight: number
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) || canvas.getContext('2d');
  if (ctx) {
    ctx.drawImage(sourceImage, 0, 0, targetWidth, targetHeight);
  }
  return canvas;
}

export function readCanvasCropRgba(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  width: number,
  height: number
): Uint8ClampedArray | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) || canvas.getContext('2d');
  if (!ctx || typeof ctx.getImageData !== 'function') return null;
  return ctx.getImageData(x, y, width, height).data;
}

export function canvasToBlobAsync(
  canvas: HTMLCanvasElement,
  mimeType: 'image/png' | 'image/webp',
  quality?: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        if (mimeType !== 'image/png') {
          canvas.toBlob((pngBlob) => {
            if (pngBlob) resolve(pngBlob);
            else reject(new Error('Failed to encode artwork canvas'));
          }, 'image/png');
          return;
        }
        reject(new Error('Failed to encode PNG canvas'));
      },
      mimeType,
      quality
    );
  });
}

export function decodeBlobToImage(
  blob: Blob
): Promise<{ img: HTMLImageElement; objectUrl: string }> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => resolve({ img, objectUrl });
    img.onerror = () => {
      revokeObjectUrlSafely(objectUrl);
      reject(new Error('Failed to decode generated artwork image'));
    };
    img.src = objectUrl;
  });
}

export async function encodeRgbaToBlob(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  mimeType: 'image/png' | 'image/webp',
  quality?: number
): Promise<Blob> {
  const canvas = createCanvasFromRgbaData(rgba, width, height);
  try {
    return await canvasToBlobAsync(canvas, mimeType, quality);
  } finally {
    releaseCanvas(canvas);
  }
}

export async function encodeImageToPuzzleBlob(
  baseImage: HTMLImageElement,
  basePuzzle: PuzzleData
): Promise<Blob> {
  const canvas = renderImageToCanvas(baseImage, basePuzzle.width, basePuzzle.height);
  try {
    const needsPng = hasCutoutExteriorMask(basePuzzle);
    return await canvasToBlobAsync(
      canvas,
      needsPng ? 'image/png' : 'image/webp',
      needsPng ? undefined : 0.94
    );
  } finally {
    releaseCanvas(canvas);
  }
}

export async function renderHydratedPreview(
  puzzle: PuzzleData,
  rootImage: HTMLImageElement,
  filled: Set<number>,
  painted: Map<number, number>,
  scope: string
): Promise<string> {
  const hydrated = await hydrateLayerImagesForPuzzle(puzzle, scope);
  try {
    return generatePreviewDataUrl(puzzle, rootImage, filled, painted, hydrated.layerImages);
  } finally {
    hydrated.dispose();
  }
}

/**
 * Resolves an HTMLCanvasElement for the target layer (root or nested) at exact grid dimensions.
 */
export async function renderLayerSourceToCanvas(
  basePuzzle: PuzzleData,
  baseImage: HTMLImageElement,
  targetLayerId: string | null,
  targetGrid: RegionGridLike,
  liveLayerImages: ReadonlyMap<string, HTMLImageElement>
): Promise<HTMLCanvasElement> {
  if (targetLayerId === null) {
    return renderImageToCanvas(baseImage, targetGrid.width, targetGrid.height);
  }
  const nestedLayer = basePuzzle.nestedLayers?.find((l) => l.layerId === targetLayerId);
  if (!nestedLayer) {
    return renderImageToCanvas(baseImage, targetGrid.width, targetGrid.height);
  }
  const liveImg = liveLayerImages.get(nestedLayer.imageBlobKey);
  if (liveImg && liveImg.complete && (liveImg.naturalWidth > 0 || liveImg.width > 0)) {
    return renderImageToCanvas(liveImg, targetGrid.width, targetGrid.height);
  }
  const blob = await StorageService.loadImageBlob(nestedLayer.imageBlobKey);
  if (!blob) {
    throw new Error('Could not load artwork for the selected detail layer.');
  }
  const { img, objectUrl } = await decodeBlobToImage(blob);
  try {
    return renderImageToCanvas(img, targetGrid.width, targetGrid.height);
  } finally {
    revokeObjectUrlSafely(objectUrl);
  }
}

export function collectMonotonicResetEpoch(
  snapshotId: string,
  activeSave: SavedSnapshot | undefined,
  liveActiveSave: SavedSnapshot | undefined
): number {
  const freshSnap = StorageService.loadSnapshots().find((s) => s.id === snapshotId);
  const storedActive = StorageService.loadActiveState();
  const activeStateEpoch =
    storedActive?.activeSnapshotId === snapshotId ? storedActive.resetEpoch ?? 0 : 0;
  return computeNextResetEpoch(
    activeSave?.resetEpoch,
    liveActiveSave?.resetEpoch,
    freshSnap?.resetEpoch,
    activeStateEpoch
  );
}

export function makeUniqueLayerId(prefix: string): string {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  const candidate = `${prefix}_${stamp}_${rand}`.replace(/[^a-zA-Z0-9._-]/g, '_');
  return isSafeLayerId(candidate) ? candidate : `layer_${stamp}_${rand}`;
}

export function makeUniqueRootBlobKey(snapId: string): string {
  const safeSnap = snapId
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.{2,}/g, '_')
    .slice(0, 64);
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  const candidate = `root_${safeSnap}_${stamp}_${rand}`;
  if (
    /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,255}$/.test(candidate) &&
    !candidate.includes('..') &&
    !candidate.startsWith('layer_') &&
    !candidate.startsWith('preview_')
  ) {
    return candidate;
  }
  return `root_${stamp}_${rand}`;
}

export function adjustSnapshotUndoCount(
  counts: Map<string, number>,
  snapshotId: string,
  delta: 1 | -1
): void {
  const next = (counts.get(snapshotId) ?? 0) + delta;
  if (next <= 0) {
    counts.delete(snapshotId);
  } else {
    counts.set(snapshotId, next);
  }
}

export function formatUndoInfiniteZoomErrorMessage(err: unknown): string {
  return err instanceof Error && err.message
    ? `Could not undo Infinite Zoom: ${err.message}`
    : 'Could not undo Infinite Zoom because storage is full.';
}

export function isSamplePromotionMeta(
  meta:
    | {
        sampleAssetPath?: string | null;
        sourceRef?: SavedSnapshot['sourceRef'];
      }
    | undefined
): boolean {
  return !meta || Boolean(meta.sampleAssetPath) || meta.sourceRef?.kind !== 'blob';
}

export function needsDedicatedRootBlobPromotion(
  meta:
    | {
        sampleAssetPath?: string | null;
        sourceRef?: SavedSnapshot['sourceRef'];
      }
    | undefined,
  snapId: string
): boolean {
  if (isSamplePromotionMeta(meta)) {
    return true;
  }
  const uri = meta?.sourceRef?.kind === 'blob' ? meta.sourceRef.uri?.trim() : '';
  return !uri || uri !== snapId;
}

export function buildZoomInZoomTreeMeta(
  existingSnap: SavedSnapshot | undefined,
  selectedCopy: ReadonlySet<number>,
  sanitizedPrompt: string,
  providerUsed: InfiniteZoomProviderMode,
  modelUsed: NanoBananaModelId
): InfiniteZoomNodeMeta {
  const prevTree = existingSnap?.zoomTree;
  return {
    ...(prevTree || { depth: 0, direction: 'in-place' }),
    direction: prevTree?.direction ?? 'in-place',
    selectedRegionIds: Array.from(selectedCopy),
    promptHint: sanitizedPrompt || undefined,
    providerUsed,
    modelUsed,
    inPlaceSubdivisionCount: (prevTree?.inPlaceSubdivisionCount ?? 0) + 1,
  };
}

export function buildZoomOutZoomTreeMeta(
  existingSnap: SavedSnapshot | undefined,
  sides: BorderExtensionSides,
  sanitizedPrompt: string,
  providerUsed: InfiniteZoomProviderMode,
  modelUsed: NanoBananaModelId
): InfiniteZoomNodeMeta {
  return {
    ...(existingSnap?.zoomTree || { depth: 0, direction: 'extend-out' }),
    direction: 'extend-out',
    extendedSides: { ...sides },
    promptHint: sanitizedPrompt || undefined,
    providerUsed,
    modelUsed,
  };
}

export function buildPreviousSnapshotMeta(
  existingSnap: SavedSnapshot | undefined
): PreviousSnapshotMeta {
  return {
    sampleAssetPath: existingSnap?.sampleAssetPath,
    isAutoSample: existingSnap?.isAutoSample,
    sourceRef: existingSnap?.sourceRef,
    zoomTree: existingSnap?.zoomTree,
    previewDataUrl: existingSnap?.previewDataUrl,
  };
}

/**
 * Pure helper resolving the most recent live child snapshot for legacy TopBar zoom-tree navigation.
 */
export function resolveLatestChildSave(
  snapshots: readonly SavedSnapshot[],
  activeSave: SavedSnapshot | undefined,
  activeSnapshotId: string | null
): SavedSnapshot | null {
  if (!activeSnapshotId) return null;
  const byId = new Map<string, SavedSnapshot>();
  for (const snap of snapshots) {
    byId.set(snap.id, snap);
  }
  const childIds = activeSave?.zoomTree?.childSnapshotIds;
  if (childIds && childIds.length > 0) {
    for (let i = childIds.length - 1; i >= 0; i--) {
      const candidate = byId.get(childIds[i]);
      if (candidate && candidate.id !== activeSnapshotId) {
        return candidate;
      }
    }
  }
  let fallback: SavedSnapshot | null = null;
  for (const snap of snapshots) {
    if (snap.parentSnapshotId === activeSnapshotId && snap.id !== activeSnapshotId) {
      if (!fallback || snap.lastOpened >= fallback.lastOpened) {
        fallback = snap;
      }
    }
  }
  return fallback;
}

function isBlobKeyProtectedBySurvivingSnapshots(blobKey: string): boolean {
  return StorageService.loadSnapshots().some(
    (s) =>
      s.id === blobKey || (s.sourceRef?.kind === 'blob' && s.sourceRef.uri?.trim() === blobKey)
  );
}

function isBlobKeySharedByOtherSnapshots(blobKey: string, ownerSnapshotId: string): boolean {
  return StorageService.loadSnapshots().some(
    (s) =>
      s.id !== ownerSnapshotId &&
      (s.id === blobKey || (s.sourceRef?.kind === 'blob' && s.sourceRef.uri?.trim() === blobKey))
  );
}

export function resolveRootBlobPersistencePlan(
  existingSnap: SavedSnapshot | undefined,
  snapId: string,
  operationKind: 'zoom-in' | 'zoom-out'
): RootBlobPersistencePlan {
  const isPromotion = needsDedicatedRootBlobPromotion(existingSnap, snapId);
  const snapIdSharedBySiblings = isBlobKeySharedByOtherSnapshots(snapId, snapId);

  if (!isPromotion && !snapIdSharedBySiblings) {
    return {
      targetRootBlobKey: snapId,
      needsRootMaterialization: false,
      ownedPreviousRootBlobKey: snapId,
    };
  }

  if (!isPromotion && operationKind === 'zoom-in') {
    // Sibling-shared root blob on Zoom In: root artwork is not modified, so keep sourceRef intact
    // and never overwrite or delete the shared root blob.
    return {
      targetRootBlobKey: snapId,
      needsRootMaterialization: false,
      ownedPreviousRootBlobKey: null,
    };
  }

  const targetRootBlobKey = snapIdSharedBySiblings ? makeUniqueRootBlobKey(snapId) : snapId;
  return {
    targetRootBlobKey,
    addedRootBlobKey: targetRootBlobKey,
    needsRootMaterialization: true,
    ownedPreviousRootBlobKey: null,
  };
}

export async function loadPreviousRootBlobIfOwned(
  existingSnap: SavedSnapshot | undefined,
  snapId: string
): Promise<Blob | null> {
  if (needsDedicatedRootBlobPromotion(existingSnap, snapId)) {
    return null;
  }
  if (isBlobKeySharedByOtherSnapshots(snapId, snapId)) {
    return null;
  }
  return await StorageService.loadImageBlob(snapId).catch(() => null);
}

export async function rollbackAbortedLayerPersist(
  opts: RollbackAbortedLayerPersistOpts
): Promise<void> {
  if (opts.newRootBlobUrl) {
    revokeObjectUrlSafely(opts.newRootBlobUrl);
  }
  if (opts.newLayerObjectUrls) {
    for (const url of opts.newLayerObjectUrls) {
      revokeObjectUrlSafely(url);
    }
  }
  if (!findStoredSnapshotById(opts.snapId)) {
    const imageKeys = new Set<string>();
    for (const key of opts.addedLayerBlobKeys) {
      if (!isBlobKeyProtectedBySurvivingSnapshots(key)) {
        imageKeys.add(key);
      }
    }
    if (opts.addedRootBlobKey && !isBlobKeyProtectedBySurvivingSnapshots(opts.addedRootBlobKey)) {
      imageKeys.add(opts.addedRootBlobKey);
    }
    if (!isBlobKeyProtectedBySurvivingSnapshots(opts.snapId)) {
      imageKeys.add(opts.snapId);
    }
    await deleteOrphanedEntries([opts.snapId], Array.from(imageKeys)).catch((err) => {
      reportSwallowed('InfiniteZoom.rollbackCleanupDeletedSnapshot', err, { id: opts.snapId });
    });
    return;
  }
  const candidateRootDeleteKey = opts.addedRootBlobKey ?? opts.snapId;
  const deleteAddedRoot =
    !opts.previousRootBlob &&
    Boolean(opts.addedRootBlobKey || opts.promotedFromSample) &&
    !isBlobKeySharedByOtherSnapshots(candidateRootDeleteKey, opts.snapId);
  const keysToDelete =
    deleteAddedRoot && !opts.addedLayerBlobKeys.includes(candidateRootDeleteKey)
      ? [...opts.addedLayerBlobKeys, candidateRootDeleteKey]
      : opts.addedLayerBlobKeys;
  if (keysToDelete.length > 0) {
    await deleteOrphanedEntries([], keysToDelete).catch((err) => {
      reportSwallowed('InfiniteZoom.rollbackDeleteLayerBlobs', err, { id: opts.snapId });
    });
  }
  if (opts.previousRootBlob) {
    await StorageService.saveImageBlob(opts.snapId, opts.previousRootBlob).catch((err) => {
      reportSwallowed('InfiniteZoom.rollbackImageBlob', err, { id: opts.snapId });
    });
  }
  if (opts.basePuzzle) {
    await StorageService.savePuzzleData(opts.snapId, opts.basePuzzle).catch((err) => {
      reportSwallowed('InfiniteZoom.rollbackPuzzleData', err, { id: opts.snapId });
    });
  }
}

function resolvePersistZoomInTargets(opts: PersistZoomInBlobsOpts): {
  needsRootMaterialization: boolean;
  targetRootBlobKey: string;
  effectiveAddedRootBlobKey: string | undefined;
  effectivePromoted: boolean;
} {
  const needsRootMaterialization =
    Boolean(opts.addedRootBlobKey) ||
    needsDedicatedRootBlobPromotion(opts.existingSnap, opts.snapId);
  const targetRootBlobKey =
    opts.rootImageBlobKey ??
    (needsRootMaterialization && isBlobKeySharedByOtherSnapshots(opts.snapId, opts.snapId)
      ? makeUniqueRootBlobKey(opts.snapId)
      : opts.snapId);
  return {
    needsRootMaterialization,
    targetRootBlobKey,
    effectiveAddedRootBlobKey:
      opts.addedRootBlobKey ?? (needsRootMaterialization ? targetRootBlobKey : undefined),
    effectivePromoted: opts.promotedFromSample || needsRootMaterialization,
  };
}

export async function persistZoomInBlobsAndPuzzle(opts: PersistZoomInBlobsOpts): Promise<boolean> {
  const {
    snapId,
    basePuzzle,
    baseImage,
    nextPuzzle,
    imageBlobKey,
    layerPngBlob,
    layerObjectUrl,
    isAborted,
  } = opts;
  const {
    needsRootMaterialization,
    targetRootBlobKey,
    effectiveAddedRootBlobKey,
    effectivePromoted,
  } = resolvePersistZoomInTargets(opts);
  let wroteRootBlob = false;
  let wroteLayerBlob = false;

  const rollback = (restoreBasePuzzle: boolean) =>
    rollbackAbortedLayerPersist({
      snapId,
      addedLayerBlobKeys: wroteLayerBlob ? [imageBlobKey] : [],
      addedRootBlobKey: wroteRootBlob ? effectiveAddedRootBlobKey : undefined,
      newLayerObjectUrls: [layerObjectUrl],
      promotedFromSample: wroteRootBlob && effectivePromoted,
      ...(restoreBasePuzzle ? { basePuzzle } : {}),
    });

  try {
    if (needsRootMaterialization) {
      const rootBlob = await encodeImageToPuzzleBlob(baseImage, basePuzzle);
      if (isAborted()) {
        revokeObjectUrlSafely(layerObjectUrl);
        return false;
      }
      await StorageService.saveImageBlob(targetRootBlobKey, rootBlob);
      wroteRootBlob = true;
      if (isAborted()) {
        await rollback(false);
        return false;
      }
    }

    await StorageService.saveImageBlob(imageBlobKey, layerPngBlob);
    wroteLayerBlob = true;
    if (isAborted()) {
      await rollback(false);
      return false;
    }

    await StorageService.savePuzzleData(snapId, nextPuzzle);
    if (isAborted()) {
      await rollback(true);
      return false;
    }
    return true;
  } catch (err) {
    if (wroteRootBlob || wroteLayerBlob) {
      await rollback(false);
    } else {
      revokeObjectUrlSafely(layerObjectUrl);
    }
    throw err;
  }
}

export async function persistZoomOutBlobsAndPuzzle(opts: PersistZoomOutBlobsOpts): Promise<boolean> {
  const {
    snapId,
    basePuzzle,
    nextPuzzle,
    previousRootImageBlobKey,
    previousRootLayerBlob,
    outerBlob,
    previousRootBlob,
    promotedFromSample,
    rootImageBlobKey,
    addedRootBlobKey,
    outerObjUrl,
    prevRootObjUrl,
    isAborted,
  } = opts;
  const targetRootBlobKey =
    rootImageBlobKey ??
    (isBlobKeySharedByOtherSnapshots(snapId, snapId) ? makeUniqueRootBlobKey(snapId) : snapId);
  const effectiveAddedRootBlobKey =
    addedRootBlobKey ?? (targetRootBlobKey !== snapId ? targetRootBlobKey : undefined);
  const effectivePreviousRootBlob = effectiveAddedRootBlobKey ? null : previousRootBlob;
  let wroteDemotedCenterBlob = false;
  let wroteOuterRootBlob = false;

  try {
    await StorageService.saveImageBlob(previousRootImageBlobKey, previousRootLayerBlob);
    wroteDemotedCenterBlob = true;
    if (isAborted()) {
      await rollbackAbortedLayerPersist({
        snapId,
        addedLayerBlobKeys: [previousRootImageBlobKey],
        newRootBlobUrl: outerObjUrl,
        newLayerObjectUrls: [prevRootObjUrl],
      });
      return false;
    }

    await StorageService.saveImageBlob(targetRootBlobKey, outerBlob);
    wroteOuterRootBlob = true;
    if (isAborted()) {
      await rollbackAbortedLayerPersist({
        snapId,
        addedLayerBlobKeys: [previousRootImageBlobKey],
        addedRootBlobKey: effectiveAddedRootBlobKey,
        newRootBlobUrl: outerObjUrl,
        newLayerObjectUrls: [prevRootObjUrl],
        previousRootBlob: effectivePreviousRootBlob,
        promotedFromSample,
      });
      return false;
    }

    await StorageService.savePuzzleData(snapId, nextPuzzle);
    if (isAborted()) {
      await rollbackAbortedLayerPersist({
        snapId,
        addedLayerBlobKeys: [previousRootImageBlobKey],
        addedRootBlobKey: effectiveAddedRootBlobKey,
        newRootBlobUrl: outerObjUrl,
        newLayerObjectUrls: [prevRootObjUrl],
        previousRootBlob: effectivePreviousRootBlob,
        promotedFromSample,
        basePuzzle,
      });
      return false;
    }
    return true;
  } catch (err) {
    if (wroteDemotedCenterBlob || wroteOuterRootBlob) {
      await rollbackAbortedLayerPersist({
        snapId,
        addedLayerBlobKeys: wroteDemotedCenterBlob ? [previousRootImageBlobKey] : [],
        addedRootBlobKey: wroteOuterRootBlob ? effectiveAddedRootBlobKey : undefined,
        newRootBlobUrl: outerObjUrl,
        newLayerObjectUrls: [prevRootObjUrl],
        previousRootBlob: wroteOuterRootBlob ? effectivePreviousRootBlob : undefined,
        promotedFromSample: wroteOuterRootBlob ? promotedFromSample : false,
      });
    } else {
      revokeObjectUrlSafely(outerObjUrl);
      revokeObjectUrlSafely(prevRootObjUrl);
    }
    throw err;
  }
}

export function commitZoomInStorageState(
  params: ZoomInStorageCommitParams
): ZoomInStorageCommitResult {
  const {
    snapId,
    existingSnap,
    liveActiveSave,
    currentActiveSave,
    nextPuzzle,
    nextFilled,
    nextPainted,
    nextActiveColorId,
    selectedCopy,
    sanitizedPrompt,
    providerUsed,
    modelUsed,
    removedFilledCount,
    previewUrl,
    isFree,
    viewport,
    rootImageBlobKey,
  } = params;

  const nextZoomTree = buildZoomInZoomTreeMeta(
    existingSnap,
    selectedCopy,
    sanitizedPrompt,
    providerUsed,
    modelUsed
  );
  const nextResetEpoch =
    removedFilledCount > 0
      ? collectMonotonicResetEpoch(snapId, liveActiveSave, currentActiveSave)
      : undefined;
  const totalRegions = getTotalRegionCount(nextPuzzle);
  const estSaveBytes = StorageService.estimatePuzzleSaveBytes(nextPuzzle, previewUrl);
  const orderedFilled = Array.from(nextFilled);
  const paintedObj = Object.fromEntries(nextPainted);
  const { zoomScale, panOffsetX, panOffsetY } = viewport;

  StorageService.updateSnapshotMetadata(snapId, {
    sampleAssetPath: null,
    isAutoSample: false,
    sourceRef: { kind: 'blob', uri: rootImageBlobKey ?? snapId },
    zoomTree: nextZoomTree,
  });
  const updatedSnapshots = StorageService.updateSnapshotProgress(
    snapId,
    nextFilled.size,
    totalRegions,
    orderedFilled,
    zoomScale,
    panOffsetX,
    panOffsetY,
    previewUrl,
    paintedObj,
    nextPuzzle.palette,
    isFree,
    estSaveBytes,
    nextResetEpoch
  );
  const syncedSave = updatedSnapshots.find((s) => s.id === snapId);
  StorageService.saveActiveState({
    activeSnapshotId: snapId,
    activeColorId: nextActiveColorId,
    filledRegionIds: orderedFilled,
    paintedRegionColors: paintedObj,
    isFreeColorMode: isFree,
    ...(nextResetEpoch !== undefined ? { resetEpoch: nextResetEpoch } : {}),
    zoomScale,
    panOffsetX,
    panOffsetY,
  });

  return { updatedSnapshots, syncedSave, nextResetEpoch };
}

export function commitZoomOutStorageState(
  params: ZoomOutStorageCommitParams
): ZoomOutStorageCommitResult {
  const {
    snapId,
    existingSnap,
    nextPuzzle,
    preservedFilled,
    preservedPainted,
    nextActiveColorId,
    sides,
    sanitizedPrompt,
    providerUsed,
    modelUsed,
    previewUrl,
    isFree,
    rootImageBlobKey,
  } = params;

  const nextZoomTree = buildZoomOutZoomTreeMeta(
    existingSnap,
    sides,
    sanitizedPrompt,
    providerUsed,
    modelUsed
  );
  const fittedViewport: CoopViewport = { zoomScale: 1, panOffsetX: 0, panOffsetY: 0 };
  const totalRegions = getTotalRegionCount(nextPuzzle);
  const estSaveBytes = StorageService.estimatePuzzleSaveBytes(nextPuzzle, previewUrl);
  const orderedFilled = Array.from(preservedFilled);
  const paintedObj = Object.fromEntries(preservedPainted);

  StorageService.updateSnapshotMetadata(snapId, {
    sampleAssetPath: null,
    isAutoSample: false,
    sourceRef: { kind: 'blob', uri: rootImageBlobKey ?? snapId },
    zoomTree: nextZoomTree,
  });
  const updatedSnapshots = StorageService.updateSnapshotProgress(
    snapId,
    preservedFilled.size,
    totalRegions,
    orderedFilled,
    fittedViewport.zoomScale,
    fittedViewport.panOffsetX,
    fittedViewport.panOffsetY,
    previewUrl,
    paintedObj,
    nextPuzzle.palette,
    isFree,
    estSaveBytes
  );
  const syncedSave = updatedSnapshots.find((s) => s.id === snapId);
  StorageService.saveActiveState({
    activeSnapshotId: snapId,
    activeColorId: nextActiveColorId,
    filledRegionIds: orderedFilled,
    paintedRegionColors: paintedObj,
    isFreeColorMode: isFree,
    zoomScale: fittedViewport.zoomScale,
    panOffsetX: fittedViewport.panOffsetX,
    panOffsetY: fittedViewport.panOffsetY,
  });

  return { updatedSnapshots, syncedSave, fittedViewport };
}

function findStoredSnapshotById(snapshotId: string): SavedSnapshot | undefined {
  return StorageService.loadSnapshots().find((s) => s.id === snapshotId);
}

function resolvePreUndoResetEpoch(
  expectedSnapshotId: string,
  storedSnap: SavedSnapshot,
  activeSave: SavedSnapshot | undefined,
  liveActiveSave: SavedSnapshot | undefined
): number {
  return Math.max(
    0,
    storedSnap.resetEpoch ?? 0,
    activeSave?.id === expectedSnapshotId ? activeSave.resetEpoch ?? 0 : 0,
    liveActiveSave?.id === expectedSnapshotId ? liveActiveSave.resetEpoch ?? 0 : 0
  );
}

async function cleanupDeletedSnapshotUndoRecords(
  expectedSnapshotId: string,
  keysToDelete: readonly string[]
): Promise<void> {
  const imageKeys = new Set<string>();
  for (const key of keysToDelete) {
    if (!isBlobKeyProtectedBySurvivingSnapshots(key)) {
      imageKeys.add(key);
    }
  }
  if (!isBlobKeyProtectedBySurvivingSnapshots(expectedSnapshotId)) {
    imageKeys.add(expectedSnapshotId);
  }
  await deleteOrphanedEntries([expectedSnapshotId], Array.from(imageKeys)).catch((err) => {
    reportSwallowed('InfiniteZoom.undoCleanupDeletedSnapshot', err, { id: expectedSnapshotId });
  });
}

async function restoreUndoIdbEntries(
  expectedSnapshotId: string,
  snap: UndoInfiniteZoomSnapshot,
  keysToDelete: string[],
  isStale: () => boolean
): Promise<boolean> {
  let preUndoRootBlob: Blob | null = null;
  let overwroteRootBlob = false;
  if (snap.previousBlob) {
    preUndoRootBlob = await StorageService.loadImageBlob(expectedSnapshotId).catch(() => null);
    if (isStale() || !findStoredSnapshotById(expectedSnapshotId)) {
      return false;
    }
    await StorageService.saveImageBlob(expectedSnapshotId, snap.previousBlob);
    overwroteRootBlob = true;
    if (!findStoredSnapshotById(expectedSnapshotId)) {
      await cleanupDeletedSnapshotUndoRecords(expectedSnapshotId, keysToDelete);
      return false;
    }
  }

  try {
    await StorageService.savePuzzleData(expectedSnapshotId, snap.puzzle);
  } catch (err) {
    if (overwroteRootBlob) {
      if (findStoredSnapshotById(expectedSnapshotId)) {
        if (preUndoRootBlob) {
          await StorageService.saveImageBlob(expectedSnapshotId, preUndoRootBlob).catch(
            (restoreErr) => {
              reportSwallowed('InfiniteZoom.undoRollbackRootBlob', restoreErr, {
                id: expectedSnapshotId,
              });
            }
          );
        }
      } else {
        await cleanupDeletedSnapshotUndoRecords(expectedSnapshotId, keysToDelete);
      }
    }
    throw err;
  }

  if (!findStoredSnapshotById(expectedSnapshotId)) {
    await cleanupDeletedSnapshotUndoRecords(expectedSnapshotId, keysToDelete);
    return false;
  }

  if (keysToDelete.length > 0) {
    await deleteOrphanedEntries([], keysToDelete).catch((err) => {
      reportSwallowed('InfiniteZoom.undoDeleteLayerBlobs', err, { id: expectedSnapshotId });
    });
  }
  return true;
}

export async function restoreUndoSubdivisionPersistence(
  params: RestoreUndoSubdivisionPersistenceParams
): Promise<RestoreUndoSubdivisionPersistenceResult | null> {
  const {
    snap,
    isFreeColorMode,
    activeSave,
    liveActiveSave,
    isStale,
    shouldReconcileResetProgress,
  } = params;
  if (isStale()) return null;
  const expectedSnapshotId = snap.snapshotId;
  const initialStoredSnap = findStoredSnapshotById(expectedSnapshotId);
  if (!initialStoredSnap) return null;
  const preUndoResetEpoch = resolvePreUndoResetEpoch(
    expectedSnapshotId,
    initialStoredSnap,
    activeSave,
    liveActiveSave
  );

  const isDedicatedPromotion =
    !snap.previousBlob &&
    Boolean(
      snap.addedRootBlobKey ||
        snap.promotedFromSample ||
        needsDedicatedRootBlobPromotion(snap.previousMeta, expectedSnapshotId)
    );
  const candidateRootDeleteKey = snap.addedRootBlobKey ?? expectedSnapshotId;
  const shouldDeleteAddedRoot =
    isDedicatedPromotion &&
    !isBlobKeySharedByOtherSnapshots(candidateRootDeleteKey, expectedSnapshotId);
  const keysToDelete =
    shouldDeleteAddedRoot && !snap.addedLayerBlobKeys.includes(candidateRootDeleteKey)
      ? [...snap.addedLayerBlobKeys, candidateRootDeleteKey]
      : [...snap.addedLayerBlobKeys];

  // Restore previous root blob and puzzle BEFORE deleting orphaned/added layer blobs so a
  // concurrent snapshot switch or IDB write failure can never destroy referenced blobs or commit
  // inconsistent localStorage state.
  const restoredIdb = await restoreUndoIdbEntries(
    expectedSnapshotId,
    snap,
    keysToDelete,
    isStale
  );
  if (!restoredIdb) return null;

  const isFree = Boolean(isFreeColorMode || snap.puzzle.isFreeColor);
  // Restore pre-operation viewport symmetrically for BOTH zoom-in (reversing auto-focus) and zoom-out
  const restoredViewport = snap.previousViewport;
  const totalRegions = getTotalRegionCount(snap.puzzle);

  let previewUrl = snap.previousMeta.previewDataUrl;
  if (!previewUrl && !isStale()) {
    previewUrl = await renderHydratedPreview(
      snap.puzzle,
      snap.sourceImage,
      snap.filledRegionIds,
      snap.paintedRegionColors,
      'InfiniteZoom.undoPreview'
    );
  }

  const currentStoredSnap = findStoredSnapshotById(expectedSnapshotId);
  if (!currentStoredSnap) {
    await cleanupDeletedSnapshotUndoRecords(expectedSnapshotId, keysToDelete);
    return null;
  }

  const currentResetEpoch = currentStoredSnap.resetEpoch ?? 0;
  const resetProgressMidUndo = isStale() && currentResetEpoch > preUndoResetEpoch;
  const nextResetEpoch = resetProgressMidUndo
    ? currentResetEpoch
    : collectMonotonicResetEpoch(expectedSnapshotId, activeSave, liveActiveSave);
  const orderedFilled = resetProgressMidUndo ? [] : Array.from(snap.filledRegionIds);
  const paintedObj = resetProgressMidUndo ? {} : Object.fromEntries(snap.paintedRegionColors);
  const estSaveBytes = StorageService.estimatePuzzleSaveBytes(snap.puzzle, previewUrl);

  StorageService.updateSnapshotMetadata(expectedSnapshotId, {
    sampleAssetPath: snap.previousMeta.sampleAssetPath,
    isAutoSample: snap.previousMeta.isAutoSample,
    sourceRef: snap.previousMeta.sourceRef,
    zoomTree: snap.previousMeta.zoomTree,
    previewDataUrl: snap.previousMeta.previewDataUrl,
  });
  const updatedSnapshots = StorageService.updateSnapshotProgress(
    expectedSnapshotId,
    orderedFilled.length,
    totalRegions,
    orderedFilled,
    restoredViewport.zoomScale,
    restoredViewport.panOffsetX,
    restoredViewport.panOffsetY,
    previewUrl,
    paintedObj,
    snap.puzzle.palette,
    isFree,
    estSaveBytes,
    nextResetEpoch
  );

  const reconcileResetProgress =
    resetProgressMidUndo && Boolean(shouldReconcileResetProgress?.());

  // Only skip overwriting active session state & live UI when another puzzle/op superseded us.
  if (isStale() && !reconcileResetProgress) {
    return null;
  }

  const syncedSave = updatedSnapshots.find((s) => s.id === expectedSnapshotId);

  StorageService.saveActiveState({
    activeSnapshotId: expectedSnapshotId,
    activeColorId: snap.activeColorId,
    filledRegionIds: orderedFilled,
    paintedRegionColors: paintedObj,
    isFreeColorMode: isFree,
    resetEpoch: nextResetEpoch,
    zoomScale: restoredViewport.zoomScale,
    panOffsetX: restoredViewport.panOffsetX,
    panOffsetY: restoredViewport.panOffsetY,
  });

  return {
    updatedSnapshots,
    syncedSave,
    restoredViewport,
    nextResetEpoch,
    ...(reconcileResetProgress ? { resetProgressMidUndo: true } : {}),
  };
}
