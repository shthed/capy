import {
  Difficulty,
  HintFillStyle,
  NestedPuzzleLayer,
  NormalizedRect,
  PaletteColor,
  PuzzleData,
  Region,
  RegionColorMode,
  RegionHighlightStyle,
} from '../types';
import { isValidNormalizedRect, WORLD_BOUNDS_EPSILON } from '../engine/UnifiedPuzzleLayers';

export const BASE_MAX_ZOOM_SCALE = 12;
export const MAX_INFINITE_ZOOM_SCALE = 256;
export const ZOOM_DETENT_STOPS = [1, 2, 4, 8, 12] as const;
export const ALL_ZOOM_DETENT_STOPS = [1, 2, 4, 8, 12, 24, 48, 96, 192, 256] as const;
const ZOOM_SNAP_TOLERANCE = 0.04;

export const MAX_LIVE_LAYER_CACHES = 12;
export const MIN_LAYER_RENDER_SCREEN_PX = 6;
export const PARENT_SMOOTH_TEXEL_THRESHOLD = 1.25;
export const LAYER_SILHOUETTE_MIN_SCREEN_PX = 24;
export const LAYER_SILHOUETTE_LINE_WIDTH_PX = 1.15;
export const LAYER_SILHOUETTE_STROKE_STYLE = 'rgba(51, 65, 85, 0.52)';

export interface CanvasRegionGridLike {
  width: number;
  height: number;
  regionMap: Int32Array;
}

export interface CanvasBorderGridLike extends CanvasRegionGridLike {
  borderMap: Uint8Array;
}

export type LayerImageSource = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

export type LayerImageMapLike =
  | ReadonlyMap<string, HTMLImageElement>
  | Readonly<Record<string, HTMLImageElement | null | undefined>>;

export interface LayerCanvasCache {
  layerId: string;
  layerRef: NestedPuzzleLayer;
  width: number;
  height: number;
  regionById: Map<number, Region>;
  baseCanvas: HTMLCanvasElement;
  baseImageData: ImageData;
  borderCanvas: HTMLCanvasElement | null;
  highlightCanvas: HTMLCanvasElement | null;
  highlightImageData: ImageData | null;
  hasHighlightPixels: boolean;
  highlightVersion: number;
  selectionCanvas: HTMLCanvasElement | null;
  selectionImageData: ImageData | null;
  hasSelectionPixels: boolean;
  selectionVersion: number;
  sourceImage: HTMLImageElement | null;
  sourcePixels: Uint8ClampedArray | null;
  maskedPreviewCanvas: HTMLCanvasElement | null;
  lastMaskedPreviewImage: HTMLImageElement | null;
  lastMode: RegionColorMode | null;
  lastFreeColor: boolean;
  lastImageLoaded: boolean;
  dirtyMinX: number;
  dirtyMinY: number;
  dirtyMaxX: number;
  dirtyMaxY: number;
  lastAccessedFrame: number;
  silhouetteSegments: Float32Array | null;
  silhouettePath: Path2D | null;
  silhouetteComputed: boolean;
  silhouetteWorldX: number;
  silhouetteWorldY: number;
  silhouetteWorldW: number;
  silhouetteWorldH: number;
  lastFilledSetRef: ReadonlySet<number> | null;
  lastFilledSetSize: number;
  hasUnfilledRegions: boolean;
}

export interface UnifiedHitResult {
  regionId: number;
  layerId: string | null;
  depth: number;
}

export interface ResolveUnifiedNearTapParams {
  puzzle: PuzzleData;
  sortedDescLayers: readonly NestedPuzzleLayer[];
  regionById: ReadonlyMap<number, Region>;
  filledRegionIds: ReadonlySet<number>;
  canvasX: number;
  canvasY: number;
  activeColorId: number;
  difficulty: Difficulty;
  fatFingerAssist: boolean;
  touchReachRadiusPx: number;
  totalScreenScale: number;
  isFreeColorMode?: boolean;
  hitOut?: UnifiedHitResult;
}

export interface ResolveAnyUnifiedRegionAtPointParams {
  puzzle: PuzzleData;
  sortedDescLayers: readonly NestedPuzzleLayer[];
  canvasX: number;
  canvasY: number;
  fatFingerAssist: boolean;
  touchReachRadiusPx: number;
  totalScreenScale: number;
  hitOut?: UnifiedHitResult;
}

export interface ResolveAnyRegionAtPointParams {
  width: number;
  height: number;
  regionMap: Int32Array;
  canvasX: number;
  canvasY: number;
  fatFingerAssist: boolean;
  touchReachRadiusPx: number;
  totalScreenScale: number;
}

export interface DrawPuzzleLayersParams {
  puzzle: PuzzleData;
  sourceImage: HTMLImageElement | null;
  hasTransparentMask: boolean;
  isEffectivePreview: boolean;
  showPreviewBorders: boolean;
  isFreeColorMode: boolean;
  isRegionSelectionMode: boolean;
  hasHighlightPixels: boolean;
  hasSelectionPixels: boolean;
  highlightStyle: string;
  animateHint: boolean;
  reducedMotion: boolean;
  hintIntensity: number;
  currentPulseAlpha: number;
  baseCanvas: HTMLCanvasElement | null;
  borderCanvas: HTMLCanvasElement | null;
  highlightCanvas: HTMLCanvasElement | null;
  maskedPreviewCanvas: HTMLCanvasElement | null;
  selectionCanvas: HTMLCanvasElement | null;
  imageSmoothingEnabled?: boolean;
  imageSmoothingQuality?: ImageSmoothingQuality;
}

const INTERNAL_HIT_SCRATCH: UnifiedHitResult = { regionId: 0, layerId: null, depth: 0 };

interface NearTapScanWinner {
  bestActiveId: number;
  bestActiveLayerId: string | null;
  bestActiveDepth: number;
  bestActiveDistSq: number;
  bestAnyId: number;
  bestAnyLayerId: string | null;
  bestAnyDepth: number;
  bestAnyDistSq: number;
}

const NEAR_TAP_WINNER_SCRATCH: NearTapScanWinner = {
  bestActiveId: 0,
  bestActiveLayerId: null,
  bestActiveDepth: 0,
  bestActiveDistSq: Infinity,
  bestAnyId: 0,
  bestAnyLayerId: null,
  bestAnyDepth: 0,
  bestAnyDistSq: Infinity,
};

interface AnyRegionScanWinner {
  bestId: number;
  bestLayerId: string | null;
  bestDepth: number;
  bestDistSq: number;
}

const ANY_REGION_WINNER_SCRATCH: AnyRegionScanWinner = {
  bestId: 0,
  bestLayerId: null,
  bestDepth: 0,
  bestDistSq: Infinity,
};

/**
 * Computes the dynamic maximum zoom scale for a puzzle zoom depth:
 * Math.min(256, 12 * 2^depth), clamped cleanly for invalid/negative inputs.
 */
export function computeMaxZoomScale(maxZoomDepth?: number): number {
  const depth =
    typeof maxZoomDepth === 'number' && Number.isFinite(maxZoomDepth) && maxZoomDepth > 0
      ? Math.min(32, Math.floor(maxZoomDepth))
      : 0;
  return Math.min(MAX_INFINITE_ZOOM_SCALE, BASE_MAX_ZOOM_SCALE * Math.pow(2, depth));
}

/**
 * Resolves the effective maximum zoom scale for a puzzle by taking the maximum
 * of puzzle.maxZoomDepth, all nestedLayers[i].depth, and the zoom headroom needed
 * to inspect each nested layer's worldBounds at full BASE_MAX_ZOOM_SCALE detail.
 */
export function resolvePuzzleMaxZoomScale(puzzle: PuzzleData | null | undefined): number {
  if (!puzzle) return BASE_MAX_ZOOM_SCALE;
  let maxDepth =
    typeof puzzle.maxZoomDepth === 'number' &&
    Number.isFinite(puzzle.maxZoomDepth) &&
    puzzle.maxZoomDepth > 0
      ? Math.floor(puzzle.maxZoomDepth)
      : 0;
  let boundsNeededMax = BASE_MAX_ZOOM_SCALE;
  const layers = puzzle.nestedLayers;
  if (Array.isArray(layers)) {
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      const d = layer?.depth;
      if (typeof d === 'number' && Number.isFinite(d) && d > maxDepth) {
        maxDepth = Math.floor(d);
      }
      const wb = layer?.worldBounds;
      if (
        wb &&
        Number.isFinite(wb.width) &&
        Number.isFinite(wb.height) &&
        wb.width > 0 &&
        wb.height > 0
      ) {
        const dominantSpan = Math.max(wb.width, wb.height);
        if (dominantSpan < 1) {
          const needed = Math.ceil(BASE_MAX_ZOOM_SCALE / Math.max(1e-4, dominantSpan));
          if (needed > boundsNeededMax) {
            boundsNeededMax = needed;
          }
        }
      }
    }
  }
  return Math.min(MAX_INFINITE_ZOOM_SCALE, Math.max(computeMaxZoomScale(maxDepth), boundsNeededMax));
}

/**
 * Snaps relative zoom scale to the nearest magnetic stop up to maxScale
 * whenever snapEnabled is true and rawScale falls within +-4% of a stop.
 */
export function applyZoomSnapDetent(
  rawScale: number,
  snapEnabled: boolean,
  maxScale: number = BASE_MAX_ZOOM_SCALE
): number {
  if (!snapEnabled || !Number.isFinite(rawScale)) return rawScale;
  const effectiveMax =
    Number.isFinite(maxScale) && maxScale > 0
      ? Math.min(MAX_INFINITE_ZOOM_SCALE, maxScale)
      : BASE_MAX_ZOOM_SCALE;
  for (let i = 0; i < ALL_ZOOM_DETENT_STOPS.length; i++) {
    const stop = ALL_ZOOM_DETENT_STOPS[i];
    if (stop > effectiveMax + 1e-6) break;
    if (Math.abs(rawScale - stop) <= stop * ZOOM_SNAP_TOLERANCE + 1e-12) {
      return stop;
    }
  }
  return rawScale;
}

/**
 * Returns the next discrete relative zoom stop up to maxScale,
 * wrapping back to 1x once at or past maxScale.
 */
export function getNextZoomStop(
  currentScale: number,
  maxScale: number = BASE_MAX_ZOOM_SCALE
): number {
  const effectiveMax =
    Number.isFinite(maxScale) && maxScale > 0
      ? Math.min(MAX_INFINITE_ZOOM_SCALE, maxScale)
      : BASE_MAX_ZOOM_SCALE;
  for (let i = 0; i < ALL_ZOOM_DETENT_STOPS.length; i++) {
    const stop = ALL_ZOOM_DETENT_STOPS[i];
    if (stop > effectiveMax + 1e-6) break;
    if (stop > currentScale * (1 + ZOOM_SNAP_TOLERANCE)) {
      return stop;
    }
  }
  return ALL_ZOOM_DETENT_STOPS[0];
}

