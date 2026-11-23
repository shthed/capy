import type { NestedPuzzleLayer, NormalizedRect, PuzzleData, Region } from '../types';

export const MAX_NESTED_LAYERS = 64;
export const MAX_ZOOM_DEPTH = 32;
export const MAX_PUZZLE_PIXELS = 16_777_216;
export const MAX_DELTA_REGION_ENTRIES = 65_536;
export const WORLD_BOUNDS_EPSILON = 1e-6;
export const SAFE_LAYER_KEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,255}$/;
export const LAYER_IMAGE_KEY_PREFIX = 'layer_';

const FORBIDDEN_LAYER_KEYS = new Set<string>(['__proto__', 'constructor', 'prototype']);

export interface UnifiedRegionRef {
  region: Region;
  layer: NestedPuzzleLayer | null;
  layerId: string | null;
  depth: number;
  worldCentroidX: number;
  worldCentroidY: number;
  worldMinX: number;
  worldMaxX: number;
  worldMinY: number;
  worldMaxY: number;
  worldMaxRadius: number;
}

export interface UnifiedRegionIndex {
  allRegions: Region[];
  byId: Map<number, Region>;
  worldById: Map<number, UnifiedRegionRef>;
  totalCount: number;
  maxRegionId: number;
}

export interface LayerCoordPoint {
  x: number;
  y: number;
  inBounds: boolean;
}

export function isValidNormalizedRect(
  rect: NormalizedRect | null | undefined
): rect is NormalizedRect {
  if (!rect || typeof rect !== 'object' || Array.isArray(rect)) return false;
  const { x, y, width, height } = rect;
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  ) {
    return false;
  }
  return (
    x >= 0 &&
    x < 1 &&
    y >= 0 &&
    y < 1 &&
    width > 0 &&
    height > 0 &&
    x + width <= 1 + WORLD_BOUNDS_EPSILON &&
    y + height <= 1 + WORLD_BOUNDS_EPSILON
  );
}

export function clampNormalizedRect(rect: NormalizedRect): NormalizedRect {
  if (!isValidNormalizedRect(rect)) {
    throw new Error('Invalid normalized worldBounds rectangle');
  }
  const x = Math.min(1 - Number.EPSILON, Math.max(0, rect.x));
  const y = Math.min(1 - Number.EPSILON, Math.max(0, rect.y));
  const width = Math.min(1 - x, rect.width);
  const height = Math.min(1 - y, rect.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Normalized worldBounds collapsed to zero area after clamping');
  }
  return { x, y, width, height };
}

export function isSafeLayerId(layerId: string): boolean {
  return (
    typeof layerId === 'string' &&
    SAFE_LAYER_KEY_RE.test(layerId) &&
    !layerId.includes('..') &&
    !FORBIDDEN_LAYER_KEYS.has(layerId)
  );
}

export function isSafeLayerImageKey(key: string): boolean {
  return (
    isSafeLayerId(key) &&
    key.startsWith(LAYER_IMAGE_KEY_PREFIX) &&
    key.length > LAYER_IMAGE_KEY_PREFIX.length
  );
}

export function getSortedNestedLayersAsc(
  puzzle: PuzzleData | null | undefined
): NestedPuzzleLayer[] {
  const layers = puzzle?.nestedLayers;
  if (!Array.isArray(layers) || layers.length === 0) return [];
  const entries: Array<{ layer: NestedPuzzleLayer; index: number; depth: number }> = [];
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    if (!layer || typeof layer !== 'object') continue;
    entries.push({
      layer,
      index: i,
      depth: Number.isFinite(layer.depth) ? layer.depth : Number.POSITIVE_INFINITY,
    });
  }
  entries.sort((a, b) => {
    if (a.depth !== b.depth) return a.depth < b.depth ? -1 : 1;
    return a.index - b.index;
  });
  return entries.map((entry) => entry.layer);
}

export function getSortedNestedLayersDesc(
  puzzle: PuzzleData | null | undefined
): NestedPuzzleLayer[] {
  const layers = puzzle?.nestedLayers;
  if (!Array.isArray(layers) || layers.length === 0) return [];
  const entries: Array<{ layer: NestedPuzzleLayer; index: number; depth: number }> = [];
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    if (!layer || typeof layer !== 'object') continue;
    entries.push({
      layer,
      index: i,
      depth: Number.isFinite(layer.depth) ? layer.depth : Number.NEGATIVE_INFINITY,
    });
  }
  entries.sort((a, b) => {
    if (a.depth !== b.depth) return a.depth > b.depth ? -1 : 1;
    return b.index - a.index;
  });
  return entries.map((entry) => entry.layer);
}

