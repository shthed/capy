/**
 * LineArtExtractor
 *
 * Computer-vision module for detecting, extracting, and tracing
 * drawn ink outlines and black/colored line borders from artwork.
 */
export interface LineArtAnalysis {
  isLineArt: boolean;
  lineMask: Uint8Array; // 1 for thin line/border stroke, 0 otherwise
  linePixelCount: number;
  lineRatio: number;
}

const RIDGE_MAX_LUMINANCE = 115;
const RIDGE_CONTRAST = 32;
const MIN_RIDGE_NEIGHBORS = 2;
const MAX_NON_PAPER_MIN_COMPONENT_PIXELS = 12;

const RIDGE_ORIENT_NONE = 0;
const RIDGE_ORIENT_HV = 1;
const RIDGE_ORIENT_D1 = 2;
const RIDGE_ORIENT_D2 = 3;
const RIDGE_ORIENT_HV_D1 = 4;
const RIDGE_ORIENT_HV_D2 = 5;
const RIDGE_ORIENT_HV_BOTH = 6;

// [probeDx, probeDy, tangentTx, tangentTy]
const RIDGE_AXES: ReadonlyArray<readonly [number, number, number, number]> = [
  [1, 0, 0, 1],
  [0, 1, 1, 0],
  [1, 1, 1, -1],
  [1, -1, 1, 1],
];

const RIDGE_PROBE_RADII = [2, 3] as const;

// Exact Left, Right, Up, Down order preserved for medial-axis symmetry
const DIRS_4: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

const DIRS_8: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];

interface LuminanceStats {
  lum: Uint8Array;
  hist: Int32Array;
  brightCount: number;
  activeCount: number;
}

function computeLuminanceStats(
  rgbaData: Uint8ClampedArray | Uint8Array,
  total: number,
  activeMask?: Uint8Array
): LuminanceStats {
  const lum = new Uint8Array(total);
  const hist = new Int32Array(256);
  let brightCount = 0;
  let activeCount = 0;

  for (let i = 0; i < total; i++) {
    if (activeMask && activeMask[i] !== 1) continue;
    activeCount++;
    const idx = i * 4;
    const r = rgbaData[idx];
    const g = rgbaData[idx + 1];
    const b = rgbaData[idx + 2];
    const l = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    lum[i] = l;
    hist[l]++;
    if (l >= 190) brightCount++;
  }

  return { lum, hist, brightCount, activeCount };
}

function computeOtsuThreshold(hist: Int32Array, activeCount: number): number {
  let sumT = 0;
  for (let i = 0; i < 256; i++) sumT += i * hist[i];
  let weightBg = 0;
  let sumBg = 0;
  let currentMax = 0;
  let otsu = 128;

  for (let i = 0; i < 256; i++) {
    weightBg += hist[i];
    if (weightBg === 0) continue;
    const weightFg = activeCount - weightBg;
    if (weightFg === 0) break;
    sumBg += i * hist[i];
    const meanBg = sumBg / weightBg;
    const meanFg = (sumT - sumBg) / weightFg;
    const diff = meanBg - meanFg;
    const varBetween = weightBg * weightFg * (diff * diff);
    if (varBetween > currentMax) {
      currentMax = varBetween;
      otsu = i;
    }
  }
  return otsu;
}

function resolveExtractionThresholds(
  hist: Int32Array,
  activeCount: number,
  isPaperDrawing: boolean,
  darkThreshold?: number,
  maxStrokeRadius?: number
): { effectiveThreshold: number; effectiveMaxRadius: number } {
  if (darkThreshold !== undefined) {
    return {
      effectiveThreshold: darkThreshold,
      effectiveMaxRadius: maxStrokeRadius ?? (isPaperDrawing ? 16 : 3),
    };
  }
  if (isPaperDrawing) {
    const otsu = computeOtsuThreshold(hist, activeCount);
    return {
      effectiveThreshold: Math.min(125, Math.max(85, Math.round(otsu * 0.75))),
      effectiveMaxRadius: maxStrokeRadius ?? 16,
    };
  }
  return {
    effectiveThreshold: 35,
    effectiveMaxRadius: maxStrokeRadius ?? 3,
  };
}

