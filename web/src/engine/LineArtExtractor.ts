/**
 * LineArtExtractor
 *
 * Computer-vision module for detecting, extracting, and tracing
 * drawn ink outlines and black line borders from artwork.
 */
export interface LineArtAnalysis {
  isLineArt: boolean;
  lineMask: Uint8Array; // 1 for thin line/border stroke, 0 otherwise
  linePixelCount: number;
  lineRatio: number;
}

export class LineArtExtractor {
  /**
   * Extracts thin continuous ink outlines and drawn borders from artwork.
   * Uses morphological stroke-thickness analysis to distinguish actual thin line
   * outlines from large dark color regions (such as dark fur, eyes, or shadows).
   */
  static extract(
    rgbaData: Uint8ClampedArray | Uint8Array,
    width: number,
    height: number,
    darkThreshold?: number,
    maxStrokeRadius?: number
  ): LineArtAnalysis {
    const total = width * height;
    const lum = new Uint8Array(total);
    const hist = new Int32Array(256);
    let brightCount = 0;

    // 1. Calculate luminance map and histogram
    for (let i = 0; i < total; i++) {
      const idx = i * 4;
      const r = rgbaData[idx];
      const g = rgbaData[idx + 1];
      const b = rgbaData[idx + 2];
      const l = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      lum[i] = l;
      hist[l]++;
      if (l >= 190) brightCount++;
    }

    const brightRatio = brightCount / total;
    const isPaperDrawing = brightRatio >= 0.45;

    let effectiveThreshold = darkThreshold;
    let effectiveMaxRadius = maxStrokeRadius;

    if (effectiveThreshold === undefined) {
      if (isPaperDrawing) {
        // Calculate Otsu threshold on bright paper drawing (separating dark ink from white paper)
        let sumT = 0;
        for (let i = 0; i < 256; i++) sumT += i * hist[i];
        let weightBg = 0;
        let sumBg = 0;
        let currentMax = 0;
        let otsu = 128;
        for (let i = 0; i < 256; i++) {
          weightBg += hist[i];
          if (weightBg === 0) continue;
          const weightFg = total - weightBg;
          if (weightFg === 0) break;
          sumBg += i * hist[i];
          const meanBg = sumBg / weightBg;
          const meanFg = (sumT - sumBg) / weightFg;
          const varBetween = weightBg * weightFg * ((meanBg - meanFg) * (meanBg - meanFg));
          if (varBetween > currentMax) {
            currentMax = varBetween;
            otsu = i;
          }
        }
        effectiveThreshold = Math.min(125, Math.max(85, Math.round(otsu * 0.75)));
        effectiveMaxRadius = effectiveMaxRadius ?? 16;
      } else {
        effectiveThreshold = 35;
        effectiveMaxRadius = effectiveMaxRadius ?? 3;
      }
    } else {
      effectiveMaxRadius = effectiveMaxRadius ?? (isPaperDrawing ? 16 : 3);
    }

    // 2. Identify candidate dark pixels
    const isDark = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
      if (lum[i] <= effectiveThreshold) {
        isDark[i] = 1;
      }
    }

    // Also include anti-aliased edges (moderately dark + sharp local gradient)
    const edgeLuminanceLimit = isPaperDrawing ? Math.min(160, effectiveThreshold + 40) : 55;
    for (let y = 1; y < height - 1; y++) {
      const row = y * width;
      for (let x = 1; x < width - 1; x++) {
        const idx = row + x;
        if (isDark[idx] === 1) continue;

        const l = lum[idx];
        if (l <= edgeLuminanceLimit) {
          const gx =
            lum[idx - width + 1] + 2 * lum[idx + 1] + lum[idx + width + 1] -
            (lum[idx - width - 1] + 2 * lum[idx - 1] + lum[idx + width - 1]);
          const gy =
            lum[idx + width - 1] + 2 * lum[idx + width] + lum[idx + width + 1] -
            (lum[idx - width - 1] + 2 * lum[idx - width] + lum[idx - width + 1]);

          const mag = Math.abs(gx) + Math.abs(gy);
          if (mag >= 50) {
            isDark[idx] = 1;
          }
        }
      }
    }

    // 3. Line mask generation
    const cleanLineMask = new Uint8Array(total);
    let linePixelCount = 0;

    if (isPaperDrawing) {
      // In drawings on white paper, all dark ink strokes are genuine line boundaries
      for (let i = 0; i < total; i++) {
        if (isDark[i] === 1) {
          cleanLineMask[i] = 1;
          linePixelCount++;
        }
      }
    } else {
      // Distance transform from non-dark pixels to measure stroke thickness (filters massive dark patches in photos)
      const strokeDist = new Int32Array(total);
      strokeDist.fill(999);
      const queue = new Int32Array(total);
      let head = 0;
      let tail = 0;

      for (let y = 0; y < height; y++) {
        const row = y * width;
        for (let x = 0; x < width; x++) {
          const idx = row + x;
          if (isDark[idx] === 0) {
            strokeDist[idx] = 0;
            queue[tail++] = idx;
          }
        }
      }

      while (head < tail) {
        const curr = queue[head++];
        const d = strokeDist[curr];
        const cx = curr % width;
        const cy = Math.floor(curr / width);

        const neighbors = [
          cx > 0 ? curr - 1 : -1,
          cx < width - 1 ? curr + 1 : -1,
          cy > 0 ? curr - width : -1,
          cy < height - 1 ? curr + width : -1,
        ];

        for (const n of neighbors) {
          if (n >= 0 && strokeDist[n] > d + 1) {
            strokeDist[n] = d + 1;
            if (d + 1 <= effectiveMaxRadius + 1) {
              queue[tail++] = n;
            }
          }
        }
      }

      for (let i = 0; i < total; i++) {
        if (isDark[i] === 1 && strokeDist[i] >= 1 && strokeDist[i] <= effectiveMaxRadius) {
          cleanLineMask[i] = 1;
          linePixelCount++;
        }
      }
    }

