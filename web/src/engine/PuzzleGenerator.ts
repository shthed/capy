import {
  GENERATION_PIPELINE_STEPS,
  GenerationInspectionDetails,
  GenerationProgressPayload,
  GenerationStepInfo,
  GeneratorAlgorithm,
  GeneratorConfig,
  ImageType,
  PaletteColor,
  PuzzleData,
  Region,
} from '../types';
import { encodeRegionMapRle } from '../services/CapyCodec';
import { ColorQuantizer } from './ColorQuantizer';
import { ImageAnalysisResult, ImageAnalyzer } from './ImageAnalyzer';
import { LineArtAnalysis, LineArtExtractor } from './LineArtExtractor';
import { RegionSegmenter } from './RegionSegmenter';

const COLORING_BOOK_PALETTE_DEF: ReadonlyArray<{
  hex: string;
  isLight: boolean;
  r: number;
  g: number;
  b: number;
}> = [
  { hex: '#EF4444', isLight: false, r: 239, g: 68, b: 68 },
  { hex: '#F97316', isLight: false, r: 249, g: 115, b: 22 },
  { hex: '#F59E0B', isLight: true, r: 245, g: 158, b: 11 },
  { hex: '#EAB308', isLight: true, r: 234, g: 179, b: 8 },
  { hex: '#84CC16', isLight: true, r: 132, g: 204, b: 22 },
  { hex: '#22C55E', isLight: false, r: 34, g: 197, b: 94 },
  { hex: '#10B981', isLight: false, r: 16, g: 185, b: 129 },
  { hex: '#06B6D4', isLight: true, r: 6, g: 182, b: 212 },
  { hex: '#3B82F6', isLight: false, r: 59, g: 130, b: 246 },
  { hex: '#6366F1', isLight: false, r: 99, g: 102, b: 241 },
  { hex: '#8B5CF6', isLight: false, r: 139, g: 92, b: 246 },
  { hex: '#A855F7', isLight: false, r: 168, g: 85, b: 247 },
  { hex: '#EC4899', isLight: false, r: 236, g: 72, b: 153 },
  { hex: '#F43F5E', isLight: false, r: 244, g: 63, b: 94 },
  { hex: '#B45309', isLight: false, r: 180, g: 83, b: 9 },
  { hex: '#78350F', isLight: false, r: 120, g: 53, b: 15 },
  { hex: '#14B8A6', isLight: true, r: 20, g: 184, b: 166 },
  { hex: '#E0E7FF', isLight: true, r: 224, g: 231, b: 255 },
  { hex: '#94A3B8', isLight: true, r: 148, g: 163, b: 184 },
  { hex: '#1E293B', isLight: false, r: 30, g: 41, b: 59 },
];

function createColoringBookPalette(): PaletteColor[] {
  return COLORING_BOOK_PALETTE_DEF.map((c, idx) => ({
    id: idx + 1,
    hex: c.hex,
    isLight: c.isLight,
    argb: ((0xff << 24) | (c.r << 16) | (c.g << 8) | c.b) >>> 0,
    r: c.r,
    g: c.g,
    b: c.b,
  }));
}

export function extractOpaqueAlphaMask(
  rgbaData: Uint8ClampedArray,
  width: number,
  height: number
): {
  hasCutoutAlpha: boolean;
  opaqueMask: Uint8Array;
  opaqueCount: number;
  transparentCount: number;
} {
  const total = Math.max(0, width * height);
  const opaqueMask = new Uint8Array(total);
  const limit = Math.min(total, Math.floor(rgbaData.length / 4));
  let opaqueCount = 0;
  let transparentCount = 0;
  for (let i = 0; i < limit; i++) {
    if (rgbaData[i * 4 + 3] >= 128) {
      opaqueMask[i] = 1;
      opaqueCount++;
    } else {
      transparentCount++;
    }
  }
  const hasCutoutAlpha = opaqueCount > 0 && transparentCount * 100 >= total;
  return { hasCutoutAlpha, opaqueMask, opaqueCount, transparentCount };
}

function hasAnyActivePixel(activeMask: Uint8Array, total: number): boolean {
  const limit = Math.min(total, activeMask.length);
  for (let i = 0; i < limit; i++) {
    if (activeMask[i] === 1) return true;
  }
  return false;
}

function createEmptyPuzzleData(width: number, height: number, isFreeColor?: boolean): PuzzleData {
  const safeW = Math.max(0, width);
  const safeH = Math.max(0, height);
  const total = safeW * safeH;
  return {
    width: safeW,
    height: safeH,
    palette: [],
    regions: [],
    regionMap: new Int32Array(total),
    borderMap: new Uint8Array(total),
    ...(isFreeColor ? { isFreeColor: true } : {}),
  };
}

export type ProgressCallback = (
  progress: number,
  status: string,
  payload?: GenerationProgressPayload,
  paletteColors?: Array<{ r: number; g: number; b: number }>
) => void;

export function buildProgressPayload(
  progress: number,
  status: string,
  inspection: GenerationInspectionDetails = {}
): GenerationProgressPayload {
  const clamped = Math.min(1, Math.max(0, progress));
  let activeStepId = 1;
  if (clamped >= 0.85) activeStepId = 6;
  else if (clamped >= 0.64) activeStepId = 5;
  else if (clamped >= 0.31) activeStepId = 4;
  else if (clamped >= 0.22) activeStepId = 3;
  else if (clamped >= 0.14) activeStepId = 2;
  else activeStepId = 1;

  const steps: GenerationStepInfo[] = GENERATION_PIPELINE_STEPS.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    status:
      s.id < activeStepId
        ? 'completed'
        : s.id === activeStepId
          ? 'in_progress'
          : 'pending',
  }));

  const currentStep = GENERATION_PIPELINE_STEPS[activeStepId - 1] || GENERATION_PIPELINE_STEPS[0];

  return {
    progress: clamped,
    status,
    stepIndex: activeStepId,
    totalSteps: GENERATION_PIPELINE_STEPS.length,
    stepName: currentStep.name,
    stepDescription: currentStep.description,
    steps,
    inspection: { ...inspection },
  };
}

export interface PuzzleGenerator {
  generate(
    sourceCanvas: HTMLCanvasElement,
    config: GeneratorConfig,
    onProgress?: ProgressCallback,
    detailedProgress?: boolean
  ): PuzzleData;

  generateFromRgba(
    rgbaData: Uint8ClampedArray,
    width: number,
    height: number,
    config: GeneratorConfig,
    onProgress?: ProgressCallback,
    detailedProgress?: boolean,
    activeMask?: Uint8Array
  ): PuzzleData;
}

/**
 * High-performance nearest/bilinear pixel scaler.
 * Operates purely on TypedArrays with zero DOM dependencies,
 * making it 100% thread-safe for Web Workers.
 */