function is3x3MaskActive(activeMask: Uint8Array, idx: number, width: number): boolean {
  const prevRow = idx - width;
  const nextRow = idx + width;
  return (
    activeMask[prevRow - 1] === 1 &&
    activeMask[prevRow] === 1 &&
    activeMask[prevRow + 1] === 1 &&
    activeMask[idx - 1] === 1 &&
    activeMask[idx] === 1 &&
    activeMask[idx + 1] === 1 &&
    activeMask[nextRow - 1] === 1 &&
    activeMask[nextRow] === 1 &&
    activeMask[nextRow + 1] === 1
  );
}

function hasFourNeighborDarkCore(isCoreDark: Uint8Array, idx: number, width: number): boolean {
  return (
    isCoreDark[idx - 1] === 1 ||
    isCoreDark[idx + 1] === 1 ||
    isCoreDark[idx - width] === 1 ||
    isCoreDark[idx + width] === 1
  );
}

function markSobelAntiAliasedEdges(
  lum: Uint8Array,
  isCoreDark: Uint8Array,
  isDark: Uint8Array,
  width: number,
  height: number,
  edgeLuminanceLimit: number,
  isPaperDrawing: boolean,
  activeMask?: Uint8Array
): void {
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const idx = row + x;
      if (isDark[idx] === 1) continue;
      if (activeMask && activeMask[idx] !== 1) continue;
      if (lum[idx] > edgeLuminanceLimit) continue;
      if (!isPaperDrawing && !hasFourNeighborDarkCore(isCoreDark, idx, width)) continue;
      if (activeMask && !is3x3MaskActive(activeMask, idx, width)) continue;

      const gx =
        lum[idx - width + 1] +
        2 * lum[idx + 1] +
        lum[idx + width + 1] -
        (lum[idx - width - 1] + 2 * lum[idx - 1] + lum[idx + width - 1]);
      const gy =
        lum[idx + width - 1] +
        2 * lum[idx + width] +
        lum[idx + width + 1] -
        (lum[idx - width - 1] + 2 * lum[idx - width] + lum[idx - width + 1]);

      if (Math.abs(gx) + Math.abs(gy) >= 50) {
        isDark[idx] = 1;
      }
    }
  }
}

function areSixIndicesActive(
  activeMask: Uint8Array,
  a0: number,
  a1: number,
  a2: number,
  b0: number,
  b1: number,
  b2: number
): boolean {
  return (
    activeMask[a0] === 1 &&
    activeMask[a1] === 1 &&
    activeMask[a2] === 1 &&
    activeMask[b0] === 1 &&
    activeMask[b1] === 1 &&
    activeMask[b2] === 1
  );
}

function matchesBilateralRidgeAtRadius(
  lum: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  l0: number,
  lc: number,
  axis: readonly [number, number, number, number],
  radius: number,
  activeMask?: Uint8Array
): boolean {
  const [dx, dy, tx, ty] = axis;
  const absTx = Math.abs(tx);
  const absTy = Math.abs(ty);
  const ax = x - dx * radius;
  const ay = y - dy * radius;
  const bx = x + dx * radius;
  const by = y + dy * radius;

  if (ax - absTx < 0 || ax + absTx >= width || ay - absTy < 0 || ay + absTy >= height) {
    return false;
  }
  if (bx - absTx < 0 || bx + absTx >= width || by - absTy < 0 || by + absTy >= height) {
    return false;
  }

  const a0 = (ay - ty) * width + (ax - tx);
  const a1 = ay * width + ax;
  const a2 = (ay + ty) * width + (ax + tx);
  const b0 = (by - ty) * width + (bx - tx);
  const b1 = by * width + bx;
  const b2 = (by + ty) * width + (bx + tx);

  if (activeMask && !areSixIndicesActive(activeMask, a0, a1, a2, b0, b1, b2)) {
    return false;
  }

  const centerMin = lum[a1] < lum[b1] ? lum[a1] : lum[b1];
  if (centerMin - l0 < RIDGE_CONTRAST) {
    return false;
  }

  const la = (lum[a0] + lum[a1] + lum[a2]) / 3;
  const lb = (lum[b0] + lum[b1] + lum[b2]) / 3;
  const sideMin = la < lb ? la : lb;
  return sideMin - lc >= RIDGE_CONTRAST && sideMin - l0 >= RIDGE_CONTRAST;
}

