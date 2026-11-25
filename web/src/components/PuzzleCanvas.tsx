import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;
import {
  COOP_RIPPLE_DURATION_MS,
  CoopRippleBuffer,
  MAX_COOP_RIPPLES,
} from '../engine/CoopRippleBuffer';
import {
  buildUnifiedRegionIndex,
  getSortedNestedLayersAsc,
  getSortedNestedLayersDesc,
  isPuzzleOrganicCutout,
  isValidNormalizedRect,
  UnifiedRegionIndex,
  UnifiedRegionRef,
} from '../engine/UnifiedPuzzleLayers';
import { StorageService } from '../services/StorageService';
import {
  CANVAS_BG_MAP,
  CanvasBgColor,
  HintFillStyle,
  NestedPuzzleLayer,
  PaletteColor,
  PaletteSortOrder,
  Difficulty,
  PuzzleData,
  Region,
  RegionColorMode,
  RegionHighlightStyle,
} from '../types';
import {
  applyZoomSnapDetent,
  buildLayerSilhouettePath,
  buildMaskedPreviewCanvas,
  buildPreviewBorderCanvas,
  clampCanvasOffset,
  collectProminentVisibleLayerIds,
  collectUnifiedLineRegionIds,
  collectVisibleNestedLayers,
  computeFocusViewportForBounds,
  computeHighlightOverlayAlpha,
  computeLayerTexelRatio,
  disposeLayerCanvasCache,
  DrawPuzzleLayersParams,
  drawPuzzleBackdropIfOpaque,
  drawPuzzleCompositeLayers,
  evictLruLayerCaches,
  extractImagePixelsRgba,
  extractLayerSilhouetteContours,
  FocusBoundsRequest,
  getNextZoomStop,
  hasOverlappingDeeperVisibleLayer,
  isReadyCanvasImageSource,
  LAYER_SILHOUETTE_MIN_SCREEN_PX,
  LayerCanvasCache,
  LayerImageMapLike,
  LayerSmoothingConfig,
  lookupLayerImageFromMap,
  MAX_LIVE_LAYER_CACHES,
  MIN_LAYER_RENDER_SCREEN_PX,
  renderHighlightLayerToImageData,
  renderSelectionOverlayToImageData,
  resolveAnyUnifiedRegionAtPoint,
  resolveLayerImageSmoothing,
  resolvePuzzleMaxZoomScale,
  resolveUnifiedNearTapRegion,
  sampleUnifiedRegionAtWorldPoint,
  strokeLayerSilhouette,
  UnifiedHitResult,
} from './puzzleCanvasHelpers';

export {
  ALL_ZOOM_DETENT_STOPS,
  applyZoomSnapDetent,
  BASE_MAX_ZOOM_SCALE,
  buildLayerSilhouettePath,
  clampCanvasOffset,
  collectProminentVisibleLayerIds,
  collectUnifiedLineRegionIds,
  computeFocusViewportForBounds,
  computeLayerTexelRatio,
  computeMaxZoomScale,
  createFocusBoundsRequest,
  extractLayerSilhouetteContours,
  getNextZoomStop,
  MAX_INFINITE_ZOOM_SCALE,
  resolveAnyRegionAtPoint,
  resolveAnyUnifiedRegionAtPoint,
  resolveLayerImageSmoothing,
  resolvePuzzleMaxZoomScale,
  resolveUnifiedNearTapRegion,
  sampleUnifiedRegionAtWorldPoint,
  ZOOM_DETENT_STOPS,
} from './puzzleCanvasHelpers';
export type {
  ComputeFocusViewportParams,
  FocusBoundsRequest,
  FocusViewportResult,
  LayerImageMapLike,
  LayerSmoothingConfig,
  UnifiedHitResult,
} from './puzzleCanvasHelpers';

const EMPTY_REGION_MAP = new Map<number, Region>();
const EMPTY_WORLD_REGION_MAP = new Map<number, UnifiedRegionRef>();
const EMPTY_NESTED_LAYERS: NestedPuzzleLayer[] = [];
const LAYER_SMOOTHING_SCRATCH: LayerSmoothingConfig = {
  imageSmoothingEnabled: true,
  imageSmoothingQuality: 'high',
};

const FOCUS_GLIDE_DURATION_MS = 420;
const FOCUS_EPSILON_SCALE = 0.005;
const FOCUS_EPSILON_OFFSET_PX = 0.75;

function hasUsableFocusBounds(
  b: FocusBoundsRequest['bounds'] | null | undefined
): b is FocusBoundsRequest['bounds'] {
  if (
    !b ||
    !Number.isFinite(b.x) ||
    !Number.isFinite(b.y) ||
    !Number.isFinite(b.width) ||
    !Number.isFinite(b.height) ||
    b.width <= 0 ||
    b.height <= 0
  ) {
    return false;
  }
  const clampedW = Math.max(0, Math.min(1, b.x + b.width)) - Math.max(0, Math.min(1, b.x));
  const clampedH = Math.max(0, Math.min(1, b.y + b.height)) - Math.max(0, Math.min(1, b.y));
  return clampedW > 0 && clampedH > 0;
}

interface PuzzleCanvasProps {
  puzzle: PuzzleData | null;
  sourceImage: HTMLImageElement | null;
  activeColorId: number;
  filledRegionIds: Set<number>;
  hintRegionId: number | null;
  isPreviewMode: boolean;
  isPaintMode: boolean;
  isFreeColorMode?: boolean;
  difficulty?: Difficulty;
  fatFingerAssist?: boolean;
  touchReachRadiusPx?: number;
  paintedRegionColors?: Map<number, number>;
  canvasBgColor: CanvasBgColor;
  canvasBgArgb: number;
  sortOrder: PaletteSortOrder;
  regionColorMode: RegionColorMode;
  showRegionLabels: boolean;
  showPreviewLabels: boolean;
  showPreviewBorders: boolean;
  labelScale: number;
  minLabelSize?: number;
  maxLabelSize?: number;
  highlightMatching: boolean;
  highlightStyle: RegionHighlightStyle;
  hintColorArgb: number;
  hintFillStyle: HintFillStyle;
  animateHint: boolean;
  showNextRegionHint: boolean;
  hintIntensity: number;
  panMomentum?: boolean;
  reverseDoubleTapZoom?: boolean;
  zoomSensitivity?: number;
  snapZoomLevels?: boolean;
  reducedMotion?: boolean;
  displayNumberMap: Map<number, string>;
  zoomInTrigger?: number;
  zoomOutTrigger?: number;
  stepZoomTrigger?: number;
  resetViewTrigger?: number;
  restoreViewTrigger?: number;
  panStepRequest?: { seq: number; dx: number; dy: number };
  focusBoundsRequest?: FocusBoundsRequest | null;
  initialZoomScale?: number;
  initialPanOffsetX?: number;
  initialPanOffsetY?: number;
  isGenerating?: boolean;
  detailedProgress?: boolean;
  generationProgress?: number;
  generationStepIndex?: number;
  replayFollowRegionId?: number | null;
  replayFollowSequence?: number[] | null;
  replayFollowStep?: number;
  replaySpeed?: number;
  coopRippleBuffer?: CoopRippleBuffer;
  onViewExtentChanged?: (
    zoom: number,
    panX: number,
    panY: number,
    containerWidth?: number,
    containerHeight?: number
  ) => void;
  onManualPanStart?: () => void;
  onPuzzleInteraction?: () => void;
  onViewportGesture?: () => void;
  onRegionClicked: (regionId: number) => void;
  onBatchRegionsClicked: (regionIds: Set<number>) => void;
  onVisibleColorsChanged: (colorIds: Set<number>) => void;
  onVisibleRegionsChanged: (regionIds: Set<number>) => void;
  onVisibleNestedColorsChanged?: (colorIds: Set<number>) => void;
  onTogglePreview: () => void;
  activeSnapshotId?: string | null;
  isRegionSelectionMode?: boolean;
  selectedRegionIds?: ReadonlySet<number>;
  selectionLayerId?: string | null;
  layerImages?: LayerImageMapLike;
  onRegionSelectTap?: (regionId: number, layerId?: string | null) => void;
  onRegionSelectDragAdd?: (regionIds: Set<number>) => void;
}

export const TOUCH_REACH_RADIUS_MIN = 8;
export const TOUCH_REACH_RADIUS_MAX = 40;
export const TOUCH_REACH_RADIUS_DEFAULT = 22;
export const TOUCH_REACH_RADIUS_PRESETS = [12, 22, 34] as const;

export interface ResolveNearTapParams {
  width: number;
  height: number;
  regionMap: Int32Array;
  regionById: Map<number, Region>;
  filledRegionIds: Set<number>;
  canvasX: number;
  canvasY: number;
  activeColorId: number;
  difficulty: Difficulty;
  fatFingerAssist: boolean;
  touchReachRadiusPx: number;
  totalScreenScale: number;
  isFreeColorMode?: boolean;
}

/**
 * Zero-allocation radial near-tap hit-testing.
 * - O(1) fast-path when (floor(canvasX), floor(canvasY)) lands on a playable unfilled region.
 * - When fatFingerAssist is enabled and direct hit misses (border/filled/wrong-color),
 *   scans integer offsets inside Math.min(64, touchReachRadiusPx / totalScreenScale)
 *   using scalar distance registers with zero heap allocations.
 */
export function resolveNearTapRegionId(params: ResolveNearTapParams): number {
  const {
    width,
    height,
    regionMap,
    regionById,
    filledRegionIds,
    canvasX,
    canvasY,
    activeColorId,
    difficulty,
    fatFingerAssist,
    touchReachRadiusPx,
    totalScreenScale,
    isFreeColorMode = false,
  } = params;

  const lx = Math.floor(canvasX);
  const ly = Math.floor(canvasY);
  if (!Number.isFinite(lx) || !Number.isFinite(ly)) return 0;
  const allowAnyColor = difficulty === 'EASY' || isFreeColorMode;

  if (lx >= 0 && lx < width && ly >= 0 && ly < height) {
    const exactId = regionMap[ly * width + lx];
    if (exactId > 0) {
      if (isFreeColorMode) return exactId;
      if (!filledRegionIds.has(exactId)) {
        if (difficulty === 'EASY') return exactId;
        const exactReg = regionById.get(exactId);
        if (exactReg && exactReg.colorId === activeColorId) return exactId;
      }
    }
  }

  if (!fatFingerAssist || !(totalScreenScale > 0) || !(touchReachRadiusPx > 0)) {
    return 0;
  }

  const rawRadius = touchReachRadiusPx / totalScreenScale;
  const maxRFloat = rawRadius > 64 ? 64 : rawRadius;
  if (!(maxRFloat > 0)) return 0;

  const maxR = Math.ceil(maxRFloat);
  const maxRSq = maxRFloat * maxRFloat;

  let bestActiveId = 0;
  let bestActiveDistSq = Infinity;
  let bestAnyId = 0;
  let bestAnyDistSq = Infinity;

  for (let dy = -maxR; dy <= maxR; dy++) {
    const ny = ly + dy;
    if (ny < 0 || ny >= height) continue;
    const dySq = dy * dy;
    const rowOffset = ny * width;
    for (let dx = -maxR; dx <= maxR; dx++) {
      const distSq = dx * dx + dySq;
      if (distSq > maxRSq) continue;
      const nx = lx + dx;
      if (nx < 0 || nx >= width) continue;
      const candId = regionMap[rowOffset + nx];
      if (candId <= 0 || filledRegionIds.has(candId)) continue;
      const reg = regionById.get(candId);
      if (!reg) continue;
      if (reg.colorId === activeColorId) {
        if (distSq < bestActiveDistSq) {
          bestActiveDistSq = distSq;
          bestActiveId = candId;
        }
      } else if (allowAnyColor) {
        if (distSq < bestAnyDistSq) {
          bestAnyDistSq = distSq;
          bestAnyId = candId;
        }
      }
    }
  }

  return bestActiveId > 0 ? bestActiveId : allowAnyColor ? bestAnyId : 0;
}

/**
 * Writes a single region's pixels into a base RGBA ImageData buffer.
 * Completed (filled) regions never draw region boundaries so finished artwork
 * renders seamlessly; unfilled regions keep 1px slate borders in standard mode.
 */
export function writeRegionPixelsToImageData(
  data: Uint8ClampedArray,
  borderMap: Uint8Array,
  pixels: Int32Array | number[],
  r: number,
  g: number,
  b: number,
  isFilled: boolean,
  isDetailMode: boolean,
  srcPixels: Uint8ClampedArray | null,
  isColoring: boolean
): void {
  for (let i = 0; i < pixels.length; i++) {
    const pIndex = pixels[i];
    const idx = pIndex * 4;

    if (isFilled) {
      if (isColoring) {
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = 255;
      } else if (isDetailMode && srcPixels) {
        data[idx] = srcPixels[idx];
        data[idx + 1] = srcPixels[idx + 1];
        data[idx + 2] = srcPixels[idx + 2];
        data[idx + 3] = 255;
      } else {
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = 255;
      }
    } else if (!isColoring && borderMap[pIndex] === 1) {
      data[idx] = 51;
      data[idx + 1] = 65;
      data[idx + 2] = 85;
      data[idx + 3] = 255;
    } else {
      data[idx] = 255;
      data[idx + 1] = 255;
      data[idx + 2] = 255;
      data[idx + 3] = 255;
    }
  }
}

/**
 * Populates the full base RGBA ImageData buffer for a puzzle.
 * Completed (filled) regions omit boundary lines; unfilled regions retain 1px
 * slate borders in standard mode.
 */
export function writeBaseCanvasPixels(
  data: Uint8ClampedArray,
  regionMap: Int32Array,
  borderMap: Uint8Array,
  filledRegionIds: Set<number>,
  regMap: Map<number, Region>,
  palMap: Map<number, PaletteColor>,
  paintedRegionColors: Map<number, number> | undefined,
  isDetailMode: boolean,
  srcPixels: Uint8ClampedArray | null,
  isColoring: boolean
): void {
  const total = regionMap.length;
  for (let i = 0; i < total; i++) {
    const rId = regionMap[i];
    const idx = i * 4;
    if (rId <= 0) {
      data[idx] = 0;
      data[idx + 1] = 0;
      data[idx + 2] = 0;
      data[idx + 3] = 0;
      continue;
    }
    const isFilled = filledRegionIds.has(rId);

    if (isFilled) {
      const reg = regMap.get(rId);
      const targetColorId = reg ? (paintedRegionColors?.get(rId) ?? reg.colorId) : undefined;
      const col = targetColorId !== undefined ? palMap.get(targetColorId) : undefined;
      if (isColoring) {
        data[idx] = col ? col.r : 255;
        data[idx + 1] = col ? col.g : 255;
        data[idx + 2] = col ? col.b : 255;
        data[idx + 3] = 255;
      } else if (isDetailMode && srcPixels) {
        data[idx] = srcPixels[idx];
        data[idx + 1] = srcPixels[idx + 1];
        data[idx + 2] = srcPixels[idx + 2];
        data[idx + 3] = 255;
      } else {
        data[idx] = col ? col.r : 255;
        data[idx + 1] = col ? col.g : 255;
        data[idx + 2] = col ? col.b : 255;
        data[idx + 3] = 255;
      }
    } else if (!isColoring && borderMap[i] === 1) {
      data[idx] = 51;
      data[idx + 1] = 65;
      data[idx + 2] = 85;
      data[idx + 3] = 255;
    } else {
      data[idx] = 255;
      data[idx + 1] = 255;
      data[idx + 2] = 255;
      data[idx + 3] = 255;
    }
  }
}

