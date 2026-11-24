import { ImageType, PaletteDetail } from '../types';

export interface ImageAnalysisResult {
  detectedType: ImageType;
  isBlackAndWhite: boolean;
  edgeRatio: number;
  localVariance: number;
  globalVariance: number;
  colorClusterCount: number;
  recommendedColors: Record<PaletteDetail, number>;
  resolveColorCount: (detail: PaletteDetail, requestedColors: number) => number;
}

interface SampledImageStats {
  sampleCount: number;
  colorClusterCount: number;
  globalVariance: number;
  edgeRatio: number;
  localVariance: number;
  coloredRatio: number;
}

export class ImageAnalyzer {
  private static isFull3x3Active(mask: Uint8Array, idx: number, w: number): boolean {
    const prevRow = idx - w;
    const nextRow = idx + w;
    return (
      mask[prevRow - 1] === 1 &&
      mask[prevRow] === 1 &&
      mask[prevRow + 1] === 1 &&
      mask[idx - 1] === 1 &&
      mask[idx] === 1 &&
      mask[idx + 1] === 1 &&
      mask[nextRow - 1] === 1 &&
      mask[nextRow] === 1 &&
      mask[nextRow + 1] === 1
    );
  }

  private static computeEdgeAndLocalVariance(
    lum: Int32Array,
    sampleW: number,
    sampleH: number,
    sampleMask?: Uint8Array
  ): { edgeRatio: number; localVariance: number } {
    let edgeCount = 0;
    let localVarSum = 0;
    let evaluatedPatches = 0;
    const thresholdEdge = 48;

    for (let y = 1; y < sampleH - 1; y++) {
      const row = y * sampleW;
      for (let x = 1; x < sampleW - 1; x++) {
        const idx = row + x;
        if (sampleMask && !this.isFull3x3Active(sampleMask, idx, sampleW)) {
          continue;
        }

        const n0 = lum[idx - sampleW - 1];
        const n1 = lum[idx - sampleW];
        const n2 = lum[idx - sampleW + 1];
        const n3 = lum[idx - 1];
        const n4 = lum[idx];
        const n5 = lum[idx + 1];
        const n6 = lum[idx + sampleW - 1];
        const n7 = lum[idx + sampleW];
        const n8 = lum[idx + sampleW + 1];

        const gx = n2 + 2 * n5 + n8 - (n0 + 2 * n3 + n6);
        const gy = n6 + 2 * n7 + n8 - (n0 + 2 * n1 + n2);
        if (Math.abs(gx) + Math.abs(gy) > thresholdEdge) {
          edgeCount++;
        }

        const patchAvg = (n0 + n1 + n2 + n3 + n4 + n5 + n6 + n7 + n8) / 9.0;
        const pVar =
          (n0 - patchAvg) ** 2 +
          (n1 - patchAvg) ** 2 +
          (n2 - patchAvg) ** 2 +
          (n3 - patchAvg) ** 2 +
          (n4 - patchAvg) ** 2 +
          (n5 - patchAvg) ** 2 +
          (n6 - patchAvg) ** 2 +
          (n7 - patchAvg) ** 2 +
          (n8 - patchAvg) ** 2;
        localVarSum += pVar / 9.0;
        evaluatedPatches++;
      }
    }

    return {
      edgeRatio: edgeCount / Math.max(1, evaluatedPatches),
      localVariance: localVarSum / Math.max(1, evaluatedPatches),
    };
  }

