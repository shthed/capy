import {
  Dispatch,
  MutableRefObject,
  SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  BorderExtensionSides,
  GenerationProgressPayload,
  GeneratorConfig,
  InfiniteZoomNodeMeta,
  PaletteColor,
  PuzzleData,
  Region,
  SavedSnapshot,
  UserSettings,
} from '../types';
import { StorageService } from '../services/StorageService';
import { NativeBridge } from '../services/NativeBridge';
import { PuzzleWorkerService } from '../services/PuzzleWorkerService';
import { mergeSubdividedRegionIntoPuzzle } from '../engine/MaskedRegionSubdivider';
import { generatePreviewDataUrl, hasCutoutExteriorMask } from '../services/artworkExporter';
import { reportSwallowed } from '../services/telemetry';
import { FeatureOfferId } from '../services/FeatureOffersService';
import { getDockPalette, getVisiblePalette } from '../components/PaletteDock';
import { TutorialTriedActions } from '../components/OnboardingTutorial';
import {
  generateScenePlan,
  MAX_CONTEXT_BITMAP_DIM,
} from '../services/ai/LocalLlmService';
import {
  addContiguousDragRegions,
  buildSelectionMask,
  computeSelectionMetrics,
  SelectionBbox,
  SelectionMetrics,
  toggleContiguousRegion,
} from '../services/ai/RegionSelectionEngine';
import {
  canExtendSides,
  INFILL_MAX_DELTA_E,
  synthesizeExtendedBorderCanvas,
  synthesizeInfillCanvas,
} from '../services/ai/InfiniteZoomSynthesizer';
import type { CoopLiveState, CoopViewport } from './useCoopSession';
import type { UndoHistoryEntry } from './useUndoRedo';
import {
  computeNextResetEpoch,
  InfiniteZoomLoadOptions,
} from './useSnapshotLibrary';
import { useLatest } from './useLatest';

function revokeObjectUrlSafely(url: string | null | undefined): void {
  if (!url || !url.startsWith('blob:')) return;
  try {
    URL.revokeObjectURL(url);
  } catch (err) {
    reportSwallowed('InfiniteZoom.revokeObjectUrl', err);
  }
}

const ACHROMATIC_CHROMA_THRESHOLD = 28;
const ACHROMATIC_CHILD_MAX_DELTA_E = 78;
const UNDO_TOAST_DURATION_MS = 18_000;

export interface UndoSubdivisionSnapshot {
  snapshotId: string;
  puzzle: PuzzleData;
  sourceImage: HTMLImageElement;
  previousBlob: Blob | null;
  previousBlobUrl: string | null;
  newBlobUrl: string | null;
  filledRegionIds: Set<number>;
  paintedRegionColors: Map<number, number>;
  undoStack: UndoHistoryEntry[];
  redoStack: UndoHistoryEntry[];
  activeColorId: number;
  previousMeta: {
    sampleAssetPath: string | null | undefined;
    isAutoSample: boolean | undefined;
    sourceRef: SavedSnapshot['sourceRef'];
    zoomTree: InfiniteZoomNodeMeta | undefined;
    previewDataUrl: string | undefined;
  };
  addedRegionCount: number;
}

export interface UseInfiniteZoomControllerParams {
  puzzle: PuzzleData | null;
  sourceImage: HTMLImageElement | null;
  snapshots: SavedSnapshot[];
  activeSnapshotId: string | null;
  activeSave: SavedSnapshot | undefined;
  activeTitle: string;
  activeColorId: number;
  filledRegionIds: Set<number>;
  paintedRegionColors: Map<number, number>;
  isFreeColorMode: boolean;
  isLoading: boolean;
  isReplaying: boolean;
  coopRoomCode: string | null;
  settings: UserSettings;
  visibleColorIdsRef: MutableRefObject<Set<number>>;
  regionByIdRef: MutableRefObject<Map<number, Region>>;
  liveCoopRef: MutableRefObject<CoopLiveState>;
  viewportRef: MutableRefObject<CoopViewport>;
  activeBlobUrlRef: MutableRefObject<string | null>;
  undoStackRef: MutableRefObject<UndoHistoryEntry[]>;
  redoStackRef: MutableRefObject<UndoHistoryEntry[]>;
  handleLoadSnapshotRef: MutableRefObject<
    (snapshot: SavedSnapshot, forceReplay?: boolean) => Promise<void>
  >;
  persistParentSnapshotBeforeDetailTile: (parentId: string, currentView: CoopViewport) => void;
  loadArtworkFromImage: (
    img: HTMLImageElement,
    title: string,
    config?: GeneratorConfig,
    initialFilledRegionIds?: Set<number>,
    initialActiveColorId?: number,
    existingSnapshotId?: string,
    sampleAssetPath?: string | null,
    shouldAutoReplay?: boolean,
    sourceBlob?: Blob | null,
    initialPaintedColors?: Record<number, number>,
    initialViewportOverride?: CoopViewport,
    initialCustomPalette?: PaletteColor[],
    initialIsFreeColor?: boolean,
    parentSnapshotId?: string,
    infiniteZoomOptions?: InfiniteZoomLoadOptions
  ) => Promise<void>;
  syncUndoStack: (
    updater: UndoHistoryEntry[] | ((prev: UndoHistoryEntry[]) => UndoHistoryEntry[])
  ) => void;
  syncRedoStack: (
    updater: UndoHistoryEntry[] | ((prev: UndoHistoryEntry[]) => UndoHistoryEntry[])
  ) => void;
  setSnapshots: Dispatch<SetStateAction<SavedSnapshot[]>>;
  setPuzzle: Dispatch<SetStateAction<PuzzleData | null>>;
  setSourceImage: Dispatch<SetStateAction<HTMLImageElement | null>>;
  setFilledRegionIds: Dispatch<SetStateAction<Set<number>>>;
  setPaintedRegionColors: Dispatch<SetStateAction<Map<number, number>>>;
  setActiveColorId: Dispatch<SetStateAction<number>>;
  setHintRegionId: Dispatch<SetStateAction<number | null>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setLoadingProgress: Dispatch<SetStateAction<number>>;
  setLoadingStatus: Dispatch<SetStateAction<string>>;
  setLoadingPayload: Dispatch<SetStateAction<GenerationProgressPayload | null>>;
  markTutorialActionTried: (action: keyof TutorialTriedActions) => void;
  triggerFeatureOffer: (id: FeatureOfferId) => void;
}

/**
 * Pure helper computing mean RGB chroma strictly over mask[i] === 1 pixels.
 */
export function computeSelectionMeanChroma(
  rgba: Uint8ClampedArray,
  mask: Uint8Array
): number {
  let chromaSum = 0;
  let count = 0;
  const total = Math.min(mask.length, Math.floor(rgba.length / 4));
  for (let i = 0; i < total; i++) {
    if (mask[i] !== 1) continue;
    const idx = i * 4;
    const r = rgba[idx];
    const g = rgba[idx + 1];
    const b = rgba[idx + 2];
    const maxC = r >= g ? (r >= b ? r : b) : g >= b ? g : b;
    const minC = r <= g ? (r <= b ? r : b) : g <= b ? g : b;
    chromaSum += maxC - minC;
    count++;
  }
  return count > 0 ? chromaSum / count : 0;
}

