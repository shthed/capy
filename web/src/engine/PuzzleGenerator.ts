import { GeneratorAlgorithm, GeneratorConfig, ImageType, PuzzleData } from '../types';
import { ColorQuantizer } from './ColorQuantizer';
import { ImageAnalyzer } from './ImageAnalyzer';
import { LineArtExtractor } from './LineArtExtractor';
import { RegionSegmenter } from './RegionSegmenter';

export interface PuzzleGenerator {
  generate(
    sourceCanvas: HTMLCanvasElement,
    config: GeneratorConfig,
    onProgress?: (progress: number, status: string) => void
  ): PuzzleData;

  generateFromRgba(
    rgbaData: Uint8ClampedArray,
    width: number,
    height: number,
    config: GeneratorConfig,
    onProgress?: (progress: number, status: string) => void
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
    onProgress?: (progress: number, status: string) => void
  ): PuzzleData {
    const ctx = sourceCanvas.getContext('2d')!;
    const imgData = ctx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    return this.generateFromRgba(imgData.data, sourceCanvas.width, sourceCanvas.height, config, onProgress);
  }

  generateFromRgba(
    rgbaData: Uint8ClampedArray,
    srcWidth: number,
    srcHeight: number,
    config: GeneratorConfig,
    onProgress?: (progress: number, status: string) => void
  ): PuzzleData {
    onProgress?.(0.05, 'Preparing line art canvas...');

    const scaled = scaleRgba(rgbaData, srcWidth, srcHeight, config.resolution || 1024);
    const { data: rawRgba, width, height } = scaled;
    const total = width * height;

    // 1. Extract thin drawn ink outlines
    onProgress?.(0.12, 'Detecting and tracing artwork line borders...');
    const { lineMask } = LineArtExtractor.extract(rawRgba, width, height);

    // 2. Denoise with 3x3 median
    onProgress?.(0.2, 'Denoising cel fill areas...');
    const denoised = ColorQuantizer.applyMedianFilter(rawRgba, width, height);

    // 3. Quantize palette colors
    onProgress?.(0.3, 'Quantizing cel palette colors...');
    const { palette, assignments } = ColorQuantizer.quantize(
      denoised,
      width,
      height,
      config.colorCount,
      16,
      true,
      true,
      onProgress
    );

    // If UNIFIED_BLACK_REGION: assign thin line pixels to dedicated black cluster
    const lineHandling = config.lineHandling || 'ABSORB_LINES';
    const effectiveAssignments = new Int32Array(assignments);

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

    // 4. Line-aware segmentation with region color recalibration and strict maxRegions
    const minArea = Math.max(16, config.minRegionArea || 48);
    const maxRegs = Math.max(30, config.maxRegions || 200);

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
    onProgress?: (progress: number, status: string) => void
  ): PuzzleData {
    const ctx = sourceCanvas.getContext('2d')!;
    const imgData = ctx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    return this.generateFromRgba(imgData.data, sourceCanvas.width, sourceCanvas.height, config, onProgress);
  }

  generateFromRgba(
    rgbaData: Uint8ClampedArray,
    srcWidth: number,
    srcHeight: number,
    config: GeneratorConfig,
    onProgress?: (progress: number, status: string) => void
  ): PuzzleData {
    onProgress?.(0.05, 'Preparing photo canvas...');

    const scaled = scaleRgba(rgbaData, srcWidth, srcHeight, config.resolution || 960);
    const { data: rawRgba, width, height } = scaled;

    // 1. Edge-preserving Kuwahara painterly smoothing
    onProgress?.(0.15, 'Applying painterly cel filter...');
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
    onProgress?: (progress: number, status: string) => void
  ): PuzzleData {
    const ctx = sourceCanvas.getContext('2d')!;
    const imgData = ctx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    return this.generateFromRgba(imgData.data, sourceCanvas.width, sourceCanvas.height, config, onProgress);
  }

  generateFromRgba(
    rgbaData: Uint8ClampedArray,
    srcWidth: number,
    srcHeight: number,
    config: GeneratorConfig,
    onProgress?: (progress: number, status: string) => void
  ): PuzzleData {
    onProgress?.(0.05, 'Preparing posterized canvas...');

    const scaled = scaleRgba(rgbaData, srcWidth, srcHeight, config.resolution || 1024);
    const { data: rawRgba, width, height } = scaled;

    // 1. Median filter for crisp angular edges
    onProgress?.(0.15, 'Sharpening color boundaries...');
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
    onProgress?: (progress: number, status: string) => void
  ): PuzzleData {
    const ctx = sourceCanvas.getContext('2d')!;
    const imgData = ctx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    return this.generateFromRgba(imgData.data, sourceCanvas.width, sourceCanvas.height, config, onProgress);
  }

