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
import { PuzzleData, Region, UserSettings } from '../types';
import { NativeBridge } from '../services/NativeBridge';
import { FeatureOfferId } from '../services/FeatureOffersService';
import { clampCanvasOffset } from '../components/PuzzleCanvas';
import { TUTORIAL_STEPS } from '../components/OnboardingTutorial';
import { useLatest } from './useLatest';
import { UndoHistoryEntry } from './useUndoRedo';
import { buildUnifiedRegionIndex, UnifiedRegionRef } from '../engine/UnifiedPuzzleLayers';

export interface ReplayViewport {
  zoomScale: number;
  panOffsetX: number;
  panOffsetY: number;
}

export interface ReplayContainerSize {
  width: number;
  height: number;
}

export interface ReplayScratchPoint {
  x: number;
  y: number;
}

export interface ReplayLiveState {
  puzzle: PuzzleData | null;
  filledRegionIds: Set<number>;
  settings: UserSettings;
}

export type ReplayRegionBounds =
  | Pick<Region, 'minX' | 'maxX' | 'minY' | 'maxY'>
  | Pick<UnifiedRegionRef, 'worldMinX' | 'worldMaxX' | 'worldMinY' | 'worldMaxY'>;

export type ReplayRegionCentroid =
  | Pick<Region, 'centroidX' | 'centroidY'>
  | Pick<UnifiedRegionRef, 'worldCentroidX' | 'worldCentroidY'>;

export function clampReplayStep(step: number, sequenceLength: number): number {
  if (sequenceLength <= 0 || !Number.isFinite(step)) return 0;
  return Math.max(0, Math.min(sequenceLength, Math.floor(step)));
}

export function sliceReplayFilledRegionIds(
  isReplaying: boolean,
  replaySequence: readonly number[],
  replayStep: number,
  filledRegionIds: Set<number>
): Set<number> {
  if (!isReplaying) return filledRegionIds;
  const set = new Set<number>();
  const limit = clampReplayStep(replayStep, replaySequence.length);
  for (let i = 0; i < limit; i++) {
    set.add(replaySequence[i]);
  }
  return set;
}

export function buildTimelineReplaySequence(
  filledRegionIds: Set<number>,
  undoStack: readonly Pick<UndoHistoryEntry, 'regionId'>[]
): number[] {
  if (filledRegionIds.size > 0) {
    return Array.from(filledRegionIds);
  }
  return Array.from(new Set(undoStack.map((u) => u.regionId)));
}

export function computeReplayRegionsPerMs(
  sequenceLength: number,
  replaySpeed: number | undefined
): number {
  const baseRate = Math.max(12, Math.min(65, sequenceLength / 5.5));
  const speedMultiplier = replaySpeed || 1;
  return (baseRate * speedMultiplier) / 1000;
}

export function advanceReplayCursor(
  prevStep: number,
  sequence: readonly number[],
  stepDelta: number,
  replayFollow: boolean,
  isRegionVisible: (regionId: number) => boolean
): number {
  let cursor = prevStep;
  if (replayFollow) {
    if (stepDelta > 0) {
      cursor = prevStep + 1;
    }
    return Math.min(sequence.length, cursor);
  }

  // Immediately fast-forward past consecutive offscreen regions
  while (cursor < sequence.length && !isRegionVisible(sequence[cursor])) {
    cursor++;
  }

  // Advance stepDelta on-screen steps and fast-forward any consecutive offscreen steps following each
  for (let s = 0; s < stepDelta && cursor < sequence.length; s++) {
    cursor++;
    while (cursor < sequence.length && !isRegionVisible(sequence[cursor])) {
      cursor++;
    }
  }

  return Math.min(sequence.length, cursor);
}