/**
 * Pure helper removing any undo/redo entries referencing replaced pre-subdivision region IDs.
 */
export function scrubUndoHistoryForRemovedRegions(
  stack: readonly UndoHistoryEntry[],
  removedIds: ReadonlySet<number>
): UndoHistoryEntry[] {
  if (removedIds.size === 0) return stack.slice();
  return stack.filter((entry) => !removedIds.has(entry.regionId));
}

function filterProgressForRemovedRegions(
  filledRegionIds: ReadonlySet<number>,
  paintedRegionColors: ReadonlyMap<number, number>,
  removedIds: ReadonlySet<number>
): { nextFilled: Set<number>; nextPainted: Map<number, number> } {
  const nextFilled = new Set<number>();
  for (const id of filledRegionIds) {
    if (!removedIds.has(id)) nextFilled.add(id);
  }
  const nextPainted = new Map<number, number>();
  for (const [id, colId] of paintedRegionColors) {
    if (!removedIds.has(id)) nextPainted.set(id, colId);
  }
  return { nextFilled, nextPainted };
}

/**
 * Pure helper resolving activeColorId after an in-place subdivision, honoring autoAdvance.
 */
export function resolvePostSubdivisionActiveColor(
  nextPuzzle: PuzzleData,
  nextFilled: Set<number>,
  currentActiveColorId: number,
  addedSwatches: readonly PaletteColor[],
  settings: Pick<UserSettings, 'autoAdvance' | 'paletteSort' | 'prioritizeOnScreen'>,
  visibleColorIds: Set<number>,
  isFreeColorMode: boolean
): number {
  if (isFreeColorMode || !settings.autoAdvance || nextPuzzle.regions.length === 0) {
    return currentActiveColorId;
  }
  const currentHasRemaining = nextPuzzle.regions.some(
    (r) => r.colorId === currentActiveColorId && !nextFilled.has(r.id)
  );
  if (currentHasRemaining) return currentActiveColorId;

  for (const swatch of addedSwatches) {
    if (nextPuzzle.regions.some((r) => r.colorId === swatch.id && !nextFilled.has(r.id))) {
      return swatch.id;
    }
  }
  const basePalette = getVisiblePalette(
    nextPuzzle.palette,
    nextPuzzle.regions,
    nextFilled,
    settings.paletteSort
  );
  const dockPalette = getDockPalette(basePalette, settings.prioritizeOnScreen, visibleColorIds);
  return dockPalette[0]?.id ?? basePalette[0]?.id ?? currentActiveColorId;
}

/**
 * Pure helper resolving the most recent live child snapshot for bidirectional TopBar navigation.
 */
export function resolveLatestChildSave(
  snapshots: readonly SavedSnapshot[],
  activeSave: SavedSnapshot | undefined,
  activeSnapshotId: string | null
): SavedSnapshot | null {
  if (!activeSnapshotId) return null;
  const byId = new Map<string, SavedSnapshot>();
  for (const snap of snapshots) {
    byId.set(snap.id, snap);
  }
  const childIds = activeSave?.zoomTree?.childSnapshotIds;
  if (childIds && childIds.length > 0) {
    for (let i = childIds.length - 1; i >= 0; i--) {
      const candidate = byId.get(childIds[i]);
      if (candidate && candidate.id !== activeSnapshotId) {
        return candidate;
      }
    }
  }
  let fallback: SavedSnapshot | null = null;
  for (const snap of snapshots) {
    if (snap.parentSnapshotId === activeSnapshotId && snap.id !== activeSnapshotId) {
      if (!fallback || snap.lastOpened >= fallback.lastOpened) {
        fallback = snap;
      }
    }
  }
  return fallback;
}

/**
 * Composites synthesized infill canvas strictly inside cropMask === 1 onto a full-res copy
 * of sourceImage so surrounding artwork pixels remain bit-exact untouched.
 */
export function buildInPlaceUpdatedSourceCanvas(
  sourceImage: HTMLImageElement,
  infillCanvas: HTMLCanvasElement,
  bbox: SelectionBbox,
  cropMask: Uint8Array,
  targetWidth: number,
  targetHeight: number
): HTMLCanvasElement {
  const fullCanvas = document.createElement('canvas');
  fullCanvas.width = targetWidth;
  fullCanvas.height = targetHeight;
  const fullCtx =
    fullCanvas.getContext('2d', { willReadFrequently: true }) || fullCanvas.getContext('2d');
  if (!fullCtx) return fullCanvas;

  fullCtx.drawImage(sourceImage, 0, 0, targetWidth, targetHeight);
  const infillCtx =
    infillCanvas.getContext('2d', { willReadFrequently: true }) || infillCanvas.getContext('2d');
  if (!infillCtx || typeof fullCtx.getImageData !== 'function') {
    fullCtx.drawImage(infillCanvas, bbox.minX, bbox.minY, bbox.width, bbox.height);
    return fullCanvas;
  }

  const baseRegion = fullCtx.getImageData(bbox.minX, bbox.minY, bbox.width, bbox.height);
  const infillRegion = infillCtx.getImageData(0, 0, bbox.width, bbox.height);
  const dst = baseRegion.data;
  const src = infillRegion.data;
  const count = bbox.width * bbox.height;
  for (let i = 0; i < count; i++) {
    if (cropMask[i] !== 1) continue;
    const idx = i * 4;
    dst[idx] = src[idx];
    dst[idx + 1] = src[idx + 1];
    dst[idx + 2] = src[idx + 2];
    dst[idx + 3] = src[idx + 3];
  }
  fullCtx.putImageData(baseRegion, bbox.minX, bbox.minY);
  return fullCanvas;
}

