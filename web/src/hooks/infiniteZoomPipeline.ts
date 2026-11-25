import {
  BorderExtensionSides,
  GeneratorConfig,
  InfiniteZoomProviderMode,
  NanoBananaModelId,
  NestedPuzzleLayer,
  NormalizedRect,
  PaletteColor,
  PuzzleData,
  SavedSnapshot,
  UserSettings,
} from '../types';
import { buildCanonicalLayerImageKey } from '../services/StorageService';
import { NativeBridge } from '../services/NativeBridge';
import { PuzzleWorkerService } from '../services/PuzzleWorkerService';
import {
  embedNestedDetailLayerIntoPuzzle,
  MAX_SUBDIVIDE_TARGET_REGIONS,
  MaskedSubdivisionResult,
  wrapPuzzleWithOuterBorderLayer,
} from '../engine/MaskedRegionSubdivider';
import {
  buildOutpaintBorderMask,
  buildUnifiedRegionIndex,
  getAllPuzzleRegions,
} from '../engine/UnifiedPuzzleLayers';
import { getDockPalette, getVisiblePalette } from '../components/PaletteDock';
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
  RegionGridLike,
  SelectionBbox,
  SelectionMetrics,
  toggleContiguousRegion,
} from '../services/ai/RegionSelectionEngine';
import {
  buildInfillTemplateCanvas,
  buildOutpaintTemplateCanvas,
  canvasToCompactTemplateBlobAndDataUrl,
  compositeInfillRgba,
  compositeOutpaintRgba,
  ExtendSidesCheck,
  NESTED_LAYER_MAX_DIM_PX,
  TemplateMaskRect,
} from '../services/ai/SeamCompositor';
import type { CoopViewport } from './useCoopSession';
import type { UndoHistoryEntry } from './useUndoRedo';
import {
  buildPreviousSnapshotMeta,
  commitZoomInStorageState,
  commitZoomOutStorageState,
  decodeBlobToImage,
  encodeImageToPuzzleBlob,
  encodeRgbaToBlob,
  loadPreviousRootBlobIfOwned,
  makeUniqueLayerId,
  persistZoomInBlobsAndPuzzle,
  persistZoomOutBlobsAndPuzzle,
  readCanvasCropRgba,
  releaseCanvas,
  renderHydratedPreview,
  renderImageToCanvas,
  renderLayerSourceToCanvas,
  resolveRootBlobPersistencePlan,
  revokeObjectUrlSafely,
  rollbackAbortedLayerPersist,
  UndoInfiniteZoomSnapshot,
} from './infiniteZoomPersistence';

export const ZOOM_IN_MAX_NEW_SWATCHES = 10;
export const MIN_OUTPAINT_SUBREGIONS = 24;
export const MAX_NESTED_UPSCALE_FACTOR = 4;

export const EMPTY_SELECTION_METRICS: SelectionMetrics = {
  regionCount: 0,
  area: 0,
  bbox: { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 },
  paintedCount: 0,
  neighborRegionIds: [],
  neighborBoundaryHexes: [],
  mode: 'in-place',
};

export function resolveInfiniteZoomAvailability(
  coopRoomCode: string | null,
  isLoading: boolean,
  isActiveReplayPlayback: boolean,
  hasSourceImage: boolean
): { isDisabled: boolean; disabledReason: string | undefined } {
  const isDisabled =
    Boolean(coopRoomCode) || isLoading || isActiveReplayPlayback || !hasSourceImage;
  const disabledReason = coopRoomCode
    ? 'Leave Co-op room to use Infinite Zoom'
    : isActiveReplayPlayback
      ? 'Pause or exit Replay to use Infinite Zoom'
      : undefined;
  return { isDisabled, disabledReason };
}

export interface PipelineLiveStateSnapshot {
  filledRegionIds: Set<number>;
  paintedRegionColors: Map<number, number>;
  activeColorId: number;
  activeSave: SavedSnapshot | undefined;
  undoStack: UndoHistoryEntry[];
  redoStack: UndoHistoryEntry[];
  liveLayerImages: Map<string, HTMLImageElement>;
  viewport: CoopViewport;
  activeBlobUrl: string | null;
  settings: UserSettings;
  visibleColorIds: Set<number>;
}

export type RegionTapSelectionOutcome =
  | { kind: 'noop' }
  | { kind: 'updated'; nextSelected: Set<number>; nextLayerId: string | null }
  | { kind: 'pending-switch'; targetLayerId: string | null; regionId: number }
  | { kind: 'bridge-blocked'; notice: string };

export interface InfillTemplatePayload {
  cropMask: Uint8Array;
  originalCropRgba: Uint8ClampedArray;
  width: number;
  height: number;
  maskInTemplateRect: TemplateMaskRect;
  templatePngBlob: Blob;
  templateDataUrl: string;
}

export interface OutpaintTemplatePayload {
  originalInnerRgba: Uint8ClampedArray;
  width: number;
  height: number;
  check: ExtendSidesCheck;
  templatePngBlob: Blob;
  templateDataUrl: string;
}

