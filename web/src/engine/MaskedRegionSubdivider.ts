import { PaletteColor, PuzzleData, Region } from '../types';
import { ColorQuantizer } from './ColorQuantizer';

export const MAX_TOTAL_PALETTE_SWATCHES = 64;
export const DEFAULT_MAX_NEW_SWATCHES = 6;
export const DEFAULT_REUSE_DELTA_E = 22;

export interface SubdivideMaskedRegionParams {
  rgbaData: Uint8ClampedArray;
  cropWidth: number;
  cropHeight: number;
  cropMask: Uint8Array;
  existingPalette: PaletteColor[];
  isFreeColor?: boolean;
  targetSubRegions?: number;
  minRegionArea?: number;
  maxNewSwatches?: number;
  reuseDeltaE?: number;
  onProgress?: (progress: number, status: string) => void;
}

export interface MaskedSubdivisionResult {
  width: number;
  height: number;
  /** 1-based local region IDs strictly where cropMask[i] === 1; 0 elsewhere */
  localRegionMap: Int32Array;
  /** Regions in crop-local coordinates with scanline-ordered local pixel indices */
  regions: Region[];
  /** Cloned existingPalette plus any newly added harmonious accent swatches */
  palette: PaletteColor[];
  addedSwatches: PaletteColor[];
}

