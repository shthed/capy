import {
  ALL_INFINITE_ZOOM_MODEL_IDS,
  INFINITE_ZOOM_PROVIDER_MODES,
  InfiniteZoomModelId,
  InfiniteZoomProviderMode,
  NestedPuzzleLayer,
  NormalizedRect,
  PaletteColor,
  PuzzleData,
  Region,
} from '../../types';
import {
  assertSafeLayerImageKey,
  assertSafeLayerKey,
  assertValidPalette,
  assertValidWorldBounds,
  base64ToUint8,
  buildBorderMapFromRegionMap,
  MAX_DELTA_REGION_ENTRIES,
  MAX_NESTED_LAYERS,
  MAX_PUZZLE_PIXELS,
  MAX_ZOOM_DEPTH,
  uint8ToBase64,
} from '../CapyCodec';

const ALLOWED_PROVIDERS = new Set<string>(INFINITE_ZOOM_PROVIDER_MODES);
const ALLOWED_MODELS = new Set<string>(ALL_INFINITE_ZOOM_MODEL_IDS);

export interface SerializedRegionMeta {
  id: number;
  colorId: number;
  centroidX: number;
  centroidY: number;
  area: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  maxRadius: number;
  /** Legacy v1 per-region pixel index array (derived deterministically from regionMap in v2) */
  pixelsB64?: string;
}

export interface SerializedNestedPuzzleLayer {
  layerId: string;
  depth: number;
  worldBounds: NormalizedRect;
  width: number;
  height: number;
  regionMapRleB64?: string;
  regionMapB64?: string;
  borderMapB64?: string;
  imageBlobKey: string;
  promptHint?: string;
  providerUsed?: InfiniteZoomProviderMode;
  modelUsed?: InfiniteZoomModelId;
  regions: SerializedRegionMeta[];
}

export interface SerializedPuzzleData {
  encodingVersion?: number;
  width: number;
  height: number;
  palette: PaletteColor[];
  /** Compact v2 Run-Length Encoded regionMap (little-endian uint16 regionId + uint16 runLength pairs) */
  regionMapRleB64?: string;
  /** Legacy v1 raw Int32Array regionMap */
  regionMapB64?: string;
  /** Legacy v1 raw Uint8Array borderMap (derived deterministically from regionMap in v2) */
  borderMapB64?: string;
  isFreeColor?: boolean;
  regions: SerializedRegionMeta[];
  nestedLayers?: SerializedNestedPuzzleLayer[];
  maxZoomDepth?: number;
}

function bufferToBase64(buffer: ArrayBufferView): string {
  return uint8ToBase64(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
}

function base64ToInt32Array(b64: string): Int32Array {
  const bytes = base64ToUint8(b64);
  if (bytes.byteLength % 4 !== 0) {
    throw new Error('Invalid Int32Array byte length in puzzle payload');
  }
  return new Int32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

function encodeRegionMapRle16(regionMap: Int32Array): Uint8Array {
  const total = regionMap.length;
  if (total === 0) return new Uint8Array(0);

  let runCount = 0;
  let i = 0;
  while (i < total) {
    const rid = regionMap[i];
    let len = 1;
    while (i + len < total && regionMap[i + len] === rid && len < 65535) {
      len++;
    }
    runCount++;
    i += len;
  }

  const bytes = new Uint8Array(runCount * 4);
  let bIdx = 0;
  i = 0;
  while (i < total) {
    const rid = regionMap[i];
    let len = 1;
    while (i + len < total && regionMap[i + len] === rid && len < 65535) {
      len++;
    }
    bytes[bIdx++] = rid & 0xff;
    bytes[bIdx++] = (rid >> 8) & 0xff;
    bytes[bIdx++] = len & 0xff;
    bytes[bIdx++] = (len >> 8) & 0xff;
    i += len;
  }
  return bytes;
}

function decodeRegionMapRle16(b64: string, total: number): Int32Array {
  if (!Number.isInteger(total) || total <= 0 || total > MAX_PUZZLE_PIXELS) {
    throw new Error('Invalid regionMap pixel count');
  }
  if (typeof b64 !== 'string' || b64.length === 0) {
    throw new Error('Invalid or empty RLE regionMap');
  }
  const bytes = base64ToUint8(b64);
  const byteLen = bytes.byteLength;
  if (byteLen === 0 || byteLen % 4 !== 0) {
    throw new Error('Invalid RLE regionMap byte length');
  }
  const regionMap = new Int32Array(total);
  let writePos = 0;
  let i = 0;
  for (; i < byteLen; i += 4) {
    const rid = bytes[i] | (bytes[i + 1] << 8);
    const len = bytes[i + 2] | (bytes[i + 3] << 8);
    if (len === 0) {
      throw new Error('Invalid zero-length run in RLE regionMap');
    }
    if (writePos + len > total) {
      throw new Error('RLE regionMap run exceeds expected puzzle pixel count');
    }
    const end = writePos + len;
    regionMap.fill(rid, writePos, end);
    writePos = end;
  }
  if (writePos !== total || i !== byteLen) {
    throw new Error('Decoded RLE regionMap length mismatch');
  }
  return regionMap;
}

function isFiniteOptionalNumber(val: unknown): boolean {
  return val === undefined || (typeof val === 'number' && Number.isFinite(val));
}

function isNonNegFinite(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val) && val >= 0;
}

function isFiniteNum(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val);
}