function matchesBilateralRidgeAxis(
  lum: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  l0: number,
  axis: readonly [number, number, number, number],
  activeMask?: Uint8Array
): boolean {
  const tx = axis[2];
  const ty = axis[3];
  const pIdx = (y - ty) * width + (x - tx);
  const nIdx = (y + ty) * width + (x + tx);

  if (activeMask && (activeMask[pIdx] !== 1 || activeMask[nIdx] !== 1)) {
    return false;
  }

  const lp = lum[pIdx];
  const ln = lum[nIdx];
  if (lp > RIDGE_MAX_LUMINANCE || ln > RIDGE_MAX_LUMINANCE) {
    return false;
  }

  const lc = (lp + l0 + ln) / 3;
  for (let i = 0; i < RIDGE_PROBE_RADII.length; i++) {
    if (
      matchesBilateralRidgeAtRadius(
        lum,
        width,
        height,
        x,
        y,
        l0,
        lc,
        axis,
        RIDGE_PROBE_RADII[i],
        activeMask
      )
    ) {
      return true;
    }
  }
  return false;
}

function countActiveRidgeNeighbors(
  isDark: Uint8Array,
  rawRidge: Uint8Array,
  width: number,
  x: number,
  y: number
): number {
  let count = 0;
  for (let i = 0; i < DIRS_8.length; i++) {
    const nIdx = (y + DIRS_8[i][1]) * width + (x + DIRS_8[i][0]);
    if (isDark[nIdx] === 1 || rawRidge[nIdx] === 1) {
      count++;
    }
  }
  return count;
}

function classifyColoredInkRidgeOrientation(
  lum: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  l0: number,
  activeMask?: Uint8Array
): number {
  const hMatch = matchesBilateralRidgeAxis(lum, width, height, x, y, l0, RIDGE_AXES[0], activeMask);
  const vMatch = matchesBilateralRidgeAxis(lum, width, height, x, y, l0, RIDGE_AXES[1], activeMask);
  if (hMatch !== vMatch) return RIDGE_ORIENT_HV;

  const d1Match = matchesBilateralRidgeAxis(lum, width, height, x, y, l0, RIDGE_AXES[2], activeMask);
  const d2Match = matchesBilateralRidgeAxis(lum, width, height, x, y, l0, RIDGE_AXES[3], activeMask);
  if (d1Match === d2Match) {
    return hMatch && vMatch && !d1Match ? RIDGE_ORIENT_HV_BOTH : RIDGE_ORIENT_NONE;
  }

  if (hMatch && vMatch) {
    return d1Match ? RIDGE_ORIENT_HV_D1 : RIDGE_ORIENT_HV_D2;
  }
  return d1Match ? RIDGE_ORIENT_D1 : RIDGE_ORIENT_D2;
}

function matchesOrientPair(code: number, a: number, b: number): boolean {
  return code === a || code === b;
}

