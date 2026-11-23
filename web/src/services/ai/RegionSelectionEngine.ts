import type { PaletteColor, Region } from '../../types';
import type { SubdivisionBbox } from '../../engine/MaskedRegionSubdivider';

export interface RegionGridLike {
  readonly width: number;
  readonly height: number;
  readonly regions: readonly Region[];
  readonly regionMap: Int32Array;
  readonly palette?: readonly PaletteColor[];
}

export const IN_PLACE_MIN_AREA_PX = 8000;
export const IN_PLACE_MIN_BBOX_DIM_PX = 96;
export const IN_PLACE_MAX_TOTAL_REGIONS = 2600;
export const MAX_NEIGHBOR_BOUNDARY_HEXES = 8;

export type SelectionSubdivisionMode = 'in-place' | 'child-tile';

export type ToggleRegionStatus =
  | 'added'
  | 'removed'
  | 'non-adjacent'
  | 'bridge-blocked'
  | 'invalid';

export interface ToggleRegionResult {
  nextSelected: Set<number>;
  status: ToggleRegionStatus;
  changed: boolean;
}

export interface SelectionBbox extends SubdivisionBbox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
}

export interface SelectionMetrics {
  regionCount: number;
  area: number;
  bbox: SelectionBbox;
  paintedCount: number;
  neighborRegionIds: number[];
  neighborBoundaryHexes: string[];
  mode: SelectionSubdivisionMode;
}

const HEX_6_RE = /^#[0-9A-Fa-f]{6}$/;

export function buildRegionByIdMap(puzzle: RegionGridLike): Map<number, Region> {
  const map = new Map<number, Region>();
  if (!puzzle || !Array.isArray(puzzle.regions)) {
    return map;
  }
  for (const reg of puzzle.regions) {
    if (reg && Number.isInteger(reg.id) && reg.id > 0) {
      map.set(reg.id, reg);
    }
  }
  return map;
}

function isValidRegionId(
  id: number,
  regionById: ReadonlyMap<number, Region>
): boolean {
  return Number.isInteger(id) && id > 0 && regionById.has(id);
}

function hasValidRegionMap(puzzle: RegionGridLike): boolean {
  const width = puzzle?.width ?? 0;
  const height = puzzle?.height ?? 0;
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width > 0 &&
    height > 0 &&
    puzzle.regionMap instanceof Int32Array &&
    puzzle.regionMap.length >= width * height
  );
}

function recordNeighborTouch(
  neighborId: number,
  selfId: number,
  regionById: ReadonlyMap<number, Region>,
  counts: Map<number, number>
): void {
  if (neighborId > 0 && neighborId !== selfId && regionById.has(neighborId)) {
    counts.set(neighborId, (counts.get(neighborId) ?? 0) + 1);
  }
}

function inspectFourNeighbors(
  regionMap: Int32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  selfId: number,
  regionById: ReadonlyMap<number, Region>,
  counts: Map<number, number>
): void {
  const idx = y * width + x;
  if (x > 0) {
    recordNeighborTouch(regionMap[idx - 1], selfId, regionById, counts);
  }
  if (x + 1 < width) {
    recordNeighborTouch(regionMap[idx + 1], selfId, regionById, counts);
  }
  if (y > 0) {
    recordNeighborTouch(regionMap[idx - width], selfId, regionById, counts);
  }
  if (y + 1 < height) {
    recordNeighborTouch(regionMap[idx + width], selfId, regionById, counts);
  }
}

