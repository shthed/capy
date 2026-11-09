import { GenerationProgressPayload, PaletteColor } from '../types';

export class ColorQuantizer {
  /**
   * Perceptual color distance approximation (Red-Mean metric).
   * Matches human perception much closer than Euclidean RGB distance.
   */
  static perceptualDistanceSq(
    r1: number,
    g1: number,
    b1: number,
    r2: number,
    g2: number,
    b2: number
  ): number {
    const rMean = (r1 + r2) >> 1;
    const dr = r1 - r2;
    const dg = g1 - g2;
    const db = b1 - b2;
    return (
      (((512 + rMean) * dr * dr) >> 8) +
      4 * dg * dg +
      (((767 - rMean) * db * db) >> 8)
    );
  }

  /**
   * Kuwahara multi-quadrant filter for converting photographic noise
   * into clean, smooth, painterly cel patches while preserving silhouette edges.
   */
  static applyKuwaharaFilter(
    rgbaData: Uint8ClampedArray,
    width: number,
    height: number,
    radius: number = 2
  ): Uint8ClampedArray {
    const totalPixels = width * height;
    const result = new Uint8ClampedArray(rgbaData.length);
    const lum = new Uint8Array(totalPixels);

    for (let i = 0; i < totalPixels; i++) {
      const idx = i * 4;
      lum[i] = Math.round(
        0.299 * rgbaData[idx] + 0.587 * rgbaData[idx + 1] + 0.114 * rgbaData[idx + 2]
      );
    }

    const r = radius;

    for (let y = 0; y < height; y++) {
      const yOffset = y * width;
      for (let x = 0; x < width; x++) {
        let minVar = Number.MAX_VALUE;
        let bestMeanR = rgbaData[(yOffset + x) * 4];
        let bestMeanG = rgbaData[(yOffset + x) * 4 + 1];
        let bestMeanB = rgbaData[(yOffset + x) * 4 + 2];

        const qBounds = [
          [Math.max(0, y - r), y, Math.max(0, x - r), x],
          [Math.max(0, y - r), y, x, Math.min(width - 1, x + r)],
          [y, Math.min(height - 1, y + r), Math.max(0, x - r), x],
          [y, Math.min(height - 1, y + r), x, Math.min(width - 1, x + r)],
        ];

        for (let q = 0; q < 4; q++) {
          const [yStart, yEnd, xStart, xEnd] = qBounds[q];
          let sumR = 0;
          let sumG = 0;
          let sumB = 0;
          let sumLum = 0;
          let sumLumSq = 0;
          let count = 0;

          for (let qy = yStart; qy <= yEnd; qy++) {
            const rowIdx = qy * width;
            for (let qx = xStart; qx <= xEnd; qx++) {
              const pIdx = (rowIdx + qx) * 4;
              const l = lum[rowIdx + qx];
              sumR += rgbaData[pIdx];
              sumG += rgbaData[pIdx + 1];
              sumB += rgbaData[pIdx + 2];
              sumLum += l;
              sumLumSq += l * l;
              count++;
            }
          }

          if (count === 0) continue;
          const meanLum = sumLum / count;
          const variance = sumLumSq / count - meanLum * meanLum;

          if (variance < minVar) {
            minVar = variance;
            bestMeanR = Math.round(sumR / count);
            bestMeanG = Math.round(sumG / count);
            bestMeanB = Math.round(sumB / count);
          }
        }

        const outIdx = (yOffset + x) * 4;
        result[outIdx] = bestMeanR;
        result[outIdx + 1] = bestMeanG;
        result[outIdx + 2] = bestMeanB;
        result[outIdx + 3] = 255;
      }
    }

    return result;
  }

  /**
   * Sort 9 elements in-place for 3x3 median
   */
  private static sort9(a: Uint8Array): void {
    for (let i = 1; i < 9; i++) {
      const key = a[i];
      let j = i - 1;
      while (j >= 0 && a[j] > key) {
        a[j + 1] = a[j];
        j--;
      }
      a[j + 1] = key;
    }
  }