export function getAllPuzzleRegions(puzzle: PuzzleData | null | undefined): Region[] {
  if (!puzzle || !Array.isArray(puzzle.regions)) return [];
  const layers = puzzle.nestedLayers;
  if (!Array.isArray(layers) || layers.length === 0) {
    return puzzle.regions;
  }
  const combined = puzzle.regions.slice();
  for (let i = 0; i < layers.length; i++) {
    const layerRegions = layers[i]?.regions;
    if (!Array.isArray(layerRegions)) continue;
    for (let j = 0; j < layerRegions.length; j++) {
      combined.push(layerRegions[j]);
    }
  }
  return combined;
}

export function getTotalRegionCount(puzzle: PuzzleData | null | undefined): number {
  if (!puzzle) return 0;
  let total = Array.isArray(puzzle.regions) ? puzzle.regions.length : 0;
  const layers = puzzle.nestedLayers;
  if (Array.isArray(layers)) {
    for (let i = 0; i < layers.length; i++) {
      const layerRegions = layers[i]?.regions;
      if (Array.isArray(layerRegions)) {
        total += layerRegions.length;
      }
    }
  }
  return total;
}

function scanMaxRegionId(regions: readonly Region[] | null | undefined, currentMax: number): number {
  if (!Array.isArray(regions)) return currentMax;
  let maxId = currentMax;
  for (let i = 0; i < regions.length; i++) {
    const id = regions[i]?.id;
    if (typeof id === 'number' && Number.isInteger(id) && id > maxId) {
      maxId = id;
    }
  }
  return maxId;
}

export function getMaxGlobalRegionId(puzzle: PuzzleData | null | undefined): number {
  if (!puzzle) return 0;
  let maxId = scanMaxRegionId(puzzle.regions, 0);
  const layers = puzzle.nestedLayers;
  if (Array.isArray(layers)) {
    for (let i = 0; i < layers.length; i++) {
      maxId = scanMaxRegionId(layers[i]?.regions, maxId);
    }
  }
  return maxId;
}

function hasValidLayerGeometry(
  puzzle: PuzzleData | null | undefined,
  layer: NestedPuzzleLayer | null | undefined
): boolean {
  return Boolean(
    puzzle &&
      layer &&
      Number.isFinite(puzzle.width) &&
      Number.isFinite(puzzle.height) &&
      puzzle.width > 0 &&
      puzzle.height > 0 &&
      Number.isFinite(layer.width) &&
      Number.isFinite(layer.height) &&
      layer.width > 0 &&
      layer.height > 0 &&
      isValidNormalizedRect(layer.worldBounds)
  );
}

export function mapLayerCoordToWorld(
  puzzle: PuzzleData,
  layer: NestedPuzzleLayer,
  lx: number,
  ly: number
): { x: number; y: number } {
  if (!Number.isFinite(lx) || !Number.isFinite(ly) || !hasValidLayerGeometry(puzzle, layer)) {
    return { x: 0, y: 0 };
  }
  const b = layer.worldBounds;
  const x = (b.x + (lx / layer.width) * b.width) * puzzle.width;
  const y = (b.y + (ly / layer.height) * b.height) * puzzle.height;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { x: 0, y: 0 };
  }
  return { x, y };
}

export function mapWorldCoordToLayer(
  puzzle: PuzzleData,
  layer: NestedPuzzleLayer,
  wx: number,
  wy: number
): LayerCoordPoint | null {
  if (!Number.isFinite(wx) || !Number.isFinite(wy) || !hasValidLayerGeometry(puzzle, layer)) {
    return null;
  }
  const b = layer.worldBounds;
  const u = wx / puzzle.width;
  const v = wy / puzzle.height;
  const x = ((u - b.x) / b.width) * layer.width;
  const y = ((v - b.y) / b.height) * layer.height;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  const inBounds = u >= b.x && u < b.x + b.width && v >= b.y && v < b.y + b.height;
  return { x, y, inBounds };
}

export function rebaseLayerWorldBounds(
  innerBounds: NormalizedRect,
  outerInnerBounds: NormalizedRect
): NormalizedRect {
  if (!isValidNormalizedRect(innerBounds)) {
    throw new Error('Invalid innerBounds for affine worldBounds rebase');
  }
  if (!isValidNormalizedRect(outerInnerBounds)) {
    throw new Error('Invalid outerInnerBounds for affine worldBounds rebase');
  }
  const rawX = outerInnerBounds.x + innerBounds.x * outerInnerBounds.width;
  const rawY = outerInnerBounds.y + innerBounds.y * outerInnerBounds.height;
  const rawW = innerBounds.width * outerInnerBounds.width;
  const rawH = innerBounds.height * outerInnerBounds.height;

  const x = Math.min(1 - Number.EPSILON, Math.max(0, rawX));
  const y = Math.min(1 - Number.EPSILON, Math.max(0, rawY));
  const width = Math.min(1 - x, rawW);
  const height = Math.min(1 - y, rawH);

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Rebased worldBounds collapsed to non-positive dimensions');
  }
  return { x, y, width, height };
}

