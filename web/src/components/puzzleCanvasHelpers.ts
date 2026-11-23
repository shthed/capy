import { PuzzleData, Region } from '../types';

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
  artScreenX: number;
  artScreenY: number;
  artScreenW: number;
  artScreenH: number;
  effScale: number;
  baseCanvas: HTMLCanvasElement | null;
  borderCanvas: HTMLCanvasElement | null;
  highlightCanvas: HTMLCanvasElement | null;
  maskedPreviewCanvas: HTMLCanvasElement | null;
  selectionCanvas: HTMLCanvasElement | null;
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
  sourceImage: HTMLImageElement,
  puzzle: PuzzleData
): boolean {
  const { width, height, regionMap } = puzzle;
  if (width <= 0 || height <= 0 || regionMap.length < width * height) return false;
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
  puzzle: PuzzleData,
  selectedRegionIds: ReadonlySet<number>,
  regionById: ReadonlyMap<number, Region>
): boolean {
  const { width, height, regionMap } = puzzle;
  let anyPixel = false;

  for (const rId of selectedRegionIds) {
    const reg = regionById.get(rId);
    if (!reg) continue;
    const pixels = reg.pixels;
    for (let i = 0; i < pixels.length; i++) {
      const pIdx = pixels[i];
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
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.floor(dist * 0.8));

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

function drawPreviewLayers(
  ctx: CanvasRenderingContext2D,
  params: DrawPuzzleLayersParams
): void {
  const {
    puzzle,
    sourceImage,
    hasTransparentMask,
    showPreviewBorders,
    baseCanvas,
    borderCanvas,
    maskedPreviewCanvas,
  } = params;

  const drawMainPreview = () => {
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
  };

  if (hasTransparentMask) {
    ctx.save();
    applyArtworkShadow(ctx);
    drawMainPreview();
    ctx.restore();
  } else {
    drawMainPreview();
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

  const effectiveAnimateHint = Boolean(animateHint && !reducedMotion);
  if (
    !isRegionSelectionMode &&
    hasHighlightPixels &&
    highlightCanvas &&
    (highlightStyle === 'FULL_REGION' || highlightStyle === 'BOUNDARY_ONLY')
  ) {
    ctx.save();
    ctx.globalAlpha = effectiveAnimateHint
      ? Math.min(1, Math.max(0.05, currentPulseAlpha * hintIntensity))
      : Math.min(
          1,
          Math.max(0.05, reducedMotion ? Math.max(0.88, hintIntensity) : hintIntensity * 0.78)
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
  if (params.isEffectivePreview) {
    drawPreviewLayers(ctx, params);
  } else {
    drawInteractiveLayers(ctx, params);
  }
}