/**
 * Returns true when img is a decoded image, canvas, or ImageBitmap with non-zero dimensions.
 */
export function isReadyCanvasImageSource(img: unknown): img is LayerImageSource {
  if (!img || typeof img !== 'object') return false;
  const candidate = img as {
    complete?: boolean;
    naturalWidth?: number;
    naturalHeight?: number;
    width?: number;
    height?: number;
  };
  if (typeof candidate.complete === 'boolean') {
    if (!candidate.complete) return false;
    if (typeof candidate.naturalWidth === 'number' && typeof candidate.naturalHeight === 'number') {
      return candidate.naturalWidth > 0 && candidate.naturalHeight > 0;
    }
  }
  return (
    typeof candidate.width === 'number' &&
    typeof candidate.height === 'number' &&
    candidate.width > 0 &&
    candidate.height > 0
  );
}

/**
 * Looks up a ready HTMLImageElement for a nested layer from an external Map or Record prop.
 */
export function lookupLayerImageFromMap(
  layerImages: LayerImageMapLike | undefined,
  imageBlobKey: string,
  layerId: string
): HTMLImageElement | null {
  if (!layerImages) return null;
  if (layerImages instanceof Map) {
    const byKey = imageBlobKey ? layerImages.get(imageBlobKey) : undefined;
    if (isReadyCanvasImageSource(byKey)) return byKey as HTMLImageElement;
    const byId = layerId ? layerImages.get(layerId) : undefined;
    if (isReadyCanvasImageSource(byId)) return byId as HTMLImageElement;
    return null;
  }
  const rec = layerImages as Readonly<Record<string, HTMLImageElement | null | undefined>>;
  if (imageBlobKey && Object.prototype.hasOwnProperty.call(rec, imageBlobKey)) {
    const byKey = rec[imageBlobKey];
    if (isReadyCanvasImageSource(byKey)) return byKey as HTMLImageElement;
  }
  if (layerId && Object.prototype.hasOwnProperty.call(rec, layerId)) {
    const byId = rec[layerId];
    if (isReadyCanvasImageSource(byId)) return byId as HTMLImageElement;
  }
  return null;
}

function isValidGridDimensions(width: number, height: number): boolean {
  return Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0;
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function axisCellDistance(coord: number, cellIdx: number): number {
  if (coord < cellIdx) return cellIdx - coord;
  const cellEnd = cellIdx + 1;
  return coord > cellEnd ? coord - cellEnd : 0;
}

/**
 * Draws an image source into a temporary canvas to extract its RGBA pixel buffer,
 * releasing the temporary backing store deterministically in finally.
 */
export function extractImagePixelsRgba(
  img: LayerImageSource,
  width: number,
  height: number
): Uint8ClampedArray | null {
  if (
    !isReadyCanvasImageSource(img) ||
    !isValidGridDimensions(width, height) ||
    typeof document === 'undefined'
  ) {
    return null;
  }
  const tmpCanvas = document.createElement('canvas');
  try {
    tmpCanvas.width = width;
    tmpCanvas.height = height;
    const tmpCtx =
      tmpCanvas.getContext('2d', { willReadFrequently: true }) || tmpCanvas.getContext('2d');
    if (!tmpCtx || typeof tmpCtx.getImageData !== 'function') return null;
    tmpCtx.drawImage(img, 0, 0, width, height);
    return tmpCtx.getImageData(0, 0, width, height).data;
  } finally {
    tmpCanvas.width = 0;
    tmpCanvas.height = 0;
  }
}

/**
 * Builds the slate 1px region border overlay canvas strictly inside valid regions (regionMap[i] > 0).
 */
export function buildPreviewBorderCanvas(
  targetCanvas: HTMLCanvasElement,
  grid: CanvasBorderGridLike
): boolean {
  const { width, height, borderMap, regionMap } = grid;
  if (!isValidGridDimensions(width, height)) return false;
  const total = width * height;
  if (!borderMap || !regionMap || borderMap.length < total || regionMap.length < total) {
    return false;
  }
  targetCanvas.width = width;
  targetCanvas.height = height;
  const bCtx = targetCanvas.getContext('2d');
  if (!bCtx) return false;
  const imgData = bCtx.createImageData(width, height);
  const data = imgData.data;

  for (let i = 0; i < total; i++) {
    if (borderMap[i] === 1 && regionMap[i] > 0) {
      const idx = i * 4;
      data[idx] = 51;
      data[idx + 1] = 65;
      data[idx + 2] = 85;
      data[idx + 3] = 255;
    }
  }
  bCtx.putImageData(imgData, 0, 0);
  return true;
}

/**
 * Computes highlight overlay alpha identically for root and nested layer compositing.
 */
export function computeHighlightOverlayAlpha(
  animateHint: boolean,
  reducedMotion: boolean,
  hintIntensity: number,
  currentPulseAlpha: number
): number {
  const effectiveAnimateHint = Boolean(animateHint && !reducedMotion);
  return effectiveAnimateHint
    ? Math.min(1, Math.max(0.05, currentPulseAlpha * hintIntensity))
    : Math.min(
        1,
        Math.max(0.05, reducedMotion ? Math.max(0.88, hintIntensity) : hintIntensity * 0.78)
      );
}

/**
 * Renders active-color and hinted-region highlights into a zeroed RGBA ImageData buffer
 * for either the root puzzle or any nested detail layer.
 */
export function renderHighlightLayerToImageData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  borderMap: Uint8Array,
  regions: readonly Region[],
  filledRegionIds: ReadonlySet<number>,
  activeColorId: number,
  hintRegionId: number | null,
  highlightMatching: boolean,
  highlightStyle: RegionHighlightStyle,
  hintFillStyle: HintFillStyle,
  hintColorArgb: number,
  activePalRgb: Pick<PaletteColor, 'r' | 'g' | 'b'> | undefined
): boolean {
  if (!isValidGridDimensions(width, height)) return false;
  const total = width * height;
  if (data.length < total * 4) return false;

  const hr = (hintColorArgb >> 16) & 0xff;
  const hg = (hintColorArgb >> 8) & 0xff;
  const hb = hintColorArgb & 0xff;
  const ar = activePalRgb ? activePalRgb.r : hr;
  const ag = activePalRgb ? activePalRgb.g : hg;
  const ab = activePalRgb ? activePalRgb.b : hb;

  const isBoundaryOnly = highlightStyle === 'BOUNDARY_ONLY';
  let anyPixel = false;

  for (let rIdx = 0; rIdx < regions.length; rIdx++) {
    const reg = regions[rIdx];
    if (filledRegionIds.has(reg.id)) continue;
    const isHinted = reg.id === hintRegionId;
    const isActive = reg.colorId === activeColorId;
    if (!isHinted && (!highlightMatching || !isActive)) continue;

    const fillR = isHinted ? hr : ar;
    const fillG = isHinted ? hg : ag;
    const fillB = isHinted ? hb : ab;
    const pixels = reg.pixels;

    for (let i = 0; i < pixels.length; i++) {
      const idx = pixels[i];
      if (idx < 0 || idx >= total) continue;
      if (isBoundaryOnly && borderMap[idx] !== 1) continue;

      let shouldFill = true;
      if (!isBoundaryOnly && hintFillStyle !== 'SOLID') {
        const px = idx % width;
        const py = (idx - px) / width;
        shouldFill =
          hintFillStyle === 'CHECKER'
            ? ((px >> 2) + (py >> 2)) % 2 === 0
            : ((px + py) >> 2) % 2 === 0;
      }

      if (shouldFill) {
        const pIdx = idx * 4;
        data[pIdx] = fillR;
        data[pIdx + 1] = fillG;
        data[pIdx + 2] = fillB;
        data[pIdx + 3] = 255;
        anyPixel = true;
      }
    }
  }

  return anyPixel;
}

/**
 * Releases all offscreen GPU canvas backing buffers held by a LayerCanvasCache.
 */
export function disposeLayerCanvasCache(cache: LayerCanvasCache): void {
  cache.baseCanvas.width = 0;
  cache.baseCanvas.height = 0;
  if (cache.borderCanvas) {
    cache.borderCanvas.width = 0;
    cache.borderCanvas.height = 0;
    cache.borderCanvas = null;
  }
  if (cache.highlightCanvas) {
    cache.highlightCanvas.width = 0;
    cache.highlightCanvas.height = 0;
    cache.highlightCanvas = null;
  }
  cache.highlightImageData = null;
  cache.hasHighlightPixels = false;
  if (cache.selectionCanvas) {
    cache.selectionCanvas.width = 0;
    cache.selectionCanvas.height = 0;
    cache.selectionCanvas = null;
  }
  cache.selectionImageData = null;
  cache.hasSelectionPixels = false;
  if (cache.maskedPreviewCanvas) {
    cache.maskedPreviewCanvas.width = 0;
    cache.maskedPreviewCanvas.height = 0;
    cache.maskedPreviewCanvas = null;
  }
  cache.sourceImage = null;
  cache.sourcePixels = null;
  cache.lastMaskedPreviewImage = null;
  cache.silhouetteSegments = null;
  cache.silhouettePath = null;
  cache.silhouetteComputed = false;
  cache.silhouetteWorldX = NaN;
  cache.silhouetteWorldY = NaN;
  cache.silhouetteWorldW = NaN;
  cache.silhouetteWorldH = NaN;
  cache.lastFilledSetRef = null;
  cache.lastFilledSetSize = -1;
  cache.hasUnfilledRegions = false;
}

/**
 * Evicts least-recently-used layer caches until caches.size <= maxLive,
 * preferring entries not accessed during currentFrame to avoid intra-frame thrashing.
 */
export function evictLruLayerCaches(
  caches: Map<string, LayerCanvasCache>,
  maxLive: number,
  currentFrame: number
): number {
  const safeMax = Number.isFinite(maxLive) && maxLive >= 0 ? Math.floor(maxLive) : 0;
  let evicted = 0;
  while (caches.size > safeMax) {
    let oldestPriorKey: string | null = null;
    let oldestPriorFrame = Infinity;
    let oldestAnyKey: string | null = null;
    let oldestAnyFrame = Infinity;

    for (const [key, entry] of caches) {
      if (entry.lastAccessedFrame < currentFrame && entry.lastAccessedFrame < oldestPriorFrame) {
        oldestPriorFrame = entry.lastAccessedFrame;
        oldestPriorKey = key;
      }
      if (entry.lastAccessedFrame < oldestAnyFrame) {
        oldestAnyFrame = entry.lastAccessedFrame;
        oldestAnyKey = key;
      }
    }

    const victimKey =
      oldestPriorKey !== null
        ? oldestPriorKey
        : caches.size > Math.max(1, safeMax * 2)
          ? oldestAnyKey
          : null;
    if (victimKey === null) break;

    const victim = caches.get(victimKey);
    if (victim) {
      disposeLayerCanvasCache(victim);
    }
    caches.delete(victimKey);
    evicted++;
  }
  return evicted;
}

