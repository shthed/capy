import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import {
  GenerationProgressPayload,
  GeneratorConfig,
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
import { DEFAULT_SETTINGS, StorageService } from './services/StorageService';
import { NativeBridge } from './services/NativeBridge';
import { SoundService } from './services/SoundService';
import { exportPrintableColoringSvg } from './services/SvgPrintExporter';
import { PlayerLifetimeStats, PlayerStatsService } from './services/PlayerStatsService';
import { GenerationCancelledError, PuzzleWorkerService } from './services/PuzzleWorkerService';
import {
  decodeProgressDeltaToken,
  encodeProgressDeltaToken,
  mergeProgressDeltas,
  ProgressDeltaV2,
} from './services/CapyCodec';
import {
  buildShareProgressUrl,
  clearShareHashFromWindowUrl,
  generateCoopRoomCode,
  parseShareLinkFromUrl,
  resolveSampleFromSourceRef,
} from './services/ShareLinkService';
import { ProviderRegistry } from './services/providers/ProviderRegistry';
import { CoopParticipant } from './services/providers/types';
import { CoopRippleBuffer } from './engine/CoopRippleBuffer';
import { getDisplayNumberMap, getDockPalette, getVisiblePalette } from './components/PaletteDock';
import { clampCanvasOffset, PuzzleCanvas } from './components/PuzzleCanvas';
import { GameTopBar } from './components/GameTopBar';
import { PaletteDock } from './components/PaletteDock';
import { FloatingActions } from './components/FloatingActions';
import { LoadingOverlay } from './components/LoadingOverlay';
import { ReplayControls } from './components/ReplayControls';
import { resolveReleaseChannel } from './version';

const SettingsModal = React.lazy(() =>
  import('./components/SettingsModal').then((m) => ({ default: m.SettingsModal }))
);
const ColorPickerPopover = React.lazy(() =>
  import('./components/ColorPickerPopover').then((m) => ({ default: m.ColorPickerPopover }))
);

function isDefaultGeneratorConfig(cfg: GeneratorConfig): boolean {
  const def = DEFAULT_SETTINGS.generatorConfig;
  return (
    (cfg.algorithm || 'AUTO') === (def.algorithm || 'AUTO') &&
    (cfg.lineHandling || 'ABSORB_LINES') === (def.lineHandling || 'ABSORB_LINES') &&
    cfg.paletteDetail === def.paletteDetail &&
    cfg.imageType === def.imageType &&
    cfg.colorCount === def.colorCount &&
    cfg.minRegionArea === def.minRegionArea &&
    cfg.maxRegions === def.maxRegions &&
    cfg.resolution === def.resolution &&
    cfg.smoothingPasses === def.smoothingPasses
  );
}

export function mergeCustomPalette(
  generatedPalette: PaletteColor[],
  customPalette?: PaletteColor[]
): PaletteColor[] {
  if (!customPalette || customPalette.length === 0) {
    return generatedPalette;
  }
  const customById = new Map<number, PaletteColor>();
  for (let i = 0; i < customPalette.length; i++) {
    const col = customPalette[i];
    customById.set(col.id, col);
  }
  const seenIds = new Set<number>();
  const merged: PaletteColor[] = generatedPalette.map((col) => {
    seenIds.add(col.id);
    return customById.get(col.id) || col;
  });
  for (let i = 0; i < customPalette.length; i++) {
    const col = customPalette[i];
    if (!seenIds.has(col.id)) {
      merged.push(col);
      seenIds.add(col.id);
    }
  }
  return merged;
}

interface UndoHistoryEntry {
  regionId: number;
  wasPreviouslyFilled: boolean;
  previousPaintedColorId?: number;
  paintedColorId?: number;
}

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
  const [undoStack, setUndoStack] = useState<UndoHistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<UndoHistoryEntry[]>([]);
  const [hintRegionId, setHintRegionId] = useState<number | null>(null);
  const [isPreviewMode, setIsPreviewMode] = useState<boolean>(false);
  const [zoomInTrigger, setZoomInTrigger] = useState<number>(0);
  const [zoomOutTrigger, setZoomOutTrigger] = useState<number>(0);
  const [stepZoomTrigger, setStepZoomTrigger] = useState<number>(0);
  const [resetViewTrigger, setResetViewTrigger] = useState<number>(0);
  const [restoreViewTrigger, setRestoreViewTrigger] = useState<number>(0);
  const [panStepRequest, setPanStepRequest] = useState<{ seq: number; dx: number; dy: number }>({
    seq: 0,
    dx: 0,
    dy: 0,
  });
  const [currentZoomScale, setCurrentZoomScale] = useState<number>(1);
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
  const regionByIdRef = useRef<Map<number, Region>>(new Map());
  const viewportSaveTimerRef = useRef<number | null>(null);
  const activeBlobUrlRef = useRef<string | null>(null);

  // Co-op Multiplayer & Zero-Allocation Canvas Ripple Buffer
  const coopRippleBufferRef = useRef<CoopRippleBuffer>(new CoopRippleBuffer());
  const [coopRoomCode, setCoopRoomCode] = useState<string | null>(null);
  const [coopParticipants, setCoopParticipants] = useState<CoopParticipant[]>([]);

  // Replay State
  const [isReplaying, setIsReplaying] = useState<boolean>(false);
  const [isReplayPlaying, setIsReplayPlaying] = useState<boolean>(false);
  const [replayStep, setReplayStep] = useState<number>(0);
  const [replaySequence, setReplaySequence] = useState<number[]>([]);

  // Spatial Viewport
  const [visibleColorIds, setVisibleColorIds] = useState<Set<number>>(new Set());
  const [visibleRegionIds, setVisibleRegionIds] = useState<Set<number>>(new Set());

  // Loading & Generation Pipeline Details
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadingProgress, setLoadingProgress] = useState<number>(0.02);
  const [loadingStatus, setLoadingStatus] = useState<string>('Loading Capy...');
  const [loadingPayload, setLoadingPayload] = useState<GenerationProgressPayload | null>(null);

  // Modal Sheet & Active Deployment Channel
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<number | undefined>(undefined);
  const [showPaletteOptions, setShowPaletteOptions] = useState<boolean>(false);
  const releaseChannelInfo = useMemo(() => resolveReleaseChannel(), []);

  // Maintain O(1) region lookup map for offscreen replay frustum checks
  useEffect(() => {
    const map = new Map<number, Region>();
    if (puzzle) {
      for (let i = 0; i < puzzle.regions.length; i++) {
        const r = puzzle.regions[i];
        map.set(r.id, r);
      }
    }
    regionByIdRef.current = map;
  }, [puzzle]);

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
  }, []);

  // Hidden file input
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync modal & overlay states with native LIFO hardware back button stack
  useEffect(() => {
    if (!showSettings) return;
    return NativeBridge.pushBackHandler(() => setShowSettings(false));
  }, [showSettings]);

  useEffect(() => {
    if (!showPaletteOptions) return;
    return NativeBridge.pushBackHandler(() => setShowPaletteOptions(false));
  }, [showPaletteOptions]);

  useEffect(() => {
    if (!isReplaying) return;
    return NativeBridge.pushBackHandler(() => {
      setIsReplaying(false);
      setIsReplayPlaying(false);
    });
  }, [isReplaying]);

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

  // Resolve full-resolution source image URL for built-in samples or IndexedDB image blobs
  const resolveSnapshotImageSrc = useCallback(async (snap: SavedSnapshot): Promise<string> => {
    if (snap.sourceRef?.kind === 'sample' && snap.sourceRef.uri) {
      return snap.sourceRef.uri;
    }
    if (snap.sampleAssetPath) {
      return snap.sampleAssetPath;
    }

    const blobId = snap.sourceRef?.kind === 'blob' ? snap.sourceRef.uri : snap.id;
    const storedBlob = await StorageService.loadImageBlob(blobId);
    if (storedBlob) {
      const nextUrl = URL.createObjectURL(storedBlob);
      if (activeBlobUrlRef.current) {
        URL.revokeObjectURL(activeBlobUrlRef.current);
      }
      activeBlobUrlRef.current = nextUrl;
      return nextUrl;
    }

    return snap.previewDataUrl || './assets/capybara.webp';
  }, []);

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

  const autoResumeReplayRef = useRef<boolean>(false);
  const autoResumeTimerRef = useRef<number | null>(null);
  const replayStepRef = useRef<number>(0);
  replayStepRef.current = replayStep;

  const cancelAutoResume = useCallback(() => {
    autoResumeReplayRef.current = false;
    if (autoResumeTimerRef.current !== null) {
      window.clearTimeout(autoResumeTimerRef.current);
      autoResumeTimerRef.current = null;
    }
  }, []);

  // Zero-allocation bounding-box frustum check against the current canvas viewport
  const isRegionVisibleInViewport = useCallback(
    (regionId: number): boolean => {
      if (!puzzle) return true;
      const { zoomScale, panOffsetX, panOffsetY } = viewportRef.current;
      if (zoomScale <= 1.02 && Math.abs(panOffsetX) <= 4 && Math.abs(panOffsetY) <= 4) {
        return true;
      }
      const reg = regionByIdRef.current.get(regionId);
      if (!reg) return true;
      const w = canvasContainerSizeRef.current.width || window.innerWidth || 1024;
      const h = canvasContainerSizeRef.current.height || window.innerHeight || 768;
      const baseScale = Math.min(w / puzzle.width, h / puzzle.height) * 0.92;
      const baseOffsetX = (w - puzzle.width * baseScale) / 2;
      const baseOffsetY = (h - puzzle.height * baseScale) / 2;
      const effScale = zoomScale * baseScale;
      if (effScale <= 0) return true;

      const visLeft = (-panOffsetX - baseOffsetX) / effScale;
      const visTop = (-panOffsetY - baseOffsetY) / effScale;
      const visRight = visLeft + w / effScale;
      const visBottom = visTop + h / effScale;

      return (
        reg.maxX >= visLeft &&
        reg.minX <= visRight &&
        reg.maxY >= visTop &&
        reg.minY <= visBottom
      );
    },
    [puzzle]
  );

  // Pre-allocated scratch vectors for zero-allocation camera-follow frustum checks
  const followRawScratchRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const followClampedScratchRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Zero-allocation check for whether the viewport has panned to bring the target region onscreen during replayFollow
  const isViewportCaughtUpToRegion = useCallback(
    (regionId: number): boolean => {
      if (!puzzle) return true;
      const { zoomScale, panOffsetX, panOffsetY } = viewportRef.current;
      // At fit-to-screen zoom (<= 1.05x), the entire puzzle is already visible onscreen
      if (zoomScale <= 1.05) return true;
      const reg = regionByIdRef.current.get(regionId);
      if (!reg) return true;
      const w = canvasContainerSizeRef.current.width || window.innerWidth || 1024;
      const h = canvasContainerSizeRef.current.height || window.innerHeight || 768;
      const baseScale = Math.min(w / puzzle.width, h / puzzle.height) * 0.92;
      const baseOffsetX = (w - puzzle.width * baseScale) / 2;
      const baseOffsetY = (h - puzzle.height * baseScale) / 2;
      const effScale = zoomScale * baseScale;
      if (effScale <= 0) return true;

      // Check if viewport is already within 12px of its clamped target offset for this region
      const rawScratch = followRawScratchRef.current;
      rawScratch.x = w / 2 - (baseOffsetX + reg.centroidX * effScale);
      rawScratch.y = h / 2 - (baseOffsetY + reg.centroidY * effScale);
      const clampedTarget = clampCanvasOffset(
        rawScratch,
        zoomScale,
        puzzle.width,
        puzzle.height,
        w,
        h,
        followClampedScratchRef.current
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
        reg.centroidX >= visLeft + padX &&
        reg.centroidX <= visRight - padX &&
        reg.centroidY >= visTop + padY &&
        reg.centroidY <= visBottom - padY
      );
    },
    [puzzle]
  );

  // Start animated region-by-region replay from the user's current viewport without zooming out or moving the camera
  const startReplay = useCallback(
    (sequence: number[], autoResumeOnFinish: boolean = false) => {
      if (!sequence || sequence.length === 0) return;
      if (autoResumeTimerRef.current !== null) {
        window.clearTimeout(autoResumeTimerRef.current);
        autoResumeTimerRef.current = null;
      }
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
      setIsReplaying(true);
      setIsReplayPlaying(true);
    },
    [handleUpdateSettings]
  );

  // Animated Replay Loop (60 FPS smooth accumulator scaled by replaySpeed with offscreen fast-forward, camera follow, and auto-loop)
  useEffect(() => {
    const finishAutoResume = () => {
      autoResumeReplayRef.current = false;
      if (autoResumeTimerRef.current !== null) {
        window.clearTimeout(autoResumeTimerRef.current);
      }
      autoResumeTimerRef.current = window.setTimeout(() => {
        autoResumeTimerRef.current = null;
        setIsReplaying(false);
      }, 250);
    };

    if (!isReplaying || !isReplayPlaying) return;
    if (replaySequence.length === 0) {
      setIsReplayPlaying(false);
      if (autoResumeReplayRef.current) {
        finishAutoResume();
      }
      return;
    }

    let animId: number;
    let lastTime = performance.now();
    let accRegions = 0;
    let loopPauseUntil = 0;

    // Base speed: complete puzzle replay in ~5.5s at 1x, clamped between 12 and 65 regions/sec
    const baseRate = Math.max(12, Math.min(65, replaySequence.length / 5.5));
    const speedMultiplier = settings.replaySpeed || 1;
    const regionsPerMs = (baseRate * speedMultiplier) / 1000;

    const tick = (now: number) => {
      const dt = Math.min(64, Math.max(0, now - lastTime));
      lastTime = now;

      const prev = replayStepRef.current;
      if (prev >= replaySequence.length) {
        if (settings.replayLoop && !autoResumeReplayRef.current) {
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
        setIsReplayPlaying(false);
        if (autoResumeReplayRef.current) {
          finishAutoResume();
        }
        return;
      }

      if (settings.replayFollow) {
        // Wait for the camera to smoothly pan until the next region is onscreen; never skip offscreen steps
        if (!isViewportCaughtUpToRegion(replaySequence[prev])) {
          accRegions = Math.min(1, accRegions + dt * regionsPerMs);
          animId = requestAnimationFrame(tick);
          return;
        }
      }

      accRegions += dt * regionsPerMs;
      const stepDelta = accRegions >= 1 ? Math.floor(accRegions) : 0;

      let cursor = prev;
      if (settings.replayFollow) {
        if (stepDelta > 0) {
          // Advance 1 step at a time so each subsequent region is followed and verified onscreen before painting
          accRegions = Math.min(1, accRegions - 1);
          cursor = prev + 1;
        }
      } else if (stepDelta > 0) {
        accRegions -= stepDelta;
      }

      if (!settings.replayFollow) {
        // Immediately fast-forward past consecutive offscreen regions
        while (
          cursor < replaySequence.length &&
          !isRegionVisibleInViewport(replaySequence[cursor])
        ) {
          cursor++;
        }

        // Advance stepDelta on-screen steps and fast-forward any consecutive offscreen steps following each
        for (let s = 0; s < stepDelta && cursor < replaySequence.length; s++) {
          cursor++;
          while (
            cursor < replaySequence.length &&
            !isRegionVisibleInViewport(replaySequence[cursor])
          ) {
            cursor++;
          }
        }
      }

      const next = Math.min(replaySequence.length, cursor);
      if (next !== prev) {
        replayStepRef.current = next;
        setReplayStep(next);
      }

      if (next >= replaySequence.length) {
        if (settings.replayLoop && !autoResumeReplayRef.current) {
          loopPauseUntil = now + 350;
          animId = requestAnimationFrame(tick);
          return;
        }
        setIsReplayPlaying(false);
        if (autoResumeReplayRef.current) {
          finishAutoResume();
        }
        return;
      }

      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [
    isReplaying,
    isReplayPlaying,
    replaySequence,
    settings.replaySpeed,
    settings.replayLoop,
    settings.replayFollow,
    isRegionVisibleInViewport,
    isViewportCaughtUpToRegion,
  ]);

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
      if (viewportSaveTimerRef.current !== null) {
        window.clearTimeout(viewportSaveTimerRef.current);
        viewportSaveTimerRef.current = null;
      }
      setIsReplaying(false);
      setIsReplayPlaying(false);
      setIsLoading(true);
      setLoadingProgress(0.02);
      setLoadingStatus('Analyzing artwork style and line composition...');
      setLoadingPayload(null);

      // Immediately display source image on canvas and clear previous puzzle regions
      // so the live generation scan/segmentation visualization renders over the new image
      setSourceImage(img);
      setPuzzle(null);
      setHintRegionId(null);
      setRedoStack([]);
      const targetView = initialViewportOverride || {
        zoomScale: 1.0,
        panOffsetX: 0,
        panOffsetY: 0,
      };
      viewportRef.current = targetView;
      setInitialViewport(targetView);
      setRestoreViewTrigger((prev) => prev + 1);

      // Prepare canvas from image
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);

      // Pre-register snapshot at 0ms so it appears in Saves instantly!
      const snapId = existingSnapshotId || crypto.randomUUID();
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

      // Persist full-resolution custom image blob to IndexedDB so reloads never degrade to thumbnails
      if (!sampleAssetPath) {
        const persistBlobPromise = sourceBlob
          ? Promise.resolve(sourceBlob)
          : new Promise<Blob | null>((resolve) =>
              canvas.toBlob((b) => resolve(b), 'image/webp', 0.92)
            );
        persistBlobPromise
          .then((blob) => {
            if (blob) {
              return StorageService.saveImageBlob(snapId, blob);
            }
          })
          .catch((err) => console.warn('Failed to persist source image blob:', err));
      }

      // Run generator in background Web Worker thread to prevent freezing browser
      setTimeout(async () => {
        if (currentSeq !== generationSeqRef.current) return;
        try {
          const isDetailed = Boolean(settings.detailedLoadingProgress);
          const puzzleData = await PuzzleWorkerService.generate(
            canvas,
            config,
            (prog, stat, payload) => {
              if (currentSeq === generationSeqRef.current) {
                setLoadingProgress((prev) => Math.max(prev, prog));
                setLoadingStatus(stat);
                if (payload) {
                  setLoadingPayload(payload);
                }
              }
            },
            isDetailed
          );

          if (currentSeq !== generationSeqRef.current) return;

          if (initialCustomPalette && initialCustomPalette.length > 0) {
            puzzleData.palette = mergeCustomPalette(puzzleData.palette, initialCustomPalette);
          }

          const initialOrder = Array.from(initialFilledRegionIds);
          const restoredPaintedMap = initialPaintedColors
            ? new Map(Object.entries(initialPaintedColors).map(([k, v]) => [Number(k), v]))
            : new Map<number, number>();
          setSourceImage(img);
          setPuzzle(puzzleData);
          setFilledRegionIds(new Set(initialOrder));
          setPaintedRegionColors(restoredPaintedMap);
          setUndoStack(
            initialOrder.map((rId) => ({
              regionId: rId,
              wasPreviouslyFilled: false,
            }))
          );
          setRedoStack([]);

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
          setSnapshots(finalizedSnapshots);

          // Persist puzzle in IndexedDB
          await StorageService.savePuzzleData(snapId, puzzleData);

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
            currentSeq !== generationSeqRef.current
          ) {
            return;
          }
          console.error('Failed to generate puzzle:', err);
          setLoadingStatus('Failed to generate puzzle.');
          setIsLoading(false);
        }
      }, 50);
    },
    [
      settings,
      generatePreviewDataUrl,
      startReplay,
      handleUpdateSettings,
      resetActivePuzzleSessionStats,
    ]
  );

  // Restore session on app launch (checking incoming #s=<token> / ?room=<ROOM6> links and instant sample bootstrap)
  useEffect(() => {
    let isMounted = true;

    const loadHtmlImage = (src: string, fallbackSrc?: string): Promise<HTMLImageElement | null> =>
      new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => {
          if (fallbackSrc && fallbackSrc !== src) {
            const fb = new Image();
            fb.crossOrigin = 'anonymous';
            fb.onload = () => resolve(fb);
            fb.onerror = () => resolve(null);
            fb.src = fallbackSrc;
          } else {
            resolve(null);
          }
        };
        img.src = src;
      });

    const restoreSession = async () => {
      const skipBootstrap =
        typeof window !== 'undefined' &&
        new URLSearchParams(window.location.search).has('skipSampleBootstrap');

      if (typeof window !== 'undefined') {
        const parsedLink = await parseShareLinkFromUrl(window.location.href);
        if (parsedLink.roomCode) {
          const id = ProviderRegistry.auth.getCurrentIdentity();
          await ProviderRegistry.realtimeRoom.joinRoom(parsedLink.roomCode, {
            playerId: id.playerId,
            displayName: id.displayName,
            avatarColorHex: id.avatarColorHex,
            lastActiveAt: Date.now(),
          });
          if (isMounted) {
            setCoopRoomCode(ProviderRegistry.realtimeRoom.activeRoomCode);
            setCoopParticipants(ProviderRegistry.realtimeRoom.getParticipants());
          }
        }

        if (parsedLink.matchedSample && parsedLink.delta) {
          const sharedSample = parsedLink.matchedSample;
          const cleanSamplePath = sharedSample.assetPath.replace(/^\.\//, '');

          // Ensure pre-baked sample_saves.capy is available on cold start so share links mount instantaneously!
          let snaps = StorageService.loadSnapshots();
          if (snaps.length === 0 && !skipBootstrap) {
            try {
              const bundleResp = await fetch('./assets/sample_saves.capy').catch(() => null);
              if (bundleResp && bundleResp.ok && isMounted) {
                await StorageService.importSnapshotData(await bundleResp.arrayBuffer(), {
                  refreshTimestamps: true,
                });
                snaps = StorageService.loadSnapshots();
              }
            } catch {
              // Fall back cleanly if bundle unavailable
            }
          }

          const prebakedSnap = snaps.find(
            (s) => s.sampleAssetPath?.replace(/^\.\//, '') === cleanSamplePath
          );
          if (prebakedSnap) {
            const [cachedPuzzle, sampleImg] = await Promise.all([
              StorageService.loadPuzzleData(prebakedSnap.id),
              loadHtmlImage(sharedSample.assetPath),
            ]);
            if (cachedPuzzle && sampleImg && isMounted) {
              clearShareHashFromWindowUrl(parsedLink.roomCode);
              const validIds = new Set(cachedPuzzle.regions.map((r) => r.id));
              const orderedIds = parsedLink.delta.filledRegionIds.filter((id) => validIds.has(id));
              const filledSet = new Set(orderedIds);
              const paintedObj = parsedLink.delta.paintedRegionColors || {};
              const restoredPaintedMap = new Map(
                Object.entries(paintedObj)
                  .map(([k, v]) => [Number(k), v] as [number, number])
                  .filter(([k]) => validIds.has(k))
              );
              const isFree = Boolean(
                parsedLink.delta.isFreeColor ||
                  prebakedSnap.isFreeColor ||
                  cachedPuzzle.isFreeColor ||
                  restoredPaintedMap.size > 0
              );
              const availableColors = getVisiblePalette(
                cachedPuzzle.palette,
                cachedPuzzle.regions,
                filledSet,
                settings.paletteSort
              );
              const initialColor = availableColors[0]?.id || cachedPuzzle.palette[0]?.id || 1;
              const updatedList = StorageService.updateSnapshotProgress(
                prebakedSnap.id,
                filledSet.size,
                cachedPuzzle.regions.length,
                orderedIds,
                1.0,
                0,
                0,
                undefined,
                Object.fromEntries(restoredPaintedMap),
                cachedPuzzle.palette,
                isFree
              );
              if (viewportSaveTimerRef.current !== null) {
                window.clearTimeout(viewportSaveTimerRef.current);
                viewportSaveTimerRef.current = null;
              }
              const targetView = { zoomScale: 1.0, panOffsetX: 0, panOffsetY: 0 };
              viewportRef.current = targetView;
              setInitialViewport(targetView);
              setRestoreViewTrigger((prev) => prev + 1);
              setSnapshots(updatedList);
              setPaintedRegionColors(restoredPaintedMap);
              setSettings((prev) => ({ ...prev, isFreeColorMode: isFree }));
              setSourceImage(sampleImg);
              setPuzzle(cachedPuzzle);
              setActiveSnapshotId(prebakedSnap.id);
              setActiveColorId(initialColor);
              setFilledRegionIds(filledSet);
              setUndoStack(
                orderedIds.map((rId) => ({
                  regionId: rId,
                  wasPreviouslyFilled: false,
                }))
              );
              setRedoStack([]);
              setHintRegionId(null);
              StorageService.saveActiveState({
                activeSnapshotId: prebakedSnap.id,
                activeColorId: initialColor,
                filledRegionIds: orderedIds,
                paintedRegionColors: Object.fromEntries(restoredPaintedMap),
                isFreeColorMode: isFree,
                zoomScale: 1.0,
                panOffsetX: 0,
                panOffsetY: 0,
              });
              setIsLoading(false);
              return;
            }
          }

          const sharedFilled = new Set(parsedLink.delta.filledRegionIds);
          const sharedPainted = parsedLink.delta.paintedRegionColors;
          const img = await loadHtmlImage(sharedSample.assetPath);
          if (!isMounted) return;
          if (!img) {
            setIsLoading(false);
            return;
          }
          clearShareHashFromWindowUrl(parsedLink.roomCode);
          loadArtworkFromImage(
            img,
            sharedSample.title,
            settings.generatorConfig,
            sharedFilled,
            undefined,
            undefined,
            sharedSample.assetPath,
            false,
            null,
            sharedPainted
          );
          return;
        }
      }

      const activeState = StorageService.loadActiveState();
      const existingSnapshots = StorageService.loadSnapshots();

      const candidateSnap =
        (activeState?.activeSnapshotId
          ? existingSnapshots.find((s) => s.id === activeState.activeSnapshotId)
          : undefined) || existingSnapshots[0];

      if (candidateSnap) {
        const cachedPuzzle = await StorageService.loadPuzzleData(candidateSnap.id);
        const resolvedSrc = await resolveSnapshotImageSrc(candidateSnap);
        if (!isMounted) return;
        const img = await loadHtmlImage(
          resolvedSrc,
          candidateSnap.previewDataUrl || './assets/capybara.webp'
        );
        if (!isMounted || !img) {
          if (isMounted) setIsLoading(false);
          return;
        }

        const isMatchingActive = activeState?.activeSnapshotId === candidateSnap.id;
        const snapEpochNewer =
          (candidateSnap.resetEpoch ?? 0) > (activeState?.resetEpoch ?? 0);
        const orderedIds =
          (isMatchingActive && !snapEpochNewer ? activeState?.filledRegionIds : undefined) ??
          candidateSnap.filledRegionIds ??
          [];
        const filledSet = new Set(orderedIds);
        const restoredView = {
          zoomScale:
            (isMatchingActive ? activeState?.zoomScale : undefined) ??
            candidateSnap.zoomScale ??
            1.0,
          panOffsetX:
            (isMatchingActive ? activeState?.panOffsetX : undefined) ??
            candidateSnap.panOffsetX ??
            0,
          panOffsetY:
            (isMatchingActive ? activeState?.panOffsetY : undefined) ??
            candidateSnap.panOffsetY ??
            0,
        };

        if (cachedPuzzle && isMounted) {
          if (candidateSnap.customPalette && candidateSnap.customPalette.length > 0) {
            cachedPuzzle.palette = mergeCustomPalette(
              cachedPuzzle.palette,
              candidateSnap.customPalette
            );
          }
          const availableColors = getVisiblePalette(
            cachedPuzzle.palette,
            cachedPuzzle.regions,
            filledSet,
            settings.paletteSort
          );
          const restoredColor =
            isMatchingActive &&
            activeState?.activeColorId &&
            availableColors.some((c) => c.id === activeState.activeColorId)
              ? activeState.activeColorId
              : availableColors[0]?.id || cachedPuzzle.palette[0]?.id || 1;

          let restoredPaintedMap = new Map<number, number>();
          if (candidateSnap.paintedRegionColors) {
            restoredPaintedMap = new Map(
              Object.entries(candidateSnap.paintedRegionColors).map(([k, v]) => [Number(k), v])
            );
          } else if (isMatchingActive && activeState?.paintedRegionColors) {
            restoredPaintedMap = new Map(
              Object.entries(activeState.paintedRegionColors).map(([k, v]) => [Number(k), v])
            );
          }

          const isFree = Boolean(
            candidateSnap.isFreeColor ||
              cachedPuzzle.isFreeColor ||
              (isMatchingActive && activeState?.isFreeColorMode)
          );

          viewportRef.current = restoredView;
          setInitialViewport(restoredView);
          setRestoreViewTrigger((prev) => prev + 1);

          setPaintedRegionColors(restoredPaintedMap);
          handleUpdateSettings((prev) => ({
            ...prev,
            isFreeColorMode: isFree,
            ...(prev.replayLoop ? { replayLoop: false } : {}),
          }));
          setSourceImage(img);
          setPuzzle(cachedPuzzle);
          setActiveSnapshotId(candidateSnap.id);
          setActiveColorId(restoredColor);
          setFilledRegionIds(filledSet);
          setUndoStack(
            orderedIds.map((rId) => ({
              regionId: rId,
              wasPreviouslyFilled: false,
            }))
          );
          setRedoStack([]);
          resetActivePuzzleSessionStats(
            candidateSnap.id,
            cachedPuzzle.regions.length > 0 && filledSet.size >= cachedPuzzle.regions.length
          );
          setIsLoading(false);
          if (settings.autoReplayOnLoad !== false && orderedIds.length > 0) {
            startReplay(orderedIds, true);
          }
          return;
        }

        // IndexedDB cache evicted for candidateSnap: regenerate while preserving customPalette, progress, and viewport
        const storedBlob = candidateSnap.sampleAssetPath
          ? null
          : await StorageService.loadImageBlob(
              candidateSnap.sourceRef?.kind === 'blob'
                ? candidateSnap.sourceRef.uri
                : candidateSnap.id
            );
        if (!isMounted) return;
        const fallbackPainted =
          candidateSnap.paintedRegionColors ||
          (isMatchingActive ? activeState?.paintedRegionColors : undefined);
        const fallbackFreeColor = Boolean(
          candidateSnap.isFreeColor || (isMatchingActive && activeState?.isFreeColorMode)
        );
        loadArtworkFromImage(
          img,
          candidateSnap.title,
          settings.generatorConfig,
          filledSet,
          isMatchingActive ? activeState?.activeColorId : undefined,
          candidateSnap.id,
          candidateSnap.sampleAssetPath,
          settings.autoReplayOnLoad !== false,
          storedBlob,
          fallbackPainted,
          restoredView,
          candidateSnap.customPalette,
          fallbackFreeColor
        );
        return;
      }

      const defaultSample = SAMPLE_GALLERY[0];

      // First-time open: load pre-generated sample saves export for instant zero-wait gameplay
      if (existingSnapshots.length === 0 && !skipBootstrap) {
        try {
          const [bundleResp, sampleImg] = await Promise.all([
            fetch('./assets/sample_saves.capy').catch(() => null),
            loadHtmlImage(defaultSample.assetPath),
          ]);

          if (bundleResp && bundleResp.ok && sampleImg && isMounted) {
            const bundleBuffer = await bundleResp.arrayBuffer();
            const imported = await StorageService.importSnapshotData(bundleBuffer, {
              refreshTimestamps: true,
            });

            if (
              imported.importedCount > 0 &&
              imported.firstSnapshot &&
              imported.firstPuzzle &&
              isMounted
            ) {
              const firstSnap = imported.firstSnapshot;
              const firstPuzzle = imported.firstPuzzle;
              const firstImg =
                firstSnap.sampleAssetPath && firstSnap.sampleAssetPath !== defaultSample.assetPath
                  ? (await loadHtmlImage(firstSnap.sampleAssetPath, defaultSample.assetPath)) || sampleImg
                  : sampleImg;

              if (!isMounted) return;

              const refreshedList = StorageService.loadSnapshots();
              const orderedIds = firstSnap.filledRegionIds || [];
              const filledSet = new Set(orderedIds);
              if (firstSnap.customPalette && firstSnap.customPalette.length > 0) {
                firstPuzzle.palette = firstSnap.customPalette;
              }
              const availableColors = getVisiblePalette(
                firstPuzzle.palette,
                firstPuzzle.regions,
                filledSet,
                settings.paletteSort
              );
              const initialColor = availableColors[0]?.id || firstPuzzle.palette[0]?.id || 1;
              const isFree = Boolean(firstSnap.isFreeColor || firstPuzzle.isFreeColor);

              if (viewportSaveTimerRef.current !== null) {
                window.clearTimeout(viewportSaveTimerRef.current);
                viewportSaveTimerRef.current = null;
              }
              const targetView = { zoomScale: 1.0, panOffsetX: 0, panOffsetY: 0 };
              viewportRef.current = targetView;
              setInitialViewport(targetView);
              setRestoreViewTrigger((prev) => prev + 1);
              setSnapshots(refreshedList);
              setPaintedRegionColors(new Map());
              setSettings((prev) => ({ ...prev, isFreeColorMode: isFree }));
              setSourceImage(firstImg);
              setPuzzle(firstPuzzle);
              setActiveSnapshotId(firstSnap.id);
              setActiveColorId(initialColor);
              setFilledRegionIds(filledSet);
              setUndoStack([]);
              setRedoStack([]);
              setHintRegionId(null);
              resetActivePuzzleSessionStats(
                firstSnap.id,
                firstPuzzle.regions.length > 0 && filledSet.size >= firstPuzzle.regions.length
              );

              StorageService.saveActiveState({
                activeSnapshotId: firstSnap.id,
                activeColorId: initialColor,
                filledRegionIds: orderedIds,
                paintedRegionColors: {},
                isFreeColorMode: isFree,
                zoomScale: 1.0,
                panOffsetX: 0,
                panOffsetY: 0,
              });

              setIsLoading(false);
              return;
            }
          }
        } catch (err) {
          console.warn('Sample save bundle bootstrap unavailable, falling back to live generator:', err);
        }
      }

      // Fallback: dynamically generate Capybara built-in sample
      const img = await loadHtmlImage(defaultSample.assetPath);
      if (!isMounted) return;
      if (!img) {
        setIsLoading(false);
        return;
      }
      loadArtworkFromImage(
        img,
        defaultSample.title,
        settings.generatorConfig,
        new Set(),
        undefined,
        undefined,
        defaultSample.assetPath
      );
    };

    restoreSession();
    return () => {
      isMounted = false;
    };
  }, []);

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

  // Free colour mode indicator
  const isFreeColorMode = Boolean(settings.isFreeColorMode);

  // Undo & Redo capability: disabled by default for standard puzzles, enabled automatically for free colour puzzles or when explicitly enabled in settings
  const isUndoEnabled = Boolean(settings.enableUndo || isFreeColorMode || puzzle?.isFreeColor);

  const handleToggleFreeColorMode = useCallback(() => {
    handleUpdateSettings((prev) => ({ ...prev, isFreeColorMode: !prev.isFreeColorMode }));
    NativeBridge.haptic('tick', settings.hapticsEnabled);
  }, [handleUpdateSettings, settings.hapticsEnabled]);

  const emitCoopPaint = useCallback(
    (
      action: 'FILL' | 'UNFILL',
      regionIds: number[],
      paintedColors?: Record<number, number>
    ) => {
      const room = ProviderRegistry.realtimeRoom.activeRoomCode;
      if (!room || regionIds.length === 0) return;
      const identity = ProviderRegistry.auth.getCurrentIdentity();
      ProviderRegistry.realtimeRoom.broadcastPaintEvent({
        eventId: `${identity.playerId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        roomCode: room,
        playerId: identity.playerId,
        displayName: identity.displayName,
        avatarColorHex: identity.avatarColorHex,
        action,
        regionIds,
        ...(paintedColors && Object.keys(paintedColors).length > 0 ? { paintedColors } : {}),
        timestamp: Date.now(),
      });
    },
    []
  );

  const emitCoopUnfill = useCallback((regionIds: number[]) => {
    const room = ProviderRegistry.realtimeRoom.activeRoomCode;
    if (!room || regionIds.length === 0) return;
    const identity = ProviderRegistry.auth.getCurrentIdentity();
    const maxBatch = 512;
    for (let offsetIdx = 0; offsetIdx < regionIds.length; offsetIdx += maxBatch) {
      const slice = regionIds.slice(offsetIdx, offsetIdx + maxBatch);
      const now = Date.now();
      ProviderRegistry.realtimeRoom.broadcastUnfillEvent({
        eventId: `${identity.playerId}_unfill_${now}_${Math.random().toString(36).slice(2, 6)}`,
        roomCode: room,
        senderId: identity.playerId,
        playerId: identity.playerId,
        displayName: identity.displayName,
        avatarColorHex: identity.avatarColorHex,
        regionId: slice[0],
        regionIds: slice,
        timestamp: now,
      });
    }
  }, []);

  // Undo last region completion
  const handleUndo = useCallback(() => {
    if (!puzzle || isReplaying || undoStack.length === 0 || !isUndoEnabled) return;

    const lastAction = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    setRedoStack((prev) => [...prev, lastAction]);

    const nextFilled = new Set(filledRegionIds);
    const nextPainted = new Map(paintedRegionColors);
    const undoneRegion = puzzle.regions.find((r) => r.id === lastAction.regionId);

    if (lastAction.wasPreviouslyFilled) {
      if (lastAction.previousPaintedColorId !== undefined) {
        nextPainted.set(lastAction.regionId, lastAction.previousPaintedColorId);
        emitCoopPaint('FILL', [lastAction.regionId], {
          [lastAction.regionId]: lastAction.previousPaintedColorId,
        });
      } else {
        nextPainted.delete(lastAction.regionId);
        if (undoneRegion) {
          emitCoopPaint('FILL', [lastAction.regionId], {
            [lastAction.regionId]: undoneRegion.colorId,
          });
        }
      }
    } else {
      nextFilled.delete(lastAction.regionId);
      nextPainted.delete(lastAction.regionId);
      emitCoopUnfill([lastAction.regionId]);
    }

    setFilledRegionIds(nextFilled);
    setPaintedRegionColors(nextPainted);
    setHintRegionId(null);
    NativeBridge.haptic('tick', settings.hapticsEnabled);

    if (undoneRegion && !isFreeColorMode) {
      setActiveColorId(undoneRegion.colorId);
    }

    if (activeSnapshotId) {
      const paintedObj = Object.fromEntries(nextPainted);
      const { zoomScale, panOffsetX, panOffsetY } = viewportRef.current;
      const updated = StorageService.updateSnapshotProgress(
        activeSnapshotId,
        nextFilled.size,
        puzzle.regions.length,
        Array.from(nextFilled),
        zoomScale,
        panOffsetX,
        panOffsetY,
        undefined,
        paintedObj,
        puzzle.palette,
        puzzle.isFreeColor
      );
      setSnapshots(updated);
      StorageService.saveActiveState({
        activeSnapshotId,
        activeColorId: undoneRegion && !isFreeColorMode ? undoneRegion.colorId : activeColorId,
        filledRegionIds: Array.from(nextFilled),
        paintedRegionColors: paintedObj,
        isFreeColorMode,
        zoomScale,
        panOffsetX,
        panOffsetY,
      });
    }
  }, [
    puzzle,
    isReplaying,
    undoStack,
    filledRegionIds,
    paintedRegionColors,
    settings.hapticsEnabled,
    isFreeColorMode,
    isUndoEnabled,
    activeSnapshotId,
    activeColorId,
    emitCoopPaint,
    emitCoopUnfill,
  ]);

  // Redo last undone region action
  const handleRedo = useCallback(() => {
    if (!puzzle || isReplaying || redoStack.length === 0 || !isUndoEnabled) return;

    const lastRedo = redoStack[redoStack.length - 1];
    setRedoStack((prev) => prev.slice(0, -1));
    setUndoStack((prev) => [...prev, lastRedo]);

    const nextFilled = new Set(filledRegionIds);
    const nextPainted = new Map(paintedRegionColors);

    nextFilled.add(lastRedo.regionId);
    let redonePaintedCol: number | undefined;
    if (lastRedo.paintedColorId !== undefined) {
      nextPainted.set(lastRedo.regionId, lastRedo.paintedColorId);
      redonePaintedCol = lastRedo.paintedColorId;
    } else {
      const region = puzzle.regions.find((r) => r.id === lastRedo.regionId);
      if (region && isFreeColorMode) {
        nextPainted.set(lastRedo.regionId, activeColorId);
        redonePaintedCol = activeColorId;
      }
    }
    emitCoopPaint(
      'FILL',
      [lastRedo.regionId],
      redonePaintedCol !== undefined
        ? { [lastRedo.regionId]: redonePaintedCol }
        : undefined
    );

    setFilledRegionIds(nextFilled);
    setPaintedRegionColors(nextPainted);
    setHintRegionId(null);
    NativeBridge.haptic('tick', settings.hapticsEnabled);

    const redoneRegion = puzzle.regions.find((r) => r.id === lastRedo.regionId);
    if (redoneRegion && !isFreeColorMode) {
      setActiveColorId(redoneRegion.colorId);
    }

    if (activeSnapshotId) {
      const paintedObj = Object.fromEntries(nextPainted);
      const { zoomScale, panOffsetX, panOffsetY } = viewportRef.current;
      const updated = StorageService.updateSnapshotProgress(
        activeSnapshotId,
        nextFilled.size,
        puzzle.regions.length,
        Array.from(nextFilled),
        zoomScale,
        panOffsetX,
        panOffsetY,
        undefined,
        paintedObj,
        puzzle.palette,
        puzzle.isFreeColor
      );
      setSnapshots(updated);
      StorageService.saveActiveState({
        activeSnapshotId,
        activeColorId: redoneRegion && !isFreeColorMode ? redoneRegion.colorId : activeColorId,
        filledRegionIds: Array.from(nextFilled),
        paintedRegionColors: paintedObj,
        isFreeColorMode,
        zoomScale,
        panOffsetX,
        panOffsetY,
      });
    }
  }, [
    puzzle,
    isReplaying,
    redoStack,
    filledRegionIds,
    paintedRegionColors,
    settings.hapticsEnabled,
    isFreeColorMode,
    isUndoEnabled,
    activeSnapshotId,
    activeColorId,
    emitCoopPaint,
  ]);

  // Open replay timeline scrubber from long-press Undo or floating controls
  const handleOpenTimelineReplay = useCallback(() => {
    if (!puzzle || (filledRegionIds.size === 0 && undoStack.length === 0)) return;

    // Build unique ordered list of filled regions matching first-fill gameplay chronology
    const orderedList =
      filledRegionIds.size > 0
        ? Array.from(filledRegionIds)
        : Array.from(new Set(undoStack.map((u) => u.regionId)));

    if (orderedList.length === 0) return;

    NativeBridge.haptic('tick', settings.hapticsEnabled);
    setHintRegionId(null);
    setReplaySequence(orderedList);
    setReplayStep(orderedList.length);
    setIsReplaying(true);
    setIsReplayPlaying(false);
  }, [puzzle, filledRegionIds, undoStack, settings.hapticsEnabled]);

  // Resume active gameplay from scrubbed replay step
  const handleResumeFromReplayStep = useCallback(
    (step: number) => {
      if (!puzzle) return;
      const clampedStep = Math.max(0, Math.min(step, replaySequence.length));
      const keptRegionIds = replaySequence.slice(0, clampedStep);
      const undoneRegionIds = replaySequence.slice(clampedStep);

      const nextFilled = new Set(keptRegionIds);
      const nextPainted = new Map(paintedRegionColors);

      for (const rId of undoneRegionIds) {
        nextPainted.delete(rId);
      }

      if (undoneRegionIds.length > 0) {
        emitCoopUnfill(undoneRegionIds);
      }

      const newUndoStack: UndoHistoryEntry[] = keptRegionIds.map((rId) => {
        const existing = undoStack.find((u) => u.regionId === rId);
        return existing || { regionId: rId, wasPreviouslyFilled: false };
      });

      const newRedoStack: UndoHistoryEntry[] = undoneRegionIds
        .map((rId) => {
          const existing = undoStack.find((u) => u.regionId === rId);
          return existing || { regionId: rId, wasPreviouslyFilled: false };
        })
        .reverse();

      setFilledRegionIds(nextFilled);
      setPaintedRegionColors(nextPainted);
      setUndoStack(newUndoStack);
      setRedoStack(newRedoStack);
      setIsReplaying(false);
      setIsReplayPlaying(false);
      setHintRegionId(null);
      NativeBridge.haptic('success', settings.hapticsEnabled);

      let resolvedActiveColorId = activeColorId;
      if (!isFreeColorMode && undoneRegionIds.length > 0) {
        const nextRegion = puzzle.regions.find((r) => r.id === undoneRegionIds[0]);
        if (nextRegion) {
          resolvedActiveColorId = nextRegion.colorId;
          setActiveColorId(nextRegion.colorId);
        }
      }

      if (activeSnapshotId) {
        const paintedObj = Object.fromEntries(nextPainted);
        const { zoomScale, panOffsetX, panOffsetY } = viewportRef.current;
        const updated = StorageService.updateSnapshotProgress(
          activeSnapshotId,
          nextFilled.size,
          puzzle.regions.length,
          keptRegionIds,
          zoomScale,
          panOffsetX,
          panOffsetY,
          undefined,
          paintedObj,
          puzzle.palette,
          puzzle.isFreeColor
        );
        setSnapshots(updated);
        StorageService.saveActiveState({
          activeSnapshotId,
          activeColorId: resolvedActiveColorId,
          filledRegionIds: keptRegionIds,
          paintedRegionColors: paintedObj,
          isFreeColorMode,
          zoomScale,
          panOffsetX,
          panOffsetY,
        });
      }
    },
    [
      puzzle,
      replaySequence,
      paintedRegionColors,
      undoStack,
      settings.hapticsEnabled,
      isFreeColorMode,
      activeSnapshotId,
      activeColorId,
      emitCoopUnfill,
    ]
  );

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
        if (isReplaying || !isUndoEnabled) return;
        const lowerKey = e.key.toLowerCase();
        if (!e.shiftKey && lowerKey === 'z') {
          e.preventDefault();
          handleUndo();
        } else if (lowerKey === 'y' || (e.shiftKey && lowerKey === 'z')) {
          e.preventDefault();
          handleRedo();
        }
        return;
      }

      // Never hijack browser shortcuts when Ctrl, Meta, or Alt modifiers are held
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!puzzle) return;

      if (e.key >= '1' && e.key <= '9') {
        if (isReplaying || filledRegionIds.size >= puzzle.regions.length) return;
        const selectablePalette = getVisiblePalette(
          puzzle.palette,
          puzzle.regions,
          filledRegionIds,
          settings.paletteSort,
          isFreeColorMode
        );
        const index = Number(e.key) - 1;
        if (index >= 0 && index < selectablePalette.length) {
          e.preventDefault();
          NativeBridge.haptic('tick', settings.hapticsEnabled);
          setActiveColorId(selectablePalette[index].id);
          setHintRegionId(null);
        }
        return;
      }

      switch (e.key) {
        case '+':
        case '=':
          e.preventDefault();
          setZoomInTrigger((prev) => prev + 1);
          return;
        case '-':
        case '_':
          e.preventDefault();
          setZoomOutTrigger((prev) => prev + 1);
          return;
        case '0':
          e.preventDefault();
          setResetViewTrigger((prev) => prev + 1);
          return;
        case 'ArrowUp':
        case 'w':
        case 'W':
          e.preventDefault();
          setPanStepRequest((prev) => ({ seq: prev.seq + 1, dx: 0, dy: 64 }));
          return;
        case 'ArrowDown':
        case 's':
        case 'S':
          e.preventDefault();
          setPanStepRequest((prev) => ({ seq: prev.seq + 1, dx: 0, dy: -64 }));
          return;
        case 'ArrowLeft':
        case 'a':
        case 'A':
          e.preventDefault();
          setPanStepRequest((prev) => ({ seq: prev.seq + 1, dx: 64, dy: 0 }));
          return;
        case 'ArrowRight':
        case 'd':
        case 'D':
          e.preventDefault();
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
  ]);

  const recordFirstTimePuzzleCompletionIfNeeded = useCallback(
    (wasIncomplete: boolean, isNowComplete: boolean) => {
      if (!wasIncomplete || !isNowComplete) return;
      if (activeSnapshotId && completedSnapshotIdsRef.current.has(activeSnapshotId)) {
        return;
      }
      if (activeSnapshotId) {
        completedSnapshotIdsRef.current.add(activeSnapshotId);
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
    [activeSnapshotId, getCurrentActiveElapsedMs]
  );

  // Handle single region coloring
  const attemptFillRegion = useCallback(
    (regionId: number) => {
      if (!puzzle || isReplaying) return;
      const region = puzzle.regions.find((r) => r.id === regionId);
      if (!region) return;
      const wasPuzzleIncomplete = filledRegionIds.size < puzzle.regions.length;

      if (isFreeColorMode) {
        const wasFilled = filledRegionIds.has(regionId);
        const currentPaintedColor = paintedRegionColors.get(regionId);
        const effectivePrevColor =
          currentPaintedColor !== undefined
            ? currentPaintedColor
            : wasFilled
              ? region.colorId
              : undefined;
        if (effectivePrevColor === activeColorId) return;

        setUndoStack((prev) => [
          ...prev,
          {
            regionId,
            wasPreviouslyFilled: wasFilled,
            previousPaintedColorId: effectivePrevColor,
            paintedColorId: activeColorId,
          },
        ]);
        setRedoStack([]);

        const nextPainted = new Map(paintedRegionColors);
        nextPainted.set(regionId, activeColorId);
        setPaintedRegionColors(nextPainted);

        const nextFilled = new Set(filledRegionIds);
        nextFilled.add(regionId);
        setFilledRegionIds(nextFilled);
        setHintRegionId(null);
        emitCoopPaint('FILL', [regionId], { [regionId]: activeColorId });
        setLifetimeStats(PlayerStatsService.recordRegionsColored(1, Boolean(coopRoomCode)));

        const orderedList = Array.from(nextFilled);
        const isComplete = nextFilled.size >= puzzle.regions.length;
        SoundService.playRegionTap(activeColorId);
        if (isComplete) {
          recordFirstTimePuzzleCompletionIfNeeded(wasPuzzleIncomplete, true);
          NativeBridge.haptic('success', settings.hapticsEnabled);
          if (!settings.reducedMotion) {
            confetti({
              particleCount: 120,
              spread: 80,
              origin: { y: 0.6 },
            });
          }
          startReplay(orderedList);
        } else {
          NativeBridge.haptic('tick', settings.hapticsEnabled);
        }

        if (activeSnapshotId) {
          const paintedObj = Object.fromEntries(nextPainted);
          const { zoomScale, panOffsetX, panOffsetY } = viewportRef.current;
          const updated = StorageService.updateSnapshotProgress(
            activeSnapshotId,
            nextFilled.size,
            puzzle.regions.length,
            orderedList,
            zoomScale,
            panOffsetX,
            panOffsetY,
            undefined,
            paintedObj,
            puzzle.palette,
            puzzle.isFreeColor
          );
          setSnapshots(updated);
          StorageService.saveActiveState({
            activeSnapshotId,
            activeColorId,
            filledRegionIds: orderedList,
            paintedRegionColors: paintedObj,
            isFreeColorMode: true,
            zoomScale,
            panOffsetX,
            panOffsetY,
          });
        }
        return;
      }

      if (filledRegionIds.has(regionId)) return;

      const isEasy = settings.difficulty === 'EASY';
      const canFill = isEasy || region.colorId === activeColorId;

      if (!canFill) return;

      if (isEasy && activeColorId !== region.colorId) {
        setActiveColorId(region.colorId);
      }

      setUndoStack((prev) => [
        ...prev,
        {
          regionId,
          wasPreviouslyFilled: false,
          paintedColorId: region.colorId,
        },
      ]);
      setRedoStack([]);

      const nextFilled = new Set(filledRegionIds);
      nextFilled.add(regionId);
      setFilledRegionIds(nextFilled);
      setHintRegionId(null);
      emitCoopPaint('FILL', [regionId]);
      setLifetimeStats(PlayerStatsService.recordRegionsColored(1, Boolean(coopRoomCode)));
      SoundService.playRegionTap(region.colorId);

      const orderedList = Array.from(nextFilled);

      // Check completion
      const isComplete = nextFilled.size >= puzzle.regions.length;
      const remainingForColor = puzzle.regions.filter(
        (r) => r.colorId === region.colorId && !nextFilled.has(r.id)
      );

      if (isComplete || remainingForColor.length === 0) {
        NativeBridge.haptic('success', settings.hapticsEnabled);
      } else {
        NativeBridge.haptic('tick', settings.hapticsEnabled);
      }

      if (isComplete) {
        recordFirstTimePuzzleCompletionIfNeeded(wasPuzzleIncomplete, true);
        if (!settings.reducedMotion) {
          confetti({
            particleCount: 120,
            spread: 80,
            origin: { y: 0.6 },
          });
        }
        startReplay(orderedList);
      }

      // Auto-advance check
      let nextActiveColId = isEasy ? region.colorId : activeColorId;
      if (settings.autoAdvance && !isComplete) {
        const remainingForCurrent = puzzle.regions.filter(
          (r) => r.colorId === nextActiveColId && !nextFilled.has(r.id)
        );
        if (remainingForCurrent.length === 0) {
          const basePalette = getVisiblePalette(
            puzzle.palette,
            puzzle.regions,
            nextFilled,
            settings.paletteSort
          );
          const dockPalette = getDockPalette(
            basePalette,
            settings.prioritizeOnScreen,
            visibleColorIds
          );
          const nextCol = dockPalette[0] || basePalette[0];
          if (nextCol) {
            nextActiveColId = nextCol.id;
            setActiveColorId(nextCol.id);
          }
        }
      }

      // Persistence
      if (activeSnapshotId) {
        const { zoomScale, panOffsetX, panOffsetY } = viewportRef.current;
        const paintedObj =
          paintedRegionColors.size > 0 ? Object.fromEntries(paintedRegionColors) : undefined;
        const updated = StorageService.updateSnapshotProgress(
          activeSnapshotId,
          nextFilled.size,
          puzzle.regions.length,
          orderedList,
          zoomScale,
          panOffsetX,
          panOffsetY,
          undefined,
          paintedObj
        );
        setSnapshots(updated);
        StorageService.saveActiveState({
          activeSnapshotId,
          activeColorId: nextActiveColId,
          filledRegionIds: orderedList,
          paintedRegionColors: paintedObj,
          isFreeColorMode,
          zoomScale,
          panOffsetX,
          panOffsetY,
        });
      }
    },
    [
      puzzle,
      isReplaying,
      filledRegionIds,
      paintedRegionColors,
      isFreeColorMode,
      settings,
      activeColorId,
      activeSnapshotId,
      visibleColorIds,
      coopRoomCode,
      startReplay,
      emitCoopPaint,
      recordFirstTimePuzzleCompletionIfNeeded,
    ]
  );

  // Handle batch fill (for Paint Mode drag-to-color)
  const attemptBatchFillRegions = useCallback(
    (regionIds: Set<number>) => {
      if (!puzzle || isReplaying || regionIds.size === 0) return;
      const wasPuzzleIncomplete = filledRegionIds.size < puzzle.regions.length;

      if (isFreeColorMode) {
        let changed = false;
        const nextPainted = new Map(paintedRegionColors);
        const nextFilled = new Set(filledRegionIds);
        const newUndoEntries: UndoHistoryEntry[] = [];
        const changedColors: Record<number, number> = {};

        for (const rId of regionIds) {
          const region = puzzle.regions.find((r) => r.id === rId);
          if (!region) continue;
          const wasFilled = nextFilled.has(rId);
          const prevCol = nextPainted.get(rId);
          const effectivePrevCol =
            prevCol !== undefined ? prevCol : wasFilled ? region.colorId : undefined;
          if (effectivePrevCol !== activeColorId) {
            newUndoEntries.push({
              regionId: rId,
              wasPreviouslyFilled: wasFilled,
              previousPaintedColorId: effectivePrevCol,
              paintedColorId: activeColorId,
            });
            nextPainted.set(rId, activeColorId);
            changedColors[rId] = activeColorId;
            nextFilled.add(rId);
            changed = true;
          }
        }

        if (changed) {
          setUndoStack((prev) => [...prev, ...newUndoEntries]);
          setRedoStack([]);
          setPaintedRegionColors(nextPainted);
          setFilledRegionIds(nextFilled);
          setHintRegionId(null);
          emitCoopPaint(
            'FILL',
            newUndoEntries.map((u) => u.regionId),
            changedColors
          );
          setLifetimeStats(
            PlayerStatsService.recordRegionsColored(newUndoEntries.length, Boolean(coopRoomCode))
          );
          SoundService.playRegionTap(activeColorId);

          const orderedList = Array.from(nextFilled);
          const isComplete = nextFilled.size >= puzzle.regions.length;
          if (isComplete) {
            recordFirstTimePuzzleCompletionIfNeeded(wasPuzzleIncomplete, true);
            NativeBridge.haptic('success', settings.hapticsEnabled);
            if (!settings.reducedMotion) {
              confetti({
                particleCount: 120,
                spread: 80,
                origin: { y: 0.6 },
              });
            }
            startReplay(orderedList);
          } else {
            NativeBridge.haptic('tick', settings.hapticsEnabled);
          }

          if (activeSnapshotId) {
            const paintedObj = Object.fromEntries(nextPainted);
            const { zoomScale, panOffsetX, panOffsetY } = viewportRef.current;
            const updated = StorageService.updateSnapshotProgress(
              activeSnapshotId,
              nextFilled.size,
              puzzle.regions.length,
              orderedList,
              zoomScale,
              panOffsetX,
              panOffsetY,
              undefined,
              paintedObj,
              puzzle.palette,
              puzzle.isFreeColor
            );
            setSnapshots(updated);
            StorageService.saveActiveState({
              activeSnapshotId,
              activeColorId,
              filledRegionIds: orderedList,
              paintedRegionColors: paintedObj,
              isFreeColorMode: true,
              zoomScale,
              panOffsetX,
              panOffsetY,
            });
          }
        }
        return;
      }

      const isEasy = settings.difficulty === 'EASY';
      const isPaintMode = settings.isPaintMode;
      let filledAny = false;
      const nextFilled = new Set(filledRegionIds);
      const newUndoEntries: UndoHistoryEntry[] = [];

      for (const rId of regionIds) {
        if (nextFilled.has(rId)) continue;
        const region = puzzle.regions.find((r) => r.id === rId);
        if (!region) continue;

        const canFill = isEasy || region.colorId === activeColorId;
        if (canFill) {
          if (isEasy && !isPaintMode && activeColorId !== region.colorId) {
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
        setUndoStack((prev) => [...prev, ...newUndoEntries]);
        setRedoStack([]);
        setFilledRegionIds(nextFilled);
        setHintRegionId(null);
        emitCoopPaint(
          'FILL',
          newUndoEntries.map((u) => u.regionId)
        );
        setLifetimeStats(
          PlayerStatsService.recordRegionsColored(newUndoEntries.length, Boolean(coopRoomCode))
        );
        SoundService.playRegionTap(
          newUndoEntries[newUndoEntries.length - 1]?.paintedColorId ?? activeColorId
        );

        const orderedList = Array.from(nextFilled);
        const isComplete = nextFilled.size >= puzzle.regions.length;
        if (isComplete) {
          recordFirstTimePuzzleCompletionIfNeeded(wasPuzzleIncomplete, true);
          NativeBridge.haptic('success', settings.hapticsEnabled);
          if (!settings.reducedMotion) {
            confetti({
              particleCount: 120,
              spread: 80,
              origin: { y: 0.6 },
            });
          }
          startReplay(orderedList);
        } else {
          NativeBridge.haptic('tick', settings.hapticsEnabled);
        }

        let nextActiveColId = activeColorId;
        if (settings.autoAdvance && !isComplete) {
          const remainingForCurrent = puzzle.regions.filter(
            (r) => r.colorId === activeColorId && !nextFilled.has(r.id)
          );
          if (remainingForCurrent.length === 0) {
            const basePalette = getVisiblePalette(
              puzzle.palette,
              puzzle.regions,
              nextFilled,
              settings.paletteSort
            );
            const dockPalette = getDockPalette(
              basePalette,
              settings.prioritizeOnScreen,
              visibleColorIds
            );
            const nextCol = dockPalette[0] || basePalette[0];
            if (nextCol) {
              nextActiveColId = nextCol.id;
              setActiveColorId(nextCol.id);
            }
          }
        }

        if (activeSnapshotId) {
          const { zoomScale, panOffsetX, panOffsetY } = viewportRef.current;
          const paintedObj =
            paintedRegionColors.size > 0 ? Object.fromEntries(paintedRegionColors) : undefined;
          const updated = StorageService.updateSnapshotProgress(
            activeSnapshotId,
            nextFilled.size,
            puzzle.regions.length,
            orderedList,
            zoomScale,
            panOffsetX,
            panOffsetY,
            undefined,
            paintedObj
          );
          setSnapshots(updated);
          StorageService.saveActiveState({
            activeSnapshotId,
            activeColorId: nextActiveColId,
            filledRegionIds: orderedList,
            paintedRegionColors: paintedObj,
            isFreeColorMode,
            zoomScale,
            panOffsetX,
            panOffsetY,
          });
        }
      }
    },
    [
      puzzle,
      isReplaying,
      isFreeColorMode,
      paintedRegionColors,
      settings,
      activeColorId,
      filledRegionIds,
      activeSnapshotId,
      visibleColorIds,
      coopRoomCode,
      startReplay,
      emitCoopPaint,
      recordFirstTimePuzzleCompletionIfNeeded,
    ]
  );

  // Custom Palette & Color Handlers for Free Colour Mode
  const handleAddCustomColor = useCallback(
    (hex: string) => {
      if (!puzzle) return;
      const clean = hex.replace('#', '');
      const num = parseInt(clean, 16);
      const rgb: [number, number, number] = [
        (num >> 16) & 255,
        (num >> 8) & 255,
        num & 255,
      ];
      const nextId = Math.max(...puzzle.palette.map((c) => c.id), 0) + 1;
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
      const updatedPalette = [...puzzle.palette, newColor];
      const updatedPuzzle = { ...puzzle, palette: updatedPalette };
      setPuzzle(updatedPuzzle);
      setActiveColorId(nextId);
      NativeBridge.haptic('tick', settings.hapticsEnabled);

      if (activeSnapshotId) {
        StorageService.savePuzzleData(activeSnapshotId, updatedPuzzle);
        const updated = StorageService.updateSnapshotProgress(
          activeSnapshotId,
          filledRegionIds.size,
          puzzle.regions.length,
          Array.from(filledRegionIds),
          undefined,
          undefined,
          undefined,
          undefined,
          Object.fromEntries(paintedRegionColors),
          updatedPalette,
          puzzle.isFreeColor
        );
        setSnapshots(updated);
      }
    },
    [puzzle, settings.hapticsEnabled, activeSnapshotId, filledRegionIds, paintedRegionColors]
  );

  const handleUpdateColor = useCallback(
    (colorId: number, hex: string) => {
      if (!puzzle) return;
      const clean = hex.replace('#', '');
      const num = parseInt(clean, 16);
      const rgb: [number, number, number] = [
        (num >> 16) & 255,
        (num >> 8) & 255,
        num & 255,
      ];
      const isLight = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) > 160;
      const argb = ((0xff << 24) | (rgb[0] << 16) | (rgb[1] << 8) | rgb[2]) >>> 0;
      const updatedPalette = puzzle.palette.map((c) =>
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
      const updatedPuzzle = { ...puzzle, palette: updatedPalette };
      setPuzzle(updatedPuzzle);
      NativeBridge.haptic('tick', settings.hapticsEnabled);

      if (activeSnapshotId) {
        StorageService.savePuzzleData(activeSnapshotId, updatedPuzzle);
        const previewUrl = sourceImage
          ? generatePreviewDataUrl(updatedPuzzle, sourceImage, filledRegionIds, paintedRegionColors)
          : undefined;
        const updated = StorageService.updateSnapshotProgress(
          activeSnapshotId,
          filledRegionIds.size,
          puzzle.regions.length,
          Array.from(filledRegionIds),
          undefined,
          undefined,
          undefined,
          previewUrl,
          Object.fromEntries(paintedRegionColors),
          updatedPalette,
          puzzle.isFreeColor
        );
        setSnapshots(updated);
      }
    },
    [
      puzzle,
      sourceImage,
      settings.hapticsEnabled,
      activeSnapshotId,
      filledRegionIds,
      paintedRegionColors,
      generatePreviewDataUrl,
    ]
  );

  const handleApplyPresetPalette = useCallback(
    (preset: PalettePreset) => {
      if (!puzzle) return;
      const updatedPalette = puzzle.palette.map((c, i) => {
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
      const updatedPuzzle = { ...puzzle, palette: updatedPalette };
      setPuzzle(updatedPuzzle);
      NativeBridge.haptic('success', settings.hapticsEnabled);

      if (activeSnapshotId) {
        StorageService.savePuzzleData(activeSnapshotId, updatedPuzzle);
        const previewUrl = sourceImage
          ? generatePreviewDataUrl(updatedPuzzle, sourceImage, filledRegionIds, paintedRegionColors)
          : undefined;
        const updated = StorageService.updateSnapshotProgress(
          activeSnapshotId,
          filledRegionIds.size,
          puzzle.regions.length,
          Array.from(filledRegionIds),
          undefined,
          undefined,
          undefined,
          previewUrl,
          Object.fromEntries(paintedRegionColors),
          updatedPalette,
          puzzle.isFreeColor
        );
        setSnapshots(updated);
      }
    },
    [
      puzzle,
      sourceImage,
      settings.hapticsEnabled,
      activeSnapshotId,
      filledRegionIds,
      paintedRegionColors,
      generatePreviewDataUrl,
    ]
  );

  // Trigger hint (highlight and center uncompleted region)
  const triggerHint = useCallback(
    (colorId?: number) => {
      if (!puzzle) return;
      const targetColor = colorId ?? activeColorId;
      if (colorId !== undefined && activeColorId !== colorId) {
        setActiveColorId(colorId);
      }

      const unfilled = puzzle.regions.filter(
        (r) => r.colorId === targetColor && !filledRegionIds.has(r.id)
      );
      if (unfilled.length === 0) return;

      NativeBridge.haptic('warning', settings.hapticsEnabled);

      // Prefer on-screen regions if available
      const onScreen = unfilled.find((r) => visibleRegionIds.has(r.id));
      const target = onScreen || unfilled[0];
      hintsUsedInSessionRef.current += 1;
      setHintRegionId(target.id);
    },
    [puzzle, activeColorId, filledRegionIds, visibleRegionIds, settings.hapticsEnabled]
  );

  // File Upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const title = file.name.replace(/\.[^/.]+$/, '');
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
    if (snapshot.id === activeSnapshotId && puzzle) {
      const currentOrdered =
        filledRegionIds.size > 0
          ? Array.from(filledRegionIds)
          : snapshot.filledRegionIds || [];
      if ((forceReplay || settings.autoReplayOnLoad !== false) && currentOrdered.length > 0) {
        startReplay(currentOrdered, true);
      }
      return;
    }

    if (viewportSaveTimerRef.current !== null) {
      window.clearTimeout(viewportSaveTimerRef.current);
      viewportSaveTimerRef.current = null;
    }
    if (activeSnapshotId && puzzle) {
      const updated = StorageService.updateSnapshotViewport(
        activeSnapshotId,
        viewportRef.current.zoomScale,
        viewportRef.current.panOffsetX,
        viewportRef.current.panOffsetY
      );
      setSnapshots(updated);
    }

    setIsReplaying(false);
    setIsReplayPlaying(false);
    setIsLoading(true);
    setLoadingProgress(0.15);
    setLoadingStatus(`Loading ${snapshot.title}...`);
    setLoadingPayload(null);

    setActiveSnapshotId(snapshot.id);

    const resolvedSrc = await resolveSnapshotImageSrc(snapshot);

    // Try IndexedDB first
    const cachedPuzzle = await StorageService.loadPuzzleData(snapshot.id);
    if (cachedPuzzle) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const orderedIds = snapshot.filledRegionIds || [];
        const filledSet = new Set(orderedIds);
        if (snapshot.customPalette && snapshot.customPalette.length > 0) {
          cachedPuzzle.palette = mergeCustomPalette(cachedPuzzle.palette, snapshot.customPalette);
        }
        let paintedObj: Record<number, number> = {};
        if (snapshot.paintedRegionColors) {
          paintedObj = snapshot.paintedRegionColors;
          setPaintedRegionColors(
            new Map(Object.entries(snapshot.paintedRegionColors).map(([k, v]) => [Number(k), v]))
          );
        } else {
          setPaintedRegionColors(new Map());
        }
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
        setSourceImage(img);
        setPuzzle(cachedPuzzle);
        setActiveColorId(restoredColor);
        setFilledRegionIds(filledSet);
        setUndoStack(
          orderedIds.map((rId) => ({
            regionId: rId,
            wasPreviouslyFilled: false,
          }))
        );
        setRedoStack([]);
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
          zoomScale: restoredView.zoomScale,
          panOffsetX: restoredView.panOffsetX,
          panOffsetY: restoredView.panOffsetY,
        });
        setIsLoading(false);

        if ((forceReplay || settings.autoReplayOnLoad !== false) && orderedIds.length > 0) {
          startReplay(orderedIds, true);
        }
      };
      img.onerror = () => {
        if (snapshot.previewDataUrl && img.src !== snapshot.previewDataUrl) {
          img.src = snapshot.previewDataUrl;
        } else {
          setIsLoading(false);
        }
      };
      img.src = resolvedSrc;
      return;
    }

    // Fallback: regenerate from image while preserving customPalette, paintedRegionColors, isFreeColor, and viewport
    const storedBlob = snapshot.sampleAssetPath
      ? null
      : await StorageService.loadImageBlob(
          snapshot.sourceRef?.kind === 'blob' ? snapshot.sourceRef.uri : snapshot.id
        );
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      loadArtworkFromImage(
        img,
        snapshot.title,
        settings.generatorConfig,
        new Set(snapshot.filledRegionIds || []),
        undefined,
        snapshot.id,
        snapshot.sampleAssetPath,
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
      setIsLoading(false);
    };
    img.src = resolvedSrc;
  };

  // Active Save Title & Progress
  const activeSave = snapshots.find((s) => s.id === activeSnapshotId);
  const parentSave = useMemo(
    () =>
      activeSave?.parentSnapshotId
        ? snapshots.find((s) => s.id === activeSave.parentSnapshotId) ?? null
        : null,
    [activeSave?.parentSnapshotId, snapshots]
  );
  const activeTitle = activeSave?.title || 'Capy';
  const totalCount = puzzle?.regions.length || 0;
  const filledCount = filledRegionIds.size;
  const progressPercentage = computeProgressPercentage(filledCount, totalCount);
  const isCompleted = totalCount > 0 && filledCount >= totalCount;

  // Displayed regions on canvas (animated slice during Replay mode, or full filled set)
  const displayedFilledRegionIds = useMemo(() => {
    if (!isReplaying) return filledRegionIds;
    const set = new Set<number>();
    const limit = Math.min(replayStep, replaySequence.length);
    for (let i = 0; i < limit; i++) {
      set.add(replaySequence[i]);
    }
    return set;
  }, [isReplaying, replaySequence, replayStep, filledRegionIds]);

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
    }
    return ok;
  }, [puzzle, activeTitle, settings.hapticsEnabled]);

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
        }
        return ok;
      } catch (e) {
        console.error('Failed to export snapshot printable SVG', e);
        return false;
      }
    },
    [activeSnapshotId, puzzle, activeTitle, snapshots, settings.hapticsEnabled]
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
      } catch (e) {
        console.error('Failed to export snapshot', e);
      }
    },
    [settings.hapticsEnabled]
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
    } catch (e) {
      console.error('Failed to export all snapshots', e);
    }
  }, [settings.hapticsEnabled]);

  // Import saves from .capy (v2 binary or v1 JSON) or .json file
  const handleImportSnapshots = useCallback(
    async (file: File) => {
      try {
        const buffer = await file.arrayBuffer();
        const result = await StorageService.importSnapshotData(buffer);
        if (result.importedCount > 0) {
          const refreshed = StorageService.loadSnapshots();
          setSnapshots(refreshed);
          NativeBridge.haptic('success', settings.hapticsEnabled);
        } else if (result.error) {
          alert(`Failed to import saves: ${result.error}`);
        }
      } catch (e) {
        console.error('Failed to import file', e);
      }
    },
    [settings.hapticsEnabled]
  );

  // Live state ref for zero-stale-closure Co-op & Deep-Link event handlers
  const liveCoopRef = useRef({
    puzzle,
    activeSnapshotId,
    activeSave,
    activeTitle,
    filledRegionIds,
    paintedRegionColors,
    isFreeColorMode,
    activeColorId,
    settings,
  });
  liveCoopRef.current = {
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

  const flushPendingViewportSave = useCallback(() => {
    if (viewportSaveTimerRef.current !== null) {
      window.clearTimeout(viewportSaveTimerRef.current);
      viewportSaveTimerRef.current = null;
    }
    const cur = liveCoopRef.current;
    if (!cur.activeSnapshotId || !cur.puzzle) return;
    const { zoomScale, panOffsetX, panOffsetY } = viewportRef.current;
    const updated = StorageService.updateSnapshotViewport(
      cur.activeSnapshotId,
      zoomScale,
      panOffsetX,
      panOffsetY
    );
    setSnapshots(updated);
    StorageService.saveActiveState({
      activeSnapshotId: cur.activeSnapshotId,
      activeColorId: cur.activeColorId,
      filledRegionIds: Array.from(cur.filledRegionIds),
      paintedRegionColors: Object.fromEntries(cur.paintedRegionColors),
      isFreeColorMode: cur.isFreeColorMode,
      zoomScale,
      panOffsetX,
      panOffsetY,
    });
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

  const loadSampleFromPrebakedOrGenerate = useCallback(
    async (
      sample: SampleArtwork,
      deltaFilledIds?: number[],
      deltaPaintedColors?: Record<number, number>,
      deltaIsFreeColor?: boolean,
      forceGeneratorConfig?: GeneratorConfig,
      deltaResetEpoch?: number
    ) => {
      const skipBootstrap =
        typeof window !== 'undefined' &&
        new URLSearchParams(window.location.search).get('skipSampleBootstrap') === '1';
      const cleanSamplePath = sample.assetPath.replace(/^\.\//, '');
      const usePrebaked =
        !skipBootstrap && (!forceGeneratorConfig || isDefaultGeneratorConfig(forceGeneratorConfig));

      if (usePrebaked) {
        let snaps = StorageService.loadSnapshots();
        let prebakedSnap = snaps.find(
          (s) => s.sampleAssetPath?.replace(/^\.\//, '') === cleanSamplePath
        );
        if (!prebakedSnap) {
          try {
            const bundleResp = await fetch('./assets/sample_saves.capy').catch(() => null);
            if (bundleResp && bundleResp.ok) {
              await StorageService.importSnapshotData(await bundleResp.arrayBuffer(), {
                refreshTimestamps: true,
              });
              snaps = StorageService.loadSnapshots();
              prebakedSnap = snaps.find(
                (s) => s.sampleAssetPath?.replace(/^\.\//, '') === cleanSamplePath
              );
            }
          } catch {
            // Fall back to worker generation if archive unavailable
          }
        }

        if (prebakedSnap) {
          const cachedPuzzle = await StorageService.loadPuzzleData(prebakedSnap.id);
          if (cachedPuzzle) {
            const img = await new Promise<HTMLImageElement | null>((resolve) => {
              const el = new Image();
              el.crossOrigin = 'anonymous';
              el.onload = () => resolve(el);
              el.onerror = () => resolve(null);
              el.src = sample.assetPath;
            });
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
              if (viewportSaveTimerRef.current !== null) {
                window.clearTimeout(viewportSaveTimerRef.current);
                viewportSaveTimerRef.current = null;
              }
              ++generationSeqRef.current;
              const targetView = { zoomScale: 1.0, panOffsetX: 0, panOffsetY: 0 };
              viewportRef.current = targetView;
              setInitialViewport(targetView);
              setRestoreViewTrigger((prev) => prev + 1);
              setIsReplaying(false);
              setIsReplayPlaying(false);
              setShowSettings(false);
              setSnapshots(updatedList);
              setPaintedRegionColors(restoredPaintedMap);
              handleUpdateSettings((prev) => ({ ...prev, isFreeColorMode: isFree }));
              setSourceImage(img);
              setPuzzle(cachedPuzzle);
              setActiveSnapshotId(prebakedSnap.id);
              setActiveColorId(initialColor);
              setFilledRegionIds(filledSet);
              setUndoStack(
                orderedIds.map((rId) => ({
                  regionId: rId,
                  wasPreviouslyFilled: false,
                }))
              );
              setRedoStack([]);
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
              setIsLoading(false);
              return;
            }
          }
        }
      }

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
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
      img.src = sample.assetPath;
    },
    [generatePreviewDataUrl, handleUpdateSettings, loadArtworkFromImage]
  );

  // Subscribe to Realtime Co-op Room events (Collaborator Paints, Welcome Convergence, Presence)
  useEffect(() => {
    const unsubParticipants = ProviderRegistry.realtimeRoom.onParticipantsChanged((peers) => {
      setCoopParticipants(peers);
      setCoopRoomCode(ProviderRegistry.realtimeRoom.activeRoomCode);
    });

    const unsubPaint = ProviderRegistry.realtimeRoom.onPaintEvent((event) => {
      const cur = liveCoopRef.current;
      if (!cur.puzzle) return;

      const nextFilled = new Set(cur.filledRegionIds);
      const nextPainted = new Map(cur.paintedRegionColors);
      let changed = false;

      if (event.action === 'FILL') {
        for (const rId of event.regionIds) {
          const reg = cur.puzzle.regions.find((r) => r.id === rId);
          if (!reg) continue;
          if (!nextFilled.has(rId)) {
            nextFilled.add(rId);
            changed = true;
          }
          if (event.paintedColors && event.paintedColors[rId] !== undefined) {
            if (nextPainted.get(rId) !== event.paintedColors[rId]) {
              nextPainted.set(rId, event.paintedColors[rId]);
              changed = true;
            }
          }
          // Spawn zero-allocation canvas ripple at region centroid
          coopRippleBufferRef.current.spawn(reg.centroidX, reg.centroidY, event.avatarColorHex);
        }
      } else if (event.action === 'UNFILL') {
        for (const rId of event.regionIds) {
          if (nextFilled.has(rId)) {
            nextFilled.delete(rId);
            nextPainted.delete(rId);
            changed = true;
          }
        }
      }

      if (!changed) return;
      const orderedList = Array.from(nextFilled);
      const paintedObj = Object.fromEntries(nextPainted);
      setFilledRegionIds(nextFilled);
      setPaintedRegionColors(nextPainted);

      if (cur.activeSnapshotId) {
        const { zoomScale, panOffsetX, panOffsetY } = viewportRef.current;
        const updated = StorageService.updateSnapshotProgress(
          cur.activeSnapshotId,
          nextFilled.size,
          cur.puzzle.regions.length,
          orderedList,
          zoomScale,
          panOffsetX,
          panOffsetY,
          undefined,
          paintedObj,
          cur.puzzle.palette,
          cur.puzzle.isFreeColor
        );
        setSnapshots(updated);
        StorageService.saveActiveState({
          activeSnapshotId: cur.activeSnapshotId,
          activeColorId: cur.activeColorId,
          filledRegionIds: orderedList,
          paintedRegionColors: paintedObj,
          isFreeColorMode: cur.isFreeColorMode,
          zoomScale,
          panOffsetX,
          panOffsetY,
        });
      }
    });

    const unsubUnfill = ProviderRegistry.realtimeRoom.onUnfillEvent((event) => {
      const localPeerId = ProviderRegistry.auth.getCurrentIdentity().playerId;
      if ((event.senderId || event.playerId) === localPeerId) return;

      const cur = liveCoopRef.current;
      if (!cur.puzzle) return;

      const targetIds =
        event.regionIds && event.regionIds.length > 0
          ? event.regionIds
          : event.regionId !== undefined
            ? [event.regionId]
            : [];
      if (targetIds.length === 0) return;

      const nextFilled = new Set(cur.filledRegionIds);
      const nextPainted = new Map(cur.paintedRegionColors);
      let changed = false;
      let firstUnfilledColorId: number | null = null;

      for (const rId of targetIds) {
        if (nextFilled.has(rId)) {
          nextFilled.delete(rId);
          nextPainted.delete(rId);
          changed = true;
          if (firstUnfilledColorId === null) {
            const reg = cur.puzzle.regions.find((r) => r.id === rId);
            if (reg) {
              firstUnfilledColorId = reg.colorId;
              coopRippleBufferRef.current.spawn(
                reg.centroidX,
                reg.centroidY,
                event.avatarColorHex
              );
            }
          }
        }
      }

      if (!changed) return;

      const wasCompleted =
        cur.puzzle.regions.length > 0 && cur.filledRegionIds.size >= cur.puzzle.regions.length;
      const nextActiveColorId =
        (wasCompleted || cur.activeColorId === 0) && firstUnfilledColorId !== null
          ? firstUnfilledColorId
          : cur.activeColorId;
      if (nextActiveColorId !== cur.activeColorId) {
        setActiveColorId(nextActiveColorId);
      }

      const orderedList = Array.from(nextFilled);
      const paintedObj = Object.fromEntries(nextPainted);
      setFilledRegionIds(nextFilled);
      setPaintedRegionColors(nextPainted);

      if (cur.activeSnapshotId) {
        const { zoomScale, panOffsetX, panOffsetY } = viewportRef.current;
        const updated = StorageService.updateSnapshotProgress(
          cur.activeSnapshotId,
          nextFilled.size,
          cur.puzzle.regions.length,
          orderedList,
          zoomScale,
          panOffsetX,
          panOffsetY,
          undefined,
          paintedObj,
          cur.puzzle.palette,
          cur.puzzle.isFreeColor
        );
        setSnapshots(updated);
        StorageService.saveActiveState({
          activeSnapshotId: cur.activeSnapshotId,
          activeColorId: nextActiveColorId,
          filledRegionIds: orderedList,
          paintedRegionColors: paintedObj,
          isFreeColorMode: cur.isFreeColorMode,
          zoomScale,
          panOffsetX,
          panOffsetY,
        });
      }
    });

    const unsubWelcome = ProviderRegistry.realtimeRoom.onWelcomeState(async (seedToken) => {
      try {
        const delta = await decodeProgressDeltaToken(seedToken);
        const cur = liveCoopRef.current;
        const targetSample = resolveSampleFromSourceRef(delta.sourceRef);
        const currentSamplePath =
          cur.activeSave?.sampleAssetPath ||
          (cur.activeSave?.sourceRef?.kind === 'sample' ? cur.activeSave.sourceRef.uri : null);

        if (
          targetSample &&
          currentSamplePath?.replace(/^\.\//, '') !== targetSample.assetPath.replace(/^\.\//, '')
        ) {
          await loadSampleFromPrebakedOrGenerate(
            targetSample,
            delta.filledRegionIds,
            delta.paintedRegionColors,
            delta.isFreeColor,
            undefined,
            delta.resetEpoch
          );
          return;
        }

        if (!cur.puzzle) return;
        const validIds = new Set(cur.puzzle.regions.map((r) => r.id));
        const localEpoch = cur.activeSave?.resetEpoch ?? 0;
        const localPaintedObj =
          cur.paintedRegionColors.size > 0
            ? Object.fromEntries(cur.paintedRegionColors)
            : undefined;
        const localDelta: ProgressDeltaV2 = {
          version: 2,
          filledRegionIds: Array.from(cur.filledRegionIds),
          ...(localPaintedObj ? { paintedRegionColors: localPaintedObj } : {}),
          ...(cur.isFreeColorMode ? { isFreeColor: true } : {}),
          ...(localEpoch > 0 ? { resetEpoch: localEpoch } : {}),
          updatedAt: Date.now(),
        };
        const mergedWelcome = mergeProgressDeltas(localDelta, delta);
        const mergedEpoch = mergedWelcome.resetEpoch ?? 0;
        const epochAdvanced = mergedEpoch > localEpoch;

        const nextFilled = new Set<number>();
        for (const rId of mergedWelcome.filledRegionIds) {
          if (validIds.has(rId)) nextFilled.add(rId);
        }
        const nextPainted = new Map<number, number>();
        if (mergedWelcome.paintedRegionColors) {
          for (const [k, v] of Object.entries(mergedWelcome.paintedRegionColors)) {
            const numK = Number(k);
            if (validIds.has(numK)) nextPainted.set(numK, v);
          }
        }

        let stateChanged = epochAdvanced || nextFilled.size !== cur.filledRegionIds.size;
        if (!stateChanged) {
          for (const rId of nextFilled) {
            if (!cur.filledRegionIds.has(rId)) {
              stateChanged = true;
              break;
            }
          }
        }
        if (!stateChanged && nextPainted.size !== cur.paintedRegionColors.size) {
          stateChanged = true;
        }
        if (!stateChanged) {
          for (const [rId, col] of nextPainted) {
            if (cur.paintedRegionColors.get(rId) !== col) {
              stateChanged = true;
              break;
            }
          }
        }

        if (stateChanged) {
          const orderedList = Array.from(nextFilled);
          const paintedObj = Object.fromEntries(nextPainted);
          let nextActiveColorId = cur.activeColorId;
          if (!cur.isFreeColorMode && nextFilled.size < cur.puzzle.regions.length) {
            const curStillAvailable = cur.puzzle.regions.some(
              (r) => r.colorId === cur.activeColorId && !nextFilled.has(r.id)
            );
            if (!curStillAvailable) {
              const fallback = getVisiblePalette(
                cur.puzzle.palette,
                cur.puzzle.regions,
                nextFilled,
                cur.settings.paletteSort
              )[0];
              if (fallback) {
                nextActiveColorId = fallback.id;
                setActiveColorId(fallback.id);
              }
            }
          }
          setFilledRegionIds(nextFilled);
          setPaintedRegionColors(nextPainted);
          if (cur.activeSnapshotId) {
            const { zoomScale, panOffsetX, panOffsetY } = viewportRef.current;
            const updated = StorageService.updateSnapshotProgress(
              cur.activeSnapshotId,
              nextFilled.size,
              cur.puzzle.regions.length,
              orderedList,
              zoomScale,
              panOffsetX,
              panOffsetY,
              undefined,
              paintedObj,
              cur.puzzle.palette,
              cur.puzzle.isFreeColor,
              undefined,
              mergedEpoch > 0 ? mergedEpoch : undefined
            );
            setSnapshots(updated);
            StorageService.saveActiveState({
              activeSnapshotId: cur.activeSnapshotId,
              activeColorId: nextActiveColorId,
              filledRegionIds: orderedList,
              paintedRegionColors: paintedObj,
              isFreeColorMode: cur.isFreeColorMode,
              ...(mergedEpoch > 0 ? { resetEpoch: mergedEpoch } : {}),
              zoomScale,
              panOffsetX,
              panOffsetY,
            });
          }
        }
      } catch {
        // Ignore malformed welcome token
      }
    });

    return () => {
      unsubParticipants();
      unsubPaint();
      unsubUnfill();
      unsubWelcome();
    };
  }, [loadSampleFromPrebakedOrGenerate]);

  const prevCoopSnapRef = useRef<string | null>(null);
  const prevCoopResetEpochRef = useRef<number>(0);

  // Keep active Co-op room welcome seed token fresh whenever local progress or active puzzle updates
  useEffect(() => {
    if (!coopRoomCode || !puzzle) {
      prevCoopSnapRef.current = null;
      prevCoopResetEpochRef.current = 0;
      return;
    }
    const currentEpoch = activeSave?.resetEpoch ?? 0;
    const switchedPuzzle =
      (prevCoopSnapRef.current !== null && prevCoopSnapRef.current !== activeSnapshotId) ||
      currentEpoch > prevCoopResetEpochRef.current;
    prevCoopSnapRef.current = activeSnapshotId;
    prevCoopResetEpochRef.current = currentEpoch;

    const sampleUri =
      activeSave?.sampleAssetPath ||
      (activeSave?.sourceRef?.kind === 'sample' ? activeSave.sourceRef.uri : undefined);
    const paintedObj =
      paintedRegionColors.size > 0 ? Object.fromEntries(paintedRegionColors) : undefined;
    void encodeProgressDeltaToken({
      version: 2,
      ...(sampleUri ? { sourceRef: { kind: 'sample', uri: sampleUri } } : {}),
      filledRegionIds: Array.from(filledRegionIds),
      ...(paintedObj ? { paintedRegionColors: paintedObj } : {}),
      ...(isFreeColorMode ? { isFreeColor: true } : {}),
      ...(currentEpoch > 0 ? { resetEpoch: currentEpoch } : {}),
      updatedAt: Date.now(),
    }).then((token) => {
      if (switchedPuzzle) {
        ProviderRegistry.realtimeRoom.broadcastWelcomeState(token);
      } else {
        ProviderRegistry.realtimeRoom.updateSeedToken(token);
      }
    });
  }, [
    coopRoomCode,
    puzzle,
    activeSnapshotId,
    activeSave,
    filledRegionIds,
    paintedRegionColors,
    isFreeColorMode,
  ]);

  // Handle incoming Android App Links / runtime URL hash navigation
  useEffect(() => {
    const handleIncomingUrl = async (rawUrl: string) => {
      const parsed = await parseShareLinkFromUrl(rawUrl);
      if (parsed.roomCode) {
        const id = ProviderRegistry.auth.getCurrentIdentity();
        await ProviderRegistry.realtimeRoom.joinRoom(parsed.roomCode, {
          playerId: id.playerId,
          displayName: id.displayName,
          avatarColorHex: id.avatarColorHex,
          lastActiveAt: Date.now(),
        });
        setCoopRoomCode(ProviderRegistry.realtimeRoom.activeRoomCode);
        setCoopParticipants(ProviderRegistry.realtimeRoom.getParticipants());
      }
      if (parsed.matchedSample && parsed.delta) {
        clearShareHashFromWindowUrl(parsed.roomCode);
        await loadSampleFromPrebakedOrGenerate(
          parsed.matchedSample,
          parsed.delta.filledRegionIds,
          parsed.delta.paintedRegionColors,
          parsed.delta.isFreeColor,
          undefined,
          parsed.delta.resetEpoch
        );
      }
    };

    const unsubDeepLink = NativeBridge.onDeepLink((url) => {
      void handleIncomingUrl(url);
    });
    const onHashChange = () => {
      if (window.location.hash.includes('s=')) {
        void handleIncomingUrl(window.location.href);
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => {
      unsubDeepLink();
      window.removeEventListener('hashchange', onHashChange);
    };
  }, [loadSampleFromPrebakedOrGenerate]);

  const activeSampleUri =
    activeSave?.sampleAssetPath ||
    (activeSave?.sourceRef?.kind === 'sample' || activeSave?.sourceRef?.kind === 'catalog'
      ? activeSave.sourceRef.uri
      : undefined);

  const canShareActiveLink = Boolean(activeSampleUri);

  const buildActiveShareUrl = useCallback(
    async (roomOverride?: string | null): Promise<string | null> => {
      if (!puzzle) return null;
      const paintedObj =
        paintedRegionColors.size > 0 ? Object.fromEntries(paintedRegionColors) : undefined;
      const { url } = await buildShareProgressUrl({
        sourceRef: activeSampleUri ? { kind: 'sample', uri: activeSampleUri } : undefined,
        filledRegionIds: Array.from(filledRegionIds),
        paintedRegionColors: paintedObj,
        isFreeColor: isFreeColorMode,
        resetEpoch: activeSave?.resetEpoch,
        roomCode: roomOverride,
      });
      return url;
    },
    [
      puzzle,
      activeSampleUri,
      activeSave?.resetEpoch,
      filledRegionIds,
      paintedRegionColors,
      isFreeColorMode,
    ]
  );

  const handleShareProgressLink = useCallback(async (): Promise<string | null> => {
    if (!canShareActiveLink) return null;
    const url = await buildActiveShareUrl(null);
    if (!url) return null;
    await NativeBridge.shareTextLink(`${activeTitle} — Capy Progress`, url);
    NativeBridge.haptic('tick', settings.hapticsEnabled);
    return url;
  }, [canShareActiveLink, buildActiveShareUrl, activeTitle, settings.hapticsEnabled]);

  const handleHostCoopRoom = useCallback(async (): Promise<string | null> => {
    const code = generateCoopRoomCode(6);
    const id = ProviderRegistry.auth.getCurrentIdentity();
    const paintedObj =
      paintedRegionColors.size > 0 ? Object.fromEntries(paintedRegionColors) : undefined;
    const currentEpoch = activeSave?.resetEpoch ?? 0;
    const seedToken = await encodeProgressDeltaToken({
      version: 2,
      ...(activeSampleUri ? { sourceRef: { kind: 'sample', uri: activeSampleUri } } : {}),
      filledRegionIds: Array.from(filledRegionIds),
      ...(paintedObj ? { paintedRegionColors: paintedObj } : {}),
      ...(isFreeColorMode ? { isFreeColor: true } : {}),
      ...(currentEpoch > 0 ? { resetEpoch: currentEpoch } : {}),
      updatedAt: Date.now(),
    });
    await ProviderRegistry.realtimeRoom.joinRoom(
      code,
      {
        playerId: id.playerId,
        displayName: id.displayName,
        avatarColorHex: id.avatarColorHex,
        lastActiveAt: Date.now(),
      },
      seedToken
    );
    const activeCode = ProviderRegistry.realtimeRoom.activeRoomCode;
    setCoopRoomCode(activeCode);
    setCoopParticipants(ProviderRegistry.realtimeRoom.getParticipants());
    NativeBridge.haptic('success', settings.hapticsEnabled);
    return activeCode;
  }, [
    activeSampleUri,
    activeSave?.resetEpoch,
    filledRegionIds,
    paintedRegionColors,
    isFreeColorMode,
    settings.hapticsEnabled,
  ]);

  const handleJoinCoopRoom = useCallback(
    async (rawCode: string): Promise<boolean> => {
      const id = ProviderRegistry.auth.getCurrentIdentity();
      await ProviderRegistry.realtimeRoom.joinRoom(rawCode, {
        playerId: id.playerId,
        displayName: id.displayName,
        avatarColorHex: id.avatarColorHex,
        lastActiveAt: Date.now(),
      });
      const activeCode = ProviderRegistry.realtimeRoom.activeRoomCode;
      setCoopRoomCode(activeCode);
      setCoopParticipants(ProviderRegistry.realtimeRoom.getParticipants());
      NativeBridge.haptic('success', settings.hapticsEnabled);
      return Boolean(activeCode);
    },
    [settings.hapticsEnabled]
  );

  const handleLeaveCoopRoom = useCallback(() => {
    ProviderRegistry.realtimeRoom.leaveRoom();
    setCoopRoomCode(null);
    setCoopParticipants([]);
    clearShareHashFromWindowUrl(null);
  }, []);

  const handleCopyCoopInviteLink = useCallback(async (): Promise<string | null> => {
    if (!coopRoomCode) return null;
    const url = await buildActiveShareUrl(coopRoomCode);
    if (!url) return null;
    await NativeBridge.shareTextLink(`Join my Capy Co-op Room (${coopRoomCode})`, url);
    NativeBridge.haptic('tick', settings.hapticsEnabled);
    return url;
  }, [coopRoomCode, buildActiveShareUrl, settings.hapticsEnabled]);

  const handleSyncCloudProgress = useCallback(async (): Promise<{
    addedFromCloud: number;
    syncedAt: number;
    uploadedCount?: number;
    downloadedCount?: number;
    backend?: string;
  } | null> => {
    const paintedObj =
      paintedRegionColors.size > 0 ? Object.fromEntries(paintedRegionColors) : undefined;
    const localResetEpoch = activeSave?.resetEpoch ?? 0;

    // 1. Flush active canvas state into local StorageService before full-library cloud sync
    if (puzzle && activeSnapshotId) {
      const { zoomScale, panOffsetX, panOffsetY } = viewportRef.current;
      StorageService.updateSnapshotProgress(
        activeSnapshotId,
        filledRegionIds.size,
        puzzle.regions.length,
        Array.from(filledRegionIds),
        zoomScale,
        panOffsetX,
        panOffsetY,
        undefined,
        paintedObj,
        puzzle.palette,
        puzzle.isFreeColor,
        undefined,
        localResetEpoch > 0 ? localResetEpoch : undefined
      );
    }

    // 2. Sync the entire Save Library (all sample puzzles + custom photo saves) with the active CloudProviderDriver
    const currentSnapshots = StorageService.loadSnapshots();
    const libSummary = await ProviderRegistry.cloudSave.syncFullLibrary(currentSnapshots);

    // 3. Also sync the active slot envelope and merge any newly added regions into the live canvas
    let slotAdded = 0;
    let slotMergedDelta: ProgressDeltaV2 | null = null;

    if (puzzle && activeSnapshotId) {
      const slotKey = activeSampleUri
        ? `sample_${activeSampleUri.replace(/[^a-zA-Z0-9_-]/g, '_')}`
        : `save_${activeSnapshotId}`;
      const res = await ProviderRegistry.cloudSave.syncProgress(
        slotKey,
        activeTitle,
        {
          version: 2,
          ...(activeSampleUri ? { sourceRef: { kind: 'sample', uri: activeSampleUri } } : {}),
          filledRegionIds: Array.from(filledRegionIds),
          ...(paintedObj ? { paintedRegionColors: paintedObj } : {}),
          ...(isFreeColorMode ? { isFreeColor: true } : {}),
          ...(localResetEpoch > 0 ? { resetEpoch: localResetEpoch } : {}),
          updatedAt: Date.now(),
        },
        puzzle.regions.length
      );
      slotAdded = res.addedFromCloud;
      slotMergedDelta = res.mergedDelta;
    }

    const refreshedSnapshots = StorageService.loadSnapshots();
    setSnapshots(refreshedSnapshots);

    // Check if the active puzzle gained regions or advanced resetEpoch from full-library sync or slot sync
    if (puzzle && activeSnapshotId) {
      const normalizedActiveSample = activeSampleUri ? activeSampleUri.replace(/^\.\//, '') : null;
      const matchingSave = refreshedSnapshots.find(
        (s) =>
          s.id === activeSnapshotId ||
          (normalizedActiveSample &&
            (s.sourceRef?.uri?.replace(/^\.\//, '') === normalizedActiveSample ||
              s.sampleAssetPath?.replace(/^\.\//, '') === normalizedActiveSample))
      );

      let reconciledDelta: ProgressDeltaV2 = {
        version: 2,
        filledRegionIds: Array.from(filledRegionIds),
        ...(paintedObj ? { paintedRegionColors: paintedObj } : {}),
        ...(isFreeColorMode ? { isFreeColor: true } : {}),
        ...(localResetEpoch > 0 ? { resetEpoch: localResetEpoch } : {}),
        updatedAt: Date.now(),
      };

      if (matchingSave) {
        reconciledDelta = mergeProgressDeltas(reconciledDelta, {
          version: 2,
          filledRegionIds: matchingSave.filledRegionIds || [],
          paintedRegionColors: matchingSave.paintedRegionColors,
          isFreeColor: matchingSave.isFreeColor,
          ...(matchingSave.resetEpoch && matchingSave.resetEpoch > 0
            ? { resetEpoch: matchingSave.resetEpoch }
            : {}),
          updatedAt: matchingSave.lastOpened || matchingSave.timestamp || 0,
        });
      }
      if (slotMergedDelta) {
        reconciledDelta = mergeProgressDeltas(reconciledDelta, slotMergedDelta);
      }

      const validIds = new Set(puzzle.regions.map((r) => r.id));
      const combinedFilled = new Set<number>();
      for (const rId of reconciledDelta.filledRegionIds) {
        if (validIds.has(rId)) combinedFilled.add(rId);
      }
      const nextPainted = new Map<number, number>();
      if (reconciledDelta.paintedRegionColors) {
        for (const [k, v] of Object.entries(reconciledDelta.paintedRegionColors)) {
          const rId = Number(k);
          if (validIds.has(rId)) nextPainted.set(rId, v);
        }
      }

      const reconciledEpoch = reconciledDelta.resetEpoch ?? 0;
      const epochAdvanced = reconciledEpoch > localResetEpoch;
      const gainedOnActive = Math.max(0, combinedFilled.size - filledRegionIds.size);
      if (
        epochAdvanced ||
        gainedOnActive > 0 ||
        combinedFilled.size !== filledRegionIds.size ||
        nextPainted.size !== paintedRegionColors.size
      ) {
        const orderedList = Array.from(combinedFilled);
        const mergedPaintedObj = Object.fromEntries(nextPainted);
        setFilledRegionIds(combinedFilled);
        setPaintedRegionColors(nextPainted);

        const { zoomScale, panOffsetX, panOffsetY } = viewportRef.current;
        const updated = StorageService.updateSnapshotProgress(
          activeSnapshotId,
          combinedFilled.size,
          puzzle.regions.length,
          orderedList,
          zoomScale,
          panOffsetX,
          panOffsetY,
          undefined,
          mergedPaintedObj,
          puzzle.palette,
          puzzle.isFreeColor,
          undefined,
          reconciledEpoch > 0 ? reconciledEpoch : undefined
        );
        setSnapshots(updated);
        StorageService.saveActiveState({
          activeSnapshotId,
          activeColorId,
          filledRegionIds: orderedList,
          paintedRegionColors: mergedPaintedObj,
          isFreeColorMode,
          ...(reconciledEpoch > 0 ? { resetEpoch: reconciledEpoch } : {}),
          zoomScale,
          panOffsetX,
          panOffsetY,
        });
      }
    }

    const totalAdded = Math.max(libSummary.mergedRegionsFromCloud, slotAdded);
    NativeBridge.haptic('success', settings.hapticsEnabled);
    return {
      addedFromCloud: totalAdded,
      syncedAt: libSummary.syncedAt,
      uploadedCount: libSummary.totalSavesSynced,
      downloadedCount: libSummary.importedSavesFromCloud,
      backend: libSummary.cloudBackend,
    };
  }, [
    puzzle,
    activeSnapshotId,
    activeSampleUri,
    activeSave?.resetEpoch,
    activeTitle,
    filledRegionIds,
    paintedRegionColors,
    isFreeColorMode,
    activeColorId,
    settings.hapticsEnabled,
  ]);

  // Automatically sync when Android Play Games SnapshotsClient delivers a remote cloud snapshot
  useEffect(() => {
    return NativeBridge.onCloudSnapshot(() => {
      void handleSyncCloudProgress();
    });
  }, [handleSyncCloudProgress]);

  // Automatically attempt Google / Play Games sign-in on startup and sync saves once puzzle is ready
  const hasAttemptedStartupSignInRef = useRef(false);
  const lastAutoSyncedPlayerIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (isLoading || !puzzle || !activeSnapshotId) return;
    let cancelled = false;

    const runAutoLoginAndSync = async () => {
      if (!hasAttemptedStartupSignInRef.current) {
        hasAttemptedStartupSignInRef.current = true;
        await ProviderRegistry.auth.attemptAutoSignIn();
      }
      if (cancelled) return;
      const currentId = ProviderRegistry.auth.getCurrentIdentity();
      if (
        currentId.isAuthenticated &&
        ProviderRegistry.auth.hasActiveCloudToken() &&
        lastAutoSyncedPlayerIdRef.current !== currentId.playerId
      ) {
        lastAutoSyncedPlayerIdRef.current = currentId.playerId;
        await handleSyncCloudProgress();
      }
    };

    void runAutoLoginAndSync();

    const unsubAuth = ProviderRegistry.auth.subscribe((id) => {
      if (!id.isAuthenticated) {
        lastAutoSyncedPlayerIdRef.current = null;
        return;
      }
      if (
        !cancelled &&
        ProviderRegistry.auth.hasActiveCloudToken() &&
        lastAutoSyncedPlayerIdRef.current !== id.playerId
      ) {
        lastAutoSyncedPlayerIdRef.current = id.playerId;
        void handleSyncCloudProgress();
      }
    });

    return () => {
      cancelled = true;
      unsubAuth();
    };
  }, [isLoading, puzzle, activeSnapshotId, handleSyncCloudProgress]);

  // Multi-resolution Infinite Zoom: extract 2x high-detail center sub-tile with seam-preserving palette continuity
  const handleZoomIntoDetailTile = useCallback(() => {
    if (!sourceImage) return;
    const srcW = sourceImage.naturalWidth || sourceImage.width;
    const srcH = sourceImage.naturalHeight || sourceImage.height;
    if (srcW <= 0 || srcH <= 0) return;

    // Persist parent puzzle's snapshot ID and current viewport zoom/pan before switching to the child sub-tile
    if (viewportSaveTimerRef.current !== null) {
      window.clearTimeout(viewportSaveTimerRef.current);
      viewportSaveTimerRef.current = null;
    }
    const parentId = activeSnapshotId || crypto.randomUUID();
    const currentView = { ...viewportRef.current };
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
      void StorageService.savePuzzleData(parentId, puzzle);
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
        void StorageService.savePuzzleData(parentId, puzzle);
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
    if (!tCtx) return;
    tCtx.imageSmoothingEnabled = true;
    tCtx.imageSmoothingQuality = 'high';
    tCtx.drawImage(sourceImage, cropX, cropY, cropW, cropH, 0, 0, srcW, srcH);

    tileCanvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const detailImg = new Image();
      detailImg.onload = () => {
        URL.revokeObjectURL(url);
        const subTitle = activeTitle.includes('(2x Detail)')
          ? activeTitle
          : `${activeTitle} (2x Detail)`;
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
      detailImg.src = url;
    }, 'image/webp', 0.94);
  }, [
    sourceImage,
    activeSnapshotId,
    activeSave,
    puzzle,
    filledRegionIds,
    paintedRegionColors,
    activeTitle,
    settings.generatorConfig,
    loadArtworkFromImage,
  ]);

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
        zoomScale={currentZoomScale}
        isPreviewMode={isPreviewMode}
        isCompleted={isCompleted}
        isFullscreen={isFullscreen}
        coopRoomCode={coopRoomCode}
        coopParticipants={coopParticipants}
        parentPuzzleTitle={parentSave?.title ?? null}
        releaseChannelBadge={releaseChannelInfo.badgeLabel}
        onPickImage={() => fileInputRef.current?.click()}
        onTogglePreview={() => setIsPreviewMode((prev) => !prev)}
        onToggleFullscreen={handleToggleFullscreen}
        onOpenSettings={() => {
          setSettingsInitialTab(undefined);
          setShowSettings(true);
        }}
        onOpenSaves={() => {
          setSettingsInitialTab(3);
          setShowSettings(true);
        }}
        onOpenCoop={() => {
          setSettingsInitialTab(3);
          setShowSettings(true);
        }}
        onStepZoom={() => {
          if (!puzzle || isLoading) return;
          NativeBridge.haptic('tick', settings.hapticsEnabled);
          setStepZoomTrigger((prev) => prev + 1);
        }}
        onBackToParentPuzzle={
          parentSave
            ? () => {
                NativeBridge.haptic('tick', settings.hapticsEnabled);
                void handleLoadSnapshot(parentSave);
              }
            : undefined
        }
        onOpenReleaseChannel={() => {
          setSettingsInitialTab(0);
          setShowSettings(true);
        }}
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
        isPaintMode={isReplaying ? false : settings.isPaintMode}
        canvasBgColor={settings.canvasBgColor}
        canvasBgArgb={settings.canvasBgArgb}
        sortOrder={settings.paletteSort}
        regionColorMode={settings.regionColorMode}
        showRegionLabels={isReplaying ? false : settings.showRegionLabels}
        showPreviewLabels={settings.showPreviewLabels}
        showPreviewBorders={settings.showPreviewBorders}
        labelScale={settings.labelScale}
        minLabelSize={settings.minLabelSize}
        maxLabelSize={settings.maxLabelSize}
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
        stepZoomTrigger={stepZoomTrigger}
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
        coopRippleBuffer={coopRippleBufferRef.current}
        onViewExtentChanged={(zoom, panX, panY, containerW, containerH) => {
          if (containerW && containerH && containerW > 0 && containerH > 0) {
            canvasContainerSizeRef.current = { width: containerW, height: containerH };
          }
          setCurrentZoomScale((prev) => (Math.abs(prev - zoom) < 0.001 ? prev : zoom));
          setIsCanvasTransformed(zoom > 1.05 || Math.abs(panX) > 6 || Math.abs(panY) > 6);
          if (!isLoading && puzzle && activeSnapshotId) {
            viewportRef.current = { zoomScale: zoom, panOffsetX: panX, panOffsetY: panY };
            if (viewportSaveTimerRef.current !== null) {
              window.clearTimeout(viewportSaveTimerRef.current);
            }
            viewportSaveTimerRef.current = window.setTimeout(() => {
              viewportSaveTimerRef.current = null;
              const cur = liveCoopRef.current;
              if (!cur.activeSnapshotId) return;
              const updated = StorageService.updateSnapshotViewport(
                cur.activeSnapshotId,
                zoom,
                panX,
                panY
              );
              setSnapshots(updated);
              StorageService.saveActiveState({
                activeSnapshotId: cur.activeSnapshotId,
                activeColorId: cur.activeColorId,
                filledRegionIds: Array.from(cur.filledRegionIds),
                paintedRegionColors: Object.fromEntries(cur.paintedRegionColors),
                isFreeColorMode: cur.isFreeColorMode,
                zoomScale: zoom,
                panOffsetX: panX,
                panOffsetY: panY,
              });
            }, 350);
          }
        }}
        onManualPanStart={() => {
          if (isReplaying) {
            cancelAutoResume();
            if (settings.replayFollow) {
              handleUpdateSettings((prev) => ({ ...prev, replayFollow: false }));
            }
          }
        }}
        onRegionClicked={attemptFillRegion}
        onBatchRegionsClicked={attemptBatchFillRegions}
        onVisibleColorsChanged={setVisibleColorIds}
        onVisibleRegionsChanged={setVisibleRegionIds}
        onTogglePreview={() => setIsPreviewMode((prev) => !prev)}
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
          onUndo={handleUndo}
          onRedo={handleRedo}
          onLongPressUndo={handleOpenTimelineReplay}
          onStartReplay={() => startReplay(Array.from(filledRegionIds))}
          onTogglePaintMode={() => {
            NativeBridge.haptic('tick', settings.hapticsEnabled);
            handleUpdateSettings((prev) => ({ ...prev, isPaintMode: !prev.isPaintMode }));
          }}
          onZoomIn={() => setZoomInTrigger((prev) => prev + 1)}
          onZoomOut={() => setZoomOutTrigger((prev) => prev + 1)}
          onResetView={() => setResetViewTrigger((prev) => prev + 1)}
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
          onTogglePlay={() => {
            cancelAutoResume();
            if (!isReplayPlaying && replayStepRef.current >= replaySequence.length) {
              replayStepRef.current = 0;
              setReplayStep(0);
              setIsReplayPlaying(true);
            } else {
              setIsReplayPlaying((prev) => !prev);
            }
          }}
          onToggleLoop={() => {
            cancelAutoResume();
            NativeBridge.haptic('tick', settings.hapticsEnabled);
            const nextLoop = !settings.replayLoop;
            handleUpdateSettings((prev) => ({ ...prev, replayLoop: nextLoop }));
            if (nextLoop && replayStepRef.current >= replaySequence.length) {
              replayStepRef.current = 0;
              setReplayStep(0);
              setIsReplayPlaying(true);
            }
          }}
          onToggleFollow={() => {
            cancelAutoResume();
            NativeBridge.haptic('tick', settings.hapticsEnabled);
            handleUpdateSettings((prev) => ({ ...prev, replayFollow: !prev.replayFollow }));
          }}
          onRestart={() => {
            cancelAutoResume();
            replayStepRef.current = 0;
            setReplayStep(0);
            setIsReplayPlaying(true);
          }}
          onSkipToEnd={() => {
            cancelAutoResume();
            replayStepRef.current = replaySequence.length;
            setReplayStep(replaySequence.length);
            setIsReplayPlaying(false);
          }}
          onSeek={(step) => {
            cancelAutoResume();
            replayStepRef.current = step;
            setReplayStep(step);
            setIsReplayPlaying(false);
          }}
          onChangeSpeed={(spd) => {
            cancelAutoResume();
            handleUpdateSettings((prev) => ({ ...prev, replaySpeed: spd }));
          }}
          onExitReplay={() => {
            flushPendingViewportSave();
            cancelAutoResume();
            setIsReplaying(false);
            setIsReplayPlaying(false);
          }}
          onExportImage={handleExportArtwork}
          onOpenCreate={() => {
            flushPendingViewportSave();
            cancelAutoResume();
            setIsReplaying(false);
            setIsReplayPlaying(false);
            setSettingsInitialTab(2);
            setShowSettings(true);
          }}
          onResumeFromStep={handleResumeFromReplayStep}
          onUserInteract={cancelAutoResume}
        />
      )}

      {/* Palette Dock floating above canvas */}
      {puzzle && !isLoading && !isCompleted && !isReplaying && (
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
          reducedMotion={Boolean(settings.reducedMotion)}
          isFreeColorMode={isFreeColorMode}
          showCustomColorButton={Boolean(
            isFreeColorMode || puzzle.isFreeColor || settings.enableCustomColorForAllPuzzles
          )}
          onColorSelected={(colId) => {
            NativeBridge.haptic('tick', settings.hapticsEnabled);
            setActiveColorId(colId);
            setHintRegionId(null);
          }}
          onColorHintRequested={(colId) => triggerHint(colId)}
          onOpenPaletteOptions={() => setShowPaletteOptions(true)}
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
            onClose={() => setShowPaletteOptions(false)}
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
        onToggleDetailedProgress={(enabled) => {
          handleUpdateSettings((prev) => ({
            ...prev,
            detailedLoadingProgress: enabled,
          }));
          PuzzleWorkerService.setDetailedProgress(enabled);
        }}
      />

      {/* Settings Modal Sheet */}
      <Suspense fallback={null}>
        <SettingsModal
          isOpen={showSettings}
          initialTab={settingsInitialTab}
          settings={settings}
          lifetimeStats={lifetimeStats}
          snapshots={snapshots}
          activeSnapshotId={activeSnapshotId}
          sourceImage={sourceImage}
          isFullscreen={isFullscreen}
          coopRoomCode={coopRoomCode}
          coopParticipants={coopParticipants}
          canShareActiveLink={canShareActiveLink}
          onClose={() => setShowSettings(false)}
          onUpdateSettings={handleUpdateSettings}
          onToggleFullscreen={handleToggleFullscreen}
          onLoadSnapshot={(snap) => handleLoadSnapshot(snap, false)}
          onReplaySnapshot={(snap) => handleLoadSnapshot(snap, true)}
          onRenameSnapshot={(id, newTitle) => {
            const updated = StorageService.renameSnapshot(id, newTitle);
            setSnapshots(updated);
          }}
          onTogglePinSnapshot={(id) => {
            const updated = StorageService.togglePinSnapshot(id);
            setSnapshots(updated);
          }}
          onDeleteSnapshot={async (id) => {
            if (viewportSaveTimerRef.current !== null) {
              window.clearTimeout(viewportSaveTimerRef.current);
              viewportSaveTimerRef.current = null;
            }
            const updated = await StorageService.deleteSnapshot(id);
            setSnapshots(updated);
            if (id === activeSnapshotId) {
              if (updated.length > 0) {
                handleLoadSnapshot(updated[0], false);
              } else {
                const defaultSample = SAMPLE_GALLERY[0];
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => {
                  loadArtworkFromImage(img, defaultSample.title, settings.generatorConfig, new Set(), undefined, undefined, defaultSample.assetPath);
                };
                img.src = defaultSample.assetPath;
              }
            }
          }}
          onClearAllSnapshots={async () => {
            if (viewportSaveTimerRef.current !== null) {
              window.clearTimeout(viewportSaveTimerRef.current);
              viewportSaveTimerRef.current = null;
            }
            await StorageService.clearAllSnapshots();
            setSnapshots([]);
            const defaultSample = SAMPLE_GALLERY[0];
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
              loadArtworkFromImage(img, defaultSample.title, settings.generatorConfig, new Set(), undefined, undefined, defaultSample.assetPath);
            };
            img.src = defaultSample.assetPath;
          }}
          onResetProgress={() => {
            const previouslyFilled = Array.from(filledRegionIds);
            if (previouslyFilled.length > 0) {
              emitCoopUnfill(previouslyFilled);
            }
            const nextResetEpoch = (activeSave?.resetEpoch ?? 0) + 1;
            setIsReplaying(false);
            setIsReplayPlaying(false);
            setFilledRegionIds(new Set());
            setPaintedRegionColors(new Map());
            setUndoStack([]);
            setRedoStack([]);
            setHintRegionId(null);
            resetActivePuzzleSessionStats(activeSnapshotId, false);
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
            }
            setShowSettings(false);
          }}
          onRegenerate={async (cfg) => {
            if (sourceImage) {
              const samplePath = activeSave?.sourceRef?.kind === 'sample'
                ? activeSave.sourceRef.uri
                : activeSave?.sampleAssetPath;
              const existingBlob =
                !samplePath && activeSave
                  ? await StorageService.loadImageBlob(
                      activeSave.sourceRef?.kind === 'blob' ? activeSave.sourceRef.uri : activeSave.id
                    )
                  : null;
              loadArtworkFromImage(
                sourceImage,
                activeTitle,
                cfg,
                new Set(),
                undefined,
                undefined,
                samplePath,
                false,
                existingBlob
              );
            }
          }}
          onSelectSample={(sample: SampleArtwork, cfg?: GeneratorConfig) => {
            void loadSampleFromPrebakedOrGenerate(
              sample,
              undefined,
              undefined,
              sample.isFreeColor,
              cfg || settings.generatorConfig
            );
          }}
          onUploadImage={() => fileInputRef.current?.click()}
          onExportSnapshot={handleExportSnapshot}
          onExportPrintableSvg={puzzle ? handleExportPrintableSvg : undefined}
          onExportSnapshotSvg={handleExportSnapshotSvg}
          onExportAllSnapshots={handleExportAllSnapshots}
          onImportSnapshots={handleImportSnapshots}
          onHostCoopRoom={handleHostCoopRoom}
          onJoinCoopRoom={handleJoinCoopRoom}
          onLeaveCoopRoom={handleLeaveCoopRoom}
          onShareProgressLink={handleShareProgressLink}
          onCopyCoopInviteLink={handleCopyCoopInviteLink}
          onSyncCloudProgress={handleSyncCloudProgress}
          onZoomIntoDetailTile={handleZoomIntoDetailTile}
        />
      </Suspense>
    </div>
  );
};
