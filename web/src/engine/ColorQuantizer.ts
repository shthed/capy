import { GenerationProgressPayload, PaletteColor } from '../types';

interface QuantizeSamples {
  sampleCount: number;
  activeIndices: Int32Array | null;
  rArr: Uint8Array;
  gArr: Uint8Array;
  bArr: Uint8Array;
  colorHist: Int32Array;
  avgR: number;
  avgG: number;
  avgB: number;
}

interface CentroidArrays {
  r: Int32Array;
  g: Int32Array;
  b: Int32Array;
}

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

  private static computeKuwaharaPixel(
    rgbaData: Uint8ClampedArray,
    lum: Uint8Array,
    width: number,
    height: number,
    x: number,
    y: number,
    radius: number,
    activeMask?: Uint8Array
  ): [number, number, number] {
    const centerOff = (y * width + x) * 4;
    let minVar = Number.MAX_VALUE;
    let bestMeanR = rgbaData[centerOff];
    let bestMeanG = rgbaData[centerOff + 1];
    let bestMeanB = rgbaData[centerOff + 2];

    const yMin = Math.max(0, y - radius);
    const yMax = Math.min(height - 1, y + radius);
    const xMin = Math.max(0, x - radius);
    const xMax = Math.min(width - 1, x + radius);

    const qBounds: ReadonlyArray<readonly [number, number, number, number]> = [
      [yMin, y, xMin, x],
      [yMin, y, x, xMax],
      [y, yMax, xMin, x],
      [y, yMax, x, xMax],
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
          const nIdx = rowIdx + qx;
          if (activeMask && activeMask[nIdx] !== 1) continue;
          const pIdx = nIdx * 4;
          const l = lum[nIdx];
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

    return [bestMeanR, bestMeanG, bestMeanB];
  }

  /**
   * Kuwahara multi-quadrant filter for converting photographic noise
   * into clean, smooth, painterly cel patches while preserving silhouette edges.
   */
  static applyKuwaharaFilter(
    rgbaData: Uint8ClampedArray,
    width: number,
    height: number,
    radius: number = 2,
    activeMask?: Uint8Array
  ): Uint8ClampedArray {
    const totalPixels = width * height;
    const result = new Uint8ClampedArray(rgbaData.length);
    const lum = new Uint8Array(totalPixels);

    for (let i = 0; i < totalPixels; i++) {
      if (activeMask && activeMask[i] !== 1) continue;
      const idx = i * 4;
      lum[i] = Math.round(
        0.299 * rgbaData[idx] + 0.587 * rgbaData[idx + 1] + 0.114 * rgbaData[idx + 2]
      );
    }

    for (let y = 0; y < height; y++) {
      const yOffset = y * width;
      for (let x = 0; x < width; x++) {
        const centerIdx = yOffset + x;
        const outIdx = centerIdx * 4;
        if (activeMask && activeMask[centerIdx] !== 1) {
          result[outIdx] = rgbaData[outIdx];
          result[outIdx + 1] = rgbaData[outIdx + 1];
          result[outIdx + 2] = rgbaData[outIdx + 2];
          result[outIdx + 3] = rgbaData[outIdx + 3];
          continue;
        }

        const [bestMeanR, bestMeanG, bestMeanB] = this.computeKuwaharaPixel(
          rgbaData,
          lum,
          width,
          height,
          x,
          y,
          radius,
          activeMask
        );

        result[outIdx] = bestMeanR;
        result[outIdx + 1] = bestMeanG;
        result[outIdx + 2] = bestMeanB;
        result[outIdx + 3] = activeMask ? rgbaData[outIdx + 3] : 255;
      }
    }

    return result;
  }

  /**
   * Sort len elements in-place for median filter windows (len in 1..9)
   */
  private static sortWindow(a: Uint8Array, len: number): void {
    for (let i = 1; i < len; i++) {
      const key = a[i];
      let j = i - 1;
      while (j >= 0 && a[j] > key) {
        a[j + 1] = a[j];
        j--;
      }
      a[j + 1] = key;
    }
  }

  private static applyMaskedMedianFilter(
    rgbaData: Uint8ClampedArray,
    width: number,
    height: number,
    activeMask: Uint8Array
  ): Uint8ClampedArray {
    const result = new Uint8ClampedArray(rgbaData);
    const rVals = new Uint8Array(9);
    const gVals = new Uint8Array(9);
    const bVals = new Uint8Array(9);

    for (let y = 0; y < height; y++) {
      const y0 = y > 0 ? y - 1 : 0;
      const y1 = y < height - 1 ? y + 1 : height - 1;
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (activeMask[idx] !== 1) continue;

        const x0 = x > 0 ? x - 1 : 0;
        const x1 = x < width - 1 ? x + 1 : width - 1;
        let count = 0;
        for (let ny = y0; ny <= y1; ny++) {
          const nRow = ny * width;
          for (let nx = x0; nx <= x1; nx++) {
            const nIdx = nRow + nx;
            if (activeMask[nIdx] !== 1) continue;
            const off = nIdx * 4;
            rVals[count] = rgbaData[off];
            gVals[count] = rgbaData[off + 1];
            bVals[count] = rgbaData[off + 2];
            count++;
          }
        }

        if (count > 0) {
          this.sortWindow(rVals, count);
          this.sortWindow(gVals, count);
          this.sortWindow(bVals, count);
          const mid = count >> 1;
          const outIdx = idx * 4;
          result[outIdx] = rVals[mid];
          result[outIdx + 1] = gVals[mid];
          result[outIdx + 2] = bVals[mid];
        }
      }
    }

    return result;
  }

  /**
   * Edge-preserving 3x3 median filter pass to remove raster noise while preserving outlines
   */
  static applyMedianFilter(
    rgbaData: Uint8ClampedArray,
    width: number,
    height: number,
    activeMask?: Uint8Array
  ): Uint8ClampedArray {
    if (activeMask) {
      return this.applyMaskedMedianFilter(rgbaData, width, height, activeMask);
    }

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

        this.sortWindow(rVals, 9);
        this.sortWindow(gVals, 9);
        this.sortWindow(bVals, 9);

        const outIdx = (row + x) * 4;
        result[outIdx] = rVals[4];
        result[outIdx + 1] = gVals[4];
        result[outIdx + 2] = bVals[4];
      }
    }

    return result;
  }

  private static applyHueProtection(
    currentCluster: number,
    bestCluster: number,
    maxCount: number,
    currentFreq: number,
    windowBase: number,
    centroids?: CentroidArrays
  ): number {
    if (!centroids || bestCluster === currentCluster) {
      return bestCluster;
    }

    const deltaE = Math.sqrt(
      this.perceptualDistanceSq(
        centroids.r[currentCluster],
        centroids.g[currentCluster],
        centroids.b[currentCluster],
        centroids.r[bestCluster],
        centroids.g[bestCluster],
        centroids.b[bestCluster]
      )
    );

    if (deltaE > 50 && (currentFreq >= 3 || maxCount < windowBase * 0.85)) {
      return currentCluster;
    }

    return bestCluster;
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
    centroids?: CentroidArrays,
    activeMask?: Uint8Array
  ): Int32Array {
    if (k <= 0) {
      return new Int32Array(assignments);
    }

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
        if (activeMask && activeMask[centerIdx] !== 1) {
          output[centerIdx] = -1;
          continue;
        }

        const currentCluster = assignments[centerIdx];
        if (currentCluster < 0 || currentCluster >= k) {
          output[centerIdx] = currentCluster;
          continue;
        }

        freq.fill(0);
        let validWindowPixels = 0;

        for (let o = 0; o < offsets.length; o++) {
          const [dx, dy] = offsets[o];
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const nIdx = ny * width + nx;
          if (activeMask && activeMask[nIdx] !== 1) continue;
          validWindowPixels++;
          const cluster = assignments[nIdx];
          if (cluster >= 0 && cluster < k) {
            freq[cluster]++;
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

        const windowBase = activeMask ? validWindowPixels : offsets.length;
        output[centerIdx] = this.applyHueProtection(
          currentCluster,
          bestCluster,
          maxCount,
          freq[currentCluster],
          windowBase,
          centroids
        );
      }
    }

    return output;
  }

  private static extractQuantizeSamples(
    rgbaData: Uint8ClampedArray,
    totalPixels: number,
    activeMask?: Uint8Array
  ): QuantizeSamples {
    const colorHist = new Int32Array(32768);
    let sumTotalR = 0;
    let sumTotalG = 0;
    let sumTotalB = 0;

    if (!activeMask) {
      const rArr = new Uint8Array(totalPixels);
      const gArr = new Uint8Array(totalPixels);
      const bArr = new Uint8Array(totalPixels);

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
        colorHist[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)]++;
      }

      const denom = Math.max(1, totalPixels);
      return {
        sampleCount: totalPixels,
        activeIndices: null,
        rArr,
        gArr,
        bArr,
        colorHist,
        avgR: Math.round(sumTotalR / denom),
        avgG: Math.round(sumTotalG / denom),
        avgB: Math.round(sumTotalB / denom),
      };
    }

    const maskLimit = Math.min(totalPixels, activeMask.length);
    let sampleCount = 0;
    for (let i = 0; i < maskLimit; i++) {
      if (activeMask[i] === 1) sampleCount++;
    }

    const activeIndices = new Int32Array(sampleCount);
    const rArr = new Uint8Array(sampleCount);
    const gArr = new Uint8Array(sampleCount);
    const bArr = new Uint8Array(sampleCount);

    let cursor = 0;
    for (let i = 0; i < maskLimit; i++) {
      if (activeMask[i] !== 1) continue;
      const pIdx = i * 4;
      const r = rgbaData[pIdx];
      const g = rgbaData[pIdx + 1];
      const b = rgbaData[pIdx + 2];
      activeIndices[cursor] = i;
      rArr[cursor] = r;
      gArr[cursor] = g;
      bArr[cursor] = b;
      cursor++;
      sumTotalR += r;
      sumTotalG += g;
      sumTotalB += b;
      colorHist[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)]++;
    }

    const denom = Math.max(1, sampleCount);
    return {
      sampleCount,
      activeIndices,
      rArr,
      gArr,
      bArr,
      colorHist,
      avgR: Math.round(sumTotalR / denom),
      avgG: Math.round(sumTotalG / denom),
      avgB: Math.round(sumTotalB / denom),
    };
  }

  private static seedProminentCentroids(
    samples: QuantizeSamples,
    actualK: number,
    centroids: CentroidArrays
  ): number {
    const { sampleCount, colorHist, avgR, avgG, avgB, rArr, gArr, bArr } = samples;
    const prominentKeys: number[] = [];
    const minFreq = sampleCount * 0.001;

    for (let key = 0; key < 32768; key++) {
      if (colorHist[key] > minFreq) {
        prominentKeys.push(key);
      }
    }

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

    let effectiveK = 0;
    const seedCap = Math.min(actualK, Math.max(6, Math.floor(actualK * 0.4)));
    for (let i = 0; i < prominentKeys.length && effectiveK < seedCap; i++) {
      const key = prominentKeys[i];
      const kr = ((key >> 10) & 0x1f) << 3;
      const kg = ((key >> 5) & 0x1f) << 3;
      const kb = (key & 0x1f) << 3;

      let tooClose = false;
      for (let c = 0; c < effectiveK; c++) {
        if (
          this.perceptualDistanceSq(kr, kg, kb, centroids.r[c], centroids.g[c], centroids.b[c]) <
          750
        ) {
          tooClose = true;
          break;
        }
      }

      if (!tooClose) {
        centroids.r[effectiveK] = kr;
        centroids.g[effectiveK] = kg;
        centroids.b[effectiveK] = kb;
        effectiveK++;
      }
    }

    if (effectiveK === 0) {
      centroids.r[0] = rArr[0];
      centroids.g[0] = gArr[0];
      centroids.b[0] = bArr[0];
      effectiveK = 1;
    }

    return effectiveK;
  }

  private static completeKMeansPlusPlusSeeds(
    samples: QuantizeSamples,
    actualK: number,
    initialK: number,
    centroids: CentroidArrays,
    usePerceptualDistance: boolean
  ): number {
    const { sampleCount, rArr, gArr, bArr } = samples;
    let effectiveK = initialK;
    const minDistances = new Float64Array(sampleCount);
    minDistances.fill(Number.MAX_VALUE);

    // Initialize minDistances against all pre-seeded centroids (0 .. effectiveK - 2);
    // centroid[effectiveK - 1] is evaluated on the first iteration of the K-Means++ loop below.
    if (effectiveK < actualK && effectiveK < sampleCount) {
      for (let c = 0; c < effectiveK - 1; c++) {
        const cr = centroids.r[c];
        const cg = centroids.g[c];
        const cb = centroids.b[c];
        for (let i = 0; i < sampleCount; i++) {
          const pxR = rArr[i];
          const pxG = gArr[i];
          const pxB = bArr[i];
          const dist = usePerceptualDistance
            ? this.perceptualDistanceSq(pxR, pxG, pxB, cr, cg, cb)
            : (pxR - cr) ** 2 + (pxG - cg) ** 2 + (pxB - cb) ** 2;
          if (dist < minDistances[i]) {
            minDistances[i] = dist;
          }
        }
      }
    }

    // Deterministic FNV-1a + Mulberry32 PRNG seeded from active artwork pixels so identical inputs
    // always produce identical K-Means++ palettes and region IDs across browsers and devices.
    let rngSeed = (2166136261 ^ sampleCount ^ actualK) >>> 0;
    const sampleStep = Math.max(1, Math.floor(sampleCount / 256));
    for (let s = 0; s < sampleCount; s += sampleStep) {
      rngSeed = Math.imul(rngSeed ^ rArr[s], 16777619) >>> 0;
      rngSeed = Math.imul(rngSeed ^ gArr[s], 16777619) >>> 0;
      rngSeed = Math.imul(rngSeed ^ bArr[s], 16777619) >>> 0;
    }
    const nextDeterministicUnit = (): number => {
      rngSeed = (rngSeed + 0x6d2b79f5) >>> 0;
      let t = Math.imul(rngSeed ^ (rngSeed >>> 15), 1 | rngSeed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    while (effectiveK < actualK && effectiveK < sampleCount) {
      const lastR = centroids.r[effectiveK - 1];
      const lastG = centroids.g[effectiveK - 1];
      const lastB = centroids.b[effectiveK - 1];

      let sumDistances = 0;
      for (let i = 0; i < sampleCount; i++) {
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

      let target = nextDeterministicUnit() * sumDistances;
      let chosenIdx = 0;
      for (let i = 0; i < sampleCount; i++) {
        target -= minDistances[i];
        if (target <= 0) {
          chosenIdx = i;
          break;
        }
      }

      centroids.r[effectiveK] = rArr[chosenIdx];
      centroids.g[effectiveK] = gArr[chosenIdx];
      centroids.b[effectiveK] = bArr[chosenIdx];
      effectiveK++;
    }

    return effectiveK;
  }

  private static findWorstErrorSample(
    samples: QuantizeSamples,
    sampleAssignments: Int32Array,
    centroids: CentroidArrays
  ): number {
    const { sampleCount, rArr, gArr, bArr } = samples;
    let maxErr = -1;
    let worstIdx = 0;

    for (let i = 0; i < sampleCount; i += 13) {
      const currC = sampleAssignments[i];
      const d = this.perceptualDistanceSq(
        rArr[i],
        gArr[i],
        bArr[i],
        centroids.r[currC],
        centroids.g[currC],
        centroids.b[currC]
      );
      if (d > maxErr) {
        maxErr = d;
        worstIdx = i;
      }
    }

    return worstIdx;
  }

  private static runKMeansIterations(
    samples: QuantizeSamples,
    effectiveK: number,
    centroids: CentroidArrays,
    maxIterations: number,
    usePerceptualDistance: boolean,
    onProgress?: (
      progress: number,
      status: string,
      payload?: GenerationProgressPayload,
      paletteColors?: Array<{ r: number; g: number; b: number }>
    ) => void
  ): Int32Array {
    const { sampleCount, rArr, gArr, bArr } = samples;
    const sampleAssignments = new Int32Array(sampleCount);
    const sumsR = new Float64Array(effectiveK);
    const sumsG = new Float64Array(effectiveK);
    const sumsB = new Float64Array(effectiveK);
    const counts = new Int32Array(effectiveK);

    for (let iter = 0; iter < maxIterations; iter++) {
      const iterPct = 0.34 + ((iter + 1) / maxIterations) * 0.24;
      const paletteColors: Array<{ r: number; g: number; b: number }> = [];
      for (let c = 0; c < effectiveK; c++) {
        paletteColors.push({ r: centroids.r[c], g: centroids.g[c], b: centroids.b[c] });
      }
      onProgress?.(
        iterPct,
        `Clustering perceptual palette colors (pass ${iter + 1}/${maxIterations})...`,
        undefined,
        paletteColors
      );

      let changed = false;

      for (let i = 0; i < sampleCount; i++) {
        const pxR = rArr[i];
        const pxG = gArr[i];
        const pxB = bArr[i];

        let bestDist = Number.MAX_VALUE;
        let bestCluster = 0;

        for (let c = 0; c < effectiveK; c++) {
          const cR = centroids.r[c];
          const cG = centroids.g[c];
          const cB = centroids.b[c];

          const dist = usePerceptualDistance
            ? this.perceptualDistanceSq(pxR, pxG, pxB, cR, cG, cB)
            : (pxR - cR) ** 2 + (pxG - cG) ** 2 + (pxB - cB) ** 2;

          if (dist < bestDist) {
            bestDist = dist;
            bestCluster = c;
          }
        }

        if (sampleAssignments[i] !== bestCluster) {
          sampleAssignments[i] = bestCluster;
          changed = true;
        }
      }

      sumsR.fill(0);
      sumsG.fill(0);
      sumsB.fill(0);
      counts.fill(0);

      for (let i = 0; i < sampleCount; i++) {
        const cluster = sampleAssignments[i];
        sumsR[cluster] += rArr[i];
        sumsG[cluster] += gArr[i];
        sumsB[cluster] += bArr[i];
        counts[cluster]++;
      }

      for (let c = 0; c < effectiveK; c++) {
        const cnt = counts[c];
        if (cnt > 0) {
          centroids.r[c] = Math.round(sumsR[c] / cnt);
          centroids.g[c] = Math.round(sumsG[c] / cnt);
          centroids.b[c] = Math.round(sumsB[c] / cnt);
        } else {
          const worstIdx = this.findWorstErrorSample(samples, sampleAssignments, centroids);
          centroids.r[c] = rArr[worstIdx];
          centroids.g[c] = gArr[worstIdx];
          centroids.b[c] = bArr[worstIdx];
        }
      }

      if (!changed && iter >= 4) break;
    }

    return sampleAssignments;
  }

  private static recomputeCentroidsFromAssignments(
    samples: QuantizeSamples,
    assignments: Int32Array,
    effectiveK: number,
    centroids: CentroidArrays
  ): void {
    const { sampleCount, activeIndices, rArr, gArr, bArr } = samples;
    const sumsR = new Float64Array(effectiveK);
    const sumsG = new Float64Array(effectiveK);
    const sumsB = new Float64Array(effectiveK);
    const counts = new Int32Array(effectiveK);

    for (let s = 0; s < sampleCount; s++) {
      const gridIdx = activeIndices ? activeIndices[s] : s;
      const cluster = assignments[gridIdx];
      if (cluster >= 0 && cluster < effectiveK) {
        sumsR[cluster] += rArr[s];
        sumsG[cluster] += gArr[s];
        sumsB[cluster] += bArr[s];
        counts[cluster]++;
      }
    }

    for (let c = 0; c < effectiveK; c++) {
      const cnt = counts[c];
      if (cnt > 0) {
        centroids.r[c] = Math.round(sumsR[c] / cnt);
        centroids.g[c] = Math.round(sumsG[c] / cnt);
        centroids.b[c] = Math.round(sumsB[c] / cnt);
      }
    }
  }

  private static buildPaletteFromCentroids(
    centroids: CentroidArrays,
    effectiveK: number
  ): PaletteColor[] {
    const palette: PaletteColor[] = [];
    for (let idx = 0; idx < effectiveK; idx++) {
      const r = centroids.r[idx];
      const g = centroids.g[idx];
      const b = centroids.b[idx];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase();
      const argb = ((0xff << 24) | (r << 16) | (g << 8) | b) >>> 0;

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
    return palette;
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
    ) => void,
    activeMask?: Uint8Array
  ): { palette: PaletteColor[]; assignments: Int32Array } {
    const totalPixels = width * height;
    onProgress?.(0.32, 'Analyzing dominant color palette...');

    const samples = this.extractQuantizeSamples(rgbaData, totalPixels, activeMask);
    if (samples.sampleCount === 0) {
      return {
        palette: [],
        assignments: new Int32Array(totalPixels).fill(-1),
      };
    }

    const actualK = activeMask
      ? Math.max(1, Math.min(200, samples.sampleCount, Math.max(1, Math.floor(k))))
      : Math.min(200, Math.max(2, Math.min(totalPixels, k)));

    const centroids: CentroidArrays = {
      r: new Int32Array(actualK),
      g: new Int32Array(actualK),
      b: new Int32Array(actualK),
    };

    const initialK = this.seedProminentCentroids(samples, actualK, centroids);
    const effectiveK = this.completeKMeansPlusPlusSeeds(
      samples,
      actualK,
      initialK,
      centroids,
      usePerceptualDistance
    );

    const sampleAssignments = this.runKMeansIterations(
      samples,
      effectiveK,
      centroids,
      maxIterations,
      usePerceptualDistance,
      onProgress
    );

    let assignments: Int32Array;
    if (samples.activeIndices) {
      assignments = new Int32Array(totalPixels).fill(-1);
      for (let s = 0; s < samples.sampleCount; s++) {
        assignments[samples.activeIndices[s]] = sampleAssignments[s];
      }
    } else {
      assignments = sampleAssignments;
    }

    if (applySmoothing) {
      onProgress?.(0.60, 'Shaping smooth organic regions...');
      assignments = this.applyCircularMajoritySmoothing(
        assignments,
        width,
        height,
        effectiveK,
        1,
        centroids,
        activeMask
      );
      this.recomputeCentroidsFromAssignments(samples, assignments, effectiveK, centroids);
    }

    const palette = this.buildPaletteFromCentroids(centroids, effectiveK);
    return { palette, assignments };
  }
}