function resolveRegionScanBounds(
  reg: Region,
  width: number,
  height: number
): { minX: number; maxX: number; minY: number; maxY: number } {
  const validBounds =
    Number.isFinite(reg.minX) &&
    Number.isFinite(reg.maxX) &&
    Number.isFinite(reg.minY) &&
    Number.isFinite(reg.maxY) &&
    reg.minX <= reg.maxX &&
    reg.minY <= reg.maxY;
  if (!validBounds) {
    return { minX: 0, maxX: width - 1, minY: 0, maxY: height - 1 };
  }
  return {
    minX: Math.max(0, Math.min(width - 1, Math.floor(reg.minX))),
    maxX: Math.max(0, Math.min(width - 1, Math.floor(reg.maxX))),
    minY: Math.max(0, Math.min(height - 1, Math.floor(reg.minY))),
    maxY: Math.max(0, Math.min(height - 1, Math.floor(reg.maxY))),
  };
}

function collectNeighborTouchCounts(
  puzzle: RegionGridLike,
  regionId: number,
  regionById: ReadonlyMap<number, Region>,
  counts: Map<number, number>
): void {
  if (!isValidRegionId(regionId, regionById) || !hasValidRegionMap(puzzle)) {
    return;
  }
  const reg = regionById.get(regionId)!;
  const { width, height, regionMap } = puzzle;
  const total = width * height;

  if (reg.pixels && reg.pixels.length > 0) {
    for (let i = 0; i < reg.pixels.length; i++) {
      const idx = reg.pixels[i];
      if (idx < 0 || idx >= total) continue;
      const x = idx % width;
      const y = (idx - x) / width;
      inspectFourNeighbors(
        regionMap,
        width,
        height,
        x,
        y,
        regionId,
        regionById,
        counts
      );
    }
    return;
  }

  const bounds = resolveRegionScanBounds(reg, width, height);
  for (let y = bounds.minY; y <= bounds.maxY; y++) {
    const rowOffset = y * width;
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      if (regionMap[rowOffset + x] === regionId) {
        inspectFourNeighbors(
          regionMap,
          width,
          height,
          x,
          y,
          regionId,
          regionById,
          counts
        );
      }
    }
  }
}

export function getNeighborRegionIds(
  puzzle: RegionGridLike,
  regionId: number,
  regionById?: ReadonlyMap<number, Region>
): Set<number> {
  const map = regionById ?? buildRegionByIdMap(puzzle);
  const counts = new Map<number, number>();
  collectNeighborTouchCounts(puzzle, regionId, map, counts);
  return new Set(counts.keys());
}

export function isSelectionContiguous(
  puzzle: RegionGridLike,
  selectedIds: ReadonlySet<number>,
  regionById?: ReadonlyMap<number, Region>
): boolean {
  if (selectedIds.size === 0) return true;
  const map = regionById ?? buildRegionByIdMap(puzzle);
  for (const id of selectedIds) {
    if (!isValidRegionId(id, map)) {
      return false;
    }
  }
  if (selectedIds.size === 1) return true;

  const firstId = selectedIds.values().next().value;
  if (firstId === undefined) return true;

  const visited = new Set<number>([firstId]);
  const queue: number[] = [firstId];
  let head = 0;

  while (head < queue.length) {
    const curr = queue[head++];
    const neighbors = getNeighborRegionIds(puzzle, curr, map);
    for (const nid of neighbors) {
      if (selectedIds.has(nid) && !visited.has(nid)) {
        visited.add(nid);
        queue.push(nid);
      }
    }
  }
  return visited.size === selectedIds.size;
}