function buildContextCanvas(
  sourceImage: HTMLImageElement,
  bbox?: SelectionBbox
): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const srcW = sourceImage.naturalWidth || sourceImage.width;
  const srcH = sourceImage.naturalHeight || sourceImage.height;
  if (srcW <= 0 || srcH <= 0) return null;

  const cropX = bbox ? Math.max(0, Math.min(srcW - 1, bbox.minX)) : 0;
  const cropY = bbox ? Math.max(0, Math.min(srcH - 1, bbox.minY)) : 0;
  const cropW = bbox ? Math.max(1, Math.min(srcW - cropX, bbox.width)) : srcW;
  const cropH = bbox ? Math.max(1, Math.min(srcH - cropY, bbox.height)) : srcH;
  const scale = Math.min(1, MAX_CONTEXT_BITMAP_DIM / Math.max(cropW, cropH));
  const outW = Math.max(1, Math.round(cropW * scale));
  const outH = Math.max(1, Math.round(cropH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(sourceImage, cropX, cropY, cropW, cropH, 0, 0, outW, outH);
  return canvas;
}

function readSelectionCropRgba(
  sourceImage: HTMLImageElement,
  puzzleWidth: number,
  puzzleHeight: number,
  bbox: SelectionBbox
): Uint8ClampedArray | null {
  if (typeof document === 'undefined') return null;
  const tmp = document.createElement('canvas');
  tmp.width = puzzleWidth;
  tmp.height = puzzleHeight;
  const ctx = tmp.getContext('2d', { willReadFrequently: true }) || tmp.getContext('2d');
  if (!ctx || typeof ctx.getImageData !== 'function') return null;
  ctx.drawImage(sourceImage, 0, 0, puzzleWidth, puzzleHeight);
  return ctx.getImageData(bbox.minX, bbox.minY, bbox.width, bbox.height).data;
}

function canvasToBlobAsync(
  canvas: HTMLCanvasElement,
  mimeType: 'image/png' | 'image/webp',
  quality?: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        if (mimeType !== 'image/png') {
          canvas.toBlob((pngBlob) => {
            if (pngBlob) resolve(pngBlob);
            else reject(new Error('Failed to encode artwork canvas'));
          }, 'image/png');
          return;
        }
        reject(new Error('Failed to encode PNG canvas'));
      },
      mimeType,
      quality
    );
  });
}

function decodeBlobToImage(blob: Blob): Promise<{ img: HTMLImageElement; objectUrl: string }> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => resolve({ img, objectUrl });
    img.onerror = () => {
      revokeObjectUrlSafely(objectUrl);
      reject(new Error('Failed to decode generated artwork image'));
    };
    img.src = objectUrl;
  });
}

function collectMonotonicResetEpoch(
  snapshotId: string,
  activeSave: SavedSnapshot | undefined,
  liveActiveSave: SavedSnapshot | undefined
): number {
  const freshSnap = StorageService.loadSnapshots().find((s) => s.id === snapshotId);
  const storedActive = StorageService.loadActiveState();
  const activeStateEpoch =
    storedActive?.activeSnapshotId === snapshotId ? storedActive.resetEpoch ?? 0 : 0;
  return computeNextResetEpoch(
    activeSave?.resetEpoch,
    liveActiveSave?.resetEpoch,
    freshSnap?.resetEpoch,
    activeStateEpoch
  );
}

function buildChildTileTitle(baseTitle: string, promptHint: string): string {
  const cleanBase = (baseTitle || 'Artwork').replace(/\s*\([^)]*Detail[^)]*\)\s*$/i, '').trim();
  const shortPrompt = promptHint.trim().slice(0, 24);
  return shortPrompt ? `${cleanBase} (Detail: ${shortPrompt})` : `${cleanBase} (Detail Tile)`;
}

function buildExtendedTitle(baseTitle: string, promptHint: string): string {
  const cleanBase = (baseTitle || 'Artwork').replace(/\s*\(Extended[^)]*\)\s*$/i, '').trim();
  const shortPrompt = promptHint.trim().slice(0, 24);
  return shortPrompt ? `${cleanBase} (Extended: ${shortPrompt})` : `${cleanBase} (Extended)`;
}

function isAbortLikeError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: string }).name;
  return name === 'AbortError' || name === 'GenerationCancelledError';
}

