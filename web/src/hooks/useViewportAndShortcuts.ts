import { Dispatch, MutableRefObject, SetStateAction, useCallback, useEffect, useRef, useState } from 'react';
import { NormalizedRect, PuzzleData, SavedSnapshot } from '../types';
import { StorageService } from '../services/StorageService';
import { NativeBridge } from '../services/NativeBridge';
import { getVisiblePalette } from '../components/PaletteDock';
import type { FocusBoundsRequest } from '../components/puzzleCanvasHelpers';
import { TutorialTriedActions } from '../components/OnboardingTutorial';
import { getAllPuzzleRegions, getTotalRegionCount } from '../engine/UnifiedPuzzleLayers';
import type { CoopLiveState, CoopViewport } from './useCoopSession';
import { useIsomorphicLayoutEffect, useLatest } from './useLatest';

export interface PanStepRequest {
  seq: number;
  dx: number;
  dy: number;
}

export interface ViewportExtentSnapshot {
  snapshotId: string;
  zoomScale: number;
  panOffsetX: number;
  panOffsetY: number;
}

interface PendingViewportExtent extends ViewportExtentSnapshot {
  puzzle: PuzzleData;
}

export interface UseViewportAndShortcutsParams {
  puzzle: PuzzleData | null;
  isLoading: boolean;
  isLoadingRef: MutableRefObject<boolean>;
  isReplaying: boolean;
  showSettings: boolean;
  showPaletteOptions: boolean;
  isUndoEnabled: boolean;
  viewportRef: MutableRefObject<CoopViewport>;
  canvasContainerSizeRef: MutableRefObject<{ width: number; height: number }>;
  flushPendingViewportSaveRef: MutableRefObject<() => void>;
  snapshotTransitioningRef: MutableRefObject<boolean>;
  liveCoopRef: MutableRefObject<CoopLiveState>;
  setSnapshots: Dispatch<SetStateAction<SavedSnapshot[]>>;
  setActiveColorId: Dispatch<SetStateAction<number>>;
  setHintRegionId: Dispatch<SetStateAction<number | null>>;
  handleUndo: (bypassReplayCheck?: boolean) => void;
  handleRedo: (bypassReplayCheck?: boolean) => void;
  dismissPostLoadReplayIfAwaiting: () => boolean;
  markTutorialActionTried: (action: keyof TutorialTriedActions) => void;
}

export type ShortcutAction =
  | { kind: 'zoom_in' }
  | { kind: 'zoom_out' }
  | { kind: 'reset_view' }
  | { kind: 'pan'; dx: number; dy: number };

const VIEWPORT_SHORTCUT_MAP: Record<string, ShortcutAction> = {
  '+': { kind: 'zoom_in' },
  '=': { kind: 'zoom_in' },
  '-': { kind: 'zoom_out' },
  _: { kind: 'zoom_out' },
  '0': { kind: 'reset_view' },
  ArrowUp: { kind: 'pan', dx: 0, dy: 64 },
  w: { kind: 'pan', dx: 0, dy: 64 },
  W: { kind: 'pan', dx: 0, dy: 64 },
  ArrowDown: { kind: 'pan', dx: 0, dy: -64 },
  s: { kind: 'pan', dx: 0, dy: -64 },
  S: { kind: 'pan', dx: 0, dy: -64 },
  ArrowLeft: { kind: 'pan', dx: 64, dy: 0 },
  a: { kind: 'pan', dx: 64, dy: 0 },
  A: { kind: 'pan', dx: 64, dy: 0 },
  ArrowRight: { kind: 'pan', dx: -64, dy: 0 },
  d: { kind: 'pan', dx: -64, dy: 0 },
  D: { kind: 'pan', dx: -64, dy: 0 },
};

/**
 * Pure helper detecting editable DOM elements so global shortcuts never hijack typing.
 */
export function isEditableKeyboardTarget(el: EventTarget | null): boolean {
  if (!el || typeof el !== 'object') return false;
  const node = el as HTMLElement;
  const tag = node.tagName ? node.tagName.toUpperCase() : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (node.isContentEditable || node.contentEditable === 'true') return true;
  return false;
}

