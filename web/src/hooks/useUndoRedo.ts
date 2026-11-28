import { Dispatch, MutableRefObject, SetStateAction, useCallback, useState } from 'react';
import { PuzzleData, Region, SavedSnapshot, UserSettings } from '../types';
import { StorageService } from '../services/StorageService';
import { NativeBridge } from '../services/NativeBridge';
import { FeatureOfferId } from '../services/FeatureOffersService';
import { useLatest } from './useLatest';

export interface UndoHistoryEntry {
  regionId: number;
  wasPreviouslyFilled: boolean;
  previousPaintedColorId?: number;
  paintedColorId?: number;
}

export interface UndoRedoViewport {
  zoomScale: number;
  panOffsetX: number;
  panOffsetY: number;
}

export interface UndoRedoLiveState {
  puzzle: PuzzleData | null;
  activeSnapshotId: string | null;
  filledRegionIds: Set<number>;
  paintedRegionColors: Map<number, number>;
  isFreeColorMode: boolean;
  activeColorId: number;
  settings: UserSettings;
}

export type UndoRedoCoopEmission =
  | {
      kind: 'FILL';
      regionIds: number[];
      paintedColors?: Record<number, number>;
    }
  | {
      kind: 'UNFILL';
      regionIds: number[];
    };

export interface UndoRedoTransitionResult {
  nextUndoStack: UndoHistoryEntry[];
  nextRedoStack: UndoHistoryEntry[];
  nextFilledRegionIds: Set<number>;
  nextPaintedRegionColors: Map<number, number>;
  nextActiveColorId: number;
  shouldUpdateActiveColor: boolean;
  coopEmission: UndoRedoCoopEmission | null;
  entry: UndoHistoryEntry;
}

export interface UndoRedoTransitionInput {
  puzzle: PuzzleData | null;
  currentPuzzle?: PuzzleData | null;
  regionById?: Map<number, Region>;
  isReplaying: boolean;
  bypassReplayCheck?: boolean;
  isFreeColorMode: boolean;
  activeColorId: number;
  settings: Pick<UserSettings, 'enableUndo'>;
  filledRegionIds: Set<number>;
  paintedRegionColors: Map<number, number>;
  undoStack: readonly UndoHistoryEntry[];
  redoStack: readonly UndoHistoryEntry[];
}

export function computeIsUndoEnabled(
  settings: Pick<UserSettings, 'enableUndo'>,
  isFreeColorMode: boolean,
  puzzle: Pick<PuzzleData, 'isFreeColor'> | null | undefined
): boolean {
  return Boolean(settings.enableUndo || isFreeColorMode || puzzle?.isFreeColor);
}

export function resolveUndoRedoRegion(
  puzzle: PuzzleData,
  regionId: number,
  currentPuzzle?: PuzzleData | null,
  regionById?: Map<number, Region>
): Region | undefined {
  if (currentPuzzle && puzzle === currentPuzzle && regionById) {
    return regionById.get(regionId);
  }
  return puzzle.regions.find((r) => r.id === regionId);
}

