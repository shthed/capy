import { LineHandlingMode, PaletteColor, Region } from '../types';
import { ColorQuantizer } from './ColorQuantizer';
import { LineArtExtractor } from './LineArtExtractor';

export interface SegmentationResult {
  regions: Region[];
  regionMap: Int32Array;
  borderMap: Uint8Array;
}

interface ConnectedComponentsResult {
  regionMap: Int32Array;
  regionCounter: number;
  pixelLists: number[][];
  regionClusterList: number[];
}

interface UnionFindState {
  width: number;
  height: number;
  regionMap: Int32Array;
  pixelLists: number[][];
  regionClusterList: number[];
  palette: PaletteColor[];
  parent: Int32Array;
  regionArea: Int32Array;
  rootComponents: number[][];
}

interface FinalRegionDraft {
  id: number;
  clusterId: number;
  pixels: number[];
}

function hasActiveMaskPixels(activeMask: Uint8Array, total: number): boolean {
  const limit = Math.min(total, activeMask.length);
  for (let i = 0; i < limit; i++) {
    if (activeMask[i] === 1) return true;
  }
  return false;
}

function traceConnectedComponents(
  width: number,
  height: number,
  initialClusters: Int32Array,
  cellPartitionMap?: Int32Array,
  activeMask?: Uint8Array
): ConnectedComponentsResult {
  const total = width * height;
  const queueBuffer = new Int32Array(total);
  const regionMap = new Int32Array(total);
  regionMap.fill(-1);

  let regionCounter = 0;
  const pixelLists: number[][] = [];
  const regionClusterList: number[] = [];

  for (let y = 0; y < height; y++) {
    const yRow = y * width;
    for (let x = 0; x < width; x++) {
      const startIdx = yRow + x;
      if (regionMap[startIdx] !== -1) continue;
      if (activeMask && activeMask[startIdx] !== 1) continue;

      const targetCluster = initialClusters[startIdx];
      const targetCell = cellPartitionMap ? cellPartitionMap[startIdx] : 0;
      const currentRegionId = regionCounter++;
      regionClusterList.push(targetCluster);

      const currentPixels: number[] = [];
      regionMap[startIdx] = currentRegionId;
      let head = 0;
      let tail = 0;
      queueBuffer[tail++] = startIdx;

      const tryEnqueue = (n: number): void => {
        if (
          regionMap[n] === -1 &&
          (!activeMask || activeMask[n] === 1) &&
          initialClusters[n] === targetCluster &&
          (!cellPartitionMap || cellPartitionMap[n] === targetCell)
        ) {
          regionMap[n] = currentRegionId;
          queueBuffer[tail++] = n;
        }
      };

      while (head < tail) {
        const curr = queueBuffer[head++];
        currentPixels.push(curr);

        const cx = curr % width;
        const cy = Math.floor(curr / width);

        // Preserve exact Left, Right, Up, Down traversal order
        if (cx > 0) tryEnqueue(curr - 1);
        if (cx < width - 1) tryEnqueue(curr + 1);
        if (cy > 0) tryEnqueue(curr - width);
        if (cy < height - 1) tryEnqueue(curr + width);
      }

      pixelLists.push(currentPixels);
    }
  }

  return { regionMap, regionCounter, pixelLists, regionClusterList };
}

function createUnionFindState(
  width: number,
  height: number,
  components: ConnectedComponentsResult,
  palette: PaletteColor[]
): UnionFindState {
  const { regionCounter, pixelLists, regionMap, regionClusterList } = components;
  const parent = new Int32Array(regionCounter);
  const regionArea = new Int32Array(regionCounter);
  const rootComponents: number[][] = [];

  for (let i = 0; i < regionCounter; i++) {
    parent[i] = i;
    regionArea[i] = pixelLists[i].length;
    rootComponents.push([i]);
  }

  return {
    width,
    height,
    regionMap,
    pixelLists,
    regionClusterList,
    palette,
    parent,
    regionArea,
    rootComponents,
  };
}