export interface SubdivisionBbox {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

export interface MaskedPixelCollection {
  maskedIndices: Int32Array;
  rArr: Uint8Array;
  gArr: Uint8Array;
  bArr: Uint8Array;
  maskedCount: number;
}

export interface MaskedQuantizeResult {
  assignments: Int32Array;
  centroidsR: Float64Array;
  centroidsG: Float64Array;
  centroidsB: Float64Array;
  effectiveK: number;
}

export interface MaskedComponentSegment {
  id: number;
  pixels: Int32Array;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface MaskedSegmentationResult {
  localRegionMap: Int32Array;
  segments: MaskedComponentSegment[];
}

export function createPaletteColor(id: number, r: number, g: number, b: number): PaletteColor {
  const cr = Math.max(0, Math.min(255, Math.round(r)));
  const cg = Math.max(0, Math.min(255, Math.round(g)));
  const cb = Math.max(0, Math.min(255, Math.round(b)));
  const lum = 0.299 * cr + 0.587 * cg + 0.114 * cb;
  const hex = `#${((1 << 24) | (cr << 16) | (cg << 8) | cb).toString(16).slice(1).toUpperCase()}`;
  const argb = ((0xff << 24) | (cr << 16) | (cg << 8) | cb) >>> 0;
  return { id, hex, isLight: lum > 140, argb, r: cr, g: cg, b: cb };
}

export function buildBorderMap(regionMap: Int32Array, width: number, height: number): Uint8Array {
  const total = width * height;
  const borderMap = new Uint8Array(total);
  for (let y = 0; y < height; y++) {
    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      const idx = rowOff + x;
      const rid = regionMap[idx];
      if (
        (x < width - 1 && regionMap[idx + 1] !== rid) ||
        (y < height - 1 && regionMap[idx + width] !== rid)
      ) {
        borderMap[idx] = 1;
      }
    }
  }
  return borderMap;
}

export function collectMaskedPixels(
  rgbaData: Uint8ClampedArray,
  cropWidth: number,
  cropHeight: number,
  cropMask: Uint8Array
): MaskedPixelCollection {
  if (cropWidth <= 0 || cropHeight <= 0) {
    return {
      maskedIndices: new Int32Array(0),
      rArr: new Uint8Array(0),
      gArr: new Uint8Array(0),
      bArr: new Uint8Array(0),
      maskedCount: 0,
    };
  }
  const total = cropWidth * cropHeight;
  const limit = Math.min(total, cropMask.length, Math.floor(rgbaData.length / 4));
  let maskedCount = 0;
  for (let i = 0; i < limit; i++) {
    if (cropMask[i] === 1) maskedCount++;
  }
  const maskedIndices = new Int32Array(maskedCount);
  const rArr = new Uint8Array(maskedCount);
  const gArr = new Uint8Array(maskedCount);
  const bArr = new Uint8Array(maskedCount);
  let pos = 0;
  for (let i = 0; i < limit; i++) {
    if (cropMask[i] === 1) {
      maskedIndices[pos] = i;
      const rgbaIdx = i * 4;
      rArr[pos] = rgbaData[rgbaIdx];
      gArr[pos] = rgbaData[rgbaIdx + 1];
      bArr[pos] = rgbaData[rgbaIdx + 2];
      pos++;
    }
  }
  return { maskedIndices, rArr, gArr, bArr, maskedCount };
}

function createDeterministicRng(
  maskedCount: number,
  targetK: number,
  rArr: Uint8Array,
  gArr: Uint8Array,
  bArr: Uint8Array
): () => number {
  let seed = (2166136261 ^ maskedCount ^ targetK) >>> 0;
  const step = Math.max(1, Math.floor(maskedCount / 256));
  for (let m = 0; m < maskedCount; m += step) {
    const val = (rArr[m] << 16) | (gArr[m] << 8) | bArr[m];
    seed = Math.imul(seed ^ val, 16777619) >>> 0;
  }
  let state = seed || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFirstMaskedCentroid(
  rArr: Uint8Array,
  gArr: Uint8Array,
  bArr: Uint8Array,
  actualK: number
): { r: number; g: number; b: number } {
  const maskedCount = rArr.length;
  if (actualK === 1) {
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    for (let m = 0; m < maskedCount; m++) {
      sumR += rArr[m];
      sumG += gArr[m];
      sumB += bArr[m];
    }
    return { r: sumR / maskedCount, g: sumG / maskedCount, b: sumB / maskedCount };
  }
  const bucketCounts = new Int32Array(32768);
  for (let m = 0; m < maskedCount; m++) {
    const key = ((rArr[m] >> 3) << 10) | ((gArr[m] >> 3) << 5) | (bArr[m] >> 3);
    bucketCounts[key]++;
  }
  let bestKey = 0;
  let bestCount = -1;
  for (let key = 0; key < 32768; key++) {
    if (bucketCounts[key] > bestCount) {
      bestCount = bucketCounts[key];
      bestKey = key;
    }
  }
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;
  for (let m = 0; m < maskedCount; m++) {
    const key = ((rArr[m] >> 3) << 10) | ((gArr[m] >> 3) << 5) | (bArr[m] >> 3);
    if (key === bestKey) {
      sumR += rArr[m];
      sumG += gArr[m];
      sumB += bArr[m];
      count++;
    }
  }
  return count > 0
    ? { r: sumR / count, g: sumG / count, b: sumB / count }
    : { r: rArr[0], g: gArr[0], b: bArr[0] };
}

function seedMaskedCentroids(
  rArr: Uint8Array,
  gArr: Uint8Array,
  bArr: Uint8Array,
  actualK: number,
  nextRng: () => number
): { centroidsR: Float64Array; centroidsG: Float64Array; centroidsB: Float64Array; effectiveK: number } {
  const maskedCount = rArr.length;
  const centroidsR = new Float64Array(actualK);
  const centroidsG = new Float64Array(actualK);
  const centroidsB = new Float64Array(actualK);
  const first = seedFirstMaskedCentroid(rArr, gArr, bArr, actualK);
  centroidsR[0] = first.r;
  centroidsG[0] = first.g;
  centroidsB[0] = first.b;

  let effectiveK = 1;
  if (actualK <= 1) {
    return { centroidsR, centroidsG, centroidsB, effectiveK };
  }

  const minDistances = new Float64Array(maskedCount).fill(Number.MAX_VALUE);
  for (let c = 1; c < actualK; c++) {
    const prevR = centroidsR[c - 1];
    const prevG = centroidsG[c - 1];
    const prevB = centroidsB[c - 1];
    let sumDistances = 0;
    for (let m = 0; m < maskedCount; m++) {
      const d = ColorQuantizer.perceptualDistanceSq(rArr[m], gArr[m], bArr[m], prevR, prevG, prevB);
      if (d < minDistances[m]) {
        minDistances[m] = d;
      }
      sumDistances += minDistances[m];
    }
    if (sumDistances <= 0) {
      break;
    }
    let target = nextRng() * sumDistances;
    let chosen = maskedCount - 1;
    for (let m = 0; m < maskedCount; m++) {
      target -= minDistances[m];
      if (target <= 0) {
        chosen = m;
        break;
      }
    }
    centroidsR[c] = rArr[chosen];
    centroidsG[c] = gArr[chosen];
    centroidsB[c] = bArr[chosen];
    effectiveK = c + 1;
  }
  return { centroidsR, centroidsG, centroidsB, effectiveK };
}

function findWorstErrorMaskedPixel(
  rArr: Uint8Array,
  gArr: Uint8Array,
  bArr: Uint8Array,
  localCluster: Int32Array,
  centroidsR: Float64Array,
  centroidsG: Float64Array,
  centroidsB: Float64Array
): number {
  const maskedCount = rArr.length;
  const stride = Math.max(1, Math.floor(maskedCount / 512));
  let worstIdx = 0;
  let worstDist = -1;
  for (let m = 0; m < maskedCount; m += stride) {
    const c = localCluster[m];
    const d = ColorQuantizer.perceptualDistanceSq(
      rArr[m],
      gArr[m],
      bArr[m],
      centroidsR[c],
      centroidsG[c],
      centroidsB[c]
    );
    if (d > worstDist) {
      worstDist = d;
      worstIdx = m;
    }
  }
  return worstIdx;
}

function runMaskedKMeansIterations(
  rArr: Uint8Array,
  gArr: Uint8Array,
  bArr: Uint8Array,
  centroidsR: Float64Array,
  centroidsG: Float64Array,
  centroidsB: Float64Array,
  effectiveK: number
): Int32Array {
  const maskedCount = rArr.length;
  const localCluster = new Int32Array(maskedCount).fill(-1);
  if (effectiveK <= 1) {
    localCluster.fill(0);
    return localCluster;
  }
  const sumR = new Float64Array(effectiveK);
  const sumG = new Float64Array(effectiveK);
  const sumB = new Float64Array(effectiveK);
  const counts = new Int32Array(effectiveK);

  for (let iter = 0; iter < 12; iter++) {
    sumR.fill(0);
    sumG.fill(0);
    sumB.fill(0);
    counts.fill(0);
    let changed = false;

    for (let m = 0; m < maskedCount; m++) {
      const r = rArr[m];
      const g = gArr[m];
      const b = bArr[m];
      let bestC = 0;
      let bestD = ColorQuantizer.perceptualDistanceSq(r, g, b, centroidsR[0], centroidsG[0], centroidsB[0]);
      for (let c = 1; c < effectiveK; c++) {
        const d = ColorQuantizer.perceptualDistanceSq(r, g, b, centroidsR[c], centroidsG[c], centroidsB[c]);
        if (d < bestD) {
          bestD = d;
          bestC = c;
        }
      }
      if (localCluster[m] !== bestC) {
        localCluster[m] = bestC;
        changed = true;
      }
      sumR[bestC] += r;
      sumG[bestC] += g;
      sumB[bestC] += b;
      counts[bestC]++;
    }

    for (let c = 0; c < effectiveK; c++) {
      if (counts[c] > 0) {
        centroidsR[c] = sumR[c] / counts[c];
        centroidsG[c] = sumG[c] / counts[c];
        centroidsB[c] = sumB[c] / counts[c];
      } else {
        const worst = findWorstErrorMaskedPixel(
          rArr,
          gArr,
          bArr,
          localCluster,
          centroidsR,
          centroidsG,
          centroidsB
        );
        centroidsR[c] = rArr[worst];
        centroidsG[c] = gArr[worst];
        centroidsB[c] = bArr[worst];
        changed = true;
      }
    }

    if (!changed && iter >= 3) {
      break;
    }
  }
  return localCluster;
}

function pickSmoothedClusterAtPixel(
  idx: number,
  width: number,
  height: number,
  cropMask: Uint8Array,
  assignments: Int32Array,
  centroidsR: Float64Array,
  centroidsG: Float64Array,
  centroidsB: Float64Array,
  freq: Int32Array,
  effectiveK: number
): number {
  const curr = assignments[idx];
  const px = idx % width;
  const py = (idx - px) / width;
  for (let c = 0; c < effectiveK; c++) freq[c] = 0;

  const y0 = py > 0 ? py - 1 : 0;
  const y1 = py < height - 1 ? py + 1 : height - 1;
  const x0 = px > 0 ? px - 1 : 0;
  const x1 = px < width - 1 ? px + 1 : width - 1;
  for (let ny = y0; ny <= y1; ny++) {
    const rowOff = ny * width;
    for (let nx = x0; nx <= x1; nx++) {
      const nIdx = rowOff + nx;
      if (cropMask[nIdx] === 1) {
        const nc = assignments[nIdx];
        if (nc >= 0) freq[nc]++;
      }
    }
  }

  const currRawFreq = freq[curr];
  let bestC = curr;
  let bestScore = currRawFreq + 2;
  for (let c = 0; c < effectiveK; c++) {
    if (c === curr) continue;
    if (freq[c] > bestScore) {
      bestScore = freq[c];
      bestC = c;
    }
  }
  if (bestC !== curr && currRawFreq >= 3) {
    const distSq = ColorQuantizer.perceptualDistanceSq(
      centroidsR[curr],
      centroidsG[curr],
      centroidsB[curr],
      centroidsR[bestC],
      centroidsG[bestC],
      centroidsB[bestC]
    );
    if (distSq > 2500) {
      return curr;
    }
  }
  return bestC;
}

function smoothMaskedAssignments(
  assignments: Int32Array,
  maskedIndices: Int32Array,
  cropMask: Uint8Array,
  width: number,
  height: number,
  centroidsR: Float64Array,
  centroidsG: Float64Array,
  centroidsB: Float64Array,
  effectiveK: number
): Int32Array {
  const next = new Int32Array(assignments);
  const freq = new Int32Array(effectiveK);
  for (let m = 0; m < maskedIndices.length; m++) {
    const idx = maskedIndices[m];
    next[idx] = pickSmoothedClusterAtPixel(
      idx,
      width,
      height,
      cropMask,
      assignments,
      centroidsR,
      centroidsG,
      centroidsB,
      freq,
      effectiveK
    );
  }
  return next;
}

export function quantizeMaskedPixels(
  _rgbaData: Uint8ClampedArray,
  width: number,
  height: number,
  cropMask: Uint8Array,
  maskedIndices: Int32Array,
  rArr: Uint8Array,
  gArr: Uint8Array,
  bArr: Uint8Array,
  targetK: number,
  applySmoothing: boolean
): MaskedQuantizeResult {
  const total = Math.max(0, width * height);
  let assignments: Int32Array = new Int32Array(total).fill(-1);
  const maskedCount = maskedIndices.length;
  if (maskedCount === 0) {
    return {
      assignments,
      centroidsR: new Float64Array(0),
      centroidsG: new Float64Array(0),
      centroidsB: new Float64Array(0),
      effectiveK: 0,
    };
  }

  const actualK = Math.max(1, Math.min(Math.floor(targetK), maskedCount));
  const nextRng = createDeterministicRng(maskedCount, actualK, rArr, gArr, bArr);
  const { centroidsR, centroidsG, centroidsB, effectiveK } = seedMaskedCentroids(
    rArr,
    gArr,
    bArr,
    actualK,
    nextRng
  );
  const localCluster = runMaskedKMeansIterations(
    rArr,
    gArr,
    bArr,
    centroidsR,
    centroidsG,
    centroidsB,
    effectiveK
  );

  for (let m = 0; m < maskedCount; m++) {
    assignments[maskedIndices[m]] = localCluster[m];
  }

  if (applySmoothing && effectiveK > 1 && maskedCount >= 16) {
    assignments = smoothMaskedAssignments(
      assignments,
      maskedIndices,
      cropMask,
      width,
      height,
      centroidsR,
      centroidsG,
      centroidsB,
      effectiveK
    );
  }

  return { assignments, centroidsR, centroidsG, centroidsB, effectiveK };
}

class RootAreaMinHeap {
  private areas: Int32Array;
  private roots: Int32Array;
  private count = 0;

  constructor(initialCapacity: number) {
    const cap = Math.max(16, initialCapacity);
    this.areas = new Int32Array(cap);
    this.roots = new Int32Array(cap);
  }

  get size(): number {
    return this.count;
  }

  push(area: number, root: number): void {
    if (this.count >= this.areas.length) {
      const nextAreas = new Int32Array(this.areas.length * 2);
      const nextRoots = new Int32Array(this.roots.length * 2);
      nextAreas.set(this.areas);
      nextRoots.set(this.roots);
      this.areas = nextAreas;
      this.roots = nextRoots;
    }
    let i = this.count++;
    this.areas[i] = area;
    this.roots[i] = root;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.less(i, p)) {
        this.swap(i, p);
        i = p;
      } else {
        break;
      }
    }
  }