/**
 * Returns true iff a nested layer has valid bounds, intersects the current world viewport,
 * and projects to at least minScreenPx x minScreenPx on screen.
 */
export function isLayerVisibleAndLargeEnough(
  puzzleWidth: number,
  puzzleHeight: number,
  layer: NestedPuzzleLayer,
  visLeft: number,
  visTop: number,
  visRight: number,
  visBottom: number,
  effScale: number,
  minScreenPx: number = MIN_LAYER_RENDER_SCREEN_PX
): boolean {
  if (
    !layer ||
    !isValidGridDimensions(layer.width, layer.height) ||
    !isPositiveFinite(puzzleWidth) ||
    !isPositiveFinite(puzzleHeight) ||
    !isPositiveFinite(effScale) ||
    !Number.isFinite(visLeft) ||
    !Number.isFinite(visTop) ||
    !Number.isFinite(visRight) ||
    !Number.isFinite(visBottom) ||
    !isValidNormalizedRect(layer.worldBounds)
  ) {
    return false;
  }
  const b = layer.worldBounds;
  const wx = b.x * puzzleWidth;
  const wy = b.y * puzzleHeight;
  const ww = b.width * puzzleWidth;
  const wh = b.height * puzzleHeight;
  if (wx + ww < visLeft || wx > visRight || wy + wh < visTop || wy > visBottom) {
    return false;
  }
  return ww * effScale >= minScreenPx && wh * effScale >= minScreenPx;
}

/**
 * Returns true iff the regionMap contains both opaque interior pixels (rId > 0)
 * and transparent cutout exterior pixels (rId <= 0).
 */
export function hasTransparentExterior(regionMap: Int32Array): boolean {
  let hasInterior = false;
  let hasExterior = false;
  for (let i = 0; i < regionMap.length; i++) {
    if (regionMap[i] > 0) {
      hasInterior = true;
    } else {
      hasExterior = true;
    }
    if (hasInterior && hasExterior) return true;
  }
  return false;
}

/**
 * Draws the source artwork into targetCanvas and masks all rId <= 0 exterior pixels
 * to transparent RGBA [0, 0, 0, 0] for organic cutout Preview and Free Colour multiply.
 */
export function buildMaskedPreviewCanvas(
  targetCanvas: HTMLCanvasElement,
  sourceImage: LayerImageSource,
  puzzle: CanvasRegionGridLike
): boolean {
  const { width, height, regionMap } = puzzle;
  if (!isValidGridDimensions(width, height) || !regionMap || regionMap.length < width * height) {
    return false;
  }
  targetCanvas.width = width;
  targetCanvas.height = height;
  const ctx =
    targetCanvas.getContext('2d', { willReadFrequently: true }) || targetCanvas.getContext('2d');
  if (!ctx || typeof ctx.getImageData !== 'function') return false;

  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(sourceImage, 0, 0, width, height);
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  const total = width * height;
  for (let i = 0; i < total; i++) {
    if (regionMap[i] <= 0) {
      const idx = i * 4;
      data[idx] = 0;
      data[idx + 1] = 0;
      data[idx + 2] = 0;
      data[idx + 3] = 0;
    }
  }
  ctx.putImageData(imgData, 0, 0);
  return true;
}

function isOuterSelectionRimPixel(
  px: number,
  py: number,
  width: number,
  height: number,
  regionMap: Int32Array,
  selectedRegionIds: ReadonlySet<number>
): boolean {
  if (px <= 1 || py <= 1 || px >= width - 2 || py >= height - 2) {
    if (px === 0 || py === 0 || px === width - 1 || py === height - 1) return true;
  }
  const rowOffset = py * width;
  if (px > 0 && !selectedRegionIds.has(regionMap[rowOffset + px - 1])) return true;
  if (px + 1 < width && !selectedRegionIds.has(regionMap[rowOffset + px + 1])) return true;
  if (py > 0 && !selectedRegionIds.has(regionMap[rowOffset - width + px])) return true;
  if (py + 1 < height && !selectedRegionIds.has(regionMap[rowOffset + width + px])) return true;
  if (px > 1 && !selectedRegionIds.has(regionMap[rowOffset + px - 2])) return true;
  if (px + 2 < width && !selectedRegionIds.has(regionMap[rowOffset + px + 2])) return true;
  if (py > 1 && !selectedRegionIds.has(regionMap[rowOffset - width * 2 + px])) return true;
  if (py + 2 < height && !selectedRegionIds.has(regionMap[rowOffset + width * 2 + px])) return true;
  return false;
}

/**
 * Renders a translucent cyan selection tint with a crisp 2px silhouette rim
 * strictly over selected regions into a reused RGBA ImageData buffer.
 */
export function renderSelectionOverlayToImageData(
  data: Uint8ClampedArray,
  puzzle: CanvasRegionGridLike,
  selectedRegionIds: ReadonlySet<number>,
  regionById: ReadonlyMap<number, Region>
): boolean {
  const { width, height, regionMap } = puzzle;
  if (!isValidGridDimensions(width, height)) return false;
  const total = width * height;
  if (!regionMap || regionMap.length < total || data.length < total * 4) {
    return false;
  }
  let anyPixel = false;

  for (const rId of selectedRegionIds) {
    const reg = regionById.get(rId);
    if (!reg) continue;
    const pixels = reg.pixels;
    for (let i = 0; i < pixels.length; i++) {
      const pIdx = pixels[i];
      if (pIdx < 0 || pIdx >= total) continue;
      if (!(regionMap[pIdx] > 0)) continue;
      const px = pIdx % width;
      const py = (pIdx - px) / width;
      const outIdx = pIdx * 4;
      const isRim = isOuterSelectionRimPixel(px, py, width, height, regionMap, selectedRegionIds);
      if (isRim) {
        data[outIdx] = 56;
        data[outIdx + 1] = 189;
        data[outIdx + 2] = 248;
        data[outIdx + 3] = 250;
      } else {
        data[outIdx] = 56;
        data[outIdx + 1] = 189;
        data[outIdx + 2] = 248;
        data[outIdx + 3] = 92;
      }
      anyPixel = true;
    }
  }

  return anyPixel;
}

function isUsableNestedLayerGrid(layer: NestedPuzzleLayer | null | undefined): layer is NestedPuzzleLayer {
  if (!layer || !isValidGridDimensions(layer.width, layer.height) || !layer.regionMap) return false;
  if (layer.regionMap.length < layer.width * layer.height) return false;
  return isValidNormalizedRect(layer.worldBounds);
}

function sampleSingleNestedLayer(
  layer: NestedPuzzleLayer,
  u: number,
  v: number,
  out: UnifiedHitResult
): boolean {
  if (!isUsableNestedLayerGrid(layer)) return false;
  const b = layer.worldBounds;
  if (u < b.x || u >= b.x + b.width || v < b.y || v >= b.y + b.height) return false;
  let lx = Math.floor(((u - b.x) / b.width) * layer.width);
  if (lx < 0) lx = 0;
  else if (lx >= layer.width) lx = layer.width - 1;
  let ly = Math.floor(((v - b.y) / b.height) * layer.height);
  if (ly < 0) ly = 0;
  else if (ly >= layer.height) ly = layer.height - 1;

  const rId = layer.regionMap[ly * layer.width + lx];
  if (!(rId > 0)) return false;
  out.regionId = rId;
  out.layerId = layer.layerId;
  out.depth = Number.isFinite(layer.depth) ? layer.depth : 1;
  return true;
}

function isValidWorldTapCoords(
  puzzle: PuzzleData | null | undefined,
  canvasX: number,
  canvasY: number
): boolean {
  return Boolean(
    puzzle &&
      Number.isFinite(canvasX) &&
      Number.isFinite(canvasY) &&
      isValidGridDimensions(puzzle.width, puzzle.height)
  );
}

/**
 * Zero-allocation deepest-first exact region sampler across nestedLayers (descending depth)
 * falling through organic rId <= 0 holes down to the root puzzle grid.
 */
export function sampleUnifiedRegionAtWorldPoint(
  puzzle: PuzzleData,
  canvasX: number,
  canvasY: number,
  sortedDescLayers: readonly NestedPuzzleLayer[] | null | undefined,
  out: UnifiedHitResult
): boolean {
  out.regionId = 0;
  out.layerId = null;
  out.depth = 0;

  if (!isValidWorldTapCoords(puzzle, canvasX, canvasY)) return false;

  const u = canvasX / puzzle.width;
  const v = canvasY / puzzle.height;
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return false;

  if (sortedDescLayers && sortedDescLayers.length > 0) {
    for (let i = 0; i < sortedDescLayers.length; i++) {
      if (sampleSingleNestedLayer(sortedDescLayers[i], u, v, out)) {
        return true;
      }
    }
  }

  if (puzzle.regionMap && puzzle.regionMap.length >= puzzle.width * puzzle.height) {
    const rx = Math.floor(canvasX);
    const ry = Math.floor(canvasY);
    if (rx >= 0 && rx < puzzle.width && ry >= 0 && ry < puzzle.height) {
      const rId = puzzle.regionMap[ry * puzzle.width + rx];
      if (rId > 0) {
        out.regionId = rId;
        out.layerId = null;
        out.depth = 0;
        return true;
      }
    }
  }

  return false;
}

function considerNearTapCandidate(
  candId: number,
  distScreenSq: number,
  layerId: string | null,
  layerDepth: number,
  regionById: ReadonlyMap<number, Region>,
  filledRegionIds: ReadonlySet<number>,
  activeColorId: number,
  allowAnyColor: boolean,
  winner: NearTapScanWinner
): void {
  if (!(candId > 0) || filledRegionIds.has(candId)) return;
  const reg = regionById.get(candId);
  if (!reg) return;
  if (reg.colorId === activeColorId) {
    if (distScreenSq < winner.bestActiveDistSq) {
      winner.bestActiveDistSq = distScreenSq;
      winner.bestActiveId = candId;
      winner.bestActiveLayerId = layerId;
      winner.bestActiveDepth = layerDepth;
    }
  } else if (allowAnyColor && distScreenSq < winner.bestAnyDistSq) {
    winner.bestAnyDistSq = distScreenSq;
    winner.bestAnyId = candId;
    winner.bestAnyLayerId = layerId;
    winner.bestAnyDepth = layerDepth;
  }
}