/**
 * Pure helper resolving non-modifier viewport keyboard shortcuts (`+/-`, `0`, Arrow/WASD).
 */
export function resolveViewportShortcutAction(key: string): ShortcutAction | null {
  return VIEWPORT_SHORTCUT_MAP[key] ?? null;
}

/**
 * Pure epsilon comparator for debounced viewport persistence deduplication.
 */
export function isSameViewportExtent(
  a: ViewportExtentSnapshot | null,
  snapshotId: string,
  zoomScale: number,
  panOffsetX: number,
  panOffsetY: number
): boolean {
  if (!a || a.snapshotId !== snapshotId) return false;
  return (
    Math.abs(a.zoomScale - zoomScale) < 1e-6 &&
    Math.abs(a.panOffsetX - panOffsetX) < 1e-4 &&
    Math.abs(a.panOffsetY - panOffsetY) < 1e-4
  );
}

/**
 * Pure Set-equality guard preventing redundant React state updates on identical visible sets.
 */
export function mergeNumberSetIfChanged(prev: Set<number>, next: Set<number>): Set<number> {
  if (prev.size === next.size) {
    let same = true;
    for (const id of next) {
      if (!prev.has(id)) {
        same = false;
        break;
      }
    }
    if (same) return prev;
  }
  return next;
}

function getDocumentFullscreenActive(): boolean {
  if (typeof document === 'undefined') return false;
  return Boolean(
    document.fullscreenElement ||
      (document as Document & { webkitFullscreenElement?: Element | null }).webkitFullscreenElement
  );
}