export function toggleContiguousRegion(
  puzzle: RegionGridLike,
  currentSelected: ReadonlySet<number>,
  tappedId: number,
  regionById?: ReadonlyMap<number, Region>
): ToggleRegionResult {
  const map = regionById ?? buildRegionByIdMap(puzzle);
  if (!isValidRegionId(tappedId, map)) {
    return {
      nextSelected: new Set(currentSelected),
      status: 'invalid',
      changed: false,
    };
  }

  if (currentSelected.has(tappedId)) {
    const candidate = new Set(currentSelected);
    candidate.delete(tappedId);
    if (!isSelectionContiguous(puzzle, candidate, map)) {
      return {
        nextSelected: new Set(currentSelected),
        status: 'bridge-blocked',
        changed: false,
      };
    }
    return {
      nextSelected: candidate,
      status: 'removed',
      changed: true,
    };
  }

  if (currentSelected.size === 0) {
    return {
      nextSelected: new Set([tappedId]),
      status: 'added',
      changed: true,
    };
  }

  const neighbors = getNeighborRegionIds(puzzle, tappedId, map);
  for (const nid of neighbors) {
    if (currentSelected.has(nid)) {
      const next = new Set(currentSelected);
      next.add(tappedId);
      return {
        nextSelected: next,
        status: 'added',
        changed: true,
      };
    }
  }

  return {
    nextSelected: new Set(currentSelected),
    status: 'non-adjacent',
    changed: false,
  };
}

export function addContiguousDragRegions(
  puzzle: RegionGridLike,
  currentSelected: ReadonlySet<number>,
  candidateIds: Iterable<number>,
  regionById?: ReadonlyMap<number, Region>
): Set<number> {
  const map = regionById ?? buildRegionByIdMap(puzzle);
  const next = new Set<number>();
  for (const id of currentSelected) {
    if (isValidRegionId(id, map)) {
      next.add(id);
    }
  }
  const pending: number[] = [];
  const seenPending = new Set<number>();

  for (const id of candidateIds) {
    if (next.has(id) || seenPending.has(id) || !isValidRegionId(id, map)) {
      continue;
    }
    seenPending.add(id);
    pending.push(id);
  }

  if (next.size === 0 && pending.length > 0) {
    next.add(pending.shift()!);
  }

  const neighborCache = new Map<number, Set<number>>();
  let remaining = pending;
  let progress = true;

  while (progress && remaining.length > 0) {
    progress = false;
    const stillWaiting: number[] = [];
    for (const cand of remaining) {
      let neighbors = neighborCache.get(cand);
      if (!neighbors) {
        neighbors = getNeighborRegionIds(puzzle, cand, map);
        neighborCache.set(cand, neighbors);
      }
      let touches = false;
      for (const nid of neighbors) {
        if (next.has(nid)) {
          touches = true;
          break;
        }
      }
      if (touches) {
        next.add(cand);
        progress = true;
      } else {
        stillWaiting.push(cand);
      }
    }
    remaining = stillWaiting;
  }

  return next;
}

function getRegionBoundsAndArea(
  reg: Region,
  width: number,
  height: number
): { minX: number; maxX: number; minY: number; maxY: number; area: number } | null {
  const area =
    Number.isFinite(reg.area) && reg.area > 0
      ? Math.floor(reg.area)
      : reg.pixels?.length ?? 0;
  const hasExplicitBounds =
    Number.isFinite(reg.minX) &&
    Number.isFinite(reg.maxX) &&
    Number.isFinite(reg.minY) &&
    Number.isFinite(reg.maxY) &&
    reg.minX <= reg.maxX &&
    reg.minY <= reg.maxY;

  if (hasExplicitBounds) {
    return {
      minX: Math.max(0, Math.min(width - 1, Math.floor(reg.minX))),
      maxX: Math.max(0, Math.min(width - 1, Math.floor(reg.maxX))),
      minY: Math.max(0, Math.min(height - 1, Math.floor(reg.minY))),
      maxY: Math.max(0, Math.min(height - 1, Math.floor(reg.maxY))),
      area,
    };
  }

  if (!reg.pixels || reg.pixels.length === 0 || width <= 0 || height <= 0) {
    return null;
  }

  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;
  const total = width * height;
  for (let i = 0; i < reg.pixels.length; i++) {
    const idx = reg.pixels[i];
    if (idx < 0 || idx >= total) continue;
    const x = idx % width;
    const y = (idx - x) / width;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (maxX < minX || maxY < minY) return null;
  return { minX, maxX, minY, maxY, area };
}

function emptySelectionBbox(): SelectionBbox {
  return { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 };
}

function resolveBoundaryHexes(
  puzzle: RegionGridLike,
  regionById: ReadonlyMap<number, Region>,
  externalCounts: ReadonlyMap<number, number>,
  paintedRegionColors?: ReadonlyMap<number, number>
): string[] {
  const paletteById = new Map<number, PaletteColor>();
  for (const swatch of puzzle.palette ?? []) {
    if (swatch && Number.isInteger(swatch.id)) {
      paletteById.set(swatch.id, swatch);
    }
  }

  const ranked = Array.from(externalCounts.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0] - b[0];
  });

  const hexes: string[] = [];
  const seen = new Set<string>();
  for (const [nid] of ranked) {
    const reg = regionById.get(nid);
    if (!reg) continue;
    const colorId = paintedRegionColors?.get(nid) ?? reg.colorId;
    const swatch = paletteById.get(colorId) ?? paletteById.get(reg.colorId);
    const rawHex = swatch?.hex?.trim();
    if (!rawHex || !HEX_6_RE.test(rawHex)) continue;
    const normalized = rawHex.toUpperCase();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      hexes.push(normalized);
      if (hexes.length >= MAX_NEIGHBOR_BOUNDARY_HEXES) break;
    }
  }
  return hexes;
}

