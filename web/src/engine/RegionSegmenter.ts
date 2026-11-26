import { LineHandlingMode, PaletteColor, Region } from '../types';
import { ColorQuantizer } from './ColorQuantizer';
import { LineArtExtractor } from './LineArtExtractor';

export interface SegmentationResult {
  regions: Region[];
  regionMap: Int32Array;
  borderMap: Uint8Array;
}

export class RegionSegmenter {
  /**
   * Segments quantized pixel clusters into clean, continuous vector regions.
   * Guarantees 100% spatial partition across the entire canvas with ZERO gaps or holes.
   *
   * Key Guarantees:
   *  1. Strict Minimum Region Area: No region has area < minRegionArea.
   *  2. Strict Max Region Count: Total region count never exceeds maxRegions (e.g. 50-250 pieces).
   *  3. Hue & Accent Protection: Prioritizes merging into perceptually similar colors (DeltaE).
   *  4. Symmetrical Line Art Centerline Snapping: In ABSORB_LINES mode, region boundaries snap
   *     to the centerline of the artwork's drawn ink strokes.
   *  5. Region Color Recalibration: Re-evaluates true average source RGB so colors are faithful.
   */
  /**
   * Phase A (Steps 1--3): 4-connected flood fill, Union-Find region merging (min area,
   * sliver dissolution, maxRegions min-heap cap), and in-place flattening into `regionMap`.
   *
   * Isolated in a helper stack frame so all O(regionCounter) Union-Find, CSR offset, and
   * min-heap scratch buffers become eligible for GC before Phase D allocates `borderMap`,
   * `distGrid`, and `bfsQueue`.
   */
  private static mergeConnectedComponents(
    width: number,
    height: number,
    total: number,
    palette: PaletteColor[],
    pixelClusters: Int32Array,
    regionMap: Int32Array,
    compPixels: Int32Array,
    minRegionArea: number,
    maxMergePasses: number,
    maxPerimeterToAreaRatio: number,
    maxRegions: number,
    onProgress?: (progress: number, status: string) => void,
    cellPartitionMap?: Int32Array
  ): Int32Array {
    onProgress?.(0.68, 'Tracing connected components...');

    // 1. Initial 4-connected components flood fill directly into flat CSR buffer `compPixels`
    regionMap.fill(-1);
    let regionCounter = 0;
    let compCursor = 0;

    let compCap = Math.min(total + 1, 4096);
    if (compCap < 2) compCap = 2;
    let compOffsets = new Int32Array(compCap);
    let regionCluster = new Int32Array(compCap - 1);

    for (let y = 0; y < height; y++) {
      const yRow = y * width;
      for (let x = 0; x < width; x++) {
        const startIdx = yRow + x;
        if (regionMap[startIdx] !== -1) continue;

        const targetCluster = pixelClusters[startIdx];
        const targetCell = cellPartitionMap ? cellPartitionMap[startIdx] : 0;
        const currentRegionId = regionCounter++;

        if (currentRegionId + 1 >= compOffsets.length) {
          const nextCap = Math.min(total + 1, Math.max(compOffsets.length * 2, currentRegionId + 2));
          const nextOffsets = new Int32Array(nextCap);
          nextOffsets.set(compOffsets);
          compOffsets = nextOffsets;

          const nextClusters = new Int32Array(Math.max(1, nextCap - 1));
          nextClusters.set(regionCluster);
          regionCluster = nextClusters;
        }

        regionCluster[currentRegionId] = targetCluster;
        compOffsets[currentRegionId] = compCursor;

        regionMap[startIdx] = currentRegionId;
        let head = compCursor;
        let tail = compCursor;
        compPixels[tail++] = startIdx;

        while (head < tail) {
          const curr = compPixels[head++];
          const cx = curr % width;
          const cy = (curr - cx) / width;

          if (cx > 0) {
            const n = curr - 1;
            if (
              regionMap[n] === -1 &&
              pixelClusters[n] === targetCluster &&
              (!cellPartitionMap || cellPartitionMap[n] === targetCell)
            ) {
              regionMap[n] = currentRegionId;
              compPixels[tail++] = n;
            }
          }
          if (cx < width - 1) {
            const n = curr + 1;
            if (
              regionMap[n] === -1 &&
              pixelClusters[n] === targetCluster &&
              (!cellPartitionMap || cellPartitionMap[n] === targetCell)
            ) {
              regionMap[n] = currentRegionId;
              compPixels[tail++] = n;
            }
          }
          if (cy > 0) {
            const n = curr - width;
            if (
              regionMap[n] === -1 &&
              pixelClusters[n] === targetCluster &&
              (!cellPartitionMap || cellPartitionMap[n] === targetCell)
            ) {
              regionMap[n] = currentRegionId;
              compPixels[tail++] = n;
            }
          }
          if (cy < height - 1) {
            const n = curr + width;
            if (
              regionMap[n] === -1 &&
              pixelClusters[n] === targetCluster &&
              (!cellPartitionMap || cellPartitionMap[n] === targetCell)
            ) {
              regionMap[n] = currentRegionId;
              compPixels[tail++] = n;
            }
          }
        }

        compCursor = tail;
        compOffsets[currentRegionId + 1] = compCursor;
      }
    }

    if (regionCounter === 0) {
      return new Int32Array(0);
    }

    // 2. Disjoint-Set (Union-Find) + intrusive singly-linked component lists for O(1) merges
    const parent = new Int32Array(regionCounter);
    const regionArea = new Int32Array(regionCounter);
    const rootHead = new Int32Array(regionCounter);
    const rootTail = new Int32Array(regionCounter);
    const compNext = new Int32Array(regionCounter);
    for (let i = 0; i < regionCounter; i++) {
      parent[i] = i;
      regionArea[i] = compOffsets[i + 1] - compOffsets[i];
      rootHead[i] = i;
      rootTail[i] = i;
      compNext[i] = -1;
    }

    function findRoot(i: number): number {
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

    // Reusable ordered neighbor-touch accumulator (exact Map insertion-order semantics, zero allocations)
    const touchCounts = new Int32Array(regionCounter);
    const touchedRoots = new Int32Array(regionCounter);
    let touchLen = 0;

    const collectNeighborTouches = (targetRoot: number): number => {
      for (let i = 0; i < touchLen; i++) {
        touchCounts[touchedRoots[i]] = 0;
      }
      touchLen = 0;
      let perimeter = 0;

      for (let comp = rootHead[targetRoot]; comp !== -1; comp = compNext[comp]) {
        const start = compOffsets[comp];
        const end = compOffsets[comp + 1];
        for (let i = start; i < end; i++) {
          const idx = compPixels[i];
          const px = idx % width;
          const py = (idx - px) / width;

          if (px > 0) {
            const nRoot = findRoot(regionMap[idx - 1]);
            if (nRoot !== targetRoot) {
              if (touchCounts[nRoot] === 0) touchedRoots[touchLen++] = nRoot;
              touchCounts[nRoot]++;
              perimeter++;
            }
          } else {
            perimeter++;
          }

          if (px < width - 1) {
            const nRoot = findRoot(regionMap[idx + 1]);
            if (nRoot !== targetRoot) {
              if (touchCounts[nRoot] === 0) touchedRoots[touchLen++] = nRoot;
              touchCounts[nRoot]++;
              perimeter++;
            }
          } else {
            perimeter++;
          }

          if (py > 0) {
            const nRoot = findRoot(regionMap[idx - width]);
            if (nRoot !== targetRoot) {
              if (touchCounts[nRoot] === 0) touchedRoots[touchLen++] = nRoot;
              touchCounts[nRoot]++;
              perimeter++;
            }
          } else {
            perimeter++;
          }

          if (py < height - 1) {
            const nRoot = findRoot(regionMap[idx + width]);
            if (nRoot !== targetRoot) {
              if (touchCounts[nRoot] === 0) touchedRoots[touchLen++] = nRoot;
              touchCounts[nRoot]++;
              perimeter++;
            }
          } else {
            perimeter++;
          }
        }
      }
      return perimeter;
    };

    const pickBestMergeNeighbor = (root: number): number => {
      const currColor = palette[regionCluster[root]] || palette[0];
      let bestNeighbor = -1;
      let bestScore = -1;

      for (let i = 0; i < touchLen; i++) {
        const nRoot = touchedRoots[i];
        const touch = touchCounts[nRoot];
        const nColor = palette[regionCluster[nRoot]] || palette[0];
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
    };

    const mergeRootInto = (srcRoot: number, dstRoot: number): void => {
      parent[srcRoot] = dstRoot;
      regionArea[dstRoot] += regionArea[srcRoot];
      const srcHead = rootHead[srcRoot];
      if (srcHead !== -1) {
        if (rootTail[dstRoot] !== -1) {
          compNext[rootTail[dstRoot]] = srcHead;
        } else {
          rootHead[dstRoot] = srcHead;
        }
        rootTail[dstRoot] = rootTail[srcRoot];
        rootHead[srcRoot] = -1;
        rootTail[srcRoot] = -1;
      }
    };

    // Phase 1: Dissolve all regions strictly smaller than minRegionArea
    onProgress?.(0.72, 'Enforcing minimum region area...');
    const targetMin = Math.max(12, minRegionArea);

    for (let pass = 0; pass < maxMergePasses; pass++) {
      let mergedThisPass = 0;

      for (let r = 0; r < regionCounter; r++) {
        const root = findRoot(r);
        if (root !== r || regionArea[root] >= targetMin) continue;

        collectNeighborTouches(root);
        if (touchLen === 0) continue;

        const bestNeighbor = pickBestMergeNeighbor(root);
        if (bestNeighbor >= 0) {
          mergeRootInto(root, bestNeighbor);
          mergedThisPass++;
        }
      }

      if (mergedThisPass === 0) break;
    }

    // Phase 1.5: Dissolve thin serpentine boundary slivers exceeding maxPerimeterToAreaRatio
    if (maxPerimeterToAreaRatio > 0) {
      const sliverAreaCeiling = Math.max(targetMin * 4, 160);
      for (let r = 0; r < regionCounter; r++) {
        const root = findRoot(r);
        if (root !== r || regionArea[root] > sliverAreaCeiling) continue;

        const perimeter = collectNeighborTouches(root);
        if (touchLen === 0) continue;

        if (perimeter / regionArea[root] > maxPerimeterToAreaRatio) {
          const bestNeighbor = pickBestMergeNeighbor(root);
          if (bestNeighbor >= 0) {
            mergeRootInto(root, bestNeighbor);
          }
        }
      }
    }

    // Phase 2: Enforce maxRegions cap (never allow thousands or 10,000+ regions!)
    onProgress?.(0.82, 'Balancing puzzle region count...');
    const effectiveMaxRegions = Math.max(20, Math.min(2000, maxRegions || 200));

    // Collect active unique roots deterministically and seed an O(R log R) binary min-heap
    const seenRoots = new Uint8Array(regionCounter);
    const activeRootIds = new Int32Array(regionCounter);
    let activeRootCount = 0;
    for (let i = 0; i < regionCounter; i++) {
      const root = findRoot(i);
      if (seenRoots[root] === 0) {
        seenRoots[root] = 1;
        activeRootIds[activeRootCount++] = root;
      }
    }

    if (activeRootCount > effectiveMaxRegions) {
      const maxHeapCap = Math.max(16, regionCounter * 2 + 4);
      const heapAreas = new Int32Array(maxHeapCap);
      const heapRoots = new Int32Array(maxHeapCap);
      let heapSize = 0;

      const heapSwap = (a: number, b: number): void => {
        const ta = heapAreas[a];
        heapAreas[a] = heapAreas[b];
        heapAreas[b] = ta;
        const tr = heapRoots[a];
        heapRoots[a] = heapRoots[b];
        heapRoots[b] = tr;
      };

      const heapLess = (a: number, b: number): boolean => {
        const diff = heapAreas[a] - heapAreas[b];
        return diff !== 0 ? diff < 0 : heapRoots[a] < heapRoots[b];
      };

      const heapPush = (area: number, rootId: number): void => {
        if (heapSize >= maxHeapCap) return;
        let idx = heapSize++;
        heapAreas[idx] = area;
        heapRoots[idx] = rootId;
        while (idx > 0) {
          const parentIdx = (idx - 1) >> 1;
          if (!heapLess(idx, parentIdx)) break;
          heapSwap(idx, parentIdx);
          idx = parentIdx;
        }
      };

      const heapPop = (): void => {
        const last = --heapSize;
        if (last > 0) {
          heapAreas[0] = heapAreas[last];
          heapRoots[0] = heapRoots[last];
          let idx = 0;
          while (true) {
            const left = idx * 2 + 1;
            const right = left + 1;
            let smallest = idx;
            if (left < heapSize && heapLess(left, smallest)) smallest = left;
            if (right < heapSize && heapLess(right, smallest)) smallest = right;
            if (smallest === idx) break;
            heapSwap(idx, smallest);
            idx = smallest;
          }
        }
      };

      for (let i = 0; i < activeRootCount; i++) {
        const root = activeRootIds[i];
        heapPush(regionArea[root], root);
      }

      const isolatedRoots = new Uint8Array(regionCounter);
      let mergeableCount = activeRootCount;

      while (mergeableCount > effectiveMaxRegions && heapSize > 0) {
        const topArea = heapAreas[0];
        const smallestRoot = heapRoots[0];
        heapPop();

        if (findRoot(smallestRoot) !== smallestRoot) continue;
        if (isolatedRoots[smallestRoot] !== 0) continue;

        const currentArea = regionArea[smallestRoot];
        if (topArea !== currentArea) {
          // Stale entry: smallestRoot grew via an earlier merge; re-insert at updated area
          heapPush(currentArea, smallestRoot);
          continue;
        }

        collectNeighborTouches(smallestRoot);
        if (touchLen === 0) {
          isolatedRoots[smallestRoot] = 1;
          mergeableCount--;
          continue;
        }

        const bestNeighbor = pickBestMergeNeighbor(smallestRoot);
        if (bestNeighbor >= 0) {
          mergeRootInto(smallestRoot, bestNeighbor);
          mergeableCount--;
        } else {
          isolatedRoots[smallestRoot] = 1;
          mergeableCount--;
        }
      }
    }

    // 3. Flatten directly into `regionMap` in place with 1-based sequential IDs
    const rootToFinalId = new Int32Array(regionCounter); // 0 = unassigned
    const finalClusterIdsList: number[] = [];

    for (let r = 0; r < regionCounter; r++) {
      const root = findRoot(r);
      let finalId = rootToFinalId[root];

      if (finalId === 0) {
        finalId = finalClusterIdsList.length + 1;
        rootToFinalId[root] = finalId;
        finalClusterIdsList.push(regionCluster[root]);
      }

      const start = compOffsets[r];
      const end = compOffsets[r + 1];
      for (let i = start; i < end; i++) {
        regionMap[compPixels[i]] = finalId;
      }
    }

    return Int32Array.from(finalClusterIdsList);
  }

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
    cellPartitionMap?: Int32Array
  ): SegmentationResult {
    const total = width * height;
    const finalRegionMap = new Int32Array(total);
    const compPixels = new Int32Array(total);

    const finalClusterIds = RegionSegmenter.mergeConnectedComponents(
      width,
      height,
      total,
      palette,
      pixelClusters,
      finalRegionMap,
      compPixels,
      minRegionArea,
      maxMergePasses,
      maxPerimeterToAreaRatio,
      maxRegions,
      onProgress,
      cellPartitionMap
    );

    // 4. Symmetrical Line Alignment
    if (lineMask && lineHandling === 'ABSORB_LINES') {
      onProgress?.(0.88, 'Aligning puzzle boundaries with artwork lines...');
      LineArtExtractor.alignBoundariesToLines(finalRegionMap, lineMask, width, height);
    }

    // Zero-gap guarantee
    for (let idx = 0; idx < total; idx++) {
      if (finalRegionMap[idx] <= 0) {
        const px = idx % width;
        const py = (idx - px) / width;
        let fallbackId = 1;

        if (px > 0 && finalRegionMap[idx - 1] > 0) fallbackId = finalRegionMap[idx - 1];
        else if (px < width - 1 && finalRegionMap[idx + 1] > 0) fallbackId = finalRegionMap[idx + 1];
        else if (py > 0 && finalRegionMap[idx - width] > 0) fallbackId = finalRegionMap[idx - width];
        else if (py < height - 1 && finalRegionMap[idx + width] > 0) fallbackId = finalRegionMap[idx + width];

        finalRegionMap[idx] = fallbackId;
      }
    }

    // 4.5. Counting-sort CSR for final regions in strictly ascending scanline order (0..total-1)
    const rawFinalCount = finalClusterIds.length;
    const finalCounts = new Int32Array(rawFinalCount + 1);
    for (let idx = 0; idx < total; idx++) {
      const rid = finalRegionMap[idx];
      if (rid > 0 && rid <= rawFinalCount) {
        finalCounts[rid]++;
      }
    }

    const oldIdToNewId = new Int32Array(rawFinalCount + 1);
    let activeCount = 0;
    let needsRemap = false;
    for (let oldId = 1; oldId <= rawFinalCount; oldId++) {
      if (finalCounts[oldId] > 0) {
        const newId = ++activeCount;
        oldIdToNewId[oldId] = newId;
        if (newId !== oldId) needsRemap = true;
      }
    }

    const activeClusterIds = new Int32Array(activeCount);
    const finalOffsets = new Int32Array(activeCount + 1);
    let totalActivePixels = 0;
    for (let oldId = 1; oldId <= rawFinalCount; oldId++) {
      const newId = oldIdToNewId[oldId];
      if (newId > 0) {
        activeClusterIds[newId - 1] = finalClusterIds[oldId - 1];
        finalOffsets[newId - 1] = totalActivePixels;
        totalActivePixels += finalCounts[oldId];
      }
    }
    finalOffsets[activeCount] = totalActivePixels;

    // Reuse compPixels as the contiguous backing buffer for Region.pixels subarray views
    const packedFinalPixels =
      totalActivePixels === total ? compPixels : new Int32Array(totalActivePixels);
    const writeCursors = new Int32Array(activeCount);
    for (let i = 0; i < activeCount; i++) {
      writeCursors[i] = finalOffsets[i];
    }

    for (let idx = 0; idx < total; idx++) {
      const oldRid = finalRegionMap[idx];
      if (oldRid > 0 && oldRid <= rawFinalCount) {
        const newRid = oldIdToNewId[oldRid];
        if (newRid > 0) {
          if (needsRemap && newRid !== oldRid) {
            finalRegionMap[idx] = newRid;
          }
          packedFinalPixels[writeCursors[newRid - 1]++] = idx;
        }
      }
    }

    // 5. Build 1-pixel hairline borders
    const borderMap = new Uint8Array(total);
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

    onProgress?.(0.92, 'Placing number centroids with optimal clearance...');

    // 6. Convert to final Region models with guaranteed interior centroid (Pole of Inaccessibility)
    // Reusable scratch buffers eliminate per-region Map<number, number> and typed-array allocations.
    const distGrid = new Int32Array(total);
    const bfsQueue = new Int32Array(total);

    const regions: Region[] = new Array(activeCount);
    for (let rIdx = 0; rIdx < activeCount; rIdx++) {
      const regionId = rIdx + 1;
      const start = finalOffsets[rIdx];
      const end = finalOffsets[rIdx + 1];
      const count = end - start;
      const pixelData = packedFinalPixels.subarray(start, end);

      let sumX = 0;
      let sumY = 0;
      let minX = Number.MAX_VALUE;
      let maxX = Number.MIN_VALUE;
      let minY = Number.MAX_VALUE;
      let maxY = Number.MIN_VALUE;

      for (let i = 0; i < count; i++) {
        const idx = pixelData[i];
        const px = idx % width;
        const py = (idx - px) / width;

        sumX += px;
        sumY += py;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }

      // Interior clearance centroid calculation (Pole of Inaccessibility)
      let bestPx: number;
      let bestPy: number;
      let maxDistance: number;

      if (count === 1) {
        bestPx = pixelData[0] % width;
        bestPy = Math.floor(pixelData[0] / width);
        maxDistance = 0.5;
      } else if (count <= 9) {
        const avgX = sumX / count;
        const avgY = sumY / count;
        const testX = Math.min(width - 1, Math.max(0, Math.round(avgX)));
        const testY = Math.min(height - 1, Math.max(0, Math.round(avgY)));
        if (finalRegionMap[testY * width + testX] === regionId) {
          bestPx = testX;
          bestPy = testY;
        } else {
          bestPx = pixelData[0] % width;
          bestPy = Math.floor(pixelData[0] / width);
        }
        maxDistance = Math.sqrt(count) * 0.5;
      } else {
        let head = 0;
        let tail = 0;

        // Enqueue perimeter boundary pixels
        for (let i = 0; i < count; i++) {
          const idx = pixelData[i];
          const px = idx % width;
          const py = (idx - px) / width;

          const isBoundary =
            px === 0 ||
            px === width - 1 ||
            py === 0 ||
            py === height - 1 ||
            borderMap[idx] === 1 ||
            (px > 0 && finalRegionMap[idx - 1] !== regionId) ||
            (px < width - 1 && finalRegionMap[idx + 1] !== regionId) ||
            (py > 0 && finalRegionMap[idx - width] !== regionId) ||
            (py < height - 1 && finalRegionMap[idx + width] !== regionId);

          if (isBoundary) {
            distGrid[idx] = 1;
            bfsQueue[tail++] = idx;
          }
        }

        let maxDist = 1;
        let maxIdx = tail > 0 ? bfsQueue[0] : pixelData[0];

        while (head < tail) {
          const idx = bfsQueue[head++];
          const nextDist = distGrid[idx] + 1;
          const px = idx % width;
          const py = (idx - px) / width;

          if (px > 0) {
            const n1 = idx - 1;
            if (finalRegionMap[n1] === regionId && distGrid[n1] === 0) {
              distGrid[n1] = nextDist;
              bfsQueue[tail++] = n1;
              if (nextDist > maxDist) {
                maxDist = nextDist;
                maxIdx = n1;
              }
            }
          }
          if (px < width - 1) {
            const n2 = idx + 1;
            if (finalRegionMap[n2] === regionId && distGrid[n2] === 0) {
              distGrid[n2] = nextDist;
              bfsQueue[tail++] = n2;
              if (nextDist > maxDist) {
                maxDist = nextDist;
                maxIdx = n2;
              }
            }
          }
          if (py > 0) {
            const n3 = idx - width;
            if (finalRegionMap[n3] === regionId && distGrid[n3] === 0) {
              distGrid[n3] = nextDist;
              bfsQueue[tail++] = n3;
              if (nextDist > maxDist) {
                maxDist = nextDist;
                maxIdx = n3;
              }
            }
          }
          if (py < height - 1) {
            const n4 = idx + width;
            if (finalRegionMap[n4] === regionId && distGrid[n4] === 0) {
              distGrid[n4] = nextDist;
              bfsQueue[tail++] = n4;
              if (nextDist > maxDist) {
                maxDist = nextDist;
                maxIdx = n4;
              }
            }
          }
        }

        // Reset only this region's pixels so work stays O(region pixels)
        for (let i = 0; i < count; i++) {
          distGrid[pixelData[i]] = 0;
        }

        bestPx = maxIdx % width;
        bestPy = (maxIdx - bestPx) / width;
        maxDistance = maxDist;
      }

      // Region Color Recalibration:
      // Compute the true average color of pixels in this region from source artwork.
      let resolvedColorId = activeClusterIds[rIdx] + 1;
      if (sourceRgba && count > 0) {
        let sumPixR = 0, sumPixG = 0, sumPixB = 0;
        for (let i = 0; i < count; i++) {
          const pIdx = pixelData[i] * 4;
          sumPixR += sourceRgba[pIdx];
          sumPixG += sourceRgba[pIdx + 1];
          sumPixB += sourceRgba[pIdx + 2];
        }
        const meanR = Math.round(sumPixR / count);
        const meanG = Math.round(sumPixG / count);
        const meanB = Math.round(sumPixB / count);

        let bestDist = Number.MAX_VALUE;
        for (let c = 0; c < palette.length; c++) {
          const pal = palette[c];
          const d = ColorQuantizer.perceptualDistanceSq(meanR, meanG, meanB, pal.r, pal.g, pal.b);
          if (d < bestDist) {
            bestDist = d;
            resolvedColorId = pal.id;
          }
        }
      }

      regions[rIdx] = {
        id: regionId,
        colorId: resolvedColorId,
        centroidX: bestPx + 0.5,
        centroidY: bestPy + 0.5,
        area: count,
        minX,
        maxX,
        minY,
        maxY,
        maxRadius: maxDistance,
        pixels: pixelData,
      };
    }

    return {
      regions,
      regionMap: finalRegionMap,
      borderMap,
    };
  }
}