function scaleRgba(
  srcData: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  maxDim: number
): { data: Uint8ClampedArray; width: number; height: number } {
  const maxSourceDim = Math.max(srcW, srcH);
  const targetDim = maxDim > 0 ? Math.min(maxDim, 2048) : maxSourceDim;
  const scale = srcW > targetDim || srcH > targetDim ? targetDim / maxSourceDim : 1.0;

  const targetW = Math.max(1, Math.floor(srcW * scale));
  const targetH = Math.max(1, Math.floor(srcH * scale));

  if (targetW === srcW && targetH === srcH) {
    return { data: srcData, width: srcW, height: srcH };
  }

  const result = new Uint8ClampedArray(targetW * targetH * 4);
  const xRatio = srcW / targetW;
  const yRatio = srcH / targetH;

  for (let y = 0; y < targetH; y++) {
    const srcY = Math.min(srcH - 1, Math.floor(y * yRatio));
    const targetRow = y * targetW * 4;
    const srcRow = srcY * srcW * 4;

    for (let x = 0; x < targetW; x++) {
      const srcX = Math.min(srcW - 1, Math.floor(x * xRatio));
      const targetIdx = targetRow + x * 4;
      const srcIdx = srcRow + srcX * 4;

      result[targetIdx] = srcData[srcIdx];
      result[targetIdx + 1] = srcData[srcIdx + 1];
      result[targetIdx + 2] = srcData[srcIdx + 2];
      result[targetIdx + 3] = srcData[srcIdx + 3];
    }
  }

  return { data: result, width: targetW, height: targetH };
}

function scaleRgbaAndMask(
  srcData: Uint8ClampedArray,
  srcMask: Uint8Array | undefined,
  srcW: number,
  srcH: number,
  maxDim: number
): { data: Uint8ClampedArray; mask?: Uint8Array; width: number; height: number } {
  if (!srcMask) {
    return scaleRgba(srcData, srcW, srcH, maxDim);
  }

  const maxSourceDim = Math.max(srcW, srcH);
  const targetDim = maxDim > 0 ? Math.min(maxDim, 2048) : maxSourceDim;
  const scale = srcW > targetDim || srcH > targetDim ? targetDim / maxSourceDim : 1.0;

  const targetW = Math.max(1, Math.floor(srcW * scale));
  const targetH = Math.max(1, Math.floor(srcH * scale));

  if (targetW === srcW && targetH === srcH) {
    return { data: srcData, mask: srcMask, width: srcW, height: srcH };
  }

  const result = new Uint8ClampedArray(targetW * targetH * 4);
  const scaledMask = new Uint8Array(targetW * targetH);
  const xRatio = srcW / targetW;
  const yRatio = srcH / targetH;
  let activeCount = 0;

  for (let y = 0; y < targetH; y++) {
    const srcY = Math.min(srcH - 1, Math.floor(y * yRatio));
    const targetPixelRow = y * targetW;
    const srcPixelRow = srcY * srcW;

    for (let x = 0; x < targetW; x++) {
      const srcX = Math.min(srcW - 1, Math.floor(x * xRatio));
      const targetPixelIdx = targetPixelRow + x;
      const srcPixelIdx = srcPixelRow + srcX;
      const targetIdx = targetPixelIdx * 4;
      const srcIdx = srcPixelIdx * 4;

      result[targetIdx] = srcData[srcIdx];
      result[targetIdx + 1] = srcData[srcIdx + 1];
      result[targetIdx + 2] = srcData[srcIdx + 2];
      result[targetIdx + 3] = srcData[srcIdx + 3];

      if (srcPixelIdx < srcMask.length && srcMask[srcPixelIdx] === 1) {
        scaledMask[targetPixelIdx] = 1;
        activeCount++;
      }
    }
  }

  // Fallback to native resolution if nearest downsampling missed an ultra-sparse mask
  if (activeCount === 0 && hasAnyActivePixel(srcMask, srcW * srcH)) {
    return { data: srcData, mask: srcMask, width: srcW, height: srcH };
  }

  return { data: result, mask: scaledMask, width: targetW, height: targetH };
}

function buildBwLineArtAssignments(
  rawRgba: Uint8ClampedArray,
  lineMask: Uint8Array,
  total: number,
  palette: PaletteColor[],
  activeMask?: Uint8Array
): Int32Array {
  const effectiveAssignments = new Int32Array(total);
  if (activeMask) effectiveAssignments.fill(-1);
  const inkCluster = palette.length - 1;

  for (let i = 0; i < total; i++) {
    if (activeMask && activeMask[i] !== 1) continue;
    if (lineMask[i] === 1) {
      effectiveAssignments[i] = inkCluster;
      continue;
    }

    const idx = i * 4;
    const r = rawRgba[idx];
    const g = rawRgba[idx + 1];
    const b = rawRgba[idx + 2];
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    if (maxC - minC > 35 && maxC > 50) {
      let bestDist = 999999;
      let bestC = 0;
      for (let c = 0; c < inkCluster; c++) {
        const d = ColorQuantizer.perceptualDistanceSq(
          r,
          g,
          b,
          palette[c].r,
          palette[c].g,
          palette[c].b
        );
        if (d < bestDist) {
          bestDist = d;
          bestC = c;
        }
      }
      effectiveAssignments[i] = bestC;
    } else {
      effectiveAssignments[i] = 0;
    }
  }

  return effectiveAssignments;
}

function applyUnifiedBlackLineAssignments(
  palette: PaletteColor[],
  effectiveAssignments: Int32Array,
  lineMask: Uint8Array,
  total: number,
  activeMask?: Uint8Array
): void {
  let blackCluster = palette.findIndex((p) => p.r < 30 && p.g < 30 && p.b < 30);
  if (blackCluster === -1) {
    palette.push({
      id: palette.length + 1,
      hex: '#111827',
      isLight: false,
      argb: 0xff111827,
      r: 17,
      g: 24,
      b: 39,
    });
    blackCluster = palette.length - 1;
  }

  for (let i = 0; i < total; i++) {
    if (activeMask && activeMask[i] !== 1) continue;
    if (lineMask[i] === 1) {
      effectiveAssignments[i] = blackCluster;
    }
  }
}

function buildBwRegionAdjacency(
  regionMap: Int32Array,
  width: number,
  height: number,
  regionCount: number
): Set<number>[] {
  const adj = Array.from({ length: regionCount + 1 }, () => new Set<number>());
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const idx = row + x;
      const r1 = regionMap[idx];
      if (r1 <= 0) continue;
      if (x < width - 1) {
        const r2 = regionMap[idx + 1];
        if (r1 !== r2 && r2 > 0) {
          adj[r1].add(r2);
          adj[r2].add(r1);
        }
      }
      if (y < height - 1) {
        const r3 = regionMap[idx + width];
        if (r1 !== r3 && r3 > 0) {
          adj[r1].add(r3);
          adj[r3].add(r1);
        }
      }
    }
  }
  return adj;
}