function isConsistentAmbiguousRidge(
  ridgeOrient: Uint8Array,
  width: number,
  idx: number,
  orient: number
): boolean {
  const left = ridgeOrient[idx - 1];
  const right = ridgeOrient[idx + 1];
  const up = ridgeOrient[idx - width];
  const down = ridgeOrient[idx + width];

  const bridgesHv =
    (left === RIDGE_ORIENT_HV && right === RIDGE_ORIENT_HV) ||
    (up === RIDGE_ORIENT_HV && down === RIDGE_ORIENT_HV);
  if (orient === RIDGE_ORIENT_HV_BOTH) {
    return bridgesHv;
  }

  const samePure = orient === RIDGE_ORIENT_HV_D1 ? RIDGE_ORIENT_D1 : RIDGE_ORIENT_D2;
  const oppPure = orient === RIDGE_ORIENT_HV_D1 ? RIDGE_ORIENT_D2 : RIDGE_ORIENT_D1;
  const oppAmb = orient === RIDGE_ORIENT_HV_D1 ? RIDGE_ORIENT_HV_D2 : RIDGE_ORIENT_HV_D1;

  if (
    matchesOrientPair(left, oppPure, oppAmb) ||
    matchesOrientPair(right, oppPure, oppAmb) ||
    matchesOrientPair(up, oppPure, oppAmb) ||
    matchesOrientPair(down, oppPure, oppAmb)
  ) {
    return false;
  }

  return (
    bridgesHv ||
    matchesOrientPair(left, samePure, orient) ||
    matchesOrientPair(right, samePure, orient) ||
    matchesOrientPair(up, samePure, orient) ||
    matchesOrientPair(down, samePure, orient)
  );
}

function detectColoredInkRidges(
  lum: Uint8Array,
  isDark: Uint8Array,
  width: number,
  height: number,
  activeMask?: Uint8Array
): void {
  if (width < 5 || height < 5) return;

  const total = width * height;
  const ridgeOrient = new Uint8Array(total);
  for (let y = 2; y < height - 2; y++) {
    const row = y * width;
    for (let x = 2; x < width - 2; x++) {
      const idx = row + x;
      if (isDark[idx] === 1) continue;
      if (activeMask && activeMask[idx] !== 1) continue;

      const l0 = lum[idx];
      if (l0 > RIDGE_MAX_LUMINANCE) continue;

      ridgeOrient[idx] = classifyColoredInkRidgeOrientation(
        lum,
        width,
        height,
        x,
        y,
        l0,
        activeMask
      );
    }
  }

  const rawRidge = new Uint8Array(total);
  for (let y = 2; y < height - 2; y++) {
    const row = y * width;
    for (let x = 2; x < width - 2; x++) {
      const idx = row + x;
      const o = ridgeOrient[idx];
      if (o === RIDGE_ORIENT_NONE) continue;
      if (o <= RIDGE_ORIENT_D2 || isConsistentAmbiguousRidge(ridgeOrient, width, idx, o)) {
        rawRidge[idx] = 1;
      }
    }
  }

  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const idx = row + x;
      if (rawRidge[idx] !== 1) continue;
      if (countActiveRidgeNeighbors(isDark, rawRidge, width, x, y) >= MIN_RIDGE_NEIGHBORS) {
        isDark[idx] = 1;
      }
    }
  }
}

function computeBackgroundDistance8(
  isDark: Uint8Array,
  width: number,
  height: number,
  effectiveMaxRadius: number,
  queue: Int32Array
): Int32Array {
  const total = width * height;
  const strokeDist = new Int32Array(total);
  strokeDist.fill(999);
  let head = 0;
  let tail = 0;

  for (let i = 0; i < total; i++) {
    if (isDark[i] === 0) {
      strokeDist[i] = 0;
      queue[tail++] = i;
    }
  }

  const maxQueueDist = effectiveMaxRadius + 1;
  while (head < tail) {
    const curr = queue[head++];
    const nextDist = strokeDist[curr] + 1;
    const cx = curr % width;
    const cy = Math.floor(curr / width);

    for (let i = 0; i < DIRS_8.length; i++) {
      const nx = cx + DIRS_8[i][0];
      const ny = cy + DIRS_8[i][1];
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const nIdx = ny * width + nx;
      if (strokeDist[nIdx] > nextDist) {
        strokeDist[nIdx] = nextDist;
        if (nextDist <= maxQueueDist) {
          queue[tail++] = nIdx;
        }
      }
    }
  }

  return strokeDist;
}