  pop(): { area: number; root: number } {
    const area = this.areas[0];
    const root = this.roots[0];
    this.count--;
    if (this.count > 0) {
      this.areas[0] = this.areas[this.count];
      this.roots[0] = this.roots[this.count];
      this.siftDown(0);
    }
    return { area, root };
  }

  private less(a: number, b: number): boolean {
    if (this.areas[a] !== this.areas[b]) {
      return this.areas[a] < this.areas[b];
    }
    return this.roots[a] < this.roots[b];
  }

  private swap(a: number, b: number): void {
    const tmpA = this.areas[a];
    const tmpR = this.roots[a];
    this.areas[a] = this.areas[b];
    this.roots[a] = this.roots[b];
    this.areas[b] = tmpA;
    this.roots[b] = tmpR;
  }

  private siftDown(start: number): void {
    let i = start;
    while (true) {
      const left = i * 2 + 1;
      const right = left + 1;
      let smallest = i;
      if (left < this.count && this.less(left, smallest)) smallest = left;
      if (right < this.count && this.less(right, smallest)) smallest = right;
      if (smallest === i) break;
      this.swap(i, smallest);
      i = smallest;
    }
  }
}

interface MaskedMergeState {
  width: number;
  height: number;
  cropMask: Uint8Array;
  compMap: Int32Array;
  compPixels: number[][];
  parent: Int32Array;
  areas: Int32Array;
  sumR: Float64Array;
  sumG: Float64Array;
  sumB: Float64Array;
  rootComponents: number[][];
}

function findRoot(parent: Int32Array, node: number): number {
  let root = node;
  while (parent[root] !== root) {
    root = parent[root];
  }
  let curr = node;
  while (curr !== root) {
    const next = parent[curr];
    parent[curr] = root;
    curr = next;
  }
  return root;
}

function traceMaskedComponents(
  assignments: Int32Array,
  cropMask: Uint8Array,
  maskedIndices: Int32Array,
  rgbaData: Uint8ClampedArray,
  width: number,
  height: number
): MaskedMergeState {
  const total = width * height;
  const compMap = new Int32Array(total).fill(-1);
  const queue = new Int32Array(maskedIndices.length);
  const compPixels: number[][] = [];
  const compSumR: number[] = [];
  const compSumG: number[] = [];
  const compSumB: number[] = [];

  for (let m = 0; m < maskedIndices.length; m++) {
    const startIdx = maskedIndices[m];
    if (compMap[startIdx] !== -1) continue;
    const compId = compPixels.length;
    const targetCluster = assignments[startIdx];
    const pixels: number[] = [];
    let head = 0;
    let tail = 0;
    compMap[startIdx] = compId;
    queue[tail++] = startIdx;
    let sR = 0;
    let sG = 0;
    let sB = 0;

    while (head < tail) {
      const idx = queue[head++];
      pixels.push(idx);
      const rgbaOff = idx * 4;
      sR += rgbaData[rgbaOff];
      sG += rgbaData[rgbaOff + 1];
      sB += rgbaData[rgbaOff + 2];

      const x = idx % width;
      const y = (idx - x) / width;
      if (x > 0) {
        const n = idx - 1;
        if (cropMask[n] === 1 && compMap[n] === -1 && assignments[n] === targetCluster) {
          compMap[n] = compId;
          queue[tail++] = n;
        }
      }
      if (x < width - 1) {
        const n = idx + 1;
        if (cropMask[n] === 1 && compMap[n] === -1 && assignments[n] === targetCluster) {
          compMap[n] = compId;
          queue[tail++] = n;
        }
      }
      if (y > 0) {
        const n = idx - width;
        if (cropMask[n] === 1 && compMap[n] === -1 && assignments[n] === targetCluster) {
          compMap[n] = compId;
          queue[tail++] = n;
        }
      }
      if (y < height - 1) {
        const n = idx + width;
        if (cropMask[n] === 1 && compMap[n] === -1 && assignments[n] === targetCluster) {
          compMap[n] = compId;
          queue[tail++] = n;
        }
      }
    }

    compPixels.push(pixels);
    compSumR.push(sR);
    compSumG.push(sG);
    compSumB.push(sB);
  }

  const compCount = compPixels.length;
  const parent = new Int32Array(compCount);
  const areas = new Int32Array(compCount);
  const sumR = new Float64Array(compCount);
  const sumG = new Float64Array(compCount);
  const sumB = new Float64Array(compCount);
  const rootComponents = Array.from({ length: compCount }, (_, i) => [i]);
  for (let i = 0; i < compCount; i++) {
    parent[i] = i;
    areas[i] = compPixels[i].length;
    sumR[i] = compSumR[i];
    sumG[i] = compSumG[i];
    sumB[i] = compSumB[i];
  }
  return { width, height, cropMask, compMap, compPixels, parent, areas, sumR, sumG, sumB, rootComponents };
}