  private static computeMaskedNativeFallbackStats(
    data: Uint8ClampedArray,
    srcW: number,
    srcH: number,
    activeMask: Uint8Array
  ): SampledImageStats {
    const total = Math.min(srcW * srcH, activeMask.length, Math.floor(data.length / 4));
    const colorHistogram = new Int32Array(32768);
    let sampleCount = 0;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let coloredPixels = 0;

    for (let i = 0; i < total; i++) {
      if (activeMask[i] !== 1) continue;
      const off = i * 4;
      const r = data[off];
      const g = data[off + 1];
      const b = data[off + 2];
      sampleCount++;
      sumR += r;
      sumG += g;
      sumB += b;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 28) {
        coloredPixels++;
      }
      colorHistogram[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)]++;
    }

    if (sampleCount === 0) {
      return {
        sampleCount: 0,
        colorClusterCount: 0,
        globalVariance: 0,
        edgeRatio: 0,
        localVariance: 0,
        coloredRatio: 0,
      };
    }

    const minClusterPixels = Math.max(1, Math.floor(sampleCount * 0.0005));
    let colorClusterCount = 0;
    for (let i = 0; i < 32768; i++) {
      if (colorHistogram[i] >= minClusterPixels) colorClusterCount++;
    }

    const avgR = sumR / sampleCount;
    const avgG = sumG / sampleCount;
    const avgB = sumB / sampleCount;
    let globalVarSum = 0;
    for (let i = 0; i < total; i++) {
      if (activeMask[i] !== 1) continue;
      const off = i * 4;
      const dr = data[off] - avgR;
      const dg = data[off + 1] - avgG;
      const db = data[off + 2] - avgB;
      globalVarSum += dr * dr + dg * dg + db * db;
    }

    return {
      sampleCount,
      colorClusterCount,
      globalVariance: globalVarSum / sampleCount,
      edgeRatio: 0,
      localVariance: 0,
      coloredRatio: coloredPixels / sampleCount,
    };
  }

  private static sampleImageStats(
    data: Uint8ClampedArray,
    srcW: number,
    srcH: number,
    activeMask?: Uint8Array
  ): SampledImageStats {
    const sampleDim = 128;
    const scale = Math.min(1.0, sampleDim / Math.max(1, Math.max(srcW, srcH)));
    const sampleW = Math.max(8, Math.floor(srcW * scale));
    const sampleH = Math.max(8, Math.floor(srcH * scale));

    const totalPixels = sampleW * sampleH;
    const lum = new Int32Array(totalPixels);
    const rArr = new Uint8Array(totalPixels);
    const gArr = new Uint8Array(totalPixels);
    const bArr = new Uint8Array(totalPixels);
    const sampleMask = activeMask ? new Uint8Array(totalPixels) : undefined;
    const colorHistogram = new Int32Array(32768);

    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let activeCount = 0;
    let coloredPixels = 0;

    for (let y = 0; y < sampleH; y++) {
      const srcY = Math.min(srcH - 1, Math.floor(y / scale));
      const rowOffset = y * sampleW;
      const srcRowPixelOffset = srcY * srcW;

      for (let x = 0; x < sampleW; x++) {
        const srcX = Math.min(srcW - 1, Math.floor(x / scale));
        const srcPixelIdx = srcRowPixelOffset + srcX;
        const i = rowOffset + x;

        if (activeMask) {
          if (srcPixelIdx >= activeMask.length || activeMask[srcPixelIdx] !== 1) {
            continue;
          }
          sampleMask![i] = 1;
          activeCount++;
        }

        const srcIdx = srcPixelIdx * 4;
        const r = data[srcIdx];
        const g = data[srcIdx + 1];
        const b = data[srcIdx + 2];

        rArr[i] = r;
        gArr[i] = g;
        bArr[i] = b;
        lum[i] = Math.floor(0.299 * r + 0.587 * g + 0.114 * b);
        sumR += r;
        sumG += g;
        sumB += b;

        if (Math.max(r, g, b) - Math.min(r, g, b) > 28) {
          coloredPixels++;
        }

        colorHistogram[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)]++;
      }
    }

    if (activeMask && activeCount === 0) {
      return this.computeMaskedNativeFallbackStats(data, srcW, srcH, activeMask);
    }

    const sampleCount = activeMask ? activeCount : totalPixels;
    const minClusterPixels = Math.max(1, Math.floor(sampleCount * 0.0005));
    let colorClusterCount = 0;
    for (let i = 0; i < 32768; i++) {
      if (colorHistogram[i] >= minClusterPixels) {
        colorClusterCount++;
      }
    }

    const avgR = sumR / sampleCount;
    const avgG = sumG / sampleCount;
    const avgB = sumB / sampleCount;

    let globalVarSum = 0;
    for (let i = 0; i < totalPixels; i++) {
      if (sampleMask && sampleMask[i] !== 1) continue;
      const dr = rArr[i] - avgR;
      const dg = gArr[i] - avgG;
      const db = bArr[i] - avgB;
      globalVarSum += dr * dr + dg * dg + db * db;
    }

    const { edgeRatio, localVariance } = this.computeEdgeAndLocalVariance(
      lum,
      sampleW,
      sampleH,
      sampleMask
    );

    return {
      sampleCount,
      colorClusterCount,
      globalVariance: globalVarSum / sampleCount,
      edgeRatio,
      localVariance,
      coloredRatio: coloredPixels / sampleCount,
    };
  }

  private static buildRecommendedColors(
    detectedType: ImageType,
    colorClusterCount: number
  ): Record<PaletteDetail, number> {
    let lowColors: number;
    let medColors: number;
    let highColors: number;

    if (detectedType === 'DRAWING') {
      lowColors = Math.min(12, Math.max(6, Math.floor(colorClusterCount * 0.5)));
      medColors = Math.min(22, Math.max(12, Math.floor(colorClusterCount * 0.85)));
      highColors = Math.min(36, Math.max(20, Math.floor(colorClusterCount * 1.3)));
    } else {
      lowColors = Math.min(16, Math.max(10, Math.floor(colorClusterCount * 0.45)));
      medColors = Math.min(28, Math.max(16, Math.floor(colorClusterCount * 0.75)));
      highColors = Math.min(56, Math.max(28, Math.floor(colorClusterCount * 1.25)));
    }

    return {
      LOW: lowColors,
      MEDIUM: medColors,
      HIGH: highColors,
      AUTO: medColors,
      CUSTOM: medColors,
    };
  }

  static analyze(imageData: ImageData, activeMask?: Uint8Array): ImageAnalysisResult {
    const { width: srcW, height: srcH, data } = imageData;
    const stats =
      srcW > 0 && srcH > 0
        ? this.sampleImageStats(data, srcW, srcH, activeMask)
        : {
            sampleCount: 0,
            colorClusterCount: 0,
            globalVariance: 0,
            edgeRatio: 0,
            localVariance: 0,
            coloredRatio: 0,
          };

    if (stats.sampleCount === 0) {
      const recommendedMap = this.buildRecommendedColors('DRAWING', 0);
      return {
        detectedType: 'DRAWING',
        isBlackAndWhite: false,
        edgeRatio: 0,
        localVariance: 0,
        globalVariance: 0,
        colorClusterCount: 0,
        recommendedColors: recommendedMap,
        resolveColorCount(detail: PaletteDetail, requestedColors: number): number {
          if (detail === 'CUSTOM') return Math.min(200, Math.max(4, requestedColors));
          return recommendedMap[detail] ?? 18;
        },
      };
    }

    const { colorClusterCount, globalVariance, edgeRatio, localVariance, coloredRatio } = stats;
    const isBlackAndWhite = coloredRatio < 0.08;
    const varRatio = globalVariance > 1 ? localVariance / globalVariance : 1;
    const isDrawing =
      isBlackAndWhite ||
      (edgeRatio > 0.08 && varRatio < 0.22) ||
      (colorClusterCount < 28 && edgeRatio > 0.05) ||
      colorClusterCount < 18;

    const detectedType: ImageType = isDrawing ? 'DRAWING' : 'PHOTO';
    const recommendedMap = this.buildRecommendedColors(detectedType, colorClusterCount);

    return {
      detectedType,
      isBlackAndWhite,
      edgeRatio,
      localVariance,
      globalVariance,
      colorClusterCount,
      recommendedColors: recommendedMap,
      resolveColorCount(detail: PaletteDetail, requestedColors: number): number {
        if (detail === 'CUSTOM') return Math.min(200, Math.max(4, requestedColors));
        return recommendedMap[detail] ?? 18;
      },
    };
  }
}
