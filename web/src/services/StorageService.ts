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

  static async exportSnapshot(id: string): Promise<string> {
    const snapshots = this.loadSnapshots();
    const snapshot = snapshots.find((s) => s.id === id);
    if (!snapshot) throw new Error('Snapshot not found');
    const puzzle = await this.loadPuzzleData(id);
    const bundle = {
      version: 1,
      format: 'capy-single-save',
      exportDate: Date.now(),
      snapshot,
      puzzle: puzzle ? serializePuzzle(puzzle) : null,
    };
    return JSON.stringify(bundle, null, 2);
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
      version: 1,
      format: 'capy-archive-save',
      exportDate: Date.now(),
      snapshots,
      puzzles,
    };
    return JSON.stringify(bundle, null, 2);
  }

  static async importSnapshotBundle(
    jsonString: string
  ): Promise<{ importedCount: number; error?: string }> {
    try {
      const data = JSON.parse(jsonString);
      if (!data) return { importedCount: 0, error: 'Empty or invalid JSON' };

      let importedCount = 0;

      // Single snapshot format
      if (data.format === 'capy-single-save' && data.snapshot) {
        const snap = data.snapshot as SavedSnapshot;
        if (!snap.id || !snap.title) {
          return { importedCount: 0, error: 'Invalid snapshot data structure' };
        }
        this.addSnapshot(snap);
        importedCount++;
        if (data.puzzle) {
          const puzzle = deserializePuzzle(data.puzzle);
          await this.savePuzzleData(snap.id, puzzle);
        }
        return { importedCount };
      }

      // Archive format
      if (data.format === 'capy-archive-save' && Array.isArray(data.snapshots)) {
        for (const snap of data.snapshots as SavedSnapshot[]) {
          if (!snap.id || !snap.title) continue;
          this.addSnapshot(snap);
          importedCount++;
          if (data.puzzles && data.puzzles[snap.id]) {
            const puzzle = deserializePuzzle(data.puzzles[snap.id]);
            await this.savePuzzleData(snap.id, puzzle);
          }
        }
        return { importedCount };
      }

      // Fallback: array of snapshots
      if (Array.isArray(data)) {
        for (const snap of data as SavedSnapshot[]) {
          if (snap.id && snap.title) {
            this.addSnapshot(snap);
            importedCount++;
          }
        }
        return { importedCount };
      }

      return { importedCount: 0, error: 'Unrecognized Capy save format' };
    } catch (err: any) {
      return { importedCount: 0, error: err?.message || 'Failed to parse JSON save' };
    }
  }
}

interface SerializedPuzzleData {
  width: number;
  height: number;
  palette: PaletteColor[];
  regionMapB64: string;
  borderMapB64: string;
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
    pixelsB64: string;
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

function serializePuzzle(p: PuzzleData): SerializedPuzzleData {
  return {
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

function deserializePuzzle(s: SerializedPuzzleData): PuzzleData {
  return {
    width: s.width,
    height: s.height,
    palette: s.palette,
    regionMap: base64ToInt32Array(s.regionMapB64),
    borderMap: base64ToUint8Array(s.borderMapB64),
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
      pixels: base64ToInt32Array(r.pixelsB64),
    })),
  };
}