function isValidRegionMeta(r: SerializedPuzzleData['regions'][number], maxAllowedRegionId: number): boolean {
  if (!r || typeof r !== 'object') return false;
  if (!Number.isInteger(r.id) || r.id < 0 || r.id > maxAllowedRegionId) return false;
  if (!Number.isInteger(r.colorId) || r.colorId < 0) return false;
  if (!isFiniteNum(r.centroidX) || !isFiniteNum(r.centroidY)) return false;
  if (!isNonNegFinite(r.area) || !isNonNegFinite(r.maxRadius)) return false;
  return (
    isFiniteOptionalNumber(r.minX) &&
    isFiniteOptionalNumber(r.maxX) &&
    isFiniteOptionalNumber(r.minY) &&
    isFiniteOptionalNumber(r.maxY)
  );
}

function validateRegionMetadata(
  regions: SerializedPuzzleData['regions'],
  maxAllowedRegionId: number
): number {
  let maxRegionId = 0;
  for (let i = 0; i < regions.length; i++) {
    const r = regions[i];
    if (!isValidRegionMeta(r, maxAllowedRegionId)) {
      throw new Error('Invalid puzzle region metadata or ID out of bounds');
    }
    if (r.id > maxRegionId) {
      maxRegionId = r.id;
    }
  }
  return maxRegionId;
}

function decodeLegacyRegions(
  regions: SerializedPuzzleData['regions'],
  total: number
): Region[] {
  let cumulativePixels = 0;
  return regions.map((r) => {
    const pixels = base64ToInt32Array(r.pixelsB64!);
    if (pixels.length > total || cumulativePixels + pixels.length > total) {
      throw new Error('Decoded region pixel array exceeds puzzle pixel count');
    }
    cumulativePixels += pixels.length;
    for (let j = 0; j < pixels.length; j++) {
      const px = pixels[j];
      if (px < 0 || px >= total) {
        throw new Error('Decoded region pixel index out of bounds');
      }
    }
    return {
      id: r.id,
      colorId: r.colorId,
      centroidX: r.centroidX,
      centroidY: r.centroidY,
      area: r.area,
      minX: r.minX,
      maxX: r.maxX,
      minY: r.minY,
      maxY: r.maxY,
      maxRadius: r.maxRadius,
      pixels,
    };
  });
}

function rebuildRegionsFromMap(
  regions: SerializedPuzzleData['regions'],
  regionMap: Int32Array,
  maxRegionId: number,
  total: number
): Region[] {
  const idToIndex = new Int32Array(maxRegionId + 1);
  idToIndex.fill(-1);
  for (let i = 0; i < regions.length; i++) {
    idToIndex[regions[i].id] = i;
  }

  const counts = new Uint32Array(regions.length);
  for (let idx = 0; idx < total; idx++) {
    const rid = regionMap[idx];
    if (rid >= 0 && rid <= maxRegionId) {
      const rIdx = idToIndex[rid];
      if (rIdx >= 0) counts[rIdx]++;
    }
  }

  const pixelArrays: Int32Array[] = Array.from({ length: regions.length }, (_, i) => new Int32Array(counts[i]));

  const cursors = new Uint32Array(regions.length);
  for (let idx = 0; idx < total; idx++) {
    const rid = regionMap[idx];
    if (rid >= 0 && rid <= maxRegionId) {
      const rIdx = idToIndex[rid];
      if (rIdx >= 0) {
        pixelArrays[rIdx][cursors[rIdx]++] = idx;
      }
    }
  }

  return regions.map((r, i) => ({
    id: r.id,
    colorId: r.colorId,
    centroidX: r.centroidX,
    centroidY: r.centroidY,
    area: r.area,
    minX: r.minX,
    maxX: r.maxX,
    minY: r.minY,
    maxY: r.maxY,
    maxRadius: r.maxRadius,
    pixels: pixelArrays[i],
  }));
}