export interface PreparedZoomInOperation extends InfillTemplatePayload {
  sanitizedPrompt: string;
  engineeredPrompt: string;
}

export interface PreparedZoomOutOperation extends OutpaintTemplatePayload {
  sanitizedPrompt: string;
  engineeredPrompt: string;
}

export interface ExecuteAiProviderParams {
  settings: UserSettings;
  signal: AbortSignal;
  isAborted: () => boolean;
  direction: 'in-place' | 'child-in' | 'extend-out';
  prompt: string;
  templatePngBlob: Blob;
  templateDataUrl: string;
  width: number;
  height: number;
  onProgress?: (progress: number, status: string) => void;
}

export type AiProviderExecutionOutcome =
  | {
      status: 'decoded';
      decoded: DecodedGeminiImage;
      providerUsed: InfiniteZoomProviderMode;
      modelUsed: NanoBananaModelId;
    }
  | {
      status: 'guided';
      handoff: GuidedGeminiHandoffPackage;
      fallbackReason: string | null;
      modelUsed: NanoBananaModelId;
    }
  | { status: 'error'; message: string; code?: string }
  | { status: 'aborted' };

export interface ZoomInCommitPipelineParams {
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
  isAborted: () => boolean;
  readLiveState: () => PipelineLiveStateSnapshot;
  onProgress?: (progress: number, status: string) => void;
}

export interface ZoomInCommitPipelineResult {
  newLayer: NestedPuzzleLayer;
  nextPuzzle: PuzzleData;
  imageBlobKey: string;
  layerImg: HTMLImageElement;
  layerObjectUrl: string;
  previousLayerImages: Map<string, HTMLImageElement>;
  nextFilled: Set<number>;
  nextPainted: Map<number, number>;
  nextUndo: UndoHistoryEntry[];
  nextRedo: UndoHistoryEntry[];
  nextActiveColorId: number;
  updatedSnapshots: SavedSnapshot[];
  syncedSave: SavedSnapshot | undefined;
  preOpUndo: UndoInfiniteZoomSnapshot;
}

export interface ZoomOutCommitPipelineParams {
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
  isAborted: () => boolean;
  readLiveState: () => PipelineLiveStateSnapshot;
  onProgress?: (progress: number, status: string) => void;
}

export interface ZoomOutCommitPipelineResult {
  nextPuzzle: PuzzleData;
  outerImg: HTMLImageElement;
  outerObjUrl: string;
  prevRootImg: HTMLImageElement;
  prevRootObjUrl: string;
  previousRootImageBlobKey: string;
  previousLayerImages: Map<string, HTMLImageElement>;
  preservedFilled: Set<number>;
  preservedPainted: Map<number, number>;
  nextActiveColorId: number;
  updatedSnapshots: SavedSnapshot[];
  syncedSave: SavedSnapshot | undefined;
  preOpUndo: UndoInfiniteZoomSnapshot;
  fittedViewport: CoopViewport;
}

export function isAbortLikeError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  if (err instanceof NanoBananaError && err.code === 'ABORTED') return true;
  const name = (err as { name?: string }).name;
  return name === 'AbortError' || name === 'GenerationCancelledError';
}

export function countRemovedFilledRegions(
  filled: ReadonlySet<number>,
  removedIds: ReadonlySet<number>
): number {
  let removedFilledCount = 0;
  for (const id of removedIds) {
    if (filled.has(id)) removedFilledCount++;
  }
  return removedFilledCount;
}

