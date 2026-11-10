import { PaletteColor, PuzzleData, SavedSnapshot, UserSettings } from '../types';
import { NativeBridge } from './NativeBridge';

const SETTINGS_KEY = 'capy_user_settings_v8';
const SNAPSHOTS_KEY = 'capy_snapshots_v8';
const ACTIVE_STATE_KEY = 'capy_active_session_v8';
const DB_NAME = 'capy_game_storage_v8';
const DB_VERSION = 1;
const STORE_PUZZLES = 'puzzles';
const STORE_IMAGES = 'images';

export const DEFAULT_SETTINGS: UserSettings = {
  autoAdvance: true,
  difficulty: 'EASY',
  isPaintMode: false,
  isFreeColorMode: false,
  raisePaletteDock: true,
  regionColorMode: 'SOLID',
  canvasBgColor: 'CHARCOAL',
  canvasBgArgb: 0xff18181b,
  saveSortOrder: 'LAST_ACTIVE',
  showSavePreviews: true,
  highlightStyle: 'FULL_REGION',
  hintFillStyle: 'CHECKER',
  hintColorArgb: 0xfffbbf24,
  showRegionLabels: true,
  showPreviewLabels: false,
  showPreviewBorders: false,
  highlightMatching: true,
  animateHint: true,
  showNextRegionHint: true,
  hintIntensity: 0.65,
  labelScale: 1.0,
  minLabelSize: 6,
  maxLabelSize: 18,
  showZoomButtons: false,
  showResetViewButton: false,
  paletteSort: 'NUMBER',
  prioritizeOnScreen: true,
  hapticsEnabled: true,
  panMomentum: true,
  enableCustomColorForAllPuzzles: false,
  enableUndo: false,
  replaySpeed: 1,
  autoReplayOnLoad: true,
  reverseDoubleTapZoom: false,
  detailedLoadingProgress: false,
  generatorConfig: {
    algorithm: 'AUTO',
    lineHandling: 'ABSORB_LINES',
    preset: 'MEDIUM',
    paletteDetail: 'AUTO',
    imageType: 'AUTO',
    colorCount: 16,
    minRegionArea: 48,
    maxRegions: 200,
    resolution: 1024,
    smoothingPasses: 2,
  },
};

export class StorageService {
  private static dbPromise: Promise<IDBDatabase> | null = null;