function scanNestedLayerForNearTap(
  puzzleWidth: number,
  puzzleHeight: number,
  layer: NestedPuzzleLayer,
  canvasX: number,
  canvasY: number,
  touchReachRadiusPx: number,
  totalScreenScale: number,
  maxScreenDistSq: number,
  regionById: ReadonlyMap<number, Region>,
  filledRegionIds: ReadonlySet<number>,
  activeColorId: number,
  allowAnyColor: boolean,
  winner: NearTapScanWinner
): void {
  if (!isUsableNestedLayerGrid(layer)) return;
  const b = layer.worldBounds;
  const originX = b.x * puzzleWidth;
  const originY = b.y * puzzleHeight;
  const worldW = b.width * puzzleWidth;
  const worldH = b.height * puzzleHeight;

  const clampedWX = Math.max(originX, Math.min(originX + worldW, canvasX));
  const clampedWY = Math.max(originY, Math.min(originY + worldH, canvasY));
  const boxDxScr = (canvasX - clampedWX) * totalScreenScale;
  const boxDyScr = (canvasY - clampedWY) * totalScreenScale;
  if (boxDxScr * boxDxScr + boxDyScr * boxDyScr > maxScreenDistSq + WORLD_BOUNDS_EPSILON) return;

  const scaleX = worldW / layer.width;
  const scaleY = worldH / layer.height;
  const layerScreenScaleX = scaleX * totalScreenScale;
  const layerScreenScaleY = scaleY * totalScreenScale;
  if (!(layerScreenScaleX > 0) || !(layerScreenScaleY > 0)) return;

  const tapLX = (canvasX - originX) / scaleX;
  const tapLY = (canvasY - originY) / scaleY;
  const maxLayerRXFloat = Math.min(64, touchReachRadiusPx / layerScreenScaleX);
  const maxLayerRYFloat = Math.min(64, touchReachRadiusPx / layerScreenScaleY);
  const minLX = Math.max(0, Math.floor(tapLX - maxLayerRXFloat - 1e-6));
  const maxLX = Math.min(layer.width - 1, Math.ceil(tapLX + maxLayerRXFloat));
  const minLY = Math.max(0, Math.floor(tapLY - maxLayerRYFloat - 1e-6));
  const maxLY = Math.min(layer.height - 1, Math.ceil(tapLY + maxLayerRYFloat));
  if (minLX > maxLX || minLY > maxLY) return;

  const layerDepth = Number.isFinite(layer.depth) ? layer.depth : 1;
  const layerMap = layer.regionMap;
  const lw = layer.width;

  for (let ly = minLY; ly <= maxLY; ly++) {
    const dpxY = axisCellDistance(tapLY, ly);
    const dyScr = dpxY * layerScreenScaleY;
    const dyScrSq = dyScr * dyScr;
    if (dyScrSq > maxScreenDistSq) continue;
    const dpxYSq = dpxY * dpxY;
    const rowOff = ly * lw;

    for (let lx = minLX; lx <= maxLX; lx++) {
      const dpxX = axisCellDistance(tapLX, lx);
      if (dpxX * dpxX + dpxYSq > 4096) continue;
      const dxScr = dpxX * layerScreenScaleX;
      const distScreenSq = dxScr * dxScr + dyScrSq;
      if (distScreenSq > maxScreenDistSq) continue;

      considerNearTapCandidate(
        layerMap[rowOff + lx],
        distScreenSq,
        layer.layerId,
        layerDepth,
        regionById,
        filledRegionIds,
        activeColorId,
        allowAnyColor,
        winner
      );
    }
  }
}

function scanRootLayerForNearTap(
  puzzle: PuzzleData,
  canvasX: number,
  canvasY: number,
  touchReachRadiusPx: number,
  totalScreenScale: number,
  maxScreenDistSq: number,
  regionById: ReadonlyMap<number, Region>,
  filledRegionIds: ReadonlySet<number>,
  activeColorId: number,
  allowAnyColor: boolean,
  winner: NearTapScanWinner
): void {
  const { width, height, regionMap } = puzzle;
  if (!isValidGridDimensions(width, height) || !regionMap || regionMap.length < width * height) {
    return;
  }

  const rawRootR = touchReachRadiusPx / totalScreenScale;
  const maxRootRFloat = rawRootR > 64 ? 64 : rawRootR;
  const maxRootRSq = maxRootRFloat * maxRootRFloat;
  const minRX = Math.max(0, Math.floor(canvasX - maxRootRFloat - 1e-6));
  const maxRX = Math.min(width - 1, Math.ceil(canvasX + maxRootRFloat));
  const minRY = Math.max(0, Math.floor(canvasY - maxRootRFloat - 1e-6));
  const maxRY = Math.min(height - 1, Math.ceil(canvasY + maxRootRFloat));
  const scaleSq = totalScreenScale * totalScreenScale;

  for (let ry = minRY; ry <= maxRY; ry++) {
    const dwy = axisCellDistance(canvasY, ry);
    const dwySq = dwy * dwy;
    if (dwySq > maxRootRSq) continue;
    const rowOff = ry * width;
    for (let rx = minRX; rx <= maxRX; rx++) {
      const dwx = axisCellDistance(canvasX, rx);
      const worldDistSq = dwx * dwx + dwySq;
      if (worldDistSq > maxRootRSq) continue;
      const distScreenSq = worldDistSq * scaleSq;
      if (distScreenSq > maxScreenDistSq) continue;

      considerNearTapCandidate(
        regionMap[rowOff + rx],
        distScreenSq,
        null,
        0,
        regionById,
        filledRegionIds,
        activeColorId,
        allowAnyColor,
        winner
      );
    }
  }
}

function resetHitResult(hitOut: UnifiedHitResult | undefined): void {
  if (!hitOut) return;
  hitOut.regionId = 0;
  hitOut.layerId = null;
  hitOut.depth = 0;
}

function resetNearTapWinner(winner: NearTapScanWinner): void {
  winner.bestActiveId = 0;
  winner.bestActiveLayerId = null;
  winner.bestActiveDepth = 0;
  winner.bestActiveDistSq = Infinity;
  winner.bestAnyId = 0;
  winner.bestAnyLayerId = null;
  winner.bestAnyDepth = 0;
  winner.bestAnyDistSq = Infinity;
}

function isExactTapHitPlayable(
  exactId: number,
  isFreeColorMode: boolean,
  difficulty: Difficulty,
  activeColorId: number,
  filledRegionIds: ReadonlySet<number>,
  regionById: ReadonlyMap<number, Region>
): boolean {
  if (isFreeColorMode) return true;
  if (filledRegionIds.has(exactId)) return false;
  if (difficulty === 'EASY') return true;
  const exactReg = regionById.get(exactId);
  return Boolean(exactReg && exactReg.colorId === activeColorId);
}

/**
 * Zero-allocation unified multi-layer near-tap hit-testing:
 * 1. Deepest-first O(1) exact hit across nestedLayers -> root.
 * 2. Fat-Finger radial scan across intersecting nested layers and root compared
 *    strictly in screen-pixel squared distance (activeColorId priority over allowAnyColor,
 *    deeper nested layer wins distance ties).
 */
export function resolveUnifiedNearTapRegion(params: ResolveUnifiedNearTapParams): number {
  const {
    puzzle,
    sortedDescLayers,
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
    hitOut,
  } = params;

  resetHitResult(hitOut);
  if (!isValidWorldTapCoords(puzzle, canvasX, canvasY)) return 0;

  const exactScratch = hitOut ?? INTERNAL_HIT_SCRATCH;
  if (
    sampleUnifiedRegionAtWorldPoint(puzzle, canvasX, canvasY, sortedDescLayers, exactScratch) &&
    isExactTapHitPlayable(
      exactScratch.regionId,
      isFreeColorMode,
      difficulty,
      activeColorId,
      filledRegionIds,
      regionById
    )
  ) {
    return exactScratch.regionId;
  }

  resetHitResult(hitOut);
  if (
    !fatFingerAssist ||
    !Number.isFinite(totalScreenScale) ||
    !(totalScreenScale > 0) ||
    !Number.isFinite(touchReachRadiusPx) ||
    !(touchReachRadiusPx > 0)
  ) {
    return 0;
  }

  const allowAnyColor = difficulty === 'EASY' || isFreeColorMode;
  const maxScreenDistSq = touchReachRadiusPx * touchReachRadiusPx;
  const winner = NEAR_TAP_WINNER_SCRATCH;
  resetNearTapWinner(winner);

  for (let i = 0; i < sortedDescLayers.length; i++) {
    scanNestedLayerForNearTap(
      puzzle.width,
      puzzle.height,
      sortedDescLayers[i],
      canvasX,
      canvasY,
      touchReachRadiusPx,
      totalScreenScale,
      maxScreenDistSq,
      regionById,
      filledRegionIds,
      activeColorId,
      allowAnyColor,
      winner
    );
  }

  scanRootLayerForNearTap(
    puzzle,
    canvasX,
    canvasY,
    touchReachRadiusPx,
    totalScreenScale,
    maxScreenDistSq,
    regionById,
    filledRegionIds,
    activeColorId,
    allowAnyColor,
    winner
  );

  if (winner.bestActiveId > 0) {
    if (hitOut) {
      hitOut.regionId = winner.bestActiveId;
      hitOut.layerId = winner.bestActiveLayerId;
      hitOut.depth = winner.bestActiveDepth;
    }
    return winner.bestActiveId;
  }

  if (allowAnyColor && winner.bestAnyId > 0) {
    if (hitOut) {
      hitOut.regionId = winner.bestAnyId;
      hitOut.layerId = winner.bestAnyLayerId;
      hitOut.depth = winner.bestAnyDepth;
    }
    return winner.bestAnyId;
  }

  return 0;
}