function decodeRegionMapFromSerialized(s: SerializedPuzzleData, total: number): Int32Array {
  let regionMap: Int32Array;
  if (s.regionMapRleB64 !== undefined) {
    if (typeof s.regionMapRleB64 !== 'string' || s.regionMapRleB64.length === 0) {
      throw new Error('Invalid or empty regionMapRleB64 in puzzle payload');
    }
    regionMap = decodeRegionMapRle16(s.regionMapRleB64, total);
  } else if (s.regionMapB64 !== undefined) {
    if (typeof s.regionMapB64 !== 'string' || s.regionMapB64.length === 0) {
      throw new Error('Invalid or empty regionMapB64 in puzzle payload');
    }
    regionMap = base64ToInt32Array(s.regionMapB64);
  } else {
    throw new Error('Missing regionMap in puzzle payload');
  }
  if (regionMap.length !== total) {
    throw new Error('Decoded regionMap length mismatch');
  }
  return regionMap;
}

function decodeBorderMapFromSerialized(
  s: SerializedPuzzleData,
  regionMap: Int32Array,
  total: number
): Uint8Array {
  let borderMap: Uint8Array;
  if (s.borderMapB64 !== undefined) {
    if (typeof s.borderMapB64 !== 'string' || s.borderMapB64.length === 0) {
      throw new Error('Invalid or empty borderMapB64 in puzzle payload');
    }
    borderMap = base64ToUint8(s.borderMapB64);
  } else {
    borderMap = buildBorderMapFromRegionMap(regionMap, s.width, s.height);
  }
  if (borderMap.length !== total) {
    throw new Error('Decoded borderMap length mismatch');
  }
  return borderMap;
}

function canEncodeRle16(regionMap: Int32Array): boolean {
  for (let i = 0; i < regionMap.length; i++) {
    const rid = regionMap[i];
    if (rid < 0 || rid > 65535) {
      return false;
    }
  }
  return true;
}

function serializeNestedLayer(layer: NestedPuzzleLayer): SerializedNestedPuzzleLayer {
  const useRle16 = canEncodeRle16(layer.regionMap);
  return {
    layerId: layer.layerId,
    depth: layer.depth,
    worldBounds: { ...layer.worldBounds },
    width: layer.width,
    height: layer.height,
    ...(useRle16
      ? { regionMapRleB64: bufferToBase64(encodeRegionMapRle16(layer.regionMap)) }
      : {
          regionMapB64: bufferToBase64(layer.regionMap),
          borderMapB64: bufferToBase64(layer.borderMap),
        }),
    imageBlobKey: layer.imageBlobKey,
    ...(layer.promptHint !== undefined ? { promptHint: layer.promptHint } : {}),
    ...(layer.providerUsed !== undefined ? { providerUsed: layer.providerUsed } : {}),
    ...(layer.modelUsed !== undefined ? { modelUsed: layer.modelUsed } : {}),
    regions: layer.regions.map((r) => ({
      id: r.id,
      colorId: r.colorId,
      centroidX: r.centroidX,
      centroidY: r.centroidY,
      area: r.area,
      minX: r.minX,
      maxX: r.maxX,
      minY: r.minY,
      maxY: r.maxY,
      maxRadius: r.maxRadius,
      ...(!useRle16 ? { pixelsB64: bufferToBase64(r.pixels) } : {}),
    })),
  };
}