function findRoot(parent: Int32Array, i: number): number {
  let root = i;
  while (root !== parent[root]) root = parent[root];
  let curr = i;
  while (curr !== root) {
    const next = parent[curr];
    parent[curr] = root;
    curr = next;
  }
  return root;
}

function collectNeighborTouches(
  state: UnionFindState,
  targetRoot: number
): { touches: Map<number, number>; perimeter: number } {
  const { width, height, regionMap, pixelLists, rootComponents, parent } = state;
  const touches = new Map<number, number>();
  let perimeter = 0;

  const inspectNeighbor = (nIdx: number): void => {
    const nReg = regionMap[nIdx];
    if (nReg < 0) {
      // Inactive masked exterior counts as geometric boundary perimeter
      perimeter++;
      return;
    }
    const nRoot = findRoot(parent, nReg);
    if (nRoot !== targetRoot) {
      touches.set(nRoot, (touches.get(nRoot) || 0) + 1);
      perimeter++;
    }
  };

  const comps = rootComponents[targetRoot];
  for (let c = 0; c < comps.length; c++) {
    const pixels = pixelLists[comps[c]];
    for (let i = 0; i < pixels.length; i++) {
      const idx = pixels[i];
      const px = idx % width;
      const py = Math.floor(idx / width);

      // Preserve exact Left, Right, Up, Down Map insertion order
      if (px > 0) inspectNeighbor(idx - 1);
      else perimeter++;

      if (px < width - 1) inspectNeighbor(idx + 1);
      else perimeter++;

      if (py > 0) inspectNeighbor(idx - width);
      else perimeter++;

      if (py < height - 1) inspectNeighbor(idx + width);
      else perimeter++;
    }
  }

  return { touches, perimeter };
}

function pickBestMergeNeighbor(
  state: UnionFindState,
  root: number,
  neighborTouches: Map<number, number>
): number {
  const { palette, regionClusterList } = state;
  const currColor = palette[regionClusterList[root]] || palette[0];
  let bestNeighbor = -1;
  let bestScore = -1;

  for (const [nRoot, touch] of neighborTouches.entries()) {
    const nColor = palette[regionClusterList[nRoot]] || palette[0];
    let distSq = 0;
    if (currColor && nColor) {
      distSq = ColorQuantizer.perceptualDistanceSq(
        currColor.r,
        currColor.g,
        currColor.b,
        nColor.r,
        nColor.g,
        nColor.b
      );
    }
    const deltaE = Math.sqrt(distSq);
    const score = Math.pow(touch, 1.25) / (deltaE + 8);

    if (score > bestScore) {
      bestScore = score;
      bestNeighbor = nRoot;
    }
  }

  return bestNeighbor;
}

function mergeRootInto(state: UnionFindState, srcRoot: number, dstRoot: number): void {
  state.parent[srcRoot] = dstRoot;
  state.regionArea[dstRoot] += state.regionArea[srcRoot];
  const srcComps = state.rootComponents[srcRoot];
  const dstComps = state.rootComponents[dstRoot];
  for (let i = 0; i < srcComps.length; i++) {
    dstComps.push(srcComps[i]);
  }
  state.rootComponents[srcRoot] = [];
}

function dissolveSmallRegions(
  state: UnionFindState,
  regionCounter: number,
  targetMin: number,
  maxMergePasses: number
): void {
  for (let pass = 0; pass < maxMergePasses; pass++) {
    let mergedThisPass = 0;

    for (let r = 0; r < regionCounter; r++) {
      const root = findRoot(state.parent, r);
      if (root !== r || state.regionArea[root] >= targetMin) continue;

      const { touches } = collectNeighborTouches(state, root);
      if (touches.size === 0) continue;

      const bestNeighbor = pickBestMergeNeighbor(state, root, touches);
      if (bestNeighbor >= 0) {
        mergeRootInto(state, root, bestNeighbor);
        mergedThisPass++;
      }
    }

    if (mergedThisPass === 0) break;
  }
}

