import {
  Dispatch,
  MutableRefObject,
  SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  BorderExtensionSides,
  GenerationProgressPayload,
  GeneratorConfig,
  InfiniteZoomNodeMeta,
  InfiniteZoomProviderMode,
  NanoBananaModelId,
  NormalizedRect,
  PaletteColor,
  PuzzleData,
  Region,
  SavedSnapshot,
  UserSettings,
} from '../types';
import { buildCanonicalLayerImageKey, StorageService } from '../services/StorageService';
import { deleteOrphanedEntries } from '../services/storage/IndexedDbStore';
import { NativeBridge } from '../services/NativeBridge';
import { PuzzleWorkerService } from '../services/PuzzleWorkerService';
import {
  embedNestedDetailLayerIntoPuzzle,
  MAX_SUBDIVIDE_TARGET_REGIONS,
  wrapPuzzleWithOuterBorderLayer,
} from '../engine/MaskedRegionSubdivider';
import {
  buildOutpaintBorderMask,
  buildUnifiedRegionIndex,
  getAllPuzzleRegions,
  getTotalRegionCount,
  isSafeLayerId,
} from '../engine/UnifiedPuzzleLayers';
import { generatePreviewDataUrl, hasCutoutExteriorMask } from '../services/artworkExporter';
import { reportSwallowed } from '../services/telemetry';
import { FeatureOfferId } from '../services/FeatureOffersService';
import { getDockPalette, getVisiblePalette } from '../components/PaletteDock';
import { TutorialTriedActions } from '../components/OnboardingTutorial';
import {
  buildNanoBananaInfillPrompt,
  buildNanoBananaOutpaintPrompt,
  DecodedGeminiImage,
  decodeReceivedGeminiImage,
  DirectGeminiByokProvider,
  GuidedGeminiHandoffPackage,
  NanoBananaError,
  prepareGuidedGeminiHandoff,
  PuterNanoBananaProvider,
  sanitizeUserPrompt,
} from '../services/ai/NanoBananaService';
import {
  addContiguousDragRegions,
  buildRegionByIdMap,
  buildSelectionMask,
  computeSelectionMetrics,
  RegionGridLike,
  SelectionBbox,
  SelectionMetrics,
  toggleContiguousRegion,
} from '../services/ai/RegionSelectionEngine';
import {
  buildInfillTemplateCanvas,
  buildOutpaintTemplateCanvas,
  canExtendSides,
  canvasToPngBlobAndDataUrl,
  compositeInfillRgba,
  compositeOutpaintRgba,
  ExtendSidesCheck,
  NESTED_LAYER_MAX_DIM_PX,
  TemplateMaskRect,
} from '../services/ai/SeamCompositor';
import type { CoopLiveState, CoopViewport } from './useCoopSession';
import type { UndoHistoryEntry } from './useUndoRedo';
import {
  computeNextResetEpoch,
  hydrateLayerImagesForPuzzle,
} from './useSnapshotLibrary';
import { useLatest } from './useLatest';

const UNDO_TOAST_DURATION_MS = 18_000;
const ERROR_TOAST_DURATION_MS = 9_000;
const MIN_OUTPAINT_SUBREGIONS = 24;
const MAX_NESTED_UPSCALE_FACTOR = 4;

function revokeObjectUrlSafely(url: string | null | undefined): void {
  if (!url || !url.startsWith('blob:')) return;
  try {
    URL.revokeObjectURL(url);
  } catch (err) {
    reportSwallowed('InfiniteZoom.revokeObjectUrl', err);
  }
}