function assertValidSerializedNestedLayerHeader(layer: SerializedNestedPuzzleLayer): number {
  if (!layer || typeof layer !== 'object' || !Array.isArray(layer.regions)) {
    throw new Error('Invalid nested layer payload structure');
  }
  assertSafeLayerKey(layer.layerId, 'layerId');
  assertSafeLayerImageKey(layer.imageBlobKey, 'imageBlobKey');
  const depthOk = Number.isInteger(layer.depth) && layer.depth >= 1 && layer.depth <= MAX_ZOOM_DEPTH;
  const dimsOk =
    Number.isInteger(layer.width) &&
    Number.isInteger(layer.height) &&
    layer.width > 0 &&
    layer.height > 0;
  if (!depthOk || !dimsOk) {
    throw new Error('Invalid nested layer payload structure');
  }
  assertValidWorldBounds(layer.worldBounds, 'nested layer worldBounds');
  const total = layer.width * layer.height;
  if (!Number.isSafeInteger(total) || total <= 0 || total > MAX_PUZZLE_PIXELS) {
    throw new Error('Invalid nested layer dimensions');
  }
  return total;
}

function deserializeNestedLayer(layer: SerializedNestedPuzzleLayer): NestedPuzzleLayer {
  const total = assertValidSerializedNestedLayerHeader(layer);
  const regionMap = decodeRegionMapFromSerialized(
    layer as unknown as SerializedPuzzleData,
    total
  );
  const borderMap = decodeBorderMapFromSerialized(
    layer as unknown as SerializedPuzzleData,
    regionMap,
    total
  );
  const maxAllowedRegionId = Math.max(total, MAX_DELTA_REGION_ENTRIES);
  if (layer.regions.length > maxAllowedRegionId) {
    throw new Error('Nested layer region count exceeds safety limit');
  }
  const maxRegionId = validateRegionMetadata(layer.regions, maxAllowedRegionId);
  const hasLegacyPixels =
    layer.regions.length > 0 && layer.regions.every((r) => typeof r.pixelsB64 === 'string');
  const regions = hasLegacyPixels
    ? decodeLegacyRegions(layer.regions, total)
    : rebuildRegionsFromMap(layer.regions, regionMap, maxRegionId, total);

  let promptHint: string | undefined;
  if (layer.promptHint !== undefined) {
    if (typeof layer.promptHint !== 'string') {
      throw new Error('Invalid nested layer promptHint');
    }
    const trimmed = layer.promptHint.trim().slice(0, 200);
    if (trimmed.length > 0) {
      promptHint = trimmed;
    }
  }
  let providerUsed: InfiniteZoomProviderMode | undefined;
  if (layer.providerUsed !== undefined) {
    if (typeof layer.providerUsed !== 'string' || !ALLOWED_PROVIDERS.has(layer.providerUsed)) {
      throw new Error('Invalid nested layer providerUsed');
    }
    providerUsed = layer.providerUsed as InfiniteZoomProviderMode;
  }
  let modelUsed: InfiniteZoomModelId | undefined;
  if (layer.modelUsed !== undefined) {
    if (typeof layer.modelUsed !== 'string' || !ALLOWED_MODELS.has(layer.modelUsed)) {
      throw new Error('Invalid nested layer modelUsed');
    }
    modelUsed = layer.modelUsed as InfiniteZoomModelId;
  }

  return {
    layerId: layer.layerId,
    depth: layer.depth,
    worldBounds: { ...layer.worldBounds },
    width: layer.width,
    height: layer.height,
    regions,
    regionMap,
    borderMap,
    imageBlobKey: layer.imageBlobKey,
    ...(promptHint !== undefined ? { promptHint } : {}),
    ...(providerUsed !== undefined ? { providerUsed } : {}),
    ...(modelUsed !== undefined ? { modelUsed } : {}),
  };
}

export function serializePuzzle(p: PuzzleData): SerializedPuzzleData {
  const canUseRle16 = canEncodeRle16(p.regionMap);
  const serializedNested =
    Array.isArray(p.nestedLayers) && p.nestedLayers.length > 0
      ? p.nestedLayers.map(serializeNestedLayer)
      : undefined;
  const extraLayerFields = {
    ...(serializedNested ? { nestedLayers: serializedNested } : {}),
    ...(p.maxZoomDepth !== undefined ? { maxZoomDepth: p.maxZoomDepth } : {}),
  };

  if (canUseRle16) {
    return {
      encodingVersion: 2,
      width: p.width,
      height: p.height,
      palette: p.palette,
      regionMapRleB64: bufferToBase64(encodeRegionMapRle16(p.regionMap)),
      isFreeColor: p.isFreeColor,
      regions: p.regions.map((r) => ({
        id: r.id,
        colorId: r.colorId,
        centroidX: r.centroidX,
        centroidY: r.centroidY,
        area: r.area,
        minX: r.minX,
        maxX: r.maxX,
        minY: r.minY,
        maxY: r.maxY,
        maxRadius: r.maxRadius,
      })),
      ...extraLayerFields,
    };
  }

  return {
    encodingVersion: 1,
    width: p.width,
    height: p.height,
    palette: p.palette,
    regionMapB64: bufferToBase64(p.regionMap),
    borderMapB64: bufferToBase64(p.borderMap),
    isFreeColor: p.isFreeColor,
    regions: p.regions.map((r) => ({
      id: r.id,
      colorId: r.colorId,
      centroidX: r.centroidX,
      centroidY: r.centroidY,
      area: r.area,
      minX: r.minX,
      maxX: r.maxX,
      minY: r.minY,
      maxY: r.maxY,
      maxRadius: r.maxRadius,
      pixelsB64: bufferToBase64(r.pixels),
    })),
    ...extraLayerFields,
  };
}