function lockChromaticBwRegions(
  regions: Region[],
  rawRgba: Uint8ClampedArray,
  lineMask: Uint8Array,
  palette: PaletteColor[],
  numColors: number,
  colorUsage: Int32Array
): Uint8Array {
  const lockedSourceColor = new Uint8Array(regions.length + 1);

  for (let r = 1; r <= regions.length; r++) {
    const reg = regions[r - 1];
    if (!reg) continue;

    let nonLineCount = 0;
    let chromaticCount = 0;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;

    for (let i = 0; i < reg.pixels.length; i++) {
      const pIdx = reg.pixels[i];
      if (lineMask[pIdx] === 1) continue;
      nonLineCount++;
      const rgbaIdx = pIdx * 4;
      const pr = rawRgba[rgbaIdx];
      const pg = rawRgba[rgbaIdx + 1];
      const pb = rawRgba[rgbaIdx + 2];
      const maxC = Math.max(pr, pg, pb);
      const minC = Math.min(pr, pg, pb);
      if (maxC - minC > 35 && maxC > 50) {
        chromaticCount++;
        sumR += pr;
        sumG += pg;
        sumB += pb;
      }
    }

    if (nonLineCount > 0 && chromaticCount / nonLineCount > 0.25) {
      const avgR = sumR / chromaticCount;
      const avgG = sumG / chromaticCount;
      const avgB = sumB / chromaticCount;
      let bestDist = Infinity;
      let bestColId = 1;
      for (let c = 0; c < numColors; c++) {
        const d = ColorQuantizer.perceptualDistanceSq(
          avgR,
          avgG,
          avgB,
          palette[c].r,
          palette[c].g,
          palette[c].b
        );
        if (d < bestDist) {
          bestDist = d;
          bestColId = palette[c].id;
        }
      }
      reg.colorId = bestColId;
      lockedSourceColor[r] = 1;
      colorUsage[bestColId]++;
    } else {
      reg.colorId = 0;
    }
  }

  return lockedSourceColor;
}

function assignGreedyBwColors(
  regions: Region[],
  adj: Set<number>[],
  lockedSourceColor: Uint8Array,
  numColors: number,
  colorUsage: Int32Array
): void {
  for (let r = 1; r <= regions.length; r++) {
    if (lockedSourceColor[r] === 1) continue;
    const reg = regions[r - 1];
    if (!reg) continue;

    const used = new Set<number>();
    for (const n of adj[r]) {
      const nc = regions[n - 1]?.colorId;
      if (nc && nc > 0) used.add(nc);
    }

    let bestC = 1;
    let minUsage = 999999;
    for (let c = 1; c <= numColors; c++) {
      if (!used.has(c) && colorUsage[c] < minUsage) {
        minUsage = colorUsage[c];
        bestC = c;
      }
    }
    if (minUsage === 999999) {
      bestC = (r % numColors) + 1;
    }
    reg.colorId = bestC;
    colorUsage[bestC]++;
  }
}

function balanceBwColoringBookRegions(
  regions: Region[],
  regionMap: Int32Array,
  width: number,
  height: number,
  rawRgba: Uint8ClampedArray,
  lineMask: Uint8Array,
  palette: PaletteColor[]
): void {
  const numColors = palette.length - 1;
  if (numColors <= 0) return;

  const adj = buildBwRegionAdjacency(regionMap, width, height, regions.length);
  const colorUsage = new Int32Array(numColors + 1);
  const lockedSourceColor = lockChromaticBwRegions(
    regions,
    rawRgba,
    lineMask,
    palette,
    numColors,
    colorUsage
  );
  assignGreedyBwColors(regions, adj, lockedSourceColor, numColors, colorUsage);
}

function resolveColoringBookFlags(
  config: GeneratorConfig,
  isBlackAndWhite: boolean,
  hasMask: boolean
): { isBwColoring: boolean; isFreeColorOutput: boolean } {
  if (config.isFreeColor === false) {
    return { isBwColoring: false, isFreeColorOutput: false };
  }
  const isBwColoring = hasMask
    ? isBlackAndWhite
    : isBlackAndWhite || Boolean(config.isFreeColor);
  const isFreeColorOutput = isBwColoring || Boolean(config.isFreeColor);
  return { isBwColoring, isFreeColorOutput };
}

function resolveLineArtPaletteAndAssignments(
  rawRgba: Uint8ClampedArray,
  width: number,
  height: number,
  lineMask: Uint8Array,
  config: GeneratorConfig,
  isBwColoring: boolean,
  lineHandling: GeneratorConfig['lineHandling'],
  onProgress?: ProgressCallback,
  activeMask?: Uint8Array
): { palette: PaletteColor[]; effectiveAssignments: Int32Array } {
  const total = width * height;
  if (isBwColoring) {
    onProgress?.(0.45, 'Configuring coloring book palette...');
    const palette = createColoringBookPalette();
    const effectiveAssignments = buildBwLineArtAssignments(
      rawRgba,
      lineMask,
      total,
      palette,
      activeMask
    );
    return { palette, effectiveAssignments };
  }

  onProgress?.(0.28, 'Denoising cel fill areas...');
  const denoised =
    activeMask && config.smoothingPasses === 0
      ? rawRgba
      : ColorQuantizer.applyMedianFilter(rawRgba, width, height, activeMask);

  onProgress?.(0.31, 'Quantizing cel palette colors...');
  const quantized = ColorQuantizer.quantize(
    denoised,
    width,
    height,
    config.colorCount,
    16,
    true,
    true,
    onProgress,
    activeMask
  );
  const palette = quantized.palette;
  const effectiveAssignments = new Int32Array(quantized.assignments);
  if (palette.length > 0 && lineHandling === 'UNIFIED_BLACK_REGION') {
    applyUnifiedBlackLineAssignments(palette, effectiveAssignments, lineMask, total, activeMask);
  }
  return { palette, effectiveAssignments };
}

function resolveLineArtRegionLimits(
  config: GeneratorConfig,
  isBwColoring: boolean,
  hasMask: boolean
): { minArea: number; maxRegs: number } {
  const defaultMin = isBwColoring ? 12 : 48;
  const defaultMax = isBwColoring ? 800 : 200;
  if (hasMask) {
    return {
      minArea: Math.max(1, config.minRegionArea || defaultMin),
      maxRegs: Math.max(1, config.maxRegions || defaultMax),
    };
  }
  return {
    minArea: Math.max(isBwColoring ? 10 : 16, config.minRegionArea || defaultMin),
    maxRegs: Math.max(isBwColoring ? 1600 : 30, config.maxRegions || defaultMax),
  };
}

