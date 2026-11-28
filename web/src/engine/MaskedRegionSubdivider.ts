import {
  ALL_INFINITE_ZOOM_MODEL_IDS,
  DEFAULT_GENERATOR_CONFIG,
  GeneratorConfig,
  INFINITE_ZOOM_PROVIDER_MODES,
  InfiniteZoomModelId,
  InfiniteZoomProviderMode,
  NestedPuzzleLayer,
  NormalizedRect,
  PaletteColor,
  PuzzleData,
  Region,
} from '../types';
import { buildBorderMapFromRegionMap } from '../services/CapyCodec';
import { ColorQuantizer } from './ColorQuantizer';
import { AutoPuzzleGenerator } from './PuzzleGenerator';
import {
  MAX_DELTA_REGION_ENTRIES,
  MAX_NESTED_LAYERS,
  MAX_PUZZLE_PIXELS,
  MAX_ZOOM_DEPTH,
  buildOutpaintBorderMask,
  clampNormalizedRect,
  getMaxGlobalRegionId,
  isSafeLayerId,
  isSafeLayerImageKey,
  isValidNormalizedRect,
  rebaseLayerWorldBounds,
} from './UnifiedPuzzleLayers';

export { buildOutpaintBorderMask };

export const MAX_TOTAL_PALETTE_SWATCHES = 96;
export const DEFAULT_MAX_NEW_SWATCHES = 6;
export const DEFAULT_REUSE_DELTA_E = 22;
export const DEFAULT_ZOOM_IN_TARGET_REGIONS = 200;
export const MAX_SUBDIVIDE_TARGET_REGIONS = 800;

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
  generatorConfig?: Partial<GeneratorConfig>;
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

export function createPaletteColor(id: number, r: number, g: number, b: number): PaletteColor {
  const cr = Math.max(0, Math.min(255, Math.round(r)));
  const cg = Math.max(0, Math.min(255, Math.round(g)));
  const cb = Math.max(0, Math.min(255, Math.round(b)));
  const lum = 0.299 * cr + 0.587 * cg + 0.114 * cb;
  const hex = `#${((1 << 24) | (cr << 16) | (cg << 8) | cb).toString(16).slice(1).toUpperCase()}`;
  const argb = ((0xff << 24) | (cr << 16) | (cg << 8) | cb) >>> 0;
  return { id, hex, isLight: lum > 140, argb, r: cr, g: cg, b: cb };
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
  existingPalette: PaletteColor[],
  reserveLastInkSwatch: boolean = false
): { palette: PaletteColor[]; addedSwatches: PaletteColor[] } {
  const palette = existingPalette.map((c) => ({ ...c }));
  const usable =
    reserveLastInkSwatch && palette.length > 1 ? palette.slice(0, palette.length - 1) : palette;
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

function sanitizeFiniteNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isSwatchDuplicateOrClose(
  candidate: PaletteColor,
  finalPalette: PaletteColor[],
  reuseThresholdSq: number
): boolean {
  if (finalPalette.length === 0) return false;
  const closest = findClosestPaletteSwatch(
    candidate.r,
    candidate.g,
    candidate.b,
    finalPalette
  );
  if (closest.distSq <= reuseThresholdSq) return true;
  for (let j = 0; j < finalPalette.length; j++) {
    const p = finalPalette[j];
    if (p.r === candidate.r && p.g === candidate.g && p.b === candidate.b) {
      return true;
    }
  }
  return false;
}

function pruneUnusedAddedSwatches(
  regions: Region[],
  existingPalette: PaletteColor[],
  finalPalette: PaletteColor[],
  addedSwatches: PaletteColor[]
): { palette: PaletteColor[]; addedSwatches: PaletteColor[] } {
  if (addedSwatches.length === 0) {
    return { palette: finalPalette, addedSwatches };
  }
  const usedIds = new Set<number>();
  for (let i = 0; i < regions.length; i++) {
    usedIds.add(regions[i].colorId);
  }
  const keptAdded = addedSwatches.filter((s) => usedIds.has(s.id));
  if (keptAdded.length === addedSwatches.length) {
    return { palette: finalPalette, addedSwatches };
  }
  const baseLen = existingPalette.length;
  const baseMaxId = existingPalette.reduce((m, c) => Math.max(m, c.id), 0);
  const idRemap = new Map<number, number>();
  const remappedAdded: PaletteColor[] = [];
  let remappedNextId = baseMaxId;
  for (let i = 0; i < keptAdded.length; i++) {
    const oldSwatch = keptAdded[i];
    const newId = ++remappedNextId;
    idRemap.set(oldSwatch.id, newId);
    remappedAdded.push({ ...oldSwatch, id: newId });
  }
  for (let i = 0; i < regions.length; i++) {
    const mapped = idRemap.get(regions[i].colorId);
    if (mapped !== undefined) {
      regions[i].colorId = mapped;
    }
  }
  return {
    palette: [...finalPalette.slice(0, baseLen), ...remappedAdded],
    addedSwatches: remappedAdded,
  };
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
  const safeMaxNewSwatches = Math.max(
    0,
    Math.floor(sanitizeFiniteNumber(maxNewSwatches, DEFAULT_MAX_NEW_SWATCHES))
  );
  const safeReuseDeltaE = Math.max(0, sanitizeFiniteNumber(reuseDeltaE, DEFAULT_REUSE_DELTA_E));
  const remainingSlots = Math.max(0, MAX_TOTAL_PALETTE_SWATCHES - existingPalette.length);
  let allowedNew = Math.min(safeMaxNewSwatches, remainingSlots);
  if (existingPalette.length === 0 && allowedNew === 0) {
    allowedNew = 1;
  }

  const unmatched: UnmatchedRegionColor[] = [];
  const reuseThresholdSq = safeReuseDeltaE * safeReuseDeltaE;

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
    const accents = clusterUnmatchedColors(unmatched, allowedNew, safeReuseDeltaE);
    for (let i = 0; i < accents.length; i++) {
      const candidate = createPaletteColor(
        nextPaletteId + 1,
        accents[i].r,
        accents[i].g,
        accents[i].b
      );
      if (isSwatchDuplicateOrClose(candidate, finalPalette, reuseThresholdSq)) continue;
      nextPaletteId += 1;
      addedSwatches.push(candidate);
      finalPalette.push(candidate);
    }
  }

  if (unmatched.length > 0 && finalPalette.length > 0) {
    for (let i = 0; i < unmatched.length; i++) {
      const u = unmatched[i];
      regions[u.regionIdx].colorId = findClosestPaletteSwatch(u.r, u.g, u.b, finalPalette).id;
    }
  }

  return pruneUnusedAddedSwatches(regions, existingPalette, finalPalette, addedSwatches);
}