export function useViewportAndShortcuts(params: UseViewportAndShortcutsParams) {
  const {
    puzzle,
    isLoading,
    isLoadingRef,
    isReplaying,
    showSettings,
    showPaletteOptions,
    isUndoEnabled,
    viewportRef,
    canvasContainerSizeRef,
    flushPendingViewportSaveRef,
    snapshotTransitioningRef,
    liveCoopRef,
    setSnapshots,
    setActiveColorId,
    setHintRegionId,
    handleUndo,
    handleRedo,
    dismissPostLoadReplayIfAwaiting,
    markTutorialActionTried,
  } = params;

  const [visibleColorIds, setVisibleColorIds] = useState<Set<number>>(new Set());
  const [visibleRegionIds, setVisibleRegionIds] = useState<Set<number>>(new Set());
  const visibleColorIdsRef = useLatest(visibleColorIds);
  const visibleRegionIdsRef = useLatest(visibleRegionIds);

  const [zoomInTrigger, setZoomInTrigger] = useState<number>(0);
  const [zoomOutTrigger, setZoomOutTrigger] = useState<number>(0);
  const [resetViewTrigger, setResetViewTrigger] = useState<number>(0);
  const [restoreViewTrigger, setRestoreViewTrigger] = useState<number>(0);
  const [panStepRequest, setPanStepRequest] = useState<PanStepRequest>({
    seq: 0,
    dx: 0,
    dy: 0,
  });
  const [focusBoundsRequest, setFocusBoundsRequest] = useState<FocusBoundsRequest | null>(null);
  const focusSeqRef = useRef<number>(0);
  const [isCanvasTransformed, setIsCanvasTransformed] = useState<boolean>(false);
  const [initialViewport, setInitialViewport] = useState<CoopViewport>({
    zoomScale: 1,
    panOffsetX: 0,
    panOffsetY: 0,
  });
  const [isFullscreen, setIsFullscreen] = useState<boolean>(getDocumentFullscreenActive);

  const viewportSaveTimerRef = useRef<number | null>(null);
  const pendingViewportExtentRef = useRef<PendingViewportExtent | null>(null);
  const lastSavedViewportRef = useRef<ViewportExtentSnapshot | null>(null);

  const applyViewport = useCallback(
    (view: CoopViewport) => {
      viewportRef.current = view;
      setInitialViewport(view);
      setRestoreViewTrigger((prev) => prev + 1);
    },
    [viewportRef]
  );

  const focusViewportOnBounds = useCallback((bounds: NormalizedRect) => {
    focusSeqRef.current += 1;
    setFocusBoundsRequest({
      seq: focusSeqRef.current,
      bounds: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      },
    });
  }, []);

  const clearPendingViewportSave = useCallback(() => {
    if (viewportSaveTimerRef.current !== null) {
      window.clearTimeout(viewportSaveTimerRef.current);
      viewportSaveTimerRef.current = null;
    }
    pendingViewportExtentRef.current = null;
    lastSavedViewportRef.current = null;
  }, []);

  const persistActiveViewportOnly = useCallback(
    (snapshotId: string, zoomScale: number, panOffsetX: number, panOffsetY: number) => {
      if (snapshotTransitioningRef.current) return;
      const updated = StorageService.updateSnapshotViewport(
        snapshotId,
        zoomScale,
        panOffsetX,
        panOffsetY
      );
      setSnapshots(updated);
      if (!updated.some((s) => s.id === snapshotId)) return;
      const existingActive = StorageService.loadActiveState();
      if (!existingActive || existingActive.activeSnapshotId !== snapshotId) return;
      StorageService.saveActiveState({
        ...existingActive,
        zoomScale,
        panOffsetX,
        panOffsetY,
      });
      lastSavedViewportRef.current = {
        snapshotId,
        zoomScale,
        panOffsetX,
        panOffsetY,
      };
    },
    [setSnapshots, snapshotTransitioningRef]
  );

  const flushPendingViewportSave = useCallback(() => {
    const pending = pendingViewportExtentRef.current;
    clearPendingViewportSave();
    const cur = liveCoopRef.current;
    if (
      snapshotTransitioningRef.current ||
      !cur.activeSnapshotId ||
      !cur.puzzle ||
      (pending && (pending.snapshotId !== cur.activeSnapshotId || pending.puzzle !== cur.puzzle))
    ) {
      return;
    }
    const { zoomScale, panOffsetX, panOffsetY } = pending || viewportRef.current;
    persistActiveViewportOnly(cur.activeSnapshotId, zoomScale, panOffsetX, panOffsetY);
  }, [
    clearPendingViewportSave,
    liveCoopRef,
    persistActiveViewportOnly,
    snapshotTransitioningRef,
    viewportRef,
  ]);

  useIsomorphicLayoutEffect(() => {
    flushPendingViewportSaveRef.current = flushPendingViewportSave;
  }, [flushPendingViewportSave, flushPendingViewportSaveRef]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(getDocumentFullscreenActive());
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (viewportSaveTimerRef.current !== null) {
        window.clearTimeout(viewportSaveTimerRef.current);
        viewportSaveTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const handlePageFlush = () => {
      if (viewportSaveTimerRef.current !== null) {
        flushPendingViewportSave();
      }
    };
    window.addEventListener('beforeunload', handlePageFlush);
    window.addEventListener('pagehide', handlePageFlush);
    return () => {
      window.removeEventListener('beforeunload', handlePageFlush);
      window.removeEventListener('pagehide', handlePageFlush);
    };
  }, [flushPendingViewportSave]);

  const handleVisibleColorsChanged = useCallback((next: Set<number>) => {
    setVisibleColorIds((prev) => mergeNumberSetIfChanged(prev, next));
  }, []);

  const handleVisibleRegionsChanged = useCallback((next: Set<number>) => {
    setVisibleRegionIds((prev) => mergeNumberSetIfChanged(prev, next));
  }, []);

  const handleToggleFullscreen = useCallback(async () => {
    markTutorialActionTried('peek_fullscreen');
    try {
      const doc = document as Document & {
        webkitFullscreenElement?: Element | null;
        webkitExitFullscreen?: () => Promise<void>;
      };
      if (doc.fullscreenElement || doc.webkitFullscreenElement) {
        if (doc.exitFullscreen) {
          await doc.exitFullscreen();
        } else if (doc.webkitExitFullscreen) {
          await doc.webkitExitFullscreen();
        }
      } else {
        const el = document.documentElement as HTMLElement & {
          webkitRequestFullscreen?: () => Promise<void>;
        };
        if (el.requestFullscreen) {
          await el.requestFullscreen();
        } else if (el.webkitRequestFullscreen) {
          await el.webkitRequestFullscreen();
        }
      }
    } catch (err) {
      console.warn('Fullscreen request failed or was blocked:', err);
    }
  }, [markTutorialActionTried]);

  const handleViewExtentChanged = useCallback(
    (zoom: number, panX: number, panY: number, containerW?: number, containerH?: number) => {
      if (containerW && containerH && containerW > 0 && containerH > 0) {
        canvasContainerSizeRef.current = { width: containerW, height: containerH };
      }
      setIsCanvasTransformed(zoom > 1.05 || Math.abs(panX) > 6 || Math.abs(panY) > 6);
      const curState = liveCoopRef.current;
      if (
        isLoadingRef.current ||
        !curState.puzzle ||
        !curState.activeSnapshotId ||
        snapshotTransitioningRef.current
      ) {
        return;
      }

      const scheduledSnapshotId = curState.activeSnapshotId;
      const scheduledPuzzle = curState.puzzle;
      const pending = pendingViewportExtentRef.current;
      viewportRef.current = { zoomScale: zoom, panOffsetX: panX, panOffsetY: panY };

      if (
        viewportSaveTimerRef.current !== null &&
        pending &&
        pending.puzzle === scheduledPuzzle &&
        isSameViewportExtent(pending, scheduledSnapshotId, zoom, panX, panY)
      ) {
        return;
      }
      if (
        viewportSaveTimerRef.current === null &&
        isSameViewportExtent(lastSavedViewportRef.current, scheduledSnapshotId, zoom, panX, panY)
      ) {
        return;
      }

      pendingViewportExtentRef.current = {
        snapshotId: scheduledSnapshotId,
        puzzle: scheduledPuzzle,
        zoomScale: zoom,
        panOffsetX: panX,
        panOffsetY: panY,
      };
      if (viewportSaveTimerRef.current !== null) {
        window.clearTimeout(viewportSaveTimerRef.current);
      }
      viewportSaveTimerRef.current = window.setTimeout(() => {
        viewportSaveTimerRef.current = null;
        pendingViewportExtentRef.current = null;
        const cur = liveCoopRef.current;
        if (
          snapshotTransitioningRef.current ||
          cur.activeSnapshotId !== scheduledSnapshotId ||
          cur.puzzle !== scheduledPuzzle
        ) {
          return;
        }
        persistActiveViewportOnly(scheduledSnapshotId, zoom, panX, panY);
      }, 350);
    },
    [
      canvasContainerSizeRef,
      isLoadingRef,
      liveCoopRef,
      persistActiveViewportOnly,
      snapshotTransitioningRef,
      viewportRef,
    ]
  );

  const handleViewportGesture = useCallback(() => {
    markTutorialActionTried('zoom');
  }, [markTutorialActionTried]);

  const handleZoomIn = useCallback(() => {
    dismissPostLoadReplayIfAwaiting();
    markTutorialActionTried('zoom');
    setZoomInTrigger((prev) => prev + 1);
  }, [dismissPostLoadReplayIfAwaiting, markTutorialActionTried]);

  const handleZoomOut = useCallback(() => {
    dismissPostLoadReplayIfAwaiting();
    markTutorialActionTried('zoom');
    setZoomOutTrigger((prev) => prev + 1);
  }, [dismissPostLoadReplayIfAwaiting, markTutorialActionTried]);

  const handleResetView = useCallback(() => {
    dismissPostLoadReplayIfAwaiting();
    markTutorialActionTried('zoom');
    setResetViewTrigger((prev) => prev + 1);
  }, [dismissPostLoadReplayIfAwaiting, markTutorialActionTried]);

  const applyViewportShortcut = useCallback(
    (action: ShortcutAction) => {
      dismissPostLoadReplayIfAwaiting();
      markTutorialActionTried('zoom');
      if (action.kind === 'zoom_in') {
        setZoomInTrigger((prev) => prev + 1);
      } else if (action.kind === 'zoom_out') {
        setZoomOutTrigger((prev) => prev + 1);
      } else if (action.kind === 'reset_view') {
        setResetViewTrigger((prev) => prev + 1);
      } else {
        setPanStepRequest((prev) => ({ seq: prev.seq + 1, dx: action.dx, dy: action.dy }));
      }
    },
    [dismissPostLoadReplayIfAwaiting, markTutorialActionTried]
  );

  const handleUndoRedoShortcut = useCallback(
    (e: KeyboardEvent) => {
      const lowerKey = e.key.toLowerCase();
      const isUndoKey = !e.shiftKey && lowerKey === 'z';
      const isRedoKey = lowerKey === 'y' || (e.shiftKey && lowerKey === 'z');
      if ((!isUndoKey && !isRedoKey) || !isUndoEnabled) return;
      const wasAwaiting = dismissPostLoadReplayIfAwaiting();
      if (isReplaying && !wasAwaiting) return;
      e.preventDefault();
      if (isUndoKey) {
        handleUndo(wasAwaiting);
      } else {
        handleRedo(wasAwaiting);
      }
    },
    [dismissPostLoadReplayIfAwaiting, handleRedo, handleUndo, isReplaying, isUndoEnabled]
  );

  const handleDigitSwatchShortcut = useCallback(
    (e: KeyboardEvent, activePuzzle: PuzzleData) => {
      const wasAwaiting = dismissPostLoadReplayIfAwaiting();
      const cur = liveCoopRef.current;
      const curPuzzle = cur.puzzle ?? activePuzzle;
      const curFilled = cur.filledRegionIds;
      if ((isReplaying && !wasAwaiting) || curFilled.size >= getTotalRegionCount(curPuzzle)) return;
      const selectablePalette = getVisiblePalette(
        curPuzzle.palette,
        getAllPuzzleRegions(curPuzzle),
        curFilled,
        cur.settings.paletteSort,
        cur.isFreeColorMode
      );
      const index = Number(e.key) - 1;
      if (index < 0 || index >= selectablePalette.length) return;
      e.preventDefault();
      const chosenColId = selectablePalette[index].id;
      NativeBridge.haptic('tick', cur.settings.hapticsEnabled);
      liveCoopRef.current = { ...cur, activeColorId: chosenColId };
      setActiveColorId(chosenColId);
      setHintRegionId(null);
      markTutorialActionTried('palette');
    },
    [
      dismissPostLoadReplayIfAwaiting,
      isReplaying,
      liveCoopRef,
      markTutorialActionTried,
      setActiveColorId,
      setHintRegionId,
    ]
  );

  // Global keyboard shortcuts: Ctrl/Cmd+Z/Y, 1..9 swatches, +/-, 0, Arrow/WASD
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (showSettings || showPaletteOptions || isLoading) return;
      if (
        isEditableKeyboardTarget(e.target) ||
        (typeof document !== 'undefined' && isEditableKeyboardTarget(document.activeElement))
      ) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        handleUndoRedoShortcut(e);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || !puzzle) return;
      if (e.key >= '1' && e.key <= '9') {
        handleDigitSwatchShortcut(e, puzzle);
        return;
      }
      const action = resolveViewportShortcutAction(e.key);
      if (action) {
        e.preventDefault();
        applyViewportShortcut(action);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    showSettings,
    showPaletteOptions,
    isLoading,
    puzzle,
    handleUndoRedoShortcut,
    handleDigitSwatchShortcut,
    applyViewportShortcut,
  ]);

  return {
    visibleColorIds,
    visibleRegionIds,
    visibleColorIdsRef,
    visibleRegionIdsRef,
    isFullscreen,
    zoomInTrigger,
    zoomOutTrigger,
    resetViewTrigger,
    restoreViewTrigger,
    panStepRequest,
    focusBoundsRequest,
    isCanvasTransformed,
    initialViewport,
    applyViewport,
    focusViewportOnBounds,
    clearPendingViewportSave,
    flushPendingViewportSave,
    handleVisibleColorsChanged,
    handleVisibleRegionsChanged,
    handleToggleFullscreen,
    handleViewExtentChanged,
    handleViewportGesture,
    handleZoomIn,
    handleZoomOut,
    handleResetView,
  };
}