/**
 * 1. LineArtPuzzleGenerator
 *
 * Specialised for drawings, cartoons, manga, comics, and line illustrations with ink borders.
 * Accurately traces artwork lines and supports:
 *  - ABSORB_LINES: Regions expand to the centerline of artwork lines with 100% boundary fidelity.
 *  - UNIFIED_BLACK_REGION: Long continuous ink borders form a single unified line-art region.
 */
export class LineArtPuzzleGenerator implements PuzzleGenerator {
  generate(
    sourceCanvas: HTMLCanvasElement,
    config: GeneratorConfig,
    onProgress?: ProgressCallback
  ): PuzzleData {
    const ctx =
      sourceCanvas.getContext('2d', { willReadFrequently: true }) ||
      sourceCanvas.getContext('2d')!;
    const imgData = ctx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    return this.generateFromRgba(
      imgData.data,
      sourceCanvas.width,
      sourceCanvas.height,
      config,
      onProgress
    );
  }

  generateFromRgba(
    rgbaData: Uint8ClampedArray,
    srcWidth: number,
    srcHeight: number,
    config: GeneratorConfig,
    onProgress?: ProgressCallback,
    _detailedProgress?: boolean,
    activeMask?: Uint8Array
  ): PuzzleData {
    if (activeMask && !hasAnyActivePixel(activeMask, srcWidth * srcHeight)) {
      return createEmptyPuzzleData(srcWidth, srcHeight, config.isFreeColor === true);
    }

    onProgress?.(0.18, 'Preparing line art canvas...');

    const scaled = activeMask
      ? { data: rgbaData, width: srcWidth, height: srcHeight }
      : scaleRgba(rgbaData, srcWidth, srcHeight, config.resolution || 1024);
    const { data: rawRgba, width, height } = scaled;

    onProgress?.(0.24, 'Detecting and tracing artwork line borders...');
    const { lineMask } = LineArtExtractor.extract(
      rawRgba,
      width,
      height,
      undefined,
      undefined,
      activeMask
    );

    const fakeImgData = { width, height, data: rawRgba } as ImageData;
    const imgAnalysis = ImageAnalyzer.analyze(fakeImgData, activeMask);
    const { isBwColoring, isFreeColorOutput } = resolveColoringBookFlags(
      config,
      imgAnalysis.isBlackAndWhite,
      Boolean(activeMask)
    );

    const lineHandling = config.lineHandling || 'ABSORB_LINES';
    const { palette, effectiveAssignments } = resolveLineArtPaletteAndAssignments(
      rawRgba,
      width,
      height,
      lineMask,
      config,
      isBwColoring,
      lineHandling,
      onProgress,
      activeMask
    );
    if (palette.length === 0) {
      return createEmptyPuzzleData(width, height, isFreeColorOutput);
    }

    const { minArea, maxRegs } = resolveLineArtRegionLimits(
      config,
      isBwColoring,
      Boolean(activeMask)
    );

    const segmentation = RegionSegmenter.segment(
      width,
      height,
      palette,
      effectiveAssignments,
      minArea,
      8,
      2.0,
      lineHandling === 'ABSORB_LINES' ? lineMask : undefined,
      lineHandling,
      isBwColoring ? undefined : rawRgba,
      maxRegs,
      onProgress,
      undefined,
      activeMask
    );

    if (isBwColoring) {
      balanceBwColoringBookRegions(
        segmentation.regions,
        segmentation.regionMap,
        width,
        height,
        rawRgba,
        lineMask,
        palette
      );
    }

    return {
      width,
      height,
      palette,
      regions: segmentation.regions,
      regionMap: segmentation.regionMap,
      borderMap: segmentation.borderMap,
      isFreeColor: isFreeColorOutput,
    };
  }
}

/**
 * 2. PainterlyPuzzleGenerator
 *
 * Specialised for photographs, realistic paintings, and natural scenery.
 * Employs edge-preserving Kuwahara multi-quadrant filtering and perceptual K-Means++
 * to create smooth, cohesive cel-shaded fields.
 */
export class PainterlyPuzzleGenerator implements PuzzleGenerator {
  generate(
    sourceCanvas: HTMLCanvasElement,
    config: GeneratorConfig,
    onProgress?: ProgressCallback
  ): PuzzleData {
    const ctx =
      sourceCanvas.getContext('2d', { willReadFrequently: true }) ||
      sourceCanvas.getContext('2d')!;
    const imgData = ctx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    return this.generateFromRgba(
      imgData.data,
      sourceCanvas.width,
      sourceCanvas.height,
      config,
      onProgress
    );
  }

  generateFromRgba(
    rgbaData: Uint8ClampedArray,
    srcWidth: number,
    srcHeight: number,
    config: GeneratorConfig,
    onProgress?: ProgressCallback,
    _detailedProgress?: boolean,
    activeMask?: Uint8Array
  ): PuzzleData {
    if (activeMask && !hasAnyActivePixel(activeMask, srcWidth * srcHeight)) {
      return createEmptyPuzzleData(srcWidth, srcHeight, config.isFreeColor === true);
    }

    onProgress?.(0.18, 'Preparing photo canvas...');

    const scaled = activeMask
      ? { data: rgbaData, width: srcWidth, height: srcHeight }
      : scaleRgba(rgbaData, srcWidth, srcHeight, config.resolution || 960);
    const { data: rawRgba, width, height } = scaled;

    // 1. Edge-preserving Kuwahara painterly smoothing
    onProgress?.(0.25, 'Applying painterly cel filter...');
    const painterlyRgba = ColorQuantizer.applyKuwaharaFilter(rawRgba, width, height, 2, activeMask);

    // 2. Quantize colors
    const { palette, assignments } = ColorQuantizer.quantize(
      painterlyRgba,
      width,
      height,
      config.colorCount,
      14,
      config.smoothingPasses > 0,
      true,
      onProgress,
      activeMask
    );
    if (palette.length === 0) {
      return createEmptyPuzzleData(width, height, config.isFreeColor === true);
    }

    // 3. Segment regions with strict minArea and maxRegions cap
    const minArea = activeMask
      ? Math.max(1, config.minRegionArea || 48)
      : Math.max(20, config.minRegionArea || 48);
    const maxRegs = activeMask
      ? Math.max(1, config.maxRegions || 200)
      : Math.max(30, config.maxRegions || 200);

    const segmentation = RegionSegmenter.segment(
      width,
      height,
      palette,
      assignments,
      minArea,
      8,
      1.8,
      undefined,
      'ABSORB_LINES',
      rawRgba,
      maxRegs,
      onProgress,
      undefined,
      activeMask
    );

    return {
      width,
      height,
      palette,
      regions: segmentation.regions,
      regionMap: segmentation.regionMap,
      borderMap: segmentation.borderMap,
    };
  }
}

/**
 * 3. PosterizedPuzzleGenerator
 *
 * High-precision color posterization with crisp geometric contours.
 * Ideal for logos, flat graphic art, and vector illustrations without thick ink borders.
 */