function prepareMaskedSubdivisionBuffers(
  rgbaData: Uint8ClampedArray,
  cropWidth: number,
  cropHeight: number,
  cropMask: Uint8Array
): {
  safeWidth: number;
  safeHeight: number;
  maskedCount: number;
  activeMask: Uint8Array;
  effectiveRgba: Uint8ClampedArray;
} {
  const safeWidth = Number.isSafeInteger(cropWidth) && cropWidth > 0 ? cropWidth : 0;
  const safeHeight = Number.isSafeInteger(cropHeight) && cropHeight > 0 ? cropHeight : 0;
  const total = safeWidth * safeHeight;
  if (
    safeWidth === 0 ||
    safeHeight === 0 ||
    !Number.isSafeInteger(total) ||
    total > MAX_PUZZLE_PIXELS
  ) {
    return {
      safeWidth: 0,
      safeHeight: 0,
      maskedCount: 0,
      activeMask: new Uint8Array(0),
      effectiveRgba: rgbaData,
    };
  }
  const limit = Math.min(total, cropMask.length, Math.floor(rgbaData.length / 4));
  let maskedCount = 0;
  for (let i = 0; i < limit; i++) {
    if (cropMask[i] === 1) maskedCount++;
  }
  if (maskedCount === 0) {
    return {
      safeWidth,
      safeHeight,
      maskedCount: 0,
      activeMask: new Uint8Array(total),
      effectiveRgba: rgbaData,
    };
  }
  if (cropMask.length === total && rgbaData.length >= total * 4) {
    return { safeWidth, safeHeight, maskedCount, activeMask: cropMask, effectiveRgba: rgbaData };
  }

  const activeMask = new Uint8Array(total);
  for (let i = 0; i < limit; i++) {
    if (cropMask[i] === 1) activeMask[i] = 1;
  }
  const effectiveRgba = new Uint8ClampedArray(total * 4);
  effectiveRgba.set(rgbaData.subarray(0, Math.min(rgbaData.length, total * 4)));
  return { safeWidth, safeHeight, maskedCount, activeMask, effectiveRgba };
}