function dissolveSliverRegions(
  state: UnionFindState,
  regionCounter: number,
  targetMin: number,
  maxPerimeterToAreaRatio: number
): void {
  if (maxPerimeterToAreaRatio <= 0) return;

  const sliverAreaCeiling = Math.max(targetMin * 4, 160);
  for (let r = 0; r < regionCounter; r++) {
    const root = findRoot(state.parent, r);
    if (root !== r || state.regionArea[root] > sliverAreaCeiling) continue;

    const { touches, perimeter } = collectNeighborTouches(state, root);
    if (touches.size === 0) continue;

    if (perimeter / state.regionArea[root] > maxPerimeterToAreaRatio) {
      const bestNeighbor = pickBestMergeNeighbor(state, root, touches);
      if (bestNeighbor >= 0) {
        mergeRootInto(state, root, bestNeighbor);
      }
    }
  }
}

class RootAreaMinHeap {
  private readonly areas: Int32Array;
  private readonly roots: Int32Array;
  private readonly maxCap: number;
  size = 0;

  constructor(maxCap: number) {
    this.maxCap = maxCap;
    this.areas = new Int32Array(maxCap);
    this.roots = new Int32Array(maxCap);
  }

  private swap(a: number, b: number): void {
    const ta = this.areas[a];
    this.areas[a] = this.areas[b];
    this.areas[b] = ta;
    const tr = this.roots[a];
    this.roots[a] = this.roots[b];
    this.roots[b] = tr;
  }

  private less(a: number, b: number): boolean {
    const diff = this.areas[a] - this.areas[b];
    return diff !== 0 ? diff < 0 : this.roots[a] < this.roots[b];
  }

  push(area: number, rootId: number): void {
    if (this.size >= this.maxCap) return;
    let idx = this.size++;
    this.areas[idx] = area;
    this.roots[idx] = rootId;
    while (idx > 0) {
      const parentIdx = (idx - 1) >> 1;
      if (!this.less(idx, parentIdx)) break;
      this.swap(idx, parentIdx);
      idx = parentIdx;
    }
  }

  peekArea(): number {
    return this.areas[0];
  }

  peekRoot(): number {
    return this.roots[0];
  }

  pop(): void {
    const last = --this.size;
    if (last <= 0) return;
    this.areas[0] = this.areas[last];
    this.roots[0] = this.roots[last];
    let idx = 0;
    while (true) {
      const left = idx * 2 + 1;
      const right = left + 1;
      let smallest = idx;
      if (left < this.size && this.less(left, smallest)) smallest = left;
      if (right < this.size && this.less(right, smallest)) smallest = right;
      if (smallest === idx) break;
      this.swap(idx, smallest);
      idx = smallest;
    }
  }
}

function enforceMaxRegionCap(
  state: UnionFindState,
  regionCounter: number,
  effectiveMaxRegions: number
): void {
  const seenRoots = new Uint8Array(regionCounter);
  const activeRootIds: number[] = [];
  for (let i = 0; i < regionCounter; i++) {
    const root = findRoot(state.parent, i);
    if (seenRoots[root] === 0) {
      seenRoots[root] = 1;
      activeRootIds.push(root);
    }
  }

  if (activeRootIds.length <= effectiveMaxRegions) return;

  const heap = new RootAreaMinHeap(Math.max(16, regionCounter * 2 + 4));
  for (let i = 0; i < activeRootIds.length; i++) {
    const root = activeRootIds[i];
    heap.push(state.regionArea[root], root);
  }

  const isolatedRoots = new Uint8Array(regionCounter);
  // Decrement remainingRegions ONLY when two roots actually merge so disconnected
  // masked islands do not prematurely halt merging inside larger connected islands.
  let remainingRegions = activeRootIds.length;

  while (remainingRegions > effectiveMaxRegions && heap.size > 0) {
    const topArea = heap.peekArea();
    const smallestRoot = heap.peekRoot();
    heap.pop();

    if (findRoot(state.parent, smallestRoot) !== smallestRoot) continue;
    if (isolatedRoots[smallestRoot] !== 0) continue;

    const currentArea = state.regionArea[smallestRoot];
    if (topArea !== currentArea) {
      heap.push(currentArea, smallestRoot);
      continue;
    }

    const { touches } = collectNeighborTouches(state, smallestRoot);
    if (touches.size === 0) {
      isolatedRoots[smallestRoot] = 1;
      continue;
    }

    const bestNeighbor = pickBestMergeNeighbor(state, smallestRoot, touches);
    if (bestNeighbor >= 0) {
      mergeRootInto(state, smallestRoot, bestNeighbor);
      remainingRegions--;
    } else {
      isolatedRoots[smallestRoot] = 1;
    }
  }
}