export const PuzzleCanvas: React.FC<PuzzleCanvasProps> = React.memo(({
  puzzle,
  sourceImage,
  activeColorId,
  filledRegionIds,
  hintRegionId,
  isPreviewMode,
  isPaintMode,
  isFreeColorMode = false,
  difficulty = 'EASY',
  fatFingerAssist = true,
  touchReachRadiusPx = TOUCH_REACH_RADIUS_DEFAULT,
  paintedRegionColors,
  canvasBgColor,
  canvasBgArgb,
  regionColorMode,
  showRegionLabels,
  showPreviewLabels,
  showPreviewBorders,
  labelScale,
  minLabelSize = 6,
  maxLabelSize = 18,
  highlightMatching,
  highlightStyle,
  hintColorArgb,
  hintFillStyle,
  animateHint,
  showNextRegionHint,
  hintIntensity,
  panMomentum = true,
  reverseDoubleTapZoom = false,
  zoomSensitivity = 1.0,
  snapZoomLevels = false,
  reducedMotion = false,
  displayNumberMap,
  zoomInTrigger = 0,
  zoomOutTrigger = 0,
  stepZoomTrigger = 0,
  resetViewTrigger = 0,
  restoreViewTrigger = 0,
  panStepRequest,
  focusBoundsRequest = null,
  initialZoomScale = 1.0,
  initialPanOffsetX = 0,
  initialPanOffsetY = 0,
  isGenerating = false,
  detailedProgress = false,
  generationProgress = 0,
  generationStepIndex = 1,
  replayFollowRegionId = null,
  replayFollowSequence = null,
  replayFollowStep = 0,
  replaySpeed = 1,
  coopRippleBuffer,
  onViewExtentChanged,
  onManualPanStart,
  onPuzzleInteraction,
  onViewportGesture,
  onRegionClicked,
  onBatchRegionsClicked,
  onVisibleColorsChanged,
  onVisibleRegionsChanged,
  onVisibleNestedColorsChanged,
  onTogglePreview,
  activeSnapshotId = null,
  isRegionSelectionMode = false,
  selectedRegionIds,
  selectionLayerId,
  layerImages,
  onRegionSelectTap,
  onRegionSelectDragAdd,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const unifiedIndex = useMemo<UnifiedRegionIndex | null>(
    () => (puzzle ? buildUnifiedRegionIndex(puzzle) : null),
    [puzzle]
  );
  const rootRegionById = useMemo<Map<number, Region>>(() => {
    if (!puzzle) return EMPTY_REGION_MAP;
    const map = new Map<number, Region>();
    for (let i = 0; i < puzzle.regions.length; i++) {
      map.set(puzzle.regions[i].id, puzzle.regions[i]);
    }
    return map;
  }, [puzzle]);
  const sortedNestedLayersAsc = useMemo<NestedPuzzleLayer[]>(
    () => (puzzle ? getSortedNestedLayersAsc(puzzle) : EMPTY_NESTED_LAYERS),
    [puzzle]
  );
  const sortedNestedLayersDesc = useMemo<NestedPuzzleLayer[]>(
    () => (puzzle ? getSortedNestedLayersDesc(puzzle) : EMPTY_NESTED_LAYERS),
    [puzzle]
  );
  const maxZoomScale = useMemo<number>(() => resolvePuzzleMaxZoomScale(puzzle), [puzzle]);

  // Offscreen cached layer canvases (prevents 60 FPS full-pixel iteration)
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const baseImageDataRef = useRef<ImageData | null>(null);
  const paintedCacheRef = useRef<Set<number>>(new Set());
  const sourcePixelsRef = useRef<Uint8ClampedArray | null>(null);
  const unifiedRegionIndexRef = useRef<UnifiedRegionIndex | null>(unifiedIndex);
  const regionByIdRef = useRef<Map<number, Region>>(unifiedIndex?.byId ?? EMPTY_REGION_MAP);
  const rootRegionByIdRef = useRef<Map<number, Region>>(rootRegionById);
  const worldRegionByIdRef = useRef<Map<number, UnifiedRegionRef>>(
    unifiedIndex?.worldById ?? EMPTY_WORLD_REGION_MAP
  );
  const unifiedTotalCountRef = useRef<number>(unifiedIndex?.totalCount ?? 0);
  const sortedNestedLayersAscRef = useRef<NestedPuzzleLayer[]>(sortedNestedLayersAsc);
  const sortedNestedLayersDescRef = useRef<NestedPuzzleLayer[]>(sortedNestedLayersDesc);
  const puzzleRef = useRef<PuzzleData | null>(puzzle);
  const maxZoomScaleRef = useRef<number>(maxZoomScale);
  const selectionLayerIdRef = useRef<string | null | undefined>(selectionLayerId);
  const layerImagesPropRef = useRef<LayerImageMapLike | undefined>(layerImages);
  const paletteByIdRef = useRef<Map<number, PaletteColor>>(new Map());
  const lastBasePuzzleRef = useRef<PuzzleData | null>(null);
  const lastBaseModeRef = useRef<RegionColorMode | null>(null);
  const lastBaseImageRef = useRef<HTMLImageElement | null>(null);
  const lastBaseFreeColorRef = useRef<boolean>(false);
  const prevColorsRef = useRef<Map<number, number>>(new Map());
  const hasTransparentMaskRef = useRef<boolean>(false);

  // Multi-layer GPU canvas caches, LRU frame counter, overlay version counters, & async hydration state
  const layerCachesRef = useRef<Map<string, LayerCanvasCache>>(new Map());
  const dirtyLayerIdsRef = useRef<Set<string>>(new Set());
  const renderFrameCounterRef = useRef<number>(0);
  const highlightVersionRef = useRef<number>(0);
  const selectionVersionRef = useRef<number>(0);
  const hydratedLayerImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const ownedLayerObjectUrlsRef = useRef<Map<string, string>>(new Map());
  const loadingLayerKeysRef = useRef<Set<string>>(new Set());
  const failedLayerKeysRef = useRef<Set<string>>(new Set());
  const hydrationGenRef = useRef<number>(0);
  const lastHydrationPuzzleRef = useRef<PuzzleData | null>(null);

  // Pre-allocated hit-testing scratch objects (zero allocations in pointer hot paths)
  const hitScratchRef = useRef<UnifiedHitResult>({ regionId: 0, layerId: null, depth: 0 });
  const exactHitScratchRef = useRef<UnifiedHitResult>({ regionId: 0, layerId: null, depth: 0 });
  const paintLineScratchRef = useRef<Set<number>>(new Set());

  const highlightCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const highlightImageDataRef = useRef<ImageData | null>(null);
  const hasHighlightPixelsRef = useRef<boolean>(false);
  const borderCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastBorderPuzzleRef = useRef<PuzzleData | null>(null);
  const maskedPreviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastMaskedPreviewPuzzleRef = useRef<PuzzleData | null>(null);
  const lastMaskedPreviewImageRef = useRef<HTMLImageElement | null>(null);
  const selectionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const selectionImageDataRef = useRef<ImageData | null>(null);
  const hasSelectionPixelsRef = useRef<boolean>(false);
  const selectionLineScratchRef = useRef<Set<number>>(new Set());
  const visibleNestedLayersScratchRef = useRef<NestedPuzzleLayer[]>([]);
  const lastNestedColorsNonEmptyRef = useRef<boolean>(false);
  const drawLayersParamsRef = useRef<DrawPuzzleLayersParams>({
    puzzle: null as unknown as PuzzleData,
    sourceImage: null,
    hasTransparentMask: false,
    isEffectivePreview: false,
    showPreviewBorders: false,
    isFreeColorMode: false,
    isRegionSelectionMode: false,
    hasHighlightPixels: false,
    hasSelectionPixels: false,
    highlightStyle: 'FULL_REGION',
    animateHint: false,
    reducedMotion: false,
    hintIntensity: 0.7,
    currentPulseAlpha: 0.7,
    baseCanvas: null,
    borderCanvas: null,
    highlightCanvas: null,
    maskedPreviewCanvas: null,
    selectionCanvas: null,
  });

  // Synchronize unified multi-layer refs BEFORE any downstream layout/paint/replay effects run
  useIsomorphicLayoutEffect(() => {
    puzzleRef.current = puzzle;
    unifiedRegionIndexRef.current = unifiedIndex;
    regionByIdRef.current = unifiedIndex?.byId ?? EMPTY_REGION_MAP;
    rootRegionByIdRef.current = rootRegionById;
    worldRegionByIdRef.current = unifiedIndex?.worldById ?? EMPTY_WORLD_REGION_MAP;
    unifiedTotalCountRef.current = unifiedIndex?.totalCount ?? 0;
    sortedNestedLayersAscRef.current = sortedNestedLayersAsc;
    sortedNestedLayersDescRef.current = sortedNestedLayersDesc;
    maxZoomScaleRef.current = maxZoomScale;
    selectionLayerIdRef.current = selectionLayerId;
    layerImagesPropRef.current = layerImages;
  }, [
    puzzle,
    unifiedIndex,
    rootRegionById,
    sortedNestedLayersAsc,
    sortedNestedLayersDesc,
    maxZoomScale,
    selectionLayerId,
    layerImages,
  ]);

  // Cached canvas bounding rect for zero-layout-thrash pointer coordinate mapping
  const canvasRectRef = useRef<DOMRect | null>(null);
  const refreshCanvasRect = useCallback((): DOMRect | null => {
    const rect = canvasRef.current?.getBoundingClientRect() ?? null;
    canvasRectRef.current = rect;
    return rect;
  }, []);
  const getCachedCanvasRect = useCallback((): DOMRect | null => {
    if (canvasRectRef.current) return canvasRectRef.current;
    return refreshCanvasRect();
  }, [refreshCanvasRect]);

  // Transform state
  const [scale, setScale] = useState(initialZoomScale);
  const [offset, setOffset] = useState({ x: initialPanOffsetX, y: initialPanOffsetY });
  const scaleRef = useRef(initialZoomScale);
  const offsetRef = useRef({ x: initialPanOffsetX, y: initialPanOffsetY });

  const redrawRafIdRef = useRef<number | null>(null);
  const drawCompositeFrameRef = useRef<(pulseAlpha: number) => void>(() => {});
  const transformCommitTimerRef = useRef<number | null>(null);
  const lastTransformCommitMsRef = useRef<number>(0);

  const scheduleCanvasRedraw = useCallback(() => {
    if (typeof requestAnimationFrame !== 'function') {
      drawCompositeFrameRef.current(pulseAlphaRef.current);
      return;
    }
    if (redrawRafIdRef.current !== null) return;
    redrawRafIdRef.current = requestAnimationFrame(() => {
      redrawRafIdRef.current = null;
      drawCompositeFrameRef.current(pulseAlphaRef.current);
    });
  }, []);

  const commitTransformState = useCallback(
    (force: boolean = false) => {
      const flush = () => {
        if (transformCommitTimerRef.current !== null) {
          window.clearTimeout(transformCommitTimerRef.current);
          transformCommitTimerRef.current = null;
        }
        lastTransformCommitMsRef.current = performance.now();
        const s = scaleRef.current;
        const o = offsetRef.current;
        setScale((prev) => (prev === s ? prev : s));
        setOffset((prev) => (prev.x === o.x && prev.y === o.y ? prev : { x: o.x, y: o.y }));
      };
      if (force) {
        flush();
        return;
      }
      const elapsed = performance.now() - lastTransformCommitMsRef.current;
      if (elapsed >= 16) {
        flush();
      } else if (transformCommitTimerRef.current === null) {
        transformCommitTimerRef.current = window.setTimeout(flush, Math.max(1, 16 - elapsed));
      }
    },
    []
  );

  const effectiveZoomSensitivity = Math.min(
    2.0,
    Math.max(0.5, Number.isFinite(zoomSensitivity) ? zoomSensitivity : 1.0)
  );
  const effectiveZoomSensitivityRef = useRef(effectiveZoomSensitivity);
  const snapZoomLevelsRef = useRef(snapZoomLevels);
  const reducedMotionRef = useRef(reducedMotion);
  effectiveZoomSensitivityRef.current = effectiveZoomSensitivity;
  snapZoomLevelsRef.current = snapZoomLevels;
  reducedMotionRef.current = reducedMotion;

  // Pre-allocated scratch vectors for zero-allocation hot zoom/pan gesture math
  const gestureRawOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const gestureClampedOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Interactive feedback dot (stored in ref + demand-driven rAF loop; zero React state updates)
  const tapDotRef = useRef<{ x: number; y: number; alpha: number; lastTimeMs: number }>({
    x: 0,
    y: 0,
    alpha: 0,
    lastTimeMs: 0,
  });
  const tapDotRafIdRef = useRef<number | null>(null);

  // Animation pulse (stored in ref to avoid 60 FPS React state reconciliation)
  const pulseAlphaRef = useRef(0.7);

  // Drag & Pinch interaction tracking
  const isDraggingRef = useRef(false);
  const paintedInGestureRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const lastPointerPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const totalDragDistanceRef = useRef(0);
  const isRightClickRef = useRef(false);
  const touchStartDistRef = useRef<number | null>(null);
  const initialTouchCenterRef = useRef<{ x: number; y: number } | null>(null);
  const initialTouchScaleRef = useRef(1);
  const initialTouchOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const wasPinchingRef = useRef(false);
  const isPinchPanningRef = useRef(false);
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const touchPointerCountRef = useRef(0);

  // One-finger double-tap-and-drag zoom tracking (Google Maps style)
  const lastTapUpTimeRef = useRef(0);
  const lastTapUpPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const isDoubleTapCandidateRef = useRef(false);
  const isOneFingerZoomingRef = useRef(false);
  const isDoubleTapPanningRef = useRef(false);
  const doubleTapFocalRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragZoomStartYRef = useRef(0);
  const initialDragZoomScaleRef = useRef(1);
  const initialDragZoomOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const isTouchingOutsideImageRef = useRef(false);

  // Smooth Pan Momentum tracking via fixed 16-slot circular buffer (zero per-move allocations)
  const POINTER_RING_CAPACITY = 16;
  const pointerRingRef = useRef<Array<{ x: number; y: number; time: number }>>(
    Array.from({ length: POINTER_RING_CAPACITY }, () => ({ x: 0, y: 0, time: 0 }))
  );
  const pointerRingHeadRef = useRef(0);
  const pointerRingCountRef = useRef(0);
  const momentumAnimIdRef = useRef<number | null>(null);
  const focusAnimIdRef = useRef<number | null>(null);
  const lastHandledFocusSeqRef = useRef<number>(0);
  const focusLiveOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const focusRawScratchRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const focusClampedScratchRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const focusAnimStateRef = useRef<{
    startTimeMs: number;
    durationMs: number;
    startScale: number;
    targetScale: number;
    scaleRatio: number;
    scaleDelta: number;
    startOffsetX: number;
    startOffsetY: number;
    targetOffsetX: number;
    targetOffsetY: number;
    puzzleWidth: number;
    puzzleHeight: number;
    containerW: number;
    containerH: number;
  }>({
    startTimeMs: -1,
    durationMs: FOCUS_GLIDE_DURATION_MS,
    startScale: 1,
    targetScale: 1,
    scaleRatio: 1,
    scaleDelta: 0,
    startOffsetX: 0,
    startOffsetY: 0,
    targetOffsetX: 0,
    targetOffsetY: 0,
    puzzleWidth: 0,
    puzzleHeight: 0,
    containerW: 0,
    containerH: 0,
  });

  const resetPointerRing = useCallback((x: number, y: number, time: number) => {
    const slot = pointerRingRef.current[0];
    slot.x = x;
    slot.y = y;
    slot.time = time;
    pointerRingHeadRef.current = 1;
    pointerRingCountRef.current = 1;
  }, []);

  const pushPointerSample = useCallback((x: number, y: number, time: number) => {
    const idx = pointerRingHeadRef.current;
    const slot = pointerRingRef.current[idx];
    slot.x = x;
    slot.y = y;
    slot.time = time;
    pointerRingHeadRef.current = (idx + 1) % POINTER_RING_CAPACITY;
    if (pointerRingCountRef.current < POINTER_RING_CAPACITY) {
      pointerRingCountRef.current++;
    }
  }, []);

  const stopMomentum = useCallback(() => {
    if (momentumAnimIdRef.current !== null) {
      cancelAnimationFrame(momentumAnimIdRef.current);
      momentumAnimIdRef.current = null;
    }
  }, []);

  const cancelFocusAnimation = useCallback(
    (commitCurrent: boolean = false) => {
      if (focusAnimIdRef.current === null) return;
      cancelAnimationFrame(focusAnimIdRef.current);
      focusAnimIdRef.current = null;
      if (commitCurrent) {
        commitTransformState(true);
        const w = containerRef.current?.clientWidth || window.innerWidth;
        const h = containerRef.current?.clientHeight || window.innerHeight;
        onViewExtentChangedRef.current?.(
          scaleRef.current,
          offsetRef.current.x,
          offsetRef.current.y,
          w,
          h
        );
      }
    },
    [commitTransformState]
  );

  const stepFocusGlideRef = useRef<(now: number) => void>(() => {});
  const stepFocusGlide = useCallback(
    (now: number) => {
      focusAnimIdRef.current = null;
      const st = focusAnimStateRef.current;
      if (st.startTimeMs < 0) {
        st.startTimeMs = now;
      }
      const elapsed = Math.max(0, now - st.startTimeMs);
      const t = st.durationMs > 0 ? Math.min(1, elapsed / st.durationMs) : 1;
      const invT = 1 - t;
      const ease = 1 - invT * invT * invT;

      let nextScale: number;
      let rawX: number;
      let rawY: number;
      if (t >= 1) {
        nextScale = st.targetScale;
        rawX = st.targetOffsetX;
        rawY = st.targetOffsetY;
      } else {
        nextScale = st.startScale * Math.pow(st.scaleRatio, ease);
        const panAlpha =
          Math.abs(st.scaleDelta) < 1e-4 ? ease : (nextScale - st.startScale) / st.scaleDelta;
        rawX = st.startOffsetX + (st.targetOffsetX - st.startOffsetX) * panAlpha;
        rawY = st.startOffsetY + (st.targetOffsetY - st.startOffsetY) * panAlpha;
      }

      const rawScratch = focusRawScratchRef.current;
      rawScratch.x = rawX;
      rawScratch.y = rawY;
      const clamped = clampCanvasOffset(
        rawScratch,
        nextScale,
        st.puzzleWidth,
        st.puzzleHeight,
        st.containerW,
        st.containerH,
        focusClampedScratchRef.current
      );

      scaleRef.current = nextScale;
      offsetRef.current.x = clamped.x;
      offsetRef.current.y = clamped.y;
      scheduleCanvasRedraw();

      if (t < 1) {
        focusAnimIdRef.current = requestAnimationFrame(stepFocusGlideRef.current);
      } else {
        commitTransformState(true);
        onViewExtentChangedRef.current?.(
          nextScale,
          clamped.x,
          clamped.y,
          st.containerW,
          st.containerH
        );
      }
    },
    [scheduleCanvasRedraw, commitTransformState]
  );

  useIsomorphicLayoutEffect(() => {
    stepFocusGlideRef.current = stepFocusGlide;
  }, [stepFocusGlide]);

  useEffect(() => {
    return () => {
      stopMomentum();
      cancelFocusAnimation(false);
      if (redrawRafIdRef.current !== null) {
        cancelAnimationFrame(redrawRafIdRef.current);
        redrawRafIdRef.current = null;
      }
      if (transformCommitTimerRef.current !== null) {
        window.clearTimeout(transformCommitTimerRef.current);
        transformCommitTimerRef.current = null;
      }
    };
  }, [stopMomentum, cancelFocusAnimation]);

  const puzzleWidth = puzzle?.width ?? 0;
  const puzzleHeight = puzzle?.height ?? 0;

  // Reset or restore zoom/offset when a brand-new puzzle geometry or snapshot is loaded or viewport restoration triggers
  useEffect(() => {
    stopMomentum();
    cancelFocusAnimation(false);
    const clampedInitialScale = Math.min(maxZoomScaleRef.current, Math.max(0.5, initialZoomScale));
    let targetOffset = { x: initialPanOffsetX, y: initialPanOffsetY };
    const w = containerRef.current?.clientWidth || window.innerWidth;
    const h = containerRef.current?.clientHeight || window.innerHeight;
    if (containerRef.current && puzzleWidth > 0 && puzzleHeight > 0 && w > 0 && h > 0) {
      targetOffset = clampCanvasOffset(
        targetOffset,
        clampedInitialScale,
        puzzleWidth,
        puzzleHeight,
        w,
        h
      );
    }
    scaleRef.current = clampedInitialScale;
    offsetRef.current = { x: targetOffset.x, y: targetOffset.y };
    setScale(clampedInitialScale);
    setOffset({ x: targetOffset.x, y: targetOffset.y });
    onViewExtentChangedRef.current?.(clampedInitialScale, targetOffset.x, targetOffset.y, w, h);
  }, [
    puzzleWidth,
    puzzleHeight,
    activeSnapshotId,
    initialZoomScale,
    initialPanOffsetX,
    initialPanOffsetY,
    restoreViewTrigger,
    stopMomentum,
    cancelFocusAnimation,
  ]);

  // Handle FloatingActions & keyboard zoom in/out triggers synchronously on discrete events
  useIsomorphicLayoutEffect(() => {
    if (zoomInTrigger <= 0 || !containerRef.current || !puzzle) return;
    stopMomentum();
    cancelFocusAnimation(false);
    const currentScale = scaleRef.current;
    const currentOffset = offsetRef.current;
    const maxZoom = maxZoomScaleRef.current;
    const rawScale = Math.min(maxZoom, currentScale * Math.pow(1.25, effectiveZoomSensitivityRef.current));
    const newScale = applyZoomSnapDetent(rawScale, snapZoomLevelsRef.current, maxZoom);
    const actualZoom = newScale / currentScale;
    const w = containerRef.current.clientWidth;
    const h = containerRef.current.clientHeight;
    const baseScale = Math.min(w / puzzle.width, h / puzzle.height) * 0.92;
    const baseOffsetX = (w - puzzle.width * baseScale) / 2;
    const baseOffsetY = (h - puzzle.height * baseScale) / 2;

    const focalX = w / 2 - (currentOffset.x + baseOffsetX);
    const focalY = h / 2 - (currentOffset.y + baseOffsetY);
    const targetOffset = {
      x: currentOffset.x - focalX * (actualZoom - 1),
      y: currentOffset.y - focalY * (actualZoom - 1),
    };
    const clamped = clampCanvasOffset(targetOffset, newScale, puzzle.width, puzzle.height, w, h);
    scaleRef.current = newScale;
    offsetRef.current = clamped;
    setScale(newScale);
    setOffset({ x: clamped.x, y: clamped.y });
    onViewExtentChangedRef.current?.(newScale, clamped.x, clamped.y, w, h);
  }, [zoomInTrigger]);

  useIsomorphicLayoutEffect(() => {
    if (zoomOutTrigger <= 0 || !containerRef.current || !puzzle) return;
    stopMomentum();
    cancelFocusAnimation(false);
    const currentScale = scaleRef.current;
    const currentOffset = offsetRef.current;
    const rawScale = Math.max(0.5, currentScale * Math.pow(0.8, effectiveZoomSensitivityRef.current));
    const newScale = applyZoomSnapDetent(rawScale, snapZoomLevelsRef.current, maxZoomScaleRef.current);
    const actualZoom = newScale / currentScale;
    const w = containerRef.current.clientWidth;
    const h = containerRef.current.clientHeight;
    const baseScale = Math.min(w / puzzle.width, h / puzzle.height) * 0.92;
    const baseOffsetX = (w - puzzle.width * baseScale) / 2;
    const baseOffsetY = (h - puzzle.height * baseScale) / 2;

    const focalX = w / 2 - (currentOffset.x + baseOffsetX);
    const focalY = h / 2 - (currentOffset.y + baseOffsetY);
    const targetOffset = {
      x: currentOffset.x - focalX * (actualZoom - 1),
      y: currentOffset.y - focalY * (actualZoom - 1),
    };
    const clamped = clampCanvasOffset(targetOffset, newScale, puzzle.width, puzzle.height, w, h);
    scaleRef.current = newScale;
    offsetRef.current = clamped;
    setScale(newScale);
    setOffset({ x: clamped.x, y: clamped.y });
    onViewExtentChangedRef.current?.(newScale, clamped.x, clamped.y, w, h);
  }, [zoomOutTrigger]);

  // Handle GameTopBar zoom badge tap stepping through detent stops up to maxZoomScale anchored at viewport center
  useIsomorphicLayoutEffect(() => {
    if (stepZoomTrigger <= 0 || !containerRef.current || !puzzle) return;
    stopMomentum();
    cancelFocusAnimation(false);
    const currentScale = scaleRef.current;
    const currentOffset = offsetRef.current;
    const newScale = getNextZoomStop(currentScale, maxZoomScaleRef.current);
    const actualZoom = newScale / currentScale;
    const w = containerRef.current.clientWidth;
    const h = containerRef.current.clientHeight;
    const baseScale = Math.min(w / puzzle.width, h / puzzle.height) * 0.92;
    const baseOffsetX = (w - puzzle.width * baseScale) / 2;
    const baseOffsetY = (h - puzzle.height * baseScale) / 2;

    const focalX = w / 2 - (currentOffset.x + baseOffsetX);
    const focalY = h / 2 - (currentOffset.y + baseOffsetY);
    const targetOffset = {
      x: currentOffset.x - focalX * (actualZoom - 1),
      y: currentOffset.y - focalY * (actualZoom - 1),
    };
    const clamped = clampCanvasOffset(targetOffset, newScale, puzzle.width, puzzle.height, w, h);
    scaleRef.current = newScale;
    offsetRef.current = clamped;
    setScale(newScale);
    setOffset({ x: clamped.x, y: clamped.y });
    onViewExtentChangedRef.current?.(newScale, clamped.x, clamped.y, w, h);
  }, [stepZoomTrigger, stopMomentum, cancelFocusAnimation]);

  useIsomorphicLayoutEffect(() => {
    if (resetViewTrigger <= 0) return;
    stopMomentum();
    cancelFocusAnimation(false);
    const startScale = scaleRef.current;
    const startOffset = { ...offsetRef.current };
    const w = containerRef.current?.clientWidth || window.innerWidth;
    const h = containerRef.current?.clientHeight || window.innerHeight;
    if (
      reducedMotionRef.current ||
      (Math.abs(startScale - 1.0) < 0.01 && Math.hypot(startOffset.x, startOffset.y) < 1)
    ) {
      scaleRef.current = 1.0;
      offsetRef.current = { x: 0, y: 0 };
      setScale(1.0);
      setOffset({ x: 0, y: 0 });
      onViewExtentChangedRef.current?.(1.0, 0, 0, w, h);
      return;
    }

    let animId: number;
    const duration = 280;
    const startTime = performance.now();

    const stepZoomOut = (now: number) => {
      const t = Math.min(1, (now - startTime) / duration);
      const ease = 1 - Math.pow(1 - t, 3); // Cubic ease-out
      const nextScale = startScale + (1.0 - startScale) * ease;
      const nextX = startOffset.x * (1 - ease);
      const nextY = startOffset.y * (1 - ease);
      scaleRef.current = nextScale;
      offsetRef.current.x = nextX;
      offsetRef.current.y = nextY;
      setScale(nextScale);
      setOffset({ x: nextX, y: nextY });
      onViewExtentChangedRef.current?.(nextScale, nextX, nextY, w, h);
      if (t < 1) {
        animId = requestAnimationFrame(stepZoomOut);
      }
    };

    animId = requestAnimationFrame(stepZoomOut);
    return () => cancelAnimationFrame(animId);
  }, [resetViewTrigger, stopMomentum, cancelFocusAnimation]);

  // Handle crisp keyboard pan steps (Arrow keys / WASD) clamped via clampCanvasOffset
  useIsomorphicLayoutEffect(() => {
    if (!panStepRequest || panStepRequest.seq <= 0 || !containerRef.current || !puzzle) return;
    stopMomentum();
    cancelFocusAnimation(false);
    onManualPanStartRef.current?.();
    onViewportGestureRef.current?.();
    onPuzzleInteractionRef.current?.();
    const w = containerRef.current.clientWidth;
    const h = containerRef.current.clientHeight;
    if (w <= 0 || h <= 0) return;
    const cur = offsetRef.current;
    const clamped = clampCanvasOffset(
      { x: cur.x + panStepRequest.dx, y: cur.y + panStepRequest.dy },
      scaleRef.current,
      puzzle.width,
      puzzle.height,
      w,
      h
    );
    offsetRef.current = clamped;
    setScale(scaleRef.current);
    setOffset({ x: clamped.x, y: clamped.y });
    onViewExtentChangedRef.current?.(scaleRef.current, clamped.x, clamped.y, w, h);
  }, [panStepRequest, stopMomentum, cancelFocusAnimation]);

  const [containerSize, setContainerSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  // Ensure scale and offset are strictly clamped whenever scale, maxZoomScale, puzzle, or container size changes
  useEffect(() => {
    if (!containerRef.current || !puzzle) return;
    const w = containerRef.current.clientWidth;
    const h = containerRef.current.clientHeight;
    if (w <= 0 || h <= 0) return;
    const curScale = scaleRef.current;
    const nextScale = curScale > maxZoomScale ? maxZoomScale : curScale;
    const cur = offsetRef.current;
    const clamped = clampCanvasOffset(cur, nextScale, puzzle.width, puzzle.height, w, h);
    const scaleChanged = nextScale !== curScale;
    const offsetChanged = clamped.x !== cur.x || clamped.y !== cur.y;
    if (scaleChanged) {
      scaleRef.current = nextScale;
      setScale(nextScale);
    }
    if (offsetChanged) {
      offsetRef.current = clamped;
      setOffset({ x: clamped.x, y: clamped.y });
    }
    if (scaleChanged || offsetChanged) {
      onViewExtentChangedRef.current?.(nextScale, clamped.x, clamped.y, w, h);
    }
  }, [scale, maxZoomScale, puzzle, containerSize]);

  // Smooth cancellable auto-camera focus glide onto newly generated Zoom In detail areas
  useEffect(() => {
    if (
      !focusBoundsRequest ||
      focusBoundsRequest.seq <= 0 ||
      focusBoundsRequest.seq === lastHandledFocusSeqRef.current
    ) {
      return;
    }
    const activePuzzle = puzzleRef.current;
    const container = containerRef.current;
    if (!activePuzzle || !container) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w <= 0 || h <= 0) return;

    const b = focusBoundsRequest.bounds;
    if (!hasUsableFocusBounds(b)) {
      lastHandledFocusSeqRef.current = focusBoundsRequest.seq;
      return;
    }

    lastHandledFocusSeqRef.current = focusBoundsRequest.seq;
    stopMomentum();
    cancelFocusAnimation(false);

    const target = computeFocusViewportForBounds({
      bounds: b,
      puzzleWidth: activePuzzle.width,
      puzzleHeight: activePuzzle.height,
      containerWidth: w,
      containerHeight: h,
      maxZoomScale: maxZoomScaleRef.current,
    });

    const startScale =
      Number.isFinite(scaleRef.current) && scaleRef.current > 0 ? scaleRef.current : 1;
    const startOffsetX = Number.isFinite(offsetRef.current.x) ? offsetRef.current.x : 0;
    const startOffsetY = Number.isFinite(offsetRef.current.y) ? offsetRef.current.y : 0;

    // Detach offsetRef from any object shared with React `offset` state (zero per-frame allocs)
    const liveOffset = focusLiveOffsetRef.current;
    liveOffset.x = startOffsetX;
    liveOffset.y = startOffsetY;
    offsetRef.current = liveOffset;

    const isAlreadyAtTarget =
      Math.abs(target.zoomScale - startScale) <= FOCUS_EPSILON_SCALE &&
      Math.hypot(target.panOffsetX - startOffsetX, target.panOffsetY - startOffsetY) <=
        FOCUS_EPSILON_OFFSET_PX;

    if (
      reducedMotionRef.current ||
      typeof requestAnimationFrame !== 'function' ||
      isAlreadyAtTarget
    ) {
      scaleRef.current = target.zoomScale;
      liveOffset.x = target.panOffsetX;
      liveOffset.y = target.panOffsetY;
      scheduleCanvasRedraw();
      commitTransformState(true);
      onViewExtentChangedRef.current?.(
        target.zoomScale,
        target.panOffsetX,
        target.panOffsetY,
        w,
        h
      );
      return;
    }

    const st = focusAnimStateRef.current;
    st.startTimeMs = -1;
    st.durationMs = FOCUS_GLIDE_DURATION_MS;
    st.startScale = startScale;
    st.targetScale = target.zoomScale;
    st.scaleRatio = target.zoomScale / startScale;
    st.scaleDelta = target.zoomScale - startScale;
    st.startOffsetX = startOffsetX;
    st.startOffsetY = startOffsetY;
    st.targetOffsetX = target.panOffsetX;
    st.targetOffsetY = target.panOffsetY;
    st.puzzleWidth = activePuzzle.width;
    st.puzzleHeight = activePuzzle.height;
    st.containerW = w;
    st.containerH = h;

    focusAnimIdRef.current = requestAnimationFrame(stepFocusGlideRef.current);
  }, [
    focusBoundsRequest,
    cancelFocusAnimation,
    stopMomentum,
    scheduleCanvasRedraw,
    commitTransformState,
  ]);

  // Smooth predictive camera controller for Replay Follow Mode:
  // - Safe-frame dead-zone: never moves the viewport while upcoming regions remain comfortably inside the screen
  // - Predictive lookahead: anticipates upcoming region completions (up to 10 steps ahead) to frame clusters in a single glide
  // - Critically-damped 2D spring-damper (SmoothDamp): C1-continuous velocity with smooth ease-in and ease-out (zero jerk)
  const onManualPanStartRef = useRef(onManualPanStart);
  onManualPanStartRef.current = onManualPanStart;
  const onPuzzleInteractionRef = useRef(onPuzzleInteraction);
  onPuzzleInteractionRef.current = onPuzzleInteraction;
  const onViewportGestureRef = useRef(onViewportGesture);
  onViewportGestureRef.current = onViewportGesture;
  const hasNotifiedManualPanRef = useRef(false);
  const replayFollowRegionIdRef = useRef<number | null>(replayFollowRegionId ?? null);
  replayFollowRegionIdRef.current = replayFollowRegionId ?? null;
  const replayFollowSequenceRef = useRef<number[] | null>(replayFollowSequence ?? null);
  replayFollowSequenceRef.current = replayFollowSequence ?? null;
  const replayFollowStepRef = useRef<number>(replayFollowStep ?? 0);
  replayFollowStepRef.current = replayFollowStep ?? 0;
  const replaySpeedRef = useRef<number>(replaySpeed || 1);
  replaySpeedRef.current = replaySpeed || 1;
  const followRawScratchRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const followClampedScratchRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const followAnchorOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const followVelRef = useRef<{ vx: number; vy: number }>({ vx: 0, vy: 0 });
  const isFollowingReplay = replayFollowRegionId !== null && replayFollowRegionId !== undefined;
  const isSmoothFollowingReplay = isFollowingReplay && !reducedMotion;

  // Reduced-motion Replay Follow: snap directly without multi-frame SmoothDamp glide or rAF loop
  useEffect(() => {
    if (!isFollowingReplay || !reducedMotion || !puzzle || !containerRef.current) return;
    if (replayFollowRegionId === null || replayFollowRegionId === undefined) return;
    const isUserInteracting =
      isDraggingRef.current ||
      activePointersRef.current.size > 0 ||
      isOneFingerZoomingRef.current ||
      isDoubleTapPanningRef.current ||
      focusAnimIdRef.current !== null;
    if (isUserInteracting) return;

    const curScale = scaleRef.current;
    const regRef = worldRegionByIdRef.current.get(replayFollowRegionId);
    const w = containerRef.current.clientWidth;
    const h = containerRef.current.clientHeight;
    if (!regRef || w <= 0 || h <= 0 || curScale <= 1.05) return;

    const baseScale = Math.min(w / puzzle.width, h / puzzle.height) * 0.92;
    const baseOffsetX = (w - puzzle.width * baseScale) / 2;
    const baseOffsetY = (h - puzzle.height * baseScale) / 2;
    const effScale = curScale * baseScale;
    const safeLeft = w * 0.18;
    const safeRight = w * 0.82;
    const safeTop = Math.max(68, h * 0.18);
    const safeBottom = h - Math.max(92, h * 0.22);
    const curOff = offsetRef.current;
    const regScreenX = curOff.x + baseOffsetX + regRef.worldCentroidX * effScale;
    const regScreenY = curOff.y + baseOffsetY + regRef.worldCentroidY * effScale;
    if (
      regScreenX < safeLeft ||
      regScreenX > safeRight ||
      regScreenY < safeTop ||
      regScreenY > safeBottom
    ) {
      const safeCenterX = w * 0.5;
      const safeCenterY = (safeTop + safeBottom) * 0.5;
      const clamped = clampCanvasOffset(
        {
          x: safeCenterX - baseOffsetX - regRef.worldCentroidX * effScale,
          y: safeCenterY - baseOffsetY - regRef.worldCentroidY * effScale,
        },
        curScale,
        puzzle.width,
        puzzle.height,
        w,
        h
      );
      offsetRef.current = clamped;
      setOffset({ x: clamped.x, y: clamped.y });
      onViewExtentChangedRef.current?.(curScale, clamped.x, clamped.y, w, h);
    }
  }, [isFollowingReplay, reducedMotion, puzzle, replayFollowRegionId]);

  useEffect(() => {
    if (!isSmoothFollowingReplay || !puzzle) return;
    let animId: number;
    let lastTime = performance.now();

    // Initialize anchor to current viewport offset and zero velocity so camera starts completely still
    followAnchorOffsetRef.current.x = offsetRef.current.x;
    followAnchorOffsetRef.current.y = offsetRef.current.y;
    followVelRef.current.vx = 0;
    followVelRef.current.vy = 0;

    const stepFollow = (now: number) => {
      const dt = Math.min(64, Math.max(0, now - lastTime));
      lastTime = now;

      const targetRegionId = replayFollowRegionIdRef.current;
      const isUserInteracting =
        isDraggingRef.current ||
        activePointersRef.current.size > 0 ||
        isOneFingerZoomingRef.current ||
        isDoubleTapPanningRef.current ||
        momentumAnimIdRef.current !== null ||
        focusAnimIdRef.current !== null;

      if (targetRegionId !== null && !isUserInteracting && containerRef.current) {
        const curScale = scaleRef.current;
        const regRef = worldRegionByIdRef.current.get(targetRegionId);
        const w = containerRef.current.clientWidth;
        const h = containerRef.current.clientHeight;
        // Only pan when zoomed in (> 1.05x); never change scale or shift a fit-to-screen puzzle
        if (regRef && w > 0 && h > 0 && curScale > 1.05) {
          const baseScale = Math.min(w / puzzle.width, h / puzzle.height) * 0.92;
          const baseOffsetX = (w - puzzle.width * baseScale) / 2;
          const baseOffsetY = (h - puzzle.height * baseScale) / 2;
          const effScale = curScale * baseScale;

          // Inner Safe-Frame Dead-Zone: do not move camera while upcoming regions stay inside this frame
          const safeLeft = w * 0.18;
          const safeRight = w * 0.82;
          const safeTop = Math.max(68, h * 0.18);
          const safeBottom = h - Math.max(92, h * 0.22);
          const safeCenterX = w * 0.5;
          const safeCenterY = (safeTop + safeBottom) * 0.5;
          const safeHalfW = Math.max(60, (safeRight - safeLeft) * 0.45);
          const safeHalfH = Math.max(60, (safeBottom - safeTop) * 0.45);

          const anchor = followAnchorOffsetRef.current;
          const regAnchorX = anchor.x + baseOffsetX + regRef.worldCentroidX * effScale;
          const regAnchorY = anchor.y + baseOffsetY + regRef.worldCentroidY * effScale;
          const isCurrentOutsideSafeZone =
            regAnchorX < safeLeft ||
            regAnchorX > safeRight ||
            regAnchorY < safeTop ||
            regAnchorY > safeBottom;

          // Predictive lookahead: check if the next few upcoming regions (steps +1..+4) are about to exit the safe zone
          const seq = replayFollowSequenceRef.current;
          const curStep = replayFollowStepRef.current;
          let isLookaheadApproachingEdge = false;
          if (!isCurrentOutsideSafeZone && seq && curStep < seq.length) {
            const lookTriggerEnd = Math.min(seq.length, curStep + 5);
            for (let i = curStep + 1; i < lookTriggerEnd; i++) {
              const futureRef = worldRegionByIdRef.current.get(seq[i]);
              if (!futureRef) continue;
              // Only anticipate if the future region is part of a nearby progression (fits in safe frame with current region)
              if (
                Math.abs(futureRef.worldCentroidX - regRef.worldCentroidX) * effScale <= safeHalfW &&
                Math.abs(futureRef.worldCentroidY - regRef.worldCentroidY) * effScale <= safeHalfH
              ) {
                const fx = anchor.x + baseOffsetX + futureRef.worldCentroidX * effScale;
                const fy = anchor.y + baseOffsetY + futureRef.worldCentroidY * effScale;
                if (fx < safeLeft || fx > safeRight || fy < safeTop || fy > safeBottom) {
                  isLookaheadApproachingEdge = true;
                  break;
                }
              } else {
                break;
              }
            }
          }

          // Only update the camera anchor when current or anticipated upcoming regions approach the screen edge
          if (isCurrentOutsideSafeZone || isLookaheadApproachingEdge) {
            let sumWX = regRef.worldCentroidX;
            let sumWY = regRef.worldCentroidY;
            let sumW = 1.0;

            // Predict future region completions (up to 10 steps ahead) that fit in the same safe frame as regRef
            if (seq && curStep < seq.length) {
              const horizonEnd = Math.min(seq.length, curStep + 10);
              for (let i = curStep + 1; i < horizonEnd; i++) {
                const futureRef = worldRegionByIdRef.current.get(seq[i]);
                if (!futureRef) continue;
                const dxPx = Math.abs(futureRef.worldCentroidX - regRef.worldCentroidX) * effScale;
                const dyPx = Math.abs(futureRef.worldCentroidY - regRef.worldCentroidY) * effScale;
                if (dxPx <= safeHalfW && dyPx <= safeHalfH) {
                  const weight = 1 / (1 + (i - curStep) * 0.22);
                  sumWX += futureRef.worldCentroidX * weight;
                  sumWY += futureRef.worldCentroidY * weight;
                  sumW += weight;
                } else {
                  break;
                }
              }
            }

            const predCentroidX = sumWX / sumW;
            const predCentroidY = sumWY / sumW;

            const rawScratch = followRawScratchRef.current;
            rawScratch.x = safeCenterX - baseOffsetX - predCentroidX * effScale;
            rawScratch.y = safeCenterY - baseOffsetY - predCentroidY * effScale;
            const clampedTarget = clampCanvasOffset(
              rawScratch,
              curScale,
              puzzle.width,
              puzzle.height,
              w,
              h,
              followClampedScratchRef.current
            );
            anchor.x = clampedTarget.x;
            anchor.y = clampedTarget.y;
          }

          // Critically-damped 2D spring-damper (SmoothDamp) toward anchor
          const curOff = offsetRef.current;
          const dx = curOff.x - anchor.x;
          const dy = curOff.y - anchor.y;
          const dist = Math.hypot(dx, dy);
          const vel = followVelRef.current;
          const speed = Math.hypot(vel.vx, vel.vy);

          if (dist > 0.35 || speed > 2.0) {
            const dtSec = Math.max(0.001, dt / 1000);
            const spd = replaySpeedRef.current;
            const smoothTime = Math.max(0.12, Math.min(0.32, 0.26 / Math.sqrt(Math.max(0.5, spd))));
            const omega = 2 / smoothTime;
            const xParam = omega * dtSec;
            const exp =
              1 / (1 + xParam + 0.48 * xParam * xParam + 0.235 * xParam * xParam * xParam);

            const tempX = (vel.vx + omega * dx) * dtSec;
            const tempY = (vel.vy + omega * dy) * dtSec;
            vel.vx = (vel.vx - omega * tempX) * exp;
            vel.vy = (vel.vy - omega * tempY) * exp;

            const nextX = anchor.x + (dx + tempX) * exp;
            const nextY = anchor.y + (dy + tempY) * exp;
            offsetRef.current.x = nextX;
            offsetRef.current.y = nextY;
            setOffset({ x: nextX, y: nextY });
            onViewExtentChangedRef.current?.(curScale, nextX, nextY, w, h);
          } else if (dist > 0) {
            vel.vx = 0;
            vel.vy = 0;
          }
        }
      }

      animId = requestAnimationFrame(stepFollow);
    };

    animId = requestAnimationFrame(stepFollow);
    return () => cancelAnimationFrame(animId);
  }, [isSmoothFollowingReplay, puzzle]);

  // Demand-driven tap dot decay rAF loop (zero React state updates; sleeps completely when expired)
  const stepTapDotRef = useRef<(now: number) => void>(() => {});
  const stepTapDot = useCallback((now: number) => {
    tapDotRafIdRef.current = null;
    const dot = tapDotRef.current;
    if (dot.alpha <= 0) return;

    const dt = Math.max(0, now - dot.lastTimeMs);
    dot.lastTimeMs = now;
    const nextAlpha = dot.alpha * Math.pow(0.75, dt / 30);
    if (nextAlpha <= 0.05) {
      dot.alpha = 0;
      drawCompositeFrameRef.current(pulseAlphaRef.current);
      return;
    }
    dot.alpha = nextAlpha;
    drawCompositeFrameRef.current(pulseAlphaRef.current);
    if (typeof requestAnimationFrame === 'function') {
      tapDotRafIdRef.current = requestAnimationFrame(stepTapDotRef.current);
    }
  }, []);
  stepTapDotRef.current = stepTapDot;

  const triggerTapDot = useCallback((x: number, y: number) => {
    const dot = tapDotRef.current;
    dot.x = x;
    dot.y = y;
    dot.alpha = 1;
    dot.lastTimeMs = performance.now();
    drawCompositeFrameRef.current(pulseAlphaRef.current);
    if (typeof requestAnimationFrame === 'function' && tapDotRafIdRef.current === null) {
      tapDotRafIdRef.current = requestAnimationFrame(stepTapDotRef.current);
    }
  }, []);

  // Helper to paint a single region into baseImageData
  const writeRegionToImageData = useCallback(
    (
      data: Uint8ClampedArray,
      puzzleData: PuzzleData,
      region: Region,
      isFilled: boolean,
      isDetailMode: boolean,
      srcPixels: Uint8ClampedArray | null,
      paletteMap: Map<number, PaletteColor>,
      customColors?: Map<number, number>,
      isFreeColor?: boolean
    ) => {
      const targetColorId = customColors?.get(region.id) ?? region.colorId;
      const col = paletteMap.get(targetColorId);
      const r = col?.r ?? 71;
      const g = col?.g ?? 85;
      const b = col?.b ?? 105;
      const isColoring = Boolean(isFreeColor || puzzleData.isFreeColor);

      writeRegionPixelsToImageData(
        data,
        puzzleData.borderMap,
        region.pixels,
        r,
        g,
        b,
        isFilled,
        isDetailMode,
        srcPixels,
        isColoring
      );
    },
    []
  );

  // 1. Update Offscreen Base Canvas & Materialized Nested Layer Caches (Incremental Dirty-Rect on region fill!)
  useEffect(() => {
    if (!puzzle) {
      disposeAllLayerCaches(layerCachesRef.current);
      failedLayerKeysRef.current.clear();
      baseCanvasRef.current = null;
      baseImageDataRef.current = null;
      lastBasePuzzleRef.current = null;
      hasTransparentMaskRef.current = false;
      return;
    }

    const { width, height, palette, regionMap, borderMap } = puzzle;
    const isDetailMode = regionColorMode === 'DETAIL';
    const isNewPuzzle = lastBasePuzzleRef.current !== puzzle;

    const needsFullRebuild =
      isNewPuzzle ||
      lastBaseModeRef.current !== regionColorMode ||
      lastBaseImageRef.current !== sourceImage ||
      lastBaseFreeColorRef.current !== isFreeColorMode ||
      !baseCanvasRef.current ||
      !baseImageDataRef.current;

    if (needsFullRebuild) {
      hasTransparentMaskRef.current = isPuzzleOrganicCutout(puzzle);

      const palMap = new Map<number, PaletteColor>();
      for (let i = 0; i < palette.length; i++) {
        palMap.set(palette[i].id, palette[i]);
      }
      paletteByIdRef.current = palMap;

      if (isNewPuzzle) {
        disposeAllLayerCaches(layerCachesRef.current);
        failedLayerKeysRef.current.clear();
        highlightVersionRef.current += 1;
        selectionVersionRef.current += 1;
      } else {
        for (const cache of layerCachesRef.current.values()) {
          cache.lastMode = null;
        }
      }

      sourcePixelsRef.current =
        sourceImage && isReadyCanvasImageSource(sourceImage)
          ? extractImagePixelsRgba(sourceImage, width, height)
          : null;

      if (!baseCanvasRef.current) {
        baseCanvasRef.current = document.createElement('canvas');
      }
      baseCanvasRef.current.width = width;
      baseCanvasRef.current.height = height;
      const baseCtx = baseCanvasRef.current.getContext('2d')!;
      const imgData = baseCtx.createImageData(width, height);
      const data = imgData.data;
      const srcPixels = sourcePixelsRef.current;

      const isColoring = Boolean(isFreeColorMode || puzzle.isFreeColor);
      writeBaseCanvasPixels(
        data,
        regionMap,
        borderMap,
        filledRegionIds,
        rootRegionByIdRef.current,
        palMap,
        paintedRegionColors,
        isDetailMode,
        srcPixels,
        isColoring
      );

      baseCtx.putImageData(imgData, 0, 0);
      baseImageDataRef.current = imgData;
      paintedCacheRef.current = new Set(filledRegionIds);
      prevColorsRef.current = new Map(paintedRegionColors || []);
      lastBasePuzzleRef.current = puzzle;
      lastBaseModeRef.current = regionColorMode;
      lastBaseImageRef.current = sourceImage;
      lastBaseFreeColorRef.current = isFreeColorMode;
      return;
    }

    applyIncrementalBaseCanvasUpdate(
      puzzle,
      baseCanvasRef.current!,
      baseImageDataRef.current!,
      sourcePixelsRef.current,
      paletteByIdRef.current,
      worldRegionByIdRef.current,
      layerCachesRef.current,
      dirtyLayerIdsRef.current,
      paintedCacheRef.current,
      prevColorsRef.current,
      filledRegionIds,
      paintedRegionColors,
      isDetailMode,
      isFreeColorMode,
      writeRegionToImageData
    );

    lastBaseFreeColorRef.current = isFreeColorMode;
  }, [puzzle, sourceImage, regionColorMode, filledRegionIds, paintedRegionColors, isFreeColorMode, writeRegionToImageData]);

  // 2. Update Offscreen Highlight Layer (Only rebuilt when activeColorId/hintRegionId/style changes)
  useEffect(() => {
    highlightVersionRef.current += 1;
    if (
      !puzzle ||
      (highlightStyle !== 'FULL_REGION' && highlightStyle !== 'BOUNDARY_ONLY') ||
      (!highlightMatching && hintRegionId === null)
    ) {
      hasHighlightPixelsRef.current = false;
      return;
    }

    const { width, height, borderMap } = puzzle;
    if (!highlightCanvasRef.current) {
      highlightCanvasRef.current = document.createElement('canvas');
    }
    if (highlightCanvasRef.current.width !== width || highlightCanvasRef.current.height !== height) {
      highlightCanvasRef.current.width = width;
      highlightCanvasRef.current.height = height;
      highlightImageDataRef.current = null;
    }

    const hCtx = highlightCanvasRef.current.getContext('2d')!;
    let imgData = highlightImageDataRef.current;
    if (!imgData || imgData.width !== width || imgData.height !== height) {
      imgData = hCtx.createImageData(width, height);
      highlightImageDataRef.current = imgData;
    } else {
      imgData.data.fill(0);
    }

    const activePal = puzzle.palette.find((c) => c.id === activeColorId);
    const anyPixel = renderHighlightLayerToImageData(
      imgData.data,
      width,
      height,
      borderMap,
      puzzle.regions,
      filledRegionIds,
      activeColorId,
      hintRegionId,
      highlightMatching,
      highlightStyle,
      hintFillStyle,
      hintColorArgb,
      activePal
    );

    if (anyPixel) {
      hCtx.putImageData(imgData, 0, 0);
    }
    hasHighlightPixelsRef.current = anyPixel;
  }, [
    puzzle,
    activeColorId,
    hintRegionId,
    filledRegionIds,
    highlightMatching,
    highlightStyle,
    hintFillStyle,
    hintColorArgb,
  ]);

  // 3. Update Offscreen Preview Border Layer (built lazily once per puzzle)
  useEffect(() => {
    if (!puzzle || !showPreviewBorders) return;
    if (lastBorderPuzzleRef.current === puzzle && borderCanvasRef.current) return;

    if (!borderCanvasRef.current) {
      borderCanvasRef.current = document.createElement('canvas');
    }
    if (buildPreviewBorderCanvas(borderCanvasRef.current, puzzle)) {
      lastBorderPuzzleRef.current = puzzle;
    }
  }, [puzzle, showPreviewBorders]);

  // 4. Lazily build alpha-masked preview canvas for organic cutouts (Preview & Free Colour multiply)
  useEffect(() => {
    if (!puzzle || !hasTransparentMaskRef.current) {
      lastMaskedPreviewPuzzleRef.current = null;
      lastMaskedPreviewImageRef.current = null;
      return;
    }
    const needsMaskedPreview = Boolean(
      isPreviewMode || isFreeColorMode || puzzle.isFreeColor
    );
    if (
      !needsMaskedPreview ||
      !sourceImage ||
      !sourceImage.complete ||
      (sourceImage.naturalWidth <= 0 && sourceImage.width <= 0)
    ) {
      if (
        lastMaskedPreviewPuzzleRef.current !== puzzle ||
        lastMaskedPreviewImageRef.current !== sourceImage
      ) {
        lastMaskedPreviewPuzzleRef.current = null;
        lastMaskedPreviewImageRef.current = null;
      }
      return;
    }
    if (
      lastMaskedPreviewPuzzleRef.current === puzzle &&
      lastMaskedPreviewImageRef.current === sourceImage &&
      maskedPreviewCanvasRef.current
    ) {
      return;
    }
    if (!maskedPreviewCanvasRef.current) {
      maskedPreviewCanvasRef.current = document.createElement('canvas');
    }
    if (buildMaskedPreviewCanvas(maskedPreviewCanvasRef.current, sourceImage, puzzle)) {
      lastMaskedPreviewPuzzleRef.current = puzzle;
      lastMaskedPreviewImageRef.current = sourceImage;
      scheduleCanvasRedraw();
    } else {
      lastMaskedPreviewPuzzleRef.current = null;
      lastMaskedPreviewImageRef.current = null;
    }
  }, [puzzle, sourceImage, isPreviewMode, isFreeColorMode, scheduleCanvasRedraw]);

  // 5. Zero-allocation Region Selection Overlay Layer (rebuilt only when selection changes)
  useEffect(() => {
    selectionVersionRef.current += 1;
    if (!puzzle || !isRegionSelectionMode || !selectedRegionIds || selectedRegionIds.size === 0) {
      let hadAny = hasSelectionPixelsRef.current;
      hasSelectionPixelsRef.current = false;
      for (const cache of layerCachesRef.current.values()) {
        if (cache.hasSelectionPixels) {
          cache.hasSelectionPixels = false;
          hadAny = true;
        }
      }
      if (hadAny) {
        scheduleCanvasRedraw();
      }
      return;
    }

    const rootAllowed = selectionLayerId === undefined || selectionLayerId === null;
    if (!rootAllowed) {
      hasSelectionPixelsRef.current = false;
      scheduleCanvasRedraw();
      return;
    }

    const { width, height } = puzzle;
    if (!selectionCanvasRef.current) {
      selectionCanvasRef.current = document.createElement('canvas');
    }
    if (selectionCanvasRef.current.width !== width || selectionCanvasRef.current.height !== height) {
      selectionCanvasRef.current.width = width;
      selectionCanvasRef.current.height = height;
      selectionImageDataRef.current = null;
    }

    const sCtx = selectionCanvasRef.current.getContext('2d');
    if (!sCtx) return;

    let imgData = selectionImageDataRef.current;
    if (!imgData || imgData.width !== width || imgData.height !== height) {
      imgData = sCtx.createImageData(width, height);
      selectionImageDataRef.current = imgData;
    } else {
      imgData.data.fill(0);
    }

    const anyPixel = renderSelectionOverlayToImageData(
      imgData.data,
      puzzle,
      selectedRegionIds,
      rootRegionByIdRef.current
    );
    if (anyPixel) {
      sCtx.putImageData(imgData, 0, 0);
    }
    hasSelectionPixelsRef.current = anyPixel;
    scheduleCanvasRedraw();
  }, [puzzle, isRegionSelectionMode, selectedRegionIds, selectionLayerId, scheduleCanvasRedraw]);

  // 6. Async Nested Layer Image Hydration (layerImages prop -> IndexedDB fallback without root rebuilds)
  useEffect(() => {
    const ownedUrls = ownedLayerObjectUrlsRef.current;
    const hydratedImages = hydratedLayerImagesRef.current;
    const loadingKeys = loadingLayerKeysRef.current;
    const failedKeys = failedLayerKeysRef.current;

    if (lastHydrationPuzzleRef.current !== puzzle) {
      lastHydrationPuzzleRef.current = puzzle;
      hydrationGenRef.current += 1;
      loadingKeys.clear();
      failedKeys.clear();
    }

    const activeKeys = collectActiveLayerImageKeys(puzzle?.nestedLayers);
    purgeStaleOwnedLayerUrls(ownedUrls, hydratedImages, loadingKeys, failedKeys, activeKeys);

    if (syncMaterializedLayerSourceImages(layerCachesRef.current, layerImages, hydratedImages)) {
      scheduleCanvasRedraw();
    }

    const layers = puzzle?.nestedLayers;
    if (!Array.isArray(layers) || layers.length === 0 || !canHydrateBrowserLayerBlobs()) {
      return;
    }

    const myGen = hydrationGenRef.current;
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      const key = layer?.imageBlobKey;
      if (!key || !activeKeys.has(key)) continue;
      if (lookupLayerImageFromMap(layerImages, key, layer.layerId)) continue;
      if (hydratedImages.has(key) || loadingKeys.has(key) || failedKeys.has(key)) continue;

      hydrateSingleLayerImageBlob(
        key,
        myGen,
        hydrationGenRef,
        ownedUrls,
        hydratedImages,
        loadingKeys,
        failedKeys,
        layerCachesRef,
        layerImagesPropRef,
        scheduleCanvasRedraw
      );
    }
  }, [puzzle, layerImages, scheduleCanvasRedraw]);

  // Pan to center hinted region (world coordinates across root and all nested layers)
  useEffect(() => {
    if (!puzzle || hintRegionId === null || !containerRef.current) return;
    const regRef = worldRegionByIdRef.current.get(hintRegionId);
    if (!regRef) return;

    const { clientWidth: w, clientHeight: h } = containerRef.current;
    if (w <= 0 || h <= 0) return;

    const curScale = scaleRef.current;
    const curOff = offsetRef.current;
    const baseScale = Math.min(w / puzzle.width, h / puzzle.height) * 0.92;
    const baseOffsetX = (w - puzzle.width * baseScale) / 2;
    const baseOffsetY = (h - puzzle.height * baseScale) / 2;
    const effScale = curScale * baseScale;

    if (effScale <= 0) return;

    const visLeft = (-curOff.x - baseOffsetX) / effScale;
    const visTop = (-curOff.y - baseOffsetY) / effScale;
    const visRight = visLeft + w / effScale;
    const visBottom = visTop + h / effScale;

    const isOnScreen =
      regRef.worldMaxX >= visLeft &&
      regRef.worldMinX <= visRight &&
      regRef.worldMaxY >= visTop &&
      regRef.worldMinY <= visBottom;

    // Only auto-pan if the canvas is zoomed in AND the region is outside the visible viewport
    const isZoomedIn = curScale > 1.05;
    if (showNextRegionHint && isZoomedIn && !isOnScreen) {
      stopMomentum();
      cancelFocusAnimation(false);
      const targetX = w / 2 - baseOffsetX - regRef.worldCentroidX * effScale;
      const targetY = h / 2 - baseOffsetY - regRef.worldCentroidY * effScale;
      const clamped = clampCanvasOffset({ x: targetX, y: targetY }, curScale, puzzle.width, puzzle.height, w, h);
      offsetRef.current = clamped;
      setScale(curScale);
      setOffset({ x: clamped.x, y: clamped.y });
    }
  }, [hintRegionId, puzzle, showNextRegionHint, stopMomentum, cancelFocusAnimation]);

  // Notify view extent updates only when scale or offset actually changes
  const onViewExtentChangedRef = useRef(onViewExtentChanged);
  onViewExtentChangedRef.current = onViewExtentChanged;
  useEffect(() => {
    const w = containerRef.current?.clientWidth || window.innerWidth;
    const h = containerRef.current?.clientHeight || window.innerHeight;
    onViewExtentChangedRef.current?.(scale, offset.x, offset.y, w, h);
  }, [scale, offset]);

  // Coordinate conversion helper
  const screenToCanvasCoords = useCallback(
    (clientX: number, clientY: number) => {
      const container = containerRef.current;
      if (!container || !puzzle) return null;

      const rect = getCachedCanvasRect();
      if (!rect) return null;
      const screenX = clientX - rect.left;
      const screenY = clientY - rect.top;

      const w = container.clientWidth;
      const h = container.clientHeight;
      const baseScale = Math.min(w / puzzle.width, h / puzzle.height) * 0.92;
      const baseOffsetX = (w - puzzle.width * baseScale) / 2;
      const baseOffsetY = (h - puzzle.height * baseScale) / 2;
      const effScale = scaleRef.current * baseScale;

      if (effScale <= 0) return null;

      const canvasX = (screenX - offsetRef.current.x - baseOffsetX) / effScale;
      const canvasY = (screenY - offsetRef.current.y - baseOffsetY) / effScale;

      return { x: canvasX, y: canvasY, screenX, screenY, effScale };
    },
    [puzzle, getCachedCanvasRect]
  );

  // Screen-space-stepped unified line painting for smooth drag strokes across all depths
  const hitTestAndPaintLine = useCallback(
    (x1: number, y1: number, x2: number, y2: number, effScale: number): boolean => {
      if (!puzzle) return false;
      const scratch = paintLineScratchRef.current;
      const hasAny = collectUnifiedLineRegionIds(
        puzzle,
        sortedNestedLayersDescRef.current,
        x1,
        y1,
        x2,
        y2,
        effScale,
        scratch,
        hitScratchRef.current
      );
      if (!hasAny) return false;

      let didPaintEligible = false;
      for (const rId of scratch) {
        if (
          isFreeColorMode ||
          (!filledRegionIds.has(rId) &&
            (difficulty === 'EASY' || regionByIdRef.current.get(rId)?.colorId === activeColorId))
        ) {
          didPaintEligible = true;
          break;
        }
      }

      onBatchRegionsClicked(scratch);
      return didPaintEligible;
    },
    [puzzle, onBatchRegionsClicked, isFreeColorMode, filledRegionIds, difficulty, activeColorId]
  );

  // Zero-allocation screen-space-stepped unified line selection collector for Region Selection Mode drag
  const hitTestAndSelectLine = useCallback(
    (x1: number, y1: number, x2: number, y2: number, effScale: number): boolean => {
      if (!puzzle || !onRegionSelectDragAdd) return false;
      const scratch = selectionLineScratchRef.current;
      if (
        collectUnifiedLineRegionIds(
          puzzle,
          sortedNestedLayersDescRef.current,
          x1,
          y1,
          x2,
          y2,
          effScale,
          scratch,
          hitScratchRef.current
        )
      ) {
        onRegionSelectDragAdd(scratch);
        return true;
      }
      return false;
    },
    [puzzle, onRegionSelectDragAdd]
  );

  // Calculate visible regions/colors with debouncing across root and all nested layers in world coords
  useEffect(() => {
    if (!puzzle || !containerRef.current) {
      if (!puzzle && lastNestedColorsNonEmptyRef.current) {
        lastNestedColorsNonEmptyRef.current = false;
        onVisibleNestedColorsChanged?.(new Set());
      }
      return;
    }
    const { clientWidth: w, clientHeight: h } = containerRef.current;
    if (w <= 0 || h <= 0) return;

    const timer = setTimeout(() => {
      const baseScale = Math.min(w / puzzle.width, h / puzzle.height) * 0.92;
      const baseOffsetX = (w - puzzle.width * baseScale) / 2;
      const baseOffsetY = (h - puzzle.height * baseScale) / 2;
      const effScale = scale * baseScale;

      if (effScale <= 0) return;

      const visLeft = (-offset.x - baseOffsetX) / effScale;
      const visTop = (-offset.y - baseOffsetY) / effScale;
      const visRight = visLeft + w / effScale;
      const visBottom = visTop + h / effScale;

      const colorSet = new Set<number>();
      const regionSet = new Set<number>();
      const nestedColorSet = new Set<number>();
      const prominentLayerIds = collectProminentVisibleLayerIds(
        puzzle.width,
        puzzle.height,
        sortedNestedLayersDescRef.current,
        visLeft,
        visTop,
        visRight,
        visBottom,
        scale,
        effScale,
        w,
        h,
        new Set<string>()
      );
      const isFreeColor = Boolean(isFreeColorMode || puzzle.isFreeColor);

      for (const entry of worldRegionByIdRef.current.values()) {
        const isFilled = filledRegionIds.has(entry.region.id);
        if (isFilled && (!isFreeColor || prominentLayerIds.size === 0)) continue;
        if (
          entry.worldMaxX >= visLeft &&
          entry.worldMinX <= visRight &&
          entry.worldMaxY >= visTop &&
          entry.worldMinY <= visBottom
        ) {
          if (!isFilled) {
            colorSet.add(entry.region.colorId);
            regionSet.add(entry.region.id);
          }
          if (entry.layerId !== null && prominentLayerIds.has(entry.layerId)) {
            nestedColorSet.add(entry.region.colorId);
          }
        }
      }

      // Never hide or deprioritize active colour, even if no regions of it are on screen
      if (activeColorId) {
        colorSet.add(activeColorId);
      }

      lastNestedColorsNonEmptyRef.current = nestedColorSet.size > 0;
      onVisibleColorsChanged(colorSet);
      onVisibleRegionsChanged(regionSet);
      onVisibleNestedColorsChanged?.(nestedColorSet);
    }, 80);

    return () => clearTimeout(timer);
  }, [
    scale,
    offset,
    containerSize,
    puzzle,
    activeColorId,
    filledRegionIds,
    isFreeColorMode,
    onVisibleColorsChanged,
    onVisibleRegionsChanged,
    onVisibleNestedColorsChanged,
  ]);

  // Main GPU-Accelerated Composite Rendering Routine (invocable directly from rAF without React state updates)
  const drawCompositeFrame = useCallback(
    (currentPulseAlpha: number) => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w <= 0 || h <= 0) return;

      const rawDpr = Math.max(1, window.devicePixelRatio || 1);
      const MAX_BACKING_DIM = 4096;
      const effDpr = Math.max(
        1,
        Math.min(rawDpr, MAX_BACKING_DIM / Math.max(1, w), MAX_BACKING_DIM / Math.max(1, h))
      );
      const targetWidth = Math.max(1, Math.round(w * effDpr));
      const targetHeight = Math.max(1, Math.round(h * effDpr));
      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.save();
      ctx.scale(targetWidth / w, targetHeight / h);

      // Canvas stage background
      const bgHex =
        canvasBgColor === 'CUSTOM' || !CANVAS_BG_MAP[canvasBgColor]
          ? `#${(canvasBgArgb & 0x00ffffff).toString(16).padStart(6, '0')}`
          : CANVAS_BG_MAP[canvasBgColor].hex;
      ctx.fillStyle = bgHex;
      ctx.fillRect(0, 0, w, h);

      if (!puzzle) {
        if (
          sourceImage &&
          sourceImage.complete &&
          (sourceImage.naturalWidth > 0 || sourceImage.width > 0)
        ) {
          const imgW = sourceImage.naturalWidth || sourceImage.width;
          const imgH = sourceImage.naturalHeight || sourceImage.height;
          const baseScale = Math.min(w / imgW, h / imgH) * 0.92;
          const baseOffsetX = (w - imgW * baseScale) / 2;
          const baseOffsetY = (h - imgH * baseScale) / 2;
          const artW = imgW * baseScale;
          const artH = imgH * baseScale;

          // Draw source image cleanly with alpha-conforming drop shadow (supports transparent cutouts)
          ctx.save();
          ctx.translate(baseOffsetX, baseOffsetY);
          ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
          ctx.shadowBlur = 24;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 6;
          ctx.drawImage(sourceImage, 0, 0, artW, artH);
          ctx.restore();
        }
        ctx.restore();
        return;
      }

      const curScale = scaleRef.current;
      const curOffset = offsetRef.current;
      const baseScale = Math.min(w / puzzle.width, h / puzzle.height) * 0.92;
      const baseOffsetX = (w - puzzle.width * baseScale) / 2;
      const baseOffsetY = (h - puzzle.height * baseScale) / 2;
      const effScale = curScale * baseScale;
      const currentFrame = ++renderFrameCounterRef.current;

      // Draw opaque rectangular artwork drop shadow framing only for non-cutout puzzles
      const artScreenX = curOffset.x + baseOffsetX;
      const artScreenY = curOffset.y + baseOffsetY;
      const artScreenW = puzzle.width * effScale;
      const artScreenH = puzzle.height * effScale;

      drawPuzzleBackdropIfOpaque(
        ctx,
        hasTransparentMaskRef.current,
        artScreenX,
        artScreenY,
        artScreenW,
        artScreenH
      );

      ctx.save();
      ctx.translate(curOffset.x + baseOffsetX, curOffset.y + baseOffsetY);
      ctx.scale(effScale, effScale);

      const visLeft = (-curOffset.x - baseOffsetX) / effScale;
      const visTop = (-curOffset.y - baseOffsetY) / effScale;
      const visRight = visLeft + w / effScale;
      const visBottom = visTop + h / effScale;

      const isEffectivePreview = isPreviewMode;

      const layerParams = drawLayersParamsRef.current;
      layerParams.puzzle = puzzle;
      layerParams.sourceImage = sourceImage;
      layerParams.hasTransparentMask = hasTransparentMaskRef.current;
      layerParams.isEffectivePreview = isEffectivePreview;
      layerParams.showPreviewBorders = showPreviewBorders;
      layerParams.isFreeColorMode = isFreeColorMode;
      layerParams.isRegionSelectionMode = isRegionSelectionMode;
      layerParams.hasHighlightPixels = hasHighlightPixelsRef.current;
      layerParams.hasSelectionPixels = hasSelectionPixelsRef.current;
      layerParams.highlightStyle = highlightStyle;
      layerParams.animateHint = animateHint;
      layerParams.reducedMotion = reducedMotion;
      layerParams.hintIntensity = hintIntensity;
      layerParams.currentPulseAlpha = currentPulseAlpha;
      layerParams.baseCanvas = baseCanvasRef.current;
      layerParams.borderCanvas = borderCanvasRef.current;
      layerParams.highlightCanvas = highlightCanvasRef.current;
      layerParams.maskedPreviewCanvas =
        lastMaskedPreviewPuzzleRef.current === puzzle &&
        lastMaskedPreviewImageRef.current === sourceImage
          ? maskedPreviewCanvasRef.current
          : null;
      layerParams.selectionCanvas = selectionCanvasRef.current;
      const sortedNestedLayers = sortedNestedLayersAscRef.current;
      const visibleNestedLayers = collectVisibleNestedLayers(
        puzzle,
        sortedNestedLayers,
        visLeft,
        visTop,
        visRight,
        visBottom,
        effScale,
        visibleNestedLayersScratchRef.current
      );
      const rootTexelRatio = Math.max(
        computeLayerTexelRatio(puzzle.width, puzzle.width, effScale, effDpr),
        computeLayerTexelRatio(puzzle.height, puzzle.height, effScale, effDpr)
      );
      const rootSmoothing = resolveLayerImageSmoothing(
        rootTexelRatio,
        false,
        visibleNestedLayers.length > 0,
        LAYER_SMOOTHING_SCRATCH
      );
      layerParams.imageSmoothingEnabled = rootSmoothing.imageSmoothingEnabled;
      layerParams.imageSmoothingQuality = rootSmoothing.imageSmoothingQuality;
      drawPuzzleCompositeLayers(ctx, layerParams);

      // 2. Composite Visible Non-Culled Nested Layers (ascending depth, lazy GPU LRU cache, zero rAF allocs)
      if (visibleNestedLayers.length > 0) {
        if (paletteByIdRef.current.size === 0 && puzzle.palette.length > 0) {
          for (let pi = 0; pi < puzzle.palette.length; pi++) {
            paletteByIdRef.current.set(puzzle.palette[pi].id, puzzle.palette[pi]);
          }
        }
        drawVisibleNestedLayers(
          ctx,
          puzzle,
          visibleNestedLayers,
          layerCachesRef.current,
          paletteByIdRef.current,
          layerImagesPropRef.current,
          hydratedLayerImagesRef.current,
          filledRegionIds,
          paintedRegionColors,
          regionColorMode,
          isEffectivePreview,
          showPreviewBorders,
          isFreeColorMode,
          isRegionSelectionMode,
          selectedRegionIds,
          selectionLayerIdRef.current,
          activeColorId,
          hintRegionId,
          highlightMatching,
          highlightStyle,
          hintFillStyle,
          hintColorArgb,
          animateHint,
          reducedMotion,
          hintIntensity,
          currentPulseAlpha,
          highlightVersionRef.current,
          selectionVersionRef.current,
          effScale,
          effDpr,
          currentFrame
        );
      }

      // 3. Draw Visible Number Labels & Centroid Glows (suppress active-color highlight & hints in Region Selection Mode)
      const drawLabelsNow = isEffectivePreview
        ? showRegionLabels && showPreviewLabels
        : isFreeColorMode
        ? false
        : showRegionLabels;
      const effectiveHighlightMatching = isRegionSelectionMode ? false : highlightMatching;
      const effectiveHintRegionId = isRegionSelectionMode ? null : hintRegionId;

      if (drawLabelsNow || effectiveHighlightMatching || effectiveHintRegionId !== null) {
        renderLabels(
          ctx,
          puzzle,
          sortedNestedLayers,
          worldRegionByIdRef.current,
          filledRegionIds,
          activeColorId,
          effectiveHintRegionId,
          displayNumberMap,
          drawLabelsNow,
          effectiveHighlightMatching,
          highlightStyle,
          hintColorArgb,
          hintIntensity,
          currentPulseAlpha,
          Boolean(animateHint && !reducedMotion),
          effScale,
          labelScale,
          minLabelSize,
          maxLabelSize,
          visLeft,
          visTop,
          visRight,
          visBottom,
          isEffectivePreview
        );
      }

      // 4. Tap feedback animation dot (ref-driven, zero React state updates)
      const tapDot = tapDotRef.current;
      if (tapDot.alpha > 0) {
        ctx.beginPath();
        ctx.arc(tapDot.x, tapDot.y, 7 / effScale, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(56, 189, 248, ${tapDot.alpha * 0.9})`;
        ctx.fill();
      }

      // 5. Zero-allocation Co-op Collaborator Paint Ripples (typed ring buffer, zero heap allocs)
      if (coopRippleBuffer) {
        const nowMs = performance.now();
        ctx.save();
        ctx.lineWidth = 2.5 / effScale;
        for (let i = 0; i < MAX_COOP_RIPPLES; i++) {
          const started = coopRippleBuffer.startTimeMs[i];
          if (started <= 0) continue;
          const age = nowMs - started;
          if (age < 0 || age >= COOP_RIPPLE_DURATION_MS) {
            coopRippleBuffer.startTimeMs[i] = 0;
            continue;
          }
          const progress = age / COOP_RIPPLE_DURATION_MS;
          const ease = 1 - (1 - progress) * (1 - progress);
          const radius = (8 + ease * 26) / effScale;
          ctx.globalAlpha = (1 - progress) * 0.92;
          ctx.strokeStyle = coopRippleBuffer.strokeHex[i];
          ctx.beginPath();
          ctx.arc(coopRippleBuffer.x[i], coopRippleBuffer.y[i], radius, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }

      ctx.restore(); // Transform restore
      ctx.restore(); // DPR scale restore
    },
    [
      puzzle,
      sourceImage,
      activeColorId,
      filledRegionIds,
      paintedRegionColors,
      hintRegionId,
      isPreviewMode,
      isFreeColorMode,
      isRegionSelectionMode,
      selectedRegionIds,
      canvasBgColor,
      canvasBgArgb,
      regionColorMode,
      showRegionLabels,
      showPreviewLabels,
      showPreviewBorders,
      labelScale,
      minLabelSize,
      maxLabelSize,
      highlightMatching,
      highlightStyle,
      hintColorArgb,
      hintFillStyle,
      animateHint,
      reducedMotion,
      hintIntensity,
      displayNumberMap,
      isGenerating,
      detailedProgress,
      generationProgress,
      generationStepIndex,
      coopRippleBuffer,
    ]
  );
  drawCompositeFrameRef.current = drawCompositeFrame;

  // Observe container dimension changes (window resize, mobile orientation change, fullscreen toggle)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w <= 0 || h <= 0) return;

      if (
        focusAnimIdRef.current !== null &&
        (focusAnimStateRef.current.containerW !== w || focusAnimStateRef.current.containerH !== h)
      ) {
        cancelFocusAnimation(true);
      }

      refreshCanvasRect();
      setContainerSize((prev) =>
        prev.width === w && prev.height === h ? prev : { width: w, height: h }
      );

      if (puzzle) {
        const curOffset = offsetRef.current;
        const clamped = clampCanvasOffset(
          curOffset,
          scaleRef.current,
          puzzle.width,
          puzzle.height,
          w,
          h
        );
        if (clamped.x !== curOffset.x || clamped.y !== curOffset.y) {
          offsetRef.current = clamped;
          setOffset({ x: clamped.x, y: clamped.y });
        }
        onViewExtentChangedRef.current?.(scaleRef.current, clamped.x, clamped.y, w, h);
      }
      drawCompositeFrame(pulseAlphaRef.current);
    };

    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => handleResize())
        : null;
    observer?.observe(container);
    window.addEventListener('resize', handleResize);
    window.visualViewport?.addEventListener('resize', handleResize);

    let disposed = false;
    let currentDprCleanup: (() => void) | null = null;
    const attachDprListener = () => {
      currentDprCleanup?.();
      currentDprCleanup = null;
      if (disposed || typeof window.matchMedia !== 'function') return;
      const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      if (!mq) return;
      const onDprChange = () => {
        if (disposed) return;
        handleResize();
        attachDprListener();
      };
      if (typeof mq.addEventListener === 'function') {
        mq.addEventListener('change', onDprChange);
        currentDprCleanup = () => mq.removeEventListener('change', onDprChange);
      } else if (typeof mq.addListener === 'function') {
        mq.addListener(onDprChange);
        currentDprCleanup = () => mq.removeListener(onDprChange);
      }
    };
    attachDprListener();

    return () => {
      disposed = true;
      observer?.disconnect();
      window.removeEventListener('resize', handleResize);
      window.visualViewport?.removeEventListener('resize', handleResize);
      currentDprCleanup?.();
      currentDprCleanup = null;
    };
  }, [puzzle, drawCompositeFrame, refreshCanvasRect, cancelFocusAnimation]);

  // Release offscreen canvas backing buffers and owned layer image URLs cleanly on unmount
  useEffect(() => {
    const ownedUrls = ownedLayerObjectUrlsRef.current;
    const hydratedImages = hydratedLayerImagesRef.current;
    const loadingKeys = loadingLayerKeysRef.current;
    const failedKeys = failedLayerKeysRef.current;
    const layerCaches = layerCachesRef.current;
    return () => {
      disposeAllLayerCaches(layerCaches);
      hydrationGenRef.current += 1;
      for (const objUrl of ownedUrls.values()) {
        revokeOwnedObjectUrl(objUrl);
      }
      ownedUrls.clear();
      hydratedImages.clear();
      loadingKeys.clear();
      failedKeys.clear();

      for (const ref of [
        baseCanvasRef,
        highlightCanvasRef,
        borderCanvasRef,
        maskedPreviewCanvasRef,
        selectionCanvasRef,
      ]) {
        if (ref.current) {
          ref.current.width = 0;
          ref.current.height = 0;
          ref.current = null;
        }
      }
      baseImageDataRef.current = null;
      highlightImageDataRef.current = null;
      selectionImageDataRef.current = null;
      lastMaskedPreviewPuzzleRef.current = null;
      lastMaskedPreviewImageRef.current = null;
      hasSelectionPixelsRef.current = false;
      hasTransparentMaskRef.current = false;
      canvasRectRef.current = null;
      sourcePixelsRef.current = null;
      if (tapDotRafIdRef.current !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(tapDotRafIdRef.current);
        tapDotRafIdRef.current = null;
      }
    };
  }, []);

  // Redraw immediately whenever visual props or viewport state change
  useEffect(() => {
    drawCompositeFrame(pulseAlphaRef.current);
  }, [drawCompositeFrame, scale, offset]);

  // Demand-driven Co-op Ripple decay rAF loop (sleeps completely when idle; zero React state updates)
  useEffect(() => {
    if (!coopRippleBuffer) return;
    let rippleRafId = 0;
    const stepRipples = (now: number) => {
      rippleRafId = 0;
      drawCompositeFrame(pulseAlphaRef.current);
      if (coopRippleBuffer.hasActiveRipples(now)) {
        rippleRafId = requestAnimationFrame(stepRipples);
      }
    };
    coopRippleBuffer.setWakeCallback(() => {
      if (rippleRafId === 0) {
        rippleRafId = requestAnimationFrame(stepRipples);
      }
    });
    return () => {
      coopRippleBuffer.setWakeCallback(null);
      if (rippleRafId !== 0) cancelAnimationFrame(rippleRafId);
    };
  }, [coopRippleBuffer, drawCompositeFrame]);

  // Direct-to-canvas hint pulse rAF loop (zero React state updates; pauses completely when idle/completed or under reducedMotion)
  useEffect(() => {
    const hasActivePulseTarget =
      Boolean(puzzle) &&
      !isPreviewMode &&
      !isGenerating &&
      !isRegionSelectionMode &&
      (hintRegionId !== null ||
        (!isFreeColorMode &&
          highlightMatching &&
          highlightStyle !== 'NUMBER_ONLY' &&
          filledRegionIds.size < unifiedTotalCountRef.current));

    if (!animateHint || reducedMotion || !hasActivePulseTarget) {
      const steadyAlpha = reducedMotion ? 0.95 : 0.7;
      pulseAlphaRef.current = steadyAlpha;
      drawCompositeFrame(steadyAlpha);
      return;
    }

    let animId = 0;
    const startTime = performance.now();
    let lastPulseDraw = 0;

    const loop = (now: number) => {
      if (!document.hidden && now - lastPulseDraw >= 50) {
        lastPulseDraw = now;
        const elapsed = now - startTime;
        const t = (Math.sin(elapsed / 250) + 1) / 2;
        const nextAlpha = 0.35 + t * 0.6;
        pulseAlphaRef.current = nextAlpha;
        drawCompositeFrame(nextAlpha);
      }
      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [
    animateHint,
    reducedMotion,
    puzzle,
    isPreviewMode,
    isGenerating,
    isRegionSelectionMode,
    hintRegionId,
    isFreeColorMode,
    highlightMatching,
    highlightStyle,
    filledRegionIds.size,
    drawCompositeFrame,
  ]);

  // Pointer event handlers for touch/mouse
  const handlePointerDown = (e: React.PointerEvent) => {
    paintedInGestureRef.current = false;
    stopMomentum();
    cancelFocusAnimation(true);
    refreshCanvasRect();
    resetPointerRing(e.clientX, e.clientY, performance.now());
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const isRightClick = e.button === 2 || (e.buttons & 2) !== 0;
    isRightClickRef.current = isRightClick;

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignored if pointer capture is not supported
    }

    if (e.pointerType === 'touch') {
      touchPointerCountRef.current = activePointersRef.current.size;
      if (touchPointerCountRef.current > 1) {
        // Multi-touch: cancel single pointer drag, zoom, and do not paint
        isDraggingRef.current = false;
        isPinchPanningRef.current = false;
        isDoubleTapCandidateRef.current = false;
        isOneFingerZoomingRef.current = false;
        return;
      }
    }

    isDraggingRef.current = true;
    isPinchPanningRef.current = false;
    hasNotifiedManualPanRef.current = false;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    lastPointerPosRef.current = { x: e.clientX, y: e.clientY };
    totalDragDistanceRef.current = 0;

    // Detect if pointer touched inside image bounds or on the canvas background
    const coords = screenToCanvasCoords(e.clientX, e.clientY);
    const isInsideImage = Boolean(
      coords &&
      puzzle &&
      coords.x >= 0 &&
      coords.x < puzzle.width &&
      coords.y >= 0 &&
      coords.y < puzzle.height
    );
    isTouchingOutsideImageRef.current = !isInsideImage;

    // Check if this pointer down is a candidate for one-finger double-tap (vertical zoom or horizontal pan)
    const now = Date.now();
    const timeSinceTapUp = now - lastTapUpTimeRef.current;
    const distFromLastTap = Math.hypot(
      e.clientX - lastTapUpPosRef.current.x,
      e.clientY - lastTapUpPosRef.current.y
    );

    if (timeSinceTapUp < 350 && distFromLastTap < 40 && !isRightClick) {
      isDoubleTapCandidateRef.current = true;
      isOneFingerZoomingRef.current = false;
      isDoubleTapPanningRef.current = false;
      doubleTapFocalRef.current = { x: e.clientX, y: e.clientY };
      dragZoomStartYRef.current = e.clientY;
      initialDragZoomScaleRef.current = scaleRef.current;
      initialDragZoomOffsetRef.current = { ...offsetRef.current };
      // Defer immediate paint until drag direction / gesture resolves
      return;
    } else {
      isDoubleTapCandidateRef.current = false;
      isOneFingerZoomingRef.current = false;
      isDoubleTapPanningRef.current = false;
    }

    if (!coords || !puzzle) return;

    // Only start continuous paint if touching inside the image region (defer in Region Selection Mode so taps can toggle cleanly)
    if (!isRightClick && isPaintMode && !isPreviewMode && !isRegionSelectionMode && isInsideImage) {
      onPuzzleInteractionRef.current?.();
      if (hitTestAndPaintLine(coords.x, coords.y, coords.x, coords.y, coords.effScale)) {
        paintedInGestureRef.current = true;
      }
      triggerTapDot(coords.x, coords.y);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const trackedPointer = activePointersRef.current.get(e.pointerId);
    if (trackedPointer) {
      trackedPointer.x = e.clientX;
      trackedPointer.y = e.clientY;
    }

    if (!isDraggingRef.current || touchStartDistRef.current !== null || touchPointerCountRef.current > 1) return;

    // One-finger double-tap drag:
    // Left/Right: horizontal pan (especially in paint mode)
    // Up/Down: zoom in/out
    if (isDoubleTapCandidateRef.current) {
      const dx = e.clientX - doubleTapFocalRef.current.x;
      const dy = e.clientY - dragZoomStartYRef.current;

      if (!isOneFingerZoomingRef.current && !isDoubleTapPanningRef.current) {
        if (Math.abs(dx) >= 8 || Math.abs(dy) >= 8) {
          if (isPaintMode && Math.abs(dx) >= Math.abs(dy)) {
            // Horizontal drag in paint mode enables one-finger panning!
            isDoubleTapPanningRef.current = true;
          } else if (Math.abs(dx) > Math.abs(dy) * 1.25) {
            // Predominantly horizontal drag triggers panning
            isDoubleTapPanningRef.current = true;
          } else {
            // Predominantly vertical drag triggers zoom
            isOneFingerZoomingRef.current = true;
            onViewportGestureRef.current?.();
            onPuzzleInteractionRef.current?.();
          }
        }
      }

      if (isDoubleTapPanningRef.current && containerRef.current && puzzle) {
        if (!hasNotifiedManualPanRef.current) {
          hasNotifiedManualPanRef.current = true;
          onPuzzleInteractionRef.current?.();
          onManualPanStartRef.current?.();
          onViewportGestureRef.current?.();
        }
        const moveDx = e.clientX - lastPointerPosRef.current.x;
        const moveDy = e.clientY - lastPointerPosRef.current.y;
        lastPointerPosRef.current.x = e.clientX;
        lastPointerPosRef.current.y = e.clientY;

        const w = containerRef.current.clientWidth;
        const h = containerRef.current.clientHeight;
        const rawTarget = gestureRawOffsetRef.current;
        rawTarget.x = offsetRef.current.x + moveDx;
        rawTarget.y = offsetRef.current.y + moveDy;
        const clamped = clampCanvasOffset(
          rawTarget,
          scaleRef.current,
          puzzle.width,
          puzzle.height,
          w,
          h,
          gestureClampedOffsetRef.current
        );
        if (clamped.x !== offsetRef.current.x || clamped.y !== offsetRef.current.y) {
          offsetRef.current.x = clamped.x;
          offsetRef.current.y = clamped.y;
          scheduleCanvasRedraw();
          commitTransformState(false);
        }
        return;
      }

      if (isOneFingerZoomingRef.current && containerRef.current && canvasRef.current && puzzle) {
        // By default: Drag up (dy < 0) zooms out, drag down (dy > 0) zooms in.
        // If reverseDoubleTapZoom is true: inverted (drag up zooms in, drag down zooms out).
        const sensitivity = 220;
        const directionMultiplier = reverseDoubleTapZoom ? -1 : 1;
        const zoomFactor = Math.exp(
          ((directionMultiplier * dy) / sensitivity) * effectiveZoomSensitivity
        );
        const maxZoom = maxZoomScaleRef.current;
        const clampedRawScale = Math.min(
          maxZoom,
          Math.max(0.5, initialDragZoomScaleRef.current * zoomFactor)
        );
        const newScale = applyZoomSnapDetent(clampedRawScale, snapZoomLevels, maxZoom);
        const actualZoom = newScale / initialDragZoomScaleRef.current;

        const rect = getCachedCanvasRect();
        if (!rect) return;
        const focalScreenX = doubleTapFocalRef.current.x - rect.left;
        const focalScreenY = doubleTapFocalRef.current.y - rect.top;

        const w = containerRef.current.clientWidth;
        const h = containerRef.current.clientHeight;
        const baseScale = Math.min(w / puzzle.width, h / puzzle.height) * 0.92;
        const baseOffsetX = (w - puzzle.width * baseScale) / 2;
        const baseOffsetY = (h - puzzle.height * baseScale) / 2;

        const focalX = focalScreenX - (initialDragZoomOffsetRef.current.x + baseOffsetX);
        const focalY = focalScreenY - (initialDragZoomOffsetRef.current.y + baseOffsetY);

        const rawTarget = gestureRawOffsetRef.current;
        rawTarget.x = initialDragZoomOffsetRef.current.x - focalX * (actualZoom - 1);
        rawTarget.y = initialDragZoomOffsetRef.current.y - focalY * (actualZoom - 1);

        const clamped = clampCanvasOffset(
          rawTarget,
          newScale,
          puzzle.width,
          puzzle.height,
          w,
          h,
          gestureClampedOffsetRef.current
        );
        if (
          newScale !== scaleRef.current ||
          clamped.x !== offsetRef.current.x ||
          clamped.y !== offsetRef.current.y
        ) {
          scaleRef.current = newScale;
          offsetRef.current.x = clamped.x;
          offsetRef.current.y = clamped.y;
          scheduleCanvasRedraw();
          commitTransformState(false);
        }

        lastPointerPosRef.current.x = e.clientX;
        lastPointerPosRef.current.y = e.clientY;
        return;
      }

      // If evaluating candidate and movement is small (< 8px), hold without painting
      if (!isOneFingerZoomingRef.current && !isDoubleTapPanningRef.current && Math.abs(dy) < 8 && Math.abs(dx) < 8) {
        return;
      }
    }

    const now = performance.now();
    pushPointerSample(e.clientX, e.clientY, now);

    const dx = e.clientX - lastPointerPosRef.current.x;
    const dy = e.clientY - lastPointerPosRef.current.y;
    totalDragDistanceRef.current += Math.hypot(dx, dy);

    const prevCoords = screenToCanvasCoords(lastPointerPosRef.current.x, lastPointerPosRef.current.y);
    const currCoords = screenToCanvasCoords(e.clientX, e.clientY);

    lastPointerPosRef.current.x = e.clientX;
    lastPointerPosRef.current.y = e.clientY;

    const isRightClick = isRightClickRef.current || (e.buttons & 2) !== 0;
    const isTouchingOutsideImage = isTouchingOutsideImageRef.current;

    // If touching outside the image region on the background canvas, drag always pans!
    if (!isPinchPanningRef.current && !isRightClick && !isTouchingOutsideImage && isPaintMode && !isPreviewMode && prevCoords && currCoords) {
      if (isRegionSelectionMode) {
        if (totalDragDistanceRef.current >= 6) {
          const startCoords = paintedInGestureRef.current
            ? prevCoords
            : screenToCanvasCoords(dragStartRef.current.x, dragStartRef.current.y) || prevCoords;
          hitTestAndSelectLine(startCoords.x, startCoords.y, currCoords.x, currCoords.y, currCoords.effScale);
          paintedInGestureRef.current = true;
          triggerTapDot(currCoords.x, currCoords.y);
        }
      } else {
        if (hitTestAndPaintLine(prevCoords.x, prevCoords.y, currCoords.x, currCoords.y, currCoords.effScale)) {
          paintedInGestureRef.current = true;
        }
        triggerTapDot(currCoords.x, currCoords.y);
      }
    } else {
      const container = containerRef.current;
      if (!container || !puzzle) return;
      if (!hasNotifiedManualPanRef.current && totalDragDistanceRef.current >= 6) {
        hasNotifiedManualPanRef.current = true;
        onPuzzleInteractionRef.current?.();
        onManualPanStartRef.current?.();
        onViewportGestureRef.current?.();
      }
      const w = container.clientWidth;
      const h = container.clientHeight;
      const rawTarget = gestureRawOffsetRef.current;
      rawTarget.x = offsetRef.current.x + dx;
      rawTarget.y = offsetRef.current.y + dy;
      const clamped = clampCanvasOffset(
        rawTarget,
        scaleRef.current,
        puzzle.width,
        puzzle.height,
        w,
        h,
        gestureClampedOffsetRef.current
      );
      if (clamped.x !== offsetRef.current.x || clamped.y !== offsetRef.current.y) {
        offsetRef.current.x = clamped.x;
        offsetRef.current.y = clamped.y;
        scheduleCanvasRedraw();
        commitTransformState(false);
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignored
    }

    activePointersRef.current.delete(e.pointerId);

    if (e.pointerType === 'touch') {
      touchPointerCountRef.current = activePointersRef.current.size;
      if (touchPointerCountRef.current > 0) {
        // One or more fingers are still on the screen!
        if (wasPinchingRef.current) {
          isDraggingRef.current = true;
          isPinchPanningRef.current = true;
          touchStartDistRef.current = null;
          initialTouchCenterRef.current = null;
          const remainingPos = activePointersRef.current.values().next().value;
          if (remainingPos) {
            lastPointerPosRef.current = { x: remainingPos.x, y: remainingPos.y };
            dragStartRef.current = { x: remainingPos.x, y: remainingPos.y };
            resetPointerRing(remainingPos.x, remainingPos.y, performance.now());
          }
          totalDragDistanceRef.current = 100;
        }
        return;
      }
    }

    // If one-finger double-tap zoom or pan was active, finish cleanly without clicks
    if (isOneFingerZoomingRef.current || isDoubleTapPanningRef.current) {
      paintedInGestureRef.current = false;
      isOneFingerZoomingRef.current = false;
      isDoubleTapPanningRef.current = false;
      isDoubleTapCandidateRef.current = false;
      isDraggingRef.current = false;
      isRightClickRef.current = false;
      lastTapUpTimeRef.current = 0; // Consume double-tap gesture
      commitTransformState(true);
      return;
    }

    isDoubleTapCandidateRef.current = false;
    isDoubleTapPanningRef.current = false;

    if (!isDraggingRef.current) {
      paintedInGestureRef.current = false;
      if (touchPointerCountRef.current === 0) {
        wasPinchingRef.current = false;
        isPinchPanningRef.current = false;
      }
      commitTransformState(true);
      return;
    }

    const wasRightClick = isRightClickRef.current;
    const wasPinchPan = isPinchPanningRef.current;
    isDraggingRef.current = false;
    isRightClickRef.current = false;

    if (touchPointerCountRef.current === 0) {
      wasPinchingRef.current = false;
      isPinchPanningRef.current = false;
    }

    if (wasRightClick || touchStartDistRef.current !== null) {
      paintedInGestureRef.current = false;
      commitTransformState(true);
      return;
    }

    // Trigger smooth pan momentum if dragged sufficiently
    if (totalDragDistanceRef.current >= 12) {
      paintedInGestureRef.current = false;
      commitTransformState(true);
      if (panMomentum && !reducedMotionRef.current && (!isPaintMode || isPreviewMode || wasPinchPan)) {
        const count = pointerRingCountRef.current;
        if (count >= 2) {
          const ring = pointerRingRef.current;
          const newestIdx = (pointerRingHeadRef.current - 1 + POINTER_RING_CAPACITY) % POINTER_RING_CAPACITY;
          const newest = ring[newestIdx];
          let oldest = newest;
          for (let i = count - 1; i >= 0; i--) {
            const idx = (pointerRingHeadRef.current - 1 - i + POINTER_RING_CAPACITY * 2) % POINTER_RING_CAPACITY;
            const candidate = ring[idx];
            if (newest.time - candidate.time <= 100) {
              oldest = candidate;
              break;
            }
          }
          const dt = newest.time - oldest.time;
          const timeSinceLast = performance.now() - newest.time;

          if (dt > 12 && timeSinceLast < 80) {
            let vx = (newest.x - oldest.x) / dt;
            let vy = (newest.y - oldest.y) / dt;
            const initialSpeed = Math.hypot(vx, vy);

            if (initialSpeed > 0.18) {
              const maxSpeed = 3.5;
              if (initialSpeed > maxSpeed) {
                vx = (vx / initialSpeed) * maxSpeed;
                vy = (vy / initialSpeed) * maxSpeed;
              }

              let lastTime = performance.now();
              const stepMomentum = (nowTime: number) => {
                const frameDt = Math.min(32, nowTime - lastTime);
                lastTime = nowTime;

                const decay = Math.pow(0.92, frameDt / 16);
                vx *= decay;
                vy *= decay;

                const curOffset = offsetRef.current;
                const container = containerRef.current;
                if (!container || !puzzle) return;
                const w = container.clientWidth;
                const h = container.clientHeight;

                const rawTarget = gestureRawOffsetRef.current;
                rawTarget.x = curOffset.x + vx * frameDt;
                rawTarget.y = curOffset.y + vy * frameDt;
                const clamped = clampCanvasOffset(
                  rawTarget,
                  scaleRef.current,
                  puzzle.width,
                  puzzle.height,
                  w,
                  h,
                  gestureClampedOffsetRef.current
                );

                if (clamped.x === curOffset.x && Math.abs(vx) > 0.1) vx = 0;
                if (clamped.y === curOffset.y && Math.abs(vy) > 0.1) vy = 0;

                curOffset.x = clamped.x;
                curOffset.y = clamped.y;
                scheduleCanvasRedraw();

                if (Math.hypot(vx, vy) > 0.02) {
                  commitTransformState(false);
                  momentumAnimIdRef.current = requestAnimationFrame(stepMomentum);
                } else {
                  momentumAnimIdRef.current = null;
                  commitTransformState(true);
                }
              };

              momentumAnimIdRef.current = requestAnimationFrame(stepMomentum);
            }
          }
        }
      }
      return;
    }

    // Single tap / click detection (instant double-tap jump zoom removed per design)
    if (totalDragDistanceRef.current < 12) {
      // Record this tap release so a subsequent tap within 350ms can trigger double-tap drag zoom
      lastTapUpTimeRef.current = Date.now();
      lastTapUpPosRef.current = { x: e.clientX, y: e.clientY };

      const alreadyPaintedInGesture = paintedInGestureRef.current;
      paintedInGestureRef.current = false;

      if (isPreviewMode) {
        onTogglePreview();
      } else if (!alreadyPaintedInGesture) {
        const coords = screenToCanvasCoords(e.clientX, e.clientY);
        if (coords && puzzle) {
          triggerTapDot(coords.x, coords.y);
          onPuzzleInteractionRef.current?.();
          if (isRegionSelectionMode) {
            const selId = resolveAnyUnifiedRegionAtPoint({
              puzzle,
              sortedDescLayers: sortedNestedLayersDescRef.current,
              canvasX: coords.x,
              canvasY: coords.y,
              fatFingerAssist,
              touchReachRadiusPx,
              totalScreenScale: coords.effScale,
              hitOut: hitScratchRef.current,
            });
            if (selId > 0) {
              onRegionSelectTap?.(selId, hitScratchRef.current.layerId);
            }
          } else {
            const rId = resolveUnifiedNearTapRegion({
              puzzle,
              sortedDescLayers: sortedNestedLayersDescRef.current,
              regionById: regionByIdRef.current,
              filledRegionIds,
              canvasX: coords.x,
              canvasY: coords.y,
              activeColorId,
              difficulty,
              fatFingerAssist,
              touchReachRadiusPx,
              totalScreenScale: coords.effScale,
              isFreeColorMode,
              hitOut: hitScratchRef.current,
            });
            const hasExactHit = sampleUnifiedRegionAtWorldPoint(
              puzzle,
              coords.x,
              coords.y,
              sortedNestedLayersDescRef.current,
              exactHitScratchRef.current
            );
            if (rId > 0) {
              if (isPaintMode && hasExactHit && exactHitScratchRef.current.regionId === rId) {
                hitTestAndPaintLine(coords.x, coords.y, coords.x, coords.y, coords.effScale);
              } else {
                onRegionClicked(rId);
              }
            }
          }
        }
      }
    }
  };

  const handlePointerCancel = (e: React.PointerEvent) => {
    paintedInGestureRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignored
    }

    activePointersRef.current.delete(e.pointerId);

    if (e.pointerType === 'touch') {
      touchPointerCountRef.current = activePointersRef.current.size;
      if (touchPointerCountRef.current > 0) {
        if (wasPinchingRef.current) {
          isDraggingRef.current = true;
          isPinchPanningRef.current = true;
          touchStartDistRef.current = null;
          initialTouchCenterRef.current = null;
          const remainingPos = activePointersRef.current.values().next().value;
          if (remainingPos) {
            lastPointerPosRef.current = { x: remainingPos.x, y: remainingPos.y };
            dragStartRef.current = { x: remainingPos.x, y: remainingPos.y };
            resetPointerRing(remainingPos.x, remainingPos.y, performance.now());
          }
          totalDragDistanceRef.current = 100;
        }
        return;
      }
    }

    isDraggingRef.current = false;
    isRightClickRef.current = false;
    isPinchPanningRef.current = false;
    isDoubleTapCandidateRef.current = false;
    isOneFingerZoomingRef.current = false;
    isDoubleTapPanningRef.current = false;
    if (touchPointerCountRef.current === 0) {
      wasPinchingRef.current = false;
    }
    commitTransformState(true);
  };

  // Wheel zoom around cursor (attached natively with { passive: false } so preventDefault works cleanly)
  const handleWheelRef = useRef<(e: WheelEvent) => void>(() => {});
  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (!containerRef.current || !puzzle || e.deltaY === 0) return;
    stopMomentum();
    const hadFocusAnim = focusAnimIdRef.current !== null;
    cancelFocusAnimation(false);

    const baseWheelFactor = e.deltaY < 0 ? 1.2 : 0.82;
    const zoomFactor = Math.pow(baseWheelFactor, effectiveZoomSensitivity);
    const currentScale = scaleRef.current;
    const currentOffset = offsetRef.current;
    const maxZoom = maxZoomScaleRef.current;
    const clampedRawScale = Math.min(maxZoom, Math.max(0.5, currentScale * zoomFactor));
    const newScale = applyZoomSnapDetent(clampedRawScale, snapZoomLevels, maxZoom);
    const actualZoom = newScale / currentScale;

    const w = containerRef.current.clientWidth;
    const h = containerRef.current.clientHeight;
    const rect = refreshCanvasRect();
    if (!rect) {
      if (hadFocusAnim) {
        commitTransformState(true);
        onViewExtentChangedRef.current?.(currentScale, currentOffset.x, currentOffset.y, w, h);
      }
      return;
    }

    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const baseScale = Math.min(w / puzzle.width, h / puzzle.height) * 0.92;
    const baseOffsetX = (w - puzzle.width * baseScale) / 2;
    const baseOffsetY = (h - puzzle.height * baseScale) / 2;

    const focalX = mouseX - (currentOffset.x + baseOffsetX);
    const focalY = mouseY - (currentOffset.y + baseOffsetY);

    const rawTarget = gestureRawOffsetRef.current;
    rawTarget.x = currentOffset.x - focalX * (actualZoom - 1);
    rawTarget.y = currentOffset.y - focalY * (actualZoom - 1);
    const clamped = clampCanvasOffset(
      rawTarget,
      newScale,
      puzzle.width,
      puzzle.height,
      w,
      h,
      gestureClampedOffsetRef.current
    );
    if (
      newScale !== currentScale ||
      clamped.x !== currentOffset.x ||
      clamped.y !== currentOffset.y
    ) {
      scaleRef.current = newScale;
      offsetRef.current.x = clamped.x;
      offsetRef.current.y = clamped.y;
      scheduleCanvasRedraw();
      commitTransformState(true);
      onViewportGestureRef.current?.();
      onPuzzleInteractionRef.current?.();
    } else if (hadFocusAnim) {
      commitTransformState(true);
      onViewExtentChangedRef.current?.(currentScale, currentOffset.x, currentOffset.y, w, h);
    }
  };
  handleWheelRef.current = handleWheel;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onNativeWheel = (e: WheelEvent) => handleWheelRef.current(e);
    canvas.addEventListener('wheel', onNativeWheel, { passive: false });
    return () => {
      canvas.removeEventListener('wheel', onNativeWheel);
    };
  }, []);

  // Multi-touch 2-finger focal-point pinch-to-zoom & pan
  const handleTouchStart = (e: React.TouchEvent) => {
    cancelFocusAnimation(true);
    refreshCanvasRect();
    if (e.touches.length >= 2) {
      stopMomentum();
      onViewportGestureRef.current?.();
      onPuzzleInteractionRef.current?.();
      isDraggingRef.current = false;
      wasPinchingRef.current = true;
      isPinchPanningRef.current = false;
      isDoubleTapCandidateRef.current = false;
      isOneFingerZoomingRef.current = false;
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      const dist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
      touchStartDistRef.current = Math.max(1, dist);
      initialTouchCenterRef.current = {
        x: (t0.clientX + t1.clientX) / 2,
        y: (t0.clientY + t1.clientY) / 2,
      };
      initialTouchScaleRef.current = scaleRef.current;
      initialTouchOffsetRef.current = { ...offsetRef.current };
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length >= 2 && containerRef.current && canvasRef.current && puzzle) {
      const t0 = e.touches[0];
      const t1 = e.touches[1];

      if (touchStartDistRef.current === null || initialTouchCenterRef.current === null) {
        touchStartDistRef.current = Math.max(1, Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY));
        initialTouchCenterRef.current = {
          x: (t0.clientX + t1.clientX) / 2,
          y: (t0.clientY + t1.clientY) / 2,
        };
        initialTouchScaleRef.current = scaleRef.current;
        initialTouchOffsetRef.current = { ...offsetRef.current };
        isDraggingRef.current = false;
        wasPinchingRef.current = true;
        isPinchPanningRef.current = false;
        return;
      }

      const dist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
      const currentCenterX = (t0.clientX + t1.clientX) / 2;
      const currentCenterY = (t0.clientY + t1.clientY) / 2;

      const rawRatio = Math.max(0.01, dist / touchStartDistRef.current);
      const scaledRatio = Math.pow(rawRatio, effectiveZoomSensitivity);
      const maxZoom = maxZoomScaleRef.current;
      const clampedRawScale = Math.min(
        maxZoom,
        Math.max(0.5, initialTouchScaleRef.current * scaledRatio)
      );
      const newScale = applyZoomSnapDetent(clampedRawScale, snapZoomLevels, maxZoom);
      const zoomRatio = newScale / initialTouchScaleRef.current;

      const rect = getCachedCanvasRect();
      if (!rect) return;
      const focalScreenX = initialTouchCenterRef.current.x - rect.left;
      const focalScreenY = initialTouchCenterRef.current.y - rect.top;

      const panDx = currentCenterX - initialTouchCenterRef.current.x;
      const panDy = currentCenterY - initialTouchCenterRef.current.y;

      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      const baseScale = Math.min(w / puzzle.width, h / puzzle.height) * 0.92;
      const baseOffsetX = (w - puzzle.width * baseScale) / 2;
      const baseOffsetY = (h - puzzle.height * baseScale) / 2;

      const focalX = focalScreenX - (initialTouchOffsetRef.current.x + baseOffsetX);
      const focalY = focalScreenY - (initialTouchOffsetRef.current.y + baseOffsetY);

      const rawTarget = gestureRawOffsetRef.current;
      rawTarget.x = initialTouchOffsetRef.current.x + panDx - focalX * (zoomRatio - 1);
      rawTarget.y = initialTouchOffsetRef.current.y + panDy - focalY * (zoomRatio - 1);

      const clamped = clampCanvasOffset(
        rawTarget,
        newScale,
        puzzle.width,
        puzzle.height,
        w,
        h,
        gestureClampedOffsetRef.current
      );
      if (
        newScale !== scaleRef.current ||
        clamped.x !== offsetRef.current.x ||
        clamped.y !== offsetRef.current.y
      ) {
        scaleRef.current = newScale;
        offsetRef.current.x = clamped.x;
        offsetRef.current.y = clamped.y;
        scheduleCanvasRedraw();
        commitTransformState(false);
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    touchPointerCountRef.current = e.touches.length;
    if (e.touches.length === 1) {
      touchStartDistRef.current = null;
      initialTouchCenterRef.current = null;
      if (wasPinchingRef.current) {
        isDraggingRef.current = true;
        isPinchPanningRef.current = true;
        const remaining = e.touches[0];
        lastPointerPosRef.current = { x: remaining.clientX, y: remaining.clientY };
        dragStartRef.current = { x: remaining.clientX, y: remaining.clientY };
        resetPointerRing(remaining.clientX, remaining.clientY, performance.now());
        totalDragDistanceRef.current = 100;
      }
    } else if (e.touches.length === 0) {
      activePointersRef.current.clear();
      touchStartDistRef.current = null;
      initialTouchCenterRef.current = null;
      touchPointerCountRef.current = 0;
      isDraggingRef.current = false;
      isPinchPanningRef.current = false;
      wasPinchingRef.current = false;
      commitTransformState(true);
    }
  };

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full overflow-hidden select-none touch-none ${
        isPaintMode || isRegionSelectionMode ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'
      }`}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      <canvas ref={canvasRef} data-testid="puzzle-canvas" className="block w-full h-full" />
    </div>
  );
});