function scanNestedLayerForAnyRegion(
  puzzleWidth: number,
  puzzleHeight: number,
  layer: NestedPuzzleLayer,
  canvasX: number,
  canvasY: number,
  touchReachRadiusPx: number,
  totalScreenScale: number,
  maxScreenDistSq: number,
  winner: AnyRegionScanWinner
): void {
  if (!isUsableNestedLayerGrid(layer)) {
    return;
  }
  const b = layer.worldBounds;
  const originX = b.x * puzzleWidth;
  const originY = b.y * puzzleHeight;
  const worldW = b.width * puzzleWidth;
  const worldH = b.height * puzzleHeight;

  const clampedWX = canvasX < originX ? originX : canvasX > originX + worldW ? originX + worldW : canvasX;
  const clampedWY = canvasY < originY ? originY : canvasY > originY + worldH ? originY + worldH : canvasY;
  const boxDxScr = (canvasX - clampedWX) * totalScreenScale;
  const boxDyScr = (canvasY - clampedWY) * totalScreenScale;
  if (boxDxScr * boxDxScr + boxDyScr * boxDyScr > maxScreenDistSq + WORLD_BOUNDS_EPSILON) return;

  const scaleX = worldW / layer.width;
  const scaleY = worldH / layer.height;
  const layerScreenScaleX = scaleX * totalScreenScale;
  const layerScreenScaleY = scaleY * totalScreenScale;
  if (!(layerScreenScaleX > 0) || !(layerScreenScaleY > 0)) return;

  const tapLX = (canvasX - originX) / scaleX;
  const tapLY = (canvasY - originY) / scaleY;
  const maxLayerRXFloat = Math.min(24, touchReachRadiusPx / layerScreenScaleX);
  const maxLayerRYFloat = Math.min(24, touchReachRadiusPx / layerScreenScaleY);
  const minLX = Math.max(0, Math.floor(tapLX - maxLayerRXFloat - 1e-6));
  const maxLX = Math.min(layer.width - 1, Math.ceil(tapLX + maxLayerRXFloat));
  const minLY = Math.max(0, Math.floor(tapLY - maxLayerRYFloat - 1e-6));
  const maxLY = Math.min(layer.height - 1, Math.ceil(tapLY + maxLayerRYFloat));
  if (minLX > maxLX || minLY > maxLY) return;

  const layerDepth = Number.isFinite(layer.depth) ? layer.depth : 1;
  const layerMap = layer.regionMap;
  const lw = layer.width;

  for (let ly = minLY; ly <= maxLY; ly++) {
    const dpxY = axisCellDistance(tapLY, ly);
    const dyScr = dpxY * layerScreenScaleY;
    const dyScrSq = dyScr * dyScr;
    if (dyScrSq > maxScreenDistSq || dyScrSq >= winner.bestDistSq) continue;
    const dpxYSq = dpxY * dpxY;
    const rowOff = ly * lw;

    for (let lx = minLX; lx <= maxLX; lx++) {
      const dpxX = axisCellDistance(tapLX, lx);
      if (dpxX * dpxX + dpxYSq > 576) continue;
      const dxScr = dpxX * layerScreenScaleX;
      const distScreenSq = dxScr * dxScr + dyScrSq;
      if (distScreenSq > maxScreenDistSq || distScreenSq >= winner.bestDistSq) continue;

      const candId = layerMap[rowOff + lx];
      if (candId > 0) {
        winner.bestDistSq = distScreenSq;
        winner.bestId = candId;
        winner.bestLayerId = layer.layerId;
        winner.bestDepth = layerDepth;
      }
    }
  }
}

function scanRootLayerForAnyRegion(
  puzzle: PuzzleData,
  canvasX: number,
  canvasY: number,
  touchReachRadiusPx: number,
  totalScreenScale: number,
  maxScreenDistSq: number,
  winner: AnyRegionScanWinner
): void {
  const { width, height, regionMap } = puzzle;
  if (!isValidGridDimensions(width, height) || !regionMap || regionMap.length < width * height) {
    return;
  }

  const rawRootR = touchReachRadiusPx / totalScreenScale;
  const maxRootRFloat = rawRootR > 24 ? 24 : rawRootR;
  const maxRootRSq = maxRootRFloat * maxRootRFloat;
  const minRX = Math.max(0, Math.floor(canvasX - maxRootRFloat - 1e-6));
  const maxRX = Math.min(width - 1, Math.ceil(canvasX + maxRootRFloat));
  const minRY = Math.max(0, Math.floor(canvasY - maxRootRFloat - 1e-6));
  const maxRY = Math.min(height - 1, Math.ceil(canvasY + maxRootRFloat));
  const scaleSq = totalScreenScale * totalScreenScale;

  for (let ry = minRY; ry <= maxRY; ry++) {
    const dwy = axisCellDistance(canvasY, ry);
    const dwySq = dwy * dwy;
    if (dwySq > maxRootRSq) continue;
    const rowOff = ry * width;
    for (let rx = minRX; rx <= maxRX; rx++) {
      const dwx = axisCellDistance(canvasX, rx);
      const worldDistSq = dwx * dwx + dwySq;
      if (worldDistSq > maxRootRSq) continue;
      const distScreenSq = worldDistSq * scaleSq;
      if (distScreenSq > maxScreenDistSq || distScreenSq >= winner.bestDistSq) continue;

      const candId = regionMap[rowOff + rx];
      if (candId > 0) {
        winner.bestDistSq = distScreenSq;
        winner.bestId = candId;
        winner.bestLayerId = null;
        winner.bestDepth = 0;
      }
    }
  }
}

/**
 * Zero-allocation deepest-first hit test resolving ANY valid region (filled or unfilled,
 * any colorId) across nested layers and root for Region Selection tap.
 */
export function resolveAnyUnifiedRegionAtPoint(params: ResolveAnyUnifiedRegionAtPointParams): number {
  const {
    puzzle,
    sortedDescLayers,
    canvasX,
    canvasY,
    fatFingerAssist,
    touchReachRadiusPx,
    totalScreenScale,
    hitOut,
  } = params;

  if (hitOut) {
    hitOut.regionId = 0;
    hitOut.layerId = null;
    hitOut.depth = 0;
  }

  if (!isValidWorldTapCoords(puzzle, canvasX, canvasY)) {
    return 0;
  }

  const exactScratch = hitOut ?? INTERNAL_HIT_SCRATCH;
  if (sampleUnifiedRegionAtWorldPoint(puzzle, canvasX, canvasY, sortedDescLayers, exactScratch)) {
    return exactScratch.regionId;
  }

  if (
    !fatFingerAssist ||
    !Number.isFinite(totalScreenScale) ||
    !(totalScreenScale > 0) ||
    !Number.isFinite(touchReachRadiusPx) ||
    !(touchReachRadiusPx > 0)
  ) {
    return 0;
  }

  const maxScreenDistSq = touchReachRadiusPx * touchReachRadiusPx;
  const winner = ANY_REGION_WINNER_SCRATCH;
  winner.bestId = 0;
  winner.bestLayerId = null;
  winner.bestDepth = 0;
  winner.bestDistSq = Infinity;

  for (let i = 0; i < sortedDescLayers.length; i++) {
    scanNestedLayerForAnyRegion(
      puzzle.width,
      puzzle.height,
      sortedDescLayers[i],
      canvasX,
      canvasY,
      touchReachRadiusPx,
      totalScreenScale,
      maxScreenDistSq,
      winner
    );
  }

  scanRootLayerForAnyRegion(
    puzzle,
    canvasX,
    canvasY,
    touchReachRadiusPx,
    totalScreenScale,
    maxScreenDistSq,
    winner
  );

  if (winner.bestId > 0 && hitOut) {
    hitOut.regionId = winner.bestId;
    hitOut.layerId = winner.bestLayerId;
    hitOut.depth = winner.bestDepth;
  }
  return winner.bestId;
}

/**
 * Zero-allocation screen-space-stepped unified line collector across nestedLayers and root.
 * Scales sampling density by effScale so deep-zoom drags (up to 256x) never skip micro-regions.
 */
export function collectUnifiedLineRegionIds(
  puzzle: PuzzleData,
  sortedDescLayers: readonly NestedPuzzleLayer[] | null | undefined,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  effScale: number,
  outSet: Set<number>,
  scratchHit?: UnifiedHitResult
): boolean {
  outSet.clear();
  if (
    !puzzle ||
    !isValidGridDimensions(puzzle.width, puzzle.height) ||
    !Number.isFinite(x1) ||
    !Number.isFinite(y1) ||
    !Number.isFinite(x2) ||
    !Number.isFinite(y2)
  ) {
    return false;
  }
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  const safeScale = Number.isFinite(effScale) && effScale > 0 ? effScale : 1;
  const screenDist = dist * safeScale;
  const steps = Math.min(2048, Math.max(1, Math.ceil(Math.max(dist * 0.8, screenDist * 0.5))));
  const hit = scratchHit ?? INTERNAL_HIT_SCRATCH;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (sampleUnifiedRegionAtWorldPoint(puzzle, x1 + dx * t, y1 + dy * t, sortedDescLayers, hit)) {
      outSet.add(hit.regionId);
    }
  }
  return outSet.size > 0;
}

/**
 * Zero-allocation hit test resolving ANY valid region (filled or unfilled, any colorId)
 * at a canvas coordinate, with small radial fallback for thin slivers when fatFingerAssist is enabled.
 */
export function resolveAnyRegionAtPoint(params: ResolveAnyRegionAtPointParams): number {
  const {
    width,
    height,
    regionMap,
    canvasX,
    canvasY,
    fatFingerAssist,
    touchReachRadiusPx,
    totalScreenScale,
  } = params;

  if (!Number.isFinite(canvasX) || !Number.isFinite(canvasY) || width <= 0 || height <= 0) {
    return 0;
  }

  const lx = Math.floor(canvasX);
  const ly = Math.floor(canvasY);
  if (lx >= 0 && lx < width && ly >= 0 && ly < height) {
    const exactId = regionMap[ly * width + lx];
    if (exactId > 0) return exactId;
  }

  if (!fatFingerAssist || !Number.isFinite(totalScreenScale) || totalScreenScale <= 0) {
    return 0;
  }
  const safeReach = Number.isFinite(touchReachRadiusPx) && touchReachRadiusPx > 0 ? touchReachRadiusPx : 0;
  if (safeReach <= 0) return 0;

  const radius = Math.min(24, Math.ceil(safeReach / totalScreenScale));
  if (radius <= 0) return 0;

  const minX = Math.max(0, lx - radius);
  const maxX = Math.min(width - 1, lx + radius);
  const minY = Math.max(0, ly - radius);
  const maxY = Math.min(height - 1, ly + radius);
  const radiusSq = radius * radius;

  let bestId = 0;
  let bestDistSq = Infinity;
  for (let y = minY; y <= maxY; y++) {
    const dy = y - ly;
    const dySq = dy * dy;
    const rowOff = y * width;
    for (let x = minX; x <= maxX; x++) {
      const dx = x - lx;
      const distSq = dx * dx + dySq;
      if (distSq > radiusSq || distSq >= bestDistSq) continue;
      const candId = regionMap[rowOff + x];
      if (candId > 0) {
        bestId = candId;
        bestDistSq = distSq;
      }
    }
  }
  return bestId;
}