export class PosterizedPuzzleGenerator implements PuzzleGenerator {
  generate(
    sourceCanvas: HTMLCanvasElement,
    config: GeneratorConfig,
    onProgress?: ProgressCallback
  ): PuzzleData {
    const ctx =
      sourceCanvas.getContext('2d', { willReadFrequently: true }) ||
      sourceCanvas.getContext('2d')!;
    const imgData = ctx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    return this.generateFromRgba(
      imgData.data,
      sourceCanvas.width,
      sourceCanvas.height,
      config,
      onProgress
    );
  }

  generateFromRgba(
    rgbaData: Uint8ClampedArray,
    srcWidth: number,
    srcHeight: number,
    config: GeneratorConfig,
    onProgress?: ProgressCallback,
    _detailedProgress?: boolean,
    activeMask?: Uint8Array
  ): PuzzleData {
    if (activeMask && !hasAnyActivePixel(activeMask, srcWidth * srcHeight)) {
      return createEmptyPuzzleData(srcWidth, srcHeight, config.isFreeColor === true);
    }

    onProgress?.(0.18, 'Preparing posterized canvas...');

    const scaled = activeMask
      ? { data: rgbaData, width: srcWidth, height: srcHeight }
      : scaleRgba(rgbaData, srcWidth, srcHeight, config.resolution || 1024);
    const { data: rawRgba, width, height } = scaled;

    // 1. Median filter for crisp angular edges
    onProgress?.(0.25, 'Sharpening color boundaries...');
    const denoised =
      activeMask && config.smoothingPasses === 0
        ? rawRgba
        : ColorQuantizer.applyMedianFilter(rawRgba, width, height, activeMask);

    // 2. Quantize with exact centroid convergence
    const { palette, assignments } = ColorQuantizer.quantize(
      denoised,
      width,
      height,
      config.colorCount,
      18,
      false,
      true,
      onProgress,
      activeMask
    );
    if (palette.length === 0) {
      return createEmptyPuzzleData(width, height, config.isFreeColor === true);
    }

    // 3. Segment
    const minArea = activeMask
      ? Math.max(1, config.minRegionArea || 36)
      : Math.max(16, config.minRegionArea || 36);
    const maxRegs = activeMask
      ? Math.max(1, config.maxRegions || 200)
      : Math.max(30, config.maxRegions || 200);

    const segmentation = RegionSegmenter.segment(
      width,
      height,
      palette,
      assignments,
      minArea,
      6,
      2.0,
      undefined,
      'ABSORB_LINES',
      rawRgba,
      maxRegs,
      onProgress,
      undefined,
      activeMask
    );

    return {
      width,
      height,
      palette,
      regions: segmentation.regions,
      regionMap: segmentation.regionMap,
      borderMap: segmentation.borderMap,
    };
  }
}

function computeMosaicStep(
  total: number,
  config: GeneratorConfig,
  effectiveMaxRegs: number,
  activeMask?: Uint8Array
): number {
  if (!activeMask) {
    const targetCellArea = Math.max(
      64,
      (config.minRegionArea || 48) * 2.2,
      Math.floor(total / Math.max(40, Math.round(effectiveMaxRegs * 1.35)))
    );
    const numSeeds = Math.max(24, Math.floor(total / targetCellArea));
    return Math.max(6, Math.floor(Math.sqrt(total / numSeeds)));
  }

  let activeArea = 0;
  const limit = Math.min(total, activeMask.length);
  for (let i = 0; i < limit; i++) {
    if (activeMask[i] === 1) activeArea++;
  }
  const safeArea = Math.max(1, activeArea);
  const targetCellArea = Math.max(
    4,
    (config.minRegionArea || 32) * 1.5,
    Math.floor(safeArea / Math.max(4, Math.round(effectiveMaxRegs * 1.35)))
  );
  const numSeeds = Math.max(4, Math.floor(safeArea / targetCellArea));
  return Math.max(4, Math.floor(Math.sqrt(safeArea / numSeeds)));
}

function findClosestMosaicSeed(
  x: number,
  y: number,
  colorCluster: number,
  pixCol: PaletteColor | undefined,
  palette: PaletteColor[],
  gridCols: number,
  gridRows: number,
  halfStep: number,
  step: number,
  seedX: Int32Array,
  seedY: Int32Array,
  seedCluster: Int32Array,
  colorPenaltyScale: number
): number {
  const centerGy = Math.min(
    gridRows - 1,
    Math.max(0, Math.floor((y - halfStep + step / 2) / step))
  );
  const centerGx = Math.min(
    gridCols - 1,
    Math.max(0, Math.floor((x - halfStep + step / 2) / step))
  );
  const minGy = Math.max(0, centerGy - 2);
  const maxGy = Math.min(gridRows - 1, centerGy + 2);
  const minGx = Math.max(0, centerGx - 2);
  const maxGx = Math.min(gridCols - 1, centerGx + 2);

  let bestDist = Number.MAX_VALUE;
  let bestSeed = centerGy * gridCols + centerGx;

  for (let gy = minGy; gy <= maxGy; gy++) {
    const baseSeed = gy * gridCols;
    for (let gx = minGx; gx <= maxGx; gx++) {
      const s = baseSeed + gx;
      const dx = x - seedX[s];
      const dy = y - seedY[s];
      const spatialDistSq = dx * dx + dy * dy;

      let colorDist = 0;
      const sCluster = seedCluster[s];
      if (sCluster >= 0 && sCluster !== colorCluster && pixCol) {
        const sCol = palette[sCluster] || palette[0];
        const deltaSq = ColorQuantizer.perceptualDistanceSq(
          pixCol.r,
          pixCol.g,
          pixCol.b,
          sCol.r,
          sCol.g,
          sCol.b
        );
        colorDist = (deltaSq / 4096) * colorPenaltyScale;
      }

      const combined = spatialDistSq + colorDist;
      if (combined < bestDist) {
        bestDist = combined;
        bestSeed = s;
      }
    }
  }

  return bestSeed;
}