function recordTouch(
  nIdx: number,
  root: number,
  state: MaskedMergeState,
  touches: Map<number, number>
): void {
  if (state.cropMask[nIdx] !== 1) return;
  const nComp = state.compMap[nIdx];
  if (nComp < 0) return;
  const nRoot = findRoot(state.parent, nComp);
  if (nRoot !== root) {
    touches.set(nRoot, (touches.get(nRoot) ?? 0) + 1);
  }
}

function collectMaskedNeighborTouches(root: number, state: MaskedMergeState): Map<number, number> {
  const touches = new Map<number, number>();
  const members = state.rootComponents[root];
  const { width, height, compPixels } = state;
  for (let i = 0; i < members.length; i++) {
    const pixels = compPixels[members[i]];
    for (let p = 0; p < pixels.length; p++) {
      const idx = pixels[p];
      const x = idx % width;
      const y = (idx - x) / width;
      if (x > 0) recordTouch(idx - 1, root, state, touches);
      if (x < width - 1) recordTouch(idx + 1, root, state, touches);
      if (y > 0) recordTouch(idx - width, root, state, touches);
      if (y < height - 1) recordTouch(idx + width, root, state, touches);
    }
  }
  return touches;
}

function pickBestMaskedNeighbor(
  root: number,
  touches: Map<number, number>,
  state: MaskedMergeState
): number {
  const areaA = Math.max(1, state.areas[root]);
  const rA = state.sumR[root] / areaA;
  const gA = state.sumG[root] / areaA;
  const bA = state.sumB[root] / areaA;

  let bestNeighbor = -1;
  let bestScore = -1;
  for (const [nRoot, touch] of touches.entries()) {
    const areaB = Math.max(1, state.areas[nRoot]);
    const rB = state.sumR[nRoot] / areaB;
    const gB = state.sumG[nRoot] / areaB;
    const bB = state.sumB[nRoot] / areaB;
    const deltaE = Math.sqrt(ColorQuantizer.perceptualDistanceSq(rA, gA, bA, rB, gB, bB));
    const score = Math.pow(touch, 1.25) / (deltaE + 8);
    if (score > bestScore || (score === bestScore && (bestNeighbor < 0 || nRoot < bestNeighbor))) {
      bestScore = score;
      bestNeighbor = nRoot;
    }
  }
  return bestNeighbor;
}

function mergeRootInto(src: number, dst: number, state: MaskedMergeState): void {
  state.parent[src] = dst;
  state.areas[dst] += state.areas[src];
  state.sumR[dst] += state.sumR[src];
  state.sumG[dst] += state.sumG[src];
  state.sumB[dst] += state.sumB[src];
  const srcList = state.rootComponents[src];
  const dstList = state.rootComponents[dst];
  for (let i = 0; i < srcList.length; i++) {
    dstList.push(srcList[i]);
  }
  state.rootComponents[src] = [];
}

function mergeSmallMaskedIslands(state: MaskedMergeState, minRegionArea: number): void {
  const compCount = state.parent.length;
  if (minRegionArea <= 1 || compCount <= 1) return;
  for (let pass = 0; pass < 8; pass++) {
    const candidates: number[] = [];
    for (let r = 0; r < compCount; r++) {
      if (state.parent[r] === r && state.areas[r] < minRegionArea) {
        candidates.push(r);
      }
    }
    if (candidates.length === 0) break;
    candidates.sort((a, b) => (state.areas[a] !== state.areas[b] ? state.areas[a] - state.areas[b] : a - b));
    let mergedThisPass = 0;
    for (let i = 0; i < candidates.length; i++) {
      const root = findRoot(state.parent, candidates[i]);
      if (state.areas[root] >= minRegionArea) continue;
      const touches = collectMaskedNeighborTouches(root, state);
      if (touches.size === 0) continue;
      const dst = pickBestMaskedNeighbor(root, touches, state);
      if (dst >= 0 && dst !== root) {
        mergeRootInto(root, dst, state);
        mergedThisPass++;
      }
    }
    if (mergedThisPass === 0) break;
  }
}

function enforceMaxRegionCap(state: MaskedMergeState, targetMaxRegions: number): void {
  const compCount = state.parent.length;
  const heap = new RootAreaMinHeap(compCount);
  let activeCount = 0;
  for (let r = 0; r < compCount; r++) {
    if (state.parent[r] === r) {
      heap.push(state.areas[r], r);
      activeCount++;
    }
  }
  if (activeCount <= targetMaxRegions) return;

  const isolated = new Uint8Array(compCount);
  let mergeableCount = activeCount;
  while (mergeableCount > targetMaxRegions && heap.size > 0) {
    const { area, root } = heap.pop();
    if (findRoot(state.parent, root) !== root || isolated[root] === 1) continue;
    if (state.areas[root] !== area) {
      heap.push(state.areas[root], root);
      continue;
    }
    const touches = collectMaskedNeighborTouches(root, state);
    if (touches.size === 0) {
      isolated[root] = 1;
      mergeableCount--;
      continue;
    }
    const dst = pickBestMaskedNeighbor(root, touches, state);
    if (dst >= 0 && dst !== root) {
      mergeRootInto(root, dst, state);
      mergeableCount--;
      heap.push(state.areas[dst], dst);
    } else {
      isolated[root] = 1;
      mergeableCount--;
    }
  }
}

function flattenMaskedComponents(
  state: MaskedMergeState,
  maskedIndices: Int32Array
): MaskedSegmentationResult {
  const { width, height, compMap, parent } = state;
  const localRegionMap = new Int32Array(width * height);
  const rootToFinalId = new Int32Array(parent.length);
  const finalCounts: number[] = [];

  for (let m = 0; m < maskedIndices.length; m++) {
    const idx = maskedIndices[m];
    const root = findRoot(parent, compMap[idx]);
    let finalId = rootToFinalId[root];
    if (finalId === 0) {
      finalId = finalCounts.length + 1;
      rootToFinalId[root] = finalId;
      finalCounts.push(0);
    }
    localRegionMap[idx] = finalId;
    finalCounts[finalId - 1]++;
  }

  const regionCount = finalCounts.length;
  const segments: MaskedComponentSegment[] = [];
  const writeOffsets = new Int32Array(regionCount);
  for (let i = 0; i < regionCount; i++) {
    segments.push({
      id: i + 1,
      pixels: new Int32Array(finalCounts[i]),
      minX: width,
      maxX: 0,
      minY: height,
      maxY: 0,
    });
  }

  for (let m = 0; m < maskedIndices.length; m++) {
    const idx = maskedIndices[m];
    const slot = localRegionMap[idx] - 1;
    const seg = segments[slot];
    seg.pixels[writeOffsets[slot]++] = idx;
    const x = idx % width;
    const y = (idx - x) / width;
    if (x < seg.minX) seg.minX = x;
    if (x > seg.maxX) seg.maxX = x;
    if (y < seg.minY) seg.minY = y;
    if (y > seg.maxY) seg.maxY = y;
  }

  return { localRegionMap, segments };
}

export function segmentMaskedComponents(
  assignments: Int32Array,
  cropMask: Uint8Array,
  maskedIndices: Int32Array,
  rgbaData: Uint8ClampedArray,
  width: number,
  height: number,
  minRegionArea: number,
  targetMaxRegions: number
): MaskedSegmentationResult {
  if (maskedIndices.length === 0) {
    return { localRegionMap: new Int32Array(Math.max(0, width * height)), segments: [] };
  }
  const state = traceMaskedComponents(assignments, cropMask, maskedIndices, rgbaData, width, height);
  mergeSmallMaskedIslands(state, Math.max(1, Math.floor(minRegionArea)));
  enforceMaxRegionCap(state, Math.max(1, Math.floor(targetMaxRegions)));
  return flattenMaskedComponents(state, maskedIndices);
}