/**
 * Zero-allocation Bresenham-style line collector populating a caller-owned scratch Set
 * with all valid region IDs (rId > 0) crossed along (x1, y1) -> (x2, y2).
 */
export function collectLineRegionIds(
  puzzle: PuzzleData,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  outSet: Set<number>
): boolean {
  outSet.clear();
  const { width, height, regionMap } = puzzle;
  if (
    width <= 0 ||
    height <= 0 ||
    !Number.isFinite(x1) ||
    !Number.isFinite(y1) ||
    !Number.isFinite(x2) ||
    !Number.isFinite(y2)
  ) {
    return false;
  }
  const dx = x2 - x1;
  const dy = y2 - y1;
  const maxSteps = Math.max(1, (width + height) * 2);
  const steps = Math.min(Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)))), maxSteps);

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = Math.floor(x1 + dx * t);
    const cy = Math.floor(y1 + dy * t);
    if (cx >= 0 && cx < width && cy >= 0 && cy < height) {
      const rId = regionMap[cy * width + cx];
      if (rId > 0) {
        outSet.add(rId);
      }
    }
  }
  return outSet.size > 0;
}

function applyArtworkShadow(ctx: CanvasRenderingContext2D): void {
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 6;
}

function drawMainPreview(
  ctx: CanvasRenderingContext2D,
  params: DrawPuzzleLayersParams
): void {
  const { puzzle, sourceImage, hasTransparentMask, baseCanvas, maskedPreviewCanvas } = params;
  if (hasTransparentMask) {
    if (maskedPreviewCanvas) {
      ctx.drawImage(maskedPreviewCanvas, 0, 0);
    } else if (baseCanvas) {
      ctx.drawImage(baseCanvas, 0, 0);
    }
  } else if (sourceImage && sourceImage.complete) {
    ctx.drawImage(sourceImage, 0, 0, puzzle.width, puzzle.height);
  } else if (baseCanvas) {
    ctx.drawImage(baseCanvas, 0, 0);
  }
}

function drawPreviewLayers(
  ctx: CanvasRenderingContext2D,
  params: DrawPuzzleLayersParams
): void {
  const { hasTransparentMask, showPreviewBorders, borderCanvas } = params;

  if (hasTransparentMask) {
    ctx.save();
    applyArtworkShadow(ctx);
    drawMainPreview(ctx, params);
    ctx.restore();
  } else {
    drawMainPreview(ctx, params);
  }

  if (showPreviewBorders && borderCanvas) {
    ctx.drawImage(borderCanvas, 0, 0);
  }
}

function drawInteractiveLayers(
  ctx: CanvasRenderingContext2D,
  params: DrawPuzzleLayersParams
): void {
  const {
    puzzle,
    sourceImage,
    hasTransparentMask,
    isFreeColorMode,
    isRegionSelectionMode,
    hasHighlightPixels,
    hasSelectionPixels,
    highlightStyle,
    animateHint,
    reducedMotion,
    hintIntensity,
    currentPulseAlpha,
    baseCanvas,
    highlightCanvas,
    maskedPreviewCanvas,
    selectionCanvas,
  } = params;

  if (baseCanvas) {
    if (hasTransparentMask) {
      ctx.save();
      applyArtworkShadow(ctx);
      ctx.drawImage(baseCanvas, 0, 0);
      ctx.restore();
    } else {
      ctx.drawImage(baseCanvas, 0, 0);
    }
  }

  if (
    !isRegionSelectionMode &&
    hasHighlightPixels &&
    highlightCanvas &&
    (highlightStyle === 'FULL_REGION' || highlightStyle === 'BOUNDARY_ONLY')
  ) {
    ctx.save();
    ctx.globalAlpha = computeHighlightOverlayAlpha(
      animateHint,
      reducedMotion,
      hintIntensity,
      currentPulseAlpha
    );
    ctx.drawImage(highlightCanvas, 0, 0);
    ctx.restore();
  }

  const isColoring = Boolean(isFreeColorMode || puzzle.isFreeColor);
  if (isColoring) {
    if (hasTransparentMask) {
      if (maskedPreviewCanvas) {
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        ctx.drawImage(maskedPreviewCanvas, 0, 0);
        ctx.restore();
      }
    } else if (
      sourceImage &&
      sourceImage.complete &&
      (sourceImage.naturalWidth > 0 || sourceImage.width > 0)
    ) {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(sourceImage, 0, 0, puzzle.width, puzzle.height);
      ctx.restore();
    }
  }

  if (isRegionSelectionMode && hasSelectionPixels && selectionCanvas) {
    ctx.drawImage(selectionCanvas, 0, 0);
  }
}

/**
 * Draws the framed artwork stage and active composite layers inside the already-translated
 * canvas transform (also handles non-cutout rectangular backdrop shadow before transform).
 */
export function drawPuzzleBackdropIfOpaque(
  ctx: CanvasRenderingContext2D,
  hasTransparentMask: boolean,
  artScreenX: number,
  artScreenY: number,
  artScreenW: number,
  artScreenH: number
): void {
  if (hasTransparentMask) return;
  ctx.save();
  applyArtworkShadow(ctx);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(artScreenX, artScreenY, artScreenW, artScreenH);
  ctx.restore();
}

export function drawPuzzleCompositeLayers(
  ctx: CanvasRenderingContext2D,
  params: DrawPuzzleLayersParams
): void {
  const hasOverride =
    typeof params.imageSmoothingEnabled === 'boolean' ||
    params.imageSmoothingQuality !== undefined;
  const prevEnabled = hasOverride ? ctx.imageSmoothingEnabled : true;
  const prevQuality = hasOverride ? ctx.imageSmoothingQuality : 'low';
  if (typeof params.imageSmoothingEnabled === 'boolean') {
    ctx.imageSmoothingEnabled = params.imageSmoothingEnabled;
  }
  if (params.imageSmoothingQuality !== undefined) {
    ctx.imageSmoothingQuality = params.imageSmoothingQuality;
  }
  try {
    if (params.isEffectivePreview) {
      drawPreviewLayers(ctx, params);
    } else {
      drawInteractiveLayers(ctx, params);
    }
  } finally {
    if (hasOverride) {
      ctx.imageSmoothingEnabled = prevEnabled;
      ctx.imageSmoothingQuality = prevQuality;
    }
  }
}

export interface FocusBoundsRequest {
  seq: number;
  bounds: NormalizedRect;
}

/**
 * Pure factory creating a monotonically sequenced FocusBoundsRequest with a defensive
 * copy of the normalized target bounds so caller mutations cannot corrupt queued glides.
 */
export function createFocusBoundsRequest(
  prevSeq: number,
  bounds: NormalizedRect
): FocusBoundsRequest {
  const baseSeq = Number.isFinite(prevSeq) ? Math.floor(prevSeq) : 0;
  return {
    seq: Math.max(0, baseSeq) + 1,
    bounds: {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    },
  };
}

export interface ComputeFocusViewportParams {
  bounds: NormalizedRect;
  puzzleWidth: number;
  puzzleHeight: number;
  containerWidth: number;
  containerHeight: number;
  maxZoomScale?: number;
}

export interface FocusViewportResult {
  zoomScale: number;
  panOffsetX: number;
  panOffsetY: number;
}

const DEFAULT_FOCUS_VIEWPORT: FocusViewportResult = {
  zoomScale: 1,
  panOffsetX: 0,
  panOffsetY: 0,
};

/**
 * Strict viewport bounding for pan/zoom offsets.
 * Guarantees that the artwork cannot be panned away into empty void
 * while allowing full edge-to-edge navigation when zoomed in.
 */
export function clampCanvasOffset(
  rawOffset: { x: number; y: number },
  scale: number,
  puzzleWidth: number,
  puzzleHeight: number,
  containerWidth: number,
  containerHeight: number,
  out?: { x: number; y: number }
): { x: number; y: number } {
  const safeRawX = Number.isFinite(rawOffset.x) ? rawOffset.x : 0;
  const safeRawY = Number.isFinite(rawOffset.y) ? rawOffset.y : 0;
  if (
    !Number.isFinite(scale) ||
    scale <= 0 ||
    !Number.isFinite(containerWidth) ||
    !Number.isFinite(containerHeight) ||
    !Number.isFinite(puzzleWidth) ||
    !Number.isFinite(puzzleHeight) ||
    containerWidth <= 0 ||
    containerHeight <= 0 ||
    puzzleWidth <= 0 ||
    puzzleHeight <= 0
  ) {
    if (out) {
      out.x = safeRawX;
      out.y = safeRawY;
      return out;
    }
    return { x: safeRawX, y: safeRawY };
  }

  const baseScale = Math.min(containerWidth / puzzleWidth, containerHeight / puzzleHeight) * 0.92;
  const effScale = scale * baseScale;
  const artW = puzzleWidth * effScale;
  const artH = puzzleHeight * effScale;
  const baseOffsetX = (containerWidth - puzzleWidth * baseScale) / 2;
  const baseOffsetY = (containerHeight - puzzleHeight * baseScale) / 2;

  // Generous boundary margin: allows panning corners deep into view past the viewport center
  const isZoomed = scale > 1.05;
  const marginX = isZoomed ? containerWidth * 0.72 : containerWidth * 0.45;
  const marginY = isZoomed ? containerHeight * 0.72 : containerHeight * 0.45;

  const centeredOffsetX = (containerWidth - artW) / 2 - baseOffsetX;
  const centeredOffsetY = (containerHeight - artH) / 2 - baseOffsetY;

  let minOffsetX: number;
  let maxOffsetX: number;
  let minOffsetY: number;
  let maxOffsetY: number;

  if (artW <= containerWidth) {
    minOffsetX = centeredOffsetX - marginX;
    maxOffsetX = centeredOffsetX + marginX;
  } else {
    minOffsetX = containerWidth - marginX - baseOffsetX - artW;
    maxOffsetX = marginX - baseOffsetX;
  }

  if (artH <= containerHeight) {
    minOffsetY = centeredOffsetY - marginY;
    maxOffsetY = centeredOffsetY + marginY;
  } else {
    minOffsetY = containerHeight - marginY - baseOffsetY - artH;
    maxOffsetY = marginY - baseOffsetY;
  }

  const cx = Math.max(minOffsetX, Math.min(maxOffsetX, safeRawX));
  const cy = Math.max(minOffsetY, Math.min(maxOffsetY, safeRawY));
  if (out) {
    out.x = cx;
    out.y = cy;
    return out;
  }
  return { x: cx, y: cy };
}