function isValidGridDimensions(width: number, height: number): boolean {
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
}

export function computeSelectionMetrics(
  puzzle: RegionGridLike,
  selectedIds: ReadonlySet<number>,
  filledRegionIds?: ReadonlySet<number>,
  paintedRegionColors?: ReadonlyMap<number, number>
): SelectionMetrics {
  const map = buildRegionByIdMap(puzzle);
  const validSelected = new Set<number>();
  for (const id of selectedIds) {
    if (isValidRegionId(id, map)) {
      validSelected.add(id);
    }
  }

  if (validSelected.size === 0 || !isValidGridDimensions(puzzle.width, puzzle.height)) {
    return {
      regionCount: 0,
      area: 0,
      bbox: emptySelectionBbox(),
      paintedCount: 0,
      neighborRegionIds: [],
      neighborBoundaryHexes: [],
      mode: 'child-tile',
    };
  }

  let minX = puzzle.width;
  let maxX = -1;
  let minY = puzzle.height;
  let maxY = -1;
  let area = 0;
  let paintedCount = 0;
  const externalTouchCounts = new Map<number, number>();

  for (const id of validSelected) {
    const reg = map.get(id)!;
    const geom = getRegionBoundsAndArea(reg, puzzle.width, puzzle.height);
    if (geom) {
      area += geom.area;
      if (geom.minX < minX) minX = geom.minX;
      if (geom.maxX > maxX) maxX = geom.maxX;
      if (geom.minY < minY) minY = geom.minY;
      if (geom.maxY > maxY) maxY = geom.maxY;
    }
    if (filledRegionIds?.has(id)) {
      paintedCount += 1;
    }

    const perRegionCounts = new Map<number, number>();
    collectNeighborTouchCounts(puzzle, id, map, perRegionCounts);
    for (const [nid, count] of perRegionCounts) {
      if (!validSelected.has(nid)) {
        externalTouchCounts.set(nid, (externalTouchCounts.get(nid) ?? 0) + count);
      }
    }
  }

  const bbox: SelectionBbox =
    maxX >= minX && maxY >= minY
      ? {
          minX,
          maxX,
          minY,
          maxY,
          width: maxX - minX + 1,
          height: maxY - minY + 1,
        }
      : emptySelectionBbox();

  const neighborRegionIds = Array.from(externalTouchCounts.keys()).sort(
    (a, b) => a - b
  );
  const neighborBoundaryHexes = resolveBoundaryHexes(
    puzzle,
    map,
    externalTouchCounts,
    paintedRegionColors
  );

  const regionCount = validSelected.size;
  const minBboxDim = Math.min(bbox.width, bbox.height);
  const totalRegions = puzzle.regions?.length ?? 0;
  const mode: SelectionSubdivisionMode =
    regionCount > 0 &&
    area >= IN_PLACE_MIN_AREA_PX &&
    minBboxDim >= IN_PLACE_MIN_BBOX_DIM_PX &&
    totalRegions < IN_PLACE_MAX_TOTAL_REGIONS
      ? 'in-place'
      : 'child-tile';

  return {
    regionCount,
    area,
    bbox,
    paintedCount,
    neighborRegionIds,
    neighborBoundaryHexes,
    mode,
  };
}