export function applyUndoTransition(
  input: UndoRedoTransitionInput
): UndoRedoTransitionResult | null {
  const {
    puzzle,
    currentPuzzle,
    regionById,
    isReplaying,
    bypassReplayCheck = false,
    isFreeColorMode,
    activeColorId,
    settings,
    filledRegionIds,
    paintedRegionColors,
    undoStack,
    redoStack,
  } = input;

  if (
    !puzzle ||
    (isReplaying && bypassReplayCheck !== true) ||
    undoStack.length === 0 ||
    !computeIsUndoEnabled(settings, isFreeColorMode, puzzle)
  ) {
    return null;
  }

  const lastAction = undoStack[undoStack.length - 1];
  const nextUndoStack = undoStack.slice(0, -1);
  const nextRedoStack = [...redoStack, lastAction];
  const nextFilledRegionIds = new Set(filledRegionIds);
  const nextPaintedRegionColors = new Map(paintedRegionColors);
  const undoneRegion = resolveUndoRedoRegion(
    puzzle,
    lastAction.regionId,
    currentPuzzle,
    regionById
  );

  let coopEmission: UndoRedoCoopEmission | null = null;
  if (lastAction.wasPreviouslyFilled) {
    if (lastAction.previousPaintedColorId !== undefined) {
      nextPaintedRegionColors.set(lastAction.regionId, lastAction.previousPaintedColorId);
      coopEmission = {
        kind: 'FILL',
        regionIds: [lastAction.regionId],
        paintedColors: { [lastAction.regionId]: lastAction.previousPaintedColorId },
      };
    } else {
      nextPaintedRegionColors.delete(lastAction.regionId);
      if (undoneRegion) {
        coopEmission = {
          kind: 'FILL',
          regionIds: [lastAction.regionId],
          paintedColors: { [lastAction.regionId]: undoneRegion.colorId },
        };
      }
    }
  } else {
    nextFilledRegionIds.delete(lastAction.regionId);
    nextPaintedRegionColors.delete(lastAction.regionId);
    coopEmission = {
      kind: 'UNFILL',
      regionIds: [lastAction.regionId],
    };
  }

  const shouldUpdateActiveColor = Boolean(undoneRegion && !isFreeColorMode);
  const nextActiveColorId =
    shouldUpdateActiveColor && undoneRegion ? undoneRegion.colorId : activeColorId;

  return {
    nextUndoStack,
    nextRedoStack,
    nextFilledRegionIds,
    nextPaintedRegionColors,
    nextActiveColorId,
    shouldUpdateActiveColor,
    coopEmission,
    entry: lastAction,
  };
}

export function applyRedoTransition(
  input: UndoRedoTransitionInput
): UndoRedoTransitionResult | null {
  const {
    puzzle,
    currentPuzzle,
    regionById,
    isReplaying,
    bypassReplayCheck = false,
    isFreeColorMode,
    activeColorId,
    settings,
    filledRegionIds,
    paintedRegionColors,
    undoStack,
    redoStack,
  } = input;

  if (
    !puzzle ||
    (isReplaying && bypassReplayCheck !== true) ||
    redoStack.length === 0 ||
    !computeIsUndoEnabled(settings, isFreeColorMode, puzzle)
  ) {
    return null;
  }

  const lastRedo = redoStack[redoStack.length - 1];
  const nextRedoStack = redoStack.slice(0, -1);
  const nextUndoStack = [...undoStack, lastRedo];
  const nextFilledRegionIds = new Set(filledRegionIds);
  const nextPaintedRegionColors = new Map(paintedRegionColors);
  const redoneRegion = resolveUndoRedoRegion(
    puzzle,
    lastRedo.regionId,
    currentPuzzle,
    regionById
  );

  nextFilledRegionIds.add(lastRedo.regionId);
  let redonePaintedCol: number | undefined;
  if (lastRedo.paintedColorId !== undefined) {
    nextPaintedRegionColors.set(lastRedo.regionId, lastRedo.paintedColorId);
    redonePaintedCol = lastRedo.paintedColorId;
  } else if (redoneRegion && isFreeColorMode) {
    nextPaintedRegionColors.set(lastRedo.regionId, activeColorId);
    redonePaintedCol = activeColorId;
  }

  const coopEmission: UndoRedoCoopEmission = {
    kind: 'FILL',
    regionIds: [lastRedo.regionId],
    ...(redonePaintedCol !== undefined
      ? { paintedColors: { [lastRedo.regionId]: redonePaintedCol } }
      : {}),
  };

  const shouldUpdateActiveColor = Boolean(redoneRegion && !isFreeColorMode);
  const nextActiveColorId =
    shouldUpdateActiveColor && redoneRegion ? redoneRegion.colorId : activeColorId;

  return {
    nextUndoStack,
    nextRedoStack,
    nextFilledRegionIds,
    nextPaintedRegionColors,
    nextActiveColorId,
    shouldUpdateActiveColor,
    coopEmission,
    entry: lastRedo,
  };
}

export type UndoRedoKind = 'undo' | 'redo';