function isMaskedRegionPerimeter(
  idx: number,
  px: number,
  py: number,
  width: number,
  height: number,
  regionId: number,
  localRegionMap: Int32Array,
  cropMask: Uint8Array
): boolean {
  if (px === 0 || px === width - 1 || py === 0 || py === height - 1) return true;
  if (cropMask[idx - 1] === 0 || localRegionMap[idx - 1] !== regionId) return true;
  if (cropMask[idx + 1] === 0 || localRegionMap[idx + 1] !== regionId) return true;
  if (cropMask[idx - width] === 0 || localRegionMap[idx - width] !== regionId) return true;
  if (cropMask[idx + width] === 0 || localRegionMap[idx + width] !== regionId) return true;
  return false;
}

function computeSingleRegionCentroid(
  seg: MaskedComponentSegment,
  localRegionMap: Int32Array,
  cropMask: Uint8Array,
  width: number,
  height: number,
  distGrid: Int32Array,
  bfsQueue: Int32Array
): { centroidX: number; centroidY: number; maxRadius: number } {
  const pixels = seg.pixels;
  const count = pixels.length;
  const regionId = seg.id;

  if (count === 1) {
    const idx = pixels[0];
    const px = idx % width;
    const py = (idx - px) / width;
    return { centroidX: px + 0.5, centroidY: py + 0.5, maxRadius: 0.5 };
  }

  if (count <= 9) {
    let sumX = 0;
    let sumY = 0;
    for (let i = 0; i < count; i++) {
      const idx = pixels[i];
      const px = idx % width;
      sumX += px;
      sumY += (idx - px) / width;
    }
    const avgX = Math.max(0, Math.min(width - 1, Math.round(sumX / count)));
    const avgY = Math.max(0, Math.min(height - 1, Math.round(sumY / count)));
    const testIdx = avgY * width + avgX;
    let bestPx = avgX;
    let bestPy = avgY;
    if (cropMask[testIdx] !== 1 || localRegionMap[testIdx] !== regionId) {
      const fallbackIdx = pixels[0];
      bestPx = fallbackIdx % width;
      bestPy = (fallbackIdx - bestPx) / width;
    }
    return { centroidX: bestPx + 0.5, centroidY: bestPy + 0.5, maxRadius: Math.sqrt(count) * 0.5 };
  }

  let head = 0;
  let tail = 0;
  for (let i = 0; i < count; i++) {
    const idx = pixels[i];
    const px = idx % width;
    const py = (idx - px) / width;
    if (isMaskedRegionPerimeter(idx, px, py, width, height, regionId, localRegionMap, cropMask)) {
      distGrid[idx] = 1;
      bfsQueue[tail++] = idx;
    }
  }

  if (tail === 0) {
    distGrid[pixels[0]] = 1;
    bfsQueue[tail++] = pixels[0];
  }

  let maxDist = 1;
  let maxIdx = bfsQueue[0];
  while (head < tail) {
    const curr = bfsQueue[head++];
    const nextDist = distGrid[curr] + 1;
    const cx = curr % width;
    const cy = (curr - cx) / width;

    const tryStep = (nIdx: number) => {
      if (cropMask[nIdx] === 1 && localRegionMap[nIdx] === regionId && distGrid[nIdx] === 0) {
        distGrid[nIdx] = nextDist;
        bfsQueue[tail++] = nIdx;
        if (nextDist > maxDist) {
          maxDist = nextDist;
          maxIdx = nIdx;
        }
      }
    };

    if (cx > 0) tryStep(curr - 1);
    if (cx < width - 1) tryStep(curr + 1);
    if (cy > 0) tryStep(curr - width);
    if (cy < height - 1) tryStep(curr + width);
  }

  for (let i = 0; i < count; i++) {
    distGrid[pixels[i]] = 0;
  }

  const bestPx = maxIdx % width;
  const bestPy = (maxIdx - bestPx) / width;
  return { centroidX: bestPx + 0.5, centroidY: bestPy + 0.5, maxRadius: maxDist };
}

export function computeLocalRegionGeometry(
  segments: MaskedComponentSegment[],
  localRegionMap: Int32Array,
  cropMask: Uint8Array,
  width: number,
  height: number
): Region[] {
  const total = Math.max(0, width * height);
  const distGrid = new Int32Array(total);
  const bfsQueue = new Int32Array(total);
  const regions: Region[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const { centroidX, centroidY, maxRadius } = computeSingleRegionCentroid(
      seg,
      localRegionMap,
      cropMask,
      width,
      height,
      distGrid,
      bfsQueue
    );
    regions.push({
      id: seg.id,
      colorId: 1,
      centroidX,
      centroidY,
      area: seg.pixels.length,
      minX: seg.minX,
      maxX: seg.maxX,
      minY: seg.minY,
      maxY: seg.maxY,
      maxRadius,
      pixels: seg.pixels,
    });
  }
  return regions;
}

function buildLocalRegionAdjacency(
  localRegionMap: Int32Array,
  width: number,
  height: number
): Map<number, Set<number>> {
  const adj = new Map<number, Set<number>>();
  const addEdge = (a: number, b: number) => {
    let setA = adj.get(a);
    if (!setA) {
      setA = new Set<number>();
      adj.set(a, setA);
    }
    setA.add(b);
    let setB = adj.get(b);
    if (!setB) {
      setB = new Set<number>();
      adj.set(b, setB);
    }
    setB.add(a);
  };

  for (let y = 0; y < height; y++) {
    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      const idx = rowOff + x;
      const rid = localRegionMap[idx];
      if (rid <= 0) continue;
      if (x < width - 1) {
        const right = localRegionMap[idx + 1];
        if (right > 0 && right !== rid) addEdge(rid, right);
      }
      if (y < height - 1) {
        const down = localRegionMap[idx + width];
        if (down > 0 && down !== rid) addEdge(rid, down);
      }
    }
  }
  return adj;
}

export function assignFreeColorIds(
  regions: Region[],
  localRegionMap: Int32Array,
  width: number,
  height: number,
  existingPalette: PaletteColor[]
): { palette: PaletteColor[]; addedSwatches: PaletteColor[] } {
  const palette = existingPalette.map((c) => ({ ...c }));
  const usable = palette.length > 1 ? palette.slice(0, palette.length - 1) : palette;
  if (usable.length === 0) {
    for (let i = 0; i < regions.length; i++) {
      regions[i].colorId = 1;
    }
    return { palette, addedSwatches: [] };
  }

  const candidateIds = usable.map((s) => s.id);
  const usage = new Map<number, number>();
  for (const cid of candidateIds) usage.set(cid, 0);

  const adj = buildLocalRegionAdjacency(localRegionMap, width, height);
  const assignedByRegionId = new Map<number, number>();

  for (let i = 0; i < regions.length; i++) {
    const reg = regions[i];
    const usedByNeighbors = new Set<number>();
    const neighbors = adj.get(reg.id);
    if (neighbors) {
      for (const nId of neighbors) {
        const nColor = assignedByRegionId.get(nId);
        if (nColor !== undefined) usedByNeighbors.add(nColor);
      }
    }
    let chosen = candidateIds[i % candidateIds.length];
    let bestUse = Number.MAX_SAFE_INTEGER;
    for (let c = 0; c < candidateIds.length; c++) {
      const cid = candidateIds[c];
      if (usedByNeighbors.has(cid)) continue;
      const count = usage.get(cid) ?? 0;
      if (count < bestUse) {
        bestUse = count;
        chosen = cid;
      }
    }
    reg.colorId = chosen;
    assignedByRegionId.set(reg.id, chosen);
    usage.set(chosen, (usage.get(chosen) ?? 0) + 1);
  }

  return { palette, addedSwatches: [] };
}