function buildRootRegionRef(region: Region): UnifiedRegionRef {
  return {
    region,
    layer: null,
    layerId: null,
    depth: 0,
    worldCentroidX: region.centroidX,
    worldCentroidY: region.centroidY,
    worldMinX: region.minX,
    worldMaxX: region.maxX,
    worldMinY: region.minY,
    worldMaxY: region.maxY,
    worldMaxRadius: region.maxRadius,
  };
}

function buildNestedRegionRef(
  region: Region,
  layer: NestedPuzzleLayer,
  originX: number,
  originY: number,
  scaleX: number,
  scaleY: number,
  radiusScale: number
): UnifiedRegionRef {
  return {
    region,
    layer,
    layerId: layer.layerId,
    depth: layer.depth,
    worldCentroidX: originX + region.centroidX * scaleX,
    worldCentroidY: originY + region.centroidY * scaleY,
    worldMinX: originX + region.minX * scaleX,
    worldMaxX: originX + (region.maxX + 1) * scaleX,
    worldMinY: originY + region.minY * scaleY,
    worldMaxY: originY + (region.maxY + 1) * scaleY,
    worldMaxRadius: region.maxRadius * radiusScale,
  };
}

export function buildUnifiedRegionIndex(puzzle: PuzzleData): UnifiedRegionIndex {
  const rawRegions: Region[] = [];
  const byId = new Map<number, Region>();
  const worldById = new Map<number, UnifiedRegionRef>();
  let maxRegionId = 0;
  let hadCollision = false;

  const register = (region: Region, ref: UnifiedRegionRef) => {
    if (!region || !Number.isInteger(region.id) || region.id <= 0) return;
    if (byId.has(region.id)) {
      hadCollision = true;
    } else if (!hadCollision) {
      rawRegions.push(region);
    }
    byId.set(region.id, region);
    worldById.set(region.id, ref);
    if (region.id > maxRegionId) {
      maxRegionId = region.id;
    }
  };

  if (Array.isArray(puzzle.regions)) {
    for (let i = 0; i < puzzle.regions.length; i++) {
      const region = puzzle.regions[i];
      if (!region) continue;
      register(region, buildRootRegionRef(region));
    }
  }

  const sortedLayers = getSortedNestedLayersAsc(puzzle);
  for (let i = 0; i < sortedLayers.length; i++) {
    const layer = sortedLayers[i];
    if (!hasValidLayerGeometry(puzzle, layer) || !Array.isArray(layer.regions)) {
      continue;
    }
    const b = layer.worldBounds;
    const originX = b.x * puzzle.width;
    const originY = b.y * puzzle.height;
    const scaleX = (b.width * puzzle.width) / layer.width;
    const scaleY = (b.height * puzzle.height) / layer.height;
    const radiusScale = Math.min(scaleX, scaleY);

    for (let j = 0; j < layer.regions.length; j++) {
      const region = layer.regions[j];
      if (!region) continue;
      register(
        region,
        buildNestedRegionRef(region, layer, originX, originY, scaleX, scaleY, radiusScale)
      );
    }
  }

  const allRegions = hadCollision ? Array.from(byId.values()) : rawRegions;
  return {
    allRegions,
    byId,
    worldById,
    totalCount: byId.size,
    maxRegionId,
  };
}

function hasAnyPositiveRegionPixel(regionMap: Int32Array, totalPixels: number): boolean {
  for (let i = 0; i < totalPixels; i++) {
    if (regionMap[i] > 0) return true;
  }
  return false;
}

function collectValidCutoutLayers(puzzle: PuzzleData): NestedPuzzleLayer[] {
  const layers = puzzle.nestedLayers;
  if (!Array.isArray(layers) || layers.length === 0) return [];
  const valid: NestedPuzzleLayer[] = [];
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    if (
      layer &&
      Number.isInteger(layer.width) &&
      Number.isInteger(layer.height) &&
      layer.width > 0 &&
      layer.height > 0 &&
      layer.regionMap &&
      layer.regionMap.length >= layer.width * layer.height &&
      isValidNormalizedRect(layer.worldBounds)
    ) {
      valid.push(layer);
    }
  }
  return valid;
}