function releaseCanvas(canvas: HTMLCanvasElement | null | undefined): void {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

function createCanvasFromRgbaData(
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

function renderImageToCanvas(
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

function readCanvasCropRgba(
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

function canvasToBlobAsync(
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

function decodeBlobToImage(blob: Blob): Promise<{ img: HTMLImageElement; objectUrl: string }> {
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

function collectMonotonicResetEpoch(
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

function isAbortLikeError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  if (err instanceof NanoBananaError && err.code === 'ABORTED') return true;
  const name = (err as { name?: string }).name;
  return name === 'AbortError' || name === 'GenerationCancelledError';
}

function makeUniqueLayerId(prefix: string): string {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  const candidate = `${prefix}_${stamp}_${rand}`.replace(/[^a-zA-Z0-9._-]/g, '_');
  return isSafeLayerId(candidate) ? candidate : `layer_${stamp}_${rand}`;
}

function isSamplePromotionMeta(
  meta:
    | {
        sampleAssetPath?: string | null;
        sourceRef?: SavedSnapshot['sourceRef'];
      }
    | undefined
): boolean {
  return !meta || Boolean(meta.sampleAssetPath) || meta.sourceRef?.kind !== 'blob';
}

function countRemovedFilledRegions(
  filled: ReadonlySet<number>,
  removedIds: ReadonlySet<number>
): number {
  let removedFilledCount = 0;
  for (const id of removedIds) {
    if (filled.has(id)) removedFilledCount++;
  }
  return removedFilledCount;
}

async function rollbackAbortedLayerPersist(opts: {
  snapId: string;
  addedLayerBlobKeys: string[];
  newRootBlobUrl?: string | null;
  newLayerObjectUrls?: string[];
  previousRootBlob?: Blob | null;
  promotedFromSample?: boolean;
  basePuzzle?: PuzzleData;
}): Promise<void> {
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

function resolveNextZoomDepth(basePuzzle: PuzzleData, targetLayerId: string | null): number {
  if (targetLayerId === null) return 1;
  const targetLayer = basePuzzle.nestedLayers?.find((l) => l.layerId === targetLayerId) ?? null;
  return (targetLayer ? targetLayer.depth : 0) + 1;
}

function buildZoomInZoomTreeMeta(
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

function buildPreviousSnapshotMeta(existingSnap: SavedSnapshot | undefined) {
  return {
    sampleAssetPath: existingSnap?.sampleAssetPath,
    isAutoSample: existingSnap?.isAutoSample,
    sourceRef: existingSnap?.sourceRef,
    zoomTree: existingSnap?.zoomTree,
    previewDataUrl: existingSnap?.previewDataUrl,
  };
}

async function encodeRgbaToBlob(
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

async function encodeImageToPuzzleBlob(
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

async function renderHydratedPreview(
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

async function buildInfillTemplatePayload(
  layerCanvas: HTMLCanvasElement,
  targetGrid: RegionGridLike,
  selectedCopy: ReadonlySet<number>,
  bbox: SelectionBbox
): Promise<{
  cropMask: Uint8Array;
  originalCropRgba: Uint8ClampedArray;
  width: number;
  height: number;
  maskInTemplateRect: TemplateMaskRect;
  templatePngBlob: Blob;
  templateDataUrl: string;
}> {
  const cropMask = buildSelectionMask(targetGrid, selectedCopy, bbox);
  const originalCropRgba = readCanvasCropRgba(
    layerCanvas,
    bbox.minX,
    bbox.minY,
    bbox.width,
    bbox.height
  );
  let tpl: ReturnType<typeof buildInfillTemplateCanvas> | null = null;
  try {
    if (!originalCropRgba) {
      throw new Error('Could not read pixel data for selected region.');
    }
    tpl = buildInfillTemplateCanvas(layerCanvas, bbox, cropMask);
    const encoded = await canvasToPngBlobAndDataUrl(tpl.canvas);
    return {
      cropMask,
      originalCropRgba,
      width: tpl.width,
      height: tpl.height,
      maskInTemplateRect: tpl.maskInTemplateRect,
      templatePngBlob: encoded.blob,
      templateDataUrl: encoded.dataUrl,
    };
  } finally {
    releaseCanvas(tpl?.canvas);
    releaseCanvas(layerCanvas);
  }
}

async function loadPreviousRootBlobIfOwned(
  existingSnap: SavedSnapshot | undefined,
  snapId: string
): Promise<Blob | null> {
  if (!existingSnap || existingSnap.sampleAssetPath || existingSnap.sourceRef?.kind !== 'blob') {
    return null;
  }
  return await StorageService.loadImageBlob(snapId).catch(() => null);
}

async function persistZoomInBlobsAndPuzzle(opts: {
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
}): Promise<boolean> {
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

async function persistZoomOutBlobsAndPuzzle(opts: {
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
}): Promise<boolean> {
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
  previousMeta: {
    sampleAssetPath: string | null | undefined;
    isAutoSample: boolean | undefined;
    sourceRef: SavedSnapshot['sourceRef'];
    zoomTree: InfiniteZoomNodeMeta | undefined;
    previewDataUrl: string | undefined;
  };
  addedRegionCount: number;
}

export type UndoSubdivisionSnapshot = UndoInfiniteZoomSnapshot;

export interface GuidedHandoffSessionState {
  handoff: GuidedGeminiHandoffPackage;
  fallbackReason: string | null;
  isProcessing: boolean;
  errorMessage: string | null;
}

export interface InfiniteZoomErrorState {
  message: string;
  code?: string;
}

export interface UseInfiniteZoomControllerParams {
  puzzle: PuzzleData | null;
  sourceImage: HTMLImageElement | null;
  snapshots: SavedSnapshot[];
  activeSnapshotId: string | null;
  activeSave: SavedSnapshot | undefined;
  activeTitle: string;
  activeColorId: number;
  filledRegionIds: Set<number>;
  paintedRegionColors: Map<number, number>;
  isFreeColorMode: boolean;
  isLoading: boolean;
  isReplaying: boolean;
  isReplayPlaying: boolean;
  exitReplay: () => void;
  applyViewport?: (view: CoopViewport) => void;
  coopRoomCode: string | null;
  settings: UserSettings;
  visibleColorIdsRef: MutableRefObject<Set<number>>;
  regionByIdRef: MutableRefObject<Map<number, Region>>;
  liveCoopRef: MutableRefObject<CoopLiveState>;
  viewportRef: MutableRefObject<CoopViewport>;
  activeBlobUrlRef: MutableRefObject<string | null>;
  undoStackRef: MutableRefObject<UndoHistoryEntry[]>;
  redoStackRef: MutableRefObject<UndoHistoryEntry[]>;
  handleLoadSnapshotRef: MutableRefObject<
    (snapshot: SavedSnapshot, forceReplay?: boolean) => Promise<void>
  >;
  syncUndoStack: (
    updater: UndoHistoryEntry[] | ((prev: UndoHistoryEntry[]) => UndoHistoryEntry[])
  ) => void;
  syncRedoStack: (
    updater: UndoHistoryEntry[] | ((prev: UndoHistoryEntry[]) => UndoHistoryEntry[])
  ) => void;
  setSnapshots: Dispatch<SetStateAction<SavedSnapshot[]>>;
  setPuzzle: Dispatch<SetStateAction<PuzzleData | null>>;
  setSourceImage: Dispatch<SetStateAction<HTMLImageElement | null>>;
  setFilledRegionIds: Dispatch<SetStateAction<Set<number>>>;
  setPaintedRegionColors: Dispatch<SetStateAction<Map<number, number>>>;
  setActiveColorId: Dispatch<SetStateAction<number>>;
  setHintRegionId: Dispatch<SetStateAction<number | null>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setLoadingProgress: Dispatch<SetStateAction<number>>;
  setLoadingStatus: Dispatch<SetStateAction<string>>;
  setLoadingPayload: Dispatch<SetStateAction<GenerationProgressPayload | null>>;
  markTutorialActionTried: (action: keyof TutorialTriedActions) => void;
  triggerFeatureOffer: (id: FeatureOfferId) => void;
  onGuidedHandoffOpenChange?: (isOpen: boolean) => void;
}

/**
 * Pure helper resolving the active RegionGridLike for root (layerId === null) or a NestedPuzzleLayer.
 */
export function resolveActiveSelectionGrid(
  puzzle: PuzzleData | null | undefined,
  layerId: string | null
): RegionGridLike | null {
  if (!puzzle) return null;
  if (layerId === null) return puzzle;
  const nested = puzzle.nestedLayers?.find((l) => l.layerId === layerId);
  if (!nested) return null;
  return {
    width: nested.width,
    height: nested.height,
    regions: nested.regions,
    regionMap: nested.regionMap,
    palette: puzzle.palette,
  };
}

export const ZOOM_IN_MAX_NEW_SWATCHES = 10;

/**
 * Pure helper computing crisp high-resolution target dimensions for a nested detail layer:
 * upscales smaller selections up to maxDimPx (preserving aspect ratio) and never shrinks below crop bbox.
 * When a high-resolution generated image dimension (`generatedMaxDim`) is supplied, preserves its
 * resolution up to `maxDimPx` without the legacy 4x cap so zoomed-in areas hold a full puzzle's detail.
 */
export function computeNestedLayerTargetDimensions(
  bboxWidth: number,
  bboxHeight: number,
  maxDimPx: number = NESTED_LAYER_MAX_DIM_PX,
  generatedMaxDim?: number
): { width: number; height: number } {
  const safeW =
    Number.isFinite(bboxWidth) && bboxWidth > 0 ? Math.max(1, Math.round(bboxWidth)) : 1;
  const safeH =
    Number.isFinite(bboxHeight) && bboxHeight > 0 ? Math.max(1, Math.round(bboxHeight)) : 1;
  const safeMaxDim =
    Number.isFinite(maxDimPx) && maxDimPx > 0
      ? Math.max(1, Math.round(maxDimPx))
      : NESTED_LAYER_MAX_DIM_PX;
  const maxSide = Math.max(safeW, safeH);
  if (maxSide >= safeMaxDim) {
    return { width: safeW, height: safeH };
  }
  const hasGeneratedMax =
    typeof generatedMaxDim === 'number' && Number.isFinite(generatedMaxDim) && generatedMaxDim > 0;
  const desiredMaxSide = hasGeneratedMax
    ? Math.min(safeMaxDim, Math.max(maxSide, Math.round(generatedMaxDim)))
    : Math.min(safeMaxDim, Math.round(maxSide * MAX_NESTED_UPSCALE_FACTOR));
  const scale = desiredMaxSide / maxSide;
  const width = Math.max(safeW, Math.min(safeMaxDim, Math.round(safeW * scale)));
  const height = Math.max(safeH, Math.min(safeMaxDim, Math.round(safeH * scale)));
  return { width, height };
}

/**
 * Pure helper computing whole-puzzle-density subdivision parameters for a Zoom In detail patch,
 * matching the user's generatorConfig and parent puzzle complexity while adapting minRegionArea
 * cleanly for irregular or narrow selection masks.
 */
export function computeZoomInSubdivisionParams(opts: {
  maskedPixelCount: number;
  basePuzzleRegionCount: number;
  generatorConfig?: GeneratorConfig | null;
}): { targetSubRegions: number; minRegionArea: number; maxNewSwatches: number } {
  const cfg = opts.generatorConfig;
  const fallbackMax =
    cfg?.paletteDetail === 'HIGH' ? 500 : cfg?.paletteDetail === 'LOW' ? 100 : 200;
  const configuredMax =
    typeof cfg?.maxRegions === 'number' && Number.isFinite(cfg.maxRegions) && cfg.maxRegions > 0
      ? Math.floor(cfg.maxRegions)
      : fallbackMax;
  const safeBaseRegions =
    Number.isFinite(opts.basePuzzleRegionCount) && opts.basePuzzleRegionCount > 0
      ? Math.floor(opts.basePuzzleRegionCount)
      : 0;
  const desiredTarget = Math.max(configuredMax, Math.min(400, safeBaseRegions));
  const targetSubRegions = Math.max(64, Math.min(MAX_SUBDIVIDE_TARGET_REGIONS, desiredTarget));

  const configuredMinArea =
    typeof cfg?.minRegionArea === 'number' &&
    Number.isFinite(cfg.minRegionArea) &&
    cfg.minRegionArea > 0
      ? Math.floor(cfg.minRegionArea)
      : 48;
  const baseMinArea = Math.max(16, Math.min(40, Math.round(configuredMinArea * 0.75)));
  const safeMasked =
    Number.isFinite(opts.maskedPixelCount) && opts.maskedPixelCount > 0
      ? Math.floor(opts.maskedPixelCount)
      : 0;
  const adaptiveCap =
    safeMasked > 0 ? Math.max(12, Math.floor(safeMasked / (targetSubRegions * 8))) : baseMinArea;
  const minRegionArea = Math.max(12, Math.min(baseMinArea, adaptiveCap));

  return {
    targetSubRegions,
    minRegionArea,
    maxNewSwatches: ZOOM_IN_MAX_NEW_SWATCHES,
  };
}

/**
 * Pure helper computing mean RGB chroma strictly over mask[i] === 1 pixels.
 */
export function computeSelectionMeanChroma(
  rgba: Uint8ClampedArray,
  mask: Uint8Array
): number {
  let chromaSum = 0;
  let count = 0;
  const total = Math.min(mask.length, Math.floor(rgba.length / 4));
  for (let i = 0; i < total; i++) {
    if (mask[i] !== 1) continue;
    const idx = i * 4;
    const r = rgba[idx];
    const g = rgba[idx + 1];
    const b = rgba[idx + 2];
    const maxC = r >= g ? (r >= b ? r : b) : g >= b ? g : b;
    const minC = r <= g ? (r <= b ? r : b) : g <= b ? g : b;
    chromaSum += maxC - minC;
    count++;
  }
  return count > 0 ? chromaSum / count : 0;
}

/**
 * Pure helper removing any undo/redo entries referencing replaced pre-subdivision region IDs.
 */
export function scrubUndoHistoryForRemovedRegions(
  stack: readonly UndoHistoryEntry[],
  removedIds: ReadonlySet<number>
): UndoHistoryEntry[] {
  if (removedIds.size === 0) return stack.slice();
  return stack.filter((entry) => !removedIds.has(entry.regionId));
}

function filterProgressForRemovedRegions(
  filledRegionIds: ReadonlySet<number>,
  paintedRegionColors: ReadonlyMap<number, number>,
  removedIds: ReadonlySet<number>
): { nextFilled: Set<number>; nextPainted: Map<number, number> } {
  const nextFilled = new Set<number>();
  for (const id of filledRegionIds) {
    if (!removedIds.has(id)) nextFilled.add(id);
  }
  const nextPainted = new Map<number, number>();
  for (const [id, colId] of paintedRegionColors) {
    if (!removedIds.has(id)) nextPainted.set(id, colId);
  }
  return { nextFilled, nextPainted };
}

/**
 * Pure helper resolving activeColorId after unified Zoom In or Zoom Out across root + all nested layers,
 * honoring autoAdvance and Free Color mode.
 */
export function resolvePostSubdivisionActiveColor(
  nextPuzzle: PuzzleData,
  nextFilled: Set<number>,
  currentActiveColorId: number,
  addedSwatches: readonly PaletteColor[],
  settings: Pick<UserSettings, 'autoAdvance' | 'paletteSort' | 'prioritizeOnScreen'>,
  visibleColorIds: Set<number>,
  isFreeColorMode: boolean
): number {
  const allRegions = getAllPuzzleRegions(nextPuzzle);
  if (isFreeColorMode || !settings.autoAdvance || allRegions.length === 0) {
    return currentActiveColorId;
  }
  const currentHasRemaining = allRegions.some(
    (r) => r.colorId === currentActiveColorId && !nextFilled.has(r.id)
  );
  if (currentHasRemaining) return currentActiveColorId;

  for (const swatch of addedSwatches) {
    if (allRegions.some((r) => r.colorId === swatch.id && !nextFilled.has(r.id))) {
      return swatch.id;
    }
  }
  const basePalette = getVisiblePalette(
    nextPuzzle.palette,
    allRegions,
    nextFilled,
    settings.paletteSort
  );
  const dockPalette = getDockPalette(basePalette, settings.prioritizeOnScreen, visibleColorIds);
  return dockPalette[0]?.id ?? basePalette[0]?.id ?? currentActiveColorId;
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

/**
 * Composites synthesized infill canvas strictly inside cropMask === 1 onto a full-res copy
 * of sourceImage so surrounding artwork pixels remain bit-exact untouched.
 */
export function buildInPlaceUpdatedSourceCanvas(
  sourceImage: HTMLImageElement | HTMLCanvasElement,
  infillCanvas: HTMLCanvasElement,
  bbox: SelectionBbox,
  cropMask: Uint8Array,
  targetWidth: number,
  targetHeight: number
): HTMLCanvasElement {
  const fullCanvas = document.createElement('canvas');
  fullCanvas.width = targetWidth;
  fullCanvas.height = targetHeight;
  const fullCtx =
    fullCanvas.getContext('2d', { willReadFrequently: true }) || fullCanvas.getContext('2d');
  if (!fullCtx) return fullCanvas;

  fullCtx.drawImage(sourceImage, 0, 0, targetWidth, targetHeight);
  const infillCtx =
    infillCanvas.getContext('2d', { willReadFrequently: true }) || infillCanvas.getContext('2d');
  if (!infillCtx || typeof fullCtx.getImageData !== 'function') {
    fullCtx.drawImage(infillCanvas, bbox.minX, bbox.minY, bbox.width, bbox.height);
    return fullCanvas;
  }

  const baseRegion = fullCtx.getImageData(bbox.minX, bbox.minY, bbox.width, bbox.height);
  const infillRegion = infillCtx.getImageData(0, 0, bbox.width, bbox.height);
  const dst = baseRegion.data;
  const src = infillRegion.data;
  const count = bbox.width * bbox.height;
  for (let i = 0; i < count; i++) {
    if (cropMask[i] !== 1) continue;
    const idx = i * 4;
    dst[idx] = src[idx];
    dst[idx + 1] = src[idx + 1];
    dst[idx + 2] = src[idx + 2];
    dst[idx + 3] = src[idx + 3];
  }
  fullCtx.putImageData(baseRegion, bbox.minX, bbox.minY);
  return fullCanvas;
}

interface PendingGuidedContinuation {
  seq: number;
  isDecoding?: boolean;
  complete: (decoded: DecodedGeminiImage, signal: AbortSignal) => Promise<void>;
  cleanup?: () => void;
}

export function useInfiniteZoomController(params: UseInfiniteZoomControllerParams) {
  const {
    puzzle,
    sourceImage,
    snapshots,
    activeSnapshotId,
    activeSave,
    filledRegionIds,
    paintedRegionColors,
    isFreeColorMode,
    isLoading,
    isReplaying,
    isReplayPlaying,
    exitReplay,
    applyViewport,
    coopRoomCode,
    settings,
    visibleColorIdsRef,
    liveCoopRef,
    viewportRef,
    activeBlobUrlRef,
    undoStackRef,
    redoStackRef,
    handleLoadSnapshotRef,
    syncUndoStack,
    syncRedoStack,
    setSnapshots,
    setPuzzle,
    setSourceImage,
    setFilledRegionIds,
    setPaintedRegionColors,
    setActiveColorId,
    setHintRegionId,
    setIsLoading,
    setLoadingProgress,
    setLoadingStatus,
    setLoadingPayload,
    markTutorialActionTried,
    triggerFeatureOffer,
    onGuidedHandoffOpenChange,
  } = params;

  const [isRegionSelectionMode, setIsRegionSelectionMode] = useState(false);
  const [selectedRegionIds, setSelectedRegionIds] = useState<Set<number>>(() => new Set());
  const [selectionLayerId, setSelectionLayerId] = useState<string | null>(null);
  const [pendingSwitchRegionId, setPendingSwitchRegionId] = useState<number | null>(null);
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const [infiniteZoomPrompt, setInfiniteZoomPrompt] = useState('');
  const [isInfiniteZoomRunning, setIsInfiniteZoomRunning] = useState(false);
  const [undoSubdivisionState, setUndoSubdivisionState] =
    useState<UndoInfiniteZoomSnapshot | null>(null);
  const [liveLayerImages, setLiveLayerImages] = useState<Map<string, HTMLImageElement>>(
    () => new Map()
  );
  const [guidedHandoffSession, setGuidedHandoffSession] =
    useState<GuidedHandoffSessionState | null>(null);
  const [infiniteZoomError, setInfiniteZoomError] = useState<InfiniteZoomErrorState | null>(null);

  const infiniteZoomOpSeqRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const undoToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSwitchLayerIdRef = useRef<string | null>(null);
  const pendingGuidedRef = useRef<PendingGuidedContinuation | null>(null);
  const ownedLayerBlobUrlsRef = useRef<Map<string, string>>(new Map());

  const undoSubdivisionRef = useLatest(undoSubdivisionState);
  const settingsRef = useLatest(settings);
  const selectionLayerIdRef = useLatest(selectionLayerId);
  const selectedRegionIdsRef = useLatest(selectedRegionIds);
  const liveLayerImagesRef = useLatest(liveLayerImages);
  const isReplayingRef = useLatest(isReplaying);
  const onGuidedHandoffOpenChangeRef = useLatest(onGuidedHandoffOpenChange);

  const isActiveReplayPlayback = isReplaying && isReplayPlaying;

  useEffect(() => {
    if (!isLoading && abortControllerRef.current === null && pendingGuidedRef.current === null) {
      setIsInfiniteZoomRunning(false);
    }
  }, [isLoading]);

  const effectiveInfiniteZoomRunning = isInfiniteZoomRunning && isLoading;

  const clearErrorToastTimer = useCallback(() => {
    if (errorToastTimerRef.current !== null) {
      clearTimeout(errorToastTimerRef.current);
      errorToastTimerRef.current = null;
    }
  }, []);

  const clearInfiniteZoomError = useCallback(() => {
    clearErrorToastTimer();
    setInfiniteZoomError(null);
  }, [clearErrorToastTimer]);

  const showInfiniteZoomError = useCallback(
    (message: string, code?: string) => {
      clearErrorToastTimer();
      setInfiniteZoomError({ message, code });
      errorToastTimerRef.current = setTimeout(() => {
        errorToastTimerRef.current = null;
        setInfiniteZoomError(null);
      }, ERROR_TOAST_DURATION_MS);
    },
    [clearErrorToastTimer]
  );

  const clearUndoToastTimer = useCallback(() => {
    if (undoToastTimerRef.current !== null) {
      clearTimeout(undoToastTimerRef.current);
      undoToastTimerRef.current = null;
    }
  }, []);

  const revokeOwnedLayerUrlsNotIn = useCallback((keepKeys: ReadonlySet<string>) => {
    const owned = ownedLayerBlobUrlsRef.current;
    for (const [key, url] of Array.from(owned.entries())) {
      if (!keepKeys.has(key)) {
        revokeObjectUrlSafely(url);
        owned.delete(key);
      }
    }
  }, []);

  const clearUndoSubdivision = useCallback(() => {
    clearUndoToastTimer();
    const prev = undoSubdivisionRef.current;
    undoSubdivisionRef.current = null;
    if (prev && prev.previousBlobUrl && prev.previousBlobUrl !== activeBlobUrlRef.current) {
      revokeObjectUrlSafely(prev.previousBlobUrl);
    }
    setUndoSubdivisionState(null);
    // Reclaim any owned layer URLs that are no longer in active liveLayerImages
    const keepKeys = new Set<string>(liveLayerImagesRef.current.keys());
    revokeOwnedLayerUrlsNotIn(keepKeys);
  }, [
    activeBlobUrlRef,
    clearUndoToastTimer,
    liveLayerImagesRef,
    revokeOwnedLayerUrlsNotIn,
    undoSubdivisionRef,
  ]);

  const clearGuidedSession = useCallback(() => {
    const pending = pendingGuidedRef.current;
    pendingGuidedRef.current = null;
    if (pending?.cleanup) {
      try {
        pending.cleanup();
      } catch (err) {
        reportSwallowed('InfiniteZoom.guidedCleanup', err);
      }
    }
    setGuidedHandoffSession(null);
    onGuidedHandoffOpenChangeRef.current?.(false);
  }, [onGuidedHandoffOpenChangeRef]);

  const exitRegionSelectionMode = useCallback(() => {
    const empty = new Set<number>();
    selectedRegionIdsRef.current = empty;
    selectionLayerIdRef.current = null;
    setIsRegionSelectionMode(false);
    setSelectedRegionIds(empty);
    setSelectionLayerId(null);
    setPendingSwitchRegionId(null);
    pendingSwitchLayerIdRef.current = null;
    setSelectionNotice(null);
  }, [selectedRegionIdsRef, selectionLayerIdRef]);

  // Auto-exit selection mode ONLY on Co-op join or active animated Replay playback (NOT paused replay)
  useEffect(() => {
    if (!(Boolean(coopRoomCode) || isActiveReplayPlayback) || !isRegionSelectionMode) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        exitRegionSelectionMode();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [coopRoomCode, isActiveReplayPlayback, isRegionSelectionMode, exitRegionSelectionMode]);

  const cancelActiveInfiniteZoom = useCallback(() => {
    infiniteZoomOpSeqRef.current += 1;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    clearGuidedSession();
    PuzzleWorkerService.cancelActive();
    setIsInfiniteZoomRunning(false);
    setIsLoading(false);
    setLoadingPayload(null);
  }, [clearGuidedSession, setIsLoading, setLoadingPayload]);

  const handleBeforeSnapshotResetOrSwitch = useCallback(() => {
    exitRegionSelectionMode();
    clearUndoSubdivision();
    clearGuidedSession();
    clearInfiniteZoomError();
    infiniteZoomOpSeqRef.current += 1;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsInfiniteZoomRunning(false);
    revokeOwnedLayerUrlsNotIn(new Set());
    setLiveLayerImages(new Map());
  }, [
    clearGuidedSession,
    clearInfiniteZoomError,
    clearUndoSubdivision,
    exitRegionSelectionMode,
    revokeOwnedLayerUrlsNotIn,
  ]);

  const revokePendingUndoBlob = useCallback(() => {
    const prev = undoSubdivisionRef.current;
    if (prev && prev.previousBlobUrl && prev.previousBlobUrl !== activeBlobUrlRef.current) {
      revokeObjectUrlSafely(prev.previousBlobUrl);
    }
  }, [activeBlobUrlRef, undoSubdivisionRef]);

  useEffect(() => {
    return () => {
      clearUndoToastTimer();
      clearErrorToastTimer();
      revokePendingUndoBlob();
      clearGuidedSession();
      revokeOwnedLayerUrlsNotIn(new Set());
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, [
    clearErrorToastTimer,
    clearGuidedSession,
    clearUndoToastTimer,
    revokeOwnedLayerUrlsNotIn,
    revokePendingUndoBlob,
  ]);

  const activeSelectionGrid = useMemo(
    () => resolveActiveSelectionGrid(puzzle, selectionLayerId),
    [puzzle, selectionLayerId]
  );

  const selectionMetrics: SelectionMetrics = useMemo(() => {
    if (!activeSelectionGrid || selectedRegionIds.size === 0) {
      return {
        regionCount: 0,
        area: 0,
        bbox: { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 },
        paintedCount: 0,
        neighborRegionIds: [],
        neighborBoundaryHexes: [],
        mode: 'in-place',
      };
    }
    return computeSelectionMetrics(
      activeSelectionGrid,
      selectedRegionIds,
      filledRegionIds,
      paintedRegionColors
    );
  }, [activeSelectionGrid, selectedRegionIds, filledRegionIds, paintedRegionColors]);

  const childSave = useMemo(
    () => resolveLatestChildSave(snapshots, activeSave, activeSnapshotId),
    [snapshots, activeSave, activeSnapshotId]
  );

  const isInfiniteZoomDisabled =
    Boolean(coopRoomCode) || isLoading || isActiveReplayPlayback || !sourceImage;
  const infiniteZoomDisabledReason = coopRoomCode
    ? 'Leave Co-op room to use Infinite Zoom'
    : isActiveReplayPlayback
      ? 'Pause or exit Replay to use Infinite Zoom'
      : undefined;

  const handleJumpToChildPuzzle = useCallback(() => {
    if (!childSave) return;
    NativeBridge.haptic('tick', settingsRef.current.hapticsEnabled);
    void handleLoadSnapshotRef.current(childSave);
  }, [childSave, handleLoadSnapshotRef, settingsRef]);

  const handleEnterRegionSelectionMode = useCallback(
    (initialPrompt?: string) => {
      if (isInfiniteZoomDisabled || !puzzle) return;
      if (isReplayingRef.current) {
        exitReplay();
      }
      clearInfiniteZoomError();
      if (typeof initialPrompt === 'string' && initialPrompt.trim().length > 0) {
        setInfiniteZoomPrompt(initialPrompt);
      }
      const empty = new Set<number>();
      selectedRegionIdsRef.current = empty;
      selectionLayerIdRef.current = null;
      setSelectedRegionIds(empty);
      setSelectionLayerId(null);
      setPendingSwitchRegionId(null);
      pendingSwitchLayerIdRef.current = null;
      setSelectionNotice(null);
      setIsRegionSelectionMode(true);
    },
    [
      clearInfiniteZoomError,
      exitReplay,
      isInfiniteZoomDisabled,
      isReplayingRef,
      puzzle,
      selectedRegionIdsRef,
      selectionLayerIdRef,
    ]
  );

  const handleRegionSelectTap = useCallback(
    (regionId: number, layerId?: string | null) => {
      if (!puzzle || !isRegionSelectionMode) return;
      const targetLayerId =
        layerId !== undefined
          ? layerId
          : (buildUnifiedRegionIndex(puzzle).worldById.get(regionId)?.layerId ?? null);
      const targetGrid = resolveActiveSelectionGrid(puzzle, targetLayerId);
      if (!targetGrid) return;
      const layerRegionMap = buildRegionByIdMap(targetGrid);
      if (!layerRegionMap.has(regionId)) return;

      const curSelected = selectedRegionIdsRef.current;
      const curLayerId = selectionLayerIdRef.current;

      if (curSelected.size > 0 && targetLayerId !== curLayerId) {
        pendingSwitchLayerIdRef.current = targetLayerId;
        setPendingSwitchRegionId(regionId);
        setSelectionNotice(null);
        return;
      }

      const result = toggleContiguousRegion(targetGrid, curSelected, regionId, layerRegionMap);
      if (result.status === 'added' || result.status === 'removed') {
        const nextLayerId = result.nextSelected.size > 0 ? targetLayerId : null;
        selectedRegionIdsRef.current = result.nextSelected;
        selectionLayerIdRef.current = nextLayerId;
        setSelectedRegionIds(result.nextSelected);
        setSelectionLayerId(nextLayerId);
        setPendingSwitchRegionId(null);
        pendingSwitchLayerIdRef.current = null;
        setSelectionNotice(null);
        NativeBridge.haptic('tick', settingsRef.current.hapticsEnabled);
      } else if (result.status === 'non-adjacent') {
        pendingSwitchLayerIdRef.current = targetLayerId;
        setPendingSwitchRegionId(regionId);
        setSelectionNotice(null);
      } else if (result.status === 'bridge-blocked') {
        setPendingSwitchRegionId(null);
        pendingSwitchLayerIdRef.current = null;
        setSelectionNotice(
          'Cannot unselect a connecting bridge region — clear or unselect ends first.'
        );
      }
    },
    [isRegionSelectionMode, puzzle, selectedRegionIdsRef, selectionLayerIdRef, settingsRef]
  );

  const handleRegionSelectDragAdd = useCallback(
    (candidateIds: ReadonlySet<number>) => {
      if (!puzzle || !isRegionSelectionMode || candidateIds.size === 0) return;
      const curSelected = selectedRegionIdsRef.current;
      let targetLayerId = selectionLayerIdRef.current;

      if (curSelected.size === 0) {
        const index = buildUnifiedRegionIndex(puzzle);
        for (const id of candidateIds) {
          const ref = index.worldById.get(id);
          if (ref) {
            targetLayerId = ref.layerId;
            break;
          }
        }
      }

      const targetGrid = resolveActiveSelectionGrid(puzzle, targetLayerId);
      if (!targetGrid) return;
      const layerRegionMap = buildRegionByIdMap(targetGrid);
      const filtered: number[] = [];
      for (const id of candidateIds) {
        if (layerRegionMap.has(id)) {
          filtered.push(id);
        }
      }
      if (filtered.length === 0) return;

      const next = addContiguousDragRegions(targetGrid, curSelected, filtered, layerRegionMap);
      if (next.size !== curSelected.size) {
        selectedRegionIdsRef.current = next;
        setSelectedRegionIds(next);
        if (curSelected.size === 0 && next.size > 0) {
          selectionLayerIdRef.current = targetLayerId;
          setSelectionLayerId(targetLayerId);
        }
      }
      setPendingSwitchRegionId(null);
      pendingSwitchLayerIdRef.current = null;
      setSelectionNotice(null);
    },
    [isRegionSelectionMode, puzzle, selectedRegionIdsRef, selectionLayerIdRef]
  );

  const handleSwitchSelectionToPending = useCallback(() => {
    if (pendingSwitchRegionId === null || !puzzle) return;
    const nextLayerId = pendingSwitchLayerIdRef.current;
    const targetGrid = resolveActiveSelectionGrid(puzzle, nextLayerId);
    if (!targetGrid) return;
    const nextSet = new Set([pendingSwitchRegionId]);
    selectionLayerIdRef.current = nextLayerId;
    selectedRegionIdsRef.current = nextSet;
    setSelectionLayerId(nextLayerId);
    setSelectedRegionIds(nextSet);
    setPendingSwitchRegionId(null);
    pendingSwitchLayerIdRef.current = null;
    setSelectionNotice(null);
    NativeBridge.haptic('tick', settingsRef.current.hapticsEnabled);
  }, [pendingSwitchRegionId, puzzle, selectedRegionIdsRef, selectionLayerIdRef, settingsRef]);

  const handleClearSelection = useCallback(() => {
    const empty = new Set<number>();
    selectedRegionIdsRef.current = empty;
    selectionLayerIdRef.current = null;
    setSelectedRegionIds(empty);
    setSelectionLayerId(null);
    setPendingSwitchRegionId(null);
    pendingSwitchLayerIdRef.current = null;
    setSelectionNotice(null);
  }, [selectedRegionIdsRef, selectionLayerIdRef]);

  /**
   * Resolves an HTMLCanvasElement for the target layer (root or nested) at exact grid dimensions.
   */
  const renderLayerSourceToCanvas = useCallback(
    async (
      basePuzzle: PuzzleData,
      baseImage: HTMLImageElement,
      targetLayerId: string | null,
      targetGrid: RegionGridLike
    ): Promise<HTMLCanvasElement> => {
      if (targetLayerId === null) {
        return renderImageToCanvas(baseImage, targetGrid.width, targetGrid.height);
      }
      const nestedLayer = basePuzzle.nestedLayers?.find((l) => l.layerId === targetLayerId);
      if (!nestedLayer) {
        return renderImageToCanvas(baseImage, targetGrid.width, targetGrid.height);
      }
      const liveImg = liveLayerImagesRef.current.get(nestedLayer.imageBlobKey);
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
    },
    [liveLayerImagesRef]
  );

  /**
   * Executes the selected Nano Banana provider or opens Guided Gemini Handoff Modal.
   * Returns decoded image + provider/model metadata when resolved immediately, or `null` when
   * paused waiting on the Guided Gemini Handoff modal.
   */
  const runProviderOrOpenGuidedHandoff = useCallback(
    async (opts: {
      seq: number;
      signal: AbortSignal;
      direction: 'in-place' | 'child-in' | 'extend-out';
      prompt: string;
      templatePngBlob: Blob;
      templateDataUrl: string;
      width: number;
      height: number;
      onComplete: (
        decoded: DecodedGeminiImage,
        providerUsed: InfiniteZoomProviderMode,
        modelUsed: NanoBananaModelId,
        activeSignal: AbortSignal
      ) => Promise<void>;
      onCleanup?: () => void;
    }): Promise<'completed' | 'awaiting-guided' | 'aborted'> => {
      const {
        seq,
        signal,
        direction,
        prompt,
        templatePngBlob,
        templateDataUrl,
        width,
        height,
        onComplete,
        onCleanup,
      } = opts;
      const isAborted = () => signal.aborted || seq !== infiniteZoomOpSeqRef.current;

      const curSettings = settingsRef.current;
      const isAndroid = NativeBridge.isAndroidNative();
      const effectiveProvider: InfiniteZoomProviderMode =
        isAndroid && curSettings.infiniteZoomProvider === 'PUTER'
          ? 'GUIDED_GEMINI'
          : curSettings.infiniteZoomProvider;
      const model = curSettings.nanoBananaModel;
      const resolution = curSettings.nanoBananaResolution;

      const openGuided = (fallbackReason: string | null): 'awaiting-guided' => {
        const handoff = prepareGuidedGeminiHandoff({
          templatePngBlob,
          templateDataUrl,
          prompt,
          direction,
        });
        pendingGuidedRef.current = {
          seq,
          complete: async (decoded, activeSignal) => {
            await onComplete(decoded, 'GUIDED_GEMINI', model, activeSignal);
          },
          cleanup: onCleanup,
        };
        setIsLoading(false);
        setLoadingPayload(null);
        setGuidedHandoffSession({
          handoff,
          fallbackReason,
          isProcessing: false,
          errorMessage: null,
        });
        onGuidedHandoffOpenChangeRef.current?.(true);
        return 'awaiting-guided';
      };

      if (effectiveProvider === 'GUIDED_GEMINI') {
        return openGuided(null);
      }

      try {
        setLoadingProgress(0.18);
        setLoadingStatus(
          effectiveProvider === 'PUTER'
            ? 'Generating seamless artwork via Puter (Nano Banana)...'
            : 'Generating seamless artwork via Gemini API...'
        );

        const generationResult =
          effectiveProvider === 'PUTER'
            ? await new PuterNanoBananaProvider().generate({
                prompt,
                templatePngBlob,
                templateDataUrl,
                width,
                height,
                model,
                resolution,
                signal,
              })
            : await new DirectGeminiByokProvider().generate({
                prompt,
                templatePngBlob,
                templateDataUrl,
                width,
                height,
                model,
                resolution,
                signal,
              });

        if (isAborted()) {
          onCleanup?.();
          return 'aborted';
        }

        setLoadingProgress(0.42);
        setLoadingStatus('Validating generated image...');
        const decoded = await decodeReceivedGeminiImage(generationResult.blob);
        if (isAborted()) {
          onCleanup?.();
          return 'aborted';
        }

        await onComplete(decoded, generationResult.providerUsed, generationResult.modelUsed, signal);
        onCleanup?.();
        return 'completed';
      } catch (err) {
        if (isAborted() || isAbortLikeError(err)) {
          onCleanup?.();
          return 'aborted';
        }
        if (err instanceof NanoBananaError) {
          if (err.code === 'SAFETY_BLOCKED') {
            onCleanup?.();
            showInfiniteZoomError(err.message, err.code);
            return 'aborted';
          }
          if (err.canFallbackToGuided) {
            return openGuided(
              `${err.message} Switched to Free Gemini App Handoff so you can finish at $0 cost.`
            );
          }
          onCleanup?.();
          showInfiniteZoomError(err.message, err.code);
          return 'aborted';
        }
        onCleanup?.();
        throw err;
      }
    },
    [
      onGuidedHandoffOpenChangeRef,
      setIsLoading,
      setLoadingPayload,
      setLoadingProgress,
      setLoadingStatus,
      settingsRef,
      showInfiniteZoomError,
    ]
  );

  const commitZoomInResult = useCallback(
    async (opts: {
      seq: number;
      signal: AbortSignal;
      snapId: string;
      existingSnap: SavedSnapshot | undefined;
      basePuzzle: PuzzleData;
      baseImage: HTMLImageElement;
      targetLayerId: string | null;
      targetGrid: RegionGridLike;
      selectedCopy: Set<number>;
      metrics: SelectionMetrics;
      cropMask: Uint8Array;
      originalCropRgba: Uint8ClampedArray;
      templateMeta: TemplateMaskRect;
      sanitizedPrompt: string;
      decoded: DecodedGeminiImage;
      providerUsed: InfiniteZoomProviderMode;
      modelUsed: NanoBananaModelId;
      isFree: boolean;
    }) => {
      const {
        seq,
        signal,
        snapId,
        existingSnap,
        basePuzzle,
        baseImage,
        targetLayerId,
        targetGrid,
        selectedCopy,
        metrics,
        cropMask,
        originalCropRgba,
        templateMeta,
        sanitizedPrompt,
        decoded,
        providerUsed,
        modelUsed,
        isFree,
      } = opts;

      const isAborted = () => signal.aborted || seq !== infiniteZoomOpSeqRef.current;
      if (isAborted()) return;

      const nextDepth = resolveNextZoomDepth(basePuzzle, targetLayerId);

      setLoadingProgress(0.48);
      setLoadingStatus('Compositing pixel-locked seamless detail...');
      const generatedMaxDim = Math.max(decoded.width, decoded.height);
      const targetDims = computeNestedLayerTargetDimensions(
        metrics.bbox.width,
        metrics.bbox.height,
        NESTED_LAYER_MAX_DIM_PX,
        generatedMaxDim
      );
      const composited = compositeInfillRgba({
        originalCropRgba,
        cropWidth: metrics.bbox.width,
        cropHeight: metrics.bbox.height,
        cropMask,
        generatedRgba: decoded.rgba,
        generatedWidth: decoded.width,
        generatedHeight: decoded.height,
        templateMeta,
        targetWidth: targetDims.width,
        targetHeight: targetDims.height,
        transparentOutsideMask: true,
      });
      if (isAborted()) return;

      let maskedPixelCount = 0;
      for (let i = 0; i < composited.mask.length; i++) {
        if (composited.mask[i] === 1) maskedPixelCount++;
      }
      const subBudget = computeZoomInSubdivisionParams({
        maskedPixelCount,
        basePuzzleRegionCount: basePuzzle.regions.length,
        generatorConfig: settingsRef.current.generatorConfig,
      });

      const subResult = await PuzzleWorkerService.subdivideMaskedRegion(
        {
          rgbaData: composited.rgba,
          cropWidth: composited.width,
          cropHeight: composited.height,
          cropMask: composited.mask,
          existingPalette: basePuzzle.palette,
          isFreeColor: isFree,
          targetSubRegions: subBudget.targetSubRegions,
          minRegionArea: subBudget.minRegionArea,
          maxNewSwatches: subBudget.maxNewSwatches,
        },
        (prog, status) => {
          if (seq === infiniteZoomOpSeqRef.current) {
            setLoadingProgress(0.5 + Math.min(1, Math.max(0, prog)) * 0.35);
            setLoadingStatus(status);
          }
        }
      );
      if (isAborted()) return;

      setLoadingProgress(0.88);
      setLoadingStatus('Embedding seamless detail layer...');

      const layerId = makeUniqueLayerId(`detail_d${nextDepth}`);
      const imageBlobKey = buildCanonicalLayerImageKey(snapId, layerId);
      const localBoundsInParent: NormalizedRect = {
        x: metrics.bbox.minX / Math.max(1, targetGrid.width),
        y: metrics.bbox.minY / Math.max(1, targetGrid.height),
        width: metrics.bbox.width / Math.max(1, targetGrid.width),
        height: metrics.bbox.height / Math.max(1, targetGrid.height),
      };

      const layerPngBlob = await encodeRgbaToBlob(
        composited.rgba,
        composited.width,
        composited.height,
        'image/png'
      );
      if (isAborted()) return;

      const { img: layerImg, objectUrl: layerObjectUrl } = await decodeBlobToImage(layerPngBlob);
      let persistedToIdb = false;
      let committed = false;
      let previousRootBlob: Blob | null = null;
      let promotedFromSample = false;

      try {
        if (isAborted()) {
          revokeObjectUrlSafely(layerObjectUrl);
          return;
        }

        const embedResult = embedNestedDetailLayerIntoPuzzle({
          basePuzzle,
          targetLayerId,
          selectedRegionIds: selectedCopy,
          subResult,
          localBoundsInParent,
          layerId,
          imageBlobKey,
          promptHint: sanitizedPrompt || undefined,
          providerUsed,
          modelUsed,
        });

        const previousLayerImages = new Map(liveLayerImagesRef.current);
        const previousViewport = { ...viewportRef.current };
        previousRootBlob = await loadPreviousRootBlobIfOwned(existingSnap, snapId);
        promotedFromSample = !previousRootBlob && isSamplePromotionMeta(existingSnap);
        if (isAborted()) {
          revokeObjectUrlSafely(layerObjectUrl);
          return;
        }

        persistedToIdb = true;
        const persisted = await persistZoomInBlobsAndPuzzle({
          snapId,
          existingSnap,
          basePuzzle,
          baseImage,
          nextPuzzle: embedResult.puzzle,
          imageBlobKey,
          layerPngBlob,
          layerObjectUrl,
          promotedFromSample,
          isAborted,
        });
        if (!persisted) {
          persistedToIdb = false;
          return;
        }

        const liveState = liveCoopRef.current;
        const liveFilled = liveState.filledRegionIds;
        const livePainted = liveState.paintedRegionColors;
        const liveActiveColorId = liveState.activeColorId;
        const liveActiveSave = liveState.activeSave;

        const removedIdSet = new Set(embedResult.removedRegionIds);
        const removedFilledCount = countRemovedFilledRegions(liveFilled, removedIdSet);
        const { nextFilled, nextPainted } = filterProgressForRemovedRegions(
          liveFilled,
          livePainted,
          removedIdSet
        );
        const nextUndo = scrubUndoHistoryForRemovedRegions(undoStackRef.current, removedIdSet);
        const nextRedo = scrubUndoHistoryForRemovedRegions(redoStackRef.current, removedIdSet);
        const nextActiveColorId = resolvePostSubdivisionActiveColor(
          embedResult.puzzle,
          nextFilled,
          liveActiveColorId,
          subResult.addedSwatches,
          settingsRef.current,
          visibleColorIdsRef.current,
          isFree
        );

        const previewUrl = await renderHydratedPreview(
          embedResult.puzzle,
          baseImage,
          nextFilled,
          nextPainted,
          'InfiniteZoom.zoomInPreview'
        );
        if (isAborted()) {
          await rollbackAbortedLayerPersist({
            snapId,
            addedLayerBlobKeys: [imageBlobKey],
            newLayerObjectUrls: [layerObjectUrl],
            previousRootBlob,
            promotedFromSample,
            basePuzzle,
          });
          persistedToIdb = false;
          return;
        }

        const preOpUndo: UndoInfiniteZoomSnapshot = {
          operationKind: 'zoom-in',
          snapshotId: snapId,
          puzzle: basePuzzle,
          sourceImage: baseImage,
          previousBlob: previousRootBlob,
          promotedFromSample,
          previousBlobUrl: activeBlobUrlRef.current,
          newBlobUrl: activeBlobUrlRef.current,
          addedLayerBlobKeys: [imageBlobKey],
          previousLayerImages,
          filledRegionIds: new Set(liveFilled),
          paintedRegionColors: new Map(livePainted),
          undoStack: undoStackRef.current.slice(),
          redoStack: redoStackRef.current.slice(),
          activeColorId: liveActiveColorId,
          previousViewport,
          previousMeta: buildPreviousSnapshotMeta(existingSnap),
          addedRegionCount: embedResult.addedRegionIds.length,
        };

        const nextZoomTree = buildZoomInZoomTreeMeta(
          existingSnap,
          selectedCopy,
          sanitizedPrompt,
          providerUsed,
          modelUsed
        );
        const nextResetEpoch =
          removedFilledCount > 0
            ? collectMonotonicResetEpoch(snapId, liveActiveSave, liveCoopRef.current.activeSave)
            : undefined;
        const totalRegions = getTotalRegionCount(embedResult.puzzle);
        const estSaveBytes = StorageService.estimatePuzzleSaveBytes(embedResult.puzzle, previewUrl);
        const orderedFilled = Array.from(nextFilled);
        const paintedObj = Object.fromEntries(nextPainted);
        const { zoomScale, panOffsetX, panOffsetY } = viewportRef.current;

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
          embedResult.puzzle.palette,
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

        ownedLayerBlobUrlsRef.current.set(imageBlobKey, layerObjectUrl);
        const nextLiveLayerImages = new Map(previousLayerImages);
        nextLiveLayerImages.set(imageBlobKey, layerImg);

        liveCoopRef.current = {
          ...liveCoopRef.current,
          puzzle: embedResult.puzzle,
          activeSave: syncedSave ?? liveCoopRef.current.activeSave,
          filledRegionIds: nextFilled,
          paintedRegionColors: nextPainted,
          activeColorId: nextActiveColorId,
        };
        setLiveLayerImages(nextLiveLayerImages);
        setPuzzle(embedResult.puzzle);
        setFilledRegionIds(nextFilled);
        setPaintedRegionColors(nextPainted);
        setActiveColorId(nextActiveColorId);
        setHintRegionId(null);
        syncUndoStack(nextUndo);
        syncRedoStack(nextRedo);
        setSnapshots(updatedSnapshots);
        committed = true;

        clearUndoToastTimer();
        undoSubdivisionRef.current = preOpUndo;
        setUndoSubdivisionState(preOpUndo);
        undoToastTimerRef.current = setTimeout(() => {
          clearUndoSubdivision();
        }, UNDO_TOAST_DURATION_MS);

        markTutorialActionTried('create_gallery');
        triggerFeatureOffer('infinite_zoom');
        NativeBridge.haptic('success', settingsRef.current.hapticsEnabled);
      } catch (err) {
        if (!committed) {
          if (persistedToIdb) {
            await rollbackAbortedLayerPersist({
              snapId,
              addedLayerBlobKeys: [imageBlobKey],
              newLayerObjectUrls: [layerObjectUrl],
              previousRootBlob,
              promotedFromSample,
              basePuzzle,
            });
          } else {
            revokeObjectUrlSafely(layerObjectUrl);
          }
        }
        throw err;
      }
    },
    [
      activeBlobUrlRef,
      clearUndoSubdivision,
      clearUndoToastTimer,
      liveCoopRef,
      liveLayerImagesRef,
      markTutorialActionTried,
      redoStackRef,
      setActiveColorId,
      setFilledRegionIds,
      setHintRegionId,
      setLoadingProgress,
      setLoadingStatus,
      setPaintedRegionColors,
      setPuzzle,
      setSnapshots,
      settingsRef,
      syncRedoStack,
      syncUndoStack,
      triggerFeatureOffer,
      undoStackRef,
      undoSubdivisionRef,
      viewportRef,
      visibleColorIdsRef,
    ]
  );

  const handleConfirmRegionSubdivision = useCallback(async () => {
    if (!puzzle || !sourceImage || selectedRegionIds.size === 0 || isInfiniteZoomDisabled) return;
    const targetLayerId = selectionLayerId;
    const targetGrid = resolveActiveSelectionGrid(puzzle, targetLayerId);
    if (!targetGrid) return;

    const selectedCopy = new Set(selectedRegionIds);
    const metrics = computeSelectionMetrics(
      targetGrid,
      selectedCopy,
      filledRegionIds,
      paintedRegionColors
    );
    if (metrics.regionCount === 0) return;

    const promptText = infiniteZoomPrompt;
    const basePuzzle = puzzle;
    const baseImage = sourceImage;
    const snapId = activeSnapshotId || crypto.randomUUID();
    const existingSnap = snapshots.find((s) => s.id === snapId);
    const isFree = Boolean(isFreeColorMode || basePuzzle.isFreeColor);

    exitRegionSelectionMode();
    clearUndoSubdivision();
    clearGuidedSession();
    clearInfiniteZoomError();

    const seq = ++infiniteZoomOpSeqRef.current;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsInfiniteZoomRunning(true);
    setIsLoading(true);
    setLoadingProgress(0.05);
    setLoadingStatus('Preparing context-padded detail template...');
    setLoadingPayload(null);

    let awaitingGuided = false;
    try {
      const layerCanvas = await renderLayerSourceToCanvas(
        basePuzzle,
        baseImage,
        targetLayerId,
        targetGrid
      );
      if (controller.signal.aborted || seq !== infiniteZoomOpSeqRef.current) {
        releaseCanvas(layerCanvas);
        return;
      }

      const tpl = await buildInfillTemplatePayload(
        layerCanvas,
        targetGrid,
        selectedCopy,
        metrics.bbox
      );
      if (controller.signal.aborted || seq !== infiniteZoomOpSeqRef.current) return;

      const nextDepth = resolveNextZoomDepth(basePuzzle, targetLayerId);
      const sanitizedPrompt = sanitizeUserPrompt(promptText).sanitized;
      const engineeredPrompt = buildNanoBananaInfillPrompt({
        userPrompt: promptText,
        neighborPaletteHex: metrics.neighborBoundaryHexes,
        depth: nextDepth,
        width: tpl.width,
        height: tpl.height,
      });

      const outcome = await runProviderOrOpenGuidedHandoff({
        seq,
        signal: controller.signal,
        direction: metrics.mode === 'in-place' ? 'in-place' : 'child-in',
        prompt: engineeredPrompt,
        templatePngBlob: tpl.templatePngBlob,
        templateDataUrl: tpl.templateDataUrl,
        width: tpl.width,
        height: tpl.height,
        onComplete: async (decoded, providerUsed, modelUsed, activeSignal) => {
          await commitZoomInResult({
            seq,
            signal: activeSignal,
            snapId,
            existingSnap,
            basePuzzle,
            baseImage,
            targetLayerId,
            targetGrid,
            selectedCopy,
            metrics,
            cropMask: tpl.cropMask,
            originalCropRgba: tpl.originalCropRgba,
            templateMeta: tpl.maskInTemplateRect,
            sanitizedPrompt,
            decoded,
            providerUsed,
            modelUsed,
            isFree,
          });
        },
      });
      awaitingGuided = outcome === 'awaiting-guided';
    } catch (err) {
      if (!isAbortLikeError(err)) {
        reportSwallowed('InfiniteZoom.confirmSubdivision', err);
        const msg =
          err instanceof Error && err.message
            ? err.message
            : 'Infinite Zoom detail generation failed.';
        showInfiniteZoomError(msg, err instanceof NanoBananaError ? err.code : undefined);
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      if (seq === infiniteZoomOpSeqRef.current && !awaitingGuided) {
        setIsInfiniteZoomRunning(false);
        setIsLoading(false);
        setLoadingPayload(null);
      }
    }
  }, [
    activeSnapshotId,
    clearGuidedSession,
    clearInfiniteZoomError,
    clearUndoSubdivision,
    commitZoomInResult,
    exitRegionSelectionMode,
    filledRegionIds,
    infiniteZoomPrompt,
    isFreeColorMode,
    isInfiniteZoomDisabled,
    paintedRegionColors,
    puzzle,
    renderLayerSourceToCanvas,
    runProviderOrOpenGuidedHandoff,
    selectedRegionIds,
    selectionLayerId,
    setIsLoading,
    setLoadingPayload,
    setLoadingProgress,
    setLoadingStatus,
    showInfiniteZoomError,
    snapshots,
    sourceImage,
  ]);

  const commitZoomOutResult = useCallback(
    async (opts: {
      seq: number;
      signal: AbortSignal;
      snapId: string;
      existingSnap: SavedSnapshot | undefined;
      basePuzzle: PuzzleData;
      baseImage: HTMLImageElement;
      sides: BorderExtensionSides;
      check: ExtendSidesCheck;
      originalInnerRgba: Uint8ClampedArray;
      sanitizedPrompt: string;
      decoded: DecodedGeminiImage;
      providerUsed: InfiniteZoomProviderMode;
      modelUsed: NanoBananaModelId;
      isFree: boolean;
    }) => {
      const {
        seq,
        signal,
        snapId,
        existingSnap,
        basePuzzle,
        baseImage,
        sides,
        check,
        originalInnerRgba,
        sanitizedPrompt,
        decoded,
        providerUsed,
        modelUsed,
        isFree,
      } = opts;

      const isAborted = () => signal.aborted || seq !== infiniteZoomOpSeqRef.current;
      if (isAborted()) return;

      setLoadingProgress(0.48);
      setLoadingStatus('Compositing pixel-locked outer borders...');
      const composited = compositeOutpaintRgba({
        originalInnerRgba,
        innerWidth: basePuzzle.width,
        innerHeight: basePuzzle.height,
        check,
        generatedRgba: decoded.rgba,
        generatedWidth: decoded.width,
        generatedHeight: decoded.height,
      });
      if (isAborted()) return;

      const borderMask = buildOutpaintBorderMask(
        composited.width,
        composited.height,
        check.offsetX,
        check.offsetY,
        check.innerWidth,
        check.innerHeight
      );
      const innerArea = Math.max(1, check.innerWidth * check.innerHeight);
      const outerArea = Math.max(1, composited.width * composited.height - innerArea);
      const proportionalTarget = Math.round(
        Math.max(1, basePuzzle.regions.length) * (outerArea / innerArea)
      );
      const targetSubRegions = Math.max(
        MIN_OUTPAINT_SUBREGIONS,
        Math.min(MAX_SUBDIVIDE_TARGET_REGIONS, proportionalTarget)
      );

      const outerSubResult = await PuzzleWorkerService.subdivideMaskedRegion(
        {
          rgbaData: composited.rgba,
          cropWidth: composited.width,
          cropHeight: composited.height,
          cropMask: borderMask,
          existingPalette: basePuzzle.palette,
          isFreeColor: isFree,
          targetSubRegions,
        },
        (prog, status) => {
          if (seq === infiniteZoomOpSeqRef.current) {
            setLoadingProgress(0.5 + Math.min(1, Math.max(0, prog)) * 0.35);
            setLoadingStatus(status);
          }
        }
      );
      if (isAborted()) return;

      setLoadingProgress(0.88);
      setLoadingStatus('Wrapping unified puzzle canvas...');

      const previousRootLayerId = makeUniqueLayerId('root_wrap');
      const previousRootImageBlobKey = buildCanonicalLayerImageKey(snapId, previousRootLayerId);

      const previousRootLayerBlob = await encodeImageToPuzzleBlob(baseImage, basePuzzle);
      if (isAborted()) return;

      const outerBlob = await encodeRgbaToBlob(
        composited.rgba,
        composited.width,
        composited.height,
        'image/webp',
        0.94
      );
      if (isAborted()) return;

      const { img: prevRootImg, objectUrl: prevRootObjUrl } =
        await decodeBlobToImage(previousRootLayerBlob);
      let outerObjUrl: string | null = null;
      let persistedToIdb = false;
      let committed = false;
      let previousRootBlob: Blob | null = null;
      let promotedFromSample = false;

      try {
        if (isAborted()) {
          revokeObjectUrlSafely(prevRootObjUrl);
          return;
        }

        const decodedOuter = await decodeBlobToImage(outerBlob);
        const outerImg = decodedOuter.img;
        outerObjUrl = decodedOuter.objectUrl;
        if (isAborted()) {
          revokeObjectUrlSafely(prevRootObjUrl);
          revokeObjectUrlSafely(outerObjUrl);
          return;
        }

        previousRootBlob = await loadPreviousRootBlobIfOwned(existingSnap, snapId);
        promotedFromSample = !previousRootBlob && isSamplePromotionMeta(existingSnap);
        if (isAborted()) {
          revokeObjectUrlSafely(prevRootObjUrl);
          revokeObjectUrlSafely(outerObjUrl);
          return;
        }

        const wrapResult = wrapPuzzleWithOuterBorderLayer({
          basePuzzle,
          outerSubResult,
          innerBoundsInOuter: check.boundsInParent,
          previousRootImageBlobKey,
          previousRootLayerId,
          promptHint: sanitizedPrompt || undefined,
          providerUsed,
          modelUsed,
        });

        persistedToIdb = true;
        const persisted = await persistZoomOutBlobsAndPuzzle({
          snapId,
          basePuzzle,
          nextPuzzle: wrapResult.puzzle,
          previousRootImageBlobKey,
          previousRootLayerBlob,
          outerBlob,
          previousRootBlob,
          promotedFromSample,
          outerObjUrl,
          prevRootObjUrl,
          isAborted,
        });
        if (!persisted) {
          persistedToIdb = false;
          return;
        }

        // 100% of painted progress, Undo stack, and Redo stack remain untouched (read live state)!
        const liveState = liveCoopRef.current;
        const preservedFilled = new Set(liveState.filledRegionIds);
        const preservedPainted = new Map(liveState.paintedRegionColors);
        const liveActiveColorId = liveState.activeColorId;
        const nextActiveColorId = resolvePostSubdivisionActiveColor(
          wrapResult.puzzle,
          preservedFilled,
          liveActiveColorId,
          outerSubResult.addedSwatches,
          settingsRef.current,
          visibleColorIdsRef.current,
          isFree
        );
        const previousLayerImages = new Map(liveLayerImagesRef.current);
        const previousViewport = { ...viewportRef.current };
        const previousBlobUrl = activeBlobUrlRef.current;

        const previewUrl = await renderHydratedPreview(
          wrapResult.puzzle,
          outerImg,
          preservedFilled,
          preservedPainted,
          'InfiniteZoom.zoomOutPreview'
        );
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
          persistedToIdb = false;
          return;
        }

        const preOpUndo: UndoInfiniteZoomSnapshot = {
          operationKind: 'zoom-out',
          snapshotId: snapId,
          puzzle: basePuzzle,
          sourceImage: baseImage,
          previousBlob: previousRootBlob,
          promotedFromSample,
          previousBlobUrl,
          newBlobUrl: outerObjUrl,
          addedLayerBlobKeys: [previousRootImageBlobKey],
          previousLayerImages,
          filledRegionIds: new Set(preservedFilled),
          paintedRegionColors: new Map(preservedPainted),
          undoStack: undoStackRef.current.slice(),
          redoStack: redoStackRef.current.slice(),
          activeColorId: liveActiveColorId,
          previousViewport,
          previousMeta: buildPreviousSnapshotMeta(existingSnap),
          addedRegionCount: wrapResult.addedOuterRegionIds.length,
        };

        const nextZoomTree: InfiniteZoomNodeMeta = {
          ...(existingSnap?.zoomTree || { depth: 0, direction: 'extend-out' }),
          direction: 'extend-out',
          extendedSides: { ...sides },
          promptHint: sanitizedPrompt || undefined,
          providerUsed,
          modelUsed,
        };
        const fittedViewport: CoopViewport = { zoomScale: 1, panOffsetX: 0, panOffsetY: 0 };
        const totalRegions = getTotalRegionCount(wrapResult.puzzle);
        const estSaveBytes = StorageService.estimatePuzzleSaveBytes(wrapResult.puzzle, previewUrl);
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
          wrapResult.puzzle.palette,
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

        ownedLayerBlobUrlsRef.current.set(previousRootImageBlobKey, prevRootObjUrl);
        const nextLiveLayerImages = new Map(previousLayerImages);
        nextLiveLayerImages.set(previousRootImageBlobKey, prevRootImg);

        liveCoopRef.current = {
          ...liveCoopRef.current,
          puzzle: wrapResult.puzzle,
          activeSave: syncedSave ?? liveCoopRef.current.activeSave,
          filledRegionIds: preservedFilled,
          paintedRegionColors: preservedPainted,
          activeColorId: nextActiveColorId,
        };
        setLiveLayerImages(nextLiveLayerImages);
        activeBlobUrlRef.current = outerObjUrl;
        setSourceImage(outerImg);
        setPuzzle(wrapResult.puzzle);
        setActiveColorId(nextActiveColorId);
        setHintRegionId(null);
        setSnapshots(updatedSnapshots);
        applyViewport?.(fittedViewport);
        committed = true;

        clearUndoToastTimer();
        undoSubdivisionRef.current = preOpUndo;
        setUndoSubdivisionState(preOpUndo);
        undoToastTimerRef.current = setTimeout(() => {
          clearUndoSubdivision();
        }, UNDO_TOAST_DURATION_MS);

        markTutorialActionTried('create_gallery');
        triggerFeatureOffer('infinite_zoom');
        NativeBridge.haptic('success', settingsRef.current.hapticsEnabled);
      } catch (err) {
        if (!committed) {
          if (persistedToIdb) {
            await rollbackAbortedLayerPersist({
              snapId,
              addedLayerBlobKeys: [previousRootImageBlobKey],
              newRootBlobUrl: outerObjUrl,
              newLayerObjectUrls: [prevRootObjUrl],
              previousRootBlob,
              promotedFromSample,
              basePuzzle,
            });
          } else {
            revokeObjectUrlSafely(prevRootObjUrl);
            if (outerObjUrl) {
              revokeObjectUrlSafely(outerObjUrl);
            }
          }
        }
        throw err;
      }
    },
    [
      activeBlobUrlRef,
      applyViewport,
      clearUndoSubdivision,
      clearUndoToastTimer,
      liveCoopRef,
      liveLayerImagesRef,
      markTutorialActionTried,
      redoStackRef,
      setActiveColorId,
      setHintRegionId,
      setLoadingProgress,
      setLoadingStatus,
      setPuzzle,
      setSnapshots,
      setSourceImage,
      settingsRef,
      triggerFeatureOffer,
      undoStackRef,
      undoSubdivisionRef,
      viewportRef,
      visibleColorIdsRef,
    ]
  );

  const handleConfirmExtendBorders = useCallback(
    async (sides: BorderExtensionSides, promptOverride?: string) => {
      if (!puzzle || !sourceImage || isInfiniteZoomDisabled) return;
      const check = canExtendSides(puzzle.width, puzzle.height, sides);
      if (!check.allowed) return;

      if (isReplayingRef.current) {
        exitReplay();
      }

      const promptText = typeof promptOverride === 'string' ? promptOverride : infiniteZoomPrompt;
      const basePuzzle = puzzle;
      const baseImage = sourceImage;
      const snapId = activeSnapshotId || crypto.randomUUID();
      const existingSnap = snapshots.find((s) => s.id === snapId);
      const isFree = Boolean(isFreeColorMode || basePuzzle.isFreeColor);

      exitRegionSelectionMode();
      clearUndoSubdivision();
      clearGuidedSession();
      clearInfiniteZoomError();

      const seq = ++infiniteZoomOpSeqRef.current;
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setIsInfiniteZoomRunning(true);
      setIsLoading(true);
      setLoadingProgress(0.05);
      setLoadingStatus('Preparing outward border template...');
      setLoadingPayload(null);

      let awaitingGuided = false;
      try {
        const rootCanvas = renderImageToCanvas(baseImage, basePuzzle.width, basePuzzle.height);
        const originalInnerRgba = readCanvasCropRgba(
          rootCanvas,
          0,
          0,
          basePuzzle.width,
          basePuzzle.height
        );
        let tpl: ReturnType<typeof buildOutpaintTemplateCanvas> | null = null;
        let templatePngBlob: Blob;
        let templateDataUrl: string;
        try {
          if (!originalInnerRgba) {
            throw new Error('Could not read pixel data from active puzzle artwork.');
          }
          tpl = buildOutpaintTemplateCanvas(rootCanvas, sides);
          const encoded = await canvasToPngBlobAndDataUrl(tpl.canvas);
          templatePngBlob = encoded.blob;
          templateDataUrl = encoded.dataUrl;
        } finally {
          releaseCanvas(tpl?.canvas);
          releaseCanvas(rootCanvas);
        }

        if (controller.signal.aborted || seq !== infiniteZoomOpSeqRef.current) return;

        const sanitizedPrompt = sanitizeUserPrompt(promptText).sanitized;
        const engineeredPrompt = buildNanoBananaOutpaintPrompt({
          userPrompt: promptText,
          sides,
          existingPaletteHex: basePuzzle.palette.map((c) => c.hex),
          width: tpl.width,
          height: tpl.height,
        });

        const outcome = await runProviderOrOpenGuidedHandoff({
          seq,
          signal: controller.signal,
          direction: 'extend-out',
          prompt: engineeredPrompt,
          templatePngBlob,
          templateDataUrl,
          width: tpl.width,
          height: tpl.height,
          onComplete: async (decoded, providerUsed, modelUsed, activeSignal) => {
            await commitZoomOutResult({
              seq,
              signal: activeSignal,
              snapId,
              existingSnap,
              basePuzzle,
              baseImage,
              sides,
              check: tpl.check,
              originalInnerRgba,
              sanitizedPrompt,
              decoded,
              providerUsed,
              modelUsed,
              isFree,
            });
          },
        });
        awaitingGuided = outcome === 'awaiting-guided';
      } catch (err) {
        if (!isAbortLikeError(err)) {
          reportSwallowed('InfiniteZoom.extendBorders', err);
          const msg =
            err instanceof Error && err.message
              ? err.message
              : 'Infinite Zoom border extension failed.';
          showInfiniteZoomError(msg, err instanceof NanoBananaError ? err.code : undefined);
        }
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
        if (seq === infiniteZoomOpSeqRef.current && !awaitingGuided) {
          setIsInfiniteZoomRunning(false);
          setIsLoading(false);
          setLoadingPayload(null);
        }
      }
    },
    [
      activeSnapshotId,
      clearGuidedSession,
      clearInfiniteZoomError,
      clearUndoSubdivision,
      commitZoomOutResult,
      exitRegionSelectionMode,
      exitReplay,
      infiniteZoomPrompt,
      isFreeColorMode,
      isInfiniteZoomDisabled,
      isReplayingRef,
      puzzle,
      runProviderOrOpenGuidedHandoff,
      setIsLoading,
      setLoadingPayload,
      setLoadingProgress,
      setLoadingStatus,
      showInfiniteZoomError,
      snapshots,
      sourceImage,
    ]
  );

  const handleCompleteGuidedGeminiHandoff = useCallback(
    async (input: Blob | File | string) => {
      const pending = pendingGuidedRef.current;
      if (!pending || pending.seq !== infiniteZoomOpSeqRef.current) {
        clearGuidedSession();
        return;
      }
      if (pending.isDecoding) {
        return;
      }
      pending.isDecoding = true;

      setGuidedHandoffSession((prev) =>
        prev ? { ...prev, isProcessing: true, errorMessage: null } : prev
      );

      let decoded: DecodedGeminiImage;
      try {
        decoded = await decodeReceivedGeminiImage(input);
      } catch (err) {
        if (pendingGuidedRef.current !== pending) {
          return;
        }
        pending.isDecoding = false;
        if (pending.seq !== infiniteZoomOpSeqRef.current) {
          clearGuidedSession();
          return;
        }
        const msg =
          err instanceof Error && err.message
            ? err.message
            : 'Could not read that image. Please paste or pick a valid PNG, JPEG, or WebP.';
        setGuidedHandoffSession((prev) =>
          prev ? { ...prev, isProcessing: false, errorMessage: msg } : prev
        );
        return;
      }

      if (pendingGuidedRef.current !== pending) {
        return;
      }
      if (pending.seq !== infiniteZoomOpSeqRef.current) {
        clearGuidedSession();
        return;
      }

      const seq = pending.seq;
      const completeFn = pending.complete;
      const cleanupFn = pending.cleanup;
      pendingGuidedRef.current = null;
      setGuidedHandoffSession(null);
      onGuidedHandoffOpenChangeRef.current?.(false);

      const controller = new AbortController();
      abortControllerRef.current = controller;
      setIsInfiniteZoomRunning(true);
      setIsLoading(true);
      setLoadingProgress(0.45);
      setLoadingStatus('Compositing generated artwork...');
      setLoadingPayload(null);

      try {
        await completeFn(decoded, controller.signal);
      } catch (err) {
        if (!isAbortLikeError(err)) {
          reportSwallowed('InfiniteZoom.guidedComplete', err);
          const msg =
            err instanceof Error && err.message
              ? err.message
              : 'Failed to apply generated image.';
          showInfiniteZoomError(msg);
        }
      } finally {
        cleanupFn?.();
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
        if (seq === infiniteZoomOpSeqRef.current) {
          setIsInfiniteZoomRunning(false);
          setIsLoading(false);
          setLoadingPayload(null);
        }
      }
    },
    [
      clearGuidedSession,
      onGuidedHandoffOpenChangeRef,
      setIsLoading,
      setLoadingPayload,
      setLoadingProgress,
      setLoadingStatus,
      showInfiniteZoomError,
    ]
  );

  const handleCancelGuidedGeminiHandoff = useCallback(() => {
    infiniteZoomOpSeqRef.current += 1;
    clearGuidedSession();
    setIsInfiniteZoomRunning(false);
    setIsLoading(false);
    setLoadingPayload(null);
  }, [clearGuidedSession, setIsLoading, setLoadingPayload]);

  const handleUndoSubdivision = useCallback(async () => {
    const snap = undoSubdivisionRef.current;
    if (!snap) {
      return;
    }
    if (snap.snapshotId !== activeSnapshotId) {
      clearUndoSubdivision();
      return;
    }

    clearUndoToastTimer();
    undoSubdivisionRef.current = null;
    setUndoSubdivisionState(null);

    const seq = ++infiniteZoomOpSeqRef.current;
    const expectedSnapshotId = snap.snapshotId;
    const isStale = () =>
      seq !== infiniteZoomOpSeqRef.current ||
      liveCoopRef.current.activeSnapshotId !== expectedSnapshotId;
    const revokePreviousIfUnused = () => {
      if (snap.previousBlobUrl && snap.previousBlobUrl !== activeBlobUrlRef.current) {
        revokeObjectUrlSafely(snap.previousBlobUrl);
      }
    };

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
      if (isStale()) {
        revokePreviousIfUnused();
        return;
      }
    }

    if (snap.previousBlob) {
      await StorageService.saveImageBlob(expectedSnapshotId, snap.previousBlob).catch((err) => {
        reportSwallowed('InfiniteZoom.undoSaveImageBlob', err, { id: expectedSnapshotId });
      });
      if (isStale()) {
        revokePreviousIfUnused();
        return;
      }
    }

    await StorageService.savePuzzleData(expectedSnapshotId, snap.puzzle).catch((err) => {
      reportSwallowed('InfiniteZoom.undoSavePuzzleData', err, { id: expectedSnapshotId });
    });
    if (isStale()) {
      revokePreviousIfUnused();
      return;
    }

    const isFree = Boolean(isFreeColorMode || snap.puzzle.isFreeColor);
    const nextResetEpoch = collectMonotonicResetEpoch(
      expectedSnapshotId,
      activeSave,
      liveCoopRef.current.activeSave
    );
    const orderedFilled = Array.from(snap.filledRegionIds);
    const paintedObj = Object.fromEntries(snap.paintedRegionColors);
    const restoredViewport =
      snap.operationKind === 'zoom-out' ? snap.previousViewport : viewportRef.current;
    const totalRegions = getTotalRegionCount(snap.puzzle);

    let previewUrl = snap.previousMeta.previewDataUrl;
    if (!previewUrl) {
      const hydrated = await hydrateLayerImagesForPuzzle(snap.puzzle, 'InfiniteZoom.undoPreview');
      try {
        previewUrl = generatePreviewDataUrl(
          snap.puzzle,
          snap.sourceImage,
          snap.filledRegionIds,
          snap.paintedRegionColors,
          hydrated.layerImages
        );
      } finally {
        hydrated.dispose();
      }
      if (isStale()) {
        revokePreviousIfUnused();
        return;
      }
    }
    const estSaveBytes = StorageService.estimatePuzzleSaveBytes(snap.puzzle, previewUrl);

    if (snap.newBlobUrl && snap.newBlobUrl !== snap.previousBlobUrl) {
      revokeObjectUrlSafely(snap.newBlobUrl);
    }
    activeBlobUrlRef.current = snap.previousBlobUrl;

    const restoredLayerImages = new Map(snap.previousLayerImages);
    const keepLayerKeys = new Set<string>(restoredLayerImages.keys());
    revokeOwnedLayerUrlsNotIn(keepLayerKeys);

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

    liveCoopRef.current = {
      ...liveCoopRef.current,
      puzzle: snap.puzzle,
      activeSave: syncedSave ?? liveCoopRef.current.activeSave,
      filledRegionIds: snap.filledRegionIds,
      paintedRegionColors: snap.paintedRegionColors,
      activeColorId: snap.activeColorId,
    };
    setLiveLayerImages(restoredLayerImages);
    setSourceImage(snap.sourceImage);
    setPuzzle(snap.puzzle);
    setFilledRegionIds(snap.filledRegionIds);
    setPaintedRegionColors(snap.paintedRegionColors);
    setActiveColorId(snap.activeColorId);
    setHintRegionId(null);
    syncUndoStack(snap.undoStack);
    syncRedoStack(snap.redoStack);
    setSnapshots(updatedSnapshots);
    if (snap.operationKind === 'zoom-out') {
      applyViewport?.(restoredViewport);
    }
    NativeBridge.haptic('tick', settingsRef.current.hapticsEnabled);
  }, [
    activeBlobUrlRef,
    activeSave,
    activeSnapshotId,
    applyViewport,
    clearUndoSubdivision,
    clearUndoToastTimer,
    isFreeColorMode,
    liveCoopRef,
    revokeOwnedLayerUrlsNotIn,
    setActiveColorId,
    setFilledRegionIds,
    setHintRegionId,
    setPaintedRegionColors,
    setPuzzle,
    setSnapshots,
    setSourceImage,
    settingsRef,
    syncRedoStack,
    syncUndoStack,
    undoSubdivisionRef,
    viewportRef,
  ]);

  return {
    isRegionSelectionMode,
    selectedRegionIds,
    selectionLayerId,
    selectionMetrics,
    pendingSwitchRegionId,
    selectionNotice,
    infiniteZoomPrompt,
    setInfiniteZoomPrompt,
    isInfiniteZoomRunning: effectiveInfiniteZoomRunning,
    isInfiniteZoomDisabled,
    infiniteZoomDisabledReason,
    undoSubdivisionState,
    liveLayerImages,
    guidedHandoffSession,
    infiniteZoomError,
    clearInfiniteZoomError,
    childSave,
    handleJumpToChildPuzzle,
    handleEnterRegionSelectionMode,
    exitRegionSelectionMode,
    handleRegionSelectTap,
    handleRegionSelectDragAdd,
    handleSwitchSelectionToPending,
    handleClearSelection,
    handleConfirmRegionSubdivision,
    handleConfirmExtendBorders,
    handleCompleteGuidedGeminiHandoff,
    handleCancelGuidedGeminiHandoff,
    handleUndoSubdivision,
    clearUndoSubdivision,
    cancelActiveInfiniteZoom,
    handleBeforeSnapshotResetOrSwitch,
  };
}