  /**
   * Edge-preserving 3x3 median filter pass to remove raster noise while preserving outlines
   */
  static applyMedianFilter(
    rgbaData: Uint8ClampedArray,
    width: number,
    height: number
  ): Uint8ClampedArray {
    const result = new Uint8ClampedArray(rgbaData.length);
    result.set(rgbaData);

    const rVals = new Uint8Array(9);
    const gVals = new Uint8Array(9);
    const bVals = new Uint8Array(9);

    for (let y = 1; y < height - 1; y++) {
      const row = y * width;
      for (let x = 1; x < width - 1; x++) {
        let k = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const nRow = (y + dy) * width;
          for (let dx = -1; dx <= 1; dx++) {
            const idx = (nRow + x + dx) * 4;
            rVals[k] = rgbaData[idx];
            gVals[k] = rgbaData[idx + 1];
            bVals[k] = rgbaData[idx + 2];
            k++;
          }
        }

        this.sort9(rVals);
        this.sort9(gVals);
        this.sort9(bVals);

        const outIdx = (row + x) * 4;
        result[outIdx] = rVals[4];
        result[outIdx + 1] = gVals[4];
        result[outIdx + 2] = bVals[4];
      }
    }

    return result;
  }

  /**
   * Morphological circular majority filter with Hue Preservation.
   * Eliminates 1-pixel jagged staircases while protecting distinct accent colors
   * (e.g. red mushrooms, flowers) from being swallowed by dominant background colors.
   */
  static applyCircularMajoritySmoothing(
    assignments: Int32Array,
    width: number,
    height: number,
    k: number,
    radius: number = 1,
    centroids?: { r: Int32Array; g: Int32Array; b: Int32Array }
  ): Int32Array {
    const totalPixels = width * height;
    const output = new Int32Array(totalPixels);
    const freq = new Int32Array(k);

    const offsets: [number, number][] = [];
    const rSq = radius * radius;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= rSq) {
          offsets.push([dx, dy]);
        }
      }
    }

    for (let y = 0; y < height; y++) {
      const yRow = y * width;
      for (let x = 0; x < width; x++) {
        const centerIdx = yRow + x;
        const currentCluster = assignments[centerIdx];
        freq.fill(0);

        for (let o = 0; o < offsets.length; o++) {
          const [dx, dy] = offsets[o];
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const cluster = assignments[ny * width + nx];
            if (cluster >= 0 && cluster < k) {
              freq[cluster]++;
            }
          }
        }

        // Bias towards current cluster
        freq[currentCluster] += 2;

        let maxCount = 0;
        let bestCluster = currentCluster;
        for (let c = 0; c < k; c++) {
          if (freq[c] > maxCount) {
            maxCount = freq[c];
            bestCluster = c;
          }
        }

        // Hue Protection: If centroids are provided and color difference is high (DeltaE > 50, e.g. red vs green)
        // do NOT overwrite the accent color unless it is an isolated 1-pixel dot
        if (centroids && bestCluster !== currentCluster) {
          const cR = centroids.r[currentCluster], cG = centroids.g[currentCluster], cB = centroids.b[currentCluster];
          const bR = centroids.r[bestCluster], bG = centroids.g[bestCluster], bB = centroids.b[bestCluster];
          const deltaE = Math.sqrt(this.perceptualDistanceSq(cR, cG, cB, bR, bG, bB));

          if (deltaE > 50) {
            // Keep current cluster if it has at least 3 supporting pixels in the window
            if (freq[currentCluster] >= 3 || maxCount < offsets.length * 0.85) {
              bestCluster = currentCluster;
            }
          }
        }

        output[centerIdx] = bestCluster;
      }
    }

    return output;
  }

  /**
   * Quantize image pixels with perceptual K-Means++ clustering, saliency seeding,
   * dead-cluster revival, and hue-preserving smoothing.
   */
  static quantize(
    rgbaData: Uint8ClampedArray,
    width: number,
    height: number,
    k: number = 16,
    maxIterations: number = 14,
    applySmoothing: boolean = true,
    usePerceptualDistance: boolean = true,
    onProgress?: (
      progress: number,
      status: string,
      payload?: GenerationProgressPayload,
      paletteColors?: Array<{ r: number; g: number; b: number }>
    ) => void
  ): { palette: PaletteColor[]; assignments: Int32Array } {
    const totalPixels = width * height;
    const actualK = Math.min(200, Math.max(2, Math.min(totalPixels, k)));

    onProgress?.(0.32, 'Analyzing dominant color palette...');

    const rArr = new Uint8Array(totalPixels);
    const gArr = new Uint8Array(totalPixels);
    const bArr = new Uint8Array(totalPixels);

    let sumTotalR = 0;
    let sumTotalG = 0;
    let sumTotalB = 0;

    // 5-bit color histogram
    const colorHist = new Int32Array(32768);
    for (let i = 0; i < totalPixels; i++) {
      const pIdx = i * 4;
      const r = rgbaData[pIdx];
      const g = rgbaData[pIdx + 1];
      const b = rgbaData[pIdx + 2];
      rArr[i] = r;
      gArr[i] = g;
      bArr[i] = b;
      sumTotalR += r;
      sumTotalG += g;
      sumTotalB += b;

      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      colorHist[key]++;
    }

    const avgR = Math.round(sumTotalR / totalPixels);
    const avgG = Math.round(sumTotalG / totalPixels);
    const avgB = Math.round(sumTotalB / totalPixels);

    const centroidR = new Int32Array(actualK);
    const centroidG = new Int32Array(actualK);
    const centroidB = new Int32Array(actualK);
    let effectiveK = 0;

    // Seed centroids from:
    // 1. Most frequent background / base colors
    // 2. High-saliency accent colors (like red mushrooms, blue flowers, bright fruits)
    const prominentKeys: number[] = [];
    for (let key = 0; key < 32768; key++) {
      if (colorHist[key] > totalPixels * 0.001) {
        prominentKeys.push(key);
      }
    }

    // Score prominent colors by a combination of frequency and saliency
    prominentKeys.sort((a, b) => {
      const ar = ((a >> 10) & 0x1f) << 3;
      const ag = ((a >> 5) & 0x1f) << 3;
      const ab = (a & 0x1f) << 3;
      const br = ((b >> 10) & 0x1f) << 3;
      const bg = ((b >> 5) & 0x1f) << 3;
      const bb = (b & 0x1f) << 3;

      const distA = Math.sqrt(ColorQuantizer.perceptualDistanceSq(ar, ag, ab, avgR, avgG, avgB));
      const distB = Math.sqrt(ColorQuantizer.perceptualDistanceSq(br, bg, bb, avgR, avgG, avgB));

      const scoreA = colorHist[a] * (1.0 + distA * 0.02);
      const scoreB = colorHist[b] * (1.0 + distB * 0.02);
      return scoreB - scoreA;
    });

    // Seed top initial centroids with perceptual distance spacing
    for (let i = 0; i < prominentKeys.length && effectiveK < Math.min(actualK, Math.max(6, Math.floor(actualK * 0.4))); i++) {
      const key = prominentKeys[i];
      const kr = ((key >> 10) & 0x1f) << 3;
      const kg = ((key >> 5) & 0x1f) << 3;
      const kb = (key & 0x1f) << 3;

      let tooClose = false;
      for (let c = 0; c < effectiveK; c++) {
        if (this.perceptualDistanceSq(kr, kg, kb, centroidR[c], centroidG[c], centroidB[c]) < 750) {
          tooClose = true;
          break;
        }
      }

      if (!tooClose) {
        centroidR[effectiveK] = kr;
        centroidG[effectiveK] = kg;
        centroidB[effectiveK] = kb;
        effectiveK++;
      }
    }

    if (effectiveK === 0) {
      centroidR[0] = rArr[0];
      centroidG[0] = gArr[0];
      centroidB[0] = bArr[0];
      effectiveK = 1;
    }

    const minDistances = new Float64Array(totalPixels);
    minDistances.fill(Number.MAX_VALUE);

    // K-Means++ initialization for remaining centroids
    while (effectiveK < actualK && effectiveK < totalPixels) {
      const lastR = centroidR[effectiveK - 1];
      const lastG = centroidG[effectiveK - 1];
      const lastB = centroidB[effectiveK - 1];

      let sumDistances = 0;
      for (let i = 0; i < totalPixels; i++) {
        const pxR = rArr[i];
        const pxG = gArr[i];
        const pxB = bArr[i];

        const dist = usePerceptualDistance
          ? this.perceptualDistanceSq(pxR, pxG, pxB, lastR, lastG, lastB)
          : (pxR - lastR) ** 2 + (pxG - lastG) ** 2 + (pxB - lastB) ** 2;

        if (dist < minDistances[i]) {
          minDistances[i] = dist;
        }
        sumDistances += minDistances[i];
      }

      if (sumDistances <= 0) break;

      let target = Math.random() * sumDistances;
      let chosenIdx = 0;
      for (let i = 0; i < totalPixels; i++) {
        target -= minDistances[i];
        if (target <= 0) {
          chosenIdx = i;
          break;
        }
      }

      centroidR[effectiveK] = rArr[chosenIdx];
      centroidG[effectiveK] = gArr[chosenIdx];
      centroidB[effectiveK] = bArr[chosenIdx];
      effectiveK++;
    }

    let assignments: Int32Array = new Int32Array(totalPixels);
    const sumsR = new Float64Array(effectiveK);
    const sumsG = new Float64Array(effectiveK);
    const sumsB = new Float64Array(effectiveK);
    const counts = new Int32Array(effectiveK);

    // K-Means clustering loop
    for (let iter = 0; iter < maxIterations; iter++) {
      const iterPct = 0.34 + ((iter + 1) / maxIterations) * 0.24;
      const paletteColors: Array<{ r: number; g: number; b: number }> = [];
      for (let c = 0; c < effectiveK; c++) {
        paletteColors.push({ r: centroidR[c], g: centroidG[c], b: centroidB[c] });
      }
      onProgress?.(
        iterPct,
        `Clustering perceptual palette colors (pass ${iter + 1}/${maxIterations})...`,
        undefined,
        paletteColors
      );

      let changed = false;

      for (let i = 0; i < totalPixels; i++) {
        const pxR = rArr[i];
        const pxG = gArr[i];
        const pxB = bArr[i];

        let bestDist = Number.MAX_VALUE;
        let bestCluster = 0;

        for (let c = 0; c < effectiveK; c++) {
          const cR = centroidR[c];
          const cG = centroidG[c];
          const cB = centroidB[c];

          const dist = usePerceptualDistance
            ? this.perceptualDistanceSq(pxR, pxG, pxB, cR, cG, cB)
            : (pxR - cR) ** 2 + (pxG - cG) ** 2 + (pxB - cB) ** 2;

          if (dist < bestDist) {
            bestDist = dist;
            bestCluster = c;
          }
        }

        if (assignments[i] !== bestCluster) {
          assignments[i] = bestCluster;
          changed = true;
        }
      }

      sumsR.fill(0);
      sumsG.fill(0);
      sumsB.fill(0);
      counts.fill(0);

      for (let i = 0; i < totalPixels; i++) {
        const cluster = assignments[i];
        sumsR[cluster] += rArr[i];
        sumsG[cluster] += gArr[i];
        sumsB[cluster] += bArr[i];
        counts[cluster]++;
      }

      // Update centroids & revive any dead clusters from pixels with worst error
      for (let c = 0; c < effectiveK; c++) {
        const cnt = counts[c];
        if (cnt > 0) {
          centroidR[c] = Math.round(sumsR[c] / cnt);
          centroidG[c] = Math.round(sumsG[c] / cnt);
          centroidB[c] = Math.round(sumsB[c] / cnt);
        } else {
          // Find worst-represented pixel to revive dead cluster
          let maxErr = -1;
          let worstIdx = 0;
          for (let i = 0; i < totalPixels; i += 13) {
            const currC = assignments[i];
            const d = this.perceptualDistanceSq(
              rArr[i],
              gArr[i],
              bArr[i],
              centroidR[currC],
              centroidG[currC],
              centroidB[currC]
            );
            if (d > maxErr) {
              maxErr = d;
              worstIdx = i;
            }
          }
          centroidR[c] = rArr[worstIdx];
          centroidG[c] = gArr[worstIdx];
          centroidB[c] = bArr[worstIdx];
        }
      }

      if (!changed && iter >= 4) break;
    }

    // Multi-pass morphological circular smoothing with Hue Protection
    if (applySmoothing) {
      onProgress?.(0.60, 'Shaping smooth organic regions...');
      const centroidRefs = { r: centroidR, g: centroidG, b: centroidB };
      assignments = this.applyCircularMajoritySmoothing(assignments, width, height, effectiveK, 1, centroidRefs);

      // Recompute final centroids after spatial smoothing
      sumsR.fill(0);
      sumsG.fill(0);
      sumsB.fill(0);
      counts.fill(0);

      for (let i = 0; i < totalPixels; i++) {
        const cluster = assignments[i];
        sumsR[cluster] += rArr[i];
        sumsG[cluster] += gArr[i];
        sumsB[cluster] += bArr[i];
        counts[cluster]++;
      }

      for (let c = 0; c < effectiveK; c++) {
        const cnt = counts[c];
        if (cnt > 0) {
          centroidR[c] = Math.round(sumsR[c] / cnt);
          centroidG[c] = Math.round(sumsG[c] / cnt);
          centroidB[c] = Math.round(sumsB[c] / cnt);
        }
      }
    }

    // Build palette
    const palette: PaletteColor[] = [];
    for (let idx = 0; idx < effectiveK; idx++) {
      const r = centroidR[idx];
      const g = centroidG[idx];
      const b = centroidB[idx];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase();
      const argb = (0xff << 24) | (r << 16) | (g << 8) | b;

      palette.push({
        id: idx + 1,
        hex,
        isLight: lum > 140,
        argb,
        r,
        g,
        b,
      });
    }

    return { palette, assignments };
  }
}