function buildSubdivisionGeneratorConfig(
  cropWidth: number,
  cropHeight: number,
  maskedCount: number,
  targetSubRegions: number,
  minRegionArea: number,
  rawConfig?: Partial<GeneratorConfig>
): GeneratorConfig {
  const cfg =
    rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig)
      ? rawConfig
      : undefined;
  const rawDesiredK =
    targetSubRegions <= 1
      ? 1
      : Math.min(
          24,
          Math.max(2, Math.min(targetSubRegions, Math.ceil(targetSubRegions * 0.75) + 1))
        );
  const areaLimitedK = Math.max(
    1,
    Math.min(maskedCount, Math.floor(maskedCount / minRegionArea) || 1)
  );
  const requestedColorCount =
    cfg && typeof cfg.colorCount === 'number' && Number.isFinite(cfg.colorCount)
      ? Math.max(1, Math.min(64, Math.floor(cfg.colorCount)))
      : rawDesiredK;
  const effectiveColorCount = Math.max(1, Math.min(requestedColorCount, areaLimitedK));
  const paletteDetail =
    cfg?.paletteDetail && cfg.paletteDetail !== 'CUSTOM' ? cfg.paletteDetail : 'CUSTOM';

  return {
    algorithm: cfg?.algorithm ?? DEFAULT_GENERATOR_CONFIG.algorithm,
    lineHandling: cfg?.lineHandling ?? DEFAULT_GENERATOR_CONFIG.lineHandling,
    imageType: cfg?.imageType ?? DEFAULT_GENERATOR_CONFIG.imageType,
    paletteDetail,
    colorCount: effectiveColorCount,
    minRegionArea,
    maxRegions: targetSubRegions,
    resolution: Math.max(cropWidth, cropHeight),
    smoothingPasses: Math.max(
      0,
      Math.floor(
        sanitizeFiniteNumber(cfg?.smoothingPasses, DEFAULT_GENERATOR_CONFIG.smoothingPasses)
      )
    ),
    // Always keep isFreeColor: false inside the shared generator so K-Means++, colored-ink
    // ridges, and user-chosen strategies run faithfully; Free Colour graph coloring runs below.
    isFreeColor: false,
  };
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
    generatorConfig,
    onProgress,
  } = params;

  const { safeWidth, safeHeight, maskedCount, activeMask, effectiveRgba } =
    prepareMaskedSubdivisionBuffers(rgbaData, cropWidth, cropHeight, cropMask);
  if (maskedCount === 0) {
    onProgress?.(1.0, 'No masked pixels to subdivide.');
    return {
      width: safeWidth,
      height: safeHeight,
      localRegionMap: new Int32Array(safeWidth * safeHeight),
      regions: [],
      palette: existingPalette.map((c) => ({ ...c })),
      addedSwatches: [],
    };
  }

  onProgress?.(0.1, 'Preparing masked detail region...');

  const targetSubRegions = Math.max(
    1,
    Math.min(
      MAX_SUBDIVIDE_TARGET_REGIONS,
      Math.floor(sanitizeFiniteNumber(params.targetSubRegions, DEFAULT_ZOOM_IN_TARGET_REGIONS))
    )
  );
  const minRegionArea = Math.max(1, Math.floor(sanitizeFiniteNumber(params.minRegionArea, 24)));
  const maxNewSwatches = Math.max(
    0,
    Math.floor(sanitizeFiniteNumber(params.maxNewSwatches, DEFAULT_MAX_NEW_SWATCHES))
  );
  const reuseDeltaE = Math.max(0, sanitizeFiniteNumber(params.reuseDeltaE, DEFAULT_REUSE_DELTA_E));

  const effectiveConfig = buildSubdivisionGeneratorConfig(
    safeWidth,
    safeHeight,
    maskedCount,
    targetSubRegions,
    minRegionArea,
    generatorConfig
  );

  const mappedProgress = onProgress
    ? (p: number, status: string) => {
        const clamped = Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : 0;
        onProgress(0.12 + clamped * 0.78, status);
      }
    : undefined;

  const generated = new AutoPuzzleGenerator().generateFromRgba(
    effectiveRgba,
    safeWidth,
    safeHeight,
    effectiveConfig,
    mappedProgress,
    false,
    activeMask
  );

  onProgress?.(0.94, 'Harmonizing sub-region palette...');
  const { palette, addedSwatches } = isFreeColor
    ? assignFreeColorIds(
        generated.regions,
        generated.regionMap,
        safeWidth,
        safeHeight,
        existingPalette,
        false
      )
    : assignHarmoniousPaletteColors(
        generated.regions,
        effectiveRgba,
        existingPalette,
        maxNewSwatches,
        reuseDeltaE
      );

  onProgress?.(1.0, `Subdivided into ${generated.regions.length} detail regions.`);
  return {
    width: safeWidth,
    height: safeHeight,
    localRegionMap: generated.regionMap,
    regions: generated.regions,
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


const VALID_PROVIDER_MODES = new Set<InfiniteZoomProviderMode>(INFINITE_ZOOM_PROVIDER_MODES);

const VALID_MODEL_IDS = new Set<InfiniteZoomModelId>(ALL_INFINITE_ZOOM_MODEL_IDS);

const MAX_LAYER_PROMPT_HINT_LEN = 200;

export function mergePreservingBasePalette(
  basePalette: readonly PaletteColor[],
  subPalette: readonly PaletteColor[]
): PaletteColor[] {
  const merged: PaletteColor[] = [];
  const seenIds = new Set<number>();
  for (let i = 0; i < basePalette.length; i++) {
    const swatch = basePalette[i];
    if (!swatch) continue;
    merged.push({ ...swatch });
    seenIds.add(swatch.id);
  }
  for (let i = 0; i < subPalette.length; i++) {
    const swatch = subPalette[i];
    if (!swatch || seenIds.has(swatch.id)) continue;
    if (merged.length >= MAX_TOTAL_PALETTE_SWATCHES) {
      throw new Error(
        `Merged palette exceeds MAX_TOTAL_PALETTE_SWATCHES (${MAX_TOTAL_PALETTE_SWATCHES})`
      );
    }
    merged.push({ ...swatch });
    seenIds.add(swatch.id);
  }
  return merged;
}

function cloneRegion(region: Region): Region {
  return {
    id: region.id,
    colorId: region.colorId,
    centroidX: region.centroidX,
    centroidY: region.centroidY,
    area: region.area,
    minX: region.minX,
    maxX: region.maxX,
    minY: region.minY,
    maxY: region.maxY,
    maxRadius: region.maxRadius,
    pixels: new Int32Array(region.pixels),
  };
}

function buildNestedLayerWithGrid(
  layer: NestedPuzzleLayer,
  regions: Region[],
  regionMap: Int32Array,
  borderMap: Uint8Array
): NestedPuzzleLayer {
  const next: NestedPuzzleLayer = {
    layerId: layer.layerId,
    depth: layer.depth,
    worldBounds: {
      x: layer.worldBounds.x,
      y: layer.worldBounds.y,
      width: layer.worldBounds.width,
      height: layer.worldBounds.height,
    },
    width: layer.width,
    height: layer.height,
    regions,
    regionMap,
    borderMap,
    imageBlobKey: layer.imageBlobKey,
  };
  if (layer.promptHint !== undefined) next.promptHint = layer.promptHint;
  if (layer.providerUsed !== undefined) next.providerUsed = layer.providerUsed;
  if (layer.modelUsed !== undefined) next.modelUsed = layer.modelUsed;
  return next;
}

function cloneNestedLayer(layer: NestedPuzzleLayer): NestedPuzzleLayer {
  return buildNestedLayerWithGrid(
    layer,
    layer.regions.map(cloneRegion),
    new Int32Array(layer.regionMap),
    new Uint8Array(layer.borderMap)
  );
}

export interface EmbedNestedDetailLayerParams {
  basePuzzle: PuzzleData;
  /** `null` or omitted targets root `basePuzzle`; string targets matching `NestedPuzzleLayer.layerId` */
  targetLayerId?: string | null;
  /** Region IDs inside the target layer being replaced by the new detail layer */
  selectedRegionIds: ReadonlySet<number>;
  /** Output of `subdivideMaskedRegion` (may be higher resolution than target crop) */
  subResult: MaskedSubdivisionResult;
  /** Explicit root-space [0..1] worldBounds (used as-is, never double-rebased) */
  worldBounds?: NormalizedRect;
  /** Optional parent-local [0..1] bounds (rebased through parent layer worldBounds when nested) */
  localBoundsInParent?: NormalizedRect;
  /** Optional unique safe layerId; auto-generated if omitted */
  layerId?: string;
  /** Safe layer image blob key matching `layer_...` */
  imageBlobKey: string;
  promptHint?: string;
  providerUsed?: InfiniteZoomProviderMode;
  modelUsed?: InfiniteZoomModelId;
}

export interface EmbedNestedDetailLayerResult {
  puzzle: PuzzleData;
  layer: NestedPuzzleLayer;
  removedRegionIds: number[];
  addedRegionIds: number[];
  prunedLayerIds: string[];
}

export interface WrapPuzzleWithOuterBorderParams {
  basePuzzle: PuzzleData;
  /** Output of `subdivideMaskedRegion` on extended canvas with `cropMask[i] = 0` inside inner rect */
  outerSubResult: MaskedSubdivisionResult;
  /** Exact normalized [0..1] inner rect inside the new outer canvas (`ExtendSidesCheck.boundsInParent`) */
  innerBoundsInOuter: NormalizedRect;
  /** Safe layer image blob key (`layer_...`) storing the previous root artwork */
  previousRootImageBlobKey: string;
  /** Optional safe layerId for the demoted previous root layer */
  previousRootLayerId?: string;
  promptHint?: string;
  providerUsed?: InfiniteZoomProviderMode;
  modelUsed?: InfiniteZoomModelId;
}

export interface WrapPuzzleWithOuterBorderResult {
  puzzle: PuzzleData;
  demotedRootLayer: NestedPuzzleLayer;
  addedOuterRegionIds: number[];
}

function assertValidGridDimensions(width: number, height: number, label: string): number {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`${label} has invalid dimensions (${width}x${height})`);
  }
  const total = width * height;
  if (total > MAX_PUZZLE_PIXELS) {
    throw new Error(`${label} pixel count ${total} exceeds MAX_PUZZLE_PIXELS`);
  }
  return total;
}