function computeThickCoreDilation8(
  isDark: Uint8Array,
  strokeDist: Int32Array,
  width: number,
  height: number,
  effectiveMaxRadius: number,
  dilateRadius: number,
  queue: Int32Array
): Int32Array {
  const total = width * height;
  const thickDist = new Int32Array(total);
  thickDist.fill(999);
  let head = 0;
  let tail = 0;

  for (let i = 0; i < total; i++) {
    if (isDark[i] === 1 && strokeDist[i] > effectiveMaxRadius) {
      thickDist[i] = 0;
      queue[tail++] = i;
    }
  }

  while (head < tail) {
    const curr = queue[head++];
    const nextDist = thickDist[curr] + 1;
    if (nextDist > dilateRadius) continue;
    const cx = curr % width;
    const cy = Math.floor(curr / width);

    for (let i = 0; i < DIRS_8.length; i++) {
      const nx = cx + DIRS_8[i][0];
      const ny = cy + DIRS_8[i][1];
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const nIdx = ny * width + nx;
      if (isDark[nIdx] === 1 && thickDist[nIdx] > nextDist) {
        thickDist[nIdx] = nextDist;
        queue[tail++] = nIdx;
      }
    }
  }

  return thickDist;
}

function pruneSmallComponents8(
  cleanLineMask: Uint8Array,
  width: number,
  height: number,
  minPixels: number,
  queue: Int32Array
): number {
  const total = width * height;
  const visited = new Uint8Array(total);
  let linePixelCount = 0;

  for (let start = 0; start < total; start++) {
    if (cleanLineMask[start] !== 1 || visited[start] === 1) continue;

    let head = 0;
    let tail = 0;
    visited[start] = 1;
    queue[tail++] = start;

    while (head < tail) {
      const curr = queue[head++];
      const cx = curr % width;
      const cy = Math.floor(curr / width);

      for (let i = 0; i < DIRS_8.length; i++) {
        const nx = cx + DIRS_8[i][0];
        const ny = cy + DIRS_8[i][1];
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const nIdx = ny * width + nx;
        if (cleanLineMask[nIdx] === 1 && visited[nIdx] === 0) {
          visited[nIdx] = 1;
          queue[tail++] = nIdx;
        }
      }
    }

    if (tail < minPixels) {
      for (let k = 0; k < tail; k++) {
        cleanLineMask[queue[k]] = 0;
      }
    } else {
      linePixelCount += tail;
    }
  }

  return linePixelCount;
}

function extractThinNonPaperLines(
  isDark: Uint8Array,
  width: number,
  height: number,
  effectiveMaxRadius: number,
  activeCount: number
): { cleanLineMask: Uint8Array; linePixelCount: number } {
  const total = width * height;
  const cleanLineMask = new Uint8Array(total);
  const queue = new Int32Array(total);
  const strokeDist = computeBackgroundDistance8(isDark, width, height, effectiveMaxRadius, queue);
  const dilateRadius = effectiveMaxRadius + 2;
  const thickDist = computeThickCoreDilation8(
    isDark,
    strokeDist,
    width,
    height,
    effectiveMaxRadius,
    dilateRadius,
    queue
  );

  for (let i = 0; i < total; i++) {
    if (
      isDark[i] === 1 &&
      strokeDist[i] >= 1 &&
      strokeDist[i] <= effectiveMaxRadius &&
      thickDist[i] > dilateRadius
    ) {
      cleanLineMask[i] = 1;
    }
  }

  const effectiveSpan = Math.min(width, height, Math.floor(Math.sqrt(activeCount)));
  const minComponentPixels = Math.min(
    MAX_NON_PAPER_MIN_COMPONENT_PIXELS,
    Math.max(2, Math.floor(effectiveSpan / 3))
  );
  const linePixelCount = pruneSmallComponents8(
    cleanLineMask,
    width,
    height,
    minComponentPixels,
    queue
  );

  return { cleanLineMask, linePixelCount };
}

function hasMultipleAdjacentRegions(
  regionMap: Int32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  idx: number,
  activeMask?: Uint8Array
): boolean {
  let rFirst = -1;
  for (let i = 0; i < DIRS_4.length; i++) {
    const nx = x + DIRS_4[i][0];
    const ny = y + DIRS_4[i][1];
    if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
    const nIdx = idx + DIRS_4[i][1] * width + DIRS_4[i][0];
    if (activeMask && activeMask[nIdx] !== 1) continue;
    const nr = regionMap[nIdx];
    if (nr > 0) {
      if (rFirst === -1) rFirst = nr;
      else if (nr !== rFirst) return true;
    }
  }
  return false;
}