/**
 * Computes the clamped target viewport (zoomScale, panOffsetX, panOffsetY) that frames
 * a normalized [0..1] world-space rectangle cleanly inside the TopBar / PaletteDock safe area,
 * honoring resolvePuzzleMaxZoomScale headroom (up to MAX_INFINITE_ZOOM_SCALE = 256).
 */
export function computeFocusViewportForBounds(
  params: ComputeFocusViewportParams
): FocusViewportResult {
  const { bounds, puzzleWidth, puzzleHeight, containerWidth, containerHeight, maxZoomScale } =
    params;

  if (
    !bounds ||
    !Number.isFinite(puzzleWidth) ||
    !Number.isFinite(puzzleHeight) ||
    !Number.isFinite(containerWidth) ||
    !Number.isFinite(containerHeight) ||
    puzzleWidth <= 0 ||
    puzzleHeight <= 0 ||
    containerWidth <= 0 ||
    containerHeight <= 0 ||
    !Number.isFinite(bounds.x) ||
    !Number.isFinite(bounds.y) ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    return { ...DEFAULT_FOCUS_VIEWPORT };
  }

  if (maxZoomScale !== undefined && (!Number.isFinite(maxZoomScale) || maxZoomScale <= 0)) {
    return { ...DEFAULT_FOCUS_VIEWPORT };
  }

  const x0 = Math.max(0, Math.min(1, bounds.x));
  const y0 = Math.max(0, Math.min(1, bounds.y));
  const x1 = Math.max(0, Math.min(1, bounds.x + bounds.width));
  const y1 = Math.max(0, Math.min(1, bounds.y + bounds.height));
  const normW = x1 - x0;
  const normH = y1 - y0;
  if (!(normW > 0) || !(normH > 0)) {
    return { ...DEFAULT_FOCUS_VIEWPORT };
  }

  const effectiveMaxZoom =
    maxZoomScale === undefined
      ? BASE_MAX_ZOOM_SCALE
      : Math.max(1, Math.min(MAX_INFINITE_ZOOM_SCALE, maxZoomScale));

  const safeTop = Math.min(containerHeight * 0.25, Math.max(64, containerHeight * 0.12));
  const safeBottom =
    containerHeight - Math.min(containerHeight * 0.35, Math.max(96, containerHeight * 0.18));
  const safeHeight = Math.max(1, safeBottom - safeTop);
  const safeCenterX = containerWidth * 0.5;
  const safeCenterY = (safeTop + safeBottom) * 0.5;
  const usableW = Math.max(1, containerWidth * 0.84);
  const usableH = Math.max(1, safeHeight * 0.88);

  const baseScale = Math.min(containerWidth / puzzleWidth, containerHeight / puzzleHeight) * 0.92;
  if (!Number.isFinite(baseScale) || baseScale <= 0) {
    return { ...DEFAULT_FOCUS_VIEWPORT };
  }
  const baseOffsetX = (containerWidth - puzzleWidth * baseScale) / 2;
  const baseOffsetY = (containerHeight - puzzleHeight * baseScale) / 2;

  const boxW = normW * puzzleWidth;
  const boxH = normH * puzzleHeight;
  const centerWX = (x0 + normW * 0.5) * puzzleWidth;
  const centerWY = (y0 + normH * 0.5) * puzzleHeight;

  const fitEffScale = Math.min(usableW / boxW, usableH / boxH);
  const rawTargetScale = fitEffScale / baseScale;
  const targetScale = !Number.isFinite(rawTargetScale)
    ? effectiveMaxZoom
    : Math.max(1, Math.min(effectiveMaxZoom, rawTargetScale));

  const targetEffScale = targetScale * baseScale;
  const rawOffsetX = safeCenterX - baseOffsetX - centerWX * targetEffScale;
  const rawOffsetY = safeCenterY - baseOffsetY - centerWY * targetEffScale;
  const clamped = clampCanvasOffset(
    { x: rawOffsetX, y: rawOffsetY },
    targetScale,
    puzzleWidth,
    puzzleHeight,
    containerWidth,
    containerHeight
  );

  return {
    zoomScale: targetScale,
    panOffsetX: clamped.x,
    panOffsetY: clamped.y,
  };
}

export interface LayerSmoothingConfig {
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: ImageSmoothingQuality;
}

/**
 * Computes device pixels per layer texel along one axis:
 * (worldSpan / layerDim) * effScale * effDpr.
 * Returns 0 for any non-finite or <= 0 input.
 */
export function computeLayerTexelRatio(
  worldSpan: number,
  layerDim: number,
  effScale: number,
  effDpr: number
): number {
  if (
    !Number.isFinite(worldSpan) ||
    !Number.isFinite(layerDim) ||
    !Number.isFinite(effScale) ||
    !Number.isFinite(effDpr) ||
    worldSpan <= 0 ||
    layerDim <= 0 ||
    effScale <= 0 ||
    effDpr <= 0
  ) {
    return 0;
  }
  const ratio = (worldSpan / layerDim) * effScale * effDpr;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 0;
}

/**
 * Resolves per-layer Canvas2D smoothing settings without allocating when `out` is provided.
 * - Magnified outer/ancestor parent layers behind visible nested layers (texelRatio > 1.25):
 *   imageSmoothingEnabled = true, imageSmoothingQuality = 'high' (never ctx.filter blur).
 * - Sharp nested layers (texelRatio <= 1.25):
 *   imageSmoothingEnabled = texelRatio < 1.0, imageSmoothingQuality = 'high' when downscaling.
 * - Magnified nested layers (texelRatio > 1.25):
 *   imageSmoothingEnabled = true, imageSmoothingQuality = 'high'.
 * - Standard root layer with no visible nested layers:
 *   imageSmoothingEnabled = true, quality = 'high' when downscaling else 'low'.
 */
export function resolveLayerImageSmoothing(
  texelRatio: number,
  isNestedLayer: boolean,
  hasVisibleDeeperChild: boolean,
  out?: LayerSmoothingConfig
): LayerSmoothingConfig {
  const safeRatio = Number.isFinite(texelRatio) && texelRatio > 0 ? texelRatio : 0;
  let enabled: boolean;
  let quality: ImageSmoothingQuality;

  if (!isNestedLayer) {
    enabled = true;
    quality =
      (hasVisibleDeeperChild && safeRatio > PARENT_SMOOTH_TEXEL_THRESHOLD) ||
      (safeRatio > 0 && safeRatio < 1.0)
        ? 'high'
        : 'low';
  } else if (safeRatio === 0 || safeRatio > PARENT_SMOOTH_TEXEL_THRESHOLD) {
    enabled = true;
    quality = 'high';
  } else {
    enabled = safeRatio < 1.0;
    quality = 'high';
  }

  if (out) {
    out.imageSmoothingEnabled = enabled;
    out.imageSmoothingQuality = quality;
    return out;
  }
  return { imageSmoothingEnabled: enabled, imageSmoothingQuality: quality };
}

const SILHOUETTE_DIR_DX = [1, 0, -1, 0] as const;
const SILHOUETTE_DIR_DY = [0, 1, 0, -1] as const;

function addSilhouetteDirectedEdge(
  outMask: Map<number, number>,
  vertexKey: number,
  dirBit: number
): void {
  const prev = outMask.get(vertexKey) ?? 0;
  outMask.set(vertexKey, prev | dirBit);
}

function buildSilhouetteEdgeMask(
  regionMap: Int32Array,
  width: number,
  height: number
): { outMask: Map<number, number>; totalEdges: number } {
  const outMask = new Map<number, number>();
  let totalEdges = 0;
  const stride = width + 1;

  for (let y = 0; y < height; y++) {
    const rowOff = y * width;
    const vRow = y * stride;
    const vRowNext = (y + 1) * stride;
    for (let x = 0; x < width; x++) {
      const idx = rowOff + x;
      if (regionMap[idx] <= 0) continue;
      if (y === 0 || regionMap[idx - width] <= 0) {
        addSilhouetteDirectedEdge(outMask, vRow + x, 1);
        totalEdges++;
      }
      if (x === width - 1 || regionMap[idx + 1] <= 0) {
        addSilhouetteDirectedEdge(outMask, vRow + x + 1, 2);
        totalEdges++;
      }
      if (y === height - 1 || regionMap[idx + width] <= 0) {
        addSilhouetteDirectedEdge(outMask, vRowNext + x + 1, 4);
        totalEdges++;
      }
      if (x === 0 || regionMap[idx - 1] <= 0) {
        addSilhouetteDirectedEdge(outMask, vRowNext + x, 8);
        totalEdges++;
      }
    }
  }

  return { outMask, totalEdges };
}

function consumeSilhouetteDir(outMask: Map<number, number>, key: number, dir: number): void {
  const mask = (outMask.get(key) ?? 0) & ~(1 << dir);
  if (mask === 0) {
    outMask.delete(key);
  } else {
    outMask.set(key, mask);
  }
}

function pickNextSilhouetteDir(mask: number, dir: number): number {
  const right = (dir + 1) & 3;
  if (mask & (1 << right)) return right;
  if (mask & (1 << dir)) return dir;
  const left = (dir + 3) & 3;
  if (mask & (1 << left)) return left;
  const back = (dir + 2) & 3;
  if (mask & (1 << back)) return back;
  return -1;
}

function traceMergedSilhouetteLoop(
  startKey: number,
  startDir: number,
  stride: number,
  outMask: Map<number, number>,
  loopX: number[],
  loopY: number[],
  maxSteps: number
): void {
  loopX.length = 0;
  loopY.length = 0;

  const startY = Math.floor(startKey / stride);
  const startX = startKey - startY * stride;

  consumeSilhouetteDir(outMask, startKey, startDir);
  let curX = startX + SILHOUETTE_DIR_DX[startDir];
  let curY = startY + SILHOUETTE_DIR_DY[startDir];
  let dir = startDir;
  let steps = 1;

  while (steps <= maxSteps) {
    const curKey = curY * stride + curX;
    if (curKey === startKey) {
      if (dir !== startDir) {
        loopX.push(startX);
        loopY.push(startY);
      }
      break;
    }
    const mask = outMask.get(curKey) ?? 0;
    const nextDir = pickNextSilhouetteDir(mask, dir);
    if (nextDir < 0) break;
    if (nextDir !== dir) {
      loopX.push(curX);
      loopY.push(curY);
    }
    consumeSilhouetteDir(outMask, curKey, nextDir);
    curX += SILHOUETTE_DIR_DX[nextDir];
    curY += SILHOUETTE_DIR_DY[nextDir];
    dir = nextDir;
    steps++;
  }
}