  generateFromRgba(
    rgbaData: Uint8ClampedArray,
    srcWidth: number,
    srcHeight: number,
    config: GeneratorConfig,
    onProgress?: (progress: number, status: string) => void
  ): PuzzleData {
    onProgress?.(0.05, 'Preparing mosaic canvas...');

    const scaled = scaleRgba(rgbaData, srcWidth, srcHeight, config.resolution || 800);
    const { data: rawRgba, width, height } = scaled;
    const total = width * height;

    // 1. Quantize palette first
    onProgress?.(0.2, 'Creating mosaic palette...');
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

    // 2. Seed cellular superpixels
    onProgress?.(0.5, 'Tessellating mosaic cells...');
    const targetCellArea = Math.max(64, (config.minRegionArea || 48) * 2.2);
    const numSeeds = Math.max(20, Math.floor(total / targetCellArea));
    const step = Math.sqrt(total / numSeeds);

    const seedX: number[] = [];
    const seedY: number[] = [];

    for (let y = Math.floor(step / 2); y < height; y += Math.floor(step)) {
      for (let x = Math.floor(step / 2); x < width; x += Math.floor(step)) {
        seedX.push(x);
        seedY.push(y);
      }
    }

    const actualSeeds = seedX.length;

    // Assign pixels to closest spatial-color centroid
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const colorCluster = assignments[idx];

        let bestDist = Number.MAX_VALUE;
        let bestSeed = 0;

        for (let s = 0; s < actualSeeds; s++) {
          const dx = x - seedX[s];
          const dy = y - seedY[s];
          const spatialDistSq = dx * dx + dy * dy;

          if (spatialDistSq > step * step * 4) continue;

          const seedIdx = seedY[s] * width + seedX[s];
          const seedCluster = assignments[seedIdx];
          const colorDist = seedCluster === colorCluster ? 0 : 2500;

          const combined = spatialDistSq + colorDist;
          if (combined < bestDist) {
            bestDist = combined;
            bestSeed = s;
          }
        }
      }
    }

    // 3. Segment mosaic cells
    const minArea = Math.max(16, config.minRegionArea || 32);
    const maxRegs = Math.max(30, config.maxRegions || 200);

    const segmentation = RegionSegmenter.segment(
      width,
      height,
      palette,
      assignments,
      minArea,
      6,
      1.6,
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
 * 5. AutoPuzzleGenerator
 *
 * Intelligently analyzes artwork composition, ink stroke presence, and color variance
 * to automatically route to the optimal strategy.
 */
export class AutoPuzzleGenerator implements PuzzleGenerator {
  generate(
    sourceCanvas: HTMLCanvasElement,
    config: GeneratorConfig,
    onProgress?: (progress: number, status: string) => void
  ): PuzzleData {
    const ctx = sourceCanvas.getContext('2d')!;
    const imgData = ctx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    return this.generateFromRgba(imgData.data, sourceCanvas.width, sourceCanvas.height, config, onProgress);
  }

  generateFromRgba(
    rgbaData: Uint8ClampedArray,
    width: number,
    height: number,
    config: GeneratorConfig,
    onProgress?: (progress: number, status: string) => void
  ): PuzzleData {
    onProgress?.(0.02, 'Analyzing artwork style and line composition...');

    // Check for thin dark ink lines
    const lineAnalysis = LineArtExtractor.extract(rgbaData, width, height);

    // Compute basic image metrics directly from typed array
    const fakeImgData = { width, height, data: rgbaData } as ImageData;
    const imageAnalysis = ImageAnalyzer.analyze(fakeImgData);

    // If explicit algorithm chosen, route directly
    if (config.algorithm && config.algorithm !== 'AUTO') {
      const delegate = PuzzleGeneratorFactory.createByAlgorithm(config.algorithm);
      return delegate.generateFromRgba(rgbaData, width, height, config, onProgress);
    }

    // Auto routing:
    let delegate: PuzzleGenerator;
    let resolvedType: ImageType;

    if (lineAnalysis.isLineArt || config.imageType === 'DRAWING') {
      delegate = new LineArtPuzzleGenerator();
      resolvedType = 'DRAWING';
    } else if (imageAnalysis.detectedType === 'PHOTO' || config.imageType === 'PHOTO') {
      delegate = new PainterlyPuzzleGenerator();
      resolvedType = 'PHOTO';
    } else {
      delegate = new PosterizedPuzzleGenerator();
      resolvedType = 'DRAWING';
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

    const effectiveConfig: GeneratorConfig = {
      ...config,
      imageType: resolvedType,
      colorCount: resolvedColors,
      minRegionArea: calibratedMinArea,
      maxRegions: calibratedMaxRegions,
      lineHandling: config.lineHandling || 'ABSORB_LINES',
    };

    return delegate.generateFromRgba(rgbaData, width, height, effectiveConfig, onProgress);
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
