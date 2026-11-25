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
  NormalizedRect,
  PuzzleData,
  Region,
  SavedSnapshot,
  UserSettings,
} from '../types';
import { NativeBridge } from '../services/NativeBridge';
import { PuzzleWorkerService } from '../services/PuzzleWorkerService';
import { reportSwallowed } from '../services/telemetry';
import { FeatureOfferId } from '../services/FeatureOffersService';
import { TutorialTriedActions } from '../components/OnboardingTutorial';
import {
  DecodedGeminiImage,
  GuidedGeminiHandoffPackage,
  NanoBananaError,
} from '../services/ai/NanoBananaService';
import { computeSelectionMetrics, SelectionMetrics } from '../services/ai/RegionSelectionEngine';
import { canExtendSides } from '../services/ai/SeamCompositor';
import type { CoopLiveState, CoopViewport } from './useCoopSession';
import type { UndoHistoryEntry } from './useUndoRedo';
import { useLatest } from './useLatest';
import {
  abortControllerBox,
  clearTimeoutBox,
  resolveLatestChildSave,
  restoreUndoSubdivisionPersistence,
  revokeOwnedUrlsNotIn,
  revokeUnusedObjectUrl,
  UndoInfiniteZoomSnapshot,
  UndoSubdivisionSnapshot,
} from './infiniteZoomPersistence';
import {
  buildInPlaceUpdatedSourceCanvas,
  computeNestedLayerTargetDimensions,
  computeRegionDragSelection,
  computeRegionTapSelection,
  computeSelectionMeanChroma,
  computeZoomInSubdivisionParams,
  decodeGuidedHandoffInput,
  EMPTY_SELECTION_METRICS,
  executeAiProviderGeneration,
  executeZoomInFlow,
  executeZoomOutFlow,
  isAbortLikeError,
  PipelineLiveStateSnapshot,
  ProviderFlowDispatchParams,
  ProviderFlowStatus,
  resolveActiveSelectionGrid,
  resolveInfiniteZoomAvailability,
  resolvePostSubdivisionActiveColor,
  scrubUndoHistoryForRemovedRegions,
  ZOOM_IN_MAX_NEW_SWATCHES,
  ZoomInCommitPipelineResult,
  ZoomOutCommitPipelineResult,
} from './infiniteZoomPipeline';

export type { UndoInfiniteZoomSnapshot, UndoSubdivisionSnapshot };
export {
  buildInPlaceUpdatedSourceCanvas,
  computeNestedLayerTargetDimensions,
  computeSelectionMeanChroma,
  computeZoomInSubdivisionParams,
  resolveActiveSelectionGrid,
  resolveLatestChildSave,
  resolvePostSubdivisionActiveColor,
  scrubUndoHistoryForRemovedRegions,
  ZOOM_IN_MAX_NEW_SWATCHES,
};

const UNDO_TOAST_DURATION_MS = 18_000;
const ERROR_TOAST_DURATION_MS = 9_000;

export interface GuidedHandoffSessionState {
  handoff: GuidedGeminiHandoffPackage;
  fallbackReason: string | null;
  isProcessing: boolean;
  errorMessage: string | null;
}

export interface InfiniteZoomErrorState {
  message: string;
  code?: string;
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
  isReplayPlaying: boolean;
  exitReplay: () => void;
  applyViewport?: (view: CoopViewport) => void;
  focusViewportOnBounds?: (bounds: NormalizedRect) => void;
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
  onGuidedHandoffOpenChange?: (isOpen: boolean) => void;
}

interface PendingGuidedContinuation {
  seq: number;
  isDecoding?: boolean;
  complete: (decoded: DecodedGeminiImage, signal: AbortSignal) => Promise<void>;
  cleanup?: () => void;
}

