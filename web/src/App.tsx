import React, { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import {
  DEFAULT_GENERATOR_CONFIG,
  GenerationProgressPayload,
  GeneratorConfig,
  MAX_GENERATOR_CONFIG,
  matchesGeneratorConfig,
  PaletteColor,
  PalettePreset,
  PuzzleData,
  Region,
  SAMPLE_GALLERY,
  SampleArtwork,
  SavedSnapshot,
  UserSettings,
  computeProgressPercentage,
} from './types';
import { DEFAULT_SETTINGS, QuotaWarning, StorageService } from './services/StorageService';
import {
  isCloudCoopUiEnabled,
  resolveScopedBackupKey,
} from './services/StorageNamespace';
import { SafeLocalStore } from './services/storage/SafeLocalStore';
import { compressImageForStorage } from './services/storage/ImageCompression';
import { TUTORIAL_COMPLETED_KEY } from './services/storage/StorageKeys';
import { reportSwallowed } from './services/telemetry';
import { NativeBridge } from './services/NativeBridge';
import { SoundService } from './services/SoundService';
import { exportPrintableColoringSvg } from './services/SvgPrintExporter';
import { PlayerLifetimeStats, PlayerStatsService } from './services/PlayerStatsService';
import { GenerationCancelledError, PuzzleWorkerService } from './services/PuzzleWorkerService';
import {
  isAllowedSampleAssetPath,
  isSafeSnapshotPreviewDataUrl,
  mergeProgressDeltas,
} from './services/CapyCodec';
import {
  resolveSafeSampleAssetPath,
  resolveSafeSnapshotPreviewUrl,
} from './utils/snapshotPaths';
import { useCloudSyncController } from './hooks/useCloudSyncController';
import { CoopLoadSampleFn, useCoopSession } from './hooks/useCoopSession';
import { useIsomorphicLayoutEffect, useLatest } from './hooks/useLatest';
import { useReplayController } from './hooks/useReplayController';
import { useSessionRestore } from './hooks/useSessionRestore';
import { UndoHistoryEntry, useUndoRedo } from './hooks/useUndoRedo';
import { finishPaintStroke } from './services/paintStrokeHelper';
import { loadHtmlImage, mergeCustomPalette } from './services/sessionRestorePipeline';
import { getDisplayNumberMap, getVisiblePalette } from './components/PaletteDock';
import { PuzzleCanvas } from './components/PuzzleCanvas';
import { GameTopBar } from './components/GameTopBar';
import { PaletteDock } from './components/PaletteDock';
import { FloatingActions } from './components/FloatingActions';
import { LoadingOverlay } from './components/LoadingOverlay';
import { ReplayControls } from './components/ReplayControls';
import {
  createInitialTutorialTried,
  OnboardingTutorial,
  TUTORIAL_STEPS,
  TutorialStepKey,
  TutorialTriedActions,
} from './components/OnboardingTutorial';
import { FeatureOfferBanner } from './components/FeatureOfferBanner';
import { TargetSpotlightOverlay } from './components/TargetSpotlightOverlay';
import {
  FEATURE_OFFERS,
  FeatureOfferDef,
  FeatureOfferId,
  FeatureOffersService,
} from './services/FeatureOffersService';
import { resolveReleaseChannel } from './version';

const SettingsModal = React.lazy(() =>
  import('./components/SettingsModal').then((m) => ({ default: m.SettingsModal }))
);
const ColorPickerPopover = React.lazy(() =>
  import('./components/ColorPickerPopover').then((m) => ({ default: m.ColorPickerPopover }))
);

function isDefaultGeneratorConfig(cfg: GeneratorConfig): boolean {
  return matchesGeneratorConfig(cfg, DEFAULT_GENERATOR_CONFIG);
}

function isMaxGeneratorConfig(cfg: GeneratorConfig): boolean {
  return matchesGeneratorConfig(cfg, MAX_GENERATOR_CONFIG);
}

export { mergeCustomPalette };

function isEditableKeyboardTarget(el: EventTarget | null): boolean {
  if (!el || typeof el !== 'object') return false;
  const node = el as HTMLElement;
  const tag = node.tagName ? node.tagName.toUpperCase() : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (node.isContentEditable || node.contentEditable === 'true') return true;
  return false;
}

export const App: React.FC = () => {
  // Persistence & Settings
  const [settings, setSettings] = useState<UserSettings>(() => StorageService.loadSettings());
  const [lifetimeStats, setLifetimeStats] = useState<PlayerLifetimeStats>(() =>
    PlayerStatsService.loadStats()
  );
  const [snapshots, setSnapshots] = useState<SavedSnapshot[]>(() => StorageService.loadSnapshots());
  const [activeSnapshotId, setActiveSnapshotId] = useState<string | null>(null);
  const hintsUsedInSessionRef = useRef<number>(0);
  const activeElapsedMsRef = useRef<number>(0);
  const activeSessionResumedPerfRef = useRef<number | null>(null);
  const completedSnapshotIdsRef = useRef<Set<string>>(
    new Set(
      snapshots
        .filter((s) => s.totalCount > 0 && s.filledCount >= s.totalCount)
        .map((s) => s.id)
    )
  );

  // Sync procedural Web Audio synthesizer settings
  useEffect(() => {
    SoundService.configure({
      enabled: settings.soundEnabled !== false,
      volume: settings.soundVolume ?? 0.7,
    });
  }, [settings.soundEnabled, settings.soundVolume]);

  // Active Game State
  const [puzzle, setPuzzle] = useState<PuzzleData | null>(null);
  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null);
  const [activeColorId, setActiveColorId] = useState<number>(1);
  const [filledRegionIds, setFilledRegionIds] = useState<Set<number>>(new Set());
  const [paintedRegionColors, setPaintedRegionColors] = useState<Map<number, number>>(new Map());
  const [hintRegionId, setHintRegionId] = useState<number | null>(null);
  const [isPreviewMode, setIsPreviewMode] = useState<boolean>(false);
  const isPreviewModeRef = useLatest(isPreviewMode);
  const [zoomInTrigger, setZoomInTrigger] = useState<number>(0);
  const [zoomOutTrigger, setZoomOutTrigger] = useState<number>(0);
  const [resetViewTrigger, setResetViewTrigger] = useState<number>(0);
  const [restoreViewTrigger, setRestoreViewTrigger] = useState<number>(0);
  const [panStepRequest, setPanStepRequest] = useState<{ seq: number; dx: number; dy: number }>({
    seq: 0,
    dx: 0,
    dy: 0,
  });
  const [isCanvasTransformed, setIsCanvasTransformed] = useState<boolean>(false);
  const [initialViewport, setInitialViewport] = useState<{
    zoomScale: number;
    panOffsetX: number;
    panOffsetY: number;
  }>({ zoomScale: 1, panOffsetX: 0, panOffsetY: 0 });
  const viewportRef = useRef<{ zoomScale: number; panOffsetX: number; panOffsetY: number }>({
    zoomScale: 1,
    panOffsetX: 0,
    panOffsetY: 0,
  });
  const canvasContainerSizeRef = useRef<{ width: number; height: number }>({
    width: typeof window !== 'undefined' ? window.innerWidth : 1024,
    height: typeof window !== 'undefined' ? window.innerHeight : 768,
  });
  const viewportSaveTimerRef = useRef<number | null>(null);
  const pendingViewportExtentRef = useRef<{
    snapshotId: string;
    puzzle: PuzzleData;
    zoomScale: number;
    panOffsetX: number;
    panOffsetY: number;
  } | null>(null);
  const lastSavedViewportRef = useRef<{
    snapshotId: string;
    zoomScale: number;
    panOffsetX: number;
    panOffsetY: number;
  } | null>(null);
  const snapshotTransitioningRef = useRef<boolean>(false);
  const snapshotTransitionSeqRef = useRef<number>(0);
  const clearPendingViewportSave = useCallback(() => {
    if (viewportSaveTimerRef.current !== null) {
      window.clearTimeout(viewportSaveTimerRef.current);
      viewportSaveTimerRef.current = null;
    }
    pendingViewportExtentRef.current = null;
    lastSavedViewportRef.current = null;
  }, []);
  const activeBlobUrlRef = useRef<string | null>(null);

  // Spatial Viewport
  const [visibleColorIds, setVisibleColorIds] = useState<Set<number>>(new Set());
  const [visibleRegionIds, setVisibleRegionIds] = useState<Set<number>>(new Set());
  const [storageQuotaWarning, setStorageQuotaWarning] = useState<QuotaWarning | null>(null);

  const handleVisibleColorsChanged = useCallback((next: Set<number>) => {
    setVisibleColorIds((prev) => {
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
    });
  }, []);

  const handleVisibleRegionsChanged = useCallback((next: Set<number>) => {
    setVisibleRegionIds((prev) => {
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
    });
  }, []);

  useEffect(() => {
    StorageService.requestPersistentStorageOnce();
    return StorageService.onQuotaWarning((warning) => {
      setStorageQuotaWarning(warning);
    });
  }, []);

  // Loading & Generation Pipeline Details
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const isLoadingRef = useLatest(isLoading);
  const [loadingProgress, setLoadingProgress] = useState<number>(0.02);
  const [loadingStatus, setLoadingStatus] = useState<string>('Loading Capy...');
  const [loadingPayload, setLoadingPayload] = useState<GenerationProgressPayload | null>(null);

  // Modal Sheet, Onboarding Tutorial & Active Deployment Channel
  const settingsRef = useLatest(settings);
  const visibleColorIdsRef = useLatest(visibleColorIds);
  const visibleRegionIdsRef = useLatest(visibleRegionIds);
  const sourceImageRef = useLatest(sourceImage);
  const isFreeColorMode = Boolean(settings.isFreeColorMode);
  const activeSave = snapshots.find((s) => s.id === activeSnapshotId);
  const parentSave = useMemo(
    () =>
      activeSave?.parentSnapshotId
        ? snapshots.find((s) => s.id === activeSave.parentSnapshotId) ?? null
        : null,
    [activeSave?.parentSnapshotId, snapshots]
  );
  const activeTitle = activeSave?.title || 'Capy';
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
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const showSettingsRef = useLatest(showSettings);
  const [settingsInitialTab, setSettingsInitialTab] = useState<number | undefined>(undefined);
  const [settingsTabRequestKey, setSettingsTabRequestKey] = useState<number>(0);
  const [activeSettingsTab, setActiveSettingsTab] = useState<number>(1);
  const activeSettingsTabRef = useLatest(activeSettingsTab);
  const tutorialOpenedSettingsRef = useRef<boolean>(false);
  const hasCheckedSettingsTipRef = useRef<boolean>(false);
  const [showPaletteOptions, setShowPaletteOptions] = useState<boolean>(false);
  const [showTutorial, setShowTutorial] = useState<boolean>(false);
  const showTutorialRef = useLatest(showTutorial);
  const [tutorialStep, setTutorialStep] = useState<number>(0);
  const tutorialStepRef = useLatest(tutorialStep);
  const [tutorialStepTriedInVisit, setTutorialStepTriedInVisit] = useState<boolean>(false);
  const [tutorialTried, setTutorialTried] = useState<TutorialTriedActions>(createInitialTutorialTried);
  const [activeFeatureOffer, setActiveFeatureOffer] = useState<FeatureOfferDef | null>(null);
  const activeFeatureOfferRef = useLatest(activeFeatureOffer);
  const featureOfferQueueRef = useRef<FeatureOfferId[]>([]);
  const isFeatureOfferSuppressed =
    isLoading || showTutorial || showSettings || showPaletteOptions;
  const isFeatureOfferSuppressedRef = useLatest(isFeatureOfferSuppressed);
  const releaseChannelInfo = useMemo(() => resolveReleaseChannel(), []);

  const advanceFeatureOffer = useCallback(() => {
    while (featureOfferQueueRef.current.length > 0) {
      const nextId = featureOfferQueueRef.current.shift()!;
      if (!FeatureOffersService.hasSeenOffer(nextId)) {
        const nextOffer = FEATURE_OFFERS[nextId];
        activeFeatureOfferRef.current = nextOffer;
        setActiveFeatureOffer(nextOffer);
        return;
      }
    }
    activeFeatureOfferRef.current = null;
    setActiveFeatureOffer(null);
  }, [activeFeatureOfferRef]);

  useEffect(() => {
    if (isFeatureOfferSuppressed || showTutorial) return;
    if (activeFeatureOffer) {
      FeatureOffersService.markOfferSeen(activeFeatureOffer.id);
      return;
    }
    if (featureOfferQueueRef.current.length > 0) {
      advanceFeatureOffer();
    }
  }, [isFeatureOfferSuppressed, showTutorial, activeFeatureOffer, advanceFeatureOffer]);

  const triggerFeatureOffer = useCallback(
    (id: FeatureOfferId) => {
      if (showTutorialRef.current) return;
      if (FeatureOffersService.hasSeenOffer(id)) return;
      const curOffer = activeFeatureOfferRef.current;
      if (curOffer?.id === id || featureOfferQueueRef.current.includes(id)) {
        return;
      }
      featureOfferQueueRef.current.push(id);
      if (!isFeatureOfferSuppressedRef.current && !curOffer) {
        advanceFeatureOffer();
      }
    },
    [advanceFeatureOffer, activeFeatureOfferRef, isFeatureOfferSuppressedRef, showTutorialRef]
  );

  const markTutorialActionTried = useCallback(
    (action: keyof TutorialTriedActions) => {
      setTutorialTried((prev) => (prev[action] ? prev : { ...prev, [action]: true }));
      if (showTutorialRef.current && TUTORIAL_STEPS[tutorialStepRef.current]?.key === action) {
        setTutorialStepTriedInVisit(true);
      }
    },
    [showTutorialRef, tutorialStepRef]
  );

  // Maintain synchronous O(1) region lookup map whenever puzzle changes
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

  const flushPendingViewportSaveRef = useRef<() => void>(() => {});
  const tutorialTriggeredPreviewRef = useRef<boolean>(false);

  // Sync settings updates to storage without stale closure overwrites
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
  });

  const handleLongPressUndo = useCallback(() => {
    handleOpenTimelineReplay(undoStackRef.current);
  }, [handleOpenTimelineReplay, undoStackRef]);

  // Fullscreen State
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() => {
    if (typeof document === 'undefined') return false;
    return Boolean(
      document.fullscreenElement ||
      (document as any).webkitFullscreenElement
    );
  });

  useEffect(() => {
    const handleFullscreenChange = () => {
      const active = Boolean(
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement
      );
      setIsFullscreen(active);
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
      }
      if (activeBlobUrlRef.current) {
        URL.revokeObjectURL(activeBlobUrlRef.current);
        activeBlobUrlRef.current = null;
      }
    };
  }, []);

  const resetActivePuzzleSessionStats = useCallback(
    (snapshotId: string | null | undefined, alreadyCompleted: boolean) => {
      hintsUsedInSessionRef.current = 0;
      activeElapsedMsRef.current = 0;
      activeSessionResumedPerfRef.current = alreadyCompleted ? null : performance.now();
      if (snapshotId) {
        if (alreadyCompleted) {
          completedSnapshotIdsRef.current.add(snapshotId);
        } else {
          completedSnapshotIdsRef.current.delete(snapshotId);
        }
      }
    },
    []
  );

  const getCurrentActiveElapsedMs = useCallback((): number => {
    const runningDelta =
      activeSessionResumedPerfRef.current !== null
        ? Math.max(0, performance.now() - activeSessionResumedPerfRef.current)
        : 0;
    return Math.max(1, Math.round(activeElapsedMsRef.current + runningDelta));
  }, []);

  // Pause active coloring timer when modals open, replay runs, puzzle loads, or tab is hidden
  useEffect(() => {
    const syncTimer = () => {
      const isActivelyColoring =
        Boolean(puzzle) &&
        !isLoading &&
        !isReplaying &&
        !showSettings &&
        !showPaletteOptions &&
        filledRegionIds.size < (puzzle?.regions.length || 0) &&
        (typeof document === 'undefined' || !document.hidden);

      if (isActivelyColoring) {
        if (activeSessionResumedPerfRef.current === null) {
          activeSessionResumedPerfRef.current = performance.now();
        }
      } else if (activeSessionResumedPerfRef.current !== null) {
        activeElapsedMsRef.current += Math.max(
          0,
          performance.now() - activeSessionResumedPerfRef.current
        );
        activeSessionResumedPerfRef.current = null;
      }
    };

    syncTimer();
    document.addEventListener('visibilitychange', syncTimer);
    return () => {
      document.removeEventListener('visibilitychange', syncTimer);
    };
  }, [puzzle, isLoading, isReplaying, showSettings, showPaletteOptions, filledRegionIds.size]);

  const handleToggleFullscreen = useCallback(async () => {
    markTutorialActionTried('peek_fullscreen');
    try {
      if (
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement
      ) {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if ((document as any).webkitExitFullscreen) {
          await (document as any).webkitExitFullscreen();
        }
      } else {
        const el = document.documentElement;
        if (el.requestFullscreen) {
          await el.requestFullscreen();
        } else if ((el as any).webkitRequestFullscreen) {
          await (el as any).webkitRequestFullscreen();
        }
      }
    } catch (err) {
      console.warn('Fullscreen request failed or was blocked:', err);
    }
  }, [markTutorialActionTried]);

  // Hidden file input
  const fileInputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    const textScale = Number.isFinite(settings.textScale) ? settings.textScale : settings.largeText ? 1.25 : 1.0;
    const uiScale = Number.isFinite(settings.uiScale) ? settings.uiScale : settings.largeText ? 1.25 : 1.0;
    const root = document.documentElement;
    root.dataset.largeText = textScale > 1.0 || uiScale > 1.0 ? 'true' : 'false';
    root.dataset.textScaled = textScale !== 1.0 ? 'true' : 'false';
    root.dataset.uiScaled = uiScale !== 1.0 ? 'true' : 'false';
    root.dataset.uiBoosted = uiScale > 1.0 ? 'true' : 'false';
    root.style.setProperty('--capy-text-scale', String(textScale));
    root.style.setProperty('--capy-ui-scale', String(uiScale));
  }, [settings.largeText, settings.textScale, settings.uiScale]);

  // Sync modal & overlay states with native LIFO hardware back button stack
  useEffect(() => {
    if (!showSettings) return;
    return NativeBridge.pushBackHandler(() => setShowSettings(false));
  }, [showSettings]);

  // Resolve full-resolution source image URL for built-in samples or IndexedDB image blobs
  const resolveSnapshotImageSrc = useCallback(
    async (snap: SavedSnapshot): Promise<{ src: string; objectUrl: string | null }> => {
      const safeSampleSrc = resolveSafeSampleAssetPath(snap, true);
      if (safeSampleSrc) {
        return { src: safeSampleSrc, objectUrl: null };
      }

      const blobId =
        snap.sourceRef?.kind === 'blob' &&
        typeof snap.sourceRef.uri === 'string' &&
        snap.sourceRef.uri.trim().length > 0
          ? snap.sourceRef.uri
          : snap.id;
      const storedBlob = await StorageService.loadImageBlob(blobId);
      if (storedBlob) {
        const nextUrl = URL.createObjectURL(storedBlob);
        return { src: nextUrl, objectUrl: nextUrl };
      }

      const safePreview = resolveSafeSnapshotPreviewUrl(snap) ?? './assets/capybara.webp';
      return { src: safePreview, objectUrl: null };
    },
    []
  );

  useEffect(() => {
    void import('./components/SettingsModal');
    void import('./components/ColorPickerPopover');
  }, []);

  // Generate thumbnail data URL
  const generatePreviewDataUrl = useCallback(
    (
      puzzleData: PuzzleData,
      sourceImg: HTMLImageElement,
      filledSet: Set<number>,
      customColors?: Map<number, number>
    ): string => {
      const maxDim = 320;
      const scale = Math.min(1, maxDim / Math.max(puzzleData.width, puzzleData.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(puzzleData.width * scale));
      canvas.height = Math.max(1, Math.round(puzzleData.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return '';

      const paletteMap = new Map<number, PaletteColor>(
        puzzleData.palette.map((c) => [c.id, c])
      );

      if (puzzleData.isFreeColor || (customColors && customColors.size > 0)) {
        // Free colour / coloring page rendering: render filled regions and blend line art
        const fullCanvas = document.createElement('canvas');
        fullCanvas.width = puzzleData.width;
        fullCanvas.height = puzzleData.height;
        const fCtx = fullCanvas.getContext('2d');
        if (fCtx) {
          const imgData = fCtx.createImageData(puzzleData.width, puzzleData.height);
          const data = imgData.data;
          data.fill(255);

          for (const region of puzzleData.regions) {
            if (filledSet.has(region.id)) {
              const colId = customColors?.get(region.id) ?? region.colorId;
              const col = paletteMap.get(colId);
              const r = col?.r ?? 71;
              const g = col?.g ?? 85;
              const b = col?.b ?? 105;
              for (let i = 0; i < region.pixels.length; i++) {
                const idx = region.pixels[i] * 4;
                data[idx] = r;
                data[idx + 1] = g;
                data[idx + 2] = b;
                data[idx + 3] = 255;
              }
            }
          }
          fCtx.putImageData(imgData, 0, 0);
          fCtx.globalCompositeOperation = 'multiply';
          fCtx.drawImage(sourceImg, 0, 0);
          fCtx.globalCompositeOperation = 'source-over';

          ctx.drawImage(fullCanvas, 0, 0, canvas.width, canvas.height);
        }
      } else {
        // Standard photo rendering: clean, sharp aspect-ratio scaled image without white veil
        ctx.drawImage(sourceImg, 0, 0, canvas.width, canvas.height);
      }

      return canvas.toDataURL('image/jpeg', 0.85);
    },
    []
  );

  const handleSyncActiveColor = useCallback((colId: number) => {
    liveCoopRef.current = { ...liveCoopRef.current, activeColorId: colId };
    setActiveColorId(colId);
  }, []);

  const cleanupTutorialTransientModes = useCallback(
    (nextStepKey: TutorialStepKey | null = null) => {
      if (tutorialOpenedReplayRef.current && nextStepKey !== 'replay') {
        exitReplay();
      }
      if (tutorialTriggeredPreviewRef.current && nextStepKey !== 'peek_fullscreen') {
        tutorialTriggeredPreviewRef.current = false;
        isPreviewModeRef.current = false;
        setIsPreviewMode(false);
      }
      const nextStepDef = nextStepKey
        ? TUTORIAL_STEPS.find((step) => step.key === nextStepKey)
        : undefined;
      if (tutorialOpenedSettingsRef.current && nextStepDef?.modalTab === undefined) {
        tutorialOpenedSettingsRef.current = false;
        setShowSettings(false);
      }
    },
    [exitReplay, isPreviewModeRef, tutorialOpenedReplayRef]
  );

  const completeTutorial = useCallback(() => {
    cleanupTutorialTransientModes(null);
    setShowTutorial(false);
    setTutorialStepTriedInVisit(false);
    hasCheckedSettingsTipRef.current = true;
    FeatureOffersService.markOfferSeen('settings_hints_tip');
    SafeLocalStore.setScopedItem(TUTORIAL_COMPLETED_KEY, '1');
    NativeBridge.saveBackup(resolveScopedBackupKey(TUTORIAL_COMPLETED_KEY), '1');
  }, [cleanupTutorialTransientModes]);

  useEffect(() => {
    if (!showTutorial) return;
    return NativeBridge.pushBackHandler(completeTutorial);
  }, [showTutorial, completeTutorial]);

  useEffect(() => {
    if (isLoading || !puzzle || showTutorial || hasCheckedSettingsTipRef.current) return;
    hasCheckedSettingsTipRef.current = true;
    const skipTutorial =
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).has('skipTutorial');
    if (skipTutorial) return;
    let tutorialCompleted = false;
    try {
      tutorialCompleted =
        SafeLocalStore.getScopedItem(TUTORIAL_COMPLETED_KEY) === '1' ||
        NativeBridge.loadBackup(resolveScopedBackupKey(TUTORIAL_COMPLETED_KEY)) === '1';
    } catch (err) {
      reportSwallowed('App.tutorialCompletedCheck', err);
    }
    if (tutorialCompleted) {
      triggerFeatureOffer('settings_hints_tip');
    }
  }, [isLoading, puzzle, showTutorial, triggerFeatureOffer]);

  const handleStartTutorial = useCallback(() => {
    featureOfferQueueRef.current = [];
    activeFeatureOfferRef.current = null;
    setActiveFeatureOffer(null);
    tutorialOpenedSettingsRef.current = false;
    cleanupTutorialTransientModes(TUTORIAL_STEPS[0]?.key ?? null);
    setTutorialStepTriedInVisit(false);
    setTutorialStep(0);
    setTutorialTried(createInitialTutorialTried());
    setShowTutorial(true);
  }, [activeFeatureOfferRef, cleanupTutorialTransientModes]);

  const handleStartSettingsTour = useCallback(() => {
    featureOfferQueueRef.current = [];
    activeFeatureOfferRef.current = null;
    setActiveFeatureOffer(null);
    const targetKey: TutorialStepKey = activeSettingsTabRef.current === 2 ? 'hints' : 'settings';
    const targetIdx = Math.max(
      0,
      TUTORIAL_STEPS.findIndex((step) => step.key === targetKey)
    );
    const targetTab = TUTORIAL_STEPS[targetIdx]?.modalTab ?? 1;
    tutorialOpenedSettingsRef.current = false;
    cleanupTutorialTransientModes(targetKey);
    setSettingsInitialTab(targetTab);
    setSettingsTabRequestKey((k) => k + 1);
    setShowSettings(true);
    setTutorialStepTriedInVisit(false);
    setTutorialStep(targetIdx);
    setShowTutorial(true);
  }, [activeFeatureOfferRef, activeSettingsTabRef, cleanupTutorialTransientModes]);

  const handleOpenTutorialSettingsTab = useCallback(
    (tabIndex: number) => {
      if (!showSettingsRef.current) {
        tutorialOpenedSettingsRef.current = true;
      }
      setSettingsInitialTab(tabIndex);
      setSettingsTabRequestKey((k) => k + 1);
      setShowSettings(true);
    },
    [showSettingsRef]
  );

  const handleJumpToTutorialStep = useCallback(
    (stepIdx: number) => {
      const clampedIdx = Math.max(0, Math.min(TUTORIAL_STEPS.length - 1, stepIdx));
      const targetStep = TUTORIAL_STEPS[clampedIdx];
      advanceFeatureOffer();
      cleanupTutorialTransientModes(targetStep?.key ?? null);
      setTutorialStepTriedInVisit(false);
      setTutorialStep(clampedIdx);
      setShowTutorial(true);
      if (targetStep?.modalTab !== undefined) {
        if (!showSettingsRef.current) {
          tutorialOpenedSettingsRef.current = true;
        }
        setSettingsInitialTab(targetStep.modalTab);
        setSettingsTabRequestKey((k) => k + 1);
        setShowSettings(true);
      }
    },
    [advanceFeatureOffer, cleanupTutorialTransientModes, showSettingsRef]
  );

  const handleTutorialStepChange = useCallback(
    (nextStep: number) => {
      const clampedIdx = Math.max(0, Math.min(TUTORIAL_STEPS.length - 1, nextStep));
      const nextStepDef = TUTORIAL_STEPS[clampedIdx];
      cleanupTutorialTransientModes(nextStepDef?.key ?? null);
      setTutorialStepTriedInVisit(false);
      setTutorialStep(clampedIdx);
      if (showSettingsRef.current && nextStepDef?.modalTab !== undefined) {
        setSettingsInitialTab(nextStepDef.modalTab);
        setSettingsTabRequestKey((k) => k + 1);
      }
    },
    [cleanupTutorialTransientModes, showSettingsRef]
  );

  // Generation sequence tracking to ignore cancelled/superseded requests
  const generationSeqRef = useRef<number>(0);

  // Core Puzzle Generation & Loading Pipeline
  const loadArtworkFromImage = useCallback(
    async (
      img: HTMLImageElement,
      title: string,
      config: GeneratorConfig = settings.generatorConfig,
      initialFilledRegionIds: Set<number> = new Set(),
      initialActiveColorId?: number,
      existingSnapshotId?: string,
      sampleAssetPath?: string | null,
      shouldAutoReplay: boolean = false,
      sourceBlob?: Blob | null,
      initialPaintedColors?: Record<number, number>,
      initialViewportOverride?: { zoomScale: number; panOffsetX: number; panOffsetY: number },
      initialCustomPalette?: PaletteColor[],
      initialIsFreeColor?: boolean,
      parentSnapshotId?: string
    ) => {
      const currentSeq = ++generationSeqRef.current;
      const transitionSeq = ++snapshotTransitionSeqRef.current;
      clearPendingViewportSave();
      snapshotTransitioningRef.current = true;
      liveCoopRef.current = {
        ...liveCoopRef.current,
        activeSnapshotId: null,
        puzzle: null,
      };
      resetReplayState();
      setIsLoading(true);
      setLoadingProgress(0.02);
      setLoadingStatus('Analyzing artwork style and line composition...');
      setLoadingPayload(null);

      // Immediately display source image on canvas and clear previous puzzle regions
      // so the live generation scan/segmentation visualization renders over the new image
      setSourceImage(img);
      setPuzzle(null);
      setHintRegionId(null);
      syncRedoStack([]);
      const targetView = initialViewportOverride || {
        zoomScale: 1.0,
        panOffsetX: 0,
        panOffsetY: 0,
      };
      viewportRef.current = targetView;
      setInitialViewport(targetView);
      setRestoreViewTrigger((prev) => prev + 1);

      let canvas: HTMLCanvasElement;
      let snapId: string;
      try {
        // Prepare canvas from image
        canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx =
          canvas.getContext('2d', { willReadFrequently: true }) || canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);

        // Pre-register snapshot at 0ms so it appears in Saves instantly!
        snapId = existingSnapshotId || crypto.randomUUID();
        const sourceRef = sampleAssetPath
          ? ({ kind: 'sample', uri: sampleAssetPath } as const)
          : ({ kind: 'blob', uri: snapId } as const);

        const newSnapshot: SavedSnapshot = {
          id: snapId,
          title: title || 'Artwork',
          timestamp: Date.now(),
          lastOpened: Date.now(),
          filledCount: initialFilledRegionIds.size,
          totalCount: 100,
          filledRegionIds: Array.from(initialFilledRegionIds),
          ...(initialPaintedColors ? { paintedRegionColors: initialPaintedColors } : {}),
          ...(initialCustomPalette && initialCustomPalette.length > 0
            ? { customPalette: initialCustomPalette }
            : {}),
          ...(initialIsFreeColor !== undefined ? { isFreeColor: initialIsFreeColor } : {}),
          ...(parentSnapshotId ? { parentSnapshotId } : {}),
          zoomScale: targetView.zoomScale,
          panOffsetX: targetView.panOffsetX,
          panOffsetY: targetView.panOffsetY,
          sampleAssetPath,
          sourceRef,
        };

        setActiveSnapshotId(snapId);
        const updatedSnapshots = StorageService.addSnapshot(newSnapshot);
        setSnapshots(updatedSnapshots);

        // Persist custom image blob to IndexedDB (downscaling & compressing oversized uploads)
        if (!sampleAssetPath) {
          const expectedTransitionSeq = snapshotTransitionSeqRef.current;
          const persistBlobPromise = compressImageForStorage({
            blob: sourceBlob,
            image: img,
            width: canvas.width,
            height: canvas.height,
          });
          persistBlobPromise
            .then((blob) => {
              if (
                !blob ||
                expectedTransitionSeq !== snapshotTransitionSeqRef.current ||
                !StorageService.loadSnapshots().some((s) => s.id === snapId)
              ) {
                return;
              }
              return StorageService.saveImageBlob(snapId, blob);
            })
            .catch((err) => console.warn('Failed to persist source image blob:', err));
        }
      } catch (err) {
        console.error('Failed to prepare puzzle generation:', err);
        if (transitionSeq === snapshotTransitionSeqRef.current) {
          clearPendingViewportSave();
          snapshotTransitioningRef.current = false;
          setActiveSnapshotId(null);
          setPuzzle(null);
          setLoadingStatus('Failed to generate puzzle.');
          setIsLoading(false);
          liveCoopRef.current = {
            ...latestRenderCoopRef.current,
            activeSnapshotId: null,
            puzzle: null,
          };
        }
        return;
      }

      // Run generator in background Web Worker thread to prevent freezing browser
      setTimeout(async () => {
        if (
          currentSeq !== generationSeqRef.current ||
          transitionSeq !== snapshotTransitionSeqRef.current
        ) {
          return;
        }
        try {
          const isDetailed = Boolean(settings.detailedLoadingProgress);
          const puzzleData = await PuzzleWorkerService.generate(
            canvas,
            config,
            (prog, stat, payload) => {
              if (
                currentSeq === generationSeqRef.current &&
                transitionSeq === snapshotTransitionSeqRef.current
              ) {
                setLoadingProgress((prev) => Math.max(prev, prog));
                setLoadingStatus(stat);
                if (payload) {
                  setLoadingPayload(payload);
                }
              }
            },
            isDetailed
          );

          if (
            currentSeq !== generationSeqRef.current ||
            transitionSeq !== snapshotTransitionSeqRef.current
          ) {
            return;
          }

          if (initialCustomPalette && initialCustomPalette.length > 0) {
            puzzleData.palette = mergeCustomPalette(puzzleData.palette, initialCustomPalette);
          }

          const initialOrder = Array.from(initialFilledRegionIds);
          const nextFilledSet = new Set(initialOrder);
          const restoredPaintedMap = initialPaintedColors
            ? new Map(Object.entries(initialPaintedColors).map(([k, v]) => [Number(k), v]))
            : new Map<number, number>();
          liveCoopRef.current = {
            ...liveCoopRef.current,
            puzzle: puzzleData,
            filledRegionIds: nextFilledSet,
            paintedRegionColors: restoredPaintedMap,
          };
          setSourceImage(img);
          setPuzzle(puzzleData);
          setFilledRegionIds(nextFilledSet);
          setPaintedRegionColors(restoredPaintedMap);
          syncUndoStack(
            initialOrder.map((rId) => ({
              regionId: rId,
              wasPreviouslyFilled: false,
            }))
          );
          syncRedoStack([]);

          const isFree = Boolean(
            initialIsFreeColor ||
              config.isFreeColor ||
              puzzleData.isFreeColor ||
              (initialPaintedColors && Object.keys(initialPaintedColors).length > 0)
          );
          handleUpdateSettings((prev) => ({
            ...prev,
            isFreeColorMode: isFree,
            ...((existingSnapshotId || shouldAutoReplay) && prev.replayLoop
              ? { replayLoop: false }
              : {}),
          }));
          resetActivePuzzleSessionStats(
            snapId,
            initialFilledRegionIds.size >= puzzleData.regions.length
          );
          if (!existingSnapshotId && initialFilledRegionIds.size === 0 && isFree) {
            setLifetimeStats(PlayerStatsService.recordFreeColorCreation());
          }

          // Defensively find the first available color that actually has uncompleted regions
          const availableColors = getVisiblePalette(
            puzzleData.palette,
            puzzleData.regions,
            initialFilledRegionIds,
            settings.paletteSort
          );
          const targetColor =
            initialActiveColorId && availableColors.some((c) => c.id === initialActiveColorId)
              ? initialActiveColorId
              : availableColors[0]?.id || puzzleData.palette[0]?.id || 1;
          setActiveColorId(targetColor);
          setHintRegionId(null);

          const previewUrl = generatePreviewDataUrl(
            puzzleData,
            img,
            initialFilledRegionIds,
            restoredPaintedMap
          );
          const estSaveBytes = StorageService.estimatePuzzleSaveBytes(puzzleData, previewUrl);

          // Update snapshot with final region counts and storage size
          const finalizedSnapshots = StorageService.updateSnapshotProgress(
            snapId,
            initialFilledRegionIds.size,
            puzzleData.regions.length,
            initialOrder,
            targetView.zoomScale,
            targetView.panOffsetX,
            targetView.panOffsetY,
            previewUrl,
            initialPaintedColors,
            puzzleData.palette,
            isFree,
            estSaveBytes
          );
          const syncedLoadedSave = finalizedSnapshots.find((s) => s.id === snapId);
          liveCoopRef.current = {
            ...liveCoopRef.current,
            activeSnapshotId: snapId,
            activeColorId: targetColor,
            isFreeColorMode: isFree,
            activeSave: syncedLoadedSave,
            activeTitle: syncedLoadedSave?.title || 'Capy',
          };
          setSnapshots(finalizedSnapshots);

          // Persist puzzle in IndexedDB (quota/IDB errors surface via onQuotaWarning toast)
          await StorageService.savePuzzleData(snapId, puzzleData).catch((err) => {
            reportSwallowed('App.savePuzzleData', err, { id: snapId });
          });

          if (
            currentSeq !== generationSeqRef.current ||
            transitionSeq !== snapshotTransitionSeqRef.current
          ) {
            return;
          }

          // Persist active game session
          StorageService.saveActiveState({
            activeSnapshotId: snapId,
            activeColorId: targetColor,
            filledRegionIds: initialOrder,
            paintedRegionColors: initialPaintedColors || {},
            isFreeColorMode: isFree,
            zoomScale: targetView.zoomScale,
            panOffsetX: targetView.panOffsetX,
            panOffsetY: targetView.panOffsetY,
          });

          clearPendingViewportSave();
          snapshotTransitioningRef.current = false;
          setIsLoading(false);

          if (shouldAutoReplay && initialOrder.length > 0) {
            startReplay(initialOrder, true);
          }
        } catch (err) {
          // If cancelled by a newer request or superseded, quietly ignore
          if (
            err instanceof GenerationCancelledError ||
            (err as Error)?.name === 'GenerationCancelledError' ||
            (err as Error)?.message?.includes('cancelled') ||
            currentSeq !== generationSeqRef.current ||
            transitionSeq !== snapshotTransitionSeqRef.current
          ) {
            if (transitionSeq === snapshotTransitionSeqRef.current) {
              clearPendingViewportSave();
              snapshotTransitioningRef.current = false;
              setIsLoading(false);
            }
            return;
          }
          console.error('Failed to generate puzzle:', err);
          if (transitionSeq === snapshotTransitionSeqRef.current) {
            clearPendingViewportSave();
            snapshotTransitioningRef.current = false;
            setLoadingStatus('Failed to generate puzzle.');
            setIsLoading(false);
          }
        } finally {
          if (transitionSeq === snapshotTransitionSeqRef.current && snapshotTransitioningRef.current) {
            clearPendingViewportSave();
            snapshotTransitioningRef.current = false;
          }
        }
      }, 50);
    },
    [
      settings,
      clearPendingViewportSave,
      generatePreviewDataUrl,
      startReplay,
      resetReplayState,
      handleUpdateSettings,
      resetActivePuzzleSessionStats,
      syncUndoStack,
      syncRedoStack,
      latestRenderCoopRef,
    ]
  );

  // Restore session on app launch (checking incoming #s=<token> / ?room=<ROOM6> links and instant sample bootstrap)
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
      onApplyViewport: (view) => {
        viewportRef.current = view;
        setInitialViewport(view);
        setRestoreViewTrigger((prev) => prev + 1);
      },
      onSetSnapshots: setSnapshots,
      onSetPaintedRegionColors: setPaintedRegionColors,
      onSetSettings: setSettings,
      onUpdateSettings: handleUpdateSettings,
      onSetSourceImage: setSourceImage,
      onSetPuzzle: setPuzzle,
      onSetActiveSnapshotId: setActiveSnapshotId,
      onSetActiveColorId: setActiveColorId,
      onUpdateLiveCoop: (patch) => {
        liveCoopRef.current = {
          ...liveCoopRef.current,
          ...patch,
        };
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

  // Listen for images shared directly from Android/iOS OS share sheet
  useEffect(() => {
    return NativeBridge.onSharedImage((title, dataUrl) => {
      const img = new Image();
      img.onload = async () => {
        let sharedBlob: Blob | null = null;
        try {
          sharedBlob = await (await fetch(dataUrl)).blob();
        } catch {
          sharedBlob = null;
        }
        loadArtworkFromImage(
          img,
          title,
          settings.generatorConfig,
          new Set(),
          undefined,
          undefined,
          undefined,
          false,
          sharedBlob
        );
      };
      img.src = dataUrl;
    });
  }, [loadArtworkFromImage, settings.generatorConfig]);

  // Display number mapping
  const displayNumberMap = useMemo(() => {
    if (!puzzle) return new Map<number, string>();
    return getDisplayNumberMap(puzzle.palette, puzzle.regions, settings.paletteSort);
  }, [puzzle, settings.paletteSort]);

  // Keyboard shortcuts:
  // - Ctrl+Z / Cmd+Z (Undo), Ctrl+Y / Cmd+Y / Ctrl+Shift+Z (Redo)
  // - 1..9 swatch select, +/= zoom in, -/_ zoom out, 0 reset fit view, Arrow/WASD 64px pan
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
        const lowerKey = e.key.toLowerCase();
        const isUndoKey = !e.shiftKey && lowerKey === 'z';
        const isRedoKey = lowerKey === 'y' || (e.shiftKey && lowerKey === 'z');
        if ((isUndoKey || isRedoKey) && isUndoEnabled) {
          const wasAwaiting = dismissPostLoadReplayIfAwaiting();
          if (isReplaying && !wasAwaiting) return;
          e.preventDefault();
          if (isUndoKey) {
            handleUndo(wasAwaiting);
          } else {
            handleRedo(wasAwaiting);
          }
        }
        return;
      }

      // Never hijack browser shortcuts when Ctrl, Meta, or Alt modifiers are held
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!puzzle) return;

      if (e.key >= '1' && e.key <= '9') {
        const wasAwaiting = dismissPostLoadReplayIfAwaiting();
        const cur = liveCoopRef.current;
        const curPuzzle = cur.puzzle ?? puzzle;
        const curFilled = cur.filledRegionIds;
        if ((isReplaying && !wasAwaiting) || curFilled.size >= curPuzzle.regions.length) return;
        const selectablePalette = getVisiblePalette(
          curPuzzle.palette,
          curPuzzle.regions,
          curFilled,
          cur.settings.paletteSort,
          cur.isFreeColorMode
        );
        const index = Number(e.key) - 1;
        if (index >= 0 && index < selectablePalette.length) {
          e.preventDefault();
          const chosenColId = selectablePalette[index].id;
          NativeBridge.haptic('tick', cur.settings.hapticsEnabled);
          liveCoopRef.current = { ...cur, activeColorId: chosenColId };
          setActiveColorId(chosenColId);
          setHintRegionId(null);
          markTutorialActionTried('palette');
        }
        return;
      }

      switch (e.key) {
        case '+':
        case '=':
          e.preventDefault();
          dismissPostLoadReplayIfAwaiting();
          markTutorialActionTried('zoom');
          setZoomInTrigger((prev) => prev + 1);
          return;
        case '-':
        case '_':
          e.preventDefault();
          dismissPostLoadReplayIfAwaiting();
          markTutorialActionTried('zoom');
          setZoomOutTrigger((prev) => prev + 1);
          return;
        case '0':
          e.preventDefault();
          dismissPostLoadReplayIfAwaiting();
          markTutorialActionTried('zoom');
          setResetViewTrigger((prev) => prev + 1);
          return;
        case 'ArrowUp':
        case 'w':
        case 'W':
          e.preventDefault();
          dismissPostLoadReplayIfAwaiting();
          markTutorialActionTried('zoom');
          setPanStepRequest((prev) => ({ seq: prev.seq + 1, dx: 0, dy: 64 }));
          return;
        case 'ArrowDown':
        case 's':
        case 'S':
          e.preventDefault();
          dismissPostLoadReplayIfAwaiting();
          markTutorialActionTried('zoom');
          setPanStepRequest((prev) => ({ seq: prev.seq + 1, dx: 0, dy: -64 }));
          return;
        case 'ArrowLeft':
        case 'a':
        case 'A':
          e.preventDefault();
          dismissPostLoadReplayIfAwaiting();
          markTutorialActionTried('zoom');
          setPanStepRequest((prev) => ({ seq: prev.seq + 1, dx: 64, dy: 0 }));
          return;
        case 'ArrowRight':
        case 'd':
        case 'D':
          e.preventDefault();
          dismissPostLoadReplayIfAwaiting();
          markTutorialActionTried('zoom');
          setPanStepRequest((prev) => ({ seq: prev.seq + 1, dx: -64, dy: 0 }));
          return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    showSettings,
    showPaletteOptions,
    isReplaying,
    isLoading,
    puzzle,
    filledRegionIds,
    settings.paletteSort,
    settings.hapticsEnabled,
    isFreeColorMode,
    handleUndo,
    handleRedo,
    isUndoEnabled,
    dismissPostLoadReplayIfAwaiting,
    markTutorialActionTried,
  ]);

  const recordFirstTimePuzzleCompletionIfNeeded = useCallback(
    (wasIncomplete: boolean, isNowComplete: boolean, snapshotIdOverride?: string | null) => {
      if (!wasIncomplete || !isNowComplete) return;
      const targetSnapshotId = snapshotIdOverride ?? liveCoopRef.current.activeSnapshotId;
      if (targetSnapshotId && completedSnapshotIdsRef.current.has(targetSnapshotId)) {
        return;
      }
      if (targetSnapshotId) {
        completedSnapshotIdsRef.current.add(targetSnapshotId);
      }
      const elapsedMs = getCurrentActiveElapsedMs();
      activeSessionResumedPerfRef.current = null;
      setLifetimeStats(
        PlayerStatsService.recordPuzzleCompleted({
          hintsUsed: hintsUsedInSessionRef.current,
          activeElapsedMs: elapsedMs,
        })
      );
    },
    [getCurrentActiveElapsedMs]
  );

  const completePaintStroke = useCallback(
    (
      curPuzzle: PuzzleData,
      nextFilled: Set<number>,
      paintedRegionColorsMap: Map<number, number>,
      activeColorIdToPersist: number,
      isFreeColor: boolean,
      wasPuzzleIncomplete: boolean,
      snapshotId: string | null,
      curSettings: UserSettings,
      filledRegionColorId?: number
    ) => {
      finishPaintStroke(
        {
          puzzle: curPuzzle,
          nextFilled,
          paintedRegionColors: paintedRegionColorsMap,
          activeColorId: activeColorIdToPersist,
          isFreeColorMode: isFreeColor,
          wasPuzzleIncomplete,
          snapshotId,
          settings: curSettings,
          viewport: viewportRef.current,
          visibleColorIds: visibleColorIdsRef.current,
          filledRegionColorId,
        },
        {
          onRecordFirstTimeCompletion: recordFirstTimePuzzleCompletionIfNeeded,
          onHaptic: (type, enabled) => NativeBridge.haptic(type, enabled),
          onConfetti: () => {
            confetti({
              particleCount: 120,
              spread: 80,
              origin: { y: 0.6 },
            });
          },
          onStartReplay: startReplay,
          onActiveColorAutoAdvanced: (nextColorId) => {
            liveCoopRef.current = { ...liveCoopRef.current, activeColorId: nextColorId };
            setActiveColorId(nextColorId);
          },
          onUpdateSnapshotProgress: (
            id,
            filledCountArg,
            totalCountArg,
            orderedIds,
            zoomScale,
            panOffsetX,
            panOffsetY,
            paintedObj,
            customPalette,
            isFreeColorPuzzle
          ) =>
            StorageService.updateSnapshotProgress(
              id,
              filledCountArg,
              totalCountArg,
              orderedIds,
              zoomScale,
              panOffsetX,
              panOffsetY,
              undefined,
              paintedObj,
              customPalette,
              isFreeColorPuzzle
            ),
          onSetSnapshots: setSnapshots,
          onSaveActiveState: (state) => StorageService.saveActiveState(state),
        }
      );
    },
    [recordFirstTimePuzzleCompletionIfNeeded, startReplay, visibleColorIdsRef]
  );

  // Handle single region coloring
  const attemptFillRegion = useCallback(
    (regionId: number) => {
      const cur = liveCoopRef.current;
      const curPuzzle = cur.puzzle;
      if (!curPuzzle) return;
      const curFilled = cur.filledRegionIds;
      const curPainted = cur.paintedRegionColors;
      const curActiveColorId = cur.activeColorId;
      const curIsFreeColor = cur.isFreeColorMode;
      const curSnapshotId = cur.activeSnapshotId;
      const curSettings = cur.settings;

      if (isReplayingRef.current) {
        if (isPostLoadReplayRef.current && curFilled.size < curPuzzle.regions.length) {
          exitReplay();
        } else {
          return;
        }
      }
      const region =
        curPuzzle === puzzle
          ? regionByIdRef.current.get(regionId)
          : curPuzzle.regions.find((r) => r.id === regionId);
      if (!region) return;
      const wasPuzzleIncomplete = curFilled.size < curPuzzle.regions.length;

      if (curIsFreeColor) {
        const wasFilled = curFilled.has(regionId);
        const currentPaintedColor = curPainted.get(regionId);
        const effectivePrevColor =
          currentPaintedColor !== undefined
            ? currentPaintedColor
            : wasFilled
              ? region.colorId
              : undefined;
        if (effectivePrevColor === curActiveColorId) return;

        syncUndoStack((prev) => [
          ...prev,
          {
            regionId,
            wasPreviouslyFilled: wasFilled,
            previousPaintedColorId: effectivePrevColor,
            paintedColorId: curActiveColorId,
          },
        ]);
        syncRedoStack([]);

        const nextPainted = new Map(curPainted);
        nextPainted.set(regionId, curActiveColorId);
        const nextFilled = new Set(curFilled);
        nextFilled.add(regionId);
        liveCoopRef.current = {
          ...cur,
          filledRegionIds: nextFilled,
          paintedRegionColors: nextPainted,
        };
        setPaintedRegionColors(nextPainted);
        setFilledRegionIds(nextFilled);
        setHintRegionId(null);
        markTutorialActionTried('paint');
        emitCoopPaint('FILL', [regionId], { [regionId]: curActiveColorId });
        setLifetimeStats(PlayerStatsService.recordRegionsColored(1, isCoopSessionActive()));
        SoundService.playRegionTap(curActiveColorId);
        completePaintStroke(
          curPuzzle,
          nextFilled,
          nextPainted,
          curActiveColorId,
          true,
          wasPuzzleIncomplete,
          curSnapshotId,
          curSettings
        );
        return;
      }

      if (curFilled.has(regionId)) return;

      const isEasy = curSettings.difficulty === 'EASY';
      const canFill = isEasy || region.colorId === curActiveColorId;

      if (!canFill) return;

      const nextActiveColId = isEasy ? region.colorId : curActiveColorId;
      if (isEasy && curActiveColorId !== region.colorId) {
        setActiveColorId(region.colorId);
      }

      syncUndoStack((prev) => [
        ...prev,
        {
          regionId,
          wasPreviouslyFilled: false,
          paintedColorId: region.colorId,
        },
      ]);
      syncRedoStack([]);

      const nextFilled = new Set(curFilled);
      nextFilled.add(regionId);
      liveCoopRef.current = {
        ...cur,
        filledRegionIds: nextFilled,
        activeColorId: nextActiveColId,
      };
      setFilledRegionIds(nextFilled);
      setHintRegionId(null);
      markTutorialActionTried('paint');
      emitCoopPaint('FILL', [regionId]);
      setLifetimeStats(PlayerStatsService.recordRegionsColored(1, isCoopSessionActive()));
      SoundService.playRegionTap(region.colorId);
      completePaintStroke(
        curPuzzle,
        nextFilled,
        curPainted,
        nextActiveColId,
        curIsFreeColor,
        wasPuzzleIncomplete,
        curSnapshotId,
        curSettings,
        region.colorId
      );
    },
    [
      puzzle,
      completePaintStroke,
      emitCoopPaint,
      exitReplay,
      markTutorialActionTried,
      syncUndoStack,
      syncRedoStack,
      isCoopSessionActive,
      isPostLoadReplayRef,
      isReplayingRef,
      regionByIdRef,
    ]
  );

  // Handle batch fill (for Paint Mode drag-to-color)
  const attemptBatchFillRegions = useCallback(
    (regionIds: Set<number>) => {
      const cur = liveCoopRef.current;
      const curPuzzle = cur.puzzle;
      if (!curPuzzle || regionIds.size === 0) return;
      const curFilled = cur.filledRegionIds;
      const curPainted = cur.paintedRegionColors;
      const curActiveColorId = cur.activeColorId;
      const curIsFreeColor = cur.isFreeColorMode;
      const curSnapshotId = cur.activeSnapshotId;
      const curSettings = cur.settings;

      if (isReplayingRef.current) {
        if (isPostLoadReplayRef.current && curFilled.size < curPuzzle.regions.length) {
          exitReplay();
        } else {
          return;
        }
      }
      const wasPuzzleIncomplete = curFilled.size < curPuzzle.regions.length;

      if (curIsFreeColor) {
        let changed = false;
        const nextPainted = new Map(curPainted);
        const nextFilled = new Set(curFilled);
        const newUndoEntries: UndoHistoryEntry[] = [];
        const changedColors: Record<number, number> = {};

        for (const rId of regionIds) {
          const region =
            curPuzzle === puzzle
              ? regionByIdRef.current.get(rId)
              : curPuzzle.regions.find((r) => r.id === rId);
          if (!region) continue;
          const wasFilled = nextFilled.has(rId);
          const prevCol = nextPainted.get(rId);
          const effectivePrevCol =
            prevCol !== undefined ? prevCol : wasFilled ? region.colorId : undefined;
          if (effectivePrevCol !== curActiveColorId) {
            newUndoEntries.push({
              regionId: rId,
              wasPreviouslyFilled: wasFilled,
              previousPaintedColorId: effectivePrevCol,
              paintedColorId: curActiveColorId,
            });
            nextPainted.set(rId, curActiveColorId);
            changedColors[rId] = curActiveColorId;
            nextFilled.add(rId);
            changed = true;
          }
        }

        if (changed) {
          syncUndoStack((prev) => [...prev, ...newUndoEntries]);
          syncRedoStack([]);
          liveCoopRef.current = {
            ...cur,
            filledRegionIds: nextFilled,
            paintedRegionColors: nextPainted,
          };
          setPaintedRegionColors(nextPainted);
          setFilledRegionIds(nextFilled);
          setHintRegionId(null);
          markTutorialActionTried('paint');
          emitCoopPaint(
            'FILL',
            newUndoEntries.map((u) => u.regionId),
            changedColors
          );
          setLifetimeStats(
            PlayerStatsService.recordRegionsColored(
              newUndoEntries.length,
              isCoopSessionActive()
            )
          );
          SoundService.playRegionTap(curActiveColorId);
          completePaintStroke(
            curPuzzle,
            nextFilled,
            nextPainted,
            curActiveColorId,
            true,
            wasPuzzleIncomplete,
            curSnapshotId,
            curSettings
          );
        }
        return;
      }

      const isEasy = curSettings.difficulty === 'EASY';
      const isPaintMode = curSettings.isPaintMode;
      let filledAny = false;
      const nextFilled = new Set(curFilled);
      const newUndoEntries: UndoHistoryEntry[] = [];
      let nextActiveColorId = curActiveColorId;

      for (const rId of regionIds) {
        if (nextFilled.has(rId)) continue;
        const region =
          curPuzzle === puzzle
            ? regionByIdRef.current.get(rId)
            : curPuzzle.regions.find((r) => r.id === rId);
        if (!region) continue;

        const canFill = isEasy || region.colorId === curActiveColorId;
        if (canFill) {
          if (isEasy && !isPaintMode && nextActiveColorId !== region.colorId) {
            nextActiveColorId = region.colorId;
            setActiveColorId(region.colorId);
          }
          nextFilled.add(rId);
          newUndoEntries.push({
            regionId: rId,
            wasPreviouslyFilled: false,
            paintedColorId: region.colorId,
          });
          filledAny = true;
        }
      }

      if (filledAny) {
        syncUndoStack((prev) => [...prev, ...newUndoEntries]);
        syncRedoStack([]);
        liveCoopRef.current = {
          ...cur,
          filledRegionIds: nextFilled,
          activeColorId: nextActiveColorId,
        };
        setFilledRegionIds(nextFilled);
        setHintRegionId(null);
        markTutorialActionTried('paint');
        emitCoopPaint(
          'FILL',
          newUndoEntries.map((u) => u.regionId)
        );
        setLifetimeStats(
          PlayerStatsService.recordRegionsColored(newUndoEntries.length, isCoopSessionActive())
        );
        SoundService.playRegionTap(
          newUndoEntries[newUndoEntries.length - 1]?.paintedColorId ?? nextActiveColorId
        );
        completePaintStroke(
          curPuzzle,
          nextFilled,
          curPainted,
          nextActiveColorId,
          curIsFreeColor,
          wasPuzzleIncomplete,
          curSnapshotId,
          curSettings
        );
      }
    },
    [
      puzzle,
      completePaintStroke,
      emitCoopPaint,
      exitReplay,
      markTutorialActionTried,
      syncUndoStack,
      syncRedoStack,
      isCoopSessionActive,
      isPostLoadReplayRef,
      isReplayingRef,
      regionByIdRef,
    ]
  );

  // Custom Palette & Color Handlers for Free Colour Mode
  const handleAddCustomColor = useCallback(
    (hex: string) => {
      const cur = liveCoopRef.current;
      const curPuzzle = cur.puzzle;
      if (!curPuzzle) return;
      const curFilled = cur.filledRegionIds;
      const curPainted = cur.paintedRegionColors;
      const curSnapshotId = cur.activeSnapshotId;
      const curSettings = cur.settings;

      const clean = hex.replace('#', '');
      const num = parseInt(clean, 16);
      const rgb: [number, number, number] = [
        (num >> 16) & 255,
        (num >> 8) & 255,
        num & 255,
      ];
      const nextId = Math.max(...curPuzzle.palette.map((c) => c.id), 0) + 1;
      const isLight = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) > 160;
      const argb = ((0xff << 24) | (rgb[0] << 16) | (rgb[1] << 8) | rgb[2]) >>> 0;
      const newColor: PaletteColor = {
        id: nextId,
        hex: hex.startsWith('#') ? hex : `#${hex}`,
        isLight,
        argb,
        r: rgb[0],
        g: rgb[1],
        b: rgb[2],
      };
      const updatedPalette = [...curPuzzle.palette, newColor];
      const updatedPuzzle = { ...curPuzzle, palette: updatedPalette };
      liveCoopRef.current = {
        ...cur,
        puzzle: updatedPuzzle,
        activeColorId: nextId,
      };
      setPuzzle(updatedPuzzle);
      setActiveColorId(nextId);
      NativeBridge.haptic('tick', curSettings.hapticsEnabled);

      if (curSnapshotId) {
        void StorageService.savePuzzleData(curSnapshotId, updatedPuzzle).catch((err) => {
          reportSwallowed('App.savePuzzleData', err, { id: curSnapshotId });
        });
        const updated = StorageService.updateSnapshotProgress(
          curSnapshotId,
          curFilled.size,
          curPuzzle.regions.length,
          Array.from(curFilled),
          undefined,
          undefined,
          undefined,
          undefined,
          Object.fromEntries(curPainted),
          updatedPalette,
          curPuzzle.isFreeColor
        );
        setSnapshots(updated);
      }
    },
    []
  );

  const handleUpdateColor = useCallback(
    (colorId: number, hex: string) => {
      const cur = liveCoopRef.current;
      const curPuzzle = cur.puzzle;
      if (!curPuzzle) return;
      const curFilled = cur.filledRegionIds;
      const curPainted = cur.paintedRegionColors;
      const curSnapshotId = cur.activeSnapshotId;
      const curSettings = cur.settings;
      const curSourceImage = sourceImageRef.current;

      const clean = hex.replace('#', '');
      const num = parseInt(clean, 16);
      const rgb: [number, number, number] = [
        (num >> 16) & 255,
        (num >> 8) & 255,
        num & 255,
      ];
      const isLight = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) > 160;
      const argb = ((0xff << 24) | (rgb[0] << 16) | (rgb[1] << 8) | rgb[2]) >>> 0;
      const updatedPalette = curPuzzle.palette.map((c) =>
        c.id === colorId
          ? {
              ...c,
              hex: hex.startsWith('#') ? hex : `#${hex}`,
              isLight,
              argb,
              r: rgb[0],
              g: rgb[1],
              b: rgb[2],
            }
          : c
      );
      const updatedPuzzle = { ...curPuzzle, palette: updatedPalette };
      liveCoopRef.current = {
        ...cur,
        puzzle: updatedPuzzle,
      };
      setPuzzle(updatedPuzzle);
      NativeBridge.haptic('tick', curSettings.hapticsEnabled);

      if (curSnapshotId) {
        void StorageService.savePuzzleData(curSnapshotId, updatedPuzzle).catch((err) => {
          reportSwallowed('App.savePuzzleData', err, { id: curSnapshotId });
        });
        const previewUrl = curSourceImage
          ? generatePreviewDataUrl(updatedPuzzle, curSourceImage, curFilled, curPainted)
          : undefined;
        const updated = StorageService.updateSnapshotProgress(
          curSnapshotId,
          curFilled.size,
          curPuzzle.regions.length,
          Array.from(curFilled),
          undefined,
          undefined,
          undefined,
          previewUrl,
          Object.fromEntries(curPainted),
          updatedPalette,
          curPuzzle.isFreeColor
        );
        setSnapshots(updated);
      }
    },
    [generatePreviewDataUrl, sourceImageRef]
  );

  const handleApplyPresetPalette = useCallback(
    (preset: PalettePreset) => {
      const cur = liveCoopRef.current;
      const curPuzzle = cur.puzzle;
      if (!curPuzzle) return;
      const curFilled = cur.filledRegionIds;
      const curPainted = cur.paintedRegionColors;
      const curSnapshotId = cur.activeSnapshotId;
      const curSettings = cur.settings;
      const curSourceImage = sourceImageRef.current;

      const updatedPalette = curPuzzle.palette.map((c, i) => {
        const hex = preset.colors[i % preset.colors.length];
        const clean = hex.replace('#', '');
        const num = parseInt(clean, 16);
        const r = (num >> 16) & 255;
        const g = (num >> 8) & 255;
        const b = num & 255;
        const isLight = (0.299 * r + 0.587 * g + 0.114 * b) > 160;
        const argb = ((0xff << 24) | (r << 16) | (g << 8) | b) >>> 0;
        return {
          ...c,
          hex,
          isLight,
          argb,
          r,
          g,
          b,
        };
      });
      const updatedPuzzle = { ...curPuzzle, palette: updatedPalette };
      liveCoopRef.current = {
        ...cur,
        puzzle: updatedPuzzle,
      };
      setPuzzle(updatedPuzzle);
      NativeBridge.haptic('success', curSettings.hapticsEnabled);

      if (curSnapshotId) {
        void StorageService.savePuzzleData(curSnapshotId, updatedPuzzle).catch((err) => {
          reportSwallowed('App.savePuzzleData', err, { id: curSnapshotId });
        });
        const previewUrl = curSourceImage
          ? generatePreviewDataUrl(updatedPuzzle, curSourceImage, curFilled, curPainted)
          : undefined;
        const updated = StorageService.updateSnapshotProgress(
          curSnapshotId,
          curFilled.size,
          curPuzzle.regions.length,
          Array.from(curFilled),
          undefined,
          undefined,
          undefined,
          previewUrl,
          Object.fromEntries(curPainted),
          updatedPalette,
          curPuzzle.isFreeColor
        );
        setSnapshots(updated);
      }
    },
    [generatePreviewDataUrl, sourceImageRef]
  );

  // Trigger hint (highlight and center uncompleted region)
  const triggerHint = useCallback(
    (colorId?: number) => {
      const cur = liveCoopRef.current;
      const curPuzzle = cur.puzzle;
      if (!curPuzzle) return;
      const curFilled = cur.filledRegionIds;
      const curSettings = cur.settings;
      const targetColor = colorId ?? cur.activeColorId;
      if (colorId !== undefined && cur.activeColorId !== colorId) {
        liveCoopRef.current = { ...cur, activeColorId: colorId };
        setActiveColorId(colorId);
      }

      const unfilled = curPuzzle.regions.filter(
        (r) => r.colorId === targetColor && !curFilled.has(r.id)
      );
      if (unfilled.length === 0) return;

      NativeBridge.haptic('warning', curSettings.hapticsEnabled);

      // Prefer on-screen regions if available
      const visRegions = visibleRegionIdsRef.current;
      const onScreen = unfilled.find((r) => visRegions.has(r.id));
      const target = onScreen || unfilled[0];
      hintsUsedInSessionRef.current += 1;
      setHintRegionId(target.id);
      markTutorialActionTried('hint');
    },
    [markTutorialActionTried, visibleRegionIdsRef]
  );

  // File Upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onerror = () => {
      console.warn('Failed to read selected image file');
    };
    reader.onload = (event) => {
      const img = new Image();
      img.onerror = () => {
        console.warn('Failed to decode selected image file');
      };
      img.onload = () => {
        const title = file.name.replace(/\.[^/.]+$/, '');
        markTutorialActionTried('create_gallery');
        triggerFeatureOffer('photo_upload');
        loadArtworkFromImage(
          img,
          title,
          settings.generatorConfig,
          new Set(),
          undefined,
          undefined,
          undefined,
          false,
          file
        );
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // Load a saved snapshot (and optionally auto-replay its region completion sequence)
  const handleLoadSnapshot = async (snapshot: SavedSnapshot, forceReplay: boolean = false) => {
    handleUpdateSettings((prev) => (prev.replayLoop ? { ...prev, replayLoop: false } : prev));
    if (snapshot.id === activeSnapshotId && puzzle && !snapshotTransitioningRef.current) {
      const currentOrdered =
        filledRegionIds.size > 0
          ? Array.from(filledRegionIds)
          : snapshot.filledRegionIds || [];
      if ((forceReplay || settings.autoReplayOnLoad !== false) && currentOrdered.length > 0) {
        startReplay(currentOrdered, true);
      }
      return;
    }

    clearPendingViewportSave();
    if (activeSnapshotId && puzzle && !snapshotTransitioningRef.current) {
      const updated = StorageService.updateSnapshotViewport(
        activeSnapshotId,
        viewportRef.current.zoomScale,
        viewportRef.current.panOffsetX,
        viewportRef.current.panOffsetY
      );
      setSnapshots(updated);
    }

    const loadSeq = ++snapshotTransitionSeqRef.current;
    snapshotTransitioningRef.current = true;
    liveCoopRef.current = {
      ...liveCoopRef.current,
      activeSnapshotId: null,
      puzzle: null,
    };

    resetReplayState();
    setIsLoading(true);
    setLoadingProgress(0.15);
    setLoadingStatus(`Loading ${snapshot.title}...`);
    setLoadingPayload(null);

    setActiveSnapshotId(snapshot.id);
    setPuzzle(null);

    let resolvedObjectUrl: string | null = null;
    let handedOffToImg = false;

    const commitLoadedImageBlobUrl = (loadedImgSrc: string) => {
      const usedUrl =
        resolvedObjectUrl && loadedImgSrc === resolvedObjectUrl ? resolvedObjectUrl : null;
      if (resolvedObjectUrl && !usedUrl) {
        URL.revokeObjectURL(resolvedObjectUrl);
      }
      resolvedObjectUrl = null;
      const prevUrl = activeBlobUrlRef.current;
      activeBlobUrlRef.current = usedUrl;
      if (prevUrl && prevUrl !== usedUrl) {
        URL.revokeObjectURL(prevUrl);
      }
    };

    try {
      const resolved = await resolveSnapshotImageSrc(snapshot);
      resolvedObjectUrl = resolved.objectUrl;
      if (loadSeq !== snapshotTransitionSeqRef.current) {
        if (resolvedObjectUrl) {
          URL.revokeObjectURL(resolvedObjectUrl);
          resolvedObjectUrl = null;
        }
        return;
      }

      // Try IndexedDB first
      const cachedPuzzle = await StorageService.loadPuzzleData(snapshot.id);
      if (loadSeq !== snapshotTransitionSeqRef.current) {
        if (resolvedObjectUrl) {
          URL.revokeObjectURL(resolvedObjectUrl);
          resolvedObjectUrl = null;
        }
        return;
      }
      if (cachedPuzzle) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          if (loadSeq !== snapshotTransitionSeqRef.current) {
            if (resolvedObjectUrl) {
              URL.revokeObjectURL(resolvedObjectUrl);
              resolvedObjectUrl = null;
            }
            return;
          }
          try {
            commitLoadedImageBlobUrl(img.src);
            const orderedIds = snapshot.filledRegionIds || [];
            const filledSet = new Set(orderedIds);
            if (snapshot.customPalette && snapshot.customPalette.length > 0) {
              cachedPuzzle.palette = mergeCustomPalette(cachedPuzzle.palette, snapshot.customPalette);
            }
            const nextPaintedMap = snapshot.paintedRegionColors
              ? new Map(Object.entries(snapshot.paintedRegionColors).map(([k, v]) => [Number(k), v]))
              : new Map<number, number>();
            const paintedObj = snapshot.paintedRegionColors || {};
            setPaintedRegionColors(nextPaintedMap);
            const isFree = Boolean(snapshot.isFreeColor || cachedPuzzle.isFreeColor);
            handleUpdateSettings((prev) => ({
              ...prev,
              isFreeColorMode: isFree,
              ...(prev.replayLoop ? { replayLoop: false } : {}),
            }));
            const availableColors = getVisiblePalette(
              cachedPuzzle.palette,
              cachedPuzzle.regions,
              filledSet,
              settings.paletteSort
            );
            const restoredColor = availableColors[0]?.id || cachedPuzzle.palette[0]?.id || 1;
            const restoredView = {
              zoomScale: snapshot.zoomScale ?? 1.0,
              panOffsetX: snapshot.panOffsetX ?? 0,
              panOffsetY: snapshot.panOffsetY ?? 0,
            };
            viewportRef.current = restoredView;
            setInitialViewport(restoredView);
            setRestoreViewTrigger((prev) => prev + 1);
            liveCoopRef.current = {
              ...liveCoopRef.current,
              puzzle: cachedPuzzle,
              activeSnapshotId: snapshot.id,
              activeSave: snapshot,
              activeTitle: snapshot.title || 'Capy',
              activeColorId: restoredColor,
              filledRegionIds: filledSet,
              paintedRegionColors: nextPaintedMap,
              isFreeColorMode: isFree,
            };
            setSourceImage(img);
            setPuzzle(cachedPuzzle);
            setActiveColorId(restoredColor);
            setFilledRegionIds(filledSet);
            syncUndoStack(
              orderedIds.map((rId) => ({
                regionId: rId,
                wasPreviouslyFilled: false,
              }))
            );
            syncRedoStack([]);
            resetActivePuzzleSessionStats(
              snapshot.id,
              cachedPuzzle.regions.length > 0 && filledSet.size >= cachedPuzzle.regions.length
            );
            StorageService.saveActiveState({
              activeSnapshotId: snapshot.id,
              activeColorId: restoredColor,
              filledRegionIds: orderedIds,
              paintedRegionColors: paintedObj,
              isFreeColorMode: isFree,
              ...(snapshot.resetEpoch && snapshot.resetEpoch > 0
                ? { resetEpoch: snapshot.resetEpoch }
                : {}),
              zoomScale: restoredView.zoomScale,
              panOffsetX: restoredView.panOffsetX,
              panOffsetY: restoredView.panOffsetY,
            });
            clearPendingViewportSave();
            snapshotTransitioningRef.current = false;
            setIsLoading(false);

            if ((forceReplay || settings.autoReplayOnLoad !== false) && orderedIds.length > 0) {
              startReplay(orderedIds, true);
            }
          } catch (err) {
            console.error('Failed to apply loaded snapshot:', err);
            if (loadSeq === snapshotTransitionSeqRef.current) {
              setPuzzle(null);
              setActiveSnapshotId(null);
              clearPendingViewportSave();
              snapshotTransitioningRef.current = false;
              liveCoopRef.current = {
                ...latestRenderCoopRef.current,
                activeSnapshotId: null,
                puzzle: null,
              };
              setIsLoading(false);
            }
          }
        };
        img.onerror = () => {
          if (loadSeq !== snapshotTransitionSeqRef.current) {
            if (resolvedObjectUrl) {
              URL.revokeObjectURL(resolvedObjectUrl);
              resolvedObjectUrl = null;
            }
            return;
          }
          if (resolvedObjectUrl && img.src === resolvedObjectUrl) {
            URL.revokeObjectURL(resolvedObjectUrl);
            resolvedObjectUrl = null;
          }
          if (
            isSafeSnapshotPreviewDataUrl(snapshot.previewDataUrl) &&
            img.src !== snapshot.previewDataUrl.trim()
          ) {
            img.src = snapshot.previewDataUrl.trim();
          } else {
            setPuzzle(null);
            setActiveSnapshotId(null);
            clearPendingViewportSave();
            snapshotTransitioningRef.current = false;
            liveCoopRef.current = {
              ...latestRenderCoopRef.current,
              activeSnapshotId: null,
              puzzle: null,
            };
            setIsLoading(false);
          }
        };
        handedOffToImg = true;
        img.src = resolved.src;
        return;
      }

      // Fallback: regenerate from image while preserving customPalette, paintedRegionColors, isFreeColor, and viewport
      const safeSnapshotSamplePath = isAllowedSampleAssetPath(snapshot.sampleAssetPath)
        ? snapshot.sampleAssetPath
        : undefined;
      const storedBlob = safeSnapshotSamplePath
        ? null
        : await StorageService.loadImageBlob(
            snapshot.sourceRef?.kind === 'blob' ? snapshot.sourceRef.uri : snapshot.id
          );
      if (loadSeq !== snapshotTransitionSeqRef.current) {
        if (resolvedObjectUrl) {
          URL.revokeObjectURL(resolvedObjectUrl);
          resolvedObjectUrl = null;
        }
        return;
      }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (loadSeq !== snapshotTransitionSeqRef.current) {
          if (resolvedObjectUrl) {
            URL.revokeObjectURL(resolvedObjectUrl);
            resolvedObjectUrl = null;
          }
          return;
        }
        commitLoadedImageBlobUrl(img.src);
        loadArtworkFromImage(
          img,
          snapshot.title,
          settings.generatorConfig,
          new Set(snapshot.filledRegionIds || []),
          undefined,
          snapshot.id,
          safeSnapshotSamplePath,
          forceReplay || settings.autoReplayOnLoad !== false,
          storedBlob,
          snapshot.paintedRegionColors,
          {
            zoomScale: snapshot.zoomScale ?? 1.0,
            panOffsetX: snapshot.panOffsetX ?? 0,
            panOffsetY: snapshot.panOffsetY ?? 0,
          },
          snapshot.customPalette,
          snapshot.isFreeColor,
          snapshot.parentSnapshotId
        );
      };
      img.onerror = () => {
        if (loadSeq !== snapshotTransitionSeqRef.current) {
          if (resolvedObjectUrl) {
            URL.revokeObjectURL(resolvedObjectUrl);
            resolvedObjectUrl = null;
          }
          return;
        }
        if (resolvedObjectUrl && img.src === resolvedObjectUrl) {
          URL.revokeObjectURL(resolvedObjectUrl);
          resolvedObjectUrl = null;
        }
        if (
          isSafeSnapshotPreviewDataUrl(snapshot.previewDataUrl) &&
          img.src !== snapshot.previewDataUrl.trim()
        ) {
          img.src = snapshot.previewDataUrl.trim();
        } else {
          setPuzzle(null);
          setActiveSnapshotId(null);
          clearPendingViewportSave();
          snapshotTransitioningRef.current = false;
          liveCoopRef.current = {
            ...latestRenderCoopRef.current,
            activeSnapshotId: null,
            puzzle: null,
          };
          setIsLoading(false);
        }
      };
      handedOffToImg = true;
      img.src = resolved.src;
    } catch (err) {
      console.error('Failed to load snapshot:', err);
      if (resolvedObjectUrl) {
        URL.revokeObjectURL(resolvedObjectUrl);
        resolvedObjectUrl = null;
      }
      if (loadSeq === snapshotTransitionSeqRef.current) {
        setPuzzle(null);
        setActiveSnapshotId(null);
        setIsLoading(false);
        liveCoopRef.current = {
          ...latestRenderCoopRef.current,
          activeSnapshotId: null,
          puzzle: null,
        };
      }
    } finally {
      if (!handedOffToImg && loadSeq === snapshotTransitionSeqRef.current) {
        if (resolvedObjectUrl) {
          URL.revokeObjectURL(resolvedObjectUrl);
          resolvedObjectUrl = null;
        }
        clearPendingViewportSave();
        snapshotTransitioningRef.current = false;
      }
    }
  };

  // Active Save Progress
  const totalCount = puzzle?.regions.length || 0;
  const filledCount = filledRegionIds.size;
  const progressPercentage = computeProgressPercentage(filledCount, totalCount);
  const isCompleted = totalCount > 0 && filledCount >= totalCount;

  // Export full-resolution colored artwork as PNG (supports Web download and Android native Share Sheet)
  const handleExportArtwork = useCallback(() => {
    if (!puzzle || !sourceImage) return;
    const canvas = document.createElement('canvas');
    canvas.width = puzzle.width;
    canvas.height = puzzle.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const paletteMap = new Map<number, PaletteColor>(
      puzzle.palette.map((c) => [c.id, c])
    );

    if (puzzle.isFreeColor || paintedRegionColors.size > 0) {
      const imgData = ctx.createImageData(puzzle.width, puzzle.height);
      const data = imgData.data;
      data.fill(255);

      for (const region of puzzle.regions) {
        if (filledRegionIds.has(region.id)) {
          const colId = paintedRegionColors.get(region.id) ?? region.colorId;
          const col = paletteMap.get(colId);
          const r = col?.r ?? 71;
          const g = col?.g ?? 85;
          const b = col?.b ?? 105;
          for (let i = 0; i < region.pixels.length; i++) {
            const idx = region.pixels[i] * 4;
            data[idx] = r;
            data[idx + 1] = g;
            data[idx + 2] = b;
            data[idx + 3] = 255;
          }
        }
      }
      ctx.putImageData(imgData, 0, 0);
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(sourceImage, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
    } else {
      ctx.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);

      if (filledRegionIds.size < puzzle.regions.length) {
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = puzzle.width;
        maskCanvas.height = puzzle.height;
        const mCtx = maskCanvas.getContext('2d');
        if (mCtx) {
          const imgData = mCtx.createImageData(puzzle.width, puzzle.height);
          const data = imgData.data;
          for (let i = 0; i < puzzle.width * puzzle.height; i++) {
            const rId = puzzle.regionMap[i];
            if (!filledRegionIds.has(rId)) {
              const idx = i * 4;
              data[idx] = 248;
              data[idx + 1] = 250;
              data[idx + 2] = 252;
              data[idx + 3] = 230;
            }
          }
          mCtx.putImageData(imgData, 0, 0);
          ctx.drawImage(maskCanvas, 0, 0, canvas.width, canvas.height);
        }
      }
    }

    const titleStr = activeTitle || 'capy-artwork';
    const fileName = `${titleStr.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
    canvas.toBlob((blob) => {
      if (!blob) return;
      void NativeBridge.exportOrShareFile({
        title: titleStr,
        fileName,
        mimeType: 'image/png',
        data: blob,
      });
      NativeBridge.haptic('tick', settings.hapticsEnabled);
    }, 'image/png');
  }, [puzzle, sourceImage, filledRegionIds, paintedRegionColors, activeTitle, settings.hapticsEnabled]);

  // Export active puzzle as a printable monochrome vector SVG coloring sheet
  const handleExportPrintableSvg = useCallback(async (): Promise<boolean> => {
    if (!puzzle) return false;
    const ok = await exportPrintableColoringSvg(puzzle, {
      title: activeTitle || 'Capy Coloring Sheet',
      palette: puzzle.palette,
    });
    if (ok) {
      NativeBridge.haptic('tick', settings.hapticsEnabled);
      markTutorialActionTried('saves_export');
    }
    return ok;
  }, [puzzle, activeTitle, settings.hapticsEnabled, markTutorialActionTried]);

  // Export any saved snapshot's puzzle as a printable monochrome vector SVG coloring sheet
  const handleExportSnapshotSvg = useCallback(
    async (id: string, title: string): Promise<boolean> => {
      if (id === activeSnapshotId && puzzle) {
        const ok = await exportPrintableColoringSvg(puzzle, {
          title: title || activeTitle || 'Capy Coloring Sheet',
          palette: puzzle.palette,
        });
        if (ok) {
          NativeBridge.haptic('tick', settings.hapticsEnabled);
          markTutorialActionTried('saves_export');
        }
        return ok;
      }

      try {
        const cachedPuzzle = await StorageService.loadPuzzleData(id);
        if (!cachedPuzzle) return false;
        const snap = snapshots.find((s) => s.id === id);
        const palette =
          snap?.customPalette && snap.customPalette.length > 0
            ? mergeCustomPalette(cachedPuzzle.palette, snap.customPalette)
            : cachedPuzzle.palette;
        const ok = await exportPrintableColoringSvg(cachedPuzzle, {
          title: title || snap?.title || 'Capy Coloring Sheet',
          palette,
        });
        if (ok) {
          NativeBridge.haptic('tick', settings.hapticsEnabled);
          markTutorialActionTried('saves_export');
        }
        return ok;
      } catch (e) {
        console.error('Failed to export snapshot printable SVG', e);
        return false;
      }
    },
    [activeSnapshotId, puzzle, activeTitle, snapshots, settings.hapticsEnabled, markTutorialActionTried]
  );

  // Export single snapshot to compact .capy v2 binary file
  const handleExportSnapshot = useCallback(
    async (id: string, title: string) => {
      try {
        const bytes = await StorageService.exportSnapshotBinary(id);
        const cleanTitle = (title || 'puzzle').replace(/[^a-zA-Z0-9_-]/g, '_');
        await NativeBridge.exportOrShareFile({
          title: title || 'Capy Save',
          fileName: `${cleanTitle}.capy`,
          mimeType: 'application/octet-stream',
          data: bytes,
        });
        NativeBridge.haptic('tick', settings.hapticsEnabled);
        markTutorialActionTried('saves_export');
      } catch (e) {
        console.error('Failed to export snapshot', e);
      }
    },
    [settings.hapticsEnabled, markTutorialActionTried]
  );

  // Export all saved puzzles to compact .capy v2 backup archive
  const handleExportAllSnapshots = useCallback(async () => {
    try {
      const bytes = await StorageService.exportAllSnapshotsBinary();
      await NativeBridge.exportOrShareFile({
        title: 'Capy Saves Backup',
        fileName: 'capy_saves_backup.capy',
        mimeType: 'application/octet-stream',
        data: bytes,
      });
      NativeBridge.haptic('tick', settings.hapticsEnabled);
      markTutorialActionTried('saves_export');
    } catch (e) {
      console.error('Failed to export all snapshots', e);
    }
  }, [settings.hapticsEnabled, markTutorialActionTried]);

  // Import saves from .capy (v2 binary or v1 JSON) or .json file
  const handleImportSnapshots = useCallback(
    async (
      file: File
    ): Promise<{ ok: boolean; importedCount: number; message: string }> => {
      try {
        const buffer = await file.arrayBuffer();
        const result = await StorageService.importSnapshotData(buffer);
        if (result.importedCount > 0) {
          const refreshed = await StorageService.hydrateSnapshotPreviews(StorageService.loadSnapshots());
          setSnapshots(refreshed);
          NativeBridge.haptic('success', settings.hapticsEnabled);
          markTutorialActionTried('saves_export');
          return {
            ok: true,
            importedCount: result.importedCount,
            message: `Imported ${result.importedCount} ${result.importedCount === 1 ? 'save' : 'saves'} cleanly.`,
          };
        }
        const errorMsg = result.error || 'No valid saves found in file.';
        NativeBridge.haptic('error', settings.hapticsEnabled);
        return { ok: false, importedCount: 0, message: `Failed to import saves: ${errorMsg}` };
      } catch (e) {
        console.error('Failed to import file', e);
        NativeBridge.haptic('error', settings.hapticsEnabled);
        return {
          ok: false,
          importedCount: 0,
          message: `Failed to import saves: ${e instanceof Error ? e.message : 'Invalid file'}`,
        };
      }
    },
    [settings.hapticsEnabled]
  );

  // Snapshot sync helper uses liveCoopRef declared near top of App

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
    []
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
  }, [clearPendingViewportSave, persistActiveViewportOnly]);
  useIsomorphicLayoutEffect(() => {
    flushPendingViewportSaveRef.current = flushPendingViewportSave;
  }, [flushPendingViewportSave]);

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

  const loadSampleFromPrebakedOrGenerate = useCallback(
    async (
      sample: SampleArtwork,
      deltaFilledIds?: number[],
      deltaPaintedColors?: Record<number, number>,
      deltaIsFreeColor?: boolean,
      forceGeneratorConfig?: GeneratorConfig,
      deltaResetEpoch?: number,
      prebakedSnapshotId?: string
    ) => {
      const sampleSeq = ++snapshotTransitionSeqRef.current;
      clearPendingViewportSave();
      snapshotTransitioningRef.current = true;
      liveCoopRef.current = {
        ...liveCoopRef.current,
        activeSnapshotId: null,
        puzzle: null,
      };
      const skipBootstrap =
        typeof window !== 'undefined' &&
        new URLSearchParams(window.location.search).get('skipSampleBootstrap') === '1';
      const cleanSamplePath = sample.assetPath.replace(/^\.\//, '');
      const usePrebaked =
        !skipBootstrap &&
        (Boolean(prebakedSnapshotId) ||
          !forceGeneratorConfig ||
          isDefaultGeneratorConfig(forceGeneratorConfig) ||
          isMaxGeneratorConfig(forceGeneratorConfig));

      let handedOffToAsync = false;
      try {
        if (usePrebaked) {
          let snaps = StorageService.loadSnapshots();
          let prebakedSnap = prebakedSnapshotId
            ? snaps.find((s) => s.id === prebakedSnapshotId)
            : snaps.find(
                (s) => s.isAutoSample && s.sampleAssetPath?.replace(/^\.\//, '') === cleanSamplePath
              );
          if (!prebakedSnap) {
            try {
              const archiveUrl = prebakedSnapshotId
                ? './assets/daily_saves.capy'
                : './assets/sample_saves.capy';
              const bundleResp = await fetch(archiveUrl).catch(() => null);
              if (sampleSeq !== snapshotTransitionSeqRef.current) return;
              if (bundleResp && bundleResp.ok) {
                await StorageService.importSnapshotData(await bundleResp.arrayBuffer(), {
                  refreshTimestamps: true,
                  ...(prebakedSnapshotId ? { filterSnapshotId: prebakedSnapshotId } : {}),
                });
                if (sampleSeq !== snapshotTransitionSeqRef.current) return;
                snaps = StorageService.loadSnapshots();
                prebakedSnap = prebakedSnapshotId
                  ? snaps.find((s) => s.id === prebakedSnapshotId)
                  : snaps.find(
                      (s) =>
                        s.isAutoSample && s.sampleAssetPath?.replace(/^\.\//, '') === cleanSamplePath
                    );
              }
            } catch {
              // Fall back to worker generation if archive unavailable
            }
          }

          if (prebakedSnap) {
            const cachedPuzzle = await StorageService.loadPuzzleData(prebakedSnap.id);
            if (sampleSeq !== snapshotTransitionSeqRef.current) return;
            if (cachedPuzzle) {
              const img = await new Promise<HTMLImageElement | null>((resolve) => {
                const el = new Image();
                el.crossOrigin = 'anonymous';
                el.onload = () => resolve(el);
                el.onerror = () => resolve(null);
                el.src = sample.assetPath;
              });
              if (sampleSeq !== snapshotTransitionSeqRef.current) return;
              if (img) {
                const validIds = new Set(cachedPuzzle.regions.map((r) => r.id));
                const mergedSampleDelta =
                  deltaFilledIds !== undefined
                    ? mergeProgressDeltas(
                        {
                          version: 2,
                          filledRegionIds: prebakedSnap.filledRegionIds || [],
                          paintedRegionColors: prebakedSnap.paintedRegionColors,
                          isFreeColor: prebakedSnap.isFreeColor,
                          ...(prebakedSnap.resetEpoch && prebakedSnap.resetEpoch > 0
                            ? { resetEpoch: prebakedSnap.resetEpoch }
                            : {}),
                          updatedAt: prebakedSnap.lastOpened || prebakedSnap.timestamp || 0,
                        },
                        {
                          version: 2,
                          filledRegionIds: deltaFilledIds,
                          paintedRegionColors: deltaPaintedColors,
                          isFreeColor: deltaIsFreeColor,
                          ...(deltaResetEpoch && deltaResetEpoch > 0
                            ? { resetEpoch: deltaResetEpoch }
                            : {}),
                          updatedAt: Date.now(),
                        }
                      )
                    : null;
                const rawOrdered = mergedSampleDelta
                  ? mergedSampleDelta.filledRegionIds
                  : prebakedSnap.filledRegionIds || [];
                const orderedIds = rawOrdered.filter((id) => validIds.has(id));
                const filledSet = new Set(orderedIds);
                const rawPainted = mergedSampleDelta
                  ? mergedSampleDelta.paintedRegionColors || {}
                  : prebakedSnap.paintedRegionColors || {};
                const mergedEpoch = mergedSampleDelta
                  ? mergedSampleDelta.resetEpoch ?? 0
                  : prebakedSnap.resetEpoch ?? 0;
                const restoredPaintedMap = new Map(
                  Object.entries(rawPainted)
                    .map(([k, v]) => [Number(k), v] as [number, number])
                    .filter(([k]) => validIds.has(k))
                );
                if (prebakedSnap.customPalette && prebakedSnap.customPalette.length > 0) {
                  cachedPuzzle.palette = prebakedSnap.customPalette;
                }
                const isFree = Boolean(
                  deltaIsFreeColor ||
                    sample.isFreeColor ||
                    prebakedSnap.isFreeColor ||
                    cachedPuzzle.isFreeColor ||
                    restoredPaintedMap.size > 0
                );
                const availableColors = getVisiblePalette(
                  cachedPuzzle.palette,
                  cachedPuzzle.regions,
                  filledSet,
                  liveCoopRef.current.settings.paletteSort
                );
                const initialColor = availableColors[0]?.id || cachedPuzzle.palette[0]?.id || 1;
                const previewUrl =
                  deltaFilledIds !== undefined
                    ? generatePreviewDataUrl(cachedPuzzle, img, filledSet, restoredPaintedMap)
                    : prebakedSnap.previewDataUrl;
                const updatedList = StorageService.updateSnapshotProgress(
                  prebakedSnap.id,
                  filledSet.size,
                  cachedPuzzle.regions.length,
                  orderedIds,
                  1.0,
                  0,
                  0,
                  previewUrl,
                  Object.fromEntries(restoredPaintedMap),
                  cachedPuzzle.palette,
                  isFree,
                  undefined,
                  mergedEpoch > 0 ? mergedEpoch : undefined
                );
                clearPendingViewportSave();
                ++generationSeqRef.current;
                const targetView = { zoomScale: 1.0, panOffsetX: 0, panOffsetY: 0 };
                viewportRef.current = targetView;
                setInitialViewport(targetView);
                setRestoreViewTrigger((prev) => prev + 1);
                resetReplayState();
                setShowSettings(false);
                const syncedSnap = updatedList.find((s) => s.id === prebakedSnap.id);
                liveCoopRef.current = {
                  ...liveCoopRef.current,
                  puzzle: cachedPuzzle,
                  activeSnapshotId: prebakedSnap.id,
                  activeSave: syncedSnap,
                  activeTitle: syncedSnap?.title || 'Capy',
                  activeColorId: initialColor,
                  filledRegionIds: filledSet,
                  paintedRegionColors: restoredPaintedMap,
                  isFreeColorMode: isFree,
                };
                setSnapshots(updatedList);
                setPaintedRegionColors(restoredPaintedMap);
                handleUpdateSettings((prev) => ({ ...prev, isFreeColorMode: isFree }));
                setSourceImage(img);
                setPuzzle(cachedPuzzle);
                setActiveSnapshotId(prebakedSnap.id);
                setActiveColorId(initialColor);
                setFilledRegionIds(filledSet);
                syncUndoStack(
                  orderedIds.map((rId) => ({
                    regionId: rId,
                    wasPreviouslyFilled: false,
                  }))
                );
                syncRedoStack([]);
                setHintRegionId(null);
                resetActivePuzzleSessionStats(
                  prebakedSnap.id,
                  cachedPuzzle.regions.length > 0 && filledSet.size >= cachedPuzzle.regions.length
                );
                if (isFree && deltaFilledIds === undefined) {
                  setLifetimeStats(PlayerStatsService.recordFreeColorCreation());
                }
                StorageService.saveActiveState({
                  activeSnapshotId: prebakedSnap.id,
                  activeColorId: initialColor,
                  filledRegionIds: orderedIds,
                  paintedRegionColors: Object.fromEntries(restoredPaintedMap),
                  isFreeColorMode: isFree,
                  ...(mergedEpoch > 0 ? { resetEpoch: mergedEpoch } : {}),
                  zoomScale: 1.0,
                  panOffsetX: 0,
                  panOffsetY: 0,
                });
                clearPendingViewportSave();
                snapshotTransitioningRef.current = false;
                setIsLoading(false);
                handedOffToAsync = true;
                return;
              }
            }
          }
        }

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          if (sampleSeq !== snapshotTransitionSeqRef.current) return;
          loadArtworkFromImage(
            img,
            sample.title,
            {
              ...(forceGeneratorConfig || DEFAULT_SETTINGS.generatorConfig),
              isFreeColor: Boolean(
                forceGeneratorConfig?.isFreeColor || deltaIsFreeColor || sample.isFreeColor
              ),
            },
            new Set(deltaFilledIds || []),
            undefined,
            undefined,
            sample.assetPath,
            false,
            null,
            deltaPaintedColors
          );
        };
        img.onerror = () => {
          if (sampleSeq !== snapshotTransitionSeqRef.current) return;
          clearPendingViewportSave();
          snapshotTransitioningRef.current = false;
          liveCoopRef.current = latestRenderCoopRef.current;
          setIsLoading(false);
        };
        handedOffToAsync = true;
        img.src = sample.assetPath;
      } catch (err) {
        console.error('Failed to load sample puzzle:', err);
        if (sampleSeq === snapshotTransitionSeqRef.current) {
          setIsLoading(false);
        }
      } finally {
        if (!handedOffToAsync && sampleSeq === snapshotTransitionSeqRef.current) {
          clearPendingViewportSave();
          snapshotTransitioningRef.current = false;
          liveCoopRef.current = latestRenderCoopRef.current;
          setIsLoading(false);
        }
      }
    },
    [
      clearPendingViewportSave,
      generatePreviewDataUrl,
      handleUpdateSettings,
      loadArtworkFromImage,
      resetActivePuzzleSessionStats,
      resetReplayState,
      syncUndoStack,
      syncRedoStack,
      latestRenderCoopRef,
    ]
  );

  useIsomorphicLayoutEffect(() => {
    loadSampleForCoopRef.current = loadSampleFromPrebakedOrGenerate;
  }, [loadSampleFromPrebakedOrGenerate]);

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

  // Multi-resolution Infinite Zoom: extract 2x high-detail center sub-tile with seam-preserving palette continuity
  const handleZoomIntoDetailTile = useCallback(() => {
    if (!sourceImage) return;
    const srcW = sourceImage.naturalWidth || sourceImage.width;
    const srcH = sourceImage.naturalHeight || sourceImage.height;
    if (srcW <= 0 || srcH <= 0) return;

    // Persist parent puzzle's snapshot ID and current viewport zoom/pan before switching to the child sub-tile
    clearPendingViewportSave();
    const detailSeq = ++snapshotTransitionSeqRef.current;
    snapshotTransitioningRef.current = true;
    const parentId = activeSnapshotId || crypto.randomUUID();
    const currentView = { ...viewportRef.current };
    liveCoopRef.current = {
      ...liveCoopRef.current,
      activeSnapshotId: null,
      puzzle: null,
    };
    try {
      const existingList = StorageService.loadSnapshots();
      const existingParent = existingList.find((s) => s.id === parentId);
      const paintedObj = Object.fromEntries(paintedRegionColors);
      const orderedIds = Array.from(filledRegionIds);

      if (existingParent && puzzle) {
        const updatedParentList = StorageService.updateSnapshotProgress(
          parentId,
          filledRegionIds.size,
          puzzle.regions.length,
          orderedIds,
          currentView.zoomScale,
          currentView.panOffsetX,
          currentView.panOffsetY,
          undefined,
          paintedObj,
          puzzle.palette,
          puzzle.isFreeColor
        );
        setSnapshots(updatedParentList);
        void StorageService.savePuzzleData(parentId, puzzle).catch((err) => {
          reportSwallowed('App.savePuzzleData', err, { id: parentId });
        });
      } else if (existingParent) {
        const updatedParentList = StorageService.updateSnapshotViewport(
          parentId,
          currentView.zoomScale,
          currentView.panOffsetX,
          currentView.panOffsetY
        );
        setSnapshots(updatedParentList);
      } else {
        const now = Date.now();
        const parentSnapshot: SavedSnapshot = {
          id: parentId,
          title: activeTitle || 'Artwork',
          timestamp: now,
          lastOpened: now,
          filledCount: filledRegionIds.size,
          totalCount: puzzle?.regions.length || 100,
          filledRegionIds: orderedIds,
          ...(paintedRegionColors.size > 0 ? { paintedRegionColors: paintedObj } : {}),
          ...(puzzle?.palette ? { customPalette: puzzle.palette } : {}),
          ...(puzzle?.isFreeColor !== undefined ? { isFreeColor: puzzle.isFreeColor } : {}),
          zoomScale: currentView.zoomScale,
          panOffsetX: currentView.panOffsetX,
          panOffsetY: currentView.panOffsetY,
          sampleAssetPath: activeSave?.sampleAssetPath ?? null,
          sourceRef: activeSave?.sourceRef ?? { kind: 'blob', uri: parentId },
        };
        setSnapshots(StorageService.addSnapshot(parentSnapshot));
        if (puzzle) {
          void StorageService.savePuzzleData(parentId, puzzle).catch((err) => {
            reportSwallowed('App.savePuzzleData', err, { id: parentId });
          });
        }
      }

      const cropW = Math.max(128, Math.round(srcW * 0.5));
      const cropH = Math.max(128, Math.round(srcH * 0.5));
      const cropX = Math.max(0, Math.min(srcW - cropW, Math.round((srcW - cropW) / 2)));
      const cropY = Math.max(0, Math.min(srcH - cropH, Math.round((srcH - cropH) / 2)));

      const tileCanvas = document.createElement('canvas');
      tileCanvas.width = srcW;
      tileCanvas.height = srcH;
      const tCtx = tileCanvas.getContext('2d');
      if (!tCtx) {
        if (detailSeq === snapshotTransitionSeqRef.current) {
          clearPendingViewportSave();
          snapshotTransitioningRef.current = false;
          liveCoopRef.current = latestRenderCoopRef.current;
        }
        return;
      }
      tCtx.imageSmoothingEnabled = true;
      tCtx.imageSmoothingQuality = 'high';
      tCtx.drawImage(sourceImage, cropX, cropY, cropW, cropH, 0, 0, srcW, srcH);

      tileCanvas.toBlob((blob) => {
        if (detailSeq !== snapshotTransitionSeqRef.current) return;
        if (!blob) {
          clearPendingViewportSave();
          snapshotTransitioningRef.current = false;
          liveCoopRef.current = latestRenderCoopRef.current;
          return;
        }
        const url = URL.createObjectURL(blob);
        const detailImg = new Image();
        detailImg.onload = () => {
          URL.revokeObjectURL(url);
          if (detailSeq !== snapshotTransitionSeqRef.current) return;
          const subTitle = activeTitle.includes('(2x Detail)')
            ? activeTitle
            : `${activeTitle} (2x Detail)`;
          markTutorialActionTried('create_gallery');
          triggerFeatureOffer('infinite_zoom');
          loadArtworkFromImage(
            detailImg,
            subTitle,
            {
              ...settings.generatorConfig,
              maxRegions: Math.min(900, Math.round((settings.generatorConfig.maxRegions || 350) * 1.25)),
            },
            new Set(),
            undefined,
            undefined,
            null,
            false,
            blob,
            undefined,
            undefined,
            undefined,
            undefined,
            parentId
          );
        };
        detailImg.onerror = () => {
          URL.revokeObjectURL(url);
          if (detailSeq === snapshotTransitionSeqRef.current) {
            clearPendingViewportSave();
            snapshotTransitioningRef.current = false;
            liveCoopRef.current = latestRenderCoopRef.current;
          }
        };
        detailImg.src = url;
      }, 'image/webp', 0.94);
    } catch (err) {
      console.error('Failed to extract 2x detail tile:', err);
      if (detailSeq === snapshotTransitionSeqRef.current) {
        clearPendingViewportSave();
        snapshotTransitioningRef.current = false;
        liveCoopRef.current = latestRenderCoopRef.current;
      }
    }
  }, [
    sourceImage,
    activeSnapshotId,
    activeSave,
    puzzle,
    filledRegionIds,
    paintedRegionColors,
    activeTitle,
    settings.generatorConfig,
    clearPendingViewportSave,
    loadArtworkFromImage,
    markTutorialActionTried,
    triggerFeatureOffer,
    latestRenderCoopRef,
  ]);

  // Memoized hot-child callbacks so React.memo prevents redundant re-renders
  const handleLoadSnapshotRef = useLatest(handleLoadSnapshot);

  const handlePickImage = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

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
    const curSettings = settingsRef.current;
    NativeBridge.haptic('tick', curSettings.hapticsEnabled);
    void handleLoadSnapshotRef.current(parentSave);
  }, [parentSave, handleLoadSnapshotRef, settingsRef]);

  const handleOpenReleaseChannel = useCallback(() => {
    setSettingsInitialTab(0);
    setShowSettings(true);
  }, []);

  const handleViewExtentChanged = useCallback(
    (zoom: number, panX: number, panY: number, containerW?: number, containerH?: number) => {
      if (containerW && containerH && containerW > 0 && containerH > 0) {
        canvasContainerSizeRef.current = { width: containerW, height: containerH };
      }
      setIsCanvasTransformed(zoom > 1.05 || Math.abs(panX) > 6 || Math.abs(panY) > 6);
      const curState = liveCoopRef.current;
      if (
        !isLoadingRef.current &&
        curState.puzzle &&
        curState.activeSnapshotId &&
        !snapshotTransitioningRef.current
      ) {
        const scheduledSnapshotId = curState.activeSnapshotId;
        const scheduledPuzzle = curState.puzzle;
        const pending = pendingViewportExtentRef.current;
        if (
          viewportSaveTimerRef.current !== null &&
          pending &&
          pending.snapshotId === scheduledSnapshotId &&
          pending.puzzle === scheduledPuzzle &&
          Math.abs(pending.zoomScale - zoom) < 1e-6 &&
          Math.abs(pending.panOffsetX - panX) < 1e-4 &&
          Math.abs(pending.panOffsetY - panY) < 1e-4
        ) {
          viewportRef.current = { zoomScale: zoom, panOffsetX: panX, panOffsetY: panY };
          return;
        }
        const lastSaved = lastSavedViewportRef.current;
        if (
          viewportSaveTimerRef.current === null &&
          lastSaved &&
          lastSaved.snapshotId === scheduledSnapshotId &&
          Math.abs(lastSaved.zoomScale - zoom) < 1e-6 &&
          Math.abs(lastSaved.panOffsetX - panX) < 1e-4 &&
          Math.abs(lastSaved.panOffsetY - panY) < 1e-4
        ) {
          viewportRef.current = { zoomScale: zoom, panOffsetX: panX, panOffsetY: panY };
          return;
        }
        viewportRef.current = { zoomScale: zoom, panOffsetX: panX, panOffsetY: panY };
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
      }
    },
    [isLoadingRef, persistActiveViewportOnly]
  );

  const handleViewportGesture = useCallback(() => {
    markTutorialActionTried('zoom');
  }, [markTutorialActionTried]);

  const handleManualPanStart = useCallback(() => {
    if (isReplayingRef.current) {
      if (!(isPostLoadReplayRef.current && isReplayPlayingRef.current)) {
        cancelAutoResume();
      }
      const curSettings = settingsRef.current;
      if (curSettings.replayFollow) {
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
  }, [isPreviewModeRef]);

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

  const handlePaletteColorSelected = useCallback(
    (colId: number) => {
      if (isReplayingRef.current) {
        exitReplay();
      }
      const curSettings = settingsRef.current;
      NativeBridge.haptic('tick', curSettings.hapticsEnabled);
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
        const curSettings = settingsRef.current;
        NativeBridge.haptic('tick', curSettings.hapticsEnabled);
        setHintRegionId(null);
        markTutorialActionTried('palette');
        return;
      }
      triggerHint(colId);
    },
    [markTutorialActionTried, settingsRef, showTutorialRef, triggerHint, tutorialStepRef]
  );

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
      handleUpdateSettings((prev) => ({
        ...prev,
        detailedLoadingProgress: enabled,
      }));
      PuzzleWorkerService.setDetailedProgress(enabled);
    },
    [handleUpdateSettings]
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
        activeColorId={isCompleted || isReplaying ? 0 : activeColorId}
        filledRegionIds={displayedFilledRegionIds}
        paintedRegionColors={paintedRegionColors}
        hintRegionId={isCompleted || isReplaying ? null : hintRegionId}
        isPreviewMode={isPreviewMode}
        isFreeColorMode={isFreeColorMode}
        difficulty={settings.difficulty}
        fatFingerAssist={settings.fatFingerAssist}
        touchReachRadiusPx={
          (settings.uiScale ?? 1.0) > 1.0
            ? Math.max(settings.touchReachRadiusPx, 34)
            : settings.touchReachRadiusPx
        }
        isPaintMode={settings.isPaintMode && (!isReplaying || (!isCompleted && isPostLoadReplay))}
        canvasBgColor={settings.canvasBgColor}
        canvasBgArgb={settings.canvasBgArgb}
        sortOrder={settings.paletteSort}
        regionColorMode={settings.regionColorMode}
        showRegionLabels={isReplaying ? false : settings.showRegionLabels}
        showPreviewLabels={settings.showPreviewLabels}
        showPreviewBorders={settings.showPreviewBorders}
        labelScale={settings.labelScale}
        minLabelSize={settings.minLabelSize}
        maxLabelSize={
          settings.textScale > 1.0
            ? Math.round(Math.max(settings.maxLabelSize * settings.textScale * 1.2, 28))
            : settings.maxLabelSize
        }
        highlightMatching={isReplaying ? false : settings.highlightMatching}
        highlightStyle={settings.highlightStyle}
        hintColorArgb={settings.hintColorArgb}
        hintFillStyle={settings.hintFillStyle}
        animateHint={settings.animateHint}
        showNextRegionHint={isReplaying ? false : settings.showNextRegionHint}
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
        replayFollowRegionId={
          isReplaying &&
          isReplayPlaying &&
          settings.replayFollow &&
          replayStep < replaySequence.length
            ? replaySequence[replayStep]
            : null
        }
        replayFollowSequence={
          isReplaying && isReplayPlaying && settings.replayFollow ? replaySequence : null
        }
        replayFollowStep={replayStep}
        replaySpeed={settings.replaySpeed || 1}
        isGenerating={isLoading}
        detailedProgress={Boolean(settings.detailedLoadingProgress)}
        generationProgress={loadingProgress}
        generationStepIndex={loadingPayload?.stepIndex || 1}
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
      {puzzle && !isLoading && (
        <FloatingActions
          isPaintMode={settings.isPaintMode}
          showZoomButtons={settings.showZoomButtons}
          showResetViewButton={settings.showResetViewButton}
          raiseDock={settings.raisePaletteDock}
          isZoomedOrPanned={isCanvasTransformed}
          canUndo={isUndoEnabled && (undoStack.length > 0 || filledRegionIds.size > 0)}
          canRedo={isUndoEnabled && redoStack.length > 0}
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
      {puzzle && !isLoading && (
        <ReplayControls
          isOpen={isReplaying}
          isPlaying={isReplayPlaying}
          currentStep={replayStep}
          totalSteps={replaySequence.length}
          replaySpeed={settings.replaySpeed || 1}
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
      {puzzle && !isLoading && !isCompleted && (
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
          showCustomColorButton={Boolean(
            isFreeColorMode || puzzle.isFreeColor || settings.enableCustomColorForAllPuzzles
          )}
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
            activeColor={puzzle.palette.find((c) => c.id === activeColorId) || null}
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
          onClose={() => setShowSettings(false)}
          navigation={{
            initialTab: settingsInitialTab,
            initialTabRequestKey: settingsTabRequestKey,
            hasDockedTutorial: showTutorial && showSettings && !showPaletteOptions,
            onStartTutorial: handleStartTutorial,
            onStartTour: handleStartSettingsTour,
            onTabOpened: (tabId) => {
              activeSettingsTabRef.current = tabId;
              setActiveSettingsTab(tabId);
              if (tabId === 1) {
                markTutorialActionTried('settings');
              } else if (tabId === 2) {
                markTutorialActionTried('hints');
              } else if (tabId === 3) {
                markTutorialActionTried('create_gallery');
                triggerFeatureOffer('create_gallery');
              } else if (tabId === 4) {
                markTutorialActionTried('saves_export');
                triggerFeatureOffer('saves_export');
              }
            },
            onExplorePresetGallery: () => {
              markTutorialActionTried('create_gallery');
            },
          }}
          preferences={{
            settings,
            isFullscreen,
            onUpdateSettings: (nextSettings) => {
              const prev = settingsRef.current;
              const enablingFreeColor = Boolean(
                nextSettings.isFreeColorMode && !prev.isFreeColorMode
              );
              const toggledFreeColor =
                nextSettings.isFreeColorMode !== prev.isFreeColorMode ||
                nextSettings.enableCustomColorForAllPuzzles !==
                  prev.enableCustomColorForAllPuzzles;
              const changedHintSetting =
                nextSettings.highlightStyle !== prev.highlightStyle ||
                nextSettings.hintColorArgb !== prev.hintColorArgb ||
                nextSettings.hintFillStyle !== prev.hintFillStyle ||
                nextSettings.hintIntensity !== prev.hintIntensity ||
                nextSettings.highlightMatching !== prev.highlightMatching ||
                nextSettings.animateHint !== prev.animateHint ||
                nextSettings.showNextRegionHint !== prev.showNextRegionHint;
              handleUpdateSettings(nextSettings);
              if (toggledFreeColor) {
                markTutorialActionTried('free_color');
                if (enablingFreeColor) {
                  triggerFeatureOffer('free_color');
                }
              } else if (changedHintSetting) {
                markTutorialActionTried('hints');
              } else {
                markTutorialActionTried('settings');
              }
            },
            onToggleFullscreen: handleToggleFullscreen,
          }}
          about={{
            lifetimeStats,
            showCloudCoopUi,
          }}
          create={{
            sourceImage,
            onRegenerate: async (cfg) => {
              if (sourceImage) {
                clearPendingViewportSave();
                const regenSeq = ++snapshotTransitionSeqRef.current;
                snapshotTransitioningRef.current = true;
                const prevSnap = activeSave;
                const prevTitle = activeTitle;
                liveCoopRef.current = {
                  ...liveCoopRef.current,
                  activeSnapshotId: null,
                  puzzle: null,
                };
                let handedOff = false;
                try {
                  const samplePath =
                    prevSnap?.sourceRef?.kind === 'sample' &&
                    isAllowedSampleAssetPath(prevSnap.sourceRef.uri)
                      ? prevSnap.sourceRef.uri
                      : isAllowedSampleAssetPath(prevSnap?.sampleAssetPath)
                        ? prevSnap?.sampleAssetPath
                        : undefined;
                  const existingBlob =
                    !samplePath && prevSnap
                      ? await StorageService.loadImageBlob(
                          prevSnap.sourceRef?.kind === 'blob'
                            ? prevSnap.sourceRef.uri
                            : prevSnap.id
                        )
                      : null;
                  if (regenSeq !== snapshotTransitionSeqRef.current) return;
                  handedOff = true;
                  loadArtworkFromImage(
                    sourceImage,
                    prevTitle,
                    cfg,
                    new Set(),
                    undefined,
                    undefined,
                    samplePath,
                    false,
                    existingBlob
                  );
                } catch (err) {
                  console.error('Failed to regenerate puzzle:', err);
                } finally {
                  if (!handedOff && regenSeq === snapshotTransitionSeqRef.current) {
                    clearPendingViewportSave();
                    snapshotTransitioningRef.current = false;
                    liveCoopRef.current = latestRenderCoopRef.current;
                  }
                }
              }
            },
            onSelectSample: (
              sample: SampleArtwork,
              cfg?: GeneratorConfig,
              prebakedSnapshotId?: string
            ) => {
              markTutorialActionTried('create_gallery');
              void loadSampleFromPrebakedOrGenerate(
                sample,
                undefined,
                undefined,
                sample.isFreeColor,
                cfg || settings.generatorConfig,
                undefined,
                prebakedSnapshotId
              );
            },
            onUploadImage: () => fileInputRef.current?.click(),
            onZoomIntoDetailTile: handleZoomIntoDetailTile,
          }}
          saves={{
            snapshots,
            activeSnapshotId,
            onLoadSnapshot: (snap) => handleLoadSnapshot(snap, false),
            onReplaySnapshot: (snap) => handleLoadSnapshot(snap, true),
            onRenameSnapshot: (id, newTitle) => {
              const updated = StorageService.renameSnapshot(id, newTitle);
              setSnapshots(updated);
            },
            onTogglePinSnapshot: (id) => {
              const updated = StorageService.togglePinSnapshot(id);
              setSnapshots(updated);
            },
            onDeleteSnapshot: async (id) => {
              clearPendingViewportSave();
              const currentActiveId = liveCoopRef.current.activeSnapshotId ?? activeSnapshotId;
              const deletingActiveOrLast = id === currentActiveId || snapshots.length <= 1;
              const delSeq = deletingActiveOrLast ? ++snapshotTransitionSeqRef.current : 0;
              const startSeq = snapshotTransitionSeqRef.current;
              let ownedSeq = delSeq;
              if (deletingActiveOrLast) {
                snapshotTransitioningRef.current = true;
                liveCoopRef.current = {
                  ...liveCoopRef.current,
                  activeSnapshotId: null,
                  puzzle: null,
                  filledRegionIds: new Set(),
                  paintedRegionColors: new Map(),
                };
              }
              let handedOff = false;
              let clearedActiveLocalState = false;
              try {
                const updated = await StorageService.deleteSnapshot(id);
                if (deletingActiveOrLast) {
                  if (delSeq !== snapshotTransitionSeqRef.current) return;
                } else if (startSeq !== snapshotTransitionSeqRef.current) {
                  setSnapshots(updated);
                  return;
                }
                setSnapshots(updated);
                if (id === currentActiveId || updated.length === 0) {
                  if (updated.length === 0) {
                    StorageService.clearActiveState();
                  }
                  if (updated.length > 0) {
                    handedOff = true;
                    setActiveSnapshotId(null);
                    setPuzzle(null);
                    setFilledRegionIds(new Set());
                    setPaintedRegionColors(new Map());
                    clearedActiveLocalState = true;
                    void handleLoadSnapshot(updated[0], false);
                  } else {
                    if (!ownedSeq) {
                      ownedSeq = ++snapshotTransitionSeqRef.current;
                    }
                    snapshotTransitioningRef.current = true;
                    liveCoopRef.current = {
                      ...liveCoopRef.current,
                      activeSnapshotId: null,
                      puzzle: null,
                      filledRegionIds: new Set(),
                      paintedRegionColors: new Map(),
                    };
                    setActiveSnapshotId(null);
                    setPuzzle(null);
                    setFilledRegionIds(new Set());
                    setPaintedRegionColors(new Map());
                    syncUndoStack([]);
                    syncRedoStack([]);
                    setHintRegionId(null);
                    clearedActiveLocalState = true;
                    const defaultSample = SAMPLE_GALLERY[0];
                    const img = await loadHtmlImage(defaultSample.assetPath);
                    if (ownedSeq !== snapshotTransitionSeqRef.current) return;
                    if (img) {
                      handedOff = true;
                      loadArtworkFromImage(
                        img,
                        defaultSample.title,
                        settings.generatorConfig,
                        new Set(),
                        undefined,
                        undefined,
                        defaultSample.assetPath
                      );
                    } else {
                      clearPendingViewportSave();
                      snapshotTransitioningRef.current = false;
                      setIsLoading(false);
                    }
                  }
                } else if (deletingActiveOrLast && delSeq === snapshotTransitionSeqRef.current) {
                  snapshotTransitioningRef.current = false;
                  liveCoopRef.current = latestRenderCoopRef.current;
                }
              } catch (err) {
                console.error('Failed to delete snapshot:', err);
                if (ownedSeq > 0 && ownedSeq === snapshotTransitionSeqRef.current) {
                  setIsLoading(false);
                }
              } finally {
                if (
                  !handedOff &&
                  ownedSeq > 0 &&
                  ownedSeq === snapshotTransitionSeqRef.current &&
                  snapshotTransitioningRef.current
                ) {
                  clearPendingViewportSave();
                  snapshotTransitioningRef.current = false;
                  if (!clearedActiveLocalState) {
                    liveCoopRef.current = latestRenderCoopRef.current;
                  }
                }
              }
            },
            onClearAllSnapshots: async () => {
              clearPendingViewportSave();
              const clearSeq = ++snapshotTransitionSeqRef.current;
              snapshotTransitioningRef.current = true;
              liveCoopRef.current = {
                ...liveCoopRef.current,
                activeSnapshotId: null,
                puzzle: null,
                filledRegionIds: new Set(),
                paintedRegionColors: new Map(),
              };
              let handedOff = false;
              let clearedLocalState = false;
              try {
                await StorageService.clearAllSnapshots();
                if (clearSeq !== snapshotTransitionSeqRef.current) return;
                StorageService.clearActiveState();
                setSnapshots([]);
                setActiveSnapshotId(null);
                setPuzzle(null);
                setFilledRegionIds(new Set());
                setPaintedRegionColors(new Map());
                syncUndoStack([]);
                syncRedoStack([]);
                setHintRegionId(null);
                clearedLocalState = true;
                const defaultSample = SAMPLE_GALLERY[0];
                const img = await loadHtmlImage(defaultSample.assetPath);
                if (clearSeq !== snapshotTransitionSeqRef.current) return;
                if (img) {
                  handedOff = true;
                  loadArtworkFromImage(
                    img,
                    defaultSample.title,
                    settings.generatorConfig,
                    new Set(),
                    undefined,
                    undefined,
                    defaultSample.assetPath
                  );
                } else {
                  clearPendingViewportSave();
                  snapshotTransitioningRef.current = false;
                  setIsLoading(false);
                }
              } catch (err) {
                console.error('Failed to clear all snapshots:', err);
                if (clearSeq === snapshotTransitionSeqRef.current) {
                  setIsLoading(false);
                }
              } finally {
                if (!handedOff && clearSeq === snapshotTransitionSeqRef.current) {
                  clearPendingViewportSave();
                  snapshotTransitioningRef.current = false;
                  if (!clearedLocalState) {
                    liveCoopRef.current = latestRenderCoopRef.current;
                  }
                }
              }
            },
            onAfterStorageClear: async ({ clearedActiveChannel, clearedSettings }) => {
              if (!clearedActiveChannel) return;
              clearPendingViewportSave();
              const clearSeq = ++snapshotTransitionSeqRef.current;
              snapshotTransitioningRef.current = true;
              const effectiveSettings = clearedSettings ? StorageService.loadSettings() : settings;
              if (clearedSettings) {
                setSettings(effectiveSettings);
              }
              liveCoopRef.current = {
                ...liveCoopRef.current,
                activeSnapshotId: null,
                puzzle: null,
                filledRegionIds: new Set(),
                paintedRegionColors: new Map(),
              };
              let handedOff = false;
              let clearedLocalState = false;
              try {
                setSnapshots([]);
                setActiveSnapshotId(null);
                setPuzzle(null);
                setFilledRegionIds(new Set());
                setPaintedRegionColors(new Map());
                syncUndoStack([]);
                syncRedoStack([]);
                setHintRegionId(null);
                clearedLocalState = true;
                const defaultSample = SAMPLE_GALLERY[0];
                const img = await loadHtmlImage(defaultSample.assetPath);
                if (clearSeq !== snapshotTransitionSeqRef.current) return;
                if (img) {
                  handedOff = true;
                  loadArtworkFromImage(
                    img,
                    defaultSample.title,
                    effectiveSettings.generatorConfig,
                    new Set(),
                    undefined,
                    undefined,
                    defaultSample.assetPath
                  );
                } else {
                  clearPendingViewportSave();
                  snapshotTransitioningRef.current = false;
                  setIsLoading(false);
                }
              } catch (err) {
                console.error('Failed to reset state after storage clear:', err);
                if (clearSeq === snapshotTransitionSeqRef.current) {
                  setIsLoading(false);
                }
              } finally {
                if (!handedOff && clearSeq === snapshotTransitionSeqRef.current) {
                  clearPendingViewportSave();
                  snapshotTransitioningRef.current = false;
                  if (!clearedLocalState) {
                    liveCoopRef.current = latestRenderCoopRef.current;
                  }
                }
              }
            },
            onRestoreStarterSample: async () => {
              clearPendingViewportSave();
              const restoreSeq = ++snapshotTransitionSeqRef.current;
              snapshotTransitioningRef.current = true;
              liveCoopRef.current = {
                ...liveCoopRef.current,
                activeSnapshotId: null,
                puzzle: null,
              };
              let handedOff = false;
              try {
                const defaultSample = SAMPLE_GALLERY[0];
                const img = await loadHtmlImage(defaultSample.assetPath);
                if (restoreSeq !== snapshotTransitionSeqRef.current) return;
                if (img) {
                  handedOff = true;
                  loadArtworkFromImage(
                    img,
                    defaultSample.title,
                    settings.generatorConfig,
                    new Set(),
                    undefined,
                    undefined,
                    defaultSample.assetPath
                  );
                } else {
                  clearPendingViewportSave();
                  snapshotTransitioningRef.current = false;
                  liveCoopRef.current = latestRenderCoopRef.current;
                }
              } catch (err) {
                console.error('Failed to restore starter sample:', err);
              } finally {
                if (!handedOff && restoreSeq === snapshotTransitionSeqRef.current) {
                  clearPendingViewportSave();
                  snapshotTransitioningRef.current = false;
                  liveCoopRef.current = latestRenderCoopRef.current;
                }
              }
            },
            onResetProgress: () => {
              clearPendingViewportSave();
              const previouslyFilled = Array.from(filledRegionIds);
              if (previouslyFilled.length > 0) {
                emitCoopUnfill(previouslyFilled);
              }
              const freshSnap = activeSnapshotId
                ? StorageService.loadSnapshots().find((s) => s.id === activeSnapshotId)
                : undefined;
              const storedActiveState = StorageService.loadActiveState();
              const activeStateEpoch =
                storedActiveState?.activeSnapshotId === activeSnapshotId
                  ? (storedActiveState.resetEpoch ?? 0)
                  : 0;
              const nextResetEpoch =
                Math.max(
                  activeSave?.resetEpoch ?? 0,
                  liveCoopRef.current.activeSave?.resetEpoch ?? 0,
                  freshSnap?.resetEpoch ?? 0,
                  activeStateEpoch
                ) + 1;
              resetReplayState();
              setFilledRegionIds(new Set());
              setPaintedRegionColors(new Map());
              syncUndoStack([]);
              syncRedoStack([]);
              setHintRegionId(null);
              resetActivePuzzleSessionStats(activeSnapshotId, false);
              let updatedActiveSave =
                liveCoopRef.current.activeSave ?? activeSave ?? freshSnap;
              if (activeSnapshotId && puzzle) {
                const { zoomScale, panOffsetX, panOffsetY } = viewportRef.current;
                const updated = StorageService.updateSnapshotProgress(
                  activeSnapshotId,
                  0,
                  puzzle.regions.length,
                  [],
                  zoomScale,
                  panOffsetX,
                  panOffsetY,
                  undefined,
                  {},
                  puzzle.palette,
                  puzzle.isFreeColor,
                  undefined,
                  nextResetEpoch
                );
                setSnapshots(updated);
                updatedActiveSave =
                  updated.find((s) => s.id === activeSnapshotId) ??
                  (updatedActiveSave
                    ? {
                        ...updatedActiveSave,
                        filledCount: 0,
                        filledRegionIds: [],
                        paintedRegionColors: {},
                        resetEpoch: nextResetEpoch,
                      }
                    : undefined);
                StorageService.saveActiveState({
                  activeSnapshotId,
                  activeColorId: puzzle.palette[0]?.id || 1,
                  filledRegionIds: [],
                  paintedRegionColors: {},
                  isFreeColorMode,
                  resetEpoch: nextResetEpoch,
                  zoomScale,
                  panOffsetX,
                  panOffsetY,
                });
              } else if (updatedActiveSave) {
                updatedActiveSave = {
                  ...updatedActiveSave,
                  filledCount: 0,
                  filledRegionIds: [],
                  paintedRegionColors: {},
                  resetEpoch: nextResetEpoch,
                };
              }
              liveCoopRef.current = {
                ...liveCoopRef.current,
                ...(updatedActiveSave ? { activeSave: updatedActiveSave } : {}),
                filledRegionIds: new Set(),
                paintedRegionColors: new Map(),
              };
              setShowSettings(false);
            },
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
        isModalOpen={showSettings || showPaletteOptions}
        isSettingsOpen={showSettings && !showPaletteOptions}
        activeSettingsTab={activeSettingsTab}
        isLoading={isLoading}
        stepIndex={tutorialStep}
        triedActions={tutorialTried}
        triedInCurrentVisit={tutorialStepTriedInVisit}
        largeText={Boolean(settings.largeText)}
        onToggleLargeText={() => {
          handleUpdateSettings((prev) => {
            const nextLargeText = !prev.largeText;
            return nextLargeText
              ? {
                  ...prev,
                  largeText: true,
                  textScale: Math.max(prev.textScale || 1.0, 1.25),
                  uiScale: Math.max(prev.uiScale || 1.0, 1.25),
                  fatFingerAssist: true,
                }
              : {
                  ...prev,
                  largeText: false,
                  textScale: 1.0,
                  uiScale: 1.0,
                };
          });
          if (TUTORIAL_STEPS[tutorialStepRef.current]?.key === 'settings') {
            markTutorialActionTried('settings');
          }
        }}
        onStepChange={handleTutorialStepChange}
        onTriggerHint={() => {
          if (isReplayingRef.current) {
            exitReplay();
          }
          triggerHint();
          markTutorialActionTried('hint');
        }}
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

      {(() => {
        const activeTutorialStep =
          TUTORIAL_STEPS[Math.max(0, Math.min(TUTORIAL_STEPS.length - 1, tutorialStep))];
        const isModalTutorialStep =
          showTutorial &&
          showSettings &&
          !showPaletteOptions &&
          activeTutorialStep?.modalTab !== undefined;
        return (
          <TargetSpotlightOverlay
            isActive={
              !isLoading &&
              !showPaletteOptions &&
              (!showSettings || isModalTutorialStep) &&
              (!isPreviewMode ||
                (showTutorial && activeTutorialStep?.key === 'peek_fullscreen')) &&
              (showTutorial || Boolean(activeFeatureOffer && !isFeatureOfferSuppressed))
            }
            variant={showTutorial ? 'tutorial' : 'offer'}
            targetKey={
              showTutorial
                ? activeTutorialStep?.key ?? null
                : activeFeatureOffer?.id ?? null
            }
            cardSelector={
              showTutorial
                ? '[data-testid="onboarding-tutorial"]'
                : '[data-testid="feature-offer-banner"]'
            }
            reducedMotion={Boolean(settings.reducedMotion)}
            largeText={Boolean(settings.largeText)}
            textScale={settings.textScale}
            uiScale={settings.uiScale}
            isModalSpotlight={isModalTutorialStep}
            activeSettingsTab={activeSettingsTab}
            zIndexClass={isModalTutorialStep ? 'z-[58]' : 'z-[38]'}
          />
        );
      })()}

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