interface UnmatchedRegionColor {
  regionIdx: number;
  r: number;
  g: number;
  b: number;
  weight: number;
}

function findClosestPaletteSwatch(
  r: number,
  g: number,
  b: number,
  palette: PaletteColor[]
): { id: number; distSq: number } {
  let bestId = palette[0].id;
  let bestDistSq = ColorQuantizer.perceptualDistanceSq(r, g, b, palette[0].r, palette[0].g, palette[0].b);
  for (let i = 1; i < palette.length; i++) {
    const p = palette[i];
    const d = ColorQuantizer.perceptualDistanceSq(r, g, b, p.r, p.g, p.b);
    if (d < bestDistSq) {
      bestDistSq = d;
      bestId = p.id;
    }
  }
  return { id: bestId, distSq: bestDistSq };
}

function clusterUnmatchedColors(
  unmatched: UnmatchedRegionColor[],
  maxClusters: number,
  reuseDeltaE: number
): Array<{ r: number; g: number; b: number }> {
  const kLimit = Math.min(maxClusters, unmatched.length);
  if (kLimit <= 0) return [];

  let seed0 = 0;
  for (let i = 1; i < unmatched.length; i++) {
    if (unmatched[i].weight > unmatched[seed0].weight) {
      seed0 = i;
    }
  }
  const seeds: Array<{ r: number; g: number; b: number }> = [
    { r: unmatched[seed0].r, g: unmatched[seed0].g, b: unmatched[seed0].b },
  ];
  const minSepSq = Math.pow(Math.max(1, reuseDeltaE * 0.5), 2);

  while (seeds.length < kLimit) {
    let farthestIdx = -1;
    let farthestDistSq = -1;
    for (let i = 0; i < unmatched.length; i++) {
      const u = unmatched[i];
      let nearestSq = Number.MAX_VALUE;
      for (let s = 0; s < seeds.length; s++) {
        const d = ColorQuantizer.perceptualDistanceSq(u.r, u.g, u.b, seeds[s].r, seeds[s].g, seeds[s].b);
        if (d < nearestSq) nearestSq = d;
      }
      if (nearestSq > farthestDistSq) {
        farthestDistSq = nearestSq;
        farthestIdx = i;
      }
    }
    if (farthestIdx < 0 || farthestDistSq <= minSepSq) break;
    seeds.push({
      r: unmatched[farthestIdx].r,
      g: unmatched[farthestIdx].g,
      b: unmatched[farthestIdx].b,
    });
  }

  const k = seeds.length;
  for (let pass = 0; pass < 6; pass++) {
    const sumR = new Float64Array(k);
    const sumG = new Float64Array(k);
    const sumB = new Float64Array(k);
    const sumW = new Float64Array(k);
    for (let i = 0; i < unmatched.length; i++) {
      const u = unmatched[i];
      let bestC = 0;
      let bestD = ColorQuantizer.perceptualDistanceSq(u.r, u.g, u.b, seeds[0].r, seeds[0].g, seeds[0].b);
      for (let c = 1; c < k; c++) {
        const d = ColorQuantizer.perceptualDistanceSq(u.r, u.g, u.b, seeds[c].r, seeds[c].g, seeds[c].b);
        if (d < bestD) {
          bestD = d;
          bestC = c;
        }
      }
      sumR[bestC] += u.r * u.weight;
      sumG[bestC] += u.g * u.weight;
      sumB[bestC] += u.b * u.weight;
      sumW[bestC] += u.weight;
    }
    for (let c = 0; c < k; c++) {
      if (sumW[c] > 0) {
        seeds[c].r = sumR[c] / sumW[c];
        seeds[c].g = sumG[c] / sumW[c];
        seeds[c].b = sumB[c] / sumW[c];
      }
    }
  }
  return seeds;
}

function assignHarmoniousPaletteColors(
  regions: Region[],
  rgbaData: Uint8ClampedArray,
  existingPalette: PaletteColor[],
  maxNewSwatches: number,
  reuseDeltaE: number
): { palette: PaletteColor[]; addedSwatches: PaletteColor[] } {
  const finalPalette = existingPalette.map((c) => ({ ...c }));
  let nextPaletteId = existingPalette.reduce((m, c) => Math.max(m, c.id), 0);
  const remainingSlots = Math.max(0, MAX_TOTAL_PALETTE_SWATCHES - existingPalette.length);
  let allowedNew = Math.min(Math.max(0, Math.floor(maxNewSwatches)), remainingSlots);
  if (existingPalette.length === 0 && allowedNew === 0) {
    allowedNew = 1;
  }

  const unmatched: UnmatchedRegionColor[] = [];
  const reuseThresholdSq = reuseDeltaE * reuseDeltaE;

  for (let i = 0; i < regions.length; i++) {
    const reg = regions[i];
    let sR = 0;
    let sG = 0;
    let sB = 0;
    for (let p = 0; p < reg.pixels.length; p++) {
      const off = reg.pixels[p] * 4;
      sR += rgbaData[off];
      sG += rgbaData[off + 1];
      sB += rgbaData[off + 2];
    }
    const meanR = sR / Math.max(1, reg.pixels.length);
    const meanG = sG / Math.max(1, reg.pixels.length);
    const meanB = sB / Math.max(1, reg.pixels.length);

    if (existingPalette.length > 0) {
      const match = findClosestPaletteSwatch(meanR, meanG, meanB, existingPalette);
      if (match.distSq <= reuseThresholdSq) {
        reg.colorId = match.id;
        continue;
      }
    }
    unmatched.push({ regionIdx: i, r: meanR, g: meanG, b: meanB, weight: reg.area });
  }

  const addedSwatches: PaletteColor[] = [];
  if (unmatched.length > 0 && allowedNew > 0) {
    const accents = clusterUnmatchedColors(unmatched, allowedNew, reuseDeltaE);
    for (let i = 0; i < accents.length; i++) {
      const swatch = createPaletteColor(++nextPaletteId, accents[i].r, accents[i].g, accents[i].b);
      addedSwatches.push(swatch);
      finalPalette.push(swatch);
    }
  }

  if (unmatched.length > 0 && finalPalette.length > 0) {
    for (let i = 0; i < unmatched.length; i++) {
      const u = unmatched[i];
      regions[u.regionIdx].colorId = findClosestPaletteSwatch(u.r, u.g, u.b, finalPalette).id;
    }
  }

  return { palette: finalPalette, addedSwatches };
}