// Zero-allocation bounding-box frustum check against the current canvas viewport
export function checkRegionVisibleInViewport(
  puzzle: Pick<PuzzleData, 'width' | 'height'> | null,
  region: ReplayRegionBounds | undefined,
  viewport: ReplayViewport,
  containerWidth: number,
  containerHeight: number
): boolean {
  if (!puzzle) return true;
  const { zoomScale, panOffsetX, panOffsetY } = viewport;
  if (zoomScale <= 1.02 && Math.abs(panOffsetX) <= 4 && Math.abs(panOffsetY) <= 4) {
    return true;
  }
  if (!region) return true;
  const w = containerWidth || 1024;
  const h = containerHeight || 768;
  const baseScale = Math.min(w / puzzle.width, h / puzzle.height) * 0.92;
  const baseOffsetX = (w - puzzle.width * baseScale) / 2;
  const baseOffsetY = (h - puzzle.height * baseScale) / 2;
  const effScale = zoomScale * baseScale;
  if (effScale <= 0) return true;

  const visLeft = (-panOffsetX - baseOffsetX) / effScale;
  const visTop = (-panOffsetY - baseOffsetY) / effScale;
  const visRight = visLeft + w / effScale;
  const visBottom = visTop + h / effScale;

  const minX = 'worldMinX' in region ? region.worldMinX : region.minX;
  const maxX = 'worldMaxX' in region ? region.worldMaxX : region.maxX;
  const minY = 'worldMinY' in region ? region.worldMinY : region.minY;
  const maxY = 'worldMaxY' in region ? region.worldMaxY : region.maxY;

  return (
    maxX >= visLeft &&
    minX <= visRight &&
    maxY >= visTop &&
    minY <= visBottom
  );
}

// Zero-allocation check for whether the viewport has panned to bring the target region onscreen during replayFollow
export function checkViewportCaughtUpToRegion(
  puzzle: Pick<PuzzleData, 'width' | 'height'> | null,
  region: ReplayRegionCentroid | undefined,
  viewport: ReplayViewport,
  containerWidth: number,
  containerHeight: number,
  rawScratch: ReplayScratchPoint,
  clampedScratch: ReplayScratchPoint
): boolean {
  if (!puzzle) return true;
  const { zoomScale, panOffsetX, panOffsetY } = viewport;
  // At fit-to-screen zoom (<= 1.05x), the entire puzzle is already visible onscreen
  if (zoomScale <= 1.05) return true;
  if (!region) return true;
  const w = containerWidth || 1024;
  const h = containerHeight || 768;
  const baseScale = Math.min(w / puzzle.width, h / puzzle.height) * 0.92;
  const baseOffsetX = (w - puzzle.width * baseScale) / 2;
  const baseOffsetY = (h - puzzle.height * baseScale) / 2;
  const effScale = zoomScale * baseScale;
  if (effScale <= 0) return true;

  const centroidX = 'worldCentroidX' in region ? region.worldCentroidX : region.centroidX;
  const centroidY = 'worldCentroidY' in region ? region.worldCentroidY : region.centroidY;

  // Check if viewport is already within 24px of its clamped target offset for this region
  rawScratch.x = w / 2 - (baseOffsetX + centroidX * effScale);
  rawScratch.y = h / 2 - (baseOffsetY + centroidY * effScale);
  const clampedTarget = clampCanvasOffset(
    rawScratch,
    zoomScale,
    puzzle.width,
    puzzle.height,
    w,
    h,
    clampedScratch
  );
  if (Math.hypot(clampedTarget.x - panOffsetX, clampedTarget.y - panOffsetY) <= 24) {
    return true;
  }

  const visLeft = (-panOffsetX - baseOffsetX) / effScale;
  const visTop = (-panOffsetY - baseOffsetY) / effScale;
  const visW = w / effScale;
  const visH = h / effScale;
  const visRight = visLeft + visW;
  const visBottom = visTop + visH;

  // Allow continuous painting as long as the region is inside the visible safe bounds (inner 84%)
  const padX = visW * 0.08;
  const padY = visH * 0.08;
  return (
    centroidX >= visLeft + padX &&
    centroidX <= visRight - padX &&
    centroidY >= visTop + padY &&
    centroidY <= visBottom - padY
  );
}