export class LineArtExtractor {
  /**
   * Extracts thin continuous ink outlines and drawn borders from artwork.
   * Uses morphological stroke-thickness analysis and bilateral dark-ridge
   * detection to distinguish thin black or colored ink outlines from large
   * dark color regions (such as dark fur, eyes, or shadows).
   */
  static extract(
    rgbaData: Uint8ClampedArray | Uint8Array,
    width: number,
    height: number,
    darkThreshold?: number,
    maxStrokeRadius?: number,
    activeMask?: Uint8Array
  ): LineArtAnalysis {
    const total = width * height;
    if (total <= 0) {
      return {
        isLineArt: false,
        lineMask: new Uint8Array(0),
        linePixelCount: 0,
        lineRatio: 0,
      };
    }

    const { lum, hist, brightCount, activeCount } = computeLuminanceStats(
      rgbaData,
      total,
      activeMask
    );
    if (activeCount === 0) {
      return {
        isLineArt: false,
        lineMask: new Uint8Array(total),
        linePixelCount: 0,
        lineRatio: 0,
      };
    }

    const brightRatio = brightCount / activeCount;
    const isPaperDrawing = brightRatio >= 0.45;
    const { effectiveThreshold, effectiveMaxRadius } = resolveExtractionThresholds(
      hist,
      activeCount,
      isPaperDrawing,
      darkThreshold,
      maxStrokeRadius
    );

    const isCoreDark = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
      if ((!activeMask || activeMask[i] === 1) && lum[i] <= effectiveThreshold) {
        isCoreDark[i] = 1;
      }
    }
    const isDark = new Uint8Array(isCoreDark);

    const edgeLuminanceLimit = isPaperDrawing ? Math.min(160, effectiveThreshold + 40) : 55;
    markSobelAntiAliasedEdges(
      lum,
      isCoreDark,
      isDark,
      width,
      height,
      edgeLuminanceLimit,
      isPaperDrawing,
      activeMask
    );

    if (darkThreshold === undefined) {
      detectColoredInkRidges(lum, isDark, width, height, activeMask);
    }

    let cleanLineMask: Uint8Array;
    let linePixelCount = 0;

    if (isPaperDrawing) {
      cleanLineMask = new Uint8Array(total);
      for (let i = 0; i < total; i++) {
        if (isDark[i] === 1) {
          cleanLineMask[i] = 1;
          linePixelCount++;
        }
      }
    } else {
      const extracted = extractThinNonPaperLines(
        isDark,
        width,
        height,
        effectiveMaxRadius,
        activeCount
      );
      cleanLineMask = extracted.cleanLineMask;
      linePixelCount = extracted.linePixelCount;
    }

