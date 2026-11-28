import React, { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  GenerationProgressPayload,
  PuzzleData,
  Region,
  SavedSnapshot,
  UserSettings,
  computeProgressPercentage,
} from './types';
import { QuotaWarning, StorageService } from './services/StorageService';
import { isCloudCoopUiEnabled } from './services/StorageNamespace';
import { NativeBridge } from './services/NativeBridge';
import { SoundService } from './services/SoundService';
import { PlayerLifetimeStats, PlayerStatsService } from './services/PlayerStatsService';
import { PuzzleWorkerService } from './services/PuzzleWorkerService';
import { useCloudSyncController } from './hooks/useCloudSyncController';
import { CoopLoadSampleFn, useCoopSession } from './hooks/useCoopSession';
import { useIsomorphicLayoutEffect, useLatest } from './hooks/useLatest';
import { usePaintController } from './hooks/usePaintController';
import { useReplayController } from './hooks/useReplayController';
import { useSessionRestore } from './hooks/useSessionRestore';
import { useSnapshotLibrary } from './hooks/useSnapshotLibrary';
import { useTutorialAndOffers } from './hooks/useTutorialAndOffers';
import { useUndoRedo } from './hooks/useUndoRedo';
import { useViewportAndShortcuts } from './hooks/useViewportAndShortcuts';
import { mergeCustomPalette } from './services/sessionRestorePipeline';
import { getDisplayNumberMap } from './components/PaletteDock';
import { FocusRegionRequest, PuzzleCanvas } from './components/PuzzleCanvas';
import { GameTopBar } from './components/GameTopBar';
import { PaletteDock } from './components/PaletteDock';
import { FloatingActions } from './components/FloatingActions';
import { LoadingOverlay } from './components/LoadingOverlay';
import { ReplayControls } from './components/ReplayControls';
import { OnboardingTutorial, TUTORIAL_STEPS } from './components/OnboardingTutorial';
import { FeatureOfferBanner } from './components/FeatureOfferBanner';
import { TargetSpotlightOverlay } from './components/TargetSpotlightOverlay';
import { resolveReleaseChannel } from './version';

const SettingsModal = React.lazy(() =>
  import('./components/SettingsModal').then((m) => ({ default: m.SettingsModal }))
);
const ColorPickerPopover = React.lazy(() =>
  import('./components/ColorPickerPopover').then((m) => ({ default: m.ColorPickerPopover }))
);

export { mergeCustomPalette };

interface AppViewPropsInput {
  puzzle: PuzzleData | null;
  settings: UserSettings;
  isLoading: boolean;
  isCompleted: boolean;
  isReplaying: boolean;
  isPostLoadReplay: boolean;
  isReplayPlaying: boolean;
  replayStep: number;
  replaySequence: number[];
  activeColorId: number;
  hintRegionId: number | null;
  isFreeColorMode: boolean;
  isUndoEnabled: boolean;
  undoCount: number;
  redoCount: number;
  filledCount: number;
  showTutorial: boolean;
  showSettings: boolean;
  showPaletteOptions: boolean;
  loadingStepIndex: number | undefined;
}

function deriveCanvasViewProps(input: AppViewPropsInput) {
  const {
    settings,
    isCompleted,
    isReplaying,
    isPostLoadReplay,
    isReplayPlaying,
    replayStep,
    replaySequence,
    activeColorId,
    hintRegionId,
    loadingStepIndex,
  } = input;
  const isFollowActive = isReplaying && isReplayPlaying && Boolean(settings.replayFollow);
  const hideInteractiveState = isCompleted || isReplaying;
  return {
    canvasActiveColorId: hideInteractiveState ? 0 : activeColorId,
    canvasHintRegionId: hideInteractiveState ? null : hintRegionId,
    touchReachRadiusPx:
      (settings.uiScale ?? 1.0) > 1.0
        ? Math.max(settings.touchReachRadiusPx, 34)
        : settings.touchReachRadiusPx,
    canvasIsPaintMode:
      settings.isPaintMode && (!isReplaying || (!isCompleted && isPostLoadReplay)),
    showRegionLabels: isReplaying ? false : settings.showRegionLabels,
    maxLabelSize:
      settings.textScale > 1.0
        ? Math.round(Math.max(settings.maxLabelSize * settings.textScale * 1.2, 28))
        : settings.maxLabelSize,
    highlightMatching: isReplaying ? false : settings.highlightMatching,
    showNextRegionHint: isReplaying ? false : settings.showNextRegionHint,
    replayFollowRegionId:
      isFollowActive && replayStep < replaySequence.length ? replaySequence[replayStep] : null,
    replayFollowSequence: isFollowActive ? replaySequence : null,
    replaySpeed: settings.replaySpeed || 1,
    generationStepIndex: loadingStepIndex || 1,
  };
}

function deriveHudViewProps(input: AppViewPropsInput) {
  const {
    puzzle,
    settings,
    isLoading,
    isCompleted,
    activeColorId,
    isFreeColorMode,
    isUndoEnabled,
    undoCount,
    redoCount,
    filledCount,
    showTutorial,
    showSettings,
    showPaletteOptions,
  } = input;
  return {
    showActiveHud: Boolean(puzzle && !isLoading),
    showPaletteDock: Boolean(puzzle && !isLoading && !isCompleted),
    canUndo: isUndoEnabled && (undoCount > 0 || filledCount > 0),
    canRedo: isUndoEnabled && redoCount > 0,
    showCustomColorButton: Boolean(
      isFreeColorMode || puzzle?.isFreeColor || settings.enableCustomColorForAllPuzzles
    ),
    activePaletteColor: puzzle?.palette.find((c) => c.id === activeColorId) || null,
    hasDockedTutorial: showTutorial && showSettings && !showPaletteOptions,
    isModalOpen: showSettings || showPaletteOptions,
    isSettingsOnlyOpen: showSettings && !showPaletteOptions,
  };
}