function appendSmoothedClosedLoopSegments(
  loopX: readonly number[],
  loopY: readonly number[],
  outSegments: number[]
): void {
  const n = loopX.length;
  if (n < 3) return;

  let vx: ArrayLike<number> = loopX;
  let vy: ArrayLike<number> = loopY;

  if (n >= 6) {
    const sx = new Float64Array(n);
    const sy = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const prevIdx = i === 0 ? n - 1 : i - 1;
      const nextIdx = i === n - 1 ? 0 : i + 1;
      const x = loopX[i];
      const y = loopY[i];
      const px = loopX[prevIdx];
      const py = loopY[prevIdx];
      const nx = loopX[nextIdx];
      const ny = loopY[nextIdx];
      const lenPrev = Math.abs(x - px) + Math.abs(y - py);
      const lenNext = Math.abs(nx - x) + Math.abs(ny - y);
      if (lenPrev <= 2 && lenNext <= 2) {
        sx[i] = 0.25 * px + 0.5 * x + 0.25 * nx;
        sy[i] = 0.25 * py + 0.5 * y + 0.25 * ny;
      } else {
        sx[i] = x;
        sy[i] = y;
      }
    }
    vx = sx;
    vy = sy;
  }

  for (let i = 0; i < n; i++) {
    const next = i === n - 1 ? 0 : i + 1;
    outSegments.push(vx[i], vy[i], vx[next], vy[next]);
  }
}

function firstBitDir(mask: number): number {
  if (mask & 1) return 0;
  if (mask & 2) return 1;
  if (mask & 4) return 2;
  if (mask & 8) return 3;
  return -1;
}

/**
 * Extracts closed, collinear-merged outer silhouette boundary contours from a
 * layer's regionMap (tracing edges where regionMap[i] > 0 borders <= 0 or OOB).
 * Returns packed [x0, y0, x1, y1, ...] segments in layer-local pixel-corner coords.
 */
export function extractLayerSilhouetteContours(
  regionMap: Int32Array,
  width: number,
  height: number
): Float32Array {
  if (
    !isValidGridDimensions(width, height) ||
    !regionMap ||
    regionMap.length < width * height
  ) {
    return new Float32Array(0);
  }

  const { outMask, totalEdges } = buildSilhouetteEdgeMask(regionMap, width, height);
  if (totalEdges === 0 || outMask.size === 0) {
    return new Float32Array(0);
  }

  const stride = width + 1;
  const maxSteps = totalEdges + 4;
  const loopX: number[] = [];
  const loopY: number[] = [];
  const outSegments: number[] = [];

  while (outMask.size > 0) {
    const firstEntry = outMask.entries().next();
    if (firstEntry.done) break;
    const [startKey, mask] = firstEntry.value;
    const startDir = firstBitDir(mask);
    if (startDir < 0) {
      outMask.delete(startKey);
      continue;
    }
    traceMergedSilhouetteLoop(startKey, startDir, stride, outMask, loopX, loopY, maxSteps);
    appendSmoothedClosedLoopSegments(loopX, loopY, outSegments);
  }

  return outSegments.length > 0 ? Float32Array.from(outSegments) : new Float32Array(0);
}

type SilhouettePathTarget = Pick<CanvasRenderingContext2D, 'moveTo' | 'lineTo' | 'closePath'>;

function traceSilhouetteSegmentsToTarget(
  target: SilhouettePathTarget,
  segments: Float32Array,
  worldX: number,
  worldY: number,
  scaleX: number,
  scaleY: number
): boolean {
  let added = false;
  let hasSubpath = false;
  let subStartX = NaN;
  let subStartY = NaN;
  let lastX = NaN;
  let lastY = NaN;

  const limit = segments.length - (segments.length % 4);
  for (let i = 0; i < limit; i += 4) {
    const x0 = segments[i];
    const y0 = segments[i + 1];
    const x1 = segments[i + 2];
    const y1 = segments[i + 3];
    if (
      !Number.isFinite(x0) ||
      !Number.isFinite(y0) ||
      !Number.isFinite(x1) ||
      !Number.isFinite(y1) ||
      (x0 === x1 && y0 === y1)
    ) {
      continue;
    }
    const wx0 = worldX + x0 * scaleX;
    const wy0 = worldY + y0 * scaleY;
    const wx1 = worldX + x1 * scaleX;
    const wy1 = worldY + y1 * scaleY;

    if (!hasSubpath || x0 !== lastX || y0 !== lastY) {
      target.moveTo(wx0, wy0);
      subStartX = x0;
      subStartY = y0;
      hasSubpath = true;
    }
    if (x1 === subStartX && y1 === subStartY) {
      target.closePath();
      hasSubpath = false;
    } else {
      target.lineTo(wx1, wy1);
    }
    lastX = x1;
    lastY = y1;
    added = true;
  }

  return added;
}

/**
 * Builds a world-space Path2D from extracted layer-local silhouette segments.
 * Returns null if Path2D is unavailable or segments/scales are invalid.
 */
export function buildLayerSilhouettePath(
  segments: Float32Array | null,
  worldX: number,
  worldY: number,
  scaleX: number,
  scaleY: number
): Path2D | null {
  if (
    typeof Path2D === 'undefined' ||
    !segments ||
    segments.length < 4 ||
    !Number.isFinite(worldX) ||
    !Number.isFinite(worldY) ||
    !isPositiveFinite(scaleX) ||
    !isPositiveFinite(scaleY)
  ) {
    return null;
  }
  const path = new Path2D();
  return traceSilhouetteSegmentsToTarget(path, segments, worldX, worldY, scaleX, scaleY)
    ? path
    : null;
}

/**
 * Strokes a cached world-space silhouette hairline at constant screen-space width (~1.15px),
 * falling back to direct segment tracing when Path2D is unavailable.
 */
export function strokeLayerSilhouette(
  ctx: CanvasRenderingContext2D,
  segments: Float32Array | null,
  path: Path2D | null,
  wx: number,
  wy: number,
  ww: number,
  wh: number,
  layerWidth: number,
  layerHeight: number,
  effScale: number
): void {
  if (!isPositiveFinite(effScale)) return;
  if (!path && (!segments || segments.length < 4)) return;

  ctx.save();
  ctx.lineWidth = LAYER_SILHOUETTE_LINE_WIDTH_PX / effScale;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = LAYER_SILHOUETTE_STROKE_STYLE;
  if (path) {
    ctx.stroke(path);
  } else if (segments && isPositiveFinite(layerWidth) && isPositiveFinite(layerHeight)) {
    ctx.beginPath();
    if (
      traceSilhouetteSegmentsToTarget(
        ctx,
        segments,
        wx,
        wy,
        ww / layerWidth,
        wh / layerHeight
      )
    ) {
      ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * Pre-culls visible nested layers into a caller-provided scratch array (zero rAF allocations).
 */
export function collectVisibleNestedLayers(
  puzzle: PuzzleData,
  sortedLayersAsc: readonly NestedPuzzleLayer[],
  visLeft: number,
  visTop: number,
  visRight: number,
  visBottom: number,
  effScale: number,
  out: NestedPuzzleLayer[]
): NestedPuzzleLayer[] {
  out.length = 0;
  for (let i = 0; i < sortedLayersAsc.length; i++) {
    const layer = sortedLayersAsc[i];
    if (
      isLayerVisibleAndLargeEnough(
        puzzle.width,
        puzzle.height,
        layer,
        visLeft,
        visTop,
        visRight,
        visBottom,
        effScale
      )
    ) {
      out.push(layer);
    }
  }
  return out;
}

/**
 * Returns true iff any later (deeper) visible layer in ascending-depth order overlaps
 * `visibleLayersAsc[index]`'s worldBounds. Zero allocations.
 */
export function hasOverlappingDeeperVisibleLayer(
  visibleLayersAsc: readonly NestedPuzzleLayer[],
  index: number
): boolean {
  const current = visibleLayersAsc[index];
  if (!current || !isValidNormalizedRect(current.worldBounds)) return false;
  const a = current.worldBounds;
  const aRight = a.x + a.width;
  const aBottom = a.y + a.height;

  for (let j = index + 1; j < visibleLayersAsc.length; j++) {
    const deeper = visibleLayersAsc[j];
    if (!deeper || deeper.depth <= current.depth || !isValidNormalizedRect(deeper.worldBounds)) {
      continue;
    }
    const b = deeper.worldBounds;
    if (a.x < b.x + b.width && aRight > b.x && a.y < b.y + b.height && aBottom > b.y) {
      return true;
    }
  }
  return false;
}

/**
 * Populates `outSet` with layerIds of nested layers that intersect the current viewport
 * and occupy a prominent fraction of the viewport (either >= 25% of min viewport dim,
 * or zoomed > 1.5x with at least 72x72 CSS px on screen).
 */
export function collectProminentVisibleLayerIds(
  puzzleWidth: number,
  puzzleHeight: number,
  nestedLayers: readonly NestedPuzzleLayer[],
  visLeft: number,
  visTop: number,
  visRight: number,
  visBottom: number,
  scale: number,
  effScale: number,
  containerWidth: number,
  containerHeight: number,
  outSet: Set<string>
): Set<string> {
  outSet.clear();
  if (
    nestedLayers.length === 0 ||
    !isPositiveFinite(puzzleWidth) ||
    !isPositiveFinite(puzzleHeight) ||
    !isPositiveFinite(effScale) ||
    !isPositiveFinite(containerWidth) ||
    !isPositiveFinite(containerHeight) ||
    !Number.isFinite(visLeft) ||
    !Number.isFinite(visTop) ||
    !Number.isFinite(visRight) ||
    !Number.isFinite(visBottom)
  ) {
    return outSet;
  }

  const minViewportDim = Math.min(containerWidth, containerHeight);
  const prominentThreshold = minViewportDim * 0.25;
  const isZoomedIn = Number.isFinite(scale) && scale > 1.5;

  for (let i = 0; i < nestedLayers.length; i++) {
    const layer = nestedLayers[i];
    if (
      !layer ||
      !isValidGridDimensions(layer.width, layer.height) ||
      !isValidNormalizedRect(layer.worldBounds)
    ) {
      continue;
    }
    const b = layer.worldBounds;
    const wx = b.x * puzzleWidth;
    const wy = b.y * puzzleHeight;
    const ww = b.width * puzzleWidth;
    const wh = b.height * puzzleHeight;
    if (wx + ww < visLeft || wx > visRight || wy + wh < visTop || wy > visBottom) {
      continue;
    }
    const screenW = ww * effScale;
    const screenH = wh * effScale;
    if (
      Math.max(screenW, screenH) >= prominentThreshold ||
      (isZoomedIn && screenW >= 72 && screenH >= 72)
    ) {
      outSet.add(layer.layerId);
    }
  }

  return outSet;
}