export interface UseReplayControllerOptions<TLive extends ReplayLiveState> {
  puzzle: PuzzleData | null;
  filledRegionIds: Set<number>;
  settings: UserSettings;
  settingsRef: MutableRefObject<UserSettings>;
  liveCoopRef: MutableRefObject<TLive>;
  viewportRef: MutableRefObject<ReplayViewport>;
  canvasContainerSizeRef: MutableRefObject<ReplayContainerSize>;
  regionByIdRef: MutableRefObject<Map<number, Region>>;
  flushPendingViewportSaveRef: MutableRefObject<() => void>;
  showTutorialRef: MutableRefObject<boolean>;
  tutorialStepRef: MutableRefObject<number>;
  handleUpdateSettings: (updater: (prev: UserSettings) => UserSettings) => void;
  setHintRegionId: Dispatch<SetStateAction<number | null>>;
  markTutorialActionTried: (action: 'replay') => void;
  triggerFeatureOffer: (offerId: FeatureOfferId) => void;
}

export interface UseReplayControllerResult {
  isReplaying: boolean;
  isPostLoadReplay: boolean;
  isReplayPlaying: boolean;
  replayStep: number;
  replaySequence: number[];
  displayedFilledRegionIds: Set<number>;
  isReplayingRef: MutableRefObject<boolean>;
  isPostLoadReplayRef: MutableRefObject<boolean>;
  isReplayPlayingRef: MutableRefObject<boolean>;
  replayStepRef: MutableRefObject<number>;
  replaySequenceLengthRef: MutableRefObject<number>;
  tutorialOpenedReplayRef: MutableRefObject<boolean>;
  cancelAutoResume: () => void;
  resetReplayState: () => void;
  exitReplay: () => void;
  dismissPostLoadReplayIfAwaiting: () => boolean;
  isRegionVisibleInViewport: (regionId: number) => boolean;
  isViewportCaughtUpToRegion: (regionId: number) => boolean;
  startReplay: (sequence: number[], autoResumeOnFinish?: boolean) => void;
  handleOpenTimelineReplay: (fallbackUndoEntries?: readonly Pick<UndoHistoryEntry, 'regionId'>[]) => void;
  handleReplayTogglePlay: () => void;
  handleReplayToggleLoop: () => void;
  handleReplayToggleFollow: () => void;
  handleReplayRestart: () => void;
  handleReplaySkipToEnd: () => void;
  handleReplaySeek: (step: number) => void;
  handleReplayChangeSpeed: (spd: number) => void;
  handleReplayUserInteract: () => void;
}