export function resolveNextZoomDepth(
  basePuzzle: PuzzleData,
  targetLayerId: string | null
): number {
  if (targetLayerId === null) return 1;
  const targetLayer = basePuzzle.nestedLayers?.find((l) => l.layerId === targetLayerId) ?? null;
  return (targetLayer ? targetLayer.depth : 0) + 1;
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

export function computeZoomOutTargetSubRegions(
  baseRegionCount: number,
  check: ExtendSidesCheck,
  compositedWidth: number,
  compositedHeight: number
): number {
  const innerArea = Math.max(1, check.innerWidth * check.innerHeight);
  const outerArea = Math.max(1, compositedWidth * compositedHeight - innerArea);
  const proportionalTarget = Math.round(Math.max(1, baseRegionCount) * (outerArea / innerArea));
  return Math.max(
    MIN_OUTPAINT_SUBREGIONS,
    Math.min(MAX_SUBDIVIDE_TARGET_REGIONS, proportionalTarget)
  );
}

/**
 * Pure helper computing mean RGB chroma strictly over mask[i] === 1 pixels.
 */
export function computeSelectionMeanChroma(rgba: Uint8ClampedArray, mask: Uint8Array): number {
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

export function filterProgressForRemovedRegions(
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

export function computeRegionTapSelection(
  puzzle: PuzzleData,
  curSelected: ReadonlySet<number>,
  curLayerId: string | null,
  regionId: number,
  layerId?: string | null
): RegionTapSelectionOutcome {
  const targetLayerId =
    layerId !== undefined
      ? layerId
      : (buildUnifiedRegionIndex(puzzle).worldById.get(regionId)?.layerId ?? null);
  const targetGrid = resolveActiveSelectionGrid(puzzle, targetLayerId);
  if (!targetGrid) return { kind: 'noop' };
  const layerRegionMap = buildRegionByIdMap(targetGrid);
  if (!layerRegionMap.has(regionId)) return { kind: 'noop' };

  if (curSelected.size > 0 && targetLayerId !== curLayerId) {
    return { kind: 'pending-switch', targetLayerId, regionId };
  }

  const result = toggleContiguousRegion(targetGrid, curSelected, regionId, layerRegionMap);
  if (result.status === 'added' || result.status === 'removed') {
    const nextLayerId = result.nextSelected.size > 0 ? targetLayerId : null;
    return { kind: 'updated', nextSelected: result.nextSelected, nextLayerId };
  }
  if (result.status === 'non-adjacent') {
    return { kind: 'pending-switch', targetLayerId, regionId };
  }
  if (result.status === 'bridge-blocked') {
    return {
      kind: 'bridge-blocked',
      notice: 'Cannot unselect a connecting bridge region — clear or unselect ends first.',
    };
  }
  return { kind: 'noop' };
}

export function computeRegionDragSelection(
  puzzle: PuzzleData,
  curSelected: ReadonlySet<number>,
  curLayerId: string | null,
  candidateIds: ReadonlySet<number>
): { nextSelected: Set<number>; nextLayerId: string | null; changed: boolean } | null {
  if (candidateIds.size === 0) return null;
  let targetLayerId = curLayerId;

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
  if (!targetGrid) return null;
  const layerRegionMap = buildRegionByIdMap(targetGrid);
  const filtered: number[] = [];
  for (const id of candidateIds) {
    if (layerRegionMap.has(id)) {
      filtered.push(id);
    }
  }
  if (filtered.length === 0) return null;

  const nextSelected = addContiguousDragRegions(targetGrid, curSelected, filtered, layerRegionMap);
  const changed = nextSelected.size !== curSelected.size;
  const nextLayerId = curSelected.size === 0 && nextSelected.size > 0 ? targetLayerId : curLayerId;
  return { nextSelected, nextLayerId, changed };
}

export async function buildInfillTemplatePayload(
  layerCanvas: HTMLCanvasElement,
  targetGrid: RegionGridLike,
  selectedCopy: ReadonlySet<number>,
  bbox: SelectionBbox
): Promise<InfillTemplatePayload> {
  let tpl: ReturnType<typeof buildInfillTemplateCanvas> | null = null;
  try {
    const cropMask = buildSelectionMask(targetGrid, selectedCopy, bbox);
    const originalCropRgba = readCanvasCropRgba(
      layerCanvas,
      bbox.minX,
      bbox.minY,
      bbox.width,
      bbox.height
    );
    if (!originalCropRgba) {
      throw new Error('Could not read pixel data for selected region.');
    }
    tpl = buildInfillTemplateCanvas(layerCanvas, bbox, cropMask);
    const encoded = await canvasToCompactTemplateBlobAndDataUrl(tpl.canvas);
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

export async function buildOutpaintTemplatePayload(
  rootCanvas: HTMLCanvasElement,
  baseWidth: number,
  baseHeight: number,
  sides: BorderExtensionSides
): Promise<OutpaintTemplatePayload> {
  let tpl: ReturnType<typeof buildOutpaintTemplateCanvas> | null = null;
  try {
    const originalInnerRgba = readCanvasCropRgba(rootCanvas, 0, 0, baseWidth, baseHeight);
    if (!originalInnerRgba) {
      throw new Error('Could not read pixel data from active puzzle artwork.');
    }
    tpl = buildOutpaintTemplateCanvas(rootCanvas, sides);
    const encoded = await canvasToCompactTemplateBlobAndDataUrl(tpl.canvas);
    return {
      originalInnerRgba,
      width: tpl.width,
      height: tpl.height,
      check: tpl.check,
      templatePngBlob: encoded.blob,
      templateDataUrl: encoded.dataUrl,
    };
  } finally {
    releaseCanvas(tpl?.canvas);
    releaseCanvas(rootCanvas);
  }
}

export async function prepareZoomInOperation(opts: {
  basePuzzle: PuzzleData;
  baseImage: HTMLImageElement;
  targetLayerId: string | null;
  targetGrid: RegionGridLike;
  selectedCopy: ReadonlySet<number>;
  metrics: SelectionMetrics;
  promptText: string;
  liveLayerImages: ReadonlyMap<string, HTMLImageElement>;
  isAborted: () => boolean;
}): Promise<PreparedZoomInOperation | null> {
  const {
    basePuzzle,
    baseImage,
    targetLayerId,
    targetGrid,
    selectedCopy,
    metrics,
    promptText,
    liveLayerImages,
    isAborted,
  } = opts;
  const layerCanvas = await renderLayerSourceToCanvas(
    basePuzzle,
    baseImage,
    targetLayerId,
    targetGrid,
    liveLayerImages
  );
  if (isAborted()) {
    releaseCanvas(layerCanvas);
    return null;
  }
  const tpl = await buildInfillTemplatePayload(layerCanvas, targetGrid, selectedCopy, metrics.bbox);
  if (isAborted()) return null;

  const nextDepth = resolveNextZoomDepth(basePuzzle, targetLayerId);
  const sanitizedPrompt = sanitizeUserPrompt(promptText).sanitized;
  const engineeredPrompt = buildNanoBananaInfillPrompt({
    userPrompt: promptText,
    neighborPaletteHex: metrics.neighborBoundaryHexes,
    depth: nextDepth,
    width: tpl.width,
    height: tpl.height,
  });
  return { ...tpl, sanitizedPrompt, engineeredPrompt };
}

export async function prepareZoomOutOperation(opts: {
  basePuzzle: PuzzleData;
  baseImage: HTMLImageElement;
  sides: BorderExtensionSides;
  promptText: string;
  isAborted: () => boolean;
}): Promise<PreparedZoomOutOperation | null> {
  const { basePuzzle, baseImage, sides, promptText, isAborted } = opts;
  const rootCanvas = renderImageToCanvas(baseImage, basePuzzle.width, basePuzzle.height);
  const tpl = await buildOutpaintTemplatePayload(
    rootCanvas,
    basePuzzle.width,
    basePuzzle.height,
    sides
  );
  if (isAborted()) return null;

  const sanitizedPrompt = sanitizeUserPrompt(promptText).sanitized;
  const engineeredPrompt = buildNanoBananaOutpaintPrompt({
    userPrompt: promptText,
    sides,
    existingPaletteHex: basePuzzle.palette.map((c) => c.hex),
    width: tpl.width,
    height: tpl.height,
  });
  return { ...tpl, sanitizedPrompt, engineeredPrompt };
}

export async function executeAiProviderGeneration(
  opts: ExecuteAiProviderParams
): Promise<AiProviderExecutionOutcome> {
  const {
    settings,
    signal,
    isAborted,
    direction,
    prompt,
    templatePngBlob,
    templateDataUrl,
    width,
    height,
    onProgress,
  } = opts;
  const isAndroid = NativeBridge.isAndroidNative();
  const effectiveProvider: InfiniteZoomProviderMode =
    isAndroid && settings.infiniteZoomProvider === 'PUTER'
      ? 'GUIDED_GEMINI'
      : settings.infiniteZoomProvider;
  const model = settings.nanoBananaModel;
  const resolution = settings.nanoBananaResolution;

  const makeGuidedOutcome = (fallbackReason: string | null): AiProviderExecutionOutcome => ({
    status: 'guided',
    handoff: prepareGuidedGeminiHandoff({
      templatePngBlob,
      templateDataUrl,
      prompt,
      direction,
    }),
    fallbackReason,
    modelUsed: model,
  });

  if (effectiveProvider === 'GUIDED_GEMINI') {
    return makeGuidedOutcome(null);
  }

  try {
    onProgress?.(
      0.18,
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

    if (isAborted()) return { status: 'aborted' };

    onProgress?.(0.42, 'Validating generated image...');
    const decoded = await decodeReceivedGeminiImage(generationResult.blob);
    if (isAborted()) return { status: 'aborted' };

    return {
      status: 'decoded',
      decoded,
      providerUsed: generationResult.providerUsed,
      modelUsed: generationResult.modelUsed,
    };
  } catch (err) {
    if (isAborted() || isAbortLikeError(err)) {
      return { status: 'aborted' };
    }
    if (err instanceof NanoBananaError) {
      if (err.code === 'SAFETY_BLOCKED') {
        return { status: 'error', message: err.message, code: err.code };
      }
      if (err.canFallbackToGuided) {
        return makeGuidedOutcome(
          `${err.message} Switched to Free Gemini App Handoff so you can finish at $0 cost.`
        );
      }
      return { status: 'error', message: err.message, code: err.code };
    }
    throw err;
  }
}

export async function compositeAndSubdivideZoomIn(opts: {
  basePuzzle: PuzzleData;
  metrics: SelectionMetrics;
  cropMask: Uint8Array;
  originalCropRgba: Uint8ClampedArray;
  templateMeta: TemplateMaskRect;
  decoded: DecodedGeminiImage;
  isFree: boolean;
  generatorConfig?: GeneratorConfig;
  isAborted: () => boolean;
  onProgress?: (progress: number, status: string) => void;
}): Promise<{
  composited: ReturnType<typeof compositeInfillRgba>;
  subResult: MaskedSubdivisionResult;
} | null> {
  const {
    basePuzzle,
    metrics,
    cropMask,
    originalCropRgba,
    templateMeta,
    decoded,
    isFree,
    generatorConfig,
    isAborted,
    onProgress,
  } = opts;

  onProgress?.(0.48, 'Compositing pixel-locked seamless detail...');
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
  if (isAborted()) return null;

  let maskedPixelCount = 0;
  for (let i = 0; i < composited.mask.length; i++) {
    if (composited.mask[i] === 1) maskedPixelCount++;
  }
  const subBudget = computeZoomInSubdivisionParams({
    maskedPixelCount,
    basePuzzleRegionCount: basePuzzle.regions.length,
    generatorConfig,
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
      generatorConfig,
    },
    (prog, status) => {
      if (!isAborted()) {
        onProgress?.(0.5 + Math.min(1, Math.max(0, prog)) * 0.35, status);
      }
    }
  );
  if (isAborted()) return null;

  return { composited, subResult };
}

export async function runZoomInCommitPipeline(
  opts: ZoomInCommitPipelineParams
): Promise<ZoomInCommitPipelineResult | null> {
  const {
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
    isAborted,
    readLiveState,
    onProgress,
  } = opts;

  if (isAborted()) return null;

  const nextDepth = resolveNextZoomDepth(basePuzzle, targetLayerId);
  const subStep = await compositeAndSubdivideZoomIn({
    basePuzzle,
    metrics,
    cropMask,
    originalCropRgba,
    templateMeta,
    decoded,
    isFree,
    generatorConfig: readLiveState().settings.generatorConfig,
    isAborted,
    onProgress,
  });
  if (!subStep) return null;
  const { composited, subResult } = subStep;

  onProgress?.(0.88, 'Embedding seamless detail layer...');

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
  if (isAborted()) return null;

  const { img: layerImg, objectUrl: layerObjectUrl } = await decodeBlobToImage(layerPngBlob);
  let persistedToIdb = false;
  let committed = false;
  let previousRootBlob: Blob | null = null;
  let previousRootBlobKey: string | null = null;
  let promotedFromSample = false;
  let addedRootBlobKey: string | undefined;

  try {
    if (isAborted()) {
      revokeObjectUrlSafely(layerObjectUrl);
      return null;
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

    const prePersistLive = readLiveState();
    const previousLayerImages = new Map(prePersistLive.liveLayerImages);
    const previousViewport = { ...prePersistLive.viewport };
    const rootPlan = resolveRootBlobPersistencePlan(existingSnap, snapId, 'zoom-in');
    previousRootBlobKey = rootPlan.ownedPreviousRootBlobKey;
    previousRootBlob = previousRootBlobKey
      ? await loadPreviousRootBlobIfOwned(existingSnap, snapId)
      : null;
    promotedFromSample = !previousRootBlob && rootPlan.needsRootMaterialization;
    addedRootBlobKey = rootPlan.addedRootBlobKey;
    if (isAborted()) {
      revokeObjectUrlSafely(layerObjectUrl);
      return null;
    }

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
      rootImageBlobKey: rootPlan.targetRootBlobKey,
      addedRootBlobKey,
      isAborted,
    });
    if (!persisted) {
      return null;
    }
    persistedToIdb = true;

    const liveState = readLiveState();
    const removedIdSet = new Set(embedResult.removedRegionIds);
    const removedFilledCount = countRemovedFilledRegions(liveState.filledRegionIds, removedIdSet);
    const { nextFilled, nextPainted } = filterProgressForRemovedRegions(
      liveState.filledRegionIds,
      liveState.paintedRegionColors,
      removedIdSet
    );
    const nextUndo = scrubUndoHistoryForRemovedRegions(liveState.undoStack, removedIdSet);
    const nextRedo = scrubUndoHistoryForRemovedRegions(liveState.redoStack, removedIdSet);
    const nextActiveColorId = resolvePostSubdivisionActiveColor(
      embedResult.puzzle,
      nextFilled,
      liveState.activeColorId,
      subResult.addedSwatches,
      liveState.settings,
      liveState.visibleColorIds,
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
        addedRootBlobKey,
        previousRootBlobKey,
        newLayerObjectUrls: [layerObjectUrl],
        previousRootBlob,
        promotedFromSample,
        basePuzzle,
      });
      persistedToIdb = false;
      return null;
    }

    const postPreviewLive = readLiveState();
    const preOpUndo: UndoInfiniteZoomSnapshot = {
      operationKind: 'zoom-in',
      snapshotId: snapId,
      puzzle: basePuzzle,
      sourceImage: baseImage,
      previousBlob: previousRootBlob,
      ...(previousRootBlobKey ? { previousRootBlobKey } : {}),
      promotedFromSample,
      ...(addedRootBlobKey ? { addedRootBlobKey } : {}),
      previousBlobUrl: postPreviewLive.activeBlobUrl,
      newBlobUrl: postPreviewLive.activeBlobUrl,
      addedLayerBlobKeys: [imageBlobKey],
      previousLayerImages,
      filledRegionIds: new Set(liveState.filledRegionIds),
      paintedRegionColors: new Map(liveState.paintedRegionColors),
      undoStack: postPreviewLive.undoStack.slice(),
      redoStack: postPreviewLive.redoStack.slice(),
      activeColorId: liveState.activeColorId,
      previousViewport,
      previousMeta: buildPreviousSnapshotMeta(existingSnap),
      addedRegionCount: embedResult.addedRegionIds.length,
    };

    const { updatedSnapshots, syncedSave } = commitZoomInStorageState({
      snapId,
      existingSnap,
      liveActiveSave: liveState.activeSave,
      currentActiveSave: postPreviewLive.activeSave,
      nextPuzzle: embedResult.puzzle,
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
      viewport: postPreviewLive.viewport,
      rootImageBlobKey: rootPlan.targetRootBlobKey,
    });

    committed = true;
    return {
      newLayer: embedResult.layer,
      nextPuzzle: embedResult.puzzle,
      imageBlobKey,
      layerImg,
      layerObjectUrl,
      previousLayerImages,
      nextFilled,
      nextPainted,
      nextUndo,
      nextRedo,
      nextActiveColorId,
      updatedSnapshots,
      syncedSave,
      preOpUndo,
    };
  } catch (err) {
    if (!committed) {
      if (persistedToIdb) {
        await rollbackAbortedLayerPersist({
          snapId,
          addedLayerBlobKeys: [imageBlobKey],
          addedRootBlobKey,
          previousRootBlobKey,
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
}

export async function compositeAndSubdivideZoomOut(opts: {
  basePuzzle: PuzzleData;
  check: ExtendSidesCheck;
  originalInnerRgba: Uint8ClampedArray;
  decoded: DecodedGeminiImage;
  isFree: boolean;
  generatorConfig?: GeneratorConfig;
  isAborted: () => boolean;
  onProgress?: (progress: number, status: string) => void;
}): Promise<{
  composited: ReturnType<typeof compositeOutpaintRgba>;
  outerSubResult: MaskedSubdivisionResult;
} | null> {
  const {
    basePuzzle,
    check,
    originalInnerRgba,
    decoded,
    isFree,
    generatorConfig,
    isAborted,
    onProgress,
  } = opts;

  onProgress?.(0.48, 'Compositing pixel-locked outer borders...');
  const composited = compositeOutpaintRgba({
    originalInnerRgba,
    innerWidth: basePuzzle.width,
    innerHeight: basePuzzle.height,
    check,
    generatedRgba: decoded.rgba,
    generatedWidth: decoded.width,
    generatedHeight: decoded.height,
  });
  if (isAborted()) return null;

  const borderMask = buildOutpaintBorderMask(
    composited.width,
    composited.height,
    check.offsetX,
    check.offsetY,
    check.innerWidth,
    check.innerHeight
  );
  const targetSubRegions = computeZoomOutTargetSubRegions(
    basePuzzle.regions.length,
    check,
    composited.width,
    composited.height
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
      generatorConfig,
    },
    (prog, status) => {
      if (!isAborted()) {
        onProgress?.(0.5 + Math.min(1, Math.max(0, prog)) * 0.35, status);
      }
    }
  );
  if (isAborted()) return null;

  return { composited, outerSubResult };
}

export async function runZoomOutCommitPipeline(
  opts: ZoomOutCommitPipelineParams
): Promise<ZoomOutCommitPipelineResult | null> {
  const {
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
    isAborted,
    readLiveState,
    onProgress,
  } = opts;

  if (isAborted()) return null;

  const subStep = await compositeAndSubdivideZoomOut({
    basePuzzle,
    check,
    originalInnerRgba,
    decoded,
    isFree,
    generatorConfig: readLiveState().settings.generatorConfig,
    isAborted,
    onProgress,
  });
  if (!subStep) return null;
  const { composited, outerSubResult } = subStep;

  onProgress?.(0.88, 'Wrapping unified puzzle canvas...');

  const previousRootLayerId = makeUniqueLayerId('root_wrap');
  const previousRootImageBlobKey = buildCanonicalLayerImageKey(snapId, previousRootLayerId);

  const previousRootLayerBlob = await encodeImageToPuzzleBlob(baseImage, basePuzzle);
  if (isAborted()) return null;

  const outerBlob = await encodeRgbaToBlob(
    composited.rgba,
    composited.width,
    composited.height,
    'image/webp',
    0.94
  );
  if (isAborted()) return null;

  const { img: prevRootImg, objectUrl: prevRootObjUrl } =
    await decodeBlobToImage(previousRootLayerBlob);
  let outerObjUrl: string | null = null;
  let persistedToIdb = false;
  let committed = false;
  let previousRootBlob: Blob | null = null;
  let previousRootBlobKey: string | null = null;
  let promotedFromSample = false;
  let addedRootBlobKey: string | undefined;

  try {
    if (isAborted()) {
      revokeObjectUrlSafely(prevRootObjUrl);
      return null;
    }

    const decodedOuter = await decodeBlobToImage(outerBlob);
    const outerImg = decodedOuter.img;
    outerObjUrl = decodedOuter.objectUrl;
    if (isAborted()) {
      revokeObjectUrlSafely(prevRootObjUrl);
      revokeObjectUrlSafely(outerObjUrl);
      return null;
    }

    const rootPlan = resolveRootBlobPersistencePlan(existingSnap, snapId, 'zoom-out');
    previousRootBlobKey = rootPlan.ownedPreviousRootBlobKey;
    previousRootBlob = previousRootBlobKey
      ? await loadPreviousRootBlobIfOwned(existingSnap, snapId)
      : null;
    promotedFromSample = !previousRootBlob && rootPlan.needsRootMaterialization;
    addedRootBlobKey = rootPlan.addedRootBlobKey;
    if (isAborted()) {
      revokeObjectUrlSafely(prevRootObjUrl);
      revokeObjectUrlSafely(outerObjUrl);
      return null;
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

    const persisted = await persistZoomOutBlobsAndPuzzle({
      snapId,
      basePuzzle,
      nextPuzzle: wrapResult.puzzle,
      previousRootImageBlobKey,
      previousRootLayerBlob,
      outerBlob,
      previousRootBlob,
      previousRootBlobKey,
      promotedFromSample,
      rootImageBlobKey: rootPlan.targetRootBlobKey,
      addedRootBlobKey,
      outerObjUrl,
      prevRootObjUrl,
      isAborted,
    });
    if (!persisted) {
      return null;
    }
    persistedToIdb = true;

    // 100% of painted progress, Undo stack, and Redo stack remain untouched (read live state)!
    const liveState = readLiveState();
    const preservedFilled = new Set(liveState.filledRegionIds);
    const preservedPainted = new Map(liveState.paintedRegionColors);
    const liveActiveColorId = liveState.activeColorId;
    const nextActiveColorId = resolvePostSubdivisionActiveColor(
      wrapResult.puzzle,
      preservedFilled,
      liveActiveColorId,
      outerSubResult.addedSwatches,
      liveState.settings,
      liveState.visibleColorIds,
      isFree
    );
    const previousLayerImages = new Map(liveState.liveLayerImages);
    const previousViewport = { ...liveState.viewport };
    const previousBlobUrl = liveState.activeBlobUrl;

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
        addedRootBlobKey,
        previousRootBlobKey,
        newRootBlobUrl: outerObjUrl,
        newLayerObjectUrls: [prevRootObjUrl],
        previousRootBlob,
        promotedFromSample,
        basePuzzle,
      });
      persistedToIdb = false;
      return null;
    }

    const postPreviewLive = readLiveState();
    const preOpUndo: UndoInfiniteZoomSnapshot = {
      operationKind: 'zoom-out',
      snapshotId: snapId,
      puzzle: basePuzzle,
      sourceImage: baseImage,
      previousBlob: previousRootBlob,
      ...(previousRootBlobKey ? { previousRootBlobKey } : {}),
      promotedFromSample,
      ...(addedRootBlobKey ? { addedRootBlobKey } : {}),
      previousBlobUrl,
      newBlobUrl: outerObjUrl,
      addedLayerBlobKeys: [previousRootImageBlobKey],
      previousLayerImages,
      filledRegionIds: new Set(preservedFilled),
      paintedRegionColors: new Map(preservedPainted),
      undoStack: postPreviewLive.undoStack.slice(),
      redoStack: postPreviewLive.redoStack.slice(),
      activeColorId: liveActiveColorId,
      previousViewport,
      previousMeta: buildPreviousSnapshotMeta(existingSnap),
      addedRegionCount: wrapResult.addedOuterRegionIds.length,
    };

    const { updatedSnapshots, syncedSave, fittedViewport } = commitZoomOutStorageState({
      snapId,
      existingSnap,
      nextPuzzle: wrapResult.puzzle,
      preservedFilled,
      preservedPainted,
      nextActiveColorId,
      sides,
      sanitizedPrompt,
      providerUsed,
      modelUsed,
      previewUrl,
      isFree,
      rootImageBlobKey: rootPlan.targetRootBlobKey,
    });

    committed = true;
    return {
      nextPuzzle: wrapResult.puzzle,
      outerImg,
      outerObjUrl,
      prevRootImg,
      prevRootObjUrl,
      previousRootImageBlobKey,
      previousLayerImages,
      preservedFilled,
      preservedPainted,
      nextActiveColorId,
      updatedSnapshots,
      syncedSave,
      preOpUndo,
      fittedViewport,
    };
  } catch (err) {
    if (!committed) {
      if (persistedToIdb) {
        await rollbackAbortedLayerPersist({
          snapId,
          addedLayerBlobKeys: [previousRootImageBlobKey],
          addedRootBlobKey,
          previousRootBlobKey,
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
}

export interface ProviderFlowDispatchParams {
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
}

export type ProviderFlowStatus = 'completed' | 'awaiting-guided' | 'aborted';

export async function decodeGuidedHandoffInput(
  input: Blob | File | string
): Promise<{ ok: true; decoded: DecodedGeminiImage } | { ok: false; errorMessage: string }> {
  try {
    const decoded = await decodeReceivedGeminiImage(input);
    return { ok: true, decoded };
  } catch (err) {
    const errorMessage =
      err instanceof Error && err.message
        ? err.message
        : 'Could not read that image. Please paste or pick a valid PNG, JPEG, or WebP.';
    return { ok: false, errorMessage };
  }
}

export async function executeZoomInFlow(opts: {
  snapId: string;
  existingSnap: SavedSnapshot | undefined;
  basePuzzle: PuzzleData;
  baseImage: HTMLImageElement;
  targetLayerId: string | null;
  targetGrid: RegionGridLike;
  selectedCopy: Set<number>;
  metrics: SelectionMetrics;
  promptText: string;
  isFree: boolean;
  liveLayerImages: ReadonlyMap<string, HTMLImageElement>;
  isAborted: (activeSignal?: AbortSignal) => boolean;
  readLiveState: () => PipelineLiveStateSnapshot;
  onProgress: (progress: number, status: string) => void;
  dispatchProvider: (req: ProviderFlowDispatchParams) => Promise<ProviderFlowStatus>;
  onCommitted: (result: ZoomInCommitPipelineResult) => void;
}): Promise<ProviderFlowStatus> {
  const prepared = await prepareZoomInOperation({
    basePuzzle: opts.basePuzzle,
    baseImage: opts.baseImage,
    targetLayerId: opts.targetLayerId,
    targetGrid: opts.targetGrid,
    selectedCopy: opts.selectedCopy,
    metrics: opts.metrics,
    promptText: opts.promptText,
    liveLayerImages: opts.liveLayerImages,
    isAborted: () => opts.isAborted(),
  });
  if (!prepared) return 'aborted';

  return opts.dispatchProvider({
    direction: opts.metrics.mode === 'in-place' ? 'in-place' : 'child-in',
    prompt: prepared.engineeredPrompt,
    templatePngBlob: prepared.templatePngBlob,
    templateDataUrl: prepared.templateDataUrl,
    width: prepared.width,
    height: prepared.height,
    onComplete: async (decoded, providerUsed, modelUsed, activeSignal) => {
      const result = await runZoomInCommitPipeline({
        snapId: opts.snapId,
        existingSnap: opts.existingSnap,
        basePuzzle: opts.basePuzzle,
        baseImage: opts.baseImage,
        targetLayerId: opts.targetLayerId,
        targetGrid: opts.targetGrid,
        selectedCopy: opts.selectedCopy,
        metrics: opts.metrics,
        cropMask: prepared.cropMask,
        originalCropRgba: prepared.originalCropRgba,
        templateMeta: prepared.maskInTemplateRect,
        sanitizedPrompt: prepared.sanitizedPrompt,
        decoded,
        providerUsed,
        modelUsed,
        isFree: opts.isFree,
        isAborted: () => opts.isAborted(activeSignal),
        readLiveState: opts.readLiveState,
        onProgress: opts.onProgress,
      });
      if (result) opts.onCommitted(result);
    },
  });
}

export async function executeZoomOutFlow(opts: {
  snapId: string;
  existingSnap: SavedSnapshot | undefined;
  basePuzzle: PuzzleData;
  baseImage: HTMLImageElement;
  sides: BorderExtensionSides;
  promptText: string;
  isFree: boolean;
  isAborted: (activeSignal?: AbortSignal) => boolean;
  readLiveState: () => PipelineLiveStateSnapshot;
  onProgress: (progress: number, status: string) => void;
  dispatchProvider: (req: ProviderFlowDispatchParams) => Promise<ProviderFlowStatus>;
  onCommitted: (result: ZoomOutCommitPipelineResult) => void;
}): Promise<ProviderFlowStatus> {
  const prepared = await prepareZoomOutOperation({
    basePuzzle: opts.basePuzzle,
    baseImage: opts.baseImage,
    sides: opts.sides,
    promptText: opts.promptText,
    isAborted: () => opts.isAborted(),
  });
  if (!prepared) return 'aborted';

  return opts.dispatchProvider({
    direction: 'extend-out',
    prompt: prepared.engineeredPrompt,
    templatePngBlob: prepared.templatePngBlob,
    templateDataUrl: prepared.templateDataUrl,
    width: prepared.width,
    height: prepared.height,
    onComplete: async (decoded, providerUsed, modelUsed, activeSignal) => {
      const result = await runZoomOutCommitPipeline({
        snapId: opts.snapId,
        existingSnap: opts.existingSnap,
        basePuzzle: opts.basePuzzle,
        baseImage: opts.baseImage,
        sides: opts.sides,
        check: prepared.check,
        originalInnerRgba: prepared.originalInnerRgba,
        sanitizedPrompt: prepared.sanitizedPrompt,
        decoded,
        providerUsed,
        modelUsed,
        isFree: opts.isFree,
        isAborted: () => opts.isAborted(activeSignal),
        readLiveState: opts.readLiveState,
        onProgress: opts.onProgress,
      });
      if (result) opts.onCommitted(result);
    },
  });
}