function isPixelCoveredByNestedLayers(
  x: number,
  y: number,
  width: number,
  height: number,
  validLayers: readonly NestedPuzzleLayer[]
): boolean {
  const u = (x + 0.5) / width;
  const v = (y + 0.5) / height;
  for (let i = 0; i < validLayers.length; i++) {
    const layer = validLayers[i];
    const b = layer.worldBounds;
    if (
      u < b.x - WORLD_BOUNDS_EPSILON ||
      u > b.x + b.width + WORLD_BOUNDS_EPSILON ||
      v < b.y - WORLD_BOUNDS_EPSILON ||
      v > b.y + b.height + WORLD_BOUNDS_EPSILON
    ) {
      continue;
    }
    const lx = Math.max(
      0,
      Math.min(layer.width - 1, Math.floor(((u - b.x) / b.width) * layer.width))
    );
    const ly = Math.max(
      0,
      Math.min(layer.height - 1, Math.floor(((v - b.y) / b.height) * layer.height))
    );
    if (layer.regionMap[ly * layer.width + lx] > 0) {
      return true;
    }
  }
  return false;
}

function hasUncoveredOuterPerimeterPixel(
  regionMap: Int32Array,
  width: number,
  height: number,
  validLayers: readonly NestedPuzzleLayer[]
): boolean {
  const isCovered = (x: number, y: number): boolean =>
    regionMap[y * width + x] > 0 || isPixelCoveredByNestedLayers(x, y, width, height, validLayers);

  for (let x = 0; x < width; x++) {
    if (!isCovered(x, 0)) return true;
    if (height > 1 && !isCovered(x, height - 1)) return true;
  }
  for (let y = 1; y < height - 1; y++) {
    if (!isCovered(0, y)) return true;
    if (width > 1 && !isCovered(width - 1, y)) return true;
  }
  return false;
}

export function isPuzzleOrganicCutout(puzzle: PuzzleData | null | undefined): boolean {
  if (
    !puzzle ||
    !Number.isInteger(puzzle.width) ||
    !Number.isInteger(puzzle.height) ||
    puzzle.width <= 0 ||
    puzzle.height <= 0
  ) {
    return false;
  }
  const total = puzzle.width * puzzle.height;
  if (!puzzle.regionMap || puzzle.regionMap.length < total) {
    return false;
  }

  const layers = puzzle.nestedLayers;
  if (!Array.isArray(layers) || layers.length === 0) {
    let hasInterior = false;
    let hasExterior = false;
    for (let i = 0; i < total; i++) {
      if (puzzle.regionMap[i] > 0) {
        hasInterior = true;
      } else {
        hasExterior = true;
      }
      if (hasInterior && hasExterior) return true;
    }
    return false;
  }

  const validLayers = collectValidCutoutLayers(puzzle);
  let hasAnyInterior = hasAnyPositiveRegionPixel(puzzle.regionMap, total);
  if (!hasAnyInterior) {
    for (let i = 0; i < validLayers.length; i++) {
      const layer = validLayers[i];
      if (hasAnyPositiveRegionPixel(layer.regionMap, layer.width * layer.height)) {
        hasAnyInterior = true;
        break;
      }
    }
  }
  if (!hasAnyInterior) return false;

  return hasUncoveredOuterPerimeterPixel(puzzle.regionMap, puzzle.width, puzzle.height, validLayers);
}

export function buildOutpaintBorderMask(
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
  innerWidth: number,
  innerHeight: number
): Uint8Array {
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return new Uint8Array(0);
  }
  const w = Math.floor(width);
  const h = Math.floor(height);
  if (w <= 0 || h <= 0) {
    return new Uint8Array(0);
  }
  if (w * h > MAX_PUZZLE_PIXELS) {
    throw new Error(`Outpaint border mask dimensions ${w}x${h} exceed MAX_PUZZLE_PIXELS`);
  }

  const mask = new Uint8Array(w * h);
  mask.fill(1);

  if (
    !Number.isFinite(offsetX) ||
    !Number.isFinite(offsetY) ||
    !Number.isFinite(innerWidth) ||
    !Number.isFinite(innerHeight)
  ) {
    return mask;
  }

  const safeOffsetX = Math.floor(offsetX);
  const safeOffsetY = Math.floor(offsetY);
  const safeInnerW = Math.max(0, Math.floor(innerWidth));
  const safeInnerH = Math.max(0, Math.floor(innerHeight));

  const ix0 = Math.max(0, Math.min(w, safeOffsetX));
  const iy0 = Math.max(0, Math.min(h, safeOffsetY));
  const ix1 = Math.max(ix0, Math.min(w, safeOffsetX + safeInnerW));
  const iy1 = Math.max(iy0, Math.min(h, safeOffsetY + safeInnerH));

  if (ix1 > ix0 && iy1 > iy0) {
    for (let y = iy0; y < iy1; y++) {
      const rowOff = y * w;
      mask.fill(0, rowOff + ix0, rowOff + ix1);
    }
  }

  return mask;
}