  private static getDB(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_PUZZLES)) {
            db.createObjectStore(STORE_PUZZLES);
          }
          if (!db.objectStoreNames.contains(STORE_IMAGES)) {
            db.createObjectStore(STORE_IMAGES);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this.dbPromise;
  }

  static loadSettings(): UserSettings {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY) || NativeBridge.loadBackup(SETTINGS_KEY);
      if (!raw) return DEFAULT_SETTINGS;
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        generatorConfig: {
          ...DEFAULT_SETTINGS.generatorConfig,
          ...(parsed.generatorConfig || {}),
        },
      };
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  static saveSettings(settings: UserSettings): void {
    try {
      const serialized = JSON.stringify(settings);
      localStorage.setItem(SETTINGS_KEY, serialized);
      NativeBridge.saveBackup(SETTINGS_KEY, serialized);
    } catch {
      // ignore
    }
  }

  static loadSnapshots(): SavedSnapshot[] {
    try {
      const raw = localStorage.getItem(SNAPSHOTS_KEY) || NativeBridge.loadBackup(SNAPSHOTS_KEY);
      if (!raw) return [];
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  static saveSnapshots(snapshots: SavedSnapshot[]): void {
    try {
      const serialized = JSON.stringify(snapshots);
      localStorage.setItem(SNAPSHOTS_KEY, serialized);
      NativeBridge.saveBackup(SNAPSHOTS_KEY, serialized);
    } catch {
      // ignore
    }
  }

  static addSnapshot(snapshot: SavedSnapshot): SavedSnapshot[] {
    const list = this.loadSnapshots();
    const existingIndex = list.findIndex((s) => s.id === snapshot.id);
    let updated: SavedSnapshot[];
    if (existingIndex >= 0) {
      updated = [...list];
      updated[existingIndex] = snapshot;
    } else {
      updated = [snapshot, ...list];
    }
    this.saveSnapshots(updated);
    return updated;
  }

  static estimatePuzzleSaveBytes(puzzle: PuzzleData, previewDataUrl?: string): number {
    let bytes = puzzle.regionMap.byteLength + puzzle.borderMap.byteLength;
    for (const r of puzzle.regions) {
      bytes += r.pixels.byteLength + 64;
    }
    bytes += puzzle.palette.length * 48;
    if (previewDataUrl) {
      bytes += previewDataUrl.length;
    }
    return bytes;
  }

  static updateSnapshotProgress(
    id: string,
    filledCount: number,
    totalCount: number,
    filledRegionIds: number[],
    zoomScale?: number,
    panOffsetX?: number,
    panOffsetY?: number,
    previewDataUrl?: string,
    paintedRegionColors?: Record<number, number>,
    customPalette?: PaletteColor[],
    isFreeColor?: boolean,
    fileSizeBytes?: number
  ): SavedSnapshot[] {
    const list = this.loadSnapshots();
    const updated = list.map((item) => {
      if (item.id === id) {
        return {
          ...item,
          lastOpened: Date.now(),
          filledCount,
          totalCount,
          filledRegionIds,
          ...(paintedRegionColors !== undefined ? { paintedRegionColors } : {}),
          ...(customPalette !== undefined ? { customPalette } : {}),
          ...(isFreeColor !== undefined ? { isFreeColor } : {}),
          ...(zoomScale !== undefined ? { zoomScale } : {}),
          ...(panOffsetX !== undefined ? { panOffsetX } : {}),
          ...(panOffsetY !== undefined ? { panOffsetY } : {}),
          ...(previewDataUrl ? { previewDataUrl } : {}),
          ...(fileSizeBytes !== undefined ? { fileSizeBytes } : {}),
        };
      }
      return item;
    });
    this.saveSnapshots(updated);
    return updated;
  }

  static renameSnapshot(id: string, newTitle: string): SavedSnapshot[] {
    const list = this.loadSnapshots();
    const updated = list.map((s) => (s.id === id ? { ...s, title: newTitle } : s));
    this.saveSnapshots(updated);
    return updated;
  }

  static togglePinSnapshot(id: string): SavedSnapshot[] {
    const list = this.loadSnapshots();
    const updated = list.map((s) => (s.id === id ? { ...s, isPinned: !s.isPinned } : s));
    this.saveSnapshots(updated);
    return updated;
  }

  static async deleteSnapshot(id: string): Promise<SavedSnapshot[]> {
    const list = this.loadSnapshots();
    const updated = list.filter((s) => s.id !== id);
    this.saveSnapshots(updated);

    try {
      const db = await this.getDB();
      const tx = db.transaction([STORE_PUZZLES, STORE_IMAGES], 'readwrite');
      tx.objectStore(STORE_PUZZLES).delete(id);
      tx.objectStore(STORE_IMAGES).delete(id);
    } catch {
      // ignore
    }

    return updated;
  }

  static async clearAllSnapshots(): Promise<void> {
    this.saveSnapshots([]);
    try {
      const db = await this.getDB();
      const tx = db.transaction([STORE_PUZZLES, STORE_IMAGES], 'readwrite');
      tx.objectStore(STORE_PUZZLES).clear();
      tx.objectStore(STORE_IMAGES).clear();
    } catch {
      // ignore
    }
  }

  static async savePuzzleData(id: string, puzzle: PuzzleData): Promise<void> {
    try {
      const db = await this.getDB();
      const tx = db.transaction(STORE_PUZZLES, 'readwrite');
      tx.objectStore(STORE_PUZZLES).put(puzzle, id);
    } catch (e) {
      console.warn('Failed to save puzzle data to IndexedDB', e);
    }
  }

  static async loadPuzzleData(id: string): Promise<PuzzleData | null> {
    try {
      const db = await this.getDB();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_PUZZLES, 'readonly');
        const req = tx.objectStore(STORE_PUZZLES).get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  static async saveImageBlob(id: string, blob: Blob): Promise<void> {
    try {
      const db = await this.getDB();
      const tx = db.transaction(STORE_IMAGES, 'readwrite');
      tx.objectStore(STORE_IMAGES).put(blob, id);
    } catch (e) {
      console.warn('Failed to save image blob to IndexedDB', e);
    }
  }

  static async loadImageBlob(id: string): Promise<Blob | null> {
    try {
      const db = await this.getDB();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_IMAGES, 'readonly');
        const req = tx.objectStore(STORE_IMAGES).get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  static saveActiveState(state: {
    activeSnapshotId: string | null;
    activeColorId: number;
    filledRegionIds: number[];
    paintedRegionColors?: Record<number, number>;
    isFreeColorMode?: boolean;
    zoomScale: number;
    panOffsetX: number;
    panOffsetY: number;
  }): void {
    try {
      const serialized = JSON.stringify(state);
      localStorage.setItem(ACTIVE_STATE_KEY, serialized);
      NativeBridge.saveBackup(ACTIVE_STATE_KEY, serialized);
    } catch {
      // ignore
    }
  }

  static loadActiveState(): {
    activeSnapshotId: string | null;
    activeColorId: number;
    filledRegionIds: number[];
    paintedRegionColors?: Record<number, number>;
    isFreeColorMode?: boolean;
    zoomScale: number;
    panOffsetX: number;
    panOffsetY: number;
  } | null {
    try {
      const raw = localStorage.getItem(ACTIVE_STATE_KEY) || NativeBridge.loadBackup(ACTIVE_STATE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  static async saveMultiplePuzzleData(entries: Array<{ id: string; puzzle: PuzzleData }>): Promise<void> {
    if (entries.length === 0) return;
    try {
      const db = await this.getDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_PUZZLES, 'readwrite');
        const store = tx.objectStore(STORE_PUZZLES);
        for (const entry of entries) {
          store.put(entry.puzzle, entry.id);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      console.warn('Failed to batch save puzzle data to IndexedDB', e);
    }
  }

  static async exportSnapshot(id: string): Promise<string> {
    const snapshots = this.loadSnapshots();
    const snapshot = snapshots.find((s) => s.id === id);
    if (!snapshot) throw new Error('Snapshot not found');
    const puzzle = await this.loadPuzzleData(id);
    const bundle = {
      version: 2,
      format: 'capy-single-save',
      exportDate: Date.now(),
      snapshot,
      puzzle: puzzle ? serializePuzzle(puzzle) : null,
    };
    return JSON.stringify(bundle);
  }

  static async exportAllSnapshots(): Promise<string> {
    const snapshots = this.loadSnapshots();
    const puzzles: Record<string, SerializedPuzzleData> = {};
    for (const snap of snapshots) {
      const p = await this.loadPuzzleData(snap.id);
      if (p) {
        puzzles[snap.id] = serializePuzzle(p);
      }
    }
    const bundle = {
      version: 2,
      format: 'capy-archive-save',
      exportDate: Date.now(),
      snapshots,
      puzzles,
    };
    return JSON.stringify(bundle);
  }

  static async importSnapshotBundle(
    jsonString: string,
    options?: { refreshTimestamps?: boolean }
  ): Promise<{
    importedCount: number;
    firstSnapshot?: SavedSnapshot;
    firstPuzzle?: PuzzleData;
    error?: string;
  }> {
    try {
      const data = JSON.parse(jsonString);
      if (!data) return { importedCount: 0, error: 'Empty or invalid JSON' };

      const now = Date.now();

      // Single snapshot format
      if (data.format === 'capy-single-save' && data.snapshot) {
        const rawSnap = data.snapshot as SavedSnapshot;
        if (!rawSnap.id || !rawSnap.title) {
          return { importedCount: 0, error: 'Invalid snapshot data structure' };
        }
        const snap: SavedSnapshot = options?.refreshTimestamps
          ? { ...rawSnap, timestamp: now, lastOpened: now }
          : rawSnap;
        this.addSnapshot(snap);
        let firstPuzzle: PuzzleData | undefined;
        if (data.puzzle) {
          firstPuzzle = deserializePuzzle(data.puzzle);
          await this.savePuzzleData(snap.id, firstPuzzle);
        }
        return { importedCount: 1, firstSnapshot: snap, firstPuzzle };
      }

      // Archive format
      if (data.format === 'capy-archive-save' && Array.isArray(data.snapshots)) {
        const validSnapshots = (data.snapshots as SavedSnapshot[])
          .filter((s) => Boolean(s && s.id && s.title))
          .map((s, idx) =>
            options?.refreshTimestamps
              ? { ...s, timestamp: now - idx * 1000, lastOpened: now - idx * 1000 }
              : s
          );

        if (validSnapshots.length === 0) {
          return { importedCount: 0, error: 'No valid snapshots in archive' };
        }

        const existing = this.loadSnapshots();
        const importedIds = new Set(validSnapshots.map((s) => s.id));
        const remaining = existing.filter((s) => !importedIds.has(s.id));
        this.saveSnapshots([...validSnapshots, ...remaining]);

        let firstPuzzle: PuzzleData | undefined;
        if (data.puzzles) {
          const puzzleEntries: Array<{ id: string; puzzle: PuzzleData }> = [];
          for (let i = 0; i < validSnapshots.length; i++) {
            const snap = validSnapshots[i];
            const serialized = data.puzzles[snap.id];
            if (serialized) {
              const puzzle = deserializePuzzle(serialized);
              if (i === 0) {
                firstPuzzle = puzzle;
              }
              puzzleEntries.push({ id: snap.id, puzzle });
            }
          }
          await this.saveMultiplePuzzleData(puzzleEntries);
        }

        return {
          importedCount: validSnapshots.length,
          firstSnapshot: validSnapshots[0],
          firstPuzzle,
        };
      }

      // Fallback: array of snapshots
      if (Array.isArray(data)) {
        const validSnapshots = (data as SavedSnapshot[]).filter((s) => Boolean(s && s.id && s.title));
        if (validSnapshots.length > 0) {
          const existing = this.loadSnapshots();
          const importedIds = new Set(validSnapshots.map((s) => s.id));
          const remaining = existing.filter((s) => !importedIds.has(s.id));
          this.saveSnapshots([...validSnapshots, ...remaining]);
        }
        return { importedCount: validSnapshots.length, firstSnapshot: validSnapshots[0] };
      }

      return { importedCount: 0, error: 'Unrecognized Capy save format' };
    } catch (err: any) {
      return { importedCount: 0, error: err?.message || 'Failed to parse JSON save' };
    }
  }
}

if (typeof window !== 'undefined') {
  (window as unknown as { capyStorage?: typeof StorageService }).capyStorage = StorageService;
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
  regions: Array<{
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
  }>;
}

function bufferToBase64(buffer: ArrayBufferView): string {
  const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let binary = '';
  const len = bytes.byteLength;
  const chunkSize = 0x8000;
  for (let i = 0; i < len; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunkSize, len)) as any);
  }
  return btoa(binary);
}

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function base64ToInt32Array(b64: string): Int32Array {
  const bytes = base64ToUint8Array(b64);
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
  const bytes = base64ToUint8Array(b64);
  const regionMap = new Int32Array(total);
  let writePos = 0;
  const byteLen = bytes.length;
  for (let i = 0; i + 3 < byteLen && writePos < total; i += 4) {
    const rid = bytes[i] | (bytes[i + 1] << 8);
    const len = bytes[i + 2] | (bytes[i + 3] << 8);
    const end = Math.min(total, writePos + len);
    regionMap.fill(rid, writePos, end);
    writePos = end;
  }
  return regionMap;
}

function buildBorderMapFromRegionMap(regionMap: Int32Array, width: number, height: number): Uint8Array {
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

export function serializePuzzle(p: PuzzleData): SerializedPuzzleData {
  let canUseRle16 = true;
  for (let i = 0; i < p.regionMap.length; i++) {
    const rid = p.regionMap[i];
    if (rid < 0 || rid > 65535) {
      canUseRle16 = false;
      break;
    }
  }

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
  };
}

export function deserializePuzzle(s: SerializedPuzzleData): PuzzleData {
  const total = s.width * s.height;
  const regionMap = s.regionMapRleB64
    ? decodeRegionMapRle16(s.regionMapRleB64, total)
    : s.regionMapB64
      ? base64ToInt32Array(s.regionMapB64)
      : new Int32Array(total);

  const borderMap = s.borderMapB64
    ? base64ToUint8Array(s.borderMapB64)
    : buildBorderMapFromRegionMap(regionMap, s.width, s.height);

  const hasLegacyPixels = s.regions.length > 0 && s.regions.every((r) => typeof r.pixelsB64 === 'string');
  if (hasLegacyPixels) {
    return {
      width: s.width,
      height: s.height,
      palette: s.palette,
      regionMap,
      borderMap,
      isFreeColor: s.isFreeColor,
      regions: s.regions.map((r) => ({
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
        pixels: base64ToInt32Array(r.pixelsB64!),
      })),
    };
  }

  let maxRegionId = 0;
  for (let i = 0; i < s.regions.length; i++) {
    if (s.regions[i].id > maxRegionId) {
      maxRegionId = s.regions[i].id;
    }
  }

  const idToIndex = new Int32Array(maxRegionId + 1);
  idToIndex.fill(-1);
  for (let i = 0; i < s.regions.length; i++) {
    idToIndex[s.regions[i].id] = i;
  }

  const counts = new Uint32Array(s.regions.length);
  for (let idx = 0; idx < total; idx++) {
    const rid = regionMap[idx];
    if (rid >= 0 && rid <= maxRegionId) {
      const rIdx = idToIndex[rid];
      if (rIdx >= 0) counts[rIdx]++;
    }
  }

  const pixelArrays: Int32Array[] = new Array(s.regions.length);
  for (let i = 0; i < s.regions.length; i++) {
    pixelArrays[i] = new Int32Array(counts[i]);
  }

  const cursors = new Uint32Array(s.regions.length);
  for (let idx = 0; idx < total; idx++) {
    const rid = regionMap[idx];
    if (rid >= 0 && rid <= maxRegionId) {
      const rIdx = idToIndex[rid];
      if (rIdx >= 0) {
        pixelArrays[rIdx][cursors[rIdx]++] = idx;
      }
    }
  }

  return {
    width: s.width,
    height: s.height,
    palette: s.palette,
    regionMap,
    borderMap,
    isFreeColor: s.isFreeColor,
    regions: s.regions.map((r, i) => ({
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
    })),
  };
}