function assertValidBasePuzzle(basePuzzle: PuzzleData): void {
  if (!basePuzzle || typeof basePuzzle !== 'object') {
    throw new Error('basePuzzle is required');
  }
  const total = assertValidGridDimensions(basePuzzle.width, basePuzzle.height, 'basePuzzle');
  if (!Array.isArray(basePuzzle.regions)) {
    throw new Error('basePuzzle.regions must be an array');
  }
  if (!Array.isArray(basePuzzle.palette)) {
    throw new Error('basePuzzle.palette must be an array');
  }
  if (!(basePuzzle.regionMap instanceof Int32Array) || basePuzzle.regionMap.length !== total) {
    throw new Error('basePuzzle.regionMap has invalid length');
  }
  if (!(basePuzzle.borderMap instanceof Uint8Array) || basePuzzle.borderMap.length !== total) {
    throw new Error('basePuzzle.borderMap has invalid length');
  }
  if (
    basePuzzle.maxZoomDepth !== undefined &&
    (!Number.isInteger(basePuzzle.maxZoomDepth) ||
      basePuzzle.maxZoomDepth < 0 ||
      basePuzzle.maxZoomDepth > MAX_ZOOM_DEPTH)
  ) {
    throw new Error(
      `Invalid basePuzzle.maxZoomDepth: ${String(basePuzzle.maxZoomDepth)} (expected integer in 0..${MAX_ZOOM_DEPTH})`
    );
  }
  if (basePuzzle.nestedLayers !== undefined && !Array.isArray(basePuzzle.nestedLayers)) {
    throw new Error('basePuzzle.nestedLayers must be an array');
  }
}

function assertValidSingleExistingNestedLayer(
  layer: NestedPuzzleLayer,
  index: number,
  maxAllowedDepth: number,
  seenLayerIds: Set<string>
): void {
  if (!layer || typeof layer !== 'object' || Array.isArray(layer)) {
    throw new Error(`Existing nested layer at index ${index} must be an object`);
  }
  if (!isSafeLayerId(layer.layerId)) {
    throw new Error(
      `Existing nested layer at index ${index} has invalid layerId: ${String(layer.layerId)}`
    );
  }
  if (seenLayerIds.has(layer.layerId)) {
    throw new Error(`Duplicate existing nested layerId: ${layer.layerId}`);
  }
  seenLayerIds.add(layer.layerId);
  if (!isSafeLayerImageKey(layer.imageBlobKey)) {
    throw new Error(
      `Existing nested layer ${layer.layerId} has invalid imageBlobKey: ${String(layer.imageBlobKey)}`
    );
  }
  if (!Number.isInteger(layer.depth) || layer.depth < 1 || layer.depth > maxAllowedDepth) {
    throw new Error(
      `Existing nested layer ${layer.layerId} has invalid depth ${String(layer.depth)} (expected integer in 1..${maxAllowedDepth})`
    );
  }
  const layerTotal = assertValidGridDimensions(
    layer.width,
    layer.height,
    `nestedLayer(${layer.layerId})`
  );
  if (!isValidNormalizedRect(layer.worldBounds)) {
    throw new Error(`Existing nested layer ${layer.layerId} has invalid worldBounds`);
  }
  if (!Array.isArray(layer.regions)) {
    throw new Error(`Existing nested layer ${layer.layerId} has invalid regions array`);
  }
  if (!(layer.regionMap instanceof Int32Array) || layer.regionMap.length !== layerTotal) {
    throw new Error(`Existing nested layer ${layer.layerId} has invalid regionMap length`);
  }
  if (!(layer.borderMap instanceof Uint8Array) || layer.borderMap.length !== layerTotal) {
    throw new Error(`Existing nested layer ${layer.layerId} has invalid borderMap length`);
  }
  sanitizeOptionalLayerMetadata(layer.promptHint, layer.providerUsed, layer.modelUsed);
}

function assertValidExistingNestedLayers(
  layers: readonly NestedPuzzleLayer[],
  maxAllowedDepth: number
): void {
  const seenLayerIds = new Set<string>();
  for (let i = 0; i < layers.length; i++) {
    assertValidSingleExistingNestedLayer(layers[i], i, maxAllowedDepth, seenLayerIds);
  }
}

function assertValidSubdivisionResult(subResult: MaskedSubdivisionResult, label: string): void {
  if (!subResult || typeof subResult !== 'object') {
    throw new Error(`${label} is required`);
  }
  const total = assertValidGridDimensions(subResult.width, subResult.height, label);
  if (!(subResult.localRegionMap instanceof Int32Array) || subResult.localRegionMap.length !== total) {
    throw new Error(`${label}.localRegionMap must match width * height`);
  }
  if (!Array.isArray(subResult.regions) || subResult.regions.length === 0) {
    throw new Error(`${label}.regions must be non-empty`);
  }
  if (!Array.isArray(subResult.palette)) {
    throw new Error(`${label}.palette must be an array`);
  }
}

