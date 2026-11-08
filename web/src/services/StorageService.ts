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
    isFreeColor?: boolean
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
}
