import {
  ALL_INFINITE_ZOOM_MODEL_IDS,
  BorderExtensionSides,
  INFINITE_ZOOM_PROVIDER_MODES,
  InfiniteZoomBounds,
  InfiniteZoomDirection,
  InfiniteZoomModelId,
  InfiniteZoomNodeMeta,
  InfiniteZoomProviderMode,
  NestedPuzzleLayer,
  NormalizedRect,
  PaletteColor,
  PuzzleData,
  PuzzleSourceRef,
  Region,
  SAMPLE_GALLERY,
  SavedSnapshot,
} from '../types';
import { base64ToUint8, uint8ToBase64 } from '../utils/base64';
import {
  buildCanonicalLayerImageKey,
  LAYER_IMAGE_KEY_PREFIX,
  PREVIEW_IMAGE_KEY_PREFIX,
} from './storage/StorageKeys';

export { base64ToUint8, buildCanonicalLayerImageKey, uint8ToBase64 };

/**
 * Compact Puzzle & Save Codec v2 (`CapyCodec`)
 *
 * Eliminates redundant storage of `borderMap` and per-region `Int32Array` pixel lists
 * (~9.5 MB in IndexedDB / ~12.6 MB JSON `.capy` for a 1024x1024 puzzle) by:
 * 1. Encoding `regionMap` via scanline Run-Length + LEB128 varint encoding (~55-85 KB raw, ~22-45 KB gzipped).
 * 2. Storing per-region metadata (`id`, `colorId`, `centroidX`, `centroidY`, `maxRadius`) in a flat `Float32Array`.
 * 3. Reconstructing `Int32Array` `regionMap`, `Uint8Array` `borderMap`, bounding boxes, `area`,
 *    and exact scanline-ordered `Int32Array` `region.pixels` in two zero-allocation typed-array passes (< 3 ms).
 * 4. Providing `.capy` v2 binary container serialization (`CAPY\x02...` with Gzip compression)
 *    plus `< 2 KB` CRDT-mergeable `ProgressDeltaV2` tokens for URL sharing and cloud/multiplayer sync.
 */

const MAGIC_BYTES = new Uint8Array([0x43, 0x41, 0x50, 0x59]); // "CAPY"
const BINARY_VERSION_V2 = 2;

const FLAG_GZIP = 1 << 0;
const FLAG_ARCHIVE = 1 << 1;

const REGION_META_STRIDE = 5; // [id, colorId, centroidX, centroidY, maxRadius]

export const MAX_PUZZLE_PIXELS = 16_777_216; // 4096 x 4096 ceiling
export const MAX_BINARY_SAVE_DECOMPRESSED_BYTES = 16 * 1024 * 1024; // 16 MB
export const MAX_BINARY_ARCHIVE_DECOMPRESSED_BYTES = 256 * 1024 * 1024; // 256 MB
export const MAX_DELTA_DECOMPRESSED_BYTES = 256 * 1024; // 256 KB
export const MAX_DELTA_SOURCE_REF_BYTES = 4096;
export const MAX_DELTA_REGION_ENTRIES = 65_536;
export const MAX_DELTA_RESET_EPOCH = 1_000_000;
export const MAX_NESTED_LAYERS = 64;
export const MAX_ZOOM_DEPTH = 32;
const MAX_FRAMED_BINARY_CHUNKS = 4096;
const SAFE_LAYER_KEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,255}$/;
const FORBIDDEN_LAYER_MAP_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const ALLOWED_LAYER_IMAGE_MIMES = new Set([
  'image/png',
  'image/webp',
  'image/jpeg',
  'image/gif',
  'image/avif',
  'image/bmp',
]);
const ALLOWED_INFINITE_ZOOM_PROVIDERS = new Set<string>(INFINITE_ZOOM_PROVIDER_MODES);
const ALLOWED_NANO_BANANA_MODELS = new Set<string>(ALL_INFINITE_ZOOM_MODEL_IDS);

export interface CompactNestedLayerRecordV2 {
  layerId: string;
  depth: number;
  worldBounds: NormalizedRect;
  width: number;
  height: number;
  /** Packed stride-5 Float32Array: [id, colorId, centroidX, centroidY, maxRadius] */
  regionMeta: Float32Array;
  /** Scanline RLE + varint encoded regionMap */
  rleRegionMap: Uint8Array;
  imageBlobKey: string;
  promptHint?: string;
  providerUsed?: InfiniteZoomProviderMode;
  modelUsed?: InfiniteZoomModelId;
}

export interface SerializedCompactNestedLayerV2 {
  layerId: string;
  depth: number;
  worldBounds: NormalizedRect;
  width: number;
  height: number;
  regionMetaBytes: Uint8Array;
  rleRegionMap: Uint8Array;
  imageBlobKey: string;
  promptHint?: string;
  providerUsed?: InfiniteZoomProviderMode;
  modelUsed?: InfiniteZoomModelId;
}

export interface CompactPuzzleRecordV2 {
  __capyCompactV2: 2;
  width: number;
  height: number;
  isFreeColor?: boolean;
  palette: PaletteColor[];
  /** Packed stride-5 Float32Array: [id, colorId, centroidX, centroidY, maxRadius] */
  regionMeta: Float32Array;
  /** Scanline RLE + varint encoded regionMap */
  rleRegionMap: Uint8Array;
  nestedLayers?: CompactNestedLayerRecordV2[];
  maxZoomDepth?: number;
}

export interface SingleSavePayloadV2 {
  format: 'capy-single-save-v2';
  version: 2;
  exportDate: number;
  snapshot: SavedSnapshot;
  compactPuzzle: SerializedCompactPuzzleV2 | null;
  imageMimeType?: string;
  imageBytes?: Uint8Array;
  layerImages?: Record<string, { mimeType: string; bytes: Uint8Array }>;
}

export interface ArchiveSavePayloadV2 {
  format: 'capy-archive-save-v2';
  version: 2;
  exportDate: number;
  snapshots: SavedSnapshot[];
  compactPuzzles: Record<string, SerializedCompactPuzzleV2>;
  images?: Record<string, { mimeType: string; bytes: Uint8Array }>;
  layerImages?: Record<string, { mimeType: string; bytes: Uint8Array }>;
}

export interface SerializedCompactPuzzleV2 {
  width: number;
  height: number;
  isFreeColor?: boolean;
  palette: PaletteColor[];
  regionMetaBytes: Uint8Array;
  rleRegionMap: Uint8Array;
  nestedLayers?: SerializedCompactNestedLayerV2[];
  maxZoomDepth?: number;
}

export interface ProgressDeltaV2 {
  version: 2;
  sourceRef?: PuzzleSourceRef;
  filledRegionIds: number[];
  paintedRegionColors?: Record<number, number>;
  isFreeColor?: boolean;
  resetEpoch?: number;
  updatedAt: number;
}

function writeVarint(out: number[], value: number): void {
  let v = value >>> 0;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v);
}

function readVarint(buf: Uint8Array, offsetObj: { pos: number }): number {
  let result = 0;
  let shift = 0;
  while (offsetObj.pos < buf.length) {
    if (shift > 28) {
      throw new Error('Malformed varint: exceeds uint32 length');
    }
    const byte = buf[offsetObj.pos++];
    if (shift === 28 && (byte & 0xf0) !== 0) {
      throw new Error('Malformed varint: uint32 overflow');
    }
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return result >>> 0;
    }
    shift += 7;
  }
  throw new Error('Malformed varint: unexpected EOF');
}

/**
 * Encodes an Int32Array `regionMap` into a compact scanline Run-Length + Varint byte array.
 * Non-positive region IDs (if any) are mapped to 0, positive IDs `rid` mapped to `rid`.
 */
export function encodeRegionMapRle(regionMap: Int32Array): Uint8Array {
  const len = regionMap.length;
  if (len === 0) return new Uint8Array(0);

  const out: number[] = [];
  let currentId = Math.max(0, regionMap[0]);
  let runLen = 1;

  for (let i = 1; i < len; i++) {
    const rid = Math.max(0, regionMap[i]);
    if (rid === currentId) {
      runLen++;
    } else {
      writeVarint(out, currentId);
      writeVarint(out, runLen);
      currentId = rid;
      runLen = 1;
    }
  }
  writeVarint(out, currentId);
  writeVarint(out, runLen);

  return new Uint8Array(out);
}

/**
 * Decodes a scanline RLE + Varint byte stream back into an Int32Array `regionMap` of length `totalPixels`.
 */
export function decodeRegionMapRle(rle: Uint8Array, totalPixels: number): Int32Array {
  if (!Number.isInteger(totalPixels) || totalPixels <= 0 || totalPixels > MAX_PUZZLE_PIXELS) {
    throw new Error('Invalid regionMap pixel count');
  }
  if (!(rle instanceof Uint8Array) || rle.length === 0) {
    throw new Error('Invalid or empty RLE regionMap');
  }
  const regionMap = new Int32Array(totalPixels);
  const cursor = { pos: 0 };
  let writeIdx = 0;

  while (cursor.pos < rle.length) {
    const rid = readVarint(rle, cursor);
    const runLen = readVarint(rle, cursor);
    if (runLen === 0) {
      throw new Error('Invalid zero-length run in RLE regionMap');
    }
    if (writeIdx + runLen > totalPixels) {
      throw new Error('RLE regionMap run exceeds expected puzzle pixel count');
    }
    const end = writeIdx + runLen;
    regionMap.fill(rid, writeIdx, end);
    writeIdx = end;
  }

  if (writeIdx !== totalPixels || cursor.pos !== rle.length) {
    throw new Error('Decoded RLE regionMap length mismatch');
  }

  return regionMap;
}

function hasAsciiControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export function isReservedSnapshotId(id: string): boolean {
  const trimmed = id.trim();
  return (
    FORBIDDEN_LAYER_MAP_KEYS.has(id) ||
    FORBIDDEN_LAYER_MAP_KEYS.has(trimmed) ||
    id.startsWith(LAYER_IMAGE_KEY_PREFIX) ||
    trimmed.startsWith(LAYER_IMAGE_KEY_PREFIX) ||
    id.startsWith(PREVIEW_IMAGE_KEY_PREFIX) ||
    trimmed.startsWith(PREVIEW_IMAGE_KEY_PREFIX)
  );
}

