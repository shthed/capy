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

export interface RollbackAbortedLayerPersistOpts {
  snapId: string;
  addedLayerBlobKeys: string[];
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
}

export interface RestoreUndoSubdivisionPersistenceResult {
  updatedSnapshots: SavedSnapshot[];
  syncedSave: SavedSnapshot | undefined;
  restoredViewport: CoopViewport;
  nextResetEpoch: number;
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

export async function loadPreviousRootBlobIfOwned(
  existingSnap: SavedSnapshot | undefined,
  snapId: string
): Promise<Blob | null> {
  if (!existingSnap || existingSnap.sampleAssetPath || existingSnap.sourceRef?.kind !== 'blob') {
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
  const keysToDelete =
    !opts.previousRootBlob && opts.promotedFromSample
      ? [...opts.addedLayerBlobKeys, opts.snapId]
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

export async function persistZoomInBlobsAndPuzzle(opts: PersistZoomInBlobsOpts): Promise<boolean> {
  const {
    snapId,
    existingSnap,
    basePuzzle,
    baseImage,
    nextPuzzle,
    imageBlobKey,
    layerPngBlob,
    layerObjectUrl,
    promotedFromSample,
    isAborted,
  } = opts;
  const needsSamplePromotion = isSamplePromotionMeta(existingSnap);
  if (needsSamplePromotion) {
    const rootBlob = await encodeImageToPuzzleBlob(baseImage, basePuzzle);
    if (isAborted()) {
      revokeObjectUrlSafely(layerObjectUrl);
      return false;
    }
    await StorageService.saveImageBlob(snapId, rootBlob).catch((err) => {
      reportSwallowed('InfiniteZoom.promoteSampleRootBlob', err, { id: snapId });
    });
    if (isAborted()) {
      await rollbackAbortedLayerPersist({
        snapId,
        addedLayerBlobKeys: [],
        newLayerObjectUrls: [layerObjectUrl],
        promotedFromSample,
      });
      return false;
    }
  }

  await StorageService.saveImageBlob(imageBlobKey, layerPngBlob).catch((err) => {
    reportSwallowed('InfiniteZoom.saveLayerImageBlob', err, { id: snapId, key: imageBlobKey });
  });
  if (isAborted()) {
    await rollbackAbortedLayerPersist({
      snapId,
      addedLayerBlobKeys: [imageBlobKey],
      newLayerObjectUrls: [layerObjectUrl],
      promotedFromSample,
    });
    return false;
  }

  await StorageService.savePuzzleData(snapId, nextPuzzle).catch((err) => {
    reportSwallowed('InfiniteZoom.savePuzzleData', err, { id: snapId });
  });
  if (isAborted()) {
    await rollbackAbortedLayerPersist({
      snapId,
      addedLayerBlobKeys: [imageBlobKey],
      newLayerObjectUrls: [layerObjectUrl],
      promotedFromSample,
      basePuzzle,
    });
    return false;
  }
  return true;
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
    outerObjUrl,
    prevRootObjUrl,
    isAborted,
  } = opts;

  await StorageService.saveImageBlob(previousRootImageBlobKey, previousRootLayerBlob).catch(
    (err) => {
      reportSwallowed('InfiniteZoom.saveDemotedRootLayerBlob', err, {
        id: snapId,
        key: previousRootImageBlobKey,
      });
    }
  );
  if (isAborted()) {
    await rollbackAbortedLayerPersist({
      snapId,
      addedLayerBlobKeys: [previousRootImageBlobKey],
      newRootBlobUrl: outerObjUrl,
      newLayerObjectUrls: [prevRootObjUrl],
    });
    return false;
  }

  await StorageService.saveImageBlob(snapId, outerBlob).catch((err) => {
    reportSwallowed('InfiniteZoom.saveOuterRootBlob', err, { id: snapId });
  });
  if (isAborted()) {
    await rollbackAbortedLayerPersist({
      snapId,
      addedLayerBlobKeys: [previousRootImageBlobKey],
      newRootBlobUrl: outerObjUrl,
      newLayerObjectUrls: [prevRootObjUrl],
      previousRootBlob,
      promotedFromSample,
    });
    return false;
  }

  await StorageService.savePuzzleData(snapId, nextPuzzle).catch((err) => {
    reportSwallowed('InfiniteZoom.saveWrappedPuzzleData', err, { id: snapId });
  });
  if (isAborted()) {
    await rollbackAbortedLayerPersist({
      snapId,
      addedLayerBlobKeys: [previousRootImageBlobKey],
      newRootBlobUrl: outerObjUrl,
      newLayerObjectUrls: [prevRootObjUrl],
      previousRootBlob,
      promotedFromSample,
      basePuzzle,
    });
    return false;
  }
  return true;
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
    sourceRef: { kind: 'blob', uri: snapId },
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
    sourceRef: { kind: 'blob', uri: snapId },
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

export async function restoreUndoSubdivisionPersistence(
  params: RestoreUndoSubdivisionPersistenceParams
): Promise<RestoreUndoSubdivisionPersistenceResult | null> {
  const { snap, isFreeColorMode, activeSave, liveActiveSave, isStale } = params;
  const expectedSnapshotId = snap.snapshotId;

  const isPromotedSample =
    !snap.previousBlob &&
    Boolean(
      snap.promotedFromSample ??
        (snap.previousMeta.sampleAssetPath || snap.previousMeta.sourceRef?.kind !== 'blob')
    );
  const keysToDelete = isPromotedSample
    ? [...snap.addedLayerBlobKeys, expectedSnapshotId]
    : snap.addedLayerBlobKeys;

  if (keysToDelete.length > 0) {
    await deleteOrphanedEntries([], keysToDelete).catch((err) => {
      reportSwallowed('InfiniteZoom.undoDeleteLayerBlobs', err, { id: expectedSnapshotId });
    });
    if (isStale()) return null;
  }

  if (snap.previousBlob) {
    await StorageService.saveImageBlob(expectedSnapshotId, snap.previousBlob).catch((err) => {
      reportSwallowed('InfiniteZoom.undoSaveImageBlob', err, { id: expectedSnapshotId });
    });
    if (isStale()) return null;
  }

  await StorageService.savePuzzleData(expectedSnapshotId, snap.puzzle).catch((err) => {
    reportSwallowed('InfiniteZoom.undoSavePuzzleData', err, { id: expectedSnapshotId });
  });
  if (isStale()) return null;

  const isFree = Boolean(isFreeColorMode || snap.puzzle.isFreeColor);
  const nextResetEpoch = collectMonotonicResetEpoch(expectedSnapshotId, activeSave, liveActiveSave);
  const orderedFilled = Array.from(snap.filledRegionIds);
  const paintedObj = Object.fromEntries(snap.paintedRegionColors);
  // Restore pre-operation viewport symmetrically for BOTH zoom-in (reversing auto-focus) and zoom-out
  const restoredViewport = snap.previousViewport;
  const totalRegions = getTotalRegionCount(snap.puzzle);

  let previewUrl = snap.previousMeta.previewDataUrl;
  if (!previewUrl) {
    previewUrl = await renderHydratedPreview(
      snap.puzzle,
      snap.sourceImage,
      snap.filledRegionIds,
      snap.paintedRegionColors,
      'InfiniteZoom.undoPreview'
    );
    if (isStale()) return null;
  }

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
    snap.filledRegionIds.size,
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
  };
}