export function useReplayController<TLive extends ReplayLiveState>({
  puzzle,
  filledRegionIds,
  settings,
  settingsRef,
  liveCoopRef,
  viewportRef,
  canvasContainerSizeRef,
  regionByIdRef,
  flushPendingViewportSaveRef,
  showTutorialRef,
  tutorialStepRef,
  handleUpdateSettings,
  setHintRegionId,
  markTutorialActionTried,
  triggerFeatureOffer,
}: UseReplayControllerOptions<TLive>): UseReplayControllerResult {
  const [isReplaying, setIsReplaying] = useState<boolean>(false);
  const isReplayingRef = useLatest(isReplaying);
  const [isPostLoadReplay, setIsPostLoadReplay] = useState<boolean>(false);
  const isPostLoadReplayRef = useLatest(isPostLoadReplay);
  const [isReplayPlaying, setIsReplayPlaying] = useState<boolean>(false);
  const isReplayPlayingRef = useLatest(isReplayPlaying);
  const [replayStep, setReplayStep] = useState<number>(0);
  const replayStepRef = useLatest(replayStep);
  const [replaySequence, setReplaySequence] = useState<number[]>([]);
  const replaySequenceLengthRef = useLatest(replaySequence.length);

  const autoResumeReplayRef = useRef<boolean>(false);
  const autoResumeTimerRef = useRef<number | null>(null);
  const awaitingReplayDismissRef = useRef<boolean>(false);
  const tutorialOpenedReplayRef = useRef<boolean>(false);

  // Pre-allocated scratch vectors for zero-allocation camera-follow frustum checks
  const followRawScratchRef = useRef<ReplayScratchPoint>({ x: 0, y: 0 });
  const followClampedScratchRef = useRef<ReplayScratchPoint>({ x: 0, y: 0 });
  const unifiedWorldById = useMemo<Map<number, UnifiedRegionRef> | null>(() => {
    if (!puzzle?.nestedLayers?.length) return null;
    return buildUnifiedRegionIndex(puzzle).worldById;
  }, [puzzle]);
  const unifiedWorldByIdRef = useLatest(unifiedWorldById);

  const cancelAutoResume = useCallback(() => {
    autoResumeReplayRef.current = false;
    awaitingReplayDismissRef.current = false;
    if (autoResumeTimerRef.current !== null) {
      if (typeof window !== 'undefined') {
        window.clearTimeout(autoResumeTimerRef.current);
      }
      autoResumeTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      cancelAutoResume();
    };
  }, [cancelAutoResume]);

  const resetReplayState = useCallback(() => {
    cancelAutoResume();
    tutorialOpenedReplayRef.current = false;
    isReplayingRef.current = false;
    isPostLoadReplayRef.current = false;
    setIsPostLoadReplay(false);
    setIsReplaying(false);
    setIsReplayPlaying(false);
  }, [cancelAutoResume, isPostLoadReplayRef, isReplayingRef]);

  const exitReplay = useCallback(() => {
    flushPendingViewportSaveRef.current();
    resetReplayState();
  }, [flushPendingViewportSaveRef, resetReplayState]);

  useEffect(() => {
    if (!isReplaying) return;
    return NativeBridge.pushBackHandler(exitReplay);
  }, [isReplaying, exitReplay]);

  const dismissPostLoadReplayIfAwaiting = useCallback((): boolean => {
    if (!awaitingReplayDismissRef.current) return false;
    exitReplay();
    return true;
  }, [exitReplay]);

  const isRegionVisibleInViewport = useCallback(
    (regionId: number): boolean => {
      const w =
        canvasContainerSizeRef.current.width ||
        (typeof window !== 'undefined' ? window.innerWidth : 0) ||
        1024;
      const h =
        canvasContainerSizeRef.current.height ||
        (typeof window !== 'undefined' ? window.innerHeight : 0) ||
        768;
      return checkRegionVisibleInViewport(
        puzzle,
        unifiedWorldByIdRef.current?.get(regionId) ?? regionByIdRef.current.get(regionId),
        viewportRef.current,
        w,
        h
      );
    },
    [canvasContainerSizeRef, puzzle, regionByIdRef, unifiedWorldByIdRef, viewportRef]
  );

  const isViewportCaughtUpToRegion = useCallback(
    (regionId: number): boolean => {
      const w =
        canvasContainerSizeRef.current.width ||
        (typeof window !== 'undefined' ? window.innerWidth : 0) ||
        1024;
      const h =
        canvasContainerSizeRef.current.height ||
        (typeof window !== 'undefined' ? window.innerHeight : 0) ||
        768;
      return checkViewportCaughtUpToRegion(
        puzzle,
        unifiedWorldByIdRef.current?.get(regionId) ?? regionByIdRef.current.get(regionId),
        viewportRef.current,
        w,
        h,
        followRawScratchRef.current,
        followClampedScratchRef.current
      );
    },
    [canvasContainerSizeRef, puzzle, regionByIdRef, unifiedWorldByIdRef, viewportRef]
  );

  // Start animated region-by-region replay from the user's current viewport without zooming out or moving the camera
  const startReplay = useCallback(
    (sequence: number[], autoResumeOnFinish: boolean = false) => {
      if (!sequence || sequence.length === 0) return;
      if (autoResumeTimerRef.current !== null) {
        if (typeof window !== 'undefined') {
          window.clearTimeout(autoResumeTimerRef.current);
        }
        autoResumeTimerRef.current = null;
      }
      awaitingReplayDismissRef.current = false;
      autoResumeReplayRef.current = autoResumeOnFinish;
      if (autoResumeOnFinish) {
        handleUpdateSettings((prev) =>
          prev.replayLoop ? { ...prev, replayLoop: false } : prev
        );
      }
      setHintRegionId(null);
      setReplaySequence(sequence);
      replayStepRef.current = 0;
      setReplayStep(0);
      isReplayingRef.current = true;
      isPostLoadReplayRef.current = autoResumeOnFinish;
      setIsPostLoadReplay(autoResumeOnFinish);
      setIsReplaying(true);
      setIsReplayPlaying(true);
    },
    [
      handleUpdateSettings,
      isPostLoadReplayRef,
      isReplayingRef,
      replayStepRef,
      setHintRegionId,
    ]
  );

  // Animated Replay Loop (60 FPS smooth accumulator scaled by replaySpeed with offscreen fast-forward, camera follow, and auto-loop)
  useEffect(() => {
    if (!isReplaying || !isReplayPlaying) return;

    const finishAutoResume = () => {
      autoResumeReplayRef.current = false;
      if (autoResumeTimerRef.current !== null) {
        if (typeof window !== 'undefined') {
          window.clearTimeout(autoResumeTimerRef.current);
        }
        autoResumeTimerRef.current = null;
      }
      if (replaySequence.length === 0) {
        awaitingReplayDismissRef.current = false;
        isReplayingRef.current = false;
        isPostLoadReplayRef.current = false;
        setIsPostLoadReplay(false);
        setIsReplaying(false);
        return;
      }
      // Keep ReplayControls onscreen at 100% until the user interacts with the puzzle
      awaitingReplayDismissRef.current = true;
    };

    const completePlayback = () => {
      setIsReplayPlaying(false);
      if (autoResumeReplayRef.current) {
        finishAutoResume();
      }
    };

    let animId = 0;
    let lastTime = performance.now();
    let accRegions = 0;
    let loopPauseUntil = 0;
    const regionsPerMs = computeReplayRegionsPerMs(replaySequence.length, settings.replaySpeed);
    const shouldLoop = Boolean(settings.replayLoop);
    const shouldFollow = Boolean(settings.replayFollow);

    const tick = (now: number) => {
      animId = 0;
      if (typeof document !== 'undefined' && document.hidden) {
        return;
      }

      if (replaySequence.length === 0) {
        completePlayback();
        return;
      }

      const dt = Math.min(64, Math.max(0, now - lastTime));
      lastTime = now;

      const prev = replayStepRef.current;
      if (prev >= replaySequence.length) {
        if (shouldLoop && !autoResumeReplayRef.current) {
          if (loopPauseUntil === 0) {
            loopPauseUntil = now + 350;
          }
          if (now >= loopPauseUntil) {
            loopPauseUntil = 0;
            accRegions = 0;
            replayStepRef.current = 0;
            setReplayStep(0);
          }
          animId = requestAnimationFrame(tick);
          return;
        }
        completePlayback();
        return;
      }

      if (shouldFollow && !isViewportCaughtUpToRegion(replaySequence[prev])) {
        accRegions = Math.min(1, accRegions + dt * regionsPerMs);
        animId = requestAnimationFrame(tick);
        return;
      }

      accRegions += dt * regionsPerMs;
      const stepDelta = accRegions >= 1 ? Math.floor(accRegions) : 0;

      if (shouldFollow) {
        if (stepDelta > 0) {
          // Advance 1 step at a time so each subsequent region is followed and verified onscreen before painting
          accRegions = Math.min(1, accRegions - 1);
        }
      } else if (stepDelta > 0) {
        accRegions -= stepDelta;
      }

      const next = advanceReplayCursor(
        prev,
        replaySequence,
        stepDelta,
        shouldFollow,
        isRegionVisibleInViewport
      );

      if (next !== prev) {
        replayStepRef.current = next;
        setReplayStep(next);
      }

      if (next >= replaySequence.length) {
        if (shouldLoop && !autoResumeReplayRef.current) {
          loopPauseUntil = now + 350;
          animId = requestAnimationFrame(tick);
          return;
        }
        completePlayback();
        return;
      }

      animId = requestAnimationFrame(tick);
    };

    const startLoop = () => {
      if (animId !== 0) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      lastTime = performance.now();
      animId = requestAnimationFrame(tick);
    };

    const stopLoop = () => {
      if (animId !== 0) {
        cancelAnimationFrame(animId);
        animId = 0;
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopLoop();
      } else {
        startLoop();
      }
    };

    startLoop();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    return () => {
      stopLoop();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [
    isReplaying,
    isReplayPlaying,
    replaySequence,
    settings.replaySpeed,
    settings.replayLoop,
    settings.replayFollow,
    isRegionVisibleInViewport,
    isViewportCaughtUpToRegion,
    isReplayingRef,
    isPostLoadReplayRef,
    replayStepRef,
  ]);

  // Open replay timeline scrubber from long-press Undo or floating controls
  const handleOpenTimelineReplay = useCallback(
    (fallbackUndoEntries: readonly Pick<UndoHistoryEntry, 'regionId'>[] = []) => {
      const cur = liveCoopRef.current;
      const curPuzzle = cur.puzzle ?? puzzle;
      const curFilled = cur.filledRegionIds;
      if (!curPuzzle || (curFilled.size === 0 && fallbackUndoEntries.length === 0)) return;

      // Build unique ordered list of filled regions matching first-fill gameplay chronology
      const orderedList = buildTimelineReplaySequence(curFilled, fallbackUndoEntries);
      if (orderedList.length === 0) return;

      NativeBridge.haptic('tick', cur.settings.hapticsEnabled);
      awaitingReplayDismissRef.current = false;
      if (showTutorialRef.current && TUTORIAL_STEPS[tutorialStepRef.current]?.key === 'replay') {
        tutorialOpenedReplayRef.current = true;
      }
      setHintRegionId(null);
      setReplaySequence(orderedList);
      replayStepRef.current = orderedList.length;
      setReplayStep(orderedList.length);
      isReplayingRef.current = true;
      isPostLoadReplayRef.current = false;
      setIsPostLoadReplay(false);
      setIsReplaying(true);
      setIsReplayPlaying(false);
      markTutorialActionTried('replay');
      triggerFeatureOffer('replay_scrubber');
    },
    [
      isPostLoadReplayRef,
      isReplayingRef,
      liveCoopRef,
      markTutorialActionTried,
      puzzle,
      replayStepRef,
      setHintRegionId,
      showTutorialRef,
      triggerFeatureOffer,
      tutorialStepRef,
    ]
  );

  const handleReplayTogglePlay = useCallback(() => {
    cancelAutoResume();
    isPostLoadReplayRef.current = false;
    setIsPostLoadReplay(false);
    if (!isReplayPlayingRef.current && replayStepRef.current >= replaySequenceLengthRef.current) {
      replayStepRef.current = 0;
      setReplayStep(0);
      setIsReplayPlaying(true);
    } else {
      setIsReplayPlaying((prev) => !prev);
    }
  }, [
    cancelAutoResume,
    isPostLoadReplayRef,
    isReplayPlayingRef,
    replaySequenceLengthRef,
    replayStepRef,
  ]);

  const handleReplayToggleLoop = useCallback(() => {
    cancelAutoResume();
    isPostLoadReplayRef.current = false;
    setIsPostLoadReplay(false);
    const curSettings = settingsRef.current;
    NativeBridge.haptic('tick', curSettings.hapticsEnabled);
    const nextLoop = !curSettings.replayLoop;
    handleUpdateSettings((prev) => ({ ...prev, replayLoop: nextLoop }));
    if (nextLoop && replayStepRef.current >= replaySequenceLengthRef.current) {
      replayStepRef.current = 0;
      setReplayStep(0);
      setIsReplayPlaying(true);
    }
  }, [
    cancelAutoResume,
    handleUpdateSettings,
    isPostLoadReplayRef,
    replaySequenceLengthRef,
    replayStepRef,
    settingsRef,
  ]);

  const handleReplayToggleFollow = useCallback(() => {
    cancelAutoResume();
    isPostLoadReplayRef.current = false;
    setIsPostLoadReplay(false);
    const curSettings = settingsRef.current;
    NativeBridge.haptic('tick', curSettings.hapticsEnabled);
    handleUpdateSettings((prev) => ({ ...prev, replayFollow: !prev.replayFollow }));
  }, [cancelAutoResume, handleUpdateSettings, isPostLoadReplayRef, settingsRef]);

  const handleReplayRestart = useCallback(() => {
    cancelAutoResume();
    replayStepRef.current = 0;
    setReplayStep(0);
    setIsReplayPlaying(true);
  }, [cancelAutoResume, replayStepRef]);

  const handleReplaySkipToEnd = useCallback(() => {
    cancelAutoResume();
    const totalSteps = replaySequenceLengthRef.current;
    replayStepRef.current = totalSteps;
    setReplayStep(totalSteps);
    setIsReplayPlaying(false);
  }, [cancelAutoResume, replaySequenceLengthRef, replayStepRef]);

  const handleReplaySeek = useCallback(
    (step: number) => {
      cancelAutoResume();
      const clamped = clampReplayStep(step, replaySequenceLengthRef.current);
      replayStepRef.current = clamped;
      setReplayStep(clamped);
      setIsReplayPlaying(false);
    },
    [cancelAutoResume, replaySequenceLengthRef, replayStepRef]
  );

  const handleReplayChangeSpeed = useCallback(
    (spd: number) => {
      cancelAutoResume();
      handleUpdateSettings((prev) => ({ ...prev, replaySpeed: spd }));
    },
    [cancelAutoResume, handleUpdateSettings]
  );

  const handleReplayUserInteract = useCallback(() => {
    cancelAutoResume();
    markTutorialActionTried('replay');
    triggerFeatureOffer('replay_scrubber');
  }, [cancelAutoResume, markTutorialActionTried, triggerFeatureOffer]);

  const displayedFilledRegionIds = useMemo(
    () => sliceReplayFilledRegionIds(isReplaying, replaySequence, replayStep, filledRegionIds),
    [isReplaying, replaySequence, replayStep, filledRegionIds]
  );

  return {
    isReplaying,
    isPostLoadReplay,
    isReplayPlaying,
    replayStep,
    replaySequence,
    displayedFilledRegionIds,
    isReplayingRef,
    isPostLoadReplayRef,
    isReplayPlayingRef,
    replayStepRef,
    replaySequenceLengthRef,
    tutorialOpenedReplayRef,
    cancelAutoResume,
    resetReplayState,
    exitReplay,
    dismissPostLoadReplayIfAwaiting,
    isRegionVisibleInViewport,
    isViewportCaughtUpToRegion,
    startReplay,
    handleOpenTimelineReplay,
    handleReplayTogglePlay,
    handleReplayToggleLoop,
    handleReplayToggleFollow,
    handleReplayRestart,
    handleReplaySkipToEnd,
    handleReplaySeek,
    handleReplayChangeSpeed,
    handleReplayUserInteract,
  };
}