export function useInfiniteZoomController(params: UseInfiniteZoomControllerParams) {
  const {
    puzzle,
    sourceImage,
    snapshots,
    activeSnapshotId,
    activeSave,
    activeTitle,
    activeColorId,
    filledRegionIds,
    paintedRegionColors,
    isFreeColorMode,
    isLoading,
    isReplaying,
    coopRoomCode,
    settings,
    visibleColorIdsRef,
    regionByIdRef,
    liveCoopRef,
    viewportRef,
    activeBlobUrlRef,
    undoStackRef,
    redoStackRef,
    handleLoadSnapshotRef,
    persistParentSnapshotBeforeDetailTile,
    loadArtworkFromImage,
    syncUndoStack,
    syncRedoStack,
    setSnapshots,
    setPuzzle,
    setSourceImage,
    setFilledRegionIds,
    setPaintedRegionColors,
    setActiveColorId,
    setHintRegionId,
    setIsLoading,
    setLoadingProgress,
    setLoadingStatus,
    setLoadingPayload,
    markTutorialActionTried,
    triggerFeatureOffer,
  } = params;

  const [isRegionSelectionMode, setIsRegionSelectionMode] = useState(false);
  const [selectedRegionIds, setSelectedRegionIds] = useState<Set<number>>(() => new Set());
  const [pendingSwitchRegionId, setPendingSwitchRegionId] = useState<number | null>(null);
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const [infiniteZoomPrompt, setInfiniteZoomPrompt] = useState('');
  const [isInfiniteZoomRunning, setIsInfiniteZoomRunning] = useState(false);
  const [undoSubdivisionState, setUndoSubdivisionState] =
    useState<UndoSubdivisionSnapshot | null>(null);

  const infiniteZoomOpSeqRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const undoToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelHandoffRef = useRef<{ restoreSnapshotId: string; createdSnapshotId: string | null } | null>(
    null
  );
  const undoSubdivisionRef = useLatest(undoSubdivisionState);
  const settingsRef = useLatest(settings);

  useEffect(() => {
    if (!isLoading) {
      cancelHandoffRef.current = null;
    }
  }, [isLoading]);

  const effectiveInfiniteZoomRunning = isInfiniteZoomRunning && isLoading;

  const clearUndoToastTimer = useCallback(() => {
    if (undoToastTimerRef.current !== null) {
      clearTimeout(undoToastTimerRef.current);
      undoToastTimerRef.current = null;
    }
  }, []);

  const clearUndoSubdivision = useCallback(() => {
    clearUndoToastTimer();
    const prev = undoSubdivisionRef.current;
    if (prev && prev.previousBlobUrl && prev.previousBlobUrl !== activeBlobUrlRef.current) {
      revokeObjectUrlSafely(prev.previousBlobUrl);
    }
    setUndoSubdivisionState(null);
  }, [activeBlobUrlRef, clearUndoToastTimer, undoSubdivisionRef]);

  const exitRegionSelectionMode = useCallback(() => {
    setIsRegionSelectionMode(false);
    setSelectedRegionIds(new Set());
    setPendingSwitchRegionId(null);
    setSelectionNotice(null);
  }, []);

  const cancelActiveInfiniteZoom = useCallback(() => {
    infiniteZoomOpSeqRef.current += 1;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    const handoff = cancelHandoffRef.current;
    cancelHandoffRef.current = null;
    PuzzleWorkerService.cancelActive();
    setIsInfiniteZoomRunning(false);
    if (handoff) {
      if (handoff.createdSnapshotId && handoff.createdSnapshotId !== handoff.restoreSnapshotId) {
        void StorageService.deleteSnapshot(handoff.createdSnapshotId)
          .then((updated) => setSnapshots(updated))
          .catch((err) => reportSwallowed('InfiniteZoom.cancelDeleteSnapshot', err));
      }
      const restoreSnap = StorageService.loadSnapshots().find(
        (s) => s.id === handoff.restoreSnapshotId
      );
      if (restoreSnap) {
        void handleLoadSnapshotRef.current(restoreSnap, false);
        return;
      }
    }
    setIsLoading(false);
    setLoadingPayload(null);
  }, [handleLoadSnapshotRef, setIsLoading, setLoadingPayload, setSnapshots]);

  const handleBeforeSnapshotResetOrSwitch = useCallback(() => {
    exitRegionSelectionMode();
    clearUndoSubdivision();
    if (abortControllerRef.current && !cancelHandoffRef.current) {
      infiniteZoomOpSeqRef.current += 1;
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsInfiniteZoomRunning(false);
    }
  }, [clearUndoSubdivision, exitRegionSelectionMode]);

  useEffect(() => {
    return () => {
      clearUndoToastTimer();
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, [clearUndoToastTimer]);

  const selectionMetrics: SelectionMetrics = useMemo(() => {
    if (!puzzle || selectedRegionIds.size === 0) {
      return {
        regionCount: 0,
        area: 0,
        bbox: { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 },
        paintedCount: 0,
        neighborRegionIds: [],
        neighborBoundaryHexes: [],
        mode: 'in-place',
      };
    }
    return computeSelectionMetrics(puzzle, selectedRegionIds, filledRegionIds, paintedRegionColors);
  }, [puzzle, selectedRegionIds, filledRegionIds, paintedRegionColors]);

  const childSave = useMemo(
    () => resolveLatestChildSave(snapshots, activeSave, activeSnapshotId),
    [snapshots, activeSave, activeSnapshotId]
  );

  const isInfiniteZoomDisabled = Boolean(coopRoomCode) || isLoading || isReplaying || !sourceImage;
  const infiniteZoomDisabledReason = coopRoomCode
    ? 'Leave Co-op room to use Infinite Zoom'
    : isReplaying
      ? 'Exit Replay to use Infinite Zoom'
      : undefined;

  const handleJumpToChildPuzzle = useCallback(() => {
    if (!childSave) return;
    NativeBridge.haptic('tick', settingsRef.current.hapticsEnabled);
    void handleLoadSnapshotRef.current(childSave);
  }, [childSave, handleLoadSnapshotRef, settingsRef]);

  const handleEnterRegionSelectionMode = useCallback(
    (initialPrompt?: string) => {
      if (isInfiniteZoomDisabled || !puzzle) return;
      if (typeof initialPrompt === 'string' && initialPrompt.trim().length > 0) {
        setInfiniteZoomPrompt(initialPrompt);
      }
      setSelectedRegionIds(new Set());
      setPendingSwitchRegionId(null);
      setSelectionNotice(null);
      setIsRegionSelectionMode(true);
    },
    [isInfiniteZoomDisabled, puzzle]
  );

  const handleRegionSelectTap = useCallback(
    (regionId: number) => {
      if (!puzzle || !isRegionSelectionMode) return;
      const result = toggleContiguousRegion(
        puzzle,
        selectedRegionIds,
        regionId,
        regionByIdRef.current
      );
      if (result.status === 'added' || result.status === 'removed') {
        setSelectedRegionIds(result.nextSelected);
        setPendingSwitchRegionId(null);
        setSelectionNotice(null);
        NativeBridge.haptic('tick', settingsRef.current.hapticsEnabled);
      } else if (result.status === 'non-adjacent') {
        setPendingSwitchRegionId(regionId);
        setSelectionNotice(null);
      } else if (result.status === 'bridge-blocked') {
        setPendingSwitchRegionId(null);
        setSelectionNotice('Cannot unselect a connecting bridge region — clear or unselect ends first.');
      }
    },
    [isRegionSelectionMode, puzzle, regionByIdRef, selectedRegionIds, settingsRef]
  );

  const handleRegionSelectDragAdd = useCallback(
    (candidateIds: Set<number>) => {
      if (!puzzle || !isRegionSelectionMode || candidateIds.size === 0) return;
      setSelectedRegionIds((prev) => {
        const next = addContiguousDragRegions(puzzle, prev, candidateIds, regionByIdRef.current);
        return next.size === prev.size ? prev : next;
      });
      setPendingSwitchRegionId(null);
      setSelectionNotice(null);
    },
    [isRegionSelectionMode, puzzle, regionByIdRef]
  );

  const handleSwitchSelectionToPending = useCallback(() => {
    if (pendingSwitchRegionId === null || !puzzle) return;
    setSelectedRegionIds(new Set([pendingSwitchRegionId]));
    setPendingSwitchRegionId(null);
    setSelectionNotice(null);
    NativeBridge.haptic('tick', settingsRef.current.hapticsEnabled);
  }, [pendingSwitchRegionId, puzzle, settingsRef]);

  const handleClearSelection = useCallback(() => {
    setSelectedRegionIds(new Set());
    setPendingSwitchRegionId(null);
    setSelectionNotice(null);
  }, []);

  const commitInPlaceSubdivision = useCallback(
    async (opts: {
      seq: number;
      signal: AbortSignal;
      snapId: string;
      existingSnap: SavedSnapshot | undefined;
      basePuzzle: PuzzleData;
      baseImage: HTMLImageElement;
      mergedPuzzle: PuzzleData;
      updatedImg: HTMLImageElement;
      updatedBlob: Blob;
      newBlobUrl: string;
      previousBlob: Blob | null;
      selectedSnapshot: Set<number>;
      addedRegionCount: number;
      addedSwatches: PaletteColor[];
      paintedCount: number;
      sanitizedPrompt: string;
      tierUsed: InfiniteZoomNodeMeta['aiTierUsed'];
      isFree: boolean;
    }) => {
      const {
        seq,
        signal,
        snapId,
        existingSnap,
        basePuzzle,
        baseImage,
        mergedPuzzle,
        updatedImg,
        updatedBlob,
        newBlobUrl,
        previousBlob,
        selectedSnapshot,
        addedRegionCount,
        addedSwatches,
        paintedCount,
        sanitizedPrompt,
        tierUsed,
        isFree,
      } = opts;

      const previousBlobUrl = activeBlobUrlRef.current;
      activeBlobUrlRef.current = newBlobUrl;

      const preSplitUndo: UndoSubdivisionSnapshot = {
        snapshotId: snapId,
        puzzle: basePuzzle,
        sourceImage: baseImage,
        previousBlob,
        previousBlobUrl,
        newBlobUrl,
        filledRegionIds: new Set(filledRegionIds),
        paintedRegionColors: new Map(paintedRegionColors),
        undoStack: undoStackRef.current.slice(),
        redoStack: redoStackRef.current.slice(),
        activeColorId,
        previousMeta: {
          sampleAssetPath: existingSnap?.sampleAssetPath,
          isAutoSample: existingSnap?.isAutoSample,
          sourceRef: existingSnap?.sourceRef,
          zoomTree: existingSnap?.zoomTree,
          previewDataUrl: existingSnap?.previewDataUrl,
        },
        addedRegionCount,
      };

      const { nextFilled, nextPainted } = filterProgressForRemovedRegions(
        filledRegionIds,
        paintedRegionColors,
        selectedSnapshot
      );
      const nextUndo = scrubUndoHistoryForRemovedRegions(undoStackRef.current, selectedSnapshot);
      const nextRedo = scrubUndoHistoryForRemovedRegions(redoStackRef.current, selectedSnapshot);
      const nextActiveColorId = resolvePostSubdivisionActiveColor(
        mergedPuzzle,
        nextFilled,
        activeColorId,
        addedSwatches,
        settingsRef.current,
        visibleColorIdsRef.current,
        isFree
      );

      await StorageService.saveImageBlob(snapId, updatedBlob).catch((err) => {
        reportSwallowed('InfiniteZoom.saveImageBlob', err, { id: snapId });
      });
      if (signal.aborted || seq !== infiniteZoomOpSeqRef.current) return;

      const nextZoomTree: InfiniteZoomNodeMeta = {
        ...(existingSnap?.zoomTree || { depth: 0, direction: 'in-place' }),
        direction: existingSnap?.zoomTree?.direction ?? 'in-place',
        selectedRegionIds: Array.from(selectedSnapshot),
        promptHint: sanitizedPrompt || undefined,
        aiTierUsed: tierUsed,
        inPlaceSubdivisionCount: (existingSnap?.zoomTree?.inPlaceSubdivisionCount ?? 0) + 1,
      };
      const nextResetEpoch =
        paintedCount > 0
          ? collectMonotonicResetEpoch(snapId, activeSave, liveCoopRef.current.activeSave)
          : undefined;

      StorageService.updateSnapshotMetadata(snapId, {
        sampleAssetPath: null,
        isAutoSample: false,
        sourceRef: { kind: 'blob', uri: snapId },
        zoomTree: nextZoomTree,
      });

      const previewUrl = generatePreviewDataUrl(mergedPuzzle, updatedImg, nextFilled, nextPainted);
      const estSaveBytes = StorageService.estimatePuzzleSaveBytes(mergedPuzzle, previewUrl);
      const orderedFilled = Array.from(nextFilled);
      const paintedObj = Object.fromEntries(nextPainted);
      const { zoomScale, panOffsetX, panOffsetY } = viewportRef.current;

      const updatedSnapshots = StorageService.updateSnapshotProgress(
        snapId,
        nextFilled.size,
        mergedPuzzle.regions.length,
        orderedFilled,
        zoomScale,
        panOffsetX,
        panOffsetY,
        previewUrl,
        paintedObj,
        mergedPuzzle.palette,
        isFree,
        estSaveBytes,
        nextResetEpoch
      );
      const syncedSave = updatedSnapshots.find((s) => s.id === snapId);

      await StorageService.savePuzzleData(snapId, mergedPuzzle).catch((err) => {
        reportSwallowed('InfiniteZoom.savePuzzleData', err, { id: snapId });
      });
      if (signal.aborted || seq !== infiniteZoomOpSeqRef.current) return;

      StorageService.saveActiveState({
        activeSnapshotId: snapId,
        activeColorId: nextActiveColorId,
        filledRegionIds: orderedFilled,
        paintedRegionColors: paintedObj,
        isFreeColorMode: isFree,
        ...(nextResetEpoch !== undefined ? { resetEpoch: nextResetEpoch } : {}),
        zoomScale,
        panOffsetX,
        panOffsetY,
      });

      liveCoopRef.current = {
        ...liveCoopRef.current,
        puzzle: mergedPuzzle,
        activeSave: syncedSave ?? liveCoopRef.current.activeSave,
        filledRegionIds: nextFilled,
        paintedRegionColors: nextPainted,
        activeColorId: nextActiveColorId,
      };
      setSourceImage(updatedImg);
      setPuzzle(mergedPuzzle);
      setFilledRegionIds(nextFilled);
      setPaintedRegionColors(nextPainted);
      setActiveColorId(nextActiveColorId);
      setHintRegionId(null);
      syncUndoStack(nextUndo);
      syncRedoStack(nextRedo);
      setSnapshots(updatedSnapshots);

      clearUndoToastTimer();
      setUndoSubdivisionState(preSplitUndo);
      undoToastTimerRef.current = setTimeout(() => {
        clearUndoSubdivision();
      }, UNDO_TOAST_DURATION_MS);

      markTutorialActionTried('create_gallery');
      triggerFeatureOffer('infinite_zoom');
      NativeBridge.haptic('success', settingsRef.current.hapticsEnabled);
    },
    [
      activeBlobUrlRef,
      activeColorId,
      activeSave,
      clearUndoSubdivision,
      clearUndoToastTimer,
      filledRegionIds,
      liveCoopRef,
      markTutorialActionTried,
      paintedRegionColors,
      redoStackRef,
      setActiveColorId,
      setFilledRegionIds,
      setHintRegionId,
      setPaintedRegionColors,
      setPuzzle,
      setSnapshots,
      setSourceImage,
      settingsRef,
      syncRedoStack,
      syncUndoStack,
      triggerFeatureOffer,
      undoStackRef,
      viewportRef,
      visibleColorIdsRef,
    ]
  );

  const executeInPlaceSubdivision = useCallback(
    async (
      seq: number,
      signal: AbortSignal,
      basePuzzle: PuzzleData,
      baseImage: HTMLImageElement,
      selectedSnapshot: Set<number>,
      metrics: SelectionMetrics,
      promptText: string
    ) => {
      const isAborted = () => signal.aborted || seq !== infiniteZoomOpSeqRef.current;
      const snapId = activeSnapshotId || crypto.randomUUID();
      const isFree = Boolean(isFreeColorMode || basePuzzle.isFreeColor);
      const existingSnap = snapshots.find((s) => s.id === snapId);
      const previousBlob =
        existingSnap && !existingSnap.sampleAssetPath
          ? await StorageService.loadImageBlob(snapId).catch(() => null)
          : null;
      if (isAborted()) return;

      const scenePlan = await generateScenePlan(
        {
          direction: 'in-place',
          localAiMode: settingsRef.current.localAiMode,
          userPrompt: promptText,
          neighborPaletteHex: metrics.neighborBoundaryHexes,
          existingPaletteHex: basePuzzle.palette.map((c) => c.hex),
          depth: activeSave?.zoomTree?.depth ?? 0,
          aspectRatio: metrics.bbox.width / Math.max(1, metrics.bbox.height),
          contextCanvas: buildContextCanvas(baseImage, metrics.bbox),
        },
        signal,
        (pct, status) => {
          if (seq === infiniteZoomOpSeqRef.current) {
            setLoadingProgress(0.05 + (Math.min(100, Math.max(0, pct)) / 100) * 0.3);
            setLoadingStatus(status);
          }
        }
      );
      if (isAborted()) return;

      setLoadingProgress(0.38);
      setLoadingStatus('Synthesizing seamless region infill...');
      const cropMask = buildSelectionMask(basePuzzle, selectedSnapshot, metrics.bbox);
      const infill = synthesizeInfillCanvas(baseImage, metrics.bbox, cropMask, scenePlan, {
        mode: 'in-place',
      });
      if (isAborted()) return;

      const subResult = await PuzzleWorkerService.subdivideMaskedRegion(
        {
          rgbaData: infill.rgba,
          cropWidth: infill.width,
          cropHeight: infill.height,
          cropMask: infill.mask,
          existingPalette: basePuzzle.palette,
          isFreeColor: isFree,
        },
        (prog, status) => {
          if (seq === infiniteZoomOpSeqRef.current) {
            setLoadingProgress(0.4 + Math.min(1, Math.max(0, prog)) * 0.45);
            setLoadingStatus(status);
          }
        }
      );
      if (isAborted()) return;

      setLoadingProgress(0.88);
      setLoadingStatus('Splicing new detail regions...');
      const mergedPuzzle = mergeSubdividedRegionIntoPuzzle(
        basePuzzle,
        selectedSnapshot,
        subResult,
        metrics.bbox
      );
      const updatedCanvas = buildInPlaceUpdatedSourceCanvas(
        baseImage,
        infill.canvas,
        metrics.bbox,
        cropMask,
        basePuzzle.width,
        basePuzzle.height
      );
      const needsPng = hasCutoutExteriorMask(basePuzzle);
      const updatedBlob = await canvasToBlobAsync(
        updatedCanvas,
        needsPng ? 'image/png' : 'image/webp',
        needsPng ? undefined : 0.94
      );
      if (isAborted()) return;

      const { img: updatedImg, objectUrl: newBlobUrl } = await decodeBlobToImage(updatedBlob);
      if (isAborted()) {
        revokeObjectUrlSafely(newBlobUrl);
        return;
      }

      await commitInPlaceSubdivision({
        seq,
        signal,
        snapId,
        existingSnap,
        basePuzzle,
        baseImage,
        mergedPuzzle,
        updatedImg,
        updatedBlob,
        newBlobUrl,
        previousBlob,
        selectedSnapshot,
        addedRegionCount: subResult.regions.length,
        addedSwatches: subResult.addedSwatches,
        paintedCount: metrics.paintedCount,
        sanitizedPrompt: scenePlan.sanitizedPrompt,
        tierUsed: scenePlan.tierUsed,
        isFree,
      });
    },
    [
      activeSave,
      activeSnapshotId,
      commitInPlaceSubdivision,
      isFreeColorMode,
      setLoadingProgress,
      setLoadingStatus,
      settingsRef,
      snapshots,
    ]
  );

  const executeChildTilePromotion = useCallback(
    async (
      seq: number,
      signal: AbortSignal,
      basePuzzle: PuzzleData,
      baseImage: HTMLImageElement,
      selectedSnapshot: Set<number>,
      metrics: SelectionMetrics,
      promptText: string
    ) => {
      const parentId = activeSnapshotId || crypto.randomUUID();
      const currentView = { ...viewportRef.current };
      const isFree = Boolean(isFreeColorMode || basePuzzle.isFreeColor);

      const contextCanvas = buildContextCanvas(baseImage, metrics.bbox);
      const scenePlan = await generateScenePlan(
        {
          direction: 'child-in',
          localAiMode: settingsRef.current.localAiMode,
          userPrompt: promptText,
          neighborPaletteHex: metrics.neighborBoundaryHexes,
          existingPaletteHex: basePuzzle.palette.map((c) => c.hex),
          depth: (activeSave?.zoomTree?.depth ?? 0) + 1,
          aspectRatio: metrics.bbox.width / Math.max(1, metrics.bbox.height),
          contextCanvas,
        },
        signal,
        (pct, status) => {
          if (seq === infiniteZoomOpSeqRef.current) {
            setLoadingProgress(0.05 + (Math.min(100, Math.max(0, pct)) / 100) * 0.35);
            setLoadingStatus(status);
          }
        }
      );
      if (signal.aborted || seq !== infiniteZoomOpSeqRef.current) return;

      setLoadingProgress(0.45);
      setLoadingStatus('Synthesizing high-detail cutout tile...');
      const cropMask = buildSelectionMask(basePuzzle, selectedSnapshot, metrics.bbox);
      const cropRgba = readSelectionCropRgba(
        baseImage,
        basePuzzle.width,
        basePuzzle.height,
        metrics.bbox
      );
      const meanChroma = cropRgba ? computeSelectionMeanChroma(cropRgba, cropMask) : 40;
      const maxDeltaE =
        meanChroma < ACHROMATIC_CHROMA_THRESHOLD
          ? ACHROMATIC_CHILD_MAX_DELTA_E
          : INFILL_MAX_DELTA_E;

      const infill = synthesizeInfillCanvas(baseImage, metrics.bbox, cropMask, scenePlan, {
        mode: 'child-tile',
        maxDeltaE,
      });
      const pngBlob = await canvasToBlobAsync(infill.canvas, 'image/png');
      if (signal.aborted || seq !== infiniteZoomOpSeqRef.current) return;

      const { img: childImg, objectUrl } = await decodeBlobToImage(pngBlob);
      if (signal.aborted || seq !== infiniteZoomOpSeqRef.current) {
        revokeObjectUrlSafely(objectUrl);
        return;
      }

      persistParentSnapshotBeforeDetailTile(parentId, currentView);
      const boundsInParent = {
        x: metrics.bbox.minX / Math.max(1, basePuzzle.width),
        y: metrics.bbox.minY / Math.max(1, basePuzzle.height),
        width: metrics.bbox.width / Math.max(1, basePuzzle.width),
        height: metrics.bbox.height / Math.max(1, basePuzzle.height),
      };
      const childZoomTree: InfiniteZoomNodeMeta = {
        depth: (activeSave?.zoomTree?.depth ?? 0) + 1,
        direction: 'child-in',
        boundsInParent,
        selectedRegionIds: Array.from(selectedSnapshot),
        promptHint: scenePlan.sanitizedPrompt || undefined,
        aiTierUsed: scenePlan.tierUsed,
      };
      const childConfig: GeneratorConfig = {
        ...settingsRef.current.generatorConfig,
        maxRegions: Math.min(
          900,
          Math.round((settingsRef.current.generatorConfig.maxRegions || 350) * 1.25)
        ),
        isFreeColor: isFree,
      };

      markTutorialActionTried('create_gallery');
      triggerFeatureOffer('infinite_zoom');
      abortControllerRef.current = null;
      cancelHandoffRef.current = { restoreSnapshotId: parentId, createdSnapshotId: null };
      await loadArtworkFromImage(
        childImg,
        buildChildTileTitle(activeTitle, scenePlan.sanitizedPrompt),
        childConfig,
        new Set(),
        undefined,
        undefined,
        null,
        false,
        pngBlob,
        undefined,
        undefined,
        undefined,
        isFree,
        parentId,
        {
          zoomTree: childZoomTree,
          linkParentId: parentId,
          preserveLosslessAlpha: true,
          onRegistered: (snapId) => {
            if (cancelHandoffRef.current) {
              cancelHandoffRef.current.createdSnapshotId = snapId;
            }
          },
        }
      );
      revokeObjectUrlSafely(objectUrl);
    },
    [
      activeSave?.zoomTree?.depth,
      activeSnapshotId,
      activeTitle,
      isFreeColorMode,
      loadArtworkFromImage,
      markTutorialActionTried,
      persistParentSnapshotBeforeDetailTile,
      setLoadingProgress,
      setLoadingStatus,
      settingsRef,
      triggerFeatureOffer,
      viewportRef,
    ]
  );

  const handleConfirmRegionSubdivision = useCallback(async () => {
    if (!puzzle || !sourceImage || selectedRegionIds.size === 0 || isInfiniteZoomDisabled) return;

    const selectedCopy = new Set(selectedRegionIds);
    const metrics = computeSelectionMetrics(
      puzzle,
      selectedCopy,
      filledRegionIds,
      paintedRegionColors
    );
    if (metrics.regionCount === 0) return;

    const promptText = infiniteZoomPrompt;
    exitRegionSelectionMode();
    clearUndoSubdivision();

    const seq = ++infiniteZoomOpSeqRef.current;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsInfiniteZoomRunning(true);
    setIsLoading(true);
    setLoadingProgress(0.03);
    setLoadingStatus(
      metrics.mode === 'in-place'
        ? 'Planning local in-place detail...'
        : 'Planning deep cutout child tile...'
    );
    setLoadingPayload(null);

    let handedOffToLoader = false;
    try {
      if (metrics.mode === 'in-place') {
        await executeInPlaceSubdivision(
          seq,
          controller.signal,
          puzzle,
          sourceImage,
          selectedCopy,
          metrics,
          promptText
        );
      } else {
        handedOffToLoader = true;
        await executeChildTilePromotion(
          seq,
          controller.signal,
          puzzle,
          sourceImage,
          selectedCopy,
          metrics,
          promptText
        );
      }
    } catch (err) {
      if (!isAbortLikeError(err)) {
        reportSwallowed('InfiniteZoom.confirmSubdivision', err);
        console.error('Infinite Zoom subdivision failed:', err);
      }
      handedOffToLoader = false;
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      if (seq === infiniteZoomOpSeqRef.current && !handedOffToLoader) {
        setIsInfiniteZoomRunning(false);
        setIsLoading(false);
        setLoadingPayload(null);
      }
    }
  }, [
    clearUndoSubdivision,
    executeChildTilePromotion,
    executeInPlaceSubdivision,
    exitRegionSelectionMode,
    filledRegionIds,
    infiniteZoomPrompt,
    isInfiniteZoomDisabled,
    paintedRegionColors,
    puzzle,
    selectedRegionIds,
    setIsLoading,
    setLoadingPayload,
    setLoadingProgress,
    setLoadingStatus,
    sourceImage,
  ]);

  const runExtendBordersPipeline = useCallback(
    async (
      seq: number,
      signal: AbortSignal,
      baseImage: HTMLImageElement,
      sides: BorderExtensionSides,
      aspectRatio: number,
      promptText: string
    ): Promise<boolean> => {
      const isAborted = () => signal.aborted || seq !== infiniteZoomOpSeqRef.current;
      const scenePlan = await generateScenePlan(
        {
          direction: 'extend-out',
          localAiMode: settingsRef.current.localAiMode,
          userPrompt: promptText,
          extendedSides: sides,
          existingPaletteHex: puzzle ? puzzle.palette.map((c) => c.hex) : [],
          depth: (activeSave?.zoomTree?.depth ?? 0) - 1,
          aspectRatio,
          contextCanvas: buildContextCanvas(baseImage),
        },
        signal,
        (pct, status) => {
          if (seq === infiniteZoomOpSeqRef.current) {
            setLoadingProgress(0.05 + (Math.min(100, Math.max(0, pct)) / 100) * 0.35);
            setLoadingStatus(status);
          }
        }
      );
      if (isAborted()) return false;

      setLoadingProgress(0.45);
      setLoadingStatus('Synthesizing extended canvas borders...');
      const extResult = synthesizeExtendedBorderCanvas(baseImage, sides, scenePlan);
      const blob = await canvasToBlobAsync(extResult.canvas, 'image/webp', 0.94);
      if (isAborted()) return false;

      const { img: outerImg, objectUrl } = await decodeBlobToImage(blob);
      if (isAborted()) {
        revokeObjectUrlSafely(objectUrl);
        return false;
      }

      const innerId = activeSnapshotId || crypto.randomUUID();
      persistParentSnapshotBeforeDetailTile(innerId, { ...viewportRef.current });

      const isFree = Boolean(isFreeColorMode || puzzle?.isFreeColor);
      const outerZoomTree: InfiniteZoomNodeMeta = {
        depth: (activeSave?.zoomTree?.depth ?? 0) - 1,
        direction: 'extend-out',
        extendedSides: { ...sides },
        childSnapshotIds: [innerId],
        promptHint: scenePlan.sanitizedPrompt || undefined,
        aiTierUsed: scenePlan.tierUsed,
      };

      markTutorialActionTried('create_gallery');
      triggerFeatureOffer('infinite_zoom');
      abortControllerRef.current = null;
      cancelHandoffRef.current = { restoreSnapshotId: innerId, createdSnapshotId: null };
      await loadArtworkFromImage(
        outerImg,
        buildExtendedTitle(activeTitle, scenePlan.sanitizedPrompt),
        { ...settingsRef.current.generatorConfig, isFreeColor: isFree },
        new Set(),
        undefined,
        undefined,
        null,
        false,
        blob,
        undefined,
        undefined,
        undefined,
        isFree,
        undefined,
        {
          zoomTree: outerZoomTree,
          linkChildId: innerId,
          peerZoomTreePatch: { boundsInParent: extResult.boundsInParent },
          onRegistered: (snapId) => {
            if (cancelHandoffRef.current) {
              cancelHandoffRef.current.createdSnapshotId = snapId;
            }
          },
        }
      );
      revokeObjectUrlSafely(objectUrl);
      return true;
    },
    [
      activeSave,
      activeSnapshotId,
      activeTitle,
      isFreeColorMode,
      loadArtworkFromImage,
      markTutorialActionTried,
      persistParentSnapshotBeforeDetailTile,
      puzzle,
      setLoadingProgress,
      setLoadingStatus,
      settingsRef,
      triggerFeatureOffer,
      viewportRef,
    ]
  );

  const handleConfirmExtendBorders = useCallback(
    async (sides: BorderExtensionSides, promptOverride?: string) => {
      if (!sourceImage || isInfiniteZoomDisabled) return;
      const srcW = sourceImage.naturalWidth || sourceImage.width;
      const srcH = sourceImage.naturalHeight || sourceImage.height;
      const check = canExtendSides(srcW, srcH, sides);
      if (!check.allowed) return;

      const promptText = typeof promptOverride === 'string' ? promptOverride : infiniteZoomPrompt;
      exitRegionSelectionMode();
      clearUndoSubdivision();

      const seq = ++infiniteZoomOpSeqRef.current;
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setIsInfiniteZoomRunning(true);
      setIsLoading(true);
      setLoadingProgress(0.04);
      setLoadingStatus('Planning outward border extension...');
      setLoadingPayload(null);

      let handedOffToLoader = false;
      try {
        handedOffToLoader = await runExtendBordersPipeline(
          seq,
          controller.signal,
          sourceImage,
          sides,
          check.aspectRatio,
          promptText
        );
      } catch (err) {
        if (!isAbortLikeError(err)) {
          reportSwallowed('InfiniteZoom.extendBorders', err);
          console.error('Infinite Zoom border extension failed:', err);
        }
        handedOffToLoader = false;
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
        if (seq === infiniteZoomOpSeqRef.current && !handedOffToLoader) {
          setIsInfiniteZoomRunning(false);
          setIsLoading(false);
          setLoadingPayload(null);
        }
      }
    },
    [
      clearUndoSubdivision,
      exitRegionSelectionMode,
      infiniteZoomPrompt,
      isInfiniteZoomDisabled,
      runExtendBordersPipeline,
      setIsLoading,
      setLoadingPayload,
      setLoadingProgress,
      setLoadingStatus,
      sourceImage,
    ]
  );

  const handleUndoSubdivision = useCallback(async () => {
    const snap = undoSubdivisionRef.current;
    if (!snap || snap.snapshotId !== activeSnapshotId) {
      clearUndoSubdivision();
      return;
    }

    clearUndoToastTimer();
    setUndoSubdivisionState(null);

    const { snapshotId } = snap;
    const isFree = Boolean(isFreeColorMode || snap.puzzle.isFreeColor);
    const nextResetEpoch = collectMonotonicResetEpoch(
      snapshotId,
      activeSave,
      liveCoopRef.current.activeSave
    );

    if (snap.newBlobUrl && snap.newBlobUrl !== snap.previousBlobUrl) {
      revokeObjectUrlSafely(snap.newBlobUrl);
    }
    activeBlobUrlRef.current = snap.previousBlobUrl;

    if (snap.previousBlob) {
      await StorageService.saveImageBlob(snapshotId, snap.previousBlob).catch((err) => {
        reportSwallowed('InfiniteZoom.undoSaveImageBlob', err, { id: snapshotId });
      });
    }

    StorageService.updateSnapshotMetadata(snapshotId, {
      sampleAssetPath: snap.previousMeta.sampleAssetPath,
      isAutoSample: snap.previousMeta.isAutoSample,
      sourceRef: snap.previousMeta.sourceRef,
      zoomTree: snap.previousMeta.zoomTree,
      previewDataUrl: snap.previousMeta.previewDataUrl,
    });

    const orderedFilled = Array.from(snap.filledRegionIds);
    const paintedObj = Object.fromEntries(snap.paintedRegionColors);
    const { zoomScale, panOffsetX, panOffsetY } = viewportRef.current;
    const previewUrl =
      snap.previousMeta.previewDataUrl ||
      generatePreviewDataUrl(
        snap.puzzle,
        snap.sourceImage,
        snap.filledRegionIds,
        snap.paintedRegionColors
      );
    const estSaveBytes = StorageService.estimatePuzzleSaveBytes(snap.puzzle, previewUrl);

    const updatedSnapshots = StorageService.updateSnapshotProgress(
      snapshotId,
      snap.filledRegionIds.size,
      snap.puzzle.regions.length,
      orderedFilled,
      zoomScale,
      panOffsetX,
      panOffsetY,
      previewUrl,
      paintedObj,
      snap.puzzle.palette,
      isFree,
      estSaveBytes,
      nextResetEpoch
    );
    const syncedSave = updatedSnapshots.find((s) => s.id === snapshotId);

    await StorageService.savePuzzleData(snapshotId, snap.puzzle).catch((err) => {
      reportSwallowed('InfiniteZoom.undoSavePuzzleData', err, { id: snapshotId });
    });

    StorageService.saveActiveState({
      activeSnapshotId: snapshotId,
      activeColorId: snap.activeColorId,
      filledRegionIds: orderedFilled,
      paintedRegionColors: paintedObj,
      isFreeColorMode: isFree,
      resetEpoch: nextResetEpoch,
      zoomScale,
      panOffsetX,
      panOffsetY,
    });

    liveCoopRef.current = {
      ...liveCoopRef.current,
      puzzle: snap.puzzle,
      activeSave: syncedSave ?? liveCoopRef.current.activeSave,
      filledRegionIds: snap.filledRegionIds,
      paintedRegionColors: snap.paintedRegionColors,
      activeColorId: snap.activeColorId,
    };
    setSourceImage(snap.sourceImage);
    setPuzzle(snap.puzzle);
    setFilledRegionIds(snap.filledRegionIds);
    setPaintedRegionColors(snap.paintedRegionColors);
    setActiveColorId(snap.activeColorId);
    setHintRegionId(null);
    syncUndoStack(snap.undoStack);
    syncRedoStack(snap.redoStack);
    setSnapshots(updatedSnapshots);
    NativeBridge.haptic('tick', settingsRef.current.hapticsEnabled);
  }, [
    activeBlobUrlRef,
    activeSave,
    activeSnapshotId,
    clearUndoSubdivision,
    clearUndoToastTimer,
    isFreeColorMode,
    liveCoopRef,
    setActiveColorId,
    setFilledRegionIds,
    setHintRegionId,
    setPaintedRegionColors,
    setPuzzle,
    setSnapshots,
    setSourceImage,
    settingsRef,
    syncRedoStack,
    syncUndoStack,
    undoSubdivisionRef,
    viewportRef,
  ]);

  return {
    isRegionSelectionMode,
    selectedRegionIds,
    selectionMetrics,
    pendingSwitchRegionId,
    selectionNotice,
    infiniteZoomPrompt,
    setInfiniteZoomPrompt,
    isInfiniteZoomRunning: effectiveInfiniteZoomRunning,
    isInfiniteZoomDisabled,
    infiniteZoomDisabledReason,
    undoSubdivisionState,
    childSave,
    handleJumpToChildPuzzle,
    handleEnterRegionSelectionMode,
    exitRegionSelectionMode,
    handleRegionSelectTap,
    handleRegionSelectDragAdd,
    handleSwitchSelectionToPending,
    handleClearSelection,
    handleConfirmRegionSubdivision,
    handleConfirmExtendBorders,
    handleUndoSubdivision,
    clearUndoSubdivision,
    cancelActiveInfiniteZoom,
    handleBeforeSnapshotResetOrSwitch,
  };
}
