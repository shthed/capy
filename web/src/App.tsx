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
import { useInfiniteZoomController } from './hooks/useInfiniteZoomController';
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
import { PuzzleCanvas } from './components/PuzzleCanvas';
import { GameTopBar } from './components/GameTopBar';
import { PaletteDock } from './components/PaletteDock';
import { FloatingActions } from './components/FloatingActions';
import { buildUnifiedRegionIndex } from './engine/UnifiedPuzzleLayers';
import {
  InfiniteZoomToolbarButton,
  RegionSelectionBar,
} from './components/InfiniteZoomControls';
import { GuidedGeminiHandoffModal } from './components/GuidedGeminiHandoffModal';
import { LoadingOverlay } from './components/LoadingOverlay';
import { ReplayControls } from './components/ReplayControls';
import { OnboardingTutorial, TUTORIAL_STEPS } from './components/OnboardingTutorial';
import { FeatureOfferBanner } from './components/FeatureOfferBanner';
import { TargetSpotlightOverlay } from './components/TargetSpotlightOverlay';
import { resolveReleaseChannel } from './version';

const EMPTY_REGIONS: Region[] = [];
const EMPTY_REGION_MAP: Map<number, Region> = new Map();

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
  isGuidedGeminiOpen: boolean;
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
    isGuidedGeminiOpen,
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
    hasDockedTutorial: showTutorial && showSettings && !showPaletteOptions && !isGuidedGeminiOpen,
    isModalOpen: showSettings || showPaletteOptions || isGuidedGeminiOpen,
    isSettingsOnlyOpen: showSettings && !showPaletteOptions && !isGuidedGeminiOpen,
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
  const clearUndoSubdivisionRef = useRef<() => void>(() => {});
  const beforeSnapshotResetOrSwitchRef = useRef<() => void>(() => {});
  const handleClearUndoSubdivisionBridge = useCallback(() => {
    clearUndoSubdivisionRef.current();
  }, []);
  const handleBeforeSnapshotResetOrSwitchBridge = useCallback(() => {
    beforeSnapshotResetOrSwitchRef.current();
  }, []);

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
  const [isGuidedGeminiOpen, setIsGuidedGeminiOpen] = useState<boolean>(false);

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

  // Unified O(1) region index across root + all nested layers whenever puzzle changes
  const unifiedRegionIndex = useMemo(
    () => (puzzle ? buildUnifiedRegionIndex(puzzle) : null),
    [puzzle]
  );
  const allPuzzleRegions = unifiedRegionIndex?.allRegions ?? EMPTY_REGIONS;
  const regionByIdMap = unifiedRegionIndex?.byId ?? EMPTY_REGION_MAP;
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
    redoStackRef,
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
    onTransitionCommitted: handleClearUndoSubdivisionBridge,
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
    showPaletteOptions: showPaletteOptions || isGuidedGeminiOpen,
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
    showPaletteOptions: showPaletteOptions || isGuidedGeminiOpen,
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
    onPaintCommitted: handleClearUndoSubdivisionBridge,
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
    onBeforeSnapshotResetOrSwitch: handleBeforeSnapshotResetOrSwitchBridge,
  });

  // 7b. Unified Single-Canvas Infinite Zoom Controller (Nano Banana 2.1 / 2)
  const {
    isRegionSelectionMode,
    selectedRegionIds,
    selectionLayerId,
    selectionMetrics,
    pendingSwitchRegionId,
    selectionNotice,
    infiniteZoomPrompt,
    setInfiniteZoomPrompt,
    isInfiniteZoomRunning,
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
    handleClearSelection,
    handleConfirmRegionSubdivision,
    handleConfirmExtendBorders,
    handleCompleteGuidedGeminiHandoff,
    handleCancelGuidedGeminiHandoff,
    handleUndoSubdivision,
    clearUndoSubdivision,
    cancelActiveInfiniteZoom,
    handleBeforeSnapshotResetOrSwitch,
  } = useInfiniteZoomController({
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
    isReplayPlaying,
    exitReplay,
    applyViewport,
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
    onGuidedHandoffOpenChange: setIsGuidedGeminiOpen,
  });

  useIsomorphicLayoutEffect(() => {
    clearUndoSubdivisionRef.current = clearUndoSubdivision;
    beforeSnapshotResetOrSwitchRef.current = handleBeforeSnapshotResetOrSwitch;
  }, [clearUndoSubdivision, handleBeforeSnapshotResetOrSwitch]);

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

  // Derived Display Numbers & Progress (unified across root + all nested layers)
  const displayNumberMap = useMemo(() => {
    if (!puzzle) return new Map<number, string>();
    return getDisplayNumberMap(puzzle.palette, allPuzzleRegions, settings.paletteSort);
  }, [puzzle, allPuzzleRegions, settings.paletteSort]);

  const totalCount = unifiedRegionIndex?.totalCount ?? 0;
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
    isGuidedGeminiOpen: isGuidedGeminiOpen || Boolean(guidedHandoffSession),
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
        parentPuzzleDirection={parentSave?.zoomTree?.direction ?? null}
        childPuzzleTitle={childSave?.title ?? null}
        releaseChannelBadge={releaseChannelInfo.badgeLabel}
        onPickImage={handlePickImage}
        onTogglePreview={handleTopBarTogglePreview}
        onToggleFullscreen={handleToggleFullscreen}
        onOpenSettings={handleOpenSettings}
        onOpenSaves={handleOpenSaves}
        onOpenCoop={showCloudCoopUi ? handleOpenCoop : undefined}
        onBackToParentPuzzle={parentSave ? handleBackToParentPuzzle : undefined}
        onJumpToChildPuzzle={childSave ? handleJumpToChildPuzzle : undefined}
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
        activeSnapshotId={activeSnapshotId}
        isRegionSelectionMode={isRegionSelectionMode}
        selectedRegionIds={selectedRegionIds}
        selectionLayerId={selectionLayerId}
        layerImages={liveLayerImages}
        onRegionSelectTap={handleRegionSelectTap}
        onRegionSelectDragAdd={handleRegionSelectDragAdd}
      />

      {/* Floating Action Controls (Undo, Redo, Infinite Zoom, Replay, Zoom, Paint Mode) */}
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
          isReplayPlaying={isReplayPlaying}
          onUndo={handleFloatingUndo}
          onRedo={handleFloatingRedo}
          onLongPressUndo={handleLongPressUndo}
          onStartReplay={handleFloatingStartReplay}
          onTogglePaintMode={handleTogglePaintMode}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onResetView={handleResetView}
          infiniteZoomSlot={
            !isRegionSelectionMode ? (
              <InfiniteZoomToolbarButton
                disabled={isInfiniteZoomDisabled}
                disabledReason={infiniteZoomDisabledReason}
                sourceWidth={
                  puzzle?.width ?? (sourceImage ? sourceImage.naturalWidth || sourceImage.width : 0)
                }
                sourceHeight={
                  puzzle?.height ??
                  (sourceImage ? sourceImage.naturalHeight || sourceImage.height : 0)
                }
                prompt={infiniteZoomPrompt}
                provider={settings.infiniteZoomProvider}
                model={settings.nanoBananaModel}
                onPromptChange={setInfiniteZoomPrompt}
                onEnterSelectionMode={() => handleEnterRegionSelectionMode()}
                onConfirmExtendBorders={handleConfirmExtendBorders}
              />
            ) : null
          }
        />
      )}

      {/* Region Selection Bar (Infinite Zoom In) */}
      {viewProps.showActiveHud && isRegionSelectionMode && (
        <RegionSelectionBar
          isOpen={isRegionSelectionMode}
          raiseDock={settings.raisePaletteDock}
          isCompleted={isCompleted}
          metrics={selectionMetrics}
          pendingSwitchRegionId={pendingSwitchRegionId}
          notice={selectionNotice}
          prompt={infiniteZoomPrompt}
          isBusy={isInfiniteZoomRunning}
          isDisabled={isInfiniteZoomDisabled}
          isOverlayModalOpen={viewProps.isModalOpen}
          onPromptChange={setInfiniteZoomPrompt}
          onConfirm={handleConfirmRegionSubdivision}
          onSwitchSelection={handleSwitchSelectionToPending}
          onClear={handleClearSelection}
          onCancel={exitRegionSelectionMode}
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
          regions={allPuzzleRegions}
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
        onCancel={isInfiniteZoomRunning ? cancelActiveInfiniteZoom : undefined}
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
            isInfiniteZoomDisabled,
            infiniteZoomDisabledReason,
            onStartInfiniteZoomIn: handleEnterRegionSelectionMode,
            onStartInfiniteZoomOut: handleConfirmExtendBorders,
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

      {undoSubdivisionState && !isRegionSelectionMode && (
        <div
          role="status"
          data-testid="undo-subdivision-toast"
          className="fixed left-1/2 -translate-x-1/2 z-[55] max-w-sm w-[calc(100%-1.5rem)] bg-slate-900/95 border border-sky-400/60 text-slate-100 px-3.5 py-2.5 rounded-xl shadow-2xl flex items-center justify-between gap-3 text-xs backdrop-blur-md"
          style={{
            bottom: `calc(${
              settings.raisePaletteDock
                ? 'var(--capy-replay-bottom-raised, 6.25rem)'
                : 'var(--capy-replay-bottom, 4.625rem)'
            } + var(--sab, 0px))`,
          }}
        >
          <span className="font-semibold text-sky-200 truncate">
            {undoSubdivisionState.operationKind === 'zoom-out'
              ? `Extended borders (+${undoSubdivisionState.addedRegionCount} regions)`
              : `Added ${undoSubdivisionState.addedRegionCount} detail regions`}
          </span>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              type="button"
              data-testid="undo-subdivision-btn"
              onClick={() => void handleUndoSubdivision()}
              className="px-2.5 py-1 rounded-lg bg-sky-400 hover:bg-sky-300 text-slate-950 text-xs font-extrabold cursor-pointer"
            >
              {undoSubdivisionState.operationKind === 'zoom-out' ? 'Undo Extend' : 'Undo Split'}
            </button>
            <button
              type="button"
              aria-label="Dismiss Infinite Zoom notice"
              onClick={clearUndoSubdivision}
              className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {infiniteZoomError && !guidedHandoffSession && (
        <div
          role="alert"
          data-testid="infinite-zoom-error-toast"
          className="fixed left-1/2 -translate-x-1/2 z-[56] max-w-md w-[calc(100%-1.5rem)] bg-red-950/95 border border-red-500/60 text-red-100 px-3.5 py-2.5 rounded-xl shadow-2xl flex items-start justify-between gap-3 text-xs backdrop-blur-md"
          style={{
            bottom: `calc(${
              settings.raisePaletteDock
                ? 'var(--capy-replay-bottom-raised, 6.25rem)'
                : 'var(--capy-replay-bottom, 4.625rem)'
            } + var(--sab, 0px))`,
          }}
        >
          <span className="leading-snug break-words">{infiniteZoomError.message}</span>
          <button
            type="button"
            data-testid="infinite-zoom-error-dismiss"
            onClick={clearInfiniteZoomError}
            className="shrink-0 px-2.5 py-1 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-100 text-xs font-semibold cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      <GuidedGeminiHandoffModal
        isOpen={Boolean(guidedHandoffSession)}
        handoff={guidedHandoffSession?.handoff ?? null}
        fallbackReason={guidedHandoffSession?.fallbackReason ?? null}
        isProcessing={Boolean(guidedHandoffSession?.isProcessing)}
        errorMessage={guidedHandoffSession?.errorMessage ?? null}
        onImageReceived={handleCompleteGuidedGeminiHandoff}
        onCancel={handleCancelGuidedGeminiHandoff}
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
