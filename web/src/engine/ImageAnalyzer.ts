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

export class ImageAnalyzer {
  static analyze(imageData: ImageData): ImageAnalysisResult {
    const { width: srcW, height: srcH, data } = imageData;
    const sampleDim = 128;
    const scale = Math.min(1.0, sampleDim / Math.max(srcW, srcH));
    const sampleW = Math.max(8, Math.floor(srcW * scale));
    const sampleH = Math.max(8, Math.floor(srcH * scale));

    const totalPixels = sampleW * sampleH;
    const lum = new Int32Array(totalPixels);
    const rArr = new Uint8Array(totalPixels);
    const gArr = new Uint8Array(totalPixels);
    const bArr = new Uint8Array(totalPixels);

    let sumR = 0;
    let sumG = 0;
    let sumB = 0;

    const colorHistogram = new Int32Array(32768); // 32x32x32

    // Bilinear or nearest sampling to sampleW x sampleH
    for (let y = 0; y < sampleH; y++) {
      const srcY = Math.min(srcH - 1, Math.floor(y / scale));
      const rowOffset = y * sampleW;
      const srcRowOffset = srcY * srcW * 4;

      for (let x = 0; x < sampleW; x++) {
        const srcX = Math.min(srcW - 1, Math.floor(x / scale));
        const srcIdx = srcRowOffset + srcX * 4;
        const i = rowOffset + x;

        const r = data[srcIdx];
        const g = data[srcIdx + 1];
        const b = data[srcIdx + 2];

        rArr[i] = r;
        gArr[i] = g;
        bArr[i] = b;

        const l = Math.floor(0.299 * r + 0.587 * g + 0.114 * b);
        lum[i] = l;
        sumR += r;
        sumG += g;
        sumB += b;

        const r5 = r >> 3;
        const g5 = g >> 3;
        const b5 = b >> 3;
        const key = (r5 << 10) | (g5 << 5) | b5;
        colorHistogram[key]++;
      }
    }

    // Count unique color buckets with > 0.05% pixel presence
    const minClusterPixels = Math.max(1, Math.floor(totalPixels * 0.0005));
    let colorClusterCount = 0;
    for (let i = 0; i < 32768; i++) {
      if (colorHistogram[i] >= minClusterPixels) {
        colorClusterCount++;
      }
    }

    // Global variance
    const avgR = sumR / totalPixels;
    const avgG = sumG / totalPixels;
    const avgB = sumB / totalPixels;

    let globalVarSum = 0;
    for (let i = 0; i < totalPixels; i++) {
      const dr = rArr[i] - avgR;
      const dg = gArr[i] - avgG;
      const db = bArr[i] - avgB;
      globalVarSum += dr * dr + dg * dg + db * db;
    }
    const globalVariance = globalVarSum / totalPixels;

    // Sobel edge & local patch variance
    let edgeCount = 0;
    let localVarSum = 0;
    let evaluatedPatches = 0;
    const thresholdEdge = 48;

    for (let y = 1; y < sampleH - 1; y++) {
      const row = y * sampleW;
      for (let x = 1; x < sampleW - 1; x++) {
        const idx = row + x;

        // Sobel
        const gx =
          lum[idx - sampleW + 1] + 2 * lum[idx + 1] + lum[idx + sampleW + 1] -
          (lum[idx - sampleW - 1] + 2 * lum[idx - 1] + lum[idx + sampleW - 1]);
        const gy =
          lum[idx + sampleW - 1] + 2 * lum[idx + sampleW] + lum[idx + sampleW + 1] -
          (lum[idx - sampleW - 1] + 2 * lum[idx - sampleW] + lum[idx - sampleW + 1]);

        const mag = Math.abs(gx) + Math.abs(gy);
        if (mag > thresholdEdge) {
          edgeCount++;
        }

        // 3x3 patch variance
        let patchSum = 0;
        const n0 = lum[idx - sampleW - 1], n1 = lum[idx - sampleW], n2 = lum[idx - sampleW + 1];
        const n3 = lum[idx - 1], n4 = lum[idx], n5 = lum[idx + 1];
        const n6 = lum[idx + sampleW - 1], n7 = lum[idx + sampleW], n8 = lum[idx + sampleW + 1];
        patchSum = n0 + n1 + n2 + n3 + n4 + n5 + n6 + n7 + n8;
        const patchAvg = patchSum / 9.0;

        const pVar =
          (n0 - patchAvg) ** 2 + (n1 - patchAvg) ** 2 + (n2 - patchAvg) ** 2 +
          (n3 - patchAvg) ** 2 + (n4 - patchAvg) ** 2 + (n5 - patchAvg) ** 2 +
          (n6 - patchAvg) ** 2 + (n7 - patchAvg) ** 2 + (n8 - patchAvg) ** 2;
        localVarSum += pVar / 9.0;
        evaluatedPatches++;
      }
    }

    // Calculate saturation/chroma across sample
    let coloredPixels = 0;
    for (let i = 0; i < totalPixels; i++) {
      const r = rArr[i];
      const g = gArr[i];
      const b = bArr[i];
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      if (maxC - minC > 28) {
        coloredPixels++;
      }
    }
    const coloredRatio = coloredPixels / totalPixels;
    const isBlackAndWhite = coloredRatio < 0.08;

    const edgeRatio = edgeCount / Math.max(1, evaluatedPatches);
    const localVariance = localVarSum / Math.max(1, evaluatedPatches);

    const varRatio = globalVariance > 1 ? localVariance / globalVariance : 1;
    const isDrawing =
      isBlackAndWhite ||
      (edgeRatio > 0.08 && varRatio < 0.22) ||
      (colorClusterCount < 28 && edgeRatio > 0.05) ||
      colorClusterCount < 18;

    const detectedType: ImageType = isDrawing ? 'DRAWING' : 'PHOTO';

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

    const recommendedMap: Record<PaletteDetail, number> = {
      LOW: lowColors,
      MEDIUM: medColors,
      HIGH: highColors,
      AUTO: medColors,
      CUSTOM: medColors,
    };

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