export function assertSafeLayerKey(key: unknown, label: string): asserts key is string {
  if (
    typeof key !== 'string' ||
    FORBIDDEN_LAYER_MAP_KEYS.has(key) ||
    key.includes('..') ||
    !SAFE_LAYER_KEY_RE.test(key)
  ) {
    throw new Error(`Invalid ${label} in nested layer record`);
  }
}

export function assertSafeLayerImageKey(key: unknown, label: string): asserts key is string {
  assertSafeLayerKey(key, label);
  if (!key.startsWith(LAYER_IMAGE_KEY_PREFIX) || key.length <= LAYER_IMAGE_KEY_PREFIX.length) {
    throw new Error(
      `Invalid ${label} in nested layer record: must start with "${LAYER_IMAGE_KEY_PREFIX}"`
    );
  }
}

export function assertValidWorldBounds(
  bounds: unknown,
  label: string
): asserts bounds is NormalizedRect {
  if (!bounds || typeof bounds !== 'object' || Array.isArray(bounds)) {
    throw new Error(`Invalid ${label}: expected NormalizedRect object`);
  }
  const rect = bounds as Record<string, unknown>;
  const { x, y, width, height } = rect;
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  ) {
    throw new Error(`Invalid ${label}: non-finite coordinates`);
  }
  if (
    x < 0 ||
    x >= 1 ||
    y < 0 ||
    y >= 1 ||
    width <= 0 ||
    height <= 0 ||
    x + width > 1 + 1e-6 ||
    y + height > 1 + 1e-6
  ) {
    throw new Error(`Invalid ${label}: coordinates out of normalized [0..1] range`);
  }
}

function sanitizeNestedLayerOptionalFields(layer: {
  promptHint?: unknown;
  providerUsed?: unknown;
  modelUsed?: unknown;
}): {
  promptHint?: string;
  providerUsed?: InfiniteZoomProviderMode;
  modelUsed?: InfiniteZoomModelId;
} {
  const out: {
    promptHint?: string;
    providerUsed?: InfiniteZoomProviderMode;
    modelUsed?: InfiniteZoomModelId;
  } = {};
  if (layer.promptHint !== undefined) {
    if (typeof layer.promptHint !== 'string') {
      throw new Error('Invalid nested layer promptHint');
    }
    const trimmed = layer.promptHint.trim().slice(0, 200);
    if (trimmed.length > 0) {
      out.promptHint = trimmed;
    }
  }
  if (layer.providerUsed !== undefined) {
    if (
      typeof layer.providerUsed !== 'string' ||
      !ALLOWED_INFINITE_ZOOM_PROVIDERS.has(layer.providerUsed)
    ) {
      throw new Error('Invalid nested layer providerUsed');
    }
    out.providerUsed = layer.providerUsed as InfiniteZoomProviderMode;
  }
  if (layer.modelUsed !== undefined) {
    if (typeof layer.modelUsed !== 'string' || !ALLOWED_NANO_BANANA_MODELS.has(layer.modelUsed)) {
      throw new Error('Invalid nested layer modelUsed');
    }
    out.modelUsed = layer.modelUsed as InfiniteZoomModelId;
  }
  return out;
}

function validateMaxZoomDepth(raw: unknown): number | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > MAX_ZOOM_DEPTH) {
    throw new Error(`Invalid maxZoomDepth: expected integer in 0..${MAX_ZOOM_DEPTH}`);
  }
  return raw;
}

function assertValidLayerImagesMap(
  layerImages: unknown
): asserts layerImages is Record<string, { mimeType: string; bytes: Uint8Array }> {
  if (!layerImages || typeof layerImages !== 'object' || Array.isArray(layerImages)) {
    throw new Error('Invalid Capy v2 binary layerImages map');
  }
  const mapObj = layerImages as Record<string, unknown>;
  for (const key of Object.keys(mapObj)) {
    assertSafeLayerImageKey(key, 'layerImages key');
    const entry = mapObj[key];
    if (
      !entry ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      !((entry as { bytes?: unknown }).bytes instanceof Uint8Array) ||
      typeof (entry as { mimeType?: unknown }).mimeType !== 'string'
    ) {
      throw new Error(`Invalid layerImages entry for key "${key}"`);
    }
    const rawMime = (entry as { mimeType: string }).mimeType
      .trim()
      .toLowerCase()
      .split(';')[0]
      .trim();
    const normalizedMime = rawMime === 'image/jpg' ? 'image/jpeg' : rawMime;
    if (!ALLOWED_LAYER_IMAGE_MIMES.has(normalizedMime)) {
      throw new Error(`Unsupported MIME type "${normalizedMime}" in layerImages for key "${key}"`);
    }
    (entry as { mimeType: string }).mimeType = normalizedMime;
  }
}

function packRegionsToMetaFloat32(regions: Region[]): Float32Array {
  const regionCount = regions.length;
  const regionMeta = new Float32Array(regionCount * REGION_META_STRIDE);

  for (let i = 0; i < regionCount; i++) {
    const r = regions[i];
    const base = i * REGION_META_STRIDE;
    regionMeta[base] = r.id;
    regionMeta[base + 1] = r.colorId;
    regionMeta[base + 2] = r.centroidX;
    regionMeta[base + 3] = r.centroidY;
    regionMeta[base + 4] = r.maxRadius;
  }

  return regionMeta;
}

/**
 * Compresses an in-memory `PuzzleData` into a `CompactPuzzleRecordV2` suitable for IndexedDB (~140x smaller).
 */
export function compressPuzzleRecord(puzzle: PuzzleData): CompactPuzzleRecordV2 {
  const regionMeta = packRegionsToMetaFloat32(puzzle.regions);
  const rleRegionMap = encodeRegionMapRle(puzzle.regionMap);

  let nestedLayers: CompactNestedLayerRecordV2[] | undefined;
  if (Array.isArray(puzzle.nestedLayers) && puzzle.nestedLayers.length > 0) {
    if (puzzle.nestedLayers.length > MAX_NESTED_LAYERS) {
      throw new Error(`Nested layer count (${puzzle.nestedLayers.length}) exceeds limit (${MAX_NESTED_LAYERS})`);
    }
    const seenLayerIds = new Set<string>();
    nestedLayers = puzzle.nestedLayers.map((layer) => {
      assertSafeLayerKey(layer.layerId, 'layerId');
      if (seenLayerIds.has(layer.layerId)) {
        throw new Error(`Duplicate nested layerId "${layer.layerId}"`);
      }
      seenLayerIds.add(layer.layerId);
      assertSafeLayerImageKey(layer.imageBlobKey, 'imageBlobKey');
      if (!Number.isInteger(layer.depth) || layer.depth < 1 || layer.depth > MAX_ZOOM_DEPTH) {
        throw new Error(`Invalid nested layer depth (${layer.depth})`);
      }
      if (
        !Number.isInteger(layer.width) ||
        !Number.isInteger(layer.height) ||
        layer.width <= 0 ||
        layer.height <= 0
      ) {
        throw new Error(
          `Invalid nested layer dimensions (${String(layer.width)}x${String(layer.height)})`
        );
      }
      const layerPixels = layer.width * layer.height;
      if (!Number.isSafeInteger(layerPixels) || layerPixels <= 0 || layerPixels > MAX_PUZZLE_PIXELS) {
        throw new Error(`Nested layer pixel count (${layerPixels}) exceeds limit (${MAX_PUZZLE_PIXELS})`);
      }
      assertValidWorldBounds(layer.worldBounds, 'nested layer worldBounds');
      const opt = sanitizeNestedLayerOptionalFields(layer);
      return {
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
        regionMeta: packRegionsToMetaFloat32(layer.regions),
        rleRegionMap: encodeRegionMapRle(layer.regionMap),
        imageBlobKey: layer.imageBlobKey,
        ...opt,
      };
    });
  }

  const maxZoomDepth = validateMaxZoomDepth(puzzle.maxZoomDepth);

  return {
    __capyCompactV2: 2,
    width: puzzle.width,
    height: puzzle.height,
    ...(puzzle.isFreeColor !== undefined ? { isFreeColor: puzzle.isFreeColor } : {}),
    palette: puzzle.palette,
    regionMeta,
    rleRegionMap,
    ...(nestedLayers ? { nestedLayers } : {}),
    ...(maxZoomDepth !== undefined ? { maxZoomDepth } : {}),
  };
}

/**
 * Estimates the compact byte size of a puzzle (including all nested layers) + optional preview thumbnail.
 */
export function estimateCompactPuzzleBytes(puzzle: PuzzleData, previewDataUrl?: string): number {
  const rle = encodeRegionMapRle(puzzle.regionMap);
  const metaBytes = puzzle.regions.length * REGION_META_STRIDE * 4;
  const paletteBytes = puzzle.palette.length * 48;
  let nestedBytes = 0;
  if (Array.isArray(puzzle.nestedLayers)) {
    for (const layer of puzzle.nestedLayers) {
      const layerRle = encodeRegionMapRle(layer.regionMap);
      nestedBytes += layerRle.byteLength + layer.regions.length * REGION_META_STRIDE * 4 + 128;
    }
  }
  const previewBytes = previewDataUrl ? Math.ceil((previewDataUrl.length * 3) / 4) : 0;
  return rle.byteLength + metaBytes + paletteBytes + nestedBytes + previewBytes;
}

export function isCompactPuzzleRecordV2(val: unknown): val is CompactPuzzleRecordV2 {
  return Boolean(
    val &&
      typeof val === 'object' &&
      (val as CompactPuzzleRecordV2).__capyCompactV2 === 2 &&
      (val as CompactPuzzleRecordV2).rleRegionMap instanceof Uint8Array
  );
}

const ALLOWED_SOURCE_KINDS = new Set(['sample', 'catalog', 'url', 'blob']);