export interface UseUndoRedoOptions<TLive extends UndoRedoLiveState> {
  puzzle: PuzzleData | null;
  settings: UserSettings;
  isFreeColorMode: boolean;
  liveCoopRef: MutableRefObject<TLive>;
  viewportRef: MutableRefObject<UndoRedoViewport>;
  regionByIdRef: MutableRefObject<Map<number, Region>>;
  isReplayingRef: MutableRefObject<boolean>;
  emitCoopPaint: (
    action: 'FILL' | 'UNFILL',
    regionIds: number[],
    paintedColors?: Record<number, number>
  ) => void;
  emitCoopUnfill: (regionIds: number[]) => void;
  setFilledRegionIds: Dispatch<SetStateAction<Set<number>>>;
  setPaintedRegionColors: Dispatch<SetStateAction<Map<number, number>>>;
  setActiveColorId: Dispatch<SetStateAction<number>>;
  setHintRegionId: Dispatch<SetStateAction<number | null>>;
  setSnapshots: Dispatch<SetStateAction<SavedSnapshot[]>>;
  markTutorialActionTried: (action: 'undo_redo') => void;
  triggerFeatureOffer: (offerId: FeatureOfferId) => void;
  onFocusRegion?: (regionId: number, kind: UndoRedoKind) => void;
}

export interface UseUndoRedoResult {
  undoStack: UndoHistoryEntry[];
  redoStack: UndoHistoryEntry[];
  undoStackRef: MutableRefObject<UndoHistoryEntry[]>;
  redoStackRef: MutableRefObject<UndoHistoryEntry[]>;
  syncUndoStack: (
    nextOrUpdater: UndoHistoryEntry[] | ((prev: UndoHistoryEntry[]) => UndoHistoryEntry[])
  ) => void;
  syncRedoStack: (
    nextOrUpdater: UndoHistoryEntry[] | ((prev: UndoHistoryEntry[]) => UndoHistoryEntry[])
  ) => void;
  isUndoEnabled: boolean;
  handleUndo: (bypassReplayCheck?: boolean) => void;
  handleRedo: (bypassReplayCheck?: boolean) => void;
}