function findFallbackRegionId(
  finalRegionMap: Int32Array,
  width: number,
  height: number,
  idx: number
): number {
  const px = idx % width;
  const py = Math.floor(idx / width);
  if (px > 0 && finalRegionMap[idx - 1] > 0) return finalRegionMap[idx - 1];
  if (px < width - 1 && finalRegionMap[idx + 1] > 0) return finalRegionMap[idx + 1];
  if (py > 0 && finalRegionMap[idx - width] > 0) return finalRegionMap[idx - width];
  if (py < height - 1 && finalRegionMap[idx + width] > 0) return finalRegionMap[idx + width];
  return 1;
}

function flattenAndAlignRegions(
  state: UnionFindState,
  regionCounter: number,
  total: number,
  lineMask?: Uint8Array,
  lineHandling: LineHandlingMode = 'ABSORB_LINES',
  activeMask?: Uint8Array,
  onProgress?: (progress: number, status: string) => void
): { finalRegionMap: Int32Array; activeFinalRegions: FinalRegionDraft[] } {
  const { width, height, parent, pixelLists, regionClusterList } = state;
  const finalRegionMap = new Int32Array(total);
  const rootToFinalId = new Map<number, number>();
  const finalRegionsList: FinalRegionDraft[] = [];

  for (let r = 0; r < regionCounter; r++) {
    const root = findRoot(parent, r);
    let finalId = rootToFinalId.get(root);

    if (finalId === undefined) {
      finalId = finalRegionsList.length + 1;
      rootToFinalId.set(root, finalId);
      finalRegionsList.push({
        id: finalId,
        clusterId: regionClusterList[root],
        pixels: [],
      });
    }

    const pixels = pixelLists[r];
    for (let i = 0; i < pixels.length; i++) {
      finalRegionMap[pixels[i]] = finalId;
    }
  }

  if (lineMask && lineHandling === 'ABSORB_LINES') {
    onProgress?.(0.88, 'Aligning puzzle boundaries with artwork lines...');
    LineArtExtractor.alignBoundariesToLines(finalRegionMap, lineMask, width, height, activeMask);
  }

  // Zero-gap guarantee inside active mask; inactive exterior stays strictly 0
  for (let idx = 0; idx < total; idx++) {
    if (activeMask && activeMask[idx] !== 1) {
      finalRegionMap[idx] = 0;
      continue;
    }
    if (finalRegionMap[idx] <= 0) {
      finalRegionMap[idx] = findFallbackRegionId(finalRegionMap, width, height, idx);
    }
  }

  // Populate region pixels strictly in ascending scanline order (0..total-1)
  for (let idx = 0; idx < total; idx++) {
    const rid = finalRegionMap[idx];
    if (rid > 0 && rid <= finalRegionsList.length) {
      finalRegionsList[rid - 1].pixels.push(idx);
    }
  }

  // Filter out empty regions and re-index sequentially
  const activeFinalRegions = finalRegionsList.filter((r) => r.pixels.length > 0);
  for (let i = 0; i < activeFinalRegions.length; i++) {
    const newId = i + 1;
    const reg = activeFinalRegions[i];
    if (reg.id !== newId) {
      reg.id = newId;
      for (let p = 0; p < reg.pixels.length; p++) {
        finalRegionMap[reg.pixels[p]] = newId;
      }
    }
  }

  return { finalRegionMap, activeFinalRegions };
}