function sanitizeOptionalLayerMetadata(
  promptHint?: string,
  providerUsed?: InfiniteZoomProviderMode,
  modelUsed?: InfiniteZoomModelId
): {
  promptHint?: string;
  providerUsed?: InfiniteZoomProviderMode;
  modelUsed?: InfiniteZoomModelId;
} {
  const meta: {
    promptHint?: string;
    providerUsed?: InfiniteZoomProviderMode;
    modelUsed?: InfiniteZoomModelId;
  } = {};
  if (promptHint !== undefined) {
    if (typeof promptHint !== 'string') {
      throw new Error('promptHint must be a string');
    }
    const trimmed = promptHint.trim().slice(0, MAX_LAYER_PROMPT_HINT_LEN).trim();
    if (trimmed.length > 0) {
      meta.promptHint = trimmed;
    }
  }
  if (providerUsed !== undefined) {
    if (!VALID_PROVIDER_MODES.has(providerUsed)) {
      throw new Error(`Invalid providerUsed: ${String(providerUsed)}`);
    }
    meta.providerUsed = providerUsed;
  }
  if (modelUsed !== undefined) {
    if (!VALID_MODEL_IDS.has(modelUsed)) {
      throw new Error(`Invalid modelUsed: ${String(modelUsed)}`);
    }
    meta.modelUsed = modelUsed;
  }
  return meta;
}

function resolveUniqueLayerId(
  requestedId: string | undefined,
  fallbackBase: string,
  existingLayerIds: ReadonlySet<string>
): string {
  if (requestedId !== undefined) {
    if (!isSafeLayerId(requestedId)) {
      throw new Error(`Invalid layerId: ${String(requestedId)}`);
    }
    if (existingLayerIds.has(requestedId)) {
      throw new Error(`Duplicate layerId: ${requestedId}`);
    }
    return requestedId;
  }
  let candidate = fallbackBase;
  let suffix = 2;
  while (existingLayerIds.has(candidate)) {
    candidate = `${fallbackBase}_${suffix++}`;
  }
  if (!isSafeLayerId(candidate)) {
    throw new Error(`Generated layerId is invalid: ${candidate}`);
  }
  return candidate;
}

function remapSubdivisionToGlobalIds(
  subResult: MaskedSubdivisionResult,
  seedMaxGlobalId: number
): {
  regions: Region[];
  regionMap: Int32Array;
  borderMap: Uint8Array;
  addedRegionIds: number[];
} {
  const total = subResult.width * subResult.height;
  const maxAllowedRegionId = Math.min(
    MAX_PUZZLE_PIXELS,
    Math.max(total, MAX_DELTA_REGION_ENTRIES)
  );
  let nextGlobalId = seedMaxGlobalId;
  const localToSlot = new Map<number, number>();
  const remappedRegions: Region[] = [];
  const addedRegionIds: number[] = [];

  for (let i = 0; i < subResult.regions.length; i++) {
    const subReg = subResult.regions[i];
    if (!subReg || !subReg.pixels || subReg.pixels.length === 0) continue;
    if (!Number.isInteger(subReg.id) || subReg.id <= 0) {
      throw new Error(`Invalid subdivision region ID: ${String(subReg.id)}`);
    }
    if (localToSlot.has(subReg.id)) {
      throw new Error(`Duplicate subdivision region ID: ${subReg.id}`);
    }
    const gId = ++nextGlobalId;
    if (!Number.isSafeInteger(gId) || gId <= 0 || gId > maxAllowedRegionId) {
      throw new Error(
        `Assigned region ID ${gId} exceeds maximum allowed ID (${maxAllowedRegionId}) for ${subResult.width}x${subResult.height} layer`
      );
    }
    localToSlot.set(subReg.id, remappedRegions.length);
    addedRegionIds.push(gId);
    remappedRegions.push({
      id: gId,
      colorId: subReg.colorId,
      centroidX: subReg.centroidX,
      centroidY: subReg.centroidY,
      area: subReg.pixels.length,
      minX: subReg.minX,
      maxX: subReg.maxX,
      minY: subReg.minY,
      maxY: subReg.maxY,
      maxRadius: subReg.maxRadius,
      pixels: new Int32Array(subReg.pixels),
    });
  }

  if (remappedRegions.length === 0) {
    throw new Error('Subdivision result contained zero non-empty regions');
  }

  const regionMap = new Int32Array(total);
  const mappedCounts = new Int32Array(remappedRegions.length);
  let totalMappedPixels = 0;
  for (let i = 0; i < total; i++) {
    const localId = subResult.localRegionMap[i];
    if (localId < 0) {
      throw new Error(`Invalid negative localRegionMap ID (${localId}) at pixel ${i}`);
    }
    if (localId > 0) {
      const slot = localToSlot.get(localId);
      if (slot === undefined) {
        throw new Error(`Unlisted localRegionMap ID (${localId}) at pixel ${i}`);
      }
      regionMap[i] = addedRegionIds[slot];
      mappedCounts[slot]++;
      totalMappedPixels++;
    }
  }

  if (totalMappedPixels === 0) {
    throw new Error('Subdivision localRegionMap contained zero active pixels');
  }
  for (let i = 0; i < remappedRegions.length; i++) {
    if (mappedCounts[i] === 0) {
      throw new Error(
        `Remapped region ${remappedRegions[i].id} has zero mapped pixels in localRegionMap`
      );
    }
  }

  const borderMap = buildBorderMapFromRegionMap(regionMap, subResult.width, subResult.height);
  return { regions: remappedRegions, regionMap, borderMap, addedRegionIds };
}

