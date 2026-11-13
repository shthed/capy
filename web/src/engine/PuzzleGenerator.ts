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
} from '../types';
import { encodeRegionMapRle } from '../services/CapyCodec';
import { ColorQuantizer } from './ColorQuantizer';
import { ImageAnalyzer } from './ImageAnalyzer';
import { LineArtExtractor } from './LineArtExtractor';
import { RegionSegmenter } from './RegionSegmenter';

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
    detailedProgress?: boolean
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
  const scale = (srcW > targetDim || srcH > targetDim) ? targetDim / maxSourceDim : 1.0;

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

/**
 * 1. LineArtPuzzleGenerator
 *
 * Specialised for drawings, cartoons, manga, comics, and line illustrations with black borders.
 * Accurately traces artwork lines and supports:
 *  - ABSORB_LINES: Regions expand to the centerline of artwork lines with 100% boundary fidelity.
 *  - UNIFIED_BLACK_REGION: Long continuous black borders form a single unified line-art region.
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
    return this.generateFromRgba(imgData.data, sourceCanvas.width, sourceCanvas.height, config, onProgress);
  }

  generateFromRgba(
    rgbaData: Uint8ClampedArray,
    srcWidth: number,
    srcHeight: number,
    config: GeneratorConfig,
    onProgress?: ProgressCallback
  ): PuzzleData {
    onProgress?.(0.18, 'Preparing line art canvas...');

    const scaled = scaleRgba(rgbaData, srcWidth, srcHeight, config.resolution || 1024);
    const { data: rawRgba, width, height } = scaled;
    const total = width * height;

    // 1. Extract thin drawn ink outlines
    onProgress?.(0.24, 'Detecting and tracing artwork line borders...');
    const { lineMask } = LineArtExtractor.extract(rawRgba, width, height);

    // Check if black and white line art / coloring page
    const fakeImgData = { width, height, data: rawRgba } as ImageData;
    const imgAnalysis = ImageAnalyzer.analyze(fakeImgData);
    const isBwColoring = imgAnalysis.isBlackAndWhite || Boolean(config.isFreeColor);

    let palette: PaletteColor[];
    let effectiveAssignments: Int32Array;

    if (isBwColoring) {
      onProgress?.(0.45, 'Configuring coloring book palette...');
      const coloringPaletteDef = [
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

      palette = coloringPaletteDef.map((c, idx) => ({
        id: idx + 1,
        hex: c.hex,
        isLight: c.isLight,
        argb: (((0xff << 24) | (c.r << 16) | (c.g << 8) | c.b) >>> 0),
        r: c.r,
        g: c.g,
        b: c.b,
      }));

      effectiveAssignments = new Int32Array(total);
      const inkCluster = palette.length - 1;

      for (let i = 0; i < total; i++) {
        if (lineMask[i] === 1) {
          effectiveAssignments[i] = inkCluster;
        } else {
          const idx = i * 4;
          const r = rawRgba[idx];
          const g = rawRgba[idx + 1];
          const b = rawRgba[idx + 2];
          const maxC = Math.max(r, g, b);
          const minC = Math.min(r, g, b);
          if (maxC - minC > 35 && maxC > 50) {
            let bestDist = 999999;
            let bestC = 0;
            for (let c = 0; c < palette.length - 1; c++) {
              const d = ColorQuantizer.perceptualDistanceSq(r, g, b, palette[c].r, palette[c].g, palette[c].b);
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
      }
    } else {
      // 2. Denoise with 3x3 median
      onProgress?.(0.28, 'Denoising cel fill areas...');
      const denoised = ColorQuantizer.applyMedianFilter(rawRgba, width, height);

      // 3. Quantize palette colors
      onProgress?.(0.31, 'Quantizing cel palette colors...');
      const quantized = ColorQuantizer.quantize(
        denoised,
        width,
        height,
        config.colorCount,
        16,
        true,
        true,
        onProgress
      );
      palette = quantized.palette;
      effectiveAssignments = new Int32Array(quantized.assignments);

      // If UNIFIED_BLACK_REGION: assign thin line pixels to dedicated black cluster
      const lineHandling = config.lineHandling || 'ABSORB_LINES';
      if (lineHandling === 'UNIFIED_BLACK_REGION') {
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
          if (lineMask[i] === 1) {
            effectiveAssignments[i] = blackCluster;
          }
        }
      }
    }

    // 4. Line-aware segmentation with region color recalibration and strict maxRegions
    const minArea = isBwColoring
      ? Math.max(10, config.minRegionArea || 12)
      : Math.max(16, config.minRegionArea || 48);
    const maxRegs = isBwColoring
      ? Math.max(1600, config.maxRegions || 800)
      : Math.max(30, config.maxRegions || 200);
    const lineHandling = config.lineHandling || 'ABSORB_LINES';

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
      onProgress
    );

    // If black & white coloring page, balance colors across regions using greedy graph coloring
    if (isBwColoring) {
      const adj = Array.from({ length: segmentation.regions.length + 1 }, () => new Set<number>());
      for (let y = 0; y < height; y++) {
        const row = y * width;
        for (let x = 0; x < width; x++) {
          const idx = row + x;
          const r1 = segmentation.regionMap[idx];
          if (x < width - 1) {
            const r2 = segmentation.regionMap[idx + 1];
            if (r1 !== r2 && r1 > 0 && r2 > 0) {
              adj[r1].add(r2);
              adj[r2].add(r1);
            }
          }
          if (y < height - 1) {
            const r3 = segmentation.regionMap[idx + width];
            if (r1 !== r3 && r1 > 0 && r3 > 0) {
              adj[r1].add(r3);
              adj[r3].add(r1);
            }
          }
        }
      }

      const numColors = palette.length - 1; // keep last color (dark ink) for outlines if needed
      const colorUsage = new Int32Array(numColors + 1);
      const lockedSourceColor = new Uint8Array(segmentation.regions.length + 1);

      // Pass 1: Lock regions that had an explicit chromatic fill in the source image (> 25% non-white/chromatic interior pixels)
      for (let r = 1; r <= segmentation.regions.length; r++) {
        const reg = segmentation.regions[r - 1];
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

      // Pass 2: Greedy graph coloring for remaining blank B&W regions
      for (let r = 1; r <= segmentation.regions.length; r++) {
        if (lockedSourceColor[r] === 1) continue;
        const reg = segmentation.regions[r - 1];
        if (!reg) continue;

        const used = new Set<number>();
        for (const n of adj[r]) {
          const nc = segmentation.regions[n - 1]?.colorId;
          if (nc && nc > 0) used.add(nc);
        }

        let bestC = 1;
        let minUsage = 999999;
        for (let c = 1; c <= numColors; c++) {
          if (!used.has(c)) {
            if (colorUsage[c] < minUsage) {
              minUsage = colorUsage[c];
              bestC = c;
            }
          }
        }
        if (minUsage === 999999) {
          bestC = (r % numColors) + 1;
        }
        reg.colorId = bestC;
        colorUsage[bestC]++;
      }
    }

    return {
      width,
      height,
      palette,
      regions: segmentation.regions,
      regionMap: segmentation.regionMap,
      borderMap: segmentation.borderMap,
      isFreeColor: isBwColoring,
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
    return this.generateFromRgba(imgData.data, sourceCanvas.width, sourceCanvas.height, config, onProgress);
  }

  generateFromRgba(
    rgbaData: Uint8ClampedArray,
    srcWidth: number,
    srcHeight: number,
    config: GeneratorConfig,
    onProgress?: ProgressCallback
  ): PuzzleData {
    onProgress?.(0.18, 'Preparing photo canvas...');

    const scaled = scaleRgba(rgbaData, srcWidth, srcHeight, config.resolution || 960);
    const { data: rawRgba, width, height } = scaled;

    // 1. Edge-preserving Kuwahara painterly smoothing
    onProgress?.(0.25, 'Applying painterly cel filter...');
    const painterlyRgba = ColorQuantizer.applyKuwaharaFilter(rawRgba, width, height, 2);

    // 2. Quantize colors
    const { palette, assignments } = ColorQuantizer.quantize(
      painterlyRgba,
      width,
      height,
      config.colorCount,
      14,
      config.smoothingPasses > 0,
      true,
      onProgress
    );

    // 3. Segment regions with strict minArea and maxRegions cap
    const minArea = Math.max(20, config.minRegionArea || 48);
    const maxRegs = Math.max(30, config.maxRegions || 200);

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
      onProgress
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
    return this.generateFromRgba(imgData.data, sourceCanvas.width, sourceCanvas.height, config, onProgress);
  }

  generateFromRgba(
    rgbaData: Uint8ClampedArray,
    srcWidth: number,
    srcHeight: number,
    config: GeneratorConfig,
    onProgress?: ProgressCallback
  ): PuzzleData {
    onProgress?.(0.18, 'Preparing posterized canvas...');

    const scaled = scaleRgba(rgbaData, srcWidth, srcHeight, config.resolution || 1024);
    const { data: rawRgba, width, height } = scaled;

    // 1. Median filter for crisp angular edges
    onProgress?.(0.25, 'Sharpening color boundaries...');
    const denoised = ColorQuantizer.applyMedianFilter(rawRgba, width, height);

    // 2. Quantize with exact centroid convergence
    const { palette, assignments } = ColorQuantizer.quantize(
      denoised,
      width,
      height,
      config.colorCount,
      18,
      false,
      true,
      onProgress
    );

    // 3. Segment
    const minArea = Math.max(16, config.minRegionArea || 36);
    const maxRegs = Math.max(30, config.maxRegions || 200);

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
      onProgress
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
    return this.generateFromRgba(imgData.data, sourceCanvas.width, sourceCanvas.height, config, onProgress);
  }

  generateFromRgba(
    rgbaData: Uint8ClampedArray,
    srcWidth: number,
    srcHeight: number,
    config: GeneratorConfig,
    onProgress?: ProgressCallback
  ): PuzzleData {
    onProgress?.(0.18, 'Preparing mosaic canvas...');

    const scaled = scaleRgba(rgbaData, srcWidth, srcHeight, config.resolution || 800);
    const { data: rawRgba, width, height } = scaled;
    const total = width * height;

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
      onProgress
    );

    // 2. Seed cellular superpixels (SLIC-like grid + perceptual color affinity)
    onProgress?.(0.63, 'Tessellating mosaic cells...');
    const effectiveMaxRegs = Math.max(30, config.maxRegions || 200);
    const targetCellArea = Math.max(
      64,
      (config.minRegionArea || 48) * 2.2,
      Math.floor(total / Math.max(40, Math.round(effectiveMaxRegs * 1.35)))
    );
    const numSeeds = Math.max(24, Math.floor(total / targetCellArea));
    const step = Math.max(6, Math.floor(Math.sqrt(total / numSeeds)));
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

    // Assign pixels to closest spatial-color centroid using a fast 5x5 local grid search
    const cellSeedMap = new Int32Array(total);
    const colorPenaltyScale = step * step * 1.35;
    const paletteLen = Math.max(1, palette.length);
    const seedClusterVotes = new Int32Array(actualSeeds * paletteLen);

    for (let y = 0; y < height; y++) {
      const centerGy = Math.min(gridRows - 1, Math.max(0, Math.floor((y - halfStep + step / 2) / step)));
      const minGy = Math.max(0, centerGy - 2);
      const maxGy = Math.min(gridRows - 1, centerGy + 2);
      const rowOffset = y * width;

      for (let x = 0; x < width; x++) {
        const idx = rowOffset + x;
        const colorCluster = assignments[idx];
        const pixCol = palette[colorCluster] || palette[0];

        const centerGx = Math.min(gridCols - 1, Math.max(0, Math.floor((x - halfStep + step / 2) / step)));
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
            if (sCluster !== colorCluster && pixCol) {
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

        cellSeedMap[idx] = bestSeed;
        seedClusterVotes[bestSeed * paletteLen + colorCluster]++;
      }
    }

    // Assign each mosaic cell its dominant palette cluster so every cell is internally uniform
    const dominantSeedCluster = new Int32Array(actualSeeds);
    for (let s = 0; s < actualSeeds; s++) {
      const voteBase = s * paletteLen;
      let bestC = seedCluster[s];
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
      cellAssignments[i] = dominantSeedCluster[cellSeedMap[i]];
    }

    // 3. Segment mosaic cells while preserving distinct cell partitions
    const minArea = Math.max(16, config.minRegionArea || 32);

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
      cellSeedMap
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
    detailedProgress: boolean = false
  ): PuzzleData {
    let highestProgress = 0.02;
    const inspection: GenerationInspectionDetails = {
      sourceWidth: width,
      sourceHeight: height,
      resolution: config.resolution || 1024,
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

    // Downsample oversized inputs to a fast <= 512px proxy for style and ink detection
    const proxy = scaleRgba(rgbaData, width, height, 512);
    const lineAnalysis = LineArtExtractor.extract(proxy.data, proxy.width, proxy.height);

    const fakeImgData = { width: proxy.width, height: proxy.height, data: proxy.data } as ImageData;
    const imageAnalysis = ImageAnalyzer.analyze(fakeImgData);
    const isBw = imageAnalysis.isBlackAndWhite || Boolean(config.isFreeColor);

    inspection.isLineArt = lineAnalysis.isLineArt;
    inspection.isBlackAndWhite = isBw;
    inspection.edgeRatio = Math.round(imageAnalysis.edgeRatio * 1000) / 10;
    inspection.localVariance = Math.round(imageAnalysis.localVariance);
    inspection.globalVariance = Math.round(imageAnalysis.globalVariance);
    inspection.colorClusterCount = imageAnalysis.colorClusterCount;
    inspection.detectedType = isBw
      ? 'B&W Line Coloring'
      : lineAnalysis.isLineArt
        ? 'Line Art / Illustration'
        : imageAnalysis.detectedType === 'PHOTO'
          ? 'Photograph / Realism'
          : 'Flat Vector / Graphic';

    // Determine target strategy and rationale
    let delegate: PuzzleGenerator;
    let resolvedType: ImageType;
    let chosenStrategy: string;
    let strategyRationale: string;

    if (config.algorithm && config.algorithm !== 'AUTO') {
      chosenStrategy = config.algorithm;
      strategyRationale = `Manually selected ${config.algorithm.replace('_', ' ')} engine.`;
      switch (config.algorithm) {
        case 'LINE_ART':
          delegate = new LineArtPuzzleGenerator();
          resolvedType = 'DRAWING';
          break;
        case 'PAINTERLY':
          delegate = new PainterlyPuzzleGenerator();
          resolvedType = 'PHOTO';
          break;
        case 'POSTERIZED':
          delegate = new PosterizedPuzzleGenerator();
          resolvedType = 'DRAWING';
          break;
        case 'MOSAIC_CEL':
          delegate = new MosaicCelPuzzleGenerator();
          resolvedType = 'PHOTO';
          break;
        default:
          delegate = new LineArtPuzzleGenerator();
          resolvedType = 'DRAWING';
      }
    } else if (isBw) {
      delegate = new LineArtPuzzleGenerator();
      resolvedType = 'DRAWING';
      chosenStrategy = 'LINE_ART (Coloring Book)';
      strategyRationale = 'Detected monochrome ink outlines (<8% color saturation). Enabled free-color mode with 20-color artist palette.';
    } else if (lineAnalysis.isLineArt || config.imageType === 'DRAWING') {
      delegate = new LineArtPuzzleGenerator();
      resolvedType = 'DRAWING';
      chosenStrategy = 'LINE_ART';
      strategyRationale = `Detected continuous ink outlines (${(lineAnalysis.lineRatio * 100).toFixed(1)}% stroke coverage). Using centerline border absorption for crisp cartoon contours.`;
    } else if (imageAnalysis.detectedType === 'PHOTO' || config.imageType === 'PHOTO') {
      delegate = new PainterlyPuzzleGenerator();
      resolvedType = 'PHOTO';
      chosenStrategy = 'PAINTERLY';
      strategyRationale = `Detected continuous photographic gradients (${imageAnalysis.colorClusterCount} color clusters). Applying Kuwahara painterly smoothing for organic regions.`;
    } else {
      delegate = new PosterizedPuzzleGenerator();
      resolvedType = 'DRAWING';
      chosenStrategy = 'POSTERIZED';
      strategyRationale = `Detected flat graphic color fields (${imageAnalysis.colorClusterCount} clusters, low local variance). Using median-sharpened posterization.`;
    }

    const resolvedColors = imageAnalysis.resolveColorCount(config.paletteDetail, config.colorCount);

    let calibratedMinArea = config.minRegionArea || 48;
    if (config.paletteDetail === 'LOW') {
      calibratedMinArea = Math.max(64, config.minRegionArea || 64);
    } else if (config.paletteDetail === 'MEDIUM' || config.paletteDetail === 'AUTO') {
      calibratedMinArea = Math.max(40, config.minRegionArea || 48);
    } else if (config.paletteDetail === 'HIGH') {
      calibratedMinArea = Math.max(20, config.minRegionArea || 28);
    }

    let calibratedMaxRegions = config.maxRegions || 200;
    if (!config.maxRegions) {
      if (config.paletteDetail === 'LOW') {
        calibratedMaxRegions = 100;
      } else if (config.paletteDetail === 'MEDIUM') {
        calibratedMaxRegions = 200;
      } else if (config.paletteDetail === 'HIGH') {
        calibratedMaxRegions = 500;
      }
    }

    const targetRes = config.resolution || 1024;
    const maxSrc = Math.max(width, height);
    const scale = maxSrc > targetRes ? targetRes / maxSrc : 1.0;
    const targetW = Math.max(1, Math.floor(width * scale));
    const targetH = Math.max(1, Math.floor(height * scale));

    inspection.targetWidth = targetW;
    inspection.targetHeight = targetH;
    inspection.chosenStrategy = chosenStrategy;
    inspection.strategyRationale = strategyRationale;
    inspection.colorCount = isBw ? 20 : resolvedColors;
    inspection.minRegionArea = calibratedMinArea;
    inspection.maxRegions = calibratedMaxRegions;
    // Initial Compact v2 estimate: ~70 bytes/scanline RLE + 20B/region metadata + ~24KB preview thumbnail
    const estimatedCompactBytes = targetH * 70 + calibratedMaxRegions * 20 + 24576;
    inspection.estimatedSaveSizeKb = Math.max(12, Math.round(estimatedCompactBytes / 1024));

    emitProgress(0.15, `Selected ${chosenStrategy} strategy (${inspection.colorCount} colors, max ${calibratedMaxRegions} regions)...`);

    const effectiveConfig: GeneratorConfig = {
      ...config,
      imageType: resolvedType,
      colorCount: resolvedColors,
      minRegionArea: calibratedMinArea,
      maxRegions: calibratedMaxRegions,
      lineHandling: config.lineHandling || 'ABSORB_LINES',
      isFreeColor: isBw,
    };

    const result = delegate.generateFromRgba(
      rgbaData,
      width,
      height,
      effectiveConfig,
      (prog, stat, _payload, palCols) => {
        emitProgress(prog, stat, palCols);
      }
    );

    // Update final inspection stats with actual generated values
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

    emitProgress(1.0, `Generated ${result.regions.length} regions across ${result.palette.length} colors!`);

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