export function assertValidPalette(palette: unknown): asserts palette is PaletteColor[] {
  if (!Array.isArray(palette) || palette.length > 4096) {
    throw new Error('Invalid puzzle palette: expected array');
  }
  for (let i = 0; i < palette.length; i++) {
    const swatch = palette[i] as Record<string, unknown> | null | undefined;
    if (!swatch || typeof swatch !== 'object' || Array.isArray(swatch)) {
      throw new Error(`Invalid palette swatch at index ${i}`);
    }
    if (typeof swatch.id !== 'number' || !Number.isInteger(swatch.id) || swatch.id < 0) {
      throw new Error(`Invalid palette swatch id at index ${i}`);
    }
    if (typeof swatch.hex !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(swatch.hex.trim())) {
      throw new Error(`Invalid palette swatch hex at index ${i}`);
    }
    if (swatch.isLight !== undefined && typeof swatch.isLight !== 'boolean') {
      throw new Error(`Invalid palette swatch isLight at index ${i}`);
    }
    if (swatch.argb !== undefined && (typeof swatch.argb !== 'number' || !Number.isFinite(swatch.argb))) {
      throw new Error(`Invalid palette swatch argb at index ${i}`);
    }
    for (const chan of ['r', 'g', 'b'] as const) {
      const val = swatch[chan];
      if (
        val !== undefined &&
        (typeof val !== 'number' || !Number.isFinite(val) || val < 0 || val > 255)
      ) {
        throw new Error(`Invalid palette swatch ${chan} at index ${i}`);
      }
    }
  }
}

function hasControlOrWhitespace(value: string): boolean {
  return /\s/.test(value) || hasAsciiControlChar(value);
}

export function isAllowedSampleAssetPath(rawPath: unknown): rawPath is string {
  if (typeof rawPath !== 'string') return false;
  if (rawPath.length === 0 || rawPath.length > 256 || hasControlOrWhitespace(rawPath)) {
    return false;
  }
  const clean = rawPath.replace(/^\.\//, '');
  return SAMPLE_GALLERY.some((s) => s.assetPath.replace(/^\.\//, '') === clean);
}

export function isSafeSnapshotPreviewDataUrl(rawUrl: unknown): rawUrl is string {
  if (typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  return /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(trimmed);
}

function assertValidSourceRefUrl(trimmedUri: string): void {
  let parsed: URL;
  try {
    parsed = new URL(trimmedUri);
  } catch {
    throw new Error('Invalid puzzle sourceRef URL');
  }
  const proto = parsed.protocol.toLowerCase();
  const host = parsed.hostname.toLowerCase();
  if (
    proto !== 'https:' &&
    !(proto === 'http:' && (host === 'localhost' || host === '127.0.0.1'))
  ) {
    throw new Error('Unsafe sourceRef URL protocol');
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new Error('Invalid puzzle sourceRef URL credentials');
  }
}

function assertValidSourceRefByKind(kind: string, trimmedUri: string): void {
  if (kind === 'sample') {
    if (!isAllowedSampleAssetPath(trimmedUri)) {
      throw new Error('Invalid puzzle sourceRef sample asset path');
    }
    return;
  }
  if (kind === 'catalog') {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(trimmedUri) || trimmedUri.includes('..')) {
      throw new Error('Invalid puzzle sourceRef catalog id');
    }
    return;
  }
  if (kind === 'blob') {
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,255}$/.test(trimmedUri) ||
      trimmedUri.includes('..') ||
      FORBIDDEN_LAYER_MAP_KEYS.has(trimmedUri) ||
      trimmedUri.startsWith(LAYER_IMAGE_KEY_PREFIX)
    ) {
      throw new Error('Invalid puzzle sourceRef blob id');
    }
    return;
  }
  if (kind === 'url') {
    assertValidSourceRefUrl(trimmedUri);
  }
}

export function assertValidSourceRef(sourceRef: unknown): asserts sourceRef is PuzzleSourceRef {
  if (!sourceRef || typeof sourceRef !== 'object' || Array.isArray(sourceRef)) {
    throw new Error('Invalid puzzle sourceRef');
  }
  const ref = sourceRef as Record<string, unknown>;
  if (typeof ref.kind !== 'string' || !ALLOWED_SOURCE_KINDS.has(ref.kind)) {
    throw new Error('Invalid puzzle sourceRef kind');
  }
  if (typeof ref.uri !== 'string' || ref.uri.trim().length === 0 || ref.uri.length > 2048) {
    throw new Error('Invalid puzzle sourceRef uri');
  }
  if (hasControlOrWhitespace(ref.uri)) {
    throw new Error('Invalid puzzle sourceRef uri');
  }
  assertValidSourceRefByKind(ref.kind, ref.uri.trim());
  if (
    ref.contentHash !== undefined &&
    (typeof ref.contentHash !== 'string' || ref.contentHash.length > 256)
  ) {
    throw new Error('Invalid puzzle sourceRef contentHash');
  }
}

const ZOOM_TREE_MIN_DEPTH = -32;
const ZOOM_TREE_MAX_DEPTH = 32;
const ZOOM_TREE_MAX_CHILDREN = 64;
const ZOOM_TREE_MAX_ID_LEN = 256;
const ZOOM_TREE_MAX_SELECTED_REGIONS = 2600;
const ZOOM_TREE_MAX_PROMPT_HINT_LEN = 200;
const ZOOM_TREE_MAX_IN_PLACE_SUBDIVISIONS = 1000;

const ALLOWED_ZOOM_DIRECTIONS = new Set<InfiniteZoomDirection>([
  'in-place',
  'child-in',
  'extend-out',
]);

const ALLOWED_AI_TIERS = new Set<NonNullable<InfiniteZoomNodeMeta['aiTierUsed']>>([
  'chrome-ai',
  'local-wasm',
  'offline-procedural',
]);

function clampUnit(val: unknown): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) return 0;
  const clamped = Math.min(1, Math.max(0, val));
  return clamped === 0 ? 0 : clamped;
}

function sanitizeZoomBounds(raw: unknown): InfiniteZoomBounds | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const b = raw as Record<string, unknown>;
  const x = clampUnit(b.x);
  const y = clampUnit(b.y);
  const width = Math.min(Math.max(0, 1 - x), clampUnit(b.width));
  const height = Math.min(Math.max(0, 1 - y), clampUnit(b.height));
  return {
    x,
    y,
    width: width === 0 ? 0 : width,
    height: height === 0 ? 0 : height,
  };
}

function sanitizeZoomChildIds(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed || trimmed.length > ZOOM_TREE_MAX_ID_LEN || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= ZOOM_TREE_MAX_CHILDREN) break;
  }
  return out.length > 0 ? out : undefined;
}

function sanitizeZoomExtendedSides(raw: unknown): BorderExtensionSides | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const e = raw as Record<string, unknown>;
  return {
    top: Boolean(e.top),
    bottom: Boolean(e.bottom),
    left: Boolean(e.left),
    right: Boolean(e.right),
  };
}

function sanitizeZoomSelectedRegions(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<number>();
  const out: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const id = raw[i];
    if (
      typeof id !== 'number' ||
      !Number.isInteger(id) ||
      id < 1 ||
      id > MAX_PUZZLE_PIXELS ||
      seen.has(id)
    ) {
      continue;
    }
    seen.add(id);
    out.push(id);
    if (out.length >= ZOOM_TREE_MAX_SELECTED_REGIONS) break;
  }
  return out.length > 0 ? out : undefined;
}

function sanitizeZoomPromptHint(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim().slice(0, ZOOM_TREE_MAX_PROMPT_HINT_LEN);
  return trimmed.length > 0 ? trimmed : undefined;
}

function sanitizeZoomAiTier(raw: unknown): InfiniteZoomNodeMeta['aiTierUsed'] | undefined {
  if (typeof raw !== 'string') return undefined;
  return ALLOWED_AI_TIERS.has(raw as NonNullable<InfiniteZoomNodeMeta['aiTierUsed']>)
    ? (raw as InfiniteZoomNodeMeta['aiTierUsed'])
    : undefined;
}

function sanitizeZoomSubdivisionCount(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
  const clamped = Math.min(ZOOM_TREE_MAX_IN_PLACE_SUBDIVISIONS, Math.max(0, Math.round(raw)));
  return clamped === 0 ? 0 : clamped;
}

export function sanitizeZoomTreeMeta(raw: unknown): InfiniteZoomNodeMeta | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid snapshot zoomTree metadata');
  }
  const z = raw as Record<string, unknown>;
  const rawDepth =
    typeof z.depth === 'number' && Number.isFinite(z.depth)
      ? Math.min(ZOOM_TREE_MAX_DEPTH, Math.max(ZOOM_TREE_MIN_DEPTH, Math.round(z.depth)))
      : 0;
  const depth = rawDepth === 0 ? 0 : rawDepth;
  const direction: InfiniteZoomDirection =
    typeof z.direction === 'string' &&
    ALLOWED_ZOOM_DIRECTIONS.has(z.direction as InfiniteZoomDirection)
      ? (z.direction as InfiniteZoomDirection)
      : 'child-in';

  const result: InfiniteZoomNodeMeta = { depth, direction };
  const boundsInParent = sanitizeZoomBounds(z.boundsInParent);
  if (boundsInParent !== undefined) result.boundsInParent = boundsInParent;
  const childSnapshotIds = sanitizeZoomChildIds(z.childSnapshotIds);
  if (childSnapshotIds !== undefined) result.childSnapshotIds = childSnapshotIds;
  const extendedSides = sanitizeZoomExtendedSides(z.extendedSides);
  if (extendedSides !== undefined) result.extendedSides = extendedSides;
  const selectedRegionIds = sanitizeZoomSelectedRegions(z.selectedRegionIds);
  if (selectedRegionIds !== undefined) result.selectedRegionIds = selectedRegionIds;
  const promptHint = sanitizeZoomPromptHint(z.promptHint);
  if (promptHint !== undefined) result.promptHint = promptHint;
  const aiTierUsed = sanitizeZoomAiTier(z.aiTierUsed);
  if (aiTierUsed !== undefined) result.aiTierUsed = aiTierUsed;
  const inPlaceSubdivisionCount = sanitizeZoomSubdivisionCount(z.inPlaceSubdivisionCount);
  if (inPlaceSubdivisionCount !== undefined) {
    result.inPlaceSubdivisionCount = inPlaceSubdivisionCount;
  }
  return result;
}