function buildMosaicCellPartition(
  assignments: Int32Array,
  palette: PaletteColor[],
  width: number,
  height: number,
  config: GeneratorConfig,
  effectiveMaxRegs: number,
  activeMask?: Uint8Array
): { cellSeedMap: Int32Array; cellAssignments: Int32Array } {
  const total = width * height;
  const step = computeMosaicStep(total, config, effectiveMaxRegs, activeMask);
  const halfStep = Math.max(2, Math.floor(step / 2));

  const gridCols = Math.max(1, Math.ceil((width - halfStep) / step));
  const gridRows = Math.max(1, Math.ceil((height - halfStep) / step));
  const actualSeeds = gridCols * gridRows;

  const seedX = new Int32Array(actualSeeds);
  const seedY = new Int32Array(actualSeeds);
  const seedCluster = new Int32Array(actualSeeds);

  let seedCursor = 0;
  for (let gy = 0; gy < gridRows; gy++) {
    const sy = Math.min(height - 1, halfStep + gy * step);
    for (let gx = 0; gx < gridCols; gx++) {
      const sx = Math.min(width - 1, halfStep + gx * step);
      seedX[seedCursor] = sx;
      seedY[seedCursor] = sy;
      seedCluster[seedCursor] = assignments[sy * width + sx];
      seedCursor++;
    }
  }

  const cellSeedMap = new Int32Array(total);
  const colorPenaltyScale = step * step * 1.35;
  const paletteLen = Math.max(1, palette.length);
  const seedClusterVotes = new Int32Array(actualSeeds * paletteLen);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      const idx = rowOffset + x;
      if (activeMask && activeMask[idx] !== 1) {
        cellSeedMap[idx] = -1;
        continue;
      }
      const colorCluster = assignments[idx];
      if (colorCluster < 0 || colorCluster >= paletteLen) {
        cellSeedMap[idx] = -1;
        continue;
      }

      const pixCol = palette[colorCluster] || palette[0];
      const bestSeed = findClosestMosaicSeed(
        x,
        y,
        colorCluster,
        pixCol,
        palette,
        gridCols,
        gridRows,
        halfStep,
        step,
        seedX,
        seedY,
        seedCluster,
        colorPenaltyScale
      );

      cellSeedMap[idx] = bestSeed;
      seedClusterVotes[bestSeed * paletteLen + colorCluster]++;
    }
  }

  const dominantSeedCluster = new Int32Array(actualSeeds);
  for (let s = 0; s < actualSeeds; s++) {
    const voteBase = s * paletteLen;
    let bestC = seedCluster[s] >= 0 ? seedCluster[s] : 0;
    let maxVotes = -1;
    for (let c = 0; c < paletteLen; c++) {
      const v = seedClusterVotes[voteBase + c];
      if (v > maxVotes) {
        maxVotes = v;
        bestC = c;
      }
    }
    dominantSeedCluster[s] = bestC;
  }

  const cellAssignments = new Int32Array(total);
  for (let i = 0; i < total; i++) {
    if ((activeMask && activeMask[i] !== 1) || cellSeedMap[i] < 0) {
      cellAssignments[i] = -1;
    } else {
      cellAssignments[i] = dominantSeedCluster[cellSeedMap[i]];
    }
  }

  return { cellSeedMap, cellAssignments };
}

/**
 * 4. MosaicCelPuzzleGenerator
 *
 * Produces stained-glass or mosaic cellular tessellations with evenly distributed,
 * convex paintable tiles.
 */
export class MosaicCelPuzzleGenerator implements PuzzleGenerator {
  generate(
    sourceCanvas: HTMLCanvasElement,
    config: GeneratorConfig,
    onProgress?: ProgressCallback
  ): PuzzleData {
    const ctx =
      sourceCanvas.getContext('2d', { willReadFrequently: true }) ||
      sourceCanvas.getContext('2d')!;
    const imgData = ctx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    return this.generateFromRgba(
      imgData.data,
      sourceCanvas.width,
      sourceCanvas.height,
      config,
      onProgress
    );
  }

  generateFromRgba(
    rgbaData: Uint8ClampedArray,
    srcWidth: number,
    srcHeight: number,
    config: GeneratorConfig,
    onProgress?: ProgressCallback,
    _detailedProgress?: boolean,
    activeMask?: Uint8Array
  ): PuzzleData {
    if (activeMask && !hasAnyActivePixel(activeMask, srcWidth * srcHeight)) {
      return createEmptyPuzzleData(srcWidth, srcHeight, config.isFreeColor === true);
    }

    onProgress?.(0.18, 'Preparing mosaic canvas...');

    const scaled = activeMask
      ? { data: rgbaData, width: srcWidth, height: srcHeight }
      : scaleRgba(rgbaData, srcWidth, srcHeight, config.resolution || 800);
    const { data: rawRgba, width, height } = scaled;

    // 1. Quantize palette first
    onProgress?.(0.25, 'Creating mosaic palette...');
    const { palette, assignments } = ColorQuantizer.quantize(
      rawRgba,
      width,
      height,
      config.colorCount,
      12,
      true,
      true,
      onProgress,
      activeMask
    );
    if (palette.length === 0) {
      return createEmptyPuzzleData(width, height, config.isFreeColor === true);
    }

    // 2. Seed cellular superpixels (SLIC-like grid + perceptual color affinity)
    onProgress?.(0.63, 'Tessellating mosaic cells...');
    const effectiveMaxRegs = activeMask
      ? Math.max(1, config.maxRegions || 200)
      : Math.max(30, config.maxRegions || 200);
    const { cellSeedMap, cellAssignments } = buildMosaicCellPartition(
      assignments,
      palette,
      width,
      height,
      config,
      effectiveMaxRegs,
      activeMask
    );

    // 3. Segment mosaic cells while preserving distinct cell partitions
    const minArea = activeMask
      ? Math.max(1, config.minRegionArea || 32)
      : Math.max(16, config.minRegionArea || 32);

    const segmentation = RegionSegmenter.segment(
      width,
      height,
      palette,
      cellAssignments,
      minArea,
      6,
      2.2,
      undefined,
      'ABSORB_LINES',
      rawRgba,
      effectiveMaxRegs,
      onProgress,
      cellSeedMap,
      activeMask
    );

    return {
      width,
      height,
      palette,
      regions: segmentation.regions,
      regionMap: segmentation.regionMap,
      borderMap: segmentation.borderMap,
    };
  }
}

interface ResolvedMaskedInput {
  effectiveRgba: Uint8ClampedArray;
  effectiveWidth: number;
  effectiveHeight: number;
  effectiveMask?: Uint8Array;
  isAlphaCutout: boolean;
  analysisProxy: {
    data: Uint8ClampedArray;
    mask?: Uint8Array;
    width: number;
    height: number;
  };
}

function resolveMaskedInputAndProxy(
  rgbaData: Uint8ClampedArray,
  width: number,
  height: number,
  targetRes: number,
  activeMask?: Uint8Array
): ResolvedMaskedInput {
  if (activeMask) {
    return {
      effectiveRgba: rgbaData,
      effectiveWidth: width,
      effectiveHeight: height,
      effectiveMask: activeMask,
      isAlphaCutout: false,
      analysisProxy: scaleRgbaAndMask(rgbaData, activeMask, width, height, 512),
    };
  }

  const proxy = scaleRgba(rgbaData, width, height, 512);
  const proxyAlpha = extractOpaqueAlphaMask(proxy.data, proxy.width, proxy.height);
  if (proxyAlpha.hasCutoutAlpha) {
    const scaled = scaleRgba(rgbaData, width, height, targetRes);
    const targetAlpha = extractOpaqueAlphaMask(scaled.data, scaled.width, scaled.height);
    if (targetAlpha.opaqueCount > 0) {
      return {
        effectiveRgba: scaled.data,
        effectiveWidth: scaled.width,
        effectiveHeight: scaled.height,
        effectiveMask: targetAlpha.opaqueMask,
        isAlphaCutout: true,
        analysisProxy: scaleRgbaAndMask(
          scaled.data,
          targetAlpha.opaqueMask,
          scaled.width,
          scaled.height,
          512
        ),
      };
    }
  }

  return {
    effectiveRgba: rgbaData,
    effectiveWidth: width,
    effectiveHeight: height,
    effectiveMask: undefined,
    isAlphaCutout: false,
    analysisProxy: proxy,
  };
}