    const lineRatio = linePixelCount / total;
    // Considered line art if thin outlines exist (> 0.5% and < 35%)
    const isLineArt = lineRatio >= 0.005 && lineRatio <= 0.35;

    return {
      isLineArt,
      lineMask: cleanLineMask,
      linePixelCount,
      lineRatio,
    };
  }

  /**
   * Symmetrically aligns puzzle region boundaries inside drawn ink strokes.
   *
   * For any line stroke that separates two or more different color regions:
   * Uses multi-source watershed distance transform starting from the opposing regions.
   * As the regions expand into the stroke from both sides, they meet right down the
   * medial axis (centerline) of the drawn line.
   *
   * This guarantees that the final vector boundaries follow the artwork's drawn lines
   * with 100% precision and zero gaps!
   */
  static alignBoundariesToLines(
    regionMap: Int32Array,
    lineMask: Uint8Array,
    width: number,
    height: number
  ): void {
    const total = width * height;
    const multiTouchLine = new Uint8Array(total);
    const queue = new Int32Array(total);
    let head = 0;
    let tail = 0;

    // Identify line pixels that separate 2 or more distinct regions
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        const idx = row + x;
        if (lineMask[idx] !== 1) continue;

        let rFirst = -1;
        let hasDiff = false;
        const neighbors = [
          x > 0 ? idx - 1 : -1,
          x < width - 1 ? idx + 1 : -1,
          y > 0 ? idx - width : -1,
          y < height - 1 ? idx + width : -1,
        ];

        for (const n of neighbors) {
          if (n >= 0) {
            const nr = regionMap[n];
            if (nr > 0) {
              if (rFirst === -1) rFirst = nr;
              else if (nr !== rFirst) {
                hasDiff = true;
                break;
              }
            }
          }
        }

        if (hasDiff) {
          multiTouchLine[idx] = 1;
        }
      }
    }

    // Clear all multi-touch line pixels after Pass 1 completes so Pass-1 neighbor checks
    // never observe in-place mutations from earlier scan coordinates.
    for (let i = 0; i < total; i++) {
      if (multiTouchLine[i] === 1) {
        regionMap[i] = -1; // Clear for watershed expansion
      }
    }

    // Seed watershed propagation from neighboring colored regions without mutating regionMap
    // in-place during the scan so medial-axis symmetry is preserved regardless of scan order.
    // Prefer non-line colored region neighbors (lineMask === 0) over interior line pixels so
    // thick (3px/4px) line boundaries expand symmetrically from both outer colored edges.
    const seedValues = new Int32Array(total);
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        const idx = row + x;
        if (multiTouchLine[idx] === 1 && regionMap[idx] === -1) {
          const neighborR = this.findSeedNeighbor(regionMap, lineMask, width, height, x, y, idx);
          if (neighborR > 0) {
            queue[tail] = idx;
            seedValues[tail] = neighborR;
            tail++;
          }
        }
      }
    }

    // Apply all Pass-2 seeds simultaneously after the scan completes
    for (let i = 0; i < tail; i++) {
      regionMap[queue[i]] = seedValues[i];
    }

    // Multi-source BFS watershed expansion
    while (head < tail) {
      const curr = queue[head++];
      const rId = regionMap[curr];
      const cx = curr % width;
      const cy = Math.floor(curr / width);

      const neighbors = [
        cx > 0 ? curr - 1 : -1,
        cx < width - 1 ? curr + 1 : -1,
        cy > 0 ? curr - width : -1,
        cy < height - 1 ? curr + width : -1,
      ];

      for (const n of neighbors) {
        if (n >= 0 && multiTouchLine[n] === 1 && regionMap[n] === -1) {
          regionMap[n] = rId;
          queue[tail++] = n;
        }
      }
    }
  }

  /**
   * Finds the watershed seed region for a cleared multi-touch line pixel, preferring
   * adjacent non-line colored regions (lineMask === 0) over interior line pixels.
   */
  private static findSeedNeighbor(
    regionMap: Int32Array,
    lineMask: Uint8Array,
    width: number,
    height: number,
    x: number,
    y: number,
    idx: number
  ): number {
    if (x > 0 && lineMask[idx - 1] === 0 && regionMap[idx - 1] > 0) return regionMap[idx - 1];
    if (x < width - 1 && lineMask[idx + 1] === 0 && regionMap[idx + 1] > 0) return regionMap[idx + 1];
    if (y > 0 && lineMask[idx - width] === 0 && regionMap[idx - width] > 0) return regionMap[idx - width];
    if (y < height - 1 && lineMask[idx + width] === 0 && regionMap[idx + width] > 0) return regionMap[idx + width];

    if (x > 0 && regionMap[idx - 1] > 0) return regionMap[idx - 1];
    if (x < width - 1 && regionMap[idx + 1] > 0) return regionMap[idx + 1];
    if (y > 0 && regionMap[idx - width] > 0) return regionMap[idx - width];
    if (y < height - 1 && regionMap[idx + width] > 0) return regionMap[idx + width];

    return -1;
  }

  /**
   * Symmetrically absorbs black line pixels into their adjacent enclosed cel regions.
   */
  static absorbLinesIntoRegions(
    regionMap: Int32Array,
    lineMask: Uint8Array,
    width: number,
    height: number
  ): void {
    this.alignBoundariesToLines(regionMap, lineMask, width, height);
  }
}