export function useUndoRedo<TLive extends UndoRedoLiveState>({
  puzzle,
  settings,
  isFreeColorMode,
  liveCoopRef,
  viewportRef,
  regionByIdRef,
  isReplayingRef,
  emitCoopPaint,
  emitCoopUnfill,
  setFilledRegionIds,
  setPaintedRegionColors,
  setActiveColorId,
  setHintRegionId,
  setSnapshots,
  markTutorialActionTried,
  triggerFeatureOffer,
  onFocusRegion,
}: UseUndoRedoOptions<TLive>): UseUndoRedoResult {
  const [undoStack, setUndoStack] = useState<UndoHistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<UndoHistoryEntry[]>([]);
  const undoStackRef = useLatest(undoStack);
  const redoStackRef = useLatest(redoStack);
  const puzzleRef = useLatest(puzzle);

  const syncUndoStack = useCallback(
    (nextOrUpdater: UndoHistoryEntry[] | ((prev: UndoHistoryEntry[]) => UndoHistoryEntry[])) => {
      const next =
        typeof nextOrUpdater === 'function' ? nextOrUpdater(undoStackRef.current) : nextOrUpdater;
      undoStackRef.current = next;
      setUndoStack(next);
    },
    [undoStackRef]
  );

  const syncRedoStack = useCallback(
    (nextOrUpdater: UndoHistoryEntry[] | ((prev: UndoHistoryEntry[]) => UndoHistoryEntry[])) => {
      const next =
        typeof nextOrUpdater === 'function' ? nextOrUpdater(redoStackRef.current) : nextOrUpdater;
      redoStackRef.current = next;
      setRedoStack(next);
    },
    [redoStackRef]
  );

  const isUndoEnabled = computeIsUndoEnabled(settings, isFreeColorMode, puzzle);

  const commitTransition = useCallback(
    (cur: TLive, transition: UndoRedoTransitionResult, kind: UndoRedoKind) => {
      syncUndoStack(transition.nextUndoStack);
      syncRedoStack(transition.nextRedoStack);

      if (transition.coopEmission) {
        if (transition.coopEmission.kind === 'FILL') {
          emitCoopPaint(
            'FILL',
            transition.coopEmission.regionIds,
            transition.coopEmission.paintedColors
          );
        } else {
          emitCoopUnfill(transition.coopEmission.regionIds);
        }
      }

      liveCoopRef.current = {
        ...cur,
        filledRegionIds: transition.nextFilledRegionIds,
        paintedRegionColors: transition.nextPaintedRegionColors,
        activeColorId: transition.nextActiveColorId,
      };
      setFilledRegionIds(transition.nextFilledRegionIds);
      setPaintedRegionColors(transition.nextPaintedRegionColors);
      setHintRegionId(null);
      NativeBridge.haptic('tick', cur.settings.hapticsEnabled);
      markTutorialActionTried('undo_redo');
      if (kind === 'undo') {
        triggerFeatureOffer('undo_replay');
      }

      if (transition.shouldUpdateActiveColor) {
        setActiveColorId(transition.nextActiveColorId);
      }

      onFocusRegion?.(transition.entry.regionId, kind);

      const curSnapshotId = cur.activeSnapshotId;
      const curPuzzle = cur.puzzle;
      if (curSnapshotId && curPuzzle) {
        const paintedObj = Object.fromEntries(transition.nextPaintedRegionColors);
        const { zoomScale, panOffsetX, panOffsetY } = viewportRef.current;
        const filledList = Array.from(transition.nextFilledRegionIds);
        const updated = StorageService.updateSnapshotProgress(
          curSnapshotId,
          transition.nextFilledRegionIds.size,
          curPuzzle.regions.length,
          filledList,
          zoomScale,
          panOffsetX,
          panOffsetY,
          undefined,
          paintedObj,
          curPuzzle.palette,
          curPuzzle.isFreeColor
        );
        setSnapshots(updated);
        StorageService.saveActiveState({
          activeSnapshotId: curSnapshotId,
          activeColorId: transition.nextActiveColorId,
          filledRegionIds: filledList,
          paintedRegionColors: paintedObj,
          isFreeColorMode: cur.isFreeColorMode,
          zoomScale,
          panOffsetX,
          panOffsetY,
        });
      }
    },
    [
      emitCoopPaint,
      emitCoopUnfill,
      liveCoopRef,
      markTutorialActionTried,
      onFocusRegion,
      setActiveColorId,
      setFilledRegionIds,
      setHintRegionId,
      setPaintedRegionColors,
      setSnapshots,
      syncRedoStack,
      syncUndoStack,
      triggerFeatureOffer,
      viewportRef,
    ]
  );

  const handleUndo = useCallback(
    (bypassReplayCheck: boolean = false) => {
      const cur = liveCoopRef.current;
      const transition = applyUndoTransition({
        puzzle: cur.puzzle,
        currentPuzzle: puzzleRef.current,
        regionById: regionByIdRef.current,
        isReplaying: isReplayingRef.current,
        bypassReplayCheck,
        isFreeColorMode: cur.isFreeColorMode,
        activeColorId: cur.activeColorId,
        settings: cur.settings,
        filledRegionIds: cur.filledRegionIds,
        paintedRegionColors: cur.paintedRegionColors,
        undoStack: undoStackRef.current,
        redoStack: redoStackRef.current,
      });
      if (!transition) return;
      commitTransition(cur, transition, 'undo');
    },
    [
      commitTransition,
      isReplayingRef,
      liveCoopRef,
      puzzleRef,
      redoStackRef,
      regionByIdRef,
      undoStackRef,
    ]
  );

  const handleRedo = useCallback(
    (bypassReplayCheck: boolean = false) => {
      const cur = liveCoopRef.current;
      const transition = applyRedoTransition({
        puzzle: cur.puzzle,
        currentPuzzle: puzzleRef.current,
        regionById: regionByIdRef.current,
        isReplaying: isReplayingRef.current,
        bypassReplayCheck,
        isFreeColorMode: cur.isFreeColorMode,
        activeColorId: cur.activeColorId,
        settings: cur.settings,
        filledRegionIds: cur.filledRegionIds,
        paintedRegionColors: cur.paintedRegionColors,
        undoStack: undoStackRef.current,
        redoStack: redoStackRef.current,
      });
      if (!transition) return;
      commitTransition(cur, transition, 'redo');
    },
    [
      commitTransition,
      isReplayingRef,
      liveCoopRef,
      puzzleRef,
      redoStackRef,
      regionByIdRef,
      undoStackRef,
    ]
  );

  return {
    undoStack,
    redoStack,
    undoStackRef,
    redoStackRef,
    syncUndoStack,
    syncRedoStack,
    isUndoEnabled,
    handleUndo,
    handleRedo,
  };
}