function validateSnapshotZoomFields(s: Record<string, unknown>): void {
  if (s.parentSnapshotId !== undefined) {
    if (
      typeof s.parentSnapshotId !== 'string' ||
      s.parentSnapshotId.length > ZOOM_TREE_MAX_ID_LEN ||
      s.parentSnapshotId.trim().length === 0
    ) {
      throw new Error('Invalid snapshot parentSnapshotId');
    }
    s.parentSnapshotId = s.parentSnapshotId.trim();
  }
  if (s.zoomTree !== undefined) {
    s.zoomTree = sanitizeZoomTreeMeta(s.zoomTree);
  }
}

function assertValidSnapshotId(id: unknown): asserts id is string {
  if (
    typeof id !== 'string' ||
    id.trim().length === 0 ||
    id.length > 256 ||
    id !== id.trim() ||
    hasAsciiControlChar(id) ||
    isReservedSnapshotId(id)
  ) {
    throw new Error('Invalid snapshot id');
  }
}

function assertValidSnapshotStrictV2Fields(s: Record<string, unknown>): void {
  if (!Array.isArray(s.filledRegionIds)) {
    throw new Error('Invalid snapshot filledRegionIds: expected array');
  }
  if (typeof s.filledCount !== 'number' || !Number.isFinite(s.filledCount) || s.filledCount < 0) {
    throw new Error('Invalid snapshot filledCount');
  }
  if (typeof s.totalCount !== 'number' || !Number.isFinite(s.totalCount) || s.totalCount < 0) {
    throw new Error('Invalid snapshot totalCount');
  }
}

function assertValidSnapshotFilledRegionIds(rawFilled: unknown): void {
  if (rawFilled === undefined) return;
  if (!Array.isArray(rawFilled) || rawFilled.length > MAX_DELTA_REGION_ENTRIES) {
    throw new Error('Invalid snapshot filledRegionIds');
  }
  for (let i = 0; i < rawFilled.length; i++) {
    const rid = rawFilled[i];
    if (typeof rid !== 'number' || !Number.isInteger(rid) || rid <= 0 || rid > MAX_PUZZLE_PIXELS) {
      throw new Error('Invalid region ID in snapshot filledRegionIds');
    }
  }
}

function assertValidSnapshotNumericFields(s: Record<string, unknown>): void {
  for (const nonNegField of [
    'filledCount',
    'totalCount',
    'timestamp',
    'lastOpened',
    'resetEpoch',
    'fileSizeBytes',
  ] as const) {
    const val = s[nonNegField];
    if (val !== undefined && (typeof val !== 'number' || !Number.isFinite(val) || val < 0)) {
      throw new Error(`Invalid snapshot ${nonNegField}`);
    }
  }
  for (const finiteField of ['zoomScale', 'panOffsetX', 'panOffsetY'] as const) {
    const val = s[finiteField];
    if (val !== undefined && (typeof val !== 'number' || !Number.isFinite(val))) {
      throw new Error(`Invalid snapshot ${finiteField}`);
    }
  }
}

function assertValidSnapshotPaintedRegionColors(rawColors: unknown): void {
  if (rawColors === undefined) return;
  if (!rawColors || typeof rawColors !== 'object' || Array.isArray(rawColors)) {
    throw new Error('Invalid snapshot paintedRegionColors');
  }
  const entries = Object.entries(rawColors as Record<string, unknown>);
  if (entries.length > MAX_DELTA_REGION_ENTRIES) {
    throw new Error('Snapshot paintedRegionColors exceeds limit');
  }
  for (const [k, v] of entries) {
    if (!/^\d+$/.test(k) || typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      throw new Error('Invalid entry in snapshot paintedRegionColors');
    }
  }
}

export function assertValidSavedSnapshot(
  snap: unknown,
  options?: { strictV2?: boolean }
): asserts snap is SavedSnapshot {
  if (!snap || typeof snap !== 'object' || Array.isArray(snap)) {
    throw new Error('Invalid snapshot object');
  }
  const s = snap as Record<string, unknown>;
  assertValidSnapshotId(s.id);
  if (typeof s.title !== 'string' || s.title.trim().length === 0 || s.title.length > 512) {
    throw new Error('Invalid snapshot title');
  }
  if (options?.strictV2) {
    assertValidSnapshotStrictV2Fields(s);
  }
  assertValidSnapshotFilledRegionIds(s.filledRegionIds);
  assertValidSnapshotNumericFields(s);
  if (s.sampleAssetPath !== undefined && s.sampleAssetPath !== null && s.sampleAssetPath !== '') {
    if (!isAllowedSampleAssetPath(s.sampleAssetPath)) {
      throw new Error('Invalid snapshot sampleAssetPath');
    }
  }
  if (s.sourceRef !== undefined) {
    assertValidSourceRef(s.sourceRef);
  }
  if (s.customPalette !== undefined) {
    assertValidPalette(s.customPalette);
  }
  assertValidSnapshotPaintedRegionColors(s.paintedRegionColors);
  if (s.previewDataUrl !== undefined && s.previewDataUrl !== '') {
    if (!isSafeSnapshotPreviewDataUrl(s.previewDataUrl)) {
      throw new Error('Invalid snapshot previewDataUrl');
    }
  }
  validateSnapshotZoomFields(s);
}

function validateRegionMetaFloat32(regionMeta: Float32Array, maxAllowedRegionId: number): number {
  if (!(regionMeta instanceof Float32Array) || regionMeta.length % REGION_META_STRIDE !== 0) {
    throw new Error('Invalid regionMeta Float32Array in compact puzzle record');
  }
  const regionCount = Math.floor(regionMeta.length / REGION_META_STRIDE);
  if (regionCount > maxAllowedRegionId) {
    throw new Error(`Puzzle region count (${regionCount}) exceeds limit`);
  }
  let maxRegionId = 0;
  for (let i = 0; i < regionCount; i++) {
    const base = i * REGION_META_STRIDE;
    const rawRid = regionMeta[base];
    const rawColorId = regionMeta[base + 1];
    const centroidX = regionMeta[base + 2];
    const centroidY = regionMeta[base + 3];
    const maxRadius = regionMeta[base + 4];
    if (
      !Number.isFinite(rawRid) ||
      rawRid < 0 ||
      !Number.isFinite(rawColorId) ||
      rawColorId < 0 ||
      !Number.isFinite(centroidX) ||
      !Number.isFinite(centroidY) ||
      !Number.isFinite(maxRadius) ||
      maxRadius < 0
    ) {
      throw new Error('Invalid non-finite or negative region metadata in compact puzzle record');
    }
    const rid = Math.round(rawRid);
    if (rid > maxAllowedRegionId) {
      throw new Error(`Region ID (${rid}) exceeds limit (${maxAllowedRegionId})`);
    }
    if (rid > maxRegionId) maxRegionId = rid;
  }
  return maxRegionId;
}

function scanRegionStatsAndBorders(
  width: number,
  height: number,
  regionMap: Int32Array,
  idToIndex: Int32Array,
  maxRegionId: number,
  regionCount: number
): {
  areas: Int32Array;
  minXs: Int32Array;
  maxXs: Int32Array;
  minYs: Int32Array;
  maxYs: Int32Array;
  borderMap: Uint8Array;
} {
  const areas = new Int32Array(regionCount);
  const minXs = new Int32Array(regionCount).fill(width);
  const maxXs = new Int32Array(regionCount).fill(0);
  const minYs = new Int32Array(regionCount).fill(height);
  const maxYs = new Int32Array(regionCount).fill(0);
  const borderMap = new Uint8Array(width * height);

  // Pass 1: Compute per-region pixel counts, bounding boxes, and 1px hairline borderMap
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      const idx = rowOffset + x;
      const rid = regionMap[idx];

      if (
        (x < width - 1 && regionMap[idx + 1] !== rid) ||
        (y < height - 1 && regionMap[idx + width] !== rid)
      ) {
        borderMap[idx] = 1;
      }

      if (rid > 0 && rid <= maxRegionId) {
        const rIdx = idToIndex[rid];
        if (rIdx >= 0) {
          areas[rIdx]++;
          if (x < minXs[rIdx]) minXs[rIdx] = x;
          if (x > maxXs[rIdx]) maxXs[rIdx] = x;
          if (y < minYs[rIdx]) minYs[rIdx] = y;
          if (y > maxYs[rIdx]) maxYs[rIdx] = y;
        }
      }
    }
  }

  return { areas, minXs, maxXs, minYs, maxYs, borderMap };
}

function populateRegionPixelArrays(
  regionMap: Int32Array,
  idToIndex: Int32Array,
  maxRegionId: number,
  areas: Int32Array
): Int32Array[] {
  const regionCount = areas.length;
  const pixelArrays: Int32Array[] = [];
  for (let i = 0; i < regionCount; i++) {
    pixelArrays.push(new Int32Array(areas[i]));
  }
  const writeOffsets = new Int32Array(regionCount);
  const total = regionMap.length;

  // Pass 2: Populate scanline-ordered `Int32Array` pixel lists for each region
  for (let idx = 0; idx < total; idx++) {
    const rid = regionMap[idx];
    if (rid > 0 && rid <= maxRegionId) {
      const rIdx = idToIndex[rid];
      if (rIdx >= 0) {
        pixelArrays[rIdx][writeOffsets[rIdx]++] = idx;
      }
    }
  }
  return pixelArrays;
}