// --- Multi-Layer Cache, Dirty-Rect, Hydration & Composite Helpers ---

function revokeOwnedObjectUrl(objUrl: string): void {
  if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(objUrl);
  }
}

function disposeAllLayerCaches(caches: Map<string, LayerCanvasCache>): void {
  for (const cache of caches.values()) {
    disposeLayerCanvasCache(cache);
  }
  caches.clear();
}

function resolveLayerSourceImage(
  layer: NestedPuzzleLayer,
  propImages: LayerImageMapLike | undefined,
  hydratedImages: ReadonlyMap<string, HTMLImageElement>
): HTMLImageElement | null {
  const fromProp = lookupLayerImageFromMap(propImages, layer.imageBlobKey, layer.layerId);
  if (fromProp) return fromProp;
  if (layer.imageBlobKey) {
    const hydrated = hydratedImages.get(layer.imageBlobKey);
    if (isReadyCanvasImageSource(hydrated)) return hydrated as HTMLImageElement;
  }
  return null;
}

function writeLayerRegionPixels(
  cache: LayerCanvasCache,
  region: Region,
  isFilled: boolean,
  isDetailMode: boolean,
  paletteMap: Map<number, PaletteColor>,
  paintedRegionColors: Map<number, number> | undefined,
  isColoring: boolean
): void {
  const targetColorId = paintedRegionColors?.get(region.id) ?? region.colorId;
  const col = paletteMap.get(targetColorId);
  writeRegionPixelsToImageData(
    cache.baseImageData.data,
    cache.layerRef.borderMap,
    region.pixels,
    col?.r ?? 71,
    col?.g ?? 85,
    col?.b ?? 105,
    isFilled,
    isDetailMode,
    cache.sourcePixels,
    isColoring
  );
  if (region.minX < cache.dirtyMinX) cache.dirtyMinX = region.minX;
  if (region.minY < cache.dirtyMinY) cache.dirtyMinY = region.minY;
  if (region.maxX > cache.dirtyMaxX) cache.dirtyMaxX = region.maxX;
  if (region.maxY > cache.dirtyMaxY) cache.dirtyMaxY = region.maxY;
}