export function useInfiniteZoomController(params: UseInfiniteZoomControllerParams) {
  const {
    puzzle, sourceImage, snapshots, activeSnapshotId, activeSave,
    filledRegionIds, paintedRegionColors, isFreeColorMode, isLoading,
    isReplaying, isReplayPlaying, exitReplay, applyViewport, focusViewportOnBounds,
    coopRoomCode, settings, visibleColorIdsRef, liveCoopRef, viewportRef,
    activeBlobUrlRef, undoStackRef, redoStackRef, handleLoadSnapshotRef,
    syncUndoStack, syncRedoStack, setSnapshots, setPuzzle, setSourceImage,
    setFilledRegionIds, setPaintedRegionColors, setActiveColorId, setHintRegionId,
    setIsLoading, setLoadingProgress, setLoadingStatus, setLoadingPayload,
    markTutorialActionTried, triggerFeatureOffer, onGuidedHandoffOpenChange,
  } = params;

  const [isRegionSelectionMode, setIsRegionSelectionMode] = useState(false);
  const [selectedRegionIds, setSelectedRegionIds] = useState<Set<number>>(() => new Set());
  const [selectionLayerId, setSelectionLayerId] = useState<string | null>(null);
  const [pendingSwitchRegionId, setPendingSwitchRegionId] = useState<number | null>(null);
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const [infiniteZoomPrompt, setInfiniteZoomPrompt] = useState('');
  const [isInfiniteZoomRunning, setIsInfiniteZoomRunning] = useState(false);
  const [undoSubdivisionState, setUndoSubdivisionState] =
    useState<UndoInfiniteZoomSnapshot | null>(null);
  const [liveLayerImages, setLiveLayerImages] = useState<Map<string, HTMLImageElement>>(
    () => new Map()
  );
  const [guidedHandoffSession, setGuidedHandoffSession] =
    useState<GuidedHandoffSessionState | null>(null);
  const [infiniteZoomError, setInfiniteZoomError] = useState<InfiniteZoomErrorState | null>(null);

  const infiniteZoomOpSeqRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const undoToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoInFlightSeqRef = useRef<number | null>(null);
  const errorToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSwitchLayerIdRef = useRef<string | null>(null);
  const pendingGuidedRef = useRef<PendingGuidedContinuation | null>(null);
  const ownedLayerBlobUrlsRef = useRef<Map<string, string>>(new Map());

  const undoSubdivisionRef = useLatest(undoSubdivisionState);
  const settingsRef = useLatest(settings);
  const selectionLayerIdRef = useLatest(selectionLayerId);
  const selectedRegionIdsRef = useLatest(selectedRegionIds);
  const liveLayerImagesRef = useLatest(liveLayerImages);
  const isReplayingRef = useLatest(isReplaying);
  const onGuidedHandoffOpenChangeRef = useLatest(onGuidedHandoffOpenChange);
  const focusViewportOnBoundsRef = useLatest(focusViewportOnBounds);

  const isActiveReplayPlayback = isReplaying && isReplayPlaying;

  useEffect(() => {
    if (!isLoading && abortControllerRef.current === null && pendingGuidedRef.current === null) {
      setIsInfiniteZoomRunning(false);
    }
  }, [isLoading]);

  const clearInfiniteZoomError = useCallback(() => {
    clearTimeoutBox(errorToastTimerRef);
    setInfiniteZoomError(null);
  }, []);

  const showInfiniteZoomError = useCallback((message: string, code?: string) => {
    clearTimeoutBox(errorToastTimerRef);
    setInfiniteZoomError({ message, code });
    errorToastTimerRef.current = setTimeout(() => {
      errorToastTimerRef.current = null;
      setInfiniteZoomError(null);
    }, ERROR_TOAST_DURATION_MS);
  }, []);

  const stopLoadingIndicator = useCallback(() => {
    setIsInfiniteZoomRunning(false);
    setIsLoading(false);
    setLoadingPayload(null);
  }, [setIsLoading, setLoadingPayload]);

  const isMountedRef = useRef<boolean>(true);

  const isUndoInFlightForCurrentOp = useCallback(
    () =>
      undoInFlightSeqRef.current !== null &&
      undoInFlightSeqRef.current === infiniteZoomOpSeqRef.current,
    []
  );

  const clearUndoSubdivision = useCallback(() => {
    if (isUndoInFlightForCurrentOp()) {
      return;
    }
    clearTimeoutBox(undoToastTimerRef);
    const prev = undoSubdivisionRef.current;
    undoSubdivisionRef.current = null;
    revokeUnusedObjectUrl(prev?.previousBlobUrl, activeBlobUrlRef.current);
    setUndoSubdivisionState(null);
    revokeOwnedUrlsNotIn(ownedLayerBlobUrlsRef.current, new Set<string>(liveLayerImagesRef.current.keys()));
  }, [activeBlobUrlRef, isUndoInFlightForCurrentOp, liveLayerImagesRef, undoSubdivisionRef]);

  const clearGuidedSession = useCallback(() => {
    const pending = pendingGuidedRef.current;
    pendingGuidedRef.current = null;
    if (pending?.cleanup) {
      try {
        pending.cleanup();
      } catch (err) {
        reportSwallowed('InfiniteZoom.guidedCleanup', err);
      }
    }
    setGuidedHandoffSession(null);
    onGuidedHandoffOpenChangeRef.current?.(false);
  }, [onGuidedHandoffOpenChangeRef]);

  const resetSelectionDraft = useCallback(() => {
    const empty = new Set<number>();
    selectedRegionIdsRef.current = empty;
    selectionLayerIdRef.current = null;
    setSelectedRegionIds(empty);
    setSelectionLayerId(null);
    setPendingSwitchRegionId(null);
    pendingSwitchLayerIdRef.current = null;
    setSelectionNotice(null);
  }, [selectedRegionIdsRef, selectionLayerIdRef]);

  const exitRegionSelectionMode = useCallback(() => {
    setIsRegionSelectionMode(false);
    resetSelectionDraft();
  }, [resetSelectionDraft]);

  // Auto-exit selection mode ONLY on Co-op join or active animated Replay playback (NOT paused replay)
  useEffect(() => {
    if (!(Boolean(coopRoomCode) || isActiveReplayPlayback) || !isRegionSelectionMode) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) exitRegionSelectionMode();
    });
    return () => {
      cancelled = true;
    };
  }, [coopRoomCode, isActiveReplayPlayback, isRegionSelectionMode, exitRegionSelectionMode]);

  const cancelActiveInfiniteZoom = useCallback(() => {
    infiniteZoomOpSeqRef.current += 1;
    abortControllerBox(abortControllerRef);
    clearGuidedSession();
    PuzzleWorkerService.cancelActive();
    stopLoadingIndicator();
  }, [clearGuidedSession, stopLoadingIndicator]);

  const handleBeforeSnapshotResetOrSwitch = useCallback(() => {
    infiniteZoomOpSeqRef.current += 1;
    undoInFlightSeqRef.current = null;
    exitRegionSelectionMode();
    clearUndoSubdivision();
    clearGuidedSession();
    clearInfiniteZoomError();
    abortControllerBox(abortControllerRef);
    setIsInfiniteZoomRunning(false);
    revokeOwnedUrlsNotIn(ownedLayerBlobUrlsRef.current, new Set());
    setLiveLayerImages(new Map());
  }, [clearGuidedSession, clearInfiniteZoomError, clearUndoSubdivision, exitRegionSelectionMode]);

  useEffect(() => {
    isMountedRef.current = true;
    const ownedUrls = ownedLayerBlobUrlsRef.current;
    return () => {
      isMountedRef.current = false;
      infiniteZoomOpSeqRef.current += 1;
      undoInFlightSeqRef.current = null;
      clearTimeoutBox(undoToastTimerRef);
      clearTimeoutBox(errorToastTimerRef);
      revokeUnusedObjectUrl(undoSubdivisionRef.current?.previousBlobUrl, activeBlobUrlRef.current);
      clearGuidedSession();
      revokeOwnedUrlsNotIn(ownedUrls, new Set());
      abortControllerBox(abortControllerRef);
    };
  }, [activeBlobUrlRef, clearGuidedSession, undoSubdivisionRef]);

  const activeSelectionGrid = useMemo(
    () => resolveActiveSelectionGrid(puzzle, selectionLayerId),
    [puzzle, selectionLayerId]
  );

  const selectionMetrics: SelectionMetrics = useMemo(() => {
    if (!activeSelectionGrid || selectedRegionIds.size === 0) return EMPTY_SELECTION_METRICS;
    return computeSelectionMetrics(
      activeSelectionGrid,
      selectedRegionIds,
      filledRegionIds,
      paintedRegionColors
    );
  }, [activeSelectionGrid, selectedRegionIds, filledRegionIds, paintedRegionColors]);

  const childSave = useMemo(
    () => resolveLatestChildSave(snapshots, activeSave, activeSnapshotId),
    [snapshots, activeSave, activeSnapshotId]
  );

  const { isDisabled: isInfiniteZoomDisabled, disabledReason: infiniteZoomDisabledReason } =
    resolveInfiniteZoomAvailability(coopRoomCode, isLoading, isActiveReplayPlayback, Boolean(sourceImage));

  const handleJumpToChildPuzzle = useCallback(() => {
    if (!childSave) return;
    NativeBridge.haptic('tick', settingsRef.current.hapticsEnabled);
    void handleLoadSnapshotRef.current(childSave);
  }, [childSave, handleLoadSnapshotRef, settingsRef]);

  const handleEnterRegionSelectionMode = useCallback(
    (initialPrompt?: string) => {
      if (isInfiniteZoomDisabled || !puzzle || isUndoInFlightForCurrentOp()) return;
      if (isReplayingRef.current) exitReplay();
      clearInfiniteZoomError();
      if (typeof initialPrompt === 'string' && initialPrompt.trim().length > 0) {
        setInfiniteZoomPrompt(initialPrompt);
      }
      resetSelectionDraft();
      setIsRegionSelectionMode(true);
    },
    [clearInfiniteZoomError, exitReplay, isInfiniteZoomDisabled, isReplayingRef, isUndoInFlightForCurrentOp, puzzle, resetSelectionDraft]
  );

  const handleRegionSelectTap = useCallback(
    (regionId: number, layerId?: string | null) => {
      if (!puzzle || !isRegionSelectionMode) return;
      const outcome = computeRegionTapSelection(
        puzzle,
        selectedRegionIdsRef.current,
        selectionLayerIdRef.current,
        regionId,
        layerId
      );
      if (outcome.kind === 'updated') {
        selectedRegionIdsRef.current = outcome.nextSelected;
        selectionLayerIdRef.current = outcome.nextLayerId;
        setSelectedRegionIds(outcome.nextSelected);
        setSelectionLayerId(outcome.nextLayerId);
        setPendingSwitchRegionId(null);
        pendingSwitchLayerIdRef.current = null;
        setSelectionNotice(null);
        NativeBridge.haptic('tick', settingsRef.current.hapticsEnabled);
      } else if (outcome.kind === 'pending-switch') {
        pendingSwitchLayerIdRef.current = outcome.targetLayerId;
        setPendingSwitchRegionId(outcome.regionId);
        setSelectionNotice(null);
      } else if (outcome.kind === 'bridge-blocked') {
        setPendingSwitchRegionId(null);
        pendingSwitchLayerIdRef.current = null;
        setSelectionNotice(outcome.notice);
      }
    },
    [isRegionSelectionMode, puzzle, selectedRegionIdsRef, selectionLayerIdRef, settingsRef]
  );

  const handleRegionSelectDragAdd = useCallback(
    (candidateIds: ReadonlySet<number>) => {
      if (!puzzle || !isRegionSelectionMode || candidateIds.size === 0) return;
      const outcome = computeRegionDragSelection(
        puzzle,
        selectedRegionIdsRef.current,
        selectionLayerIdRef.current,
        candidateIds
      );
      if (!outcome) return;
      if (outcome.changed) {
        selectedRegionIdsRef.current = outcome.nextSelected;
        setSelectedRegionIds(outcome.nextSelected);
        if (outcome.nextLayerId !== selectionLayerIdRef.current) {
          selectionLayerIdRef.current = outcome.nextLayerId;
          setSelectionLayerId(outcome.nextLayerId);
        }
      }
      setPendingSwitchRegionId(null);
      pendingSwitchLayerIdRef.current = null;
      setSelectionNotice(null);
    },
    [isRegionSelectionMode, puzzle, selectedRegionIdsRef, selectionLayerIdRef]
  );

  const handleSwitchSelectionToPending = useCallback(() => {
    if (pendingSwitchRegionId === null || !puzzle) return;
    const nextLayerId = pendingSwitchLayerIdRef.current;
    if (!resolveActiveSelectionGrid(puzzle, nextLayerId)) return;
    const nextSet = new Set([pendingSwitchRegionId]);
    selectionLayerIdRef.current = nextLayerId;
    selectedRegionIdsRef.current = nextSet;
    setSelectionLayerId(nextLayerId);
    setSelectedRegionIds(nextSet);
    setPendingSwitchRegionId(null);
    pendingSwitchLayerIdRef.current = null;
    setSelectionNotice(null);
    NativeBridge.haptic('tick', settingsRef.current.hapticsEnabled);
  }, [pendingSwitchRegionId, puzzle, selectedRegionIdsRef, selectionLayerIdRef, settingsRef]);

  const readPipelineLiveState = useCallback((): PipelineLiveStateSnapshot => {
    const liveState = liveCoopRef.current;
    return {
      filledRegionIds: liveState.filledRegionIds,
      paintedRegionColors: liveState.paintedRegionColors,
      activeColorId: liveState.activeColorId,
      activeSave: liveState.activeSave,
      undoStack: undoStackRef.current,
      redoStack: redoStackRef.current,
      liveLayerImages: liveLayerImagesRef.current,
      viewport: viewportRef.current,
      activeBlobUrl: activeBlobUrlRef.current,
      settings: settingsRef.current,
      visibleColorIds: visibleColorIdsRef.current,
    };
  }, [activeBlobUrlRef, liveCoopRef, liveLayerImagesRef, redoStackRef, settingsRef, undoStackRef, viewportRef, visibleColorIdsRef]);

  const armUndoToastAndCelebrate = useCallback(
    (preOpUndo: UndoInfiniteZoomSnapshot) => {
      clearTimeoutBox(undoToastTimerRef);
      undoSubdivisionRef.current = preOpUndo;
      setUndoSubdivisionState(preOpUndo);
      undoToastTimerRef.current = setTimeout(() => {
        clearUndoSubdivision();
      }, UNDO_TOAST_DURATION_MS);
      markTutorialActionTried('create_gallery');
      triggerFeatureOffer('infinite_zoom');
      NativeBridge.haptic('success', settingsRef.current.hapticsEnabled);
    },
    [clearUndoSubdivision, markTutorialActionTried, settingsRef, triggerFeatureOffer, undoSubdivisionRef]
  );

  const reportProgressForSeq = useCallback(
    (seq: number, prog: number, status: string) => {
      if (seq === infiniteZoomOpSeqRef.current) {
        setLoadingProgress(prog);
        setLoadingStatus(status);
      }
    },
    [setLoadingProgress, setLoadingStatus]
  );

  const dispatchProviderOrGuided = useCallback(
    async (
      seq: number,
      signal: AbortSignal,
      req: ProviderFlowDispatchParams
    ): Promise<ProviderFlowStatus> => {
      const outcome = await executeAiProviderGeneration({
        settings: settingsRef.current,
        signal,
        isAborted: () => signal.aborted || seq !== infiniteZoomOpSeqRef.current,
        direction: req.direction,
        prompt: req.prompt,
        templatePngBlob: req.templatePngBlob,
        templateDataUrl: req.templateDataUrl,
        width: req.width,
        height: req.height,
        onProgress: (prog, status) => reportProgressForSeq(seq, prog, status),
      });

      if (outcome.status === 'guided') {
        pendingGuidedRef.current = {
          seq,
          complete: async (decoded, activeSignal) => {
            await req.onComplete(decoded, 'GUIDED_GEMINI', outcome.modelUsed, activeSignal);
          },
        };
        setIsLoading(false);
        setLoadingPayload(null);
        setGuidedHandoffSession({
          handoff: outcome.handoff,
          fallbackReason: outcome.fallbackReason,
          isProcessing: false,
          errorMessage: null,
        });
        onGuidedHandoffOpenChangeRef.current?.(true);
        return 'awaiting-guided';
      }
      if (outcome.status === 'error') {
        showInfiniteZoomError(outcome.message, outcome.code);
        return 'aborted';
      }
      if (outcome.status === 'aborted') return 'aborted';

      await req.onComplete(outcome.decoded, outcome.providerUsed, outcome.modelUsed, signal);
      return 'completed';
    },
    [onGuidedHandoffOpenChangeRef, reportProgressForSeq, setIsLoading, setLoadingPayload, settingsRef, showInfiniteZoomError]
  );

  const runAsyncZoomLifecycle = useCallback(
    async (
      initialStatus: string,
      errorScope: string,
      fallbackErrorMessage: string,
      task: (seq: number, signal: AbortSignal) => Promise<ProviderFlowStatus>
    ) => {
      if (isUndoInFlightForCurrentOp()) return;
      exitRegionSelectionMode();
      clearUndoSubdivision();
      clearGuidedSession();
      clearInfiniteZoomError();

      const seq = ++infiniteZoomOpSeqRef.current;
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setIsInfiniteZoomRunning(true);
      setIsLoading(true);
      setLoadingProgress(0.05);
      setLoadingStatus(initialStatus);
      setLoadingPayload(null);

      let awaitingGuided = false;
      try {
        awaitingGuided = (await task(seq, controller.signal)) === 'awaiting-guided';
      } catch (err) {
        if (!isAbortLikeError(err)) {
          reportSwallowed(errorScope, err);
          const msg = err instanceof Error && err.message ? err.message : fallbackErrorMessage;
          showInfiniteZoomError(msg, err instanceof NanoBananaError ? err.code : undefined);
        }
      } finally {
        if (abortControllerRef.current === controller) abortControllerRef.current = null;
        if (seq === infiniteZoomOpSeqRef.current && !awaitingGuided) stopLoadingIndicator();
      }
    },
    [clearGuidedSession, clearInfiniteZoomError, clearUndoSubdivision, exitRegionSelectionMode, isUndoInFlightForCurrentOp, setIsLoading, setLoadingPayload, setLoadingProgress, setLoadingStatus, showInfiniteZoomError, stopLoadingIndicator]
  );

  const applyZoomInCommit = useCallback(
    (result: ZoomInCommitPipelineResult) => {
      ownedLayerBlobUrlsRef.current.set(result.imageBlobKey, result.layerObjectUrl);
      const nextLiveLayerImages = new Map(result.previousLayerImages);
      nextLiveLayerImages.set(result.imageBlobKey, result.layerImg);

      liveCoopRef.current = {
        ...liveCoopRef.current,
        puzzle: result.nextPuzzle,
        activeSave: result.syncedSave ?? liveCoopRef.current.activeSave,
        filledRegionIds: result.nextFilled,
        paintedRegionColors: result.nextPainted,
        activeColorId: result.nextActiveColorId,
      };
      setLiveLayerImages(nextLiveLayerImages);
      setPuzzle(result.nextPuzzle);
      setFilledRegionIds(result.nextFilled);
      setPaintedRegionColors(result.nextPainted);
      setActiveColorId(result.nextActiveColorId);
      setHintRegionId(null);
      syncUndoStack(result.nextUndo);
      syncRedoStack(result.nextRedo);
      setSnapshots(result.updatedSnapshots);
      focusViewportOnBoundsRef.current?.(result.newLayer.worldBounds);
      armUndoToastAndCelebrate(result.preOpUndo);
    },
    [armUndoToastAndCelebrate, focusViewportOnBoundsRef, liveCoopRef, setActiveColorId, setFilledRegionIds, setHintRegionId, setPaintedRegionColors, setPuzzle, setSnapshots, syncRedoStack, syncUndoStack]
  );

  const handleConfirmRegionSubdivision = useCallback(async () => {
    if (!puzzle || !sourceImage || selectedRegionIds.size === 0 || isInfiniteZoomDisabled || isUndoInFlightForCurrentOp()) return;
    const targetLayerId = selectionLayerId;
    const targetGrid = resolveActiveSelectionGrid(puzzle, targetLayerId);
    if (!targetGrid) return;

    const selectedCopy = new Set(selectedRegionIds);
    const metrics = computeSelectionMetrics(targetGrid, selectedCopy, filledRegionIds, paintedRegionColors);
    if (metrics.regionCount === 0) return;

    const snapId = activeSnapshotId || crypto.randomUUID();
    const existingSnap = snapshots.find((s) => s.id === snapId);
    const isFree = Boolean(isFreeColorMode || puzzle.isFreeColor);

    await runAsyncZoomLifecycle(
      'Preparing context-padded detail template...',
      'InfiniteZoom.confirmSubdivision',
      'Infinite Zoom detail generation failed.',
      (seq, signal) =>
        executeZoomInFlow({
          snapId,
          existingSnap,
          basePuzzle: puzzle,
          baseImage: sourceImage,
          targetLayerId,
          targetGrid,
          selectedCopy,
          metrics,
          promptText: infiniteZoomPrompt,
          isFree,
          liveLayerImages: liveLayerImagesRef.current,
          isAborted: (s) => (s ?? signal).aborted || seq !== infiniteZoomOpSeqRef.current,
          readLiveState: readPipelineLiveState,
          onProgress: (prog, status) => reportProgressForSeq(seq, prog, status),
          dispatchProvider: (req) => dispatchProviderOrGuided(seq, signal, req),
          onCommitted: applyZoomInCommit,
        })
    );
  }, [activeSnapshotId, applyZoomInCommit, dispatchProviderOrGuided, filledRegionIds, infiniteZoomPrompt, isFreeColorMode, isInfiniteZoomDisabled, isUndoInFlightForCurrentOp, liveLayerImagesRef, paintedRegionColors, puzzle, readPipelineLiveState, reportProgressForSeq, runAsyncZoomLifecycle, selectedRegionIds, selectionLayerId, snapshots, sourceImage]);

  const applyZoomOutCommit = useCallback(
    (result: ZoomOutCommitPipelineResult) => {
      ownedLayerBlobUrlsRef.current.set(result.previousRootImageBlobKey, result.prevRootObjUrl);
      const nextLiveLayerImages = new Map(result.previousLayerImages);
      nextLiveLayerImages.set(result.previousRootImageBlobKey, result.prevRootImg);

      liveCoopRef.current = {
        ...liveCoopRef.current,
        puzzle: result.nextPuzzle,
        activeSave: result.syncedSave ?? liveCoopRef.current.activeSave,
        filledRegionIds: result.preservedFilled,
        paintedRegionColors: result.preservedPainted,
        activeColorId: result.nextActiveColorId,
      };
      setLiveLayerImages(nextLiveLayerImages);
      activeBlobUrlRef.current = result.outerObjUrl;
      setSourceImage(result.outerImg);
      setPuzzle(result.nextPuzzle);
      setActiveColorId(result.nextActiveColorId);
      setHintRegionId(null);
      setSnapshots(result.updatedSnapshots);
      applyViewport?.(result.fittedViewport);
      armUndoToastAndCelebrate(result.preOpUndo);
    },
    [activeBlobUrlRef, applyViewport, armUndoToastAndCelebrate, liveCoopRef, setActiveColorId, setHintRegionId, setPuzzle, setSnapshots, setSourceImage]
  );

  const handleConfirmExtendBorders = useCallback(
    async (sides: BorderExtensionSides, promptOverride?: string) => {
      if (!puzzle || !sourceImage || isInfiniteZoomDisabled || isUndoInFlightForCurrentOp()) return;
      if (!canExtendSides(puzzle.width, puzzle.height, sides).allowed) return;
      if (isReplayingRef.current) exitReplay();

      const promptText = typeof promptOverride === 'string' ? promptOverride : infiniteZoomPrompt;
      const snapId = activeSnapshotId || crypto.randomUUID();
      const existingSnap = snapshots.find((s) => s.id === snapId);
      const isFree = Boolean(isFreeColorMode || puzzle.isFreeColor);

      await runAsyncZoomLifecycle(
        'Preparing outward border template...',
        'InfiniteZoom.extendBorders',
        'Infinite Zoom border extension failed.',
        (seq, signal) =>
          executeZoomOutFlow({
            snapId,
            existingSnap,
            basePuzzle: puzzle,
            baseImage: sourceImage,
            sides,
            promptText,
            isFree,
            isAborted: (s) => (s ?? signal).aborted || seq !== infiniteZoomOpSeqRef.current,
            readLiveState: readPipelineLiveState,
            onProgress: (prog, status) => reportProgressForSeq(seq, prog, status),
            dispatchProvider: (req) => dispatchProviderOrGuided(seq, signal, req),
            onCommitted: applyZoomOutCommit,
          })
      );
    },
    [activeSnapshotId, applyZoomOutCommit, dispatchProviderOrGuided, exitReplay, infiniteZoomPrompt, isFreeColorMode, isInfiniteZoomDisabled, isReplayingRef, isUndoInFlightForCurrentOp, puzzle, readPipelineLiveState, reportProgressForSeq, runAsyncZoomLifecycle, snapshots, sourceImage]
  );

  const handleCompleteGuidedGeminiHandoff = useCallback(
    async (input: Blob | File | string) => {
      const pending = pendingGuidedRef.current;
      if (!pending || pending.seq !== infiniteZoomOpSeqRef.current) {
        clearGuidedSession();
        return;
      }
      if (pending.isDecoding) return;
      pending.isDecoding = true;
      setGuidedHandoffSession((prev) =>
        prev ? { ...prev, isProcessing: true, errorMessage: null } : prev
      );

      const decodeRes = await decodeGuidedHandoffInput(input);
      if (pendingGuidedRef.current !== pending) return;
      if (!decodeRes.ok) {
        pending.isDecoding = false;
        if (pending.seq !== infiniteZoomOpSeqRef.current) {
          clearGuidedSession();
          return;
        }
        setGuidedHandoffSession((prev) =>
          prev ? { ...prev, isProcessing: false, errorMessage: decodeRes.errorMessage } : prev
        );
        return;
      }
      if (pending.seq !== infiniteZoomOpSeqRef.current) {
        clearGuidedSession();
        return;
      }

      const { seq, complete: completeFn, cleanup: cleanupFn } = pending;
      pendingGuidedRef.current = null;
      setGuidedHandoffSession(null);
      onGuidedHandoffOpenChangeRef.current?.(false);

      const controller = new AbortController();
      abortControllerRef.current = controller;
      setIsInfiniteZoomRunning(true);
      setIsLoading(true);
      setLoadingProgress(0.45);
      setLoadingStatus('Compositing generated artwork...');
      setLoadingPayload(null);

      try {
        await completeFn(decodeRes.decoded, controller.signal);
      } catch (err) {
        if (!isAbortLikeError(err)) {
          reportSwallowed('InfiniteZoom.guidedComplete', err);
          const msg =
            err instanceof Error && err.message ? err.message : 'Failed to apply generated image.';
          showInfiniteZoomError(msg);
        }
      } finally {
        cleanupFn?.();
        if (abortControllerRef.current === controller) abortControllerRef.current = null;
        if (seq === infiniteZoomOpSeqRef.current) stopLoadingIndicator();
      }
    },
    [clearGuidedSession, onGuidedHandoffOpenChangeRef, setIsLoading, setLoadingPayload, setLoadingProgress, setLoadingStatus, showInfiniteZoomError, stopLoadingIndicator]
  );

  const handleCancelGuidedGeminiHandoff = useCallback(() => {
    infiniteZoomOpSeqRef.current += 1;
    clearGuidedSession();
    stopLoadingIndicator();
  }, [clearGuidedSession, stopLoadingIndicator]);

  const handleUndoSubdivision = useCallback(async () => {
    const snap = undoSubdivisionRef.current;
    if (!snap || isUndoInFlightForCurrentOp()) return;
    if (snap.snapshotId !== activeSnapshotId) {
      clearUndoSubdivision();
      return;
    }

    clearTimeoutBox(undoToastTimerRef);
    undoSubdivisionRef.current = null;

    const seq = ++infiniteZoomOpSeqRef.current;
    undoInFlightSeqRef.current = seq;
    const expectedSnapshotId = snap.snapshotId;
    try {
      const result = await restoreUndoSubdivisionPersistence({
        snap,
        isFreeColorMode,
        activeSave,
        liveActiveSave: liveCoopRef.current.activeSave,
        isStale: () =>
          seq !== infiniteZoomOpSeqRef.current ||
          liveCoopRef.current.activeSnapshotId !== expectedSnapshotId,
      });
      if (!result) {
        revokeUnusedObjectUrl(snap.previousBlobUrl, activeBlobUrlRef.current);
        return;
      }

      revokeUnusedObjectUrl(snap.newBlobUrl, snap.previousBlobUrl);
      activeBlobUrlRef.current = snap.previousBlobUrl;

      const restoredLayerImages = new Map(snap.previousLayerImages);
      revokeOwnedUrlsNotIn(ownedLayerBlobUrlsRef.current, new Set<string>(restoredLayerImages.keys()));

      liveCoopRef.current = {
        ...liveCoopRef.current,
        puzzle: snap.puzzle,
        activeSave: result.syncedSave ?? liveCoopRef.current.activeSave,
        filledRegionIds: snap.filledRegionIds,
        paintedRegionColors: snap.paintedRegionColors,
        activeColorId: snap.activeColorId,
      };
      setLiveLayerImages(restoredLayerImages);
      setSourceImage(snap.sourceImage);
      setPuzzle(snap.puzzle);
      setFilledRegionIds(snap.filledRegionIds);
      setPaintedRegionColors(snap.paintedRegionColors);
      setActiveColorId(snap.activeColorId);
      setHintRegionId(null);
      syncUndoStack(snap.undoStack);
      syncRedoStack(snap.redoStack);
      setSnapshots(result.updatedSnapshots);
      applyViewport?.(result.restoredViewport);
      NativeBridge.haptic('tick', settingsRef.current.hapticsEnabled);
    } catch (err) {
      reportSwallowed('InfiniteZoom.undoSubdivision', err, { id: expectedSnapshotId });
      revokeUnusedObjectUrl(snap.previousBlobUrl, activeBlobUrlRef.current);
    } finally {
      if (undoInFlightSeqRef.current === seq) {
        undoInFlightSeqRef.current = null;
      }
      if (isMountedRef.current) {
        setUndoSubdivisionState((prev) => (prev === snap ? null : prev));
      }
    }
  }, [activeBlobUrlRef, activeSave, activeSnapshotId, applyViewport, clearUndoSubdivision, isFreeColorMode, isUndoInFlightForCurrentOp, liveCoopRef, setActiveColorId, setFilledRegionIds, setHintRegionId, setPaintedRegionColors, setPuzzle, setSnapshots, setSourceImage, settingsRef, syncRedoStack, syncUndoStack, undoSubdivisionRef]);

  return {
    isRegionSelectionMode,
    selectedRegionIds,
    selectionLayerId,
    selectionMetrics,
    pendingSwitchRegionId,
    selectionNotice,
    infiniteZoomPrompt,
    setInfiniteZoomPrompt,
    isInfiniteZoomRunning: isInfiniteZoomRunning && isLoading,
    isInfiniteZoomDisabled,
    infiniteZoomDisabledReason,
    undoSubdivisionState,
    liveLayerImages,
    guidedHandoffSession,
    infiniteZoomError,
    clearInfiniteZoomError,
    childSave,
    handleJumpToChildPuzzle,
    handleEnterRegionSelectionMode,
    exitRegionSelectionMode,
    handleRegionSelectTap,
    handleRegionSelectDragAdd,
    handleSwitchSelectionToPending,
    handleClearSelection: resetSelectionDraft,
    handleConfirmRegionSubdivision,
    handleConfirmExtendBorders,
    handleCompleteGuidedGeminiHandoff,
    handleCancelGuidedGeminiHandoff,
    handleUndoSubdivision,
    clearUndoSubdivision,
    cancelActiveInfiniteZoom,
    handleBeforeSnapshotResetOrSwitch,
  };
}
