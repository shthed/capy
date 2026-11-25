import {
  BorderExtensionSides,
  InfiniteZoomNodeMeta,
  InfiniteZoomProviderMode,
  NanoBananaModelId,
  NestedPuzzleLayer,
  PuzzleData,
  SavedSnapshot,
} from '../types';
import { StorageService } from '../services/StorageService';
import { deleteOrphanedEntries } from '../services/storage/IndexedDbStore';
import { getTotalRegionCount, isSafeLayerId } from '../engine/UnifiedPuzzleLayers';
import { generatePreviewDataUrl, hasCutoutExteriorMask } from '../services/artworkExporter';
import { reportSwallowed } from '../services/telemetry';
import type { RegionGridLike, SelectionBbox } from '../services/ai/RegionSelectionEngine';
import { INFILL_CONTEXT_PAD_RATIO } from '../services/ai/SeamCompositor';
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
  previousRootBlobKey?: string;
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
  previousRootBlobKey?: string | null;
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
  previousRootBlobKey?: string | null;
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
  shouldReconcileActiveSnapshot?: () => boolean;
  shouldReconcileResetProgress?: () => boolean;
}

export interface RestoreUndoSubdivisionPersistenceResult {
  updatedSnapshots: SavedSnapshot[];
  syncedSave: SavedSnapshot | undefined;
  restoredViewport: CoopViewport;
  nextResetEpoch: number;
  resetProgressMidUndo?: boolean;
  reconciledStaleActiveSnapshot?: boolean;
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

export interface WorldContextTemplateBounds {
  ctxMinX: number;
  ctxMinY: number;
  templateWidth: number;
  templateHeight: number;
  ctxWorldX: number;
  ctxWorldY: number;
  ctxWorldW: number;
  ctxWorldH: number;
  bboxInCanvas: SelectionBbox;
}

export interface WorldContextCanvasResult {
  canvas: HTMLCanvasElement;
  bboxInCanvas: SelectionBbox;
  padApplied: boolean;
}

export function computeWorldContextTemplateBounds(
  nestedLayer: Pick<NestedPuzzleLayer, 'worldBounds'>,
  targetGridWidth: number,
  targetGridHeight: number,
  bbox: SelectionBbox,
  contextPadRatio: number = INFILL_CONTEXT_PAD_RATIO
): WorldContextTemplateBounds | null {
  const wb = nestedLayer.worldBounds;
  if (
    !wb ||
    !Number.isFinite(wb.x) ||
    !Number.isFinite(wb.y) ||
    !Number.isFinite(wb.width) ||
    !Number.isFinite(wb.height) ||
    wb.width <= 0 ||
    wb.height <= 0 ||
    targetGridWidth <= 0 ||
    targetGridHeight <= 0
  ) {
    return null;
  }
  const safePad = Number.isFinite(contextPadRatio) && contextPadRatio >= 0 ? contextPadRatio : 0;
  const padX = safePad > 0 ? Math.max(1, Math.round(bbox.width * safePad)) : 0;
  const padY = safePad > 0 ? Math.max(1, Math.round(bbox.height * safePad)) : 0;

  const availLeft = Math.max(0, Math.floor((wb.x / wb.width) * targetGridWidth));
  const availTop = Math.max(0, Math.floor((wb.y / wb.height) * targetGridHeight));
  const availRight = Math.max(0, Math.floor(((1 - wb.x - wb.width) / wb.width) * targetGridWidth));
  const availBottom = Math.max(
    0,
    Math.floor(((1 - wb.y - wb.height) / wb.height) * targetGridHeight)
  );

  const ctxMinX = Math.max(-availLeft, bbox.minX - padX);
  const ctxMinY = Math.max(-availTop, bbox.minY - padY);
  const ctxMaxX = Math.min(targetGridWidth - 1 + availRight, bbox.maxX + padX);
  const ctxMaxY = Math.min(targetGridHeight - 1 + availBottom, bbox.maxY + padY);
  const templateWidth = Math.max(bbox.width, ctxMaxX - ctxMinX + 1);
  const templateHeight = Math.max(bbox.height, ctxMaxY - ctxMinY + 1);

  const ctxWorldX = wb.x + (ctxMinX / targetGridWidth) * wb.width;
  const ctxWorldY = wb.y + (ctxMinY / targetGridHeight) * wb.height;
  const ctxWorldW = (templateWidth / targetGridWidth) * wb.width;
  const ctxWorldH = (templateHeight / targetGridHeight) * wb.height;

  const offsetX = bbox.minX - ctxMinX;
  const offsetY = bbox.minY - ctxMinY;
  return {
    ctxMinX,
    ctxMinY,
    templateWidth,
    templateHeight,
    ctxWorldX,
    ctxWorldY,
    ctxWorldW,
    ctxWorldH,
    bboxInCanvas: {
      minX: offsetX,
      minY: offsetY,
      maxX: offsetX + bbox.width - 1,
      maxY: offsetY + bbox.height - 1,
      width: bbox.width,
      height: bbox.height,
    },
  };
}

function rectsOverlap(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

async function resolveNestedLayerImage(
  layer: NestedPuzzleLayer,
  liveLayerImages: ReadonlyMap<string, HTMLImageElement>,
  required: boolean,
  ownedUrls: string[]
): Promise<HTMLImageElement | null> {
  const liveImg = liveLayerImages.get(layer.imageBlobKey);
  if (liveImg && liveImg.complete && (liveImg.naturalWidth > 0 || liveImg.width > 0)) {
    return liveImg;
  }
  const blob = await StorageService.loadImageBlob(layer.imageBlobKey);
  if (!blob) {
    if (required) {
      throw new Error('Could not load artwork for the selected detail layer.');
    }
    return null;
  }
  const { img, objectUrl } = await decodeBlobToImage(blob);
  ownedUrls.push(objectUrl);
  return img;
}

async function drawWorldStackIntoCanvas(opts: {
  basePuzzle: PuzzleData;
  baseImage: HTMLImageElement;
  liveLayerImages: ReadonlyMap<string, HTMLImageElement>;
  worldX: number;
  worldY: number;
  worldW: number;
  worldH: number;
  canvasWidth: number;
  canvasHeight: number;
  maxDepth: number;
  requiredLayerId: string | null;
}): Promise<HTMLCanvasElement> {
  const {
    basePuzzle,
    baseImage,
    liveLayerImages,
    worldX,
    worldY,
    worldW,
    worldH,
    canvasWidth,
    canvasHeight,
    maxDepth,
    requiredLayerId,
  } = opts;
  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to acquire 2D canvas context');
  }
  // Fill opaque white first so transparent regions never flatten to solid black on JPEG encode.
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  ctx.imageSmoothingEnabled = true;
  if ('imageSmoothingQuality' in ctx) {
    ctx.imageSmoothingQuality = 'high';
  }

  const baseW = baseImage.naturalWidth || baseImage.width || basePuzzle.width;
  const baseH = baseImage.naturalHeight || baseImage.height || basePuzzle.height;
  if (baseW > 0 && baseH > 0) {
    const sx = Math.max(0, Math.min(baseW, worldX * baseW));
    const sy = Math.max(0, Math.min(baseH, worldY * baseH));
    const sx2 = Math.max(sx, Math.min(baseW, (worldX + worldW) * baseW));
    const sy2 = Math.max(sy, Math.min(baseH, (worldY + worldH) * baseH));
    const sw = sx2 - sx;
    const sh = sy2 - sy;
    if (sw > 0 && sh > 0) {
      const dx = ((sx / baseW - worldX) / worldW) * canvasWidth;
      const dy = ((sy / baseH - worldY) / worldH) * canvasHeight;
      const dw = (sw / baseW / worldW) * canvasWidth;
      const dh = (sh / baseH / worldH) * canvasHeight;
      ctx.drawImage(baseImage, sx, sy, sw, sh, dx, dy, dw, dh);
    }
  }

  const layers = (basePuzzle.nestedLayers ?? [])
    .filter(
      (l) =>
        l.depth <= maxDepth &&
        l.worldBounds &&
        l.worldBounds.width > 0 &&
        l.worldBounds.height > 0 &&
        rectsOverlap(
          l.worldBounds.x,
          l.worldBounds.y,
          l.worldBounds.width,
          l.worldBounds.height,
          worldX,
          worldY,
          worldW,
          worldH
        )
    )
    .sort((a, b) => a.depth - b.depth);

  const ownedUrls: string[] = [];
  try {
    for (const layer of layers) {
      const isRequired = layer.layerId === requiredLayerId;
      const img = await resolveNestedLayerImage(layer, liveLayerImages, isRequired, ownedUrls);
      if (!img) continue;
      const wb = layer.worldBounds;
      const dx = ((wb.x - worldX) / worldW) * canvasWidth;
      const dy = ((wb.y - worldY) / worldH) * canvasHeight;
      const dw = (wb.width / worldW) * canvasWidth;
      const dh = (wb.height / worldH) * canvasHeight;
      ctx.drawImage(img, dx, dy, dw, dh);
    }
  } catch (err) {
    releaseCanvas(canvas);
    throw err;
  } finally {
    for (const url of ownedUrls) {
      revokeObjectUrlSafely(url);
    }
  }
  return canvas;
}

/**
 * Resolves an HTMLCanvasElement for the target layer (root or nested) at exact grid dimensions,
 * compositing underlying world artwork behind transparent-masked nested layers so pixels outside
 * the mask are never transparent black.
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
  const wb = nestedLayer.worldBounds;
  if (wb && wb.width > 0 && wb.height > 0) {
    return drawWorldStackIntoCanvas({
      basePuzzle,
      baseImage,
      liveLayerImages,
      worldX: wb.x,
      worldY: wb.y,
      worldW: wb.width,
      worldH: wb.height,
      canvasWidth: targetGrid.width,
      canvasHeight: targetGrid.height,
      maxDepth: nestedLayer.depth,
      requiredLayerId: nestedLayer.layerId,
    });
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

/**
 * Renders a full-world-composited context canvas for Zoom In template generation.
 * For Depth 2+ nested selections, extends +25% context padding beyond the nested layer's own
 * bounding box into the surrounding parent/root artwork so AI models always see rich true-color
 * surroundings instead of black margins.
 */
export async function renderZoomInWorldContextCanvas(
  basePuzzle: PuzzleData,
  baseImage: HTMLImageElement,
  targetLayerId: string | null,
  targetGrid: RegionGridLike,
  bbox: SelectionBbox,
  liveLayerImages: ReadonlyMap<string, HTMLImageElement>
): Promise<WorldContextCanvasResult> {
  if (targetLayerId === null) {
    const maxDepth = (basePuzzle.nestedLayers ?? []).reduce(
      (acc, layer) => Math.max(acc, layer.depth),
      0
    );
    const canvas = await drawWorldStackIntoCanvas({
      basePuzzle,
      baseImage,
      liveLayerImages,
      worldX: 0,
      worldY: 0,
      worldW: 1,
      worldH: 1,
      canvasWidth: targetGrid.width,
      canvasHeight: targetGrid.height,
      maxDepth,
      requiredLayerId: null,
    });
    return { canvas, bboxInCanvas: bbox, padApplied: false };
  }
  const nestedLayer = basePuzzle.nestedLayers?.find((l) => l.layerId === targetLayerId);
  if (!nestedLayer) {
    const canvas = renderImageToCanvas(baseImage, targetGrid.width, targetGrid.height);
    return { canvas, bboxInCanvas: bbox, padApplied: false };
  }
  const bounds = computeWorldContextTemplateBounds(
    nestedLayer,
    targetGrid.width,
    targetGrid.height,
    bbox,
    INFILL_CONTEXT_PAD_RATIO
  );
  if (!bounds) {
    const canvas = await renderLayerSourceToCanvas(
      basePuzzle,
      baseImage,
      targetLayerId,
      targetGrid,
      liveLayerImages
    );
    return { canvas, bboxInCanvas: bbox, padApplied: false };
  }
  const canvas = await drawWorldStackIntoCanvas({
    basePuzzle,
    baseImage,
    liveLayerImages,
    worldX: bounds.ctxWorldX,
    worldY: bounds.ctxWorldY,
    worldW: bounds.ctxWorldW,
    worldH: bounds.ctxWorldH,
    canvasWidth: bounds.templateWidth,
    canvasHeight: bounds.templateHeight,
    maxDepth: nestedLayer.depth,
    requiredLayerId: nestedLayer.layerId,
  });
  return { canvas, bboxInCanvas: bounds.bboxInCanvas, padApplied: true };
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

export function isOwnedDedicatedRootBlobKey(uri: string, snapId: string): boolean {
  return uri === snapId || uri.startsWith('root_');
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
  return !uri || !isOwnedDedicatedRootBlobKey(uri, snapId);
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
  const currentUri =
    existingSnap?.sourceRef?.kind === 'blob' ? existingSnap.sourceRef.uri?.trim() ?? '' : '';
  const currentKey = !isPromotion && currentUri ? currentUri : snapId;
  const currentKeySharedBySiblings = isBlobKeySharedByOtherSnapshots(currentKey, snapId);

  if (!isPromotion && !currentKeySharedBySiblings) {
    return {
      targetRootBlobKey: currentKey,
      needsRootMaterialization: false,
      ownedPreviousRootBlobKey: currentKey,
    };
  }

  if (!isPromotion && operationKind === 'zoom-in') {
    // Sibling-shared root blob on Zoom In: root artwork is not modified, so keep sourceRef intact
    // and never overwrite or delete the shared root blob.
    return {
      targetRootBlobKey: currentKey,
      needsRootMaterialization: false,
      ownedPreviousRootBlobKey: null,
    };
  }

  const snapIdSharedBySiblings = isBlobKeySharedByOtherSnapshots(snapId, snapId);
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
  const currentUri =
    existingSnap?.sourceRef?.kind === 'blob' ? existingSnap.sourceRef.uri?.trim() ?? '' : '';
  const blobKey = currentUri || snapId;
  if (isBlobKeySharedByOtherSnapshots(blobKey, snapId)) {
    return null;
  }
  return await StorageService.loadImageBlob(blobKey).catch(() => null);
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
    if (
      opts.previousRootBlobKey &&
      !isBlobKeyProtectedBySurvivingSnapshots(opts.previousRootBlobKey)
    ) {
      imageKeys.add(opts.previousRootBlobKey);
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
    const restoreKey = opts.previousRootBlobKey ?? opts.snapId;
    await StorageService.saveImageBlob(restoreKey, opts.previousRootBlob).catch((err) => {
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
  const existingUri =
    opts.existingSnap?.sourceRef?.kind === 'blob'
      ? opts.existingSnap.sourceRef.uri?.trim() ?? ''
      : '';
  const targetRootBlobKey =
    opts.rootImageBlobKey ??
    (needsRootMaterialization
      ? isBlobKeySharedByOtherSnapshots(opts.snapId, opts.snapId)
        ? makeUniqueRootBlobKey(opts.snapId)
        : opts.snapId
      : existingUri || opts.snapId);
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
    previousRootBlobKey,
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
  const effectivePreviousRootBlobKey = previousRootBlobKey ?? targetRootBlobKey;
  const effectiveAddedRootBlobKey =
    addedRootBlobKey ??
    (!previousRootBlob && targetRootBlobKey !== snapId ? targetRootBlobKey : undefined);
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
        previousRootBlobKey: effectivePreviousRootBlobKey,
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
        previousRootBlobKey: effectivePreviousRootBlobKey,
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
        previousRootBlobKey: effectivePreviousRootBlobKey,
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
        previousRootBlobKey: effectivePreviousRootBlobKey,
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
  keysToDelete: readonly string[],
  previousRootBlobKey?: string
): Promise<void> {
  const imageKeys = new Set<string>();
  for (const key of keysToDelete) {
    if (!isBlobKeyProtectedBySurvivingSnapshots(key)) {
      imageKeys.add(key);
    }
  }
  if (previousRootBlobKey && !isBlobKeyProtectedBySurvivingSnapshots(previousRootBlobKey)) {
    imageKeys.add(previousRootBlobKey);
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
  const rootBlobTargetKey = snap.previousRootBlobKey ?? expectedSnapshotId;
  let preUndoRootBlob: Blob | null = null;
  let overwroteRootBlob = false;
  if (snap.previousBlob) {
    preUndoRootBlob = await StorageService.loadImageBlob(rootBlobTargetKey).catch(() => null);
    if (isStale() || !findStoredSnapshotById(expectedSnapshotId)) {
      return false;
    }
    await StorageService.saveImageBlob(rootBlobTargetKey, snap.previousBlob);
    overwroteRootBlob = true;
    if (!findStoredSnapshotById(expectedSnapshotId)) {
      await cleanupDeletedSnapshotUndoRecords(
        expectedSnapshotId,
        keysToDelete,
        snap.previousRootBlobKey
      );
      return false;
    }
  }

  try {
    await StorageService.savePuzzleData(expectedSnapshotId, snap.puzzle);
  } catch (err) {
    if (overwroteRootBlob) {
      if (findStoredSnapshotById(expectedSnapshotId)) {
        if (preUndoRootBlob) {
          await StorageService.saveImageBlob(rootBlobTargetKey, preUndoRootBlob).catch(
            (restoreErr) => {
              reportSwallowed('InfiniteZoom.undoRollbackRootBlob', restoreErr, {
                id: expectedSnapshotId,
              });
            }
          );
        }
      } else {
        await cleanupDeletedSnapshotUndoRecords(
          expectedSnapshotId,
          keysToDelete,
          snap.previousRootBlobKey
        );
      }
    }
    throw err;
  }

  if (!findStoredSnapshotById(expectedSnapshotId)) {
    await cleanupDeletedSnapshotUndoRecords(
      expectedSnapshotId,
      keysToDelete,
      snap.previousRootBlobKey
    );
    return false;
  }

  if (keysToDelete.length > 0) {
    await deleteOrphanedEntries([], keysToDelete).catch((err) => {
      reportSwallowed('InfiniteZoom.undoDeleteLayerBlobs', err, { id: expectedSnapshotId });
    });
  }
  return true;
}

function resolveUndoImageKeysToDelete(
  snap: UndoInfiniteZoomSnapshot,
  expectedSnapshotId: string
): string[] {
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
  return shouldDeleteAddedRoot && !snap.addedLayerBlobKeys.includes(candidateRootDeleteKey)
    ? [...snap.addedLayerBlobKeys, candidateRootDeleteKey]
    : [...snap.addedLayerBlobKeys];
}

function shouldReconcileStaleUndoResult(
  staleNow: boolean,
  resetProgressMidUndo: boolean,
  params: Pick<
    RestoreUndoSubdivisionPersistenceParams,
    'shouldReconcileActiveSnapshot' | 'shouldReconcileResetProgress'
  >
): boolean {
  if (!staleNow) return false;
  if (params.shouldReconcileActiveSnapshot) {
    return Boolean(params.shouldReconcileActiveSnapshot());
  }
  return resetProgressMidUndo && Boolean(params.shouldReconcileResetProgress?.());
}

export async function restoreUndoSubdivisionPersistence(
  params: RestoreUndoSubdivisionPersistenceParams
): Promise<RestoreUndoSubdivisionPersistenceResult | null> {
  const { snap, isFreeColorMode, activeSave, liveActiveSave, isStale } = params;
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
  const keysToDelete = resolveUndoImageKeysToDelete(snap, expectedSnapshotId);

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
    await cleanupDeletedSnapshotUndoRecords(
      expectedSnapshotId,
      keysToDelete,
      snap.previousRootBlobKey
    );
    return null;
  }

  const currentResetEpoch = currentStoredSnap.resetEpoch ?? 0;
  const staleNow = isStale();
  const resetProgressMidUndo = staleNow && currentResetEpoch > preUndoResetEpoch;
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

  const reconcileActiveSnapshot = shouldReconcileStaleUndoResult(
    staleNow,
    resetProgressMidUndo,
    params
  );

  // Only skip overwriting active session state & live UI when another puzzle/op superseded us
  // and the user is not actively viewing expectedSnapshotId.
  if (staleNow && !reconcileActiveSnapshot) {
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
    ...(reconcileActiveSnapshot ? { reconciledStaleActiveSnapshot: true } : {}),
    ...(resetProgressMidUndo ? { resetProgressMidUndo: true } : {}),
  };
}