function createManualStrategyDelegate(algorithm: GeneratorAlgorithm): {
  delegate: PuzzleGenerator;
  resolvedType: ImageType;
} {
  switch (algorithm) {
    case 'PAINTERLY':
      return { delegate: new PainterlyPuzzleGenerator(), resolvedType: 'PHOTO' };
    case 'POSTERIZED':
      return { delegate: new PosterizedPuzzleGenerator(), resolvedType: 'DRAWING' };
    case 'MOSAIC_CEL':
      return { delegate: new MosaicCelPuzzleGenerator(), resolvedType: 'PHOTO' };
    case 'LINE_ART':
    default:
      return { delegate: new LineArtPuzzleGenerator(), resolvedType: 'DRAWING' };
  }
}

function selectAutoStrategy(
  config: GeneratorConfig,
  isBwColoring: boolean,
  lineAnalysis: LineArtAnalysis,
  imageAnalysis: ImageAnalysisResult
): {
  delegate: PuzzleGenerator;
  resolvedType: ImageType;
  chosenStrategy: string;
  strategyRationale: string;
} {
  if (config.algorithm && config.algorithm !== 'AUTO') {
    const { delegate, resolvedType } = createManualStrategyDelegate(config.algorithm);
    return {
      delegate,
      resolvedType,
      chosenStrategy: config.algorithm,
      strategyRationale: `Manually selected ${config.algorithm.replace('_', ' ')} engine.`,
    };
  }

  if (isBwColoring) {
    return {
      delegate: new LineArtPuzzleGenerator(),
      resolvedType: 'DRAWING',
      chosenStrategy: 'LINE_ART (Coloring Book)',
      strategyRationale:
        'Detected monochrome ink outlines (<8% color saturation). Enabled free-color mode with 20-color artist palette.',
    };
  }

  if (lineAnalysis.isLineArt || config.imageType === 'DRAWING') {
    return {
      delegate: new LineArtPuzzleGenerator(),
      resolvedType: 'DRAWING',
      chosenStrategy: 'LINE_ART',
      strategyRationale: `Detected continuous ink outlines (${(lineAnalysis.lineRatio * 100).toFixed(1)}% stroke coverage). Using centerline border absorption for crisp cartoon contours.`,
    };
  }

  if (imageAnalysis.detectedType === 'PHOTO' || config.imageType === 'PHOTO') {
    return {
      delegate: new PainterlyPuzzleGenerator(),
      resolvedType: 'PHOTO',
      chosenStrategy: 'PAINTERLY',
      strategyRationale: `Detected continuous photographic gradients (${imageAnalysis.colorClusterCount} color clusters). Applying Kuwahara painterly smoothing for organic regions.`,
    };
  }

  return {
    delegate: new PosterizedPuzzleGenerator(),
    resolvedType: 'DRAWING',
    chosenStrategy: 'POSTERIZED',
    strategyRationale: `Detected flat graphic color fields (${imageAnalysis.colorClusterCount} clusters, low local variance). Using median-sharpened posterization.`,
  };
}

function calibrateAutoParams(
  config: GeneratorConfig,
  imageAnalysis: ImageAnalysisResult,
  hasMask: boolean
): { resolvedColors: number; calibratedMinArea: number; calibratedMaxRegions: number } {
  const resolvedColors =
    hasMask && config.paletteDetail === 'CUSTOM'
      ? Math.max(1, Math.min(200, Math.floor(config.colorCount || 16)))
      : imageAnalysis.resolveColorCount(config.paletteDetail, config.colorCount);

  let calibratedMinArea = config.minRegionArea
    ? hasMask
      ? Math.max(1, config.minRegionArea)
      : Math.max(12, config.minRegionArea)
    : 48;
  if (!config.minRegionArea) {
    if (config.paletteDetail === 'LOW') calibratedMinArea = 64;
    else if (config.paletteDetail === 'MEDIUM' || config.paletteDetail === 'AUTO')
      calibratedMinArea = 48;
    else if (config.paletteDetail === 'HIGH') calibratedMinArea = 28;
  }

  let calibratedMaxRegions = config.maxRegions || 200;
  if (!config.maxRegions) {
    if (config.paletteDetail === 'LOW') calibratedMaxRegions = 100;
    else if (config.paletteDetail === 'MEDIUM') calibratedMaxRegions = 200;
    else if (config.paletteDetail === 'HIGH') calibratedMaxRegions = 500;
  }

  return { resolvedColors, calibratedMinArea, calibratedMaxRegions };
}

function populateFinalInspection(
  inspection: GenerationInspectionDetails,
  result: PuzzleData
): void {
  inspection.finalRegionCount = result.regions.length;
  inspection.colorCount = result.palette.length;
  inspection.paletteColors = result.palette.map((p) => ({ r: p.r, g: p.g, b: p.b }));
  if (result.regions.length > 0) {
    let minA = Number.MAX_SAFE_INTEGER;
    let maxA = 0;
    for (const r of result.regions) {
      if (r.area < minA) minA = r.area;
      if (r.area > maxA) maxA = r.area;
    }
    inspection.minActualArea = minA;
    inspection.maxActualArea = maxA;
  }
  const rleBytes = encodeRegionMapRle(result.regionMap).byteLength;
  const actualCompactBytes =
    rleBytes + result.regions.length * 20 + result.palette.length * 48 + 24576;
  inspection.estimatedSaveSizeKb = Math.max(8, Math.round(actualCompactBytes / 1024));
}

/**
 * 5. AutoPuzzleGenerator
 *
 * Intelligently analyzes artwork composition, ink stroke presence, and color variance
 * to automatically route to the optimal strategy and report structured inspection metadata.
 */
export class AutoPuzzleGenerator implements PuzzleGenerator {
  generate(
    sourceCanvas: HTMLCanvasElement,
    config: GeneratorConfig,
    onProgress?: ProgressCallback,
    detailedProgress: boolean = false
  ): PuzzleData {
    const ctx =
      sourceCanvas.getContext('2d', { willReadFrequently: true }) ||
      sourceCanvas.getContext('2d')!;
    const imgData = ctx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    return this.generateFromRgba(
      imgData.data,
      sourceCanvas.width,
      sourceCanvas.height,
      config,
      onProgress,
      detailedProgress
    );
  }