function collectActiveLayerImageKeys(
  layers: readonly NestedPuzzleLayer[] | undefined
): Set<string> {
  const activeKeys = new Set<string>();
  if (!Array.isArray(layers)) return activeKeys;
  for (let i = 0; i < layers.length; i++) {
    const key = layers[i]?.imageBlobKey;
    if (typeof key === 'string' && key.length > 0) {
      activeKeys.add(key);
    }
  }
  return activeKeys;
}

function purgeStaleOwnedLayerUrls(
  ownedUrls: Map<string, string>,
  hydratedImages: Map<string, HTMLImageElement>,
  loadingKeys: Set<string>,
  failedKeys: Set<string>,
  activeKeys: Set<string>
): void {
  for (const [key, objUrl] of ownedUrls) {
    if (!activeKeys.has(key)) {
      revokeOwnedObjectUrl(objUrl);
      ownedUrls.delete(key);
      hydratedImages.delete(key);
      loadingKeys.delete(key);
      failedKeys.delete(key);
    }
  }
}

function syncMaterializedLayerSourceImages(
  layerCaches: Map<string, LayerCanvasCache>,
  layerImages: LayerImageMapLike | undefined,
  hydratedImages: ReadonlyMap<string, HTMLImageElement>,
  onlyKey?: string
): boolean {
  let updated = false;
  for (const cache of layerCaches.values()) {
    if (onlyKey && cache.layerRef.imageBlobKey !== onlyKey) continue;
    const resolvedImg = resolveLayerSourceImage(cache.layerRef, layerImages, hydratedImages);
    if (resolvedImg !== cache.sourceImage) {
      cache.sourceImage = resolvedImg;
      cache.sourcePixels = resolvedImg
        ? extractImagePixelsRgba(resolvedImg, cache.width, cache.height)
        : null;
      cache.lastMaskedPreviewImage = null;
      cache.lastMode = null;
      cache.lastImageLoaded = false;
      updated = true;
    }
  }
  return updated;
}