function reconstructRegionsAndBorderMap(
  width: number,
  height: number,
  regionMeta: Float32Array,
  rleRegionMap: Uint8Array
): { regions: Region[]; regionMap: Int32Array; borderMap: Uint8Array } {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('Invalid puzzle dimensions');
  }
  const total = width * height;
  if (!Number.isSafeInteger(total) || total <= 0 || total > MAX_PUZZLE_PIXELS) {
    throw new Error(`Puzzle pixel count (${total}) exceeds limit (${MAX_PUZZLE_PIXELS})`);
  }

  const maxAllowedRegionId = Math.max(total, MAX_DELTA_REGION_ENTRIES);
  const maxRegionId = validateRegionMetaFloat32(regionMeta, maxAllowedRegionId);
  const regionCount = Math.floor(regionMeta.length / REGION_META_STRIDE);

  const regionMap = decodeRegionMapRle(rleRegionMap, total);
  if (regionMap.length !== total) {
    throw new Error('Decoded regionMap length mismatch');
  }

  // Map regionId -> region array index (0..regionCount-1), or -1 if absent
  const idToIndex = new Int32Array(maxRegionId + 1);
  idToIndex.fill(-1);
  for (let i = 0; i < regionCount; i++) {
    const rid = Math.round(regionMeta[i * REGION_META_STRIDE]);
    if (rid >= 0 && rid <= maxRegionId) {
      idToIndex[rid] = i;
    }
  }

  const { areas, minXs, maxXs, minYs, maxYs, borderMap } = scanRegionStatsAndBorders(
    width,
    height,
    regionMap,
    idToIndex,
    maxRegionId,
    regionCount
  );
  const pixelArrays = populateRegionPixelArrays(regionMap, idToIndex, maxRegionId, areas);

  const regions: Region[] = [];
  for (let i = 0; i < regionCount; i++) {
    const base = i * REGION_META_STRIDE;
    const area = areas[i];
    regions.push({
      id: Math.round(regionMeta[base]),
      colorId: Math.round(regionMeta[base + 1]),
      centroidX: regionMeta[base + 2],
      centroidY: regionMeta[base + 3],
      area,
      minX: area > 0 ? minXs[i] : 0,
      maxX: area > 0 ? maxXs[i] : 0,
      minY: area > 0 ? minYs[i] : 0,
      maxY: area > 0 ? maxYs[i] : 0,
      maxRadius: regionMeta[base + 4],
      pixels: pixelArrays[i],
    });
  }

  return { regions, regionMap, borderMap };
}

/**
 * Reconstructs full `PuzzleData` (`regionMap`, `borderMap`, `regions` with bounding boxes and `pixels`,
 * plus any `nestedLayers`) from a `CompactPuzzleRecordV2` in two zero-allocation linear passes (< 3 ms on 1024x1024).
 */
export function decompressPuzzleRecord(record: CompactPuzzleRecordV2): PuzzleData {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('Invalid compact puzzle record');
  }
  const { width, height, palette, regionMeta, rleRegionMap, isFreeColor } = record;
  assertValidPalette(palette);
  if (isFreeColor !== undefined && typeof isFreeColor !== 'boolean') {
    throw new Error('Invalid isFreeColor flag in compact puzzle record');
  }

  const root = reconstructRegionsAndBorderMap(width, height, regionMeta, rleRegionMap);

  let nestedLayers: NestedPuzzleLayer[] | undefined;
  if (record.nestedLayers !== undefined) {
    if (!Array.isArray(record.nestedLayers) || record.nestedLayers.length > MAX_NESTED_LAYERS) {
      throw new Error(`Invalid nestedLayers array (max ${MAX_NESTED_LAYERS})`);
    }
    if (record.nestedLayers.length > 0) {
      const seenLayerIds = new Set<string>();
      nestedLayers = record.nestedLayers.map((layer) => {
        if (!layer || typeof layer !== 'object' || Array.isArray(layer)) {
          throw new Error('Invalid nested layer entry in compact puzzle record');
        }
        assertSafeLayerKey(layer.layerId, 'layerId');
        if (seenLayerIds.has(layer.layerId)) {
          throw new Error(`Duplicate nested layerId "${layer.layerId}"`);
        }
        seenLayerIds.add(layer.layerId);
        assertSafeLayerImageKey(layer.imageBlobKey, 'imageBlobKey');
        if (!Number.isInteger(layer.depth) || layer.depth < 1 || layer.depth > MAX_ZOOM_DEPTH) {
          throw new Error(`Invalid nested layer depth (${String(layer.depth)})`);
        }
        assertValidWorldBounds(layer.worldBounds, 'nested layer worldBounds');
        const opt = sanitizeNestedLayerOptionalFields(layer);
        const decodedLayer = reconstructRegionsAndBorderMap(
          layer.width,
          layer.height,
          layer.regionMeta,
          layer.rleRegionMap
        );
        return {
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
          regions: decodedLayer.regions,
          regionMap: decodedLayer.regionMap,
          borderMap: decodedLayer.borderMap,
          imageBlobKey: layer.imageBlobKey,
          ...opt,
        };
      });
    }
  }

  const maxZoomDepth = validateMaxZoomDepth(record.maxZoomDepth);

  return {
    width,
    height,
    palette,
    regions: root.regions,
    regionMap: root.regionMap,
    borderMap: root.borderMap,
    ...(isFreeColor !== undefined ? { isFreeColor } : {}),
    ...(nestedLayers ? { nestedLayers } : {}),
    ...(maxZoomDepth !== undefined ? { maxZoomDepth } : {}),
  };
}

// ---------------------------------------------------------------------------
// Binary Framing & Gzip Stream Helpers for `.capy` v2 Portable Files
// ---------------------------------------------------------------------------

async function gzipCompress(data: Uint8Array): Promise<{ bytes: Uint8Array; compressed: boolean }> {
  if (typeof CompressionStream === 'undefined') {
    return { bytes: data, compressed: false };
  }
  try {
    const stream = new Blob([new Uint8Array(data)])
      .stream()
      .pipeThrough(new CompressionStream('gzip'));
    const buf = await new Response(stream).arrayBuffer();
    return { bytes: new Uint8Array(buf), compressed: true };
  } catch {
    return { bytes: data, compressed: false };
  }
}

async function gzipDecompress(
  data: Uint8Array,
  maxOutputBytes: number = MAX_BINARY_SAVE_DECOMPRESSED_BYTES
): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream is not supported in this environment');
  }
  const stream = new Blob([new Uint8Array(data)])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        totalBytes += value.byteLength;
        if (totalBytes > maxOutputBytes) {
          await reader.cancel('Decompressed payload exceeds byte limit').catch(() => {});
          throw new Error(`Decompressed gzip payload exceeds limit of ${maxOutputBytes} bytes`);
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (chunks.length === 1) {
    return chunks[0];
  }
  const out = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Simple framed binary table `[uint32 jsonByteLen][jsonBytes][concatenatedBlobChunks...]`
 * so binary typed arrays (`rleRegionMap`, `regionMeta`, optional source WebP) are stored raw
 * inside the Gzip stream without 33% Base64 inflation.
 */
interface BinaryChunkRef {
  __chunkIdx: number;
  byteLength: number;
}

function packFramedPayload(root: unknown): Uint8Array {
  const chunks: Uint8Array[] = [];

  const jsonText = JSON.stringify(root, (_key, value) => {
    if (value instanceof Uint8Array) {
      const idx = chunks.length;
      if (idx >= MAX_FRAMED_BINARY_CHUNKS) {
        throw new Error(
          `Capy binary payload exceeds maximum chunk count of ${MAX_FRAMED_BINARY_CHUNKS}`
        );
      }
      chunks.push(value);
      return { __chunkIdx: idx, byteLength: value.byteLength } satisfies BinaryChunkRef;
    }
    return value;
  });

  const jsonBytes = new TextEncoder().encode(jsonText);
  let totalChunkBytes = 0;
  for (const c of chunks) totalChunkBytes += c.byteLength;

  const out = new Uint8Array(4 + jsonBytes.byteLength + totalChunkBytes);
  const view = new DataView(out.buffer);
  view.setUint32(0, jsonBytes.byteLength, true);
  out.set(jsonBytes, 4);

  let offset = 4 + jsonBytes.byteLength;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }

  return out;
}

function unpackFramedPayload<T>(packed: Uint8Array): T {
  if (packed.byteLength < 4) {
    throw new Error('Malformed framed payload: truncated header');
  }
  const view = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
  const jsonByteLen = view.getUint32(0, true);
  if (jsonByteLen > packed.byteLength - 4) {
    throw new Error('Malformed framed payload: JSON header exceeds payload');
  }
  const jsonBytes = packed.subarray(4, 4 + jsonByteLen);
  const jsonText = new TextDecoder().decode(jsonBytes);

  const chunkSliceStart = 4 + jsonByteLen;
  const maxChunkBytes = packed.byteLength - chunkSliceStart;
  const parsed = JSON.parse(jsonText);

  // Collect chunks in index order by walking the parsed tree once to compute offsets
  const chunkLengths: number[] = [];
  const collect = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (node.__chunkIdx !== undefined || node.byteLength !== undefined) {
      if (typeof node.__chunkIdx === 'number' && typeof node.byteLength === 'number') {
        if (
          !Number.isInteger(node.__chunkIdx) ||
          node.__chunkIdx < 0 ||
          node.__chunkIdx >= MAX_FRAMED_BINARY_CHUNKS ||
          !Number.isInteger(node.byteLength) ||
          node.byteLength < 0 ||
          node.byteLength > maxChunkBytes
        ) {
          throw new Error('Malformed framed payload: invalid binary chunk descriptor');
        }
        if (chunkLengths[node.__chunkIdx] !== undefined) {
          throw new Error('Malformed framed payload: duplicate binary chunk index');
        }
        chunkLengths[node.__chunkIdx] = node.byteLength;
        return;
      }
    }
    if (Array.isArray(node)) {
      for (const item of node) collect(item);
    } else {
      for (const k of Object.keys(node)) collect(node[k]);
    }
  };
  collect(parsed);

  const chunkSlices: Uint8Array[] = [];
  let cursor = chunkSliceStart;
  for (let i = 0; i < chunkLengths.length; i++) {
    const len = chunkLengths[i];
    if (len === undefined || len < 0 || cursor + len > packed.byteLength) {
      throw new Error('Malformed framed payload: binary chunk exceeds bounds');
    }
    chunkSlices[i] = packed.slice(cursor, cursor + len);
    cursor += len;
  }

  const hydrate = (node: any): any => {
    if (!node || typeof node !== 'object') return node;
    if (typeof node.__chunkIdx === 'number' && typeof node.byteLength === 'number') {
      return chunkSlices[node.__chunkIdx] || new Uint8Array(0);
    }
    if (Array.isArray(node)) {
      return node.map(hydrate);
    }
    const result: Record<string, any> = {};
    for (const k of Object.keys(node)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      result[k] = hydrate(node[k]);
    }
    return result;
  };

  return hydrate(parsed) as T;
}