function stampRegionMapIntoMask(
  puzzle: RegionGridLike,
  validSelected: ReadonlySet<number>,
  mask: Uint8Array,
  bMinX: number,
  bMinY: number,
  bw: number,
  bh: number
): number {
  if (!hasValidRegionMap(puzzle)) return 0;
  const { width, height, regionMap } = puzzle;
  let markedCount = 0;
  for (let ly = 0; ly < bh; ly++) {
    const gy = bMinY + ly;
    if (gy < 0 || gy >= height) continue;
    const gRow = gy * width;
    const lRow = ly * bw;
    for (let lx = 0; lx < bw; lx++) {
      const gx = bMinX + lx;
      if (gx < 0 || gx >= width) continue;
      if (validSelected.has(regionMap[gRow + gx])) {
        mask[lRow + lx] = 1;
        markedCount += 1;
      }
    }
  }
  return markedCount;
}

function stampRegionPixelsIntoMask(
  puzzle: RegionGridLike,
  validSelected: ReadonlySet<number>,
  regionById: ReadonlyMap<number, Region>,
  mask: Uint8Array,
  bMinX: number,
  bMinY: number,
  bw: number,
  bh: number
): void {
  const { width, height } = puzzle;
  const total = width * height;
  for (const id of validSelected) {
    const reg = regionById.get(id);
    if (!reg?.pixels) continue;
    for (let i = 0; i < reg.pixels.length; i++) {
      const idx = reg.pixels[i];
      if (idx < 0 || idx >= total) continue;
      const gx = idx % width;
      const gy = (idx - gx) / width;
      const lx = gx - bMinX;
      const ly = gy - bMinY;
      if (lx >= 0 && lx < bw && ly >= 0 && ly < bh) {
        mask[ly * bw + lx] = 1;
      }
    }
  }
}

export function buildSelectionMask(
  puzzle: RegionGridLike,
  selectedIds: ReadonlySet<number>,
  bbox: SubdivisionBbox
): Uint8Array {
  if (
    !bbox ||
    !Number.isFinite(bbox.minX) ||
    !Number.isFinite(bbox.minY) ||
    !Number.isFinite(bbox.width) ||
    !Number.isFinite(bbox.height) ||
    Math.floor(bbox.width) <= 0 ||
    Math.floor(bbox.height) <= 0
  ) {
    return new Uint8Array(0);
  }

  const bw = Math.floor(bbox.width);
  const bh = Math.floor(bbox.height);
  const bMinX = Math.floor(bbox.minX);
  const bMinY = Math.floor(bbox.minY);
  const mask = new Uint8Array(bw * bh);

  const map = buildRegionByIdMap(puzzle);
  const validSelected = new Set<number>();
  for (const id of selectedIds) {
    if (isValidRegionId(id, map)) {
      validSelected.add(id);
    }
  }
  if (validSelected.size === 0 || !isValidGridDimensions(puzzle.width, puzzle.height)) {
    return mask;
  }

  const markedCount = stampRegionMapIntoMask(
    puzzle,
    validSelected,
    mask,
    bMinX,
    bMinY,
    bw,
    bh
  );
  if (markedCount === 0) {
    stampRegionPixelsIntoMask(puzzle, validSelected, map, mask, bMinX, bMinY, bw, bh);
  }

  return mask;
}