function buildHairlineBorderMap(
  finalRegionMap: Int32Array,
  width: number,
  height: number
): Uint8Array {
  const borderMap = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const yRow = y * width;
    for (let x = 0; x < width; x++) {
      const idx = yRow + x;
      const rid = finalRegionMap[idx];
      const isBorder =
        (x < width - 1 && finalRegionMap[idx + 1] !== rid) ||
        (y < height - 1 && finalRegionMap[idx + width] !== rid);
      if (isBorder) {
        borderMap[idx] = 1;
      }
    }
  }
  return borderMap;
}

function computeRegionBounds(
  pixelData: number[],
  width: number
): { sumX: number; sumY: number; minX: number; maxX: number; minY: number; maxY: number } {
  if (pixelData.length === 0) {
    return { sumX: 0, sumY: 0, minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }
  let sumX = 0;
  let sumY = 0;
  let minX = Number.MAX_VALUE;
  let maxX = -1;
  let minY = Number.MAX_VALUE;
  let maxY = -1;

  for (let i = 0; i < pixelData.length; i++) {
    const idx = pixelData[i];
    const px = idx % width;
    const py = Math.floor(idx / width);
    sumX += px;
    sumY += py;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }

  return { sumX, sumY, minX, maxX, minY, maxY };
}

function isRegionBoundaryPixel(
  idx: number,
  px: number,
  py: number,
  width: number,
  height: number,
  regionId: number,
  finalRegionMap: Int32Array,
  borderMap: Uint8Array
): boolean {
  return (
    px === 0 ||
    px === width - 1 ||
    py === 0 ||
    py === height - 1 ||
    borderMap[idx] === 1 ||
    (px > 0 && finalRegionMap[idx - 1] !== regionId) ||
    (px < width - 1 && finalRegionMap[idx + 1] !== regionId) ||
    (py > 0 && finalRegionMap[idx - width] !== regionId) ||
    (py < height - 1 && finalRegionMap[idx + width] !== regionId)
  );
}

function computePoleOfInaccessibility(
  regionId: number,
  pixelData: number[],
  sumX: number,
  sumY: number,
  finalRegionMap: Int32Array,
  borderMap: Uint8Array,
  width: number,
  height: number,
  distGrid: Int32Array,
  bfsQueue: Int32Array
): { bestPx: number; bestPy: number; maxDistance: number } {
  const count = pixelData.length;
  if (count === 1) {
    return {
      bestPx: pixelData[0] % width,
      bestPy: Math.floor(pixelData[0] / width),
      maxDistance: 0.5,
    };
  }

  if (count <= 9) {
    const testX = Math.min(width - 1, Math.max(0, Math.round(sumX / count)));
    const testY = Math.min(height - 1, Math.max(0, Math.round(sumY / count)));
    if (finalRegionMap[testY * width + testX] === regionId) {
      return { bestPx: testX, bestPy: testY, maxDistance: Math.sqrt(count) * 0.5 };
    }
    return {
      bestPx: pixelData[0] % width,
      bestPy: Math.floor(pixelData[0] / width),
      maxDistance: Math.sqrt(count) * 0.5,
    };
  }

  let head = 0;
  let tail = 0;
  for (let i = 0; i < count; i++) {
    const idx = pixelData[i];
    const px = idx % width;
    const py = Math.floor(idx / width);
    if (isRegionBoundaryPixel(idx, px, py, width, height, regionId, finalRegionMap, borderMap)) {
      distGrid[idx] = 1;
      bfsQueue[tail++] = idx;
    }
  }

  let maxDist = 1;
  let maxIdx = tail > 0 ? bfsQueue[0] : pixelData[0];

  const tryStep = (nIdx: number, nextDist: number): void => {
    if (finalRegionMap[nIdx] === regionId && distGrid[nIdx] === 0) {
      distGrid[nIdx] = nextDist;
      bfsQueue[tail++] = nIdx;
      if (nextDist > maxDist) {
        maxDist = nextDist;
        maxIdx = nIdx;
      }
    }
  };

  while (head < tail) {
    const idx = bfsQueue[head++];
    const nextDist = distGrid[idx] + 1;
    const px = idx % width;
    const py = Math.floor(idx / width);

    if (px > 0) tryStep(idx - 1, nextDist);
    if (px < width - 1) tryStep(idx + 1, nextDist);
    if (py > 0) tryStep(idx - width, nextDist);
    if (py < height - 1) tryStep(idx + width, nextDist);
  }

  for (let i = 0; i < count; i++) {
    distGrid[pixelData[i]] = 0;
  }

  return {
    bestPx: maxIdx % width,
    bestPy: Math.floor(maxIdx / width),
    maxDistance: maxDist,
  };
}

function recalibrateRegionColorId(
  pixelData: number[],
  sourceRgba: Uint8ClampedArray | Uint8Array | undefined,
  palette: PaletteColor[],
  fallbackColorId: number
): number {
  const count = pixelData.length;
  if (!sourceRgba || count === 0 || palette.length === 0) {
    return fallbackColorId;
  }

  let sumPixR = 0;
  let sumPixG = 0;
  let sumPixB = 0;
  for (let i = 0; i < count; i++) {
    const pIdx = pixelData[i] * 4;
    sumPixR += sourceRgba[pIdx];
    sumPixG += sourceRgba[pIdx + 1];
    sumPixB += sourceRgba[pIdx + 2];
  }

  const meanR = Math.round(sumPixR / count);
  const meanG = Math.round(sumPixG / count);
  const meanB = Math.round(sumPixB / count);

  let resolvedColorId = fallbackColorId;
  let bestDist = Number.MAX_VALUE;
  for (let c = 0; c < palette.length; c++) {
    const pal = palette[c];
    const d = ColorQuantizer.perceptualDistanceSq(meanR, meanG, meanB, pal.r, pal.g, pal.b);
    if (d < bestDist) {
      bestDist = d;
      resolvedColorId = pal.id;
    }
  }
  return resolvedColorId;
}

function buildFinalRegions(
  activeFinalRegions: FinalRegionDraft[],
  finalRegionMap: Int32Array,
  borderMap: Uint8Array,
  width: number,
  height: number,
  palette: PaletteColor[],
  sourceRgba?: Uint8ClampedArray | Uint8Array
): Region[] {
  // Reusable scratch buffers eliminate per-region Map<number, number> and typed-array allocations.
  const total = width * height;
  const distGrid = new Int32Array(total);
  const bfsQueue = new Int32Array(total);

  return activeFinalRegions.map((reg) => {
    const pixelData = reg.pixels;
    const count = pixelData.length;
    const { sumX, sumY, minX, maxX, minY, maxY } = computeRegionBounds(pixelData, width);
    const { bestPx, bestPy, maxDistance } = computePoleOfInaccessibility(
      reg.id,
      pixelData,
      sumX,
      sumY,
      finalRegionMap,
      borderMap,
      width,
      height,
      distGrid,
      bfsQueue
    );
    const resolvedColorId = recalibrateRegionColorId(
      pixelData,
      sourceRgba,
      palette,
      reg.clusterId + 1
    );

    return {
      id: reg.id,
      colorId: resolvedColorId,
      centroidX: bestPx + 0.5,
      centroidY: bestPy + 0.5,
      area: count,
      minX,
      maxX,
      minY,
      maxY,
      maxRadius: maxDistance,
      pixels: new Int32Array(pixelData),
    };
  });
}

export class RegionSegmenter {
  /**
   * Segments quantized pixel clusters into clean, continuous vector regions.
   * Guarantees 100% spatial partition across the canvas (or activeMask) with ZERO gaps or holes.
   *
   * Key Guarantees:
   *  1. Strict Minimum Region Area: No region has area < minRegionArea (unless isolated).
   *  2. Strict Max Region Count: Total region count never exceeds maxRegions (unless disconnected islands).
   *  3. Hue & Accent Protection: Prioritizes merging into perceptually similar colors (DeltaE).
   *  4. Symmetrical Line Art Centerline Snapping: In ABSORB_LINES mode, region boundaries snap
   *     to the centerline of the artwork's drawn ink strokes.
   *  5. Region Color Recalibration: Re-evaluates true average source RGB so colors are faithful.
   *  6. Optional activeMask: Inactive pixels stay strictly 0 while active pixels are 100% covered.
   */
  static segment(
    width: number,
    height: number,
    palette: PaletteColor[],
    pixelClusters: Int32Array,
    minRegionArea: number = 48,
    maxMergePasses: number = 8,
    maxPerimeterToAreaRatio: number = 2.0,
    lineMask?: Uint8Array,
    lineHandling: LineHandlingMode = 'ABSORB_LINES',
    sourceRgba?: Uint8ClampedArray | Uint8Array,
    maxRegions: number = 200,
    onProgress?: (progress: number, status: string) => void,
    cellPartitionMap?: Int32Array,
    activeMask?: Uint8Array
  ): SegmentationResult {
    const total = width * height;
    if (total <= 0) {
      return {
        regions: [],
        regionMap: new Int32Array(0),
        borderMap: new Uint8Array(0),
      };
    }

    if (activeMask && !hasActiveMaskPixels(activeMask, total)) {
      return {
        regions: [],
        regionMap: new Int32Array(total),
        borderMap: new Uint8Array(total),
      };
    }

    const initialClusters = new Int32Array(pixelClusters);
    onProgress?.(0.68, 'Tracing connected components...');

    const components = traceConnectedComponents(
      width,
      height,
      initialClusters,
      cellPartitionMap,
      activeMask
    );
    if (components.regionCounter === 0) {
      return {
        regions: [],
        regionMap: new Int32Array(total),
        borderMap: new Uint8Array(total),
      };
    }

    const state = createUnionFindState(width, height, components, palette);

    onProgress?.(0.72, 'Enforcing minimum region area...');
    const targetMin = activeMask ? Math.max(1, minRegionArea) : Math.max(12, minRegionArea);
    dissolveSmallRegions(state, components.regionCounter, targetMin, maxMergePasses);
    dissolveSliverRegions(state, components.regionCounter, targetMin, maxPerimeterToAreaRatio);

    onProgress?.(0.82, 'Balancing puzzle region count...');
    const clampedMax = Math.min(2000, maxRegions || 200);
    const effectiveMaxRegions = activeMask ? Math.max(1, clampedMax) : Math.max(20, clampedMax);
    enforceMaxRegionCap(state, components.regionCounter, effectiveMaxRegions);

    const { finalRegionMap, activeFinalRegions } = flattenAndAlignRegions(
      state,
      components.regionCounter,
      total,
      lineMask,
      lineHandling,
      activeMask,
      onProgress
    );

    const borderMap = buildHairlineBorderMap(finalRegionMap, width, height);

    onProgress?.(0.92, 'Placing number centroids with optimal clearance...');
    const regions = buildFinalRegions(
      activeFinalRegions,
      finalRegionMap,
      borderMap,
      width,
      height,
      palette,
      sourceRgba
    );

    return {
      regions,
      regionMap: finalRegionMap,
      borderMap,
    };
  }
}