export function subdivideMaskedRegion(
  params: SubdivideMaskedRegionParams
): MaskedSubdivisionResult {
  const {
    rgbaData,
    cropWidth,
    cropHeight,
    cropMask,
    existingPalette,
    isFreeColor = false,
    onProgress,
  } = params;

  onProgress?.(0.15, 'Collecting masked pixels...');
  const collected = collectMaskedPixels(rgbaData, cropWidth, cropHeight, cropMask);
  if (collected.maskedCount === 0) {
    onProgress?.(1.0, 'No masked pixels to subdivide.');
    return {
      width: Math.max(0, cropWidth),
      height: Math.max(0, cropHeight),
      localRegionMap: new Int32Array(Math.max(0, cropWidth * cropHeight)),
      regions: [],
      palette: existingPalette.map((c) => ({ ...c })),
      addedSwatches: [],
    };
  }

  const targetSubRegions = Math.max(1, Math.min(256, Math.floor(params.targetSubRegions ?? 12)));
  const minRegionArea = Math.max(1, Math.floor(params.minRegionArea ?? 24));
  const maxNewSwatches = params.maxNewSwatches ?? DEFAULT_MAX_NEW_SWATCHES;
  const reuseDeltaE = params.reuseDeltaE ?? DEFAULT_REUSE_DELTA_E;

  const rawDesiredK =
    targetSubRegions <= 1
      ? 1
      : Math.min(24, Math.max(2, Math.min(targetSubRegions, Math.ceil(targetSubRegions * 0.75) + 1)));
  const areaLimitedK = Math.max(1, Math.min(collected.maskedCount, Math.floor(collected.maskedCount / minRegionArea) || 1));
  const desiredK = Math.max(1, Math.min(rawDesiredK, areaLimitedK));

  onProgress?.(0.5, 'Quantizing masked detail colors...');
  const quant = quantizeMaskedPixels(
    rgbaData,
    cropWidth,
    cropHeight,
    cropMask,
    collected.maskedIndices,
    collected.rArr,
    collected.gArr,
    collected.bArr,
    desiredK,
    true
  );

  onProgress?.(0.78, 'Segmenting contiguous sub-regions...');
  const { localRegionMap, segments } = segmentMaskedComponents(
    quant.assignments,
    cropMask,
    collected.maskedIndices,
    rgbaData,
    cropWidth,
    cropHeight,
    minRegionArea,
    targetSubRegions
  );

  onProgress?.(0.92, 'Placing sub-region labels and harmonizing palette...');
  const regions = computeLocalRegionGeometry(segments, localRegionMap, cropMask, cropWidth, cropHeight);
  const { palette, addedSwatches } = isFreeColor
    ? assignFreeColorIds(regions, localRegionMap, cropWidth, cropHeight, existingPalette)
    : assignHarmoniousPaletteColors(regions, rgbaData, existingPalette, maxNewSwatches, reuseDeltaE);

  onProgress?.(1.0, `Subdivided into ${regions.length} detail regions.`);
  return {
    width: cropWidth,
    height: cropHeight,
    localRegionMap,
    regions,
    palette,
    addedSwatches,
  };
}

function recomputeBorderMapInBounds(
  regionMap: Int32Array,
  borderMap: Uint8Array,
  width: number,
  height: number,
  bx0: number,
  by0: number,
  bx1: number,
  by1: number
): void {
  const xStart = Math.max(0, bx0);
  const yStart = Math.max(0, by0);
  const xEnd = Math.min(width - 1, bx1);
  const yEnd = Math.min(height - 1, by1);
  for (let y = yStart; y <= yEnd; y++) {
    const rowOff = y * width;
    for (let x = xStart; x <= xEnd; x++) {
      const idx = rowOff + x;
      const rid = regionMap[idx];
      const isBorder =
        (x < width - 1 && regionMap[idx + 1] !== rid) ||
        (y < height - 1 && regionMap[idx + width] !== rid);
      borderMap[idx] = isBorder ? 1 : 0;
    }
  }
}

function resolveOrphanSelectedPixels(
  orphans: number[],
  nextRegionMap: Int32Array,
  width: number,
  height: number,
  globalIdToSlot: Map<number, number>,
  slotPixels: number[][],
  slotGlobalIds: number[],
  fallbackSlot: number
): Set<number> {
  const dirtySlots = new Set<number>();
  const fallbackGlobalId = slotGlobalIds[fallbackSlot];
  for (let i = 0; i < orphans.length; i++) {
    const gIdx = orphans[i];
    const gx = gIdx % width;
    const gy = (gIdx - gx) / width;
    let chosenSlot = -1;
    const tryNeighbor = (nIdx: number) => {
      if (chosenSlot >= 0) return;
      const slot = globalIdToSlot.get(nextRegionMap[nIdx]);
      if (slot !== undefined) chosenSlot = slot;
    };
    if (gx > 0) tryNeighbor(gIdx - 1);
    if (gx < width - 1) tryNeighbor(gIdx + 1);
    if (gy > 0) tryNeighbor(gIdx - width);
    if (gy < height - 1) tryNeighbor(gIdx + width);

    const finalSlot = chosenSlot >= 0 ? chosenSlot : fallbackSlot;
    const finalGlobalId = chosenSlot >= 0 ? slotGlobalIds[chosenSlot] : fallbackGlobalId;
    nextRegionMap[gIdx] = finalGlobalId;
    slotPixels[finalSlot].push(gIdx);
    dirtySlots.add(finalSlot);
  }
  return dirtySlots;
}