function deserializeNestedLayersList(
  rawNestedLayers: unknown
): NestedPuzzleLayer[] | undefined {
  if (rawNestedLayers === undefined) return undefined;
  if (!Array.isArray(rawNestedLayers) || rawNestedLayers.length > MAX_NESTED_LAYERS) {
    throw new Error('Invalid nestedLayers list in puzzle payload');
  }
  if (rawNestedLayers.length === 0) return undefined;
  const seenLayerIds = new Set<string>();
  return rawNestedLayers.map((rawLayer) => {
    const layer = deserializeNestedLayer(rawLayer as SerializedNestedPuzzleLayer);
    if (seenLayerIds.has(layer.layerId)) {
      throw new Error(`Duplicate nested layerId "${layer.layerId}"`);
    }
    seenLayerIds.add(layer.layerId);
    return layer;
  });
}

function parseSerializedMaxZoomDepth(rawDepth: unknown): number | undefined {
  if (rawDepth === undefined) return undefined;
  if (
    typeof rawDepth !== 'number' ||
    !Number.isInteger(rawDepth) ||
    rawDepth < 0 ||
    rawDepth > MAX_ZOOM_DEPTH
  ) {
    throw new Error('Invalid maxZoomDepth in puzzle payload');
  }
  return rawDepth;
}

export function deserializePuzzle(s: SerializedPuzzleData): PuzzleData {
  if (
    !s ||
    !Number.isInteger(s.width) ||
    !Number.isInteger(s.height) ||
    s.width <= 0 ||
    s.height <= 0 ||
    !Array.isArray(s.regions)
  ) {
    throw new Error('Invalid puzzle payload dimensions or structure');
  }
  assertValidPalette(s.palette);
  if (s.isFreeColor !== undefined && typeof s.isFreeColor !== 'boolean') {
    throw new Error('Invalid isFreeColor flag in puzzle payload');
  }
  const total = s.width * s.height;
  if (!Number.isSafeInteger(total) || total <= 0 || total > MAX_PUZZLE_PIXELS) {
    throw new Error('Invalid puzzle payload dimensions or structure');
  }

  const regionMap = decodeRegionMapFromSerialized(s, total);
  const borderMap = decodeBorderMapFromSerialized(s, regionMap, total);

  const maxAllowedRegionId = Math.max(total, MAX_DELTA_REGION_ENTRIES);
  if (s.regions.length > maxAllowedRegionId) {
    throw new Error('Puzzle region count exceeds safety limit');
  }

  const maxRegionId = validateRegionMetadata(s.regions, maxAllowedRegionId);
  const hasLegacyPixels =
    s.regions.length > 0 && s.regions.every((r) => typeof r.pixelsB64 === 'string');

  const regions = hasLegacyPixels
    ? decodeLegacyRegions(s.regions, total)
    : rebuildRegionsFromMap(s.regions, regionMap, maxRegionId, total);

  const nestedLayers = deserializeNestedLayersList(s.nestedLayers);
  const maxZoomDepth = parseSerializedMaxZoomDepth(s.maxZoomDepth);

  return {
    width: s.width,
    height: s.height,
    palette: s.palette,
    regionMap,
    borderMap,
    isFreeColor: s.isFreeColor,
    regions,
    ...(nestedLayers ? { nestedLayers } : {}),
    ...(maxZoomDepth !== undefined ? { maxZoomDepth } : {}),
  };
}