function canHydrateBrowserLayerBlobs(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof Image !== 'undefined' &&
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function'
  );
}

function hydrateSingleLayerImageBlob(
  key: string,
  myGen: number,
  hydrationGenRef: React.MutableRefObject<number>,
  ownedUrls: Map<string, string>,
  hydratedImages: Map<string, HTMLImageElement>,
  loadingKeys: Set<string>,
  failedKeys: Set<string>,
  layerCachesRef: React.MutableRefObject<Map<string, LayerCanvasCache>>,
  layerImagesPropRef: React.MutableRefObject<LayerImageMapLike | undefined>,
  scheduleCanvasRedraw: () => void
): void {
  loadingKeys.add(key);
  void StorageService.loadImageBlob(key)
    .catch(() => null)
    .then((blob) => {
      if (myGen !== hydrationGenRef.current) {
        return;
      }
      if (!blob) {
        loadingKeys.delete(key);
        failedKeys.add(key);
        return;
      }
      const objUrl = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        if (myGen !== hydrationGenRef.current) {
          revokeOwnedObjectUrl(objUrl);
          return;
        }
        loadingKeys.delete(key);
        const prevOwned = ownedUrls.get(key);
        if (prevOwned && prevOwned !== objUrl) {
          revokeOwnedObjectUrl(prevOwned);
        }
        ownedUrls.set(key, objUrl);
        hydratedImages.set(key, img);
        const cacheUpdated = syncMaterializedLayerSourceImages(
          layerCachesRef.current,
          layerImagesPropRef.current,
          hydratedImages,
          key
        );
        if (cacheUpdated || layerCachesRef.current.size === 0) {
          scheduleCanvasRedraw();
        }
      };
      img.onerror = () => {
        revokeOwnedObjectUrl(objUrl);
        if (myGen === hydrationGenRef.current) {
          loadingKeys.delete(key);
          failedKeys.add(key);
        }
      };
      img.src = objUrl;
    });
}