    const lineRatio = linePixelCount / activeCount;
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
   * When activeMask is provided, pixels with activeMask[i] !== 1 are never read
   * as neighbors or modified.
   */
  static alignBoundariesToLines(
    regionMap: Int32Array,
    lineMask: Uint8Array,
    width: number,
    height: number,
    activeMask?: Uint8Array
  ): void {
    const total = width * height;
    const multiTouchLine = new Uint8Array(total);
    const queue = new Int32Array(total);
    let head = 0;
    let tail = 0;

    // Pass 1: Identify active line pixels that separate 2 or more distinct regions
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        const idx = row + x;
        if (lineMask[idx] !== 1) continue;
        if (activeMask && activeMask[idx] !== 1) continue;
        if (hasMultipleAdjacentRegions(regionMap, width, height, x, y, idx, activeMask)) {
          multiTouchLine[idx] = 1;
        }
      }
    }

    // Clear all multi-touch line pixels after Pass 1 completes so Pass-1 neighbor checks
    // never observe in-place mutations from earlier scan coordinates. Snapshot original
    // positive region IDs so isolated 100%-line-covered masked islands are restored if unseeded.
    const savedRegionIds = this.snapshotAndClearMultiTouchLine(regionMap, multiTouchLine);

    // Pass 2: Seed watershed propagation from neighboring colored regions without mutating
    // regionMap in-place during the scan so medial-axis symmetry is preserved.
    const seedValues = new Int32Array(total);
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        const idx = row + x;
        if (multiTouchLine[idx] === 1 && regionMap[idx] === -1) {
          const neighborR = this.findSeedNeighbor(
            regionMap,
            lineMask,
            width,
            height,
            x,
            y,
            idx,
            activeMask
          );
          if (neighborR > 0) {
            queue[tail] = idx;
            seedValues[tail] = neighborR;
            tail++;
          }
        }
      }
    }

    for (let i = 0; i < tail; i++) {
      regionMap[queue[i]] = seedValues[i];
    }

    // Pass 3: Multi-source BFS watershed expansion
    while (head < tail) {
      const curr = queue[head++];
      const rId = regionMap[curr];
      const cx = curr % width;
      const cy = Math.floor(curr / width);

      for (let i = 0; i < DIRS_4.length; i++) {
        const nx = cx + DIRS_4[i][0];
        const ny = cy + DIRS_4[i][1];
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const nIdx = ny * width + nx;
        if (activeMask && activeMask[nIdx] !== 1) continue;
        if (multiTouchLine[nIdx] === 1 && regionMap[nIdx] === -1) {
          regionMap[nIdx] = rId;
          queue[tail++] = nIdx;
        }
      }
    }

    // Pass 4: Restore original region IDs for any cleared pixels that received no watershed seed
    // (e.g., an isolated masked island completely covered by multi-touch line pixels).
    this.restoreUnseededLinePixels(regionMap, multiTouchLine, savedRegionIds);
  }

  private static snapshotAndClearMultiTouchLine(
    regionMap: Int32Array,
    multiTouchLine: Uint8Array
  ): Int32Array {
    const savedRegionIds = new Int32Array(regionMap.length);
    for (let i = 0; i < regionMap.length; i++) {
      if (multiTouchLine[i] === 1) {
        savedRegionIds[i] = regionMap[i];
        regionMap[i] = -1;
      }
    }
    return savedRegionIds;
  }

  private static restoreUnseededLinePixels(
    regionMap: Int32Array,
    multiTouchLine: Uint8Array,
    savedRegionIds: Int32Array
  ): void {
    for (let i = 0; i < regionMap.length; i++) {
      if (multiTouchLine[i] === 1 && regionMap[i] === -1 && savedRegionIds[i] > 0) {
        regionMap[i] = savedRegionIds[i];
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
    idx: number,
    activeMask?: Uint8Array
  ): number {
    for (let i = 0; i < DIRS_4.length; i++) {
      const nx = x + DIRS_4[i][0];
      const ny = y + DIRS_4[i][1];
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const nIdx = idx + DIRS_4[i][1] * width + DIRS_4[i][0];
      if (activeMask && activeMask[nIdx] !== 1) continue;
      if (lineMask[nIdx] === 0 && regionMap[nIdx] > 0) return regionMap[nIdx];
    }

    for (let i = 0; i < DIRS_4.length; i++) {
      const nx = x + DIRS_4[i][0];
      const ny = y + DIRS_4[i][1];
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const nIdx = idx + DIRS_4[i][1] * width + DIRS_4[i][0];
      if (activeMask && activeMask[nIdx] !== 1) continue;
      if (regionMap[nIdx] > 0) return regionMap[nIdx];
    }

    return -1;
  }

  /**
   * Symmetrically absorbs black line pixels into their adjacent enclosed cel regions.
   */
  static absorbLinesIntoRegions(
    regionMap: Int32Array,
    lineMask: Uint8Array,
    width: number,
    height: number,
    activeMask?: Uint8Array
  ): void {
    this.alignBoundariesToLines(regionMap, lineMask, width, height, activeMask);
  }
}