function deriveSelectedBoundsInTarget(
  matchedRegions: readonly Region[],
  targetWidth: number,
  targetHeight: number
): NormalizedRect {
  let minX = targetWidth;
  let maxX = -1;
  let minY = targetHeight;
  let maxY = -1;
  const total = targetWidth * targetHeight;

  for (let i = 0; i < matchedRegions.length; i++) {
    const reg = matchedRegions[i];
    const hasExplicit =
      Number.isFinite(reg.minX) &&
      Number.isFinite(reg.maxX) &&
      Number.isFinite(reg.minY) &&
      Number.isFinite(reg.maxY) &&
      reg.minX <= reg.maxX &&
      reg.minY <= reg.maxY;

    if (hasExplicit) {
      const rx0 = Math.max(0, Math.min(targetWidth - 1, Math.floor(reg.minX)));
      const rx1 = Math.max(0, Math.min(targetWidth - 1, Math.floor(reg.maxX)));
      const ry0 = Math.max(0, Math.min(targetHeight - 1, Math.floor(reg.minY)));
      const ry1 = Math.max(0, Math.min(targetHeight - 1, Math.floor(reg.maxY)));
      if (rx0 < minX) minX = rx0;
      if (rx1 > maxX) maxX = rx1;
      if (ry0 < minY) minY = ry0;
      if (ry1 > maxY) maxY = ry1;
      continue;
    }

    for (let p = 0; p < reg.pixels.length; p++) {
      const idx = reg.pixels[p];
      if (idx < 0 || idx >= total) continue;
      const x = idx % targetWidth;
      const y = (idx - x) / targetWidth;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) {
    throw new Error('Could not derive non-empty bounding box from selectedRegionIds');
  }

  return clampNormalizedRect({
    x: minX / targetWidth,
    y: minY / targetHeight,
    width: (maxX - minX + 1) / targetWidth,
    height: (maxY - minY + 1) / targetHeight,
  });
}

function clearRegionsFromLayerGrid(
  width: number,
  height: number,
  regions: readonly Region[],
  regionMap: Int32Array,
  borderMap: Uint8Array,
  selectedRegionIds: ReadonlySet<number>
): {
  keptRegions: Region[];
  nextRegionMap: Int32Array;
  nextBorderMap: Uint8Array;
} {
  const nextRegionMap = new Int32Array(regionMap);
  const nextBorderMap = new Uint8Array(borderMap);
  const total = width * height;
  let dirtyMinX = width;
  let dirtyMinY = height;
  let dirtyMaxX = -1;
  let dirtyMaxY = -1;

  const markCleared = (x: number, y: number) => {
    if (x < dirtyMinX) dirtyMinX = x;
    if (x > dirtyMaxX) dirtyMaxX = x;
    if (y < dirtyMinY) dirtyMinY = y;
    if (y > dirtyMaxY) dirtyMaxY = y;
  };

  const keptRegions: Region[] = [];
  for (let i = 0; i < regions.length; i++) {
    const reg = regions[i];
    if (!selectedRegionIds.has(reg.id)) {
      keptRegions.push(cloneRegion(reg));
      continue;
    }

    for (let p = 0; p < reg.pixels.length; p++) {
      const idx = reg.pixels[p];
      if (idx < 0 || idx >= total) continue;
      if (selectedRegionIds.has(nextRegionMap[idx])) {
        nextRegionMap[idx] = 0;
        const x = idx % width;
        const y = (idx - x) / width;
        markCleared(x, y);
      }
    }

    if (
      Number.isFinite(reg.minX) &&
      Number.isFinite(reg.maxX) &&
      Number.isFinite(reg.minY) &&
      Number.isFinite(reg.maxY)
    ) {
      const bx0 = Math.max(0, Math.min(width - 1, Math.floor(reg.minX)));
      const bx1 = Math.max(0, Math.min(width - 1, Math.floor(reg.maxX)));
      const by0 = Math.max(0, Math.min(height - 1, Math.floor(reg.minY)));
      const by1 = Math.max(0, Math.min(height - 1, Math.floor(reg.maxY)));
      for (let y = by0; y <= by1; y++) {
        const rowOff = y * width;
        for (let x = bx0; x <= bx1; x++) {
          if (selectedRegionIds.has(nextRegionMap[rowOff + x])) {
            nextRegionMap[rowOff + x] = 0;
            markCleared(x, y);
          }
        }
      }
    }
  }

  if (dirtyMaxX >= dirtyMinX && dirtyMaxY >= dirtyMinY) {
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
  }

  return { keptRegions, nextRegionMap, nextBorderMap };
}

function resolveEmbedTargetLayer(
  basePuzzle: PuzzleData,
  targetLayerId: string | null | undefined
): NestedPuzzleLayer | null {
  if (targetLayerId === null || targetLayerId === undefined) {
    return null;
  }
  const existing = basePuzzle.nestedLayers ?? [];
  const parent = existing.find((l) => l.layerId === targetLayerId);
  if (!parent) {
    throw new Error(`Target nested layer not found: ${String(targetLayerId)}`);
  }
  const total = assertValidGridDimensions(
    parent.width,
    parent.height,
    `targetLayer(${parent.layerId})`
  );
  if (!Number.isInteger(parent.depth) || parent.depth < 1 || parent.depth > MAX_ZOOM_DEPTH) {
    throw new Error(`Target nested layer ${parent.layerId} has invalid depth: ${String(parent.depth)}`);
  }
  if (!isValidNormalizedRect(parent.worldBounds)) {
    throw new Error(`Target nested layer ${parent.layerId} has invalid worldBounds`);
  }
  if (!Array.isArray(parent.regions)) {
    throw new Error(`Target nested layer ${parent.layerId} has invalid regions array`);
  }
  if (!(parent.regionMap instanceof Int32Array) || parent.regionMap.length !== total) {
    throw new Error(`Target nested layer ${parent.layerId} has invalid regionMap length`);
  }
  if (!(parent.borderMap instanceof Uint8Array) || parent.borderMap.length !== total) {
    throw new Error(`Target nested layer ${parent.layerId} has invalid borderMap length`);
  }
  return parent;
}

function resolveEmbedWorldBounds(
  params: EmbedNestedDetailLayerParams,
  parentLayer: NestedPuzzleLayer | null,
  matchedRegions: readonly Region[],
  targetWidth: number,
  targetHeight: number
): NormalizedRect {
  if (params.worldBounds !== undefined) {
    return clampNormalizedRect(params.worldBounds);
  }
  const localBounds =
    params.localBoundsInParent !== undefined
      ? clampNormalizedRect(params.localBoundsInParent)
      : deriveSelectedBoundsInTarget(matchedRegions, targetWidth, targetHeight);
  return parentLayer
    ? rebaseLayerWorldBounds(localBounds, parentLayer.worldBounds)
    : localBounds;
}

function computeValidatedEmbedMaxDepth(
  baseDepth: number | undefined,
  layers: readonly NestedPuzzleLayer[]
): number {
  let maxZoomDepth = baseDepth ?? 0;
  for (let i = 0; i < layers.length; i++) {
    if (layers[i].depth > maxZoomDepth) {
      maxZoomDepth = layers[i].depth;
    }
  }
  if (!Number.isInteger(maxZoomDepth) || maxZoomDepth < 1 || maxZoomDepth > MAX_ZOOM_DEPTH) {
    throw new Error(
      `Invalid maxZoomDepth ${maxZoomDepth} (expected integer in 1..${MAX_ZOOM_DEPTH})`
    );
  }
  return maxZoomDepth;
}

/**
 * Embeds a subdivided high-resolution detail layer into the unified puzzle (Zoom In),
 * clearing the replaced regions from the target layer (root or nested) and assigning
 * globally unique monotonic region IDs without mutating `basePuzzle`.
 */
export function embedNestedDetailLayerIntoPuzzle(
  params: EmbedNestedDetailLayerParams
): EmbedNestedDetailLayerResult {
  assertValidBasePuzzle(params.basePuzzle);
  const existingLayers = params.basePuzzle.nestedLayers ?? [];
  assertValidExistingNestedLayers(existingLayers, MAX_ZOOM_DEPTH);
  if (!params.selectedRegionIds || params.selectedRegionIds.size === 0) {
    throw new Error('selectedRegionIds must be non-empty');
  }
  assertValidSubdivisionResult(params.subResult, 'subResult');
  if (!isSafeLayerImageKey(params.imageBlobKey)) {
    throw new Error(`Invalid imageBlobKey: ${String(params.imageBlobKey)}`);
  }

  const meta = sanitizeOptionalLayerMetadata(
    params.promptHint,
    params.providerUsed,
    params.modelUsed
  );
  const parentLayer = resolveEmbedTargetLayer(params.basePuzzle, params.targetLayerId);
  const targetWidth = parentLayer ? parentLayer.width : params.basePuzzle.width;
  const targetHeight = parentLayer ? parentLayer.height : params.basePuzzle.height;
  const targetRegions = parentLayer ? parentLayer.regions : params.basePuzzle.regions;

  const targetRegionById = new Map<number, Region>();
  for (let i = 0; i < targetRegions.length; i++) {
    targetRegionById.set(targetRegions[i].id, targetRegions[i]);
  }
  const matchedRegions: Region[] = [];
  const removedRegionIds: number[] = [];
  for (const id of params.selectedRegionIds) {
    const reg = targetRegionById.get(id);
    if (!reg) {
      throw new Error(`Selected region ${id} does not exist in target layer`);
    }
    matchedRegions.push(reg);
    removedRegionIds.push(id);
  }

  const nextDepth = (parentLayer ? parentLayer.depth : 0) + 1;
  if (!Number.isInteger(nextDepth) || nextDepth < 1 || nextDepth > MAX_ZOOM_DEPTH) {
    throw new Error(`Zoom depth ${nextDepth} exceeds MAX_ZOOM_DEPTH (${MAX_ZOOM_DEPTH})`);
  }

  const finalWorldBounds = resolveEmbedWorldBounds(
    params,
    parentLayer,
    matchedRegions,
    targetWidth,
    targetHeight
  );

  const remapped = remapSubdivisionToGlobalIds(
    params.subResult,
    getMaxGlobalRegionId(params.basePuzzle)
  );
  const existingLayerIds = new Set<string>(existingLayers.map((l) => l.layerId));
  const layerId = resolveUniqueLayerId(
    params.layerId,
    `detail_d${nextDepth}_${remapped.addedRegionIds[0]}`,
    existingLayerIds
  );

  const newLayer: NestedPuzzleLayer = {
    layerId,
    depth: nextDepth,
    worldBounds: finalWorldBounds,
    width: params.subResult.width,
    height: params.subResult.height,
    regions: remapped.regions,
    regionMap: remapped.regionMap,
    borderMap: remapped.borderMap,
    imageBlobKey: params.imageBlobKey,
    ...meta,
  };

  const prunedLayerIds: string[] = [];
  let rootRegions: Region[];
  let rootRegionMap: Int32Array;
  let rootBorderMap: Uint8Array;
  const nextNestedLayers: NestedPuzzleLayer[] = [];

  if (parentLayer === null) {
    const cleared = clearRegionsFromLayerGrid(
      params.basePuzzle.width,
      params.basePuzzle.height,
      params.basePuzzle.regions,
      params.basePuzzle.regionMap,
      params.basePuzzle.borderMap,
      params.selectedRegionIds
    );
    rootRegions = cleared.keptRegions;
    rootRegionMap = cleared.nextRegionMap;
    rootBorderMap = cleared.nextBorderMap;
    for (let i = 0; i < existingLayers.length; i++) {
      nextNestedLayers.push(cloneNestedLayer(existingLayers[i]));
    }
  } else {
    rootRegions = params.basePuzzle.regions.map(cloneRegion);
    rootRegionMap = new Int32Array(params.basePuzzle.regionMap);
    rootBorderMap = new Uint8Array(params.basePuzzle.borderMap);
    for (let i = 0; i < existingLayers.length; i++) {
      const layer = existingLayers[i];
      if (layer.layerId !== parentLayer.layerId) {
        nextNestedLayers.push(cloneNestedLayer(layer));
        continue;
      }
      const cleared = clearRegionsFromLayerGrid(
        layer.width,
        layer.height,
        layer.regions,
        layer.regionMap,
        layer.borderMap,
        params.selectedRegionIds
      );
      if (cleared.keptRegions.length === 0) {
        prunedLayerIds.push(layer.layerId);
      } else {
        nextNestedLayers.push(
          buildNestedLayerWithGrid(
            layer,
            cleared.keptRegions,
            cleared.nextRegionMap,
            cleared.nextBorderMap
          )
        );
      }
    }
  }

  nextNestedLayers.push(newLayer);
  if (nextNestedLayers.length > MAX_NESTED_LAYERS) {
    throw new Error(`Nested layer count ${nextNestedLayers.length} exceeds MAX_NESTED_LAYERS (${MAX_NESTED_LAYERS})`);
  }

  const maxZoomDepth = computeValidatedEmbedMaxDepth(
    params.basePuzzle.maxZoomDepth,
    nextNestedLayers
  );

  const puzzle: PuzzleData = {
    width: params.basePuzzle.width,
    height: params.basePuzzle.height,
    palette: mergePreservingBasePalette(params.basePuzzle.palette, params.subResult.palette),
    regions: rootRegions,
    regionMap: rootRegionMap,
    borderMap: rootBorderMap,
    isFreeColor: params.basePuzzle.isFreeColor,
    nestedLayers: nextNestedLayers,
    maxZoomDepth,
  };

  return {
    puzzle,
    layer: newLayer,
    removedRegionIds,
    addedRegionIds: remapped.addedRegionIds,
    prunedLayerIds,
  };
}

/**
 * Wraps an active unified puzzle inside a newly extended outer border ring (Zoom Out),
 * demoting the previous root to depth 1 and affinely rebasing every existing nested layer
 * to `depth + 1` with zero changes to any existing region ID, color ID, or painted progress.
 */
export function wrapPuzzleWithOuterBorderLayer(
  params: WrapPuzzleWithOuterBorderParams
): WrapPuzzleWithOuterBorderResult {
  assertValidBasePuzzle(params.basePuzzle);
  assertValidSubdivisionResult(params.outerSubResult, 'outerSubResult');
  const clampedInnerBounds = clampNormalizedRect(params.innerBoundsInOuter);
  if (!isSafeLayerImageKey(params.previousRootImageBlobKey)) {
    throw new Error(`Invalid previousRootImageBlobKey: ${String(params.previousRootImageBlobKey)}`);
  }

  const meta = sanitizeOptionalLayerMetadata(
    params.promptHint,
    params.providerUsed,
    params.modelUsed
  );

  const existingLayers = params.basePuzzle.nestedLayers ?? [];
  assertValidExistingNestedLayers(existingLayers, MAX_ZOOM_DEPTH - 1);
  if (existingLayers.length + 1 > MAX_NESTED_LAYERS) {
    throw new Error(
      `Nested layer count ${existingLayers.length + 1} exceeds MAX_NESTED_LAYERS (${MAX_NESTED_LAYERS})`
    );
  }

  let existingMaxDepth = params.basePuzzle.maxZoomDepth ?? 0;
  for (let i = 0; i < existingLayers.length; i++) {
    if (existingLayers[i].depth > existingMaxDepth) {
      existingMaxDepth = existingLayers[i].depth;
    }
  }
  const nextMaxDepth = existingMaxDepth + 1;
  if (!Number.isInteger(nextMaxDepth) || nextMaxDepth < 1 || nextMaxDepth > MAX_ZOOM_DEPTH) {
    throw new Error(
      `Wrapped maxZoomDepth ${nextMaxDepth} is out of range (expected integer in 1..${MAX_ZOOM_DEPTH})`
    );
  }

  const existingLayerIds = new Set<string>(existingLayers.map((l) => l.layerId));
  const previousRootLayerId = resolveUniqueLayerId(
    params.previousRootLayerId,
    `inner_root_d1`,
    existingLayerIds
  );

  const remappedOuter = remapSubdivisionToGlobalIds(
    params.outerSubResult,
    getMaxGlobalRegionId(params.basePuzzle)
  );

  const demotedRootLayer: NestedPuzzleLayer = {
    layerId: previousRootLayerId,
    depth: 1,
    worldBounds: clampedInnerBounds,
    width: params.basePuzzle.width,
    height: params.basePuzzle.height,
    regions: params.basePuzzle.regions.map(cloneRegion),
    regionMap: new Int32Array(params.basePuzzle.regionMap),
    borderMap: new Uint8Array(params.basePuzzle.borderMap),
    imageBlobKey: params.previousRootImageBlobKey,
    ...meta,
  };

  const rebasedExistingLayers: NestedPuzzleLayer[] = existingLayers.map((layer) => {
    const nextDepth = layer.depth + 1;
    if (!Number.isInteger(nextDepth) || nextDepth < 2 || nextDepth > MAX_ZOOM_DEPTH) {
      throw new Error(
        `Rebased layer ${layer.layerId} depth ${nextDepth} is out of range (expected integer in 2..${MAX_ZOOM_DEPTH})`
      );
    }
    const cloned = cloneNestedLayer(layer);
    cloned.depth = nextDepth;
    cloned.worldBounds = rebaseLayerWorldBounds(layer.worldBounds, clampedInnerBounds);
    return cloned;
  });

  const puzzle: PuzzleData = {
    width: params.outerSubResult.width,
    height: params.outerSubResult.height,
    palette: mergePreservingBasePalette(params.basePuzzle.palette, params.outerSubResult.palette),
    regions: remappedOuter.regions,
    regionMap: remappedOuter.regionMap,
    borderMap: remappedOuter.borderMap,
    isFreeColor: params.basePuzzle.isFreeColor,
    nestedLayers: [demotedRootLayer, ...rebasedExistingLayers],
    maxZoomDepth: nextMaxDepth,
  };

  return {
    puzzle,
    demotedRootLayer,
    addedOuterRegionIds: remappedOuter.addedRegionIds,
  };
}