function nestedLayerToSerializable(
  layer: CompactNestedLayerRecordV2
): SerializedCompactNestedLayerV2 {
  assertSafeLayerKey(layer.layerId, 'layerId');
  assertSafeLayerImageKey(layer.imageBlobKey, 'imageBlobKey');
  const regionMetaBytes = new Uint8Array(
    layer.regionMeta.buffer,
    layer.regionMeta.byteOffset,
    layer.regionMeta.byteLength
  ).slice();
  const opt = sanitizeNestedLayerOptionalFields(layer);
  return {
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
    regionMetaBytes,
    rleRegionMap: layer.rleRegionMap,
    imageBlobKey: layer.imageBlobKey,
    ...opt,
  };
}

function serializableToNestedLayer(
  ser: SerializedCompactNestedLayerV2
): CompactNestedLayerRecordV2 {
  if (!ser || typeof ser !== 'object' || Array.isArray(ser)) {
    throw new Error('Malformed serialized nested layer payload');
  }
  assertSafeLayerKey(ser.layerId, 'layerId');
  assertSafeLayerImageKey(ser.imageBlobKey, 'imageBlobKey');
  if (!Number.isInteger(ser.depth) || ser.depth < 1 || ser.depth > MAX_ZOOM_DEPTH) {
    throw new Error(`Invalid serialized nested layer depth (${String(ser.depth)})`);
  }
  assertValidWorldBounds(ser.worldBounds, 'serialized nested layer worldBounds');
  if (
    !Number.isInteger(ser.width) ||
    !Number.isInteger(ser.height) ||
    ser.width <= 0 ||
    ser.height <= 0
  ) {
    throw new Error('Invalid serialized nested layer dimensions');
  }
  const total = ser.width * ser.height;
  if (!Number.isSafeInteger(total) || total <= 0 || total > MAX_PUZZLE_PIXELS) {
    throw new Error(`Nested layer pixel count (${total}) exceeds limit (${MAX_PUZZLE_PIXELS})`);
  }
  if (!(ser.rleRegionMap instanceof Uint8Array) || ser.rleRegionMap.byteLength === 0) {
    throw new Error('Invalid or empty rleRegionMap in serialized nested layer');
  }
  if (
    !(ser.regionMetaBytes instanceof Uint8Array) ||
    ser.regionMetaBytes.byteLength % (REGION_META_STRIDE * 4) !== 0
  ) {
    throw new Error('Malformed serialized nested layer regionMetaBytes');
  }
  const alignedBuf = ser.regionMetaBytes.slice().buffer;
  const regionMeta = new Float32Array(alignedBuf);
  validateRegionMetaFloat32(regionMeta, Math.max(total, MAX_DELTA_REGION_ENTRIES));
  const opt = sanitizeNestedLayerOptionalFields(ser);
  return {
    layerId: ser.layerId,
    depth: ser.depth,
    worldBounds: {
      x: ser.worldBounds.x,
      y: ser.worldBounds.y,
      width: ser.worldBounds.width,
      height: ser.worldBounds.height,
    },
    width: ser.width,
    height: ser.height,
    regionMeta,
    rleRegionMap: ser.rleRegionMap,
    imageBlobKey: ser.imageBlobKey,
    ...opt,
  };
}

function recordToSerializable(rec: CompactPuzzleRecordV2): SerializedCompactPuzzleV2 {
  const metaBytes = new Uint8Array(
    rec.regionMeta.buffer,
    rec.regionMeta.byteOffset,
    rec.regionMeta.byteLength
  ).slice();
  const nestedLayers =
    Array.isArray(rec.nestedLayers) && rec.nestedLayers.length > 0
      ? rec.nestedLayers.map(nestedLayerToSerializable)
      : undefined;
  const maxZoomDepth = validateMaxZoomDepth(rec.maxZoomDepth);
  return {
    width: rec.width,
    height: rec.height,
    ...(rec.isFreeColor !== undefined ? { isFreeColor: rec.isFreeColor } : {}),
    palette: rec.palette,
    regionMetaBytes: metaBytes,
    rleRegionMap: rec.rleRegionMap,
    ...(nestedLayers ? { nestedLayers } : {}),
    ...(maxZoomDepth !== undefined ? { maxZoomDepth } : {}),
  };
}

export function serializableToRecord(ser: SerializedCompactPuzzleV2): CompactPuzzleRecordV2 {
  if (!ser || typeof ser !== 'object' || Array.isArray(ser)) {
    throw new Error('Malformed compact puzzle payload');
  }
  if (
    !Number.isInteger(ser.width) ||
    !Number.isInteger(ser.height) ||
    ser.width <= 0 ||
    ser.height <= 0
  ) {
    throw new Error('Invalid compact puzzle dimensions');
  }
  const total = ser.width * ser.height;
  if (!Number.isSafeInteger(total) || total <= 0 || total > MAX_PUZZLE_PIXELS) {
    throw new Error(`Puzzle pixel count (${total}) exceeds limit (${MAX_PUZZLE_PIXELS})`);
  }
  assertValidPalette(ser.palette);
  if (ser.isFreeColor !== undefined && typeof ser.isFreeColor !== 'boolean') {
    throw new Error('Invalid isFreeColor flag in compact puzzle');
  }
  if (!(ser.rleRegionMap instanceof Uint8Array) || ser.rleRegionMap.byteLength === 0) {
    throw new Error('Invalid or empty rleRegionMap in compact puzzle');
  }
  if (
    !(ser.regionMetaBytes instanceof Uint8Array) ||
    ser.regionMetaBytes.byteLength % (REGION_META_STRIDE * 4) !== 0
  ) {
    throw new Error('Malformed compact puzzle regionMetaBytes');
  }
  const alignedBuf = ser.regionMetaBytes.slice().buffer;
  const regionMeta = new Float32Array(alignedBuf);
  validateRegionMetaFloat32(regionMeta, Math.max(total, MAX_DELTA_REGION_ENTRIES));

  let nestedLayers: CompactNestedLayerRecordV2[] | undefined;
  if (ser.nestedLayers !== undefined) {
    if (!Array.isArray(ser.nestedLayers) || ser.nestedLayers.length > MAX_NESTED_LAYERS) {
      throw new Error(`Invalid serialized nestedLayers array (max ${MAX_NESTED_LAYERS})`);
    }
    if (ser.nestedLayers.length > 0) {
      const seenLayerIds = new Set<string>();
      nestedLayers = ser.nestedLayers.map((serLayer) => {
        const layer = serializableToNestedLayer(serLayer);
        if (seenLayerIds.has(layer.layerId)) {
          throw new Error(`Duplicate nested layerId "${layer.layerId}"`);
        }
        seenLayerIds.add(layer.layerId);
        return layer;
      });
    }
  }
  const maxZoomDepth = validateMaxZoomDepth(ser.maxZoomDepth);

  return {
    __capyCompactV2: 2,
    width: ser.width,
    height: ser.height,
    ...(ser.isFreeColor !== undefined ? { isFreeColor: ser.isFreeColor } : {}),
    palette: ser.palette,
    regionMeta,
    rleRegionMap: ser.rleRegionMap,
    ...(nestedLayers ? { nestedLayers } : {}),
    ...(maxZoomDepth !== undefined ? { maxZoomDepth } : {}),
  };
}

export function hasBinaryMagicHeader(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 6 &&
    bytes[0] === MAGIC_BYTES[0] &&
    bytes[1] === MAGIC_BYTES[1] &&
    bytes[2] === MAGIC_BYTES[2] &&
    bytes[3] === MAGIC_BYTES[3]
  );
}

async function encodeLayerImageBlobsMap(
  layerImageBlobs?: Record<string, Blob>
): Promise<Record<string, { mimeType: string; bytes: Uint8Array }> | undefined> {
  if (!layerImageBlobs) return undefined;
  const encoded: Record<string, { mimeType: string; bytes: Uint8Array }> = {};
  for (const [key, blob] of Object.entries(layerImageBlobs)) {
    if (!blob) continue;
    assertSafeLayerImageKey(key, 'layerImageBlobs key');
    const rawType =
      typeof blob.type === 'string' ? blob.type.trim().toLowerCase().split(';')[0].trim() : '';
    const normalizedMime = rawType === 'image/jpg' ? 'image/jpeg' : rawType;
    let mimeType = 'image/webp';
    if (normalizedMime.length > 0) {
      if (!ALLOWED_LAYER_IMAGE_MIMES.has(normalizedMime)) {
        throw new Error(
          `Unsupported MIME type "${normalizedMime}" in layerImageBlobs for key "${key}"`
        );
      }
      mimeType = normalizedMime;
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.byteLength > 0) {
      encoded[key] = { mimeType, bytes };
    }
  }
  return Object.keys(encoded).length > 0 ? encoded : undefined;
}

/**
 * Encodes a single save (snapshot + compact puzzle + optional custom source image blob + optional nested layer blobs) into a `.capy` v2 binary buffer.
 */