interface RootDirtyBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const ROOT_DIRTY_SCRATCH: RootDirtyBounds = { minX: 0, minY: 0, maxX: -1, maxY: -1 };

function applySingleRegionBaseUpdate(
  entry: UnifiedRegionRef,
  isFilled: boolean,
  puzzle: PuzzleData,
  rootData: Uint8ClampedArray,
  rootDirty: RootDirtyBounds,
  srcPixels: Uint8ClampedArray | null,
  palMap: Map<number, PaletteColor>,
  layerCaches: Map<string, LayerCanvasCache>,
  dirtyLayers: Set<string>,
  paintedRegionColors: Map<number, number> | undefined,
  isDetailMode: boolean,
  isFreeColorMode: boolean,
  isColoring: boolean,
  writeRegionToImageData: (
    data: Uint8ClampedArray,
    puzzleData: PuzzleData,
    region: Region,
    isFilled: boolean,
    isDetailMode: boolean,
    srcPixels: Uint8ClampedArray | null,
    paletteMap: Map<number, PaletteColor>,
    customColors?: Map<number, number>,
    isFreeColor?: boolean
  ) => void
): void {
  if (entry.layer === null) {
    writeRegionToImageData(
      rootData,
      puzzle,
      entry.region,
      isFilled,
      isDetailMode,
      srcPixels,
      palMap,
      paintedRegionColors,
      isFreeColorMode
    );
    if (entry.region.minX < rootDirty.minX) rootDirty.minX = entry.region.minX;
    if (entry.region.minY < rootDirty.minY) rootDirty.minY = entry.region.minY;
    if (entry.region.maxX > rootDirty.maxX) rootDirty.maxX = entry.region.maxX;
    if (entry.region.maxY > rootDirty.maxY) rootDirty.maxY = entry.region.maxY;
    return;
  }
  const cache = layerCaches.get(entry.layer.layerId);
  if (cache && cache.layerRef === entry.layer) {
    writeLayerRegionPixels(
      cache,
      entry.region,
      isFilled,
      isDetailMode,
      palMap,
      paintedRegionColors,
      isColoring
    );
    dirtyLayers.add(entry.layer.layerId);
  }
}