function deriveAppViewProps(input: AppViewPropsInput) {
  return {
    ...deriveCanvasViewProps(input),
    ...deriveHudViewProps(input),
  };
}

export const App: React.FC = () => {
  // Core Persistence & Settings
  const [settings, setSettings] = useState<UserSettings>(() => StorageService.loadSettings());
  const [lifetimeStats, setLifetimeStats] = useState<PlayerLifetimeStats>(() =>
    PlayerStatsService.loadStats()
  );
  const [snapshots, setSnapshots] = useState<SavedSnapshot[]>(() => StorageService.loadSnapshots());
  const [activeSnapshotId, setActiveSnapshotId] = useState<string | null>(null);

  useEffect(() => {
    SoundService.configure({
      enabled: settings.soundEnabled !== false,
      volume: settings.soundVolume ?? 0.7,
    });
  }, [settings.soundEnabled, settings.soundVolume]);

  // Active Game State & Shared Coordination Refs
  const [puzzle, setPuzzle] = useState<PuzzleData | null>(null);
  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null);
  const [activeColorId, setActiveColorId] = useState<number>(1);
  const [filledRegionIds, setFilledRegionIds] = useState<Set<number>>(new Set());
  const [paintedRegionColors, setPaintedRegionColors] = useState<Map<number, number>>(new Map());
  const [hintRegionId, setHintRegionId] = useState<number | null>(null);
  const [focusRegionRequest, setFocusRegionRequest] = useState<FocusRegionRequest | null>(null);
  const focusRegionSeqRef = useRef<number>(0);
  const handleFocusUndoRedoRegion = useCallback((regionId: number, kind: 'undo' | 'redo') => {
    focusRegionSeqRef.current += 1;
    setFocusRegionRequest({ seq: focusRegionSeqRef.current, regionId, kind });
  }, []);
  const [isPreviewMode, setIsPreviewMode] = useState<boolean>(false);
  const isPreviewModeRef = useLatest(isPreviewMode);
  const [storageQuotaWarning, setStorageQuotaWarning] = useState<QuotaWarning | null>(null);

  const viewportRef = useRef<{ zoomScale: number; panOffsetX: number; panOffsetY: number }>({
    zoomScale: 1,
    panOffsetX: 0,
    panOffsetY: 0,
  });
  const canvasContainerSizeRef = useRef<{ width: number; height: number }>({
    width: typeof window !== 'undefined' ? window.innerWidth : 1024,
    height: typeof window !== 'undefined' ? window.innerHeight : 768,
  });
  const snapshotTransitioningRef = useRef<boolean>(false);
  const snapshotTransitionSeqRef = useRef<number>(0);
  const activeBlobUrlRef = useRef<string | null>(null);
  const flushPendingViewportSaveRef = useRef<() => void>(() => {});
  const exitTutorialReplayRef = useRef<() => void>(() => {});

  useEffect(() => {
    StorageService.requestPersistentStorageOnce();
    return StorageService.onQuotaWarning((warning) => {
      setStorageQuotaWarning(warning);
    });
  }, []);

  // Loading & Generation Pipeline State
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const isLoadingRef = useLatest(isLoading);
  const [loadingProgress, setLoadingProgress] = useState<number>(0.02);
  const [loadingStatus, setLoadingStatus] = useState<string>('Loading Capy...');
  const [loadingPayload, setLoadingPayload] = useState<GenerationProgressPayload | null>(null);

  // Modal State & Derived Active Save Snapshot
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const showSettingsRef = useLatest(showSettings);
  const [settingsInitialTab, setSettingsInitialTab] = useState<number | undefined>(undefined);
  const [settingsTabRequestKey, setSettingsTabRequestKey] = useState<number>(0);
  const [activeSettingsTab, setActiveSettingsTab] = useState<number>(1);
  const activeSettingsTabRef = useLatest(activeSettingsTab);
  const [showPaletteOptions, setShowPaletteOptions] = useState<boolean>(false);

  const settingsRef = useLatest(settings);
  const sourceImageRef = useLatest(sourceImage);
  const isFreeColorMode = Boolean(settings.isFreeColorMode);
  const activeSave = snapshots.find((s) => s.id === activeSnapshotId);
  const parentSnapshotId = activeSave?.parentSnapshotId;
  const parentSave = useMemo(
    () =>
      parentSnapshotId
        ? snapshots.find((s) => s.id === parentSnapshotId) ?? null
        : null,
    [parentSnapshotId, snapshots]
  );
  const activeTitle = activeSave?.title || 'Capy';
  const releaseChannelInfo = useMemo(() => resolveReleaseChannel(), []);

  const liveCoopSnapshot = {
    puzzle,
    activeSnapshotId,
    activeSave,
    activeTitle,
    filledRegionIds,
    paintedRegionColors,
    isFreeColorMode,
    activeColorId,
    settings,
  };
  const latestRenderCoopRef = useLatest(liveCoopSnapshot);
  const liveCoopRef = useRef(liveCoopSnapshot);
  useIsomorphicLayoutEffect(() => {
    if (!snapshotTransitioningRef.current) {
      liveCoopRef.current = liveCoopSnapshot;
    }
  });

  // O(1) region lookup map whenever puzzle changes
  const regionByIdMap = useMemo(() => {
    const map = new Map<number, Region>();
    if (puzzle) {
      for (let i = 0; i < puzzle.regions.length; i++) {
        const r = puzzle.regions[i];
        map.set(r.id, r);
      }
    }
    return map;
  }, [puzzle]);
  const regionByIdRef = useLatest(regionByIdMap);

  const handleUpdateSettings = useCallback(
    (updater: UserSettings | ((prev: UserSettings) => UserSettings)) => {
      setSettings((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        StorageService.saveSettings(next);
        return next;
      });
    },
    []
  );

  // Accessibility text/UI scale variables + Settings modal hardware back handler + lazy preloads
  useLayoutEffect(() => {
    const textScale = Number.isFinite(settings.textScale)
      ? settings.textScale
      : settings.largeText
        ? 1.25
        : 1.0;
    const uiScale = Number.isFinite(settings.uiScale)
      ? settings.uiScale
      : settings.largeText
        ? 1.25
        : 1.0;
    const root = document.documentElement;
    root.dataset.largeText = textScale > 1.0 || uiScale > 1.0 ? 'true' : 'false';
    root.dataset.textScaled = textScale !== 1.0 ? 'true' : 'false';
    root.dataset.uiScaled = uiScale !== 1.0 ? 'true' : 'false';
    root.dataset.uiBoosted = uiScale > 1.0 ? 'true' : 'false';
    root.style.setProperty('--capy-text-scale', String(textScale));
    root.style.setProperty('--capy-ui-scale', String(uiScale));
  }, [settings.largeText, settings.textScale, settings.uiScale]);

  useEffect(() => {
    if (!showSettings) return;
    return NativeBridge.pushBackHandler(() => setShowSettings(false));
  }, [showSettings]);

  useEffect(() => {
    void import('./components/SettingsModal');
    void import('./components/ColorPickerPopover');
  }, []);

  // 1. Tutorial & Feature Offers Controller
  const {
    showTutorial,
    setShowTutorial,
    showTutorialRef,
    tutorialStep,
    tutorialStepRef,
    tutorialStepTriedInVisit,
    tutorialTried,
    activeFeatureOffer,
    isFeatureOfferSuppressed,
    tutorialTriggeredPreviewRef,
    spotlightState,
    advanceFeatureOffer,
    triggerFeatureOffer,
    markTutorialActionTried,
    completeTutorial,
    handleStartTutorial,
    handleStartSettingsTour,
    handleOpenTutorialSettingsTab,
    handleJumpToTutorialStep,
    handleTutorialStepChange,
    handleSettingsTabOpened,
    handleExplorePresetGallery,
    handleSettingsUpdatedWithTracking,
    handleTutorialToggleLargeText,
  } = useTutorialAndOffers({
    isLoading,
    puzzle,
    isPreviewMode,
    isPreviewModeRef,
    showSettings,
    showSettingsRef,
    showPaletteOptions,
    activeSettingsTab,
    activeSettingsTabRef,
    settingsRef,
    exitTutorialReplayRef,
    setIsPreviewMode,
    setShowSettings,
    setSettingsInitialTab,
    setSettingsTabRequestKey,
    setActiveSettingsTab,
    handleUpdateSettings,
  });

  // 2. Co-op Room & Share Link Controller
  const loadSampleForCoopRef = useRef<CoopLoadSampleFn | null>(null);
  const loadSampleForCoop = useCallback<CoopLoadSampleFn>(
    (...args) =>
      loadSampleForCoopRef.current ? loadSampleForCoopRef.current(...args) : Promise.resolve(),
    []
  );

  const {
    coopRippleBuffer,
    coopRoomCode,
    coopParticipants,
    nextCoopJoinSeq,
    getCoopJoinSeq,
    setCoopRoomState,
    isCoopSessionActive,
    emitCoopPaint,
    emitCoopUnfill,
    canShareActiveLink,
    handleShareProgressLink,
    handleHostCoopRoom,
    handleJoinCoopRoom,
    handleLeaveCoopRoom,
    handleCopyCoopInviteLink,
  } = useCoopSession({
    puzzle,
    activeSnapshotId,
    activeSave,
    activeTitle,
    filledRegionIds,
    paintedRegionColors,
    isFreeColorMode,
    hapticsEnabled: settings.hapticsEnabled,
    liveCoopRef,
    viewportRef,
    regionByIdRef,
    loadSampleFromPrebakedOrGenerate: loadSampleForCoop,
    markTutorialActionTried,
    setFilledRegionIds,
    setPaintedRegionColors,
    setActiveColorId,
    setSnapshots,
  });

  const showCloudCoopUi = isCloudCoopUiEnabled() || Boolean(coopRoomCode);

  // 3. Replay Controller
  const {
    isReplaying,
    isPostLoadReplay,
    isReplayPlaying,
    replayStep,
    replaySequence,
    displayedFilledRegionIds,
    isReplayingRef,
    isPostLoadReplayRef,
    isReplayPlayingRef,
    tutorialOpenedReplayRef,
    cancelAutoResume,
    resetReplayState,
    exitReplay,
    dismissPostLoadReplayIfAwaiting,
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
  } = useReplayController({
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
  });

  useIsomorphicLayoutEffect(() => {
    exitTutorialReplayRef.current = () => {
      if (tutorialOpenedReplayRef.current) {
        exitReplay();
      }
    };
  }, [exitReplay, tutorialOpenedReplayRef]);

  // 4. Undo / Redo Controller
  const {
    undoStack,
    redoStack,
    undoStackRef,
    syncUndoStack,
    syncRedoStack,
    isUndoEnabled,
    handleUndo,
    handleRedo,
  } = useUndoRedo({
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
    onFocusRegion: handleFocusUndoRedoRegion,
  });

  const handleLongPressUndo = useCallback(() => {
    handleOpenTimelineReplay(undoStackRef.current);
  }, [handleOpenTimelineReplay, undoStackRef]);

  // 5. Viewport, Fullscreen & Keyboard Shortcuts Controller
  const {
    visibleColorIds,
    visibleColorIdsRef,
    visibleRegionIdsRef,
    isFullscreen,
    zoomInTrigger,
    zoomOutTrigger,
    resetViewTrigger,
    restoreViewTrigger,
    panStepRequest,
    isCanvasTransformed,
    initialViewport,
    applyViewport,
    clearPendingViewportSave,
    handleVisibleColorsChanged,
    handleVisibleRegionsChanged,
    handleToggleFullscreen,
    handleViewExtentChanged,
    handleViewportGesture,
    handleZoomIn,
    handleZoomOut,
    handleResetView,
  } = useViewportAndShortcuts({
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
  });

  // 6. Paint, Custom Palette, Hints & Session Stats Controller
  const {
    resetActivePuzzleSessionStats,
    attemptFillRegion,
    attemptBatchFillRegions,
    handleAddCustomColor,
    handleUpdateColor,
    handleApplyPresetPalette,
    triggerHint,
    handleSyncActiveColor,
  } = usePaintController({
    puzzle,
    isLoading,
    isReplaying,
    showSettings,
    showPaletteOptions,
    filledRegionCount: filledRegionIds.size,
    initialSnapshots: snapshots,
    liveCoopRef,
    viewportRef,
    regionByIdRef,
    visibleColorIdsRef,
    visibleRegionIdsRef,
    sourceImageRef,
    isReplayingRef,
    isPostLoadReplayRef,
    exitReplay,
    startReplay,
    emitCoopPaint,
    isCoopSessionActive,
    syncUndoStack,
    syncRedoStack,
    setPuzzle,
    setFilledRegionIds,
    setPaintedRegionColors,
    setActiveColorId,
    setHintRegionId,
    setSnapshots,
    setLifetimeStats,
    markTutorialActionTried,
  });

  // 7. Snapshot Library, Sample Loader, Detail Tile & Export/Import Controller
  const {
    fileInputRef,
    resolveSnapshotImageSrc,
    loadArtworkFromImage,
    handleLoadSnapshot,
    handleLoadSnapshotRef,
    handleZoomIntoDetailTile,
    handleFileUpload,
    handlePickImage,
    handleRegenerate,
    handleSelectSample,
    handleRenameSnapshot,
    handleTogglePinSnapshot,
    handleDeleteSnapshot,
    handleClearAllSnapshots,
    handleAfterStorageClear,
    handleRestoreStarterSample,
    handleResetProgress,
    handleExportPrintableSvg,
    handleExportSnapshotSvg,
    handleExportSnapshot,
    handleExportAllSnapshots,
    handleImportSnapshots,
  } = useSnapshotLibrary({
    puzzle,
    sourceImage,
    snapshots,
    activeSnapshotId,
    activeSave,
    activeTitle,
    filledRegionIds,
    paintedRegionColors,
    isFreeColorMode,
    settings,
    liveCoopRef,
    latestRenderCoopRef,
    viewportRef,
    snapshotTransitioningRef,
    snapshotTransitionSeqRef,
    activeBlobUrlRef,
    loadSampleForCoopRef,
    applyViewport,
    clearPendingViewportSave,
    resetReplayState,
    startReplay,
    syncUndoStack,
    syncRedoStack,
    resetActivePuzzleSessionStats,
    emitCoopUnfill,
    handleUpdateSettings,
    setSettings,
    setSnapshots,
    setActiveSnapshotId,
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
    setShowSettings,
    setLifetimeStats,
    markTutorialActionTried,
    triggerFeatureOffer,
  });

  // 8. Session Restore Pipeline on Launch
  useSessionRestore({
    callbacks: {
      getSettings: () => settingsRef.current,
      getTransitionSeq: () => snapshotTransitionSeqRef.current,
      nextCoopJoinSeq,
      getCoopJoinSeq,
      getActiveBlobUrl: () => activeBlobUrlRef.current,
      setActiveBlobUrl: (url) => {
        activeBlobUrlRef.current = url;
      },
      resolveSnapshotImageSrc,
      loadArtworkFromImage,
      clearPendingViewportSave,
      onApplyViewport: applyViewport,
      onSetSnapshots: setSnapshots,
      onSetPaintedRegionColors: setPaintedRegionColors,
      onSetSettings: setSettings,
      onUpdateSettings: handleUpdateSettings,
      onSetSourceImage: setSourceImage,
      onSetPuzzle: setPuzzle,
      onSetActiveSnapshotId: setActiveSnapshotId,
      onSetActiveColorId: setActiveColorId,
      onUpdateLiveCoop: (patch) => {
        liveCoopRef.current = { ...liveCoopRef.current, ...patch };
      },
      onSetFilledRegionIds: setFilledRegionIds,
      onSyncUndoStack: syncUndoStack,
      onSyncRedoStack: syncRedoStack,
      onSetHintRegionId: setHintRegionId,
      onResetActivePuzzleSessionStats: resetActivePuzzleSessionStats,
      onSetIsLoading: setIsLoading,
      onStartReplay: startReplay,
      onSetShowTutorial: setShowTutorial,
      onSetCoopRoomState: setCoopRoomState,
    },
  });

  // 9. Cloud Sync Controller
  const { cloudSyncStatus, lastCloudSyncError, handleSyncCloudProgress } = useCloudSyncController({
    showCloudCoopUi,
    isLoading,
    puzzle,
    activeSnapshotId,
    filledRegionCount: filledRegionIds.size,
    paintedRegionCount: paintedRegionColors.size,
    liveCoopRef,
    viewportRef,
    regionByIdRef,
    snapshotTransitioningRef,
    snapshotTransitionSeqRef,
    settingsRef,
    setSnapshots,
    setFilledRegionIds,
    setPaintedRegionColors,
    setHintRegionId,
    syncUndoStack,
    syncRedoStack,
  });

  // Derived Display Numbers & Progress
  const displayNumberMap = useMemo(() => {
    if (!puzzle) return new Map<number, string>();
    return getDisplayNumberMap(puzzle.palette, puzzle.regions, settings.paletteSort);
  }, [puzzle, settings.paletteSort]);

  const totalCount = puzzle?.regions.length || 0;
  const filledCount = filledRegionIds.size;
  const progressPercentage = computeProgressPercentage(filledCount, totalCount);
  const isCompleted = totalCount > 0 && filledCount >= totalCount;
  const viewProps = deriveAppViewProps({
    puzzle,
    settings,
    isLoading,
    isCompleted,
    isReplaying,
    isPostLoadReplay,
    isReplayPlaying,
    replayStep,
    replaySequence,
    activeColorId,
    hintRegionId,
    isFreeColorMode,
    isUndoEnabled,
    undoCount: undoStack.length,
    redoCount: redoStack.length,
    filledCount,
    showTutorial,
    showSettings,
    showPaletteOptions,
    loadingStepIndex: loadingPayload?.stepIndex,
  });

  // Memoized UI Composition Callbacks
  const handleTopBarTogglePreview = useCallback(() => {
    dismissPostLoadReplayIfAwaiting();
    markTutorialActionTried('peek_fullscreen');
    const nextPreview = !isPreviewModeRef.current;
    isPreviewModeRef.current = nextPreview;
    if (
      nextPreview &&
      showTutorialRef.current &&
      TUTORIAL_STEPS[tutorialStepRef.current]?.key === 'peek_fullscreen'
    ) {
      tutorialTriggeredPreviewRef.current = true;
    } else if (!nextPreview) {
      tutorialTriggeredPreviewRef.current = false;
    }
    setIsPreviewMode(nextPreview);
  }, [
    dismissPostLoadReplayIfAwaiting,
    isPreviewModeRef,
    markTutorialActionTried,
    showTutorialRef,
    tutorialStepRef,
    tutorialTriggeredPreviewRef,
  ]);

  const handleOpenSettings = useCallback(() => {
    setSettingsInitialTab(undefined);
    setShowSettings(true);
  }, []);

  const handleOpenSaves = useCallback(() => {
    markTutorialActionTried('saves_export');
    setSettingsInitialTab(4);
    setShowSettings(true);
  }, [markTutorialActionTried]);

  const handleOpenCoop = useCallback(() => {
    markTutorialActionTried('saves_export');
    triggerFeatureOffer('saves_export');
    setSettingsInitialTab(4);
    setShowSettings(true);
  }, [markTutorialActionTried, triggerFeatureOffer]);

  const handleBackToParentPuzzle = useCallback(() => {
    if (!parentSave) return;
    NativeBridge.haptic('tick', settingsRef.current.hapticsEnabled);
    void handleLoadSnapshotRef.current(parentSave);
  }, [parentSave, handleLoadSnapshotRef, settingsRef]);

  const handleOpenReleaseChannel = useCallback(() => {
    setSettingsInitialTab(0);
    setShowSettings(true);
  }, []);

  const handleCloseSettings = useCallback(() => {
    setShowSettings(false);
  }, []);

  const handleManualPanStart = useCallback(() => {
    if (isReplayingRef.current) {
      if (!(isPostLoadReplayRef.current && isReplayPlayingRef.current)) {
        cancelAutoResume();
      }
      if (settingsRef.current.replayFollow) {
        handleUpdateSettings((prev) => ({ ...prev, replayFollow: false }));
      }
    }
  }, [
    cancelAutoResume,
    handleUpdateSettings,
    isPostLoadReplayRef,
    isReplayPlayingRef,
    isReplayingRef,
    settingsRef,
  ]);

  const handleCanvasTogglePreview = useCallback(() => {
    const nextPreview = !isPreviewModeRef.current;
    isPreviewModeRef.current = nextPreview;
    if (!nextPreview) {
      tutorialTriggeredPreviewRef.current = false;
    }
    setIsPreviewMode(nextPreview);
  }, [isPreviewModeRef, tutorialTriggeredPreviewRef]);

  const handleFloatingUndo = useCallback(() => {
    if (isReplayingRef.current) {
      exitReplay();
      handleUndo(true);
      return;
    }
    handleUndo();
  }, [exitReplay, handleUndo, isReplayingRef]);

  const handleFloatingRedo = useCallback(() => {
    if (isReplayingRef.current) {
      exitReplay();
      handleRedo(true);
      return;
    }
    handleRedo();
  }, [exitReplay, handleRedo, isReplayingRef]);

  const handleFloatingStartReplay = useCallback(() => {
    if (showTutorialRef.current && TUTORIAL_STEPS[tutorialStepRef.current]?.key === 'replay') {
      tutorialOpenedReplayRef.current = true;
    }
    markTutorialActionTried('replay');
    triggerFeatureOffer('replay_scrubber');
    startReplay(Array.from(liveCoopRef.current.filledRegionIds));
  }, [
    markTutorialActionTried,
    showTutorialRef,
    startReplay,
    triggerFeatureOffer,
    tutorialOpenedReplayRef,
    tutorialStepRef,
  ]);

  const handleTogglePaintMode = useCallback(() => {
    const curSettings = settingsRef.current;
    const enablingPaint = !curSettings.isPaintMode;
    if (isReplayingRef.current) {
      exitReplay();
    } else {
      dismissPostLoadReplayIfAwaiting();
    }
    NativeBridge.haptic('tick', curSettings.hapticsEnabled);
    handleUpdateSettings((prev) => ({ ...prev, isPaintMode: !prev.isPaintMode }));
    if (enablingPaint) {
      triggerFeatureOffer('paint_mode');
    }
  }, [
    dismissPostLoadReplayIfAwaiting,
    exitReplay,
    handleUpdateSettings,
    isReplayingRef,
    settingsRef,
    triggerFeatureOffer,
  ]);

  const handlePaletteColorSelected = useCallback(
    (colId: number) => {
      if (isReplayingRef.current) {
        exitReplay();
      }
      NativeBridge.haptic('tick', settingsRef.current.hapticsEnabled);
      liveCoopRef.current = { ...liveCoopRef.current, activeColorId: colId };
      setActiveColorId(colId);
      setHintRegionId(null);
      markTutorialActionTried('palette');
    },
    [exitReplay, isReplayingRef, markTutorialActionTried, settingsRef]
  );

  const handlePaletteColorHintRequested = useCallback(
    (colId: number) => {
      if (showTutorialRef.current && tutorialStepRef.current === 0) {
        NativeBridge.haptic('tick', settingsRef.current.hapticsEnabled);
        setHintRegionId(null);
        markTutorialActionTried('palette');
        return;
      }
      triggerHint(colId);
    },
    [markTutorialActionTried, settingsRef, showTutorialRef, triggerHint, tutorialStepRef]
  );

  const handleTutorialTriggerHint = useCallback(() => {
    if (isReplayingRef.current) {
      exitReplay();
    }
    triggerHint();
    markTutorialActionTried('hint');
  }, [exitReplay, isReplayingRef, markTutorialActionTried, triggerHint]);

  const handleOpenPaletteOptions = useCallback(() => {
    setShowPaletteOptions(true);
    markTutorialActionTried('free_color');
    triggerFeatureOffer('free_color');
  }, [markTutorialActionTried, triggerFeatureOffer]);

  const handleClosePaletteOptions = useCallback(() => {
    setShowPaletteOptions(false);
  }, []);

  const handleToggleDetailedProgress = useCallback(
    (enabled: boolean) => {
      handleUpdateSettings((prev) => ({ ...prev, detailedLoadingProgress: enabled }));
      PuzzleWorkerService.setDetailedProgress(enabled);
    },
    [handleUpdateSettings]
  );

  const handleLoadSnapshotDefault = useCallback(
    (snap: SavedSnapshot) => handleLoadSnapshot(snap, false),
    [handleLoadSnapshot]
  );

  const handleReplaySnapshot = useCallback(
    (snap: SavedSnapshot) => handleLoadSnapshot(snap, true),
    [handleLoadSnapshot]
  );

  return (
    <div className="relative w-full h-full overflow-hidden bg-black select-none">
      {/* Hidden File Picker */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileUpload}
        className="hidden"
      />

      {/* Floating Top Bar */}
      <GameTopBar
        activeTitle={activeTitle}
        progressPercentage={progressPercentage}
        filledCount={filledCount}
        isPreviewMode={isPreviewMode}
        isCompleted={isCompleted}
        isFullscreen={isFullscreen}
        coopRoomCode={coopRoomCode}
        coopParticipants={coopParticipants}
        parentPuzzleTitle={parentSave?.title ?? null}
        releaseChannelBadge={releaseChannelInfo.badgeLabel}
        onPickImage={handlePickImage}
        onTogglePreview={handleTopBarTogglePreview}
        onToggleFullscreen={handleToggleFullscreen}
        onOpenSettings={handleOpenSettings}
        onOpenSaves={handleOpenSaves}
        onOpenCoop={showCloudCoopUi ? handleOpenCoop : undefined}
        onBackToParentPuzzle={parentSave ? handleBackToParentPuzzle : undefined}
        onOpenReleaseChannel={handleOpenReleaseChannel}
      />

      {/* Full Screen Interactive Canvas */}
      <PuzzleCanvas
        puzzle={puzzle}
        sourceImage={sourceImage}
        activeColorId={viewProps.canvasActiveColorId}
        filledRegionIds={displayedFilledRegionIds}
        paintedRegionColors={paintedRegionColors}
        hintRegionId={viewProps.canvasHintRegionId}
        focusRegionRequest={focusRegionRequest}
        isPreviewMode={isPreviewMode}
        isFreeColorMode={isFreeColorMode}
        difficulty={settings.difficulty}
        fatFingerAssist={settings.fatFingerAssist}
        touchReachRadiusPx={viewProps.touchReachRadiusPx}
        isPaintMode={viewProps.canvasIsPaintMode}
        canvasBgColor={settings.canvasBgColor}
        canvasBgArgb={settings.canvasBgArgb}
        sortOrder={settings.paletteSort}
        regionColorMode={settings.regionColorMode}
        showRegionLabels={viewProps.showRegionLabels}
        showPreviewLabels={settings.showPreviewLabels}
        showPreviewBorders={settings.showPreviewBorders}
        labelScale={settings.labelScale}
        minLabelSize={settings.minLabelSize}
        maxLabelSize={viewProps.maxLabelSize}
        highlightMatching={viewProps.highlightMatching}
        highlightStyle={settings.highlightStyle}
        hintColorArgb={settings.hintColorArgb}
        hintFillStyle={settings.hintFillStyle}
        animateHint={settings.animateHint}
        showNextRegionHint={viewProps.showNextRegionHint}
        hintIntensity={settings.hintIntensity}
        reducedMotion={Boolean(settings.reducedMotion)}
        panMomentum={settings.panMomentum}
        reverseDoubleTapZoom={settings.reverseDoubleTapZoom}
        zoomSensitivity={settings.zoomSensitivity}
        snapZoomLevels={settings.snapZoomLevels}
        displayNumberMap={displayNumberMap}
        initialZoomScale={initialViewport.zoomScale}
        initialPanOffsetX={initialViewport.panOffsetX}
        initialPanOffsetY={initialViewport.panOffsetY}
        zoomInTrigger={zoomInTrigger}
        zoomOutTrigger={zoomOutTrigger}
        resetViewTrigger={resetViewTrigger}
        restoreViewTrigger={restoreViewTrigger}
        panStepRequest={panStepRequest}
        replayFollowRegionId={viewProps.replayFollowRegionId}
        replayFollowSequence={viewProps.replayFollowSequence}
        replayFollowStep={replayStep}
        replaySpeed={viewProps.replaySpeed}
        isGenerating={isLoading}
        detailedProgress={Boolean(settings.detailedLoadingProgress)}
        generationProgress={loadingProgress}
        generationStepIndex={viewProps.generationStepIndex}
        coopRippleBuffer={coopRippleBuffer}
        onViewExtentChanged={handleViewExtentChanged}
        onPuzzleInteraction={dismissPostLoadReplayIfAwaiting}
        onViewportGesture={handleViewportGesture}
        onManualPanStart={handleManualPanStart}
        onRegionClicked={attemptFillRegion}
        onBatchRegionsClicked={attemptBatchFillRegions}
        onVisibleColorsChanged={handleVisibleColorsChanged}
        onVisibleRegionsChanged={handleVisibleRegionsChanged}
        onTogglePreview={handleCanvasTogglePreview}
      />

      {/* Floating Action Controls (Undo, Redo, Replay, Zoom, Paint Mode) */}
      {viewProps.showActiveHud && (
        <FloatingActions
          isPaintMode={settings.isPaintMode}
          showZoomButtons={settings.showZoomButtons}
          showResetViewButton={settings.showResetViewButton}
          raiseDock={settings.raisePaletteDock}
          isZoomedOrPanned={isCanvasTransformed}
          canUndo={viewProps.canUndo}
          canRedo={viewProps.canRedo}
          showUndo={isUndoEnabled}
          isCompleted={isCompleted}
          isReplaying={isReplaying}
          onUndo={handleFloatingUndo}
          onRedo={handleFloatingRedo}
          onLongPressUndo={handleLongPressUndo}
          onStartReplay={handleFloatingStartReplay}
          onTogglePaintMode={handleTogglePaintMode}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onResetView={handleResetView}
        />
      )}

      {/* Animated Replay HUD Controls */}
      {viewProps.showActiveHud && (
        <ReplayControls
          isOpen={isReplaying}
          isPlaying={isReplayPlaying}
          currentStep={replayStep}
          totalSteps={replaySequence.length}
          replaySpeed={viewProps.replaySpeed}
          isLooping={Boolean(settings.replayLoop)}
          isFollowing={Boolean(settings.replayFollow)}
          raiseDock={settings.raisePaletteDock}
          stackAbovePalette={!isCompleted}
          onTogglePlay={handleReplayTogglePlay}
          onToggleLoop={handleReplayToggleLoop}
          onToggleFollow={handleReplayToggleFollow}
          onRestart={handleReplayRestart}
          onSkipToEnd={handleReplaySkipToEnd}
          onSeek={handleReplaySeek}
          onChangeSpeed={handleReplayChangeSpeed}
          onExitReplay={exitReplay}
          onUserInteract={handleReplayUserInteract}
        />
      )}

      {/* Palette Dock floating above canvas */}
      {viewProps.showPaletteDock && puzzle && (
        <PaletteDock
          palette={puzzle.palette}
          regions={puzzle.regions}
          activeColorId={activeColorId}
          filledRegionIds={filledRegionIds}
          paintedRegionColors={paintedRegionColors}
          sortOrder={settings.paletteSort}
          prioritizeOnScreen={settings.prioritizeOnScreen}
          visibleColorIds={visibleColorIds}
          raiseDock={settings.raisePaletteDock}
          isReplaying={isReplaying}
          reducedMotion={Boolean(settings.reducedMotion)}
          largeText={Boolean(settings.largeText)}
          uiScale={settings.uiScale}
          isFreeColorMode={isFreeColorMode}
          showCustomColorButton={viewProps.showCustomColorButton}
          onColorSelected={handlePaletteColorSelected}
          onSyncActiveColor={handleSyncActiveColor}
          onColorHintRequested={handlePaletteColorHintRequested}
          onOpenPaletteOptions={handleOpenPaletteOptions}
          onAddCustomColor={handleAddCustomColor}
          onUpdateColor={handleUpdateColor}
          onApplyPresetPalette={handleApplyPresetPalette}
        />
      )}

      {/* Custom Color Picker & Palette Options Popover */}
      {puzzle && (
        <Suspense fallback={null}>
          <ColorPickerPopover
            isOpen={showPaletteOptions}
            activeColor={viewProps.activePaletteColor}
            onClose={handleClosePaletteOptions}
            onAddCustomColor={handleAddCustomColor}
            onUpdateColor={handleUpdateColor}
            onApplyPresetPalette={handleApplyPresetPalette}
          />
        </Suspense>
      )}

      {/* Loading & Generation Pipeline Details Overlay */}
      <LoadingOverlay
        isLoading={isLoading}
        status={loadingStatus}
        progress={loadingProgress}
        payload={loadingPayload}
        detailedProgress={Boolean(settings.detailedLoadingProgress)}
        onToggleDetailedProgress={handleToggleDetailedProgress}
      />

      {/* Settings Modal Sheet */}
      <Suspense fallback={null}>
        <SettingsModal
          isOpen={showSettings}
          onClose={handleCloseSettings}
          navigation={{
            initialTab: settingsInitialTab,
            initialTabRequestKey: settingsTabRequestKey,
            hasDockedTutorial: viewProps.hasDockedTutorial,
            onStartTutorial: handleStartTutorial,
            onStartTour: handleStartSettingsTour,
            onTabOpened: handleSettingsTabOpened,
            onExplorePresetGallery: handleExplorePresetGallery,
          }}
          preferences={{
            settings,
            isFullscreen,
            onUpdateSettings: handleSettingsUpdatedWithTracking,
            onToggleFullscreen: handleToggleFullscreen,
          }}
          about={{
            lifetimeStats,
            showCloudCoopUi,
          }}
          create={{
            sourceImage,
            onRegenerate: handleRegenerate,
            onSelectSample: handleSelectSample,
            onUploadImage: handlePickImage,
            onZoomIntoDetailTile: handleZoomIntoDetailTile,
          }}
          saves={{
            snapshots,
            activeSnapshotId,
            onLoadSnapshot: handleLoadSnapshotDefault,
            onReplaySnapshot: handleReplaySnapshot,
            onRenameSnapshot: handleRenameSnapshot,
            onTogglePinSnapshot: handleTogglePinSnapshot,
            onDeleteSnapshot: handleDeleteSnapshot,
            onClearAllSnapshots: handleClearAllSnapshots,
            onAfterStorageClear: handleAfterStorageClear,
            onRestoreStarterSample: handleRestoreStarterSample,
            onResetProgress: handleResetProgress,
            onExportSnapshot: handleExportSnapshot,
            onExportSnapshotSvg: handleExportSnapshotSvg,
            onExportAllSnapshots: handleExportAllSnapshots,
            onImportSnapshots: handleImportSnapshots,
          }}
          cloudCoop={{
            showCloudCoopUi,
            coopRoomCode,
            coopParticipants,
            canShareActiveLink,
            cloudSyncStatus,
            lastCloudSyncError,
            onHostCoopRoom: handleHostCoopRoom,
            onJoinCoopRoom: handleJoinCoopRoom,
            onLeaveCoopRoom: handleLeaveCoopRoom,
            onShareProgressLink: handleShareProgressLink,
            onCopyCoopInviteLink: handleCopyCoopInviteLink,
            onExportPrintableSvg: puzzle ? handleExportPrintableSvg : undefined,
            onSyncCloudProgress: handleSyncCloudProgress,
          }}
        />
      </Suspense>

      <OnboardingTutorial
        isOpen={showTutorial}
        isModalOpen={viewProps.isModalOpen}
        isSettingsOpen={viewProps.isSettingsOnlyOpen}
        activeSettingsTab={activeSettingsTab}
        isLoading={isLoading}
        stepIndex={tutorialStep}
        triedActions={tutorialTried}
        triedInCurrentVisit={tutorialStepTriedInVisit}
        largeText={Boolean(settings.largeText)}
        onToggleLargeText={handleTutorialToggleLargeText}
        onStepChange={handleTutorialStepChange}
        onTriggerHint={handleTutorialTriggerHint}
        onOpenSettingsTab={handleOpenTutorialSettingsTab}
        onComplete={completeTutorial}
        onSkip={completeTutorial}
      />

      <FeatureOfferBanner
        offer={activeFeatureOffer}
        isSuppressed={isFeatureOfferSuppressed}
        onJumpToGuide={handleJumpToTutorialStep}
        onDismiss={advanceFeatureOffer}
      />

      <TargetSpotlightOverlay
        isActive={spotlightState.isActive}
        variant={spotlightState.variant}
        targetKey={spotlightState.targetKey}
        cardSelector={spotlightState.cardSelector}
        reducedMotion={Boolean(settings.reducedMotion)}
        largeText={Boolean(settings.largeText)}
        textScale={settings.textScale}
        uiScale={settings.uiScale}
        isModalSpotlight={spotlightState.isModalSpotlight}
        activeSettingsTab={activeSettingsTab}
        zIndexClass={spotlightState.zIndexClass}
      />

      {storageQuotaWarning && (
        <div
          role="alert"
          data-testid="storage-quota-toast"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] max-w-md w-[calc(100%-2rem)] bg-amber-950/95 border border-amber-500/70 text-amber-100 px-4 py-3 rounded-xl shadow-2xl flex items-start gap-3 text-sm backdrop-blur-md"
        >
          <div className="flex-1">
            <p className="font-semibold text-amber-300">Storage Full</p>
            <p className="text-xs text-amber-100/90 mt-0.5">{storageQuotaWarning.message}</p>
          </div>
          <button
            type="button"
            data-testid="storage-quota-dismiss"
            onClick={() => setStorageQuotaWarning(null)}
            className="shrink-0 px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-xs font-medium cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
};