export async function encodeSingleSaveBinaryV2(
  snapshot: SavedSnapshot,
  compactRecord: CompactPuzzleRecordV2 | null,
  imageBlob?: Blob | null,
  options?: { exportDate?: number; layerImageBlobs?: Record<string, Blob> }
): Promise<Uint8Array> {
  let imageBytes: Uint8Array | undefined;
  let imageMimeType: string | undefined;
  if (imageBlob) {
    imageBytes = new Uint8Array(await imageBlob.arrayBuffer());
    imageMimeType = imageBlob.type || 'image/webp';
  }
  const layerImages = await encodeLayerImageBlobsMap(options?.layerImageBlobs);

  const resolvedExportDate =
    typeof options?.exportDate === 'number' && Number.isFinite(options.exportDate)
      ? options.exportDate
      : Date.now();

  const payload: SingleSavePayloadV2 = {
    format: 'capy-single-save-v2',
    version: 2,
    exportDate: resolvedExportDate,
    snapshot,
    compactPuzzle: compactRecord ? recordToSerializable(compactRecord) : null,
    ...(imageBytes ? { imageBytes, imageMimeType } : {}),
    ...(layerImages ? { layerImages } : {}),
  };

  const framed = packFramedPayload(payload);
  if (framed.byteLength > MAX_BINARY_SAVE_DECOMPRESSED_BYTES) {
    throw new Error(
      `Capy single save payload exceeds limit of ${MAX_BINARY_SAVE_DECOMPRESSED_BYTES} bytes`
    );
  }
  const { bytes: body, compressed } = await gzipCompress(framed);
  const flags = compressed ? FLAG_GZIP : 0;

  const out = new Uint8Array(6 + body.byteLength);
  out.set(MAGIC_BYTES, 0);
  out[4] = BINARY_VERSION_V2;
  out[5] = flags;
  out.set(body, 6);
  return out;
}

/**
 * Encodes a multi-save archive into a `.capy` v2 binary buffer.
 */
export async function encodeArchiveSaveBinaryV2(
  snapshots: SavedSnapshot[],
  compactRecords: Record<string, CompactPuzzleRecordV2>,
  imageBlobs?: Record<string, Blob>,
  options?: { exportDate?: number; layerImageBlobs?: Record<string, Blob> }
): Promise<Uint8Array> {
  const compactPuzzles: Record<string, SerializedCompactPuzzleV2> = {};
  for (const [id, rec] of Object.entries(compactRecords)) {
    compactPuzzles[id] = recordToSerializable(rec);
  }

  const images: Record<string, { mimeType: string; bytes: Uint8Array }> = {};
  if (imageBlobs) {
    for (const [id, blob] of Object.entries(imageBlobs)) {
      images[id] = {
        mimeType: blob.type || 'image/webp',
        bytes: new Uint8Array(await blob.arrayBuffer()),
      };
    }
  }
  const layerImages = await encodeLayerImageBlobsMap(options?.layerImageBlobs);

  const resolvedExportDate =
    typeof options?.exportDate === 'number' && Number.isFinite(options.exportDate)
      ? options.exportDate
      : Date.now();

  const payload: ArchiveSavePayloadV2 = {
    format: 'capy-archive-save-v2',
    version: 2,
    exportDate: resolvedExportDate,
    snapshots,
    compactPuzzles,
    ...(Object.keys(images).length > 0 ? { images } : {}),
    ...(layerImages ? { layerImages } : {}),
  };

  const framed = packFramedPayload(payload);
  if (framed.byteLength > MAX_BINARY_ARCHIVE_DECOMPRESSED_BYTES) {
    throw new Error(
      `Capy archive payload exceeds limit of ${MAX_BINARY_ARCHIVE_DECOMPRESSED_BYTES} bytes`
    );
  }
  const { bytes: body, compressed } = await gzipCompress(framed);
  const flags = (compressed ? FLAG_GZIP : 0) | FLAG_ARCHIVE;

  const out = new Uint8Array(6 + body.byteLength);
  out.set(MAGIC_BYTES, 0);
  out[4] = BINARY_VERSION_V2;
  out[5] = flags;
  out.set(body, 6);
  return out;
}

function normalizeAllowedTopLevelImageMimeV2(rawMime: unknown, context: string): string {
  if (typeof rawMime !== 'string') {
    throw new Error(`Invalid ${context}`);
  }
  const cleaned = rawMime.trim().toLowerCase().split(';')[0].trim();
  const normalized = cleaned === 'image/jpg' ? 'image/jpeg' : cleaned;
  if (!ALLOWED_LAYER_IMAGE_MIMES.has(normalized)) {
    throw new Error(`Unsupported MIME type "${normalized}" in ${context}`);
  }
  return normalized;
}

function validateSingleSavePayloadV2(
  payload: Record<string, unknown>,
  isArchive: boolean,
  framedByteLength: number
): SingleSavePayloadV2 {
  if (isArchive || framedByteLength > MAX_BINARY_SAVE_DECOMPRESSED_BYTES) {
    throw new Error('Single save payload cannot use archive flag or exceed single-save size limit');
  }
  assertValidSavedSnapshot(payload.snapshot, { strictV2: true });
  if (payload.compactPuzzle !== null) {
    serializableToRecord(payload.compactPuzzle as SerializedCompactPuzzleV2);
  }
  if (payload.imageBytes !== undefined && !(payload.imageBytes instanceof Uint8Array)) {
    throw new Error('Invalid Capy v2 binary imageBytes');
  }
  if (payload.imageMimeType !== undefined) {
    payload.imageMimeType = normalizeAllowedTopLevelImageMimeV2(
      payload.imageMimeType,
      'Capy v2 binary imageMimeType'
    );
  }
  if (payload.layerImages !== undefined) {
    assertValidLayerImagesMap(payload.layerImages);
  }
  return payload as unknown as SingleSavePayloadV2;
}

function validateArchiveImagesMapV2(rawImages: unknown): void {
  if (!rawImages || typeof rawImages !== 'object' || Array.isArray(rawImages)) {
    throw new Error('Invalid Capy v2 archive images map');
  }
  for (const [key, imgEntry] of Object.entries(rawImages as Record<string, unknown>)) {
    if (FORBIDDEN_LAYER_MAP_KEYS.has(key)) {
      throw new Error(`Forbidden image key "${key}" in Capy v2 archive`);
    }
    if (
      !imgEntry ||
      typeof imgEntry !== 'object' ||
      Array.isArray(imgEntry) ||
      !((imgEntry as { bytes?: unknown }).bytes instanceof Uint8Array) ||
      typeof (imgEntry as { mimeType?: unknown }).mimeType !== 'string'
    ) {
      throw new Error('Invalid image entry in Capy v2 archive');
    }
    (imgEntry as { mimeType: string }).mimeType = normalizeAllowedTopLevelImageMimeV2(
      (imgEntry as { mimeType: string }).mimeType,
      `Capy v2 archive image "${key}"`
    );
  }
}

function validateArchiveSavePayloadV2(
  payload: Record<string, unknown>,
  isArchive: boolean
): ArchiveSavePayloadV2 {
  if (!isArchive) {
    throw new Error('Archive save payload is missing required archive header flag');
  }
  if (!Array.isArray(payload.snapshots)) {
    throw new Error('Invalid Capy v2 archive snapshots list');
  }
  for (let i = 0; i < payload.snapshots.length; i++) {
    assertValidSavedSnapshot(payload.snapshots[i], { strictV2: true });
  }
  if (
    !payload.compactPuzzles ||
    typeof payload.compactPuzzles !== 'object' ||
    Array.isArray(payload.compactPuzzles)
  ) {
    throw new Error('Invalid Capy v2 archive compactPuzzles map');
  }
  for (const comp of Object.values(payload.compactPuzzles as Record<string, unknown>)) {
    serializableToRecord(comp as SerializedCompactPuzzleV2);
  }
  if (payload.images !== undefined) {
    validateArchiveImagesMapV2(payload.images);
  }
  if (payload.layerImages !== undefined) {
    assertValidLayerImagesMap(payload.layerImages);
  }
  return payload as unknown as ArchiveSavePayloadV2;
}

/**
 * Decodes a `.capy` v2 binary buffer into either a single-save or archive-save payload.
 */
export async function decodeBinarySaveV2(
  bytes: Uint8Array
): Promise<SingleSavePayloadV2 | ArchiveSavePayloadV2> {
  if (!hasBinaryMagicHeader(bytes)) {
    throw new Error('Invalid Capy binary header');
  }
  const version = bytes[4];
  if (version !== BINARY_VERSION_V2) {
    throw new Error(`Unsupported Capy save binary version: ${version}`);
  }
  const flags = bytes[5];
  const isArchive = (flags & FLAG_ARCHIVE) !== 0;
  const maxDecompressedBytes = isArchive
    ? MAX_BINARY_ARCHIVE_DECOMPRESSED_BYTES
    : MAX_BINARY_SAVE_DECOMPRESSED_BYTES;
  const rawBody = bytes.subarray(6);
  if ((flags & FLAG_GZIP) === 0 && rawBody.byteLength > maxDecompressedBytes) {
    throw new Error('Uncompressed Capy binary payload exceeds size limit');
  }
  const framed =
    (flags & FLAG_GZIP) !== 0
      ? await gzipDecompress(rawBody, maxDecompressedBytes)
      : rawBody;
  const decoded = unpackFramedPayload<unknown>(framed);
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
    throw new Error('Malformed Capy v2 binary payload');
  }
  const payload = decoded as Record<string, unknown>;
  if (payload.version !== BINARY_VERSION_V2) {
    throw new Error('Invalid Capy v2 binary payload version');
  }
  if (typeof payload.exportDate !== 'number' || !Number.isFinite(payload.exportDate)) {
    throw new Error('Invalid Capy v2 binary exportDate');
  }

  if (payload.format === 'capy-single-save-v2') {
    return validateSingleSavePayloadV2(payload, isArchive, framed.byteLength);
  }
  if (payload.format === 'capy-archive-save-v2') {
    return validateArchiveSavePayloadV2(payload, isArchive);
  }

  throw new Error('Invalid or unrecognized Capy v2 binary format');
}

// ---------------------------------------------------------------------------
// Ultra-Compact Progress Delta (< 2 KB) & CRDT Conflict-Free Merge
// ---------------------------------------------------------------------------