function flushDirtyLayerCaches(
  layerCaches: Map<string, LayerCanvasCache>,
  dirtyLayers: Set<string>
): void {
  for (const layerId of dirtyLayers) {
    const cache = layerCaches.get(layerId);
    if (!cache || cache.dirtyMaxX < cache.dirtyMinX || cache.dirtyMaxY < cache.dirtyMinY) continue;
    const lCtx = cache.baseCanvas.getContext('2d');
    if (lCtx) {
      lCtx.putImageData(
        cache.baseImageData,
        0,
        0,
        cache.dirtyMinX,
        cache.dirtyMinY,
        cache.dirtyMaxX - cache.dirtyMinX + 1,
        cache.dirtyMaxY - cache.dirtyMinY + 1
      );
    }
    cache.dirtyMinX = cache.width;
    cache.dirtyMinY = cache.height;
    cache.dirtyMaxX = -1;
    cache.dirtyMaxY = -1;
  }
  dirtyLayers.clear();
}

function applyIncrementalBaseCanvasUpdate(
  puzzle: PuzzleData,
  baseCanvas: HTMLCanvasElement,
  imgData: ImageData,
  srcPixels: Uint8ClampedArray | null,
  palMap: Map<number, PaletteColor>,
  worldMap: Map<number, UnifiedRegionRef>,
  layerCaches: Map<string, LayerCanvasCache>,
  dirtyLayers: Set<string>,
  prevPainted: Set<number>,
  prevColors: Map<number, number>,
  filledRegionIds: Set<number>,
  paintedRegionColors: Map<number, number> | undefined,
  isDetailMode: boolean,
  isFreeColorMode: boolean,
  writeRegionToImageData: (
    data: Uint8ClampedArray,
    puzzleData: PuzzleData,
    region: Region,
    isFilled: boolean,
    isDetailMode: boolean,
    srcPixels: Uint8ClampedArray | null,
    paletteMap: Map<number, PaletteColor>,
    customColors?: Map<number, number>,
    isFreeColor?: boolean
  ) => void
): void {
  const baseCtx = baseCanvas.getContext('2d');
  if (!baseCtx) return;
  const data = imgData.data;
  const isColoring = Boolean(isFreeColorMode || puzzle.isFreeColor);

  const rootDirty = ROOT_DIRTY_SCRATCH;
  rootDirty.minX = puzzle.width;
  rootDirty.minY = puzzle.height;
  rootDirty.maxX = -1;
  rootDirty.maxY = -1;
  dirtyLayers.clear();

  for (const rId of filledRegionIds) {
    const curCol = paintedRegionColors?.get(rId);
    if (!prevPainted.has(rId) || curCol !== prevColors.get(rId)) {
      const entry = worldMap.get(rId);
      if (entry) {
        applySingleRegionBaseUpdate(
          entry,
          true,
          puzzle,
          data,
          rootDirty,
          srcPixels,
          palMap,
          layerCaches,
          dirtyLayers,
          paintedRegionColors,
          isDetailMode,
          isFreeColorMode,
          isColoring,
          writeRegionToImageData
        );
      }
      prevPainted.add(rId);
      if (curCol !== undefined) {
        prevColors.set(rId, curCol);
      } else {
        prevColors.delete(rId);
      }
    }
  }

  for (const rId of prevPainted) {
    if (!filledRegionIds.has(rId)) {
      const entry = worldMap.get(rId);
      if (entry) {
        applySingleRegionBaseUpdate(
          entry,
          false,
          puzzle,
          data,
          rootDirty,
          srcPixels,
          palMap,
          layerCaches,
          dirtyLayers,
          paintedRegionColors,
          isDetailMode,
          isFreeColorMode,
          isColoring,
          writeRegionToImageData
        );
      }
      prevPainted.delete(rId);
      prevColors.delete(rId);
    }
  }

  if (rootDirty.maxX >= rootDirty.minX && rootDirty.maxY >= rootDirty.minY) {
    baseCtx.putImageData(
      imgData,
      0,
      0,
      rootDirty.minX,
      rootDirty.minY,
      rootDirty.maxX - rootDirty.minX + 1,
      rootDirty.maxY - rootDirty.minY + 1
    );
  }

  flushDirtyLayerCaches(layerCaches, dirtyLayers);
}

function ensureLayerCanvasCache(
  puzzle: PuzzleData,
  layer: NestedPuzzleLayer,
  caches: Map<string, LayerCanvasCache>,
  paletteMap: Map<number, PaletteColor>,
  propImages: LayerImageMapLike | undefined,
  hydratedImages: ReadonlyMap<string, HTMLImageElement>,
  filledRegionIds: Set<number>,
  paintedRegionColors: Map<number, number> | undefined,
  regionColorMode: RegionColorMode,
  isFreeColorMode: boolean,
  currentFrame: number
): LayerCanvasCache | null {
  let cache = caches.get(layer.layerId);
  if (cache && cache.layerRef !== layer) {
    disposeLayerCanvasCache(cache);
    caches.delete(layer.layerId);
    cache = undefined;
  }

  if (!cache) {
    evictLruLayerCaches(caches, MAX_LIVE_LAYER_CACHES - 1, currentFrame);
    const baseCanvas = document.createElement('canvas');
    baseCanvas.width = layer.width;
    baseCanvas.height = layer.height;
    const baseCtx = baseCanvas.getContext('2d');
    if (!baseCtx) return null;
    const baseImageData = baseCtx.createImageData(layer.width, layer.height);
    const regionById = new Map<number, Region>();
    for (let i = 0; i < layer.regions.length; i++) {
      regionById.set(layer.regions[i].id, layer.regions[i]);
    }
    cache = {
      layerId: layer.layerId,
      layerRef: layer,
      width: layer.width,
      height: layer.height,
      regionById,
      baseCanvas,
      baseImageData,
      borderCanvas: null,
      highlightCanvas: null,
      highlightImageData: null,
      hasHighlightPixels: false,
      highlightVersion: -1,
      selectionCanvas: null,
      selectionImageData: null,
      hasSelectionPixels: false,
      selectionVersion: -1,
      sourceImage: null,
      sourcePixels: null,
      maskedPreviewCanvas: null,
      lastMaskedPreviewImage: null,
      lastMode: null,
      lastFreeColor: false,
      lastImageLoaded: false,
      dirtyMinX: layer.width,
      dirtyMinY: layer.height,
      dirtyMaxX: -1,
      dirtyMaxY: -1,
      lastAccessedFrame: currentFrame,
      silhouetteSegments: null,
      silhouettePath: null,
      silhouetteComputed: false,
      silhouetteWorldX: NaN,
      silhouetteWorldY: NaN,
      silhouetteWorldW: NaN,
      silhouetteWorldH: NaN,
      lastFilledSetRef: null,
      lastFilledSetSize: -1,
      hasUnfilledRegions: false,
    };
    caches.set(layer.layerId, cache);
  }

  const resolvedImg = resolveLayerSourceImage(layer, propImages, hydratedImages);
  if (resolvedImg !== cache.sourceImage) {
    cache.sourceImage = resolvedImg;
    cache.sourcePixels = resolvedImg
      ? extractImagePixelsRgba(resolvedImg, layer.width, layer.height)
      : null;
    cache.lastMaskedPreviewImage = null;
    cache.lastMode = null;
    cache.lastImageLoaded = false;
  }

  const hasSourceImage = Boolean(cache.sourceImage);
  if (
    cache.lastMode !== regionColorMode ||
    cache.lastFreeColor !== isFreeColorMode ||
    cache.lastImageLoaded !== hasSourceImage
  ) {
    const baseCtx = cache.baseCanvas.getContext('2d');
    if (baseCtx) {
      writeBaseCanvasPixels(
        cache.baseImageData.data,
        layer.regionMap,
        layer.borderMap,
        filledRegionIds,
        cache.regionById,
        paletteMap,
        paintedRegionColors,
        regionColorMode === 'DETAIL',
        cache.sourcePixels,
        Boolean(isFreeColorMode || puzzle.isFreeColor)
      );
      baseCtx.putImageData(cache.baseImageData, 0, 0);
    }
    cache.lastMode = regionColorMode;
    cache.lastFreeColor = isFreeColorMode;
    cache.lastImageLoaded = hasSourceImage;
    cache.dirtyMinX = cache.width;
    cache.dirtyMinY = cache.height;
    cache.dirtyMaxX = -1;
    cache.dirtyMaxY = -1;
  }

  cache.lastAccessedFrame = currentFrame;
  return cache;
}

function ensureLayerMaskedPreviewCanvas(cache: LayerCanvasCache): HTMLCanvasElement | null {
  const srcImg = cache.sourceImage;
  if (!srcImg || !isReadyCanvasImageSource(srcImg)) return null;
  if (cache.maskedPreviewCanvas && cache.lastMaskedPreviewImage === srcImg) {
    return cache.maskedPreviewCanvas;
  }
  if (!cache.maskedPreviewCanvas) {
    cache.maskedPreviewCanvas = document.createElement('canvas');
  }
  if (buildMaskedPreviewCanvas(cache.maskedPreviewCanvas, srcImg, cache.layerRef)) {
    cache.lastMaskedPreviewImage = srcImg;
    return cache.maskedPreviewCanvas;
  }
  cache.lastMaskedPreviewImage = null;
  return null;
}

function syncLayerHighlightCanvas(
  cache: LayerCanvasCache,
  puzzle: PuzzleData,
  filledRegionIds: Set<number>,
  activeColorId: number,
  hintRegionId: number | null,
  highlightMatching: boolean,
  highlightStyle: RegionHighlightStyle,
  hintFillStyle: HintFillStyle,
  hintColorArgb: number,
  highlightVersion: number
): void {
  if (cache.highlightVersion === highlightVersion) return;
  if (!cache.highlightCanvas) {
    cache.highlightCanvas = document.createElement('canvas');
    cache.highlightCanvas.width = cache.width;
    cache.highlightCanvas.height = cache.height;
  }
  const hCtx = cache.highlightCanvas.getContext('2d');
  if (!hCtx) {
    cache.hasHighlightPixels = false;
    cache.highlightVersion = highlightVersion;
    return;
  }
  let imgData = cache.highlightImageData;
  if (!imgData || imgData.width !== cache.width || imgData.height !== cache.height) {
    imgData = hCtx.createImageData(cache.width, cache.height);
    cache.highlightImageData = imgData;
  } else {
    imgData.data.fill(0);
  }
  const activePal = puzzle.palette.find((c) => c.id === activeColorId);
  const anyPixel = renderHighlightLayerToImageData(
    imgData.data,
    cache.width,
    cache.height,
    cache.layerRef.borderMap,
    cache.layerRef.regions,
    filledRegionIds,
    activeColorId,
    hintRegionId,
    highlightMatching,
    highlightStyle,
    hintFillStyle,
    hintColorArgb,
    activePal
  );
  if (anyPixel) {
    hCtx.putImageData(imgData, 0, 0);
  }
  cache.hasHighlightPixels = anyPixel;
  cache.highlightVersion = highlightVersion;
}