function buildTranslatedRegion(
  subReg: Region,
  globalId: number,
  pixelsArr: number[],
  nextRegionMap: Int32Array,
  width: number,
  height: number,
  bbox: SubdivisionBbox,
  needsSort: boolean
): Region {
  if (needsSort) {
    pixelsArr.sort((a, b) => a - b);
  }
  const pixels = new Int32Array(pixelsArr.length);
  let minX = width;
  let maxX = 0;
  let minY = height;
  let maxY = 0;
  for (let i = 0; i < pixelsArr.length; i++) {
    const idx = pixelsArr[i];
    pixels[i] = idx;
    const x = idx % width;
    const y = (idx - x) / width;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  let centroidX = bbox.minX + subReg.centroidX;
  let centroidY = bbox.minY + subReg.centroidY;
  let maxRadius = subReg.maxRadius;
  const cx = Math.floor(centroidX);
  const cy = Math.floor(centroidY);
  if (cx < 0 || cx >= width || cy < 0 || cy >= height || nextRegionMap[cy * width + cx] !== globalId) {
    const midIdx = pixels[pixels.length >> 1];
    const mx = midIdx % width;
    const my = (midIdx - mx) / width;
    centroidX = mx + 0.5;
    centroidY = my + 0.5;
    maxRadius = Math.max(0.5, Math.min(subReg.maxRadius, Math.sqrt(pixels.length) * 0.5));
  }

  return {
    id: globalId,
    colorId: subReg.colorId,
    centroidX,
    centroidY,
    area: pixels.length,
    minX,
    maxX,
    minY,
    maxY,
    maxRadius,
    pixels,
  };
}

function cloneBasePuzzle(basePuzzle: PuzzleData): PuzzleData {
  return {
    width: basePuzzle.width,
    height: basePuzzle.height,
    palette: basePuzzle.palette.map((c) => ({ ...c })),
    regions: basePuzzle.regions.slice(),
    regionMap: new Int32Array(basePuzzle.regionMap),
    borderMap: new Uint8Array(basePuzzle.borderMap),
    isFreeColor: basePuzzle.isFreeColor,
  };
}

function buildGlobalIdMapping(baseRegions: Region[], subRegions: Region[]) {
  let nextGlobalId = 0;
  for (let i = 0; i < baseRegions.length; i++) {
    if (baseRegions[i].id > nextGlobalId) nextGlobalId = baseRegions[i].id;
  }
  let maxLocalId = 0;
  for (let i = 0; i < subRegions.length; i++) {
    if (subRegions[i].id > maxLocalId) maxLocalId = subRegions[i].id;
  }

  const localToGlobalId = new Int32Array(maxLocalId + 1);
  const localToSlot = new Int32Array(maxLocalId + 1).fill(-1);
  const slotGlobalIds: number[] = [];
  const slotPixels: number[][] = [];
  const globalIdToSlot = new Map<number, number>();

  for (let s = 0; s < subRegions.length; s++) {
    const subReg = subRegions[s];
    const gId = ++nextGlobalId;
    localToGlobalId[subReg.id] = gId;
    localToSlot[subReg.id] = s;
    slotGlobalIds.push(gId);
    slotPixels.push([]);
    globalIdToSlot.set(gId, s);
  }
  return { localToGlobalId, localToSlot, slotGlobalIds, slotPixels, globalIdToSlot };
}

function spliceSubdivisionIntoMap(
  baseRegionMap: Int32Array,
  nextRegionMap: Int32Array,
  width: number,
  selectedRegionIds: ReadonlySet<number>,
  subResult: MaskedSubdivisionResult,
  bbox: SubdivisionBbox,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  localToGlobalId: Int32Array,
  localToSlot: Int32Array,
  slotPixels: number[][]
): number[] {
  const orphanedSelectedPixels: number[] = [];
  for (let gy = startY; gy < endY; gy++) {
    const gRow = gy * width;
    const lRow = (gy - bbox.minY) * subResult.width;
    for (let gx = startX; gx < endX; gx++) {
      const gIdx = gRow + gx;
      if (!selectedRegionIds.has(baseRegionMap[gIdx])) continue;
      const localId = subResult.localRegionMap[lRow + (gx - bbox.minX)];
      if (localId > 0 && localId < localToGlobalId.length && localToGlobalId[localId] > 0) {
        nextRegionMap[gIdx] = localToGlobalId[localId];
        slotPixels[localToSlot[localId]].push(gIdx);
      } else {
        orphanedSelectedPixels.push(gIdx);
      }
    }
  }
  return orphanedSelectedPixels;
}

function collectOutOfBoundsSelectedOrphans(
  baseRegions: Region[],
  nextRegionMap: Int32Array,
  width: number,
  selectedRegionIds: ReadonlySet<number>,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  orphanedSelectedPixels: number[]
): { dirtyMinX: number; dirtyMinY: number; dirtyMaxX: number; dirtyMaxY: number } {
  let dirtyMinX = startX;
  let dirtyMinY = startY;
  let dirtyMaxX = Math.max(startX, endX - 1);
  let dirtyMaxY = Math.max(startY, endY - 1);

  for (let i = 0; i < baseRegions.length; i++) {
    const reg = baseRegions[i];
    if (!selectedRegionIds.has(reg.id)) continue;
    if (reg.minX >= startX && reg.maxX < endX && reg.minY >= startY && reg.maxY < endY) continue;
    for (let p = 0; p < reg.pixels.length; p++) {
      const gIdx = reg.pixels[p];
      if (!selectedRegionIds.has(nextRegionMap[gIdx])) continue;
      orphanedSelectedPixels.push(gIdx);
      const ox = gIdx % width;
      const oy = (gIdx - ox) / width;
      if (ox < dirtyMinX) dirtyMinX = ox;
      if (ox > dirtyMaxX) dirtyMaxX = ox;
      if (oy < dirtyMinY) dirtyMinY = oy;
      if (oy > dirtyMaxY) dirtyMaxY = oy;
    }
  }
  return { dirtyMinX, dirtyMinY, dirtyMaxX, dirtyMaxY };
}

export function mergeSubdividedRegionIntoPuzzle(
  basePuzzle: PuzzleData,
  selectedRegionIds: ReadonlySet<number>,
  subResult: MaskedSubdivisionResult,
  bbox: SubdivisionBbox
): PuzzleData {
  if (selectedRegionIds.size === 0 || subResult.regions.length === 0) {
    return cloneBasePuzzle(basePuzzle);
  }

  const { width, height } = basePuzzle;
  const nextRegionMap = new Int32Array(basePuzzle.regionMap);
  const nextBorderMap = new Uint8Array(basePuzzle.borderMap);
  const { localToGlobalId, localToSlot, slotGlobalIds, slotPixels, globalIdToSlot } =
    buildGlobalIdMapping(basePuzzle.regions, subResult.regions);

  const startX = Math.max(0, Math.floor(bbox.minX));
  const startY = Math.max(0, Math.floor(bbox.minY));
  const endX = Math.min(width, Math.floor(bbox.minX) + Math.min(Math.floor(bbox.width), subResult.width));
  const endY = Math.min(height, Math.floor(bbox.minY) + Math.min(Math.floor(bbox.height), subResult.height));

  const orphanedSelectedPixels = spliceSubdivisionIntoMap(
    basePuzzle.regionMap,
    nextRegionMap,
    width,
    selectedRegionIds,
    subResult,
    bbox,
    startX,
    startY,
    endX,
    endY,
    localToGlobalId,
    localToSlot,
    slotPixels
  );
  const { dirtyMinX, dirtyMinY, dirtyMaxX, dirtyMaxY } = collectOutOfBoundsSelectedOrphans(
    basePuzzle.regions,
    nextRegionMap,
    width,
    selectedRegionIds,
    startX,
    startY,
    endX,
    endY,
    orphanedSelectedPixels
  );

  const fallbackSlot = slotPixels.findIndex((arr) => arr.length > 0);
  if (fallbackSlot < 0) {
    return cloneBasePuzzle(basePuzzle);
  }

  const dirtySlots =
    orphanedSelectedPixels.length > 0
      ? resolveOrphanSelectedPixels(
          orphanedSelectedPixels,
          nextRegionMap,
          width,
          height,
          globalIdToSlot,
          slotPixels,
          slotGlobalIds,
          fallbackSlot
        )
      : new Set<number>();

  const translatedNewRegions: Region[] = [];
  for (let s = 0; s < subResult.regions.length; s++) {
    if (slotPixels[s].length === 0) continue;
    translatedNewRegions.push(
      buildTranslatedRegion(
        subResult.regions[s],
        slotGlobalIds[s],
        slotPixels[s],
        nextRegionMap,
        width,
        height,
        bbox,
        dirtySlots.has(s)
      )
    );
  }

  recomputeBorderMapInBounds(
    nextRegionMap,
    nextBorderMap,
    width,
    height,
    dirtyMinX - 1,
    dirtyMinY - 1,
    dirtyMaxX + 1,
    dirtyMaxY + 1
  );

  const keptRegions = basePuzzle.regions.filter((r) => !selectedRegionIds.has(r.id));
  return {
    width,
    height,
    palette: subResult.palette.map((c) => ({ ...c })),
    regions: [...keptRegions, ...translatedNewRegions],
    regionMap: nextRegionMap,
    borderMap: nextBorderMap,
    isFreeColor: basePuzzle.isFreeColor,
  };
}