  generateFromRgba(
    rgbaData: Uint8ClampedArray,
    width: number,
    height: number,
    config: GeneratorConfig,
    onProgress?: ProgressCallback,
    detailedProgress: boolean = false,
    activeMask?: Uint8Array
  ): PuzzleData {
    if (activeMask && !hasAnyActivePixel(activeMask, width * height)) {
      return createEmptyPuzzleData(width, height, config.isFreeColor === true);
    }

    const targetRes = config.resolution || 1024;
    let highestProgress = 0.02;
    const inspection: GenerationInspectionDetails = {
      sourceWidth: width,
      sourceHeight: height,
      resolution: targetRes,
      paletteDetail: config.paletteDetail || 'AUTO',
    };

    const emitProgress = (
      rawProgress: number,
      status: string,
      paletteColors?: Array<{ r: number; g: number; b: number }>
    ) => {
      if (rawProgress > highestProgress) {
        highestProgress = rawProgress;
      }
      if (paletteColors && paletteColors.length > 0) {
        inspection.paletteColors = paletteColors;
      }
      const payload = detailedProgress
        ? buildProgressPayload(highestProgress, status, inspection)
        : undefined;
      onProgress?.(highestProgress, status, payload, paletteColors);
    };

    emitProgress(0.04, 'Analyzing artwork style and line composition...');

    const {
      effectiveRgba,
      effectiveWidth,
      effectiveHeight,
      effectiveMask,
      isAlphaCutout,
      analysisProxy,
    } = resolveMaskedInputAndProxy(rgbaData, width, height, targetRes, activeMask);

    const lineAnalysis = LineArtExtractor.extract(
      analysisProxy.data,
      analysisProxy.width,
      analysisProxy.height,
      undefined,
      undefined,
      analysisProxy.mask
    );

    const fakeImgData = {
      width: analysisProxy.width,
      height: analysisProxy.height,
      data: analysisProxy.data,
    } as ImageData;
    const imageAnalysis = ImageAnalyzer.analyze(fakeImgData, analysisProxy.mask);

    const isBwColoring =
      config.isFreeColor === false
        ? false
        : effectiveMask
          ? imageAnalysis.isBlackAndWhite
          : imageAnalysis.isBlackAndWhite || Boolean(config.isFreeColor);
    const isFreeColorOutput =
      config.isFreeColor === false ? false : isBwColoring || Boolean(config.isFreeColor);

    inspection.isLineArt = lineAnalysis.isLineArt;
    inspection.isBlackAndWhite = isBwColoring;
    inspection.edgeRatio = Math.round(imageAnalysis.edgeRatio * 1000) / 10;
    inspection.localVariance = Math.round(imageAnalysis.localVariance);
    inspection.globalVariance = Math.round(imageAnalysis.globalVariance);
    inspection.colorClusterCount = imageAnalysis.colorClusterCount;
    inspection.detectedType = isBwColoring
      ? isAlphaCutout
        ? 'B&W Alpha Cutout'
        : 'B&W Line Coloring'
      : isAlphaCutout
        ? 'Organic Alpha Cutout'
        : lineAnalysis.isLineArt
          ? 'Line Art / Illustration'
          : imageAnalysis.detectedType === 'PHOTO'
            ? 'Photograph / Realism'
            : 'Flat Vector / Graphic';

    const { delegate, resolvedType, chosenStrategy, strategyRationale } = selectAutoStrategy(
      config,
      isBwColoring,
      lineAnalysis,
      imageAnalysis
    );

    const { resolvedColors, calibratedMinArea, calibratedMaxRegions } = calibrateAutoParams(
      config,
      imageAnalysis,
      Boolean(effectiveMask)
    );

    let targetW: number;
    let targetH: number;
    if (effectiveMask) {
      targetW = effectiveWidth;
      targetH = effectiveHeight;
    } else {
      const maxSrc = Math.max(width, height);
      const scale = maxSrc > targetRes ? targetRes / maxSrc : 1.0;
      targetW = Math.max(1, Math.floor(width * scale));
      targetH = Math.max(1, Math.floor(height * scale));
    }

    inspection.targetWidth = targetW;
    inspection.targetHeight = targetH;
    inspection.chosenStrategy = chosenStrategy;
    inspection.strategyRationale = strategyRationale;
    inspection.colorCount = isBwColoring ? 20 : resolvedColors;
    inspection.minRegionArea = calibratedMinArea;
    inspection.maxRegions = calibratedMaxRegions;
    const estimatedCompactBytes = targetH * 70 + calibratedMaxRegions * 20 + 24576;
    inspection.estimatedSaveSizeKb = Math.max(12, Math.round(estimatedCompactBytes / 1024));

    emitProgress(
      0.15,
      `Selected ${chosenStrategy} strategy (${inspection.colorCount} colors, max ${calibratedMaxRegions} regions)...`
    );

    const effectiveConfig: GeneratorConfig = {
      ...config,
      imageType: resolvedType,
      colorCount: resolvedColors,
      minRegionArea: calibratedMinArea,
      maxRegions: calibratedMaxRegions,
      lineHandling: config.lineHandling || 'ABSORB_LINES',
      isFreeColor: isBwColoring,
    };

    const result = delegate.generateFromRgba(
      effectiveRgba,
      effectiveWidth,
      effectiveHeight,
      effectiveConfig,
      (prog, stat, _payload, palCols) => {
        emitProgress(prog, stat, palCols);
      },
      false,
      effectiveMask
    );

    if (isFreeColorOutput) {
      result.isFreeColor = true;
    } else if (config.isFreeColor === false) {
      result.isFreeColor = false;
    }

    populateFinalInspection(inspection, result);
    emitProgress(
      1.0,
      `Generated ${result.regions.length} regions across ${result.palette.length} colors!`
    );

    return result;
  }
}

export class PuzzleGeneratorFactory {
  static create(type: ImageType = 'AUTO'): PuzzleGenerator {
    switch (type) {
      case 'DRAWING':
        return new LineArtPuzzleGenerator();
      case 'PHOTO':
        return new PainterlyPuzzleGenerator();
      case 'AUTO':
      default:
        return new AutoPuzzleGenerator();
    }
  }

  static createByAlgorithm(algorithm: GeneratorAlgorithm = 'AUTO'): PuzzleGenerator {
    switch (algorithm) {
      case 'LINE_ART':
        return new LineArtPuzzleGenerator();
      case 'PAINTERLY':
        return new PainterlyPuzzleGenerator();
      case 'POSTERIZED':
        return new PosterizedPuzzleGenerator();
      case 'MOSAIC_CEL':
        return new MosaicCelPuzzleGenerator();
      case 'AUTO':
      default:
        return new AutoPuzzleGenerator();
    }
  }
}