function syncLayerSelectionCanvas(
  cache: LayerCanvasCache,
  selectedRegionIds: ReadonlySet<number>,
  selectionVersion: number
): void {
  if (cache.selectionVersion === selectionVersion) return;
  if (!cache.selectionCanvas) {
    cache.selectionCanvas = document.createElement('canvas');
    cache.selectionCanvas.width = cache.width;
    cache.selectionCanvas.height = cache.height;
  }
  const sCtx = cache.selectionCanvas.getContext('2d');
  if (!sCtx) {
    cache.hasSelectionPixels = false;
    cache.selectionVersion = selectionVersion;
    return;
  }
  let imgData = cache.selectionImageData;
  if (!imgData || imgData.width !== cache.width || imgData.height !== cache.height) {
    imgData = sCtx.createImageData(cache.width, cache.height);
    cache.selectionImageData = imgData;
  } else {
    imgData.data.fill(0);
  }
  const anyPixel = renderSelectionOverlayToImageData(
    imgData.data,
    cache.layerRef,
    selectedRegionIds,
    cache.regionById
  );
  if (anyPixel) {
    sCtx.putImageData(imgData, 0, 0);
  }
  cache.hasSelectionPixels = anyPixel;
  cache.selectionVersion = selectionVersion;
}

function drawSingleNestedLayerPreview(
  ctx: CanvasRenderingContext2D,
  cache: LayerCanvasCache,
  layer: NestedPuzzleLayer,
  showPreviewBorders: boolean,
  wx: number,
  wy: number,
  ww: number,
  wh: number
): void {
  const maskedPreview = ensureLayerMaskedPreviewCanvas(cache);
  ctx.drawImage(maskedPreview ?? cache.baseCanvas, wx, wy, ww, wh);
  if (!showPreviewBorders) return;
  if (!cache.borderCanvas) {
    const borderCanvas = document.createElement('canvas');
    if (buildPreviewBorderCanvas(borderCanvas, layer)) {
      cache.borderCanvas = borderCanvas;
    }
  }
  if (cache.borderCanvas) {
    ctx.drawImage(cache.borderCanvas, wx, wy, ww, wh);
  }
}

function drawSingleNestedLayerInteractive(
  ctx: CanvasRenderingContext2D,
  puzzle: PuzzleData,
  cache: LayerCanvasCache,
  layer: NestedPuzzleLayer,
  filledRegionIds: Set<number>,
  isColoring: boolean,
  wantHighlights: boolean,
  wantSelection: boolean,
  selectedRegionIds: ReadonlySet<number> | undefined,
  selectionLayerId: string | null | undefined,
  activeColorId: number,
  hintRegionId: number | null,
  highlightMatching: boolean,
  highlightStyle: RegionHighlightStyle,
  hintFillStyle: HintFillStyle,
  hintColorArgb: number,
  animateHint: boolean,
  reducedMotion: boolean,
  hintIntensity: number,
  currentPulseAlpha: number,
  highlightVersion: number,
  selectionVersion: number,
  wx: number,
  wy: number,
  ww: number,
  wh: number
): void {
  ctx.drawImage(cache.baseCanvas, wx, wy, ww, wh);

  if (wantHighlights) {
    syncLayerHighlightCanvas(
      cache,
      puzzle,
      filledRegionIds,
      activeColorId,
      hintRegionId,
      highlightMatching,
      highlightStyle,
      hintFillStyle,
      hintColorArgb,
      highlightVersion
    );
    if (cache.hasHighlightPixels && cache.highlightCanvas) {
      ctx.save();
      ctx.globalAlpha = computeHighlightOverlayAlpha(
        animateHint,
        reducedMotion,
        hintIntensity,
        currentPulseAlpha
      );
      ctx.drawImage(cache.highlightCanvas, wx, wy, ww, wh);
      ctx.restore();
    }
  }

  if (isColoring) {
    const maskedPreview = ensureLayerMaskedPreviewCanvas(cache);
    if (maskedPreview) {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(maskedPreview, wx, wy, ww, wh);
      ctx.restore();
    }
  }

  if (wantSelection && selectedRegionIds) {
    if (selectionLayerId === undefined || selectionLayerId === layer.layerId) {
      syncLayerSelectionCanvas(cache, selectedRegionIds, selectionVersion);
      if (cache.hasSelectionPixels && cache.selectionCanvas) {
        ctx.drawImage(cache.selectionCanvas, wx, wy, ww, wh);
      }
    }
  }
}

function syncLayerHasUnfilledRegions(
  cache: LayerCanvasCache,
  layer: NestedPuzzleLayer,
  filledRegionIds: ReadonlySet<number>
): boolean {
  if (
    cache.lastFilledSetRef === filledRegionIds &&
    cache.lastFilledSetSize === filledRegionIds.size
  ) {
    return cache.hasUnfilledRegions;
  }
  let hasUnfilled = false;
  const regions = layer.regions;
  for (let i = 0; i < regions.length; i++) {
    if (!filledRegionIds.has(regions[i].id)) {
      hasUnfilled = true;
      break;
    }
  }
  cache.lastFilledSetRef = filledRegionIds;
  cache.lastFilledSetSize = filledRegionIds.size;
  cache.hasUnfilledRegions = hasUnfilled;
  return hasUnfilled;
}

function ensureLayerSilhouetteCache(
  cache: LayerCanvasCache,
  layer: NestedPuzzleLayer,
  wx: number,
  wy: number,
  ww: number,
  wh: number
): void {
  if (
    cache.silhouetteComputed &&
    cache.silhouetteWorldX === wx &&
    cache.silhouetteWorldY === wy &&
    cache.silhouetteWorldW === ww &&
    cache.silhouetteWorldH === wh
  ) {
    return;
  }
  if (!cache.silhouetteComputed) {
    const segments = extractLayerSilhouetteContours(layer.regionMap, layer.width, layer.height);
    cache.silhouetteSegments = segments.length > 0 ? segments : null;
    cache.silhouetteComputed = true;
  }
  cache.silhouettePath =
    cache.silhouetteSegments && layer.width > 0 && layer.height > 0
      ? buildLayerSilhouettePath(
          cache.silhouetteSegments,
          wx,
          wy,
          ww / layer.width,
          wh / layer.height
        )
      : null;
  cache.silhouetteWorldX = wx;
  cache.silhouetteWorldY = wy;
  cache.silhouetteWorldW = ww;
  cache.silhouetteWorldH = wh;
}

function drawVisibleNestedLayers(
  ctx: CanvasRenderingContext2D,
  puzzle: PuzzleData,
  visibleLayers: readonly NestedPuzzleLayer[],
  caches: Map<string, LayerCanvasCache>,
  paletteMap: Map<number, PaletteColor>,
  propImages: LayerImageMapLike | undefined,
  hydratedImages: ReadonlyMap<string, HTMLImageElement>,
  filledRegionIds: Set<number>,
  paintedRegionColors: Map<number, number> | undefined,
  regionColorMode: RegionColorMode,
  isEffectivePreview: boolean,
  showPreviewBorders: boolean,
  isFreeColorMode: boolean,
  isRegionSelectionMode: boolean,
  selectedRegionIds: ReadonlySet<number> | undefined,
  selectionLayerId: string | null | undefined,
  activeColorId: number,
  hintRegionId: number | null,
  highlightMatching: boolean,
  highlightStyle: RegionHighlightStyle,
  hintFillStyle: HintFillStyle,
  hintColorArgb: number,
  animateHint: boolean,
  reducedMotion: boolean,
  hintIntensity: number,
  currentPulseAlpha: number,
  highlightVersion: number,
  selectionVersion: number,
  effScale: number,
  effDpr: number,
  currentFrame: number
): void {
  const isColoring = Boolean(isFreeColorMode || puzzle.isFreeColor);
  const wantHighlights =
    !isRegionSelectionMode &&
    (highlightStyle === 'FULL_REGION' || highlightStyle === 'BOUNDARY_ONLY') &&
    (highlightMatching || hintRegionId !== null);
  const wantSelection = Boolean(
    isRegionSelectionMode && selectedRegionIds && selectedRegionIds.size > 0
  );

  const prevSmoothEnabled = ctx.imageSmoothingEnabled;
  const prevSmoothQuality = ctx.imageSmoothingQuality;
  try {
    for (let i = 0; i < visibleLayers.length; i++) {
      const layer = visibleLayers[i];
      const cache = ensureLayerCanvasCache(
        puzzle,
        layer,
        caches,
        paletteMap,
        propImages,
        hydratedImages,
        filledRegionIds,
        paintedRegionColors,
        regionColorMode,
        isFreeColorMode,
        currentFrame
      );
      if (!cache) continue;

      const b = layer.worldBounds;
      const wx = b.x * puzzle.width;
      const wy = b.y * puzzle.height;
      const ww = b.width * puzzle.width;
      const wh = b.height * puzzle.height;

      const layerTexelRatio = Math.max(
        computeLayerTexelRatio(ww, layer.width, effScale, effDpr),
        computeLayerTexelRatio(wh, layer.height, effScale, effDpr)
      );
      const hasDeeperChild = hasOverlappingDeeperVisibleLayer(visibleLayers, i);
      const smooth = resolveLayerImageSmoothing(
        layerTexelRatio,
        true,
        hasDeeperChild,
        LAYER_SMOOTHING_SCRATCH
      );
      ctx.imageSmoothingEnabled = smooth.imageSmoothingEnabled;
      ctx.imageSmoothingQuality = smooth.imageSmoothingQuality;

      if (isEffectivePreview) {
        drawSingleNestedLayerPreview(ctx, cache, layer, showPreviewBorders, wx, wy, ww, wh);
      } else {
        drawSingleNestedLayerInteractive(
          ctx,
          puzzle,
          cache,
          layer,
          filledRegionIds,
          isColoring,
          wantHighlights,
          wantSelection,
          selectedRegionIds,
          selectionLayerId,
          activeColorId,
          hintRegionId,
          highlightMatching,
          highlightStyle,
          hintFillStyle,
          hintColorArgb,
          animateHint,
          reducedMotion,
          hintIntensity,
          currentPulseAlpha,
          highlightVersion,
          selectionVersion,
          wx,
          wy,
          ww,
          wh
        );
      }

      const isLargeEnoughForHairline =
        Math.max(ww * effScale, wh * effScale) >= LAYER_SILHOUETTE_MIN_SCREEN_PX;
      const shouldDrawHairline =
        isLargeEnoughForHairline &&
        (isEffectivePreview
          ? showPreviewBorders
          : syncLayerHasUnfilledRegions(cache, layer, filledRegionIds));
      if (shouldDrawHairline) {
        ensureLayerSilhouetteCache(cache, layer, wx, wy, ww, wh);
        strokeLayerSilhouette(
          ctx,
          cache.silhouetteSegments,
          cache.silhouettePath,
          wx,
          wy,
          ww,
          wh,
          layer.width,
          layer.height,
          effScale
        );
      }
    }
  } finally {
    ctx.imageSmoothingEnabled = prevSmoothEnabled;
    ctx.imageSmoothingQuality = prevSmoothQuality;
  }
}

// --- Canvas Label & Centroid Glow Renderer ---

function computeLabelCornerFactor(charCount: number): number {
  if (charCount === 1) return 0.4841;
  if (charCount === 2) return 0.7099;
  if (charCount === 3) return 0.9767;
  return Math.sqrt(0.09 * charCount * charCount + 0.1444);
}

function drawRegionCentroidGlows(
  ctx: CanvasRenderingContext2D,
  worldCentroidX: number,
  worldCentroidY: number,
  worldMinDim: number,
  isActive: boolean,
  isHinted: boolean,
  highlightMatching: boolean,
  hr: number,
  hg: number,
  hb: number,
  ar: number,
  ag: number,
  ab: number,
  hintIntensity: number,
  pulseAlpha: number,
  animateHint: boolean,
  effScale: number
): void {
  if (isActive && highlightMatching) {
    const alpha = animateHint ? pulseAlpha * hintIntensity * 0.8 : hintIntensity * 0.7;
    ctx.beginPath();
    ctx.arc(worldCentroidX, worldCentroidY, Math.max(4 / effScale, worldMinDim * 0.18), 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${ar}, ${ag}, ${ab}, ${alpha})`;
    ctx.fill();
  }
  if (isHinted) {
    const alpha = animateHint ? pulseAlpha * hintIntensity * 0.95 : hintIntensity * 0.9;
    ctx.beginPath();
    ctx.arc(worldCentroidX, worldCentroidY, Math.max(8 / effScale, worldMinDim * 0.45), 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${hr}, ${hg}, ${hb}, ${alpha})`;
    ctx.fill();
  }
}

function drawRegionLabelAndGlow(
  ctx: CanvasRenderingContext2D,
  region: Region,
  worldCentroidX: number,
  worldCentroidY: number,
  worldMinDim: number,
  worldMaxRadius: number,
  activeColorId: number,
  hintRegionId: number | null,
  displayNumberMap: Map<number, string>,
  drawLabelsNow: boolean,
  highlightMatching: boolean,
  drawGlowCircle: boolean,
  hr: number,
  hg: number,
  hb: number,
  ar: number,
  ag: number,
  ab: number,
  hintIntensity: number,
  pulseAlpha: number,
  animateHint: boolean,
  effScale: number,
  effMinArtwork: number,
  effMaxArtwork: number,
  normalTextColor: string,
  activeTextColor: string,
  hintTextColor: string,
  visLeft: number,
  visTop: number,
  visRight: number,
  visBottom: number,
  isEffectivePreview: boolean
): void {
  const isActive = region.colorId === activeColorId;
  const isHinted = region.id === hintRegionId;

  if (
    !isActive &&
    !isHinted &&
    (worldCentroidX < visLeft ||
      worldCentroidX > visRight ||
      worldCentroidY < visTop ||
      worldCentroidY > visBottom)
  ) {
    return;
  }

  if (!isEffectivePreview && drawGlowCircle && (isActive || isHinted)) {
    drawRegionCentroidGlows(
      ctx,
      worldCentroidX,
      worldCentroidY,
      worldMinDim,
      isActive,
      isHinted,
      highlightMatching,
      hr,
      hg,
      hb,
      ar,
      ag,
      ab,
      hintIntensity,
      pulseAlpha,
      animateHint,
      effScale
    );
  }

  if (!drawLabelsNow) return;

  const labelText = displayNumberMap.get(region.colorId) || region.colorId.toString();
  const cornerFactor = computeLabelCornerFactor(labelText.length);
  const safetyMargin = 0.9;
  const maxFittingArtworkSize =
    worldMaxRadius > 0
      ? (worldMaxRadius * safetyMargin) / cornerFactor
      : (worldMinDim * 0.4 * safetyMargin) / cornerFactor;

  if (!isActive && !isHinted && maxFittingArtworkSize < effMinArtwork) {
    return;
  }

  const fitSize = Math.min(effMaxArtwork, maxFittingArtworkSize);
  const targetTextSize =
    isActive || isHinted ? Math.max(Math.min(effMinArtwork, 2 / effScale), fitSize) : fitSize;

  ctx.font = isHinted
    ? `700 ${targetTextSize}px "Inter", -apple-system, sans-serif`
    : `600 ${targetTextSize}px "Inter", -apple-system, sans-serif`;

  const isMatch = isActive && highlightMatching;
  ctx.fillStyle = isHinted ? hintTextColor : isMatch ? activeTextColor : normalTextColor;

  // Scale stroke outline cleanly in screen space across 1x..256x zoom
  ctx.lineWidth = Math.max(0.5 / effScale, Math.min(1.5 / effScale, targetTextSize * 0.22));
  ctx.strokeText(labelText, worldCentroidX, worldCentroidY);
  ctx.fillText(labelText, worldCentroidX, worldCentroidY);
}

function renderLabels(
  ctx: CanvasRenderingContext2D,
  puzzle: PuzzleData,
  sortedNestedLayers: readonly NestedPuzzleLayer[],
  worldRegionById: ReadonlyMap<number, UnifiedRegionRef>,
  filledRegionIds: Set<number>,
  activeColorId: number,
  hintRegionId: number | null,
  displayNumberMap: Map<number, string>,
  drawLabelsNow: boolean,
  highlightMatching: boolean,
  highlightStyle: RegionHighlightStyle,
  hintColorArgb: number,
  hintIntensity: number,
  pulseAlpha: number,
  animateHint: boolean,
  effScale: number,
  labelScale: number,
  minLabelSize: number,
  maxLabelSize: number,
  visLeft: number,
  visTop: number,
  visRight: number,
  visBottom: number,
  isEffectivePreview: boolean
): void {
  const drawGlowCircle = highlightStyle === 'CENTROID_GLOW';

  const hr = (hintColorArgb >> 16) & 0xff;
  const hg = (hintColorArgb >> 8) & 0xff;
  const hb = hintColorArgb & 0xff;

  const activePal = puzzle.palette.find((c) => c.id === activeColorId);
  const ar = activePal ? activePal.r : 251;
  const ag = activePal ? activePal.g : 191;
  const ab = activePal ? activePal.b : 36;

  const effMinArtwork = (minLabelSize * labelScale) / effScale;
  const effMaxArtwork = (maxLabelSize * labelScale) / effScale;

  const normalTextColor = isEffectivePreview ? '#0f172a' : '#334155';
  const activeTextColor = '#d97706';
  const hintAlpha = animateHint ? Math.min(1, Math.max(0.4, pulseAlpha * 1.1)) : 1.0;
  const hintTextColor = `rgba(${hr}, ${hg}, ${hb}, ${hintAlpha})`;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 2 / effScale;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineJoin = 'round';

  // Pass 1: Root puzzle regions
  const rootRegions = puzzle.regions;
  for (let i = 0; i < rootRegions.length; i++) {
    const region = rootRegions[i];
    if (filledRegionIds.has(region.id)) continue;
    const minDim = Math.min(region.maxX - region.minX + 1, region.maxY - region.minY + 1);
    drawRegionLabelAndGlow(
      ctx,
      region,
      region.centroidX,
      region.centroidY,
      minDim,
      region.maxRadius,
      activeColorId,
      hintRegionId,
      displayNumberMap,
      drawLabelsNow,
      highlightMatching,
      drawGlowCircle,
      hr,
      hg,
      hb,
      ar,
      ag,
      ab,
      hintIntensity,
      pulseAlpha,
      animateHint,
      effScale,
      effMinArtwork,
      effMaxArtwork,
      normalTextColor,
      activeTextColor,
      hintTextColor,
      visLeft,
      visTop,
      visRight,
      visBottom,
      isEffectivePreview
    );
  }

  // Pass 2: Visible non-culled nested layer regions in world coordinates
  const hintedEntry = hintRegionId !== null ? worldRegionById.get(hintRegionId) : undefined;
  for (let li = 0; li < sortedNestedLayers.length; li++) {
    const layer = sortedNestedLayers[li];
    if (!layer || layer.width <= 0 || layer.height <= 0 || !isValidNormalizedRect(layer.worldBounds)) {
      continue;
    }
    const b = layer.worldBounds;
    const wx = b.x * puzzle.width;
    const wy = b.y * puzzle.height;
    const ww = b.width * puzzle.width;
    const wh = b.height * puzzle.height;
    if (wx + ww < visLeft || wx > visRight || wy + wh < visTop || wy > visBottom) {
      continue;
    }

    if (ww * effScale < MIN_LAYER_RENDER_SCREEN_PX || wh * effScale < MIN_LAYER_RENDER_SCREEN_PX) {
      if (
        hintedEntry &&
        hintedEntry.layerId === layer.layerId &&
        !filledRegionIds.has(hintedEntry.region.id)
      ) {
        const minDim = Math.min(
          hintedEntry.worldMaxX - hintedEntry.worldMinX,
          hintedEntry.worldMaxY - hintedEntry.worldMinY
        );
        drawRegionLabelAndGlow(
          ctx,
          hintedEntry.region,
          hintedEntry.worldCentroidX,
          hintedEntry.worldCentroidY,
          minDim,
          hintedEntry.worldMaxRadius,
          activeColorId,
          hintRegionId,
          displayNumberMap,
          drawLabelsNow,
          highlightMatching,
          drawGlowCircle,
          hr,
          hg,
          hb,
          ar,
          ag,
          ab,
          hintIntensity,
          pulseAlpha,
          animateHint,
          effScale,
          effMinArtwork,
          effMaxArtwork,
          normalTextColor,
          activeTextColor,
          hintTextColor,
          visLeft,
          visTop,
          visRight,
          visBottom,
          isEffectivePreview
        );
      }
      continue;
    }

    const scaleX = ww / layer.width;
    const scaleY = wh / layer.height;
    const radiusScale = Math.min(scaleX, scaleY);
    const layerRegions = layer.regions;
    for (let i = 0; i < layerRegions.length; i++) {
      const region = layerRegions[i];
      if (filledRegionIds.has(region.id)) continue;
      const worldMinDim = Math.min(
        (region.maxX - region.minX + 1) * scaleX,
        (region.maxY - region.minY + 1) * scaleY
      );
      drawRegionLabelAndGlow(
        ctx,
        region,
        wx + region.centroidX * scaleX,
        wy + region.centroidY * scaleY,
        worldMinDim,
        region.maxRadius * radiusScale,
        activeColorId,
        hintRegionId,
        displayNumberMap,
        drawLabelsNow,
        highlightMatching,
        drawGlowCircle,
        hr,
        hg,
        hb,
        ar,
        ag,
        ab,
        hintIntensity,
        pulseAlpha,
        animateHint,
        effScale,
        effMinArtwork,
        effMaxArtwork,
        normalTextColor,
        activeTextColor,
        hintTextColor,
        visLeft,
        visTop,
        visRight,
        visBottom,
        isEffectivePreview
      );
    }
  }
}