export function buildBorderMapFromRegionMap(
  regionMap: Int32Array,
  width: number,
  height: number
): Uint8Array {
  const borderMap = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const yRow = y * width;
    for (let x = 0; x < width; x++) {
      const idx = yRow + x;
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

function bytesToBase64Url(bytes: Uint8Array): string {
  return uint8ToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(token: string): Uint8Array {
  const padded = token.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  return base64ToUint8(padded + '='.repeat(padLen));
}

/**
 * Encodes completion progress into a URL-safe token (< 2 KB) for shareable links and cloud delta sync.
 */
export async function encodeProgressDeltaToken(delta: ProgressDeltaV2): Promise<string> {
  const out: number[] = [2]; // version 2
  const normalizedResetEpoch =
    typeof delta.resetEpoch === 'number' &&
    Number.isFinite(delta.resetEpoch) &&
    delta.resetEpoch > 0
      ? Math.min(MAX_DELTA_RESET_EPOCH, Math.floor(delta.resetEpoch))
      : 0;
  const flags =
    (delta.isFreeColor ? 1 : 0) |
    (delta.paintedRegionColors && Object.keys(delta.paintedRegionColors).length > 0 ? 2 : 0) |
    (delta.sourceRef ? 4 : 0) |
    (normalizedResetEpoch > 0 ? 8 : 0);
  out.push(flags);

  writeVarint(out, Math.floor(delta.updatedAt / 1000));

  if (delta.sourceRef) {
    const refBytes = new TextEncoder().encode(JSON.stringify(delta.sourceRef));
    writeVarint(out, refBytes.byteLength);
    for (let i = 0; i < refBytes.byteLength; i++) out.push(refBytes[i]);
  }

  writeVarint(out, delta.filledRegionIds.length);
  for (let i = 0; i < delta.filledRegionIds.length; i++) {
    writeVarint(out, delta.filledRegionIds[i]);
  }

  if (flags & 2) {
    const entries = Object.entries(delta.paintedRegionColors!);
    writeVarint(out, entries.length);
    for (const [ridStr, argb] of entries) {
      writeVarint(out, Number(ridStr));
      const u32 = argb >>> 0;
      out.push(u32 & 0xff, (u32 >>> 8) & 0xff, (u32 >>> 16) & 0xff, (u32 >>> 24) & 0xff);
    }
  }

  if (flags & 8) {
    writeVarint(out, normalizedResetEpoch);
  }

  const raw = new Uint8Array(out);
  const { bytes: gz, compressed } = await gzipCompress(raw);
  const useGzip = compressed && gz.byteLength + 1 < raw.byteLength;
  const envelope = new Uint8Array(1 + (useGzip ? gz.byteLength : raw.byteLength));
  envelope[0] = useGzip ? 1 : 0;
  envelope.set(useGzip ? gz : raw, 1);
  return bytesToBase64Url(envelope);
}

function readDeltaSourceRef(raw: Uint8Array, cursor: { pos: number }): PuzzleSourceRef {
  const refLen = readVarint(raw, cursor);
  if (refLen > MAX_DELTA_SOURCE_REF_BYTES || cursor.pos + refLen > raw.byteLength) {
    throw new Error('Invalid progress delta sourceRef length');
  }
  const refText = new TextDecoder().decode(raw.subarray(cursor.pos, cursor.pos + refLen));
  cursor.pos += refLen;
  const parsedRef = JSON.parse(refText) as unknown;
  assertValidSourceRef(parsedRef);
  return {
    kind: parsedRef.kind,
    uri: parsedRef.uri,
    ...(parsedRef.contentHash !== undefined ? { contentHash: parsedRef.contentHash } : {}),
  };
}

function readDeltaPaintedRegionColors(
  raw: Uint8Array,
  cursor: { pos: number }
): Record<number, number> {
  const colorEntries = readVarint(raw, cursor);
  if (colorEntries > MAX_DELTA_REGION_ENTRIES || cursor.pos + colorEntries * 5 > raw.byteLength) {
    throw new Error(`Progress delta colorEntries (${colorEntries}) exceeds bounds`);
  }
  const paintedRegionColors: Record<number, number> = {};
  for (let i = 0; i < colorEntries; i++) {
    const rid = readVarint(raw, cursor);
    if (cursor.pos + 4 > raw.byteLength) {
      throw new Error('Truncated progress delta paintedRegionColors entry');
    }
    const b0 = raw[cursor.pos++];
    const b1 = raw[cursor.pos++];
    const b2 = raw[cursor.pos++];
    const b3 = raw[cursor.pos++];
    paintedRegionColors[rid] = ((b3 << 24) | (b2 << 16) | (b1 << 8) | b0) >>> 0;
  }
  return paintedRegionColors;
}

export async function decodeProgressDeltaToken(token: string): Promise<ProgressDeltaV2> {
  if (!token || typeof token !== 'string' || token.length > MAX_DELTA_DECOMPRESSED_BYTES * 2) {
    throw new Error('Invalid progress delta token');
  }
  const envelope = base64UrlToBytes(token);
  if (envelope.byteLength < 2 || (envelope[0] !== 0 && envelope[0] !== 1)) {
    throw new Error('Malformed progress delta envelope');
  }
  const isGz = envelope[0] === 1;
  const body = envelope.subarray(1);
  if (!isGz && body.byteLength > MAX_DELTA_DECOMPRESSED_BYTES) {
    throw new Error('Uncompressed progress delta exceeds size limit');
  }
  const raw = isGz ? await gzipDecompress(body, MAX_DELTA_DECOMPRESSED_BYTES) : body;
  if (raw.byteLength < 4) {
    throw new Error('Truncated progress delta payload');
  }

  const cursor = { pos: 0 };
  const version = raw[cursor.pos++];
  if (version !== 2) {
    throw new Error(`Unsupported progress delta version: ${version}`);
  }
  // Bits 0..2: freeColor, paintedColors, sourceRef; bit 3 (8): monotonic CRDT resetEpoch
  const flags = raw[cursor.pos++];
  const updatedAt = readVarint(raw, cursor) * 1000;
  const sourceRef = flags & 4 ? readDeltaSourceRef(raw, cursor) : undefined;

  const filledLen = readVarint(raw, cursor);
  if (filledLen > MAX_DELTA_REGION_ENTRIES || cursor.pos + filledLen > raw.byteLength) {
    throw new Error(`Progress delta filledLen (${filledLen}) exceeds bounds`);
  }
  const filledRegionIds: number[] = [];
  for (let i = 0; i < filledLen; i++) {
    filledRegionIds.push(readVarint(raw, cursor));
  }

  const paintedRegionColors = flags & 2 ? readDeltaPaintedRegionColors(raw, cursor) : undefined;

  let resetEpoch: number | undefined;
  if (flags & 8) {
    const decodedEpoch = readVarint(raw, cursor);
    if (decodedEpoch > MAX_DELTA_RESET_EPOCH) {
      throw new Error(`Progress delta resetEpoch (${decodedEpoch}) exceeds bounds`);
    }
    if (decodedEpoch > 0) {
      resetEpoch = decodedEpoch;
    }
  }

  return {
    version: 2,
    ...(sourceRef ? { sourceRef } : {}),
    filledRegionIds,
    ...(paintedRegionColors ? { paintedRegionColors } : {}),
    ...(flags & 1 ? { isFreeColor: true } : {}),
    ...(resetEpoch !== undefined ? { resetEpoch } : {}),
    updatedAt,
  };
}

function normalizeResetEpoch(rawEpoch?: number): number {
  if (typeof rawEpoch !== 'number' || !Number.isFinite(rawEpoch) || rawEpoch <= 0) {
    return 0;
  }
  return Math.min(MAX_DELTA_RESET_EPOCH, Math.floor(rawEpoch));
}

function cloneWinningEpochDelta(
  winner: ProgressDeltaV2,
  loser: ProgressDeltaV2,
  winningEpoch: number
): ProgressDeltaV2 {
  const colors =
    winner.paintedRegionColors && Object.keys(winner.paintedRegionColors).length > 0
      ? { ...winner.paintedRegionColors }
      : undefined;
  return {
    version: 2,
    sourceRef: winner.sourceRef || loser.sourceRef,
    filledRegionIds: [...winner.filledRegionIds],
    ...(colors ? { paintedRegionColors: colors } : {}),
    isFreeColor: Boolean(winner.isFreeColor ?? loser.isFreeColor),
    resetEpoch: winningEpoch,
    updatedAt: Math.max(winner.updatedAt, loser.updatedAt),
  };
}

/**
 * Conflict-free epoch-scoped Set-Union + LWW merge for cloud save sync and simultaneous Co-op recovery.
 * When `resetEpoch` differs, the higher monotonic epoch wins cleanly without resurrecting cleared regions.
 */
export function mergeProgressDeltas(
  local: ProgressDeltaV2,
  remote: ProgressDeltaV2
): ProgressDeltaV2 {
  const localEpoch = normalizeResetEpoch(local.resetEpoch);
  const remoteEpoch = normalizeResetEpoch(remote.resetEpoch);

  if (localEpoch > remoteEpoch) {
    return cloneWinningEpochDelta(local, remote, localEpoch);
  }
  if (remoteEpoch > localEpoch) {
    return cloneWinningEpochDelta(remote, local, remoteEpoch);
  }

  const seen = new Set<number>(local.filledRegionIds);
  const mergedFilled = [...local.filledRegionIds];
  for (const rid of remote.filledRegionIds) {
    if (!seen.has(rid)) {
      seen.add(rid);
      mergedFilled.push(rid);
    }
  }

  let mergedColors: Record<number, number> | undefined;
  if (local.paintedRegionColors || remote.paintedRegionColors) {
    mergedColors =
      remote.updatedAt >= local.updatedAt
        ? { ...local.paintedRegionColors, ...remote.paintedRegionColors }
        : { ...remote.paintedRegionColors, ...local.paintedRegionColors };
  }

  return {
    version: 2,
    sourceRef: local.sourceRef || remote.sourceRef,
    filledRegionIds: mergedFilled,
    ...(mergedColors ? { paintedRegionColors: mergedColors } : {}),
    isFreeColor: Boolean(local.isFreeColor || remote.isFreeColor),
    ...(localEpoch > 0 ? { resetEpoch: localEpoch } : {}),
    updatedAt: Math.max(local.updatedAt, remote.updatedAt),
  };
}
